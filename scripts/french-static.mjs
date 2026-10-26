// French translation check straight from the game's source code (no browser needed).
// 1) Compares the French catalogs (game + website + runtime + legal) with the English ones:
//    every message ID must exist, with the same placeholders and plural forms.
// 2) Collects every text the player can see – level names, pilot thoughts, objectives, buttons,
//    story panels – runs it through the game's own translate(…, 'fr') and lists what stays English.
// 3) Checks that the generated French website pages really declare lang="fr".
// Env: GAME_DIR (default ./game), OUT (default reports/french)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GAME = path.resolve(process.env.GAME_DIR || 'game');
const OUT = process.env.OUT || 'reports/french';
const load = f => import(pathToFileURL(path.join(GAME, 'src', f)).href);
const { translate, missingTranslations } = await load('i18n/translate.js');
const { loadLocaleCatalog, catalogProblems } = await load('i18n/messages.js');
const { levelGroups } = await load('levelCatalog.js');
await loadLocaleCatalog('fr'); // the French catalog is lazy-loaded, like in the browser

const catalog = namespace => (file) => JSON.parse(fs.readFileSync(path.join(GAME, 'src', 'i18n', 'catalogs', namespace, file), 'utf8'));
const gameJson = catalog('');
const webJson = catalog('web');
const runtimeJson = catalog('runtime');
const legalJson = catalog('legal');

// Names the game deliberately keeps in English in every language.
const BRAND = new Set([
  'Beyond the Signal', 'BEYOND THE SIGNAL', 'BEYOND', 'THE SIGNAL', 'Aster Veil', 'ASTER VEIL',
  'Kepler Reach', 'KEPLER REACH', 'Haven', 'Elysium', 'Pulse', 'Nova', 'EMP', 'Laser',
  'Cockpit', 'Navigation', 'NAVIGATION ↗', '▣ Material', 'EXPEDITION / ASTER VEIL', 'Online',
  'Asteroid', 'Resonator +1', 'AD', 'PILOT', 'EN', 'CZ', 'DE', 'FR', 'English', 'Français', '←', '×', 'OK',
  'Google Play', 'App Store', 'Google', 'Android', 'Supabase', 'iOS',
  // French words that happen to be spelled exactly like English – they are real French, not leftovers.
  'Contact', 'Communications', 'Circulation', 'Biocapsule', 'biocapsules', 'RECHARGE {time}', 'The Answer',
]);

// --- 1) catalog parity -------------------------------------------------------
const en = { ...gameJson('en.json'), ...webJson('en.json'), ...runtimeJson('en.json') };
const fr = { ...gameJson('fr.json'), ...webJson('fr.json'), ...runtimeJson('fr.json') };
const problems = catalogProblems('fr', fr);
const missingCatalog = problems.filter(p => p.endsWith(': missing translation'));
const otherProblems = problems.filter(p => !p.endsWith(': missing translation'));

// A French value copied from English is usually a forgotten translation, unless it is a name
// the game keeps in English (Cockpit, Laser, NAVIGATION…).
const identical = Object.entries(en)
  .filter(([id, source]) => typeof source === 'string' && typeof fr[id] === 'string' && source.trim() === fr[id].trim())
  .filter(([, source]) => /[A-Za-z]{2}/.test(source.replace(/\{[^}]*\}/g, '')) && !BRAND.has(source.trim()))
  .map(([id, source]) => ({ id, text: source.trim() }));

