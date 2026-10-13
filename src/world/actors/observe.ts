/**
 * Observation tests for horror behaviour (GDD §6.4): "observed" means inside any viewer's view frustum or within
 * 6 m of a viewer. Pure three.js math, no side effects beyond refreshing camera matrices.
 */
import * as THREE from 'three';

export interface Viewer { pos: readonly [number, number, number]; camera: THREE.Camera | null }

export const OBSERVE_RANGE = 6;   // m

const frustum = new THREE.Frustum();
const pv = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const tmp = new THREE.Vector3();

/** True when a sphere at `p` (radius `r`) intersects the camera's view frustum. */
export function inFrustum(cam: THREE.Camera, p: THREE.Vector3, r: number): boolean {
  cam.updateMatrixWorld();
  pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pv);
  sphere.center.copy(p);
  sphere.radius = r;
  return frustum.intersectsSphere(sphere);
}

/** Observed by any viewer: in frustum, or within `OBSERVE_RANGE` (a Viewer with no camera is distance-only). */
export function observed(viewers: readonly Viewer[], p: THREE.Vector3, r = 0.8): boolean {
  for (const v of viewers) {
    tmp.set(v.pos[0], v.pos[1], v.pos[2]);
    if (tmp.distanceTo(p) < OBSERVE_RANGE) return true;
    if (v.camera && inFrustum(v.camera, p, r)) return true;
  }
  return false;
}

/** Nearest viewer position to `p`, or null when there are none. */
export function nearestViewer(viewers: readonly Viewer[], p: THREE.Vector3): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null, bestD = Infinity;
  for (const v of viewers) {
    const d = (v.pos[0] - p.x) ** 2 + (v.pos[1] - p.y) ** 2 + (v.pos[2] - p.z) ** 2;
    if (d < bestD) { bestD = d; best = new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]); }
  }
  return best;
}
