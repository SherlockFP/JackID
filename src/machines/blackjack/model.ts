/**
 * Blackjack "Twenty-One" — procedural model (MACHINES_tables §3, ART_BIBLE §5.6, PLAN modelBrief).
 *
 * A coffin-shaped half-moon felt (2.10 × 1.05 m, top at 0.78 m) with five betting spots on an arc around the dealer
 * side centre (0, CZ = −0.45). The dealer is "the Undertaker's Hands": two jointed porcelain hands on brass rods rising
 * from a dark pedestal behind the table, no body. A card shoe at dealer-left, a glass discard tray at dealer-right
 * (the discard stack grows with the cards used), a scoreboard above the dealer and a standing pit boss (kit.mannequin).
 * Each spot has a 5-button brass panel (HIT / STAND / DBL / SPLIT / SURR), a main ring and a Twin Souls ring.
 *
 * Metres, origin = floor centre of the footprint, +Z = the player side. Footprint L (2.6 × 1.8 m): stools and
 * players stay inside, the stand strip z ∈ [0.9, 1.9] is free.
 *
 * Draw budget (static geometry merges through kit.finalize): animated parts are listed in `keep`. Each spot's button
 * panel is one dynamic mesh, the cards / chips are pools, the scoreboard is one canvas. Cut on purpose for v1: shoe
 * gauge, rail meters and the second light per spot (recorded in the review notes).
 */
