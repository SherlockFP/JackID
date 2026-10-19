/**
 * THE TOUR (`node scripts/qa/bench.mjs --tour --size 1920x1080 --query lang=tr --out <dir>`): one run on the fixed clock that
 * walks a fresh profile from the menu to Night 2 and saves a fixed, named set of checkpoint shots (`NN-<name>.png`), then writes
 * `tour.json` with each shot's ok or fail and why, the steps that failed and the console errors. The same seed gives the same tour.
 *
 * It is driven by bench.mjs: `runTour(ctx, h)` gets the run context and the helpers it needs (`h`), so there is one CDP session, one
 * clock and one set of step handlers. A checkpoint that cannot be reached is a `fail` with the reason; the tour goes on.
 */
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** The checkpoints, in the order they are taken. The file of shot k is `<k+1, 2 digits>-<name>.png`. */
export const TOUR_SHOTS = [
  'menu', 'settings',
  'prologue-scene', 'prologue-door', 'street-corridor', 'street-walk', 'casino-door', 'lift-down', 'casino-arrival',
  'bigone-coach', 'bigone-spin', 'bigone-win', 'bank-booth', 'bank-deposit', 'cashier', 'coin-trick-r', 'coin-trick-q',
  'last-call', 'mola-closed', 'dawn-dark', 'boon-offer', 'boon-picked', 'lift-up',
  'walk-street', 'walk-corridor', 'walk-your-door', 'evening', 'chapter-title', 'pause-card', 'journal-plan', 'phone-inbox',
  'konsol', 'achievements', 'night2-lift', 'night2-loki', 'burning-wager',
];
const MIN_MEAN = 1.5;   // mean brightness (0-255) under this is a black frame

