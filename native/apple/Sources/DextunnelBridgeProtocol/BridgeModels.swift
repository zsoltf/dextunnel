import Foundation

public enum DextunnelSurfaceKind: String, Codable, Sendable {
    case host
    case remote
}

public struct DextunnelSurfaceBootstrap: Codable, Sendable {
    public let accessToken: String
    public let capabilities: [String]?
    public let clientId: String
    public let expiresAt: String
    public let issuedAt: String?
    public let surface: DextunnelSurfaceKind

    public init(
        accessToken: String,
        capabilities: [String]? = nil,
        clientId: String,
        expiresAt: String,
        issuedAt: String? = nil,
        surface: DextunnelSurfaceKind
    ) {
        self.accessToken = accessToken
        self.capabilities = capabilities
        self.clientId = clientId
        self.expiresAt = expiresAt
        self.issuedAt = issuedAt
        self.surface = surface
    }
}

public struct DextunnelOperatorDiagnostic: Codable, Identifiable, Sendable {
    public let code: String
    public let detail: String?
    public let domain: String
    public let severity: String
    public let summary: String

    public var id: String { code }

    public init(code: String, detail: String? = nil, domain: String, severity: String, summary: String) {
        self.code = code
        self.detail = detail
        self.domain = domain
        self.severity = severity
        self.summary = summary
    }
}

public struct DextunnelSurfaceAttachmentSummary: Codable, Sendable {
    public let count: Int
    public let label: String
    public let state: String
    public let surface: String

    public init(count: Int, label: String, state: String, surface: String) {
        self.count = count
        self.label = label
        self.state = state
        self.surface = surface
    }
}

public struct DextunnelSelectedChannel: Codable, Sendable {
    public let channelId: String?
    public let channelLabel: String?
    public let channelSlug: String?
    public let serverLabel: String?
    public let source: String?
    public let topic: String?

    public init(
        channelId: String? = nil,
        channelLabel: String? = nil,
        channelSlug: String?,
        serverLabel: String?,
        source: String?,
        topic: String?
    ) {
        self.channelId = channelId
        self.channelLabel = channelLabel
        self.channelSlug = channelSlug
        self.serverLabel = serverLabel
        self.source = source
        self.topic = topic
    }
}

public struct DextunnelSelectedThread: Codable, Sendable {
    public let activeTurnId: String?
    public let cwd: String?
    public let id: String?
    public let name: String?
    public let source: String?
    public let status: String?

    public init(activeTurnId: String?, cwd: String?, id: String?, name: String?, source: String?, status: String?) {
        self.activeTurnId = activeTurnId
        self.cwd = cwd
        self.id = id
        self.name = name
        self.source = source
        self.status = status
    }

    enum CodingKeys: String, CodingKey {
        case activeTurnId
        case cwd
        case id
        case name
        case source
        case status
    }

    private struct StatusEnvelope: Codable, Sendable {
        let type: String?
        let status: String?
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        activeTurnId = try container.decodeIfPresent(String.self, forKey: .activeTurnId)
        cwd = try container.decodeIfPresent(String.self, forKey: .cwd)
        id = try container.decodeIfPresent(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        if let directStatus = try? container.decode(String.self, forKey: .status) {
            status = directStatus
        } else if let envelope = try? container.decode(StatusEnvelope.self, forKey: .status) {
            status = envelope.type ?? envelope.status
        } else {
            status = nil
        }
    }
}

public struct DextunnelSelectedThreadSnapshot: Codable, Sendable {
    public let channel: DextunnelSelectedChannel?
    public let participants: [DextunnelParticipant]
    public let thread: DextunnelSelectedThread?
    public let transcript: [DextunnelTranscriptEntry]
    public let transcriptCount: Int?

    public init(
        channel: DextunnelSelectedChannel?,
        participants: [DextunnelParticipant] = [],
        thread: DextunnelSelectedThread?,
        transcript: [DextunnelTranscriptEntry] = [],
        transcriptCount: Int? = nil
    ) {
        self.channel = channel
        self.participants = participants
        self.thread = thread
        self.transcript = transcript
        self.transcriptCount = transcriptCount
    }

