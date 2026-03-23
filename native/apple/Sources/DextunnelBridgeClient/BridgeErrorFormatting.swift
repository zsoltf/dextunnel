import Foundation
import DextunnelBridgeProtocol

private struct DextunnelBridgeLiveStateEnvelope: Decodable {
    let state: DextunnelLivePayload?
}

public enum DextunnelBridgeErrorFormatting {
    public static func userVisibleMessage(for error: Error) -> String? {
        if isBenignCancellation(error) {
            return nil
        }
        return message(for: error)
    }

    public static func shouldSurfacePassiveError(_ error: Error) -> Bool {
        if isBenignCancellation(error) {
            return false
        }
        if isTransientNetworkIssue(error) {
            return false
        }
        return true
    }

    public static func message(for error: Error) -> String {
        if let httpError = error as? DextunnelBridgeHTTPError {
            return httpError.message
        }
        if let decodingError = error as? DecodingError {
            return decodingMessage(for: decodingError)
        }
        return error.localizedDescription
    }

    public static func livePayload(from error: Error) -> DextunnelLivePayload? {
        guard let httpError = error as? DextunnelBridgeHTTPError,
              let body = httpError.body?.data(using: .utf8)
        else {
            return nil
        }

        return try? JSONDecoder().decode(DextunnelBridgeLiveStateEnvelope.self, from: body).state
    }

    public static func shouldMarkConnectionFailed(for error: Error) -> Bool {
        if let httpError = error as? DextunnelBridgeHTTPError {
            switch httpError.statusCode {
            case 400, 403, 409:
                return false
            default:
                break
            }
        }

        if isTransientNetworkIssue(error) || isBenignCancellation(error) {
            return false
        }

        return true
    }

    private static func decodingMessage(for error: DecodingError) -> String {
        switch error {
        case let .typeMismatch(_, context):
            return "Bridge payload format changed at \(codingPath(context.codingPath)): \(context.debugDescription)"
        case let .valueNotFound(_, context):
            return "Bridge payload is missing a value at \(codingPath(context.codingPath)): \(context.debugDescription)"
        case let .keyNotFound(key, context):
            return "Bridge payload is missing `\(key.stringValue)` at \(codingPath(context.codingPath + [key]))."
        case let .dataCorrupted(context):
            return "Bridge payload is corrupt at \(codingPath(context.codingPath)): \(context.debugDescription)"
        @unknown default:
            return "Bridge payload could not be decoded."
        }
    }

    private static func codingPath(_ path: [CodingKey]) -> String {
        guard !path.isEmpty else {
            return "root"
        }
        return path
            .map { key in
                if let intValue = key.intValue {
                    return "[\(intValue)]"
                }
                return key.stringValue
            }
            .joined(separator: ".")
            .replacingOccurrences(of: ".[", with: "[")
    }

    private static func isBenignCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == URLError.Code.cancelled.rawValue {
            return true
        }
        if nsError.domain == NSCocoaErrorDomain, nsError.code == CocoaError.userCancelled.rawValue {
            return true
        }

        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return message == "cancelled" || message == "canceled"
    }

    private static func isTransientNetworkIssue(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost:
                return true
            default:
                break
            }
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case URLError.Code.timedOut.rawValue,
                 URLError.Code.networkConnectionLost.rawValue,
                 URLError.Code.notConnectedToInternet.rawValue,
                 URLError.Code.cannotConnectToHost.rawValue,
                 URLError.Code.cannotFindHost.rawValue:
                return true
            default:
                break
            }
        }

        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return message == "the request timed out."
    }
}
