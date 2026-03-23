import Foundation
import Testing
@testable import DextunnelBridgeProtocol
@testable import DextunnelOperatorCore
@testable import DextunnelSurfaceContracts

@Test
func universalApplePlanPrefersMenuBarAndUniversalIOS() {
    #expect(DextunnelAppleSeedPlan.rolloutOrder == [
        .macMenuBarHost,
        .universalIOSOperator,
        .watchCompanion
    ])
    #expect(DextunnelAppleSeedPlan.contracts.contains(where: { contract in
        contract.role == .universalIOSOperator &&
            contract.capabilities.contains("compact iPhone layout") &&
            contract.capabilities.contains("regular-width iPad layout")
    }))
}

@Test
func operatorAvailabilityAllowsQueueAndSteerBeforeControlClaim() {
    let availability = DextunnelOperatorCore.availability(for: DextunnelOperatorContext(
        hasDraftText: true,
        threadId: "thread-1",
        watcherConnected: true
    ))

    #expect(availability.canQueue)
    #expect(availability.canSteer)
    #expect(availability.blockedReason == "Take control to send from remote.")
}

@Test
func operatorAvailabilityBlocksOnPendingInteraction() {
    let availability = DextunnelOperatorCore.availability(for: DextunnelOperatorContext(
        hasDraftText: true,
        pendingInteraction: true,
        threadId: "thread-1",
        watcherConnected: true
    ))

    #expect(!availability.canQueue)
    #expect(!availability.canSteer)
    #expect(availability.blockedReason == "Resolve the pending action first.")
}

@Test
func operatorAvailabilityTreatsNonIdleThreadStatusAsBusy() {
    let availability = DextunnelOperatorCore.availability(for: DextunnelOperatorContext(
        hasDraftText: true,
        hasRemoteControl: true,
        threadId: "thread-1",
        threadStatus: "inProgress",
        watcherConnected: true
    ))

    #expect(availability.canQueue)
    #expect(!availability.canSteer)
    #expect(availability.statusMessage == "Codex is busy. Queue your next steer.")
}

@Test
func menuBarOverviewKeepsDesktopRestartTruthVisible() {
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
            transcript: [
                DextunnelTranscriptEntry(
                    lane: "remote",
                    participant: DextunnelParticipant(id: "remote", label: "remote"),
                    role: "user",
                    text: "keep going from my phone"
                ),
                DextunnelTranscriptEntry(
                    participant: DextunnelParticipant(id: "codex", label: "codex"),
                    role: "assistant",
                    text: "working on it"
                )
            ]
        ),
        status: DextunnelLiveStatus(
            diagnostics: [
                DextunnelOperatorDiagnostic(
                    code: "desktop_restart_required",
                    domain: "desktop",
                    severity: "info",
                    summary: "Desktop Codex still requires restart to rehydrate external turns."
                )
            ],
            runtimeProfile: "default",
            selectionMode: "shared-room",
            watcherConnected: true
        )
    )

    let overview = DextunnelOperatorCore.menuBarOverview(from: payload)
    #expect(overview.roomTitle == "#dextunnel")
    #expect(overview.requiresManualDesktopRestart)
    #expect(overview.statusSummary == "Session bridge online")
    #expect(overview.diagnostics.contains("Desktop Codex still requires restart to rehydrate external turns."))
    #expect(overview.recentActivity == [
        "remote sent a steer",
        "codex replied"
    ])
    #expect(DextunnelOperatorCore.desktopSyncNote().contains("Quit and reopen the Codex app manually"))
}

@Test
func dictationDraftComposerKeepsBaseTextAndAppendsTranscript() {
    #expect(
        DextunnelOperatorCore.composeDictationDraft(
            baseDraft: "Need to reply",
            dictatedText: "Please keep going and summarize the failures."
        ) == "Need to reply\nPlease keep going and summarize the failures."
    )
    #expect(
        DextunnelOperatorCore.composeDictationDraft(
            baseDraft: "",
            dictatedText: "Quick note"
        ) == "Quick note"
    )
    #expect(DextunnelOperatorCore.dictationButtonTitle(isDictating: false) == "Dictate")
    #expect(DextunnelOperatorCore.dictationButtonTitle(isDictating: true) == "Stop dictation")
}

@Test
func transcriptSummaryKeepsRecentConversationContextCompact() {
    let summary = DextunnelOperatorCore.transcriptSummary(from: [
        DextunnelTranscriptEntry(
            kind: "commentary",
            participant: DextunnelParticipant(id: "codex", label: "codex"),
            role: "assistant",
            text: "checking the bridge"
        ),
        DextunnelTranscriptEntry(
            participant: DextunnelParticipant(id: "remote", label: "remote"),
            role: "user",
            text: "please make the mobile composer smaller"
        ),
        DextunnelTranscriptEntry(
            participant: DextunnelParticipant(id: "codex", label: "codex"),
            role: "assistant",
            text: "i tightened the compact layout and rebuilt the app"
        )
    ])

    #expect(summary == "you: please make the mobile composer smaller | codex: i tightened the compact layout and rebuilt the app")
}

@Test
func compactToolPreviewSkipsWrapperLinesAndShowsMeaningfulOutput() {
    let entry = DextunnelTranscriptEntry(
        kind: "tool_output",
        lane: "tools",
        role: "tool",
        text: """
        Command: /bin/bash -lc \"swift test\"
        Chunk ID: abc123
        Wall time: 0.1 seconds
        Process exited with code 0
        Original token count: 42
        Output:
        Success. Updated the following files:
        /Users/zsolt/dev/codex/dextunnel/native/apple/Sources/DextunnelUniversalIOSShell/UniversalIOSShell.swift
        """
    )

    #expect(
        DextunnelOperatorCore.transcriptDisplayText(for: entry) == "Success. Updated the following files:"
    )
}

