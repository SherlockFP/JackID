/**
 * Pooled particle emitters (CORE-RENDER). Contract: FxApi (`fx/types.ts`), ART_BIBLE §9, TECH_SPEC §8 (≤ 512 / emitter,
 * ≤ 2 000 total, one draw call per emitter).
 *
 * Seven instanced-quad emitters, each ONE draw call, all sampling the shared sprite atlas (`atlas.ts`):
 *   coins   oriented quads, opaque cut-out, two-sided: ART §9.1 physics (gravity 9.81, restitution 0.35, lies flat),
 *           3-D tumble from an integrated quaternion, face shading + a glint when a face turns to the camera
 *   sparks  velocity-aligned additive streaks, floor bounce 0.3
 *   confetti oriented cut-out squares: terminal velocity 0.6 m/s, flutter, tumbling, shrink away
 *   puffs   billboard HALF-blend flip-book (smoke 12 fps, dust)
 *   lights  billboard additive (glow halo + star, embers, trail dots)
 *   drips   velocity-aligned streaks; splash = ripple ring decal
 *   decals  flat quads on the floor (scorch, stain, crack, hand, ripple), screen-door fade
 * Vertex snap uses the shared PSX grid on the sprite CENTRE (rigid shift), so tiny sprites stay crisp but wobble
 * like the rest of the world. Fog is the same 16-band depth cue as `psxMaterial`.
 */
import * as THREE from 'three';
import type { BurstOpts, ParticlePreset } from './types';
import type { Hex } from '../types';
import { app } from '../app';
import { createRng, randomSeed } from '../rng';
import { clamp } from '../math';
import { log } from '../log';
import { GLSL_BAYER, GLSL_FOG_FRAG, GLSL_SNAP_SHIFT, psxUniforms } from '../renderer/psxMaterial';
import { ATLAS_N, Cell, fxAtlas } from './atlas';
import type { FxSystem } from './layer';

// ── state layout (floats per particle) ───────────────────────────────────────────────────────────
const STRIDE = 28;
const PX = 0, PY = 1, PZ = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, SIZE = 8;
const QX = 10, QY = 11, QZ = 12, QW = 13, WX = 14, WY = 15, WZ = 16, ROT = 17, SPIN = 18, GRAV = 19, BOUNCE = 20;
const CR = 21, CG = 22, CB = 23, SEED = 24, FLOOR = 25, FLAG = 26, SUB = 27;

const rng = createRng(randomSeed());
const rnd = (): number => rng.next();
const rr = (a: number, b: number): number => a + (b - a) * rnd();
const TAU = Math.PI * 2;

// ── shaders ──────────────────────────────────────────────────────────────────────────────────────
const VERT = /* glsl */`
#include <fog_pars_vertex>
attribute vec4 aPosSize;
attribute vec4 aColor;
attribute vec4 aMisc;
attribute vec4 aQuat;
varying vec2 vLocal;
varying vec4 vColor;
varying float vCell;
varying float vShade;
${GLSL_SNAP_SHIFT}
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  vec3 c = aPosSize.xyz;
  float sz = aPosSize.w;
  vec2 corner = position.xy;
  vec4 mvPosition = viewMatrix * vec4(c, 1.0);
  vec4 clipC = projectionMatrix * mvPosition;
  vShade = 1.0;
  #if defined(K_BILLBOARD)
    float ca = cos(aMisc.x), sa = sin(aMisc.x);
    vec2 o = vec2(corner.x * ca - corner.y * sa, corner.x * sa + corner.y * ca) * sz;
    gl_Position = clipC + vec4((projectionMatrix * vec4(o, 0.0, 0.0)).xy, 0.0, 0.0);
  #elif defined(K_ORIENTED)
    vec3 wpos = c + qrot(aQuat, vec3(corner * sz, 0.0));
    mvPosition = viewMatrix * vec4(wpos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vec3 n = qrot(aQuat, vec3(0.0, 0.0, 1.0));
    float face = abs(dot(n, normalize(cameraPosition - c)));
    vShade = 0.62 + 0.38 * abs(n.y) + 0.85 * pow(face, 30.0);
  #elif defined(K_STREAK)
    vec2 d2 = (viewMatrix * vec4(aQuat.xyz, 0.0)).xy;
    float dl = length(d2);
    d2 = dl > 1e-4 ? d2 / dl : vec2(0.0, 1.0);
    float len = sz * (1.2 + min(aQuat.w, 12.0) * 0.25);
    vec2 o = d2 * corner.y * len + vec2(d2.y, -d2.x) * corner.x * sz;       // (perp, d2) is a proper rotation: keeps the winding
    gl_Position = clipC + vec4((projectionMatrix * vec4(o, 0.0, 0.0)).xy, 0.0, 0.0);
  #else
    float ca = cos(aMisc.x), sa = sin(aMisc.x);
    vec3 wpos = c + vec3(corner.x * ca - corner.y * sa, 0.0, corner.x * sa + corner.y * ca) * sz;
    mvPosition = viewMatrix * vec4(wpos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  #endif
  gl_Position.xy += psxSnapShift(clipC) * gl_Position.w;
  vLocal = uv;
  vColor = aColor;
  vCell = aMisc.y;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
uniform sampler2D uAtlas;
varying vec2 vLocal;
varying vec4 vColor;
varying float vCell;
varying float vShade;
#include <fog_pars_fragment>
${GLSL_FOG_FRAG}
${GLSL_BAYER}
void main() {
  float cell = vCell;
  vec2 lu = vLocal;
  #ifdef TWOSIDED
    if (!gl_FrontFacing) { cell += 1.0; lu.x = 1.0 - lu.x; }
  #endif
  lu = lu * 0.996 + 0.002;
  vec2 cr = vec2(mod(cell, ${ATLAS_N}.0), floor(cell / ${ATLAS_N}.0));
  vec4 t = texture2D(uAtlas, vec2((cr.x + lu.x) / ${ATLAS_N}.0, 1.0 - (cr.y + 1.0 - lu.y) / ${ATLAS_N}.0));
  vec4 c = vec4(t.rgb * vColor.rgb * vShade, t.a * vColor.a);
  #ifdef CUTOUT
    if (c.a < 0.5) discard;
  #endif
  #ifdef DITHER_FADE
    if (c.a < 0.02 || c.a < psxBayer4(gl_FragCoord.xy) * 0.97) discard;
  #endif
  c.rgb = psxApplyFog(c.rgb, 1.0, ADDITIVE);
  gl_FragColor = c;
}
`;

