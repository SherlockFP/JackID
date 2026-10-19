/**
 * The first-person arms (PLAYER): the CC0 "PSX First Person Arms" rig (drillimpact, `public/assets/vendor/drillimpact-psx-arms/`,
 * docs/ASSETS.md): one skinned mesh of 1176 triangles on 52 bones, 18 clips, fingerless leather gloves (or bare hands).
 * Loaded once; each viewmodel gets its own clone (`SkeletonUtils.clone`) with a PSX material on the 128 px vendor texture.
 *
 * Two layers move the arms, both on sim time:
 *  - the clips (`Arms.drive`): a clip is cut into a right-arm and a left-arm clip, so each arm blends on its own (the right hand can
 *    push while the left stays relaxed). `relax` loops under everything; an override clip is slaved to the caller's phase
 *    (0..1) and fades in and out with the caller's weight. The weights always add up to 1.
 *  - the pose (`HandPose`, see `Arm.apply`): the same additive offsets the old procedural glove used (breathing, walk bob, a lift to
 *    the mouth, a wrist roll), written onto the shoulder bone as one rigid move of the whole arm around the wrist, plus the
 *    finger curls on the finger bones and a springy wrist: so everything the facade and the coin tricks wrote still works.
 *
 * The mixer skips a track whose value did not change, so a bone I moved last frame would keep the move: every bone I touch is put
 * back to the clip's pose (`restore`) before the mixer runs and snapshotted after it.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { app } from '@/core/app';
import { clamp } from '@/core/math';
import { log } from '@/core/log';
import { psxMaterial } from '@/core/renderer/psxMaterial';

const GLB = `${import.meta.env.BASE_URL}assets/vendor/drillimpact-psx-arms/arms_rig.glb`;

/** Pose of one hand relative to its clip: offsets (m / rad), the wrist (`wp` fingers up, `wr` roll about the hand's own axis) and finger curls (rad-ish, 0 = straight, 0.3 = as the clip has them). */
export interface HandPose { px: number; py: number; pz: number; rx: number; ry: number; rz: number; curl: number; index: number; thumb: number; middle: number; wp: number; wr: number }
export const POSE_KEYS = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'curl', 'index', 'thumb', 'middle', 'wp', 'wr'] as const;
export const newPose = (): HandPose => ({ px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, curl: 0.3, index: 0.3, thumb: 0.2, middle: 0, wp: 0, wr: 0 });
export const copyPose = (to: HandPose, from: HandPose): void => { for (const k of POSE_KEYS) to[k] = from[k]; };

/** Gloves on (dark leather, the default) or off (bare hands: the old ivory glove colour is the marker). */
export const GLOVE_LEATHER = 0x4a2110;
export const GLOVE_IVORY = 0xe6dec5;
const PORCELAIN = 0xf4eedc;

/** The model is human size; the viewmodel camera sits close, so it is scaled down and placed so both hands read in frame. */
export const ARMS_SCALE = 0.55;
/** The scale the grips, HOLD_AT and the coin tricks were solved at: held things scale with the arms by ARMS_UNIT. */
const GRIP_REF = 0.75;
export const ARMS_UNIT = ARMS_SCALE / GRIP_REF;
const ARMS_AT = { x: 0, y: -0.06, z: -0.11 };
/** Both hands sit this much closer to the middle than the model has them (m). */
const HOME_IN = -0.02;
/** The model's camera bone: the viewmodel camera is where it sits (model y, m). */
const EYE_Y = 1.743;
/** Where the coin is held (palm space, right hand): the pinch of thumb and fingers on the back of the hand. Other items are placed by their grip, relative to it. */
export const HOLD_AT = [-0.028, 0.01, -0.06] as const;
/** The palm centre, on the hand bone (bone units), and the neutral curl the clips already carry. */
const PALM_Y = 0.06, NEUTRAL_CURL = 0.3;
/** How far each segment follows a curl: fingers (knuckle, middle, tip) and thumb. */
const FOLLOW = [[0.5, 0.8, 0.8], [0.95, 1.1, 0.8], [0.95, 1.1, 0.8], [0.95, 1.1, 0.8], [0.95, 1.1, 0.8]];
const DIGITS = ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'];
/** Spring rate of each digit's closing (thumb, index, middle, ring, pinky): the outer fingers close a beat later. */
const CLOSE_RATE = [21, 25, 23, 21, 19];

