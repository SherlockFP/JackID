/**
 * Stacker — procedural model (MACHINES_machines §16, PLAN machines[id=stacker].modelBrief, ART §5.25 "tower stack").
 *
 * Black tower, 0.90 W × 0.80 D × 2.30 H m. Origin = floor centre, +Z = front. White neon edges on the front corners and
 * the top. A 7 × 15 LED block grid (0.07 m cells) sits in a black P01 frame at y 0.75–1.85. A gold strip marks row 15 (MAJOR)
 * and an amber strip marks row 10 (MINOR). A painted night-sky cap carries the marquee. Above the grid, a prize window
 * shows the MAJOR charm capsule on a turntable. A STOP dome sits on the deck at 1.0 m. Row 16 is a faint ghost row.
 *
 * Grid contract: cell (col, row) with col 0..6 left→right and row 0..14 bottom→top (row 0 = game row 1). Instance index =
 * row·7 + col. `cellPos` gives the cell centre in model-local metres. `setCell` paints one instance (the lit colour is
 * `LIT`, the dark one `OFF`).
 *
 * BUDGET (ART §1.11, M slot brief): ≤ 800 tris, ≤ 14 draws. Draw plan: static shell (merged) 1 · grid (instanced) 1 ·
 * ghost row 1 · bands 2 · prize turntable 1 · capsule 1 · STOP dome 1 · LED panel 1 · LED row 1 · marquee 2 = 12.
 */
import * as THREE from 'three';
import type { Kit, ScreenSurface, MarqueePart } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { COLS, ROWS, MINOR_ROW, MAJOR_ROW } from './rules';

export const W = 0.9, H = 2.3, D = 0.8;
export const CELL = 0.07;
/** Grid base y (bottom of row 0) and the frame. */
export const GRID_Y0 = 0.75;
export const FRONT_Z = 0.2;
export const OFF = 0x4a1414, LIT = 0xff3c3c, AMBER = 0xffb020, GOLD = 0xffd040;   // OFF lifted from near-black: the unlit rows read as a column

/** Cell centre in model-local metres. */
export function cellPos(col: number, row: number): { x: number; y: number } {
  return { x: (col - (COLS - 1) / 2) * CELL, y: GRID_Y0 + CELL / 2 + row * CELL };
}

/** Paint one grid instance (row 0..14, col 0..6). Colour is a hex value; `null` = off. */
export function setCell(grid: THREE.InstancedMesh, col: number, row: number, hex: number | null): void {
  const ic = grid.instanceColor as THREE.InstancedBufferAttribute | null;
  if (!ic) return;
  const c = new THREE.Color(hex ?? OFF);
  ic.setXYZ(row * COLS + col, c.r, c.g, c.b);
  ic.needsUpdate = true;
}

/** Contract with the coder (`index.ts`). */
export type StackerParts = {
  /** 105 LED cells (instanced, instance colour). Index = row·COLS + col. */
  grid: THREE.InstancedMesh;
  /** Amber strip under row 10 (MINOR) and gold strip over row 15 (MAJOR). */
  bands: { minor: THREE.Mesh; major: THREE.Mesh };
  /** Row 16: a faint emissive row above the grid (horror twist, 5 % opacity). */
  ghostRow: THREE.Mesh;
  /** Prize window turntable (rotates Y at 0.5 rad/s in `frame`) and the anchor where the capsule sits. */
  prizeTurntable: THREE.Object3D;
  prizeAnchor: THREE.Object3D;
  /** MAJOR charm capsule on the turntable (hidden until a MAJOR). */
  capsule: THREE.Mesh;
  /** Physical STOP dome on the deck. */
  buttons: { stop: THREE.Mesh };
  /** Credit / bet / win panel and the 2-digit row readout. */
  leds: { panel: ScreenSurface; row: ScreenSurface };
  marquee: MarqueePart;
};

