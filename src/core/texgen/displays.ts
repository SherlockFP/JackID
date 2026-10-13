/**
 * Signage and LED displays (ART_BIBLE §3.9): neon tubes with a dithered halo, seven-segment readouts, dot-matrix
 * marquees and the CRT screen base. Owner: CORE-TEXGEN. Pure pixel builders; the `*Tex` helpers wrap them.
 *
 * Static signs are cached by their arguments. Dynamic ones (the marquee scroll, CRT content) return a fresh
 * texture per call, so callers that redraw every frame should keep one texture and re-paint its canvas instead.
 */
import type * as THREE from 'three';
import type { Hex } from '../types';
import { P01, P02, P10, P11, P12, P14, P15, P16, P17, P19, P20, P28, P30, P33, P34, P35, P36, P38 } from './palette';
import { bayer, css, finishTexture, makeCanvas, mix, Pix, pixTexture } from './pixel';
import { letterRanges, textMask } from './font';
import type { FontId } from './types';

const clamp = { wrap: 'clamp' as const };
const statics = new Map<string, unknown>();
function once<V>(key: string, make: () => V): V {
  let v = statics.get(key) as V | undefined;
  if (v === undefined) { v = make(); statics.set(key, v); }
  return v;
}

/** Glyph coverage of `text` as a 1-bit grid; (ox, oy) is where the text origin sits inside that grid. */
function coverage(text: string, font: FontId, px: number): { cov: Uint8Array; w: number; h: number; ox: number; oy: number } {
  const { cv, ox, oy } = textMask(text, { font, size: px, scale: px });
  const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, cv.width, cv.height).data;
  const cov = new Uint8Array(cv.width * cv.height);
  for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  return { cov, w: cv.width, h: cv.height, ox, oy };
}

/** Chebyshev distance to the glyph: 0 inside, 1..maxD outside, maxD + 1 beyond the halo. */
function distanceField(cov: Uint8Array, w: number, h: number, maxD: number): Uint8Array {
  const far = maxD + 1;
  let d = new Uint8Array(w * h).fill(far);
  for (let i = 0; i < d.length; i++) if (cov[i]) d[i] = 0;
  for (let k = 1; k <= maxD; k++) {
    const next = d.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] !== far) continue;
      search: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && d[ny * w + nx] === k - 1) { next[i] = k; break search; }
      }
    }
    d = next;
  }
  return d;
}

// ── neon ──────────────────────────────────────────────────────────────────────────────────────────

export interface NeonOpts {
  font?: FontId;
  /** Font size; for `px5` the integer pixel scale. Default 16 (ps2p) / 24 (vt) / 2 (px5): strokes thinner than that merge into their own aura. */
  px?: number;
  color: Hex;
}
export interface NeonSign {
  /** Tube (1 px ring in `color`, P10 hot core), cut-out alpha. */
  tex: THREE.CanvasTexture;
  /** Dithered glow plane (ADD) of the same size, placed about 0.02 m behind the tube. */
  halo: THREE.CanvasTexture;
  w: number;
  h: number;
  /** x-ranges [x0, x1) of each glyph in texture px (at most 16), for per-letter flicker. */
  letters: Array<[number, number]>;
}
const NEON_PAD = 3;

/**
 * Neon sign (ART_BIBLE §3.9): the glyph mask dilated by 1 px is the tube. The glyph itself is the hot P10 core: on
 * strokes thick enough to have an interior only the interior is hot and the edge keeps the neon colour; thin strokes
 * (Press Start 2P at 8 px, px5) are hot all the way, so letters stay readable inside their 1 px coloured aura. The
 * halo covers 1–3 px outside the glyph at Bayer 12/16, 8/16, 4/16. Both textures carry a 3 px transparent border.
 * `px` is the font size, or the integer pixel scale for `px5`.
 */
