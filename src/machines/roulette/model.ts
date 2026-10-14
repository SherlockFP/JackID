/**
 * European Roulette "The Bone Wheel" — procedural model (MACHINES_tables §2, plan modelBrief). Pattern: `buildModel`
 * returns a full `MachineModel` and nothing else touches the scene; the exported `RouletteParts` type is the contract
 * with `index.ts`. Metres, origin = floor centre of the footprint, +Z = player side.
 *
 * Table 2.60 × 1.30 m, felt at 0.78 m, wheel bowl Ø 0.82 m at x −0.85 (the Rake's end). Layout plane 1.60 × 0.64 m
 * covers x 0…+1.20 (number grid) with the outside bets and dozens below it. Six stools along the front rail.
 * Budget ≤ 2,500 tris excl. stools, ≤ 20 draws. Static parts merge through `kit.finalize`.
 */
import * as THREE from 'three';
import type { BulbChain, ChipPool, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { TexGenFull } from '@/core/texgen/texgen';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { SeatDef } from '@/core/types';
import { upper, t as tr } from '@/core/i18n';
import { crispTexture } from '@/core/ui/textOverlay';
import { WHEEL_ORDER, colorOf, parseSpot } from './rules';

export type RouletteParts = {
  /** Pivot at the wheel centre (never rotated). */
  wheel: THREE.Object3D;
  /** Pocket ring + number ring; rotates about Y. The dolly rides on it. */
  rotor: THREE.Object3D;
  /** Carries the ball around the track; rotates about Y. */
  ballPivot: THREE.Object3D;
  ball: THREE.Mesh;
  /** Brass skull marker on the winning pocket (child of `rotor`). */
  dolly: THREE.Object3D;
  /** Brass puck on the winning number of the layout (seat-views: the wheel is out of shot, the felt shows the result). */
  puck: THREE.Object3D;
  /** The Rake's arm, pivoting about its rail; `rotation.x` lifts it. */
  rake: THREE.Object3D;
  /** 37 rim bulbs in wheel order (index = wheel position). */
  rim: BulbChain;
  /** Last-12 history pillar (portrait). */
  history: ScreenSurface;
  /** Chip pool for every seat's layout (public felt chips). */
  chips: ChipPool;
  seatLamps: LampPart[];
  phaseLamp: LampPart;
  fairLamp: LampPart;
  /** The felt layout plane (pointer hit-test for chips). */
  layout: THREE.Mesh;
  /** The layout's canvas texture (repainted on a language change, see `paintLayout`). */
  layoutTex: THREE.CanvasTexture;
};

export const TOP = 0.78;               // felt height
export const WHEEL_X = -0.85;
const WHEEL_Y = TOP - 0.02;
export const BALL_R_TRACK = 0.37;      // ball track radius (centre of the track band)
export const BALL_Y = TOP + 0.04;
export const POCKET_R = 0.275;         // pocket centre radius on the rotor
export const SEAT_X = [-1.25, -0.75, -0.25, 0.25, 0.75, 1.25];
const SEAT_Z = 0.95;
/**
 * Betting layout geometry (seat-views). The old spot coordinates (rows 0.21 m apart, outside bets at z 0.46 / 0.6) did not match the
 * 160 x 64 texture on the felt (chips landed ~0.28 m from the number you clicked, and the even-money row hung off the felt edge). Spots,
 * chips, clicks and the painted board now share these numbers: the grid is 12 columns of CELL_W from LAYOUT_X0, three rows of ROW_H.
 */
export const LAYOUT_X0 = -0.1, CELL_W = 0.1, ROW_H = 0.15;
const ROW_Z = (row: number): number => (row - 1) * ROW_H;   // row 0 = top (far), 2 = bottom (near)
const DOZ_Z = 0.295, EVEN_Z = 0.43;
export const LAYOUT_W = 1.43, LAYOUT_H = 0.76, LAYOUT_CX = 0.5, LAYOUT_CZ = 0.135;   // the felt plane (machine-local metres)
const LAYOUT_PX = 600;                                                              // texels per metre
export const CHIP_Y = TOP + 0.034;                                                 // bottom of a chip stack (above the layout plane at TOP + 0.026; the felt top is TOP + 0.02)

/** Rotor angle (radians, about +Y) at which pocket `n` sits at the top of the wheel. */
export const pocketAngle = (n: number): number => (WHEEL_ORDER.indexOf(n) / WHEEL_ORDER.length) * Math.PI * 2;

/** Felt-plane position (x, z) in machine-local metres for a number on the grid, zero included. */
export function numberXZ(n: number): [number, number] {
  if (n === 0) return [LAYOUT_X0 - 0.05, 0];
  const col = Math.floor((n - 1) / 3), row = 2 - ((n - 1) % 3);
  return [LAYOUT_X0 + (col + 0.5) * CELL_W, ROW_Z(row)];
}

/** Where a chip for `spot` sits on the felt (machine-local x, z). Null for an unknown spot. */
export function spotXZ(spot: string): [number, number] | null {
  const d = parseSpot(spot);
  if (!d) return null;
  if (spot.startsWith('straight:')) return numberXZ(d.nums[0]);
  if (spot.startsWith('street:') || spot.startsWith('line:')) {
    const xs = d.nums.map((n) => numberXZ(n)[0]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, ROW_Z(2) + ROW_H / 2];
  }
  if (spot.startsWith('col:')) return [LAYOUT_X0 + 1.25, ROW_Z(3 - Number(spot.slice(4)))];
  if (spot.startsWith('doz:')) return [LAYOUT_X0 + 0.2 + (Number(spot.slice(4)) - 1) * 0.4, DOZ_Z];
  const ox = (k: number): number => LAYOUT_X0 + 0.1 + 0.2 * k;
  const outside: Record<string, [number, number]> = {
    low: [ox(0), EVEN_Z], even: [ox(1), EVEN_Z], red: [ox(2), EVEN_Z], black: [ox(3), EVEN_Z], odd: [ox(4), EVEN_Z], high: [ox(5), EVEN_Z],
  };
  if (outside[spot]) return outside[spot];
  const pts = d.nums.map(numberXZ);
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

const RED_HEX = 0x9e1b22, BLACK_HEX = 0x141414, ZERO_HEX = 0x1e6b3a;

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<RouletteParts> {
  const { pal } = kit;
  const tex = kit.tex as TexGenFull;
  const root = kit.group('roulette');
  const walnut = o.variant % 2 ? pal.wood : pal.woodDark;
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged into one draw) ──
  kit.box(2.6, TOP - 0.04, 1.3, walnut, at(0, (TOP - 0.04) / 2, 0));                       // table body
  kit.box(2.66, 0.1, 1.36, pal.black, at(0, TOP - 0.05, 0));                               // padded leather rail
  kit.box(2.5, 0.02, 1.2, pal.felt, at(0, TOP + 0.01, 0));                                 // green felt
  kit.cyl(0.43, 0.43, 0.08, walnut, { pos: [WHEEL_X, TOP - 0.02, 0], seg: 24, parent: root }); // wheel bowl
  // (the 0.42 m chrome 'rail stop' ledge lay across the middle number row of the layout, hiding 2 5 8 11 ...: removed)
  for (const sx of SEAT_X) kit.box(0.38, 0.16, 0.1, walnut, at(sx, TOP - 0.1, 0.7));        // front rail blocks
  for (const sx of [-1.35, 1.35]) kit.box(0.04, 0.8, 1.2, walnut, at(sx, 0.4, 0));          // end panels
  kit.box(1.25, 0.03, 0.08, walnut, at(0.25, 0.4, -0.66));                                  // back apron
  kit.box(0.22, 0.4, 0.22, walnut, at(-1.38, 0.2, 0));                                      // history pillar base
  kit.box(0.06, 0.8, 0.06, pal.brass, at(-1.4, 1.2, -0.08));                               // rake rail post
  kit.box(0.04, 0.04, 1.0, pal.brass, { pos: [WHEEL_X, 1.62, -0.8], parent: root });          // rake rail (z -1.3…-0.3: inside the XL footprint)
  // ceiling pendant (green glass shade, rod)
  kit.cyl(0.008, 0.008, 1.0, pal.chrome, { pos: [0, 2.7, 0], seg: 4, parent: root });
  kit.cyl(0.11, 0.2, 0.16, { color: 0x1f5a3a }, { pos: [0, 2.2, 0], seg: 12, parent: root });

  // ── wheel (animated) ──
  const wheel = new THREE.Object3D();
  wheel.position.set(WHEEL_X, WHEEL_Y, 0);
  root.add(wheel);
  const rotor = new THREE.Object3D();
  wheel.add(rotor);
  const numberRing = kit.lathe([[0.36, 0], [0.31, 0], [0.31, 0.012], [0.36, 0.012]], 37, { color: pal.cream, map: tex.rouletteRing() }, { pos: [0, 0.03, 0], parent: rotor });
  const pocketRing = kit.lathe([[0.31, 0], [0.24, 0], [0.24, 0.01], [0.31, 0.01]], 37, { color: BLACK_HEX }, { pos: [0, 0.02, 0], parent: rotor });
  // one coloured bead per pocket keeps the red/black/green read without 37 draws
  for (let n = 0; n <= 36; n++) {
    const c = colorOf(n) === 'red' ? RED_HEX : colorOf(n) === 'green' ? ZERO_HEX : BLACK_HEX;
    const a = pocketAngle(n);
    kit.box(0.04, 0.012, 0.03, c, { pos: [Math.sin(a) * POCKET_R, 0.03, Math.cos(a) * POCKET_R], rot: [0, (a * 180) / Math.PI, 0], parent: rotor, shade: false });
  }
  kit.cyl(0.02, 0.07, 0.12, pal.chrome, { pos: [0, 0.06, 0], seg: 8, parent: wheel });
  const dolly = kit.sphere(0.014, pal.brass, { pos: [0, 0.05, 0], wSeg: 6, hSeg: 4, parent: rotor });
  dolly.visible = false;
  const puck = kit.cyl(0.04, 0.04, 0.014, pal.brass, { pos: [0, TOP + 0.04, 0], seg: 12, parent: root });
  puck.visible = false;

  const ballPivot = new THREE.Object3D();
  ballPivot.position.set(0, BALL_Y - WHEEL_Y, 0);
  wheel.add(ballPivot);
  const ball = kit.sphere(0.009, pal.bone, { pos: [BALL_R_TRACK, 0, 0], wSeg: 8, hSeg: 6, parent: ballPivot });

  // rim bulbs around the bowl
  const rimPts: [number, number, number][] = [];
  for (let i = 0; i < 37; i++) {
    const a = pocketAngle(WHEEL_ORDER[i]);
    rimPts.push([WHEEL_X + Math.sin(a) * 0.42, TOP + 0.09, Math.cos(a) * 0.42]);
  }
  const rim = kit.bulbChain({ path: rimPts, count: 37, colors: [0xffb347], r: 0.008 });
  root.add(rim.root);

  // rake: brass arm on the rail, lifts on LOCK
  const rake = new THREE.Object3D();
  rake.position.set(WHEEL_X, 1.62, -0.85);
  root.add(rake);
  kit.box(0.03, 0.03, 0.9, pal.brass, { pos: [0, -0.02, 0.45], parent: rake });
  kit.sphere(0.02, pal.brass, { pos: [0, -0.02, 0.9], wSeg: 6, hSeg: 4, parent: rake });

  // layout plane (EN/TR pre-rendered)
  // painted here (not core's 160 x 64 `rouletteLayout`): same coordinates as the spots, 600 texels per metre, big numerals, linear + mips
  const layoutTex = kit.tex.canvas(Math.round(LAYOUT_W * LAYOUT_PX), Math.round(LAYOUT_H * LAYOUT_PX), () => {}, { wrap: 'clamp' });
  layoutTex.colorSpace = THREE.NoColorSpace;
  paintLayout(layoutTex, tex);
  crispTexture(layoutTex, 4);
  const layoutMat = kit.mat({ map: layoutTex, lit: false, side: 'double', snap: false, affine: false });
  const layout = kit.plane(LAYOUT_W, LAYOUT_H, layoutMat, { pos: [LAYOUT_CX, TOP + 0.026, LAYOUT_CZ], rot: [-90, 0, 0], shade: false, name: 'layout' });
  root.add(layout);

  // history pillar (last 12), wheel end
  const history = kit.screen({ w: 0.08, h: 0.36, px: [32, 192], bezel: pal.black });
  history.mesh.position.set(-1.38, 0.95, 0);
  history.mesh.rotation.y = Math.PI / 2;
  root.add(history.mesh);

  // lamps: six seat lamps on the rail, phase and fair lamps behind the wheel
  const seatLamps: LampPart[] = [];
  const seats: SeatDef[] = [];
  SEAT_X.forEach((sx) => {
    const l = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
    l.root.position.set(sx, TOP + 0.01, 0.63);
    root.add(l.root);
    seatLamps.push(l);
    kit.cyl(0.17, 0.17, 0.05, { color: pal.leather }, { pos: [sx, 0.47, SEAT_Z], seg: 10, parent: root });
    kit.cyl(0.03, 0.05, 0.45, pal.chrome, { pos: [sx, 0.225, SEAT_Z], seg: 8, parent: root });
    seats.push({
      // framing: the whole betting layout, big, between the HUD banner and the control bar (the scene renders at ~300 x 224 px, so the
      // 36 cells only read when the board fills most of the frame; the wheel is out of shot, the winning number is marked on the layout
      // by the puck). The camera leans a little towards the seat so the six seats are still six views.
      pose: { pos: new THREE.Vector3(0.5 + sx * 0.03, 1.98, 0.68), look: new THREE.Vector3(0.5 + sx * 0.03, 0.8, 0.2), fov: 58, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, SEAT_Z + 0.02), avatar: 'sit',
    });
  });
  const phaseLamp = kit.lamp({ r: 0.025, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(WHEEL_X, TOP + 0.02, -0.6);
  root.add(phaseLamp.root);
  const fairLamp = kit.lamp({ r: 0.02, color: 0x7dff7a, shape: 'dome' });
  fairLamp.root.position.set(WHEEL_X + 0.25, TOP + 0.02, -0.6);
  root.add(fairLamp.root);

  // chips (instanced, public felt chips)
  const chips = kit.chips({ max: 600 });
  root.add(chips.root);

  // light pendant anchor and blob shadow
  root.add(kit.blobShadow(3.2, 2.0));
  const light = new THREE.Object3D();
  light.position.set(0, 2.2, 0);
  light.userData = { color: 0x7dff7a, intensity: 1.4, range: 4.5, flicker: 'BUZZ' };
  root.add(light);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.25, 0.6);
  root.add(prompt);
  const speaker = new THREE.Object3D();
  speaker.position.set(WHEEL_X, 0.95, 0);
  root.add(speaker);
  const wheelCam = new THREE.Object3D();
  wheelCam.position.set(-1.0, 1.6, 0.25);
  root.add(wheelCam);
  const servicePlate = new THREE.Object3D();
  servicePlate.position.set(1.36, 0.9, 0.5);
  root.add(servicePlate);
  const marqueeTop = new THREE.Object3D();
  marqueeTop.position.set(0, 2.8, 0);
  root.add(marqueeTop);
  const coinOut = new THREE.Object3D();
  coinOut.position.set(0, TOP + 0.02, 0.45);
  root.add(coinOut);

  const parts: RouletteParts = {
    wheel, rotor, ballPivot, ball, dolly, puck, rake, rim, history, chips, seatLamps, phaseLamp, fairLamp, layout, layoutTex,
  };
  kit.finalize(root, {
    keep: [wheel, ballPivot, puck, rake, rim.root, history.mesh, chips.root, ...seatLamps, phaseLamp, fairLamp, light, prompt, layout, numberRing, pocketRing],
  });

  return {
    root, parts, seats, playPose: seats[2].pose,
    colliders: [
      { min: [-1.36, 0, -0.66], max: [1.36, 0.82, 0.66] },
      { min: [-1.46, 0, -0.12], max: [-1.3, 1.25, 0.12] },
    ],
    interact: { min: [-1.45, 0.2, -0.9], max: [1.4, 1.2, 0.95] },
    anchors: {
      speaker, prompt, label: prompt, marqueeTop, servicePlate, wheelCam, light, coinOut,
    },
    dispose: () => history.dispose(),
  };
}


/**
 * Paints the betting layout into `canvasTex` (the plane covers LAYOUT_W x LAYOUT_H m at LAYOUT_PX texels per metre). Pocket-coloured
 * number cells with big numerals, the 2:1 column bets, dozens and the even-money row, all on the spots' own coordinates. Call again on
 * a language change (the labels follow the language).
 */
export function paintLayout(canvasTex: THREE.CanvasTexture, texgen: TexGenFull): void {
  const cv = canvasTex.image as HTMLCanvasElement;
  const g = cv.getContext('2d');
  if (!g) return;
  const S = LAYOUT_PX, x0 = LAYOUT_CX - LAYOUT_W / 2, z0 = LAYOUT_CZ - LAYOUT_H / 2;
  const X = (x: number): number => (x - x0) * S, Z = (z: number): number => (z - z0) * S;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#143d28'; g.fillRect(0, 0, cv.width, cv.height);
  const CREAM = '#f4ecd0', LINE = '#e8e0c0', INK = '#04120a';
  /** A cell [xa, xb] x [za, zb] (metres) with a fill and a cloth line round it. */
  const cell = (xa: number, xb: number, za: number, zb: number, fill: string): void => {
    g.fillStyle = fill; g.fillRect(X(xa), Z(za), (xb - xa) * S, (zb - za) * S);
    g.strokeStyle = LINE; g.lineWidth = 3; g.strokeRect(X(xa) + 1.5, Z(za) + 1.5, (xb - xa) * S - 3, (zb - za) * S - 3);
  };
  /** Text centred in a cell at the biggest px5 scale (<= max) that fits. */
  const label = (s: string, xa: number, xb: number, za: number, zb: number, color: string, max = 5): void => {
    if (!s) return;
    const w = (xb - xa) * S - 10, h = (zb - za) * S - 8;
    let k = max;
    while (k > 1 && (texgen.measure(s, { font: 'px5', scale: k }) > w || 7 * k > h)) k--;
    const cx = X((xa + xb) / 2) - 1, cy = Z((za + zb) / 2) - Math.floor(3.5 * k) - 1;
    // faux bold + a dark halo: the strokes have to survive the low-res target
    for (const [dx, dy] of [[-1, -1], [3, -1], [-1, 3], [3, 3], [1, -1], [1, 3], [-1, 1], [3, 1]]) texgen.drawText(g, s, cx + dx, cy + dy, { font: 'px5', scale: k, color: INK, align: 'center' });
    for (const [dx, dy] of [[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]]) texgen.drawText(g, s, cx + dx, cy + dy, { font: 'px5', scale: k, color, align: 'center' });
  };
  const gx = (c: number): number => LAYOUT_X0 + c * CELL_W;
  // zero, the 36 numbers, the three 2:1 column bets
  cell(gx(0) - CELL_W, gx(0), ROW_Z(0) - ROW_H / 2, ROW_Z(2) + ROW_H / 2, '#1e6b3a');
  label('0', gx(0) - CELL_W, gx(0), ROW_Z(0) - ROW_H / 2, ROW_Z(2) + ROW_H / 2, CREAM);
  for (let n = 1; n <= 36; n++) {
    const col = Math.floor((n - 1) / 3), row = 2 - ((n - 1) % 3);
    const za = ROW_Z(row) - ROW_H / 2, zb = ROW_Z(row) + ROW_H / 2;
    cell(gx(col), gx(col + 1), za, zb, colorOf(n) === 'red' ? '#9e1b22' : '#16161a');
    label(String(n), gx(col), gx(col + 1), za, zb, CREAM);
  }
  for (let row = 0; row < 3; row++) {
    const za = ROW_Z(row) - ROW_H / 2, zb = ROW_Z(row) + ROW_H / 2;
    cell(gx(12), gx(13), za, zb, '#0f3320');
    label('2:1', gx(12), gx(13), za, zb, '#ffd040', 3);
  }
  // dozens and the even-money row
  const dozens = [tr('tex.roulette.dozen1'), tr('tex.roulette.dozen2'), tr('tex.roulette.dozen3')];
  dozens.forEach((s, i) => {
    cell(gx(0) + i * 0.4, gx(0) + (i + 1) * 0.4, DOZ_Z - 0.06, DOZ_Z + 0.06, '#0f3320');
    label(upper(s), gx(0) + i * 0.4, gx(0) + (i + 1) * 0.4, DOZ_Z - 0.06, DOZ_Z + 0.06, CREAM);
  });
  const even = ['1-18', upper(tr('tex.roulette.even')), '', '', upper(tr('tex.roulette.odd')), '19-36'];
  even.forEach((s, i) => {
    const xa = gx(0) + i * 0.2, xb = xa + 0.2;
    cell(xa, xb, EVEN_Z - 0.065, EVEN_Z + 0.065, i === 2 ? '#9e1b22' : i === 3 ? '#16161a' : '#0f3320');
    label(s, xa, xb, EVEN_Z - 0.065, EVEN_Z + 0.065, CREAM);
  });
  canvasTex.needsUpdate = true;
}
