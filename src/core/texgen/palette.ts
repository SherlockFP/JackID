/**
 * Master palette P00–P47 (ART_BIBLE §2.1, every value pre-snapped to the 15-bit grid) plus the ramps of
 * §2.2 and the "darker" LUT. Owner: CORE-TEXGEN. Pure data; the painters index it by the same P-numbers the
 * art bible uses, so a recipe in the doc reads 1:1 in code.
 */
import type { Hex } from '../types';

export const P00: Hex = 0x080808; // VOID
export const P01: Hex = 0x101019; // PIT_BLACK
export const P02: Hex = 0x191921; // SOOT
export const P03: Hex = 0x292131; // COAL
export const P04: Hex = 0x3a3a42; // ASH
export const P05: Hex = 0x5a525a; // SLATE
export const P06: Hex = 0x7b736b; // CONCRETE
export const P07: Hex = 0x9c9484; // GROUT
export const P08: Hex = 0xc5bda5; // BONE
export const P09: Hex = 0xe6dec5; // IVORY
export const P10: Hex = 0xf7efde; // PAPER
export const P11: Hex = 0x3a0810; // DRIED_BLOOD
export const P12: Hex = 0x5a1019; // OXBLOOD
export const P13: Hex = 0x8c1921; // CASINO_RED
export const P14: Hex = 0xc52129; // SIGNAL_RED
export const P15: Hex = 0xef5a4a; // CORAL
export const P16: Hex = 0x4a2110; // RUST_DEEP
export const P17: Hex = 0x7b3a19; // RUST
export const P18: Hex = 0xad6329; // COPPER
export const P19: Hex = 0xe69431; // AMBER
export const P20: Hex = 0xffce5a; // BULB_YELLOW
export const P21: Hex = 0x4a3a19; // BRASS_SHADOW
export const P22: Hex = 0x8c6b29; // BRASS
export const P23: Hex = 0xc59c42; // GOLD
export const P24: Hex = 0xefd67b; // GOLD_SHINE
export const P25: Hex = 0x311910; // WALNUT_DARK
export const P26: Hex = 0x523119; // WALNUT
export const P27: Hex = 0x6b3a21; // MAHOGANY
export const P28: Hex = 0x082919; // FELT_SHADOW
export const P29: Hex = 0x10523a; // FELT
export const P30: Hex = 0x297b4a; // FELT_LIGHT
export const P31: Hex = 0x8ca53a; // BILE
export const P32: Hex = 0x428c7b; // VERDIGRIS
export const P33: Hex = 0x5aff7b; // NEON_GREEN
export const P34: Hex = 0x101931; // ABYSS_BLUE
export const P35: Hex = 0x193a42; // DEEP_TEAL
export const P36: Hex = 0x4a6b84; // STEEL_BLUE
export const P37: Hex = 0x3163c5; // COBALT
export const P38: Hex = 0x63e6de; // CRT_CYAN
export const P39: Hex = 0xbdf7ef; // ICE
export const P40: Hex = 0x291031; // BRUISE
export const P41: Hex = 0x4a193a; // VELVET
export const P42: Hex = 0x7b295a; // PLUM
export const P43: Hex = 0xff42a5; // NEON_MAGENTA
export const P44: Hex = 0x31313a; // GUNMETAL
export const P45: Hex = 0x8c949c; // CHROME_MID
export const P46: Hex = 0xd6dee6; // CHROME_HI
export const P47: Hex = 0x9c4aff; // CURSE_VIOLET (reserved: curse / the House)

/** Indexed by palette number: `PAL[14]` = P14. */
export const PAL: readonly Hex[] = [
  P00, P01, P02, P03, P04, P05, P06, P07, P08, P09, P10, P11, P12, P13, P14, P15, P16, P17, P18, P19, P20, P21, P22, P23,
  P24, P25, P26, P27, P28, P29, P30, P31, P32, P33, P34, P35, P36, P37, P38, P39, P40, P41, P42, P43, P44, P45, P46, P47,
];

/** Ramps, dark → light (ART_BIBLE §2.2). */
export const RAMP = {
  GREY: [P00, P01, P02, P03, P04, P05, P06, P07, P08, P09, P10],
  BLOOD: [P11, P12, P13, P14, P15],
  FIRE: [P16, P17, P18, P19, P20],
  BRASS: [P21, P22, P23, P24],
  WOOD: [P25, P26, P27, P18],
  FELT: [P28, P29, P30],
  DECAY: [P28, P32, P31],
  NIGHT: [P34, P35, P36, P39],
  VELVET: [P40, P41, P42, P43],
  CHROME: [P44, P45, P46, P10],
  GUNMETAL: [P01, P44, P04, P05],
  PORCELAIN: [P07, P08, P09, P10],
} as const satisfies Record<string, readonly Hex[]>;

/** The 8 player/mask colours (ART_BIBLE §8.2: HARE FOX MOTH TOAD OWL CROW PIG GOAT); chips and daubs use them too. */
export const PLAYER_COLORS: readonly Hex[] = [P14, P19, P20, P31, P38, P37, P43, P09];

const DARKER = new Map<Hex, Hex>();
for (const ramp of Object.values(RAMP)) {
  ramp.forEach((c, i) => { if (!DARKER.has(c)) DARKER.set(c, i === 0 ? P01 : ramp[i - 1]); });
}
DARKER.set(P00, P00);
DARKER.set(P01, P00);
// colours that sit in no ramp still step down within the palette
DARKER.set(P37, P34); DARKER.set(P38, P36); DARKER.set(P33, P30); DARKER.set(P47, P42);

const LIGHTER = new Map<Hex, Hex>();
for (const ramp of Object.values(RAMP)) {
  ramp.forEach((c, i) => { if (!LIGHTER.has(c)) LIGHTER.set(c, ramp[Math.min(i + 1, ramp.length - 1)]); });
}
LIGHTER.set(P37, P38); LIGHTER.set(P38, P39); LIGHTER.set(P33, P33); LIGHTER.set(P47, P47);

/** Palette "darker" LUT (ART_BIBLE §2.2): one step down the ramp, ramp starts map to P01. Non-palette colours → ×0.72. */
export function darker(c: Hex): Hex {
  const d = DARKER.get(c);
  if (d !== undefined) return d;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * 0.72) << 16) | (Math.round(g * 0.72) << 8) | Math.round(b * 0.72);
}

/** Palette "lighter" LUT: one step up the colour's ramp (ramp ends stay). Non-palette colours → ×1.25. */
export function lighter(c: Hex): Hex {
  const l = LIGHTER.get(c);
  if (l !== undefined) return l;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.min(255, Math.round(r * 1.25)) << 16) | (Math.min(255, Math.round(g * 1.25)) << 8) | Math.min(255, Math.round(b * 1.25));
}
