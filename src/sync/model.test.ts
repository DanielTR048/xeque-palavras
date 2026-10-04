import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState } from '../game/engine';
import { canonicalGameId, documentHistory, documentStats, emptyDocument, latestGame, MAX_DOCUMENT_BYTES,
  mergeDocuments, parseDocument, type Accumulator, type SyncDocument, type SyncGame } from './model';

const config: GameConfig = { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 };
const day = '2026-10-04';
function game(overrides: Partial<GameState> = {}, updatedAt = 1000): SyncGame {
  return { game: { id: 'game-1', config: { ...config }, targets: ['carta'], guesses: [], status: 'playing',
    startedAt: null, finishedAt: null, maxAttempts: 6, durationSeconds: null, ...overrides }, day, updatedAt };
}
function doc(...games: SyncGame[]): SyncDocument {
  return { ...emptyDocument(), games: Object.fromEntries(games.map(item => [item.game.id, item])) };
}
function won(id = 'game-1', finishedAt = 2000): SyncGame {
  return game({ id, guesses: ['termo', 'carta'], status: 'won', startedAt: 1000, finishedAt }, finishedAt);
}
const emptyStats = (): Accumulator => ({ played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} });

describe('portable profile progress', () => {
  it('merges an offline continuation without allowing a newer empty draft to erase it', () => {
    const continued = doc(game({ guesses: ['termo', 'livro'], startedAt: 1000 }, 2000));
    const stale = doc(game({}, 9000));
    const merged = mergeDocuments(continued, stale);
    expect(merged.games['game-1'].game.guesses).toEqual(['termo', 'livro']);
    expect(merged.conflicts).toBeUndefined();
    expect(mergeDocuments(stale, continued)).toEqual(merged);
    expect(mergeDocuments(merged, merged)).toEqual(merged);
  });

  it('preserves a completed game despite a later divergent draft and keeps the draft as a recovery copy', () => {
    const completed = doc(won());
    const diverged = doc(game({ guesses: ['livro', 'mundo', 'pista'], startedAt: 1100 }, 9999));
    const merged = mergeDocuments(completed, diverged);
    expect(merged.games['game-1'].game.status).toBe('won');
    expect(merged.conflicts?.['game-1'][0].game.guesses).toEqual(['livro', 'mundo', 'pista']);
    expect(documentStats(merged).played).toBe(1);
    expect(documentStats(merged).won).toBe(1);
    expect(mergeDocuments(diverged, completed)).toEqual(merged);
    expect(mergeDocuments(merged, diverged)).toEqual(merged);
  });

  it('recovers every divergent branch when three devices reconnect in different orders', () => {
    const a = doc(game({ guesses: ['termo'], startedAt: 1000 }, 3000));
    const b = doc(game({ guesses: ['livro'], startedAt: 1000 }, 3000));
    const c = doc(game({ guesses: ['mundo', 'pista'], startedAt: 1000 }, 4000));
    const combined = mergeDocuments(mergeDocuments(a, b), c);
    expect(combined).toEqual(mergeDocuments(a, mergeDocuments(c, b)));
    expect(combined.conflicts?.['game-1']).toHaveLength(2);
    expect(documentStats(combined).played).toBe(0);
  });

  it('deduplicates independently created daily games and results across Android and web', () => {
    const dailyConfig: GameConfig = { ...config, mode: 'daily' };
    const browser = won(`daily:${day}:browser-legacy`);
    browser.game.config = dailyConfig;
    const native = game({ id: `daily:${day}:android-legacy`, config: dailyConfig,
      guesses: ['termo'], startedAt: 1000 }, 1500);
    const browserDoc = doc(browser);
    browserDoc.results[browser.game.id] = { id: browser.game.id, language: 'pt', won: true, finishedAt: 2000, attempts: 2 };
    const merged = mergeDocuments(browserDoc, doc(native));
    const id = `daily:${day}:pt:normal:5`;
    expect(Object.keys(merged.games)).toEqual([id]);
    expect(Object.keys(merged.results)).toEqual([id]);
    expect(canonicalGameId(browser.game, day)).toBe(id);
    expect(documentStats(merged).played).toBe(1);
    expect(latestGame(merged, dailyConfig, '2026-10-05')).toBeNull();
    expect(latestGame(merged, dailyConfig, day)?.game.status).toBe('won');
  });

  it('uses terminal game evidence instead of conflicting client summary statistics', () => {
    const submitted = doc(won());
    submitted.results['game-1'] = { id: 'game-1', language: 'en', won: false, finishedAt: 9999, attempts: 6 };
    const merged = mergeDocuments(submitted, emptyDocument());
    expect(merged.results['game-1']).toEqual({ id: 'game-1', language: 'pt', won: true, finishedAt: 2000, attempts: 2 });
    expect(documentStats(merged, 'en').played).toBe(0);
  });

  it('imports old native summaries with unknown attempts, without adding them on every sync', () => {
    const native = emptyDocument();
    native.results['old-native'] = { id: 'old-native', language: 'en', won: true, finishedAt: 1000, attempts: 0 };
    const merged = mergeDocuments(native, mergeDocuments(native, doc(won('new-game'))));
    expect(documentStats(merged)).toMatchObject({ played: 2, won: 2, currentStreak: 2, distribution: { 0: 1, 2: 1 } });
    expect(documentHistory(merged).map(item => item.id)).toEqual(['new-game', 'old-native']);
  });

  it('preserves old web aggregate totals once and computes new streaks in completion order', () => {
    const imported = emptyDocument();
    const old: Accumulator = { played: 12, won: 10, currentStreak: 3, bestStreak: 5, distribution: { 2: 10 } };
    imported.legacy['web-installation-1'] = { pt: old, en: emptyStats(), all: old };
    const history = doc(won('recent-win', 3000));
    history.results['earlier-loss'] = { id: 'earlier-loss', language: 'pt', won: false, finishedAt: 2000, attempts: 6 };
    const merged = mergeDocuments(mergeDocuments(imported, history), imported);
    expect(documentStats(merged)).toMatchObject({ played: 14, won: 11, currentStreak: 1, bestStreak: 5, distribution: { 2: 11 } });
    expect(Object.keys(merged.legacy)).toHaveLength(1);
  });

  it('uses deterministic latest preferences, and selects the latest game for a configuration', () => {
    const a = doc(won('old', 2000)), b = doc(game({ id: 'new' }, 3000));
    a.config = { value: config, updatedAt: 20 };
    b.config = { value: { ...config, language: 'en' }, updatedAt: 30 };
    a.preferences = { value: { highContrast: true, sound: false }, updatedAt: 100 };
    b.preferences = { value: { highContrast: false, sound: true }, updatedAt: 100 };
    const merged = mergeDocuments(a, b);
    expect(mergeDocuments(b, a)).toEqual(merged);
    expect(merged.config?.value.language).toBe('en');
    expect(latestGame(merged, config, day)?.game.id).toBe('new');
  });
});

