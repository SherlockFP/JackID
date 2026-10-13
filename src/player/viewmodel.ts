/**
 * First-person viewmodel (PLAYER): low-poly gloved hands in their OWN scene, rendered after the world with the
 * depth buffer cleared (`renderer.render(scene, camera, { scene: vm.scene, camera: vm.camera })`), FOV 50, near 0.01
 * (TECH_SPEC §11.7, ART_BIBLE §8.5). Each hand is ~150 tris: palm, 4 two-segment fingers, a 2-segment thumb and a
 * sleeve in the player's jacket colour. Materials are unlit with baked vertex shading (the scene has no lights);
 * `setLightLevel` dims them in dark rooms.
 *
 * Holds (`hold`): coin (default; flips up every 6 s idle), card, tonic, phone, ticket, ledger, gun (two-handed),
 * totem, or any `Object3D` the caller supplies (card fan, totem, scratch coin…). One-shot animations (`play`):
 * flip · drink · throw · point · punchCard · recoil · give. `setHandLook` shows the unsettling finger-tax and
 * porcelain collateral looks. The facade feeds head-bob and look deltas through `drive()` once per frame.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { clamp, damp, lerp } from '@/core/math';
import type { Hex } from '@/core/types';
import type { HeldItem, Viewmodel } from './types';

export interface ViewmodelDrive {
  /** Camera head-bob offsets (m); the hands move 1.5× (ART_BIBLE §8.5). */
  bobX: number; bobY: number;
  sprint: boolean; crouch: number; grounded: boolean;
  /** Mouse delta since the last frame (px). */
  lookDx: number; lookDy: number;
  /** Main camera aspect, so the overlay frustum matches. */
  aspect: number;
}

export interface ViewmodelHost extends Viewmodel {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly item: HeldItem;
  drive(d: ViewmodelDrive): void;
  /** 0..1 brightness of the surroundings. */
  setLightLevel(v: number): void;
  setSleeveColor(c: Hex): void;
  /** Cracked-porcelain texture for the collateral look (optional; a flat bone colour is used without it). */
  setPorcelainMap(map: THREE.Texture | null): void;
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

const GLOVE = 0xe6dec5;
const PORCELAIN = 0xf4eedc;

class Hand {
  readonly root = new THREE.Group();
  /** Where held objects are parented (between thumb and index). */
  readonly holder = new THREE.Object3D();
  readonly pose = newPose();
  private readonly joints: THREE.Group[][] = [];       // [thumb, index, middle, ring, pinky][segment]
  private readonly glove = mat(GLOVE);
  private readonly sleeve: THREE.MeshBasicMaterial;
  private sleeveHex: Hex;
  private porcelain = false;
  private light = 1;

  constructor(private readonly side: 1 | -1, sleeveColor: Hex, private readonly home: THREE.Vector3, private readonly homeRot: THREE.Euler) {
    this.sleeveHex = sleeveColor;
    this.sleeve = mat(sleeveColor);
    const r = this.root;
    r.add(mesh(boxG(0.074, 0.022, 0.08), this.glove));                                    // palm
    const cuff = mesh(boxG(0.082, 0.07, 0.34), this.sleeve, 0, -0.004, 0.2);              // forearm in the jacket sleeve
    cuff.rotation.x = 0.1;
    r.add(cuff);
    const lens = [[0.032, 0.026], [0.036, 0.028], [0.038, 0.03], [0.033, 0.026]];       // index, middle, ring, pinky
    for (let f = 0; f < 4; f++) {
      const [l1, l2] = lens[f];
      const j1 = new THREE.Group();
      j1.position.set((-0.027 + f * 0.018) * side, 0, -0.04);
      j1.add(mesh(boxG(0.0165, 0.016, l1), this.glove, 0, 0, -l1 / 2));
      const j2 = new THREE.Group();
      j2.position.set(0, 0, -l1);
      j2.add(mesh(boxG(0.0145, 0.0145, l2), this.glove, 0, 0, -l2 / 2));
      j1.add(j2);
      r.add(j1);
      this.joints[f + 1] = [j1, j2];
    }
    const t1 = new THREE.Group();                                                          // thumb: inner side, angled out
    t1.position.set(-0.038 * side, -0.002, -0.012);
    t1.rotation.y = 0.55 * side;
    t1.add(mesh(boxG(0.019, 0.019, 0.032), this.glove, 0, 0, -0.016));
    const t2 = new THREE.Group();
    t2.position.set(0, 0, -0.032);
    t2.add(mesh(boxG(0.017, 0.017, 0.026), this.glove, 0, 0, -0.013));
    t1.add(t2);
    r.add(t1);
    this.joints[0] = [t1, t2];
    this.holder.position.set(-0.012 * side, 0.012, -0.075);
    r.add(this.holder);
    this.apply();
  }

  /** Show only the first `n` of thumb · index · middle · ring · pinky (the pinky goes first). */
  setFingers(n: number): void { this.joints.forEach((j, i) => { j[0].visible = i < n; }); }
  setPorcelain(on: boolean, map: THREE.Texture | null): void {
    this.porcelain = on;
    this.glove.map = on ? map : null;
    this.glove.needsUpdate = true;
    this.refresh();
  }
  setSleeve(c: Hex): void { this.sleeveHex = c; this.refresh(); }
  setLight(v: number): void { if (Math.abs(v - this.light) > 0.004) { this.light = v; this.refresh(); } }
  private refresh(): void {
    this.glove.color.setHex(this.porcelain ? PORCELAIN : GLOVE).multiplyScalar(this.light);
    this.sleeve.color.setHex(this.sleeveHex).multiplyScalar(this.light);
  }

