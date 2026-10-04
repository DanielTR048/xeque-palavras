import { getBoardCount, getMaxAttempts, type GameConfig, type GameState, type Language } from '../game/engine';

export interface Accumulator {
  played: number; won: number; currentStreak: number; bestStreak: number; distribution: Record<number, number>;
}
export interface Totals { pt: Accumulator; en: Accumulator; all: Accumulator }
export interface SyncPreferences { highContrast: boolean; sound: boolean }
export interface SyncGame { game: GameState; day: string; updatedAt: number }
export interface SyncResult { id: string; language: Language; won: boolean; finishedAt: number; attempts: number }
export interface VersionedValue<T> { value: T; updatedAt: number }
export interface SyncDocument {
  version: 1;
  games: Record<string, SyncGame>;
  results: Record<string, SyncResult>;
  config: VersionedValue<GameConfig> | null;
  preferences: VersionedValue<SyncPreferences> | null;
  legacy: Record<string, Totals>;
  conflicts?: Record<string, SyncGame[]>;
}

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_SYNC_ENTRIES = 5000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message: string): never { throw new Error(`Invalid sync document: ${message}`); }
function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(context);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail('fields');
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('number');
  return value;
}
function timestamp(value: unknown): number { return integer(value, 0, 8640000000000000); }
function nullableTime(value: unknown): number | null { return value === null ? null : timestamp(value); }
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value) || FORBIDDEN_KEYS.has(value)) fail('identifier');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('day');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('day');
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') fail('boolean'); return value; }
function language(value: unknown): Language { if (value !== 'pt' && value !== 'en') fail('language'); return value; }

function parseConfig(value: unknown): GameConfig {
  const item = object(value, 'config'); fields(item, ['language', 'mode', 'difficulty', 'length']);
  if (typeof item.mode !== 'string' || typeof item.difficulty !== 'string' ||
    !['classic', 'daily', 'duo', 'quartet', 'blitz'].includes(item.mode) ||
    !['easy', 'normal', 'hard'].includes(item.difficulty)) fail('config');
  return { language: language(item.language), mode: item.mode as GameConfig['mode'],
    difficulty: item.difficulty as GameConfig['difficulty'], length: integer(item.length, 4, 8) };
}

/** Daily games have one identity per puzzle even when created independently offline. */
export function canonicalGameId(game: GameState, day: string): string {
  return game.config.mode === 'daily'
    ? `daily:${date(day)}:${game.config.language}:${game.config.difficulty}:${game.config.length}` : identifier(game.id);
}

function parseGame(value: unknown): SyncGame {
  const entry = object(value, 'game entry'); fields(entry, ['game', 'day', 'updatedAt']);
  const raw = object(entry.game, 'game');
  fields(raw, ['id', 'config', 'targets', 'guesses', 'status', 'startedAt', 'finishedAt', 'maxAttempts', 'durationSeconds']);
  const config = parseConfig(raw.config), day = date(entry.day);
  identifier(raw.id);
  if (!Array.isArray(raw.targets) || !Array.isArray(raw.guesses)) fail('words');
  const targets = raw.targets, guesses = raw.guesses, word = new RegExp(`^[a-z]{${config.length}}$`);
  if (targets.length !== getBoardCount(config.mode) || new Set(targets).size !== targets.length ||
    new Set(guesses).size !== guesses.length || [...targets, ...guesses].some(value => typeof value !== 'string' || !word.test(value))) fail('words');
  if (typeof raw.status !== 'string' || !['playing', 'won', 'lost'].includes(raw.status) || raw.maxAttempts !== getMaxAttempts(config) ||
    guesses.length > getMaxAttempts(config) || raw.durationSeconds !== (config.mode === 'blitz' ? 120 : null)) fail('game rules');
  const startedAt = nullableTime(raw.startedAt), finishedAt = nullableTime(raw.finishedAt);
  const solved = targets.every(target => guesses.includes(target));
  if ((raw.status === 'won') !== solved || (guesses.length > 0 && startedAt === null) ||
    (startedAt !== null && finishedAt !== null && finishedAt < startedAt) ||
    (raw.status === 'playing' && (finishedAt !== null || guesses.length >= getMaxAttempts(config))) ||
    (raw.status !== 'playing' && finishedAt === null) ||
    (raw.status === 'lost' && guesses.length < getMaxAttempts(config) &&
      !(config.mode === 'blitz' && startedAt !== null && finishedAt !== null && finishedAt >= startedAt + 120000))) fail('game state');
  const game: GameState = { id: raw.id as string, config, targets: [...targets] as string[], guesses: [...guesses] as string[],
    status: raw.status as GameState['status'], startedAt, finishedAt, maxAttempts: getMaxAttempts(config),
    durationSeconds: config.mode === 'blitz' ? 120 : null };
  const existingDay = game.id.match(/^daily:(\d{4}-\d{2}-\d{2}):/)?.[1];
  if (config.mode === 'daily' && existingDay && existingDay !== day) fail('daily date');
  game.id = canonicalGameId(game, day);
  if (/^daily:\d{4}-\d{2}-\d{2}:(pt|en):(easy|normal|hard):[4-8]$/.test(raw.id as string) && raw.id !== game.id) fail('daily identity');
  return { game, day, updatedAt: timestamp(entry.updatedAt) };
}

