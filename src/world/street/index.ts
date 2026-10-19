/**
 * THE WALK HOME (world/street): the block's ground corridor past the flat (Ada's door across the hall, the mailboxes, a buzzing
 * tube), the building door, the night street in the rain and the casino's street door with its lift. Built from `level.ts` next
 * to the apartment, as its own zone (`street`): culled as one group, lit by pooled hints and emissive parts only.
 *
 * The game drives the walk (src/game/home/evening.ts) through `setWalk(goal, taxi)`: the goal names the door the wayfinder points
 * at and which taxi takes a fare. A taxi's E emits `street:taxi`; the game decides. Plan in config.ts (cues: `walkCue`).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { createRng } from '@/core/rng';
import { presets } from '@/kit/presets';
import type { CollisionWorld, InteractionSystem } from '../types';
import type { InteractableX } from '../interact';
import type { LightHint } from '../sys/arch';
import { tube } from '../lights';
import { crispLabel, crispNeon } from '../props/signs';
import { stairwellTex, worldUV, HOME_PAPER_TILE } from '../props/surfaces';
import { at, CEIL, DOOR_H, DOOR_X0, DOOR_X1, HALL_Z1 } from '../home/config';
import type { Statics } from '../home/room';
import { ANCHOR_PLAN, BLOCK, CASINO_DOOR, CORRIDOR_X1, ENTRY, FACADE_X, LAMPS_Z, STREET, STREET_ANCHORS, STREET_ZONE, TAXI } from './config';
import { cat, kiosk, lampPost, oldCar } from './props';

export { STREET_ANCHORS, STREET_LOOK, STREET_ZONE, STREET_ZONE_RECT, TAXI_NIGHT, walkCue, walkWaypoint, type WalkCue, type WalkLeg } from './config';

declare module '@/core/events' {
  interface GameEvents {
    /** E at a waiting taxi (world → game): `home` from the casino door, `casino` from the block. */
    'street:taxi': { to: 'home' | 'casino' };
  }
}

/** Where the walk is headed (the wayfinder's goal), or null when nobody is walking. */
export type WalkGoal = 'home' | 'casino';
let goal: WalkGoal | null = null;
let taxiOk = false;

/** The game sets the walk: the goal (null: no walk) and whether a taxi takes the fare tonight. */
export function setWalk(g: WalkGoal | null, taxi = false): void {
  goal = g;
  taxiOk = taxi;
}
/** The walk's goal, or null (read by the objective line's wayfinder). */
export function walkGoal(): WalkGoal | null {
  return goal;
}

export interface StreetBuild {
  readonly root: THREE.Group;
  readonly statics: Statics[];
  readonly lights: LightHint[];
  readonly anchors: Record<string, THREE.Object3D>;
  update(dt: number, t: number): void;
  dispose(): void;
}

const RAIN_N = 420;
const RAIN_BOX = { w: 18, h: 9, d: 18 } as const;
const RAIN_SPEED = 9;
const RAIN_LEN = 0.45;

