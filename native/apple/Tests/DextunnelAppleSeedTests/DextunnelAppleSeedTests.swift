import Foundation
import Testing
@testable import DextunnelBridgeProtocol
@testable import DextunnelSurfaceContracts

@Test
func livePayloadDecodesDesktopRestartDiagnostic() throws {
    let json = """
    {
      "pendingInteraction": null,
      "selectedAttachments": [
        { "count": 1, "label": "remote", "state": "open", "surface": "remote" }
      ],
      "selectedChannel": {
        "channelSlug": "#dextunnel",
        "serverLabel": "codex/dextunnel",
        "source": "vscode",
        "topic": "Advance Dextunnel from semantic companion MVP to safer live mobile control for Codex sessions."
      },
      "selectedProjectCwd": "/Users/zsolt/dev/codex/dextunnel",
      "selectedThreadId": "thread-1",
      "selectedThreadSnapshot": {
        "channel": {
          "channelSlug": "#dextunnel",
          "serverLabel": "codex/dextunnel",
          "source": "vscode",
          "topic": "topic"
        },
        "thread": {
          "activeTurnId": null,
          "cwd": "/Users/zsolt/dev/codex/dextunnel",
          "id": "thread-1",
          "name": "dextunnel",
          "source": "vscode",
          "status": "completed"
        }
      },
      "status": {
        "diagnostics": [
          {
            "code": "desktop_restart_required",
            "domain": "desktop",
            "severity": "info",
            "summary": "Desktop Codex still requires restart to rehydrate external turns."
          }
        ],
        "runtimeProfile": "default",
        "selectionMode": "shared-room",
        "watcherConnected": true
      }
    }
    """.data(using: .utf8)!

    let payload = try JSONDecoder().decode(DextunnelLivePayload.self, from: json)
    #expect(payload.selectedChannel?.channelSlug == "#dextunnel")
    #expect(payload.status.requiresDesktopRestart)
}

@Test
func appleSeedPlanKeepsWatchLastAndBounded() {
    #expect(DextunnelAppleSeedPlan.rolloutOrder.last == .watchCompanion)
    #expect(DextunnelAppleSeedPlan.contracts.contains(where: { contract in
        contract.role == .watchCompanion && contract.successCriteria.contains("Never becomes the main full-control surface")
    }))
}
