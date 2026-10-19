/**
 * Coin fidget (PLAYER): the Q coin tricks, played like a weapon inspect: always available, never waiting. Four hand-keyed tricks
 * (`./coinTricks.ts`: thumb flip, knuckle roll, fingertip spin, inspect) cycle on presses, picked seeded-random without an
 * immediate repeat. A press cuts into the next trick AT ONCE: every channel (the arm, the wrist, the fingers, the coin in hand)
 * crossfades from where it is now to the new trick's curve over 0.12 s, so spamming the key reads as one long fluid trick.
 * Holding the key keeps the knuckle roll looping. A coin that is in the air keeps its momentum when a trick is cut: it flies on
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
import { ANGLE_CHANNELS, ARM_CHANNELS, CHANNELS, curvesOf, GRAVITY, REST, ROLL_TRICK, TRICKS, type Channel, type Launch, type Trick } from './coinTricks';

/** The slice of a viewmodel hand the tricks need (the viewmodel's Arm): `palm` is the hand frame the coin lives in. */
export interface FidgetHand { readonly palm: THREE.Object3D; readonly holder: THREE.Object3D; readonly pose: HandPose }
export interface Fidget {
  /** True while the trick coin replaces the held coin. */
  readonly busy: boolean;
  /** The trick key went down or up (`which` picks a trick instead of the next one). Held down, the knuckle roll loops. */
  press(down: boolean, which?: number): void;
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

interface Air { t: number; T: number; w: number; p: THREE.Vector3; q: THREE.Quaternion; v: THREE.Vector3 }

export function createFidget(right: FidgetHand, _left: FidgetHand, coin: THREE.Object3D): Fidget {
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
  const offP = new THREE.Vector3(), offQ = new THREE.Quaternion();
  const tP = new THREE.Vector3(), tQ = new THREE.Quaternion(), pQ = new THREE.Quaternion(), eQ = new THREE.Quaternion();
  const cP = new THREE.Vector3(), cQ = new THREE.Quaternion();
  const E = new THREE.Euler(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), IDENT = new THREE.Quaternion();

  const sfx = (name: string, vol: number): void => { app?.audio?.play(name, { vol, priority: 3 }); };
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
    Object.assign(live, REST);
    coin.visible = false;
  };
  const busy = (): boolean => cur !== null || air !== null || pendingLaunch !== null || catchT < CATCH_S || blendT < blendDur;

  const api: Fidget = {
    get busy() { return busy(); },

    press(down, which) {
      if (down) { pressed++; forced = which ?? -1; held = true; } else held = false;
    },

    tick(dt, r, _l, coinHeld) {
      const inp = app?.input;
      const press = pressed; pressed = 0;
      const pick = forced; forced = -1;
      const interrupt = interruptLatch; interruptLatch = false;
      const walking = inp ? inp.mode === 'walk' : true;
      const mv = inp && walking ? inp.move() : null;
      const moving = !!mv && (mv.x !== 0 || mv.z !== 0);
      const ok = walking && coinHeld && !interrupt;         // walk mode, a coin in hand, no key that takes the hands away
      const still = ok && !moving;                          // only the idle roll asks for standing still

      if (!ok) { if (cur) toRest(); }
      else if (press) start(pick >= 0 ? pick : next());     // a press cuts in at once, from wherever the hand is
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

      catchT += dt;
      if (air) air.t += dt;
    },

    place() {
      if (!busy()) { coin.visible = false; return; }
      // where the hand holds the coin now
      tP.set(live.cx, live.cy, live.cz);
      right.palm.localToWorld(tP);
      right.palm.getWorldQuaternion(pQ);
      tQ.copy(pQ).multiply(eQ.setFromEuler(E.set(live.crx, live.cry, live.crz))).multiply(eQ.setFromAxisAngle(AY, live.cspin));

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
      coin.position.copy(cP);
      coin.quaternion.copy(cQ);
      coin.scale.setScalar(Math.max(0.001, live.cs * ARMS_UNIT));
      coin.visible = true;
    },

    stop() { if (cur) toRest(); },
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
    for (const a of INTERRUPT) offs.push(input.on(a as Action, (down) => { if (down) interruptLatch = true; }));
  }
  return api;
}
