/**
 * Material presets (ART_BIBLE §2.5) for modelers: `const M = presets(kit.tex)` then `kit.box(…, M.wood('walnut'))`.
 * Every preset is a cached, vertex-coloured `psxMaterial`, so identical looks share one draw call after
 * `kit.finalize`. Surfaces use the CC0 vendor textures where they beat procedural ones (wood, brushed metal,
 * tufted leather, velvet) — tinted through the material colour so one texture serves every colourway — and
 * kit-owned canvas textures for the game-specific looks (painted enamel, speaker grille, glass).
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import type { TexGen, VendorTexOpts } from '@/core/texgen/types';
import { PAL, mixHex, hexR, hexG, hexB, rgbHex, css } from './palette';
import { psx } from './materials';
import { withTiles } from './tiles';

/** Vendor textures the presets use (also preloaded by `kit.loadMannequin()` so nothing pops in). */
export const VENDOR = {
  wood_walnut: { path: 'sbs-tiny2/128x128/Wood/Wood_11-128x128.png', o: { size: 64 } },
  wood_mahogany: { path: 'sbs-tiny2/128x128/Wood/Wood_01-128x128.png', o: { size: 64 } },
  wood_pine: { path: 'sbs-tiny2/128x128/Wood/Wood_19-128x128.png', o: { size: 64 } },
  brushed: { path: 'sbs-tiny2/128x128/Metal/Metal_09-128x128.png', o: { size: 32 } },
  brushed_hi: { path: 'sbs-tiny2/128x128/Metal/Metal_10-128x128.png', o: { size: 32 } },
  plate: { path: 'phobicpaul-lowpoly64/low-poly/texture metal 1.png', o: { size: 32 } },
  tufted: { path: 'sbs-tiny3/128x128/Cloth/Cloth_23-128x128.png', o: { size: 32 } },
  velvet: { path: 'sbs-tiny3/128x128/Cloth/Cloth_21-128x128.png', o: { size: 32 } },
  rust: { path: 'sbs-tiny3/128x128/Metal/Metal_23-128x128.png', o: { size: 32 } },
  cloth_dark: { path: 'sbs-tiny3/128x128/Cloth/Cloth_17-128x128.png', o: { size: 32 } },
} as const satisfies Record<string, { path: string; o: VendorTexOpts }>;
export type VendorKey = keyof typeof VENDOR;
export const VENDOR_PATHS: string[] = Object.values(VENDOR).map((v) => v.path);

/** Approximate mean colour of each vendor texture, used to derive the tint that lands on a target colour. */
const MEAN: Record<VendorKey, Hex> = {
  wood_walnut: 0x4a3426, wood_mahogany: 0xb06848, wood_pine: 0xb89860, brushed: 0xcfcfcf, brushed_hi: 0xe4e4e4,
  plate: 0x7c8088, tufted: 0xd87888, velvet: 0xc02818, rust: 0x9a4a28, cloth_dark: 0x585a58,
};

/** Multiplier colour that turns texture `k` into (roughly) `target`. */
function tintFor(k: VendorKey, target: Hex): Hex {
  const m = MEAN[k];
  const f = (t: number, mean: number): number => Math.max(0, Math.min(255, (t / Math.max(8, mean)) * 255));
  return rgbHex(f(hexR(target), hexR(m)), f(hexG(target), hexG(m)), f(hexB(target), hexB(m)));
}

export interface Presets {
  /** Painted cabinet enamel with seeded scratches/streaks; `grime` < 0.5 = lightly worn, ≥ 0.5 = filthy (two textures only, so enamel parts merge). */
  enamel(color: Hex, grime?: number): THREE.Material;
  wood(kind?: 'walnut' | 'mahogany' | 'dark' | 'pine'): THREE.Material;
  /** Wood in an arbitrary stain (vendor grain × colour). */
  woodStain(color: Hex): THREE.Material;
  /** Padded leather; `tufted` shows the diamond quilting (rails, stools, booths). */
  leather(color: Hex, tufted?: boolean): THREE.Material;
  velvet(color: Hex): THREE.Material;
  felt(color: Hex): THREE.Material;
  /** Brushed metal in any colour (same texture as brass/gold/chrome, so it merges with them). */
  metal(color: Hex): THREE.Material;
  brass(): THREE.Material;
  gold(): THREE.Material;
  chrome(): THREE.Material;
  gunmetal(): THREE.Material;
  rust(): THREE.Material;
  rubber(): THREE.Material;
  porcelain(): THREE.Material;
  bone(): THREE.Material;
  paper(): THREE.Material;
  /** Glossy plastic of one colour (button caps, light covers). */
  plastic(color: Hex): THREE.Material;
  /** Unlit colour (bulbs, emissive-looking parts). */
  unlit(color: Hex): THREE.Material;
  /** Dark perforated speaker / vent grille. */
  grille(color?: Hex): THREE.Material;
  /** Flat vertex-lit colour. */
  flat(color: Hex): THREE.Material;
}

const cache = new WeakMap<TexGen, Presets>();
const wrapped = new WeakMap<TexGen, TexGen>();

/** The tile-tagged TexGen for `tex` (idempotent). */
export function tiled(tex: TexGen): TexGen {
  if ((tex as TexGen & { __tiled?: boolean }).__tiled) return tex;
  let w = wrapped.get(tex);
  if (!w) { w = withTiles(tex); (w as TexGen & { __tiled?: boolean }).__tiled = true; wrapped.set(tex, w); }
  return w;
}

