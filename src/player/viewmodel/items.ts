/**
 * Things the first-person hand holds (PLAYER): coin, card, ticket, ledger, tonic, phone handset, totem, the shotgun and the six
 * foods (built from the shared part lists of src/world/props/food.ts, so the thing in your hand is the thing on the shelf).
 *
 * `GRIPS` says how each item sits in the fist: where and how it is turned in the hand frame (the fingers curl towards −Y, the
 * back of the hand is +Y), the hand pose that wraps it (the wrist rolls so a mug stands upright), and, for foods, the extra pose
 * the `eat` / `drink` animation lifts it to. A food built with a bite (`FOOD_BITE`) carries `userData.bite` so the animation
 * can shorten the part that is eaten.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { clamp } from '@/core/math';
import type { Hex } from '@/core/types';
import { FOOD_BITE, FOOD_PARTS, FOOD_TEX, type FoodPropId, type FoodTex } from '@/world/props/food';
import { HOLD_AT, type HandPose } from './arms';
import { mesh, shaded } from './shape';

export type OwnMat = (c: Hex) => THREE.MeshBasicMaterial;
type V3 = readonly [number, number, number];

const COIN_R = 0.0125, COIN_H = 0.0035;
const boxG = (w: number, h: number, d: number): THREE.BoxGeometry => shaded(new THREE.BoxGeometry(w, h, d));
const cylG = (rt: number, rb: number, h: number, seg: number): THREE.CylinderGeometry => shaded(new THREE.CylinderGeometry(rt, rb, h, seg));

export function isFood(kind: string): kind is FoodPropId { return kind in FOOD_PARTS; }

/** A food texture from the app's texture cache (null without an app: tests, headless builds). */
const foodMap = (t: FoodTex): THREE.Texture | null => app?.tex?.canvas(FOOD_TEX[t].px, FOOD_TEX[t].px, FOOD_TEX[t].paint, { key: `food:${t}` }) ?? null;

