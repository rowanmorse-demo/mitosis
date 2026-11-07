import CryptoKit
import Foundation

/// Remote page updates: a new game page (index.html) without an App Store release.
///
/// `node tools/page-update.js publish` signs a page with the Ed25519 key on Rowan's Mac and puts it on the server
/// as /updates/ios/manifest.json + page.html. When the app opens (and at most every 30 minutes when it comes back
/// to the foreground) it reads the manifest, and if it is signed by `publicKey`, newer than anything it has taken,
/// and meant for this build, it downloads the page, checks its size and SHA-256, and keeps it for the next launch.
///
/// A downloaded page has to send {type:'booted'} (the last line of the page's script) within 15 seconds in the
/// foreground. If it doesn't, or the app is killed twice before it does, that version is dropped for good and the
/// page built into the app is loaded again; the next update fixes it. The server is plain HTTP, so the signature
/// is what keeps anyone on the network from swapping the page.
final class PageUpdates {
    static let shared = PageUpdates()

    /// The public half of the signing key (raw Ed25519, base64), written by `tools/page-update.js keygen`. Empty: off.
    static let publicKey = "ac6RTqGWSnmyyazAR5AebdnbUF2NbpRfCn0uCI43SbQ="
    static let platform = "ios"
    static let bootTimeout: TimeInterval = 15
    private static let checkEvery: TimeInterval = 30 * 60

    struct Manifest: Codable, Equatable {
        let v: Int, minBuild: Int, maxBuild: Int, sha256: String, size: Int
        /// what is signed (tools/page-update.js message())
        var message: String {
            ["mitosis-page-update/1", "platform=\(PageUpdates.platform)", "v=\(v)", "minBuild=\(minBuild)", "maxBuild=\(maxBuild)",
             "sha256=\(sha256)", "size=\(size)"].joined(separator: "\n")
        }
    }
    private struct Signed: Decodable { let v: Int, minBuild: Int, maxBuild: Int, sha256: String, size: Int, sig: String }