    enum CodingKeys: String, CodingKey {
        case channel
        case participants
        case thread
        case transcript
        case transcriptCount
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.channel = try container.decodeIfPresent(DextunnelSelectedChannel.self, forKey: .channel)
        self.participants = try container.decodeIfPresent([DextunnelParticipant].self, forKey: .participants) ?? []
        self.thread = try container.decodeIfPresent(DextunnelSelectedThread.self, forKey: .thread)
        self.transcript = try container.decodeIfPresent([DextunnelTranscriptEntry].self, forKey: .transcript) ?? []
        self.transcriptCount = try container.decodeIfPresent(Int.self, forKey: .transcriptCount)
    }
}

public struct DextunnelParticipant: Codable, Identifiable, Sendable {
    public let capability: String?
    public let canAct: Bool?
    public let id: String
    public let label: String?
    public let lane: String?
    public let metaLabel: String?
    public let role: String?
    public let sortOrder: Int?
    public let state: String?
    public let token: String?

    public init(
        capability: String? = nil,
        canAct: Bool? = nil,
        id: String,
        label: String? = nil,
        lane: String? = nil,
        metaLabel: String? = nil,
        role: String? = nil,
        sortOrder: Int? = nil,
        state: String? = nil,
        token: String? = nil
    ) {
        self.capability = capability
        self.canAct = canAct
        self.id = id
        self.label = label
        self.lane = lane
        self.metaLabel = metaLabel
        self.role = role
        self.sortOrder = sortOrder
        self.state = state
        self.token = token
    }
}

public struct DextunnelTranscriptEntry: Codable, Identifiable, Sendable {
    public let itemId: String?
    public let kind: String?
    public let lane: String?
    public let origin: String?
    public let participant: DextunnelParticipant?
    public let phase: String?
    public let role: String
    public let text: String
    public let timestamp: String?
    public let turnId: String?

    public init(
        itemId: String? = nil,
        kind: String? = nil,
        lane: String? = nil,
        origin: String? = nil,
        participant: DextunnelParticipant? = nil,
        phase: String? = nil,
        role: String,
        text: String,
        timestamp: String? = nil,
        turnId: String? = nil
    ) {
        self.itemId = itemId
        self.kind = kind
        self.lane = lane
        self.origin = origin
        self.participant = participant
        self.phase = phase
        self.role = role
        self.text = text
        self.timestamp = timestamp
        self.turnId = turnId
    }

    public var id: String {
        if let itemId, !itemId.isEmpty {
            return itemId
        }
        if let turnId, !turnId.isEmpty {
            return "\(turnId):\(timestamp ?? text)"
        }
        if let timestamp, !timestamp.isEmpty {
            return "\(role):\(timestamp):\(text)"
        }
        return "\(role):\(text)"
    }
}

public struct DextunnelPendingInteraction: Codable, Sendable {
    public let actionKind: String?
    public let approveLabel: String?
    public let availableDecisions: [String]?
    public let canApproveForSession: Bool?
    public let command: String?
    public let cwd: String?
    public let declineLabel: String?
    public let detail: String?
    public let flowContinuation: String?
    public let flowLabel: String?
    public let flowStep: Int?
    public let id: String?
    public let kind: String?
    public let kindLabel: String?
    public let message: String?
    public let method: String?
    public let permissions: [String: String]?
    public let questions: [DextunnelPendingInteractionQuestion]?
    public let requestId: String?
    public let sessionActionLabel: String?
    public let submitLabel: String?
    public let summary: String?
    public let subject: String?
    public let title: String?

    public init(
        actionKind: String? = nil,
        approveLabel: String? = nil,
        availableDecisions: [String]? = nil,
        canApproveForSession: Bool? = nil,
        command: String? = nil,
        cwd: String? = nil,
        declineLabel: String? = nil,
        detail: String? = nil,
        flowContinuation: String? = nil,
        flowLabel: String? = nil,
        flowStep: Int? = nil,
        id: String? = nil,
        kind: String? = nil,
        kindLabel: String? = nil,
        message: String? = nil,
        method: String? = nil,
        permissions: [String: String]? = nil,
        questions: [DextunnelPendingInteractionQuestion]? = nil,
        requestId: String? = nil,
        sessionActionLabel: String? = nil,
        submitLabel: String? = nil,
        summary: String? = nil,
        subject: String? = nil,
        title: String? = nil
    ) {
        self.actionKind = actionKind
        self.approveLabel = approveLabel
        self.availableDecisions = availableDecisions
        self.canApproveForSession = canApproveForSession
        self.command = command
        self.cwd = cwd
        self.declineLabel = declineLabel
        self.detail = detail
        self.flowContinuation = flowContinuation
        self.flowLabel = flowLabel
        self.flowStep = flowStep
        self.id = id
        self.kind = kind
        self.kindLabel = kindLabel
        self.message = message
        self.method = method
        self.permissions = permissions
        self.questions = questions
        self.requestId = requestId
        self.sessionActionLabel = sessionActionLabel
        self.submitLabel = submitLabel
        self.summary = summary
        self.subject = subject
        self.title = title
    }
}

public struct DextunnelControlLease: Codable, Sendable {
    public let clientId: String?
    public let expiresAt: String?
    public let owner: String?
    public let ownerClientId: String?
    public let reason: String?
    public let source: String?
    public let threadId: String?

