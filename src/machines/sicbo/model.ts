/**
 * Sic Bo "The Birdcage" — procedural model (MACHINES_tables §8, plan modelBrief). `buildModel` returns a full
 * `MachineModel`; the exported `SicBoParts` type is the contract with `index.ts`. Metres, origin = floor centre of the
 * footprint, +Z = player side.
 *
 * Footprint 2.40 W × 1.40 D × 1.60 H. A lit milk-glass layout (2.28 × 1.06 usable) on a 0.80 m top: one vertex-coloured
 * quad per bet spot (lit panels = one mesh, one draw), labels on a canvas overlay. Behind it, the cage on a brass
 * axle at y 1.20 with the crank on the right. Eight standing spots along the +Z side. Budget ≤ 1,300 tris, ≤ 20 draws.
 */
import * as THREE from 'three';
import type { ChipPool, DicePool, Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { SeatDef } from '@/core/types';
import { LAYOUT_ROWS } from './rules';

export type SicBoParts = {
  /** Pivot on the cage axle (along X, at y 1.20); `rotation.x` turns the cage. */
  cageSpin: THREE.Object3D;
  /** Brass crank on the right post. */
  crank: { root: THREE.Group; handle: THREE.Object3D; turn(rev: number, dur: number): Promise<void> };
  /** Three ivory dice, 0.040 m, one draw call each. */
  dice: DicePool;
  /** Rest points for the dice on the back strip (inside the bowl). */
  diceRest: THREE.Vector3[];
  /** Where the dice leave the cage (cage centre). */
  diceFrom: THREE.Vector3;
  /** One vertex-coloured mesh: 4 vertices per spot, colour = lamp state. */
  panels: THREE.Mesh;
  /** Label overlay (canvas texture, redrawn on language change). */
  labels: THREE.Mesh;
  labelCanvas: HTMLCanvasElement;
  labelTex: THREE.CanvasTexture;
  chips: ChipPool;
  /** Last 20 rolls as die-face lamps (120 × 24 px). */
  history: ScreenSurface;
  seatLamps: LampPart[];
  phaseLamp: LampPart;
  /** Brass "TRIPLE" stamp that drops onto the layout on a triple. */
  stamp: THREE.Object3D;
};

// ── layout geometry (pure) ─────────────────────────────────────────────────────────────────────
export const TOP = 0.80;                 // layout glass top
export const LAYOUT = { x0: -1.14, x1: 1.14, z0: -0.42, z1: 0.64, gap: 0.01, rowGap: 0.012 };
export const AXLE_Y = 1.20;
export const AXLE_Z = -0.55;
export const DICE_REST_Y = TOP + 0.02;
export const DICE_REST_Z = -0.62;
export const SEAT_COUNT = 8;
const SEAT_X = (i: number): number => -0.945 + i * 0.27;

export interface Cell { spot: string; x0: number; x1: number; z0: number; z1: number }

/** Lays the rows out back (row 0, near the cage) to front, cells left to right. Pure. */
export function layoutCells(): Cell[] {
  const { x0, x1, z0, z1, gap, rowGap } = LAYOUT;
  const rows = LAYOUT_ROWS.length;
  const h = (z1 - z0 - (rows - 1) * rowGap) / rows;
  const out: Cell[] = [];
  LAYOUT_ROWS.forEach((row, r) => {
    const n = row.length;
    const w = (x1 - x0 - (n - 1) * gap) / n;
    const zr = z0 + r * (h + rowGap);
    row.forEach((spot, i) => {
      const xc = x0 + i * (w + gap);
      out.push({ spot, x0: xc, x1: xc + w, z0: zr, z1: zr + h });
    });
  });
  return out;
}
export const CELLS: readonly Cell[] = layoutCells();
const CELL_BY_SPOT = new Map<string, Cell>(CELLS.map((c) => [c.spot, c]));

/** Felt-plane centre of a spot (machine-local x, z). Null for an unknown spot. */
export function spotXZ(spot: string): [number, number] | null {
  const c = CELL_BY_SPOT.get(spot);
  return c ? [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2] : null;
}

/** The spot under a layout point (machine-local x, z), or null between cells. */
export function spotAt(x: number, z: number): string | null {
  for (const c of CELLS) if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return c.spot;
  return null;
}

/** Label text per spot, filled by the caller (i18n). */
export type SpotLabel = (spot: string) => string;

/** Draws the layout labels onto a canvas of any size (pure 2D, no DOM lookups). */
export function drawLayoutLabels(g: CanvasRenderingContext2D, w: number, h: number, label: SpotLabel): void {
  g.clearRect(0, 0, w, h);
  const sx = w / (LAYOUT.x1 - LAYOUT.x0), sz = h / (LAYOUT.z1 - LAYOUT.z0);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const c of CELLS) {
    const cx = (c.x0 + c.x1 - 2 * LAYOUT.x0) / 2 * sx, cy = (c.z0 + c.z1 - 2 * LAYOUT.z0) / 2 * sz;
    const cw = (c.x1 - c.x0) * sx, ch = (c.z1 - c.z0) * sz;
    g.fillStyle = 'rgba(20,14,8,0.55)';
    g.fillRect(cx - cw / 2 + 1, cy - ch / 2 + 1, cw - 2, ch - 2);
    g.fillStyle = '#fff3d6';
    g.font = `bold ${Math.max(10, Math.floor(ch * 0.42))}px monospace`;
    g.fillText(label(c.spot), cx, cy + 1);
  }
}

