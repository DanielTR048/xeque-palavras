import { useCallback, useEffect, useRef, useState } from 'react';
import { profileStorageKey, type ProfileStorage } from '../game/storage';

export type SyncStatus = 'checking' | 'syncing' | 'synced' | 'offline' | 'local' | 'error';
export function useProfileSync(storage: ProfileStorage) {
  const [status, setStatus] = useState<SyncStatus>(navigator.onLine ? 'checking' : 'offline');
  const [canPair, setCanPair] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [ready, setReady] = useState(!navigator.onLine);
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    let alive = true;
    let busy = false;
    let pending = false;
    let authenticated = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const sync = async () => {
      if (!alive) return;
      if (!navigator.onLine) { setStatus('offline'); setReady(true); return; }
      if (busy) { pending = true; return; }
      busy = true;
      pending = false;
      setStatus('syncing');
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 20_000);
      try {
        if (!authenticated) {
          const response = await fetch('/api/session', { credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json' } });
          if (response.status === 401 || response.status === 403) { if (alive) { setCanPair(false); setStatus('local'); } return; }
          if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Session unavailable');
          const session = await response.json() as { authenticated?: boolean; canPair?: boolean };
          if (!session.authenticated) { if (alive) setStatus('local'); return; }
          authenticated = true;
          if (alive) setCanPair(session.canPair === true);
        }
        const before = storage.getRevision();
        const response = await fetch('/api/sync', {
          method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ profile: storage.profile, document: storage.getDocument() }),
        });
        if (response.status === 401 || response.status === 403) {
          authenticated = false; if (alive) { setCanPair(false); setStatus('local'); } return;
        }
        if (!response.ok) throw new Error(`Sync ${response.status}`);
        const result = await response.json() as { document: unknown };
        // Merge against the current document: guesses made during the request must survive.
        const changedWhileSending = storage.getRevision() !== before;
        if (!alive) return;
        storage.mergeRemote(result.document);
        pending ||= changedWhileSending;
        setLastSynced(Date.now()); setStatus('synced');
      } catch {
        if (alive) setStatus(navigator.onLine ? 'error' : 'offline');
      } finally {
        clearTimeout(timeout); busy = false;
        if (alive) setReady(true);
        if (alive && pending) { pending = false; debounce = setTimeout(() => void sync(), 1200); }
      }
    };
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      if (!navigator.onLine) { setStatus('offline'); return; }
      setStatus('syncing');
      debounce = setTimeout(() => void sync(), 1200);
    };
    const unsubscribe = storage.subscribe(source => { if (source === 'local') schedule(); });
    const online = () => { authenticated = false; void sync(); };
    const offline = () => setStatus('offline');
    const focus = () => { if (document.visibilityState === 'visible') void sync(); };
    const otherTab = (event: StorageEvent) => {
      if (event.key !== profileStorageKey(storage.profile) || !event.newValue) return;
      try { storage.mergeRemote(JSON.parse(event.newValue)); void sync(); } catch { /* Reject malformed cross-tab changes. */ }
    };
    retryRef.current = () => { authenticated = false; void sync(); };
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    window.addEventListener('focus', focus); window.addEventListener('storage', otherTab);
    document.addEventListener('visibilitychange', focus);
    const poll = setInterval(focus, 30_000);
    void sync();
    return () => {
      alive = false; controller?.abort(); clearTimeout(debounce); clearInterval(poll); unsubscribe();
      window.removeEventListener('online', online); window.removeEventListener('offline', offline);
      window.removeEventListener('focus', focus); window.removeEventListener('storage', otherTab);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [storage]);
  return { status, canPair, lastSynced, ready, retry };
}
export type ProfileSync = ReturnType<typeof useProfileSync>;
