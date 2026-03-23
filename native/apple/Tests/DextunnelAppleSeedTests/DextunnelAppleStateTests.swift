import Foundation
import Testing
@testable import DextunnelAppleState
@testable import DextunnelBridgeClient
@testable import DextunnelBridgeProtocol

private final class FakeBridgeService: @unchecked Sendable, DextunnelBridgeService {
    let surfaceClientId: String = "remote-1"
    var livePayload: DextunnelLivePayload
    var threads: [DextunnelThreadSummary]
    var eventStreamError: (any Error)?
    var eventContinuations: [AsyncThrowingStream<DextunnelServerSentEvent, Error>.Continuation] = []
    var eventStreamCalls = 0
    var fetchLivePayloadCalls = 0
    var fetchThreadsCalls = 0
    var interactionActions: [String] = []
    var presenceUpdates: [DextunnelPresenceRequest] = []
    var reconnectCalls = 0
    var refreshCalls = 0
    var sentTexts: [String] = []
    var revealedThreadIds: [String] = []
    var refreshError: (any Error)?
    var sendTurnDelayNanoseconds: UInt64 = 0
    var sendTurnError: (any Error)?
    var claimControlError: (any Error)?
    var releaseControlError: (any Error)?

    init(livePayload: DextunnelLivePayload, threads: [DextunnelThreadSummary]) {
        self.livePayload = livePayload
        self.threads = threads
    }

    func eventStream() throws -> AsyncThrowingStream<DextunnelServerSentEvent, Error> {
        eventStreamCalls += 1
        return AsyncThrowingStream { continuation in
            eventContinuations.append(continuation)
            if let eventStreamError {
                continuation.finish(throwing: eventStreamError)
            }
        }
    }

    func fetchLivePayload() async throws -> DextunnelLivePayload {
        fetchLivePayloadCalls += 1
        return livePayload
    }

    func fetchThreads() async throws -> [DextunnelThreadSummary] {
        fetchThreadsCalls += 1
        return threads
    }

    func refresh(includeThreads: Bool) async throws -> DextunnelLivePayload {
        refreshCalls += 1
        if let refreshError {
            throw refreshError
        }
        return livePayload
    }

    func reconnect(includeThreads: Bool) async throws -> DextunnelLivePayload {
        reconnectCalls += 1
        if let refreshError {
            throw refreshError
        }
        return livePayload
    }

    func syncPresence(
        threadId: String,
        visible: Bool,
        focused: Bool,
        engaged: Bool,
        detach: Bool
    ) async throws {
        presenceUpdates.append(
            DextunnelPresenceRequest(
                detach: detach ? true : nil,
                engaged: detach ? nil : engaged,
                focused: detach ? nil : focused,
                threadId: threadId,
                visible: detach ? nil : visible
            )
        )
    }

    func claimControl(threadId: String?, reason: String?) async throws -> DextunnelLivePayload {
        if let claimControlError {
            throw claimControlError
        }
        livePayload = DextunnelLivePayload(
            pendingInteraction: livePayload.pendingInteraction,
            selectedAttachments: livePayload.selectedAttachments,
            selectedChannel: livePayload.selectedChannel,
            selectedProjectCwd: livePayload.selectedProjectCwd,
            selectedThreadId: livePayload.selectedThreadId,
            selectedThreadSnapshot: livePayload.selectedThreadSnapshot,
            status: DextunnelLiveStatus(
                controlLeaseForSelection: DextunnelControlLease(
                    clientId: surfaceClientId,
                    expiresAt: "2026-03-21T00:00:00Z",
                    owner: "remote",
                    ownerClientId: surfaceClientId,
                    reason: reason,
                    source: "remote",
                    threadId: threadId
                ),
                diagnostics: livePayload.status.diagnostics,
                runtimeProfile: livePayload.status.runtimeProfile,
                selectionMode: livePayload.status.selectionMode,
                watcherConnected: livePayload.status.watcherConnected
            ),
            threads: livePayload.threads ?? threads
        )
        return livePayload
    }

    func releaseControl(threadId: String?, reason: String?) async throws -> DextunnelLivePayload {
        if let releaseControlError {
            throw releaseControlError
        }
        livePayload = DextunnelLivePayload(
            pendingInteraction: livePayload.pendingInteraction,
            selectedAttachments: livePayload.selectedAttachments,
            selectedChannel: livePayload.selectedChannel,
            selectedProjectCwd: livePayload.selectedProjectCwd,
            selectedThreadId: livePayload.selectedThreadId,
            selectedThreadSnapshot: livePayload.selectedThreadSnapshot,
            status: DextunnelLiveStatus(
                controlLeaseForSelection: nil,
                diagnostics: livePayload.status.diagnostics,
                runtimeProfile: livePayload.status.runtimeProfile,
                selectionMode: livePayload.status.selectionMode,
                watcherConnected: livePayload.status.watcherConnected
            ),
            threads: livePayload.threads ?? threads
        )
        return livePayload
    }