type Mode = 'billboard' | 'oriented' | 'streak' | 'flat';
type Blend = 'add' | 'normal' | 'opaque';
interface EmitterCfg {
  name: string; cap: number; mode: Mode; blend: Blend;
  cutout?: boolean; twoSided?: boolean; ditherFade?: boolean; order: number;
  step(e: Emitter, o: number, w: number, dt: number): void;
}

class Emitter {
  readonly mesh: THREE.Mesh;
  readonly geo = new THREE.InstancedBufferGeometry();
  readonly st: Float32Array;
  readonly aPosSize: Float32Array;
  readonly aColor: Float32Array;
  readonly aMisc: Float32Array;
  readonly aQuat: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  n = 0;
  tick = 0;

  constructor(readonly cfg: EmitterCfg, atlas: THREE.Texture) {
    const cap = cfg.cap;
    this.st = new Float32Array(cap * STRIDE);
    this.aPosSize = new Float32Array(cap * 4);
    this.aColor = new Float32Array(cap * 4);
    this.aMisc = new Float32Array(cap * 4);
    this.aQuat = new Float32Array(cap * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs = [
      this.inst('aPosSize', this.aPosSize), this.inst('aColor', this.aColor),
      this.inst('aMisc', this.aMisc), this.inst('aQuat', this.aQuat),
    ];
    this.geo.instanceCount = 0;

    const defines: Record<string, string | number> = { ADDITIVE: cfg.blend === 'add' ? '1.0' : '0.0' };
    defines[{ billboard: 'K_BILLBOARD', oriented: 'K_ORIENTED', streak: 'K_STREAK', flat: 'K_FLAT' }[cfg.mode]] = 1;
    if (cfg.cutout) defines.CUTOUT = 1;
    if (cfg.twoSided) defines.TWOSIDED = 1;
    if (cfg.ditherFade) defines.DITHER_FADE = 1;

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, defines,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uAtlas: { value: atlas },
        uPsxSnapRes: psxUniforms.uPsxSnapRes, uPsxSnap: psxUniforms.uPsxSnap, uPsxFogScale: psxUniforms.uPsxFogScale,
      },
      fog: true,
      transparent: cfg.blend !== 'opaque',
      depthWrite: cfg.blend === 'opaque',
      depthTest: true,
      blending: cfg.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
      // flat decals lie in XZ: the shared quad's winding faces DOWN from there, so they must not be back-face culled
      side: cfg.twoSided || cfg.mode === 'flat' ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: cfg.mode === 'flat', polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = cfg.order;
    this.mesh.visible = false;
    this.mesh.name = `fx:${cfg.name}`;
  }

