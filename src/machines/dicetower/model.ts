/**
 * Dice Tower "Zar Kulesi" — procedural model (plan modelBrief, MACHINES_machines §13, ART_BIBLE §5.32). Pattern: `buildModel`
 * returns a full `MachineModel`; the exported `DicetowerParts` type is the contract with `index.ts`. Metres, origin = floor
 * centre of the 2.40 × 1.80 footprint, +Z = the players' side, the tower stands at the back.
 *
 * Round felt table Ø1.30 at 0.90 m (centre z −0.15), purple felt with a gold bet print (one canvas, 16 spots in four rows).
 * The walnut tower stands on the felt at the back edge (0.90 m above the felt, top at 1.80 m) with brass bands, five lit
 * floor strips, four baffle slits and a funnel. Dice tray in front of the tower base, four stools on radius 0.85 m.
 * Budget ≤ 1,300 tris, ≤ 20 draws.
 */
import * as THREE from 'three';
import type { ChipPool, DicePool, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineModel, SeatDef } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { makeCanvas } from '@/core/texgen/pixel';
import { PAY_TEXT, SPOTS, exactOf } from './rules';

export type DicetowerParts = {
  /** Walnut tower body (a Group; the funnel and the cuckoo hang from it). */
  tower: THREE.Object3D;
  /** Five lit floor strips on the tower front (emissive, one material each). */
  towerFloors: THREE.Mesh[];
  /** Four slit windows on the tower front. They glow orange on doubles. */
  slits: THREE.Mesh[];
  /** Four baffle anchors inside the tower (entry points for the dice path). */
  baffles: THREE.Object3D[];
  /** Two translucent red dice. */
  dice: DicePool;
  /** Tray in front of the tower base (anchor for the rest pose). */
  tray: THREE.Object3D;
  /** Public felt chips (all seats). */
  chips: ChipPool;
  /** Brass result board on the tower base: flip digits. */
  resultBoard: ScreenSurface;
  /** Twelve history pegs (last totals), newest first. */
  historyPegs: LampPart[];
  /** Spring skull that pops out of the funnel on snake eyes and boxcars. */
  skullCuckoo: THREE.Object3D;
  /** Brass-caged phase bulb and the fairness lamp, both on the tower base. */
  phaseLamp: LampPart;
  fairLamp: LampPart;
  /** One credit/bet/win meter per seat, on the rim. */
  railMeters: ScreenSurface[];
  /** One lamp per seat, on the rim (lit while the seat holds a player). */
  seatLamps: LampPart[];
  /** Bet print plane (pointer hit-test) and its paint source. */
  layout: THREE.Mesh;
  layoutCanvas: HTMLCanvasElement;
  layoutTex: THREE.CanvasTexture;
  /** Funnel exit and the two tray rest points, root space. */
  diceFrom: THREE.Vector3;
  diceRest: THREE.Vector3[];
  /** Desk light over the table (pooled-light anchor). */
  light: THREE.Object3D;
};

export const TZ = -0.15;             // table centre z
export const TOP = 0.9;              // felt height
export const TOW_Z = -0.72;          // tower centre z (stands on the far rim)
export const SEATS = 4;
export const SEAT_ANGLE_DEG: readonly number[] = [-70, -25, 25, 70];
const SEAT_R = 0.85;
export const DICE_REST: readonly [number, number, number][] = [[-0.06, TOP + 0.03, -0.42], [0.06, TOP + 0.03, -0.42]];
export const DICE_FROM: readonly [number, number, number] = [0, 1.7, TOW_Z];

// ── bet print: 16 spots (felt-plane x, root z) in four rows, far to near ──────────────────────
const ROW_Z = [0.40, 0.26, 0.12, -0.02];
const LAYOUT_W = 512, LAYOUT_H = 338;
export const LAYOUT_CX = 0, LAYOUT_CZ = TZ + 0.12, LAYOUT_WM = 1.0, LAYOUT_DM = 0.66;

