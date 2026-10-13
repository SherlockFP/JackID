/**
 * Tween system (TD-owned). Contract: TECH_SPEC §2.9.
 *
 * Two instances live on the app: `app.tweens.sim` (advanced only in fixed steps, freezes with SP pause and
 * hit-stop — ALL gameplay animation) and `app.tweens.ui` (real time, never paused — menus/HUD).
 * Promises resolve when the tween finishes OR is cancelled, so awaiting code never deadlocks; check your
 * own disposed flag after an `await` if the owner can disappear mid-animation.
 */
import * as THREE from 'three';
import { log } from './log';

export type Ease = 'linear' | 'inQuad' | 'outQuad' | 'inOutQuad' | 'inCubic' | 'outCubic' | 'inOutCubic'
  | 'outBack' | 'outElastic' | 'outBounce' | 'inExpo' | 'outExpo';
export interface TweenOpts { ease?: Ease; delay?: number; stepFps?: number /* PSX stepped anim, e.g. 15 */; onDone?: () => void }
export interface TweenHandle { readonly promise: Promise<void>; readonly done: boolean; cancel(): void }

export interface TweenSystem {
  run(dur: number, fn: (k: number) => void, o?: TweenOpts): TweenHandle;   // k: eased 0..1
  to<T extends object>(target: T, props: { [P in keyof T]?: number }, dur: number, o?: TweenOpts): TweenHandle;
  vec3(v: THREE.Vector3, to: THREE.Vector3, dur: number, o?: TweenOpts): TweenHandle;
  shake(obj: THREE.Object3D, amp: number, dur: number): TweenHandle;       // position jitter, restores
  punch(obj: THREE.Object3D, amount: number, dur: number): TweenHandle;    // scale punch, restores
  spin(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', radians: number, dur: number, o?: TweenOpts): TweenHandle;
  /** Volume-preserving squash & stretch (amount > 0 stretches along Y, < 0 squashes); restores scale. */
  squash(obj: THREE.Object3D, amount: number, dur: number, o?: TweenOpts): TweenHandle;
  killOf(target: object): void;
  /** Cancel everything (state exit). */
  clear(): void;
  update(dt: number): void;
}

const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
const bounceOut = (x: number): number => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
export const ease: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  inQuad: (k) => k * k,
  outQuad: (k) => 1 - (1 - k) * (1 - k),
  inOutQuad: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  inCubic: (k) => k * k * k,
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k) => 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2),
  outElastic: (k) => (k === 0 ? 0 : k === 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * c4) + 1),
  outBounce: bounceOut,
  inExpo: (k) => (k === 0 ? 0 : Math.pow(2, 10 * k - 10)),
  outExpo: (k) => (k === 1 ? 1 : 1 - Math.pow(2, -10 * k)),
};

/** Cheap cosmetic jitter in [−1, 1] (xorshift32) — keeps `Math.random` out of the core. */
let nz = 0x9e3779b9;
function noise(): number {
  nz ^= nz << 13; nz ^= nz >>> 17; nz ^= nz << 5;
  return ((nz >>> 0) / 4294967296) * 2 - 1;
}

interface Item {
  elapsed: number; dur: number; delay: number;
  easeFn: (k: number) => number; stepFps: number;
  fn: (k: number) => void; onDone?: () => void;
  owner: object | null; done: boolean; resolve: () => void;
  /** Called once on cancel/finish to restore transient state (shake/punch/squash). */
  cleanup?: () => void;
}

class Tweens implements TweenSystem {
  private items: Item[] = [];

  private add(dur: number, fn: (k: number) => void, o: TweenOpts | undefined, owner: object | null, cleanup?: () => void): TweenHandle {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    const it: Item = {
      elapsed: 0, dur: Math.max(0, dur), delay: o?.delay ?? 0,
      easeFn: ease[o?.ease ?? 'linear'] ?? ease.linear,
      stepFps: o?.stepFps ?? 0, fn, onDone: o?.onDone, owner, done: false, resolve, cleanup,
    };
    this.items.push(it);
    const finish = (completed: boolean): void => this.finish(it, completed);
    return {
      promise,
      get done() { return it.done; },
      cancel() { finish(false); },
    };
  }

