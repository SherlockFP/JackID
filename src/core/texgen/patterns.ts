/**
 * Surface painters (ART_BIBLE §3.2–§3.3): felt, wood, brushed metal, chrome, rust, concrete, brick, tiles,
 * leather, velvet, marble, wallpaper, the casino carpet family, grime/stain/crack decals, glow, env spheres.
 * Owner: CORE-TEXGEN.
 *
 * Every function is a pure `(params) → Pix` of 16–64 px. Tiling textures use periodic value noise so they
 * repeat seamlessly; all of them are deterministic (seed derived from the arguments), so every peer
 * generates the same pixels. Colours given as `Hex` expand into palette-pure ramps when the colour belongs
 * to a palette ramp (`rampFor`), else into derived 15-bit-snapped shades.
 */
import type { Hex } from '../types';
import { createRng, hashSeed } from '../rng';
import { Pix, T, bayer, fbm, hash2, lighten, darken, mix, rampDither, rampFor, snap15, PIP5 } from './pixel';
import {
  P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16, P17, P18, P19, P20, P21, P22, P23, P24, P25,
  P28, P31, P32, P35, P36, P37, P38, P39, P40, P41, P42, P43, P45, P46, RAMP, darker, lighter,
} from './palette';

const seedOf = (...a: Array<string | number>): number => hashSeed(...a) & 0xffff;
const TAU = Math.PI * 2;

// ── felt ─────────────────────────────────────────────────────────────────────────────────────────
/** 32×32 fuzzy flat colour (ART_BIBLE felt recipe). */
export function felt(c: Hex, wear = 0.25): Pix {
  const [lo, mid, hi] = rampFor(c, 3);
  const seed = seedOf('felt', c), p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const h = hash2(x, y, seed);
    let col = h < 0.12 ? lo : h > 0.93 ? hi : mid;
    if (fbm(x / 32, y / 32, 4, 4, 3, seed) < wear && bayer(x, y) < 4) col = col === hi ? mid : col === mid ? lo : darker(lo);
    p.px(x, y, col);
  }
  return p;
}

// ── wood ─────────────────────────────────────────────────────────────────────────────────────────
/** 32×64 grain running along V; `rings` = growth rings across the width, `planks` = seams per tile. */
export function wood(c: Hex, grain = 5, planks = 0): Pix {
  const ramp = rampFor(c, 4);
  const seed = seedOf('wood', c, grain), rng = createRng(seed), p = new Pix(32, 64);
  const kx = rng.int(8, 24), ky = rng.int(12, 52);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
    const warp = 6 * fbm(x / 32, y / 64, 2, 1, 3, seed);
    const ring = (((x + warp) * grain) / 32) % 1;
    let v = 0.55 * ring + 0.25 * fbm(x / 32, y / 64, 16, 8, 2, seed + 7) + 0.2 * (hash2(x, y, seed) - 0.5);
    const d = Math.hypot((x - kx) * 0.8, y - ky);                  // oval knot, 2 dark growth rings
    if (d < 4.5) v = 0.55 + 0.4 * Math.sin(d * 2.6);
    p.px(x, y, d >= 4 && d < 5 ? ramp[0] : rampDither(Math.max(0, Math.min(0.99, v * 1.15)), ramp, x, y));
  }
  if (planks > 0) {
    const step = Math.floor(64 / planks);
    for (let k = 0; k < planks; k++) { p.rect(0, k * step, 32, 1, ramp[0]); p.rect(0, k * step + 1, 32, 1, ramp[2]); }
  }
  return p;
}

// ── wainscot ─────────────────────────────────────────────────────────────────────────────────────
/** 32×32 raised wall panel: grained stiles and a bevelled centre panel (lit top-left, shaded bottom-right). */
export function wainscot(c: Hex): Pix {
  const ramp = rampFor(c, 4), seed = seedOf('wainscot', c), p = new Pix(32, 32);
  const grain = (x: number, y: number, s0: number, base: number): Hex => {
    const v = base + 0.3 * fbm(x / 32, y / 32, 1, 8, 2, s0) + 0.12 * (hash2(x, y, s0) - 0.5);
    return rampDither(Math.max(0, Math.min(0.99, v)), ramp, x, y);
  };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) p.px(x, y, grain(x, y, seed, 0.15));
  p.frame(0, 0, 32, 32, ramp[0]);
  const x0 = 4, y0 = 4, w = 24, h = 24;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const dl = x - x0, dt = y - y0, dr = x0 + w - 1 - x, db = y0 + h - 1 - y, e = Math.min(dl, dt, dr, db);
    if (e >= 3) { p.px(x, y, grain(x, y, seed + 5, 0.3)); continue; }
    const light = Math.min(dl, dt) <= Math.min(dr, db);
    p.px(x, y, light ? (e === 0 ? ramp[3] : ramp[2]) : (e <= 1 ? ramp[0] : ramp[1]));
  }
  return p;
}

