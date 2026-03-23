import Foundation
import DextunnelBridgeProtocol

public struct DextunnelBridgeHTTPError: Error, Sendable {
    public let statusCode: Int
    public let message: String
    public let body: String?

    public init(statusCode: Int, message: String, body: String? = nil) {
        self.statusCode = statusCode
        self.message = message
        self.body = body
    }
}

private struct DextunnelBridgeErrorEnvelope: Decodable {
    let error: String?
    let message: String?
}

private func dextunnelHTTPError(from response: HTTPURLResponse, data: Data) -> DextunnelBridgeHTTPError {
    let envelope = try? JSONDecoder().decode(DextunnelBridgeErrorEnvelope.self, from: data)
    let message =
        envelope?.error?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ??
        envelope?.message?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ??
        HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
    let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return DextunnelBridgeHTTPError(
        statusCode: response.statusCode,
        message: message,
        body: body?.nilIfEmpty
    )
}

public struct DextunnelBridgeBootstrapClient<Transport: DextunnelBridgeTransport>: Sendable {
    public let baseURL: URL
    public let transport: Transport
    private let decoder: JSONDecoder

    public init(baseURL: URL, transport: Transport, decoder: JSONDecoder = JSONDecoder()) {
        self.baseURL = baseURL
        self.transport = transport
        self.decoder = decoder
    }

    public func fetchBootstrap(surface: DextunnelSurfaceKind) async throws -> DextunnelSurfaceBootstrap {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.path = "/api/codex-app-server/bootstrap"
        components?.queryItems = [URLQueryItem(name: "surface", value: surface.rawValue)]
        guard let url = components?.url else {
            throw URLError(.badURL)
        }

        let request = URLRequest(url: url)
        let (data, response) = try await transport.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw dextunnelHTTPError(from: http, data: data)
        }
        return try decoder.decode(DextunnelSurfaceBootstrap.self, from: data)
    }
}

public struct DextunnelBridgeSession: Sendable {
    public let baseURL: URL
    public let bootstrap: DextunnelSurfaceBootstrap

    public init(baseURL: URL, bootstrap: DextunnelSurfaceBootstrap) {
        self.baseURL = baseURL
        self.bootstrap = bootstrap
    }
}

public struct DextunnelServerSentEvent: Equatable, Sendable {
    public let event: String
    public let data: String

    public init(event: String, data: String) {
        self.event = event
        self.data = data
    }
}

public struct DextunnelBridgeRequestFactory: Sendable {
    public let session: DextunnelBridgeSession
    private let encoder: JSONEncoder

    public init(session: DextunnelBridgeSession, encoder: JSONEncoder = JSONEncoder()) {
        self.session = session
        self.encoder = encoder
    }

    public func liveStateRequest() throws -> URLRequest {
        request(path: "/api/codex-app-server/live-state")
    }

    public func threadsRequest() throws -> URLRequest {
        request(path: "/api/codex-app-server/threads")
    }

    public func refreshRequest(includeThreads: Bool = true) throws -> URLRequest {
        var components = URLComponents(url: session.baseURL.appending(path: "/api/codex-app-server/refresh"), resolvingAgainstBaseURL: false)
        if !includeThreads {
            components?.queryItems = [URLQueryItem(name: "threads", value: "0")]
        }
        guard let url = components?.url else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(session.bootstrap.accessToken, forHTTPHeaderField: "x-dextunnel-surface-token")
        return request
    }

    public func reconnectRequest(includeThreads: Bool = true) throws -> URLRequest {
        var components = URLComponents(url: session.baseURL.appending(path: "/api/codex-app-server/reconnect"), resolvingAgainstBaseURL: false)
        if !includeThreads {
            components?.queryItems = [URLQueryItem(name: "threads", value: "0")]
        }
        guard let url = components?.url else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(session.bootstrap.accessToken, forHTTPHeaderField: "x-dextunnel-surface-token")
        return request
    }

