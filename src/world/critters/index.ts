/**
 * Critters (WORLD): two tiny PSX vermin. A RAT (grey-brown, ~25 cm nose to tail tip, segmented tail) and a COCKROACH
 * (dark brown, ~5 cm, six legs and two antennae as thin double-sided quads). Low poly (rat ~170 tris, roach ~70), kit
 * primitives, vertex-shaded, snapped by the PSX material. No game logic: whoever places one moves `root` and calls
 * `update(dt, moving)` every frame with SIM-scaled `dt`. Both face +Z, origin on the floor under the body centre.
 * `moving` drives a scurry (body bob, legs and tail wiggle); idle gives a slow breath and a twitch of nose/antennae.
 */
import * as THREE from 'three';
import type { Kit } from '@/kit/types';
import type { Hex } from '@/core/types';

export type CritterKind = 'rat' | 'cockroach';

export interface Critter {
  readonly root: THREE.Group;
  /** Advance the animation by sim-time `dt` seconds; `moving` = scurrying (true) or idle (false). */
  update(dt: number, moving: boolean): void;
  /** Free geometries and materials (the root must already be removed from its parent). */
  dispose(): void;
}

const RAT_FUR: Hex = 0x6b5a4a, RAT_DARK: Hex = 0x4a3d32, RAT_PINK: Hex = 0xb48a82, EYE: Hex = 0x0c0a0a;
const ROACH_SHELL: Hex = 0x3a2412, ROACH_LEG: Hex = 0x24150a, ROACH_BELLY: Hex = 0x5a3a1c;

export function createCritter(kind: CritterKind, kit: Kit): Critter {
  return kind === 'rat' ? makeRat(kit) : makeRoach(kit);
}

function disposer(root: THREE.Object3D, mats: THREE.Material[]): () => void {
  return () => {
    root.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    for (const m of mats) m.dispose();
    root.clear();
  };
}

// ── rat ───────────────────────────────────────────────────────────────────────────────────────────
function makeRat(kit: Kit): Critter {
  const mats: THREE.Material[] = [];
  const m = (c: Hex): THREE.Material => { const x = kit.mat({ color: c, lit: false, vertexColors: true }); mats.push(x); return x; };
  const fur = m(RAT_FUR), dark = m(RAT_DARK), pink = m(RAT_PINK), eye = m(EYE);
  const root = new THREE.Group();
  root.name = 'rat';
  const body = new THREE.Group();                       // everything that bobs
  root.add(body);
  body.add(kit.box(0.07, 0.062, 0.13, fur, { pos: [0, 0.052, -0.005], shade: true }));
  body.add(kit.box(0.052, 0.05, 0.07, dark, { pos: [0, 0.05, -0.065] }));                         // haunch
  const head = new THREE.Group();
  head.position.set(0, 0.05, 0.075);
  head.add(kit.box(0.046, 0.042, 0.05, fur, { pos: [0, 0, 0.012] }));
  head.add(kit.box(0.024, 0.024, 0.04, fur, { pos: [0, -0.005, 0.048] }));                        // snout
  head.add(kit.box(0.009, 0.009, 0.008, pink, { pos: [0, -0.002, 0.07] }));                       // nose
  for (const s of [-1, 1]) {
    head.add(kit.box(0.004, 0.017, 0.015, pink, { pos: [0.027 * s, 0.022, -0.004] }));           // ears
    head.add(kit.box(0.006, 0.006, 0.006, eye, { pos: [0.02 * s, 0.01, 0.036] }));
    head.add(kit.box(0.003, 0.003, 0.03, dark, { pos: [0.014 * s, -0.012, 0.062], rot: [0, 12 * s, 0] })); // whisker
  }
  body.add(head);
  // legs: [x, z, phase]; pivot at the hip so a rotation swings the foot
  const legs: Array<{ g: THREE.Group; ph: number }> = [];
  for (const [x, z, ph] of [[-1, 0.04, 0], [1, 0.04, Math.PI], [-1, -0.05, Math.PI], [1, -0.05, 0]] as const) {
    const g = new THREE.Group();
    g.position.set(0.032 * x, 0.03, z);
    g.add(kit.box(0.014, 0.03, 0.02, dark, { pos: [0, -0.015, 0] }));
    g.add(kit.box(0.014, 0.006, 0.03, pink, { pos: [0, -0.027, 0.005] }));                         // paw
    root.add(g);
    legs.push({ g, ph });
  }
  // tail: 4 chained segments, each hinged at the end of the last
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.position.set(0, i === 0 ? 0.04 : 0, i === 0 ? -0.07 : -0.045);
    g.add(kit.box(0.01 - i * 0.0015, 0.01 - i * 0.0015, 0.05, pink, { pos: [0, 0, -0.025] }));
    parent.add(g);
    tail.push(g);
    parent = g;
  }
  let t = 0, moveK = 0;
  return {
    root,
    update(dt, moving) {
      t += dt;
      moveK += ((moving ? 1 : 0) - moveK) * (1 - Math.exp(-10 * dt));
      const run = t * 22, idle = t * 1.6;
      body.position.y = Math.abs(Math.sin(run)) * 0.006 * moveK + Math.sin(idle) * 0.0012 * (1 - moveK);
      body.rotation.x = Math.sin(run * 2) * 0.05 * moveK;
      body.rotation.y = Math.sin(run) * 0.06 * moveK;
      head.rotation.x = Math.sin(t * 2.3) * 0.12 * (1 - moveK) + 0.08 * moveK;                     // sniff
      head.rotation.y = Math.sin(t * 0.9) * 0.3 * (1 - moveK);
      for (const l of legs) l.g.rotation.x = Math.sin(run + l.ph) * 0.9 * moveK;
      for (let i = 0; i < tail.length; i++) {
        tail[i].rotation.y = Math.sin(run * 0.5 - i * 0.9) * (0.28 * moveK + 0.1 * (1 - moveK)) + Math.sin(idle * 0.6 - i) * 0.05;
        tail[i].rotation.x = i === 0 ? -0.25 : 0.12 * Math.sin(run * 0.5 - i);
      }
    },
    dispose: disposer(root, mats),
  };
}