// ── metal ────────────────────────────────────────────────────────────────────────────────────────
/** 32×32 metal. Brushed = horizontal streaks with 3 % glints; plain = fine speckle plate with scratches and a bevel. */
export function metal(c: Hex, brushed = true): Pix {
  const ramp = rampFor(c, 4);
  const seed = seedOf('metal', c, brushed ? 1 : 0), rng = createRng(seed), p = new Pix(32, 32);
  if (brushed) {
    for (let y = 0; y < 32; y++) {
      const rowV = 0.5 + 0.35 * (hash2(y, 0, seed) - 0.5);
      for (let x = 0; x < 32; x++) {
        const v = (rowV * 0.6 + fbm(x / 32, y / 32, 3, 32, 2, seed) * 0.4 - 0.2) / 0.6;
        p.px(x, y, rampDither(Math.max(0, Math.min(0.99, v)), ramp, x, y));
      }
    }
    for (let i = 0; i < 31; i++) p.px(rng.int(0, 31), rng.int(0, 31), P10);                // ~3 % glints
  } else {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const v = 0.18 + 0.4 * fbm(x / 32, y / 32, 4, 4, 2, seed) + 0.2 * (hash2(x, y, seed) - 0.5);   // centred on `c`
      p.px(x, y, rampDither(Math.max(0, Math.min(0.99, v)), ramp, x, y));
    }
    for (let i = 0; i < 6; i++) { const x = rng.int(0, 24), y = rng.int(0, 31); p.line(x, y, x + rng.int(3, 8), y + rng.int(-1, 1), ramp[3]); }
    p.rect(0, 0, 32, 1, ramp[3]); p.rect(0, 31, 32, 1, ramp[0]);
  }
  return p;
}

/** 32×32 reflective strip (sky / horizon / ground bands) from the CHROME ramp. */
export function chrome(): Pix {
  const ramp = RAMP.CHROME, p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) {
    const t = y / 31;
    const base = t < 0.45 ? 1 - 0.45 * (t / 0.45) : t < 0.55 ? 0.05 : 0.22 + 0.42 * ((t - 0.55) / 0.45);
    for (let x = 0; x < 32; x++) {
      const v = base + 0.1 * (hash2(x, 0, 3) - 0.5) + (hash2(x, y, 5) - 0.5) * 0.06;
      p.px(x, y, rampDither(Math.max(0, Math.min(0.99, v)), ramp, x, y));
    }
  }
  return p;
}

// ── rust ─────────────────────────────────────────────────────────────────────────────────────────
/** 32×32 painted metal `c` eaten by rust (RUST_DEEP/RUST/COPPER), pits and drips. */
export function rust(c: Hex, coverage = 0.5, drips = 3): Pix {
  const base = rampFor(c, 3), rs = [P16, P17, P18];
  const seed = seedOf('rust', c, coverage), rng = createRng(seed), p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = hash2(x, y, seed);
    let col = n < 0.2 ? base[0] : n > 0.85 ? base[2] : base[1];
    if (fbm(x / 32, y / 32, 4, 4, 3, seed) > 1 - coverage) {
      const k = fbm(x / 32, y / 32, 8, 8, 2, seed + 13);
      col = k < 0.46 ? rs[0] : k < 0.74 ? rs[1] : rs[2];
    }
    if (hash2(x, y, seed + 99) < 0.04) col = P16;
    p.px(x, y, col);
  }
  for (let i = 0; i < drips; i++) {
    const x = rng.int(1, 30), len = rng.int(6, 20);
    for (let y = 0; y < len; y++) if (bayer(x, y) < 8 || y === len - 1) p.px(x, y, P17);
    if (len > 8) { p.px(x - 1, len - 1, P17); p.px(x + 1, len - 1, P17); }
  }
  return p;
}

