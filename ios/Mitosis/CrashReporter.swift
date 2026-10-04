import Foundation
import MetricKit
import UIKit

/// Sends crash and hang reports to the game server (POST /api/crash), where they land in the server
/// log and in DATA_DIR/crashes, with no third-party SDK:
///  - MetricKit delivers Apple's own crash and hang diagnostics (with call stacks) on a later launch;
///  - an uncaught-exception handler and signal handlers write a backtrace the moment the app dies,
///    into a file that is uploaded on the next launch;
///  - small events worth seeing next to crashes (the web content process dying) go straight up.
final class CrashReporter: NSObject, MXMetricManagerSubscriber {
    static let shared = CrashReporter()

    private static let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("crashes", isDirectory: true)
    private static var currentFile: URL?
    private static var fd: Int32 = -1
    private static var header = [UInt8]()          // app/OS line, prepared up front: signal handlers must not allocate
    private static var osVersion = ""

    func start() {
        Self.osVersion = "iOS " + UIDevice.current.systemVersion
        let info = Bundle.main.infoDictionary ?? [:]
        Self.header = Array("\(info["CFBundleShortVersionString"] ?? "") (\(info["CFBundleVersion"] ?? "")) \(Self.osVersion) \(Self.model)\n".utf8)
        try? FileManager.default.createDirectory(at: Self.dir, withIntermediateDirectories: true)
        Self.installHandlers()
        MXMetricManager.shared.add(self)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 3) { Self.sendPending() }
    }

    /// Small, immediate reports (e.g. "webkit-terminated").
    func note(_ kind: String, _ text: String) { Self.upload(kind: kind, report: text) }

    // MARK: - MetricKit

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            for d in payload.crashDiagnostics ?? [] { Self.upload(kind: "crash", report: String(decoding: d.jsonRepresentation(), as: UTF8.self)) }
            for d in payload.hangDiagnostics ?? [] { Self.upload(kind: "hang", report: String(decoding: d.jsonRepresentation(), as: UTF8.self)) }
        }
    }
    func didReceive(_ payloads: [MXMetricPayload]) {}

    // MARK: - Immediate capture (uncaught exceptions and fatal signals)

    private static func installHandlers() {
        let file = dir.appendingPathComponent("crash-\(Int(Date().timeIntervalSince1970)).txt")
        currentFile = file
        fd = open(file.path, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
        NSSetUncaughtExceptionHandler { e in
            CrashReporter.writeHeader()
            CrashReporter.writeLine("exception \(e.name.rawValue): \(e.reason ?? "")")
            for s in e.callStackSymbols { CrashReporter.writeLine(s) }
        }
        for sig in [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGTRAP] {
            signal(sig) { s in
                CrashReporter.writeHeader()
                CrashReporter.writeLine("signal \(s)")
                for line in Thread.callStackSymbols { CrashReporter.writeLine(line) }
                signal(s, SIG_DFL)
                raise(s)
            }
        }
    }

    private static func writeHeader() {
        guard fd >= 0 else { return }
        header.withUnsafeBufferPointer { buf in _ = write(fd, buf.baseAddress, buf.count) }
    }
    private static func writeLine(_ s: String) {
        guard fd >= 0 else { return }
        var line = s + "\n"
        line.withUTF8 { buf in _ = write(fd, buf.baseAddress, buf.count) }
    }

    /// Reports written by a previous run (non-empty files) are uploaded and removed.
    private static func sendPending() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for f in files where f.lastPathComponent.hasPrefix("crash-") && f != currentFile {
            if let text = try? String(contentsOf: f, encoding: .utf8), !text.isEmpty { upload(kind: "signal", report: text) }
            try? FileManager.default.removeItem(at: f)
        }
    }

    // MARK: - Upload

    static func upload(kind: String, report: String) {
        guard let base = Bundle.main.object(forInfoDictionaryKey: "MitosisServerURL") as? String, let url = URL(string: base + "/api/crash") else { return }
        let info = Bundle.main.infoDictionary ?? [:]
        let body: [String: Any] = [
            "platform": "ios", "kind": kind,
            "app": "\(info["CFBundleShortVersionString"] ?? "") (\(info["CFBundleVersion"] ?? ""))",
            "os": osVersion, "device": model,
            "report": String(report.prefix(400_000)),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        req.timeoutInterval = 20
        URLSession.shared.dataTask(with: req).resume()
    }

    private static var model: String {
        var s = utsname(); uname(&s)
        return withUnsafePointer(to: &s.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) } }
    }
}
