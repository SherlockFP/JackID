/**
 * Video Poker — procedural model (MACHINES §4 / PLAN A.3). Pattern: `coinflip/model.ts`.
 *  - `buildModel(kit, o)` returns a full `MachineModel` and nothing else touches the scene;
 *  - the exported `VideoPokerParts` type is the contract with the coder (`index.ts`);
 *  - metres, origin = floor centre, +Z = front (the player side), Y up;
 *  - no physical cards: every card is drawn on the CRT canvas by `index.ts`.
 *
 * Slant-top cabinet 0.62 W × 0.62 D × 1.40 H (plus a 0.68 m bar stool at z 0.34, inside the M slot depth).
 * CRT 0.48 × 0.36 tilted back 25° (`cabinet` screen anchor), marquee on top, a button deck under the glass:
 * five HOLD buttons (1–5), DEAL/DRAW, BET ONE, BET MAX, DOUBLE, COLLECT and GAME. Colourways 0–3.
 *
 * BUDGET (PLAN §4.2, M slot): ≤ 900 tris, ≤ 14 draws. The static shell merges into one draw; the CRT, marquee and
 * the button deck (one caps mesh for all eleven buttons) stay separate because they animate.
 */
import * as THREE from 'three';
import type { ScreenSurface, MarqueePart, PanelButton } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';

export type VpButton = 'hold0' | 'hold1' | 'hold2' | 'hold3' | 'hold4' | 'deal' | 'betOne' | 'betMax' | 'double' | 'collect' | 'game';

/** Contract between modeler and coder. */
export type VideoPokerParts = {
  /** 160 × 120 px CRT: paytable, five cards, HELD tags, status line. */
  screen: ScreenSurface;
  marquee: MarqueePart;
  /** Deck buttons: `hold0..4` (lit while held), `deal`, `betOne`, `betMax`, `double`, `collect`, `game`. */
  buttons: Record<VpButton, PanelButton>;
  /** Root of the button deck (keeps the plate, caps and lamps together). */
  deck: THREE.Object3D;
  stool: THREE.Object3D;
};

const COLORWAYS: ReadonlyArray<{ body: 'blue' | 'black' | 'cream' | 'red'; trim: 'chrome' | 'gold' | 'brass' }> = [
  { body: 'blue', trim: 'chrome' },
  { body: 'black', trim: 'gold' },
  { body: 'cream', trim: 'brass' },
  { body: 'red', trim: 'chrome' },
];