// ── concrete ─────────────────────────────────────────────────────────────────────────────────────
export interface ConcreteOpts { cracks?: number; stains?: boolean; wet?: boolean }
/** 64×64 poured concrete: mottled, aggregate flecks, random-walk cracks, water stains; `wet` darkens + glints. */
export function concrete(c: Hex, o: ConcreteOpts = {}): Pix {
  const cracks = o.cracks ?? 2, stains = o.stains ?? true, wet = o.wet ?? false;
  const ramp = rampFor(c, 4, 2);
  const seed = seedOf('concrete', c, cracks, stains ? 1 : 0, wet ? 1 : 0), rng = createRng(seed), p = new Pix(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = 0.15 + 0.62 * fbm(x / 64, y / 64, 6, 6, 3, seed) + 0.2 * (hash2(x, y, seed) - 0.5);
    let col = rampDither(Math.max(0, Math.min(0.99, v)), ramp, x, y);
    const h = hash2(x, y, seed + 31);
    if (h < 0.03) col = ramp[3]; else if (h > 0.97) col = ramp[0];
    p.px(x, y, col);
  }
  for (let i = 0; i < cracks; i++) {
    let x = rng.int(4, 59), y = 0, dir = 1;
    if (rng.chance(0.5)) { x = 0; y = rng.int(4, 59); dir = 2; }
    const n = rng.int(20, 40);
    for (let s = 0; s < n; s++) {
      p.px(x, y, darker(darker(ramp[0])));
      p.px(x + 1, y + 1, ramp[3]);
      if (dir === 1) { y++; if (rng.chance(0.3)) x += rng.chance(0.5) ? 1 : -1; } else { x++; if (rng.chance(0.3)) y += rng.chance(0.5) ? 1 : -1; }
      if (x < 0 || y < 0 || x > 62 || y > 62) break;
    }
  }
  if (stains) {
    for (let i = 0; i < 3; i++) {
      const x = rng.int(2, 61), len = rng.int(8, 30);
      for (let y = 0; y < len; y++) for (let dx = 0; dx < 2; dx++) {
        if (bayer(x + dx, y) < 6) { const cur = p.get(x + dx, y); if (cur !== T) p.px(x + dx, y, darker(cur)); }
      }
    }
  }
  if (wet) {
    p.map((x, y, col) => { if (col === T) return undefined; const h = hash2(x, y, seed + 77); return h < 0.004 ? P39 : h < 0.014 ? P36 : darker(col); });
  }
  return p;
}

// ── brick ────────────────────────────────────────────────────────────────────────────────────────
/** 32×32 running-bond brick wall (courses of 8 px, bricks 16 px wide, 1 px mortar). */
export function brick(c: Hex): Pix {
  const ramp = rampFor(c, 3), mortar = P07, mortarLo = P06;
  const seed = seedOf('brick', c), p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const row = y >> 3, off = row & 1 ? 8 : 0, bx = Math.floor(((x + off) % 32) / 16);
    const inMortar = y % 8 === 7 || (x + off) % 16 === 15;
    if (inMortar) { p.px(x, y, hash2(x, y, seed) < 0.25 ? mortarLo : mortar); continue; }
    const tone = hash2(bx, row, seed);
    let col = tone < 0.25 ? ramp[0] : tone > 0.75 ? ramp[2] : ramp[1];
    if (y % 8 === 0) col = lighter(col);
    if (hash2(x, y, seed + 5) < 0.12) col = ramp[tone > 0.5 ? 1 : 0];
    if (hash2(x, y, seed + 9) > 0.97) col = darker(col);
    p.px(x, y, col);
  }
  return p;
}

// ── tiles ────────────────────────────────────────────────────────────────────────────────────────
/** Checkered ceramic tiles: `n` tiles per side on a 64 px texture, grout, bevel, chips and wear. */
export function tiles(c1: Hex, c2: Hex, n = 4): Pix {
  const cell = Math.max(4, Math.floor(64 / Math.max(1, n))), size = cell * Math.max(1, n);
  const grout = snap15(darken(mix(c1, c2, 0.5), 0.45));
  const seed = seedOf('tiles', c1, c2, n), p = new Pix(size, size);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
    const base = (tx + ty) & 1 ? c2 : c1, ramp = rampFor(base, 3), t = hash2(tx, ty, seed);
    const body = t < 0.15 ? ramp[0] : t > 0.85 ? ramp[2] : ramp[1];
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const gx = tx * cell + x, gy = ty * cell + y;
      let col = body;
      if (x === cell - 1 || y === cell - 1) col = grout;
      else if (x === 0 || y === 0) col = bayer(gx, gy) < 8 ? ramp[2] : body;
      else if (x === cell - 2 || y === cell - 2) col = bayer(gx, gy) < 6 ? ramp[0] : body;
      else if (hash2(gx, gy, seed + 3) < 0.03) col = ramp[0];
      if (col !== grout && fbm(gx / size, gy / size, 4, 4, 2, seed) < 0.3 && bayer(gx, gy) < 4) col = darker(col);
      p.px(gx, gy, col);
    }
  }
  return p;
}

