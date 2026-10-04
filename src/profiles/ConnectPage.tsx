import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, ShieldCheck, Smartphone } from 'lucide-react';

type PairRequest = { publicKey: string; nonce: string; deviceName: string };
function decodeBase64Url(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}
function requestFromFragment(): PairRequest | null {
  try {
    const fragment = window.location.hash.slice(1);
    const encoded = fragment.startsWith('request=') ? new URLSearchParams(fragment).get('request')! : fragment;
    if (!encoded || encoded.length > 5000) return null;
    const request: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
    if (typeof request !== 'object' || !request) return null;
    const { publicKey, nonce, deviceName } = request as Partial<PairRequest>;
    if (typeof publicKey !== 'string' || publicKey.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(publicKey) ||
      typeof nonce !== 'string' || nonce.length < 16 || nonce.length > 200 || !/^[A-Za-z0-9_-]+$/.test(nonce) ||
      typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 100) return null;
    decodeBase64Url(publicKey);
    return { publicKey, nonce, deviceName };
  } catch { return null; }
}

export function ConnectPage() {
  const [request] = useState(requestFromFragment);
  const [fingerprint, setFingerprint] = useState('');
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [payload, setPayload] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch('/api/session', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(async response => {
      const session = response.ok ? await response.json() as { authenticated?: boolean; canPair?: boolean } : null;
      if (active) setAuthenticated(session?.authenticated === true && session.canPair === true);
    }).catch(() => { if (active) setAuthenticated(false); });
    if (request) {
      const bytes = decodeBase64Url(request.publicKey);
      void crypto.subtle.digest('SHA-256', bytes).then(value => { if (active) setFingerprint(Array.from(new Uint8Array(value)).slice(0, 6).map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{1,4}/g)!.join(' ')); }).catch(() => { if (active) setMessage('Não foi possível conferir este aparelho. Abra o link novamente pelo aplicativo.'); });
    }
    return () => { active = false; };
  }, [request]);
  const pair = async () => {
    if (!request || busy || payload) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/devices/pair', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok) throw new Error();
      const result = await response.json() as { envelope?: { version?: number; key?: string; iv?: string; data?: string } };
      if (!result.envelope || !result.envelope.key || !result.envelope.iv || !result.envelope.data) throw new Error();
      const encoded = btoa(JSON.stringify(result.envelope)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      setPayload(encoded);
    } catch { setMessage('Não foi possível conectar. Confira sua conexão e tente novamente.'); }
    finally { setBusy(false); }
  };
  return <main className="profile-screen"><header className="profile-header"><a className="profile-wordmark" href="/">♞ <span>xeque<i>.</i></span></a></header><div className="connect-wrap"><section className="connect-card">
    <Smartphone size={32} /><h1>{payload ? 'Quase no seu tabuleiro.' : 'Leve suas jogadas com você.'}</h1>
    {!request ? <><p>Abra o aplicativo Android, toque em Sincronização e escolha Conectar. O app abrirá esta página com o código do seu aparelho.</p><a className="primary-button" href="https://github.com/DanielTR048/xeque-palavras/releases/latest/download/xeque-android.apk">Baixar o aplicativo<ArrowRight size={16} /></a></> : !payload ? <>
      <p>Conectar <strong>{request.deviceName}</strong> aos perfis Daniel e Larissa. Confira se o código abaixo é o mesmo que aparece no Android.</p>
      <div className="connect-fingerprint" aria-label="Código do aparelho">{fingerprint || '…'}</div><p><ShieldCheck size={14} /> O progresso de cada perfil será sincronizado quando houver internet. Você continua jogando offline.</p>
      {authenticated === false && <p className="connect-status">Entre com a conta que tem acesso a este site e abra novamente o link de conexão do Android.</p>}
      <button className="primary-button full-width" disabled={!authenticated || !fingerprint || busy} onClick={() => void pair()}>{busy ? 'Conectando…' : 'Conectar este Android'}<ArrowRight size={16} /></button>
    </> : <><p className="connect-status success"><Check size={15} /> Conexão autorizada. Volte ao aplicativo para concluir.</p><a className="primary-button full-width" href={`xeque://pair?payload=${payload}`}>Abrir no aplicativo<ArrowRight size={16} /></a><p>Se você abriu este site em outro aparelho, copie o código criptografado e cole no Android em Sincronização.</p><textarea aria-label="Código criptografado de conexão" readOnly value={payload} onFocus={event => event.currentTarget.select()} /><button className="secondary-button connect-copy" onClick={() => { void navigator.clipboard.writeText(payload).then(() => setCopied(true)).catch(() => setMessage('Selecione e copie o código acima.')); }}><Copy size={14} />{copied ? 'Código copiado' : 'Copiar código'}</button></>}
    {message && <p role="alert" className="connect-status">{message}</p>}
  </section><div className="connect-back"><a href="/">Voltar à seleção de perfis</a></div></div></main>;
}
