// Czech in practice: plays levels in Czech (LEVELS=all = the whole game) and opens the menus
// (chapters, ship log, settings, help). On every screen it looks for leftover English and for Czech text that is
// cut off or overflows (Czech words are often longer than the English ones).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, playLevel, collectWin, checkpoint } from '../lib/player.js';
import { auditScreen } from '../lib/page-probe.js';

const ALL = process.env.LEVELS === 'all';
const LEVELS = ALL ? Infinity : Number(process.env.LEVELS || 8);
const EXPECTED = Number(process.env.EXPECTED_LEVELS || 0);

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
  if (ALL) test.setTimeout(330 * 60 * 1000);
  const diary = await prepare(page, { language: process.env.CZ_SELFTEST ? 'en' : 'cs' }); // CZ_SELFTEST=1 runs in English to prove the detector works
  const english = new Map();
  const seenIssues = new Set();
  const dir = path.join('reports', 'czech');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${testInfo.project.name.normalize('NFD').replace(/[^\w]+/g, '-')}.json`);
  const progress = { played: 0, won: 0, last: '', end: '' };
  const KINDS = ['oriznuty-text', 'useknuto-na-okraji', 'vodorovne-posouvani', 'nesmysl-v-textu'];
  const save = () => {
    const clipped = diary.issues.filter(i => KINDS.includes(i.kind));
    const result = {
      device: testInfo.project.name, ...progress,
      english: [...english].map(([text, screen]) => ({ text, screen })),
      clipped: clipped.map(i => ({ screen: i.screen, kind: i.kind, el: i.el, detail: i.detail || '' })),
      jsErrors: diary.pageErrors,
    };
    fs.writeFileSync(file, JSON.stringify(result, null, 1));
    return result;
  };
  // Short runs: screenshot of every screen. Whole game: only screens where something was found
  // (otherwise it would be ~400 screenshots per device).
  const look = async label => {
    if (!ALL) await checkpoint(page, testInfo, diary, label).catch(() => {});
    let found = false;
    for (const t of await page.evaluate(findEnglish).catch(() => [])) if (!english.has(t)) { english.set(t, label); found = true; }
    if (ALL) {
      const issues = (await page.evaluate(auditScreen).catch(() => [])).filter(i => KINDS.includes(i.kind));
      for (const i of issues) { const k = `${i.kind}|${i.el}`; if (!seenIssues.has(k)) { seenIssues.add(k); found = true; } }
      if (found) await checkpoint(page, testInfo, diary, label).catch(() => {});
    }
  };
  await enterGame(page, testInfo, diary, baseURL);
  await look('lod');
  for (let n = 0; n < LEVELS; n++) {
    if (!(await openNextLevel(page))) { progress.end = EXPECTED && progress.won >= EXPECTED ? 'konec hry' : 'bot nenašel další level'; break; }
    await page.waitForTimeout(600);
    await look(`level-${n + 1}`);
    const level = await playLevel(page, testInfo, diary, { ads: true, helpers: true, retries: ALL ? 3 : 1 });
    progress.played = n + 1; progress.last = level.title || '';
    await look(`po-levelu-${n + 1}`);
    if (level.result !== 'výhra') { progress.end = `prohra v levelu ${n + 1}`; save(); break; }
    progress.won++;
    await collectWin(page);
    save();
    if (EXPECTED && progress.won >= EXPECTED) { progress.end = 'konec hry'; break; }
  }
  if (!progress.end) progress.end = `zahráno ${progress.played} levelů`;
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
    if (ALL) await checkpoint(page, testInfo, diary, label).catch(() => {}); // menus are always worth a picture
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Zavřít|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const result = save();
  expect.soft(result.english, 'zbylá angličtina').toEqual([]);
  expect.soft(result.clipped.filter(c => c.kind !== 'oriznuty-text'), 'useknutý / přetékající text').toEqual([]);
});
