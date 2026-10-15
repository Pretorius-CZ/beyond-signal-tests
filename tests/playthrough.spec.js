import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prepare, enterGame, openNextLevel, playLevel, collectWin, checkpoint, saveState } from '../lib/player.js';

const LEVELS = process.env.LEVELS === 'all' ? 999 : Number(process.env.LEVELS || 3);
const MODE = LEVELS >= 999 ? 'full' : 'smoke';
const LANGS = (process.env.LANGS || 'en').split(',');
const POLICY = {
  ads: process.env.USE_ADS !== '0',
  helpers: process.env.USE_HELPERS !== '0',
  retries: Number(process.env.RETRIES ?? (LEVELS >= 999 ? 3 : 0)), // repeated attempts after a loss
};

// BOT_SEED set → analytics stay on and every bot reports under a fixed identity
// (one per device + language + mode), so it can be marked as a tester in balance.html.
function botIdentity(project, language) {
  if (!process.env.BOT_SEED) return null;
  const uuid = salt => { const h = crypto.createHash('sha256').update(`${process.env.BOT_SEED}|${project}|${language}|${MODE}|${salt}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  return { id: uuid('id'), token: uuid('token') };
}

for (const language of LANGS) {
  test(`průchod hrou · ${language}`, async ({ page, baseURL }, testInfo) => {
    const identity = botIdentity(testInfo.project.name, language);
    const startState = process.env.START_STATE ? JSON.parse(fs.readFileSync(process.env.START_STATE, 'utf8')) : null;
    const diary = await prepare(page, { language, identity, startState });
    const run = { project: testInfo.project.name, language, mode: MODE, botId: identity?.id || null, analytics: !!identity, viewport: page.viewportSize(), startedAt: new Date().toISOString(), levels: [] };
    const entry = await enterGame(page, testInfo, diary, baseURL);
    Object.assign(run, entry);

    // Any unexpected error (browser crash, element that cannot be clicked…) is recorded with a
    // screenshot and the results gathered so far are still saved – the run never vanishes silently.
    try {
      for (let n = 0; n < LEVELS; n++) {
        const route = [];
        if (!(await openNextLevel(page, route))) {
          // EXPECTED_LEVELS (e.g. 167): if the bot has won them all, this is the end of the game, not a stuck bot.
          const wins = run.levels.filter(l => l.result === 'výhra').length;
          const done = process.env.EXPECTED_LEVELS && !startState && wins >= Number(process.env.EXPECTED_LEVELS);
          await checkpoint(page, testInfo, diary, done ? 'konec-hry' : 'nenalezen-level');
          run.levels.push({ title: '—', result: done ? 'konec hry' : 'nenalezen další level', route });
          break;
        }
        const level = await playLevel(page, testInfo, diary, POLICY);
        level.route = route;
        run.levels.push(level);
        saveRun(run, testInfo); // keep partial results of long runs
        if (level.result !== 'výhra') break;
        await collectWin(page);
        // Save points: latest state + every 10 levels (lets you start a later run mid-game).
        const stateBase = `reports/state/${slug(testInfo.project.name)}-${language}`;
        await saveState(page, `${stateBase}-latest.json`);
        if ((n + 1) % 10 === 0) await saveState(page, `${stateBase}-after-${n + 1}.json`);
      }
    } catch (e) {
      const message = String(e?.message || e).split('\n')[0].slice(0, 300);
      run.levels.push({ title: run.levels.at(-1)?.result === 'výhra' ? '(další level)' : '—', result: 'chyba bota / prohlížeče', error: message });
      diary.notes.push('přerušeno: ' + message);
      await checkpoint(page, testInfo, diary, 'preruseno').catch(() => {});
    }
    await checkpoint(page, testInfo, diary, 'konec').catch(() => {});

    run.notes = diary.notes; run.console = diary.console; run.pageErrors = diary.pageErrors; run.failedRequests = [...new Set(diary.failedRequests)];
    run.issues = dedupe(diary.issues); run.screens = diary.screens.map(s => ({ label: s.label, file: path.relative(process.cwd(), s.file), issues: s.issues }));
    saveRun(run, testInfo);
    await testInfo.attach('vysledek.json', { body: JSON.stringify(run, null, 2), contentType: 'application/json' });

    // Soft checks: the test is marked failed, but the whole run is still recorded.
    expect.soft(diary.pageErrors, 'JavaScript chyby na stránce').toEqual([]);
    expect.soft(run.issues.filter(i => i.severity === 'error'), 'vizuální / textové chyby').toEqual([]);
    expect.soft(run.levels.filter(l => /chyba|zaseknuto|zavřel|nenalezen|přerušeno/.test(l.result)), 'místa, kde se bot nebo hra zasekli').toEqual([]);
  });
}

function saveRun(run, testInfo) {
  const dir = path.join(process.cwd(), 'reports', 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug(testInfo.project.name)}-${run.language}.json`), JSON.stringify(run, null, 2));
}

function dedupe(list) {
  const seen = new Map();
  for (const i of list) { const k = `${i.kind}|${i.el}`; if (seen.has(k)) seen.get(k).count++; else seen.set(k, { ...i, count: 1 }); }
  return [...seen.values()];
}
const slug = s => s.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();
