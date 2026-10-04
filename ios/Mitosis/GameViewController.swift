import UIKit
import WebKit

/// Hosts the whole game (index.html from the repo root) in a full-screen web view
/// and bridges it to the native side: in-app purchases (StoreKit 2) and haptics.
final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
    static let voidColor = UIColor(red: 2 / 255, green: 8 / 255, blue: 9 / 255, alpha: 1)

    private var webView: WKWebView!
    private let impact = UIImpactFeedbackGenerator(style: .medium)

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.voidColor

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(BridgeProxy(self), name: "mitosis")
        #if DEBUG
        // Development builds forward page errors to the system log:  log stream --predicate 'process == "Mitosis"'
        let errorHook = "window.addEventListener('error',e=>{try{window.webkit.messageHandlers.mitosis.postMessage({type:'log',text:'JS error: '+e.message+' @'+(e.filename||'').split('/').pop()+':'+e.lineno})}catch(_){}});window.addEventListener('unhandledrejection',e=>{try{window.webkit.messageHandlers.mitosis.postMessage({type:'log',text:'Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)})}catch(_){}});"
        config.userContentController.addUserScript(WKUserScript(source: errorHook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.voidColor
        webView.scrollView.backgroundColor = Self.voidColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.delegate = self          // no pinch or double-tap zoom, ever (see viewForZooming)
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.minimumZoomScale = 1
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)

        UIApplication.shared.isIdleTimerDisabled = true
        impact.prepare()
        loadGame()
    }

    // MARK: - Loading

    private func loadGame() {
        guard let index = Bundle.main.url(forResource: "index", withExtension: "html") else {
            fatalError("index.html is missing from the app bundle — it is copied from the repo root at build time")
        }
        resolveServerURL { server in
            var comps = URLComponents(url: index, resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "server", value: server)]
            self.webView.loadFileURL(comps.url ?? index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
    }

    /// Production builds always use MitosisServerURL from Info.plist. Debug builds in
    /// the simulator prefer a local `node server.js` on port 3000 when one is running.
    private func resolveServerURL(_ done: @escaping (String) -> Void) {
        let production = (Bundle.main.object(forInfoDictionaryKey: "MitosisServerURL") as? String) ?? "https://mitosis-zmbc.onrender.com"
        #if DEBUG
        // Development builds accept a launch argument, e.g. from a Mac:
        //   xcrun devicectl device process launch --device <id> com.mitosisgame.app -- -server http://192.168.1.20:3000
        if let override = UserDefaults.standard.string(forKey: "server"), override.hasPrefix("http") { done(override); return }
        #endif
        #if DEBUG && targetEnvironment(simulator)
        let local = "http://localhost:3000"
        var req = URLRequest(url: URL(string: local + "/health")!)
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { done(ok ? local : production) }
        }.resume()
        #else
        done(production)
        #endif
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    /// Returning nil disables WebKit zooming entirely, including double-tap zoom.
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { if scrollView.zoomScale != 1 { scrollView.setZoomScale(1, animated: false) } }

    // Open any external link (e.g. the invite link) in Safari instead of inside the game.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.isFileURL || navigationAction.navigationType == .other {
            decisionHandler(.allow)
        } else if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    // MARK: - Bridge (JS → native)

    fileprivate func handle(_ msg: [String: Any]) {
        let type = msg["type"] as? String ?? ""
        let id = msg["id"]
        switch type {
        case "ready":
            Store.shared.onPurchase = { [weak self] purchase in self?.reply(["type": "purchase", "purchase": purchase]) }
            Task { await Store.shared.deliverUnfinished() }
        case "products":
            let ids = msg["ids"] as? [String] ?? []
            Task {
                do { self.reply(["id": id as Any, "ok": true, "products": try await Store.shared.products(ids: ids)]) }
                catch { self.reply(["id": id as Any, "ok": false, "error": error.localizedDescription]) }
            }
        case "buy":
            let productId = msg["productId"] as? String ?? ""
            Task {
                do {
                    if let purchase = try await Store.shared.buy(id: productId) {
                        self.reply(["id": id as Any, "ok": true, "purchase": purchase])
                    } else {
                        self.reply(["id": id as Any, "ok": true, "cancelled": true])
                    }
                } catch { self.reply(["id": id as Any, "ok": false, "error": error.localizedDescription]) }
            }
        case "finish":
            let tid = msg["transactionId"] as? String ?? ""
            Task { await Store.shared.finish(transactionId: tid) }
        case "haptic":
            haptic(msg["style"] as? String ?? "medium")
        case "log":
            NSLog("[Mitosis page] %@", msg["text"] as? String ?? "")
        default:
            break
        }
    }

    private func haptic(_ style: String) {
        switch style {
        case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "heavy": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        default: impact.impactOccurred()
        }
    }

    /// native → JS
    private func reply(_ obj: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.webView.evaluateJavaScript("window.MitosisBridge && window.MitosisBridge.onNative(\(json))", completionHandler: nil)
        }
    }
}

/// Breaks the retain cycle WKUserContentController would otherwise create.
private final class BridgeProxy: NSObject, WKScriptMessageHandler {
    weak var target: GameViewController?
    init(_ target: GameViewController) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "mitosis", let body = message.body as? [String: Any] else { return }
        target?.handle(body)
    }
}
