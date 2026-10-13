/**
 * Card and tile atlases. Owner: CORE-TEXGEN.
 *
 *  • Standard 52-card deck + Joker + backs + blank (ART_BIBLE §3.5, original "JackID Court" portraits).
 *  • SON KART — the original UNO-style shedding deck (4 colours 0–9, Skip, Reverse, +2, Wild, Wild +4 and the
 *    JackID specials Debt / Collector / Curse / Jackpot). Colours are also told apart by shape.
 *  • OKEY — 106-tile set (4 colours × 1–13, two sets, plus the false joker).
 *
 * Each builder returns the atlas bitmap and a `uv(key)` that yields [u0, v0, u1, v1] (flipY convention).
 */
import { Pix, PIP5, T, uvRect } from './pixel';
import { microPix, narrowDigits, px5Pix, px5Width } from './font';
import { BUILTIN_SYMBOLS } from './symbols';
import {
  P01, P02, P03, P07, P08, P09, P10, P12, P13, P14, P15, P19, P20, P22, P23, P24, P29, P30, P31, P35, P36, P37, P38,
  P39, P40, P44, P45, P47,
} from './palette';

export type UV = [u0: number, v0: number, u1: number, v1: number];
export interface Atlas { pix: Pix; uv(key: string): UV }

export const CARD_W = 32, CARD_H = 48;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;
type Rank = (typeof RANKS)[number];
type Suit = (typeof SUITS)[number];

/** Clear the 3 px of each corner (rounded cut-out card corners). */
function roundCorners(p: Pix, ox: number, oy: number, w: number, h: number): void {
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [w - 1, 0, -1, 1], [0, h - 1, 1, -1], [w - 1, h - 1, -1, -1]] as const) {
    p.px(ox + cx, oy + cy, T).px(ox + cx + sx, oy + cy, T).px(ox + cx, oy + cy + sy, T);
  }
}
const suitColor = (s: Suit): number => (s === 'H' || s === 'D' ? P14 : P01);
const pipOf = (s: Suit): readonly string[] => PIP5[s === 'S' ? 'S' : s === 'H' ? 'H' : s === 'D' ? 'D' : 'C'];

// pip layout (top-left corners), ART_BIBLE §3.5
const COL = { L: 8, C: 13, R: 18 }, ROW = { R1: 5, R3: 21, R5: 37, Q1: 13, Q2: 29, S1: 5, S2: 15, S3: 27, S4: 37 };
const PIPS: Record<string, Array<[number, number]>> = {
  '2': [[COL.C, ROW.R1], [COL.C, ROW.R5]],
  '3': [[COL.C, ROW.R1], [COL.C, ROW.R3], [COL.C, ROW.R5]],
  '4': [[COL.L, ROW.R1], [COL.R, ROW.R1], [COL.L, ROW.R5], [COL.R, ROW.R5]],
  '5': [[COL.L, ROW.R1], [COL.R, ROW.R1], [COL.C, ROW.R3], [COL.L, ROW.R5], [COL.R, ROW.R5]],
  '6': [[COL.L, ROW.R1], [COL.R, ROW.R1], [COL.L, ROW.R3], [COL.R, ROW.R3], [COL.L, ROW.R5], [COL.R, ROW.R5]],
  '7': [[COL.L, ROW.R1], [COL.R, ROW.R1], [COL.L, ROW.R3], [COL.R, ROW.R3], [COL.L, ROW.R5], [COL.R, ROW.R5], [COL.C, ROW.Q1]],
  '8': [[COL.L, ROW.R1], [COL.R, ROW.R1], [COL.L, ROW.R3], [COL.R, ROW.R3], [COL.L, ROW.R5], [COL.R, ROW.R5], [COL.C, ROW.Q1], [COL.C, ROW.Q2]],
};
const sidePips = (): Array<[number, number]> => [ROW.S1, ROW.S2, ROW.S3, ROW.S4].flatMap((y) => [[COL.L, y], [COL.R, y]] as Array<[number, number]>);
PIPS['9'] = [...sidePips(), [COL.C, ROW.R3]];
PIPS['T'] = [...sidePips(), [COL.C, 10], [COL.C, 32]];

