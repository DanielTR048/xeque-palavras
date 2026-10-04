package com.danieltr048.xeque

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeWireTest {
    private val day = "2026-10-04"
    private fun daily() = Game("legacy-random-id", GameConfig(mode = "daily"), listOf("termo"), day, listOf("campo"), "playing", 1000)
    @Test fun dailyIdsAreCanonicalAcrossDevicesAndRoundTrip() {
        val before = daily()
        val entry = NativeWire.entry(before, 2000)
        val restored = NativeWire.parseEntry(entry)
        assertEquals("daily:2026-10-04:pt:normal:5", restored.id)
        assertEquals(before.guesses, restored.guesses)
        assertEquals(6, entry.getJSONObject("game").getInt("maxAttempts"))
        assertTrue(entry.getJSONObject("game").isNull("durationSeconds"))
    }
    @Test fun allModesAndLanguagesKeepWebShape() {
        GameEngine.modes.forEach { mode -> listOf("pt", "en").forEach { language ->
            val config = GameConfig(language, mode)
            val game = Game("native-$mode-$language", config, listOf("termo", "torre", "campo", "livro").take(GameEngine.boardCount(mode)), day)
            val wire = NativeWire.entry(game, 2000)
            assertEquals(config, NativeWire.parseEntry(wire).config)
            assertEquals(if (mode == "blitz") 120 else null, wire.getJSONObject("game").opt("durationSeconds").takeUnless { it == JSONObject.NULL })
        } }
    }
    @Test fun impossibleGameOrUnfinishedTerminalResultIsRejected() {
        val entry = NativeWire.entry(daily(), 2000)
        entry.getJSONObject("game").put("status", "won").put("finishedAt", 1500)
        assertThrows(IllegalArgumentException::class.java) { NativeWire.parseEntry(entry) }
        val invalidDate = NativeWire.entry(daily(), 2000).put("day", "2026-02-30")
        assertThrows(java.time.DateTimeException::class.java) { NativeWire.parseEntry(invalidDate) }
    }
    @Test fun validBlitzExpirationRetainsOriginalDeadline() {
        val blitz = daily().copy(id = "blitz-id", config = GameConfig(mode = "blitz"), status = "lost", finishedAt = 121000)
        assertEquals(121000L, NativeWire.parseEntry(NativeWire.entry(blitz, 200000)).finishedAt)
        assertThrows(IllegalArgumentException::class.java) { NativeWire.parseEntry(NativeWire.entry(blitz.copy(finishedAt = 10000), 200000)) }
    }
    @Test fun validationPreservesForeignModesResultsAndConflictSnapshots() {
        val document = NativeWire.empty()
        val won = daily().copy(guesses = listOf("termo"), status = "won", finishedAt = 1500)
        document.getJSONObject("games").put(NativeWire.id(won), NativeWire.entry(won, 2000))
        document.getJSONObject("results").put(NativeWire.id(won), NativeWire.result(won))
        document.put("conflicts", JSONObject().put("future-example", org.json.JSONArray()))
        val before = document.toString(); NativeWire.validateDocument(document)
        assertEquals(before, document.toString())
        assertEquals(1, document.getJSONObject("results").length())
    }
    @Test fun generatedFixtureIsACompleteSyncRequest() {
        val document = NativeWire.empty()
        val value = daily()
        document.getJSONObject("games").put(NativeWire.id(value), NativeWire.entry(value, 1791115200000))
        NativeWire.validateDocument(document)
        val fixture = JSONObject().put("profile", "daniel").put("document", document)
        val out = java.io.File("build/fixtures/native-sync-request.json"); out.parentFile?.mkdirs(); out.writeText(fixture.toString())
        assertEquals("daniel", fixture.getString("profile"))
    }
}
