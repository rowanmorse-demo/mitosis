package com.eclipseforeverbeyond.mitosis

import android.app.Activity
import android.content.Context
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
 * Google Play Billing for the ATP packs. The server (economy.js) is the source of
 * truth: a purchase only becomes ATP once the game has sent the purchase token to
 * /api/iap/google and the server credited it. Only then is the purchase consumed;
 * anything unconsumed is re-delivered on the next launch.
 */
class Billing(context: Context, private val reply: (JSONObject) -> Unit) : PurchasesUpdatedListener {
    private val client = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()
    private val details = HashMap<String, ProductDetails>()
    private val queue = ArrayList<(Boolean) -> Unit>()
    private var connecting = false
    private var buyRequestId = -1L

    private fun whenReady(block: (Boolean) -> Unit) {
        if (client.isReady) { block(true); return }
        queue.add(block)
        if (connecting) return
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connecting = false
                val ok = result.responseCode == BillingClient.BillingResponseCode.OK
                val pending = ArrayList(queue); queue.clear()
                pending.forEach { it(ok) }
            }
            override fun onBillingServiceDisconnected() { connecting = false }
        })
    }

    fun products(requestId: Long, ids: List<String>) = whenReady { ok ->
        if (!ok) { reply(error(requestId, "Google Play is not available")); return@whenReady }
        val params = QueryProductDetailsParams.newBuilder().setProductList(ids.map {
            QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(BillingClient.ProductType.INAPP).build()
        }).build()
        client.queryProductDetailsAsync(params) { result, list ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) { reply(error(requestId, result.debugMessage.ifEmpty { "Could not load products" })); return@queryProductDetailsAsync }
            val arr = JSONArray()
            for (pd in list.sortedBy { it.oneTimePurchaseOfferDetails?.priceAmountMicros ?: 0 }) {
                details[pd.productId] = pd
                arr.put(JSONObject().put("id", pd.productId).put("price", pd.oneTimePurchaseOfferDetails?.formattedPrice ?: "")
                    .put("title", pd.name).put("description", pd.description))
            }
            reply(JSONObject().put("id", requestId).put("ok", true).put("products", arr))
        }
    }

    fun buy(activity: Activity, requestId: Long, productId: String) = whenReady { ok ->
        val pd = details[productId]
        if (!ok || pd == null) { reply(error(requestId, "Product $productId is not available on Google Play yet")); return@whenReady }
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build()
        )).build()
        buyRequestId = requestId
        val r = client.launchBillingFlow(activity, flow)
        if (r.responseCode != BillingClient.BillingResponseCode.OK) { buyRequestId = -1; reply(error(requestId, r.debugMessage.ifEmpty { "Could not start purchase" })) }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        val id = buyRequestId; buyRequestId = -1
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                var delivered = false
                purchases?.forEach { if (deliver(it, if (delivered) -1 else id)) delivered = true }
                if (!delivered && id >= 0) reply(JSONObject().put("id", id).put("ok", true).put("cancelled", true)) // pending payment: arrives later
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> if (id >= 0) reply(JSONObject().put("id", id).put("ok", true).put("cancelled", true))
            else -> if (id >= 0) reply(error(id, result.debugMessage.ifEmpty { "Purchase failed" }))
        }
    }

    /** Hands a completed purchase to the game: as the reply to a buy request, or as an unsolicited "purchase" event. */
    private fun deliver(p: Purchase, requestId: Long): Boolean {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED) return false
        val obj = JSONObject().put("platform", "android").put("productId", p.products.firstOrNull() ?: "")
            .put("purchaseToken", p.purchaseToken).put("orderId", p.orderId ?: "")
        if (requestId >= 0) reply(JSONObject().put("id", requestId).put("ok", true).put("purchase", obj))
        else reply(JSONObject().put("type", "purchase").put("purchase", obj))
        return true
    }

    /** Purchases that were paid but never credited (app closed, server down): the game redeems them again. */
    fun deliverPending() = whenReady { ok ->
        if (!ok) return@whenReady
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        client.queryPurchasesAsync(params) { result, list ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) list.forEach { deliver(it, -1) }
        }
    }

    fun consume(purchaseToken: String) {
        if (purchaseToken.isEmpty()) return
        whenReady { ok -> if (ok) client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(purchaseToken).build()) { _, _ -> } }
    }

    fun close() { runCatching { client.endConnection() } }

    private fun error(requestId: Long, message: String) = JSONObject().put("id", requestId).put("ok", false).put("error", message)
}
