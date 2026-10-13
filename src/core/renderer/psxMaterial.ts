/**
 * PSX material factory + shared shader library (CORE-RENDER). Contract: TECH_SPEC §2.3 / §11.7, ART_BIBLE §1.3–§1.9.
 *
 * `psxMaterial(opts)` returns a stock `MeshLambertMaterial` (lit) or `MeshBasicMaterial` (unlit) whose program text is
 * replaced in `onBeforeCompile`, so skinning, instancing, vertex colours, maps and fog keep working:
 *  - clip-space vertex snap (grid from the shared `uPsxSnapRes`), depth untouched;
 *  - affine texture mapping (`uv·w / w`), mixed with perspective UVs by the shared `uPsxAffine`;
 *  - Gouraud lighting evaluated per VERTEX from three's light uniforms (hemisphere/ambient + the 6-light pool),
 *    NOT divided by π: `lit = ambient + Σ colour·intensity·N·L·attenuation`, albedo × min(lit, 1.75) (PS1 overbright);
 *  - 16-band linear depth fog (lit ×1.0, unlit ×0.6, additive fades out instead of mixing).
 * Every PSX knob is a shared uniform (see {@link psxUniforms}); changing a setting never recompiles a program.
 *
 * Rules: cached materials (`unique` omitted) carry `userData.shared = true` and are never disposed by callers; a
 * `unique:true` material is owned by the caller. `material.clone()` is overridden to return another unique PSX
 * material (a plain `clone` would silently lose the injection). Textures are forced to nearest/no-mips/no-sRGB.
 */
import * as THREE from 'three';
import type { PsxMatOpts, PsxUniforms } from './types';

// Hex colours must appear on screen exactly as written (set as early as possible: this module loads before main()).
THREE.ColorManagement.enabled = false;

/** The renderer's public uniforms plus two private extras used by materials, particles and the post pass. */
export interface PsxSharedUniforms extends PsxUniforms {
  /** Internal resolution in px (text/popText snapping). */
  uPsxLowRes: { value: THREE.Vector2 };
  /** Multiplier on the scene fog near/far; the renderer keeps it at 1 (draw distance is baked into THREE.Fog, see fog.ts). */
  uPsxFogScale: { value: number };
}

/** THE shared uniform object — every psx program references these exact `{value}` holders. */
export const psxUniforms: PsxSharedUniforms = {
  uPsxSnapRes: { value: new THREE.Vector2(200, 112) },
  uPsxSnap: { value: 1 },
  uPsxAffine: { value: 1 },
  uTime: { value: 0 },
  uPsxLowRes: { value: new THREE.Vector2(400, 225) },
  uPsxFogScale: { value: 1 },
};

// ── GLSL snippets shared with the particle / text shaders (fx) ───────────────────────────────────
/** 4×4 Bayer in [0,1): `psxBayer4(gl_FragCoord.xy)`. Same matrix as the post pass (TECH_SPEC §2.3). */
export const GLSL_BAYER = /* glsl */`
float psxBayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float psxBayer4(vec2 a) { return psxBayer2(0.5 * a) * 0.25 + psxBayer2(a); }
`;

/**
 * 16-band depth fog. Needs `#include <fog_pars_fragment>` before it. `amt` scales the mix (unlit = 0.6);
 * `additive > 0.5` fades the colour to black instead (additive blending must never brighten with distance).
 */
export const GLSL_FOG_FRAG = /* glsl */`
uniform float uPsxFogScale;
vec3 psxApplyFog(vec3 col, float amt, float additive) {
#ifdef USE_FOG
  float f;
  #ifdef FOG_EXP2
    f = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    f = clamp((vFogDepth - fogNear * uPsxFogScale) / max((fogFar - fogNear) * uPsxFogScale, 0.001), 0.0, 1.0);
  #endif
  f = floor(f * 16.0 + 0.5) / 16.0;
  col = additive > 0.5 ? col * (1.0 - f) : mix(col, fogColor, f * amt);
#endif
  return col;
}
`;

/** Snap helper for vertex shaders that move a whole sprite rigidly: NDC shift that puts `clipC` on the PSX grid. */
export const GLSL_SNAP_SHIFT = /* glsl */`
uniform vec2 uPsxSnapRes;
uniform float uPsxSnap;
vec2 psxSnapShift(vec4 clipC) {
  if (uPsxSnap < 0.5 || clipC.w < 0.05) return vec2(0.0);
  vec2 n = clipC.xy / clipC.w;
  return floor(n * uPsxSnapRes + 0.5) / uPsxSnapRes - n;
}
`;

