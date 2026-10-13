/**
 * FX sprite atlas (CORE-RENDER): 8×8 cells of 16×16 px drawn procedurally on a canvas (coins, smoke flip-book,
 * glow, sparkle stars, streaks, motes, drips, ripples, decals). One nearest-filtered texture serves every particle
 * emitter, so the whole FX layer samples a single 128×128 image (ART_BIBLE §9: PSX-friendly pixel sprites).
 * Colours follow the master palette (§2.1); sprites that get tinted at runtime are drawn white/grey.
 */
import * as THREE from 'three';
import { createRng } from '../rng';

export const ATLAS_N = 8;
const CELL = 16;

/** Atlas cell indices (row-major). */
export const Cell = {
  coinFront: 0, coinBack: 1,
  puff0: 2, puff1: 3, puff2: 4, puff3: 5,
  glow: 6, star0: 7, star1: 8, star2: 9,
  streak: 10, mote: 11, drip: 12, ring: 13,
  scorch: 14, stain: 15, crack: 16, hand: 17, solid: 18, solidBack: 19,
} as const;

let atlas: THREE.CanvasTexture | null = null;

type G = CanvasRenderingContext2D;

/** Draw one pixel; `a` 0..1. Coordinates are cell-local. */
function px(g: G, ox: number, oy: number, x: number, y: number, rgb: string, a = 1): void {
  if (x < 0 || y < 0 || x >= CELL || y >= CELL || a <= 0) return;
  g.globalAlpha = a;
  g.fillStyle = rgb;
  g.fillRect(ox + x, oy + y, 1, 1);
  g.globalAlpha = 1;
}

const lerpHex = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | (ab + (bb - ab) * t);
};
const css = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

function drawCell(g: G, cell: number, draw: (put: (x: number, y: number, c: number, a?: number) => void) => void): void {
  const ox = (cell % ATLAS_N) * CELL, oy = Math.floor(cell / ATLAS_N) * CELL;
  draw((x, y, c, a = 1) => px(g, ox, oy, x | 0, y | 0, css(c), a));
}

