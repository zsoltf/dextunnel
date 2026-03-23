// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "DextunnelAppleSeed",
    platforms: [
        .macOS(.v15),
        .iOS(.v18),
        .watchOS(.v11)
    ],
    products: [
        .library(
            name: "DextunnelBridgeProtocol",
            targets: ["DextunnelBridgeProtocol"]
        ),
        .library(
            name: "DextunnelBridgeClient",
            targets: ["DextunnelBridgeClient"]
        ),
        .library(
            name: "DextunnelAppleState",
            targets: ["DextunnelAppleState"]
        ),
        .library(
            name: "DextunnelOperatorCore",
            targets: ["DextunnelOperatorCore"]
        ),
        .library(
            name: "DextunnelMenuBarHostShell",
            targets: ["DextunnelMenuBarHostShell"]
        ),
        .library(
            name: "DextunnelNativeAppSupport",
            targets: ["DextunnelNativeAppSupport"]
        ),
        .library(
            name: "DextunnelUniversalIOSShell",
            targets: ["DextunnelUniversalIOSShell"]
        ),
        .library(
            name: "DextunnelSurfaceContracts",
            targets: ["DextunnelSurfaceContracts"]
        ),
        .executable(
            name: "DextunnelNativeBridgeSmoke",
            targets: ["DextunnelNativeBridgeSmoke"]
        )
    ],
    targets: [
        .target(
            name: "DextunnelBridgeProtocol"
        ),
        .target(
            name: "DextunnelBridgeClient",
            dependencies: ["DextunnelBridgeProtocol"]
        ),
        .target(
            name: "DextunnelAppleState",
            dependencies: [
                "DextunnelBridgeClient",
                "DextunnelBridgeProtocol",
                "DextunnelOperatorCore"
            ]
        ),
        .target(
            name: "DextunnelOperatorCore",
            dependencies: ["DextunnelBridgeProtocol"]
        ),
        .target(
            name: "DextunnelMenuBarHostShell",
            dependencies: [
                "DextunnelAppleState",
                "DextunnelOperatorCore",
                "DextunnelBridgeProtocol"
            ]
        ),
        .target(
            name: "DextunnelNativeAppSupport",
            dependencies: [
                "DextunnelAppleState",
                "DextunnelBridgeClient",
                "DextunnelBridgeProtocol"
            ]
        ),
        .target(
            name: "DextunnelUniversalIOSShell",
            dependencies: [
                "DextunnelAppleState",
                "DextunnelOperatorCore",
                "DextunnelBridgeProtocol"
            ]
        ),
        .target(
            name: "DextunnelSurfaceContracts"
        ),
        .executableTarget(
            name: "DextunnelNativeBridgeSmoke",
            dependencies: [
                "DextunnelBridgeClient",
                "DextunnelBridgeProtocol"
            ]
        ),
        .testTarget(
            name: "DextunnelAppleSeedTests",
            dependencies: [
                "DextunnelBridgeProtocol",
                "DextunnelBridgeClient",
                "DextunnelAppleState",
                "DextunnelOperatorCore",
                "DextunnelMenuBarHostShell",
                "DextunnelNativeAppSupport",
                "DextunnelUniversalIOSShell",
                "DextunnelSurfaceContracts",
                "DextunnelNativeBridgeSmoke"
            ]
        )
    ]
)