    public func presenceRequest(payload: DextunnelPresenceRequest) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/presence",
            method: "POST",
            body: payload
        )
    }

    public func controlRequest(action: String, threadId: String?, reason: String? = nil) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/control",
            method: "POST",
            body: DextunnelControlRequest(action: action, reason: reason, threadId: threadId)
        )
    }

    public func interactionRequest(action: String, answers: [String: String]? = nil) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/interaction",
            method: "POST",
            body: DextunnelInteractionRequest(action: action, answers: answers)
        )
    }

    public func streamRequest() throws -> URLRequest {
        request(path: "/api/stream")
    }

    public func interruptRequest() throws -> URLRequest {
        request(path: "/api/codex-app-server/interrupt", method: "POST")
    }

    public func revealInCodexRequest(threadId: String) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/open-in-codex",
            method: "POST",
            body: DextunnelOpenInCodexRequest(threadId: threadId)
        )
    }

    public func selectionRequest(threadId: String?, cwd: String?) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/selection",
            method: "POST",
            body: DextunnelSelectionRequest(cwd: cwd, threadId: threadId)
        )
    }

    public func turnRequest(text: String, threadId: String?, attachments: [DextunnelTurnAttachment] = []) throws -> URLRequest {
        try request(
            path: "/api/codex-app-server/turn",
            method: "POST",
            body: DextunnelTurnRequest(attachments: attachments, text: text, threadId: threadId)
        )
    }

    public func streamURL() throws -> URL {
        guard var components = URLComponents(url: session.baseURL, resolvingAgainstBaseURL: false) else {
            throw URLError(.badURL)
        }

        components.path = "/api/stream"
        components.queryItems = [
            URLQueryItem(name: "surfaceToken", value: session.bootstrap.accessToken)
        ]
        guard let url = components.url else {
            throw URLError(.badURL)
        }
        return url
    }

    public func parseServerSentEvents(from rawChunk: String) -> [DextunnelServerSentEvent] {
        rawChunk
            .components(separatedBy: "\n\n")
            .compactMap { block in
                let trimmed = block.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    return nil
                }

                var eventName = "message"
                var dataLines: [String] = []
                for line in block.components(separatedBy: "\n") {
                    if line.hasPrefix("event:") {
                        eventName = String(line.dropFirst("event:".count)).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:") {
                        dataLines.append(String(line.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces))
                    }
                }

                return DextunnelServerSentEvent(
                    event: eventName,
                    data: dataLines.joined()
                )
            }
    }

    private func request(path: String, method: String = "GET") -> URLRequest {
        let url = session.baseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(session.bootstrap.accessToken, forHTTPHeaderField: "x-dextunnel-surface-token")
        return request
    }

    private func request<Body: Encodable>(path: String, method: String = "GET", body: Body) throws -> URLRequest {
        var request = request(path: path, method: method)
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
}

public protocol DextunnelBridgeTransport: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

public struct DextunnelURLSessionTransport: DextunnelBridgeTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

public protocol DextunnelBridgeEventStreaming: Sendable {
    func events(for request: URLRequest) -> AsyncThrowingStream<DextunnelServerSentEvent, Error>
}