/** The playing-card back: a red field, a white border and a white diamond lattice (full colour, on a white part). */
const paintCardBack = (g: CanvasRenderingContext2D, w: number, h: number): void => {
  g.fillStyle = '#f2ecd8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b1202c'; g.fillRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#f2ecd8';
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) if ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) g.fillRect(x, y, 1, 1);
  g.fillStyle = '#e8c860'; g.fillRect(w / 2 - 2, h / 2 - 2, 4, 4);
};
/** The handset's ear and mouth grilles: a ring of holes on a dark cup. */
const paintGrille = (g: CanvasRenderingContext2D, w: number, h: number): void => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#404040';
  for (const [x, y] of [[7, 3], [11, 5], [12, 9], [9, 12], [5, 12], [3, 8], [4, 4], [7, 7], [9, 8], [7, 10]] as const) g.fillRect(x, y, 1, 1);
};
const texMat = (m: OwnMat, c: Hex, key: string, px: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.MeshBasicMaterial => {
  const x = m(c);
  x.map = app?.tex?.canvas(px, px, paint, { key }) ?? null;
  return x;
};

/** The bitten part of a food in the hand: `pivot` is scaled along `axis` (0 x, 1 y, 2 z). */
export interface Bite { pivot: THREE.Object3D; axis: 0 | 1 | 2 }

export function buildItem(kind: string, m: OwnMat): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (kind) {
    case 'coin': {
      // a thick gold rim and, on both faces, the embossed ¢ disc of the symbol atlas (its transparent ring leaves the rim showing)
      g.add(mesh(cylG(COIN_R, COIN_R, COIN_H, 16), m(0xc9962e)));
      const face = m(0xffffff);
      face.map = app?.tex?.symbol('coin', 32) ?? null;
      face.alphaTest = 0.5;
      for (const s of [1, -1]) {
        const d = mesh(shaded(new THREE.CircleGeometry(COIN_R, 16)), face, 0, s * (COIN_H / 2 + 0.0002), 0);
        d.rotation.x = -s * Math.PI / 2;
        g.add(d);
      }
      break;
    }
    case 'card': {
      // a playing card held face down: the cream edge and the painted back on both faces
      const back = texMat(m, 0xffffff, 'vm:cardback', 32, paintCardBack);
      g.add(mesh(boxG(0.042, 0.002, 0.062), m(0xf2ecd8)));
      for (const s of [1, -1]) {
        const f = mesh(shaded(new THREE.PlaneGeometry(0.042, 0.062)), back, 0, s * 0.0015, 0);
        f.rotation.x = -s * Math.PI / 2;
        g.add(f);
      }
      break;
    }
    case 'tonic':
      g.add(mesh(cylG(0.0165, 0.0175, 0.07, 8), m(0x4aa58f), 0, 0.035, 0),
            mesh(cylG(0.0065, 0.0125, 0.026, 8), m(0x4aa58f), 0, 0.083, 0),
            mesh(cylG(0.0075, 0.0065, 0.014, 6), m(0xb08a3a), 0, 0.103, 0),
            mesh(cylG(0.0182, 0.0182, 0.028, 8), m(0xe6dec5), 0, 0.036, 0));
      break;
    case 'phone': {
      // the wall phone's handset: a slim handle bowed up in the middle, round ear and mouth cups turned to the face (-Y), grilles
      // on the cups and a cord stub at the mouth end
      const body = m(0x4a4452);
      const grille = texMat(m, 0x5a5462, 'vm:grille', 16, paintGrille);
      g.add(mesh(boxG(0.038, 0.022, 0.11), body, 0, 0.006, 0));
      for (const s of [1, -1]) {
        const arm = mesh(boxG(0.036, 0.02, 0.04), body, 0, -0.002, s * 0.062);
        arm.rotation.x = s * 0.35;
        g.add(arm);
        g.add(mesh(cylG(0.03, 0.026, 0.03, 10), body, 0, -0.016, s * 0.074));
        g.add(mesh(cylG(0.024, 0.024, 0.002, 10), grille, 0, -0.032, s * 0.074));
      }
      const cord = mesh(cylG(0.004, 0.004, 0.03, 5), m(0x1a181e), 0, -0.004, 0.098);
      cord.rotation.x = Math.PI / 2;
      g.add(cord);
      break;
    }
    case 'ticket':
      g.add(mesh(boxG(0.05, 0.002, 0.09), m(0xe8d8a0)));
      break;
    case 'ledger':
      g.add(mesh(boxG(0.1, 0.014, 0.13), m(0x4a2a18)), mesh(boxG(0.094, 0.008, 0.124), m(0xe6dec5), 0, 0.002, 0));
      break;
    case 'totem':
      g.add(mesh(cylG(0.022, 0.03, 0.06, 7), m(0x8c6b29), 0, 0.03, 0),
            mesh(shaded(new THREE.IcosahedronGeometry(0.026, 0)), m(0xe8b04a), 0, 0.08, 0));
      break;
    default: {
      if (!isFood(kind)) return null;
      const spec = FOOD_BITE[kind];
      // the bitten parts hang under a pivot placed on the bite line: scaling it shortens them from the far end
      const pivot = new THREE.Group();
      if (spec) { const at = [0, 0, 0]; at[spec.axis] = spec.from; pivot.position.fromArray(at); g.add(pivot); }
      for (const part of FOOD_PARTS[kind]) {
        if (part.plate) continue;
        const geo = part.shape === 'box' ? boxG(part.size[0], part.size[1], part.size[2])
          : part.shape === 'torus' ? shaded(new THREE.TorusGeometry(part.size[0], part.size[1], 5, 10, part.size[2]))
          : cylG(part.size[0], part.size[1], part.size[2], part.seg ?? 10);
        const pm = m(part.color);
        if (part.tex) pm.map = foodMap(part.tex);
        if (part.alpha) { pm.transparent = true; pm.opacity = part.alpha; pm.depthWrite = false; }
        const o = mesh(geo, pm, part.pos[0], part.pos[1], part.pos[2]);
        if (part.rot) o.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
        if (spec && part.eat) { o.position.setComponent(spec.axis, part.pos[spec.axis] - spec.from); pivot.add(o); } else g.add(o);
      }
      if (spec) g.userData.bite = { pivot, axis: spec.axis } satisfies Bite;
      break;
    }
  }
  return g;
}

