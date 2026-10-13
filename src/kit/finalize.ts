/**
 * `kit.finalize(root, { keep })` — turns a pile of kit primitives into a handful of draw calls.
 *
 *  1. Every static mesh under `root` is merged by *look*: the PSX materials of the kit are keyed by everything
 *     except their colour, and the colour is multiplied into the vertex colours instead. So a red enamel panel, a
 *     blue one and a black one are ONE draw call, as are brass, gold and chrome (same brushed-metal texture).
 *  2. Floor ambient occlusion is baked into the vertex colours using height above the root origin
 *     (ART_BIBLE §4.7: `0.55 + 0.45·smoothstep(0, 0.5, y)`), only for geometry that was vertex-shaded to begin with.
 *  3. Merged meshes get frozen matrices.
 *
 * What is never merged: anything under a `keep` node, nodes flagged `userData.kitKeep` (the kit flags its own moving
 * parts, so forgetting one in `keep` is harmless), `userData.noMerge`, hidden nodes, instanced / skinned meshes,
 * sprites, multi-material meshes, meshes whose material is `unique` (mutated at runtime), `userData.merged` output.
 * A `keep` node (or kit part root) flagged `userData.kitHoist` only protects its *flagged* children: the static
 * rest of the part (a button's base plate, a screen's bezel) is merged into the model like everything else, which is
 * what keeps a 12-button cabinet at a dozen draws instead of forty.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LocalAABB } from '@/core/types';
import { log } from '@/core/log';
import { baseMaterial, usesVertexColors } from './materials';

type Keep = THREE.Object3D | { root: THREE.Object3D };
type Stats = { meshesBefore: number; drawCalls: number; tris: number };

const isMesh = (n: THREE.Object3D): n is THREE.Mesh => (n as THREE.Mesh).isMesh === true;
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function mergeable(n: THREE.Mesh): boolean {
  return !(n as THREE.InstancedMesh).isInstancedMesh && !(n as THREE.SkinnedMesh).isSkinnedMesh
    && !Array.isArray(n.material) && !!n.geometry && !n.userData.noMerge && !n.userData.merged
    && (n.material as THREE.Material).userData.shared !== false
    && !(n.geometry.morphAttributes && Object.keys(n.geometry.morphAttributes).length > 0);
}

/** Reduce a geometry to position / normal / uv / color (color always present: it carries the tint). */
function normalize(g: THREE.BufferGeometry): void {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = g.getAttribute('color');
  if (!c) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  else if (c.itemSize !== 3) {                       // RGBA vertex colours → RGB
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
  g.morphAttributes = {};
}

function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
    idx.needsUpdate = true;
    return;
  }
  for (const k of Object.keys(g.attributes)) {
    const a = g.getAttribute(k) as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i += 3) {
      for (let c = 0; c < a.itemSize; c++) { const t = a.getComponent(i + 1, c); a.setComponent(i + 1, c, a.getComponent(i + 2, c)); a.setComponent(i + 2, c, t); }
    }
    a.needsUpdate = true;
  }
}

/** Multiply the colour attribute by a flat tint and, optionally, the floor AO term. */
function bake(g: THREE.BufferGeometry, tint: THREE.Color | null, ao: boolean): void {
  const pos = g.getAttribute('position'), col = g.getAttribute('color') as THREE.BufferAttribute;
  const tr = tint?.r ?? 1, tg = tint?.g ?? 1, tb = tint?.b ?? 1;
  for (let i = 0; i < pos.count; i++) {
    const k = ao ? 0.55 + 0.45 * smooth(0, 0.5, pos.getY(i)) : 1;
    col.setXYZ(i, col.getX(i) * k * tr, col.getY(i) * k * tg, col.getZ(i) * k * tb);
  }
}

