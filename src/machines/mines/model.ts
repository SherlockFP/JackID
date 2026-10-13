/**
 * Mines Terminal — procedural model (MACHINES_machines §12, plan.json modelBrief, ART_BIBLE §5.20).
 *  - `buildModel(kit, o)` returns the full `MachineModel` and nothing else touches the scene;
 *  - `MinesParts` is the contract with `index.ts`;
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side).
 *
 * Cabinet: olive-drab console 1.10 W × 0.90 D, top tilted 15° toward the player at 1.00 m. The top is a velvet
 * plate with a 5×5 grid of brass tile flaps (0.15, pitch 0.17). Each flap is a pivot Group hinged on its back edge.
 * Under the flaps lies ONE pooled reveal socket (`under`): it carries the gold coin for a safe tile or the bear trap
 * for a mine, and it moves under the tile being revealed. Full-board reveals walk the trap across every mine.
 * Above the back of the top sits a green CRT on a stalk (multiplier ladder), a hooded lamp, three LEDs, a button
 * keyboard tray on the front and a guarded red CASH OUT switch on the top right.
 *
 * BUDGET: the brief asks ≤ 1000 tris and ≤ 14 draws. Tris are well inside the budget. Draws are NOT: each of the 25
 * flaps is its own hinged mesh, so the grid alone costs 25 draws. A pooled socket replaces the 25 coins and 25 traps.
 */
