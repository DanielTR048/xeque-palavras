import { emptyDocument, mergeDocuments, parseDocument } from '../sync/model';

export const SITE_ORIGIN = 'https://xeque-palavras.nexcoreadm.chatgpt.site';
interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface Database { prepare(sql: string): Statement }
export interface SyncEnvironment { DB: Database; SITES_DEVICE_GATE?: string; LOCAL_TEST_OWNER?: string }
type Identity = { owner: string; browser: boolean };
class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
const encoder = new TextEncoder();
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });

export function base64url(bytes: Uint8Array): string {
  let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError(400, 'invalid_pairing');
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export async function hash(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value)), byte => byte.toString(16).padStart(2, '0')).join('');
}
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
function isLocal(request: Request, env: SyncEnvironment): boolean {
  return !!env.LOCAL_TEST_OWNER && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}
async function identity(request: Request, env: SyncEnvironment): Promise<Identity> {
  // Only the Sites gateway supplies these headers in production. Local identity is limited
  // to the development runtime and a loopback URL; production never sets LOCAL_TEST_OWNER.
  const owner = request.headers.get('oai-authenticated-user-id') || (isLocal(request, env) ? env.LOCAL_TEST_OWNER : undefined);
  if (owner) return { owner, browser: true };
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!bearer) throw new ApiError(401, 'sign_in_required');
  const device = await env.DB.prepare('SELECT id, owner_id, last_seen FROM sync_devices WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await hash(bearer)).first<{ id: string; owner_id: string; last_seen: number }>();
  if (!device) throw new ApiError(401, 'device_revoked');
  if (Date.now() - device.last_seen > 300_000) await env.DB.prepare('UPDATE sync_devices SET last_seen = ? WHERE id = ? AND revoked_at IS NULL').bind(Date.now(), device.id).run();
  return { owner: device.owner_id, browser: false };
}
function browserMutation(request: Request): void {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  const expected = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? url.origin : SITE_ORIGIN;
  if (origin !== expected || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ApiError(403, 'origin_not_allowed');
}
async function body(request: Request, limit = 2_200_000): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_required');
  if (Number(request.headers.get('Content-Length')) > limit) throw new ApiError(413, 'document_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'body_required');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, 'document_too_large'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  try {
    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch { throw new ApiError(400, 'invalid_json'); }
}
export async function encryptPairing(publicKey: Uint8Array<ArrayBuffer>, payload: unknown) {
  const key = await crypto.subtle.importKey('spki', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new ApiError(400, 'weak_pairing_key');
  const sessionKey = crypto.getRandomValues(new Uint8Array(32));
  const aes = await crypto.subtle.importKey('raw', sessionKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(JSON.stringify(payload)));
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, sessionKey);
  return { version: 1, key: base64url(new Uint8Array(wrapped)), iv: base64url(iv), data: base64url(new Uint8Array(data)) };
}
async function pair(request: Request, env: SyncEnvironment, auth: Identity): Promise<Response> {
  if (!auth.browser) throw new ApiError(403, 'owner_sign_in_required');
  browserMutation(request);
  if (!env.SITES_DEVICE_GATE) throw new ApiError(503, 'pairing_unavailable');
  const input = await body(request, 6000);
  if (typeof input.publicKey !== 'string' || input.publicKey.length > 1000 || typeof input.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.nonce) ||
    typeof input.deviceName !== 'string' || !input.deviceName.trim() || input.deviceName.length > 80) throw new ApiError(400, 'invalid_pairing');
  const publicKey = unbase64(input.publicKey), nonceHash = await hash(input.nonce), keyHash = await hash(publicKey);
  const existing = await env.DB.prepare('SELECT id, key_hash, envelope, created_at, revoked_at FROM sync_devices WHERE owner_id = ? AND nonce_hash = ?')
    .bind(auth.owner, nonceHash).first<{ id: string; key_hash: string; envelope: string; created_at: number; revoked_at: number | null }>();
  if (existing) {
    if (existing.key_hash !== keyHash || existing.revoked_at !== null || Date.now() > existing.created_at + 1_800_000) throw new ApiError(409, 'new_pairing_required');
    return json({ deviceId: existing.id, envelope: JSON.parse(existing.envelope) });
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM sync_devices WHERE owner_id = ? AND revoked_at IS NULL').bind(auth.owner).first<{ count: number }>();
  if ((count?.count ?? 0) >= 30) throw new ApiError(409, 'device_limit');
  const deviceId = crypto.randomUUID(), deviceToken = random(), now = Date.now();
  const envelope = await encryptPairing(publicKey, { nonce: input.nonce, origin: SITE_ORIGIN, deviceId,
    platformToken: env.SITES_DEVICE_GATE, deviceToken, expiresAt: now + 1_800_000 });
  await env.DB.prepare('INSERT INTO sync_devices (id, owner_id, label, token_hash, nonce_hash, key_hash, envelope, created_at, last_seen, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
    .bind(deviceId, auth.owner, input.deviceName.trim(), await hash(deviceToken), nonceHash, keyHash, JSON.stringify(envelope), now, now).run();
  return json({ deviceId, envelope });
}
async function sync(request: Request, env: SyncEnvironment, auth: Identity): Promise<Response> {
  if (auth.browser) browserMutation(request);
  const input = await body(request);
  if (input.profile !== 'daniel' && input.profile !== 'larissa') throw new ApiError(400, 'invalid_profile');
  let incoming;
  try { incoming = parseDocument(input.document); } catch { throw new ApiError(400, 'invalid_document'); }
  const initial = JSON.stringify(emptyDocument());
  await env.DB.prepare('INSERT OR IGNORE INTO profile_documents (owner_id, profile_id, document, revision, updated_at) VALUES (?, ?, ?, 0, ?)')
    .bind(auth.owner, input.profile, initial, Date.now()).run();
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await env.DB.prepare('SELECT document, revision FROM profile_documents WHERE owner_id = ? AND profile_id = ?')
      .bind(auth.owner, input.profile).first<{ document: string; revision: number }>();
    if (!row) throw new ApiError(503, 'sync_retry');
    let merged;
    try { merged = mergeDocuments(parseDocument(JSON.parse(row.document)), incoming); } catch { throw new ApiError(409, 'sync_capacity'); }
    const value = JSON.stringify(merged), now = Date.now();
    if (value === row.document) return json({ document: merged, revision: row.revision, serverTime: now });
    const update = await env.DB.prepare('UPDATE profile_documents SET document = ?, revision = revision + 1, updated_at = ? WHERE owner_id = ? AND profile_id = ? AND revision = ?')
      .bind(value, now, auth.owner, input.profile, row.revision).run();
    if (update.meta.changes) return json({ document: merged, revision: row.revision + 1, serverTime: now });
  }
  throw new ApiError(409, 'sync_retry');
}
export async function handleApi(request: Request, env: SyncEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!env.DB) throw new ApiError(503, 'database_unavailable');
    const auth = await identity(request, env);
    if (url.pathname === '/api/session' && request.method === 'GET') return json({ authenticated: true, canPair: auth.browser });
    if (url.pathname === '/api/sync' && request.method === 'POST') return await sync(request, env, auth);
    if (url.pathname === '/api/devices/pair' && request.method === 'POST') return await pair(request, env, auth);
    if (url.pathname === '/api/devices' && request.method === 'GET') {
      if (!auth.browser) throw new ApiError(403, 'owner_sign_in_required');
      const devices = await env.DB.prepare('SELECT id, label, created_at AS createdAt, last_seen AS lastSeen FROM sync_devices WHERE owner_id = ? AND revoked_at IS NULL ORDER BY created_at DESC').bind(auth.owner).all();
      return json({ devices: devices.results });
    }
    const deviceId = url.pathname.match(/^\/api\/devices\/([a-zA-Z0-9-]{36})$/)?.[1];
    if (deviceId && request.method === 'DELETE') {
      if (!auth.browser) throw new ApiError(403, 'owner_sign_in_required');
      browserMutation(request);
      await env.DB.prepare('UPDATE sync_devices SET revoked_at = ? WHERE owner_id = ? AND id = ?').bind(Date.now(), auth.owner, deviceId).run();
      return json({ revoked: true });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code }, error.status);
    // Never log request bodies, auth headers, pairing payloads, or saved progress.
    return json({ error: 'service_unavailable' }, 503);
  }
}
