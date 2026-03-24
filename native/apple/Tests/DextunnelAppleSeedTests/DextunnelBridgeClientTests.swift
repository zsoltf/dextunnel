import Foundation
import Testing
@testable import DextunnelBridgeClient
@testable import DextunnelBridgeProtocol

private struct FakeTransport: DextunnelBridgeTransport {
    let payloads: [String: Data]
    var statusCodes: [String: Int] = [:]

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path() ?? ""
        let data = payloads[path] ?? Data("{}".utf8)
        let statusCode = statusCodes[path] ?? 200
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        )!
        return (data, response)
    }
}

@Test
func bridgeRequestFactoryAddsSurfaceTokenAndJsonBodies() throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)

    let request = try factory.selectionRequest(threadId: "thread-123", cwd: "/tmp/dextunnel")
    #expect(request.url?.absoluteString == "http://127.0.0.1:4317/api/codex-app-server/selection")
    #expect(request.value(forHTTPHeaderField: "x-dextunnel-surface-token") == "surface-token")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(request.httpMethod == "POST")
    let body = try #require(request.httpBody)
    let json = try JSONSerialization.jsonObject(with: body) as? [String: String]
    #expect(json?["threadId"] == "thread-123")
    #expect(json?["cwd"] == "/tmp/dextunnel")
}

@Test
func bridgeRequestFactoryBuildsSSEUrlWithQueryToken() throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)

    let streamURL = try factory.streamURL()
    #expect(streamURL.absoluteString == "http://127.0.0.1:4317/api/stream?surfaceToken=surface-token")
}

