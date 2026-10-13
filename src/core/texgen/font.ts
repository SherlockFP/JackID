/**
 * Text for the PSX look (TECH_SPEC §2.4, ART_BIBLE §3.4 + §10.1). Owner: CORE-TEXGEN.
 *
 *  • `px5`  — built-in proportional 5×7 bitmap font with full Turkish coverage (Ç Ğ İ Ö Ş Ü ç ğ ı ö ş ü).
 *             Cap-top is the text origin; accents rise up to 3 rows above it, descenders fall 2 rows below,
 *             line pitch is 10 rows (× scale). Always available — no async font load.
 *  • `micro` — the 3×5 card/chip/LED font of ART_BIBLE §3.4 (digits, A–Z, `$ ¢ + - × . : / ! ? %`).
 *  • `vt` / `ps2p` — VT323 / Press Start 2P rendered with canvas `fillText`, then alpha-thresholded to a
 *             1-bit mask (never anti-aliased). Bitmaps are cached (LRU) once the web-font is loaded.
 */
import type { TextOpts, FontId } from './types';
import { Pix, makeCanvas } from './pixel';
import type { Hex } from '../types';

// ── px5 glyph table ──────────────────────────────────────────────────────────────────────────────
/** One glyph: `rows[i]` is the row at y = y0 + i (y0 < 0 = rows above the cap line). */
interface Glyph { w: number; y0: number; rows: string[] }

