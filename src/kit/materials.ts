/**
 * Material resolution for the kit. Everything is a cached `psxMaterial`. We remember the options each
 * material was built from, so `kit.shade()` can later swap an unshaded material for its vertex-coloured
 * sibling without cloning (a clone would lose the PSX shader injection).
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import type { PsxMatOpts } from '@/core/renderer/types';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import type { MatLike } from './types';

const optsOf = new WeakMap<THREE.Material, PsxMatOpts>();

/** Build (or fetch from the psx cache) a material and remember how it was made. */
export function psx(o: PsxMatOpts): THREE.Material {
  const m = psxMaterial(o);
  if (!optsOf.has(m)) optsOf.set(m, o);
  return m;
}

/** The vertex-coloured sibling of `m` (same material if it already uses vertex colours or is foreign). */
export function withVertexColors(m: THREE.Material): THREE.Material {
  const vc = (m as THREE.MeshBasicMaterial).vertexColors;
  if (vc) return m;
  const o = optsOf.get(m);
  if (o && !o.unique) return psx({ ...o, vertexColors: true });
  if (o) { (m as THREE.MeshBasicMaterial).vertexColors = true; m.needsUpdate = true; return m; }
  return m;   // foreign material: caller owns it, leave untouched
}

/** `MatLike` → material. `shade` = the geometry carries baked vertex colours. */
export function resolveMat(m: MatLike, shade: boolean): THREE.Material {
  if (typeof m === 'number') return psx({ color: m as Hex, vertexColors: shade });
  if ((m as THREE.Material).isMaterial) return shade ? withVertexColors(m as THREE.Material) : (m as THREE.Material);
  const o = m as PsxMatOpts;
  return psx({ ...o, vertexColors: o.vertexColors ?? shade });
}

/** Does this material read the `color` attribute? */
export const usesVertexColors = (m: THREE.Material): boolean => !!(m as THREE.MeshBasicMaterial).vertexColors;

/** The material's colour map, if any. */
export const mapOf = (m: THREE.Material): THREE.Texture | null => (m as THREE.MeshBasicMaterial).map ?? null;

// ── colour-agnostic base materials (used by `finalize` to merge differently coloured meshes into one draw) ──
export interface BaseMat {
  /** Identical for every material that differs only by colour. */
  key: string;
  /** White, vertex-coloured sibling (cached, shared). */
  material: THREE.Material;
  /** The colour the merge must multiply into the vertex colours. */
  tint: THREE.Color;
}
const bases = new Map<string, THREE.Material>();

/** `null` = this material cannot be recoloured (foreign, unique/mutated at runtime, scrolling, polygon-offset). */
export function baseMaterial(m: THREE.Material): BaseMat | null {
  if (!m.userData.psx || m.userData.shared === false) return null;
  const cpk = m.customProgramCacheKey?.() ?? '';
  if (!cpk.startsWith('psx|')) return null;
  const flags = cpk.slice(4);
  const mm = m as THREE.MeshLambertMaterial;
  if (flags.includes('PSX_SCROLL') || mm.polygonOffset || !mm.depthTest) return null;
  const lit = flags.includes('PSX_LIT');
  const additive = mm.blending === THREE.AdditiveBlending;
  const emissive = lit ? mm.emissive.getHex() : 0;
  const side = mm.side === THREE.DoubleSide ? 'double' : mm.side === THREE.BackSide ? 'back' : 'front';
  const snap = !flags.includes('PSX_NOSNAP'), affine = !flags.includes('PSX_NOAFFINE');
  const defaultDepthWrite = !mm.transparent && !additive;
  const key = [
    lit, mm.map?.uuid ?? '', emissive, lit ? mm.emissiveIntensity : 1, lit ? (mm.emissiveMap?.uuid ?? '') : '', mm.transparent,
    mm.opacity, mm.alphaTest, additive, side, mm.fog, mm.depthWrite, snap, affine,
  ].join('|');
  let material = bases.get(key);
  if (!material) {
    material = psx({
      color: 0xffffff, map: mm.map, emissive, emissiveIntensity: lit ? mm.emissiveIntensity : 1, emissiveMap: lit ? mm.emissiveMap : null,
      lit, vertexColors: true, transparent: mm.transparent, opacity: mm.opacity, alphaTest: mm.alphaTest, additive, side,
      fog: mm.fog, snap, affine, depthWrite: mm.depthWrite === defaultDepthWrite ? undefined : mm.depthWrite,
    });
    bases.set(key, material);
  }
  return { key, material, tint: mm.color.clone() };
}

// ── shader patching (keeps the PSX injection, adds a little GLSL of our own) ─────────────────────
export interface ShaderPatch {
  /** Declarations placed before `void main()` of the vertex shader (attributes, varyings, functions). */
  vertexDecl?: string;
  /** Statements right after the UV block (`vMapUv` is valid here). */
  vertexAfterUv?: string;
  /** Statements right after `begin_vertex` (`transformed` = position before skinning / instancing). */
  vertexAfterBegin?: string;
  /** Declarations before the fragment `main()`. */
  fragDecl?: string;
  /** Statements right after `color_fragment` (`diffuseColor` is final albedo × map × vertex colour). */
  fragAfterColor?: string;
}

/**
 * Wrap a PSX material's `onBeforeCompile` so extra GLSL is spliced into the programs it generates. `tag` joins the
 * program cache key (materials with different patches must never share a program). Call before the first render.
 */
export function patchShader(m: THREE.Material, tag: string, p: ShaderPatch): THREE.Material {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    let v = shader.vertexShader, f = shader.fragmentShader;
    if (p.vertexDecl) v = v.replace('void main() {', `${p.vertexDecl}\nvoid main() {`);
    if (p.vertexAfterUv) v = v.replace('#include <uv_vertex>', `#include <uv_vertex>\n${p.vertexAfterUv}`);
    if (p.vertexAfterBegin) v = v.replace('#include <begin_vertex>', `#include <begin_vertex>\n${p.vertexAfterBegin}`);
    if (p.fragDecl) f = f.replace('void main() {', `${p.fragDecl}\nvoid main() {`);
    if (p.fragAfterColor) f = f.replace('#include <color_fragment>', `#include <color_fragment>\n${p.fragAfterColor}`);
    shader.vertexShader = v;
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|${tag}`;
  return m;
}

/** Cracked-glaze pattern in object space (Voronoi edges, sparse patches): `psxCrack(p)` → 0 on a crack, 1 elsewhere. */
export const GLSL_CRACKS = /* glsl */`
vec3 psxH3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float psxCrack(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + psxH3(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float patchy = psxH3(floor(p * 0.5)).x;                    // only some regions are cracked
  float line = step(0.075, edge);
  return patchy > 0.42 ? line : 1.0;
}
`;
