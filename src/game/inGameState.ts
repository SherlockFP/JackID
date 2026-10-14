/**
 * In-game app state (TECH_SPEC §1.5, §8). Three paths share one scene:
 *  - `params.bench` set in a DEV build (`/?bench=<id>`): the single-machine test room (`world/bench.ts`).
 *  - otherwise a single-player Debt Run (`game/ingame/session.ts`): the pit, the FPS player at the lobby spawn, the run,
 *    the HUD. Free Casino (`mode: 'free'`) uses the same session without quota or Intermission.
 * This state owns the shell around the session: Esc pause, the Intermission panel between Watches and Nights, and the
 * run-end hand-off to the Results state (quota fail, fall, quit, Stay Up). Quota success opens the next Night.
 * It also owns the Settings screen wiring (pause card SETTINGS line, F1 = the CONTROLS page) and the seated U (Upgrade
 * Ledger) / J (journal): the session wires both for walk mode only, so here they open at a machine too and hand the
 * input mode back to 'machine' when they close. In an online session Esc is an overlay only: the sim keeps running.
 */
import * as THREE from 'three';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { RunSummary } from '@/net/protocol';
import * as registry from '@/machines/_base/registry';
import type { Bench } from '@/world/bench';
import { startDebtSession, type DebtSession } from './ingame/session';
import { fmtCoins, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { nightPaid } from '@/machines/debt_terminal/night';
import { SKIP_HOLD_S, skipTutorial, tutorialActive } from '@/game/tutorial';
import { closeSettingsScreen, openSettingsScreen, settingsScreenOpen } from '@/core/ui/settingsScreen';
import { startStory, holdForStory, openJournal, storyNight } from '@/game/story';
import { mountLedger } from '@/game/tycoon/ledger';
import { buildIntermission, buildPause, createInterHint, INTER_PANEL, PAUSE_PANEL, type InterHint } from './ingame/panels';
import { SeatHud } from '@/machines/_base/seatHud';
import { SOUL_MARKS_PER_RUN } from '@/game/duels/stakes';
import { phoneWalkKeys } from '@/machines/hotline';
import type { Action } from '@/core/input/types';

/** How long the Night summary toast stays up (it never blocks; the toast times out by itself). */
const SUMMARY_TOAST_S = 10;

/** A fall shows its fade before the Results state takes over; other endings hand off at once. */
const FALL_HOLD_S = 1.6;
const END_HOLD_S = 0.4;
/** Ignore a second Esc within this window after resuming (the browser and the input layer can both report it). */
const PAUSE_DEBOUNCE_MS = 250;
/** The seated Upgrade Ledger (the walk-mode one lives in the session). */
const SEAT_LEDGER_PANEL = 'ingame-ledger-seated';
/** After the journal closes at a machine, pointer lock is refused for this long (the journal asks for it on its way out). */
const LOCK_GUARD_S = 0.6;
/** A seated J that arrives right after the journal closed (the same key press, one step late) must not reopen it. */
const JOURNAL_SETTLE_MS = 250;

export function createInGameState(): AppStateHandler<'ingame'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101019);
  let bench: Bench | null = null;
  let session: DebtSession | null = null;
  let left = false;
  let ending = false;
  let paused = false;
  let resumedAt = -Infinity;
  let interOpen = false;
  let interKey = '';
  /** Free-roam Intermission: the HUD hint line and the paid-Night bookkeeping for the summary toast. */
  let interHint: InterHint | null = null;
  let wasPaid = false;
  let storyOff: (() => void) | null = null;
  let offs: Array<() => void> = [];
  /** Online: Esc opens the card but the sim keeps running (no `app.simPaused`). */
  let pauseLive = false;
  /** True while the pause card is swapped for the Settings screen (closing the card must not resume). */
  let toSettings = false;
  /** Which seated overlay (U ledger / J journal) is open, so closing it can hand the machine mode back. */
  let overlay: 'ledger' | 'journal' | null = null;
  let lockGuard = 0;
  /** When the seated journal last closed (performance.now), for JOURNAL_SETTLE_MS. */
  let journalShutAt = -Infinity;
  /** Esc pressed while the tutorial is up: the card opens on release, and only if the hold did not skip the tutorial. */
  let escHoldAt: number | null = null;

  /** Dev tooling is split out of the production bundle: `?bench=` is honoured only in a DEV build (DECISIONS G). */
  const enterBench = async (requested: string, seed: number): Promise<void> => {
    const [{ createBench }, demoTable] = await Promise.all([import('@/world/bench'), import('@/machines/_base/demoTable')]);
    if (left) return;
    if (requested.replace(/_/g, '') === demoTable.def.id) registry.registerExtra(demoTable);   // the reference table is bench-only
    const machineId = registry.resolve(requested);
    if (!machineId) throw new Error(`bench: unknown machine "${requested}"`);   // app.go returns to the menu
    bench = createBench({ machineId, seed, scene });
    app.world = bench.world;
    app.run = bench.run;
    app.player = bench.player;
  };

  /** The pause card. Built again after the Settings screen closes (the card is closed while Settings is up). */
  const showPauseCard = (): void => {
    const seated = app.player?.seat != null;
    const tutorial = tutorialActive();
    app.ui.panel(PAUSE_PANEL, (el) => buildPause(el, {
      live: pauseLive,
      marks: app.run?.duel ? { left: app.run.duel.soulMarks(), max: SOUL_MARKS_PER_RUN } : undefined,
      onResume: () => { app.ui.closePanel(PAUSE_PANEL); },
      onQuit: () => { session?.run.quit(); },
      onGone: () => { if (paused && !toSettings) setPaused(false); },
      // seated: STAND UP releases the seat (deferred while the round settles), then the pause closes
      onStandUp: seated ? () => { session?.world.standUp(); app.ui.closePanel(PAUSE_PANEL); } : undefined,
      onSkipTutorial: tutorial ? () => { skipTutorial(); app.ui.closePanel(PAUSE_PANEL); } : undefined,
      onSettings: openSettingsFromPause,
    }));
  };

  /**
   * SETTINGS on the pause card. The screen opens first and the card closes after it, so the input mode never drops to
   * walk in between (no stray pointer lock). Closing the screen brings the card back; Esc on the card then resumes.
   */
  const openSettingsFromPause = (): void => {
    toSettings = true;
    try {
      openSettingsScreen({ onClose: () => { if (paused && !ending && !left) showPauseCard(); } });
      if (settingsScreenOpen()) app.ui.closePanel(PAUSE_PANEL);
    } finally {
      toSettings = false;
    }
  };

  const setPaused = (on: boolean): void => {
    if (paused === on || !session || ending) return;
    paused = on;
    pauseLive = on && app.net.online;
    app.simPaused = on && !pauseLive;
    if (on) {
      app.input.exitLock();
      showPauseCard();
    } else {
      resumedAt = performance.now();
      app.ui.closePanel(PAUSE_PANEL);
      // A seated player resumes AT the machine (the machine sink is still attached): never force walk mode over a seat,
      // or E would no longer reach the machine and the player could not stand up.
      if (app.player?.seat != null) app.input.setMode('machine');
      else {
        app.input.setMode('walk');
        void app.input.requestLock();
      }
    }
  };

  // ── seated U (ledger) and J (journal) ───────────────────────────────────────────────────────────
  /** Hand the right mode back after a seated overlay: 'machine' while still seated, otherwise 'walk' with the lock. */
  const restoreSeatMode = (): void => {
    if (left) return;
    if (app.player?.seat != null) {
      app.input.setMode('machine');
      app.input.exitLock();
      lockGuard = LOCK_GUARD_S;
    } else {
      app.input.setMode('walk');
      void app.input.requestLock();
    }
  };
  const canOpenSeated = (): boolean => !!session && !paused && !ending && !left && !overlay && app.input.mode === 'machine';
  const journalSettling = (): boolean => performance.now() - journalShutAt < JOURNAL_SETTLE_MS;

  const closeSeatedLedger = (): void => {
    if (overlay !== 'ledger') return;
    overlay = null;
    app.ui.closePanel(SEAT_LEDGER_PANEL);
    restoreSeatMode();
  };
  const openSeatedLedger = (): void => {
    const s = session;
    if (!s || !canOpenSeated()) return;
    const mid = s.world.seat?.mid ?? null;
    if (!mid || !s.world.machine(mid)) { app.ui.toast(t('ingame.ledger.none'), 'warn'); return; }
    overlay = 'ledger';
    app.input.setMode('ui');
    app.input.exitLock();
    app.ui.panel(SEAT_LEDGER_PANEL, (el) => {
      mountLedger(el, s.run.tycoon, mid, { onClose: closeSeatedLedger, toast: (text) => app.ui.toast(text, 'sys') });
    });
  };
  /**
   * J is a seated action (core/keymap SEATED_WALK_ACTIONS): the input layer hands it over in the step, after the journal's
   * own window key handler has run, so opening here cannot be closed by the same press.
   */
  const openSeatedJournal = (): void => {
    if (!canOpenSeated() || journalSettling()) return;
    overlay = 'journal';
    openJournal();   // takes the mouse and the keys (mode 'ui'); on its way out it asks for walk mode, `watchOverlay` corrects that
  };
  /** The journal closes itself and sets walk mode; at a machine that must become 'machine' again (and the lock must go). */
  const watchOverlay = (dt: number): void => {
    if (overlay === 'journal' && app.input.mode !== 'ui') { overlay = null; journalShutAt = performance.now(); restoreSeatMode(); }
    if (lockGuard > 0) {
      lockGuard -= dt;
      if (app.input.mode === 'machine' && app.input.locked) app.input.exitLock();
    }
  };

  /**
   * The compact paid-Night summary: a toast, never a modal. "QUOTA N PAID · float +F · interest +I · tickets +T", read from the
   * run's Night ledger (`run.nightLedger()`): the same integers the run booked, so the figures add up to what the player got.
   */
  const showSummary = (s: DebtSession): void => {
    const L = s.run.nightLedger();
    const text = t('econ.summary', { n: L.night, float: Math.round(L.float), int: Math.round(L.interest), tickets: Math.round(L.tickets) });
    (app.ui as UIOverlayX).toast(text, 'good', SUMMARY_TOAST_S);
  };

  /**
   * The Intermission is free-roam: a HUD hint instead of a modal, so the Pawn Window, the phone and the Debt Terminal
   * levers (OPEN THE FLOOR / the Bell) stay reachable. Only the Topside choice (STAY UP / GO BACK DOWN) is a modal.
   */
  const termAt = new THREE.Vector3();
  const termFwd = new THREE.Vector3();
  /** "◀ 12m" toward the Debt Terminal from the player's view; '' when it is not placed. */
  const terminalBearing = (s: DebtSession): string => {
    const p = app.player, cam = app.camera;
    if (!p || !cam) return '';
    let best = Infinity, bx = 0, bz = 0;
    for (const m of s.world.machines()) {
      if (m.def.id !== 'debt_terminal') continue;
      const root = (m as unknown as { model?: { root?: THREE.Object3D } }).model?.root;
      if (!root) continue;
      root.getWorldPosition(termAt);
      const d = Math.hypot(termAt.x - p.pos.x, termAt.z - p.pos.z);
      if (d < best) { best = d; bx = termAt.x; bz = termAt.z; }
    }
    if (!Number.isFinite(best)) return '';
    cam.getWorldDirection(termFwd);
    const lateral = -termFwd.z * (bx - p.pos.x) + termFwd.x * (bz - p.pos.z);
    return ` ${lateral >= 0 ? '▶' : '◀'} ${Math.round(best)}m`;
  };

  const syncHint = (s: DebtSession): void => {
    const timed = s.run.rules.timed && !s.run.over;
    const inter = timed && s.run.shift.phase === 'intermission';
    const paid = timed && nightPaid(s.run);
    if (paid && !wasPaid) showSummary(s);
    wasPaid = paid;
    // seated (or walking up to a seat, or in machine mode): the hint never sits over the Pawn or terminal view
    const seated = app.player?.seat != null || s.world.seat != null || app.input.mode === 'machine';
    const show = inter && !s.run.topsideOpen && !seated && !paused && !ending;
    interHint?.set(show ? t(paid ? 'interm.hintFloor' : 'interm.hintBell') + (paid ? '' : terminalBearing(s)) : null);
  };

  /** Topside panel follows the run: open while the Topside choice is up, closed otherwise. */
  const syncIntermission = (): void => {
    const s = session;
    if (!s || !s.ready() || ending || paused) { interHint?.set(null); return; }
    syncHint(s);
    const phase = s.run.shift.phase;
    const want = phase === 'intermission' && s.run.rules.timed && !s.run.over && s.run.topsideOpen;
    if (!want) {
      if (interOpen) { app.ui.closePanel(INTER_PANEL); interOpen = false; interKey = ''; }
      return;
    }
    const key = `${s.run.night()}|${s.run.topsideOpen}`;
    if (interOpen && key === interKey) return;
    interOpen = true;
    interKey = key;
    app.ui.panel(INTER_PANEL, (el) => buildIntermission(el, s.run, { redraw: () => { interKey = ''; } }));
  };

  const endRun = (summary: RunSummary): void => {
    if (ending || left) return;
    ending = true;
    const hold = summary.result === 'fell' ? FALL_HOLD_S : END_HOLD_S;
    app.timers.ui.after(hold, () => {
      if (left) return;
      // a fall or an ending plays its scene first; the Results hand-off waits for the story queue
      void holdForStory().then(() => { if (!left) void app.go('results', { summary }); });
    });
  };

  const onCanvasClick = (): void => {
    if (session && !paused && app.input.mode === 'walk' && !app.input.locked) void app.input.requestLock();
  };

  return {
    enter(params) {
      left = false;
      ending = false;
      paused = false;
      interOpen = false;
      interKey = '';
      pauseLive = false;
      toSettings = false;
      overlay = null;
      lockGuard = 0;
      journalShutAt = -Infinity;
      escHoldAt = null;
      app.canvas.addEventListener('click', onCanvasClick);
      offs.push(() => app.canvas.removeEventListener('click', onCanvasClick));
      offs.push(app.input.on('upgrade', (down) => { if (down && app.input.mode === 'machine') openSeatedLedger(); }));
      offs.push(app.input.on('journal', (down) => { if (down && app.input.mode === 'machine') openSeatedJournal(); }));
      // F1: the CONTROLS page (the key bindings), at a machine or on foot
      offs.push(app.input.on('help', (down) => {
        const m = app.input.mode;
        if (!down || left || ending || paused || (m !== 'walk' && m !== 'machine')) return;
        openSettingsScreen({ page: 'controls', focus: 'keys' });
      }));
      offs.push(bus.on('run:end', ({ summary }) => endRun(summary)));
      offs.push(app.input.on('pause', (down) => {
        if (!session || ending) return;
        if (!down) {
          // a short press with the tutorial up opens the card now; a hold that skipped the tutorial does not
          const held = escHoldAt === null ? Infinity : performance.now() - escHoldAt;
          escHoldAt = null;
          if (held < SKIP_HOLD_S * 1000 && !paused) setPaused(true);
          return;
        }
        if (!paused && performance.now() - resumedAt < PAUSE_DEBOUNCE_MS) return;
        if (!paused && tutorialActive()) { escHoldAt = performance.now(); return; }
        setPaused(!paused);
      }));
      if (params.bench && import.meta.env.DEV) return enterBench(params.bench, params.seed);
      session = startDebtSession(params, scene);
      // seat HUDs ask the run whether the floor is open (a closed floor says FLOOR CLOSED, not PRESS SPIN)
      SeatHud.floorOpen = () => {
        const s = session;
        if (!s) return true;
        const p = s.run.shift.phase;
        return p === 'play' || p === 'lastCall';
      };
      storyOff = startStory(session.world, params);
      storyNight(session.run.night());   // a resumed run has no Night event yet: the room notes gate on it
      interHint = createInterHint((app.ui as UIOverlayX).hudLayer);
      wasPaid = false;
      offs.push(bus.on('run:rescue', ({ pid, state }) => { if (session && pid === session.run.selfId && state === 'ring') app.ui.toast(t('hotline.toast.pocketEmpty'), 'warn'); }));
      offs.push(bus.on('eco:wallet', ({ pid, delta, reason }) => {
        if (!session || pid !== session.run.selfId) return;
        if (reason === 'house:float' && delta > 0) app.ui.toast(t('house.float.toast', { x: fmtCoins(delta) }), 'good');
      }));
    },
    exit() {
      left = true;
      for (const off of offs) off();
      offs = [];
      app.simPaused = false;
      SeatHud.floorOpen = () => true;
      paused = false;
      pauseLive = false;
      overlay = null;
      closeSettingsScreen();
      app.ui.closePanel(SEAT_LEDGER_PANEL);
      app.ui.closePanel(PAUSE_PANEL);
      app.ui.closePanel(INTER_PANEL);
      interOpen = false;
      interHint?.dispose();
      interHint = null;
      if (bench) {
        bench.dispose();
        bench = null;
      }
      storyOff?.();
      storyOff = null;
      if (app.cutscene.playing) app.cutscene.abort();   // a scene must not carry over into the menu
      if (session) {
        session.dispose();
        session = null;
      }
      app.world = null; app.player = null; app.run = null;
    },
    fixedUpdate(dt) {
      if (session) {
        if (!paused || pauseLive) { phoneWalkKeys((a) => app.input.pressed(a as Action)); session.fixedUpdate(dt); }
        return;
      }
      app.world?.fixedUpdate(dt);
    },
    frame(dt, alpha) {
      if (session) {
        session.frame(dt, alpha);
        watchOverlay(dt);
        syncIntermission();
        app.renderer.render(scene, app.camera, session.player.overlay);
        return;
      }
      app.world?.frame(dt, app.time.sim);
      app.renderer.render(scene, app.camera);
    },
  };
}
