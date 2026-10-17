// "Opičák": a restless, impatient player. Every scenario starts on a fresh board and then
// does something a real player does by accident. Afterwards the bot checks the game is
// still healthy: the board is complete, the move counter makes sense, no error panel,
// no JavaScript errors, nothing stuck.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, checkpoint, dismissTutorial, waitIdle } from '../lib/player.js';
import { readState, chooseMove, auditScreen } from '../lib/page-probe.js';

const LANG = process.env.LANGS?.split(',')[0] || 'en';
const results = [];

async function startBoard(page, testInfo, diary, baseURL) {
  await enterGame(page, testInfo, diary, baseURL);
  if (!(await openNextLevel(page))) throw new Error('nepodařilo se otevřít level');
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(readState);
    if (s.tutorial) { await dismissTutorial(page); await page.waitForTimeout(200); continue; }
    if (s.tiles.length && !s.busy) return s;
    await page.waitForTimeout(250);
  }
  throw new Error('deska se nenačetla');
}

async function cellCenter(page, i) {
  const b = await page.locator(`button[data-cell="${i}"]`).boundingBox();
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function doMove(page, s) {
  const m = chooseMove(s);
  if (!m) return false;
  await page.locator(`button[data-cell="${m.a}"]`).click({ timeout: 3000 });
  if (m.kind !== 'booster') await page.locator(`button[data-cell="${m.b}"]`).click({ timeout: 3000 });
  return true;
}

/** Waits until the board settles and checks everything that must always hold. */
async function health(page, base, diary, { maxMovesUsed = Infinity } = {}) {
  const problems = [];
  const t0 = Date.now();
  let s;
  do { s = await page.evaluate(readState); if (!s.busy) break; await page.waitForTimeout(300); } while (Date.now() - t0 < 75000);
  if (s.busy) problems.push('deska zůstala zaneprázdněná déle než 75 s (zaseknutá animace)');
  // close help pop-ups (e.g. "Pulse charge" tutorial after creating a charge) – they cover the board on purpose
  for (let k = 0; k < 5 && (await page.evaluate(readState)).tutorial; k++) { await dismissTutorial(page); await page.waitForTimeout(300); }
  s = await page.evaluate(readState);
  if (s.fault) problems.push('hra ukázala „Board recovery needed“ (pokus se rozbil)');
  if (s.inLevel && !s.won && !s.outOfMoves && !s.fault) {
    const cells = s.tiles.filter(Boolean).length, baseCells = base.tiles.filter(Boolean).length;
    if (cells !== baseCells) problems.push(`deska má ${cells} polí místo ${baseCells}`);
    const broken = s.tiles.filter(t => t && t.type == null).length;
    if (broken) problems.push(`${broken} polí bez dílku`);
    if (!chooseMove(s) && !s.busy) problems.push('na desce není žádný tah a hra ji nepřemíchala');
  }
  if (s.movesLeft != null && base.movesLeft != null) {
    if (s.movesLeft > base.movesLeft) problems.push(`tahů přibylo (${base.movesLeft} → ${s.movesLeft}) bez reklamy`);
    if (base.movesLeft - s.movesLeft > maxMovesUsed) problems.push(`ubylo ${base.movesLeft - s.movesLeft} tahů, ale zahrány byly jen ${maxMovesUsed}`);
  }
  s.goals.forEach((g, i) => { const b = base.goals[i]; if (b && g.value < b.value) problems.push(`cíl „${g.text}“ klesl (${b.value} → ${g.value})`); });
  if (diary.pageErrors.length) problems.push('JavaScript chyba: ' + diary.pageErrors.join(' | '));
  const layout = (await page.evaluate(auditScreen)).filter(i => i.severity === 'error');
  layout.forEach(i => problems.push(`vzhled: ${i.kind} – ${i.el} ${i.detail || ''}`));
  return problems;
}

const scenarios = {
  'Rychlé ťukání během animace': async (page, s0) => {
    await doMove(page, s0);
    await page.evaluate(() => { const cells = [...document.querySelectorAll('button[data-cell]')]; for (let k = 0; k < 40; k++) cells[Math.floor(Math.random() * cells.length)]?.click(); });
    return { maxMovesUsed: 21 }; // taps can legitimately form further swaps; only nonsense is checked
  },
  'Dvojklik na dílek a na nabitý dílek': async (page, s0) => {
    const i = s0.tiles.findIndex(t => t && !t.frozen);
    await page.locator(`button[data-cell="${i}"]`).dblclick({ timeout: 3000 });
    await doMove(page, await page.evaluate(readState));
    await page.waitForTimeout(100);
    const s = await page.evaluate(readState);
    const charge = s.tiles.findIndex(t => t?.booster);
    if (charge >= 0) await page.locator(`button[data-cell="${charge}"]`).dblclick({ timeout: 3000, force: true }).catch(() => {});
    return {};
  },
  'Tahy prstem (swipe)': async (page, s0) => {
    let done = 0; const ignored = [];
    for (let k = 0; k < 8; k++) {
      await waitIdle(page);
      let s = await page.evaluate(readState);
      for (let t = 0; t < 4 && s.tutorial; t++) { await dismissTutorial(page); await page.waitForTimeout(300); s = await page.evaluate(readState); }
      if (s.won || s.outOfMoves || s.busy) break;
      const m = chooseMove(s);
      if (!m || m.kind === 'booster') continue;
      const a = await cellCenter(page, m.a), b = await cellCenter(page, m.b);
      if (!a || !b) continue;
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(250); await waitIdle(page);
      const after = await page.evaluate(readState);
      if (after.tutorial) { done++; continue; }               // a help pop-up after the move – the move itself counted
      if (after.movesLeft === s.movesLeft - 1) done++; else ignored.push(`${m.a}→${m.b}`);
    }
    // swipes that must do nothing: too short, or off the board
    await waitIdle(page);
    const before = await page.evaluate(readState);
    const c = await cellCenter(page, 0);
    if (c) for (const [dx, dy] of [[5, 0], [-300, 0], [0, -300]]) { await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400); }
    await waitIdle(page);
    const after = await page.evaluate(readState);
    const extra = [];
    if (ignored.length) extra.push(`platný tah prstem se nezapočítal (${ignored.length}×: ${ignored.join(', ')})`);
    if (after.movesLeft != null && before.movesLeft != null && after.movesLeft < before.movesLeft) extra.push('neplatný tah prstem (příliš krátký nebo mimo desku) ubral tah');
    return { maxMovesUsed: done + 1, extra };
  },
  'Otočení telefonu uprostřed tahu': async (page, s0) => {
    const v = page.viewportSize();
    await doMove(page, s0);
    await page.setViewportSize({ width: v.height, height: v.width });
    await page.waitForTimeout(800);
    await page.setViewportSize(v);
    return { maxMovesUsed: 1 };
  },
  'Přepnutí do jiné aplikace a návrat': async (page, s0) => {
    await doMove(page, s0);
    const flip = hidden => page.evaluate(h => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(h ? 'blur' : 'focus')); }, hidden);
    await flip(true); await page.waitForTimeout(5000); await flip(false);
    return { maxMovesUsed: 1 };
  },
  'Klávesa Escape / systémové Zpět během animace': async (page, s0) => {
    // Escape = the same "close" request Android's back gesture sends to an open dialog.
    const st = () => page.evaluate(() => ({ open: !!document.querySelector('dialog.mini-dialog[open]'), quit: !!document.querySelector('.quit-panel'), energy: document.querySelector('.energy-heading b')?.textContent }));
    const e0 = (await st()).energy;
    await doMove(page, s0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const after1 = await st();
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const after2 = await st();
    const extra = [];
    if (!after2.open) extra.push(`dvojí Escape / Zpět zavřelo level bez potvrzení (po 1.: ${after1.quit ? 'dotaz na odchod' : 'nic'}, po 2.: level zavřený, energie ${e0} → ${after2.energy})`);
    else await page.getByRole('button', { name: /Keep playing|Hrát dál/i }).click({ timeout: 2000 }).catch(() => {});
    return { maxMovesUsed: 1, extra, skipBoard: !after2.open };
  },
  'Pomůcky: zapnout, zrušit, ťukat': async (page) => {
    for (let k = 0; k < 3; k++) {
      await page.locator('.helper-tile').nth(k % 5).click({ timeout: 2000 }).catch(() => {});
      const s = await page.evaluate(readState);
      if (s.tutorial) await dismissTutorial(page);
      await page.getByRole('button', { name: /^Cancel$|^Zrušit$/ }).click({ timeout: 1500 }).catch(() => {});
    }
    return { maxMovesUsed: 0 };
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  test(`opičák · ${name}`, async ({ page, baseURL }, testInfo) => {
    const diary = await prepare(page, { language: LANG });
    diary.language = `${LANG}-${slug(name)}`; // own screenshot folder per scenario
    const s0 = await startBoard(page, testInfo, diary, baseURL);
    const opts = await run(page, s0);
    const problems = opts.skipBoard ? [] : await health(page, s0, diary, opts);
    problems.push(...(opts.extra || []));
    await checkpoint(page, testInfo, diary, 'po-scenari').catch(() => {});
    record(testInfo, name, problems, diary);
    expect.soft(problems, name).toEqual([]);
  });
}

// Reload in the middle of a level: is progress kept, and does it cost energy like leaving does?
test('opičák · Obnovení stránky uprostřed levelu', async ({ page, baseURL }, testInfo) => {
  const diary = await prepare(page, { language: LANG });
  diary.language = `${LANG}-obnoveni`;
  const s0 = await startBoard(page, testInfo, diary, baseURL);
  const energy = () => page.evaluate(() => Number(document.querySelector('.energy-heading b')?.textContent?.split('/')[0]));
  const e0 = await energy();
  await doMove(page, s0); await waitIdle(page);
  await page.reload();
  await page.locator('.welcome-play').first().waitFor({ timeout: 30000 });
  await page.locator('.welcome-play').first().click();
  await page.locator('.intro-skip').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const e1 = await energy().catch(() => null);
  const problems = [], notes = [];
  if (diary.pageErrors.length) problems.push('JavaScript chyba: ' + diary.pageErrors.join(' | '));
  if (e0 != null && e1 != null && e1 === e0) notes.push(`obnovení stránky po tahu nestojí energii (${e0} → ${e1}), zatímco odchod z levelu ji stojí. Hráč tak může prohrávající pokus zadarmo restartovat.`);
  await checkpoint(page, testInfo, diary, 'po-obnoveni').catch(() => {});
  record(testInfo, 'Obnovení stránky uprostřed levelu', problems, diary, notes);
  expect.soft(problems).toEqual([]);
});

function record(testInfo, name, problems, diary, notes = []) {
  const dir = path.join('reports', 'chaos');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${testInfo.project.name.normalize('NFD').replace(/[^\w]+/g, '-')}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ device: testInfo.project.name, scenario: name, problems, notes, screens: diary.screens.map(s => s.file) }) + '\n');
}

const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').toLowerCase().slice(0, 30);
