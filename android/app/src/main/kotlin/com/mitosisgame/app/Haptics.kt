package com.mitosisgame.app

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Plays the page's haptics on a thread of their own, as the iOS app does: a vibrator that is slow to answer
 * must never hold up the game's main thread. Styles are the page's names (Native.haptic in index.html).
 */
class Haptics(context: Context) {
    private val vibrator: Vibrator? = run {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
        v?.takeIf { it.hasVibrator() }
    }
    private val thread = HandlerThread("haptics").apply { start() }
    private val handler = Handler(thread.looper)

    fun play(style: String) {
        val v = vibrator ?: return
        handler.post { runCatching { v.vibrate(effect(style)) } }
    }

    fun close() { thread.quitSafely() }

    private fun effect(style: String): VibrationEffect = when (style) {
        "selection" -> VibrationEffect.createOneShot(8, 60)
        "light", "soft" -> VibrationEffect.createOneShot(12, 80)
        "rigid" -> VibrationEffect.createOneShot(15, 220)
        "heavy" -> VibrationEffect.createOneShot(45, 255)
        "success" -> VibrationEffect.createWaveform(longArrayOf(0, 20, 60, 20), -1)
        "warning" -> VibrationEffect.createWaveform(longArrayOf(0, 30, 80, 20), -1)
        "error" -> VibrationEffect.createWaveform(longArrayOf(0, 50, 50, 30, 50, 60), -1)
        else -> VibrationEffect.createOneShot(25, 160)   // "medium"
    }
}
