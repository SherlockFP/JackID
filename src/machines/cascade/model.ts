/**
 * Gilded Cascade — procedural model (PSX cabinet, ART_BIBLE). Pattern as in `pachislot/model.ts`:
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `CascadeParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre of the footprint, +Z = front (the player side), y up.
 *
 * Footprint 1.00 W × 0.80 D × 2.90 H (slot M). A plum-black upright with a gold rail: a plinth, a slanted deck with five
 * buttons, a lever and two LED readouts, one big 0.84 × 0.75 m screen (the 6 × 5 grid, a canvas), side bulb chains, a
 * marquee under a crown topper with a turning beacon, two orb lamps and a coin tray.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { BulbChain, ButtonPart, LampPart, LedPanelPart, LeverPart, MarqueePart, ScreenSurface } from '@/kit/types';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import type { V3 } from '@/core/types';
import { SCREEN_PX } from './view';

/** Contract between modeler and coder. */
export type CascadeParts = {
  /** The 216 × 192 grid screen. */
  screens: { main: ScreenSurface };
  buttons: { spin: ButtonPart; betDown: ButtonPart; betUp: ButtonPart; max: ButtonPart; turbo: ButtonPart };
  lever: LeverPart;
  leds: { credit: LedPanelPart; win: LedPanelPart };
  lamps: { orbL: LampPart; orbR: LampPart; crown: LampPart };
  /** Two vertical strips of 14 bulbs beside the screen. */
  side: [BulbChain, BulbChain];
  marquee: MarqueePart;
  /** Spinning card on top: turns during the free round. Origin = pivot. */
  beacon: THREE.Object3D;
  /** Where coins fall (FX anchor). */
  tray: THREE.Object3D;
};

const BODY_BY_VARIANT = [0x1c0d24, 0x0c1a2c, 0x23160a, 0x121212] as const;   // plum, navy, bronze, black
const TRIM_BY_VARIANT = [0xf2c14e, 0xf2c14e, 0xf2c14e, 0xe0218a] as const;
const CRIMSON = 0xc01830;