    let build = Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "") ?? 0
    /// The downloaded page now loaded, or nil for the built-in one.
    private(set) var loaded: Manifest?

    private let fm = FileManager.default
    private let defaults = UserDefaults.standard
    private let dir: URL
    private var activeFile: URL { dir.appendingPathComponent("page.html") }
    private var pendingFile: URL { dir.appendingPathComponent("pending.html") }
    private var checking = false
    private var checkedAt = Date.distantPast

    private init() {
        dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PageUpdates", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var url = dir, values = URLResourceValues()
        values.isExcludedFromBackup = true // the server has it; nothing to back up
        try? url.setResourceValues(values)
    }

    // MARK: - State (main thread only)

    private func stored(_ key: String) -> Manifest? { defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Manifest.self, from: $0) } }
    private func store(_ m: Manifest?, _ key: String) {
        if let m, let data = try? JSONEncoder().encode(m) { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
    private var active: Manifest? { get { stored("pageUpdate.active") } set { store(newValue, "pageUpdate.active") } }
    private var pending: Manifest? { get { stored("pageUpdate.pending") } set { store(newValue, "pageUpdate.pending") } }
    /// launches of the active page that haven't reached `booted` yet
    private var attempts: Int { get { defaults.integer(forKey: "pageUpdate.attempts") } set { defaults.set(newValue, forKey: "pageUpdate.attempts") } }
    /// versions that failed to start here; never taken again
    private var bad: [Int] { get { defaults.array(forKey: "pageUpdate.bad") as? [Int] ?? [] } set { defaults.set(Array(newValue.suffix(20)), forKey: "pageUpdate.bad") } }
    /// the newest version taken, so an older signed manifest can't roll the page back
    private var newest: Int { get { defaults.integer(forKey: "pageUpdate.newest") } set { defaults.set(newValue, forKey: "pageUpdate.newest") } }

    // MARK: - Loading

    /// The downloaded page to load now, or nil for the page built into the app. Called for every load of the game.
    func pageToLoad() -> URL? {
        loaded = nil
        if let p = pending { // downloaded last time: it becomes the page from this launch
            pending = nil
            try? fm.removeItem(at: activeFile)
            if (try? fm.moveItem(at: pendingFile, to: activeFile)) != nil { active = p; attempts = 0 }
        }
        guard let m = active else { try? fm.removeItem(at: activeFile); return nil }
        if attempts >= 2 { drop(m, why: "it was launched twice without starting"); return nil }
        guard m.minBuild <= build, build <= m.maxBuild, !bad.contains(m.v), Self.matches(try? Data(contentsOf: activeFile), m) else {
            log("page update \(m.v) no longer fits this build or file; using the built-in page")
            discard()
            return nil
        }
        attempts += 1
        loaded = m
        log("loading page update \(m.v)")
        return activeFile
    }

    /// The page said it started.
    func booted() {
        guard loaded != nil else { return }
        attempts = 0
    }

    /// The downloaded page didn't start in time: never use that version again.
    func failed() {
        guard let m = loaded else { return }
        drop(m, why: "it didn't start within \(Int(Self.bootTimeout)) s")
    }

    private func drop(_ m: Manifest, why: String) {
        bad = bad + [m.v]
        log("dropped page update \(m.v): \(why)")
        CrashReporter.shared.note("page-update-dropped", "page update \(m.v) was dropped on build \(build): \(why); the built-in page is used")
        discard()
    }

    private func discard() {
        active = nil
        attempts = 0
        loaded = nil
        // the file stays until the next load: a WebKit reload of the running page still finds it
    }

    // MARK: - Checking

    /// Looks for a newer page on the server, at most every 30 minutes unless `force`.
    func check(server: String, force: Bool = false) {
        guard !Self.publicKey.isEmpty, !checking, force || Date().timeIntervalSince(checkedAt) > Self.checkEvery,
              let base = URL(string: server + "/updates/\(Self.platform)/") else { return }
        checking = true
        checkedAt = Date()
        fetch(base.appendingPathComponent("manifest.json")) { data in
            guard let data, let m = self.verified(data) else { self.checking = false; return }
            guard m.v > self.newest, !self.bad.contains(m.v), m.minBuild <= self.build, self.build <= m.maxBuild else { self.checking = false; return }
            if m.sha256.isEmpty { // "off": back to the built-in page from the next launch
                self.newest = m.v
                self.pending = nil
                if self.active != nil { self.active = nil; self.attempts = 0 }
                self.log("page update \(m.v): back to the built-in page from the next launch")
                self.checking = false
                return
            }
            self.fetch(base.appendingPathComponent("page.html")) { page in
                defer { self.checking = false }
                guard let page, Self.matches(page, m) else { self.log("page update \(m.v): the download didn't match its manifest"); return }
                do {
                    try page.write(to: self.pendingFile, options: .atomic)
                    self.pending = m
                    self.newest = m.v
                    self.log("page update \(m.v) downloaded; it loads on the next launch")
                } catch { self.log("page update \(m.v) couldn't be saved: \(error.localizedDescription)") }
            }
        }
    }

    /// GET on a background queue; `done` runs on the main thread with the body of a 200, else nil.
    private func fetch(_ url: URL, _ done: @escaping (Data?) -> Void) {
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok ? data : nil) }
        }.resume()
    }

    /// The manifest, if it is well formed and signed by our key.
    private func verified(_ data: Data) -> Manifest? {
        guard let s = try? JSONDecoder().decode(Signed.self, from: data) else { log("page update manifest unreadable"); return nil }
        let m = Manifest(v: s.v, minBuild: s.minBuild, maxBuild: s.maxBuild, sha256: s.sha256, size: s.size)
        guard let keyData = Data(base64Encoded: Self.publicKey), let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              let sig = Data(base64Encoded: s.sig), key.isValidSignature(sig, for: Data(m.message.utf8)) else {
            log("page update \(s.v): bad signature, ignored")
            return nil
        }
        return m
    }

    private static func matches(_ page: Data?, _ m: Manifest) -> Bool {
        guard let page, page.count == m.size, m.sha256.count == 64 else { return false }
        return SHA256.hash(data: page).map { String(format: "%02x", $0) }.joined() == m.sha256
    }

    private func log(_ text: String) { NSLog("[Mitosis] %@", text) }
}
