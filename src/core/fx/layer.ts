/**
 * FX layer (CORE-RENDER) — the glue between the renderer and the juice systems.
 *
 *  - `scene`: the transient world-space FX (particles, decals, pop text). The renderer draws it right after the main
 *    scene with the SAME camera into the same low-res target, so FX are depth-tested against the world and work in
 *    every state (menu, pit, cutscenes) without any scene wiring.
 *  - `tick()`: called by the renderer once per rendered frame; advances every registered system with a dt that
 *    already honours pause, hit-stop and slow-mo (`app.timeScale`).
 *  - render-time overrides, applied right before `three.render` and undone right after, so gameplay code never sees
 *    (or fights) them: a cutscene camera pose ({@link setCameraPose}), camera shake and light pulses.
 *  - `mainScene`: the scene of the latest main render, so cutscenes can spawn actors that receive the level lights.
 */
import * as THREE from 'three';
import { app } from '../app';
import { clamp } from '../math';
import type { Hex } from '../types';

export interface FxSystem {
  /** Advance by `dt` seconds of FX time (0 while frozen). */
  update(dt: number): void;
  /** True while there is anything to draw. */
  readonly active: boolean;
  /** Live element count (debug overlay only). */
  readonly count?: number;
}

/** A full camera pose written over the state's camera for one render (cutscenes). `fov` null = keep. */
export interface CameraPose { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number | null }

interface Shake { amp: number; roll: number; dur: number; sustain: number; freq: number; t: number; seed: number }
interface Boost { x: number; y: number; z: number; color: Hex | null; mul: number; radius: number; dur: number; t: number }

const MAX_SHAKES = 8;
const MAX_OFFSET = 0.25;       // m, hard cap
const MAX_ROLL = 0.35;         // rad, hard cap
const MAX_BOOSTS = 12;

