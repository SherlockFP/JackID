/**
 * The coin tricks, hand-keyed (PLAYER): four tricks as keyframe curves over the right hand and the coin, in the spirit of a CS
 * weapon inspect: every trick starts and ends on the held coin, and the player can cut from any frame into the next one.
 *
 *   thumbFlip   a cock of the wrist, the thumb flicks the coin up (it tumbles on a real arc, `launch`), a catch dip
 *   knuckleRoll the coin stands on its edge and rolls over the four knuckles and back; loops while the key is held
 *   fingerSpin  the hand tips up, the coin goes to the fingertip and spins there
 *   inspect     the hand comes up, the wrist turns the coin to show its face, and then its back
 *
 * A channel is a list of [seconds, value] keys, evaluated by a monotone cubic (`curve`: smooth, flat at holds and peaks, never
 * overshooting by itself: overshoot is keyed). Hand channels are DELTAS added to the live pose (arm px py pz rx ry rz in metres
 * and radians, wrist `wp` fingers up and `wr` roll, finger curls curl index middle thumb); coin channels are the coin in hand
 * space (the palm frame of the right hand, metres: x outward, y up off the back of the hand, z back towards the wrist, fingers
 * towards −z; `crx cry crz` Euler angles, `cspin` a turn about the coin's own axle, `cs` scale). Missing channels sit at rest.
 */
import { HOLD_AT } from './arms';

export const CHANNELS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'wp', 'wr', 'curl', 'index', 'middle', 'thumb', 'cx', 'cy', 'cz', 'crx', 'cry', 'crz', 'cspin', 'cs'] as const;
export type Channel = typeof CHANNELS[number];
/** The channels that are angles: wrapped when a blend starts, so a spinning coin never unwinds. */
export const ANGLE_CHANNELS: readonly Channel[] = ['crx', 'cry', 'crz', 'cspin'];
/** The channels that move the arm (scaled by the head-bob setting and Calm). */
export const ARM_CHANNELS: readonly Channel[] = ['px', 'py', 'pz', 'rx', 'ry', 'rz'];
type Keys = ReadonlyArray<readonly [number, number]>;

/** The coin in the pinch of the thumb (hand space): where every trick starts and ends. */
const [RX, RY, RZ] = HOLD_AT;
export const REST: Readonly<Record<Channel, number>> = {
  px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, wp: 0, wr: 0, curl: 0, index: 0, middle: 0, thumb: 0,
  cx: RX, cy: RY, cz: RZ, crx: 0, cry: 0, crz: 0, cspin: 0, cs: 1,
};
/** Gravity on the coin (view metres per second²): a flight of half a second peaks about 8 cm up. */
export const GRAVITY = 3.2;

export interface Launch {
  /** When the coin leaves the thumb (s), how fast it goes up and forward (m/s), and how many full turns it makes before it lands. */
  t: number; vy: number; vz: number; turns: number;
}
export interface Trick {
  name: string;
  dur: number;
  /** Keys of the looping stretch [from, to] (s): held key down, the trick jumps back from `to` to `from` (the curves match there). */
  loop?: readonly [number, number];
  launch?: Launch;
  keys: Partial<Record<Channel, Keys>>;
  /** [seconds, sfx name, volume]. */
  sfx: ReadonlyArray<readonly [number, string, number]>;
}

