import { describe, expect, it } from 'vitest';
import {
  createGame,
  evaluateGuess,
  expireGame,
  getBoardCount,
  getDailyKey,
  getKeyboardStates,
  getMaxAttempts,
  getRemainingSeconds,
  isBoardSolved,
  normalizeWord,
  submitGuess,
  type GameConfig,
  type GameState,
} from './engine';

const config: GameConfig = { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 };
const pool = ['termo', 'torre', 'campo', 'livro', 'peixe', 'papel', 'festa', 'mundo', 'nobre', 'sonho'];
const dictionary = new Set(pool);
const gameWithTarget = (target = 'termo', overrides: Partial<GameConfig> = {}): GameState =>
  createGame({ ...config, ...overrides }, [target], 'test', 1000);

describe('normalization and letter evaluation', () => {
  it('normalizes case, Portuguese accents and cedillas', () => {
    expect(normalizeWord(' AÇÕES ')).toBe('acoes');
    expect(normalizeWord('Órgão')).toBe('orgao');
    expect(normalizeWord('QUEEN')).toBe('queen');
  });

  it('reserves the correct occurrences before awarding misplaced duplicates', () => {
    expect(evaluateGuess('arara', 'carta')).toEqual(['present', 'present', 'absent', 'absent', 'correct']);
    expect(evaluateGuess('papal', 'papel')).toEqual(['correct', 'correct', 'correct', 'absent', 'correct']);
    expect(evaluateGuess('aaaaa', 'carta')).toEqual(['absent', 'correct', 'absent', 'absent', 'correct']);
  });

  it('compares Portuguese accented spellings using their normalized letters', () => {
    expect(evaluateGuess('ÓRGÃO', 'orgao')).toEqual(Array(5).fill('correct'));
  });
});

