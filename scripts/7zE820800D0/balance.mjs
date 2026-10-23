// Balance simulation: plays every level of the game thousands of times WITHOUT a browser,
// using the game's own rules (imported straight from its source code).
//
// For each level it measures how many moves two kinds of players need to finish it:
//   "zkušený" (skilled)  – always takes the best immediate move (goal pieces, covers, rings, charges)
//   "běžný"   (casual)   – picks randomly among its three best moves
// and suggests a move limit so that the chosen share of casual players wins (TARGET).
//
// Env: GAME_DIR (game repo checkout, default ./game), SAMPLES (games per level and player, default 200),
//      TARGET (share of casual players who should win, default 0.75), ONLY (comma-separated level numbers),
//      OUT (default reports/balance),
//      CHARGE_SWAP (auto = use the rule "move a charge by swapping it with a matching tile" when the game has it, 0 = off),
//      COMPARE (1 = also play every level WITHOUT moving charges and show the difference; default 1 when the rule exists)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GAME = path.resolve(process.env.GAME_DIR || 'game');
const SAMPLES = Number(process.env.SAMPLES || 200);
const TARGET = Number(process.env.TARGET || 0.75);
const OUT = process.env.OUT || 'reports/balance';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null;
const load = f => import(pathToFileURL(path.join(GAME, 'src', f)).href);

const { levelGroups } = await load('levelCatalog.js');
const { adjacent, swap } = await load('match3.js');
const rules = await load('levelRules.js');
const { moveBudget, initialIce, iceMatches, ensurePlayableBoard } = rules;
// Newer game versions: a charge can be moved by swapping it with an ordinary tile that then makes a match.
const swapMatches = rules.swapMatches || null;
const CHARGE_SWAP = process.env.CHARGE_SWAP !== '0' && !!swapMatches;
const COMPARE = CHARGE_SWAP && process.env.COMPARE !== '0';
const { goalsFor, collectGoals, goalsComplete } = await load('objectives.js');
const boostersModule = await load('boosters.js');
const { wave, blast, isBooster, rewards, boostersEnabled } = boostersModule;
const awardCascadePulse = boostersModule.awardCascadePulse || null; // newer games: a long cascade awards a bonus Pulse
const { makeGoalBoard, goalRefillRandom } = await load('goalRefill.js');
const { chargeResonators, resonatorsComplete } = await load('resonators.js');

// Stars exactly as the game awards them (starRating.js), with a fallback for older game versions.
let starsFor = (budget, moves) => { const left = Math.max(0, budget - moves); return left >= Math.ceil(budget * 0.30) ? 3 : left >= Math.ceil(budget * 0.15) ? 2 : 1; };
try { const m = await load('starRating.js'); if (m.earnedStars) starsFor = m.earnedStars; } catch {}

