/**
 * SON KART / LAST CARD — procedural model (owner: sonkart). Party table for 2–4 seats, footprint L (2.6 × 1.8 m).
 *
 *  - A round felt table (`kit.feltTable`, top at `feltY`) with four chairs. Empty seats are filled with house
 *    mannequins (`kit.mannequin`, sitting clip) while a bot holds the seat (`onOccupy` / `onRelease` in index.ts).
 *  - `table` pool: face-down backs fanned in front of each opponent, the draw pile and the face-up discard top.
 *  - `hand` pool: the local player's cards held in first person. `handRoot` lives under the machine root and is
 *    re-posed every frame from the seat camera (`index.ts` `frame`). `hitHand` / `hitDeck` are invisible pick targets.
 *  - A colour lamp on the felt, a light bar over the table (colour flash), a seat lamp per chair (turn light) and a
 *    CRT-style screen with the rules sheet on demand.
 *
 * Metres, origin = floor centre, +Z = the front (player side). Everything inside x∈[−1.3,1.3], z∈[−0.9,0.9].
 */
import * as THREE from 'three';
import type { BulbChain, LampPart, MannequinActor, ScreenSurface, StringCardPool } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { buildPartyTable } from './partyTable';

export const HAND_MAX = 24;
export const TABLE_MAX = 96;
/** Card size on the felt (matches the kit card pools), metres. */
export const CARD_W = 0.062;
export const CARD_H = 0.088;
export const HIT_W = 0.07;
export const HIT_H = 0.1;

export type SonKartParts = {
  table: StringCardPool;                 // backs, draw pile and discard top on the felt
  hand: StringCardPool;                  // local viewmodel hand (first person)
  handRoot: THREE.Group;                 // child of the machine root, posed from the camera every frame
  hitHand: THREE.Mesh[];                 // invisible pick targets, one per hand slot (userData.i)
  hitDeck: THREE.Mesh;                   // pick target over the draw pile
  seatLamps: LampPart[];                 // one turn light per seat
  colLamp: LampPart;                     // the active colour, centre of the felt
  strip: BulbChain;                      // light bar over the table: colour flashes
  screen: ScreenSurface;                 // round, colour, owed draws, rules sheet
  bots: MannequinActor[];                // house mannequins, one per seat (shown when a bot sits)
  deckSpot: THREE.Vector3;               // table-local draw pile position
  discSpot: THREE.Vector3;               // table-local discard position
  handSpots: THREE.Vector3[];            // table-local spot in front of each seat (opponent backs)
  feltY: number;
  discardAnchor: THREE.Object3D;         // squash target for slams
  coinOut: THREE.Object3D;               // FX origin for wins
};

