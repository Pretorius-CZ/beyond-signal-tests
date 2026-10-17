// Compares reports/visual/current with reports/visual/previous (the last run) and builds
// reports/visual/index.html + summary.md. Board pieces and timers are hidden in the snapshots (random content).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = 'reports/visual';
const CUR = path.join(ROOT, 'current'), PREV = path.join(ROOT, 'previous'), DIFF = path.join(ROOT, 'diff');
const LIMIT = Number(process.env.VISUAL_LIMIT || 0.5); // % of changed pixels that counts as a change
const list = d => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter(f => f.endsWith('.png')) : [];
const cur = list(CUR), prev = new Set(list(PREV));
const rows = [];
for (const f of cur) {
  const row = { file: f, status: 'nový snímek', pct: null };
  if (prev.has(f)) {
    const a = PNG.sync.read(fs.readFileSync(path.join(PREV, f))), b = PNG.sync.read(fs.readFileSync(path.join(CUR, f)));
    if (a.width !== b.width || a.height !== b.height) { row.status = `změnil se rozměr (${a.width}×${a.height} → ${b.width}×${b.height})`; row.pct = 100; }
    else {
      const out = new PNG({ width: a.width, height: a.height });
      const n = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.15, includeAA: false, alpha: 0.3 });
      row.pct = +(100 * n / (a.width * a.height)).toFixed(2);
      row.status = row.pct >= LIMIT ? 'změna' : 'beze změny';
      if (row.pct >= LIMIT) { fs.mkdirSync(path.dirname(path.join(DIFF, f)), { recursive: true }); fs.writeFileSync(path.join(DIFF, f), PNG.sync.write(out)); }
    }
  }
  rows.push(row);
}
for (const f of prev) if (!cur.includes(f)) rows.push({ file: f, status: 'snímek chybí (obrazovka se nepodařila vyfotit)', pct: null });
rows.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
const changed = rows.filter(r => r.status !== 'beze změny' && r.status !== 'nový snímek');
const first = !prev.size;

let md = `## Změny vzhledu\n\n`;
md += first ? 'První běh: snímky jsou uložené jako výchozí, porovnání proběhne příště.\n' : `${rows.length} snímků · **${changed.length} se změnilo** (víc než ${LIMIT} % plochy)\n`;
if (changed.length) md += `\n| Snímek | Změna |\n|---|---|\n${changed.map(r => `| ${r.file} | ${r.pct != null ? r.pct + ' %' : ''} ${r.status === 'změna' ? '' : r.status} |`).join('\n')}\n`;
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, 'summary.md'), md);

const img = (dir, f) => fs.existsSync(path.join(dir, f)) ? `<img loading="lazy" src="${dir.replace(ROOT + '/', '')}/${f.split(path.sep).map(encodeURIComponent).join('/')}" alt="">` : '<div class="none">–</div>';
const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beyond the Signal · vzhled</title>
<style>:root{--bg:#eef2f5;--panel:#fff;--ink:#14212e;--muted:#5a6b7c;--line:#d5dee6;--bad:#b8322f}
@media (prefers-color-scheme:dark){:root{--bg:#0b1420;--panel:#122030;--ink:#e3ebf2;--muted:#8fa3b6;--line:#21364a;--bad:#ff7a6e;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:28px 16px;display:grid;gap:18px}
h1{margin:0}.muted{color:var(--muted)}.row{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;display:grid;gap:8px}
.row h2{font-size:15px;margin:0}.row h2 b{color:var(--bad)}.imgs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.imgs figure{margin:0}.imgs figcaption{font-size:12px;color:var(--muted)}
img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px}.none{padding:40px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:6px}
details{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}</style></head><body><main>
<h1>Změny vzhledu</h1><p class="muted">${new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })} · ${first ? 'první běh – výchozí snímky uloženy' : `${changed.length} z ${rows.length} snímků se změnilo oproti minulému běhu`} · dílky na desce a odpočet energie jsou při focení skryté (mění se náhodně)</p>
${changed.map(r => `<section class="row"><h2>${r.file} <b>${r.pct != null ? r.pct + ' %' : ''} ${r.status === 'změna' ? '' : r.status}</b></h2><div class="imgs"><figure>${img(PREV, r.file)}<figcaption>minule</figcaption></figure><figure>${img(CUR, r.file)}<figcaption>teď</figcaption></figure><figure>${img(DIFF, r.file)}<figcaption>rozdíl (červeně)</figcaption></figure></div></section>`).join('')}
<details><summary>Všechny snímky (${rows.length})</summary><div class="imgs" style="margin-top:10px">${rows.map(r => `<figure>${img(CUR, r.file)}<figcaption>${r.file} · ${r.status}${r.pct != null ? ' · ' + r.pct + ' %' : ''}</figcaption></figure>`).join('')}</div></details>
</main></body></html>`;
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(md);
