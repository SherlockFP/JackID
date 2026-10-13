/**
 * Debt Terminal — procedural model (devices-core, system category). Pattern: see `coinflip/model.ts`.
 *
 * The House's cashier alcove at MOUTH-TERM: walnut counter with a brass-trimmed keypad on a sloped plate, a deposit
 * mouth with chewing lips, a receipt printer that feeds a paper stub, a red quota LED and an amber deposit LED over
 * an amber CRT (the printout), a swipe slot for the JackID, the brass SETTLE lever (right), OPEN THE FLOOR lever (left),
 * a bell rope on the right post and the House eye over the alcove (`emblemLid` lifts when the House looks at you).
 *
 * Footprint 1.20 × 0.90 × 2.40 m (M slot, PLAN §4.3). Origin = floor centre, +Z = player side. Keypad is the only
 * mouse target (play pose `mouse: 'pick'`). Digits come from the keyboard (n1…n9, Backspace, Enter).
 */
import * as THREE from 'three';
import type { ButtonPanelPart, LedPanelPart, LampPart, LeverPart, ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { PanelButtonSpec } from '@/kit/types';
import { KEYS } from './rules';

export type DebtParts = {
  /** 256 × 192 amber CRT: quota breakdown, deposit, entry buffer. */
  crt: ScreenSurface;
  /** Red 10-digit quota LED and amber deposit LED. */
  leds: { quota: LedPanelPart; deposit: LedPanelPart };
  /** Keypad, one dynamic mesh. Cells follow `rules.KEYS`. */
  keys: ButtonPanelPart;
  /** Receipt paper, 64 × 80 px, slides up from the printer on every deposit. */
  receipt: ScreenSurface;
  receiptPivot: THREE.Object3D;
  /** Deposit mouth lips: open wide, then chew. */
  mouthLips: THREE.Object3D;
  /** House eye lid over the alcove. */
  emblemLid: THREE.Object3D;
  settleLever: LeverPart;
  floorLever: LeverPart;
  bellRope: THREE.Object3D;
  /** Swipe-slot light: blinks green on each card swipe. */
  swipe: LampPart;
  /** Ready lamp next to the bell rope. */
  readyLamp: LampPart;
};

export const W = 1.2, D = 0.9, H = 2.4;
const COUNTER_TOP = 1.07;
const KEYPAD_Z = 0.18;

/** Keypad layout: 3 columns × 2 rows, cells named by `rules.KEYS`. */
export const KEY_POS: Record<(typeof KEYS)[number], { x: number; z: number }> = {
  p10: { x: -0.2, z: -0.06 }, p25: { x: 0, z: -0.06 }, p50: { x: 0.2, z: -0.06 },
  all: { x: -0.2, z: 0.07 }, rest: { x: 0, z: 0.07 }, enter: { x: 0.2, z: 0.07 },
};

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<DebtParts> {
  const { pal } = kit;
  const root = kit.group('debt_terminal');

  // ── static shell: flat colours, merged by kit.finalize ──
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  kit.box(W, 0.12, D, pal.black, at(0, 0.06, 0));                                            // plinth
  kit.box(W, H - 0.12, 0.12, pal.woodDark, at(0, (H + 0.12) / 2, -D / 2 + 0.06));              // alcove back
  for (const sx of [-1, 1]) kit.box(0.08, H - 0.12, D, pal.woodDark, at(sx * (W / 2 - 0.04), (H + 0.12) / 2, 0)); // posts
  kit.box(W, 0.1, D, pal.woodDark, at(0, H - 0.05, 0));                                      // canopy
  kit.box(W - 0.02, 0.03, D - 0.02, pal.brass, at(0, H - 0.12, 0));                          // brass trim under canopy
  kit.box(1.0, COUNTER_TOP - 0.12, 0.6, pal.redDark, at(0, (COUNTER_TOP + 0.12) / 2, 0.1));  // counter body
  kit.box(1.04, 0.03, 0.66, pal.brass, at(0, COUNTER_TOP - 0.015, 0.1));                    // counter lip
  kit.box(0.26, 0.1, 0.22, pal.steel, at(-0.38, COUNTER_TOP + 0.05, 0.12));                  // printer housing
  kit.box(0.14, 0.06, 0.1, pal.black, at(0.38, COUNTER_TOP + 0.03, 0.2));                     // swipe slot block
  kit.box(0.22, 0.12, 0.04, pal.black, at(0, 0.7, 0.42));                                    // deposit mouth recess
  kit.box(0.5, 0.2, 0.04, pal.brass, at(0, 0.73, 0.43));                                     // mouth plate
  kit.box(0.3, 0.02, 0.06, pal.black, at(0, 1.5, 0.28));                                     // CRT shelf shadow
  kit.box(0.48, 0.04, 0.12, pal.gold, at(0, 1.9, -0.02));                                    // quota LED bezel
  kit.box(0.46, 0.04, 0.12, pal.gold, at(0, 1.22, -0.02));                                   // deposit LED bezel

  // ── animated parts (listed in `keep`) ──
  const crt = kit.crtMonitor({ w: 0.46, h: 0.36, px: [256, 192], scheme: 'amber', glow: 0.6 });
  crt.root.position.set(0, 1.56, 0.03);
  root.add(crt.root);

  const quota = kit.ledPanel({ digits: 10, color: '#ff2a2a', h: 0.08 });
  quota.root.position.set(0, 1.9, 0.0);
  const deposit = kit.ledPanel({ digits: 10, color: '#ffb000', h: 0.07 });
  deposit.root.position.set(0, 1.22, 0.0);
  root.add(quota.root, deposit.root);

  const specs: PanelButtonSpec[] = KEYS.map((id) => ({
    id,
    label: { key: `m.debt_terminal.k_${id}` },
    color: id === 'enter' ? pal.red : id === 'all' ? pal.gold : pal.cream,
    x: KEY_POS[id].x,
    z: KEY_POS[id].z,
    w: 0.14,
    h: 0.1,
  }));
  const keys = kit.buttonPanel({ buttons: specs, w: 0.62, d: 0.32, slope: 12, plate: pal.steel, capH: 0.03 });
  keys.root.position.set(0, COUNTER_TOP, KEYPAD_Z);
  root.add(keys.root);

  const mouthLips = new THREE.Object3D();
  mouthLips.position.set(0, 0.7, 0.46);
  for (const sy of [-1, 1]) {
    kit.box(0.26, 0.05, 0.05, pal.rust, { pos: [0, sy * 0.05, 0], parent: mouthLips });
  }
  root.add(mouthLips);

  const receiptPivot = new THREE.Object3D();
  receiptPivot.position.set(-0.38, COUNTER_TOP + 0.1, 0.0);
  const receipt = kit.screen({ w: 0.2, h: 0.26, px: [64, 80], bezel: pal.black });
  receipt.mesh.position.set(0, 0.13, 0.0);
  receiptPivot.add(receipt.mesh);
  root.add(receiptPivot);

  const swipe = kit.lamp({ r: 0.02, color: pal.green, shape: 'flat' });
  swipe.root.position.set(0.38, COUNTER_TOP + 0.075, 0.2);
  root.add(swipe.root);

  const readyLamp = kit.lamp({ r: 0.025, color: pal.neonYellow, shape: 'dome' });
  readyLamp.root.position.set(0.5, 1.82, 0.22);
  root.add(readyLamp.root);

  const emblemLid = new THREE.Object3D();
  emblemLid.position.set(0, 2.14, -0.2);
  const eye = kit.sphere(0.07, pal.gold, { parent: emblemLid, wSeg: 10, hSeg: 8 });
  eye.scale.set(1.6, 0.8, 0.6);
  const lidMesh = kit.torus(0.09, 0.012, pal.brass, { parent: emblemLid, arc: Math.PI });
  lidMesh.rotation.x = Math.PI / 2;
  root.add(emblemLid);

  const settleLever = kit.lever({ length: 0.3, knob: pal.red, side: 'right' });
  settleLever.root.position.set(0.5, 1.02, 0.12);
  const floorLever = kit.lever({ length: 0.3, knob: pal.green, side: 'left' });
  floorLever.root.position.set(-0.5, 1.02, 0.12);
  root.add(settleLever.root, floorLever.root);

  const bellRope = new THREE.Object3D();
  bellRope.position.set(0.52, 2.2, 0.26);
  const rope = kit.tube([[0, 0, 0], [0, -0.45, 0.02], [0, -0.9, 0.05]], 0.012, pal.bone, { seg: 6, radialSeg: 4 });
  const grip = kit.sphere(0.025, pal.red, { pos: [0, -0.9, 0.05], parent: bellRope });
  bellRope.add(rope, grip);
  root.add(bellRope);

  // ── speaker, prompt and the pooled-light hint ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.4, 0.2); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 2.2, 0.1); root.add(prompt);
  const collectorHand = new THREE.Object3D(); collectorHand.position.set(0, COUNTER_TOP, 0.42); root.add(collectorHand);
  const coinIn = new THREE.Object3D(); coinIn.position.set(0, 0.72, 0.55); root.add(coinIn);
  const light = new THREE.Object3D();
  light.position.set(0, 1.6, 0.3);
  light.userData = { color: 0xffb060, intensity: 0.7, range: 2.2, flicker: 'STEADY' };
  root.add(light);

  const parts: DebtParts = {
    crt: crt.screen, leds: { quota, deposit }, keys, receipt, receiptPivot, mouthLips, emblemLid,
    settleLever, floorLever, bellRope, swipe, readyLamp,
  };
  kit.finalize(root, {
    keep: [crt.root, quota.root, deposit.root, keys.root, receiptPivot, mouthLips, emblemLid,
      settleLever.root, floorLever.root, bellRope, swipe.root, readyLamp.root, light],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.55, 0.85), look: new THREE.Vector3(0, 1.2, 0.1), fov: 58, mouse: 'pick' },
    colliders: [
      { min: [-W / 2, 0, -D / 2], max: [W / 2, H, -D / 2 + 0.12] },   // alcove back
      { min: [-0.5, 0, -0.2], max: [0.5, COUNTER_TOP, 0.4] },          // counter
    ],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H, D / 2 + 0.1] },
    anchors: { speaker, prompt, light, coinOut: coinIn, collectorHand, insideGlass: crt.root },
    dispose: () => { crt.screen.dispose(); receipt.dispose(); },
  };
}