/** Paint one standard face into `p` at (ox, oy). */
function paintFace(p: Pix, ox: number, oy: number, rank: Rank, suit: Suit): void {
  const c = suitColor(suit), card = new Pix(CARD_W, CARD_H);
  card.rect(0, 0, CARD_W, CARD_H, P09).frame(0, 0, CARD_W, CARD_H, P07);
  roundCorners(card, 0, 0, CARD_W, CARD_H);
  if (rank === 'T') card.bits(['10111', '10101', '10101', '10101', '10111'], 1, 2, c); else microPix(card, rank, 2, 2, c);
  card.bits(pipOf(suit), 1, 9, c);
  card.blitRot180(card, 0, 0, 8, 16, 24, 32);
  const pips = PIPS[rank];
  if (pips) {
    for (const [x, y] of pips) card.bits(pipOf(suit), x, y, c, 1, y + 2 > 23);
  } else if (rank === 'A') {
    card.bits(pipOf(suit), 10, 18, c, 2);
    if (suit === 'S') { card.ring(15.5, 23.5, 8, 9.5, P23); card.rect(15, 24, 2, 1, P09); }
  } else {
    paintCourt(card, rank, suit, c);
  }
  p.blit(card, ox, oy);
}

/** The JackID court: Bellhop (J), Widow (Q), Owner (K) — double-ended portraits in a suit-coloured frame. */
function paintCourt(card: Pix, rank: Rank, suit: Suit, c: number): void {
  const accent = suit === 'H' || suit === 'D' ? P13 : P03, half = new Pix(16, 15);
  half.rect(0, 0, 16, 15, P09);
  if (rank === 'J') {
    half.rect(5, 1, 6, 2, P12).rect(5, 3, 6, 1, P23).ellipse(8, 6, 3, 3, P08).px(7, 6, P01).px(9, 6, P01);
    half.rect(2, 10, 12, 5, accent).rect(8, 10, 1, 5, P23).ellipse(13, 10, 3, 1, P45);
  } else if (rank === 'Q') {
    half.poly([[8, 0], [1, 11], [15, 11]], P01).ellipse(8, 6, 2.5, 3, P08).px(7, 8, P14).px(8, 8, P14);
    for (let x = 4; x <= 12; x += 2) half.px(x, 11, P10);
    half.rect(2, 12, 12, 3, accent);
  } else {
    half.rect(5, 0, 6, 4, P01).rect(3, 4, 10, 1, P01).rect(5, 3, 6, 1, P13).ellipse(8, 7, 3, 3, P08);
    half.ring(9.5, 7, 1, 2, P23).px(6, 7, P01).rect(10, 9, 3, 1, P07).px(13, 9, P15);
    half.rect(3, 11, 10, 4, accent).line(5, 12, 10, 13, P23);
  }
  card.rect(8, 9, 16, 30, P09);
  card.blit(half, 8, 9);
  card.blitRot180(half, 0, 0, 16, 15, 8, 24);
  card.frame(8, 9, 16, 30, c);
  // ivory plates keep the corner pips legible over the portrait
  card.rect(9, 10, 6, 6, P09).rect(17, 32, 6, 6, P09);
  card.bits(pipOf(suit), 9, 10, c);
  card.bits(pipOf(suit), 18, 33, c, 1, true);
}

type BackStyle = 'red' | 'blue' | 'black' | 'cursed';
function paintBack(p: Pix, ox: number, oy: number, style: BackStyle): void {
  const k = {
    red: { base: P12, border: P23, lat: P22, ring: P23, riv: P24 },
    blue: { base: P35, border: P38, lat: P36, ring: P38, riv: P39 },
    black: { base: P03, border: P23, lat: P44, ring: P22, riv: P24 },
    cursed: { base: P40, border: P47, lat: P47, ring: P47, riv: P09 },
  }[style];
  const b = new Pix(CARD_W, CARD_H);
  b.rect(0, 0, CARD_W, CARD_H, k.base).frame(2, 2, CARD_W - 4, CARD_H - 4, k.border);
  for (let y = 3; y < CARD_H - 3; y++) for (let x = 3; x < CARD_W - 3; x++) if ((x + y) % 4 === 0) b.px(x, y, k.lat);
  b.disc(15.5, 23.5, 7, k.base);
  if (style === 'cursed') {
    b.ellipse(16, 24, 5, 3, P09).rect(15, 23, 2, 2, P47).ring(16, 24, 6, 7, P47);
  } else {
    b.ring(15.5, 23.5, 5, 6.2, k.ring).rect(15, 23, 2, 2, P01);
    for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) b.px(15 + dx + (dx > 0 ? 1 : 0), 23 + dy + (dy > 0 ? 1 : 0), k.riv);
  }
  roundCorners(b, 0, 0, CARD_W, CARD_H);
  p.blit(b, ox, oy);
}

