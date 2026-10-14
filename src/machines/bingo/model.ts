/**
 * Bingo "Hall of Calls" — procedural model (MACHINES_tables §18, plan modelBrief `bingo`, ART_BIBLE). `buildModel`
 * returns a full `MachineModel`; `BingoParts` is the contract with `index.ts`. Metres, origin = floor centre of the
 * footprint, +Z = player side (the desks), the Caller booth at the back-left (−X, −Z).
 *
 * Footprint 4.60 W × 2.50 D × 2.60 H (XL slot). Caller booth: dais, wire cage on a pole (pivot `cage`), crank, 75 balls
 * (`cageBalls`), chute anchor `ballPop`, ball display and ball count LED, and the Caller mannequin (`caller`). Flash board
 * 2.00 × 1.00 at the back wall with 75 lamps in B·I·N·G·O columns (`board`, instance n−1 = number n). Eight daub desks in
 * two rows of four, each with four card planes (`cards`, canvas per card), a dauber, a "1 TO GO" lamp and a rail meter.
 * Budget ≤ 1,800 tris, ≤ 24 draws.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { BallPool, DealerPart, LampPart, LedPanelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import type { SeatDef } from '@/core/types';
import { makeCanvas } from '@/core/texgen/pixel';

type CrankPart = ReturnType<KitX['crank']>;

export interface BingoDesk {
  /** Four card planes (0.20 × 0.24 m). The index draws each card's grid and daubs on its canvas. */
  cards: THREE.Mesh[];
  cardCanvas: HTMLCanvasElement[];
  cardTex: THREE.CanvasTexture[];
  /** Dauber group (cylinder with a P43 magenta cap). Moves to the daubed cell when stamping. */
  dauber: THREE.Group;
  /** Amber "1 TO GO" lamp (#FFB000). */
  oneToGo: LampPart;
  /** Rail meter, lit while the seat holds cards. */
  rail: LampPart;
}

export type BingoParts = {
  /** Pivot of the wire cage (rotates about its horizontal axle). */
  cage: THREE.Object3D;
  /** Crank handle on the cage side. */
  crank: CrankPart;
  /** 75 wooden balls inside the cage. */
  cageBalls: BallPool;
  /** Chute anchor where the called ball appears. */
  ballPop: THREE.Object3D;
  /** Called-ball display ("B-12"). */
  ballDisplay: ScreenSurface;
  /** Ball-count LED (2 digits). */
  leds: { balls: LedPanelPart };
  /** 75 flash-board lamps, instance `n-1` = number n. Colour via `setLamp`. */
  board: THREE.InstancedMesh;
  /** B·I·N·G·O backdrop behind the lamps (2.00 × 1.00). */
  boardScreen: ScreenSurface;
  /** The Caller mannequin behind the cage. */
  caller: DealerPart;
  /** Eight desks, left to right, back row first (0–3) then front row (4–7). */
  desks: BingoDesk[];
  /** Two caged ceiling bulbs (DYING). */
  bulbs: LampPart[];
  light: THREE.Object3D;
  light2: THREE.Object3D;
  /** Caller camera anchor (V key). */
  callerCam: THREE.Object3D;
};

// ── layout (metres, machine-local) ──────────────────────────────────────────────────────────────
export const HALF_W = 2.3, HALF_D = 1.25, CEIL_H = 2.6;
export const DESK_X: readonly number[] = [-1.65, -0.55, 0.55, 1.65];
export const DESK_ROW_Z: readonly number[] = [-0.2, 0.75];
export const DESK_TOP = 0.75;
export const CAGE_POS: readonly [number, number, number] = [-1.3, 1.22, -0.62];
export const BOARD_POS: readonly [number, number, number] = [-1.3, 1.9, -1.19];
const BOARD_W = 2.0, BOARD_H = 1.0;
const DAIS_POS: readonly [number, number, number] = [-1.3, 0.125, -0.9];
const DAIS_SIZE: readonly [number, number, number] = [1.3, 0.25, 0.7];
const CALLER_POS: readonly [number, number, number] = [-1.3, 0.25, -0.92];
const CARD_W = 0.2, CARD_H = 0.24;
const CARD_TEX_W = 240, CARD_TEX_H = 288;   // 6 px per design unit of the 40 x 48 card layout (index.ts drawCard): crisp numerals at native size
const CARD_OFFS: ReadonlyArray<readonly [number, number]> = [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]];
const BENCH_DZ = 0.34;           // bench sits this far in front of its desk
const BALLS = 75;

/** Lamp colours (flash board: off / drawn P20 / a hit reads red). */
export const LAMP_OFF = 0x2b1d12;
export const LAMP_DRAWN = 0xffb347;
export const LAMP_HIT = 0xff3b30;
const LAMP_TMP = new THREE.Color();

