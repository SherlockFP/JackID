/**
 * Zone model (WORLD-SYS): rectangles from WORLD-ARCH's layout, point-in-zone lookup, distance-to-zone (culling) and the
 * blended atmosphere (fog colour / near / far, hemisphere ambient) the camera sees. Fog follows ART_BIBLE §1.6: every
 * zone has a 3 m blend band centred on its boundary, so walking through a doorway cross-fades the look instead of cutting.
 */
import * as THREE from 'three';
import type { ZoneId } from '@/core/types';
import { clamp01 } from '@/core/math';
import { DEFAULT_LOOK, type ZoneDef } from './arch';

/** Width of the cross-fade band centred on a zone boundary (m). */
export const FOG_BLEND_M = 3;

/** Atmosphere at a point; reused scratch object, never keep a reference across calls. */
export interface Look {
  fog: THREE.Color;
  near: number;
  far: number;
  ambient: THREE.Color;
}
export const newLook = (): Look => ({ fog: new THREE.Color(), near: 6, far: 26, ambient: new THREE.Color() });

const tmpFog = new THREE.Color();
const tmpAmb = new THREE.Color();

/** Signed distance from (x, z) to a rectangle: negative inside (distance to the nearest edge), positive outside. */
export function signedDistance(r: readonly [number, number, number, number], x: number, z: number): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dz = Math.max(r[1] - z, 0, z - r[3]);
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz);
  return -Math.min(x - r[0], r[2] - x, z - r[1], r[3] - z);
}

export class ZoneMap {
  private readonly byId = new Map<ZoneId, ZoneDef>();
  private readonly order: ZoneDef[];
  private readonly weights: number[];

  constructor(readonly defs: readonly ZoneDef[]) {
    for (const z of defs) this.byId.set(z.id, z);
    // smaller rectangles first, so a doorway zone wins over the room that contains it
    this.order = [...defs].sort((a, b) => area(a) - area(b));
    this.weights = new Array<number>(defs.length).fill(0);
  }

  has(id: ZoneId): boolean { return this.byId.has(id); }
  get(id: ZoneId): ZoneDef | undefined { return this.byId.get(id); }
  ids(): ZoneId[] { return this.defs.map((z) => z.id); }

  zoneAt(x: number, z: number): ZoneId | null {
    for (const d of this.order) {
      const r = d.rect;
      if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return d.id;
    }
    return null;
  }

  /** 0 when (x, z) is inside the zone, otherwise the distance to its rectangle (m). Unknown zones are "far". */
  distanceTo(id: ZoneId, x: number, z: number): number {
    const d = this.byId.get(id);
    return d ? Math.max(0, signedDistance(d.rect, x, z)) : Infinity;
  }

  /** Blend the atmosphere of every zone near (x, z) into `out`. */
  lookAt(x: number, z: number, out: Look): Look {
    const defs = this.defs;
    if (defs.length === 0) return this.fill(out, DEFAULT_LOOK.fog.color, DEFAULT_LOOK.fog.near, DEFAULT_LOOK.fog.far, DEFAULT_LOOK.ambient);
    let total = 0, best = 0, bestD = Infinity;
    for (let i = 0; i < defs.length; i++) {
      const sd = signedDistance(defs[i].rect, x, z);
      if (sd < bestD) { bestD = sd; best = i; }
      const w = clamp01(0.5 - sd / FOG_BLEND_M);
      this.weights[i] = w;
      total += w;
    }
    if (total <= 1e-4) { this.weights.fill(0); this.weights[best] = 1; total = 1; }
    let near = 0, far = 0;
    out.fog.setRGB(0, 0, 0);
    out.ambient.setRGB(0, 0, 0);
    for (let i = 0; i < defs.length; i++) {
      const w = this.weights[i] / total;
      if (w <= 0) continue;
      const d = defs[i];
      const fog = d.fog ?? DEFAULT_LOOK.fog;
      tmpFog.setHex(fog.color);
      tmpAmb.setHex(d.ambient ?? DEFAULT_LOOK.ambient);
      out.fog.r += tmpFog.r * w; out.fog.g += tmpFog.g * w; out.fog.b += tmpFog.b * w;
      out.ambient.r += tmpAmb.r * w; out.ambient.g += tmpAmb.g * w; out.ambient.b += tmpAmb.b * w;
      near += fog.near * w; far += fog.far * w;
    }
    out.near = near;
    out.far = far;
    return out;
  }

  private fill(out: Look, fog: number, near: number, far: number, ambient: number): Look {
    out.fog.setHex(fog);
    out.ambient.setHex(ambient);
    out.near = near;
    out.far = far;
    return out;
  }
}

const area = (z: ZoneDef): number => (z.rect[2] - z.rect[0]) * (z.rect[3] - z.rect[1]);