/** Spring of one number (position `x`, velocity `v`), integrated in small steps so any frame time is stable. */
export interface Spring { x: number; v: number }
export function spring(s: Spring, target: number, rate: number, damping: number, dt: number): void {
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (rate * rate * (target - s.x) - 2 * damping * rate * s.v) * h;
    s.x += s.v * h;
  }
}

// ── the shared source ─────────────────────────────────────────────────────────────────────────────
export interface ArmsSource { scene: THREE.Object3D; clips: Map<string, THREE.AnimationClip> }
export function armsFromGltf(g: GLTF): ArmsSource {
  g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.userData.shared = true; m.frustumCulled = false; } });
  return { scene: g.scene, clips: new Map(g.animations.map((c) => [c.name, c])) };
}
let loading: Promise<ArmsSource | null> | null = null;
/** Fetch and parse the GLB once. Resolves null (one warning) when it cannot be loaded: the player then has no hands. */
export function loadArms(): Promise<ArmsSource | null> {
  loading ??= new GLTFLoader().loadAsync(GLB).then(armsFromGltf).catch((e: unknown): null => {
    log.warnOnce('arms-glb', 'player', 'first-person arms GLB failed to load: no hands', e);
    return null;
  });
  return loading;
}

// ── one arm ───────────────────────────────────────────────────────────────────────────────────────
interface Saved { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }
const _D = new THREE.Matrix4(), _M = new THREE.Matrix4(), _I = new THREE.Matrix4(), _E = new THREE.Euler(), _V = new THREE.Vector3();

export class Arm {
  readonly pose = newPose();
  /** Turn of the forearm about its own axis (rad), added to the clip's. */
  roll = 0;
  /** Hangs from the hand bone; its frame is the hand frame (fingers towards −Z, back of the hand +Y, 1 unit = 1 m of the viewmodel) the coin tricks anchor to. */
  readonly palm = new THREE.Group();
  /** Where held objects are parented (`HOLD_AT`). */
  readonly holder = new THREE.Object3D();
  private shoulder: THREE.Object3D | null = null;
  private hand!: THREE.Object3D;
  /** The forearm bone (the watch sits on it). */
  forearm!: THREE.Object3D;
  private digits: THREE.Object3D[][] = [];             // [thumb, index, middle, ring, pinky][segment]
  private saved: Saved[] = [];
  private shown = 5;
  private readonly digit: Spring[] = [0, 1, 2, 3, 4].map(() => ({ x: 0, v: 0 }));
  private readonly lag = { rx: { x: 0, v: 0 }, y: { x: 0, v: 0 } };
  private primed = false;
  /** The wrist as a bone-local axis: `rotateOnAxis` with this lifts the fingers. */
  private pitch = new THREE.Vector3(0, 0, 1);

