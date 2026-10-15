/**
 * Lamp bank (shared kit part). Many small indicator lamps used to be one `kit.lamp` part each, with its own cover
 * material: one draw call per lamp. Here the covers are two InstancedMeshes (domes, flats), the halos are one additive
 * InstancedMesh, and the housings are static meshes that `kit.finalize` merges. Each lamp is a `LampPart` proxy with the
 * same contract (`setOn`, `setColor`, `blink`), so `juice.celebrate` and the machine code are unchanged.
 * Blinks are driven by `update(dt)`, which the machine calls from its fixed tick (or from `renderDriven`).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { Hex } from '@/core/types';
import type { LampPart } from '@/kit/types';
import { psx } from '@/kit/materials';
import { paintGlow } from '@/kit/draw';

export interface LampSpec {
  /** Lamp centre, machine-local. */
  pos: [number, number, number];
  r: number;
  shape: 'dome' | 'flat';
  color: Hex;
}

/** A static additive glow (desk CRT halo): drawn by the bank, never switched. */
export interface GlowSpec { pos: [number, number, number]; w: number; h: number; color: Hex; opacity: number }

export interface LampBank {
  parts: LampPart[];
  /** Advance blinks. Call once per fixed tick with the step in seconds. */
  update(dt: number): void;
}

const DIM = 0.2;      // off-state cover brightness (kit.lamp)
const HALO_K = 0.7;   // lit halo strength (kit.lamp's glowMat intensity)

/** Halo offset above the lamp centre (kit.lamp: flat 0.03, dome r * 0.9). */
const haloY = (s: LampSpec): number => (s.shape === 'flat' ? 0.03 : s.r * 0.9);
/** Cover offset (kit.lamp: flat face at 0.014, dome cap centre at r * 0.3). */
const coverY = (s: LampSpec): number => (s.shape === 'flat' ? 0.014 : s.r * 0.3);

/**
 * Builds the bank under `root`. Housings go under `root` (merged later by finalize). Covers and halos are InstancedMeshes,
 * so the lamps cost 3 draw calls however many there are.
 */
