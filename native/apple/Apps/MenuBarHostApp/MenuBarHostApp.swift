import SwiftUI
import AppKit
import DextunnelAppleState
import DextunnelNativeAppSupport
import DextunnelMenuBarHostShell

private let menuBarPopupWidth: CGFloat = 360

@available(macOS 15.0, *)
@main
struct DextunnelMenuBarHostApp: App {
    @State private var controller: DextunnelNativeBridgeController

    init() {
        let controller = DextunnelNativeBridgeController(
            surface: .host,
            defaultBaseURLString: "http://127.0.0.1:4317"
        )
        _controller = State(initialValue: controller)

        Task { @MainActor in
            if controller.liveStore == nil && controller.canConnect {
                await controller.connect()
            }
        }
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarHostRootView(controller: controller)
        } label: {
            Text("D")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(menuBarLabelColor)
                .accessibilityLabel("Dextunnel Host")
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarLabelColor: Color {
        if controller.liveStore?.lastErrorMessage != nil {
            return .red
        }
        if controller.liveStore != nil {
            return .green
        }
        return .primary
    }
}

@available(macOS 15.0, *)
private struct MenuBarHostRootView: View {
    @Bindable var controller: DextunnelNativeBridgeController

    var body: some View {
        Group {
            if let store = controller.liveStore {
                connectedView(store: store)
            } else if controller.isConnecting && controller.lastErrorMessage == nil {
                MenuBarHostConnectingView(controller: controller)
            } else {
                DextunnelBridgeSetupView(
                    controller: controller,
                    title: "Dextunnel Host",
                    subtitle: "Run the bridge on this Mac and keep the desktop connection ready.",
                    compactMacLayout: true
                )
            }
        }
        .frame(width: menuBarPopupWidth, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func connectedView(store: DextunnelLiveBridgeStore) -> some View {
        MenuBarHostConnectedView(
            store: store,
            tailscaleActive: controller.tailscaleConnected,
            tailscaleURLString: controller.managedRemoteURLString,
            openRemoteView: openRemote,
            disconnect: {
                Task { @MainActor in
                    controller.disconnect()
                }
            },
            quit: terminateHostApp
        )
    }

    private func openRemote() {
        let targetBaseURLString = controller.managedRemoteURLString ?? controller.baseURLString
        guard let baseURL = URL(string: targetBaseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return
        }
        NSWorkspace.shared.open(baseURL)
    }

    private func terminateHostApp() {
        controller.prepareForTermination()
        NSApplication.shared.terminate(nil)
    }
}

@available(macOS 15.0, *)
private struct MenuBarHostConnectedView: View {
    let store: DextunnelLiveBridgeStore
    let tailscaleActive: Bool
    let tailscaleURLString: String?
    let openRemoteView: () -> Void
    let disconnect: () -> Void
    let quit: () -> Void
    @State private var notificationCoordinator = DextunnelLocalNotificationCoordinator()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            DextunnelMenuBarStatusView(
                store: store,
                openRemoteView: openRemoteView,
                tailscaleActive: tailscaleActive,
                tailscaleURLString: tailscaleURLString
            )
            .task {
                await store.syncPresence(visible: true, focused: true, engaged: true)
            }
            .task(id: store.notificationSnapshot) {
                await notificationCoordinator.update(
                    with: store.notificationSnapshot,
                    notificationsEnabled: !NSApplication.shared.isActive
                )
            }

            Divider()

            HStack(spacing: 10) {
                Button("Reconnect") {
                    Task { await store.reconnect() }
                }
                Button("Disconnect", action: disconnect)
                Button("Remote", action: openRemoteView)
                Button("Quit", action: quit)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
    }
}

@available(macOS 15.0, *)
private struct MenuBarHostConnectingView: View {
    @Bindable var controller: DextunnelNativeBridgeController

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.regular)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dextunnel")
                        .font(.headline.weight(.semibold))
                    Text("Connecting...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if let localBridgeStatusMessage = controller.localBridgeStatusMessage, !localBridgeStatusMessage.isEmpty {
                Text(localBridgeStatusMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