  constructor(readonly side: 1 | -1) {
    const b = side === 1 ? [[0, 0, -1], [1, 0, 0], [0, -1, 0]] : [[0, 0, 1], [-1, 0, 0], [0, -1, 0]];
    this.palm.setRotationFromMatrix(new THREE.Matrix4().makeBasis(...b.map(([x, y, z]) => new THREE.Vector3(x, y, z)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
    this.palm.position.y = PALM_Y;
    this.palm.scale.setScalar(1 / GRIP_REF);
    this.holder.position.set(HOLD_AT[0] * side, HOLD_AT[1], HOLD_AT[2]);
    this.palm.add(this.holder);
    this.pitch.z = side === 1 ? -1 : 1;
  }

  /** Find this arm's bones in the model and hang the palm frame from the hand. Throws when one is missing (the caller shows no hands). */
  bind(model: THREE.Object3D): void {
    const S = this.side === 1 ? 'R' : 'L';
    const get = (n: string): THREE.Object3D => { const o = model.getObjectByName(n + S); if (!o) throw new Error(`arms rig: no bone ${n + S}`); return o; };
    this.shoulder = get('shoulder'); this.hand = get('hand');
    this.forearm = get('forearm');
    this.digits = DIGITS.map((d) => [1, 2, 3].map((i) => get(`${d}0${i}`)));
    this.saved = [this.shoulder, this.hand, this.forearm, ...this.digits.flat()].map((o) => ({ o, p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }));
    this.snapshot();
    this.hand.add(this.palm);
  }

  /** Show only the first `n` of thumb · index · middle · ring · pinky (the pinky goes first). */
  setFingers(n: number): void { this.shown = n; }

  private snapshot(): void { for (const s of this.saved) { s.p.copy(s.o.position); s.q.copy(s.o.quaternion); s.s.copy(s.o.scale); } }

  /** Before the mixer runs: every bone I moved last frame goes back to the clip's pose. */
  restore(): void { for (const s of this.saved) { s.o.position.copy(s.p); s.o.quaternion.copy(s.q); s.o.scale.copy(s.s); } }

  /**
   * After the mixer and `updateMatrixWorld`: snapshot the clip's pose, then add the pose on top: the wrist lags the arm and settles,
   * every digit closes on its own spring, and the whole arm moves rigidly around the wrist. `t` is the running clock (finger
   * breathing), `amp` scales the secondary motion (settings: head bob, Calm), `dt` is sim time (0 = jump straight to the pose).
   */
  apply(dt: number, t: number, amp: number): void {
    const sh = this.shoulder;
    if (!sh) return;
    this.snapshot();
    const p = this.pose, s = this.side;

    // the wrist: the hand trails the arm's pitch and lift, then settles with a little overshoot
    const step = Math.min(dt, 0.1), snap = !this.primed || step <= 0;
    const L = this.lag;
    if (snap) { L.rx.x = p.rx; L.y.x = p.py; L.rx.v = L.y.v = 0; }
    else { spring(L.rx, p.rx, 15, 0.55, step); spring(L.y, p.py, 13, 0.5, step); }
    this.hand.rotateOnAxis(this.pitch, clamp(((L.rx.x - p.rx) * 0.6 + (L.y.x - p.py) * 4) * amp, -0.26, 0.26) + p.wp);
    this.hand.rotateY(p.wr * s);

    this.forearm.rotateY(this.roll);

    // the fingers: each closes on its own spring, the outer ones later; a hidden digit collapses
    const base = [p.thumb, p.index, p.curl + p.middle, p.curl * 1.05, p.curl * 1.1];
    for (let f = 0; f < 5; f++) {
      const open = 1 - clamp(base[f], 0, 1);
      const target = base[f] + 0.025 * Math.sin(t * 1.3 + f * 1.1 + (s < 0 ? 1.7 : 0)) * open * amp;
      const d = this.digit[f];
      if (snap) { d.x = target; d.v = 0; } else spring(d, target, CLOSE_RATE[f], 0.62, step);
      const js = this.digits[f];
      for (let k = 0; k < 3; k++) js[k].rotateX((d.x - NEUTRAL_CURL) * FOLLOW[f][k]);
      js[0].scale.setScalar(f < this.shown ? 1 : 0.001);
    }
    this.primed = true;

    // the arm: offset and turn it around the wrist, in viewmodel space (the left arm mirrors px, ry, rz)
    _V.setFromMatrixPosition(this.hand.matrixWorld);
    _E.set(p.rx, p.ry * s, p.rz * s);
    _D.makeTranslation(_V.x + (p.px - HOME_IN) * s, _V.y + p.py, _V.z + p.pz).multiply(_M.makeRotationFromEuler(_E)).multiply(_I.makeTranslation(-_V.x, -_V.y, -_V.z));
    const pw = sh.parent!.matrixWorld;
    _M.copy(pw).invert().multiply(_D).multiply(pw);          // the same move in the parent's frame
    sh.updateMatrix();
    sh.matrix.premultiply(_M).decompose(sh.position, sh.quaternion, sh.scale);
    sh.updateMatrixWorld(true);
  }
}

// ── the rig ───────────────────────────────────────────────────────────────────────────────────────
/** A clip asked for on one arm: `w` its weight (the rest goes to `relax`), `t` the phase 0..1 of the clip. */
export interface ClipReq { clip: string; w: number; t: number }

export class Arms {
  /** The model, turned to look down −Z, scaled, with its camera bone at the origin. */
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly acts = new Map<string, THREE.AnimationAction>();
  private readonly material: THREE.MeshBasicMaterial;
  private bare = false;
  private porcelain: THREE.Texture | null = null;
  private porcelainOn = false;
  private light = 1;

  constructor(private readonly src: ArmsSource, readonly right: Arm, readonly left: Arm) {
    this.model = SkeletonUtils.clone(src.scene);
    right.bind(this.model); left.bind(this.model);
    this.material = psxMaterial({ color: 0xffffff, lit: false, side: 'double', unique: true }) as THREE.MeshBasicMaterial;
    this.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = this.material; });
    this.root.add(this.model);
    this.root.rotation.y = Math.PI;                     // the model faces +Z
    this.root.scale.setScalar(ARMS_SCALE);
    this.root.position.set(ARMS_AT.x, ARMS_AT.y - EYE_Y * ARMS_SCALE, ARMS_AT.z);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.setGlove(false);
    this.look();
    this.action('relax', right)!.time = 0; this.action('relax', left)!.time = 0.8;   // the hands breathe a beat apart
    this.step(0, 0, 0);
  }

  /** Bare hands (the old ivory glove) or the leather gloves. */
  setGlove(bare: boolean): void { this.bare = bare; this.look(); }
  setPorcelain(on: boolean, map: THREE.Texture | null): void { this.porcelainOn = on; this.porcelain = map; this.look(); }
  setLight(v: number): void { if (Math.abs(v - this.light) > 0.004) { this.light = v; this.look(); } }
  private look(): void {
    const m = this.material;
    const tex = this.porcelainOn ? this.porcelain : app?.tex?.vendor(`drillimpact-psx-arms/${this.bare ? 'arms_01' : 'arms_gloves_01'}.png`, { size: 128, flipY: true });
    if (m.map !== (tex ?? null)) { m.map = tex ?? null; m.needsUpdate = true; }
    m.color.setHex(this.porcelainOn ? PORCELAIN : 0xffffff).multiplyScalar(this.light);
  }

  /** The clip cut to one arm: only that side's bones (names end in R or L), no scale tracks. */
  private action(clip: string, arm: Arm): THREE.AnimationAction | null {
    const S = arm.side === 1 ? 'R' : 'L', key = `${clip}.${S}`;
    let a = this.acts.get(key) ?? null;
    if (a) return a;
    const full = this.src.clips.get(clip);
    if (!full) return null;
    const own = new THREE.AnimationClip(key, full.duration, full.tracks.filter((t) => t.name.split('.')[0].endsWith(S) && !t.name.endsWith('.scale')));
    a = this.mixer.clipAction(own);
    a.play();
    if (clip !== 'relax') { a.paused = true; a.weight = 0; }
    this.acts.set(key, a);
    return a;
  }

  /**
   * Set what one arm plays: `reqs` (override clips, weights above 1 scaled down) and `relax` for the rest. The override clips are
   * slaved to their phase `t`, so the caller owns the timing; `relax` loops on the mixer's own time.
   */
  drive(arm: Arm, reqs: readonly ClipReq[]): void {
    const S = arm.side === 1 ? 'R' : 'L';
    const relax = this.action('relax', arm)!;
    let sum = 0;
    for (const r of reqs) sum += r.w;
    const k = sum > 1 ? 1 / sum : 1;
    for (const [key, a] of this.acts) if (key.endsWith(`.${S}`) && key !== `relax.${S}`) a.weight = 0;
    for (const r of reqs) {
      const a = this.action(r.clip, arm);
      if (!a) continue;
      a.weight = r.w * k;
      a.time = clamp(r.t, 0, 1) * a.getClip().duration;
    }
    relax.weight = Math.max(0, 1 - sum * k);
  }

  /** One frame: the bones go back to the clip pose, the mixer advances `dt` of sim time, the arms add their pose. */
  step(dt: number, clock: number, amp: number): void {
    this.right.restore(); this.left.restore();
    this.mixer.update(dt);
    this.root.updateWorldMatrix(true, true);                // the parents too: the rig may have moved this frame
    this.right.apply(dt, clock, amp); this.left.apply(dt, clock, amp);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.material.dispose();
    this.root.removeFromParent();
  }
}