public struct DextunnelURLSessionEventStreamer: DextunnelBridgeEventStreaming {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func events(for request: URLRequest) -> AsyncThrowingStream<DextunnelServerSentEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        throw URLError(.badServerResponse)
                    }

                    var eventName = "message"
                    var dataLines: [String] = []

                    for try await line in bytes.lines {
                        if line.isEmpty {
                            if !dataLines.isEmpty || eventName != "message" {
                                continuation.yield(
                                    DextunnelServerSentEvent(
                                        event: eventName,
                                        data: dataLines.joined()
                                    )
                                )
                            }
                            eventName = "message"
                            dataLines = []
                            continue
                        }

                        if line.hasPrefix("event:") {
                            eventName = String(line.dropFirst("event:".count)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataLines.append(String(line.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces))
                        }
                    }

                    if !dataLines.isEmpty || eventName != "message" {
                        continuation.yield(
                            DextunnelServerSentEvent(
                                event: eventName,
                                data: dataLines.joined()
                            )
                        )
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

public protocol DextunnelBridgeService: Sendable {
    var surfaceClientId: String { get }

    func claimControl(threadId: String?, reason: String?) async throws -> DextunnelLivePayload
    func eventStream() throws -> AsyncThrowingStream<DextunnelServerSentEvent, Error>
    func fetchLivePayload() async throws -> DextunnelLivePayload
    func fetchThreads() async throws -> [DextunnelThreadSummary]
    func interrupt() async throws -> DextunnelLivePayload
    func reconnect(includeThreads: Bool) async throws -> DextunnelLivePayload
    func refresh(includeThreads: Bool) async throws -> DextunnelLivePayload
    func releaseControl(threadId: String?, reason: String?) async throws -> DextunnelLivePayload
    func revealInCodex(threadId: String) async throws -> DextunnelOpenInCodexResponse
    func respondToInteraction(action: String, answers: [String: String]?) async throws -> DextunnelLivePayload
    func select(threadId: String?, cwd: String?) async throws -> DextunnelLivePayload
    func sendTurn(text: String, threadId: String?, attachments: [DextunnelTurnAttachment]) async throws
    func syncPresence(
        threadId: String,
        visible: Bool,
        focused: Bool,
        engaged: Bool,
        detach: Bool
    ) async throws
}

public struct DextunnelBridgeClient<Transport: DextunnelBridgeTransport>: Sendable {
    public let requests: DextunnelBridgeRequestFactory
    public let transport: Transport
    private let decoder: JSONDecoder

    public init(
        requests: DextunnelBridgeRequestFactory,
        transport: Transport,
        decoder: JSONDecoder = JSONDecoder()
    ) {
        self.requests = requests
        self.transport = transport
        self.decoder = decoder
    }

    public func fetchLivePayload() async throws -> DextunnelLivePayload {
        try await decode(DextunnelLivePayload.self, from: requests.liveStateRequest())
    }

    public func fetchThreads() async throws -> [DextunnelThreadSummary] {
        let payload = try await decode(DextunnelThreadListResponse.self, from: requests.threadsRequest())
        return payload.data
    }

    public func refresh(includeThreads: Bool = true) async throws -> DextunnelLivePayload {
        let payload = try await decode(DextunnelRefreshResponse.self, from: requests.refreshRequest(includeThreads: includeThreads))
        return payload.state
    }

    public func reconnect(includeThreads: Bool = true) async throws -> DextunnelLivePayload {
        let payload = try await decode(DextunnelRefreshResponse.self, from: requests.reconnectRequest(includeThreads: includeThreads))
        return payload.state
    }

    public func revealInCodex(threadId: String) async throws -> DextunnelOpenInCodexResponse {
        try await decode(DextunnelOpenInCodexResponse.self, from: requests.revealInCodexRequest(threadId: threadId))
    }

    func execute(_ request: URLRequest) async throws {
        let (data, response) = try await transport.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw dextunnelHTTPError(from: http, data: data)
        }
    }

    func decode<T: Decodable>(_ type: T.Type, from request: URLRequest) async throws -> T {
        let (data, response) = try await transport.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw dextunnelHTTPError(from: http, data: data)
        }
        return try decoder.decode(T.self, from: data)
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

public struct DextunnelBridgeRuntime<Transport: DextunnelBridgeTransport, EventStreamer: DextunnelBridgeEventStreaming>: DextunnelBridgeService, Sendable {
    public let client: DextunnelBridgeClient<Transport>
    public let eventStreamer: EventStreamer
    public let requests: DextunnelBridgeRequestFactory
    public let surfaceClientId: String

    public init(
        client: DextunnelBridgeClient<Transport>,
        eventStreamer: EventStreamer,
        requests: DextunnelBridgeRequestFactory,
        surfaceClientId: String
    ) {
        self.client = client
        self.eventStreamer = eventStreamer
        self.requests = requests
        self.surfaceClientId = surfaceClientId
    }

    public func eventStream() throws -> AsyncThrowingStream<DextunnelServerSentEvent, Error> {
        eventStreamer.events(for: try requests.streamRequest())
    }

    public func fetchLivePayload() async throws -> DextunnelLivePayload {
        try await client.fetchLivePayload()
    }

    public func fetchThreads() async throws -> [DextunnelThreadSummary] {
        try await client.fetchThreads()
    }

    public func refresh(includeThreads: Bool = true) async throws -> DextunnelLivePayload {
        try await client.refresh(includeThreads: includeThreads)
    }

    public func reconnect(includeThreads: Bool = true) async throws -> DextunnelLivePayload {
        try await client.reconnect(includeThreads: includeThreads)
    }

    public func syncPresence(
        threadId: String,
        visible: Bool,
        focused: Bool,
        engaged: Bool,
        detach: Bool = false
    ) async throws {
        let request = try requests.presenceRequest(
            payload: DextunnelPresenceRequest(
                detach: detach ? true : nil,
                engaged: detach ? nil : engaged,
                focused: detach ? nil : focused,
                threadId: threadId,
                visible: detach ? nil : visible
            )
        )
        try await client.execute(request)
    }

    public func claimControl(threadId: String?, reason: String? = nil) async throws -> DextunnelLivePayload {
        let request = try requests.controlRequest(action: "claim", threadId: threadId, reason: reason)
        let payload = try await client.decode(DextunnelStateEnvelope.self, from: request)
        return payload.state
    }

    public func releaseControl(threadId: String?, reason: String? = nil) async throws -> DextunnelLivePayload {
        let request = try requests.controlRequest(action: "release", threadId: threadId, reason: reason)
        let payload = try await client.decode(DextunnelStateEnvelope.self, from: request)
        return payload.state
    }

    public func revealInCodex(threadId: String) async throws -> DextunnelOpenInCodexResponse {
        try await client.revealInCodex(threadId: threadId)
    }

    public func respondToInteraction(action: String, answers: [String: String]? = nil) async throws -> DextunnelLivePayload {
        let request = try requests.interactionRequest(action: action, answers: answers)
        let payload = try await client.decode(DextunnelStateEnvelope.self, from: request)
        return payload.state
    }

    public func select(threadId: String?, cwd: String?) async throws -> DextunnelLivePayload {
        let request = try requests.selectionRequest(threadId: threadId, cwd: cwd)
        let payload = try await client.decode(DextunnelStateEnvelope.self, from: request)
        return payload.state
    }

    public func interrupt() async throws -> DextunnelLivePayload {
        let request = try requests.interruptRequest()
        let payload = try await client.decode(DextunnelStateEnvelope.self, from: request)
        return payload.state
    }

    public func sendTurn(text: String, threadId: String?, attachments: [DextunnelTurnAttachment]) async throws {
        let request = try requests.turnRequest(text: text, threadId: threadId, attachments: attachments)
        try await client.execute(request)
    }
}
