/**
 * One-Armed Bandit — procedural model (MACHINES_machines §3, plan.json modelBrief, ART §5.2).
 *  - `buildModel(kit, o)` returns the full `MachineModel` and nothing else touches the scene;
 *  - `BanditParts` is the contract with `index.ts`;
 *  - metres, origin = floor centre, +Z = front (the player side), everything inside the S slot box;
 *  - static geometry is merged by `kit.finalize`; reels, lever, lamps, screens and the maw are kept;
 *  - `o.variant` (0..3) picks a colourway: casting / enamel face / lever knob.
 *
 * Cabinet: walnut pedestal 0.40 × 0.78 × 0.40, cast head 0.44 wide with a half-round crown (r 0.18) to 1.48 m, a 0.30 × 0.11
 * reel window with three 22-facet drums, a red payline, an award glass above the window, two emissive eye vents,
 * the maw window with a coin pile below it, a payout cup, and a chrome lever on the right (pivot 0.24, 1.18, 0).
 */
import * as THREE from 'three';
import type { Kit, LampPart, Palette, ReelPart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { facetSymbol, STOPS, type Sym } from './rules';

/** Contract between modeller and coder. */
export type BanditParts = {
  /** Three 22-facet drums, axis X, payline at +Z. Index = reel. */
  reels: [ReelPart, ReelPart, ReelPart];
  /** Lever pivot. `rotation.x = -angle` brings the arm forward (towards the player). */
  lever: THREE.Object3D;
  /** Ball knob at the arm tip (the grab target). */
  knob: THREE.Object3D;
  /** Visible lock that drops while the reels spin. */
  latch: THREE.Object3D;
  /** 128 × 64 award glass (paytable). Drawn once per language. */
  award: ScreenSurface;
  /** 64 × 16 LED windows on the belly glass: credit (wallet), bet, win. */
  leds: { credit: ScreenSurface; bet: ScreenSurface; win: ScreenSurface };
  lampReel: LampPart;
  lampCoin: LampPart;
  lampTilt: LampPart;
  /** Emissive eye vents above the window. */
  eyes: [LampPart, LampPart];
  /** Coin pile behind the maw window. `count` shows the pile size (0..MAW_COINS). */
  maw: THREE.InstancedMesh;
  /** Payout cup. `coinOut` anchors the hopper coins here. */
  cup: THREE.Object3D;
};

export const W = 0.44, D = 0.42;
export const PED_W = 0.40, PED_H = 0.78;
export const HEAD_TOP = 1.30, TOP = 1.48;
export const REEL_R = 0.10, REEL_WIDTH = 0.075, REEL_X: readonly number[] = [-0.10, 0, 0.10], REEL_Y = 1.12;
export const WIN_W = 0.30, WIN_H = 0.11;
export const LEVER_PIVOT: readonly [number, number, number] = [0.24, 1.18, 0];
export const LEVER_LEN = 0.42;
export const MAW_COINS = 30;
const MAW_Y = 0.90;

/** Lever arm angles (rad). The lever rests at 0 and trips at TRIP. */
export const LEVER_MAX = 1.05, LEVER_TRIP = 0.86;

type PalKey = keyof Palette;
const COLORWAYS: ReadonlyArray<{ casting: PalKey; face: PalKey; knob: PalKey }> = [
  { casting: 'brass', face: 'redDark', knob: 'red' },
  { casting: 'chrome', face: 'blue', knob: 'bone' },
  { casting: 'steel', face: 'green', knob: 'gold' },
  { casting: 'gold', face: 'black', knob: 'chrome' },
];

/** Symbol id in the texgen registry for each reel symbol. ORANGE is a bandit-only painter (registered in `buildModel`). */
const TEX: Record<Sym, string> = {
  STAR: 'star', PLUM: 'plum', ORANGE: 'bandit.orange', MELON: 'melon', BAR: 'bar', '2BAR': 'bar2', '3BAR': 'bar3',
  SHOE: 'horseshoe', BLANK: 'blank',
};

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<BanditParts> {
  const { pal } = kit;
  const cw = COLORWAYS[o.variant] ?? COLORWAYS[0];
  const casting = pal[cw.casting], face = pal[cw.face], knobC = pal[cw.knob];
  const root = kit.group('bandit');

  kit.tex.registerSymbol('bandit.orange', (g, s) => {
    g.fillStyle = '#FF8C1A';
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#FFC070';
    g.beginPath(); g.arc(s * 0.42, s * 0.40, s * 0.12, 0, Math.PI * 2); g.fill();
  });

  // ── static cabinet (flat colours, merged by finalize) ──
  const at = (x: number, y: number, z: number, parent: THREE.Object3D = root): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent });
  kit.box(PED_W, PED_H, PED_W, pal.woodDark, at(0, PED_H / 2, 0));                              // walnut pedestal
  kit.box(PED_W + 0.02, 0.03, PED_W + 0.02, pal.woodDark, at(0, PED_H + 0.015, 0));              // plinth top
  const headH = HEAD_TOP - PED_H;
  kit.box(0.02, headH, D, casting, at(-W / 2 + 0.01, PED_H + headH / 2, 0));                    // head sides
  kit.box(0.02, headH, D, casting, at(W / 2 - 0.01, PED_H + headH / 2, 0));
  kit.box(W, headH, 0.02, casting, at(0, PED_H + headH / 2, -D / 2 + 0.01));                     // back
  kit.box(W, 0.02, D, casting, at(0, HEAD_TOP - 0.01, 0));                                       // top cover
  kit.cyl(TOP - HEAD_TOP, TOP - HEAD_TOP, W, casting, { rot: [0, 0, 90], pos: [0, HEAD_TOP, 0], seg: 12, parent: root }); // crown
  // front: the reel window and the maw are gaps in the face
  const winBot = REEL_Y - WIN_H / 2, winTop = REEL_Y + WIN_H / 2;
  kit.box(W, HEAD_TOP - winTop, 0.02, face, at(0, (winTop + HEAD_TOP) / 2, D / 2 - 0.01));       // upper band
  kit.box(W, winBot - PED_H, 0.02, face, at(0, (winBot + PED_H) / 2, D / 2 - 0.01));             // lower face
  for (const sx of [-1, 1]) kit.box((W - WIN_W) / 2, WIN_H, 0.02, face, at(sx * (WIN_W / 2 + (W - WIN_W) / 4), REEL_Y, D / 2 - 0.01));
  kit.box(0.20, 0.08, 0.005, pal.black, at(0, MAW_Y, D / 2 + 0.001));                           // maw window
  kit.box(0.05, 0.03, 0.01, pal.brass, at(0.13, 0.98, D / 2 + 0.005));                          // coin slot plate
  kit.box(0.10, 0.03, 0.10, pal.brass, at(0, 0.42, 0.12, root));                                // cup seat
  kit.box(WIN_W, 0.008, 0.01, pal.red, at(0, REEL_Y, 0.112));                                   // payline bar
  kit.lathe([[0.02, 0.0], [0.05, 0.02], [0.056, 0.06], [0.05, 0.075]], 12, pal.brass, { pos: [0, 0.44, 0.24], parent: root }); // cup

  // ── reels: 22 facets each, reel 1 rotated +7 (see rules.REEL_ROT) ──
  const reels = REEL_X.map((x, r) => {
    const symbols = Array.from({ length: STOPS }, (_, f) => TEX[facetSymbol(r, f)]);
    const part = kit.reel({ radius: REEL_R, width: REEL_WIDTH, symbols, cell: 32 });
    part.root.position.set(x, REEL_Y, 0);
    root.add(part.root);
    return part;
  }) as [ReelPart, ReelPart, ReelPart];

  // ── lever (pivot on the right side of the head) ──
  const lever = new THREE.Object3D();
  lever.position.set(LEVER_PIVOT[0], LEVER_PIVOT[1], LEVER_PIVOT[2]);
  root.add(lever);
  kit.cyl(0.012, 0.012, LEVER_LEN, pal.chrome, { pos: [0, -LEVER_LEN / 2, 0], seg: 8, parent: lever });
  const knob = kit.sphere(0.035, knobC, { pos: [0, -LEVER_LEN, 0], parent: lever, wSeg: 8, hSeg: 6 });
  const latch = kit.box(0.03, 0.03, 0.045, pal.brass, { pos: [0, 0, 0.03], parent: lever });

  // ── screens and lamps ──
  // 256 × 128 texels (2× the old density): the numerals are drawn at integer scale 2, so each glyph pixel is 2 texels
  const award = kit.screen({ w: 0.30, h: 0.10, px: [256, 128], bezel: pal.black });
  award.mesh.position.set(0, (winTop + HEAD_TOP) / 2, D / 2 + 0.002);
  root.add(award.mesh);

  const eyes: [LampPart, LampPart] = [
    kit.lamp({ r: 0.018, color: pal.red, shape: 'flat' }),
    kit.lamp({ r: 0.018, color: pal.red, shape: 'flat' }),
  ];
  eyes.forEach((e, i) => { e.root.position.set(i === 0 ? -0.19 : 0.19, (winTop + HEAD_TOP) / 2, D / 2 + 0.003); root.add(e.root); });

  const lampReel = kit.lamp({ r: 0.03, color: pal.gold, shape: 'dome' });
  lampReel.root.position.set(0, 1.44, 0.12);
  const lampCoin = kit.lamp({ r: 0.018, color: pal.neonCyan, shape: 'flat' });
  lampCoin.root.position.set(-0.15, 0.73, PED_W / 2 + 0.003);
  const lampTilt = kit.lamp({ r: 0.018, color: pal.red, shape: 'flat' });
  lampTilt.root.position.set(0.15, 0.73, PED_W / 2 + 0.003);
  root.add(lampReel.root, lampCoin.root, lampTilt.root);

  const ledW = 0.09, ledH = 0.03;
  const led = (x: number): ScreenSurface => {
    const s = kit.screen({ w: ledW, h: ledH, px: [128, 32], bezel: pal.black });
    s.mesh.position.set(x, 0.66, PED_W / 2 + 0.002);
    root.add(s.mesh);
    return s;
  };
  const leds = { credit: led(-0.12), bet: led(0), win: led(0.12) };

  // ── maw coin pile: 30 flat coins, count = pile size ──
  const coinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.006, 10);
  coinGeo.rotateX(Math.PI / 2);
  const maw = new THREE.InstancedMesh(coinGeo, kit.mat(pal.gold), MAW_COINS);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < MAW_COINS; i++) {
    const col = i % 5, row = Math.floor(i / 5);
    dummy.position.set(-0.08 + col * 0.04, MAW_Y - 0.035 + row * 0.012, D / 2 + 0.012);
    dummy.updateMatrix();
    maw.setMatrixAt(i, dummy.matrix);
  }
  maw.instanceMatrix.needsUpdate = true;
  root.add(maw);

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 1.0, 0.22); root.add(speaker);
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.52, 0); root.add(prompt);
  const label = new THREE.Object3D(); label.position.set(0, 0.58, PED_W / 2); root.add(label);
  const marqueeTop = new THREE.Object3D(); marqueeTop.position.set(0, TOP, 0); root.add(marqueeTop);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0, 0.35, -PED_W / 2 - 0.005); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0, 0.3); root.add(stand);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0, 0.52, 0.24); root.add(coinOut);
  const fxTwist = new THREE.Object3D(); fxTwist.position.set(0, winTop + 0.04, D / 2); root.add(fxTwist);
  const light = new THREE.Object3D();
  light.position.set(0, 1.2, 0.2);
  light.userData = { color: 0xffd9a0, intensity: 0.5, range: 1.2, flicker: 'CANDLE' };
  root.add(light);

  const cup = new THREE.Object3D(); cup.position.set(0, 0.44, 0.24); root.add(cup);

  const parts: BanditParts = {
    reels, lever, knob, latch, award, leds, lampReel, lampCoin, lampTilt, eyes, maw, cup,
  };
  kit.finalize(root, {
    keep: [
      ...reels.map((r) => r.root), lever, award.mesh, leds.credit.mesh, leds.bet.mesh, leds.win.mesh, maw,
    ],
  });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.42, 0.62), look: new THREE.Vector3(0, 1.15, 0), fov: 50, mouse: 'pick' },
    colliders: [
      { min: [-PED_W / 2, 0, -PED_W / 2], max: [PED_W / 2, PED_H, PED_W / 2] },
      { min: [-W / 2, PED_H, -D / 2], max: [W / 2, HEAD_TOP, D / 2] },
    ],
    interact: { min: [-W / 2, 0, -D / 2], max: [W / 2 + 0.04, TOP, D / 2 + 0.1] },
    anchors: {
      speaker, prompt, label, marqueeTop, servicePlate, stand, coinOut, light, fxTwist,
    },
    dispose: () => { award.dispose(); leds.credit.dispose(); leds.bet.dispose(); leds.win.dispose(); },
  };
}
