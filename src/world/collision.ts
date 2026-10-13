/**
 * Collision world (WORLD-SYS). Implements the frozen `CollisionWorld` (TECH_SPEC §2.14 / §5.4): axis-aligned
 * boxes in a 2 m spatial hash (XZ cells, Y ignored by the hash), `moveAndSlide` resolving X → Z → Y with
 * step-up, a grid-walk `raycast`, and `floorAt` for hole detection.
 *
 * Tags (see `LocalAABB.tag`):
 *  - `solid`    blocks movement, supports from above, occludes rays (walls, pillars, cabinets).
 *  - `low`      blocks movement and supports, but does NOT occlude rays (stools, chairs, rails: you look over them).
 *  - `walkable` floor only — supports from above, never blocks sideways (floor plates; toggle with `setEnabled`
 *               to open a trapdoor: nothing below ⇒ `floorAt` returns null ⇒ the player falls).
 *
 * Conventions: `pos` passed to `moveAndSlide` is the body CENTRE, `half` its half-extents. Anything whose top is
 * at most STEP_UP above the feet never blocks horizontally; the vertical phase then lifts the body onto it.
 * Hot paths (`moveAndSlide`, `raycast`, `floorAt`) allocate nothing except their tiny result objects.
 */
import * as THREE from 'three';
import type { CollisionWorld, LocalAABB } from './types';

/** Highest ledge the body walks over without jumping (m). */
export const STEP_UP = 0.35;
const CELL = 2;
const SKIN = 0.001;
const GROUND_EPS = 0.004;
/** Boxes spanning more cells than this (per axis) live in a flat list instead of the hash. */
const BIG_SPAN = 48;
const SUPPORT_INSET = 0.01;

export type ColliderTag = NonNullable<LocalAABB['tag']>;

/** Read-only view of a live collider (debug wireframes, level validation). */
export interface ColliderInfo { id: number; tag: ColliderTag; on: boolean; box: THREE.Box3 }

export interface CollisionHost extends CollisionWorld {
  readonly count: number;
  /** True when the body box overlaps an enabled `solid`/`low` collider. */
  overlaps(pos: THREE.Vector3, half: THREE.Vector3): boolean;
  /** Visit every live collider. The `box` is a scratch instance — copy it if you keep it. */
  forEach(fn: (c: ColliderInfo) => void): void;
  /** Copy a collider's world box into `out`; false when the id is unknown. */
  boxOf(id: number, out: THREE.Box3): boolean;
  clear(): void;
}

class Collider {
  stamp = 0;
  cells: number[] = [];
  big = false;
  constructor(
    readonly id: number, public tag: ColliderTag, public on: boolean,
    public minX: number, public minY: number, public minZ: number,
    public maxX: number, public maxY: number, public maxZ: number,
  ) {}
  get blocks(): boolean { return this.on && (this.tag === 'solid' || this.tag === 'low'); }
  get supports(): boolean { return this.on; }
}

const cellKey = (cx: number, cz: number): number => (cx + 2048) * 4096 + (cz + 2048);
const cellOf = (v: number): number => Math.floor(v / CELL);

