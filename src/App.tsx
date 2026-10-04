import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Delete, Download, Flame, Globe2, Grid2X2, Infinity as InfinityIcon, Lightbulb, RotateCcw, Settings2, Share2, Trophy, Users, X } from 'lucide-react';
import { createGame, evaluateGuess, expireGame, getBoardCount, getDailyKey, getKeyboardStates, getMaxAttempts, getRemainingSeconds, isBoardSolved, normalizeWord, submitGuess, type Difficulty, type GameConfig, type GameState, type Language, type Mode } from './game/engine';
import { createProfileStorage, isStorageAvailable, type ProfileStorage } from './game/storage';
import { COMMON_WORDS } from './data/common-words';
import { translations } from './i18n';
import { useGameMotion } from './game/useGameMotion';
import { ProfileChooser } from './profiles/ProfileChooser';
import { ConnectPage } from './profiles/ConnectPage';
import { profileName, type ProfileId } from './profiles/profiles';
import { useProfileSync, type ProfileSync } from './profiles/useProfileSync';
import { SyncIndicator, SyncPanel } from './profiles/SyncPanel';

type Dictionary = { language: Language; words: string[]; count: number; byLength: Record<string, number>; source: string };
type Modal = 'help' | 'settings' | 'restart' | 'sources' | null;
const modeOrder: Mode[] = ['classic', 'daily', 'duo', 'quartet', 'blitz'];
const chessPieces: Record<Mode, string> = { classic: '♟', daily: '♚', duo: '♜', quartet: '♛', blitz: '♞' };
const dictionaryCache = new Map<Language, Dictionary>();
const alphabet = 'abcdefghijklmnopqrstuvwxyz';

function Knight({ className = '' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 72" fill="none" aria-hidden="true"><path d="m24 9 7 7 13 5 6 10-3 10-13 8-1 9H17l3-16 10-12-11 7-11-2-1-8L24 9Z" fill="currentColor"/><path d="m24 9-1-7 11 12M15 62h26l4 7H11l4-7Z" fill="currentColor"/><circle cx="22" cy="24" r="2" fill="var(--knight-eye, #f7f5ef)"/><path d="m38 29 1 8-10 9" stroke="var(--knight-eye, #f7f5ef)" strokeWidth="2" strokeLinecap="round"/></svg>;
}

function playTone(won: boolean) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = won ? 660 : 440;
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => { void context.close(); };
  } catch { /* Sound is optional when audio is unavailable. */ }
}

export default function App() {
  if (window.location.pathname.replace(/\/$/, '') === '/connect') return <ConnectPage />;
  return <ProfileApp />;
}

function ProfileApp() {
  const [profile, setProfile] = useState<ProfileId | null>(null);
  const stores = useMemo(() => ({ daniel: createProfileStorage('daniel'), larissa: createProfileStorage('larissa') }), []);
  // Both queues stay alive when switching profiles, so Daniel's last move still uploads while Larissa plays.
  const danielSync = useProfileSync(stores.daniel);
  const larissaSync = useProfileSync(stores.larissa);
  return profile ? <GameApp key={profile} profile={profile} storage={stores[profile]} sync={profile === 'daniel' ? danielSync : larissaSync} onSwitchProfile={() => setProfile(null)} /> : <ProfileChooser onSelect={setProfile} />;
}

