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

let raf = 0;
let last = 0;
let acc = 0;
let running = false;
let worker: Worker | null = null;
let workerUrl: string | null = null;
const offs: Array<() => void> = [];

/** One fixed simulation step (shared by the rAF frame and the background ticker). */
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

function frame(nowMs: number): void {
  raf = requestAnimationFrame(frame);
  const a = app;
  const dt = Math.min((nowMs - last) / 1000, MAX_FRAME_DT);
  last = nowMs;
  a.time.real += dt; a.time.frame++;
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

/** Background tick: simulate only, no rendering. */
function backgroundTick(): void {
  const a = app;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, BG_MAX_DT);
  last = now;
  a.time.real += dt;
  acc += dt;
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS) { simStep(); acc -= FIXED_DT; steps++; }
  if (steps === MAX_STEPS) acc = 0;
  a.timers.ui.update(dt); a.tweens.ui.update(dt);
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
  raf = requestAnimationFrame(frame);

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
