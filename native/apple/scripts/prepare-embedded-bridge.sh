#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APPLE_DIR}/../.." && pwd)"
OUTPUT_ROOT="${APPLE_DIR}/.build-resources/EmbeddedBridge"
LIB_ROOT="${OUTPUT_ROOT}/lib"

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "prepare-embedded-bridge: missing required command '${name}'" >&2
    exit 1
  fi
}

require_command rsync
require_command otool
require_command install_name_tool
require_command codesign
require_command cp
require_command chmod

resolve_abs_path() {
  local input="$1"
  local dir=""
  local name=""
  local target=""

  dir="$(cd "$(dirname "${input}")" && pwd -P)"
  name="$(basename "${input}")"

  if [[ -L "${dir}/${name}" ]]; then
    target="$(readlink "${dir}/${name}")"
    case "${target}" in
      /*)
        resolve_abs_path "${target}"
        ;;
      *)
        resolve_abs_path "${dir}/${target}"
        ;;
    esac
    return 0
  fi

  printf '%s/%s\n' "${dir}" "${name}"
}

resolve_node_binary() {
  local explicit=""
  if [[ -n "${DEXTUNNEL_NODE_BINARY:-}" ]]; then
    explicit="${DEXTUNNEL_NODE_BINARY}"
  elif [[ -n "${NODE_BINARY:-}" ]]; then
    explicit="${NODE_BINARY}"
  fi

  if [[ -n "${explicit}" && -x "${explicit}" ]]; then
    printf '%s\n' "${explicit}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local candidate=""
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node /usr/bin/node /bin/node; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

list_dependency_refs() {
  local target="$1"
  otool -L "${target}" | awk 'NR > 1 { print $1 }'
}

is_system_dependency() {
  local dep="$1"
  case "${dep}" in
    /System/Library/* | /usr/lib/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

NODE_BINARY_PATH="$(resolve_node_binary || true)"
if [[ -z "${NODE_BINARY_PATH}" ]]; then
  echo "prepare-embedded-bridge: couldn't find a Node binary. Set DEXTUNNEL_NODE_BINARY to continue." >&2
  exit 1
fi
NODE_BINARY_REAL_PATH="$(resolve_abs_path "${NODE_BINARY_PATH}")"
NODE_BINARY_DIR="$(dirname "${NODE_BINARY_REAL_PATH}")"
NODE_INSTALL_ROOT="$(cd "${NODE_BINARY_DIR}/.." && pwd -P)"
NODE_LIBRARY_ROOT="${NODE_INSTALL_ROOT}/lib"

resolve_dependency_source() {
  local dep="$1"
  local source="$2"
  local base=""
  local source_dir=""
  local candidate=""

  case "${dep}" in
    @rpath/*)
      base="${dep#@rpath/}"
      for candidate in \
        "${NODE_LIBRARY_ROOT}/${base}" \
        "$(cd "$(dirname "${source}")/../lib" 2>/dev/null && pwd -P)/${base}" \
        "$(cd "$(dirname "${source}")" 2>/dev/null && pwd -P)/${base}"
      do
        if [[ -f "${candidate}" ]]; then
          resolve_abs_path "${candidate}"
          return 0
        fi
      done
      ;;
    @loader_path/*)
      source_dir="$(cd "$(dirname "${source}")" && pwd -P)"
      candidate="${source_dir}/${dep#@loader_path/}"
      if [[ -f "${candidate}" ]]; then
        resolve_abs_path "${candidate}"
        return 0
      fi
      ;;
    @executable_path/*)
      source_dir="$(cd "$(dirname "${source}")" && pwd -P)"
      candidate="${source_dir}/${dep#@executable_path/}"
      if [[ -f "${candidate}" ]]; then
        resolve_abs_path "${candidate}"
        return 0
      fi
      ;;
    *)
      if [[ -f "${dep}" ]]; then
        resolve_abs_path "${dep}"
        return 0
      fi
      ;;
  esac

  return 1
}

rewrite_copied_library() {
  local destination="$1"
  local source="$2"
  local dep=""
  local resolved=""
  local base=""

  install_name_tool -id "@loader_path/$(basename "${destination}")" "${destination}"

  while IFS= read -r dep; do
    if is_system_dependency "${dep}"; then
      continue
    fi
    resolved="$(resolve_dependency_source "${dep}" "${source}" || true)"
    if [[ -z "${resolved}" ]]; then
      echo "prepare-embedded-bridge: couldn't resolve dependency '${dep}' referenced by '${source}'" >&2
      exit 1
    fi
    base="$(basename "${resolved}")"
    install_name_tool -change "${dep}" "@loader_path/${base}" "${destination}"
  done < <(list_dependency_refs "${source}")
}

copy_dependency_tree() {
  local source="$1"
  local dep=""
  local resolved=""
  local base=""
  local destination=""

  while IFS= read -r dep; do
    if is_system_dependency "${dep}"; then
      continue
    fi

    resolved="$(resolve_dependency_source "${dep}" "${source}" || true)"
    if [[ -z "${resolved}" ]]; then
      echo "prepare-embedded-bridge: couldn't resolve dependency '${dep}' referenced by '${source}'" >&2
      exit 1
    fi

    base="$(basename "${resolved}")"
    destination="${LIB_ROOT}/${base}"

    if [[ -f "${destination}" ]]; then
      continue
    fi

    cp -p "${resolved}" "${destination}"
    chmod 755 "${destination}" || true
    codesign --remove-signature "${destination}" >/dev/null 2>&1 || true
    copy_dependency_tree "${resolved}"
    rewrite_copied_library "${destination}" "${resolved}"
  done < <(list_dependency_refs "${source}")
}

rewrite_node_binary() {
  local destination="$1"
  local source="$2"
  local dep=""
  local resolved=""
  local base=""

  while IFS= read -r dep; do
    if is_system_dependency "${dep}"; then
      continue
    fi
    resolved="$(resolve_dependency_source "${dep}" "${source}" || true)"
    if [[ -z "${resolved}" ]]; then
      echo "prepare-embedded-bridge: couldn't resolve dependency '${dep}' referenced by '${source}'" >&2
      exit 1
    fi
    base="$(basename "${resolved}")"
    install_name_tool -change "${dep}" "@executable_path/../lib/${base}" "${destination}"
  done < <(list_dependency_refs "${source}")
}

ad_hoc_sign_embedded_runtime() {
  local target=""

  for target in "${LIB_ROOT}"/*; do
    if [[ -f "${target}" ]]; then
      codesign --force --sign - "${target}" >/dev/null
    fi
  done

  codesign --force --sign - "${OUTPUT_ROOT}/bin/node" >/dev/null
}

rm -rf "${OUTPUT_ROOT}"
mkdir -p "${OUTPUT_ROOT}/bin" "${LIB_ROOT}"

rsync -a --delete "${REPO_ROOT}/src/" "${OUTPUT_ROOT}/src/"
rsync -a --delete "${REPO_ROOT}/public/" "${OUTPUT_ROOT}/public/"
cp "${REPO_ROOT}/package.json" "${OUTPUT_ROOT}/package.json"
cp "${NODE_BINARY_REAL_PATH}" "${OUTPUT_ROOT}/bin/node"
chmod 755 "${OUTPUT_ROOT}/bin/node"
codesign --remove-signature "${OUTPUT_ROOT}/bin/node" >/dev/null 2>&1 || true
copy_dependency_tree "${NODE_BINARY_REAL_PATH}"
rewrite_node_binary "${OUTPUT_ROOT}/bin/node" "${NODE_BINARY_REAL_PATH}"
ad_hoc_sign_embedded_runtime

cat > "${OUTPUT_ROOT}/bridge-manifest.json" <<EOF
{
  "embeddedFromRepo": "${REPO_ROOT}",
  "embeddedNodeBinary": "${NODE_BINARY_REAL_PATH}"
}
EOF

echo "prepare-embedded-bridge: bundled bridge runtime into ${OUTPUT_ROOT}"