    func revealInCodex(threadId: String) async throws -> DextunnelOpenInCodexResponse {
        revealedThreadIds.append(threadId)
        return DextunnelOpenInCodexResponse(
            deeplink: "codex://threads/\(threadId)",
            message: "Revealed",
            ok: true,
            threadId: threadId
        )
    }

    func select(threadId: String?, cwd: String?) async throws -> DextunnelLivePayload {
        livePayload = DextunnelLivePayload(
            pendingInteraction: nil,
            selectedAttachments: [],
            selectedChannel: DextunnelSelectedChannel(
                channelSlug: "#bootstrap",
                serverLabel: "codex/dextunnel",
                source: "vscode",
                topic: "topic"
            ),
            selectedProjectCwd: cwd,
            selectedThreadId: threadId,
            selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
                channel: DextunnelSelectedChannel(
                    channelSlug: "#bootstrap",
                    serverLabel: "codex/dextunnel",
                    source: "vscode",
                    topic: "topic"
                ),
                thread: DextunnelSelectedThread(
                    activeTurnId: nil,
                    cwd: cwd,
                    id: threadId,
                    name: "Bootstrap repo workflow scaffold",
                    source: "vscode",
                    status: "completed"
                )
            ),
            status: livePayload.status,
            threads: threads
        )
        return livePayload
    }

    func respondToInteraction(action: String, answers: [String : String]?) async throws -> DextunnelLivePayload {
        interactionActions.append(action)
        livePayload = DextunnelLivePayload(
            pendingInteraction: nil,
            selectedAttachments: livePayload.selectedAttachments,
            selectedChannel: livePayload.selectedChannel,
            selectedProjectCwd: livePayload.selectedProjectCwd,
            selectedThreadId: livePayload.selectedThreadId,
            selectedThreadSnapshot: livePayload.selectedThreadSnapshot,
            status: livePayload.status,
            threads: livePayload.threads ?? threads
        )
        return livePayload
    }

    func interrupt() async throws -> DextunnelLivePayload {
        livePayload
    }

    func sendTurn(text: String, threadId: String?, attachments: [DextunnelTurnAttachment]) async throws {
        if sendTurnDelayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: sendTurnDelayNanoseconds)
        }
        if let sendTurnError {
            throw sendTurnError
        }
        sentTexts.append(text)
    }

    func yieldLiveEvent(_ payload: DextunnelLivePayload, index: Int = 0) {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(payload),
              let json = String(data: data, encoding: .utf8),
              eventContinuations.indices.contains(index)
        else {
            return
        }

        eventContinuations[index].yield(
            DextunnelServerSentEvent(event: "live", data: json)
        )
    }

    func finishEventStream(index: Int = 0, error: (any Error)? = nil) {
        guard eventContinuations.indices.contains(index) else {
            return
        }
        if let error {
            eventContinuations[index].finish(throwing: error)
        } else {
            eventContinuations[index].finish()
        }
    }
}

private final class InMemoryDraftPersistence: DextunnelDraftPersistence {
    private var states: [String: DextunnelPersistedDraftState] = [:]

    func loadState(threadId: String) -> DextunnelPersistedDraftState? {
        states[threadId]
    }

    func saveState(_ state: DextunnelPersistedDraftState, threadId: String) {
        states[threadId] = state
    }

    func clearState(threadId: String) {
        states.removeValue(forKey: threadId)
    }

    func state(threadId: String) -> DextunnelPersistedDraftState? {
        states[threadId]
    }
}

@MainActor
@Test
func liveBridgeStoreBootstrapsAndComputesAvailability() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let threads = [
        DextunnelThreadSummary(
            channelLabel: "dextunnel",
            channelSlug: "#dextunnel",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-1",
            name: "dextunnel",
            preview: "hello",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: "2026-03-20T00:00:00Z"
        )
    ]
    let service = FakeBridgeService(livePayload: payload, threads: threads)
    let store = DextunnelLiveBridgeStore(service: service)

    await store.bootstrap()
    store.draftText = "hello from ios"

    #expect(store.connectionPhase == .live)
    #expect(store.threads.count == 1)
    #expect(store.availability.canQueue)
    #expect(store.availability.canSteer)
}

@MainActor
@Test
func liveBridgeStoreQueuesAndSendsDrafts() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "queued first"
    store.queueCurrentDraft()
    #expect(store.queuedDrafts.count == 1)

    store.draftText = "send now"
    await store.sendCurrentDraft()
    #expect(service.sentTexts == ["send now"])
    #expect(store.recentDeliveredDrafts.map(\.text) == ["send now"])
    #expect(store.recentDeliveredDrafts.first?.deliveryState == .delivered)

    await store.flushFirstQueuedDraft()
    #expect(service.sentTexts == ["send now", "queued first"])
    #expect(store.queuedDrafts.isEmpty)
    #expect(store.recentDeliveredDrafts.map(\.text) == ["queued first", "send now"])
    #expect(store.recentDeliveredDrafts.map(\.deliveryState) == [.delivered, .delivered])
}

