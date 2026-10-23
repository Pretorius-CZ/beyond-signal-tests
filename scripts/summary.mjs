// Builds the overview from reports/data/*.json written by the bots:
//   reports/index.html  – dashboard with screenshots (published on GitHub Pages)
//   reports/summary.md  – table for the GitHub Actions run page
// SHOTS_DIR=thumbs  → screenshots are referenced as thumbs/<name>.jpg (used for a lightweight copy)
// BODY_ONLY=1       → writes the page without <!doctype>/<html> wrapper (for embedding)
import fs from 'node:fs';
import path from 'node:path';

const dir = 'reports/data';
const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : [];
for (const r of runs) for (const k of ['issues', 'console', 'pageErrors', 'failedRequests', 'screens', 'notes', 'levels']) r[k] ??= [];
runs.sort((a, b) => a.project.localeCompare(b.project, 'cs') || a.language.localeCompare(b.language));

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shotUrl = f => process.env.SHOTS_DIR
  ? `${process.env.SHOTS_DIR}/${f.replace(/^reports\/shots\//, '').replace(/[\/\\]/g, '__').replace(/\.png$/, '.jpg')}`
  : f.replace(/^reports[\\/]/, '');
const mb = b => (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
const sec = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const won = l => l.result === 'výhra';
const when = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' });

// ---------- findings, grouped ----------
const KIND = {
  'mimo-obrazovku': 'Prvek mimo obrazovku', 'useknuto-na-okraji': 'Useknuté na okraji obrazovky', zakryto: 'Tlačítko zakryté jiným prvkem',
  'maly-dotykovy-cil': 'Malý dotykový cíl (pod 24 px)', 'oriznuty-text': 'Oříznutý text', 'nesmysl-v-textu': 'Nesmysl v textu', 'vodorovne-posouvani': 'Stránka se posouvá do strany',
};
const groups = Object.values(runs.flatMap(r => r.issues.map(i => ({ ...i, project: r.project, language: r.language }))).reduce((m, i) => {
  const k = `${i.project}|${i.language}|${i.kind}`;
  const g = (m[k] ??= { project: i.project, language: i.language, kind: i.kind, severity: i.severity, screens: new Set(), elements: 0, example: i });
  g.screens.add(i.screen); g.elements += i.count || 1; return m;
}, {})).sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) || a.project.localeCompare(b.project, 'cs'));
const groupsOf = r => groups.filter(g => g.project === r.project && g.language === r.language);
const logLines = r => [...r.pageErrors.map(e => 'JS chyba: ' + e), ...r.console.map(c => `${c.type}: ${c.text}`), ...r.failedRequests.map(f => 'síť: ' + f), ...(r.notes || []).map(n => 'bot: ' + n)];
const state = r => r.pageErrors.length || groupsOf(r).some(g => g.severity === 'error') || r.levels.some(l => !won(l) && l.result !== 'konec hry') ? 'bad' : groupsOf(r).length || r.console.length ? 'warn' : 'ok';
const STATE = { ok: 'v pořádku', warn: 'varování', bad: 'problém' };