/** Rows joined by '/'; '#' = ink. Base glyphs start at row 0 (cap top); lowercase x-height starts at row 2. */
const RAW: Record<string, string> = {
  '0': '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', '1': '..#../.##../..#../..#../..#../..#../.###.',
  '2': '.###./#...#/....#/...#./..#../.#.../#####', '3': '.###./#...#/....#/..##./....#/#...#/.###.',
  '4': '...#./..##./.#.#./#..#./#####/...#./...#.', '5': '#####/#..../####./....#/....#/#...#/.###.',
  '6': '..##./.#.../#..../####./#...#/#...#/.###.', '7': '#####/....#/...#./..#../.#.../.#.../.#...',
  '8': '.###./#...#/#...#/.###./#...#/#...#/.###.', '9': '.###./#...#/#...#/.####/....#/...#./.##..',
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.###.', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '###/.#./.#./.#./.#./.#./###', J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
  a: '...../...../.###./....#/.####/#...#/.####', b: '#..../#..../####./#...#/#...#/#...#/####.',
  c: '...../...../.###./#..../#..../#...#/.###.', d: '....#/....#/.####/#...#/#...#/#...#/.####',
  e: '...../...../.###./#...#/#####/#..../.###.', f: '..##/.#../###./.#../.#../.#../.#..',
  g: '...../...../.####/#...#/#...#/#...#/.####/....#/.###.', h: '#..../#..../####./#...#/#...#/#...#/#...#',
  i: '#/./#/#/#/#/#', j: '..#/.../..#/..#/..#/..#/..#/..#/##.',
  k: '#..../#..../#..#./#.#../##.../#.#../#..#.', l: '##./.#./.#./.#./.#./.#./.##',
  m: '...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#', n: '...../...../####./#...#/#...#/#...#/#...#',
  o: '...../...../.###./#...#/#...#/#...#/.###.', p: '...../...../####./#...#/#...#/#...#/####./#..../#....',
  q: '...../...../.####/#...#/#...#/#...#/.####/....#/....#', r: '...../...../#.##./##..#/#..../#..../#....',
  s: '...../...../.####/#..../.###./....#/####.', t: '.#../.#../####/.#../.#../.#../..##',
  u: '...../...../#...#/#...#/#...#/#..##/.##.#', v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.', x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#...#/#...#/#...#/.####/....#/....#/.###.', z: '...../...../#####/...#./..#../.#.../#####',
  'ı': '././#/#/#/#/#',
  '!': '#/#/#/#/#/./#', '"': '#.#/#.#/#.#/.../.../.../...', '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  '$': '..#../.####/#.#../.###./..#.#/####./..#..', '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
  '&': '.##../#..#./#.#../.#.../#.#.#/#..#./.##.#', "'": '#/#/./././.', '(': '..#/.#./#../#../#../.#./..#',
  ')': '#../.#./..#/..#/..#/.#./#..', '*': '...../#.#.#/.###./#####/.###./#.#.#/.....',
  '+': '...../..#../..#../#####/..#../..#../.....', ',': '../../../../../../.#/#.',
  '-': '...../...../...../#####/...../...../.....', '.': './././././#', '/': '....#/....#/...#./..#../.#.../#..../#....',
  ':': '././#/././#/.', ';': '../../.#/../../.#/#.', '<': '...#./..#../.#.../#..../.#.../..#../...#.',
  '=': '...../...../#####/...../#####/...../.....', '>': '.#.../..#../...#./....#/...#./..#../.#...',
  '?': '.###./#...#/....#/...#./..#../...../..#..', '@': '.###./#...#/#.###/#.#.#/#.###/#..../.####',
  '[': '###/#../#../#../#../#../###', '\\': '#..../#..../.#.../..#../...#./....#/....#', ']': '###/..#/..#/..#/..#/..#/###',
  '^': '..#../.#.#./#...#/...../...../...../.....', '_': '...../...../...../...../...../...../...../#####',
  '`': '#./.#/../../../../..', '{': '..##/.#../.#../#.../.#../.#../..##', '|': '#/#/#/#/#/#/#',
  '}': '##../..#./..#./...#/..#./..#./##..', '~': '...../...../.##.#/#.##./...../...../.....',
  // symbols used by HUD / cards
  '¢': '..#../.###./#.#../#.#../#.#../.###./..#..', '×': '...../#...#/.#.#./..#../.#.#./#...#/.....',
  '·': './././#/././.', '•': '...../...../.###./.###./.###./...../.....', '°': '.##./#..#/#..#/.##./..../..../....',
  '←': '...../..#../.#.../#####/.#.../..#../.....', '→': '...../..#../...#./#####/...#./..#../.....',
  '↑': '..#../.###./#.#.#/..#../..#../..#../..#..', '↓': '..#../..#../..#../..#../#.#.#/.###./..#..',
  '▲': '...../..#../.###./#####/...../...../.....', '▼': '...../#####/.###./..#../...../...../.....',
  '◀': '..../...#/..##/.###/..##/...#/....', '▶': '..../#.../##../###./##../#.../....',
  '♥': '.#.#./#####/#####/.###./..#../...../.....', '♦': '..#../.###./#####/.###./..#../...../.....',
  '♣': '..#../.###./..#../#####/#####/..#../.###.', '♠': '..#../.###./#####/#####/#####/..#../.###.',
  '★': '..#../..#../#####/.###./.#.#./#...#/.....',
  '□': '#####/#...#/#...#/#...#/#...#/#...#/#####',
};

