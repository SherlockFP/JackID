/**
 * First-person viewmodel (PLAYER): low-poly gloved hands in their OWN scene, rendered after the world with the
 * depth buffer cleared (`renderer.render(scene, camera, { scene: vm.scene, camera: vm.camera })`), FOV 50, near 0.01
 * (TECH_SPEC §11.7, ART_BIBLE §8.5). Each hand is ~250 tris: palm, back plate, 4 three-segment fingers, a 2-segment thumb, a glove wrist, a sleeve in
 * the player's jacket colour and a leather cuff ring where glove meets sleeve (WAVE69 §8). Materials are unlit with baked
 * vertex shading (the scene has no lights); `setLightLevel` dims them in dark rooms.
 *
 * Holds (`hold`): coin (default), card, tonic, phone, ticket, ledger, gun (two-handed),
 * totem, or any `Object3D` the caller supplies (card fan, totem, scratch coin…). One-shot animations (`play`):
 * flip · drink · throw · point · punchCard · recoil · give · grab · checkWatch · unwatch · rpsRock · rpsPaper · rpsScissors. The left wrist wears a brass
 * wristwatch (`setWatch`). An empty hand holds a coin (the default). In walk mode with the
 * coin in hand, Q plays a coin trick (`./viewmodel/fidget.ts`); after ~8 s of standing still a short knuckle walk plays
 * on its own. `setHandLook` shows the unsettling finger-tax and porcelain collateral looks. The facade feeds head-bob
 * and look deltas through `drive()` once per frame.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { clamp, damp, lerp } from '@/core/math';
import type { Hex } from '@/core/types';
import type { HeldItem, Viewmodel } from './types';
import { createFidget, handAmplitude } from './viewmodel/fidget';

export interface ViewmodelDrive {
  /** Camera head-bob offsets (m); the hands move 1.5× (ART_BIBLE §8.5). */
  bobX: number; bobY: number;
  sprint: boolean; crouch: number; grounded: boolean;
  /** Mouse delta since the last frame (px). */
  lookDx: number; lookDy: number;
  /** Main camera aspect, so the overlay frustum matches. */
  aspect: number;
  /** Player ground speed (m/s): drives the hand walk bob. Optional; 0 when missing. */
  speed?: number;
}

export interface ViewmodelHost extends Viewmodel {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly item: HeldItem;
  drive(d: ViewmodelDrive): void;
  /** 0..1 brightness of the surroundings. */
  setLightLevel(v: number): void;
  setSleeveColor(c: Hex): void;
  /** Glove leather on both hands. `GLOVE_IVORY` is the old look (no cuff ring); the porcelain look still overrides. */
  setGloveColor(c: Hex): void;
  /** Cracked-porcelain texture for the collateral look (optional; a flat bone colour is used without it). */
  setPorcelainMap(map: THREE.Texture | null): void;
  /** Show or hide the wristwatch on the left wrist. */
  setWatch(on: boolean): void;
  dispose(): void;
}

// ── geometry / material helpers ───────────────────────────────────────────────────────────────────
const LIGHT = new THREE.Vector3(0.35, 0.85, 0.4).normalize();

/** Bake directional vertex shading so the unlit material still reads as a lit solid. */
function shaded<T extends THREE.BufferGeometry>(g: T, floor = 0.58): T {
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const d = n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = floor + (1 - floor) * clamp(d * 0.5 + 0.5, 0, 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const boxG = (w: number, h: number, d: number): THREE.BoxGeometry => shaded(new THREE.BoxGeometry(w, h, d));
const cylG = (rt: number, rb: number, h: number, seg: number): THREE.CylinderGeometry => shaded(new THREE.CylinderGeometry(rt, rb, h, seg));
const mat = (color: Hex): THREE.MeshBasicMaterial => psxMaterial({ color, vertexColors: true, lit: false, unique: true }) as THREE.MeshBasicMaterial;
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
};
function disposeGeometries(o: THREE.Object3D): void {
  o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}

// ── hand ──────────────────────────────────────────────────────────────────────────────────────────
/** Pose of one hand relative to its home: offsets (m / rad) and finger curls (rad-ish, 0 = straight). */
interface HandPose { px: number; py: number; pz: number; rx: number; ry: number; rz: number; curl: number; index: number; thumb: number }
const POSE_KEYS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'curl', 'index', 'thumb'] as const;
const newPose = (): HandPose => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, curl: 0.3, index: 0.3, thumb: 0.2 });
const copyPose = (to: HandPose, from: HandPose): void => { for (const k of POSE_KEYS) to[k] = from[k]; };