export type TileKind = 'terrazzo' | 'checker' | 'sump' | 'hex';
/** The ART_BIBLE §3.3 tile kinds: terrazzo panel, black/ivory checker, sump (16 px tiles with bile stains), hex bathroom. */
export function tileKind(kind: TileKind): Pix {
  const seed = seedOf('tilekind', kind), p = new Pix(64, 64);
  if (kind === 'terrazzo') {
    p.rect(0, 0, 64, 64, P08);
    const chips = [P07, P07, P06, P06, P05, P12, P32, P23];     // mostly stone greys, a few colour chips
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (hash2(x, y, seed) < 0.18) {
        const col = chips[Math.floor(hash2(y, x, seed + 1) * chips.length)];
        p.pxw(x, y, col); if (hash2(x, y, seed + 2) < 0.5) p.pxw(x + 1, y, col);
      }
    }
    p.rect(0, 0, 64, 1, P22); p.rect(0, 0, 1, 64, P22);
  } else if (kind === 'checker') {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const cx = x >> 3, cy = y >> 3;
      let col = (cx + cy) & 1 ? P01 : P09;
      if (x % 8 === 7 || y % 8 === 7) col = P06;
      else if (fbm(x / 64, y / 64, 4, 4, 3, seed) < 0.3 && bayer(x, y) < 4) col = darker(col);
      p.px(x, y, col);
    }
  } else if (kind === 'sump') {
    for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
      const missing = hash2(tx, ty, seed + 8) < 0.08, base = hash2(tx, ty, seed) < 0.5 ? P08 : P07;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const gx = tx * 16 + x, gy = ty * 16 + y;
        let col = base;
        if (missing) col = x === 0 || y === 0 || x === 15 || y === 15 ? P02 : P05;
        else if (x === 15 || y === 15) col = P06;
        else if (hash2(tx, ty, seed + 9) < 0.3 && y >= 8 && bayer(gx, gy) < 6) col = P31;
        else if (hash2(gx, gy, seed + 4) < 0.05) col = darker(base);
        p.px(gx, gy, col);
      }
    }
  } else {
    // hex: pointy-top hexagons 8 px across on a 64×56 tile (rows of 7 px, odd rows offset by 4), P09 / P08 alternating, grout P07
    const hx = new Pix(64, 56);
    hx.rect(0, 0, 64, 56, P07);
    const A = 3.5, R = A / Math.cos(Math.PI / 6);                 // apothem and circumradius of the 7 px hexagon
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const cx = col * 8 + (row & 1 ? 4 : 0) + 4, cy = row * 7 + 3.5;
      const colr = (col + row) & 1 ? P08 : P09;
      for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - A); x <= Math.ceil(cx + A); x++) {
        const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy);
        if (dx <= A && dy <= R && (dy <= R / 2 || dx <= (R - dy) * Math.sqrt(3))) hx.pxw(x, y, hash2(x, y, seed) < 0.06 ? darker(colr) : colr);
      }
    }
    return hx;
  }
  return p;
}

// ── leather / velvet / marble / wire mesh ────────────────────────────────────────────────────────
/** 32×32 leather; `tufted` = diamond-quilt lines + buttons every 16 px; `rail` = a stitched edge row. */
export function leather(c: Hex, tufted = false, rail = false): Pix {
  const [lo, mid, hi] = rampFor(c, 3), seed = seedOf('leather', c), p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) p.px(x, y, hash2(x, y, seed) < 0.15 ? lo : mid);
  if (tufted) {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if ((x + y) % 16 === 0 || (x - y + 32) % 16 === 0) p.px(x, y, lo);
      else if ((x + y) % 16 === 1 || (x - y + 33) % 16 === 0) p.px(x, y, bayer(x, y) < 8 ? hi : mid);
    }
    for (const [bx, by] of [[0, 0], [16, 0], [0, 16], [16, 16], [8, 8], [24, 8], [8, 24], [24, 24]]) {
      p.disc(bx, by, 1.5, lo); p.px(bx - 1, by - 1, hi);
      p.disc(bx + 32, by, 1.5, lo); p.disc(bx, by + 32, 1.5, lo); p.disc(bx - 32, by, 1.5, lo); p.disc(bx, by - 32, 1.5, lo);
    }
  }
  if (rail) for (let x = 0; x < 32; x++) if (x % 4 < 2) p.px(x, 2, hi);
  return p;
}

/** 32×64 curtain velvet: vertical fold bands, 1 % sparkle. */
export function velvet(c: Hex, folds = 4): Pix {
  const ramp = rampFor(c, 4), seed = seedOf('velvet', c, folds), p = new Pix(32, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
    const v = 0.5 + 0.5 * Math.sin((x * TAU * folds) / 32 + 0.6 * Math.sin((y * TAU) / 64));
    p.px(x, y, hash2(x, y, seed) < 0.01 ? ramp[3] : rampDither(Math.min(0.99, v * 0.8), ramp.slice(0, 3), x, y));
  }
  return p;
}