function paintJoker(p: Pix, ox: number, oy: number): void {
  const card = new Pix(CARD_W, CARD_H);
  card.rect(0, 0, CARD_W, CARD_H, P09).frame(0, 0, CARD_W, CARD_H, P07);
  roundCorners(card, 0, 0, CARD_W, CARD_H);
  card.frame(6, 8, 20, 32, P14);
  const coin = new Pix(32, 32);
  BUILTIN_SYMBOLS.jackid.paint(coin);
  card.blit(coin.resized(18, 18), 7, 15);
  card.poly(starPoints(16, 12, 4, 1.6), P14);
  card.poly(starPoints(16, 36, 4, 1.6), P14);
  microPix(card, 'J', 2, 2, P14); microPix(card, 'K', 2, 8, P14);
  card.blitRot180(card, 0, 0, 8, 16, 24, 32);
  p.blit(card, ox, oy);
}
function starPoints(cx: number, cy: number, ro: number, ri: number, n = 5): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, r = i & 1 ? ri : ro; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

/** 512×256 atlas: rows ♠ ♥ ♦ ♣ (A 2…10 J Q K), row 4 = house/teal/cursed backs, blank, black back, joker. */
export function buildCardAtlas(): Atlas {
  const p = new Pix(512, 256);
  SUITS.forEach((s, r) => RANKS.forEach((k, c) => paintFace(p, c * CARD_W, r * CARD_H, k, s)));
  paintBack(p, 0, 192, 'red'); paintBack(p, 32, 192, 'blue'); paintBack(p, 64, 192, 'cursed');
  const blank = new Pix(CARD_W, CARD_H).rect(0, 0, CARD_W, CARD_H, P09).frame(0, 0, CARD_W, CARD_H, P07);
  roundCorners(blank, 0, 0, CARD_W, CARD_H);
  p.blit(blank, 96, 192);
  paintBack(p, 128, 192, 'black');
  paintJoker(p, 160, 192);
  const cell = (x: number, y: number): UV => uvRect(x, y, CARD_W, CARD_H, 512, 256);
  const named: Record<string, [number, number]> = {
    back: [0, 192], 'back.red': [0, 192], house: [0, 192], 'back.blue': [32, 192], teal: [32, 192], 'back.cursed': [64, 192], cursed: [64, 192],
    blank: [96, 192], 'back.black': [128, 192], JK: [160, 192],
  };
  return {
    pix: p,
    uv(key) {
      const n = named[key];
      if (n) return cell(n[0], n[1]);
      const rank = RANKS.indexOf(key[0] as Rank), suit = SUITS.indexOf(key[1] as Suit);
      return rank >= 0 && suit >= 0 ? cell(rank * CARD_W, suit * CARD_H) : cell(96, 192);
    },
  };
}

// ── SON KART ─────────────────────────────────────────────────────────────────────────────────────
export type SonKartColor = 'R' | 'Y' | 'G' | 'B';
export const SON_KART_COLORS: readonly SonKartColor[] = ['R', 'Y', 'G', 'B'];
/** Id grammar: `<colour><0-9|S|V|+2>` (S = skip, V = reverse) and the colourless specials. */
export type SonKartId = `${SonKartColor}${'0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'S' | 'V' | '+2'}` | 'W' | 'W+4' | 'DEBT' | 'COLLECTOR' | 'CURSE' | 'JACKPOT';
const SK_FACES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'V', '+2'] as const;
export const SON_KART_IDS: readonly SonKartId[] = [
  ...SON_KART_COLORS.flatMap((c) => SK_FACES.map((f) => `${c}${f}` as SonKartId)), 'W', 'W+4', 'DEBT', 'COLLECTOR', 'CURSE', 'JACKPOT',
];
export const SON_KART_SPECIALS: readonly SonKartId[] = ['W', 'W+4', 'DEBT', 'COLLECTOR', 'CURSE', 'JACKPOT'];
/** Face colours (red, yellow, green, blue) and their darker shades. */
export const SK_COLORS: Record<SonKartColor, { c: number; d: number; l: number }> = {
  R: { c: P14, d: P12, l: P15 }, Y: { c: P20, d: P19, l: P24 }, G: { c: P30, d: P29, l: P31 }, B: { c: P37, d: P35, l: P38 },
};
/** Colour-blind shapes: red ◆, yellow ●, green ▲, blue ■ (5×5). */
const SK_SHAPES: Record<SonKartColor, readonly string[]> = {
  R: ['..#..', '.###.', '#####', '.###.', '..#..'],
  Y: ['.###.', '#####', '#####', '#####', '.###.'],
  G: ['..#..', '.###.', '.###.', '#####', '#####'],
  B: ['#####', '#####', '#####', '#####', '#####'],
};

