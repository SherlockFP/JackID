/**
 * Pawn Window — charm icons. The game has no per-charm art (every CharmDef says `icon: 'charm'`), so the shop paints a
 * small procedural badge per charm: a rarity-coloured plate with one glyph. The glyph follows the charm's family tag
 * (REELS coin, CARDS card, DICE die, WHEELS wheel, DROPS drop, CURIOS eye, LEDGER book, TYCOON crown), so the same
 * family always reads the same; untagged charms take a glyph from a small fallback set by a hash of the id, and
 * cursed charms always get the skull. The colour says the rarity (brass / green / blue / gold / violet for cursed).
 * Pure `Pix` drawing, deterministic, no three, no DOM beyond the canvas conversion done by the caller.
 */
import { Pix, lighten, darken } from '@/core/texgen/pixel';
import type { CharmRarity } from '@/game/types';

export const ICON_PX = 24;
const PLATE = 0x1a1008;

const RARITY_COLOR: Record<CharmRarity, number> = {
  common: 0xe0b860, uncommon: 0x6fdc78, rare: 0x62a4ff, legendary: 0xffd23c, cursed: 0xb476ff,
};
/** The colour a rarity glows in (icon rim, floor glow, card title). */
export const rarityColor = (r: CharmRarity): number => RARITY_COLOR[r] ?? RARITY_COLOR.common;

const hashId = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

type Glyph = (p: Pix, c: number, hi: number, lo: number) => void;

const COIN: Glyph = (p, c, hi, lo) => {
  p.disc(12, 12, 6.5, c); p.ring(12, 12, 4, 5, lo);
  p.rect(11, 8, 2, 8, lo); p.rect(9, 10, 6, 1, lo); p.rect(9, 13, 6, 1, lo);
  p.px(9, 9, hi); p.px(14, 9, hi);
};
const CARD: Glyph = (p, c, hi, lo) => {
  p.rect(7, 4, 10, 15, c); p.frame(7, 4, 10, 15, lo);
  p.poly([[12, 8], [14, 11], [12, 14], [10, 11]], lo);
  p.rect(8, 5, 2, 1, hi); p.px(8, 6, hi);
};
const DIE: Glyph = (p, c, hi, lo) => {
  p.rect(5, 5, 14, 14, c); p.frame(5, 5, 14, 14, lo);
  p.rect(7, 7, 2, 2, lo); p.rect(15, 7, 2, 2, lo); p.rect(11, 11, 2, 2, lo);
  p.rect(7, 15, 2, 2, lo); p.rect(15, 15, 2, 2, lo);
  p.rect(6, 6, 4, 1, hi);
};
const WHEEL: Glyph = (p, c, hi, lo) => {
  p.ring(12, 12, 4.5, 7, c);
  p.line(12, 5, 12, 19, c); p.line(5, 12, 19, 12, c);
  p.line(7, 7, 17, 17, c); p.line(17, 7, 7, 17, c);
  p.disc(12, 12, 2, lo); p.px(10, 9, hi);
};
const DROP: Glyph = (p, c, hi, lo) => {
  p.disc(12, 14, 5.5, c); p.poly([[12, 4], [6.5, 13], [17.5, 13]], c);
  p.disc(12, 14, 2.5, lo); p.px(9, 12, hi); p.px(10, 11, hi);
};
const EYE: Glyph = (p, c, hi, lo) => {
  p.ellipse(12, 12, 8, 4.5, c); p.disc(12, 12, 3.4, lo); p.disc(12, 12, 1.6, hi);
  p.line(5, 12, 19, 12, c);
};
const BOOK: Glyph = (p, c, hi, lo) => {
  p.rect(6, 4, 12, 16, c); p.frame(6, 4, 12, 16, lo); p.rect(6, 4, 2, 16, lo);
  p.rect(10, 8, 6, 1, lo); p.rect(10, 11, 6, 1, lo); p.rect(10, 14, 4, 1, lo);
  p.px(15, 17, hi);
};
const CROWN: Glyph = (p, c, hi, lo) => {
  p.poly([[5, 9], [8.5, 14], [12, 7], [15.5, 14], [19, 9], [18, 17], [6, 17]], c);
  p.rect(6, 16, 13, 2, lo);
  p.px(5, 8, hi); p.px(12, 6, hi); p.px(19, 8, hi);
};
const FLAME: Glyph = (p, c, hi, lo) => {
  p.poly([[12, 4], [17.5, 12], [16, 17], [12, 20], [8, 17], [6.5, 12], [10, 8]], c);
  p.poly([[12, 10], [14.5, 14], [12, 18], [9.5, 14]], hi);
  p.px(12, 19, lo);
};
const LEAF: Glyph = (p, c, hi, lo) => {
  p.disc(9.5, 9.5, 3.4, c); p.disc(14.5, 9.5, 3.4, c); p.disc(9.5, 14.5, 3.4, c); p.disc(14.5, 14.5, 3.4, c);
  p.rect(11, 11, 2, 2, lo); p.line(12, 15, 15, 20, lo); p.px(8, 8, hi);
};
const KEY: Glyph = (p, c, hi, lo) => {
  p.ring(9, 9, 2, 4.5, c); p.rect(11, 11, 3, 3, c); p.rect(13, 13, 3, 3, c); p.rect(15, 15, 4, 2, c);
  p.rect(15, 17, 2, 2, c); p.rect(18, 17, 2, 2, c); p.px(7, 7, hi); p.px(9, 6, hi); p.px(14, 14, lo);
};
const HEART: Glyph = (p, c, hi, lo) => {
  p.disc(9.5, 10, 3.5, c); p.disc(14.5, 10, 3.5, c); p.poly([[6, 11], [18, 11], [12, 19]], c);
  p.px(8, 8, hi); p.px(9, 8, hi); p.line(12, 14, 12, 17, lo);
};
const STAR: Glyph = (p, c, hi, lo) => {
  p.poly([[12, 4.5], [14, 10], [19.5, 10], [15, 13.5], [17, 19], [12, 15.5], [7, 19], [9, 13.5], [4.5, 10], [10, 10]], c);
  p.px(11, 8, hi); p.px(12, 9, hi); p.px(12, 14, lo);
};
const GEM: Glyph = (p, c, hi, lo) => {
  p.poly([[12, 5], [18, 10], [12, 19], [6, 10]], c); p.poly([[12, 5], [15, 10], [9, 10]], hi);
  p.line(6, 10, 18, 10, lo); p.line(12, 10, 12, 19, lo);
};
const HORSESHOE: Glyph = (p, c, hi, lo) => {
  p.ring(12, 12, 3.5, 7.5, c); p.rect(9, 14, 6, 6, PLATE); p.rect(5, 15, 3, 4, c); p.rect(16, 15, 3, 4, c);
  p.px(8, 8, hi); p.px(9, 7, hi); p.px(6, 17, lo); p.px(17, 17, lo);
};
const BELL: Glyph = (p, c, hi, lo) => {
  p.poly([[12, 5], [16, 9], [17, 16], [19, 17], [5, 17], [7, 16], [8, 9]], c);
  p.disc(12, 18.5, 1.8, lo); p.px(10, 9, hi); p.px(10, 11, hi); p.px(12, 4, lo);
};

