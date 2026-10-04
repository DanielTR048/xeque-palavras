import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { webcrypto } from 'node:crypto';

const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: 'dist/server/index.js',
  compatibilityDate: '2026-05-15', d1Databases: ['DB'], bindings: { SITES_DEVICE_GATE: 'local-integration-gate' } }));
const db = await runtime.getD1Database('DB');
const crypto = webcrypto;
const encode = value => Buffer.from(value).toString('base64url');
const decode = value => new Uint8Array(Buffer.from(value, 'base64url'));
const blank = () => ({ version: 1, games: {}, results: {}, config: null, preferences: null, legacy: {} });
const config = { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 };
const game = (id, guesses = ['livro']) => ({ game: { id, config, targets: ['termo'], guesses,
  status: guesses.includes('termo') ? 'won' : 'playing', maxAttempts: 6, durationSeconds: null,
  startedAt: 1000, finishedAt: guesses.includes('termo') ? 3000 : null }, day: '2026-10-04', updatedAt: 4000 + guesses.length });
const doc = (...games) => ({ ...blank(), games: Object.fromEntries(games.map(item => [item.game.id, item])) });
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
async function request(path, { owner, token, origin = 'https://xeque-palavras.nexcoreadm.chatgpt.site', method = 'GET', body } = {}) {
  const headers = {};
  if (owner) headers['oai-authenticated-user-id'] = owner;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  return runtime.dispatchFetch(`https://xeque-palavras.nexcoreadm.chatgpt.site${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function synchronize(document, options = {}, profile = 'daniel') {
  return request('/api/sync', { ...options, method: 'POST', body: { profile, document } });
}
try {
  for (const filename of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`drizzle/${filename}`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  check((await synchronize(blank())).status === 401, 'Anonymous write denied');
  check((await request('/api/session', { owner: 'owner-a' })).status === 200, 'Browser session accepted');
  check((await synchronize(blank(), { owner: 'owner-a', origin: 'https://attacker.example' })).status === 403, 'Cross-origin browser mutation denied');
  check((await synchronize(blank(), { owner: 'owner-a' }, 'unknown')).status === 400, 'Only configured profiles allowed');
  const keyPair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const publicKey = encode(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const nonce = encode(crypto.getRandomValues(new Uint8Array(32)));
  const pairing = { publicKey, nonce, deviceName: 'Integration test phone' };
  const pairResponse = await request('/api/devices/pair', { owner: 'owner-a', method: 'POST', body: pairing });
  check(pairResponse.status === 200, 'Owner pairing accepted');
  const pair = await pairResponse.json();
  check(!JSON.stringify(pair).includes('local-integration-gate'), 'Pairing does not expose plaintext infrastructure credential');
  const keyBytes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, keyPair.privateKey, decode(pair.envelope.key));
  const aes = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(pair.envelope.iv) }, aes, decode(pair.envelope.data));
  const credentials = JSON.parse(new TextDecoder().decode(decrypted));
  check(credentials.nonce === nonce && credentials.platformToken === 'local-integration-gate', 'Envelope decrypts only for expected device key and nonce');
  const replay = await (await request('/api/devices/pair', { owner: 'owner-a', method: 'POST', body: pairing })).json();
  check(replay.deviceId === pair.deviceId, 'Lost pairing response can be retried idempotently');
  const device = { token: credentials.deviceToken, origin: null };
  check((await request('/api/devices', device)).status === 403, 'Device cannot administer devices');
  check((await request('/api/devices/pair', { ...device, method: 'POST', body: pairing })).status === 403, 'Device cannot pair other devices');
  check((await synchronize(doc(game('shared-game')), device)).status === 200, 'Native device can save progress');
  const browser = await (await synchronize(blank(), { owner: 'owner-a' })).json();
  check(browser.document.games['shared-game'].game.guesses[0] === 'livro', 'Browser restores native progress');
  const otherProfile = await (await synchronize(blank(), { owner: 'owner-a' }, 'larissa')).json();
  check(Object.keys(otherProfile.document.games).length === 0, 'Larissa isolated from Daniel');
  const otherOwner = await (await synchronize(blank(), { owner: 'owner-b' })).json();
  check(Object.keys(otherOwner.document.games).length === 0, 'Other account isolated');
  // Produced by the native JVM contract test, so wire compatibility is checked across implementations.
  const nativeFixture = JSON.parse(await readFile('tests/fixtures/native-sync-request.json', 'utf8'));
  const nativeResponse = await request('/api/sync', { owner: 'native-fixture-owner', method: 'POST', body: nativeFixture });
  check(nativeResponse.status === 200, 'Actual Android serializer is accepted by the server');
  const nativeRestored = await (await synchronize(blank(), { owner: 'native-fixture-owner' })).json();
  check(nativeRestored.document.games['daily:2026-10-04:pt:normal:5'].game.guesses[0] === 'campo', 'Android payload restores through the browser API');
  const won = await (await synchronize(doc(game('shared-game', ['livro', 'termo'])), { owner: 'owner-a' })).json();
  check(won.document.results['shared-game'].won, 'Completion generates deduplicated result');
  const stale = await (await synchronize(doc(game('shared-game')), device)).json();
  check(stale.document.games['shared-game'].game.status === 'won', 'Stale offline snapshot cannot undo a win');
  const writes = await Promise.all([synchronize(doc(game('parallel-one')), device), synchronize(doc(game('parallel-two')), { owner: 'owner-a' })]);
  check(writes.every(response => response.ok), 'Concurrent devices can commit');
  const concurrent = await (await synchronize(blank(), device)).json();
  check(concurrent.document.games['parallel-one'] && concurrent.document.games['parallel-two'], 'Compare-and-swap retains both concurrent edits');
  const devices = await (await request('/api/devices', { owner: 'owner-a' })).json();
  check(devices.devices.length === 1 && !JSON.stringify(devices).includes(credentials.deviceToken), 'Device list exposes no credentials');
  await request(`/api/devices/${pair.deviceId}`, { owner: 'owner-b', method: 'DELETE' });
  check((await synchronize(blank(), device)).ok, 'Another account cannot revoke this device');
  await request(`/api/devices/${pair.deviceId}`, { owner: 'owner-a', method: 'DELETE' });
  check((await synchronize(blank(), device)).status === 401, 'Revocation blocks data even with infrastructure access');
  check((await request('/connect')).status === 200, 'Connection screen is bundled');
  check((await request('/.env')).status === 404, 'Non-asset paths are not exposed');
  console.log(`Cloud integration: ${checks} checks passed (D1, profiles, offline merge, pairing, isolation and revocation).`);
} finally { await runtime.dispose(); }