// ── cockroach ─────────────────────────────────────────────────────────────────────────────────────
function makeRoach(kit: Kit): Critter {
  const mats: THREE.Material[] = [];
  const m = (c: Hex, double = false): THREE.Material => { const x = kit.mat({ color: c, lit: false, vertexColors: true, side: double ? 'double' : 'front' }); mats.push(x); return x; };
  const shell = m(ROACH_SHELL), belly = m(ROACH_BELLY), legMat = m(ROACH_LEG, true);
  const root = new THREE.Group();
  root.name = 'cockroach';
  const body = new THREE.Group();
  root.add(body);
  body.add(kit.box(0.024, 0.008, 0.034, shell, { pos: [0, 0.007, -0.004] }));                       // wing cases
  body.add(kit.box(0.018, 0.006, 0.03, belly, { pos: [0, 0.003, -0.002] }));
  body.add(kit.box(0.015, 0.006, 0.012, shell, { pos: [0, 0.005, 0.017] }));                        // pronotum
  const head = new THREE.Group();
  head.position.set(0, 0.004, 0.025);
  head.add(kit.box(0.009, 0.005, 0.007, shell, { pos: [0, 0, 0.002] }));
  body.add(head);
  const ants: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(0.003 * s, 0.001, 0.005);
    a.add(kit.plane(0.0015, 0.03, legMat, { pos: [0, 0, 0.015], rot: [90, 0, 0] }));            // antenna quad, lying flat
    a.rotation.y = 0.5 * s;
    head.add(a);
    ants.push(a);
  }
  // six legs: thin quads lying flat, hinged at the body edge (front, middle, rear per side)
  const legs: Array<{ g: THREE.Group; ph: number; base: number; s: number }> = [];
  const zs = [0.012, 0.0, -0.012], yaw = [-35, 0, 40];
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.position.set(0.008 * side, 0.004, zs[i]);
      g.add(kit.plane(0.022, 0.0025, legMat, { pos: [0.011 * side, 0, 0], rot: [90, 0, 0] }));
      const base = (yaw[i] * Math.PI) / 180 * side;
      g.rotation.y = base;
      root.add(g);
      legs.push({ g, ph: (i % 2 === 0) === (side > 0) ? 0 : Math.PI, base, s: side });
    }
  }
  let t = 0, moveK = 0;
  return {
    root,
    update(dt, moving) {
      t += dt;
      moveK += ((moving ? 1 : 0) - moveK) * (1 - Math.exp(-14 * dt));
      const run = t * 40;
      body.position.y = Math.abs(Math.sin(run * 0.5)) * 0.0008 * moveK;
      body.rotation.y = Math.sin(run * 0.5) * 0.08 * moveK;
      for (const l of legs) l.g.rotation.y = l.base + Math.sin(run + l.ph) * 0.45 * moveK * l.s;
      for (let i = 0; i < ants.length; i++) {
        const s = i === 0 ? -1 : 1;
        ants[i].rotation.y = 0.5 * s + Math.sin(t * (moveK > 0.5 ? 18 : 3.1) + i * 1.7) * (0.12 + 0.18 * (1 - moveK));
      }
    },
    dispose: disposer(root, mats),
  };
}