@Test
func transcriptFilteringSeparatesThreadUpdatesAdvisoriesAndTools() {
    let entries = [
        DextunnelTranscriptEntry(
            participant: DextunnelParticipant(id: "remote", label: "remote"),
            role: "user",
            text: "please focus on the mobile UI"
        ),
        DextunnelTranscriptEntry(
            kind: "commentary",
            participant: DextunnelParticipant(id: "codex", label: "codex"),
            role: "assistant",
            text: "checking the current shell layout"
        ),
        DextunnelTranscriptEntry(
            participant: DextunnelParticipant(id: "oracle", label: "oracle", role: "advisory"),
            role: "assistant",
            text: "keep the composer compact"
        ),
        DextunnelTranscriptEntry(
            role: "tool",
            text: "node --check passed"
        ),
        DextunnelTranscriptEntry(
            kind: "control_notice",
            role: "system",
            text: "remote control released"
        ),
        DextunnelTranscriptEntry(
            kind: "queued",
            role: "assistant",
            text: "queued locally"
        ),
        DextunnelTranscriptEntry(
            participant: DextunnelParticipant(id: "codex", label: "codex"),
            role: "assistant",
            text: "i moved the send spinner down into the composer"
        )
    ]

    #expect(
        DextunnelOperatorCore.transcriptEntries(
            from: entries,
            filters: Set(DextunnelTranscriptFilter.allCases)
        ).map(\.text) == [
            "please focus on the mobile UI",
            "checking the current shell layout",
            "keep the composer compact",
            "node --check passed",
            "queued locally",
            "i moved the send spinner down into the composer"
        ]
    )
    #expect(
        DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.thread]).map(\.text) == [
            "please focus on the mobile UI",
            "queued locally",
            "i moved the send spinner down into the composer"
        ]
    )
    #expect(
        DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.advisories]).map(\.text) == [
            "keep the composer compact"
        ]
    )
    #expect(
        DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.updates]).map(\.text) == [
            "checking the current shell layout"
        ]
    )
    #expect(
        DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.tools]).map(\.text) == [
            "node --check passed"
        ]
    )
    #expect(
        DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.thread, .updates]).map(\.text) == [
            "please focus on the mobile UI",
            "checking the current shell layout",
            "queued locally",
            "i moved the send spinner down into the composer"
        ]
    )
    #expect(DextunnelOperatorCore.transcriptEntries(from: entries, filters: [.changes]).isEmpty)
    #expect(DextunnelOperatorCore.transcriptEntries(from: entries, filters: []).isEmpty)
}

@Test
func transcriptFilterOrderMatchesOperatorUi() {
    #expect(DextunnelTranscriptFilter.allCases == [
        .updates,
        .thread,
        .tools,
        .changes,
        .advisories
    ])
}

@Test
func transcriptMarkdownFormattingParsesLinksAndCode() {
    let attributed = DextunnelOperatorCore.attributedTranscriptText(
        from: """
        Use [remote](http://127.0.0.1:4317/remote.html) and `npm test`.

        Keep the paragraph break.
        """
    )

    #expect(String(attributed.characters) == "Use remote and npm test.\n\nKeep the paragraph break.")
    #expect(attributed.runs.contains { run in
        run.link != nil
    })
}

@Test
func transcriptToolOutputDefaultsToFirstMeaningfulLine() {
    let toolEntry = DextunnelTranscriptEntry(
        kind: "tool_output",
        phase: "completed",
        role: "tool",
        text: """

        Command: /bin/bash -lc "npm test"
        Chunk ID: abc123
        Wall time: 1.2 seconds
        Output:
        ok
        """
    )

    #expect(
        String(DextunnelOperatorCore.attributedTranscriptText(for: toolEntry).characters) ==
        "ok"
    )
    #expect(
        String(DextunnelOperatorCore.attributedTranscriptText(for: toolEntry, expanded: true).characters)
            .contains("Chunk ID: abc123")
    )
}

@Test
func transcriptMetaSummarySuppressesRedundantMachineLabels() {
    let commentaryEntry = DextunnelTranscriptEntry(
        kind: "commentary",
        participant: DextunnelParticipant(id: "updates", label: "updates"),
        phase: "commentary",
        role: "assistant",
        text: "checking the shell"
    )
    let finalAnswerEntry = DextunnelTranscriptEntry(
        kind: "final_answer",
        participant: DextunnelParticipant(id: "codex", label: "codex"),
        phase: "final_answer",
        role: "assistant",
        text: "done"
    )
    let uniquePhaseEntry = DextunnelTranscriptEntry(
        kind: "commentary",
        participant: DextunnelParticipant(id: "updates", label: "updates"),
        phase: "in_progress",
        role: "assistant",
        text: "still working"
    )

    #expect(DextunnelOperatorCore.transcriptMetaSummary(for: commentaryEntry) == "commentary")
    #expect(DextunnelOperatorCore.transcriptMetaSummary(for: finalAnswerEntry) == "final answer")
    #expect(DextunnelOperatorCore.transcriptMetaSummary(for: uniquePhaseEntry) == "commentary / in progress")
}