/** 64×64 marble: base ivory, meandering veins with a dark core and a soft dithered shoulder. */
export function marble(base: Hex = P09, veins = 3): Pix {
  const seed = seedOf('marble', base, veins), p = new Pix(64, 64);
  const d1 = darker(base), d2 = darker(d1), d3 = darker(d2);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const warp = 4 * (fbm(x / 64, y / 64, 3, 3, 3, seed) - 0.5);
    const s = Math.abs(Math.sin(((x * 2 + y) / 64) * Math.PI * veins + warp * 2.4));
    const s2 = Math.abs(Math.sin(((x - y * 2) / 64) * Math.PI * (veins - 1) + warp * 3.1 + 1.7));
    let col = base;
    if (s < 0.035) col = d3; else if (s < 0.075) col = d2; else if (s < 0.13 && bayer(x, y) < 8) col = d1;
    else if (s2 < 0.03) col = d1;
    else if (hash2(x, y, seed + 1) < 0.03) col = lighter(base);
    p.px(x, y, col);
  }
  return p;
}

/** 16×16 diamond wire mesh on a transparent field (cut-out). */
export function mesh(c: Hex = P22, cell = 4): Pix {
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % cell === 0 || (x - y + 16) % cell === 0) p.px(x, y, c);
  return p;
}

// ── casino carpet ────────────────────────────────────────────────────────────────────────────────
export type CarpetVariant = 'atrium' | 'slots' | 'felt' | 'parlour';
interface CarpetDef { base: Hex; lattice: Hex; star: Hex; starC: Hex; pips: [Hex, Hex, Hex, Hex]; halo: [Hex, Hex] }
const CARPETS: Record<CarpetVariant, CarpetDef> = {
  atrium: { base: P12, lattice: P23, star: P24, starC: P19, pips: [P15, P19, P32, P42], halo: [P42, P35] },
  slots: { base: P40, lattice: P42, star: P38, starC: P10, pips: [P43, P20, P38, P46], halo: [P37, P37] },
  felt: { base: P28, lattice: P22, star: P09, starC: P14, pips: [P14, P19, P09, P01], halo: [P13, P13] },
  parlour: { base: P11, lattice: P21, star: P08, starC: P15, pips: [P08, P08, P08, P08], halo: [P41, P41] },
};
const STAR5 = ['..#..', '..#..', '#####', '..#..', '..#..'];
const SUIT_ORDER = ['H', 'D', 'C', 'S'] as const;

/** Resolve a free-form colour list to a carpet definition (matches a named variant by its base colour). */
function carpetDef(colors: readonly Hex[]): { def: CarpetDef; variant: CarpetVariant | null } {
  if (!colors.length) return { def: CARPETS.atrium, variant: 'atrium' };
  for (const [v, d] of Object.entries(CARPETS) as Array<[CarpetVariant, CarpetDef]>) if (d.base === colors[0] && colors.length === 1) return { def: d, variant: v };
  const base = colors[0], lattice = colors[1] ?? snap15(lighten(base, 0.45)), star = colors[2] ?? snap15(lighten(lattice, 0.4)), starC = colors[3] ?? snap15(lighten(star, 0.6));
  return { def: { base, lattice, star, starC, pips: [star, starC, lattice, snap15(mix(star, base, 0.5))], halo: [lattice, snap15(mix(lattice, base, 0.5))] }, variant: null };
}

/** 64×64 signature casino carpet: diamond lattice, four-point stars, suit pips, dotted halos, wear and burns. */
export function carpetCasino(variant: CarpetVariant, wear = 0.35): Pix {
  return paintCarpet(CARPETS[variant], variant, wear, seedOf('carpet', variant));
}
function paintCarpet(d: CarpetDef, variant: CarpetVariant | null, wear: number, seed: number): Pix {
  const p = new Pix(64, 64), rng = createRng(seed);
  p.rect(0, 0, 64, 64, d.base);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x + y) % 16 === 0 || (x - y + 64) % 16 === 0) p.px(x, y, d.lattice);
  const halo = (cx: number, cy: number, col: Hex): void => {
    for (let dy = -5; dy <= 5; dy++) {
      const dx = 5 - Math.abs(dy);
      for (const sx of dx === 0 ? [0] : [-dx, dx]) if (Math.abs(sx) % 2 === 0) p.pxw(cx + sx, cy + dy, col);
    }
  };
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const ax = 8 + 16 * i, ay = 16 * j, bx = 16 * i, by = 8 + 16 * j;
    halo(ax, ay, d.halo[0]); halo(bx, by, d.halo[1]);
    STAR5.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') p.pxw(ax - 2 + c, ay - 2 + r, d.star); });
    p.pxw(ax, ay, d.starC);
    const suit = (i + j) % 4;
    if (variant === 'parlour') {
      for (let c = -2; c <= 2; c++) for (let r = -1; r <= 1; r++) if (Math.abs(c) + Math.abs(r) <= 3 && !(Math.abs(c) === 2 && r !== 0)) p.pxw(bx + c, by + r, P08);
      p.pxw(bx, by, P01);
    } else {
      PIP5[SUIT_ORDER[suit]].forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') p.pxw(bx - 2 + c, by - 2 + r, d.pips[suit]); });
    }
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (fbm(x / 64, y / 64, 4, 4, 3, seed) < wear && bayer(x, y) < 6) { const cur = p.get(x, y); if (cur !== T) p.px(x, y, darker(cur)); }
  }
  if (variant !== 'felt') for (let i = 0; i < 3; i++) {
    const x = rng.int(2, 60), y = rng.int(2, 60);
    p.frame(x - 1, y - 1, 4, 4, P21); p.rect(x, y, 2, 2, P02);
  }
  return p;
}