// ── program text ─────────────────────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
uniform vec2 uPsxSnapRes;
uniform float uPsxSnap;
uniform float uTime;
uniform vec2 uPsxScroll;
#ifdef USE_MAP
  varying vec3 vPsxAffMap;
#endif
#ifdef USE_EMISSIVEMAP
  varying vec3 vPsxAffEm;
#endif

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

#ifdef PSX_LIT
  #include <lights_pars_begin>
  varying vec3 vPsxLight;
  #ifdef DOUBLE_SIDED
    varying vec3 vPsxLightB;
  #endif
  vec3 psxLighting(vec3 P, vec3 N) {
    vec3 lit = ambientLightColor;
    #if NUM_HEMI_LIGHTS > 0
      for (int i = 0; i < NUM_HEMI_LIGHTS; i++) lit += getHemisphereLightIrradiance(hemisphereLights[i], N);
    #endif
    IncidentLight dl;
    #if NUM_POINT_LIGHTS > 0
      for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
        getPointLightInfo(pointLights[i], P, dl);
        lit += dl.color * max(dot(N, dl.direction), 0.0);
      }
    #endif
    #if NUM_SPOT_LIGHTS > 0
      for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
        getSpotLightInfo(spotLights[i], P, dl);
        lit += dl.color * max(dot(N, dl.direction), 0.0);
      }
    #endif
    #if NUM_DIR_LIGHTS > 0
      for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
        getDirectionalLightInfo(directionalLights[i], dl);
        lit += dl.color * max(dot(N, dl.direction), 0.0);
      }
    #endif
    #if NUM_SUN_LIGHTS > 0
      for (int i = 0; i < NUM_SUN_LIGHTS; i++) {
        getSunLightInfo(sunLights[i], dl);
        lit += dl.color * max(dot(N, dl.direction), 0.0);
      }
    #endif
    return lit;
  }
#endif

void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <batching_vertex>

  #ifdef PSX_LIT
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
  #endif
  #include <skinbase_vertex>
  #ifdef PSX_LIT
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
  #endif

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  #ifdef PSX_LIT
    vec3 psxN = transformedNormal;
    float psxNL = length(psxN);
    psxN = psxNL > 1e-4 ? psxN / psxNL : vec3(0.0, 0.0, 1.0);
    vPsxLight = psxLighting(mvPosition.xyz, psxN);
    #ifdef DOUBLE_SIDED
      vPsxLightB = psxLighting(mvPosition.xyz, -psxN);
    #endif
  #endif

  #ifndef PSX_NOSNAP
    if (uPsxSnap > 0.5 && gl_Position.w > 0.05) {
      vec2 n = gl_Position.xy / gl_Position.w;
      n = floor(n * uPsxSnapRes + 0.5) / uPsxSnapRes;
      gl_Position.xy = n * gl_Position.w;
    }
  #endif

  #ifdef PSX_SCROLL
    #ifdef USE_MAP
      vMapUv += uPsxScroll * uTime;
    #endif
  #endif
  #ifdef USE_MAP
    vPsxAffMap = vec3(vMapUv * gl_Position.w, gl_Position.w);
  #endif
  #ifdef USE_EMISSIVEMAP
    vPsxAffEm = vec3(vEmissiveMapUv * gl_Position.w, gl_Position.w);
  #endif

  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
uniform vec3 diffuse;
uniform float opacity;
uniform float uPsxAffine;
#ifdef PSX_LIT
  uniform vec3 emissive;
  varying vec3 vPsxLight;
  #ifdef DOUBLE_SIDED
    varying vec3 vPsxLightB;
  #endif
#endif
#ifdef USE_MAP
  varying vec3 vPsxAffMap;
#endif
#ifdef USE_EMISSIVEMAP
  varying vec3 vPsxAffEm;
#endif

#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphatest_pars_fragment>
#include <emissivemap_pars_fragment>
#include <fog_pars_fragment>
${GLSL_FOG_FRAG}