  /** Write the pose to the transforms. */
  apply(): void {
    const p = this.pose;
    this.root.position.set(this.home.x + p.px * this.side, this.home.y + p.py, this.home.z + p.pz);
    this.root.rotation.set(this.homeRot.x + p.rx, this.homeRot.y + p.ry * this.side, this.homeRot.z + p.rz * this.side);
    for (let f = 0; f < 5; f++) {
      const c = f === 0 ? p.thumb : f === 1 ? p.index : p.curl;
      this.joints[f][0].rotation.x = -c * 0.95;           // negative X curls a −Z-pointing finger towards the palm side
      this.joints[f][1].rotation.x = -c * 1.1;
    }
  }
  dispose(): void { disposeGeometries(this.root); this.glove.dispose(); this.sleeve.dispose(); }
}

// ── one-shot animations ───────────────────────────────────────────────────────────────────────────
interface AnimFx { coinY: number; coinSpin: number; coinHide: boolean; itemTilt: number }
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
  give: {
    dur: 0.7,
    run(k, r) {
      const a = bump(k, 0, 0.35, 0.55, 1);
      r.pz -= 0.12 * a; r.py += 0.05 * a; r.rx += 0.3 * a;
      r.curl = r.index = lerp(r.curl, 0, a); r.thumb = lerp(r.thumb, 0.1, a);
    },
  },
};

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
const FLIP_EVERY_S = 6;
const GUN_HOME = new THREE.Vector3(0.135, -0.135, -0.3);

export function createViewmodel(sleeveColor: Hex = 0x7a1a20): ViewmodelHost {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.01, 4);
  const own: THREE.Material[] = [];
  const ownMat: OwnMat = (c) => { const x = mat(c); own.push(x); return x; };
  const right = new Hand(1, sleeveColor, RIGHT_HOME, RIGHT_ROT);
  const left = new Hand(-1, sleeveColor, LEFT_HOME, LEFT_ROT);
  const rig = new THREE.Group();
  rig.add(right.root, left.root);
  scene.add(rig);

  const base = { r: newPose(), l: newPose() };       // grip for the held item
  const live = { r: newPose(), l: newPose() };       // smoothed toward `base`
  const fx: AnimFx = { coinY: 0, coinSpin: 0, coinHide: false, itemTilt: 0 };
  let item: HeldItem = 'none';
  let held: THREE.Object3D | null = null;
  let heldOwned = false;
  let gun: THREE.Group | null = null;
  let anim: { name: string; t: number; def: Anim; resolve: () => void } | null = null;
  let visible = true;
  let idleT = 0, clock = 0;
  let porcelain = false;
  let porcelainMap: THREE.Texture | null = null;
  let lightLevel = 1;
  // motion inputs
  let bobX = 0, bobY = 0, crouchK = 0, airK = 0, sprintTarget = 0, lookX = 0, lookY = 0;
  let sprintK = 0, swayX = 0, swayY = 0;

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
    setVisible(on) { visible = on; rig.visible = on; if (gun) gun.visible = on; },
    hold(next, obj) {
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
    setLightLevel(v) { lightLevel = clamp(v, 0.2, 1); },
    drive(d) {
      bobX = d.bobX * 1.5; bobY = d.bobY * 1.5;
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
      const lift = Math.sin(clock * 1.6) * 0.003 - 0.045 * sprintK + 0.015 * crouchK - 0.01 * airK;
      for (const h of [right, left]) {
        h.pose.py += lift; h.pose.pz += 0.05 * sprintK; h.pose.rx -= 0.3 * sprintK; h.pose.ry += 0.2 * sprintK;
      }

      // one-shot animation / idle coin flip
      fx.coinY = 0; fx.coinSpin = 0; fx.coinHide = false; fx.itemTilt = 0;
      if (anim) {
        anim.t += dt;
        anim.def.run(clamp(anim.t / anim.def.dur, 0, 1), right.pose, left.pose, fx);
        if (anim.t >= anim.def.dur) { const done = anim; anim = null; idleT = 0; done.resolve(); }
      } else if (item === 'coin' && (idleT += dt) >= FLIP_EVERY_S) {
        idleT = 0;
        void vm.play('flip');
      }
      if (held) {
        if (item === 'coin') {
          held.position.set(0, fx.coinY, 0);
          held.rotation.set(fx.coinSpin, 0, 0);
          held.visible = !fx.coinHide;
        } else held.rotation.z = fx.itemTilt;
      }
      rig.position.set(swayX + bobX, swayY + bobY, 0);
      if (gun) {
        const recoil = anim?.name === 'recoil' ? Math.exp(-anim.t * 7) : 0;
        gun.position.set(GUN_HOME.x + swayX + bobX, GUN_HOME.y + swayY + bobY - 0.02 * sprintK, GUN_HOME.z + 0.1 * recoil);
        gun.rotation.set(0.12 + 0.3 * recoil, 0.04, 0);
      }
      right.apply(); left.apply();
    },
    dispose() {
      anim?.resolve(); anim = null;
      releaseItem();
      right.dispose(); left.dispose();
      for (const m of own) m.dispose();
      scene.clear();
    },
  };
  setBase();
  copyPose(live.r, base.r); copyPose(live.l, base.l);
  return vm;
}
