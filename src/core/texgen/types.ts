/**
 * Texture generator interface — TD-FROZEN. Implementation: CORE-TEXGEN (`texgen.ts`, `patterns.ts`,
 * `font.ts`, `symbols.ts`, `cards.ts`). Contract: TECH_SPEC §2.4, ART_BIBLE §3, ASSETS.md.
 *
 * Canvas rules: `imageSmoothingEnabled = false`; integer coordinates; fonts are drawn at native size
 * then alpha-thresholded (no anti-aliased grey edges). All textures: NearestFilter, no mipmaps,
 * `NoColorSpace`; cached ones carry `userData.shared = true` and are never disposed by callers.
 */
import type * as THREE from 'three';
import type { Hex } from '../types';

export type SymbolId = string;   // registered painters; default set below (art bible may add)
export type FontId = 'px5' | 'vt' | 'ps2p';   // built-in 5×7 bitmap | VT323 | Press Start 2P

export interface TexOpts {
  wrap?: 'repeat' | 'clamp';      // default 'repeat'
  repeat?: [number, number];      // default [1,1]
  key?: string;                   // cache key: same key ⇒ same shared texture (userData.shared=true)
}

export interface TextOpts {
  font?: FontId; size?: number;   // px (px5 ignores size; scale via integer `scale`)
  scale?: number;                 // integer pixel scale for px5, default 1
  color?: string; bg?: string | null; align?: 'left' | 'center' | 'right';
  outline?: string | null;        // 1-px outline colour
}

/** Where vendor (CC0) files live. Paths passed to `vendor()` are relative to this root. */
export const VENDOR_ROOT = '/assets/vendor/';

/** Options of `TexGen.vendor()` — every vendor file goes through the PSX pipeline (ASSETS.md "Usage rules"). */
export interface VendorTexOpts extends TexOpts {
  /** Downscale target (square). Default 64; use 32 for small props. Never above 128. */
  size?: 16 | 32 | 64 | 128;
  /** Quantize each channel to this many levels (default 32 = 5-bit PSX). 0 = no quantize. */
  quantize?: number;
  /** Multiply-tint applied before quantize (e.g. blood-red the horror bricks). */
  tint?: Hex;
  /** 0..1 darken (grime without a second texture). */
  darken?: number;
  /** Mirror/flip to hide repetition. */
  flipX?: boolean; flipY?: boolean;
}

export interface TexGen {
  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
         o?: TexOpts): THREE.CanvasTexture;
  // patterns (16–64 px, seeded, cached by args)
  solid(c: Hex): THREE.Texture;
  noise(c: Hex, o?: { size?: number; amount?: number; seed?: number }): THREE.Texture;
  felt(c: Hex): THREE.Texture;          wood(c: Hex, o?: { grain?: number }): THREE.Texture;
  metal(c: Hex, o?: { brushed?: boolean }): THREE.Texture;   chrome(): THREE.Texture;
  carpet(pattern: 'diamond' | 'swirl' | 'stars' | 'teeth', colors: Hex[]): THREE.Texture;
  tiles(c1: Hex, c2: Hex, n?: number): THREE.Texture;  brick(c: Hex): THREE.Texture;
  concrete(c: Hex): THREE.Texture;  rust(c: Hex): THREE.Texture;  grime(amount: number): THREE.Texture;
  stripes(colors: Hex[], dir?: 'h' | 'v' | 'd'): THREE.Texture;  checker(c1: Hex, c2: Hex, n?: number): THREE.Texture;
  gradient(stops: Array<[number, Hex]>, dir?: 'h' | 'v' | 'radial'): THREE.Texture;
  // text & glyphs
  drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o?: TextOpts): number; // returns width
  measure(text: string, o?: TextOpts): number;
  text(text: string, o: TextOpts & { w: number; h: number }): THREE.CanvasTexture;  // alpha thresholded at 0.5
  // gambling atlases (shared, cached)
  symbol(id: SymbolId, size?: 16 | 24 | 32 | 48): THREE.Texture;
  symbolStrip(ids: SymbolId[], cell?: number): { tex: THREE.Texture; cellV: number };   // vertical reel strip
  registerSymbol(id: SymbolId, paint: (g: CanvasRenderingContext2D, s: number) => void): void;
  cardAtlas(): { tex: THREE.Texture; uv(card: CardId | 'back'): [u0: number, v0: number, u1: number, v1: number] };
  dieFace(n: 1 | 2 | 3 | 4 | 5 | 6, o?: { body?: Hex; pip?: Hex }): THREE.Texture;
  chipTop(value: number): THREE.Texture;             // 32×32
  wheelFace(segments: Array<{ label: string; color: Hex }>, size?: 128 | 256): THREE.Texture;
  // ── vendor (CC0) textures ─────────────────────────────────────────────────────────────────────
  /**
   * Synchronous handle to a vendor PNG (e.g. `'sbs-horror/128x128/Wall/Horror_Wall_01-128x128.png'`,
   * relative to {@link VENDOR_ROOT}). Returns a cached shared `CanvasTexture` of `size`×`size`, flat
   * average grey until the image has decoded, then redrawn in place (`needsUpdate`) — callers never
   * await. Downscaled with nearest sampling, quantized, tinted per `o`. Same path+opts ⇒ same texture.
   */
  vendor(path: string, o?: VendorTexOpts): THREE.Texture;
  /** Preload + decode a batch (boot step 9 / menu build) so the first frame has no pop-in. */
  preloadVendor(paths: string[]): Promise<void>;
  warm(): Promise<void>;
}
export type CardId = `${'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'T'|'J'|'Q'|'K'}${'S'|'H'|'D'|'C'}` | 'JK';

/**
 * Default `SymbolId`s (original painters; final set from art bible):
 * cherry plum grape melon bell bar bar2 bar3 seven diamond star horseshoe crown coin key eye skull
 * tooth moon bolt candle rat bone heart spade club dia wild jackpot blank.
 * Forbidden: four-leaf clover, treasure chest, any CloverPit glyph.
 * Icon painters for UI (buffs, charms, totems, upgrades, currencies) are registered under `icon.<id>`.
 */
export const DEFAULT_SYMBOLS: readonly SymbolId[] = [
  'cherry', 'plum', 'grape', 'melon', 'bell', 'bar', 'bar2', 'bar3', 'seven', 'diamond', 'star', 'horseshoe',
  'crown', 'coin', 'key', 'eye', 'skull', 'tooth', 'moon', 'bolt', 'candle', 'rat', 'bone', 'heart', 'spade',
  'club', 'dia', 'wild', 'jackpot', 'blank',
];
