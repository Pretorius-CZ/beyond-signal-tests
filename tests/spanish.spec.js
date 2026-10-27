// Spanish in practice: plays levels in Spanish (LEVELS=all = the whole game) and opens the menus
// (chapters, ship log, settings). On every screen it looks for leftover English and for Spanish text
// that is cut off or overflows.
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
  // English-only UI words. Spanish lookalikes (Continuar, Explorar, Señal, Contacto…) are not here.
  const EN = /\b(the|and|of|to|into|your|you|tap|moves?|energy|repairs?|play(?:ing|ed)?|next|back|continue|leave|close|settings|chapters?|hints?|ship|with|this|is|are|from|for|all|collect|break|reach|survive|destroy|combine|retry|keep|watch|begin|skip|story|account|music|sound|sign|mechanics|help|loading|again|done|requires|explore|restore|survey|restoration|enter|open|resume|stars?|pieces?|crystals?|comets?|covers?)\b/gi;
  const ES = /[áéíóúüñ¿¡]|\b(el|la|los|las|un|una|unos|unas|de|del|y|o|u|en|con|para|por|es|son|está|están|se|que|su|sus|tu|tus|mi|mis|nuestro|nuestra|no|sí|más|menos|pero|como|cuando|donde|sobre|entre|sin|hasta|desde|porque|puedes|puede|tienes|tiene|hay|ser|hacer|jugar|juego|jugador|nivel|niveles|movimiento|movimientos|pieza|piezas|estrella|estrellas|nave|continuar|siguiente|volver|cerrar|reintentar|ajustes|capítulos|idioma|historia|ayuda|cargando|reparar|reparación|reparaciones|comenzar|empezar|terminar|alcanzar|romper|destruir|proteger|sobrevivir|elegir|elige|pista|consejo|música|sonido|cuenta|visitar|explorar|abrir|ver|pasar|saltar|misión)\b/i;
  const ALLOW = /^(Beyond the Signal|BEYOND THE SIGNAL|BEYOND|THE SIGNAL|Pulse|Nova|EMP|Laser|Haven|Kepler Reach|Aster Veil|Elysium|The Answer|English|Español|EN|CZ|FR|DE|ES|OK|Cockpit|Online|Asteroid|Navigation|Level .*)$/i;
  // Words that never occur in Spanish UI, so one is already a finding even inside a Spanish sentence.
  const STRONG = /\b(settings|chapters?|ship|hint|play|next|back|leave|close|tap|moves?|repair|energy|loading|retry|requires|restore|survey|restoration|resume|collect|break|destroy|survive|mechanics|the|and|of|to|your|you|with|this|is|are|from|into|watch|begin|skip|story|account|sound|again|done|enter|open)\b/i;
  const brand = /\b(Beyond the Signal|BEYOND THE SIGNAL|Kepler Reach|Aster Veil|Google Play|The Answer)\b/gi;
  const clean = text => text.replace(brand, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|is|net|org|io|dev|app|cz|es)\b/gi, ' ');
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
    if (hits.length >= 2 || (hits.length === 1 && (STRONG.test(clean(t)) || (!ES.test(t) && t.split(' ').length <= 4)))) out.add(t.slice(0, 120));
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const t = el.getAttribute('aria-label');
    if (t && el.getClientRects().length && !ES.test(t) && !ALLOW.test(t) && hitsOf(t).length >= 1) out.add(`(popisek pro čtečku) ${t}`);
  }
  return [...out];
}

test('španělština · hra a menu', async ({ page, baseURL }, testInfo) => {
  if (ALL) test.setTimeout(330 * 60 * 1000);
  const diary = await prepare(page, { language: process.env.ES_SELFTEST ? 'en' : 'es' }); // ES_SELFTEST=1 runs in English to prove the detector works
  const english = new Map();
  const seenIssues = new Set();
  const dir = path.join('reports', 'spanish');
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
  expect.soft(await page.evaluate(() => document.documentElement.lang), 'jazyk stránky (html lang)').toBe('es');
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
  const menus = [
    ['kapitoly', page.locator('.chapters-control').first()],
    ['denik', page.getByRole('button', { name: /Diario de a bordo|ship log/i }).first()],
    ['nastaveni', page.locator('.account-control > button').first()],
  ];
  for (const [label, btn] of menus) {
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(800);
    await look(label);
    if (ALL) await checkpoint(page, testInfo, diary, label).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^(×|Cerrar|Close)$/ }).first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const result = save();
  expect.soft(result.english, 'zbylá angličtina').toEqual([]);
  expect.soft(result.clipped.filter(c => c.kind !== 'oriznuty-text'), 'useknutý / přetékající text').toEqual([]);
});

test('španělština · přepínač jazyka', async ({ page, baseURL }, testInfo) => {
  const diary = await prepare(page, { language: 'en' });
  await enterGame(page, testInfo, diary, baseURL);
  const settings = page.locator('.account-control > button').first();
  await settings.click({ timeout: 5000 });
  const select = page.locator('.account-control select').first();
  await expect(select.locator('option[value="es"]'), 'Español v nabídce jazyků').toHaveText('Español');
  await select.selectOption('es');
  await expect(page.locator('html'), 'html lang po přepnutí').toHaveAttribute('lang', 'es');
  await expect(page.locator('.account-control h2'), 'nadpis nastavení').toHaveText('Ajustes del juego');
  await expect(select, 'popisek přepínače').toHaveAttribute('aria-label', 'Idioma');
  await expect(page.locator('.account-control > button'), 'tlačítko nastavení').toContainText('Ajustes');
  await page.keyboard.press('Escape');
  if (await page.locator('.account-panel').isVisible().catch(() => false)) await settings.click();
  await expect(page.locator('.account-panel'), 'panel nastavení zavřený').toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Capítulos' }).first(), 'tlačítko kapitol').toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html'), 'html lang po obnovení').toHaveAttribute('lang', 'es');
  await expect(page.locator('.welcome-play').first(), 'tlačítko na úvodní obrazovce').toHaveText(/Jugar|Continuar/);
  diary.language = 'es';
  await checkpoint(page, testInfo, diary, 'uvod-spanelsky').catch(() => {});
});
