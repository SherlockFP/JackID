/**
 * Pişti — procedural model (TableBase party table, 4 seats, 2–4 players).
 *
 * A round felt table (partyTable.ts, chairs 0..3 outside the rim) with a pool for the 52 cards, a face-up table pile
 * in the centre, a deck at dealer-left and per-seat capture piles between the rim and the centre. Each seat has a
 * turn lamp and an invisible pick box row for the first-person hand (the local player picks cards with the mouse).
 * House mannequins (kit.mannequin, sitting) are shown on the seats that hold a bot. A scoreboard screen stands
 * behind the table. Metres, origin = floor centre, +Z = the first seat's side.
 */
import * as THREE from 'three';
import type { CardPool, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { buildPartyTable } from './partyTable';

export const SEATS = 4;
export const HAND_MAX = 4;
const FELT = 0x26805a;
const LAMP_OFF = 0x2a2a2a;
const LAMP_ON = 0xffd040;

export type PistiParts = {
  /** One pool for all 52 cards (each card id sits in exactly one place: deck, hand, table, a pile). */
  cards: CardPool;
  /** Turn lamp per seat. */
  lamps: LampPart[];
  /** Scoreboard over the table: status, deck count, scores. */
  screen: ScreenSurface;
  /** House mannequins, one per seat, hidden until a bot takes the chair. */
  bots: MannequinActor[];
  /** Invisible pick boxes for the local hand (HAND_MAX slots, ordered like the hand). */
  picks: THREE.Mesh[];
  /** Coloured light flash at the table centre (pişti, jack captures). */
  flash: THREE.Sprite;
  /** Seat anchors on the rim (machine-local, y = felt height). */
  seatPos: THREE.Vector3[];
  /** Table centre and deck position (felt height). */
  centre: THREE.Vector3;
  deckPos: THREE.Vector3;
  feltY: number;
};

/** Where seat `s`'s hand slot `k` lies (cards fan along the rim, nearer the centre than the rim). */
export function handSlot(p: PistiParts, s: number, k: number): THREE.Vector3 {
  const a = p.seatPos[s];
  const base = a.clone().multiplyScalar(0.62);
  const tx = -a.z, tz = a.x;                       // tangent along the rim
  const len = Math.hypot(tx, tz) || 1;
  const off = (k - (HAND_MAX - 1) / 2) * 0.095;
  return new THREE.Vector3(base.x + (tx / len) * off, p.feltY + 0.004 + k * 0.002, base.z + (tz / len) * off);
}
/** Capture pile of seat `s` (grows upward a little per card). */
export function pilePos(p: PistiParts, s: number, n: number): THREE.Vector3 {
  const a = p.seatPos[s];
  return new THREE.Vector3(a.x * 0.36, p.feltY + 0.004 + Math.min(n, 40) * 0.0016, a.z * 0.36);
}
/** Spot on the felt for the table pile card `k`. */
export function tableSpot(p: PistiParts, k: number): THREE.Vector3 {
  return new THREE.Vector3(p.centre.x + ((k * 37) % 7 - 3) * 0.008, p.feltY + 0.004 + k * 0.002, p.centre.z + ((k * 53) % 5 - 2) * 0.008);
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<PistiParts> {
  const { pal } = kit;
  const root = kit.group('pisti');

  // the table: round felt (0.46 m), rail and four chairs OUTSIDE it (partyTable.ts); the layout anchors sit on the felt
  const ft = buildPartyTable(kit, root, FELT, SEATS);
  const feltY = ft.feltY;
  const seatPos = ft.anchors;
  const seats: SeatDef[] = ft.seats;

  const centre = new THREE.Vector3(0, feltY + 0.004, 0);
  const deckPos = new THREE.Vector3(-0.26, feltY + 0.004, 0);

  // card pool (52 cards) and turn lamps
  const cards = kit.cards({ max: 56, scale: 1 });
  root.add(cards.root);
  const lamps: LampPart[] = seatPos.map((p) => {
    const l = kit.lamp({ r: 0.022, color: LAMP_OFF, shape: 'dome' });
    l.root.position.set(p.x * 0.92, feltY + 0.012, p.z * 0.92);
    root.add(l.root);
    return l;
  });

  // scoreboard behind the table
  const screen = kit.screen({ w: 0.56, h: 0.22, px: [256, 112], bezel: pal.black, glow: 0.6 });
  screen.mesh.position.set(0, 1.45, -0.92);
  root.add(screen.mesh);
  const label = kit.label({ text: { key: 'm.pisti.name' }, w: 0.5, h: 0.09, px: [256, 48], color: pal.gold, bg: pal.black });
  label.mesh.position.set(0, 1.65, -0.92);
  root.add(label.mesh);

  // house mannequins: sitting, hidden until a bot takes the seat
  const bots: MannequinActor[] = seatPos.map((p, s) => {
    const m = kit.mannequin({ style: 'plain', color: [0x2a1a14, 0x3a2a1e, 0x1e2a33, 0x2d1f2f][s % 4], jointColor: 0x3a3a3a, height: 1.7, clip: 'Sitting_Idle_Loop' });
    const c = ft.chairs[s];
    m.root.position.set(c.x, 0.42, c.z);
    m.root.rotation.y = Math.atan2(-p.x, -p.z);
    m.setVisible(false);
    root.add(m.root);
    return m;
  });

  // invisible pick boxes for the local hand (raycast targets only; the cards are drawn by the pool)
  const pickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const picks: THREE.Mesh[] = [];
  for (let k = 0; k < HAND_MAX; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.12), pickMat);
    m.name = `pick${k}`;
    root.add(m);
    picks.push(m);
  }

  // table flash: additive glow over the centre
  const flash = kit.glow({ color: LAMP_ON, size: 1.1, intensity: 0 });
  flash.position.set(centre.x, feltY + 0.25, centre.z);
  flash.visible = false;
  root.add(flash);

  // deck: a red cut-card marker and the discard-free dealer side
  kit.box(0.07, 0.008, 0.1, pal.redDark, { pos: [deckPos.x, feltY + 0.006, deckPos.z - 0.12], parent: root });

  const coinOut = new THREE.Object3D();
  coinOut.position.set(0, feltY + 0.12, 0.2);
  root.add(coinOut);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, 0.6);
  root.add(prompt);
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, 1.65, -0.92);
  root.add(labelAnchor);
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, 0);
  light.userData = { color: 0xffe2a0, intensity: 1.1, range: 3.2, flicker: 'STEADY' };
  root.add(light);

  // static geometry merges per material; the raycast pick boxes (raw transparent meshes) stay as they are
  kit.finalize(root, { keep: picks });

  const parts: PistiParts = { cards, lamps, screen, bots, picks, flash, seatPos, centre, deckPos, feltY };
  return {
    root,
    parts: parts as unknown as PistiParts,
    playPose: seats[0].pose,
    seats,
    colliders: ft.colliders,
    interact: { min: [-1.0, 0.2, -1.0], max: [1.0, 1.6, 1.0] },
    anchors: { speaker: prompt, prompt, label: labelAnchor, coinOut, light, servicePlate: coinOut },
    dispose: () => { screen.dispose(); pickMat.dispose(); },
  };
}

/** Light colour for a seat lamp. */
export const LAMP = { off: LAMP_OFF, on: LAMP_ON } as const;
