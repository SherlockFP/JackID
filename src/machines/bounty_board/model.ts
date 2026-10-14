/**
 * Bounty Board — procedural model (system category, slot M, MOUTH-BOUNTY). A cork board on the Mouth wall with three
 * paper slips pinned in a row (the offers), a ledger screen above them and a red rubber stamp hung on a hook beside
 * the board. The stamp drops on every paid contract. Footprint 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M).
 * Origin = floor centre, +Z = the customer side, the board is at z = WALL_Z.
 */
import * as THREE from 'three';
import type { LampPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { BOARD_SLOTS } from './rules';

export type BountyBoardParts = {
  /** Paper slips pinned on the cork, one per offer. Each lifts and flutters on sign. */
  slips: THREE.Object3D[];
  /** Rubber stamp on the hook; slams down on a paid contract. */
  stamp: THREE.Object3D;
  /** 128 × 96 px ledger: offers and signed slips with progress. */
  screen: ScreenSurface;
  lamp: LampPart;
};

export const W = 1.2, D = 0.2, H = 3.2;
const WALL_Z = -0.35;
/** Slip pin positions along the board (three across, upper-middle of the board). */
export const SLIP_X = [-0.36, 0, 0.36];
export const SLIP_Y = 1.62;
export const STAMP_LIFT = 0.12;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<BountyBoardParts> {
  const { pal } = kit;
  const root = kit.group('bounty_board');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const frame = o.variant % 2 ? pal.woodDark : pal.wood;
  const cork = 0x8a6440;
  const front = WALL_Z + D / 2 + 0.05;

  // ── board and frame (static) ──
  kit.box(W, H, 0.06, pal.black, at(0, H / 2, WALL_Z - 0.02));                              // wall backing
  kit.box(W - 0.1, 1.9, 0.03, cork, at(0, 1.9, front));                                    // cork sheet
  for (const sx of [-1, 1]) kit.box(0.06, 2.04, 0.08, frame, at(sx * (W / 2 - 0.05), 1.92, front)); // frame sides (meet the top rail, no corner gap)
  kit.box(W, 0.07, 0.1, frame, at(0, 2.97, front));                                         // frame top
  kit.box(W, 0.07, 0.1, frame, at(0, 0.88, front));                                         // frame bottom
  kit.box(W, 0.06, 0.12, pal.brass, at(0, 0.87, front + 0.04));                             // brass ledge
  kit.box(W, 0.9, 0.06, frame, at(0, 0.45, front - 0.02));                                  // lower panel

  // ── slips (animated) ──
  const slips: THREE.Object3D[] = [];
  SLIP_X.slice(0, BOARD_SLOTS).forEach((x) => {
    const s = new THREE.Object3D();
    s.position.set(x, SLIP_Y, front + 0.04);
    kit.box(0.26, 0.4, 0.01, 0xefe2b8, { pos: [0, 0, 0], parent: s });                     // paper
    kit.cyl(0.012, 0.012, 0.02, pal.brass, { pos: [0, 0.17, 0.01], parent: s, seg: 6 });    // pin
    root.add(s);
    slips.push(s);
  });

  // ── stamp on a hook (animated) ──
  const stamp = new THREE.Object3D();
  stamp.position.set(0.52, 1.1, front + 0.1);
  kit.cyl(0.02, 0.02, 0.22, pal.black, { pos: [0, 0.11, 0], parent: stamp, seg: 8 });       // handle
  kit.box(0.1, 0.03, 0.08, 0xc02828, { pos: [0, 0, 0], parent: stamp });                    // red face
  root.add(stamp);

  // ── ledger screen and lamp ──
  const screen = kit.screen({ w: 0.56, h: 0.42, px: [128, 96], bezel: pal.black });
  screen.mesh.position.set(0, 2.55, front + 0.02);
  root.add(screen.mesh);
  // lamp at x -0.44: its glow sprite must stay inside the 1.2 m footprint
  kit.cyl(0.05, 0.06, 0.08, pal.brass, at(-0.44, 0.94, front + 0.2, { seg: 10 }));
  const lamp = kit.lamp({ r: 0.05, color: 0xff8a50, shape: 'dome' });
  lamp.root.position.set(-0.44, 1.1, front + 0.2);
  root.add(lamp.root);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.9, front + 0.5); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0.52, 0.95, front + 0.35); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(-0.44, 1.4, front + 0.3);
  light.userData = { color: 0xff8a50, intensity: 0.5, range: 2.0, flicker: 'STEADY' };
  root.add(light);

  const parts: BountyBoardParts = { slips, stamp, screen, lamp };
  kit.finalize(root, { keep: [...slips, stamp, screen.mesh, lamp.root, light] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 1.0), look: new THREE.Vector3(0, 1.8, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, WALL_Z - 0.04], max: [W / 2, H, WALL_Z + 0.04] },
    ],
    interact: { min: [-W / 2, 0.3, WALL_Z], max: [W / 2, H, front + 0.6] },
    anchors: { speaker: prompt, prompt, light, coinOut, insideGlass: screen.mesh },
    dispose: () => { screen.dispose(); },
  };
}
