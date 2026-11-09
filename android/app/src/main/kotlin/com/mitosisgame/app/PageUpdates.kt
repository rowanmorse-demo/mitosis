package com.mitosisgame.app

import android.content.Context
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Remote page updates: a new game page (index.html) without a Google Play release. The Android half of
 * ios/Mitosis/PageUpdates.swift, on the same channel and with the same rules:
 *
 * `node tools/page-update.js publish --platform android` signs a page with the Ed25519 key on Rowan's Mac and puts it
 * on the server as /updates/android/manifest.json + page.html. When the app opens (and at most every 30 minutes when
 * it comes back to the foreground) it reads the manifest, and if it is signed by [PUBLIC_KEY], newer than anything it
 * has taken, and meant for this versionCode, it downloads the page, checks its size and SHA-256, and keeps it for the
 * next launch.
 *
 * MainActivity loads the downloaded page ([loadedHtml]) with loadDataWithBaseURL at the built-in page's address,
 * file:///android_asset/index.html, so it has the same origin and with it the player's localStorage (secret, settings,
 * wallet cache). WebView doesn't offer file:///android_asset loads to shouldInterceptRequest, so serving the file in
 * place of the asset doesn't work (tried on WebView 145, Android 17: the built-in page showed).
 *
 * It has to send {type:'booted'} (the last line of the page's script): MainActivity gives it [BOOT_GRACE_MS] after
 * the WebView finishes loading it, or [BOOT_TIMEOUT_MS] in the foreground if it never finishes. If it doesn't, or the
 * app is killed twice before it does, that version is dropped for good and the built-in page is loaded again; the next
 * update fixes it. The server is plain HTTP, so the signature is what keeps anyone on the network from swapping the page.
 *
 * Threads: [pageToLoad], [loadedHtml], [booted], [failed] and [check] are called on the main thread; the download runs
 * on a worker. The state below is guarded by `this`.
 */
class PageUpdates(context: Context, private val build: Int, private val report: (kind: String, text: String) -> Unit) {
    companion object {
        /** The public half of the signing key (raw Ed25519, base64): the same key as the iOS app. Empty: off. */
        const val PUBLIC_KEY = "ac6RTqGWSnmyyazAR5AebdnbUF2NbpRfCn0uCI43SbQ="
        const val PLATFORM = "android"
        const val PAGE_URL = "file:///android_asset/index.html"
        const val BOOT_GRACE_MS = 5_000L        // after the page has loaded (its script has run by then)
        const val BOOT_TIMEOUT_MS = 90_000L     // a page that never finishes loading (foreground time)
        private const val CHECK_EVERY_MS = 30 * 60 * 1000L
        private const val MAX_PAGE = 32 * 1024 * 1024
        private const val TAG = "Mitosis"
    }

    data class Manifest(val v: Int, val minBuild: Int, val maxBuild: Int, val sha256: String, val size: Int) {
        /** What is signed (tools/page-update.js message()). */
        val message: String
            get() = listOf("mitosis-page-update/1", "platform=$PLATFORM", "v=$v", "minBuild=$minBuild", "maxBuild=$maxBuild",
                "sha256=$sha256", "size=$size").joinToString("\n")

        fun json(): String = JSONObject().put("v", v).put("minBuild", minBuild).put("maxBuild", maxBuild)
            .put("sha256", sha256).put("size", size).toString()

        companion object {
            /** The fields of a manifest, or null if any is missing or of the wrong type. */
            fun from(o: JSONObject): Manifest? {
                fun int(k: String): Int? = (o.opt(k) as? Number)?.takeIf { it is Int || (it is Long && it.toInt().toLong() == it) }?.toInt()
                val sha = o.opt("sha256") as? String ?: return null
                return Manifest(int("v") ?: return null, int("minBuild") ?: return null, int("maxBuild") ?: return null, sha, int("size") ?: return null)
            }

            fun parse(s: String?): Manifest? = s?.let { runCatching { from(JSONObject(it)) }.getOrNull() }
        }
    }

    private val prefs = context.getSharedPreferences("page-updates", Context.MODE_PRIVATE)
    private val dir = File(context.filesDir, "page-updates").apply { mkdirs() }
    private val activeFile = File(dir, "page.html")
    private val pendingFile = File(dir, "pending.html")
    private val worker = Executors.newSingleThreadExecutor()
    private val checking = AtomicBoolean(false)
    private var checkedAt = 0L

    /** The downloaded page now loaded, or null for the built-in one. */
    @Volatile var loaded: Manifest? = null
        private set

    // State, kept in SharedPreferences so it survives the app being killed.
    private var active: Manifest?
        get() = Manifest.parse(prefs.getString("active", null))
        set(m) { prefs.edit().apply { if (m == null) remove("active") else putString("active", m.json()) }.commit() }
    private var pending: Manifest?
        get() = Manifest.parse(prefs.getString("pending", null))
        set(m) { prefs.edit().apply { if (m == null) remove("pending") else putString("pending", m.json()) }.commit() }
    /** launches of the active page that haven't reached `booted` yet */
    private var attempts: Int
        get() = prefs.getInt("attempts", 0)
        set(n) { prefs.edit().putInt("attempts", n).commit() }
    /** versions that failed to start here; never taken again */
    private var bad: List<Int>
        get() = prefs.getString("bad", "")!!.split(',').mapNotNull { it.toIntOrNull() }
        set(l) { prefs.edit().putString("bad", l.takeLast(20).joinToString(",")).commit() }
    /** the newest version taken, so an older signed manifest can't roll the page back */
    private var newest: Int
        get() = prefs.getInt("newest", 0)
        set(n) { prefs.edit().putInt("newest", n).commit() }

    // MARK: Loading

    /** The downloaded page to load now, or null for the page built into the app. Called for every load of the game. */
    @Synchronized
    fun pageToLoad(): Manifest? {
        loaded = null
        pending?.let { p -> // downloaded last time: it becomes the page from this launch
            pending = null
            activeFile.delete()
            if (pendingFile.renameTo(activeFile)) { active = p; attempts = 0 }
        }
        val m = active ?: run { activeFile.delete(); return null }
        if (attempts >= 2) { drop(m, "it was launched twice without starting"); return null }
        if (m.minBuild > build || build > m.maxBuild || m.v in bad || !matches(read(activeFile), m)) {
            log("page update ${m.v} no longer fits this build or file; using the built-in page")
            discard()
            return null
        }
        attempts += 1
        loaded = m
        log("loading page update ${m.v}")
        return m
    }

    /** The page said it started. */
    @Synchronized
    fun booted() {
        if (loaded != null) attempts = 0
    }

    /** The downloaded page didn't start: never use that version again. */
    @Synchronized
    fun failed(why: String) {
        loaded?.let { drop(it, why) }
    }

    private fun drop(m: Manifest, why: String) {
        bad = bad + m.v
        log("dropped page update ${m.v}: $why")
        report("page-update-dropped", "page update ${m.v} was dropped on versionCode $build: $why; the built-in page is used")
        discard()
    }

    private fun discard() {
        active = null
        attempts = 0
        loaded = null
        // the file stays until the next load: a reload of the running page still finds it
    }

    /** The text of the page update [pageToLoad] chose, or null if its file can't be read (MainActivity then drops it). */
    @Synchronized
    fun loadedHtml(): String? = if (loaded == null) null else read(activeFile)?.toString(Charsets.UTF_8)

    // MARK: Checking

    /** Looks for a newer page on the server, at most every 30 minutes unless [force]. Main thread. */
    fun check(server: String, force: Boolean = false) {
        if (PUBLIC_KEY.isEmpty()) return
        val now = SystemClock.elapsedRealtime()
        if (!force && checkedAt != 0L && now - checkedAt < CHECK_EVERY_MS) return
        if (!checking.compareAndSet(false, true)) return
        checkedAt = now
        val base = server.trimEnd('/') + "/updates/$PLATFORM/"
        worker.execute {
            try { checkNow(base) } catch (e: Exception) { log("page update check failed: ${e.message}") } finally { checking.set(false) }
        }
    }

    private fun checkNow(base: String) {
        val m = fetch(base + "manifest.json", 64 * 1024)?.let { verified(it) } ?: return
        synchronized(this) {
            if (m.v <= newest || m.v in bad || m.minBuild > build || build > m.maxBuild) return
            if (m.sha256.isEmpty()) { // "off": back to the built-in page from the next launch
                newest = m.v
                pending = null
                pendingFile.delete()
                if (active != null) { active = null; attempts = 0 }
                log("page update ${m.v}: back to the built-in page from the next launch")
                return
            }
        }
        val page = fetch(base + "page.html", minOf(m.size, MAX_PAGE) + 1)
        if (page == null || !matches(page, m)) { log("page update ${m.v}: the download didn't match its manifest"); return }
        synchronized(this) {
            if (m.v <= newest) return
            val tmp = File(dir, "download.tmp")
            try {
                tmp.writeBytes(page)
                pendingFile.delete()
                if (!tmp.renameTo(pendingFile)) throw java.io.IOException("rename failed")
                pending = m
                newest = m.v
                log("page update ${m.v} downloaded; it loads on the next launch")
            } catch (e: Exception) {
                tmp.delete()
                log("page update ${m.v} couldn't be saved: ${e.message}")
            }
        }
    }

    /** The body of a 200 response, at most [limit] bytes; null for anything else. Worker thread. */
    private fun fetch(url: String, limit: Int): ByteArray? {
        val c = URL(url).openConnection() as HttpURLConnection
        return try {
            c.connectTimeout = 30_000
            c.readTimeout = 30_000
            c.useCaches = false
            c.setRequestProperty("Cache-Control", "no-cache")
            if (c.responseCode != 200) return null
            val out = ByteArrayOutputStream()
            c.inputStream.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) return null
                }
            }
            out.toByteArray()
        } catch (e: Exception) {
            null
        } finally {
            c.disconnect()
        }
    }

    /** The manifest, if it is well formed and signed by our key. */
    private fun verified(data: ByteArray): Manifest? {
        val o = runCatching { JSONObject(String(data, Charsets.UTF_8)) }.getOrNull()
        val m = o?.let { Manifest.from(it) }
        if (o == null || m == null) { log("page update manifest unreadable"); return null }
        val ok = runCatching {
            Ed25519.verify(Base64.decode(PUBLIC_KEY, Base64.DEFAULT), m.message.toByteArray(Charsets.UTF_8), Base64.decode(o.optString("sig"), Base64.DEFAULT))
        }.getOrDefault(false)
        if (!ok) { log("page update ${m.v}: bad signature, ignored"); return null }
        return m
    }

    private fun read(f: File): ByteArray? = runCatching { f.readBytes() }.getOrNull()

    private fun matches(page: ByteArray?, m: Manifest): Boolean {
        if (page == null || page.size != m.size || m.sha256.length != 64) return false
        return MessageDigest.getInstance("SHA-256").digest(page).joinToString("") { "%02x".format(it) } == m.sha256
    }

    private fun log(text: String) = Log.i(TAG, text)
}
