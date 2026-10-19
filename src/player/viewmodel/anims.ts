/**
 * One-shot hand animations (PLAYER): flip · drink · eat · throw · point · punchCard · recoil · give · grab · checkWatch · unwatch ·
 * rpsRock · rpsPaper · rpsScissors. Each is a function of `k` (0..1 of its length, advanced on sim time) that ADDS to the
 * hands' poses (the grip and the walking layers are already in them) and sets what the held item does (`AnimFx`). Most also lay a
 * rig clip over one arm (`clip`: `grab.R`, `push.R`, `finger_gun_*`), slaved to `k` and blended with the animation's fade; the poses
 * here are what the clip does not do (a lift to the mouth, the watch, rock paper scissors on the finger bones). The viewmodel
 * blends every run in and out (`fade`) and cross-fades an interrupted one, so none of them pops at its start or its end.
 *
 * Motion rules used throughout: ease-in-out on every move (`smooth`), an anticipation before a strike, a little overshoot and
 * settle after it (`ring`, `outBack`), the fingers lagging the wrist. Amplitudes are authored for full motion; the facade scales
 * the whole result in Calm.
 */
import { clamp, lerp } from '@/core/math';
import type { HandPose } from './arms';
import { gripOf, type Grip } from './items';

export interface AnimFx {
  coinY: number; coinSpin: number;
  /** 0..1: the held coin (it is gone while thrown, or while the hand is busy grabbing). */
  coinScale: number;
  watchLift: number;
  /** 0..1: how much of a bitten food is gone. */
  itemEat: number;
  /** 0..1: the held item is stowed (the food has been swallowed, the cup put away): it shrinks to nothing. */
  itemFade: number;
  /** Added to the whole rig (m): the view nods with a bite. */
  rigY: number;
  /** Turn of the left forearm bone about its own axis (rad): the wrist turns to show the watch. */
  forearmRoll: number;
}
export const newFx = (): AnimFx => ({ coinY: 0, coinSpin: 0, coinScale: 1, watchLift: 0, itemEat: 0, itemFade: 0, rigY: 0, forearmRoll: 0 });

export interface AnimCtx { item: string }
/**
 * Clips an animation lays over the arms (`r` / `l`), at phase `at(k)` of the clip (default `k`: the whole clip over the animation),
 * weighted `w(k)` (default 1) on top of the animation's fade. A lift holds one frame of the clip and lets the weight carry the hand up.
 */
export interface AnimClip { r?: string; l?: string; at?: (k: number) => number; w?: (k: number) => number }
export interface Anim {
  dur: number;
  clip?: AnimClip;
  /** Seconds the pose is blended in and out (default 0.1 / 0.2). */
  fade?: readonly [number, number];
  /** The promise resolves at this fraction of `dur`; the tail still plays (the game swaps the held item then). Default 1. */
  done?: number;
  run(k: number, r: HandPose, l: HandPose, fx: AnimFx, c: AnimCtx): void;
}

// ── curves ────────────────────────────────────────────────────────────────────────────────────────
export const smooth = (k: number): number => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); };
/** Rises over [a,b], holds, falls over [c,d]. */
export const bump = (k: number, a: number, b: number, c: number, d: number): number => smooth((k - a) / (b - a)) * (1 - smooth((k - c) / (d - c)));
/** 0 → 1 over [a,b] with an overshoot (about 10 %) that settles. */
export const outBack = (k: number, a: number, b: number): number => {
  const t = clamp((k - a) / (b - a), 0, 1) - 1;
  return 1 + 2.7 * t * t * t + 1.7 * t * t;
};
/** A damped ring that starts at `a`: the follow-through after a strike (amplitude 1, `f` rad per unit k, decay `z`). */
export const ring = (k: number, a: number, f: number, z: number): number => (k < a ? 0 : Math.exp(-z * (k - a)) * Math.sin(f * (k - a)));

// ── animations ────────────────────────────────────────────────────────────────────────────────────
/** One bite at `at`: a quick dip (0..1..0 over `w`) the hand and the view nod with. */
const biteAt = (k: number, at: number, w = 0.07): number => bump(k, at - w * 0.4, at + w * 0.1, at + w * 0.2, at + w * 1.2);

/** The pose offsets of `g`'s lift, `tip` (0..1) of the way from held upright at the mouth to tipped into it, scaled by `lift`. */
function liftPose(r: HandPose, g: Grip, lift: number, tip: number): void {
  const L = g.lift;
  if (!L) return;
  const T = g.tipped ?? L;
  for (const key of LIFT_KEYS) r[key] += lerp(L[key] ?? 0, T[key] ?? 0, tip) * lift * LIFT_K;
}
const LIFT_KEYS = ['px', 'py', 'pz', 'rx', 'ry', 'rz'] as const;
/** `grab.R` at this phase has the hand raised in front of the face; the grips' own lift is a fraction on top of it (it was solved for the bare hand). */
const GRAB_UP = 0.5, LIFT_K = 0.35;
const grabUp = (a: number, b: number, c: number, d: number): AnimClip => ({ r: 'grab.R', at: () => GRAB_UP, w: (k) => bump(k, a, b, c, d) });

