import Foundation
import DextunnelBridgeProtocol

public struct DextunnelOperatorContext: Sendable {
    public let activeTurnId: String?
    public let hasAnyRemoteControl: Bool
    public let hasDraftText: Bool
    public let hasRemoteControl: Bool
    public let isControlling: Bool
    public let isDictating: Bool
    public let isSelecting: Bool
    public let isSendingReply: Bool
    public let ownerLabel: String
    public let pendingInteraction: Bool
    public let queuedCount: Int
    public let threadId: String
    public let threadStatus: String?
    public let watcherConnected: Bool
    public let writeLockStatus: String?

    public init(
        activeTurnId: String? = nil,
        hasAnyRemoteControl: Bool = false,
        hasDraftText: Bool = false,
        hasRemoteControl: Bool = false,
        isControlling: Bool = false,
        isDictating: Bool = false,
        isSelecting: Bool = false,
        isSendingReply: Bool = false,
        ownerLabel: String = "",
        pendingInteraction: Bool = false,
        queuedCount: Int = 0,
        threadId: String = "",
        threadStatus: String? = nil,
        watcherConnected: Bool = true,
        writeLockStatus: String? = nil
    ) {
        self.activeTurnId = activeTurnId
        self.hasAnyRemoteControl = hasAnyRemoteControl
        self.hasDraftText = hasDraftText
        self.hasRemoteControl = hasRemoteControl
        self.isControlling = isControlling
        self.isDictating = isDictating
        self.isSelecting = isSelecting
        self.isSendingReply = isSendingReply
        self.ownerLabel = ownerLabel
        self.pendingInteraction = pendingInteraction
        self.queuedCount = queuedCount
        self.threadId = threadId
        self.threadStatus = threadStatus
        self.watcherConnected = watcherConnected
        self.writeLockStatus = writeLockStatus
    }
}

public struct DextunnelOperatorAvailability: Equatable, Sendable {
    public let blockedReason: String
    public let canQueue: Bool
    public let canSteer: Bool
    public let statusMessage: String

    public init(blockedReason: String, canQueue: Bool, canSteer: Bool, statusMessage: String) {
        self.blockedReason = blockedReason
        self.canQueue = canQueue
        self.canSteer = canSteer
        self.statusMessage = statusMessage
    }
}

public struct DextunnelMenuBarOverview: Equatable, Sendable {
    public let diagnostics: [String]
    public let recentActivity: [String]
    public let requiresManualDesktopRestart: Bool
    public let roomTitle: String
    public let statusSummary: String
    public let subtitle: String

    public init(
        diagnostics: [String],
        recentActivity: [String],
        requiresManualDesktopRestart: Bool,
        roomTitle: String,
        statusSummary: String,
        subtitle: String
    ) {
        self.diagnostics = diagnostics
        self.recentActivity = recentActivity
        self.requiresManualDesktopRestart = requiresManualDesktopRestart
        self.roomTitle = roomTitle
        self.statusSummary = statusSummary
        self.subtitle = subtitle
    }
}

public enum DextunnelTranscriptFilter: String, CaseIterable, Identifiable, Sendable {
    case updates
    case thread
    case tools
    case changes
    case advisories

    public var id: String { rawValue }

    public static var allCases: [DextunnelTranscriptFilter] {
        [.updates, .thread, .tools, .changes, .advisories]
    }

    public var title: String {
        switch self {
        case .thread:
            return "Thread"
        case .advisories:
            return "Advisories"
        case .updates:
            return "Updates"
        case .tools:
            return "Tools"
        case .changes:
            return "Changes"
        }
    }

    public var emptyStateCopy: String {
        switch self {
        case .thread:
            return "Conversation turns will appear here once the selected room starts moving."
        case .advisories:
            return "No advisory notes for this room yet."
        case .updates:
            return "No operational updates are visible for this room."
        case .tools:
            return "No tool output is visible for this room."
        case .changes:
            return "No file changes are visible for the current turn."
        }
    }
}

public enum DextunnelOperatorCore {
    public static func composeDictationDraft(baseDraft: String, dictatedText: String) -> String {
        let trimmedBase = baseDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDictation = dictatedText.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmedDictation.isEmpty {
            return trimmedBase
        }

        if trimmedBase.isEmpty {
            return trimmedDictation
        }

        return "\(trimmedBase)\n\(trimmedDictation)"
    }

    public static func dictationButtonTitle(isDictating: Bool) -> String {
        isDictating ? "Stop dictation" : "Dictate"
    }

    public static func dictationStatusText(isDictating: Bool) -> String {
        isDictating ? "Listening..." : "Tap to dictate"
    }

    public static func queueSummary(_ count: Int) -> String {
        if count <= 0 {
            return ""
        }
        return count == 1 ? "1 queued" : "\(count) queued"
    }

