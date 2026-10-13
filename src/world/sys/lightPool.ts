/**
 * Light pool (WORLD-SYS). TECH_SPEC §5.5 / ART_BIBLE §1.7: the level and the machines register any number of light
 * SOURCES (up to ~128: sconces, marquee glows, CRT spill, a machine's `anchors.light`), but the renderer only ever
 * sees `POOL_SIZE` real `PointLight`s whose count never changes (the count is part of the shader key). Every
 * `REASSIGN_S` seconds the pool re-targets the best-scoring sources around the camera; a light that changes its
 * source fades out at the old spot and in at the new one, so nothing pops.
 *
 * On top of the pool this file implements the `WorldLights` facade used by cutscenes, events and big-win shows:
 * `setLevel` (persistent dimming / colour grade), `flicker`, `pulse`, `strobe` and `setDread`, all as small envelopes on
 * the sources (selected by zone id, instance id or "near this object"). Flicker profiles are ART_BIBLE §1.7, evaluated
 * at 30 Hz. "Reduce flashing" turns strobes into one soft pulse and shrinks every flicker amplitude to 25 %.
 */
import * as THREE from 'three';
import type { Hex, InstanceId, Vec3Like, ZoneId } from '@/core/types';
import type { Rng } from '@/core/rng';
import { clamp01, damp, lerp, TAU } from '@/core/math';
import { ease } from '@/core/tween';
import type { WorldLights, WorldLightTarget } from '../types';
import type { FlickerId } from './arch';

export const POOL_SIZE = 6;
/** Global brightness trim for the PSX shader (tuned by eye; one place). */
export const LIGHT_GAIN = 1;
const DECAY = 1.5;
const REASSIGN_S = 0.5;
const FLICKER_STEP = 1 / 30;
const FADE_RATE = 9;
const COLD = new THREE.Color(0x7aa0ff);
const NEAR_OBJECT_M = 6;

export interface LightSourceInit {
  id: string;
  pos: Vec3Like;
  color: Hex;
  /** Default 1.2. */
  intensity?: number;
  /** Default 8 m. */
  range?: number;
  flicker?: FlickerId;
  zone?: ZoneId | null;
  owner?: InstanceId | null;
}

class Hint {
  readonly pos = new THREE.Vector3();
  readonly color = new THREE.Color();
  readonly base: number;
  readonly range: number;
  readonly flicker: FlickerId;
  readonly zone: ZoneId | null;
  readonly owner: InstanceId | null;
  readonly phase: number;
  // persistent state
  level = 1;
  readonly tint = new THREE.Color();
  tintAmt = 0;
  // per-frame accumulators written by transient effects
  fxMul = 1;
  readonly fxCol = new THREE.Color();
  fxColAmt = 0;
  // flicker profile state (30 Hz)
  value = 1;
  private dyingNext = 0;
  private dyingBursts: number[] = [];
  removed = false;

  constructor(readonly id: string, init: LightSourceInit, phase: number) {
    this.pos.set(init.pos.x, init.pos.y, init.pos.z);
    this.color.setHex(init.color);
    this.base = init.intensity ?? 1.2;
    this.range = init.range ?? 8;
    this.flicker = init.flicker ?? 'STEADY';
    this.zone = init.zone ?? null;
    this.owner = init.owner ?? null;
    this.phase = phase;
  }

  /** ART_BIBLE §1.7 profile value at time `t`. */
  evaluate(t: number, rng: Rng, ringing: boolean, reduced: boolean): number {
    let v = 1;
    switch (this.flicker) {
      case 'BUZZ': v = 1 + 0.04 * Math.sin(TAU * 47 * t) + rng.float(-0.02, 0.02); break;
      case 'CANDLE': v = 0.85 + 0.15 * vnoise(t * 6 + this.phase * 10); break;
      case 'SICK': v = 0.6 + 0.4 * Math.pow(Math.max(0, Math.sin(TAU * 0.7 * t + this.phase)), 3); break;
      case 'STROBE': v = Math.sin(TAU * (reduced ? 3 : 6) * t + this.phase) >= 0 ? 1 : 0.1; break;
      case 'CHASE': v = 0.6 + 0.4 * (Math.sin(TAU * 2.5 * t + this.phase * TAU) >= 0 ? 1 : 0); break;
      case 'RING': v = ringing ? (Math.sin(TAU * 2 * t) >= 0 ? 1.15 : 0.25) : 1; break;
      case 'DYING': v = this.dying(t, rng); break;
      default: break;
    }
    if (reduced && v !== 1) v = Math.max(1 + (v - 1) * 0.25, this.flicker === 'DYING' ? 0.6 : 0);
    return v;
  }

