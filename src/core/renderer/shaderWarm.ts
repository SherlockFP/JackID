/**
 * Shader warm-up (CORE-RENDER). The first frame of a run used to link ~60 programs on the main thread (about 0.9 s), twice:
 * once with no pool lights visible, then again with the full pool (the visible light count is part of three's program key).
 * This builds one tiny mesh per PSX material variant the floor uses, in scenes lit like the floor (hemisphere + 0 or POOL_SIZE
 * point lights, linear fog), and `compileAsync`s them a few at a time while the menu idles. Three keeps the programs in its
 * cache, keyed by material type, flags, custom key and light counts, so the floor's own materials find them ready.
 * No world is built: the zoo owns its materials, and it must keep them alive (a program is freed when its last material goes).
 *
 * Variants are rows of letters: L lit, m map, e emissive map, v vertex colours, d double sided, t translucent, a alpha test,
 * A additive, F no fog, S no snap, N no affine, C scroll, i instanced, c instance colours, b skinned, k look patch, n NPC patch
 * (the last two are applied by the caller's `patch`, so core does not import the kit).
 */
import * as THREE from 'three';
import type { PsxMatOpts } from './types';
import { psxMaterial } from './psxMaterial';

// shortcut: only generic psxMaterial variants; the NPC / look / chips / CRT-screen / sprite programs still link on first use. Add rows (or a patch hook) when the leftover list in the perf run grows.
export const ZOO_ROWS = [
  '', 'v', 'i', 'ic', 'vd', 'vt', 't', 'mv', 'Nm', 'Nmv', 'Nmt', 'Nmvt', 'NmvF', 'vdA', 'NmvA', 'NmaF', 'SNm', 'SNma', 'SNmd',
  'SNmAt', 'CmvdaF',
  'L', 'Li', 'Lit', 'Lv', 'Lvd', 'Ld', 'Lm', 'Lmv', 'Lmev', 'LNmv', 'LNmvd', 'LNmev', 'Lmda', 'Lmdt', 'LSNmv',
  'Lvbkn', 'Ldn', 'Lvdn', 'Lvn', 'Lmvn',
] as const;

/** Letters to material options (pure). */
export function zooOpts(row: string, map: THREE.Texture): PsxMatOpts {
  const has = (c: string): boolean => row.includes(c);
  return {
    lit: has('L'),
    map: has('m') ? map : null,
    emissiveMap: has('e') ? map : null,
    emissive: has('e') ? 0xffffff : 0,
    vertexColors: has('v'),
    side: has('d') ? 'double' : 'front',
    opacity: has('t') ? 0.5 : 1,
    alphaTest: has('a') ? 0.5 : 0,
    additive: has('A'),
    fog: !has('F'),
    snap: !has('S'),
    affine: !has('N'),
    scroll: has('C') ? [0.1, 0] : undefined,
    unique: has('k') || has('n'),   // patched materials are mutated per owner
  };
}

const CHUNK = 6;                       // materials per compile call: a few frames' worth of GLSL assembly each
/** What the floor shows: no pool light on the first frame, the full pool after. Core cannot import world/sys/lightPool, so the size is mirrored (shaderWarm.test.mjs pins it). */
export const POOL_LIGHTS = 6;
const LIGHT_COUNTS = [0, POOL_LIGHTS];

const keep: THREE.Scene[] = [];        // the zoo must outlive the call (see above)

export type ZooPatch = (m: THREE.MeshLambertMaterial, row: string) => void;

function meshFor(row: string, map: THREE.Texture, geo: THREE.BufferGeometry, patch: ZooPatch | undefined): THREE.Mesh {
  const mat = psxMaterial(zooOpts(row, map));
  if (/[kn]/.test(row) && mat instanceof THREE.MeshLambertMaterial) patch?.(mat, row);
  if (row.includes('b')) {
    const sm = new THREE.SkinnedMesh(geo, mat);
    sm.bind(new THREE.Skeleton([new THREE.Bone()]));
    return sm;
  }
  if (!row.includes('i')) return new THREE.Mesh(geo, mat);
  const im = new THREE.InstancedMesh(geo, mat, 1);
  if (row.includes('c')) im.setColorAt(0, new THREE.Color(1, 1, 1));
  return im;
}

/**
 * Compile the zoo. `idle` hands control back between chunks (the menu keeps its frames). Never throws: a failed warm-up
 * only means the floor links its own programs, as before.
 */
export async function warmShaders(three: THREE.WebGLRenderer, idle: () => Promise<void>, patch?: ZooPatch, rows: readonly string[] = ZOO_ROWS): Promise<void> {
  try {
    const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    map.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const cam = new THREE.PerspectiveCamera();
    for (let i = 0; i < rows.length; i += CHUNK) {
      const meshes = rows.slice(i, i + CHUNK).map((r) => meshFor(r, map, geo, patch));
      for (const n of LIGHT_COUNTS) {
        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x000000, 1, 26);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x000000, 1));
        for (let k = 0; k < n; k++) scene.add(new THREE.PointLight(0xffffff, 0, 8, 1.5));
        scene.add(...meshes.map((m) => m.clone()));
        keep.push(scene);
        await three.compileAsync(scene, cam);
      }
      await idle();
    }
  } catch { /* the floor links its own programs */ }
}