const WATCH_BRASS = 0xb08a3a, WATCH_GOLD = 0xd4a84a, WATCH_STRAP = 0x2a1810, WATCH_DIAL = 0xe6dec5, WATCH_INK = 0x1c1410;
/**
 * The watch rides the left forearm bone (bone units, 1 = 1 m of the model; the bone runs +Y towards the hand, the back of the wrist is −X).
 * The strap is an ellipse a little outside the skin there (the forearm is wider in Z than in X), the case sits on its −X side.
 */
const WATCH_AT = [0, 0.185, 0] as const;
const STRAP_RX = 0.037, STRAP_RZ = 0.044, STRAP_W = 0.024;
const CASE_R = 0.026, CASE_H = 0.014;

/** The dial: cream, a ring of hour ticks (long at 12, 3, 6 and 9), 12 at the top. */
const paintDial = (g: CanvasRenderingContext2D, w: number, h: number): void => {
  g.fillStyle = '#e6dec5'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1c1410';
  for (let i = 0; i < 12; i++) {
    const major = i % 3 === 0, a = (i / 12) * Math.PI * 2;
    g.save(); g.translate(w / 2, h / 2); g.rotate(a);
    g.fillRect(-(major ? 1 : 0.5), -h / 2 + 2, major ? 2 : 1, major ? 6 : 3);
    g.restore();
  }
};

/**
 * Hand angles (rad, clockwise from 12) for the Watch clock reading `sec` seconds left, read like a clock face: the long hand the
 * seconds, the short hand the minutes (12 min a turn). `null` (no Watch running) shows ten past ten.
 */
export function watchHandAngles(sec: number | null): { hour: number; minute: number } {
  if (sec === null || !Number.isFinite(sec)) return { hour: ((10 + 10 / 60) / 12) * Math.PI * 2, minute: Math.PI / 3 };
  const s = Math.max(0, sec);
  return { minute: ((s % 60) / 60) * Math.PI * 2, hour: ((s / 60 % 12) / 12) * Math.PI * 2 };
}

/** The brass wristwatch: a strap that wraps the wrist, a case with a bezel on the back of it, a dial with two hands. Add it to the left forearm bone. */
export function buildWatch(m: OwnMat): THREE.Group {
  const w = new THREE.Group();
  const strap = mesh(shaded(new THREE.CylinderGeometry(1, 1, STRAP_W, 14, 1, true)), m(WATCH_STRAP));
  strap.scale.set(STRAP_RX, 1, STRAP_RZ);
  const buckle = mesh(boxG(0.006, STRAP_W * 0.7, 0.016), m(WATCH_BRASS), STRAP_RX + 0.002, 0, 0);
  // the case: its local +Y points out of the wrist (−X of the bone), +X towards the hand
  const c = new THREE.Group();
  c.rotation.z = Math.PI / 2;
  c.position.x = -(STRAP_RX + 0.008);
  c.add(mesh(cylG(CASE_R, CASE_R, CASE_H, 12), m(WATCH_BRASS)));
  for (const s of [-1, 1]) c.add(mesh(boxG(0.014, 0.006, 0.018), m(WATCH_BRASS), s * (CASE_R + 0.003), -0.003, 0));   // lugs
  const bezel = mesh(shaded(new THREE.RingGeometry(0.0215, CASE_R + 0.002, 12)), m(WATCH_GOLD), 0, CASE_H / 2 + 0.0004, 0);
  bezel.rotation.x = -Math.PI / 2;
  c.add(bezel);
  // the face lies in the case's XZ plane seen from outside: x right (3 o'clock = towards the hand), 12 at the top (−Z of the bone)
  const face = new THREE.Group();
  face.rotation.x = -Math.PI / 2;
  face.position.y = CASE_H / 2 + 0.0002;
  const dialMat = m(0xffffff);
  dialMat.map = app?.tex?.canvas(48, 48, paintDial, { key: 'watch:dial' }) ?? null;
  if (!dialMat.map) dialMat.color.setHex(WATCH_DIAL);
  face.add(mesh(shaded(new THREE.CircleGeometry(0.0215, 14), 0.8), dialMat));
  const hand = (len: number, wd: number, z: number): THREE.Group => {
    const p = new THREE.Group();
    p.position.z = z;
    p.add(mesh(boxG(wd, len, 0.0006), m(WATCH_INK), 0, len / 2 - 0.002, 0));
    face.add(p);
    return p;
  };
  const hourH = hand(0.0125, 0.0034, 0.0008), minuteH = hand(0.0185, 0.0024, 0.0014);
  face.add(mesh(cylG(0.0026, 0.0026, 0.001, 6), m(WATCH_GOLD), 0, 0, 0.0022).rotateX(Math.PI / 2));
  c.add(face);
  w.add(strap, buckle, c);
  w.userData.hands = { hour: hourH, minute: minuteH };
  setWatchTime(w, null);
  liftWatch(w, 0);
  return w;
}

