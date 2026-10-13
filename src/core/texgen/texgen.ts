/**
 * `TexGen` implementation: procedural pixel textures, glyph text, symbol and card atlases (TECH_SPEC §2.4,
 * ART_BIBLE §3). Owner: CORE-TEXGEN.
 *
 * Every generator paints a `Pix` (integer pixels, 1-bit alpha, palette colours) or a 2D canvas, wraps it in a
 * PSX-flavoured CanvasTexture (NearestFilter, no mipmaps, NoColorSpace) and caches it by its arguments, so a repeat
 * call returns the same shared texture.
 *
 * Colour convention: pattern textures carry their colour (`felt(c)`, `wood(c)` …), so pair them with a WHITE material
 * colour; a tinted material colour multiplies the texture again.
 *
 * Beyond the frozen `TexGen` slots, this module exports module-level helpers (pure functions of their arguments,
 * cached once per session): `surface` (options the interface cannot express: carpet variants, tile kinds, wallpaper,
 * marble, leather, velvet, wet concrete, rust coverage …), `sonKartAtlas`, `okeyAtlas`, dice / roulette / chip edge
 * textures, `symbolStripBlur`, and the signage / LED / CRT helpers of `displays.ts`.
 */
import type * as THREE from 'three';
import { lang } from '../i18n';
import { log } from '../log';
import { Pix, binarizeAlpha, finishTexture, makeCanvas, pixTexture } from './pixel';
import { P08, P09 } from './palette';
import * as pat from './patterns';
import * as table from './tabletop';
import { drawText as fontDrawText, measureText, textMetrics } from './font';
import { BUILTIN_SYMBOLS, SYMBOL_ALIASES, type SymbolDef } from './symbols';
import { BUILTIN_ICONS, iconFallback } from './icons';
import { buildCardAtlas, buildOkeyAtlas, buildSonKartAtlas, type Atlas, type UV } from './cards';
import { createVendorLoader } from './vendor';
import { DEFAULT_SYMBOLS, type CardId, type SymbolId, type TexGen, type TexOpts } from './types';
import type { DieStyle } from './tabletop';
import type { Hex } from '../types';

/** Pixel-art toolbox and the 48-colour master palette (`PALETTE[14]` = P14), for painters that want to stay palette-pure. */
export { Pix } from './pixel';
export { PAL as PALETTE, RAMP, darker } from './palette';
export { dieUv, chipLabel } from './tabletop';
export { ROULETTE_ORDER, RED_NUMBERS, rouletteColor } from './rouletteData';
export type { RouletteColor } from './rouletteData';
export type { DieStyle } from './tabletop';

/** The named card-style atlases (`cardAtlas({ atlas })`). */
export type AtlasName = 'cards' | 'sonkart' | 'okey';
/** A UV-addressed atlas: `uv(key)` is a card id / `'back'` for `cards`, a SON KART or OKEY key otherwise. */
export interface AtlasHandle { tex: THREE.Texture; uv(key: string): UV }

/**
 * The extras promoted into the implementation (DECISIONS G): named atlases, dice / roulette / chip table textures,
 * the motion-blur reel strip and the surface recipes. `createTexGen()` returns this, so callers that need them go
 * through `kit.tex` without module-level imports. `types.ts` (frozen `TexGen`) still lacks these members; a director
 * decision is needed to add them there (see the report).
 */
export interface TexGenFull extends TexGen {
  /** `atlas` picks the card set; default `'cards'` (uv keys are card ids / `'back'`). */
  cardAtlas(o?: { atlas?: AtlasName }): AtlasHandle;
  /** 64×32 dice atlas, see `dieUv(n)`. */
  dieAtlas(style: DieStyle): THREE.Texture;
  /** 296×12 European wheel ring. */
  rouletteRing(): THREE.Texture;
  /** 160×64 betting layout, rebuilt when the language changes. */
  rouletteLayout(): THREE.Texture;
  /** 32×4 chip edge strip for the value. */
  chipEdge(value: number): THREE.Texture;
  /** Reel strip with motion-blur smear, same layout and `cellV` as `symbolStrip`. */
  symbolStripBlur(ids: SymbolId[], cell?: number): { tex: THREE.Texture; cellV: number };
  /** Surface recipes (ART_BIBLE §2.5): carpet, tiles, wallpaper, marble, leather, velvet, wood, concrete, decals. */
  surface: typeof surface;
}
export { drawMicro, microWidth, narrowDigits, px5Width, PX5_LINE_H, hasGlyph } from './font';
export { neonSign, sevenSegPix, sevenSegRollPix, sevenSegTex, dotMatrixPix, dotMatrixTex, crtScreen, crtTexture, crtPowerFrame, CRT_COLORS } from './displays';
export type { NeonOpts, NeonSign, CrtScheme, CrtColors } from './displays';
export { SON_KART_IDS, SON_KART_SPECIALS, SK_COLORS, OKEY_COLORS, CARD_W, CARD_H, OKEY_W, OKEY_H } from './cards';
export type { SonKartId, SonKartColor, OkeyTileId, OkeyColor, UV } from './cards';
export type { CarpetVariant, TileKind, WallpaperVariant, StainKind, EnvKind } from './patterns';

