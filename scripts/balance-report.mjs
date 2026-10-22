// Builds reports/balance/index.html + summary.md from reports/balance/balance.json.
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.OUT || 'reports/balance';
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'balance.json'), 'utf8'));
const L = data.levels;
const pct = x => Math.round(x * 100);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const target = pct(data.target);
const tooHard = L.filter(r => r.delta != null && r.delta >= 3).sort((a, b) => b.delta - a.delta);
const tooEasy = L.filter(r => r.delta != null && r.delta <= -3).sort((a, b) => a.delta - b.delta);
const stuck = L.filter(r => r.casual.stuck > 0.1);
const when = new Date(data.at).toLocaleString('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' });

// ---------- markdown ----------
let md = `## Balanc všech levelů\n\n${when} · ${L.length} levelů · ${data.samples} her na level a typ hráče · cíl: ${target} % běžných hráčů vyhraje\n\n`;
md += `| | Počet levelů |\n|---|---|\n| Limit tahů by šel **zvýšit** o 3 a víc (level je těžší, než je cíl) | ${tooHard.length} |\n| Limit tahů by šel **snížit** o 3 a víc (level je snazší) | ${tooEasy.length} |\n| Běžný hráč často nedohraje ani s mnohem víc tahy | ${stuck.length} |\n`;
const rows = list => list.slice(0, 20).map(r => `| ${r.number} | ${esc(r.name)} | ${r.budget} | ${pct(r.casual.win)} % | ${pct(r.skilled.win)} % | ${r.suggested ?? '–'} | ${r.delta > 0 ? '+' : ''}${r.delta ?? '–'} |`).join('\n');
const head = `| # | Level | Limit | Běžný hráč vyhraje | Zkušený vyhraje | Doporučený limit | Změna |\n|---|---|---|---|---|---|---|\n`;
if (tooHard.length) md += `\n### Nejtěžší vůči cíli\n\n${head}${rows(tooHard)}\n`;
if (tooEasy.length) md += `\n### Nejsnazší vůči cíli\n\n${head}${rows(tooEasy)}\n`;
if (L[0]?.casual.rating) {
  const verdict = r => { const g = r.casual.rating; return g.hard >= g.fair && g.hard >= g.easy ? 'hard' : g.fair >= g.easy ? 'fair' : 'easy'; };
  const c = { easy: 0, fair: 0, hard: 0 }; L.forEach(r => c[verdict(r)]++);
  md += `\n### Hodnocení jako ve slepém playtestu\n\nStejné pravidlo jako bot v playtestu (došly tahy nebo zbyly nejvýš 2 = Těžké, 3–6 = Akorát, 7+ = Lehké), ale ze stovek her běžného hráče na každý level a bez pomůcek. Level dostane hodnocení, které padlo nejčastěji.\n\n| Počet levelů | Lehké | Akorát | Těžké |\n|---|---|---|---|\n| běžný hráč | ${c.easy} | ${c.fair} | ${c.hard} |\n`;
}
if (data.compare) {
  const cmp = L.filter(r => r.noChargeSwap).map(r => ({ ...r, dc: pct(r.casual.win) - pct(r.noChargeSwap.casual), ds: pct(r.skilled.win) - pct(r.noChargeSwap.skilled) }));
  const avg = k => (cmp.reduce((n, r) => n + r[k], 0) / (cmp.length || 1)).toFixed(1);
  const big = cmp.filter(r => r.dc >= 10).sort((a, b) => b.dc - a.dc);
  md += `\n### Dopad přesouvání nábojů\n\nStejné hry (stejné desky) zahrané s možností přesunout náboj a bez ní. Kladné číslo = s přesunem se vyhrává častěji, level je snazší.\n\n`;
  md += `| | Běžný hráč | Zkušený hráč |\n|---|---|---|\n| Průměrná změna úspěšnosti | ${avg('dc') > 0 ? '+' : ''}${avg('dc')} p. b. | ${avg('ds') > 0 ? '+' : ''}${avg('ds')} p. b. |\n| Levely snazší o 10 p. b. a víc | ${big.length} | ${cmp.filter(r => r.ds >= 10).length} |\n`;
  if (big.length) md += `\n| # | Level | Limit | Běžný hráč bez přesunu | s přesunem | Změna |\n|---|---|---|---|---|---|\n${big.slice(0, 15).map(r => `| ${r.number} | ${esc(r.name)} | ${r.budget} | ${pct(r.noChargeSwap.casual)} % | ${pct(r.casual.win)} % | +${r.dc} |`).join('\n')}\n`;
  md += `\nSimulovaný hráč náboj přesune, když mu to hned zlepší místo výbuchu, nebo ho krok po kroku vede k nejlepšímu místu na desce. Kaskády ale dopředu neplánuje, takže zkušený člověk může z pravidla vytěžit o něco víc.\n`;
}
md += `\nCelá tabulka všech levelů je v reportu (index.html) a v balance.csv.\n`;
fs.writeFileSync(path.join(DIR, 'summary.md'), md);

