import Foundation
import DextunnelAppleState

#if canImport(UserNotifications)
@preconcurrency import UserNotifications
#endif

public protocol DextunnelLocalNotificationTransport: Sendable {
    func requestAuthorizationIfNeeded() async
    func deliver(identifier: String, title: String, body: String) async
}

public struct DextunnelNoopNotificationTransport: DextunnelLocalNotificationTransport {
    public init() {}

    public func requestAuthorizationIfNeeded() async {}

    public func deliver(identifier: String, title: String, body: String) async {}
}

#if canImport(UserNotifications)
public final class DextunnelUserNotificationTransport: @unchecked Sendable, DextunnelLocalNotificationTransport {
    private let center: UNUserNotificationCenter

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
    }

    public func requestAuthorizationIfNeeded() async {
        _ = try? await center.requestAuthorization(options: [.alert, .badge, .sound])
    }

    public func deliver(identifier: String, title: String, body: String) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        try? await center.add(request)
    }
}
#endif

@MainActor
public final class DextunnelLocalNotificationCoordinator {
    private let transport: any DextunnelLocalNotificationTransport
    private var didRequestAuthorization = false
    private var lastFailedDraftID: UUID?
    private var lastPendingInteractionID: String?
    private var lastRoomTitle: String?

    public init(transport: (any DextunnelLocalNotificationTransport)? = nil) {
#if canImport(UserNotifications)
        self.transport = transport ?? DextunnelUserNotificationTransport()
#else
        self.transport = transport ?? DextunnelNoopNotificationTransport()
#endif
    }

    public func update(
        with snapshot: DextunnelStoreNotificationSnapshot,
        notificationsEnabled: Bool
    ) async {
        if lastRoomTitle != snapshot.roomTitle {
            lastRoomTitle = snapshot.roomTitle
            lastFailedDraftID = nil
            lastPendingInteractionID = nil
        }

        guard notificationsEnabled else {
            return
        }

        if
            let pendingId = snapshot.pendingInteractionId,
            pendingId != lastPendingInteractionID
        {
            await ensureAuthorization()
            await transport.deliver(
                identifier: "pending.\(pendingId)",
                title: "Action needed in \(snapshot.roomTitle)",
                body: notificationBody(
                    primary: snapshot.pendingInteractionTitle ?? "A pending interaction needs your attention.",
                    secondary: snapshot.pendingInteractionDetail
                )
            )
            lastPendingInteractionID = pendingId
        }

        if
            let failedDraftId = snapshot.failedDraftId,
            failedDraftId != lastFailedDraftID
        {
            await ensureAuthorization()
            await transport.deliver(
                identifier: "failed-send.\(failedDraftId.uuidString)",
                title: "Retry needed in \(snapshot.roomTitle)",
                body: notificationBody(
                    primary: snapshot.failedDraftText ?? "A queued message needs a retry.",
                    secondary: snapshot.failedDraftError
                )
            )
            lastFailedDraftID = failedDraftId
        }
    }

    private func ensureAuthorization() async {
        guard !didRequestAuthorization else {
            return
        }
        didRequestAuthorization = true
        await transport.requestAuthorizationIfNeeded()
    }

    private func notificationBody(primary: String, secondary: String?) -> String {
        let trimmedPrimary = primary.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSecondary = secondary?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmedSecondary, !trimmedSecondary.isEmpty else {
            return trimmedPrimary
        }
        if trimmedPrimary.isEmpty {
            return trimmedSecondary
        }
        return "\(trimmedPrimary)\n\(trimmedSecondary)"
    }
}
