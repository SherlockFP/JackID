/**
 * The Elevator — procedural model (XL set, 4.60 W × 2.50 D × 3.70 H inside the MID-01 slot). Pattern: coinflip/model.ts.
 *  - `buildModel(kit, o)` returns the full `MachineModel`; the exported `ElevatorParts` is the contract with index.ts;
 *  - origin = floor centre, +Z = front (the riders' side); everything inside the slot box;
 *  - back: glass-fronted miniature shaft cabinet 1.60 × 1.00 × 3.70 centred at z −0.75. Concrete shell, painted log
 *    marks ×1…×250 on the back wall, a brass cage car on an 8-segment cable, six shaft bulbs, a marquee on top;
 *  - side pillars carry the instruments: left = floor dial (needle) + 5-digit nixie multiplier, right = flip clock,
 *    history board and the fairness lamp;
 *  - front: 8 rider stations on an arc (r 1.9 m about (0, −0.75)): brass post, strap, strap lamp, STEP-OFF lever,
 *    name plate. Riders stand at their station and look at the shaft.
 * Static geometry is merged by `kit.finalize`; everything that moves is listed in `keep`.
 */
import * as THREE from 'three';
import type { LampPart, LabelPart, LeverPart, LedPanelPart, ScreenSurface, MarqueePart, BulbChain } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { carYOf } from './rules';

export const W = 4.6, D = 2.5, H = 3.8;
export const CAR_Z = -0.75;
export const SHAFT_TOP = 3.66;          // cable anchor under the cabinet roof
const CONCRETE = 0x3a3631;
const PX_H = 350;
const MARKS = [1, 2, 5, 10, 25, 50, 100, 250];
const PILLAR_X = 1.05;
const STATIONS = 8;

export interface Station {
  pos: THREE.Vector3;
  strapLamp: LampPart;
  lever: LeverPart;
  namePlate: LabelPart;
}

export type ElevatorParts = {
  /** The brass cage car. Its origin is the car centre; y follows the log scale (`carYOf`). */
  car: THREE.Group;
  /** Light hint inside the car (flickers with m). */
  carLight: THREE.Object3D;
  /** 8 cable segments from the cabinet roof to the car top. Re-laid out by `layoutCable`. */
  cable: THREE.Mesh[];
  /** Three frayed strands; toggled at ×2 / ×4 / ×8. */
  frays: THREE.Mesh[];
  shaftBulbs: BulbChain;
  /** Floor dial needle (pivot at the dial centre, rotation.z). */
  needle: THREE.Object3D;
  leds: { mult: LedPanelPart; clock: LedPanelPart };
  /** 160 × 32 history board (last crashes). */
  history: ScreenSurface;
  fairLamp: LampPart;
  /** White light card above the shaft, shown on ROOF. */
  roofFlood: THREE.Mesh;
  marquee: MarqueePart;
  stations: Station[];
};

/** Lay the 8 cable segments between the roof anchor and `carTop` (machine-local y). */
export function layoutCable(cable: THREE.Mesh[], carTop: number): void {
  const span = Math.max(0.05, SHAFT_TOP - carTop);
  const seg = span / cable.length;
  cable.forEach((m, i) => {
    const top = SHAFT_TOP - i * seg;
    m.scale.set(1, seg, 1);
    m.position.y = top - seg / 2;
  });
}

/** Rider station i: angle −60° … +60° on an arc of radius 1.9 m about the shaft. */
export function stationPos(i: number): THREE.Vector3 {
  const th = (-60 + (i * 120) / (STATIONS - 1)) * (Math.PI / 180);
  return new THREE.Vector3(1.9 * Math.sin(th), 0, CAR_Z + 1.9 * Math.cos(th));
}