function GameApp({ profile, storage, sync, onSwitchProfile }: { profile: ProfileId; storage: ProfileStorage; sync: ProfileSync; onSwitchProfile: () => void }) {
  const { loadConfig, saveConfig, loadGame, saveGame, loadPreferences, savePreferences, getStats, getHistory, recordResult } = storage;
  const [config, setConfig] = useState<GameConfig>(loadConfig);
  const [game, setGame] = useState<GameState | null>(null);
  const [dictionary, setDictionary] = useState<Dictionary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [draft, setDraft] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selectedBoard, setSelectedBoard] = useState(0);
  const [page, setPage] = useState<'play' | 'stats'>('play');
  const [modal, setModal] = useState<Modal>(null);
  const [preferences, setPreferences] = useState(loadPreferences);
  const [storageAvailable, setStorageAvailable] = useState(isStorageAvailable);
  const [toast, setToast] = useState('');
  const [shareFallback, setShareFallback] = useState('');
  const [now, setNow] = useState(Date.now);
  const [statsVersion, setStatsVersion] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const boardsViewportRef = useRef<HTMLDivElement>(null);
  const motion = useGameMotion(game?.id);
  const t = translations[config.language];
  const dailyKey = getDailyKey(new Date(now));
  const validWords = useMemo(() => new Set(dictionary?.words ?? []), [dictionary]);
  const stats = useMemo(() => getStats(config.language), [config.language, statsVersion]);
  const history = useMemo(() => getHistory(config.language), [config.language, statsVersion]);
  const gameRef = useRef(game);
  const configRef = useRef(config);
  const loadedSlotRef = useRef('');
  gameRef.current = game;
  configRef.current = config;

  useEffect(() => storage.subscribe(source => {
    if (source !== 'remote') return;
    const nextConfig = storage.loadConfig();
    setPreferences(previous => {
      const next = storage.loadPreferences();
      return previous.highContrast === next.highContrast && previous.sound === next.sound ? previous : next;
    });
    setStatsVersion(value => value + 1);
    if (JSON.stringify(nextConfig) !== JSON.stringify(configRef.current)) {
      setConfig(nextConfig); setGame(null); return;
    }
    const incoming = storage.loadGame(nextConfig);
    const current = gameRef.current;
    if (!incoming || JSON.stringify(incoming) === JSON.stringify(current)) return;
    const boardChanged = !current || JSON.stringify(incoming.guesses) !== JSON.stringify(current.guesses) || JSON.stringify(incoming.targets) !== JSON.stringify(current.targets) || incoming.status !== current.status;
    setGame(expireGame(incoming));
    if (boardChanged) { setDraft(Array(nextConfig.length).fill('')); setCursor(0); setSelectedBoard(0); setShareFallback(''); }
  }), [storage]);

  useEffect(() => {
    document.documentElement.lang = config.language === 'pt' ? 'pt-BR' : 'en';
    document.title = config.language === 'pt' ? 'Xeque — cada palavra, uma jogada' : 'Xeque — every word, a new move';
    saveConfig(config);
  }, [config]);
  useEffect(() => { savePreferences(preferences); }, [preferences]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    setDictionary(null); setLoadError(false);
    const cached = dictionaryCache.get(config.language);
    if (cached) { setDictionary(cached); return; }
    fetch(`${import.meta.env.BASE_URL}dictionaries/${config.language}.json`)
      .then(response => { if (!response.ok) throw new Error('Dictionary unavailable'); return response.json() as Promise<Dictionary>; })
      .then(data => {
        if (data.language !== config.language || !Array.isArray(data.words) || data.words.length < 10000) throw new Error('Invalid dictionary');
        dictionaryCache.set(config.language, data); if (active) setDictionary(data);
      }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [config.language, loadVersion]);

  const targetPool = useMemo(() => {
    if (!dictionary || dictionary.language !== config.language) return [];
    const common = COMMON_WORDS[config.language][config.length].filter(word => validWords.has(word));
    return config.difficulty === 'hard' ? dictionary.words.filter(word => word.length === config.length) : common;
  }, [dictionary, config.language, config.length, config.difficulty, validWords]);

  useEffect(() => {
    if (!targetPool.length) return;
    const slot = `${JSON.stringify(config)}:${config.mode === 'daily' ? dailyKey : ''}`;
    if (loadedSlotRef.current === slot && gameRef.current) return;
    const saved = loadGame(config);
    if (!saved && !sync.ready) return;
    loadedSlotRef.current = slot;
    setGame(saved ? expireGame(saved) : createGame(config, targetPool));
    setDraft(Array(config.length).fill('')); setCursor(0); setSelectedBoard(0); setShareFallback('');
  }, [config, targetPool, config.mode === 'daily' ? dailyKey : '', sync.ready]);

  useEffect(() => {
    if (!game) return;
    saveGame(game);
    setStorageAvailable(isStorageAvailable());
    if (game.status !== 'playing') { recordResult(game); setStatsVersion(value => value + 1); }
  }, [game]);
  useEffect(() => {
    if (game?.status === 'playing' && game.config.mode === 'blitz' && getRemainingSeconds(game, now) === 0) {
      setGame(expireGame(game, now)); motion.finish(game.id);
    }
  }, [now, game, motion.finish]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      if (event.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>('button, a[href], select, textarea, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [modal]);

  const changeConfig = (patch: Partial<GameConfig>) => {
    const next = { ...config, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(config)) { setGame(null); setConfig(next); setToast(''); }
    setPage('play');
  };
  const startNewGame = () => {
    if (!targetPool.length || config.mode === 'daily') return;
    setGame(createGame(config, targetPool)); setDraft(Array(config.length).fill('')); setCursor(0); setSelectedBoard(0); setShareFallback(''); setModal(null);
  };
  const selectBoard = useCallback((index: number) => {
    setSelectedBoard(index);
    if (config.mode !== 'quartet') return;
    const viewport = boardsViewportRef.current;
    const board = viewport?.querySelector<HTMLElement>(`[data-board-index="${index}"]`);
    if (!viewport || !board) return;
    const left = viewport.scrollLeft + board.getBoundingClientRect().left - viewport.getBoundingClientRect().left - 16;
    viewport.scrollTo({ left, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [config.mode]);
  const handleKey = useCallback((key: string) => {
    if (!game || game.status !== 'playing' || modal || page !== 'play' || !dictionary) return;
    if (key === 'Enter') {
      if (draft.some(letter => !letter) || draft.length !== config.length) { setToast(t.lengthError); motion.reject(game.guesses.length); return; }
      const result = submitGuess(game, draft.join(''), validWords);
      if (result.error) {
        if (result.game !== game) { setGame(result.game); if (result.game.status !== 'playing') motion.finish(game.id); }
        setToast(result.error === 'unknown' ? t.unknownError : result.error === 'duplicate' ? t.duplicateError : result.error === 'length' ? t.lengthError : '');
        if (result.error !== 'finished') motion.reject(game.guesses.length);
        return;
      }
      const newlySolved = game.targets.flatMap((_, index) => !isBoardSolved(game, index) && isBoardSolved(result.game, index) ? [index] : []);
      motion.reveal(result.game, newlySolved);
      setGame(result.game); setDraft(Array(config.length).fill('')); setCursor(0); setToast('');
      const nextBoard = result.game.targets.findIndex((_, index) => !isBoardSolved(result.game, index));
      if (isBoardSolved(result.game, selectedBoard) && nextBoard >= 0) selectBoard(nextBoard);
      if (preferences.sound) playTone(result.game.status === 'won');
    } else if (key === 'Backspace' || key === 'Delete') {
      const position = cursor >= config.length || !draft[cursor] ? Math.max(0, cursor - 1) : cursor;
      motion.press('Backspace'); setToast('');
      setDraft(previous => previous.map((letter, index) => index === position ? '' : letter)); setCursor(position);
    } else if (key === 'ArrowLeft') setCursor(position => Math.max(0, position - 1));
    else if (key === 'ArrowRight') setCursor(position => Math.min(config.length - 1, position + 1));
    else {
      const letter = normalizeWord(key);
      if (letter.length !== 1 || !alphabet.includes(letter) || cursor >= config.length) return;
      motion.press(letter, cursor); setToast('');
      setDraft(previous => previous.map((value, index) => index === cursor ? letter : value));
      setCursor(position => Math.min(config.length, position + 1));
    }
  }, [game, modal, page, dictionary, draft, config.length, validWords, t, cursor, preferences.sound, selectedBoard, selectBoard, motion.press, motion.reject, motion.reveal, motion.finish]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return;
      if (modal || page !== 'play') return;
      if (['Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(event.key) || /^[a-zA-ZÀ-ÿ]$/.test(event.key)) {
        if (event.key === 'Enter' && !draft.some(Boolean) && (event.target as HTMLElement).closest('button') && !(event.target as HTMLElement).closest('.keyboard, .word-board')) return;
        event.preventDefault(); handleKey(event.key);
      }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [handleKey, modal, page, draft]);

  const shareResult = async () => {
    if (!game || game.status === 'playing') return;
    const symbols = { correct: '🟩', present: '🟨', absent: '⬛' };
    const grids = game.targets.map((target, index) => {
      const solvedAt = game.guesses.indexOf(target);
      const guesses = solvedAt >= 0 ? game.guesses.slice(0, solvedAt + 1) : game.guesses;
      return `${game.targets.length > 1 ? `${t.board} ${index + 1}\n` : ''}${guesses.map(guess => evaluateGuess(guess, target).map(state => symbols[state]).join('')).join('\n')}`;
    }).join('\n\n');
    const text = `♞ XEQUE · ${t[config.mode]} · ${config.language.toUpperCase()}\n${config.mode === 'daily' ? `${dailyKey} · ` : ''}${config.length} ${t.letters} · ${t[config.difficulty]} · ${game.status === 'won' ? game.guesses.length : 'X'}/${game.maxAttempts}\n\n${grids}`;
    try { await navigator.clipboard.writeText(text); setToast(t.copied); }
    catch { setShareFallback(text); setToast(t.copyError); }
  };

  const remaining = game ? getRemainingSeconds(game, now) : null;
  const keyboardStates = game ? getKeyboardStates(game, selectedBoard) : {};
  const modeDescription = t[`${config.mode}Desc` as keyof typeof t];
  const boardCount = getBoardCount(config.mode);
  const solvedCount = game?.targets.filter((_, index) => isBoardSolved(game, index)).length ?? 0;
  const isRevealing = motion.moves.some(move => move.phase === 'reveal');
  const settledMove = [...motion.moves].reverse().find(move => move.phase === 'settled');
  const statusLabels = { correct: t.correct, present: t.present, absent: t.absent };
  const modeButton = (mode: Mode) => <button key={mode} className={`mode-button ${config.mode === mode && page === 'play' ? 'active' : ''}`} onClick={() => changeConfig({ mode })} aria-pressed={config.mode === mode && page === 'play'}><span className="mode-piece">{chessPieces[mode]}</span><span>{t[mode]}{mode === 'daily' && <span className="daily-dot" />}</span>{config.mode === mode && page === 'play' && <ChevronRight size={15} />}</button>;

  return <div className={`app ${preferences.highContrast ? 'high-contrast' : ''}`}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('play'); }} aria-label="Xeque"><Knight /><span>xeque<span className="brand-dot">.</span><small>WORD CHESS CLUB</small></span></a>
      <div className="sidebar-section-label">{t.modes}</div>
      <nav className="mode-nav" aria-label={t.modes}>{modeOrder.map(modeButton)}</nav>
      <div className="sidebar-divider" />
      <button className={`sidebar-link ${page === 'stats' ? 'selected' : ''}`} onClick={() => setPage('stats')}><BarChart3 size={19} />{t.stats}</button>
      <button className="sidebar-link" onClick={() => setModal('help')}><CircleHelp size={19} />{t.how}</button>
      <div className="sidebar-bottom"><a className="android-download sidebar-download" href="https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk" title={t.androidOffline}><Download size={17} /><span>{t.androidDownload}<small>{t.androidOffline}</small></span></a>
        <div className="club-card"><span className="club-label">THE WORD CHESS CLUB</span><Knight /><p>{t.tagline}</p><div className="mini-checker" /></div>
        <span className="sidebar-footnote"><span className="online-dot" />{t.footer}</span>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><a className="mobile-brand" href="#" onClick={event => { event.preventDefault(); setPage('play'); }}>xeque<span>.</span></a><span className="desktop-play">{t.play}</span><ChevronRight size={13} /><strong>{page === 'stats' ? t.stats : t[config.mode]}</strong></div><div className="top-actions"><button className="profile-current" onClick={onSwitchProfile} aria-label={`${config.language === 'pt' ? 'Trocar perfil' : 'Switch profile'}: ${profileName(profile)}`}><span className={`profile-mini-avatar ${profile === 'larissa' ? 'rose' : ''}`} aria-hidden="true">{profile === 'daniel' ? '♞' : '♛'}</span><span className="profile-current-name">{profileName(profile)}</span><Users size={13} /></button><div className="language-switch" aria-label={t.language}><Globe2 size={15} />{(['pt', 'en'] as Language[]).map(language => <button key={language} onClick={() => changeConfig({ language })} className={config.language === language ? 'active' : ''} aria-pressed={config.language === language}>{language.toUpperCase()}</button>)}</div><span className="action-divider" /><button className="icon-button mobile-stats" aria-label={t.stats} onClick={() => setPage('stats')}><BarChart3 size={20} /></button><button className="icon-button" aria-label={t.how} onClick={() => setModal('help')}><CircleHelp size={20} /></button><button className="icon-button" aria-label={t.settings} onClick={() => setModal('settings')}><Settings2 size={20} /></button></div></header>
      <main>
        {page === 'play' ? <>
          <section className="intro"><div><div className="eyebrow"><span />{config.mode === 'daily' ? t.dailyBadge : t.practice}</div><h1>{t.welcome} <em>{t.welcomeItalic}</em></h1><p>{t.intro}</p></div><div className="intro-decoration" aria-hidden="true"><div className="decoration-checker" /><span>♞</span></div></section>
          <nav className="mobile-mode-nav" aria-label={t.modes}>{modeOrder.map(modeButton)}</nav>
          <div className={`game-layout ${config.mode === 'quartet' ? 'quartet-layout' : ''}`}>
            <section className="play-card" aria-label={t[config.mode]}>
              <div className="play-card-header"><div className="game-title"><span className="game-title-piece">{chessPieces[config.mode]}</span><div><h2>{t[config.mode]}</h2><p>{modeDescription}</p></div></div><span className="game-badge">{config.mode === 'blitz' ? <Clock3 size={13} /> : config.mode === 'daily' ? <span>◷</span> : <InfinityIcon size={15} />}{config.mode === 'daily' ? dailyKey.split('-').reverse().join('.') : config.mode === 'blitz' ? '02:00' : t[config.difficulty]}</span></div>
              <div className="game-meta"><span>{config.length} {t.letters}<span className="meta-dot">·</span>{game?.maxAttempts ?? getMaxAttempts(config)} {t.attempts}</span><span>{config.mode === 'blitz' ? <span className={`timer ${remaining !== null && remaining < 30 ? 'urgent' : ''}`}><Clock3 size={14} />{Math.floor((remaining ?? 120) / 60).toString().padStart(2, '0')}:{((remaining ?? 120) % 60).toString().padStart(2, '0')}</span> : <>{t.turn} <strong>{Math.min((game?.guesses.length ?? 0) + (game?.status === 'playing' ? 1 : 0), game?.maxAttempts ?? 6) || 1}</strong> / {game?.maxAttempts ?? getMaxAttempts(config)}</>}</span></div>

              {loadError ? <div className="load-state"><BookOpen size={30} /><p>{t.loadError}</p><button className="primary-button" onClick={() => setLoadVersion(value => value + 1)}>{t.retry}</button></div> : !game || !dictionary ? <div className="load-state"><Knight /><p>{t.loading}</p></div> : <>
                {boardCount === 4 && <div className="quartet-toolbar">
                  <span className="quartet-progress"><span aria-hidden="true">♛</span><strong>{solvedCount} / 4</strong> {t.boardsSolved}</span>
                  <div className="quartet-board-tabs" role="group" aria-label={t.boardNavigation}>
                    {game.targets.map((_, index) => <button key={index} onClick={() => selectBoard(index)} className={`${selectedBoard === index ? 'active' : ''} ${isBoardSolved(game, index) ? 'is-solved' : ''}`} aria-label={`${t.goToBoard} ${index + 1}`} aria-pressed={selectedBoard === index}>{isBoardSolved(game, index) ? <Check size={13} /> : <span aria-hidden="true">♟</span>}{String(index + 1).padStart(2, '0')}</button>)}
                  </div>
                  <span className="quartet-scroll-hint">{t.swipeBoards}<ArrowRight size={13} /></span>
                </div>}
                <div className="boards-viewport" ref={boardsViewportRef} tabIndex={boardCount === 4 ? 0 : undefined} role={boardCount === 4 ? 'region' : undefined} aria-label={boardCount === 4 ? t.boardNavigation : undefined} onKeyDown={event => {
                  if (boardCount === 4 && event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation(); selectBoard(Math.max(0, Math.min(3, selectedBoard + (event.key === 'ArrowRight' ? 1 : -1))));
                  }
                }}>
                <div className={`boards boards-${boardCount}`} style={{ '--word-length': config.length } as CSSProperties}>
                  {game.targets.map((target, boardIndex) => {
                    const solved = isBoardSolved(game, boardIndex);
                    const solvedRow = game.guesses.indexOf(target);
                    const celebrates = motion.moves.some(move => move.phase === 'settled' && move.solvedBoards.includes(boardIndex));
                    return <div className={`board-wrapper ${boardIndex === selectedBoard ? 'selected' : ''} ${solved ? 'solved' : ''} ${celebrates ? 'board-celebrate' : ''}`} data-board-index={boardIndex} key={`${game.id}-${boardIndex}`}>
                      {boardCount > 1 && <button className="board-select" onClick={() => selectBoard(boardIndex)} aria-label={`${t.selectBoard} ${boardIndex + 1}`} aria-pressed={selectedBoard === boardIndex}><span>{t.board} {String(boardIndex + 1).padStart(2, '0')}</span>{solved ? <Check size={14} aria-label={t.solved} /> : <span className="board-indicator" />}</button>}
                      <div className="board-files" style={{ '--word-length': config.length } as CSSProperties}>{Array.from({ length: config.length }, (_, index) => <span key={index}>{alphabet[index]}</span>)}</div>
                      <div className="word-board" style={{ '--word-length': config.length } as CSSProperties} aria-label={`${t.board} ${boardIndex + 1}`}>
                        {Array.from({ length: game.maxAttempts }, (_, row) => {
                          const guess = game.guesses[row];
                          const pastSolve = solvedRow >= 0 && row > solvedRow;
                          const states = guess && !pastSolve ? evaluateGuess(guess, target) : null;
                          const current = row === game.guesses.length && !solved && game.status === 'playing';
                          const move = !pastSolve ? motion.moves.find(effect => effect.row === row) : undefined;
                          const invalid = current && motion.invalid?.row === row ? motion.invalid : null;
                          const moveClass = move?.phase === 'reveal' ? 'row-reveal' : move?.phase === 'settled' ? move.solvedBoards.includes(boardIndex) ? 'row-hit' : 'row-miss' : '';
                          return <div className={`board-row ${current ? 'current-row' : ''} ${moveClass} ${invalid ? `row-invalid motion-${invalid.revision % 2 ? 'odd' : 'even'}` : ''}`} key={row}><span className="row-number">{row + 1}</span>{Array.from({ length: config.length }, (_, column) => {
                            const letter = pastSolve ? '' : guess?.[column] ?? (current ? draft[column] : '') ?? '';
                            const state = states?.[column];
                            return <button tabIndex={-1} type="button" key={column} className={`tile ${(row + column) % 2 === 0 ? 'light' : 'dark'} ${state ?? ''} ${current ? 'current' : ''} ${current && column === cursor ? 'cursor' : ''} ${letter ? 'filled' : ''}`} onClick={() => { if (current) { setCursor(column); selectBoard(boardIndex); } }} aria-label={`${t.turn} ${row + 1}, ${column + 1}: ${letter.toUpperCase() || '—'}${state ? `, ${statusLabels[state]}` : ''}`} style={{ '--tile-delay': `${column * 55}ms` } as CSSProperties}>{letter && <span className="tile-letter" key={`${letter}-${current ? motion.typingRevisions[column] ?? 0 : 'submitted'}`}>{letter}</span>}{preferences.highContrast && state && <small className="state-symbol">{state === 'correct' ? '✓' : state === 'present' ? '●' : '×'}</small>}</button>;
                          })}</div>;
                        })}
                      </div>
                    </div>;
                  })}
                </div>
                </div>

                {motion.celebration && <div className={`celebration ${motion.celebration.mini ? 'mini-celebration' : ''}`} aria-hidden="true" key={motion.celebration.id}>{Array.from({ length: motion.celebration.mini ? 12 : 28 }, (_, index) => <span className="celebration-piece" key={index} style={{ '--x': `${(index * 37 + 9) % 100}%`, '--drift': `${(index % 2 ? 1 : -1) * (25 + index % 6 * 12)}px`, '--spin': `${(index % 2 ? 1 : -1) * (160 + index * 17)}deg`, '--delay': `${index % 6 * 65}ms`, '--fall': `${1500 + index % 5 * 90}ms` } as CSSProperties}>{index % 4 === 0 ? ['♞', '♜', '♛'][index % 3] : '▪'}</span>)}</div>}

                <div className={`board-message ${motion.invalid ? 'message-error' : ''}`} role="status" aria-live="polite"><span key={motion.invalid?.revision ?? 'message'}>{toast || (isRevealing ? t.revealing : settledMove?.solvedBoards.length ? t.niceMove : settledMove && game.status === 'playing' ? t.nextMove : game.status === 'playing' ? config.mode === 'blitz' && !game.startedAt ? t.clockHint : boardCount > 1 ? t.activeBoard : game.guesses.length === 0 ? t.ready : '\u00a0' : '')}</span></div>
                {game.status === 'playing' ? <div className="keyboard" aria-label={t.keyboard}>{['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row, index) => <div className="keyboard-row" key={row}>{index === 2 && <button className="key key-enter" onClick={() => handleKey('Enter')}>{t.enter}<ChevronRight size={13} /></button>}{row.split('').map(letter => <button className={`key ${keyboardStates[letter] ?? ''} ${motion.pressedKey === letter ? 'key-pressed' : ''}`} key={letter} onClick={() => handleKey(letter)} aria-label={`${letter.toUpperCase()}${keyboardStates[letter] ? `, ${statusLabels[keyboardStates[letter]]}` : ''}`}>{letter}</button>)}{index === 2 && <button className={`key key-delete ${motion.pressedKey === 'Backspace' ? 'key-pressed' : ''}`} aria-label={t.erase} onClick={() => handleKey('Backspace')}><Delete size={19} /></button>}</div>)}</div> : isRevealing ? <div className="result-pending" aria-hidden="true"><span>♞</span></div> : <div className={`result-card ${game.status} ${motion.freshResult ? 'fresh-result' : ''}`} role="status"><span className="result-icon">{game.status === 'won' ? '♚' : '♞'}</span><h3>{game.status === 'won' ? t.won : t.lost}</h3><p>{game.status === 'won' ? t.wonText : t.lostText}</p><div className="revealed-words">{game.targets.map((word, index) => <span key={word} className={isBoardSolved(game, index) ? 'found' : ''}>{word}</span>)}</div><div className="result-actions"><button className="secondary-button" onClick={() => void shareResult()}><Share2 size={15} />{t.share}</button>{config.mode !== 'daily' && <button className="primary-button" onClick={startNewGame}>{t.newGame}<ArrowRight size={15} /></button>}</div>{config.mode === 'daily' && <small>{t.nextDaily}</small>}{shareFallback && <textarea readOnly value={shareFallback} aria-label={t.share} onFocus={event => event.target.select()} />}</div>}
              </>}

              <div className="legend"><span><i className="correct" />{t.correct}</span><span><i className="present" />{t.present}</span><span><i className="absent" />{t.absent}</span></div>
              <div className="play-card-footer"><span>{storageAvailable ? <SyncIndicator sync={sync} language={config.language} onClick={() => setModal('settings')} /> : <><CircleHelp size={13} />{t.unsaved}</>}</span>{config.mode !== 'daily' && <button disabled={!game} onClick={() => game?.status === 'playing' && game.guesses.length > 0 ? setModal('restart') : startNewGame()}><RotateCcw size={13} />{t.newGame}</button>}</div>
            </section>

            <aside className="right-panel">
              <section className="settings-card"><div className="panel-title"><Settings2 size={17} /><h2>{t.customize}</h2></div><p className="panel-description">{t.customizeDesc}</p><label className="field-label" htmlFor="difficulty">{t.difficulty}</label><div className="difficulty-select"><span>{config.difficulty === 'easy' ? '♟' : config.difficulty === 'normal' ? '♞' : '♚'}</span><select id="difficulty" value={config.difficulty} onChange={event => changeConfig({ difficulty: event.target.value as Difficulty })}>{(['easy', 'normal', 'hard'] as Difficulty[]).map(difficulty => <option value={difficulty} key={difficulty}>{t[difficulty]}</option>)}</select></div><p className="field-hint">{t[`${config.difficulty}Hint` as keyof typeof t]}</p><span className="field-label">{t.wordLength}</span><div className="length-selector" role="group" aria-label={t.wordLength}>{[4, 5, 6, 7, 8].map(length => <button key={length} aria-pressed={config.length === length} className={config.length === length ? 'active' : ''} onClick={() => changeConfig({ length })}>{length}</button>)}</div><div className="settings-summary"><span>{getMaxAttempts(config)} {t.attempts}</span><span>{config.difficulty === 'hard' ? t.fullDictionary : t.commonWords}</span></div></section>
              <section className="tip-card"><div className="tip-eyebrow"><Lightbulb size={14} />{t.strategy}</div><h3>{t.tip}</h3><p>{t.tipText}</p><Knight className="tip-knight" /></section>
              <button className="daily-card" onClick={() => changeConfig({ mode: 'daily' })}><span className="daily-card-icon">♚</span><span><strong>{t.dailyCard}</strong><small>{t.dailyCardText}</small><span className="daily-card-action">{t.dailyAction}<ArrowRight size={14} /></span></span></button>
              <button className="dictionary-note" onClick={() => setModal('sources')}><BookOpen size={15} /><span><strong>{dictionary ? new Intl.NumberFormat(config.language).format(dictionary.count) : '10.000+'}</strong> {t.dictionary}<small>{config.language === 'pt' ? 'Português' : 'English'} · {config.length} {t.letters}: {dictionary?.byLength[String(config.length)]?.toLocaleString(config.language) ?? '…'}</small></span></button>
            </aside>
          </div>
        </> : <section className="progress-page"><button className="text-button" onClick={() => setPage('play')}><ArrowLeft size={16} />{t.backToGame}</button><div className="eyebrow"><span />{t.stats}</div><h1>{t.progressTitle}</h1><p className="progress-description">{t.progressDesc}</p><div className="stats-grid">{[{ icon: Grid2X2, value: stats.played, label: t.played }, { icon: Trophy, value: stats.won, label: t.victories }, { icon: BarChart3, value: `${stats.winRate}%`, label: t.winRate }, { icon: Flame, value: stats.currentStreak, label: t.streak }].map(({ icon: Icon, value, label }) => <div className="stat-card" key={label}><Icon size={21} /><strong>{value}</strong><span>{label}</span></div>)}</div>{stats.played === 0 ? <div className="empty-stats"><Knight /><h2>{t.noStats}</h2><p>{t.noStatsText}</p><button className="primary-button" onClick={() => setPage('play')}>{t.start}<ArrowRight size={16} /></button></div> : <div className="progress-details"><section className="settings-card"><h2>{t.distribution}</h2><div className="distribution">{Array.from({ length: 12 }, (_, index) => index + 1).map(attempt => <div className="distribution-row" key={attempt}><span>{attempt}</span><div style={{ width: `${Math.max(8, ((stats.distribution[attempt] ?? 0) / Math.max(1, ...Object.values(stats.distribution))) * 100)}%` }}>{stats.distribution[attempt] ?? 0}</div></div>)}</div><p className="best-streak"><Flame size={16} />{t.bestStreak}: <strong>{stats.bestStreak}</strong></p></section><section className="settings-card"><h2>{t.history}</h2><div className="history-list">{history.slice(0, 12).map(item => <div className="history-item" key={item.id}><span className="history-piece">{item.game ? chessPieces[item.game.config.mode] : '♟'}</span><div><strong>{item.game ? t[item.game.config.mode] : config.language === 'pt' ? 'Partida' : 'Game'} {item.game && <small>· {item.game.config.length}</small>}</strong><span>{new Date(item.finishedAt ?? 0).toLocaleDateString(config.language === 'pt' ? 'pt-BR' : 'en-US')}{item.game && <> · {t[item.game.config.difficulty]}</>}</span></div><span className={`history-result ${item.won ? 'won' : 'lost'}`}>{item.won ? item.game ? `${item.attempts}/${item.game.maxAttempts}` : t.win : t.loss}</span></div>)}</div></section></div>}</section>}
        <footer className="main-footer"><span>xeque<span>.</span> <span className="footer-separator">/</span> {t.tagline}</span><div className="footer-downloads"><a className="android-download" href="https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk" title={t.androidOffline}><Download size={14} />{t.androidDownload}</a><a href="https://github.com/DanielTR048/xeque-palavras" target="_blank" rel="noreferrer">{t.sourceCode}</a></div><span>{t.local}</span></footer>
      </main>
    </div>

    {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}><button className="modal-close icon-button" aria-label={t.close} onClick={() => setModal(null)}><X size={20} /></button>
      {modal === 'help' && <><div className="modal-chess">♞</div><div className="eyebrow">{t.how}</div><h2 id="modal-title">{t.instructionsTitle}</h2><p>{t.instructionsText}</p><ol className="rules"><li>{t.rule1}</li><li>{t.rule2}</li><li>{t.rule3}</li></ol><div className="example-word">{(config.language === 'pt' ? 'TORRE' : 'ROOKS').split('').map((letter, index) => <span key={index} className={index === 0 ? 'correct' : index === 2 ? 'present' : 'absent'}>{letter}</span>)}</div><div className="help-legend">{(['correct', 'present', 'absent'] as const).map(state => <span key={state}><i className={state} />{statusLabels[state]}</span>)}</div><p className="modal-note">{t.accents}</p><button className="primary-button full-width" onClick={() => setModal(null)}>{t.start}<ArrowRight size={16} /></button></>}
      {modal === 'settings' && <><Settings2 className="modal-heading-icon" size={27} /><h2 id="modal-title">{t.preferencesTitle}</h2>{(['highContrast', 'sound'] as const).map(preference => <label className="preference-row" key={preference}><span><strong>{preference === 'highContrast' ? t.contrast : t.sound}</strong><small>{preference === 'highContrast' ? t.contrastDesc : t.soundDesc}</small></span><input type="checkbox" checked={preferences[preference]} onChange={event => setPreferences(previous => ({ ...previous, [preference]: event.target.checked }))} /></label>)}<div className="preference-row"><span><strong>{t.language}</strong><small>{t.languageDesc}</small></span><select aria-label={t.language} value={config.language} onChange={event => changeConfig({ language: event.target.value as Language })}><option value="pt">Português</option><option value="en">English</option></select></div><div className="profile-switch-settings"><strong>{profileName(profile)}</strong><button className="secondary-button" onClick={onSwitchProfile}><Users size={14} />{config.language === 'pt' ? 'Trocar perfil' : 'Switch profile'}</button></div><SyncPanel sync={sync} language={config.language} /></>}
      {modal === 'restart' && <><RotateCcw className="modal-heading-icon" size={28} /><h2 id="modal-title">{t.restartTitle}</h2><p>{t.restartText}</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>{t.cancel}</button><button className="primary-button" onClick={startNewGame}>{t.confirm}</button></div></>}
      {modal === 'sources' && <><BookOpen className="modal-heading-icon" size={28} /><h2 id="modal-title">{t.source}</h2><p>{t.sourceText}</p><div className="source-links"><a href="https://github.com/fserb/pt-br" target="_blank" rel="noreferrer">Português · fserb/pt-br <ArrowRight size={14} /></a><a href="https://github.com/en-wl/wordlist" target="_blank" rel="noreferrer">English · SCOWL <ArrowRight size={14} /></a><span className="source-count">{dictionary?.count.toLocaleString(config.language)} {t.dictionary}</span><a href="/dictionaries/LICENSE-pt.txt" target="_blank" rel="noreferrer">Licença MIT · Português</a><a href="/dictionaries/LICENSE-en.txt" target="_blank" rel="noreferrer">SCOWL license · English</a></div></>}
    </div></div>}
    {toast && (page !== 'play' || game?.status !== 'playing' || modal) && <div className="toast" role="status">{toast}</div>}
  </div>;
}
