/**
 * Kit palette (ART_BIBLE §2). `PALETTE` is the frozen 25-key subset the `Kit.pal` contract exposes; `PAL` is
 * the full 48-colour master palette (15-bit snapped) by its art-bible name, for modelers who need a precise
 * ramp step; `RAMPS` are the dark→light ramps; `PLAYER_COLORS` the 8 mask/player colours (§8.2).
 * Plus tiny colour helpers (everything is a plain 0xRRGGBB number).
 */
import type { Hex } from '@/core/types';
import type { Palette } from './types';

export const PALETTE: Palette = {
  black: 0x101019,     // P01 PIT_BLACK
  white: 0xf7efde,     // P10 PAPER
  cream: 0xe6dec5,     // P09 IVORY
  bone: 0xc5bda5,      // P08 BONE
  brass: 0x8c6b29,     // P22 BRASS
  gold: 0xc59c42,      // P23 GOLD
  chrome: 0x8c949c,    // P45 CHROME_MID
  steel: 0x4a6b84,     // P36 STEEL_BLUE
  rust: 0x7b3a19,      // P17 RUST
  red: 0x8c1921,       // P13 CASINO_RED
  redDark: 0x5a1019,   // P12 OXBLOOD
  blood: 0x3a0810,     // P11 DRIED_BLOOD
  green: 0x297b4a,     // P30 FELT_LIGHT
  felt: 0x10523a,      // P29 FELT
  feltDark: 0x082919,  // P28 FELT_SHADOW
  blue: 0x3163c5,      // P37 COBALT
  woodDark: 0x311910,  // P25 WALNUT_DARK
  wood: 0x523119,      // P26 WALNUT
  leather: 0x6b3a21,   // P27 MAHOGANY
  carpet: 0x4a193a,    // P41 VELVET
  neonPink: 0xff42a5,  // P43 NEON_MAGENTA
  neonCyan: 0x63e6de,  // P38 CRT_CYAN
  neonYellow: 0xffce5a,// P20 BULB_YELLOW
  glass: 0xbdf7ef,     // P39 ICE
  void: 0x080808,      // P00 VOID
};

/** The full master palette by art-bible name (P00..P47). */
export const PAL = {
  VOID: 0x080808, PIT_BLACK: 0x101019, SOOT: 0x191921, COAL: 0x292131, ASH: 0x3a3a42, SLATE: 0x5a525a,
  CONCRETE: 0x7b736b, GROUT: 0x9c9484, BONE: 0xc5bda5, IVORY: 0xe6dec5, PAPER: 0xf7efde,
  DRIED_BLOOD: 0x3a0810, OXBLOOD: 0x5a1019, CASINO_RED: 0x8c1921, SIGNAL_RED: 0xc52129, CORAL: 0xef5a4a,
  RUST_DEEP: 0x4a2110, RUST: 0x7b3a19, COPPER: 0xad6329, AMBER: 0xe69431, BULB_YELLOW: 0xffce5a,
  BRASS_SHADOW: 0x4a3a19, BRASS: 0x8c6b29, GOLD: 0xc59c42, GOLD_SHINE: 0xefd67b,
  WALNUT_DARK: 0x311910, WALNUT: 0x523119, MAHOGANY: 0x6b3a21,
  FELT_SHADOW: 0x082919, FELT: 0x10523a, FELT_LIGHT: 0x297b4a,
  BILE: 0x8ca53a, VERDIGRIS: 0x428c7b, NEON_GREEN: 0x5aff7b,
  ABYSS_BLUE: 0x101931, DEEP_TEAL: 0x193a42, STEEL_BLUE: 0x4a6b84, COBALT: 0x3163c5, CRT_CYAN: 0x63e6de, ICE: 0xbdf7ef,
  BRUISE: 0x291031, VELVET: 0x4a193a, PLUM: 0x7b295a, NEON_MAGENTA: 0xff42a5,
  GUNMETAL: 0x31313a, CHROME_MID: 0x8c949c, CHROME_HI: 0xd6dee6, CURSE_VIOLET: 0x9c4aff,
} as const;

/** Dark → light ramps (ART_BIBLE §2.2). */
export const RAMPS = {
  GREY: [PAL.VOID, PAL.PIT_BLACK, PAL.SOOT, PAL.COAL, PAL.ASH, PAL.SLATE, PAL.CONCRETE, PAL.GROUT, PAL.BONE, PAL.IVORY, PAL.PAPER],
  BLOOD: [PAL.DRIED_BLOOD, PAL.OXBLOOD, PAL.CASINO_RED, PAL.SIGNAL_RED, PAL.CORAL],
  FIRE: [PAL.RUST_DEEP, PAL.RUST, PAL.COPPER, PAL.AMBER, PAL.BULB_YELLOW],
  BRASS: [PAL.BRASS_SHADOW, PAL.BRASS, PAL.GOLD, PAL.GOLD_SHINE],
  WOOD: [PAL.WALNUT_DARK, PAL.WALNUT, PAL.MAHOGANY, PAL.COPPER],
  FELT: [PAL.FELT_SHADOW, PAL.FELT, PAL.FELT_LIGHT],
  NIGHT: [PAL.ABYSS_BLUE, PAL.DEEP_TEAL, PAL.STEEL_BLUE, PAL.ICE],
  VELVET: [PAL.BRUISE, PAL.VELVET, PAL.PLUM, PAL.NEON_MAGENTA],
  CHROME: [PAL.GUNMETAL, PAL.CHROME_MID, PAL.CHROME_HI, PAL.PAPER],
  PORCELAIN: [PAL.GROUT, PAL.BONE, PAL.IVORY, PAL.PAPER],
} as const satisfies Record<string, readonly Hex[]>;

/** Player / mask colours 1..8 (HARE FOX MOTH TOAD OWL CROW PIG GOAT), ART_BIBLE §8.2. */
export const PLAYER_COLORS: readonly Hex[] = [
  PAL.SIGNAL_RED, PAL.AMBER, PAL.BULB_YELLOW, PAL.BILE, PAL.CRT_CYAN, PAL.COBALT, PAL.NEON_MAGENTA, PAL.IVORY,
];

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const hexR = (c: Hex): number => (c >> 16) & 255;
export const hexG = (c: Hex): number => (c >> 8) & 255;
export const hexB = (c: Hex): number => c & 255;
export const rgbHex = (r: number, g: number, b: number): Hex => (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
/** `#rrggbb` for canvas fill styles. */
export const css = (c: Hex): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
/** Multiply brightness (k<1 darkens, k>1 brightens, clamped). */
export const scaleHex = (c: Hex, k: number): Hex => rgbHex(hexR(c) * k, hexG(c) * k, hexB(c) * k);
/** Linear blend a→b by t. */
export const mixHex = (a: Hex, b: Hex, t: number): Hex =>
  rgbHex(hexR(a) + (hexR(b) - hexR(a)) * t, hexG(a) + (hexG(b) - hexG(a)) * t, hexB(a) + (hexB(b) - hexB(a)) * t);
/** Snap each channel to the 15-bit PSX grid (channel = round(k·255/31)). */
export const snap15 = (c: Hex): Hex => {
  const s = (v: number): number => Math.round(Math.round((v / 255) * 31) * (255 / 31));
  return rgbHex(s(hexR(c)), s(hexG(c)), s(hexB(c)));
};
