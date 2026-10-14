/**
 * Big Six Money Wheel "The Six-Score Wheel" — procedural model (MACHINES_tables §9, plan modelBrief, ART §5.11).
 * `buildModel` returns a full `MachineModel`; the exported `BigSixParts` type is the contract with `index.ts`.
 * Metres, origin = floor centre of the 2.60 × 1.80 footprint, +Z = player side, the wheel hangs on the north (−Z) wall.
 *
 * Wheel Ø 1.80 m, hub at machine-local (0, 2.15, −0.80), 54 segments clockwise from the top (index 0 = EYE).
 * Counter 2.40 × 0.60 × 0.95 in front with six lit symbol spots. Eight standing spots along the counter.
 */
import * as THREE from 'three';
import type { BulbChain, ChipPool, Kit, LampPart, LeverPart, ScreenSurface, WheelPart } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import type { SeatDef, LocalAABB } from '@/core/types';
import { SEGMENTS, BET_SYMS, type Sym } from './rules';

export type BigSixParts = {
  /** Kit wheel (vertical). `wheel.disc` spins; `wheel.angleOf(i)` lands segment i under the pointer. */
  wheel: WheelPart;
  /** Pivot of the eyelid: slides up to open (EYE), down to close. */
  eyeLid: THREE.Object3D;
  /** Pupil on the eye; `position.x` tracks the winner's seat. */
  pupil: THREE.Object3D;
  /** Two brass hub halves; they slide apart on HOUSE. */
  hubHalves: [THREE.Object3D, THREE.Object3D];
  /** Leather flapper at 12 o'clock; `rotation.z` deflects per peg. */
  flapper: THREE.Object3D;
  /** Leather flapper at 6 o'clock, hidden until milestone L100. */
  flapper2: THREE.Object3D;
  /** ×2 lamp (milestone L10). */
  multiplierPeg: LampPart;
  /** 54 marquee bulbs around the rim (index = segment). */
  rim: BulbChain;
  /** Pull handle on the frame (Space / click pulls it). */
  handle: LeverPart;
  /** Six lit symbol spots, in `BET_SYMS` order. */
  spots: LampPart[];
  /** Last-12 result strip (96 × 16). */
  last12: ScreenSurface;
  /** Chip pool for every seat's layout (public felt chips). */
  chips: ChipPool;
  /** One lamp per seat on the counter edge. */
  seatLamps: LampPart[];
  /** Phase lamp (betting open / locked). */
  phaseLamp: LampPart;
  /** The counter top (pointer hit-test for chips). */
  layout: THREE.Mesh;
};