const ROWS: ReadonlyArray<ReadonlyArray<[string, number]>> = [
  [['under', -0.34], ['lucky7', 0], ['over', 0.34]],
  [['doubles', -0.34], ['field', 0], ['corners', 0.34]],
  [['exact:2', -0.40], ['exact:3', -0.20], ['exact:4', 0], ['exact:5', 0.20], ['exact:6', 0.40]],
  [['exact:12', -0.40], ['exact:11', -0.20], ['exact:10', 0], ['exact:9', 0.20], ['exact:8', 0.40]],
];
/** Root-space centre of every spot. */
export const SPOT_XZ: Readonly<Record<string, [number, number]>> = (() => {
  const m: Record<string, [number, number]> = {};
  ROWS.forEach((row, r) => row.forEach(([s, x]) => { m[s] = [x, TZ + ROW_Z[r]]; }));
  return m;
})();
/** Spot box size (metres): wide boxes on the odds rows, narrow boxes on the exact rows. */
const boxOf = (spot: string): [number, number] => (exactOf(spot) !== null ? [0.16, 0.10] : [0.30, 0.10]);

/** Spot id under a root-space point (within the box), or null. */
export function spotAt(x: number, z: number): string | null {
  for (const s of SPOTS) {
    const [cx, cz] = SPOT_XZ[s];
    const [w, h] = boxOf(s);
    if (Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= h / 2) return s;
  }
  return null;
}