  private finish(it: Item, completed: boolean): void {
    if (it.done) return;
    it.done = true;
    if (completed) { try { it.fn(1); } catch (e) { log.error('tween', e); } }
    try { it.cleanup?.(); } catch (e) { log.error('tween', e); }
    if (completed) { try { it.onDone?.(); } catch (e) { log.error('tween', e); } }
    it.resolve();
  }

  run(dur: number, fn: (k: number) => void, o?: TweenOpts): TweenHandle {
    return this.add(dur, fn, o, null);
  }

  to<T extends object>(target: T, props: { [P in keyof T]?: number }, dur: number, o?: TweenOpts): TweenHandle {
    const keys = Object.keys(props) as Array<keyof T>;
    let from: number[] | null = null;
    return this.add(dur, (k) => {
      if (!from) from = keys.map((key) => target[key] as unknown as number);
      for (let i = 0; i < keys.length; i++) {
        const a = from[i], b = props[keys[i]] as number;
        (target as Record<keyof T, number>)[keys[i]] = a + (b - a) * k;
      }
    }, o, target);
  }

  vec3(v: THREE.Vector3, to: THREE.Vector3, dur: number, o?: TweenOpts): TweenHandle {
    const from = v.clone(), dest = to.clone();
    return this.add(dur, (k) => { v.lerpVectors(from, dest, k); }, o, v);
  }

  shake(obj: THREE.Object3D, amp: number, dur: number): TweenHandle {
    this.killOf(obj);
    const base = obj.position.clone();
    return this.add(dur, (k) => {
      const a = amp * (1 - k) * (1 - k);
      obj.position.set(base.x + noise() * a, base.y + noise() * a, base.z + noise() * a);
    }, undefined, obj, () => { obj.position.copy(base); });
  }

  punch(obj: THREE.Object3D, amount: number, dur: number): TweenHandle {
    this.killOf(obj);
    const base = obj.scale.clone();
    return this.add(dur, (k) => {
      const s = 1 + amount * Math.sin(k * Math.PI) * (1 - k);
      obj.scale.copy(base).multiplyScalar(s);
    }, { ease: 'linear' }, obj, () => { obj.scale.copy(base); });
  }

  spin(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', radians: number, dur: number, o?: TweenOpts): TweenHandle {
    let start = 0;
    let first = true;
    return this.add(dur, (k) => {
      if (first) { start = obj.rotation[axis]; first = false; }
      obj.rotation[axis] = start + radians * k;
    }, o, obj);
  }

  squash(obj: THREE.Object3D, amount: number, dur: number, o?: TweenOpts): TweenHandle {
    this.killOf(obj);
    const base = obj.scale.clone();
    return this.add(dur, (k) => {
      const s = amount * Math.sin(k * Math.PI) * (1 - k * 0.5);
      const sy = 1 + s, sxz = 1 / Math.sqrt(Math.max(0.05, sy));
      obj.scale.set(base.x * sxz, base.y * sy, base.z * sxz);
    }, { ease: 'linear', ...o }, obj, () => { obj.scale.copy(base); });
  }

  killOf(target: object): void {
    for (const it of [...this.items]) if (it.owner === target) this.finish(it, false);
    this.items = this.items.filter((i) => !i.done);
  }

  clear(): void {
    for (const it of [...this.items]) this.finish(it, false);
    this.items.length = 0;
  }

  update(dt: number): void {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.done) continue;
      let step = dt;
      if (it.delay > 0) {
        it.delay -= dt;
        if (it.delay > 0) continue;
        step = -it.delay; it.delay = 0;        // carry the overshoot into this tween only
      }
      it.elapsed += step;
      if (it.elapsed >= it.dur) { this.finish(it, true); continue; }
      let t = it.elapsed;
      if (it.stepFps > 0) t = Math.floor(t * it.stepFps) / it.stepFps;
      try { it.fn(it.easeFn(t / it.dur)); } catch (e) { log.error('tween', e); this.finish(it, false); }
    }
    let w = 0;
    for (let r = 0; r < items.length; r++) if (!items[r].done) items[w++] = items[r];
    items.length = w;
  }
}

export function createTweenSystem(): TweenSystem {
  return new Tweens();
}