export function neonSign(text: string, o: NeonOpts): NeonSign {
  const font = o.font ?? 'ps2p', px = o.px ?? (font === 'ps2p' ? 16 : font === 'vt' ? 24 : 2), c = o.color;
  return once(`neon:${font}:${px}:${c}:${text}`, (): NeonSign => {
    const src = coverage(text, font, px);
    const P = NEON_PAD, W = src.w + 2 * P, H = src.h + 2 * P;
    const cov = new Uint8Array(W * H);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) cov[(y + P) * W + x + P] = src.cov[y * src.w + x];
    const dist = distanceField(cov, W, H, P);
    const tube = new Pix(W, H), halo = new Pix(W, H);
    const glyph = (i: number): boolean => dist[i] === 0;
    const interior = (i: number): boolean => glyph(i) && glyph(i - 1) && glyph(i + 1) && glyph(i - W) && glyph(i + W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, k = dist[i];
      if (k === 0) {
        // thick strokes: coloured edge around a P10 core; thin strokes (no interior nearby) are all hot core
        let hot = interior(i);
        if (!hot) {
          hot = true;
          for (let dy = -1; dy <= 1 && hot; dy++) for (let dx = -1; dx <= 1; dx++) if (interior(i + dy * W + dx)) { hot = false; break; }
        }
        tube.px(x, y, hot ? P10 : c);
      } else if (k === 1) tube.px(x, y, c);
      if (k >= 1 && k <= P && bayer(x, y) < 16 - 4 * k) halo.px(x, y, c);
    }
    const letters = letterRanges(text, { font, size: px, scale: px })
      .slice(0, 16)
      .map(([a, b]): [number, number] => [P + src.ox + a, P + src.ox + b]);
    return { tex: pixTexture(tube, clamp, true), halo: pixTexture(halo, clamp, true), w: W, h: H, letters };
  });
}

// ── seven-segment ─────────────────────────────────────────────────────────────────────────────────

type Seg = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
const SEGS: readonly Seg[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
/** Segment boxes [x, y, w, h] inside a 5 × 11 digit box (ART_BIBLE §3.9). */
const SEG: Record<Seg, [number, number, number, number]> = {
  a: [1, 0, 3, 1], b: [4, 1, 1, 4], c: [4, 6, 1, 4], d: [1, 10, 3, 1], e: [0, 6, 1, 4], f: [0, 1, 1, 4], g: [1, 5, 3, 1],
};
const SEG_OF: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', '-': 'g', E: 'adefg', r: 'eg', o: 'cdeg', P: 'abefg', A: 'abcefg', L: 'def',
  H: 'bcefg', U: 'bcdef', b: 'cdefg', d: 'bcdeg', n: 'ceg', F: 'aefg', C: 'adef', t: 'defg', Y: 'bcdfg', S: 'afgcd',
};
/** Unlit "ghost" segment colour for each lit colour (other colours get a dark mix). */
const GHOST: Record<number, Hex> = { [P14]: P12, [P19]: P16, [P33]: P28, [P38]: P35 };

/**
 * Seven-segment readout: `digits` cells of 6 × 13 px (5 px glyph + gap), right-aligned. A '.' lights the decimal
 * point of the cell before it. `scale` is an integer pixel multiplier (the Debt Terminal uses 2).
 */
export function sevenSegPix(text: string, digits: number, color: Hex, scale = 1): Pix {
  const cells: Array<{ ch: string; dp: boolean }> = [];
  for (const ch of text) {
    if (ch === '.' && cells.length) cells[cells.length - 1].dp = true;
    else cells.push({ ch, dp: false });
  }
  const shown = cells.slice(-digits);
  while (shown.length < digits) shown.unshift({ ch: ' ', dp: false });
  const W = 6 * digits + 1, H = 13;
  const p = new Pix(W, H).rect(0, 0, W, H, P01);
  const ghost = GHOST[color] ?? mix(color, P01, 0.85);
  shown.forEach(({ ch, dp }, i) => {
    const lit = SEG_OF[ch] ?? '', x0 = 1 + 6 * i;
    for (const s of SEGS) {
      const [x, y, w, h] = SEG[s];
      p.rect(x0 + x, 1 + y, w, h, lit.includes(s) ? color : ghost);
    }
    p.px(x0 + 5, 11, dp ? color : ghost);
  });
  return scale > 1 ? p.resized(W * scale, H * scale) : p;
}
/**
 * Odometer roll between two readouts (ART_BIBLE §3.9): in every cell whose character differs, the old glyph slides up
 * and out while the new one slides in from below. `t` 0 → `from`, 1 → `to` (the art bible rolls one step per 0.05 s).
 * Unchanged cells stay put. Repaint a texture's canvas with the result each frame (`Pix.paintInto`).
 */
export function sevenSegRollPix(from: string, to: string, digits: number, color: Hex, t: number, scale = 1): Pix {
  const A = sevenSegPix(from, digits, color, 1), B = sevenSegPix(to, digits, color, 1), out = A.clone();
  const k = Math.round(Math.max(0, Math.min(1, t)) * 13);
  for (let i = 0; i < digits; i++) {
    const x0 = 6 * i + 1;
    for (let y = 0; y < 13; y++) {
      const src = y + k < 13 ? A : B, sy = y + k < 13 ? y + k : y + k - 13;
      for (let x = x0; x < x0 + 6; x++) out.d[y * out.w + x] = src.d[sy * src.w + x];
    }
  }
  return scale > 1 ? out.resized(out.w * scale, out.h * scale) : out;
}
/** Cached seven-segment texture for a static readout (`sevenSegPix` builds the pixels). */
export const sevenSegTex = (text: string, digits: number, color: Hex, scale = 1): THREE.CanvasTexture =>
  once(`seg:${text}:${digits}:${color}:${scale}`, () => pixTexture(sevenSegPix(text, digits, color, scale), clamp, true));