@MainActor
@Test
func liveBridgeStoreRemovesAndClearsQueuedDrafts() async throws {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let store = DextunnelLiveBridgeStore(
        service: FakeBridgeService(livePayload: payload, threads: []),
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "first"
    store.queueCurrentDraft()
    store.draftText = "second"
    store.queueCurrentDraft()

    let firstDraftId = try #require(store.queuedDrafts.first?.id)
    store.removeQueuedDraft(id: firstDraftId)
    #expect(store.queuedDrafts.map(\.text) == ["second"])

    store.clearQueuedDrafts()
    #expect(store.queuedDrafts.isEmpty)
}

@MainActor
@Test
func liveBridgeStoreDoesNotQueueWhitespaceDrafts() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let store = DextunnelLiveBridgeStore(
        service: FakeBridgeService(livePayload: payload, threads: []),
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "   \n  "
    store.queueCurrentDraft()

    #expect(store.queuedDrafts.isEmpty)
    #expect(store.draftText == "   \n  ")
}

@MainActor
@Test
func liveBridgeStoreIgnoresCancelledRefreshErrors() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    service.refreshError = CancellationError()

    await store.refresh()

    #expect(store.lastErrorMessage == nil)
    #expect(store.connectionPhase == .live)
}

@MainActor
@Test
func liveBridgeStoreSuppressesPassiveTimeoutErrorsFromStream() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    service.eventStreamError = URLError(.timedOut)
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.startStreaming()
    try? await Task.sleep(nanoseconds: 20_000_000)

    #expect(store.lastErrorMessage == nil)
    #expect(store.reconnectCount >= 1)
    #expect(store.lastReconnectAt != nil)
    #expect(store.connectionPhase == .reconnecting || store.connectionPhase == .live)
}

@MainActor
@Test
func liveBridgeStoreRestoresDraftsAcrossReconnect() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let persistence = InMemoryDraftPersistence()
    let firstStore = DextunnelLiveBridgeStore(
        service: FakeBridgeService(livePayload: payload, threads: []),
        draftPersistence: persistence
    )

    await firstStore.bootstrap()
    firstStore.draftText = "native reconnect draft"
    firstStore.queueCurrentDraft()
    firstStore.draftText = "still editing"

    let secondService = FakeBridgeService(livePayload: payload, threads: [])
    let secondStore = DextunnelLiveBridgeStore(
        service: secondService,
        draftPersistence: persistence
    )
    await secondStore.bootstrap()

    #expect(secondStore.draftText == "still editing")
    #expect(secondStore.queuedDrafts.isEmpty)
    #expect(secondStore.recentDeliveredDrafts.map(\.text) == ["native reconnect draft"])
    #expect(secondService.sentTexts == ["native reconnect draft"])
}

@MainActor
@Test
func liveBridgeStoreKeepsDraftsScopedPerThread() async {
    let initialPayload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#thread-1",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "thread-1",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let threads = [
        DextunnelThreadSummary(
            channelLabel: "thread-1",
            channelSlug: "#thread-1",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-1",
            name: "thread-1",
            preview: nil,
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: nil
        ),
        DextunnelThreadSummary(
            channelLabel: "thread-2",
            channelSlug: "#thread-2",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-2",
            name: "thread-2",
            preview: nil,
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: nil
        )
    ]
    let service = FakeBridgeService(livePayload: initialPayload, threads: threads)
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "thread one draft"

    await store.select(thread: threads[1])
    #expect(store.selectedThreadId == "thread-2")
    #expect(store.draftText.isEmpty)

    store.draftText = "thread two draft"

    await store.select(thread: threads[0])
    #expect(store.selectedThreadId == "thread-1")
    #expect(store.draftText == "thread one draft")

    await store.select(thread: threads[1])
    #expect(store.draftText == "thread two draft")
}