// --- 1b) is the French really French? ----------------------------------------
// The parity check above only proves a value exists. It would happily accept an English
// sentence pasted into fr.json. This looks at the words: English-only UI words (the same idea
// as tests/french.spec.js) must not survive in a French string. Words French also uses
// (Score, Bonus, Match, Pause, Zoom, Email…) are deliberately left out.
const ENGLISH = /\b(the|and|of|to|into|your|you|tap|moves?|energy|repairs?|play(?:ing|ed)?|next|back|continue|leave|close|settings|chapters?|hints?|ship|with|this|is|are|from|for|all|collect|break|reach|survive|destroy|combine|retry|keep|watch|begin|skip|story|account|music|sound|sign|mechanics|help|loading|again|done|requires|explore|restore|survey|restoration|enter|open|resume|stars?|pieces?|crystals?|comets?|covers?)\b/gi;
// Words that never occur in French UI, so one of them is already a finding even inside a French
// sentence ("dans Settings…"). Words French also uses (continue, combine, explore, signer→sign,
// forêt→for) are deliberately left out, otherwise every French screen is noise.
const STRONG = /\b(settings|chapters?|ship|hint|play|next|back|leave|close|tap|moves?|repair|energy|loading|retry|requires|restore|survey|restoration|resume|collect|break|destroy|survive|mechanics|the|and|of|to|your|you|with|this|is|are|from|into|watch|begin|skip|story|account|sound|again|done|enter|open)\b/i;
const FRENCH = /[àâäçéèêëîïôöùûüœ]|\b(le|la|les|un|une|des|du|de|et|pour|dans|avec|sur|est|sont|pas|ne|vous|nous|ton|ta|tes|vos|nos|peux|peut|dois|doit|plus|moins|coup|coups|niveau|niveaux|pièce|pièces|étoile|étoiles|vaisseau|jouer|joueur|joueurs|joué|joués|Chapitres|Paramètres|Suivant|Retour|Fermer|Journal|Aide|Continuer|Réparer|Réparation|Réparations|Commencer|Terminer|Supprimer|Atteindre|Casser|Combiner|Survivre|Détruire|Protéger|Échanger|Choisis|Choisir|Choisissez|Indice|Chargement|Rejouer|Quitter|Ouvrir|Voir|Passer|Musique|Compte|Son|Langue)\b/i;
const brandWords = /\b(Beyond the Signal|BEYOND THE SIGNAL|Kepler Reach|Aster Veil|Google Play|The Answer)\b/gi;
function looksEnglish(value) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || !/[A-Za-z]{2}/.test(text) || BRAND.has(text)) return false;
  const cleaned = text
    .replace(brandWords, ' ')
    .replace(/\{[^}]*\}/g, ' ')                                   // {piece}, {count} are placeholders
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|is|net|org|io|dev|app|cz|fr)\b/gi, ' '); // country.is, github.io…
  const hits = cleaned.match(ENGLISH) || [];
  // Two English words mean an English sentence; one is enough for a short label ("Play")
  // or for a word that never appears in French. A French marker excuses other single hits.
  return hits.length >= 2 || (hits.length === 1 && (STRONG.test(cleaned) || (!FRENCH.test(cleaned) && cleaned.split(' ').length <= 6)));
}
const stringsOf = source => Object.entries(source).flatMap(([id, value]) =>
  typeof value === 'string' ? [[id, '', value]]
    : value && typeof value === 'object' ? Object.entries(value).map(([form, text]) => [id, form, text])
      : []);

const frStrings = stringsOf(fr);
const notFrench = [];
for (const [id, form, text] of frStrings) if (looksEnglish(text)) notFrench.push({ id, form, text: String(text).trim(), reason: 'anglicky' });
for (const item of identical) if (!notFrench.some(x => x.id === item.id)) notFrench.push({ ...item, form: '', reason: 'stejné jako angličtina' });

// Guard against a silently broken detector: on the English catalog it must flag a large share.
const enTexts = [...new Set(stringsOf(en).map(([, , text]) => text))].filter(text => typeof text === 'string');
const englishFlagged = enTexts.filter(looksEnglish).length;
const detectorWorks = enTexts.length > 100 && englishFlagged > enTexts.length * 0.1;

