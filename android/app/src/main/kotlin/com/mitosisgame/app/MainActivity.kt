package com.mitosisgame.app

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.play.core.review.ReviewManagerFactory
import org.json.JSONArray
import org.json.JSONObject

/**
 * Hosts the whole game (index.html from the repo root, copied into assets at build time) in a full-screen,
 * landscape WebView and bridges it to the native side with the same messages as the iOS app
 * (ios/Mitosis/GameViewController.swift): Google Play Billing for the ATP packs, Sign in with Google, haptics,
 * the Play in-app review, page logs, and app foreground/background events. Android also reports battery saver
 * and the thermal state ({type:'power'}), which the page answers with reduced effects.
 * Nearby play and game recording are iOS-only: the page hides them outside the iOS app.
 * The page itself can be updated without a Play release (PageUpdates, the same channel as the iOS app's).
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private lateinit var billing: Billing
    private lateinit var signIn: SignIn
    private lateinit var haptics: Haptics
    private lateinit var power: Power
    private lateinit var pageUpdates: PageUpdates
    private var pageReady = false   // the page has its wallet session (it sent "ready")
    private var booted = false      // the loaded page said {type:'booted'}
    private var pageLoaded = false  // the WebView finished loading it (its script has run by then)
    private var resumed = false     // in the foreground: a page update's boot clock only runs then
    private val main = Handler(Looper.getMainLooper())
    private val bootCheck = Runnable {   // a downloaded page that doesn't boot is dropped (see watchBoot)
        bootFailed(if (pageLoaded) "it loaded but didn't say it started" else "it didn't load within ${PageUpdates.BOOT_TIMEOUT_MS / 1000} s")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CrashReporter.start(this, serverUrl())  // crashes are reported to the server (/api/crash)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Edge to edge with the system bars hidden. The game is kept out from under a camera cutout by padding
        // for the cutout alone; the padding shows the dish's void colour.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        root = FrameLayout(this).apply { setBackgroundColor(VOID) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val c = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            v.setPadding(c.left, c.top, c.right, c.bottom)
            WindowInsetsCompat.CONSUMED
        }

        billing = Billing(this) { reply(it) }
        signIn = SignIn(this) { reply(it) }
        haptics = Haptics(this)
        power = Power(this) { low, thermal -> reply(JSONObject().put("type", "power").put("low", low).put("thermal", thermal)) }
        pageUpdates = PageUpdates(this, BuildConfig.VERSION_CODE) { kind, text -> CrashReporter.note(kind, text) }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        // Android's back button is Esc to the page: it closes the open page or sheet, else pauses the game.
        // When nothing in the page takes it (the lobby with nothing open), the app goes to the background like any
        // app's first screen: dispatchEvent answers false once a handler called preventDefault.
        // On Android 13+ back arrives here through the platform's back callback (enableOnBackInvokedCallback in the
        // manifest); older versions are caught in dispatchKeyEvent, before the focused WebView can swallow the key.
        onBackPressedDispatcher.addCallback(this) {
            val w = web ?: return@addCallback
            w.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))") { notTaken ->
                if (BuildConfig.DEBUG) Log.i(TAG, "back → Escape (${if (notTaken == "true") "not taken: to the background" else "taken by the page"})")
                if (notTaken == "true" && !isFinishing) moveTaskToBack(true)
            }
        }

        createWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val w = WebView(this)
        web = w
        root.addView(w, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        w.setBackgroundColor(VOID)
        w.isVerticalScrollBarEnabled = false
        w.isHorizontalScrollBarEnabled = false
        w.overScrollMode = View.OVER_SCROLL_NEVER
        w.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage: settings, wallet cache, achievements
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false             // file:///android_asset still loads; nothing else on disk is reachable
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
        }
        w.webChromeClient = object : WebChromeClient() {
            // Development builds put page errors in the log next to the bridge's:  adb logcat -s Mitosis
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG && m.messageLevel() == ConsoleMessage.MessageLevel.ERROR)
                    Log.w(TAG, "JS error: ${m.message()} @${m.sourceId().substringAfterLast('/')}:${m.lineNumber()}")
                return false
            }
        }
        w.webViewClient = object : WebViewClient() {
            // Open external links (e.g. the invite link) in the browser, not inside the game.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.scheme == "file") return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (view !== web) return
                power.report(force = true)
                if (!pageLoaded) { pageLoaded = true; watchBoot() } // a page update's script has run: it must have said booted
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (view === web && request.isForMainFrame) bootFailed("it couldn't be opened: ${error.description}")
            }

            // The renderer was killed for memory or crashed. That WebView is dead: make a new one and reload the
            // game (iOS does the same when its web content process dies) instead of letting the app crash.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                val crashed = detail.didCrash()
                Log.w(TAG, "WebView renderer gone (crashed=$crashed); reloading")
                CrashReporter.note(if (crashed) "webview-crashed" else "webview-killed",
                    "the WebView renderer ${if (crashed) "crashed" else "was killed for memory"}; the game reloaded")
                if (view === web) {
                    root.removeView(view)
                    web = null
                    pageReady = false
                    createWebView()
                }
                view.destroy()
                return true
            }
        }
        w.addJavascriptInterface(Bridge(), "MitosisAndroid")
        loadGame()
    }

    /** Loads the game page: a downloaded page update when there is a good one (PageUpdates), else the built-in copy. */
    private fun loadGame() {
        val w = web ?: return
        var update = pageUpdates.pageToLoad()
        val html = update?.let { pageUpdates.loadedHtml() }
        if (update != null && html == null) { pageUpdates.failed("its saved file couldn't be read"); update = null }
        booted = false
        pageLoaded = false
        main.removeCallbacks(bootCheck)
        // the app version, for the connection report; "-p3" = page update 3
        val q = StringBuilder("?server=").append(Uri.encode(serverUrl()))
            .append("&app=").append(Uri.encode("android-" + BuildConfig.VERSION_NAME + (update?.let { "-p${it.v}" } ?: "")))
        // Development builds: `adb shell am start -n com.mitosisgame.app/.MainActivity --ez autopilot true`
        // makes the page play by itself (soak testing without touching the phone).
        if (BuildConfig.DEBUG && intent.getBooleanExtra("autopilot", false)) q.append("&autopilot=1")
        // A page update goes in as the document's text at the built-in page's address: the same origin, so the player's
        // localStorage (secret, settings, wallet cache) is the same, and location.search still carries server and app.
        // (WebView doesn't offer file:///android_asset loads to shouldInterceptRequest, so it can't be swapped on the way.)
        val url = PageUpdates.PAGE_URL + q
        if (html != null) w.loadDataWithBaseURL(url, html, "text/html", "utf-8", null) else w.loadUrl(url)
        watchBoot()
        // look for a newer page once this one is up (it is used from the next launch)
        main.postDelayed({ pageUpdates.check(serverUrl()) }, 8_000)
    }

    /**
     * A downloaded page has to say it started. Its script has run by the time the WebView finishes loading it, so from
     * then it gets [PageUpdates.BOOT_GRACE_MS]; a page that never finishes loading gets [PageUpdates.BOOT_TIMEOUT_MS],
     * counted in the foreground only, so a slow phone isn't mistaken for a broken page. A page that fails is dropped
     * and the built-in page loaded. The built-in page isn't watched: there is nothing to fall back to.
     */
    private fun watchBoot() {
        main.removeCallbacks(bootCheck)
        if (pageUpdates.loaded == null || booted || !resumed) return
        main.postDelayed(bootCheck, if (pageLoaded) PageUpdates.BOOT_GRACE_MS else PageUpdates.BOOT_TIMEOUT_MS)
    }

    private fun bootFailed(why: String) {
        if (booted || pageUpdates.loaded == null) return
        main.removeCallbacks(bootCheck)
        pageUpdates.failed(why)
        loadGame()
    }

    /** Release builds always use SERVER_URL. Development builds take `--es server http://10.0.2.2:3000`. */
    private fun serverUrl(): String {
        if (BuildConfig.DEBUG) intent.getStringExtra("server")?.takeIf { it.startsWith("http") }?.let { return it }
        return BuildConfig.SERVER_URL
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP && !event.isCanceled) onBackPressedDispatcher.onBackPressed()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, root).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    // App lifecycle, told to the page with the iOS names: resignActive, becomeActive, background, memoryWarning.
    override fun onResume() {
        super.onResume()
        resumed = true
        web?.onResume()
        appEvent("becomeActive")
        power.report()
        if (pageReady) billing.deliverPending()  // a pending payment may have completed while we were away
        // a page update's boot clock runs again; look for a newer page (at most every 30 minutes)
        watchBoot()
        if (booted) pageUpdates.check(serverUrl())
    }

    override fun onPause() {
        resumed = false
        main.removeCallbacks(bootCheck)
        appEvent("resignActive")
        web?.onPause()
        super.onPause()
    }

    override fun onStop() {
        appEvent("background")
        super.onStop()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        appEvent("memoryWarning")
    }

    @Suppress("DEPRECATION") // the RUNNING_* levels only reach apps on Android 13 and older
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level == ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL) appEvent("memoryWarning")
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        billing.close()
        power.close()
        haptics.close()
        web?.destroy()
        web = null
        super.onDestroy()
    }

    private fun appEvent(text: String) = reply(JSONObject().put("type", "app").put("text", text))

    /** JS → native. The game calls MitosisAndroid.post(JSON). */
    inner class Bridge {
        @JavascriptInterface
        fun post(json: String) {
            val msg = runCatching { JSONObject(json) }.getOrNull() ?: return
            runOnUiThread { handle(msg) }
        }
    }

    private fun handle(msg: JSONObject) {
        val id = msg.optLong("id", -1)
        when (msg.optString("type")) {
            "ready" -> { pageReady = true; billing.deliverPending() }
            // the page's script ran to the end (sent at once, before the network): a page update is good
            "booted" -> {
                if (!booted) Log.i(TAG, "page booted (${pageUpdates.loaded?.let { "page update ${it.v}" } ?: "built-in page"})")
                booted = true
                main.removeCallbacks(bootCheck)
                pageUpdates.booted()
            }
            "products" -> billing.products(id, strings(msg.optJSONArray("ids")))
            "buy" -> billing.buy(this, id, msg.optString("productId"))
            "finish" -> billing.consume(msg.optString("purchaseToken"))
            "auth" -> reply(JSONObject().put("id", id).put("ok", true).put("providers", JSONArray(signIn.providers)))
            "signin" -> signIn.signIn(id, msg.optString("provider"), msg.optString("nonce"))
            "review" -> requestReview()
            "haptic" -> haptics.play(msg.optString("style"))
            "log" -> Log.i(TAG, "[page] " + msg.optString("text"))
            // the page wants a fresh start (after deleting the account): load it again the way it was loaded
            "reload" -> loadGame()
            // Recording and Nearby are iOS-only and the page hides them here; a stray call gets an answer
            // straight away instead of waiting out the page's timeout.
            "record" -> if (id >= 0) reply(JSONObject().put("id", id).put("ok", false).put("error", "Recording is only in the iPhone app"))
            "nearby" -> {}
        }
    }

    /** The page asks after a strong finish (at most every 90 days); Google Play decides whether to show the card. */
    private fun requestReview() {
        val manager = ReviewManagerFactory.create(this)
        manager.requestReviewFlow().addOnCompleteListener { task ->
            if (task.isSuccessful && !isFinishing) manager.launchReviewFlow(this, task.result)
            else Log.i(TAG, "review flow unavailable: ${task.exception?.message}")
        }
    }

    /** native → JS */
    fun reply(obj: JSONObject) {
        runOnUiThread {
            web?.evaluateJavascript("window.MitosisBridge&&window.MitosisBridge.onNative(" + obj.toString() + ")", null)
        }
    }

    private fun strings(arr: JSONArray?): List<String> =
        if (arr == null) emptyList() else (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotEmpty() }

    companion object {
        const val TAG = "Mitosis"
        val VOID = Color.rgb(2, 8, 9)   // #020809, the iOS shell's voidColor
    }
}