export function createCollisionWorld(): CollisionHost {
  const all = new Map<number, Collider>();
  const grid = new Map<number, Collider[]>();
  const bigList: Collider[] = [];
  const found: Collider[] = [];
  let nextId = 1;
  let stampCounter = 0;
  const tmpBox = new THREE.Box3();
  const infoBox = new THREE.Box3();

  // ── spatial hash ──────────────────────────────────────────────────────────────────────────────
  function link(c: Collider): void {
    const x0 = cellOf(c.minX), x1 = cellOf(c.maxX), z0 = cellOf(c.minZ), z1 = cellOf(c.maxZ);
    if (x1 - x0 > BIG_SPAN || z1 - z0 > BIG_SPAN) { c.big = true; bigList.push(c); return; }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = cellKey(cx, cz);
        let list = grid.get(k);
        if (!list) { list = []; grid.set(k, list); }
        list.push(c);
        c.cells.push(k);
      }
    }
  }
  function unlink(c: Collider): void {
    if (c.big) { const i = bigList.indexOf(c); if (i >= 0) bigList.splice(i, 1); return; }
    for (const k of c.cells) {
      const list = grid.get(k);
      if (!list) continue;
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) grid.delete(k);
    }
    c.cells.length = 0;
  }
  /** Fill `found` with every collider whose cells touch the XZ rectangle (deduped). */
  function gather(minX: number, minZ: number, maxX: number, maxZ: number): Collider[] {
    found.length = 0;
    const stamp = ++stampCounter;
    const x0 = cellOf(minX), x1 = cellOf(maxX), z0 = cellOf(minZ), z1 = cellOf(maxZ);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = grid.get(cellKey(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (c.stamp !== stamp) { c.stamp = stamp; found.push(c); }
        }
      }
    }
    for (let i = 0; i < bigList.length; i++) found.push(bigList[i]);
    return found;
  }

  // ── movement ──────────────────────────────────────────────────────────────────────────────────
  /** Horizontal overlap + vertical overlap above the step height. */
  const blocksBody = (c: Collider, px: number, py: number, pz: number, hx: number, hy: number, hz: number, stepTop: number): boolean =>
    c.blocks && c.maxY > stepTop && c.minY < py + hy - SKIN &&
    px + hx > c.minX && px - hx < c.maxX && pz + hz > c.minZ && pz - hz < c.maxZ;

  function slideAxis(pos: THREE.Vector3, half: THREE.Vector3, list: Collider[], axis: 'x' | 'z', d: number, stepTop: number): boolean {
    if (d === 0) return false;
    const before = axis === 'x' ? pos.x : pos.z;
    if (axis === 'x') pos.x += d; else pos.z += d;
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!blocksBody(c, pos.x, pos.y, pos.z, half.x, half.y, half.z, stepTop)) continue;
        if (axis === 'x') {
          // only resolve if we came from outside the box on that side (never teleport through a wall)
          if (d > 0 && before + half.x <= c.minX + SKIN * 2) pos.x = c.minX - half.x - SKIN;
          else if (d < 0 && before - half.x >= c.maxX - SKIN * 2) pos.x = c.maxX + half.x + SKIN;
          else continue;
        } else if (d > 0 && before + half.z <= c.minZ + SKIN * 2) pos.z = c.minZ - half.z - SKIN;
        else if (d < 0 && before - half.z >= c.maxZ - SKIN * 2) pos.z = c.maxZ + half.z + SKIN;
        else continue;
        hit = true; moved = true;
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Push the body out of anything it is embedded in (spawned inside a box, machine placed on the player). */
  function depenetrate(pos: THREE.Vector3, half: THREE.Vector3, list: Collider[], stepTop: number): void {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!blocksBody(c, pos.x, pos.y, pos.z, half.x, half.y, half.z, stepTop)) continue;
      const pxMin = pos.x + half.x - c.minX, pxMax = c.maxX - (pos.x - half.x);
      const pzMin = pos.z + half.z - c.minZ, pzMax = c.maxZ - (pos.z - half.z);
      const px = Math.min(pxMin, pxMax), pz = Math.min(pzMin, pzMax);
      if (px < pz) pos.x += pxMin < pxMax ? -(pxMin + SKIN) : pxMax + SKIN;
      else pos.z += pzMin < pzMax ? -(pzMin + SKIN) : pzMax + SKIN;
    }
  }

  // ── ray test (state hoisted so `raycast` allocates nothing but its result) ───────────────────
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, best: 0, id: 0 };
  /** Slab test against `solid` boxes; a box containing the origin (entry distance < 0) never occludes itself. */
  function testRay(c: Collider): void {
    if (!c.on || c.tag !== 'solid') return;
    let tmin = -Infinity, tmax = Infinity;
    if (ray.dx !== 0) {
      const a = (c.minX - ray.ox) / ray.dx, b = (c.maxX - ray.ox) / ray.dx;
      tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
    } else if (ray.ox < c.minX || ray.ox > c.maxX) return;
    if (ray.dy !== 0) {
      const a = (c.minY - ray.oy) / ray.dy, b = (c.maxY - ray.oy) / ray.dy;
      tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
    } else if (ray.oy < c.minY || ray.oy > c.maxY) return;
    if (ray.dz !== 0) {
      const a = (c.minZ - ray.oz) / ray.dz, b = (c.maxZ - ray.oz) / ray.dz;
      tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
    } else if (ray.oz < c.minZ || ray.oz > c.maxZ) return;
    if (tmax < tmin || tmin < 0 || tmin >= ray.best) return;
    ray.best = tmin; ray.id = c.id;
  }

  const world: CollisionHost = {
    get count() { return all.size; },

    addStatic(box, tag = 'solid') {
      const c = new Collider(nextId++, tag, true, box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
      all.set(c.id, c);
      link(c);
      return c.id;
    },
    addLocal(boxes, matrix, tag) {
      const out: number[] = [];
      for (const b of boxes) {
        tmpBox.min.set(b.min[0], b.min[1], b.min[2]);
        tmpBox.max.set(b.max[0], b.max[1], b.max[2]);
        tmpBox.applyMatrix4(matrix);
        out.push(world.addStatic(tmpBox, b.tag ?? (tag as ColliderTag | undefined) ?? 'solid'));
      }
      return out;
    },
    remove(id) {
      const c = all.get(id);
      if (!c) return;
      unlink(c);
      all.delete(id);
    },
    setEnabled(id, on) {
      const c = all.get(id);
      if (c) c.on = on;
    },

    moveAndSlide(pos, half, delta) {
      const hx = half.x, hy = half.y, hz = half.z;
      const feet0 = pos.y - hy;
      const stepTop = feet0 + STEP_UP + SKIN;
      const nx = pos.x + delta.x, nz = pos.z + delta.z;
      const list = gather(Math.min(pos.x, nx) - hx - 0.1, Math.min(pos.z, nz) - hz - 0.1, Math.max(pos.x, nx) + hx + 0.1, Math.max(pos.z, nz) + hz + 0.1);

      const hitX = slideAxis(pos, half, list, 'x', delta.x, stepTop);
      const hitZ = slideAxis(pos, half, list, 'z', delta.z, stepTop);
      depenetrate(pos, half, list, stepTop);

      // ── vertical: supports below (with step-up) or ceilings above ──
      let grounded = false;
      const dy = delta.y;
      if (dy <= 0) {
        const newFeet = feet0 + dy;
        let top = -Infinity;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.supports || c.maxY > feet0 + STEP_UP + SKIN || c.maxY < newFeet - GROUND_EPS) continue;
          if (pos.x + hx - SUPPORT_INSET <= c.minX || pos.x - hx + SUPPORT_INSET >= c.maxX || pos.z + hz - SUPPORT_INSET <= c.minZ || pos.z - hz + SUPPORT_INSET >= c.maxZ) continue;
          if (c.maxY > top) top = c.maxY;
        }
        if (top > -Infinity && newFeet <= top + GROUND_EPS) { pos.y = top + hy; grounded = true; }
        else pos.y = newFeet + hy;
      } else {
        const head0 = pos.y + hy;
        let ceil = Infinity;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (!c.blocks || c.minY < head0 - SKIN || c.minY >= head0 + dy) continue;
          if (pos.x + hx <= c.minX || pos.x - hx >= c.maxX || pos.z + hz <= c.minZ || pos.z - hz >= c.maxZ) continue;
          if (c.minY < ceil) ceil = c.minY;
        }
        pos.y = ceil < Infinity ? ceil - hy - SKIN : pos.y + dy;
      }
      return { grounded, hitX, hitZ };
    },

    raycast(origin, dir, maxDist) {
      const ox = origin.x, oz = origin.z, dx = dir.x, dz = dir.z;
      ray.ox = ox; ray.oy = origin.y; ray.oz = oz; ray.dx = dx; ray.dy = dir.y; ray.dz = dz;
      ray.best = maxDist; ray.id = 0;
      const stamp = ++stampCounter;
      for (let i = 0; i < bigList.length; i++) testRay(bigList[i]);
      // 2-D DDA over the XZ cells the ray crosses
      let cx = cellOf(ox), cz = cellOf(oz);
      const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity, tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
      let tmx = dx > 0 ? ((cx + 1) * CELL - ox) / dx : dx < 0 ? (cx * CELL - ox) / dx : Infinity;
      let tmz = dz > 0 ? ((cz + 1) * CELL - oz) / dz : dz < 0 ? (cz * CELL - oz) / dz : Infinity;
      for (let guard = 0; guard < 512; guard++) {
        const list = grid.get(cellKey(cx, cz));
        if (list) for (let i = 0; i < list.length; i++) { const c = list[i]; if (c.stamp !== stamp) { c.stamp = stamp; testRay(c); } }
        const next = Math.min(tmx, tmz);
        if (next > ray.best || next > maxDist) break;
        if (tmx < tmz) { cx += sx; tmx += tdx; } else { cz += sz; tmz += tdz; }
      }
      return ray.id ? { dist: ray.best, id: ray.id } : null;
    },

    floorAt(x, z, fromY) {
      const list = gather(x, z, x, z);
      let top = -Infinity;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c.supports || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (c.maxY <= fromY + STEP_UP + SKIN && c.maxY > top) top = c.maxY;
      }
      return top > -Infinity ? top : null;
    },

    overlaps(pos, half) {
      const list = gather(pos.x - half.x, pos.z - half.z, pos.x + half.x, pos.z + half.z);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.blocks && pos.x + half.x > c.minX && pos.x - half.x < c.maxX && pos.y + half.y > c.minY && pos.y - half.y < c.maxY && pos.z + half.z > c.minZ && pos.z - half.z < c.maxZ) return true;
      }
      return false;
    },
    forEach(fn) {
      for (const c of all.values()) {
        infoBox.min.set(c.minX, c.minY, c.minZ);
        infoBox.max.set(c.maxX, c.maxY, c.maxZ);
        fn({ id: c.id, tag: c.tag, on: c.on, box: infoBox });
      }
    },
    boxOf(id, out) {
      const c = all.get(id);
      if (!c) return false;
      out.min.set(c.minX, c.minY, c.minZ);
      out.max.set(c.maxX, c.maxY, c.maxZ);
      return true;
    },
    clear() { all.clear(); grid.clear(); bigList.length = 0; },
  };
  return world;
}
