package com.danieltr048.xeque

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class GameEngineTest {
    private val words = listOf("termo", "torre", "campo", "livro", "papel", "peixe", "mundo", "festa")
    private val dictionary = words.toSet()
    private fun game(mode: String = "classic") = GameEngine.create(GameConfig(mode = mode), if (mode == "duo" || mode == "quartet") words else listOf("termo"), 1000, "test")

    @Test fun normalizationHandlesPortugueseAccents() {
        assertEquals("acoes", GameEngine.normalize(" AÇÕES "))
        assertEquals("orgao", GameEngine.normalize("Órgão"))
        assertEquals("queen", GameEngine.normalize("QUEEN"))
    }
    @Test fun duplicateLettersReserveExactMatches() {
        assertEquals(listOf(LetterState.PRESENT, LetterState.PRESENT, LetterState.ABSENT, LetterState.ABSENT, LetterState.CORRECT), GameEngine.evaluate("arara", "carta"))
        assertEquals(listOf(LetterState.ABSENT, LetterState.CORRECT, LetterState.ABSENT, LetterState.ABSENT, LetterState.CORRECT), GameEngine.evaluate("aaaaa", "carta"))
    }
    @Test fun invalidGuessesDoNotSpendAttemptsOrStartTimer() {
        val before = game("blitz")
        assertEquals("length", GameEngine.submit(before, "oi", dictionary).error)
        assertEquals("unknown", GameEngine.submit(before, "zzzzz", dictionary).error)
        assertNull(before.startedAt); assertEquals(0, before.guesses.size)
        val after = GameEngine.submit(before, "campo", dictionary, 2000).game
        assertEquals("duplicate", GameEngine.submit(after, "CAMPO", dictionary, 2001).error)
    }
    @Test fun simultaneousTargetsAreDistinctAndAllMustBeSolved() {
        var current = game("quartet")
        assertEquals(4, current.targets.distinct().size)
        current.targets.forEachIndexed { index, word ->
            current = GameEngine.submit(current, word, dictionary, 2000 + index.toLong()).game
            assertEquals(if (index == 3) "won" else "playing", current.status)
        }
        assertEquals("finished", GameEngine.submit(current, "festa", dictionary).error)
    }
    @Test fun budgetsAndFinalWinningAttemptAreCorrect() {
        assertEquals(8, GameEngine.maxAttempts(GameConfig(difficulty = "easy")))
        assertEquals(5, GameEngine.maxAttempts(GameConfig(difficulty = "hard")))
        assertEquals(8, GameEngine.maxAttempts(GameConfig(mode = "duo")))
        assertEquals(10, GameEngine.maxAttempts(GameConfig(mode = "quartet")))
        var current = game().copy(config = GameConfig(difficulty = "hard"))
        listOf("torre", "campo", "livro", "papel").forEach { current = GameEngine.submit(current, it, dictionary).game }
        assertEquals("lost", GameEngine.submit(current, "peixe", dictionary).game.status)
        assertEquals("won", GameEngine.submit(current, "termo", dictionary).game.status)
    }
    @Test fun dailyTargetsStayStableAndIgnoreDictionaryOrder() {
        val morning = LocalDate.of(2026, 10, 3).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val config = GameConfig(mode = "daily")
        assertEquals(GameEngine.create(config, words, morning).targets, GameEngine.create(config, words.reversed(), morning + 80000000).targets)
    }
    @Test fun timerStartsOnFirstValidGuessAndExpiresWithoutResetting() {
        val before = game("blitz")
        assertEquals(120, GameEngine.remaining(before, 999999))
        val first = GameEngine.submit(before, "campo", dictionary, 2000).game
        val second = GameEngine.submit(first, "livro", dictionary, 62000).game
        assertEquals(2000L, second.startedAt)
        assertEquals(60, GameEngine.remaining(second, 62000))
        assertEquals("playing", GameEngine.expire(second, 121999).status)
        assertEquals("lost", GameEngine.expire(second, 122000).status)
        assertEquals("finished", GameEngine.submit(second, "termo", dictionary, 122000).error)
        val won = GameEngine.submit(first, "termo", dictionary, 12000).game
        assertEquals(110, GameEngine.remaining(won, 999999))
    }
    @Test fun keyboardFreezesAtSolvedRow() {
        val current = game("duo").copy(targets = listOf("torre", "campo"), guesses = listOf("torre", "campo"))
        assertFalse(GameEngine.keyboard(current, 0).containsKey('c'))
        assertEquals(LetterState.CORRECT, GameEngine.keyboard(current, 1)['c'])
    }
    @Test fun dailyFullDictionarySelectionMatchesWebsiteFixtures() {
        val now = java.time.Instant.parse("2026-10-03T15:00:00Z").toEpochMilli()
        mapOf("pt" to "ruina", "en" to "teeny").forEach { (language, answer) ->
            val source = java.io.File("src/main/assets/dictionaries/$language.json").readText()
            val list = source.substringAfter("\"words\":[").substringBefore("]")
            val pool = Regex("\"([a-z]+)\"").findAll(list).map { it.groupValues[1] }.toList()
            assertTrue(pool.size >= 10000)
            assertEquals(listOf(answer), GameEngine.create(GameConfig(language, "daily", "hard", 5), pool, now).targets)
        }
    }
}
