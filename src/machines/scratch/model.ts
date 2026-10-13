/**
 * Scratch-Card Vendor — procedural model (MACHINES §6, ART_BIBLE §5.17 LUCKY PAPER). Pattern: `coinflip/model.ts`.
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `ScratchParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), Y up;
 *  - card faces are painted by `index.ts` (via `faces.ts`) into the canvases this model creates.
 *
 * Vendor 0.80 W × 0.60 D × 1.85 H (mustard enamel, black stripes, chrome trim) with a scratch shelf 0.80 × 0.20 at
 * y 1.00 projecting to the front. The glass front shows the five card designs as one 160 × 48 strip (five 32 × 48
 * plaques); under it a 5-button selector panel, LEDs (credit / bet / win) and a coin slot. The card mouth sits under
 * the shelf lip; five card planes (0.10 × 0.15, face up) rest on the felt at `cardSlots`. A brass scratching coin hangs
 * from a short chain on a pivot (±6° swing). Play pose: 0.28 m above the shelf, looking down ~70°.
 *
 * BUDGET (PLAN §4.2, M slot): ≤ 900 tris. Draw plan (≈ 16): static shell 1 · felt top 1 · marquee 1 · designs strip 1 ·
 * button panel 1 · LED chain 1 · tube (light strip) 1 · desk lamp 1 · chain 1 · coin 1 · card planes 5 · spare 2.
 * Five card planes cannot share a draw (each carries its own face canvas); the brief's 14-draw target is ~2 over.
 */
import * as THREE from 'three';
import type { BulbChain, ButtonPanelPart, LampPart, MarqueePart } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { DESIGN_H, DESIGN_W, paintDesign, type Text } from './faces';
import { CARD_COUNT } from './rules';

/** Contract between modeler and coder. */
export type ScratchParts = {
  /** Glass-front strip: five 32 × 48 designs (texture painted here, static). */
  designs: THREE.Mesh;
  marquee: MarqueePart;
  /** Five selector buttons under the designs, ids `card0`..`card4` (lit while selected). */
  buttons: ButtonPanelPart;
  /** Three LEDs: index 0 credit, 1 bet, 2 win. */
  leds: BulbChain;
  /** Interior fluorescent tube (dying): a light strip under the glass. */
  tube: BulbChain;
  coinSlot: THREE.Object3D;
  /** Card mouth group (the vended card leaves it). */
  dispenser: THREE.Group;
  cardMouth: THREE.Object3D;
  /** Anchors on the felt shelf where vended cards lie, index = card slot. */
  cardSlots: THREE.Object3D[];
  /** 128 × 192 card planes, face up. `cardTex[i].image` is the canvas to paint; each starts hidden. */
  cardPlanes: THREE.Mesh[];
  cardTex: THREE.CanvasTexture[];
  deskLamp: LampPart;
  /** Pivot (hook) of the scratching coin's chain; rotate about X for the ±6° swing. */
  chainPivot: THREE.Object3D;
  scratchCoin: THREE.Mesh;
};

export const W = 0.9, D = 0.8, H = 1.85;
export const BODY_W = 0.8, BODY_D = 0.6, BODY_Z = -0.1;   // body spans z -0.4 .. +0.2
export const FRONT_Z = 0.2;
export const SHELF_Y = 1.0, SHELF_D = 0.2;                 // shelf top y, depth (z 0.2 .. 0.4)
export const CARD_W = 0.1, CARD_H = 0.15;
export const CARD_Y = SHELF_Y + 0.008;
export const SLOT_X = (i: number): number => -0.24 + i * 0.12;
export const SLOT_Z = 0.3;
export const HOOK = { x: 0.33, y: 1.13, z: FRONT_Z + 0.005 };

