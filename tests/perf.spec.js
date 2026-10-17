// Performance and memory (Chromium – it exposes the measurements through DevTools).
//  · loading: normal connection vs. a slow phone (CPU 4× slower, "fast 3G")
//  · smoothness: frames per second while pieces fall and charges explode (animations ON)
//  · freezes: tasks that block the game for more than 50 ms
//  · memory: does the game use more and more memory the longer you play (a leak)?
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { prepare, enterGame, openNextLevel, playLevel, collectWin } from '../lib/player.js';

const LEVELS = Number(process.env.LEVELS || 10);
test.use({ reducedMotion: 'no-preference' }); // real animations, like a player sees them
// Note: CI machines have no graphics card, so FPS there is only a relative indicator (compare runs, not absolute numbers).
test.skip(({ browserName }) => browserName !== 'chromium', 'měření výkonu umí jen Chromium');

const save = (name, data) => {
  const dir = path.join('reports', 'perf');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));
};
const slugOf = s => s.normalize('NFD').replace(/[^\w]+/g, '-');

async function throttle(page, { cpu = 1, network = null } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (network) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...network }); }
  return cdp;
}

for (const [label, cpu, network] of [
  ['bežné připojení', 1, null],
  ['slabý telefon + pomalý internet', 4, { latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }],
]) {
  test(`výkon · načtení · ${label}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(180000);
    await prepare(page, { language: 'en' });
    await throttle(page, { cpu, network });
    await page.addInitScript(() => { window.__lcp = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
    const t0 = Date.now();
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.locator('.welcome-play').first().waitFor({ timeout: 150000 });
    const playVisible = Date.now() - t0;
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {}); // let the title screen finish downloading
    const m = await page.evaluate(() => ({
      lcp: Math.round(window.__lcp),
      bytes: performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0),
      requests: performance.getEntriesByType('resource').length,
      biggest: performance.getEntriesByType('resource').sort((a, b) => (b.transferSize || b.encodedBodySize) - (a.transferSize || a.encodedBodySize)).slice(0, 5).map(r => ({ url: r.name.split('?')[0].split('/').slice(-2).join('/'), kb: Math.round((r.transferSize || r.encodedBodySize) / 1024) })),
    }));
    save(`nacteni-${slugOf(testInfo.project.name)}-${cpu}x`, { device: testInfo.project.name, label, playVisibleMs: playVisible, lcpMs: m.lcp, mb: +(m.bytes / 1048576).toFixed(2), requests: m.requests, biggest: m.biggest });
  });
}

for (const [label, cpu] of [['běžný telefon', 1], ['slabý telefon (CPU 4× pomalejší)', 4]]) {
  test(`výkon · hraní · ${label}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(LEVELS * 120000 + 120000);
    const diary = await prepare(page, { language: 'en' });
    const cdp = await throttle(page, { cpu });
    await cdp.send('Performance.enable');
    // frame & long-task recorder
    await page.addInitScript(() => {
      window.__frames = []; window.__long = [];
      const tick = t => { window.__frames.push(t); if (window.__frames.length > 20000) window.__frames.splice(0, 10000); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    await enterGame(page, testInfo, diary, baseURL);
    const samples = [];
    const metrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      await page.waitForTimeout(300);
      const { metrics } = await cdp.send('Performance.getMetrics');
      const get = n => metrics.find(x => x.name === n)?.value ?? null;
      return { heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1), nodes: get('Nodes'), listeners: get('JSEventListeners') };
    };
    samples.push({ level: 0, ...(await metrics()) });
    const fps = [];
    for (let n = 0; n < LEVELS; n++) {
      if (!(await openNextLevel(page))) break;
      await page.evaluate(() => { window.__frames.length = 0; });
      const level = await playLevel(page, testInfo, diary, { ads: true, helpers: true, retries: 1 });
      // frames per second over 1-second windows while the level was being played
      const frames = await page.evaluate(() => window.__frames.slice());
      for (let i = 0, j = 0; i < frames.length; i++) {
        while (frames[i] - frames[j] > 1000) j++;
        if (frames[i] - frames[0] >= 1000 && i % 15 === 0) fps.push(i - j);
      }
      await collectWin(page);
      samples.push({ level: n + 1, title: level.title, result: level.result, ...(await metrics()) });
      if (level.result !== 'výhra') break;
    }
    const long = await page.evaluate(() => window.__long.slice());
    fps.sort((a, b) => a - b);
    const pick = p => fps.length ? fps[Math.floor(p * (fps.length - 1))] : null;
    // memory trend: slope of heap after GC across levels (MB per level), ignoring the first level warm-up
    const pts = samples.filter(s => s.level >= 2);
    let slope = 0;
    if (pts.length >= 3) {
      const mx = pts.reduce((a, s) => a + s.level, 0) / pts.length, my = pts.reduce((a, s) => a + s.heapMB, 0) / pts.length;
      slope = pts.reduce((a, s) => a + (s.level - mx) * (s.heapMB - my), 0) / pts.reduce((a, s) => a + (s.level - mx) ** 2, 0);
    }
    const result = {
      device: testInfo.project.name, label, levels: samples.length - 1,
      fps: { median: pick(0.5), worst10: pick(0.1), min: fps[0] ?? null },
      longTasks: { count: long.length, over200ms: long.filter(x => x > 200).length, max: long.length ? Math.max(...long) : 0 },
      memory: { startMB: samples[1]?.heapMB ?? samples[0].heapMB, endMB: samples.at(-1).heapMB, slopeMBperLevel: +slope.toFixed(2), nodesStart: samples[1]?.nodes, nodesEnd: samples.at(-1).nodes, listenersStart: samples[1]?.listeners, listenersEnd: samples.at(-1).listeners },
      samples, jsErrors: diary.pageErrors,
    };
    save(`hrani-${slugOf(testInfo.project.name)}-${cpu}x`, result);
    expect.soft(result.memory.slopeMBperLevel, 'paměť roste s každým levelem (únik paměti?)').toBeLessThan(1);
  });
}