/** Smooth 1D value noise in [-1, 1]; `seed` decorrelates axes and shakes. */
function vnoise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const h = (n: number): number => {
    let v = (n * 374761393 + seed * 668265263) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (((v ^ (v >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) + (h(i + 1) - h(i)) * u;
}

class FxLayer {
  readonly scene = new THREE.Scene();
  private systems: FxSystem[] = [];
  private shakes: Shake[] = [];
  private boosts: Boost[] = [];
  private last = 0;
  private seedCounter = 1;
  private _mainScene: THREE.Scene | null = null;

  // current frame's shake result
  private offX = 0; private offY = 0; private offRoll = 0;
  private pose: CameraPose | null = null;
  private savedCam: THREE.Camera | null = null;
  private savedFov = 0;
  private readonly savedPos = new THREE.Vector3();
  private readonly savedQuat = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  // light pulses
  private lights: THREE.PointLight[] = [];
  private lightScene: THREE.Scene | null = null;
  private lightsAt = 0;
  private touched: Array<{ light: THREE.PointLight; intensity: number; r: number; g: number; b: number }> = [];
  private readonly tmpColor = new THREE.Color();

  constructor() {
    this.scene.matrixAutoUpdate = false;
  }

  register(s: FxSystem): void { this.systems.push(s); }

  /** True when the renderer should draw {@link scene} this frame. */
  get hasContent(): boolean {
    for (const s of this.systems) if (s.active) return true;
    return false;
  }

  /** Live particles + texts across all systems (debug overlay). */
  get count(): number {
    let n = 0;
    for (const s of this.systems) n += s.count ?? 0;
    return n;
  }

  /** Scene of the most recent main render (null before the first frame). */
  get mainScene(): THREE.Scene | null { return this._mainScene; }

  // ── time ────────────────────────────────────────────────────────────────────────────────────────
  /** Advance all systems. `now` in ms (performance.now). */
  tick(now: number): void {
    const real = this.last === 0 ? 0 : clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const a = app;
    let k = 1;
    if (a) k = a.simPaused || a.hitstopLeft > 0 ? 0 : a.timeScale;
    const dt = real * k;
    for (const s of this.systems) s.update(dt);

    // shake / light pulses run on slow-mo time but keep playing through hit-stop (the freeze should feel heavy)
    const sdt = real * (a && !a.simPaused ? a.timeScale : 0);
    this.stepShake(sdt);
    this.stepBoosts(sdt);
  }

  // ── camera ──────────────────────────────────────────────────────────────────────────────────────
  /** Cutscene pose for the next render(s); null releases it (the state's own camera returns). */
  setCameraPose(p: CameraPose | null): void { this.pose = p; }

  // ── camera shake ────────────────────────────────────────────────────────────────────────────────
  addShake(amp: number, dur: number, rollDeg: number, freq: number, sustain: number): void {
    if (amp <= 0 || dur <= 0) return;
    const s: Shake = { amp, roll: (rollDeg * Math.PI) / 180, dur, sustain, freq, t: 0, seed: this.seedCounter++ * 7919 };
    if (this.shakes.length >= MAX_SHAKES) {
      // replace the weakest one if the new one is stronger, else drop the new one
      let wi = 0, wv = Infinity;
      for (let i = 0; i < this.shakes.length; i++) {
        const v = this.shakes[i].amp * (1 - this.shakes[i].t / (this.shakes[i].dur + this.shakes[i].sustain));
        if (v < wv) { wv = v; wi = i; }
      }
      if (wv >= amp) return;
      this.shakes[wi] = s;
    } else this.shakes.push(s);
  }

  private stepShake(dt: number): void {
    let x = 0, y = 0, r = 0;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      const over = s.t - s.sustain;
      if (over >= s.dur) { this.shakes.splice(i, 1); continue; }
      const e = over <= 0 ? 1 : (1 - over / s.dur) * (1 - over / s.dur);
      const n = s.t * s.freq;
      x += s.amp * e * vnoise(n, s.seed);
      y += s.amp * e * vnoise(n, s.seed + 101);
      r += s.roll * e * vnoise(n, s.seed + 202);
    }
    this.offX = clamp(x, -MAX_OFFSET, MAX_OFFSET);
    this.offY = clamp(y, -MAX_OFFSET, MAX_OFFSET);
    this.offRoll = clamp(r, -MAX_ROLL, MAX_ROLL);
  }

  // ── light pulses ────────────────────────────────────────────────────────────────────────────────
  addBoost(x: number, y: number, z: number, o: { color?: Hex | null; mul?: number; radius?: number; dur?: number }): void {
    if (this.boosts.length >= MAX_BOOSTS) this.boosts.shift();
    this.boosts.push({ x, y, z, color: o.color ?? null, mul: o.mul ?? 2, radius: o.radius ?? 6, dur: o.dur ?? 0.35, t: 0 });
  }

  private stepBoosts(dt: number): void {
    for (let i = this.boosts.length - 1; i >= 0; i--) {
      const b = this.boosts[i];
      b.t += dt;
      if (b.t >= b.dur) this.boosts.splice(i, 1);
    }
  }

  private findLights(scene: THREE.Scene): THREE.PointLight[] {
    const now = performance.now();
    if (this.lightScene !== scene || now - this.lightsAt > 500) {
      this.lights.length = 0;
      scene.traverse((o) => { if ((o as THREE.PointLight).isPointLight) this.lights.push(o as THREE.PointLight); });
      this.lightScene = scene;
      this.lightsAt = now;
    }
    return this.lights;
  }

  // ── render hooks ────────────────────────────────────────────────────────────────────────────────
  /** Apply the cutscene pose, shake and light pulses. Must be paired with {@link endFrame}. */
  beginFrame(scene: THREE.Scene, camera: THREE.Camera): void {
    this._mainScene = scene;
    this.savedCam = null;
    const shaking = this.offX !== 0 || this.offY !== 0 || this.offRoll !== 0;
    if (shaking || this.pose) {
      const cam = camera as THREE.PerspectiveCamera;
      this.savedCam = camera;
      this.savedPos.copy(camera.position);
      this.savedQuat.copy(camera.quaternion);
      this.savedFov = cam.fov ?? 0;
      if (this.pose) {
        camera.position.copy(this.pose.pos);
        camera.quaternion.copy(this.pose.quat);
        const par = camera.parent;
        if (par) {            // camera rigged under a player group: express the world pose in its parent's space
          par.updateWorldMatrix(true, false);
          par.worldToLocal(camera.position);
          camera.quaternion.premultiply(par.getWorldQuaternion(this.tmpQ).invert());
        }
        if (this.pose.fov !== null && cam.isPerspectiveCamera && Math.abs(cam.fov - this.pose.fov) > 1e-4) {
          cam.fov = this.pose.fov;
          cam.updateProjectionMatrix();
        }
      }
      if (shaking) {
        camera.position.add(this.tmpV.set(this.offX, this.offY, 0).applyQuaternion(camera.quaternion));
        camera.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.zAxis, this.offRoll));
      }
    }
    if (this.boosts.length === 0) return;
    for (const l of this.findLights(scene)) {
      if (!l.visible) continue;
      let gain = 0, cw = 0, cr = 0, cg = 0, cb = 0;
      const e = l.matrixWorld.elements;        // world position as of the previous render (lights barely move)
      for (const b of this.boosts) {
        const dx = e[12] - b.x, dy = e[13] - b.y, dz = e[14] - b.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= b.radius) continue;
        const w = 1 - d / b.radius;
        const k = b.t / b.dur;
        const env = k < 0.12 ? k / 0.12 : (1 - (k - 0.12) / 0.88) * (1 - (k - 0.12) / 0.88);
        gain += (b.mul - 1) * w * env;
        if (b.color !== null) {
          this.tmpColor.setHex(b.color);
          const cwt = 0.5 * w * env;
          cw += cwt; cr += this.tmpColor.r * cwt; cg += this.tmpColor.g * cwt; cb += this.tmpColor.b * cwt;
        }
      }
      if (gain === 0 && cw === 0) continue;
      this.touched.push({ light: l, intensity: l.intensity, r: l.color.r, g: l.color.g, b: l.color.b });
      l.intensity *= 1 + gain;
      if (cw > 0) {
        const k = Math.min(cw, 0.8);
        l.color.r += (cr / cw - l.color.r) * k;
        l.color.g += (cg / cw - l.color.g) * k;
        l.color.b += (cb / cw - l.color.b) * k;
      }
    }
  }

  endFrame(): void {
    const cam = this.savedCam;
    if (cam) {
      cam.position.copy(this.savedPos);
      cam.quaternion.copy(this.savedQuat);
      const pc = cam as THREE.PerspectiveCamera;
      if (this.pose && this.pose.fov !== null && pc.isPerspectiveCamera && Math.abs(pc.fov - this.savedFov) > 1e-4) {
        pc.fov = this.savedFov;
        pc.updateProjectionMatrix();
      }
      cam.updateMatrixWorld(true);
      this.savedCam = null;
    }
    for (let i = 0; i < this.touched.length; i++) {
      const t = this.touched[i];
      t.light.intensity = t.intensity;
      t.light.color.setRGB(t.r, t.g, t.b);
    }
    this.touched.length = 0;
  }

  /** Drop transient screen state (shakes, pulses, pose). Systems clear themselves. */
  reset(): void {
    this.shakes.length = 0;
    this.boosts.length = 0;
    this.pose = null;
    this.offX = this.offY = this.offRoll = 0;
  }
}

export const fxLayer = new FxLayer();