/** Set the hands to the Watch clock reading `sec` seconds left (null: ten past ten). */
export function setWatchTime(w: THREE.Object3D, sec: number | null): void {
  const h = w.userData.hands as { hour: THREE.Object3D; minute: THREE.Object3D } | undefined;
  if (!h) return;
  const a = watchHandAngles(sec);
  h.hour.rotation.z = -a.hour; h.minute.rotation.z = -a.minute;
}

/** 0..1: the watch lifts off the wrist (and dwindles out of sight at the end of the lift). */
export function liftWatch(w: THREE.Object3D, v: number): void {
  w.position.set(WATCH_AT[0] - 0.12 * v, WATCH_AT[1] - 0.05 * v, WATCH_AT[2] + 0.04 * v);
  w.rotation.set(0.5 * v, 0, 0.6 * v);
  w.scale.setScalar(Math.max(0.001, 1 - clamp((v - 0.85) / 0.15, 0, 1)));
}

/** Double-barrel shotgun, muzzle toward −Z, origin at the grip. */
export function buildGun(m: OwnMat): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.013, 0.013]) {
    const barrel = mesh(cylG(0.0115, 0.0115, 0.52, 8), m(0x4b4a50), x, 0.012, -0.28);
    barrel.rotation.x = Math.PI / 2;
    g.add(barrel);
  }
  g.add(mesh(boxG(0.05, 0.03, 0.12), m(0x3a3a40), 0, 0.012, -0.03));        // receiver
  g.add(mesh(boxG(0.044, 0.06, 0.22), m(0x6a3e1f), 0, -0.012, 0.13));       // stock
  g.add(mesh(boxG(0.04, 0.03, 0.17), m(0x6a3e1f), 0, -0.012, -0.2));        // fore-end
  g.add(mesh(boxG(0.012, 0.012, 0.012), m(0xe8b04a), 0, 0.03, -0.54));      // bead sight
  return g;
}

// ── grips ─────────────────────────────────────────────────────────────────────────────────────────
export interface Grip {
  /** Where the item's origin sits and how it is turned, in the hand frame. */
  pos: V3;
  rot: V3;
  /** The hand pose that closes on it (added to the neutral pose). */
  hand: Partial<HandPose>;
  /** How `eat` / `drink` lift it: the pose offset (added to the grip) that holds it at the mouth, and, for a drink, the pose that tips it into the mouth. */
  lift?: Partial<HandPose>;
  tipped?: Partial<HandPose>;
  /** Shrinks the held item (the çay glass is small in the hand; the world prop keeps its size). */
  scale?: number;
}

const NONE: Grip = { pos: [0, 0, 0], rot: [0, 0, 0], hand: {} };
/** The can and the tonic bottle, held like the mug: solved so the rim comes to the bottom of the screen, upright and then tipped. */
const CAN_LIFT = {
  lift: { px: -0.135, py: 0.006, pz: 0.143, rx: -0.2, ry: 0, rz: -0.29 },
  tipped: { px: -0.123, py: -0.031, pz: 0.113, rx: 0.615, ry: 0.064, rz: -0.172 },
} as const;

