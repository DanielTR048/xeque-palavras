import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createGame } from '../src/game/engine';
import { emptyDocument, latestGame, mergeDocuments, type SyncDocument } from '../src/sync/model';

const key = (profile: 'daniel' | 'larissa') => `xeque-palavras:v2:profile:${profile}`;
async function documentFor(page: Page, profile: 'daniel' | 'larissa') {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key(profile)) as Promise<SyncDocument>;
}
async function currentGame(page: Page, profile: 'daniel' | 'larissa') {
  const doc = await documentFor(page, profile);
  return latestGame(doc, doc.config?.value ?? { language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 }, new Date().toISOString().slice(0, 10))!.game;
}
async function select(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.word-board')).toHaveCount(1);
}
async function play(page: Page, word: string) {
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.type(word);
  await page.keyboard.press('Enter');
}
async function cloud(context: BrowserContext, documents: Record<'daniel' | 'larissa', SyncDocument>) {
  await context.route('**/api/session', route => route.fulfill({ json: { authenticated: true, canPair: true } }));
  await context.route('**/api/sync', async route => {
    const request = route.request().postDataJSON() as { profile: 'daniel' | 'larissa'; document: SyncDocument };
    documents[request.profile] = mergeDocuments(documents[request.profile], request.document);
    await route.fulfill({ json: { document: documents[request.profile], revision: 1, serverTime: Date.now() } });
  });
}

test('startup profiles separate games and statistics, and require a choice again after reload', async ({ page }) => {
  await page.route('**/api/session', route => route.fulfill({ status: 401, json: { authenticated: false } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Quem vai jogar?' })).toBeVisible();
  await expect(page.locator('.word-board')).toHaveCount(0);
  await select(page, 'Daniel');
  const daniel = await currentGame(page, 'daniel');
  await play(page, daniel.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trocar perfil: Daniel' }).click();
  await select(page, 'Larissa');
  expect((await currentGame(page, 'larissa')).id).not.toBe(daniel.id);
  expect(Object.keys((await documentFor(page, 'larissa')).results)).toHaveLength(0);
  await page.locator('.sidebar').getByRole('button', { name: 'Meu progresso', exact: true }).click();
  await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('0');
  await page.getByRole('button', { name: 'Trocar perfil: Larissa' }).click();
  await select(page, 'Daniel');
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Quem vai jogar?' })).toBeVisible();
  await select(page, 'Daniel');
  expect((await currentGame(page, 'daniel')).status).toBe('won');
});

test('a second device restores cloud progress while Larissa remains independent', async ({ page, browser }) => {
  const documents = { daniel: emptyDocument(), larissa: emptyDocument() };
  await cloud(page.context(), documents);
  await page.goto('/'); await select(page, 'Daniel');
  const game = await currentGame(page, 'daniel');
  await play(page, game.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await expect.poll(() => Object.keys(documents.daniel.results).length).toBe(1);
  const second = await browser.newContext();
  try {
    await cloud(second, documents);
    const other = await second.newPage(); await other.goto('/'); await select(other, 'Daniel');
    await expect(other.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
    expect((await currentGame(other, 'daniel')).id).toBe(game.id);
    expect(Object.keys(documents.daniel.results)).toHaveLength(1);
    await other.getByRole('button', { name: 'Trocar perfil: Daniel' }).click();
    await select(other, 'Larissa');
    expect(Object.keys((await documentFor(other, 'larissa')).results)).toHaveLength(0);
    await second.setOffline(true);
    const larissa = await currentGame(other, 'larissa');
    await play(other, larissa.targets[0]);
    await expect(other.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
    await expect(other.locator('.sync-indicator')).toContainText('Offline');
    expect(Object.keys(documents.larissa.results)).toHaveLength(0);
    await second.setOffline(false);
    await expect.poll(() => Object.keys(documents.larissa.results).length).toBe(1);
    expect(Object.keys(documents.daniel.results)).toHaveLength(1);
  } finally { await second.close(); }
});

test('cloud refresh preserves an unfinished typed word when the board has not changed', async ({ page }) => {
  const documents = { daniel: emptyDocument(), larissa: emptyDocument() };
  await cloud(page.context(), documents);
  await page.goto('/'); await select(page, 'Daniel');
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.type('tor');
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect(page.locator('.sync-indicator')).toContainText('Sincronizado');
  await expect(page.locator('.current-row .tile.filled')).toHaveCount(3);
});

test('legacy Android results without a retained board still appear in the profile history', async ({ page }) => {
  const documents = { daniel: emptyDocument(), larissa: emptyDocument() };
  documents.daniel.results['android-old-result'] = { id: 'android-old-result', language: 'pt', won: true, finishedAt: Date.now() - 86400000, attempts: 0 };
  await cloud(page.context(), documents);
  await page.goto('/'); await select(page, 'Daniel');
  await page.locator('.sidebar').getByRole('button', { name: 'Meu progresso', exact: true }).click();
  await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('1');
  await expect(page.locator('.history-item')).toHaveCount(1);
  await expect(page.locator('.history-item')).toContainText('Vitória');
});

test('a stale response cannot overwrite a winning guess made while synchronization is in flight', async ({ page }) => {
  const initial = createGame({ language: 'pt', mode: 'classic', difficulty: 'normal', length: 5 }, ['carta']);
  const doc = emptyDocument();
  doc.games[initial.id] = { game: initial, day: new Date().toISOString().slice(0, 10), updatedAt: Date.now() };
  let reply: (() => void) | null = null;
  let count = 0;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, canPair: true } }));
  await page.route('**/api/sync', async route => {
    if (route.request().postDataJSON().profile === 'larissa') {
      await route.fulfill({ json: { document: emptyDocument(), revision: 1, serverTime: Date.now() } }); return;
    }
    count++;
    if (count === 2) await new Promise<void>(resolve => { reply = resolve; });
    await route.fulfill({ json: { document: doc, revision: 1, serverTime: Date.now() } });
  });
  await page.goto('/'); await select(page, 'Daniel');
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await expect.poll(() => reply !== null).toBe(true);
  await play(page, 'carta');
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  reply!();
  await expect.poll(async () => (await currentGame(page, 'daniel')).status).toBe('won');
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect(Object.keys((await documentFor(page, 'daniel')).results)).toHaveLength(1);
});

test('pairing displays the fingerprint and requires an explicit connection before returning an encrypted code', async ({ page }) => {
  let pairCalls = 0;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, canPair: true } }));
  await page.route('**/api/devices/pair', async route => {
    pairCalls++;
    await route.fulfill({ json: { deviceId: 'android-1', envelope: { version: 1, key: 'encryptedkey', iv: 'iv', data: 'encrypteddata' } } });
  });
  const request = Buffer.from(JSON.stringify({ publicKey: Buffer.from('sample-public-key-for-fingerprint').toString('base64url'), nonce: 'a'.repeat(32), deviceName: 'Android de Daniel' })).toString('base64url');
  await page.goto(`/connect#request=${request}`);
  await expect(page.getByLabel('Código do aparelho')).toHaveText(/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/);
  expect(pairCalls).toBe(0);
  await page.getByRole('button', { name: 'Conectar este Android' }).click();
  await expect(page.getByRole('link', { name: 'Abrir no aplicativo' })).toHaveAttribute('href', /^xeque:\/\/pair\?payload=/);
  expect(pairCalls).toBe(1);
  const code = await page.getByLabel('Código criptografado de conexão').inputValue();
  expect(JSON.parse(Buffer.from(code, 'base64url').toString())).toEqual({ version: 1, key: 'encryptedkey', iv: 'iv', data: 'encrypteddata' });
});
