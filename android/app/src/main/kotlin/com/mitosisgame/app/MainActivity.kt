package com.mitosisgame.app

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
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
 */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private lateinit var billing: Billing
    private lateinit var signIn: SignIn
    private lateinit var haptics: Haptics
    private lateinit var power: Power
    private var pageReady = false   // the page has its wallet session (it sent "ready")

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
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        // Android's back button is Esc to the page: it closes the open page or sheet, else pauses the game.
        // On Android 13+ back arrives here through the platform's back callback (enableOnBackInvokedCallback in the
        // manifest); older versions are caught in dispatchKeyEvent, before the focused WebView can swallow the key.
        onBackPressedDispatcher.addCallback(this) {
            if (BuildConfig.DEBUG) Log.i(TAG, "back → Escape")
            web?.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))", null)
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
                if (view === web) power.report(force = true)
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

        val q = StringBuilder("?server=").append(Uri.encode(serverUrl()))
            .append("&app=").append(Uri.encode("android-" + BuildConfig.VERSION_NAME)) // for the connection report
        // Development builds: `adb shell am start -n com.mitosisgame.app/.MainActivity --ez autopilot true`
        // makes the page play by itself (soak testing without touching the phone).
        if (BuildConfig.DEBUG && intent.getBooleanExtra("autopilot", false)) q.append("&autopilot=1")
        w.loadUrl("file:///android_asset/index.html$q")
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
        web?.onResume()
        appEvent("becomeActive")
        power.report()
        if (pageReady) billing.deliverPending()  // a pending payment may have completed while we were away
    }

    override fun onPause() {
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
            "products" -> billing.products(id, strings(msg.optJSONArray("ids")))
            "buy" -> billing.buy(this, id, msg.optString("productId"))
            "finish" -> billing.consume(msg.optString("purchaseToken"))
            "auth" -> reply(JSONObject().put("id", id).put("ok", true).put("providers", JSONArray(signIn.providers)))
            "signin" -> signIn.signIn(id, msg.optString("provider"), msg.optString("nonce"))
            "review" -> requestReview()
            "haptic" -> haptics.play(msg.optString("style"))
            "log" -> Log.i(TAG, "[page] " + msg.optString("text"))
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
