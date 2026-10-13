/**
 * The Devil's Table — SHELLS duel, procedural model (MACHINES_tables §5A.1 / ART_BIBLE DEVIL'S PARLOUR, owner: devilstable).
 *  - `buildModel(kit, o)` returns the whole `MachineModel`; the exported `DevilParts` type is the contract with `index.ts`;
 *  - metres, origin = floor centre, +Z = the player's side, Y up. Footprint 2.40 W × 1.80 D, height 2.10 (Devil included).
 *
 * Seats: 0 = player chair (+Z), 1 = the Devil's chair (−Z), 2 / 3 = side stools (−X / +X, PvP only).
 * The coach gun sits on a brass turntable rig in the middle; it only ever aims at a seat lantern (`seatLantern0..3`).
 * Each seat has a defibrillator box (6 lamps = charges), an item tray (4 × 2 slots) and a brass lantern.
 */
import * as THREE from 'three';
import type { DealerPart, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.74;                          // table top, m
const FELT = 0x4a193a;                            // felt_violet
const LIVE_HULL = 0x5a1019, BLANK_HULL = 0x5a525a;
const LAMP_ON = 0x5aff7b;
const CHARGES = 6;
export const SLOTS = 8;
/** Seat unit directions (seat 0 = +Z, 1 = −Z, 2 = −X, 3 = +X). */
export const SEAT_DIR: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [-1, 0], [1, 0]];
const CHAIR_R = [0.70, 0.70, 0.95, 0.95];
const LANTERN_R = 0.58;
const LANTERN_Y = 0.98;

export interface DefibPart { root: THREE.Group; lamps: LampPart[]; needle: THREE.Object3D; paddles: THREE.Object3D }

export type DevilParts = {
  devil: DealerPart;
  turntable: THREE.Group;                // yaw = aim (atan2 of the target's offset)
  gun: THREE.Group;                      // child of the turntable; lifted above the tray
  barrels: THREE.Object3D[];             // two barrels: recoil and kick target
  hammers: THREE.Object3D[];             // two hammers: cock / fall
  shells: THREE.Mesh[];                  // 8 tray shells, hidden when empty
  shellLive: THREE.Material;
  shellBlank: THREE.Material;
  flap: THREE.Object3D;                  // leather flap that sweeps the tray into the magazine
  defibs: DefibPart[];                   // 4 seats
  itemSlots: THREE.Object3D[][];         // [seat][slot 0..7] anchors for item props
  lanterns: THREE.Group[];               // seat lanterns (aim targets)
  lanternGlass: THREE.Mesh[];            // shatter on a BANG
  lanternLamps: LampPart[];              // the candle inside each lantern
  screen: ScreenSurface;                 // round / charges / state readout
  modeLabel: THREE.Object3D;
  moth: THREE.Object3D;                  // where the Devil bursts into moths
  servicePlate: THREE.Object3D;          // where the commiserate popup lands
};

