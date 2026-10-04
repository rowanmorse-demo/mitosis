package com.mitosisgame.app

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Uncaught exceptions are written to a file the moment they happen and posted to the game server
 * (POST /api/crash) on the next launch, where they land in the server log and DATA_DIR/crashes.
 */
object CrashReporter {
    fun start(context: Context) {
        val dir = File(context.filesDir, "crashes").apply { mkdirs() }
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching {
                File(dir, "crash-${System.currentTimeMillis()}.txt").writeText(
                    "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) Android ${Build.VERSION.RELEASE} ${Build.MODEL}\nthread ${t.name}\n" + Log.getStackTraceString(e)
                )
            }
            previous?.uncaughtException(t, e)
        }
        thread(name = "crash-upload", isDaemon = true) {
            dir.listFiles()?.filter { it.name.startsWith("crash-") }?.forEach { f ->
                runCatching { upload("crash", f.readText()) }
                f.delete()
            }
        }
    }

    private fun upload(kind: String, report: String) {
        val body = JSONObject().put("platform", "android").put("kind", kind)
            .put("app", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})").put("os", "Android ${Build.VERSION.RELEASE}")
            .put("device", Build.MODEL).put("report", report.take(400_000))
        val c = URL(BuildConfig.SERVER_URL + "/api/crash").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.setRequestProperty("Content-Type", "application/json")
        c.doOutput = true; c.connectTimeout = 8000; c.readTimeout = 8000
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        c.responseCode
        c.disconnect()
    }
}
