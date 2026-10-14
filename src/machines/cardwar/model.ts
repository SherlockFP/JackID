/**
 * War Table — procedural model (MACHINES_tables §10, ART_BIBLE §5, PLAN modelBrief `mdl-cardwar`).
 *
 * `buildModel` returns a full `MachineModel`; the exported `CardwarParts` type is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = the player side, the dealer ("the Twin") stands at −Z between two
 * carved heads (dragon at −X, tiger at +X) on posts. Long lacquer table 2.40 × 1.10 m, felt at 0.78 m.
 *
 * One model serves both rule-sets: the felt canvas, the spot hit targets and the card slots are re-laid by `index.ts`
 * when the instance switches variant (`spotVec` and the slot helpers below give the layout for each variant).
 * Eight stools; War uses the first six. Static geometry merges through `kit.finalize`; animated parts are kept out.
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { CardPool, ChipPool, Kit, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import type { Variant } from './rules';

export const TOP = 0.78;                 // felt height, m
export const SEATS = 8;
export const WAR_SEATS = 6;
export const SEAT_Z = 0.64;              // stools (players): a stool reaches ±0.26 m, so z ≤ 0.9 needs SEAT_Z ≤ 0.64
export const DEALER_Z = -0.58;           // the Twin and the head posts (the Twin stays inside z ≥ −0.9)
export const HEAD_Y = 1.05;              // carved heads, centre height
export const HEAD_X = 0.45;              // heads at x = ∓HEAD_X
export const CARD_W = 0.062, CARD_H = 0.088;
export const SHOE_POS = new THREE.Vector3(-1.02, TOP, -0.12);
export const DISCARD_POS = new THREE.Vector3(1.02, TOP, -0.12);
export const PLAQUE_POS = new THREE.Vector3(0, TOP, -0.44);
export const FELT_W = 2.2, FELT_D = 0.84;
export const LACQUER = 0x7a1418;
export const CARD_SLOT_Y = TOP + 0.004;

/** Stool x for seat `i` (0..7, left to right as the player sees the table). */
export const seatX = (i: number): number => (i - 3.5) * 0.3;

/** Spot layout. War: MAIN and TIE boxes in front of the seat. Dragon-Tiger: a 6 × 2 grid of 0.046 m cells per seat. */
export function spotVec(variant: Variant, seat: number, spot: number): THREE.Vector3 {
  const x = seatX(seat);
  if (variant === 'war') return new THREE.Vector3(x, TOP + 0.006, spot === 0 ? 0.34 : 0.24);
  const col = spot % 6, row = Math.floor(spot / 6);
  return new THREE.Vector3(x + (col - 2.5) * 0.046, TOP + 0.006, 0.36 - row * 0.07);
}

/** Card slots. War: one card per seat and one for the dealer, the war cards behind. DT: the Dragon and Tiger slots. */
export const seatCardVec = (seat: number): THREE.Vector3 => new THREE.Vector3(seatX(seat), CARD_SLOT_Y, 0.14);
export const warCardVec = (seat: number): THREE.Vector3 => new THREE.Vector3(seatX(seat) + 0.07, CARD_SLOT_Y + 0.002, 0.02);
export const dealerCardVec = (): THREE.Vector3 => new THREE.Vector3(0, CARD_SLOT_Y, -0.22);
export const dealerWarVec = (seat: number): THREE.Vector3 => new THREE.Vector3(seatX(seat) * 0.6, CARD_SLOT_Y + 0.002, -0.36);
export const dtCardVec = (side: 'D' | 'T'): THREE.Vector3 => new THREE.Vector3(side === 'D' ? -0.36 : 0.36, CARD_SLOT_Y, -0.14);
export const shoeMouth = (): THREE.Vector3 => new THREE.Vector3(SHOE_POS.x + 0.09, TOP + 0.08, SHOE_POS.z);

/** A carved head: root at the post top, jaw hinged at the back (rotation.x opens it), eyes are the winner lamps. */
export interface HeadParts { root: THREE.Group; jaw: THREE.Object3D; eyes: LampPart; smoke: THREE.Object3D }