const GLYPHS = new Map<string, Glyph>();
for (const [ch, s] of Object.entries(RAW)) {
  const rows = s.split('/');
  const w = rows[0].length;
  if (import.meta.env?.DEV && rows.some((r) => r.length !== w)) throw new Error(`px5 glyph "${ch}" has ragged rows`);
  GLYPHS.set(ch, { w, y0: 0, rows });
}
/** Overlay `marks` (absolute row → pattern) on the base glyph, growing it upward / downward as needed. */
function compose(base: string, marks: Record<number, string>): Glyph {
  const b = GLYPHS.get(base)!;
  const keys = Object.keys(marks).map(Number);
  const y0 = Math.min(b.y0, ...keys), y1 = Math.max(b.y0 + b.rows.length - 1, ...keys);
  const rows: string[] = [];
  for (let y = y0; y <= y1; y++) {
    const src = b.rows[y - b.y0] ?? '.'.repeat(b.w), mk = marks[y];
    rows.push(mk ? src.split('').map((c, i) => (mk[i] === '#' ? '#' : c)).join('') : src);
  }
  return { w: b.w, y0, rows };
}
const CEDILLA = { 7: '..#..', 8: '.##..' };
GLYPHS.set('Ç', compose('C', CEDILLA)); GLYPHS.set('ç', compose('c', CEDILLA));
GLYPHS.set('Ş', compose('S', CEDILLA)); GLYPHS.set('ş', compose('s', CEDILLA));
GLYPHS.set('Ğ', compose('G', { '-3': '#...#', '-2': '.###.' } as Record<number, string>));
GLYPHS.set('ğ', compose('g', { '-1': '#...#', 0: '.###.' } as Record<number, string>));
GLYPHS.set('İ', compose('I', { '-2': '.#.' } as Record<number, string>));
GLYPHS.set('Ö', compose('O', { '-2': '.#.#.' } as Record<number, string>));
GLYPHS.set('Ü', compose('U', { '-2': '.#.#.' } as Record<number, string>));
GLYPHS.set('ö', compose('o', { 0: '.#.#.' })); GLYPHS.set('ü', compose('u', { 0: '.#.#.' }));
for (const [from, to] of Object.entries({ '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' })) {
  GLYPHS.set(from, GLYPHS.get(to)!);
}
GLYPHS.set('…', { w: 5, y0: 0, rows: ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'] });
/** Private-use stand-in for a 3-px-wide `1`: lets two-digit numbers (Okey 10–13, wheel labels) fit narrow cells at ×2. */
export const NARROW_ONE = '';
GLYPHS.set(NARROW_ONE, { w: 3, y0: 0, rows: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'] });
/** Replace every `1` of a 2+ digit number by the narrow form. */
export const narrowDigits = (s: string): string => (s.length > 1 ? s.replace(/1/g, NARROW_ONE) : s);

/** Line pitch of px5 in glyph rows (cap 7 + descender 2 + 1 gap). */
export const PX5_LINE_H = 10;
/** Rows reserved above the cap line (Turkish accents) and below the baseline (descenders). */
export const PX5_PAD_TOP = 3, PX5_PAD_BOT = 2, PX5_CAP_H = 7;
const SPACE_ADV = 3;

function glyphFor(ch: string): Glyph | null {
  const g = GLYPHS.get(ch);
  if (g) return g;
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (base !== ch && base.length === 1 && GLYPHS.has(base)) return GLYPHS.get(base)!;
  return GLYPHS.get('□') ?? null;
}
/** True if px5 has a dedicated glyph for `ch`. */
export const hasGlyph = (ch: string): boolean => GLYPHS.has(ch) || ch === ' ';

interface PlacedLine { glyphs: Array<{ g: Glyph; x: number }>; w: number }
function layout(text: string): { lines: PlacedLine[]; w: number } {
  const lines: PlacedLine[] = [];
  let maxW = 0;
  for (const raw of text.split('\n')) {
    const glyphs: PlacedLine['glyphs'] = [];
    let x = 0;
    for (const ch of raw) {
      if (ch === ' ' || ch === '\t') { x += SPACE_ADV; continue; }
      const g = glyphFor(ch);
      if (!g) continue;
      glyphs.push({ g, x });
      x += g.w + 1;
    }
    const w = Math.max(0, x - 1);
    lines.push({ glyphs, w });
    if (w > maxW) maxW = w;
  }
  return { lines, w: maxW };
}

/** px5 width of `text` in px at integer `scale` (widest line). */
export function px5Width(text: string, scale = 1): number {
  return layout(text).w * Math.max(1, Math.floor(scale));
}

/** Paint px5 text into a `Pix` with the cap-top-left at (x, y). Returns the width in px. */
export function px5Pix(p: Pix, text: string, x: number, y: number, color: Hex, scale = 1, align: 'left' | 'center' | 'right' = 'left'): number {
  const s = Math.max(1, Math.floor(scale));
  const { lines, w } = layout(text);
  lines.forEach((ln, li) => {
    const off = align === 'center' ? Math.floor((w - ln.w) / 2) : align === 'right' ? w - ln.w : 0;
    const ox = align === 'center' ? x - Math.floor((w * s) / 2) : align === 'right' ? x - w * s : x;
    for (const { g, x: gx } of ln.glyphs) {
      g.rows.forEach((row, ri) => {
        for (let c = 0; c < g.w; c++) {
          if (row[c] === '#') p.rect(ox + (off + gx + c) * s, y + (li * PX5_LINE_H + g.y0 + ri) * s, s, s, color);
        }
      });
    }
  });
  return w * s;
}

// ── micro 3×5 font ───────────────────────────────────────────────────────────────────────────────
const MICRO_RAW: Record<string, string> = {
  '0': '111/101/101/101/111', '1': '010/110/010/010/111', '2': '111/001/111/100/111', '3': '111/001/111/001/111',
  '4': '101/101/111/001/001', '5': '111/100/111/001/111', '6': '111/100/111/101/111', '7': '111/001/010/010/010',
  '8': '111/101/111/101/111', '9': '111/101/111/001/111', $: '011/110/111/011/110', '¢': '010/111/100/111/010',
  '+': '000/010/111/010/000', '-': '000/000/111/000/000', '×': '000/101/010/101/000', '/': '001/001/010/100/100',
  '%': '101/001/010/100/101', '.': '000/000/000/000/010', ':': '000/010/000/010/000', '!': '010/010/010/000/010',
  '?': '110/001/010/000/010',
  A: '010/101/111/101/101', B: '110/101/110/101/110', C: '011/100/100/100/011', D: '110/101/101/101/110',
  E: '111/100/110/100/111', F: '111/100/110/100/100', G: '011/100/101/101/011', H: '101/101/111/101/101',
  I: '111/010/010/010/111', J: '001/001/001/101/010', K: '101/101/110/101/101', L: '100/100/100/100/111',
  M: '101/111/111/101/101', N: '110/101/101/101/101', O: '010/101/101/101/010', P: '110/101/110/100/100',
  Q: '010/101/101/110/011', R: '110/101/110/101/101', S: '011/100/010/001/110', T: '111/010/010/010/010',
  U: '101/101/101/101/111', V: '101/101/101/101/010', W: '101/101/111/111/101', X: '101/101/010/101/101',
  Y: '101/101/010/010/010', Z: '111/001/010/100/111',
  '10': '10111/10101/10101/10101/10111',        // card index "10", 5 wide
};
interface MicroGlyph { w: number; rows: string[]; above?: string; below?: string }
const MICRO = new Map<string, MicroGlyph>();
for (const [k, v] of Object.entries(MICRO_RAW)) { const rows = v.split('/'); MICRO.set(k, { w: rows[0].length, rows }); }
MICRO.set('Ç', { ...MICRO.get('C')!, below: '010' }); MICRO.set('Ş', { ...MICRO.get('S')!, below: '010' });
MICRO.set('Ğ', { ...MICRO.get('G')!, above: '111' }); MICRO.set('Ö', { ...MICRO.get('O')!, above: '101' });
MICRO.set('Ü', { ...MICRO.get('U')!, above: '101' }); MICRO.set('İ', { ...MICRO.get('I')!, above: '010' });
const microGlyph = (ch: string): MicroGlyph | undefined => MICRO.get(ch) ?? MICRO.get(ch.toLocaleUpperCase('en-US'));

/** Width in px of `text` in the 3×5 micro font at integer `scale` (1 px spacing). */
export function microWidth(text: string, scale = 1): number {
  let w = 0, n = 0;
  for (const ch of text) { w += ch === ' ' ? 2 : (microGlyph(ch)?.w ?? 3) + 1; n++; }
  return Math.max(0, w - (n ? 1 : 0)) * Math.max(1, Math.floor(scale));
}
/** Micro text into a `Pix`; (x, y) = top-left of the 3×5 body (Turkish marks use the rows above / below). */
export function microPix(p: Pix, text: string, x: number, y: number, color: Hex, scale = 1): number {
  const s = Math.max(1, Math.floor(scale));
  let cx = x;
  for (const ch of text) {
    if (ch === ' ') { cx += 2 * s; continue; }
    const g = microGlyph(ch);
    if (!g) { cx += 4 * s; continue; }
    g.rows.forEach((row, ry) => { for (let c = 0; c < g.w; c++) if (row[c] === '1') p.rect(cx + c * s, y + ry * s, s, s, color); });
    // Turkish marks sit directly above (row −1) / below (row 5) the 3×5 body (ART_BIBLE §3.4: 3×7 cell)
    if (g.above) for (let c = 0; c < g.above.length; c++) if (g.above[c] === '1') p.rect(cx + c * s, y - s, s, s, color);
    if (g.below) for (let c = 0; c < g.below.length; c++) if (g.below[c] === '1') p.rect(cx + c * s, y + 5 * s, s, s, color);
    cx += (g.w + 1) * s;
  }
  return Math.max(0, cx - x - s);
}
/** Micro text (3×5, ART_BIBLE §3.4) straight onto a 2D context; (x, y) = top-left of the 3×5 body. Returns the width. */
export function drawMicro(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string | Hex = 0xf7efde, scale = 1): number {
  const w = microWidth(text, scale);
  if (!w) return 0;
  const s = Math.max(1, Math.floor(scale)), h = 7 * s;
  const p = new Pix(w, h);
  microPix(p, text, 0, s, typeof color === 'number' ? color : parseHex(color), s);
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(p.toCanvas(), Math.round(x), Math.round(y) - s);
  g.imageSmoothingEnabled = smooth;
  return w;
}
const parseHex = (c: string): Hex => { const [r, g, b] = parseColor(c); return (r << 16) | (g << 8) | b; };

// ── canvas text bitmaps (all three fonts) ────────────────────────────────────────────────────────
interface TextBitmap { cv: HTMLCanvasElement; w: number; h: number; ox: number; oy: number; textW: number }

const FAMILY: Record<'vt' | 'ps2p', string> = { vt: "'VT323'", ps2p: "'Press Start 2P'" };
const colorCache = new Map<string, [number, number, number, number]>();
let colorCtx: CanvasRenderingContext2D | null = null;
/** Parse any CSS colour to RGBA bytes. */
function parseColor(c: string): [number, number, number, number] {
  let v = colorCache.get(c);
  if (v) return v;
  colorCtx ??= makeCanvas(1, 1)[1];
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000'; colorCtx.fillStyle = c;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  v = [d[0], d[1], d[2], d[3]];
  colorCache.set(c, v);
  return v;
}

const bitmapCache = new Map<string, TextBitmap>();
const CACHE_MAX = 384;
/** Drop cached text bitmaps (only needed if a web-font is swapped at runtime; fallback renders are never cached). */
export function clearTextCache(): void { bitmapCache.clear(); }

interface Resolved { font: FontId; size: number; scale: number; color: string; outline: string | null; align: "left" | "center" | "right" }
const resolve = (o?: TextOpts): Resolved => ({
  font: o?.font ?? 'px5',
  size: o?.size ?? (o?.font === 'vt' ? 16 : 8),
  scale: Math.max(1, Math.floor(o?.scale ?? 1)),
  color: o?.color ?? '#f7efde',
  outline: o?.outline ?? null,
  align: o?.align ?? "left",
});

/** Fill an ImageData-backed mask into a canvas with colour + optional 1-px (8-neighbour) outline. */
function maskToBitmap(mask: Uint8Array, mw: number, mh: number, scale: number, color: string, outline: string | null, pad: number): HTMLCanvasElement {
  const [cv, g] = makeCanvas(mw * scale, mh * scale);
  const id = g.createImageData(cv.width, cv.height);
  const px = new Uint32Array(id.data.buffer);
  const [r, gg, b, a] = parseColor(color);
  const ink = ((a << 24) | (b << 16) | (gg << 8) | r) >>> 0;
  let edge = 0;
  if (outline) { const [or, og, ob, oa] = parseColor(outline); edge = ((oa << 24) | (ob << 16) | (og << 8) | or) >>> 0; }
  const W = cv.width;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    let v = 0;
    if (mask[y * mw + x]) v = ink;
    else if (outline && pad > 0) {
      for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < mw && ny < mh && mask[ny * mw + nx]) { v = edge; break; }
      }
    }
    if (!v) continue;
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) px[(y * scale + sy) * W + x * scale + sx] = v;
  }
  g.putImageData(id, 0, 0);
  return cv;
}

