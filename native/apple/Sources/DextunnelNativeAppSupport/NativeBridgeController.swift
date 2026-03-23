import Foundation
import Observation
import DextunnelAppleState
import DextunnelBridgeClient
import DextunnelBridgeProtocol

public struct DextunnelNativeConnectionSettings: Codable, Equatable, Sendable {
    public let baseURLString: String

    public init(baseURLString: String) {
        self.baseURLString = baseURLString
    }
}

@MainActor
@Observable
public final class DextunnelNativeBridgeController {
    public var baseURLString: String
    public private(set) var isConnecting = false
    public private(set) var lastErrorMessage: String?
    public private(set) var localBridgeStatusMessage: String?
    public private(set) var liveStore: DextunnelLiveBridgeStore?
    public let surface: DextunnelSurfaceKind

    private let userDefaults: UserDefaults
    private let defaultsKey: String
    private let defaultBaseURLString: String
    private let localBridgeManager: DextunnelLocalBridgeManaging?

    public init(
        surface: DextunnelSurfaceKind,
        userDefaults: UserDefaults = .standard,
        defaultBaseURLString: String,
        localBridgeManager: DextunnelLocalBridgeManaging? = nil
    ) {
        let resolvedLocalBridgeManager = localBridgeManager ?? Self.defaultLocalBridgeManager(for: surface)
        self.surface = surface
        self.userDefaults = userDefaults
        self.defaultsKey = "dextunnel.native.connection.\(surface.rawValue)"
        self.defaultBaseURLString = defaultBaseURLString
        self.localBridgeManager = resolvedLocalBridgeManager
        if
            let data = userDefaults.data(forKey: defaultsKey),
            let saved = try? JSONDecoder().decode(DextunnelNativeConnectionSettings.self, from: data)
        {
            self.baseURLString = saved.baseURLString
        } else {
            self.baseURLString = Self.defaultConnectionBaseURLString(
                surface: surface,
                fallbackBaseURLString: defaultBaseURLString,
                localBridgeManager: resolvedLocalBridgeManager
            )
        }
        self.localBridgeStatusMessage = resolvedLocalBridgeManager?.statusMessage
    }

    public var canConnect: Bool {
        URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
    }

    public var canManageLocalBridge: Bool {
        surface == .host && localBridgeManager?.isAvailable == true
    }

    public var connectButtonTitle: String {
        guard surface == .host, liveStore == nil else {
            return "Connect"
        }
        return canManageLocalBridge ? "Start and connect" : "Connect"
    }

    public var setupPlaceholder: String {
        switch surface {
        case .host:
            if
                let fallbackURL = URL(string: defaultBaseURLString),
                let managedBaseURL = localBridgeManager?.managedBaseURL(for: fallbackURL)
            {
                return managedBaseURL.absoluteString
            }
            return "http://127.0.0.1:4317"
        case .remote:
            return "http://your-mac-or-tailscale-ip:4317"
        }
    }

    public var setupHint: String {
        switch surface {
        case .host:
            if canManageLocalBridge {
                return "Dextunnel Host prefers this Mac's Tailscale address and can start the managed bridge for you."
            }
            return "Dextunnel Host can connect to a manually started bridge. App-managed start is reserved for Macs with Tailscale installed."
        case .remote:
            #if targetEnvironment(simulator)
            return "On Simulator, localhost usually works. For iPhone or iPad, use your Mac's LAN or Tailscale address and start the bridge with `npm run start:network`."
            #else
            return "Use your Mac's LAN or Tailscale address here. Start the bridge with `npm run start:network` when you want iPhone or iPad access."
            #endif
        }
    }

    public func connect() async {
        let trimmedBaseURLString = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let requestedBaseURL = URL(string: trimmedBaseURLString) else {
            lastErrorMessage = "Enter a valid bridge URL."
            return
        }

        isConnecting = true
        defer { isConnecting = false }

        do {
            let store = try await connectStore(baseURL: requestedBaseURL)
            applyConnectedStore(store, baseURLString: trimmedBaseURLString)
        } catch {
            if shouldAttemptManagedBridgeLaunch(after: error, requestedBaseURL: requestedBaseURL) {
                let managedBaseURL = localBridgeManager?.managedBaseURL(for: requestedBaseURL) ?? requestedBaseURL
                do {
                    try await localBridgeManager?.start(baseURL: managedBaseURL)
                    syncLocalBridgeStatus()
                    let store = try await connectStore(baseURL: managedBaseURL)
                    baseURLString = managedBaseURL.absoluteString
                    applyConnectedStore(store, baseURLString: managedBaseURL.absoluteString)
                    return
                } catch {
                    syncLocalBridgeStatus()
                    lastErrorMessage = Self.presentedManagedBridgeErrorMessage(
                        error,
                        bridgeURLString: managedBaseURL.absoluteString,
                        fallbackStatusMessage: localBridgeStatusMessage
                    )
                    return
                }
            }

            syncLocalBridgeStatus()
            lastErrorMessage = Self.presentedErrorMessage(
                for: error,
                surface: surface,
                bridgeURLString: trimmedBaseURLString,
                localBridgeStatusMessage: localBridgeStatusMessage
            )
        }
    }

    public func disconnect() {
        liveStore?.stopStreaming()
        liveStore = nil
        syncLocalBridgeStatus()
    }

    public func clearSavedAddress() {
        userDefaults.removeObject(forKey: defaultsKey)
        baseURLString = Self.defaultConnectionBaseURLString(
            surface: surface,
            fallbackBaseURLString: defaultBaseURLString,
            localBridgeManager: localBridgeManager
        )
        liveStore?.stopStreaming()
        liveStore = nil
        lastErrorMessage = nil
        syncLocalBridgeStatus()
    }

