/**
 * Night Derby "The Rat Run" (`derby`) — procedural model (MACHINES_tables §13). `buildModel` returns a full
 * `MachineModel` and nothing else touches the scene; `DerbyParts` is the contract with `index.ts`. Metres, origin = floor
 * centre of the footprint, +Z = player side, track long axis = local X (W–E).
 *
 * Footprint 4.40 W × 2.20 D × 3.00 H. A floodlit dirt track 4.00 × 1.20 on legs (surface 0.91, glass over it), seven lanes
 * (six + The Albino, hidden until L10) divided by white rails; a painted grandstand with a dark crowd and pennants behind;
 * the split-flap odds board (2.40 × 0.80) above the far side at y 2.20; a photo-finish camera on the line; a betting console
 * along the near rail; 8 standing rail spots. The runners are tin racehorses with dark jockeys, 0.17 m long, in six silks.
 */
import * as THREE from 'three';
import type { ButtonPanelPart, PanelButton, PanelButtonSpec, LampPart, ScreenSurface, BulbChain } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import type { LocalAABB, SeatDef } from '@/core/types';

export type DerbyParts = {
  /** Seven horse roots (index = lane). Moved along local X by race progress; `horses[6]` is The Albino. */
  horses: THREE.Group[];
  /** Tail pivots at each horse's rear, rotated to swish. */
  tails: THREE.Object3D[];
  /** Per horse, [front legs, hind legs] pivots, rotated about Z to gallop. */
  gallop: THREE.Object3D[][];
  /** Pennants on the grandstand: they flap with the crowd. */
  pennants: THREE.Object3D[];
  /** Photo-finish camera flash at the line. */
  photoLamp: LampPart;
  /** Starting gate (drops 0.8 s on GATES). */
  gate: THREE.Object3D;
  /** Gate bell on the gate's end; swings on LOCK. */
  gateBell: THREE.Object3D;
  /** Finish line at x +1.80; `finishCam` is the flash anchor. */
  finishLine: THREE.Object3D;
  finishCam: THREE.Object3D;
  /** Split-flap odds board (192 × 64 px): win / place / show odds per horse, last ten winners, result, photo. */
  tote: ScreenSurface;
  /** Betting console: horse buttons `horse1..horse7`, bet buttons `win`, `place`, `show`, `exacta`, `quinella`. */
  panel: ButtonPanelPart;
  buttons: Record<string, PanelButton>;
  /** One lamp per lane at the finish end. */
  laneLamps: LampPart[];
  /** Dark grate under the track (the horror beat still scurries out of it). */
  drainGrate: THREE.Mesh;
  /** Eight rail meters (bet on the spot). */
  railMeters: LampPart[];
  /** Eight rail lamps (occupancy). */
  seatLamps: LampPart[];
  /** Floodlight bulb strip over the track. */
  bulbs: BulbChain;
};

