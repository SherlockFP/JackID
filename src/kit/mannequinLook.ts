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
import { GLSL_CRACKS, psx } from './materials';
import { npcFrame } from '@/core/renderer/npcFrame';
import { scaleHex } from './palette';
import { buildOutfit, type Piece } from './mannequinOutfits';

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
  /** A painted anime face instead of the doll sockets and smile (Ada): iris, lips, brows and cheeks. */
  anime?: AnimeFace;
}

export interface AnimeFace { iris: Hex; lip: Hex; brow: Hex; blush: Hex }

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
 * Ada's face, painted in the same head space: big eyes (white, an iris dark at the top and warm at the bottom, a pupil, one
 * catchlight on the same side for both eyes, a thick upper lash line with a flick), thin arched brows, a hint of a nose, a small
 * smile and soft cheeks. Every mark is a hard-edged shape: it stays crisp at the 360-line frame.
 */
const GLSL_FACE_ANIME = /* glsl */`
uniform vec3 uIris;
uniform vec3 uLip;
uniform vec3 uBrow;
uniform vec3 uBlush;
vec3 mqFace(vec3 col) {
  vec3 hp = (vMqObj - uHeadC) / max(uHeadR, vec3(1e-3));
  float front = smoothstep(0.35, 0.7, hp.z);
  float ax = abs(hp.x), sx = sign(hp.x);
  float bl = 1.0 - smoothstep(0.04, 0.2, length(vec2(ax - 0.5, (hp.y + 0.2) * 1.8)));
  col = mix(col, uBlush, bl * 0.4 * front);
  float nose = 1.0 - step(0.035, length(vec2(hp.x, (hp.y + 0.22) * 0.8)));
  col = mix(col, col * 0.8, nose * front);
  float my = -0.47 + 1.1 * hp.x * hp.x;
  float mouth = (1.0 - step(0.026, abs(hp.y - my))) * (1.0 - step(0.13, ax));
  col = mix(col, uLip, mouth * front);
  float by = 0.34 - 1.1 * (ax - 0.36) * (ax - 0.36);
  float brow = (1.0 - step(0.028, abs(hp.y - by))) * step(0.2, ax) * (1.0 - step(0.58, ax));
  col = mix(col, uBrow, brow * front);
  vec2 e = vec2(ax - 0.37, hp.y - 0.04);
  float ed = length(e / vec2(0.2, 0.17));
  float id = length(vec2(ax - 0.35, hp.y - 0.03) / vec2(0.125, 0.16));
  float top = clamp((hp.y - 0.03) / 0.32 + 0.5, 0.0, 1.0);
  vec3 iris = mix(uIris * 1.45, uIris * 0.38, top);
  iris = mix(iris, uIris * 0.15, 1.0 - step(0.45, id));
  vec3 eye = mix(vec3(0.97, 0.95, 0.93), iris, 1.0 - step(1.0, id));
  eye = mix(eye, vec3(1.0), 1.0 - step(0.05, length(vec2(hp.x - sx * 0.35 + 0.05, hp.y - 0.1))));
  col = mix(col, eye, (1.0 - step(1.0, ed)) * front);
  float lash = (step(0.74, ed) - step(1.3, ed)) * step(0.0, e.y);
  lash = max(lash, 1.0 - step(1.0, length(vec2(ax - 0.6, hp.y - 0.11) / vec2(0.07, 0.035))));
  lash = max(lash, (step(0.92, ed) - step(1.1, ed)) * step(e.y, -0.07) * 0.6);
  return mix(col, uBrow * 0.45, lash * front);
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
    uIris: { value: rimVec(p.anime?.iris ?? 0) },
    uLip: { value: rimVec(p.anime?.lip ?? 0) },
    uBrow: { value: rimVec(p.anime?.brow ?? 0) },
    uBlush: { value: rimVec(p.anime?.blush ?? 0) },
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
${p.anime && p.head ? GLSL_FACE_ANIME : GLSL_FACE}
void main() {`);
    const cracks = p.cracks ? '\n  diffuseColor.rgb *= mix(vec3(0.22, 0.17, 0.2), vec3(1.0), psxCrack(vMqObj * 6.0));' : '';
    f = f.replace('#include <color_fragment>', `#include <color_fragment>${cracks}\n  diffuseColor.rgb = mqFace(diffuseColor.rgb);`);
    f = f.replace('#include <opaque_fragment>', `outgoingLight += vMqRim * uRim;\n  #include <opaque_fragment>`);
    shader.vertexShader = v;
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|look${p.cracks ? 'c' : ''}${p.anime && p.head ? 'a' : ''}`;
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
  /** Eye glow gain (default 1; a softer glow < 1). */
  eyeGain?: number;
  /** Extra eye size, 0 = the usual pinpoints, 0.35 = larger anime eyes. */
  eyeSize?: number;
  /** How much of the base colour survives the near-black body (default 0.10; dresses and hair use more). */
  lift?: number;
  /** Rim brightness multiplier (default 1): a dim room needs a stronger rim to read the figure. */
  rimGain?: number;
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
uniform float uNpcLift;
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
  float d = length(vec2(abs(hp.x) - 0.42, (hp.y - 0.14) * 1.4)) / (1.0 + uNpcFx.z);
  return ((1.0 - smoothstep(0.075, 0.105, d)) + (1.0 - smoothstep(0.1, 0.24, d)) * 0.16) * front * uNpcFx.x;
}
vec3 npcBody(vec3 c) { return vec3(0.025, 0.022, 0.03) + c * uNpcLift; }
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
    uNpcRim: { value: rimVec(p.rim).multiplyScalar(p.rimGain ?? 1) },
    uNpcEye: { value: rimVec(p.eyes ?? p.rim).multiplyScalar(p.eyeGain ?? 1) },
    uNpcHc: { value: p.head ? p.head.c : new THREE.Vector3() },
    uNpcHr: { value: p.head ? p.head.r : new THREE.Vector3(1, 1, 1) },
    uNpcFx: { value: new THREE.Vector3(eyes ? 1 : 0, p.shimmer, p.eyeSize ?? 0) },
    uNpcLift: { value: p.lift ?? 0.10 },
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
    float npcD = 1.0 - abs(dot(normalize(vNpcN), normalize(vNpcV)));
    float npcF = floor(pow(npcD, 2.2) * 3.0 + 0.5) / 3.0;
    float npcS = step(0.93, npcNoise(vNpcObj * 14.0 + vec3(0.0, uNpcT * 0.37, 0.0))) * 0.07 * uNpcShimmer * uNpcFx.y;
    // well formed: a crisp line at the very edge (the figure reads whole) and a faint top light (shoulders, crown, forearms)
    float npcForm = step(0.86, npcD) * 0.3 + max(normalize(vNpcN).y, 0.0) * 0.08;
    // from elsewhere: thin bands drift up through the rim, stepped with the shimmer clock (still in Calm Mode)
    float npcDrift = step(0.88, fract(vNpcObj.y * 7.0 - uNpcT * 0.05)) * npcF * 0.3 * uNpcShimmer;
    outgoingLight += uNpcRim * (npcF * 0.44 + npcS + npcForm + npcDrift) + uNpcEye * npcEyeMask(vNpcObj) * 1.4;
  }
  #include <opaque_fragment>`);
    shader.vertexShader = v;
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|npc`;
}

// ── the female option (w80 ada redesign, w88 art pass): slimmer build, a ponytail with her hair tie, a long-sleeved dress ──
/** Bone scales (x and z; y stays 1, so no bone gets longer or shorter along itself). Effective: hips 1.05, waist 0.84, chest 0.88, neck 0.85, head 1.04, hands 0.9 (slimmer palms and fingers). */
export const FEMALE_SCALES: ReadonlyArray<readonly [string, number]> = [
  ['pelvis', 1.05], ['spine_01', 0.8], ['spine_02', 1.05], ['spine_03', 1], ['neck_01', 0.97], ['Head', 1.22],
  ['thigh_l', 0.88], ['thigh_r', 0.88], ['hand_l', 0.9], ['hand_r', 0.9],
];
/** Limb scale once the clip pose is restored (replaces the automaton's 6 % long limbs): slimmer arms, no stretch. */
export const FEMALE_LIMB = new THREE.Vector3(0.88, 1, 0.88);

const HAIR_PIVOT = new THREE.Vector3(0, 0.18, -0.1);
/** Ada's hair tie (the keepsake): a red band at the root of her ponytail. */
export const HAIR_TIE = 0xc8303c;
/** The rig's skull in Head-bone space (the head box: centre y 0.121, half-size 0.087 x 0.139 x 0.115; the face is at z +0.11). */
const SKULL = { y: 0.121, z: 0.003, rx: 0.087, ry: 0.139, rz: 0.115 } as const;
/** z of a point `lift` off the face at (x, y): the skull ellipsoid, clamped at the sides. */
const faceZ = (x: number, y: number, lift: number): number =>
  SKULL.z + SKULL.rz * Math.sqrt(Math.max(0.04, 1 - (x / SKULL.rx) ** 2 - ((y - SKULL.y) / SKULL.ry) ** 2)) + lift;

type RibbonPt = readonly [number, number, number, number];
interface Strands { pos: number[]; col: number[]; idx: number[] }
/** Add a tapered strip along `pts` ([x, y, z, half-width], width along x) with a vertex shade per point (root to tip). */
function ribbon(s: Strands, pts: readonly RibbonPt[], shade: (t: number) => number): void {
  const base = s.pos.length / 3;
  pts.forEach(([x, y, z, w], i) => {
    const k = shade(i / Math.max(1, pts.length - 1));
    s.pos.push(x - w, y, z, x + w, y, z);
    s.col.push(k, k, k, k, k, k);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2;
    s.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function finishGeo(s: Strands): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
  g.setIndex(s.idx);
  g.computeVertexNormals();
  return g;
}

/** The cap: a skull shell 1 to 1.7 cm proud, open over the face and the jaw, a lighter "angel ring" band across the crown. */
function hairCap(): THREE.BufferGeometry {
  const sph = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.8);
  sph.scale(0.099, 0.152, 0.13);
  sph.translate(0, 0.124, -0.006);
  const p = sph.getAttribute('position'), ix = sph.getIndex()!;
  const s: Strands = { pos: [], col: [], idx: [] };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const k = y > 0.2 && y < 0.236 && z > -0.05 ? 1.22 : y < 0.1 ? 0.68 : 0.84;
    s.pos.push(p.getX(i), y, z);
    s.col.push(k, k, k);
  }
  for (let t = 0; t < ix.count; t += 3) {
    const a = ix.getX(t), b = ix.getX(t + 1), c = ix.getX(t + 2);
    const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    if (cy < 0.035) continue;                                           // above the nape
    if (cz > -0.01 && cy < 0.205 && Math.abs(cx) < 0.082) continue;    // the face
    if (cz > -0.03 && cy < 0.075) continue;                            // the jaw
    s.idx.push(a, b, c);
  }
  sph.dispose();
  return finishGeo(s);
}

/**
 * Ada's hair in Head-bone space (+Y up, +Z the face; crown at y 0.262): a cap with the face open, a layered fringe that stops at
 * the brows, two framing locks down to the jaw (all in `root`, one mesh), and a high ponytail tied with her red hair tie (the
 * keepsake) in `sway`, a second group that swings from the crown. About 400 triangles; vertex shade gives the crown its sheen and
 * the strands darker roots. Materials are the shared PSX cache.
 */
export function buildHair(color: Hex, tie: Hex = HAIR_TIE): { root: THREE.Group; sway: THREE.Group } {
  const mat = psx({ color, side: 'double', vertexColors: true });
  const s: Strands = { pos: [], col: [], idx: [] };
  const root2tip = (t: number): number => 0.8 + 0.25 * t;
  // fringe: a back row (wider, a little longer up) and a front row of pointed blades
  const blade = (x: number, yTip: number, w: number, lean: number, lift: number): void => {
    const pts: RibbonPt[] = [];
    for (const [t, ww] of [[0, w], [0.35, w * 1.1], [0.7, w * 0.62], [1, w * 0.06]] as const) {
      const y = 0.224 + (yTip - 0.224) * t, xx = x + lean * t;
      pts.push([xx, y, faceZ(xx, y, lift), ww]);
    }
    ribbon(s, pts, root2tip);
  };
  for (const [x, y] of [[-0.066, 0.18], [-0.033, 0.176], [0.002, 0.18], [0.036, 0.176], [0.066, 0.182]] as const) blade(x, y, 0.026, x * -0.06, 0.011);
  for (const [x, y, lean] of [[-0.075, 0.166, 0.012], [-0.05, 0.16, 0.006], [-0.018, 0.168, -0.004], [0.014, 0.158, 0.004], [0.046, 0.164, -0.006], [0.074, 0.17, -0.012]] as const) blade(x, y, 0.019, lean, 0.016);
  // framing locks in front of the ears, down to the jaw, the tips curling in
  for (const sd of [-1, 1]) {
    ribbon(s, [
      [sd * 0.086, 0.205, faceZ(0.086, 0.205, 0.02), 0.016], [sd * 0.092, 0.13, 0.06, 0.019], [sd * 0.09, 0.06, 0.068, 0.016],
      [sd * 0.082, 0.005, 0.07, 0.01], [sd * 0.072, -0.03, 0.066, 0.002],
    ], root2tip);
  }
  const root = new THREE.Group();
  root.name = 'ada_hair';
  root.add(new THREE.Mesh(mergeGeos([hairCap(), finishGeo(s)]), mat));
  // the ponytail: a tapered tube from the back of the crown, out and down to the shoulder blades
  const curve = new THREE.CatmullRomCurve3([
    [0, 0.205, -0.118], [0, 0.198, -0.168], [0, 0.12, -0.205], [0, 0.0, -0.205], [0, -0.13, -0.185], [0, -0.22, -0.16],
  ].map(([x, y, z]) => new THREE.Vector3(x, y - HAIR_PIVOT.y, z - HAIR_PIVOT.z)));
  const TS = 12, RS = 6;
  const tail = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  const tp = tail.getAttribute('position');
  const radius = (t: number): number => (t < 0.15 ? 0.024 + 0.12 * t : t < 0.45 ? 0.042 : 0.042 * (1 - (t - 0.45) / 0.55) + 0.003);
  const tcol: number[] = [];
  const at = new THREE.Vector3(), v = new THREE.Vector3();
  for (let j = 0; j <= TS; j++) {
    curve.getPointAt(j / TS, at);
    for (let k = 0; k <= RS; k++) {
      const i = j * (RS + 1) + k;
      v.fromBufferAttribute(tp, i).sub(at).multiplyScalar(radius(j / TS)).add(at);
      tp.setXYZ(i, v.x, v.y, v.z);
      const sh = 0.92 + 0.22 * Math.max(0, Math.sin((k / RS) * Math.PI * 2)) - 0.18 * (j / TS);
      tcol.push(sh, sh, sh);
    }
  }
  tail.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tail.deleteAttribute('uv');
  tail.computeVertexNormals();
  const sway = new THREE.Group();
  sway.name = 'ada_hair_sway';
  sway.position.copy(HAIR_PIVOT);
  sway.add(new THREE.Mesh(tail, mat));
  // the hair tie: a band round the root of the tail and a small bobble on top
  const tieMat = psx({ color: tie });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 5, 10), tieMat);
  curve.getPointAt(0.1, band.position);
  band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(0.1));
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), tieMat);
  bob.position.copy(band.position).add(new THREE.Vector3(0, 0.036, 0.004));
  sway.add(band, bob);
  root.add(sway);
  root.userData.npcLift = 0.16;
  return { root, sway };
}

/** Concatenate indexed or non-indexed geometries (position, normal, colour) into one indexed geometry. */
function mergeGeos(list: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const g of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color'), ix = g.getIndex();
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

export interface DressPiece { bone: string; obj: THREE.Group }

/**
 * Ada's dress in bone space (the shared outfit builder, mannequinOutfits.ts): a long-sleeved A-line dress to the knee with a dark
 * hem band and belt, white cuffs, a white round collar and a small red bow that matches her hair tie. Seated, the skirt stays inside
 * the chair seat's width (0.46 m) and ends above the knee. Build it before the female bone scales are applied.
 */
export function buildDress(bones: ReadonlyMap<string, THREE.Object3D>, color: Hex): DressPiece[] {
  const trim = 0xf4eee2, dark = scaleHex(color, 0.5);
  const pieces: Piece[] = [
    ...(['l', 'r'] as const).flatMap((s): Piece[] => [
      { k: 'tube', bone: `thigh_${s}`, to: `calf_${s}`, r: [0.124, 0.155], at: [-0.06, 0.86], c: color },
      { k: 'tube', bone: `thigh_${s}`, to: `calf_${s}`, r: [0.155, 0.16], at: [0.84, 0.92], c: dark },
      { k: 'tube', bone: `clavicle_${s}`, to: `upperarm_${s}`, r: [0.085, 0.1], at: [0.3, 1], c: color },
      { k: 'tube', bone: `upperarm_${s}`, to: `lowerarm_${s}`, r: [0.096, 0.082], at: [-0.25, 1], c: color },
      { k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.07, 0.066], at: [0, 0.85], c: color },
      { k: 'tube', bone: `lowerarm_${s}`, to: `hand_${s}`, r: [0.069, 0.069], at: [0.83, 0.97], c: trim },
    ]),
    { k: 'tube', bone: 'spine_01', to: 'spine_02', r: [0.136, 0.15], sq: 0.95, off: [0, 0, 0.02], c: color, seg: 10 },
    { k: 'tube', bone: 'spine_01', to: 'spine_02', r: [0.142, 0.146], at: [0, 0.32], sq: 0.95, off: [0, 0, 0.02], c: dark, seg: 10 },
    { k: 'tube', bone: 'spine_02', to: 'spine_03', r: [0.152, 0.164], off: [0, 0, 0.008], c: color, seg: 10 },
    { k: 'tube', bone: 'spine_03', to: 'neck_01', r: [0.172, 0.168], at: [0, 0.62], sq: 0.92, off: [0, 0, -0.016], c: color, seg: 10 },
    { k: 'tube', bone: 'spine_03', to: 'neck_01', r: [0.168, 0.098], at: [0.62, 0.96], sq: 0.92, off: [0, 0, -0.016], c: color, seg: 10 },
    { k: 'tube', bone: 'neck_01', to: 'Head', r: [0.1, 0.075], at: [-0.15, 0.28], c: trim, seg: 10 },
    { k: 'box', bone: 'neck_01', size: [0.052, 0.022, 0.014], pos: [0, 0.0, 0.088], c: HAIR_TIE },
    { k: 'box', bone: 'neck_01', size: [0.012, 0.04, 0.008], pos: [-0.012, -0.03, 0.086], rot: [0, 0, -18], c: HAIR_TIE },
    { k: 'box', bone: 'neck_01', size: [0.012, 0.04, 0.008], pos: [0.012, -0.03, 0.086], rot: [0, 0, 18], c: HAIR_TIE },
  ];
  return buildOutfit((n) => bones.get(n) ?? null, pieces).map((w) => {
    w.obj.name = `ada_dress_${w.bone}`;
    w.obj.userData.npcLift = 0.32;
    return { bone: w.bone, obj: w.obj as THREE.Group };
  });
}

/** A small deterministic wave envelope: 0 → 1 in 0.35 s, hold, 1 → 0 over the last 0.6 s of `dur`. */
export function waveEnv(t: number, dur: number): number {
  const k = (e0: number, e1: number, x: number): number => { const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
  return k(0, 0.35, t) * (1 - k(dur - 0.6, dur, t));
}