    public static func desktopSyncNote() -> String {
        "Reveal in Codex opens this thread in the app. Quit and reopen the Codex app manually to see newer messages from Dextunnel."
    }

    public static func attributedTranscriptText(from text: String) -> AttributedString {
        let source = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else {
            return AttributedString("")
        }

        do {
            return try AttributedString(
                markdown: source,
                options: AttributedString.MarkdownParsingOptions(
                    interpretedSyntax: .inlineOnlyPreservingWhitespace,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
        } catch {
            return AttributedString(source)
        }
    }

    public static func attributedTranscriptText(for entry: DextunnelTranscriptEntry, expanded: Bool = false) -> AttributedString {
        attributedTranscriptText(from: transcriptDisplayText(for: entry, expanded: expanded))
    }

    public static func transcriptDisplayText(for entry: DextunnelTranscriptEntry, expanded: Bool = false) -> String {
        let source = entry.text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !source.isEmpty else {
            return ""
        }

        let toolLikeKind = (entry.kind ?? "").lowercased().contains("tool")
        guard (entry.role == "tool" || toolLikeKind), !expanded else {
            return source
        }

        return compactToolOutputPreview(source)
    }

    public static func transcriptSummary(
        from entries: [DextunnelTranscriptEntry],
        limit: Int = 2,
        maxLength: Int = 180
    ) -> String {
        let meaningful = entries.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let preferred = meaningful.filter(isConversationEntry)
        let source = preferred.isEmpty ? meaningful.filter { !isSystemNoticeEntry($0) } : preferred
        let recent = Array(source.suffix(max(1, limit)))

        guard !recent.isEmpty else {
            return ""
        }

        let summary = recent
            .map { entry in
                "\(transcriptSummarySpeakerLabel(for: entry)): \(normalizedSummaryText(entry.text))"
            }
            .joined(separator: " | ")

        guard summary.count > maxLength else {
            return summary
        }

        let cutoffIndex = summary.index(summary.startIndex, offsetBy: max(0, maxLength - 3))
        let truncated = String(summary[..<cutoffIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(truncated)..."
    }

    public static func transcriptPreviewLine(for entry: DextunnelTranscriptEntry) -> String {
        let speaker =
            entry.participant?.label ??
            entry.lane ??
            (entry.role == "assistant" ? "codex" : entry.role)
        let text = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return speaker
        }

        let normalized = text.replacingOccurrences(of: "\n", with: " ")
        if normalized.count <= 72 {
            return "\(speaker): \(normalized)"
        }

        let index = normalized.index(normalized.startIndex, offsetBy: 72)
        return "\(speaker): \(normalized[..<index])..."
    }

    public static func recentActivityLine(for entry: DextunnelTranscriptEntry) -> String {
        let speaker =
            entry.participant?.label?.trimmingCharacters(in: .whitespacesAndNewlines) ??
            entry.lane?.trimmingCharacters(in: .whitespacesAndNewlines) ??
            entry.role

        let normalizedSpeaker = speaker.isEmpty ? entry.role : speaker
        let kind = entry.kind?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""

        if kind.contains("approval") || kind.contains("permission") {
            return "Approval requested"
        }

        switch entry.role {
        case "assistant":
            return "\(normalizedSpeaker) replied"
        case "user":
            if normalizedSpeaker.lowercased() == "remote" {
                return "remote sent a steer"
            }
            return "\(normalizedSpeaker) sent a message"
        case "tool":
            return "\(normalizedSpeaker) ran a tool step"
        default:
            return "\(normalizedSpeaker) updated the room"
        }
    }

    public static func recentActivity(from payload: DextunnelLivePayload, limit: Int = 3) -> [String] {
        let entries = payload.selectedThreadSnapshot?.transcript ?? []
        if entries.isEmpty || limit <= 0 {
            return []
        }

        return Array(entries.suffix(limit)).map(recentActivityLine(for:))
    }

    public static func availability(for context: DextunnelOperatorContext) -> DextunnelOperatorAvailability {
        let blocked = sendBlockedReason(for: context)
        let busy = threadBusy(context)
        let queued = queueSummary(context.queuedCount)

        let canQueue = !context.threadId.isEmpty &&
            context.watcherConnected &&
            !context.pendingInteraction &&
            !context.isSendingReply &&
            !context.isSelecting &&
            !context.isControlling &&
            context.hasDraftText

        let canSteer = !context.threadId.isEmpty &&
            context.hasDraftText &&
            !context.isSendingReply &&
            !context.isSelecting &&
            !context.isControlling &&
            !context.isDictating &&
            !busy &&
            (blocked.isEmpty || blocked == "Take control to send from remote.")

        let statusMessage: String
        if !context.isSendingReply && !blocked.isEmpty {
            statusMessage = blocked
        } else if !context.isSendingReply && !queued.isEmpty {
            statusMessage = busy ? "\(queued). Waiting for idle." : "\(queued). Sending soon."
        } else if !context.isSendingReply && !context.hasRemoteControl && context.hasDraftText {
            statusMessage = "Steer now will take control. Queue stays local until you steer."
        } else if !context.isSendingReply && busy {
            statusMessage = context.hasRemoteControl ? "Codex is busy. Queue your next steer." : "Codex is busy. Queue now; it will send when idle."
        } else {
            statusMessage = "Ready"
        }

        return DextunnelOperatorAvailability(
            blockedReason: blocked,
            canQueue: canQueue,
            canSteer: canSteer,
            statusMessage: statusMessage
        )
    }

    public static func menuBarOverview(from payload: DextunnelLivePayload) -> DextunnelMenuBarOverview {
        let roomTitle =
            payload.selectedChannel?.channelSlug ??
            payload.selectedThreadSnapshot?.thread?.name ??
            payload.selectedThreadId ??
            "#no-room"
        let subtitle = [
            payload.selectedChannel?.serverLabel,
            payload.selectedChannel?.source
        ]
        .compactMap { value in
            let text = String(value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : text
        }
        .joined(separator: " // ")
        let diagnostics = payload.status.diagnostics.map(\.summary)
        let statusSummary = payload.status.watcherConnected ? "Session bridge online" : "Bridge reconnecting"

        return DextunnelMenuBarOverview(
            diagnostics: diagnostics,
            recentActivity: recentActivity(from: payload),
            requiresManualDesktopRestart: payload.status.requiresDesktopRestart,
            roomTitle: roomTitle,
            statusSummary: statusSummary,
            subtitle: subtitle
        )
    }

    public static func transcriptEntries(
        from entries: [DextunnelTranscriptEntry],
        filters: Set<DextunnelTranscriptFilter>
    ) -> [DextunnelTranscriptEntry] {
        guard !filters.isEmpty else {
            return []
        }

        return normalizedTranscriptOrder(entries).filter { entry in
            if isSystemNoticeEntry(entry) {
                return false
            }
            if filters.contains(.thread), isConversationEntry(entry), !isAdvisoryEntry(entry) {
                return true
            }
            if filters.contains(.advisories), isAdvisoryEntry(entry) {
                return true
            }
            if filters.contains(.updates),
               !isConversationEntry(entry),
               !isAdvisoryEntry(entry),
               entry.role != "tool" {
                return true
            }
            if filters.contains(.tools), entry.role == "tool" {
                return true
            }
            return false
        }
    }

    public static func transcriptMetaSummary(for entry: DextunnelTranscriptEntry) -> String? {
        let rawComponents: [String] = [
            entry.kind?.trimmingCharacters(in: .whitespacesAndNewlines),
            entry.phase?.trimmingCharacters(in: .whitespacesAndNewlines)
        ]
        .compactMap { value in
            guard let value, !value.isEmpty else {
                return nil
            }
            return humanizedTranscriptMetaComponent(value)
        }

        guard !rawComponents.isEmpty else {
            return nil
        }

        var uniqueComponents: [String] = []
        var seen = Set<String>()
        for component in rawComponents {
            let key = component.lowercased()
            if seen.insert(key).inserted {
                uniqueComponents.append(component)
            }
        }

        let filtered = uniqueComponents.filter { component in
            !transcriptMetaIsImplied(component, role: entry.role)
        }

        guard !filtered.isEmpty else {
            return nil
        }

        return filtered.joined(separator: " / ")
    }

    private static func sendBlockedReason(for context: DextunnelOperatorContext) -> String {
        if context.threadId.isEmpty {
            return "No live session selected."
        }

        if !context.watcherConnected {
            return "Live watcher offline."
        }

        if context.pendingInteraction {
            return "Resolve the pending action first."
        }

        if context.hasAnyRemoteControl && !context.hasRemoteControl {
            let owner = context.ownerLabel.isEmpty ? "Another remote surface" : context.ownerLabel
            return "\(owner) currently has control."
        }

        if !context.hasRemoteControl {
            return "Take control to send from remote."
        }

        return ""
    }

    private static func threadBusy(_ context: DextunnelOperatorContext) -> Bool {
        let normalizedStatus = (context.threadStatus ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let statusBusy = ["inprogress", "running"].contains(normalizedStatus)
        return context.isSendingReply || !(context.writeLockStatus ?? "").isEmpty || !(context.activeTurnId ?? "").isEmpty || statusBusy
    }

    private static func isConversationEntry(_ entry: DextunnelTranscriptEntry) -> Bool {
        if entry.role == "user" {
            return true
        }

        return entry.role == "assistant" && entry.kind != "commentary"
    }

    private static func isAdvisoryEntry(_ entry: DextunnelTranscriptEntry) -> Bool {
        entry.participant?.role == "advisory"
    }

    private static func isSystemNoticeEntry(_ entry: DextunnelTranscriptEntry) -> Bool {
        if entry.role == "system" {
            return true
        }

        switch entry.kind {
        case "context_compaction", "control_notice", "surface_notice", "selection_notice":
            return true
        default:
            return false
        }
    }

    private static func normalizedSummaryText(_ text: String) -> String {
        normalizedToolEnvelopeText(text)
            .replacingOccurrences(
                of: #"\[([^\]]+)\]\([^)]+\)"#,
                with: "$1",
                options: .regularExpression
            )
            .replacingOccurrences(
                of: #"`([^`]+)`"#,
                with: "$1",
                options: .regularExpression
            )
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private static func compactToolOutputPreview(_ text: String, maxLength: Int = 140) -> String {
        let firstMeaningfulLine = normalizedToolEnvelopeText(text)
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })
            ?? ""

        guard !firstMeaningfulLine.isEmpty else {
            return ""
        }

        guard firstMeaningfulLine.count > maxLength else {
            return firstMeaningfulLine
        }

        let endIndex = firstMeaningfulLine.index(firstMeaningfulLine.startIndex, offsetBy: max(0, maxLength - 3))
        return "\(firstMeaningfulLine[..<endIndex])..."
    }

    private static func normalizedTranscriptOrder(_ entries: [DextunnelTranscriptEntry]) -> [DextunnelTranscriptEntry] {
        guard entries.count > 1 else {
            return entries
        }

        guard
            let firstTimestamp = parsedTranscriptDate(entries.first?.timestamp),
            let lastTimestamp = parsedTranscriptDate(entries.last?.timestamp)
        else {
            return entries
        }

        if firstTimestamp > lastTimestamp {
            return Array(entries.reversed())
        }

        return entries
    }

    private static func parsedTranscriptDate(_ value: String?) -> Date? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }

        if let direct = ISO8601DateFormatter().date(from: value) {
            return direct
        }

        guard let number = Double(value) else {
            return nil
        }

        let seconds = number > 1_000_000_000_000 ? number / 1000 : number
        return Date(timeIntervalSince1970: seconds)
    }

    private static func normalizedToolEnvelopeText(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let unwrappedJson: String
        if trimmed.first == "{", let data = trimmed.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            var extracted: String? = nil
            for key in ["output", "stdout", "stderr", "message", "command"] {
                if let value = object[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    extracted = value
                    break
                }
            }
            unwrappedJson = extracted ?? text
        } else {
            unwrappedJson = text
        }

        let lines = unwrappedJson
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

        if let outputIndex = lines.firstIndex(where: { $0.lowercased() == "output:" }) {
            let meaningfulOutput = lines
                .dropFirst(outputIndex + 1)
                .first(where: { line in
                    !line.isEmpty && !isToolWrapperLine(line)
                })
            if let meaningfulOutput, !meaningfulOutput.isEmpty {
                return meaningfulOutput
            }
        }

        let firstMeaningfulLine = lines.first(where: { line in
            !line.isEmpty && !isToolWrapperLine(line)
        })
        if let firstMeaningfulLine, !firstMeaningfulLine.isEmpty {
            return firstMeaningfulLine
        }

        return unwrappedJson
    }

    private static func isToolWrapperLine(_ line: String) -> Bool {
        let normalized = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.isEmpty {
            return true
        }

        return normalized.hasPrefix("command:") ||
            normalized.hasPrefix("chunk id:") ||
            normalized.hasPrefix("wall time:") ||
            normalized.hasPrefix("process exited") ||
            normalized.hasPrefix("original token count:") ||
            normalized == "output:"
    }

    private static func transcriptSummarySpeakerLabel(for entry: DextunnelTranscriptEntry) -> String {
        if entry.role == "user" {
            return "you"
        }

        if entry.role == "assistant" {
            return entry.participant?.label ?? "codex"
        }

        if let participantLabel = entry.participant?.label, !participantLabel.isEmpty {
            return participantLabel
        }

        if let lane = entry.lane, !lane.isEmpty {
            return lane
        }

        return entry.role
    }

    private static func humanizedTranscriptMetaComponent(_ value: String) -> String {
        value
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(
                of: #"([a-z0-9])([A-Z])"#,
                with: "$1 $2",
                options: .regularExpression
            )
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .lowercased()
    }

    private static func transcriptMetaIsImplied(_ component: String, role: String) -> Bool {
        let normalized = component.lowercased()

        if normalized == "message" && (role == "assistant" || role == "user") {
            return true
        }

        return false
    }
}