/** A clip lays a very different pose over the relaxed hand, so it comes in over this long (s): a quicker blend pops. */
const CLIP_FADE = [0.3, 0.3] as const;

export const ANIMS: Record<string, Anim> = {
  /** The coin is flicked up with a spin and caught: a dip first, the flick, a cushion on the catch. */
  flip: {
    dur: 0.62, fade: CLIP_FADE, clip: { r: 'finger_gun_fire' },
    run(k, _r, _l, fx) {
      const u = clamp((k - 0.14) / 0.74, 0, 1);
      fx.coinY = 0.13 * 4 * u * (1 - u);
      fx.coinSpin = u * Math.PI * 6;
    },
  },
  /** A sip: the cup rises, tips to the mouth, a short sip, tips back, is put away. */
  drink: {
    dur: 1.4, done: 0.9, clip: grabUp(0.02, 0.32, 0.72, 0.9),
    run(k, r, _l, fx, c) {
      const lift = bump(k, 0.02, 0.32, 0.72, 0.9), tip = bump(k, 0.28, 0.46, 0.6, 0.72);
      const sip = bump(k, 0.46, 0.5, 0.52, 0.58);
      liftPose(r, gripOf(c.item), lift, tip);
      r.py += 0.006 * sip; r.pz += 0.012 * sip;
      fx.rigY = 0.006 * sip;
      r.py -= 0.006 * ring(k, 0.72, 38, 7);                     // the hand settles after the tip back
      fx.itemFade = smooth((k - 0.82) / 0.16);
    },
  },
  /** Bring the food to the mouth, three bites (the food shrinks, the hand and view nod), swallow, lower. */
  eat: {
    dur: 1.5, done: 0.9, clip: grabUp(0.02, 0.28, 0.8, 0.94),
    run(k, r, _l, fx, c) {
      const lift = bump(k, 0.02, 0.28, 0.8, 0.94);
      liftPose(r, gripOf(c.item), lift, 0);
      r.py += 0.014 * ring(k, 0.28, 34, 8) * lift;                // a little overshoot at the mouth
      const b1 = biteAt(k, 0.38), b2 = biteAt(k, 0.55), b3 = biteAt(k, 0.72);
      const nod = b1 + b2 + b3;
      r.pz += 0.018 * nod; r.rx += 0.07 * nod; r.py -= 0.006 * nod;
      fx.rigY = 0.007 * nod;
      const chew = bump(k, 0.4, 0.45, 0.8, 0.86);
      r.py += 0.0035 * Math.sin(k * 46) * chew;                    // chewing: a quick tremble between bites
      fx.itemEat = smooth((k - 0.34) / 0.1) * 0.34 + smooth((k - 0.51) / 0.1) * 0.33 + smooth((k - 0.68) / 0.1) * 0.33;
      fx.itemFade = smooth((k - 0.78) / 0.12);                     // the last of it goes down
    },
  },
  /** The coin is thrown: wind up, a thrust that lets go of it, follow-through, the hand relaxes and a fresh coin appears. */
  throw: {
    dur: 0.8, done: 0.85, fade: CLIP_FADE, clip: { r: 'push.R' },
    run(k, _r, _l, fx) {
      fx.coinScale = 1 - smooth((k - 0.5) / 0.05) + smooth((k - 0.8) / 0.14);
    },
  },
  point: { dur: 0.95, fade: CLIP_FADE, clip: { r: 'finger_gun_idle', at: (k) => 0.5 * k }, run() {} },
  /** The ticket is pushed into the machine: lean in, press, a rebound. The left hand steadies. */
  punchCard: {
    dur: 0.95, fade: CLIP_FADE, clip: { r: 'push.R' },
    run(k, _r, l) {
      const lean = bump(k, 0.05, 0.3, 0.5, 0.82);
      l.py += 0.02 * lean; l.pz -= 0.02 * lean;
    },
  },
  recoil: {
    dur: 0.5, fade: [0.02, 0.22],
    run(k, r, l) {
      const kick = Math.exp(-k * 8) * smooth(k * 14);
      const wob = ring(k, 0.05, 34, 7) * 0.25;
      r.pz += 0.1 * kick; l.pz += 0.1 * kick; r.rx += 0.3 * kick + wob * 0.2; l.rx += 0.3 * kick + wob * 0.2;
    },
  },
  /** Reach forward and down with an open hand, close the fist on whatever is on the floor, and bring it back. */
  grab: {
    dur: 1.0, fade: CLIP_FADE, clip: { r: 'grab.R' },
    run(k, _r, _l, fx) {
      fx.coinScale = 1 - smooth((k - 0.04) / 0.1) + smooth((k - 0.88) / 0.1);
    },
  },
  /** Look at the watch: the left forearm lifts and turns the wrist to the camera, holds, and lowers. */
  checkWatch: {
    dur: 1.2, fade: [0.1, 0.22],
    run(k, _r, l, fx) {
      const a = bump(k, 0, 0.3, 0.7, 1);
      l.py += 0.03 * a; l.pz += 0.02 * a; l.px -= 0.08 * a; l.rx += 0.25 * a; fx.forearmRoll = -0.9 * a;
      l.rx -= 0.05 * ring(k, 0.3, 30, 6) + 0.02 * Math.sin(k * 11) * bump(k, 0.35, 0.45, 0.6, 0.7);
    },
  },
  /** Left wrist comes up, the right hand pinches the strap open, and the watch lifts off and is gone. */
  unwatch: {
    dur: 1.4, fade: [0.12, 0.24],
    run(k, r, l, fx) {
      const a = bump(k, 0, 0.25, 0.8, 1);
      l.py += 0.03 * a; l.pz += 0.02 * a; l.px -= 0.08 * a; l.rx += 0.25 * a; fx.forearmRoll = -0.9 * a;
      const b = bump(k, 0.1, 0.42, 0.68, 1);
      r.px -= 0.36 * b; r.py += 0.11 * b; r.pz += 0.01 * b; r.rx += 0.2 * b; r.rz += 0.25 * b;
      r.index = lerp(r.index, 0.55, b); r.thumb = lerp(r.thumb, 0.6, b); r.curl = lerp(r.curl, 0.85, b);
      r.rz += 0.06 * Math.sin(k * 40) * bump(k, 0.4, 0.45, 0.6, 0.66);        // fiddling with the buckle
      fx.watchLift = smooth((k - 0.62) / 0.28);
    },
  },
  /** Hold out an open hand, then take it back. */
  give: {
    dur: 0.8,
    run(k, r) {
      const a = bump(k, 0, 0.35, 0.55, 1);
      r.pz -= 0.12 * a; r.py += 0.05 * a; r.rx += 0.3 * a;
      r.curl = lerp(r.curl, 0, a); r.index = lerp(r.index, 0, a); r.thumb = lerp(r.thumb, 0.1, a);
      r.rx += 0.05 * ring(k, 0.35, 26, 6);
    },
  },
  /** Rock, Paper, Promise: draw back, pump the fist twice, then the hand shows with a settle. The three poses share the pump. */
  rpsRock: { dur: 1.1, fade: [0.14, 0.24], run: (k, r) => rpsThrow(k, r, 1.35, 1.3, 0.9, 0, 0) },
  rpsPaper: { dur: 1.1, fade: [0.14, 0.24], run: (k, r) => rpsThrow(k, r, 0.02, 0.02, 0.1, 0, 0) },
  rpsScissors: { dur: 1.1, fade: [0.14, 0.24], run: (k, r) => rpsThrow(k, r, 1.3, 0.02, 0.85, 1.28, 1) },
};

