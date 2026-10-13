/**
 * Plinko Board — procedural model (MACHINES_machines §9, PLAN machines[id=plinko].modelBrief, ART §5.13 "peg drop").
 *
 * Upright M-slot wall board, 1.20 W × 0.35 D × 2.40 H m (footprint 1.2 × 1.0 m). Origin = floor centre, +Z = front.
 * Walnut frame, black P01 backboard with a gold-leaf border, front glass, 12 peg rows (row k has k + 2 pegs; pitch
 * dx 0.08 × dy 0.09), six pegs swapped for porcelain mannequin fingers, five translucent pucks, a 13-slot multiplier
 * plate and lamp row, a chute on the top rail, the three-window LED strip, a LOW/MID/HIGH risk lever and a marquee.
 *
 * Geometry contract (index.ts drops pucks along it): top funnel at FUNNEL_Y; row k (1..12) at y = ROW1_Y − (k−1)·dy,
 * peg x = −(k+1)·dx/2 + j·dx, j = 0..k+1; bottom slot s (0..12) centre x = (s − 6)·dx, puck rests at LAND_Y.
 *
 * BUDGET (ART §1.11, M slot): ≤ 1,200 tris, ≤ 14 draws. Draw plan: static shell (merged) 1 · glass 1 · pegs
 * (instanced) 1 · fingers (instanced) 1 · pucks (instanced) 1 · slot plate 1 · slot lamps (instanced) 1 · risk lever 1 ·
 * LED strip 1 · marquee 2 · chute 1 = 12. Pegs are 4-face tetrahedra (96 × 4 tris), the rest is flat-coloured.
 */
import * as THREE from 'three';
import type { Kit, ScreenSurface, MarqueePart } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { createRng, type Rng } from '@/core/rng';

export const W = 1.2, D = 0.35, H = 2.4, FOOT_D = 1.0;
export const ROWS = 12;
export const DX = 0.08, DY = 0.09;
export const FUNNEL_Y = 2.12;                 // puck start height (top funnel mouth)
export const ROW1_Y = FUNNEL_Y - 0.3;         // row 1 sits 0.30 m below the funnel
export const LAND_Y = 0.5;                    // resting height of a puck in its slot
export const SLOT_PLATE_Y = 0.47, LAMP_Y = 0.6;
export const PUCK_R = 0.035, PUCK_T = 0.012;
export const PEG_R = 0.008;
export const BOARD_Z = 0.12;                  // front-to-back of pegs (z = 0)
const BACK_Z = -0.16, GLASS_Z = 0.165;
export const PUCKS = 5;

/** Peg x for row k (1..12) and index j (0..k+1). */
export const pegX = (k: number, j: number): number => -((k + 1) * DX) / 2 + j * DX;
export const pegY = (k: number): number => ROW1_Y - (k - 1) * DY;
/** Bottom slot centre x (slot 0..12). */
export const slotX = (s: number): number => (s - 6) * DX;

/** Contract with the coder (`index.ts`). */
export type PlinkoParts = {
  /** 96 chrome pegs (instanced). Instance order = `pegList`. */
  pegs: THREE.InstancedMesh;
  /** Row/index of each peg instance, and the reverse lookup `(k·16 + j) → instance` (−1 for finger spots). */
  pegList: Array<[row: number, j: number]>;
  pegSlot: Int16Array;
  /** Layout data for hop targets: first peg of row 1 and the grid pitch. */
  pegGrid: { x0: number; y0: number; dx: number; dy: number };
  /** 6 porcelain fingers standing in for seeded pegs (instanced, twitch ±10° by matrix). */
  fingers: THREE.InstancedMesh;
  fingerSpots: Array<[row: number, j: number]>;
  /** 5 translucent pucks (instanced). */
  pucks: THREE.InstancedMesh;
  /** 13 painted multiplier plates as one 208 × 16 canvas, repainted per risk. */
  slotPlates: ScreenSurface;
  /** 13 slot lamps (instanced); instance s = slot s. */
  slotLamps: THREE.InstancedMesh;
  /** Physical LOW / MID / HIGH lever on the base. */
  riskSwitch: THREE.Mesh;
  /** Credit / bet / win LEDs plus the last-12 history row (one canvas). */
  leds: ScreenSurface;
  marquee: MarqueePart;
  /** Cosmetic insert chute sliding on the top rail. */
  chute: THREE.Object3D;
};

export const RISK_ANGLE = [-0.38, 0, 0.38];   // lever rotation.x for LOW / MID / HIGH