  private inst(name: string, arr: Float32Array): THREE.InstancedBufferAttribute {
    const a = new THREE.InstancedBufferAttribute(arr, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute(name, a);
    return a;
  }

  /** Allocate a particle slot (overwriting round-robin when full); returns its state offset. */
  private evict = 0;

  spawn(): number {
    const cap = this.cfg.cap;
    let o: number;
    if (this.n >= cap) {
      // Full: overwrite via a ring cursor (O(1), no scan).
      this.evict = (this.evict + 1) % cap;
      o = this.evict * STRIDE;
    } else o = this.n++ * STRIDE;
    this.st.fill(0, o, o + STRIDE);
    this.st[o + QW] = 1;
    this.st[o + CR] = this.st[o + CG] = this.st[o + CB] = 1;
    this.st[o + SEED] = rnd();
    this.st[o + FLOOR] = Number.NaN;
    return o;
  }

  update(dt: number): void {
    if (this.n === 0) { this.mesh.visible = false; return; }
    this.tick++;
    const st = this.st;
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      const o = r * STRIDE;
      st[o + AGE] += dt;
      if (st[o + AGE] >= st[o + LIFE]) continue;
      if (w !== r) st.copyWithin(w * STRIDE, o, o + STRIDE);
      this.cfg.step(this, w * STRIDE, w, dt);
      w++;
    }
    this.n = w;
    this.geo.instanceCount = w;
    this.mesh.visible = w > 0;
    // only the live prefix is re-written by the steps above: upload [0, w) instead of the whole capacity
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (w > 0) a.addUpdateRange(0, w * 4);
      a.needsUpdate = true;
    }
  }

  /** Write the GPU record for slot `w`. */
  put(w: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number,
    rot: number, cell: number, qx = 0, qy = 0, qz = 0, qw = 1): void {
    const i = w * 4;
    this.aPosSize[i] = x; this.aPosSize[i + 1] = y; this.aPosSize[i + 2] = z; this.aPosSize[i + 3] = size;
    this.aColor[i] = r; this.aColor[i + 1] = g; this.aColor[i + 2] = b; this.aColor[i + 3] = a;
    this.aMisc[i] = rot; this.aMisc[i + 1] = cell; this.aMisc[i + 2] = 0; this.aMisc[i + 3] = 0;
    this.aQuat[i] = qx; this.aQuat[i + 1] = qy; this.aQuat[i + 2] = qz; this.aQuat[i + 3] = qw;
  }

  clear(): void { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
  dispose(): void { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
const hexR = (h: number): number => ((h >> 16) & 255) / 255;
const hexG = (h: number): number => ((h >> 8) & 255) / 255;
const hexB = (h: number): number => (h & 255) / 255;
const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3);

function setColor(st: Float32Array, o: number, c: Hex): void {
  st[o + CR] = hexR(c); st[o + CG] = hexG(c); st[o + CB] = hexB(c);
}
function pickColor(c: Hex | Hex[] | undefined, fallback: Hex | Hex[]): Hex {
  const v = c ?? fallback;
  return Array.isArray(v) ? v[(rnd() * v.length) | 0] : v;
}

/** Normalised random direction; `up` biases it into the upper hemisphere (0 = full sphere, 1 = flat-up cone). */
function randDir(out: number[], flat: boolean): void {
  const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
  out[0] = s * Math.cos(th); out[1] = flat ? 0 : u; out[2] = s * Math.sin(th);
  if (flat) { const l = Math.hypot(out[0], out[2]) || 1; out[0] /= l; out[2] /= l; }
}

function randomQuat(st: Float32Array, o: number): void {
  const u1 = rnd(), u2 = rnd() * TAU, u3 = rnd() * TAU;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  st[o + QX] = a * Math.sin(u2); st[o + QY] = a * Math.cos(u2); st[o + QZ] = b * Math.sin(u3); st[o + QW] = b * Math.cos(u3);
}

function integrateQuat(st: Float32Array, o: number, dt: number): void {
  const qx = st[o + QX], qy = st[o + QY], qz = st[o + QZ], qw = st[o + QW];
  const wx = st[o + WX], wy = st[o + WY], wz = st[o + WZ];
  const h = 0.5 * dt;
  let x = qx + h * (qw * wx + wy * qz - wz * qy);
  let y = qy + h * (qw * wy + wz * qx - wx * qz);
  let z = qz + h * (qw * wz + wx * qy - wy * qx);
  let w = qw + h * (-wx * qx - wy * qy - wz * qz);
  const l = 1 / (Math.hypot(x, y, z, w) || 1);
  x *= l; y *= l; z *= l; w *= l;
  st[o + QX] = x; st[o + QY] = y; st[o + QZ] = z; st[o + QW] = w;
}

/** Ease the orientation towards "lying flat, rotated by `yaw`". */
function settleQuat(st: Float32Array, o: number, yaw: number, k: number): void {
  const h = Math.SQRT1_2, s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
  let tx = -c * h, ty = s * h, tz = s * h, tw = c * h;
  const dot = st[o + QX] * tx + st[o + QY] * ty + st[o + QZ] * tz + st[o + QW] * tw;
  if (dot < 0) { tx = -tx; ty = -ty; tz = -tz; tw = -tw; }
  let x = st[o + QX] + (tx - st[o + QX]) * k;
  let y = st[o + QY] + (ty - st[o + QY]) * k;
  let z = st[o + QZ] + (tz - st[o + QZ]) * k;
  let w = st[o + QW] + (tw - st[o + QW]) * k;
  const l = 1 / (Math.hypot(x, y, z, w) || 1);
  x *= l; y *= l; z *= l; w *= l;
  st[o + QX] = x; st[o + QY] = y; st[o + QZ] = z; st[o + QW] = w;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ── preset table ─────────────────────────────────────────────────────────────────────────────────
interface Preset {
  speed: number; up: number; spread: number; life: [number, number]; size: number; gravity: number; spin: number; bounce: number;
}
const PRESETS: Record<ParticlePreset, Preset> = {
  coins:    { speed: 1.1, up: 2.3, spread: 0.06, life: [3.6, 4.2], size: 0.07, gravity: 9.81, spin: 20, bounce: 0.35 },
  sparks:   { speed: 3.2, up: 1.6, spread: 0.03, life: [0.35, 0.7], size: 0.1, gravity: 9.81, spin: 0, bounce: 0.3 },
  confetti: { speed: 2.2, up: 3.6, spread: 0.2, life: [4, 6], size: 0.06, gravity: 9.81, spin: 7, bounce: 0 },
  smoke:    { speed: 0.12, up: 0.25, spread: 0.12, life: [1.6, 2.4], size: 0.3, gravity: -0.2, spin: 0.6, bounce: 0 },
  dust:     { speed: 0.9, up: 0.35, spread: 0.2, life: [0.5, 0.9], size: 0.13, gravity: 0.2, spin: 1, bounce: 0 },
  glow:     { speed: 0, up: 0, spread: 0, life: [0.4, 0.4], size: 0.4, gravity: 0, spin: 0.8, bounce: 0 },
  embers:   { speed: 0.3, up: 0.6, spread: 0.1, life: [0.9, 1.5], size: 0.035, gravity: -0.5, spin: 0, bounce: 0 },
  drips:    { speed: 0.1, up: 0, spread: 0.05, life: [1.2, 1.8], size: 0.045, gravity: 9.81, spin: 0, bounce: 0 },
};
const SPARK_COLORS: Hex[] = [0xffce5a, 0xefd67b, 0xf7efde, 0xe69431];
const CONFETTI_COLORS: Hex[] = [0xe6dec5, 0xef5a4a, 0x63e6de, 0xefd67b, 0xff42a5, 0x5aff7b];
const SK = { smoke: 0, dust: 1, glow: 0, star: 3, ember: 1, trail: 2, ripple: 1 } as const;

// ── per-emitter physics ──────────────────────────────────────────────────────────────────────────
type FloorFn = (x: number, z: number, y: number) => number;
let floorFn: FloorFn = () => 0;
let clinkFn: (x: number, y: number, z: number, impact: number) => void = () => {};
let rippleFn: (x: number, y: number, z: number) => void = () => {};

/** Floor height below (x, y, z), cached per particle and refreshed every few frames. */
function floorOf(e: Emitter, o: number, w: number): number {
  const st = e.st;
  let f = st[o + FLOOR];
  if (Number.isNaN(f) || ((e.tick + w) & 7) === 0) {
    f = floorFn(st[o + PX], st[o + PZ], st[o + PY]);
    st[o + FLOOR] = f;
  }
  return f;
}

function stepCoin(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  const age = st[o + AGE], life = st[o + LIFE];
  if (st[o + FLAG] !== 1) {
    st[o + VY] -= st[o + GRAV] * dt;
    st[o + PX] += st[o + VX] * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += st[o + VZ] * dt;
    integrateQuat(st, o, dt);
    const f = floorOf(e, o, w) + 0.006;
    if (st[o + PY] < f && st[o + VY] < 0) {
      const impact = -st[o + VY];
      st[o + PY] = f;
      st[o + VY] = impact * st[o + BOUNCE];
      st[o + VX] *= 0.72; st[o + VZ] *= 0.72;
      st[o + WX] *= 0.55; st[o + WY] *= 0.55; st[o + WZ] *= 0.55;
      if (impact > 1.1) clinkFn(st[o + PX], f, st[o + PZ], impact);
      if (st[o + VY] < 0.5) { st[o + FLAG] = 1; st[o + VX] *= 0.3; st[o + VZ] *= 0.3; st[o + VY] = 0; }
    }
    if (st[o + PY] < -8) { st[o + AGE] = life; }
  } else {
    const k = Math.exp(-7 * dt);
    st[o + VX] *= k; st[o + VZ] *= k;
    st[o + PX] += st[o + VX] * dt; st[o + PZ] += st[o + VZ] * dt;
    settleQuat(st, o, st[o + SEED] * TAU, 1 - Math.exp(-16 * dt));
  }
  const remain = life - age;
  const s = st[o + SIZE] * Math.min(1, age / 0.04) * (remain < 0.25 ? remain / 0.25 : 1);
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], s, st[o + CR], st[o + CG], st[o + CB], 1, 0, Cell.coinFront,
    st[o + QX], st[o + QY], st[o + QZ], st[o + QW]);
}