  private dying(t: number, rng: Rng): number {
    if (this.dyingBursts.length === 0 && t >= this.dyingNext) {
      // 1–4 blackouts of 40–120 ms separated by 30–90 ms, then 2–9 s of calm
      let at = t;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const len = rng.float(0.04, 0.12);
        this.dyingBursts.push(at, at + len);
        at += len + rng.float(0.03, 0.09);
      }
      this.dyingNext = at + rng.float(2, 9);
    }
    for (let i = 0; i < this.dyingBursts.length; i += 2) {
      if (t >= this.dyingBursts[i] && t < this.dyingBursts[i + 1]) return 0.08;
    }
    while (this.dyingBursts.length && t >= this.dyingBursts[1]) this.dyingBursts.splice(0, 2);
    return 1;
  }
}

/** Smooth 1-D value noise in [0, 1]. */
function vnoise(x: number): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  return h(i) * (1 - u) + h(i + 1) * u;
}

interface Effect { hints: Hint[]; t: number; dur: number; run(e: Effect, k: number): void; done?(): void }

interface PoolSlot {
  light: THREE.PointLight;
  hint: Hint | null;      // what the light shows right now
  want: Hint | null;      // what it should show (a change fades out, swaps, fades in)
  fade: number;
}

export interface LightPoolOpts {
  parent: THREE.Object3D;
  rng: Rng;
  /** Accessibility: reduced flicker / no strobes. */
  reduced(): boolean;
  /** The Hotline phone is ringing (RING profile). */
  ringing(): boolean;
  /** Does a zone with this id exist? (selector resolution) */
  hasZone(id: string): boolean;
}

