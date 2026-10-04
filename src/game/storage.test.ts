import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameConfig, type GameState } from './engine';
import { createProfileStorage, getHistory, getStats, isStorageAvailable, loadConfig, loadGame, loadPreferences, recordResult, saveConfig, saveGame, savePreferences } from './storage';
import { emptyDocument } from '../sync/model';

const PREFIX = 'xeque-palavras:v1:';
const config: GameConfig = { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 };
let values: Map<string, string>;

function game(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game-1', config: { ...config }, targets: ['carta'], guesses: [], status: 'playing',
    startedAt: null, finishedAt: null, maxAttempts: 6, durationSeconds: null, ...overrides,
  };
}

function won(id = 'win-1', finishedAt = 2000, language: 'pt' | 'en' = 'pt'): GameState {
  return game({ id, config: { ...config, language }, guesses: ['carta'], status: 'won', startedAt: finishedAt - 100, finishedAt });
}

function lost(id = 'loss-1', finishedAt = 3000): GameState {
  return game({ id, guesses: ['termo', 'livro', 'pista', 'mundo', 'gatos', 'bolas'], status: 'lost', startedAt: finishedAt - 100, finishedAt });
}

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
});

describe('personal profiles', () => {
  it('migrates old games to Daniel once and preserves every original byte as backup', () => {
    saveGame(game({ guesses: ['termo'], startedAt: 1000 }));
    recordResult(won());
    saveConfig({ ...config, language: 'en' });
    savePreferences({ highContrast: true, sound: true });
    const originals = new Map(values);
    const larissa = createProfileStorage('larissa');
    expect(larissa.loadGame(config)).toBeNull();
    expect(larissa.getStats().played).toBe(0);
    const daniel = createProfileStorage('daniel');
    expect(daniel.loadGame(config)?.guesses).toEqual(['termo']);
    expect(daniel.getStats().won).toBe(1);
    expect(daniel.loadConfig().language).toBe('en');
    expect(daniel.loadPreferences()).toEqual({ highContrast: true, sound: true });
    for (const [key, value] of originals) expect(values.get(key)).toBe(value);
    expect(JSON.parse(values.get('xeque-palavras:v2:legacy-backup')!)).toEqual(Object.fromEntries(originals));
    expect(createProfileStorage('daniel').getStats().played).toBe(1);
    expect(createProfileStorage('larissa').getStats().played).toBe(0);
  });

  it('keeps delayed writes, game choices and preferences bound to their original profile', () => {
    const daniel = createProfileStorage('daniel');
    const larissa = createProfileStorage('larissa');
    daniel.saveConfig({ ...config, difficulty: 'hard' });
    larissa.saveConfig({ ...config, language: 'en' });
    daniel.savePreferences({ highContrast: true, sound: false });
    const delayedWrite = () => { daniel.saveGame(won('daniel-win')); daniel.recordResult(won('daniel-win')); };
    larissa.saveGame(game({ id: 'larissa-game' }));
    delayedWrite();
    expect(larissa.loadConfig().language).toBe('en');
    expect(larissa.loadPreferences().highContrast).toBe(false);
    expect(larissa.loadGame(config)?.id).toBe('larissa-game');
    expect(larissa.getStats().played).toBe(0);
    expect(createProfileStorage('daniel').getStats().won).toBe(1);
    expect(createProfileStorage('daniel').loadConfig().difficulty).toBe('hard');
  });

  it('preserves lifetime totals older than the retained history without double counting after cloud echo', () => {
    const history = Array.from({ length: 500 }, (_, index) => won(`old-${index}`, 1000 + index));
    const totals = { played: 600, won: 600, currentStreak: 600, bestStreak: 600, distribution: { 1: 600 } };
    values.set(PREFIX + 'results', JSON.stringify({ version: 1, history, seenIds: history.map(item => item.id), stats: {
      all: totals, pt: totals, en: { played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} },
    } }));
    const daniel = createProfileStorage('daniel');
    expect(daniel.getStats().played).toBe(600);
    expect(Object.keys(daniel.getDocument().legacy)).toHaveLength(1);
    daniel.mergeRemote(daniel.getDocument());
    expect(createProfileStorage('daniel').getStats().played).toBe(600);
  });

  it('merges stale cloud replies into current progress instead of losing an in-flight guess', () => {
    const daniel = createProfileStorage('daniel');
    daniel.saveGame(game());
    const stale = daniel.getDocument();
    daniel.saveGame(won('game-1'));
    daniel.recordResult(won('game-1'));
    daniel.mergeRemote(stale);
    expect(daniel.loadGame(config)?.status).toBe('won');
    expect(daniel.getStats().played).toBe(1);
    expect(() => daniel.mergeRemote({ ...emptyDocument(), version: 100 })).toThrow();
    expect(daniel.loadGame(config)?.status).toBe('won');
  });

  it('does not count an evicted terminal game slot a second time during legacy migration', () => {
    const old = won('evicted');
    const earlier = { played: 1, won: 1, currentStreak: 1, bestStreak: 1, distribution: { 1: 1 } };
    const zero = { played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} };
    values.set(PREFIX + 'results', JSON.stringify({ version: 1, history: [], seenIds: ['evicted'], beforeHistory: { all: earlier, pt: earlier, en: zero } }));
    values.set(PREFIX + 'game:pt:classic:normal:5', JSON.stringify({ version: 1, savedAt: 3000, game: old }));
    const daniel = createProfileStorage('daniel');
    expect(daniel.getStats().played).toBe(1);
    expect(daniel.getStats().won).toBe(1);
    expect(JSON.parse(values.get('xeque-palavras:v2:legacy-backup')!)[PREFIX + 'game:pt:classic:normal:5']).toBe(values.get(PREFIX + 'game:pt:classic:normal:5'));
  });

  it('backs up an unreadable profile document before any new progress can replace it', () => {
    const key = 'xeque-palavras:v2:profile:daniel';
    const original = '{"version":1,"games":broken';
    values.set(key, original);
    const daniel = createProfileStorage('daniel');
    daniel.saveGame(game());
    expect([...values.entries()].find(([entry]) => entry.startsWith(key + ':recovery:'))?.[1]).toBe(original);
    expect(daniel.loadGame(config)?.id).toBe('game-1');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('configuration and preferences', () => {
  it('probes persistence without keeping a probe value and reports disabled storage', () => {
    expect(isStorageAvailable()).toBe(true);
    expect(values.size).toBe(0);
    vi.stubGlobal('localStorage', undefined);
    expect(isStorageAvailable()).toBe(false);
    vi.stubGlobal('localStorage', { setItem() { throw new Error('quota'); }, removeItem() {} });
    expect(isStorageAvailable()).toBe(false);
    vi.stubGlobal('localStorage', { setItem() {}, removeItem() { throw new Error('disabled'); } });
    expect(isStorageAvailable()).toBe(false);
  });

  it('returns independent defaults and restores valid choices', () => {
    const initial = loadConfig();
    expect(initial).toEqual(config);
    initial.language = 'en';
    expect(loadConfig()).toEqual(config);
    const chosen: GameConfig = { language: 'en', mode: 'quartet', difficulty: 'hard', length: 8 };
    saveConfig(chosen);
    expect(loadConfig()).toEqual(chosen);
    expect(loadPreferences()).toEqual({ highContrast: false, sound: false });
    savePreferences({ highContrast: true, sound: true });
    expect(loadPreferences()).toEqual({ highContrast: true, sound: true });
  });

  it('ignores broken JSON, unknown versions, and invalid settings', () => {
    values.set(PREFIX + 'config', '{broken');
    expect(loadConfig()).toEqual(config);
    values.set(PREFIX + 'config', JSON.stringify({ version: 2, config: { ...config, language: 'en' } }));
    expect(loadConfig()).toEqual(config);
    values.set(PREFIX + 'config', JSON.stringify({ version: 1, config: { ...config, length: 999 } }));
    expect(loadConfig()).toEqual(config);
    values.set(PREFIX + 'config', JSON.stringify({ version: 1, config: { ...config, language: ['en'] } }));
    expect(loadConfig()).toEqual(config);
    values.set(PREFIX + 'config', JSON.stringify({ version: 1, config: { ...config, mode: ['daily'] } }));
    expect(loadConfig()).toEqual(config);
    values.set(PREFIX + 'preferences', JSON.stringify({ version: 1, preferences: { sound: 'true', highContrast: true } }));
    expect(loadPreferences()).toEqual({ highContrast: true, sound: false });
  });

  it('keeps every public operation usable when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('disabled'); },
      setItem() { throw new Error('quota'); },
    });
    expect(() => {
      saveConfig(config);
      saveGame(game());
      savePreferences({ highContrast: true, sound: true });
      recordResult(won());
    }).not.toThrow();
    expect(loadConfig()).toEqual(config);
    expect(loadGame(config)).toBeNull();
    expect(getStats().played).toBe(0);
    expect(getHistory()).toEqual([]);
    expect(loadPreferences().sound).toBe(false);
  });
});

