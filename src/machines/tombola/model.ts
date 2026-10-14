/**
 * Tombola Raffle Drum — procedural model (MACHINES_tables §20, plan modelBrief `tombola`). `buildModel` returns a full
 * `MachineModel` and nothing else touches the scene; `TombolaParts` is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = player side.
 *
 * Footprint 2.40 W × 1.20 D × 2.30 H (slot L). A fairground stall: a counter 2.00 × 0.80 × 1.00 under a striped awning,
 * a hexagonal wire drum on an A-frame at the counter's left (axle along X, hatch on the front face) with a crank on its
 * right end, a prize shelf of 20 lit cubbies behind the counter, a ticket roll and a bare bulb. The Ticket Widow is a
 * hand puppet behind the counter. Budget ≤ 1,100 tris.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LampPart, LedPanelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { PlayPose } from '@/core/types';
import { crispTexture } from '@/core/ui/textOverlay';

export interface CubbyPart { lamp: LampPart; icon: ScreenSurface; cell: THREE.Mesh }

export type TombolaParts = {
  /** The wire drum (hexagonal prism, axis along X). Spins about its axle while cranked. */
  drum: THREE.Group;
  /** Hatch door on the drum's front face; swings open on PULL. */
  hatch: THREE.Object3D;
  crank: { root: THREE.Group; handle: THREE.Object3D; turn(rev: number, dur: number): Promise<void> };
  /** 100 folded slips inside the drum (child of `drum`, so they tumble with it). */
  tickets: THREE.InstancedMesh;
  /** The unfolding ticket lying on the counter (64 × 48 number canvas). */
  pulled: ScreenSurface;
  /** The ticket plane itself (hidden until a ticket is held). */
  pulledMesh: THREE.Object3D;
  /** 20 prize cubbies, index = cubby (ticket `5 × index`). */
  cubbies: CubbyPart[];
  leds: { left: LedPanelPart };
  /** Lit while a player is at the drum (queue lamp for the rest). */
  queueLamp: LampPart;
  /** The Widow puppet: root pops up, head shakes, hands clap. */
  widow: { root: THREE.Group; head: THREE.Object3D; handL: THREE.Object3D; handR: THREE.Object3D };
  /** Live-EV needle on the stall board (rotation.z sweeps 0 → 1.2 rad). */
  evNeedle: THREE.Object3D;
  /** Bare bulb over the counter. */
  bulb: LampPart;
};

// ── layout constants (metres, machine-local) ────────────────────────────────────────────────────
export const COUNTER_Y = 1.0, COUNTER_Z = 0.0;
// seat standard: the drum sits on the counter, its top (1.42) under the lowest cubby row so the prize shelf reads clear
export const DRUM_POS: [number, number, number] = [-0.55, 1.22, 0.3];
export const DRUM_R = 0.2, DRUM_LEN = 0.5;
export const CUBBY_X = [-0.8, -0.4, 0.0, 0.4, 0.8];
export const CUBBY_Y = [1.5, 1.72, 1.94, 2.16];
export const CUBBY_Z = -0.5;
export const CUBBY_SIZE = 0.16;
export const WIDOW_POS: [number, number, number] = [0.0, 0.0, -0.22];
/** Widow root height when hidden (her head is below the counter top) and when popped up (head clears the counter). */
export const WIDOW_DOWN_Y = 0.0, WIDOW_UP_Y = COUNTER_Y - 0.36;
export const PULL_POS: [number, number, number] = [0.05, 1.02, 0.3];

