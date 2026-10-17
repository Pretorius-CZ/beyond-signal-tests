// Summary for the extra checks: node scripts/suite-summary.mjs <chaos|czech|perf|a11y>
// Writes reports/<suite>/summary.md (GitHub run page) and reports/<suite>/index.html.
import fs from 'node:fs';
import path from 'node:path';

const suite = process.argv[2];
const DIR = path.join('reports', suite);
fs.mkdirSync(DIR, { recursive: true });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const jsons = () => fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const when = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' });
let title = '', md = '', body = '';

if (suite === 'chaos') {
  title = 'Opičák – netrpělivý hráč';
  const rows = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).flatMap(f => fs.readFileSync(path.join(DIR, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const scenarios = [...new Set(rows.map(r => r.scenario))], devices = [...new Set(rows.map(r => r.device))];
  const bad = rows.filter(r => r.problems.length), notes = rows.filter(r => r.notes?.length);
  md = `| Scénář | ${devices.join(' | ')} |\n|---|${devices.map(() => '---|').join('')}\n` + scenarios.map(s => `| ${s} | ${devices.map(d => { const r = rows.find(x => x.scenario === s && x.device === d); return !r ? '–' : r.problems.length ? `❌ ${r.problems.length}` : r.notes?.length ? '⚠️' : '✅'; }).join(' | ')} |`).join('\n') + '\n';
  if (bad.length) md += `\n### Problémy\n\n${bad.map(r => `- **${r.scenario}** · ${r.device}: ${r.problems.slice(0, 5).map(esc).join('; ')}${r.problems.length > 5 ? ` (+${r.problems.length - 5})` : ''}`).join('\n')}\n`;
  if (notes.length) md += `\n### Postřehy\n\n${[...new Set(notes.flatMap(r => r.notes))].map(n => `- ${esc(n)}`).join('\n')}\n`;
} else if (suite === 'czech') {
  title = 'Čeština';
  const st = fs.existsSync(path.join(DIR, 'missing.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'missing.json'), 'utf8')) : null;
  const dyn = jsons().filter(j => j.device);
  md = st ? `**Ve zdrojovém kódu:** zkontrolováno ${st.checked} textů, bez českého překladu **${st.missing.length}**.\n` : '';
  if (st?.missing.length) md += `\n| Text | Kde |\n|---|---|\n${st.missing.slice(0, 60).map(m => `| ${esc(m.text.slice(0, 100))} | ${esc(m.sources.join(', '))} |`).join('\n')}\n`;
  for (const d of dyn) {
    md += `\n### Ve hře · ${d.device}\n\n- zbylá angličtina: **${d.english.length}**\n- useknutý nebo přetékající text: **${d.clipped.length}**\n`;
    if (d.english.length) md += d.english.slice(0, 30).map(e => `  - „${esc(e.text)}“ (${e.screen})`).join('\n') + '\n';
    if (d.clipped.length) md += d.clipped.slice(0, 20).map(c => `  - ${c.kind}: ${esc(c.el)} ${esc(c.detail)} (${c.screen})`).join('\n') + '\n';
  }
} else if (suite === 'perf') {
  title = 'Výkon a paměť';
  const all = jsons();
  const load = all.filter(j => 'playVisibleMs' in j), play = all.filter(j => j.fps);
  if (load.length) md += `### Načtení\n\n| Zařízení | Podmínky | Tlačítko HRÁT za | Hlavní obsah (LCP) | Staženo | Největší soubory |\n|---|---|---|---|---|---|\n${load.map(l => `| ${l.device} | ${l.label} | ${(l.playVisibleMs / 1000).toFixed(1)} s | ${(l.lcpMs / 1000).toFixed(1)} s | ${l.mb} MB (${l.requests} souborů) | ${l.biggest.slice(0, 3).map(b => `${b.url} ${b.kb} kB`).join(', ')} |`).join('\n')}\n`;
  if (play.length) md += `\n### Hraní\n\n| Zařízení | Podmínky | Levelů | FPS medián / nejhorších 10 % | Zaseknutí > 50 ms (> 200 ms) | Nejdelší | Paměť start → konec | Trend paměti | Prvky stránky |\n|---|---|---|---|---|---|---|---|---|\n${play.map(p => `| ${p.device} | ${p.label} | ${p.levels} | ${p.fps.median} / ${p.fps.worst10} | ${p.longTasks.count} (${p.longTasks.over200ms}) | ${p.longTasks.max} ms | ${p.memory.startMB} → ${p.memory.endMB} MB | ${p.memory.slopeMBperLevel > 1 ? '❌' : '✅'} ${p.memory.slopeMBperLevel} MB/level | ${p.memory.nodesStart} → ${p.memory.nodesEnd} |`).join('\n')}\n\nFPS na serveru bez grafické karty je jen orientační: porovnávej mezi běhy, ne s telefonem. Trend paměti nad 1 MB na level ukazuje na únik paměti.\n`;
} else if (suite === 'a11y') {
  title = 'Přístupnost';
  const { RULES_CS } = await import('../lib/a11y-rules.js');
  const all = jsons();
  const by = {};
  for (const j of all) for (const v of j.violations) { const k = v.rule; (by[k] ??= { rule: k, impact: v.impact, help: RULES_CS?.[k] || v.help, count: 0, screens: new Set(), devices: new Set(), example: v.example }); by[k].count += v.count; by[k].screens.add(v.screen); by[k].devices.add(`${j.device} ${j.language}`); }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const list = Object.values(by).sort((a, b) => order[a.impact] - order[b.impact] || b.count - a.count);
  const kb = [...new Set(all.flatMap(j => j.keyboard))];
  md = `Prohlédnuté obrazovky: ${[...new Set(all.flatMap(j => j.scanned || []))].join(', ')}\n\n`;
  md += list.length ? `| Závažnost | Problém | Výskytů | Obrazovky | Příklad |\n|---|---|---|---|---|\n${list.map(v => `| ${{ critical: '❌ kritická', serious: '❌ vážná', moderate: '⚠️ střední', minor: 'ℹ️ drobná' }[v.impact] || v.impact} | ${esc(v.help)} | ${v.count} | ${[...v.screens].join(', ')} | \`${String(v.example).replace(/[|`]/g, '/').slice(0, 120)}\` |`).join('\n')}\n` : 'Žádné problémy nenalezeny. ✅\n';
  if (kb.length) md += `\n### Klávesnice\n\n${kb.map(k => `- ${esc(k)}`).join('\n')}\n`;
}