export const DIM: [number, number, number] = [0.44, 0.42, 0.50];   // milk glass, lamp off (lifted for legibility at seat distance)
export const LIT: [number, number, number] = [1.0, 0.78, 0.24];  // #FFC83D

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<SicBoParts> {
  const { pal } = kit;
  const root = kit.group('sicbo');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const wood = o.variant % 2 ? pal.wood : pal.woodDark;

  // ── static shell (flat colours) ──
  kit.box(2.40, 0.76, 1.40, wood, at(0, 0.38, 0));                                     // cabinet body
  kit.box(2.44, 0.03, 1.44, pal.black, at(0, 0.765, 0));                               // rail
  kit.box(2.36, 0.04, 1.18, pal.cream, at(0, 0.78, 0.11));                             // milk-glass slab (top 0.80)
  for (const sx of [-1.2, 1.2]) kit.box(0.04, 1.6, 1.40, wood, at(sx, 0.80, 0));       // end panels
  kit.box(2.40, 0.10, 0.04, wood, at(0, 1.55, -0.70));                                 // back header
  kit.box(0.5, 0.02, 0.1, pal.brass, at(0, 0.82, -0.62));                              // dice-strip plate
  kit.cyl(0.035, 0.05, 0.27, pal.brass, { pos: [0, 0.935, AXLE_Z], seg: 8, parent: root }); // crank pedestal
  kit.cyl(0.10, 0.12, 0.04, pal.brass, { pos: [0, 0.80, AXLE_Z], seg: 12, parent: root });  // pedestal foot
  for (const sx of [-0.31, 0.31]) kit.cyl(0.025, 0.025, 0.40, pal.brass, { pos: [sx, 1.0, AXLE_Z], seg: 6, parent: root }); // axle posts
  kit.box(0.6, 0.02, 0.06, pal.brass, at(0, 1.57, AXLE_Z));                            // cage hanger bar
  kit.box(0.7, 0.04, 0.04, wood, at(0, 0.80, -0.56));                                   // bowl ledge

  // ── the cage (rotates about X) ──
  const cageSpin = new THREE.Object3D();
  cageSpin.position.set(0, AXLE_Y, AXLE_Z);
  root.add(cageSpin);
  const cageMesh = kit.cage({ r: 0.15, h: 0.55, bars: 12, color: pal.brass });
  cageMesh.rotation.z = Math.PI / 2;                                                    // cage axis along X
  cageSpin.add(cageMesh);
  for (const sx of [-0.275, 0.275]) kit.torus(0.15, 0.006, pal.brass, { pos: [sx, 0, 0], rot: [0, 90, 0], seg: 12, parent: cageSpin }); // hoops

  // crank on the right post
  const crank = kit.crank({ r: 0.09 });
  crank.root.position.set(0.37, AXLE_Y, AXLE_Z);
  crank.root.rotation.y = -Math.PI / 2;
  root.add(crank.root);

  // ── dice ──
  const dice = kit.dice({ count: 3, size: 0.05, body: 0xf2ead8, pip: 0x1a0f0c });
  const diceRest = [-0.12, 0, 0.12].map((x) => new THREE.Vector3(x, DICE_REST_Y, DICE_REST_Z));
  dice.dice.forEach((m, i) => { m.position.copy(diceRest[i]); root.add(m); });
  const diceFrom = new THREE.Vector3(0, AXLE_Y, AXLE_Z);

  // ── lit panels: one mesh, per-vertex colour ──
  const n = CELLS.length;
  const pos = new Float32Array(n * 4 * 3), col = new Float32Array(n * 4 * 3), idx: number[] = [];
  CELLS.forEach((c, i) => {
    const corners: Array<[number, number]> = [[c.x0, c.z0], [c.x0, c.z1], [c.x1, c.z1], [c.x1, c.z0]];
    corners.forEach(([x, z], k) => {
      const v = (i * 4 + k) * 3;
      pos.set([x, TOP + 0.012, z], v);   // 1.2 cm over the slab: the low-res depth buffer z-fights below ~1 cm at 2 m
      col.set(DIM, v);
    });
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const panels = new THREE.Mesh(geo, kit.mat({ color: 0xffffff, lit: false, vertexColors: true }));
  panels.name = 'layout';
  root.add(panels);

  // label overlay (canvas texture, language-dependent; repainted by index.ts)
  // sheet sized to the PSX pixels it covers (psxMaterial forces nearest, no mips): ~1 texel per screen pixel
  const LW = 512, LH = Math.round((LW * (LAYOUT.z1 - LAYOUT.z0)) / (LAYOUT.x1 - LAYOUT.x0));
  const labelTex = kit.tex.canvas(LW, LH, () => undefined);
  labelTex.colorSpace = THREE.NoColorSpace;
  const labelCanvas = labelTex.image as HTMLCanvasElement;
  // blended, not alpha-tested: the 55 % cell fill would otherwise break into blotches under mip filtering
  const labels = kit.plane(LAYOUT.x1 - LAYOUT.x0, LAYOUT.z1 - LAYOUT.z0,
    kit.mat({ map: labelTex, lit: false, transparent: true, alphaTest: 0.01 }),
    { pos: [0, TOP + 0.02, (LAYOUT.z0 + LAYOUT.z1) / 2], rot: [-90, 0, 0], shade: false, name: 'labels' });
  root.add(labels);

  // ── history board ──
  const history = kit.screen({ w: 0.6, h: 0.12, px: [120, 24], bezel: pal.black });
  history.mesh.position.set(0, 1.55, -0.64);
  root.add(history.mesh);

  // ── seats, lamps ──
  const seatLamps: LampPart[] = [];
  const seats: SeatDef[] = [];
  for (let i = 0; i < SEAT_COUNT; i++) {
    const sx = SEAT_X(i);
    const l = kit.lamp({ r: 0.018, color: pal.gold, shape: 'dome' });
    l.root.position.set(sx, TOP + 0.01, 0.69);
    root.add(l.root);
    seatLamps.push(l);
    seats.push({
      // seat standard (1024x768 and 1280x720): whole layout, dice and cage in frame, clear of the HUD strips
      pose: { pos: new THREE.Vector3(sx * 0.25, 1.85, 2.05), look: new THREE.Vector3(0, 0.78, -0.2), fov: 64, mouse: 'pick' },
      stand: new THREE.Vector3(sx, 0, 0.92),
      avatar: 'stand',
    });
  }
  const phaseLamp = kit.lamp({ r: 0.02, color: pal.gold, shape: 'dome' });
  phaseLamp.root.position.set(-1.0, TOP + 0.01, -0.62);
  root.add(phaseLamp.root);

  // brass TRIPLE stamp (hidden until a triple drops)
  const stamp = kit.label({ text: { key: 'm.sicbo.triple' }, w: 0.24, h: 0.07, color: 0xffd040, bg: 0x2a1c0a }).mesh;
  stamp.position.set(0, 1.1, 0.10);
  stamp.visible = false;
  root.add(stamp);

  // chips (public felt chips)
  const chips = kit.chips({ max: 400 });
  root.add(chips.root);

  // ── anchors and lights ──
  root.add(kit.blobShadow(2.6, 1.5));
  const light = new THREE.Object3D();
  light.position.set(0, 0.84, DICE_REST_Z);
  light.userData = { color: 0xffc83d, intensity: 0.5, range: 1.2 };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, 1.1, 0.11);
  light2.userData = { color: 0xffc83d, intensity: 0.4, range: 2 };
  root.add(light2);
  const speaker = new THREE.Object3D(); speaker.position.set(-1.25, 0.9, 0.0); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.25, 0.85); root.add(prompt);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, 1.95, 0); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(1.24, 0.9, 0.5); root.add(servicePlate);
  const cageCam = new THREE.Object3D(); cageCam.position.set(0.6, 1.45, 0.2); root.add(cageCam);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, TOP + 0.02, 0.5); root.add(coinOut);

  const parts: SicBoParts = {
    cageSpin, crank, dice, diceRest, diceFrom, panels, labels, labelCanvas, labelTex, chips, history, seatLamps, phaseLamp, stamp,
  };
  kit.finalize(root, {
    keep: [
      cageSpin, crank.root, panels, labels, chips.root, history.mesh, ...seatLamps, phaseLamp.root, stamp, light, light2,
      ...dice.dice,
    ],
  });

  return {
    root,
    parts,
    seats,
    playPose: seats[3].pose,
    colliders: [
      { min: [-1.2, 0, -0.7], max: [1.2, 0.8, 0.7] },
      { min: [-0.06, 0, -0.6], max: [0.06, 1.0, -0.5] },
    ],
    interact: { min: [-1.25, 0.2, -0.8], max: [1.25, 1.6, 0.95] },
    anchors: { speaker, prompt, label: prompt, marqueeTop, servicePlate, cageCam, light, light2, coinOut },
    dispose: () => history.dispose(),
  };
}
