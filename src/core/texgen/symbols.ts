/**
 * ORIGINAL slot symbol set (ART_BIBLE §3.6 + catalogue symbols of MACHINES_machines). Owner: CORE-TEXGEN.
 *
 * Each painter draws a 32×32 `Pix` (transparent background; the reel strip adds the cell background listed in
 * `bg`) and ends with the house finish: 1 px P01 outline + a dithered P02 drop shadow. Painters follow the
 * art-bible recipes literally where one exists (coordinates, palette indices) and the same style elsewhere.
 * Forbidden: four-leaf clover, treasure chest, any CloverPit glyph.
 */
import type { Hex } from '../types';
import { createRng } from '../rng';
import { Pix, T } from './pixel';
import { microPix, px5Pix, microWidth } from './font';
import {
  P01, P02, P03, P04, P05, P07, P08, P09, P10, P12, P13, P14, P15, P16, P17, P18, P19, P20, P21, P22, P23, P24, P26, P27,
  P29, P30, P31, P32, P34, P36, P37, P38, P39, P40, P41, P42, P43, P44, P45, P46, P47,
} from './palette';

export interface SymbolDef {
  /** Native painter resolution (32 for slot symbols, 16 for icons). */
  size: 16 | 32;
  /** Paint onto a fresh transparent `size`×`size` Pix. */
  paint(p: Pix): void;
  /** Reel-strip cell background painter (default: flat P09). */
  bg?(p: Pix): void;
}

const fin = (p: Pix): void => { p.outline(P01).shadow(1, 1, P02, 8); };
const flat = (c: Hex) => (p: Pix): void => { p.rect(0, 0, p.w, p.h, c); };
const plus = (p: Pix, x: number, y: number, c: Hex): void => { p.px(x, y, c).px(x - 1, y, c).px(x + 1, y, c).px(x, y - 1, c).px(x, y + 1, c); };
/** Recolour `from` pixels where `test` holds. */
const recolor = (p: Pix, from: Hex, to: Hex, test: (x: number, y: number) => boolean): void => { p.map((x, y, c) => (c === from && test(x, y) ? to : undefined)); };
/** `n` seeded specks on pixels of colour `on`. */
function speck(p: Pix, on: Hex, to: Hex, n: number, seed: number): void {
  const rng = createRng(seed), pts: Array<[number, number]> = [];
  p.map((x, y, c) => { if (c === on) pts.push([x, y]); return undefined; });
  for (let i = 0; i < n && pts.length; i++) { const [x, y] = pts.splice(rng.int(0, pts.length - 1), 1)[0]; p.px(x, y, to); }
}
const mirrorPts = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> => pts.map(([x, y]) => [32 - x, y] as [number, number]);
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
const star = (cx: number, cy: number, ro: number, ri: number, n = 5, rot = -Math.PI / 2): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) out.push(polar(cx, cy, i & 1 ? ri : ro, rot + (i * Math.PI) / n));
  return out;
};
/** Ring r0..r1 around (cx, cy), painted only where `keep(x, y)` holds. */
function sector(p: Pix, cx: number, cy: number, r0: number, r1: number, c: Hex, keep: (x: number, y: number) => boolean): void {
  p.map((x, y) => { const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2; return d > r0 * r0 && d <= r1 * r1 && keep(x, y) ? c : undefined; });
}
const leaf = (p: Pix, x: number, y: number, c: Hex, hi: Hex): void => { p.poly([[x, y], [x + 7, y - 3], [x + 9, y + 1], [x + 3, y + 3]], c); p.line(x + 1, y, x + 7, y - 1, hi); };

// ── ART_BIBLE §3.6 set ───────────────────────────────────────────────────────────────────────────
function paintTooth(p: Pix, base: Hex, shade: Hex, hi: Hex): void {
  p.disc(11, 7, 4, base).disc(21, 7, 4, base).rect(7, 7, 19, 9, base);
  p.rect(10, 16, 5, 9, base).rect(18, 16, 5, 9, base).disc(12.5, 25, 2.5, base).disc(20.5, 25, 2.5, base);
  p.rect(15, 18, 3, 10, T);
  recolor(p, base, shade, (x, y) => (y < 16 && x >= 20) || (y >= 16 && (x === 13 || x === 14 || x === 21 || x === 22)));
  p.rect(10, 8, 2, 4, hi).px(12, 7, hi);
  plus(p, 25, 4, P10);
  fin(p);
}