/** Gloves (WAVE69 §8; ART_BIBLE §2.1). Dark leather P16 RUST_DEEP is the default; the darkest leather allowed, so dim rooms still show it. */
export const GLOVE_LEATHER = 0x4a2110;
/** P09 IVORY: the pre-wave-69 glove (Settings → GLOVES off). Has no cuff ring. */
export const GLOVE_IVORY = 0xe6dec5;
/** P26 WALNUT: the wrist ring, a little lighter than the leather glove. */
const CUFF_LEATHER = 0x523119;
const PORCELAIN = 0xf4eedc;
const WATCH_BRASS = 0xb08a3a, WATCH_STRAP = 0x2a1810, WATCH_DIAL = 0xe6dec5;

/** A box whose far (−Z) end is scaled in X/Y: a tapered finger segment. */
function taperBox(w: number, h: number, d: number, tip: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * tip); p.setY(i, p.getY(i) * tip); }
  return shaded(g);
}

/** [length of each of the 3 segments] for index · middle · ring · pinky (m). */
const FINGER_LEN = [[0.03, 0.022, 0.019], [0.033, 0.025, 0.02], [0.03, 0.023, 0.019], [0.025, 0.018, 0.016]];
const FINGER_W = [0.0165, 0.0172, 0.0165, 0.0148];
/** Resting bend per segment (rad) so the fingers never sit ruler straight, and how far each segment follows the curl. */
const REST = [0.1, 0.16, 0.1], FOLLOW = [0.95, 1.1, 0.8];

class Hand {
  readonly root = new THREE.Group();
  /** Where held objects are parented (between thumb and index). */
  readonly holder = new THREE.Object3D();
  readonly pose = newPose();
  private readonly joints: THREE.Group[][] = [];       // [thumb, index, middle, ring, pinky][segment]
  private readonly glove: THREE.MeshBasicMaterial;
  private gloveHex: Hex;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh;                   // the cuff ring at the wrist (leather gloves only)
  private readonly sleeve: THREE.MeshBasicMaterial;
  private sleeveHex: Hex;
  private readonly watch: THREE.Group | null = null;   // left hand only
  private readonly watchMats: Array<[THREE.MeshBasicMaterial, Hex]> = [];
  private porcelain = false;
  private light = 1;

