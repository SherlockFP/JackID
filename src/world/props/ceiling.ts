/**
 * Ceiling dressing (WORLD-ARCH, wave 77). The zone ceilings were one flat plane that the point lights never reached, so
 * looking up showed a dark void with a few bare cords. This puts a real ceiling over every zone:
 *
 *   - a coffered grid: perimeter cornice, deep cross beams with a brass edge line, and a softly lit panel in every bay
 *   - hanging brass lamps with cords at the beam crossings (visual only: the light pool is full enough)
 *   - slotted vent grilles in some bays, a round-edged duct run with brass bands over the tall rooms, sagging cable bundles
 *   - the undersides of the Well balconies: a wood soffit, corbels and a row of small lamps
 *
 * Everything is a static kit primitive parented to `parent` (merged by `kit.finalize`). The materials carry their own
 * glow (emissive or unlit), so the ceiling reads without any light shining on it. No timers, no rng.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { V3 } from '@/core/types';

export interface CeilingZone { id: string; rect: [number, number, number, number]; h: number }
export interface CeilingOpts {
  parent: THREE.Object3D;
  zones: readonly CeilingZone[];
  /** Spots (x, z, radius) where no hanging lamp may be placed: chandeliers, signposts, the jackpot wall. */
  avoid?: ReadonlyArray<readonly [number, number, number]>;
}

/** Panel tint per zone: the bay glow follows the colour of the room below. */
const TINT: Record<string, number> = {
  mouth: 0xc8a068, well: 0xd0a468, lobby: 0xc89c70, midway: 0xa070c0, cards: 0x70b080, laundry: 0x80b0c0,
  boiler: 0xc07850, gallery: 0x8868c0, wheels: 0xc86a58, parlour: 0x907060, counting: 0xa08860,
};

const CELL = 4.2;

export function buildCeilingDressing(kit: KitX, tex: TexGen, o: CeilingOpts): void {
  const parent = o.parent;
  // the panel face: a lit centre, a darker rim and a thin brass line, one image stretched over every bay
  const panelTex = tex.canvas(32, 32, (g, w, h) => {
    g.fillStyle = '#7a6040'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b89860'; g.fillRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#d8bc7c'; g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#c8a45a'; g.fillRect(14, 6, 4, h - 12); g.fillRect(6, 14, w - 12, 4);
  }, { wrap: 'clamp' });
  const beamMat = kit.mat({ color: 0x6a4428, emissive: 0x3c2410, emissiveIntensity: 1 });
  const trimMat = kit.mat({ color: 0xb08a38, emissive: 0x4a3810, emissiveIntensity: 1 });
  const ductMat = kit.mat({ color: 0x8a9096, emissive: 0x30363c, emissiveIntensity: 1 });
  const ventMat = kit.mat({ color: 0x241810, lit: false });
  const glowMat = kit.mat({ color: 0xffe2a0, lit: false });
  const cordMat = kit.mat({ color: 0x0c0a08, lit: false });

  const free = (x: number, z: number): boolean => !(o.avoid ?? []).some(([ax, az, r]) => (x - ax) ** 2 + (z - az) ** 2 < r * r);

  for (const zone of o.zones) {
    const [x0, z0, x1, z1] = zone.rect;
    const H = zone.h, w = x1 - x0, d = z1 - z0, xc = (x0 + x1) / 2, zc = (z0 + z1) / 2;
    const bd = H >= 8 ? 0.6 : H >= 5 ? 0.42 : H >= 3.4 ? 0.3 : 0.2;   // beam depth
    const bw = Math.max(0.18, bd * 0.7);
    const nx = Math.max(1, Math.round(w / CELL)), nz = Math.max(1, Math.round(d / CELL));
    const cw = w / nx, cd = d / nz;
    const xs: number[] = [], zs: number[] = [];
    for (let i = 1; i < nx; i++) xs.push(x0 + i * cw);
    for (let j = 1; j < nz; j++) zs.push(z0 + j * cd);
    const tint = TINT[zone.id] ?? 0xc0a070;
    const panelMat = kit.mat({ map: panelTex, color: tint, lit: false });

    // cornice: a deep band along the walls with a brass line on its lower edge
    const cy = H - bd * 0.35, ct = 0.3;
    for (const sz of [-1, 1]) {
      const z = sz < 0 ? z0 + ct / 2 + 0.15 : z1 - ct / 2 - 0.15;
      kit.box(w - 0.3, bd * 0.7, ct, beamMat, { pos: [xc, cy, z], parent, shade: false });
      kit.box(w - 0.3, 0.04, ct + 0.04, trimMat, { pos: [xc, H - bd * 0.7, z], parent, shade: false });
    }
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? x0 + ct / 2 + 0.15 : x1 - ct / 2 - 0.15;
      kit.box(ct, bd * 0.7, d - 0.3, beamMat, { pos: [x, cy, zc], parent, shade: false });
      kit.box(ct + 0.04, 0.04, d - 0.3, trimMat, { pos: [x, H - bd * 0.7, zc], parent, shade: false });
    }
    // cross beams
    for (const x of xs) {
      kit.box(bw, bd, d - 0.3, beamMat, { pos: [x, H - bd / 2, zc], parent, shade: false });
      kit.box(bw + 0.04, 0.035, d - 0.3, trimMat, { pos: [x, H - bd, zc], parent, shade: false });
    }
    for (const z of zs) {
      kit.box(w - 0.3, bd * 0.85, bw, beamMat, { pos: [xc, H - (bd * 0.85) / 2, z], parent, shade: false });
      kit.box(w - 0.3, 0.035, bw + 0.04, trimMat, { pos: [xc, H - bd * 0.85, z], parent, shade: false });
    }
    // lit panel in every bay
    const bayX = (i: number): number => x0 + (i + 0.5) * cw;
    const bayZ = (j: number): number => z0 + (j + 0.5) * cd;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const pw = Math.max(0.6, cw - bw - 0.7), pd = Math.max(0.6, cd - bw - 0.7);
        kit.box(pw, 0.05, pd, panelMat, { pos: [bayX(i), H - 0.045, bayZ(j)], parent, shade: false });
        // some bays carry a slotted vent instead of bare panel
        if (H >= 3.4 && (i * 3 + j) % 4 === 1) {
          const vx = bayX(i), vz = bayZ(j);
          kit.box(1.0, 0.05, 0.6, ventMat, { pos: [vx, H - 0.1, vz], parent, shade: false });
          for (let s = -2; s <= 2; s++) kit.box(0.9, 0.025, 0.04, trimMat, { pos: [vx, H - 0.14, vz + s * 0.11], parent, shade: false });
          kit.box(1.08, 0.04, 0.68, trimMat, { pos: [vx, H - 0.07, vz], parent, shade: false });
        }
      }
    }
    // hanging lamps at the beam crossings
    const drop = H >= 8 ? 1.5 : H >= 5 ? 0.9 : H >= 3.4 ? 0.4 : 0;
    if (drop > 0) {
      let n = 0;
      for (const x of xs) {
        for (const z of zs) {
          if ((n++) % 2 !== 0 || !free(x, z)) continue;
          const top = H - bd;
          kit.cyl(0.008, 0.008, drop, cordMat, { pos: [x, top - drop / 2, z], parent, seg: 4, shade: false });
          kit.cyl(0.06, 0.24, 0.2, trimMat, { pos: [x, top - drop - 0.1, z], parent, seg: 8, shade: false });
          kit.cyl(0.19, 0.19, 0.02, glowMat, { pos: [x, top - drop - 0.2, z], parent, seg: 8, shade: false });
        }
      }
    }
    // a duct run over the tall rooms, with brass bands
    if (H >= 4.4) {
      const dx = x0 + cw / 2, dy = H - bd - 0.26, len = d - 1.4;
      kit.box(0.56, 0.38, len, ductMat, { pos: [dx, dy, zc], parent, shade: false });
      for (let z = z0 + 1.4; z < z1 - 1; z += 2.6) {
        kit.box(0.62, 0.44, 0.07, trimMat, { pos: [dx, dy, z], parent, shade: false });
        kit.cyl(0.006, 0.006, 0.26, cordMat, { pos: [dx - 0.2, dy + 0.32, z], parent, seg: 4, shade: false });
        kit.cyl(0.006, 0.006, 0.26, cordMat, { pos: [dx + 0.2, dy + 0.32, z], parent, seg: 4, shade: false });
      }
    }
    // cable bundles sagging between the cross beams, along every other beam
    if (H >= 3.6) {
      xs.forEach((x, k) => {
        if (k % 2 !== 0) return;
        const spans = [z0 + 0.3, ...zs, z1 - 0.3];
        for (let s = 0; s + 1 < spans.length; s++) {
          const za = spans[s] + 0.1, zb = spans[s + 1] - 0.1, y = H - bd + 0.04;
          for (const off of [0.18, 0.26]) {
            const pts: V3[] = [];
            for (let q = 0; q <= 4; q++) {
              const u = q / 4;
              pts.push([x + off, y - Math.sin(u * Math.PI) * 0.16, za + (zb - za) * u]);
            }
            kit.tube(pts, 0.012, cordMat, { parent, seg: 4, radialSeg: 3, shade: false });
          }
        }
      });
    }
  }
}

