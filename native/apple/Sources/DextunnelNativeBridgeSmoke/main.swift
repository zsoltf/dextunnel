import Foundation
import DextunnelBridgeClient
import DextunnelBridgeProtocol

struct SmokeConfiguration {
    var baseURLString = "http://127.0.0.1:4317"
    var surfaces: [DextunnelSurfaceKind] = [.host, .remote]
    var probeSend = false
    var probeMessage: String?

    init(arguments: [String]) {
        var iterator = arguments.makeIterator()
        while let argument = iterator.next() {
            switch argument {
            case "--base-url":
                if let value = iterator.next() {
                    baseURLString = value
                }
            case "--surface":
                if let value = iterator.next(), let surface = DextunnelSurfaceKind(rawValue: value) {
                    surfaces = [surface]
                }
            case "--probe-send":
                probeSend = true
            case "--message":
                probeMessage = iterator.next()
            case "--help", "-h":
                Self.printHelpAndExit()
            default:
                continue
            }
        }
    }

    static func printHelpAndExit() -> Never {
        print("Usage: DextunnelNativeBridgeSmoke [--base-url http://127.0.0.1:4317] [--surface host|remote] [--probe-send] [--message 'hello']")
        print("  --probe-send sends a real tagged turn into the currently selected thread and then releases its test lease.")
        exit(0)
    }
}

struct SmokeResult: Sendable {
    let surface: DextunnelSurfaceKind
    let roomLabel: String
    let threadCount: Int
    let sendSummary: String?
}

@main
struct DextunnelNativeBridgeSmoke {
    static func main() async {
        let configuration = SmokeConfiguration(arguments: Array(CommandLine.arguments.dropFirst()))
        guard let baseURL = URL(string: configuration.baseURLString) else {
            fputs("Invalid base URL: \(configuration.baseURLString)\n", stderr)
            exit(2)
        }

        do {
            var results: [SmokeResult] = []
            results.reserveCapacity(configuration.surfaces.count)
            for surface in configuration.surfaces {
                results.append(try await smoke(surface: surface, baseURL: baseURL, configuration: configuration))
            }
            for result in results {
                print("[\(result.surface.rawValue)] ok room=\(result.roomLabel) threads=\(result.threadCount)")
                if let sendSummary = result.sendSummary {
                    print("[\(result.surface.rawValue)] \(sendSummary)")
                }
            }
        } catch {
            fputs("\(DextunnelBridgeErrorFormatting.message(for: error))\n", stderr)
            exit(1)
        }
    }

    private static func smoke(
        surface: DextunnelSurfaceKind,
        baseURL: URL,
        configuration: SmokeConfiguration
    ) async throws -> SmokeResult {
        let transport = DextunnelURLSessionTransport()
        let bootstrapClient = DextunnelBridgeBootstrapClient(baseURL: baseURL, transport: transport)
        let bootstrap = try await bootstrapClient.fetchBootstrap(surface: surface)
        let session = DextunnelBridgeSession(baseURL: baseURL, bootstrap: bootstrap)
        let requests = DextunnelBridgeRequestFactory(session: session)
        let client = DextunnelBridgeClient(requests: requests, transport: transport)
        let runtime = DextunnelBridgeRuntime(
            client: client,
            eventStreamer: DextunnelURLSessionEventStreamer(),
            requests: requests,
            surfaceClientId: bootstrap.clientId
        )

        let payload = try await client.fetchLivePayload()
        let threads = try await client.fetchThreads()
        let roomLabel = payload.selectedChannel?.channelSlug ?? payload.selectedThreadSnapshot?.thread?.name ?? "#unknown"
        let sendSummary: String?

        if configuration.probeSend {
            let threadId =
                payload.selectedThreadSnapshot?.thread?.id ??
                payload.selectedThreadId
            guard let threadId, !threadId.isEmpty else {
                throw URLError(.badServerResponse)
            }

            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
            let message =
                configuration.probeMessage ??
                "NATIVE_SMOKE_PROBE_\(stamp). Reply with exactly: NATIVE_SMOKE_ACK_\(stamp)."

            _ = try await runtime.claimControl(threadId: threadId, reason: "native_smoke")
            let startedAt = Date()
            try await runtime.sendTurn(text: message, threadId: threadId, attachments: [])
            let elapsedMs = Int(Date().timeIntervalSince(startedAt) * 1000)
            let refreshedPayload = try await client.fetchLivePayload()
            let activeTurnId = refreshedPayload.selectedThreadSnapshot?.thread?.activeTurnId ?? "none"
            _ = try? await runtime.releaseControl(threadId: threadId, reason: "native_smoke_cleanup")
            sendSummary = "probe-send ok thread=\(threadId) activeTurn=\(activeTurnId) elapsedMs=\(elapsedMs)"
        } else {
            sendSummary = nil
        }

        return SmokeResult(
            surface: surface,
            roomLabel: roomLabel,
            threadCount: threads.count,
            sendSummary: sendSummary
        )
    }
}