export type CardwarParts = {
  /** "The Twin": a standing mannequin behind the felt. */
  dealer: MannequinActor;
  /** Stool group (kept out of the static merge): the local seat camera hides it, the stools are the foreground. */
  stools: THREE.Object3D;
  dragon: HeadParts;
  tiger: HeadParts;
  /** Shoe (static), its gauge and the discard stack (scale.y = how full). */
  shoe: THREE.Object3D;
  shoeLevel: THREE.Object3D;
  discardStack: THREE.Object3D;
  cards: CardPool;
  chips: ChipPool;
  /** Felt canvas: WAR boxes per seat, or the Dragon-Tiger grid (drawn by index.ts). */
  felt: ScreenSurface;
  /** Brass variant plaque in the felt corner (clickable while the table is empty). */
  plaque: THREE.Mesh;
  /** History strip (96 × 16): D / T / tie lamps. */
  history: ScreenSurface;
  /** Eight rail meters on the near rail (cosmetic, one per seat). */
  railMeters: THREE.Object3D[];
  seatLamps: LampPart[];
  /** Counting Bead (hidden by default). */
  beadCounter: THREE.Group;
  /** Hit targets per seat × spot (raycast only, transparent). Positions are re-laid per variant. */
  spotHits: THREE.Mesh[][];
  /** Chip anchors per seat × spot. */
  spots: THREE.Object3D[][];
};

/** Puts `id` on the four UV corners of a card plane (the shared atlas, one card per mesh). */
export function setFaceUV(card: THREE.Mesh, kit: Pick<Kit, 'tex'>, id: CardId | 'back'): void {
  const [u0, v0, u1, v1] = kit.tex.cardAtlas().uv(id);
  const uv = card.geometry.getAttribute('uv') as THREE.BufferAttribute;
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
}