function buildPx5(text: string, r: Resolved): TextBitmap {
  const { lines, w } = layout(text);
  const pad = 1;
  const mw = w + pad * 2, mh = PX5_PAD_TOP + PX5_CAP_H + PX5_PAD_BOT + (lines.length - 1) * PX5_LINE_H + pad * 2;
  const mask = new Uint8Array(mw * mh);
  const baseY = pad + PX5_PAD_TOP;
  lines.forEach((ln, li) => {
    const off = r.align === "center" ? Math.floor((w - ln.w) / 2) : r.align === "right" ? w - ln.w : 0;
    for (const { g, x: gx } of ln.glyphs) {
      const x = gx + off;
      g.rows.forEach((row, ri) => {
        const y = baseY + li * PX5_LINE_H + g.y0 + ri;
        if (y < 0 || y >= mh) return;
        for (let c = 0; c < g.w; c++) if (row[c] === '#') mask[y * mw + pad + x + c] = 1;
      });
    }
  });
  const cv = maskToBitmap(mask, mw, mh, r.scale, r.color, r.outline, pad);
  return { cv, w: cv.width, h: cv.height, ox: pad * r.scale, oy: baseY * r.scale, textW: w * r.scale };
}

function fontReady(font: 'vt' | 'ps2p', size: number): boolean {
  if (typeof document === 'undefined' || !document.fonts) return true;
  return document.fonts.check(`${size}px ${FAMILY[font]}`);
}

