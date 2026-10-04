import { getMaxAttempts, type GameConfig, type GameState, type Language } from './engine';
import { canonicalGameId, documentHistory, documentStats, emptyDocument, latestGame, mergeDocuments, parseDocument, type SyncDocument } from '../sync/model';
import type { ProfileId } from '../profiles/profiles';

export interface Preferences { highContrast: boolean; sound: boolean }
export interface GameStats {
  played: number;
  won: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  distribution: Record<number, number>;
}

type Accumulator = Omit<GameStats, 'winRate'>;
type Results = {
  version: 1;
  history: GameState[];
  seenIds: string[];
  stats: Record<Language | 'all', Accumulator>;
  beforeHistory: Record<Language | 'all', Accumulator>;
};

const PREFIX = 'xeque-palavras:v1:';
const DEFAULT_CONFIG: GameConfig = { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 };
const DEFAULT_PREFERENCES: Preferences = { highContrast: false, sound: false };
const MODES = ['classic', 'daily', 'duo', 'quartet', 'blitz'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTimestamp(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8640000000000000);
}

function parseConfig(value: unknown): GameConfig | null {
  if (!isObject(value) || typeof value.language !== 'string' || !['pt', 'en'].includes(value.language) ||
    typeof value.mode !== 'string' || !MODES.includes(value.mode) ||
    typeof value.difficulty !== 'string' || !DIFFICULTIES.includes(value.difficulty) ||
    !isInteger(value.length, 4, 8)) return null;
  return { language: value.language as Language, mode: value.mode as GameConfig['mode'],
    difficulty: value.difficulty as GameConfig['difficulty'], length: value.length };
}

function sameConfig(a: GameConfig, b: GameConfig): boolean {
  return a.language === b.language && a.mode === b.mode && a.difficulty === b.difficulty && a.length === b.length;
}

function parseGame(value: unknown): GameState | null {
  if (!isObject(value)) return null;
  const config = parseConfig(value.config);
  if (!config || typeof value.id !== 'string' || !value.id.length || value.id.length > 300 ||
    !Array.isArray(value.targets) || !Array.isArray(value.guesses) ||
    typeof value.status !== 'string' || !['playing', 'won', 'lost'].includes(value.status) ||
    !isInteger(value.maxAttempts, 1, 50) || !isTimestamp(value.startedAt) ||
    !isTimestamp(value.finishedAt) || !(value.durationSeconds === null || isInteger(value.durationSeconds, 1, 86400))) return null;
  const expectedTargets = config.mode === 'duo' ? 2 : config.mode === 'quartet' ? 4 : 1;
  const targets = value.targets;
  const guesses = value.guesses;
  const wordPattern = new RegExp(`^[a-z]{${config.length}}$`);
  if (targets.length !== expectedTargets || new Set(targets).size !== expectedTargets ||
    guesses.length > value.maxAttempts || new Set(guesses).size !== guesses.length ||
    value.maxAttempts !== getMaxAttempts(config) || value.durationSeconds !== (config.mode === 'blitz' ? 120 : null) ||
    [...targets, ...guesses].some(word => typeof word !== 'string' || !wordPattern.test(word))) return null;
  if (value.startedAt !== null && value.finishedAt !== null && value.finishedAt < value.startedAt) return null;
  const allSolved = targets.every(word => guesses.includes(word));
  if (value.status === 'playing' && (value.finishedAt !== null || allSolved || value.guesses.length >= value.maxAttempts)) return null;
  if (value.status !== 'playing' && value.finishedAt === null) return null;
  if ((value.status === 'won') !== allSolved) return null;
  if (value.guesses.length > 0 && value.startedAt === null) return null;
  if (value.status === 'lost' && guesses.length < value.maxAttempts &&
    !(value.durationSeconds !== null && value.startedAt !== null && value.finishedAt !== null &&
      value.finishedAt >= value.startedAt + value.durationSeconds * 1000)) return null;
  return {
    id: value.id, config, targets: [...value.targets] as string[], guesses: [...value.guesses] as string[],
    status: value.status as GameState['status'], startedAt: value.startedAt, finishedAt: value.finishedAt,
    maxAttempts: value.maxAttempts, durationSeconds: value.durationSeconds,
  };
}

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch { return null; }
}

