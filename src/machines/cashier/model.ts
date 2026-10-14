/**
 * Cashier cage — procedural model (system category, slot M, LOB-CASH). A steel-barred teller window set into the Lobby
 * wall: a walnut counter with a brass coin tray that slides out to the customer, five push caps for the cage offers,
 * a green ledger screen above the bars and a teller lamp. Footprint 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M).
 * Origin = floor centre, +Z = the customer side, the wall is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LampPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
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
const COUNTER_Z = 0.15;
/** Cap x positions on the counter (five across). */
export const CAP_X = [-0.46, -0.23, 0, 0.23, 0.46];
/** Teller lamp colour: the cage's green (matches the cashier glass). */
export const LAMP = 0x9fe8a0;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<CashierParts> {
  const { pal } = kit;
  const root = kit.group('cashier');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;

  // ── wall and cage (static) ──
  kit.box(W, H, 0.1, pal.steel, at(0, H / 2, WALL_Z - 0.05));                              // wall panel
  kit.box(W + 0.06, 0.08, D, pal.steel, at(0, H - 0.04, WALL_Z + D / 2));                  // soffit
  for (const sx of [-1, 1]) kit.box(0.06, 1.7, 0.08, pal.steel, at(sx * (W / 2 - 0.03), 2.05, WALL_Z + 0.05)); // jambs
  kit.box(W - 0.1, 0.06, 0.08, pal.steel, at(0, 2.9, WALL_Z + 0.05));                      // grille head
  for (let i = 0; i < 7; i++) {                                                             // bars: they stop below the ledger
    const x = -0.45 + i * 0.15;                                                              // (a bar across the screen hid the prices)
    kit.box(0.02, 1.25, 0.02, pal.steel, at(x, 1.625, WALL_Z + 0.08));
  }
  kit.box(W, COUNTER_H - 0.06, D, wood, at(0, (COUNTER_H - 0.06) / 2, COUNTER_Z));          // counter body
  kit.box(W + 0.04, 0.06, D + 0.05, pal.brass, at(0, COUNTER_H - 0.03, COUNTER_Z));          // counter top, brass edge
  kit.box(W + 0.04, 0.1, 0.03, pal.brass, at(0, 0.05, COUNTER_Z + D / 2 + 0.01));            // kick plate
  kit.box(W, 0.05, 0.06, wood, at(0, COUNTER_H + 0.02, WALL_Z + 0.12));                      // window sill

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
  kit.finalize(root, { keep: [tray, ...caps, ledger.mesh, lamp.root, light] });

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
