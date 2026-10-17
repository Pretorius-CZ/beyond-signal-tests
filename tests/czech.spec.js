// Czech in practice: plays the first levels in Czech and opens the menus (chapters, ship log,
// settings, help). On every screen it looks for leftover English and for Czech text that is
// cut off or overflows (Czech words are often longer than the English ones).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, playLevel, collectWin, checkpoint } from '../lib/player.js';

const LEVELS = Number(process.env.LEVELS || 8);

/** Runs in the page: visible text fragments that look English. */
function findEnglish() {
  const EN = /\b(the|and|of|to|your|you|tap|level|moves?|energy|repair|play|next|back|continue|leave|start|close|settings|chapter|log|hint|ship|with|for|this|is|are|on|in|now)\b/gi;
  const ALLOW = /^(Beyond the Signal|BEYOND THE SIGNAL|BEYOND|THE SIGNAL|Pulse|Nova|EMP|Laser|Haven|Kepler Reach|Aster Veil|Elysium|English|EN|CZ|OK)$/i;
  const out = new Set();
  const modals = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal'));
  const root = modals.at(-1) || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || t.length < 4 || !el || !el.getClientRects().length || ALLOW.test(t) || el.closest('[translate="no"], .notranslate:not(html), script, style')) continue;
    if (/[áčďéěíňóřšťúůýž]/i.test(t)) continue;
    const hits = t.match(EN) || [];
    if (hits.length >= 2 || (hits.length === 1 && t.split(' ').length <= 3 && /^[A-Za-z]/.test(t))) out.add(t.slice(0, 120));
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const t = el.getAttribute('aria-label');
    if (t && el.getClientRects().length && !/[áčďéěíňóřšťúůýž]/i.test(t) && (t.match(EN) || []).length >= 1 && !ALLOW.test(t)) out.add(`(popisek pro čtečku) ${t}`);
  }
  return [...out];
}

test('čeština · hra a menu', async ({ page, baseURL }, testInfo) => {
  const diary = await prepare(page, { language: process.env.CZ_SELFTEST ? 'en' : 'cs' }); // CZ_SELFTEST=1 runs in English to prove the detector works
  const english = new Map();
  const look = async label => {
    await checkpoint(page, testInfo, diary, label).catch(() => {});
    for (const t of await page.evaluate(findEnglish)) if (!english.has(t)) english.set(t, label);
  };
  await enterGame(page, testInfo, diary, baseURL);
  await look('lod');
  for (let n = 0; n < LEVELS; n++) {
    if (!(await openNextLevel(page))) break;
    await page.waitForTimeout(600);
    await look(`level-${n + 1}`);
    const level = await playLevel(page, testInfo, diary, { ads: true, helpers: true, retries: 1 });
    await look(`po-levelu-${n + 1}`);
    if (level.result !== 'výhra') break;
    await collectWin(page);
  }
  // menus
  const menus = [
    ['kapitoly', page.locator('.chapters-control').first()],
    ['denik', page.getByRole('button', { name: /lodní deník|ship log/i }).first()],
    ['nastaveni', page.getByRole('button', { name: /Nastavení|Settings/i }).first()],
  ];
  for (const [label, btn] of menus) {
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await look(label);
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Zavřít|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const clipped = diary.issues.filter(i => ['oriznuty-text', 'useknuto-na-okraji', 'vodorovne-posouvani', 'nesmysl-v-textu'].includes(i.kind));
  const result = {
    device: testInfo.project.name,
    english: [...english].map(([text, screen]) => ({ text, screen })),
    clipped: clipped.map(i => ({ screen: i.screen, kind: i.kind, el: i.el, detail: i.detail || '' })),
    jsErrors: diary.pageErrors,
  };
  const dir = path.join('reports', 'czech');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${testInfo.project.name.normalize('NFD').replace(/[^\w]+/g, '-')}.json`), JSON.stringify(result, null, 1));
  expect.soft(result.english, 'zbylá angličtina').toEqual([]);
  expect.soft(result.clipped.filter(c => c.kind !== 'oriznuty-text'), 'useknutý / přetékající text').toEqual([]);
});