  constructor(private readonly side: 1 | -1, sleeveColor: Hex, gloveColor: Hex, private readonly home: THREE.Vector3, private readonly homeRot: THREE.Euler) {
    this.sleeveHex = sleeveColor;
    this.gloveHex = gloveColor;
    this.glove = mat(gloveColor);
    this.sleeve = mat(sleeveColor);
    this.ringMat = mat(CUFF_LEATHER);
    const r = this.root;
    // palm, a raised leather plate on the back of the hand, and the thumb's heel pad
    r.add(mesh(boxG(0.076, 0.026, 0.074), this.glove, 0, 0, 0.003));
    r.add(mesh(boxG(0.06, 0.006, 0.044), this.glove, 0, 0.014, -0.002));
    r.add(mesh(boxG(0.026, 0.02, 0.04), this.glove, -0.036 * side, -0.006, 0.012));
    // the forearm arm (wrist, cuff ring, sleeve) tilts down towards the camera
    const arm = new THREE.Group();
    arm.rotation.x = 0.1;
    arm.add(mesh(boxG(0.06, 0.044, 0.07), this.glove, 0, 0, 0.07));                       // glove wrist
    this.ring = mesh(boxG(0.09, 0.078, 0.014), this.ringMat, 0, 0, 0.098);                // cuff ring where glove meets sleeve
    this.ring.visible = gloveColor !== GLOVE_IVORY;
    arm.add(this.ring);
    arm.add(mesh(boxG(0.082, 0.07, 0.34), this.sleeve, 0, -0.002, 0.27));                // forearm in the jacket sleeve
    r.add(arm);
    if (side === -1) {                                                                     // wristwatch on the back of the left wrist
      const w = new THREE.Group();
      const own = (c: Hex): THREE.MeshBasicMaterial => { const m = mat(c); this.watchMats.push([m, c]); return m; };
      w.add(mesh(boxG(0.066, 0.05, 0.016), own(WATCH_STRAP), 0, 0, 0));                   // strap wraps the wrist
      w.add(mesh(cylG(0.017, 0.017, 0.008, 8), own(WATCH_BRASS), 0, 0.027, 0));          // case
      w.add(mesh(cylG(0.0125, 0.0125, 0.002, 8), own(WATCH_DIAL), 0, 0.0325, 0));        // dial
      w.position.set(0, 0, 0.066);
      arm.add(w);
      this.watch = w;
    }
    // fingers: 3 tapered segments each, the knuckle segment is the chunkiest
    for (let f = 0; f < 4; f++) {
      const lens = FINGER_LEN[f], fw = FINGER_W[f];
      const j1 = new THREE.Group();
      j1.position.set((-0.027 + f * 0.018) * side, 0.003, -0.037);
      let parent: THREE.Group = j1;
      const segs: THREE.Group[] = [j1];
      for (let s = 0; s < 3; s++) {
        const l = lens[s], k = 1 - s * 0.08;
        parent.add(mesh(taperBox(fw * k, (fw + 0.003) * k, l, 0.92), this.glove, 0, 0, -l / 2));
        if (s < 2) {
          const j = new THREE.Group();
          j.position.set(0, 0, -l);
          parent.add(j);
          segs.push(j);
          parent = j;
        }
      }
      r.add(j1);
      this.joints[f + 1] = segs;
    }
    const t1 = new THREE.Group();                                                          // thumb: inner side, angled out
    t1.position.set(-0.04 * side, -0.004, -0.004);
    t1.rotation.y = 0.6 * side;
    t1.add(mesh(taperBox(0.02, 0.019, 0.032, 0.95), this.glove, 0, 0, -0.016));
    const t2 = new THREE.Group();
    t2.position.set(0, 0, -0.032);
    t2.add(mesh(taperBox(0.018, 0.017, 0.026, 0.9), this.glove, 0, 0, -0.013));
    t1.add(t2);
    r.add(t1);
    this.joints[0] = [t1, t2];
    this.holder.position.set(-0.012 * side, 0.016, -0.065);
    r.add(this.holder);
    this.apply();
  }

  /** Show only the first `n` of thumb · index · middle · ring · pinky (the pinky goes first). */
  setFingers(n: number): void { this.joints.forEach((j, i) => { j[0].visible = i < n; }); }
  setPorcelain(on: boolean, map: THREE.Texture | null): void {
    this.porcelain = on;
    for (const m of [this.glove, this.ringMat]) { m.map = on ? map : null; m.needsUpdate = true; }
    this.refresh();
  }
  setSleeve(c: Hex): void { this.sleeveHex = c; this.refresh(); }
  /** Leather for the glove (GLOVE_IVORY = the old look, no cuff ring). */
  setGlove(c: Hex): void { this.gloveHex = c; this.ring.visible = c !== GLOVE_IVORY; this.refresh(); }
  setLight(v: number): void { if (Math.abs(v - this.light) > 0.004) { this.light = v; this.refresh(); } }
  /** Wristwatch (left hand): shown or hidden. */
  setWatchVisible(on: boolean): void { if (this.watch) this.watch.visible = on; }
  /** 0..1: the watch lifts off the wrist (towards the other hand), in the arm's frame. */
  setWatchLift(v: number): void {
    if (!this.watch) return;
    this.watch.position.set(-0.05 * v, 0.07 * v, 0.066 - 0.05 * v);
    this.watch.rotation.set(0.5 * v, 0, 0.6 * v);
  }
  private refresh(): void {
    const bone = this.porcelain;
    this.glove.color.setHex(bone ? PORCELAIN : this.gloveHex).multiplyScalar(this.light);
    this.ringMat.color.setHex(bone ? PORCELAIN : CUFF_LEATHER).multiplyScalar(this.light);
    this.sleeve.color.setHex(this.sleeveHex).multiplyScalar(this.light);
    for (const [m, c] of this.watchMats) m.color.setHex(c).multiplyScalar(this.light);
  }