import * as THREE from 'three';
import type { ButtonPanelPart, ButtonPart, LampPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

/** Contract between modeler and coder. */
export type MinesParts = {
  /** 25 flap pivots (rotation.x 0 → −1.9 rad lifts the flap), index row-major, row 0 at the back. */
  tiles: THREE.Group[];
  /** Pooled reveal socket: moved under the tile being revealed; hidden between reveals. */
  under: THREE.Group;
  /** Pooled gold coin (child of `under`): a safe tile. */
  coin: THREE.Mesh;
  /** Pooled bear trap (child of `under`): a mine. Snaps via jawL / jawR. */
  trap: THREE.Group;
  jawL: THREE.Object3D;
  jawR: THREE.Object3D;
  /** Porcelain finger caught in the jaws, shown now and then (no blood). Child of `trap`. */
  finger: THREE.Object3D;
  /** Emissive selector frame that moves between tiles. Child of the top. */
  selector: THREE.Group;
  /** 160×120 CRT: multiplier ladder, stake, mines left. */
  screen: ScreenSurface;
  /** CRT root (flicker / shake target). */
  crt: THREE.Object3D;
  /** Hooded lamp over the grid. */
  lamp: LampPart;
  /** Guard cover of the CASH OUT switch (rotation.x 0 = closed, −1.3 = up). */
  cashGuard: THREE.Object3D;
  cashToggle: ButtonPart;
  /** Cosmetic keyboard tray (6 keys). */
  keys: ButtonPanelPart;
  leds: { credit: LampPart; bet: LampPart; win: LampPart };
};

export const DIMS = { W: 1.10, D: 0.90, H: 1.60 } as const;
export const TOP_Y = 1.0;
export const TILT = (15 * Math.PI) / 180;
export const GRID_X = -0.10;
export const PITCH = 0.17;
export const FLAP = 0.15;
export const CASH = { x: 0.40, z: 0.20 } as const;
export const FLIP_OPEN = -1.9;
const KEYS = 6;

/** Centre of cell `i` in the top's local frame (before the 15° tilt). */
export function cellPos(i: number): { x: number; z: number } {
  const r = Math.floor(i / 5), c = i % 5;
  return { x: GRID_X + (c - 2) * PITCH, z: (r - 2) * PITCH };
}

const BODY: readonly number[] = [0x4b5320, 0x434c24, 0x56582c, 0x3d4420];   // olive-drab colourways

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<MinesParts> {
  const { pal } = kit;
  const body = BODY[o.variant] ?? BODY[0];
  const steel = 0x2a2d1c;
  const rust = 0x5a3a24;
  const brass = pal.brass;
  const root = kit.group('mines');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static cabinet shell (flat colours: merged by kit.finalize) ──
  kit.box(1.10, 0.82, 0.90, body, at(0, 0.49, 0));                    // body, top at 0.90
  kit.box(1.06, 0.08, 0.86, steel, at(0, 0.04, 0));                   // plinth
  kit.box(1.10, 0.14, 0.50, body, at(0, 0.97, -0.20));                // back riser under the tilted top
  kit.box(0.03, 0.82, 0.86, steel, at(-0.555, 0.49, 0));              // side panels
  kit.box(0.03, 0.82, 0.86, steel, at(0.555, 0.49, 0));
  kit.cyl(0.025, 0.025, 0.12, steel, { pos: [0, 1.10, -0.12], parent: root, seg: 6 }); // CRT stalk

  // ── tilted top: velvet plate, brass frame, flaps, socket, selector ──
  const tilt = kit.group('mines_top');
  tilt.position.set(0, TOP_Y, 0);
  tilt.rotation.x = TILT;
  root.add(tilt);
  const topAt = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: tilt });

  kit.box(1.02, 0.03, 0.94, pal.carpet, topAt(0, -0.025, 0));         // P41 velvet bed (top face at −0.01)
  for (const sx of [-1, 1]) kit.box(0.015, 0.012, 0.86, brass, topAt(GRID_X + sx * 0.43, 0.004, 0));
  for (const sz of [-1, 1]) kit.box(0.86, 0.012, 0.015, brass, topAt(GRID_X, 0.004, sz * 0.43));

  const tiles: THREE.Group[] = [];
  for (let i = 0; i < 25; i++) {
    const { x, z } = cellPos(i);
    const pivot = kit.group(`tile_${i}`);
    pivot.position.set(x, 0, z - FLAP / 2);                             // hinge on the back edge
    tilt.add(pivot);
    kit.box(FLAP, 0.02, FLAP, brass, { pos: [0, 0.01, FLAP / 2], parent: pivot });
    tiles.push(pivot);
  }

  // pooled socket: coin for a safe tile, trap for a mine
  const under = kit.group('mines_reveal');
  under.position.set(GRID_X, -0.004, 0);
  tilt.add(under);
  const coin = kit.coin({ r: 0.04, thick: 0.008, heads: 'crown', tails: 'eye', color: pal.gold });
  coin.visible = false;
  under.add(coin);

  const trap = kit.group('mines_trap');
  trap.visible = false;
  under.add(trap);
  kit.cyl(0.05, 0.05, 0.006, rust, { pos: [0, 0.003, 0], parent: trap, seg: 12 });
  const jawL = kit.group('jawL');
  const jawR = kit.group('jawR');
  trap.add(jawL, jawR);
  kit.cyl(0.045, 0.045, 0.01, rust, { pos: [0, 0.008, 0], parent: jawL, seg: 8, thetaLen: Math.PI });
  kit.cyl(0.045, 0.045, 0.01, rust, { pos: [0, 0.008, 0], parent: jawR, seg: 8, thetaLen: Math.PI, rot: [0, 180, 0] });
  for (let j = 0; j < 6; j++) {                                          // six teeth per jaw
    const a = ((j + 0.5) / 6) * Math.PI;
    kit.box(0.008, 0.012, 0.008, rust, { pos: [0.045 * Math.sin(a), 0.014, 0.045 * Math.cos(a)], parent: jawL });
    kit.box(0.008, 0.012, 0.008, rust, { pos: [-0.045 * Math.sin(a), 0.014, -0.045 * Math.cos(a)], parent: jawR });
  }
  const finger = kit.cyl(0.005, 0.004, 0.06, pal.cream, { pos: [0.03, 0.022, 0], rot: [0, 0, 90], parent: trap, seg: 6 });
  finger.visible = false;

  const selector = kit.group('mines_selector');
  tilt.add(selector);
  for (const [sx, sz, w, d] of [[0, -0.09, 0.2, 0.012], [0, 0.09, 0.2, 0.012], [-0.09, 0, 0.012, 0.2], [0.09, 0, 0.012, 0.2]] as const) {
    kit.box(w, 0.008, d, pal.neonYellow, { pos: [sx, 0.03, sz], parent: selector });
  }
  selector.position.set(cellPos(12).x, 0, cellPos(12).z);

  // CASH OUT: a guard over a red toggle, on the top right
  kit.cyl(0.05, 0.05, 0.02, steel, { pos: [CASH.x, 0.0, CASH.z], parent: tilt, seg: 10 });
  const cashGuard = kit.group('mines_guard');
  cashGuard.position.set(CASH.x, 0.02, CASH.z - 0.06);
  tilt.add(cashGuard);
  kit.box(0.10, 0.008, 0.12, pal.redDark, { pos: [0, 0.004, 0.06], parent: cashGuard });
  const cashToggle = kit.button({ shape: 'round', r: 0.03, color: pal.red });
  cashToggle.root.position.set(CASH.x, 0.02, CASH.z);
  tilt.add(cashToggle.root);

  // ── CRT on a stalk, behind the grid (screen faces the player) ──
  const crt = kit.crtMonitor({ w: 0.30, h: 0.23, px: [160, 120], scheme: 'green', glow: 0.6 });
  crt.root.position.set(0, 1.30, -0.12);
  root.add(crt.root);

  // ── lamp, LEDs, label, keyboard tray ──
  const lamp = kit.lamp({ r: 0.035, color: pal.neonYellow, shape: 'dome' });
  lamp.root.position.set(-0.46, 1.22, 0.10);
  root.add(lamp.root);

  const leds = {
    credit: kit.lamp({ r: 0.012, color: pal.red, shape: 'flat' }),
    bet: kit.lamp({ r: 0.012, color: pal.neonYellow, shape: 'flat' }),
    win: kit.lamp({ r: 0.012, color: pal.green, shape: 'flat' }),
  };
  [leds.credit, leds.bet, leds.win].forEach((l, i) => { l.root.position.set(-0.30 + i * 0.08, 0.66, 0.455); root.add(l.root); });

  const label = kit.label({ text: { key: 'm.mines.name' }, w: 0.5, h: 0.12, px: [256, 64], color: pal.neonYellow, bg: pal.black });
  label.mesh.position.set(-0.22, 0.52, 0.452);
  root.add(label.mesh);

  const keys = kit.buttonPanel({
    w: 0.42, d: 0.22, slope: 22, plate: steel, capH: 0.02,
    buttons: Array.from({ length: KEYS }, (_, i) => ({ id: `k${i}`, color: pal.bone, x: -0.16 + i * 0.064, z: 0, w: 0.05, h: 0.05 })),
  });
  keys.root.position.set(0.16, 0.78, 0.56);
  root.add(keys.root);

  // light hint for the world's pooled lights (no THREE.Light inside machines)
  const light = new THREE.Object3D();
  light.position.set(-0.46, 1.22, 0.10);
  light.userData = { color: 0xffe2a0, intensity: 0.9, range: 2, flicker: 'STEADY' };
  root.add(light);

  // anchors (MODEL_ANCHORS)
  const anchor = (x: number, y: number, z: number): THREE.Object3D => { const o3 = new THREE.Object3D(); o3.position.set(x, y, z); root.add(o3); return o3; };
  const speaker = anchor(0, 0.5, 0.455);
  const prompt = anchor(0, 1.25, 0.2);
  const marqueeTop = anchor(0, 1.06, -0.25);
  const servicePlate = anchor(-0.56, 0.4, 0);
  const stand = anchor(0, 0, 0.78);
  const fxTwist = anchor(CASH.x, 1.02, CASH.z);

  const parts: MinesParts = {
    tiles, under, coin, trap, jawL, jawR, finger, selector,
    screen: crt.screen, crt: crt.root, lamp, cashGuard, cashToggle, keys, leds,
  };
  kit.finalize(root, {
    keep: [
      ...tiles, under, selector, cashGuard, cashToggle.root, keys.root, lamp.root, leds.credit.root, leds.bet.root,
      leds.win.root, crt.root, light,
    ],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 0.7), look: new THREE.Vector3(0, 1.0, 0), fov: 55, mouse: 'pick' },
    colliders: [{ min: [-0.55, 0, -0.45], max: [0.55, 1.04, 0.47] }],
    interact: { min: [-0.55, 0.1, -0.45], max: [0.55, 1.1, 0.6] },
    anchors: { speaker, prompt, label: label.mesh, marqueeTop, servicePlate, stand, light, fxTwist },
    dispose: () => crt.screen.dispose(),
  };
}