const SYMBOLS: Record<string, SymbolDef> = {
  tooth: { size: 32, paint: (p) => paintTooth(p, P09, P08, P10) },
  tooth_gold: { size: 32, paint: (p) => paintTooth(p, P23, P22, P24) },

  eye: {
    size: 32,
    paint(p) {
      p.disc(16, 16, 11, P09);
      recolor(p, P09, P08, (x, y) => x + y > 32 && (x + 0.5 - 16) ** 2 + (y + 0.5 - 16) ** 2 > 9.5 ** 2);
      p.line(6, 12, 9, 13, P14).line(7, 21, 10, 19, P14).line(25, 10, 22, 12, P14).line(26, 20, 23, 18, P14);
      p.disc(16, 16, 5.5, P37).ring(16, 16, 4, 5.5, P36);
      p.px(13, 13, P38).px(14, 13, P38).px(13, 14, P38);
      p.disc(16, 16, 2.5, P01).rect(13, 12, 2, 2, P10);
      fin(p);
    },
  },

  key: {
    size: 32,
    paint(p) {
      p.ring(8, 16, 3.5, 7, P18).rect(14, 15, 15, 3, P18).rect(22, 18, 3, 5, P18).rect(26, 18, 3, 7, P18);
      recolor(p, P18, P17, (x, y) => (y === 17 && x >= 14) || (x < 14 && y >= 16));
      recolor(p, P18, P19, (x, y) => y === 15 && x >= 15 && x <= 26);
      p.px(5, 11, P19).px(6, 10, P19).px(7, 10, P19);
      speck(p, P18, P16, 6, 31);
      fin(p);
    },
  },

  horseshoe: {
    size: 32,
    paint(p) {
      p.ring(16, 14, 7, 12, P45).rect(0, 15, 32, 17, T);
      p.rect(4, 14, 5, 14, P45).rect(23, 14, 5, 14, P45);
      recolor(p, P45, P44, (x, y) => x + y > 36);
      recolor(p, P45, P46, (x, y) => { const d = (x + 0.5 - 16) ** 2 + (y + 0.5 - 14) ** 2; return d > 10.3 ** 2 && d <= 11.4 ** 2 && x < 16 && y <= 14; });
      for (const [x, y] of [[6, 18], [6, 11], [10, 6], [21, 6], [25, 11], [25, 18]]) p.rect(x, y, 1, 2, P01);
      p.rect(4, 27, 5, 2, P44).rect(23, 27, 5, 2, P44);
      fin(p);
    },
  },

  moth: {
    size: 32,
    paint(p) {
      const fw: Array<[number, number]> = [[14, 10], [2, 5], [1, 14], [13, 19]], hw: Array<[number, number]> = [[14, 19], [4, 20], [6, 28], [14, 24]];
      p.poly(fw, P26).poly(mirrorPts(fw), P26);
      p.line(2, 5, 1, 14, P07).line(30, 5, 31, 14, P07);
      p.poly(hw, P19).poly(mirrorPts(hw), P19);
      recolor(p, P19, P01, (_x, y) => y === 22 || y === 25);
      p.disc(7, 11, 1.5, P09).px(7, 11, P01).disc(25, 11, 1.5, P09).px(25, 11, P01);
      p.ellipse(16, 17, 2, 8, P03).disc(16, 9, 2, P03);
      p.line(15, 7, 11, 2, P02).line(17, 7, 21, 2, P02).px(11, 2, P08).px(21, 2, P08);
      p.rect(15, 11, 3, 3, P09).px(15, 12, P01).px(17, 12, P01);
      fin(p);
    },
  },

  crown: {
    size: 32,
    paint(p) {
      p.rect(5, 20, 23, 7, P23).rect(5, 26, 23, 1, P22);
      for (const t of [[[5, 20], [9, 20], [6, 8]], [[9, 20], [14, 20], [11, 13]], [[13, 20], [19, 20], [16, 5]], [[18, 20], [23, 20], [21, 13]], [[23, 20], [27, 20], [26, 8]]] as Array<Array<[number, number]>>) p.poly(t, P23);
      for (const [x, y] of [[6, 8], [11, 13], [16, 5], [21, 13], [26, 8]]) p.disc(x, y, 1.5, P24);
      p.disc(10, 23, 2, P14).disc(16, 23, 2, P37).disc(22, 23, 2, P30);
      p.px(8, 24, P21).px(25, 21, P21).px(26, 22, P21);
      fin(p);
    },
  },

  bullion: {
    size: 32,
    paint(p) {
      p.poly([[8, 10], [24, 10], [28, 16], [4, 16]], P24).rect(4, 16, 25, 10, P23).rect(4, 25, 25, 1, P21);
      p.rect(4, 17, 1, 8, P22).rect(28, 17, 1, 8, P22);
      microPix(p, '999', 11, 18, P22, 1);
      p.line(6, 17, 10, 17, P10);
      plus(p, 26, 8, P10);
      fin(p);
    },
  },

  heart: {
    size: 32,
    paint(p) {
      p.disc(12, 14, 6, P13).disc(20, 13, 7, P13).poly([[6, 16], [27, 16], [17, 29]], P13);
      recolor(p, P13, P14, (x, y) => x + y < 26);
      p.map((x, y, c) => (c === P14 && (!p.opaque(x - 1, y) || !p.opaque(x, y - 1)) ? P15 : undefined));
      recolor(p, P13, P12, (x, y) => x + y > 40);
      p.line(14, 15, 17, 22, P12).line(17, 22, 16, 26, P12);
      sector(p, 18, 7, 2, 4, P15, (_x, y) => y <= 7);
      p.rect(20, 7, 2, 4, P15).rect(11, 3, 3, 6, P36);
      fin(p);
    },
  },

  jackid: {
    size: 32,
    paint(p) {
      p.disc(16, 16, 14, P23);
      p.ring(16, 16, 12, 14, P22);
      recolor(p, P22, P24, (x, y) => x + y < 32);
      p.disc(16, 16, 12, P21);
      p.disc(16, 17, 8, P19).disc(16, 17, 7, P01);
      p.line(13, 11, 13, 23, P22).line(19, 11, 19, 23, P22);
      for (const y of [13, 16, 19, 22]) p.rect(13, y, 7, 1, P22);
      for (let i = 0; i < 8; i++) p.px(16 + Math.cos((i * Math.PI) / 4) * 13, 16 + Math.sin((i * Math.PI) / 4) * 13, P24);
      fin(p);
    },
    bg: (p) => { p.rect(0, 0, 32, 32, P09); p.ditherFill(0, 0, 32, 32, undefined, P20, 3); },
  },

  grin: {
    size: 32,
    paint(p) {
      p.ellipse(16, 15, 10, 13, P09);
      recolor(p, P09, P08, (x, y) => x + y > 34);
      p.line(19, 3, 17, 8, P02).line(17, 8, 20, 12, P02).line(20, 12, 18, 17, P02);
      p.ellipse(11, 13, 2.5, 1.5, P01).ellipse(21, 13, 2.5, 1.5, P01).px(11, 13, P47).px(21, 13, P47);
      for (let x = 8; x <= 24; x++) p.px(x, 21 + Math.round(0.04 * (x - 16) ** 2), P01);
      for (let x = 9; x <= 23; x += 2) { const y = 21 + Math.round(0.04 * (x - 16) ** 2); p.rect(x, y - 1, 1, 3, P01); }
      p.rect(7, 18, 2, 1, P15).rect(23, 18, 2, 1, P15);
      p.rect(11, 15, 1, 5, P47).rect(21, 15, 1, 4, P47);
      fin(p);
    },
    bg: flat(P40),
  },

  glove: {
    size: 32,
    paint(p) {
      p.rect(10, 12, 12, 12, P09).rect(10, 4, 3, 8, P09).rect(13, 2, 3, 10, P09).rect(16, 3, 3, 9, P09).rect(19, 6, 3, 6, P09);
      p.poly([[10, 16], [5, 12], [4, 15], [10, 21]], P09);
      for (const x of [13, 16, 19]) p.line(x, 5, x, 11, P08);
      for (const x of [10, 13, 16, 19]) p.px(x, 12, P08);
      p.rect(9, 24, 14, 5, P38).px(16, 26, P01);
      fin(p);
    },
    bg: flat(P37),
  },

  candle: {
    size: 32,
    paint: (p) => paintCandle(p, 0),
  },
  candle_b: { size: 32, paint: (p) => paintCandle(p, -1) },

  ring: {
    size: 32,
    paint(p) {
      p.ring(16, 20, 6, 9, P23);
      recolor(p, P23, P24, (x, y) => x + y < 36);
      p.map((x, y, c) => (c === P23 && x + y > 40 ? P22 : undefined));
      p.rect(14, 9, 4, 3, P22).px(13, 10, P23).px(18, 10, P23);
      p.poly([[16, 2], [21, 7], [16, 12], [11, 7]], P14);
      recolor(p, P14, P13, (x, y) => x + y > 22 && y > 6 && x > 15);
      p.px(14, 5, P15).px(15, 4, P15);
      plus(p, 24, 4, P10);
      fin(p);
    },
  },

  sun: {
    size: 32,
    paint(p) {
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        p.poly([polar(16, 16, 9, a - Math.PI / 12), polar(16, 16, 15.4, a), polar(16, 16, 9, a + Math.PI / 12)], k & 1 ? P20 : P19);
      }
      p.disc(16, 16, 8, P20).ring(16, 16, 6.5, 8, P19);
      p.rect(12, 14, 2, 2, P01).rect(18, 14, 2, 2, P01);
      for (let x = 12; x <= 20; x++) p.px(x, 19 + Math.round(0.12 * (x - 16) ** 2), P01);
      p.px(11, 18, P15).px(21, 18, P15);
      fin(p);
    },
    bg: (p) => { p.rect(0, 0, 32, 32, P09); p.ditherFill(0, 0, 32, 32, undefined, P19, 4); },
  },

  ghost: {
    size: 32,
    paint(p) {
      p.disc(16, 12, 9, P39).rect(7, 12, 18, 13, P39);
      recolor(p, P39, P36, (x) => x >= 22);
      for (const x of [10, 16, 22]) p.disc(x, 26, 2.5, T);
      p.ellipse(12, 12, 1.5, 2.5, P01).ellipse(20, 12, 1.5, 2.5, P01).ellipse(16, 18, 1.5, 2, P01);
      fin(p);
    },
    bg: flat(P37),
  },

  // ── fruits & classics ────────────────────────────────────────────────────────────────────────
  cherry: {
    size: 32,
    paint(p) {
      p.line(10, 17, 14, 8, P26).line(14, 8, 17, 4, P26).line(22, 15, 19, 8, P26).line(19, 8, 17, 4, P26);
      leaf(p, 17, 5, P30, P32);
      for (const [cx, cy] of [[10, 23], [22, 21]]) {
        p.disc(cx, cy, 6.5, P14);
        recolor(p, P14, P13, (x, y) => x - cx + (y - cy) > 4);
        p.rect(cx - 3, cy - 3, 2, 2, P15).px(cx - 3, cy - 4, P15);
        p.px(cx, cy - 6, P12);
      }
      fin(p);
    },
  },

  plum: {
    size: 32,
    paint(p) {
      p.disc(16, 18, 10, P42);
      recolor(p, P42, P41, (x, y) => x + y > 38);
      sector(p, 16, 18, 7.5, 9, P43, (x, y) => x < 15 && y < 17);
      p.line(21, 10, 22, 18, P41).line(22, 18, 20, 25, P41);
      p.ditherFill(8, 10, 5, 4, undefined, P43, 6);
      p.line(16, 8, 17, 4, P26);
      leaf(p, 17, 6, P30, P32);
      fin(p);
    },
  },

  orange: {
    size: 32,
    paint(p) {
      p.disc(16, 18, 11, P19);
      recolor(p, P19, P18, (x, y) => x + y > 37);
      sector(p, 16, 18, 8.5, 9.8, P20, (x, y) => x + y < 28);
      p.ditherFill(6, 10, 20, 18, undefined, P18, 2);
      p.px(16, 7, P26).px(15, 7, P26);
      leaf(p, 17, 6, P30, P32);
      fin(p);
    },
  },

  melon: {
    size: 32,
    paint(p) {
      p.disc(16, 8, 14, P30).rect(0, 0, 32, 8, T);
      p.disc(16, 8, 12, P31).disc(16, 8, 11, P09).disc(16, 8, 10, P14);
      p.rect(0, 0, 32, 8, T);
      for (const [x, y] of [[11, 14], [16, 17], [21, 14], [13, 20], [19, 20]]) p.rect(x, y, 1, 2, P01);
      p.ditherFill(8, 9, 6, 5, undefined, P15, 6);
      p.line(5, 9, 27, 9, P10);
      for (const x of [9, 14, 19, 24]) p.px(x, 21 + (x & 1), P29);
      fin(p);
    },
  },

  pear: {
    size: 32,
    paint(p) {
      p.disc(16, 21, 9, P31).disc(16, 11, 6, P31).poly([[11, 14], [21, 14], [24, 20], [8, 20]], P31);
      recolor(p, P31, P30, (x, y) => x + y > 38);
      p.rect(10, 17, 2, 3, P20).px(13, 8, P20).px(12, 9, P20);
      p.line(16, 5, 17, 2, P26);
      leaf(p, 17, 4, P30, P32);
      fin(p);
    },
  },

  strawberry: {
    size: 32,
    paint(p) {
      p.poly([[5, 10], [27, 10], [23, 22], [16, 30], [9, 22]], P14).disc(9, 12, 4, P14).disc(23, 12, 4, P14);
      recolor(p, P14, P13, (x, y) => x - 16 + (y - 16) > 8);
      p.rect(8, 11, 2, 3, P15);
      for (let y = 13; y < 28; y += 4) for (let x = 8 + ((y >> 2) & 1) * 2; x < 25; x += 4) if (p.get(x, y) !== T) p.px(x, y, P20);
      p.poly(star(16, 9, 8, 3.2, 5), P30);
      p.rect(15, 3, 2, 4, P27);
      fin(p);
    },
  },

  grape: {
    size: 32,
    paint(p) {
      const pts: Array<[number, number]> = [[9, 11], [16, 10], [23, 11], [12.5, 17], [19.5, 17], [16, 23.5]];
      for (const [x, y] of pts) p.disc(x, y, 4.2, P42);
      for (const [x, y] of pts) {
        recolor(p, P42, P41, (px, py) => px - x + (py - y) > 3 && Math.hypot(px + 0.5 - x, py + 0.5 - y) <= 4.2);
        p.px(x - 2, y - 2, P43).px(x - 1, y - 2, P43);
      }
      p.line(16, 5, 16, 7, P26);
      leaf(p, 17, 6, P30, P32);
      fin(p);
    },
  },

  bell: {
    size: 32,
    paint(p) {
      p.disc(16, 14, 9, P23).rect(7, 14, 19, 8, P23).poly([[7, 22], [25, 22], [29, 27], [3, 27]], P23);
      recolor(p, P23, P22, (x, y) => x > 19 && y > 8);
      recolor(p, P23, P24, (x, y) => x >= 9 && x <= 11 && y >= 8 && y <= 21);
      p.rect(3, 26, 27, 1, P21).rect(4, 22, 21, 1, P22);
      p.disc(16, 29, 2.5, P22).px(15, 28, P24);
      p.ring(16, 4, 1.4, 3, P22).rect(15, 5, 3, 2, P22);
      fin(p);
    },
  },

  seven: {
    size: 32,
    paint(p) {
      p.rect(6, 5, 21, 6, P14).poly([[27, 10], [20, 10], [10, 28], [17, 28]], P14);
      p.rect(6, 5, 21, 1, P15).line(20, 11, 11, 27, P15);
      p.rect(25, 6, 2, 5, P13).line(18, 28, 26, 11, P13);
      p.outline(P10);
      fin(p);
    },
  },

  diamond: {
    size: 32,
    paint(p) {
      p.poly([[9, 8], [23, 8], [28, 14], [16, 28], [4, 14]], P38);
      p.poly([[10, 8], [22, 8], [21, 14], [11, 14]], P39);
      p.poly([[4, 14], [9, 8], [11, 14]], P38).poly([[23, 8], [28, 14], [21, 14]], P36);
      p.poly([[11, 14], [16, 14], [16, 27]], P38).poly([[16, 14], [21, 14], [16, 27]], P36);
      p.line(4, 14, 28, 14, P10).line(11, 14, 16, 27, P39);
      plus(p, 24, 5, P10);
      fin(p);
    },
  },

  star: {
    size: 32,
    paint(p) {
      p.poly(star(16, 17, 14.5, 6.2), P14);
      recolor(p, P14, P15, (x, y) => x + y < 28);
      recolor(p, P14, P13, (x, y) => x + y > 40);
      p.outline(P10);
      fin(p);
    },
  },
  doublestar: {
    size: 32,
    paint(p) {
      p.poly(star(10.5, 11, 9.5, 4), P23).poly(star(21.5, 21.5, 9.5, 4), P24);
      recolor(p, P23, P22, (x, y) => x + y > 24);
      recolor(p, P24, P23, (x, y) => x + y > 48);
      fin(p);
    },
  },

  coin: {
    size: 32,
    paint(p) {
      p.disc(16, 16, 13, P23).ring(16, 16, 10, 11.5, P22);
      recolor(p, P23, P24, (x, y) => x + y < 24 && (x + 0.5 - 16) ** 2 + (y + 0.5 - 16) ** 2 > 9 ** 2);
      microPix(p, '¢', 13, 11, P21, 2);
      fin(p);
    },
  },

  skull: {
    size: 32,
    paint(p) {
      p.disc(16, 13, 10, P09).rect(10, 19, 12, 8, P09);
      recolor(p, P09, P08, (x, y) => x + y > 38);
      p.disc(11.5, 13, 3, P01).disc(20.5, 13, 3, P01);
      p.poly([[16, 16], [14, 20], [18, 20]], P01);
      for (const x of [12, 14, 16, 18, 20]) p.rect(x, 23, 1, 4, P08);
      p.rect(10, 22, 12, 1, P08);
      p.px(10, 14, P09).px(22, 14, P09);
      fin(p);
    },
  },

  moon: {
    size: 32,
    paint(p) {
      p.disc(15, 16, 12, P20).disc(21, 13, 10, T);
      recolor(p, P20, P19, (x, y) => x + y > 30);
      p.px(8, 12, P10).px(9, 12, P10).px(8, 13, P10);
      plus(p, 25, 8, P10); plus(p, 23, 24, P20);
      fin(p);
    },
    bg: flat(P34),
  },

  bolt: {
    size: 32,
    paint(p) {
      p.poly([[19, 2], [8, 18], [15, 18], [11, 30], [24, 13], [17, 13], [23, 2]], P20);
      recolor(p, P20, P19, (x, y) => x > 17 && y > 12);
      p.line(19, 3, 9, 17, P10);
      fin(p);
    },
  },

  rat: {
    size: 32,
    paint(p) {
      p.ellipse(18, 20, 9, 6, P05).ellipse(9, 19, 5, 4, P05).poly([[4, 17], [2, 20], [5, 22]], P05);
      p.disc(11, 14, 3.2, P05).disc(11, 14, 1.8, P13);
      p.rect(8, 24, 2, 3, P04).rect(20, 25, 2, 3, P04).rect(14, 25, 2, 2, P04);
      p.line(27, 21, 29, 17, P13).line(29, 17, 28, 12, P13).line(28, 12, 30, 9, P13);
      recolor(p, P05, P04, (x, y) => y > 22 || x > 24);
      p.px(8, 18, P14).px(2, 20, P13).px(3, 20, P13);
      p.line(2, 19, -1, 17, P07).line(3, 21, 0, 23, P07);
      fin(p);
    },
  },

  bone: {
    size: 32,
    paint(p) {
      p.poly([[9, 26], [6, 23], [23, 6], [26, 9]], P09);
      for (const [x, y] of [[5, 22], [9, 26], [23, 6], [27, 10]]) p.disc(x, y, 3.4, P09);
      recolor(p, P09, P08, (x, y) => x + y > 36 || (x - y > 4 && x + y > 31));
      p.line(8, 21, 21, 8, P10);
      fin(p);
    },
  },

  spade: {
    size: 32,
    paint(p) {
      p.disc(10.5, 17, 6.5, P03).disc(21.5, 17, 6.5, P03).poly([[16, 2], [28, 16], [4, 16]], P03).poly([[16, 17], [12, 29], [20, 29]], P03);
      p.px(8, 14, P05).px(9, 13, P05).rect(14, 8, 1, 4, P05);
      fin(p);
    },
  },
  club: {
    size: 32,
    paint(p) {
      p.disc(16, 9.5, 6, P03).disc(9, 19, 6, P03).disc(23, 19, 6, P03).poly([[16, 14], [12, 29], [20, 29]], P03).rect(11, 14, 10, 8, P03);
      p.px(14, 6, P05).px(13, 7, P05).px(6, 17, P05).px(7, 16, P05);
      fin(p);
    },
  },
  dia: {
    size: 32,
    paint(p) {
      p.poly([[16, 2], [28, 16], [16, 30], [4, 16]], P14);
      recolor(p, P14, P15, (x, y) => x + y < 22);
      recolor(p, P14, P13, (x, y) => x + y > 36);
      fin(p);
    },
  },

  wild: {
    size: 32,
    paint(p) {
      p.poly(star(16, 16, 15.5, 9, 8, -Math.PI / 8), P23).disc(16, 16, 9, P42);
      recolor(p, P23, P24, (x, y) => x + y < 32);
      p.ring(16, 16, 7.5, 9, P41);
      px5Pix(p, 'W', 14, 12, P24, 1);
      fin(p);
    },
    bg: flat(P41),
  },

  jackpot: {
    size: 32,
    paint(p) {
      p.rect(1, 6, 30, 20, P23).rect(1, 6, 30, 1, P24).rect(1, 25, 30, 1, P22);
      p.rect(3, 8, 26, 16, P13).frame(3, 8, 26, 16, P12);
      microPix(p, 'JACK', 16 - Math.floor(microWidth('JACK') / 2), 10, P24, 1);
      microPix(p, 'POT', 16 - Math.floor(microWidth('POT') / 2), 17, P24, 1);
      plus(p, 3, 5, P10); plus(p, 28, 27, P10);
      fin(p);
    },
    bg: (p) => { p.rect(0, 0, 32, 32, P09); p.ditherFill(0, 0, 32, 32, undefined, P20, 5); },
  },

  blank: {
    size: 32,
    paint(p) {
      p.rect(0, 0, 32, 32, P09);
      for (const x of [4, 12, 20, 28]) p.rect(x, 0, 1, 32, P08);
    },
  },

  // ── BAR family (black plate, gold border) ────────────────────────────────────────────────────
  bar: {
    size: 32,
    paint(p) {
      barPlate(p, 10, 12, 1);
      fin(p);
    },
  },
  bar2: {
    size: 32,
    paint(p) {
      barPlate(p, 5, 11, 1); barPlate(p, 17, 11, 1);
      fin(p);
    },
  },
  bar3: {
    size: 32,
    paint(p) {
      barPlate(p, 2, 9, 0); barPlate(p, 12, 9, 0); barPlate(p, 22, 9, 0);
      fin(p);
    },
  },

  // ── pachislot "Oni Feast" ────────────────────────────────────────────────────────────────────
  oni: {
    size: 32,
    paint(p) {
      p.poly([[7, 9], [3, 0], [12, 6]], P09).poly([[25, 9], [29, 0], [20, 6]], P09);
      p.ellipse(16, 18, 11.5, 12, P14);
      recolor(p, P14, P13, (x, y) => x + y > 40);
      p.rect(7, 10, 18, 2, P12);
      p.poly([[8, 14], [14, 15], [8, 18]], P20).poly([[24, 14], [18, 15], [24, 18]], P20);
      p.px(11, 16, P01).px(21, 16, P01);
      p.rect(14, 17, 4, 5, P13);
      p.rect(8, 23, 16, 4, P01);
      p.poly([[9, 23], [11, 23], [10, 27]], P10).poly([[21, 23], [23, 23], [22, 27]], P10).rect(14, 23, 1, 2, P10).rect(17, 23, 1, 2, P10);
      fin(p);
    },
    bg: flat(P09),
  },
  koi: {
    size: 32,
    paint(p) {
      p.poly([[16, 24], [8, 31], [16, 29], [24, 31]], P19);
      p.poly([[10, 12], [3, 17], [8, 19]], P19).poly([[22, 12], [29, 17], [24, 19]], P19);
      p.ellipse(16, 14, 7, 12, P10);
      p.ellipse(15, 11, 5, 5, P19).ellipse(18, 19, 4, 4, P14).ellipse(14, 22, 3, 3, P19);
      p.px(12, 5, P01).px(20, 5, P01).px(13, 5, P01).px(19, 5, P01);
      recolor(p, P10, P09, (x, y) => x + y > 30);
      fin(p);
    },
  },
  replay: {
    size: 32,
    paint(p) {
      p.ring(16, 16, 7, 11, P37);
      p.map((x, y, c) => (c === P37 && Math.atan2(y + 0.5 - 16, x + 0.5 - 16) > -1.45 && Math.atan2(y + 0.5 - 16, x + 0.5 - 16) < -0.45 ? T : undefined));
      p.poly([[15, 1], [15, 13], [26, 7]], P37);
      recolor(p, P37, P36, (x, y) => x + y > 30);
      p.px(11, 9, P38).px(10, 10, P38).px(9, 12, P38);
      fin(p);
    },
  },
  lantern: {
    size: 32,
    paint(p) {
      p.rect(13, 0, 6, 3, P01).rect(10, 2, 12, 3, P22).ellipse(16, 17, 9.5, 11.5, P20);
      for (const y of [10, 14, 18, 22]) { const hw = Math.round(9.5 * Math.sqrt(1 - ((y - 17) / 11.5) ** 2)); p.rect(16 - hw, y, hw * 2, 1, P18); }
      recolor(p, P20, P19, (x, y) => x > 20 && y > 8);
      p.rect(10, 27, 12, 3, P22).rect(15, 30, 2, 2, P13);
      p.ditherFill(11, 11, 6, 10, undefined, P10, 6);
      fin(p);
    },
  },
  fan: {
    size: 32,
    paint(p) {
      const cx = 16, cy = 29, n = 7;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI * (0.92 - (i * 0.84) / n), a1 = -Math.PI * (0.92 - ((i + 1) * 0.84) / n);
        p.poly([[cx, cy], polar(cx, cy, 26, a0), polar(cx, cy, 26, a1)], i & 1 ? 0x7b295a : 0x4a193a);
        p.line(cx, cy, ...polar(cx, cy, 25, a0), P22);
      }
      p.line(cx, cy, ...polar(cx, cy, 25, -Math.PI * 0.08), P22);
      p.rect(14, 27, 5, 4, P26);
      p.map((x, y, c) => (c !== T && Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - 25) < 1.2 ? P23 : undefined));
      fin(p);
    },
  },

  // ── fruit-machine extras ─────────────────────────────────────────────────────────────────────
  moneybag: {
    size: 32,
    paint(p) {
      p.disc(16, 20, 10, P27).poly([[11, 12], [21, 12], [19, 8], [13, 8]], P27).rect(11, 9, 10, 3, P26);
      recolor(p, P27, P26, (x, y) => x + y > 40);
      p.rect(12, 11, 8, 2, P23).poly([[13, 8], [10, 4], [14, 6]], P27).poly([[19, 8], [22, 4], [18, 6]], P27);
      px5Pix(p, '$', 14, 15, P24, 1);
      fin(p);
    },
  },
  step: {
    size: 32,
    paint(p) {
      p.poly([[3, 12], [17, 12], [17, 5], [29, 16], [17, 27], [17, 20], [3, 20]], P19);
      recolor(p, P19, P20, (x, y) => y < 15 && x < 17);
      recolor(p, P19, P18, (x, y) => y > 22 || (x > 24));
      fin(p);
    },
  },
};