type CanvasPainter = (g: CanvasRenderingContext2D, s: number) => void;
const clamp: TexOpts = { wrap: 'clamp' };

/** Texture cache shared by all instances: atlases and tables are pure functions of their name. */
const shared = new Map<string, THREE.Texture>();
const atlases = new Map<string, Atlas>();

function memo<V>(cache: Map<string, V>, key: string, make: () => V): V {
  let v = cache.get(key);
  if (v === undefined) { v = make(); cache.set(key, v); }
  return v;
}

/** Built-in painter for `id`: exact id, alias, then lower-case (catalogue docs write MOTH, BAR, 2BAR …). */
const resolveDef = (id: SymbolId): SymbolDef | undefined => {
  const lower = id.toLowerCase(), k = SYMBOL_ALIASES[id] ?? SYMBOL_ALIASES[lower] ?? id;
  return BUILTIN_SYMBOLS[k] ?? BUILTIN_ICONS[k] ?? BUILTIN_SYMBOLS[lower] ?? BUILTIN_ICONS[lower];
};

/** The symbol at `size` on a transparent background (native painter size, then nearest resample). */
function builtinPix(id: SymbolId, size: number): Pix {
  const def = resolveDef(id);
  if (!def) {
    log.warn('texgen', `no painter for symbol "${id}", using fallback`);
    return iconFallback(id).resized(size, size);
  }
  const p = new Pix(def.size, def.size);
  def.paint(p);
  return p.resized(size, size);
}

/** Reel-strip cell background: the built-in painter's `bg` (P09 by default); custom painters get P09. */
function stripBackground(id: SymbolId, cell: number, custom: boolean): Pix {
  const p = new Pix(cell, cell);
  const def = custom ? undefined : resolveDef(id);
  if (def?.bg) def.bg(p); else p.rect(0, 0, cell, cell, P09);
  return p;
}