function stepSpark(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  const a = st[o + AGE] / st[o + LIFE];
  st[o + VY] -= 9.81 * dt;
  const drag = Math.exp(-0.9 * dt);
  st[o + VX] *= drag; st[o + VZ] *= drag;
  st[o + PX] += st[o + VX] * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += st[o + VZ] * dt;
  const f = floorOf(e, o, w) + 0.01;
  if (st[o + PY] < f && st[o + VY] < 0) {
    st[o + PY] = f; st[o + VY] = -st[o + VY] * st[o + BOUNCE]; st[o + VX] *= 0.6; st[o + VZ] *= 0.6;
  }
  const speed = Math.hypot(st[o + VX], st[o + VY], st[o + VZ]);
  const hot = Math.min(1, a * 2.4);              // white-hot → tint
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], st[o + SIZE] * (1 - 0.4 * a),
    lerp(1, st[o + CR], hot), lerp(1, st[o + CG], hot), lerp(1, st[o + CB], hot), Math.pow(1 - a, 1.3), 0, Cell.streak,
    st[o + VX], st[o + VY], st[o + VZ], speed);
}

function stepConfetti(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  const age = st[o + AGE], life = st[o + LIFE];
  if (st[o + FLAG] !== 1) {
    // terminal velocity ≈ 0.6 m/s: drag towards a constant fall, plus a lateral flutter at ~3 Hz
    st[o + VY] -= 3 * (st[o + VY] + 0.6) * dt;      // relax towards a 0.6 m/s fall
    const ph = age * 18.8 + st[o + SEED] * 40;
    st[o + VX] += (Math.cos(ph) * 0.9 - st[o + VX] * 2.2) * dt;
    st[o + VZ] += (Math.sin(ph * 0.83) * 0.9 - st[o + VZ] * 2.2) * dt;
    st[o + PX] += st[o + VX] * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += st[o + VZ] * dt;
    integrateQuat(st, o, dt);
    const f = floorOf(e, o, w) + 0.004;
    if (st[o + PY] < f) { st[o + PY] = f; st[o + FLAG] = 1; }
  } else {
    settleQuat(st, o, st[o + SEED] * TAU, 1 - Math.exp(-14 * dt));
  }
  const remain = life - age;
  const s = st[o + SIZE] * Math.min(1, age / 0.05) * (remain < 0.5 ? remain / 0.5 : 1);
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], s, st[o + CR], st[o + CG], st[o + CB], 1, 0, Cell.solid,
    st[o + QX], st[o + QY], st[o + QZ], st[o + QW]);
}

