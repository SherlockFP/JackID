/**
 * Rat Derby "The Rat Run" — procedural model (MACHINES_tables §13, plan modelBrief). `buildModel` returns a full
 * `MachineModel` and nothing else touches the scene; `DerbyParts` is the contract with `index.ts`. Metres, origin = floor
 * centre of the footprint, +Z = player side, track long axis = local X (W–E).
 *
 * Footprint 4.40 W × 2.20 D × 3.00 H. Glass-topped track 4.00 × 1.20 on legs (surface 0.91), seven lanes (six + The Albino,
 * hidden until L10) divided by brass rails; a painted grandstand behind; the split-flap tote (2.40 × 0.80) above the far
 * side at y 2.20; a betting console along the near rail; 8 standing rail spots. Rats are clockwork tin rats, 0.12 m long.
 */
import * as THREE from 'three';
import type { ButtonPanelPart, PanelButton, PanelButtonSpec, LampPart, ScreenSurface, BulbChain } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { LocalAABB, SeatDef } from '@/core/types';

export type DerbyParts = {
  /** Seven rat roots (index = lane). Moved along local X by race progress; `rats[6]` is The Albino. */
  rats: THREE.Group[];
  /** Tail pivots at each rat's rear, rotated to wag. */
  tails: THREE.Object3D[];
  /** Starting gate (drops 0.8 s on GATES). */
  gate: THREE.Object3D;
  /** Gate bell on the gate's end; swings on LOCK. */
  gateBell: THREE.Object3D;
  /** Finish line at x +1.80; `finishCam` is the flash anchor. */
  finishLine: THREE.Object3D;
  finishCam: THREE.Object3D;
  /** Split-flap tote (192 × 64 px): odds per rat, last ten winners, result. */
  tote: ScreenSurface;
  /** Betting console: rat buttons `rat1..rat7`, bet buttons `win`, `place`, `exacta`, `quinella`. */
  panel: ButtonPanelPart;
  buttons: Record<string, PanelButton>;
  /** One lamp per lane at the finish end. */
  laneLamps: LampPart[];
  /** Dark grate under the track; live rats scurry out of it (horror beat). */
  drainGrate: THREE.Mesh;
  /** Eight rail meters (bet on the spot). */
  railMeters: LampPart[];
  /** Eight rail lamps (occupancy). */
  seatLamps: LampPart[];
  /** Three-bulb strip over the track. */
  bulbs: BulbChain;
};

