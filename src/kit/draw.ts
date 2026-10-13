/**
 * Canvas drawing helpers shared by kit parts — and exported for machine models (7-segment LEDs, CRT
 * colour schemes, text fitting). Pure 2D-canvas code, integer coordinates, no smoothing (ART_BIBLE §3.9).
 */
import type { Hex } from '@/core/types';
import type { FontId, TexGen, TextOpts } from '@/core/texgen/types';

// ── text fitting ────────────────────────────────────────────────────────────────────────────────
export interface FitOpts {
  font?: FontId;
  color?: string;
  bg?: string | null;
  outline?: string | null;
  align?: 'left' | 'center' | 'right';
  pad?: number;
  /** Largest font size / px5 scale tried (default: as large as fits the height). */
  maxSize?: number;
}

/** Draw `str` as large as fits `w`×`h` px, aligned and vertically centred. Returns the used size. */
export function fitText(tex: TexGen, g: CanvasRenderingContext2D, str: string, w: number, h: number, o: FitOpts = {}): number {
  const font = o.font ?? 'ps2p';
  const pad = o.pad ?? 2;
  g.clearRect(0, 0, w, h);
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
  if (!str) return 0;
  const maxW = Math.max(1, w - pad * 2), maxH = Math.max(1, h - pad * 2);
  let opts: TextOpts;
  let textH: number;
  let size: number;
  if (font === 'px5') {
    let s = Math.max(1, Math.min(o.maxSize ?? 99, Math.floor(maxH / 7)));
    while (s > 1 && tex.measure(str, { font, scale: s }) > maxW) s--;
    opts = { font, scale: s }; textH = 7 * s; size = s;
  } else {
    const step = font === 'ps2p' ? 8 : 1;
    let s = Math.max(step, Math.min(o.maxSize ?? 999, Math.floor(maxH / step) * step));
    while (s > step && tex.measure(str, { font, size: s }) > maxW) s -= step;
    opts = { font, size: s }; textH = s; size = s;
  }
  const align = o.align ?? 'center';
  const x = align === 'center' ? Math.round(w / 2) : align === 'left' ? pad : w - pad;
  const y = Math.max(0, Math.round((h - textH) / 2));
  tex.drawText(g, str, x, y, { ...opts, color: o.color ?? '#ffffff', align, outline: o.outline ?? null });
  return size;
}

/** Draw any texture's backing canvas/image into a 2D context (used to compose atlases). Returns false if not drawable. */
export function drawTexInto(g: CanvasRenderingContext2D, t: { image?: unknown }, x: number, y: number, w: number, h: number): boolean {
  const img = t.image as CanvasImageSource | undefined;
  if (!img) return false;
  const ok = (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)
    || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap)
    || (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.complete)
    || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas);
  if (!ok) return false;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, y, w, h);
  return true;
}

// ── CRT schemes (ART_BIBLE §3.9) ────────────────────────────────────────────────────────────────
export interface CrtScheme { bg: string; text: string; dim: string; hi: string }
export const CRT_SCHEMES: Record<'green' | 'amber' | 'cyan' | 'red', CrtScheme> = {
  green: { bg: '#082919', text: '#5aff7b', dim: '#297b4a', hi: '#f7efde' },
  amber: { bg: '#3a0810', text: '#e69431', dim: '#7b3a19', hi: '#ffce5a' },
  cyan: { bg: '#101931', text: '#63e6de', dim: '#4a6b84', hi: '#f7efde' },
  red: { bg: '#3a0810', text: '#c52129', dim: '#5a1019', hi: '#ef5a4a' },
};

/** Darken every odd pixel row (baked CRT scanlines). */
export function scanlines(g: CanvasRenderingContext2D, w: number, h: number, alpha = 0.25): void {
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 1; y < h; y += 2) g.fillRect(0, y, w, 1);
}
/** 1-px rounded inner corners. */
export function crtCorners(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = '#000';
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) g.fillRect(x, y, 1, 1);
}

