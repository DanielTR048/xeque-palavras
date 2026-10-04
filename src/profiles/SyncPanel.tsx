import { useState } from 'react';
import { Cloud, CloudOff, RefreshCw, Smartphone } from 'lucide-react';
import type { Language } from '../game/engine';
import type { ProfileSync, SyncStatus } from './useProfileSync';

const labels: Record<Language, Record<SyncStatus, string>> = {
  pt: { checking: 'Conectando seu progresso…', syncing: 'Sincronizando…', synced: 'Sincronizado · site + Android', offline: 'Offline · salvo neste aparelho', local: 'Salvo aqui · entre no site para sincronizar', error: 'Salvo aqui · tentar sincronizar' },
  en: { checking: 'Connecting your progress…', syncing: 'Syncing…', synced: 'Synced · web + Android', offline: 'Offline · saved on this device', local: 'Saved here · sign in to sync', error: 'Saved here · retry sync' },
};
export function SyncIndicator({ sync, language, onClick }: { sync: ProfileSync; language: Language; onClick: () => void }) {
  const spinning = sync.status === 'checking' || sync.status === 'syncing';
  return <button className={`sync-indicator sync-${sync.status}`} onClick={onClick} aria-label={labels[language][sync.status]} title={labels[language][sync.status]}>{spinning ? <RefreshCw size={13} className="sync-spin" /> : sync.status === 'synced' ? <Cloud size={13} /> : <CloudOff size={13} />}<span>{labels[language][sync.status]}</span></button>;
}

type Device = { id?: string; deviceId?: string; deviceName?: string; name?: string; label?: string; createdAt?: number; revokedAt?: number | null };
export function SyncPanel({ sync, language }: { sync: ProfileSync; language: Language }) {
  const english = language === 'en';
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const list = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/devices', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error();
      const result = await response.json() as { devices: Device[] };
      if (!Array.isArray(result.devices)) throw new Error();
      setDevices(result.devices.filter(device => !device.revokedAt));
    } catch { setMessage(english ? 'Could not load devices. Try again.' : 'Não foi possível carregar os aparelhos. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const revoke = async (device: Device) => {
    const id = device.id ?? device.deviceId;
    if (!id) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!response.ok) throw new Error();
      setDevices(items => items?.filter(item => (item.id ?? item.deviceId) !== id) ?? null);
      setMessage(english ? 'Device disconnected. Its offline progress stays on the device.' : 'Aparelho desconectado. O progresso offline continua no aparelho.');
    } catch { setMessage(english ? 'Could not disconnect. Try again.' : 'Não foi possível desconectar. Tente novamente.'); }
    finally { setBusy(false); }
  };
  return <section className="sync-settings"><h3><Smartphone size={17} />{english ? 'Web + Android' : 'Site + Android'}</h3>
    <p>{english ? 'In the Android app, open Sync and choose Connect. Approve the connection on this site. Daniel and Larissa each keep their own games and statistics.' : 'No aplicativo Android, abra Sincronização e escolha Conectar. Autorize a conexão neste site. Daniel e Larissa mantêm suas próprias partidas e estatísticas.'}</p>
    <p role="status">{labels[language][sync.status]}</p>
    <div className="sync-actions"><button className="secondary-button" onClick={sync.retry}><RefreshCw size={13} />{english ? 'Sync now' : 'Sincronizar agora'}</button>{sync.canPair && <button className="secondary-button" disabled={busy} onClick={() => void list()}>{english ? 'Connected devices' : 'Aparelhos conectados'}</button>}</div>
    {devices && <div className="sync-device-list">{devices.length ? devices.map(device => <div className="sync-device" key={device.id ?? device.deviceId}><span>{device.label ?? device.deviceName ?? device.name ?? 'Android'}</span><button disabled={busy} onClick={() => void revoke(device)}>{english ? 'Disconnect' : 'Desconectar'}</button></div>) : <p>{english ? 'No connected devices yet.' : 'Nenhum aparelho conectado ainda.'}</p>}</div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
