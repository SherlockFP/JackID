/**
 * Animated mannequin actors (BRIEF Addendum 4): the Quaternius Universal Animation Library GLB (one skinned
 * humanoid, 43 clips) loaded ONCE, cloned per actor with `SkeletonUtils.clone`, re-skinned with PSX materials.
 *
 *  - one `AnimationMixer` per actor; clips are shared; crossfades are mixer weights;
 *  - PSX stop-motion: the mixer is advanced in `1 / stepFps` chunks (default 15 fps) with a per-actor phase, root motion
 *    and head tracking stay smooth;
 *  - looks (`style`): plain wood-doll, cracked porcelain, translucent ghost, black shadow, the Collector;
 *  - procedural head-turn (`lookAt`) blended over the clip, bone attachments queued until the GLB has arrived;
 *  - until the GLB is parsed the actor is a small procedural doll, swapped in place (no pop of the root transform).
 *
 * The GLB faces +Z with its origin at the feet; bones follow the Blender convention (local +Y runs along the bone,
 * the `root` bone is rotated −90° about X), so attachment offsets are given in that bone space (see props.ts hints).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Hex, V3 } from '@/core/types';
import { log } from '@/core/log';
import { disposeObject3D } from '@/core/dispose';
import { GLSL_CRACKS, patchShader, psx } from './materials';
import { mixHex, scaleHex, PAL } from './palette';
import { VENDOR_PATHS } from './presets';
import type { KitCtx } from './ctx';
import { MANNEQUIN_CLIPS, MANNEQUIN_GLB, type Kit, type MannequinActor, type MannequinBone, type MannequinClip, type MannequinOpts, type MannequinPlayOpts } from './types';

const D2R = Math.PI / 180;
const DEFAULT_HEIGHT = 1.75;
const DEFAULT_STEP_FPS = 15;
const FACE_DEFAULT = 0xd9c7a3;                  // unpainted wood-doll
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ── shared source ───────────────────────────────────────────────────────────────────────────────
interface Source {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  height: number;
}
let source: Source | null = null;
let loading: Promise<Source | null> | null = null;

/** Fetch + parse the GLB once. Resolves `null` (and logs) when the file cannot be loaded. */
export function loadMannequinSource(): Promise<Source | null> {
  if (source) return Promise.resolve(source);
  loading ??= new GLTFLoader().loadAsync(MANNEQUIN_GLB).then((gltf): Source => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.frustumCulled = true;
      const geo = sm.geometry;
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      // very soft height gradient baked into vertex colours: grounds the feet, lifts the head (no normals: it animates)
      const pos = geo.getAttribute('position');
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = 0.8 + 0.2 * smooth(0, 1.6, pos.getY(i));
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.userData.shared = true;
    });
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of gltf.animations) clips.set(c.name, c);
    source = { scene, clips, height: Math.max(0.5, box.max.y - Math.min(0, box.min.y)) };
    return source;
  }).catch((e: unknown): null => {
    log.warn('kit', 'mannequin GLB failed to load — actors stay placeholders', e);
    return null;
  });
  return loading;
}

// ── materials per style ─────────────────────────────────────────────────────────────────────────
interface Look { main: Hex; joints: Hex; lit: boolean; opacity: number; emissive?: Hex; cracks?: boolean; coat?: boolean }
function lookOf(o: MannequinOpts): Look {
  const c = o.color;
  switch (o.style) {
    case 'porcelain': {
      const base = c === undefined ? 0xefe8d6 : mixHex(0xefe8d6, c, 0.3);
      return { main: base, joints: o.jointColor ?? mixHex(base, PAL.BONE, 0.6), lit: true, opacity: 1, cracks: true };
    }
    case 'ghost': return { main: c ?? PAL.ICE, joints: o.jointColor ?? PAL.PAPER, lit: false, opacity: 0.5 };
    case 'shadow': return { main: c ?? 0x07070b, joints: o.jointColor ?? 0x120d18, lit: true, opacity: 1, emissive: 0x1c0a2e };
    case 'collector': return { main: c ?? 0x12121a, joints: o.jointColor ?? PAL.GOLD, lit: true, opacity: 1, coat: true };
    default: {
      const main = c ?? FACE_DEFAULT;
      return { main, joints: o.jointColor ?? scaleHex(main, 0.55), lit: true, opacity: 1 };
    }
  }
}

