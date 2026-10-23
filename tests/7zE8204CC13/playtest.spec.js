// Blind playtest bot: goes through the game's own playtest page (playtest.html), plays every test
// as fast as it can (fewest moves, charges, one tool of each kind) and rates it by the stars the game
// would award (starRating.js: 30 % of the limit left = 3 stars, 15 % = 2 stars):
//   ★★★ → Lehké · ★★ → Akorát · ★ or not finished → Těžké
// The page writes each rating to the database itself; every bot rating carries the note "BOT …"
// so it can be told apart from human ratings in /balance.
//
// Env: LEVELS (how many tests, default all = 200), PLAYTEST_SEND (1 = let the page send results,
//      default 0 = block the database, e.g. for local trial runs), PLAYTEST_RUN (run id in the URL)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, dismissTutorial, waitIdle } from '../lib/player.js';
import { readState, chooseMove, chooseHelperTarget } from '../lib/page-probe.js';

const LIMIT = process.env.LEVELS && process.env.LEVELS !== 'all' ? Number(process.env.LEVELS) : Infinity;
const SEND = process.env.PLAYTEST_SEND === '1';
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Stars exactly as the game awards them (starRating.js earnedStars), 0 = not finished. */
export function stars(outcome, budget, moves) {
  if (outcome !== 'won') return 0;
  const left = Math.max(0, budget - moves);
  return left >= Math.ceil(budget * 0.30) ? 3 : left >= Math.ceil(budget * 0.15) ? 2 : 1;
}
/** The rule agreed for bot ratings: 3 stars = easy, 2 = fair, 1 or a loss = hard. */
export const rate = st => (st === 3 ? 'easy' : st === 2 ? 'fair' : 'hard');
const LABEL = { easy: 'Lehké', fair: 'Akorát', hard: 'Těžké' };
const OUTCOME = { won: 'výhra', exhausted: 'došly tahy', quit: 'přerušeno', fault: 'technická chyba', failed: 'prohra' };

