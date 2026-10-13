/**
 * Cutscene camera (CUTSCENE WP). Evaluates a timeline's `CamKey`s and `CamPath`s into a {@link CameraPose} for any
 * time `t`. Keys interpolate position, look point, FOV and roll with the easing of the arriving key (`cut` keys jump);
 * paths are uniform Catmull-Rom splines through their points, looking along the tangent unless `look` is given.
 * Targets are resolved every call, so moving actors and machines work. Handheld sway is seeded noise, not random.
 * All scratch vectors are preallocated: evaluating a frame allocates nothing.
 */
import * as THREE from 'three';
import type { CamKey, CamPath, CutTarget } from './types';
import { ease } from '../tween';
import type { CameraPose } from '../fx/layer';
import { clamp } from '../math';

/** Resolves a target to a world point. `role` picks the default bone for actors ('look' → head, 'pos' → root). */
export type TargetResolver = (tg: CutTarget, role: 'pos' | 'look', out: THREE.Vector3) => THREE.Vector3;

interface KeyPose { px: number; py: number; pz: number; lx: number; ly: number; lz: number; fov: number; roll: number }
const newKeyPose = (): KeyPose => ({ px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: -1, fov: 62, roll: 0 });

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const ZAXIS = new THREE.Vector3(0, 0, 1);
const TANGENT_SCALE = 25;      // look point distance along the tangent (m per unit of spline parameter)