@MainActor
@Test
func liveBridgeStoreAppliesLiveEventsAndRevealMessages() async throws {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: nil,
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: false
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(service: service)

    await store.bootstrap()
    await store.revealSelectedThreadInCodex()
    #expect(store.lastRevealMessage == "Revealed")

    let liveEventPayload = DextunnelLivePayload(
        pendingInteraction: DextunnelPendingInteraction(
            id: "pending-1",
            kind: "user_input",
            message: "Question",
            requestId: "req-1",
            summary: "Need input",
            subject: "Prompt"
        ),
        selectedAttachments: [],
        selectedChannel: payload.selectedChannel,
        selectedProjectCwd: payload.selectedProjectCwd,
        selectedThreadId: payload.selectedThreadId,
        selectedThreadSnapshot: payload.selectedThreadSnapshot,
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let eventData = try JSONEncoder().encode(liveEventPayload)
    await store.apply(event: DextunnelServerSentEvent(
        event: "live",
        data: String(decoding: eventData, as: UTF8.self)
    ))

    #expect(store.connectionPhase == .live)
    #expect(store.livePayload?.pendingInteraction?.id == "pending-1")
}

@MainActor
@Test
func liveBridgeStoreHandlesInteractionAndPresenceUpdates() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: DextunnelPendingInteraction(
            actionKind: "approval",
            approveLabel: "Approve once",
            requestId: "req-1",
            summary: "Approve command",
            subject: "Command",
            title: "Approve command"
        ),
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: nil,
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(service: service)

    await store.bootstrap()
    await store.respondToPendingInteraction(action: "approve")
    await store.syncPresence(visible: true, focused: true, engaged: true)

    #expect(service.interactionActions == ["approve"])
    #expect(service.presenceUpdates.count == 1)
    #expect(store.livePayload?.pendingInteraction == nil)
}

@MainActor
@Test
func liveBridgeStoreMarksInterruptedQueuedSendAsFailedOnRestore() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let persistence = InMemoryDraftPersistence()
    persistence.saveState(
        DextunnelPersistedDraftState(
            draftText: "",
            queuedDrafts: [
                DextunnelQueuedDraft(
                    text: "interrupted send",
                    deliveryState: .sending
                )
            ]
        ),
        threadId: "thread-1"
    )

    let store = DextunnelLiveBridgeStore(
        service: FakeBridgeService(livePayload: payload, threads: []),
        draftPersistence: persistence
    )

    await store.bootstrap()

    #expect(store.queuedDrafts.count == 1)
    #expect(store.queuedDrafts.first?.deliveryState == .failed)
    #expect(store.queuedDrafts.first?.lastErrorMessage == "Send status was interrupted. Retry to confirm delivery.")
}

@MainActor
@Test
func liveBridgeStoreMarksInterruptedDirectSendAsFailedOnRestore() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let persistence = InMemoryDraftPersistence()
    persistence.saveState(
        DextunnelPersistedDraftState(
            draftText: "",
            queuedDrafts: [],
            pendingDirectSend: DextunnelQueuedDraft(
                text: "direct send interrupted",
                deliveryState: .sending
            )
        ),
        threadId: "thread-1"
    )

    let store = DextunnelLiveBridgeStore(
        service: FakeBridgeService(livePayload: payload, threads: []),
        draftPersistence: persistence
    )

    await store.bootstrap()

    #expect(store.queuedDrafts.count == 1)
    #expect(store.queuedDrafts.first?.text == "direct send interrupted")
    #expect(store.queuedDrafts.first?.deliveryState == .failed)
    #expect(store.queuedDrafts.first?.lastErrorMessage == "Send status was interrupted. Retry to confirm delivery.")
}

@MainActor
@Test
func liveBridgeStorePersistsPendingDirectSendWhileSendIsInFlight() async throws {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let persistence = InMemoryDraftPersistence()
    let service = FakeBridgeService(livePayload: payload, threads: [])
    service.sendTurnDelayNanoseconds = 150_000_000
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: persistence
    )

    await store.bootstrap()
    store.draftText = "durable direct send"

    let sendTask = Task {
        await store.sendCurrentDraft()
    }
    await Task.yield()
    try await Task.sleep(nanoseconds: 20_000_000)

    let persisted = try #require(persistence.state(threadId: "thread-1"))
    #expect(persisted.pendingDirectSend?.text == "durable direct send")
    #expect(persisted.pendingDirectSend?.deliveryState == .sending)

    await sendTask.value

    let persistedAfterSend = persistence.state(threadId: "thread-1")
    #expect(persistedAfterSend?.pendingDirectSend == nil)
    #expect(store.recentDeliveredDrafts.first?.text == "durable direct send")
}

@MainActor
@Test
func liveBridgeStoreRetriesFailedQueuedDrafts() async throws {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    enum FakeFailure: Error {
        case offline
    }
    let service = FakeBridgeService(livePayload: payload, threads: [])
    service.sendTurnError = FakeFailure.offline
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "retry me"
    store.queueCurrentDraft()
    await store.flushFirstQueuedDraft()

    let queuedId = try #require(store.queuedDrafts.first?.id)
    #expect(store.queuedDrafts.first?.deliveryState == .failed)

    service.sendTurnError = nil
    await store.retryQueuedDraft(id: queuedId)

    #expect(service.sentTexts == ["retry me"])
    #expect(store.queuedDrafts.isEmpty)
    #expect(store.recentDeliveredDrafts.map(\.text) == ["retry me"])
}

