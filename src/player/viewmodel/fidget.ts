/**
 * Coin fidget (PLAYER), always available, never waiting. Two quick throws and four fancy tricks.
 *
 * R tosses the coin up and catches it in the same hand (0.45 s); Q passes it to the other hand (right to left, then left to
 * right, 0.5 s). A press while the coin is in the air is kept (the latest one wins) and the catch blends straight into the next
 * throw, so spamming either key, or both, is one unbroken juggle: the coin is always in a palm or in a flight that ends in one.
 * The flight is closed form in the time since the launch and aims at the live palm of the catching hand, so it neither jumps
 * nor depends on the frame rate. Both hands have a coin socket (`Arm.palm`, the left one mirrored).
 *
 * HOLDING Q for 0.4 s plays the fancy tricks (`./coinTricks.ts`: thumb flip, knuckle roll, fingertip spin, inspect) in a seeded
 * random order. A coin that sits in the left hand is passed back to the right first. A fancy trick cuts in AT ONCE: every
 * channel (the arm, the wrist, the fingers, the coin in hand) crossfades from where it is now to the new trick's curve over
 * 0.12 s. Holding the key keeps the knuckle roll looping. A coin that is in the air keeps its momentum when a trick is cut: it flies on
 * (gravity and a spin that ends flat) and is caught, with the miss blended out over 0.09 s: it never jumps back to the palm.
 * After ~8 s standing still a short knuckle roll plays on its own. An interaction key (E, F, G …: keys that take the hands away)
 * or leaving walk mode eases the trick out (0.25 s) to the held coin.
 *
 * Everything is on sim time: curves are functions of the trick clock, the flight is closed form in the time since launch, the
 * blends are timed. Hand channels are added to the live pose (`tick`, before the arms apply it); the coin's world transform is
 * set afterwards (`place`), so it follows the wrist.
 *
 * Presses come from the input's own `on()` callbacks (fired when the key is dispatched, in the sim step): the viewmodel is
 * updated once per rendered frame, after the sim steps have ended, and `input.pressed()` only lives inside one step.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import type { Action } from '@/core/input/types';
import { clamp, lerp } from '@/core/math';
import { createRng, hashSeed } from '@/core/rng';
import { ARMS_UNIT, type HandPose } from './arms';
import { ANGLE_CHANNELS, ARM_CHANNELS, CHANNELS, curvesOf, GRAVITY, HOLD_TRICK_S, REST, ROLL_TRICK, TOSSES, TRICKS, type Channel, type Launch, type Toss, type TossKind, type Trick } from './coinTricks';

/** The slice of a viewmodel hand the tricks need (the viewmodel's Arm): `palm` is the hand frame the coin lives in. */
export interface FidgetHand { readonly palm: THREE.Object3D; readonly holder: THREE.Object3D; readonly pose: HandPose }
export interface Fidget {
  /** True while the trick coin replaces the held coin. */
  readonly busy: boolean;
  /** The Q key went down or up: a tap passes the coin to the other hand, held 0.4 s plays the fancy tricks (the knuckle roll loops while held). `which` plays that fancy trick at once (tests, bench). */
  press(down: boolean, which?: number): void;
  /** Ask for a throw (R: `up`, Q: `pass`). Asked in the air, it follows the catch with no gap. */
  toss(kind: TossKind): void;
  /** Before the hand poses are applied: advances the trick and adds its hand deltas. */
  tick(dt: number, r: FidgetHand, l: FidgetHand, coinHeld: boolean): void;
  /** After the hands are applied and the world matrices are current: places the trick coin. */
  place(): void;
  /** Ease out (a one-shot animation started, or the coin was interrupted). */
  stop(): void;
  /** Immediately back to the held coin (item changed, viewmodel hidden, disposed). */
  reset(): void;
  /** Unsubscribes from the input and resets (the viewmodel was disposed). */
  dispose(): void;
}