  /** Write the pose to the transforms. */
  apply(): void {
    const p = this.pose;
    this.root.position.set(this.home.x + p.px * this.side, this.home.y + p.py, this.home.z + p.pz);
    this.root.rotation.set(this.homeRot.x + p.rx, this.homeRot.y + p.ry * this.side, this.homeRot.z + p.rz * this.side);
    for (let f = 0; f < 5; f++) {
      const c = f === 0 ? p.thumb : f === 1 ? p.index : p.curl;
      const js = this.joints[f];
      for (let s = 0; s < js.length; s++) {
        // negative X curls a −Z-pointing finger towards the palm side; the pinky curls a touch more than the index
        js[s].rotation.x = f === 0 ? -c * FOLLOW[s] : -(c * FOLLOW[s] * (1 + (f - 1) * 0.05) + REST[s]);
      }
    }
  }
  dispose(): void {
    disposeGeometries(this.root);
    this.glove.dispose(); this.ringMat.dispose(); this.sleeve.dispose();
    for (const [m] of this.watchMats) m.dispose();
  }
}

// ── one-shot animations ───────────────────────────────────────────────────────────────────────────
interface AnimFx { coinY: number; coinSpin: number; coinHide: boolean; itemTilt: number; watchLift: number }
interface Anim { dur: number; run(k: number, r: HandPose, l: HandPose, fx: AnimFx): void }
const smooth = (k: number): number => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); };
/** Rises over [a,b], holds, falls over [c,d]. */
const bump = (k: number, a: number, b: number, c: number, d: number): number => smooth((k - a) / (b - a)) * (1 - smooth((k - c) / (d - c)));