export const RUNNERS = 7;
/** Silks per lane: red, yellow, orange, purple, blue, green, and the white of The Albino. */
export const SILKS = [0xc0392b, 0xd4ac0d, 0xe67e22, 0x8e44ad, 0x2e86c1, 0x27ae60, 0xe8e0c8] as const;
/** Coat colours (dark bay, chestnut, grey, black, palomino, roan, white) so two horses never look alike at a glance. */
const COATS = [0x5a3a22, 0x7b3a19, 0x8c949c, 0x1d1b22, 0xb08a4a, 0x6b4a42, 0xe6dec5] as const;
/** Track surface height (dirt top). Horses run on it. */
export const TRACK_Y = 0.91;
export const HORSE_Y = TRACK_Y + 0.012;
/** Horse progress 0 → 1 runs from the gate to the line. */
export const START_X = -1.72, FINISH_X = 1.78;
const GATE_X = START_X - 0.06, GATE_UP = 1.2, GATE_DOWN = TRACK_Y + 0.03;
/** Lane centre (z) for lane `i` (0-based): lanes of 0.2 m across the 1.2 m track. */
export const laneZ = (i: number): number => -0.5 + 0.2 * i;
/** Horse x for progress `p` in 0..1. */
export const horseX = (p: number): number => START_X + (FINISH_X - START_X) * p;
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
  kit.box(3.96, 0.012, 1.16, 0x7b5a35, at(0, 0.904, 0));                          // floodlit dirt, top at TRACK_Y
  kit.box(3.96, 0.004, 0.08, 0x9a7646, at(0, 0.911, 0.52));                       // raked near margin
  for (const x of [-1.0, -0.2, 0.6]) kit.box(0.012, 0.004, 1.16, 0x9a7646, at(x, 0.911, 0));   // furlong stripes
  for (const z of [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6]) kit.box(4.0, 0.03, 0.012, pal.white, at(0, 0.925, z));   // lane rails (white)
  for (const x of [-2.02, 2.02]) kit.box(0.04, 0.84, 1.24, wood, at(x, 0.42, 0));  // end panels
  kit.box(4.0, 0.02, 0.04, pal.black, at(0, 0.91, -0.62));                         // far kerb
  kit.box(4.0, 0.02, 0.04, pal.black, at(0, 0.91, 0.62));                          // near kerb
  kit.box(3.2, 0.6, 0.06, pal.redDark, at(0, 1.2, -0.8));                          // painted grandstand backdrop
  kit.box(3.2, 0.12, 0.42, pal.feltDark, at(0, 0.96, -0.6));                       // grandstand bench
  // the crowd: two staggered rows of dark heads and shoulders on the stand
  for (let c = 0; c < 22; c++) {
    const x = -1.5 + c * 0.14 + (c % 2) * 0.03;
    const row = c % 2;
    kit.box(0.07, 0.07, 0.04, c % 5 === 0 ? 0x3a3a42 : 0x191921, at(x, 1.07 + row * 0.1, -0.74 + row * 0.04));
    kit.sphere(0.028, c % 7 === 0 ? 0xb08a4a : 0x292131, { pos: [x, 1.14 + row * 0.1, -0.74 + row * 0.04], wSeg: 6, hSeg: 4, parent: root });
  }

  // glass top over the track
  const glass = kit.glass({ w: 4.0, h: 0.01, d: 1.2, tint: 0xbfe8d8, opacity: 0.18 });
  glass.position.set(0, 0.94, 0);
  root.add(glass);

  // floodlight masts at both ends: the track is lit like a night meeting
  for (const x of [-1.98, 1.98]) {
    kit.cyl(0.02, 0.025, 1.0, pal.steel, { pos: [x, 1.4, -0.7], seg: 6, parent: root });
    kit.box(0.34, 0.1, 0.06, pal.black, at(x, 1.95, -0.7));
  }

  // odds board: bezel, posts, split-flap screen above the far side
  kit.box(2.5, 0.9, 0.06, pal.black, at(0, 2.2, -0.66));
  for (const x of [-1.2, 1.2]) kit.box(0.05, 1.3, 0.05, pal.brass, at(x, 1.25, -0.66));
  const tote = kit.screen({ w: 2.4, h: 0.8, px: [192, 64], bezel: pal.black });
  tote.mesh.position.set(0, 2.2, -0.62);
  root.add(tote.mesh);

  // ── track: horses, gate and the finish ──
  const horses: THREE.Group[] = [], tails: THREE.Object3D[] = [], gallop: THREE.Object3D[][] = [];
  for (let i = 0; i < RUNNERS; i++) {
    const g = new THREE.Group();
    g.name = `horse${i + 1}`;
    g.position.set(horseX(0), HORSE_Y, laneZ(i));
    root.add(g);
    const coat = COATS[i], silk = SILKS[i];
    kit.box(0.11, 0.05, 0.045, coat, { parent: g, pos: [0, 0.07, 0] });                          // body
    kit.box(0.04, 0.065, 0.03, coat, { parent: g, pos: [0.062, 0.1, 0], rot: [0, 0, -28] });     // neck
    kit.box(0.05, 0.028, 0.026, coat, { parent: g, pos: [0.098, 0.118, 0], rot: [0, 0, -14] });  // head
    kit.box(0.04, 0.012, 0.052, silk, { parent: g, pos: [0.005, 0.098, 0] });                    // saddle cloth in the silks
    kit.box(0.026, 0.04, 0.03, pal.black, { parent: g, pos: [0.01, 0.12, 0] });                  // jockey, a dark shape
    kit.sphere(0.017, silk, { parent: g, pos: [0.02, 0.152, 0], wSeg: 6, hSeg: 4 });             // cap in the silks
    const legs: THREE.Object3D[] = [];
    for (const lx of [0.04, -0.04]) {
      const piv = new THREE.Object3D();
      piv.position.set(lx, 0.048, 0);
      g.add(piv);
      kit.box(0.012, 0.05, 0.034, 0x3a2418, { parent: piv, pos: [0, -0.025, 0] });
      legs.push(piv);
    }
    const tail = new THREE.Object3D();
    tail.position.set(-0.057, 0.08, 0);
    g.add(tail);
    kit.tube([[0, 0, 0], [-0.025, -0.008, 0], [-0.04, -0.03, 0], [-0.042, -0.05, 0]], 0.005, pal.black, { parent: tail, seg: 3, radialSeg: 3 });
    horses.push(g);
    tails.push(tail);
    gallop.push(legs);
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
  // photo-finish camera on a post at the line, near side: black body, lens, a white flash lamp above it
  kit.cyl(0.012, 0.012, 0.4, pal.chrome, { parent: finishLine, pos: [0.04, 0.2, 0.66], seg: 6 });
  kit.box(0.09, 0.07, 0.09, pal.black, { parent: finishLine, pos: [0.04, 0.44, 0.66] });
  kit.cyl(0.022, 0.022, 0.05, pal.steel, { parent: finishLine, pos: [-0.01, 0.44, 0.66], rot: [0, 0, 90], seg: 8 });
  const photoLamp = kit.lamp({ r: 0.02, color: 0xffffff, shape: 'bulb' });
  photoLamp.root.position.set(1.84, 1.4, 0.66);
  root.add(photoLamp.root);
  const finishCam = new THREE.Object3D();
  finishCam.position.set(1.8, 1.2, 0.9);
  root.add(finishCam);

  // pennants on the stand: they flap when the crowd swells
  const pennants: THREE.Object3D[] = [];
  for (let c = 0; c < 6; c++) {
    const pv = new THREE.Object3D();
    pv.position.set(-1.25 + c * 0.5, 1.5, -0.78);
    root.add(pv);
    kit.box(0.01, 0.2, 0.01, pal.chrome, { parent: pv, pos: [0, -0.1, 0] });
    kit.box(0.12, 0.07, 0.006, SILKS[c], { parent: pv, pos: [0.06, -0.02, 0] });
    pennants.push(pv);
  }

  const drainGrate = kit.box(0.8, 0.01, 0.5, pal.black, at(0, 0.2, 0));

  // lane lamps at the finish end, one per lane (7th = The Albino, lit only when present)
  const laneLamps: LampPart[] = [];
  for (let i = 0; i < RUNNERS; i++) {
    const l = kit.lamp({ r: 0.018, color: SILKS[i], shape: 'dome' });
    l.root.position.set(2.04, 0.95, laneZ(i));
    root.add(l.root);
    laneLamps.push(l);
  }

  // floodlight strip over the track: nine warm-white bulbs, chased during the race
  const bulbs = kit.bulbChain({ path: [[-1.7, 1.95, -0.2], [1.7, 1.95, -0.2]], count: 9, colors: [0xfff0c0], r: 0.026 });
  root.add(bulbs.root);

  // ── betting console along the near rail ──
  kit.box(2.2, 0.9, 0.5, wood, at(0, 0.45, 0.85));
  kit.box(2.2, 0.03, 0.03, pal.brass, at(0, 0.91, 1.1));
  const specs: PanelButtonSpec[] = [];
  for (let i = 0; i < RUNNERS; i++) {
    specs.push({ id: `horse${i + 1}`, label: String(i + 1), color: SILKS[i], x: -0.9 + i * 0.3, z: -0.07, w: 0.22, h: 0.16 });
  }
  // win / place / show are the three plain bets (gold); exacta and quinella are the two exotics (brass)
  specs.push(
    { id: 'win', label: { key: 'm.derby.win' }, color: pal.gold, x: -0.84, z: 0.09, w: 0.3, h: 0.14 },
    { id: 'place', label: { key: 'm.derby.place' }, color: pal.gold, x: -0.5, z: 0.09, w: 0.3, h: 0.14 },
    { id: 'show', label: { key: 'm.derby.show' }, color: pal.gold, x: -0.16, z: 0.09, w: 0.3, h: 0.14 },
    { id: 'exacta', label: { key: 'm.derby.exacta' }, color: pal.brass, x: 0.28, z: 0.09, w: 0.36, h: 0.14 },
    { id: 'quinella', label: { key: 'm.derby.quinella' }, color: pal.brass, x: 0.7, z: 0.09, w: 0.4, h: 0.14 },
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
      // seat view: one shared framing for every stand. The 3.5 m track, finish and lane lamps need a wide FOV from 2.6 m back.
      // (raised so the betting console top cannot hide the near lanes; a level-ish look keeps the track readable)
      pose: { pos: new THREE.Vector3(0, 1.80, 2.60), look: new THREE.Vector3(0, 1.39, 0), fov: 76, mouse: 'pick' },
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
  light.userData = { color: 0xfff0c0, intensity: 1.3, range: 5, flicker: 'BUZZ' };
  root.add(light);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.95, 0.75); root.add(coinOut);

  const parts: DerbyParts = {
    horses, tails, gallop, pennants, photoLamp, gate, gateBell, finishLine, finishCam, tote, panel, buttons: panel.buttons,
    laneLamps, drainGrate, railMeters, seatLamps, bulbs,
  };
  crispTexture(tote.tex, 4);                                   // on-machine text: linear + mips, not nearest
  kit.finalize(root, {
    keep: [...horses, ...pennants, photoLamp.root, gate, tote.mesh, panel.root, bulbs.root, ...laneLamps.map((l) => l.root), ...seatLamps.map((l) => l.root), ...railMeters.map((l) => l.root)],
  });

  const colliders: LocalAABB[] = [
    { min: [-2.02, 0, -0.66], max: [2.02, 0.95, 0.66] },     // track and cabinet
    { min: [-1.1, 0, 0.6], max: [1.1, 1.0, 1.1] },           // betting console
    { min: [-1.7, 0, -1.1], max: [1.7, 2.9, -0.5] },         // grandstand and board
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
