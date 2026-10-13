/**
 * Glass, domes and cages. Glass is unlit alpha with a baked pair of diagonal glints: the base level is dim and the
 * streaks are bright, so a pane reads as glass on a 400×225 frame even when nothing is visible through it.
 * Cages are open frames (rings, bars, a bar-dome) — cheap enough for the Sic Bo birdcage and the lotto blower.
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { psx } from './materials';
import { rgbHex } from './palette';
import type { KitCtx } from './ctx';
import type { Kit } from './types';

const TAU = Math.PI * 2;

export function makeGlassware(ctx: KitCtx): Pick<Kit, 'glass' | 'dome' | 'cage'> {
  const { P, M, pal, tex } = ctx;

  /** 16×16 RGBA: 0.7-grey base (alpha .55) with two bright diagonal streaks (alpha 1). */
  const glint = (): THREE.Texture => tex.canvas(16, 16, (g) => {
    g.clearRect(0, 0, 16, 16);
    g.fillStyle = 'rgba(178,178,178,0.55)'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < 16; i++) {
      const x1 = (i + 3) & 15, x2 = (i + 8) & 15;
      g.fillRect(x1, 15 - i, 1, 1); g.fillRect((x1 + 1) & 15, 15 - i, 1, 1);
      if (i > 7) g.fillRect(x2, 15 - i, 1, 1);
    }
  }, { key: 'kit:glint', wrap: 'clamp' });

  const glassMat = (tint: Hex, opacity: number, side: 'front' | 'double'): THREE.Material => {
    const c = new THREE.Color(tint);
    return psx({
      color: rgbHex(c.r * 255 * 1.4, c.g * 255 * 1.4, c.b * 255 * 1.4),
      map: glint(), lit: false, transparent: true, opacity, depthWrite: false, side, affine: false,
    });
  };

  const glass: Kit['glass'] = (o) => {
    const geo = new THREE.BoxGeometry(o.w, o.h, o.d ?? 0.01);
    const m = new THREE.Mesh(geo, glassMat(o.tint ?? pal.glass, o.opacity ?? 0.25, 'front'));
    m.name = 'glass';
    m.renderOrder = 2;
    return m;
  };

  const dome: Kit['dome'] = (o) => {
    const geo = new THREE.SphereGeometry(o.r, 12, 6, 0, TAU, 0, Math.PI / 2);
    const m = new THREE.Mesh(geo, glassMat(o.tint ?? pal.glass, o.opacity ?? 0.25, 'double'));
    m.name = 'dome';
    m.renderOrder = 2;
    return m;
  };

  const cage: Kit['cage'] = (o) => {
    const g = P.group('cage');
    const metal = o.color === undefined ? M.chrome() : { color: o.color, vertexColors: true };
    const bars = Math.max(3, o.bars);
    const rBar = Math.max(0.004, o.r * 0.025);
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * TAU;
      P.cyl(rBar, rBar, o.h, metal, { pos: [Math.cos(a) * o.r, o.h / 2, Math.sin(a) * o.r], seg: 4, open: true, parent: g, name: 'bar' });
    }
    for (const y of [0.0, o.h]) P.torus(o.r, rBar * 1.5, metal, { pos: [0, y, 0], rot: [90, 0, 0], seg: 12, tubeSeg: 3, parent: g, name: 'ring' });
    P.torus(o.r, rBar, metal, { pos: [0, o.h * 0.5, 0], rot: [90, 0, 0], seg: 12, tubeSeg: 3, parent: g, name: 'ring_mid' });
    // bar-dome: meridian arcs from the top ring to an apex
    const arcs = Math.min(8, Math.max(4, Math.round(bars / 3)));
    for (let i = 0; i < arcs; i++) {
      const a = (i / arcs) * TAU;
      const pts: Array<[number, number, number]> = [];
      for (let k = 0; k <= 4; k++) {
        const t = (k / 4) * (Math.PI / 2);
        pts.push([Math.cos(a) * o.r * Math.cos(t), o.h + o.r * 0.7 * Math.sin(t), Math.sin(a) * o.r * Math.cos(t)]);
      }
      P.tube(pts, rBar, metal, { seg: 6, radialSeg: 3, parent: g, name: 'dome_bar' });
    }
    P.sphere(rBar * 2.4, M.brass(), { pos: [0, o.h + o.r * 0.7, 0], wSeg: 6, hSeg: 4, parent: g, name: 'apex' });
    return g;
  };

  return { glass, dome, cage };
}
