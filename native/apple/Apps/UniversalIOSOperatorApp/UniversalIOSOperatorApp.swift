import SwiftUI
import UIKit
import DextunnelAppleState
import DextunnelNativeAppSupport
import DextunnelUniversalIOSShell

@available(iOS 18.0, *)
@main
struct DextunnelUniversalIOSOperatorApp: App {
    @AppStorage("universal_ios_appearance") private var appearanceRawValue = DextunnelAppearancePreference.followSystem.rawValue
    @State private var controller = DextunnelNativeBridgeController(
        surface: .remote,
        defaultBaseURLString: ""
    )

    var body: some Scene {
        WindowGroup {
            ZStack {
                sceneBackground
                    .ignoresSafeArea()
                UniversalIOSRootView(controller: controller)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .preferredColorScheme(currentAppearance.colorScheme)
        }
    }

    private var currentAppearance: DextunnelAppearancePreference {
        DextunnelAppearancePreference(rawValue: appearanceRawValue) ?? .followSystem
    }

    private var windowBackgroundColor: UIColor {
        switch currentAppearance {
        case .dark:
            return UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1)
        case .light, .followSystem:
            return UIColor(red: 0.95, green: 0.97, blue: 1.0, alpha: 1)
        }
    }

    @ViewBuilder
    private var sceneBackground: some View {
        switch currentAppearance {
        case .dark:
            Color(red: 0.06, green: 0.07, blue: 0.09)
        case .light, .followSystem:
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.97, blue: 1.0),
                    Color(red: 0.98, green: 0.99, blue: 1.0)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

@available(iOS 18.0, *)
private struct UniversalIOSRootView: View {
    @AppStorage("universal_ios_appearance") private var appearanceRawValue = DextunnelAppearancePreference.followSystem.rawValue
    @Bindable var controller: DextunnelNativeBridgeController
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingConnectionSheet = false
    @State private var notificationCoordinator = DextunnelLocalNotificationCoordinator()

    var body: some View {
        ZStack(alignment: .top) {
            appBackground
                .ignoresSafeArea()

            WindowBackgroundConfigurator(backgroundColor: appWindowBackgroundColor)
                .allowsHitTesting(false)

            Group {
                if let store = controller.liveStore {
                    DextunnelUniversalOperatorView(store: store, appearanceRawValue: $appearanceRawValue)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("Bridge") {
                                    showingConnectionSheet = true
                                }
                            }
                        }
                        .sheet(isPresented: $showingConnectionSheet) {
                            NavigationStack {
                                DextunnelBridgeSetupView(
                                    controller: controller,
                                    title: "Bridge connection",
                                    subtitle: "Point the native operator app at a Dextunnel bridge URL. The app fetches a signed remote bootstrap from the bridge."
                                )
                                .navigationTitle("Connection")
                                .toolbar {
                                    ToolbarItem(placement: .topBarLeading) {
                                        appearanceMenu
                                    }
                                    ToolbarItem(placement: .topBarTrailing) {
                                        Button("Done") {
                                            showingConnectionSheet = false
                                        }
                                    }
                                }
                            }
                        }
                        .task {
                            await store.setForegroundActive(scenePhase == .active)
                            await updatePresence(for: store, phase: scenePhase)
                        }
                        .onChange(of: store.selectedThreadId) { _, _ in
                            Task {
                                await updatePresence(for: store, phase: scenePhase)
                            }
                        }
                        .onChange(of: scenePhase) { _, newPhase in
                            Task {
                                await store.setForegroundActive(newPhase == .active)
                                await updatePresence(for: store, phase: newPhase)
                            }
                        }
                        .task(id: store.notificationSnapshot) {
                            await notificationCoordinator.update(
                                with: store.notificationSnapshot,
                                notificationsEnabled: scenePhase != .active
                            )
                        }
                } else {
                    ZStack(alignment: .topTrailing) {
                        DextunnelBridgeSetupView(
                            controller: controller,
                            title: "Universal iOS operator",
                            subtitle: "Connect over LAN or Tailscale. Use the Mac running Dextunnel, not 127.0.0.1, and start the bridge with `npm run start:network` when you want native mobile access."
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                        appearanceMenu
                            .padding(.top, 14)
                            .padding(.trailing, 18)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task {
            applyWindowAppearance()
            if controller.liveStore == nil && controller.canConnect {
                await controller.connect()
            }
        }
        .onChange(of: appearanceRawValue) { _, _ in
            applyWindowAppearance()
        }
    }

    private var appWindowBackgroundColor: UIColor {
        let appearance = DextunnelAppearancePreference(rawValue: appearanceRawValue) ?? .followSystem
        switch appearance {
        case .dark:
            return UIColor(red: 0.06, green: 0.07, blue: 0.09, alpha: 1)
        case .light, .followSystem:
            return UIColor(red: 0.95, green: 0.97, blue: 1.0, alpha: 1)
        }
    }

    private var appBackground: some View {
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
                    Color.accentColor.opacity(0.1),
                    Color.clear
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(0.16),
                    Color.clear
                ],
                center: .top,
                startRadius: 20,
                endRadius: 420
            )
        }
    }

    private func updatePresence(for store: DextunnelLiveBridgeStore, phase: ScenePhase) async {
        switch phase {
        case .active:
            await store.syncPresence(visible: true, focused: true, engaged: true)
        case .inactive:
            await store.syncPresence(visible: true, focused: false, engaged: false)
        case .background:
            await store.syncPresence(visible: false, focused: false, engaged: false, detach: true)
        @unknown default:
            await store.syncPresence(visible: false, focused: false, engaged: false)
        }
    }

    private func applyWindowAppearance() {
        let backgroundColor = appWindowBackgroundColor
        DispatchQueue.main.async {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .forEach { window in
                    window.backgroundColor = backgroundColor
                    window.isOpaque = true
                    window.rootViewController?.view.backgroundColor = backgroundColor
                    window.rootViewController?.view.isOpaque = true
                }
        }
    }

    private var appearanceMenu: some View {
        Menu {
            Picker("Appearance", selection: $appearanceRawValue) {
                ForEach(DextunnelAppearancePreference.allCases) { preference in
                    Text(preference.title).tag(preference.rawValue)
                }
            }
        } label: {
            Image(systemName: "circle.lefthalf.filled")
        }
        .accessibilityLabel("Appearance")
    }
}

private struct WindowBackgroundConfigurator: UIViewRepresentable {
    let backgroundColor: UIColor

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isUserInteractionEnabled = false
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        DispatchQueue.main.async {
            uiView.backgroundColor = .clear
            uiView.superview?.backgroundColor = .clear
            uiView.window?.backgroundColor = backgroundColor
            uiView.window?.rootViewController?.view.backgroundColor = backgroundColor

            var responder: UIResponder? = uiView
            while let current = responder {
                if let viewController = current as? UIViewController {
                    viewController.view.backgroundColor = backgroundColor
                    break
                }
                responder = current.next
            }
        }
    }
}