@Test
func bridgeClientDecodesThreadsResponse() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/threads": Data("""
            {
              "data": [
                {
                  "channelLabel": "dextunnel",
                  "channelSlug": "#dextunnel",
                  "cwd": "/tmp/dextunnel-fixture",
                  "id": "thread-1",
                  "name": "dextunnel",
                  "openingPreview": "thread opener",
                  "preview": "hello",
                  "serverLabel": "codex/dextunnel",
                  "source": "vscode",
                  "status": "completed",
                  "updatedAt": "2026-03-20T00:00:00Z"
                }
              ]
            }
            """.utf8)
        ])
    )

    let threads = try await client.fetchThreads()
    #expect(threads.count == 1)
    #expect(threads.first?.channelSlug == "#dextunnel")
    #expect(threads.first?.openingPreview == "thread opener")
}

@Test
func bridgeClientDecodesCurrentThreadListShape() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/threads": Data("""
            {
              "cwd": null,
              "data": [
                {
                  "id": "thread-1",
                  "openingPreview": "first meaningful turn",
                  "preview": "hello",
                  "cwd": "/tmp/dextunnel-fixture",
                  "source": "vscode",
                  "name": "dextunnel",
                  "status": { "type": "idle" },
                  "updatedAt": 1774063586
                }
              ]
            }
            """.utf8)
        ])
    )

    let threads = try await client.fetchThreads()
    #expect(threads.count == 1)
    #expect(threads.first?.name == "dextunnel")
    #expect(threads.first?.openingPreview == "first meaningful turn")
    #expect(threads.first?.status == "idle")
    #expect(threads.first?.updatedAt == "1774063586")
}

@Test
func bridgeClientSurfacesBridgeErrorPayloadMessages() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(
            payloads: [
                "/api/codex-app-server/turn": Data("""
                {
                  "error": "A live send is already in progress for this session."
                }
                """.utf8)
            ],
            statusCodes: [
                "/api/codex-app-server/turn": 409
            ]
        )
    )

    do {
        try await client.execute(try factory.turnRequest(text: "hello", threadId: "thread-1"))
        Issue.record("Expected a bridge HTTP error")
    } catch let error as DextunnelBridgeHTTPError {
        #expect(error.statusCode == 409)
        #expect(error.message == "A live send is already in progress for this session.")
    } catch {
        Issue.record("Expected DextunnelBridgeHTTPError, got \(error)")
    }
}

@Test
func bridgeClientDecodesLivePayloadTranscript() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/live-state": Data("""
            {
              "pendingInteraction": null,
              "participants": [
                { "id": "codex", "label": "codex", "role": "live" },
                { "id": "remote", "label": "remote", "role": "live", "lane": "remote" }
              ],
              "threads": [
                {
                  "id": "thread-1",
                  "channelLabel": "dextunnel",
                  "channelSlug": "#dextunnel",
                  "cwd": "/tmp/dextunnel-fixture",
                  "name": "dextunnel",
                  "preview": "working on it",
                  "serverLabel": "codex/dextunnel",
                  "source": "vscode",
                  "status": "completed",
                  "updatedAt": "2026-03-20T00:00:00Z"
                }
              ],
              "selectedAttachments": [],
              "selectedChannel": {
                "channelId": "thread-1",
                "channelLabel": "dextunnel",
                "channelSlug": "#dextunnel",
                "serverLabel": "codex/dextunnel",
                "source": "vscode",
                "topic": "Native transcript test"
              },
              "selectedProjectCwd": "/tmp/dextunnel-fixture",
              "selectedThreadId": "thread-1",
              "selectedThreadSnapshot": {
                "channel": {
                  "channelId": "thread-1",
                  "channelLabel": "dextunnel",
                  "channelSlug": "#dextunnel",
                  "serverLabel": "codex/dextunnel",
                  "source": "vscode",
                  "topic": "Native transcript test"
                },
                "participants": [
                  { "id": "codex", "label": "codex", "role": "live" },
                  { "id": "remote", "label": "remote", "role": "live", "lane": "remote" }
                ],
                "thread": {
                  "activeTurnId": null,
                  "cwd": "/tmp/dextunnel-fixture",
                  "id": "thread-1",
                  "name": "dextunnel",
                  "source": "vscode",
                  "status": "completed"
                },
                "transcriptCount": 2,
                "transcript": [
                  {
                    "itemId": "item-1",
                    "lane": "remote",
                    "participant": { "id": "remote", "label": "remote", "lane": "remote" },
                    "role": "user",
                    "text": "keep going"
                  },
                  {
                    "itemId": "item-2",
                    "participant": { "id": "codex", "label": "codex" },
                    "role": "assistant",
                    "text": "working on it"
                  }
                ]
              },
              "turnDiff": {
                "items": [
                  { "path": "src/server.mjs", "status": "modified", "additions": 10, "deletions": 4 }
                ]
              },
              "status": {
                "controlLeaseForSelection": null,
                "diagnostics": [],
                "runtimeProfile": "default",
                "selectionMode": "shared-room",
                "watcherConnected": true
              }
            }
            """.utf8)
        ])
    )

    let payload = try await client.fetchLivePayload()
    #expect(payload.selectedThreadSnapshot?.transcriptCount == 2)
    #expect(payload.selectedThreadSnapshot?.transcript.count == 2)
    #expect(payload.selectedThreadSnapshot?.transcript.first?.participant?.label == "remote")
    #expect(payload.selectedChannel?.channelLabel == "dextunnel")
    #expect(payload.threads?.first?.preview == "working on it")
    #expect(payload.turnDiff?.items.first?.path == "src/server.mjs")
}

@Test
func bridgeClientToleratesWatcherStyleTurnDiffWithoutItems() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/live-state": Data("""
            {
              "pendingInteraction": null,
              "participants": [],
              "selectedAttachments": [],
              "selectedChannel": {
                "channelSlug": "#dextunnel"
              },
              "selectedThreadId": "thread-1",
              "selectedThreadSnapshot": {
                "thread": {
                  "id": "thread-1",
                  "name": "dextunnel",
                  "status": "completed"
                },
                "transcript": []
              },
              "turnDiff": {
                "cwd": "/tmp/dextunnel-fixture",
                "diff": "",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "updatedAt": "2026-03-20T00:00:00Z"
              },
              "status": {
                "controlLeaseForSelection": null,
                "diagnostics": [],
                "runtimeProfile": "default",
                "selectionMode": "shared-room",
                "watcherConnected": true
              }
            }
            """.utf8)
        ])
    )

    let payload = try await client.fetchLivePayload()
    #expect(payload.turnDiff?.items.isEmpty == true)
}

@Test
func bridgeClientDecodesCurrentSelectedThreadStatusShape() async throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let client = DextunnelBridgeClient(
        requests: factory,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/live-state": Data("""
            {
              "pendingInteraction": null,
              "participants": [],
              "selectedAttachments": [],
              "selectedChannel": {
                "channelSlug": "#dextunnel"
              },
              "selectedThreadId": "thread-1",
              "selectedThreadSnapshot": {
                "thread": {
                  "id": "thread-1",
                  "name": "dextunnel",
                  "status": { "type": "idle" }
                },
                "transcript": []
              },
              "status": {
                "controlLeaseForSelection": null,
                "diagnostics": [],
                "runtimeProfile": "default",
                "selectionMode": "shared-room",
                "watcherConnected": true
              }
            }
            """.utf8)
        ])
    )

    let payload = try await client.fetchLivePayload()
    #expect(payload.selectedThreadSnapshot?.thread?.status == "idle")
}

@Test
func bootstrapClientFetchesSurfaceBootstrap() async throws {
    let client = DextunnelBridgeBootstrapClient(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        transport: FakeTransport(payloads: [
            "/api/codex-app-server/bootstrap": Data("""
            {
              "accessToken": "surface-token",
              "capabilities": ["read_room"],
              "clientId": "remote-1",
              "expiresAt": "2026-03-21T00:00:00Z",
              "issuedAt": "2026-03-20T00:00:00Z",
              "surface": "remote"
            }
            """.utf8)
        ])
    )

    let bootstrap = try await client.fetchBootstrap(surface: .remote)
    #expect(bootstrap.accessToken == "surface-token")
    #expect(bootstrap.capabilities == ["read_room"])
    #expect(bootstrap.surface == .remote)
}

@Test
func bridgeRequestFactoryParsesServerSentEventBlocks() throws {
    let session = DextunnelBridgeSession(
        baseURL: URL(string: "http://127.0.0.1:4317")!,
        bootstrap: DextunnelSurfaceBootstrap(
            accessToken: "surface-token",
            clientId: "remote-1",
            expiresAt: "2026-03-20T00:00:00Z",
            surface: .remote
        )
    )
    let factory = DextunnelBridgeRequestFactory(session: session)
    let events = factory.parseServerSentEvents(from: """
    event: live
    data: {"ok":true}

    event: snapshot
    data: {"state":"x"}

    """)

    #expect(events == [
        DextunnelServerSentEvent(event: "live", data: #"{"ok":true}"#),
        DextunnelServerSentEvent(event: "snapshot", data: #"{"state":"x"}"#)
    ])
}