const levels = levelGroups.flatMap(([group, list]) => list.map(r => ({ repair: r, group }))).map((x, i) => ({ ...x, number: i + 1 }));

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Plays one game; returns the number of moves needed to win, or Infinity within the cap. */
function play(repair, random, style, cap, chargeSwap = CHARGE_SWAP) {
  const level = repair.level, cols = level.cols, goals = goalsFor(repair), rings = repair.resonators ?? [];
  const boosts = boostersEnabled(repair), history = {};
  let ice = initialIce(repair), counts = goals.map(() => 0), charged = rings.map(() => 0);
  let board = makeGoalBoard(level, goals, ice, random);
  const done = () => goalsComplete(goals, counts) && resonatorsComplete(rings, charged) && !ice.length;
  const nearRing = i => rings.some((r, k) => charged[k] < r.target && adjacent(i, r.at, cols));
  for (let move = 1; move <= cap; move++) {
    board = ensurePlayableBoard(board, level, ice, random).board;
    const options = [];
    board.forEach((v, a) => {
      if (!isBooster(v) || ice.includes(a)) return;
      const hit = blast(board, cols, [a]);
      const gain = collectGoals(goals, counts, board, hit.filter(i => !ice.includes(i) && !isBooster(board[i]))).reduce((n, x, i) => n + x - counts[i], 0);
      options.push({ a, b: a, value: gain + 5 * hit.filter(i => ice.includes(i)).length });
    });
    const gainAt = (b, at) => { // what a charge standing at `at` would collect/break when fired
      const hit = blast(b, cols, [at]);
      return collectGoals(goals, counts, b, hit.filter(i => !ice.includes(i) && !isBooster(b[i]))).reduce((n, x, i) => n + x - counts[i], 0) + 5 * hit.filter(i => ice.includes(i)).length;
    };
    const spots = {};
    const bestSpot = type => spots[type] ??= board.reduce((best, v, j) => {
      if (v == null || ice.includes(j)) return best;
      const b2 = board.slice(); b2[j] = type; const g = gainAt(b2, j);
      return g > best.gain ? { at: j, gain: g } : best;
    }, { at: -1, gain: -Infinity });
    for (let a = 0; a < board.length; a++) for (const b of [a + 1, a + cols]) {
      if (b >= board.length || board[a] == null || board[b] == null || ice.includes(a) || ice.includes(b) || !adjacent(a, b, cols)) continue;
      if (isBooster(board[a]) || isBooster(board[b])) {
        // Moving a charge (the game decides validity with its own swapMatches): the match counts as usual,
        // plus how much better the charge's new spot is for a later blast.
        if (!chargeSwap || (isBooster(board[a]) && isBooster(board[b]))) continue;
        const hit = swapMatches(board, a, b, cols, ice);
        if (!hit.length) continue;
        const next = swap(board, a, b), charge = isBooster(board[a]) ? a : b, to = charge === a ? b : a;
        const gain = collectGoals(goals, counts, next, hit.filter(i => !ice.includes(i))).reduce((n, x, i) => n + x - counts[i], 0);
        const coverHits = new Set(hit.flatMap(i => [i - cols, i + cols, i % cols ? i - 1 : -1, (i + 1) % cols ? i + 1 : -1]).filter(j => ice.includes(j))).size;
        const here = gainAt(board, charge), better = Math.max(0, gainAt(next, to) - here);
        // "Walking" the charge: a player who sees a much better spot further away moves the charge towards it
        // step by step (each step is still a normal match) and fires it there.
        const best = bestSpot(board[charge]);
        const dist = (i, j) => Math.abs(Math.floor(i / cols) - Math.floor(j / cols)) + Math.abs(i % cols - j % cols);
        const walk = best.gain > here + 3 && dist(to, best.at) < dist(charge, best.at) ? (best.gain - here) * 0.6 : 0;
        options.push({ a, b, charge: true, value: gain + 5 * coverHits + (hit.some(nearRing) ? 6 : 0) + (boosts ? rewards(next, cols, ice, [to, charge]).length * 4 : 0) + Math.max(better * 0.8, walk) });
        continue;
      }
      const next = swap(board, a, b), hit = iceMatches(next, cols, ice);
      if (!hit.length) continue;
      const gain = collectGoals(goals, counts, next, hit.filter(i => !ice.includes(i))).reduce((n, x, i) => n + x - counts[i], 0);
      const coverHits = new Set(hit.flatMap(i => [i - cols, i + cols, i % cols ? i - 1 : -1, (i + 1) % cols ? i + 1 : -1]).filter(j => ice.includes(j))).size;
      options.push({ a, b, value: gain + 5 * coverHits + (hit.some(nearRing) ? 6 : 0) + (boosts ? rewards(next, cols, ice, [b, a]).length * 4 : 0) });
    }
    if (!options.length) return Infinity;
    options.sort((x, y) => y.value - x.value);
    const pool = style === 'skilled' ? options.filter(o => o.value === options[0].value) : options.slice(0, 3);
    const m = pool[Math.floor(random() * pool.length)];
    const activation = m.a === m.b;
    board = activation ? [...board] : swap(board, m.a, m.b);
    let hit = activation ? [m.a] : iceMatches(board, cols, ice), cascade = 0, cascadeMatches = 0, lastCascade = [];
    while (hit.length) {
      if (++cascade > 40) break;
      const natural = activation && cascade === 1 ? [] : iceMatches(board, cols, ice);
      if (cascade > 1 && natural.length) { cascadeMatches++; lastCascade = natural; }
      charged = chargeResonators(rings, charged, natural, cols, board); // newer games need the board (separate combinations)
      const resolved = wave(board, ice, level, {
        enabled: boosts, activate: activation && cascade === 1 ? m.a : null, preferred: cascade === 1 ? [m.b, m.a] : [], random,
        refillRandom: collected => goalRefillRandom(level, goals, collectGoals(goals, counts, board, collected), board, ice, collected, history, random),
      });
      counts = collectGoals(goals, counts, board, resolved.collected);
      board = resolved.board; ice = resolved.ice;
      hit = iceMatches(board, cols, ice);
    }
    if (awardCascadePulse) board = awardCascadePulse(board, ice, { cascades: cascadeMatches, enabled: boosts && !done(), preferred: lastCascade }).board;
    if (done()) return move;
  }
  return Infinity;
}

