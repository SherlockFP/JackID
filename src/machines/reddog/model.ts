/**
 * Red Dog "The Kennel" — procedural model (MACHINES_tables §17, ART_BIBLE §5, PLAN Appendix A.33 `mdl-reddog`).
 *
 * `buildModel` returns a full `MachineModel`; the exported `ReddogParts` type is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = the player side, the dealer (a dog-headed automaton in a
 * waistcoat) stands at −Z behind the felt. Table 1.80 × 0.90 m, burgundy felt #5A1A1E at 0.78 m, six stools.
 * A brass spread bar with 11 lamps and a pay label hangs over the card spots.
 */
import * as THREE from 'three';
import type { CardPool, ChipPool, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.78;                  // felt height, m
export const SEATS = 6;
export const TABLE_W = 1.8, TABLE_D = 0.9;
export const FELT_HEX = 0x5a1a1e;         // burgundy felt
export const RAIL_HEX = 0x7a2a2e;         // padded rail
export const SEAT_Z = 0.62;               // stools (players)
export const DEALER_Z = -0.6;             // the dog-headed dealer
export const DEALER_H = 1.5;              // mannequin height (the dog head sits on top)
export const DOG_Y = 1.5;                 // dog head centre height
export const SPREAD_LAMPS = 11;
export const SPREAD_Y = 1.0;              // brass spread bar height
export const SPREAD_Z = -0.36;
export const CARD_SLOT_Y = TOP + 0.004;
export const CARD_CUT = 0.8;
export const SHOE_POS = new THREE.Vector3(-0.74, TOP, -0.26);
export const DISCARD_POS = new THREE.Vector3(0.74, TOP, -0.26);
export const CARD_SPOT_Z = -0.12;

/** Stool and bet-spot x for seat `i` (0..5, left to right as the player sees the table). */
export const seatX = (i: number): number => (i - (SEATS - 1) / 2) * 0.3;

/** Chip anchor for a seat's main bet, in front of the stool line. */
export const betVec = (seat: number): THREE.Vector3 => new THREE.Vector3(seatX(seat), TOP + 0.006, 0.26);
/** Card spots: 0 left, 1 right, 2 middle (the third card). */
export const cardSpotVec = (i: number): THREE.Vector3 =>
  new THREE.Vector3([-0.3, 0.3, 0][i] ?? 0, CARD_SLOT_Y, CARD_SPOT_Z);
export const spreadLampVec = (i: number): THREE.Vector3 =>
  new THREE.Vector3(-0.5 + i * (1.0 / (SPREAD_LAMPS - 1)), SPREAD_Y, SPREAD_Z);
export const shoeMouth = (): THREE.Vector3 => new THREE.Vector3(SHOE_POS.x + 0.09, TOP + 0.08, SHOE_POS.z);

/** The procedural dog head on the dealer. Jaw barks; the ears tilt for the peek tell; the tail wags on wins. */
export interface DogParts {
  root: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Object3D;
  earL: THREE.Object3D;
  earR: THREE.Object3D;
  tail: THREE.Object3D;
}

export type ReddogParts = {
  /** The dealer, a waistcoated mannequin under the dog head. */
  dealer: MannequinActor;
  dog: DogParts;
  /** Eleven lamps on the spread bar; the lit range is the spread. */
  spreadLamps: LampPart[];
  /** 48 × 16 pay label ("5:1"). */
  payLabel: ScreenSurface;
  /** Left, right and middle card anchors. */
  cardSpots: THREE.Object3D[];
  /** Shoe (static), its gauge and the discard stack (scale.y = how full). */
  shoe: THREE.Object3D;
  shoeLevel: THREE.Object3D;
  discardStack: THREE.Object3D;
  cards: CardPool;
  chips: ChipPool;
  /** Felt canvas with the bet boxes and the table name. */
  felt: ScreenSurface;
  /** Counting Bead (hidden by default): shows the Hi-Lo running and true count. */
  beadCounter: THREE.Group;
  beadRods: THREE.Object3D[];
  /** Six rail meters (cosmetic) and six seat lamps on the near rail. */
  railMeters: THREE.Object3D[];
  seatLamps: LampPart[];
  stools: THREE.Object3D[];
  /** Pendant shade over the table (its light is pooled from the anchor). */
  pendant: THREE.Object3D;
  /** Per seat main bet anchor. */
  betSpots: THREE.Object3D[];
};

function buildDog(kit: KitX, root: THREE.Group): DogParts {
  const fur = 0xb07a3c, dark = 0x2a1408, nose = 0x0a0a0a;
  const head = new THREE.Group();
  head.name = 'dogHead';
  head.position.set(0, DOG_Y, DEALER_Z);
  root.add(head);
  // skull and snout
  kit.box(0.2, 0.18, 0.2, fur, { pos: [0, 0, 0], parent: head, bevel: 0.01 });
  kit.box(0.13, 0.1, 0.16, fur, { pos: [0, -0.03, 0.17], parent: head, bevel: 0.008 });
  kit.box(0.05, 0.04, 0.03, nose, { pos: [0, 0.01, 0.26], parent: head });
  // hinged triangle ears
  const hinge = (x: number, name: string): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, 0.09, -0.02);
    head.add(g);
    kit.cyl(0.0, 0.05, 0.13, dark, { pos: [0, 0.065, 0], seg: 3, parent: g });
    return g;
  };
  const earL = hinge(-0.08, 'dogEarL');
  const earR = hinge(0.08, 'dogEarR');
  // hinged lower jaw
  const jaw = new THREE.Group();
  jaw.name = 'dogJaw';
  jaw.position.set(0, -0.09, 0.02);
  head.add(jaw);
  kit.box(0.12, 0.035, 0.15, fur, { pos: [0, 0, 0.07], parent: jaw });
  // glass eyes
  for (const s of [-1, 1]) kit.sphere(0.02, 0xffd040, { pos: [s * 0.07, 0.03, 0.1], parent: head, wSeg: 6, hSeg: 4 });
  // servo tail on the dealer's back, wags on wins
  const tail = new THREE.Group();
  tail.name = 'dogTail';
  tail.position.set(0, 0.9, DEALER_Z - 0.12);
  root.add(tail);
  kit.cyl(0.024, 0.012, 0.3, fur, { pos: [0, 0, -0.14], rot: [90, 0, 0], seg: 5, parent: tail });
  return { root: head, head, jaw, earL, earR, tail };
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ReddogParts> {
  const { pal } = kit;
  const root = kit.group('reddog');

  // table body with the padded rail and the burgundy felt on top
  kit.box(TABLE_W, TOP - 0.06, TABLE_D, 0x3a0c10, { pos: [0, (TOP - 0.06) / 2, 0], parent: root, bevel: 0.01 });
  const felt = kit.screen({ w: TABLE_W - 0.2, h: TABLE_D - 0.14, px: [360, 170], bezel: pal.brass, glow: 0 });
  felt.mesh.position.set(0, TOP + 0.003, 0);
  felt.mesh.rotation.x = -Math.PI / 2;
  root.add(felt.mesh);
  // padded rail: four cushions around the felt
  const railY = TOP + 0.03;
  kit.box(TABLE_W, 0.06, 0.06, RAIL_HEX, { pos: [0, railY, -TABLE_D / 2 + 0.03], parent: root, bevel: 0.015 });
  kit.box(TABLE_W, 0.06, 0.06, RAIL_HEX, { pos: [0, railY, TABLE_D / 2 - 0.03], parent: root, bevel: 0.015 });
  kit.box(0.06, 0.06, TABLE_D, RAIL_HEX, { pos: [-TABLE_W / 2 + 0.03, railY, 0], parent: root, bevel: 0.015 });
  kit.box(0.06, 0.06, TABLE_D, RAIL_HEX, { pos: [TABLE_W / 2 - 0.03, railY, 0], parent: root, bevel: 0.015 });
  kit.box(TABLE_W + 0.02, 0.02, TABLE_D + 0.02, pal.gold, { pos: [0, TOP - 0.07, 0], parent: root });

  // brass spread bar: two posts, the bar and eleven lamps; pay label facing the seats
  const barRoot = new THREE.Group();
  barRoot.name = 'spreadBar';
  root.add(barRoot);
  kit.box(1.04, 0.03, 0.04, pal.brass, { pos: [0, SPREAD_Y, SPREAD_Z], parent: barRoot });
  for (const s of [-1, 1]) kit.cyl(0.012, 0.012, SPREAD_Y - TOP, pal.brass, { pos: [s * 0.52, (SPREAD_Y + TOP) / 2, SPREAD_Z], seg: 5, parent: barRoot });
  const spreadLamps: LampPart[] = [];
  for (let i = 0; i < SPREAD_LAMPS; i++) {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    const v = spreadLampVec(i);
    l.root.position.set(v.x, SPREAD_Y + 0.025, v.z);
    barRoot.add(l.root);
    spreadLamps.push(l);
  }
  const payLabel = kit.screen({ w: 0.12, h: 0.04, px: [48, 16], bezel: pal.brass, glow: 0.5 });
  payLabel.mesh.position.set(0, SPREAD_Y + 0.1, SPREAD_Z);
  root.add(payLabel.mesh);

  // stools and play poses (camera above the stool, looking across the felt at the dealer)
  const stools: THREE.Object3D[] = [];
  const seats: SeatDef[] = [];
  for (let i = 0; i < SEATS; i++) {
    const x = seatX(i);
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(x, 0, SEAT_Z);
    root.add(stool);
    stools.push(stool);
    seats.push({
      pose: { pos: new THREE.Vector3(x, 1.18, 0.7), look: new THREE.Vector3(x * 0.5, TOP, -0.2), fov: 60, mouse: 'pick' },
      stand: new THREE.Vector3(x, 0, SEAT_Z + 0.12),
      avatar: 'sit',
    });
  }

  // the dealer: a waistcoated mannequin, with the dog head on top
  const dealer = kit.mannequin({ style: 'plain', color: 0x3a1010, jointColor: 0x141414, height: DEALER_H, clip: 'Idle_Loop' });
  dealer.root.position.set(0, 0, DEALER_Z);
  root.add(dealer.root);
  const dog = buildDog(kit, root);

  // shoe with a gauge, discard tray and the cut-card marker
  const shoePart = kit.cardShoe();
  shoePart.root.position.copy(SHOE_POS);
  root.add(shoePart.root);
  const shoeLevel = kit.box(0.02, 0.1, 0.02, pal.brass, { pos: [SHOE_POS.x + 0.13, TOP + 0.05, SHOE_POS.z], parent: root });
  const tray = kit.glass({ w: 0.2, h: 0.03, d: 0.14, tint: pal.glass, opacity: 0.35 });
  tray.position.copy(DISCARD_POS).add(new THREE.Vector3(0, 0.015, 0));
  root.add(tray);
  const discard = kit.box(0.062, 0.012, 0.088, pal.cream, { pos: [DISCARD_POS.x, TOP + 0.006, DISCARD_POS.z], parent: root });
  discard.scale.y = 0.2;

  // rail meters and seat lamps on the near rail
  const railMeters: THREE.Object3D[] = [];
  const seatLamps: LampPart[] = [];
  for (let i = 0; i < SEATS; i++) {
    railMeters.push(kit.box(0.02, 0.05, 0.02, pal.brass, { pos: [seatX(i), TOP + 0.03, TABLE_D / 2 - 0.01], parent: root }));
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    l.root.position.set(seatX(i), TOP + 0.01, TABLE_D / 2 + 0.01);
    root.add(l.root);
    seatLamps.push(l);
  }

  // Counting Bead (hidden by default): two rods and eleven beads, behind the shoe
  const beadCounter = new THREE.Group();
  beadCounter.name = 'beadCounter';
  beadCounter.position.set(-0.56, TOP, -0.36);
  root.add(beadCounter);
  const beadRods: THREE.Object3D[] = [];
  beadRods.push(kit.cyl(0.006, 0.006, 0.26, pal.brass, { pos: [0, 0.14, 0], seg: 5, parent: beadCounter }));
  for (let b = 0; b < 11; b++) {
    beadRods.push(kit.sphere(0.012, b % 2 === 0 ? pal.brass : pal.chrome, { pos: [0, 0.02 + b * 0.022, 0.025], wSeg: 6, hSeg: 4, parent: beadCounter }));
  }
  beadCounter.visible = false;

  // pools (dynamic, kept out of the merge)
  const cards = kit.cards({ max: 12 });
  root.add(cards.root);
  const chips = kit.chips({ max: 300 });
  root.add(chips.root);

  // pendant over the table, its light is the pooled hint
  const pendant = new THREE.Group();
  pendant.name = 'pendant';
  pendant.position.set(0, 2.05, -0.05);
  root.add(pendant);
  kit.cyl(0.006, 0.006, 0.5, pal.chrome, { pos: [0, 0.25, 0], seg: 5, parent: pendant });
  kit.cyl(0.11, 0.2, 0.12, pal.brass, { pos: [0, -0.02, 0], seg: 12, parent: pendant });

  // card spots, bet spots and anchors
  const cardSpots: THREE.Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const at = new THREE.Object3D();
    at.position.copy(cardSpotVec(i));
    root.add(at);
    cardSpots.push(at);
  }
  const betSpots: THREE.Object3D[] = [];
  for (let i = 0; i < SEATS; i++) {
    const at = new THREE.Object3D();
    at.position.copy(betVec(i));
    root.add(at);
    betSpots.push(at);
  }

  // felt canvas is drawn by index.ts (bet boxes per seat and the table name); the shared hand bet box is the felt
  const light = new THREE.Object3D();
  light.position.set(0, 1.85, -0.05);
  light.userData = { color: 0xffe2a0, intensity: 0.6, range: 3.0, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 0.5); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.5, -0.12); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.2, DEALER_Z); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.05, 0.9, 0.1); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.86, 0.2); root.add(coinOut);
  const dealerAnchor = new THREE.Object3D(); dealerAnchor.position.set(0, 0, DEALER_Z); root.add(dealerAnchor);
  const shoeMouthAnchor = new THREE.Object3D(); shoeMouthAnchor.position.copy(shoeMouth()); root.add(shoeMouthAnchor);

  const parts: ReddogParts = {
    dealer, dog, spreadLamps, payLabel, cardSpots, shoe: shoePart.root, shoeLevel, discardStack: discard,
    cards, chips, felt, beadCounter, beadRods, railMeters, seatLamps, stools, pendant, betSpots,
  };
  kit.finalize(root, {
    keep: [
      dealer.root, felt.mesh, payLabel.mesh, cards.root, chips.root, shoeLevel, discard, light, shoePart.root, tray,
      beadCounter, dog.root, ...seatLamps.map((l) => l.root), ...spreadLamps.map((l) => l.root), ...railMeters, pendant,
    ],
  });
  return {
    root, parts, seats,
    playPose: seats[2].pose,
    colliders: [
      { min: [-TABLE_W / 2 - 0.02, 0, -TABLE_D / 2 - 0.02], max: [TABLE_W / 2 + 0.02, 0.8, TABLE_D / 2 + 0.02] },
      { min: [-0.2, 0, DEALER_Z - 0.18], max: [0.2, 1.8, DEALER_Z + 0.18] },
    ],
    interact: { min: [-1.0, 0.2, -1.0], max: [1.0, 1.9, 0.9] },
    anchors: {
      speaker: prompt, prompt, label, marqueeTop, servicePlate, coinOut, light, dealer: dealerAnchor, shoeMouth: shoeMouthAnchor,
    },
    dispose: () => { felt.dispose(); payLabel.dispose(); },
  };
}