/** Deterministic pseudo-random in [0,1) for the ticket pile (no Math.random). */
const hash01 = (i: number, k: number): number => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Cubby cell centre, machine-local. Index 0..19, row-major from the bottom left. */
export function cubbyXYZ(i: number): [number, number, number] {
  const col = i % 5, row = Math.floor(i / 5);
  return [CUBBY_X[col], CUBBY_Y[row], CUBBY_Z];
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<TombolaParts> {
  const { pal } = kit;
  const root = kit.group('tombola');
  const stripe = o.variant % 2 ? 0xb3262e : 0x7a1d1d;
  const at = (x: number, y: number, z: number, parent: THREE.Object3D = root): { pos: [number, number, number]; parent: THREE.Object3D } =>
    ({ pos: [x, y, z], parent });

  // ── counter and back board ──
  kit.box(2.0, 1.0, 0.8, pal.wood, at(0, COUNTER_Y / 2, COUNTER_Z));          // counter body
  kit.box(2.06, 0.04, 0.86, pal.woodDark, at(0, COUNTER_Y + 0.02, COUNTER_Z)); // counter top
  kit.box(2.06, 0.03, 0.03, pal.brass, at(0, COUNTER_Y - 0.1, 0.42));          // brass kick rail
  kit.box(2.0, 1.0, 0.04, pal.woodDark, at(0, 1.5, -0.62));                    // shelf back board
  kit.box(2.0, 0.05, 0.3, pal.woodDark, at(0, COUNTER_Y + 0.02, -0.46));       // shelf ledge

  // ── striped awning (front scallops as alternating boxes) ──
  kit.box(2.2, 0.06, 0.95, pal.cream, at(0, 2.26, 0.0));                       // awning roof
  for (let i = 0; i < 4; i++) {
    const x = -0.8 + i * 0.53;
    kit.box(0.5, 0.05, 0.95, i % 2 ? pal.cream : stripe, at(x, 2.24, 0.0));
    kit.box(0.5, 0.12, 0.04, i % 2 ? pal.cream : stripe, at(x, 2.18, 0.46));  // scallop
  }
  kit.box(0.04, 1.26, 0.04, pal.brass, at(-1.04, 1.63, 0.42));                 // awning posts
  kit.box(0.04, 1.26, 0.04, pal.brass, at(1.04, 1.63, 0.42));

  // ── A-frame and the wire drum ──
  for (const sx of [-0.22, 0.22]) {
    kit.box(0.04, 0.4, 0.04, pal.brass, at(DRUM_POS[0] + sx, COUNTER_Y + 0.2, DRUM_POS[2] + 0.1));
  }
  kit.box(0.5, 0.04, 0.04, pal.brass, at(DRUM_POS[0], COUNTER_Y + 0.12, DRUM_POS[2]));  // frame cross bar

  const drum = new THREE.Group();
  drum.name = 'tombola.drum';
  drum.position.set(DRUM_POS[0], DRUM_POS[1], DRUM_POS[2]);
  root.add(drum);
  // hexagonal wire cage: 6-sided prism lying along X (rot z = 90°)
  kit.cyl(DRUM_R, DRUM_R, DRUM_LEN, pal.chrome, { pos: [0, 0, 0], rot: [0, 0, 90], parent: drum, seg: 6, shade: false });
  kit.cyl(DRUM_R * 0.98, DRUM_R * 0.98, DRUM_LEN * 0.98, pal.steel, { pos: [0, 0, 0], rot: [0, 0, 90], parent: drum, seg: 6, shade: false });
  for (const sx of [-DRUM_LEN / 2, DRUM_LEN / 2]) {
    kit.cyl(0.03, 0.03, 0.02, pal.brass, { pos: [sx, 0, 0], rot: [0, 0, 90], parent: drum, seg: 8 });  // end caps
  }

  // tickets: 100 slips in the drum, deterministic scatter
  const slipGeo = new THREE.BoxGeometry(0.04, 0.002, 0.03);
  const slipMat = kit.mat(0xe8dcc0);
  const tickets = new THREE.InstancedMesh(slipGeo, slipMat, 100);
  tickets.name = 'tombola.tickets';
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 100; i++) {
    const x = (hash01(i, 1) - 0.5) * (DRUM_LEN * 0.8);
    const y = (hash01(i, 2) - 0.5) * (DRUM_R * 1.2);
    const z = (hash01(i, 3) - 0.5) * (DRUM_R * 1.2);
    const e = new THREE.Euler(hash01(i, 4) * 3, hash01(i, 5) * 3, hash01(i, 6) * 3);
    m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
    tickets.setMatrixAt(i, m4);
  }
  tickets.instanceMatrix.needsUpdate = true;
  drum.add(tickets);

  // hatch on the front (+Z) flat of the hex cage
  const hatch = new THREE.Group();
  hatch.position.set(0, 0, DRUM_R * 0.86);
  drum.add(hatch);
  kit.box(0.2, 0.18, 0.02, pal.gold, { pos: [0, 0, 0], parent: hatch });
  kit.box(0.04, 0.04, 0.03, pal.black, { pos: [0.08, 0, 0.01], parent: hatch });

  // crank on the right end of the axle
  const crank = kit.crank({ r: 0.12 });
  crank.root.position.set(DRUM_POS[0] + DRUM_LEN / 2 + 0.04, DRUM_POS[1], DRUM_POS[2]);
  crank.root.rotation.y = Math.PI / 2;
  root.add(crank.root);

  // ── ticket roll dispenser and pulled-ticket face on the counter ──
  kit.cyl(0.06, 0.06, 0.16, 0xb3262e, at(0.78, COUNTER_Y + 0.12, 0.2));
  kit.box(0.2, 0.06, 0.1, pal.black, at(0.78, COUNTER_Y + 0.04, 0.2));

  const pulled = kit.screen({ w: 0.12, h: 0.09, px: [64, 48], bezel: pal.black, glow: 0.2 });
  crispTexture(pulled.tex, 4);                                 // on-machine text: linear + mips, not nearest
  pulled.mesh.position.set(PULL_POS[0], PULL_POS[1], PULL_POS[2]);
  pulled.mesh.rotation.x = -Math.PI / 2;
  pulled.mesh.visible = false;
  root.add(pulled.mesh);

  // ── prize shelf: 20 cubbies (4 rows × 5) ──
  const cubbies: CubbyPart[] = [];
  const cubGeo = new THREE.BoxGeometry(CUBBY_SIZE, CUBBY_SIZE, 0.2);
  const cubMat = kit.mat(0x6a4a2c);                          // lighter warm wood: the cells read against the dark board
  for (let i = 0; i < 20; i++) {
    const [x, y, z] = cubbyXYZ(i);
    const cell = new THREE.Mesh(cubGeo, cubMat);
    cell.position.set(x, y, z);
    root.add(cell);
    const icon = kit.screen({ w: CUBBY_SIZE * 0.78, h: CUBBY_SIZE * 0.78, px: [32, 32], bezel: pal.black, glow: 0.8 });
    crispTexture(icon.tex, 4);
    icon.mesh.position.set(x, y, z + 0.101);
    root.add(icon.mesh);
    const lamp = kit.lamp({ r: 0.02, color: 0x2a2018, shape: 'dome' });
    lamp.root.position.set(x, y + CUBBY_SIZE / 2 + 0.02, z + 0.06);
    root.add(lamp.root);
    cubbies.push({ lamp, icon, cell });
  }

  // ── LED tickets-left counter and queue lamp on the shelf frame ──
  const left = kit.ledPanel({ digits: 3, color: '#ffb347', h: 0.07 });
  left.root.position.set(-0.55, 2.1, -0.46);
  root.add(left.root);
  const queueLamp = kit.lamp({ r: 0.02, color: 0x2a2018, shape: 'flat' });
  queueLamp.root.position.set(0.9, COUNTER_Y + 0.05, 0.38);
  root.add(queueLamp.root);

  // ── live-EV gauge on the board (needle hidden until a milestone shows it) ──
  const evBoard = new THREE.Group();
  evBoard.position.set(0.82, 1.7, -0.6);
  root.add(evBoard);
  kit.cyl(0.11, 0.11, 0.02, pal.black, { pos: [0, 0, 0], rot: [90, 0, 0], parent: evBoard, seg: 16 });
  const evNeedle = new THREE.Group();
  evNeedle.position.set(0, 0, 0.012);
  evBoard.add(evNeedle);
  kit.box(0.01, 0.09, 0.01, pal.gold, { pos: [0, 0.045, 0], parent: evNeedle });
  evBoard.visible = false;

  // ── the Ticket Widow (hand puppet behind the counter) ──
  // Widow-local: body base at y 0, head at 0.5. Hidden = root at WIDOW_DOWN_Y (behind the counter top), popped = WIDOW_UP_Y.
  const widow = new THREE.Group();
  widow.name = 'tombola.widow';
  widow.position.set(WIDOW_POS[0], WIDOW_DOWN_Y, WIDOW_POS[2]);
  root.add(widow);
  kit.lathe([[0.01, 0], [0.12, 0.03], [0.17, 0.2], [0.14, 0.32], [0.04, 0.36]], 8, pal.black, { parent: widow, pos: [0, 0, 0] });
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0);
  widow.add(head);
  kit.sphere(0.11, 0xe9d8c4, { pos: [0, 0, 0], parent: head, wSeg: 8, hSeg: 6 });
  kit.lathe([[0.02, 0.1], [0.12, 0.02], [0.2, -0.12]], 8, 0x14101a, { parent: head, pos: [0, 0.02, -0.02] });  // lace veil
  const handL = kit.sphere(0.035, 0xe9d8c4, { pos: [-0.2, 0.3, 0.12], parent: widow, wSeg: 6, hSeg: 4 });
  const handR = kit.sphere(0.035, 0xe9d8c4, { pos: [0.2, 0.3, 0.12], parent: widow, wSeg: 6, hSeg: 4 });

  // ── bulb and boundary anchors ──
  const bulb = kit.lamp({ r: 0.05, color: 0xffd27a, shape: 'bulb' });
  bulb.root.position.set(0, 2.05, 0.1);
  root.add(bulb.root);

  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.2, 0.5); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.55, 0.5); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.9, 0.44); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 2.3, 0.45); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(-1.02, 1.2, 0.42); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0, 0.95); root.add(stand);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0.5, COUNTER_Y + 0.05, 0.35); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0, 2.0, 0.1);
  light.userData = { color: 0xffd27a, intensity: 0.8, range: 2.5 };
  root.add(light);

  const parts: TombolaParts = {
    drum, hatch, crank, tickets, pulled, pulledMesh: pulled.mesh, cubbies,
    leds: { left }, queueLamp, widow: { root: widow, head, handL, handR }, evNeedle, bulb,
  };
  const keep: Array<THREE.Object3D | { root: THREE.Object3D }> = [
    drum, hatch, crank.root, tickets, pulled.mesh, ...cubbies.flatMap((c) => [c.lamp.root, c.icon.mesh, c.cell]),
    left.root, queueLamp.root, widow, head, handL, handR, evBoard, bulb.root, light,
    speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut,
  ];
  kit.finalize(root, { keep });

  return {
    root,
    parts,
    // seat standard: drum, counter, pull slot and the prize cubbies in frame; the awning top is cropped under the HUD
    playPose: { pos: new THREE.Vector3(0, 1.9, 2.4), look: new THREE.Vector3(0, 1.55, -0.1), fov: 62, mouse: 'pick' } satisfies PlayPose,
    colliders: [
      { min: [-1.0, 0, -0.4], max: [1.0, COUNTER_Y, 0.4] },
      { min: [-1.04, 0, -0.66], max: [1.04, 2.3, -0.6] },
    ],
    interact: { min: [-1.1, 0.2, -0.5], max: [1.1, 2.2, 0.55] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light },
    dispose: () => { pulled.dispose(); cubbies.forEach((c) => c.icon.dispose()); },
  };
}
