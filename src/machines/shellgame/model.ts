/**
 * Shell Automaton "Monsieur Thimble" — procedural model (MACHINES_tables §21, plan.json modelBrief, ART_BIBLE §5.27).
 *  - `buildModel(kit, o)` returns the full `MachineModel` and nothing else touches the scene;
 *  - `ShellParts` is the contract with `index.ts`; `aimArm` reaches a hand to a point (two-part arm, IK by aiming);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side).
 *
 * Booth: a carnival puppet booth, 1.16 W × 0.80 D × 1.90 H inside the M slot. Striped awning on top, counter at 0.95,
 * green felt mat behind glass, three brass cups and a red pearl. Behind the counter stands the automaton: a porcelain
 * head with a waxed moustache on a neck pole, a striped vest and two over-long arms (limb + hand, aimed at the cups).
 * The 5 heat bulbs sit on the booth top, the 5 bulbs of the string under the awning.
 *
 * BUDGET: ≤ 1,000 tris, ≤ 14 draws (ART §5.27). Static pieces merge in `kit.finalize`; animated objects are kept.
 */
import * as THREE from 'three';
import type { ButtonPart, LampPart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

/** The automaton's arm: `arm` pivots at the shoulder, `limb` is scaled to the reach, `hand` sits at the far end. */
export interface ArmParts { arm: THREE.Group; limb: THREE.Group; hand: THREE.Group; finger: THREE.Group }

/** Contract between modeler and coder. */
export type ShellParts = {
  /** Three cups by identity (0, 1, 2). The state keeps which cup stands in which slot. */
  cups: THREE.Group[];
  /** Red pearl (child of root). Visible only at the reveal; its place is the slot of the cup above it. */
  pearl: THREE.Mesh;
  thimble: {
    head: THREE.Group; jaw: THREE.Group;
    armL: ArmParts; armR: ArmParts;
    /** 2-frame glint sprite at the sleeve cuff of the left hand (palm tell). */
    sleeveGlint: THREE.Sprite;
  };
  /** Five amber bulbs on the booth top: one per heat step. */
  heatBulbs: LampPart[];
  /** Five bulbs under the awning. */
  bulbString: LampPart[];
  /** "OUT OF ORDER" sign on the counter front, hidden until the automaton jams. */
  jamSign: THREE.Object3D;
  leds: { credit: LampPart; bet: LampPart; win: LampPart };
  /** Coin slot on the counter front (insert). */
  coinSlot: THREE.Object3D;
  /** Red round Call Cheat button on the counter front (key 4). */
  cheat: ButtonPart;
  /** Booth candle (flicker is the light hint). */
  lamp: LampPart;
};

export const DIMS = { W: 1.16, D: 0.80, H: 1.90 } as const;
export const COUNTER_Y = 0.95;
export const FELT_Y = 0.96;
export const SLOT_X: readonly number[] = [-0.18, 0, 0.18];
export const CUP_Z = -0.02;
export const SHOULDER_L = new THREE.Vector3(-0.20, 1.32, -0.24);
export const SHOULDER_R = new THREE.Vector3(0.20, 1.32, -0.24);
/** Hands rest outside the cups, over the felt edge. */
export const REST_L = new THREE.Vector3(-0.40, 1.00, 0.02);
export const REST_R = new THREE.Vector3(0.40, 1.00, 0.02);
/** Lift of a cup for a reveal / pick (m). */
export const CUP_LIFT = 0.08;
const UP = new THREE.Vector3(0, 1, 0);
const COLOURWAYS: ReadonlyArray<readonly [number, number]> = [
  [0x8c1921, 0xe6dec5],   // casino red + ivory
  [0x3163c5, 0xe6dec5],   // cobalt + ivory
  [0x297b4a, 0xe6dec5],   // felt green + ivory
  [0x101019, 0xc59c42],   // black + gold
];

/** Point an arm pivot (parented to the root) so its limb reaches `target`; the hand follows the far end. */
export function aimArm(p: ArmParts, shoulder: THREE.Vector3, target: THREE.Vector3): void {
  const d = new THREE.Vector3().subVectors(target, shoulder);
  const len = Math.max(0.05, d.length());
  p.arm.quaternion.setFromUnitVectors(UP, d.normalize());
  p.limb.scale.set(1, len, 1);
  p.hand.position.set(0, len, 0);
}

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<ShellParts> {
  const { pal } = kit;
  const [stripeA, stripeB] = COLOURWAYS[o.variant] ?? COLOURWAYS[0];
  const wood = pal.wood;
  const steel = 0x2a2d1c;
  const ivory = pal.cream;
  const bone = pal.bone;
  const brass = pal.gold;
  const felt = pal.green;
  const root = kit.group('shellgame');
  const at = (x: number, y: number, z: number, parent: THREE.Object3D = root): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent });

  // ── booth shell ──
  kit.box(1.16, 0.08, 0.80, steel, at(0, 0.04, 0));                       // plinth
  kit.box(1.16, 0.87, 0.72, wood, at(0, 0.515, 0));                       // counter body, top at 0.95
  kit.box(1.16, 0.95, 0.04, wood, at(0, 1.425, -0.38));                   // back wall, 0.95 → 1.90
  for (const sx of [-1, 1]) kit.box(0.04, 1.82, 0.80, wood, at(sx * 0.58, 0.99, 0));   // side panels
  kit.box(1.00, 0.01, 0.48, felt, at(0, COUNTER_Y + 0.005, -0.02));       // felt mat (top at 0.96)
  // brass counter rail: front and back lips only, so the green mat reads instead of a full brass top (was overexposed yellow)
  kit.box(1.16, 0.04, 0.06, 0x7a5a24, at(0, COUNTER_Y + 0.02, 0.37));   // dull brass: the lit top no longer blooms yellow
  kit.box(1.16, 0.04, 0.06, 0x7a5a24, at(0, COUNTER_Y + 0.02, -0.37));
  kit.box(0.60, 0.22, 0.02, pal.black, at(0, 1.62, 0.37));                // name plate behind the label

  // ── striped awning: 8 stripes, alternating colourway ──
  for (let i = 0; i < 8; i++) {
    kit.box(0.15, 0.06, 0.70, i % 2 ? ivory : stripeA, at(-0.525 + i * 0.15, 1.87, 0.12));
  }
  // scalloped front edge: a row of small triangular-ish drops (boxes), alternating
  for (let i = 0; i < 8; i++) {
    kit.box(0.15, 0.03, 0.04, i % 2 ? ivory : stripeA, at(-0.525 + i * 0.15, 1.83, 0.46));
  }

  // ── cups and pearl ──
  const cups: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const g = kit.group(`shell_cup_${i}`);
    g.position.set(SLOT_X[i], FELT_Y, CUP_Z);
    root.add(g);
    kit.cyl(0.035, 0.05, 0.07, brass, { pos: [0, 0.035, 0], parent: g, seg: 8 });
    kit.cyl(0.038, 0.038, 0.006, pal.bone, { pos: [0, 0.07, 0], parent: g, seg: 8 });   // rim
    cups.push(g);
  }
  const pearl = kit.sphere(0.012, 0xc52129, { pos: [0, FELT_Y + 0.008, CUP_Z], parent: root, wSeg: 8, hSeg: 6 });
  pearl.visible = false;

  // ── the automaton (behind the counter) ──
  kit.cyl(0.022, 0.022, 0.16, steel, at(0, 1.40, -0.22));               // neck pole
  const head = kit.group('thimble_head');
  head.position.set(0, 1.56, -0.22);
  root.add(head);
  kit.sphere(0.12, pal.white, { pos: [0, 0, 0], parent: head, wSeg: 10, hSeg: 8 });   // porcelain mask
  for (const sx of [-1, 1]) {
    kit.box(0.075, 0.022, 0.026, pal.black, { pos: [sx * 0.05, -0.035, 0.112], rot: [0, 0, sx * -18], parent: head });   // waxed moustache
    kit.sphere(0.017, pal.red, { pos: [sx * 0.045, 0.03, 0.105], parent: head, wSeg: 6, hSeg: 4 });                    // red glass eyes
  }
  const jaw = kit.group('thimble_jaw');
  jaw.position.set(0, -0.09, 0.02);
  head.add(jaw);
  kit.box(0.10, 0.03, 0.10, ivory, { pos: [0, -0.01, 0.03], parent: jaw });       // hinged chin

  // torso raised clear of the cups' sight line (the cups sit 0.22 m in front of it, seen from the seat)
  kit.box(0.34, 0.30, 0.22, pal.red, at(0, 1.25, -0.24));                // striped vest (base)
  for (let i = 0; i < 4; i++) kit.box(0.03, 0.30, 0.01, ivory, at(-0.12 + i * 0.08, 1.25, -0.125));   // vest stripes

  const arm = (shoulder: THREE.Vector3, side: string): ArmParts => {
    const armG = kit.group(`thimble_arm_${side}`);
    armG.position.copy(shoulder);
    root.add(armG);
    const limb = kit.group(`thimble_limb_${side}`);
    armG.add(limb);
    kit.cyl(0.024, 0.018, 1, bone, { pos: [0, 0.5, 0], parent: limb, seg: 6 });   // 1 m unit limb, scaled to the reach
    const hand = kit.group(`thimble_hand_${side}`);
    armG.add(hand);
    kit.sphere(0.035, ivory, { pos: [0, 0, 0], parent: hand, wSeg: 6, hSeg: 4 });
    const finger = kit.group(`thimble_fingers_${side}`);
    hand.add(finger);
    for (let f = 0; f < 3; f++) kit.box(0.012, 0.045, 0.012, ivory, { pos: [-0.012 + f * 0.012, -0.045, 0], parent: finger });   // 3-joint fingers
    return { arm: armG, limb, hand, finger };
  };
  const armL = arm(SHOULDER_L, 'L');
  const armR = arm(SHOULDER_R, 'R');
  aimArm(armL, SHOULDER_L, REST_L);
  aimArm(armR, SHOULDER_R, REST_R);
  const sleeveGlint = kit.glow({ color: 0xfff4c0, size: 0.09, intensity: 0 });
  sleeveGlint.position.set(0, -0.06, 0);
  sleeveGlint.visible = false;
  armL.hand.add(sleeveGlint);

  // ── counter front: coin slot, LEDs, cheat button, jam sign ──
  const coinSlot = kit.coinSlot({ color: brass });
  coinSlot.position.set(0.40, 0.84, 0.37);
  root.add(coinSlot);
  const leds = {
    credit: kit.lamp({ r: 0.012, color: pal.red, shape: 'flat' }),
    bet: kit.lamp({ r: 0.012, color: pal.neonYellow, shape: 'flat' }),
    win: kit.lamp({ r: 0.012, color: pal.green, shape: 'flat' }),
  };
  leds.credit.root.position.set(-0.30, 0.84, 0.365);
  leds.bet.root.position.set(-0.24, 0.84, 0.365);
  leds.win.root.position.set(-0.18, 0.84, 0.365);
  for (const l of [leds.credit, leds.bet, leds.win]) root.add(l.root);
  const cheat = kit.button({ shape: 'round', r: 0.035, color: pal.red });
  cheat.root.position.set(0.22, 0.84, 0.37);
  cheat.root.rotation.x = Math.PI / 2;                                    // cap faces the player
  root.add(cheat.root);
  const jamSign = kit.label({ text: { key: 'm.shellgame.jamSign' }, w: 0.46, h: 0.09, px: [256, 48], color: pal.red, bg: pal.black }).mesh;
  jamSign.position.set(0, 0.62, 0.362);
  jamSign.visible = false;
  root.add(jamSign);

  // ── name label, glass over the felt ──
  const label = kit.label({ text: { key: 'm.shellgame.name' }, w: 0.52, h: 0.10, px: [256, 48], color: pal.neonYellow, bg: pal.black });
  label.mesh.position.set(0, 1.62, 0.398);
  root.add(label.mesh);
  const glass = kit.glass({ w: 1.04, h: 0.44, d: 0.02, tint: pal.glass, opacity: 0.22 });
  glass.position.set(0, 1.18, 0.30);
  root.add(glass);

  // ── heat bulbs on the booth top, bulb string under the awning ──
  const heatBulbs: LampPart[] = [];
  for (let i = 0; i < 5; i++) {
    const b = kit.lamp({ r: 0.022, color: 0xffa032, shape: 'dome' });
    b.root.position.set(-0.40 + i * 0.20, 1.95, -0.30);
    root.add(b.root);
    heatBulbs.push(b);
  }
  const bulbString: LampPart[] = [];
  for (let i = 0; i < 5; i++) {
    const b = kit.lamp({ r: 0.018, color: pal.neonYellow, shape: 'bulb' });
    b.root.position.set(-0.48 + i * 0.24, 1.80, 0.52);
    root.add(b.root);
    bulbString.push(b);
  }

  // candle light hint for the world's pooled lights (no THREE.Light inside machines)
  const lamp = kit.lamp({ r: 0.03, color: pal.neonYellow, shape: 'dome' });
  lamp.root.position.set(0, 1.78, 0.24);
  root.add(lamp.root);
  const light = new THREE.Object3D();
  light.position.set(0, 1.62, 0.42);
  light.userData = { color: 0xffce5a, intensity: 0.45, range: 2.0, flicker: 'CANDLE' };
  root.add(light);

  // anchors (MODEL_ANCHORS)
  const anchor = (x: number, y: number, z: number): THREE.Object3D => { const o3 = new THREE.Object3D(); o3.position.set(x, y, z); root.add(o3); return o3; };
  const speaker = anchor(0, 0.55, 0.40);
  const prompt = anchor(0, 1.25, 0.36);
  const marqueeTop = anchor(0, 1.98, 0);
  const servicePlate = anchor(-0.60, 0.45, 0);
  const stand = anchor(0, 0, 0.50);
  const fxHead = anchor(0, 1.56, -0.22);

  const parts: ShellParts = {
    cups, pearl,
    thimble: { head, jaw, armL, armR, sleeveGlint },
    heatBulbs, bulbString, jamSign, leds, coinSlot, cheat, lamp,
  };
  kit.finalize(root, {
    keep: [
      ...cups, pearl, head, jaw, armL.arm, armR.arm, armL.limb, armR.limb, armL.hand, armR.hand, armL.finger, armR.finger,
      sleeveGlint, ...heatBulbs.map((b) => b.root), ...bulbString.map((b) => b.root), jamSign, leds.credit.root, leds.bet.root,
      leds.win.root, coinSlot, cheat.root, lamp.root, light,
    ],
  });

  return {
    root,
    parts,
    // seat standard: cups mid-frame, the automaton's head and arms inside the top band, booth counter clear of the control bar
    playPose: { pos: new THREE.Vector3(0, 1.45, 1.5), look: new THREE.Vector3(0, 1.08, -0.1), fov: 57, mouse: 'pick' },
    colliders: [{ min: [-0.60, 0, -0.40], max: [0.60, 1.95, 0.40] }],
    interact: { min: [-0.60, 0.05, -0.40], max: [0.60, 1.95, 0.55] },
    anchors: { speaker, prompt, label: label.mesh, marqueeTop, servicePlate, stand, light, fxHead },
  };
}
