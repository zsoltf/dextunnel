import Foundation

public enum DextunnelAppleSurfaceRole: String, CaseIterable, Sendable {
    case macMenuBarHost
    case universalIOSOperator
    case watchCompanion
}

public struct DextunnelSurfaceCapabilityContract: Sendable {
    public let role: DextunnelAppleSurfaceRole
    public let capabilities: [String]
    public let successCriteria: [String]

    public init(role: DextunnelAppleSurfaceRole, capabilities: [String], successCriteria: [String]) {
        self.role = role
        self.capabilities = capabilities
        self.successCriteria = successCriteria
    }
}

public enum DextunnelAppleSeedPlan {
    public static let rolloutOrder: [DextunnelAppleSurfaceRole] = [
        .macMenuBarHost,
        .universalIOSOperator,
        .watchCompanion
    ]

    public static let daemonRule =
        "The daemon owns semantic truth. Apple surfaces own local UX and system affordances."

    public static let contracts: [DextunnelSurfaceCapabilityContract] = [
        DextunnelSurfaceCapabilityContract(
            role: .macMenuBarHost,
            capabilities: [
                "trust bootstrap",
                "reveal affordances",
                "notifications",
                "menu bar status",
                "local lifecycle"
            ],
            successCriteria: [
                "Bootstraps the local bridge cleanly from the menu bar",
                "Keeps restart-to-rehydrate truth explicit",
                "Does not duplicate daemon semantics"
            ]
        ),
        DextunnelSurfaceCapabilityContract(
            role: .universalIOSOperator,
            capabilities: [
                "queue",
                "steer",
                "approvals",
                "dictation",
                "room selection",
                "compact iPhone layout",
                "regular-width iPad layout"
            ],
            successCriteria: [
                "Beats the web shell for compact active steering on iPhone",
                "Recovers drafts and queue calmly",
                "Keeps dictation bounded and native-feeling",
                "Uses regular-width space on iPad for richer operator context"
            ]
        ),
        DextunnelSurfaceCapabilityContract(
            role: .watchCompanion,
            capabilities: [
                "approve",
                "quick dictate",
                "short canned actions"
            ],
            successCriteria: [
                "Stays bounded and high-signal",
                "Never becomes the main full-control surface"
            ]
        )
    ]
}
