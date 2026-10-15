/**
 * Hi-Lo Ladder — procedural model ("The Ladder of Cards", MACHINES_tables §11, PLAN A.27 modelBrief). Pattern as in
 * `coinflip/model.ts`: `buildModel(kit, o)` returns the whole `MachineModel`; the exported `HiloParts` is the contract
 * with `index.ts`; metres, origin = floor centre, +Z = front (player side).
 *
 * Cabinet 0.90 W × 0.60 D × 2.30 H (M slot, WELL-08 rotY 90). Tarnished enamel body, brass trim, deco top.
 * Face: two split-flap cards (CURRENT left, NEXT right), each 0.30 × 0.42 with four hinged flap leaves and a 64 × 96
 * face screen. A 12-lamp ladder rises on the right edge, a brass thermometer (scale.y = ladder height) on the left.
 * Four brass dome buttons (HIGHER / LOWER / SKIP / COLLECT) sit under 4-digit LED windows that show live values.
 *
 * Draw plan (approximate): static shell merged into 1 draw · 2 face screens · 8 flap leaves · 4 buttons · 4 LED
 * windows · 1 bulb chain (12 lamps, one instanced draw) · thermometer liquid 1 · marquee 2 · tray 1.
 * Flap leaves rest edge-on (`FLAP_REST`, invisible from the front) and flip flat over the face while a card changes.
 */
import * as THREE from 'three';
import type { ButtonPart, LedPanelPart, MarqueePart, ScreenSurface, BulbChain } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

export type FlapCard = {
  root: THREE.Group;
  /** Four hinged leaves, pivots on their top edge. Rest = `FLAP_REST` (edge-on); flat = 0 (covers the face). */
  leaves: THREE.Object3D[];
  face: ScreenSurface;
};

/** Contract between modeler and coder. */
export type HiloParts = {
  flapCur: FlapCard;
  flapNext: FlapCard;
  /** 12 ladder lamps, bottom → top (one instanced draw). */
  rungs: BulbChain;
  buttons: { higher: ButtonPart; lower: ButtonPart; skip: ButtonPart; collect: ButtonPart };
  /** 4-digit windows over HIGHER / LOWER / SKIP and the win readout over COLLECT. */
  leds: { higher: LedPanelPart; lower: LedPanelPart; skips: LedPanelPart; win: LedPanelPart };
  /** Thermometer pivot at the bottom of the tube; scale.y 0..1 = how far up the ladder the run is. */
  thermo: THREE.Object3D;
  thermoLiquid: THREE.Mesh;
  marquee: MarqueePart;
};

export const W = 0.9, D = 0.6, H = 2.3;
export const FRONT = D / 2;
export const CARD_W = 0.3, CARD_H = 0.42, CARD_Y = 1.56;
export const CARD_X = { cur: -0.16, next: 0.16 } as const;
export const BTN_Y = 0.98, LED_Y = 1.12;
export const BTN_X = { higher: -0.24, lower: -0.08, skip: 0.08, collect: 0.24 } as const;
export const RUNG_X = 0.395, RUNG_Y0 = 0.95, RUNG_Y1 = 1.95;
export const THERMO_X = -0.39, THERMO_Y0 = 1.01, THERMO_H = 0.4;
export const FLAP_LEAVES = 4;
export const FLAP_REST = Math.PI / 2;
const LEAF_H = CARD_H / FLAP_LEAVES;

