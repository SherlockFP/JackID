/**
 * Pixel toolbox shared by every texgen painter (ART_BIBLE §3.1): the `Pix` RGBA bitmap with the doc's
 * primitives (rect/disc/ring/ellipse/line/poly/outline/shadow/ditherFill), Bayer dither, deterministic
 * periodic value noise (tileable textures), colour helpers, ramps and the canvas → `THREE.CanvasTexture`
 * finisher. Owner: CORE-TEXGEN.
 *
 * Rules: integer coordinates, binary alpha (cut-out), no anti-aliasing anywhere. A colour argument is a
 * `Hex` (0xRRGGBB); `T` (-1) means transparent / erase.
 */
import * as THREE from 'three';
import type { Hex } from '../types';
import type { TexOpts } from './types';
import { RAMP, darker as darkerStep } from './palette';

/** Transparent / erase marker accepted by every `Pix` drawing call. */
export const T = -1;

// ── colour helpers ───────────────────────────────────────────────────────────────────────────────
export const css = (c: Hex): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const rgbOf = (c: Hex): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
export const fromRgb = (r: number, g: number, b: number): Hex => (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);

/** Snap to the 15-bit grid (5 bits per channel, ART_BIBLE §0 "Colour references"). */
export function snap15(c: Hex): Hex {
  const s = (v: number): number => Math.round(Math.round((v * 31) / 255) * (255 / 31));
  return (s((c >> 16) & 255) << 16) | (s((c >> 8) & 255) << 8) | s(c & 255);
}
export function mix(a: Hex, b: Hex, t: number): Hex {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  return fromRgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
/** Multiply every channel (f < 1 darkens, f > 1 brightens). */
export function scaleC(c: Hex, f: number): Hex {
  const [r, g, b] = rgbOf(c);
  return fromRgb(r * f, g * f, b * f);
}
export const lighten = (c: Hex, t: number): Hex => mix(c, 0xf7efde, t);
export const darken = (c: Hex, t: number): Hex => mix(c, 0x101019, t);

const KNOWN_RAMPS: readonly (readonly Hex[])[] = [RAMP.BRASS, RAMP.WOOD, RAMP.FELT, RAMP.BLOOD, RAMP.FIRE, RAMP.VELVET, RAMP.NIGHT, RAMP.GUNMETAL, RAMP.CHROME, RAMP.PORCELAIN, RAMP.GREY];
const rampCache = new Map<string, Hex[]>();

/**
 * `n` shades (dark → light) built around `c` (which lands at index `bi`, default 1 — or 2 for n ≥ 5). When `c` sits in one of the palette ramps (§2.2) the
 * neighbouring palette entries are returned so the result stays palette-pure; otherwise the ramp is
 * derived (darker steps mix toward PIT_BLACK, lighter steps toward PAPER) and snapped to 15 bits.
 */
export function rampFor(c: Hex, n = 3, bi: number = n >= 5 ? 2 : 1): Hex[] {
  const key = `${c}:${n}:${bi}`;
  const hit = rampCache.get(key);
  if (hit) return hit.slice();                           // `bi` = index of `c` inside the result
  let out: Hex[] | null = null;
  // the ramp holding `c` that needs the least padding (0 when it fits as is); c lands at index `bi` of the result
  let best: readonly Hex[] | null = null, bestI = 0, bestPad = Infinity;
  for (const r of KNOWN_RAMPS) {
    const i = r.indexOf(c);
    if (i < 0) continue;
    const pad = Math.max(0, bi - i) + Math.max(0, i - bi + n - r.length);
    if (pad < bestPad) { best = r; bestI = i; bestPad = pad; }
  }
  if (best) {
    out = [];
    for (let k = 0; k < n; k++) {
      const idx = bestI - bi + k;
      let v: Hex;
      if (idx < 0) { v = best[0]; for (let st = idx; st < 0; st++) v = darkerStep(v); }       // below the ramp: "darker" LUT
      else if (idx >= best.length) v = best[best.length - 1];                                    // above it: repeat the ramp top
      else v = best[idx];
      out.push(v);
    }
  }
  if (!out) {
    out = [];
    for (let k = 0; k < n; k++) {
      if (k === bi) out.push(snap15(c));
      else if (k < bi) out.push(snap15(darken(c, (0.62 * (bi - k)) / Math.max(1, bi))));
      else out.push(snap15(lighten(c, (0.42 * (k - bi)) / Math.max(1, n - 1 - bi))));
    }
  }
  rampCache.set(key, out);
  return out.slice();
}

// ── dither & noise ───────────────────────────────────────────────────────────────────────────────
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** 4×4 Bayer threshold 0..15 at (x, y). */
export const bayer = (x: number, y: number): number => BAYER4[((y & 3) << 2) | (x & 3)];

/** Stable hash → [0,1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise whose lattice repeats every (px, py) cells → tileable. */
export function vnoiseP(x: number, y: number, px: number, py: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = smooth(x - x0), sy = smooth(y - y0);
  const ax = mod(x0, px), bx = mod(x0 + 1, px), ay = mod(y0, py), by = mod(y0 + 1, py);
  const a = hash2(ax, ay, seed), b = hash2(bx, ay, seed), c = hash2(ax, by, seed), d = hash2(bx, by, seed);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}
/**
 * Fractal noise over tile coordinates u,v ∈ [0,1): `cx × cy` lattice cells at the base octave, doubling per
 * octave, so the result tiles seamlessly. Returns ~[0,1].
 */
export function fbm(u: number, v: number, cx: number, cy: number, oct: number, seed: number): number {
  let amp = 0.5, sum = 0, norm = 0, px = cx, py = cy;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoiseP(u * px, v * py, px, py, seed + o * 101);
    norm += amp; amp *= 0.5; px *= 2; py *= 2;
  }
  return sum / norm;
}
/** `ramp[clamp(floor(v·(n−1) + Bayer/16), 0, n−1)]`, an ordered-dithered gradient (ART_BIBLE §3.1). */
export function rampDither(v: number, ramp: readonly Hex[], x: number, y: number): Hex {
  const n = ramp.length;
  const i = Math.floor(v * (n - 1) + bayer(x, y) / 16);
  return ramp[i < 0 ? 0 : i > n - 1 ? n - 1 : i];
}