export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  readonly api: WorldLights;
  /** 0..1+ multiplier for `setLevel('all')` (ambient and fog follow it in the world). */
  globalLevel = 1;
  /** Smoothed horror grade 0..1. */
  dread = 0;

  private readonly slots: PoolSlot[] = [];
  private readonly hints = new Set<Hint>();
  private effects: Effect[] = [];
  private dreadTarget = 0;
  private clock = 0;
  private reassign = 0;
  private flickerAcc = 0;
  private serial = 0;
  private readonly tmp = new THREE.Color();
  private readonly cam = new THREE.Vector3();
  private readonly scoredBuf: Array<{ h: Hint; s: number }> = [];
  private readonly curSet = new Set<Hint>();
  private readonly desiredBuf: Hint[] = [];
  private readonly wantedSet = new Set<Hint>();
  private readonly placedSet = new Set<Hint>();

  constructor(private readonly o: LightPoolOpts) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffe2a0, 0, 8, DECAY);
      light.name = `pool:${i}`;
      o.parent.add(light);
      this.lights.push(light);
      this.slots.push({ light, hint: null, want: null, fade: 0 });
    }
    this.api = this.makeApi();
  }

  get size(): number { return this.hints.size; }

  /** Register a source. Returns the function that removes it. */
  add(init: LightSourceInit): () => void {
    const h = new Hint(init.id, init, (this.serial++ * 0.6180339887) % 1);
    this.hints.add(h);
    return () => this.drop(h);
  }

  private drop(h: Hint): void {
    h.removed = true;
    this.hints.delete(h);
    for (const s of this.slots) if (s.want === h) s.want = null;
  }

  // ── per-frame ─────────────────────────────────────────────────────────────────────────────────
  update(dt: number, camPos: THREE.Vector3): void {
    this.clock += dt;
    this.cam.copy(camPos);
    this.dread = damp(this.dread, this.dreadTarget, 3, dt);
    const reduced = this.o.reduced();

    // 30 Hz flicker evaluation
    this.flickerAcc += dt;
    if (this.flickerAcc >= FLICKER_STEP) {
      this.flickerAcc %= FLICKER_STEP;
      const ringing = this.o.ringing();
      const dread = this.dread;
      let n = 0;
      for (const h of this.hints) {
        let v = h.evaluate(this.clock, this.o.rng, ringing, reduced);
        if (dread > 0.02) {
          // horror grade: every third source stutters hard, the rest only nervously
          const amp = dread * (n % 3 === 0 ? 0.35 : 0.08);
          v *= 1 - amp * Math.max(0, vnoise(this.clock * 9 + n * 3.1) - 0.45) * 2;
        }
        h.value = v;
        n++;
      }
    }

    // transient effects write the per-frame accumulators
    for (const h of this.hints) { h.fxMul = 1; h.fxColAmt = 0; }
    if (this.effects.length) {
      const alive: Effect[] = [];
      for (const e of this.effects) {
        e.t += dt;
        const k = e.dur > 0 ? clamp01(e.t / e.dur) : 1;
        e.run(e, k);
        if (e.t >= e.dur) e.done?.();
        else alive.push(e);
      }
      this.effects = alive;
    }

    this.reassign -= dt;
    if (this.reassign <= 0) { this.reassign = REASSIGN_S; this.select(); }
    this.apply(dt);
  }

  /** Pick the best `POOL_SIZE` sources around the camera and hand them to the lights. */
  private select(): void {
    // scratch buffers are reused (select runs every 0.5 s; no per-call allocation churn)
    const scored = this.scoredBuf;
    scored.length = 0;
    const cur = this.curSet;
    cur.clear();
    for (const s of this.slots) if (s.want) cur.add(s.want);
    for (const h of this.hints) {
      const reach = h.range + 4;   // beyond this a fixture is emissive only (no pool light)
      const d = h.pos.distanceTo(this.cam);
      if (d > reach) continue;
      const s = h.base * Math.max(0.05, h.level) * (1 - d / reach) * (cur.has(h) ? 1.25 : 1);
      scored.push({ h, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const desired = this.desiredBuf;
    desired.length = 0;
    for (let i = 0; i < scored.length && i < POOL_SIZE; i++) desired.push(scored[i].h);
    const wanted = this.wantedSet;
    wanted.clear();
    for (const h of desired) wanted.add(h);
    const placed = this.placedSet;
    placed.clear();
    for (const s of this.slots) {
      if (s.want && wanted.has(s.want)) placed.add(s.want);
      else s.want = null;
    }
    for (const h of desired) {
      if (placed.has(h)) continue;
      const free = this.slots.find((s) => s.want === null && s.hint === null) ?? this.slots.find((s) => s.want === null);
      if (free) { free.want = h; placed.add(h); }
    }
  }

  private apply(dt: number): void {
    const gl = this.globalLevel;
    const dread = this.dread;
    const dreadMul = lerp(1, 0.6, dread);
    for (const s of this.slots) {
      if (s.want !== s.hint) {
        s.fade = damp(s.fade, 0, FADE_RATE, dt);
        if (s.fade < 0.03) {
          s.hint = s.want;
          s.fade = 0;
          if (s.hint) {
            s.light.position.copy(s.hint.pos);
            s.light.distance = s.hint.range;
          }
        }
      } else if (s.hint) s.fade = damp(s.fade, 1, FADE_RATE, dt);
      const h = s.hint;
      if (!h || h.removed || s.fade < 0.004) { s.light.intensity = 0; continue; }
      const k = h.base * LIGHT_GAIN * h.level * gl * h.fxMul * h.value * dreadMul * s.fade;
      s.light.intensity = Math.max(0, k);
      const c = this.tmp.copy(h.color);
      if (h.tintAmt > 0) c.lerp(h.tint, h.tintAmt);
      if (h.fxColAmt > 0) c.lerp(h.fxCol, h.fxColAmt);
      if (dread > 0.01) c.lerp(COLD, dread * 0.3);
      s.light.color.copy(c);
    }
  }

  /** Approximate brightness 0..1 at a point from the live pool plus an ambient floor. */
  levelAt(p: Vec3Like, ambient = 0.12): number {
    let sum = ambient;
    for (const s of this.slots) {
      const l = s.light;
      if (l.intensity <= 0.001) continue;
      const d = Math.hypot(l.position.x - p.x, l.position.y - p.y, l.position.z - p.z);
      if (d >= l.distance) continue;
      const lum = 0.3 * l.color.r + 0.59 * l.color.g + 0.11 * l.color.b;
      sum += l.intensity * lum * Math.pow(Math.max(d, 0.7), -DECAY) * (1 - d / l.distance);
    }
    return clamp01(sum);
  }

  // ── facade ────────────────────────────────────────────────────────────────────────────────────
  private targetHints(target: WorldLightTarget): Hint[] {
    const out: Hint[] = [];
    if (target === 'all') { for (const h of this.hints) out.push(h); return out; }
    if (typeof target === 'string') {
      if (this.o.hasZone(target)) { for (const h of this.hints) if (h.zone === target) out.push(h); }
      else for (const h of this.hints) if (h.owner === target) out.push(h);
      return out;
    }
    const at = target.getWorldPosition(new THREE.Vector3());
    for (const h of this.hints) if (h.pos.distanceTo(at) <= NEAR_OBJECT_M) out.push(h);
    return out;
  }

  private makeApi(): WorldLights {
    const pool = this;
    const api: WorldLights = {
      setLevel(target, level, dur = 0, color = null) {
        const hints = pool.targetHints(target);
        const grade = color === null || color === undefined ? null : new THREE.Color(color);
        if (target === 'all') pool.startGlobal(level, dur);
        if (hints.length === 0) return;
        const from = hints.map((h) => h.level);
        const fromAmt = hints.map((h) => h.tintAmt);
        const fromTint = hints.map((h) => h.tint.clone());
        if (grade) for (const h of hints) { if (h.tintAmt < 0.01) h.tint.copy(h.color); }
        const e: Effect = {
          hints, t: 0, dur,
          run(_e, k) {
            const kk = dur > 0 ? ease.inOutQuad(k) : 1;
            for (let i = 0; i < hints.length; i++) {
              const h = hints[i];
              h.level = lerp(from[i], level, kk);
              if (grade) {
                h.tint.copy(fromTint[i]).lerp(grade, kk);
                h.tintAmt = lerp(fromAmt[i], 0.75, kk);
              }
            }
          },
        };
        if (dur <= 0) e.run(e, 1); else pool.effects.push(e);
      },
      flicker(target, amount, dur) {
        const hints = pool.targetHints(target);
        if (hints.length === 0 || dur <= 0) return;
        const seed = pool.serial++;
        const amp = clamp01(pool.o.reduced() ? amount * 0.25 : amount);
        pool.effects.push({
          hints, t: 0, dur,
          run(_e, k) {
            const fade = 1 - k;
            for (let i = 0; i < hints.length; i++) {
              const n = vnoise(pool.clock * 14 + i * 5.3 + seed);
              hints[i].fxMul *= 1 - amp * fade * Math.max(0, n - 0.5) * 2.2;
            }
          },
        });
      },
      pulse(target, o = {}) {
        const hints = pool.targetHints(target);
        if (hints.length === 0) return;
        const mul = o.mul ?? 1.8, dur = o.dur ?? 0.6;
        const col = o.color !== undefined ? new THREE.Color(o.color) : null;
        const peak = pool.o.reduced() ? 1 + (mul - 1) * 0.35 : mul;
        pool.effects.push({
          hints, t: 0, dur,
          run(_e, k) {
            const env = k < 0.1 ? k / 0.1 : 1 - ease.outQuad((k - 0.1) / 0.9);
            for (const h of hints) {
              h.fxMul *= 1 + (peak - 1) * env;
              if (col) { h.fxCol.copy(col); h.fxColAmt = Math.max(h.fxColAmt, 0.8 * env); }
            }
          },
        });
      },
      strobe(target, hz, dur, color) {
        const hints = pool.targetHints(target);
        if (hints.length === 0 || dur <= 0) return;
        if (pool.o.reduced()) { api.pulse(target, { mul: 1.3, dur: Math.min(dur, 0.8), color }); return; }
        const col = color !== undefined ? new THREE.Color(color) : null;
        pool.effects.push({
          hints, t: 0, dur,
          run(e, k) {
            const on = Math.floor(e.t * hz * 2) % 2 === 0;
            const edge = Math.min(1, (1 - k) * dur * 4);       // the last 0.25 s settle back to normal
            for (const h of hints) {
              h.fxMul *= lerp(1, on ? 2.2 : 0.06, edge);
              if (col && on) { h.fxCol.copy(col); h.fxColAmt = Math.max(h.fxColAmt, 0.85 * edge); }
            }
          },
        });
      },
      setDread(v) { pool.dreadTarget = clamp01(v); },
      reset() {
        pool.effects.length = 0;
        pool.globalLevel = 1;
        pool.dreadTarget = 0;
        for (const h of pool.hints) { h.level = 1; h.tintAmt = 0; h.fxMul = 1; h.fxColAmt = 0; }
      },
    };
    return api;
  }

  private startGlobal(level: number, dur: number): void {
    if (dur <= 0) { this.globalLevel = level; return; }
    const from = this.globalLevel;
    this.effects.push({ hints: [], t: 0, dur, run: (_e, k) => { this.globalLevel = lerp(from, level, ease.inOutQuad(k)); } });
  }

  dispose(): void {
    this.effects.length = 0;
    this.hints.clear();
    for (const s of this.slots) { s.light.removeFromParent(); s.light.dispose(); }
    this.slots.length = 0;
    this.lights.length = 0;
  }
}
