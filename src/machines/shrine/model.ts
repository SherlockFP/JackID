/**
 * Moth Shrine — procedural model (system category, slot S, PAR-SHRINE). A small dark niche in the Parlour: a wooden
 * altar shelf with eight tallow candles, one flame per candle lit this run (up to eight shown), four small statues of the
 * owners behind them (a wax drip runs from the one at Favour 3), a pewter moth on the back board whose wings flutter when
 * you light a candle, a coin dish in front and a brass price tag. Footprint
 * 0.8 × 0.8 × 2.0 m (SLOT_DIMS.S). Origin = floor centre, +Z = the customer side, the niche back is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LabelPart } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { GodId } from '@/game/pantheon';
import { STATUES } from './rules';

export type ShrineParts = {
  /** Eight candle roots on the altar. */
  candles: THREE.Object3D[];
  /** One flame per candle; visible when that candle is lit. */
  flames: THREE.Object3D[];
  /** One statue per owner (shelf order), and the wax drip that runs from it at Favour 3. */
  statues: THREE.Object3D[];
  drips: THREE.Object3D[];
  /** The pewter moth. Its two wing roots flap on every light. */
  moth: THREE.Object3D;
  wings: THREE.Object3D[];
  /** Brass tag beside the dish: the price of the next candle. */
  price: LabelPart;
};

