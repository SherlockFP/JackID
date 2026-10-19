/**
 * Cashier cage (vezne) — procedural model (system category, slot M, LOB-CASH). A walnut teller booth set into the Lobby
 * wall: a brass grille window over chip racks, a green-leather counter with a brass coin tray that slides out to the
 * customer, a bell and a cash counting tray, five push caps for the cage offers, a green ledger screen above the grille,
 * a teller lamp and a VEZNE / CASHIER plaque. Footprint 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M).
 * Origin = floor centre, +Z = the customer side, the wall is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LampPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import { presets } from '@/kit/presets';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export type CashierParts = {
  /** Brass coin tray on the counter; slides towards the customer on every exchange. */
  tray: THREE.Object3D;
  /** Five push caps, one per offer (see rules.OFFERS). Each sinks on press. */
  caps: THREE.Object3D[];
  /** Ledger above the bars: balances and the day's rates. */
  ledger: ScreenSurface;
  lamp: LampPart;
};

export const W = 1.2, D = 0.7, H = 3.2;
export const COUNTER_H = 1.0;
export const TRAY_SLIDE = 0.2;
export const CAP_SINK = 0.015;
const WALL_Z = -0.4;
/** Chip colours on the racks, and the bill stacks. */
const CHIP = [0x8c1921, 0x3163c5, 0xe6dec5, 0x297b4a, 0xc59c42];
const BILL = 0x6f8f5a;
const COUNTER_Z = 0.15;
/** Cap x positions on the counter (five across). */
export const CAP_X = [-0.46, -0.23, 0, 0.23, 0.46];
/** Teller lamp colour: the cage's green (matches the cashier glass). */
export const LAMP = 0x9fe8a0;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<CashierParts> {
  const { pal } = kit;
  const root = kit.group('cashier');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const LEATHER = presets(kit.tex).leather(0x1c3a26);
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;

  // ── wall, piers and header (static) ──
  const panelWood = o.variant % 2 ? pal.wood : pal.woodDark;
  kit.box(W, H, 0.1, pal.woodDark, at(0, H / 2, WALL_Z - 0.05));                           // wall panel
  kit.box(W + 0.06, 0.08, D, pal.woodDark, at(0, H - 0.04, WALL_Z + D / 2));               // soffit
  kit.box(W + 0.06, 0.26, 0.08, pal.woodDark, at(0, 3.02, WALL_Z + D - 0.04));              // header fascia
  kit.box(W + 0.08, 0.025, 0.1, pal.brass, at(0, 2.885, WALL_Z + D - 0.04));               // brass cornice under it
  for (const sx of [-1, 1]) {
    kit.box(0.16, H - 1.0 - 0.08, 0.3, pal.wood, at(sx * 0.52, 1.0 + (H - 1.08) / 2, WALL_Z + 0.15)); // walnut piers
    kit.box(0.2, 0.05, 0.34, pal.brass, at(sx * 0.52, COUNTER_H + 0.025, WALL_Z + 0.17));   // pier base
    kit.box(0.2, 0.05, 0.34, pal.brass, at(sx * 0.52, H - 0.105, WALL_Z + 0.17));           // pier capital
  }
  // VEZNE big over CASHIER small: one long line smears at distance
  const plates = [
    kit.label({ text: { key: 'm.cashier.plaque' }, w: 0.64, h: 0.13, px: [256, 52], color: pal.gold, bg: pal.black, font: 'px5' }),
    kit.label({ text: { key: 'm.cashier.plaqueSub' }, w: 0.6, h: 0.09, px: [240, 36], color: pal.cream, bg: pal.black, font: 'px5' }),
  ];
  plates[0].mesh.position.set(0, 3.075, WALL_Z + D + 0.002);
  plates[1].mesh.position.set(0, 2.945, WALL_Z + D + 0.002);
  for (const p of plates) root.add(p.mesh);

  // ── the window: a recess with chip racks behind a brass grille ──
  kit.box(0.88, 1.06, 0.02, pal.black, at(0, 1.77, WALL_Z + 0.015));                        // recess back
  for (const y of [1.25, 1.6, 1.95]) {                                                       // three shelves of chip stacks
    kit.box(0.86, 0.02, 0.12, pal.brass, at(0, y, WALL_Z + 0.085));
    for (let i = 0; i < 9; i++) {
      const hgt = 0.05 + ((i * 5 + Math.round(y * 10)) % 4) * 0.02;                         // deterministic heights
      kit.cyl(0.03, 0.03, hgt, CHIP[(i + Math.round(y * 4)) % CHIP.length], at(-0.38 + i * 0.095, y + 0.01 + hgt / 2, WALL_Z + 0.085, { seg: 8 }));
    }
  }
  kit.box(0.94, 0.04, 0.16, pal.brass, at(0, 1.2, WALL_Z + 0.12));                           // grille sill
  kit.box(0.94, 0.05, 0.04, pal.brass, at(0, 2.275, WALL_Z + 0.14));                         // grille head
  kit.box(0.9, 0.02, 0.02, pal.brass, at(0, 1.75, WALL_Z + 0.14));                           // mid rail
  for (let i = 0; i < 9; i++) {                                                              // bars: they stop below the ledger
    kit.cyl(0.014, 0.014, 1.03, pal.brass, at(-0.4 + i * 0.1, 1.735, WALL_Z + 0.14, { seg: 6 }));  // (a bar across the screen hid the prices)
  }

  // ── counter: walnut with raised panels, a brass edge and a green leather top ──
  kit.box(W, COUNTER_H - 0.06, D, wood, at(0, (COUNTER_H - 0.06) / 2, COUNTER_Z));          // counter body
  for (let i = 0; i < 5; i++) kit.box(0.2, 0.5, 0.012, panelWood, at(-0.48 + i * 0.24, 0.5, COUNTER_Z + D / 2 + 0.006));
  kit.box(W + 0.02, 0.025, 0.03, pal.brass, at(0, 0.82, COUNTER_Z + D / 2 + 0.012));        // brass rail over the panels
  kit.box(W + 0.04, 0.06, D + 0.05, pal.brass, at(0, COUNTER_H - 0.03, COUNTER_Z));          // counter top, brass edge
  kit.box(W + 0.04, 0.1, 0.03, pal.brass, at(0, 0.05, COUNTER_Z + D / 2 + 0.01));            // kick plate
  kit.box(W - 0.1, 0.004, D - 0.1, LEATHER, at(0, COUNTER_H + 0.002, COUNTER_Z));            // green leather inset

  // ── on the counter: a bell and a cash counting tray ──
  kit.cyl(0.045, 0.05, 0.012, pal.brass, at(0.31, COUNTER_H + 0.006, 0.34, { seg: 10 }));
  kit.sphere(0.035, pal.gold, { pos: [0.31, COUNTER_H + 0.012, 0.34], parent: root, hemi: true, wSeg: 8, hSeg: 4 });
  kit.cyl(0.008, 0.008, 0.014, pal.gold, at(0.31, COUNTER_H + 0.055, 0.34, { seg: 6 }));
  kit.box(0.22, 0.016, 0.2, pal.brass, at(-0.43, COUNTER_H + 0.008, 0.36));
  kit.box(0.2, 0.012, 0.18, pal.feltDark, at(-0.43, COUNTER_H + 0.016, 0.36));
  for (let i = 0; i < 3; i++) kit.box(0.07, 0.02 + i * 0.01, 0.035, BILL, at(-0.49 + i * 0.06, COUNTER_H + 0.03, 0.34 + (i % 2) * 0.05));

  // ── coin tray (animated) ──
  const tray = new THREE.Object3D();
  tray.position.set(0, COUNTER_H + 0.005, COUNTER_Z + D / 2 - 0.12);
  kit.box(0.5, 0.03, 0.26, pal.brass, { pos: [0, 0, 0], parent: tray });
  kit.box(0.46, 0.04, 0.22, 0x1c1410, { pos: [0, 0.02, 0], parent: tray });
  kit.cyl(0.035, 0.035, 0.03, 0xe0b040, { pos: [-0.12, 0.05, 0], parent: tray, seg: 10 }); // coin stack
  kit.cyl(0.035, 0.035, 0.05, 0xe0b040, { pos: [0.1, 0.06, 0], parent: tray, seg: 10 });
  root.add(tray);

  // ── five push caps (animated) ──
  const caps: THREE.Object3D[] = [];
  CAP_X.forEach((x, i) => {
    const c = new THREE.Object3D();
    c.position.set(x, COUNTER_H, COUNTER_Z - 0.12);
    kit.cyl(0.05, 0.055, 0.04, i === 4 ? pal.neonPink : pal.brass, { pos: [0, 0.02, 0], parent: c, seg: 10 });
    root.add(c);
    caps.push(c);
  });

  // ── ledger and lamp ──
  // 512 × 288 texels: the offer list (key, name, price) is read from the seat, so the text needs the density
  const ledger = kit.screen({ w: 0.7, h: 0.39375, px: [512, 288], bezel: pal.black });
  ledger.tex.magFilter = THREE.NearestFilter;                 // pixel-font edges stay sharp ...
  ledger.tex.minFilter = THREE.LinearMipmapLinearFilter;      // ... and the minified text does not shimmer
  ledger.tex.generateMipmaps = true;
  ledger.tex.needsUpdate = true;
  ledger.mesh.position.set(0, 2.55, WALL_Z + 0.08);
  root.add(ledger.mesh);
  // lamp at x 0.44: its glow sprite must stay inside the 1.2 m footprint
  kit.cyl(0.05, 0.06, 0.08, pal.brass, at(0.44, COUNTER_H + 0.03, COUNTER_Z + 0.2, { seg: 10 }));
  kit.cyl(0.008, 0.008, 0.1, pal.brass, at(0.44, COUNTER_H + 0.12, COUNTER_Z + 0.2, { seg: 6 }));    // stem under the glass
  const lamp = kit.lamp({ r: 0.05, color: LAMP, shape: 'dome' });
  lamp.root.position.set(0.44, COUNTER_H + 0.18, COUNTER_Z + 0.2);
  root.add(lamp.root);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.0, WALL_Z + 0.5); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, COUNTER_H + 0.05, COUNTER_Z + 0.25); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0.44, 1.4, COUNTER_Z + 0.2);
  light.userData = { color: LAMP, intensity: 0.5, range: 2.0, flicker: 'STEADY' };
  root.add(light);

  const parts: CashierParts = { tray, caps, ledger, lamp };
  kit.finalize(root, { keep: [tray, ...caps, ledger.mesh, lamp.root, light, ...plates.map((p) => p.mesh)] });

  return {
    root,
    parts,
    // seat framing: the ledger (y 2.37–2.73, over the counter) and the offer rows must be inside the view
    playPose: { pos: new THREE.Vector3(0, 1.75, 1.2), look: new THREE.Vector3(0, 1.95, -0.25), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, COUNTER_Z - D / 2], max: [W / 2, COUNTER_H, COUNTER_Z + D / 2] },
      { min: [-W / 2, 0, WALL_Z - 0.06], max: [W / 2, H, WALL_Z + 0.06] },
    ],
    interact: { min: [-W / 2, 0.3, WALL_Z], max: [W / 2, H, COUNTER_Z + D / 2 + 0.2] },
    anchors: { speaker: prompt, prompt, light, coinOut, insideGlass: ledger.mesh },
    dispose: () => { ledger.dispose(); },
  };
}
