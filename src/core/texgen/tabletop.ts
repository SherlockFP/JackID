/**
 * Table-top textures: dice faces and atlas, chip tops/edges, wheel faces, the roulette ring and felt layout.
 * Owner: CORE-TEXGEN. ART_BIBLE §3.7–§3.8.
 *
 * Die face → normal mapping (opposites sum to 7): +Y = 1, −Y = 6, +X = 3, −X = 4, +Z = 2, −Z = 5.
 * Wheel convention: segment `i` of `n` is centred `i·360°/n` clockwise from 12 o'clock of the texture.
 */
import type { Hex } from '../types';
import { t as tr, upper } from '../i18n';
import { Pix, makeCanvas, mix, uvRect } from './pixel';
import { drawText, microPix, microWidth, px5Pix, px5Width } from './font';
import { darker, P01, P03, P05, P07, P08, P09, P13, P14, P22, P23, P24, P29, P30, P37, P42, P44, P45 } from './palette';
import { RED_NUMBERS, ROULETTE_ORDER } from './rouletteData';

// ── dice ─────────────────────────────────────────────────────────────────────────────────────────
export type DieStyle = 'bone' | 'craps' | 'sicbo';
const DIE_STYLES: Record<DieStyle, { body: Hex; pip: Hex; corner: Hex; bevel: Hex }> = {
  bone: { body: P08, pip: P01, corner: P03, bevel: P07 },
  craps: { body: P14, pip: P09, corner: P08, bevel: P13 },
  sicbo: { body: P09, pip: P01, corner: P03, bevel: P08 },
};
const PIP_POS: Record<number, Array<[number, number]>> = {
  1: [[6, 6]], 2: [[2, 2], [10, 10]], 3: [[2, 2], [6, 6], [10, 10]], 4: [[2, 2], [10, 2], [2, 10], [10, 10]],
  5: [[2, 2], [10, 2], [6, 6], [2, 10], [10, 10]], 6: [[2, 2], [10, 2], [2, 6], [10, 6], [2, 10], [10, 10]],
};
/** One 16×16 die face painted into `p` at (ox, oy): 15×15 body, bevel on the right column and bottom row. */
export function paintDieFace(p: Pix, ox: number, oy: number, n: number, body: Hex, pip: Hex, bevel = darker(body), corner = mix(pip, body, 0.35), pip1?: Hex, big1 = false): void {
  p.rect(ox, oy, 15, 15, body).rect(ox + 15, oy, 1, 16, bevel).rect(ox, oy + 15, 16, 1, bevel);
  for (const [x, y] of PIP_POS[n] ?? PIP_POS[1]) {
    const c = n === 1 && pip1 !== undefined ? pip1 : pip;
    if (n === 1 && big1) { p.rect(ox + 4, oy + 4, 7, 7, c).rect(ox + 4, oy + 4, 1, 1, body).rect(ox + 10, oy + 4, 1, 1, body).rect(ox + 4, oy + 10, 1, 1, body).rect(ox + 10, oy + 10, 1, 1, body); continue; }
    p.rect(ox + x, oy + y, 3, 3, c);
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2]]) p.px(ox + x + dx, oy + y + dy, corner);
  }
}
/** 16×16 single face. */
export function dieFace(n: number, body?: Hex, pip?: Hex): Pix {
  const s = DIE_STYLES.bone, p = new Pix(16, 16);
  paintDieFace(p, 0, 0, n, body ?? s.body, pip ?? s.pip, undefined, undefined);
  return p;
}
/** 64×32 atlas, faces 1–6 in a 4×2 grid (face i at col (i−1)%4, row ⌊(i−1)/4⌋). */
export function dieAtlas(style: DieStyle): Pix {
  const s = DIE_STYLES[style], p = new Pix(64, 32);
  for (let n = 1; n <= 6; n++) {
    paintDieFace(p, ((n - 1) % 4) * 16, Math.floor((n - 1) / 4) * 16, n, s.body, s.pip, s.bevel, s.corner, style === 'sicbo' && (n === 1 || n === 4) ? P14 : undefined, style === 'sicbo' && n === 1);
    if (style === 'sicbo' && n === 4) { /* pips of face 4 are red: repaint */
      const ox = 3 * 16, oy = 0;
      for (const [x, y] of PIP_POS[4]) p.rect(ox + x, oy + y, 3, 3, P14);
    }
  }
  return p;
}
export const dieUv = (n: number): [number, number, number, number] => uvRect(((n - 1) % 4) * 16, Math.floor((n - 1) / 4) * 16, 16, 16, 64, 32);

