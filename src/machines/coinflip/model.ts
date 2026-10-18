/**
 * Coin Flip Booth — procedural model (base-machines WP, reference machine). Pattern for every `model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and NOTHING else touches the scene;
 *  - the exported `Parts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), everything inside the slot box;
 *  - static geometry is merged by `kit.finalize`, animated parts are listed in `keep`;
 *  - all diegetic text is a `{ key }` TextSource (re-drawn on language change by the kit);
 *  - `o.variant` (0..3) picks one of four colourways so a row of booths never looks identical.
 *
 * Booth: 0.78 × 0.78 × 2.0 m (S slot). Walnut counter with a felt landing dish, a red back panel carrying the streak
 * screen, two call lamps and a 10-bulb chaser marquee, three round buttons (HEADS / FLIP / TAILS) on the deck and a
 * coin tray. Play pose: standing, looking down at the dish.
 *
 * BUDGET (ART §1.11 / PLAN §4.2, S slot): ≤ 700 tris, ≤ 10 draw calls. Draw plan: static merged shell 1 · coin 1 ·
 * three buttons 3 · two lamps 2 · screen 1 · marquee 2. Every static surface uses a FLAT colour (no textures), so the
 * shell merges into one draw. Cut on purpose: cabinet kit (14–16 draws), glass panes and blob shadow (transparent =
 * extra draws), button labels (1 draw each; the HUD names the actions), torus rim. Verify with bench F3 before merging.
 */
import * as THREE from 'three';
import type { Kit, ButtonPart, LampPart, MarqueePart, ScreenSurface, Palette } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

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
const BULBS = 10;

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

  // ── static shell: flat colours only, so kit.finalize merges it into ONE draw call ──
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });
  kit.box(W, COUNTER_H, D, body, at(0, COUNTER_H / 2, 0));                                        // counter
  kit.box(W, H - COUNTER_H - 0.06, 0.06, panelC, at(0, (COUNTER_H + H - 0.06) / 2, -D / 2 + 0.03)); // back panel
  kit.box(W, 0.06, D, body, at(0, H - 0.03, 0));                                                  // canopy
  kit.box(W - 0.02, 0.025, D - 0.02, trim, at(0, H - 0.07, 0));                                   // brass trim
  for (const sx of [-1, 1]) kit.box(0.03, H - COUNTER_H - 0.06, 0.03, trim, at(sx * (W / 2 - 0.02), (COUNTER_H + H - 0.06) / 2, D / 2 - 0.02));
  kit.cyl(0.17, 0.17, 0.02, pal.felt, { pos: [0, COUNTER_H + 0.01, DISH_Z], seg: 12, parent: root }); // landing dish
  kit.box(0.2, 0.03, 0.16, trim, at(0.27, COUNTER_H + 0.015, -0.22));                             // coin tray

  // ── animated parts (listed in `keep`) ──
  const dish = new THREE.Object3D();
  dish.position.set(0, DISH_TOP, DISH_Z);
  root.add(dish);

  const coinPivot = new THREE.Object3D();
  coinPivot.position.set(0, coinRestY(0), DISH_Z);
  root.add(coinPivot);
  const coin = kit.coin({ r: COIN_R, thick: COIN_THICK, heads: 'crown', tails: 'eye', color: pal.gold });
  coinPivot.add(coin);

  // unlabelled round buttons: the HUD hint strip names the actions (a label costs a draw call each)
  const btnHeads = kit.button({ shape: 'round', r: 0.034, color: pal.gold });
  btnHeads.root.position.set(-0.22, COUNTER_H, 0.24);
  const btnFlip = kit.button({ shape: 'round', r: 0.045, color: pal.red });
  btnFlip.root.position.set(0, COUNTER_H, 0.26);
  const btnTails = kit.button({ shape: 'round', r: 0.034, color: pal.chrome });
  btnTails.root.position.set(0.22, COUNTER_H, 0.24);
  root.add(btnHeads.root, btnFlip.root, btnTails.root);

  // ── back panel furniture ──
  const lampHeads = kit.lamp({ r: 0.035, color: pal.gold, shape: 'dome' });
  lampHeads.root.position.set(-0.29, 1.4, -D / 2 + 0.065);
  const lampTails = kit.lamp({ r: 0.035, color: pal.neonCyan, shape: 'dome' });
  lampTails.root.position.set(0.29, 1.4, -D / 2 + 0.065);
  const screen = kit.screen({ w: 0.36, h: 0.18, px: [96, 48], bezel: pal.black, scanlines: false });   // 1-px glyph strokes: no scanline darkening
  crispTexture(screen.tex, 4);
  screen.mesh.position.set(0, 1.4, -D / 2 + 0.062);
  const marquee = kit.marquee({ w: W - 0.06, h: 0.2, text: { key: 'm.coinflip.name' }, color: pal.neonYellow, bg: pal.black, bulbs: BULBS });
  marquee.root.position.set(0, 1.83, -D / 2 + 0.07);
  root.add(lampHeads.root, lampTails.root, screen.mesh, marquee.root);

  // light hint for the world's pooled lights (no THREE.Light inside machines)
  const light = new THREE.Object3D();
  light.position.set(0, 1.7, 0.1);
  light.userData = { color: 0xffe2a0, intensity: 0.6, range: 1.8, flicker: 'STEADY' };
  root.add(light);

  // speaker / coin-out anchors (no mesh: the tray is part of the static shell)
  const speaker = new THREE.Object3D();
  speaker.position.set(0, 1.1, 0);
  root.add(speaker);
  const coinOut = new THREE.Object3D();
  coinOut.position.set(0.27, COUNTER_H + 0.04, -0.22);
  root.add(coinOut);

  const parts: CoinFlipParts = { coinPivot, coin, btnHeads, btnTails, btnFlip, lampHeads, lampTails, screen, marquee, dish };
  kit.finalize(root, { keep: [coinPivot, dish, btnHeads.root, btnTails.root, btnFlip.root, lampHeads.root, lampTails.root, screen.mesh, marquee.root, light] });

  return {
    root,
    parts,
    // seat view: backed off to 1.05 m and lowered, looking at the coin dish, so the booth (screen, marquee) and the coin
    // frame in the camera with nothing standing between the lens and the booth (no mannequin in the shot)
    playPose: { pos: new THREE.Vector3(0, 1.52, 1.05), look: new THREE.Vector3(0, 1.12, -0.1), fov: 58, mouse: 'primary' },
    colliders: [{ min: [-W / 2, 0, -D / 2], max: [W / 2, H - 0.02, D / 2] }],
    interact: { min: [-W / 2, 0.3, -D / 2], max: [W / 2, H - 0.02, D / 2 + 0.1] },
    anchors: { speaker, prompt: marquee.root, coinOut, light },
    dispose: () => screen.dispose(),
  };
}
