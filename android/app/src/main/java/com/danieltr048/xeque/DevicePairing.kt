package com.danieltr048.xeque

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Credentials and the pending ephemeral key are encrypted by a non-exportable Android Keystore key. */
class DevicePairing(context: Context) {
    companion object {
        const val ORIGIN = "https://xeque-palavras.nexcoreadm.chatgpt.site"
        fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)
    }
    private val prefs = context.getSharedPreferences("xeque-device-pairing-v1", Context.MODE_PRIVATE)
    private val alias = "xeque-device-vault-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    @Synchronized private fun save(name: String, value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = JSONObject().put("iv", encode(cipher.iv)).put("data", encode(cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))))
        check(prefs.edit().putString(name, encrypted.toString()).commit())
    }
    @Synchronized private fun read(name: String): JSONObject? = runCatching {
        val encrypted = JSONObject(prefs.getString(name, null) ?: return null)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(encrypted.getString("iv")))) }
        JSONObject(String(cipher.doFinal(decode(encrypted.getString("data"))), Charsets.UTF_8))
    }.getOrNull()
    fun credentials(): JSONObject? = read("credentials")
    fun connected() = credentials() != null
    fun disconnect() { check(prefs.edit().remove("credentials").remove("pending").commit()) }
    @Synchronized fun begin(): Pair<String, String> {
        val now = System.currentTimeMillis()
        val existing = read("pending")?.takeIf { it.optLong("expiresAt") > now }
        val pending = existing ?: run {
            // Standard JCA permits explicit SHA-256 for both OAEP and MGF1 (browser WebCrypto-compatible).
            val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair()
            JSONObject().put("publicKey", encode(pair.public.encoded)).put("privateKey", encode(pair.private.encoded))
                .put("nonce", encode(ByteArray(32).also(SecureRandom()::nextBytes))).put("expiresAt", now + 30 * 60_000)
                .also { save("pending", it) }
        }
        val publicKey = pending.getString("publicKey")
        val request = JSONObject().put("publicKey", publicKey).put("nonce", pending.getString("nonce"))
            .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".take(80))
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(decode(publicKey)).take(6)
            .joinToString("") { "%02x".format(it) }.chunked(4).joinToString(" ")
        return "$ORIGIN/connect#${encode(request.toString().toByteArray(Charsets.UTF_8))}" to fingerprint
    }
    @Synchronized fun accept(payload: String) {
        val pending = read("pending") ?: error("No pending pairing")
        val data = PairingEnvelope.decrypt(payload, pending, ORIGIN, System.currentTimeMillis())
        save("credentials", data)
        check(prefs.edit().remove("pending").commit())
    }
}
