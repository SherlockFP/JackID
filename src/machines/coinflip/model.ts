/**
 * Coin Flip Booth — procedural model (base-machines WP, reference machine). Pattern for every `model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and NOTHING else touches the scene;
 *  - the exported `Parts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), everything inside the slot box;
 *  - static geometry is merged by `kit.finalize`, animated parts are listed in `keep`;
 *  - all diegetic text is a `{ key }` TextSource (re-drawn on language change by the kit);
 *  - `o.variant` (0..3) picks one of four colourways so a row of booths never looks identical.
 *
 * Booth: 0.78 × 0.78 × 2.0 m (S slot). Walnut counter with a felt landing dish, glass side panes under a brass-trimmed
 * canopy, a red back panel carrying the streak screen, two call lamps and an 18-bulb chaser marquee, three mushroom
 * buttons (HEADS / FLIP / TAILS) on the deck and a coin tray. Play pose: standing, looking down at the dish.
 *
 * BUDGET NOTE: this reference model is ~1.5k tris / ~25 draws, above the 700 / 10 machine budget (M2 coinflip pass will
 * trim it). Do NOT copy its detail level: merge static meshes via `kit.finalize` and keep ≤ 700 tris / 10 draws.
 */
import * as THREE from 'three';
import type { Kit, ButtonPart, LampPart, MarqueePart, ScreenSurface, Palette } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';

/** Contract between modeler and coder. */
export type CoinFlipParts = {
  /** Translates in Y during the toss; carries `coin`. */
  coinPivot: THREE.Object3D;
  /** Rotates about local X; the HEADS face points +Y at `rotation.x = 0`, TAILS at π. */
  coin: THREE.Mesh;
  btnHeads: ButtonPart;
  btnTails: ButtonPart;
  btnFlip: ButtonPart;
  lampHeads: LampPart;
  lampTails: LampPart;
  /** 96 × 48 px streak / pot / history display. */
  screen: ScreenSurface;
  marquee: MarqueePart;
  /** Centre of the felt dish (FX anchor for landing dust / glints), machine-local. */
  dish: THREE.Object3D;
};

export const W = 0.78, D = 0.78, H = 2.0;
export const COUNTER_H = 0.9;
export const DISH_Z = -0.04;
export const DISH_TOP = COUNTER_H + 0.02;
export const COIN_R = 0.06, COIN_THICK = 0.012;

/** Height of the coin's centre when it rests on the dish at rotation `theta` (0 = flat, π/2 = standing on its edge). */
export function coinRestY(theta: number): number {
  return DISH_TOP + COIN_R * Math.abs(Math.sin(theta)) + (COIN_THICK / 2) * Math.abs(Math.cos(theta));
}

