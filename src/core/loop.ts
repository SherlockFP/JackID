/**
 * Main loop (TD-owned). Contract: TECH_SPEC §1.4.
 *
 * Fixed-step simulation at 60 Hz, variable-rate rendering with interpolation. Two clocks: **sim**
 * (pausable, advanced only in fixed steps; all gameplay tweens/timers/waits) and **ui** (real time).
 * Juice: `app.timeScale` (slow-mo) scales how fast the accumulator fills; `app.hitstopLeft` freezes it.
 * Online sessions clamp the scale to ≥ 0.6 so the host never drifts behind its clients.
 *
 * Background host keep-alive: when the tab is hidden while a session is online, rAF stops, so an inline
 * Web Worker ticks every 50 ms and runs the fixed-step block (catch-up ≤ 6 steps, no rendering).
 *
 * QA fixed step (DEV builds only: `import.meta.env.DEV` is false in a production build, so all of it folds away):
 *  - `?fixedstep=1`: every sim step is exactly FIXED_DT (1/60 s), and each rendered frame runs exactly one step
 *    (with `timeScale` 1), whatever the real frame time. The frame's timers, hit-stop and visual dt take FIXED_DT too.
 *  - `?fixedstep=1&clock=manual`: also, the browser's frame clock never reaches the game. rAF no longer steps the page:
 *    `window.__qaClock.step(n)` runs n frames (each a full step and render), rAF callbacks queued by the game run inside
 *    those frames, and `performance.now()` reads the sim clock. A wall-clock read in gameplay code (the offline
 *    `net.hostTime()`, the hotline and rescue rings, the seat-replay window) then cannot change a seeded run.
 *    `scripts/qa/bench.mjs` boots with both by default (`--real-time` turns them off).
 */
import { app } from './app';
import { bus } from './events';
import { log } from './log';

export const FIXED_DT = 1 / 60;          // s
export const MAX_FRAME_DT = 0.1;         // s, clamp after tab switches
export const MAX_STEPS = 6;              // per frame, spiral-of-death guard
const BG_TICK_MS = 50;
const BG_MAX_DT = 0.3;
const MIN_ONLINE_SCALE = 0.6;

const QS = typeof location === 'undefined' ? null : new URLSearchParams(location.search);
/** DEV only (always false in a production build): `?fixedstep=1` makes every step exactly FIXED_DT. */
export const FIXED_STEP: boolean = !!import.meta.env?.DEV && QS?.get('fixedstep') === '1';
/** DEV only: `?fixedstep=1&clock=manual` leaves the page still until `window.__qaClock.step(n)` (the QA harness). */
const MANUAL_CLOCK: boolean = FIXED_STEP && QS?.get('clock') === 'manual';

/** The QA clock, `window.__qaClock`, in manual mode only. */
export interface QaClock {
  /** Runs `frames` frames, one sim step each, every one rendered. Returns the sim time in seconds. */
  step(frames: number): number;
  /** Frames run so far (`app.time.frame`). */
  frames(): number;
  /** Sim time in ms (`app.time.sim`). */
  simMs(): number;
}

/** Manual mode: the animation-frame callbacks queued since the last frame (run inside the next stepped frame). */
let runFrameCallbacks: () => void = () => {};
/** Manual mode, once the clock is driven: the window timers fired inside the stepped frames (see engageSimTimers). */
let fireSimTimers: () => void = () => {};

if (MANUAL_CLOCK) {
  // In manual mode the sim clock is the only clock the page reads (see the header). Before `app` exists it reads 0.
  performance.now = (): number => (app ? app.time.sim * 1000 : 0);
  // ...and the animation-frame callbacks (world build pump, tycoon 3D loop, seat HUD, harness probes) run in the stepped
  // frames too, with the sim time as their timestamp. The browser's own frame clock never reaches game code.
  const queued = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => { const id = nextFrameId++; queued.set(id, cb); return id; };
  window.cancelAnimationFrame = (id: number): void => { queued.delete(id); };
  runFrameCallbacks = (): void => {
    if (queued.size === 0) return;
    const batch = [...queued.values()];
    queued.clear();                                   // callbacks queued by these run in the next frame
    const now = app ? app.time.sim * 1000 : 0;
    for (const cb of batch) {
      try { cb(now); } catch (e) { log.error('loop', 'animation frame callback failed', e); }
    }
  };
}