/** Niche depth D = 0.76 and back board at z = -0.37: the front lip ends at z = +0.39, inside the ±0.4 footprint and stand strip. */
export const W = 0.8, D = 0.76, H = 2.0;
export const CANDLES = 8;
const WALL_Z = -0.37;
const SHELF_Y = 1.02;
/** Candle colour (tallow) and flame colour (the Parlour's warm bulb). */
const TALLOW = 0xe8dcc0;
export const FLAME = 0xffb040;
export const MOTH_X = 0;
/** Statue colours: the Well's water, the Ledgers' brass, Ash's ember, the Mirrors' silver. */
export const STATUE_COLOR: Readonly<Record<string, number>> = { well: 0x5a8ad8, ledgers: 0xc8a040, ash: 0xa05030, mirrors: 0xc8d0d8 };
const WAX = 0xf0e8d0;
export const STATUE_X = (i: number): number => -0.27 + i * 0.18;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ShrineParts> {
  const { pal } = kit;
  const root = kit.group('shrine');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;

  // ── niche (static) ──
  kit.box(W, H, 0.06, pal.black, at(0, H / 2, WALL_Z));                                    // back board
  for (const sx of [-1, 1]) kit.box(0.06, H, D, wood, at(sx * (W / 2 - 0.03), H / 2, WALL_Z + D / 2)); // sides
  kit.box(W, 0.06, D, wood, at(0, H - 0.03, WALL_Z + D / 2));                              // canopy
  kit.box(W - 0.1, 0.05, D - 0.1, wood, at(0, SHELF_Y, WALL_Z + D / 2 - 0.02));              // altar shelf
  kit.box(W - 0.1, 0.9, 0.04, wood, at(0, 0.5, WALL_Z + D - 0.08));                          // altar front
  kit.box(W - 0.06, 0.04, 0.1, pal.brass, at(0, SHELF_Y - 0.02, WALL_Z + D - 0.06));         // brass lip

  // ── candles and flames (animated flames) ──
  const candles: THREE.Object3D[] = [];
  const flames: THREE.Object3D[] = [];
  for (let i = 0; i < CANDLES; i++) {
    const x = -0.3 + i * 0.086;
    const c = new THREE.Object3D();
    c.position.set(x, SHELF_Y + 0.025, WALL_Z + 0.3);
    kit.cyl(0.024, 0.024, 0.14, TALLOW, { pos: [0, 0.07, 0], parent: c, seg: 8 });
    root.add(c);
    candles.push(c);

    const f = new THREE.Object3D();
    f.position.set(x, SHELF_Y + 0.17, WALL_Z + 0.3);
    kit.cyl(0.004, 0.011, 0.03, FLAME, { pos: [0, 0.015, 0], parent: f, seg: 6 });
    f.visible = false;
    root.add(f);
    flames.push(f);
  }

  // ── statues (the owners): body in the god's colour, a head that tells them apart, a wax drip for Favour 3 ──
  const statues: THREE.Object3D[] = [];
  const drips: THREE.Object3D[] = [];
  STATUES.forEach((god: GodId, i) => {
    const col = STATUE_COLOR[god];
    const s = new THREE.Object3D();
    s.position.set(STATUE_X(i), SHELF_Y + 0.025, WALL_Z + 0.12);
    kit.box(0.1, 0.03, 0.09, wood, { pos: [0, 0.015, 0], parent: s });                   // plinth
    kit.cyl(0.03, 0.045, 0.2, col, { pos: [0, 0.13, 0], parent: s, seg: 8 });             // body
    if (god === 'well') kit.cyl(0.04, 0.04, 0.012, col, { pos: [0, 0.25, 0], parent: s, seg: 10 });   // a ring
    else if (god === 'ledgers') kit.box(0.055, 0.055, 0.055, col, { pos: [0, 0.26, 0], parent: s });  // a coin block
    else if (god === 'ash') kit.cyl(0.004, 0.03, 0.07, col, { pos: [0, 0.27, 0], parent: s, seg: 6 }); // a match head
    else kit.box(0.045, 0.085, 0.01, col, { pos: [0, 0.265, 0], parent: s });                            // an oval glass, no face
    root.add(s);
    statues.push(s);
    const d = new THREE.Object3D();
    d.position.set(STATUE_X(i) + 0.012, SHELF_Y + 0.025 + 0.245, WALL_Z + 0.12 + 0.03);
    kit.cyl(0.006, 0.004, 0.06, WAX, { pos: [0, -0.03, 0], parent: d, seg: 5 });
    d.visible = false;
    root.add(d);
    drips.push(d);
  });

  // ── moth (animated) ──
  const moth = new THREE.Object3D();
  moth.position.set(MOTH_X, 1.55, WALL_Z + 0.06);
  kit.cyl(0.012, 0.012, 0.12, 0x7a7068, { pos: [0, 0, 0], parent: moth, seg: 6 });          // body
  const wings: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const w = new THREE.Object3D();
    w.position.set(0, 0.02, 0.01);
    kit.box(0.12, 0.1, 0.005, 0xb8b0a0, { pos: [side * 0.06, 0, 0], parent: w });            // wing
    moth.add(w);
    wings.push(w);
  }
  root.add(moth);

  // ── dish and price tag ──
  kit.box(0.3, 0.02, 0.18, pal.brass, at(0, 0.7, WALL_Z + D - 0.12));                       // coin dish
  const price = kit.label({ text: '--', w: 0.22, h: 0.07, px: [88, 24], color: pal.gold, bg: pal.black, font: 'vt' });
  price.mesh.position.set(0, 0.85, WALL_Z + D - 0.04);
  root.add(price.mesh);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.4, WALL_Z + D + 0.3); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.74, WALL_Z + D - 0.02); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0, 1.3, WALL_Z + 0.4);
  light.userData = { color: FLAME, intensity: 0.7, range: 1.8, flicker: 'CANDLE' };
  root.add(light);

  const parts: ShrineParts = { candles, flames, statues, drips, moth, wings, price };
  kit.finalize(root, { keep: [...candles, ...flames, ...statues, ...drips, moth, price.mesh, light] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.5, 0.9), look: new THREE.Vector3(0, 1.4, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, WALL_Z], max: [W / 2, H, WALL_Z + D] },
    ],
    interact: { min: [-W / 2, 0.3, WALL_Z], max: [W / 2, H, WALL_Z + D + 0.5] },
    anchors: { speaker: prompt, prompt, light, coinOut, insideGlass: moth },
    dispose: () => { /* no screens to release */ },
  };
}
