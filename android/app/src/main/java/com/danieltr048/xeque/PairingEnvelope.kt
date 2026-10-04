package com.danieltr048.xeque

import org.json.JSONObject
import java.security.KeyFactory
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Pure protocol validation is also exercised by JVM tests with a browser-compatible envelope. */
object PairingEnvelope {
    fun decrypt(payload: String, pending: JSONObject, expectedOrigin: String, now: Long): JSONObject {
        require(payload.length <= 32768 && pending.getLong("expiresAt") >= now)
        fun decode(value: String) = Base64.getUrlDecoder().decode(value)
        val envelope = JSONObject(String(decode(payload), Charsets.UTF_8)); require(envelope.getInt("version") == 1)
        val privateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(decode(pending.getString("privateKey"))))
        val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").apply {
            init(Cipher.DECRYPT_MODE, privateKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
        }
        val rawKey = rsa.doFinal(decode(envelope.getString("key"))); require(rawKey.size == 32)
        try {
            val iv = decode(envelope.getString("iv")); require(iv.size == 12)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, SecretKeySpec(rawKey, "AES"), GCMParameterSpec(128, iv)) }
            val data = JSONObject(String(cipher.doFinal(decode(envelope.getString("data"))), Charsets.UTF_8))
            require(data.getString("nonce") == pending.getString("nonce") && data.getString("origin") == expectedOrigin)
            require(data.getLong("expiresAt") in now..(now + 30 * 60_000))
            require(listOf("deviceId", "platformToken", "deviceToken").all { data.optString(it).isNotBlank() && data.getString(it).length <= 8192 })
            require(listOf("platformToken", "deviceToken").all { !data.getString(it).contains(Regex("[\\r\\n]")) })
            return data
        } finally { rawKey.fill(0) }
    }
}