// ---------- chart geometry ----------
const W = 1100, H = 300, padL = 44, padR = 16, padT = 16, padB = 34;
const x = n => padL + (n - 1) / Math.max(1, L.at(-1).number - 1) * (W - padL - padR);
const y = v => padT + (1 - v) * (H - padT - padB);
const line = key => L.map((r, i) => `${i ? 'L' : 'M'}${x(r.number).toFixed(1)},${y(r[key].win).toFixed(1)}`).join('');
const ticksY = [0, 0.25, 0.5, 0.75, 1];
const ticksX = L.filter(r => r.number === 1 || r.number % 20 === 0 || r.number === L.at(-1).number).map(r => r.number);
const hardMarks = L.filter(r => r.hard);

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Beyond the Signal · balanc</title>
<style>
:root{--bg:#eef2f5;--panel:#fff;--ink:#14212e;--muted:#5a6b7c;--line:#d5dee6;--grid:#e6ecf1;--s1:#2a78d6;--s2:#eb6834;--up:#b8322f;--down:#1d7f55}
@media (prefers-color-scheme:dark){:root{--bg:#0b1420;--panel:#122030;--ink:#e3ebf2;--muted:#8fa3b6;--line:#21364a;--grid:#1b2c3d;--s1:#3987e5;--s2:#d95926;--up:#ff7a6e;--down:#4cc38a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 48px;display:grid;gap:24px}
h1{margin:0;font-size:28px}h2{margin:0;font-size:19px}.muted{color:var(--muted)}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.strip div{background:var(--panel);padding:14px 16px}.strip b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0}
.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:6px}.legend i{display:inline-block;width:18px;height:2px;vertical-align:middle;margin-right:6px}
.chart{position:relative;overflow-x:auto}svg{display:block;width:100%;min-width:640px;height:auto}
.tip{position:absolute;pointer-events:none;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.15);display:none;min-width:200px}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600;position:sticky;top:0;background:var(--panel);cursor:pointer}td.n{font-variant-numeric:tabular-nums;text-align:right}
.up{color:var(--up);font-weight:600}.down{color:var(--down);font-weight:600}
input{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);width:min(320px,100%)}
</style></head><body><main>
<header><h1>Balanc všech levelů</h1><p class="muted">${when} · ${data.samples} simulovaných her na level a typ hráče · cíl: <b>${target} %</b> běžných hráčů level vyhraje bez reklamy a pomůcek</p></header>
<div class="strip">
<div><b>${L.length}</b>levelů</div>
<div><b class="up">${tooHard.length}</b>těžších, než je cíl (limit +3 a víc)</div>
<div><b class="down">${tooEasy.length}</b>snazších, než je cíl (limit −3 a víc)</div>
<div><b>${stuck.length}</b>levelů, kde běžný hráč často nedohraje vůbec</div>
</div>
<section class="card">
<h2>Křivka obtížnosti</h2>
<p class="muted" style="margin:4px 0 10px">Kolik procent her skončí výhrou při současném limitu tahů. Kroužky jsou HARD levely.</p>
<div class="legend"><span><i style="background:var(--s1)"></i>Zkušený hráč</span><span><i style="background:var(--s2)"></i>Běžný hráč</span><span><i style="background:var(--muted);height:1px"></i>Cíl ${target} %</span></div>
<div class="chart" id="chart">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Podíl výher podle levelu">
${ticksY.map(t => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${pct(t)} %</text>`).join('')}
${ticksX.map(n => `<text x="${x(n)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="var(--muted)">${n}</text>`).join('')}
<line x1="${padL}" x2="${W - padR}" y1="${y(data.target)}" y2="${y(data.target)}" stroke="var(--muted)" stroke-dasharray="4 4"/>
<path d="${line('skilled')}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>
<path d="${line('casual')}" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>
${hardMarks.map(r => `<circle cx="${x(r.number)}" cy="${y(r.casual.win)}" r="4" fill="var(--panel)" stroke="var(--s2)" stroke-width="2"/>`).join('')}
<line id="cross" y1="${padT}" y2="${H - padB}" stroke="var(--muted)" stroke-width="1" style="display:none"/>
<rect id="hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="transparent"/>
</svg><div class="tip" id="tip"></div></div>
</section>
<section class="card">
<h2>Všechny levely</h2>
<p class="muted" style="margin:4px 0 10px">„Tahy potřeba“ = kolik tahů potřebuje polovina / tři čtvrtiny / 90 % běžných hráčů. Doporučený limit = tahy, se kterými vyhraje ${target} % běžných hráčů. Kliknutím na záhlaví seřadíš.</p>
<input id="filter" placeholder="Hledat level nebo kapitolu…" aria-label="Hledat level">
<div class="scroll" style="margin-top:10px;max-height:70vh"><table id="t"><thead><tr>
<th data-k="number">#</th><th data-k="name">Level</th><th data-k="group">Kapitola</th><th data-k="budget">Limit</th><th data-k="sw">Zkušený vyhraje</th><th data-k="cw">Běžný vyhraje</th><th data-k="p50">Tahy potřeba (50 / 75 / 90 %)</th><th data-k="suggested">Doporučený limit</th><th data-k="delta">Změna</th>${L[0]?.casual.rating ? '<th data-k="rh">Hodnocení běžného hráče (L / A / T)</th>' : ''}${data.compare ? '<th data-k="cwOld">Běžný bez přesunu nábojů</th><th data-k="dc">Dopad přesunu</th>' : ''}
</tr></thead><tbody></tbody></table></div>
</section>
${data.compare ? '<p class="muted">„Dopad přesunu“ = o kolik procentních bodů častěji vyhraje běžný hráč, když smí přesouvat náboje (stejné desky s pravidlem a bez něj).</p>' : ''}
<p class="muted">Simulace hraje podle pravidel přímo ze zdrojového kódu hry, ale bez reklam a pomůcek. Skuteční hráči je mají, takže reálná úspěšnost bude o něco vyšší. Výsledky porovnej s daty hráčů v balance.html.</p>
</main>
<script>
const L=${JSON.stringify(L.map(r => ({ number: r.number, name: r.name, group: r.group, budget: r.budget, sw: Math.round(r.skilled.win * 100), cw: Math.round(r.casual.win * 100), p50: r.casual.p50, p75: r.casual.p75, p90: r.casual.p90, suggested: r.suggested, delta: r.delta, re: r.casual.rating ? Math.round(r.casual.rating.easy * 100) : null, rf: r.casual.rating ? Math.round(r.casual.rating.fair * 100) : null, rh: r.casual.rating ? Math.round(r.casual.rating.hard * 100) : null, cwOld: r.noChargeSwap ? Math.round(r.noChargeSwap.casual * 100) : null, dc: r.noChargeSwap ? Math.round(r.casual.win * 100) - Math.round(r.noChargeSwap.casual * 100) : null })))};
const CMP=${data.compare ? 'true' : 'false'},RAT=${L[0]?.casual.rating ? 'true' : 'false'};
const fmt=v=>v==null||v===null||!isFinite(v)?'–':v;
let key='number',dir=1;
function render(){const f=document.getElementById('filter').value.toLowerCase();
 const rows=L.filter(r=>!f||(r.name+' '+r.group+' '+r.number).toLowerCase().includes(f)).sort((a,b)=>((a[key]??999)>(b[key]??999)?1:(a[key]??999)<(b[key]??999)?-1:0)*dir);
 document.querySelector('#t tbody').innerHTML=rows.map(r=>'<tr><td class="n">'+r.number+'</td><td>'+r.name.replace(/</g,'&lt;')+'</td><td class="muted">'+r.group.replace(/</g,'&lt;')+'</td><td class="n">'+r.budget+'</td><td class="n">'+r.sw+' %</td><td class="n">'+r.cw+' %</td><td class="n">'+fmt(r.p50)+' / '+fmt(r.p75)+' / '+fmt(r.p90)+'</td><td class="n">'+fmt(r.suggested)+'</td><td class="n '+(r.delta>=3?'up':r.delta<=-3?'down':'')+'">'+(r.delta>0?'+':'')+fmt(r.delta)+'</td>'+(RAT?'<td class="n">'+r.re+' / '+r.rf+' / <b>'+r.rh+'</b> %</td>':'')+(CMP?'<td class="n">'+(r.cwOld==null?'–':r.cwOld+' %')+'</td><td class="n '+(r.dc>=10?'down':r.dc<=-10?'up':'')+'">'+(r.dc>0?'+':'')+fmt(r.dc)+'</td>':'')+'</tr>').join('');}
document.querySelectorAll('th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;dir=key===k?-dir:1;key=k;render();});
document.getElementById('filter').oninput=render;render();
const svg=document.querySelector('svg'),tip=document.getElementById('tip'),cross=document.getElementById('cross'),box=document.getElementById('chart');
const W=${W},padL=${padL},padR=${padR},last=L[L.length-1].number;
document.getElementById('hit').addEventListener('pointermove',e=>{const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const p=pt.matrixTransform(svg.getScreenCTM().inverse());
 const n=Math.round(1+(p.x-padL)/(W-padL-padR)*(last-1));const r=L.reduce((a,b)=>Math.abs(b.number-n)<Math.abs(a.number-n)?b:a);
 const cx=padL+(r.number-1)/(last-1)*(W-padL-padR);cross.setAttribute('x1',cx);cross.setAttribute('x2',cx);cross.style.display='';
 tip.innerHTML='<b>'+r.number+'. '+r.name.replace(/</g,'&lt;')+'</b><br><span class="muted">'+r.group.replace(/</g,'&lt;')+'</span><br>Limit '+r.budget+' tahů<br>Zkušený vyhraje '+r.sw+' %<br>Běžný vyhraje '+r.cw+' %<br>Doporučený limit '+fmt(r.suggested);
 const rect=box.getBoundingClientRect();tip.style.display='block';const left=e.clientX-rect.left+box.scrollLeft+14;tip.style.left=Math.min(left,box.scrollWidth-230)+'px';tip.style.top=(e.clientY-rect.top+10)+'px';});
document.getElementById('hit').addEventListener('pointerleave',()=>{tip.style.display='none';cross.style.display='none';});
</script></body></html>`;
fs.writeFileSync(path.join(DIR, 'index.html'), html);
console.log(md);
