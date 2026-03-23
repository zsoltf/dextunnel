import Foundation
import Observation
import DextunnelBridgeClient
import DextunnelBridgeProtocol
import DextunnelOperatorCore

public protocol DextunnelDraftPersistence {
    func loadState(threadId: String) -> DextunnelPersistedDraftState?
    func saveState(_ state: DextunnelPersistedDraftState, threadId: String)
    func clearState(threadId: String)
}

public enum DextunnelBridgeConnectionPhase: String, Sendable {
    case idle
    case connecting
    case live
    case reconnecting
    case failed
}

public enum DextunnelQueuedDraftDeliveryState: String, Codable, Equatable, Sendable {
    case queued
    case sending
    case failed
    case delivered
    case confirmed
}

public struct DextunnelQueuedDraft: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let text: String
    public let deliveryState: DextunnelQueuedDraftDeliveryState
    public let lastErrorMessage: String?

    public init(
        id: UUID = UUID(),
        text: String,
        deliveryState: DextunnelQueuedDraftDeliveryState = .queued,
        lastErrorMessage: String? = nil
    ) {
        self.id = id
        self.text = text
        self.deliveryState = deliveryState
        self.lastErrorMessage = lastErrorMessage
    }

    enum CodingKeys: String, CodingKey {
        case id
        case text
        case deliveryState
        case lastErrorMessage
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        text = try container.decode(String.self, forKey: .text)
        deliveryState = try container.decodeIfPresent(DextunnelQueuedDraftDeliveryState.self, forKey: .deliveryState) ?? .queued
        lastErrorMessage = try container.decodeIfPresent(String.self, forKey: .lastErrorMessage)
    }

    public func queued() -> DextunnelQueuedDraft {
        DextunnelQueuedDraft(id: id, text: text, deliveryState: .queued)
    }

    public func sending() -> DextunnelQueuedDraft {
        DextunnelQueuedDraft(id: id, text: text, deliveryState: .sending)
    }

    public func failed(_ message: String) -> DextunnelQueuedDraft {
        DextunnelQueuedDraft(id: id, text: text, deliveryState: .failed, lastErrorMessage: message)
    }

    public func delivered() -> DextunnelQueuedDraft {
        DextunnelQueuedDraft(id: id, text: text, deliveryState: .delivered)
    }

    public func confirmed() -> DextunnelQueuedDraft {
        DextunnelQueuedDraft(id: id, text: text, deliveryState: .confirmed)
    }
}

public struct DextunnelStoreNotificationSnapshot: Equatable, Sendable {
    public let roomTitle: String
    public let pendingInteractionDetail: String?
    public let pendingInteractionId: String?
    public let pendingInteractionTitle: String?
    public let failedDraftError: String?
    public let failedDraftId: UUID?
    public let failedDraftText: String?

    public init(
        roomTitle: String,
        pendingInteractionDetail: String? = nil,
        pendingInteractionId: String? = nil,
        pendingInteractionTitle: String? = nil,
        failedDraftError: String? = nil,
        failedDraftId: UUID? = nil,
        failedDraftText: String? = nil
    ) {
        self.roomTitle = roomTitle
        self.pendingInteractionDetail = pendingInteractionDetail
        self.pendingInteractionId = pendingInteractionId
        self.pendingInteractionTitle = pendingInteractionTitle
        self.failedDraftError = failedDraftError
        self.failedDraftId = failedDraftId
        self.failedDraftText = failedDraftText
    }
}

public struct DextunnelPersistedDraftState: Codable, Equatable, Sendable {
    public let draftText: String
    public let queuedDrafts: [DextunnelQueuedDraft]
    public let pendingDirectSend: DextunnelQueuedDraft?
    public let recentDeliveredDrafts: [DextunnelQueuedDraft]

    public init(
        draftText: String,
        queuedDrafts: [DextunnelQueuedDraft],
        pendingDirectSend: DextunnelQueuedDraft? = nil,
        recentDeliveredDrafts: [DextunnelQueuedDraft] = []
    ) {
        self.draftText = draftText
        self.queuedDrafts = queuedDrafts
        self.pendingDirectSend = pendingDirectSend
        self.recentDeliveredDrafts = recentDeliveredDrafts
    }

