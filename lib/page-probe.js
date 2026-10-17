// Functions that run INSIDE the game page (passed to page.evaluate).
// They only read the DOM — the game itself is never modified.

/** Reads the whole game state from the DOM. */
export function readState() {
  const q = s => document.querySelector(s);
  const visible = el => !!el && el.getClientRects().length > 0;
  const board = q('.board');
  const cells = [...document.querySelectorAll('button[data-cell]')];
  const cols = board ? Number(getComputedStyle(board).getPropertyValue('--cols')) || 0 : 0;
  const size = cells.length ? Math.max(...cells.map(c => +c.dataset.cell)) + 1 : 0;
  const tiles = Array.from({ length: size }, () => null);
  for (const c of cells) {
    const i = +c.dataset.cell;
    tiles[i] = {
      type: c.dataset.type == null ? null : Number(c.dataset.type),
      frozen: c.classList.contains('frozen-cell'),
      booster: c.dataset.booster || null,
      ring: c.classList.contains('resonator-neighbour'), // next to an uncharged resonator ring
      sprite: c.querySelector('img')?.getAttribute('src') || null,
    };
  }
  const goals = [...document.querySelectorAll('.objective-list .charge')].map(g => {
    const p = g.querySelector('progress');
    return { sprite: g.querySelector('img')?.getAttribute('src') || null, value: p ? +p.value : null, max: p ? +p.max : null, text: g.innerText.trim() };
  });
  const movesEl = q('.moves-counter strong');
  const outOfMoves = q('.out-of-moves[role="region"]');
  const fault = q('.out-of-moves[role="alert"]');
  const tutorialClose = q('.tutorial-close');
  const rewardAd = q('dialog.reward-ad[open], [data-bot="ad"], [data-ad-overlay], .ad-overlay, .reward-ad-overlay');
  const helpers = [...document.querySelectorAll('.helper-tile')].map((b, i) => ({ i, stock: b.classList.contains('in-stock'), disabled: b.disabled, label: b.getAttribute('aria-label') }));
  return {
    inLevel: !!q('dialog.mini-dialog[open]'),
    title: q('#level-title')?.innerText?.trim() || null,
    cols, tiles, goals, helpers,
    movesLeft: movesEl ? Number(movesEl.innerText) : null,
    busy: board?.getAttribute('aria-busy') === 'true' || !!q('.shuffle-overlay') || !!q('.resonator-feedback'),
    won: visible(q('.win-panel')),
    stars: q('.win-panel')?.querySelectorAll('.star-earned, .earned, [data-earned="true"]').length ?? null,
    outOfMoves: visible(outOfMoves),
    adMovesAvailable: !!outOfMoves && !!outOfMoves.querySelector('button.primary:not([disabled])'),
    fault: visible(fault),
    tutorial: visible(tutorialClose),
    rewardAd: !!rewardAd,
    noLives: !cells.length && !!q('dialog.mini-dialog[open] .out-of-moves:not([role])'),
    message: q('.mini-dialog [role="status"]')?.innerText || null,
  };
}

/** Chooses the best move with a greedy, goal-aware heuristic. */
export function chooseMove(state) {
  const { tiles, cols, goals } = state;
  if (!cols || !tiles.length) return null;
  const rows = Math.ceil(tiles.length / cols);
  const openGoals = goals.filter(g => g.max != null && g.value < g.max);
  const goalSprites = new Set(openGoals.map(g => g.sprite).filter(Boolean));
  const anyPieceGoal = openGoals.some(g => !g.sprite);
  const frozenCount = tiles.filter(t => t?.frozen).length;
  const typeOf = (b, i) => (b[i] && b[i].type != null && b[i].type < 10 ? b[i].type : null);
  const swappable = i => tiles[i] && tiles[i].type != null && !tiles[i].frozen && tiles[i].type < 10;

  function findMatches(b) {
    const hit = new Set(); let longest = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols;) {
      const t = typeOf(b, r * cols + c); let n = 1;
      while (t != null && c + n < cols && typeOf(b, r * cols + c + n) === t) n++;
      if (t != null && n >= 3) { for (let k = 0; k < n; k++) hit.add(r * cols + c + k); longest = Math.max(longest, n); }
      c += n;
    }
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows;) {
      const t = typeOf(b, r * cols + c); let n = 1;
      while (t != null && r + n < rows && typeOf(b, (r + n) * cols + c) === t) n++;
      if (t != null && n >= 3) { for (let k = 0; k < n; k++) hit.add((r + k) * cols + c); longest = Math.max(longest, n); }
      r += n;
    }
    return { hit: [...hit], longest };
  }
  const neighbours = i => [i - cols, i + cols, i % cols ? i - 1 : -1, (i + 1) % cols ? i + 1 : -1].filter(j => j >= 0 && j < tiles.length);

  const options = [];
  for (let a = 0; a < tiles.length; a++) {
    if (tiles[a]?.booster && !tiles[a].frozen) {
      // Charges: more valuable when covers remain or near the end.
      options.push({ kind: 'booster', a, b: a, score: 6 + (frozenCount ? 6 : 0) + (state.movesLeft <= 3 ? 10 : 0) });
    }
    for (const b of [(a + 1) % cols ? a + 1 : -1, a + cols]) {
      if (b < 0 || b >= tiles.length || !swappable(a) || !swappable(b)) continue;
      const next = tiles.slice(); [next[a], next[b]] = [next[b], next[a]];
      const { hit, longest } = findMatches(next);
      if (!hit.length) continue;
      const goalHits = hit.filter(i => anyPieceGoal || goalSprites.has(next[i].sprite)).length;
      const coverHits = new Set(hit.flatMap(neighbours).filter(j => tiles[j]?.frozen)).size;
      const ringHits = hit.some(i => tiles[i]?.ring) ? 1 : 0; // a match on a cell next to a resonator ring charges it
      const score = hit.length + goalHits * 3 + coverHits * 5 + ringHits * 8 + (longest >= 4 ? 6 : 0) + (longest >= 5 ? 6 : 0) + Math.random() * 0.5;
      options.push({ kind: 'swap', a, b, score, goalHits, coverHits });
    }
  }
  options.sort((x, y) => y.score - x.score);
  return options[0] || null;
}

