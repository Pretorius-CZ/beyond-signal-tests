// Czech translation check straight from the game's source code (no browser needed).
// Collects every text the player can see – level names, pilot thoughts, objectives, buttons,
// story panels – runs it through the game's own translate(…, 'cs') and lists what stays English.
// Env: GAME_DIR (default ./game), OUT (default reports/czech)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GAME = path.resolve(process.env.GAME_DIR || 'game');
const OUT = process.env.OUT || 'reports/czech';
const load = f => import(pathToFileURL(path.join(GAME, 'src', f)).href);
const { translate, missingTranslations } = await load('i18n/translate.js');
const { levelGroups } = await load('levelCatalog.js');

const found = new Map(); // text -> Set(source)
const add = (text, source) => {
  if (typeof text !== 'string') return;
  const t = text.trim();
  if (/[áčďéěíňóřšťúůýž]/i.test(t) || /^[a-z]+$/.test(t) || /^(BEYOND|THE SIGNAL|Beyond the Signal|BEYOND THE SIGNAL)$/.test(t)) return; // already Czech, an internal id, or the game's name
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t) || /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(t) || /^(https?:|\.\/|#)/.test(t)) return;
  if (!found.has(t)) found.set(t, new Set());
  found.get(t).add(source);
};

// 1) level data: every string inside every level definition
const SKIP = new Set(['id', 'image', 'icon', 'sprite', 'tiles', 'scene', 'key', 'build', 'type']);
const walk = (value, source, key = '') => {
  if (typeof value === 'string') { if (!SKIP.has(key)) add(value, source); return; }
  if (Array.isArray(value)) value.forEach(v => walk(v, source, key));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, source, k);
};
levelGroups.forEach(([group, list]) => { add(group, 'kapitoly'); list.forEach(r => walk(r, `level: ${r.name || r.id}`)); });

// 2) texts written directly in the screens (t("…"), t('…'), plain JSX text and aria-labels)
// admin pages (balance.html etc.) are Czech-only on purpose
const ADMIN = /^(BalanceDashboard|AnalyticsQuality|CountryStats|balance)/;
const files = fs.readdirSync(path.join(GAME, 'src')).filter(f => /\.(jsx|js)$/.test(f) && !ADMIN.test(f));
for (const f of files) {
  const src = fs.readFileSync(path.join(GAME, 'src', f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(["'])((?:\\.|(?!\1).)+)\1\s*\)/g)) add(m[2].replace(/\\(.)/g, '$1'), f);
  for (const m of src.matchAll(/\bt\(\s*`([^`$]+)`\s*\)/g)) add(m[1], f);
  for (const m of src.matchAll(/aria-label=\{?["']([^"']+)["']\}?/g)) add(m[1], f);
  for (const m of src.matchAll(/>\s*([A-Z][A-Za-z ,.'’!?-]{3,})\s*</g)) add(m[1], f);
}

const missing = [];
for (const [text, sources] of found) {
  const before = missingTranslations.size;
  const cs = translate(text, 'cs');
  const flagged = missingTranslations.size > before || missingTranslations.has(text);
  if (cs === text && flagged) missing.push({ text, sources: [...sources].slice(0, 5) });
}
missing.sort((a, b) => a.sources[0].localeCompare(b.sources[0]) || a.text.localeCompare(b.text));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'missing.json'), JSON.stringify({ checked: found.size, missing }, null, 1));
console.log(`zkontrolováno ${found.size} textů, bez překladu ${missing.length}`);