@MainActor
@Test
func liveBridgeStoreFlushesQueuedDraftsSequentiallyWithoutWaitingForExtraEvents() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "first queued"
    store.queueCurrentDraft()
    store.draftText = "second queued"
    store.queueCurrentDraft()

    await store.flushFirstQueuedDraft()

    #expect(service.sentTexts == ["first queued", "second queued"])
    #expect(store.queuedDrafts.isEmpty)
    #expect(store.recentDeliveredDrafts.map(\.text) == ["second queued", "first queued"])
}

@MainActor
@Test
func liveBridgeStoreConfirmsDeliveredDraftWhenTranscriptShowsRemoteTurn() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            ),
            transcript: []
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "confirm me"
    await store.sendCurrentDraft()

    #expect(store.recentDeliveredDrafts.first?.deliveryState == .delivered)

    service.livePayload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: payload.selectedChannel,
        selectedProjectCwd: payload.selectedProjectCwd,
        selectedThreadId: payload.selectedThreadId,
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: payload.selectedThreadSnapshot?.channel,
            thread: payload.selectedThreadSnapshot?.thread,
            transcript: [
                DextunnelTranscriptEntry(
                    lane: "remote",
                    participant: DextunnelParticipant(id: "remote", label: "remote"),
                    role: "user",
                    text: "confirm me"
                )
            ]
        ),
        status: payload.status
    )

    await store.refresh()

    #expect(store.recentDeliveredDrafts.first?.deliveryState == .confirmed)
}

@MainActor
@Test
func liveBridgeStoreBlocksRoomSwitchWhileSending() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#thread-1",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "thread-1",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: nil,
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let threads = [
        DextunnelThreadSummary(
            channelLabel: "thread-1",
            channelSlug: "#thread-1",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-1",
            name: "thread-1",
            preview: nil,
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: nil
        ),
        DextunnelThreadSummary(
            channelLabel: "thread-2",
            channelSlug: "#thread-2",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-2",
            name: "thread-2",
            preview: nil,
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: nil
        )
    ]
    let service = FakeBridgeService(livePayload: payload, threads: threads)
    service.sendTurnDelayNanoseconds = 100_000_000
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "hold position"

    let sendTask = Task {
        await store.sendCurrentDraft()
    }
    await Task.yield()
    try? await Task.sleep(nanoseconds: 20_000_000)
    await store.select(thread: threads[1])
    await sendTask.value

    #expect(store.selectedThreadId == "thread-1")
    #expect(service.sentTexts == ["hold position"])
}

@MainActor
@Test
func liveBridgeStoreFallsBackToSnapshotThreadIdWhenSelectedThreadIdIsMissing() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#thread-1",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: nil,
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "thread-1",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: DextunnelControlLease(
                clientId: "remote-2",
                expiresAt: "2026-03-21T00:00:00Z",
                owner: "remote",
                ownerClientId: "remote-2",
                reason: "test",
                source: "remote",
                threadId: "thread-1"
            ),
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    await store.claimControl()

    #expect(store.selectedThreadId == "thread-1")
    #expect(store.controlLeaseForSelection?.threadId == "thread-1")
    #expect(service.livePayload.status.controlLeaseForSelection?.threadId == "thread-1")
}

@MainActor
@Test
func liveBridgeStoreReconnectsAndRefreshesAfterTransientStreamTimeout() async throws {
    let initialPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "before reconnect"
    )
    let refreshedPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "after reconnect refresh"
    )
    let service = FakeBridgeService(livePayload: initialPayload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence(),
        reconnectDelayNanoseconds: 20_000_000,
        idleRefreshInterval: 30,
        idleRefreshPollNanoseconds: 1_000_000_000
    )

    await store.bootstrap()
    store.startStreaming()
    try await waitUntil { service.eventStreamCalls >= 1 && !service.eventContinuations.isEmpty }

    service.livePayload = refreshedPayload
    service.finishEventStream(error: URLError(.timedOut))

    try await waitUntilAsync {
        await MainActor.run { store.reconnectCount >= 1 }
    }
    try await waitUntilAsync {
        await MainActor.run {
            store.lastSuccessfulRefreshAt != nil &&
                store.livePayload?.selectedThreadSnapshot?.transcript.first?.text == "after reconnect refresh"
        }
    }
    try await waitUntil(timeoutNanoseconds: 1_500_000_000) { service.eventStreamCalls >= 2 }

    #expect(store.lastReconnectAt != nil)
    #expect(store.reconnectCount >= 1)
    #expect(store.lastSuccessfulRefreshAt != nil)
    #expect(service.reconnectCalls >= 1 || store.connectionPhase == .live)
}