export const GRIPS: Readonly<Record<string, Grip>> = {
  coin: { pos: HOLD_AT, rot: [0, 0, 0], hand: { index: 0.15, thumb: 0.2, curl: 0.28 } },
  card: { pos: [0, 0, 0], rot: [0, 0.2, 0], hand: { curl: 0.6, index: 0.35, thumb: 0.35 } },
  ticket: { pos: [0, 0, 0], rot: [0, 0, 0], hand: { curl: 0.6, index: 0.35, thumb: 0.35 } },
  ledger: { pos: [0, 0, 0], rot: [0, 0, 0], hand: { curl: 0.5 } },
  totem: { pos: [0, 0, 0], rot: [0, 0, 0], hand: {} },
  tonic: { pos: [0.044, -0.028, -0.04], rot: [0, 0, Math.PI / 2], hand: { curl: 1.0, index: 0.95, thumb: 0.7, rz: -1.2 }, ...CAN_LIFT },
  phone: { pos: [0, -0.045, -0.03], rot: [0, Math.PI / 2, 0], hand: { curl: 0.95, index: 0.9, thumb: 0.65 } },
  banana: {
    pos: [-0.012, -0.022, -0.04], rot: [0, Math.PI, 0], hand: { curl: 0.95, index: 0.9, thumb: 0.65 },
    lift: { px: -0.1, py: -0.004, pz: 0.155, rx: 0.126, ry: 0.167, rz: -0.378 },
  },
  sandwich: {
    pos: [-0.01, -0.012, -0.065], rot: [0, Math.PI, 0], hand: { curl: 0.7, index: 0.6, thumb: 0.5 },
    lift: { px: -0.089, py: 0.003, pz: 0.088, rx: 2.131, ry: 0.821, rz: 0 },
  },
  coffee: {
    pos: [0.033, -0.03, -0.04], rot: [0, 0, Math.PI / 2], hand: { curl: 1.0, index: 0.95, thumb: 0.65, rz: -1.2 },
    lift: { px: -0.133, py: 0.021, pz: 0.143, rx: -0.2, ry: 0, rz: -0.289 },
    tipped: { px: -0.126, py: -0.003, pz: 0.123, rx: 0.592, ry: 0.056, rz: -0.181 },
  },
  energy: { pos: [0.058, -0.028, -0.04], rot: [0, 0, Math.PI / 2], hand: { curl: 1.0, index: 0.95, thumb: 0.65, rz: -1.2 }, ...CAN_LIFT },
  // the tulip glass held bare by its narrow waist (0.05 up the glass: the mug's rule, origin x = grip height - 0.004; y like the can), lifted like the mug
  tea: {
    pos: [0.018, -0.028, -0.04], rot: [0, 0, Math.PI / 2], hand: { curl: 0.6, index: 0.55, thumb: 0.5, rz: -1.2 }, scale: 0.85,   // fingertips on the foot of a small glass, the waist and lip above the fist
    lift: { px: -0.133, py: 0.021, pz: 0.143, rx: -0.2, ry: 0, rz: -0.289 },
    tipped: { px: -0.126, py: -0.003, pz: 0.123, rx: 0.592, ry: 0.056, rz: -0.181 },
  },
  soup: {
    pos: [0.01, -0.04, -0.085], rot: [0, 0, Math.PI / 2], hand: { curl: 0.9, index: 0.85, thumb: 0.6, rz: -0.9 },
    lift: { px: -0.129, py: 0.023, pz: 0.189, rx: -0.199, ry: 0, rz: -0.587 },
    tipped: { px: -0.12, py: -0.034, pz: 0.156, rx: 0.591, ry: 0.052, rz: -0.487 },
  },
};

export const gripOf = (kind: string): Grip => GRIPS[kind] ?? NONE;