const FELT = 0x1a7048;
const LAMP_OFF = 0x2a2a2a;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<SonKartParts> {
  const { pal } = kit;
  const root = kit.group('sonkart');

  // the table: round felt (0.46 m), rail and four chairs OUTSIDE it (partyTable.ts); the layout anchors sit on the felt
  // the shared party table is shrunk 0.8× across x/z (heights kept) so its chairs stay inside the L footprint (z ±0.9)
  // and out of the stand strip in front of the machine; anchors, stands and colliders follow the same scale
  const TABLE_XZ = 0.75;
  const tg = new THREE.Group();
  tg.name = 'partyTable';
  tg.scale.set(TABLE_XZ, 1, TABLE_XZ);
  root.add(tg);
  const ft = buildPartyTable(kit, tg, FELT, 4);
  tg.updateMatrixWorld(true);
  const feltY = ft.feltY;
  const seats: SeatDef[] = ft.seats.map((s) => ({ ...s, stand: new THREE.Vector3(s.stand.x * TABLE_XZ, s.stand.y, s.stand.z * TABLE_XZ) }));
  const anchors = ft.anchors.map((p) => new THREE.Vector3(p.x * TABLE_XZ, p.y, p.z * TABLE_XZ));
  const chairAt = ft.chairs.map((c) => new THREE.Vector3(c.x * TABLE_XZ, c.y, c.z * TABLE_XZ));

  const deckSpot = new THREE.Vector3(-0.2, feltY + 0.004, 0);
  const discSpot = new THREE.Vector3(0.12, feltY + 0.004, 0);
  const handSpots = anchors.map((p) => new THREE.Vector3(p.x * 0.5, feltY + 0.004, p.z * 0.5));

  // table pool: the felt cards (backs, deck, discard top) and the seat turn lamps
  const table = kit.cards({ max: TABLE_MAX, atlas: 'sonkart' });
  root.add(table.root);
  const seatLamps: LampPart[] = [];
  anchors.forEach((p) => {
    const l = kit.lamp({ r: 0.022, color: LAMP_OFF, shape: 'dome' });
    l.root.position.set(p.x * 0.8, feltY + 0.012, p.z * 0.8);
    root.add(l.root);
    seatLamps.push(l);
  });
  const colLamp = kit.lamp({ r: 0.05, color: 0xffffff, shape: 'dome' });
  colLamp.root.position.set(-0.36, feltY + 0.02, 0);
  root.add(colLamp.root);

  // discard + draw pile markers (glass tray under the draw pile, a red cut plate on the discard)
  const discardAnchor = new THREE.Object3D();
  discardAnchor.position.copy(discSpot);
  root.add(discardAnchor);
  const deckTray = kit.box(0.14, 0.012, 0.18, pal.redDark, { pos: [deckSpot.x, feltY + 0.006, deckSpot.z], parent: root });
  deckTray.name = 'deckTray';

  // the first-person hand: a pool and an invisible hit plane per slot, all under handRoot
  const handRoot = new THREE.Group();
  handRoot.name = 'handRoot';
  root.add(handRoot);
  const hand = kit.cards({ max: HAND_MAX, atlas: 'sonkart' });
  handRoot.add(hand.root);
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hitHand: THREE.Mesh[] = [];
  for (let i = 0; i < HAND_MAX; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HIT_W, HIT_H), hitMat);
    m.rotation.x = -Math.PI / 2;
    m.userData.i = i;
    m.visible = true;
    handRoot.add(m);
    hitHand.push(m);
  }
  const hitDeck = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), hitMat);
  hitDeck.rotation.x = -Math.PI / 2;
  hitDeck.position.copy(deckSpot).add(new THREE.Vector3(0, 0.02, 0));
  hitDeck.userData.i = -1;
  root.add(hitDeck);

  // light bar over the table (colour flash) and the colour lamp
  const strip = kit.lightStrip({ length: 1.5, color: 0xffffff, segments: 8, axis: 'x' });
  strip.root.position.set(0, 1.95, 0);
  root.add(strip.root);

  // screen and sign above the rear rail, on a board between two posts (they used to hang in mid-air)
  kit.box(0.7, 0.58, 0.04, pal.black, { pos: [0, 1.6, -0.9], parent: root, bevel: 0.01 });
  for (const px of [-0.4, 0.4]) kit.box(0.05, 1.9, 0.05, pal.woodDark, { pos: [px, 0.95, -0.9], parent: root });
  // the light bar hangs from a ceiling bar on two rods
  kit.box(1.6, 0.03, 0.1, pal.black, { pos: [0, 2.4, 0], parent: root });
  for (const rx of [-0.7, 0.7]) kit.cyl(0.008, 0.008, 0.45, pal.chrome, { pos: [rx, 2.175, 0], seg: 5, parent: root });
  const screen = kit.screen({ w: 0.56, h: 0.22, px: [256, 112], bezel: pal.black, glow: 0.6 });
  screen.mesh.position.set(0, 1.5, -0.86);
  root.add(screen.mesh);
  const label = kit.label({ text: { key: 'm.sonkart.name' }, w: 0.5, h: 0.09, px: [256, 48], color: pal.gold, bg: pal.black });
  label.mesh.position.set(0, 1.7, -0.86);
  root.add(label.mesh);

  // house mannequins: one per seat, hidden until a bot takes the chair
  const bots: MannequinActor[] = [];
  anchors.forEach((p, s) => {
    const m = kit.mannequin({ style: 'plain', color: [0x2a1a14, 0x3a2a1e, 0x1e2a33, 0x2d1f2f][s % 4], jointColor: 0x3a3a3a, height: 1.7, clip: 'Sitting_Idle_Loop' });
    const c = chairAt[s];
    m.root.position.set(c.x, 0.42, c.z);
    m.root.scale.setScalar(0.8);   // the seated figure (arms out) is ±0.4 m: scaled to keep the table inside z ±0.9
    m.root.rotation.y = Math.atan2(-p.x, -p.z);
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
  light.position.set(0, 2.1, 0);
  light.userData = { color: 0xffe2a0, intensity: 1.1, range: 3.2, flicker: 'STEADY' };
  root.add(light);

  const parts: SonKartParts = {
    table, hand, handRoot, hitHand, hitDeck, seatLamps, colLamp, strip, screen, bots,
    deckSpot, discSpot, handSpots, feltY, discardAnchor, coinOut,
  };
  kit.finalize(root, {
    keep: [
      table.root, handRoot, strip.root, colLamp.root, screen.mesh, label.mesh, deckTray,
      ...seatLamps.map((l) => l.root), ...bots.map((b) => b.root), hitDeck,
    ],
  });

  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-0.45, 0, -0.45], max: [0.45, feltY + 0.06, 0.45] },
      ...chairAt.map((c) => ({ min: [c.x - 0.2, 0, c.z - 0.2] as [number, number, number], max: [c.x + 0.2, 0.96, c.z + 0.2] as [number, number, number], tag: 'solid' as const })),
    ],
    interact: { min: [-1.0, 0.2, -1.0], max: [1.0, 1.6, 1.0] },
    anchors: { speaker: prompt, prompt, label: labelAnchor, coinOut, light, servicePlate: coinOut },
    dispose: () => { screen.dispose(); },
  };
}

/** Light colour for a card colour letter (R Y G B). */
export const COLOUR_HEX: Readonly<Record<string, number>> = { R: 0xff3a3a, Y: 0xffd040, G: 0x40ff70, B: 0x40a0ff, '': 0xffffff };