export function buildModel(kit: KitX, _o: ModelOpts): MachineModel<ElevatorParts> {
  const { pal } = kit;
  const root = kit.group('elevator');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours; merged into few draws) ──
  const cabX = 0.8, cabZ0 = -1.25, cabZ1 = -0.25;
  kit.box(1.6, 3.7, 0.04, CONCRETE, at(0, 1.85, cabZ0 + 0.02));                  // back wall
  kit.box(0.04, 3.7, 1.0, CONCRETE, at(-cabX, 1.85, CAR_Z));                     // side walls
  kit.box(0.04, 3.7, 1.0, CONCRETE, at(cabX, 1.85, CAR_Z));
  kit.box(1.6, 0.04, 1.0, pal.steel, at(0, 3.7, CAR_Z));                         // roof
  kit.box(1.6, 0.08, 1.0, pal.steel, at(0, 0.04, CAR_Z));                        // sump floor
  kit.box(1.6, 0.12, 0.04, pal.rust, at(0, 3.56, cabZ1));                        // front lintel
  kit.box(1.6, 0.06, 0.04, pal.rust, at(0, 0.07, cabZ1));                        // front sill
  kit.box(0.5, 2.6, 0.6, pal.steel, at(-PILLAR_X, 1.3, CAR_Z));                  // instrument pillars
  kit.box(0.5, 2.6, 0.6, pal.steel, at(PILLAR_X, 1.3, CAR_Z));
  kit.box(0.5, 0.06, 0.6, pal.black, at(-PILLAR_X, 2.6, CAR_Z));
  kit.box(0.5, 0.06, 0.6, pal.black, at(PILLAR_X, 2.6, CAR_Z));
  kit.box(W - 0.2, 0.05, 1.5, pal.felt, at(0, 0.09, 0.5));                       // landing mat (front strip)

  // ── back wall: log-scale marks (painted once, language-neutral) ──
  const history = kit.screen({ w: 0.42, h: 0.1, px: [160, 32], bezel: pal.black });
  history.mesh.position.set(PILLAR_X, 2.1, CAR_Z + 0.31);
  root.add(history.mesh);
  const marks = kit.screen({ w: 0.9, h: 3.5, px: [90, PX_H], bezel: pal.black });
  marks.mesh.position.set(0, 1.85, cabZ0 + 0.045);
  root.add(marks.mesh);
  marks.clear('#120c0a');
  for (const m of MARKS) {
    const py = ((3.6 - carYOf(m)) / 3.5) * PX_H;
    marks.text(`x${m}`, 6, py + 4, { font: 'px5', color: '#ffd9a0' });
    marks.text('-', 74, py + 4, { font: 'px5', color: '#7a5a3a' });
  }

  // ── car, cable, frays ──
  const car = new THREE.Group();
  car.position.set(0, carYOf(1), CAR_Z);
  root.add(car);
  kit.box(0.30, 0.40, 0.30, pal.rust, { pos: [0, 0, 0], parent: car });          // cage (rusted)
  kit.box(0.32, 0.03, 0.32, pal.brass, { pos: [0, 0.2, 0], parent: car });       // brass roof rail
  kit.box(0.30, 0.03, 0.30, pal.brass, { pos: [0, -0.2, 0], parent: car });      // brass floor
  kit.box(0.10, 0.22, 0.08, pal.bone, { pos: [0, -0.07, 0.02], parent: car });   // passenger (silhouette)
  const carLight = new THREE.Object3D();
  carLight.position.set(0, 0.1, 0.12);
  carLight.userData = { color: 0xffe0a0, intensity: 0.4, range: 1.0, flicker: 'STEADY' };
  car.add(carLight);

  const cable: THREE.Mesh[] = [];
  for (let i = 0; i < STATIONS; i++) cable.push(kit.cyl(0.012, 0.012, 1, pal.steel, { parent: root, pos: [0, 1, CAR_Z] }));
  layoutCable(cable, carYOf(1) + 0.2);
  const frays: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const f = kit.cyl(0.006, 0.006, 0.22, pal.brass, { parent: root, pos: [0.02 * (i - 1), carYOf(1) + 0.3, CAR_Z], rot: [0, 0, 14 * (i - 1)] });
    f.visible = false;
    frays.push(f);
  }

  const shaftBulbs = kit.bulbChain({ path: { rect: [1.5, 3.4] }, count: 6, colors: [pal.gold], r: 0.022 });
  shaftBulbs.root.position.set(0, 1.84, cabZ1 - 0.03);
  root.add(shaftBulbs.root);

  const light2 = new THREE.Object3D();
  light2.position.set(0, 3.5, CAR_Z);
  light2.userData = { color: 0xffb040, intensity: 0.6, range: 3, flicker: 'STEADY' };
  root.add(light2);

  // ── glass front ──
  const glass = kit.glass({ w: 1.6, h: 3.5, d: 0.02, tint: pal.glass, opacity: 0.12 });
  glass.position.set(0, 1.83, cabZ1 - 0.01);
  root.add(glass);

  // ── marquee on top of the front ──
  const marquee = kit.marquee({ w: 1.6, h: 0.2, text: { key: 'm.elevator.marquee' }, color: pal.neonYellow, bg: pal.black, bulbs: 14 });
  marquee.root.position.set(0, 3.65, cabZ1 + 0.02);
  root.add(marquee.root);

  // ── left pillar: floor dial + nixie multiplier ──
  const dialC = new THREE.Object3D();
  dialC.position.set(-PILLAR_X, 1.95, CAR_Z + 0.31);
  root.add(dialC);
  kit.cyl(0.2, 0.2, 0.02, pal.brass, { pos: [0, 0, 0], rot: [90, 0, 0], seg: 16, parent: dialC });
  const needle = new THREE.Object3D();
  needle.position.copy(dialC.position);
  kit.box(0.014, 0.17, 0.01, pal.red, { pos: [0, 0.085, 0.012], parent: needle });
  root.add(needle);
  const mult = kit.ledPanel({ digits: 5, color: '#FF7A20', h: 0.1 });
  mult.root.position.set(-PILLAR_X, 1.2, CAR_Z + 0.31);
  root.add(mult.root);

  // ── right pillar: flip clock, fairness lamp ──
  const clock = kit.ledPanel({ digits: 4, color: '#E8E0C8', h: 0.1 });
  clock.root.position.set(PILLAR_X, 1.45, CAR_Z + 0.31);
  root.add(clock.root);
  const fairLamp = kit.lamp({ r: 0.03, color: pal.green, shape: 'dome' });
  fairLamp.root.position.set(PILLAR_X, 0.9, CAR_Z + 0.31);
  root.add(fairLamp.root);

  // ── roof flood (ROOF) ──
  const roofFlood = kit.plane(1.2, 0.8, 0xffffff, { pos: [0, 3.78, CAR_Z], rot: [-90, 0, 0] });
  roofFlood.visible = false;
  root.add(roofFlood);

  // ── rider stations ──
  const stations: Station[] = [];
  const seats: SeatDef[] = [];
  for (let i = 0; i < STATIONS; i++) {
    const p = stationPos(i);
    kit.cyl(0.03, 0.03, 1.9, pal.brass, { pos: [p.x, 0.95, p.z], parent: root });
    kit.box(0.10, 0.05, 0.04, pal.leather, { pos: [p.x, 1.85, p.z], parent: root });
    const strapLamp = kit.lamp({ r: 0.025, color: pal.gold, shape: 'dome' });
    strapLamp.root.position.set(p.x, 1.78, p.z + 0.03);
    root.add(strapLamp.root);
    const lever = kit.lever({ length: 0.25, knob: pal.brass });
    lever.root.position.set(p.x, 1.05, p.z + 0.05);
    root.add(lever.root);
    const namePlate = kit.label({ text: '-', w: 0.16, h: 0.03, px: [128, 16], color: pal.neonYellow, bg: pal.black });
    namePlate.mesh.position.set(p.x, 1.45, p.z + 0.03);
    root.add(namePlate.mesh);
    stations.push({ pos: p, strapLamp, lever, namePlate });
    seats.push({
      pose: {
        pos: new THREE.Vector3(p.x * 0.95, 1.6, p.z + 0.5),
        look: new THREE.Vector3(p.x * 0.4, 1.5, CAR_Z),
        fov: 60,
        mouse: 'primary',
      },
      stand: new THREE.Vector3(p.x, 0, p.z + 0.45),
      avatar: 'stand',
    });
  }

  // ── speaker, light hints and anchors ──
  const speaker = new THREE.Object3D();
  speaker.position.set(0, 1.2, CAR_Z + 0.3);
  root.add(speaker);
  const cabLight = new THREE.Object3D();
  cabLight.position.set(0, 1.85, CAR_Z + 0.3);
  cabLight.userData = { color: 0xffe2a0, intensity: 0.5, range: 2.4, flicker: 'STEADY' };
  root.add(cabLight);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(PILLAR_X, 0.5, CAR_Z + 0.31);
  root.add(servicePlate);
  const cableSpark = new THREE.Object3D();
  cableSpark.position.set(0, SHAFT_TOP, CAR_Z);
  root.add(cableSpark);
  const dustPuff = new THREE.Object3D();
  dustPuff.position.set(0, 0.2, CAR_Z);
  root.add(dustPuff);

  const parts: ElevatorParts = {
    car, carLight, cable, frays, shaftBulbs, needle, leds: { mult, clock }, history, fairLamp, roofFlood, marquee, stations,
  };
  kit.finalize(root, {
    keep: [
      car, carLight, ...cable, ...frays, shaftBulbs.root, needle, mult.root, clock.root, history.mesh, fairLamp.root,
      roofFlood, marquee.root, ...stations.flatMap((s) => [s.strapLamp.root, s.lever.root, s.namePlate.mesh]), light2,
      cabLight, glass,
    ],
  });

  return {
    root,
    parts,
    playPose: seats[0].pose,
    seats,
    // cabinet body and both pillars; the stand strip in front stays collider-free
    colliders: [
      { min: [-cabX, 0, cabZ0], max: [cabX, 3.7, cabZ1] },
      { min: [-PILLAR_X - 0.25, 0, CAR_Z - 0.3], max: [-PILLAR_X + 0.25, 2.6, CAR_Z + 0.3] },
      { min: [PILLAR_X - 0.25, 0, CAR_Z - 0.3], max: [PILLAR_X + 0.25, 2.6, CAR_Z + 0.3] },
    ],
    interact: { min: [-2.3, 0.2, -1.3], max: [2.3, 2.2, 1.3] },
    anchors: {
      speaker, prompt: marquee.root, label: marquee.root, marqueeTop: marquee.root, servicePlate, cableSpark, dustPuff,
      light: carLight, light2, coinOut: cabLight,
    },
    dispose: () => { history.dispose(); marks.dispose(); },
  };
}