void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);

  #ifdef USE_MAP
    vec2 psxUv = vMapUv;
    #ifndef PSX_NOAFFINE
      psxUv = mix(vMapUv, vPsxAffMap.xy / max(vPsxAffMap.z, 1e-4), uPsxAffine);
    #endif
    diffuseColor *= texture2D(map, psxUv);
  #endif
  #include <color_fragment>
  #include <alphatest_fragment>

  #ifdef PSX_LIT
    vec3 totalEmissiveRadiance = emissive;
    #ifdef USE_EMISSIVEMAP
      vec2 psxUvE = vEmissiveMapUv;
      #ifndef PSX_NOAFFINE
        psxUvE = mix(vEmissiveMapUv, vPsxAffEm.xy / max(vPsxAffEm.z, 1e-4), uPsxAffine);
      #endif
      totalEmissiveRadiance *= texture2D(emissiveMap, psxUvE).rgb;
    #endif
    #ifdef DOUBLE_SIDED
      vec3 psxLit = gl_FrontFacing ? vPsxLight : vPsxLightB;
    #else
      vec3 psxLit = vPsxLight;
    #endif
    vec3 outgoingLight = diffuseColor.rgb * min(psxLit, vec3(1.75)) + totalEmissiveRadiance;
  #else
    vec3 outgoingLight = diffuseColor.rgb;
  #endif

  #include <opaque_fragment>
  #ifdef PSX_ADD
    gl_FragColor.rgb = psxApplyFog(gl_FragColor.rgb, 1.0, 1.0);
  #else
    gl_FragColor.rgb = psxApplyFog(gl_FragColor.rgb, PSX_FOG_AMT, 0.0);
  #endif
}
`;

// ── factory ──────────────────────────────────────────────────────────────────────────────────────
type PsxMaterial = THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
const cache = new Map<string, PsxMaterial>();
const sourceCache = new Map<string, { vertex: string; fragment: string }>();

/** Force the PSX texture state. Re-uploads once if a sRGB tag (GLTF) would have made the GPU decode to linear. */
export function psxTexture(t: THREE.Texture | null | undefined): void {
  if (!t) return;
  let dirty = false;
  if (t.magFilter !== THREE.NearestFilter) t.magFilter = THREE.NearestFilter;
  if (t.minFilter !== THREE.NearestFilter) t.minFilter = THREE.NearestFilter;
  if (t.generateMipmaps) t.generateMipmaps = false;
  t.anisotropy = 1;
  if (t.colorSpace === THREE.SRGBColorSpace) { t.colorSpace = THREE.NoColorSpace; dirty = true; }
  if (dirty) t.needsUpdate = true;
}

function cacheKey(o: PsxMatOpts): string {
  return [
    o.color ?? 0xffffff, o.map?.uuid ?? '', o.emissive ?? 0, o.emissiveIntensity ?? 1, o.emissiveMap?.uuid ?? '',
    o.lit ?? true, o.vertexColors ?? false, o.transparent ?? false, o.opacity ?? 1, o.alphaTest ?? 0,
    o.additive ?? false, o.side ?? 'front', o.fog ?? true, o.snap ?? true, o.affine ?? true,
    o.scroll ? `${o.scroll[0]},${o.scroll[1]}` : '', o.depthWrite ?? '',
  ].join('|');
}

function sources(flags: string, lit: boolean): { vertex: string; fragment: string } {
  let s = sourceCache.get(flags);
  if (!s) {
    const head = flags.split(' ').filter(Boolean).map((f) => `#define ${f}`).join('\n') + '\n';
    s = {
      vertex: head + VERT,
      fragment: head + `#define PSX_FOG_AMT ${lit ? '1.0' : '0.6'}\n` + FRAG,
    };
    sourceCache.set(flags, s);
  }
  return s;
}

