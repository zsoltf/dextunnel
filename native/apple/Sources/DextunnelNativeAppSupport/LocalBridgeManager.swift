import Foundation

@MainActor
public protocol DextunnelLocalBridgeManaging: AnyObject {
    var isAvailable: Bool { get }
    var isRunning: Bool { get }
    var statusMessage: String? { get }

    func managedBaseURL(for requestedBaseURL: URL) -> URL?
    func start(baseURL: URL) async throws
    func stop()
}

#if os(macOS)
struct DextunnelLocalBridgeCommand: Equatable, Sendable {
    let executableURL: URL
    let arguments: [String]
    var environment: [String: String]
    let repoRootURL: URL
    let baseURL: URL
}

struct DextunnelLocalBridgeAvailability: Equatable, Sendable {
    let command: DextunnelLocalBridgeCommand?
    let issue: DextunnelLocalBridgeLaunchError?
    let statusMessage: String
}

enum DextunnelLocalBridgeLaunchError: LocalizedError, Equatable {
    case missingNode
    case missingRepoRoot
    case missingTailscale
    case tailscaleAddressUnavailable
    case failedToStart(String)
    case timedOut(String)

    var errorDescription: String? {
        switch self {
        case .missingNode:
            return "Couldn't find a local Node binary for the repo bridge."
        case .missingRepoRoot:
            return "Couldn't find the Dextunnel repo root needed to launch the local bridge."
        case .missingTailscale:
            return "Install Tailscale before Dextunnel Host starts the managed bridge."
        case .tailscaleAddressUnavailable:
            return "Tailscale is installed, but this Mac is not connected to a tailnet address yet."
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
        availabilityResolver().command != nil
    }

    private let availabilityResolver: () -> DextunnelLocalBridgeAvailability
    private let processFactory: () -> Process
    private let session: URLSession
    private var process: Process?
    private var startupLogTail: [String] = []

    init(
        availabilityResolver: @escaping () -> DextunnelLocalBridgeAvailability = {
            DextunnelLocalBridgeManager.makeDefaultAvailability()
        },
        processFactory: @escaping () -> Process = Process.init,
        session: URLSession = .shared
    ) {
        self.availabilityResolver = availabilityResolver
        self.processFactory = processFactory
        self.session = session
        self.statusMessage = availabilityResolver().statusMessage
    }

    public func managedBaseURL(for requestedBaseURL: URL) -> URL? {
        let availability = availabilityResolver()
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

    public func start(baseURL: URL) async throws {
        if process?.isRunning == true {
            let runningURL = managedBaseURL(for: baseURL) ?? baseURL
            statusMessage = "Managed bridge already running at \(runningURL.absoluteString)."
            return
        }

        let availability = availabilityResolver()
        guard var command = availability.command else {
            statusMessage = availability.statusMessage
            throw availability.issue ?? DextunnelLocalBridgeLaunchError.missingRepoRoot
        }
        let effectiveBaseURL = managedBaseURL(for: baseURL) ?? baseURL
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

        statusMessage = "Starting the managed Tailscale bridge at \(effectiveBaseURL.absoluteString)..."
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
            statusMessage = "Managed Tailscale bridge running at \(effectiveBaseURL.absoluteString)."
        } catch {
            stop()
            let tail = startupLogTail.last.map { " Last log: \($0)" } ?? ""
            let detail = "The managed bridge did not become reachable in time.\(tail)"
            statusMessage = detail
            throw DextunnelLocalBridgeLaunchError.timedOut(detail)
        }
    }

    public func stop() {
        guard let process else {
            statusMessage = isAvailable
                ? availabilityResolver().statusMessage
                : availabilityResolver().statusMessage
            return
        }

        if process.isRunning {
            process.terminate()
        }
        self.process = nil
        statusMessage = "Stopped the app-managed Tailscale bridge."
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
        let code = terminated.terminationStatus
        statusMessage = code == 0
            ? "The app-managed Tailscale bridge stopped."
            : "The app-managed Tailscale bridge exited with code \(code)."
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
        tailscaleIPv4Address: String? = nil
    ) -> DextunnelLocalBridgeAvailability {
        let tailscaleExecutable = defaultTailscaleExecutable(environment: environment, fileManager: fileManager)
        let hasTailscale = tailscaleInstalled ?? (tailscaleExecutable != nil)
        guard hasTailscale else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .missingTailscale,
                statusMessage: "Install Tailscale before Dextunnel Host starts the managed bridge. Manual npm runs still work."
            )
        }

        let resolvedTailscaleAddress = tailscaleIPv4Address ?? defaultTailscaleIPv4Address(
            executableURL: tailscaleExecutable,
            environment: environment
        )
        guard let tailscaleAddress = resolvedTailscaleAddress, !tailscaleAddress.isEmpty else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .tailscaleAddressUnavailable,
                statusMessage: "Tailscale is installed, but this Mac is not connected to a tailnet address yet. Open Tailscale, then try again."
            )
        }

        var launchEnvironment = environment
        launchEnvironment["PATH"] = mergedSearchPath(environment: environment)
        launchEnvironment["DEXTUNNEL_HOST"] = tailscaleAddress

        let port = Int(environment["PORT"] ?? "") ?? 4317
        let baseURL = URL(string: "http://\(tailscaleAddress):\(port)")!
        if let embeddedCommand = embeddedBridgeCommand(
            baseURL: baseURL,
            bundleResourceURL: bundleResourceURL,
            environment: launchEnvironment,
            fileManager: fileManager
        ) {
            return DextunnelLocalBridgeAvailability(
                command: embeddedCommand,
                issue: nil,
                statusMessage: "Tailscale ready. Dextunnel Host can start its bundled bridge at \(baseURL.absoluteString)."
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
                statusMessage: "Local bridge launch is unavailable from this build."
            )
        }

        guard let nodeURL = defaultNodeExecutable(environment: environment, fileManager: fileManager) else {
            return DextunnelLocalBridgeAvailability(
                command: nil,
                issue: .missingNode,
                statusMessage: "Install Node, or point DEXTUNNEL_NODE_BINARY at it, before Dextunnel Host starts the managed bridge."
            )
        }

        let command = DextunnelLocalBridgeCommand(
            executableURL: nodeURL,
            arguments: ["src/server.mjs"],
            environment: launchEnvironment,
            repoRootURL: repoRootURL,
            baseURL: baseURL
        )
        return DextunnelLocalBridgeAvailability(
            command: command,
            issue: nil,
            statusMessage: "Tailscale ready. Dextunnel Host can start the repo bridge at \(baseURL.absoluteString)."
        )
    }

    static func makeDefaultCommand(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        compileTimeFilePath: String = #filePath,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        tailscaleInstalled: Bool? = nil,
        tailscaleIPv4Address: String? = nil
    ) -> DextunnelLocalBridgeCommand? {
        makeDefaultAvailability(
            environment: environment,
            fileManager: fileManager,
            compileTimeFilePath: compileTimeFilePath,
            bundleResourceURL: bundleResourceURL,
            tailscaleInstalled: tailscaleInstalled,
            tailscaleIPv4Address: tailscaleIPv4Address
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

    static func defaultTailscaleIPv4Address(
        executableURL: URL?,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        processFactory: () -> Process = Process.init
    ) -> String? {
        guard let executableURL else {
            return nil
        }

        let process = processFactory()
        let pipe = Pipe()
        process.executableURL = executableURL
        process.arguments = ["ip", "-4"]
        process.environment = environment
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
        } catch {
            return nil
        }

        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return nil
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let lines = String(decoding: data, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return lines.first
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
            baseURL: baseURL
        )
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