export const SCREEN_W = 0.84;
export const SCREEN_H = SCREEN_W * (SCREEN_PX[1] / SCREEN_PX[0]);
export const SCREEN_Y = 1.74;
export const FACE_Z = 0.20;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<CascadeParts> {
  const { pal } = kit;
  const body = BODY_BY_VARIANT[o.variant] ?? BODY_BY_VARIANT[0];
  const trim = TRIM_BY_VARIANT[o.variant] ?? TRIM_BY_VARIANT[0];
  const root = kit.group('cascade');
  const at = (x: number, y: number, z: number): { pos: [number, number, number]; parent: THREE.Object3D } => ({ pos: [x, y, z], parent: root });

  // ── static shell (flat colours, merged by finalize) ──
  kit.box(0.96, 0.80, 0.70, body, at(0, 0.40, -0.05));                         // plinth
  kit.box(0.98, 0.04, 0.72, trim, at(0, 0.82, -0.05));                         // plinth cap
  kit.box(0.98, 0.04, 0.72, trim, at(0, 0.03, -0.05));                         // foot trim
  kit.box(1.00, 1.70, 0.64, body, at(0, 1.72, -0.12));                         // upper cabinet (y 0.87 .. 2.57)
  for (const sx of [-1, 1]) kit.box(0.03, 1.72, 0.02, trim, at(sx * 0.495, 1.72, FACE_Z + 0.01));   // front corner rails
  // slanted deck: buttons, lever and LEDs sit on it
  kit.box(0.98, 0.07, 0.34, body, { pos: [0, 0.89, 0.14], parent: root, rot: [-18, 0, 0] });
  kit.box(0.98, 0.012, 0.012, trim, at(0, 0.93, 0.31));
  // screen frame: a crimson rail inside a gold rail
  const fx = SCREEN_W / 2 + 0.03, fy = SCREEN_H / 2 + 0.03;
  kit.box(SCREEN_W + 0.10, 0.03, 0.03, trim, at(0, SCREEN_Y + fy + 0.015, FACE_Z + 0.012));
  kit.box(SCREEN_W + 0.10, 0.03, 0.03, trim, at(0, SCREEN_Y - fy - 0.015, FACE_Z + 0.012));
  for (const sx of [-1, 1]) kit.box(0.03, SCREEN_H + 0.06, 0.03, trim, at(sx * (fx + 0.015), SCREEN_Y, FACE_Z + 0.012));
  kit.box(SCREEN_W + 0.04, 0.012, 0.02, CRIMSON, at(0, SCREEN_Y + SCREEN_H / 2 + 0.014, FACE_Z + 0.008));
  kit.box(SCREEN_W + 0.04, 0.012, 0.02, CRIMSON, at(0, SCREEN_Y - SCREEN_H / 2 - 0.014, FACE_Z + 0.008));
  // coin tray (chrome lip) in front of the plinth
  kit.box(0.50, 0.04, 0.16, pal.chrome, at(0, 0.60, 0.36));
  kit.box(0.50, 0.03, 0.012, trim, at(0, 0.635, 0.44));
  // crown topper: a gold band with five points
  kit.box(0.60, 0.06, 0.12, trim, at(0, 2.62, -0.12));
  for (let i = -2; i <= 2; i++) kit.box(0.07, 0.10 + (i === 0 ? 0.05 : 0), 0.07, trim, at(i * 0.13, 2.70 + (i === 0 ? 0.025 : 0), -0.12));

  // ── the screen ──
  const main = kit.screen({ w: SCREEN_W, h: SCREEN_H, px: SCREEN_PX, bezel: pal.black });
  main.mesh.position.set(0, SCREEN_Y, FACE_Z + 0.006);
  root.add(main.mesh);

  // ── marquee, beacon, lamps ──
  const marquee = kit.marquee({ w: 0.86, h: 0.14, text: { key: 'm.cascade.name' }, color: pal.neonYellow, bg: pal.black, bulbs: 10 });
  marquee.root.position.set(0, 2.34, FACE_Z + 0.012);
  root.add(marquee.root);
  const beacon = new THREE.Object3D();
  beacon.position.set(0, 2.84, -0.12);
  root.add(beacon);
  kit.box(0.20, 0.014, 0.03, 0xff2a3a, { parent: beacon });
  const orbL = kit.lamp({ r: 0.04, color: 0x4a8aff, shape: 'dome' });
  const orbR = kit.lamp({ r: 0.04, color: 0xa848ff, shape: 'dome' });
  orbL.root.position.set(-0.40, 2.60, FACE_Z + 0.02);
  orbR.root.position.set(0.40, 2.60, FACE_Z + 0.02);
  root.add(orbL.root, orbR.root);
  const crown = kit.lamp({ r: 0.035, color: 0xffd040, shape: 'dome' });
  crown.root.position.set(0, 2.80, -0.06);
  root.add(crown.root);

  // ── side bulbs ──
  const strip = (x: number): BulbChain => {
    const path: V3[] = [[x, 0.96, FACE_Z + 0.012], [x, 2.44, FACE_Z + 0.012]];
    const chain = kit.bulbChain({ path, count: 14, colors: [pal.neonPink, pal.neonCyan, pal.neonYellow], r: 0.011 });
    root.add(chain.root);
    return chain;
  };
  const side: [BulbChain, BulbChain] = [strip(-0.455), strip(0.455)];

  // ── deck controls ──
  const deckZ = 0.20, deckY = 0.935;
  const mkBtn = (x: number, r: number, color: number, dz = 0): ButtonPart => {
    const b = kit.button({ shape: 'round', r, color });
    b.root.position.set(x, deckY, deckZ + dz);
    b.root.rotation.x = THREE.MathUtils.degToRad(-18);
    root.add(b.root);
    return b;
  };
  const spin = mkBtn(0, 0.055, pal.green, 0.02);
  const betDown = mkBtn(-0.20, 0.032, pal.neonCyan);
  const betUp = mkBtn(-0.11, 0.032, pal.neonCyan);
  const max = mkBtn(0.15, 0.034, pal.red);
  const turbo = mkBtn(0.26, 0.030, pal.neonYellow);
  const lever = kit.lever({ length: 0.26, knob: pal.red, side: 'right' });
  lever.root.position.set(0.53, 0.98, 0.10);
  root.add(lever.root);

  const credit = kit.ledPanel({ digits: 6, color: '#ff2030', h: 0.04 });
  credit.root.position.set(-0.30, 1.0, 0.27);
  const win = kit.ledPanel({ digits: 6, color: '#ffd040', h: 0.04 });
  win.root.position.set(0.30, 1.0, 0.27);
  root.add(credit.root, win.root);

  // ── anchors ──
  const speaker = new THREE.Object3D(); speaker.position.set(0, 2.1, FACE_Z + 0.02); root.add(speaker);
  const label = new THREE.Object3D(); label.position.set(0, 0.7, FACE_Z + 0.02); root.add(label);
  const servicePlate = new THREE.Object3D(); servicePlate.position.set(0.40, 0.55, 0.26); root.add(servicePlate);
  const stand = new THREE.Object3D(); stand.position.set(0, 0, 0.75); root.add(stand);
  const tray = new THREE.Object3D(); tray.position.set(0, 0.66, 0.36); root.add(tray);
  const light = new THREE.Object3D();
  light.position.set(0, 1.9, 0.55);
  light.userData = { color: 0xffe2b0, intensity: 1.0, range: 2.4, flicker: 'STEADY' };
  root.add(light);
  const fxTwist = new THREE.Object3D(); fxTwist.position.set(0, SCREEN_Y, FACE_Z + 0.03); root.add(fxTwist);

  const parts: CascadeParts = {
    screens: { main }, buttons: { spin, betDown, betUp, max, turbo }, lever, leds: { credit, win },
    lamps: { orbL, orbR, crown }, side, marquee, beacon, tray,
  };
  kit.finalize(root, {
    keep: [
      main.mesh, marquee.root, lever.root, spin.root, betDown.root, betUp.root, max.root, turbo.root,
      credit.root, win.root, ...side.map((c) => c.root), orbL.root, orbR.root, crown.root, beacon, light,
    ],
  });

  return {
    root,
    parts,
    // framing: the screen fills the band between the HUD banner and the control bar, 4:3 and 16:9
    playPose: { pos: new THREE.Vector3(0, SCREEN_Y + 0.02, 1.62), look: new THREE.Vector3(0, SCREEN_Y, FACE_Z), fov: 52, mouse: 'primary' },
    colliders: [{ min: [-0.50, 0, -0.47], max: [0.50, 2.9, 0.30] }],
    interact: { min: [-0.50, 0.3, -0.47], max: [0.50, 2.9, 0.40] },
    anchors: {
      speaker, prompt: marquee.root, label, marqueeTop: beacon, servicePlate, stand, coinOut: tray, light, fxTwist,
    },
    dispose: () => main.dispose(),
  };
}