// ── chips ────────────────────────────────────────────────────────────────────────────────────────
interface ChipStyle { body: Hex; insert: Hex; text: Hex }
const CHIPS: Array<[number, ChipStyle]> = [
  [1, { body: P09, insert: P05, text: P01 }], [5, { body: P14, insert: P09, text: P09 }], [10, { body: P37, insert: P09, text: P09 }],
  [25, { body: P30, insert: P09, text: P09 }], [100, { body: P01, insert: P23, text: P09 }], [500, { body: P42, insert: P09, text: P09 }],
  [1000, { body: P23, insert: P01, text: P01 }], [5000, { body: P45, insert: P44, text: P01 }],
];
export function chipStyle(value: number): ChipStyle {
  let best = CHIPS[0][1];
  for (const [v, s] of CHIPS) if (value >= v) best = s;
  return best;
}
export const chipLabel = (v: number): string => (v >= 1000 && v % 1000 === 0 ? `${v / 1000}K` : String(v));
const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];

/** 32×32 chip top: rim, 8 edge inserts, inner ring, value (micro ×2 for ≤ 2 chars, px5 for longer). */
export function chipTop(value: number): Pix {
  const s = chipStyle(value), p = new Pix(32, 32);
  p.disc(16, 16, 16, darker(s.body)).disc(16, 16, 15, s.body);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    p.poly([polar(16, 16, 10.8, a - 0.2), polar(16, 16, 15, a - 0.17), polar(16, 16, 15, a + 0.17), polar(16, 16, 10.8, a + 0.2)], s.insert);
  }
  p.ring(16, 16, 9, 10, s.insert).disc(16, 16, 9, s.body);
  const label = chipLabel(value);
  if (label.length <= 2) { const w = microWidth(label, 2); microPix(p, label, 16 - Math.floor(w / 2), 11, s.text, 2); }
  else { const w = px5Width(label); px5Pix(p, label, 16 - Math.floor(w / 2) + 0, 13, s.text, 1); }
  return p;
}
/** 32×4 chip edge strip: 6 inserts 2 px wide on 5 px pitch. */
export function chipEdge(value: number): Pix {
  const s = chipStyle(value), p = new Pix(32, 4);
  p.rect(0, 0, 32, 4, s.body);
  for (let i = 0; i < 6; i++) p.rect(Math.round((i * 32) / 6) + 1, 0, 2, 4, s.insert);
  return p;
}

// ── wheel face ───────────────────────────────────────────────────────────────────────────────────
const lum = (c: Hex): number => (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) / 255;
const cssOf = (c: Hex): string => `#${c.toString(16).padStart(6, '0')}`;

/** Pie-segment wheel on a transparent square canvas; labels run radially. */
export function wheelFace(segments: ReadonlyArray<{ label: string; color: Hex }>, size: 128 | 256): HTMLCanvasElement {
  const n = Math.max(1, segments.length), r = size / 2, p = new Pix(size, size);
  const rimW = Math.max(3, Math.round(size / 40)), hub = Math.round(size / 12);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r, d = Math.hypot(dx, dy);
    if (d > r) continue;
    if (d > r - rimW) { p.px(x, y, d > r - 1 ? P01 : P03); continue; }
    let a = Math.atan2(dx, -dy);               // clockwise from 12 o'clock
    if (a < 0) a += Math.PI * 2;
    const f = (a / (Math.PI * 2)) * n + 0.5, i = Math.floor(f) % n, edge = Math.min(f - Math.floor(f), 1 - (f - Math.floor(f))) * (Math.PI * 2 * d) / n;
    p.px(x, y, edge < 0.55 && d > hub ? P01 : segments[i].color);
  }
  for (let i = 0; i < n; i++) {
    const [sx, sy] = polar(r, r, r - rimW / 2 - 0.5, ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n);
    p.rect(sx - 1, sy - 1, 2, 2, P23);
  }
  p.disc(r, r, hub, P22).ring(r, r, hub - 2, hub - 1, P24).disc(r, r, hub - 3, P23);
  const [cv, g] = makeCanvas(size, size);
  p.drawTo(g);
  segments.forEach((seg, i) => {
    if (!seg.label) return;
    const a = (i / n) * Math.PI * 2;
    g.save();
    g.translate(r, r); g.rotate(a);
    const ink = lum(seg.color) > 0.5 ? cssOf(P01) : cssOf(P09);
    const scale = size >= 256 ? 2 : 1;
    const radial = r - rimW - 4 * scale;
    drawText(g, seg.label, 0, -radial, { font: 'px5', scale, color: ink, align: 'center' });
    g.restore();
  });
  return cv;
}

