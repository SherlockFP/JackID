/**
 * Coin fidget (PLAYER): the Q trick layer over the first-person coin. Five tricks cycle on repeated presses (flip-catch,
 * knuckle walk, thumb spin, palm-to-palm toss, vanish and reappear). After ~8 s standing still a short knuckle walk plays
 * on its own. A Q press in walk mode with a coin in hand always starts a trick (also while walking); the idle roll needs
 * the player standing still. An interaction key (E, F, G …: keys that take the hands away) or leaving walk mode fades the
 * trick out. Hand motion is written as additive deltas to the viewmodel poses (`tick`, before `apply`) and the coin's
 * world transform is set afterwards (`place`), so the coin follows the wrist. Everything blends in and out with a smooth
 * weight: no snapping. Amplitude follows settings.headBob and Calm.
 *
 * Presses are latched from the input's own `on()` callbacks (fired when the key is dispatched, in the sim step). The
 * viewmodel is updated once per rendered frame, after the sim steps have ended, and `input.pressed()` only lives inside
 * one step, so polling it here never saw a Q press.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import type { Action } from '@/core/input/types';
import { clamp, lerp } from '@/core/math';
import { createRng, hashSeed } from '@/core/rng';

export interface FidgetPose { px: number; py: number; pz: number; rx: number; ry: number; rz: number; curl: number; index: number; thumb: number }
/** The slice of a viewmodel hand the tricks need (structurally matches the viewmodel's Hand). */
export interface FidgetHand { readonly root: THREE.Object3D; readonly holder: THREE.Object3D; readonly pose: FidgetPose }
export interface Fidget {
  /** True while the trick coin replaces the held coin. */
  readonly busy: boolean;
  /** Before the hand poses are applied: advances the trick state and adds its hand deltas. */
  tick(dt: number, r: FidgetHand, l: FidgetHand, coinHeld: boolean): void;
  /** After the hands are applied and the world matrices are current: places the trick coin. */
  place(): void;
  /** Fade out (a one-shot animation started, or the coin was interrupted). */
  stop(): void;
  /** Immediately back to the held coin (item changed, viewmodel hidden, disposed). */
  reset(): void;
  /** Unsubscribes from the input and resets (the viewmodel was disposed). */
  dispose(): void;
}

type HandId = 'r' | 'l';
interface Out { pos: THREE.Vector3; q: THREE.Quaternion; scale: number }
interface Ctx {
  /** World-space anchor of a point in a hand's local frame (zero in the dry pass). */
  P(h: HandId, x: number, y: number, z: number): THREE.Vector3;
  /** World orientation of a hand rotated by the given Euler angles (identity in the dry pass). */
  Q(h: HandId, x: number, y: number, z: number): THREE.Quaternion;
}
interface Deltas { r: FidgetPose; l: FidgetPose }
type Run = (k: number, d: Deltas, o: Out, c: Ctx) => void;
/** [k, sfx name, volume] fired once when the trick passes k. */
interface Trick { dur: number; run: Run; sfx: Array<[number, string, number]> }

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────
const POSE_KEYS: Array<keyof FidgetPose> = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'curl', 'index', 'thumb'];
const zeroPose = (): FidgetPose => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, curl: 0, index: 0, thumb: 0 });
const zeroDeltas = (d: Deltas): void => { for (const k of POSE_KEYS) { d.r[k] = 0; d.l[k] = 0; } };
const addPose = (to: FidgetPose, d: FidgetPose, s: number): void => { for (const k of POSE_KEYS) to[k] += d[k] * s; };