    private func persist(baseURLString: String) {
        let settings = DextunnelNativeConnectionSettings(baseURLString: baseURLString)
        if let data = try? JSONEncoder().encode(settings) {
            userDefaults.set(data, forKey: defaultsKey)
        }
    }

    private func connectStore(baseURL: URL) async throws -> DextunnelLiveBridgeStore {
        let bootstrapClient = DextunnelBridgeBootstrapClient(
            baseURL: baseURL,
            transport: DextunnelURLSessionTransport()
        )
        let bootstrap = try await bootstrapClient.fetchBootstrap(surface: surface)
        let session = DextunnelBridgeSession(baseURL: baseURL, bootstrap: bootstrap)
        let requests = DextunnelBridgeRequestFactory(session: session)
        let client = DextunnelBridgeClient(
            requests: requests,
            transport: DextunnelURLSessionTransport()
        )
        let runtime = DextunnelBridgeRuntime(
            client: client,
            eventStreamer: DextunnelURLSessionEventStreamer(),
            requests: requests,
            surfaceClientId: bootstrap.clientId
        )
        let store = DextunnelLiveBridgeStore(service: runtime)
        await store.bootstrap()
        store.startStreaming()
        return store
    }

    private func applyConnectedStore(_ store: DextunnelLiveBridgeStore, baseURLString: String) {
        liveStore?.stopStreaming()
        liveStore = store
        lastErrorMessage = nil
        persist(baseURLString: baseURLString)
        syncLocalBridgeStatus()
    }

    private func shouldAttemptManagedBridgeLaunch(after error: Error, requestedBaseURL: URL) -> Bool {
        guard surface == .host, localBridgeManager?.isAvailable == true else {
            return false
        }
        guard let urlError = error as? URLError, Self.hostConnectCodes.contains(urlError.code) else {
            return false
        }

        let requestedHost = requestedBaseURL.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if Self.isLoopbackHost(requestedHost) {
            return true
        }

        let managedHost = localBridgeManager?
            .managedBaseURL(for: requestedBaseURL)?
            .host?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        return requestedHost == managedHost
    }

    private func syncLocalBridgeStatus() {
        localBridgeStatusMessage = localBridgeManager?.statusMessage
    }

    static func presentedErrorMessage(
        for error: Error,
        surface: DextunnelSurfaceKind,
        bridgeURLString: String,
        localBridgeStatusMessage: String? = nil
    ) -> String {
        let url = URL(string: bridgeURLString.trimmingCharacters(in: .whitespacesAndNewlines))
        let host = url?.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if let urlError = error as? URLError {
            if surface == .remote, isLoopbackHost(host), remoteLoopbackCodes.contains(urlError.code) {
                return "Use your Mac's LAN or Tailscale bridge address here, not 127.0.0.1. Start Dextunnel with `npm run start:network`, then connect to `http://<your-mac-ip>:4317`."
            }

            if surface == .host, host != nil, isLoopbackHost(host), hostConnectCodes.contains(urlError.code) {
                let policyTail = localBridgeStatusMessage.map { " \($0)" } ?? ""
                return "Couldn't reach the local Dextunnel bridge.\(policyTail) You can still run `npm start` or `npm run start:network` manually, then try Connect again."
            }

            if surface == .remote, remoteConnectCodes.contains(urlError.code) {
                return "Couldn't reach the Dextunnel bridge at \(bridgeURLString). Make sure the bridge is running on the Mac and bound to a reachable LAN or Tailscale address."
            }
        }

        return DextunnelBridgeErrorFormatting.message(for: error)
    }

    static func presentedManagedBridgeErrorMessage(
        _ error: Error,
        bridgeURLString: String,
        fallbackStatusMessage: String?
    ) -> String {
        let detail = DextunnelBridgeErrorFormatting.message(for: error)
        if let fallbackStatusMessage, !fallbackStatusMessage.isEmpty, !detail.contains(fallbackStatusMessage) {
            return "\(detail) \(fallbackStatusMessage) You can still use `npm start` or `npm run start:network` manually for the repo CLI path."
        }
        return "\(detail) You can still use `npm start` or `npm run start:network` manually for the repo CLI path."
    }

    private static let remoteLoopbackCodes: Set<URLError.Code> = [
        .badServerResponse,
        .cannotConnectToHost,
        .networkConnectionLost,
        .timedOut
    ]

    private static let hostConnectCodes: Set<URLError.Code> = [
        .cannotConnectToHost,
        .networkConnectionLost,
        .timedOut
    ]

    private static let remoteConnectCodes: Set<URLError.Code> = [
        .cannotConnectToHost,
        .networkConnectionLost,
        .timedOut,
        .notConnectedToInternet
    ]

    private static func isLoopbackHost(_ host: String?) -> Bool {
        guard let host else {
            return false
        }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    private static func defaultConnectionBaseURLString(
        surface: DextunnelSurfaceKind,
        fallbackBaseURLString: String,
        localBridgeManager: DextunnelLocalBridgeManaging?
    ) -> String {
        guard
            surface == .host,
            let fallbackURL = URL(string: fallbackBaseURLString),
            let managedBaseURL = localBridgeManager?.managedBaseURL(for: fallbackURL)
        else {
            return fallbackBaseURLString
        }
        return managedBaseURL.absoluteString
    }

    private static func defaultLocalBridgeManager(
        for surface: DextunnelSurfaceKind
    ) -> DextunnelLocalBridgeManaging? {
        #if os(macOS)
        if surface == .host {
            return DextunnelLocalBridgeManager()
        }
        #endif
        return nil
    }
}
