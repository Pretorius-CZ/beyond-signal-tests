// German in practice: plays levels in German (LEVELS=all = the whole game) and opens the menus
// (chapters, ship log, settings). On every screen it looks for leftover English and for German text
// that is cut off or overflows (German compounds are often much longer than the English ones).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, playLevel, collectWin, checkpoint, describeScreen } from '../lib/player.js';
import { auditScreen } from '../lib/page-probe.js';

const ALL = process.env.LEVELS === 'all';
const LEVELS = ALL ? Infinity : Number(process.env.LEVELS || 8);
const EXPECTED = Number(process.env.EXPECTED_LEVELS || 0);

/** Runs in the page: visible text fragments that look English. */
function findEnglish() {
  // English-only UI words. Words German also uses (Level, Start, Match, Log, In, Was, Online,
  // Cockpit, Navigation, Laser…) are deliberately left out, otherwise every German screen is noise.
  const EN = /\b(the|and|of|to|into|your|you|tap|moves?|energy|repairs?|play(?:ing|ed)?|next|back|continue|leave|close|settings|chapters?|hints?|ship|with|this|is|are|from|for|all|collect|break|reach|survive|destroy|combine|retry|keep|watch|begin|skip|story|account|music|sound|sign|mechanics|help|loading|again|done|requires|explore|restore|survey|restoration|enter|open|resume)\b/gi;
  const DE = /[äöüß]|\b(der|die|das|und|mit|für|von|zu|im|ist|nicht|dein|deine|du|noch|Züge|Zug|Stern|Sterne|Stein|Steine|Schiff|Spiel|Kapitel|Einstellungen|Weiter|Zurück|Schließen|Hinweis|Logbuch|Reparatur|betreten|starten|Sammle|Entferne|Verbinde|Erreiche|Schütze|Befreie|Tippe|Kombiniere|Gewinnt|Spielfeld|Laden|Wird|Alle|Einträge|Fertig|Erneut|Regeln|Sprache|Musik)\b/i;
  const ALLOW = /^(Beyond the Signal|BEYOND THE SIGNAL|BEYOND|THE SIGNAL|Pulse|Nova|EMP|Laser|Haven|Kepler Reach|Aster Veil|Elysium|English|Deutsch|EN|CZ|DE|OK|Cockpit|Online|Asteroid|Navigation|Level .*)$/i;
  // Words that never occur in German UI, so one is already a finding even inside a German sentence
  // ("In Settings kannst du…"). German borrows Level, Start, Account, Sound, Story – those are not here.
  const STRONG = /\b(settings|chapters?|ship|hint|play|next|back|continue|leave|close|tap|moves?|repair|energy|loading|retry|requires|explore|restore|survey|restoration|resume|collect|break|destroy|combine|survive|mechanics)\b/i;
  // The game name and the place names are English in every language; strip them (and placeholders,
  // URLs, domains) before looking for English words, otherwise "Kepler Reach erkunden" looks like a leftover.
  const brand = /\b(Beyond the Signal|BEYOND THE SIGNAL|Kepler Reach|Aster Veil|Google Play)\b/gi;
  const clean = text => text.replace(brand, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|is|net|org|io|dev|app|cz)\b/gi, ' ');
  const hitsOf = text => clean(text).match(EN) || [];
  const out = new Set();
  const modals = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal'));
  const root = modals.at(-1) || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (t.length < 2 || !el || !el.getClientRects().length || ALLOW.test(t) || el.closest('[translate="no"], .notranslate:not(html), script, style')) continue;
    const hits = hitsOf(t);
    // Two English words mean a leftover sentence; one is enough for a short label ("Play")
    // or for a word that never appears in German. A German marker excuses other single hits.
    if (hits.length >= 2 || (hits.length === 1 && (STRONG.test(clean(t)) || (!DE.test(t) && t.split(' ').length <= 4)))) out.add(t.slice(0, 120));
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const t = el.getAttribute('aria-label');
    if (t && el.getClientRects().length && !DE.test(t) && !ALLOW.test(t) && hitsOf(t).length >= 1) out.add(`(popisek pro čtečku) ${t}`);
  }
  return [...out];
}

test('němčina · hra a menu', async ({ page, baseURL }, testInfo) => {
  if (ALL) test.setTimeout(330 * 60 * 1000);
  const diary = await prepare(page, { language: process.env.DE_SELFTEST ? 'en' : 'de' }); // DE_SELFTEST=1 runs in English to prove the detector works
  const english = new Map();
  const seenIssues = new Set();
  const dir = path.join('reports', 'german');
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
  // The language must really be applied, not only stored: otherwise the whole run would silently test English.
  expect.soft(await page.evaluate(() => document.documentElement.lang), 'jazyk stránky (html lang)').toBe('de');
  await look('lod');
  for (let n = 0; n < LEVELS; n++) {
    if (!(await openNextLevel(page))) { progress.end = EXPECTED && progress.won >= EXPECTED ? 'konec hry' : 'bot nenašel další level'; progress.stuck = await describeScreen(page); break; }
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
    ['denik', page.getByRole('button', { name: /Schiffslogbuch|ship log/i }).first()],
    ['nastaveni', page.locator('.account-control > button').first()],
  ];
  for (const [label, btn] of menus) {
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await look(label);
    if (ALL) await checkpoint(page, testInfo, diary, label).catch(() => {}); // menus are always worth a picture
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Schließen|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const result = save();
  expect.soft(result.english, 'zbylá angličtina').toEqual([]);
  expect.soft(result.clipped.filter(c => c.kind !== 'oriznuty-text'), 'useknutý / přetékající text').toEqual([]);
});

test('němčina · přepínač jazyka', async ({ page, baseURL }, testInfo) => {
  // Proves the German mutation is reachable by a player: switch it in Settings, not via localStorage.
  const diary = await prepare(page, { language: 'en' });
  await enterGame(page, testInfo, diary, baseURL);
  const settings = page.locator('.account-control > button').first();
  await settings.click({ timeout: 5000 });
  const select = page.locator('.account-control select').first();
  await expect(select.locator('option[value="de"]'), 'Deutsch v nabídce jazyků').toHaveText('Deutsch');
  await select.selectOption('de');
  await expect(page.locator('html'), 'html lang po přepnutí').toHaveAttribute('lang', 'de');
  await expect(page.locator('.account-control h2'), 'nadpis nastavení').toHaveText('Spieleinstellungen');
  await expect(select, 'popisek přepínače').toHaveAttribute('aria-label', 'Sprache');
  await expect(page.locator('.account-control > button'), 'tlačítko nastavení').toContainText('Einstellungen');
  // Close the settings panel (Escape works while focus is inside it, the trigger otherwise).
  await page.keyboard.press('Escape');
  if (await page.locator('.account-panel').isVisible().catch(() => false)) await settings.click();
  await expect(page.locator('.account-panel'), 'panel nastavení zavřený').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Kapitel' }).first(), 'tlačítko kapitol').toBeVisible();
  // The choice survives a reload, and the welcome screen comes back in German.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html'), 'html lang po obnovení').toHaveAttribute('lang', 'de');
  await expect(page.locator('.welcome-play').first(), 'tlačítko na úvodní obrazovce').toHaveText(/Spielen|Weiter/);
  diary.language = 'de';
  await checkpoint(page, testInfo, diary, 'uvod-nemecky').catch(() => {});
});
