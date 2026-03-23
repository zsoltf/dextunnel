#if os(macOS)
import SwiftUI
import DextunnelAppleState
import DextunnelBridgeProtocol
import DextunnelOperatorCore

@available(macOS 15.0, *)
public struct DextunnelMenuBarStatusView: View {
    private let store: DextunnelLiveBridgeStore
    private let openRemoteView: (() -> Void)?

    public init(
        store: DextunnelLiveBridgeStore,
        openRemoteView: (() -> Void)? = nil
    ) {
        self.store = store
        self.openRemoteView = openRemoteView
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerView
            pendingInteractionView
            actionsRow
            errorView
        }
        .controlSize(.small)
        .padding(12)
        .frame(minWidth: 300)
    }

    private var headerView: some View {
        HStack(alignment: .center, spacing: 10) {
            statusGlyph

            VStack(alignment: .leading, spacing: 2) {
                Text(store.menuBarOverview?.roomTitle ?? "Dextunnel")
                    .font(.headline.monospaced())
                    .lineLimit(1)

                Text(statusHeadline)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
    }

    private var statusGlyph: some View {
        Image(systemName: statusSymbolName)
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(statusSymbolColor)
            .frame(width: 28, height: 28)
    }

    private var statusHeadline: String {
        if store.connectionPhase == .live, store.livePayload?.status.watcherConnected == true {
            return "Session bridge online"
        }
        if store.isRefreshing || store.connectionPhase == .connecting || store.connectionPhase == .reconnecting {
            return "Reconnecting"
        }
        return "Not connected"
    }

    private var statusSymbolName: String {
        if store.connectionPhase == .live, store.livePayload?.status.watcherConnected == true {
            return "checkmark.circle.fill"
        }
        return "xmark.circle.fill"
    }

    private var statusSymbolColor: Color {
        if store.connectionPhase == .live, store.livePayload?.status.watcherConnected == true {
            return .green
        }
        return .red
    }

    @ViewBuilder
    private var pendingInteractionView: some View {
        if let pending = store.livePayload?.pendingInteraction {
            VStack(alignment: .leading, spacing: 4) {
                Text(pending.title ?? pending.summary ?? "Pending action")
                    .font(.caption.weight(.semibold))
                if let detail = pending.detail ?? pending.message, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                pendingInteractionActions(for: pending)
            }
            .padding(8)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private func pendingInteractionActions(for pending: DextunnelPendingInteraction) -> some View {
        if pending.actionKind == "user_input" {
            if let openRemoteView {
                HStack {
                    Spacer()
                    Button("Open remote to respond") {
                        openRemoteView()
                    }
                    .font(.caption)
                }
                .padding(.top, 4)
            }
        } else {
            HStack(spacing: 8) {
                Button(pending.declineLabel ?? "Decline") {
                    Task { await store.respondToPendingInteraction(action: "decline") }
                }
                .font(.caption)

                Spacer()

                if pending.canApproveForSession == true {
                    Button(pending.sessionActionLabel ?? "Allow session") {
                        Task { await store.respondToPendingInteraction(action: "session") }
                    }
                    .font(.caption)
                    .tint(.orange)
                }

                Button(pending.approveLabel ?? "Approve") {
                    Task { await store.respondToPendingInteraction(action: "approve") }
                }
                .font(.caption)
                .buttonStyle(.borderedProminent)
            }
            .padding(.top, 4)
        }
    }

    private var actionsRow: some View {
        HStack(spacing: 8) {
            actionButton("Refresh") {
                Task { await store.refresh() }
            }
            .disabled(store.isRefreshing)

            actionButton("Reveal") {
                Task { await store.revealSelectedThreadInCodex() }
            }
            .disabled(store.selectedThreadId.isEmpty)

            if let openRemoteView {
                actionButton("Remote") {
                    openRemoteView()
                }
                .help("Open remote")
            }
        }
    }

    private func actionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.caption.weight(.semibold))
    }

    @ViewBuilder
    private var errorView: some View {
        if let lastErrorMessage = store.lastErrorMessage, !lastErrorMessage.isEmpty {
            Divider()
            Text(lastErrorMessage)
                .font(.caption)
                .foregroundStyle(.red)
        }
    }
}
#endif
