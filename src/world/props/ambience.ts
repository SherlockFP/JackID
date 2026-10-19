/**
 * The air and the edges of the casino (wave 87, docs/ART.md §5 and §6): what makes the rooms read as lived-in without walking NPCs.
 *
 *   - door casings: walnut pilasters on plinths, a brass-banded entablature and lined jambs on every nave doorway (both faces)
 *   - light pools: a soft additive disc on the floor under each lamp, so the light reads as pools with dark between them
 *   - haze: faint additive cones under the main pendants and the stage spot (smoke in the air)
 *   - posters: framed wordless show bills on the wing side of the doorways, skipped where a machine stands
 *
 * All static kit primitives under `parent` (the level's `statical`, merged by kit.finalize: the pools and cones share one additive
 * material each, so they cost a draw call apiece in all). No real-time lights, no timers, no rng.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import { presets } from '@/kit/presets';
import { poolTex, posterTex, POSTER_COUNT } from './surfaces';

/** [x0, z0, x1, z1] in metres. */
type Rect = readonly [number, number, number, number];

export interface Pool { x: number; z: number; r: number; color: number; y?: number }
export interface Beam { x: number; z: number; y0: number; y1: number; r0: number; r1: number; color: number }
export interface DoorSpec {
  /** x of the wall's centre line; the nave is on the side of x = 0. */
  x: number;
  z0: number; z1: number;
}

const T = 0.3;            // wall thickness (level.ts)
const LINTEL = 3.2;       // doorway header height (level.ts LINTEL_Y)

export function buildAmbience(kit: KitX, o: {
  parent: THREE.Object3D;
  doors: readonly DoorSpec[];
  pools: readonly Pool[];
  beams: readonly Beam[];
  /** Machine bodies and other solids: a poster is skipped when its wall patch is within 0.4 m of one. */
  blockers: readonly Rect[];
}): void {
  const P = presets(kit.tex);
  const { parent } = o;
  const wood = P.wood('dark'), walnut = P.wood('walnut'), brass = P.brass();
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh =>
    kit.box(w, h, d, m, { pos: [x, y, z], parent });

  // ── door casings ────────────────────────────────────────────────────────────────────────────
  for (const d of o.doors) {
    const s = d.x < 0 ? 1 : -1;                    // the nave is towards +x for a west wall
    const nave = d.x + s * (T / 2), wing = d.x - s * (T / 2);   // the two wall faces
    const gap = d.z1 - d.z0, zc = (d.z0 + d.z1) / 2;
    // the nave face: x from nave - s*0.01 (1 cm into the wall) out to nave + s*depth
    const out = (depth: number): number => nave + s * (depth / 2 - 0.01);
    for (const pz of [d.z0 - 0.175, d.z1 + 0.175]) {   // 5 mm off the jamb: a pilaster side on the wall end plane made a 1 cm coplanar strip
      box(0.14, LINTEL, 0.34, walnut, out(0.14), LINTEL / 2, pz);           // pilaster
      box(0.19, 0.32, 0.42, wood, out(0.19), 0.16, pz);                     // plinth
      box(0.2, 0.1, 0.42, brass, out(0.2), LINTEL - 0.05, pz);             // capital
    }
    box(0.18, 0.5, gap + 0.76, wood, out(0.18), LINTEL + 0.25, zc);        // entablature
    box(0.2, 0.05, gap + 0.8, brass, out(0.2), LINTEL + 0.08, zc);         // its brass band
    box(0.26, 0.07, gap + 0.9, walnut, out(0.26), LINTEL + 0.535, zc);     // cornice cap
    // lined jambs and soffit (the wall's end faces showed the wallpaper on edge)
    for (const jz of [d.z0 + 0.01, d.z1 - 0.01]) box(T + 0.06, LINTEL, 0.04, walnut, d.x, LINTEL / 2, jz);   // 1 cm into the wall end, 3 cm proud: no shared plane
    box(T + 0.06, 0.04, gap, walnut, d.x, LINTEL - 0.01, zc);   // soffit, 1 cm up into the lintel
    // the wing face: a plain architrave
    const wout = (depth: number): number => wing - s * (depth / 2 - 0.01);
    for (const pz of [d.z0 - 0.09, d.z1 + 0.09]) box(0.06, LINTEL + 0.12, 0.18, wood, wout(0.06), (LINTEL + 0.12) / 2, pz);
    box(0.06, 0.16, gap + 0.36, wood, wout(0.06), LINTEL + 0.06, zc);

    // posters on the wing face, one each side of the doorway, unless a machine stands there
    const px = wing - s * 0.04;
    for (const [k, pz] of [[0, d.z0 - 1.05], [1, d.z1 + 1.05]] as const) {
      const r: Rect = [Math.min(px, wing) - 0.6, pz - 0.5, Math.max(px, wing) + 0.6, pz + 0.5];
      if (o.blockers.some((b) => r[0] < b[2] + 0.4 && r[2] > b[0] - 0.4 && r[1] < b[3] + 0.4 && r[3] > b[1] - 0.4)) continue;
      const art = Math.abs(Math.round(d.x + d.z0 * 3 + k)) % POSTER_COUNT;
      box(0.04, 1.14, 0.8, walnut, wing - s * 0.01, 1.75, pz);                 // frame (1 cm into the wall)
      box(0.02, 1.2, 0.86, brass, wing - s * 0.005, 1.75, pz);                 // gilt edge, a hair proud of the wall only
      kit.plane(0.7, 1.05, { map: posterTex(kit.tex, art), color: 0xc8bca8, lit: false }, {
        pos: [wing - s * 0.035, 1.75, pz], rot: [0, s < 0 ? 90 : -90, 0], parent, shade: false,
      });
    }
  }

  // ── light pools and haze ──────────────────────────────────────────────────────────────────────
  const poolMap = poolTex(kit.tex);
  for (const p of o.pools) {
    const m = kit.mat({ map: poolMap, color: p.color, lit: false, additive: true, transparent: true, fog: true });
    const pl = kit.plane(p.r * 2, p.r * 2, m, { pos: [p.x, p.y ?? 0.035, p.z], rot: [-90, 0, 0], parent, shade: false });
    pl.renderOrder = 2;
  }
  for (const b of o.beams) {
    const m = kit.mat({ color: b.color, lit: false, additive: true, transparent: true, side: 'double' });
    const c = kit.cyl(b.r0, b.r1, b.y0 - b.y1, m, { pos: [b.x, (b.y0 + b.y1) / 2, b.z], parent, seg: 12, open: true, shade: false });
    c.renderOrder = 2;
  }
}

