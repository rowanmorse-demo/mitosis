import UIKit
import UserNotifications

/// Push notifications. The app never asks at launch: the page asks (`push` / `ask`) at a moment that makes sense, after
/// its own explanation, and only then does iOS show its permission prompt. With permission the app registers with APNs on
/// every launch (the token can change) and hands the token to the page, which registers it with the server (push.js).
/// A tap on a notification opens the screen its `link` names (the page's pushRoute), also when the tap launched the app:
/// events wait until the page has booted. One that arrives while the game is open goes to the page as a toast instead
/// of a banner over the game.
final class Push: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Push()

    /// native → page: ["ev": "token" | "open" | "foreground" | "error", …]. Nil while no page is ready; events wait.
    var onEvent: (([String: Any]) -> Void)? { didSet { flush() } }
    private(set) var token: String?
    private var pending: [[String: Any]] = []

    /// Called from didFinishLaunching, before it returns, so a tap that launched the app is delivered.
    func start() {
        UNUserNotificationCenter.current().delegate = self
        status { s in
            if Self.allowed(s) { DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() } }
        }
        #if DEBUG
        // "-pushToken <hex>" stands in for APNs in the simulator when it can't reach Apple (tests with tools/apns-mock.js)
        if let t = UserDefaults.standard.string(forKey: "pushToken"), t.count >= 64 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.token = t; self.emit(["ev": "token", "token": t, "env": Self.environment]) }
        }
        #endif
    }

    static func allowed(_ s: String) -> Bool { s == "authorized" || s == "provisional" || s == "ephemeral" }

    /// notDetermined (never asked), denied, authorized, provisional or ephemeral
    func status(_ done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            switch s.authorizationStatus {
            case .authorized: done("authorized")
            case .denied: done("denied")
            case .provisional: done("provisional")
            case .ephemeral: done("ephemeral")
            case .notDetermined: done("notDetermined")
            @unknown default: done("unknown")
            }
        }
    }

    /// iOS's permission prompt. It appears once ever; after that iOS answers at once with the player's earlier choice.
    func ask(_ done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            if granted { DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() } }
            self.status(done)
        }
    }

    /// The game's page in iOS Settings (Notifications), for a player who said no and changed their mind.
    func openSettings() {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { UIApplication.shared.open(url) }
        }
    }

    func registered(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        token = hex
        NSLog("[Mitosis] push token (%@): %@…", Self.environment, String(hex.prefix(12)))
        emit(["ev": "token", "token": hex, "env": Self.environment])
    }

    func failed(_ error: Error) {
        NSLog("[Mitosis] push registration failed: %@", error.localizedDescription)
        emit(["ev": "error", "text": error.localizedDescription])
    }

    /// Which APNs a token is for: "sandbox" for builds signed for development (run from Xcode, or an archive's .app
    /// installed by hand), "production" for TestFlight and the App Store. The provisioning profile says which, and App
    /// Store builds carry none. The server also tries the other one when Apple calls a token bad.
    static let environment: String = {
        #if targetEnvironment(simulator)
        return "sandbox"
        #else
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let a = text.range(of: "<plist"), let b = text.range(of: "</plist>"),
              let plist = try? PropertyListSerialization.propertyList(from: Data(text[a.lowerBound..<b.upperBound].utf8), format: nil) as? [String: Any],
              let ent = plist["Entitlements"] as? [String: Any] else { return "production" }
        return ent["aps-environment"] as? String == "development" ? "sandbox" : "production"
        #endif
    }()

    // MARK: - UNUserNotificationCenterDelegate

    /// A notification while the game is open: the page shows it its own way (no banner over a match).
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let c = notification.request.content
        guard onEvent != nil else { completionHandler([.banner, .list, .sound]); return }
        emit(["ev": "foreground", "title": c.title, "body": c.body, "link": c.userInfo["link"] as? String ?? "", "kind": c.userInfo["kind"] as? String ?? ""])
        completionHandler([])
    }

    /// A tap on a notification (the app may have been launched by it).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            emit(["ev": "open", "link": info["link"] as? String ?? "home", "kind": info["kind"] as? String ?? ""])
        }
        completionHandler()
    }

    // MARK: -

    private func emit(_ e: [String: Any]) {
        DispatchQueue.main.async {
            if let f = self.onEvent { f(e) } else { self.pending.append(e); if self.pending.count > 20 { self.pending.removeFirst() } }
        }
    }

    private func flush() {
        guard let f = onEvent, !pending.isEmpty else { return }
        let p = pending
        pending = []
        p.forEach(f)
    }
}