function stepPuff(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  const a = st[o + AGE] / st[o + LIFE];
  const dust = st[o + SUB] === SK.dust;
  const drag = Math.exp((dust ? -3.2 : -1.1) * dt);
  st[o + VX] *= drag; st[o + VZ] *= drag; st[o + VY] = st[o + VY] * drag - st[o + GRAV] * dt;
  st[o + PX] += st[o + VX] * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += st[o + VZ] * dt;
  st[o + ROT] += st[o + SPIN] * dt;
  const grow = dust ? 1.4 : 1.7;
  const size = st[o + SIZE] * (1 + grow * easeOutCubic(a));
  const alpha = (dust ? 0.5 : 0.5) * (1 - a) * Math.min(1, st[o + AGE] / 0.08);
  const cell = Cell.puff0 + ((Math.floor(st[o + AGE] * 12 + st[o + SEED] * 4)) & 3);
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], size, st[o + CR], st[o + CG], st[o + CB], alpha, st[o + ROT], cell);
}

function stepLight(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  const a = st[o + AGE] / st[o + LIFE];
  const sub = st[o + SUB];
  let size = st[o + SIZE], alpha = 1, cell: number = Cell.glow;
  if (sub === SK.star) {
    st[o + ROT] += st[o + SPIN] * dt;
    size *= 1.5 * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, a * 1.15)));
    alpha = Math.pow(1 - a, 1.2);
    cell = Cell.star0 + Math.min(2, Math.floor(a * 3));
  } else if (st[o + FLAG] === 1) {                     // ember
    st[o + VY] -= st[o + GRAV] * dt;
    const ph = st[o + AGE] * 9 + st[o + SEED] * 30;
    st[o + PX] += (st[o + VX] + Math.sin(ph) * 0.06) * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += (st[o + VZ] + Math.cos(ph * 0.9) * 0.06) * dt;
    size *= 1 - 0.6 * a;
    alpha = (1 - a) * (0.65 + 0.35 * Math.sin(st[o + AGE] * 31 + st[o + SEED] * 50));
    cell = Cell.mote;
  } else if (sub === SK.trail) {
    size *= 1 - 0.7 * a;
    alpha = 1 - a;
    cell = Cell.mote;
  } else {                                             // glow halo
    size *= 0.4 + 0.6 * easeOutCubic(Math.min(1, a * 3));
    alpha = Math.pow(1 - a, 1.5);
  }
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], size, st[o + CR], st[o + CG], st[o + CB], alpha, st[o + ROT], cell);
}

function stepDrip(e: Emitter, o: number, w: number, dt: number): void {
  const st = e.st;
  st[o + VY] -= st[o + GRAV] * dt;
  st[o + PX] += st[o + VX] * dt; st[o + PY] += st[o + VY] * dt; st[o + PZ] += st[o + VZ] * dt;
  const f = floorOf(e, o, w);
  if (st[o + PY] <= f + 0.01) {
    rippleFn(st[o + PX], f, st[o + PZ]);
    st[o + AGE] = st[o + LIFE];
  }
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], st[o + SIZE], st[o + CR], st[o + CG], st[o + CB], 0.95, 0, Cell.drip,
    st[o + VX], st[o + VY] || -1, st[o + VZ], Math.abs(st[o + VY]));
}

function stepDecal(e: Emitter, o: number, w: number): void {
  const st = e.st;
  const a = st[o + AGE] / st[o + LIFE];
  let size = st[o + SIZE], alpha = 1;
  if (st[o + SUB] === SK.ripple) {
    size *= 0.15 + 0.85 * easeOutCubic(a);
    alpha = (1 - a) * 0.9;
  } else if (a > 0.75) alpha = 1 - (a - 0.75) / 0.25;
  e.put(w, st[o + PX], st[o + PY], st[o + PZ], size, st[o + CR], st[o + CG], st[o + CB], alpha * st[o + BOUNCE], st[o + ROT], st[o + FLAG]);
}

