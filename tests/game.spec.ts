import { expect, test, type Page } from '@playwright/test';
import type { GameState, Language, Mode } from '../src/game/engine';
import { latestGame, type SyncDocument } from '../src/sync/model';

type Dictionary = { language: Language; count: number; words: string[]; byLength: Record<string, number> };

async function savedGame(page: Page, mode: Mode = 'classic', language: Language = 'pt', length = 5): Promise<GameState> {
  const document = await page.evaluate(() => JSON.parse(localStorage.getItem('xeque-palavras:v2:profile:daniel')!)) as SyncDocument;
  const day = await page.evaluate(() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; });
  const game = latestGame(document, { mode, language, length, difficulty: 'normal' }, day)?.game;
  if (!game) throw new Error(`No saved ${language}/${mode}/${length} game found.`);
  return game;
}

async function ready(page: Page, count = 1) {
  await expect(page.locator('.word-board')).toHaveCount(count);
  await expect(page.locator('.load-state')).toHaveCount(0);
}

async function enterWord(page: Page, word: string) {
  // Physical keyboard input starts from a non-button focus target, like normal desktop play.
  await page.getByRole('heading', { level: 1 }).click();
  await page.keyboard.type(word, { delay: 25 });
  await page.keyboard.press('Enter');
}

async function selectMode(page: Page, label: string, boardCount: number) {
  await page.locator('.sidebar').getByRole('button', { name: new RegExp(label) }).click();
  await ready(page, boardCount);
}

test('both bundled dictionaries contain at least 10,000 unique usable words', async ({ request }) => {
  for (const language of ['pt', 'en'] as const) {
    const response = await request.get(`/dictionaries/${language}.json`);
    expect(response.ok()).toBe(true);
    const dictionary = await response.json() as Dictionary;
    expect(dictionary.language).toBe(language);
    expect(dictionary.words.length).toBeGreaterThanOrEqual(10_000);
    expect(dictionary.count).toBe(dictionary.words.length);
    expect(new Set(dictionary.words).size).toBe(dictionary.words.length);
    expect(dictionary.words.every(word => /^[a-z]{4,8}$/.test(word))).toBe(true);
    for (const length of [4, 5, 6, 7, 8]) {
      expect(dictionary.byLength[String(length)]).toBe(dictionary.words.filter(word => word.length === length).length);
      expect(dictionary.byLength[String(length)]).toBeGreaterThanOrEqual(4);
    }
  }
});

test('a valid keyboard guess wins and the result is counted once across reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  const original = await savedGame(page);
  await enterWord(page, original.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await expect.poll(async () => (await savedGame(page)).status).toBe('won');
  await expect(page.locator('.word-board .tile.correct')).toHaveCount(5);

  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect((await savedGame(page)).id).toBe(original.id);
  await page.locator('.sidebar').getByRole('button', { name: 'Meu progresso', exact: true }).click();
  await expect(page.locator('.stat-card').filter({ hasText: 'Partidas' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.stat-card').filter({ hasText: 'Vitórias' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.stat-card').filter({ hasText: 'Aproveitamento' }).locator('strong')).toHaveText('100%');
  await expect(page.locator('.history-item')).toHaveCount(1);
});

test('an unknown word preserves attempts and a corrected entry can win', async ({ page, request }) => {
  const dictionary = await (await request.get('/dictionaries/pt.json')).json() as Dictionary;
  expect(dictionary.words).not.toContain('zzqzz');
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  const original = await savedGame(page);
  await enterWord(page, 'zzqzz');
  await expect(page.getByRole('status').filter({ hasText: 'Essa palavra não está no dicionário.' })).toBeVisible();
  const unchanged = await savedGame(page);
  expect(unchanged.guesses).toEqual([]);
  expect(unchanged.startedAt).toBeNull();
  expect(unchanged.id).toBe(original.id);
  await expect(page.locator('.current-row .tile.filled')).toHaveCount(5);

  for (let index = 0; index < 5; index += 1) await page.keyboard.press('Backspace');
  await enterWord(page, original.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect((await savedGame(page)).guesses).toEqual([original.targets[0]]);
});

test('physical Enter submits a word after clicking mode and word-length controls', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await selectMode(page, 'Dueto', 2);
  const duo = await savedGame(page, 'duo');
  await page.keyboard.type(duo.targets[0], { delay: 25 });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await savedGame(page, 'duo')).guesses).toEqual([duo.targets[0]]);

  await page.getByRole('group', { name: 'Tamanho da palavra', exact: true }).getByRole('button', { name: '8', exact: true }).click();
  await expect(page.locator('.word-board').first().locator('.board-row').first().locator('.tile')).toHaveCount(8);
  const longer = await savedGame(page, 'duo', 'pt', 8);
  for (const target of longer.targets) {
    await page.keyboard.type(target, { delay: 25 });
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
});

