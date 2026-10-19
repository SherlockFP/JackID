/**
 * The lived-in casino (wave 81, interior pass): draws the `LoungePlan` (props/loungePlan.ts). Rugs with braided borders, potted
 * palms, club chairs, supper tables with lamps, banquettes, bar carts, brass torchieres, velvet-rope stanchions, framed art with
 * picture lights, wall sconces, bar pendants, a brass chair rail along the nave walls and a lamp on every column.
 *
 * Everything is a static kit primitive parented to `parent` (merged by `kit.finalize`, so it costs a few draw calls). Materials
 * carry a little emissive so the brass, velvet and wood read in the dark without lights; lamp shades are unlit. Walking pieces
 * return a collider each. No timers, no rng.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { V3 } from '@/core/types';
import { registerGlow } from '../lights';
import { COLUMN_Z, DOORS, WALL, type LoungeItem, type LoungePlan, type Rect, type RugTone } from './loungePlan';
import { kilimTex } from './surfaces';
import { cayGlass, tavla } from './identity';

type Ctx2D = CanvasRenderingContext2D;
/** Pixel-art paintings: [width px, height px, painter]. Landscape unless noted. */
const ART: ReadonlyArray<readonly [number, number, (g: Ctx2D, w: number, h: number) => void]> = [
  // 0 night skyline under a moon
  [64, 44, (g, w, h) => {
    g.fillStyle = '#10182c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c2a4c'; g.fillRect(0, 20, w, h);
    g.fillStyle = '#2c3c64'; g.fillRect(0, 30, w, h);
    g.fillStyle = '#f0d890'; g.beginPath(); g.arc(46, 12, 6, 0, Math.PI * 2); g.fill();
    for (let i = 0, x = 0; x < w; i++, x += 7) {
      const bh = 12 + ((i * 7919 + 13) % 17);
      g.fillStyle = '#080c18'; g.fillRect(x, h - bh, 6, bh);
      g.fillStyle = '#f8d070';
      for (let y = h - bh + 2; y < h - 2; y += 4) if ((x + y) % 3 !== 0) g.fillRect(x + 1 + ((y >> 2) % 3) * 2, y, 1, 2);
    }
  }],
  // 1 roulette wheel from above
  [56, 56, (g, w, h) => {
    g.fillStyle = '#180a0c'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#c8962e'; g.beginPath(); g.arc(cx, cy, 26, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 16; i++) {
      g.fillStyle = i % 2 ? '#b01c28' : '#101010';
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 23, (i / 16) * Math.PI * 2, ((i + 1) / 16) * Math.PI * 2); g.closePath(); g.fill();
    }
    g.fillStyle = '#c8962e'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2410'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f0e0'; g.fillRect(cx + 12, cy - 15, 3, 3);
  }],
  // 2 a fan of cards on felt
  [64, 44, (g, w, h) => {
    g.fillStyle = '#0c2e1e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.save(); g.translate(w / 2, h + 4); g.rotate((-0.5 + i * 0.33));
      g.fillStyle = '#f0e8d0'; g.fillRect(-7, -34, 14, 22);
      g.fillStyle = i % 2 ? '#101010' : '#b01c28'; g.fillRect(-4, -31, 4, 4); g.fillRect(-2, -26, 4, 8);
      g.restore();
    }
  }],
  // 3 gold sunburst on black
  [56, 56, (g, w, h) => {
    g.fillStyle = '#1a0a10'; g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.72;
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#7a5a1c' : '#c8962e';
      g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 50, Math.PI + (i / 14) * Math.PI, Math.PI + ((i + 1) / 14) * Math.PI); g.closePath(); g.fill();
    }
    g.fillStyle = '#f0d890'; g.beginPath(); g.arc(cx, cy, 8, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0a10'; g.fillRect(0, cy, w, h);
  }],
  // 4 portrait: a woman in red, in profile of light
  [44, 60, (g, w, h) => {
    g.fillStyle = '#3a0c14'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5a1620'; g.fillRect(0, 0, 8, h);
    g.fillStyle = '#7a1428'; g.beginPath(); g.moveTo(4, h); g.lineTo(10, 40); g.lineTo(34, 40); g.lineTo(40, h); g.closePath(); g.fill();
    g.fillStyle = '#e0b898'; g.fillRect(19, 34, 7, 8); g.beginPath(); g.ellipse(22, 24, 8, 11, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#140808'; g.beginPath(); g.ellipse(22, 19, 10, 10, 0, Math.PI, Math.PI * 2); g.fill(); g.fillRect(12, 19, 3, 14);
    g.fillStyle = '#c01c2c'; g.fillRect(19, 30, 6, 2);
    g.fillStyle = '#f0d890'; g.fillRect(17, 39, 10, 1);
  }],
  // 5 a crown and two dice on night blue
  [64, 44, (g, w, h) => {
    g.fillStyle = '#101c30'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c8962e'; g.beginPath(); g.moveTo(18, 30); g.lineTo(16, 12); g.lineTo(25, 20); g.lineTo(32, 8); g.lineTo(39, 20); g.lineTo(48, 12); g.lineTo(46, 30); g.closePath(); g.fill();
    g.fillStyle = '#7a5a1c'; g.fillRect(18, 30, 28, 4);
    g.fillStyle = '#b01c28'; g.fillRect(31, 22, 3, 3); g.fillStyle = '#63e6de'; g.fillRect(22, 25, 2, 2); g.fillRect(41, 25, 2, 2);
    g.fillStyle = '#f0e8d0'; g.fillRect(6, 30, 8, 8); g.fillRect(50, 32, 8, 8);
    g.fillStyle = '#101010'; g.fillRect(8, 32, 2, 2); g.fillRect(11, 35, 2, 2); g.fillRect(52, 34, 2, 2); g.fillRect(55, 37, 2, 2);
  }],
];

