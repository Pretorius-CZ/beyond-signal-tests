import fs from 'node:fs';
import { readState, chooseMove, chooseHelperTarget, auditScreen } from './page-probe.js';

// Network calls that would write bot results into the real analytics (Supabase,
// country lookup). They are answered locally so the dashboard stays clean.
export const ANALYTICS = /supabase\.co|api\.country\.is|ipapi|ipinfo/;

/**
 * identity: { id, token } – when given, analytics are NOT blocked and the bot reports under this
 * fixed device identity (so it can be marked as a tester once in balance.html and filtered out).
 */
export async function prepare(page, { language = 'en', identity = null, startState = null, allowNetwork = false } = {}) {
  const diary = { language, identity: identity?.id || null, console: [], pageErrors: [], failedRequests: [], issues: [], screens: [], notes: [] };
  if (!identity && !allowNetwork) await page.route(ANALYTICS, r => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript(({ lang, identity, startState }) => { try { if (!sessionStorage.getItem('bot-init')) {
    localStorage.clear();
    // START_STATE: continue from a saved game (progress, energy, helpers…) instead of a new game.
    if (startState) for (const [k, v] of Object.entries(startState)) localStorage.setItem(k, v);
    localStorage.setItem('to-the-stars-language', lang);
    // First-launch question about gameplay statistics: answered in advance (yes only when the bot
    // reports under a fixed identity), so the dialog does not cover the game.
    localStorage.setItem('beyond-signal-analytics-choice-v1', JSON.stringify({ version: 1, state: identity ? 'granted' : 'denied', at: Date.now() }));
    if (identity) localStorage.setItem('beyond-signal-balance-reporter-v1', JSON.stringify({ id: identity.id, token: identity.token, sequence: Date.now() }));
    sessionStorage.setItem('bot-init', '1'); } } catch {} }, { lang: language, identity, startState });
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) diary.console.push({ type: m.type(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', e => diary.pageErrors.push(String(e.message).slice(0, 300)));
  // ERR_ABORTED = the browser cancelled a request itself (e.g. a tile image replaced mid-load) – harmless.
  page.on('requestfailed', r => { if ((identity || !ANALYTICS.test(r.url())) && !/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(r.failure()?.errorText || '')) diary.failedRequests.push(`${r.failure()?.errorText} ${r.url()}`); });
  page.on('response', r => { if (r.status() >= 400 && (identity || !ANALYTICS.test(r.url()))) diary.failedRequests.push(`HTTP ${r.status()} ${r.url()}`); });
  return diary;
}

const settle = page => page.waitForTimeout(120);
const clickCss = (page, css, timeout = 4000) => page.locator(css).first().click({ timeout });

/** Screenshot + layout audit of the current screen. */
export async function checkpoint(page, testInfo, diary, label, { optional = false } = {}) {
  if (optional && process.env.SHOTS === 'key') return;
  await page.waitForTimeout(400);
  const issues = await page.evaluate(auditScreen);
  for (const i of issues) diary.issues.push({ screen: label, ...i });
  const folder = `reports/shots/${slug(testInfo.project.name)}-${diary.language}`;
  fs.mkdirSync(folder, { recursive: true });
  const file = `${folder}/${String(diary.screens.length).padStart(2, '0')}-${slug(label)}.png`;
  try {
    await page.screenshot({ path: file, timeout: 30000 });
    await testInfo.attach(label, { path: file, contentType: 'image/png' });
    diary.screens.push({ label, file, issues: issues.length });
  } catch (e) { diary.notes.push(`screenshot ${label} se nepodařil: ${e.message.split('\n')[0]}`); }
}

/** From the title screen to the ship. */
export async function enterGame(page, testInfo, diary, baseURL) {
  const t0 = Date.now();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('.welcome-play').first().waitFor({ timeout: 30000 });
  const loadMs = Date.now() - t0;
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0) + (performance.getEntriesByType('navigation')[0]?.transferSize || 0));
  await checkpoint(page, testInfo, diary, 'uvodni-obrazovka');
  await clickCss(page, '.welcome-play');
  await page.locator('.intro-skip').click({ timeout: 8000 }).catch(() => {});
  await page.getByRole('button', { name: /Enter the ship|Vstoupit|Vstup|Schiff betreten|Entrer dans le vaisseau|Entrar en la nave/i }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  await checkpoint(page, testInfo, diary, 'lod');
  return { loadMs, bytes };
}

/** Opens the next unfinished repair. Returns false when nothing new can be opened. */
export async function openNextLevel(page, route = []) {
  // Walk through the ship like a player: open the first unfinished repair; if there is none,
  // use whatever leads on (door, hatch, console, next chapter…), skip story screens,
  // until a level with a "Play" button appears.
  const tried = new Set();
  for (let k = 0; k < 60; k++) {
    if (await page.locator('dialog.mini-dialog[open]').count()) {
      if (await page.locator('.win-panel:visible').count()) { await collectWin(page); continue; } // stale win screen
      return true;
    }
    // A stray dialog (e.g. the ship log the player's "new entry" banner can open) blocks clicks.
    if (await page.locator('dialog.ship-log[open]').count()) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); continue; }
    const play = page.locator('button.primary:visible').filter({ hasText: /^\s*(Play|Hrát|Spielen|Jouer|Jugar)/i }).first();
    if (await play.count()) {
      await play.click({ timeout: 5000 });
      await page.locator('dialog.mini-dialog[open]').waitFor({ timeout: 10000 });
      return true;
    }
    if (await skipStory(page)) { route.push('příběh'); continue; }
    let next = null;
    for (let wait = 0; wait < 8; wait++) { // scene transitions take a moment
      next = await page.evaluate(pickNavigation, [...tried]);
      if (next && (next.rank < 3 || wait >= 2)) break; // weak option (no hotspot yet): give the scene ~2 s to appear
      await page.waitForTimeout(1000);
    }
    if (!next) {
      // End of a chapter: use the in-game Kapitel menu to walk into the next open chapter.
      if (await openNextChapter(page)) { tried.clear(); continue; }
      return false;
    }
    tried.add(next.key);
    route.push(next.label);
    await page.locator(`[data-bot-nav="${next.key}"]`).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  return false;
}

/**
 * When no repair is reachable, open the chapter list and continue in the first chapter that is
 * open and not finished yet. This is normal in-game navigation, not a shortcut.
 */
async function openNextChapter(page) {
  const control = page.locator('.chapters-control').first();
  if (!(await control.count()) || await control.isDisabled().catch(() => false)) return false;
  await control.click({ timeout: 4000 }).catch(() => {});
  const dialog = page.locator('dialog.chapters-dialog[open]').first();
  if (!(await dialog.count())) return false;
  const rows = dialog.locator('details');
  for (let i = 0, n = await rows.count(); i < n; i++) {
    const row = rows.nth(i);
    const summary = (await row.locator('summary').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    const progress = summary.match(/(\d+)\s*\/\s*(\d+)/);
    if (!progress || +progress[1] >= +progress[2]) continue; // finished (29/29)
    if (summary.includes('🔒')) continue;                    // still locked
    await row.locator('summary').click({ timeout: 3000 }).catch(() => {}); // open the chapter row
    const button = row.locator('.chapter-actions button:not([disabled]):visible').first();
    if (!(await button.count())) continue;
    await button.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (!(await dialog.count())) return true;               // navigation closed the chapter list
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

/** Visible controls on the current screen – for the report when the bot gets stuck. */
export async function describeScreen(page) {
  return page.evaluate(() => {
    const shown = el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top < innerHeight && r.bottom > 0; };
    return [...document.querySelectorAll('button, [role="button"], a[href]')]
      .filter(b => shown(b) && !b.disabled)
      .map(b => {
        const label = (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const cls = typeof b.className === 'string' ? b.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
        return label ? `${label}${cls ? ` [${cls}]` : ''}` : cls ? `[${cls}]` : '';
      })
      .filter(Boolean).slice(0, 25).join(' | ');
  }).catch(() => '');
}

/** Runs in the page: marks and returns the most promising way forward. */
function pickNavigation(tried) {
  const chrome = /Settings|Nastavení|Chapters|Kapitoly|ship log|log entry|All entries|View repair|záznam|deník|Music|Hudba|Sound|Zvuk|Account|Účet|Sign in|Přihlá|Mechanics help|Pravidla|Watch intro|Přehrát úvod|Close pilot|Zavřít|Einstellungen|Kapitel|Schiffslogbuch|Logbucheintrag|Alle Einträge|Reparatur ansehen|Musik|Klang|Konto|Anmelden|Regeln|Intro ansehen|Pilotengedanken schließen|Szenensteuerung|Sprache|Schließen|Paramètres|Chapitres|Journal de bord|Entrées|Musique|Son(?![a-zà-ž])|Compte|Se connecter|Aide sur les mécaniques|Règles|Voir l’introduction|Fermer le journal|Commandes de la scène|Langue|Fermer|Effekte|Effets sonores|Nouvelle entrée|Ajustes|Capítulos|Diario de a bordo|Entradas|Música|Sonido|Efectos|Cuenta|Iniciar sesión|Ayuda sobre mecánicas|Reglas|Ver la introducción|Cerrar el diario|Controles de la escena|Idioma|Cerrar/i;
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden'; };
  const buttons = [...document.querySelectorAll('button, a[href^="#"], [role="button"]')]
    .filter(b => visible(b) && !b.disabled && !b.closest('dialog:not([open])') && !b.matches('.completed-hotspot, .brand, [data-cell]'))
    .map(b => ({ b, label: (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), cls: String(b.className) }))
    .filter(x => x.label && !chrome.test(x.label));
  const rank = x => {
    const prog = x.label.match(/(\d+)\s*\/\s*(\d+)/);              // e.g. "Silent Mine 0/6"
    if (prog && +prog[1] >= +prog[2]) return 6;                      // place already finished
    if (prog) return 0.5;                                            // place with work left
    if (/go back|zpět|^back|return to ship|návrat na loď|leave|odejít|opustit|zurück|verlassen|rückkehr|retour|quitter|revenir|volver|atrás|salir|regresar/i.test(x.label)) return 9; // never walk backwards unless nothing else is left
    if (/return|návrat|zurückkehr|retour|volver/i.test(x.label)) return 4;         // e.g. "Return to orbit" from a finished place
    if (/repair-hotspot/.test(x.cls)) return 0;
    if (/hotspot|chart-node|destination|planet|map-node/.test(x.cls)) return 1;
    if (/next|door|hatch|console|gate|launch|transit|depart|jump|chapter|enter|travel|continue|route|dock|tür|luke|konsole|betreten|weiter|schleuse|kombüse|maschinenraum|quartier|entrer|suivant|continuer|niveau|pièce|trappe|sas|cuisine|machinerie|quartiers|explorer|décoller|poursuivre|fortsetzen|histoire|geschichte|entrar|siguiente|continuar|nivel|pieza|trampilla|esclusa|cocina|sala de máquinas|explorar|despegar|historia/i.test(x.cls + ' ' + x.label)) return 2;
    return 3;
  };
  const options = buttons.map(x => ({ ...x, key: (x.cls + '|' + x.label).replace(/[^\w|]+/g, '_').slice(0, 80), rank: rank(x) }))
    .filter(x => !tried.includes(x.key)).sort((a, b) => a.rank - b.rank);
  const best = options[0];
  if (!best) return null;
  document.querySelectorAll('[data-bot-nav]').forEach(e => e.removeAttribute('data-bot-nav'));
  best.b.setAttribute('data-bot-nav', best.key);
  return { key: best.key, label: best.label, rank: best.rank };
}

async function skipStory(page) {
  // Priority matters: a story overlay sits on top of the scene, so "Skip story" / "Next" inside it
  // must win over scene buttons like "Continue the story →" that are covered by the overlay.
  const patterns = [/^\s*(Skip story|Přeskočit příběh|Skip|Přeskočit|Geschichte überspringen|Intro überspringen|Überspringen|Passer l’histoire|Passer l’introduction|Passer le décollage|Passer|Omitir historia|Saltar la introducción|Omitir)/i, /^\s*(Next|Další|Got it|Rozumím|Weiter(?![a-zäöüß])|Verstanden|Alles klar|Suivant|Compris|Siguiente|Entendido)/i, /^\s*(Continue|Pokračovat|Begin|Začít|Fortfahren|Beginnen|Los|Continuer|Commencer|Continuar|Comenzar)/i];
  for (const re of patterns) {
    const buttons = page.locator('button:visible').filter({ hasText: re });
    const n = await buttons.count();
    for (let i = n - 1; i >= 0; i--) {             // last in the DOM = topmost overlay
      const btn = buttons.nth(i);
      try { await btn.click({ timeout: 1500 }); await page.waitForTimeout(700); return true; } catch {}
    }
  }
  return false;
}

export async function dismissTutorial(page) {
  await page.evaluate(() => {
    let el = document.querySelector('.tutorial-close');
    for (let p = el; p; p = p.parentElement) { const b = p.querySelector('button.primary'); if (b) { b.click(); return; } }
    el?.click();
  });
}

// Ad handling: works for the current instant test ad, for a simulated ad with a countdown
// (e.g. 30 s, the close button appears or unlocks later) and for a real ad SDK in test mode.
// The bot waits like a player and clicks whatever closes the ad / claims the reward.
const AD_MAX_WAIT = Number(process.env.AD_MAX_WAIT || 120) * 1000;
const AD_CONTAINER = 'dialog.reward-ad[open], [data-bot="ad"], [data-ad-overlay], .ad-overlay, .reward-ad-overlay';
const AD_BUTTON = /^\s*(start|watch|play|spustit|přehrát|sledovat|claim|close|zavřít|získat|vyzvednout|skip|přeskočit|continue|pokračovat|done|hotovo|ok|×|✕|x|starten|ansehen|weiterspielen|belohnung|abholen|überspringen|fertig|schließen|jetzt|jouer|regarder|continuer|récupérer|réclamer|passer|fermer|terminé|réessayer|obtenir|jugar|ver|continuar|reclamar|recoger|obtener|saltar|terminado|reintentar)(?![a-zà-ž])/i;

export async function watchAd(page, log, stats = null) {
  const t0 = Date.now();
  const clicked = [];
  while (Date.now() - t0 < AD_MAX_WAIT) {
    const open = page.locator(AD_CONTAINER).first();
    if (!(await open.count())) break;                                   // ad gone = finished
    // Preferred: explicit hooks the game can add (data-bot="ad-start" / "ad-close").
    let btn = open.locator('[data-bot="ad-close"]:not([disabled]), [data-bot="ad-start"]:not([disabled])').first();
    if (!(await btn.count())) btn = open.locator('button.primary:not([disabled])').first();
    if (!(await btn.count())) btn = open.locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
      .filter({ hasText: AD_BUTTON }).first();
    // Never press "cancel without reward" – that would skip the reward the player wants.
    if (await btn.count() && !/cancel|zrušit|bez odměny|without reward|abbrechen|ohne belohnung|ohne prämie|annuler|sans récompense|cancelar|sin recompensa/i.test(await btn.innerText().catch(() => ''))) {
      clicked.push((await btn.innerText().catch(() => '?')).trim().slice(0, 30));
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    await page.waitForTimeout(500);                                     // countdown running – wait like a player
  }
  const ms = Date.now() - t0;
  if (await page.locator(AD_CONTAINER).count()) log.push(`reklama se nezavřela ani po ${Math.round(ms / 1000)} s (kliknuto: ${clicked.join(' → ') || 'nic'})`);
  if (stats) { stats.adSeconds = (stats.adSeconds || 0) + Math.round(ms / 1000); stats.adClicks = clicked; }
  return ms;
}

/**
 * Plays one level from the board until it is won or lost.
 * policy: { ads: bool (watch ad for +5 moves), helpers: bool (use tools in the last moves) }
 */
export async function playLevel(page, testInfo, diary, policy) {
  const r = { title: null, budget: null, result: 'neznámý', movesUsed: 0, adsWatched: 0, helpersUsed: [], boostersFired: 0, chargeMoves: 0, tutorials: 0, stalls: 0, durationMs: 0, attempts: 1, energyAds: 0, failedAttempts: [], notes: [] };
  const t0 = Date.now();
  const maxAttempts = policy.retries + 1;
  let shot = false, idle = 0, reopen = 0;
  for (let step = 0; step < 400 * maxAttempts; step++) {
    const s = await page.evaluate(readState);
    if (r.title == null && s.title) r.title = s.title;
    if (s.rewardAd) { await watchAd(page, r.notes, r); if (!r.pendingAd) r.adsWatched++; r.pendingAd = null; continue; } // adsWatched = ads for +5 moves only
    if (s.tutorial) { r.tutorials++; await dismissTutorial(page); await settle(page); continue; }
    if (s.fault) { r.result = 'chyba hry (Board recovery)'; await checkpoint(page, testInfo, diary, 'chyba-desky'); break; }
    if (s.noLives) {
      // Energy is gone: watch the test ad for +1 charge, then start the level again.
      if (r.energyAds >= maxAttempts) { r.result = 'došla energie'; break; }
      const adBtn = page.locator('dialog.mini-dialog[open] .out-of-moves:not([role]) button:not([disabled])').first();
      if (await adBtn.count()) { r.energyAds++; r.pendingAd = 'energy'; await adBtn.click({ timeout: 3000 }).catch(() => {}); await settle(page); continue; }
      const start = page.locator('dialog.mini-dialog[open] button.primary:visible').first();
      if (await start.count()) { await start.click({ timeout: 3000 }).catch(() => {}); await settle(page); continue; }
      r.result = 'došla energie'; break;
    }
    if (s.won) {
      r.result = 'výhra';
      r.movesUsed = r.budget != null ? r.budget + 5 * r.adsWatched - (s.movesLeft ?? 0) : null;
      await checkpoint(page, testInfo, diary, `vyhra-${slug(r.title)}`, { optional: true });
      break;
    }
    if (s.outOfMoves) {
      if (policy.ads && s.adMovesAvailable && r.adsWatched < 1) { await checkpoint(page, testInfo, diary, `dosly-tahy-${slug(r.title)}`); await clickCss(page, '.out-of-moves[role="region"] button.primary'); await page.waitForTimeout(300); continue; }
      r.result = 'prohra'; r.movesUsed = r.budget + 5 * r.adsWatched;
      await checkpoint(page, testInfo, diary, `prohra-${slug(r.title)}`);
      if (r.attempts < maxAttempts) {
        // Retry the same level (costs energy, like a real player).
        r.failedAttempts.push({ movesUsed: r.movesUsed, ads: r.adsWatched, helpers: [...r.helpersUsed] });
        let retry = page.locator('.out-of-moves[role="region"] button.keep-playing:not([disabled])').first();
        if (!(await retry.count())) {
          // No energy left: the panel offers a test ad for +1 energy, watch it like a player would.
          const energyAd = page.locator('dialog.mini-dialog[open] .out-of-moves:not([role]) button:not([disabled])').first();
          if (await energyAd.count()) {
            r.energyAds++; await energyAd.click({ timeout: 3000 }).catch(() => {}); await settle(page);
            if (await page.locator(AD_CONTAINER).count()) await watchAd(page, r.notes, r);
            await page.waitForTimeout(400);
          }
        }
        if (await retry.count()) { await retry.click({ timeout: 3000 }).catch(() => {}); }
        else { await page.locator('.out-of-moves[role="region"] button.keep-playing').nth(1).click({ timeout: 3000 }).catch(() => {}); } // no energy: back to the ship, reopen below
        r.attempts++; r.budget = null; r.adsWatched = 0; r.helpersUsed = []; r.helperAd = false; r.result = 'neznámý';
        await page.waitForTimeout(600);
        continue;
      }
      break;
    }
    if (!s.inLevel) {
      if (r.attempts > 1 && r.result === 'neznámý' && reopen++ < maxAttempts) { await openNextLevel(page); continue; }
      r.result = 'level se zavřel'; break;
    }
    if (s.busy || !s.tiles.length) { await settle(page); continue; }
    if (r.budget == null) { r.budget = s.movesLeft; }
    if (!shot) { shot = true; await checkpoint(page, testInfo, diary, `deska-${slug(r.title)}`); }

    // Assisted policy: spend helpers in the last moves.
    if (policy.helpers && s.movesLeft <= 3) {
      const h = [4, 3, 0].find(i => s.helpers[i]?.stock && !s.helpers[i].disabled);
      if (h == null && policy.ads && !r.helperAd && s.helpers[4] && !s.helpers[4].disabled) {
        // Out of stock: one test ad per attempt refills a helper (EMP), as the game offers.
        r.helperAd = true; r.pendingAd = 'helper'; r.adsForHelpers = (r.adsForHelpers || 0) + 1;
        await page.locator('.helper-tile').nth(4).click({ timeout: 3000 }).catch(() => {});
        await settle(page);
        continue;
      }
      if (h != null) {
        await page.locator('.helper-tile').nth(h).click({ timeout: 3000 }).catch(e => r.notes.push('pomůcka nešla zmáčknout: ' + e.message.split('\n')[0]));
        await settle(page);
        if ((await page.evaluate(readState)).tutorial) { r.tutorials++; await dismissTutorial(page); await settle(page); await page.locator('.helper-tile').nth(h).click({ timeout: 3000 }).catch(() => {}); await settle(page); }
        const target = chooseHelperTarget(s, h);
        await page.locator(`button[data-cell="${target}"]`).click({ timeout: 3000, force: true }).catch(() => {});
        r.helpersUsed.push(['Laser', 'Shuffle', 'Swap', 'Beam', 'EMP'][h]);
        await waitIdle(page);
        continue;
      }
    }
    const move = chooseMove({ ...s, noChargeSwap: policy.chargeSwap === false });
    if (!move) { if (++idle > 30) { r.result = 'zaseknuto: žádný tah'; r.stalls++; await checkpoint(page, testInfo, diary, 'zaseknuto'); break; } await page.waitForTimeout(250); continue; }
    idle = 0;
    try {
      if (move.kind === 'booster') { await page.locator(`button[data-cell="${move.a}"]`).click({ timeout: 3000 }); r.boostersFired++; }
      else {
        // For a charge move, a is the ordinary tile: select it first, then tap the charge next to it.
        await page.locator(`button[data-cell="${move.a}"]`).click({ timeout: 3000 }); await page.locator(`button[data-cell="${move.b}"]`).click({ timeout: 3000 });
        if (move.kind === 'chargeSwap') r.chargeMoves++;
      }
    } catch (e) { r.notes.push('klik selhal: ' + e.message.split('\n')[0]); }
    await waitIdle(page);
  }
  r.durationMs = Date.now() - t0;
  return r;
}

export async function waitIdle(page) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('.board')?.getAttribute('aria-busy') !== 'true' && !document.querySelector('.shuffle-overlay'), null, { timeout: 70000 }).catch(() => {});
}

/** Clicks the "repair complete" button after a win to return to the ship. */
export async function collectWin(page) {
  // Leave the win screen and make sure the level dialog is really closed before moving on.
  for (let k = 0; k < 3; k++) {
    await clickCss(page, '.win-panel button.primary', 5000).catch(() => {});
    const closed = await page.locator('dialog.mini-dialog[open]').waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false);
    if (closed) break;
  }
  await page.waitForTimeout(800);
}

const slug = s => (s || 'level').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);

/** Saves the game state (localStorage) so a later run can continue from here (START_STATE). */
export async function saveState(page, file) {
  const state = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
    .filter(k => !/reporter|outbox|campaign|balance-attempts/.test(k)) // never copy analytics identity or queues
    .map(k => [k, localStorage.getItem(k)])));
  fs.mkdirSync(file.replace(/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
}