function paintSkColor(p: Pix, ox: number, oy: number, col: SonKartColor, face: (typeof SK_FACES)[number]): void {
  const k = SK_COLORS[col], card = new Pix(CARD_W, CARD_H);
  card.rect(0, 0, CARD_W, CARD_H, P01).rect(1, 1, CARD_W - 2, CARD_H - 2, k.c).frame(2, 2, CARD_W - 4, CARD_H - 4, k.d);
  card.rect(1, 1, CARD_W - 2, 2, k.l).rect(1, 1, 2, CARD_H - 2, k.l);
  card.ditherFill(3, 3, 26, 42, undefined, k.d, 3);
  roundCorners(card, 0, 0, CARD_W, CARD_H);
  card.disc(16, 24, 12.5, P01).ring(16, 24, 11, 12.5, k.c);
  const ink = P10;
  if (face === 'S') {
    card.ring(16, 24, 6, 8.5, ink); card.line(11, 29, 21, 19, ink).line(12, 29, 22, 19, ink).line(11, 28, 21, 18, ink);
  } else if (face === 'V') {
    card.rect(9, 19, 10, 3, ink).poly([[18, 16], [25, 20.5], [18, 25]], ink);
    card.rect(13, 26, 10, 3, ink).poly([[14, 23], [7, 27.5], [14, 32]], ink);
  } else if (face === '+2') {
    const w = px5Width('+2', 2);
    px5Pix(card, '+2', 16 - Math.floor(w / 2) + 1, 17, ink, 2);
  } else {
    const w = px5Width(face, 2);
    px5Pix(card, face, 16 - Math.floor(w / 2) + 1, 17, ink, 2);
    if (face === '6' || face === '9') card.rect(16 - Math.floor(w / 2) + 1, 32, w, 1, ink);   // underline: 6 vs 9
  }
  // corner index + colour shape (colour-blind safe), rotated copy bottom right
  const cornerInk = col === 'Y' ? P01 : P10;     // white on yellow is unreadable
  if (face === 'S') card.bits(['.###.', '#..##', '#.#.#', '##..#', '.###.'], 4, 4, cornerInk);
  else if (face === 'V') card.bits(['.#...', '#####', '.#...', '...#.', '#####', '...#.'], 4, 3, cornerInk);
  else microPix(card, face, 4, 4, cornerInk);
  card.bits(SK_SHAPES[col], 4, 11, cornerInk);
  card.blitRot180(card, 0, 0, 12, 17, 20, 31);
  p.blit(card, ox, oy);
}

