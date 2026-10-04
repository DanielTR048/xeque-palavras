package com.danieltr048.xeque

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class GameStats(val played: Int = 0, val won: Int = 0, val streak: Int = 0, val best: Int = 0)

/** Application-private persistence; no shared-storage permission and no cloud account. */
class NativeStore(context: Context) {
    private val prefs = context.getSharedPreferences("xeque-native-v1", Context.MODE_PRIVATE)
    private fun configJson(config: GameConfig) = JSONObject().put("language", config.language).put("mode", config.mode)
        .put("difficulty", config.difficulty).put("length", config.length)
    private fun parseConfig(json: JSONObject): GameConfig {
        val config = GameConfig(json.getString("language"), json.getString("mode"), json.getString("difficulty"), json.getInt("length"))
        require(config.language in listOf("pt", "en") && config.mode in GameEngine.modes && config.difficulty in GameEngine.difficulties && config.length in 4..8)
        return config
    }
    fun config(): GameConfig = runCatching { parseConfig(JSONObject(prefs.getString("config", "")!!)) }.getOrDefault(GameConfig())
    fun saveConfig(config: GameConfig) { prefs.edit().putString("config", configJson(config).toString()).apply() }
    var contrast: Boolean
        get() = prefs.getBoolean("contrast", false)
        set(value) { prefs.edit().putBoolean("contrast", value).apply() }
    private fun key(config: GameConfig, day: String) = "game:${config.language}:${config.mode}:${config.difficulty}:${config.length}" + if (config.mode == "daily") ":$day" else ""
    fun save(game: Game) {
        val json = JSONObject().put("id", game.id).put("config", configJson(game.config)).put("day", game.day)
            .put("targets", JSONArray(game.targets)).put("guesses", JSONArray(game.guesses)).put("status", game.status)
            .put("startedAt", game.startedAt ?: JSONObject.NULL).put("finishedAt", game.finishedAt ?: JSONObject.NULL)
        prefs.edit().putString(key(game.config, game.day), json.toString()).apply()
        if (game.status != "playing") record(game)
    }
    fun load(config: GameConfig, day: String = GameEngine.day()): Game? = runCatching {
        val json = JSONObject(prefs.getString(key(config, day), "")!!)
        fun words(name: String): List<String> = json.getJSONArray(name).let { array -> List(array.length()) { array.getString(it) } }
        val game = Game(json.getString("id"), parseConfig(json.getJSONObject("config")), words("targets"), json.getString("day"),
            words("guesses"), json.getString("status"), if (json.isNull("startedAt")) null else json.getLong("startedAt"),
            if (json.isNull("finishedAt")) null else json.getLong("finishedAt"))
        require(game.config == config && game.targets.size == GameEngine.boardCount(config.mode))
        require(config.mode != "daily" || game.day == day)
        require(game.targets.distinct().size == game.targets.size && game.guesses.distinct().size == game.guesses.size)
        require((game.targets + game.guesses).all { it.matches(Regex("[a-z]{${config.length}}")) })
        require(game.guesses.size <= game.maxAttempts && game.status in listOf("playing", "won", "lost"))
        require((game.status == "won") == game.targets.all { it in game.guesses })
        require(game.status != "playing" || game.guesses.size < game.maxAttempts)
        require(game.guesses.isEmpty() || game.startedAt != null)
        require(game.status == "playing" || game.finishedAt != null)
        GameEngine.expire(game)
    }.getOrNull()
    private fun record(game: Game) {
        val events = runCatching { JSONArray(prefs.getString("results", "[]")) }.getOrDefault(JSONArray())
        if ((0 until events.length()).any { events.getJSONObject(it).getString("id") == game.id }) return
        events.put(JSONObject().put("id", game.id).put("language", game.config.language)
            .put("won", game.status == "won").put("finishedAt", game.finishedAt))
        prefs.edit().putString("results", events.toString()).apply()
    }
    fun stats(language: String): GameStats = runCatching {
        val events = JSONArray(prefs.getString("results", "[]"))
        val results = (0 until events.length()).map { events.getJSONObject(it) }
            .filter { it.getString("language") == language }.sortedBy { it.getLong("finishedAt") }
        var won = 0; var streak = 0; var best = 0
        results.forEach { if (it.getBoolean("won")) { won++; streak++; best = maxOf(best, streak) } else streak = 0 }
        GameStats(results.size, won, streak, best)
    }.getOrDefault(GameStats())
}
