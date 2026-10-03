package com.eclipseforeverbeyond.mitosis

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.addCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

/**
 * Hosts the whole game (index.html from the repo root, copied into assets at build
 * time) in a full-screen WebView and bridges it to the native side: Google Play
 * Billing for ATP packs, and haptics.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var billing: Billing

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        web = WebView(this)
        setContentView(web)
        web.setBackgroundColor(Color.parseColor("#020809"))
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage: settings, wallet cache, achievements
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            textZoom = 100
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            // Open external links (e.g. the invite link) in the browser, not inside the game.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.scheme == "file") return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "MitosisAndroid")
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        billing = Billing(this) { reply(it) }

        // Android's back button pauses the game, like Esc on a keyboard.
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))", null)
        }

        web.loadUrl("file:///android_asset/index.html?server=" + Uri.encode(BuildConfig.SERVER_URL))
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, web).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onResume() { super.onResume(); web.onResume() }
    override fun onPause() { web.onPause(); super.onPause() }
    override fun onDestroy() { billing.close(); web.destroy(); super.onDestroy() }

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
            "ready" -> billing.deliverPending()
            "products" -> {
                val ids = ArrayList<String>()
                val arr = msg.optJSONArray("ids")
                if (arr != null) for (i in 0 until arr.length()) ids.add(arr.getString(i))
                billing.products(id, ids)
            }
            "buy" -> billing.buy(this, id, msg.optString("productId"))
            "finish" -> billing.consume(msg.optString("purchaseToken"))
            "haptic" -> haptic(msg.optString("style"))
        }
    }

    private fun haptic(style: String) {
        val v: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        else @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as Vibrator
        val effect = when (style) {
            "light" -> VibrationEffect.createOneShot(12, 80)
            "heavy" -> VibrationEffect.createOneShot(60, 255)
            "success" -> VibrationEffect.createWaveform(longArrayOf(0, 20, 60, 20), -1)
            else -> VibrationEffect.createOneShot(25, 160)
        }
        runCatching { v.vibrate(effect) }
    }

    /** native → JS */
    fun reply(obj: JSONObject) {
        runOnUiThread {
            web.evaluateJavascript("window.MitosisBridge&&window.MitosisBridge.onNative(" + obj.toString() + ")", null)
        }
    }
}
