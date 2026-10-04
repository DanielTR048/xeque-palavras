package com.danieltr048.xeque

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.text.NumberFormat
import java.util.Locale

/** All screens, input, rendering and animations are native Android Views. No browser is embedded. */
class MainActivity : Activity() {
    private val green = Color.rgb(36, 83, 64)
    private val cream = Color.rgb(246, 247, 239)
    private val ink = Color.rgb(39, 65, 47)
    private val muted = Color.rgb(108, 124, 99)
    private val light = Color.rgb(235, 239, 223)
    private val dark = Color.rgb(197, 208, 178)
    private val gold = Color.rgb(174, 143, 65)
    private val gray = Color.rgb(119, 128, 111)
    private lateinit var store: NativeStore
    private lateinit var shell: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var verticalScroll: ScrollView
    private lateinit var boardScroll: HorizontalScrollView
    private lateinit var boardStrip: LinearLayout
    private lateinit var message: TextView
    private lateinit var meta: TextView
    private lateinit var timeLabel: TextView
    private var localized: Context = this
    private var config = GameConfig()
    private var game: Game? = null
    private val words = mutableMapOf<String, List<String>>()
    private val wordSets = mutableMapOf<String, Set<String>>()
    private val common = mutableMapOf<String, Map<Int, List<String>>>()
    private var draft = CharArray(5) { ' ' }
    private var cursor = 0
    private var selectedBoard = 0
    private var generation = 0
    private var restoredDraft: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val draftTiles = mutableListOf<List<TextView>>()
    private val boardViews = mutableListOf<LinearLayout>()
    private val boardTabs = mutableListOf<Button>()
    private val keyViews = mutableMapOf<Char, Button>()
    private var loading = false
    private val ticker = object : Runnable {
        override fun run() {
            val current = game
            if (current != null) {
                if (current.config.mode == "daily" && current.day != GameEngine.day()) loadGame()
                else {
                    val expired = GameEngine.expire(current)
                    if (expired != current) { game = expired; store.save(expired); renderGame(freshResult = true) }
                    else if (::timeLabel.isInitialized) updateMeta()
                }
            }
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = NativeStore(this); config = store.config(); localize()
        restoredDraft = savedInstanceState?.getString("draft")
        cursor = savedInstanceState?.getInt("cursor") ?: 0
        shell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(cream) }
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        shell.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(shell)
        loadDictionaries()
    }
    override fun onResume() { super.onResume(); handler.removeCallbacks(ticker); handler.post(ticker) }
    override fun onPause() { game?.let(store::save); handler.removeCallbacks(ticker); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("draft", String(draft)); outState.putInt("cursor", cursor); super.onSaveInstanceState(outState)
    }
    private fun localize() {
        val settings = Configuration(resources.configuration); settings.setLocale(Locale(config.language))
        localized = createConfigurationContext(settings)
    }
    private fun tr(id: Int, vararg values: Any): String = localized.resources.getString(id, *values)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun title(mode: String) = tr(when (mode) { "daily" -> R.string.daily; "duo" -> R.string.duo; "quartet" -> R.string.quartet; "blitz" -> R.string.blitz; else -> R.string.classic })
    private fun difficulty(value: String) = tr(when (value) { "easy" -> R.string.easy; "hard" -> R.string.hard; else -> R.string.normal })
    private fun piece(mode: String) = when (mode) { "daily" -> "♚"; "duo" -> "♜"; "quartet" -> "♛"; "blitz" -> "♞"; else -> "♟" }
    private fun rounded(color: Int, radius: Int = 12, border: Int? = null) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); border?.let { setStroke(dp(1), it) }
    }
    private fun label(value: String, size: Float = 14f, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun button(value: String, active: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = value; textSize = 12f; isAllCaps = false; minWidth = 0; minimumWidth = 0; minHeight = dp(44); minimumHeight = dp(44)
        setPadding(dp(8), 0, dp(8), 0); setTextColor(if (active) Color.WHITE else green)
        background = RippleDrawable(ColorStateList.valueOf(0x22557744), rounded(if (active) green else light, 9), null)
        setOnClickListener { action() }
    }
    private fun LinearLayout.addWeighted(view: View, height: Int = 44, weight: Float = 1f) {
        addView(view, LinearLayout.LayoutParams(0, dp(height), weight).apply { setMargins(dp(2), dp(2), dp(2), dp(2)) })
    }
    private fun spacer(height: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    private fun card() = column().apply { setPadding(dp(14), dp(12), dp(14), dp(12)); background = rounded(Color.rgb(253, 254, 250), 16, 0xffe0e7d5.toInt()) }

    private fun loadDictionaries() {
        if (loading) return
        loading = true; shell.removeAllViews()
        shell.addView(label("♞  ${tr(R.string.loading)}", 20f).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(-1, -1))
        Thread {
            val result = runCatching {
                val curated = JSONObject(assets.open("dictionaries/common.json").bufferedReader().use { it.readText() })
                for (language in listOf("pt", "en")) {
                    val json = JSONObject(assets.open("dictionaries/$language.json").bufferedReader().use { it.readText() })
                    val array = json.getJSONArray("words")
                    val list = List(array.length()) { array.getString(it) }; require(list.size >= 10000)
                    words[language] = list; wordSets[language] = list.toHashSet()
                    val group = curated.getJSONObject(language)
                    common[language] = (4..8).associateWith { length ->
                        val entries = group.getJSONArray(length.toString()); List(entries.length()) { entries.getString(it) }.filter { it in wordSets.getValue(language) }
                    }
                }
            }
            runOnUiThread {
                if (isDestroyed) return@runOnUiThread
                loading = false
                if (result.isSuccess) loadGame()
                else {
                    shell.removeAllViews(); shell.addView(label(tr(R.string.load_error), 18f).apply { setPadding(dp(24), dp(48), dp(24), dp(24)) })
                    shell.addView(button(tr(R.string.retry)) { loadDictionaries() })
                }
            }
        }.start()
    }
    private fun targetPool(): List<String> = if (config.difficulty == "hard") words.getValue(config.language).filter { it.length == config.length }
        else common.getValue(config.language).getValue(config.length)
    private fun loadGame() {
        generation++; game = store.load(config) ?: GameEngine.create(config, targetPool())
        draft = CharArray(config.length) { ' ' }
        restoredDraft?.takeIf { it.length == config.length && game?.status == "playing" }?.let { draft = it.toCharArray() }
        restoredDraft = null; cursor = cursor.coerceIn(0, config.length); selectedBoard = 0
        store.saveConfig(config); game?.let(store::save); renderGame()
    }
    private fun changeConfig(next: GameConfig) {
        if (next == config) return
        game?.let(store::save); config = next; cursor = 0; localize(); loadGame()
    }
    private fun startNew() {
        if (config.mode == "daily") return
        generation++; game = GameEngine.create(config, targetPool()); draft = CharArray(config.length) { ' ' }; cursor = 0; selectedBoard = 0
        game?.let(store::save); renderGame()
    }
    private fun requestNew() {
        if (game?.status == "playing" && game?.guesses?.isNotEmpty() == true) AlertDialog.Builder(this)
            .setTitle(tr(R.string.restart_title)).setMessage(tr(R.string.restart_text))
            .setNegativeButton(tr(R.string.cancel), null).setPositiveButton(tr(R.string.new_game)) { _, _ -> startNew() }.show()
        else startNew()
    }

    private fun renderGame(revealRow: Int? = null, freshResult: Boolean = false) {
        val current = game ?: return
        val oldScroll = if (::verticalScroll.isInitialized) verticalScroll.scrollY else 0
        shell.removeAllViews(); draftTiles.clear(); boardViews.clear(); boardTabs.clear(); keyViews.clear()
        content = column().apply { setPadding(dp(16), dp(10), dp(16), dp(18)) }
        verticalScroll = ScrollView(this).apply { isFillViewport = false; addView(content) }
        shell.addView(verticalScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val header = row()
        header.addView(label("♞ xeque.", 30f, green, true), LinearLayout.LayoutParams(0, dp(48), 1f))
        listOf("pt", "en").forEach { language -> header.addView(button(language.uppercase(), config.language == language) { changeConfig(config.copy(language = language)) }, LinearLayout.LayoutParams(dp(44), dp(42)).apply { marginStart = dp(4) }) }
        header.addView(button("▥") { showStats() }.apply { contentDescription = tr(R.string.stats) }, LinearLayout.LayoutParams(dp(44), dp(42)).apply { marginStart = dp(4) })
        content.addView(header)
        content.addView(label(tr(R.string.tagline), 22f, green).apply { typeface = Typeface.create("serif", Typeface.NORMAL) })
        content.addView(label(tr(R.string.intro), 11f, muted))
        val modeRow = row()
        GameEngine.modes.forEach { mode -> modeRow.addView(button("${piece(mode)} ${title(mode)}", mode == config.mode) { changeConfig(config.copy(mode = mode)) }, LinearLayout.LayoutParams(-2, dp(44)).apply { marginEnd = dp(6) }) }
        content.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(modeRow) })
        content.addView(spacer(8))
        val controls = row()
        controls.addView(button("♞ ${difficulty(config.difficulty)} ▾") {
            AlertDialog.Builder(this).setTitle(tr(R.string.difficulty)).setSingleChoiceItems(GameEngine.difficulties.map(::difficulty).toTypedArray(), GameEngine.difficulties.indexOf(config.difficulty)) { dialog, index ->
                dialog.dismiss(); changeConfig(config.copy(difficulty = GameEngine.difficulties[index]))
            }.setNegativeButton(tr(R.string.cancel), null).show()
        }.apply { contentDescription = "${tr(R.string.difficulty)}: ${difficulty(config.difficulty)}" }, LinearLayout.LayoutParams(0, dp(44), 1.45f))
        (4..8).forEach { length -> controls.addWeighted(button(length.toString(), config.length == length) { changeConfig(config.copy(length = length)) }.apply { contentDescription = tr(R.string.letters, length) }, weight = 0.48f) }
        content.addView(controls); content.addView(spacer(10))
        val gameCard = card(); content.addView(gameCard)
        val cardHeader = row()
        cardHeader.addView(label("${piece(config.mode)}  ${title(config.mode)}", 19f, green, true), LinearLayout.LayoutParams(0, -2, 1f))
        timeLabel = label(if (config.mode == "daily") current.day else tr(R.string.letters, config.length), 11f, muted)
        cardHeader.addView(timeLabel); gameCard.addView(cardHeader)
        meta = label("", 11f, muted); gameCard.addView(meta); updateMeta()
        if (current.targets.size > 1) {
            gameCard.addView(label(tr(R.string.multiple_hint, current.targets.size), 11f, muted))
            val tabs = row()
            current.targets.indices.forEach { board ->
                val tab = button("${board + 1}${if (current.solved(board)) " ✓" else ""}", board == selectedBoard) { selectBoard(board) }
                tab.contentDescription = tr(R.string.go_board, board + 1); tabs.addWeighted(tab, 40); boardTabs.add(tab)
            }
            gameCard.addView(tabs)
        }
        boardStrip = row().apply { gravity = Gravity.TOP }
        boardScroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = current.targets.size > 1; addView(boardStrip) }
        gameCard.addView(boardScroll, LinearLayout.LayoutParams(-1, -2))
        val available = (resources.displayMetrics.widthPixels / resources.displayMetrics.density).toInt() - 62
        val boardWidth = if (current.targets.size == 1) available.coerceIn(230, 500) else if (config.length >= 7) 288 else 250
        var activeRow: View? = null
        current.targets.forEachIndexed { boardIndex, target ->
            val board = column().apply { setPadding(dp(4), dp(5), dp(4), dp(5)); background = rounded(if (boardIndex == selectedBoard && current.targets.size > 1) 0xfff0f4e7.toInt() else Color.TRANSPARENT, 10) }
            boardViews.add(board)
            boardStrip.addView(board, LinearLayout.LayoutParams(dp(boardWidth), -2).apply { if (boardIndex < current.targets.lastIndex) marginEnd = dp(12) })
            if (current.targets.size > 1) board.addView(label("${tr(R.string.board, boardIndex + 1)}${if (current.solved(boardIndex)) "  ✓" else ""}", 11f, green, true).apply { gravity = Gravity.CENTER; setOnClickListener { selectBoard(boardIndex) } })
            val files = row(); repeat(config.length) { index -> files.addWeighted(label(('a' + index).toString(), 10f, muted).apply { gravity = Gravity.CENTER }, 21) }; board.addView(files)
            val tileSize = ((boardWidth - 8) / config.length - 4).coerceAtLeast(22)
            var activeTiles: List<TextView> = emptyList()
            val solvedAt = current.guesses.indexOf(target)
            repeat(current.maxAttempts) { rowIndex ->
                val submitted = current.guesses.getOrNull(rowIndex)
                val pastSolve = solvedAt >= 0 && rowIndex > solvedAt
                val states = if (submitted != null && !pastSolve) GameEngine.evaluate(submitted, target) else null
                val isCurrent = rowIndex == current.guesses.size && !current.solved(boardIndex) && current.status == "playing"
                val cells = row(); val tiles = mutableListOf<TextView>()
                repeat(config.length) { index ->
                    val letter = if (pastSolve) ' ' else submitted?.get(index) ?: if (isCurrent) draft[index] else ' '
                    val state = states?.get(index)
                    val tile = label(letter.toString().uppercase(), (tileSize * 0.49f).coerceIn(13f, 29f), if (state == null) ink else Color.WHITE, true).apply {
                        gravity = Gravity.CENTER; setPadding(0, 0, 0, 0)
                        background = tileBackground(state, rowIndex, index, isCurrent && index == cursor)
                        contentDescription = tr(R.string.tile_description, rowIndex + 1, index + 1, if (letter == ' ') "—" else letter.toString().uppercase()) + if (state != null) ", ${stateLabel(state)}" else ""
                        if (isCurrent) setOnClickListener { cursor = index; selectBoard(boardIndex); updateDraft() }
                        if (store.contrast && state != null) text = "${letter.uppercaseChar()}${stateSymbol(state)}"
                    }
                    cells.addWeighted(tile, tileSize); tiles.add(tile)
                    if (revealRow == rowIndex && state != null && ValueAnimator.areAnimatorsEnabled()) {
                        tile.rotationX = 85f; tile.alpha = 0.3f
                        tile.animate().rotationX(0f).alpha(1f).setStartDelay(index * 65L).setDuration(260).start()
                    }
                }
                board.addView(cells)
                if (isCurrent) { activeTiles = tiles; if (activeRow == null) activeRow = cells }
                if (revealRow == rowIndex && solvedAt == rowIndex && ValueAnimator.areAnimatorsEnabled()) {
                    val currentGeneration = generation
                    handler.postDelayed({ if (generation == currentGeneration) ObjectAnimator.ofFloat(board, "translationY", 0f, -dp(8).toFloat(), 0f, -dp(3).toFloat(), 0f).apply { duration = 430; start() } }, config.length * 65L + 200)
                }
            }
            draftTiles.add(activeTiles)
        }
        if (current.status != "playing") addResult(gameCard, current, freshResult, revealRow != null)
        val legend = row()
        listOf(LetterState.CORRECT, LetterState.PRESENT, LetterState.ABSENT).forEach { state -> legend.addView(label("● ${stateLabel(state)}", 9f, stateColor(state)), LinearLayout.LayoutParams(0, -2, 1f)) }
        gameCard.addView(spacer(8)); gameCard.addView(legend)
        val actionRow = row()
        actionRow.addWeighted(button("? ${tr(R.string.help)}") { showHelp() })
        if (config.mode != "daily") actionRow.addWeighted(button(tr(R.string.new_game)) { requestNew() })
        content.addView(spacer(10)); content.addView(actionRow)
        content.addView(button(tr(R.string.preferences)) { showPreferences() }, LinearLayout.LayoutParams(-1, dp(44)))
        val format = NumberFormat.getIntegerInstance(Locale(config.language))
        content.addView(button(tr(R.string.dictionary, format.format(words.getValue("pt").size), format.format(words.getValue("en").size))) { showSources() }.apply { textSize = 10f }, LinearLayout.LayoutParams(-1, dp(44)))
        content.addView(label(tr(R.string.saved), 10f, muted).apply { gravity = Gravity.CENTER })
        if (current.status == "playing") addKeyboard(current)
        verticalScroll.post {
            if (freshResult) verticalScroll.smoothScrollTo(0, content.height)
            else {
                verticalScroll.scrollTo(0, oldScroll)
                activeRow?.let { row ->
                    val bounds = android.graphics.Rect()
                    row.getDrawingRect(bounds); content.offsetDescendantRectToMyCoords(row, bounds)
                    val bottom = verticalScroll.scrollY + verticalScroll.height
                    if (bounds.bottom + dp(16) > bottom) verticalScroll.smoothScrollTo(0, bounds.bottom + dp(16) - verticalScroll.height)
                    else if (bounds.top < verticalScroll.scrollY) verticalScroll.smoothScrollTo(0, bounds.top)
                }
            }
        }
        boardScroll.post { boardScroll.scrollTo(boardViews.getOrNull(selectedBoard)?.left ?: 0, 0) }
    }

    private fun stateColor(state: LetterState): Int = when (state) {
        LetterState.CORRECT -> if (store.contrast) Color.rgb(0, 89, 140) else green
        LetterState.PRESENT -> if (store.contrast) Color.rgb(184, 88, 0) else gold
        LetterState.ABSENT -> gray
    }
    private fun stateLabel(state: LetterState) = tr(when (state) { LetterState.CORRECT -> R.string.correct; LetterState.PRESENT -> R.string.present; LetterState.ABSENT -> R.string.absent })
    private fun stateSymbol(state: LetterState) = when (state) { LetterState.CORRECT -> "✓"; LetterState.PRESENT -> "•"; LetterState.ABSENT -> "×" }
    private fun tileBackground(state: LetterState?, row: Int, column: Int, active: Boolean) = rounded(state?.let(::stateColor) ?: if ((row + column) % 2 == 0) light else dark, 5, if (active) green else null)
    private fun addKeyboard(current: Game) {
        val keyboard = column().apply { setPadding(dp(6), dp(4), dp(6), dp(8)); setBackgroundColor(cream) }
        message = label(if (config.mode == "blitz" && current.startedAt == null) tr(R.string.clock_hint) else if (current.targets.size > 1) tr(R.string.keyboard_hint) else tr(R.string.ready), 10f, muted).apply {
            gravity = Gravity.CENTER; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        keyboard.addView(message)
        listOf("qwertyuiop", "asdfghjkl", "zxcvbnm").forEachIndexed { index, letters ->
            val keys = row(); if (index == 1) keys.setPadding(dp(14), 0, dp(14), 0)
            if (index == 2) keys.addWeighted(button(tr(R.string.enter), true) { submit() }.apply { textSize = 9f }, weight = 1.65f)
            letters.forEach { letter ->
                val key = button(letter.uppercase()) { input(letter) }.apply { textSize = 14f; setPadding(0, 0, 0, 0) }
                keyViews[letter] = key; keys.addWeighted(key)
            }
            if (index == 2) keys.addWeighted(button("⌫") { erase() }.apply { contentDescription = tr(R.string.delete); textSize = 20f }, weight = 1.4f)
            keyboard.addView(keys)
        }
        shell.addView(keyboard, LinearLayout.LayoutParams(-1, -2)); updateKeyboard()
    }
    private fun updateKeyboard() {
        val current = game ?: return
        val hints = GameEngine.keyboard(current, selectedBoard)
        keyViews.forEach { (letter, key) ->
            val state = hints[letter]
            key.background = RippleDrawable(ColorStateList.valueOf(0x22557744), rounded(state?.let(::stateColor) ?: light, 6), null)
            key.setTextColor(if (state != null) Color.WHITE else ink)
            key.contentDescription = letter.uppercase() + if (state != null) ", ${stateLabel(state)}" else ""
        }
    }
    private fun selectBoard(index: Int) {
        selectedBoard = index; updateKeyboard()
        boardViews.forEachIndexed { board, view -> view.background = rounded(if (board == index && boardViews.size > 1) 0xfff0f4e7.toInt() else Color.TRANSPARENT, 10) }
        boardTabs.forEachIndexed { board, tab -> tab.background = rounded(if (board == index) green else light, 9); tab.setTextColor(if (board == index) Color.WHITE else green) }
        boardScroll.smoothScrollTo(boardViews.getOrNull(index)?.left ?: 0, 0)
    }
    private fun updateMeta() {
        val current = game ?: return
        if (!::meta.isInitialized) return
        meta.text = tr(R.string.attempts, minOf(current.guesses.size + if (current.status == "playing") 1 else 0, current.maxAttempts).coerceAtLeast(1), current.maxAttempts)
        if (config.mode == "blitz") {
            val seconds = GameEngine.remaining(current) ?: 120
            timeLabel.text = String.format(Locale.ROOT, "◷ %02d:%02d", seconds / 60, seconds % 60)
            timeLabel.setTextColor(if (seconds < 30) Color.rgb(160, 58, 49) else green)
        }
    }
    private fun input(letter: Char) {
        if (game?.status != "playing" || cursor >= config.length) return
        val index = cursor; draft[index] = letter; cursor = minOf(config.length, cursor + 1); updateDraft()
        if (ValueAnimator.areAnimatorsEnabled()) draftTiles.forEach { tiles -> tiles.getOrNull(index)?.let { tile ->
            tile.animate().cancel(); tile.scaleX = 1.12f; tile.scaleY = 1.12f
            tile.animate().scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(130).start()
        } }
    }
    private fun erase() {
        if (game?.status != "playing") return
        val index = if (cursor >= config.length || draft[cursor] == ' ') maxOf(0, cursor - 1) else cursor
        draft[index] = ' '; cursor = index; updateDraft()
    }
    private fun updateDraft() {
        val current = game ?: return
        draftTiles.forEach { tiles -> tiles.forEachIndexed { index, tile ->
            tile.text = draft[index].toString().uppercase(); tile.background = tileBackground(null, current.guesses.size, index, index == cursor)
            tile.contentDescription = tr(R.string.tile_description, current.guesses.size + 1, index + 1, if (draft[index] == ' ') "—" else draft[index].toString().uppercase())
        } }
        if (::message.isInitialized) { message.setTextColor(muted); message.text = if (current.targets.size > 1) tr(R.string.keyboard_hint) else "" }
    }
    private fun submit() {
        val current = game ?: return
        if (current.status != "playing") return
        val result = GameEngine.submit(current, String(draft), wordSets.getValue(config.language))
        if (result.error != null) {
            if (result.game != current) { game = result.game; store.save(result.game); renderGame(freshResult = true); return }
            message.text = tr(when (result.error) { "unknown" -> R.string.unknown_error; "duplicate" -> R.string.duplicate_error; else -> R.string.length_error })
            message.setTextColor(Color.rgb(155, 62, 45)); message.announceForAccessibility(message.text)
            if (ValueAnimator.areAnimatorsEnabled()) boardViews.forEach { board -> ObjectAnimator.ofFloat(board, "translationX", 0f, -dp(5).toFloat(), dp(5).toFloat(), -dp(4).toFloat(), dp(4).toFloat(), 0f).apply { duration = 330; start() } }
            return
        }
        game = result.game; store.save(result.game); draft = CharArray(config.length) { ' ' }; cursor = 0
        if (result.game.solved(selectedBoard)) selectedBoard = result.game.targets.indices.firstOrNull { !result.game.solved(it) } ?: selectedBoard
        renderGame(revealRow = current.guesses.size, freshResult = result.game.status != "playing")
    }
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (game?.status == "playing" && !loading) {
            val keyCode = event.keyCode
            val letter = GameEngine.normalize(event.unicodeChar.toChar().toString())
            val isLetter = letter.length == 1 && !event.isCtrlPressed && !event.isAltPressed
            val isGameKey = keyCode in listOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DEL, KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT)
            // Buttons consume Enter before onKeyUp; handle both phases at the activity boundary.
            if ((isLetter || isGameKey) && event.action == KeyEvent.ACTION_DOWN) return true
            if (event.action != KeyEvent.ACTION_UP) return super.dispatchKeyEvent(event)
            if (keyCode == KeyEvent.KEYCODE_ENTER) { submit(); return true }
            if (keyCode == KeyEvent.KEYCODE_DEL) { erase(); return true }
            if (keyCode == KeyEvent.KEYCODE_DPAD_LEFT) { cursor = maxOf(0, cursor - 1); updateDraft(); return true }
            if (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) { cursor = minOf(config.length - 1, cursor + 1); updateDraft(); return true }
            if (isLetter) { input(letter[0]); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun addResult(parent: LinearLayout, current: Game, fresh: Boolean, reveal: Boolean) {
        parent.addView(spacer(12))
        val frame = FrameLayout(this)
        val result = column().apply { gravity = Gravity.CENTER; setPadding(dp(10), dp(18), dp(10), dp(14)); background = rounded(light, 12) }
        result.addView(label(if (current.status == "won") "♚ ${tr(R.string.won)}" else "♞ ${tr(R.string.lost)}", 27f, green).apply { typeface = Typeface.create("serif", Typeface.NORMAL); gravity = Gravity.CENTER })
        result.addView(label(tr(if (current.status == "won") R.string.won_text else R.string.lost_text), 12f, muted).apply { gravity = Gravity.CENTER })
        result.addView(label(current.targets.joinToString("  ·  ") { it.uppercase() }, 17f, green, true).apply { gravity = Gravity.CENTER })
        result.addView(button(tr(R.string.share)) { share(current) }, LinearLayout.LayoutParams(-1, dp(44)))
        if (config.mode == "daily") result.addView(label(tr(R.string.next_daily), 12f, muted).apply { gravity = Gravity.CENTER })
        else result.addView(button(tr(R.string.new_game), true) { startNew() }, LinearLayout.LayoutParams(-1, dp(44)))
        frame.addView(result); parent.addView(frame, LinearLayout.LayoutParams(-1, -2))
        if (fresh && ValueAnimator.areAnimatorsEnabled()) {
            val delay = if (reveal) config.length * 65L + 260 else 0L
            result.alpha = 0f; result.translationY = dp(8).toFloat()
            result.animate().alpha(1f).translationY(0f).setStartDelay(delay).setDuration(300).start()
            if (current.status == "won") {
                val confetti = ConfettiView(this); confetti.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                frame.addView(confetti, FrameLayout.LayoutParams(-1, -1)); confetti.start(delay)
            }
        }
    }
    private fun share(current: Game) {
        val symbols = mapOf(LetterState.CORRECT to "🟩", LetterState.PRESENT to "🟨", LetterState.ABSENT to "⬛")
        val boards = current.targets.mapIndexed { index, target ->
            val solvedAt = current.guesses.indexOf(target)
            val guesses = if (solvedAt >= 0) current.guesses.take(solvedAt + 1) else current.guesses
            (if (current.targets.size > 1) "${tr(R.string.board, index + 1)}\n" else "") + guesses.joinToString("\n") { GameEngine.evaluate(it, target).joinToString("") { state -> symbols.getValue(state) } }
        }.joinToString("\n\n")
        val text = "♞ XEQUE · ${title(config.mode)} · ${config.language.uppercase()}\n${if (config.mode == "daily") current.day + " · " else ""}${tr(R.string.letters, config.length)} · ${difficulty(config.difficulty)} · ${if (current.status == "won") current.guesses.size else "X"}/${current.maxAttempts}\n\n$boards"
        startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, tr(R.string.share)))
    }
    private fun showStats() {
        val stats = store.stats(config.language)
        val percentage = if (stats.played == 0) 0 else stats.won * 100 / stats.played
        val text = "${tr(R.string.played)}: ${stats.played}\n${tr(R.string.wins)}: ${stats.won}\n${tr(R.string.win_rate)}: $percentage%\n${tr(R.string.streak)}: ${stats.streak}\n${tr(R.string.best)}: ${stats.best}\n\n${tr(R.string.stats_note)}"
        AlertDialog.Builder(this).setTitle("▥ ${tr(R.string.stats)}").setMessage(text).setPositiveButton(tr(R.string.close), null).show()
    }
    private fun showHelp() { AlertDialog.Builder(this).setTitle("♞ ${tr(R.string.help)}").setMessage(tr(R.string.help_text)).setPositiveButton(tr(R.string.close), null).show() }
    private fun showPreferences() {
        AlertDialog.Builder(this).setTitle(tr(R.string.preferences)).setMultiChoiceItems(arrayOf(tr(R.string.contrast)), booleanArrayOf(store.contrast)) { _, _, checked -> store.contrast = checked; renderGame() }
            .setPositiveButton(tr(R.string.close), null).setNeutralButton(tr(R.string.sources)) { _, _ -> showSources() }.show()
    }
    private fun showSources() {
        val names = arrayOf("Português — MIT", "English — SCOWL", "Kotlin — Apache 2.0")
        AlertDialog.Builder(this).setTitle(tr(R.string.sources)).setMessage(tr(R.string.source_text))
            .setPositiveButton(tr(R.string.close), null).setNeutralButton("Licenses") { _, _ ->
                AlertDialog.Builder(this).setTitle(tr(R.string.sources)).setItems(names) { _, index ->
                    val file = listOf("LICENSE-pt.txt", "LICENSE-en.txt", "LICENSE-Kotlin.txt")[index]
                    val license = runCatching { assets.open("licenses/$file").bufferedReader().use { it.readText() } }.getOrDefault(tr(R.string.no_license))
                    AlertDialog.Builder(this).setTitle(names[index]).setMessage(license).setPositiveButton(tr(R.string.close), null).show()
                }.setNegativeButton(tr(R.string.close), null).show()
            }.show()
    }
}

