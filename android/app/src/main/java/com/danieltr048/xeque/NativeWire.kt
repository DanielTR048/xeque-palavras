package com.danieltr048.xeque

import org.json.JSONArray
import org.json.JSONObject

/** Versioned JSON shared with the website; unknown fields survive round trips in NativeStore. */
object NativeWire {
    fun empty() = JSONObject().put("version", 1).put("games", JSONObject()).put("results", JSONObject())
        .put("config", JSONObject.NULL).put("preferences", JSONObject.NULL).put("legacy", JSONObject())
    fun config(value: GameConfig) = JSONObject().put("language", value.language).put("mode", value.mode)
        .put("difficulty", value.difficulty).put("length", value.length)
    fun parseConfig(raw: JSONObject): GameConfig {
        val result = GameConfig(raw.getString("language"), raw.getString("mode"), raw.getString("difficulty"), raw.getInt("length"))
        require(result.language in listOf("pt", "en") && result.mode in GameEngine.modes && result.difficulty in GameEngine.difficulties && result.length in 4..8)
        return result
    }
    fun id(value: Game) = if (value.config.mode == "daily") "daily:${value.day}:${value.config.language}:${value.config.difficulty}:${value.config.length}" else value.id
    fun game(value: Game) = JSONObject().put("id", id(value)).put("config", config(value.config))
        .put("targets", JSONArray(value.targets)).put("guesses", JSONArray(value.guesses)).put("status", value.status)
        .put("startedAt", value.startedAt ?: JSONObject.NULL).put("finishedAt", value.finishedAt ?: JSONObject.NULL)
        .put("maxAttempts", value.maxAttempts).put("durationSeconds", if (value.config.mode == "blitz") 120 else JSONObject.NULL)
    fun entry(value: Game, updatedAt: Long) = JSONObject().put("game", game(value)).put("day", value.day).put("updatedAt", updatedAt)
    fun result(value: Game) = JSONObject().put("id", id(value)).put("language", value.config.language)
        .put("won", value.status == "won").put("finishedAt", value.finishedAt).put("attempts", value.guesses.size)
    fun parseLegacyGame(raw: JSONObject): Game = parseGame(raw, raw.getString("day"), false)
    fun parseEntry(raw: JSONObject): Game {
        require(raw.getLong("updatedAt") >= 0)
        return parseGame(raw.getJSONObject("game"), raw.getString("day"), true)
    }
    private fun parseGame(raw: JSONObject, day: String, wire: Boolean): Game {
        fun words(key: String): List<String> = raw.getJSONArray(key).let { array -> List(array.length()) { array.getString(it) } }
        val config = parseConfig(raw.getJSONObject("config"))
        val result = Game(raw.getString("id"), config, words("targets"), day, words("guesses"), raw.getString("status"),
            if (raw.isNull("startedAt")) null else raw.getLong("startedAt"), if (raw.isNull("finishedAt")) null else raw.getLong("finishedAt"))
        require(result.id.isNotBlank() && result.id.length <= 300 && day.matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
        require(java.time.LocalDate.parse(day).toString() == day)
        require(result.targets.size == GameEngine.boardCount(config.mode) && result.targets.distinct().size == result.targets.size)
        require(result.guesses.distinct().size == result.guesses.size && result.guesses.size <= result.maxAttempts)
        require((result.targets + result.guesses).all { it.matches(Regex("[a-z]{${config.length}}")) })
        require(result.status in listOf("playing", "won", "lost"))
        require((result.status == "won") == result.targets.all { it in result.guesses })
        require(result.status != "playing" || result.guesses.size < result.maxAttempts)
        require(result.guesses.isEmpty() || result.startedAt != null)
        require(result.status == "playing" || result.finishedAt != null)
        require(result.status != "playing" || result.finishedAt == null)
        require(result.startedAt == null || result.startedAt >= 0)
        require(result.finishedAt == null || (result.startedAt != null && result.finishedAt >= result.startedAt))
        if (result.status == "lost") require(result.guesses.size == result.maxAttempts ||
            (config.mode == "blitz" && result.startedAt != null && result.finishedAt!! >= result.startedAt + 120_000))
        if (wire) {
            require(raw.getInt("maxAttempts") == result.maxAttempts)
            require(if (config.mode == "blitz") raw.getInt("durationSeconds") == 120 else raw.isNull("durationSeconds"))
            require(config.mode != "daily" || result.id == id(result))
        }
        return result
    }
    fun validateDocument(document: JSONObject) {
        require(document.toString().toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024 && document.getInt("version") == 1)
        val entries = document.getJSONObject("games"); require(entries.length() <= 5000)
        entries.keys().forEach { key -> require(parseEntry(entries.getJSONObject(key)).id == key) }
        val results = document.getJSONObject("results"); require(results.length() <= 5000)
        results.keys().forEach { key -> val value = results.getJSONObject(key)
            require(value.getString("id") == key && value.getString("language") in listOf("pt", "en"))
            value.getBoolean("won"); require(value.getLong("finishedAt") >= 0 && value.getInt("attempts") in 0..50)
        }
        if (!document.isNull("config")) parseConfig(document.getJSONObject("config").getJSONObject("value"))
        document.getJSONObject("legacy")
    }
}
