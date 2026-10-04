import { expect, test, type Page } from '@playwright/test';
import type { GameState, Mode } from '../src/game/engine';
import { latestGame, type SyncDocument } from '../src/sync/model';

async function gameState(page: Page, mode: Mode = 'classic'): Promise<GameState> {
  const document = await page.evaluate(() => JSON.parse(localStorage.getItem('xeque-palavras:v2:profile:daniel')!)) as SyncDocument;
  const day = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  const game = latestGame(document, { mode, language: 'pt', length: 5, difficulty: 'normal' }, day)?.game;
  if (!game) throw new Error(`Missing saved ${mode} game.`);
  return game;
}

async function openGame(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await expect(page.locator('.word-board')).toHaveCount(1);
  await page.getByRole('heading', { level: 1 }).click();
}

async function typeWord(page: Page, word: string) {
  await page.keyboard.type(word, { delay: 0 });
  await page.keyboard.press('Enter');
}

test('typing animates a letter and repeated unknown guesses retrigger rejection without spending attempts', async ({ page }) => {
  await openGame(page);
  await page.keyboard.type('z');
  const typedLetter = page.locator('.current-row .tile-letter').filter({ hasText: /^z$/i });
  await expect(typedLetter).toHaveCount(1);
  expect(await typedLetter.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await page.keyboard.type('zqzz', { delay: 0 });
  await page.keyboard.press('Enter');
  const row = page.locator('.row-invalid');
  await expect(row).toHaveCount(1);
  const firstPhase = (await row.getAttribute('class'))!.match(/motion-(odd|even)/)?.[0];
  expect(firstPhase).toBeTruthy();
  expect(await row.evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(row).toHaveClass(new RegExp(firstPhase === 'motion-odd' ? 'motion-even' : 'motion-odd'));
  await expect(page.getByRole('status').filter({ hasText: 'Essa palavra não está no dicionário.' })).toBeVisible();
  expect((await gameState(page)).guesses).toEqual([]);
  expect((await gameState(page)).startedAt).toBeNull();
});

test('new victories reveal and celebrate, but restored victories do not replay animation', async ({ page }) => {
  await openGame(page);
  const game = await gameState(page);
  await typeWord(page, game.targets[0]);
  await expect(page.locator('.row-reveal')).toHaveCount(1);
  await expect(page.locator('.result-card.won.fresh-result')).toBeVisible();
  await expect(page.locator('.celebration')).toHaveCount(1);
  await expect(page.locator('.celebration')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.board-celebrate')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await expect(page.locator('.row-reveal, .board-celebrate, .fresh-result, .celebration')).toHaveCount(0);
  expect((await gameState(page)).id).toBe(game.id);
});

test('rapid typing during reveal preserves the next word and can finish the game', async ({ page, request }) => {
  await openGame(page);
  const game = await gameState(page);
  const dictionary = await (await request.get('/dictionaries/pt.json')).json() as { words: string[] };
  const miss = dictionary.words.find(word => word.length === 5 && word !== game.targets[0])!;
  await typeWord(page, miss);
  await expect(page.locator('.row-reveal')).toHaveCount(1);
  await page.keyboard.type(game.targets[0], { delay: 0 });
  await expect(page.locator('.current-row .tile.filled')).toHaveCount(5);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect((await gameState(page)).guesses).toEqual([miss, game.targets[0]]);
});

test('a valid wrong guess reveals its clues and gives feedback while leaving the game playable', async ({ page, request }) => {
  await openGame(page);
  const game = await gameState(page);
  const dictionary = await (await request.get('/dictionaries/pt.json')).json() as { words: string[] };
  const miss = dictionary.words.find(word => word.length === 5 && word !== game.targets[0])!;
  await typeWord(page, miss);
  await expect(page.locator('.row-reveal')).toHaveCount(1);
  await expect(page.locator('.row-miss')).toHaveCount(1);
  expect((await gameState(page)).status).toBe('playing');
  expect((await gameState(page)).guesses).toEqual([miss]);
  await expect(page.locator('.current-row')).toHaveCount(1);
  await expect(page.locator('.board-celebrate, .celebration')).toHaveCount(0);
});

test('changing modes clears rejection and reveal effects from the previous game', async ({ page }) => {
  await openGame(page);
  await typeWord(page, 'zzqzz');
  await expect(page.locator('.row-invalid')).toHaveCount(1);
  await page.locator('.sidebar').getByRole('button', { name: /Dueto/ }).click();
  await expect(page.locator('.word-board')).toHaveCount(2);
  await expect(page.locator('.row-invalid, .row-reveal, .board-celebrate, .fresh-result, .celebration')).toHaveCount(0);
  const duo = await gameState(page, 'duo');
  await page.getByRole('heading', { level: 1 }).click();
  await typeWord(page, duo.targets[0]);
  await expect(page.locator('.row-reveal')).toHaveCount(2);
  await page.locator('.sidebar').getByRole('button', { name: /Clássico/ }).click();
  await expect(page.locator('.word-board')).toHaveCount(1);
  await expect(page.locator('.row-invalid, .row-reveal, .board-celebrate, .fresh-result, .celebration')).toHaveCount(0);
  expect((await gameState(page)).guesses).toEqual([]);
});

test('reduced-motion preference disables tile, rejection and celebration animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  const game = await gameState(page);
  await typeWord(page, 'zzqzz');
  await expect(page.getByRole('status').filter({ hasText: 'Essa palavra não está no dicionário.' })).toBeVisible();
  const animatedElements = () => page.locator('.word-board, .word-board *, .result-card, .result-card *, .celebration, .celebration *').evaluateAll(elements =>
    elements.filter(element => getComputedStyle(element).animationName.split(',').some(name => name.trim() !== 'none')).length);
  expect(await animatedElements()).toBe(0);
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Backspace');
  await typeWord(page, game.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect(await animatedElements()).toBe(0);
  expect((await gameState(page)).status).toBe('won');
});