export function buildModel(kit: Kit, _o: ModelOpts): MachineModel<StackerParts> {
  const { pal } = kit;
  const root = kit.group('stacker');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const black = 0x0a0a0a, white = 0xf0f0ff, steel = pal.steel, brass = pal.brass;

  // ── static shell: flat colours, merged by kit.finalize into one draw ─────────────────────────────
  kit.box(W, 1.0, 0.6, black, at(0, 0.5, -0.1));                      // lower cabinet (y 0–1.0)
  kit.box(W, 1.3, 0.6, black, at(0, 1.65, -0.1));                     // upper cabinet (y 1.0–2.3)
  kit.box(W, 0.2, 0.6, black, at(0, 2.2, -0.1));                      // painted night-sky cap (y 2.1–2.3)
  kit.box(W, 0.03, 0.2, steel, at(0, 1.0, 0.3));                      // deck shelf, front z 0.2–0.4
  kit.box(0.012, H, 0.012, white, at(-W / 2 + 0.006, H / 2, FRONT_Z + 0.006));   // neon front edges
  kit.box(0.012, H, 0.012, white, at(W / 2 - 0.006, H / 2, FRONT_Z + 0.006));
  kit.box(W, 0.012, 0.012, white, at(0, H - 0.006, FRONT_Z + 0.006));           // neon top edge
  kit.box(0.6, 1.15, 0.02, black, at(0, 1.3, FRONT_Z + 0.01));                 // P01 LED frame (y 0.725–1.875)
  kit.box(0.5, 0.02, 0.02, brass, at(0, 0.66, FRONT_Z + 0.01));              // coin tray lip
  kit.box(0.08, 0.05, 0.02, brass, at(0.36, 0.87, FRONT_Z + 0.01));          // label badge

  // ── LED grid: 105 instanced cells, instance colour ─────────────────────────────────────────────
  const cellGeo = new THREE.PlaneGeometry(CELL * 0.88, CELL * 0.88);
  const grid = new THREE.InstancedMesh(cellGeo, kit.mat({ color: 0xffffff, lit: false }), COLS * ROWS);
  const m4 = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = cellPos(c, r);
    m4.makeTranslation(p.x, p.y, FRONT_Z + 0.025);
    grid.setMatrixAt(r * COLS + c, m4);
  }
  grid.instanceMatrix.needsUpdate = true;
  grid.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(COLS * ROWS * 3), 3);
  const off = new THREE.Color(OFF);
  for (let i = 0; i < COLS * ROWS; i++) grid.instanceColor.setXYZ(i, off.r, off.g, off.b);
  root.add(grid);

  // ── MINOR (row 10) and MAJOR (row 15) strips ───────────────────────────────────────────────────
  const minorY = cellPos(0, MINOR_ROW - 1).y - CELL / 2 - 0.008;
  const majorY = cellPos(0, MAJOR_ROW - 1).y + CELL / 2 + 0.008;
  const minor = kit.box(0.56, 0.014, 0.012, AMBER, at(0, minorY, FRONT_Z + 0.03));
  const major = kit.box(0.56, 0.014, 0.012, GOLD, at(0, majorY, FRONT_Z + 0.03));

  // ── ghost row 16 (5 % emissive, horror twist) ──────────────────────────────────────────────────
  const ghostRow = kit.plane(COLS * CELL, CELL, kit.mat({ color: LIT, lit: false, transparent: true, opacity: 0.05 }),
    { pos: [0, cellPos(0, ROWS).y, FRONT_Z + 0.03], parent: root });

  // ── prize window: turntable + MAJOR charm capsule (both kept: they move or toggle) ─────────────
  kit.box(0.5, 0.18, 0.02, black, at(0, 1.97, FRONT_Z + 0.01));
  const prizeTurntable = new THREE.Object3D();
  prizeTurntable.position.set(0, 1.9, FRONT_Z - 0.06);
  root.add(prizeTurntable);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 12), kit.mat(brass));
  prizeTurntable.add(plate);
  const prizeAnchor = new THREE.Object3D();
  prizeAnchor.position.set(0, 0.04, 0);
  prizeTurntable.add(prizeAnchor);
  const capsule = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), kit.mat({ color: GOLD, lit: true }));
  capsule.position.set(0, 0.05, 0);
  capsule.visible = false;
  prizeAnchor.add(capsule);

  // ── STOP dome on the deck ──────────────────────────────────────────────────────────────────────
  const stop = kit.sphere(0.12, LIT, { pos: [0, 1.015, 0.3], parent: root, hemi: true, wSeg: 10, hSeg: 4 });

  // ── LED panel (credit / bet / win) and 2-digit row readout ─────────────────────────────────────
  const panel = kit.screen({ w: 0.34, h: 0.1, px: [136, 40], bezel: black });
  panel.mesh.position.set(-0.1, 0.86, FRONT_Z + 0.012);
  root.add(panel.mesh);
  const row = kit.screen({ w: 0.12, h: 0.06, px: [32, 16], bezel: black });
  row.mesh.position.set(0.3, 0.86, FRONT_Z + 0.012);
  root.add(row.mesh);

  // ── marquee on the sky cap ─────────────────────────────────────────────────────────────────────
  const marquee = kit.marquee({ w: 0.7, h: 0.12, text: { key: 'm.stacker.name' }, color: white, bg: black, bulbs: 14 });
  marquee.root.position.set(0, 2.2, FRONT_Z + 0.012);
  root.add(marquee.root);

  // ── light hint, anchors ────────────────────────────────────────────────────────────────────────
  const light = new THREE.Object3D();
  light.position.set(0, 1.5, 0.75);   // in front of the column: lights the grid face and the deck, not just the cabinet
  light.userData = { color: LIT, intensity: 0.9, range: 2.2, flicker: 'STEADY' };
  root.add(light);
  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D(); a.position.set(x, y, z); root.add(a); return a;
  };
  const speaker = anchor(0, 1.1, 0.25);
  const prompt = marquee.root;
  const label = anchor(0, 0.55, FRONT_Z + 0.02);
  const marqueeTop = anchor(0, H, 0);
  const servicePlate = anchor(-W / 2 + 0.02, 1.2, -0.1);
  const stand = anchor(0, 0, 0.6);
  const coinOut = anchor(0.3, 0.86, 0.3);

  const parts: StackerParts = {
    grid, bands: { minor, major }, ghostRow, prizeTurntable, prizeAnchor, capsule,
    buttons: { stop }, leds: { panel, row }, marquee,
  };
  kit.finalize(root, {
    keep: [grid, minor, major, ghostRow, prizeTurntable, stop, panel.mesh, row.mesh, marquee.root, light],
  });

  return {
    root,
    parts,
    // seat standard: the whole stack grid, the STOP dome and the panel in frame, clear of both HUD strips
    playPose: { pos: new THREE.Vector3(0, 1.45, 1.95), look: new THREE.Vector3(0, 1.38, 0), fov: 62, mouse: 'primary' },
    colliders: [{ min: [-W / 2, 0, -0.4], max: [W / 2, H, FRONT_Z] }],
    interact: { min: [-W / 2, 0.3, -0.4], max: [W / 2, H, 0.6] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light },
    dispose: () => { panel.dispose(); row.dispose(); },
  };
}

/** Rows used for the bands (game rows 10 and 15), exported for the coder. */
export { MINOR_ROW, MAJOR_ROW };