const sm = (k: number): number => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); };
const cube = (k: number): number => { const t = clamp(k, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const outBack = (k: number): number => { const t = clamp(k, 0, 1), c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
/** Rises over [a,b], holds, falls over [c,d] (smooth). */
const bump = (k: number, a: number, b: number, c: number, d: number): number => sm((k - a) / (b - a)) * (1 - sm((k - c) / (d - c)));
/** Arc a → b in the air: the lerp plus a parabolic lift of height h. */
function arc(o: Out, a: THREE.Vector3, b: THREE.Vector3, e: number, h: number): void { o.pos.copy(a).lerp(b, e); o.pos.y += h; }

// ── hand-local anchors (metres; the right hand, fingers towards −Z) ──────────────────────────────
const PALM = { x: 0, y: 0.016, z: -0.02 };
const KN_X0 = -0.027, KN_X1 = 0.027, KN_Y = 0.0205, KN_Z = -0.045;   // index / pinky knuckle row, edge-on coin height

// ── tricks ────────────────────────────────────────────────────────────────────────────────────────
/** 1. Flip up with a spin and catch it on the palm; the wrist follows through, the fingers close on the catch. */
const flipCatch: Run = (k, d, o, c) => {
  const h = 0.11 * 4 * k * (1 - k);
  d.r.thumb += 0.5 * bump(k, 0, 0.05, 0.12, 0.2);
  d.r.rx += -0.08 * Math.sin(k * Math.PI);
  d.r.curl += 0.4 * bump(k, 0.8, 0.94, 0.97, 1);
  o.pos.copy(c.P('r', PALM.x, PALM.y + h, PALM.z));
  o.q.copy(c.Q('r', 4 * Math.PI * k, 0, 0));
};

/** 2. Knuckle walk: the coin stands on its edge and walks across the knuckles, index → pinky → index, then back to the palm. */
const knuckleWalk: Run = (k, d, o, c) => {
  let x: number, z: number, stand: number, e: number, hop = 0;
  if (k < 0.18) { e = cube(k / 0.18); x = lerp(0, KN_X0, e); z = lerp(PALM.z, KN_Z, e); stand = e; }
  else if (k < 0.5) { e = cube((k - 0.18) / 0.32); x = lerp(KN_X0, KN_X1, e); z = KN_Z; stand = 1; hop = Math.abs(Math.sin(e * Math.PI * 3)); }
  else if (k < 0.82) { e = cube((k - 0.5) / 0.32); x = lerp(KN_X1, KN_X0, e); z = KN_Z; stand = 1; hop = Math.abs(Math.sin(e * Math.PI * 3)); }
  else { e = cube((k - 0.82) / 0.18); x = lerp(KN_X0, 0, e); z = lerp(KN_Z, PALM.z, e); stand = 1 - e; }
  const y = lerp(PALM.y, KN_Y, stand) + 0.006 * hop;
  d.r.curl += -0.3 * stand;                     // fingers flatten a little into a track
  d.r.thumb += 0.15 * stand;
  o.pos.copy(c.P('r', x, y, z));
  o.q.copy(c.Q('r', (Math.PI / 2) * stand, 0, 0));
};

/** 3. Thumb flick: the coin is spun on the palm like a top, the spin decelerating, with a wobble that dies out. */
const thumbSpin: Run = (k, d, o, c) => {
  const spin = 6 * Math.PI * (1 - (1 - k) * (1 - k));
  const tilt = 0.3 * (1 - k);
  d.r.thumb += 0.55 * bump(k, 0, 0.05, 0.14, 0.24) + 0.4 * bump(k, 0.45, 0.5, 0.55, 0.62);
  d.r.index += -0.15 * bump(k, 0, 0.1, 0.2, 0.3);
  o.pos.copy(c.P('r', PALM.x, PALM.y + 0.002 * tilt * Math.cos(spin), PALM.z));
  o.q.copy(c.Q('r', tilt * Math.sin(spin / 2), spin, tilt * Math.cos(spin / 2)));
};

/** 4. Palm-to-palm toss: right → left (arcing, spinning), a cup-catch, then left → right and a catch. */
const paletoss: Run = (k, d, o, c) => {
  const H = 0.09;
  if (k < 0.46) {
    const u = k / 0.46, e = cube(u), spin = 2 * Math.PI * e;
    d.r.rx += -0.22 * bump(k, 0, 0.08, 0.14, 0.24);     // flick from the right wrist
    d.l.curl += -0.25 * sm((k - 0.2) / 0.26);           // left hand opens to take it
    arc(o, c.P('r', PALM.x, PALM.y, PALM.z), c.P('l', PALM.x, PALM.y, PALM.z), e, H * 4 * u * (1 - u));
    o.q.copy(c.Q('r', spin, 0, 0)).slerp(c.Q('l', spin, 0, 0), e);
  } else if (k < 0.54) {
    d.l.curl += 0.3 * bump(k, 0.44, 0.5, 0.5, 0.54);    // left cups around the catch
    o.pos.copy(c.P('l', PALM.x, PALM.y, PALM.z));
    o.q.copy(c.Q('l', 0, 0, 0));
  } else {
    const u = (k - 0.54) / 0.46, e = cube(u), spin = 2 * Math.PI + 2 * Math.PI * e;
    d.l.rx += -0.22 * bump(k, 0.54, 0.62, 0.68, 0.78);  // flick from the left wrist
    d.r.curl += 0.3 * bump(k, 0.92, 0.97, 0.99, 1);     // right hand closes on the catch
    arc(o, c.P('l', PALM.x, PALM.y, PALM.z), c.P('r', PALM.x, PALM.y, PALM.z), e, H * 4 * u * (1 - u));
    o.q.copy(c.Q('l', spin, 0, 0)).slerp(c.Q('r', spin, 0, 0), e);
  }
  o.scale = 1;
};

/** 5. Vanish: the fist closes over the coin and it shrinks away; the left hand shows an empty palm, then the coin pops out of it and glides back. */
const vanish: Run = (k, d, o, c) => {
  const close = sm(k / 0.25), open = 1 - sm((k - 0.55) / 0.25);
  d.r.curl += 0.7 * close * open;
  d.l.curl += -0.25 * bump(k, 0.5, 0.6, 0.72, 0.85);
  if (k < 0.55) {
    o.scale = k < 0.1 ? 1 : 1 - sm((k - 0.1) / 0.2);
    o.pos.copy(c.P('r', PALM.x, PALM.y, PALM.z));
    o.q.copy(c.Q('r', 0, 0, 0));
  } else if (k < 0.75) {
    o.scale = outBack((k - 0.55) / 0.2);
    o.pos.copy(c.P('l', PALM.x, PALM.y, PALM.z));
    o.q.copy(c.Q('l', 0, 0, 0));
  } else {
    const e = cube((k - 0.75) / 0.25);
    arc(o, c.P('l', PALM.x, PALM.y, PALM.z), c.P('r', PALM.x, PALM.y, PALM.z), e, 0.05 * 4 * e * (1 - e));
    o.q.copy(c.Q('l', 0, 0, 0)).slerp(c.Q('r', 0, 0, 0), e);
    o.scale = 1;
  }
};

const TRICKS: Trick[] = [
  { dur: 1.1, run: flipCatch, sfx: [[0.03, 'coinTrickFlick', 0.5], [0.96, 'coinTrickCatch', 0.5]] },
  { dur: 1.8, run: knuckleWalk, sfx: [[0.3, 'coinTrickClink', 0.12], [0.5, 'coinTrickClink', 0.12], [0.7, 'coinTrickClink', 0.12]] },
  { dur: 1.3, run: thumbSpin, sfx: [[0.02, 'coinTrickFlick', 0.4], [0.5, 'coinTrickFlick', 0.35]] },
  { dur: 1.4, run: paletoss, sfx: [[0.02, 'coinTrickFlick', 0.45], [0.46, 'coinTrickCatch', 0.4], [0.54, 'coinTrickFlick', 0.45], [0.97, 'coinTrickCatch', 0.4]] },
  { dur: 1.5, run: vanish, sfx: [[0.2, 'coinTrickClink', 0.15], [0.62, 'coinTrickClink', 0.25]] },
];
const IDLE_TRICK = 1;                           // the knuckle walk doubles as the idle roll (half amplitude)
const IDLE_MIN_S = 8, IDLE_MAX_S = 12;
/** Walk-layer key presses that take the hands away: they fade a running trick out. */
const INTERRUPT: readonly string[] = ['interact', 'use', 'give', 'place', 'emote', 'ping', 'upgrade', 'talk'];

/** Amplitude of the hand motion: settings.headBob (0.35..1 of the motion) and Calm (×0.6). */
function amplitude(): number {
  const s = app?.save?.data?.settings;
  if (!s) return 1;
  return (0.35 + 0.65 * clamp(s.headBob, 0, 1)) * (s.calm ? 0.6 : 1);
}

interface Cur { trick: number; t: number; idle: boolean; cut: boolean; prevK: number }

export function createFidget(right: FidgetHand, left: FidgetHand, coin: THREE.Object3D): Fidget {
  const hands: Record<HandId, FidgetHand> = { r: right, l: left };
  const makeCtx = (live: boolean): Ctx => ({
    P(h, x, y, z) {
      const v = new THREE.Vector3(x, y, z);
      return live ? hands[h].root.localToWorld(v) : v;
    },
    Q(h, x, y, z) {
      const q = new THREE.Quaternion();
      if (live) { hands[h].root.getWorldQuaternion(q); q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))); }
      return q;
    },
  });
  const liveCtx = makeCtx(true), dryCtx = makeCtx(false);
  const out: Out = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), scale: 1 };
  const scratch: Deltas = { r: zeroPose(), l: zeroPose() };
  const homeP = new THREE.Vector3(), homeQ = new THREE.Quaternion();

  let cur: Cur | null = null;
  let w = 0;            // blend weight 0..1 (smoothed by sm() when applied)
  let next = 0;         // next trick index for a press
  let queue = 0;        // presses made during a trick (played back to back, capped)
  let standT = 0;
  let idleGap = IDLE_MIN_S;
  const idleRng = createRng(hashSeed('fidget'));   // seeded: idle tricks are reproducible

  // presses latched by the input callbacks (see the header: `inp.pressed` is cleared before the frame's update)
  let pressLatch = false;
  let interruptLatch = false;
  const offs: Array<() => void> = [];
  const input = app?.input;
  if (input) {
    offs.push(input.on('fidget' as Action, (down) => { if (down) pressLatch = true; }));
    for (const a of INTERRUPT) offs.push(input.on(a as Action, (down) => { if (down) interruptLatch = true; }));
  }

  const start = (trick: number, idle: boolean): void => { cur = { trick, t: 0, idle, cut: false, prevK: 0 }; };
  const cut = (): void => { if (cur) cur.cut = true; queue = 0; };
  const sfx = (name: string, vol: number): void => { app?.audio?.play(name, { vol, priority: 3 }); };
  const reset = (): void => {
    cur = null; w = 0; queue = 0; standT = 0;
    pressLatch = false; interruptLatch = false;
    coin.visible = false;
  };

  return {
    get busy() { return w > 0; },

    tick(dt, r, l, coinHeld) {
      const inp = app?.input;
      if (!inp) return;
      const press = pressLatch; pressLatch = false;
      const interrupt = interruptLatch; interruptLatch = false;
      const walking = inp.mode === 'walk';
      const mv = walking ? inp.move() : null;
      const moving = !!mv && (mv.x !== 0 || mv.z !== 0);
      const ok = walking && coinHeld && !interrupt;     // walk mode, a coin in hand, no key that takes the hands away
      const still = ok && !moving;                      // only the idle roll asks for standing still

      if (!ok && cur && !cur.cut) cut();
      if (ok && press) {
        if (!cur || cur.cut) { start(next % TRICKS.length, false); next++; }     // a press during the fade-out starts a new trick
        else queue = Math.min(2, queue + 1);
      }
      if (still && !cur) {
        standT += dt;
        if (standT >= idleGap) {
          standT = 0;
          idleGap = idleRng.float(IDLE_MIN_S, IDLE_MAX_S);
          start(IDLE_TRICK, true);
        }
      } else standT = 0;

      // advance the trick, fire its sounds, chain a queued press
      if (cur && !cur.cut) {
        const T = TRICKS[cur.trick];
        cur.t += dt;
        const k = clamp(cur.t / T.dur, 0, 1);
        for (const [ek, name, vol] of T.sfx) if (cur.prevK < ek && k >= ek) sfx(name, vol);
        cur.prevK = k;
        if (cur.t >= T.dur) {
          if (queue > 0 && ok) { queue--; start(next % TRICKS.length, false); next++; }
          else cut();
        }
      }

      // blend weight in / out
      const want = cur && !cur.cut ? 1 : 0;
      w = want > w ? Math.min(1, w + dt / 0.16) : Math.max(0, w - dt / 0.22);
      if (!cur || (cur.cut && w <= 0)) { cur = null; queue = 0; }

      if (cur && w > 0) {
        const T = TRICKS[cur.trick];
        out.scale = 1;
        zeroDeltas(scratch);
        T.run(clamp(cur.t / T.dur, 0, 1), scratch, out, dryCtx);
        const s = sm(w) * amplitude() * (cur.idle ? 0.5 : 1);
        addPose(r.pose, scratch.r, s);
        addPose(l.pose, scratch.l, s);
      }
    },

    place() {
      if (!cur || w <= 0) { coin.visible = false; return; }
      const T = TRICKS[cur.trick];
      out.scale = 1;
      zeroDeltas(scratch);
      T.run(clamp(cur.t / T.dur, 0, 1), scratch, out, liveCtx);
      const s = sm(w);
      right.holder.getWorldPosition(homeP);
      right.holder.getWorldQuaternion(homeQ);
      coin.position.lerpVectors(homeP, out.pos, s);
      coin.quaternion.copy(homeQ).slerp(out.q, s);
      coin.scale.setScalar(lerp(1, out.scale, s));
      coin.visible = true;
    },

    stop() { cut(); },

    reset,

    dispose() {
      for (const off of offs.splice(0)) off();
      reset();
    },
  };
}
