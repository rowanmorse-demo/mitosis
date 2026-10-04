import XCTest
import StoreKit
import StoreKitTest
import WebKit
import UIKit

/// A complete test purchase through the real app, with no Apple account involved:
/// the page's Shop → StoreKit 2 against Xcode's local store (Products.storekit)
/// → signed transaction → the game server → ATP credited in the wallet the page shows
/// → transaction finished.
///
/// Run it from Xcode (Product → Test, or the diamond next to the test) with a local server in
/// dev mode, which Debug simulator builds pick up automatically:
///     IAP_UNVERIFIED=1 node server.js            (port 3000)
/// Xcode brings up the StoreKit test environment for the scheme's Products.storekit; under a
/// plain `xcodebuild test` that environment is missing, SKTestSession reports
/// SKInternalErrorDomain code 3, and the purchase goes to the real App Store sandbox instead.
final class PurchaseFlowTests: XCTestCase {

    func testBuyingAPackCreditsATP() async throws {
        let session = try SKTestSession(configurationFileNamed: "Products")
        session.disableDialogs = true      // no confirmation sheet: purchases succeed immediately
        session.clearTransactions()
        session.resetToDefaultState()

        let web = try await poll("the game's web view", seconds: 20) { await Self.findWebView() }

        // Wait for the page to load and connect its native bridge; remember what we last saw for the failure message.
        var seen = "nothing"
        let state = try await poll("the page to load (last seen: \(seen))", seconds: 45) { () async -> [String: Any]? in
            do {
                let json = try await web.js("JSON.stringify({ready:document.readyState,bridge:!!window.MitosisBridge,shop:!!document.getElementById('shopBtn'),wallet:typeof wallet,server:String(window.MITOSIS_SERVER||''),bal:(document.getElementById('storeBal')||{}).textContent||''})")
                seen = json
                let s = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
                let ok = (s["bridge"] as? Bool) == true && (s["shop"] as? Bool) == true && !((s["server"] as? String) ?? "").isEmpty
                return ok ? s : nil
            } catch { seen = "error: \(error)"; return nil }
        }
        // The page must be talking to the local dev server, never production, for a test buy.
        let server = state["server"] as? String ?? ""
        XCTAssertTrue(server.hasPrefix("http://localhost:3000"),
                      "the page is using \(server) — start `IAP_UNVERIFIED=1 node server.js` on port 3000 before the test launches the app")

        // Open the Shop: the page asks StoreKit for the four packs and shows their prices.
        _ = try await web.js("document.getElementById('shopBtn').click(); 'ok'")
        var hint = ""
        _ = try await poll("the ATP packs to load their prices (store hint: \(hint))", seconds: 30) { () async -> Bool? in
            hint = (try? await web.js("document.getElementById('storeHint').textContent")) ?? ""
            return (try? await web.js("String(!!document.querySelector('.pack[data-id=\"atp_500\"]:not([disabled])'))")) == "true" ? true : nil
        }
        XCTAssertTrue(hint.contains("App Store"), "store hint: \(hint)")
        let price = try await web.js("document.querySelector('.pack[data-id=\"atp_500\"] .pr').textContent")
        XCTAssertEqual(price, "$0.99")
        let before = try await balance(web)

        // Buy the 500 ATP pack exactly as a player would, and wait for the server's credit to land.
        _ = try await web.js("document.querySelector('.pack[data-id=\"atp_500\"]').click(); 'ok'")
        var toast = ""
        let after = try await poll("the server to verify and credit the purchase (toast: \(toast))", seconds: 60) { () async -> Int? in
            toast = (try? await web.js("[...document.querySelectorAll('.toast,[class*=toast]')].map(t=>t.textContent.trim()).join(' | ')")) ?? ""
            guard let n = try? await self.balance(web), n >= before + 500 else { return nil }
            return n
        }
        XCTAssertEqual(after, before + 500, "atp_500 credits exactly 500 ATP")

        // StoreKit side: one purchase of atp_500, finished by the app once the server credited it.
        let transactions = session.allTransactions()
        XCTAssertEqual(transactions.count, 1)
        XCTAssertEqual(transactions.first?.productIdentifier, "atp_500")
        _ = try await poll("the app to finish the transaction", seconds: 15) { () async -> Bool? in
            var pending = 0
            for await _ in Transaction.unfinished { pending += 1 }
            return pending == 0 ? true : nil
        }
    }

    // MARK: - Helpers

    private enum TestError: Error { case timeout(String) }

    /// The ATP balance the Shop header shows (the page keeps it in sync with the server's wallet).
    private func balance(_ web: WKWebView) async throws -> Int {
        let text = try await web.js("document.getElementById('storeBal').textContent")
        return Int(text.filter(\.isNumber)) ?? 0
    }

    /// Runs `probe` every 250 ms until it yields a value; fails the test after `seconds`.
    private func poll<T>(_ what: @autoclosure () -> String, seconds: Double, _ probe: () async -> T?) async throws -> T {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if let value = await probe() { return value }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let message = what()
        XCTFail("Timed out waiting for \(message)")
        throw TestError.timeout(message)
    }

    @MainActor private static func findWebView() -> WKWebView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        for window in windows { if let web = find(in: window) { return web } }
        return nil
    }

    private static func find(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        for sub in view.subviews { if let web = find(in: sub) { return web } }
        return nil
    }
}

private extension WKWebView {
    /// Evaluates `src`, which must produce a string, on the main thread.
    @MainActor
    func js(_ src: String) async throws -> String {
        try await withCheckedThrowingContinuation { cont in
            evaluateJavaScript(src) { value, error in
                if let error { cont.resume(throwing: error) }
                else { cont.resume(returning: (value as? String) ?? String(describing: value ?? "")) }
            }
        }
    }
}