// ---------- per-level difficulty across all runs ----------
const levelOrder = [];
const levels = {};
for (const r of runs) r.levels.forEach((l, i) => {
  if (!l.budget) return;
  const key = `L${i + 1}`;
  if (!levels[key]) { levels[key] = { key, names: new Set(), budget: l.budget, plays: [] }; levelOrder.push(key); }
  levels[key].names.add(l.title); levels[key].plays.push(l);
});
levelOrder.sort((a, b) => +a.slice(1) - +b.slice(1));
const enTitle = {}; for (const r of runs.filter(r => r.language === 'en')) r.levels.forEach((l, i) => { if (l.budget) enTitle[`L${i + 1}`] ??= l.title; });
const diff = levelOrder.map(k => {
  const L = levels[k], wins = L.plays.filter(won), used = wins.map(l => l.movesUsed).filter(n => n != null);
  const avg = used.length ? used.reduce((a, b) => a + b, 0) / used.length : null;
  return {
    key: k, name: enTitle[k] || [...L.names][0], budget: L.budget,
    plays: L.plays.length, wins: wins.length, min: used.length ? Math.min(...used) : null, max: used.length ? Math.max(...used) : null, avg,
    helped: L.plays.filter(l => l.helpersUsed?.length).length, ads: L.plays.filter(l => l.adsWatched).length, retried: L.plays.filter(l => (l.attempts || 1) > 1).length, attempts: L.plays.reduce((n, l) => n + (l.attempts || 1), 0),
    tight: avg != null ? avg / L.budget : null,
  };
});
const verdict = d => d.wins < d.plays ? 'bad' : d.retried ? 'warn' : d.tight > 0.85 || d.ads ? 'warn' : 'ok';
const verdictText = d => d.wins < d.plays ? 'bot občas prohrává' : d.retried ? 'nutné opakování' : d.tight > 0.85 ? 'těsný limit tahů' : d.ads ? 'někdy potřeba reklama' : 'pohodlné';

// ---------- Markdown for the GitHub run page ----------
const icon = { ok: '✅', warn: '⚠️', bad: '❌' };
let md = `## Beyond the Signal · herní boti\n\n${when} · ${runs.length} běhů\n\n`;
md += `### Obtížnost levelů\n\n| Level | Limit | Výhry / pokusy | Tahy (min–průměr–max) | Pomůcky | Reklama | Hodnocení |\n|---|---|---|---|---|---|---|\n`;
for (const d of diff) md += `| ${d.key} ${esc(d.name)} | ${d.budget} | ${d.wins}/${d.attempts} | ${d.min ?? '–'}–${d.avg?.toFixed(1) ?? '–'}–${d.max ?? '–'} | ${d.helped}× | ${d.ads}× | ${icon[verdict(d)]} ${verdictText(d)} |\n`;
const wide = levelOrder.length > 10; // full-game runs: summarise instead of one column per level
const progress = r => { const w = r.levels.filter(won).length, last = r.levels.at(-1); return { w, retried: r.levels.filter(l => (l.attempts || 1) > 1).length, stop: last && !won(last) && last.result !== 'konec hry' ? `${last.title} – ${last.result}` : '' }; };
md += wide
  ? `\n### Zařízení\n\n| | Zařízení | Jazyk | Dohráno levelů | Opakované levely | Kde skončil | Konzole | Vizuál |\n|---|---|---|---|---|---|---|---|\n`
  : `\n### Zařízení\n\n| | Zařízení | Jazyk | Načtení | Data | ${levelOrder.join(' | ')} | Konzole | Vizuál |\n|${'---|'.repeat(7 + levelOrder.length)}\n`;