export type CarpetPattern = 'diamond' | 'swirl' | 'stars' | 'teeth';
/** `carpet(pattern, colors)` of the TexGen interface: [base, lattice/ink, accent, highlight]. */
export function carpet(pattern: CarpetPattern, colors: readonly Hex[]): Pix {
  const seed = seedOf('carpet', pattern, ...colors);
  if (pattern === 'diamond') {
    const { def, variant } = carpetDef(colors);
    return paintCarpet(def, variant, 0.35, seed);
  }
  const base = colors[0] ?? P12, c1 = colors[1] ?? snap15(lighten(base, 0.4)), c2 = colors[2] ?? snap15(lighten(c1, 0.4)), c3 = colors[3] ?? snap15(darken(base, 0.5));
  const p = new Pix(64, 64), rng = createRng(seed);
  p.rect(0, 0, 64, 64, base);
  if (pattern === 'swirl') {
    // paisley-ish spirals on a staggered 32 px grid, a dot cluster between them
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const cx = 16 + i * 32 + (j & 1 ? 16 : 0), cy = 16 + j * 32;
      let px = -1, py = -1;
      for (let t = 0; t < 2.6 * TAU; t += 0.12) {
        const r = 1 + t * 0.82, x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r * 0.95);
        if (px >= 0) { const dx = x - px, dy = y - py, n = Math.max(Math.abs(dx), Math.abs(dy), 1); for (let s = 0; s <= n; s++) p.pxw(px + (dx * s) / n, py + (dy * s) / n, t > 2.1 * TAU ? c2 : c1); }
        px = x; py = y;
      }
      p.disc(cx, cy, 1.5, c2);
      for (const [dx, dy] of [[16, 16], [-16, 16], [16, -16], [-16, -16]]) { p.pxw(cx + dx, cy + dy, c3); p.pxw(cx + dx + 1, cy + dy, c3); p.pxw(cx + dx, cy + dy + 1, c3); }
    }
  } else if (pattern === 'stars') {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const cx = 8 + i * 16 + (j & 1 ? 8 : 0), cy = 8 + j * 16;
      for (let k = -3; k <= 3; k++) { p.pxw(cx + k, cy, c1); p.pxw(cx, cy + k, c1); }
      for (let k = -2; k <= 2; k++) { p.pxw(cx + k, cy + k, c2); p.pxw(cx + k, cy - k, c2); }
      p.pxw(cx, cy, c3); p.pxw(cx + 8, cy + 8, c1); p.pxw(cx + 7, cy + 8, c1); p.pxw(cx + 8, cy + 7, c1);
    }
  } else {
    // teeth: staggered rows of triangular teeth
    for (let row = 0; row < 8; row++) for (let t = 0; t < 8; t++) {
      const x0 = t * 8 + (row & 1 ? 4 : 0), y0 = row * 8, col = (row & 1) ? c1 : c2;
      for (let y = 0; y < 8; y++) { const half = 3.9 - y * 0.48; for (let x = 0; x < 8; x++) if (Math.abs(x - 3.5) <= half) p.pxw(x0 + x, y0 + y, col); }
      p.pxw(x0 + 3, y0 + 1, c3); p.pxw(x0 + 4, y0 + 1, c3);
    }
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    if (fbm(x / 64, y / 64, 4, 4, 3, seed) < 0.3 && bayer(x, y) < 6) { const cur = p.get(x, y); if (cur !== T) p.px(x, y, darker(cur)); }
  }
  for (let i = 0; i < 2; i++) { const x = rng.int(2, 60), y = rng.int(2, 60); p.rect(x, y, 2, 2, P02); }
  return p;
}