function buildCanvasFont(text: string, r: Resolved): TextBitmap {
  const font = r.font as 'vt' | 'ps2p';
  const css = `${r.size}px ${FAMILY[font]}, monospace`;
  const lh = Math.round(r.size * (font === 'vt' ? 1 : 1.25));
  const rows = text.split('\n');
  const [, mg] = makeCanvas(1, 1);
  mg.font = css;
  let tw = 0;
  for (const ln of rows) tw = Math.max(tw, Math.ceil(mg.measureText(ln).width));
  const pad = r.outline ? 1 : 0;
  const mw = tw + pad * 2 + 2, mh = lh * rows.length + pad * 2 + Math.ceil(r.size * 0.25);
  const [, tg] = makeCanvas(mw, mh);
  tg.font = css; tg.textBaseline = 'top'; tg.fillStyle = '#fff';
  rows.forEach((ln, i) => {
    const lw = Math.ceil(tg.measureText(ln).width);
    const off = r.align === 'center' ? Math.floor((tw - lw) / 2) : r.align === 'right' ? tw - lw : 0;
    tg.fillText(ln, pad + 1 + off, pad + i * lh);
  });
  const src = tg.getImageData(0, 0, mw, mh).data;
  const mask = new Uint8Array(mw * mh);
  for (let i = 0; i < mask.length; i++) mask[i] = src[i * 4 + 3] >= 128 ? 1 : 0;      // 1-bit: no anti-aliasing survives
  const cv = maskToBitmap(mask, mw, mh, 1, r.color, r.outline, pad);
  return { cv, w: mw, h: mh, ox: pad + 1, oy: pad, textW: tw };
}

