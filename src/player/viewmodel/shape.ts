/**
 * Viewmodel solids (PLAYER): `shaded` bakes a directional light into vertex colours because the viewmodel's materials are unlit
 * (the scene has no lights); `mat` is the unlit PSX material that shows them, `mesh` and `disposeGeometries` are the small helpers
 * the held items are built with.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { clamp } from '@/core/math';
import type { Hex } from '@/core/types';

const LIGHT = new THREE.Vector3(0.35, 0.85, 0.4).normalize();

/** Bake directional vertex shading (from the smooth normals) so the unlit material still reads as a lit solid. */
export function shaded<T extends THREE.BufferGeometry>(g: T, floor = 0.58): T {
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const d = n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z;
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = floor + (1 - floor) * clamp(d * 0.5 + 0.5, 0, 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Unlit PSX material carrying the baked vertex shading (the viewmodel scene has no lights). */
export const mat = (color: Hex): THREE.MeshBasicMaterial => psxMaterial({ color, vertexColors: true, lit: false, unique: true }) as THREE.MeshBasicMaterial;
export const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
};
export function disposeGeometries(o: THREE.Object3D): void {
  o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
}