/** Deterministic fingers layout from the model seed: six distinct pegs in rows 3..11. */
export function fingerSpotsFor(seed: number): Array<[number, number]> {
  const rng: Rng = createRng(seed ^ 0x9e3779b9);
  const spots: Array<[number, number]> = [];
  while (spots.length < 6) {
    const k = rng.int(3, 11), j = rng.int(1, k);            // interior pegs only
    if (!spots.some(([a, b]) => a === k && b === j)) spots.push([k, j]);
  }
  return spots;
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<PlinkoParts> {
  const { pal } = kit;
  const root = kit.group('plinko');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const wood = pal.woodDark, black = pal.black, gold = pal.gold, brass = pal.brass;

  // ── static shell: flat colours, merged by kit.finalize into one draw ─────────────────────────────
  kit.box(W, 0.42, D, wood, at(0, 0.21, 0));                                          // base cabinet
  kit.box(0.03, H - 0.42, D, wood, at(-W / 2 + 0.015, (0.42 + H) / 2, 0));           // side walls
  kit.box(0.03, H - 0.42, D, wood, at(W / 2 - 0.015, (0.42 + H) / 2, 0));
  kit.box(W, 0.15, D, wood, at(0, H - 0.075, 0));                                     // top rail (marquee sits on it)
  kit.box(W - 0.06, H - 0.42 - 0.1, 0.02, black, at(0, (0.42 + H - 0.1) / 2, BACK_Z)); // P01 backboard
  kit.box(W - 0.06, 0.02, 0.02, gold, at(0, H - 0.2, BACK_Z + 0.01));                  // gold-leaf border
  kit.box(W - 0.06, 0.02, 0.02, gold, at(0, 0.44, BACK_Z + 0.01));
  kit.box(0.02, H - 0.64, 0.02, gold, at(-W / 2 + 0.05, (0.42 + H - 0.2) / 2, BACK_Z + 0.01));
  kit.box(0.02, H - 0.64, 0.02, gold, at(W / 2 - 0.05, (0.42 + H - 0.2) / 2, BACK_Z + 0.01));
  kit.cyl(0.1, 0.03, 0.1, wood, { pos: [0, FUNNEL_Y + 0.02, 0], seg: 8, parent: root });    // top funnel
  kit.box(0.5, 0.03, 0.04, brass, at(0, 0.44, 0.16));                                 // base tray lip
  kit.box(0.2, 0.03, 0.12, brass, at(0.42, 0.42, 0.2));                               // coin tray
  kit.box(0.12, 0.06, 0.04, brass, at(0.0, 0.37, 0.182));                             // base badge

  // ── pegs (instanced, 96 instances after the six finger spots) ───────────────────────────────────
  const fingerSpots = fingerSpotsFor(o.seed);
  const spotKey = new Set(fingerSpots.map(([k, j]) => k * 16 + j));
  const pegList: Array<[number, number]> = [];
  const pegSlot = new Int16Array(16 * 16).fill(-1);
  for (let k = 1; k <= ROWS; k++) for (let j = 0; j <= k + 1; j++) {
    if (spotKey.has(k * 16 + j)) continue;
    pegSlot[k * 16 + j] = pegList.length;
    pegList.push([k, j]);
  }
  const pegGeo = new THREE.TetrahedronGeometry(PEG_R * 1.4, 0);
  const pegs = new THREE.InstancedMesh(pegGeo, kit.mat(pal.chrome), pegList.length);
  const m4 = new THREE.Matrix4();
  pegList.forEach(([k, j], i) => { m4.makeTranslation(pegX(k, j), pegY(k), 0); pegs.setMatrixAt(i, m4); });
  pegs.instanceMatrix.needsUpdate = true;
  root.add(pegs);

  // ── porcelain fingers (instanced lathe: a shaft with two knuckle rings) ─────────────────────────
  const fingerGeo = new THREE.LatheGeometry(
    [new THREE.Vector2(0.0, -0.03), new THREE.Vector2(0.011, -0.03), new THREE.Vector2(0.014, -0.012),
      new THREE.Vector2(0.011, 0.0), new THREE.Vector2(0.014, 0.012), new THREE.Vector2(0.011, 0.024), new THREE.Vector2(0.0, 0.03)],
    4,
  );
  const fingers = new THREE.InstancedMesh(fingerGeo, kit.mat({ color: pal.bone, lit: true }), 6);
  fingerSpots.forEach(([k, j], i) => { m4.makeTranslation(pegX(k, j), pegY(k), 0); fingers.setMatrixAt(i, m4); });
  fingers.instanceMatrix.needsUpdate = true;
  root.add(fingers);

  // ── pucks: five translucent red acrylic discs, parked above the funnel until dropped ───────────
  const puckGeo = new THREE.CylinderGeometry(PUCK_R, PUCK_R, PUCK_T, 6);
  puckGeo.rotateX(Math.PI / 2);
  const pucks = new THREE.InstancedMesh(puckGeo, kit.mat({ color: pal.red, lit: true, transparent: true, opacity: 0.8 }), PUCKS);
  for (let i = 0; i < PUCKS; i++) { m4.makeTranslation(0, FUNNEL_Y + 0.2, 0); pucks.setMatrixAt(i, m4); }
  pucks.instanceMatrix.needsUpdate = true;
  root.add(pucks);

  // ── slot plate: one canvas, 13 painted multipliers (repainted per risk by index.ts) ─────────────
  const slotPlates = kit.screen({ w: 13 * DX, h: 0.07, px: [208, 16], bezel: black });
  slotPlates.mesh.position.set(0, SLOT_PLATE_Y, BACK_Z + 0.012);
  root.add(slotPlates.mesh);

  // ── slot lamps (instanced quads on the backboard, instance s = slot s) ──────────────────────────
  const lampGeo = new THREE.PlaneGeometry(0.05, 0.022);
  const slotLamps = new THREE.InstancedMesh(lampGeo, kit.mat({ color: 0xffffff, lit: false }), 13);
  slotLamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(13 * 3).fill(0.25), 3);
  for (let s = 0; s < 13; s++) { m4.makeTranslation(slotX(s), LAMP_Y, BACK_Z + 0.013); slotLamps.setMatrixAt(s, m4); }
  slotLamps.instanceMatrix.needsUpdate = true;
  root.add(slotLamps);

  // ── risk lever on the base front (rotation.x = RISK_ANGLE[risk]) ────────────────────────────────
  const riskSwitch = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.03), kit.mat(pal.red));
  riskSwitch.position.set(0.46, 0.27, 0.18);
  riskSwitch.rotation.x = RISK_ANGLE[0];
  root.add(riskSwitch);

  // ── credit / bet / win LEDs + last-12 row ──────────────────────────────────────────────────────
  const leds = kit.screen({ w: 0.5, h: 0.1, px: [160, 32], bezel: black });
  leds.mesh.position.set(-0.12, 0.27, 0.178);
  root.add(leds.mesh);

  // ── marquee on the top rail (front) ────────────────────────────────────────────────────────────
  const marquee = kit.marquee({ w: 0.9, h: 0.12, text: { key: 'm.plinko.name' }, color: pal.neonCyan, bg: black, bulbs: 14 });
  marquee.root.position.set(0, H - 0.075, 0.178);
  root.add(marquee.root);

  // ── chute: a short slider on the top rail (cosmetic insert position) ──────────────────────────
  const chute = new THREE.Object3D();
  chute.position.set(0, 2.2, 0.13);
  const chuteBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.06), kit.mat(brass));
  chute.add(chuteBody);
  root.add(chute);

  // ── glass, light hint, anchors ─────────────────────────────────────────────────────────────────
  const glass = kit.glass({ w: W - 0.06, h: H - 0.5, d: 0.01 });
  glass.position.set(0, (0.42 + H - 0.08) / 2, GLASS_Z);
  root.add(glass);

  const light = new THREE.Object3D();
  light.position.set(0, 1.5, 0.5);
  light.userData = { color: 0xff6040, intensity: 0.5, range: 2.2, flicker: 'STEADY' };
  root.add(light);

  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D(); a.position.set(x, y, z); root.add(a); return a;
  };
  const speaker = anchor(0, 1.1, 0.2);
  const prompt = marquee.root;
  const label = anchor(0, 0.36, 0.19);
  const marqueeTop = anchor(0, H, 0);
  const servicePlate = anchor(-W / 2 + 0.02, 1.2, 0.0);
  const stand = anchor(0, 0, 0.6);
  const coinOut = anchor(0.42, 0.46, 0.2);

  const parts: PlinkoParts = {
    pegs, pegList, pegSlot, pegGrid: { x0: pegX(1, 0), y0: ROW1_Y, dx: DX, dy: DY },
    fingers, fingerSpots, pucks, slotPlates, slotLamps, riskSwitch, leds, marquee, chute,
  };
  kit.finalize(root, {
    keep: [pegs, fingers, pucks, slotPlates.mesh, slotLamps, riskSwitch, leds.mesh, marquee.root, chute, light],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.62, 1.35), look: new THREE.Vector3(0, 1.25, 0), fov: 66, mouse: 'primary' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H, D / 2] }],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H, D / 2 + 0.3] },
    anchors: { speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light },
    dispose: () => { slotPlates.dispose(); leds.dispose(); },
  };
}
