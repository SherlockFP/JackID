/**
 * Fan-Tan "Button Count" (`fantan`) — procedural model (MACHINES_tables §22, plan modelBrief). `buildModel` returns a
 * full `MachineModel`; the exported `FantanParts` type is the contract with `index.ts`.
 * Metres, origin = floor centre of the 2.40 × 1.80 footprint, +Z = player side.
 *
 * Low black-lacquer table 1.40 × 1.40 at felt height 0.71, centred at z = TC. A painted 0.60 square in the centre
 * (ScreenSurface, sides numbered 1–4: 1 front (+Z), 2 right (+X), 3 back (−Z), 4 left (−X)). Old Lacquer, the
 * porcelain-masked croupier, stands behind the table at −Z. The six seat stands sit in the strip in front (z ≥ 0.9).
 */
import * as THREE from 'three';
import type { ChipPool, DealerPart, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { LocalAABB, SeatDef } from '@/core/types';

export type FantanParts = {
  /** The painted square. Lies flat; canvas top = back (side 3), canvas right = +X. */
  square: ScreenSurface;
  /** Edge lamps on the square, index = side − 1; lit on the winning side at REVEAL. */
  sideLamps: LampPart[];
  /** Brass buttons, one instance per button in the heap (index 0 is the bottom of the heap, removed last). */
  buttons: THREE.InstancedMesh;
  /** Brass inverted bowl (a Group): lowered over the heap, lifts 0.25 m at LIFT. */
  bowl: THREE.Object3D;
  /** Bone wand (in the croupier's right hand): taps once per counted group. */
  wand: THREE.Object3D;
  /** Gong disc on its stand, struck at REVEAL. */
  gong: THREE.Object3D;
  /** Last-12 result strip (96 × 16). */
  history: ScreenSurface;
  /** Lit while a Golden Button is in the heap this round (milestone L50). */
  goldLamp: LampPart;
  /** Paper-lantern bulb over the table. */
  lantern: LampPart;
  /** Phase lamp (betting open / locked). */
  phaseLamp: LampPart;
  /** One lamp per seat on the table rim. */
  seatLamps: LampPart[];
  /** Public felt chips for every seat's layout. */
  chips: ChipPool;
  /** Old Lacquer, the croupier. */
  dealer: DealerPart;
};

export const TC = 0.12;                   // table centre z (machine-local)
export const TOP = 0.71;                  // felt height
export const SQ = 0.30;                   // half side of the painted square
export const BUTTON_CAP = 120;            // N ≤ 120, so the heap never needs more instances
export const SIDE_HEX = [0xe8e0c8, 0xa8262e, 0x2c4c9c, 0x2e7d3b] as const;
/** Side centres on the square, index = side − 1 (x, z in machine-local metres). */
export const SIDE_XZ: ReadonlyArray<readonly [number, number]> = [[0, TC + 0.20], [0.20, TC], [0, TC - 0.20], [-0.20, TC]];
/** Seat stands: 3 front, 2 sides, 1 front corner. Stand strip z ∈ [0.9, 1.9] is free of colliders. */
export const SEAT_POS: ReadonlyArray<readonly [number, number]> = [
  [-0.45, 1.10], [0, 1.10], [0.45, 1.10], [-1.00, TC], [1.00, TC], [-0.95, 1.10],
];

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<FantanParts> {
  const { pal } = kit;
  const root = kit.group('fantan');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const lacquer = o.variant % 2 ? pal.black : pal.woodDark;

  // ── static shell ───────────────────────────────────────────────────────────────────────────
  kit.box(1.40, 0.66, 1.40, lacquer, at(0, 0.33, TC));                              // lacquer body
  kit.box(1.44, 0.04, 1.44, lacquer, at(0, TOP - 0.02, TC));                        // lacquer top
  kit.box(1.20, 0.004, 1.20, pal.felt, at(0, TOP + 0.001, TC));                     // green felt inlay
  // no floor cushions: the stand strip must stay clear of model geometry (seat pads are a T2 visual)

  // ── the painted square (canvas 128 × 128) ─────────────────────────────────────────────────
  const square = kit.screen({ w: SQ * 2, h: SQ * 2, px: [128, 128], bezel: pal.black });
  square.mesh.rotation.x = -Math.PI / 2;
  square.mesh.position.set(0, TOP + 0.012, TC);
  root.add(square.mesh);

  const sideLamps: LampPart[] = [];
  SIDE_XZ.forEach(([x, z], i) => {
    const lamp = kit.lamp({ r: 0.016, color: SIDE_HEX[i], shape: 'dome' });
    lamp.root.position.set(x * 1.65, TOP + 0.01, TC + (z - TC) * 1.65);   // just outside the painted edge
    root.add(lamp.root);
    sideLamps.push(lamp);
  });

  // ── heap of buttons (instanced; count = 0 until LIFT) ─────────────────────────────────────
  const btnGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.005, 6);
  const buttons = new THREE.InstancedMesh(btnGeo, kit.mat(pal.brass), BUTTON_CAP);
  buttons.count = 0;
  buttons.frustumCulled = false;
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < BUTTON_CAP; i++) buttons.setColorAt(i, white);
  root.add(buttons);

  // ── bowl (lathe, brass, inverted) ─────────────────────────────────────────────────────────
  const bowlMesh = kit.lathe(
    [[0.16, 0.0], [0.155, 0.03], [0.13, 0.085], [0.08, 0.12], [0.0, 0.135]], 10, pal.brass, {},
  );
  const bowl = kit.group('bowl', bowlMesh);
  bowl.position.set(0, TOP + 0.005, TC);
  root.add(bowl);

  // ── croupier, Old Lacquer: porcelain mask, bone wand in the right hand ────────────────────
  const dealer = kit.dealer({ style: 'porcelain', height: 1.0 });
  dealer.root.position.set(0, 0, -0.72);
  root.add(dealer.root);
  const wandShaft = kit.cyl(0.006, 0.006, 0.34, pal.bone, { pos: [0, 0.17, 0] });
  const wand = kit.group('wand', wandShaft);
  dealer.handR.add(wand);

  // ── gong on a steel stand, right rear corner ──────────────────────────────────────────────
  const gongDisc = kit.cyl(0.14, 0.14, 0.02, pal.brass, { pos: [0.95, 1.25, -0.55], rot: [90, 0, 0] });
  kit.box(0.02, 1.25, 0.02, pal.steel, at(0.95, 0.62, -0.55));
  const gong = kit.group('gong', gongDisc);
  root.add(gong);

  // ── last-12 strip on the table skirt, facing the players ──────────────────────────────────
  const history = kit.screen({ w: 0.96, h: 0.16, px: [96, 16], bezel: pal.black });
  history.mesh.position.set(0, 0.52, TC + 0.72);
  root.add(history.mesh);

  // ── lamps ─────────────────────────────────────────────────────────────────────────────────
  const goldLamp = kit.lamp({ r: 0.018, color: pal.gold, shape: 'dome' });
  goldLamp.root.position.set(-0.98, TOP + 0.02, -0.30);
  root.add(goldLamp.root);

  const phaseLamp = kit.lamp({ r: 0.022, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(-0.98, TOP + 0.02, 0.15);
  root.add(phaseLamp.root);

  const lantern = kit.lamp({ r: 0.06, color: 0xffc070, shape: 'bulb' });
  lantern.root.position.set(0, 2.00, TC);
  root.add(lantern.root);
  root.add(kit.cyl(0.003, 0.003, 0.25, pal.steel, { pos: [0, 2.15, TC] }));

  const seatLamps: LampPart[] = [];
  const seats: SeatDef[] = [];
  SEAT_POS.forEach(([sx, sz]) => {
    // lamp on the table rim, on the ray from the table centre toward the seat
    const dx = sx, dz = sz - TC;
    const len = Math.hypot(dx, dz) || 1;
    const l = kit.lamp({ r: 0.016, color: pal.gold, shape: 'dome' });
    l.root.position.set((dx / len) * 0.70, TOP + 0.01, TC + (dz / len) * 0.70);
    root.add(l.root);
    seatLamps.push(l);
    seats.push({
      pose: { pos: new THREE.Vector3(sx, 1.05, sz), look: new THREE.Vector3(0, TOP, TC), fov: 60, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, sz),
      avatar: 'stand',
    });
  });

  // chips (instanced, public felt chips)
  const chips = kit.chips({ max: 300 });
  root.add(chips.root);

  // ── anchors ───────────────────────────────────────────────────────────────────────────────
  const speaker = new THREE.Object3D(); speaker.position.set(0, 0.6, TC + 0.76); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 1.0); root.add(prompt);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.3, -0.80); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.12, 0.9, 0.5); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, TC + 0.5); root.add(coinOut);
  const light = new THREE.Object3D(); light.position.set(0, 2.00, TC);
  light.userData = { color: 0xffc070, intensity: 1.4, range: 5 };
  root.add(light);

  const parts: FantanParts = {
    square, sideLamps, buttons, bowl, wand, gong, history, goldLamp, lantern, phaseLamp, seatLamps, chips, dealer,
  };
  kit.finalize(root, {
    keep: [
      square.mesh, ...sideLamps.map((l) => l.root), buttons, bowl, dealer.root, gong, history.mesh, goldLamp.root,
      lantern.root, phaseLamp.root, ...seatLamps.map((l) => l.root), chips.root,
    ],
  });

  const colliders: LocalAABB[] = [
    { min: [-0.72, 0, TC - 0.72], max: [0.72, TOP, TC + 0.72] },   // table
    { min: [-0.25, 0, -0.90], max: [0.25, 1.20, TC - 0.72] },        // croupier
  ];
  return {
    root, parts, seats, playPose: seats[2].pose, colliders,
    interact: { min: [-1.20, 0.2, -0.90], max: [1.20, 1.60, 0.90] },
    anchors: { speaker, prompt, label: prompt, marqueeTop, servicePlate, light, coinOut, dealer: dealer.root, lantern: lantern.root },
  };
}