export const RATS = 7;
export const RAT_COLORS = [0xc0392b, 0xd4ac0d, 0xe67e22, 0x8e44ad, 0x2e86c1, 0x27ae60, 0xe8e0c8] as const;
/** Track surface height (felt top). Rats ride on it. */
export const TRACK_Y = 0.91;
export const RAT_Y = TRACK_Y + 0.04;
/** Rat progress 0 → 1 runs from the gate to the line. */
export const START_X = -1.72, FINISH_X = 1.78;
const GATE_X = START_X - 0.06, GATE_UP = 1.2, GATE_DOWN = TRACK_Y + 0.03;
/** Lane centre (z) for lane `i` (0-based): six lanes of 0.2 m across the 1.2 m track. */
export const laneZ = (i: number): number => -0.5 + 0.2 * i;
/** Rat x for progress `p` in 0..1. */
export const ratX = (p: number): number => START_X + (FINISH_X - START_X) * p;
export const GATE_UP_Y = GATE_UP, GATE_DOWN_Y = GATE_DOWN;
/** Eight standing rail spots (x). Stand strip is z ≥ 1.3. */
export const SEAT_XS: readonly number[] = [-1.4, -1.0, -0.6, -0.2, 0.2, 0.6, 1.0, 1.4];
const SEAT_Z = 1.32;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<DerbyParts> {
  const { pal } = kit;
  const root = new THREE.Group();
  root.name = 'derby';
  const wood = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged into a few draws) ──
  for (const [x, z] of [[-1.9, -0.5], [1.9, -0.5], [-1.9, 0.5], [1.9, 0.5]] as const) kit.cyl(0.035, 0.035, 0.84, pal.brass, { pos: [x, 0.42, z], seg: 8, parent: root });
  kit.box(4.0, 0.12, 1.2, wood, at(0, 0.84, 0));                                  // track bed on legs (top 0.90)
  kit.box(3.96, 0.012, 1.16, pal.felt, at(0, 0.904, 0));                          // green baize, top at TRACK_Y
  for (const z of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) kit.box(4.0, 0.03, 0.02, pal.brass, at(0, 0.925, z));   // lane rails
  for (const x of [-2.02, 2.02]) kit.box(0.04, 0.84, 1.24, wood, at(x, 0.42, 0));  // end panels
  kit.box(4.0, 0.02, 0.04, pal.black, at(0, 0.91, -0.62));                         // far kerb
  kit.box(4.0, 0.02, 0.04, pal.black, at(0, 0.91, 0.62));                          // near kerb
  kit.box(3.2, 0.6, 0.06, pal.redDark, at(0, 1.2, -0.8));                          // painted grandstand backdrop
  kit.box(3.2, 0.12, 0.42, pal.feltDark, at(0, 0.96, -0.6));                       // grandstand bench

  // glass top over the track
  const glass = kit.glass({ w: 4.0, h: 0.01, d: 1.2, tint: 0xbfe8d8, opacity: 0.22 });
  glass.position.set(0, 0.94, 0);
  root.add(glass);

  // tote: bezel, posts, split-flap screen above the far side
  kit.box(2.5, 0.9, 0.06, pal.black, at(0, 2.2, -0.66));
  for (const x of [-1.2, 1.2]) kit.box(0.05, 1.3, 0.05, pal.brass, at(x, 1.25, -0.66));
  const tote = kit.screen({ w: 2.4, h: 0.8, px: [192, 64], bezel: pal.black });
  tote.mesh.position.set(0, 2.2, -0.62);
  root.add(tote.mesh);

  // ── track: rats, gate and the finish ──
  const rats: THREE.Group[] = [], tails: THREE.Object3D[] = [];
  for (let i = 0; i < RATS; i++) {
    const g = new THREE.Group();
    g.name = `rat${i + 1}`;
    g.position.set(ratX(0), RAT_Y, laneZ(i));
    root.add(g);
    kit.sphere(0.04, RAT_COLORS[i], { parent: g, scale: [1.5, 1, 1.1], wSeg: 8, hSeg: 6 });   // body, 0.12 long
    const tail = new THREE.Object3D();
    tail.position.set(-0.06, 0.01, 0);
    g.add(tail);
    kit.tube([[0, 0, 0], [-0.05, 0.01, 0], [-0.09, 0, 0], [-0.11, -0.01, 0]], 0.005, pal.black, { parent: tail, seg: 3, radialSeg: 3 });
    rats.push(g);
    tails.push(tail);
  }

  const gate = new THREE.Object3D();
  gate.name = 'gate';
  gate.position.set(GATE_X, GATE_UP, 0);
  root.add(gate);
  kit.box(0.02, 0.05, 1.2, pal.red, { parent: gate, pos: [0, -0.02, 0] });        // bar across the lanes
  const gateBell = kit.sphere(0.035, pal.brass, { parent: gate, pos: [0, 0.07, 0.64], wSeg: 8, hSeg: 6 });

  const finishLine = new THREE.Object3D();
  finishLine.name = 'finishLine';
  finishLine.position.set(1.8, TRACK_Y, 0);
  root.add(finishLine);
  kit.box(0.015, 0.004, 1.2, pal.cream, { parent: finishLine, pos: [0, 0.002, 0] });   // painted line
  kit.cyl(0.01, 0.01, 0.7, pal.chrome, { parent: finishLine, pos: [0.04, 0.35, -0.66], seg: 6 });  // flag pole
  kit.box(0.2, 0.12, 0.005, pal.cream, { parent: finishLine, pos: [0.04, 0.66, -0.66] });          // checker flag
  const finishCam = new THREE.Object3D();
  finishCam.position.set(1.8, 1.2, 0.9);
  root.add(finishCam);

  const drainGrate = kit.box(0.8, 0.01, 0.5, pal.black, at(0, 0.2, 0));

  // lane lamps at the finish end, one per lane (7th = The Albino, lit only when present)
  const laneLamps: LampPart[] = [];
  for (let i = 0; i < RATS; i++) {
    const l = kit.lamp({ r: 0.018, color: RAT_COLORS[i], shape: 'dome' });
    l.root.position.set(2.04, 0.95, laneZ(i));
    root.add(l.root);
    laneLamps.push(l);
  }

  // three-bulb strip over the track
  const bulbs = kit.bulbChain({ path: [[-0.5, 1.95, 0], [0, 1.95, 0], [0.5, 1.95, 0]], count: 3, colors: [0xffb347], r: 0.02 });
  root.add(bulbs.root);

  // ── betting console along the near rail ──
  kit.box(2.2, 0.9, 0.5, wood, at(0, 0.45, 0.85));
  kit.box(2.2, 0.03, 0.03, pal.brass, at(0, 0.91, 1.1));
  const specs: PanelButtonSpec[] = [];
  for (let i = 0; i < RATS; i++) {
    specs.push({ id: `rat${i + 1}`, label: String(i + 1), color: RAT_COLORS[i], x: -0.9 + i * 0.3, z: -0.07, w: 0.22, h: 0.16 });
  }
  specs.push(
    { id: 'win', label: { key: 'm.derby.win' }, color: pal.gold, x: -0.6, z: 0.09, w: 0.36, h: 0.14 },
    { id: 'place', label: { key: 'm.derby.place' }, color: pal.gold, x: -0.2, z: 0.09, w: 0.36, h: 0.14 },
    { id: 'exacta', label: { key: 'm.derby.exacta' }, color: pal.gold, x: 0.2, z: 0.09, w: 0.36, h: 0.14 },
    { id: 'quinella', label: { key: 'm.derby.quinella' }, color: pal.gold, x: 0.6, z: 0.09, w: 0.36, h: 0.14 },
  );
  const panel = kit.buttonPanel({ buttons: specs, w: 2.1, d: 0.34, slope: 12, plate: pal.black });
  panel.root.position.set(0, 0.905, 0.84);
  root.add(panel.root);

  // seat lamps and rail meters along the stand edge
  const seatLamps: LampPart[] = [], railMeters: LampPart[] = [];
  const seats: SeatDef[] = [];
  for (const sx of SEAT_XS) {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    l.root.position.set(sx, 0.9, 1.14);
    root.add(l.root);
    seatLamps.push(l);
    const m = kit.lamp({ r: 0.012, color: pal.neonYellow, shape: 'dome' });
    m.root.position.set(sx, 1.0, 1.14);
    root.add(m.root);
    railMeters.push(m);
    seats.push({
      pose: { pos: new THREE.Vector3(sx, 1.5, SEAT_Z), look: new THREE.Vector3(sx, 0.95, 0), fov: 60, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, SEAT_Z + 0.02),
      avatar: 'stand',
    });
  }

  // ── anchors and collision ──
  const speaker = new THREE.Object3D(); speaker.position.set(-1.95, 1.0, 0); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.2, 1.0); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 2.6, -0.5); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.96, -0.6); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.95, 0.9, 0.9); root.add(servicePlate);
  const followCam = new THREE.Object3D(); followCam.position.set(0, 1.5, 1.1); root.add(followCam);
  const light = new THREE.Object3D();
  light.position.set(0, 1.95, 0);
  light.userData = { color: 0xffb347, intensity: 1.0, range: 4, flicker: 'BUZZ' };
  root.add(light);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.95, 0.75); root.add(coinOut);

  const parts: DerbyParts = {
    rats, tails, gate, gateBell, finishLine, finishCam, tote, panel, buttons: panel.buttons, laneLamps, drainGrate,
    railMeters, seatLamps, bulbs,
  };
  kit.finalize(root, {
    keep: [...rats, gate, tote.mesh, panel.root, bulbs.root, ...laneLamps.map((l) => l.root), ...seatLamps.map((l) => l.root), ...railMeters.map((l) => l.root)],
  });

  const colliders: LocalAABB[] = [
    { min: [-2.02, 0, -0.66], max: [2.02, 0.95, 0.66] },     // track and cabinet
    { min: [-1.1, 0, 0.6], max: [1.1, 1.0, 1.1] },           // betting console
    { min: [-1.7, 0, -1.1], max: [1.7, 2.9, -0.5] },         // grandstand and tote
  ];
  return {
    root,
    parts,
    playPose: seats[3].pose,
    seats,
    colliders,
    interact: { min: [-1.2, 0.2, 0.2], max: [1.2, 1.3, 1.15] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, followCam, light, coinOut, finishCam },
    dispose: () => tote.dispose(),
  };
}