// ── dot-matrix ────────────────────────────────────────────────────────────────────────────────────

/**
 * Dot-matrix marquee: `cols` cells, each 8 × 8 Press Start 2P dots on a 2 px pitch (a cell is 16 × 16 px). Unlit
 * dots are P02 on a P01 panel. `scroll` (px) moves the text in from the right; it is rounded down to whole dots.
 */
export function dotMatrixPix(text: string, o: { cols: number; color: Hex; scroll?: number }): Pix {
  const { cov, w, h, ox, oy } = coverage(text, 'ps2p', 8);
  const cols = Math.max(1, o.cols), dots = cols * 8;
  const shift = Math.floor((o.scroll ?? 0) / 2);      // one mask column = one dot = 2 px
  const p = new Pix(dots * 2, 16).rect(0, 0, dots * 2, 16, P01);
  for (let j = 0; j < 8; j++) for (let i = 0; i < dots; i++) {
    const tx = i + shift - dots, mx = ox + tx, my = oy + j;
    const lit = mx >= 0 && my >= 0 && mx < w && my < h && cov[my * w + mx] === 1;
    p.px(2 * i, 2 * j, lit ? o.color : P02);
  }
  return p;
}
export const dotMatrixTex = (text: string, o: { cols: number; color: Hex; scroll?: number }): THREE.CanvasTexture =>
  pixTexture(dotMatrixPix(text, o), clamp, false);

// ── CRT screen ────────────────────────────────────────────────────────────────────────────────────

export type CrtScheme = 'green' | 'amber' | 'cyan' | 'red';
export interface CrtColors { bg: Hex; text: Hex; dim: Hex; hi: Hex }
export const CRT_COLORS: Record<CrtScheme, CrtColors> = {
  green: { bg: P28, text: P33, dim: P30, hi: P10 },
  amber: { bg: P11, text: P19, dim: P17, hi: P20 },
  cyan: { bg: P34, text: P38, dim: P36, hi: P10 },
  red: { bg: P11, text: P14, dim: P12, hi: P15 },
};

/**
 * CRT screen canvas (ART_BIBLE §3.9): the scheme background, then `draw` for the content, then baked scanlines
 * (every odd row darkened by 25 %) and black inner corners. Wrap the result with `crtTexture`.
 */
export function crtScreen(w: number, h: number, scheme: CrtScheme,
  draw?: (g: CanvasRenderingContext2D, colors: CrtColors) => void): HTMLCanvasElement {
  const colors = CRT_COLORS[scheme];
  const [cv, g] = makeCanvas(w, h);
  g.fillStyle = css(colors.bg);
  g.fillRect(0, 0, w, h);
  draw?.(g, colors);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 1; y < h; y += 2) g.fillRect(0, y, w, 1);
  g.fillStyle = '#000';
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) g.fillRect(x, y, 1, 1);
  return cv;
}
export const crtTexture = (cv: HTMLCanvasElement): THREE.CanvasTexture => finishTexture(cv, clamp, false);

/**
 * One frame of the CRT power-on animation (ART_BIBLE §3.9), drawn into `g` (a w × h canvas): `k` 0 → dark, then a dot
 * (to 0.1), a horizontal line expanding to full width (to 0.4), then the picture `src` opening vertically (to 1).
 * Play it backwards for power-off. The caller repaints the screen texture's canvas each frame while `k` changes.
 */
export function crtPowerFrame(g: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, k: number): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  if (k <= 0) return;
  const hot = css(P10), mid = css(P38), cy = Math.floor(h / 2);
  if (k < 0.4) {
    const len = k < 0.1 ? 2 + Math.round(2 * (k / 0.1)) : Math.round(4 + (w - 4) * ((k - 0.1) / 0.3));
    const x = Math.floor((w - len) / 2);
    g.fillStyle = mid; g.fillRect(x - 1, cy - 1, len + 2, 3);
    g.fillStyle = hot; g.fillRect(x, cy, len, 1);
    return;
  }
  const open = Math.max(3, Math.round(h * ((k - 0.4) / 0.6))), y = Math.floor((h - open) / 2);
  g.save();
  g.beginPath(); g.rect(0, y, w, open); g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, w, h);
  g.restore();
  if (k < 1) {                                                   // white-hot edges that cool as the picture opens
    g.fillStyle = k < 0.8 ? hot : mid;
    g.fillRect(0, y, w, 1); g.fillRect(0, y + open - 1, w, 1);
  }
}