export const WHEEL_R = 0.9;
export const HUB = { x: 0, y: 2.15, z: -0.80 } as const;
export const TOP = 0.95;                    // counter top height
export const SPOT_X = [-0.90, -0.54, -0.18, 0.18, 0.54, 0.90] as const;   // six symbol spots, left→right from the player
export const SEAT_X = [-0.945, -0.675, -0.405, -0.135, 0.135, 0.405, 0.675, 0.945] as const;
const SPOT_Z = 0.42;
export const SEGMENT_HEX: Record<Sym, number> = {
  '1': 0xe8e0c8, '3': 0x2c4c9c, '6': 0x2e7d3b, '12': 0xa8262e, '25': 0x5b2a86, EYE: 0xd4af37, HOUSE: 0x111111,
};
const SPOT_HEX = [0xe8e0c8, 0x2c4c9c, 0x2e7d3b, 0xa8262e, 0x5b2a86, 0xd4af37];
const RIM_HEX = 0xffd36a;

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<BigSixParts> {
  const { pal } = kit;
  const root = kit.group('bigsix');
  const walnut = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged) ──────────────────────────────────────────────────────
  kit.box(2.60, 3.10, 0.10, walnut, at(0, 1.55, -0.90));                  // north wall frame
  kit.box(0.10, 3.10, 0.90, walnut, at(-1.25, 1.55, -0.45));               // frame pillars
  kit.box(0.10, 3.10, 0.90, walnut, at(1.25, 1.55, -0.45));
  kit.box(2.60, 0.10, 0.90, walnut, at(0, 3.10, -0.45));                  // top cornice
  kit.box(2.40, 0.95, 0.60, walnut, at(0, TOP / 2, 0.30));                // betting counter body
  kit.box(2.44, 0.05, 0.64, pal.black, at(0, TOP - 0.025, 0.30));         // brass-edged counter lip
  kit.box(2.36, 0.02, 0.56, pal.felt, at(0, TOP + 0.01, 0.30));           // green felt inlay (under the layout)

  // ── wheel (animated) ──────────────────────────────────────────────────────────────────────────
  const wheel = kit.wheel({
    radius: WHEEL_R,
    segments: SEGMENTS.map((sym) => ({
      label: sym === 'EYE' ? { key: 'm.bigsix.symEye' } : sym === 'HOUSE' ? { key: 'm.bigsix.symHouse' } : sym,
      color: SEGMENT_HEX[sym],
    })),
    axis: 'vertical',
    pegs: true,
    hub: 0xd4af37,
  });
  wheel.root.position.set(HUB.x, HUB.y, HUB.z);
  root.add(wheel.root);

  // eye on the hub: lid and pupil (static eye, the disc spins behind it)
  const eyeBall = kit.sphere(0.11, pal.cream, { pos: [HUB.x, HUB.y, HUB.z + 0.06], wSeg: 10, hSeg: 6, parent: root, scale: [1, 1, 0.5] });
  eyeBall.name = 'eye';
  const pupil = kit.sphere(0.045, pal.black, { pos: [0, 0, 0], wSeg: 8, hSeg: 6, parent: root });
  pupil.position.set(HUB.x, HUB.y, HUB.z + 0.10);
  const eyeLid = new THREE.Object3D();
  eyeLid.position.set(HUB.x, HUB.y, HUB.z + 0.12);
  root.add(eyeLid);
  kit.box(0.30, 0.30, 0.03, walnut, { pos: [0, 0, 0], parent: eyeLid });
  const hubHalves: [THREE.Object3D, THREE.Object3D] = [
    kit.box(0.10, 0.22, 0.02, pal.brass, { pos: [HUB.x - 0.05, HUB.y, HUB.z + 0.14], parent: root }),
    kit.box(0.10, 0.22, 0.02, pal.brass, { pos: [HUB.x + 0.05, HUB.y, HUB.z + 0.14], parent: root }),
  ];

  // rim bulbs: 54 around the marquee ring, index = segment
  const rimPts: [number, number, number][] = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const a = (i / SEGMENTS.length) * Math.PI * 2;
    rimPts.push([HUB.x + Math.sin(a) * (WHEEL_R + 0.04), HUB.y + Math.cos(a) * (WHEEL_R + 0.04), HUB.z + 0.02]);
  }
  const rim = kit.bulbChain({ path: rimPts, count: SEGMENTS.length, colors: [RIM_HEX], r: 0.009 });
  root.add(rim.root);

  // flappers: 12 o'clock (live) and 6 o'clock (milestone L100)
  const flapper = new THREE.Object3D();
  flapper.position.set(HUB.x, HUB.y + WHEEL_R + 0.06, HUB.z + 0.08);
  root.add(flapper);
  kit.box(0.10, 0.10, 0.03, pal.leather, { pos: [0, -0.05, 0], parent: flapper });
  const flapper2 = new THREE.Object3D();
  flapper2.position.set(HUB.x, HUB.y - WHEEL_R - 0.06, HUB.z + 0.08);
  flapper2.rotation.z = Math.PI;
  flapper2.visible = false;
  root.add(flapper2);
  kit.box(0.10, 0.10, 0.03, pal.leather, { pos: [0, -0.05, 0], parent: flapper2 });

  const multiplierPeg = kit.lamp({ r: 0.022, color: RIM_HEX, shape: 'dome' });
  multiplierPeg.root.position.set(HUB.x + 0.30, HUB.y + WHEEL_R + 0.10, HUB.z + 0.06);
  root.add(multiplierPeg.root);

  // counter: six lit symbol spots with engraved plates
  const layout = kit.plane(2.36, 0.56, pal.felt, { pos: [0, TOP + 0.02, 0.30], rot: [-90, 0, 0], shade: false, name: 'layout' });
  root.add(layout);
  const spots: LampPart[] = [];
  BET_SYMS.forEach((sym, i) => {
    const x = SPOT_X[i];
    const lamp = kit.lamp({ r: 0.026, color: SPOT_HEX[i], shape: 'dome' });
    lamp.root.position.set(x, TOP + 0.02, SPOT_Z + 0.10);
    root.add(lamp.root);
    spots.push(lamp);
    const plate = kit.label({
      text: sym === 'EYE' ? { key: 'm.bigsix.symEye' } : sym,
      w: 0.20, h: 0.09, px: [96, 40], color: pal.gold, bg: pal.black,
    });
    plate.mesh.position.set(x, TOP + 0.022, SPOT_Z - 0.10);
    plate.mesh.rotation.x = -Math.PI / 2;
    root.add(plate.mesh);
  });

  // last-12 strip on the counter front
  const last12 = kit.screen({ w: 0.96, h: 0.16, px: [96, 16], bezel: pal.black });
  last12.mesh.position.set(0, 0.74, 0.61);
  root.add(last12.mesh);

  // seats: lamp on the counter edge, pull-stand and seat pose per standing spot
  const seatLamps: LampPart[] = [];
  const seats: SeatDef[] = [];
  SEAT_X.forEach((sx) => {
    const l = kit.lamp({ r: 0.018, color: pal.gold, shape: 'dome' });
    l.root.position.set(sx, TOP + 0.01, 0.62);
    root.add(l.root);
    seatLamps.push(l);
    seats.push({
      // seat view: backed off to 2.3 m with a wide FOV so the wheel (to 3.11, under the top band) and the counter spots fit
      pose: { pos: new THREE.Vector3(sx * 0.5, 1.75, 2.30), look: new THREE.Vector3(0, 1.53, -0.80), fov: 76, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, 1.10),
      avatar: 'stand',
    });
  });

  const phaseLamp = kit.lamp({ r: 0.022, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(-0.98, TOP + 0.02, 0.05);
  root.add(phaseLamp.root);

  // pull handle on the frame's right (player's right = −X)
  const handle = kit.lever({ length: 0.45, knob: 0xa8262e, side: 'right' });
  handle.root.position.set(-1.25, 1.70, 0.05);
  root.add(handle.root);

  // chips (instanced, public felt chips)
  const chips = kit.chips({ max: 300 });
  root.add(chips.root);

  // anchors
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.0, 0.62); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 0.9); root.add(prompt);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 3.2, -0.85); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.36, 0.9, 0.3); root.add(servicePlate);
  const flapperCam = new THREE.Object3D(); flapperCam.position.set(0, 2.6, -0.2); root.add(flapperCam);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, 0.45); root.add(coinOut);
  const dealer = new THREE.Object3D(); dealer.position.set(-1.45, 0, -0.35); root.add(dealer);
  const light = new THREE.Object3D(); light.position.set(0, 2.4, 0.6);
  light.userData = { color: RIM_HEX, intensity: 1.5, range: 5 };
  root.add(light);

  const parts: BigSixParts = {
    wheel, eyeLid, pupil, hubHalves, flapper, flapper2, multiplierPeg, rim, handle, spots, last12, chips, seatLamps, phaseLamp, layout,
  };
  crispTexture(last12.tex, 4);                                 // on-machine text: linear + mips, not nearest
  kit.finalize(root, {
    keep: [wheel.root, eyeLid, pupil, hubHalves[0], hubHalves[1], flapper, flapper2, multiplierPeg, rim.root, handle.root,
      ...spots, last12.mesh, chips.root, ...seatLamps, phaseLamp, light, layout],
  });

  const colliders: LocalAABB[] = [
    { min: [-1.30, 0, -0.90], max: [1.30, 3.12, -0.80] },   // wheel frame
    { min: [-1.20, 0, 0.00], max: [1.20, 0.95, 0.60] },     // counter
  ];
  return {
    root, parts, seats, playPose: seats[3].pose, colliders,
    interact: { min: [-1.30, 0.2, -0.95], max: [1.30, 3.20, 0.95] },
    anchors: {
      speaker, prompt, label: prompt, marqueeTop, servicePlate, flapperCam, light, coinOut, dealer,
    },
  };
}