export function createTexGen(): TexGenFull {
  const cache = new Map<string, THREE.Texture>();
  const painters = new Map<SymbolId, CanvasPainter>();
  const vendor = createVendorLoader();

  const cached = <T extends THREE.Texture>(key: string, make: () => T): T => memo(cache, key, make) as T;
  /** Tileable pattern texture (default wrap = repeat). */
  const tile = (key: string, make: () => Pix, o?: TexOpts): THREE.Texture => cached(key, () => pixTexture(make(), o));

  const symbolPix = (id: SymbolId, size: number): Pix => {
    const custom = painters.get(id);
    if (!custom) return builtinPix(id, size);
    const [cv, g] = makeCanvas(size, size);
    custom(g, size);
    return binarizeAlpha(Pix.fromCanvas(cv));
  };

  /** A reel-strip cell: background, the symbol on top, and the P08 separator on the last row. */
  const cellPix = (id: SymbolId, cell: number): Pix => {
    const p = stripBackground(id, cell, painters.has(id));
    p.blit(symbolPix(id, cell), 0, 0);
    p.rect(0, cell - 1, cell, 1, P08);
    return p;
  };

  const gen: TexGenFull = {
    canvas(w, h, draw, o) {
      const make = (): THREE.CanvasTexture => {
        const [cv, g] = makeCanvas(w, h);
        draw(g, w, h);
        return finishTexture(cv, o, !!o?.key);
      };
      return o?.key ? cached(`canvas:${o.key}`, make) : make();
    },

    // ── patterns ──────────────────────────────────────────────────────────────────────────────
    solid: (c) => tile(`solid:${c}`, () => pat.noise(c, 4, 0, 1)),
    noise: (c, o) => {
      const size = o?.size ?? 32, amount = o?.amount ?? 0.12, seed = o?.seed ?? 1;
      return tile(`noise:${c}:${size}:${amount}:${seed}`, () => pat.noise(c, size, amount, seed));
    },
    felt: (c) => tile(`felt:${c}`, () => pat.felt(c)),
    wood: (c, o) => tile(`wood:${c}:${o?.grain ?? 5}`, () => pat.wood(c, o?.grain ?? 5)),
    metal: (c, o) => tile(`metal:${c}:${o?.brushed ?? true}`, () => pat.metal(c, o?.brushed ?? true)),
    chrome: () => tile('chrome', () => pat.chrome()),
    carpet: (pattern, colors) => tile(`carpet:${pattern}:${colors.join(',')}`, () => pat.carpet(pattern, colors)),
    tiles: (c1, c2, n = 4) => tile(`tiles:${c1}:${c2}:${n}`, () => pat.tiles(c1, c2, n)),
    brick: (c) => tile(`brick:${c}`, () => pat.brick(c)),
    concrete: (c) => tile(`concrete:${c}`, () => pat.concrete(c)),
    rust: (c) => tile(`rust:${c}`, () => pat.rust(c)),
    grime: (amount) => tile(`grime:${amount}`, () => pat.grime(amount)),
    stripes: (colors, dir = 'h') => tile(`stripes:${colors.join(',')}:${dir}`, () => pat.stripes(colors, dir)),
    checker: (c1, c2, n = 4) => tile(`checker:${c1}:${c2}:${n}`, () => pat.checker(c1, c2, n)),
    gradient: (stops, dir = 'v') => cached(`grad:${dir}:${JSON.stringify(stops)}`, () => pixTexture(pat.gradient(stops, dir), clamp)),

    // ── text ──────────────────────────────────────────────────────────────────────────────────
    drawText: (g, text, x, y, o) => fontDrawText(g, text, x, y, o),
    measure: (text, o) => measureText(text, o),
    /** w × h text texture, ink vertically centred on the cap block (so Turkish accents above it are never clipped). */
    text(text, o) {
      const [cv, g] = makeCanvas(o.w, o.h);
      if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, o.w, o.h); }
      const x = o.align === 'center' ? Math.round(o.w / 2) : o.align === 'right' ? o.w : 0;
      const m = textMetrics(o), block = m.cap + (text.split('\n').length - 1) * m.line;
      fontDrawText(g, text, x, Math.max(0, Math.floor((o.h - block) / 2)), o);
      return finishTexture(cv, clamp, false);
    },

    // ── symbols ───────────────────────────────────────────────────────────────────────────────
    symbol: (id, size = 32) => cached(`sym:${id}:${size}`, () => pixTexture(symbolPix(id, size), clamp)),
    symbolStrip(ids, cell = 32) {
      const n = Math.max(1, ids.length);
      const tex = cached(`strip:${cell}|${ids.join(',')}`, () => {
        const strip = new Pix(cell, cell * n);
        ids.forEach((id, i) => strip.blit(cellPix(id, cell), 0, i * cell));
        return pixTexture(strip, clamp);
      });
      return { tex, cellV: 1 / n };
    },
    registerSymbol(id, paint) {
      painters.set(id, paint);
      for (const k of [...cache.keys()]) {
        const stripIds = k.startsWith('strip:') ? k.slice(k.indexOf('|') + 1).split(',') : [];
        if (k.startsWith(`sym:${id}:`) || stripIds.includes(id)) cache.delete(k);
      }
    },

    // ── cards, dice, chips, wheels ────────────────────────────────────────────────────────────
    cardAtlas(o) {
      const name: AtlasName = o?.atlas ?? 'cards';
      const a = atlasOf(name);
      return { tex: atlasTex(name), uv: (key: string): UV => a.uv(key) };
    },
    dieAtlas: (style) => dieAtlasTex(style),
    rouletteRing: () => rouletteRingTex(),
    rouletteLayout: () => rouletteLayoutTex(),
    chipEdge: (value) => chipEdgeTex(value),
    symbolStripBlur: (ids, cell = 32) => symbolStripBlur(gen, ids, cell),
    surface,
    dieFace: (n, o) => cached(`die:${n}:${o?.body ?? ''}:${o?.pip ?? ''}`, () => pixTexture(table.dieFace(n, o?.body, o?.pip), clamp)),
    chipTop: (value) => cached(`chip:${value}`, () => pixTexture(table.chipTop(value), clamp)),
    wheelFace: (segments, size = 128) =>
      cached(`wheel:${size}:${JSON.stringify(segments)}`, () => finishTexture(table.wheelFace(segments, size), clamp, true)),

    // ── vendor (CC0) ──────────────────────────────────────────────────────────────────────────
    vendor: (path, o) => vendor.texture(path, o),
    preloadVendor: (paths) => vendor.preload(paths),

    async warm() {
      gen.cardAtlas();
      gen.symbolStrip([...DEFAULT_SYMBOLS], 32);
      gen.felt(0x10523a);
      gen.checker(0x101019, 0x292131);
      gen.concrete(0x7b736b);
    },
  };
  return gen;
}

