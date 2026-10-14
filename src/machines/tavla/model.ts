/**
 * Tavla — procedural model (PAR-03..05 parlour table, footprint L 2.6 × 1.8 m).
 *
 * A long walnut table with a painted board (felt, 24 points, bar, bear-off trays) on top. Two players sit on the long
 * sides, two more at the ends (the queue). Empty seats show a mannequin bot (kit.mannequin, three difficulty colourways)
 * when a bot sits there. Checkers are 30 small discs (15 per side), the doubling cube is a puck with a label, and two
 * dice sit in the middle of the board, rolled by kit.dice. Hit planes (transparent) make the points pickable.
 *
 * Metres, origin = floor centre, +Z = the front side. Board frame: x ∈ [−HW, HW], z ∈ [−HD, HD] at felt height TOP.
 * Points run from the outer edge (|z| = 0.33) to the inner tips (|z| = 0.07); side 0 (white) starts on the near (+z)
 * row, side 1 (black) on the far (−z) row.
 */
import * as THREE from 'three';
import type { DicePool, LabelPart, LampPart, MannequinActor, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export const TOP = 0.76;                       // felt height, m
export const HW = 0.75, HD = 0.4;              // board plane half sizes
export const BODY_W = 2.0, BODY_D = 0.9;       // walnut body
export const SEATS = 4;
export const PIECE_R = 0.03, PIECE_H = 0.014;
const BAR_HALF = 0.04;
const SP = (0.66 - BAR_HALF) / 6;               // point spacing
const BASE_Z = 0.33, TIP_Z = 0.07;
const BAR_Z = 0.13;                             // bar stacks of side 0 at +BAR_Z, side 1 at −BAR_Z
const OFF_X = 0.9;                              // bear-off trays
const OFF_Z = 0.24;

/** Stool / seat positions: 0 and 1 are the match players, 2 and 3 wait in the queue. */
export const SEAT_XZ: Array<[number, number]> = [[0.5, 0.82], [-0.5, -0.82], [-0.5, 0.82], [0.5, -0.82]];

/** Absolute board point 1..24 → floor position on the points (checker slot 0 at the base). */
export function pointXZ(p: number): { x: number; z: number; front: boolean } {
  const front = p <= 12;                        // near (+z) row: points 1..12; far (−z) row: 13..24
  let x: number;
  if (p <= 6) x = BAR_HALF + (6 - p + 0.5) * SP;          // near-right: 6 at the bar … 1 at the edge
  else if (p <= 12) x = -(BAR_HALF + (p - 7 + 0.5) * SP); // near-left: 7 at the bar … 12 at the edge
  else if (p <= 18) x = -(BAR_HALF + (18 - p + 0.5) * SP);// far-left: 18 at the bar … 13 at the edge
  else x = BAR_HALF + (p - 19 + 0.5) * SP;                // far-right: 19 at the bar … 24 at the edge
  return { x, z: front ? BASE_Z : -BASE_Z, front };
}

/** Stack position of the k-th checker on point p (y on top of the felt). */
export function stackAt(p: number, k: number): THREE.Vector3 {
  const q = pointXZ(p);
  const inward = q.front ? -1 : 1;
  return new THREE.Vector3(q.x, TOP + 0.007 + k * PIECE_H * 1.02, q.z + inward * 0.035);
}
export function barAt(side: number, k: number): THREE.Vector3 {
  return new THREE.Vector3(0, TOP + 0.007 + k * PIECE_H * 1.02, side === 0 ? BAR_Z : -BAR_Z);
}
export function offAt(side: number, k: number): THREE.Vector3 {
  return new THREE.Vector3(OFF_X, TOP + 0.007 + k * PIECE_H * 1.02, side === 0 ? OFF_Z : -OFF_Z);
}
/** Dice rest spots and the roll start (above the cup). */
export const DICE_REST: THREE.Vector3[] = [new THREE.Vector3(-0.2, TOP + 0.026, 0.0), new THREE.Vector3(-0.12, TOP + 0.026, 0.0)];
export const DICE_FROM = new THREE.Vector3(-0.16, TOP + 0.45, -0.02);
/** Cube puck rests: centred (owner −1) by the left edge, or on a side's half (owner 0 near, 1 far). */
export function cubeAt(owner: number): THREE.Vector3 {
  return new THREE.Vector3(-0.86, TOP + 0.01, owner === 0 ? 0.24 : owner === 1 ? -0.24 : 0);
}

export type TavlaParts = {
  dice: DicePool;
  cube: THREE.Group;
  cubeLabel: LabelPart;
  /** 30 checkers: indices 0..14 side 0, 15..29 side 1. `userData.side`, `userData.d` (distance, 25 bar, 0 off). */
  pieces: THREE.Mesh[];
  /** Pickable planes: `userData.p` (point 1..24) · `userData.bar` (side) · `userData.off` (side). */
  hits: THREE.Mesh[];
  /** Legal-target rings shown while a checker is picked (12 pooled). */
  markers: THREE.Mesh[];
  /** Score / status screen over the far end of the table. */
  score: ScreenSurface;
  /** One mannequin per seat, shown when a bot sits there. */
  bots: MannequinActor[];
  /** Turn lamp (lit while a roll or move is pending). */
  turnLamp: LampPart;
};

const COL = { felt: 0x1e5a3c, feltDark: 0x123524, wood: 0x3a2214, woodDark: 0x2a170c, cream: 0xd8c08a, red: 0x7d2b1f,
  line: 0xe9dcb0, text: 0xf2e6c4, gold: 0xffd040 };
const PIECE_LIGHT = 0xe9e0c8, PIECE_DARK = 0x2b1d16;
/** Bot colourways per level 1..3: wood doll, porcelain, shadow. */
export const BOT_TINT: Record<number, number> = { 1: 0x8a6a4a, 2: 0xe6dcc8, 3: 0x2c2c33 };
export const BOT_STYLE: Record<number, 'plain' | 'porcelain' | 'shadow'> = { 1: 'plain', 2: 'porcelain', 3: 'shadow' };

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function paintBoard(g: CanvasRenderingContext2D, w: number, h: number): void {
  const colX = (x: number): number => ((x + HW) / (2 * HW)) * w;
  const rowZ = (z: number): number => ((z + HD) / (2 * HD)) * h;
  g.fillStyle = hex(COL.wood); g.fillRect(0, 0, w, h);
  const m = 0.05;
  g.fillStyle = hex(COL.felt);
  g.fillRect(colX(-HW + m), rowZ(-HD + m), colX(HW - m) - colX(-HW + m), rowZ(HD - m) - rowZ(-HD + m));
  // bar
  g.fillStyle = hex(COL.woodDark);
  g.fillRect(colX(-BAR_HALF), rowZ(-HD + m), colX(BAR_HALF) - colX(-BAR_HALF), rowZ(HD - m) - rowZ(-HD + m));
  // points: alternating triangles from the base edge to the tip
  for (let p = 1; p <= 24; p++) {
    const q = pointXZ(p);
    const base = q.front ? BASE_Z : -BASE_Z, tip = q.front ? TIP_Z : -TIP_Z;
    g.beginPath();
    g.moveTo(colX(q.x - SP / 2), rowZ(base));
    g.lineTo(colX(q.x + SP / 2), rowZ(base));
    g.lineTo(colX(q.x), rowZ(tip));
    g.closePath();
    g.fillStyle = hex(p % 2 ? COL.cream : COL.red);
    g.fill();
    g.fillStyle = hex(COL.text);
    g.font = `${Math.round(h * 0.045)}px monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(p), colX(q.x), rowZ(q.front ? BASE_Z + 0.05 : -BASE_Z - 0.05));
  }
  // bear-off trays
  for (const side of [0, 1]) {
    g.fillStyle = hex(COL.woodDark);
    const z = side === 0 ? OFF_Z : -OFF_Z;
    g.fillRect(colX(OFF_X - 0.06), rowZ(z - 0.12), colX(OFF_X + 0.06) - colX(OFF_X - 0.06), rowZ(z + 0.12) - rowZ(z - 0.12));
  }
  g.strokeStyle = hex(COL.line); g.lineWidth = 3;
  g.strokeRect(colX(-HW + m), rowZ(-HD + m), colX(HW - m) - colX(-HW + m), rowZ(HD - m) - rowZ(-HD + m));
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<TavlaParts> {
  const { pal } = kit;
  const root = kit.group('tavla');
  const woodDark = o.variant % 2 ? pal.wood : pal.woodDark;

  // table body and the painted top
  kit.box(BODY_W, TOP - 0.04, BODY_D, { color: woodDark, map: kit.tex.wood(woodDark) },
    { pos: [0, (TOP - 0.04) / 2, 0], parent: root, bevel: 0.02 });
  kit.box(BODY_W + 0.04, 0.035, BODY_D + 0.04, pal.brass, { pos: [0, TOP - 0.0175, 0], parent: root, bevel: 0.005 });
  const boardTex = kit.tex.canvas(1200, 640, (g, w, h) => paintBoard(g, w, h), { key: 'tavla:board' });
  kit.plane(HW * 2, HD * 2, { color: 0xffffff, map: boardTex }, { pos: [0, TOP + 0.002, 0], rot: [-90, 0, 0], parent: root });

  // pickable planes (transparent): 24 points, two bars, two bear-off trays
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hits: THREE.Mesh[] = [];
  const hitPlane = (w: number, d: number, x: number, z: number, data: Record<string, number>): void => {
    const m = kit.plane(w, d, hitMat, { pos: [x, TOP + 0.012, z], rot: [-90, 0, 0], parent: root });
    m.userData = { ...data };
    hits.push(m);
  };
  for (let p = 1; p <= 24; p++) {
    const q = pointXZ(p);
    hitPlane(SP * 0.96, 0.27, q.x, q.front ? 0.2 : -0.2, { p });
  }
  hitPlane(0.08, 0.2, 0, 0.2, { bar: 0 });
  hitPlane(0.08, 0.2, 0, -0.2, { bar: 1 });
  hitPlane(0.14, 0.2, OFF_X, OFF_Z, { off: 0 });
  hitPlane(0.14, 0.2, OFF_X, -OFF_Z, { off: 1 });

  // checkers (dynamic: kept out of the static merge)
  const piecesGroup = new THREE.Group();
  piecesGroup.name = 'checkers';
  root.add(piecesGroup);
  const pieces: THREE.Mesh[] = [];
  for (let i = 0; i < 30; i++) {
    const side = i < 15 ? 0 : 1;
    const m = kit.cyl(PIECE_R, PIECE_R, PIECE_H, side === 0 ? PIECE_LIGHT : PIECE_DARK, { seg: 8, parent: piecesGroup });
    m.userData = { side, d: 0, piece: true };
    m.visible = false;
    pieces.push(m);
  }

  // dice and the doubling cube
  const dice = kit.dice({ count: 2, size: 0.05, body: 0xf1ead8, pip: 0x2b1d16 });
  dice.dice.forEach((m, i) => { m.position.copy(DICE_REST[i]); root.add(m); });
  const cube = new THREE.Group();
  cube.name = 'cube';
  const puck = kit.cyl(0.026, 0.026, 0.014, 0x9a1c24, { seg: 8, parent: cube });
  void puck;
  const cubeLabel = kit.label({ text: '1', w: 0.04, h: 0.04, bg: 0x9a1c24, color: 0xffe9a8, px: [64, 64] });
  cubeLabel.mesh.rotation.x = -Math.PI / 2;
  cubeLabel.mesh.position.y = 0.0075;
  cube.add(cubeLabel.mesh);
  cube.position.copy(cubeAt(-1));
  root.add(cube);

  // move-target markers
  const markers: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const mk = kit.torus(0.034, 0.004, pal.gold, { pos: [0, TOP + 0.01, 0], rot: [90, 0, 0], seg: 8, parent: root });
    mk.visible = false;
    markers.push(mk);
  }

  // score screen over the far end
  const score = kit.screen({ w: 1.0, h: 0.24, px: [384, 96], bezel: pal.black, glow: 0.6 });
  score.mesh.position.set(0, 1.5, -0.86);
  root.add(score.mesh);
  kit.box(1.06, 0.3, 0.03, pal.black, { pos: [0, 1.5, -0.88], parent: root, bevel: 0.01 });
  const turnLamp = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
  turnLamp.root.position.set(0.6, 1.7, -0.86);
  root.add(turnLamp.root);

  // seats: stools, camera poses and a mannequin bot per seat
  const seats: SeatDef[] = [];
  const bots: MannequinActor[] = [];
  for (let i = 0; i < SEATS; i++) {
    const [sx, sz] = SEAT_XZ[i];
    const stool = kit.stool({ h: 0.68 });
    stool.position.set(sx, 0, sz);
    root.add(stool);
    seats.push({
      pose: {
        pos: new THREE.Vector3(sx * 1.08, 1.2, sz * 1.08),
        look: new THREE.Vector3(0, TOP, 0),
        fov: 60, mouse: 'pick',
      },
      stand: new THREE.Vector3(sx, 0, sz),
      avatar: 'sit',
      standY: 0.68,
    });
    const bot = kit.mannequin({ style: 'plain', color: 0x8a6a4a, jointColor: 0x3a3a3a, height: 1.75, clip: 'Sitting_Idle_Loop' });
    bot.root.position.set(sx, 0, sz);
    bot.root.rotation.y = Math.atan2(-sx, -sz);      // face the board centre
    bot.setVisible(false);
    root.add(bot.root);
    bots.push(bot);
  }

  // light and anchors
  const light = new THREE.Object3D();
  light.position.set(0, 2.1, 0);
  light.userData = { color: 0xffe2a0, intensity: 0.8, range: 3.0, flicker: 'STEADY' };
  root.add(light);
  const mk = (x: number, y: number, z: number): THREE.Object3D => { const a = new THREE.Object3D(); a.position.set(x, y, z); root.add(a); return a; };
  const prompt = mk(0, 1.25, 0);
  const speaker = mk(0, TOP + 0.05, 0.4);
  const label = mk(0, 1.6, -0.86);
  const marqueeTop = mk(0, 1.8, -0.86);
  const servicePlate = mk(1.1, 0.9, 0.2);
  const coinOut = mk(OFF_X, TOP + 0.05, 0);

  kit.finalize(root, {
    keep: [piecesGroup, ...dice.dice, cube, ...hits, ...markers, score.mesh, turnLamp.root, ...bots.map((b) => b.root)],
  });

  return {
    root,
    parts: { dice, cube, cubeLabel, pieces, hits, markers, score, bots, turnLamp },
    seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-BODY_W / 2, 0, -BODY_D / 2], max: [BODY_W / 2, TOP + 0.05, BODY_D / 2] },
    ],
    interact: { min: [-1.1, 0.2, -1.1], max: [1.1, 1.8, 1.1] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, light, coinOut },
    dispose: () => { score.dispose(); },
  };
}