const CONFIGS: Record<string, EmitterCfg> = {
  coins:   { name: 'coins',   cap: 256, mode: 'oriented',  blend: 'opaque', cutout: true, twoSided: true, order: 0, step: stepCoin },
  confetti:{ name: 'confetti',cap: 384, mode: 'oriented',  blend: 'opaque', cutout: true, twoSided: true, order: 0, step: stepConfetti },
  decals:  { name: 'decals',  cap: 64,  mode: 'flat',      blend: 'normal', ditherFade: true, order: 1, step: (e, o, w) => stepDecal(e, o, w) },
  puffs:   { name: 'puffs',   cap: 224, mode: 'billboard', blend: 'normal', order: 2, step: stepPuff },
  drips:   { name: 'drips',   cap: 96,  mode: 'streak',    blend: 'normal', order: 2, step: stepDrip },
  sparks:  { name: 'sparks',  cap: 512, mode: 'streak',    blend: 'add',    order: 3, step: stepSpark },
  lights:  { name: 'lights',  cap: 192, mode: 'billboard', blend: 'add',    order: 3, step: stepLight },
};

const DECALS: Record<string, { cell: number; color: Hex; size: number; life: number; alpha: number }> = {
  scorch: { cell: Cell.scorch, color: 0xffffff, size: 0.9, life: 40, alpha: 1 },
  stain: { cell: Cell.stain, color: 0x5a1019, size: 0.6, life: 60, alpha: 0.9 },
  crack: { cell: Cell.crack, color: 0xffffff, size: 0.8, life: 60, alpha: 1 },
  hand: { cell: Cell.hand, color: 0x3a0810, size: 0.5, life: 30, alpha: 0.9 },
};

interface Queued { preset: ParticlePreset; n: number; rate: number; acc: number; at: THREE.Vector3; obj: THREE.Object3D | null; o: BurstOpts }
interface Trail { obj: THREE.Object3D; last: THREE.Vector3; acc: number; rate: number; life: number; size: number; color: Hex; stopped: boolean; orphan: number }

/** Owns the emitters + queued fountains + trails. Registered with the FX layer as one system. */
export class ParticleSystem implements FxSystem {
  readonly group = new THREE.Group();
  private readonly em: Record<string, Emitter> = {};
  private queued: Queued[] = [];
  private trails: Trail[] = [];
  private clinkTokens = 12;
  private readonly tmp = new THREE.Vector3();
  private readonly d = [0, 0, 0];

  constructor() {
    const atlas = fxAtlas();
    for (const [k, cfg] of Object.entries(CONFIGS)) {
      const e = new Emitter(cfg, atlas);
      this.em[k] = e;
      this.group.add(e.mesh);
    }
    this.group.name = 'fx:particles';
    floorFn = (x, z, y) => {
      const w = app?.world;
      if (!w) return 0;
      try {
        const f = w.collision.floorAt(x, z, y + 0.6);
        return f === null ? -1e6 : f;
      } catch { return 0; }
    };
    clinkFn = (x, y, z, impact) => {
      if (this.clinkTokens < 1 || !app?.audio) return;
      this.clinkTokens -= 1;
      app.audio.play('coinClink', { pos: new THREE.Vector3(x, y, z), vol: clamp(impact / 4, 0.25, 0.8), pitch: rr(-2, 3), priority: 2 });   // one short clink, not coinLand's 0.5 s settle roll
    };
    rippleFn = (x, y, z) => this.ripple(x, y, z);
  }

  get active(): boolean {
    for (const k in this.em) if (this.em[k].n > 0) return true;
    return this.queued.length > 0 || this.trails.length > 0;
  }

  /** Live particle count (debug overlay). */
  get count(): number { let c = 0; for (const k in this.em) c += this.em[k].n; return c; }

  // ── spawning ──────────────────────────────────────────────────────────────────────────────────
  /** Burst `n` particles of `preset` at a world point. `o.over` spreads them in time (fountain). */
  burst(preset: ParticlePreset, x: number, y: number, z: number, n: number, o: BurstOpts = {}, follow: THREE.Object3D | null = null): void {
    if (n <= 0) return;
    if (o.over && o.over > 0.05) {
      this.queued.push({ preset, n, rate: n / o.over, acc: 0, at: new THREE.Vector3(x, y, z), obj: follow, o: { ...o, over: 0 } });
      return;
    }
    for (let i = 0; i < n; i++) this.spawnOne(preset, x, y, z, o);
  }