import * as THREE from 'three';
import type { BulbChain, ButtonPanelPart, CardPool, ChipPool, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.78;                 // felt height, m
export const CZ = -0.45;                 // centre of the half-moon (the flat edge runs along z = CZ)
export const FELT_R = 1.02;
export const SPOTS = 5;
export const SPOT_ANGLE = Math.PI / 6;   // 30° between spots: −60 … +60
export const DEALER_Z = -0.74;           // hands' wrist line, behind the flat edge
export const SHOE_POS = new THREE.Vector3(0.55, TOP, -0.35);
export const DISCARD_POS = new THREE.Vector3(-0.55, TOP, -0.35);
export const CARD_SLOT_R = 0.36;         // cards of a box lie this far from the centre
export const SPOT_R = 0.56;              // bet rings
export const PANEL_R = 0.80;             // button panels
export const STOOL_R = 0.95;             // stools / players
export const CARD_W = 0.062, CARD_H = 0.088;

/** Angle of spot `i` (0..4, left to right as the player sees it). */
export const spotPhi = (i: number): number => (i - 2) * SPOT_ANGLE;
/** Point on the arc of radius `r` around the centre, at angle φ (x, z). */
export const arcAt = (r: number, phi: number): { x: number; z: number } => ({ x: r * Math.sin(phi), z: CZ + r * Math.cos(phi) });

/** Where a box's card `idx` of hand `hand` lies on the felt (cards fan out along the arc). */
export function slotPos(box: number, hand: number, idx: number): THREE.Vector3 {
  const phi = spotPhi(box);
  const base = arcAt(CARD_SLOT_R, phi);
  const tx = Math.cos(phi), tz = -Math.sin(phi);             // tangent along the arc
  const off = (hand - 1.5) * 0.085;
  const radial = idx * 0.014;                                 // later cards lie towards the player
  return new THREE.Vector3(base.x + tx * off + Math.sin(phi) * radial, TOP + 0.004 + idx * 0.002, base.z + tz * off + Math.cos(phi) * radial);
}
/** Dealer card `idx` (0 = up card, 1 = hole card, 2+ = draws). */
export const dealerSlot = (idx: number): THREE.Vector3 => new THREE.Vector3(-0.12 + idx * 0.1, TOP + 0.004 + idx * 0.002, CZ + 0.05);
/** Where new cards leave the shoe. */
export const shoeMouth = (): THREE.Vector3 => new THREE.Vector3(SHOE_POS.x + 0.09, TOP + 0.08, SHOE_POS.z);

export type BlackjackParts = {
  /** Dealer hands: pivot = wrist, +Z forward. Poses: rest / deal / peek tilt / collect sweep. */
  handL: THREE.Group;
  handR: THREE.Group;
  /** Card shoe (static) and the stack of used cards in the discard tray (scale.y = how full). */
  shoe: THREE.Object3D;
  discardStack: THREE.Object3D;
  /** Five brass button panels, one per spot: hit, stand, double, split, surrender. */
  boxButtons: ButtonPanelPart[];
  /** 256 × 48 scoreboard over the dealer: five columns (one per spot). */
  totals: ScreenSurface;
  /** Card and chip pools on the felt. */
  cards: CardPool;
  chips: ChipPool;
  /** Five-bulb rail chaser, one bulb per occupied spot. */
  seatLamps: BulbChain;
  phaseLamp: LampPart;
  fairLamp: LampPart;
  /** Insurance offer lamp (lit while insurance is open). */
  insuranceLine: LampPart;
  /** Brass bead abacus for the Counting Bead charm (hidden by default). */
  beadCounter: THREE.Group;
  /** Standing pit boss (kit.mannequin), watches the table. */
  pitBoss: MannequinActor;
  /** FX anchors: one per spot, at its main bet ring (pop text, celebrations, coin sweeps). */
  spots: THREE.Object3D[];
};

const SEAT_COLORS = [0xc9a227, 0x39e6ff, 0xc9a227, 0x39e6ff, 0xc9a227];
const BUTTONS: Array<{ id: string; color: number }> = [
  { id: 'hit', color: 0x2a7a3a }, { id: 'stand', color: 0xa02a24 }, { id: 'double', color: 0xc9a227 },
  { id: 'split', color: 0x2a5ea8 }, { id: 'surrender', color: 0x6a6a6a },
];

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<BlackjackParts> {
  const { pal } = kit;
  const root = kit.group('blackjack');
  const woodDark = o.variant % 2 ? pal.wood : pal.woodDark;   // colourway: the body wood
  const felt = pal.felt;
  const rail = pal.redDark;
  const half = Math.PI;
  // half-moon, flat edge on z = CZ, curving towards the player (+Z): rot −90° maps the x ≥ 0 half onto z ≥ 0
  const halfRot: [number, number, number] = [0, -90, 0];

  // body, rail, felt
  kit.cyl(FELT_R + 0.05, FELT_R + 0.05, TOP - 0.07, { color: woodDark, map: kit.tex.wood(woodDark) },
    { pos: [0, (TOP - 0.07) / 2, CZ], rot: halfRot, seg: 12, thetaLen: half, parent: root });
  kit.cyl(FELT_R + 0.06, FELT_R + 0.06, 0.06, { color: rail }, { pos: [0, TOP - 0.035, CZ], rot: halfRot, seg: 12, thetaLen: half, parent: root });
  kit.cyl(FELT_R, FELT_R, 0.02, { color: felt, map: kit.tex.felt(felt) },
    { pos: [0, TOP - 0.01, CZ], rot: halfRot, seg: 12, thetaLen: half, parent: root });
  // brass edge along the curve and the flat edge
  kit.torus(FELT_R + 0.06, 0.008, pal.brass, { pos: [0, TOP - 0.005, CZ], rot: [90, 0, 0], seg: 12, arc: half, parent: root });

  // betting rings (main Ø0.11, Twin Souls Ø0.06 outside it) — static
  for (let i = 0; i < SPOTS; i++) {
    const phi = spotPhi(i);
    const main = arcAt(SPOT_R, phi);
    kit.torus(0.055, 0.004, pal.gold, { pos: [main.x, TOP + 0.002, main.z], rot: [90, 0, 0], seg: 10, parent: root });
    const twin = arcAt(SPOT_R + 0.11, phi);
    kit.torus(0.03, 0.003, pal.chrome, { pos: [twin.x, TOP + 0.002, twin.z], rot: [90, 0, 0], seg: 10, parent: root });
  }

  // dealer pedestal + brass trim, the hands on rods
  kit.box(0.56, TOP - 0.03, 0.24, { color: pal.black, map: kit.tex.wood(pal.black) }, { pos: [0, (TOP - 0.03) / 2, DEALER_Z - 0.02], parent: root, bevel: 0.01 });
  kit.box(0.6, 0.03, 0.28, pal.brass, { pos: [0, TOP - 0.015, DEALER_Z - 0.02], parent: root });

  const hands: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.13;
    kit.cyl(0.011, 0.011, 0.2, pal.brass, { pos: [x, TOP + 0.1, DEALER_Z], seg: 6, parent: root });
    const hand = new THREE.Group();
    hand.name = side < 0 ? 'handL' : 'handR';
    hand.position.set(x, TOP + 0.2, DEALER_Z);
    root.add(hand);
    kit.box(0.1, 0.024, 0.11, pal.bone, { pos: [0, 0, 0.055], parent: hand });              // palm
    kit.box(0.034, 0.018, 0.034, pal.bone, { pos: [0, 0, 0.12], parent: hand });            // wrist knuckle
    for (let f = 0; f < 4; f++) {                                                             // fingers, 2 segments
      const fx = -0.036 + f * 0.024;
      kit.box(0.016, 0.014, 0.05, pal.bone, { pos: [fx, -0.004, 0.16], parent: hand });
      kit.box(0.014, 0.012, 0.04, pal.bone, { pos: [fx, -0.008, 0.205], rot: [-12, 0, 0], parent: hand });
    }
    kit.box(0.02, 0.014, 0.05, pal.bone, { pos: [side * 0.05, -0.002, 0.07], rot: [0, -side * 35, 0], parent: hand });   // thumb
    hands.push(hand);
  }

  // shoe at dealer-left (cards leave from its mouth), discard tray at dealer-right
  const shoePart = kit.cardShoe();
  shoePart.root.position.copy(SHOE_POS);
  root.add(shoePart.root);
  kit.box(0.07, 0.008, CARD_H + 0.01, pal.redDark, { pos: [SHOE_POS.x - 0.05, TOP + 0.01, SHOE_POS.z], parent: root });   // red cut card
  const tray = kit.glass({ w: 0.2, h: 0.03, d: 0.14, tint: pal.glass, opacity: 0.35 });
  tray.position.copy(DISCARD_POS).add(new THREE.Vector3(0, 0.015, 0));
  root.add(tray);
  const discard = kit.box(CARD_W, 0.012, CARD_H, pal.cream, { pos: [DISCARD_POS.x, TOP + 0.006, DISCARD_POS.z], parent: root });
  discard.scale.y = 0.2;

  // betting panels: five brass button panels, one per spot, facing their player
  const boxButtons: ButtonPanelPart[] = [];
  for (let i = 0; i < SPOTS; i++) {
    const phi = spotPhi(i);
    const p = arcAt(PANEL_R, phi);
    const panel = kit.buttonPanel({
      buttons: BUTTONS.map((b, k) => ({ id: b.id, color: b.color, x: -0.14 + k * 0.07, z: 0, w: 0.05, h: 0.05 })),
      w: 0.4, d: 0.12, slope: 14, plate: woodDark, capH: 0.018,
    });
    panel.root.position.set(p.x, TOP, p.z);
    panel.root.rotation.y = phi;
    root.add(panel.root);
    boxButtons.push(panel);
  }

  // five-bulb chaser along the rail in front of the spots
  const railPts: Array<[number, number, number]> = [];
  for (let i = 0; i < SPOTS; i++) {
    const s = arcAt(STOOL_R - 0.06, spotPhi(i));
    railPts.push([s.x, TOP + 0.01, s.z]);
  }
  const seatLamps = kit.bulbChain({ path: railPts, count: SPOTS, colors: SEAT_COLORS, r: 0.012 });
  root.add(seatLamps.root);

  // scoreboard over the dealer
  const totals = kit.screen({ w: 1.3, h: 0.24, px: [256, 48], bezel: pal.black, glow: 0.6 });
  totals.mesh.position.set(0, 1.28, DEALER_Z - 0.12);
  root.add(totals.mesh);
  kit.box(1.36, 0.32, 0.04, pal.black, { pos: [0, 1.28, DEALER_Z - 0.14], parent: root, bevel: 0.01 });
  const phaseLamp = kit.lamp({ r: 0.022, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(-0.6, 1.44, DEALER_Z - 0.1);
  const fairLamp = kit.lamp({ r: 0.022, color: pal.neonCyan, shape: 'dome' });
  fairLamp.root.position.set(0.6, 1.44, DEALER_Z - 0.1);
  const insuranceLine = kit.lamp({ r: 0.022, color: pal.neonYellow, shape: 'dome' });
  insuranceLine.root.position.set(0, 1.44, DEALER_Z - 0.1);
  root.add(phaseLamp.root, fairLamp.root, insuranceLine.root);

  // stools at the spots, camera pose per seat
  const seats: SeatDef[] = [];
  for (let i = 0; i < SPOTS; i++) {
    const phi = spotPhi(i);
    const s = arcAt(STOOL_R, phi);
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(s.x, 0, s.z);
    root.add(stool);
    seats.push({
      pose: {
        pos: new THREE.Vector3(s.x * 1.05, 1.2, s.z + 0.3),
        look: new THREE.Vector3(s.x * 0.6, TOP, -0.1),
        fov: 60, mouse: 'primary',
      },
      stand: new THREE.Vector3(s.x, 0, s.z),
      avatar: 'sit',
    });
  }

  // card and chip pools (pools are dynamic, kept out of the merge)
  const cards = kit.cards({ max: 32 });
  root.add(cards.root);
  // pool for the five spots' stacks and payout flights (48 tris per instance; a full pool drops the newest chip)
  const chips = kit.chips({ max: 120 });
  root.add(chips.root);

  // beads (Counting Bead charm, hidden by default): two rods and eleven beads, left of the dealer
  const beadCounter = new THREE.Group();
  beadCounter.name = 'beadCounter';
  beadCounter.position.set(-0.95, TOP, DEALER_Z + 0.05);
  root.add(beadCounter);
  kit.cyl(0.006, 0.006, 0.26, pal.brass, { pos: [0, 0.14, 0], seg: 5, parent: beadCounter });
  kit.cyl(0.006, 0.006, 0.26, pal.brass, { pos: [0, 0.14, 0.05], seg: 5, parent: beadCounter });
  for (let b = 0; b < 11; b++) {
    kit.sphere(0.012, b % 2 === 0 ? pal.brass : pal.chrome, { pos: [0, 0.02 + b * 0.022, 0.025], wSeg: 6, hSeg: 4, parent: beadCounter });
  }
  beadCounter.visible = false;

  // pit boss, standing behind the spot to the dealer's left
  const pitBoss = kit.mannequin({ style: 'plain', color: 0x1c1c1c, jointColor: 0x3a3a3a, height: 1.82, clip: 'Idle_Loop' });
  pitBoss.root.position.set(-1.05, 0, -0.62);
  pitBoss.root.rotation.y = Math.atan2(1.05, 0.42);
  root.add(pitBoss.root);

  // light and anchors
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, -0.2);
  light.userData = { color: 0xffe2a0, intensity: 0.7, range: 2.8, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, -0.5);
  root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.62, DEALER_Z - 0.14); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.7, DEALER_Z - 0.14); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.05, 0.9, 0.2); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.86, CZ + 0.2); root.add(coinOut);
  const shoeMouthAnchor = new THREE.Object3D(); shoeMouthAnchor.position.copy(shoeMouth()); root.add(shoeMouthAnchor);

  const spots: THREE.Object3D[] = [];
  for (let i = 0; i < SPOTS; i++) {
    const c = arcAt(SPOT_R, spotPhi(i));
    const at = new THREE.Object3D();
    at.position.set(c.x, TOP + 0.02, c.z);
    root.add(at);
    spots.push(at);
  }

  const parts: BlackjackParts = {
    handL: hands[0], handR: hands[1], shoe: shoePart.root, discardStack: discard,
    boxButtons, totals, cards, chips, seatLamps, phaseLamp, fairLamp, insuranceLine, beadCounter, pitBoss, spots,
  };
  kit.finalize(root, {
    keep: [
      ...hands, discard, ...boxButtons.map((b) => b.root), totals.mesh, cards.root, chips.root, seatLamps.root,
      phaseLamp.root, fairLamp.root, insuranceLine.root, pitBoss.root, light,
    ],
  });
  return {
    root, parts, seats,
    playPose: seats[2].pose,
    colliders: [
      { min: [-1.08, 0, -0.5], max: [1.08, 0.8, 0.6] },
      { min: [-0.32, 0, DEALER_Z - 0.16], max: [0.32, 0.8, DEALER_Z + 0.1] },
    ],
    interact: { min: [-1.15, 0.2, -1.0], max: [1.15, 1.45, 0.9] },
    anchors: {
      speaker: prompt, prompt, label, marqueeTop, servicePlate, light, coinOut, shoeMouth: shoeMouthAnchor,
    },
    dispose: () => { totals.dispose(); },
  };
}