const BLEND_S = 0.12, REST_S = 0.25, CATCH_S = 0.09;
/** A throw chained on a catch skips most of its wind-up (s left before the launch) and blends the hands over CHAIN_BLEND_S. */
const CHAIN_WIND_S = 0.04, CHAIN_BLEND_S = 0.09, TOSS_BLEND_S = 0.06;
const IDLE_MIN_S = 8, IDLE_MAX_S = 12;
/** Walk-layer key presses that take the hands away: they ease a running trick out. */
const INTERRUPT: readonly string[] = ['interact', 'use', 'give', 'place', 'emote', 'ping', 'upgrade', 'talk'];
const POSE_CHANNELS: readonly (keyof HandPose)[] = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'wp', 'wr', 'curl', 'index', 'middle', 'thumb'];
const TAU = Math.PI * 2;
const smooth = (k: number): number => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); };

/** Amplitude of the arm motion: settings.headBob (0.35..1 of the motion) and Calm (×0.6). */
export function handAmplitude(): number {
  const s = app?.save?.data?.settings;
  if (!s) return 1;
  return (0.35 + 0.65 * clamp(s.headBob, 0, 1)) * (s.calm ? 0.6 : 1);
}

/** A throw under way: `from` throws, `to` catches (hand 0 right, 1 left); `p0` / `q0` are the coin where it left the palm. */
interface Tossing {
  def: Toss; from: 0 | 1; to: 0 | 1; t: number; bT: number; bD: number;
  flicked: boolean; launched: boolean; landed: boolean; p0: THREE.Vector3; q0: THREE.Quaternion;
}
interface Air { t: number; T: number; w: number; p: THREE.Vector3; q: THREE.Quaternion; v: THREE.Vector3 }