export const CRT_TILT_DEG = 49;   // the face of the slant cabinet (kit/cabinet.ts)

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<VideoPokerParts> {
  const { pal } = kit;
  const cw = COLORWAYS[o.variant] ?? COLORWAYS[0];
  const root = kit.group('videopoker');

  // ── cabinet: slant top, CRT in the sloped face, control deck under the glass ──
  const cab = kit.cabinet({
    style: 'slant', w: 0.62, h: 1.4, d: 0.62,
    body: pal[cw.body], trim: pal[cw.trim], accent: pal.neonCyan,
    // seat-views: no tilt override, so the glass lies in the slanted face (49 deg). The old 25 deg tilt sank its lower half into the
    // body, so only the paytable and the tops of the cards were ever visible.
    screen: { w: 0.48, h: 0.36, y: 1.06 },
    topper: { h: 0.2 },
    panel: { y: 0.86, depth: 0.12, tilt: 12 },   // lip 0.12: the deck stays inside the stand-strip limit (z 0.5)
    kick: 0.08,
  });
  root.add(cab.root);

  const screen = kit.screen({ w: 0.46, h: 0.34, px: [160, 120], bezel: pal.black, scanlines: false });
  crispTexture(screen.tex, 4);                      // linear + mips: the 160 x 120 face stays sharp when it fills the frame
  (cab.anchors.screen ?? cab.root).add(screen.mesh);

  // ── button deck (one caps mesh for all eleven buttons) ──
  const deck = kit.buttonPanel({
    w: 0.56, d: 0.2, slope: 12, plate: pal.black, capH: 0.02,
    buttons: [
      { id: 'hold0', color: pal.bone, x: -0.23, z: 0.05, w: 0.06, h: 0.04 },
      { id: 'hold1', color: pal.bone, x: -0.165, z: 0.05, w: 0.06, h: 0.04 },
      { id: 'hold2', color: pal.bone, x: -0.1, z: 0.05, w: 0.06, h: 0.04 },
      { id: 'hold3', color: pal.bone, x: -0.035, z: 0.05, w: 0.06, h: 0.04 },
      { id: 'hold4', color: pal.bone, x: 0.03, z: 0.05, w: 0.06, h: 0.04 },
      { id: 'deal', color: pal.red, x: 0.17, z: 0.05, w: 0.08, h: 0.05 },
      { id: 'betOne', color: pal.chrome, x: -0.2, z: -0.07, w: 0.06, h: 0.04 },
      { id: 'betMax', color: pal.chrome, x: -0.12, z: -0.07, w: 0.06, h: 0.04 },
      { id: 'game', color: pal.neonCyan, x: -0.04, z: -0.07, w: 0.06, h: 0.04 },
      { id: 'double', color: pal.neonYellow, x: 0.05, z: -0.07, w: 0.06, h: 0.04 },
      { id: 'collect', color: pal.green, x: 0.13, z: -0.07, w: 0.06, h: 0.04 },
    ],
  });
  (cab.anchors.panel ?? root).add(deck.root);

  // ── marquee on the top box ──
  const marquee = kit.marquee({ w: 0.56, h: 0.13, text: { key: 'm.videopoker.marquee' }, color: pal.neonCyan, bg: pal.black, bulbs: 14 });
  marquee.root.position.set(0, 1.5, 0.035);   // seat-views: on the front of the top box (it used to float at y 1.3 / z 0.36, right in front of the glass)
  root.add(marquee.root);

  // ── bar stool at z +0.40 ──
  const stool = kit.stool({ h: 0.68, seat: pal.leather, leg: pal.chrome });
  stool.position.set(0, 0, 0.33);
  stool.scale.set(0.72, 1, 0.72); // base spokes stay inside the M slot depth
  root.add(stool);

  // pooled-light hint for the CRT glow (no THREE.Light inside machines)
  const light = new THREE.Object3D();
  light.position.set(0, 1.1, 0.5);
  light.userData = { color: 0x9fe8ff, intensity: 0.4, range: 1.5, flicker: 'STEADY' };
  root.add(light);

  // anchors (no meshes): service plate on the side, the strip in front, FX spots on the glass
  const mk = (x: number, y: number, z: number): THREE.Object3D => {
    const a = new THREE.Object3D();
    a.position.set(x, y, z);
    root.add(a);
    return a;
  };
  const speaker = cab.anchors.speaker;
  const servicePlate = mk(0.315, 0.6, 0.0);
  const stand = mk(0, 0, 0.6);
  const label = mk(0, 0.86, 0.37);
  const marqueeTop = mk(0, 1.42, 0.0);
  const fxTwist = mk(0, 1.02, 0.37);
  const coinOut = mk(0.2, 0.9, 0.3);

  kit.finalize(root, { keep: [screen.mesh, marquee.root, deck.root, light] });

  return {
    root,
    parts: {
      screen, marquee, deck: deck.root, stool,
      buttons: deck.buttons as Record<VpButton, PanelButton>,
    },
    playPose: { pos: new THREE.Vector3(0, 1.45, 0.68), look: new THREE.Vector3(0, 1.06, 0.2), fov: 50, mouse: 'primary' },
    colliders: cab.colliders,
    interact: { min: [-0.31, 0, -0.35], max: [0.31, 1.42, 0.45] },
    anchors: {
      speaker, prompt: marquee.root, label, marqueeTop, servicePlate, stand, light, fxTwist, coinOut,
    },
    dispose: () => screen.dispose(),
  };
}
