/**
 * Scary-model layer for the animated mannequin (kit, "scary models" pass). Pure helpers, no actor state:
 *  - `headBoxOf`: the head's bounds in the GLB's own space, read from skin weights (vertices bound mostly to `Head`);
 *  - `patchLook`: a PSX material patch (on top of `psx()`) that paints dark eye sockets, a too-wide painted smile (or
 *    nothing: a blank face), cracked porcelain, and a dim cold rim light. The face is painted in rest-pose object space
 *    (`transformed`, before skinning), so it stays on the head when the head turns and never swims during a clip;
 *  - `seeded`: a deterministic generator (mulberry32) for every per-actor random choice (seeded rng only);
 *  - `idleRefPose`: the first-frame bone rotations of an idle clip, used to hold the arms and spine stiff.
 * Everything runs in the mannequin's own materials: no extra draw call, the same LOD tiers, the same program per flags.
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { GLSL_CRACKS } from './materials';
import { npcFrame } from '@/core/renderer/npcFrame';

/** Head bounds in the geometry space the shader reads (`transformed`): centre and half-extents. */
export interface HeadBox { c: THREE.Vector3; r: THREE.Vector3 }

/** Mulberry32: a small deterministic generator in [0, 1). Same seed, same sequence. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bounds of the vertices bound (weight > 0.5) to the `Head` joint, over every skinned mesh of the model. */
export function headBoxOf(skins: readonly THREE.SkinnedMesh[]): HeadBox | null {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let n = 0;
  for (const sm of skins) {
    const bi = sm.skeleton.bones.findIndex((b) => b.name === 'Head');
    const g = sm.geometry;
    const idx = g.getAttribute('skinIndex'), w = g.getAttribute('skinWeight'), pos = g.getAttribute('position');
    if (bi < 0 || !idx || !w || !pos) continue;
    for (let i = 0; i < pos.count; i++) {
      let headW = 0;
      for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bi) headW += w.getComponent(i, k);
      if (headW <= 0.5) continue;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      lo.set(Math.min(lo.x, x), Math.min(lo.y, y), Math.min(lo.z, z));
      hi.set(Math.max(hi.x, x), Math.max(hi.y, y), Math.max(hi.z, z));
      n++;
    }
  }
  if (n < 8) return null;
  const c = lo.clone().add(hi).multiplyScalar(0.5);
  const r = hi.clone().sub(lo).multiplyScalar(0.5);
  r.set(Math.max(r.x, 1e-3), Math.max(r.y, 1e-3), Math.max(r.z, 1e-3));
  return { c, r };
}

export interface LookPatch {
  /** Cracked-glaze tint on the body (porcelain). */
  cracks: boolean;
  /** Dark eye sockets, 0..1. */
  sockets: number;
  /** Painted smile, 0..1; 0 leaves a blank face. */
  smile: number;
  /** Head bounds; null = no face painting (the material still gets the rim). */
  head: HeadBox | null;
  /** Rim light colour (added after lighting, so it stays dim and cold). */
  rim: Hex;
}

const rimVec = (h: Hex): THREE.Vector3 => new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);

/** Face painter in normalised head space (x: ±1 across the skull, y: up, z: +1 = the front the GLB faces). */
const GLSL_FACE = /* glsl */`
vec3 mqFace(vec3 col) {
  vec3 hp = (vMqObj - uHeadC) / max(uHeadR, vec3(1e-3));
  float front = smoothstep(0.1, 0.6, hp.z);
  vec2 ed = vec2(abs(hp.x) - 0.45, (hp.y - 0.15) * 1.5);
  float sock = (1.0 - smoothstep(0.2, 0.36, length(ed))) * front * uFace.x;
  col = mix(col, vec3(0.03, 0.02, 0.03), sock);
  float yc = -0.5 + 0.7 * hp.x * hp.x;
  float band = (1.0 - smoothstep(0.035, 0.09, abs(hp.y - yc))) * (1.0 - smoothstep(0.8, 0.95, abs(hp.x))) * front * uFace.y;
  return mix(col, vec3(0.3, 0.04, 0.05), band);
}
`;