/** Monotone cubic through `keys` (Fritsch–Carlson): C1-smooth, flat at holds and peaks, clamped outside the first and last key. */
export function curve(keys: Keys): (t: number) => number {
  const n = keys.length, ts = keys.map((k) => k[0]), vs = keys.map((k) => k[1]);
  const d: number[] = [];                                       // slopes of the segments
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m: number[] = [];                                       // tangent at each key
  for (let i = 0; i < n; i++) {
    if (i === 0) m.push(d[0] ?? 0);
    else if (i === n - 1) m.push(d[n - 2]);
    else m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  }
  m[0] = 0; m[n - 1] = 0;                                       // a curve eases in and out of its first and last key
  return (t) => {
    if (n === 1 || t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

/** Three keys of the same value `w` s apart: a hold that leaves the curve flat there. */
const hold = (t: number, v: number, w = 0.07): Keys => [[t - w, v], [t, v], [t + w, v]];
const PI = Math.PI;

// ── a. thumb flip: anticipation, flick, tumble, catch dip, settle ────────────────────────────────
const thumbFlip: Trick = {
  name: 'thumbFlip', dur: 1.3,
  launch: { t: 0.24, vy: 0.78, vz: -0.03, turns: 2 },           // up for 0.49 s: lands at 0.73
  keys: {
    py: [[0, 0], [0.11, -0.012], [0.19, -0.016], [0.27, 0.02], [0.4, 0.012], [0.6, 0.002], [0.73, -0.013], [0.82, -0.003], [1.0, 0.002], [1.3, 0]],
    pz: [[0, 0], [0.19, 0.012], [0.27, -0.018], [0.5, -0.006], [0.73, 0.006], [1.0, 0], [1.3, 0]],
    rx: [[0, 0], [0.19, -0.09], [0.28, 0.16], [0.45, 0.03], [0.73, -0.07], [0.86, 0.025], [1.05, 0], [1.3, 0]],
    wp: [[0, 0], [0.19, -0.16], [0.28, 0.34], [0.38, 0.14], [0.6, 0.06], [0.73, -0.16], [0.84, 0.07], [1.0, 0.01], [1.3, 0]],
    thumb: [[0, 0], [0.16, 0.5], [0.25, -0.4], [0.38, -0.12], [0.7, 0.1], [0.95, 0], [1.3, 0]],
    index: [[0, 0], [0.19, 0.2], [0.27, -0.15], [0.6, -0.1], [0.73, 0.1], [0.95, 0], [1.3, 0]],
    curl: [[0, 0], [0.19, 0.1], [0.3, -0.12], [0.62, -0.08], [0.73, 0.16], [0.9, 0.02], [1.3, 0]],
    cy: [[0, RY], [0.19, RY - 0.004], [0.24, RY + 0.004], [0.73, RY], [0.8, RY - 0.003], [1.0, RY], [1.3, RY]],
  },
  sfx: [[0.22, 'coinTrickFlick', 0.5]],                           // the catch tick plays when the coin lands (fidget.ts)
};

// ── b. knuckle roll: stands the coin up, over the four knuckles and back, in a loop ──────────────
const X0 = -0.0245, X3 = 0.025, X1 = X0 + (X3 - X0) / 3, X2 = X0 + (2 * (X3 - X0)) / 3;
const KY = 0.0215, KZ = -0.041, ROLL = -(X3 - X0) / 0.0125;      // the coin rolls without slipping: turns by distance / radius
const knuckleRoll: Trick = {
  name: 'knuckleRoll', dur: 1.95, loop: [0.35, 1.55],
  keys: {
    cx: [[0, RX], [0.28, X0], ...hold(0.35, X0, 0.07).slice(1), [0.57, X1], [0.72, X2], ...hold(0.95, X3, 0.08), [1.18, X2], [1.33, X1], [1.48, X0], [1.55, X0], [1.62, X0], [1.95, RX]],
    cy: [[0, RY], [0.28, KY], [0.42, KY], [0.495, KY + 0.003], [0.57, KY], [0.645, KY + 0.003], [0.72, KY], [0.795, KY + 0.003], [0.87, KY], [1.03, KY], [1.105, KY + 0.003], [1.18, KY], [1.255, KY + 0.003], [1.33, KY], [1.405, KY + 0.003], [1.48, KY], [1.62, KY], [1.95, RY]],
    cz: [[0, RZ], [0.28, KZ], [1.62, KZ], [1.95, RZ]],
    crx: [[0, 0], [0.28, PI / 2], [1.62, PI / 2], [1.95, 0]],
    cspin: [[0.28, 0], [0.42, 0], [0.57, ROLL / 3], [0.72, (2 * ROLL) / 3], [0.87, ROLL], [1.03, ROLL], [1.18, (2 * ROLL) / 3], [1.33, ROLL / 3], [1.48, 0], [1.95, 0]],
    // the hand lies still and flat; each finger lifts a hair as the coin passes over its knuckle
    py: [[0, 0], [0.28, -0.004], [1.62, -0.004], [1.95, 0]],
    wp: [[0, 0], [0.28, -0.06], [1.62, -0.06], [1.95, 0]],
    index: [[0, 0], [0.28, 0], [0.42, 0], [0.495, -0.12], [0.57, 0], [1.33, 0], [1.405, -0.12], [1.48, 0], [1.95, 0]],
    middle: [[0, 0], [0.57, 0], [0.645, -0.12], [0.72, 0], [1.18, 0], [1.255, -0.12], [1.33, 0], [1.95, 0]],
    curl: [[0, 0], [0.28, -0.15], [1.62, -0.15], [1.95, 0]],
    thumb: [[0, 0], [0.28, 0.2], [1.62, 0.2], [1.95, 0]],
  },
  sfx: [[0.42, 'coinTrickClink', 0.1], [0.72, 'coinTrickClink', 0.1], [0.95, 'coinTrickClink', 0.1], [1.18, 'coinTrickClink', 0.1], [1.48, 'coinTrickClink', 0.1]],
};

// ── c. fingertip spin: the hand tips up, the coin goes to the fingertip and spins, then comes home ─
const TIP = { x: -0.004, y: 0.012, z: -0.121 };
const fingerSpin: Trick = {
  name: 'fingerSpin', dur: 2.1,
  keys: {
    cx: [[0, RX], [0.5, TIP.x], [1.6, TIP.x], [2.1, RX]],
    cy: [[0, RY], [0.2, RY + 0.012], [0.5, TIP.y], [1.6, TIP.y], [1.85, RY + 0.012], [2.1, RY]],
    cz: [[0, RZ], [0.5, TIP.z], [1.6, TIP.z], [2.1, RZ]],
    crx: [[0, 0], [0.5, PI / 2], [1.6, PI / 2], [2.1, 0]],
    cry: [[0.5, 0], [0.62, 0.12], [0.82, -0.09], [1.02, 0.05], [1.25, -0.02], [1.45, 0]],
    cspin: [[0, 0], [0.55, 0], [0.75, 12], [1.05, 20], [1.45, 8 * PI], [2.1, 8 * PI]],
    py: [[0, 0], [0.12, -0.008], [0.5, 0.01], [1.6, 0.01], [2.1, 0]],
    wp: [[0, 0], [0.1, -0.1], [0.55, 0.95], [0.65, 1.0], [1.6, 0.95], [1.75, 0.85], [2.1, 0]],
    wr: [[0, 0], [0.55, 0.1], [1.0, -0.05], [1.6, 0], [2.1, 0]],
    middle: [[0, 0], [0.4, -0.85], [1.7, -0.85], [2.1, 0]],       // the middle finger stands straight, the pad the coin balances on
    index: [[0, 0], [0.4, 0.5], [1.7, 0.5], [2.1, 0]],
    curl: [[0, 0], [0.4, 0.55], [1.7, 0.55], [2.1, 0]],
    thumb: [[0, 0], [0.12, 0.4], [0.55, 0.15], [0.62, -0.25], [0.8, 0.2], [1.7, 0.2], [2.1, 0]],
  },
  sfx: [[0.55, 'coinTrickFlick', 0.4], [1.0, 'coinTrickFlick', 0.2], [1.85, 'coinTrickCatch', 0.3]],
};

// ── d. inspect: the hand comes up, the wrist turns, the coin shows its face and then its back ────
const inspect: Trick = {
  name: 'inspect', dur: 2.0,
  keys: {
    py: [[0, 0], [0.4, 0.03], [1.5, 0.03], [2.0, 0]],
    pz: [[0, 0], [0.4, -0.03], [1.5, -0.03], [2.0, 0]],
    rx: [[0, 0], [0.12, -0.06], [0.45, 0.85], [0.6, 0.8], [1.5, 0.8], [2.0, 0]],
    wp: [[0, 0], [0.45, 0.1], [2.0, 0]],
    wr: [[0, 0], [0.45, 0], [0.7, 0.4], [0.95, -0.15], [1.3, 0.35], [1.55, -0.1], [1.8, 0.04], [2.0, 0]],
    thumb: [[0, 0], [0.45, 0.2], [1.6, 0.2], [2.0, 0]],
    curl: [[0, 0], [0.45, 0.1], [1.6, 0.1], [2.0, 0]],
    cx: [[0, RX], [0.5, RX - 0.004], [1.6, RX - 0.004], [2.0, RX]],
    cy: [[0, RY], [0.5, RY + 0.012], [0.95, RY + 0.012], [1.1, RY + 0.024], [1.3, RY + 0.012], [1.6, RY + 0.012], [2.0, RY]],
    cz: [[0, RZ], [0.5, RZ - 0.01], [1.6, RZ - 0.01], [2.0, RZ]],
    crx: [[0, 0], [0.95, 0], [1.25, PI], [1.6, PI], [2.0, 2 * PI]],
  },
  sfx: [[0.95, 'coinTrickFlick', 0.3], [1.25, 'coinTrickClink', 0.25], [1.95, 'coinTrickCatch', 0.25]],
};

// ── the two quick throws (R and Q): the hands are keyed here, the coin's flight is solved in fidget.ts ──
/** A throw: the coin leaves at `launch` (s), flies `flight` s (peaking `height` m over the line between the palms, `turns` flips), `dur` s in all. */
export interface Toss {
  name: string; dur: number; launch: number; flight: number; height: number; turns: number;
  /** The tumble axis: x flips end over end going up, z going sideways. */
  axis: 'x' | 'z';
  /** The throwing hand and the catching hand (R lands in the hand it left, so it has only the first). */
  thrower: Trick; catcher?: Trick;
  /** Volume of the flick at the launch and of the catch on landing. */
  flick: number; catchVol: number;
}
const role = (name: string, dur: number, keys: Trick['keys']): Trick => ({ name, dur, keys, sfx: [] });

/** R: a quick toss and catch in one hand: dip, flick, up and back, a small dip on the catch, 0.45 s. */
const upToss: Toss = {
  name: 'toss', dur: 0.45, launch: 0.07, flight: 0.3, height: 0.075, turns: 3, axis: 'x', flick: 0.4, catchVol: 0.35,
  thrower: role('toss.hand', 0.45, {
    py: [[0, 0], [0.05, -0.012], [0.1, 0.016], [0.2, 0.01], [0.33, 0.004], [0.38, -0.014], [0.45, 0]],
    pz: [[0, 0], [0.05, 0.008], [0.1, -0.012], [0.38, 0.004], [0.45, 0]],
    rx: [[0, 0], [0.05, -0.07], [0.11, 0.14], [0.25, 0.04], [0.38, -0.06], [0.45, 0]],
    wp: [[0, 0], [0.05, -0.14], [0.11, 0.3], [0.25, 0.08], [0.38, -0.16], [0.45, 0]],
    thumb: [[0, 0], [0.04, 0.4], [0.09, -0.35], [0.25, 0], [0.38, 0.15], [0.45, 0]],
    index: [[0, 0], [0.05, 0.18], [0.1, -0.14], [0.3, -0.06], [0.38, 0.1], [0.45, 0]],
    curl: [[0, 0], [0.05, 0.1], [0.1, -0.14], [0.3, -0.1], [0.38, 0.1], [0.45, 0]],
  }),
};

/** Q: the coin crosses from one palm to the other (0.5 s). The thrower sweeps in and follows through; the catcher opens, reaches, dips. */
const passToss: Toss = {
  name: 'pass', dur: 0.5, launch: 0.08, flight: 0.34, height: 0.05, turns: 2, axis: 'z', flick: 0.4, catchVol: 0.4,
  thrower: role('pass.throw', 0.5, {
    px: [[0, 0], [0.06, 0.012], [0.13, -0.034], [0.28, -0.03], [0.5, 0]],
    py: [[0, 0], [0.06, -0.01], [0.13, 0.012], [0.3, 0.006], [0.5, 0]],
    wp: [[0, 0], [0.06, -0.12], [0.13, 0.26], [0.3, 0.08], [0.5, 0]],
    wr: [[0, 0], [0.06, 0.12], [0.14, -0.25], [0.32, -0.1], [0.5, 0]],
    thumb: [[0, 0], [0.05, 0.4], [0.11, -0.35], [0.3, 0], [0.5, 0]],
    index: [[0, 0], [0.06, 0.16], [0.13, -0.12], [0.3, -0.05], [0.5, 0]],
  }),
  catcher: role('pass.catch', 0.5, {
    px: [[0, 0], [0.12, -0.012], [0.3, -0.024], [0.42, -0.016], [0.5, 0]],
    py: [[0, 0], [0.16, 0.01], [0.32, 0.012], [0.42, -0.016], [0.47, 0.002], [0.5, 0]],
    wp: [[0, 0], [0.3, 0.16], [0.42, -0.2], [0.5, 0]],
    wr: [[0, 0], [0.3, 0.1], [0.42, 0.04], [0.5, 0]],
    curl: [[0, 0], [0.12, -0.12], [0.3, -0.2], [0.42, -0.04], [0.5, 0]],
    index: [[0, 0], [0.12, -0.12], [0.3, -0.18], [0.42, 0.04], [0.5, 0]],
    thumb: [[0, 0], [0.2, -0.25], [0.3, -0.25], [0.42, 0.2], [0.5, 0]],
  }),
};
export const TOSSES = { up: upToss, pass: passToss } as const;
export type TossKind = keyof typeof TOSSES;
/** Holding Q this long (s) plays the old tricks instead of passing the coin. */
export const HOLD_TRICK_S = 0.4;

export const TRICKS: readonly Trick[] = [thumbFlip, knuckleRoll, fingerSpin, inspect];
/** The knuckle roll: held key loops it; also the idle roll. */
export const ROLL_TRICK = 1;

const compiled = new Map<Trick, Record<Channel, (t: number) => number>>();
/** The trick's curves, one per channel (cached): a channel without keys is constant at rest. */
export function curvesOf(trick: Trick): Record<Channel, (t: number) => number> {
  let c = compiled.get(trick);
  if (!c) {
    c = {} as Record<Channel, (t: number) => number>;
    for (const ch of CHANNELS) { const k = trick.keys[ch]; c[ch] = k ? curve(k) : () => REST[ch]; }
    compiled.set(trick, c);
  }
  return c;
}
