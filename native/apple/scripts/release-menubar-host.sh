#!/bin/bash
set -euo pipefail

MODE="${1:-release}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APPLE_DIR}/../.." && pwd)"

SCHEME="${DEXTUNNEL_APPLE_SCHEME:-DextunnelMenuBarHostApp}"
CONFIGURATION="${DEXTUNNEL_APPLE_CONFIGURATION:-Release}"
APP_NAME="${DEXTUNNEL_APPLE_PRODUCT_NAME:-DextunnelHost}"
TEAM_ID="${DEXTUNNEL_APPLE_TEAM_ID:-}"
SIGNING_IDENTITY="${DEXTUNNEL_APPLE_SIGNING_IDENTITY:-Developer ID Application}"
NOTARY_PROFILE="${DEXTUNNEL_APPLE_NOTARY_PROFILE:-}"
ZIP_NAME="${DEXTUNNEL_APPLE_ZIP_NAME:-${APP_NAME}-macOS.zip}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DIST_ROOT="${DEXTUNNEL_APPLE_DIST_ROOT:-${APPLE_DIR}/dist/${TIMESTAMP}}"
ARCHIVE_PATH="${DEXTUNNEL_APPLE_ARCHIVE_PATH:-${DIST_ROOT}/${SCHEME}.xcarchive}"
EXPORT_DIR="${DEXTUNNEL_APPLE_EXPORT_DIR:-${DIST_ROOT}/export}"
EXPORT_OPTIONS_PLIST="${DIST_ROOT}/ExportOptions.plist"
APP_PATH="${EXPORT_DIR}/${APP_NAME}.app"
ZIP_PATH="${DIST_ROOT}/${ZIP_NAME}"
CHECKSUM_PATH="${ZIP_PATH}.sha256"
EMBEDDED_NODE_ENTITLEMENTS="${APPLE_DIR}/Apps/MenuBarHostApp/EmbeddedNode.entitlements"

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "release-menubar-host: missing required command '${name}'" >&2
    exit 1
  fi
}

require_setting() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "release-menubar-host: missing required env ${name}" >&2
    exit 1
  fi
}

package_zip() {
  require_command ditto
  require_command shasum
  rm -f "${ZIP_PATH}" "${CHECKSUM_PATH}"
  ditto -c -k --keepParent --norsrc "${APP_PATH}" "${ZIP_PATH}"
  (
    cd "${DIST_ROOT}"
    shasum -a 256 "${ZIP_NAME}" > "$(basename "${CHECKSUM_PATH}")"
  )
}

prepare() {
  require_command xcodegen
  mkdir -p "${DIST_ROOT}"
  "${SCRIPT_DIR}/prepare-embedded-bridge.sh"
  (
    cd "${APPLE_DIR}"
    xcodegen generate
  )
}

write_export_options() {
  require_setting DEXTUNNEL_APPLE_TEAM_ID "${TEAM_ID}"
  cat > "${EXPORT_OPTIONS_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>developer-id</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
</dict>
</plist>
EOF
}

archive_app() {
  require_command xcodebuild
  require_setting DEXTUNNEL_APPLE_TEAM_ID "${TEAM_ID}"
  prepare
  write_export_options
  (
    cd "${APPLE_DIR}"
    xcodebuild archive \
      -project DextunnelAppleApps.xcodeproj \
      -scheme "${SCHEME}" \
      -configuration "${CONFIGURATION}" \
      -destination "platform=macOS" \
      -archivePath "${ARCHIVE_PATH}" \
      CODE_SIGN_STYLE=Automatic \
      DEVELOPMENT_TEAM="${TEAM_ID}" \
      ENABLE_HARDENED_RUNTIME=YES
  )
}

sign_exported_app() {
  local embedded_root="${APP_PATH}/Contents/Resources/EmbeddedBridge"
  local embedded_lib_root="${embedded_root}/lib"
  local embedded_node="${embedded_root}/bin/node"
  local target=""

  require_command codesign
  require_command xattr

  if [[ ! -x "${embedded_node}" ]]; then
    echo "release-menubar-host: expected embedded Node runtime at ${embedded_node}" >&2
    exit 1
  fi
  if [[ ! -f "${EMBEDDED_NODE_ENTITLEMENTS}" ]]; then
    echo "release-menubar-host: missing embedded node entitlements at ${EMBEDDED_NODE_ENTITLEMENTS}" >&2
    exit 1
  fi

  # Keep the shipped bundle free of local provenance/resource metadata before
  # we apply the final signatures and build the release archive.
  xattr -cr "${APP_PATH}"

  if [[ -d "${embedded_lib_root}" ]]; then
    while IFS= read -r target; do
      codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" "${target}"
    done < <(find "${embedded_lib_root}" -type f | sort)
  fi

  codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" --entitlements "${EMBEDDED_NODE_ENTITLEMENTS}" "${embedded_node}"
  (
    cd "${embedded_root}"
    ./bin/node -e "console.log('embedded-runtime-ok')" >/dev/null
  )
  codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" "${APP_PATH}"
}

export_archive() {
  require_command xcodebuild
  if [[ ! -d "${ARCHIVE_PATH}" ]]; then
    archive_app
  fi
  write_export_options
  (
    cd "${APPLE_DIR}"
    xcodebuild -exportArchive \
      -archivePath "${ARCHIVE_PATH}" \
      -exportPath "${EXPORT_DIR}" \
      -exportOptionsPlist "${EXPORT_OPTIONS_PLIST}"
  )
  sign_exported_app
  echo "release-menubar-host: export mode signs the app but does not notarize it. Use notarize or release before testing Gatekeeper/distribution behavior."
}

zip_exported_app() {
  if [[ ! -d "${APP_PATH}" ]]; then
    export_archive
  fi
  package_zip
}

notarize_export() {
  require_command xcrun
  require_command spctl
  require_setting DEXTUNNEL_APPLE_NOTARY_PROFILE "${NOTARY_PROFILE}"

  zip_exported_app
  xcrun notarytool submit "${ZIP_PATH}" --keychain-profile "${NOTARY_PROFILE}" --wait
  xcrun stapler staple "${APP_PATH}"
  xcrun stapler validate "${APP_PATH}"
  spctl --assess --type execute -v "${APP_PATH}"
  package_zip
}

case "${MODE}" in
  archive)
    archive_app
    ;;
  export)
    export_archive
    ;;
  notarize)
    notarize_export
    ;;
  release)
    export_archive
    notarize_export
    ;;
  *)
    echo "Usage: ${0##*/} [archive|export|notarize|release]" >&2
    exit 1
    ;;
esac

echo "release-menubar-host: artifacts available in ${DIST_ROOT}"
