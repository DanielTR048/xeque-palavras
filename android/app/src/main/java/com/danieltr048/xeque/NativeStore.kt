package com.danieltr048.xeque

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class GameStats(val played: Int = 0, val won: Int = 0, val streak: Int = 0, val best: Int = 0)

/** Each profile has its own durable, offline document. The original v1 preferences stay untouched. */
class NativeStore(context: Context, val profile: String) {
    init { require(profile in listOf("daniel", "larissa")) }
    private val prefs = context.getSharedPreferences("xeque-profile-$profile-v1", Context.MODE_PRIVATE)
    var onChange: (() -> Unit)? = null
    init {
        if (profile == "daniel" && !prefs.getBoolean("migrated", false)) {
            val old = context.getSharedPreferences("xeque-native-v1", Context.MODE_PRIVATE)
            val document = NativeWire.empty()
            val backup = JSONObject()
            old.all.forEach { (key, value) -> backup.put(key, value) }
            val now = System.currentTimeMillis()
            val migratedIds = mutableMapOf<String, String>()
            old.all.filterKeys { it.startsWith("game:") }.values.forEach { value ->
                runCatching {
                    val game = NativeWire.parseLegacyGame(JSONObject(value as String))
                    val id = NativeWire.id(game); migratedIds[game.id] = id
                    document.getJSONObject("games").put(id, NativeWire.entry(game, now))
                    if (game.status != "playing") document.getJSONObject("results").put(id, NativeWire.result(game))
                }
            }
            runCatching { JSONArray(old.getString("results", "[]")).let { events ->
                repeat(events.length()) { i ->
                    val event = events.getJSONObject(i)
                    val oldId = event.getString("id"); val mapped = migratedIds[oldId] ?: oldId
                    if (!document.getJSONObject("results").has(mapped)) document.getJSONObject("results").put(mapped,
                        JSONObject(event.toString()).put("id", mapped).put("attempts", 0))
                }
            } }
            runCatching { NativeWire.parseConfig(JSONObject(old.getString("config", "")!!)) }.getOrNull()?.let {
                document.put("config", JSONObject().put("value", NativeWire.config(it)).put("updatedAt", now))
            }
            if (old.contains("contrast")) document.put("preferences", JSONObject().put("value",
                JSONObject().put("highContrast", old.getBoolean("contrast", false)).put("sound", false)).put("updatedAt", now))
            check(prefs.edit().putString("legacy-backup-v1", backup.toString()).putString("document", document.toString())
                .putBoolean("migrated", true).putLong("revision", 1).commit())
        }
    }
    @Synchronized fun snapshot(): Pair<Long, JSONObject> = prefs.getLong("revision", 0) to
        runCatching { JSONObject(prefs.getString("document", "")!!) }.getOrDefault(NativeWire.empty())
    private fun write(document: JSONObject) {
        check(prefs.edit().putString("document", document.toString()).putLong("revision", prefs.getLong("revision", 0) + 1).commit())
        onChange?.invoke()
    }
    @Synchronized fun applyRemote(document: JSONObject, expectedRevision: Long): Boolean {
        if (prefs.getLong("revision", 0) != expectedRevision) return false
        NativeWire.validateDocument(document)
        check(prefs.edit().putString("document", document.toString()).putLong("revision", expectedRevision + 1).commit())
        return true
    }
    @Synchronized fun config(): GameConfig = runCatching {
        NativeWire.parseConfig(snapshot().second.getJSONObject("config").getJSONObject("value"))
    }.getOrDefault(GameConfig())
    @Synchronized fun saveConfig(config: GameConfig, provisional: Boolean = false) {
        val document = snapshot().second
        if (runCatching { NativeWire.parseConfig(document.getJSONObject("config").getJSONObject("value")) }.getOrNull() == config) return
        document.put("config", JSONObject().put("value", NativeWire.config(config)).put("updatedAt", if (provisional) 0 else System.currentTimeMillis()))
        write(document)
    }
    var contrast: Boolean
        get() = snapshot().second.optJSONObject("preferences")?.optJSONObject("value")?.optBoolean("highContrast") ?: false
        @Synchronized set(value) {
            val document = snapshot().second
            val preferences = document.optJSONObject("preferences")?.optJSONObject("value") ?: JSONObject().put("sound", false)
            preferences.put("highContrast", value)
            document.put("preferences", JSONObject().put("value", preferences).put("updatedAt", System.currentTimeMillis()))
            write(document)
        }
    @Synchronized fun save(game: Game, provisional: Boolean = false) {
        val document = snapshot().second
        val entries = document.getJSONObject("games")
        val id = NativeWire.id(game)
        val existing = entries.optJSONObject(id)?.let { runCatching { NativeWire.parseEntry(it) }.getOrNull() }
        if (existing == game.copy(id = id)) return
        entries.put(id, NativeWire.entry(game, if (provisional) 0 else System.currentTimeMillis()))
        if (game.status != "playing") document.getJSONObject("results").put(id, NativeWire.result(game))
        write(document)
    }
    @Synchronized fun load(config: GameConfig, day: String = GameEngine.day()): Game? {
        val entries = snapshot().second.getJSONObject("games")
        return entries.keys().asSequence().mapNotNull { key -> runCatching {
            val entry = entries.getJSONObject(key)
            NativeWire.parseEntry(entry) to entry.getLong("updatedAt")
        }.getOrNull() }.filter { it.first.config == config && (config.mode != "daily" || it.first.day == day) }
            .sortedWith(compareByDescending<Pair<Game, Long>> { it.second }
                .thenByDescending { when (it.first.status) { "won" -> 2; "lost" -> 1; else -> 0 } }
                .thenByDescending { it.first.guesses.size }.thenBy { it.first.id }).firstOrNull()?.first?.let(GameEngine::expire)
    }
    @Synchronized fun stats(language: String): GameStats {
        val document = snapshot().second
        val events = document.getJSONObject("results")
        val results = events.keys().asSequence().map { events.getJSONObject(it) }.filter { it.optString("language") == language }
            .sortedWith(compareBy<JSONObject> { it.getLong("finishedAt") }.thenByDescending { it.getString("id") }).toList()
        val legacy = document.getJSONObject("legacy")
        val baselines = legacy.keys().asSequence().mapNotNull { legacy.optJSONObject(it)?.optJSONObject(language) }.toList()
        var played = baselines.sumOf { it.optInt("played") }
        var won = baselines.sumOf { it.optInt("won") }
        var streak = if (baselines.size == 1) baselines[0].optInt("currentStreak") else 0
        var best = baselines.maxOfOrNull { it.optInt("bestStreak") } ?: 0
        results.forEach { if (it.getBoolean("won")) { won++; streak++; best = maxOf(best, streak) } else streak = 0 }
        played += results.size
        return GameStats(played, won, streak, best)
    }
}