export function buildStreet(o: { kit: KitX; tex: TexGen; seed: number; interact?: InteractionSystem; collision?: CollisionWorld }): StreetBuild {
  const { kit, tex } = o;
  const root = new THREE.Group();
  root.name = 'street';
  root.userData.zone = STREET_ZONE;
  const shell = new THREE.Group();
  shell.name = 'street:shell';
  const dyn = new THREE.Group();
  dyn.name = 'street:dyn';
  root.add(shell, dyn);
  const statics: Statics[] = [];
  const lights: LightHint[] = [];
  const M = presets(kit.tex);
  const rng = createRng(o.seed ^ 0x57e7);

  const box3 = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 =>
    new THREE.Box3(new THREE.Vector3(...at(x0, y0, z0)), new THREE.Vector3(...at(x1, y1, z1)));
  const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material, solid = false, parent = shell): THREE.Mesh => {
    const mesh = kit.box(x1 - x0, y1 - y0, z1 - z0, m, { pos: at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), parent });
    if (solid) statics.push({ box: box3(x0, y0, z0, x1, y1, z1), tag: 'solid' });
    return mesh;
  };
  /** A vendor texture at `tile` metres per repeat (kit metric UVs). */
  const vmat = (path: string, tile: number, color: number): THREE.Material => {
    const m = kit.tex.vendor(`sbs-tiny2/128x128/${path}-128x128.png`, { size: 64 });
    m.userData.tile = tile;
    return kit.mat({ color, map: m });
  };
  /** A flat sign facing +x (the street) at plan (x, y, z). */
  const signX = (text: string, w: number, h: number, color: number, bg: number, x: number, y: number, z: number, face = 1): void => {
    const l = crispLabel(kit, { text, w, h, color, bg });
    l.mesh.position.set(...at(x, y, z));
    l.mesh.rotation.y = face * Math.PI / 2;
    shell.add(l.mesh);
  };
  /** A soft additive pool on the ground (the lamps' light and the neon on the wet tarmac). */
  const poolTex = kit.tex.canvas(32, 32, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  }, { wrap: 'clamp' });
  const pool = (x: number, z: number, w: number, d: number, color: number, opacity: number): void => {
    const m = kit.mat({ map: poolTex, color, lit: false, additive: true, transparent: true, opacity, affine: false, snap: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(...at(x, 0.02, z));
    p.renderOrder = 1;
    p.userData.noMerge = true;
    dyn.add(p);
  };

  // ── materials ───────────────────────────────────────────────────────────────────────────────────
  const stairwell = kit.mat({ color: 0xd8d0c4, map: stairwellTex(tex) });
  const concrete = vmat('Plaster/Plaster_19', 3, 0xa4a4a8);
  const shops = vmat('Plaster/Plaster_16', 3, 0xa89c88);
  const casinoWall = vmat('Brick/Brick_10', 2, 0x7a6a64);
  const brick = vmat('Brick/Brick_18', 1.5, 0x9a7a6a);
  const pavers = vmat('Tile/Tile_02', 0.8, 0x7a7a78);
  const tarmac = vmat('Dirt/Dirt_03', 2.5, 0x5a5c62);
  const shutter = vmat('Metal/Metal_05', 1, 0x8a8a88);
  const joint = kit.mat({ color: 0x3a3832 });
  const kerb = kit.mat({ color: 0x8a8a84 });
  const steel = M.metal(0x5a6a60);
  const brass = kit.mat({ color: kit.pal.brass });
  const glassDark = kit.mat({ color: 0x10141c });
  const winLit = kit.mat({ color: 0xffc27a, lit: false });
  const winBlue = kit.mat({ color: 0x8aa0d0, lit: false });   // a television through the curtain

  // ── THE CORRIDOR: Ada's door across the hall, the mailboxes, the tube, the meters ─────────────────────────────────────
  // Ada's door: on the south wall, straight across from yours (x -1.1 .. -0.1), padded oxblood vinyl with brass studs
  const adaLeaf = kit.mat({ color: 0x5a2a22 });
  const trim = M.wood('dark');
  const zA = HALL_Z1;
  slab(DOOR_X0 - 0.05, 0, zA - 0.04, DOOR_X0, DOOR_H + 0.03, zA, trim);
  slab(DOOR_X1, 0, zA - 0.04, DOOR_X1 + 0.05, DOOR_H + 0.03, zA, trim);
  slab(DOOR_X0 - 0.05, DOOR_H, zA - 0.04, DOOR_X1 + 0.05, DOOR_H + 0.03, zA, trim);
  slab(DOOR_X0 + 0.02, 0.02, zA - 0.05, DOOR_X1 - 0.02, DOOR_H - 0.02, zA - 0.01, adaLeaf);
  for (let i = 0; i < 5; i++) for (const sx of [DOOR_X0 + 0.15, DOOR_X1 - 0.15]) {
    kit.sphere(0.012, brass, { pos: at(sx, 0.4 + i * 0.38, zA - 0.055), parent: shell, wSeg: 4, hSeg: 3 });
  }
  kit.sphere(0.034, brass, { pos: at(DOOR_X1 - 0.12, 1.0, zA - 0.07), parent: shell, wSeg: 6, hSeg: 5 });
  kit.cyl(0.018, 0.018, 0.01, brass, { pos: at(-0.6, 1.55, zA - 0.055), rot: [90, 0, 0], parent: shell, seg: 8 });
  const seven = crispLabel(kit, { text: '7', w: 0.12, h: 0.14, color: 0xe8d8a0, bg: 0x2a1a10 });
  seven.mesh.position.set(...at(-0.6, 1.78, zA - 0.056));
  seven.mesh.rotation.y = Math.PI;
  shell.add(seven.mesh);
  const eight = crispLabel(kit, { text: '8', w: 0.12, h: 0.14, color: 0xe8d8a0, bg: 0x2a1a10 });   // yours, on the lintel across the hall
  eight.mesh.position.set(...at(-0.6, 2.4, 2.811));
  shell.add(eight.mesh);
  slab(-1.0, 0, zA - 0.65, -0.2, 0.015, zA - 0.08, kit.mat({ color: 0x4a3a2a }));   // her doormat

  // the mailboxes on the south wall, a grid of dented green tin with the slots dark
  const slot = kit.mat({ color: 0x0a0a0a });
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) {
    const x = 1.9 + c * 0.4, y = 1.0 + r * 0.32;
    slab(x, y, zA - 0.2, x + 0.37, y + 0.29, zA, steel);
    slab(x + 0.06, y + 0.2, zA - 0.205, x + 0.31, y + 0.23, zA - 0.2, slot);
  }
  statics.push({ box: box3(1.9, 1.0, zA - 0.2, 3.5, 1.95, zA), tag: 'solid' });
  // the meter cabinet on the north wall and a notice board by the door
  slab(5.4, 1.2, 2.8, 6.2, 2.0, 2.98, kit.mat({ color: 0x6a6a64 }), true);
  slab(6.6, 1.3, zA - 0.02, 7.3, 1.8, zA, kit.mat({ color: 0x8a6a48 }));
  for (let i = 0; i < 3; i++) slab(6.65 + i * 0.22, 1.36 + (i % 2) * 0.12, zA - 0.025, 6.84 + i * 0.22, 1.62 + (i % 2) * 0.12, zA - 0.02, kit.mat({ color: 0xe8e4d8 }));

  // the corridor's inner face of the façade wall (the opening is the building door) and the north wall's skin past your door
  slab(CORRIDOR_X1 - 0.02, 0, 2.8, CORRIDOR_X1, CEIL, ENTRY.z0, stairwell);
  slab(CORRIDOR_X1 - 0.02, 0, ENTRY.z1, CORRIDOR_X1, CEIL, HALL_Z1, stairwell);
  slab(CORRIDOR_X1 - 0.02, ENTRY.h, ENTRY.z0, CORRIDOR_X1, CEIL, ENTRY.z1, stairwell);
  for (const m of shell.children.slice(-3)) worldUV(m as THREE.Mesh, HOME_PAPER_TILE);

  // the tube on the ceiling: it buzzes (BUZZ flicker), the only light between the hall bulb and the street
  const tubeFx = tube(kit, { id: 'street:tube', pos: at(4.3, CEIL - 0.06, 4.0), length: 1.2, axis: 'x', color: 0xd8f0e8, intensity: 0.7, range: 5, flicker: 'BUZZ', zone: STREET_ZONE });
  dyn.add(tubeFx.root);
  lights.push(tubeFx.hint);

  // ── THE BLOCK: the façade (x 8.0 .. 8.3) with the building door, panel joints, balconies and windows ─────────────────
  const fx0 = CORRIDOR_X1, fx1 = FACADE_X;
  slab(fx0, 0, BLOCK.z0, fx1, BLOCK.h, ENTRY.z0, concrete, true);
  slab(fx0, 0, ENTRY.z1, fx1, BLOCK.h, BLOCK.z1, concrete, true);
  slab(fx0, ENTRY.h, ENTRY.z0, fx1, BLOCK.h, ENTRY.z1, concrete, true);
  // the block's ends (the walls you see from up the street) and the low garden wall beyond it
  slab(-4, 0, BLOCK.z0 - 0.3, fx1, BLOCK.h, BLOCK.z0, concrete);
  slab(-4, 0, BLOCK.z1, fx1, BLOCK.h, BLOCK.z1 + 0.3, concrete);
  slab(fx0, 0, BLOCK.z1, fx1, 1.6, STREET.z1 + 0.3, brick, true);
  // panel joints every 3 m, a hair proud of the face
  for (let y = 3; y < BLOCK.h; y += 3) slab(fx1, y - 0.03, BLOCK.z0, fx1 + 0.02, y + 0.03, BLOCK.z1, joint);
  for (let z = BLOCK.z0 + 3; z < BLOCK.z1; z += 3) slab(fx1, 2.9, z - 0.03, fx1 + 0.02, BLOCK.h, z + 0.03, joint);
  // windows on floors 1 to 4 (lit, dark or a television), and the balconies: a slab, a parapet and the odd washing line
  const balc = kit.mat({ color: 0x8a867c });
  const rail = kit.mat({ color: 0x4a2e22 });
  for (let f = 1; f <= 4; f++) {
    const y0 = f * 3;
    for (const z of [-5.0, -2.0, 1.0, 4.0]) {
      const r = rng.next();
      const m = r < 0.35 ? winLit : r < 0.45 ? winBlue : glassDark;
      const w = kit.box(0.02, 1.3, 1.2, m, { pos: at(fx1 + 0.03, y0 + 1.3, z + 0.75), parent: shell });
      void w;
    }
    for (const [z0, z1] of [[-3.8, -0.6], [2.2, 5.4]] as const) {
      slab(fx1, y0 - 0.02, z0, fx1 + 1.1, y0 + 0.14, z1, balc);
      slab(fx1 + 1.02, y0 + 0.14, z0, fx1 + 1.1, y0 + 1.0, z1, rail);
      slab(fx1, y0 + 0.14, z0, fx1 + 1.1, y0 + 1.0, z0 + 0.08, rail);
      slab(fx1, y0 + 0.14, z1 - 0.08, fx1 + 1.1, y0 + 1.0, z1, rail);
      if (rng.chance(0.4)) for (let k = 0; k < 3; k++) {
        kit.box(0.02, 0.4 + rng.next() * 0.2, 0.35, kit.mat({ color: [0xd0c8b8, 0x8a4a3a, 0x4a5a7a][k] }), { pos: at(fx1 + 0.7, y0 + 1.75, z0 + 0.6 + k * 0.5), parent: shell });
      }
    }
  }
  // ground floor: two barred windows and the entrance (a canopy, a lamp under it, the name and number)
  for (const z of [-4.5, -1.2]) {
    slab(fx1, 1.0, z, fx1 + 0.02, 2.1, z + 1.1, glassDark);
    for (let k = 0; k < 6; k++) slab(fx1 + 0.03, 1.0, z + 0.08 + k * 0.19, fx1 + 0.05, 2.1, z + 0.11 + k * 0.19, rail);
  }
  slab(fx1, 2.45, ENTRY.z0 - 0.4, fx1 + 1.3, 2.75, ENTRY.z1 + 0.4, balc);
  slab(fx0 - 0.02, 0, ENTRY.z0 - 0.06, fx1 + 0.02, ENTRY.h, ENTRY.z0, kit.mat({ color: 0x8a8a90 }));
  slab(fx0 - 0.02, 0, ENTRY.z1, fx1 + 0.02, ENTRY.h, ENTRY.z1 + 0.06, kit.mat({ color: 0x8a8a90 }));
  slab(fx1, 0, ENTRY.z0 - 0.1, fx1 + 0.6, 0.04, ENTRY.z1 + 0.1, kerb);   // the door step (low: walked over, not climbed)
  signX('YILDIZ APT.', 1.4, 0.24, 0xe8e0c8, 0x1a2a4a, fx1 + 1.31, 2.6, (ENTRY.z0 + ENTRY.z1) / 2);   // i18n-ok: an in-world Turkish sign
  signX('14', 0.24, 0.2, 0xffffff, 0x1a4a8a, fx1 + 0.02, 2.0, ENTRY.z1 + 0.35);
  const entryLamp = kit.lamp({ r: 0.1, color: 0xffd090, shape: 'bulb' });
  entryLamp.root.position.set(...at(fx1 + 0.7, 2.38, (ENTRY.z0 + ENTRY.z1) / 2));
  entryLamp.setOn(true);
  dyn.add(entryLamp.root);
  lights.push({ id: 'street:entry', pos: at(fx1 + 0.7, 2.35, (ENTRY.z0 + ENTRY.z1) / 2), color: 0xffd090, intensity: 0.8, range: 5, flicker: 'STEADY', zone: STREET_ZONE });
  pool(fx1 + 1.2, (ENTRY.z0 + ENTRY.z1) / 2, 3, 3.2, 0xffc080, 0.35);

  // ── THE CASINO'S STREET DOOR: dark stone, a red awning with bulbs, the KASİNO neon, the doorman's alcove and the lift ───
  const cz0 = CASINO_DOOR.z0, cz1 = CASINO_DOOR.z1, ch = CASINO_DOOR.h, cx0 = CASINO_DOOR.x0;
  slab(fx0, 0, STREET.z0, fx1, 10, cz0, casinoWall, true);
  slab(fx0, 0, cz1, fx1, 10, BLOCK.z0, casinoWall, true);
  slab(fx0, ch, cz0, fx1, 10, cz1, casinoWall, true);
  slab(cx0, 0, cz0 - 0.3, fx0, ch, cz0, casinoWall, true);   // the alcove's sides, its back (the lift) and its ceiling
  slab(cx0, 0, cz1, fx0, ch, cz1 + 0.3, casinoWall, true);
  slab(cx0 - 0.3, 0, cz0, cx0, ch, cz1, casinoWall, true);
  slab(cx0, ch, cz0, fx0, ch + 0.15, cz1, joint);
  slab(cx0, 0, cz0, fx1, 0.01, cz1, kit.mat({ color: 0x2a3a30, map: kit.tex.tiles(0x3a4a40, 0x1a2420, 4) }));
  // the lift's brass doors at the back, the call button lit
  slab(cx0 + 0.01, 0.05, cz0 + 0.35, cx0 + 0.04, 2.25, cz1 - 0.35, brass);
  slab(cx0 + 0.04, 0.05, (cz0 + cz1) / 2 - 0.01, cx0 + 0.05, 2.25, (cz0 + cz1) / 2 + 0.01, joint);
  kit.box(0.02, 0.06, 0.06, kit.mat({ color: 0xffb040, lit: false }), { pos: at(cx0 + 0.05, 1.2, cz1 - 0.2), parent: shell });
  // the doorman's lectern and his stool, the rope posts out on the pavement
  slab(fx0 - 0.5, 0, cz1 - 0.55, fx0 - 0.1, 1.1, cz1 - 0.1, M.wood('mahogany'), true);
  for (const z of [cz0 - 0.4, cz1 + 0.4]) {
    const s = kit.stanchion({ h: 0.95, color: kit.pal.brass });
    s.position.set(...at(fx1 + 0.5, 0, z));
    shell.add(s);
  }
  // the awning, its bulb edge, and the neon above it
  slab(fx1, 2.85, cz0 - 0.5, fx1 + 1.6, 2.98, cz1 + 0.5, kit.mat({ color: 0x8a1a1e }));
  const bulbs = kit.bulbChain({ path: [[0, 0, 0], [0, 0, cz1 - cz0 + 1]], count: 14, colors: [0xffd27a], r: 0.035 });
  bulbs.pattern('chase', 2);
  bulbs.root.position.set(...at(fx1 + 1.6, 2.82, cz0 - 0.5));
  dyn.add(bulbs.root);
  const neon = crispNeon(kit, { text: 'KASİNO', h: 0.8, color: 0xff3a6a });   // i18n-ok: the casino's in-world sign
  neon.root.position.set(...at(fx1 + 0.05, 4.3, (cz0 + cz1) / 2));
  neon.root.rotation.y = Math.PI / 2;
  dyn.add(neon.root);
  lights.push({ id: 'street:neon', pos: at(fx1 + 1.4, 3.0, (cz0 + cz1) / 2), color: 0xff4a7a, intensity: 1.0, range: 7, flicker: 'BUZZ', zone: STREET_ZONE });
  pool(fx1 + 2.6, (cz0 + cz1) / 2, 3.2, 5.5, 0xff3a6a, 0.32);   // the neon on the wet pavement

  // ── THE FAR SIDE: shopfronts with their shutters down, the çay ocağı, the büfe; the street's two ends ─────────────────
  const sx = STREET.x1;
  slab(sx, 0, STREET.z0, sx + 0.3, 9, STREET.z1 + 0.3, shops, true);
  const SHOPS: ReadonlyArray<[string, number, number]> = [   // the in-world Turkish signs: [text, z, colour]
    ['ÇAY OCAĞI', -25, 0x2a5a3a], ['BAKKAL', -16, 0x8a2a1a], ['BERBER', -8.5, 0x1a3a6a], ['ECZANE', 2.5, 0x1a6a3a],   // i18n-ok: in-world Turkish shop signs
  ];
  for (const [name, z, bg] of SHOPS) {
    slab(sx - 0.04, 0.05, z - 1.6, sx, 2.6, z + 1.6, shutter);
    slab(sx - 0.1, 2.6, z - 1.7, sx, 2.75, z + 1.7, joint);
    signX(name, 3.0, 0.5, 0xffffff, bg, sx - 0.02, 3.1, z, -1);
  }
  // the pharmacy's duty cross (the one lit shop sign in a closed street)
  slab(sx - 0.25, 3.5, 2.35, sx - 0.2, 4.1, 2.65, kit.mat({ color: 0x3aff7a, lit: false }));
  slab(sx - 0.25, 3.65, 2.2, sx - 0.2, 3.95, 2.8, kit.mat({ color: 0x3aff7a, lit: false }));
  for (let f = 1; f <= 2; f++) for (let z = STREET.z0 + 2; z < STREET.z1 - 1; z += 3.2) {
    const r = rng.next();
    slab(sx - 0.02, f * 3 + 0.6, z, sx, f * 3 + 1.9, z + 1.1, r < 0.25 ? winLit : glassDark);
  }
  const bufe = kiosk(kit, shutter);
  bufe.position.set(...at(18.8, 0, -3));
  shell.add(bufe);
  statics.push({ box: box3(17.9, 0, -4.4, 19.7, 2.5, -1.0), tag: 'solid' });
  // the ends: a brick wall up the street, road works at the bottom
  slab(FACADE_X, 0, STREET.z0 - 0.3, sx, 6, STREET.z0, brick, true);
  slab(fx1, 0, STREET.z1, sx, 2.0, STREET.z1 + 0.3, kit.mat({ color: 0x5a6a4a }), true);
  for (let i = 0; i < 5; i++) slab(STREET.curbNear + 0.5 + i * 1.3, 0.8, STREET.z1 - 0.4, STREET.curbNear + 1.3 + i * 1.3, 1.0, STREET.z1 - 0.3, kit.mat({ color: i % 2 ? 0xd8d8d0 : 0xc82a1a }));
  signX('YOL ÇALIŞMASI', 2.0, 0.4, 0x101010, 0xe8c020, (STREET.curbNear + STREET.curbFar) / 2, 1.5, STREET.z1 - 0.29, 2);   // i18n-ok: an in-world Turkish road sign
  const amber = kit.lamp({ r: 0.07, color: 0xffa020, shape: 'bulb' });
  amber.root.position.set(...at(STREET.curbNear + 0.9, 1.15, STREET.z1 - 0.35));
  amber.blink(1.2);
  dyn.add(amber.root);

  // ── THE GROUND: pavements, kerbs, the road and its markings ───────────────────────────────────────────────────────────
  slab(fx1, -0.05, STREET.z0, STREET.curbNear, 0.005, STREET.z1, pavers);
  slab(STREET.curbFar, -0.05, STREET.z0, sx, 0.005, STREET.z1, pavers);
  slab(STREET.curbNear, -0.05, STREET.z0, STREET.curbFar, 0.0, STREET.z1, tarmac);
  for (const x of [STREET.curbNear - 0.12, STREET.curbFar]) slab(x, 0, STREET.z0, x + 0.12, 0.06, STREET.z1, kerb);
  const paint = kit.mat({ color: 0xc8c4b0 });
  for (let z = STREET.z0 + 1; z < STREET.z1 - 1; z += 4) slab(14.1, 0, z, 14.25, 0.004, z + 2, paint);
  slab(12.2, 0, -12.5, 12.8, 0.006, -11.9, kit.mat({ color: 0x1a1a1a }));   // a drain grate

  // ── THE PROPS: lamps, the old car, the taxis, a bin, the cat ──────────────────────────────────────────────────────────
  const LAMP = 0xffb868;
  for (const z of LAMPS_Z) {
    const lp = lampPost(kit, LAMP);
    lp.position.set(...at(STREET.curbNear - 0.35, 0, z));
    shell.add(lp);
    statics.push({ box: box3(STREET.curbNear - 0.47, 0, z - 0.12, STREET.curbNear - 0.23, 5, z + 0.12), tag: 'solid' });
    lights.push({ id: `street:lamp:${z}`, pos: at(STREET.curbNear + 0.85, 4.6, z), color: LAMP, intensity: 1.1, range: 9, flicker: z === -13 ? 'DYING' : 'STEADY', zone: STREET_ZONE });
    pool(STREET.curbNear + 0.6, z, 5.5, 5.5, LAMP, 0.28);
  }
  const car = oldCar(kit, { body: 0x8a7a5a });
  car.position.set(...at(16.6, 0, -12));
  car.rotation.y = Math.PI;
  shell.add(car);
  statics.push({ box: box3(15.75, 0, -14.15, 17.45, 1.45, -9.85), tag: 'solid' });
  const taxiStations: InteractableX[] = [];
  for (const [end, to] of [['casino', 'home'], ['home', 'casino']] as const) {
    const p = TAXI[end];
    const cab = oldCar(kit, { body: 0xe8b820, taxi: true });
    cab.position.set(...at(p.x, 0, p.z));
    shell.add(cab);
    const b = box3(p.x - 0.85, 0, p.z - 2.15, p.x + 0.85, 1.45, p.z + 2.15);
    statics.push({ box: b, tag: 'solid' });
    taxiStations.push({
      id: `street:taxi:${end}`,
      box: b.clone().expandByScalar(0.1),
      maxDist: 2.6,
      priority: 3,
      enabled: () => goal === (to === 'home' ? 'home' : 'casino'),
      label: () => t('street.taxi'),
      sub: () => (taxiOk ? t(to === 'home' ? 'street.taxi.home' : 'street.taxi.casino') : t('street.taxi.locked')),
      disabled: () => !taxiOk,
      onInteract: () => { if (taxiOk) bus.emit('street:taxi', { to }); },
    });
  }
  slab(fx1 + 0.3, 0, -9.2, fx1 + 0.85, 0.9, -8.6, kit.mat({ color: 0x3a5a3a }), true);   // the block's bin
  const puss = cat(kit);
  puss.root.position.set(...at(fx1 + 0.35, 0, ENTRY.z1 + 0.9));
  puss.root.rotation.y = Math.PI / 2 + 0.4;
  dyn.add(puss.root);
  // two cables across the street, sagging between the façades
  const cable = kit.mat({ color: 0x101012 });
  for (const z of [-18, 1]) kit.tube([at(fx1, 6.5, z), at((fx1 + sx) / 2, 5.6, z + 0.5), at(sx, 6.3, z + 1)], 0.015, cable, { parent: shell, seg: 6, radialSeg: 3 });

  // ── the rain: streaks in a box that follows the camera, outside only (deterministic, sim time) ─────────────────────────
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_N * 6);
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const seeds = Array.from({ length: RAIN_N }, () => [rng.next(), rng.next(), rng.next()] as const);
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x9ab0c8, transparent: true, opacity: 0.45, fog: true }));
  rain.frustumCulled = false;
  rain.userData.noMerge = true;
  dyn.add(rain);
  const [ox, , oz] = at(0, 0, 0);

  o.kit.finalize(shell);

  // ── anchors ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const anchors: Record<string, THREE.Object3D> = {};
  for (const [key, a] of Object.entries(ANCHOR_PLAN)) {
    const obj = new THREE.Object3D();
    obj.position.set(...at(a.p[0], a.p[1], a.p[2]));
    obj.rotation.y = a.yaw;
    root.add(obj);
    anchors[STREET_ANCHORS[key as keyof typeof STREET_ANCHORS]] = obj;
  }

  const offs: Array<() => void> = [];
  if (o.interact) for (const s of taxiStations) offs.push(o.interact.add(s));

  return {
    root, statics, lights, anchors,
    update(dt, time) {
      tubeFx.update?.(dt, time);
      puss.tail.rotation.y = 0.35 * Math.sin(time * 1.3);
      // the rain shows only when the eye is out on the street (not in the corridor or the flat)
      let eye: THREE.Vector3 | null = null;
      try { eye = app.camera?.position ?? null; } catch { /* no camera headless */ }
      const outside = eye !== null && eye.x - ox > FACADE_X - 0.2 && eye.z - oz < STREET.z1 + 1 && eye.z - oz > STREET.z0 - 1;
      rain.visible = outside;
      if (!outside || !eye) return;
      for (let i = 0; i < RAIN_N; i++) {
        const s = seeds[i];
        const x = eye.x + (s[0] - 0.5) * RAIN_BOX.w, z = eye.z + (s[1] - 0.5) * RAIN_BOX.d;
        const y = (((s[2] * RAIN_BOX.h - time * RAIN_SPEED) % RAIN_BOX.h) + RAIN_BOX.h) % RAIN_BOX.h;
        const k = i * 6;
        rainPos[k] = x; rainPos[k + 1] = y + RAIN_LEN; rainPos[k + 2] = z;
        rainPos[k + 3] = x - 0.06; rainPos[k + 4] = y; rainPos[k + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      rainGeo.dispose();
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
      if (goal !== null) setWalk(null);
    },
  };
}
