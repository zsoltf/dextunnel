import Foundation
import Testing
@testable import DextunnelNativeAppSupport
@testable import DextunnelAppleState
@testable import DextunnelBridgeProtocol

private actor FakeNotificationTransport: DextunnelLocalNotificationTransport {
    struct Delivery: Equatable, Sendable {
        let body: String
        let identifier: String
        let title: String
    }

    private(set) var authorizationRequests = 0
    private(set) var deliveries: [Delivery] = []

    func requestAuthorizationIfNeeded() async {
        authorizationRequests += 1
    }

    func deliver(identifier: String, title: String, body: String) async {
        deliveries.append(Delivery(body: body, identifier: identifier, title: title))
    }
}

@MainActor
private final class FakeLocalBridgeManager: DextunnelLocalBridgeManaging {
    var isAvailable: Bool
    var isRunning = false
    var statusMessage: String?
    var managedURL: URL?
    private(set) var startedBaseURLs: [URL] = []

    init(
        isAvailable: Bool,
        statusMessage: String?,
        managedURL: URL?
    ) {
        self.isAvailable = isAvailable
        self.statusMessage = statusMessage
        self.managedURL = managedURL
    }

    func managedBaseURL(for requestedBaseURL: URL) -> URL? {
        managedURL
    }

    func start(baseURL: URL) async throws {
        startedBaseURLs.append(baseURL)
        isRunning = true
    }

    func stop() {
        isRunning = false
    }
}

@MainActor
@Test
func nativeBridgeControllerLoadsPersistedBaseURL() {
    let defaults = UserDefaults(suiteName: "DextunnelNativeAppSupportTests")!
    defaults.removePersistentDomain(forName: "DextunnelNativeAppSupportTests")
    let payload = try! JSONEncoder().encode(
        DextunnelNativeConnectionSettings(baseURLString: "http://192.168.64.1:4317")
    )
    defaults.set(payload, forKey: "dextunnel.native.connection.remote")

    let controller = DextunnelNativeBridgeController(
        surface: .remote,
        userDefaults: defaults,
        defaultBaseURLString: "http://127.0.0.1:4317"
    )

    #expect(controller.baseURLString == "http://192.168.64.1:4317")
    controller.clearSavedAddress()
}

@MainActor
@Test
func nativeBridgeControllerPrefersManagedTailscaleAddressForHostSurface() {
    let defaults = UserDefaults(suiteName: "DextunnelNativeAppSupportTests.ManagedHost")!
    defaults.removePersistentDomain(forName: "DextunnelNativeAppSupportTests.ManagedHost")
    let manager = FakeLocalBridgeManager(
        isAvailable: true,
        statusMessage: "Tailscale ready. Dextunnel Host can start the managed bridge at http://100.64.0.8:4317.",
        managedURL: URL(string: "http://100.64.0.8:4317")
    )

    let controller = DextunnelNativeBridgeController(
        surface: .host,
        userDefaults: defaults,
        defaultBaseURLString: "http://127.0.0.1:4317",
        localBridgeManager: manager
    )

    #expect(controller.baseURLString == "http://100.64.0.8:4317")
    #expect(controller.setupPlaceholder == "http://100.64.0.8:4317")
    #expect(controller.connectButtonTitle == "Start and connect")
    #expect(controller.setupHint.contains("Tailscale"))
}