/** Ids of the window timers that run on the sim clock start here, so they never collide with the browser's own ids. */
const SIM_TIMER_BASE = 1_000_000_000;
interface SimTimer { due: number; every: number; fn: () => void }

/**
 * Manual mode: the window timers (`setTimeout` / `setInterval`) created from now on count the UI clock (`app.time.real`,
 * one FIXED_DT per frame) and fire inside the stepped frames, in due order. Without this, a timeout the game shows (a
 * choice's auto-pick, the Collector's 25 s) would resolve on the wall clock while the harness steps quickly. Timers created
 * before the first step (the boot screens) stay with the browser, and their ids stay below SIM_TIMER_BASE.
 */
function engageSimTimers(): void {
  const timers = new Map<number, SimTimer>();
  let next = SIM_TIMER_BASE;
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const add = (fn: TimerHandler, ms: number | undefined, every: boolean, args: unknown[]): number => {
    const id = next++;
    const delay = Math.max(0, Number(ms) || 0);
    const run = typeof fn === 'function' ? (): void => { (fn as (...a: unknown[]) => void)(...args); } : (): void => {};
    timers.set(id, { due: app.time.real * 1000 + delay, every: every ? Math.max(1, delay) : 0, fn: run });
    return id;
  };
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]): number => add(fn, ms, false, args)) as typeof window.setTimeout;
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]): number => add(fn, ms, true, args)) as typeof window.setInterval;
  window.clearTimeout = ((id?: number): void => { if (id !== undefined && id >= SIM_TIMER_BASE) timers.delete(id); else nativeClearTimeout(id); }) as typeof window.clearTimeout;
  window.clearInterval = ((id?: number): void => { if (id !== undefined && id >= SIM_TIMER_BASE) timers.delete(id); else nativeClearInterval(id); }) as typeof window.clearInterval;
  fireSimTimers = (): void => {
    if (timers.size === 0) return;
    const now = app.time.real * 1000;
    const due = [...timers].filter(([, t]) => t.due <= now).sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
    for (const [id] of due) {
      const t = timers.get(id);
      if (!t) continue;                               // cleared by an earlier callback in this frame
      if (t.every > 0) t.due += t.every; else timers.delete(id);
      try { t.fn(); } catch (e) { log.error('loop', 'timer callback failed', e); }
    }
  };
}

let raf = 0;
let last = 0;
let acc = 0;
let running = false;
let worker: Worker | null = null;
let workerUrl: string | null = null;
const offs: Array<() => void> = [];

/** One fixed simulation step (shared by the frame and the background ticker). */
function simStep(): void {
  const a = app;
  a.input.beginStep();                               // dispatch queued key/pointer events (machine sink), edge flags
  a.net.poll();                                      // deliver received messages in order
  if (!a.simPaused) {
    a.time.sim += FIXED_DT; a.time.step++;
    a.timers.sim.update(FIXED_DT); a.tweens.sim.update(FIXED_DT);
  }
  a.current.fixedUpdate(FIXED_DT);                   // player, machines.tick, run, world
  a.net.flush(FIXED_DT);                             // batched sends; transforms at 20 Hz
  a.input.endStep();
}

/**
 * One loop frame of real length `dt` (the rAF frame time, or FIXED_DT in the QA fixed step): the sim steps it pays for,
 * then the visuals. The frame's timers, hit-stop and visual dt all take this `dt`.
 */
