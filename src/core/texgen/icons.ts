/**
 * 16×16 UI icons registered under `icon.<id>` (buffs, charms, totems, upgrades, currencies — TECH_SPEC §2.4)
 * plus a deterministic fallback so a content id with no painter yet still shows a distinct, readable glyph
 * (symmetric 5×5 sigil on a coloured plate). Owner: CORE-TEXGEN; content owners override any id with
 * `tex.registerSymbol('icon.<id>', paint)`.
 */
import type { Hex } from '../types';
import { hashSeed } from '../rng';
import { Pix } from './pixel';
import type { SymbolDef } from './symbols';
import {
  P01, P03, P04, P08, P09, P10, P12, P13, P14, P15, P18, P19, P20, P22, P23, P24, P26, P29, P30, P32, P33, P35, P36,
  P37, P38, P39, P42, P43, P45, P46, P47,
} from './palette';

const fin = (p: Pix): void => { p.outline(P01); };
const def = (paint: (p: Pix) => void): SymbolDef => ({ size: 16, paint: (p) => { paint(p); fin(p); } });

/** LOKI's sigil: a green jester, a two-point cap with gold bells, a wide toothy grin. `blink` closes the eyes and opens the mouth (the talk frame). */
const jokerFace = (blink: boolean): SymbolDef => def((p) => {
  p.ellipse(8, 10, 6, 4.5, P33);
  p.poly([[2, 7], [2, 2], [8, 6]], P30).poly([[13, 7], [13, 2], [7, 6]], P30);
  p.rect(3, 5, 10, 2, P30).rect(3, 7, 10, 1, P23).rect(1, 1, 2, 2, P23).rect(13, 1, 2, 2, P23).px(1, 1, P24).px(13, 1, P24);
  if (blink) p.rect(5, 10, 2, 1, P01).rect(9, 10, 2, 1, P01);
  else p.rect(5, 9, 2, 2, P01).rect(9, 9, 2, 2, P01).px(5, 9, P10).px(9, 9, P10);
  p.px(2, 11, P01).px(13, 11, P01).px(3, 12, P01).px(12, 12, P01).rect(4, 13, 8, blink ? 2 : 1, P01);
  p.rect(4, 12, 8, 1, P10);
});