function buildHead(kit: KitX, root: THREE.Group, x: number, lacquer: number, accent: number, eyeColor: number, tiger: boolean): HeadParts {
  const { pal } = kit;
  const head = new THREE.Group();
  head.name = tiger ? 'tigerHead' : 'dragonHead';
  head.position.set(x, HEAD_Y, DEALER_Z);
  root.add(head);
  // post from the felt rail up to the head
  kit.cyl(0.03, 0.03, HEAD_Y - TOP, pal.woodDark, { pos: [x, (HEAD_Y + TOP) / 2, DEALER_Z], seg: 6, parent: root });
  kit.box(0.2, 0.18, 0.2, lacquer, { pos: [0, 0, 0], parent: head, bevel: 0.01 });
  // snout (a wedge pointing at the seats) and brow
  kit.cyl(0.0, 0.085, 0.16, lacquer, { pos: [0, -0.02, 0.18], rot: [90, 0, 0], seg: 5, parent: head });
  kit.box(0.22, 0.04, 0.12, accent, { pos: [0, 0.12, 0.04], parent: head });
  // horns or ears
  for (const s of [-1, 1]) {
    kit.cyl(0.0, 0.03, 0.16, accent, { pos: [s * 0.07, 0.18, -0.02], rot: [-20, 0, s * 12], seg: 5, parent: head });
  }
  // fangs
  for (const s of [-1, 1]) kit.cyl(0.0, 0.012, 0.04, pal.cream, { pos: [s * 0.05, -0.1, 0.22], rot: [180, 0, 0], seg: 4, parent: head });
  // stripes for the tiger, a lacquer ring for the dragon
  if (tiger) {
    for (let k = 0; k < 3; k++) kit.box(0.205, 0.02, 0.02, pal.black, { pos: [0, 0.05 - k * 0.05, -0.04], parent: head });
  } else {
    kit.torus(0.08, 0.008, accent, { pos: [0, -0.02, 0.1], rot: [90, 0, 0], seg: 8, parent: head });
  }
  // lower jaw hinged at the back
  const jaw = new THREE.Group();
  jaw.name = tiger ? 'tigerJaw' : 'dragonJaw';
  jaw.position.set(0, -0.09, -0.06);
  head.add(jaw);
  kit.box(0.16, 0.04, 0.2, lacquer, { pos: [0, 0, 0.08], parent: jaw });
  // glass eyes (emissive lamps): the winner's glow
  const eyes = kit.lamp({ r: 0.022, color: eyeColor, shape: 'dome' });
  eyes.root.position.set(0, 0.03, 0.1);
  head.add(eyes.root);
  for (const s of [-1, 1]) {
    const e = kit.lamp({ r: 0.02, color: eyeColor, shape: 'dome' });
    e.root.position.set(s * 0.07, 0.04, 0.1);
    head.add(e.root);
  }
  // nostril smoke: an additive sprite at the snout tip, shown while the head breathes
  const smoke = kit.glow({ color: 0x9a9a9a, size: 0.14, intensity: 0.25 });
  smoke.position.set(0, -0.02, 0.27);
  smoke.visible = false;
  head.add(smoke);
  return { root: head, jaw, eyes, smoke };
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<CardwarParts> {
  const { pal } = kit;
  const root = kit.group('cardwar');
  const black = pal.black;

  // lacquer body 2.40 × 1.10 m, its top at the felt height; black felt panels laid on top
  kit.box(2.4, TOP - 0.06, 1.0, LACQUER, { pos: [0, (TOP - 0.06) / 2, 0], parent: root, bevel: 0.01 });
  kit.box(2.44, 0.03, 1.04, pal.gold, { pos: [0, TOP - 0.075, 0], parent: root });
  const felt = kit.screen({ w: FELT_W, h: FELT_D, px: [460, 176], bezel: black, glow: 0 });
  felt.mesh.position.set(0, TOP + 0.003, 0);
  felt.mesh.rotation.x = -Math.PI / 2;
  root.add(felt.mesh);
  // brass rim on the dealer side
  kit.box(2.4, 0.012, 0.012, pal.brass, { pos: [0, TOP + 0.001, -0.47], parent: root });

  // spot hit targets and chip anchors, 12 per seat (re-laid per variant by index.ts)
  const spotHits: THREE.Mesh[][] = [];
  const spots: THREE.Object3D[][] = [];
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < SEATS; i++) {
    const hits: THREE.Mesh[] = [];
    const anchors: THREE.Object3D[] = [];
    for (let s = 0; s < 12; s++) {
      const p = spotVec('dragontiger', i, s);
      const hit = kit.plane(0.042, 0.06, hitMat, { pos: [p.x, p.y + 0.002, p.z], rot: [-90, 0, 0], name: `spot${i}_${s}`, parent: root });
      hits.push(hit as THREE.Mesh);
      const at = new THREE.Object3D();
      at.position.copy(p).add(new THREE.Vector3(0, 0.02, 0));
      root.add(at);
      anchors.push(at);
    }
    spotHits.push(hits);
    spots.push(anchors);
  }

  // variant plaque: a brass plate with a label, the clickable hit box
  const plaque = kit.box(0.3, 0.012, 0.085, pal.brass, { pos: [PLAQUE_POS.x, PLAQUE_POS.y + 0.006, PLAQUE_POS.z], parent: root, name: 'variantPlaque' });
  const plaqueLabel = kit.label({ text: { key: 'm.cardwar.plaque' }, w: 0.28, h: 0.06, bg: null, color: pal.cream });
  plaqueLabel.mesh.position.set(PLAQUE_POS.x, TOP + 0.014, PLAQUE_POS.z);
  plaqueLabel.mesh.rotation.x = -Math.PI / 2;
  root.add(plaqueLabel.mesh);

  // stools and play poses (camera above the stool, looking down the felt)
  const stoolGroup = new THREE.Group();
  stoolGroup.name = 'stools';
  root.add(stoolGroup);
  const seats: SeatDef[] = [];
  for (let i = 0; i < SEATS; i++) {
    const x = seatX(i);
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(x, 0, SEAT_Z);
    stoolGroup.add(stool);
    seats.push({
      // seat view: one shared framing (camera offset by half the seat x) that takes in the whole felt, both bet rows,
      // the shoe and discard and the Twin's card zone, clear of the top and bottom HUD strips
      pose: { pos: new THREE.Vector3(x * 0.5, 2.00, 1.90), look: new THREE.Vector3(0, 0.95, -0.20), fov: 70, mouse: 'pick' },   // higher and back: the near stool cushions drop below the frame, the felt and Twin stay in it
      stand: new THREE.Vector3(x, 0, SEAT_Z + 0.1),
      avatar: 'sit',
    });
  }

  // the Twin: a standing mannequin behind the felt, between the two heads
  const dealer = kit.mannequin({ style: 'plain', color: 0x2a0a0c, jointColor: 0x141414, height: 1.72, clip: 'Idle_Loop' });
  dealer.root.position.set(0, 0, DEALER_Z);
  root.add(dealer.root);

  // the two carved heads on posts (dragon left at −X, tiger right at +X)
  const dragon = buildHead(kit, root, -HEAD_X, LACQUER, pal.gold, 0xffd040, false);
  const tiger = buildHead(kit, root, HEAD_X, 0x8a5a24, pal.black, 0xffb020, true);

  // shoe with a gauge, discard tray and the cut-card marker
  const shoePart = kit.cardShoe();
  shoePart.root.position.copy(SHOE_POS);
  root.add(shoePart.root);
  const shoeLevel = kit.box(0.02, 0.1, 0.02, pal.brass, { pos: [SHOE_POS.x + 0.13, TOP + 0.05, SHOE_POS.z], parent: root });
  const tray = kit.glass({ w: 0.2, h: 0.03, d: 0.14, tint: pal.glass, opacity: 0.35 });
  tray.position.copy(DISCARD_POS).add(new THREE.Vector3(0, 0.015, 0));
  root.add(tray);
  const discard = kit.box(CARD_W, 0.012, CARD_H, pal.cream, { pos: [DISCARD_POS.x, TOP + 0.006, DISCARD_POS.z], parent: root });
  discard.scale.y = 0.2;

  // rail meters on the near rail (cosmetic), one per seat
  const railMeters: THREE.Object3D[] = [];
  for (let i = 0; i < SEATS; i++) {
    railMeters.push(kit.box(0.02, 0.05, 0.02, pal.brass, { pos: [seatX(i), TOP + 0.03, 0.5], parent: root }));
  }

  // seat lamps on the rail
  const seatLamps: LampPart[] = [];
  for (let i = 0; i < SEATS; i++) {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    l.root.position.set(seatX(i), TOP + 0.01, 0.5);
    seatLamps.push(l);
    root.add(l.root);
  }

  // history strip (96 × 16) on a brass frame at the −X end, facing the seats
  const history = kit.screen({ w: 0.5, h: 0.085, px: [96, 16], bezel: pal.brass, glow: 0.5 });
  history.mesh.position.set(-1.25, 1.12, 0.0);
  history.mesh.rotation.y = Math.PI / 2;
  root.add(history.mesh);

  // Counting Bead (hidden by default): two rods and eleven beads, left of the shoe
  const beadCounter = new THREE.Group();
  beadCounter.name = 'beadCounter';
  beadCounter.position.set(-1.1, TOP, -0.3);
  root.add(beadCounter);
  kit.cyl(0.006, 0.006, 0.26, pal.brass, { pos: [0, 0.14, 0], seg: 5, parent: beadCounter });
  for (let b = 0; b < 11; b++) kit.sphere(0.012, b % 2 === 0 ? pal.brass : pal.chrome, { pos: [0, 0.02 + b * 0.022, 0.025], wSeg: 6, hSeg: 4, parent: beadCounter });
  beadCounter.visible = false;

  // pools (dynamic, kept out of the merge)
  const cards = kit.cards({ max: 24 });
  root.add(cards.root);
  const chips = kit.chips({ max: 360 });
  root.add(chips.root);

  // light and anchors
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, -0.2);
  light.userData = { color: 0xffe2a0, intensity: 0.7, range: 2.8, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, -0.5); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.62, -0.6); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.2, DEALER_Z); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.25, 0.9, 0.2); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.86, 0.1); root.add(coinOut);
  const shoeMouthAnchor = new THREE.Object3D(); shoeMouthAnchor.position.copy(shoeMouth()); root.add(shoeMouthAnchor);

  const parts: CardwarParts = {
    dealer, dragon, tiger, shoe: shoePart.root, shoeLevel, discardStack: discard, cards, chips, felt, plaque,
    history, railMeters, seatLamps, beadCounter, spotHits, spots, stools: stoolGroup,
  };
  crispTexture(felt.tex, 4);                                   // on-machine text: linear + mips, not nearest
  crispTexture(history.tex, 4);
  kit.finalize(root, {
    keep: [
      stoolGroup, dealer.root, felt.mesh, history.mesh, cards.root, chips.root, shoeLevel, discard, light, shoePart.root, tray,
      beadCounter, dragon.root, tiger.root, ...seatLamps.map((l) => l.root), plaque, ...railMeters,
    ],
  });
  return {
    root, parts, seats,
    playPose: seats[3].pose,
    colliders: [
      { min: [-1.22, 0, -0.52], max: [1.22, 0.8, 0.52] },
      { min: [-0.3, 0, DEALER_Z - 0.3], max: [0.3, 1.8, DEALER_Z + 0.3] },
    ],
    interact: { min: [-1.3, 0.2, -1.2], max: [1.3, 1.9, 1.05] },
    anchors: { speaker: prompt, prompt, label, marqueeTop, servicePlate, coinOut, light, shoeMouth: shoeMouthAnchor },
    dispose: () => { felt.dispose(); history.dispose(); },
  };
}