function disc(put: (x: number, y: number, c: number, a?: number) => void, r: number, fn: (d: number, x: number, y: number) => [number, number] | null): void {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = x + 0.5 - CELL / 2, dy = y + 0.5 - CELL / 2;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d > 1) continue;
      const out = fn(d, x, y);
      if (out) put(x, y, out[0], out[1]);
    }
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function build(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_N * CELL;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const rng = createRng(0xc01a5);

  // coin (front: ringed gold with a brass slot mark; back: darker, dotted rim)
  drawCell(g, Cell.coinFront, (put) => disc(put, 7.4, (d, x, y) => {
    if (d > 0.86) return [0x8c6b29, 1];
    if (d > 0.7) return [0xefd67b, 1];
    if (Math.abs(x - 7.5) < 1 && y > 4 && y < 12) return [0x8c6b29, 1];
    if (x < 8 && y < 8 && d > 0.45) return [0xf7efde, 1];
    return [0xc59c42, 1];
  }));
  drawCell(g, Cell.coinBack, (put) => disc(put, 7.4, (d, x, y) => {
    if (d > 0.86) return [0x4a3a19, 1];
    if (d > 0.7) return (x + y) % 2 ? [0x8c6b29, 1] : [0xc59c42, 1];
    if (d < 0.25) return [0x4a3a19, 1];
    return [0xad8a36, 1];
  }));

  // smoke flip-book: four noisy dithered blobs (alpha in 4 steps), grey ramp
  for (let f = 0; f < 4; f++) {
    const seed = rng.next() * 100;
    drawCell(g, Cell.puff0 + f, (put) => disc(put, 7.6, (d, x, y) => {
      const n = Math.sin((x + seed) * 1.7) * Math.cos((y - seed) * 1.3) * 0.5 + 0.5 + (rng.next() - 0.5) * 0.35;
      const dens = (1 - d) * 1.25 + (n - 0.5) * 0.5;
      const b = BAYER4[(y & 3) * 4 + (x & 3)] / 16;
      if (dens < 0.12 + b * 0.35) return null;
      const lvl = Math.min(3, Math.floor(dens * 4));
      return [lerpHex(0x7b736b, 0xd6dee6, dens * 0.8), [0.35, 0.55, 0.8, 1][lvl]];
    }));
  }

  // glow: stepped radial falloff (no smooth gradient: reads as PSX banding)
  drawCell(g, Cell.glow, (put) => disc(put, 7.9, (d) =>
    d < 0.18 ? [0xffffff, 1] : d < 0.36 ? [0xffffff, 0.62] : d < 0.55 ? [0xffffff, 0.36] : d < 0.76 ? [0xffffff, 0.17] : [0xffffff, 0.07]));

  // sparkle star flip-book (3, 5, 7 px arms)
  [3, 5, 7].forEach((arm, i) => drawCell(g, Cell.star0 + i, (put) => {
    put(7, 7, 0xffffff); put(8, 7, 0xffffff); put(7, 8, 0xffffff); put(8, 8, 0xffffff);
    for (let k = 1; k <= arm; k++) {
      const a = 1 - (k - 1) / (arm + 1);
      for (const y of [7, 8]) { put(7 - k, y, 0xf7efde, a); put(8 + k, y, 0xf7efde, a); }
      for (const x of [7, 8]) { put(x, 7 - k, 0xf7efde, a); put(x, 8 + k, 0xf7efde, a); }
    }
    if (arm >= 5) for (const [dx, dy] of [[-2, -2], [3, -2], [-2, 3], [3, 3]] as const) put(7 + dx, 7 + dy, 0xf7efde, 0.5);
  }));

  // spark streak: bright head at the top (v = 1 = direction of travel), tail fades down
  drawCell(g, Cell.streak, (put) => {
    for (let y = 0; y < CELL; y++) {
      const a = Math.pow(1 - y / CELL, 1.4);
      put(7, y, y < 3 ? 0xffffff : 0xf7efde, a);
      put(8, y, y < 3 ? 0xffffff : 0xf7efde, a);
      put(6, y, 0xf7efde, a * (y < 6 ? 0.75 : 0.4)); put(9, y, 0xf7efde, a * (y < 6 ? 0.75 : 0.4));
    }
  });

  // mote: tiny soft dot
  drawCell(g, Cell.mote, (put) => {
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]] as const) put(x, y, 0xffffff, 1);
    for (const [x, y] of [[6, 7], [6, 8], [9, 7], [9, 8], [7, 6], [8, 6], [7, 9], [8, 9]] as const) put(x, y, 0xffffff, 0.35);
  });

  // drip: teardrop with the heavy head at the TOP of the cell (= front of travel, like the streak)
  drawCell(g, Cell.drip, (put) => {
    for (let y = 0; y < CELL; y++) {
      const t = 1 - y / (CELL - 1);
      const w = t < 0.35 ? 0 : t < 0.7 ? 0.5 : 1.2;
      put(7, y, 0xffffff, 0.25 + t * 0.75); put(8, y, 0xffffff, 0.25 + t * 0.75);
      if (w > 1) { put(6, y, 0xffffff, 0.8); put(9, y, 0xffffff, 0.8); }
    }
  });

  // ripple ring
  drawCell(g, Cell.ring, (put) => {
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 6.2 && d < 7.6) put(x, y, 0xffffff, d < 7 ? 0.9 : 0.5);
      else if (d > 4.4 && d <= 6.2) put(x, y, 0xffffff, 0.18);
    }
  });

  // decals (white = tinted at runtime): scorch, stain, crack, hand
  drawCell(g, Cell.scorch, (put) => disc(put, 7.8, (d, x, y) => {
    const n = rng.next();
    const edge = 0.55 + n * 0.45;
    if (d > edge) return null;
    return [d < 0.5 ? 0x101019 : 0x3a3a42, d < 0.5 ? 0.95 : (BAYER4[(y & 3) * 4 + (x & 3)] / 16 > d - 0.35 ? 0.8 : 0.0)];
  }));
  drawCell(g, Cell.stain, (put) => {
    const blobs: Array<[number, number, number]> = [[8, 8, 4.6], [4, 5, 2], [12, 6, 2.2], [11, 12, 2], [5, 12, 1.6], [13, 3, 1]];
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      let best = 99;
      for (const [bx, by, br] of blobs) best = Math.min(best, Math.hypot(x + 0.5 - bx, y + 0.5 - by) - br);
      if (best < 0) put(x, y, 0xffffff, best < -1.5 ? 0.95 : 0.75);
    }
  });
  drawCell(g, Cell.crack, (put) => {
    const arms = 6;
    for (let a = 0; a < arms; a++) {
      let x = 8, y = 8, ang = (a / arms) * Math.PI * 2 + rng.next() * 0.5;
      const len = 5 + rng.int(0, 3);
      for (let s = 0; s < len; s++) {
        put(x, y, 0x101019, 0.95 - s * 0.08);
        ang += (rng.next() - 0.5) * 0.9;
        x += Math.cos(ang) * 1.1; y += Math.sin(ang) * 1.1;
      }
    }
    put(8, 8, 0x101019); put(7, 8, 0x101019); put(8, 7, 0x101019);
  });
  drawCell(g, Cell.hand, (put) => {
    for (let y = 8; y < 14; y++) for (let x = 5; x < 11; x++) put(x, y, 0xffffff, 0.9);
    const fingers: Array<[number, number]> = [[4, 2], [6, 0], [8, 0], [10, 1], [12, 6]];
    fingers.forEach(([fx, fy], i) => {
      const x0 = i === 4 ? 11 : 5 + i * 1.5;
      for (let y = fy + 1; y < 8; y++) put(i === 4 ? 11 + (y - 6) * 0.6 : x0, y, 0xffffff, 0.9);
      put(fx, fy + 1, 0xffffff, 0.9);
    });
  });

  // confetti: front is flat white (tinted per piece); back (cell 19, sampled for gl_FrontFacing == false) is the
  // reverse of the card: a 1 px dim rim and a Bayer-dithered grey, so a tumbling piece never reads as one face.
  drawCell(g, Cell.solid, (put) => { for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) put(x, y, 0xffffff); });
  drawCell(g, Cell.solidBack, (put) => {
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const rim = x === 0 || y === 0 || x === CELL - 1 || y === CELL - 1;
      const dither = BAYER4[(y & 3) * 4 + (x & 3)] / 16 < 0.5;
      put(x, y, rim ? 0xa8a8b0 : dither ? 0xd2d2da : 0xffffff);
    }
  });

  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 1;
  t.userData.shared = true;
  t.needsUpdate = true;
  return t;
}

/** The shared FX atlas (built on first use). */
export function fxAtlas(): THREE.CanvasTexture {
  if (!atlas) atlas = build();
  return atlas;
}