const dirOf = (s: number): THREE.Vector3 => new THREE.Vector3(SEAT_DIR[s][0], 0, SEAT_DIR[s][1]);
const perpOf = (s: number): THREE.Vector3 => new THREE.Vector3(-SEAT_DIR[s][1], 0, SEAT_DIR[s][0]);

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<DevilParts> {
  const { pal } = kit;
  const root = kit.group('devilstable');
  const wood = o.variant % 2 ? pal.woodDark : 0x2c1410;
  const leather = pal.leather;

  // pedestal, base and the violet felt with a brass rim
  kit.cyl(0.46, 0.5, 0.05, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, 0.025, 0], seg: 12, parent: root });
  kit.cyl(0.14, 0.2, TOP - 0.06, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, (TOP - 0.06) / 2, 0], seg: 10, parent: root });
  kit.cyl(0.55, 0.55, 0.03, { color: FELT, map: kit.tex.felt(FELT) }, { pos: [0, TOP - 0.015, 0], seg: 20, parent: root });
  kit.torus(0.55, 0.03, pal.brass, { pos: [0, TOP, 0], rot: [90, 0, 0], seg: 20, parent: root });

  // chairs and stools
  const seats: SeatDef[] = [];
  for (let s = 0; s < 4; s++) {
    const d = dirOf(s), r = CHAIR_R[s];
    const x = d.x * r, z = d.z * r;
    const back = s < 2;
    kit.cyl(0.2, 0.2, 0.06, { color: leather }, { pos: [x, 0.47, z], seg: 10, parent: root });
    kit.cyl(0.03, 0.04, 0.45, pal.chrome, { pos: [x, 0.225, z], seg: 6, parent: root });
    if (back) kit.box(0.42, 0.55, 0.05, { color: leather }, { pos: [x + d.x * 0.22, 0.8, z + d.z * 0.22], parent: root });
    seats.push({
      pose: {
        pos: new THREE.Vector3(d.x * (r + 0.08), 1.15, d.z * (r + 0.08)),
        look: new THREE.Vector3(0, 0.8, 0),
        fov: 55,
        mouse: 'primary',
      },
      stand: new THREE.Vector3(x, 0, z),
      avatar: 'sit',
    });
  }

  // the brass turntable with a coach gun (double barrel, brass receiver, walnut stock, two hammers)
  const turntable = new THREE.Group();
  turntable.position.set(0, TOP + 0.005, 0);
  root.add(turntable);
  kit.cyl(0.15, 0.15, 0.02, pal.brass, { pos: [0, 0.01, 0], seg: 16, parent: turntable });
  const gun = new THREE.Group();
  gun.position.set(0, 0.11, 0);
  turntable.add(gun);
  kit.box(0.09, 0.06, 0.14, pal.brass, { pos: [0, 0.03, 0], parent: gun });
  const barrels: THREE.Object3D[] = [];
  for (const bx of [-0.022, 0.022]) {
    barrels.push(kit.cyl(0.018, 0.018, 0.45, pal.steel, { pos: [bx, 0.05, 0.27], rot: [90, 0, 0], seg: 6, parent: gun }));
  }
  kit.box(0.07, 0.09, 0.22, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, 0.0, -0.16], rot: [-6, 0, 0], parent: gun });
  const hammers: THREE.Object3D[] = [];
  for (const hx of [-0.022, 0.022]) {
    hammers.push(kit.box(0.016, 0.03, 0.02, pal.brass, { pos: [hx, 0.07, -0.06], parent: gun }));
  }

  // the shell tray (brass) under the gun, its leather flap, and the eight shells (live / blank share two materials)
  kit.box(0.30, 0.02, 0.10, pal.brass, { pos: [0, TOP + 0.01, 0], parent: root });
  const flap = kit.box(0.30, 0.005, 0.03, leather, { pos: [0, TOP + 0.03, 0.07], parent: root });
  const shellLive = kit.mat({ color: LIVE_HULL });
  const shellBlank = kit.mat({ color: BLANK_HULL });
  const shells: THREE.Mesh[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const m = kit.cyl(0.018, 0.018, 0.05, shellBlank, { pos: [-0.12 + i * 0.034, TOP + 0.035, 0], rot: [0, 0, 90], seg: 6, parent: root });
    m.visible = false;
    shells.push(m);
  }

  // per seat: defibrillator box, item tray, lantern
  const defibs: DefibPart[] = [];
  const itemSlots: THREE.Object3D[][] = [];
  const lanterns: THREE.Group[] = [];
  const lanternGlass: THREE.Mesh[] = [];
  const lanternLamps: LampPart[] = [];
  for (let s = 0; s < 4; s++) {
    const d = dirOf(s), p = perpOf(s);
    const ang = Math.atan2(d.x, d.z);

    // defib box with charge lamps
    const db = kit.group(`defib${s}`);
    db.position.set(d.x * 0.42, TOP, d.z * 0.42);
    db.rotation.y = ang;
    root.add(db);
    kit.box(0.22, 0.14, 0.10, 0x0e0c0e, { pos: [0, 0.07, 0], parent: db });
    const lamps: LampPart[] = [];
    for (let i = 0; i < CHARGES; i++) {
      const l = kit.lamp({ r: 0.011, color: LAMP_ON, shape: 'flat' });
      l.root.position.set(-0.08 + i * 0.032, 0.145, 0.03);
      db.add(l.root);
      lamps.push(l);
    }
    const needle = kit.box(0.004, 0.035, 0.004, pal.brass, { pos: [0.07, 0.11, 0.05], parent: db });
    const paddles = kit.group(`paddles${s}`);
    paddles.position.set(0, 0.07, 0);
    db.add(paddles);
    for (const px of [-0.14, 0.14]) kit.cyl(0.016, 0.016, 0.06, pal.steel, { pos: [px, 0, 0], rot: [0, 0, 90], seg: 6, parent: paddles });
    defibs.push({ root: db, lamps, needle, paddles });

    // item tray: 4 columns × 2 rows of felt pockets, anchors sit on the pockets
    const trayC = new THREE.Vector3(d.x * 0.26, TOP, d.z * 0.26);
    kit.box(0.34, 0.01, 0.14, { color: leather }, { pos: [trayC.x, TOP + 0.005, trayC.z], rot: [0, ang, 0], parent: root });
    const slots: THREE.Object3D[] = [];
    for (let k = 0; k < SLOTS; k++) {
      const col = k % 4, row = Math.floor(k / 4);
      const a = new THREE.Object3D();
      a.position.set(
        trayC.x + p.x * (col - 1.5) * 0.075 + d.x * (row - 0.5) * 0.07,
        TOP + 0.02,
        trayC.z + p.z * (col - 1.5) * 0.075 + d.z * (row - 0.5) * 0.07,
      );
      root.add(a);
      slots.push(a);
    }
    itemSlots.push(slots);

    // lantern above the rail, a candle inside, glass that can shatter
    const lantern = kit.group(`lantern${s}`);
    lantern.position.set(d.x * LANTERN_R, LANTERN_Y, d.z * LANTERN_R);
    root.add(lantern);
    kit.cyl(0.05, 0.06, 0.02, pal.brass, { pos: [0, -0.07, 0], seg: 8, parent: lantern });
    lanternGlass.push(kit.cyl(0.045, 0.045, 0.11, { color: 0xffd9a0 }, { pos: [0, 0, 0], seg: 8, parent: lantern }));
    kit.cyl(0.055, 0.055, 0.01, pal.brass, { pos: [0, 0.07, 0], seg: 8, parent: lantern });
    const flame = kit.lamp({ r: 0.02, color: 0xffa040, shape: 'dome' });
    flame.root.position.set(0, -0.01, 0);
    lantern.add(flame.root);
    lanternLamps.push(flame);
    lanterns.push(lantern);
  }

  // the Devil: 2.1 m automaton behind the table, facing the player
  const devil = kit.dealer({ style: 'devil', height: 2.1, feltY: TOP });
  devil.root.position.set(0, 0, -1.02);
  root.add(devil.root);

  // readout on a post at the left rail (faces the player's left), mode plaque on the right rail
  kit.cyl(0.012, 0.012, 0.36, pal.brass, { pos: [-0.62, TOP + 0.18, 0], seg: 6, parent: root });
  const screen = kit.screen({ w: 0.24, h: 0.12, px: [96, 48], bezel: pal.black });
  screen.mesh.position.set(-0.62, TOP + 0.42, 0);
  screen.mesh.rotation.y = -Math.PI / 2;
  root.add(screen.mesh);
  const modeLabel = kit.label({ text: { key: 'm.devilstable.modeShells' }, w: 0.34, h: 0.09, px: [128, 32], color: pal.gold, bg: pal.black });
  modeLabel.mesh.position.set(0.62, TOP + 0.22, 0);
  modeLabel.mesh.rotation.y = Math.PI / 2;
  root.add(modeLabel.mesh);

  // lights: candelabra over the table (flickering), overhead sickly lamp, the speaker/prompt/anchors
  const light = new THREE.Object3D();
  light.position.set(0, 1.45, 0.2);
  light.userData = { color: 0xffd9a0, intensity: 0.6, range: 2.4, flicker: 'CANDLE' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, 1.95, 0);
  light2.userData = { color: 0xff7a7a, intensity: 0.4, range: 3, flicker: 'SICK' };
  root.add(light2);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, 0.5);
  root.add(prompt);
  const marqueeTop = new THREE.Object3D();
  marqueeTop.position.set(0, 2.05, 0.1);
  root.add(marqueeTop);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(0, 0.25, 0.2);
  root.add(servicePlate);
  const mothBurst = new THREE.Object3D();
  mothBurst.position.set(0, 1.4, -1.0);
  root.add(mothBurst);

  root.add(kit.blobShadow(1.4, 2.0));

  const parts: DevilParts = {
    devil, turntable, gun, barrels, hammers, shells, shellLive, shellBlank, flap, defibs, itemSlots,
    lanterns, lanternGlass, lanternLamps, screen, modeLabel: modeLabel.mesh, moth: mothBurst, servicePlate,
  };
  kit.finalize(root, {
    keep: [
      turntable, gun, ...barrels, ...hammers, ...shells, flap, ...defibs.flatMap((d) => [d.root, ...d.lamps]),
      ...lanterns, ...lanternGlass, ...lanternLamps, screen.mesh, modeLabel.mesh, light, light2, devil.root,
    ],
  });

  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-0.56, 0, -0.56], max: [0.56, TOP + 0.02, 0.56] },
      { min: [-0.22, 0, -1.25], max: [0.22, 2.1, -0.85] },
      { min: [-1.07, 0, -0.12], max: [-0.83, 0.5, 0.12] },
      { min: [0.83, 0, -0.12], max: [1.07, 0.5, 0.12] },
    ],
    interact: { min: [-0.7, 0.2, -1.25], max: [0.7, 1.2, 1.0] },
    anchors: {
      speaker: prompt, prompt, label: modeLabel.mesh, marqueeTop, servicePlate, light, light2, mothBurst, coinOut: prompt,
      seatLantern0: lanterns[0], seatLantern1: lanterns[1], seatLantern2: lanterns[2], seatLantern3: lanterns[3],
    },
    dispose: () => screen.dispose(),
  };
}