function paintSkSpecial(p: Pix, ox: number, oy: number, id: SonKartId): void {
  const card = new Pix(CARD_W, CARD_H);
  const body = id === 'DEBT' ? P12 : id === 'CURSE' ? P40 : id === 'JACKPOT' ? P22 : P02;
  card.rect(0, 0, CARD_W, CARD_H, P01).rect(1, 1, CARD_W - 2, CARD_H - 2, body).frame(2, 2, CARD_W - 4, CARD_H - 4, id === 'CURSE' ? P47 : P23);
  roundCorners(card, 0, 0, CARD_W, CARD_H);
  const cx = 16, cy = 24;
  if (id === 'W' || id === 'W+4') {
    card.disc(cx, cy, 12.5, P01);
    for (let y = 12; y < 36; y++) for (let x = 4; x < 28; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > 11 ** 2) continue;
      card.px(x, y, SK_COLORS[y < cy ? (x < cx ? 'R' : 'Y') : (x < cx ? 'G' : 'B')].c);
    }
    card.line(cx - 1, cy - 12, cx - 1, cy + 11, P01).line(cx, cy - 12, cx, cy + 11, P01).line(cx - 12, cy - 1, cx + 11, cy - 1, P01).line(cx - 12, cy, cx + 11, cy, P01);
    if (id === 'W+4') { card.disc(cx, cy, 6.5, P01).ring(cx, cy, 5, 6.5, P23); px5Pix(card, '+4', 16 - Math.floor(px5Width('+4') / 2), 21, P10, 1); }
    else card.disc(cx, cy, 3, P01).ring(cx, cy, 2, 3, P23);
    microPix(card, id === 'W' ? 'W' : '+4', 4, 4, P23);
  } else if (id === 'DEBT') {
    card.disc(cx, cy, 12, P13).ring(cx, cy, 10, 12, P23).rect(10, 23, 12, 3, P10).poly([[10, 29], [22, 29], [16, 36]], P14);
    px5Pix(card, '¢', 14, 14, P24, 1);
    microPix(card, '-¢', 4, 4, P24);
  } else if (id === 'COLLECTOR') {
    card.disc(cx, cy, 12, P03).rect(11, 12, 10, 12, P01).rect(8, 23, 16, 2, P01).rect(11, 20, 10, 2, P13);
    card.ellipse(16, 30, 4, 4.5, P08).px(14, 29, P01).ring(18.5, 29.5, 1, 2.2, P23).px(16, 33, P01).px(17, 33, P01);
    microPix(card, 'C', 4, 4, P23);
  } else if (id === 'CURSE') {
    card.disc(cx, cy, 12, P03).ring(cx, cy, 11, 12.5, P47).ellipse(cx, cy, 8, 5, P09).rect(15, 23, 3, 3, P47).rect(16, 24, 1, 1, P01);
    for (let x = 9; x <= 23; x += 3) card.rect(x, 18, 1, 2, P01);
    microPix(card, '?', 4, 4, P47);
  } else {
    card.poly(starPoints(cx, cy, 13, 6.5, 8), P23).disc(cx, cy, 7, P22).ring(cx, cy, 6, 7, P24);
    px5Pix(card, 'x2', 16 - Math.floor(px5Width('x2') / 2), 21, P10, 1);
    microPix(card, '$', 4, 4, P24);
  }
  card.blitRot180(card, 0, 0, 12, 12, 20, 36);
  p.blit(card, ox, oy);
}

function paintSkBack(p: Pix, ox: number, oy: number): void {
  const b = new Pix(CARD_W, CARD_H);
  b.rect(0, 0, CARD_W, CARD_H, P01).frame(2, 2, CARD_W - 4, CARD_H - 4, P14);
  for (let y = 3; y < CARD_H - 3; y++) for (let x = 3; x < CARD_W - 3; x++) if ((x + y) % 6 === 0 || (x - y + 48) % 6 === 0) b.px(x, y, P03);
  b.disc(16, 24, 10, P02).ring(16, 24, 8.5, 10, P23);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if ((x + 0.5) ** 2 + (y + 0.5) ** 2 > 7.4 ** 2 || x === 0 || y === 0) continue;
    b.px(16 + x, 24 + y, SK_COLORS.B.c).px(15 - x, 24 + y, SK_COLORS.G.c).px(16 + x, 23 - y, SK_COLORS.Y.c).px(15 - x, 23 - y, SK_COLORS.R.c);
  }
  roundCorners(b, 0, 0, CARD_W, CARD_H);
  p.blit(b, ox, oy);
}

/** 512×256 Son Kart atlas: rows R Y G B (0–9, Skip, Reverse, +2), row 4 = Wild, Wild+4, Debt, Collector, Curse, Jackpot, back. */
export function buildSonKartAtlas(): Atlas {
  const p = new Pix(512, 256);
  SON_KART_COLORS.forEach((c, r) => SK_FACES.forEach((f, i) => paintSkColor(p, i * CARD_W, r * CARD_H, c, f)));
  SON_KART_SPECIALS.forEach((id, i) => paintSkSpecial(p, i * CARD_W, 192, id));
  paintSkBack(p, 6 * CARD_W, 192);
  return {
    pix: p,
    uv(key) {
      if (key === 'back') return uvRect(6 * CARD_W, 192, CARD_W, CARD_H, 512, 256);
      const sp = SON_KART_SPECIALS.indexOf(key as SonKartId);
      if (sp >= 0) return uvRect(sp * CARD_W, 192, CARD_W, CARD_H, 512, 256);
      const r = SON_KART_COLORS.indexOf(key[0] as SonKartColor), f = SK_FACES.indexOf(key.slice(1) as (typeof SK_FACES)[number]);
      return r >= 0 && f >= 0 ? uvRect(f * CARD_W, r * CARD_H, CARD_W, CARD_H, 512, 256) : uvRect(6 * CARD_W, 192, CARD_W, CARD_H, 512, 256);
    },
  };
}

