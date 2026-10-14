/**
 * Keno Lounge — procedural model (MACHINES_tables §12, plan modelBrief `mdl-keno`). `buildModel` returns a full
 * `MachineModel` and nothing else touches the scene; `KenoParts` is the contract with `index.ts`.
 * Metres, origin = floor centre of the footprint, +Z = player side.
 *
 * Footprint 2.60 W × 1.40 D × 1.60 H. Four walnut writing desks in a row (brass edging) with stools; each desk carries
 * a brass-framed CRT ticket writer and a light pen on a coiled cord. At the back right a "relay brain" cabinet (20
 * relay lamps and a DRAW # 7-seg). The wall board (3.00 × 1.80) hangs above at machine-local (0, 2.80, −0.89) with 80
 * numbered lamps in 8 rows × 10 and a NEXT GAME 7-seg timer. Budget ≤ 1,400 tris, ≤ 20 draws.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { LampPart, LedPanelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { SeatDef } from '@/core/types';
import { crispTexture } from '@/core/ui/textOverlay';

export interface KenoDesk { screen: ScreenSurface; pen: THREE.Group; stool: THREE.Group }

export type KenoParts = {
  /** Four ticket-writer desks, left to right. */
  desks: KenoDesk[];
  /** Relay brain lamps, 20 (index = draw order). */
  relayLamps: LampPart[];
  leds: { drawNo: LedPanelPart; next: LedPanelPart };
  /** 80 lamps, instance `n-1` = number n. Colour via `setLamp`. */
  board: THREE.InstancedMesh;
  /** Number backdrop behind the lamps (160 × 96). */
  boardScreen: ScreenSurface;
  /** One rail meter per desk (fills with the ticket's spot count). */
  railMeters: LampPart[];
  seatLamps: LampPart[];
  armchairs: THREE.Object3D[];
};

// ── layout constants (metres, machine-local) ────────────────────────────────────────────────────
export const DESK_X = [-0.75, -0.25, 0.25, 0.75];
const DESK_Z = -0.05;
const DESK_TOP = 0.75;
export const BOARD_Y = 2.8, BOARD_Z = -0.89;
const BOARD_W = 3.0, BOARD_H = 1.8;
const GRID_COLS = 10, GRID_ROWS = 8;
const GRID_X0 = -1.3, GRID_Y0 = 2.25, GRID_Y1 = 3.5;
export const RELAY_X = 1.1, RELAY_Z = -0.5;
const SEAT_Z = 0.5;
const LAMP_COUNT = 80;

/** Lamp colours (ART §: board P02 off, drawn P20, your hit blinks). */
export const LAMP_OFF = 0x2b1d12;
export const LAMP_DRAWN = 0xffb347;
export const LAMP_HIT = 0xff3b30;
const LAMP_BOARD_TMP = new THREE.Color();

/** Felt-plane seat for desk `i`. */
export const seatX = (i: number): number => DESK_X[i];

/** Board lamp centre for number `n` (1..80), machine-local. */
export function lampXY(n: number): [number, number] {
  const i = n - 1;
  const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
  const x = GRID_X0 + (col + 0.5) * (2.6 / GRID_COLS);
  const y = GRID_Y1 - (row + 0.5) * ((GRID_Y1 - GRID_Y0) / GRID_ROWS);
  return [x, y];
}