export function presets(texIn: TexGen): Presets {
  const tex = tiled(texIn);
  const hit = cache.get(tex) ?? cache.get(texIn);
  if (hit) return hit;
  const p = build(tex);
  cache.set(tex, p); cache.set(texIn, p);
  return p;
}

function build(tex: TexGen): Presets {
  const v = (k: VendorKey): THREE.Texture => tex.vendor(VENDOR[k].path, VENDOR[k].o);
  const mat = (color: Hex, map: THREE.Texture | null): THREE.Material => psx({ color, map, vertexColors: true });

  /** Painted enamel: near-white base with seeded scratches, wear and vertical drip streaks. */
  const enamelTex = (grime: number): THREE.Texture => {
    const q = grime < 0.5 ? 0.25 : 0.75;      // two wear levels only: every enamel part of a model shares ONE texture = one draw call
    return tex.canvas(32, 32, (g, w, h) => {
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
      let s = 1234567 + Math.round(q * 40);
      const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const specks = Math.round(10 + q * 90);
      for (let i = 0; i < specks; i++) {
        const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h), l = rnd() < 0.5 ? 1 : 1 + Math.floor(rnd() * 4);
        g.fillStyle = rnd() < 0.7 ? `rgba(30,24,20,${0.12 + q * 0.25})` : `rgba(255,255,255,0.35)`;
        if (rnd() < 0.5) g.fillRect(x, y, l, 1); else g.fillRect(x, y, 1, l);
      }
      for (let i = 0; i < Math.round(q * 6); i++) {          // drip streaks
        const x = Math.floor(rnd() * w), l = 6 + Math.floor(rnd() * 14);
        g.fillStyle = `rgba(30,22,16,${0.10 + q * 0.12})`; g.fillRect(x, 0, 1, l);
      }
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, h - 1, w, 1); g.fillRect(w - 1, 0, 1, h);
    }, { key: `kit:enamel:${q}` });
  };
  const grilleTex = (): THREE.Texture => tex.canvas(16, 16, (g, w, h) => {
    g.fillStyle = '#7a7a82'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0a0a10';
    for (let y = 1; y < h; y += 4) for (let x = ((y >> 2) & 1) * 2 + 1; x < w; x += 4) g.fillRect(x, y, 2, 2);
  }, { key: 'kit:grille' });
  const tag = (t: THREE.Texture, tile: number): THREE.Texture => { if (t.userData.tile === undefined) t.userData.tile = tile; return t; };
  /** Calm table felt: a fine two-tone weave with a few lint specks (texgen's felt is much busier). */
  const feltTex = (c: Hex): THREE.Texture => tex.canvas(32, 32, (g, w, h) => {
    g.fillStyle = css(c); g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (((x >> 1) + (y >> 1)) & 1) { g.fillStyle = 'rgba(0,0,0,0.055)'; g.fillRect(x, y, 1, 1); }
      else if (((x + y) & 3) === 0) { g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(x, y, 1, 1); }
    }
    let s = c;
    const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const light = css(mixHex(c, 0xf7efde, 0.2)), dark = css(mixHex(c, 0x000000, 0.3));
    for (let i = 0; i < 9; i++) { g.fillStyle = i < 5 ? light : dark; g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1); }
  }, { key: `kit:felt:${c}` });

  return {
    enamel: (c, grime = 0.15) => mat(c, tag(enamelTex(grime), 0.5)),
    wood(kind = 'walnut') {
      switch (kind) {
        case 'mahogany': return mat(tintFor('wood_mahogany', PAL.MAHOGANY), v('wood_mahogany'));
        case 'dark': return mat(mixHex(0x555555, 0x888888, 0.2), v('wood_walnut'));
        case 'pine': return mat(tintFor('wood_pine', 0xb08850), v('wood_pine'));
        default: return mat(0xe0d0c0, v('wood_walnut'));
      }
    },
    woodStain: (c) => mat(tintFor('wood_pine', c), v('wood_pine')),
    leather: (c, tufted = true) => (tufted ? mat(tintFor('tufted', c), v('tufted')) : mat(c, tex.noise(0xffffff, { size: 16, amount: 0.07, seed: 3 }))),
    velvet: (c) => mat(tintFor('velvet', c), v('velvet')),
    felt: (c) => mat(0xffffff, tag(feltTex(c), 0.5)),
    metal: (c) => mat(tintFor('brushed', c), v('brushed')),
    brass: () => mat(tintFor('brushed', mixHex(PAL.BRASS, PAL.GOLD, 0.3)), v('brushed')),
    gold: () => mat(tintFor('brushed', PAL.GOLD), v('brushed')),
    chrome: () => mat(tintFor('brushed_hi', 0xb4bcc6), v('brushed_hi')),
    gunmetal: () => mat(tintFor('plate', 0x585862), v('plate')),
    rust: () => mat(tintFor('rust', PAL.RUST), v('rust')),
    rubber: () => mat(PAL.PIT_BLACK, null),
    porcelain: () => mat(PAL.IVORY, tex.noise(0xffffff, { size: 16, amount: 0.04, seed: 5 })),
    bone: () => mat(PAL.BONE, tex.noise(0xffffff, { size: 16, amount: 0.06, seed: 9 })),
    paper: () => mat(PAL.PAPER, null),
    plastic: (c) => mat(c, null),
    unlit: (c) => psx({ color: c, lit: false }),
    grille: (c = 0x9a9aa2) => mat(c, tag(grilleTex(), 0.25)),
    flat: (c) => mat(c, null),
  };
}