@MainActor
@Test
func liveBridgeStorePerformsIdleWatchdogRefreshAndForegroundResumeRefresh() async throws {
    let initialPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "initial transcript"
    )
    let idlePayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "idle watchdog refresh"
    )
    let resumedPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "foreground resume refresh"
    )
    let service = FakeBridgeService(livePayload: initialPayload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence(),
        reconnectDelayNanoseconds: 20_000_000,
        idleRefreshInterval: 0.05,
        idleRefreshPollNanoseconds: 20_000_000
    )

    await store.bootstrap()
    store.startStreaming()
    service.livePayload = idlePayload

    try await waitUntil { service.refreshCalls >= 1 }
    try await waitUntilAsync {
        await MainActor.run {
            store.livePayload?.selectedThreadSnapshot?.transcript.first?.text == "idle watchdog refresh"
        }
    }

    await store.setForegroundActive(false)
    service.livePayload = resumedPayload
    await store.setForegroundActive(true)

    try await waitUntil { service.refreshCalls >= 2 }
    try await waitUntilAsync {
        await MainActor.run {
            store.livePayload?.selectedThreadSnapshot?.transcript.first?.text == "foreground resume refresh"
        }
    }
}

@MainActor
@Test
func liveBridgeStoreTreatsOwnerClientIdLeaseAsOwnedControl() async {
    let payload = DextunnelLivePayload(
        pendingInteraction: nil,
        selectedAttachments: [],
        selectedChannel: DextunnelSelectedChannel(
            channelSlug: "#dextunnel",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            topic: "topic"
        ),
        selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
        selectedThreadId: "thread-1",
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
            channel: nil,
            thread: DextunnelSelectedThread(
                activeTurnId: nil,
                cwd: "/Users/zsolt/dev/codex/dextunnel",
                id: "thread-1",
                name: "dextunnel",
                source: "vscode",
                status: "completed"
            )
        ),
        status: DextunnelLiveStatus(
            controlLeaseForSelection: DextunnelControlLease(
                clientId: "lease-token-123",
                expiresAt: "2026-03-21T00:00:00Z",
                owner: "remote",
                ownerClientId: "remote-1",
                reason: "test",
                source: "remote",
                threadId: "thread-1"
            ),
            diagnostics: [],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "hello from native"

    #expect(store.holdsControlLease)
    #expect(store.availability.canSteer)
    #expect(store.availability.statusMessage == "Ready")
}

@MainActor
@Test
func liveBridgeStoreAdoptsBridgeStateWhenClaimIsRejected() async throws {
    let payload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "before claim"
    )
    let service = FakeBridgeService(livePayload: payload, threads: [])
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    service.claimControlError = DextunnelLiveBridgeStoreTests.httpConflict(
        message: "Another remote surface currently holds control for this channel.",
        state: DextunnelLiveBridgeStoreTests.withForeignRemoteControl(payload)
    )

    await store.claimControl()

    #expect(store.holdsControlLease == false)
    #expect(store.controlLeaseForSelection?.ownerClientId == "remote-2")
    #expect(store.connectionPhase == .live)
    #expect(store.lastErrorMessage == "Another remote surface currently holds control for this channel.")
}

@MainActor
@Test
func liveBridgeStoreAdoptsBridgeStateWhenSendIsRejected() async throws {
    let payload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "before send"
    )
    let service = FakeBridgeService(
        livePayload: DextunnelLiveBridgeStoreTests.withOwnedRemoteControl(payload),
        threads: []
    )
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()
    store.draftText = "hello from the sim"
    service.sendTurnError = DextunnelLiveBridgeStoreTests.httpConflict(
        message: "Another remote surface currently holds control for this channel.",
        state: DextunnelLiveBridgeStoreTests.withForeignRemoteControl(payload)
    )

    await store.sendCurrentDraft()

    #expect(store.draftText == "hello from the sim")
    #expect(store.holdsControlLease == false)
    #expect(store.controlLeaseForSelection?.ownerClientId == "remote-2")
    #expect(store.connectionPhase == .live)
    #expect(store.lastErrorMessage == "Another remote surface currently holds control for this channel.")
}

@MainActor
@Test
func liveBridgeStoreSchedulesPassiveRefreshAfterDirectSend() async throws {
    let initialPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "before direct send"
    )
    let service = FakeBridgeService(
        livePayload: DextunnelLiveBridgeStoreTests.withOwnedRemoteControl(initialPayload),
        threads: []
    )
    let refreshedPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "after direct send refresh"
    )
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence(),
        postSendRefreshDelayNanoseconds: 80_000_000
    )

    await store.bootstrap()
    store.draftText = "hello from the sim"
    service.livePayload = DextunnelLiveBridgeStoreTests.withOwnedRemoteControl(refreshedPayload)

    await store.sendCurrentDraft()

    #expect(service.sentTexts == ["hello from the sim"])
    #expect(store.isSending == false)
    #expect(store.pendingDirectSend == nil)
    #expect(store.recentDeliveredDrafts.first?.text == "hello from the sim")
    #expect(service.fetchLivePayloadCalls == 1)

    try await waitUntilAsync(timeoutNanoseconds: 900_000_000) {
        await MainActor.run {
            service.refreshCalls >= 1 &&
                store.livePayload?.selectedThreadSnapshot?.transcript.first?.text == "after direct send refresh"
        }
    }
}

