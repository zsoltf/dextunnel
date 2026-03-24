import Foundation

@MainActor
public protocol DextunnelLocalBridgeManaging: AnyObject {
    var isAvailable: Bool { get }
    var isRunning: Bool { get }
    var statusMessage: String? { get }
    var tailscaleInstalled: Bool { get }
    var tailscaleConnected: Bool { get }

    func managedBaseURL(for requestedBaseURL: URL) -> URL?
    func managedRemoteBaseURL(for requestedBaseURL: URL) -> URL?
    func start(baseURL: URL) async throws
    func stop()
}

#if os(macOS)
struct DextunnelTailscaleStatus: Equatable, Sendable {
    let dnsName: String?
    let ipv4Address: String?

    var trimmedDNSName: String? {
        guard var dnsName else {
            return nil
        }
        while dnsName.hasSuffix(".") {
            dnsName.removeLast()
        }
        return dnsName.isEmpty ? nil : dnsName
    }
}

struct DextunnelLocalBridgeCommand: Equatable, Sendable {
    let executableURL: URL
    let arguments: [String]
    var environment: [String: String]
    let repoRootURL: URL
    let baseURL: URL
    let remoteBaseURL: URL
    let tailscaleExecutableURL: URL
}

struct DextunnelLocalBridgeAvailability: Equatable, Sendable {
    let command: DextunnelLocalBridgeCommand?
    let issue: DextunnelLocalBridgeLaunchError?
    let statusMessage: String
    let tailscaleInstalled: Bool
    let tailscaleConnected: Bool
    let tailscaleRemoteBaseURL: URL?
}

enum DextunnelLocalBridgeLaunchError: LocalizedError, Equatable {
    case missingNode
    case missingRepoRoot
    case missingTailscale
    case tailscaleAddressUnavailable
    case tailscaleServeConflict(String)
    case tailscaleServeConfigurationFailed(String)
    case failedToStart(String)
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .missingNode:
            return "Couldn't find a local Node binary for the repo bridge."
        case .missingRepoRoot:
            return "Couldn't find the Dextunnel repo root needed to launch the local bridge."
        case .missingTailscale:
            return "Install Tailscale before Dextunnel Host can run."
        case .tailscaleAddressUnavailable:
            return "Tailscale is installed, but this Mac is not ready for a tailnet share yet."
        case .tailscaleServeConflict(let detail):
            return detail
        case .tailscaleServeConfigurationFailed(let detail):
            return detail
        case .failedToStart(let detail):
            return detail
        case .timedOut(let detail):
            return detail
        }
    }
}

@MainActor
public final class DextunnelLocalBridgeManager: DextunnelLocalBridgeManaging {
    public private(set) var statusMessage: String?
    public var isRunning: Bool { process?.isRunning == true }
    public var isAvailable: Bool {
        availability.command != nil
    }
    public var tailscaleInstalled: Bool {
        availability.tailscaleInstalled
    }
    public var tailscaleConnected: Bool {
        availability.tailscaleConnected
    }

    private let availabilityResolver: () -> DextunnelLocalBridgeAvailability
    private let processFactory: () -> Process
    private let session: URLSession
    private var availability: DextunnelLocalBridgeAvailability
    private var process: Process?
    private var startupLogTail: [String] = []

    init(
        availabilityResolver: @escaping () -> DextunnelLocalBridgeAvailability = {
            DextunnelLocalBridgeManager.makeDefaultAvailability()
        },
        processFactory: @escaping () -> Process = Process.init,
        session: URLSession = .shared
    ) {
        let initialAvailability = availabilityResolver()
        self.availabilityResolver = availabilityResolver
        self.processFactory = processFactory
        self.session = session
        self.availability = initialAvailability
        self.statusMessage = initialAvailability.statusMessage
    }

    public func managedBaseURL(for requestedBaseURL: URL) -> URL? {
        let availability = self.availability
        guard let baseURL = availability.command?.baseURL else {
            return nil
        }

        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return baseURL
        }

        if let requestedComponents = URLComponents(url: requestedBaseURL, resolvingAgainstBaseURL: false) {
            if let port = requestedComponents.port {
                components.port = port
            }
            if let scheme = requestedComponents.scheme, !scheme.isEmpty {
                components.scheme = scheme
            }
        }