test('changing language translates the interface and plays with the English dictionary', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  const portuguese = await savedGame(page);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your next brilliant move.');
  await expect(page.getByLabel('Difficulty', { exact: true })).toBeVisible();
  await expect(page.locator('.dictionary-note')).toContainText('English');
  const english = await savedGame(page, 'classic', 'en');
  const dictionary = await (await request.get('/dictionaries/en.json')).json() as Dictionary;
  expect(dictionary.words).toContain(english.targets[0]);
  await enterWord(page, english.targets[0]);
  await expect(page.getByRole('heading', { name: 'Checkmate!', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Checkmate!', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'PT', exact: true }).click();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  expect((await savedGame(page)).id).toBe(portuguese.id);
  expect((await savedGame(page)).guesses).toEqual([]);
});

for (const { mode, label, boards } of [
  { mode: 'duo', label: 'Dueto', boards: 2 },
  { mode: 'quartet', label: 'Quarteto', boards: 4 },
] as const) {
  test(`${label} shares guesses across boards and wins only when every target is found`, async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
    await ready(page);
    await selectMode(page, label, boards);
    const original = await savedGame(page, mode);
    expect(new Set(original.targets).size).toBe(boards);
    for (let index = 0; index < boards; index += 1) {
      await enterWord(page, original.targets[index]);
      await expect.poll(async () => (await savedGame(page, mode)).guesses.length).toBe(index + 1);
      await expect(page.locator('.board-wrapper.solved')).toHaveCount(index + 1);
      if (index < boards - 1) {
        expect((await savedGame(page, mode)).status).toBe('playing');
        await expect(page.locator('.result-card')).toHaveCount(0);
      }
    }
    await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
    expect((await savedGame(page, mode)).status).toBe('won');
    // A solved board stops rendering later guesses while the remaining boards keep playing.
    await expect(page.locator('.word-board').first().locator('.tile.filled')).toHaveCount(5);
    await expect(page.locator('.word-board').last().locator('.tile.filled')).toHaveCount(boards * 5);
  });
}

test('daily progress survives reload and mode changes, and cannot be reset', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await selectMode(page, 'Desafio diário', 1);
  const original = await savedGame(page, 'daily');
  await expect(page.getByRole('button', { name: 'Nova partida', exact: true })).toHaveCount(0);
  const dictionary = await (await request.get('/dictionaries/pt.json')).json() as Dictionary;
  const miss = dictionary.words.find(word => word.length === 5 && word !== original.targets[0])!;
  await enterWord(page, miss);
  await expect.poll(async () => (await savedGame(page, 'daily')).guesses).toEqual([miss]);
  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  expect((await savedGame(page, 'daily')).id).toBe(original.id);
  expect((await savedGame(page, 'daily')).targets).toEqual(original.targets);
  expect((await savedGame(page, 'daily')).guesses).toEqual([miss]);

  await selectMode(page, 'Clássico', 1);
  await selectMode(page, 'Desafio diário', 1);
  expect((await savedGame(page, 'daily')).guesses).toEqual([miss]);
  await enterWord(page, original.targets[0]);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  await expect(page.getByText('Volte amanhã para um novo desafio.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nova partida', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Xeque-mate!', exact: true })).toBeVisible();
  expect((await savedGame(page, 'daily')).guesses).toEqual([miss, original.targets[0]]);
});

test('Blitz waits for the first valid word and ends when its two-minute clock expires', async ({ page, request }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await selectMode(page, 'Blitz', 1);
  await page.clock.fastForward(300_000);
  await expect(page.locator('.timer')).toHaveText('02:00');
  const original = await savedGame(page, 'blitz');
  expect(original.startedAt).toBeNull();
  const dictionary = await (await request.get('/dictionaries/pt.json')).json() as Dictionary;
  const miss = dictionary.words.find(word => word.length === 5 && word !== original.targets[0])!;
  await enterWord(page, miss);
  await expect.poll(async () => (await savedGame(page, 'blitz')).startedAt).not.toBeNull();
  await page.clock.fastForward(120_000);
  await expect(page.getByRole('heading', { name: 'Toda partida ensina.', exact: true })).toBeVisible();
  await expect(page.locator('.timer')).toHaveText('00:00');
  expect((await savedGame(page, 'blitz')).status).toBe('lost');
  await page.reload();
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Toda partida ensina.', exact: true })).toBeVisible();
  expect((await savedGame(page, 'blitz')).id).toBe(original.id);
});

test('Quartet keeps all four five-letter boards on one row at desktop width', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await selectMode(page, 'Quarteto', 4);
  await expect(page.locator('.game-layout')).toHaveClass(/quartet-layout/);
  const geometry = await page.locator('.boards-viewport').evaluate(viewport => {
    const outer = viewport.getBoundingClientRect();
    return {
      left: outer.left, right: outer.right,
      scrollWidth: viewport.scrollWidth, clientWidth: viewport.clientWidth,
      boards: [...viewport.querySelectorAll('.board-wrapper')].map(board => {
        const bounds = board.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top };
      }),
    };
  });
  expect(geometry.boards).toHaveLength(4);
  expect(Math.max(...geometry.boards.map(board => board.top)) - Math.min(...geometry.boards.map(board => board.top))).toBeLessThanOrEqual(1);
  for (let index = 1; index < geometry.boards.length; index += 1) {
    expect(geometry.boards[index].left).toBeGreaterThan(geometry.boards[index - 1].right);
  }
  expect(geometry.boards[0].left).toBeGreaterThanOrEqual(geometry.left - 1);
  expect(geometry.boards[3].right).toBeLessThanOrEqual(geometry.right + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
});

test('mobile Classic fits eight letters and Quartet scrolls internally to all four horizontal boards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await expect(page.locator('.mobile-mode-nav')).toBeVisible();

  const expectNoOverflow = async () => {
    const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
    for (const selector of ['.word-board', '.keyboard']) {
      const elements = page.locator(selector);
      for (const element of await elements.all()) {
        const box = await element.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(dimensions.width + 1);
      }
    }
    // The card clips overflow, so also inspect tile geometry rather than only document width.
    const clippedTiles = await page.evaluate(() => {
      const card = document.querySelector('.play-card')!.getBoundingClientRect();
      return [...document.querySelectorAll('.tile')].filter(tile => {
        const box = tile.getBoundingClientRect();
        return box.left < card.left || box.right > card.right;
      }).length;
    });
    expect(clippedTiles).toBe(0);
  };

  await expectNoOverflow();
  await page.getByRole('group', { name: 'Tamanho da palavra', exact: true }).getByRole('button', { name: '8', exact: true }).click();
  await expect(page.locator('.word-board').first().locator('.board-row').first().locator('.tile')).toHaveCount(8);
  await expectNoOverflow();
  await page.locator('.mobile-mode-nav').getByRole('button', { name: /Quarteto/ }).click();
  await ready(page, 4);
  await expect(page.locator('.word-board').first().locator('.board-row').first().locator('.tile')).toHaveCount(8);
  const initialGeometry = await page.locator('.boards-viewport').evaluate(viewport => ({
    documentWidth: document.documentElement.scrollWidth,
    windowWidth: innerWidth,
    scrollWidth: viewport.scrollWidth,
    clientWidth: viewport.clientWidth,
    boards: [...viewport.querySelectorAll('.board-wrapper')].map(board => {
      const box = board.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top };
    }),
  }));
  expect(initialGeometry.documentWidth).toBeLessThanOrEqual(initialGeometry.windowWidth + 1);
  expect(initialGeometry.scrollWidth).toBeGreaterThan(initialGeometry.clientWidth);
  expect(Math.max(...initialGeometry.boards.map(board => board.top)) - Math.min(...initialGeometry.boards.map(board => board.top))).toBeLessThanOrEqual(1);
  for (let index = 1; index < initialGeometry.boards.length; index += 1) {
    expect(initialGeometry.boards[index].left).toBeGreaterThan(initialGeometry.boards[index - 1].right);
  }

  const lastBoardTab = page.locator('.quartet-board-tabs').getByRole('button', { name: 'Ir para o tabuleiro 4', exact: true });
  await lastBoardTab.click();
  await expect(page.locator('.board-wrapper[data-board-index="3"]')).toHaveClass(/selected/);
  await expect.poll(async () => page.locator('.boards-viewport').evaluate(viewport => {
    const outer = viewport.getBoundingClientRect();
    const last = viewport.querySelector('.board-wrapper[data-board-index="3"]')!.getBoundingClientRect();
    return last.left >= outer.left - 1 && last.right <= outer.right + 1;
  })).toBe(true);
  expect(await page.locator('.boards-viewport').evaluate(viewport => viewport.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('mobile players can open their progress and return to the game', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Daniel', exact: true }).click();
  await ready(page);
  await page.locator('.topbar').getByRole('button', { name: 'Meu progresso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cada jogada conta.', exact: true })).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Voltar ao jogo', exact: true }).click();
  await ready(page);
});
