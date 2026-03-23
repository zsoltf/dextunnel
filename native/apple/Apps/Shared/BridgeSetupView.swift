import SwiftUI
import DextunnelBridgeProtocol
import DextunnelNativeAppSupport

struct DextunnelBridgeSetupView: View {
    @Bindable var controller: DextunnelNativeBridgeController
    let title: String
    let subtitle: String

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
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.title3.weight(.semibold))

            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)

            connectionField

            Text(controller.setupHint)
                .font(.caption2)
                .foregroundStyle(.secondary)

            if
                controller.surface == .host,
                let localBridgeStatusMessage = controller.localBridgeStatusMessage,
                !localBridgeStatusMessage.isEmpty
            {
                Text(localBridgeStatusMessage)
                    .font(.caption2)
                    .foregroundStyle(controller.canManageLocalBridge ? Color.secondary : Color.orange)
            }

            if let lastErrorMessage = controller.lastErrorMessage, !lastErrorMessage.isEmpty {
                Text(lastErrorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if controller.isConnecting {
                Label(
                    controller.connectButtonTitle == "Start and connect"
                        ? "Starting and connecting..."
                        : "Connecting to bridge...",
                    systemImage: "hourglass"
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                connectButton

                if controller.liveStore != nil {
                    disconnectButton
                }
            }
        }
        .padding()
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
            controller.disconnect()
        }
        .buttonStyle(.bordered)
    }

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
