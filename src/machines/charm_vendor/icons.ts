/**
 * Pawn Window — charm icons. The game has no per-charm art (every CharmDef says `icon: 'charm'`), so the shop paints a
 * small procedural badge per charm: a rarity-coloured plate with one of ten glyphs picked by a hash of the charm id.
 * The colour says the rarity (brass / green / blue / gold / violet for cursed), the glyph makes neighbours different.
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
const GLYPHS: Glyph[] = [
  // coin
  (p, c, hi, lo) => { p.disc(12, 12, 6.5, c); p.ring(12, 12, 4, 5, lo); p.rect(11, 8, 2, 8, lo); p.rect(9, 10, 6, 1, lo); p.rect(9, 13, 6, 1, lo); p.px(9, 9, hi); },
  // gem
  (p, c, hi, lo) => { p.poly([[12, 5], [18, 10], [12, 19], [6, 10]], c); p.poly([[12, 5], [15, 10], [9, 10]], hi); p.line(6, 10, 18, 10, lo); p.line(12, 10, 12, 19, lo); },
  // key
  (p, c, hi, lo) => { p.ring(9, 9, 2, 4.5, c); p.rect(11, 11, 3, 3, c); p.rect(13, 13, 3, 3, c); p.rect(15, 15, 4, 2, c); p.rect(15, 17, 2, 2, c); p.rect(18, 17, 2, 2, c); p.px(7, 7, hi); p.px(9, 6, hi); p.px(14, 14, lo); },
  // heart
  (p, c, hi, lo) => { p.disc(9.5, 10, 3.5, c); p.disc(14.5, 10, 3.5, c); p.poly([[6, 11], [18, 11], [12, 19]], c); p.px(8, 8, hi); p.px(9, 8, hi); p.line(12, 14, 12, 17, lo); },
  // star
  (p, c, hi, lo) => { p.poly([[12, 4.5], [14, 10], [19.5, 10], [15, 13.5], [17, 19], [12, 15.5], [7, 19], [9, 13.5], [4.5, 10], [10, 10]], c); p.px(11, 8, hi); p.px(12, 9, hi); p.px(12, 14, lo); },
  // die
  (p, c, hi, lo) => { p.rect(6, 6, 12, 12, c); p.frame(6, 6, 12, 12, lo); p.rect(8, 8, 2, 2, lo); p.rect(14, 8, 2, 2, lo); p.rect(11, 11, 2, 2, lo); p.rect(8, 14, 2, 2, lo); p.rect(14, 14, 2, 2, lo); p.rect(7, 7, 4, 1, hi); },
  // clover
  (p, c, hi, lo) => { p.disc(9.5, 9.5, 3.4, c); p.disc(14.5, 9.5, 3.4, c); p.disc(9.5, 14.5, 3.4, c); p.disc(14.5, 14.5, 3.4, c); p.rect(11, 11, 2, 2, lo); p.line(12, 15, 15, 20, lo); p.px(8, 8, hi); },
  // eye
  (p, c, hi, lo) => { p.ellipse(12, 12, 8, 4.5, c); p.disc(12, 12, 3.4, lo); p.disc(12, 12, 1.6, hi); p.line(5, 12, 19, 12, c); },
  // horseshoe
  (p, c, hi, lo) => { p.ring(12, 12, 3.5, 7.5, c); p.rect(9, 14, 6, 6, PLATE); p.rect(5, 15, 3, 4, c); p.rect(16, 15, 3, 4, c); p.px(8, 8, hi); p.px(9, 7, hi); p.px(6, 17, lo); p.px(17, 17, lo); },
  // bell
  (p, c, hi, lo) => { p.poly([[12, 5], [16, 9], [17, 16], [19, 17], [5, 17], [7, 16], [8, 9]], c); p.disc(12, 18.5, 1.8, lo); p.px(10, 9, hi); p.px(10, 11, hi); p.px(12, 4, lo); },
];

/** Skull for cursed charms (the glyph hash is ignored: a cursed charm should look cursed at a glance). */
const SKULL: Glyph = (p, c, hi, lo) => {
  p.disc(12, 11, 6, c); p.rect(8, 14, 8, 5, c);
  p.disc(9.5, 11, 1.8, lo); p.disc(14.5, 11, 1.8, lo); p.px(12, 14, lo); p.px(11, 15, lo); p.px(13, 15, lo);
  p.rect(10, 17, 1, 2, lo); p.rect(12, 17, 1, 2, lo); p.rect(14, 17, 1, 2, lo); p.px(8, 8, hi); p.px(9, 7, hi);
};

/** One charm's badge: plate, rim, glyph, outline. `lit` brightens it (the selected slot). */
export function charmIconPix(id: string, rarity: CharmRarity, cursed: boolean, lit: boolean): Pix {
  const p = new Pix(ICON_PX, ICON_PX);
  const kind: CharmRarity = cursed ? 'cursed' : rarity;
  const rim = rarityColor(kind);
  const h = hashId(id);
  const body = lit ? lighten(rim, 0.25) : rim;
  const hi = lighten(rim, 0.7), lo = darken(rim, 0.62);
  p.disc(12, 12, 11, darken(rim, 0.75));                 // rim shadow
  p.disc(12, 12, 10, rim);                               // rim
  p.disc(12, 12, 8.6, PLATE);                        // plate
  (cursed ? SKULL : GLYPHS[h % GLYPHS.length])(p, body, hi, lo);
  if (kind === 'legendary') { p.px(3, 4, 0xffffff); p.px(20, 5, 0xffffff); p.px(19, 19, 0xffffff); p.px(4, 18, 0xfff0a0); }
  if (kind === 'rare') { p.px(4, 5, hi); p.px(19, 18, hi); }
  p.outline(0x0a0604);
  return p;
}