function bitmapFor(text: string, r: Resolved): TextBitmap {
  const cacheable = r.font === 'px5' || fontReady(r.font as 'vt' | 'ps2p', r.size);
  const key = `${r.font}|${r.size}|${r.scale}|${r.color}|${r.outline ?? ''}|${r.align}|${text}`;
  if (cacheable) {
    const hit = bitmapCache.get(key);
    if (hit) { bitmapCache.delete(key); bitmapCache.set(key, hit); return hit; }
  } else if (typeof document !== 'undefined' && document.fonts) {
    void document.fonts.load(`${r.size}px ${FAMILY[r.font as 'vt' | 'ps2p']}`).catch((): void => undefined);
  }
  const bm = r.font === 'px5' ? buildPx5(text, r) : buildCanvasFont(text, r);
  if (cacheable) {
    bitmapCache.set(key, bm);
    if (bitmapCache.size > CACHE_MAX) bitmapCache.delete(bitmapCache.keys().next().value as string);
  }
  return bm;
}

/**
 * Draw `text` (may contain '\n') with its origin at (x, y) — for px5 that is the cap-top-left, for vt/ps2p the
 * top of the em box. Returns the width in px. Pixel-exact: integer positions only.
 */
export function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, o?: TextOpts): number {
  if (!text) return 0;
  const r = resolve(o);
  const bm = bitmapFor(text, r);
  const align = o?.align ?? 'left';
  const dx = align === 'center' ? Math.floor(bm.textW / 2) : align === 'right' ? bm.textW : 0;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(bm.cv, Math.round(x) - bm.ox - dx, Math.round(y) - bm.oy);
  g.imageSmoothingEnabled = smooth;
  return bm.textW;
}
/** Width in px `drawText` would produce. */
export function measureText(text: string, o?: TextOpts): number {
  if (!text) return 0;
  const r = resolve(o);
  return r.font === 'px5' ? px5Width(text, r.scale) : bitmapFor(text, r).textW;
}
/** Vertical metrics for `o`: pixels above the origin, pixels from origin to the bottom of the line box. */
export function textMetrics(o?: TextOpts): { cap: number; line: number } {
  const r = resolve(o);
  if (r.font === 'px5') return { cap: PX5_CAP_H * r.scale, line: PX5_LINE_H * r.scale };
  return { cap: r.size, line: Math.round(r.size * (r.font === 'vt' ? 1 : 1.25)) };
}
/** Render `text` to a standalone canvas the size of the text bitmap (used by neon / LED helpers). */
export function textMask(text: string, o?: TextOpts): { cv: HTMLCanvasElement; ox: number; oy: number; w: number } {
  const r = resolve({ ...o, color: '#ffffff', outline: null });
  const bm = bitmapFor(text, r);
  return { cv: bm.cv, ox: bm.ox, oy: bm.oy, w: bm.textW };
}