type PalKey = keyof Palette;
const COLORWAYS: ReadonlyArray<{ body: PalKey; trim: PalKey; panel: PalKey }> = [
  { body: 'woodDark', trim: 'brass', panel: 'redDark' },
  { body: 'redDark', trim: 'gold', panel: 'woodDark' },
  { body: 'feltDark', trim: 'brass', panel: 'blood' },
  { body: 'carpet', trim: 'chrome', panel: 'woodDark' },
];

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<CoinFlipParts> {
  const { pal } = kit;
  const cw = COLORWAYS[o.variant] ?? COLORWAYS[0];
  const body = pal[cw.body], trim = pal[cw.trim], panelC = pal[cw.panel];
  const root = kit.group('coinflip');

  // ── counter, back panel, canopy, posts, glass ──
  const cab = kit.cabinet({ style: 'counter', w: W, h: COUNTER_H, d: D, body, trim, grime: 0.25 });
  root.add(cab.root);
  kit.box(W, H - COUNTER_H - 0.06, 0.06, { color: panelC, map: kit.tex.wood(panelC) }, { pos: [0, (COUNTER_H + H - 0.06) / 2, -D / 2 + 0.03], parent: root });
  kit.box(W, 0.06, D, { color: body, map: kit.tex.wood(body) }, { pos: [0, H - 0.03, 0], parent: root });
  kit.box(W - 0.02, 0.025, D - 0.02, trim, { pos: [0, H - 0.07, 0], parent: root });
  for (const sx of [-1, 1]) {
    kit.cyl(0.02, 0.02, H - COUNTER_H - 0.06, trim, { pos: [sx * (W / 2 - 0.025), (COUNTER_H + H - 0.06) / 2, D / 2 - 0.03], seg: 8, parent: root });
    const pane = kit.glass({ w: 0.012, h: H - COUNTER_H - 0.12, d: D - 0.1, tint: pal.glass, opacity: 0.16 });
    pane.position.set(sx * (W / 2 - 0.012), (COUNTER_H + H - 0.06) / 2, -0.01);
    root.add(pane);
  }

  // ── landing dish + coin ──
  kit.cyl(0.17, 0.17, 0.02, { color: pal.felt, map: kit.tex.felt(pal.felt) }, { pos: [0, COUNTER_H + 0.01, DISH_Z], seg: 16, parent: root });
  kit.torus(0.17, 0.012, trim, { pos: [0, COUNTER_H + 0.02, DISH_Z], rot: [90, 0, 0], seg: 16, parent: root });
  const dish = new THREE.Object3D();
  dish.position.set(0, DISH_TOP, DISH_Z);
  root.add(dish);

  const coinPivot = new THREE.Object3D();
  coinPivot.position.set(0, coinRestY(0), DISH_Z);
  root.add(coinPivot);
  const coin = kit.coin({ r: COIN_R, thick: COIN_THICK, heads: 'crown', tails: 'eye', color: pal.gold });
  coinPivot.add(coin);

  // ── deck controls ──
  const btnHeads = kit.button({ shape: 'mushroom', r: 0.034, color: pal.gold, label: { key: 'm.coinflip.heads' } });
  btnHeads.root.position.set(-0.22, COUNTER_H, 0.24);
  const btnFlip = kit.button({ shape: 'mushroom', r: 0.045, color: pal.red, label: { key: 'm.coinflip.flip' } });
  btnFlip.root.position.set(0, COUNTER_H, 0.26);
  const btnTails = kit.button({ shape: 'mushroom', r: 0.034, color: pal.chrome, label: { key: 'm.coinflip.tails' } });
  btnTails.root.position.set(0.22, COUNTER_H, 0.24);
  root.add(btnHeads.root, btnFlip.root, btnTails.root);

  const tray = kit.coinTray({ w: 0.2, color: pal.chrome });
  tray.root.position.set(0.27, COUNTER_H, -0.22);
  root.add(tray.root);

  // ── back panel furniture ──
  const lampHeads = kit.lamp({ r: 0.035, color: pal.gold, shape: 'dome' });
  lampHeads.root.position.set(-0.29, 1.4, -D / 2 + 0.065);
  const lampTails = kit.lamp({ r: 0.035, color: pal.neonCyan, shape: 'dome' });
  lampTails.root.position.set(0.29, 1.4, -D / 2 + 0.065);
  const screen = kit.screen({ w: 0.36, h: 0.18, px: [96, 48], bezel: pal.black });
  screen.mesh.position.set(0, 1.4, -D / 2 + 0.062);
  const marquee = kit.marquee({ w: W - 0.06, h: 0.2, text: { key: 'm.coinflip.name' }, color: pal.neonYellow, bg: pal.black, bulbs: 18 });
  marquee.root.position.set(0, 1.83, -D / 2 + 0.07);
  root.add(lampHeads.root, lampTails.root, screen.mesh, marquee.root);
  root.add(kit.blobShadow(W + 0.06, D + 0.06));

  // light hint for the world's pooled lights (no THREE.Light inside machines)
  const light = new THREE.Object3D();
  light.position.set(0, 1.7, 0.1);
  light.userData = { color: 0xffe2a0, intensity: 0.6, range: 1.8, flicker: 'STEADY' };
  root.add(light);

  const parts: CoinFlipParts = { coinPivot, coin, btnHeads, btnTails, btnFlip, lampHeads, lampTails, screen, marquee, dish };
  kit.finalize(root, { keep: [coinPivot, dish, btnHeads, btnTails, btnFlip, lampHeads, lampTails, screen.mesh, marquee, tray, light] });

  return {
    root,
    parts,
    playPose: { pos: new THREE.Vector3(0, 1.6, 0.8), look: new THREE.Vector3(0, 1.1, -0.1), fov: 56, mouse: 'primary' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H - 0.02, D / 2] }],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H - 0.02, D / 2 + 0.1] },
    anchors: { speaker: cab.anchors.speaker, prompt: marquee.root, coinOut: tray.anchor, light },
    dispose: () => screen.dispose(),
  };
}