test('slepý playtest · bot', async ({ page, baseURL }, testInfo) => {
  test.setTimeout(330 * 60 * 1000);
  const device = testInfo.project.name;
  const run = process.env.PLAYTEST_RUN || `bot-${slug(device)}-${new Date().toISOString().slice(0, 10)}`;
  const key = `beyond-signal-blind-test-v1:${run}`;
  const diary = await prepare(page, { language: 'cs', allowNetwork: SEND });
  const dir = path.join('reports', 'playtest');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${slug(device)}.jsonl`);
  fs.writeFileSync(out, '');

  const url = new URL('playtest.html', baseURL); url.search = `run=${run}`;
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Povolit sběr a zahájit test|Pokračovat v testu/ }).click({ timeout: 30000 });
  const session = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);
  const s0 = await session();
  const catalog = Object.fromEntries((s0?.repairs || []).map(r => [r.id, r]));
  const numberOf = Object.fromEntries((s0?.repairs || []).map((r, i) => [r.id, i + 1])); // position in the game (repairs are stored in game order)

  let played = 0;
  while (played < LIMIT) {
    const before = await session();
    if (!before || before.cursor >= before.order.length) break;
    const id = before.order[before.cursor];
    let faults = 0, row = null;
    for (;;) { // one test (repeated once after a technical fault)
      const used = new Set(); let idle = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 6 * 60 * 1000) {
        if (await page.locator('#rating-heading').isVisible().catch(() => false)) break;
        const s = await page.evaluate(readState);
        if (s.tutorial) { await dismissTutorial(page); continue; }
        if (s.won) { await page.locator('.win-panel button.primary').first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); continue; }
        if (s.busy || !s.tiles.length) { if (++idle > 120) break; await page.waitForTimeout(250); continue; }
        // one tool of each kind per attempt: spend them in the last 3 moves (EMP, Beam, Laser)
        if (s.movesLeft != null && s.movesLeft <= 3) {
          const h = [4, 3, 0].find(i => !used.has(i) && s.helpers[i]?.stock && !s.helpers[i].disabled);
          if (h != null) {
            used.add(h);
            await page.locator('.helper-tile').nth(h).click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(150);
            if ((await page.evaluate(readState)).tutorial) { await dismissTutorial(page); await page.locator('.helper-tile').nth(h).click({ timeout: 3000 }).catch(() => {}); }
            const target = chooseHelperTarget(s, h);
            await page.locator(`button[data-cell="${target}"]`).click({ timeout: 3000, force: true }).catch(() => {});
            await waitIdle(page);
            continue;
          }
        }
        const m = chooseMove(s);
        if (!m) { if (++idle > 120) break; await page.waitForTimeout(250); continue; }
        idle = 0;
        await page.locator(`button[data-cell="${m.a}"]`).click({ timeout: 3000 }).catch(() => {});
        if (m.kind !== 'booster') await page.locator(`button[data-cell="${m.b}"]`).click({ timeout: 3000 }).catch(() => {});
        await waitIdle(page);
      }
      if (!(await page.locator('#rating-heading').isVisible().catch(() => false))) {
        // stuck: leave the level through the normal quit dialog so the test can be rated
        const st = await page.evaluate(readState).catch(() => null);
        await page.screenshot({ path: path.join(dir, `zaseknuto-${slug(device)}-${before.cursor + 1}.png`) }).catch(() => {});
        diary.notes.push(`test ${before.cursor + 1} (${id}): bot se zasekl – ${JSON.stringify({ busy: st?.busy, tiles: st?.tiles.length, moves: st?.movesLeft, message: st?.message, tutorial: st?.tutorial, won: st?.won, inLevel: st?.inLevel })}`);
        await page.locator('.mini-header .close').click({ timeout: 3000 }).catch(() => {});
        await page.locator('.quit-panel .primary').click({ timeout: 3000 }).catch(() => {});
        await page.locator('#rating-heading').waitFor({ timeout: 15000 }).catch(() => {});
      }
      const now = await session();
      row = now?.attempts.find(r => r.attemptId === now.rating) || null;
      if (row?.outcome === 'fault' && ++faults === 1) {
        // a technical fault says nothing about difficulty: rate it as hard with a note and play it again
        await page.getByRole('button', { name: 'Těžké', exact: true }).click().catch(() => {});
        await page.getByLabel('Poznámka (nepovinná)').fill('BOT · technická chyba, opakuji – nehodnotit').catch(() => {});
        await page.getByRole('button', { name: 'Uložit a zkusit stejný test znovu' }).click().catch(() => {});
        continue;
      }
      break;
    }
    if (!row) { diary.notes.push(`test ${before.cursor + 1}: výsledek nenalezen`); break; }
    const remaining = row.outcome === 'won' ? Math.max(0, row.budget - row.moves) : 0;
    const budget0 = row.baseBudget ?? row.budget; // stars count from the original limit
    const starCount = stars(row.outcome, budget0, row.moves);
    const rating = rate(starCount);
    const pt = row.configuration?.playtest || {};
    const note = `BOT · ${device} · ${OUTCOME[row.outcome] || row.outcome} · ${row.moves}/${row.budget} tahů, zbylo ${remaining} · ${starCount ? '★'.repeat(starCount) : 'bez hvězd'}`;
    await page.getByRole('button', { name: LABEL[rating], exact: true }).click({ timeout: 5000 });
    await page.getByLabel('Poznámka (nepovinná)').fill(note);
    await page.getByRole('button', { name: 'Uložit hodnocení a další test' }).click();
    played++;
    const rec = {
      device, run, session: before.session, index: before.cursor + 1, id, number: numberOf[id] ?? null, name: catalog[id]?.name || id,
      outcome: row.outcome, moves: row.moves, budget: row.budget, remaining, stars: starCount, rating,
      helpers: row.helpers || [], hints: row.hints || 0, chargesCreated: pt.chargesCreated || 0, chargeActivations: pt.chargeActivations || 0, chargeSwaps: pt.chargeSwaps || 0,
      durationMs: row.durationMs, faults,
    };
    fs.appendFileSync(out, JSON.stringify(rec) + '\n');
    await page.waitForTimeout(500);
  }

  // let the page send the queued ratings (it retries every 15 s)
  if (SEND) {
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) { const s = await session(); if (!s?.pending.length) break; await page.waitForTimeout(3000); }
  }
  const end = await session();
  fs.writeFileSync(path.join(dir, `${slug(device)}-run.json`), JSON.stringify({ device, run, session: end?.session, rated: end?.cursor, total: end?.order.length, pending: end?.pending.length ?? null, sent: SEND, jsErrors: diary.pageErrors, notes: diary.notes }, null, 1));
  expect.soft(diary.pageErrors, 'chyby JavaScriptu').toEqual([]);
  if (SEND) expect.soft(end?.pending.length, 'neodeslaná hodnocení').toBe(0);
});