// ── roulette (wheel data lives in the pure `rouletteData.ts`) ──────────────────────────────────────
const pocketHex = (n: number): Hex => (n === 0 ? P29 : RED_NUMBERS.includes(n) ? P14 : P01);

/** 296×12 pocket strip (37 cells × 8 px) for the wheel's annulus. */
export function rouletteRing(): Pix {
  const p = new Pix(296, 12);
  ROULETTE_ORDER.forEach((num, i) => {
    p.rect(i * 8, 0, 8, 12, pocketHex(num)).rect(i * 8, 0, 1, 12, P23);
    const s = String(num), w = microWidth(s);
    microPix(p, s, i * 8 + 1 + Math.floor((7 - w) / 2), 4, P09);
  });
  return p;
}

/**
 * 160×64 betting layout, 1 px = 1 cm (ART_BIBLE §3.8). Cells share their grid lines: rows at y = 0 / 16 / 32 / 48 / 56,
 * columns at x = 0 / 12 / 22 … 132 / 152. Labels follow the current language (`tex.roulette.*`); the even-money row has
 * no bottom line so its 7 interior rows hold a 3×5 body plus Turkish marks (İ above, Ç below).
 */
export function rouletteLayout(): Pix {
  const p = new Pix(160, 64), line = P09;
  p.rect(0, 0, 160, 64, P29);
  const label = (s: string, cx: number, y: number, c: Hex): void => { const w = microWidth(s); microPix(p, s, cx - Math.floor(w / 2), y, c); };
  const outlined = (s: string, cx: number, y: number, c: Hex): void => {
    const w = microWidth(s), x = cx - Math.floor(w / 2);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) microPix(p, s, x + dx, y + dy, line);
    microPix(p, s, x, y, c);
  };
  const h = (x: number, y: number, w: number): void => { p.rect(x, y, w, 1, line); };
  const v = (x: number, y: number, hh: number): void => { p.rect(x, y, 1, hh, line); };
  // zero + number grid + column bets
  h(0, 0, 153); h(0, 48, 153); h(12, 16, 141); h(12, 32, 141);          // the zero cell is one tall cell
  v(0, 0, 49); v(12, 0, 49);
  label('0', 6, 22, P09);
  for (let col = 0; col <= 12; col++) v(12 + col * 10, 0, 49);
  v(152, 0, 49);
  for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) {
    const num = col * 3 + (3 - row), s = String(num);
    outlined(s, 12 + col * 10 + 5, row * 16 + 6, pocketHex(num));
  }
  for (let row = 0; row < 3; row++) label('2:1', 142, row * 16 + 6, P09);
  // dozens (y 48–56) and even money (y 56–63, open at the bottom edge)
  h(12, 56, 121);
  for (let i = 0; i <= 3; i++) v(12 + i * 40, 48, 9);
  const dozens = [tr('tex.roulette.dozen1'), tr('tex.roulette.dozen2'), tr('tex.roulette.dozen3')];
  dozens.forEach((s, i) => label(upper(s), 12 + i * 40 + 20, 50, P09));
  for (let i = 0; i <= 6; i++) v(12 + i * 20, 56, 8);
  const even = ['1-18', upper(tr('tex.roulette.even')), '', '', upper(tr('tex.roulette.odd')), '19-36'];
  even.forEach((s, i) => { if (s) label(s, 12 + i * 20 + 10, 58, P09); });
  const dia = ['..#..', '.###.', '#####', '.###.', '..#..'];
  for (const [i, col] of [[2, P14], [3, P01]] as const) {
    const d = new Pix(7, 7).bits(dia, 1, 1, col).outline(line);      // outlined so the black one reads on felt
    p.blit(d, 12 + i * 20 + 7, 57);
  }
  return p;
}