function advance(dt: number): void {
  const a = app;
  a.time.real += dt; a.time.frame++;
  if (MANUAL_CLOCK) { runFrameCallbacks(); fireSimTimers(); }   // this frame's animation callbacks and due timers, in sim time
  a.input.beginFrame();                              // samples mouse deltas

  let scale = a.timeScale;
  if (a.hitstopLeft > 0) { a.hitstopLeft = Math.max(0, a.hitstopLeft - dt); scale = 0; }
  else if (a.net.online && scale < MIN_ONLINE_SCALE) scale = MIN_ONLINE_SCALE;
  acc += dt * scale;
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS) { simStep(); acc -= FIXED_DT; steps++; }
  if (steps === MAX_STEPS) acc = 0;

  a.timers.ui.update(dt); a.tweens.ui.update(dt);
  a.cutscene.update(dt);
  a.kit.update(a.simPaused ? 0 : dt * scale);        // animated mannequins
  a.current.frame(dt, acc / FIXED_DT);               // visuals (+ renderer.render inside)
  a.ui.update(dt);
}

function frame(nowMs: number): void {
  raf = requestAnimationFrame(frame);
  const dt = FIXED_STEP ? FIXED_DT : Math.min((nowMs - last) / 1000, MAX_FRAME_DT);
  last = nowMs;
  advance(dt);
}

/** Background tick: simulate only, no rendering. */
function backgroundTick(): void {
  const a = app;
  const now = performance.now();
  const dt = FIXED_STEP ? FIXED_DT : Math.min((now - last) / 1000, BG_MAX_DT);
  last = now;
  a.time.real += dt;
  acc += dt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS) { simStep(); acc -= FIXED_DT; steps++; }
  if (steps === MAX_STEPS) acc = 0;
  a.timers.ui.update(dt); a.tweens.ui.update(dt);
}

/** QA manual clock: the harness moves the page with `step(n)`. Each frame is the same `advance` as the rAF path. */
function installQaClock(): void {
  let engaged = false;
  const clock: QaClock = {
    step(frames: number): number {
      if (!engaged) { engaged = true; engageSimTimers(); }   // the window timers join the sim from the first step
      for (let i = 0; i < frames; i++) advance(FIXED_DT);
      return app.time.sim;
    },
    frames: () => app.time.frame,
    simMs: () => app.time.sim * 1000,
  };
  (window as unknown as { __qaClock?: QaClock }).__qaClock = clock;
}

function startWorker(): void {
  if (worker || typeof Worker === 'undefined') return;
  try {
    workerUrl = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${BG_TICK_MS})`], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.onmessage = () => { if (running && document.hidden) backgroundTick(); };
    last = performance.now();
    log.debug('loop', 'background ticker on');
  } catch (e) {
    log.warn('loop', 'background ticker unavailable', e);
    worker = null;
  }
}
function stopWorker(): void {
  worker?.terminate();
  worker = null;
  if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
}
/** Hidden tab + online session ⇒ keep the room alive with the worker; otherwise rAF drives everything. */
function syncBackground(): void {
  if (document.hidden && app.net.online) startWorker();
  else { stopWorker(); last = performance.now(); }
}

/** Start the loop. Returns a stop function. Call after `createApp()`. */
export function startLoop(): () => void {
  if (running) return () => {};
  running = true;
  last = performance.now();
  acc = 0;
  if (MANUAL_CLOCK) installQaClock();
  else raf = requestAnimationFrame(frame);           // manual mode: the page steps only through window.__qaClock

  const onVis = (): void => syncBackground();
  const onHide = (): void => app.save.flush();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  offs.push(() => document.removeEventListener('visibilitychange', onVis));
  offs.push(() => window.removeEventListener('pagehide', onHide));
  offs.push(bus.on('net:status', () => syncBackground()));

  return () => {
    running = false;
    cancelAnimationFrame(raf);
    stopWorker();
    for (const o of offs.splice(0)) o();
  };
}
