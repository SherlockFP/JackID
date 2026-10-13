/**
 * In-game app state (TECH_SPEC §1.5, §8). Three paths share one scene:
 *  - `params.bench` set in a DEV build (`/?bench=<id>`): the single-machine test room (`world/bench.ts`).
 *  - otherwise a single-player Debt Run (`game/ingame/session.ts`): the pit, the FPS player at the lobby spawn, the run,
 *    the HUD. Free Casino (`mode: 'free'`) uses the same session without quota or Intermission.
 * This state owns the shell around the session: Esc pause, the Intermission panel between Watches and Nights, and the
 * run-end hand-off to the Results state (quota fail, fall, quit, Stay Up). Quota success opens the next Night.
 */
import * as THREE from 'three';
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { RunSummary } from '@/net/protocol';
import * as registry from '@/machines/_base/registry';
import type { Bench } from '@/world/bench';
import { startDebtSession, type DebtSession } from './ingame/session';
import { buildIntermission, buildPause, INTER_PANEL, PAUSE_PANEL } from './ingame/panels';

/** A fall shows its fade before the Results state takes over; other endings hand off at once. */
const FALL_HOLD_S = 1.6;
const END_HOLD_S = 0.4;
/** Ignore a second Esc within this window after resuming (the browser and the input layer can both report it). */
const PAUSE_DEBOUNCE_MS = 250;

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
  let offs: Array<() => void> = [];

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

  const setPaused = (on: boolean): void => {
    if (paused === on || !session || ending) return;
    paused = on;
    app.simPaused = on;
    if (on) {
      app.input.exitLock();
      app.ui.panel(PAUSE_PANEL, (el) => buildPause(el, {
        onResume: () => { app.ui.closePanel(PAUSE_PANEL); },
        onQuit: () => { session?.run.quit(); },
        onGone: () => { if (paused) setPaused(false); },
      }));
    } else {
      resumedAt = performance.now();
      app.ui.closePanel(PAUSE_PANEL);
      app.input.setMode('walk');
      void app.input.requestLock();
    }
  };

  /** Intermission panel follows the run's phase: open while `intermission`, closed otherwise. */
  const syncIntermission = (): void => {
    const s = session;
    if (!s || !s.ready() || ending || paused) return;
    const phase = s.run.shift.phase;
    const want = phase === 'intermission' && s.run.rules.timed && !s.run.over;
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
      void app.go('results', { summary });
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
      app.canvas.addEventListener('click', onCanvasClick);
      offs.push(() => app.canvas.removeEventListener('click', onCanvasClick));
      offs.push(bus.on('run:end', ({ summary }) => endRun(summary)));
      offs.push(app.input.on('pause', (down) => {
        if (!down || !session || ending) return;
        if (!paused && performance.now() - resumedAt < PAUSE_DEBOUNCE_MS) return;
        setPaused(!paused);
      }));
      if (params.bench && import.meta.env.DEV) return enterBench(params.bench, params.seed);
      session = startDebtSession(params, scene);
    },
    exit() {
      left = true;
      for (const off of offs) off();
      offs = [];
      app.simPaused = false;
      paused = false;
      app.ui.closePanel(PAUSE_PANEL);
      app.ui.closePanel(INTER_PANEL);
      interOpen = false;
      if (bench) {
        bench.dispose();
        bench = null;
      }
      if (session) {
        session.dispose();
        session = null;
      }
      app.world = null; app.player = null; app.run = null;
    },
    fixedUpdate(dt) {
      if (session) { if (!paused) session.fixedUpdate(dt); return; }
      app.world?.fixedUpdate(dt);
    },
    frame(dt, alpha) {
      if (session) {
        session.frame(dt, alpha);
        syncIntermission();
        app.renderer.render(scene, app.camera, session.player.overlay);
        return;
      }
      app.world?.frame(dt, app.time.sim);
      app.renderer.render(scene, app.camera);
    },
  };
}