export const BUILTIN_ICONS: Readonly<Record<string, SymbolDef>> = {
  'icon.joker': jokerFace(false),
  'icon.joker2': jokerFace(true),
  'icon.coin': def((p) => { p.disc(8, 8, 6.5, P23).ring(8, 8, 4, 5, P22).px(5, 4, P24).px(6, 4, P24).px(4, 5, P24); p.rect(7, 5, 2, 6, P22); }),
  'icon.ticket': def((p) => { p.rect(1, 4, 14, 8, P19).disc(1, 8, 1.8, -1).disc(15, 8, 1.8, -1); p.rect(10, 5, 1, 6, P18); p.px(5, 7, P20).px(4, 8, P20).px(6, 8, P20).px(5, 9, P20); p.rect(2, 4, 12, 1, P20); }),
  'icon.pull': def((p) => { p.disc(8, 8, 6.5, P22).ring(8, 8, 4.5, 5.5, P23).disc(8, 8, 2, P01).px(4, 4, P24); }),
  'icon.debt': def((p) => { p.disc(8, 8, 6.5, P13).rect(4, 7, 8, 2, P10).px(5, 3, P15).px(6, 3, P15).px(4, 4, P15); }),
  'icon.clock': def((p) => { p.disc(8, 8, 6.5, P23).disc(8, 8, 5, P09).line(8, 8, 8, 4, P01).line(8, 8, 11, 8, P01).px(8, 8, P14); }),
  'icon.skull': def((p) => { p.disc(8, 7, 5.5, P09).rect(5, 10, 6, 4, P09).disc(6, 7, 1.6, P01).disc(10, 7, 1.6, P01).rect(7, 11, 1, 3, P08).rect(9, 11, 1, 3, P08).px(8, 9, P01); }),
  'icon.heart': def((p) => { p.disc(5, 6, 3.2, P14).disc(11, 6, 3.2, P14).poly([[2, 7], [14, 7], [8, 14]], P14).px(4, 4, P15).px(5, 4, P15); }),
  'icon.star': def((p) => { p.poly(starPts(8, 8.6, 7.6, 3.2), P20).px(6, 6, P10).px(7, 5, P10); }),
  'icon.bolt': def((p) => { p.poly([[10, 1], [3, 9], [7, 9], [5, 15], [13, 6], [9, 6], [12, 1]], P20).line(10, 2, 4, 9, P10); }),
  'icon.lock': def((p) => { p.ring(8, 6, 2.5, 4, P45).rect(4, 7, 8, 7, P23).rect(4, 13, 8, 1, P22).px(8, 10, P01).px(8, 11, P01); }),
  'icon.key': def((p) => { p.ring(5, 8, 1.6, 3.6, P23).rect(8, 7, 7, 2, P23).rect(12, 9, 1, 3, P23).rect(14, 9, 1, 2, P23); }),
  'icon.eye': def((p) => { p.ellipse(8, 8, 7, 4, P09).disc(8, 8, 3, P37).disc(8, 8, 1.3, P01).px(7, 7, P10); }),
  'icon.flame': def((p) => { p.poly([[8, 1], [12, 7], [12, 11], [8, 15], [4, 11], [4, 7], [6, 8]], P19).poly([[8, 6], [10, 10], [8, 14], [6, 10]], P20).px(8, 12, P10); }),
  'icon.drop': def((p) => { p.poly([[8, 1], [12, 8], [8, 15], [4, 8]], P38).disc(8, 10, 4, P38).px(6, 9, P10).px(6, 10, P10); }),
  'icon.bell': def((p) => { p.disc(8, 7, 4.5, P23).rect(3, 7, 10, 4, P23).rect(2, 11, 12, 1, P22).disc(8, 13, 1.5, P22).px(8, 2, P22).px(6, 5, P24); }),
  'icon.gear': def((p) => { p.ring(8, 8, 2.2, 5.4, P45); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; p.rect(Math.round(8 + Math.cos(a) * 6.2) - 1, Math.round(8 + Math.sin(a) * 6.2) - 1, 2, 2, P45); } p.px(5, 5, P46); }),
  'icon.shield': def((p) => { p.poly([[2, 2], [14, 2], [14, 8], [8, 15], [2, 8]], P36).poly([[3, 3], [8, 3], [8, 13], [3, 8]], P38).line(8, 3, 8, 13, P35); }),
  'icon.dice': def((p) => { p.rect(2, 2, 12, 12, P09).rect(13, 3, 1, 11, P08).rect(3, 13, 11, 1, P08); for (const [x, y] of [[4, 4], [10, 4], [7, 7], [4, 10], [10, 10]]) p.rect(x, y, 2, 2, P01); }),
  'icon.card': def((p) => { p.rect(3, 1, 10, 14, P09).rect(4, 14, 9, 1, P08); p.px(5, 3, P14).px(6, 3, P14).px(5, 4, P14); p.disc(6, 8, 1.6, P14).disc(9, 8, 1.6, P14).poly([[4.5, 9], [10.5, 9], [7.5, 12.5]], P14); }),
  'icon.chip': def((p) => { p.disc(8, 8, 6.5, P14).ring(8, 8, 3.5, 4.5, P09); for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; p.rect(Math.round(8 + Math.cos(a) * 5.4), Math.round(8 + Math.sin(a) * 5.4), 1, 1, P09); } }),
  'icon.arrow_up': def((p) => { p.poly([[8, 1], [14, 8], [10, 8], [10, 14], [6, 14], [6, 8], [2, 8]], P33); }),
  'icon.arrow_down': def((p) => { p.poly([[8, 15], [14, 8], [10, 8], [10, 2], [6, 2], [6, 8], [2, 8]], P14); }),
  'icon.check': def((p) => { p.line(2, 8, 6, 12, P33).line(3, 8, 6, 11, P33).line(6, 12, 14, 3, P33).line(6, 11, 13, 3, P33); }),
  'icon.cross': def((p) => { p.line(3, 3, 13, 13, P14).line(4, 3, 13, 12, P14).line(13, 3, 3, 13, P14).line(12, 3, 3, 12, P14); }),
  'icon.hourglass': def((p) => { p.rect(3, 1, 10, 2, P22).rect(3, 13, 10, 2, P22).poly([[4, 3], [12, 3], [8, 8]], P20).poly([[8, 8], [4, 13], [12, 13]], P19).line(4, 3, 12, 13, P39); }),
  'icon.moon': def((p) => { p.disc(7, 8, 6.5, P20).disc(11, 6, 5.5, -1).px(4, 6, P10); }),
  'icon.crown': def((p) => { p.rect(2, 9, 12, 4, P23).poly([[2, 9], [4, 3], [6, 9]], P23).poly([[5, 9], [8, 2], [11, 9]], P23).poly([[10, 9], [12, 3], [14, 9]], P23).px(5, 11, P14).px(8, 11, P37).px(11, 11, P30); }),
  'icon.mint': def((p) => { p.disc(8, 8, 6.5, P39).line(4, 11, 11, 4, P38).line(5, 12, 12, 5, P38).px(5, 5, P10); }),
  'icon.luck': def((p) => { p.ring(8, 7, 3, 6, P45).rect(0, 8, 16, 8, -1); p.rect(2, 7, 3, 6, P45).rect(11, 7, 3, 6, P45).px(3, 9, P01).px(12, 9, P01); }),
  'icon.hand': def((p) => { p.rect(5, 7, 7, 6, P09).rect(5, 2, 1, 6, P09).rect(7, 1, 1, 7, P09).rect(9, 2, 1, 6, P09).rect(11, 4, 1, 4, P09).poly([[5, 9], [2, 7], [2, 9], [5, 12]], P09).rect(5, 13, 7, 2, P38); }),
  'icon.ghost': def((p) => { p.disc(8, 7, 5.5, P39).rect(2, 7, 12, 7, P39).disc(4, 15, 1.4, -1).disc(8, 15, 1.4, -1).disc(12, 15, 1.4, -1).px(5, 7, P01).px(6, 7, P01).px(10, 7, P01).px(11, 7, P01).px(8, 10, P01); }),
  'icon.candle': def((p) => { p.rect(5, 8, 6, 6, P09).rect(10, 8, 1, 6, P08).rect(4, 14, 8, 1, P22).px(8, 6, P01).ellipse(8, 4, 1.2, 2, P20); }),
  'icon.tonic': def((p) => { p.rect(6, 1, 4, 3, P26).rect(5, 4, 6, 2, P32).rect(3, 6, 10, 9, P32).rect(4, 9, 8, 5, P33).px(5, 7, P10).px(5, 8, P10); }),
  'icon.grin': def((p) => { p.disc(8, 8, 6.5, P09).px(5, 6, P01).px(6, 6, P01).px(10, 6, P01).px(11, 6, P01).px(5, 6, P47).px(10, 6, P47); for (let x = 4; x <= 12; x++) p.px(x, 10 + (Math.abs(x - 8) > 2 ? 1 : 0), P01); }),
  'icon.question': def((p) => { p.disc(8, 8, 6.5, P42).rect(7, 11, 2, 2, P10).rect(6, 4, 4, 1, P10).rect(10, 5, 1, 2, P10).rect(8, 7, 2, 2, P10).rect(5, 5, 1, 1, P10); }),
  'icon.lamp': def((p) => { p.poly([[3, 7], [13, 7], [11, 14], [5, 14]], P20).rect(6, 2, 4, 5, P22).rect(4, 14, 8, 1, P22); p.px(5, 9, P10).px(5, 10, P10); }),
  'icon.pin': def((p) => { p.disc(8, 6, 4.5, P14).rect(7, 10, 2, 5, P45).px(6, 4, P15); }),
};

function starPts(cx: number, cy: number, ro: number, ri: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i & 1 ? ri : ro; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

const PLATES: readonly Hex[] = [P14, P19, P20, P33, P38, P37, P43, P42, P23, P32];
/**
 * Deterministic placeholder for any `icon.<id>` that has no painter yet: dark plate, id-coloured border and a
 * mirror-symmetric 5×5 sigil (so different ids look different, and the same id always looks the same).
 */
export function iconFallback(id: string): Pix {
  const h = hashSeed('icon', id), p = new Pix(16, 16);
  const col = PLATES[h % PLATES.length], dim = col === P14 ? P12 : col === P33 ? P29 : P04;
  p.rect(1, 1, 14, 14, P03).frame(1, 1, 14, 14, col).px(1, 1, -1).px(14, 1, -1).px(1, 14, -1).px(14, 14, -1);
  let bits = (h >>> 4) | 0x1;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (bits & 1) { p.rect(3 + x * 2, 3 + y * 2, 2, 2, P10); p.rect(3 + (4 - x) * 2, 3 + y * 2, 2, 2, P10); }
      bits = (bits >>> 1) | ((bits & 1) << 20);
    }
  }
  p.rect(2, 13, 12, 1, dim);
  p.outline(P01);
  return p;
}
