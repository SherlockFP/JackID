/**
 * Kit animation driver. Every animated kit part (buttons, levers, reels, chips, cards, dice, dealers, bulbs…)
 * is advanced by ONE `Anim.update(dt)` that `Kit.update` calls once per frame with sim-scaled time
 * (0 while the sim is paused, slowed by slow-mo, frozen by hit-stop). The kit therefore never touches the
 * `app` singleton and works the same in the game, the menu and the bench.
 *
 *  - `run()` is a promise tween: it ALWAYS advances (machine logic awaits it even when the machine is far
 *    away), resolves when finished OR cancelled, and never throws.
 *  - `tick()` is a free-running decorative ticker (chaser bulbs, flicker, idle sway). It only runs while its
 *    owner is attached to a scene and visible, and it dies with the owner (WeakRef) — no explicit dispose.
 */
import type * as THREE from 'three';
import { ease as EASE, type Ease } from '@/core/tween';
import { log } from '@/core/log';

export interface RunOpts {
  ease?: Ease;
  delay?: number;
  /** Cancelling an owner resolves its running tweens without the final `fn(1)` call. */
  owner?: object;
  /** PSX stepped animation (e.g. 15) — quantises time. */
  stepFps?: number;
}
interface Tw {
  t: number; dur: number; delay: number; step: number;
  fn: (k: number) => void; ease: (k: number) => number;
  owner: object | null; resolve: () => void; done: boolean;
}
interface Tick { ref: WeakRef<THREE.Object3D>; fn: (dt: number, time: number) => void; dead: boolean; always: boolean }

/** True when `o` is in a scene graph and no ancestor is hidden. */
export function isLive(o: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if (!n.parent) return (n as THREE.Scene).isScene === true;
    n = n.parent;
  }
  return false;
}

export class Anim {
  /** Accumulated (scaled) seconds — the clock decorative patterns are computed from. */
  time = 0;
  private tw: Tw[] = [];
  private ticks: Tick[] = [];

  /** Tween `fn(k)` over `dur` seconds (k eased 0..1). Resolves on finish or cancel. */
  run(dur: number, fn: (k: number) => void, o?: RunOpts): Promise<void> {
    if (dur <= 0 && !o?.delay) { this.safe(fn, 1); return Promise.resolve(); }
    let resolve!: () => void;
    const p = new Promise<void>((r) => { resolve = r; });
    if (o?.owner) this.cancel(o.owner);
    this.tw.push({
      t: 0, dur: Math.max(1e-4, dur), delay: o?.delay ?? 0, step: o?.stepFps ?? 0,
      fn, ease: EASE[o?.ease ?? 'linear'] ?? EASE.linear, owner: o?.owner ?? null, resolve, done: false,
    });
    return p;
  }

  /** Cancel (and resolve) every tween of `owner`. */
  cancel(owner: object): void {
    for (const w of this.tw) if (w.owner === owner && !w.done) { w.done = true; w.resolve(); }
  }

  /** Free-running ticker bound to `owner`'s lifetime; returns a stop function. */
  tick(owner: THREE.Object3D, fn: (dt: number, time: number) => void, o?: { always?: boolean }): () => void {
    const t: Tick = { ref: new WeakRef(owner), fn, dead: false, always: o?.always ?? false };
    this.ticks.push(t);
    return () => { t.dead = true; };
  }

  update(dt: number): void {
    this.time += dt;
    const tw = this.tw;
    for (let i = 0; i < tw.length; i++) {
      const w = tw[i];
      if (w.done) continue;
      let step = dt;
      if (w.delay > 0) {
        w.delay -= dt;
        if (w.delay > 0) continue;
        step = -w.delay; w.delay = 0;
      }
      if (dt <= 0) continue;
      w.t += step;
      if (w.t >= w.dur) { w.done = true; this.safe(w.fn, 1); w.resolve(); continue; }
      let t = w.t;
      if (w.step > 0) t = Math.floor(t * w.step) / w.step;
      this.safe(w.fn, w.ease(t / w.dur));
    }
    let n = 0;
    for (let i = 0; i < tw.length; i++) if (!tw[i].done) tw[n++] = tw[i];
    tw.length = n;

    const ks = this.ticks;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k.dead) continue;
      const o = k.ref.deref();
      if (!o) { k.dead = true; continue; }
      if (!k.always && !isLive(o)) continue;
      try { k.fn(dt, this.time); } catch (e) { log.error('kit', e); k.dead = true; }
    }
    n = 0;
    for (let i = 0; i < ks.length; i++) if (!ks[i].dead) ks[n++] = ks[i];
    ks.length = n;
  }

  private safe(fn: (k: number) => void, k: number): void {
    try { fn(k); } catch (e) { log.error('kit', e); }
  }
}