/**
 * Add the scary look to a lit PSX material (`unique`: each actor owns its own uniforms). Chains onto the material's
 * existing `onBeforeCompile`, so the PSX injection and any other patch keep working.
 */
export function patchLook(m: THREE.MeshLambertMaterial, p: LookPatch): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const uniforms = {
    uHeadC: { value: p.head ? p.head.c : new THREE.Vector3() },
    uHeadR: { value: p.head ? p.head.r : new THREE.Vector3(1, 1, 1) },
    uFace: { value: new THREE.Vector4(p.head ? p.sockets : 0, p.head ? p.smile : 0, 0, 0) },
    uRim: { value: rimVec(p.rim).multiplyScalar(0.34) },
  };
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    let v = shader.vertexShader, f = shader.fragmentShader;
    v = v.replace('void main() {', `varying vec3 vMqObj;\nvarying float vMqRim;\nvoid main() {`);
    v = v.replace('#include <begin_vertex>', `#include <begin_vertex>\n  vMqObj = transformed;`);
    v = v.replace('#include <project_vertex>', `#include <project_vertex>\n  vMqRim = pow(1.0 - abs(dot(normalize(transformedNormal), normalize(-mvPosition.xyz))), 2.4);`);
    f = f.replace('void main() {', `varying vec3 vMqObj;
varying float vMqRim;
uniform vec3 uHeadC;
uniform vec3 uHeadR;
uniform vec4 uFace;
uniform vec3 uRim;
${p.cracks ? GLSL_CRACKS : ''}
${GLSL_FACE}
void main() {`);
    const cracks = p.cracks ? '\n  diffuseColor.rgb *= mix(vec3(0.22, 0.17, 0.2), vec3(1.0), psxCrack(vMqObj * 6.0));' : '';
    f = f.replace('#include <color_fragment>', `#include <color_fragment>${cracks}\n  diffuseColor.rgb = mqFace(diffuseColor.rgb);`);
    f = f.replace('#include <opaque_fragment>', `outgoingLight += vMqRim * uRim;\n  #include <opaque_fragment>`);
    shader.vertexShader = v;
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|look${p.cracks ? 'c' : ''}`;
}

/**
 * First-frame rotations of an idle clip for the named bones (the "held" pose a stiff figure keeps close to). Keys are
 * bone names; a bone missing from the clip is left out.
 */
export function idleRefPose(clip: THREE.AnimationClip, bones: readonly string[]): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.quaternion')) continue;
    const bone = t.name.slice(0, -'.quaternion'.length);
    if (!bones.includes(bone) || out.has(bone)) continue;
    out.set(bone, new THREE.Quaternion(t.values[0], t.values[1], t.values[2], t.values[3]));
  }
  return out;
}

// ── dark other-dimension NPCs (w72 npc lane) ────────────────────────────────────────────────────
/** Per-character look options, read by the mannequin (kit `mannequin()`). `npc: false` exempts a body (remote avatars). */
export interface NpcOpts {
  /** Dark NPC look on the body and its attached props (default true). */
  npc?: boolean;
  /** Rim colour (default: cold cyan for house folk, blood red for the Collector). */
  rim?: Hex;
  /** Eye colour (default: the rim colour). */
  eyes?: Hex;
}

export interface NpcLook {
  /** Rim colour. */
  rim: Hex;
  /** Eye colour; null = no eyes (props, or a body with no head box). */
  eyes: Hex | null;
  /** Head bounds for the eye placement (bodies only). */
  head: HeadBox | null;
  /** Per-material shimmer amount, 0..1 (props use less). */
  shimmer: number;
}

/** Hash and value noise for the shimmer, the eye mask and the body darkening (shared by every NPC material). */
const GLSL_NPC = /* glsl */`
varying vec3 vNpcObj;
varying vec3 vNpcN;
varying vec3 vNpcV;
uniform vec3 uNpcRim;
uniform vec3 uNpcEye;
uniform vec3 uNpcHc;
uniform vec3 uNpcHr;
uniform vec3 uNpcFx;
uniform float uNpcT;
uniform float uNpcShimmer;
float npcHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float npcNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(npcHash(i), npcHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(npcHash(i + vec3(0.0, 1.0, 0.0)), npcHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(npcHash(i + vec3(0.0, 0.0, 1.0)), npcHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(npcHash(i + vec3(0.0, 1.0, 1.0)), npcHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
/** Two pinpoint eyes in the head box (normalised: x ±1 across the skull, y up, z front), inside the painted sockets. */
float npcEyeMask(vec3 o) {
  vec3 hp = (o - uNpcHc) / max(uNpcHr, vec3(1e-3));
  float front = smoothstep(0.1, 0.5, hp.z);
  float d = length(vec2(abs(hp.x) - 0.42, (hp.y - 0.14) * 1.4));
  return (1.0 - smoothstep(0.075, 0.105, d)) * front * uNpcFx.x;
}
vec3 npcBody(vec3 c) { return vec3(0.025, 0.022, 0.03) + c * 0.10; }
`;

/**
 * The dark NPC look on a lit PSX material: a near-black body with a faint suit hue, a three-band fresnel rim that reads
 * in the dark, two emissive eyes (bodies with a head box), and a stepped static shimmer (off in Calm Mode). Chains onto
 * the material's existing `onBeforeCompile` (run `patchLook` first on bodies), so the PSX injection keeps working.
 * Every NPC material shares one program (`|npc` key); rim, eyes and shimmer are per-material uniforms.
 */
export function patchNpc(m: THREE.MeshLambertMaterial, p: NpcLook): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  const eyes = p.eyes !== null && p.head !== null;
  const uniforms = {
    uNpcRim: { value: rimVec(p.rim) },
    uNpcEye: { value: rimVec(p.eyes ?? p.rim) },
    uNpcHc: { value: p.head ? p.head.c : new THREE.Vector3() },
    uNpcHr: { value: p.head ? p.head.r : new THREE.Vector3(1, 1, 1) },
    uNpcFx: { value: new THREE.Vector3(eyes ? 1 : 0, p.shimmer, 0) },
  };
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, uniforms, { uNpcT: npcFrame.uNpcT, uNpcShimmer: npcFrame.uNpcShimmer });
    let v = shader.vertexShader, f = shader.fragmentShader;
    v = v.replace('void main() {', `${GLSL_NPC}\nvoid main() {`);
    v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vNpcObj = transformed;');
    v = v.replace('#include <project_vertex>', '#include <project_vertex>\n  vNpcN = normalize(transformedNormal);\n  vNpcV = normalize(-mvPosition.xyz);');
    f = f.replace('void main() {', `${GLSL_NPC}\nvoid main() {`);
    f = f.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = npcBody(diffuseColor.rgb);');
    f = f.replace('outgoingLight += vMqRim * uRim;', '');
    f = f.replace('#include <opaque_fragment>', `{
    float npcF = pow(1.0 - abs(dot(normalize(vNpcN), normalize(vNpcV))), 2.2);
    npcF = floor(npcF * 3.0 + 0.5) / 3.0;
    float npcS = step(0.93, npcNoise(vNpcObj * 14.0 + vec3(0.0, uNpcT * 0.37, 0.0))) * 0.07 * uNpcShimmer * uNpcFx.y;
    outgoingLight += uNpcRim * (npcF * 0.30 + npcS) + uNpcEye * npcEyeMask(vNpcObj) * 1.4;
  }
  #include <opaque_fragment>`);
    shader.vertexShader = v;
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|npc`;
}