describe('game creation and configuration', () => {
  it('selects distinct normalized targets without mutating the source dictionary', () => {
    const source = ['termo', 'TORRE', 'torre', 'campo', 'livro', 'casa'];
    const original = [...source];
    const game = createGame({ ...config, mode: 'quartet' }, source, 'four', 1000);
    expect(game.targets).toHaveLength(4);
    expect(new Set(game.targets).size).toBe(4);
    expect(game.targets.every((word) => word.length === 5 && word === word.toLowerCase())).toBe(true);
    expect(source).toEqual(original);
    expect(game.config).not.toBe(config);
  });

  it('refuses an insufficient pool instead of duplicating answers', () => {
    expect(() => createGame({ ...config, mode: 'duo' }, ['termo', 'TERMO'])).toThrow(/distinct/);
    expect(() => createGame({ ...config, length: 0 }, pool)).toThrow(/positive integer/);
  });

  it('sets board counts and difficulty budgets', () => {
    expect(['classic', 'daily', 'blitz', 'duo', 'quartet'].map((mode) =>
      getBoardCount(mode as GameConfig['mode']))).toEqual([1, 1, 1, 2, 4]);
    expect(getMaxAttempts({ ...config, difficulty: 'easy' })).toBe(8);
    expect(getMaxAttempts(config)).toBe(6);
    expect(getMaxAttempts({ ...config, difficulty: 'hard' })).toBe(5);
    expect(getMaxAttempts({ ...config, mode: 'duo' })).toBe(8);
    expect(getMaxAttempts({ ...config, mode: 'quartet', difficulty: 'hard' })).toBe(9);
  });

  it('reproduces targets from an explicit seed', () => {
    const first = createGame({ ...config, mode: 'quartet' }, pool, 'same', 1000);
    const second = createGame({ ...config, mode: 'quartet' }, [...pool].reverse(), 'same', 9000);
    expect(first.targets).toEqual(second.targets);
  });

  it('keeps the daily challenge stable during the local calendar day', () => {
    const morning = new Date(2026, 9, 3, 0, 1).getTime();
    const evening = new Date(2026, 9, 3, 23, 59).getTime();
    const dailyConfig: GameConfig = { ...config, mode: 'daily' };
    expect(getDailyKey(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
    const first = createGame(dailyConfig, pool, undefined, morning);
    const second = createGame(dailyConfig, [...pool].reverse(), undefined, evening);
    expect(first.targets).toEqual(second.targets);
    expect(first.targets).toEqual(createGame(dailyConfig, pool, '2026-10-03:pt:5:normal', morning).targets);
  });
});

describe('guess submission', () => {
  it('rejects invalid inputs without spending attempts or starting the clock', () => {
    const game = gameWithTarget();
    expect(submitGuess(game, 'oi', dictionary, 2000)).toEqual({ game, error: 'length' });
    expect(submitGuess(game, 'zzzzz', dictionary, 2000)).toEqual({ game, error: 'unknown' });
    expect(game.guesses).toEqual([]);
    expect(game.startedAt).toBeNull();
  });

  it('normalizes accepted guesses and never mutates previous state', () => {
    const game = gameWithTarget();
    const result = submitGuess(game, 'CAMPO', dictionary, 2000);
    expect(result.error).toBeUndefined();
    expect(result.game.guesses).toEqual(['campo']);
    expect(result.game.startedAt).toBe(2000);
    expect(game.guesses).toEqual([]);
    expect(game.startedAt).toBeNull();
    expect(submitGuess(result.game, 'campo', dictionary, 3000)).toEqual({ game: result.game, error: 'duplicate' });
  });

  it('wins simultaneous games only after every board is solved', () => {
    let game = createGame({ ...config, mode: 'quartet' }, pool.slice(0, 4), 'four', 1000);
    const targets = [...game.targets];
    for (let index = 0; index < targets.length; index += 1) {
      game = submitGuess(game, targets[index], dictionary, 2000 + index).game;
      expect(isBoardSolved(game, index)).toBe(true);
      expect(game.status).toBe(index === targets.length - 1 ? 'won' : 'playing');
    }
    expect(game.finishedAt).toBe(2003);
    expect(submitGuess(game, 'festa', dictionary, 4000)).toEqual({ game, error: 'finished' });
  });

  it('loses at the attempt budget and still permits a winning final attempt', () => {
    let game = gameWithTarget('termo', { difficulty: 'hard' });
    for (const word of ['torre', 'campo', 'livro', 'peixe']) {
      game = submitGuess(game, word, dictionary, 2000).game;
    }
    expect(game.status).toBe('playing');
    expect(submitGuess(game, 'papel', dictionary, 3000).game.status).toBe('lost');
    const finalWin = submitGuess(game, 'termo', dictionary, 3000).game;
    expect(finalWin.status).toBe('won');
    expect(finalWin.guesses).toHaveLength(5);
  });

  it('reports keyboard hints for the selected board and preserves their strongest state', () => {
    const game = {
      ...createGame({ ...config, mode: 'duo' }, ['torre', 'campo'], 'keyboard'),
      targets: ['torre', 'campo'],
      guesses: ['termo', 'papel'],
    };
    expect(getKeyboardStates(game, 0)).toMatchObject({ t: 'correct', r: 'correct', e: 'present', o: 'present', p: 'absent' });
    expect(getKeyboardStates(game, 1)).toMatchObject({ t: 'absent', a: 'correct', m: 'present', o: 'correct', p: 'present' });
    expect(getKeyboardStates(game, 9)).toEqual({});
    expect(isBoardSolved(game, 9)).toBe(false);
  });

  it('stops keyboard feedback at the solving guess, matching the frozen visible board', () => {
    const game = {
      ...createGame({ ...config, mode: 'duo' }, ['torre', 'campo'], 'keyboard'),
      targets: ['torre', 'campo'],
      guesses: ['torre', 'campo'],
    };
    expect(getKeyboardStates(game, 0)).toEqual({ t: 'correct', o: 'correct', r: 'correct', e: 'correct' });
    expect(getKeyboardStates(game, 1)).toMatchObject({ c: 'correct', a: 'correct', m: 'correct', p: 'correct', o: 'correct' });
  });
});

describe('blitz clock', () => {
  it('starts only on an accepted guess and never resets', () => {
    const game = gameWithTarget('termo', { mode: 'blitz' });
    expect(getRemainingSeconds(game, 100000)).toBe(120);
    expect(expireGame(game, 100000)).toBe(game);
    expect(submitGuess(game, 'zzzzz', dictionary, 2000).game.startedAt).toBeNull();
    const first = submitGuess(game, 'campo', dictionary, 2000).game;
    const second = submitGuess(first, 'livro', dictionary, 32000).game;
    expect(second.startedAt).toBe(2000);
    expect(getRemainingSeconds(second, 32000)).toBe(90);
    expect(submitGuess(second, 'campo', dictionary, 62000).game.startedAt).toBe(2000);
    expect(getRemainingSeconds(second, 62000)).toBe(60);
  });

  it('expires exactly at the deadline, including when a winning submission arrives then', () => {
    const first = submitGuess(gameWithTarget('termo', { mode: 'blitz' }), 'campo', dictionary, 2000).game;
    expect(getRemainingSeconds(first, 121999)).toBe(1);
    expect(expireGame(first, 121999)).toBe(first);
    const expired = expireGame(first, 122000);
    expect(expired.status).toBe('lost');
    expect(expired.finishedAt).toBe(122000);
    expect(getRemainingSeconds(expired, 999999)).toBe(0);
    expect(submitGuess(first, 'termo', dictionary, 122000)).toEqual({ game: expired, error: 'finished' });
    expect(expireGame(first, 999999).finishedAt).toBe(122000);
  });

  it('freezes the time remaining on victory and leaves untimed games unaffected', () => {
    const started = submitGuess(gameWithTarget('termo', { mode: 'blitz' }), 'campo', dictionary, 2000).game;
    const won = submitGuess(started, 'termo', dictionary, 12000).game;
    expect(getRemainingSeconds(won, 999999)).toBe(110);
    expect(expireGame(won, 999999)).toBe(won);
    const untimed = submitGuess(gameWithTarget(), 'campo', dictionary, 2000).game;
    expect(getRemainingSeconds(untimed, 999999)).toBeNull();
    expect(expireGame(untimed, 999999)).toBe(untimed);
  });
});