export function finalizeModel(root: THREE.Object3D, opts?: { keep?: Keep[] }): Stats {
  root.updateMatrixWorld(true);
  const keep = new Set<THREE.Object3D>();
  for (const k of opts?.keep ?? []) {
    const o = (k as { root?: THREE.Object3D }).root && !(k as THREE.Object3D).isObject3D ? (k as { root: THREE.Object3D }).root : (k as THREE.Object3D);
    if (o) keep.add(o);
  }

  let meshesBefore = 0;
  const cand: THREE.Mesh[] = [];
  const walk = (n: THREE.Object3D, frozen: boolean): void => {
    const selfKept = keep.has(n) || n.userData.kitKeep === true || n.visible === false;
    const nodeFrozen = frozen || selfKept;
    const hoist = n.userData.kitHoist === true && n.visible !== false;
    const childFrozen = frozen || (selfKept && !hoist);
    if (isMesh(n)) meshesBefore++;
    if (!nodeFrozen && n !== root && isMesh(n) && mergeable(n)) cand.push(n);
    for (const c of n.children) walk(c, childFrozen);
  };
  walk(root, false);

  interface Group { base: THREE.Material; renderOrder: number; items: Array<{ mesh: THREE.Mesh; tint: THREE.Color | null; vc: boolean }> }
  const groups = new Map<string, Group>();
  for (const mesh of cand) {
    const mat = mesh.material as THREE.Material;
    const b = baseMaterial(mat);
    const key = `${b ? b.key : mat.uuid}|${mesh.renderOrder}`;
    let g = groups.get(key);
    if (!g) { g = { base: b ? b.material : mat, renderOrder: mesh.renderOrder, items: [] }; groups.set(key, g); }
    g.items.push({ mesh, tint: b ? b.tint : null, vc: usesVertexColors(mat) });
  }

  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const ao = root.userData.noAO !== true;
  const emptied = new Set<THREE.Object3D>();
  let n = 0;
  for (const g of groups.values()) {
    const geos: THREE.BufferGeometry[] = [];
    for (const it of g.items) {
      const geo = it.mesh.geometry.clone();
      normalize(geo);
      rel.multiplyMatrices(inv, it.mesh.matrixWorld);
      geo.applyMatrix4(rel);
      if (rel.determinant() < 0) flipWinding(geo);
      bake(geo, it.tint, ao && it.vc);
      geos.push(geo);
    }
    if (geos.some((x) => !x.getIndex()) && geos.some((x) => x.getIndex())) {
      for (let i = 0; i < geos.length; i++) if (geos[i].getIndex()) geos[i] = geos[i].toNonIndexed();
    }
    const merged = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!merged) { log.warn('kit', 'finalize: merge failed for a material group, left unmerged'); continue; }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    const mm = new THREE.Mesh(merged, g.base);
    mm.name = `merged_${n++}`;
    mm.userData.merged = true;
    mm.renderOrder = g.renderOrder;
    mm.matrixAutoUpdate = false;
    mm.updateMatrix();
    root.add(mm);
    for (const it of g.items) {
      if (it.mesh.parent) emptied.add(it.mesh.parent);
      it.mesh.removeFromParent();
      if (!it.mesh.geometry.userData.shared) it.mesh.geometry.dispose();
    }
  }

  // prune groups that became empty because of the merge (never touches groups that were empty before)
  for (const p0 of emptied) {
    let p: THREE.Object3D | null = p0;
    while (p && p !== root && p.children.length === 0 && p.type === 'Group' && !keep.has(p) && !p.userData.anchor && !p.userData.kitKeep && !p.userData.kitHoist) {
      const parent: THREE.Object3D | null = p.parent;
      p.removeFromParent();
      p = parent;
    }
  }

  const stats = countRender(root);
  log.debug('kit', `finalize ${root.name || '(root)'}: ${meshesBefore} meshes → ${stats.drawCalls} draws, ${stats.tris} tris`);
  const budget = root.userData.budget as { draws?: number; tris?: number } | undefined;
  if (budget?.draws !== undefined && stats.drawCalls > budget.draws) log.warn('kit', `${root.name || '(root)'}: ${stats.drawCalls} draw calls, budget ${budget.draws}`);
  if (budget?.tris !== undefined && stats.tris > budget.tris) log.warn('kit', `${root.name || '(root)'}: ${stats.tris} tris, budget ${budget.tris}`);
  return { meshesBefore, drawCalls: stats.drawCalls, tris: stats.tris };
}

/** Draw calls and triangles of everything renderable under `root`. */
export function countRender(root: THREE.Object3D): { drawCalls: number; tris: number } {
  let drawCalls = 0, tris = 0;
  root.traverse((o) => {
    if (!o.visible) return;
    if ((o as THREE.Sprite).isSprite) { drawCalls++; tris += 2; return; }
    if (!isMesh(o)) return;
    const g = o.geometry;
    const per = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3;
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    drawCalls += Array.isArray(o.material) ? Math.max(1, g.groups.length) : 1;
    tris += per * inst;
  });
  return { drawCalls, tris: Math.round(tris) };
}

export function aabbOf(obj: THREE.Object3D, relativeTo: THREE.Object3D, pad = 0): LocalAABB {
  obj.updateWorldMatrix(true, true);
  relativeTo.updateWorldMatrix(true, false);
  const b = new THREE.Box3().setFromObject(obj).applyMatrix4(new THREE.Matrix4().copy(relativeTo.matrixWorld).invert());
  return { min: [b.min.x - pad, b.min.y - pad, b.min.z - pad], max: [b.max.x + pad, b.max.y + pad, b.max.z + pad] };
}