export function createFidget(right: FidgetHand, left: FidgetHand, coin: THREE.Object3D): Fidget {
  const rng = createRng(hashSeed('fidget'));               // seeded: the order of the tricks is reproducible
  const live = { ...REST } as Record<Channel, number>;      // what the channels are now (the output)
  const from = { ...REST } as Record<Channel, number>;      // what they were when the current blend began
  let cur: { trick: Trick; t: number; idle: boolean } | null = null;
  let blendT = 99, blendDur = BLEND_S;                      // settled when blendT >= blendDur
  let last = -1, held = false, pressed = 0, forced = -1, interruptLatch = false;
  let standT = 0, idleGap = IDLE_MIN_S;
  // the coin in the air, and the miss left over when it lands (blended out over CATCH_S)
  let air: Air | null = null, pendingLaunch: { L: Launch; late: number } | null = null;
  let catchT = CATCH_S;
  // the throws: the hand that holds the coin (or catches it), the throw in the air, the latest request, a fancy trick waiting for the coin to come home
  let side: 0 | 1 = 0, toss: Tossing | null = null, queued: TossKind | null = null, trickAfter = -1, returnNow = false;
  let holdT = 0, holdFired = false;
  const tossOut = [0, 1].map(() => ({} as Record<string, number>));                  // hand deltas of the throw now, per hand
  const tossFrom = [0, 1].map(() => ({} as Record<string, number>));                 // and when the throw began (blended from)
  for (const o of [...tossOut, ...tossFrom]) for (const ch of POSE_CHANNELS) o[ch] = 0;
  const offP = new THREE.Vector3(), offQ = new THREE.Quaternion();
  const tP = new THREE.Vector3(), tQ = new THREE.Quaternion(), pQ = new THREE.Quaternion(), eQ = new THREE.Quaternion();
  const cP = new THREE.Vector3(), cQ = new THREE.Quaternion(), aP = new THREE.Vector3(), aQ = new THREE.Quaternion();
  const E = new THREE.Euler(), AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1), AY = new THREE.Vector3(0, 1, 0), IDENT = new THREE.Quaternion();

  // shortcut: no stereo pan in the audio API, so the left hand sounds two semitones up
  const sfx = (name: string, vol: number, hand: 0 | 1 = 0): void => { app?.audio?.play(name, { vol, priority: 3, pitch: hand ? 2 : 0 }); };
  const snapshot = (): void => {
    for (const ch of CHANNELS) from[ch] = live[ch];
    for (const ch of ANGLE_CHANNELS) from[ch] -= TAU * Math.round(from[ch] / TAU);    // a spun coin does not unwind in the blend
  };
  const start = (i: number, idle = false): void => {
    snapshot();
    cur = { trick: TRICKS[i], t: 0, idle };
    last = i; blendT = 0; blendDur = BLEND_S;
  };
  const toRest = (): void => { snapshot(); cur = null; blendT = 0; blendDur = REST_S; };
  const next = (): number => { let i = rng.int(0, TRICKS.length - (last >= 0 ? 2 : 1)); if (last >= 0 && i >= last) i++; return i; };
  const reset = (): void => {
    cur = null; air = null; pendingLaunch = null; catchT = CATCH_S; blendT = 99; standT = 0;
    held = false; pressed = 0; forced = -1; interruptLatch = false;
    side = 0; toss = null; queued = null; trickAfter = -1; returnNow = false; holdT = 0; holdFired = false;
    for (const o of [...tossOut, ...tossFrom]) for (const ch of POSE_CHANNELS) o[ch] = 0;
    Object.assign(live, REST);
    coin.visible = false;
  };
  const busy = (): boolean => toss !== null || side === 1 || cur !== null || air !== null || pendingLaunch !== null || catchT < CATCH_S || blendT < blendDur;

  /** A fancy trick now, or once the coin is back in the right hand and still. */
  const wantTrick = (i: number): void => {
    if (!toss && side === 0) { start(i); return; }
    trickAfter = i; queued = null;
    if (!toss) queued = 'pass';
  };
  /** The coin in hand `h` (palm space of that hand, the left mirrored): where it sits now, with the trick channels on top. */
  const attach = (h: 0 | 1, P: THREE.Vector3, Q: THREE.Quaternion): void => {
    const hand = h ? left : right, s = h ? -1 : 1;
    P.set(live.cx * s, live.cy, live.cz);
    hand.palm.localToWorld(P);
    hand.palm.getWorldQuaternion(Q);
    Q.multiply(eQ.setFromEuler(E.set(live.crx, live.cry * s, live.crz * s))).multiply(eQ.setFromAxisAngle(AY, live.cspin));
  };
  const beginToss = (kind: TossKind, t0: number, bD: number): void => {
    const def = TOSSES[kind], from = side, to: 0 | 1 = kind === 'pass' ? (from ? 0 : 1) : from;
    if (cur) toRest();
    for (let h = 0; h < 2; h++) for (const ch of POSE_CHANNELS) tossFrom[h][ch] = tossOut[h][ch];
    toss = { def, from, to, t: t0, bT: 0, bD, flicked: false, launched: false, landed: false, p0: new THREE.Vector3(), q0: new THREE.Quaternion() };
    side = to;
  };
  /** Moves the throw on: its sounds, the landing, and what comes next (a chained throw, a waiting trick, or the end). */
  const stepToss = (dt: number): void => {
    const T = toss;
    if (!T) return;
    T.t += dt; T.bT += dt;
    const d = T.def, lands = d.launch + d.flight;
    if (!T.flicked && T.t >= d.launch) { T.flicked = true; sfx('coinTrickFlick', d.flick, T.from); }
    if (!T.landed && T.t >= lands) { T.landed = true; sfx('coinTrickCatch', d.catchVol, T.to); }
    if (!T.landed) return;
    if (trickAfter >= 0 && side === 0) { toss = null; const i = trickAfter; trickAfter = -1; start(i); return; }
    const next = trickAfter >= 0 ? 'pass' : queued;
    if (next) {                                              // the catch blends straight into the next throw
      queued = null;
      beginToss(next, TOSSES[next].launch - CHAIN_WIND_S + (T.t - lands), CHAIN_BLEND_S);
    } else if (T.t >= d.dur) toss = null;
  };

  const api: Fidget = {
    get busy() { return busy(); },

    press(down, which) {
      if (which !== undefined && which >= 0) {                // a fancy trick by number
        if (down) { pressed++; forced = which; held = true; holdFired = true; } else held = false;
      } else if (down) { held = true; holdT = 0; holdFired = false; }
      else { if (held && !holdFired) queued = 'pass'; held = false; }
    },
    toss(kind) { queued = kind; },

    tick(dt, r, l, coinHeld) {
      const inp = app?.input;
      const press = pressed; pressed = 0;
      const pick = forced; forced = -1;
      const interrupt = interruptLatch; interruptLatch = false;
      const walking = inp ? inp.mode === 'walk' : true;
      const mv = inp && walking ? inp.move() : null;
      const moving = !!mv && (mv.x !== 0 || mv.z !== 0);
      const ok = walking && coinHeld && !interrupt;         // walk mode, a coin in hand, no key that takes the hands away
      const still = ok && !moving;                          // only the idle roll asks for standing still

      if (!ok) { if (cur) toRest(); queued = null; trickAfter = -1; }
      else {
        if (held && !holdFired) { holdT += dt; if (holdT >= HOLD_TRICK_S) { holdFired = true; queued = null; wantTrick(next()); } }
        if (press) wantTrick(pick);                           // a fancy trick cuts in at once, from wherever the hand is
      }
      // the throws: start one when asked (not while a fancy trick's coin is still in the air), bring a stray coin home
      stepToss(dt);
      if (!toss && side === 1 && (!ok || returnNow)) queued ??= 'pass';
      if (!toss && queued && !air && !pendingLaunch && catchT >= CATCH_S && (ok || side === 1)) {
        const k = queued; queued = null;
        beginToss(k, dt, TOSS_BLEND_S);
      }
      returnNow = false;
      if (still && !cur && !busy()) {
        standT += dt;
        if (standT >= idleGap) { standT = 0; idleGap = rng.float(IDLE_MIN_S, IDLE_MAX_S); start(ROLL_TRICK, true); }
      } else standT = 0;

      // advance the trick: its sounds, the launch, the loop while the key is held, the end
      if (cur) {
        const T = cur.trick;
        let prev = cur.t;
        cur.t += dt;
        if (T.loop && held && ok && !cur.idle && cur.t >= T.loop[1]) { cur.t -= T.loop[1] - T.loop[0]; prev -= T.loop[1] - T.loop[0]; }
        for (const [ek, name, vol] of T.sfx) if (prev < ek && cur.t >= ek) sfx(name, vol);
        if (T.launch && prev < T.launch.t && cur.t >= T.launch.t && !air) pendingLaunch = { L: T.launch, late: cur.t - T.launch.t };
        if (cur.t >= T.dur) { if (held && ok) start(ROLL_TRICK); else toRest(); }
      }

      // every channel: the crossfade from the pose it had when the trick was cut in to the trick's own curve
      blendT += dt;
      const b = smooth(blendT / blendDur);
      const curves = cur ? curvesOf(cur.trick) : null;
      for (const ch of CHANNELS) live[ch] = lerp(from[ch], curves ? curves[ch](cur!.t) : REST[ch], b);
      const amp = handAmplitude() * (cur?.idle ? 0.5 : 1);
      for (const ch of POSE_CHANNELS) r.pose[ch] += live[ch as Channel] * (ARM_CHANNELS.includes(ch as Channel) ? amp : 1);

      // the hand deltas of the throw, each hand on its own curve (a catching hand opens and dips), blended from where it was
      for (let h = 0; h < 2; h++) {
        const out = tossOut[h], hand = h ? l : r;
        const R = toss ? (h === toss.from ? toss.def.thrower : h === toss.to ? toss.def.catcher : null) : null;
        const cv = R && toss ? curvesOf(R) : null, k = toss ? smooth(toss.bT / toss.bD) : 0, tt = toss ? Math.min(toss.t, toss.def.dur) : 0;
        const fade = toss ? 0 : 1 - Math.exp(-24 * dt);
        for (const ch of POSE_CHANNELS) {
          out[ch] = toss ? lerp(tossFrom[h][ch], cv ? cv[ch as Channel](tt) : 0, k) : out[ch] * (1 - fade);
          hand.pose[ch] += out[ch] * (ARM_CHANNELS.includes(ch as Channel) ? handAmplitude() : 1);
        }
      }

      catchT += dt;
      if (air) air.t += dt;
    },

    place() {
      if (!busy()) { coin.visible = false; return; }
      // where the hand holds the coin now
      const T = toss;
      attach(T ? (T.landed ? T.to : T.from) : side, tP, tQ);
      if (T && !T.launched && !T.landed && T.t >= T.def.launch) { T.launched = true; T.p0.copy(tP); T.q0.copy(tQ); }

      if (T && T.launched && !T.landed) {                        // a throw in the air: straight to the live palm that catches it, plus the arc and the flips
        const d = T.def, u = clamp((T.t - d.launch) / d.flight, 0, 1);
        attach(T.to, aP, aQ);
        cP.lerpVectors(T.p0, aP, u); cP.y += 4 * d.height * u * (1 - u);
        cQ.copy(T.q0).slerp(aQ, u).premultiply(eQ.setFromAxisAngle(d.axis === 'x' ? AX : AZ, TAU * d.turns * u));
      } else if (T || side === 1) { cP.copy(tP); cQ.copy(tQ); }
      else {
      if (pendingLaunch && !air) {                               // thumb flick: up and a little forward (the frame the launch fell in sets how late)
        const { L, late } = pendingLaunch;
        pendingLaunch = null;
        const T = (2 * L.vy) / GRAVITY;
        const w = (TAU * L.turns) / T, v = new THREE.Vector3(0, L.vy, L.vz);
        const p0 = tP.clone().addScaledVector(v, -late);                  // back to where the coin was at the launch time itself
        p0.y += 0.5 * GRAVITY * late * late;
        air = { t: late, T, w, p: p0, q: new THREE.Quaternion().setFromAxisAngle(AX, -w * late).multiply(tQ), v };
      }

      if (air) {                                                 // closed form in the time since launch: frame rate does not matter
        const a = air, t = Math.min(a.t, a.T);
        cP.copy(a.p).addScaledVector(a.v, t); cP.y -= 0.5 * GRAVITY * t * t;
        cQ.setFromAxisAngle(AX, a.w * t).multiply(a.q);
        if (a.t >= a.T) {                                        // caught: the miss is kept and blended out
          offP.copy(cP).sub(tP);
          offQ.copy(cQ).multiply(eQ.copy(tQ).invert());
          catchT = 0; air = null;
          sfx('coinTrickCatch', 0.35);
        }
      } else if (catchT < CATCH_S) {
        const w = 1 - smooth(catchT / CATCH_S);
        cP.copy(tP).addScaledVector(offP, w);
        cQ.copy(IDENT).slerp(offQ, w).multiply(tQ);
      } else { cP.copy(tP); cQ.copy(tQ); }
      }
      coin.position.copy(cP);
      coin.quaternion.copy(cQ);
      coin.scale.setScalar(Math.max(0.001, live.cs * ARMS_UNIT));
      coin.visible = true;
    },

    stop() { if (cur) toRest(); queued = null; trickAfter = -1; returnNow = true; },
    reset,

    dispose() {
      for (const off of offs.splice(0)) off();
      reset();
    },
  };

  // presses and releases latched by the input callbacks (see the header)
  const offs: Array<() => void> = [];
  const input = app?.input;
  if (input) {
    offs.push(input.on('fidget' as Action, (down) => api.press(down)));
    offs.push(input.on('toss' as Action, (down) => { if (down) api.toss('up'); }));
    for (const a of INTERRUPT) offs.push(input.on(a as Action, (down) => { if (down) interruptLatch = true; }));
  }
  return api;
}