const ANIMS: Record<string, Anim> = {
  flip: {
    dur: 0.55,
    run(k, r, _l, fx) {
      fx.coinY = 0.13 * Math.sin(k * Math.PI);
      fx.coinSpin = k * Math.PI * 6;
      r.py += 0.012 * Math.sin(Math.min(1, k * 4) * Math.PI);
      r.rx += 0.25 * bump(k, 0, 0.12, 0.2, 0.4);
    },
  },
  drink: {
    dur: 1.4,
    run(k, r, _l, fx) {
      const up = bump(k, 0.05, 0.4, 0.62, 0.95);
      r.py += 0.2 * up; r.pz += 0.06 * up; r.rx += 0.8 * up; r.rz -= 0.5 * up;
      fx.itemTilt = 1.1 * bump(k, 0.3, 0.45, 0.6, 0.72);
    },
  },
  throw: {
    dur: 0.5,
    run(k, r, _l, fx) {
      const wind = bump(k, 0, 0.28, 0.28, 0.3);
      const fwd = smooth((k - 0.3) / 0.22) * (1 - smooth((k - 0.7) / 0.3));
      r.pz += 0.09 * wind - 0.14 * fwd; r.rx += -0.5 * wind + 0.6 * fwd; r.py += 0.04 * wind;
      fx.coinHide = k > 0.52;
      r.curl = r.index = lerp(0.5, 0, fwd); r.thumb = r.curl * 0.5;
    },
  },
  point: {
    dur: 0.9,
    run(k, r) {
      const a = bump(k, 0, 0.25, 0.7, 1);
      r.pz -= 0.06 * a; r.py += 0.06 * a; r.rx += 0.35 * a;
      r.curl = lerp(r.curl, 1.25, a); r.thumb = lerp(r.thumb, 0.8, a); r.index = lerp(r.index, 0, a);
    },
  },
  punchCard: {
    dur: 0.95,
    run(k, r, l) {
      const push = bump(k, 0.1, 0.38, 0.45, 0.8);
      r.pz -= 0.1 * push; r.py -= 0.07 * push; r.rx -= 0.25 * push;
      l.py += 0.02 * push;
    },
  },
  recoil: {
    dur: 0.4,
    run(k, r, l) {
      const kick = Math.exp(-k * 7) * Math.sin(Math.min(1, k * 6) * Math.PI * 0.5);
      r.pz += 0.1 * kick; l.pz += 0.1 * kick; r.rx += 0.3 * kick; l.rx += 0.3 * kick;
    },
  },
  /** Reach forward and down, open, then close the fist on whatever is on the floor, and bring it back. */
  grab: {
    dur: 0.95,
    run(k, r, _l, fx) {
      const reach = bump(k, 0, 0.38, 0.62, 1);
      const open = bump(k, 0.05, 0.3, 0.4, 0.5);
      const fist = bump(k, 0.42, 0.58, 0.9, 1);
      r.pz -= 0.15 * reach; r.py -= 0.11 * reach; r.rx += 0.55 * reach; r.px -= 0.03 * reach;
      r.curl = lerp(lerp(r.curl, 0.05, open), 1.35, fist);
      r.index = lerp(lerp(r.index, 0.05, open), 1.25, fist);
      r.thumb = lerp(lerp(r.thumb, 0.1, open), 0.9, fist);
      fx.coinHide = k > 0.05 && k < 0.95;
    },
  },
  /** Look at the watch: the left forearm lifts and turns the wrist to the camera. */
  checkWatch: {
    dur: 1.1,
    run(k, _r, l) {
      const a = bump(k, 0, 0.3, 0.72, 1);
      l.py += 0.1 * a; l.pz += 0.03 * a; l.px += 0.02 * a; l.rx -= 0.7 * a; l.rz += 0.5 * a;
    },
  },
  /** Left wrist comes up, the right hand pinches the strap open, and the watch lifts off and is gone. */
  unwatch: {
    dur: 1.2,
    run(k, r, l, fx) {
      const a = bump(k, 0, 0.25, 0.85, 1);
      l.py += 0.1 * a; l.pz += 0.03 * a; l.px += 0.02 * a; l.rx -= 0.7 * a; l.rz += 0.5 * a;
      const b = bump(k, 0.12, 0.4, 0.8, 1);
      r.px -= 0.36 * b; r.py += 0.11 * b; r.pz += 0.01 * b; r.rx += 0.2 * b; r.rz += 0.25 * b;
      r.index = lerp(r.index, 0.55, b); r.thumb = lerp(r.thumb, 0.6, b); r.curl = lerp(r.curl, 0.85, b);
      r.rz += 0.06 * Math.sin(k * 40) * bump(k, 0.4, 0.45, 0.6, 0.66);        // fiddling with the buckle
      fx.watchLift = smooth((k - 0.62) / 0.28);
    },
  },
  give: {
    dur: 0.7,
    run(k, r) {
      const a = bump(k, 0, 0.35, 0.55, 1);
      r.pz -= 0.12 * a; r.py += 0.05 * a; r.rx += 0.3 * a;
      r.curl = r.index = lerp(r.curl, 0, a); r.thumb = lerp(r.thumb, 0.1, a);
    },
  },
  /** Rock, Paper, Promise (W78): a fist pumped twice, then the hand shows. The three poses share the pump. */
  rpsRock: { dur: 1.0, run: (k, r) => rpsThrow(k, r, 1.35, 1.3, 0.9, 0) },
  rpsPaper: { dur: 1.0, run: (k, r) => rpsThrow(k, r, 0.02, 0.02, 0.1, 0) },
  rpsScissors: { dur: 1.0, run: (k, r) => rpsThrow(k, r, 1.3, 0.02, 0.85, 1) },
};

/** The shared pump: up and down twice as a fist (k 0..0.55), then the pose opens to `curl`/`index`/`thumb` and holds. `snip` wags the hand. */
function rpsThrow(k: number, r: HandPose, curl: number, index: number, thumb: number, snip: number): void {
  const lift = bump(k, 0, 0.12, 0.8, 1);
  const pump = k < 0.55 ? Math.sin((k / 0.55) * Math.PI * 2) * 0.5 + 0.5 : 0;
  const show = smooth((k - 0.5) / 0.12);
  r.pz -= 0.08 * lift; r.py += 0.07 * lift + 0.05 * pump * lift; r.rx += 0.35 * lift;
  r.curl = lerp(1.3, curl, show); r.index = lerp(1.25, index, show); r.thumb = lerp(0.9, thumb, show);
  if (snip) r.ry += 0.12 * Math.sin(k * 60) * show * bump(k, 0.55, 0.62, 0.85, 0.95);
}

