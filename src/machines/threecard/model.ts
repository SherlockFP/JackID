/**
 * Three Card Poker "Üç Kart Poker" — procedural model (MACHINES_tables §16). Metres, origin = floor centre of the
 * footprint, +Z = the player side.
 *
 * A half-moon felt (1.80 × 0.90 m, top at 0.78 m, green `#1F5A3A`) with its flat edge on z = CZ facing the dealer.
 * Six seats on an arc, each with three rings: Ante (outer), Play (inner) and Pair Plus (outermost). The dealer is "the
 * Shuffler": a standing mannequin behind the flat edge, its torso replaced by a brass card shuffler on the table (a
 * slot, a whirring drum and a lid that pops for a straight flush). A "Q · 6 · 4" placard sits in front of the dealer and
 * a qualify lamp sits above it. Three cards per hand are fanned on the felt in front of each seat.
 *
 * Draw budget: static geometry merges through kit.finalize; the card and chip pools, the status screen and the animated
 * shuffler parts are listed in `keep`.
 */
import * as THREE from 'three';
import type { BulbChain, CardPool, ChipPool, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.78;                  // felt height, m
export const CZ = -0.45;                  // centre of the half-moon (the flat edge runs along z = CZ)
export const FELT_R = 0.9;
export const SEATS = 6;
export const SEAT_SPAN = Math.PI * 5 / 6; // 150° fan: seats at −75 … +75
export const DEALER_Z = CZ - 0.3;         // dealer pedestal centre, behind the flat edge (its top is the felt height)
export const SHUFFLER_POS = new THREE.Vector3(0, TOP, DEALER_Z - 0.03);
export const STOOL_R = 1.02;              // stools / players
export const CARD_R = 0.27;               // cards lie this far from the centre
export const PLAY_R = 0.43, ANTE_R = 0.56, PAIR_R = 0.69;
export const CARD_W = 0.062, CARD_H = 0.088;

/** Angle of seat `i` (0..5, left to right as the player sees it). */
export const seatPhi = (i: number): number => (i - (SEATS - 1) / 2) * (SEAT_SPAN / (SEATS - 1));
/** Point on the arc of radius `r` around the centre, at angle φ (x, z). */
export const arcAt = (r: number, phi: number): { x: number; z: number } => ({ x: r * Math.sin(phi), z: CZ + r * Math.cos(phi) });

/** Where seat `seat`'s card `idx` (0..2) lies on the felt: three cards fanned along the arc. */
export function cardSlot(seat: number, idx: number): THREE.Vector3 {
  const phi = seatPhi(seat);
  const base = arcAt(CARD_R, phi);
  const tx = Math.cos(phi), tz = -Math.sin(phi);
  const off = (idx - 1) * 0.07;
  return new THREE.Vector3(base.x + tx * off, TOP + 0.004 + idx * 0.002, base.z + tz * off);
}
/** Dealer card `idx` (0..2) on the felt, in front of the Shuffler. */
export const dealerSlot = (idx: number): THREE.Vector3 => new THREE.Vector3(-0.1 + idx * 0.1, TOP + 0.004 + idx * 0.002, CZ + 0.02);

export type ThreecardParts = {
  /** Brass shuffler on the table: `drum` spins while the deck is shuffled, `lid` pops for a straight flush. */
  shuffler: THREE.Group;
  drum: THREE.Object3D;
  lid: THREE.Object3D;
  /** Standing dealer mannequin ("the Shuffler"). */
  dealer: MannequinActor;
  /** 256 × 48 status screen over the dealer (phase text, dealer hand, timer). */
  status: ScreenSurface;
  /** Qualify lamp (lit when the dealer qualifies), phase lamp, and the Q·6·4 placard lamp (milestone L10). */
  qualifyLamp: LampPart;
  phaseLamp: LampPart;
  placardLamp: LampPart;
  /** Six-bulb rail chaser, one bulb per occupied seat. */
  seatLamps: BulbChain;
  cards: CardPool;
  chips: ChipPool;
  /** FX anchors per seat, at its Ante ring. */
  spots: THREE.Object3D[];
};

const SEAT_COLORS = [0xc9a227, 0x39e6ff, 0xc9a227, 0x39e6ff, 0xc9a227, 0x39e6ff];

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ThreecardParts> {
  const { pal } = kit;
  const root = kit.group('threecard');
  const woodDark = o.variant % 2 ? pal.wood : pal.woodDark;
  const felt = 0x1f5a3a;
  const rail = pal.black;
  const halfRot: [number, number, number] = [0, -90, 0];
  const half = Math.PI;

  // half-moon body, rail, felt and brass edge
  kit.cyl(FELT_R + 0.05, FELT_R + 0.05, TOP - 0.07, { color: woodDark, map: kit.tex.wood(woodDark) },
    { pos: [0, (TOP - 0.07) / 2, CZ], rot: halfRot, seg: 24, thetaLen: half, parent: root });
  kit.cyl(FELT_R + 0.06, FELT_R + 0.06, 0.06, { color: rail }, { pos: [0, TOP - 0.035, CZ], rot: halfRot, seg: 24, thetaLen: half, parent: root });
  kit.cyl(FELT_R, FELT_R, 0.02, { color: felt, map: kit.tex.felt(felt) },
    { pos: [0, TOP - 0.01, CZ], rot: halfRot, seg: 24, thetaLen: half, parent: root });
  kit.torus(FELT_R + 0.06, 0.008, pal.brass, { pos: [0, TOP - 0.005, CZ], rot: [90, 0, 0], seg: 24, arc: half, parent: root });

  // three rings per seat: Ante (gold), Play (cyan-chrome), Pair Plus (brass)
  for (let i = 0; i < SEATS; i++) {
    const phi = seatPhi(i);
    const play = arcAt(PLAY_R, phi), ante = arcAt(ANTE_R, phi), pair = arcAt(PAIR_R, phi);
    kit.torus(0.05, 0.004, pal.gold, { pos: [ante.x, TOP + 0.002, ante.z], rot: [90, 0, 0], seg: 14, parent: root });
    kit.torus(0.042, 0.003, pal.chrome, { pos: [play.x, TOP + 0.002, play.z], rot: [90, 0, 0], seg: 12, parent: root });
    kit.torus(0.045, 0.003, pal.brass, { pos: [pair.x, TOP + 0.002, pair.z], rot: [90, 0, 0], seg: 12, parent: root });
  }

  // the Shuffler on the table: walnut base, brass drum and a hinged lid (pops on a straight flush)
  const shuffler = new THREE.Group();
  shuffler.name = 'shuffler';
  shuffler.position.copy(SHUFFLER_POS);
  root.add(shuffler);
  kit.box(0.26, 0.09, 0.16, { color: woodDark, map: kit.tex.wood(woodDark) }, { pos: [0, 0.045, 0], parent: shuffler, bevel: 0.01 });
  const drum = new THREE.Object3D();
  drum.position.set(0, 0.095, 0);
  shuffler.add(drum);
  kit.cyl(0.05, 0.05, 0.14, pal.brass, { pos: [0, 0, 0], rot: [0, 0, 90], seg: 12, parent: drum });
  const lid = new THREE.Object3D();
  lid.position.set(0, 0.09, -0.08);
  shuffler.add(lid);
  kit.box(0.26, 0.012, 0.16, pal.brass, { pos: [0, 0.006, 0.08], parent: lid });
  kit.box(0.22, 0.004, 0.02, pal.black, { pos: [0, 0.012, 0.075], parent: lid });  // card slot

  // dealer pedestal (top at felt height), the placard in front of the Shuffler, the mannequin behind the pedestal
  kit.box(0.64, TOP - 0.03, 0.3, { color: pal.black, map: kit.tex.wood(pal.black) }, { pos: [0, (TOP - 0.03) / 2, DEALER_Z], parent: root, bevel: 0.01 });
  kit.box(0.66, 0.03, 0.32, pal.brass, { pos: [0, TOP - 0.015, DEALER_Z], parent: root });
  kit.box(0.2, 0.004, 0.09, pal.cream, { pos: [0, TOP + 0.002, DEALER_Z + 0.1], parent: root, bevel: 0.002 });
  const dealer = kit.mannequin({ style: 'plain', color: 0x1c1c1c, jointColor: 0x3a3a3a, height: 1.82, clip: 'Idle_Loop' });
  dealer.root.position.set(0, 0, DEALER_Z - 0.3);
  root.add(dealer.root);

  // status screen above the dealer, qualify and phase lamps
  const status = kit.screen({ w: 1.1, h: 0.22, px: [256, 48], bezel: pal.black, glow: 0.6 });
  status.mesh.position.set(0, 1.42, DEALER_Z - 0.1);
  root.add(status.mesh);
  kit.box(1.16, 0.3, 0.04, pal.black, { pos: [0, 1.42, DEALER_Z - 0.12], parent: root, bevel: 0.01 });
  const qualifyLamp = kit.lamp({ r: 0.022, color: pal.neonCyan, shape: 'dome' });
  qualifyLamp.root.position.set(0.5, 1.58, DEALER_Z - 0.1);
  const phaseLamp = kit.lamp({ r: 0.022, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(-0.5, 1.58, DEALER_Z - 0.1);
  const placardLamp = kit.lamp({ r: 0.02, color: pal.neonYellow, shape: 'dome' });
  placardLamp.root.position.set(0, 1.58, DEALER_Z - 0.1);
  root.add(qualifyLamp.root, phaseLamp.root, placardLamp.root);

  // six stools and seats
  const seats: SeatDef[] = [];
  for (let i = 0; i < SEATS; i++) {
    const phi = seatPhi(i);
    const s = arcAt(STOOL_R, phi);
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(s.x, 0, s.z);
    root.add(stool);
    seats.push({
      pose: {
        pos: new THREE.Vector3(s.x * 1.02, 1.2, s.z + 0.28),
        look: new THREE.Vector3(s.x * 0.5, TOP, CZ + 0.1),
        fov: 60, mouse: 'primary',
      },
      stand: new THREE.Vector3(s.x, 0, s.z),
      avatar: 'sit',
    });
  }

  // rail chaser along the stool line
  const railPts: Array<[number, number, number]> = [];
  for (let i = 0; i < SEATS; i++) {
    const s = arcAt(STOOL_R - 0.06, seatPhi(i));
    railPts.push([s.x, TOP + 0.01, s.z]);
  }
  const seatLamps = kit.bulbChain({ path: railPts, count: SEATS, colors: SEAT_COLORS, r: 0.012 });
  root.add(seatLamps.root);

  // pools (dynamic, kept out of the merge)
  const cards = kit.cards({ max: 64 });
  root.add(cards.root);
  const chips = kit.chips({ max: 300 });
  root.add(chips.root);

  // light and anchors
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, CZ - 0.2);
  light.userData = { color: 0xffe2a0, intensity: 0.7, range: 2.8, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, CZ - 0.6); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.7, DEALER_Z - 0.04); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.8, DEALER_Z - 0.04); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.0, 0.9, 0.2); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.86, CZ + 0.2); root.add(coinOut);
  const spots: THREE.Object3D[] = [];
  for (let i = 0; i < SEATS; i++) {
    const c = arcAt(ANTE_R, seatPhi(i));
    const at = new THREE.Object3D();
    at.position.set(c.x, TOP + 0.02, c.z);
    root.add(at);
    spots.push(at);
  }
  const shufflerAnchor = new THREE.Object3D(); shufflerAnchor.position.copy(SHUFFLER_POS).add(new THREE.Vector3(0, 0.12, 0)); root.add(shufflerAnchor);

  const parts: ThreecardParts = {
    shuffler, drum, lid, dealer, status, qualifyLamp, phaseLamp, placardLamp, seatLamps, cards, chips, spots,
  };
  kit.finalize(root, {
    keep: [
      shuffler, dealer.root, status.mesh, qualifyLamp.root, phaseLamp.root, placardLamp.root, seatLamps.root,
      cards.root, chips.root, light,
    ],
  });
  return {
    root, parts, seats,
    playPose: seats[2].pose,
    colliders: [
      { min: [-1.08, 0, -0.5], max: [1.08, 0.8, 0.5] },
      { min: [-0.36, 0, DEALER_Z - 0.2], max: [0.36, 0.8, DEALER_Z + 0.14] },
    ],
    interact: { min: [-1.2, 0.2, -1.0], max: [1.2, 1.5, 0.95] },
    anchors: {
      speaker: prompt, prompt, label, marqueeTop, servicePlate, light, coinOut, shuffler: shufflerAnchor,
    },
    dispose: () => { status.dispose(); },
  };
}