  private spawnOne(preset: ParticlePreset, x: number, y: number, z: number, o: BurstOpts): void {
    const p = PRESETS[preset];
    const spread = o.spread ?? p.spread;
    const d = this.d;
    randDir(d, preset === 'coins' || preset === 'dust');
    let bx = 0, by = 0, bz = 0;
    if (o.dir) {
      const l = Math.hypot(o.dir[0], o.dir[1], o.dir[2]) || 1;
      bx = o.dir[0] / l; by = o.dir[1] / l; bz = o.dir[2] / l;
    }
    const px = x + (rnd() * 2 - 1) * spread, py = y + (rnd() * 2 - 1) * spread * 0.5, pz = z + (rnd() * 2 - 1) * spread;
    const speed = o.speed ?? p.speed;
    const up = o.up ?? p.up;
    const life = o.life ?? rr(p.life[0], p.life[1]);
    const size = o.size ?? p.size;
    const gravity = o.gravity ?? p.gravity;

    switch (preset) {
      case 'coins': {
        const e = this.em.coins, s = e.spawn(), st = e.st;
        const k = rr(0.25, 1);
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * speed * k + bx * speed * 0.8; st[s + VY] = up * rr(0.7, 1.15) + by * speed * 0.5; st[s + VZ] = d[2] * speed * k + bz * speed * 0.8;
        st[s + LIFE] = life; st[s + SIZE] = size; st[s + GRAV] = gravity; st[s + BOUNCE] = o.bounce ?? p.bounce;
        const spin = o.spin ?? p.spin;
        st[s + WX] = rr(-spin, spin); st[s + WY] = rr(-spin, spin); st[s + WZ] = rr(-spin, spin);
        randomQuat(st, s);
        setColor(st, s, o.color === undefined ? 0xffffff : pickColor(o.color, 0xffffff));
        break;
      }
      case 'sparks': {
        const e = this.em.sparks, s = e.spawn(), st = e.st;
        const sp = speed * rr(0.35, 1);
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * sp + bx * speed * 0.6; st[s + VY] = Math.abs(d[1]) * sp * 0.4 + up * rr(0.2, 1) + by * speed * 0.6; st[s + VZ] = d[2] * sp + bz * speed * 0.6;
        st[s + LIFE] = life; st[s + SIZE] = size * rr(0.7, 1.3); st[s + GRAV] = gravity; st[s + BOUNCE] = o.bounce ?? p.bounce;
        setColor(st, s, pickColor(o.color, SPARK_COLORS));
        break;
      }
      case 'confetti': {
        const e = this.em.confetti, s = e.spawn(), st = e.st;
        const sp = speed * rr(0.3, 1);
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * sp + bx * speed * 0.6; st[s + VY] = up * rr(0.5, 1.15) + by * speed * 0.5; st[s + VZ] = d[2] * sp + bz * speed * 0.6;
        st[s + LIFE] = life; st[s + SIZE] = size * rr(0.8, 1.25);
        const spin = o.spin ?? p.spin;
        st[s + WX] = rr(-spin, spin); st[s + WY] = rr(-spin, spin); st[s + WZ] = rr(-spin, spin);
        randomQuat(st, s);
        setColor(st, s, pickColor(o.color, CONFETTI_COLORS));
        break;
      }
      case 'smoke': case 'dust': {
        const e = this.em.puffs, s = e.spawn(), st = e.st;
        const dust = preset === 'dust';
        const sp = speed * rr(0.3, 1);
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * sp + bx * speed; st[s + VY] = (dust ? Math.abs(d[1]) * sp * 0.4 : 0) + up * rr(0.6, 1.1) + by * speed; st[s + VZ] = d[2] * sp + bz * speed;
        st[s + LIFE] = life; st[s + SIZE] = size * rr(0.8, 1.2); st[s + GRAV] = gravity; st[s + SUB] = dust ? SK.dust : SK.smoke;
        st[s + ROT] = rnd() * TAU; st[s + SPIN] = (o.spin ?? p.spin) * rr(-1, 1);
        const base = dust ? lerpHex(0x9c9484, 0xc5bda5, rnd()) : lerpHex(0x5a525a, 0x9c9484, rnd());
        setColor(st, s, o.color === undefined ? base : pickColor(o.color, base));
        break;
      }
      case 'glow': {
        const e = this.em.lights, s = e.spawn(), st = e.st;
        st[s + PX] = x; st[s + PY] = y; st[s + PZ] = z;
        st[s + LIFE] = o.life ?? p.life[0]; st[s + SIZE] = size; st[s + SUB] = SK.glow;
        setColor(st, s, pickColor(o.color, 0xefd67b));
        break;
      }
      case 'embers': {
        const e = this.em.lights, s = e.spawn(), st = e.st;
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * speed * 0.4; st[s + VY] = up * rr(0.5, 1.2); st[s + VZ] = d[2] * speed * 0.4;
        st[s + LIFE] = life; st[s + SIZE] = size * rr(0.7, 1.4); st[s + GRAV] = -gravity; st[s + FLAG] = 1; st[s + SUB] = SK.ember;
        setColor(st, s, pickColor(o.color, [0xe69431, 0xffce5a, 0xef5a4a]));
        break;
      }
      case 'drips': {
        const e = this.em.drips, s = e.spawn(), st = e.st;
        st[s + PX] = px; st[s + PY] = py; st[s + PZ] = pz;
        st[s + VX] = d[0] * speed; st[s + VY] = -0.2; st[s + VZ] = d[2] * speed;
        st[s + LIFE] = life; st[s + SIZE] = size; st[s + GRAV] = gravity;
        setColor(st, s, pickColor(o.color, 0xbdf7ef));
        break;
      }
    }
  }

