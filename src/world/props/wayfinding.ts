/**
 * The Night 1 floor trail: a faint gold dotted line on the carpet, one leg at a time (lift to the Big One, then Big One to the
 * terminal). Flat instanced decals (a gold dot over a dark halo) laid a hair above the floor with polygonOffset, so they never z-fight the carpet.
 * The dot layout is pure (`trailDots`); the mesh only draws it. Frame-driven (`update(dt)`), so it follows the sim clock.
 */
import * as THREE from 'three';
import { findPath, type Vec2 } from '@/world/actors/nav';

/** Metres between dots. */
export const DOT_STEP = 1.1;
const DOT_R = 0.11, HALO_R = 0.19;   // a dark halo under each gold dot: the carpet's own gold motifs would swallow a bare dot
const FLOOR_Y = 0.02;
const GOLD = 0xffe08a, SHADE = 0x1a0c08;
const PEAK = 0.8, HALO = 0.5;
/** Seconds a finished leg takes to fade out. */
export const FADE_S = 2;

/** Points every `step` metres along a polyline (the first point included), none within `trim` of the last. */
export function trailDots(path: readonly Vec2[], step = DOT_STEP, trim = 0.6): Vec2[] {
  const out: Vec2[] = [];
  if (path.length === 0) return out;
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  let at = 0, next = 0;   // `at` = length walked up to path[i-1]; `next` = length of the next dot
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    while (next <= at + len && next <= total - trim) {
      const f = len === 0 ? 0 : (next - at) / len;
      out.push([ax + (bx - ax) * f, az + (bz - az) * f]);
      next += step;
    }
    at += len;
  }
  return out;
}

/**
 * The walkable route between two spots as a dotted-line path: the patrol graph's route, minus a first graph node that would send the
 * line back behind the start (the lift door sits in the wall, a step behind its own stand spot).
 */
export function trailPath(from: Vec2, to: Vec2): Vec2[] {
  const p = findPath(from, to) ?? [from, to];
  if (p.length > 2 && Math.hypot(p[1][0] - from[0], p[1][1] - from[1]) < 2.2) p.splice(1, 1);
  return p;
}

export interface Trail {
  /** Show the dotted line along `path` (null: none). The same path object twice is a no-op. */
  show(path: readonly Vec2[] | null): void;
  /** Start fading the shown line out; it is gone after `FADE_S`. */
  fade(): void;
  update(dt: number): void;
  dispose(): void;
}

export function createTrail(parent: THREE.Object3D): Trail {
  const flat = (r: number): THREE.CircleGeometry => { const g = new THREE.CircleGeometry(r, 10); g.rotateX(-Math.PI / 2); return g; };
  const geo = flat(DOT_R), haloGeo = flat(HALO_R);
  const decal = (color: number, offset: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
  const mat = decal(GOLD, -3), haloMat = decal(SHADE, -2);   // the gold sits nearer the camera than its halo, both nearer than the carpet
  let mesh: THREE.Group | null = null;
  let shown: readonly Vec2[] | null = null;
  let fading = -1;   // seconds into the fade, -1 = not fading
  let clock = 0;
  const clear = (): void => {
    if (mesh) { parent.remove(mesh); mesh.children.forEach((c) => (c as THREE.InstancedMesh).dispose()); mesh = null; }
    shown = null; fading = -1;
    mat.opacity = 0; haloMat.opacity = 0;
  };
  const m4 = new THREE.Matrix4();
  return {
    show(path) {
      if (path === shown) return;
      clear();
      if (!path) return;
      const dots = trailDots(path);
      if (dots.length === 0) return;
      shown = path;
      mesh = new THREE.Group();
      mesh.name = 'floorTrail';
      [[haloGeo, haloMat, 3], [geo, mat, 4]].forEach(([g, m, order]) => {
        const im = new THREE.InstancedMesh(g as THREE.BufferGeometry, m as THREE.Material, dots.length);
        im.frustumCulled = false;
        im.renderOrder = order as number;
        dots.forEach(([x, z], i) => im.setMatrixAt(i, m4.makeTranslation(x, FLOOR_Y, z)));
        mesh!.add(im);
      });
      parent.add(mesh);
    },
    fade() { if (mesh && fading < 0) fading = 0; },
    update(dt) {
      if (!mesh) return;
      clock += dt;
      const pulse = 0.75 + 0.25 * Math.sin(clock * 2.4);
      let k = 1;
      if (fading >= 0) {
        fading += dt;
        if (fading >= FADE_S) { clear(); return; }
        k = 1 - fading / FADE_S;
      }
      mat.opacity = PEAK * pulse * k; haloMat.opacity = HALO * k;
    },
    dispose() { clear(); geo.dispose(); haloGeo.dispose(); mat.dispose(); haloMat.dispose(); },
  };
}