// ── named atlases outside the TexGen slot list (shared, module-level) ─────────────────────────────

function atlasOf(name: 'cards' | 'sonkart' | 'okey'): Atlas {
  return memo(atlases, name, () => (name === 'cards' ? buildCardAtlas() : name === 'sonkart' ? buildSonKartAtlas() : buildOkeyAtlas()));
}
function atlasTex(name: 'cards' | 'sonkart' | 'okey'): THREE.Texture {
  return memo(shared, `atlas:${name}`, () => pixTexture(atlasOf(name).pix, clamp));
}

/** SON KART atlas (512×256): `uv('R7')`, `uv('W+4')`, `uv('back')`. */
export const sonKartAtlas = (): { tex: THREE.Texture; uv: (key: string) => UV } => ({
  tex: atlasTex('sonkart'),
  uv: (key) => atlasOf('sonkart').uv(key),
});
/** OKEY tile atlas (320×192): `uv('R13')`, `uv('FJ')` (false joker), `uv('back')`. */
export const okeyAtlas = (): { tex: THREE.Texture; uv: (key: string) => UV } => ({
  tex: atlasTex('okey'),
  uv: (key) => atlasOf('okey').uv(key),
});
/** Dice atlas (64×32), 6 faces in a 4×2 grid of 16×16 cells; see `dieUv(n)` for the cell of face `n`. */
export const dieAtlasTex = (style: DieStyle): THREE.Texture =>
  memo(shared, `die:atlas:${style}`, () => pixTexture(table.dieAtlas(style), clamp));
/** European roulette wheel ring (296×12), 37 cells of 8 px in wheel order. */
export const rouletteRingTex = (): THREE.Texture =>
  memo(shared, 'roulette:ring', () => pixTexture(table.rouletteRing(), clamp));
/** Betting layout (160×64, 1 px = 1 cm); rebuilt when the language changes. */
export const rouletteLayoutTex = (): THREE.Texture =>
  memo(shared, `roulette:layout:${lang()}`, () => pixTexture(table.rouletteLayout(), clamp));

/** 32×4 chip edge strip (6 inserts) for the cylinder side; colours follow the chip value like `chipTop`. */
export const chipEdgeTex = (value: number): THREE.Texture =>
  memo(shared, `chip:edge:${table.chipStyle(value).body}`, () => pixTexture(table.chipEdge(value), clamp));

/**
 * Reel strip with the motion-blur smear (ART_BIBLE §3.6): every pixel becomes the most frequent colour of the 6 source
 * pixels above it in its column (wrapping, as the drum does), so the result stays palette-pure. Swap it in while the
 * reel spins fast. Same layout and `cellV` as `symbolStrip` of the same ids.
 */
export function symbolStripBlur(tex: TexGen, ids: SymbolId[], cell = 32): { tex: THREE.Texture; cellV: number } {
  const base = tex.symbolStrip(ids, cell);
  const t = memo(shared, `strip:blur:${cell}|${ids.join(',')}`, () => pixTexture(Pix.fromCanvas(base.tex.image as HTMLCanvasElement).smearDown(6), clamp));
  return { tex: t, cellV: base.cellV };
}

const rep: TexOpts = { wrap: 'repeat' };
const keyOf = (...a: Array<string | number | boolean | undefined>): string => a.map((v) => String(v ?? '')).join(':');

/**
 * Surface textures with the options the `TexGen` interface cannot carry (ART_BIBLE §2.5 material recipes). All are
 * shared, cached and deterministic. Tileable ones repeat; decals and overlays (`glow`, `envSphere`, `stain`, `crack`,
 * `glassStreak`) clamp. Colours are Hex; palette colours stay palette-pure.
 */
