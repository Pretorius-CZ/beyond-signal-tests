// Visual snapshots for comparing the look of the game over time.
// Takes the same screens on every run; scripts/visual-compare.mjs compares them with the previous run.
// Parts that change randomly (board pieces, energy timer) are hidden while shooting.
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, dismissTutorial } from '../lib/player.js';
import { readState } from '../lib/page-probe.js';

const LANG = process.env.LANGS?.split(',')[0] || 'en';

test(`vzhled · snímky · ${LANG}`, async ({ page, baseURL }, testInfo) => {
  test.setTimeout(240000);
  const diary = await prepare(page, { language: LANG });
  const dir = path.join('reports', 'visual', 'current', `${testInfo.project.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/-$/, '')}-${LANG}`);
  fs.mkdirSync(dir, { recursive: true });
  // Random parts are hidden while the snapshot is taken (masks cannot cover modal dialogs,
  // so a temporary style is used instead): the pieces on the board and the energy timer.
  const HIDE = '.board .gem, .board .booster-art, .energy-module small, .energy-cells { visibility: hidden !important; }';
  const shot = async name => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled', caret: 'hide', style: HIDE, timeout: 30000 }).catch(() => {});
  };
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.welcome-play').first().waitFor({ timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await shot('01-uvodni-obrazovka');
  await enterGame(page, testInfo, diary, baseURL);
  await shot('02-lod');
  if (await openNextLevel(page)) {
    for (let k = 0; k < 10; k++) { const s = await page.evaluate(readState); if (s.tutorial) { await shot('03-tutorial'); await dismissTutorial(page); } else if (s.tiles.length) break; await page.waitForTimeout(300); }
    await shot('04-level-deska');
    await page.locator('.mechanics-help').click({ timeout: 3000 }).catch(() => {});
    await shot('05-pravidla');
    for (let k = 0; k < 8 && (await page.evaluate(readState)).tutorial; k++) await dismissTutorial(page);
    await page.locator('dialog.mini-dialog[open] button.close').click({ timeout: 3000 }).catch(() => {});
    await shot('06-odchod-z-levelu');
    await page.getByRole('button', { name: /Leave level|Opustit level/i }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  for (const [name, btn] of [['07-kapitoly', page.locator('.chapters-control').first()], ['08-lodni-denik', page.getByRole('button', { name: /ship log|lodní deník/i }).first()], ['09-nastaveni', page.getByRole('button', { name: /Settings|Nastavení/i }).first()]]) {
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await shot(name);
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Zavřít|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
  }
});