export function buildLampBank(
  kit: KitX, root: THREE.Object3D, specs: LampSpec[], glows: GlowSpec[] = [], opts: { renderDriven?: boolean } = {},
): LampBank {
  const pal = kit.pal;
  const domeIdx: number[] = [], flatIdx: number[] = [];
  specs.forEach((s, i) => (s.shape === 'dome' ? domeIdx : flatIdx).push(i));

  // static housings (chrome), the same shapes kit.lamp builds
  for (const s of specs) {
    const [x, y, z] = s.pos;
    if (s.shape === 'flat') kit.cyl(s.r * 1.12, s.r * 1.18, 0.012, pal.chrome, { pos: [x, y + 0.006, z], seg: 10, parent: root });
    else kit.cyl(s.r * 1.15, s.r * 1.25, s.r * 0.3, pal.chrome, { pos: [x, y + s.r * 0.15, z], seg: 10, parent: root });
  }

  // covers: the unlit cover kit.lamp uses (instance colour carries the lamp colour)
  const mat = psx({ color: 0xffffff, lit: false });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const place = (mesh: THREE.InstancedMesh, k: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    mesh.setMatrixAt(k, m4);
  };

  // domes: unit hemisphere, scaled per lamp
  const domes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat, Math.max(1, domeIdx.length));
  domes.name = 'kit.lamps.dome';
  domes.count = domeIdx.length;
  domeIdx.forEach((i, k) => { const s = specs[i]; place(domes, k, s.pos[0], s.pos[1] + coverY(s), s.pos[2], s.r, s.r, s.r); });
  domes.instanceMatrix.needsUpdate = true;

  // flats: unit disc, scaled to r x 0.008
  const flats = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat, Math.max(1, flatIdx.length));
  flats.name = 'kit.lamps.flat';
  flats.count = flatIdx.length;
  flatIdx.forEach((i, k) => { const s = specs[i]; place(flats, k, s.pos[0], s.pos[1] + coverY(s), s.pos[2], s.r, 0.008, s.r); });
  flats.instanceMatrix.needsUpdate = true;

  // halos: one quad facing +Z (the player side), one per lamp, then one per glow
  // the kit's own glow texture (same cache key as the kit's glow sprites), additive, as kit.lamp's halo sprite
  const glowMap = kit.tex.canvas(16, 16, (g) => paintGlow(g, 16), { key: 'kit:glow', wrap: 'clamp' });
  const haloMat = new THREE.MeshBasicMaterial({ map: glowMap, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const haloCount = specs.length + glows.length;
  const halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), haloMat, Math.max(1, haloCount));
  halos.name = 'kit.lamps.halo';
  halos.count = haloCount;
  specs.forEach((s, i) => { const size = s.r * 7; place(halos, i, s.pos[0], s.pos[1] + haloY(s), s.pos[2] + 0.01, size, size, 1); });
  glows.forEach((g, j) => place(halos, specs.length + j, g.pos[0], g.pos[1], g.pos[2], g.w * 1.7, g.h * 1.9, 1));
  halos.instanceMatrix.needsUpdate = true;

  if (domeIdx.length) root.add(domes);        // an empty InstancedMesh would still cost a draw in some counters
  if (flatIdx.length) root.add(flats);
  if (haloCount) root.add(halos);

  // colour state: covers start dark, halos start black (additive black = invisible)
  const tmp = new THREE.Color();
  const black = new THREE.Color(0, 0, 0);
  for (let k = 0; k < domeIdx.length; k++) domes.setColorAt(k, black);
  for (let k = 0; k < flatIdx.length; k++) flats.setColorAt(k, black);
  for (let k = 0; k < haloCount; k++) halos.setColorAt(k, black);
  glows.forEach((g, j) => halos.setColorAt(specs.length + j, tmp.setHex(g.color).multiplyScalar(g.opacity)));
  let dirty = true;

  const coverOf = new Map<number, { mesh: THREE.InstancedMesh; k: number }>();
  domeIdx.forEach((i, k) => coverOf.set(i, { mesh: domes, k }));
  flatIdx.forEach((i, k) => coverOf.set(i, { mesh: flats, k }));

  const ticks: Array<(dt: number) => void> = [];
  const parts: LampPart[] = specs.map((s, i) => {
    const anchor = new THREE.Group();
    anchor.position.set(s.pos[0], s.pos[1] + coverY(s), s.pos[2]);
    const cover = coverOf.get(i)!;
    let on = false, baseOn = false, color = s.color;
    let blinkHz = 0, blinkUntil = 0, t = 0;

    const apply = (v: boolean): void => {
      on = v;
      cover.mesh.setColorAt(cover.k, tmp.setHex(color).multiplyScalar(v ? 1 : DIM));
      halos.setColorAt(i, v ? tmp.setHex(color).multiplyScalar(HALO_K) : black);
      dirty = true;
    };
    apply(false);

    ticks.push((dt) => {
      t += dt;
      if (blinkHz <= 0) return;
      if (blinkUntil > 0 && t >= blinkUntil) { blinkHz = 0; apply(baseOn); return; }
      const v = Math.floor(t * blinkHz * 2) % 2 === 0;
      if (v !== on) apply(v);
    });

    return {
      root: anchor,
      setOn(v: boolean) { baseOn = v; blinkHz = 0; apply(v); },
      setColor(c: Hex) { color = c; apply(on); },
      blink(hz: number, dur?: number) { blinkHz = hz; blinkUntil = dur && dur > 0 ? t + dur : 0; },
    };
  });

  const commit = (): void => {
    if (!dirty) return;
    dirty = false;
    for (const m of [domes, flats, halos]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  commit();

  const bank: LampBank = {
    parts,
    update(dt: number): void {
      for (const f of ticks) f(dt);
      commit();
    },
  };
  if (opts.renderDriven) {
    // the machine has no tick hook here: blinks advance from the halo mesh's render callback (dt capped, so a culled
    // bank resumes without a jump)
    let last = performance.now();
    halos.onBeforeRender = () => {
      const now = performance.now();
      bank.update(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
  }
  return bank;
}
