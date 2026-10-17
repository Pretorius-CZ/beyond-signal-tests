// Accessibility: automatic axe scan (WCAG 2.2 A/AA) of the main screens + a keyboard check.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, playLevel, dismissTutorial } from '../lib/player.js';
import { readState } from '../lib/page-probe.js';
import { RULES_CS } from '../lib/a11y-rules.js';

const LANG = process.env.LANGS?.split(',')[0] || 'en';

const found = [], scanned = [];
async function scan(page, screen) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).disableRules(['region']).analyze().catch(e => ({ violations: [], error: e.message }));
  scanned.push(r.error ? `${screen} (chyba skenu: ${r.error.slice(0, 80)})` : screen);
  for (const v of r.violations) found.push({ screen, rule: v.id, impact: v.impact, help: v.help, count: v.nodes.length, example: v.nodes[0]?.target?.join(' ') + ' – ' + (v.nodes[0]?.html || '').slice(0, 160) });
}

test(`přístupnost · hlavní obrazovky · ${LANG}`, async ({ page, baseURL }, testInfo) => {
  test.setTimeout(300000);
  found.length = 0; scanned.length = 0; // a worker can run several devices one after another
  const diary = await prepare(page, { language: LANG });
  const keyboard = [];
  // 1) keyboard only on the title screen
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.welcome-play').first().waitFor({ timeout: 30000 });
  await scan(page, 'úvodní obrazovka');
  let reached = false, ringVisible = false;
  for (let k = 0; k < 15 && !reached; k++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => { const a = document.activeElement; const cs = a && getComputedStyle(a); return { play: !!a?.classList?.contains('welcome-play'), ring: !!cs && ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none') }; });
    if (f.play) { reached = true; ringVisible = f.ring; }
  }
  if (!reached) keyboard.push('tlačítko HRÁT nejde klávesou Tab vůbec zaměřit');
  else if (!ringVisible) keyboard.push('tlačítko HRÁT je zaměřené, ale není to vidět (chybí obrys focusu)');
  // 2) the rest of the game
  await enterGame(page, testInfo, diary, baseURL);
  await scan(page, 'loď');
  if (await openNextLevel(page)) {
    for (let k = 0; k < 10; k++) { const s = await page.evaluate(readState); if (s.tutorial) { await scan(page, 'nápověda / tutoriál'); await dismissTutorial(page); } else if (s.tiles.length) break; await page.waitForTimeout(300); }
    await scan(page, 'herní deska');
    await page.locator('.mechanics-help').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500); await scan(page, 'pravidla a pomůcky');
    for (let k = 0; k < 8 && (await page.evaluate(readState)).tutorial; k++) await dismissTutorial(page);
    await page.locator('dialog.mini-dialog[open] button.close').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400); await scan(page, 'dotaz na odchod z levelu');
    await page.getByRole('button', { name: /Keep playing|Hrát dál/i }).click({ timeout: 3000 }).catch(() => {});
    const level = await playLevel(page, testInfo, diary, { ads: true, helpers: true, retries: 1 });
    if (level.result === 'výhra') await scan(page, 'výhra');
    await page.locator('.win-panel button.primary').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }
  for (const [label, sel] of [['kapitoly', page.locator('.chapters-control').first()], ['lodní deník', page.getByRole('button', { name: /ship log|lodní deník/i }).first()], ['nastavení', page.getByRole('button', { name: /Settings|Nastavení/i }).first()]]) {
    if (!(await sel.count())) continue;
    await sel.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700); await scan(page, label);
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Zavřít|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const dir = path.join('reports', 'a11y');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${testInfo.project.name.normalize('NFD').replace(/[^\w]+/g, '-')}-${LANG}.json`), JSON.stringify({ device: testInfo.project.name, language: LANG, scanned, keyboard, violations: found }, null, 1));
  expect.soft(found.filter(v => ['critical', 'serious'].includes(v.impact)).map(v => `${v.screen}: ${RULES_CS[v.rule] || v.help}`), 'vážné problémy přístupnosti').toEqual([]);
  expect.soft(keyboard, 'ovládání klávesnicí').toEqual([]);
});
