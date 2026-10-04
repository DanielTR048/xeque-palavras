package com.danieltr048.xeque

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.spec.MGF1ParameterSpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

class PairingEnvelopeTest {
    private val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair()
    private val origin = "https://xeque-palavras.nexcoreadm.chatgpt.site"
    private fun encode(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    private fun pending() = JSONObject().put("privateKey", encode(pair.private.encoded)).put("nonce", "test-nonce").put("expiresAt", 10000)
    private fun data() = JSONObject().put("nonce", "test-nonce").put("origin", origin).put("deviceId", "test-device")
        .put("platformToken", "test-platform-token").put("deviceToken", "test-device-token").put("expiresAt", 9000)
    private fun envelope(data: JSONObject, tamper: Boolean = false): String {
        val aesKey = ByteArray(32) { it.toByte() }; val iv = ByteArray(12) { (it + 50).toByte() }
        val aes = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), GCMParameterSpec(128, iv)) }
        val encrypted = aes.doFinal(data.toString().toByteArray())
        if (tamper) encrypted[0] = (encrypted[0].toInt() xor 1).toByte()
        val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding").apply {
            init(Cipher.ENCRYPT_MODE, pair.public, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
        }
        return encode(JSONObject().put("version", 1).put("key", encode(rsa.doFinal(aesKey))).put("iv", encode(iv)).put("data", encode(encrypted)).toString().toByteArray())
    }
    @Test fun acceptsBrowserCompatibleOaepSha256Mgf1Sha256AndAesGcm() {
        assertEquals("test-device", PairingEnvelope.decrypt(envelope(data()), pending(), origin, 5000).getString("deviceId"))
    }
    @Test fun rejectsWrongNonceOriginAndExpiredPairing() {
        assertThrows(IllegalArgumentException::class.java) { PairingEnvelope.decrypt(envelope(data().put("nonce", "other")), pending(), origin, 5000) }
        assertThrows(IllegalArgumentException::class.java) { PairingEnvelope.decrypt(envelope(data().put("origin", "https://other.example")), pending(), origin, 5000) }
        assertThrows(IllegalArgumentException::class.java) { PairingEnvelope.decrypt(envelope(data().put("expiresAt", 1000)), pending(), origin, 5000) }
        assertThrows(IllegalArgumentException::class.java) { PairingEnvelope.decrypt(envelope(data()), pending(), origin, 12000) }
    }
    @Test fun rejectsCiphertextTamperingAndHeaderInjection() {
        assertThrows(javax.crypto.AEADBadTagException::class.java) { PairingEnvelope.decrypt(envelope(data(), true), pending(), origin, 5000) }
        assertThrows(IllegalArgumentException::class.java) { PairingEnvelope.decrypt(envelope(data().put("deviceToken", "bad\r\nheader")), pending(), origin, 5000) }
    }
}