for (const r of runs) {
  const g = groupsOf(r), vis = g.length ? g.map(x => (x.severity === 'error' ? '❌ ' : '⚠️ ') + (KIND[x.kind] || x.kind).toLowerCase()).join('<br>') : '✅';
  if (wide) { const p = progress(r); md += `| ${icon[state(r)]} | ${r.project} | ${r.language} | ${p.w} | ${p.retried} | ${esc(p.stop) || 'konec hry ✅'} | ${logLines(r).length || '–'} | ${vis} |\n`; continue; }
  md += `| ${icon[state(r)]} | ${r.project} (${r.viewport?.width}×${r.viewport?.height}) | ${r.language} | ${sec(r.loadMs)} | ${mb(r.bytes)} | ${levelOrder.map((_, i) => { const l = r.levels[i]; return !l ? '' : won(l) ? `${l.movesUsed}/${l.budget}${l.adsWatched ? ' 📺' : ''}${l.helpersUsed?.length ? ' 🛠' : ''}` : `❌ ${l.result}`; }).join(' | ')} | ${logLines(r).length || '–'} | ${vis} |\n`;
}
const ids = runs.filter(r => r.botId);
if (ids.length) md += `\n### Identity botů (označ je v balance.html jako testery)\n\n${ids.map(r => `- \`${r.botId}\` · ${r.project} · ${r.language} · ${r.mode}`).join('\n')}\n`;
md += `\nČísla = tahy použité / limit · 📺 reklama za +5 tahů · 🛠 pomůcky v posledních tazích\n`;
if (groups.length) {
  md += `\n### Nálezy\n\n| | Typ | Zařízení | Kolik | Obrazovky | Příklad |\n|---|---|---|---|---|---|\n`;
  for (const g of groups) md += `| ${icon[g.severity === 'error' ? 'bad' : 'warn']} | ${KIND[g.kind] || g.kind} | ${g.project} · ${g.language} | ${g.elements}× | ${[...g.screens].slice(0, 4).join(', ')}${g.screens.size > 4 ? ` +${g.screens.size - 4}` : ''} | ${esc(g.example.el)} ${esc(g.example.detail || '')} |\n`;
}
const logs = Object.entries(runs.flatMap(r => logLines(r).map(e => [e, r.project])).reduce((m, [e, p]) => ((m[e] ??= new Set()).add(p), m), {}));
if (logs.length) md += `\n### Konzole a síť\n\n${logs.map(([e, ps]) => `- \`${e.replace(/`/g, "'")}\` (${[...ps].join(', ')})`).join('\n')}\n`;
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/summary.md', md);

// ---------- HTML dashboard ----------
const plays = runs.flatMap(r => r.levels.filter(l => l.budget));
const errorGroups = groups.filter(g => g.severity === 'error');
const warnGroups = groups.filter(g => g.severity !== 'error');
const consoleCount = runs.reduce((n, r) => n + logLines(r).length, 0);

const head = `<title>Beyond the Signal · boti</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
/* Layout: ship-console report – status strip, level difficulty table, then one log entry per device. */
:root{
  --bg:#eef2f5;--panel:#ffffff;--ink:#14212e;--muted:#5a6b7c;--line:#d5dee6;
  --accent:#b8761f;--ok:#1d7f55;--warn:#a5660a;--bad:#b8322f;--chip:#e3eaf0;
  --display:"Chakra Petch","Segoe UI",system-ui,sans-serif;--body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1420;--panel:#122030;--ink:#e3ebf2;--muted:#8fa3b6;--line:#21364a;--accent:#e2a75a;--ok:#4cc38a;--warn:#e5a83b;--bad:#ff7a6e;--chip:#1a2c3f;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0b1420;--panel:#122030;--ink:#e3ebf2;--muted:#8fa3b6;--line:#21364a;--accent:#e2a75a;--ok:#4cc38a;--warn:#e5a83b;--bad:#ff7a6e;--chip:#1a2c3f;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.55 var(--body);margin:0}
.wrap{max-width:1180px;margin:0 auto;padding-block:28px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1,h2,h3{font-family:var(--display);font-weight:600;letter-spacing:.01em;text-wrap:balance;margin:0}
h1{font-size:clamp(24px,4vw,34px)}h2{font-size:20px}h3{font-size:17px}
.eyebrow{font:500 12px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.lede{color:var(--muted);margin:6px 0 0}
.lede a{color:inherit}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.strip div{background:var(--panel);padding:14px 16px}
.strip b{display:block;font:500 26px/1.1 var(--mono);font-variant-numeric:tabular-nums}
.strip span{color:var(--muted);font-size:13px}
.strip .bad b{color:var(--bad)}.strip .warn b{color:var(--warn)}.strip .ok b{color:var(--ok)}
section{display:grid;gap:12px;min-width:0}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
tr:last-child td{border-bottom:0}
th{font:500 11px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
td.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.bar{display:inline-block;width:90px;height:6px;background:var(--chip);border-radius:3px;vertical-align:middle;margin-right:8px;position:relative;overflow:hidden}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--accent)}
.bar.bad i{background:var(--bad)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;padding:2px 9px;border-radius:999px;background:var(--chip)}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill.ok{color:var(--ok)}.pill.warn{color:var(--warn)}.pill.bad{color:var(--bad)}
.run{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;display:grid;gap:12px;min-width:0}
.run header{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline}
.meta{font:13px/1.3 var(--mono);color:var(--muted)}
.run .scroll{border-radius:8px}
ul.find{margin:0;padding:0;list-style:none;display:grid;gap:6px}
ul.find li{padding-left:14px;border-left:3px solid var(--warn);font-size:14px}
ul.find li.error{border-color:var(--bad)}
ul.find small{color:var(--muted);display:block}
details summary{cursor:pointer;color:var(--muted);font-size:14px}
pre{white-space:pre-wrap;word-break:break-word;font:12px/1.5 var(--mono);background:var(--bg);padding:10px;border-radius:8px;margin:8px 0 0}
.shots{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px}
.shots a{flex:0 0 auto;display:grid;gap:4px;text-decoration:none;color:var(--muted);font:12px/1.2 var(--mono);max-width:240px}
.shots img{height:170px;width:auto;max-width:240px;object-fit:contain;border-radius:6px;border:1px solid var(--line);background:var(--bg)}
.shots .flag{color:var(--bad)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.legend{color:var(--muted);font-size:13px;margin:0}
</style>`;

// SHOTS_SAMPLE=1 keeps only key screens (title, ship, first and last board, losses, anything with findings).
const pickShots = screens => {
  if (process.env.SHOTS_SAMPLE !== '1') return screens;
  const boards = screens.filter(s => s.label.startsWith('deska'));
  const flagged = screens.filter(s => s.issues).slice(0, 4);
  const losses = screens.filter(s => /prohra|chyba|zaseknuto|nenalezen/.test(s.label)).slice(0, 6);
  return screens.filter(s => /uvodni|^lod$|konec/.test(s.label) || s === boards[0] || s === boards.at(-1) || flagged.includes(s) || losses.includes(s));
};
const runCard = r => {
  const g = groupsOf(r), log = logLines(r);
  return `<article class="run">
  <header><span class="pill ${state(r)}">${STATE[state(r)]}</span><h3>${esc(r.project)}</h3><span class="meta">${r.viewport?.width}×${r.viewport?.height} · ${r.language.toUpperCase()} · načtení ${sec(r.loadMs)} · ${mb(r.bytes)}</span></header>
  <div class="scroll"><table><thead><tr><th>Level</th><th>Výsledek</th><th>Pokusy</th><th>Tahy</th><th>Pomůcky</th><th>Reklama</th><th>Boosty (přesuny)</th><th>Čas</th></tr></thead><tbody>
  ${r.levels.map((l, i) => `<tr><td>L${i + 1} ${esc(l.title)}</td><td>${won(l) ? '<span class="pill ok">výhra</span>' : `<span class="pill bad">${esc(l.result)}</span>`}</td><td class="num">${l.attempts || 1}</td><td class="num">${l.movesUsed ?? '–'} / ${l.budget ?? '–'}</td><td>${esc(l.helpersUsed?.join(', ') || '–')}</td><td class="num">${l.adsWatched || '–'}</td><td class="num">${l.boostersFired ?? '–'}${l.chargeMoves ? ` (${l.chargeMoves})` : ''}</td><td class="num">${l.durationMs ? Math.round(l.durationMs / 1000) + ' s' : '–'}</td></tr>`).join('')}
  </tbody></table></div>
  ${g.length ? `<ul class="find">${g.map(x => `<li class="${x.severity}">${esc(KIND[x.kind] || x.kind)} · ${x.elements}×<small>${esc([...x.screens].join(', '))} · např. ${esc(x.example.el)} ${esc(x.example.detail || '')}</small></li>`).join('')}</ul>` : ''}
  ${log.length ? `<details><summary>Konzole a síť (${log.length})</summary><pre>${esc(log.join('\n'))}</pre></details>` : ''}
  <div class="shots">${pickShots(r.screens).map(s => `<a href="${shotUrl(s.file)}" target="_blank" rel="noopener"><img loading="lazy" src="${shotUrl(s.file)}" alt="${esc(r.project)}: ${esc(s.label)}"><span${s.issues ? ' class="flag"' : ''}>${esc(s.label)}${s.issues ? ' · ' + s.issues + ' nálezů' : ''}</span></a>`).join('')}</div>
</article>`;
};

const body = `<main class="wrap">
<header>
  <div class="eyebrow">Beyond the Signal · automatický průchod</div>
  <h1>Hlášení botů</h1>
  <p class="lede">${when} · ${runs.length} běhů na ${new Set(runs.map(r => r.project)).size} zařízeních · jazyky ${[...new Set(runs.map(r => r.language))].join(', ').toUpperCase()}${process.env.SHOTS_DIR ? '' : ' · <a href="playwright/index.html">podrobný Playwright report (videa, trace)</a>'}</p>
</header>
<div class="strip">
  <div class="${runs.every(r => state(r) === 'ok') ? 'ok' : ''}"><b>${runs.filter(r => state(r) === 'ok').length}/${runs.length}</b><span>běhů bez nálezu</span></div>
  <div class="${plays.every(won) ? 'ok' : 'bad'}"><b>${plays.filter(won).length}/${plays.length}</b><span>vyhraných levelů</span></div>
  <div class="${errorGroups.length ? 'bad' : 'ok'}"><b>${errorGroups.length}</b><span>vizuálních chyb</span></div>
  <div class="${warnGroups.length ? 'warn' : 'ok'}"><b>${warnGroups.length}</b><span>vizuálních varování</span></div>
  <div class="${consoleCount ? 'warn' : 'ok'}"><b>${consoleCount}</b><span>hlášek v konzoli a síti</span></div>
</div>
<section>
  <h2>Obtížnost levelů</h2>
  <div class="scroll"><table><thead><tr><th>Level</th><th>Limit</th><th>Výhry / pokusy</th><th>Spotřeba tahů</th><th>Min–max</th><th>Pomůcky</th><th>Reklama</th><th>Hodnocení</th></tr></thead><tbody>
  ${diff.map(d => `<tr><td>${d.key} ${esc(d.name)}</td><td class="num">${d.budget}</td><td class="num">${d.wins}/${d.attempts}</td><td class="num"><span class="bar ${d.tight > 0.85 ? 'bad' : ''}"><i style="width:${Math.min(100, Math.round((d.tight ?? 0) * 100))}%"></i></span>${d.avg?.toFixed(1).replace('.', ',') ?? '–'} z ${d.budget}</td><td class="num">${d.min ?? '–'}–${d.max ?? '–'}</td><td class="num">${d.helped}×</td><td class="num">${d.ads}×</td><td><span class="pill ${verdict(d)}">${verdictText(d)}</span></td></tr>`).join('')}
  </tbody></table></div>
  <p class="legend">Spotřeba = průměr tahů, které bot potřeboval k výhře. Bot hraje jako průměrný hráč bez výhledu dopředu. Pomůcky používá jen v posledních třech tazích, reklamu za +5 tahů jen když mu tahy dojdou.</p>
</section>
<section>
  <h2>Zařízení</h2>
  ${runs.map(runCard).join('\n')}
</section>
</main>`;

const out = process.env.BODY_ONLY === '1' ? `${head}\n${body}` : `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}</head><body>${body}</body></html>`;
fs.writeFileSync(process.env.OUT || 'reports/index.html', out);
console.log(md);