export async function runTour(ctx, h) {
  const { cdp } = ctx;
  const T = (ctx.tour = { shots: [], errors: [], notes: [], done: new Set() });
  const t0 = h.nowMs();
  const file = (name) => `${String(TOUR_SHOTS.indexOf(name) + 1).padStart(2, '0')}-${name}`;
  const real = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * One checkpoint: waits for a drawn frame, takes the shot, and judges it. `check` is page JS that returns true, or a string that
   * says why the shot is not what its name says. A black frame fails unless `dark`.
   */
  async function snap(name, check = null, { dark = false, tries = 1 } = {}) {
    if (!TOUR_SHOTS.includes(name)) throw new Error(`tour: unknown shot "${name}"`);
    const rec = { n: TOUR_SHOTS.indexOf(name) + 1, name, ok: false, why: null, file: null, mean: null, scene: null };
    T.shots.push(rec);
    try {
      // a moment that is still coming (a fade, a line) is waited for, 0.7 s at a time, before the one shot
      for (let i = 1; check && i < tries && (await h.evaluate(cdp, check)) !== true; i++) await h.sleep(700);
      const path = await ctx.shoot(file(name));
      rec.file = basename(path);
      rec.mean = ctx.shoot.last?.mean ?? null;
      rec.scene = await h.evaluate(cdp, 'window.jackid.app.cutscene.playing ?? null');
      let why = null;
      if (!dark && rec.mean !== null && rec.mean < MIN_MEAN) why = `the frame is black (brightness ${rec.mean})`;
      if (!why && check) {
        const r = await h.evaluate(cdp, check);
        if (r !== true) why = typeof r === 'string' ? r : `check failed: ${check.slice(0, 70)}`;
      }
      rec.ok = why === null;
      rec.why = why;
    } catch (e) { rec.why = String(e?.message ?? e); }
    h.log(`tour ${rec.n} ${name}: ${rec.ok ? 'ok' : `fail (${rec.why})`}${rec.scene ? ` [scene ${rec.scene}]` : ''}`);
    return rec;
  }
  /** A section of the tour: an error ends the section, is kept in tour.json, and the next section starts anyway. */
  async function section(label, fn) {
    try { await fn(); } catch (e) { T.errors.push({ section: label, error: String(e?.message ?? e) }); h.log(`tour section "${label}" stopped: ${e?.message ?? e}`); }
  }
  /** Runs one --run step text (`goto:bigone`) and returns its record. */
  async function step(text) {
    const [s] = h.parseRunSteps(text);
    ctx.next = null;
    return h.exec(ctx, s);
  }
  const stageIs = (stage) => `window.jackid.app.run?.homeStage?.() === ${JSON.stringify(stage)} || 'home stage is ' + window.jackid.app.run?.homeStage?.()`;
  const seatedAt = (id) => `window.jackid.app.world?.machines().find((m) => m.id === window.jackid.app.player?.seat?.mid)?.def.id === ${JSON.stringify(id)} || 'not seated at ${id}'`;
  /** Presses Escape until nothing matches `sel` any more (a text field keeps the first press), at most 3 times. */
  async function escapeFrom(sel) {
    for (let i = 0; i < 3 && (await h.evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(sel)}))`)); i++) {
      await h.pressKey(cdp, 'Escape', 80);
      await h.sleep(500);
    }
  }
  async function waitReal(fn, maxMs, what) {
    const start = Date.now();
    while (!(await fn())) {
      if (Date.now() - start > maxMs) throw new Error(`timed out waiting for ${what}`);
      await h.stepFrames(cdp, 50);
      await real(100);
    }
  }

  // ── menu and settings ──────────────────────────────────────────────────────────────────────────
  await section('menu', async () => {
    await h.sleep(1500);
    await snap('menu', `window.jackid.state() === 'menu' || 'state is ' + window.jackid.state()`);
    await h.pressKey(cdp, 'ArrowLeft', 80);                       // the die rolls to SETTINGS
    await h.sleep(1800);
    await h.pressKey(cdp, 'Enter', 80);
    await h.sleep(1800);
    await snap('settings', `Boolean(document.querySelector('.st-frame')) || 'no settings panel'`);
    await h.pressKey(cdp, 'Escape', 80);
    await h.sleep(800);
  });

  // ── a fresh run: the prologue, the street, the lift ────────────────────────────────────────────
  let started = false;
  await section('start', async () => {
    await h.evaluate(cdp, `(window.jackid.app.go('ingame', { mode: 'debt', seed: ${ctx.seed}, online: false }), true)`);
    await waitReal(() => h.evaluate(cdp, `window.jackid.state() === 'ingame' && !!window.jackid.app.run && !!window.jackid.app.world`), 120_000, 'the run to start');
    await h.evaluate(cdp, h.BET_TAP_JS);
    started = true;
  });
  if (!started) return finish();

  await section('prologue', async () => {
    const marks = {
      scene: () => snap('prologue-scene', `window.jackid.app.cutscene.playing === 'prologue' || 'no prologue scene'`),
      door: () => snap('prologue-door'),
      street: async () => {
        await h.evalJson(cdp, h.anchorJs('street.adaDoor'));
        await h.sleep(400);
        await snap('street-corridor');
        await h.evalJson(cdp, h.anchorJs('street.mid'));
        await h.sleep(400);
        await snap('street-walk');
        await h.evalJson(cdp, h.anchorJs('street.arrive', [4.6, 0, 7], 0.74));
        await h.sleep(400);
        await snap('casino-door');
      },
    };
    // the shot is taken inside the car (skipPrologue waits for the teleport and 1.3 s of the ride), not at the flat's door
    const p = await h.skipPrologue(cdp, () => snap('lift-down', `(${h.IN_CAR_JS}) || 'the player is not in the lift car'`).then((r) => r.file), marks);
    h.log(`tour prologue: played ${p.played}`);
    await h.skipIntro(cdp);
    // the Night's title card plays when Night 1's first Watch opens (the lift landing): shot it 1.7 s in (the title is up from 0.8 s)
    for (let i = 0; i < 30 && (await h.evaluate(cdp, 'window.jackid.app.cutscene.playing')) !== 'chapter_n1'; i++) await h.sleep(200);
    if (await h.evaluate(cdp, `window.jackid.app.cutscene.playing === 'chapter_n1'`)) {
      for (let i = 0; i < 40 && (await h.evaluate(cdp, 'window.jackid.app.cutscene.time')) < 1.7; i++) await h.sleep(100);
      await snap('chapter-title', `document.querySelector('.chapter-title')?.classList.contains('in') || 'no chapter title on screen'`);
    }
    await h.sleep(800);
    await snap('casino-arrival', `Boolean(document.querySelector('.px-wm:not(.off)')) || 'no waymark'`);
  });

  // ── the Big One, the bank booth, the cashier, the coin tricks ──────────────────────────────────
  await section('bigone', async () => {
    const rec = await step('goto:bigone');
    if (!rec.ok) throw new Error(rec.error ?? rec.reason ?? 'goto:bigone failed');
    await h.sleep(600);
    await snap('bigone-coach', seatedAt('bigone'));
    await h.pressKey(cdp, 'Digit0', 60);                          // closes the first-sit tip if it is up
    await h.sleep(400);
    await h.pressKey(cdp, 'Space', 120);
    await h.sleep(700);
    await snap('bigone-spin');
    await h.waitRoundIdle(cdp, rec.instance, { start: true });
    // the forced win: the Big One's own debug force (src/machines/bigone), the same registry --force uses
    const forced = await h.evalJson(cdp, `import('/src/core/debugForce.ts').then((m) => m.debugForceFor('bigone')?.('win') ?? false)`);
    if (forced !== true) throw new Error('the Big One has no force handler for "win"');
    await h.pressKey(cdp, 'Space', 120);
    await h.sleep(1400);
    await snap('bigone-win');
    await h.waitRoundIdle(cdp, rec.instance, { start: true });
    if ((await h.evalJson(cdp, h.BIGONE_STATE_JS(rec.instance)))?.offer) await h.pressKey(cdp, 'Space', 120);   // collect a chase offer
    await h.sleep(600);
  });

  await section('bank', async () => {
    const rec = await step('goto:debt_terminal');
    if (!rec.ok) throw new Error(rec.error ?? rec.reason ?? 'goto:debt_terminal failed');
    await h.sleep(800);
    await snap('bank-booth', seatedAt('debt_terminal'));
    const b0 = await h.evaluate(cdp, h.BANK_JS);
    await h.pressKey(cdp, 'Digit5', 80);                          // type 5, then press the key under the cursor
    await h.sleep(300);
    await h.pressKey(cdp, 'Enter', 80);
    await h.sleep(900);
    const b1 = await h.evaluate(cdp, h.BANK_JS);
    await snap('bank-deposit', b1 > b0 || `the bank did not grow (${b0} -> ${b1})`);
    await step('stand');
  });

  await section('cashier', async () => {
    const rec = await step('goto:cashier');
    if (!rec.ok) throw new Error(rec.error ?? rec.reason ?? 'goto:cashier failed');
    await h.sleep(800);
    await snap('cashier', seatedAt('cashier'));
    const st = await step('stand');
    if (!st.ok) throw new Error(st.reason ?? 'could not stand up');
  });

  await section('coin tricks', async () => {
    await h.sleep(600);
    await h.pressKey(cdp, 'KeyR', 80);                            // R tosses the coin (walking)
    await h.sleep(350);
    await snap('coin-trick-r');
    await h.sleep(1500);
    await h.sendKey(cdp, 'rawKeyDown', h.keyParams('KeyQ'));      // hold Q: the fancy tricks
    await h.sleep(900);
    await snap('coin-trick-q');
    await h.sendKey(cdp, 'keyUp', h.keyParams('KeyQ'));
    await h.sleep(600);
  });

  // ── the rest of Night 1: the bot plays, the tour stops it at each moment ───────────────────────
  await section('night 1', async () => {
    const hooks = (ctx.tourHooks = {
      /** Before the Bell: the Watch's clock runs on to LAST CALL (once), so the amber pulses and the bell are on screen. */
      async beforeBell() {
        if (T.done.has('last-call')) return;
        T.done.add('last-call');
        await h.evaluate(cdp, `(() => { const r = window.jackid.app.run; const to = r.lastCallSec;
          if (r.shift.phase === 'play' && r.clock.remaining > to) r.clock.tick(r.clock.remaining - to + 0.2); return true; })()`);
        await h.sleep(1500);
        await snap('last-call', `window.jackid.app.run.shift.phase === 'lastCall' || 'phase is ' + window.jackid.app.run.shift.phase`);
      },
      /** Each bot loop: the Mola, the Dawn, the offer and the lift are taken as they come. */
      async onState(st) {
        // the Night's title card: a centred title that fades out (src/game/story/chapterTitle.ts). It plays when the story starts it,
        // which has been at Dawn; it is shot whenever it plays, 1.7 s in (the title is up from 0.8 s)
        if (!T.done.has('chapter-title') && (await h.evaluate(cdp, `window.jackid.app.cutscene.playing === 'chapter_n1'`))) {
          T.done.add('chapter-title');
          for (let i = 0; i < 40 && (await h.evaluate(cdp, 'window.jackid.app.cutscene.time')) < 1.7; i++) await h.sleep(100);
          await snap('chapter-title', `document.querySelector('.chapter-title')?.classList.contains('in') || 'no chapter title on screen'`);
          return true;
        }
        if (st.phase === 'intermission' && !st.nightDone && !st.nightCardOffer && !st.starterOffer && !T.done.has('mola-closed')) {
          T.done.add('mola-closed');
          await h.sleep(2500);                                    // the lights settle to half, the machines read CLOSED
          await snap('mola-closed', `window.jackid.app.run.shift.phase === 'intermission' || 'phase is ' + window.jackid.app.run.shift.phase`);
          return true;
        }
        if ((st.phase === 'collection' || (st.nightDone && st.phase === 'intermission')) && !T.done.has('dawn-dark')) {
          T.done.add('dawn-dark');
          await h.sleep(1200);
          await snap('dawn-dark');
          return true;
        }
        if (st.nightCardOffer && !T.done.has('boon-offer')) {
          T.done.add('boon-offer');
          await h.sleep(2400);                                    // the receipt counts up and the cards are dealt
          await snap('boon-offer', `document.querySelectorAll('.pt-card').length > 0 || 'no boon cards on screen'`);
          await h.pressKey(cdp, 'Digit1', 80);                    // a real key keeps card 1
          await h.sleep(350);
          await snap('boon-picked', `Boolean(document.querySelector('.pt-picked')) || 'no picked card'`);
          await h.settlePanels(ctx);
          return true;
        }
        if (st.nightDone && !st.nightCardOffer && st.homeStage === null && !T.done.has('lift-up')) {
          T.done.add('lift-up');
          await step('lever');                                    // TAKE THE LIFT
          await h.waitInCar(cdp, 1300);                           // the car fades in 0.4 s after the teleport, the dial rises for 1.6 s
          await snap('lift-up', `(${h.IN_CAR_JS}) || 'the player is not in the lift car'`);
          return true;
        }
        return false;
      },
    });
    const rec = {};
    await h.autoNight(ctx, rec, 'evening');
    h.log(`tour night 1: ${rec.end}`);
    if (rec.end !== 'evening') throw new Error(`Night 1 ended with "${rec.end}"`);
    ctx.tourHooks = null;
  });

  // ── the walk home ──────────────────────────────────────────────────────────────────────────────
  await section('walk home', async () => {
    await h.settlePanels(ctx);
    // the arrival fade has to be clear, or the shot is a dark street
    const snapTo = (name) => snap(name, `(${h.FADE_CLEAR_JS}) || 'the screen fade is still up'`, { tries: 4 }).then((r) => r.file);
    const w = await h.walkHome(ctx, [
      ['walk-street', 'street.mid', [0, 0, 0], null],
      ['walk-corridor', 'street.adaDoor', [0, 0, 0], null],
    ], snapTo, 'walk-your-door');
    if (!w.walked) throw new Error('the walk did not reach the flat');
    await h.sleep(800);
    // A scene that starts under a panel (the chapter card ran during the Dawn offer) hands the input back as 'ui' (core/cutscene/player.ts
    // restores the effective mode as the base), so the keys of the walk do nothing. The tour sets walk mode and says so.
    const stuck = await h.evaluate(cdp, `(() => { const i = window.jackid.app.input; if (i.base !== 'ui' || i.uiBlocked) return false; i.setMode('walk'); return true; })()`);
    if (stuck) T.notes.push('input stayed in "ui" after the chapter card ran under the Dawn panel (core/cutscene/player.ts keeps the effective mode as prevMode): the tour set walk mode');
    await snap('evening', stageIs('evening'));
  });

  // ── the Evening ────────────────────────────────────────────────────────────────────────────────
  await section('evening', async () => {
    for (let i = 0; i < 4 && (await h.evaluate(cdp, 'window.jackid.app.cutscene.playing ?? null')); i++) { await h.pressKey(cdp, 'Space', 1300); await h.sleep(600); }
    await h.pressKey(cdp, 'Escape', 80);
    await h.sleep(700);
    await snap('pause-card', `window.jackid.app.simPaused === true || 'the game is not paused (input mode ' + window.jackid.app.input.mode + ', base ' + window.jackid.app.input.base + ')'`);
    await h.pressKey(cdp, 'Enter', 80);                           // the first line, RESUME (DEVAM), is the one lit
    await h.sleep(600);

    await h.pressKey(cdp, 'KeyJ', 80);                            // the journal: the floor plan is its first page
    await h.sleep(1200);
    await snap('journal-plan', `window.jackid.app.input.mode === 'ui' || 'the journal did not open'`);
    await h.pressKey(cdp, 'Escape', 80);
    await h.sleep(600);

    const ph = await step('phone:open');
    await h.sleep(500);
    await snap('phone-inbox', `Boolean(document.querySelector('.px-phone')) || 'the phone did not open'`);
    await h.pressKey(cdp, 'KeyT', 80);
    await h.sleep(500);

    const pc = await step('station:computer');
    await h.sleep(800);
    await h.pressKey(cdp, 'Digit4', 80);                          // the KONSOL tab
    await h.sleep(600);
    await snap('konsol', `[...document.querySelectorAll('.pc-tab-on')].some((b) => /KONSOL/i.test(b.textContent)) || 'the KONSOL tab is not open'`);
    if (!pc.ok) T.errors.push({ section: 'station:computer', error: pc.reason ?? pc.error ?? 'not ok' });
    // Esc closes the home computer (its panel is the modal). If it does not, the tour closes the panel itself and says so.
    await escapeFrom('.pc-tabs');
    if (await h.evaluate(cdp, `Boolean(document.querySelector('.pc-tabs'))`)) {
      T.notes.push('Esc did not close the home computer: the tour closed the panel directly');
      await h.evaluate(cdp, `(window.jackid.app.ui.closePanel('home-pc'), true)`);
      await h.sleep(300);
    }

    await h.evaluate(cdp, `(window.jackid.app.events.emit('achievements:open', undefined), true)`);
    await h.sleep(900);
    await snap('achievements', `(!document.querySelector('.pc-tabs') && Boolean(document.querySelector('.ach-row'))) || 'no achievements page on top'`);
    await escapeFrom('.ach-row');
  });

  // ── Night 2 ────────────────────────────────────────────────────────────────────────────────────
  await section('night 2', async () => {
    ctx.tourHooks = {
      async afterWalkOut() {                                      // the lift ride down, with Loki's line
        await h.sleep(900);
        await snap('night2-lift', `Boolean(document.querySelector('.px-subtitle.on')) || 'no line on screen'`, { tries: 4 });
      },
    };
    const r = await step('home:sleep');
    ctx.tourHooks = null;
    if (!r.ok) throw new Error(r.reason ?? r.error ?? 'home:sleep failed');
    await h.settlePanels(ctx);
    const g = await step('goto:coinflip');
    if (!g.ok) throw new Error(g.error ?? g.reason ?? 'goto:coinflip failed');
    await h.sleep(600);
    await h.pressKey(cdp, 'Digit0', 60);
    await h.pressKey(cdp, 'KeyO', 80);                            // ask Loki
    await h.sleep(900);
    await snap('night2-loki', `Boolean(document.querySelector('.px-toast-loki, .toast-loki, [class*=loki]')) || 'no Loki line on screen'`);
  });

  // ── THE BURNING WAGER, opened early (DEV): the Night 8 table on the stage, the board and Loki behind the Champion's chair ──
  await section('burning wager', async () => {
    const r = await step('duel:burning');
    if (!r.ok) throw new Error(r.reason ?? 'duel:burning failed');
    await step('play:Space:1200');                                // a hold skips the sit-down scene
    await waitReal(async () => (await h.evaluate(cdp, 'Boolean(document.querySelector(".pm-burning"))')) === true, 20000, 'the Burning Wager board');
    await h.sleep(1800);
    await snap('burning-wager', "Boolean(document.querySelector('.pm-burning')) || 'no Burning Wager board'");
  });

  return finish();

  /** tour.json: every checkpoint (a missing one is a fail), the steps that failed, the console errors. */
  function finish() {
    const shots = TOUR_SHOTS.map((name, i) => T.shots.findLast((s) => s.name === name)
      ?? { n: i + 1, name, ok: false, why: 'not reached', file: null, mean: null });
    const out = {
      seed: ctx.seed, ok: shots.filter((s) => s.ok).length, fail: shots.filter((s) => !s.ok).length, total: shots.length,
      simSeconds: Math.round((h.nowMs() - t0) / 100) / 10,
      shots,
      sectionErrors: T.errors,
      notes: T.notes,
      failedSteps: ctx.run.steps.filter((r) => r.ok === false && !r.auto).map((r) => ({ step: r.step, why: r.error ?? r.reason ?? null })),
      consoleErrors: ctx.res.consoleErrors, errors: ctx.res.errors,
    };
    if (ctx.shotsDir) writeFileSync(join(ctx.shotsDir, 'tour.json'), JSON.stringify(out, null, 2) + '\n');
    return out;
  }
}
