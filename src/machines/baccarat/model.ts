/**
 * Baccarat "The Mirror Table" — procedural model (MACHINES_tables §6, ART_BIBLE §5.8, PLAN modelBrief).
 *
 * `buildModel` returns a full `MachineModel`; the exported `BaccaratParts` type is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = the player side, the dealer ("the Banker") sits at −Z.
 *
 * A kidney-shaped felt (2.40 × 1.20 m, top at 0.78 m) with a dent on the player side. Seven stools along +Z; each
 * seat has five spot hit targets (Banker, Player, Tie, Player Pair, Banker Pair). Two large card boxes "PLAYER" and
 * "BANKER" sit on the felt; the shoe is at the dealer's left and the discard tray at his right. The mirror is a
 * 2.0 × 1.0 m panel above the dealer, tilted 35° toward the seats; a chandelier hangs over the middle.
 * The roadmap is a 96 × 48 LED board on a chrome pole at the +X end.
 *
 * Draw budget: static geometry merges through `kit.finalize`. Animated parts and pools are listed in `keep`.
 * Cut for v1 (recorded in the review notes): the per-seat rail meters and the second light per spot.
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { BulbChain, CardPool, ChipPool, Kit, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

export const TOP = 0.78;                 // felt height, m
export const SEATS = 7;
export const SEAT_Z = 0.92;              // stools (players)
export const DEALER_Z = -0.95;           // the Banker's chair
export const CARD_W = 0.062, CARD_H = 0.088;
export const SPOT_Z = 0.34;              // bet spots, a hand's reach from the stools, inside the kidney edge (z ≈ 0.40–0.44)
export const MIRROR_Y = 2.05, MIRROR_Z = -0.80, MIRROR_TILT = 35;

/** Stool x for seat `i` (0..6, left to right as the player sees the table). */
export const seatX = (i: number): number => (i - 3) * 0.3;
/** Spot x offset from the seat centre, in `rules.SP` order: Banker, Player, Tie, Player pair, Banker pair. */
const SPOT_DX = [0.065, -0.065, 0, -0.13, 0.13];
const SPOT_COLOR = [0xc8102e, 0x2c4c9c, 0x3aa655, 0xc9a227, 0xc9a227];
/** Where chips and hit targets of spot `s` at seat `i` sit. */
export const spotPos = (seat: number, spot: number): THREE.Vector3 =>
  new THREE.Vector3(seatX(seat) + SPOT_DX[spot], TOP + 0.006, SPOT_Z);

export const SHOE_POS = new THREE.Vector3(-0.92, TOP, -0.30);
export const DISCARD_POS = new THREE.Vector3(0.92, TOP, -0.30);
export const COMMISSION_POS = new THREE.Vector3(0, TOP, -0.38);
/** Card slots: Player side on the left, Banker on the right, cards fan out to the right of each box. */
export const playerSlot = (idx: number): THREE.Vector3 => new THREE.Vector3(-0.44 + idx * 0.08, TOP + 0.004 + idx * 0.002, -0.06);
export const bankerSlot = (idx: number): THREE.Vector3 => new THREE.Vector3(0.20 + idx * 0.08, TOP + 0.004 + idx * 0.002, -0.06);
export const slotPos = (side: 'P' | 'B', idx: number): THREE.Vector3 => (side === 'P' ? playerSlot(idx) : bankerSlot(idx));
/** Where new cards leave the shoe mouth. */
export const shoeMouth = (): THREE.Vector3 => new THREE.Vector3(SHOE_POS.x + 0.09, TOP + 0.08, SHOE_POS.z);

