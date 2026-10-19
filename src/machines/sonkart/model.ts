/**
 * SON KART / LAST CARD — procedural model (owner: sonkart). Party table for 2–4 seats, footprint L (2.6 × 1.8 m).
 *
 *  - A round card table (`partyTable.ts`: felt, padded rail, four legs) with four padded chairs facing the middle. Empty seats
 *    are filled with house mannequins (`kit.mannequin`, plain doll, sitting clip) while a bot holds the seat (`onOccupy` /
 *    `onRelease` in index.ts). A free chair carries a glowing pad.
 *  - `table` pool: the draw pile and the opponents' fanned backs on the felt, and the cards in flight. `top` pool: the face-up
 *    discard in the exact centre, at 1.9x size, inside a colour ring that shows the colour in force. A pointer on the felt
 *    turns to the seat that has the turn; a lamp on the rail in front of that seat blinks.
 *  - `hand` pool: the local player's cards held in first person. `handRoot` lives under the machine root and is
 *    re-posed every frame from the seat camera (`index.ts` `frame`). `hitHand` / `hitDeck` are invisible pick targets;
 *    an unplayable card swaps its pick plane for a dark one (`dimMat`).
 *  - A light bar over the table (colour flash) and a CRT-style screen with the rules sheet on demand.
 *
 * Metres, origin = floor centre, +Z = the front (player side). Everything inside x∈[−1.3,1.3], z∈[−0.9,0.9].
 */
import * as THREE from 'three';
import type { BulbChain, LampPart, MannequinActor, ScreenSurface, StringCardPool } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { buildPartyTable } from './partyTable';
import {
  CARD_H, CARD_W, CARD_Y, CHAIR_H, DECK, FELT_SCALE, FELT_Y, HAND_SCALE, RING_IN, RING_OUT, SEAT_DIR, SIT_FWD, TOP_SCALE,
  chairAt, handSpot,
} from './layout';

export const HAND_MAX = 24;
export const TABLE_MAX = 96;
/** First-person card size and the pick plane that goes with it, metres. */
export const HIT_W = CARD_W * HAND_SCALE;
export const HIT_H = CARD_H * HAND_SCALE;

export type SonKartParts = {
  table: StringCardPool;                 // backs, draw pile and cards in flight on the felt
  top: StringCardPool;                   // the face-up discard top, big, in the exact centre of the felt
  hand: StringCardPool;                  // local viewmodel hand (first person)
  handRoot: THREE.Group;                 // child of the machine root, posed from the camera every frame
  hitHand: THREE.Mesh[];                 // pick targets, one per hand slot (userData.i): invisible, or dark when the card cannot be played
  hitMat: THREE.Material;                // the invisible pick material
  dimMat: THREE.Material;                // the dark one
  hitDeck: THREE.Mesh;                   // pick target over the draw pile
  deckTray: THREE.Mesh;                  // the draw pile's slot (turns gold when drawing is the move)
  seatLamps: LampPart[];                 // one turn light per seat, on the rail
  chairLamps: LampPart[];                // a glowing pad on a free chair
  ring: THREE.MeshBasicMaterial;         // the colour in force, a ring around the top card
  pointer: THREE.Object3D;               // turns to the seat that has the turn
  strip: BulbChain;                      // light bar over the table: colour flashes
  screen: ScreenSurface;                 // round, colour, owed draws, rules sheet
  bots: MannequinActor[];                // house mannequins, one per seat (shown when a bot sits)
  deckSpot: THREE.Vector3;               // table-local draw pile position
  discSpot: THREE.Vector3;               // table-local discard position (the centre)
  handSpots: THREE.Vector3[];            // table-local middle of each seat's fan (opponent backs)
  feltY: number;
  discardAnchor: THREE.Object3D;         // squash target for slams
  coinOut: THREE.Object3D;               // FX origin for wins
};