/** Paints the bet print: spot boxes with the name and the pay. `label(key, n)` maps to the current language. */
export function drawLayout(c: HTMLCanvasElement, label: (key: string, n?: number) => string): void {
  const g = c.getContext('2d');
  if (!g) return;
  const x0 = LAYOUT_CX - LAYOUT_WM / 2, z0 = LAYOUT_CZ - LAYOUT_DM / 2;
  const px = (x: number): number => ((x - x0) / LAYOUT_WM) * LAYOUT_W;
  const pz = (z: number): number => ((z - z0) / LAYOUT_DM) * LAYOUT_H;
  g.fillStyle = '#2a1340';
  g.fillRect(0, 0, LAYOUT_W, LAYOUT_H);
  g.strokeStyle = '#e8c060';
  g.fillStyle = '#e8c060';
  g.lineWidth = 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const s of SPOTS) {
    const [cx, cz] = SPOT_XZ[s];
    const [w, h] = boxOf(s);
    const ex = exactOf(s);
    const bx = px(cx), by = pz(cz), bw = (w / LAYOUT_WM) * LAYOUT_W, bh = (h / LAYOUT_DM) * LAYOUT_H;
    g.strokeRect(bx - bw / 2, by - bh / 2, bw, bh);
    g.font = ex !== null ? 'bold 22px monospace' : 'bold 20px monospace';
    const name = ex !== null ? label('lay.exact', ex) : label(`lay.${s}`);
    g.fillText(name, bx, by - bh * 0.16);
    g.font = '18px monospace';
    g.fillText(PAY_TEXT[s] ?? '', bx, by + bh * 0.26);
  }
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<DicetowerParts> {
  const { pal } = kit;
  const root = kit.group('dicetower');
  const felt = 0x3b1e54, brass = 0xb08830, red = 0xd0102a;
  const walnut = o.variant % 2 ? pal.wood : 0x3e2414;

  // ── round table (kit felt table, seats placed by us below) ──
  const ft = kit.feltTable({ shape: 'round', w: 1.3, d: 1.3, h: TOP, felt, rail: pal.woodDark, seats: SEATS, stools: false, dealer: false });
  ft.root.position.set(0, 0, TZ);
  root.add(ft.root);

  // ── bet print on the felt ──
  const [layoutCanvas] = makeCanvas(LAYOUT_W, LAYOUT_H);
  drawLayout(layoutCanvas, (k) => k);
  const layoutTex = new THREE.CanvasTexture(layoutCanvas);
  layoutTex.colorSpace = THREE.NoColorSpace;
  const layoutMat = kit.mat({ map: layoutTex, lit: false, side: 'double', snap: false, affine: false });
  const layout = kit.plane(LAYOUT_WM, LAYOUT_DM, layoutMat, { pos: [LAYOUT_CX, TOP + 0.004, LAYOUT_CZ], rot: [-90, 0, 0], shade: false, name: 'layout' });
  root.add(layout);

  // ── tower: stepped walnut body on the far rim, brass bands, funnel (group y is absolute, the felt is at TOP) ──
  const tower = new THREE.Group();
  tower.position.set(0, 0, TOW_Z);
  root.add(tower);
  const tw = (w: number, h: number, d: number, y: number, m: number): THREE.Mesh =>
    kit.box(w, h, d, m, { pos: [0, y, 0], parent: tower });
  tw(0.30, 0.35, 0.30, 1.075, walnut);                              // base 0.90 → 1.25
  tw(0.24, 0.27, 0.24, 1.385, walnut);                              // mid  1.25 → 1.52
  tw(0.18, 0.20, 0.18, 1.62, walnut);                               // top  1.52 → 1.72
  for (const [w, y] of [[0.32, 1.25], [0.26, 1.52], [0.20, 1.72]] as const) tw(w, 0.025, w, y, brass);
  kit.cyl(0.10, 0.04, 0.05, brass, { pos: [0, 1.745, 0], seg: 10, parent: tower });   // funnel 1.72 → 1.77

  // slit windows (front faces: base 0.151, mid 0.121, top 0.091), baffles = dice-path entry points
  const slitSpec: Array<[number, number]> = [[1.00, 0.151], [1.20, 0.151], [1.46, 0.121], [1.60, 0.091]];
  const slits: THREE.Mesh[] = slitSpec.map(([y, z], i) =>
    kit.box(0.12, 0.02, 0.01, { color: 0x0a0604 + i, emissive: 0x000000 }, { pos: [0, y, z], parent: tower }));
  const baffles: THREE.Object3D[] = slitSpec.map(([y], i) => {
    const b = new THREE.Object3D();
    b.position.set(0, y, i % 2 ? 0.03 : -0.03);
    tower.add(b);
    return b;
  });
  // five lit floor strips on the mid and top front faces
  const towerFloors: THREE.Mesh[] = [[1.32, 0.121], [1.38, 0.121], [1.56, 0.091], [1.62, 0.091], [1.68, 0.091]].map(([y, z], i) =>
    kit.box(0.13, 0.03, 0.01, { color: 0x3a2a10 + i, emissive: 0x000000 }, { pos: [0, y, z], parent: tower }));

  // history pegs (last totals) and the result board on the tower base front
  const historyPegs: LampPart[] = Array.from({ length: 12 }, (_, i) => {
    const l = kit.lamp({ r: 0.010, color: 0x2a2a2a, shape: 'dome' });
    l.root.position.set(-0.132 + i * 0.024, 0.94, 0.152);
    tower.add(l.root);
    return l;
  });
  const resultBoard = kit.screen({ w: 0.16, h: 0.07, px: [96, 40], bezel: brass, glow: 0.7 });
  resultBoard.mesh.position.set(0, 1.12, 0.152);
  tower.add(resultBoard.mesh);

  // skull cuckoo in the funnel (rests at 1.70, pops up to 1.76 on snake eyes and boxcars)
  const skullCuckoo = new THREE.Object3D();
  skullCuckoo.position.set(0, 1.70, 0);
  tower.add(skullCuckoo);
  kit.sphere(0.02, pal.bone, { pos: [0, 0, 0], wSeg: 6, hSeg: 4, parent: skullCuckoo });
  kit.box(0.02, 0.008, 0.012, pal.black, { pos: [0, -0.012, 0.012], parent: skullCuckoo });

  // lamps on the tower base sides
  const phaseLamp = kit.lamp({ r: 0.03, color: 0x4a3a10, shape: 'bulb' });
  phaseLamp.root.position.set(0.16, 1.10, 0);
  tower.add(phaseLamp.root);
  const fairLamp = kit.lamp({ r: 0.015, color: 0x1a2a1a, shape: 'dome' });
  fairLamp.root.position.set(-0.16, 1.10, 0);
  tower.add(fairLamp.root);

  // ── dice tray in front of the tower and the two dice ──
  const tray = new THREE.Object3D();
  tray.position.set(0, TOP, -0.42);
  root.add(tray);
  kit.box(0.40, 0.012, 0.22, 0x1e0c2c, { pos: [0, 0.006, 0], parent: tray });
  kit.box(0.40, 0.03, 0.012, pal.woodDark, { pos: [0, 0.015, -0.11], parent: tray });
  kit.box(0.40, 0.03, 0.012, pal.woodDark, { pos: [0, 0.015, 0.11], parent: tray });
  kit.box(0.012, 0.03, 0.22, pal.woodDark, { pos: [-0.2, 0.015, 0], parent: tray });
  kit.box(0.012, 0.03, 0.22, pal.woodDark, { pos: [0.2, 0.015, 0], parent: tray });
  const dice = kit.dice({ count: 2, size: 0.035, body: red, pip: 0xffffff });
  dice.dice.forEach((m, i) => { m.position.set(...DICE_REST[i]); root.add(m); });

  // ── chips, lamps and meters on the rim ──
  const chips = kit.chips({ max: 200 });
  root.add(chips.root);
  const seatLamps: LampPart[] = [];
  const railMeters: ScreenSurface[] = [];
  const seats: SeatDef[] = [];
  SEAT_ANGLE_DEG.forEach((deg) => {
    const a = (deg * Math.PI) / 180;
    const sx = Math.sin(a), sz = Math.cos(a);
    const lamp = kit.lamp({ r: 0.018, color: pal.gold, shape: 'dome' });
    lamp.root.position.set(sx * 0.64, TOP + 0.02, TZ + sz * 0.64);
    root.add(lamp.root);
    seatLamps.push(lamp);
    const meter = kit.screen({ w: 0.12, h: 0.04, px: [64, 22], bezel: pal.black, glow: 0.5 });
    meter.mesh.position.set(sx * 0.6, TOP + 0.08, TZ + sz * 0.6);
    meter.mesh.rotation.y = a;
    root.add(meter.mesh);
    railMeters.push(meter);
    const stand = new THREE.Vector3(sx * SEAT_R, 0, TZ + sz * SEAT_R);
    const pose = { pos: new THREE.Vector3(sx * 0.9, 1.45, TZ + sz * 0.9), look: new THREE.Vector3(0, 0.95, TZ), fov: 60, mouse: 'pick' as const };
    seats.push({ pose, stand, avatar: 'sit', standY: 0.68 });
    const stool = kit.stool({ h: 0.68, seat: pal.red });
    stool.position.copy(stand);
    root.add(stool);
  });

  // ── light, prompt and anchors ──
  root.add(kit.blobShadow(2.0, 1.6));
  const light = new THREE.Object3D();
  light.position.set(0, 1.95, TOW_Z + 0.25);
  light.userData = { color: 0xffe2a0, intensity: 0.8, range: 2.6, flicker: 'STEADY' };
  root.add(light);
  const speaker = new THREE.Object3D(); speaker.position.set(0, TOP, TZ + 0.45); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 0.75); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 1.25, -0.82); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.78, TOW_Z); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.7, 0.9, 0.3); root.add(servicePlate);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, TZ + 0.2); root.add(coinOut);

  const diceFrom = new THREE.Vector3(...DICE_FROM);
  const parts: DicetowerParts = {
    tower, towerFloors, slits, baffles, dice, tray, chips, resultBoard, historyPegs, skullCuckoo, phaseLamp, fairLamp,
    railMeters, seatLamps, layout, layoutCanvas, layoutTex, diceFrom,
    diceRest: DICE_REST.map((p) => new THREE.Vector3(...p)), light,
  };
  kit.finalize(root, {
    keep: [
      tower, skullCuckoo, chips.root, layout, light, tray, ...dice.dice, ...towerFloors, ...slits, ...historyPegs.map((p) => p.root),
      phaseLamp.root, fairLamp.root, ...seatLamps.map((l) => l.root), ...railMeters.map((s) => s.mesh), resultBoard.mesh,
    ],
  });

  return {
    root, parts, seats, playPose: seats[2].pose,
    colliders: [
      { min: [-0.66, 0, TZ - 0.66], max: [0.66, TOP, TZ + 0.66] },
      { min: [-0.15, 0, TOW_Z - 0.15], max: [0.15, 1.8, TOW_Z + 0.15] },
    ],
    interact: { min: [-1.1, 0.2, -0.9], max: [1.1, 1.6, 0.9] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, coinOut, light },
    dispose: () => { resultBoard.dispose(); layoutTex.dispose(); },
  };
}