    public init(
        clientId: String?,
        expiresAt: String?,
        owner: String?,
        ownerClientId: String? = nil,
        reason: String?,
        source: String? = nil,
        threadId: String?
    ) {
        self.clientId = clientId
        self.expiresAt = expiresAt
        self.owner = owner
        self.ownerClientId = ownerClientId
        self.reason = reason
        self.source = source
        self.threadId = threadId
    }
}

public struct DextunnelLiveStatus: Codable, Sendable {
    public let controlLeaseForSelection: DextunnelControlLease?
    public let diagnostics: [DextunnelOperatorDiagnostic]
    public let runtimeProfile: String?
    public let selectionMode: String?
    public let watcherConnected: Bool

    public init(
        controlLeaseForSelection: DextunnelControlLease? = nil,
        diagnostics: [DextunnelOperatorDiagnostic],
        runtimeProfile: String?,
        selectionMode: String?,
        watcherConnected: Bool
    ) {
        self.controlLeaseForSelection = controlLeaseForSelection
        self.diagnostics = diagnostics
        self.runtimeProfile = runtimeProfile
        self.selectionMode = selectionMode
        self.watcherConnected = watcherConnected
    }

    public var requiresDesktopRestart: Bool {
        diagnostics.contains(where: { $0.code == "desktop_restart_required" })
    }
}

public struct DextunnelLivePayload: Codable, Sendable {
    public let pendingInteraction: DextunnelPendingInteraction?
    public let participants: [DextunnelParticipant]?
    public let selectedAttachments: [DextunnelSurfaceAttachmentSummary]
    public let selectedAgentRoom: DextunnelSelectedAgentRoom?
    public let selectedChannel: DextunnelSelectedChannel?
    public let selectedCompanion: DextunnelSelectedCompanion?
    public let selectedProjectCwd: String?
    public let selectedThreadId: String?
    public let selectedThreadSnapshot: DextunnelSelectedThreadSnapshot?
    public let status: DextunnelLiveStatus
    public let threads: [DextunnelThreadSummary]?
    public let turnDiff: DextunnelTurnDiff?

    public init(
        pendingInteraction: DextunnelPendingInteraction?,
        participants: [DextunnelParticipant]? = nil,
        selectedAttachments: [DextunnelSurfaceAttachmentSummary],
        selectedAgentRoom: DextunnelSelectedAgentRoom? = nil,
        selectedChannel: DextunnelSelectedChannel?,
        selectedCompanion: DextunnelSelectedCompanion? = nil,
        selectedProjectCwd: String?,
        selectedThreadId: String?,
        selectedThreadSnapshot: DextunnelSelectedThreadSnapshot?,
        status: DextunnelLiveStatus,
        threads: [DextunnelThreadSummary]? = nil,
        turnDiff: DextunnelTurnDiff? = nil
    ) {
        self.pendingInteraction = pendingInteraction
        self.participants = participants
        self.selectedAttachments = selectedAttachments
        self.selectedAgentRoom = selectedAgentRoom
        self.selectedChannel = selectedChannel
        self.selectedCompanion = selectedCompanion
        self.selectedProjectCwd = selectedProjectCwd
        self.selectedThreadId = selectedThreadId
        self.selectedThreadSnapshot = selectedThreadSnapshot
        self.status = status
        self.threads = threads
        self.turnDiff = turnDiff
    }
}

public struct DextunnelSelectedCompanion: Codable, Sendable {
    public let advisories: [DextunnelParticipant]?
    public let wakeups: [DextunnelCompanionWakeup]?