/**
 * The underside of the Well balconies (the ledge at `y`, both side walls, from z0 to z1): a wood soffit, corbels with a
 * diagonal brace, and a row of small lamps. Mirrors `buildBalcony`.
 */
export function buildBalconyUndersides(kit: KitX, parent: THREE.Object3D, o: { y: number; z0: number; z1: number }): void {
  const len = o.z1 - o.z0, zc = (o.z0 + o.z1) / 2;
  const wood = kit.mat({ color: 0x4a2c18, emissive: 0x32200e, emissiveIntensity: 1 });
  const brass = kit.mat({ color: 0xb08a38, emissive: 0x4a3810, emissiveIntensity: 1 });
  const glow = kit.mat({ color: 0xffe2a0, lit: false });
  for (const side of [-1, 1]) {
    const wallX = side * 10.85;
    const inX = wallX - side * 0.28;
    kit.box(0.62, 0.04, len, wood, { pos: [inX, o.y - 0.09, zc], parent, shade: false });
    kit.box(0.04, 0.06, len, brass, { pos: [wallX - side * 0.6, o.y - 0.1, zc], parent, shade: false });
    for (let z = o.z0 + 0.6; z <= o.z1 - 0.3; z += 1.8) {
      kit.box(0.1, 0.4, 0.14, wood, { pos: [wallX - side * 0.08, o.y - 0.3, z], parent, shade: false });
      kit.box(0.07, 0.5, 0.1, wood, { pos: [wallX - side * 0.3, o.y - 0.3, z], parent, rot: [0, 0, side * 52], shade: false });
      // a lamp in a brass cup between the corbels
      const lz = z + 0.9;
      if (lz < o.z1 - 0.2) {
        kit.cyl(0.07, 0.04, 0.06, brass, { pos: [wallX - side * 0.4, o.y - 0.14, lz], parent, seg: 6, shade: false });
        kit.sphere(0.06, glow, { pos: [wallX - side * 0.4, o.y - 0.21, lz], parent, wSeg: 6, hSeg: 4, shade: false });
      }
    }
  }
}