  /** Additive neon glow that pulses once, plus a spinning star for bigger ones. */
  glow(x: number, y: number, z: number, color: Hex, size: number, dur: number): void {
    this.burst('glow', x, y, z, 1, { color, size, life: dur });
    if (size >= 0.15) {
      const e = this.em.lights, s = e.spawn(), st = e.st;
      st[s + PX] = x; st[s + PY] = y; st[s + PZ] = z;
      st[s + LIFE] = dur * 0.9; st[s + SIZE] = size; st[s + SUB] = SK.star; st[s + SPIN] = rr(-1.5, 1.5); st[s + ROT] = rnd() * TAU;
      setColor(st, s, 0xf7efde);
    }
  }

  /** Flat decal on the floor. Unknown kinds fall back to a stain. */
  decal(x: number, y: number, z: number, kind: string, o: { size?: number; life?: number; rotY?: number } = {}): void {
    const def = DECALS[kind] ?? DECALS.stain;
    if (!DECALS[kind]) log.warnOnce(`fx:decal:${kind}`, 'fx', `unknown decal kind "${kind}", using stain`);
    const e = this.em.decals, s = e.spawn(), st = e.st;
    st[s + PX] = x; st[s + PY] = y + 0.012; st[s + PZ] = z;
    st[s + SIZE] = o.size ?? def.size; st[s + LIFE] = o.life ?? def.life; st[s + ROT] = o.rotY ?? rnd() * TAU;
    st[s + FLAG] = def.cell; st[s + BOUNCE] = def.alpha;     // BOUNCE doubles as base alpha for decals
    setColor(st, s, def.color);
  }

  private ripple(x: number, y: number, z: number): void {
    const e = this.em.decals, s = e.spawn(), st = e.st;
    st[s + PX] = x; st[s + PY] = y + 0.012; st[s + PZ] = z;
    st[s + SIZE] = 0.3; st[s + LIFE] = 0.3; st[s + SUB] = SK.ripple; st[s + FLAG] = Cell.ring; st[s + BOUNCE] = 1;
    setColor(st, s, 0xbdf7ef);
  }

  /** Particle trail behind a moving object; returns stop(). */
  trail(obj: THREE.Object3D, o: { color?: Hex; life?: number; rate?: number; size?: number } = {}): () => void {
    obj.getWorldPosition(this.tmp);
    const t: Trail = {
      obj, last: this.tmp.clone(), acc: 0, rate: o.rate ?? 40, life: o.life ?? 0.35, size: o.size ?? 0.05,
      color: o.color ?? 0xefd67b, stopped: false, orphan: 0,
    };
    this.trails.push(t);
    return () => { t.stopped = true; };
  }

  // ── simulation ────────────────────────────────────────────────────────────────────────────────
  update(dt: number): void {
    this.clinkTokens = Math.min(12, this.clinkTokens + dt * 12);

    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      if (q.obj) { if (!q.obj.parent) { this.queued.splice(i, 1); continue; } q.obj.getWorldPosition(q.at); }
      q.acc += q.rate * dt;
      const k = Math.min(q.n, Math.floor(q.acc));
      if (k > 0) { q.acc -= k; q.n -= k; for (let j = 0; j < k; j++) this.spawnOne(q.preset, q.at.x, q.at.y, q.at.z, q.o); }
      if (q.n <= 0) this.queued.splice(i, 1);
    }

    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      if (t.stopped) { this.trails.splice(i, 1); continue; }
      if (!t.obj.parent) { t.orphan += dt; if (t.orphan > 0.25) { this.trails.splice(i, 1); continue; } }
      if (dt <= 0) continue;
      t.obj.getWorldPosition(this.tmp);
      t.acc += t.rate * dt;
      const n = Math.floor(t.acc);
      t.acc -= n;
      const e = this.em.lights;
      for (let j = 1; j <= n; j++) {
        const f = j / n, s = e.spawn(), st = e.st;
        st[s + PX] = lerp(t.last.x, this.tmp.x, f) + rr(-0.01, 0.01); st[s + PY] = lerp(t.last.y, this.tmp.y, f) + rr(-0.01, 0.01); st[s + PZ] = lerp(t.last.z, this.tmp.z, f) + rr(-0.01, 0.01);
        st[s + LIFE] = t.life * rr(0.7, 1.2); st[s + SIZE] = t.size; st[s + SUB] = SK.trail;
        setColor(st, s, t.color);
      }
      t.last.copy(this.tmp);
    }

    for (const k in this.em) this.em[k].update(dt);
  }

  clear(): void {
    for (const k in this.em) this.em[k].clear();
    this.queued.length = 0;
    this.trails.length = 0;
  }

  dispose(): void { for (const k in this.em) this.em[k].dispose(); }
}

function lerpHex(a: number, b: number, t: number): number {
  return ((lerp((a >> 16) & 255, (b >> 16) & 255, t)) << 16) | ((lerp((a >> 8) & 255, (b >> 8) & 255, t)) << 8) | lerp(a & 255, b & 255, t);
}
