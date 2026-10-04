import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from './engine';

export type MoveEffect = {
  gameId: string;
  row: number;
  phase: 'reveal' | 'settled';
  solvedBoards: number[];
};

/** Short-lived presentation effects never delay a guess or change persisted game state. */
export function useGameMotion(gameId: string | undefined) {
  const [moves, setMoves] = useState<MoveEffect[]>([]);
  const [invalid, setInvalid] = useState<{ gameId: string; row: number; revision: number } | null>(null);
  const [typingRevisions, setTypingRevisions] = useState<Record<number, number>>({});
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [freshResult, setFreshResult] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{ gameId: string; id: number; mini: boolean } | null>(null);
  const revision = useRef(0);
  const pressRevision = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    setMoves([]); setInvalid(null); setTypingRevisions({}); setPressedKey(null);
    setFreshResult(null); setCelebration(null);
    return () => { timers.current.forEach(clearTimeout); timers.current.clear(); };
  }, [gameId]);

  const press = useCallback((key: string, column?: number) => {
    const currentRevision = ++pressRevision.current;
    setPressedKey(key);
    if (column !== undefined) { const typed = ++revision.current; setTypingRevisions(previous => ({ ...previous, [column]: typed })); }
    setInvalid(null);
    later(() => { if (pressRevision.current === currentRevision) setPressedKey(null); }, 160);
  }, [later]);

  const reject = useCallback((row: number) => {
    if (!gameId) return;
    const currentRevision = ++revision.current;
    setInvalid({ gameId, row, revision: currentRevision });
    setPressedKey(null);
    later(() => setInvalid(previous => previous?.revision === currentRevision ? null : previous), 650);
  }, [gameId, later]);

  const finish = useCallback((id: string) => {
    setFreshResult(id);
    later(() => setFreshResult(previous => previous === id ? null : previous), 3200);
  }, [later]);

  const reveal = useCallback((game: GameState, solvedBoards: number[]) => {
    const row = game.guesses.length - 1;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : 480 + (game.config.length - 1) * 55;
    setInvalid(null); setPressedKey(null);
    setMoves(previous => [...previous, { gameId: game.id, row, phase: 'reveal', solvedBoards }]);
    later(() => {
      setMoves(previous => previous.map(move => move.gameId === game.id && move.row === row ? { ...move, phase: 'settled' } : move));
      if (game.status !== 'playing') finish(game.id);
      if (solvedBoards.length > 0 && !reduced) {
        const id = ++revision.current;
        setCelebration({ gameId: game.id, id, mini: game.status !== 'won' });
        later(() => setCelebration(previous => previous?.id === id ? null : previous), 2400);
      }
      later(() => setMoves(previous => previous.filter(move => move.gameId !== game.id || move.row !== row)), 1000);
    }, duration);
  }, [finish, later]);

  return {
    moves: moves.filter(move => move.gameId === gameId),
    invalid: invalid?.gameId === gameId ? invalid : null,
    typingRevisions, pressedKey,
    freshResult: freshResult === gameId,
    celebration: celebration?.gameId === gameId ? celebration : null,
    press, reject, reveal, finish,
  };
}
