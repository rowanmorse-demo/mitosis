package com.mitosisgame.app

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat

/**
 * Battery saver and the thermal state, for the page ({type:'power', low, thermal}): it switches to reduced
 * effects while battery saver is on or the phone is hot. `thermal` is iOS's ProcessInfo.ThermalState raw value, which the
 * page reads as a number: 0 nominal, 1 fair, 2 serious, 3 critical.
 */
class Power(private val activity: Activity, private val send: (low: Boolean, thermal: Int) -> Unit) {
    private val pm = activity.getSystemService(PowerManager::class.java)
    private var last: Pair<Boolean, Int>? = null
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = report()
    }
    private var thermalListener: Any? = null   // a PowerManager.OnThermalStatusChangedListener on Android 10+

    init {
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null) thermalListener = Thermal.listen(activity, pm) { report() }
    }

    /** Sends the state when it changed since the last report, or always when [force] (a freshly loaded page). */
    fun report(force: Boolean = false) {
        val low = pm?.isPowerSaveMode == true
        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null) Thermal.level(pm) else 0
        val now = low to thermal
        if (!force && now == last) return
        last = now
        send(low, thermal)
    }

    fun close() {
        runCatching { activity.unregisterReceiver(receiver) }
        val l = thermalListener
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm != null && l != null) Thermal.unlisten(pm, l)
        thermalListener = null
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private object Thermal {
        fun level(pm: PowerManager) = when (pm.currentThermalStatus) {
            PowerManager.THERMAL_STATUS_NONE -> 0       // nominal
            PowerManager.THERMAL_STATUS_LIGHT -> 1      // fair
            PowerManager.THERMAL_STATUS_MODERATE -> 2   // serious: the page turns on battery saver from here
            else -> 3                                   // critical (severe, critical, emergency, shutdown)
        }

        fun listen(activity: Activity, pm: PowerManager, changed: () -> Unit): Any {
            val l = PowerManager.OnThermalStatusChangedListener { changed() }
            pm.addThermalStatusListener(activity.mainExecutor, l)
            return l
        }

        fun unlisten(pm: PowerManager, l: Any) {
            runCatching { pm.removeThermalStatusListener(l as PowerManager.OnThermalStatusChangedListener) }
        }
    }
}