type Colourway = { body: number; trim: number; cream: number };
const COLORWAYS: ReadonlyArray<Colourway> = [
  { body: 0x2f4a3a, trim: 0xc8a040, cream: 0xe8e0c8 },   // tarnished green (the reference)
  { body: 0x5a1e22, trim: 0xc8a040, cream: 0xe8e0c8 },   // oxblood
  { body: 0x1e3a5a, trim: 0xc8a040, cream: 0xe8e0c8 },   // cobalt
  { body: 0x1a1a1a, trim: 0xc8a040, cream: 0xe8e0c8 },   // black
];
const DARK = 0x0e1a14, LAMP = 0xffc83d, LED = 0xffb020, LIQUID = 0xe0463c;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<HiloParts> {
  const cw = COLORWAYS[o.variant] ?? COLORWAYS[0];
  const root = kit.group('hilo');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell: flat colours only, merged by kit.finalize ──
  kit.box(W, 2.2, D, cw.body, at(0, 1.1, 0));                                      // body
  kit.box(W - 0.04, 0.1, D - 0.04, cw.trim, at(0, 2.25, 0));                       // deco top
  kit.box(W - 0.1, 0.12, 0.02, cw.trim, at(0, 2.2 - 0.06, FRONT + 0.004));         // marquee bezel
  kit.box(0.84, 1.2, 0.012, DARK, at(0, 1.4, FRONT + 0.002));                       // face plate
  kit.box(0.7, 0.04, 0.02, cw.trim, at(0, 0.74, FRONT + 0.006));                    // base moulding
  kit.box(0.06, 0.8, 0.02, cw.trim, at(-W / 2 + 0.03, 1.1, FRONT + 0.004));         // side rails
  kit.box(0.06, 0.8, 0.02, cw.trim, at(W / 2 - 0.03, 1.1, FRONT + 0.004));
  for (const cx of [CARD_X.cur, CARD_X.next]) {                                     // card frames (brass)
    kit.box(CARD_W + 0.024, CARD_H + 0.024, 0.006, cw.trim, at(cx, CARD_Y, FRONT + 0.005));
  }
  kit.box(0.04, RUNG_Y1 - RUNG_Y0 + 0.08, 0.008, DARK, at(RUNG_X, (RUNG_Y0 + RUNG_Y1) / 2, FRONT + 0.005)); // ladder track
  kit.box(0.05, THERMO_H + 0.1, 0.008, 0x1a2a22, at(THERMO_X, THERMO_Y0 + THERMO_H / 2, FRONT + 0.005));  // tube housing
  for (const x of Object.values(BTN_X)) kit.box(0.1, 0.1, 0.01, DARK, at(x, BTN_Y, FRONT + 0.006));      // button plates
  kit.box(0.36, 0.02, 0.1, cw.trim, at(0, 0.6, FRONT + 0.03));                       // tray lip

  // ── two split-flap cards ──
  const flap = (cx: number, tag: string): FlapCard => {
    const r = new THREE.Group();
    r.name = `flap-${tag}`;
    r.position.set(cx, CARD_Y, 0);
    root.add(r);
    // 360 x 504 px (was 240 x 336, upscaled ~1.4x at the seat): no CRT scanlines, no halo, linear + mips below, so the
    // rank and suit stay crisp at the end-of-round frame. kit.screen bulges its glass ~21 mm towards the seat, which
    // would swallow the flaps when they flip flat, so the card glass is a flat plane 3 mm in front of the frame, just
    // behind the leaves (which cover it when they flip over).
    const face = kit.screen({ w: CARD_W, h: CARD_H, px: [360, 504], bezel: DARK, scanlines: false });
    face.mesh.geometry.dispose();
    face.mesh.geometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
    face.mesh.position.set(0, 0, FRONT + 0.0105);
    crispTexture(face.tex, 8);
    r.add(face.mesh);
    const leaves: THREE.Object3D[] = [];
    for (let i = 0; i < FLAP_LEAVES; i++) {
      const pivot = new THREE.Object3D();
      pivot.position.set(0, CARD_H / 2 - i * LEAF_H, FRONT + 0.012);
      pivot.rotation.x = FLAP_REST;
      const leaf = kit.box(CARD_W, LEAF_H - 0.004, 0.004, cw.cream, { pos: [0, -LEAF_H / 2, 0], parent: pivot });
      leaf.name = `leaf-${tag}-${i}`;
      r.add(pivot);
      leaves.push(pivot);
    }
    return { root: r, leaves, face };
  };
  const flapCur = flap(CARD_X.cur, 'cur');
  const flapNext = flap(CARD_X.next, 'next');

  // ── ladder: 12 lamps, one instanced chain ──
  const rungs = kit.bulbChain({
    path: [[RUNG_X, RUNG_Y0, FRONT + 0.01], [RUNG_X, RUNG_Y1, FRONT + 0.01]],
    count: 12, colors: [LAMP], r: 0.011,
  });
  root.add(rungs.root);

  // ── thermometer: liquid column pivots at the bottom of the tube ──
  const thermo = new THREE.Object3D();
  thermo.position.set(THERMO_X, THERMO_Y0, FRONT + 0.012);
  root.add(thermo);
  const thermoLiquid = kit.box(0.03, THERMO_H, 0.004, LIQUID, { pos: [0, THERMO_H / 2, 0], parent: thermo });
  thermo.scale.set(1, 0.0001, 1);

  // ── buttons: brass domes on a vertical face, cap pointing out ──
  const btn = (color: number, x: number): ButtonPart => {
    const b = kit.button({ shape: 'round', r: 0.035, color });
    b.root.position.set(x, BTN_Y, FRONT + 0.014);
    b.root.rotation.x = Math.PI / 2;
    root.add(b.root);
    return b;
  };
  const buttons = {
    higher: btn(0xd8b050, BTN_X.higher),
    lower: btn(0xc8a040, BTN_X.lower),
    skip: btn(0xb8c0c8, BTN_X.skip),
    collect: btn(0xc02a2a, BTN_X.collect),
  };

  // ── LED windows over the buttons ──
  const led = (digits: number, x: number): LedPanelPart => {
    const p = kit.ledPanel({ digits, color: '#ffb020', h: 0.05 });
    p.root.position.set(x, LED_Y, FRONT + 0.01);
    root.add(p.root);
    return p;
  };
  const leds = {
    higher: led(5, BTN_X.higher),
    lower: led(5, BTN_X.lower),
    skips: led(1, BTN_X.skip),
    win: led(5, BTN_X.collect),
  };

  // ── marquee + coin tray + light hint ──
  const marquee = kit.marquee({ w: 0.8, h: 0.14, text: { key: 'm.hilo.marquee' }, color: LAMP, bg: DARK, bulbs: 14 });
  marquee.root.position.set(0, 2.1, FRONT + 0.012);
  root.add(marquee.root);

  const tray = kit.coinTray({ w: 0.3, color: cw.trim });
  tray.root.position.set(0, 0.6, FRONT + 0.05);
  root.add(tray.root);

  // two pooled-light hints (world registers `light` and `light2`): a cool key over the card, a warm fill over the controls
  const light = new THREE.Object3D();
  light.position.set(0, 1.95, FRONT + 0.45);
  light.userData = { color: 0xfff0d0, intensity: 1.1, range: 2.4, flicker: 'STEADY' };
  root.add(light);
  const light2 = new THREE.Object3D();
  light2.position.set(0, 1.05, FRONT + 0.5);
  light2.userData = { color: LAMP, intensity: 0.8, range: 1.8, flicker: 'STEADY' };
  root.add(light2);

  const speaker = new THREE.Object3D();
  speaker.position.set(0, 1.0, 0);
  root.add(speaker);

  const parts: HiloParts = { flapCur, flapNext, rungs, buttons, leds, thermo, thermoLiquid, marquee };
  kit.finalize(root, {
    keep: [
      flapCur.root, flapNext.root, rungs.root, thermo, marquee.root, light, light2,
      buttons.higher.root, buttons.lower.root, buttons.skip.root, buttons.collect.root,
      leds.higher.root, leds.lower.root, leds.skips.root, leds.win.root,
    ],
  });

  return {
    root,
    parts,
    // seat 1.25 m in front of the card plane (z 0.31): at fov 50 the view is ~1.17 m tall (y 0.82–1.98), so the
    // card (1.35–1.77), LED windows (1.10–1.15) and buttons (0.94–1.02) are all fully framed at 16:9
    playPose: { pos: new THREE.Vector3(0, 1.45, 1.2), look: new THREE.Vector3(0, 1.45, 0), fov: 44, mouse: 'pick' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H - 0.02, D / 2] }],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H - 0.02, D / 2 + 0.1] },
    anchors: { speaker, prompt: marquee.root, coinOut: tray.anchor, light, light2 },
    dispose: () => {
      flapCur.face.dispose();
      flapNext.face.dispose();
    },
  };
}
