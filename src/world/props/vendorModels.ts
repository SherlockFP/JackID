/**
 * Vendored furniture models (CC0, public/assets/vendor, docs/ASSETS.md): the PSX couch (GLB) for the apartment and the
 * tavern pieces (OBJ) for the Lobby bar. Everything loads once, asynchronously, and is cloned per placement; a file that
 * fails to load is logged and simply never appears (the colliders are registered by the caller, so the world is the same).
 *
 *   placeCouch(parent, { pos, yaw, length })            the couch, back detected and turned to `yaw`, `length` m long
 *   placeTavern(kit, parent, name, { pos, yaw, ... })   one tavern piece, scaled to `height` m, centred on `pos`
 *
 * The OBJ materials are not read: each model is one 1024 px atlas, which would be a 4 MB upload per piece and break the PSX
 * look, so the atlas goes through the vendor texture pipeline instead (nearest-downscaled to 128 px, 5-bit quantised, shared).
 * BarrelStand's MTL points at the author's C: drive, so it takes a wood texture from the Synthetic pack.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import type { KitX } from '@/kit';
import { log } from '@/core/log';
import { psxMaterial } from '@/core/renderer/psxMaterial';

const ROOT = `${import.meta.env.BASE_URL}assets/vendor/`;
const COUCH_GLB = `${ROOT}duhgless-psx-couch-2/couch.glb`;
const TAVERN = 'battleroach-medieval-tavern';

export type TavernPiece = 'Bar' | 'Shelf' | 'Stool' | 'BarrelStand' | 'Barrel';

const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Mark every geometry shared (level dispose must not free what other clones still draw) and return the object. */
function shareGeometry(o: THREE.Object3D): THREE.Object3D {
  o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.geometry.userData.shared = true; });
  return o;
}

/** Wrap `src` in a group: centred on x/z, standing on y 0, uniformly scaled so `fit(size)` metres, turned by `yaw`. */
function normalise(src: THREE.Object3D, scaleFor: (size: THREE.Vector3) => number, yaw: number): THREE.Group {
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const s = scaleFor(size);
  const inner = new THREE.Group();
  inner.add(src);
  src.position.set(-ctr.x, -box.min.y, -ctr.z);
  inner.scale.setScalar(s);
  const g = new THREE.Group();
  g.add(inner);
  g.rotation.y = yaw;
  return g;
}

function loadCouchSource(): Promise<THREE.Object3D | null> {
  const hit = cache.get('couch');
  if (hit) return hit;
  const p = new GLTFLoader().loadAsync(COUCH_GLB).then((gltf): THREE.Object3D => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const old = m.material as THREE.MeshStandardMaterial;
      const map = old.map ?? null;
      if (map) { map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false; map.needsUpdate = true; }
      m.material = psxMaterial({ map, color: 0xffffff, side: 'double' });
    });
    return shareGeometry(scene);
  }).catch((e: unknown): null => { log.warn('world', 'couch GLB failed to load', e); return null; });
  cache.set('couch', p);
  return p;
}

/**
 * Which side of the horizontal axis `axis` the model's tall mass (the backrest: vertices above 60% of the height) leans to:
 * +1 or -1 relative to the bounding-box centre.
 */
function backSide(o: THREE.Object3D, axis: 'x' | 'z'): number {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  const y0 = box.min.y + (box.max.y - box.min.y) * 0.6, mid = (box.min[axis] + box.max[axis]) / 2;
  const v = new THREE.Vector3();
  let sum = 0, n = 0;
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.y >= y0) { sum += v[axis] - mid; n++; }
    }
  });
  return n && sum < 0 ? -1 : 1;
}

/**
 * Put the couch in `parent`: `length` m along its long side, turned so a sitter looks along `lookYaw` (game yaw: forward =
 * (-sin, -cos); a couch against the north wall passes pi). The back is found from the model's own mass. Resolves when placed (or silently when the file is missing).
 */
export async function placeCouch(parent: THREE.Object3D, o: { pos: [number, number, number]; lookYaw: number; length: number }): Promise<THREE.Object3D | null> {
  const src = await loadCouchSource();
  if (!src) return null;
  const clone = src.clone(true);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = box.getSize(new THREE.Vector3());
  const longAxis: 'x' | 'z' = size.x >= size.z ? 'x' : 'z';
  const shortAxis: 'x' | 'z' = longAxis === 'x' ? 'z' : 'x';
  const back = backSide(clone, shortAxis);
  // The sitter looks along `lookYaw` (game convention: forward = (-sin, -cos)); the back is opposite. Turn the model so its
  // short axis, signed toward the back, points at -forward.
  const fx = -Math.sin(o.lookYaw), fz = -Math.cos(o.lookYaw);
  const bx = -fx, bz = -fz;                            // where the back must point (world x/z)
  // model back vector before turning
  const mx = shortAxis === 'x' ? back : 0, mz = shortAxis === 'z' ? back : 0;
  // rotation about y mapping (mx, mz) to (bx, bz): x' = x cos + z sin, z' = -x sin + z cos
  const yaw = Math.atan2(mz * bx - mx * bz, mx * bx + mz * bz);
  const g = normalise(clone, (s) => o.length / Math.max(s[longAxis], 0.001), yaw);
  g.position.set(o.pos[0], o.pos[1], o.pos[2]);
  g.name = 'couch';
  parent.add(g);
  return g;
}

function loadTavernSource(kit: KitX, name: TavernPiece): Promise<THREE.Object3D | null> {
  const key = `tavern:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new OBJLoader().loadAsync(`${ROOT}${TAVERN}/${name}/TI_${name}.obj`).then((obj): THREE.Object3D => {
    const atlas = name === 'BarrelStand'
      ? kit.tex.vendor('sbs-synthetic/128x128/Wood/Synth-Wood_01-128x128.png', { size: 64 })
      : kit.tex.vendor(`${TAVERN}/${name}/Textures/DefaultMaterial_BaseColor.png`, { size: 128 });
    const big = name === 'Bar' || name === 'Shelf';
    const mat = psxMaterial({ map: atlas, color: name === 'BarrelStand' ? 0x9a7a58 : 0xffffff, affine: !big });
    obj.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = mat;
      if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
    });
    return shareGeometry(obj);
  }).catch((e: unknown): null => { log.warn('world', `tavern ${name} failed to load`, e); return null; });
  cache.set(key, p);
  return p;
}

/** One tavern piece: scaled so its height is `height` m, centred on (pos.x, pos.z) and standing at pos.y, turned by `yaw`. */
export async function placeTavern(kit: KitX, parent: THREE.Object3D, name: TavernPiece, o: { pos: [number, number, number]; yaw?: number; height: number }): Promise<THREE.Object3D | null> {
  const src = await loadTavernSource(kit, name);
  if (!src) return null;
  const g = normalise(src.clone(true), (s) => o.height / Math.max(s.y, 0.001), o.yaw ?? 0);
  g.position.set(o.pos[0], o.pos[1], o.pos[2]);
  g.name = `tavern:${name}`;
  parent.add(g);
  return g;
}