export const surface = {
  /** 64×64 casino carpet, 1 tile per 1.5 m: the four zone variants (atrium red, slots violet, felt hall, parlour). */
  carpet: (variant: pat.CarpetVariant, wear = 0.35): THREE.Texture =>
    memo(shared, keyOf('carpet', variant, wear), () => pixTexture(pat.carpetCasino(variant, wear), rep)),
  /** 64×64 tiles (hex is 64×56): terrazzo panel, black/ivory checker, sump (bile-stained, some missing), hex bathroom. */
  tiles: (kind: pat.TileKind): THREE.Texture => memo(shared, keyOf('tilekind', kind), () => pixTexture(pat.tileKind(kind), rep)),
  /** 32×64 wallpaper: art-deco `fan` or `damask`, with peel and water-stain decay 0..1. */
  wallpaper: (variant: pat.WallpaperVariant, decay = 0.4): THREE.Texture =>
    memo(shared, keyOf('wallpaper', variant, decay), () => pixTexture(pat.wallpaper(variant, decay), rep)),
  /** 64×64 veined marble. */
  marble: (base: Hex = 0xe6dec5, veins = 3): THREE.Texture => memo(shared, keyOf('marble', base, veins), () => pixTexture(pat.marble(base, veins), rep)),
  /** 32×32 leather; `tufted` = quilted diamonds with buttons, `rail` = a stitched edge row. */
  leather: (c: Hex, o?: { tufted?: boolean; rail?: boolean }): THREE.Texture =>
    memo(shared, keyOf('leather', c, o?.tufted, o?.rail), () => pixTexture(pat.leather(c, o?.tufted, o?.rail), rep)),
  /** 32×64 curtain velvet with vertical folds. */
  velvet: (c: Hex, folds = 4): THREE.Texture => memo(shared, keyOf('velvet', c, folds), () => pixTexture(pat.velvet(c, folds), rep)),
  /** 32×64 wood; `planks` adds that many seams per tile. */
  wood: (c: Hex, o?: { grain?: number; planks?: number }): THREE.Texture =>
    memo(shared, keyOf('wood', c, o?.grain, o?.planks), () => pixTexture(pat.wood(c, o?.grain ?? 5, o?.planks ?? 0), rep)),
  /** 32×32 raised wall panel with bevel. */
  wainscot: (c: Hex): THREE.Texture => memo(shared, keyOf('wainscot', c), () => pixTexture(pat.wainscot(c), rep)),
  /** 64×64 concrete; `wet` darkens it and adds glints. */
  concrete: (c: Hex, o?: { wet?: boolean; cracks?: number; stains?: boolean }): THREE.Texture =>
    memo(shared, keyOf('concrete', c, o?.wet, o?.cracks, o?.stains), () => pixTexture(pat.concrete(c, o), rep)),
  /** 32×32 painted metal `c` with rust `coverage` 0..1 and `drips` streaks. */
  rust: (c: Hex, o?: { coverage?: number; drips?: number }): THREE.Texture =>
    memo(shared, keyOf('rust', c, o?.coverage, o?.drips), () => pixTexture(pat.rust(c, o?.coverage, o?.drips), rep)),
  /** 16×16 diamond wire mesh on a transparent field (cut-out). */
  mesh: (c: Hex = 0x8c6b29, cell = 4): THREE.Texture => memo(shared, keyOf('mesh', c, cell), () => pixTexture(pat.mesh(c, cell), rep)),
  /** 32×32 additive glass highlight streaks. */
  glassStreak: (grime = 0): THREE.Texture => memo(shared, keyOf('glass', grime), () => pixTexture(pat.glassStreak(grime), clamp)),
  /** 32×32 radial dithered halo (white): tint it with the material colour on an additive plane. */
  glow: (r = 15, levels = 4): THREE.Texture => memo(shared, keyOf('glow', r, levels), () => pixTexture(pat.glow(r, levels), clamp)),
  /** 32×32 matcap disc for fake reflections. */
  envSphere: (kind: pat.EnvKind): THREE.Texture => memo(shared, keyOf('env', kind), () => pixTexture(pat.envSphere(kind), clamp)),
  /** 64×64 blotchy decal. */
  stain: (kind: pat.StainKind, seed = 1): THREE.Texture => memo(shared, keyOf('stain', kind, seed), () => pixTexture(pat.stain(kind, seed), clamp)),
  /** 64×64 branching crack decal (plaster, glass). */
  crack: (seed = 1): THREE.Texture => memo(shared, keyOf('crack', seed), () => pixTexture(pat.crack(seed), clamp)),
};