/** What the dealer rig (dealer.ts) needs on top of the public actor. */
export interface MannequinInternal extends MannequinActor {
  /** Dispose `obj` (a prop built for this actor) together with the actor. */
  own(obj: THREE.Object3D): void;
  /** Freeze / thaw the mixer at runtime (distance LOD). */
  setFrozen(on: boolean): void;
  addProc(names: readonly string[]): void;
  onPose(fn: (dt: number) => void, phase?: 'pre' | 'post'): () => void;
  readonly faceAxis: THREE.Vector3;
}

interface Pending { clip: string; o: MannequinPlayOpts; resolve: () => void }
interface Attachment { obj: THREE.Object3D; bone: string; o?: { pos?: V3; rot?: V3; scale?: number }; live: boolean }

/** At most this many visible mannequins run their mixer per frame (C13); the rest freeze, nearest first. */
const MAX_ACTIVE = 12;
/** Mannequins farther than this from the LOD camera freeze and hide (metres). */
const LOD_FAR = 20;

export function makeMannequins(ctx: KitCtx, makeProp: (id: string) => THREE.Group): Pick<Kit, 'loadMannequin'> & { mannequin(o?: MannequinOpts): MannequinInternal; update(dt: number): void; setLodCamera(cam: THREE.Camera | null): void } {
  const actors = new Set<WeakRef<Actor>>();
  let serial = 0;
  let lodCam: THREE.Camera | null = null;
  const lodPos = new THREE.Vector3();

  class Actor implements MannequinInternal {
    readonly root = new THREE.Group();
    readonly ready: Promise<void>;
    isReady = false;
    clip: string | null = null;
    readonly clips: readonly string[];

    private readonly look: Look;
    private readonly height: number;
    private stepFps: number | null;
    /** Frozen by the caller (`setFrozen`, or `frozen` in the options). */
    private pinned: boolean;
    /** Frozen by the distance / visibility LOD pass (`makeMannequins.update`). */
    private lod = false;
    /** Hidden by the distance LOD (folded into `root.visible`; the owner's own visibility stays in `ownVis`). */
    private lodHidden = false;
    private ownVis = true;
    private mixer: THREE.AnimationMixer | null = null;
    private rig: THREE.Object3D | null = null;
    private placeholder: THREE.Group | null = null;
    private readonly bones = new Map<string, THREE.Object3D>();
    private mats: THREE.MeshLambertMaterial[] = [];
    private current: THREE.AnimationAction | null = null;
    private playing: { resolve: () => void; action: THREE.AnimationAction } | null = null;
    private pending: Pending | null = null;
    private readonly attachments: Attachment[] = [];
    private readonly owned: THREE.Object3D[] = [];
    private baseColors: Hex[] = [];
    private tint: { color: Hex; amount: number } | null = null;
    private opacity = 1;
    private speed = 1;
    private acc: number;
    private disposed = false;
    private readonly initialClip: string;
    private baseLoop: string;
    private readonly selfRef: WeakRef<Actor>;
    private readonly initialMask: string | null;
    // head tracking
    private lookGoal = 0;
    private lookW = 0;
    private lookRate = 4;
    private readonly lookTarget = new THREE.Vector3();
    private readonly faceLocal = new THREE.Vector3(0, 0, 1);
    /** Bones whose animated pose is captured after every mixer step and restored before procedural layers run. */
    private readonly procNames: string[] = ['neck_01', 'Head'];
    private readonly procAnim = new Map<string, THREE.Quaternion>();
    private readonly pre: Array<(dt: number) => void> = [];
    private readonly post: Array<(dt: number) => void> = [];

    constructor(o: MannequinOpts) {
      this.look = lookOf(o);
      this.height = o.height ?? DEFAULT_HEIGHT;
      this.stepFps = o.stepFps === undefined ? DEFAULT_STEP_FPS : o.stepFps;
      this.pinned = !!o.frozen;
      this.initialClip = o.clip ?? 'Idle_Loop';
      this.baseLoop = this.initialClip;
      this.initialMask = o.mask ?? null;
      this.clips = [...MANNEQUIN_CLIPS];
      this.root.name = 'mannequin';
      this.root.userData.kitKeep = true;                  // finalize must never merge or prune a live actor
      // `root.visible` = the owner's flag AND not LOD-hidden, so owners keep their plain `visible` API
      Object.defineProperty(this.root, 'visible', {
        configurable: true, enumerable: true,
        get: () => this.ownVis && !this.lodHidden,
        set: (v: boolean) => { this.ownVis = v; },
      });
      this.acc = ((serial++ * 0.6180339887) % 1) / (this.stepFps ?? DEFAULT_STEP_FPS);   // de-synchronise the 15 fps ticks
      this.buildPlaceholder();
      this.selfRef = new WeakRef(this);
      actors.add(this.selfRef);
      if (source) { this.ready = Promise.resolve(); this.build(source); }
      else this.ready = loadMannequinSource().then((s) => {
        try { if (s && !this.disposed) this.build(s); } catch (e) { log.error('kit', e); }
      });
    }

    // ── construction ──
    private buildPlaceholder(): void {
      const { P } = ctx;
      const g = new THREE.Group();
      const h = this.height, c = this.look.main;
      P.cyl(0.13 * h / 1.75, 0.1 * h / 1.75, h * 0.34, { color: c, vertexColors: true }, { pos: [0, h * 0.62, 0], seg: 6, parent: g });
      P.sphere(0.1 * h / 1.75, { color: c, vertexColors: true }, { pos: [0, h * 0.89, 0], wSeg: 6, hSeg: 4, parent: g });
      P.cyl(0.045, 0.045, h * 0.45, { color: this.look.joints, vertexColors: true }, { pos: [-0.09, h * 0.22, 0], seg: 5, parent: g });
      P.cyl(0.045, 0.045, h * 0.45, { color: this.look.joints, vertexColors: true }, { pos: [0.09, h * 0.22, 0], seg: 5, parent: g });
      this.placeholder = g;
      this.root.add(g);
    }

    private build(src: Source): void {
      const rig = SkeletonUtils.clone(src.scene);
      rig.name = 'mannequin_rig';
      const scale = this.height / src.height;
      rig.scale.setScalar(scale);
      this.mats = [];
      let skinned = 0;
      rig.traverse((n) => {
        if ((n as THREE.Bone).isBone) this.bones.set(n.name, n);
        const sm = n as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        const matName = (sm.material as THREE.Material).name;
        const joint = matName ? /joint/i.test(matName) : skinned > 0;
        skinned++;
        const base = joint ? this.look.joints : this.look.main;
        const m = psx({
          color: base, vertexColors: true, lit: this.look.lit,
          transparent: this.look.opacity < 1, opacity: this.look.opacity, depthWrite: this.look.opacity >= 1,
          emissive: this.look.emissive ?? 0, unique: true,
        }) as THREE.MeshLambertMaterial;
        if (this.look.cracks) {
          patchShader(m, 'cracks', {
            vertexDecl: 'varying vec3 vPsxObj;',
            vertexAfterBegin: 'vPsxObj = transformed;',
            fragDecl: `varying vec3 vPsxObj;
${GLSL_CRACKS}`,
            fragAfterColor: 'diffuseColor.rgb *= mix(vec3(0.22, 0.17, 0.2), vec3(1.0), psxCrack(vPsxObj * 6.0));',
          });
        }
        this.mats.push(m);
        this.baseColors.push(base);
        sm.material = m;
        // generous fixed bounds: every clip (arms thrown wide, roll, death) stays inside, so limbs never get culled early
        sm.computeBoundingSphere();
        if (sm.boundingSphere) { sm.boundingSphere.center.set(0, 0.9, 0); sm.boundingSphere.radius = 1.6; }
        sm.frustumCulled = true;
      });
      if (this.placeholder) {
        this.root.remove(this.placeholder);
        this.placeholder.traverse((n) => { const me = n as THREE.Mesh; if (me.isMesh) me.geometry.dispose(); });
        this.placeholder = null;
      }
      this.rig = rig;
      this.root.add(rig);
      rig.updateMatrixWorld(true);
      // face axis of the head bone in rest pose (root faces +Z)
      const head = this.bones.get('Head');
      if (head) {
        const qh = head.getWorldQuaternion(new THREE.Quaternion());
        const qr = this.root.getWorldQuaternion(new THREE.Quaternion());
        this.faceLocal.set(0, 0, 1).applyQuaternion(qh.invert().multiply(qr));
      }
      this.mixer = new THREE.AnimationMixer(rig);
      this.mixer.timeScale = this.speed;
      this.mixer.addEventListener('finished', (e) => this.onFinished(e as unknown as { action: THREE.AnimationAction }));
      this.isReady = true;
      this.applyTintAndOpacity();
      if (this.initialMask) { const m = makeProp(this.initialMask); this.own(m); this.attach(m, 'Head'); }
      if (this.look.coat) { const coat = makeProp('coat_long'); this.own(coat); this.attach(coat, 'pelvis'); }
      for (const a of this.attachments) if (!a.live) this.mount(a);
      const first = this.pending ?? { clip: this.initialClip, o: { fade: 0 }, resolve: () => {} };
      this.pending = null;
      void this.play(first.clip, first.o).then(first.resolve);
      this.mixer.update(0);
      this.captureAnimPose();
    }

    // ── playback ──
    play(clip: MannequinClip | string, o: MannequinPlayOpts = {}): Promise<void> {
      if (this.disposed) return Promise.resolve();
      if (!this.mixer || !this.rig) {
        this.pending?.resolve();
        return new Promise<void>((resolve) => { this.pending = { clip, o, resolve }; });
      }
      const c = source?.clips.get(clip);
      if (!c) { log.warnOnce(`mannequin:clip:${clip}`, 'kit', `unknown mannequin clip "${clip}"`); return Promise.resolve(); }
      const loop = o.loop ?? clip.endsWith('_Loop');
      const next = this.mixer.clipAction(c);
      const fade = o.fade ?? 0.2;
      if (this.playing) { this.playing.resolve(); this.playing = null; }
      next.reset();
      next.enabled = true;
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      next.clampWhenFinished = !loop && !!o.hold;
      next.timeScale = o.speed ?? 1;
      next.time = o.at ?? 0;
      next.setEffectiveWeight(1);
      const prev = this.current;
      if (prev && prev !== next && fade > 0) next.crossFadeFrom(prev, fade, false);
      else if (prev && prev !== next) prev.stop();
      else if (fade > 0 && !prev) next.fadeIn(fade);
      next.play();
      this.current = next;
      this.clip = clip;
      if (o.at !== undefined || fade <= 0) { this.mixer.update(0); this.captureAnimPose(); }
      if (loop) { this.baseLoop = clip; return Promise.resolve(); }
      const done = new Promise<void>((resolve) => { this.playing = { resolve, action: next }; this.oneShotHold = !!o.hold; });
      if (this.isFrozen) this.finishOneShot();          // a frozen actor never advances: the one-shot completes now
      return done;
    }
    private oneShotHold = false;

    get isFrozen(): boolean { return this.pinned || this.lod; }
    get disposedNow(): boolean { return this.disposed; }

    /** Jump the running one-shot to its last frame and resolve it (used when the actor freezes). */
    private finishOneShot(): void {
      const p = this.playing;
      if (!p || !this.mixer) return;
      this.playing = null;
      p.action.time = p.action.getClip().duration;
      this.mixer.update(0);
      this.captureAnimPose();
      if (!this.oneShotHold && !this.disposed) void this.play(this.baseLoop, { fade: 0 });
      p.resolve();
    }

    /** Visibility the owner asked for (ignores the distance LOD). */
    get ownVisible(): boolean { return this.ownVis; }
    /** Called by the LOD pass (`lodPass`): hide the actor while it is beyond `LOD_FAR`. */
    setLodHidden(on: boolean): void { this.lodHidden = on; }
    /** Called by the LOD pass (`lodPass`): freeze while far, hidden or beyond the active cap. */
    setLodState(on: boolean): void {
      if (this.lod === on) return;
      const was = this.isFrozen;
      this.lod = on;
      if (!was && this.isFrozen) this.finishOneShot();
    }

    private onFinished(e: { action: THREE.AnimationAction }): void {
      if (!this.playing || e.action !== this.playing.action) return;
      const { resolve } = this.playing;
      this.playing = null;
      if (!this.oneShotHold && !this.disposed) void this.play(this.baseLoop, { fade: 0.2 });
      resolve();
    }

    stop(fade = 0.2): void {
      this.current?.fadeOut(fade);
      this.current = null;
      this.clip = null;
      if (this.playing) { this.playing.resolve(); this.playing = null; }
    }
    setSpeed(k: number): void { this.speed = k; if (this.mixer) this.mixer.timeScale = k; }
    setStepFps(fps: number | null): void { this.stepFps = fps; }

    // ── look ──
    setTint(color: Hex | null, amount = 1): void { this.tint = color === null ? null : { color, amount }; this.applyTintAndOpacity(); }
    setOpacity(a: number): void { this.opacity = Math.max(0, Math.min(1, a)); this.applyTintAndOpacity(); }
    setVisible(on: boolean): void { this.root.visible = on; }
    private applyTintAndOpacity(): void {
      for (let i = 0; i < this.mats.length; i++) {
        const m = this.mats[i];
        m.color.setHex(this.tint ? mixHex(this.baseColors[i], this.tint.color, this.tint.amount) : this.baseColors[i]);
        const op = this.look.opacity * this.opacity;
        m.opacity = op;
        m.transparent = op < 0.999;
        m.depthWrite = op >= 0.999;
        m.visible = op > 0.004;
      }
    }

    // ── bones & attachments ──
    own(obj: THREE.Object3D): void { this.owned.push(obj); }
    setFrozen(on: boolean): void {
      if (this.pinned === on) return;
      const was = this.isFrozen;
      this.pinned = on;
      if (!was && this.isFrozen) this.finishOneShot();
    }
    bone(name: MannequinBone): THREE.Object3D | null { return this.bones.get(name) ?? null; }

    attach(obj: THREE.Object3D, bone: MannequinBone, o?: { pos?: V3; rot?: V3; scale?: number }): () => void {
      const a: Attachment = { obj, bone, o, live: false };
      this.attachments.push(a);
      if (this.isReady) this.mount(a);
      return () => {
        const i = this.attachments.indexOf(a);
        if (i >= 0) this.attachments.splice(i, 1);
        obj.removeFromParent();
      };
    }
    private mount(a: Attachment): void {
      const b = this.bones.get(a.bone);
      if (!b) { log.warnOnce(`mannequin:bone:${a.bone}`, 'kit', `unknown mannequin bone "${a.bone}"`); return; }
      const hint = a.obj.userData.attachHint as { bone: string; pos?: V3; rot?: V3; scale?: number } | undefined;
      const h = hint && hint.bone === a.bone ? hint : undefined;
      const pos = a.o?.pos ?? h?.pos, rot = a.o?.rot ?? h?.rot, scale = a.o?.scale ?? h?.scale;   // field-wise: explicit wins, hint fills the rest
      if (pos) a.obj.position.set(pos[0], pos[1], pos[2]);
      if (rot) a.obj.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
      if (scale !== undefined) a.obj.scale.setScalar(scale);
      b.add(a.obj);
      a.live = true;
    }

    lookAt(target: THREE.Vector3 | null, dur = 0.25): void {
      this.lookRate = 1 / Math.max(0.01, dur);
      if (target) { this.lookTarget.copy(target); this.lookGoal = 1; } else this.lookGoal = 0;
    }

    // ── procedural layers (dealer rig, expressions) ──
    /** Register more bones whose animation pose must be restored each frame before procedural layers modify them. */
    addProc(names: readonly string[]): void {
      for (const n of names) if (!this.procNames.includes(n)) this.procNames.push(n);
      if (this.isReady) this.captureAnimPose();
    }
    /** Run `fn(dt)` every frame after the clip pose is restored: `pre` = before head tracking, `post` = after. */
    onPose(fn: (dt: number) => void, phase: 'pre' | 'post' = 'pre'): () => void {
      const list = phase === 'pre' ? this.pre : this.post;
      list.push(fn);
      return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    }
    /** The actor's `Head` face axis in bone space (for procedural head offsets). */
    get faceAxis(): THREE.Vector3 { return this.faceLocal; }

    // ── per frame ──
    update(dt: number): void {
      if (!this.mixer || this.isFrozen || this.disposed) return;
      const step = this.stepFps && this.stepFps > 0 ? 1 / this.stepFps : 0;
      if (step > 0) {
        this.acc += dt;
        if (this.acc >= step) { this.mixer.update(this.acc); this.acc = 0; this.captureAnimPose(); }
      } else if (dt > 0) { this.mixer.update(dt); this.captureAnimPose(); }
      this.postPose(dt);
    }

    private captureAnimPose(): void {
      for (const n of this.procNames) {
        const b = this.bones.get(n);
        if (!b) continue;
        let q = this.procAnim.get(n);
        if (!q) { q = new THREE.Quaternion(); this.procAnim.set(n, q); }
        q.copy(b.quaternion);
      }
    }

    private postPose(dt: number): void {
      for (const [n, q] of this.procAnim) this.bones.get(n)?.quaternion.copy(q);
      for (const f of this.pre) f(dt);
      this.applyLook(dt);
      for (const f of this.post) f(dt);
    }

    private static readonly q1 = new THREE.Quaternion();
    private static readonly q2 = new THREE.Quaternion();
    private static readonly q3 = new THREE.Quaternion();
    private static readonly v1 = new THREE.Vector3();
    private static readonly v2 = new THREE.Vector3();
    private static readonly v3 = new THREE.Vector3();
    private static readonly ID = new THREE.Quaternion();

    private applyLook(dt: number): void {
      const neck = this.bones.get('neck_01'), head = this.bones.get('Head');
      if (!neck || !head) return;
      const rate = this.lookRate * dt;
      this.lookW += Math.max(-rate, Math.min(rate, this.lookGoal - this.lookW));
      if (this.lookW < 0.002) return;
      const { q1, q2, q3, v1, v2, v3, ID } = Actor;
      neck.updateWorldMatrix(true, true);
      head.getWorldPosition(v1);
      // direction to the target, limited in yaw/pitch relative to the actor's facing
      this.root.getWorldQuaternion(q1);
      const rootQ = q1.clone();
      v2.copy(this.lookTarget).sub(v1);
      if (v2.lengthSq() < 1e-8) return;
      v2.normalize().applyQuaternion(q1.clone().invert());
      const yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(v2.x, v2.z)));
      const pitch = Math.max(-0.65, Math.min(0.75, Math.atan2(v2.y, Math.hypot(v2.x, v2.z))));
      v2.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(rootQ);
      const turn = (bone: THREE.Object3D, share: number): void => {
        bone.updateWorldMatrix(true, false);
        bone.getWorldQuaternion(q2);
        v3.copy(this.faceLocal).applyQuaternion(q2);
        q3.setFromUnitVectors(v3, v2);
        q3.slerp(ID, 1 - this.lookW * share);                  // share = fraction of the full turn this bone performs
        const parentQ = bone.parent!.getWorldQuaternion(q2);
        const local = parentQ.clone().invert().multiply(q3).multiply(parentQ);
        bone.quaternion.premultiply(local);
        bone.updateMatrixWorld(true);
      };
      turn(neck, 0.4);
      turn(head, 1);
    }

    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      actors.delete(this.selfRef);
      this.mixer?.stopAllAction();
      if (this.rig) this.mixer?.uncacheRoot(this.rig);
      this.mixer = null;
      if (this.playing) { this.playing.resolve(); this.playing = null; }
      this.pending?.resolve(); this.pending = null;
      for (const m of this.mats) m.dispose();
      this.mats = [];
      for (const a of this.attachments) a.obj.removeFromParent();
      this.attachments.length = 0;
      for (const o of this.owned) disposeObject3D(o);
      this.owned.length = 0;
      this.placeholder?.traverse((n) => { const me = n as THREE.Mesh; if (me.isMesh) me.geometry.dispose(); });
      this.root.removeFromParent();
    }
  }

  return {
    mannequin: (o = {}) => new Actor(o),
    loadMannequin: async () => {
      await Promise.all([loadMannequinSource(), ctx.tex.preloadVendor(VENDOR_PATHS)]);
    },
    update(dt) {
      lodPass();
      for (const ref of actors) {
        const a = ref.deref();
        if (!a) { actors.delete(ref); continue; }
        try { a.update(dt); } catch (e) { log.error('kit', e); }
      }
    },
    setLodCamera(cam) { lodCam = cam; },
  };

  /**
   * Distance / visibility LOD (C13, DECISIONS G): a mannequin with a hidden ancestor freezes, one beyond `LOD_FAR` freezes and hides,
   * and of the rest only the `MAX_ACTIVE` nearest keep animating. Without a LOD camera only visibility and the cap apply.
   */
  function lodPass(): void {
    if (lodCam) lodCam.getWorldPosition(lodPos);
    const near: Array<{ a: Actor; d: number }> = [];
    for (const ref of actors) {
      const a = ref.deref();
      if (!a) { actors.delete(ref); continue; }
      if (a.disposedNow) continue;
      if (!inScene(a.root.parent) || !a.ownVisible) { a.setLodHidden(false); a.setLodState(true); continue; }
      const d = lodCam ? a.root.getWorldPosition(lodVec).distanceTo(lodPos) : 0;
      const far = !!lodCam && d > LOD_FAR;
      a.setLodHidden(far);
      if (far) { a.setLodState(true); continue; }
      near.push({ a, d });
    }
    near.sort((x, y) => x.d - y.d);
    near.forEach((n, i) => n.a.setLodState(i >= MAX_ACTIVE));
  }
}

const lodVec = new THREE.Vector3();
/** True when `obj` and every ancestor are visible. */
function inScene(obj: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}