// ── item models ───────────────────────────────────────────────────────────────────────────────────
type OwnMat = (c: Hex) => THREE.MeshBasicMaterial;

function buildItem(kind: string, m: OwnMat): THREE.Object3D | null {
  const g = new THREE.Group();
  switch (kind) {
    case 'coin':
      g.add(mesh(cylG(0.0125, 0.0125, 0.0035, 10), m(0xf0c048)));
      break;
    case 'card':
      g.add(mesh(boxG(0.042, 0.002, 0.062), m(0xf2ecd8)), mesh(boxG(0.034, 0.0022, 0.054), m(0xb1202c)));
      g.rotation.y = 0.2;
      break;
    case 'tonic':
      g.add(mesh(cylG(0.015, 0.016, 0.07, 8), m(0x4aa58f), 0, 0.03, 0),
            mesh(cylG(0.006, 0.01, 0.03, 8), m(0x4aa58f), 0, 0.077, 0),
            mesh(boxG(0.014, 0.012, 0.014), m(0xb08a3a), 0, 0.098, 0));
      break;
    case 'phone':
      g.add(mesh(boxG(0.05, 0.03, 0.17), m(0x26232a)),
            mesh(boxG(0.058, 0.04, 0.034), m(0x26232a), 0, 0, -0.07),
            mesh(boxG(0.058, 0.04, 0.034), m(0x26232a), 0, 0, 0.07));
      break;
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
    default:
      return null;
  }
  return g;
}