/** Picks the best target for a helper tool (0 Laser, 3 Beam, 4 EMP). */
export function chooseHelperTarget(state, helper) {
  const { tiles, cols, goals } = state;
  const openSprites = new Set(goals.filter(g => g.value < g.max).map(g => g.sprite).filter(Boolean));
  const value = i => !tiles[i] ? 0 : (tiles[i].frozen ? 4 : 0) + (openSprites.has(tiles[i].sprite) || !openSprites.size ? 2 : 0.2);
  let best = null, bestScore = -1;
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i]) continue;
    let s = 0;
    if (helper === 0) s = value(i);
    if (helper === 3) { const r = Math.floor(i / cols); for (let c = 0; c < cols; c++) s += value(r * cols + c); }
    if (helper === 4) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r = Math.floor(i / cols) + dr, c = (i % cols) + dc; if (r >= 0 && c >= 0 && c < cols) s += value(r * cols + c); }
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

/** Layout and text checks on whatever is currently on screen. */
export function auditScreen() {
  // On phones an overflowing page silently widens the layout viewport, so compare with the real screen width.
  const vw = Math.min(innerWidth, screen.width || innerWidth), vh = innerHeight;
  const modals = [...document.querySelectorAll('dialog[open]')].filter(d => d.matches(':modal'));
  const root = modals.at(-1) || document.body;
  const issues = [];
  const shown = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && !el.closest('.sr-only, .visually-hidden'); };
  const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} „${(el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}“`;
  const scrollable = el => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) return true; } return document.scrollingElement.scrollHeight > vh + 2; };

  const interactive = [...root.querySelectorAll('button, a[href], input, select, [role="button"]')].filter(shown);
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.right < 1 || r.left > vw - 1 || ((r.bottom < 1 || r.top > vh - 1) && !scrollable(el))) { issues.push({ kind: 'mimo-obrazovku', severity: 'error', el: name(el) }); continue; }
    if (r.left < -2 || r.right > vw + 2) issues.push({ kind: 'useknuto-na-okraji', severity: 'error', el: name(el), detail: `x ${Math.round(r.left)}–${Math.round(r.right)}, šířka okna ${vw}` });
    if (r.top >= 0 && r.bottom <= vh && !el.disabled) {
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) issues.push({ kind: 'zakryto', severity: 'error', el: name(el), detail: 'střed překrývá ' + name(top) });
    }
    if (matchMedia('(pointer: coarse)').matches && (r.width < 24 || r.height < 24)) issues.push({ kind: 'maly-dotykovy-cil', severity: 'warning', el: name(el), detail: `${Math.round(r.width)}×${Math.round(r.height)} px` });
  }
  for (const el of root.querySelectorAll('h1,h2,h3,p,span,strong,small,button,label')) {
    if (!shown(el) || !el.innerText?.trim()) continue;
    const cs = getComputedStyle(el);
    if ((el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(cs.overflowX)) || (el.scrollHeight > el.clientHeight + 2 && /(hidden|clip)/.test(cs.overflowY) && cs.display !== 'inline'))
      issues.push({ kind: 'oriznuty-text', severity: 'warning', el: name(el) });
  }
  const text = root.innerText || '';
  const nonsense = [/\bundefined\b/, /\bNaN\b/, /\bnull\b/, /\[object \w+\]/, /\{\{|\}\}/, /\bInfinity\b/, /-\d+\s*(moves|tahů|\/)/i, /\b[a-z]+(\.[a-z][a-zA-Z0-9_]+){2,}\b/];
  for (const re of nonsense) { const m = text.match(re); if (m) issues.push({ kind: 'nesmysl-v-textu', severity: 'error', el: `„${text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, ' ')}“`, detail: String(re) }); }
  if (document.documentElement.scrollWidth > vw + 2) issues.push({ kind: 'vodorovne-posouvani', severity: 'error', el: 'stránka', detail: `obsah ${document.documentElement.scrollWidth}px > okno ${vw}px` });
  return issues;
}