function paintCandle(p: Pix, flameDx: number): void {
  p.rect(9, 28, 14, 3, P22).rect(9, 28, 14, 1, P23);
  p.rect(12, 12, 8, 16, P09).rect(18, 12, 2, 16, P08);
  p.rect(12, 15, 1, 4, P09).rect(19, 17, 1, 3, P09).px(12, 19, P08).px(19, 20, P08);
  p.line(16, 9, 16, 11, P01);
  p.ellipse(16 + flameDx, 6, 2, 3, P20).rect(16 + flameDx, 6, 1, 2, P10);
  fin(p);
}
function barPlate(p: Pix, y: number, h: number, big: number): void {
  p.rect(3, y, 26, h, P01).frame(3, y, 26, h, P23);
  if (big) px5Pix(p, 'BAR', 16 - Math.floor(17 / 2), y + Math.floor((h - 7) / 2), P09, 1);
  else microPix(p, 'BAR', 16 - Math.floor(microWidth('BAR') / 2), y + Math.floor((h - 5) / 2), P09, 1);
}

/** Symbol aliases used by the machine docs (catalogue names → painter ids). */
export const SYMBOL_ALIASES: Record<string, string> = {
  shoe: 'horseshoe', grapes: 'grape', maw: 'grin', bar1: 'bar', '1bar': 'bar', '2bar': 'bar2', '3bar': 'bar3', gold_tooth: 'tooth_gold',
  luck: 'horseshoe', jack: 'jackid', hand: 'glove', plum2: 'plum', double_star: 'doublestar', money_bag: 'moneybag',
  gold_bullion: 'bullion', 777: 'seven', 7: 'seven', diamonds: 'dia', hearts: 'heart', spades: 'spade', clubs: 'club',
};

export const BUILTIN_SYMBOLS: Readonly<Record<string, SymbolDef>> = SYMBOLS;
