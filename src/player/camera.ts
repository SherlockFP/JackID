/**
 * Camera rig (PLAYER). The ONE writer of the shared first-person camera while the player owns it.
 *
 * Every frame the player hands the rig a world-space TARGET (walking eye, a machine's play pose, a cinematic
 * key); the rig shows it directly or, after `glide()`, eases from wherever the camera currently is (position
 * lerp, quaternion slerp, FOV lerp — TECH_SPEC §2.14: in 0.60 s inOutCubic, out 0.45 s outCubic). On top of the
 * base transform it adds head-bob (camera-local offset set by the controller) and layered screen shake
 * (ART_BIBLE §9.6: offset = A·(1 − t/D)²·noise(25 Hz), plus roll).
 *
 * `suspended` hands the camera to somebody else (cutscene player) without touching it.
 */
import * as THREE from 'three';
import { ease, type Ease } from '@/core/tween';
import { clamp, lerp } from '@/core/math';
import { noise1 } from './noise';

const MAX_SHAKES = 8;
const MAX_SHAKE_OFFSET = 0.25;   // m
const MAX_SHAKE_ROLL = 0.1;      // rad (~5.7°)
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export interface ShakeOpts {
  /** Peak roll in degrees (default: scales with amplitude, ART_BIBLE §9.6 table). */
  roll?: number;
  freq?: number;
  /** Seconds at full amplitude before the (1 − t/D)² decay starts. */
  sustain?: number;
}

interface Shake { amp: number; dur: number; sustain: number; freq: number; roll: number; t: number; seed: number }
interface Glide { t: number; dur: number; ease: Ease; resolve: () => void }

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Hand the camera to an external driver (cutscene): `update` no longer writes it. */
  suspended = false;
  /** Camera-local head-bob offset (m), set by the player each frame. */
  readonly bob = new THREE.Vector3();
  /** Extra roll in radians (fall wobble, lean). */
  roll = 0;
  /** Extra FOV in degrees (sprint kick); already smoothed by the caller. */
  fovKick = 0;

  private readonly targetPos = new THREE.Vector3();
  private readonly targetQuat = new THREE.Quaternion();
  private targetFov = 72;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private fromFov = 72;
  private readonly basePos = new THREE.Vector3();
  private readonly baseQuat = new THREE.Quaternion();
  private baseFov = 72;
  private glideState: Glide | null = null;
  private shakes: Shake[] = [];
  private shakeSeed = 1;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private clock = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.targetPos.copy(camera.position);
    this.targetQuat.copy(camera.quaternion);
    this.targetFov = this.baseFov = this.fromFov = camera.fov;
    this.basePos.copy(this.targetPos);
    this.baseQuat.copy(this.targetQuat);
  }

  get gliding(): boolean { return this.glideState !== null; }
  /** The base transform currently shown (without bob / shake). */
  get shownPos(): THREE.Vector3 { return this.basePos; }
  get shownQuat(): THREE.Quaternion { return this.baseQuat; }

  /** Where the camera should be this frame (world space). Copies its arguments. */
  setTarget(pos: THREE.Vector3, quat: THREE.Quaternion, fov: number): void {
    this.targetPos.copy(pos);
    this.targetQuat.copy(quat);
    this.targetFov = fov;
  }

  /** Show the target immediately and finish any glide. */
  snap(): void {
    this.finishGlide();
    this.basePos.copy(this.targetPos);
    this.baseQuat.copy(this.targetQuat);
    this.baseFov = this.targetFov;
  }

  /**
   * Ease from the camera as it is now to whatever the target is during the next `dur` seconds.
   * Resolves when finished — or when superseded by another `glide()` / `snap()`.
   */
  glide(dur: number, easing: Ease = 'inOutCubic'): Promise<void> {
    this.finishGlide();
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.basePos.copy(this.fromPos);
    this.baseQuat.copy(this.fromQuat);
    this.baseFov = this.fromFov;
    if (dur <= 0) { this.snap(); return Promise.resolve(); }
    return new Promise<void>((resolve) => { this.glideState = { t: 0, dur, ease: easing, resolve }; });
  }

  private finishGlide(): void {
    const g = this.glideState;
    if (!g) return;
    this.glideState = null;
    g.resolve();
  }

  shake(amp: number, dur: number, o: ShakeOpts = {}): void {
    if (amp <= 0 || dur <= 0) return;
    if (this.shakes.length >= MAX_SHAKES) this.shakes.shift();
    this.shakes.push({
      amp, dur, sustain: o.sustain ?? 0, freq: o.freq ?? 25,
      roll: ((o.roll ?? clamp(amp * 36, 0, 3)) * Math.PI) / 180,
      t: 0, seed: this.shakeSeed++,
    });
  }
  clearShake(): void { this.shakes.length = 0; }

  /** Advance glide + shake and write the camera. `dt` is real seconds. */
  update(dt: number): void {
    this.clock += dt;
    // base transform
    const g = this.glideState;
    if (g) {
      g.t += dt;
      const k = ease[g.ease](clamp(g.t / g.dur, 0, 1));
      this.basePos.lerpVectors(this.fromPos, this.targetPos, k);
      this.baseQuat.slerpQuaternions(this.fromQuat, this.targetQuat, k);
      this.baseFov = lerp(this.fromFov, this.targetFov, k);
      if (g.t >= g.dur) this.finishGlide();
    } else {
      this.basePos.copy(this.targetPos);
      this.baseQuat.copy(this.targetQuat);
      this.baseFov = this.targetFov;
    }
    if (this.suspended) { this.shakes.length = 0; return; }

    // layered shake
    let ox = 0, oy = 0, roll = this.roll;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      const decay = s.t <= s.sustain ? 1 : 1 - (s.t - s.sustain) / s.dur;
      if (decay <= 0) { this.shakes.splice(i, 1); continue; }
      const a = s.amp * decay * decay, n = s.t * s.freq;
      ox += noise1(n, s.seed) * a;
      oy += noise1(n, s.seed + 17) * a;
      roll += noise1(n, s.seed + 31) * s.roll * decay * decay;
    }
    const mag = Math.hypot(ox, oy);
    if (mag > MAX_SHAKE_OFFSET) { ox *= MAX_SHAKE_OFFSET / mag; oy *= MAX_SHAKE_OFFSET / mag; }
    roll = clamp(roll, -MAX_SHAKE_ROLL, MAX_SHAKE_ROLL);

    const cam = this.camera;
    this.tmpV.set(this.bob.x + ox, this.bob.y + oy, this.bob.z).applyQuaternion(this.baseQuat);
    cam.position.copy(this.basePos).add(this.tmpV);
    cam.quaternion.copy(this.baseQuat);
    if (roll !== 0) cam.quaternion.multiply(this.tmpQ.setFromAxisAngle(Z_AXIS, roll));
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  /** Time since creation (real s) — cheap clock for effects that need continuity. */
  get time(): number { return this.clock; }
}