/** Skull for cursed charms (the family glyph is ignored: a cursed charm should look cursed at a glance). */
const SKULL: Glyph = (p, c, hi, lo) => {
  p.disc(12, 11, 6, c); p.rect(8, 14, 8, 5, c);
  p.disc(9.5, 11, 1.8, lo); p.disc(14.5, 11, 1.8, lo); p.px(12, 14, lo); p.px(11, 15, lo); p.px(13, 15, lo);
  p.rect(10, 17, 1, 2, lo); p.rect(12, 17, 1, 2, lo); p.rect(14, 17, 1, 2, lo); p.px(8, 8, hi); p.px(9, 7, hi);
};

/** One glyph per family tag. Tags are the CharmDef `tag` (suit / family / LEDGER / TYCOON). */
const FAMILY: Readonly<Record<string, Glyph>> = {
  REELS: COIN, CARDS: CARD, DICE: DIE, WHEELS: WHEEL, DROPS: DROP, CURIOS: EYE, LEDGER: BOOK, TYCOON: CROWN,
};
/** Untagged charms: a hash picks one of these, so neighbours still differ. */
const FALLBACK: readonly Glyph[] = [FLAME, LEAF, KEY, BELL, HEART, STAR, GEM, HORSESHOE];

/** The glyph for a charm: cursed → skull, else its family's glyph, else a hashed fallback. */
export function glyphFor(id: string, cursed: boolean, tag?: string): Glyph {
  if (cursed) return SKULL;
  const fam = tag?.toUpperCase();
  const g = fam ? FAMILY[fam] : undefined;
  return g ?? FALLBACK[hashId(id) % FALLBACK.length];
}

/** One charm's badge: plate, rim, glyph, outline. `lit` brightens it (the selected slot). */
export function charmIconPix(id: string, rarity: CharmRarity, cursed: boolean, lit: boolean, tag?: string): Pix {
  const p = new Pix(ICON_PX, ICON_PX);
  const kind: CharmRarity = cursed ? 'cursed' : rarity;
  const rim = rarityColor(kind);
  const body = lit ? lighten(rim, 0.25) : rim;
  const hi = lighten(rim, 0.7), lo = darken(rim, 0.62);
  p.disc(12, 12, 11, darken(rim, 0.75));                 // rim shadow
  p.disc(12, 12, 10, rim);                               // rim
  p.disc(12, 12, 8.6, PLATE);                            // plate
  glyphFor(id, cursed, tag)(p, body, hi, lo);
  if (kind === 'legendary') { p.px(3, 4, 0xffffff); p.px(20, 5, 0xffffff); p.px(19, 19, 0xffffff); p.px(4, 18, 0xfff0a0); }
  if (kind === 'rare') { p.px(4, 5, hi); p.px(19, 18, hi); }
  p.outline(0x0a0604);
  return p;
}