describe('game persistence', () => {
  it('keeps progress separate for language, mode, difficulty, and word length', () => {
    const current = game({ guesses: ['termo'], startedAt: 1000 });
    saveGame(current);
    expect(loadGame(config)).toEqual(current);
    for (const otherConfig of [
      { ...config, language: 'en' as const }, { ...config, mode: 'duo' as const },
      { ...config, difficulty: 'easy' as const }, { ...config, length: 6 },
    ]) expect(loadGame(otherConfig)).toBeNull();
    saveGame(game({ id: 'new-practice-game' }));
    expect(loadGame(config)?.id).toBe('new-practice-game');
  });

  it('ignores a mismatched payload and malformed or impossible game states', () => {
    const key = PREFIX + 'game:pt:classic:normal:5';
    const invalid = [
      game({ config: { ...config, language: 'en' } }),
      game({ targets: ['abcd'] }), game({ targets: ['carta', 'carta'] }),
      game({ guesses: ['carta'] }), game({ maxAttempts: 50 }),
      game({ guesses: ['termo', 'termo'], startedAt: 10 }),
      game({ status: 'won', startedAt: 10, finishedAt: 20 }),
      game({ status: 'lost', startedAt: 10, finishedAt: 20 }),
      won('bad-clock', -10), { id: 'incomplete' },
    ];
    for (const payload of invalid) {
      values.set(key, JSON.stringify({ version: 1, game: payload }));
      expect(loadGame(config)).toBeNull();
    }
  });

  it('retains a daily result and changes its slot at local midnight', () => {
    vi.useFakeTimers();
    const beforeMidnight = new Date(2026, 9, 3, 23, 59, 0).getTime();
    const nextDay = new Date(2026, 9, 4, 0, 1, 0).getTime();
    vi.setSystemTime(beforeMidnight);
    const dailyConfig: GameConfig = { ...config, mode: 'daily' };
    const daily = createGame(dailyConfig, ['carta'], undefined, beforeMidnight);
    saveGame(daily);
    const finished: GameState = { ...daily, guesses: ['carta'], status: 'won', startedAt: beforeMidnight, finishedAt: beforeMidnight + 1000 };
    saveGame(finished);
    saveGame(daily);
    expect(loadGame(dailyConfig, beforeMidnight)).toEqual(finished);
    vi.setSystemTime(nextDay);
    expect(loadGame(dailyConfig, nextDay)).toBeNull();
    saveGame(finished);
    expect(loadGame(dailyConfig, nextDay)).toBeNull();
    expect(loadGame(dailyConfig, beforeMidnight)).toEqual(finished);
    const tomorrow = createGame(dailyConfig, ['carta'], undefined, nextDay);
    saveGame(tomorrow);
    expect(loadGame(dailyConfig, nextDay)).toEqual(tomorrow);
  });

  it('rejects a replacement or regression of a daily game in progress', () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 3, 12).getTime();
    vi.setSystemTime(now);
    const dailyConfig: GameConfig = { ...config, mode: 'daily' };
    const original = createGame(dailyConfig, ['carta'], undefined, now);
    const progress = { ...original, guesses: ['termo'], startedAt: now };
    saveGame(original);
    saveGame(progress);
    saveGame(original);
    saveGame(createGame(dailyConfig, ['carta'], undefined, now + 1000));
    expect(loadGame(dailyConfig)).toEqual(progress);
  });

  it('ignores misplaced daily payloads without blocking a correct replacement', () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 3, 12).getTime();
    vi.setSystemTime(now);
    const dailyConfig: GameConfig = { ...config, mode: 'daily' };
    const correct = createGame(dailyConfig, ['carta'], undefined, now);
    const key = PREFIX + 'game:pt:daily:normal:5:2026-10-03';
    values.set(key, JSON.stringify({ version: 1, game: { ...correct, config: { ...dailyConfig, language: 'en' } } }));
    expect(loadGame(dailyConfig)).toBeNull();
    saveGame(correct);
    expect(loadGame(dailyConfig)).toEqual(correct);
    values.set(key, JSON.stringify({ version: 1, game: { ...correct, id: correct.id.replace('2026-10-03', '2026-10-02') } }));
    expect(loadGame(dailyConfig)).toBeNull();
    saveGame(correct);
    expect(loadGame(dailyConfig)).toEqual(correct);
  });
});