    enum CodingKeys: String, CodingKey {
        case draftText
        case queuedDrafts
        case pendingDirectSend
        case recentDeliveredDrafts
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        draftText = try container.decode(String.self, forKey: .draftText)
        queuedDrafts = try container.decodeIfPresent([DextunnelQueuedDraft].self, forKey: .queuedDrafts) ?? []
        pendingDirectSend = try container.decodeIfPresent(DextunnelQueuedDraft.self, forKey: .pendingDirectSend)
        recentDeliveredDrafts = try container.decodeIfPresent([DextunnelQueuedDraft].self, forKey: .recentDeliveredDrafts) ?? []
    }
}

public final class DextunnelUserDefaultsDraftPersistence: DextunnelDraftPersistence {
    private let userDefaults: UserDefaults
    private let defaultsKeyPrefix: String

    public init(
        userDefaults: UserDefaults = .standard,
        defaultsKeyPrefix: String = "dextunnel.native.drafts"
    ) {
        self.userDefaults = userDefaults
        self.defaultsKeyPrefix = defaultsKeyPrefix
    }

    public func loadState(threadId: String) -> DextunnelPersistedDraftState? {
        guard let data = userDefaults.data(forKey: key(for: threadId)) else {
            return nil
        }
        return try? JSONDecoder().decode(DextunnelPersistedDraftState.self, from: data)
    }

    public func saveState(_ state: DextunnelPersistedDraftState, threadId: String) {
        guard let data = try? JSONEncoder().encode(state) else {
            return
        }
        userDefaults.set(data, forKey: key(for: threadId))
    }

    public func clearState(threadId: String) {
        userDefaults.removeObject(forKey: key(for: threadId))
    }

    private func key(for threadId: String) -> String {
        "\(defaultsKeyPrefix).\(threadId)"
    }
}

@MainActor
@Observable
public final class DextunnelLiveBridgeStore {
    public private(set) var connectionPhase: DextunnelBridgeConnectionPhase = .idle
    public var draftText: String = "" {
        didSet { persistDraftStateForCurrentThread() }
    }
    public private(set) var isRefreshing = false
    public private(set) var isSelecting = false
    public private(set) var isSending = false
    public var isDictating = false
    public private(set) var lastErrorMessage: String?
    public private(set) var lastRevealMessage: String?
    public private(set) var livePayload: DextunnelLivePayload?
    public private(set) var lastLiveEventAt: Date?
    public private(set) var lastSuccessfulRefreshAt: Date?
    public private(set) var lastReconnectAt: Date?
    public private(set) var reconnectCount = 0
    public private(set) var queuedDrafts: [DextunnelQueuedDraft] = [] {
        didSet { persistDraftStateForCurrentThread() }
    }
    public private(set) var pendingDirectSend: DextunnelQueuedDraft? {
        didSet { persistDraftStateForCurrentThread() }
    }
    public private(set) var recentDeliveredDrafts: [DextunnelQueuedDraft] = [] {
        didSet { persistDraftStateForCurrentThread() }
    }
    public private(set) var threads: [DextunnelThreadSummary] = []

    private let service: any DextunnelBridgeService
    private let draftPersistence: any DextunnelDraftPersistence
    private let now: @Sendable () -> Date
    private let reconnectDelayNanoseconds: UInt64
    private let idleRefreshInterval: TimeInterval
    private let idleRefreshPollNanoseconds: UInt64
    private let postSendRefreshDelayNanoseconds: UInt64
    private var currentDraftThreadId: String?
    private var streamTask: Task<Void, Never>?
    private var watchdogTask: Task<Void, Never>?
    private var postSendRefreshTask: Task<Void, Never>?
    private var isForegroundActive = true
    private var isPassiveRefreshing = false

    public init(
        service: any DextunnelBridgeService,
        draftPersistence: any DextunnelDraftPersistence = DextunnelUserDefaultsDraftPersistence(),
        now: @escaping @Sendable () -> Date = Date.init,
        reconnectDelayNanoseconds: UInt64 = 600_000_000,
        idleRefreshInterval: TimeInterval = 18,
        idleRefreshPollNanoseconds: UInt64 = 3_000_000_000,
        postSendRefreshDelayNanoseconds: UInt64 = 650_000_000
    ) {
        self.service = service
        self.draftPersistence = draftPersistence
        self.now = now
        self.reconnectDelayNanoseconds = reconnectDelayNanoseconds
        self.idleRefreshInterval = idleRefreshInterval
        self.idleRefreshPollNanoseconds = idleRefreshPollNanoseconds
        self.postSendRefreshDelayNanoseconds = postSendRefreshDelayNanoseconds
    }