/** Sets one board lamp. `state`: off / drawn / hit (red). Caller flags `instanceColor.needsUpdate` via `commitBoard`. */
export function setLamp(board: THREE.InstancedMesh, n: number, state: 'off' | 'drawn' | 'hit'): void {
  const c = state === 'off' ? LAMP_OFF : state === 'drawn' ? LAMP_DRAWN : LAMP_HIT;
  board.setColorAt(n - 1, LAMP_BOARD_TMP.setHex(c));
}
export function commitBoard(board: THREE.InstancedMesh): void {
  if (board.instanceColor) board.instanceColor.needsUpdate = true;
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<KenoParts> {
  const { pal } = kit;
  const root = kit.group('keno');
  const walnut = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged) ──
  kit.box(2.6, 0.04, 0.5, walnut, at(0, 0.02, 0.0));                      // sub-floor plinth
  for (const x of DESK_X) {
    kit.box(0.56, 0.05, 0.45, walnut, at(x, DESK_TOP - 0.02, DESK_Z));     // desk top
    kit.box(0.58, 0.012, 0.47, pal.brass, at(x, DESK_TOP + 0.005, DESK_Z)); // brass edging
    kit.box(0.5, 0.7, 0.04, walnut, at(x, DESK_TOP / 2 - 0.02, DESK_Z - 0.2)); // desk back panel
    for (const sx of [-0.27, 0.27]) kit.box(0.04, DESK_TOP - 0.05, 0.4, walnut, at(x + sx, (DESK_TOP - 0.05) / 2, DESK_Z)); // legs
  }
  kit.box(2.6, 1.6, 0.04, walnut, at(0, 0.8, -0.7));                      // back wall panelling
  kit.box(2.6, 0.08, 0.04, pal.brass, at(0, 1.6, -0.7));                  // cornice
  // carrel dividers between the desks (and at both ends): the seat camera frames ONE ticket writer, never a sliver of its neighbour
  for (const dx of [-1, -0.5, 0, 0.5, 1]) kit.box(0.025, 0.52, 0.42, walnut, at(dx, DESK_TOP + 0.26, DESK_Z - 0.05));
  kit.box(0.04, 1.6, 1.4, walnut, at(-1.3, 0.8, 0));                      // left end panel
  kit.box(0.04, 1.6, 1.4, walnut, at(1.3, 0.8, 0));                       // right end panel
  kit.box(2.6, 0.04, 1.4, pal.feltDark, at(0, 1.6, 0));                   // ceiling
  // wall board mount + frame (the board itself hangs above the footprint)
  kit.box(BOARD_W + 0.08, BOARD_H + 0.08, 0.06, pal.brass, at(0, BOARD_Y, BOARD_Z - 0.03));

  // ── relay brain cabinet (back right) ──
  kit.box(0.4, 1.6, 0.4, walnut, at(RELAY_X, 0.8, RELAY_Z));
  kit.box(0.42, 0.03, 0.42, pal.brass, at(RELAY_X, 1.6, RELAY_Z));
  const relayLamps: LampPart[] = [];
  for (let i = 0; i < 20; i++) {
    const col = i % 5, row = Math.floor(i / 5);
    const lamp = kit.lamp({ r: 0.022, color: LAMP_OFF, shape: 'dome' });
    lamp.root.position.set(RELAY_X - 0.15 + col * 0.075, 0.5 + row * 0.25, RELAY_Z + 0.205);
    root.add(lamp.root);
    relayLamps.push(lamp);
  }
  const drawNo = kit.ledPanel({ digits: 3, color: '#ffb347', h: 0.07 });
  drawNo.root.position.set(RELAY_X, 1.42, RELAY_Z + 0.205);
  root.add(drawNo.root);

  // ── desks: CRT ticket writer, light pen on a coiled cord, stool ──
  const desks: KenoDesk[] = [];
  const railMeters: LampPart[] = [];
  const seatLamps: LampPart[] = [];
  DESK_X.forEach((x, i) => {
    // own CRT (the kit monitor's scanline shader halves every other texel row, which wrecks 5 px digits): flat glass, linear + mips
    const crt = { screen: kit.screen({ w: 0.3, h: 0.24, px: [160, 120], bezel: pal.black, glow: 0.4, scanlines: false }) };
    crispTexture(crt.screen.tex, 4);                                  // linear + mips: the 80-number grid stays sharp when the desk fills the frame
    crt.screen.clear('#0b1a12');
    crt.screen.mesh.position.set(x, DESK_TOP + 0.145, DESK_Z - 0.1);   // glass bottom 1 cm above the desk top (the footer row lives there)
    root.add(crt.screen.mesh);
    kit.box(0.37, 0.31, 0.05, 0xd9d2bc, { bevel: 0.012, ...at(x, DESK_TOP + 0.145, DESK_Z - 0.155) });   // monitor casing (merged)
    kit.box(0.234, 0.187, 0.24, 0xcfc8b2, { bevel: 0.01, ...at(x, DESK_TOP + 0.14, DESK_Z - 0.3) });

    const pen = new THREE.Group();
    pen.position.set(x + 0.2, DESK_TOP + 0.01, DESK_Z + 0.12);
    kit.cyl(0.008, 0.008, 0.14, pal.chrome, { pos: [0, 0.008, 0], rot: [90, 0, 0], parent: pen, seg: 6 });
    kit.tube([[0, 0.01, 0], [-0.05, 0.02, 0.1], [-0.1, 0.02, 0.2], [-0.18, 0.01, 0.26]], 0.003, pal.black, { seg: 6, radialSeg: 4, parent: pen });
    root.add(pen);

    const stool = kit.stool({ h: 0.68 }) as THREE.Group;
    stool.position.set(x, 0, SEAT_Z);
    root.add(stool);

    const rail = kit.lamp({ r: 0.02, color: LAMP_OFF, shape: 'flat' });
    rail.root.position.set(x - 0.2, DESK_TOP + 0.03, DESK_Z + 0.22);
    root.add(rail.root);
    railMeters.push(rail);

    const seat = kit.lamp({ r: 0.025, color: pal.neonCyan, shape: 'dome' });
    seat.root.position.set(x, DESK_TOP + 0.2, DESK_Z - 0.23);
    root.add(seat.root);
    seatLamps.push(seat);

    // screen: the CRT canvas is owned by the monitor, we draw the number grid on it
    desks.push({ screen: crt.screen, pen, stool });
  });

  // ── wall board: number backdrop + 80 instanced lamps ──
  const boardScreen = kit.screen({ w: BOARD_W, h: BOARD_H, px: [160, 96], bezel: pal.black, glow: 0.4 });
  boardScreen.mesh.position.set(0, BOARD_Y, BOARD_Z);
  root.add(boardScreen.mesh);
  const lampGeo = new THREE.BoxGeometry(0.2, 0.1, 0.02);
  const lampMat = kit.mat(0xffffff);
  const board = new THREE.InstancedMesh(lampGeo, lampMat, LAMP_COUNT);
  board.name = 'keno.board';
  const m4 = new THREE.Matrix4();
  for (let n = 1; n <= LAMP_COUNT; n++) {
    const [x, y] = lampXY(n);
    m4.makeTranslation(x, y - 0.05, BOARD_Z + 0.02);
    board.setMatrixAt(n - 1, m4);
    board.setColorAt(n - 1, LAMP_BOARD_TMP.setHex(LAMP_OFF));
  }
  board.instanceMatrix.needsUpdate = true;
  commitBoard(board);
  root.add(board);

  const next = kit.ledPanel({ digits: 4, color: '#ffb347', h: 0.12 });
  next.root.position.set(1.1, 2.02, BOARD_Z + 0.04);
  root.add(next.root);

  // ── lounge armchairs at the left end (decor, if space) ──
  const armchairs: THREE.Object3D[] = [];
  for (const z of [0.25, 0.6]) {
    const chair = kit.chair({ h: 0.5 });
    chair.position.set(-1.05, 0, z);
    chair.rotation.y = Math.PI / 2;
    root.add(chair);
    armchairs.push(chair);
  }

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.45, -0.6); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.9, 0.2); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.7, -0.7); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(RELAY_X, 1.65, RELAY_Z); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(-1.27, 1.2, 0.3); root.add(servicePlate);
  const boardCam = new THREE.Object3D(); boardCam.position.set(0, 1.45, 0.9); root.add(boardCam);
  const light = new THREE.Object3D();
  light.position.set(0, BOARD_Y, BOARD_Z + 0.3);
  light.userData = { color: LAMP_DRAWN, intensity: 0.5, range: 3 };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(RELAY_X, 1.1, RELAY_Z + 0.3);
  light2.userData = { color: 0xffa000, intensity: 0.3, range: 1.5 };
  root.add(light2);

  const parts: KenoParts = { desks, relayLamps, leds: { drawNo, next }, board, boardScreen, railMeters, seatLamps, armchairs };
  const keep: Array<THREE.Object3D | { root: THREE.Object3D }> = [
    ...desks.map((d) => d.pen), ...desks.map((d) => d.stool), ...desks.map((d) => d.screen.mesh), ...relayLamps, ...railMeters, ...seatLamps,
    drawNo, next, board, boardScreen.mesh, light, light2, speaker, prompt, label, marqueeTop, servicePlate, boardCam,
  ];
  kit.finalize(root, { keep });

  const seats: SeatDef[] = DESK_X.map((x) => ({
    pose: {
      // seat view: close over the desk, looking down at the CRT so the whole 80-number grid sits between the HUD strip and the bar
      pos: new THREE.Vector3(x, 1.03, 0.36),
      look: new THREE.Vector3(x, 0.89, -0.15),
      fov: 40,
      mouse: 'primary',
    },
    stand: new THREE.Vector3(x, 0, SEAT_Z),
    avatar: 'sit',
    standY: 0.68,
  }));

  return {
    root,
    parts,
    playPose: seats[0].pose,
    seats,
    colliders: [
      ...DESK_X.map((x) => ({ min: [x - 0.3, 0, DESK_Z - 0.25] as [number, number, number], max: [x + 0.3, DESK_TOP, DESK_Z + 0.25] as [number, number, number] })),
      { min: [RELAY_X - 0.22, 0, RELAY_Z - 0.22], max: [RELAY_X + 0.22, 1.62, RELAY_Z + 0.22] },
      { min: [-1.32, 0, -0.72], max: [1.32, 1.62, -0.66] },
    ],
    interact: { min: [-1.3, 0.2, -0.75], max: [1.3, 1.6, 0.7] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, boardCam, light, light2 },
    dispose: () => { boardScreen.dispose(); desks.forEach((d) => d.screen.dispose()); },
  };
}