/** Double-barrel shotgun, muzzle toward −Z, origin at the grip. */
function buildGun(m: OwnMat): THREE.Group {
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

// ── viewmodel ─────────────────────────────────────────────────────────────────────────────────────
const RIGHT_HOME = new THREE.Vector3(0.19, -0.165, -0.33);
const RIGHT_ROT = new THREE.Euler(0.42, -0.12, -0.08);
const LEFT_HOME = new THREE.Vector3(-0.2, -0.19, -0.35);
const LEFT_ROT = new THREE.Euler(0.5, 0.14, 0.1);
const GUN_HOME = new THREE.Vector3(0.135, -0.135, -0.3);

export function createViewmodel(sleeveColor: Hex = 0x7a1a20, gloveColor: Hex = GLOVE_LEATHER): ViewmodelHost {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 4);
  const own: THREE.Material[] = [];
  const ownMat: OwnMat = (c) => { const x = mat(c); own.push(x); return x; };
  const right = new Hand(1, sleeveColor, gloveColor, RIGHT_HOME, RIGHT_ROT);
  const left = new Hand(-1, sleeveColor, gloveColor, LEFT_HOME, LEFT_ROT);
  const rig = new THREE.Group();
  rig.add(right.root, left.root);
  scene.add(rig);

  const base = { r: newPose(), l: newPose() };       // grip for the held item
  const live = { r: newPose(), l: newPose() };       // smoothed toward `base`
  const fx: AnimFx = { coinY: 0, coinSpin: 0, coinHide: false, itemTilt: 0, watchLift: 0 };
  const trickCoin = buildItem('coin', ownMat)!;     // the held coin's own mesh, reused for the Q tricks
  trickCoin.visible = false;
  scene.add(trickCoin);
  const fidget = createFidget(right, left, trickCoin);
  let item: HeldItem = 'none';
  let held: THREE.Object3D | null = null;
  let heldOwned = false;
  let gun: THREE.Group | null = null;
  let anim: { name: string; t: number; def: Anim; resolve: () => void } | null = null;
  let visible = true;
  let clock = 0;
  let porcelain = false;
  let porcelainMap: THREE.Texture | null = null;
  let lightLevel = 1;
  // motion inputs
  let bobX = 0, bobY = 0, crouchK = 0, airK = 0, sprintTarget = 0, lookX = 0, lookY = 0;
  let sprintK = 0, swayX = 0, swayY = 0;
  let speed = 0, walkK = 0, walkPhase = 0, watchOn = true;

  const releaseItem = (): void => {
    if (held) { held.removeFromParent(); if (heldOwned) disposeGeometries(held); }
    held = null; heldOwned = false;
    if (gun) { gun.removeFromParent(); disposeGeometries(gun); gun = null; }
  };

  const setBase = (): void => {
    const r = base.r, l = base.l;
    copyPose(r, newPose()); copyPose(l, newPose());
    switch (item) {
      case 'coin': r.index = 0.25; r.thumb = 0.3; r.curl = 0.55; break;
      case 'card': case 'ticket': r.curl = 0.6; r.index = r.thumb = 0.35; break;
      case 'tonic': r.curl = 1.0; r.index = 0.95; r.thumb = 0.7; break;
      case 'phone': r.curl = 0.9; r.index = 0.85; r.thumb = 0.5; r.rx -= 0.2; break;
      case 'ledger': r.curl = l.curl = 0.5; l.py += 0.03; break;
      case 'gun':
        r.px = -0.03; r.py = 0.03; r.pz = -0.08; r.curl = 1.1; r.index = 0.8; r.thumb = 0.7;
        l.px = -0.03; l.py = 0.05; l.pz = -0.28; l.curl = 1.0; l.thumb = 0.7;
        break;
      default: break;
    }
  };

  const vm: ViewmodelHost = {
    scene, camera,
    get item() { return item; },
    setVisible(on) { visible = on; rig.visible = on; if (gun) gun.visible = on; if (!on) fidget.reset(); },
    hold(next, obj) {
      if (next === 'none' && !obj) next = 'coin';           // an empty hand holds a coin: the Q tricks always have one
      fidget.reset();
      releaseItem();
      item = next;
      if (obj) { right.holder.add(obj); held = obj; }
      else if (next === 'gun') {
        gun = buildGun(ownMat);
        gun.position.copy(GUN_HOME);
        gun.visible = visible;
        scene.add(gun);
      } else if (next !== 'none') {
        const built = buildItem(next, ownMat);
        if (built) { right.holder.add(built); held = built; heldOwned = true; }
      }
      setBase();
    },
    play(name) {
      const def = ANIMS[name];
      if (!def) return Promise.resolve();
      fidget.stop();
      anim?.resolve();
      return new Promise<void>((resolve) => { anim = { name, t: 0, def, resolve }; });
    },
    setHandLook(o) {
      if (o.fingers !== undefined) { const n = clamp(Math.round(o.fingers), 0, 5); right.setFingers(n); left.setFingers(n); }
      if (o.porcelain !== undefined) {
        porcelain = o.porcelain;
        right.setPorcelain(porcelain, porcelainMap); left.setPorcelain(porcelain, porcelainMap);
      }
    },
    setPorcelainMap(map) {
      porcelainMap = map;
      if (porcelain) { right.setPorcelain(true, map); left.setPorcelain(true, map); }
    },
    setSleeveColor(c) { right.setSleeve(c); left.setSleeve(c); },
    setGloveColor(c) { right.setGlove(c); left.setGlove(c); },
    setLightLevel(v) { lightLevel = clamp(v, 0.2, 1); },
    setWatch(on) { watchOn = on; left.setWatchVisible(on); },
    drive(d) {
      speed = d.speed ?? 0;
      bobX = d.bobX * 0.4; bobY = d.bobY * 0.4;
      sprintTarget = d.sprint ? 1 : 0;
      crouchK = d.crouch; airK = d.grounded ? 0 : 1;
      lookX = d.lookDx; lookY = d.lookDy;
      if (Math.abs(camera.aspect - d.aspect) > 1e-3) { camera.aspect = d.aspect; camera.updateProjectionMatrix(); }
    },
    update(dt) {
      if (!visible) return;
      clock += dt;
      right.setLight(lightLevel); left.setLight(lightLevel);
      sprintK = damp(sprintK, sprintTarget, 9, dt);
      // sway lags the mouse by ~0.08 s, capped at 3 cm (ART_BIBLE §8.5)
      const rate = 1 / Math.max(dt, 1 / 240);
      swayX = damp(swayX, clamp(-lookX * rate * 0.00004, -0.03, 0.03), 12, dt);
      swayY = damp(swayY, clamp(lookY * rate * 0.00004, -0.03, 0.03), 12, dt);

      // grip → live pose
      const k = 1 - Math.exp(-14 * dt);
      for (const key of POSE_KEYS) { live.r[key] = lerp(live.r[key], base.r[key], k); live.l[key] = lerp(live.l[key], base.l[key], k); }
      copyPose(right.pose, live.r); copyPose(left.pose, live.l);

      // locomotion layers
      const amp = handAmplitude();
      walkK = damp(walkK, clamp(speed / 4, 0, 1.25) * (1 - airK), 6, dt);
      walkPhase += dt * (2.2 + speed * 1.3);
      const calmK = 1 - 0.55 * walkK;                    // breathing fades behind the walk bob
      for (const h of [right, left]) {
        const s = h === right ? 1 : -1, o = h === right ? 0 : 0.8;
        const p = h.pose;
        // breathing: slow, out of phase between the hands, with the fingers loosening on the in-breath
        const br = Math.sin(clock * 1.5 + o);
        p.py += (0.0028 * br + 0.0012 * Math.sin(clock * 0.7 + o * 2)) * calmK * amp;
        p.rx += 0.012 * Math.sin(clock * 1.5 + o + 0.9) * calmK * amp;
        p.rz += 0.009 * Math.sin(clock * 0.9 + o) * s * calmK * amp;
        p.px += 0.0016 * Math.cos(clock * 0.9 + o) * calmK * amp;
        p.curl += 0.025 * br * calmK; p.index += 0.02 * br * calmK;
        // walk bob: two dips per cycle, opposite swing between the hands
        p.py += 0.0055 * Math.sin(walkPhase * 2 + o) * walkK * amp;
        p.pz += 0.006 * Math.cos(walkPhase + o) * s * walkK * amp;
        p.px += 0.004 * Math.sin(walkPhase) * walkK * amp;
        p.rx += 0.03 * Math.sin(walkPhase * 2 + o + 0.7) * walkK * amp;
        p.rz += 0.035 * Math.sin(walkPhase + o) * s * walkK * amp;
        p.py += -0.045 * sprintK + 0.015 * crouchK - 0.01 * airK;
        p.pz += 0.05 * sprintK; p.rx -= 0.3 * sprintK; p.ry += 0.2 * sprintK;
      }

      // one-shot animation / idle coin flip
      fx.coinY = 0; fx.coinSpin = 0; fx.coinHide = false; fx.itemTilt = 0; fx.watchLift = 0;
      if (anim) {
        anim.t += dt;
        anim.def.run(clamp(anim.t / anim.def.dur, 0, 1), right.pose, left.pose, fx);
        if (anim.t >= anim.def.dur) {
          const done = anim; anim = null;
          if (done.name === 'unwatch') { watchOn = false; left.setWatchVisible(false); }
          done.resolve();
        }
      }
      left.setWatchLift(watchOn ? fx.watchLift : 0);
      fidget.tick(dt, right, left, item === 'coin');
      if (held) {
        if (item === 'coin') {
          held.position.set(0, fx.coinY, 0);
          held.rotation.set(fx.coinSpin, 0, 0);
          held.visible = !fx.coinHide && !fidget.busy;
        } else held.rotation.z = fx.itemTilt;
      }
      rig.position.set(swayX + bobX, swayY + bobY, 0);
      if (gun) {
        const recoil = anim?.name === 'recoil' ? Math.exp(-anim.t * 7) : 0;
        gun.position.set(GUN_HOME.x + swayX + bobX, GUN_HOME.y + swayY + bobY - 0.02 * sprintK, GUN_HOME.z + 0.1 * recoil);
        gun.rotation.set(0.12 + 0.3 * recoil, 0.04, 0);
      }
      right.apply(); left.apply();
      scene.updateMatrixWorld(true);
      fidget.place();
    },
    dispose() {
      anim?.resolve(); anim = null;
      fidget.dispose();
      disposeGeometries(trickCoin);
      releaseItem();
      right.dispose(); left.dispose();
      for (const m of own) m.dispose();
      scene.clear();
    },
  };
  vm.hold('coin');                                   // the hand starts with a coin (the Q tricks need one)
  setBase();
  copyPose(live.r, base.r); copyPose(live.l, base.l);
  return vm;
}