describe('untrusted wire validation and bounded storage', () => {
  it('rejects extra fields, invalid dates, prototype keys, and fabricated winning states', () => {
    expect(() => parseDocument({ ...emptyDocument(), surprise: 'value' })).toThrow();
    const invalidDay = game(); invalidDay.day = '2026-02-30';
    expect(() => parseDocument(doc(invalidDay))).toThrow();
    expect(() => parseDocument(doc(game({ status: 'won', finishedAt: 1000 })))).toThrow();
    const polluted = JSON.parse('{"version":1,"games":{},"results":{},"config":null,"preferences":null,"legacy":{"__proto__":{}}}');
    expect(() => parseDocument(polluted)).toThrow();
    expect(() => parseDocument(doc(game({ config: { ...config, mode: ['classic'] as never } })))).toThrow();
  });

  it('rejects payload and merged entry overflow instead of silently losing progress', () => {
    expect(() => parseDocument({ ...emptyDocument(), extra: 'x'.repeat(MAX_DOCUMENT_BYTES) })).toThrow('2 MiB');
    const a = emptyDocument(), b = emptyDocument();
    for (let index = 0; index < 5001; index++) {
      const id = `result-${index}`;
      (index < 2500 ? a : b).results[id] = { id, language: 'pt', won: false, finishedAt: index, attempts: 6 };
    }
    expect(() => mergeDocuments(a, b)).toThrow('too many results');
  });

  it('does not mutate either source while normalizing and merging', () => {
    const a = doc(won()), b = emptyDocument(), snapshot = JSON.stringify([a, b]);
    const merged = mergeDocuments(a, b); merged.games['game-1'].game.guesses.push('mundo');
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});
