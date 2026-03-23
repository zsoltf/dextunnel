import SwiftUI
import AppKit
import DextunnelNativeAppSupport
import DextunnelMenuBarHostShell

@available(macOS 15.0, *)
@main
struct DextunnelMenuBarHostApp: App {
    @State private var controller = DextunnelNativeBridgeController(
        surface: .host,
        defaultBaseURLString: "http://127.0.0.1:4317"
    )

    var body: some Scene {
        MenuBarExtra("Dextunnel", systemImage: menuBarSymbolName) {
            MenuBarHostRootView(controller: controller)
                .task {
                    if controller.liveStore == nil && controller.canConnect {
                        await controller.connect()
                    }
                }
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarSymbolName: String {
        if controller.liveStore?.lastErrorMessage != nil {
            return "exclamationmark.triangle.fill"
        }
        if controller.liveStore != nil {
            return "point.3.connected.trianglepath.dotted"
        }
        return "point.3.connected.trianglepath.dotted"
    }
}

@available(macOS 15.0, *)
private struct MenuBarHostRootView: View {
    @Bindable var controller: DextunnelNativeBridgeController
    @State private var notificationCoordinator = DextunnelLocalNotificationCoordinator()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let store = controller.liveStore {
                DextunnelMenuBarStatusView(
                    store: store,
                    openRemoteView: { openPath("/remote.html") }
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

                HStack {
                    Button("Reconnect") {
                        Task { await controller.connect() }
                    }
                    Button("Disconnect") {
                        controller.disconnect()
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            } else {
                DextunnelBridgeSetupView(
                    controller: controller,
                    title: "Dextunnel Host",
                    subtitle: "Start the managed Tailscale bridge on this Mac, then show status, room overview, and quick desktop actions."
                )
                .frame(minWidth: 340)
            }
        }
    }

    private func openPath(_ path: String) {
        guard let baseURL = URL(string: controller.baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return
        }
        NSWorkspace.shared.open(baseURL.appending(path: path))
    }
}
