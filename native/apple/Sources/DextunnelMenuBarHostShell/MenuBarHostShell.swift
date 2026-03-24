#if os(macOS)
import SwiftUI
import DextunnelAppleState
import DextunnelBridgeProtocol
import DextunnelOperatorCore

@available(macOS 15.0, *)
public struct DextunnelMenuBarStatusView: View {
    private let store: DextunnelLiveBridgeStore
    private let openRemoteView: (() -> Void)?
    private let tailscaleActive: Bool
    private let tailscaleURLString: String?

    public init(
        store: DextunnelLiveBridgeStore,
        openRemoteView: (() -> Void)? = nil,
        tailscaleActive: Bool = false,
        tailscaleURLString: String? = nil
    ) {
        self.store = store
        self.openRemoteView = openRemoteView
        self.tailscaleActive = tailscaleActive
        self.tailscaleURLString = tailscaleURLString
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            headerView
            tailscaleView
            pendingInteractionView
            errorView
        }
        .controlSize(.regular)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headerView: some View {
        HStack(alignment: .center, spacing: 10) {
            statusGlyph

            VStack(alignment: .leading, spacing: 2) {
                Text("Dextunnel")
                    .font(.title3.weight(.semibold))
                    .lineLimit(1)

                Text(statusHeadline)
                    .font(.subheadline.weight(.medium))
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
            return "Connected"
        }
        if store.isRefreshing || store.connectionPhase == .connecting || store.connectionPhase == .reconnecting {
            return "Reconnecting"
        }
        return "Disconnected"
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
    private var tailscaleView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(tailscaleActive ? "Tailscale up" : "Tailscale down")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(tailscaleActive ? .green : .red)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background((tailscaleActive ? Color.green : .red).opacity(0.12), in: Capsule())
                .overlay(
                    Capsule()
                        .strokeBorder((tailscaleActive ? Color.green : .red).opacity(0.35), lineWidth: 1)
                )

            if let tailscaleURLString, !tailscaleURLString.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Tailnet remote")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    if let tailscaleRemoteURL = tailscaleRemoteURL {
                        Link(destination: tailscaleRemoteURL) {
                            Text(tailscaleRemoteURL.absoluteString)
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                .foregroundStyle(.tint)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(tailscaleURLString)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .textSelection(.enabled)
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var tailscaleRemoteURL: URL? {
        guard let tailscaleURLString else {
            return nil
        }
        return URL(string: tailscaleURLString)
    }

    @ViewBuilder
    private var pendingInteractionView: some View {
        if let pending = store.livePayload?.pendingInteraction {
            VStack(alignment: .leading, spacing: 4) {
                Text(pending.title ?? pending.summary ?? "Pending action")
                    .font(.subheadline.weight(.semibold))
                if let detail = pending.detail ?? pending.message, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
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
                    .font(.footnote.weight(.semibold))
                }
                .padding(.top, 4)
            }
        } else {
            HStack(spacing: 8) {
                Button(pending.declineLabel ?? "Decline") {
                    Task { await store.respondToPendingInteraction(action: "decline") }
                }
                .font(.footnote.weight(.semibold))

                Spacer()

                if pending.canApproveForSession == true {
                    Button(pending.sessionActionLabel ?? "Allow session") {
                        Task { await store.respondToPendingInteraction(action: "session") }
                    }
                    .font(.footnote.weight(.semibold))
                    .tint(.orange)
                }

                Button(pending.approveLabel ?? "Approve") {
                    Task { await store.respondToPendingInteraction(action: "approve") }
                }
                .font(.footnote.weight(.semibold))
                .buttonStyle(.borderedProminent)
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var errorView: some View {
        if let lastErrorMessage = store.lastErrorMessage, !lastErrorMessage.isEmpty {
            Divider()
            Text(lastErrorMessage)
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }
}
#endif