describe('results and statistics', () => {
  it('records completed games once by ID and tracks language-specific streaks', () => {
    recordResult(game());
    recordResult(won());
    recordResult(won());
    recordResult(won('win-2', 2500));
    recordResult(lost());
    recordResult(won('english-win', 4000, 'en'));
    recordResult(won('english-win', 4500, 'pt'));
    expect(getStats()).toEqual({ played: 4, won: 3, winRate: 75, currentStreak: 1, bestStreak: 2, distribution: { 1: 3 } });
    expect(getStats('pt')).toEqual({ played: 3, won: 2, winRate: 67, currentStreak: 0, bestStreak: 2, distribution: { 1: 2 } });
    expect(getStats('en').played).toBe(1);
    expect(getHistory().map(entry => entry.id)).toEqual(['english-win', 'loss-1', 'win-2', 'win-1']);
  });

  it('exposes only the most recent 50 games in each language', () => {
    for (let index = 0; index < 55; index += 1) recordResult(won(`pt-${index}`, 2000 + index));
    recordResult(won('en-1', 3000, 'en'));
    expect(getHistory()).toHaveLength(50);
    expect(getHistory('pt')).toHaveLength(50);
    expect(getHistory('pt')[0].id).toBe('pt-54');
    expect(getHistory('pt')[49].id).toBe('pt-5');
    expect(getHistory('en')).toHaveLength(1);
    expect(getStats().played).toBe(56);
  });

  it('orders streaks by completion when an expired Blitz is discovered after a later win', () => {
    recordResult(won('before-blitz', 1000));
    recordResult(won('after-blitz', 130000));
    expect(getStats().bestStreak).toBe(2);
    const expired = game({ id: 'expired-blitz', config: { ...config, mode: 'blitz' },
      guesses: ['termo'], status: 'lost', startedAt: 2000, finishedAt: 122000, durationSeconds: 120 });
    recordResult(expired);
    expect(getStats()).toMatchObject({ played: 3, won: 2, currentStreak: 1, bestStreak: 1 });
    expect(getStats('pt')).toMatchObject({ currentStreak: 1, bestStreak: 1 });
    expect(getHistory().map(entry => entry.id)).toEqual(['after-blitz', 'expired-blitz', 'before-blitz']);
  });

  it('discards malformed history entries and reconstructs damaged statistics', () => {
    values.set(PREFIX + 'results', JSON.stringify({
      version: 1, history: [won(), { id: 'invalid' }, game(), won()], seenIds: ['win-1', 10], stats: { all: { played: 'oops' } },
    }));
    expect(getHistory()).toEqual([won()]);
    expect(getStats().played).toBe(1);
    recordResult(won());
    expect(getStats().played).toBe(1);
    recordResult(lost());
    expect(getStats().played).toBe(2);
  });

  it('preserves lifetime counts after pruning the stored history', () => {
    const history = Array.from({ length: 500 }, (_, index) => won(`old-${index}`, 1000 + index));
    const accumulated = { played: 600, won: 600, currentStreak: 600, bestStreak: 600, distribution: { 1: 600 } };
    values.set(PREFIX + 'results', JSON.stringify({ version: 1, history, seenIds: history.map(entry => entry.id), stats: {
      all: accumulated, pt: accumulated, en: { played: 0, won: 0, currentStreak: 0, bestStreak: 0, distribution: {} },
    } }));
    recordResult(won('latest', 3000));
    expect(getStats().played).toBe(601);
    expect(getStats().bestStreak).toBe(601);
    const persisted = JSON.parse(values.get(PREFIX + 'results')!);
    expect(persisted.history).toHaveLength(500);
    expect(persisted.history[0].id).toBe('latest');
    recordResult(history[0]);
    expect(getStats().played).toBe(601);
    recordResult(lost('delayed-loss', 2500));
    expect(getStats()).toMatchObject({ played: 602, won: 601, currentStreak: 1, bestStreak: 600 });
  });
});
