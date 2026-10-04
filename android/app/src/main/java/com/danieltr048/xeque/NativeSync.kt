package com.danieltr048.xeque

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Networking never runs on the UI thread. Local documents are the durable offline outbox. */
class NativeSync(context: Context, private val pairing: DevicePairing,
    private val isCurrent: (NativeStore, Int) -> Boolean,
    private val onState: (NativeStore, String, Boolean) -> Unit) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val pending = mutableMapOf<String, Runnable>()
    private var running = false
    private val again = linkedMapOf<String, Pair<NativeStore, Int>>()
    private var closed = false
    fun online(): Boolean = connectivity.activeNetwork?.let { network -> connectivity.getNetworkCapabilities(network)?.let {
        it.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && it.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    } } ?: false
    fun request(store: NativeStore, generation: Int, immediate: Boolean = false) {
        if (closed) return
        pending.remove(store.profile)?.let(handler::removeCallbacks)
        pending[store.profile] = Runnable { pending.remove(store.profile); sync(store, generation) }
            .also { handler.postDelayed(it, if (immediate) 0 else 800) }
    }
    private fun sync(store: NativeStore, generation: Int) {
        if (closed) return
        val credentials = pairing.credentials()
        if (credentials == null) { onState(store, "unpaired", false); return }
        if (!online()) { onState(store, "offline", false); return }
        if (running) { again[store.profile] = store to generation; return }
        running = true; onState(store, "syncing", false)
        val (localRevision, snapshot) = store.snapshot()
        executor.execute {
            var state = "retry"; var remote: JSONObject? = null
            runCatching {
                val body = JSONObject().put("profile", store.profile).put("document", snapshot).toString().toByteArray(Charsets.UTF_8)
                require(body.size <= 2 * 1024 * 1024)
                val connection = URL("${DevicePairing.ORIGIN}/api/sync").openConnection() as HttpsURLConnection
                try {
                    connection.instanceFollowRedirects = false; connection.connectTimeout = 12_000; connection.readTimeout = 20_000
                    connection.requestMethod = "POST"; connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("OAI-Sites-Authorization", "Bearer ${credentials.getString("platformToken")}")
                    connection.setRequestProperty("Authorization", "Bearer ${credentials.getString("deviceToken")}")
                    connection.setFixedLengthStreamingMode(body.size)
                    connection.outputStream.use { it.write(body) }
                    when (connection.responseCode) {
                        200 -> {
                            val response = connection.inputStream.use { input ->
                                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                                while (true) { val count = input.read(buffer); if (count == -1) break
                                    require(output.size() + count <= 2 * 1024 * 1024 + 8192); output.write(buffer, 0, count) }
                                JSONObject(output.toString("UTF-8"))
                            }
                            remote = response.getJSONObject("document"); NativeWire.validateDocument(remote!!); state = "synced"
                        }
                        301, 302, 303, 307, 308, 401, 403 -> state = "reconnect"
                        409, 413, 422 -> state = "capacity"
                    }
                } finally { connection.disconnect() }
            }
            handler.post {
                if (closed) return@post
                running = false
                if (pairing.credentials()?.optString("deviceId") == credentials.optString("deviceId")) {
                    val applied = remote?.let { store.applyRemote(it, localRevision) } ?: false
                    if (isCurrent(store, generation)) onState(store, state, applied)
                    if (remote != null && !applied) again[store.profile] = store to generation
                }
                again.entries.firstOrNull()?.let { queued ->
                    val (next, nextGeneration) = queued.value; again.remove(queued.key); request(next, nextGeneration, true)
                }
            }
        }
    }
    fun close() { closed = true; pending.values.forEach(handler::removeCallbacks); pending.clear(); again.clear(); executor.shutdownNow() }
}