        return components.url
    }

    public func managedRemoteBaseURL(for requestedBaseURL: URL) -> URL? {
        availability.command?.remoteBaseURL
    }

    public func start(baseURL: URL) async throws {
        if process?.isRunning == true {
            let runningURL = managedBaseURL(for: baseURL) ?? baseURL
            let remoteURL = managedRemoteBaseURL(for: baseURL)
            statusMessage = runningStatusMessage(localBaseURL: runningURL, remoteBaseURL: remoteURL)
            return
        }

        let availability = refreshAvailability()
        guard var command = availability.command else {
            statusMessage = availability.statusMessage
            throw availability.issue ?? DextunnelLocalBridgeLaunchError.missingRepoRoot
        }
        let effectiveBaseURL = managedBaseURL(for: baseURL) ?? baseURL
        let effectiveRemoteBaseURL = managedRemoteBaseURL(for: baseURL)
        command.environment["DEXTUNNEL_HOST"] = effectiveBaseURL.host ?? command.baseURL.host
        if let port = effectiveBaseURL.port {
            command.environment["PORT"] = String(port)
        }

        startupLogTail = []
        let process = processFactory()
        let pipe = Pipe()
        process.executableURL = command.executableURL
        process.arguments = command.arguments
        process.currentDirectoryURL = command.repoRootURL
        process.environment = command.environment
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else {
                return
            }

            Task { @MainActor in
                self?.appendStartupLog(text)
            }
        }
        process.terminationHandler = { [weak self] terminated in
            Task { @MainActor in
                self?.handleTermination(terminated)
            }
        }

        statusMessage = "Starting Dextunnel Host locally at \(effectiveBaseURL.absoluteString)..."
        do {
            try process.run()
            self.process = process
        } catch {
            let detail = "Failed to start the managed bridge process: \(error.localizedDescription)"
            statusMessage = detail
            throw DextunnelLocalBridgeLaunchError.failedToStart(detail)
        }

        do {
            try await waitUntilReachable(baseURL: effectiveBaseURL)
            try ensureManagedServe(localBaseURL: effectiveBaseURL, remoteBaseURL: effectiveRemoteBaseURL, command: command)
            statusMessage = runningStatusMessage(localBaseURL: effectiveBaseURL, remoteBaseURL: effectiveRemoteBaseURL)
        } catch {
            stop()
            let tail = startupLogTail.last.map { " Last log: \($0)" } ?? ""
            if let launchError = error as? DextunnelLocalBridgeLaunchError {
                statusMessage = launchError.localizedDescription
                throw launchError
            }

            let detail = "The managed bridge did not become reachable in time.\(tail)"
            statusMessage = detail
            throw DextunnelLocalBridgeLaunchError.timedOut(detail)
        }
    }

    public func stop() {
        if let process, process.isRunning {
            process.terminate()
        }
        self.process = nil

        if let command = availability.command {
            do {
                try stopManagedServeIfNeeded(command: command)
            } catch {
                startupLogTail.append("tailscale serve cleanup failed: \(error.localizedDescription)")
                if startupLogTail.count > 8 {
                    startupLogTail = Array(startupLogTail.suffix(8))
                }
            }
        }

        let refreshedAvailability = refreshAvailability()
        statusMessage = refreshedAvailability.statusMessage
    }

    private func appendStartupLog(_ text: String) {
        let lines = text
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        startupLogTail.append(contentsOf: lines)
        if startupLogTail.count > 8 {
            startupLogTail = Array(startupLogTail.suffix(8))
        }
    }

    private func handleTermination(_ terminated: Process) {
        guard process === terminated else {
            return
        }

        process = nil
        statusMessage = refreshAvailability().statusMessage
    }

    private func waitUntilReachable(baseURL: URL) async throws {
        let deadline = Date().addingTimeInterval(10)
        let target = baseURL.appending(path: "api/preflight").appending(queryItems: [
            URLQueryItem(name: "warmup", value: "0")
        ])

        while Date() < deadline {
            do {
                let (_, response) = try await session.data(from: target)
                if let http = response as? HTTPURLResponse, (200..<500).contains(http.statusCode) {
                    return
                }
            } catch {
                // Retry until the deadline expires.
            }

            try await Task.sleep(for: .milliseconds(250))
        }

        throw DextunnelLocalBridgeLaunchError.timedOut("Timed out waiting for the local bridge to answer \(target.absoluteString).")
    }

    static func makeDefaultAvailability(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        compileTimeFilePath: String = #filePath,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        tailscaleInstalled: Bool? = nil,
        tailscaleIPv4Address: String? = nil,
        tailscaleDNSName: String? = nil,
        tailscaleServeStatusData: Data? = nil
    ) -> DextunnelLocalBridgeAvailability {
        let tailscaleExecutable = defaultTailscaleExecutable(environment: environment, fileManager: fileManager)
        let resolvedTailscaleExecutable = tailscaleExecutable ?? URL(fileURLWithPath: "/usr/bin/true")
        let hasTailscale = tailscaleInstalled ?? (tailscaleExecutable != nil)
        guard hasTailscale else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .missingTailscale,
                statusMessage: "Dextunnel Host requires Tailscale on this Mac.",
                tailscaleInstalled: false,
                tailscaleConnected: false,
                tailscaleRemoteBaseURL: nil
            )
        }

        let resolvedTailscaleStatus = defaultTailscaleStatus(
            executableURL: tailscaleExecutable,
            environment: environment
        ) ?? DextunnelTailscaleStatus(dnsName: tailscaleDNSName, ipv4Address: tailscaleIPv4Address)
        guard let tailscaleDNSName = resolvedTailscaleStatus.trimmedDNSName, !tailscaleDNSName.isEmpty else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .tailscaleAddressUnavailable,
                statusMessage: "Open Tailscale and connect this Mac to your tailnet before starting Dextunnel Host.",
                tailscaleInstalled: true,
                tailscaleConnected: false,
                tailscaleRemoteBaseURL: nil
            )
        }

        var launchEnvironment = environment
        launchEnvironment["PATH"] = mergedSearchPath(environment: environment)
        launchEnvironment["DEXTUNNEL_HOST"] = "127.0.0.1"

        let port = Int(environment["PORT"] ?? "") ?? 4317
        let baseURL = URL(string: "http://127.0.0.1:\(port)")!
        let existingServeStatus = tailscaleServeStatusData.flatMap { try? DextunnelServeStatus(data: $0) }
            ?? (try? readServeStatus(
                executableURL: resolvedTailscaleExecutable,
                environment: launchEnvironment,
                processFactory: Process.init
            ))
        let remoteBaseURL = preferredRemoteBaseURL(
            dnsName: tailscaleDNSName,
            localPort: port,
            existingServeStatus: existingServeStatus,
            desiredProxy: baseURL.absoluteString
        )
        if let embeddedCommand = embeddedBridgeCommand(
            baseURL: baseURL,
            remoteBaseURL: remoteBaseURL,
            tailscaleExecutableURL: resolvedTailscaleExecutable,
            bundleResourceURL: bundleResourceURL,
            environment: launchEnvironment,
            fileManager: fileManager
        ) {
            return DextunnelLocalBridgeAvailability(
                command: embeddedCommand,
                issue: nil,
                statusMessage: "Tailscale ready. Dextunnel Host can run locally at \(baseURL.absoluteString) and share the remote at \(remoteBaseURL.absoluteString).",
                tailscaleInstalled: true,
                tailscaleConnected: true,
                tailscaleRemoteBaseURL: remoteBaseURL
            )
        }

        guard let repoRootURL = defaultRepoRoot(
            environment: environment,
            fileManager: fileManager,
            compileTimeFilePath: compileTimeFilePath
        ) else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .missingRepoRoot,
                statusMessage: "Local bridge launch is unavailable from this build.",
                tailscaleInstalled: true,
                tailscaleConnected: true,
                tailscaleRemoteBaseURL: remoteBaseURL
            )
        }

        guard let nodeURL = defaultNodeExecutable(environment: environment, fileManager: fileManager) else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .missingNode,
                statusMessage: "Install Node, or point DEXTUNNEL_NODE_BINARY at it, before Dextunnel Host starts the managed bridge.",
                tailscaleInstalled: true,
                tailscaleConnected: true,
                tailscaleRemoteBaseURL: remoteBaseURL
            )
        }

        let command = DextunnelLocalBridgeCommand(
            executableURL: nodeURL,
            arguments: ["src/server.mjs"],
            environment: launchEnvironment,
            repoRootURL: repoRootURL,
            baseURL: baseURL,
            remoteBaseURL: remoteBaseURL,
            tailscaleExecutableURL: resolvedTailscaleExecutable
        )
        return DextunnelLocalBridgeAvailability(
            command: command,
            issue: nil,
            statusMessage: "Tailscale ready. Dextunnel Host can run locally at \(baseURL.absoluteString) and share the remote at \(remoteBaseURL.absoluteString).",
            tailscaleInstalled: true,
            tailscaleConnected: true,
            tailscaleRemoteBaseURL: remoteBaseURL
        )
    }

    static func makeDefaultCommand(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        compileTimeFilePath: String = #filePath,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        tailscaleInstalled: Bool? = nil,
        tailscaleIPv4Address: String? = nil,
        tailscaleDNSName: String? = nil,
        tailscaleServeStatusData: Data? = nil
    ) -> DextunnelLocalBridgeCommand? {
        makeDefaultAvailability(
            environment: environment,
            fileManager: fileManager,
            compileTimeFilePath: compileTimeFilePath,
            bundleResourceURL: bundleResourceURL,
            tailscaleInstalled: tailscaleInstalled,
            tailscaleIPv4Address: tailscaleIPv4Address,
            tailscaleDNSName: tailscaleDNSName,
            tailscaleServeStatusData: tailscaleServeStatusData
        ).command
    }

    static func defaultRepoRoot(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        compileTimeFilePath: String = #filePath
    ) -> URL? {
        let explicit = String(environment["DEXTUNNEL_REPO_ROOT"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !explicit.isEmpty {
            let url = URL(fileURLWithPath: explicit, isDirectory: true)
            if repoRootLooksValid(url, fileManager: fileManager) {
                return url
            }
        }

        let candidates = [
            URL(fileURLWithPath: compileTimeFilePath, isDirectory: false).deletingLastPathComponent(),
            URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
        ]

        for candidate in candidates {
            var probe = candidate
            for _ in 0..<8 {
                if repoRootLooksValid(probe, fileManager: fileManager) {
                    return probe
                }
                let parent = probe.deletingLastPathComponent()
                if parent == probe {
                    break
                }
                probe = parent
            }
        }

        return nil
    }

    static func defaultNodeExecutable(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let explicit = [
            environment["DEXTUNNEL_NODE_BINARY"],
            environment["NODE_BINARY"]
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })

        if let explicit {
            let url = URL(fileURLWithPath: explicit)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        let pathEntries = String(environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let candidates = pathEntries + ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin"]
        for candidate in candidates {
            let url = URL(fileURLWithPath: candidate, isDirectory: true).appending(path: "node")
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        return nil
    }

    static func defaultTailscaleExecutable(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let explicit = [
            environment["DEXTUNNEL_TAILSCALE_BINARY"],
            environment["TAILSCALE_BINARY"]
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })

        if let explicit {
            let url = URL(fileURLWithPath: explicit)
            if fileManager.isExecutableFile(atPath: url.path) {
                return url
            }
        }

        let candidates = mergedSearchPathEntries(environment: environment) + [
            "/Applications/Tailscale.app/Contents/MacOS",
            "/Applications/Setapp/Tailscale.app/Contents/MacOS"
        ]
        let executableNames = ["tailscale", "Tailscale"]
        for candidate in candidates {
            for executableName in executableNames {
                let url = URL(fileURLWithPath: candidate, isDirectory: true).appending(path: executableName)
                if fileManager.isExecutableFile(atPath: url.path) {
                    return url
                }
            }
        }

        return nil
    }

    static func defaultTailscaleStatus(
        executableURL: URL?,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        processFactory: () -> Process = Process.init
    ) -> DextunnelTailscaleStatus? {
        guard let executableURL else {
            return nil
        }

        do {
            let data = try runCommand(
                executableURL: executableURL,
                arguments: ["status", "--json"],
                environment: environment,
                processFactory: processFactory
            )
            let payload = try JSONDecoder().decode(DextunnelTailscaleStatusPayload.self, from: data)
            let ipv4Address = (payload.tailscaleIPs ?? payload.selfNode?.tailscaleIPs ?? [])
                .first(where: { $0.contains(".") })
            return DextunnelTailscaleStatus(
                dnsName: payload.selfNode?.dnsName,
                ipv4Address: ipv4Address
            )
        } catch {
            return nil
        }
    }

    private static func mergedSearchPath(environment: [String: String]) -> String {
        mergedSearchPathEntries(environment: environment).joined(separator: ":")
    }

    private static func mergedSearchPathEntries(environment: [String: String]) -> [String] {
        let existingPath = String(environment["PATH"] ?? "")
        let commonPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/bin"]
        return ([existingPath] + commonPaths)
            .flatMap { $0.split(separator: ":").map(String.init) }
            .filter { !$0.isEmpty }
            .reduce(into: [String]()) { partialResult, value in
                if !partialResult.contains(value) {
                    partialResult.append(value)
                }
            }
    }

    private static func embeddedBridgeCommand(
        baseURL: URL,
        remoteBaseURL: URL,
        tailscaleExecutableURL: URL,
        bundleResourceURL: URL?,
        environment: [String: String],
        fileManager: FileManager
    ) -> DextunnelLocalBridgeCommand? {
        guard let bridgeRootURL = defaultEmbeddedBridgeRoot(
            bundleResourceURL: bundleResourceURL,
            fileManager: fileManager
        ) else {
            return nil
        }

        let nodeURL = bridgeRootURL.appending(path: "bin/node")
        guard fileManager.isExecutableFile(atPath: nodeURL.path) else {
            return nil
        }

        return DextunnelLocalBridgeCommand(
            executableURL: nodeURL,
            arguments: ["src/server.mjs"],
            environment: environment,
            repoRootURL: bridgeRootURL,
            baseURL: baseURL,
            remoteBaseURL: remoteBaseURL,
            tailscaleExecutableURL: tailscaleExecutableURL
        )
    }

    private func refreshAvailability() -> DextunnelLocalBridgeAvailability {
        let refreshedAvailability = availabilityResolver()
        availability = refreshedAvailability
        return refreshedAvailability
    }

    private func runningStatusMessage(localBaseURL: URL, remoteBaseURL: URL?) -> String {
        if let remoteBaseURL {
            return "Dextunnel Host is running locally at \(localBaseURL.absoluteString) and shared on Tailscale at \(remoteBaseURL.absoluteString)."
        }
        return "Dextunnel Host is running locally at \(localBaseURL.absoluteString)."
    }

    private func ensureManagedServe(
        localBaseURL: URL,
        remoteBaseURL: URL?,
        command: DextunnelLocalBridgeCommand
    ) throws {
        guard let remoteBaseURL else {
            throw DextunnelLocalBridgeLaunchError.tailscaleAddressUnavailable
        }
        guard let localPort = localBaseURL.port else {
            throw DextunnelLocalBridgeLaunchError.tailscaleServeConfigurationFailed(
                "Dextunnel Host couldn't determine the Tailscale Serve port."
            )
        }
        let remotePort = Self.servePort(for: remoteBaseURL)

        let desiredAuthority = Self.serveAuthority(for: remoteBaseURL)
        let desiredProxy = localBaseURL.absoluteString
        var currentStatus = try Self.readServeStatus(
            executableURL: command.tailscaleExecutableURL,
            environment: command.environment,
            processFactory: processFactory
        )

        let legacyAuthority = Self.legacyServeAuthority(for: remoteBaseURL, legacyPort: localPort)
        if
            legacyAuthority != desiredAuthority,
            currentStatus.rootProxyByAuthority[legacyAuthority] == desiredProxy
        {
            do {
                _ = try Self.runCommand(
                    executableURL: command.tailscaleExecutableURL,
                    arguments: ["serve", "--https=\(localPort)", "off"],
                    environment: command.environment,
                    processFactory: processFactory
                )
                currentStatus = try Self.readServeStatus(
                    executableURL: command.tailscaleExecutableURL,
                    environment: command.environment,
                    processFactory: processFactory
                )
            } catch {
                throw DextunnelLocalBridgeLaunchError.tailscaleServeConfigurationFailed(
                    "Dextunnel Host couldn't replace the old Tailscale Serve port mapping: \(error.localizedDescription)"
                )
            }
        }

        if let existingProxy = currentStatus.rootProxyByAuthority[desiredAuthority] {
            if existingProxy == desiredProxy {
                return
            }
            throw DextunnelLocalBridgeLaunchError.tailscaleServeConflict(
                "Tailscale Serve is already using \(remoteBaseURL.absoluteString) for another proxy."
            )
        }

        if currentStatus.ports.contains(remotePort) {
            throw DextunnelLocalBridgeLaunchError.tailscaleServeConflict(
                "Tailscale Serve is already using port \(remotePort). Clear that config before starting Dextunnel Host."
            )
        }

        do {
            _ = try Self.runCommand(
                executableURL: command.tailscaleExecutableURL,
                arguments: ["serve", "--https=\(remotePort)", "--bg", "--yes", "\(localPort)"],
                environment: command.environment,
                processFactory: processFactory
            )
        } catch {
            throw DextunnelLocalBridgeLaunchError.tailscaleServeConfigurationFailed(
                "Dextunnel Host couldn't configure Tailscale Serve: \(error.localizedDescription)"
            )
        }

        let updatedStatus = try Self.readServeStatus(
            executableURL: command.tailscaleExecutableURL,
            environment: command.environment,
            processFactory: processFactory
        )
        guard updatedStatus.rootProxyByAuthority[desiredAuthority] == desiredProxy else {
            throw DextunnelLocalBridgeLaunchError.tailscaleServeConfigurationFailed(
                "Tailscale Serve did not publish \(remoteBaseURL.absoluteString) for Dextunnel Host."
            )
        }

        if
            legacyAuthority != desiredAuthority,
            updatedStatus.rootProxyByAuthority[legacyAuthority] == desiredProxy
        {
            do {
                _ = try Self.runCommand(
                    executableURL: command.tailscaleExecutableURL,
                    arguments: ["serve", "--https=\(localPort)", "off"],
                    environment: command.environment,
                    processFactory: processFactory
                )
            } catch {
                throw DextunnelLocalBridgeLaunchError.tailscaleServeConfigurationFailed(
                    "Dextunnel Host published the new Tailscale URL but couldn't remove the old port-based share: \(error.localizedDescription)"
                )
            }
        }
    }

    private func stopManagedServeIfNeeded(command: DextunnelLocalBridgeCommand) throws {
        let remotePort = Self.servePort(for: command.remoteBaseURL)
        let desiredAuthority = Self.serveAuthority(for: command.remoteBaseURL)
        let desiredProxy = command.baseURL.absoluteString
        let currentStatus = try Self.readServeStatus(
            executableURL: command.tailscaleExecutableURL,
            environment: command.environment,
            processFactory: processFactory
        )
        guard currentStatus.rootProxyByAuthority[desiredAuthority] == desiredProxy else {
            return
        }
        _ = try Self.runCommand(
            executableURL: command.tailscaleExecutableURL,
            arguments: ["serve", "--https=\(remotePort)", "off"],
            environment: command.environment,
            processFactory: processFactory
        )
    }

    private static func serveAuthority(for remoteBaseURL: URL) -> String {
        let host = remoteBaseURL.host?.lowercased() ?? remoteBaseURL.absoluteString.lowercased()
        if let port = remoteBaseURL.port {
            return "\(host):\(port)"
        }
        if remoteBaseURL.scheme?.lowercased() == "https" {
            return "\(host):443"
        }
        if remoteBaseURL.scheme?.lowercased() == "http" {
            return "\(host):80"
        }
        return host
    }

    private static func legacyServeAuthority(for remoteBaseURL: URL, legacyPort: Int) -> String {
        let host = remoteBaseURL.host?.lowercased() ?? remoteBaseURL.absoluteString.lowercased()
        return "\(host):\(legacyPort)"
    }

    private static func servePort(for remoteBaseURL: URL) -> Int {
        if let port = remoteBaseURL.port {
            return port
        }

        switch remoteBaseURL.scheme?.lowercased() {
        case "http":
            return 80
        default:
            return 443
        }
    }

    private static func preferredRemoteBaseURL(
        dnsName: String,
        localPort: Int,
        existingServeStatus: DextunnelServeStatus?,
        desiredProxy: String
    ) -> URL {
        let preferredPorts = [443, 8443, 9443]
        let status = existingServeStatus

        for port in preferredPorts {
            let authority = authority(host: dnsName, port: port)
            if status?.rootProxyByAuthority[authority] == desiredProxy {
                return remoteBaseURL(host: dnsName, port: port)
            }
        }

        for port in preferredPorts {
            if status?.ports.contains(port) != true {
                return remoteBaseURL(host: dnsName, port: port)
            }
        }

        if let status {
            let localAuthority = authority(host: dnsName, port: localPort)
            if status.rootProxyByAuthority[localAuthority] == desiredProxy || !status.ports.contains(localPort) {
                return remoteBaseURL(host: dnsName, port: localPort)
            }
        } else {
            return remoteBaseURL(host: dnsName, port: 443)
        }

        return remoteBaseURL(host: dnsName, port: localPort)
    }

    private static func remoteBaseURL(host: String, port: Int) -> URL {
        if port == 443 {
            return URL(string: "https://\(host)")!
        }
        return URL(string: "https://\(host):\(port)")!
    }

    private static func authority(host: String, port: Int) -> String {
        return "\(host.lowercased()):\(port)"
    }

    private static func readServeStatus(
        executableURL: URL,
        environment: [String: String],
        processFactory: () -> Process
    ) throws -> DextunnelServeStatus {
        let data = try runCommand(
            executableURL: executableURL,
            arguments: ["serve", "status", "--json"],
            environment: environment,
            processFactory: processFactory
        )
        return try DextunnelServeStatus(data: data)
    }

    private static func runCommand(
        executableURL: URL,
        arguments: [String],
        environment: [String: String],
        processFactory: () -> Process
    ) throws -> Data {
        let process = processFactory()
        let pipe = Pipe()
        process.executableURL = executableURL
        process.arguments = arguments
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = pipe

        try process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            let detail = String(decoding: data, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw DextunnelLocalBridgeLaunchError.failedToStart(
                detail.isEmpty
                    ? "Command failed: \(arguments.joined(separator: " "))"
                    : detail
            )
        }
        return data
    }

    private struct DextunnelTailscaleStatusPayload: Decodable {
        let tailscaleIPs: [String]?
        let selfNode: SelfNode?

        enum CodingKeys: String, CodingKey {
            case tailscaleIPs = "TailscaleIPs"
            case selfNode = "Self"
        }

        struct SelfNode: Decodable {
            let dnsName: String?
            let tailscaleIPs: [String]?

            enum CodingKeys: String, CodingKey {
                case dnsName = "DNSName"
                case tailscaleIPs = "TailscaleIPs"
            }
        }
    }

    private struct DextunnelServeStatus {
        let ports: Set<Int>
        let rootProxyByAuthority: [String: String]

        init(data: Data) throws {
            let object = try JSONSerialization.jsonObject(with: data, options: [])
            let dictionary = object as? [String: Any] ?? [:]

            var parsedPorts = Set<Int>()
            if let tcp = dictionary["TCP"] as? [String: Any] {
                for key in tcp.keys {
                    if let port = Int(key) {
                        parsedPorts.insert(port)
                    }
                }
            }

            var proxies: [String: String] = [:]
            if let web = dictionary["Web"] as? [String: Any] {
                for (authority, entryValue) in web {
                    guard
                        let entry = entryValue as? [String: Any],
                        let handlers = entry["Handlers"] as? [String: Any],
                        let rootEntry = handlers["/"] as? [String: Any],
                        let proxy = rootEntry["Proxy"] as? String
                    else {
                        continue
                    }
                    let normalizedAuthority = authority.lowercased()
                    proxies[normalizedAuthority] = proxy
                    if let port = Self.port(forAuthority: normalizedAuthority) {
                        parsedPorts.insert(port)
                    } else {
                        parsedPorts.insert(443)
                    }
                }
            }

            ports = parsedPorts
            rootProxyByAuthority = proxies
        }

        private static func port(forAuthority authority: String) -> Int? {
            URLComponents(string: "https://\(authority)")?.port
        }
    }

    static func defaultEmbeddedBridgeRoot(
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        fileManager: FileManager = .default
    ) -> URL? {
        guard let bundleResourceURL else {
            return nil
        }

        let candidates = [
            bundleResourceURL.appending(path: "EmbeddedBridge"),
            bundleResourceURL
        ]

        for candidate in candidates {
            if embeddedBridgeLooksValid(candidate, fileManager: fileManager) {
                return candidate
            }
        }

        return nil
    }

    private static func repoRootLooksValid(_ url: URL, fileManager: FileManager) -> Bool {
        let packagePath = url.appending(path: "package.json").path
        let serverPath = url.appending(path: "src/server.mjs").path
        let remotePath = url.appending(path: "public/remote.html").path
        return fileManager.fileExists(atPath: packagePath)
            && fileManager.fileExists(atPath: serverPath)
            && fileManager.fileExists(atPath: remotePath)
    }

    private static func embeddedBridgeLooksValid(_ url: URL, fileManager: FileManager) -> Bool {
        repoRootLooksValid(url, fileManager: fileManager)
            && fileManager.isExecutableFile(atPath: url.appending(path: "bin/node").path)
    }
}
#endif
