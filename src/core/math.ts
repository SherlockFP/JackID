/**
 * Math helpers + shared scratch objects (TD-owned). Hot paths must reuse the `tmp*` objects instead of
 * allocating (TECH_SPEC §8: no per-frame allocations). Scratch objects are valid only until the next
 * call that might use them — never store them, never hold them across `await`.
 */
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Position of `v` between `a` and `b` as 0..1 (unclamped). */
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number => lerp(b0, b1, invLerp(a0, a1, v));
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01(invLerp(e0, e1, x));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential smoothing: `a` → `b` with rate `lambda` (1/s). */
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** Move `v` towards `target` by at most `maxDelta`. */
export const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
export const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const fract = (v: number): number => v - Math.floor(v);
/** Always-positive modulo. */
export const mod = (v: number, m: number): number => ((v % m) + m) % m;
export const snap = (v: number, step: number): number => Math.round(v / step) * step;
export const roundTo = (v: number, digits: number): number => { const p = Math.pow(10, digits); return Math.round(v * p) / p; };
export const pingpong = (t: number, len: number): number => { const m = mod(t, len * 2); return m < len ? m : len * 2 - m; };

// ── angles (radians) ────────────────────────────────────────────────────────────────────────────
/** Wrap to (−π, π]. */
export const wrapAngle = (a: number): number => { const m = mod(a + Math.PI, TAU); return (m === 0 ? TAU : m) - Math.PI; };
/** Shortest signed difference `b − a`. */
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(a, b) * t;
export const dampAngle = (a: number, b: number, lambda: number, dt: number): number => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
/** Yaw (about +Y) that makes −Z-forward objects look from `from` to `to` on the XZ plane. */
export const yawTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(-(tx - fx), -(tz - fz));

// ── scratch objects ─────────────────────────────────────────────────────────────────────────────
export const tmpV2a = new THREE.Vector2();
export const tmpV2b = new THREE.Vector2();
export const tmpV3a = new THREE.Vector3();
export const tmpV3b = new THREE.Vector3();
export const tmpV3c = new THREE.Vector3();
export const tmpV3d = new THREE.Vector3();
export const tmpQuatA = new THREE.Quaternion();
export const tmpQuatB = new THREE.Quaternion();
export const tmpMat4a = new THREE.Matrix4();
export const tmpMat4b = new THREE.Matrix4();
export const tmpBox3 = new THREE.Box3();
export const tmpEuler = new THREE.Euler();
export const tmpColor = new THREE.Color();
