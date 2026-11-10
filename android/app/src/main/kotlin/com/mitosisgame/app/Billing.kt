package com.mitosisgame.app

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ConsumeParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import org.json.JSONArray
import org.json.JSONObject

/**
 * Google Play Billing (Play Billing Library 8) for the ATP packs: atp_500, atp_1500, atp_5000, atp_12000 and
 * atp_150000, all consumable in-app products. The server (economy.js) is the source of truth: a purchase only
 * becomes ATP once the game has sent the purchase token to /api/iap/google and the server credited it. Only then
 * is the purchase consumed; anything unconsumed is delivered again when the page is ready and on every return
 * to the app (the server ignores an order it has already credited).
 *
 * Billing callbacks can arrive on a background thread, so every one hops to the main thread before it touches
 * this object's state.
 */
class Billing(context: Context, private val reply: (JSONObject) -> Unit) : PurchasesUpdatedListener {
    private val client = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()
    private val main = Handler(Looper.getMainLooper())
    private val details = HashMap<String, ProductDetails>()
    private val queue = ArrayList<(Boolean) -> Unit>()
    private var connecting = false
    private var buyRequestId = -1L
    private val handedOver = HashMap<String, Long>()   // purchase token → when the page was given it

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    private fun whenReady(block: (Boolean) -> Unit) {
        if (client.isReady) { block(true); return }
        queue.add(block)
        if (connecting) return
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) = onMain {
                connecting = false
                val ok = result.responseCode == BillingClient.BillingResponseCode.OK
                val pending = ArrayList(queue); queue.clear()
                pending.forEach { it(ok) }
            }
            override fun onBillingServiceDisconnected() = onMain { connecting = false }
        })
    }

    /** Looks up [ids] on Google Play and remembers them for [buy]; null on failure, with Play's message. */
    private fun fetch(ids: List<String>, done: (List<ProductDetails>?, String) -> Unit) {
        val params = QueryProductDetailsParams.newBuilder().setProductList(ids.map {
            QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(BillingClient.ProductType.INAPP).build()
        }).build()
        client.queryProductDetailsAsync(params) { result, found ->
            onMain {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) done(null, result.debugMessage)
                else {
                    val list = found.productDetailsList
                    list.forEach { details[it.productId] = it }
                    done(list, "")
                }
            }
        }
    }

    fun products(requestId: Long, ids: List<String>) = whenReady { ok ->
        if (!ok) { reply(error(requestId, "Google Play is not available")); return@whenReady }
        if (ids.isEmpty()) { reply(JSONObject().put("id", requestId).put("ok", true).put("products", JSONArray())); return@whenReady }
        fetch(ids) { list, message ->
            if (list == null) { reply(error(requestId, message.ifEmpty { "Could not load products" })); return@fetch }
            val arr = JSONArray()
            for (pd in list.sortedBy { it.oneTimePurchaseOfferDetails?.priceAmountMicros ?: 0 }) {
                arr.put(JSONObject().put("id", pd.productId).put("price", pd.oneTimePurchaseOfferDetails?.formattedPrice ?: "")
                    .put("title", pd.name).put("description", pd.description))
            }
            reply(JSONObject().put("id", requestId).put("ok", true).put("products", arr))
        }
    }

    fun buy(activity: Activity, requestId: Long, productId: String) = whenReady { ok ->
        if (!ok) { reply(error(requestId, "Google Play is not available")); return@whenReady }
        val known = details[productId]
        if (known != null) { launch(activity, requestId, known); return@whenReady }
        // the shop normally loaded the packs first; if not, look this one up now
        fetch(listOf(productId)) { list, _ ->
            val pd = list?.firstOrNull { it.productId == productId }
            if (pd == null) reply(error(requestId, "Product $productId is not available on Google Play yet"))
            else launch(activity, requestId, pd)
        }
    }

    private fun launch(activity: Activity, requestId: Long, pd: ProductDetails) {
        if (activity.isFinishing) { reply(error(requestId, "The app is closing")); return }
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build()
        )).build()
        buyRequestId = requestId
        val r = client.launchBillingFlow(activity, flow)
        if (r.responseCode != BillingClient.BillingResponseCode.OK) { buyRequestId = -1; reply(error(requestId, r.debugMessage.ifEmpty { "Could not start purchase" })) }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        onMain { purchasesUpdated(result, purchases) }
    }

    private fun purchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        val id = buyRequestId; buyRequestId = -1
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                var delivered = false
                purchases?.forEach { if (deliver(it, if (delivered) -1 else id)) delivered = true }
                // a pending payment (cash, bank transfer) arrives later, as a "purchase" event
                if (!delivered && id >= 0) reply(JSONObject().put("id", id).put("ok", true).put("cancelled", true).put("pending", true))
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> if (id >= 0) reply(JSONObject().put("id", id).put("ok", true).put("cancelled", true))
            // already owned = bought before but never credited: hand that one over again
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> { if (id >= 0) reply(JSONObject().put("id", id).put("ok", true).put("cancelled", true)); deliverPending() }
            else -> if (id >= 0) reply(error(id, result.debugMessage.ifEmpty { "Purchase failed" }))
        }
    }

    /** Hands a completed purchase to the game: as the reply to a buy request, or as an unsolicited "purchase" event. */
    private fun deliver(p: Purchase, requestId: Long): Boolean {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED) return false
        handedOver[p.purchaseToken] = System.currentTimeMillis()
        val obj = JSONObject().put("platform", "android").put("productId", p.products.firstOrNull() ?: "")
            .put("purchaseToken", p.purchaseToken).put("orderId", p.orderId ?: "")
        if (requestId >= 0) reply(JSONObject().put("id", requestId).put("ok", true).put("purchase", obj))
        else reply(JSONObject().put("type", "purchase").put("purchase", obj))
        return true
    }

    /**
     * Purchases that were paid but never credited (app closed, server down): the game redeems them again. One handed
     * over in the last minute is still on its way to the server (returning from the payment sheet lands here too).
     */
    fun deliverPending() = whenReady { ok ->
        if (!ok) return@whenReady
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        client.queryPurchasesAsync(params) { result, list ->
            onMain {
                if (result.responseCode != BillingClient.BillingResponseCode.OK) return@onMain
                val now = System.currentTimeMillis()
                list.filter { now - (handedOver[it.purchaseToken] ?: 0L) > 60_000 }.forEach { deliver(it, -1) }
            }
        }
    }

    fun consume(purchaseToken: String) {
        if (purchaseToken.isEmpty()) return
        handedOver.remove(purchaseToken)
        whenReady { ok -> if (ok) client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(purchaseToken).build()) { _, _ -> } }
    }

    fun close() { runCatching { client.endConnection() } }

    private fun error(requestId: Long, message: String) = JSONObject().put("id", requestId).put("ok", false).put("error", message)
}
