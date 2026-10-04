export type Language = 'pt' | 'en';
export type Mode = 'classic' | 'daily' | 'duo' | 'quartet' | 'blitz';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type LetterState = 'correct' | 'present' | 'absent';

export interface GameConfig {
  language: Language;
  mode: Mode;
  difficulty: Difficulty;
  length: number;
}

export interface GameState {
  id: string;
  config: GameConfig;
  targets: string[];
  guesses: string[];
  status: 'playing' | 'won' | 'lost';
  startedAt: number | null;
  finishedAt: number | null;
  maxAttempts: number;
  durationSeconds: number | null;
}

export type GuessError = 'length' | 'unknown' | 'duplicate' | 'finished';

export interface GuessResult {
  game: GameState;
  error?: GuessError;
}

/** Both dictionaries and guesses use the same case- and accent-insensitive form. */
export function normalizeWord(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Reserve exact matches first so repeated letters cannot claim the same tile. */
export function evaluateGuess(guess: string, target: string): LetterState[] {
  const normalizedGuess = normalizeWord(guess);
  const normalizedTarget = normalizeWord(target);
  const result: LetterState[] = Array.from(normalizedGuess, () => 'absent');
  const remaining: Record<string, number> = {};

  for (let index = 0; index < normalizedTarget.length; index += 1) {
    const letter = normalizedTarget[index];
    if (normalizedGuess[index] === letter) {
      result[index] = 'correct';
    } else {
      remaining[letter] = (remaining[letter] ?? 0) + 1;
    }
  }

  for (let index = 0; index < normalizedGuess.length; index += 1) {
    if (result[index] === 'correct') continue;
    const letter = normalizedGuess[index];
    if ((remaining[letter] ?? 0) > 0) {
      result[index] = 'present';
      remaining[letter] -= 1;
    }
  }

  return result;
}

export function getBoardCount(mode: Mode): number {
  return mode === 'quartet' ? 4 : mode === 'duo' ? 2 : 1;
}

export function getMaxAttempts(config: GameConfig): number {
  const base = { easy: 8, normal: 6, hard: 5 }[config.difficulty];
  return base + (config.mode === 'quartet' ? 4 : config.mode === 'duo' ? 2 : 0);
}

/** Calendar dates deliberately follow the player's local timezone, not UTC. */
export function getDailyKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame(
  config: GameConfig,
  pool: string[],
  seed?: string,
  now = Date.now(),
): GameState {
  if (!Number.isInteger(config.length) || config.length < 1) {
    throw new Error('Word length must be a positive integer.');
  }

  // Sorting makes the daily challenge independent of the dictionary's input order.
  const candidates = [...new Set(pool.map(normalizeWord))]
    .filter((word) => word.length === config.length)
    .sort();
  const boardCount = getBoardCount(config.mode);
  if (candidates.length < boardCount) {
    throw new Error(`At least ${boardCount} distinct ${config.length}-letter words are required.`);
  }

  const dailyKey = getDailyKey(new Date(now));
  const dailySeed = `${dailyKey}:${config.language}:${config.length}:${config.difficulty}`;
  const gameSeed = seed ?? (config.mode === 'daily' ? dailySeed : `${now}:${Math.random()}`);
  const random = seededRandom(gameSeed);

  // Partial Fisher-Yates selection avoids repeated targets on simultaneous boards.
  for (let index = 0; index < boardCount; index += 1) {
    const selected = index + Math.floor(random() * (candidates.length - index));
    [candidates[index], candidates[selected]] = [candidates[selected], candidates[index]];
  }

  return {
    id: config.mode === 'daily'
      ? `daily:${dailyKey}:${now}:${hashSeed(gameSeed).toString(36)}`
      : `${config.mode}-${now}-${hashSeed(gameSeed).toString(36)}`,
    config: { ...config },
    targets: candidates.slice(0, boardCount),
    guesses: [],
    status: 'playing',
    startedAt: null,
    finishedAt: null,
    maxAttempts: getMaxAttempts(config),
    durationSeconds: config.mode === 'blitz' ? 120 : null,
  };
}

export function isBoardSolved(game: GameState, index: number): boolean {
  const target = game.targets[index];
  return target !== undefined && game.guesses.includes(target);
}

/** A finished game retains the remaining time at the instant it ended. */
export function getRemainingSeconds(game: GameState, now = Date.now()): number | null {
  if (game.durationSeconds === null) return null;
  if (game.startedAt === null) return game.durationSeconds;
  const measuredAt = game.finishedAt ?? now;
  const elapsed = Math.max(0, measuredAt - game.startedAt);
  return Math.max(0, Math.ceil(game.durationSeconds - elapsed / 1000));
}

export function expireGame(game: GameState, now = Date.now()): GameState {
  if (game.status !== 'playing' || game.startedAt === null || game.durationSeconds === null) {
    return game;
  }
  const deadline = game.startedAt + game.durationSeconds * 1000;
  if (now < deadline) return game;
  return { ...game, status: 'lost', finishedAt: deadline };
}

export function submitGuess(
  game: GameState,
  guess: string,
  validWords: ReadonlySet<string>,
  now = Date.now(),
): GuessResult {
  const current = expireGame(game, now);
  if (current.status !== 'playing') return { game: current, error: 'finished' };

  const normalized = normalizeWord(guess);
  if (normalized.length !== current.config.length) return { game: current, error: 'length' };
  // validWords is the normalized dictionary set, shared by every board.
  if (!validWords.has(normalized)) return { game: current, error: 'unknown' };
  if (current.guesses.includes(normalized)) return { game: current, error: 'duplicate' };

  const guesses = [...current.guesses, normalized];
  const won = current.targets.every((target) => guesses.includes(target));
  const lost = !won && guesses.length >= current.maxAttempts;
  return {
    game: {
      ...current,
      guesses,
      startedAt: current.startedAt ?? now,
      finishedAt: won || lost ? now : null,
      status: won ? 'won' : lost ? 'lost' : 'playing',
    },
  };
}

/** Keyboard feedback belongs to the selected board; exact matches never downgrade. */
export function getKeyboardStates(game: GameState, boardIndex = 0): Record<string, LetterState> {
  const target = game.targets[boardIndex];
  if (target === undefined) return {};
  const states: Record<string, LetterState> = {};
  const strength: Record<LetterState, number> = { absent: 0, present: 1, correct: 2 };
  for (const guess of game.guesses) {
    const evaluation = evaluateGuess(guess, target);
    for (let index = 0; index < guess.length; index += 1) {
      const letter = guess[index];
      const state = evaluation[index];
      const previous = states[letter];
      if (previous === undefined || strength[state] > strength[previous]) states[letter] = state;
    }
    // Solved boards freeze their visible rows; their keyboard must show those same clues.
    if (guess === target) break;
  }
  return states;
}