// ── wallpaper ────────────────────────────────────────────────────────────────────────────────────
export type WallpaperVariant = 'fan' | 'damask';
/** 32×64 wallpaper: art-deco fans or damask ornament, with peel and water-stain decay. */
export function wallpaper(variant: WallpaperVariant, decay = 0.4): Pix {
  const seed = seedOf('wallpaper', variant, decay), rng = createRng(seed), p = new Pix(32, 64);
  if (variant === 'fan') {
    p.rect(0, 0, 32, 64, P41);
    for (let row = 0; row < 2; row++) {
      const ox = row ? 16 : 0, oy = row * 32;
      for (const sx of [0, 32]) {
        const cx = 16 + ox - sx, cy = 30 + oy;
        for (let y = Math.floor(cy - 13); y <= cy; y++) for (let x = Math.floor(cx - 13); x <= Math.ceil(cx + 13); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d > 11 && d <= 12.4) p.px(x, y, P23);                    // arc over the top half only
        }
        for (let k = 0; k <= 6; k++) { const a = Math.PI - (k * Math.PI) / 6; p.line(cx, cy, cx + Math.cos(a) * 11, cy - Math.sin(a) * 11, P22); }
        p.px(cx, cy, P24);
      }
    }
    p.rect(0, 0, 1, 64, P42);
  } else {
    // damask: a mirrored leaf-and-spine ornament per 16×32 cell, half-dropped on the second row
    p.rect(0, 0, 32, 64, P11);
    const cell = new Pix(16, 32);
    cell.ellipse(4.5, 9.5, 3.2, 5.6, P12).ellipse(4.5, 22.5, 3.2, 5.6, P12).rect(7, 2, 1, 28, P12);
    cell.poly([[7, 1], [2, 5], [7, 4.5]], P12).poly([[7, 31], [2, 27], [7, 27.5]], P12).disc(2.5, 16, 1.3, P12).disc(6.5, 16, 1.1, P12);
    for (const [x, y] of [[3, 5], [2, 8], [3, 18], [2, 21], [4, 4], [6, 2]]) cell.px(x, y, P13);
    for (const [x, y] of [[3, 12], [5, 26]]) if (rng.chance(0.7)) cell.px(x, y, P13);
    cell.mirrorX();
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const ox = col * 16 + (row ? 8 : 0), oy = row * 32;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) { const c = cell.get(x, y); if (c !== T) p.pxw(ox + x, oy + y, c); }
    }
  }
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
    if (fbm(x / 32, y / 64, 4, 2, 3, seed) < decay * 0.5) {
      const edge = fbm((x + 1) / 32, y / 64, 4, 2, 3, seed) >= decay * 0.5 || fbm(x / 32, (y + 1) / 64, 4, 2, 3, seed) >= decay * 0.5;
      p.px(x, y, edge ? P03 : P08);
    } else if (y < 28 && bayer(x, y) < Math.round(8 * (1 - y / 28)) * decay * 1.5) {
      const cur = p.get(x, y); if (cur !== T) p.px(x, y, darker(cur));
    }
  }
  return p;
}

// ── decals (binary alpha) ────────────────────────────────────────────────────────────────────────
/** 32×32 grime overlay: soot blotches and drips on a transparent field; `amount` 0..1. */
export function grime(amount: number): Pix {
  const a = Math.max(0, Math.min(1, amount)), seed = seedOf('grime', Math.round(a * 100)), rng = createRng(seed), p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const n = fbm(x / 32, y / 32, 4, 4, 3, seed);
    const edge = Math.min(x, y, 31 - x, 31 - y) < 3 ? 0.15 : 0;
    const cov = a * (0.25 + 1.3 * n) + edge * a;
    if (cov * 16 > bayer(x, y) + 3 * hash2(x, y, seed)) p.px(x, y, cov > 0.85 ? P02 : cov > 0.55 ? P25 : P16);
  }
  const drips = Math.round(a * 4);
  for (let i = 0; i < drips; i++) { const x = rng.int(0, 31), len = rng.int(4, 6 + Math.round(a * 18)); for (let y = 0; y < len; y++) if (y < 3 || bayer(x, y) < 8) p.px(x, y, P25); }
  return p;
}

export type StainKind = 'water' | 'soot' | 'bile';
/** 64×64 blotchy decal (dithered cut-out). */
export function stain(kind: StainKind, seed0 = 1): Pix {
  const seed = seedOf('stain', kind, seed0), p = new Pix(64, 64);
  const [c0, c1] = kind === 'water' ? [P05, P04] : kind === 'soot' ? [P03, P01] : [P31, P32];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = Math.hypot(x - 32, y - 32) / 32;
    const n = fbm(x / 64, y / 64, 4, 4, 3, seed) - d * 0.8 + 0.35;
    if (n > 0.36 && n * 16 > bayer(x, y) + 4) p.px(x, y, n > 0.6 ? c1 : c0);
  }
  return p;
}
/** 64×64 branching crack decal (glass / plaster). */
export function crack(seed0 = 1): Pix {
  const seed = seedOf('crack', seed0), rng = createRng(seed), p = new Pix(64, 64);
  const branch = (x: number, y: number, ang: number, len: number, depth: number): void => {
    for (let s = 0; s < len; s++) {
      ang += rng.float(-0.35, 0.35);
      x += Math.cos(ang); y += Math.sin(ang);
      p.px(x, y, P01); p.px(x + 1, y + 1, P07);
      if (depth < 2 && rng.chance(0.07)) branch(x, y, ang + rng.float(0.5, 1.2) * (rng.chance(0.5) ? 1 : -1), Math.floor(len * 0.5), depth + 1);
    }
  };
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) branch(32, 32, (i / n) * TAU + rng.float(-0.3, 0.3), rng.int(18, 30), 0);
  return p;
}