/** Smooth 1D value noise in [-1, 1] (same family as the FX shake). */
function noise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const h = (n: number): number => {
    let v = (n * 374761393 + seed * 668265263) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (((v ^ (v >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) + (h(i + 1) - h(i)) * u;
}

export class CutCamera {
  private readonly keys: CamKey[];
  private readonly paths: CamPath[];
  private readonly pathPts: THREE.Vector3[] = [];
  // scratch (never returned to callers)
  private readonly vPos = new THREE.Vector3();
  private readonly vLook = new THREE.Vector3();
  private readonly vTmp = new THREE.Vector3();
  private readonly vA = new THREE.Vector3();
  private readonly vB = new THREE.Vector3();
  private readonly vSpline = new THREE.Vector3();
  private readonly qRoll = new THREE.Quaternion();
  private readonly mLook = new THREE.Matrix4();
  private readonly kA = newKeyPose();
  private readonly kB = newKeyPose();

  constructor(
    keys: CamKey[] | undefined,
    paths: CamPath[] | undefined,
    private readonly handheld: number,
    private readonly resolve: TargetResolver,
    private readonly baseFov: number,
    private readonly seed: number,
  ) {
    this.keys = [...(keys ?? [])].sort((a, b) => a.t - b.t);
    this.paths = [...(paths ?? [])].sort((a, b) => a.t0 - b.t0);
  }

  /** Write the pose at timeline time `t` into `out`. Returns false when the cutscene has no camera at all. */
  sample(t: number, out: CameraPose): boolean {
    if (this.keys.length === 0 && this.paths.length === 0) return false;
    const path = this.activePath(t);
    const lastKey = this.lastKeyIndex(t);
    if (path) {
      this.samplePath(path, clamp((t - path.t0) / Math.max(1e-6, path.t1 - path.t0), 0, 1), out);
    } else {
      // a path that ended after the latest key holds its end pose until the next key
      const ended = this.lastEndedPath(t);
      if (ended && (lastKey < 0 || this.keys[lastKey].t < ended.t1)) this.samplePath(ended, 1, out);
      else this.sampleKeys(t, lastKey, out);
    }
    if (this.handheld > 0) this.applyHandheld(t, out);
    return true;
  }

  // ── keys ────────────────────────────────────────────────────────────────────────────────────────
  private lastKeyIndex(t: number): number {
    let i = -1;
    for (let k = 0; k < this.keys.length && this.keys[k].t <= t; k++) i = k;
    return i;
  }

  private sampleKeys(t: number, i: number, out: CameraPose): void {
    const keys = this.keys;
    if (i < 0 || i === keys.length - 1 || keys[i + 1].cut) {
      this.poseKey(Math.max(0, i), this.kA);
      this.writeKey(this.kA, out);
      return;
    }
    const b = keys[i + 1];
    const e = ease[b.ease ?? 'inOutCubic'](clamp((t - keys[i].t) / Math.max(1e-6, b.t - keys[i].t), 0, 1));
    const a = this.kA, c = this.kB;
    this.poseKey(i, a);
    this.poseKey(i + 1, c);
    a.px += (c.px - a.px) * e; a.py += (c.py - a.py) * e; a.pz += (c.pz - a.pz) * e;
    a.lx += (c.lx - a.lx) * e; a.ly += (c.ly - a.ly) * e; a.lz += (c.lz - a.lz) * e;
    a.fov += (c.fov - a.fov) * e; a.roll += (c.roll - a.roll) * e;
    this.writeKey(a, out);
  }

  /** Resolve key `i` into `o`. A key without `look` keeps the look point of the key before it. */
  private poseKey(i: number, o: KeyPose): void {
    const k = this.keys[i];
    this.resolve(k.pos, 'pos', this.vPos);
    o.px = this.vPos.x; o.py = this.vPos.y; o.pz = this.vPos.z;
    const look = this.lookOfKey(i, this.vLook);
    o.lx = look.x; o.ly = look.y; o.lz = look.z;
    o.fov = this.fovOfKey(i);
    o.roll = k.roll ?? 0;
  }

  /** Look point of key `i` (recursing through keys without `look`). Writes into `out`. */
  private lookOfKey(i: number, out: THREE.Vector3): THREE.Vector3 {
    const k = this.keys[i];
    if (k.look) return this.resolve(k.look, 'look', out);
    if (i > 0) return this.lookOfKey(i - 1, out);
    this.resolve(k.pos, 'pos', out);
    return out.add(FWD);
  }

  private fovOfKey(i: number): number {
    for (let k = i; k >= 0; k--) if (this.keys[k].fov !== undefined) return this.keys[k].fov as number;
    return this.baseFov;
  }

  // ── paths ───────────────────────────────────────────────────────────────────────────────────────
  private activePath(t: number): CamPath | null {
    for (const p of this.paths) if (t >= p.t0 && t <= p.t1 && p.t1 > p.t0 && p.points.length > 0) return p;
    return null;
  }

  private lastEndedPath(t: number): CamPath | null {
    let found: CamPath | null = null;
    for (const p of this.paths) if (p.t1 <= t && p.points.length > 0) found = p;
    return found;
  }

  private samplePath(p: CamPath, u: number, out: CameraPose): void {
    const n = p.points.length;
    while (this.pathPts.length < n) this.pathPts.push(new THREE.Vector3());
    for (let i = 0; i < n; i++) this.resolve(p.points[i], 'pos', this.pathPts[i]);
    const e = ease[p.ease ?? 'inOutCubic'](u);

    const pos = this.vPos.copy(this.spline(e * (n - 1), n));
    let look: THREE.Vector3;
    if (p.look) look = this.resolve(p.look, 'look', this.vLook);
    else {
      // a point far ahead along the tangent: spline(e + ε) − spline(e − ε) gives the direction of travel
      const ahead = this.vA.copy(this.spline(clamp(e + 0.02, 0, 1) * (n - 1), n));
      const behind = this.vB.copy(this.spline(clamp(e - 0.02, 0, 1) * (n - 1), n));
      look = this.vLook.copy(pos).addScaledVector(ahead.sub(behind), TANGENT_SCALE);
    }
    const fov = p.fov ? p.fov[0] + (p.fov[1] - p.fov[0]) * e : this.fovAt(p);
    const roll = p.roll ? p.roll[0] + (p.roll[1] - p.roll[0]) * e : 0;
    this.writeFrom(pos, look, fov, roll, out);
  }

  /** FOV for a path without its own FOV: the key in effect at the path's start (or the base FOV). */
  private fovAt(p: CamPath): number {
    const i = this.lastKeyIndex(p.t0);
    return i >= 0 ? this.fovOfKey(i) : this.baseFov;
  }

  /** Uniform Catmull-Rom through the resolved path points, `s` in [0, n − 1]. Returns a shared scratch vector. */
  private spline(s: number, n: number): THREE.Vector3 {
    const pts = this.pathPts;
    const i = n === 1 ? 0 : Math.min(Math.floor(s), n - 2);
    const f = n === 1 ? 0 : s - i;
    const p1 = pts[i], p0 = pts[Math.max(0, i - 1)], p2 = pts[Math.min(n - 1, i + 1)], p3 = pts[Math.min(n - 1, i + 2)];
    const f2 = f * f, f3 = f2 * f;
    const out = this.vSpline;
    out.set(0, 0, 0);
    for (const ax of ['x', 'y', 'z'] as const) {
      out[ax] = 0.5 * (2 * p1[ax] + (-p0[ax] + p2[ax]) * f + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * f2
        + (-p0[ax] + 3 * p1[ax] - 3 * p2[ax] + p3[ax]) * f3);
    }
    return out;
  }

  // ── output ──────────────────────────────────────────────────────────────────────────────────────
  private writeKey(k: KeyPose, out: CameraPose): void {
    this.vPos.set(k.px, k.py, k.pz);
    this.vLook.set(k.lx, k.ly, k.lz);
    this.writeFrom(this.vPos, this.vLook, k.fov, k.roll, out);
  }

  private writeFrom(pos: THREE.Vector3, look: THREE.Vector3, fov: number, rollDeg: number, out: CameraPose): void {
    out.pos.copy(pos);
    const target = pos.distanceToSquared(look) < 1e-8 ? this.vTmp.copy(pos).add(FWD) : look;
    this.mLook.lookAt(pos, target, UP);            // camera convention: −Z is forward
    out.quat.setFromRotationMatrix(this.mLook);
    if (rollDeg !== 0) out.quat.multiply(this.qRoll.setFromAxisAngle(ZAXIS, rollDeg * DEG));
    out.fov = fov;
  }

  private applyHandheld(t: number, out: CameraPose): void {
    const h = this.handheld, s = this.seed;
    out.pos.x += noise(t * 1.3, s + 1) * 0.012 * h;
    out.pos.y += noise(t * 1.7, s + 2) * 0.009 * h;
    out.pos.z += noise(t * 0.9, s + 3) * 0.006 * h;
    out.quat.multiply(this.qRoll.setFromAxisAngle(ZAXIS, noise(t * 1.1, s + 4) * 0.5 * DEG * h));
  }
}

/** A reusable pose object the player keeps for its whole run. */
export function newCameraPose(): CameraPose {
  return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: null };
}