md = `## ${title}\n\n${when}\n\n${md}`;
fs.writeFileSync(path.join(DIR, 'summary.md'), md);
// minimal HTML rendering of the same content (tables/lists) for the downloadable report
const toHtml = m => m.split('\n\n').map(block => {
  if (block.startsWith('## ')) return `<h1>${block.slice(3)}</h1>`;
  if (block.startsWith('### ')) return `<h2>${block.slice(4)}</h2>`;
  if (block.startsWith('|')) { const lines = block.trim().split('\n').filter(l => !/^\|[-|\s]+\|$/.test(l)); return `<div class="scroll"><table>${lines.map((l, i) => `<tr>${l.slice(1, -1).split(' | ').map(c => i ? `<td>${c}</td>` : `<th>${c}</th>`).join('')}</tr>`).join('')}</table></div>`; }
  if (/^\s*- /.test(block)) return `<ul>${block.trim().split('\n').map(l => `<li>${l.replace(/^\s*- /, '')}</li>`).join('')}</ul>`;
  return `<p>${block}</p>`;
}).join('\n').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beyond the Signal · ${title}</title>
<style>:root{--bg:#eef2f5;--panel:#fff;--ink:#14212e;--muted:#5a6b7c;--line:#d5dee6}@media (prefers-color-scheme:dark){:root{--bg:#0b1420;--panel:#122030;--ink:#e3ebf2;--muted:#8fa3b6;--line:#21364a;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:28px 16px}.scroll{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:10px 0}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px}code{font-size:12px;word-break:break-all}</style></head><body><main>${toHtml(md)}</main></body></html>`);
console.log(md);