@MainActor
@Test
func liveBridgeStoreUsesThreadSummariesIncludedInBootstrapPayload() async {
    let payload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "bootstrap"
    )
    let payloadThreads = [
        DextunnelThreadSummary(
            channelLabel: "dextunnel",
            channelSlug: "#dextunnel",
            cwd: "/Users/zsolt/dev/codex/dextunnel",
            id: "thread-1",
            name: "dextunnel",
            preview: "latest from payload",
            serverLabel: "codex/dextunnel",
            source: "vscode",
            status: "completed",
            updatedAt: "2026-03-21T00:00:00Z"
        )
    ]
    let service = FakeBridgeService(
        livePayload: DextunnelLivePayload(
            pendingInteraction: payload.pendingInteraction,
            selectedAttachments: payload.selectedAttachments,
            selectedChannel: payload.selectedChannel,
            selectedProjectCwd: payload.selectedProjectCwd,
            selectedThreadId: payload.selectedThreadId,
            selectedThreadSnapshot: payload.selectedThreadSnapshot,
            status: payload.status,
            threads: payloadThreads,
            turnDiff: payload.turnDiff
        ),
        threads: [
            DextunnelThreadSummary(
                channelLabel: "stale",
                channelSlug: "#stale",
                cwd: "/tmp",
                id: "thread-stale",
                name: "stale",
                preview: "stale thread list",
                serverLabel: "codex/stale",
                source: "vscode",
                status: "completed",
                updatedAt: "2026-03-20T00:00:00Z"
            )
        ]
    )
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence()
    )

    await store.bootstrap()

    #expect(service.fetchThreadsCalls == 0)
    #expect(store.threads.count == 1)
    #expect(store.threads.first?.preview == "latest from payload")
}

@MainActor
@Test
func liveBridgeStoreSkipsFallbackRefreshWhenLiveEventArrivesAfterSend() async throws {
    let initialPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "before send"
    )
    let refreshedPayload = DextunnelLiveBridgeStoreTests.makePayload(
        threadId: "thread-1",
        channelSlug: "#dextunnel",
        transcriptText: "arrived from live event"
    )
    let service = FakeBridgeService(
        livePayload: DextunnelLiveBridgeStoreTests.withOwnedRemoteControl(initialPayload),
        threads: []
    )
    let store = DextunnelLiveBridgeStore(
        service: service,
        draftPersistence: InMemoryDraftPersistence(),
        postSendRefreshDelayNanoseconds: 150_000_000
    )

    await store.bootstrap()
    store.draftText = "hello from the sim"

    await store.sendCurrentDraft()
    let eventData = try JSONEncoder().encode(DextunnelLiveBridgeStoreTests.withOwnedRemoteControl(refreshedPayload))
    let liveEvent = DextunnelServerSentEvent(
        event: "live",
        data: String(decoding: eventData, as: UTF8.self)
    )
    await store.apply(event: liveEvent)

    try await waitUntilAsync(timeoutNanoseconds: 500_000_000) {
        await MainActor.run {
            store.livePayload?.selectedThreadSnapshot?.transcript.first?.text == "arrived from live event"
        }
    }

    try await Task.sleep(nanoseconds: 250_000_000)

    #expect(service.refreshCalls == 0)
}

private enum DextunnelLiveBridgeStoreTests {
    static func makePayload(
        threadId: String,
        channelSlug: String,
        transcriptText: String
    ) -> DextunnelLivePayload {
        DextunnelLivePayload(
            pendingInteraction: nil,
            selectedAttachments: [],
            selectedChannel: DextunnelSelectedChannel(
                channelSlug: channelSlug,
                serverLabel: "codex/dextunnel",
                source: "vscode",
                topic: "topic"
            ),
            selectedProjectCwd: "/Users/zsolt/dev/codex/dextunnel",
            selectedThreadId: threadId,
            selectedThreadSnapshot: DextunnelSelectedThreadSnapshot(
                channel: nil,
                thread: DextunnelSelectedThread(
                    activeTurnId: nil,
                    cwd: "/Users/zsolt/dev/codex/dextunnel",
                    id: threadId,
                    name: "dextunnel",
                    source: "vscode",
                    status: "completed"
                ),
                transcript: [
                    DextunnelTranscriptEntry(
                        lane: "updates",
                        participant: DextunnelParticipant(id: "codex", label: "codex"),
                        role: "assistant",
                        text: transcriptText
                    )
                ]
            ),
            status: DextunnelLiveStatus(
                controlLeaseForSelection: nil,
                diagnostics: [],
                runtimeProfile: "default",
                selectionMode: "shared-room",
                watcherConnected: true
            ),
            threads: [
                DextunnelThreadSummary(
                    channelLabel: threadId == "thread-1" ? "dextunnel" : threadId,
                    channelSlug: channelSlug,
                    cwd: "/Users/zsolt/dev/codex/dextunnel",
                    id: threadId,
                    name: threadId == "thread-1" ? "dextunnel" : threadId,
                    preview: transcriptText,
                    serverLabel: "codex/dextunnel",
                    source: "vscode",
                    status: "completed",
                    updatedAt: "2026-03-21T00:00:00Z"
                )
            ]
        )
    }