// ── OKEY ─────────────────────────────────────────────────────────────────────────────────────────
export type OkeyColor = 'R' | 'K' | 'B' | 'Y';          // red · black (K) · blue · yellow
export const OKEY_COLORS: readonly OkeyColor[] = ['R', 'K', 'B', 'Y'];
/** `R1`…`Y13`, `FJ` (false joker), `back`. */
export type OkeyTileId = `${OkeyColor}${number}` | 'FJ' | 'back';
export const OKEY_W = 24, OKEY_H = 36;
const OKEY_INK: Record<OkeyColor, number> = { R: P14, K: P01, B: P37, Y: P19 };
const OKEY_SHAPE: Record<OkeyColor, readonly string[]> = {
  R: ['..#..', '.###.', '#####', '.###.', '..#..'], K: ['.###.', '#####', '#####', '#####', '.###.'],
  B: ['#####', '#####', '#####', '#####', '#####'], Y: ['..#..', '.###.', '.###.', '#####', '#####'],
};

function okeyBlank(): Pix {
  const t = new Pix(OKEY_W, OKEY_H);
  t.rect(0, 0, OKEY_W, OKEY_H, P09).rect(0, OKEY_H - 2, OKEY_W, 2, P08).rect(OKEY_W - 1, 0, 1, OKEY_H, P08).frame(0, 0, OKEY_W, OKEY_H, P07);
  roundCorners(t, 0, 0, OKEY_W, OKEY_H);
  return t;
}
function paintOkey(p: Pix, ox: number, oy: number, col: OkeyColor, n: number): void {
  const t = okeyBlank(), ink = OKEY_INK[col], s = narrowDigits(String(n));
  const w = px5Width(s, 2);
  px5Pix(t, s, Math.floor((OKEY_W - w) / 2), 6, ink, 2);
  t.bits(OKEY_SHAPE[col], 9, 24, ink, 1);
  t.px(12, 27, P09);
  p.blit(t, ox, oy);
}
function paintFalseJoker(p: Pix, ox: number, oy: number): void {
  const t = okeyBlank();
  t.poly(starPoints(12, 17, 9, 4, 6), P23).ring(12, 17, 9.5, 10.5, P22);
  t.disc(12, 17, 2.2, P14);
  (['R', 'K', 'B', 'Y'] as const).forEach((c, i) => t.bits(OKEY_SHAPE[c], i < 2 ? 2 + i * 14 : 2 + (i - 2) * 14, i < 2 ? 3 : 28, OKEY_INK[c]));
  p.blit(t, ox, oy);
}
/** 320×192 atlas: rows R K B Y (1–13), row 4 = false joker, plain back. */
export function buildOkeyAtlas(): Atlas {
  const p = new Pix(320, 192);
  OKEY_COLORS.forEach((c, r) => { for (let n = 1; n <= 13; n++) paintOkey(p, (n - 1) * OKEY_W, r * OKEY_H, c, n); });
  paintFalseJoker(p, 0, 4 * OKEY_H);
  const back = okeyBlank();
  back.rect(2, 2, OKEY_W - 4, OKEY_H - 5, P08);
  p.blit(back, OKEY_W, 4 * OKEY_H);
  return {
    pix: p,
    uv(key) {
      if (key === 'FJ') return uvRect(0, 4 * OKEY_H, OKEY_W, OKEY_H, 320, 192);
      if (key === 'back') return uvRect(OKEY_W, 4 * OKEY_H, OKEY_W, OKEY_H, 320, 192);
      const r = OKEY_COLORS.indexOf(key[0] as OkeyColor), n = parseInt(key.slice(1), 10);
      return r >= 0 && n >= 1 && n <= 13 ? uvRect((n - 1) * OKEY_W, r * OKEY_H, OKEY_W, OKEY_H, 320, 192) : uvRect(OKEY_W, 4 * OKEY_H, OKEY_W, OKEY_H, 320, 192);
    },
  };
}