/** 32×32 glass streak overlay (additive): two diagonal highlights + optional grime specks. */
export function glassStreak(grimeAmount = 0): Pix {
  const p = new Pix(32, 32), rng = createRng(seedOf('glass', Math.round(grimeAmount * 10)));
  for (let t = 0; t <= 31; t++) p.rect(Math.round(4 + (t * 16) / 31) - 1, 31 - t, 3, 1, P10);
  p.line(14, 31, 30, 0, P39);
  const specks = Math.round(grimeAmount * 0.1 * 1024);
  for (let i = 0; i < specks; i++) p.px(rng.int(0, 31), rng.int(0, 31), P07);
  return p;
}
/** 32×32 radial halo for additive glow planes: white, dithered in `levels` bands. */
export function glow(r = 15, levels = 4): Pix {
  const p = new Pix(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16), v = 1 - d / r;
    if (v <= 0) continue;
    const band = Math.min(levels, Math.ceil(v * levels));
    if (bayer(x, y) < (band / levels) * 16) p.px(x, y, P10);
  }
  return p;
}
export type EnvKind = 'chrome' | 'gold' | 'glass';
/** 32×32 matcap disc for fake reflections. */
export function envSphere(kind: EnvKind): Pix {
  const p = new Pix(32, 32);
  if (kind === 'glass') {
    p.ring(16, 16, 13, 15, P39); p.disc(11, 10, 1.5, P10); return p;
  }
  const hi = kind === 'chrome' ? [P46, P10] : [P24, P24], mid = kind === 'chrome' ? P04 : P21, lo = kind === 'chrome' ? [P45, P02] : [P23, P21];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
    if (d > 15) continue;
    const horizon = 16 - 3 * Math.sin(((x - 16) / 16) * Math.PI);
    if (Math.abs(y + 0.5 - horizon) < 1.2) { p.px(x, y, mid); continue; }
    if (y + 0.5 < horizon) {
      const t = (horizon - y - 0.5) / horizon;
      p.px(x, y, rampDither(t, [hi[0], hi[1]], x, y));
    } else {
      const t = (y + 0.5 - horizon) / (32 - horizon);
      p.px(x, y, rampDither(1 - t, [lo[1], lo[0]], x, y));
    }
  }
  return p;
}

// ── simple generators ────────────────────────────────────────────────────────────────────────────
/** Flat colour with optional per-pixel brightness jitter (`amount` 0..1), snapped to the 15-bit grid. */
export function noise(c: Hex, size = 32, amount = 0.12, seed = 1): Pix {
  const p = new Pix(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = (hash2(x, y, seed) - 0.5) * 2 * amount;
    p.px(x, y, amount === 0 ? c : snap15(v > 0 ? lighten(c, v) : darken(c, -v)));
  }
  return p;
}
export function stripes(colors: readonly Hex[], dir: 'h' | 'v' | 'd' = 'h'): Pix {
  const n = Math.max(1, colors.length), p = new Pix(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const t = dir === 'h' ? y : dir === 'v' ? x : (x + y) % 16;
    p.px(x, y, colors[Math.min(n - 1, Math.floor((t * n) / 16))] ?? P09);
  }
  return p;
}
export function checker(c1: Hex, c2: Hex, n = 4): Pix {
  const cell = Math.max(1, Math.round(32 / Math.max(1, n))), size = cell * Math.max(1, n), p = new Pix(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) p.px(x, y, (Math.floor(x / cell) + Math.floor(y / cell)) & 1 ? c2 : c1);
  return p;
}
/** Gradient strip: 1×32 for 'h' / 'v' (clamped), 32×32 for 'radial'. Stops are [position 0..1, colour]. */
export function gradient(stops: ReadonlyArray<readonly [number, Hex]>, dir: 'h' | 'v' | 'radial' = 'v'): Pix {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const at = (t: number): Hex => {
    if (!sorted.length) return P09;
    if (t <= sorted[0][0]) return sorted[0][1];
    for (let i = 1; i < sorted.length; i++) if (t <= sorted[i][0]) { const [t0, c0] = sorted[i - 1], [t1, c1] = sorted[i]; return mix(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0)); }
    return sorted[sorted.length - 1][1];
  };
  if (dir === 'radial') {
    const p = new Pix(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) p.px(x, y, at(Math.min(1, Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16)));
    return p;
  }
  const p = dir === 'h' ? new Pix(32, 1) : new Pix(1, 32);
  for (let i = 0; i < 32; i++) { const c = at(i / 31); if (dir === 'h') p.px(i, 0, c); else p.px(0, i, c); }
  return p;
}