    public init(advisories: [DextunnelParticipant]? = nil, wakeups: [DextunnelCompanionWakeup]? = nil) {
        self.advisories = advisories
        self.wakeups = wakeups
    }
}

public struct DextunnelCompanionWakeup: Codable, Identifiable, Sendable {
    public let advisorId: String?
    public let key: String?
    public let message: String?
    public let status: String?
    public let timestamp: String?
    public let wakeKind: String?

    public init(
        advisorId: String? = nil,
        key: String? = nil,
        message: String? = nil,
        status: String? = nil,
        timestamp: String? = nil,
        wakeKind: String? = nil
    ) {
        self.advisorId = advisorId
        self.key = key
        self.message = message
        self.status = status
        self.timestamp = timestamp
        self.wakeKind = wakeKind
    }

    public var id: String {
        key ?? "\(advisorId ?? "advisor"):\(timestamp ?? "now")"
    }
}

public struct DextunnelSelectedAgentRoom: Codable, Sendable {
    public let enabled: Bool?
    public let messages: [DextunnelAgentRoomMessage]?

    public init(enabled: Bool? = nil, messages: [DextunnelAgentRoomMessage]? = nil) {
        self.enabled = enabled
        self.messages = messages
    }
}

public struct DextunnelAgentRoomMessage: Codable, Identifiable, Sendable {
    public let id: String
    public let participantId: String?
    public let text: String?
    public let timestamp: String?

    public init(id: String, participantId: String? = nil, text: String? = nil, timestamp: String? = nil) {
        self.id = id
        self.participantId = participantId
        self.text = text
        self.timestamp = timestamp
    }
}

public struct DextunnelTurnDiff: Codable, Sendable {
    public let items: [DextunnelTurnDiffItem]

    public init(items: [DextunnelTurnDiffItem]) {
        self.items = items
    }

    enum CodingKeys: String, CodingKey {
        case items
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.items = try container.decodeIfPresent([DextunnelTurnDiffItem].self, forKey: .items) ?? []
    }
}

public struct DextunnelTurnDiffItem: Codable, Identifiable, Sendable {
    public let additions: Int?
    public let deletions: Int?
    public let path: String
    public let status: String?

    public init(additions: Int? = nil, deletions: Int? = nil, path: String, status: String? = nil) {
        self.additions = additions
        self.deletions = deletions
        self.path = path
        self.status = status
    }

    public var id: String { path }
}

public struct DextunnelThreadSummary: Codable, Identifiable, Sendable {
    public let channelLabel: String?
    public let channelSlug: String?
    public let cwd: String?
    public let id: String
    public let name: String?
    public let openingPreview: String?
    public let preview: String?
    public let serverLabel: String?
    public let source: String?
    public let status: String?
    public let updatedAt: String?

    public init(
        channelLabel: String?,
        channelSlug: String?,
        cwd: String?,
        id: String,
        name: String?,
        openingPreview: String? = nil,
        preview: String?,
        serverLabel: String?,
        source: String?,
        status: String?,
        updatedAt: String?
    ) {
        self.channelLabel = channelLabel
        self.channelSlug = channelSlug
        self.cwd = cwd
        self.id = id
        self.name = name
        self.openingPreview = openingPreview
        self.preview = preview
        self.serverLabel = serverLabel
        self.source = source
        self.status = status
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case channelLabel
        case channelSlug
        case cwd
        case id
        case name
        case openingPreview
        case preview
        case serverLabel
        case source
        case status
        case updatedAt
    }

    private struct StatusEnvelope: Codable {
        let type: String?
        let status: String?
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        channelLabel = try container.decodeIfPresent(String.self, forKey: .channelLabel)
        channelSlug = try container.decodeIfPresent(String.self, forKey: .channelSlug)
        cwd = try container.decodeIfPresent(String.self, forKey: .cwd)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        openingPreview = try container.decodeIfPresent(String.self, forKey: .openingPreview)
        preview = try container.decodeIfPresent(String.self, forKey: .preview)
        serverLabel = try container.decodeIfPresent(String.self, forKey: .serverLabel)
        source = try container.decodeIfPresent(String.self, forKey: .source)

        if let rawStatus = try? container.decode(String.self, forKey: .status) {
            status = rawStatus
        } else if let statusEnvelope = try? container.decode(StatusEnvelope.self, forKey: .status) {
            status = statusEnvelope.type ?? statusEnvelope.status
        } else {
            status = nil
        }