const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
const results = [];
const t0 = Date.now();
for (const { repair, group, number } of levels) {
  if (ONLY && !ONLY.has(number)) continue;
  const budget = moveBudget(repair);
  const cap = Math.ceil(budget * 1.8) + 10; // play on past the limit to see how many moves would really be needed
  const row = { number, id: repair.id, name: repair.name, group, budget, hard: /HARD/i.test(repair.name || '') };
  for (const style of ['skilled', 'casual']) {
    const needed = [];
    for (let s = 0; s < SAMPLES; s++) needed.push(play(repair, rng(1701 + s * 7919 + number), style, cap));
    if (COMPARE) { // same games (same random seeds) without moving charges
      let wins = 0;
      for (let s = 0; s < SAMPLES; s++) if (play(repair, rng(1701 + s * 7919 + number), style, budget, false) <= budget) wins++;
      (row.noChargeSwap ??= {})[style] = wins / SAMPLES;
    }
    needed.sort((a, b) => a - b);
    const finite = needed.filter(Number.isFinite);
    row[style] = {
      win: needed.filter(n => n <= budget).length / SAMPLES,
      p25: q(needed, 0.25), p50: q(needed, 0.5), p75: q(needed, 0.75), p90: q(needed, 0.9),
      stuck: (SAMPLES - finite.length) / SAMPLES,
      target: q(needed, TARGET),
      // the blind-playtest rule = the stars a player gets: ★★★ easy, ★★ fair, ★ or a loss hard
      rating: {
        easy: needed.filter(n => n <= budget && starsFor(budget, n) === 3).length / SAMPLES,
        fair: needed.filter(n => n <= budget && starsFor(budget, n) === 2).length / SAMPLES,
        hard: needed.filter(n => !(n <= budget) || starsFor(budget, n) === 1).length / SAMPLES,
      },
    };
  }
  const want = row.casual.target; // moves that TARGET share of casual players need
  row.suggested = Number.isFinite(want) ? want : null;
  row.delta = row.suggested == null ? null : row.suggested - budget;
  results.push(row);
  process.stdout.write(`\r${number}/${levels.length}  ${Math.round((Date.now() - t0) / 1000)} s   `);
}
process.stdout.write('\n');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'balance.json'), JSON.stringify({ samples: SAMPLES, target: TARGET, chargeSwap: CHARGE_SWAP, compare: COMPARE, at: new Date().toISOString(), levels: results }, null, 1));
fs.writeFileSync(path.join(OUT, 'balance.csv'), ['level;name;group;budget;skilled_win;casual_win;casual_p50;casual_p75;casual_p90;suggested_budget;change;casual_win_without_charge_moves;casual_easy;casual_fair;casual_hard']
  .concat(results.map(r => [r.number, `"${r.name}"`, `"${r.group}"`, r.budget, Math.round(r.skilled.win * 100), Math.round(r.casual.win * 100), r.casual.p50, r.casual.p75, r.casual.p90, r.suggested ?? '', r.delta ?? '', r.noChargeSwap ? Math.round(r.noChargeSwap.casual * 100) : '', Math.round(r.casual.rating.easy * 100), Math.round(r.casual.rating.fair * 100), Math.round(r.casual.rating.hard * 100)].join(';'))).join('\n'));
console.log(`přesun nábojů: ${CHARGE_SWAP ? 'ano' : 'ne (hra ho nemá nebo CHARGE_SWAP=0)'}${COMPARE ? ', porovnání bez přesunu: ano' : ''}`);
console.log(`hotovo: ${results.length} levelů, ${SAMPLES} her na level a hráče, ${Math.round((Date.now() - t0) / 1000)} s`);