export interface LoungeBuild { statics: Array<{ box: THREE.Box3; tag: 'solid' }> }

export function buildLounge(kit: KitX, o: { parent: THREE.Object3D; plan: LoungePlan; clock?: { x: number; y: number; z: number } }): LoungeBuild {
  const parent = o.parent;
  const statics: LoungeBuild['statics'] = [];
  const lit = (color: number, em: number): THREE.Material => kit.mat({ color, emissive: em, emissiveIntensity: 1 });
  // vendor grain (Synthetic pack) tinted to the target colour: wood, tufted leather and velvet read as materials, not flat paint
  const grain = (path: string, color: number, em: number): THREE.Material =>
    kit.mat({ map: kit.tex.vendor(`sbs-synthetic/128x128/${path}`, { size: 64 }), color, emissive: em, emissiveIntensity: 1 });
  const brass = lit(0xb08a38, 0x3a2a0c), wood = grain('Wood/Synth-Wood_05-128x128.png', 0x634a3b, 0x1c0f08), woodDark = grain('Wood/Synth-Wood_05-128x128.png', 0x402e25, 0x120a06);
  const velvet = grain('Fabric/Synth-Fabric_07-128x128.png', 0x8b1833, 0x2a060e), leather = grain('Leather/Synth-Leather_13-128x128.png', 0x6b3b28, 0x1c0f08), pot = lit(0x2a1c14, 0x0c0806);
  const glass = lit(0xe0a860, 0x60401c), ropeMat = lit(0x8c1921, 0x2a0508);
  const glow = kit.mat({ color: 0xffd08a, lit: false });
  const ashGlass = kit.mat({ color: 0x5a6a70, lit: false }), paper = kit.mat({ color: 0xe8e0d0, lit: false }), ember = kit.mat({ color: 0xff6020, lit: false });
  const CHIP = [0xb01c28, 0x1c3a8a, 0xe8e0d0, 0x1c6a3a].map((c) => kit.mat({ color: c, lit: false }));
  // the wall sconces' lamps: their own unique material so the night cycle can darken them at Dawn (one zone for the whole nave)
  const sconceGlow = kit.mat({ color: 0xffd08a, lit: false, unique: true }) as THREE.MeshBasicMaterial;
  registerGlow(sconceGlow, [0, 2.7, -5], 'well');
  const leaves = [lit(0x2f6a35, 0x0c2010), lit(0x3d8040, 0x10281a), lit(0x24522b, 0x08180c)];
  const box = (w: number, h: number, d: number, m: THREE.Material, pos: V3, yaw = 0): void => { kit.box(w, h, d, m, { pos, rot: [0, yaw, 0], parent, shade: false }); };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, pos: V3, seg = 8): void => { kit.cyl(rt, rb, h, m, { pos, parent, seg, shade: false }); };
  /** Local (lx, ly, lz) of a piece standing at (x, z) turned `yawDeg` about Y -> world position. */
  const at = (x: number, z: number, yawDeg: number) => {
    const a = (yawDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  };
  const solidBox = (x: number, z: number, hw: number, hd: number, h: number, yaw = 0): void => {
    const sw = Math.round(yaw / 90) % 2 !== 0;
    const [a, b] = sw ? [hd, hw] : [hw, hd];
    statics.push({ box: new THREE.Box3(new THREE.Vector3(x - a, 0, z - b), new THREE.Vector3(x + a, h, z + b)), tag: 'solid' });
  };

  // ── rugs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const FIELD: Record<RugTone, THREE.Material> = {
    red: kit.mat({ map: kit.tex.carpet('diamond', [0x8a1a30, 0x5a0e1e, 0xc89c3c, 0x2aa898]), color: 0xffffff, emissive: 0x240a10, emissiveIntensity: 1 }),
    green: kit.mat({ map: kit.tex.carpet('diamond', [0x0a2c1e, 0x071f15, 0x6a5828, 0x154a3e]), color: 0xffffff, emissive: 0x030c08, emissiveIntensity: 1 }),
    navy: kit.mat({ map: kit.tex.carpet('stars', [0x1c2a6a, 0x2a3c90, 0xc89c3c, 0x2aa898]), color: 0xffffff, emissive: 0x0a1030, emissiveIntensity: 1 }),
    kilim: kit.mat({ map: kilimTex(kit.tex), color: 0xffffff, emissive: 0x1c0806, emissiveIntensity: 1 }),
  };
  const edge = lit(0x8a6a28, 0x2a2008), braid = lit(0xd8b860, 0x4a3a18);
  const rug = (r: Rect, tone: RugTone): void => {
    const [x0, z0, x1, z1] = r, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    box(w, 0.014, d, edge, [cx, 0.007, cz]);
    box(w - 0.32, 0.022, d - 0.32, FIELD[tone], [cx, 0.011, cz]);
    const bx = w - 0.52, bz = d - 0.52;
    for (const s of [-1, 1]) {
      box(bx, 0.028, 0.035, braid, [cx, 0.014, cz + s * (d / 2 - 0.26)]);
      box(0.035, 0.028, bz, braid, [cx + s * (w / 2 - 0.26), 0.014, cz]);
    }
  };

  // ── pieces ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const plant = (x: number, z: number, h: number): void => {
    cyl(0.3, 0.22, 0.5, pot, [x, 0.25, z], 8);
    cyl(0.33, 0.31, 0.06, brass, [x, 0.5, z], 8);
    cyl(0.28, 0.28, 0.02, woodDark, [x, 0.535, z], 8);   // soil, 1.5 cm proud of the rim (both tops were at y 0.53)
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (k % 2) * 0.2, th = ((24 + ((k * 37) % 30)) * Math.PI) / 180, len = h * (0.55 + ((k * 53) % 40) / 100);
      const cx = x + Math.cos(a) * Math.sin(th) * (len / 2), cz = z - Math.sin(a) * Math.sin(th) * (len / 2), cy = 0.52 + Math.cos(th) * (len / 2);
      kit.box(0.2, len, 0.012, leaves[k % 3], { pos: [cx, cy, cz], rot: [0, (a * 180) / Math.PI, (-th * 180) / Math.PI], parent, shade: false });
    }
    solidBox(x, z, 0.38, 0.38, 0.55);
  };
  const chair = (x: number, z: number, yaw: number): void => {
    const P = at(x, z, yaw);
    box(0.62, 0.16, 0.6, leather, P(0, 0.34, 0), yaw);
    box(0.52, 0.1, 0.5, velvet, P(0, 0.47, 0.02), yaw);
    box(0.62, 0.55, 0.13, velvet, P(0, 0.72, -0.26), yaw);
    for (const sx of [-1, 1]) box(0.09, 0.3, 0.52, leather, P(sx * 0.34, 0.56, 0), yaw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.06, 0.26, 0.06, woodDark, P(sx * 0.26, 0.13, sz * 0.24), yaw);
    solidBox(x, z, 0.33, 0.33, 0.95);
  };
  const table = (x: number, z: number, r: number, lamp: boolean): void => {
    cyl(r, r, 0.04, wood, [x, 0.74, z], 12);
    cyl(r + 0.012, r + 0.012, 0.012, brass, [x, 0.72, z], 12);
    cyl(0.04, 0.05, 0.7, woodDark, [x, 0.37, z], 6);
    cyl(0.22, 0.26, 0.04, woodDark, [x, 0.02, z], 8);
    // drinks: a tumbler and a çay glass; on a table with no lamp a tavla game is left open, the drinks pushed to the near side
    const dz = lamp ? r * 0.15 : 0.12;
    cyl(0.035, 0.028, 0.09, glass, [x - r * 0.62, 0.815, z - dz], 6);
    cayGlass(kit, parent, x + r * 0.7, 0.76, z + (lamp ? dz : -0.04));
    cyl(0.06, 0.055, 0.018, ashGlass, [x - r * 0.25, 0.769, z - r * 0.5], 8);
    box(0.07, 0.01, 0.01, paper, [x - r * 0.25 + 0.04, 0.784, z - r * 0.5], 30);
    box(0.012, 0.012, 0.012, ember, [x - r * 0.25 + 0.073, 0.784, z - r * 0.5 - 0.019]);
    if ((Math.round(x * 7 + z * 13) & 1) === 0) for (let i = 0; i < 4; i++) cyl(0.021, 0.021, 0.008, CHIP[(i + Math.round(x)) & 3], [x + r * 0.3, 0.764 + i * 0.0085, z - r * 0.35], 8);
    if (lamp) {
      cyl(0.05, 0.07, 0.16, brass, [x, 0.84, z], 6);
      cyl(0.07, 0.15, 0.17, glow, [x, 1.0, z], 8);
    } else tavla(kit, parent, x, 0.76, z + 0.1);
    solidBox(x, z, r, r, 0.78);
  };
  const bench = (x: number, z: number, yaw: number, len: number): void => {
    const P = at(x, z, yaw);
    box(len - 0.1, 0.24, 0.5, woodDark, P(0, 0.2, 0.02), yaw);
    box(len, 0.14, 0.56, leather, P(0, 0.4, 0.02), yaw);
    box(len - 0.1, 0.1, 0.48, velvet, P(0, 0.5, 0.04), yaw);
    box(len, 0.62, 0.12, velvet, P(0, 0.82, -0.25), yaw);
    box(len + 0.04, 0.05, 0.16, brass, P(0, 1.14, -0.25), yaw);
    solidBox(x, z, len / 2, 0.32, 1.1, yaw);
  };
  const cart = (x: number, z: number, yaw: number): void => {
    const P = at(x, z, yaw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.03, 0.9, 0.03, brass, P(sx * 0.42, 0.45, sz * 0.24), yaw);
    box(0.9, 0.03, 0.52, wood, P(0, 0.42, 0), yaw);
    box(0.9, 0.03, 0.52, wood, P(0, 0.86, 0), yaw);
    box(0.92, 0.05, 0.04, brass, P(0, 0.9, 0.27), yaw);
    for (const [i, c] of ([0xb8742c, 0x2f7a42, 0xa8c8d0, 0x8a1c28] as const).entries()) {
      cyl(0.04, 0.045, 0.26, lit(c, 0x181008), P(-0.3 + i * 0.2, 1.0, -0.05), 6);
    }
    for (const s of [-1, 1]) cyl(0.03, 0.025, 0.09, glass, P(s * 0.3, 0.485, 0.05), 6);
    for (const s of [-1, 1]) kit.cyl(0.1, 0.1, 0.03, woodDark, { pos: P(s * 0.4, 0.1, 0), rot: [0, yaw, 90], parent, seg: 8, shade: false });
    solidBox(x, z, 0.46, 0.28, 0.95, yaw);
  };
  const torch = (x: number, z: number): void => {
    cyl(0.2, 0.24, 0.04, brass, [x, 0.02, z], 8);
    cyl(0.02, 0.02, 1.5, brass, [x, 0.79, z], 6);
    cyl(0.16, 0.26, 0.34, glow, [x, 1.72, z], 8);
    cyl(0.05, 0.16, 0.05, brass, [x, 1.91, z], 8);
    kit.sphere(0.04, brass, { pos: [x, 1.97, z], wSeg: 5, hSeg: 4, parent, shade: false });
    solidBox(x, z, 0.24, 0.24, 2.0);
  };
  const sconce = (x: number, y: number, z: number, yaw: number): void => {
    const P = at(x, z, yaw);
    box(0.16, 0.34, 0.04, brass, P(0, y, 0.02), yaw);
    box(0.05, 0.05, 0.14, brass, P(0, y - 0.05, 0.09), yaw);
    cyl(0.06, 0.06, 0.26, sconceGlow, P(0, y + 0.06, 0.16), 6);
    cyl(0.085, 0.07, 0.04, brass, P(0, y - 0.09, 0.16), 6);
    cyl(0.07, 0.085, 0.04, brass, P(0, y + 0.21, 0.16), 6);
  };
  const arts = new Map<number, THREE.Texture>();
  const frame = (x: number, y: number, z: number, yaw: number, w: number, art: number): void => {
    const [pw, ph, paint] = ART[art % ART.length];
    const h = (w * ph) / pw, P = at(x, z, yaw);
    box(w + 0.2, h + 0.2, 0.05, brass, P(0, y, 0.025), yaw);
    box(w + 0.1, h + 0.1, 0.06, woodDark, P(0, y, 0.035), yaw);
    let canvas = arts.get(art % ART.length);
    if (!canvas) { canvas = kit.tex.canvas(pw, ph, paint, { wrap: 'clamp' }); arts.set(art % ART.length, canvas); }
    kit.plane(w, h, { map: canvas, color: 0xd8ccbc, lit: false }, { pos: P(0, y, 0.075), rot: [0, yaw, 0], parent, shade: false });
    box(Math.min(0.7, w * 0.4), 0.05, 0.05, brass, P(0, y + h / 2 + 0.2, 0.12), yaw);
    box(Math.min(0.55, w * 0.32), 0.025, 0.04, glow, P(0, y + h / 2 + 0.17, 0.14), yaw);
  };
  const pendant = (x: number, z: number, y: number, ceil: number): void => {
    cyl(0.006, 0.006, ceil - y - 0.1, woodDark, [x, (ceil + y + 0.1) / 2, z], 4);
    cyl(0.06, 0.24, 0.18, brass, [x, y + 0.01, z], 8);
    cyl(0.2, 0.2, 0.02, glow, [x, y - 0.09, z], 8);
  };
  const ropes = (pts: ReadonlyArray<readonly [number, number]>): void => {
    for (const [x, z] of pts) {
      cyl(0.15, 0.17, 0.03, brass, [x, 0.015, z], 8);
      cyl(0.022, 0.026, 0.9, brass, [x, 0.46, z], 6);
      kit.sphere(0.045, brass, { pos: [x, 0.94, z], wSeg: 6, hSeg: 4, parent, shade: false });
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      kit.tube([[ax, 0.86, az], [(ax + bx) / 2, 0.76, (az + bz) / 2], [bx, 0.86, bz]], 0.014, ropeMat, { parent, seg: 6, radialSeg: 3, shade: false });
    }
  };

  for (const it of o.plan.items as LoungeItem[]) {
    switch (it.k) {
      case 'rug': rug(it.rect, it.tone); break;
      case 'plant': plant(it.x, it.z, it.h); break;
      case 'chair': chair(it.x, it.z, it.yaw); break;
      case 'table': table(it.x, it.z, it.r, it.lamp); break;
      case 'bench': bench(it.x, it.z, it.yaw, it.len); break;
      case 'cart': cart(it.x, it.z, it.yaw); break;
      case 'torch': torch(it.x, it.z); break;
      case 'frame': frame(it.x, it.y, it.z, it.yaw, it.w, it.art); break;
      case 'sconce': sconce(it.x, it.y, it.z, it.yaw); break;
      case 'pendant': pendant(it.x, it.z, it.y, it.ceil); break;
      case 'ropes': ropes(it.pts); break;
    }
  }

  // ── the nave walls: a brass chair rail over the wainscot (split at the doorways) and a lamp on every column ───────────
  const rail = (x0: number, z0: number, x1: number, z1: number): void => {
    const w = Math.abs(x1 - x0) || 0.1, d = Math.abs(z1 - z0) || 0.1;
    box(w, 0.06, d, brass, [(x0 + x1) / 2, 1.25, (z0 + z1) / 2]);
  };
  let cur = -29.85;
  for (const [z0, z1] of DOORS) { rail(WALL - 0.08, cur, WALL - 0.08, z0); rail(-(WALL - 0.08), cur, -(WALL - 0.08), z0); cur = z1; }
  rail(WALL - 0.08, cur, WALL - 0.08, 19.85); rail(-(WALL - 0.08), cur, -(WALL - 0.08), 19.85);
  rail(-WALL, -29.77, -5, -29.77); rail(-3, -29.77, WALL, -29.77);
  rail(-WALL, 19.77, WALL, 19.77);
  for (const z of COLUMN_Z) {
    for (const sx of [-1, 1]) {
      const x = sx * 7;
      cyl(0.34, 0.34, 0.07, brass, [x, 1.3, z], 8);
      sconce(x - sx * 0.3, 2.5, z, sx < 0 ? 90 : 270);
    }
  }
  // ── the clock wall: a velvet panel in a brass frame behind the wall clock, so the Mouth's focal wall reads as a feature ───
  if (o.clock) {
    const { x, y, z } = o.clock, pz = z - 0.12, pw = 5.0, ph = 2.95;
    box(pw, ph, 0.04, velvet, [x, y + 0.05, pz]);
    for (const sy of [-1, 1]) box(pw + 0.2, 0.1, 0.07, brass, [x, y + 0.05 + sy * (ph / 2 + 0.05), pz + 0.02]);
    for (const sx of [-1, 1]) box(0.1, ph + 0.2, 0.07, brass, [x + sx * (pw / 2 + 0.05), y + 0.05, pz + 0.02]);
  }
  return { statics };
}