const FELT = 0x1a7048;
const LAMP_OFF = 0x2a2a2a;
/** The colour ring before a colour is in force (before the deal): a dark felt green. */
export const RING_IDLE = 0x24402f;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<SonKartParts> {
  const { pal } = kit;
  const root = kit.group('sonkart');

  const { seats, chairs } = buildPartyTable(kit, root, FELT);
  const feltY = FELT_Y;
  const deckSpot = new THREE.Vector3(DECK.x, CARD_Y, DECK.z);
  const discSpot = new THREE.Vector3(0, CARD_Y, 0);
  const handSpots = SEAT_DIR.map((_, s) => { const h = handSpot(s); return new THREE.Vector3(h.x, CARD_Y, h.z); });

  // pools: felt cards at 0.9x, the top card at 1.9x, the first-person hand at 0.85x
  const table = kit.cards({ max: TABLE_MAX, atlas: 'sonkart', scale: FELT_SCALE });
  root.add(table.root);
  const top = kit.cards({ max: 8, atlas: 'sonkart', scale: TOP_SCALE });
  root.add(top.root);

  // turn lamps on the rail in front of each seat; a glowing pad on every chair (lit while the chair is free)
  const seatLamps: LampPart[] = [];
  const chairLamps: LampPart[] = [];
  SEAT_DIR.forEach(([dx, dz], s) => {
    const l = kit.lamp({ r: 0.028, color: LAMP_OFF, shape: 'dome' });
    l.root.position.set(dx * 0.495, feltY + 0.046, dz * 0.495);
    root.add(l.root);
    seatLamps.push(l);
    const pad = kit.lamp({ r: 0.07, color: 0xffe9a8, shape: 'flat' });
    pad.root.position.set(chairAt(s).x, CHAIR_H + 0.001, chairAt(s).z);
    root.add(pad.root);
    chairLamps.push(pad);
  });

  // the colour in force: a ring on the felt around the top card (colour set from index.ts); the pointer turns to the seat in play
  const ring = kit.mat({ color: RING_IDLE, lit: false, unique: true }) as THREE.MeshBasicMaterial;
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 32), ring);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(0, feltY + 0.0025, 0);
  ringMesh.name = 'colourRing';
  root.add(ringMesh);
  const arrow = new THREE.Shape();
  arrow.moveTo(0.05, 0); arrow.lineTo(-0.03, 0.035); arrow.lineTo(-0.03, -0.035); arrow.closePath();
  const arrowGeo = new THREE.ShapeGeometry(arrow);
  arrowGeo.rotateX(-Math.PI / 2);
  const arrowMesh = new THREE.Mesh(arrowGeo, kit.mat({ color: 0xffd040, lit: false }));
  arrowMesh.position.set(0.24, feltY + 0.0045, 0);
  const pointer = new THREE.Group();
  pointer.name = 'turnPointer';
  pointer.add(arrowMesh);
  pointer.visible = false;
  root.add(pointer);

  // the draw pile's slot: a brass frame with a darker felt tray (unique material: it turns gold when drawing is the move)
  const discardAnchor = new THREE.Object3D();
  discardAnchor.position.copy(discSpot);
  root.add(discardAnchor);
  const slotW = CARD_W * FELT_SCALE, slotH = CARD_H * FELT_SCALE;
  kit.box(slotW + 0.014, 0.002, slotH + 0.014, pal.brass, { pos: [deckSpot.x, feltY + 0.001, deckSpot.z], parent: root });
  const deckTray = kit.box(slotW + 0.004, 0.003, slotH + 0.004, kit.mat({ color: 0x0d4a2c, unique: true }), { pos: [deckSpot.x, feltY + 0.0015, deckSpot.z], parent: root });
  deckTray.name = 'deckTray';

  // the first-person hand: a pool and a pick plane per slot (invisible, dark when the card cannot be played), all under handRoot
  const handRoot = new THREE.Group();
  handRoot.name = 'handRoot';
  root.add(handRoot);
  const hand = kit.cards({ max: HAND_MAX, atlas: 'sonkart', scale: HAND_SCALE });
  handRoot.add(hand.root);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const dimMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  const hitHand: THREE.Mesh[] = [];
  for (let i = 0; i < HAND_MAX; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HIT_W, HIT_H), hitMat);
    m.rotation.x = -Math.PI / 2;
    m.userData.i = i;
    m.visible = true;
    handRoot.add(m);
    hitHand.push(m);
  }
  const hitDeck = new THREE.Mesh(new THREE.PlaneGeometry(slotW + 0.03, slotH + 0.03), hitMat);
  hitDeck.rotation.x = -Math.PI / 2;
  hitDeck.position.copy(deckSpot).add(new THREE.Vector3(0, 0.02, 0));
  hitDeck.userData.i = -1;
  root.add(hitDeck);

  // light bar over the table (colour flash)
  const strip = kit.lightStrip({ length: 1.5, color: 0xffffff, segments: 8, axis: 'x' });
  strip.root.position.set(0, 1.95, 0);
  root.add(strip.root);

  // screen and sign above the rear rail, on a board between two posts (they used to hang in mid-air)
  kit.box(0.7, 0.58, 0.04, pal.black, { pos: [0, 1.6, -0.9], parent: root, bevel: 0.01 });
  // the board hangs from the ceiling bar on two thin rods (floor posts used to cross the top of the seated view as brown beams)
  kit.box(0.8, 0.03, 0.1, pal.black, { pos: [0, 2.42, -0.9], parent: root });
  for (const px of [-0.3, 0.3]) kit.cyl(0.008, 0.008, 0.52, pal.chrome, { pos: [px, 2.15, -0.9], seg: 5, parent: root });
  // the light bar hangs from a ceiling bar on two rods
  kit.box(1.6, 0.03, 0.1, pal.black, { pos: [0, 2.4, 0], parent: root });
  for (const rx of [-0.7, 0.7]) kit.cyl(0.008, 0.008, 0.45, pal.chrome, { pos: [rx, 2.175, 0], seg: 5, parent: root });
  const screen = kit.screen({ w: 0.56, h: 0.22, px: [256, 112], bezel: pal.black, glow: 0.6 });
  screen.mesh.position.set(0, 1.5, -0.86);
  root.add(screen.mesh);
  const label = kit.label({ text: { key: 'm.sonkart.name' }, w: 0.5, h: 0.09, px: [256, 48], color: pal.gold, bg: pal.black });
  label.mesh.position.set(0, 1.7, -0.86);
  root.add(label.mesh);

  // house mannequins: one per seat, hidden until a bot takes the chair. Plain (never `female`) dark dolls, root on the floor
  // 0.285 m in front of the chair centre (the sitting clips put the pelvis behind the root), facing the middle of the table
  const bots: MannequinActor[] = [];
  SEAT_DIR.forEach(([dx, dz], s) => {
    const m = kit.mannequin({ style: 'plain', color: [0x2a1a14, 0x3a2a1e, 0x1e2a33, 0x2d1f2f][s % 4], jointColor: 0x3a3a3a, height: 1.7, clip: 'Sitting_Idle_Loop' });
    const c = chairs[s];
    m.root.position.set(c.x - dx * SIT_FWD, 0, c.z - dz * SIT_FWD);
    m.root.scale.setScalar(0.95);
    m.root.rotation.y = Math.atan2(-dx, -dz);
    m.setVisible(false);
    root.add(m.root);
    bots.push(m);
  });

  const coinOut = new THREE.Object3D();
  coinOut.position.set(0, feltY + 0.1, 0.3);
  root.add(coinOut);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.2, 0.5);
  root.add(prompt);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.7, -0.86);
  root.add(labelAnchor);
  const light = new THREE.Object3D();
  light.position.set(0, 1.8, 0);
  light.userData = { color: 0xffe2a0, intensity: 1.6, range: 3.2, flicker: 'STEADY' };   // the felt must read from every seat
  root.add(light);

  const parts: SonKartParts = {
    table, top, hand, handRoot, hitHand, hitMat, dimMat, hitDeck, deckTray, seatLamps, chairLamps, ring, pointer, strip, screen, bots,
    deckSpot, discSpot, handSpots, feltY, discardAnchor, coinOut,
  };
  kit.finalize(root, {
    keep: [
      table.root, top.root, handRoot, strip.root, ringMesh, pointer, screen.mesh, label.mesh, deckTray,
      ...seatLamps.map((l) => l.root), ...chairLamps.map((l) => l.root), ...bots.map((b) => b.root), hitDeck,
    ],
  });

  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-0.54, 0, -0.54], max: [0.54, feltY + 0.06, 0.54] },
      ...chairs.map((c) => ({ min: [c.x - 0.24, 0, c.z - 0.24] as [number, number, number], max: [c.x + 0.24, CHAIR_H + 0.5, c.z + 0.24] as [number, number, number], tag: 'solid' as const })),
    ],
    interact: { min: [-1.0, 0.2, -1.0], max: [1.0, 1.6, 1.0] },
    anchors: { speaker: prompt, prompt, label: labelAnchor, coinOut, light, servicePlate: coinOut },
    dispose: () => { screen.dispose(); },
  };
}

/** Light colour for a card colour letter (R Y G B). */
export const COLOUR_HEX: Readonly<Record<string, number>> = { R: 0xff3a3a, Y: 0xffd040, G: 0x40ff70, B: 0x40a0ff, '': 0xffffff };