const COLORWAYS: ReadonlyArray<{ body: number; stripe: number; trim: number }> = [
  { body: 0xc9a227, stripe: 0x151515, trim: 0xc0c7cc },   // mustard enamel (default)
  { body: 0x8c1921, stripe: 0xf7efde, trim: 0xc0c7cc },   // oxblood
  { body: 0x2a6b5a, stripe: 0xffce5a, trim: 0xd9d4c2 },   // teal
  { body: 0x2b2b2b, stripe: 0xc9a227, trim: 0xc0c7cc },   // black gold
];
const FELT = 0x1f5a3a, LAMP = 0xffe6b0, TUBE = 0xe0fff0;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ScratchParts> {
  const { pal } = kit;
  const cw = COLORWAYS[o.variant] ?? COLORWAYS[0];
  const root = kit.group('scratch');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell: flat colours only, so kit.finalize merges it into ONE draw call ──
  kit.box(BODY_W, H, BODY_D, cw.body, at(0, H / 2, BODY_Z));                                     // cabinet
  kit.box(BODY_W + 0.02, 0.08, BODY_D + 0.02, pal.black, at(0, 0.04, BODY_Z));                   // plinth
  kit.box(BODY_W + 0.02, 0.04, BODY_D + 0.02, cw.trim, at(0, H - 0.02, BODY_Z));                 // canopy trim
  for (const y of [0.7, 0.76]) kit.box(BODY_W, 0.02, 0.006, cw.stripe, at(0, y, FRONT_Z + 0.003)); // front stripes
  for (const sx of [-1, 1]) kit.box(0.008, 0.9, BODY_D + 0.004, cw.stripe, at(sx * (BODY_W / 2 + 0.002), 0.45, BODY_Z));
  kit.box(0.66, 0.52, 0.02, cw.trim, at(0, 1.45, FRONT_Z + 0.01));                               // glass bezel (behind the designs)
  kit.box(BODY_W - 0.04, 0.03, 0.2, cw.body, at(0, SHELF_Y - 0.015, FRONT_Z + SHELF_D / 2));    // scratch shelf
  kit.box(0.16, 0.05, 0.012, pal.black, at(0, 0.935, FRONT_Z + 0.006));                          // card mouth slot

  // ── felt shelf top (its own texture: a separate draw) ──
  kit.box(BODY_W - 0.06, 0.006, SHELF_D - 0.02, { color: FELT, map: kit.tex.felt(FELT) }, at(0, SHELF_Y + 0.003, FRONT_Z + SHELF_D / 2));

  // ── glass front: five designs on one strip (160 × 48 px, five 32 px plaques) ──
  const tx: Text = {
    draw: (g, s, x, y, color) => kit.tex.drawText(g, s, x, y, { font: 'px5', color }),
    width: (s) => kit.tex.measure(s, { font: 'px5' }),
  };
  const designsTex = kit.tex.canvas(DESIGN_W * CARD_COUNT, DESIGN_H, (g) => {
    for (let t = 0; t < CARD_COUNT; t++) paintDesign(g, t, t * DESIGN_W, tx);
  }, { wrap: 'clamp' });
  designsTex.colorSpace = THREE.NoColorSpace;
  designsTex.magFilter = THREE.NearestFilter;
  const designs = kit.plane(0.6, 0.18, kit.mat({ map: designsTex, lit: false, side: 'double', snap: false, affine: false }),
    { pos: [0, 1.45, FRONT_Z + 0.022], parent: root, name: 'designs' });

  // ── marquee + interior tube + LEDs ──
  const marquee = kit.marquee({ w: 0.64, h: 0.12, text: { key: 'm.scratch.marquee' }, color: pal.neonYellow, bg: pal.black, bulbs: 10 });
  marquee.root.position.set(0, 1.78, FRONT_Z + 0.006);
  root.add(marquee.root);
  const tube = kit.lightStrip({ length: 0.6, color: TUBE, thickness: 0.012, segments: 12, axis: 'x' });
  tube.root.position.set(0, 1.19, FRONT_Z + 0.02);
  root.add(tube.root);
  const leds = kit.bulbChain({
    path: [[-0.24, 1.05, FRONT_Z + 0.006], [-0.08, 1.05, FRONT_Z + 0.006]], count: 3, colors: [pal.green, pal.neonCyan, pal.gold], r: 0.011,
  });
  root.add(leds.root);

  // ── selector panel: five caps on one plate (one dynamic mesh), rotated to face the player ──
  const buttons = kit.buttonPanel({
    w: 0.62, d: 0.05, slope: 0, plate: pal.black, capH: 0.02,
    buttons: [0, 1, 2, 3, 4].map((i) => ({ id: `card${i}`, color: [pal.gold, pal.neonCyan, pal.red, pal.neonPink, pal.green][i], x: SLOT_X(i), z: 0, w: 0.07, h: 0.05 })),
  });
  buttons.root.position.set(0, 1.12, FRONT_Z + 0.006);
  buttons.root.rotation.x = Math.PI / 2;
  root.add(buttons.root);

  // ── coin slot (static) and card dispenser ──
  const coinSlot = kit.coinSlot({ color: pal.chrome });
  coinSlot.position.set(0.33, 1.12, FRONT_Z + 0.006);
  root.add(coinSlot);
  const dispenser = new THREE.Group();
  dispenser.name = 'dispenser';
  dispenser.position.set(0, 0.935, FRONT_Z + 0.01);
  root.add(dispenser);
  const cardMouth = new THREE.Object3D();
  cardMouth.position.set(0, 0.0, 0.02);
  dispenser.add(cardMouth);

  // ── card planes: one canvas each, hidden until vended ──
  const cardTex: THREE.CanvasTexture[] = [];
  const cardPlanes: THREE.Mesh[] = [];
  const cardSlots: THREE.Object3D[] = [];
  for (let i = 0; i < CARD_COUNT; i++) {
    const tex = kit.tex.canvas(128, 192, () => {}, { wrap: 'clamp' });
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.NearestFilter;
    cardTex.push(tex);
    const plane = kit.plane(CARD_W, CARD_H, kit.mat({ map: tex, lit: false, side: 'double', snap: false, affine: false }),
      { pos: [SLOT_X(i), CARD_Y, SLOT_Z], rot: [-90, 0, 0], parent: root, name: `card${i}` });
    plane.visible = false;
    cardPlanes.push(plane);
    const slot = new THREE.Object3D();
    slot.position.set(SLOT_X(i), CARD_Y, SLOT_Z);
    root.add(slot);
    cardSlots.push(slot);
  }

  // ── desk lamp on the shelf (warm light) ──
  const deskLamp = kit.lamp({ r: 0.022, color: LAMP, shape: 'bulb' });
  deskLamp.root.position.set(-0.34, SHELF_Y + 0.07, FRONT_Z + 0.12);
  kit.cyl(0.006, 0.006, 0.07, pal.black, { pos: [-0.34, SHELF_Y + 0.035, FRONT_Z + 0.12], parent: root, seg: 6 });
  root.add(deskLamp.root);

  // ── scratching coin on a chain from the hook (pivot swings ±6°) ──
  const chainPivot = new THREE.Object3D();
  chainPivot.position.set(HOOK.x, HOOK.y, HOOK.z);
  root.add(chainPivot);
  const chainPts: Array<[number, number, number]> = [[0, 0, 0], [0, -0.04, 0.05], [0, -0.09, 0.11], [0, -0.115, 0.15]];
  kit.tube(chainPts, 0.0035, pal.chrome, { parent: chainPivot, seg: 4, radialSeg: 4 });
  const scratchCoin = kit.cyl(0.015, 0.015, 0.004, pal.brass, { pos: [0, -0.117, 0.155], parent: chainPivot, seg: 12 });

  // ── light hint for the world's pooled lights (no THREE.Light inside machines) ──
  const light = new THREE.Object3D();
  light.position.set(0, 1.2, FRONT_Z + 0.2);
  light.userData = { color: TUBE, intensity: 0.7, range: 2, flicker: 'DYING' };
  root.add(light);

  // ── anchors (no meshes) ──
  const anchor = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D();
    a.position.set(x, y, z);
    root.add(a);
    return a;
  };
  const speaker = anchor(0, 1.3, -0.05);
  const label = anchor(0, 0.6, FRONT_Z + 0.006);
  const marqueeTop = anchor(0, H, BODY_Z);
  const servicePlate = anchor(BODY_W / 2 + 0.006, 0.6, BODY_Z);
  const stand = anchor(0, 0, 0.6);
  const flakes = anchor(0, SHELF_Y + 0.01, SHELF_D + FRONT_Z);
  const fxTwist = anchor(-0.3, SHELF_Y + 0.01, 0.36);
  const coinOut = anchor(0.12, SHELF_Y + 0.02, 0.3);

  const parts: ScratchParts = {
    designs, marquee, buttons, leds, tube, coinSlot, dispenser, cardMouth, cardSlots, cardPlanes, cardTex,
    deskLamp, chainPivot, scratchCoin,
  };
  kit.finalize(root, {
    keep: [designs, marquee.root, buttons.root, leds.root, tube.root, deskLamp.root, chainPivot, ...cardPlanes, light],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.28, 0.44), look: new THREE.Vector3(0, 1.0, 0.3), fov: 50, mouse: 'pick' },
    colliders: [{ min: [-BODY_W / 2, 0, BODY_Z - BODY_D / 2], max: [BODY_W / 2, H, FRONT_Z] }],
    interact: { min: [-W / 2, 0, -D / 2], max: [W / 2, H, D / 2 + 0.02] },
    anchors: { speaker, prompt: marquee.root, label, marqueeTop, servicePlate, stand, flakes, light, fxTwist, coinOut },
    dispose: () => undefined,
  };
}
