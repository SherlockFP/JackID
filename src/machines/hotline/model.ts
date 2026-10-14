/**
 * Hotline booth — procedural model (devices-core, system category). Pattern: see `coinflip/model.ts`.
 *
 * A red-and-wood phone booth at MOUTH-PHONE: wood frame and back wall, glass side lights, a shelf holding a red
 * rotary telephone (base, dial, handset on its cradle, coiled cord), a booth lamp `#FFD34A` that flashes while the
 * line rings, and a two-digit amber nixie target showing who the call is for.
 *
 * Footprint 0.95 × 0.95 × 2.30 m (M slot, PLAN §4.3). Origin = floor centre, +Z = the open front the player stands at.
 * The handset is the animated part: `index.ts` lifts it on pick-up and drops it when the call ends.
 */
import * as THREE from 'three';
import type { LampPart, LedPanelPart } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

export type HotlineParts = {
  /** Handset group. Its rest pose sits on the cradle; `index.ts` lifts it on pick-up. */
  handset: THREE.Object3D;
  /** Rotary dial (turns for each choice). */
  dial: THREE.Object3D;
  /** Booth lamp `#FFD34A`, blinks with the ring cadence. */
  lamp: LampPart;
  /** Two-digit amber nixie: "ALL" or "P<n>" target text. */
  target: LedPanelPart;
};

export const W = 0.95, D = 0.95, H = 2.3;
const SHELF_Y = 1.0;
const CRADLE_Y = SHELF_Y + 0.12;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<HotlineParts> {
  const { pal } = kit;
  const root = kit.group('hotline');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  const wood = pal.woodDark;

  // ── static shell (flat colours) ──
  kit.box(W, 0.05, D, pal.black, at(0, 0.025, 0));                                       // floor
  kit.box(W, H, 0.06, wood, at(0, H / 2, -D / 2 + 0.03));                                // back wall
  kit.box(0.06, 0.95, D, wood, at(-W / 2 + 0.03, 0.05 + 0.475, 0));                      // left wall, low
  kit.box(0.06, 0.95, D, wood, at(W / 2 - 0.03, 0.05 + 0.475, 0));                       // right wall, low
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    kit.box(0.07, H, 0.07, wood, at(sx * (W / 2 - 0.035), H / 2, sz * (D / 2 - 0.035)));  // corner posts
  }
  kit.box(W, 0.07, D, wood, at(0, H - 0.035, 0));                                        // roof
  kit.box(W - 0.02, 0.025, D - 0.02, o.variant % 2 ? pal.brass : pal.gold, at(0, H - 0.09, 0)); // trim
  kit.box(0.6, 0.04, 0.3, wood, at(0, SHELF_Y, -0.25));                                  // shelf
  kit.box(0.5, 0.02, 0.03, pal.brass, at(0, SHELF_Y + 0.05, -0.4));                      // shelf lip
  kit.box(0.5, 0.12, 0.05, pal.redDark, at(0, 1.45, -D / 2 + 0.06));                     // nixie housing
  kit.box(0.92, 0.06, 0.04, wood, at(0, 0.93, D / 2 - 0.02));                            // front sill

  // glass side lights, above the low walls
  const glassL = kit.glass({ w: D - 0.12, h: 1.2, d: 0.02, tint: pal.glass, opacity: 0.35 });
  glassL.rotation.y = Math.PI / 2;
  glassL.position.set(-W / 2 + 0.02, 1.55, 0);
  const glassR = kit.glass({ w: D - 0.12, h: 1.2, d: 0.02, tint: pal.glass, opacity: 0.35 });
  glassR.rotation.y = Math.PI / 2;
  glassR.position.set(W / 2 - 0.02, 1.55, 0);
  root.add(glassL, glassR);

  // ── telephone on the shelf ──
  const base = kit.box(0.3, 0.1, 0.22, pal.redDark, at(0, SHELF_Y + 0.07, -0.25));
  root.add(base);
  const dial = new THREE.Object3D();
  dial.position.set(0, SHELF_Y + 0.125, -0.25 + 0.04);
  const dialRing = kit.torus(0.075, 0.01, pal.white, { parent: dial, seg: 16, tubeSeg: 6 });
  dialRing.rotation.x = Math.PI / 2;
  kit.cyl(0.035, 0.035, 0.012, pal.cream, { parent: dial, pos: [0, 0, 0], seg: 10 });
  dial.rotation.x = -Math.PI / 2;
  root.add(dial);

  const handset = new THREE.Object3D();
  handset.position.set(0, CRADLE_Y, -0.25);
  kit.box(0.26, 0.05, 0.05, pal.red, { parent: handset, pos: [0, 0.035, 0] });
  for (const sx of [-1, 1]) {
    kit.sphere(0.045, pal.red, { parent: handset, pos: [sx * 0.13, 0.035, 0] });
  }
  root.add(handset);

  const cord = kit.tube(
    [[0.12, SHELF_Y + 0.02, -0.25], [0.17, SHELF_Y - 0.1, -0.2], [0.2, SHELF_Y - 0.18, -0.08], [0.1, SHELF_Y - 0.26, -0.02]],
    0.008, pal.black, { seg: 12, radialSeg: 4 },
  );
  root.add(cord);

  // ── lamp and nixie ──
  const lamp = kit.lamp({ r: 0.06, color: 0xffd34a, shape: 'dome' });
  lamp.root.position.set(0, H - 0.2, 0.0);
  root.add(lamp.root);

  const target = kit.ledPanel({ digits: 2, color: '#ffb000', h: 0.07 });
  target.root.position.set(0, 1.45, -D / 2 + 0.1);
  root.add(target.root);

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.3, -0.2); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.0, 0.2); root.add(prompt);
  const light = new THREE.Object3D();
  light.position.set(0, 1.9, 0.1);
  light.userData = { color: 0xffd34a, intensity: 0.5, range: 1.6, flicker: 'STEADY' };
  root.add(light);

  const parts: HotlineParts = { handset, dial, lamp, target };
  kit.finalize(root, { keep: [handset, dial, lamp.root, target.root, light] });

  return {
    root,
    parts,
    // Seated framing: the deal sheet (overlay, centred, about -22..+15 degrees) sits over the middle of the view, so the
    // lifted handset (about -24 degrees) and the resting cradle (about -28) are kept in the strip below it.
    playPose: { pos: new THREE.Vector3(0, 1.6, 0.8), look: new THREE.Vector3(0, 1.65, -0.2), fov: 60, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, -D / 2], max: [W / 2, H, -D / 2 + 0.07] },   // back wall
      { min: [-W / 2, 0, -D / 2], max: [-W / 2 + 0.07, 1.0, D / 2] }, // left wall, low
      { min: [W / 2 - 0.07, 0, -D / 2], max: [W / 2, 1.0, D / 2] },   // right wall, low
    ],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H, D / 2 + 0.1] },
    anchors: { speaker, prompt, light, insideGlass: glassL },
  };
}