// ── Pix bitmap ───────────────────────────────────────────────────────────────────────────────────
const packC = (c: number): number => (c < 0 ? 0 : (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0);
const unpackC = (u: number): number => (u >>> 24 === 0 ? T : ((u & 0xff) << 16) | (u & 0xff00) | ((u >>> 16) & 0xff));

/** RGBA bitmap with the ART_BIBLE §3.1 primitives. All drawing clips silently. */
export class Pix {
  readonly d: Uint32Array;
  constructor(readonly w: number, readonly h: number) { this.d = new Uint32Array(w * h); }

  clone(): Pix { const p = new Pix(this.w, this.h); p.d.set(this.d); return p; }
  clear(c: number = T): this { this.d.fill(packC(c)); return this; }
  /** Colour at (x, y) or `T` when transparent / outside. */
  get(x: number, y: number): number {
    x = Math.floor(x); y = Math.floor(y);
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? T : unpackC(this.d[y * this.w + x]);
  }
  opaque(x: number, y: number): boolean {
    x = Math.floor(x); y = Math.floor(y);
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] >>> 24 !== 0;
  }
  px(x: number, y: number, c: number): this {
    x = Math.floor(x); y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = packC(c);
    return this;
  }
  /** Set with toroidal wrap (tileable textures). */
  pxw(x: number, y: number, c: number): this {
    this.d[mod(Math.floor(y), this.h) * this.w + mod(Math.floor(x), this.w)] = packC(c);
    return this;
  }
  getw(x: number, y: number): number { return unpackC(this.d[mod(Math.floor(y), this.h) * this.w + mod(Math.floor(x), this.w)]); }

  rect(x: number, y: number, w: number, h: number, c: number): this {
    const v = packC(c);
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x) + Math.floor(w)), y1 = Math.min(this.h, Math.floor(y) + Math.floor(h));
    for (let yy = y0; yy < y1; yy++) { const o = yy * this.w; for (let xx = x0; xx < x1; xx++) this.d[o + xx] = v; }
    return this;
  }
  frame(x: number, y: number, w: number, h: number, c: number): this {
    return this.rect(x, y, w, 1, c).rect(x, y + h - 1, w, 1, c).rect(x, y, 1, h, c).rect(x + w - 1, y, 1, h, c);
  }
  /** Run `fn(x, y)` for each pixel of the bounding box; a non-negative return fills it. */
  private shape(x0: number, y0: number, x1: number, y1: number, test: (cx: number, cy: number) => boolean, c: number): this {
    const v = packC(c);
    const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
    const bx = Math.min(this.w - 1, Math.ceil(x1)), by = Math.min(this.h - 1, Math.ceil(y1));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (test(x + 0.5, y + 0.5)) this.d[y * this.w + x] = v;
    return this;
  }
  /** Filled if (x+0.5−cx)² + (y+0.5−cy)² ≤ r². */
  disc(cx: number, cy: number, r: number, c: number): this {
    return this.shape(cx - r, cy - r, cx + r, cy + r, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, c);
  }
  /** Pixels with r0² < d² ≤ r1². */
  ring(cx: number, cy: number, r0: number, r1: number, c: number): this {
    return this.shape(cx - r1, cy - r1, cx + r1, cy + r1, (x, y) => {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      return d > r0 * r0 && d <= r1 * r1;
    }, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): this {
    return this.shape(cx - rx, cy - ry, cx + rx, cy + ry, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c);
  }
  /** Bresenham, 1 px. */
  line(x0: number, y0: number, x1: number, y1: number, c: number): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  /** Even-odd scanline fill sampled at pixel centres. */
  poly(pts: ReadonlyArray<readonly [number, number]>, c: number): this {
    const v = packC(c), n = pts.length;
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] - 0.5)), xb = Math.min(this.w - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
        for (let x = xa; x <= xb; x++) this.d[y * this.w + x] = v;
      }
    }
    return this;
  }
  /** Stamp a bitmap given as rows of '#' / '1' (ink) — optionally scaled and rotated 180°. */
  bits(rows: readonly string[], x: number, y: number, c: number, scale = 1, rot180 = false): this {
    const h = rows.length;
    for (let r = 0; r < h; r++) {
      const row = rows[r];
      for (let k = 0; k < row.length; k++) {
        if (row[k] !== '#' && row[k] !== '1') continue;
        const cx = rot180 ? row.length - 1 - k : k, cy = rot180 ? h - 1 - r : r;
        this.rect(x + cx * scale, y + cy * scale, scale, scale, c);
      }
    }
    return this;
  }
  /** Colour every transparent pixel that 4-neighbours an opaque one. */
  outline(c: number): this {
    const v = packC(c), { w, h, d } = this, src = d.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] >>> 24 !== 0) continue;
      if ((x > 0 && src[i - 1] >>> 24) || (x < w - 1 && src[i + 1] >>> 24) || (y > 0 && src[i - w] >>> 24) || (y < h - 1 && src[i + w] >>> 24)) d[i] = v;
    }
    return this;
  }
  /** Drop shadow of the current shape, dithered at Bayer `level`/16, only on transparent pixels. */
  shadow(dx: number, dy: number, c: number, level: number): this {
    const v = packC(c), { w, h, d } = this, src = d.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x] >>> 24 === 0) continue;
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const j = ty * w + tx;
      if (src[j] >>> 24 === 0 && bayer(tx, ty) < level) d[j] = v;
    }
    return this;
  }
  /** pixel = cB where Bayer(x,y) < level (0..16), else cA. `cA` of `undefined` leaves the pixel untouched. */
  ditherFill(x: number, y: number, w: number, h: number, cA: number | undefined, cB: number, level: number): this {
    for (let yy = Math.floor(y); yy < y + h; yy++) for (let xx = Math.floor(x); xx < x + w; xx++) {
      if (bayer(xx, yy) < level) this.px(xx, yy, cB); else if (cA !== undefined) this.px(xx, yy, cA);
    }
    return this;
  }
  /** Replace colour `from` with `to` (T allowed for either). */
  replace(from: number, to: number): this {
    const a = packC(from), b = packC(to);
    for (let i = 0; i < this.d.length; i++) if (this.d[i] === a) this.d[i] = b;
    return this;
  }
  /** `fn(x, y, current)` → new colour, or `undefined` to keep. */
  map(fn: (x: number, y: number, c: number) => number | undefined): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const r = fn(x, y, unpackC(this.d[y * this.w + x]));
      if (r !== undefined) this.d[y * this.w + x] = packC(r);
    }
    return this;
  }
  /** Copy the opaque pixels of `src` (or its sub-rect) to (dx, dy). */
  blit(src: Pix, dx: number, dy: number, sx = 0, sy = 0, sw = src.w, sh = src.h): this {
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const u = src.d[(sy + y) * src.w + sx + x];
      if (u >>> 24 === 0) continue;
      const tx = dx + x, ty = dy + y;
      if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.d[ty * this.w + tx] = u;
    }
    return this;
  }
  /** Copy region (sx,sy,w,h) rotated 180° to (dx,dy). Opaque pixels only. */
  blitRot180(src: Pix, sx: number, sy: number, w: number, h: number, dx: number, dy: number): this {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = src.d[(sy + y) * src.w + sx + x];
      if (u >>> 24 === 0) continue;
      this.px(dx + (w - 1 - x), dy + (h - 1 - y), unpackC(u));
    }
    return this;
  }
  /** Mirror the left half onto the right half about the vertical axis x = w/2. */
  mirrorX(): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w >> 1; x++) {
      const u = this.d[y * this.w + x];
      if (u >>> 24) this.d[y * this.w + (this.w - 1 - x)] = u;
    }
    return this;
  }
  /** Nearest-neighbour resample to (nw, nh); downscaling keeps the most frequent colour of each source block. */
  resized(nw: number, nh: number): Pix {
    if (nw === this.w && nh === this.h) return this.clone();
    const out = new Pix(nw, nh);
    if (nw >= this.w && nh >= this.h) {
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out.d[y * nw + x] = this.d[Math.floor((y * this.h) / nh) * this.w + Math.floor((x * this.w) / nw)];
      return out;
    }
    const counts = new Map<number, number>();
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const xa = Math.floor((x * this.w) / nw), xb = Math.max(xa + 1, Math.floor(((x + 1) * this.w) / nw));
      const ya = Math.floor((y * this.h) / nh), yb = Math.max(ya + 1, Math.floor(((y + 1) * this.h) / nh));
      counts.clear();
      let solid = 0, best = 0, bestN = 0;
      for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) {
        const u = this.d[yy * this.w + xx];
        if (u >>> 24 === 0) continue;
        solid++;
        const n = (counts.get(u) ?? 0) + 1;
        counts.set(u, n);
        if (n > bestN || (n === bestN && lumOf(u) < lumOf(best))) { best = u; bestN = n; }   // ties → darker (keeps outlines)
      }
      if (solid * 2 >= (xb - xa) * (yb - ya)) out.d[y * nw + x] = best;
    }
    return out;
  }
  /**
   * Vertical motion-blur smear (ART_BIBLE §3.6): each pixel becomes the most frequent opaque colour among the `n`
   * pixels from itself up to `n−1` rows above (wrapping, so a drum strip smears across its seam). Palette-pure.
   */
  smearDown(n: number): Pix {
    const { w, h, d } = this, out = new Pix(w, h), counts = new Map<number, number>();
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      counts.clear();
      let best = 0, bestN = 0;
      for (let k = 0; k < n; k++) {
        const u = d[(((y - k) % h + h) % h) * w + x];
        if (u >>> 24 === 0) continue;
        const c = (counts.get(u) ?? 0) + 1;
        counts.set(u, c);
        if (c > bestN) { best = u; bestN = c; }          // ties keep the nearer (smaller k) colour
      }
      if (bestN) out.d[y * w + x] = best;
    }
    return out;
  }
  /** Draw into a 2D context (respects the context's transform, unlike putImageData). */
  drawTo(g: CanvasRenderingContext2D, x = 0, y = 0): void {
    g.drawImage(this.toCanvas(), x, y);
  }
  toCanvas(): HTMLCanvasElement {
    const [cv, g] = makeCanvas(this.w, this.h);
    g.putImageData(this.imageData(), 0, 0);
    return cv;
  }
  /** Re-upload this bitmap into an existing canvas (in-place texture refresh). */
  paintInto(cv: HTMLCanvasElement): void {
    cv.getContext('2d', { willReadFrequently: true })!.putImageData(this.imageData(), 0, 0);
  }
  private imageData(): ImageData {
    const u8 = new Uint8ClampedArray(this.d.length * 4);
    u8.set(new Uint8Array(this.d.buffer, this.d.byteOffset, this.d.byteLength));
    return new ImageData(u8, this.w, this.h);
  }
  /** Build from an existing canvas / image data. */
  static fromCanvas(cv: HTMLCanvasElement): Pix {
    const g = cv.getContext('2d')!;
    const id = g.getImageData(0, 0, cv.width, cv.height);
    const p = new Pix(cv.width, cv.height);
    p.d.set(new Uint32Array(id.data.buffer));
    return p;
  }
}
const lumOf = (u: number): number => (u & 0xff) * 0.3 + ((u >>> 8) & 0xff) * 0.59 + ((u >>> 16) & 0xff) * 0.11;