private class ConfettiView(context: Context) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var progress = 0f
    private var animator: ValueAnimator? = null
    private val palette = intArrayOf(0xff245340.toInt(), 0xffb79950.toInt(), 0xff8da974.toInt(), 0xffc9d6b2.toInt())
    fun start(delay: Long) {
        animator = ValueAnimator.ofFloat(0f, 1f).apply { duration = 2100; startDelay = delay; interpolator = DecelerateInterpolator()
            addUpdateListener { progress = it.animatedValue as Float; invalidate() }; start() }
    }
    override fun onDetachedFromWindow() { animator?.cancel(); super.onDetachedFromWindow() }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (progress <= 0f || progress >= 1f) return
        val density = resources.displayMetrics.density
        repeat(26) { index ->
            paint.color = palette[index % palette.size]; paint.alpha = ((1f - progress) * 230).toInt()
            val x = ((index * 47 % 100) / 100f) * width + kotlin.math.sin(index + progress * 5f) * 12f * density
            val y = -12f * density + progress * (height + 24f * density) + (index % 5) * 9f * density
            canvas.save(); canvas.rotate(index * 23f + progress * 200f, x, y)
            canvas.drawRoundRect(x, y, x + 4f * density, y + 8f * density, density, density, paint); canvas.restore()
        }
    }
}