// Legal pages are not part of the in-game catalog, so they are compared on their own.
const legalEn = legalJson('en.json'), legalFr = legalJson('fr.json');
const legalProblems = [];
const placeholders = value => new Set([...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(m => m[1]));
for (const [id, source] of Object.entries(legalEn)) {
  const value = legalFr[id];
  if (typeof value !== 'string' || !value.trim()) { legalProblems.push(`${id}: missing translation`); continue; }
  const expected = placeholders(source), actual = placeholders(value);
  if (expected.size !== actual.size || [...expected].some(key => !actual.has(key))) legalProblems.push(`${id}: placeholder mismatch`);
}
for (const id of Object.keys(legalFr)) if (!Object.hasOwn(legalEn, id)) legalProblems.push(`${id}: unknown message ID`);
for (const [id, text] of Object.entries(legalFr)) if (looksEnglish(text)) notFrench.push({ id: `legal.${id}`, form: '', text: String(text).trim(), reason: 'anglicky' });

// --- 2) visible strings through the game's own translator --------------------
const found = new Map(); // text -> Set(source)
const add = (text, source) => {
  if (typeof text !== 'string') return;
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return;
  if (/[àâäçéèêëîïôöùûüœ]/i.test(t)) return; // already French
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(t)) return; // internal id (tile set, level id) / css class
  if (/^(https?:|\.\/|#)/.test(t)) return;
  if (BRAND.has(t)) return;
  if (!found.has(t)) found.set(t, new Set());
  found.get(t).add(source);
};

// Level data: every string inside every level definition.
const SKIP = new Set(['id', 'image', 'icon', 'sprite', 'tiles', 'scene', 'key', 'build', 'type']);
const walk = (value, source, key = '') => {
  if (typeof value === 'string') { if (!SKIP.has(key)) add(value, source); return; }
  if (Array.isArray(value)) value.forEach(v => walk(v, source, key));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, source, k);
};
levelGroups.forEach(([group, list]) => { add(group, 'chapters'); list.forEach(r => walk(r, `level: ${r.name || r.id}`)); });

// Texts written directly in the screens (t("…"), t('…'), t(`…`), plain JSX text, aria-labels).
// Admin dashboards and the blind-playtest tool are Czech-only on purpose.
const ADMIN = /^(BalanceDashboard|AnalyticsQuality|CountryStats|Playtest|balance)/;
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
  const key = `fr:${text}`;
  missingTranslations.delete(key);
  const french = translate(text, 'fr');
  if (french === text && missingTranslations.has(key)) missing.push({ text, sources: [...sources].slice(0, 5) });
}
missing.sort((a, b) => a.sources[0].localeCompare(b.sources[0]) || a.text.localeCompare(b.text));

// --- 3) generated French website pages ---------------------------------------
const PAGES = ['index.html', 'about.html', 'contact.html', 'how-to-play.html', 'privacy.html', 'saving-and-progress.html', 'tools-and-obstacles.html', 'updates.html'];
const pages = [];
for (const file of PAGES) {
  const target = path.join(GAME, 'fr', file);
  if (!fs.existsSync(target)) { pages.push({ file, problem: 'soubor chybí' }); continue; }
  const html = fs.readFileSync(target, 'utf8');
  const problem = !/<html[^>]*lang="fr"/i.test(html) ? 'chybí <html lang="fr">' : '';
  pages.push({ file, problem, bytes: html.length });
}

// --- report ------------------------------------------------------------------
// Field names match the German report so scripts/suite-summary.mjs can read both suites.
const report = {
  checked: found.size,
  catalog: {
    english: Object.keys(en).length,
    german: Object.keys(fr).length,
    missing: missingCatalog.length,
    problems: otherProblems,
    identical,
  },
  legal: legalProblems,
  language: {
    checked: frStrings.length,
    englishFlagged,
    detectorWorks,
    notGerman: notFrench,
  },
  missing,
  pages,
};
const failures = missingCatalog.length + otherProblems.length + legalProblems.length + missing.length + notFrench.length
  + pages.filter(p => p.problem).length + (detectorWorks ? 0 : 1);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'missing.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'levels.txt'), String(levelGroups.reduce((n, [, list]) => n + list.length, 0)));

console.log(`katalog: ${report.catalog.german}/${report.catalog.english} ID, chybí ${missingCatalog.length}, problémů ${otherProblems.length + legalProblems.length}`);
console.log(`viditelné texty: zkontrolováno ${report.checked}, bez překladu ${missing.length}`);
console.log(`francouzština: zkontrolováno ${frStrings.length} textů, nevypadá francouzsky ${notFrench.length}`);
console.log(`webové stránky /fr: ${pages.length - pages.filter(p => p.problem).length}/${pages.length} v pořádku`);
if (!detectorWorks) console.log(`  ! detektor je podezřelý: z ${enTexts.length} anglických textů označil jen ${englishFlagged}`);
for (const item of notFrench.slice(0, 40)) console.log(`  ! ${item.id}${item.form ? '.' + item.form : ''}: „${item.text.slice(0, 90)}“ (${item.reason})`);
for (const item of missingCatalog.slice(0, 20)) console.log(`  · ${item}`);
for (const item of otherProblems.slice(0, 20)) console.log(`  ! ${item}`);
for (const item of legalProblems.slice(0, 20)) console.log(`  ! legal: ${item}`);
for (const item of missing.slice(0, 30)) console.log(`  ? „${item.text.slice(0, 100)}“ (${item.sources.join(', ')})`);
if (failures) process.exitCode = 1;