// ── seven-segment LEDs (ART_BIBLE §3.9) ─────────────────────────────────────────────────────────
const SEG = {
  a: [1, 0, 3, 1], b: [4, 1, 1, 4], c: [4, 6, 1, 4], d: [1, 10, 3, 1], e: [0, 6, 1, 4], f: [0, 1, 1, 4], g: [1, 5, 3, 1],
} as const;
type SegId = keyof typeof SEG;
const GLYPH: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', '-': 'g', E: 'adefg', r: 'eg', o: 'cdeg', P: 'abefg', A: 'abcefg', L: 'def',
  H: 'bcefg', U: 'bcdef', b: 'cdefg', d: 'bcdeg', n: 'ceg', F: 'aefg', C: 'adef', t: 'defg', Y: 'bcdfg', S: 'afgcd', ' ': '',
};
export interface SevenSegOpts { scale?: number; color?: string; ghost?: string | null }
/** Draw `text` (digits, '-', '.', and the letters above) as 7-segment glyphs at (x,y). Returns the width in px. */
export function sevenSeg(g: CanvasRenderingContext2D, text: string, x: number, y: number, o: SevenSegOpts = {}): number {
  const s = o.scale ?? 1;
  const lit = o.color ?? '#ff5a4a';
  let cx = x;
  for (const ch of text) {
    if (ch === '.') {
      g.fillStyle = lit; g.fillRect(cx - s, y + 10 * s, s, s);          // dp sits in the gap of the previous digit
      continue;
    }
    const on = GLYPH[ch] ?? GLYPH[ch.toUpperCase()] ?? '';
    if (o.ghost) {
      g.fillStyle = o.ghost;
      for (const k of Object.keys(SEG) as SegId[]) { const r = SEG[k]; g.fillRect(cx + r[0] * s, y + r[1] * s, r[2] * s, r[3] * s); }
    }
    g.fillStyle = lit;
    for (const k of on) { const r = SEG[k as SegId]; g.fillRect(cx + r[0] * s, y + r[1] * s, r[2] * s, r[3] * s); }
    cx += 6 * s;
  }
  return cx - x;
}
/** Pixel size of `n` seven-segment cells at `scale`. */
export const sevenSegSize = (n: number, scale = 1): [number, number] => [n * 6 * scale, 11 * scale];

// ── neon ────────────────────────────────────────────────────────────────────────────────────────
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Convert a white-on-transparent text mask (alpha) to a neon tube (colour + hot white core, alpha-tested) and a
 * separate dithered halo (for an additive plane behind it). `tube`/`halo` are filled in place.
 */
export function renderNeon(mask: ImageData, tube: ImageData, halo: ImageData, color: Hex): void {
  const w = mask.width, h = mask.height;
  const core = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) core[i] = mask.data[i * 4 + 3] > 127 ? 1 : 0;
  const at = (a: Uint8Array, x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  const dilate = (src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      out[y * w + x] = src[y * w + x] || at(src, x - 1, y) || at(src, x + 1, y) || at(src, x, y - 1) || at(src, x, y + 1) ? 1 : 0;
    }
    return out;
  };
  const tubeM = dilate(core);
  const d1 = dilate(tubeM), d2 = dilate(d1), d3 = dilate(d2);
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    // tube
    if (tubeM[i]) {
      const hot = core[i] && at(core, x - 1, y) && at(core, x + 1, y) && at(core, x, y - 1) && at(core, x, y + 1);
      tube.data[p] = hot ? 247 : r; tube.data[p + 1] = hot ? 239 : g; tube.data[p + 2] = hot ? 222 : b; tube.data[p + 3] = 255;
    } else tube.data[p + 3] = 0;
    // halo (Bayer 12/16, 8/16, 4/16 at 1/2/3 px out)
    let lvl = 0;
    if (tubeM[i]) lvl = 16; else if (d1[i]) lvl = 12; else if (d2[i]) lvl = 8; else if (d3[i]) lvl = 4;
    halo.data[p] = r; halo.data[p + 1] = g; halo.data[p + 2] = b;
    halo.data[p + 3] = lvl > BAYER4[(x & 3) + ((y & 3) << 2)] ? 255 : 0;
  }
}

// ── misc patterns ───────────────────────────────────────────────────────────────────────────────
/** Soft stepped radial glow, 4 brightness levels (PSX banding), white — tinted by the material. */
export function paintGlow(g: CanvasRenderingContext2D, s: number): void {
  const c = (s - 1) / 2;
  const id = g.createImageData(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - c, y - c) / (s / 2);
    const k = d >= 1 ? 0 : Math.floor((1 - d) * 4) / 4;
    const p = (y * s + x) * 4;
    id.data[p] = id.data[p + 1] = id.data[p + 2] = 255; id.data[p + 3] = Math.round(255 * k * k);
  }
  g.putImageData(id, 0, 0);
}