export type BaccaratParts = {
  /** Seated mannequin "the Banker", top hat, walnut paddle in the right hand. */
  dealer: MannequinActor;
  paddle: THREE.Object3D;
  /** Shoe (static), its gauge and the discard stack (scale.y = how full). */
  shoe: THREE.Object3D;
  shoeLevel: THREE.Object3D;
  discardStack: THREE.Object3D;
  /** Two bendable card meshes (4 segments each) used for the squeeze, shown only while a side is squeezed. */
  squeezeCards: [THREE.Mesh, THREE.Mesh];
  cards: CardPool;
  chips: ChipPool;
  /** Mirror panel, the hidden figure behind a player (1 coup in 40) and the grin decal (Overheat). */
  mirror: THREE.Mesh;
  mirrorFigure: THREE.Object3D;
  mirrorGrin: THREE.Object3D;
  /** 96 × 48 roadmap: Bead Plate 6 × 12 and Big Road 6 × 24 (drawn by index.ts). */
  roadmap: ScreenSurface;
  /** Brass flip tiles: the running totals of each side. */
  totals: { P: ScreenSurface; B: ScreenSurface };
  /** Winner lamps above each card box (Player blue, Banker red). */
  lamps: { player: LampPart; banker: LampPart };
  seatLamps: LampPart[];
  chandelier: BulbChain;
  commissionBox: THREE.Object3D;
  /** Counting Bead (hidden by default). */
  beadCounter: THREE.Group;
  /** Hit targets per seat × spot (raycast only, transparent). */
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

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<BaccaratParts> {
  const { pal } = kit;
  const root = kit.group('baccarat');
  const woodDark = o.variant % 2 ? pal.wood : pal.woodDark;
  const felt = pal.felt;
  const rail = pal.redDark;

  // kidney table: an ellipse with a dent on the player side (outline in shape space: y < 0 is +Z)
  const outline: Array<[number, number]> = [];
  for (let k = 0; k < 40; k++) {
    const t = (k / 40) * Math.PI * 2;
    const x = 1.2 * Math.cos(t);
    let y = 0.6 * Math.sin(t);
    if (y < 0) y += 0.16 * Math.exp(-(x * x) / 0.14);      // the dent pulls the player edge in (+Z)
    outline.push([x, y]);
  }
  const kidneyRot: [number, number, number] = [-90, 0, 0];
  kit.extrude(outline, TOP - 0.07, { color: woodDark, map: kit.tex.wood(woodDark) }, { pos: [0, 0, 0], rot: kidneyRot, parent: root });
  kit.extrude(outline.map(([x, y]) => [x * 1.005, y * 1.005] as [number, number]), 0.06, rail, { pos: [0, TOP - 0.07, 0], rot: kidneyRot, parent: root });
  kit.extrude(outline.map(([x, y]) => [x * 0.97, y * 0.97] as [number, number]), 0.02, { color: felt, map: kit.tex.felt(felt) }, { pos: [0, TOP - 0.01, 0], rot: kidneyRot, parent: root });

  // spot hit targets and the flat outlines (chips sit on them)
  const spotHits: THREE.Mesh[][] = [];
  const spots: THREE.Object3D[][] = [];
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (let i = 0; i < SEATS; i++) {
    const hits: THREE.Mesh[] = [];
    const anchors: THREE.Object3D[] = [];
    for (let s = 0; s < 5; s++) {
      const p = spotPos(i, s);
      kit.plane(0.056, 0.07, SPOT_COLOR[s], { pos: [p.x, TOP + 0.002, p.z], rot: [-90, 0, 0], shade: false, parent: root });
      const hit = kit.plane(0.064, 0.08, hitMat, { pos: [p.x, TOP + 0.008, p.z], rot: [-90, 0, 0], name: `spot${i}_${s}`, parent: root });
      hits.push(hit as THREE.Mesh);
      const at = new THREE.Object3D();
      at.position.copy(p).add(new THREE.Vector3(0, 0.02, 0));
      root.add(at);
      anchors.push(at);
    }
    spotHits.push(hits);
    spots.push(anchors);
  }

  // big card boxes "PLAYER" and "BANKER" with a label each
  kit.plane(0.46, 0.26, pal.black, { pos: [-0.30, TOP + 0.003, -0.06], rot: [-90, 0, 0], shade: false, parent: root });
  kit.plane(0.46, 0.26, pal.black, { pos: [0.34, TOP + 0.003, -0.06], rot: [-90, 0, 0], shade: false, parent: root });
  for (const [x, key] of [[-0.30, 'm.baccarat.boxP'], [0.34, 'm.baccarat.boxB']] as const) {
    const lab = kit.label({ text: { key }, w: 0.4, h: 0.07, bg: null, color: pal.cream });
    lab.mesh.position.set(x, TOP + 0.006, -0.17);
    lab.mesh.rotation.x = -Math.PI / 2;
    root.add(lab.mesh);
  }

  // table rim: a brass strip on the dealer side of the felt
  kit.box(0.92, 0.012, 0.012, pal.brass, { pos: [0, TOP + 0.001, -0.6], parent: root });

  // stools and the play poses (camera above the stool, looking at the felt)
  const seats: SeatDef[] = [];
  for (let i = 0; i < SEATS; i++) {
    const x = seatX(i);
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(x, 0, SEAT_Z);
    root.add(stool);
    seats.push({
      // seat view: high over the stool, steep look-down, so the whole 2.4 x 1.2 m felt, the card boxes and every bet spot sit
      // between the HUD top strip and the control bar at 16:9 and 4:3. The camera drifts only 12 % of the seat offset.
      pose: {
        pos: new THREE.Vector3(x * 0.12, 2.25, 1.1),
        look: new THREE.Vector3(x * 0.12, TOP, -0.05),
        fov: 60, mouse: 'pick',
      },
      stand: new THREE.Vector3(x, 0, SEAT_Z + 0.12),
      avatar: 'sit',
    });
  }

  // the Banker: seated mannequin, chair, top hat, paddle attached to the right hand (dynamic, not merged)
  const chair = kit.chair({ h: 0.46, seat: pal.black, wood: pal.woodDark });
  chair.position.set(0, 0, DEALER_Z);
  root.add(chair);
  const dealer = kit.mannequin({ style: 'plain', color: 0x141414, jointColor: 0x2b2b2b, height: 1.72, clip: 'Sitting_Idle_Loop' });
  dealer.root.position.set(0, 0, DEALER_Z);
  root.add(dealer.root);
  const hatMat = pal.black;
  const hat = new THREE.Group();
  hat.name = 'topHat';
  kit.cyl(0.14, 0.14, 0.012, hatMat, { pos: [0, 0, 0], seg: 10, parent: hat });
  kit.cyl(0.085, 0.085, 0.2, hatMat, { pos: [0, 0.105, 0], seg: 10, parent: hat });
  kit.cyl(0.086, 0.086, 0.03, pal.redDark, { pos: [0, 0.03, 0], seg: 10, parent: hat });
  dealer.attach(hat, 'Head', { pos: [0, 0.2, 0], scale: 1 }); // i18n-ok: bone name
  const paddle = new THREE.Group();
  paddle.name = 'paddle';
  kit.cyl(0.011, 0.011, 0.3, woodDark, { pos: [0, 0, 0.15], rot: [90, 0, 0], seg: 6, parent: paddle });
  kit.box(0.08, 0.012, 0.06, woodDark, { pos: [0, 0, 0.36], parent: paddle });
  dealer.attach(paddle, 'hand_r', { pos: [0, 0, 0.02] });

  // shoe at the dealer's left, discard tray at the right, cut card and the shoe gauge
  const shoePart = kit.cardShoe();
  shoePart.root.position.copy(SHOE_POS);
  root.add(shoePart.root);
  kit.box(0.07, 0.008, CARD_H + 0.01, pal.redDark, { pos: [SHOE_POS.x - 0.05, TOP + 0.01, SHOE_POS.z], parent: root });
  const shoeLevel = kit.box(0.02, 0.1, 0.02, pal.brass, { pos: [SHOE_POS.x + 0.13, TOP + 0.05, SHOE_POS.z], parent: root });
  const tray = kit.glass({ w: 0.2, h: 0.03, d: 0.14, tint: pal.glass, opacity: 0.35 });
  tray.position.copy(DISCARD_POS).add(new THREE.Vector3(0, 0.015, 0));
  root.add(tray);
  const discard = kit.box(CARD_W, 0.012, CARD_H, pal.cream, { pos: [DISCARD_POS.x, TOP + 0.006, DISCARD_POS.z], parent: root });
  discard.scale.y = 0.2;
  // commission box (brass, centre front of the dealer)
  const commissionBox = kit.box(0.16, 0.035, 0.1, pal.brass, { pos: [COMMISSION_POS.x, TOP + 0.017, COMMISSION_POS.z], parent: root, bevel: 0.005 });

  // mirror: dark glass 2.0 × 1.0 m tilted 35° toward the seats, brass frame behind it
  const mirrorMat = new THREE.MeshBasicMaterial({ color: 0x1d3133 });
  const mirror = kit.plane(2.0, 1.0, mirrorMat, { pos: [0, MIRROR_Y, MIRROR_Z], rot: [MIRROR_TILT, 0, 0], shade: false, parent: root }) as THREE.Mesh;
  mirror.name = 'mirror';
  kit.box(2.08, 1.08, 0.03, pal.brass, { pos: [0, MIRROR_Y, MIRROR_Z - 0.02], rot: [MIRROR_TILT, 0, 0], parent: root });
  const mirrorFigure = kit.cyl(0.13, 0.13, 1.5, pal.black, { pos: [0, 0.75, 1.3], seg: 8, parent: root });
  mirrorFigure.name = 'mirrorFigure';
  mirrorFigure.visible = false;
  const mirrorGrin = kit.plane(0.3, 0.18, pal.cream, { pos: [0, MIRROR_Y + 0.05, MIRROR_Z + 0.03], rot: [MIRROR_TILT, 0, 0], shade: false, parent: root });
  mirrorGrin.name = 'mirrorGrin';
  mirrorGrin.visible = false;

  // chandelier: six bulbs on a ring r 0.35 at y 2.30
  const ring: Array<[number, number, number]> = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    ring.push([Math.cos(a) * 0.35, 2.3, Math.sin(a) * 0.35]);
  }
  const chandelier = kit.bulbChain({ path: ring, count: 6, colors: [pal.gold], r: 0.02 });
  root.add(chandelier.root);

  // winner lamps, seat lamps on the rail
  const lamps = {
    player: kit.lamp({ r: 0.03, color: 0x2c4c9c, shape: 'dome' }),
    banker: kit.lamp({ r: 0.03, color: 0xc8102e, shape: 'dome' }),
  };
  lamps.player.root.position.set(-0.30, TOP + 0.02, -0.26);
  lamps.banker.root.position.set(0.34, TOP + 0.02, -0.26);
  root.add(lamps.player.root, lamps.banker.root);
  const seatLamps: LampPart[] = [];
  for (let i = 0; i < SEATS; i++) {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    l.root.position.set(seatX(i), TOP + 0.01, 0.66);
    seatLamps.push(l);
    root.add(l.root);
  }

  // totals (brass flip tiles, two small screens) above the card boxes
  const totalP = kit.screen({ w: 0.12, h: 0.08, px: [32, 24], bezel: pal.brass, scanlines: false });
  totalP.mesh.position.set(-0.30, TOP + 0.09, -0.36);
  totalP.mesh.rotation.x = -0.2;
  const totalB = kit.screen({ w: 0.12, h: 0.08, px: [32, 24], bezel: pal.brass, scanlines: false });
  crispTexture(totalP.tex, 4); crispTexture(totalB.tex, 4);                       // linear + mips: the running totals stay readable from the seat camera
  totalB.mesh.position.set(0.34, TOP + 0.09, -0.36);
  totalB.mesh.rotation.x = -0.2;
  root.add(totalP.mesh, totalB.mesh);

  // roadmap on a chrome pole at the +X end, screen facing the seats
  kit.cyl(0.02, 0.02, 1.6, pal.chrome, { pos: [1.4, 0.8, 0], seg: 8, parent: root });
  const roadmap = kit.screen({ w: 0.5, h: 0.25, px: [96, 48], bezel: pal.black, glow: 0.6, scanlines: false });
  crispTexture(roadmap.tex, 4);
  roadmap.mesh.position.set(1.4, 1.36, 0);
  roadmap.mesh.rotation.y = -Math.PI / 2;
  root.add(roadmap.mesh);

  // Counting Bead (hidden by default): two rods and eleven beads, left of the shoe
  const beadCounter = new THREE.Group();
  beadCounter.name = 'beadCounter';
  beadCounter.position.set(-1.1, TOP, -0.2);
  root.add(beadCounter);
  kit.cyl(0.006, 0.006, 0.26, pal.brass, { pos: [0, 0.14, 0], seg: 5, parent: beadCounter });
  for (let b = 0; b < 11; b++) kit.sphere(0.012, b % 2 === 0 ? pal.brass : pal.chrome, { pos: [0, 0.02 + b * 0.022, 0.025], wSeg: 6, hSeg: 4, parent: beadCounter });
  beadCounter.visible = false;

  // squeeze overlays: two 4-segment strips, positioned on the squeezed side's slots while it is bent
  const cardMat = kit.mat({ map: kit.tex.cardAtlas().tex, lit: false, side: 'double', snap: false, affine: false });
  const squeezeCards = [0, 1].map((k) => {
    const m = kit.plane(CARD_W, CARD_H, cardMat, { rot: [-90, 0, 0], shade: false, segH: 4, name: `squeeze${k}` });
    m.visible = false;
    setFaceUV(m, kit, 'back');
    root.add(m);
    return m;
  }) as [THREE.Mesh, THREE.Mesh];

  // pools (dynamic, kept out of the merge)
  const cards = kit.cards({ max: 12 });
  root.add(cards.root);
  const chips = kit.chips({ max: 300 });
  root.add(chips.root);

  // light and anchors
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, -0.2);
  light.userData = { color: 0xffe2a0, intensity: 0.7, range: 2.8, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, -0.5);
  root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.62, -0.6); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.45, MIRROR_Z); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.05, 0.9, 0.2); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.86, 0.1); root.add(coinOut);
  const mirrorCam = new THREE.Object3D(); mirrorCam.position.set(0, 1.25, 0.85); root.add(mirrorCam);
  const shoeMouthAnchor = new THREE.Object3D(); shoeMouthAnchor.position.copy(shoeMouth()); root.add(shoeMouthAnchor);

  const parts: BaccaratParts = {
    dealer, paddle, shoe: shoePart.root, shoeLevel, discardStack: discard, squeezeCards, cards, chips,
    mirror, mirrorFigure, mirrorGrin, roadmap, totals: { P: totalP, B: totalB }, lamps, seatLamps, chandelier,
    commissionBox, beadCounter, spotHits, spots,
  };
  kit.finalize(root, {
    keep: [
      dealer.root, mirror, mirrorFigure, mirrorGrin, roadmap.mesh, totalP.mesh, totalB.mesh, cards.root, chips.root,
      chandelier.root, lamps.player.root, lamps.banker.root, ...seatLamps.map((l) => l.root), shoeLevel, discard,
      ...squeezeCards, light, shoePart.root, tray, commissionBox, beadCounter,
    ],
  });
  return {
    root, parts, seats,
    playPose: seats[3].pose,
    colliders: [
      { min: [-1.22, 0, -0.62], max: [1.22, 0.8, 0.62] },
      { min: [-0.3, 0, DEALER_Z - 0.3], max: [0.3, 1.6, DEALER_Z + 0.3] },
    ],
    interact: { min: [-1.3, 0.2, -1.1], max: [1.3, 1.6, 1.05] },
    anchors: {
      speaker: prompt, prompt, label, marqueeTop, servicePlate, coinOut, light,
      mirrorCam, shoeMouth: shoeMouthAnchor,
    },
    dispose: () => { roadmap.dispose(); totalP.dispose(); totalB.dispose(); },
  };
}
