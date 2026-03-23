#if os(iOS)
import AVFoundation
import Foundation
import Observation
import Speech
import DextunnelAppleState
import DextunnelOperatorCore

@MainActor
@Observable
final class DextunnelNativeDictationController {
    private let store: DextunnelLiveBridgeStore
    private let locale: Locale

    private var audioEngine = AVAudioEngine()
    private var baseDraftText = ""
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer: SFSpeechRecognizer?

    var lastErrorMessage: String?
    var statusText: String

    init(store: DextunnelLiveBridgeStore, locale: Locale = .current) {
        self.store = store
        self.locale = locale
        self.statusText = DextunnelOperatorCore.dictationStatusText(isDictating: false)
    }

    var buttonTitle: String {
        DextunnelOperatorCore.dictationButtonTitle(isDictating: store.isDictating)
    }

    func toggle() async {
        if store.isDictating {
            stop()
        } else {
            await start()
        }
    }

    func stop() {
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil

        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        store.isDictating = false
        statusText = DextunnelOperatorCore.dictationStatusText(isDictating: false)
    }

    private func start() async {
        guard !store.isDictating else {
            return
        }

        lastErrorMessage = nil
        statusText = "Requesting speech access..."

        let speechStatus = await requestSpeechAuthorization()
        guard speechStatus == .authorized else {
            lastErrorMessage = speechAuthorizationMessage(for: speechStatus)
            statusText = DextunnelOperatorCore.dictationStatusText(isDictating: false)
            return
        }

        let microphoneGranted = await requestMicrophonePermission()
        guard microphoneGranted else {
            lastErrorMessage = "Microphone access is required for native dictation."
            statusText = DextunnelOperatorCore.dictationStatusText(isDictating: false)
            return
        }

        let recognizer = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer()
        guard let recognizer, recognizer.isAvailable else {
            lastErrorMessage = "Speech recognition is unavailable on this device right now."
            statusText = DextunnelOperatorCore.dictationStatusText(isDictating: false)
            return
        }

        do {
            try configureAudioSession()

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true

            let inputNode = audioEngine.inputNode
            inputNode.removeTap(onBus: 0)
            let format = inputNode.outputFormat(forBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
                request?.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()

            speechRecognizer = recognizer
            recognitionRequest = request
            baseDraftText = store.draftText
            store.isDictating = true
            statusText = DextunnelOperatorCore.dictationStatusText(isDictating: true)

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else {
                        return
                    }

                    if let result {
                        self.store.draftText = DextunnelOperatorCore.composeDictationDraft(
                            baseDraft: self.baseDraftText,
                            dictatedText: result.bestTranscription.formattedString
                        )
                        if result.isFinal {
                            self.stop()
                        }
                    }

                    if let error {
                        self.lastErrorMessage = error.localizedDescription
                        self.stop()
                    }
                }
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            stop()
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func speechAuthorizationMessage(for status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .denied:
            return "Speech recognition permission was denied."
        case .restricted:
            return "Speech recognition is restricted on this device."
        case .notDetermined:
            return "Speech recognition permission is still pending."
        case .authorized:
            return ""
        @unknown default:
            return "Speech recognition is unavailable."
        }
    }
}
#endif
