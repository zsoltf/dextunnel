import SwiftUI
import DextunnelBridgeProtocol
import DextunnelNativeAppSupport
#if os(macOS)
import AppKit
#endif

struct DextunnelBridgeSetupView: View {
    @Bindable var controller: DextunnelNativeBridgeController
    let title: String
    let subtitle: String
    var compactMacLayout = false

    var body: some View {
        #if os(iOS)
        ZStack {
            iosSetupBackground
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: 14) {
                iosHero
                iosConnectionCard
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        #else
        macConnectionForm
        #endif
    }

    @ViewBuilder
    private var connectionField: some View {
        let field = TextField(controller.setupPlaceholder, text: $controller.baseURLString)
            .textFieldStyle(.roundedBorder)

        #if os(iOS)
        field
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        field
        #endif
    }

    private var macConnectionForm: some View {
        VStack(alignment: .leading, spacing: compactMacLayout ? 14 : 18) {
            macHero
            macBridgeCard

            if let lastErrorMessage = controller.lastErrorMessage, !lastErrorMessage.isEmpty {
                macMessageCard(
                    title: "Bridge error",
                    message: lastErrorMessage,
                    tint: .red.opacity(0.18),
                    border: .red.opacity(0.32)
                )
            }

            if controller.isConnecting {
                HStack(spacing: 10) {
                    ProgressView()
                        .controlSize(compactMacLayout ? .small : .regular)
                    Text(
                        controller.connectButtonTitle == "Start and connect"
                            ? "Starting and connecting..."
                            : "Connecting to bridge..."
                    )
                    .font((compactMacLayout ? Font.subheadline : .body).weight(.medium))
                    .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 12) {
                connectButton
                    .controlSize(compactMacLayout ? .regular : .large)
                    .font(.headline.weight(.semibold))

                if controller.liveStore != nil {
                    disconnectButton
                        .controlSize(compactMacLayout ? .regular : .large)
                        .font(.headline.weight(.semibold))
                }

                quitButton
                    .controlSize(compactMacLayout ? .regular : .large)
                    .font(.headline.weight(.semibold))
            }
        }
        .padding(compactMacLayout ? 16 : 20)
        .frame(width: compactMacLayout ? 360 : 420)
    }

    private var macHero: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 12) {
                Text("D")
                    .font(.system(size: compactMacLayout ? 18 : 22, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: compactMacLayout ? 34 : 42, height: compactMacLayout ? 34 : 42)
                    .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 13, style: .continuous))

                Text(title)
                    .font(.system(size: compactMacLayout ? 22 : 30, weight: .bold, design: .rounded))
            }

            Text(subtitle)
                .font(compactMacLayout ? .subheadline : .body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if controller.surface == .host {
                macMessageCard(
                    title: controller.tailscaleStatusTitle,
                    message: controller.tailscaleStatusDetail,
                    tint: controller.tailscaleInstalled ? .green.opacity(0.18) : .red.opacity(0.18),
                    border: controller.tailscaleInstalled ? .green.opacity(0.38) : .red.opacity(0.38),
                    pillTitle: controller.tailscaleStatusTitle,
                    pillColor: controller.tailscaleInstalled ? .green : .red
                )
            }
        }
    }

    private var macBridgeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(controller.surface == .host ? "Local bridge" : "Bridge URL")
                .font(.headline.weight(.semibold))

            if controller.surface == .host {
                Text(controller.baseURLString.trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.system(size: compactMacLayout ? 18 : 22, weight: .medium, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, compactMacLayout ? 11 : 13)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.primary.opacity(0.06))
                    )
            } else {
                connectionField
                    .font(.system(size: compactMacLayout ? 18 : 22, weight: .medium, design: .monospaced))
                    .controlSize(compactMacLayout ? .regular : .large)
            }

            if let managedRemoteURLString = controller.managedRemoteURLString {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Tailnet remote")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)

                    Text(managedRemoteURLString)
                        .font(.system(size: compactMacLayout ? 13 : 15, weight: .medium, design: .monospaced))
                        .textSelection(.enabled)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(controller.setupHint)
                .font(compactMacLayout ? .footnote : .body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(compactMacLayout ? 14 : 16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
        )
    }

    private func macMessageCard(
        title: String,
        message: String,
        tint: Color,
        border: Color,
        pillTitle: String? = nil,
        pillColor: Color? = nil
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let pillTitle, let pillColor {
                Text(pillTitle)
                    .font((compactMacLayout ? Font.subheadline : .headline).weight(.bold))
                    .foregroundStyle(pillColor)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(pillColor.opacity(0.14), in: Capsule())
                    .overlay(
                        Capsule()
                            .strokeBorder(pillColor.opacity(0.42), lineWidth: 1)
                    )
            } else {
                Text(title)
                    .font((compactMacLayout ? Font.subheadline : .headline).weight(.semibold))
            }

            Text(message)
                .font(compactMacLayout ? .callout : .body)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(compactMacLayout ? 14 : 16)
        .background(tint, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(border, lineWidth: 1)
        )
    }

    private var iosHero: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 40, height: 40)
                .background(
                    .ultraThinMaterial,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                )

            Text(title)
                .font(.title3.weight(.semibold))

            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .lineLimit(4)
        }
    }

    private var iosConnectionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Bridge URL")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 8)

                Text(controller.setupHint)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
                    .lineLimit(3)
            }

            connectionField

            if controller.isConnecting {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text(controller.connectButtonTitle == "Start and connect" ? "Starting and connecting..." : "Connecting to bridge...")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let lastErrorMessage = controller.lastErrorMessage, !lastErrorMessage.isEmpty {
                Text(lastErrorMessage)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                connectButton
                    .frame(maxWidth: .infinity)

                if controller.liveStore != nil {
                    disconnectButton
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.06), radius: 14, y: 8)
    }

    private var connectButton: some View {
        Button(controller.connectButtonTitle) {
            Task { await controller.connect() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(controller.isConnecting || !controller.canConnect)
    }

    private var disconnectButton: some View {
        Button("Disconnect") {
            Task { @MainActor in
                controller.disconnect()
            }
        }
        .buttonStyle(.bordered)
    }

    @ViewBuilder
    private var quitButton: some View {
        #if os(macOS)
        Button("Quit") {
            terminateHostApp()
        }
        .buttonStyle(.bordered)
        #endif
    }

    #if os(macOS)
    private func terminateHostApp() {
        controller.prepareForTermination()
        NSApplication.shared.terminate(nil)
    }
    #endif

    private var iosSetupBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.97, blue: 1.0),
                    Color(red: 0.98, green: 0.99, blue: 1.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            LinearGradient(
                colors: [
                    Color.accentColor.opacity(0.12),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(0.18),
                    Color.clear
                ],
                center: .top,
                startRadius: 20,
                endRadius: 360
            )
        }
    }
}