    static func withOwnedRemoteControl(_ payload: DextunnelLivePayload) -> DextunnelLivePayload {
        DextunnelLivePayload(
            pendingInteraction: payload.pendingInteraction,
            selectedAttachments: payload.selectedAttachments,
            selectedChannel: payload.selectedChannel,
            selectedProjectCwd: payload.selectedProjectCwd,
            selectedThreadId: payload.selectedThreadId,
            selectedThreadSnapshot: payload.selectedThreadSnapshot,
            status: DextunnelLiveStatus(
                controlLeaseForSelection: DextunnelControlLease(
                    clientId: "lease-token-123",
                    expiresAt: "2026-03-21T00:00:00Z",
                    owner: "remote",
                    ownerClientId: "remote-1",
                    reason: "test",
                    source: "remote",
                    threadId: payload.selectedThreadId
                ),
                diagnostics: payload.status.diagnostics,
                runtimeProfile: payload.status.runtimeProfile,
                selectionMode: payload.status.selectionMode,
                watcherConnected: payload.status.watcherConnected
            ),
            threads: payload.threads,
            turnDiff: payload.turnDiff
        )
    }

    static func withForeignRemoteControl(_ payload: DextunnelLivePayload) -> DextunnelLivePayload {
        DextunnelLivePayload(
            pendingInteraction: payload.pendingInteraction,
            selectedAttachments: payload.selectedAttachments,
            selectedChannel: payload.selectedChannel,
            selectedProjectCwd: payload.selectedProjectCwd,
            selectedThreadId: payload.selectedThreadId,
            selectedThreadSnapshot: payload.selectedThreadSnapshot,
            status: DextunnelLiveStatus(
                controlLeaseForSelection: DextunnelControlLease(
                    clientId: "lease-token-foreign",
                    expiresAt: "2026-03-21T00:00:00Z",
                    owner: "remote",
                    ownerClientId: "remote-2",
                    reason: "test",
                    source: "remote",
                    threadId: payload.selectedThreadId
                ),
                diagnostics: payload.status.diagnostics,
                runtimeProfile: payload.status.runtimeProfile,
                selectionMode: payload.status.selectionMode,
                watcherConnected: payload.status.watcherConnected
            ),
            threads: payload.threads,
            turnDiff: payload.turnDiff
        )
    }

    static func httpConflict(message: String, state: DextunnelLivePayload) -> DextunnelBridgeHTTPError {
        let encoder = JSONEncoder()
        let bodyData = try? encoder.encode(["error": message])
        let stateData = try? encoder.encode(DextunnelLiveStateEnvelopeForTests(error: message, state: state))
        let body = String(data: stateData ?? bodyData ?? Data(), encoding: .utf8)
        return DextunnelBridgeHTTPError(statusCode: 409, message: message, body: body)
    }
}

private struct DextunnelLiveStateEnvelopeForTests: Codable {
    let error: String
    let state: DextunnelLivePayload
}

private func waitUntil(
    timeoutNanoseconds: UInt64 = 500_000_000,
    pollNanoseconds: UInt64 = 10_000_000,
    condition: @escaping @Sendable () -> Bool
) async throws {
    let start = DispatchTime.now().uptimeNanoseconds
    while !condition() {
        if DispatchTime.now().uptimeNanoseconds - start > timeoutNanoseconds {
            throw WaitUntilTimeoutError()
        }
        try await Task.sleep(nanoseconds: pollNanoseconds)
    }
}

private func waitUntilAsync(
    timeoutNanoseconds: UInt64 = 500_000_000,
    pollNanoseconds: UInt64 = 10_000_000,
    condition: @escaping @Sendable () async -> Bool
) async throws {
    let start = DispatchTime.now().uptimeNanoseconds
    while !(await condition()) {
        if DispatchTime.now().uptimeNanoseconds - start > timeoutNanoseconds {
            throw WaitUntilTimeoutError()
        }
        try await Task.sleep(nanoseconds: pollNanoseconds)
    }
}

private struct WaitUntilTimeoutError: Error {}