function build(o: PsxMatOpts, unique: boolean): PsxMaterial {
  psxTexture(o.map); psxTexture(o.emissiveMap);
  const lit = o.lit ?? true;
  const additive = o.additive === true;
  const opacity = o.opacity ?? 1;
  const transparent = !!o.transparent || additive || opacity < 1;
  if (o.scroll && o.map) { o.map.wrapS = THREE.RepeatWrapping; o.map.wrapT = THREE.RepeatWrapping; }

  const common = {
    color: o.color ?? 0xffffff,
    map: o.map ?? null,
    vertexColors: !!o.vertexColors,
    transparent,
    opacity,
    alphaTest: o.alphaTest ?? 0,
    side: o.side === 'double' ? THREE.DoubleSide : o.side === 'back' ? THREE.BackSide : THREE.FrontSide,
    fog: o.fog ?? true,
    depthWrite: o.depthWrite ?? (!transparent && !additive),
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  };
  const m: PsxMaterial = lit
    ? new THREE.MeshLambertMaterial({
      ...common, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1, emissiveMap: o.emissiveMap ?? null,
    })
    : new THREE.MeshBasicMaterial(common);

  const flags = [
    lit ? 'PSX_LIT' : '',
    o.snap === false ? 'PSX_NOSNAP' : '',
    o.affine === false ? 'PSX_NOAFFINE' : '',
    additive ? 'PSX_ADD' : '',
    o.scroll ? 'PSX_SCROLL' : '',
  ].filter(Boolean).join(' ');
  const scroll = new THREE.Vector2(o.scroll?.[0] ?? 0, o.scroll?.[1] ?? 0);

  m.onBeforeCompile = (shader) => {
    const src = sources(flags, lit);
    shader.vertexShader = src.vertex;
    shader.fragmentShader = src.fragment;
    shader.uniforms.uPsxSnapRes = psxUniforms.uPsxSnapRes;
    shader.uniforms.uPsxSnap = psxUniforms.uPsxSnap;
    shader.uniforms.uPsxAffine = psxUniforms.uPsxAffine;
    shader.uniforms.uTime = psxUniforms.uTime;
    shader.uniforms.uPsxFogScale = psxUniforms.uPsxFogScale;
    shader.uniforms.uPsxScroll = { value: scroll };
  };
  m.customProgramCacheKey = () => `psx|${flags}`;
  m.userData.shared = !unique;
  m.userData.psx = true;
  // `clone()` of a plain material would drop onBeforeCompile; hand out another PSX material instead.
  m.clone = function cloneMaterial(this: PsxMaterial): PsxMaterial {
    const c = build({ ...o, unique: true }, true);
    c.name = this.name;
    c.color.copy(this.color);
    c.opacity = this.opacity;
    c.transparent = this.transparent;
    c.side = this.side;
    c.depthWrite = this.depthWrite;
    c.depthTest = this.depthTest;
    c.alphaTest = this.alphaTest;
    c.blending = this.blending;
    c.visible = this.visible;
    c.map = this.map;
    if (this instanceof THREE.MeshLambertMaterial && c instanceof THREE.MeshLambertMaterial) {
      c.emissive.copy(this.emissive);
      c.emissiveIntensity = this.emissiveIntensity;
      c.emissiveMap = this.emissiveMap;
    }
    return c;
  } as typeof m.clone;
  return m;
}

/**
 * The factory every mesh in the game uses. Cached by opts (+ texture uuids) unless `unique:true`.
 * Safe to call with no argument (white, lit).
 */
export function psxMaterial(o: PsxMatOpts = {}): PsxMaterial {
  if (o.unique) return build(o, true);
  const key = cacheKey(o);
  let m = cache.get(key);
  if (!m) { m = build(o, false); cache.set(key, m); }
  return m;
}

const sideOf = (s: number): NonNullable<PsxMatOpts['side']> =>
  s === THREE.DoubleSide ? 'double' : s === THREE.BackSide ? 'back' : 'front';

/**
 * Convert any stock material (e.g. a GLTF `MeshStandardMaterial`) to a UNIQUE PSX material, keeping colour, map,
 * emissive, opacity, side and alpha test. `extra` overrides. Used by the mannequin loader.
 */
export function psxFromMaterial(src: THREE.Material, extra: Partial<PsxMatOpts> = {}): PsxMaterial {
  const m = src as Partial<THREE.MeshStandardMaterial> & THREE.Material;
  return psxMaterial({
    color: m.color ? m.color.getHex() : 0xffffff,
    map: m.map ?? null,
    emissive: m.emissive ? m.emissive.getHex() : 0,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    emissiveMap: m.emissiveMap ?? null,
    vertexColors: !!m.vertexColors,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: sideOf(m.side),
    ...extra,
    unique: true,
  });
}

/** Free every cached material (app shutdown / hot reload only; callers never do this). */
export function disposePsxMaterialCache(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
