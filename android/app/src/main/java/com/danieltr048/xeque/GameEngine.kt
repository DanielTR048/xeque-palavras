package com.danieltr048.xeque

import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

data class GameConfig(val language: String = "pt", val mode: String = "classic", val difficulty: String = "normal", val length: Int = 5)
enum class LetterState { CORRECT, PRESENT, ABSENT }
data class Game(
    val id: String, val config: GameConfig, val targets: List<String>, val day: String,
    val guesses: List<String> = emptyList(), val status: String = "playing",
    val startedAt: Long? = null, val finishedAt: Long? = null,
) {
    val maxAttempts get() = GameEngine.maxAttempts(config)
    fun solved(board: Int) = targets.getOrNull(board)?.let { guesses.contains(it) } ?: false
}
data class GuessResult(val game: Game, val error: String? = null)

object GameEngine {
    val modes = listOf("classic", "daily", "duo", "quartet", "blitz")
    val difficulties = listOf("easy", "normal", "hard")
    fun normalize(word: String): String = Normalizer.normalize(word, Normalizer.Form.NFD)
        .replace(Regex("\\p{M}"), "").lowercase(java.util.Locale.ROOT).replace(Regex("[^a-z]"), "")
    fun day(now: Long = System.currentTimeMillis()): String = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    fun boardCount(mode: String) = when (mode) { "duo" -> 2; "quartet" -> 4; else -> 1 }
    fun maxAttempts(config: GameConfig) = (when (config.difficulty) { "easy" -> 8; "hard" -> 5; else -> 6 }) +
        (when (config.mode) { "duo" -> 2; "quartet" -> 4; else -> 0 })

    fun evaluate(guess: String, target: String): List<LetterState> {
        val word = normalize(guess); val answer = normalize(target)
        val result = MutableList(word.length) { LetterState.ABSENT }
        val remaining = mutableMapOf<Char, Int>()
        answer.forEachIndexed { index, letter ->
            if (word.getOrNull(index) == letter) result[index] = LetterState.CORRECT
            else remaining[letter] = (remaining[letter] ?: 0) + 1
        }
        word.forEachIndexed { index, letter ->
            if (result[index] != LetterState.CORRECT && (remaining[letter] ?: 0) > 0) {
                result[index] = LetterState.PRESENT; remaining[letter] = remaining.getValue(letter) - 1
            }
        }
        return result
    }

    // Same FNV-1a + Mulberry32 selection as the website, for the same daily word pools.
    fun create(config: GameConfig, pool: List<String>, now: Long = System.currentTimeMillis(), seed: String? = null): Game {
        require(config.language in listOf("pt", "en") && config.mode in modes && config.difficulty in difficulties && config.length in 4..8)
        val words = pool.map(::normalize).filter { it.length == config.length }.distinct().sorted().toMutableList()
        val count = boardCount(config.mode); require(words.size >= count)
        val date = day(now)
        val selectionSeed = seed ?: if (config.mode == "daily") "$date:${config.language}:${config.length}:${config.difficulty}" else UUID.randomUUID().toString()
        var state = 0x811c9dc5.toInt()
        selectionSeed.forEach { state = (state xor it.code) * 16777619 }
        fun next(): Double {
            state += 0x6d2b79f5
            var value = state
            value = (value xor (value ushr 15)) * (value or 1)
            value = value xor (value + ((value xor (value ushr 7)) * (value or 61)))
            return ((value xor (value ushr 14)).toLong() and 0xffffffffL) / 4294967296.0
        }
        repeat(count) { index -> val selected = index + (next() * (words.size - index)).toInt()
            val previous = words[index]; words[index] = words[selected]; words[selected] = previous }
        val id = if (config.mode == "daily") "daily:$date:${config.language}:${config.difficulty}:${config.length}" else "${config.mode}:$date:${UUID.randomUUID()}"
        return Game(id, config, words.take(count), date)
    }

    fun remaining(game: Game, now: Long = System.currentTimeMillis()): Int? {
        if (game.config.mode != "blitz") return null
        val start = game.startedAt ?: return 120
        val elapsed = ((game.finishedAt ?: now) - start).coerceAtLeast(0)
        return (120 - elapsed / 1000).toInt().coerceAtLeast(0)
    }
    fun expire(game: Game, now: Long = System.currentTimeMillis()): Game {
        val start = game.startedAt ?: return game
        return if (game.config.mode == "blitz" && game.status == "playing" && now >= start + 120_000)
            game.copy(status = "lost", finishedAt = start + 120_000) else game
    }
    fun submit(game: Game, guess: String, validWords: Set<String>, now: Long = System.currentTimeMillis()): GuessResult {
        val current = expire(game, now)
        if (current.status != "playing") return GuessResult(current, "finished")
        val word = normalize(guess)
        if (word.length != current.config.length) return GuessResult(current, "length")
        if (word !in validWords) return GuessResult(current, "unknown")
        if (word in current.guesses) return GuessResult(current, "duplicate")
        val guesses = current.guesses + word
        val status = if (current.targets.all { it in guesses }) "won" else if (guesses.size >= current.maxAttempts) "lost" else "playing"
        return GuessResult(current.copy(guesses = guesses, status = status, startedAt = current.startedAt ?: now, finishedAt = if (status != "playing") now else null))
    }
    fun keyboard(game: Game, board: Int): Map<Char, LetterState> {
        val target = game.targets.getOrNull(board) ?: return emptyMap()
        val result = mutableMapOf<Char, LetterState>()
        for (guess in game.guesses) {
            evaluate(guess, target).forEachIndexed { index, state ->
                val previous = result[guess[index]]
                if (previous == null || state.ordinal < previous.ordinal) result[guess[index]] = state
            }
            if (guess == target) break
        }
        return result
    }
}