    public var availability: DextunnelOperatorAvailability {
        DextunnelOperatorCore.availability(for: DextunnelOperatorContext(
            activeTurnId: livePayload?.selectedThreadSnapshot?.thread?.activeTurnId,
            hasAnyRemoteControl: livePayload?.status.controlLeaseForSelection != nil,
            hasDraftText: !draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            hasRemoteControl: hasRemoteControl,
            isControlling: false,
            isDictating: isDictating,
            isSelecting: isSelecting,
            isSendingReply: isSending,
            ownerLabel: livePayload?.status.controlLeaseForSelection?.owner ?? "",
            pendingInteraction: livePayload?.pendingInteraction != nil,
            queuedCount: queuedDrafts.count,
            threadId: selectedThreadId,
            threadStatus: livePayload?.selectedThreadSnapshot?.thread?.status,
            watcherConnected: livePayload?.status.watcherConnected ?? false,
            writeLockStatus: nil
        ))
    }

    public var menuBarOverview: DextunnelMenuBarOverview? {
        guard let livePayload else {
            return nil
        }
        return DextunnelOperatorCore.menuBarOverview(from: livePayload)
    }

    public var controlLeaseForSelection: DextunnelControlLease? {
        livePayload?.status.controlLeaseForSelection
    }

    public var holdsControlLease: Bool {
        hasRemoteControl
    }

    public var selectedThreadId: String {
        normalizedThreadId(from: livePayload?.selectedThreadId) ??
            normalizedThreadId(from: livePayload?.selectedThreadSnapshot?.thread?.id) ??
            normalizedThreadId(from: livePayload?.status.controlLeaseForSelection?.threadId) ??
            ""
    }

    public var notificationSnapshot: DextunnelStoreNotificationSnapshot {
        let pending = livePayload?.pendingInteraction
        let failedDraft = queuedDrafts.first(where: { $0.deliveryState == .failed })
        return DextunnelStoreNotificationSnapshot(
            roomTitle: currentRoomTitle,
            pendingInteractionDetail: pending?.detail ?? pending?.message,
            pendingInteractionId: pending?.id ?? pending?.requestId,
            pendingInteractionTitle: pending?.title ?? pending?.summary ?? pending?.subject,
            failedDraftError: failedDraft?.lastErrorMessage,
            failedDraftId: failedDraft?.id,
            failedDraftText: failedDraft?.text
        )
    }

    public var currentRoomTitle: String {
        let channelTitle = livePayload?.selectedChannel?.channelSlug?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !channelTitle.isEmpty {
            return channelTitle
        }

        let threadTitle = livePayload?.selectedThreadSnapshot?.thread?.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !threadTitle.isEmpty {
            return threadTitle
        }

        if let threadId = selectedThreadIdValue,
           let matchingThread = threads.first(where: { $0.id == threadId })
        {
            let summaryTitle = matchingThread.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !summaryTitle.isEmpty {
                return summaryTitle
            }
            let summaryId = matchingThread.id.trimmingCharacters(in: .whitespacesAndNewlines)
            if !summaryId.isEmpty {
                return summaryId
            }
        }

        if let threadId = selectedThreadIdValue, !threadId.isEmpty {
            return threadId
        }

        return "No channel selected"
    }

    public var connectionNoticeText: String? {
        switch connectionPhase {
        case .connecting:
            return "Connecting live updates..."
        case .reconnecting:
            return "Live updates reconnecting..."
        case .idle, .live, .failed:
            return nil
        }
    }

    public func bootstrap() async {
        let previousThreadId = currentDraftThreadId
        connectionPhase = livePayload == nil ? .connecting : .reconnecting
        lastErrorMessage = nil

        do {
            let payload = try await service.fetchLivePayload()
            let nextThreads = try await resolveThreadSummaries(for: payload)
            adoptLivePayload(payload, previousThreadId: previousThreadId, threads: nextThreads)
            lastSuccessfulRefreshAt = now()
            connectionPhase = payload.status.watcherConnected ? .live : .reconnecting
            await maybeFlushQueue()
        } catch {
            presentError(error)
        }
    }

    public func startStreaming() {
        streamTask?.cancel()
        watchdogTask?.cancel()
        streamTask = Task { [weak self] in
            await self?.runStreamLoop()
        }
        watchdogTask = Task { [weak self] in
            await self?.runIdleRefreshWatchdog()
        }
    }