/**
 * 1-bit mask of a single px5 line for LED-style displays: `rows` rows from the cap line down (accents above the
 * cap line are dropped), plus the x-range [x0, x1) of every glyph (spaces excluded).
 */
export function px5Mask(text: string, rows = 8): { w: number; h: number; data: Uint8Array; ranges: Array<[number, number]> } {
  const { lines, w } = layout(text.split('\n')[0] ?? '');
  const data = new Uint8Array(w * rows), ranges: Array<[number, number]> = [];
  for (const { g, x } of lines[0].glyphs) {
    ranges.push([x, x + g.w]);
    g.rows.forEach((row, ri) => {
      const y = g.y0 + ri;
      if (y < 0 || y >= rows) return;
      for (let c = 0; c < g.w; c++) if (row[c] === '#') data[y * w + x + c] = 1;
    });
  }
  return { w, h: rows, data, ranges };
}
/** x-ranges [x0, x1) of each glyph of `text` in px (for per-letter neon flicker); works for every font. */
export function letterRanges(text: string, o?: TextOpts): Array<[number, number]> {
  const r = resolve(o);
  if (r.font === 'px5') return px5Mask(text).ranges.map(([a, b]) => [a * r.scale, b * r.scale] as [number, number]);
  const [, g] = makeCanvas(1, 1);
  g.font = `${r.size}px ${FAMILY[r.font as 'vt' | 'ps2p']}, monospace`;
  const out: Array<[number, number]> = [];
  let acc = '';
  for (const ch of text.split('\n')[0] ?? '') {
    const x0 = g.measureText(acc).width;
    acc += ch;
    if (ch !== ' ') out.push([Math.round(x0), Math.round(g.measureText(acc).width)]);
  }
  return out;
}
