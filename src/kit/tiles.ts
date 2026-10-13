/**
 * Tile-size tagging. `Kit.tex` is the app's TexGen with one addition: tiling pattern textures it returns
 * (felt, wood, metal, vendor…) carry `userData.tile` = metres per repeat (≈ 64 texels per metre). Kit
 * primitives read that tag and map UVs in world metres (see geo.ts), so every surface has the same texel
 * density regardless of the size of the box it is on. Textures without the tag (text, symbols, cards,
 * canvases, gradients…) keep their 0..1 UVs.
 */
import type * as THREE from 'three';
import type { TexGen, VendorTexOpts } from '@/core/texgen/types';

/** Metres per tile for the procedural pattern generators. */
const TILE_M = {
  solid: 1, noise: 0.5, felt: 0.5, wood: 0.5, metal: 0.5, chrome: 0.5, carpet: 1.5, tiles: 1, brick: 1,
  concrete: 1, rust: 0.5, grime: 0.5, stripes: 0.5, checker: 0.5,
} as const;

/** Texels per metre the kit targets for tiled surfaces. */
export const TEXELS_PER_M = 64;

function tag<T extends THREE.Texture>(t: T, tile: number): T {
  if (t.userData.tile === undefined) t.userData.tile = tile;
  return t;
}

/** Wrap a TexGen so pattern textures are tile-tagged. Everything else is passed through untouched. */
export function withTiles(tex: TexGen): TexGen {
  const w = Object.create(tex) as TexGen;
  const t = TILE_M;
  w.solid = (c) => tag(tex.solid(c), t.solid);
  w.noise = (c, o) => tag(tex.noise(c, o), t.noise);
  w.felt = (c) => tag(tex.felt(c), t.felt);
  w.wood = (c, o) => tag(tex.wood(c, o), t.wood);
  w.metal = (c, o) => tag(tex.metal(c, o), t.metal);
  w.chrome = () => tag(tex.chrome(), t.chrome);
  w.carpet = (p, c) => tag(tex.carpet(p, c), t.carpet);
  w.tiles = (a, b, n) => tag(tex.tiles(a, b, n), t.tiles);
  w.brick = (c) => tag(tex.brick(c), t.brick);
  w.concrete = (c) => tag(tex.concrete(c), t.concrete);
  w.rust = (c) => tag(tex.rust(c), t.rust);
  w.grime = (a) => tag(tex.grime(a), t.grime);
  w.stripes = (c, d) => tag(tex.stripes(c, d), t.stripes);
  w.checker = (a, b, n) => tag(tex.checker(a, b, n), t.checker);
  w.vendor = (path: string, o?: VendorTexOpts) => tag(tex.vendor(path, o), (o?.size ?? 64) / TEXELS_PER_M);
  return w;
}

/** Metres per tile of a texture (undefined = not a metric-mapped pattern). */
export function tileOf(map: THREE.Texture | null | undefined): number | undefined {
  const v = map?.userData?.tile;
  return typeof v === 'number' && v > 0 ? v : undefined;
}
