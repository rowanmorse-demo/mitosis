package com.mitosisgame.app

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Sign in with Google through Android's Credential Manager. The ID token goes to the server
 * (/api/auth/google), which verifies it and links the player's wallet to the account.
 * Sign in with Apple is not offered on Android: Apple's web flow needs an https domain and a
 * Services ID, which the server does not have yet.
 */
class SignIn(private val activity: Activity, private val reply: (JSONObject) -> Unit) {
    private val webClientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
    val providers: List<String> get() = if (webClientId.isEmpty()) emptyList() else listOf("google")
    private val scope = CoroutineScope(Dispatchers.Main)

    fun signIn(requestId: Long, provider: String, nonce: String) {
        if (provider != "google" || webClientId.isEmpty()) { reply(error(requestId, "$provider sign-in is not set up in this build")); return }
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(webClientId)         // the *web* client id; the server lists it in GOOGLE_CLIENT_IDS
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        scope.launch {
            try {
                val result = CredentialManager.create(activity).getCredential(activity, request)
                val cred = result.credential
                if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    val token = GoogleIdTokenCredential.createFrom(cred.data).idToken
                    reply(JSONObject().put("id", requestId).put("ok", true).put("credential", JSONObject().put("idToken", token)))
                } else reply(error(requestId, "Google did not return an ID token"))
            } catch (e: GetCredentialCancellationException) {
                reply(JSONObject().put("id", requestId).put("ok", true).put("cancelled", true))
            } catch (e: GetCredentialException) {
                reply(error(requestId, e.message ?: "Google sign-in failed"))
            }
        }
    }

    private fun error(requestId: Long, message: String) = JSONObject().put("id", requestId).put("ok", false).put("error", message)
}