// ── canvas / texture ─────────────────────────────────────────────────────────────────────────────
export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.floor(w)); cv.height = Math.max(1, Math.floor(h));
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  return [cv, g];
}

/**
 * Wrap a canvas in a PSX-flavoured `CanvasTexture`: NearestFilter, no mipmaps, NoColorSpace, wrap per `o`.
 * `shared` marks it `userData.shared` (never disposed by callers).
 */
export function finishTexture(cv: HTMLCanvasElement, o: TexOpts | undefined, shared: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  const wrap = o?.wrap === 'clamp' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapS = wrap; t.wrapT = wrap;
  if (o?.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  t.userData.shared = shared;
  t.needsUpdate = true;
  return t;
}
export const pixTexture = (p: Pix, o?: TexOpts, shared = true): THREE.CanvasTexture => finishTexture(p.toCanvas(), o, shared);

/** Cut-out alpha in place: alpha ≥ 128 becomes opaque, anything below becomes transparent (no soft edges). */
export function binarizeAlpha(p: Pix): Pix {
  for (let i = 0; i < p.d.length; i++) p.d[i] = (p.d[i] >>> 24) >= 128 ? (p.d[i] | 0xff000000) >>> 0 : 0;
  return p;
}

/** UV rectangle [u0, v0, u1, v1] of the pixel rect (x,y,w,h) in a w×h top-down canvas texture (flipY). */
export function uvRect(x: number, y: number, w: number, h: number, atlasW: number, atlasH: number): [number, number, number, number] {
  return [x / atlasW, 1 - (y + h) / atlasH, (x + w) / atlasW, 1 - y / atlasH];
}

/**
 * 5×5 suit pips (ART_BIBLE §3.5): Hearts, Diamonds, Clubs, Spades. Heart and diamond are the doc's bitmaps; spade and
 * club are redrawn (the doc's two read as mushrooms at 5×5): spade = pointed top over a waist with two feet, club =
 * a trefoil (three lobes) on a stem.
 */
export const PIP5: Record<'H' | 'D' | 'C' | 'S', readonly string[]> = {
  H: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  D: ['..#..', '.###.', '#####', '.###.', '..#..'],
  C: ['..#..', '.###.', '#.#.#', '#####', '..#..'],
  S: ['..#..', '.###.', '#####', '.#.#.', '..#..'],
};