@MainActor
@Test
func localBridgeManagerBuildsManagedCommandForTailscaleAddress() throws {
    let fileManager = FileManager.default
    let tempRoot = fileManager.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try fileManager.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: tempRoot.appending(path: "src", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: tempRoot.appending(path: "public", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try "{}".data(using: .utf8)!.write(to: tempRoot.appending(path: "package.json"))
    try "".data(using: .utf8)!.write(to: tempRoot.appending(path: "src/server.mjs"))
    try "<html></html>".data(using: .utf8)!.write(to: tempRoot.appending(path: "public/remote.html"))

    let nodeURL = tempRoot.appending(path: "node")
    try "#!/bin/sh\nexit 0\n".data(using: .utf8)!.write(to: nodeURL)
    try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodeURL.path)

    let command = DextunnelLocalBridgeManager.makeDefaultCommand(
        environment: [
            "DEXTUNNEL_REPO_ROOT": tempRoot.path,
            "DEXTUNNEL_NODE_BINARY": nodeURL.path
        ],
        fileManager: fileManager,
        compileTimeFilePath: tempRoot.appending(path: "native/apple/Sources/DextunnelNativeAppSupport/LocalBridgeManager.swift").path,
        tailscaleInstalled: true,
        tailscaleIPv4Address: "100.64.0.8"
    )

    #expect(command?.executableURL == nodeURL)
    #expect(command?.environment["DEXTUNNEL_HOST"] == "100.64.0.8")
    #expect(command?.baseURL.absoluteString == "http://100.64.0.8:4317")
}

@MainActor
@Test
func localBridgeManagerPrefersEmbeddedBridgeRuntimeWhenAvailable() throws {
    let fileManager = FileManager.default
    let tempRoot = fileManager.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    let embeddedRoot = tempRoot.appending(path: "EmbeddedBridge", directoryHint: .isDirectory)
    try fileManager.createDirectory(at: embeddedRoot.appending(path: "src", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: embeddedRoot.appending(path: "public", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: embeddedRoot.appending(path: "bin", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try "{}".data(using: .utf8)!.write(to: embeddedRoot.appending(path: "package.json"))
    try "".data(using: .utf8)!.write(to: embeddedRoot.appending(path: "src/server.mjs"))
    try "<html></html>".data(using: .utf8)!.write(to: embeddedRoot.appending(path: "public/remote.html"))

    let bundledNodeURL = embeddedRoot.appending(path: "bin/node")
    try "#!/bin/sh\nexit 0\n".data(using: .utf8)!.write(to: bundledNodeURL)
    try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: bundledNodeURL.path)

    let command = DextunnelLocalBridgeManager.makeDefaultCommand(
        environment: [:],
        fileManager: fileManager,
        compileTimeFilePath: "/tmp/LocalBridgeManager.swift",
        bundleResourceURL: tempRoot,
        tailscaleInstalled: true,
        tailscaleIPv4Address: "100.64.0.8"
    )

    #expect(command?.repoRootURL.path == embeddedRoot.path)
    #expect(command?.executableURL == bundledNodeURL)
}

@MainActor
@Test
func localBridgeManagerRequiresTailscaleForManagedLaunch() throws {
    let fileManager = FileManager.default
    let tempRoot = fileManager.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try fileManager.createDirectory(at: tempRoot, withIntermediateDirectories: true)
    try fileManager.createDirectory(at: tempRoot.appending(path: "src", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try fileManager.createDirectory(at: tempRoot.appending(path: "public", directoryHint: .isDirectory), withIntermediateDirectories: true)
    try "{}".data(using: .utf8)!.write(to: tempRoot.appending(path: "package.json"))
    try "".data(using: .utf8)!.write(to: tempRoot.appending(path: "src/server.mjs"))
    try "<html></html>".data(using: .utf8)!.write(to: tempRoot.appending(path: "public/remote.html"))

    let nodeURL = tempRoot.appending(path: "node")
    try "#!/bin/sh\nexit 0\n".data(using: .utf8)!.write(to: nodeURL)
    try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodeURL.path)

    let availability = DextunnelLocalBridgeManager.makeDefaultAvailability(
        environment: [
            "DEXTUNNEL_REPO_ROOT": tempRoot.path,
            "DEXTUNNEL_NODE_BINARY": nodeURL.path
        ],
        fileManager: fileManager,
        compileTimeFilePath: tempRoot.appending(path: "native/apple/Sources/DextunnelNativeAppSupport/LocalBridgeManager.swift").path,
        tailscaleInstalled: false,
        tailscaleIPv4Address: nil
    )

    #expect(availability.command == nil)
    #expect(availability.issue == .missingTailscale)
    #expect(availability.statusMessage.contains("Install Tailscale"))
}

@MainActor
@Test
func localNotificationCoordinatorNotifiesPendingAndFailedSignalsOnce() async {
    let transport = FakeNotificationTransport()
    let coordinator = DextunnelLocalNotificationCoordinator(transport: transport)
    let snapshot = DextunnelStoreNotificationSnapshot(
        roomTitle: "#dextunnel",
        pendingInteractionDetail: "Approve the next command.",
        pendingInteractionId: "pending-1",
        pendingInteractionTitle: "Action needed",
        failedDraftError: "Bridge connection dropped.",
        failedDraftId: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"),
        failedDraftText: "keep going"
    )

    await coordinator.update(with: snapshot, notificationsEnabled: true)
    await coordinator.update(with: snapshot, notificationsEnabled: true)

    let deliveries = await transport.deliveries
    #expect(await transport.authorizationRequests == 1)
    #expect(deliveries.count == 2)
    #expect(deliveries.map(\.title) == [
        "Action needed in #dextunnel",
        "Retry needed in #dextunnel"
    ])
}

@MainActor
@Test
func localNotificationCoordinatorWaitsUntilAlertsAreEnabled() async {
    let transport = FakeNotificationTransport()
    let coordinator = DextunnelLocalNotificationCoordinator(transport: transport)
    let snapshot = DextunnelStoreNotificationSnapshot(
        roomTitle: "#bootstrap",
        pendingInteractionId: "pending-2",
        pendingInteractionTitle: "Need a response"
    )

    await coordinator.update(with: snapshot, notificationsEnabled: false)
    #expect(await transport.authorizationRequests == 0)
    #expect(await transport.deliveries.isEmpty)

    await coordinator.update(with: snapshot, notificationsEnabled: true)
    let deliveries = await transport.deliveries
    #expect(await transport.authorizationRequests == 1)
    #expect(deliveries.count == 1)
    #expect(deliveries.first?.identifier == "pending.pending-2")
}

@MainActor
@Test
func nativeBridgeControllerExplainsLoopbackForRemoteSurface() {
    let error = URLError(.cannotConnectToHost)
    let message = DextunnelNativeBridgeController.presentedErrorMessage(
        for: error,
        surface: .remote,
        bridgeURLString: "http://127.0.0.1:4317"
    )

    #expect(message.contains("LAN or Tailscale"))
    #expect(message.contains("start:network"))
}

@MainActor
@Test
func nativeBridgeControllerExplainsLocalBridgeForHostSurface() {
    let error = URLError(.cannotConnectToHost)
    let message = DextunnelNativeBridgeController.presentedErrorMessage(
        for: error,
        surface: .host,
        bridgeURLString: "http://127.0.0.1:4317",
        localBridgeStatusMessage: "Install Tailscale before Dextunnel Host starts the managed bridge."
    )

    #expect(message.contains("Install Tailscale"))
    #expect(message.contains("npm start"))
}