function write(key: string, value: unknown): void {
  try { globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value)); }
  catch { /* Private browsing, full storage, and disabled persistence do not interrupt play. */ }
}

export function isStorageAvailable(): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const key = `${PREFIX}probe:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch { return false; }
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function gameKey(config: GameConfig, day = localDate(Date.now())): string {
  return `game:${config.language}:${config.mode}:${config.difficulty}:${config.length}${config.mode === 'daily' ? `:${day}` : ''}`;
}

function dailyDate(game: GameState): string | undefined {
  return game.id.match(/^daily:(\d{4}-\d{2}-\d{2}):/)?.[1];
}

function readGame(key: string): GameState | null {
  const entry = read(key);
  return isObject(entry) && entry.version === 1 ? parseGame(entry.game) : null;
}

export function loadConfig(): GameConfig {
  const entry = read('config');
  return (isObject(entry) && entry.version === 1 ? parseConfig(entry.config) : null) ?? { ...DEFAULT_CONFIG };
}

export function saveConfig(config: GameConfig): void {
  const checked = parseConfig(config);
  if (checked) write('config', { version: 1, config: checked });
}

export function loadGame(config: GameConfig, now = Date.now()): GameState | null {
  const checked = parseConfig(config);
  if (!checked || !isTimestamp(now)) return null;
  const day = localDate(now);
  const game = readGame(gameKey(checked, day));
  if (game?.config.mode === 'daily' && dailyDate(game) && dailyDate(game) !== day) return null;
  return game && sameConfig(game.config, checked) ? game : null;
}

export function saveGame(game: GameState): void {
  const checked = parseGame(game);
  if (!checked) return;
  // A daily ID carries the puzzle date, so an open tab cannot save yesterday's game into today.
  const day = dailyDate(checked) ?? localDate(checked.startedAt ?? Date.now());
  const key = gameKey(checked.config, day);
  if (checked.config.mode === 'daily') {
    const entry = readGame(key);
    const existing = entry && sameConfig(entry.config, checked.config) && (!dailyDate(entry) || dailyDate(entry) === day) ? entry : null;
    if (existing && (existing.status !== 'playing' || existing.id !== checked.id ||
      existing.targets.some((target, index) => target !== checked.targets[index]) ||
      existing.guesses.some((guess, index) => guess !== checked.guesses[index]))) return;
  }
  write(key, { version: 1, savedAt: Date.now(), game: checked });
}

export function loadPreferences(): Preferences {
  const entry = read('preferences');
  if (!isObject(entry) || entry.version !== 1 || !isObject(entry.preferences)) return { ...DEFAULT_PREFERENCES };
  return {
    highContrast: typeof entry.preferences.highContrast === 'boolean' ? entry.preferences.highContrast : DEFAULT_PREFERENCES.highContrast,
    sound: typeof entry.preferences.sound === 'boolean' ? entry.preferences.sound : DEFAULT_PREFERENCES.sound,
  };
}

export function savePreferences(preferences: Preferences): void {
  if (isObject(preferences) && typeof preferences.highContrast === 'boolean' && typeof preferences.sound === 'boolean') {
    write('preferences', { version: 1, preferences: { highContrast: preferences.highContrast, sound: preferences.sound } });
  }
}

function emptyStats(): Accumulator {
  return { played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} };
}

function emptyTotals(): Results['stats'] {
  return { all: emptyStats(), pt: emptyStats(), en: emptyStats() };
}

function accumulate(stats: Accumulator, game: GameState): void {
  stats.played += 1;
  if (game.status === 'won') {
    stats.won += 1;
    stats.currentStreak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    stats.distribution[game.guesses.length] = (stats.distribution[game.guesses.length] ?? 0) + 1;
  } else stats.currentStreak = 0;
}

function parseStats(value: unknown): Accumulator | null {
  if (!isObject(value) || !isInteger(value.played, 0) || !isInteger(value.won, 0, value.played) ||
    !isInteger(value.bestStreak, 0, value.won) || !isInteger(value.currentStreak, 0, value.bestStreak) ||
    !isObject(value.distribution)) return null;
  const distribution: Record<number, number> = {};
  let wins = 0;
  for (const [attempts, count] of Object.entries(value.distribution)) {
    const attemptNumber = Number(attempts);
    if (!isInteger(attemptNumber, 1, 50) || !isInteger(count, 0, value.won)) return null;
    distribution[attemptNumber] = count;
    wins += count;
  }
  if (wins !== value.won) return null;
  return { played: value.played, won: value.won, currentStreak: value.currentStreak,
    bestStreak: value.bestStreak, distribution };
}

function parseTotals(value: unknown): Results['stats'] | null {
  if (!isObject(value)) return null;
  const all = parseStats(value.all), pt = parseStats(value.pt), en = parseStats(value.en);
  if (!all || !pt || !en || all.played !== pt.played + en.played || all.won !== pt.won + en.won) return null;
  return { all, pt, en };
}

function addToTotals(totals: Results['stats'], game: GameState): void {
  accumulate(totals.all, game);
  accumulate(totals[game.config.language], game);
}

function summarize(results: Results): void {
  results.history.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  for (const game of results.history.slice(500).reverse()) addToTotals(results.beforeHistory, game);
  results.history = results.history.slice(0, 500);
  results.stats = emptyTotals();
  for (const language of ['all', 'pt', 'en'] as const) {
    const earlier = results.beforeHistory[language];
    results.stats[language] = { ...earlier, distribution: { ...earlier.distribution } };
  }
  // A timed-out Blitz game can be recorded after a more recent win in another mode.
  // Fold the retained results by completion time, preserving the earlier aggregate.
  for (const game of [...results.history].reverse()) addToTotals(results.stats, game);
}

function restoreEarlierTotals(totals: Results['stats'], history: GameState[]): Results['stats'] {
  const retained = emptyTotals();
  for (const game of [...history].reverse()) addToTotals(retained, game);
  const earlier = emptyTotals();
  for (const language of ['all', 'pt', 'en'] as const) {
    const total = totals[language], recent = retained[language];
    if (total.played < recent.played || total.won < recent.won) return emptyTotals();
    const distribution: Record<number, number> = {};
    for (const attempts of new Set([...Object.keys(total.distribution), ...Object.keys(recent.distribution)])) {
      const count = (total.distribution[Number(attempts)] ?? 0) - (recent.distribution[Number(attempts)] ?? 0);
      if (count < 0) return emptyTotals();
      if (count > 0) distribution[Number(attempts)] = count;
    }
    const won = total.won - recent.won;
    earlier[language] = {
      played: total.played - recent.played, won, distribution,
      currentStreak: recent.currentStreak === recent.played ? Math.max(0, total.currentStreak - recent.won) : 0,
      bestStreak: Math.min(won, total.bestStreak),
    };
  }
  return earlier;
}

function readResults(): Results {
  const entry = read('results');
  const result: Results = { version: 1, history: [], seenIds: [], stats: emptyTotals(), beforeHistory: emptyTotals() };
  if (!isObject(entry) || entry.version !== 1 || !Array.isArray(entry.history)) return result;
  const ids = new Set<string>();
  result.history = entry.history.flatMap(value => {
    const game = parseGame(value);
    if (!game || game.status === 'playing' || ids.has(game.id)) return [];
    ids.add(game.id);
    return [game];
  }).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 500);
  result.seenIds = Array.from(new Set([
    ...(Array.isArray(entry.seenIds) ? entry.seenIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 300) as string[] : []),
    ...result.history.map(game => game.id),
  ])).slice(-2000);
  const earlier = parseTotals(entry.beforeHistory);
  const totals = parseTotals(entry.stats);
  result.beforeHistory = earlier ?? (totals ? restoreEarlierTotals(totals, result.history) : emptyTotals());
  summarize(result);
  return result;
}

export function recordResult(game: GameState): void {
  const checked = parseGame(game);
  if (!checked || checked.status === 'playing') return;
  const results = readResults();
  if (results.seenIds.includes(checked.id)) return;
  results.seenIds = [...results.seenIds, checked.id].slice(-2000);
  results.history = [...results.history, checked];
  summarize(results);
  write('results', results);
}

export function getStats(language?: Language): GameStats {
  const stats = readResults().stats[language ?? 'all'];
  return { ...stats, distribution: { ...stats.distribution }, winRate: stats.played ? Math.round(stats.won / stats.played * 100) : 0 };
}

export function getHistory(language?: Language): GameState[] {
  return readResults().history.filter(game => !language || game.config.language === language).slice(0, 50);
}

export type ProfileStorage = ReturnType<typeof createProfileStorage>;
export const profileStorageKey = (profile: ProfileId) => `xeque-palavras:v2:profile:${profile}`;

/** The profile is captured by each method, including delayed writes after a profile switch. */
export function createProfileStorage(profile: ProfileId) {
  const key = profileStorageKey(profile);
  const listeners = new Set<(source: 'local' | 'remote') => void>();
  let document = emptyDocument();
  let revision = 0;
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(key) ?? null; if (raw) document = parseDocument(JSON.parse(raw)); }
  catch {
    // Preserve an unreadable document before a subsequent move writes a recoverable new one.
    if (raw) {
      try { globalThis.localStorage?.setItem(`${key}:recovery:${Date.now()}`, raw); }
      catch { /* The original remains untouched until a new write can succeed. */ }
    }
  }

  const persist = () => {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(document)); }
    catch { /* Keep the complete document in memory for this session. */ }
  };

  // The v1 keys remain untouched as a backup. Only Daniel inherits this device's old data.
  if (!raw && profile === 'daniel') {
    const migrationKey = 'xeque-palavras:v2:legacy-origin';
    let origin = '';
    const originals: Record<string, string> = {};
    try {
      origin = globalThis.localStorage?.getItem(migrationKey) ?? '';
      for (let index = 0; index < (globalThis.localStorage?.length ?? 0); index++) {
        const oldKey = globalThis.localStorage.key(index);
        if (oldKey?.startsWith(PREFIX)) originals[oldKey] = globalThis.localStorage.getItem(oldKey)!;
      }
      if (!origin) {
        origin = `web:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        globalThis.localStorage?.setItem(migrationKey, origin);
      }
      if (Object.keys(originals).length && !globalThis.localStorage?.getItem('xeque-palavras:v2:legacy-backup')) {
        globalThis.localStorage?.setItem('xeque-palavras:v2:legacy-backup', JSON.stringify(originals));
      }
    } catch { /* Original entries are still preserved if the backup cannot be written. */ }
    const results = readResults();
    const retainedIds = new Set(results.history.map(game => game.id));
    const importGame = (game: GameState, updatedAt: number, fallbackDay?: string) => {
      const day = dailyDate(game) ?? fallbackDay ?? localDate(game.startedAt ?? game.finishedAt ?? updatedAt);
      const id = canonicalGameId(game, day);
      let imported = parseDocument({ ...emptyDocument(), games: { [id]: { game: { ...game, id }, day, updatedAt } } });
      if (document.games[id]) imported = mergeDocuments({ ...emptyDocument(), games: { [id]: document.games[id] } }, imported);
      document.games[id] = imported.games[id];
      if (imported.results[id]) document.results[id] = imported.results[id];
      if (imported.conflicts?.[id]) document.conflicts = { ...document.conflicts, [id]: imported.conflicts[id] };
    };
    for (const game of results.history) {
      try { importGame(game, game.finishedAt ?? Date.now()); } catch { /* Invalid legacy identifiers stay only in the backup. */ }
    }
    for (const [oldKey, value] of Object.entries(originals)) {
      if (!oldKey.startsWith(PREFIX + 'game:')) continue;
      try {
        const entry = JSON.parse(value) as Record<string, unknown>;
        const game = parseGame(entry.game);
        // An old slot may retain a finished game whose result has already moved into the lifetime aggregate.
        if (game && game.status !== 'playing' && results.beforeHistory.all.played > 0 && !retainedIds.has(game.id)) continue;
        if (entry.version === 1 && game) importGame(game, isInteger(entry.savedAt, 0, 8640000000000000) ? entry.savedAt : Date.now(), oldKey.match(/:(\d{4}-\d{2}-\d{2})$/)?.[1]);
      } catch { /* Ignore corrupt legacy entries without removing them. */ }
    }
    if (results.beforeHistory.all.played && origin) document.legacy[origin] = results.beforeHistory;
    if (read('config')) document.config = { value: loadConfig(), updatedAt: 1 };
    if (read('preferences')) document.preferences = { value: loadPreferences(), updatedAt: 1 };
    persist();
  }

  function commit(next: SyncDocument, source: 'local' | 'remote') {
    if (JSON.stringify(next) === JSON.stringify(document)) return false;
    document = next; revision++; persist();
    for (const listener of listeners) listener(source);
    return true;
  }

  function patchDocument(patch: Partial<SyncDocument>) {
    commit(mergeDocuments(document, { ...emptyDocument(), ...patch }), 'local');
  }

  return {
    profile,
    getRevision: () => revision,
    getDocument: () => structuredClone(document),
    subscribe(listener: (source: 'local' | 'remote') => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mergeRemote(value: unknown) { return commit(mergeDocuments(document, parseDocument(value)), 'remote'); },
    loadConfig: () => ({ ...(document.config?.value ?? DEFAULT_CONFIG) }),
    saveConfig(value: GameConfig) {
      const checked = parseConfig(value);
      if (checked && JSON.stringify(document.config?.value ?? DEFAULT_CONFIG) !== JSON.stringify(checked)) {
        patchDocument({ config: { value: checked, updatedAt: Date.now() } });
      }
    },
    loadPreferences: () => ({ ...(document.preferences?.value ?? DEFAULT_PREFERENCES) }),
    savePreferences(value: Preferences) {
      if (typeof value.highContrast === 'boolean' && typeof value.sound === 'boolean' &&
        JSON.stringify(document.preferences?.value ?? DEFAULT_PREFERENCES) !== JSON.stringify(value)) {
        patchDocument({ preferences: { value: { ...value }, updatedAt: Date.now() } });
      }
    },
    loadGame(config: GameConfig, now = Date.now()) {
      return structuredClone(latestGame(document, config, localDate(now))?.game ?? null);
    },
    saveGame(value: GameState) {
      const game = parseGame(value);
      if (!game) return;
      const day = dailyDate(game) ?? localDate(game.startedAt ?? Date.now());
      const id = canonicalGameId(game, day);
      const checked = { ...game, id };
      if (JSON.stringify(document.games[id]?.game) === JSON.stringify(checked)) return;
      patchDocument({ games: { [id]: { game: checked, day, updatedAt: Date.now() } } });
    },
    recordResult(value: GameState) {
      const game = parseGame(value);
      if (!game || game.status === 'playing' || game.finishedAt === null) return;
      const day = dailyDate(game) ?? localDate(game.startedAt ?? game.finishedAt);
      const id = canonicalGameId(game, day);
      patchDocument({
        games: { [id]: { game: { ...game, id }, day, updatedAt: document.games[id]?.updatedAt ?? Date.now() } },
        results: { [id]: { id, language: game.config.language, won: game.status === 'won', finishedAt: game.finishedAt, attempts: game.guesses.length } },
      });
    },
    getStats: (language?: Language): GameStats => documentStats(document, language),
    getHistory: (language?: Language) => documentHistory(document, language).slice(0, 50)
      .map(result => ({ ...result, game: document.games[result.id]?.game ?? null })),
  };
}