        if let rawUpdatedAt = try? container.decode(String.self, forKey: .updatedAt) {
            updatedAt = rawUpdatedAt
        } else if let rawUpdatedAtInt = try? container.decode(Int.self, forKey: .updatedAt) {
            updatedAt = String(rawUpdatedAtInt)
        } else if let rawUpdatedAtDouble = try? container.decode(Double.self, forKey: .updatedAt) {
            updatedAt = String(rawUpdatedAtDouble)
        } else {
            updatedAt = nil
        }
    }
}

public struct DextunnelThreadListResponse: Codable, Sendable {
    public let data: [DextunnelThreadSummary]

    public init(data: [DextunnelThreadSummary]) {
        self.data = data
    }
}

public struct DextunnelSelectionRequest: Codable, Sendable {
    public let cwd: String?
    public let threadId: String?

    public init(cwd: String?, threadId: String?) {
        self.cwd = cwd
        self.threadId = threadId
    }
}

public struct DextunnelControlRequest: Codable, Sendable {
    public let action: String
    public let reason: String?
    public let threadId: String?

    public init(action: String, reason: String? = nil, threadId: String?) {
        self.action = action
        self.reason = reason
        self.threadId = threadId
    }
}

public struct DextunnelInteractionRequest: Codable, Sendable {
    public let action: String
    public let answers: [String: String]?

    public init(action: String, answers: [String: String]? = nil) {
        self.action = action
        self.answers = answers
    }
}

public struct DextunnelPresenceRequest: Codable, Sendable {
    public let detach: Bool?
    public let engaged: Bool?
    public let focused: Bool?
    public let threadId: String
    public let visible: Bool?

    public init(
        detach: Bool? = nil,
        engaged: Bool? = nil,
        focused: Bool? = nil,
        threadId: String,
        visible: Bool? = nil
    ) {
        self.detach = detach
        self.engaged = engaged
        self.focused = focused
        self.threadId = threadId
        self.visible = visible
    }
}

public struct DextunnelOpenInCodexRequest: Codable, Sendable {
    public let threadId: String

    public init(threadId: String) {
        self.threadId = threadId
    }
}

public struct DextunnelPendingInteractionQuestionOption: Codable, Identifiable, Sendable {
    public let description: String?
    public let label: String

    public var id: String { label }

    public init(description: String? = nil, label: String) {
        self.description = description
        self.label = label
    }
}

public struct DextunnelPendingInteractionQuestion: Codable, Identifiable, Sendable {
    public let header: String?
    public let id: String
    public let isOther: Bool?
    public let isSecret: Bool?
    public let options: [DextunnelPendingInteractionQuestionOption]?
    public let question: String?

    public init(
        header: String? = nil,
        id: String,
        isOther: Bool? = nil,
        isSecret: Bool? = nil,
        options: [DextunnelPendingInteractionQuestionOption]? = nil,
        question: String? = nil
    ) {
        self.header = header
        self.id = id
        self.isOther = isOther
        self.isSecret = isSecret
        self.options = options
        self.question = question
    }
}

public struct DextunnelTurnAttachment: Codable, Sendable {
    public let dataUrl: String
    public let name: String
    public let type: String

    public init(dataUrl: String, name: String, type: String) {
        self.dataUrl = dataUrl
        self.name = name
        self.type = type
    }
}

public struct DextunnelTurnRequest: Codable, Sendable {
    public let attachments: [DextunnelTurnAttachment]
    public let text: String
    public let threadId: String?

    public init(attachments: [DextunnelTurnAttachment], text: String, threadId: String?) {
        self.attachments = attachments
        self.text = text
        self.threadId = threadId
    }
}

public struct DextunnelRefreshResponse: Codable, Sendable {
    public let ok: Bool
    public let state: DextunnelLivePayload

    public init(ok: Bool, state: DextunnelLivePayload) {
        self.ok = ok
        self.state = state
    }
}

public struct DextunnelStateEnvelope: Codable, Sendable {
    public let ok: Bool
    public let source: String?
    public let state: DextunnelLivePayload

    public init(ok: Bool, source: String? = nil, state: DextunnelLivePayload) {
        self.ok = ok
        self.source = source
        self.state = state
    }
}

public struct DextunnelOpenInCodexResponse: Codable, Sendable {
    public let deeplink: String?
    public let message: String?
    public let ok: Bool
    public let threadId: String?

    public init(deeplink: String?, message: String?, ok: Bool, threadId: String?) {
        self.deeplink = deeplink
        self.message = message
        self.ok = ok
        self.threadId = threadId
    }
}
