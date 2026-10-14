/**
 * Apothecary — procedural model (system category, slot M). A tall dark-wood cabinet behind a brass counter: four
 * tinted tonic bottles stand on the counter, each with a price tag on the front, a drawer that slides out to the
 * customer, a ledger screen above the shelves and a green lamp. Footprint 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M).
 * Origin = floor centre, +Z = the customer side, the cabinet back is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LampPart, LabelPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export type TonicVendorParts = {
  /** Brass drawer on the counter; slides towards the customer on every sale. */
  drawer: THREE.Object3D;
  /** Four bottle roots (liquid + cork). Each lifts on its own sale. */
  bottles: THREE.Object3D[];
  /** Price tags on the counter front, one per bottle. */
  tags: LabelPart[];
  /** Ledger above the shelves: the four doses and their prices. */
  ledger: ScreenSurface;
  lamp: LampPart;
};

export const W = 1.2, D = 0.7, H = 3.2;
export const COUNTER_H = 0.95;
export const DRAWER_SLIDE = 0.22;
const WALL_Z = -0.42;
const COUNTER_Z = 0.12;
export const BOTTLE_X = [-0.42, -0.14, 0.14, 0.42];
/** Liquid colours of the four bottles: green, amber, violet, red. */
const LIQUID = [0x60e89a, 0xe0a040, 0x9a60e0, 0xe05060];

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<TonicVendorParts> {
  const { pal } = kit;
  const root = kit.group('tonic_vendor');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;

  // ── cabinet shell (static) ──
  kit.box(W, H, 0.05, wood, at(0, H / 2, WALL_Z));                                         // back board
  for (const sx of [-1, 1]) kit.box(0.05, H, D, wood, at(sx * (W / 2 - 0.025), H / 2, WALL_Z + D / 2 - 0.05)); // sides
  kit.box(W, 0.06, D, wood, at(0, H - 0.03, WALL_Z + D / 2 - 0.05));                       // top
  for (const y of [1.55, 2.15, 2.75]) kit.box(W - 0.1, 0.04, D - 0.1, wood, at(0, y, WALL_Z + D / 2 - 0.05)); // shelves
  kit.box(W, COUNTER_H - 0.06, D, wood, at(0, (COUNTER_H - 0.06) / 2, COUNTER_Z));          // counter body
  kit.box(W + 0.04, 0.06, D + 0.05, pal.brass, at(0, COUNTER_H - 0.03, COUNTER_Z));          // counter top, brass edge
  kit.box(W + 0.04, 0.1, 0.03, pal.brass, at(0, 0.05, COUNTER_Z + D / 2 + 0.01));            // kick plate

  // jars on the shelves (static decoration, tinted like the stock)
  // (base y = the top of the shelf below, so every jar stands on wood; no floating jars)
  const jars: Array<[number, number]> = [[-0.4, 1.57], [-0.2, 1.57], [0.05, 1.57], [0.3, 1.57], [-0.3, 2.17], [0.2, 2.17]];
  jars.forEach(([x, y], i) => {
    kit.cyl(0.07, 0.07, 0.3, LIQUID[i % LIQUID.length], at(x, y + 0.15, WALL_Z + 0.2, { seg: 8 }));
    kit.cyl(0.075, 0.075, 0.03, pal.brass, at(x, y + 0.315, WALL_Z + 0.2, { seg: 8 }));
  });

  // ── drawer (animated) ──
  const drawer = new THREE.Object3D();
  drawer.position.set(0, COUNTER_H - 0.12, COUNTER_Z + D / 2 + 0.02);
  kit.box(0.5, 0.1, 0.04, pal.brass, { pos: [0, 0, 0], parent: drawer });
  kit.box(0.46, 0.07, 0.2, wood, { pos: [0, 0, -0.1], parent: drawer });
  root.add(drawer);

  // ── bottles (animated) and price tags ──
  const bottles: THREE.Object3D[] = [];
  const tags: LabelPart[] = [];
  BOTTLE_X.forEach((x, i) => {
    const b = new THREE.Object3D();
    b.position.set(x, COUNTER_H, COUNTER_Z - 0.05);
    kit.cyl(0.07, 0.08, 0.22, LIQUID[i], { pos: [0, 0.11, 0], parent: b, seg: 10 });
    kit.cyl(0.03, 0.03, 0.05, pal.brass, { pos: [0, 0.245, 0], parent: b, seg: 8 });
    kit.cyl(0.02, 0.02, 0.05, pal.neonPink, { pos: [0, 0.3, 0], parent: b, seg: 6 });
    root.add(b);
    bottles.push(b);
    const tag = kit.label({ text: '--', w: 0.22, h: 0.07, px: [88, 24], color: pal.gold, bg: pal.black, font: 'vt' });
    tag.mesh.position.set(x, COUNTER_H - 0.2, COUNTER_Z + D / 2 + 0.035);
    root.add(tag.mesh);
    tags.push(tag);
  });

  // ── lamp and ledger ──
  // lamp sits at x -0.45: its glow sprite (r*7 wide) must stay inside the 1.2 m footprint
  kit.cyl(0.05, 0.06, 0.08, pal.brass, at(-0.45, COUNTER_H + 0.03, COUNTER_Z + 0.2, { seg: 10 }));
  const lamp = kit.lamp({ r: 0.05, color: 0x60ff90, shape: 'dome' });
  lamp.root.position.set(-0.45, COUNTER_H + 0.18, COUNTER_Z + 0.2);
  root.add(lamp.root);

  const ledger = kit.screen({ w: 0.6, h: 0.36, px: [128, 80], bezel: pal.black });
  ledger.mesh.position.set(0, 2.95, WALL_Z + D / 2 - 0.02);
  root.add(ledger.mesh);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.5, WALL_Z + 0.4); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, COUNTER_H + 0.05, COUNTER_Z + 0.3); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(-0.45, 1.3, COUNTER_Z + 0.2);
  light.userData = { color: 0x60ff90, intensity: 0.5, range: 2.0, flicker: 'STEADY' };
  root.add(light);

  const parts: TonicVendorParts = { drawer, bottles, tags, ledger, lamp };
  kit.finalize(root, { keep: [drawer, ...bottles, ...tags.map((t) => t.mesh), lamp.root, ledger.mesh, light] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 1.0), look: new THREE.Vector3(0, 1.4, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, COUNTER_Z - D / 2], max: [W / 2, COUNTER_H, COUNTER_Z + D / 2] },
      { min: [-W / 2, 0, WALL_Z - 0.03], max: [W / 2, H, WALL_Z + 0.03] },
    ],
    interact: { min: [-W / 2, 0.3, WALL_Z], max: [W / 2, H, COUNTER_Z + D / 2 + 0.2] },
    anchors: { speaker: prompt, prompt, light, coinOut, insideGlass: ledger.mesh },
    dispose: () => { ledger.dispose(); },
  };
}