/** Board lamp centre for number `n` (1..75), machine-local. Columns B·I·N·G·O of 15 rows each (row 0 at the top). */
export function lampXY(n: number): [number, number] {
  const i = n - 1;
  const col = Math.floor(i / 15), row = i % 15;
  const x = BOARD_POS[0] - BOARD_W / 2 + (col + 0.5) * (BOARD_W / 5);
  const y = BOARD_POS[1] + BOARD_H / 2 - (row + 0.5) * (BOARD_H / 15);
  return [x, y];
}

/** Sets one flash-board lamp. Caller flags the buffer via `commitBoard`. */
export function setLamp(board: THREE.InstancedMesh, n: number, state: 'off' | 'drawn' | 'hit'): void {
  const c = state === 'off' ? LAMP_OFF : state === 'drawn' ? LAMP_DRAWN : LAMP_HIT;
  board.setColorAt(n - 1, LAMP_TMP.setHex(c));
}
export function commitBoard(board: THREE.InstancedMesh): void {
  if (board.instanceColor) board.instanceColor.needsUpdate = true;
}

/** Felt-plane seat for desk `i` (0–7): the bench in front of it. */
export function benchZ(i: number): number { return DESK_ROW_Z[i >> 2] + BENCH_DZ; }

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<BingoParts> {
  const { pal } = kit;
  const root = kit.group('bingo');
  const wood = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell ──
  kit.box(HALF_W * 2, 0.04, HALF_D * 2, wood, at(0, 0.02, 0));                              // floor plinth
  kit.box(HALF_W * 2, 0.04, HALF_D * 2, pal.feltDark, at(0, CEIL_H, 0));                    // ceiling
  kit.box(0.04, CEIL_H, HALF_D * 2, wood, at(-HALF_W + 0.02, CEIL_H / 2, 0));               // left wall
  kit.box(0.04, CEIL_H, HALF_D * 2, wood, at(HALF_W - 0.02, CEIL_H / 2, 0));                // right wall
  kit.box(HALF_W * 2, CEIL_H, 0.04, wood, at(0, CEIL_H / 2, -HALF_D + 0.02));               // back wall
  kit.box(HALF_W * 2 - 0.08, 0.05, 0.05, pal.brass, at(0, CEIL_H - 0.02, -HALF_D + 0.05));  // cornice

  // ── flash board frame (backdrop screen sits in front of it) ──
  kit.box(BOARD_W + 0.08, BOARD_H + 0.08, 0.04, pal.brass, at(BOARD_POS[0], BOARD_POS[1], BOARD_POS[2]));
  const boardScreen = kit.screen({ w: BOARD_W, h: BOARD_H, px: [160, 80], bezel: pal.black, glow: 0.4 });
  boardScreen.mesh.position.set(BOARD_POS[0], BOARD_POS[1], BOARD_POS[2] + 0.01);
  root.add(boardScreen.mesh);
  const boardGeo = new THREE.BoxGeometry(0.2, 0.045, 0.02);
  const board = new THREE.InstancedMesh(boardGeo, kit.mat(0xffffff), BALLS);
  board.name = 'bingo.board';
  const m4 = new THREE.Matrix4();
  for (let n = 1; n <= BALLS; n++) {
    const [x, y] = lampXY(n);
    m4.makeTranslation(x, y, BOARD_POS[2] + 0.03);
    board.setMatrixAt(n - 1, m4);
    board.setColorAt(n - 1, LAMP_TMP.setHex(LAMP_OFF));
  }
  board.instanceMatrix.needsUpdate = true;
  commitBoard(board);
  root.add(board);

  // ── caller dais, cage on a pole, crank, balls, chute, displays ──
  kit.box(DAIS_SIZE[0], DAIS_SIZE[1], DAIS_SIZE[2], wood, at(DAIS_POS[0], DAIS_POS[1], DAIS_POS[2]));
  kit.box(DAIS_SIZE[0] + 0.02, 0.02, DAIS_SIZE[2] + 0.02, pal.brass, at(DAIS_POS[0], DAIS_SIZE[1] + 0.01, DAIS_POS[2]));
  const caller = kit.dealer({ style: 'caller', height: 1.75, feltY: DAIS_SIZE[1] });
  caller.root.position.set(CALLER_POS[0], CALLER_POS[1], CALLER_POS[2]);
  root.add(caller.root);

  const cage = new THREE.Group();
  cage.name = 'bingo.cage';
  cage.position.set(CAGE_POS[0], CAGE_POS[1], CAGE_POS[2]);
  root.add(cage);
  const cageMesh = kit.cage({ r: 0.2, h: 0.4, bars: 12, color: pal.brass });
  cage.add(cageMesh);
  kit.cyl(0.03, 0.03, CAGE_POS[1] - DAIS_SIZE[1], pal.chrome, at(CAGE_POS[0], (CAGE_POS[1] + DAIS_SIZE[1]) / 2, CAGE_POS[2]));
  const cageBalls = kit.balls({ max: BALLS, r: 0.018, color: 0xd9b07a });
  cage.add(cageBalls.root);
  for (let i = 0; i < BALLS; i++) {
    // deterministic spiral pack inside the cage (no RNG in the model)
    const a = i * 2.399, rr = 0.13 * Math.sqrt((i + 0.5) / BALLS), yy = (((i * 0.618) % 1) - 0.5) * 0.3;
    cageBalls.set(i, Math.cos(a) * rr, yy, Math.sin(a) * rr);
  }
  const crank = kit.crank({ r: 0.09 });
  crank.root.position.set(CAGE_POS[0] + 0.3, CAGE_POS[1], CAGE_POS[2]);
  crank.root.rotation.z = Math.PI / 2;
  root.add(crank.root);

  const ballPop = new THREE.Object3D();
  ballPop.position.set(CAGE_POS[0] + 0.25, CAGE_POS[1] + 0.22, CAGE_POS[2]);
  root.add(ballPop);
  const ballDisplay = kit.screen({ w: 0.3, h: 0.12, px: [64, 24], bezel: pal.black, glow: 0.5 });
  ballDisplay.mesh.position.set(-0.55, 1.42, -0.86);
  root.add(ballDisplay.mesh);
  const balls = kit.ledPanel({ digits: 2, color: '#ffb347', h: 0.09 });
  balls.root.position.set(-0.55, 1.28, -0.86);
  root.add(balls.root);

  // ── caged ceiling bulbs (DYING) ──
  const bulbs: LampPart[] = [];
  for (const [x, z] of [[-0.9, -0.2], [0.9, 0.25]] as const) {
    kit.cyl(0.005, 0.005, 0.14, pal.black, at(x, CEIL_H - 0.07, z));
    const bulb = kit.lamp({ r: 0.05, color: 0xffe6a0, shape: 'bulb' });
    bulb.root.position.set(x, 2.45, z);
    root.add(bulb.root);
    const bulbCage = kit.cage({ r: 0.07, h: 0.12, bars: 6, color: pal.chrome });
    bulbCage.position.set(x, 2.45, z);
    root.add(bulbCage);
    bulbs.push(bulb);
  }

  // ── desks: two rows of four, cards, dauber, 1 TO GO lamp, rail meter, bench ──
  const desks: BingoDesk[] = [];
  const seats: SeatDef[] = [];
  for (let i = 0; i < 8; i++) {
    const x = DESK_X[i & 3], dz = DESK_ROW_Z[i >> 2], bz = benchZ(i);
    kit.box(0.55, 0.04, 0.45, wood, at(x, DESK_TOP - 0.02, dz));                              // desk top
    kit.box(0.56, 0.012, 0.46, pal.brass, at(x, DESK_TOP + 0.001, dz));                       // brass edging
    kit.box(0.55, 0.25, 0.02, wood, at(x, DESK_TOP + 0.12, dz - 0.225));                     // back panel
    for (const sx of [-0.25, 0.25]) for (const sz of [-0.2, 0.2]) kit.box(0.04, DESK_TOP - 0.04, 0.04, wood, at(x + sx, (DESK_TOP - 0.04) / 2, dz + sz));
    // bench (seat slab on two legs)
    kit.box(0.5, 0.05, 0.28, wood, at(x, 0.45, bz));
    for (const sx of [-0.2, 0.2]) kit.box(0.04, 0.45, 0.24, wood, at(x + sx, 0.225, bz));

    const cards: THREE.Mesh[] = [], cardCanvas: HTMLCanvasElement[] = [], cardTex: THREE.CanvasTexture[] = [];
    CARD_OFFS.forEach(([cx, cz]) => {
      const [cv] = makeCanvas(CARD_TEX_W, CARD_TEX_H);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.NoColorSpace;                                                    // C14
      const mat = kit.mat({ map: tex, lit: false, side: 'double', snap: false, affine: false });
      // lifted: the card leans back 30 degrees, so its lower half sank into the desk top at the old height
      const mesh = kit.plane(CARD_W, CARD_H, mat, { pos: [x + cx, DESK_TOP + 0.072, dz + cz], rot: [-60, 0, 0], parent: root });
      cards.push(mesh);
      cardCanvas.push(cv);
      cardTex.push(tex);
    });

    const dauber = new THREE.Group();
    dauber.position.set(x + 0.2, DESK_TOP + 0.02, dz - 0.1);
    root.add(dauber);
    kit.cyl(0.02, 0.02, 0.11, pal.cream, { pos: [0, 0, 0], rot: [0, 0, 90], parent: dauber, seg: 8 });
    kit.cyl(0.021, 0.021, 0.03, 0xd0306a, { pos: [0.055, 0, 0], rot: [0, 0, 90], parent: dauber, seg: 8 });

    const oneToGo = kit.lamp({ r: 0.018, color: 0xffb000, shape: 'dome' });
    oneToGo.root.position.set(x - 0.24, DESK_TOP + 0.02, dz + 0.2);
    root.add(oneToGo.root);
    const rail = kit.lamp({ r: 0.02, color: LAMP_OFF, shape: 'flat' });
    rail.root.position.set(x + 0.24, DESK_TOP + 0.01, dz + 0.2);
    root.add(rail.root);

    desks.push({ cards, cardCanvas, cardTex, dauber, oneToGo, rail });
    seats.push({
      pose: {
        // seat view: backed off and raised (was 0.34 m from the card grid, which filled the frame) so the card grid, its daubs
        // and the desk edge sit mid-frame, clear of the top banner and the bottom bar. Row 2 stops at the room's front edge.
        pos: new THREE.Vector3(x, 1.22, Math.min(bz + 0.1, HALF_D - 0.05)),
        look: new THREE.Vector3(x, DESK_TOP + 0.1, dz),
        fov: 55,
        mouse: 'primary',
      },
      stand: new THREE.Vector3(x, 0, bz + 0.3),
      avatar: 'sit',
      standY: 0.45,
    });
  }

  // ── anchors and lights ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 2.2, -0.2); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.5, 0.9); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 2.35, -1.2); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, CEIL_H - 0.05, -0.5); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(-HALF_W - 0.01, 1.2, 0); root.add(servicePlate);
  const callerCam = new THREE.Object3D(); callerCam.position.set(CALLER_POS[0], 1.55, 0.4); root.add(callerCam);
  const light = new THREE.Object3D();
  light.position.set(-1.0, 2.3, -0.4);
  light.userData = { color: 0xffe6a0, intensity: 0.9, range: 4 };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(BOARD_POS[0], BOARD_POS[1], -0.9);
  light2.userData = { color: 0xffb000, intensity: 0.5, range: 3 };
  root.add(light2);

  const parts: BingoParts = {
    cage, crank, cageBalls, ballPop, ballDisplay, leds: { balls }, board, boardScreen, caller, desks, bulbs, light, light2, callerCam,
  };
  const keep: Array<THREE.Object3D | { root: THREE.Object3D }> = [
    cage, crank.root, cageBalls.root, ballPop, ballDisplay.mesh, balls.root, board, boardScreen.mesh, caller.root,
    ...desks.flatMap((d) => [...d.cards, d.dauber, d.oneToGo.root, d.rail.root]),
    ...bulbs.map((b) => b.root), light, light2, speaker, prompt, label, marqueeTop, servicePlate, callerCam,
  ];
  crispTexture(boardScreen.tex, 4);                            // on-machine text: linear + mips, not nearest
  crispTexture(ballDisplay.tex, 4);
  crispTexture(balls.screen.tex, 4);
  for (const d of desks) for (const t of d.cardTex) crispTexture(t, 4);
  kit.finalize(root, { keep });

  const colliders = [
    ...DESK_ROW_Z.flatMap((dz) => DESK_X.map((x) => ({
      min: [x - 0.3, 0, dz - 0.25] as [number, number, number], max: [x + 0.3, DESK_TOP, dz + 0.25] as [number, number, number],
    }))),
    { min: [DAIS_POS[0] - DAIS_SIZE[0] / 2, 0, DAIS_POS[2] - DAIS_SIZE[2] / 2] as [number, number, number],
      max: [DAIS_POS[0] + DAIS_SIZE[0] / 2, DAIS_SIZE[1], DAIS_POS[2] + DAIS_SIZE[2] / 2] as [number, number, number] },
    { min: [-HALF_W - 0.02, 0, -HALF_D - 0.02] as [number, number, number], max: [HALF_W + 0.02, CEIL_H, -HALF_D + 0.02] as [number, number, number] },
  ];

  return {
    root,
    parts,
    playPose: seats[0].pose,
    seats,
    colliders,
    interact: { min: [-HALF_W, 0.1, -HALF_D], max: [HALF_W, 2.2, HALF_D - 0.2] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, callerCam, light, light2, ballPop },
    dispose: () => {
      boardScreen.dispose();
      ballDisplay.dispose();
      for (const d of desks) for (const t of d.cardTex) t.dispose();
    },
  };
}