/** The shared pump (k 0..0.55: a draw-back, then two beats), then the finger bones open to `curl`/`index`/`thumb` and hold; `open` straightens the middle finger too. `snip` wags the hand. */
function rpsThrow(k: number, r: HandPose, curl: number, index: number, thumb: number, open: number, snip: number): void {
  const lift = bump(k, 0, 0.14, 0.82, 1);
  const draw = bump(k, 0, 0.07, 0.07, 0.14);                                   // anticipation: the fist dips back
  const beat = k > 0.08 && k < 0.58 ? Math.max(0, Math.sin(((k - 0.08) / 0.5) * Math.PI * 4)) : 0;   // two lifts, each a half sine
  const show = smooth((k - 0.5) / 0.14);
  r.pz -= 0.1 * lift; r.py += 0.02 * lift + 0.025 * beat * lift - 0.012 * draw; r.rx += 0.5 * lift + 0.1 * beat - 0.1 * draw;   // the arm ends at the elbow: do not lift it far
  r.pz += 0.02 * ring(k, 0.5, 34, 6);                                          // the hand lands on its pose
  const fist = lerp(1.3, curl, show), fi = lerp(1.25, index, show), ft = lerp(0.9, thumb, show);
  const f = lift;                                                              // fingers close on the fist as the hand rises
  r.curl = lerp(r.curl, fist, f); r.index = lerp(r.index, fi, f); r.thumb = lerp(r.thumb, ft, f);
  r.middle = lerp(r.middle, -open * show, f);
  if (snip) r.ry += 0.12 * Math.sin(k * 60) * show * bump(k, 0.55, 0.62, 0.85, 0.95);
}