    public func stopStreaming() {
        streamTask?.cancel()
        watchdogTask?.cancel()
        postSendRefreshTask?.cancel()
        streamTask = nil
        watchdogTask = nil
        postSendRefreshTask = nil
    }

    public func refresh() async {
        await performRefresh(passive: false)
    }

    public func reconnect() async {
        await performReconnect(passive: false)
    }

    public func setForegroundActive(_ isActive: Bool) async {
        let wasActive = isForegroundActive
        isForegroundActive = isActive
        guard isActive, !wasActive else {
            return
        }

        if livePayload == nil {
            await bootstrap()
        } else {
            if connectionPhase == .reconnecting || livePayload?.status.watcherConnected == false {
                await performReconnect(passive: true)
            } else {
                await performRefresh(passive: true, preserveReconnectState: false)
            }
        }
    }

    public func select(thread: DextunnelThreadSummary) async {
        guard !isSending else {
            lastErrorMessage = "Wait for the current send to finish before switching rooms."
            return
        }
        let previousThreadId = currentDraftThreadId
        isSelecting = true
        defer { isSelecting = false }
        do {
            let payload = try await service.select(threadId: thread.id, cwd: thread.cwd)
            let nextThreads = try await resolveThreadSummaries(for: payload)
            adoptLivePayload(payload, previousThreadId: previousThreadId, threads: nextThreads)
            lastErrorMessage = nil
            connectionPhase = .live
            await maybeFlushQueue()
        } catch {
            adoptBridgeState(from: error, previousThreadId: previousThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func revealSelectedThreadInCodex() async {
        guard let threadId = selectedThreadIdValue else {
            return
        }
        do {
            let response = try await service.revealInCodex(threadId: threadId)
            lastRevealMessage = response.message
        } catch {
            presentError(error, markFailed: false)
        }
    }

    public func queueCurrentDraft() {
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return
        }
        queuedDrafts.append(DextunnelQueuedDraft(text: text, deliveryState: .queued))
        draftText = ""
    }

    public func removeQueuedDraft(id: DextunnelQueuedDraft.ID) {
        queuedDrafts.removeAll { $0.id == id }
    }

    public func clearQueuedDrafts() {
        queuedDrafts = []
    }

    public func retryQueuedDraft(id: DextunnelQueuedDraft.ID) async {
        updateQueuedDraft(id) { $0.queued() }
        await maybeFlushQueue()
    }

    public func clearRecentDeliveredDrafts() {
        recentDeliveredDrafts = []
    }

    public func sendCurrentDraft() async {
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return
        }

        guard availability.canSteer else {
            lastErrorMessage = availability.statusMessage
            return
        }

        draftText = ""
        isSending = true
        defer { isSending = false }
        let receiptId = UUID()
        let targetThreadId = selectedThreadIdValue
        let sendStartedAt = now()
        pendingDirectSend = DextunnelQueuedDraft(
            id: receiptId,
            text: text,
            deliveryState: .sending
        )

        do {
            if !hasRemoteControl {
                let claimedPayload = try await service.claimControl(threadId: targetThreadId, reason: "native_compose")
                adoptLivePayload(claimedPayload, previousThreadId: currentDraftThreadId, threads: claimedPayload.threads ?? threads)
            }
            try await service.sendTurn(text: text, threadId: targetThreadId, attachments: [])
            pendingDirectSend = nil
            recordDeliveredDraft(id: receiptId, text: text)
            lastErrorMessage = nil
            connectionPhase = .live
            schedulePostSendRefresh(after: sendStartedAt)
        } catch {
            pendingDirectSend = nil
            draftText = text
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func flushFirstQueuedDraft() async {
        guard let queuedDraft = nextFlushableQueuedDraft else {
            return
        }

        guard availability.canSteer || (queuedDrafts.count > 0 && canClaimForQueuedSend) else {
            return
        }

        isSending = true
        defer {
            if isSending {
                isSending = false
            }
        }
        let targetThreadId = selectedThreadIdValue
        let sendStartedAt = now()
        updateQueuedDraft(queuedDraft.id) { $0.sending() }
        var shouldContinueQueue = false

        do {
            if !hasRemoteControl {
                let claimedPayload = try await service.claimControl(threadId: targetThreadId, reason: "native_queue")
                adoptLivePayload(claimedPayload, previousThreadId: currentDraftThreadId, threads: claimedPayload.threads ?? threads)
            }
            try await service.sendTurn(text: queuedDraft.text, threadId: targetThreadId, attachments: [])
            queuedDrafts.removeAll { $0.id == queuedDraft.id }
            recordDeliveredDraft(id: queuedDraft.id, text: queuedDraft.text)
            lastErrorMessage = nil
            connectionPhase = .live
            schedulePostSendRefresh(after: sendStartedAt)
            shouldContinueQueue = true
        } catch {
            let fallbackMessage = "Send did not complete. Retry to confirm delivery."
            let message = DextunnelBridgeErrorFormatting.userVisibleMessage(for: error) ?? fallbackMessage
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            updateQueuedDraft(queuedDraft.id) { $0.failed(message) }
            if DextunnelBridgeErrorFormatting.userVisibleMessage(for: error) != nil {
                lastErrorMessage = message
                if DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error) {
                    connectionPhase = .failed
                } else {
                    connectionPhase = .live
                }
            }
        }

        if shouldContinueQueue {
            isSending = false
            await maybeFlushQueue()
        }
    }

    public func claimControl() async {
        do {
            let payload = try await service.claimControl(threadId: selectedThreadIdValue, reason: "native_manual")
            adoptLivePayload(payload, previousThreadId: currentDraftThreadId, threads: payload.threads ?? threads)
            lastErrorMessage = nil
            connectionPhase = .live
            await maybeFlushQueue()
        } catch {
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func releaseControl() async {
        do {
            let payload = try await service.releaseControl(threadId: selectedThreadIdValue, reason: "native_manual")
            adoptLivePayload(payload, previousThreadId: currentDraftThreadId, threads: payload.threads ?? threads)
            lastErrorMessage = nil
            connectionPhase = .live
        } catch {
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func respondToPendingInteraction(action: String, answers: [String: String]? = nil) async {
        do {
            let payload = try await service.respondToInteraction(action: action, answers: answers)
            adoptLivePayload(payload, previousThreadId: currentDraftThreadId, threads: payload.threads ?? threads)
            lastErrorMessage = nil
            connectionPhase = .live
            await maybeFlushQueue()
        } catch {
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func interruptSelectedTurn() async {
        do {
            livePayload = try await service.interrupt()
            syncDraftStateToSelectedThread(previousThreadId: currentDraftThreadId)
            lastErrorMessage = nil
            connectionPhase = .live
        } catch {
            adoptBridgeState(from: error, previousThreadId: currentDraftThreadId)
            presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
        }
    }

    public func syncPresence(
        visible: Bool,
        focused: Bool,
        engaged: Bool,
        detach: Bool = false
    ) async {
        guard let threadId = selectedThreadIdValue else {
            return
        }

        do {
            try await service.syncPresence(
                threadId: threadId,
                visible: visible,
                focused: focused,
                engaged: engaged,
                detach: detach
            )
        } catch {
            presentError(error, markFailed: false)
        }
    }

    public func apply(event: DextunnelServerSentEvent) async {
        guard event.event == "live", let data = event.data.data(using: .utf8) else {
            return
        }

        do {
            let payload = try JSONDecoder().decode(DextunnelLivePayload.self, from: data)
            adoptLivePayload(payload, previousThreadId: currentDraftThreadId, threads: payload.threads ?? threads)
            lastLiveEventAt = now()
            connectionPhase = .live
            lastErrorMessage = nil
            await maybeFlushQueue()
        } catch {
            presentError(error, markFailed: false)
        }
    }

    private func runStreamLoop() async {
        while !Task.isCancelled {
            do {
                let stream = try service.eventStream()
                if connectionPhase == .reconnecting {
                    connectionPhase = .live
                }
                for try await event in stream {
                    if Task.isCancelled {
                        return
                    }
                    await apply(event: event)
                }

                if Task.isCancelled {
                    return
                }

                await handleTransientStreamDisconnect()
            } catch {
                if isCancellationLike(error) || Task.isCancelled {
                    return
                }
                if DextunnelBridgeErrorFormatting.shouldSurfacePassiveError(error) {
                    presentError(error)
                    return
                }
                await handleTransientStreamDisconnect()
            }

            if Task.isCancelled {
                return
            }

            do {
                try await Task.sleep(nanoseconds: reconnectDelayNanoseconds)
            } catch {
                return
            }
        }
    }

    private func handleTransientStreamDisconnect() async {
        guard livePayload != nil else {
            return
        }
        reconnectCount += 1
        lastReconnectAt = now()
        connectionPhase = .reconnecting
        await performReconnect(passive: true)
    }

    private func runIdleRefreshWatchdog() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(nanoseconds: idleRefreshPollNanoseconds)
            } catch {
                return
            }

            if Task.isCancelled {
                return
            }

            await maybePerformIdleRefresh()
        }
    }

    private func maybePerformIdleRefresh() async {
        guard isForegroundActive else {
            return
        }
        guard livePayload != nil else {
            return
        }
        guard !isSending, !isSelecting, !isRefreshing, !isPassiveRefreshing else {
            return
        }
        guard let lastObservedUpdateAt else {
            return
        }
        guard now().timeIntervalSince(lastObservedUpdateAt) >= idleRefreshInterval else {
            return
        }
        if connectionPhase == .reconnecting || livePayload?.status.watcherConnected == false {
            await performReconnect(passive: true)
        } else {
            await performRefresh(passive: true, preserveReconnectState: false)
        }
    }

    private var lastObservedUpdateAt: Date? {
        [lastLiveEventAt, lastSuccessfulRefreshAt]
            .compactMap { $0 }
            .max()
    }

    private var hasRemoteControl: Bool {
        livePayload?.status.controlLeaseForSelection?.ownerClientId == service.surfaceClientId ||
            livePayload?.status.controlLeaseForSelection?.clientId == service.surfaceClientId
    }

    private var selectedThreadIdValue: String? {
        normalizedThreadId(from: selectedThreadId)
    }

    private func normalizedThreadId(from value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private var canClaimForQueuedSend: Bool {
        guard !queuedDrafts.isEmpty else {
            return false
        }
        guard let payload = livePayload else {
            return false
        }
        if payload.pendingInteraction != nil {
            return false
        }
        if !payload.status.watcherConnected {
            return false
        }
        if payload.selectedThreadSnapshot?.thread?.activeTurnId != nil {
            return false
        }
        let lease = payload.status.controlLeaseForSelection
        return lease == nil || hasRemoteControl
    }

    private func syncDraftStateToSelectedThread(previousThreadId: String?) {
        let nextThreadId = selectedThreadIdValue
        let selectionChanged = previousThreadId != nextThreadId || currentDraftThreadId == nil

        if selectionChanged {
            if let previousThreadId {
                persistDraftState(threadId: previousThreadId)
            }

            currentDraftThreadId = nextThreadId

            guard let nextThreadId else {
                draftText = ""
                queuedDrafts = []
                pendingDirectSend = nil
                recentDeliveredDrafts = []
                return
            }

            if let persisted = draftPersistence.loadState(threadId: nextThreadId) {
                draftText = persisted.draftText
                queuedDrafts = normalizeQueuedDrafts(persisted.queuedDrafts)
                pendingDirectSend = nil
                if let recoveredDirectSend = normalizePendingDirectSend(persisted.pendingDirectSend) {
                    queuedDrafts.removeAll { $0.id == recoveredDirectSend.id }
                    queuedDrafts.insert(recoveredDirectSend, at: 0)
                }
                recentDeliveredDrafts = normalizeDeliveredDrafts(persisted.recentDeliveredDrafts)
            } else {
                draftText = ""
                queuedDrafts = []
                pendingDirectSend = nil
                recentDeliveredDrafts = []
            }
        }

        reconcileDeliveredDraftsWithTranscript()
    }

    private func persistDraftStateForCurrentThread() {
        guard let currentDraftThreadId else {
            return
        }
        persistDraftState(threadId: currentDraftThreadId)
    }

    private func persistDraftState(threadId: String) {
        let trimmedDraft = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedDraft.isEmpty && queuedDrafts.isEmpty && pendingDirectSend == nil && recentDeliveredDrafts.isEmpty {
            draftPersistence.clearState(threadId: threadId)
            return
        }

        draftPersistence.saveState(
            DextunnelPersistedDraftState(
                draftText: draftText,
                queuedDrafts: queuedDrafts,
                pendingDirectSend: pendingDirectSend,
                recentDeliveredDrafts: recentDeliveredDrafts
            ),
            threadId: threadId
        )
    }

    private func maybeFlushQueue() async {
        guard !isSending else {
            return
        }
        guard nextAutoFlushQueuedDraft != nil else {
            return
        }
        guard canClaimForQueuedSend else {
            return
        }
        await flushFirstQueuedDraft()
    }

    private func schedulePostSendRefresh(after referenceTime: Date) {
        postSendRefreshTask?.cancel()
        postSendRefreshTask = Task { [weak self] in
            guard let self else {
                return
            }
            try? await Task.sleep(nanoseconds: postSendRefreshDelayNanoseconds)
            guard !Task.isCancelled else {
                return
            }
            if let lastObservedUpdateAt, lastObservedUpdateAt >= referenceTime {
                return
            }
            await self.performRefresh(passive: true)
        }
    }

    private func performRefresh(
        passive: Bool,
        preserveReconnectState: Bool = false
    ) async {
        let previousThreadId = currentDraftThreadId
        if passive {
            guard !isPassiveRefreshing else {
                return
            }
            isPassiveRefreshing = true
        } else {
            isRefreshing = true
        }

        defer {
            if passive {
                isPassiveRefreshing = false
            } else {
                isRefreshing = false
            }
        }

        do {
            let payload = try await service.refresh(includeThreads: !passive)
            let nextThreads = try await resolveThreadSummaries(for: payload)
            adoptLivePayload(payload, previousThreadId: previousThreadId, threads: nextThreads)
            lastSuccessfulRefreshAt = now()
            lastErrorMessage = nil
            let nextPhase: DextunnelBridgeConnectionPhase = payload.status.watcherConnected ? .live : .reconnecting
            if preserveReconnectState && nextPhase == .reconnecting {
                connectionPhase = .reconnecting
            } else {
                connectionPhase = nextPhase
            }
            await maybeFlushQueue()
        } catch {
            adoptBridgeState(from: error, previousThreadId: previousThreadId)
            if passive {
                if DextunnelBridgeErrorFormatting.shouldSurfacePassiveError(error) {
                    presentError(error)
                }
            } else {
                presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
            }
        }
    }

    private func performReconnect(passive: Bool) async {
        let previousThreadId = currentDraftThreadId
        if passive {
            guard !isPassiveRefreshing else {
                return
            }
            isPassiveRefreshing = true
        } else {
            isRefreshing = true
        }

        defer {
            if passive {
                isPassiveRefreshing = false
            } else {
                isRefreshing = false
            }
        }

        connectionPhase = .reconnecting

        do {
            let payload = try await service.reconnect(includeThreads: !passive)
            let nextThreads = try await resolveThreadSummaries(for: payload)
            adoptLivePayload(payload, previousThreadId: previousThreadId, threads: nextThreads)
            lastSuccessfulRefreshAt = now()
            lastErrorMessage = nil
            connectionPhase = payload.status.watcherConnected ? .live : .reconnecting
            await maybeFlushQueue()
        } catch {
            adoptBridgeState(from: error, previousThreadId: previousThreadId)
            if passive {
                if DextunnelBridgeErrorFormatting.shouldSurfacePassiveError(error) {
                    presentError(error)
                }
            } else {
                presentError(error, markFailed: DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error))
            }
        }
    }

    private var nextFlushableQueuedDraft: DextunnelQueuedDraft? {
        queuedDrafts.first(where: { draft in
            draft.deliveryState == .queued || draft.deliveryState == .failed
        })
    }

    private func resolveThreadSummaries(for payload: DextunnelLivePayload) async throws -> [DextunnelThreadSummary] {
        if let payloadThreads = payload.threads {
            return payloadThreads
        }
        return try await service.fetchThreads()
    }

    private func adoptLivePayload(
        _ payload: DextunnelLivePayload,
        previousThreadId: String?,
        threads nextThreads: [DextunnelThreadSummary]
    ) {
        livePayload = payload
        threads = nextThreads
        syncDraftStateToSelectedThread(previousThreadId: previousThreadId)
    }

    private var nextAutoFlushQueuedDraft: DextunnelQueuedDraft? {
        queuedDrafts.first(where: { draft in
            draft.deliveryState == .queued
        })
    }

    private func updateQueuedDraft(
        _ id: DextunnelQueuedDraft.ID,
        transform: (DextunnelQueuedDraft) -> DextunnelQueuedDraft
    ) {
        guard let index = queuedDrafts.firstIndex(where: { $0.id == id }) else {
            return
        }
        queuedDrafts[index] = transform(queuedDrafts[index])
    }

    private func recordDeliveredDraft(id: UUID, text: String) {
        recentDeliveredDrafts.removeAll { $0.id == id }
        recentDeliveredDrafts.insert(
            DextunnelQueuedDraft(id: id, text: text, deliveryState: .delivered),
            at: 0
        )
        if recentDeliveredDrafts.count > 3 {
            recentDeliveredDrafts = Array(recentDeliveredDrafts.prefix(3))
        }
        reconcileDeliveredDraftsWithTranscript()
    }

    private func normalizeQueuedDrafts(_ drafts: [DextunnelQueuedDraft]) -> [DextunnelQueuedDraft] {
        drafts.map { draft in
            switch draft.deliveryState {
            case .sending:
                return draft.failed("Send status was interrupted. Retry to confirm delivery.")
            case .delivered, .confirmed:
                return draft.queued()
            case .queued, .failed:
                return draft
            }
        }
    }

    private func normalizeDeliveredDrafts(_ drafts: [DextunnelQueuedDraft]) -> [DextunnelQueuedDraft] {
        Array(
            drafts
                .map { draft in
                    switch draft.deliveryState {
                    case .confirmed:
                        return draft
                    case .delivered:
                        return draft
                    case .queued, .sending, .failed:
                        return draft.delivered()
                    }
                }
                .prefix(3)
        )
    }

    private func normalizePendingDirectSend(_ draft: DextunnelQueuedDraft?) -> DextunnelQueuedDraft? {
        guard let draft else {
            return nil
        }

        switch draft.deliveryState {
        case .sending:
            return draft.failed("Send status was interrupted. Retry to confirm delivery.")
        case .queued, .failed:
            return draft.failed(draft.lastErrorMessage ?? "Send status was interrupted. Retry to confirm delivery.")
        case .delivered, .confirmed:
            return nil
        }
    }

    private func reconcileDeliveredDraftsWithTranscript() {
        guard !recentDeliveredDrafts.isEmpty else {
            return
        }

        let transcript = livePayload?.selectedThreadSnapshot?.transcript ?? []
        guard !transcript.isEmpty else {
            return
        }

        var remainingMatchesByText: [String: Int] = [:]
        for entry in transcript where isRemoteConfirmationEntry(entry) {
            let key = normalizedOutboxText(entry.text)
            guard !key.isEmpty else {
                continue
            }
            remainingMatchesByText[key, default: 0] += 1
        }

        guard !remainingMatchesByText.isEmpty else {
            return
        }

        for draft in recentDeliveredDrafts where draft.deliveryState == .confirmed {
            let key = normalizedOutboxText(draft.text)
            guard let count = remainingMatchesByText[key], count > 0 else {
                continue
            }
            remainingMatchesByText[key] = count - 1
        }

        var reconciled = recentDeliveredDrafts
        for index in reconciled.indices.reversed() {
            let draft = reconciled[index]
            guard draft.deliveryState == .delivered else {
                continue
            }

            let key = normalizedOutboxText(draft.text)
            guard let count = remainingMatchesByText[key], count > 0 else {
                continue
            }

            reconciled[index] = draft.confirmed()
            remainingMatchesByText[key] = count - 1
        }

        if reconciled != recentDeliveredDrafts {
            recentDeliveredDrafts = reconciled
        }
    }

    private func isRemoteConfirmationEntry(_ entry: DextunnelTranscriptEntry) -> Bool {
        guard entry.role == "user" else {
            return false
        }

        let remoteHints = [
            entry.lane,
            entry.origin,
            entry.participant?.id,
            entry.participant?.label,
            entry.participant?.lane,
            entry.participant?.role
        ]
        .compactMap { value in
            value?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
        }

        return remoteHints.contains(where: { $0.contains("remote") })
    }

    private func normalizedOutboxText(_ text: String) -> String {
        text
            .split(whereSeparator: \.isWhitespace)
            .map(String.init)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private func presentError(_ error: Error, markFailed: Bool = true) {
        if !markFailed && !DextunnelBridgeErrorFormatting.shouldSurfacePassiveError(error) {
            return
        }

        guard let message = DextunnelBridgeErrorFormatting.userVisibleMessage(for: error) else {
            return
        }
        lastErrorMessage = message
        if markFailed {
            connectionPhase = .failed
        }
    }

    private func adoptBridgeState(from error: Error, previousThreadId: String?) {
        guard let payload = DextunnelBridgeErrorFormatting.livePayload(from: error) else {
            return
        }

        livePayload = payload
        syncDraftStateToSelectedThread(previousThreadId: previousThreadId)
        if !DextunnelBridgeErrorFormatting.shouldMarkConnectionFailed(for: error) {
            connectionPhase = .live
        }
    }

    private func isCancellationLike(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == URLError.cancelled.rawValue
    }
}