function parseResult(value: unknown): SyncResult {
  const item = object(value, 'result'); fields(item, ['id', 'language', 'won', 'finishedAt', 'attempts']);
  return { id: identifier(item.id), language: language(item.language), won: bool(item.won),
    finishedAt: timestamp(item.finishedAt), attempts: integer(item.attempts, 0, 50) };
}
function parseAccumulator(value: unknown): Accumulator {
  const item = object(value, 'legacy statistics'); fields(item, ['played', 'won', 'currentStreak', 'bestStreak', 'distribution']);
  const played = integer(item.played), won = integer(item.won, 0, played), bestStreak = integer(item.bestStreak, 0, won);
  const currentStreak = integer(item.currentStreak, 0, bestStreak), raw = object(item.distribution, 'distribution');
  const distribution: Record<number, number> = {};
  for (const [key, count] of Object.entries(raw)) {
    if (!/^(0|[1-9]\d?)$/.test(key)) fail('distribution');
    const attempt = integer(Number(key), 0, 50);
    distribution[attempt] = integer(count, 0, won);
  }
  if (Object.values(distribution).reduce((sum, count) => sum + count, 0) !== won) fail('distribution total');
  return { played, won, currentStreak, bestStreak, distribution };
}
function parseTotals(value: unknown): Totals {
  const item = object(value, 'legacy'); fields(item, ['all', 'pt', 'en']);
  const all = parseAccumulator(item.all), pt = parseAccumulator(item.pt), en = parseAccumulator(item.en);
  if (all.played !== pt.played + en.played || all.won !== pt.won + en.won) fail('legacy total');
  for (let attempts = 0; attempts <= 50; attempts++) {
    if ((all.distribution[attempts] ?? 0) !== (pt.distribution[attempts] ?? 0) + (en.distribution[attempts] ?? 0)) fail('legacy distribution');
  }
  return { pt, en, all };
}
function parseVersioned<T>(value: unknown, parse: (value: unknown) => T): VersionedValue<T> | null {
  if (value === null) return null;
  const item = object(value, 'versioned value'); fields(item, ['value', 'updatedAt']);
  return { value: parse(item.value), updatedAt: timestamp(item.updatedAt) };
}
function size(value: unknown): void {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { fail('JSON'); }
  if (!encoded || new TextEncoder().encode(encoded).length > MAX_DOCUMENT_BYTES) fail('document exceeds 2 MiB');
}
function entries(value: unknown, max: number, name: string): [string, unknown][] {
  const result = Object.entries(object(value, name));
  if (result.length > max) fail(`too many ${name}`);
  result.forEach(([key]) => identifier(key));
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function compareStable(a: unknown, b: unknown): number { const x = stable(a), y = stable(b); return x === y ? 0 : x > y ? 1 : -1; }
function samePuzzle(a: SyncGame, b: SyncGame): boolean {
  return a.day === b.day && stable(a.game.config) === stable(b.game.config) && stable(a.game.targets) === stable(b.game.targets);
}
function prefix(a: string[], b: string[]): boolean { return a.length <= b.length && a.every((word, index) => b[index] === word); }
function compatible(a: SyncGame, b: SyncGame): boolean {
  return samePuzzle(a, b) && (prefix(a.game.guesses, b.game.guesses) || prefix(b.game.guesses, a.game.guesses));
}
function rankGame(a: SyncGame, b: SyncGame): number {
  const rank = (item: SyncGame) => item.game.status === 'won' ? 2 : item.game.status === 'lost' ? 1 : 0;
  return rank(a) - rank(b) || a.game.guesses.length - b.game.guesses.length || a.updatedAt - b.updatedAt || compareStable(a, b);
}
function combineGames(values: SyncGame[]): { winner: SyncGame; conflicts: SyncGame[] } {
  const unique = [...new Map(values.map(value => [stable(value), value])).values()];
  const winner = [...unique].sort(rankGame).at(-1)!;
  // Discard only compatible stale prefixes. Every divergent branch remains recoverable.
  const conflicts = unique.filter(value => value !== winner && !compatible(value, winner))
    .filter((value, index, list) => !list.some((other, otherIndex) => otherIndex !== index && compatible(value, other) && rankGame(other, value) > 0))
    .sort((a, b) => compareStable(a, b));
  return { winner, conflicts };
}
function derivedResult(value: SyncGame): SyncResult | null {
  const { game } = value;
  return game.status === 'playing' ? null : { id: game.id, language: game.config.language, won: game.status === 'won',
    finishedAt: game.finishedAt!, attempts: game.guesses.length };
}
function rankResult(a: SyncResult, b: SyncResult): number {
  return Number(a.won) - Number(b.won) || a.finishedAt - b.finishedAt || a.attempts - b.attempts || compareStable(a, b);
}
function addResult(target: Record<string, SyncResult>, item: SyncResult): void {
  if (!Object.hasOwn(target, item.id) || rankResult(item, target[item.id]) > 0) target[item.id] = item;
}

export function emptyDocument(): SyncDocument { return { version: 1, games: {}, results: {}, config: null, preferences: null, legacy: {} }; }

/** Validate the complete wire payload, then normalize historical daily IDs. No records are silently dropped. */
export function parseDocument(value: unknown): SyncDocument {
  size(value);
  const raw = object(value, 'root'); fields(raw, ['version', 'games', 'results', 'config', 'preferences', 'legacy', 'conflicts'],
    ['version', 'games', 'results', 'config', 'preferences', 'legacy']);
  if (raw.version !== 1) fail('version');
  const result = emptyDocument(), aliases = new Map<string, string>(), candidates = new Map<string, SyncGame[]>();
  for (const [key, entry] of entries(raw.games, MAX_SYNC_ENTRIES, 'games')) {
    const game = parseGame(entry), originalId = (entry as { game: { id: string } }).game.id;
    if (key !== originalId && key !== game.game.id) fail('game key');
    aliases.set(originalId, game.game.id);
    candidates.set(game.game.id, [...(candidates.get(game.game.id) ?? []), game]);
  }
  let conflictCount = 0;
  for (const [key, snapshots] of entries(raw.conflicts ?? {}, MAX_SYNC_ENTRIES, 'conflicts')) {
    if (!Array.isArray(snapshots) || !snapshots.length) fail('conflicts');
    conflictCount += snapshots.length;
    if (conflictCount > MAX_SYNC_ENTRIES) fail('too many conflicts');
    for (const entry of snapshots) {
      const game = parseGame(entry);
      if (key !== game.game.id && key !== (entry as { game: { id: string } }).game.id) fail('conflict key');
      candidates.set(game.game.id, [...(candidates.get(game.game.id) ?? []), game]);
    }
  }
  const conflicts: Record<string, SyncGame[]> = {};
  for (const [id, items] of [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const merged = combineGames(items); result.games[id] = merged.winner;
    if (merged.conflicts.length) conflicts[id] = merged.conflicts;
  }
  if (Object.keys(result.games).length > MAX_SYNC_ENTRIES) fail('too many games');
  if (Object.keys(conflicts).length) result.conflicts = conflicts;
  for (const [key, item] of entries(raw.results, MAX_SYNC_ENTRIES, 'results')) {
    const parsed = parseResult(item); if (key !== parsed.id) fail('result key');
    parsed.id = aliases.get(parsed.id) ?? parsed.id; addResult(result.results, parsed);
  }
  for (const game of Object.values(result.games)) { const derived = derivedResult(game); if (derived) result.results[derived.id] = derived; }
  if (Object.keys(result.results).length > MAX_SYNC_ENTRIES) fail('too many results');
  result.config = parseVersioned(raw.config, parseConfig);
  result.preferences = parseVersioned(raw.preferences, value => {
    const item = object(value, 'preferences'); fields(item, ['highContrast', 'sound']);
    return { highContrast: bool(item.highContrast), sound: bool(item.sound) };
  });
  for (const [key, totals] of entries(raw.legacy, 64, 'legacy origins')) result.legacy[key] = parseTotals(totals);
  size(result);
  return result;
}

function latestValue<T>(a: VersionedValue<T> | null, b: VersionedValue<T> | null): VersionedValue<T> | null {
  if (!a) return b; if (!b) return a;
  return (a.updatedAt - b.updatedAt || compareStable(a, b)) >= 0 ? a : b;
}

/** A deterministic union: completed games win over stale drafts; divergent drafts remain in conflicts. */
export function mergeDocuments(left: SyncDocument, right: SyncDocument): SyncDocument {
  const a = parseDocument(left), b = parseDocument(right), result = emptyDocument();
  const ids = [...new Set([...Object.keys(a.games), ...Object.keys(b.games)])].sort();
  const conflicts: Record<string, SyncGame[]> = {};
  for (const id of ids) {
    const candidates = [a.games[id], b.games[id], ...(a.conflicts?.[id] ?? []), ...(b.conflicts?.[id] ?? [])].filter((item): item is SyncGame => Boolean(item));
    const merged = combineGames(candidates); result.games[id] = merged.winner;
    if (merged.conflicts.length) conflicts[id] = merged.conflicts;
  }
  if (Object.keys(conflicts).length) result.conflicts = conflicts;
  for (const item of [...Object.values(a.results), ...Object.values(b.results)]) addResult(result.results, item);
  for (const game of Object.values(result.games)) { const derived = derivedResult(game); if (derived) result.results[derived.id] = derived; }
  result.config = latestValue(a.config, b.config); result.preferences = latestValue(a.preferences, b.preferences);
  for (const id of [...new Set([...Object.keys(a.legacy), ...Object.keys(b.legacy)])].sort()) {
    const first = a.legacy[id], second = b.legacy[id];
    result.legacy[id] = !first ? second : !second ? first :
      (first.all.played - second.all.played || first.all.won - second.all.won || compareStable(first, second)) >= 0 ? first : second;
  }
  return parseDocument(result);
}

export function latestGame(document: SyncDocument, config: GameConfig, day: string): SyncGame | null {
  const matching = Object.values(document.games).filter(item => stable(item.game.config) === stable(config) &&
    (config.mode !== 'daily' || item.day === day));
  return matching.sort((a, b) => a.updatedAt - b.updatedAt || rankGame(a, b)).at(-1) ?? null;
}

export function documentHistory(document: SyncDocument, selectedLanguage?: Language): SyncResult[] {
  return Object.values(document.results).filter(result => !selectedLanguage || result.language === selectedLanguage)
    .sort((a, b) => b.finishedAt - a.finishedAt || a.id.localeCompare(b.id, 'en'));
}

export function documentStats(document: SyncDocument, selectedLanguage?: Language): Accumulator & { winRate: number } {
  const accumulator: Accumulator = { played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} };
  const legacy = Object.values(document.legacy).map(totals => totals[selectedLanguage ?? 'all']);
  for (const earlier of legacy) {
    accumulator.played += earlier.played; accumulator.won += earlier.won;
    accumulator.bestStreak = Math.max(accumulator.bestStreak, earlier.bestStreak);
    for (const [attempts, count] of Object.entries(earlier.distribution)) accumulator.distribution[Number(attempts)] = (accumulator.distribution[Number(attempts)] ?? 0) + count;
  }
  // Multiple aggregate-only sources carry no chronology; do not invent a combined current streak.
  accumulator.currentStreak = legacy.length === 1 ? legacy[0].currentStreak : 0;
  for (const event of documentHistory(document, selectedLanguage).reverse()) {
    accumulator.played++;
    if (event.won) {
      accumulator.won++; accumulator.currentStreak++;
      accumulator.bestStreak = Math.max(accumulator.bestStreak, accumulator.currentStreak);
      accumulator.distribution[event.attempts] = (accumulator.distribution[event.attempts] ?? 0) + 1;
    } else accumulator.currentStreak = 0;
  }
  return { ...accumulator, winRate: accumulator.played ? Math.round(accumulator.won / accumulator.played * 100) : 0 };
}
