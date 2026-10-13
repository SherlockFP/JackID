/**
 * Pawn Window — procedural model (devices-core, system category). Pattern: see `coinflip/model.ts`.
 *
 * The Pawnbroker's barred window in the Lobby (LOB-PAWN): a 2.0 m walnut counter with a brass tray that slides out
 * to the customer, four item pedestals with price tags (3 regular + 1 under the counter), a banker's lamp, a ledger
 * screen above the grille, a ticket LED and a roll-down shutter (down outside intermissions). Two ringed hands rest
 * behind the grille; they drum their fingers when you idle.
 *
 * Footprint 2.6 × 1.8 × 2.4 m (L slot, PLAN §4.3: "wall, 2.0 m counter"). Origin = floor centre, +Z = the customer side,
 * the wall is at z = −0.85. The stand strip (z 0.9 … 1.9) stays free.
 */
import * as THREE from 'three';
import type { LampPart, LabelPart, LedPanelPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export type CharmVendorParts = {
  /** Brass tray; slides towards the customer on every sale. */
  tray: THREE.Object3D;
  /** Roll-down shutter. `position.y` = 0 when open (up), −SHUTTER_DROP when closed. */
  shutter: THREE.Object3D;
  /** The Pawnbroker's ringed hands behind the grille. */
  hands: THREE.Object3D;
  /** Four pedestal anchors (charm sits here while it is on offer). */
  itemSlots: THREE.Object3D[];
  /** Price tags, one per slot. */
  tags: LabelPart[];
  lamp: LampPart;
  /** 128 × 80 px ledger: the stock list with names and prices. */
  ledger: ScreenSurface;
  /** 4-digit ticket count. */
  ticketLed: LedPanelPart;
};

export const W = 2.0, D = 0.7, H = 2.4;
export const COUNTER_H = 1.0;
export const SHUTTER_DROP = 1.05;
const WALL_Z = -0.78;
const COUNTER_Z = 0.25;
const SLOT_X = [-0.75, -0.25, 0.25, 0.75];

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<CharmVendorParts> {
  const { pal } = kit;
  const root = kit.group('charm_vendor');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const wood = o.variant % 2 ? pal.woodDark : pal.wood;

  // ── static shell (flat colours) ──
  kit.box(2.2, H, 0.1, pal.steel, at(0, H / 2, WALL_Z - 0.05));                              // wall
  kit.box(2.2, 0.06, 0.7, pal.steel, at(0, H - 0.03, WALL_Z + 0.35));                         // soffit
  kit.box(W, COUNTER_H - 0.08, D, wood, at(0, (COUNTER_H - 0.08) / 2, COUNTER_Z));            // counter body
  kit.box(W + 0.04, 0.08, D + 0.06, pal.brass, at(0, COUNTER_H - 0.04, COUNTER_Z));           // counter top, brass edge
  kit.box(W + 0.04, 0.12, 0.03, pal.brass, at(0, 0.06, COUNTER_Z + D / 2 + 0.01));            // kick plate
  kit.box(W, 0.05, 0.06, wood, at(0, COUNTER_H + 0.02, WALL_Z + 0.12));                      // window sill
  for (const sx of [-1, 1]) kit.box(0.08, 1.3, 0.1, pal.steel, at(sx * (W / 2 - 0.05), 1.65, WALL_Z + 0.1)); // jambs
  kit.box(W, 0.06, 0.1, pal.steel, at(0, 2.02, WALL_Z + 0.1));                                // grille head
  kit.box(0.7, 0.06, 0.05, pal.brass, at(-0.55, COUNTER_H + 0.07, COUNTER_Z + 0.1));          // lamp base

  // grille bars (static, merged)
  for (let i = 0; i < 7; i++) {
    const x = -0.75 + i * 0.25;
    kit.cyl(0.016, 0.016, 1.1, pal.steel, at(x, 1.45, WALL_Z + 0.1, { seg: 6 }));
  }

  // ── tray (animated) ──
  const tray = new THREE.Object3D();
  tray.position.set(0, COUNTER_H + 0.01, COUNTER_Z + 0.1);
  kit.box(0.6, 0.03, 0.34, pal.brass, { pos: [0, 0.015, 0], parent: tray });
  kit.box(0.6, 0.05, 0.02, pal.gold, { pos: [0, 0.035, 0.17], parent: tray });
  root.add(tray);

  // ── shutter (animated) ──
  const shutter = new THREE.Object3D();
  shutter.position.set(0, 0, 0);
  kit.box(1.94, 1.1, 0.03, pal.steel, { pos: [0, 1.45, WALL_Z + 0.05], parent: shutter });
  for (let i = 0; i < 8; i++) kit.box(1.94, 0.012, 0.035, pal.chrome, { pos: [0, 0.95 + i * 0.12, WALL_Z + 0.05], parent: shutter });
  root.add(shutter);

  // ── ringed hands (animated) ──
  const hands = new THREE.Object3D();
  hands.position.set(0, 1.4, WALL_Z + 0.25);
  for (const sx of [-1, 1]) {
    const palm = kit.sphere(0.07, pal.bone, { pos: [sx * 0.16, 0, 0], parent: hands, wSeg: 8, hSeg: 6 });
    palm.scale.set(1, 0.7, 1.3);
    const ring = kit.torus(0.045, 0.01, pal.gold, { pos: [sx * 0.16, 0, 0.02], parent: hands, seg: 12, tubeSeg: 4 });
    ring.rotation.x = Math.PI / 2;
  }
  root.add(hands);

  // ── pedestals (static) and item slots (anchors) ──
  const itemSlots: THREE.Object3D[] = [];
  const tags: LabelPart[] = [];
  SLOT_X.forEach((x, i) => {
    kit.cyl(0.08, 0.09, 0.05, pal.felt, at(x, COUNTER_H + 0.025, COUNTER_Z - 0.05, { seg: 10 }));
    const slot = new THREE.Object3D();
    slot.position.set(x, COUNTER_H + 0.06, COUNTER_Z - 0.05);
    root.add(slot);
    itemSlots.push(slot);
    const tag = kit.label({ text: '--', w: 0.26, h: 0.08, px: [96, 28], color: pal.gold, bg: pal.black, font: 'vt' });
    tag.mesh.position.set(x, COUNTER_H - 0.2, COUNTER_Z + D / 2 + 0.04);
    root.add(tag.mesh);
    tags.push(tag);
    if (i === 3) {
      const mark = kit.box(0.08, 0.02, 0.08, pal.neonPink, at(x, COUNTER_H + 0.1, COUNTER_Z - 0.05));
      mark.rotation.y = Math.PI / 4;
    }
  });

  // ── lamp, ledger, ticket LED ──
  kit.cyl(0.05, 0.06, 0.08, pal.brass, at(-0.55, COUNTER_H + 0.04, COUNTER_Z + 0.1, { seg: 10 }));
  const lamp = kit.lamp({ r: 0.05, color: pal.gold, shape: 'dome' });
  lamp.root.position.set(-0.55, COUNTER_H + 0.2, COUNTER_Z + 0.1);
  root.add(lamp.root);

  const ledger = kit.screen({ w: 0.56, h: 0.34, px: [128, 80], bezel: pal.black });
  ledger.mesh.position.set(0, 2.2, WALL_Z + 0.16);
  root.add(ledger.mesh);

  const ticketLed = kit.ledPanel({ digits: 4, color: '#ffb000', h: 0.06 });
  ticketLed.root.position.set(0.7, COUNTER_H + 0.012, COUNTER_Z - 0.2);
  root.add(ticketLed.root);

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.35, WALL_Z + 0.3); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.45 - 0.1, WALL_Z + 0.2); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, COUNTER_H + 0.05, COUNTER_Z + 0.3); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(-0.55, 1.4, COUNTER_Z + 0.2);
  light.userData = { color: 0xffd060, intensity: 0.6, range: 2.0, flicker: 'STEADY' };
  root.add(light);

  const parts: CharmVendorParts = { tray, shutter, hands, itemSlots, tags, lamp, ledger, ticketLed };
  kit.finalize(root, { keep: [tray, shutter, hands, lamp.root, ledger.mesh, ticketLed.root, light, ...itemSlots, ...tags.map((t) => t.mesh)] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 1.15), look: new THREE.Vector3(0, 1.25, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2 - 0.02, 0, COUNTER_Z - D / 2], max: [W / 2 + 0.02, COUNTER_H, COUNTER_Z + D / 2] },
      { min: [-1.1, 0, WALL_Z - 0.1], max: [1.1, H, WALL_Z + 0.02] },
    ],
    interact: { min: [-1.1, 0.3, WALL_Z], max: [1.1, H, COUNTER_Z + D / 2 + 0.2] },
    anchors: { speaker, prompt, light, coinOut, insideGlass: ledger.mesh },
    dispose: () => { ledger.dispose(); },
  };
}
