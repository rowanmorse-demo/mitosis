import Photos
import ReplayKit

/// Game recording: when the player turns on Settings › Record games, the page asks for a recording
/// at the start of each run and stops it when the run ends. ReplayKit records the app's screen and
/// sound (iOS asks the player first; that prompt is Apple's), and each run is saved to Photos as
/// its own video. Nothing is uploaded anywhere.
final class Recorder {
    static let shared = Recorder()
    private let screen = RPScreenRecorder.shared()
    private var starting = false

    var isRecording: Bool { screen.isRecording }

    /// Starts recording. `done` gets nil once it is running, "declined" when the player said no,
    /// or another reason it could not start.
    func start(_ done: @escaping (String?) -> Void) {
        guard screen.isAvailable else { done("Screen recording isn't available right now"); return }
        guard !screen.isRecording, !starting else { done(nil); return }
        starting = true
        screen.isMicrophoneEnabled = false
        screen.startRecording { [weak self] error in
            DispatchQueue.main.async {
                self?.starting = false
                done(error.map(Self.reason))
            }
        }
    }

    /// Stops recording and saves the video to Photos. `done` gets nil once it is saved, or why not.
    func stop(_ done: @escaping (String?) -> Void) {
        guard screen.isRecording else { done(nil); return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Mitosis \(Self.stamp()).mp4")
        try? FileManager.default.removeItem(at: url)
        screen.stopRecording(withOutput: url) { error in
            if let error { DispatchQueue.main.async { done(Self.reason(error)) }; return }
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? -1
            NSLog("[Mitosis recorder] wrote %@ (%d bytes)", url.lastPathComponent, size)
            // the Simulator reports success without writing a file; say so instead of a Photos error
            guard size > 0 else { DispatchQueue.main.async { done("Couldn't record on this device") }; return }
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else {
                    try? FileManager.default.removeItem(at: url)
                    DispatchQueue.main.async { done("Allow Mitosis to add to Photos in Settings › Mitosis") }
                    return
                }
                PHPhotoLibrary.shared().performChanges({
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
                }) { saved, error in
                    try? FileManager.default.removeItem(at: url)
                    DispatchQueue.main.async { done(saved ? nil : error?.localizedDescription ?? "Couldn't save the video") }
                }
            }
        }
    }

    private static func reason(_ error: Error) -> String {
        let e = error as NSError
        if e.domain == RPRecordingErrorDomain, e.code == RPRecordingErrorCode.userDeclined.rawValue { return "declined" }
        return e.localizedDescription
    }

    private static func stamp() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return f.string(from: Date())
    }
}
