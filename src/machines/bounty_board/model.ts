/**
 * Bounty Board — procedural model (system category, slot M, MOUTH-BOUNTY). A cork board hung on the Mouth's north wall:
 * a title plank, two columns of paper slips (OFFERS on the left, the slips you SIGNED on the right), a note card for the
 * empty board, a brass ledge with a lamp and a red rubber stamp. The stamp drops on every paid contract. Footprint
 * 1.2 × 1.0 × 3.2 m (SLOT_DIMS.M). Origin = floor centre, +Z = the customer side. The board hangs on BOARD_BACK_Z (the wall
 * face), not on the slot's back edge: the slot sits half a metre inside the wall.
 *
 * Every slip, header and note is a `Card`: a plane with its own canvas (the machine paints it, see index.ts). The seat
 * camera frames the cork from 1.55 m, so the whole board and the text on it fit one 224-line frame.
 */
import * as THREE from 'three';
import type { LampPart } from '@/kit/types';
import type { KitX } from '@/kit';
import type { MachineModel } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { crispTexture } from '@/core/ui/textOverlay';
import { BOARD_BACK_Z, BOARD_SLOTS, MAX_ACTIVE, SLIP_H, SLIP_W, TEXEL } from './rules';

/** A paper (or plank) with a canvas of its own. `g` paints the face in texels; set `tex.needsUpdate` after painting. */
export interface Card { root: THREE.Object3D; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number }

export type BountyBoardParts = {
  /** Pinned offers, left column, rows 1-3. Hidden when the row is empty. */
  offers: Card[];
  /** Signed slips, right column, rows 4-6. Hidden when the row is empty. A signed slip flutters on sign. */
  signed: Card[];
  /** Tall note card over the offers column: why the board is empty. */
  note: Card;
  /** Plank title, OFFERS header, SIGNED header. */
  heads: [Card, Card, Card];
  /** Rubber stamp on the ledge; slams down on a paid contract. */
  stamp: THREE.Object3D;
  lamp: LampPart;
};

export const W = 1.2, H = 3.2;
export const STAMP_LIFT = 0.12;

const COL_X = 0.245;                 // column centres (±), slips 0.47 wide leave a 0.02 gap in the middle
const GAP = 0.025;
const SLIP_TOP = 2.245;
const LEDGE_Y = 1.1;
const CORK_Y0 = 1.27, CORK_Y1 = 2.37;

export function buildModel(kit: KitX, o: ModelOpts): MachineModel<BountyBoardParts> {
  const { pal } = kit;
  const root = kit.group('bounty_board');
  const at = (x: number, y: number, z: number, extra: { seg?: number } = {}): { pos: [number, number, number]; parent: THREE.Object3D; seg?: number } => ({ pos: [x, y, z], parent: root, ...extra });
  const frame = o.variant % 2 ? pal.woodDark : pal.wood;
  const cork = 0x8a6440;
  const front = BOARD_BACK_Z + 0.04;                                   // cork centre; its back face (0.015) clears the wainscot (0.01)
  const corkH = CORK_Y1 - CORK_Y0, corkY = (CORK_Y0 + CORK_Y1) / 2;

  // ── board and frame (static) ──
  kit.box(W, CORK_Y0 - 0.06, 0.06, frame, at(0, (CORK_Y0 - 0.06) / 2, front - 0.02));                 // lower panel (face 0.04: proud of the wainscot)
  kit.box(W - 0.1, corkH, 0.03, cork, at(0, corkY, front));                                         // cork sheet
  for (const sx of [-1, 1]) kit.box(0.06, corkH + 0.12, 0.08, frame, at(sx * (W / 2 - 0.05), corkY, front)); // frame sides (meet the rails, no corner gap)
  kit.box(W, 0.06, 0.1, frame, at(0, CORK_Y1 + 0.03, front));                                       // frame top
  kit.box(W, 0.06, 0.1, frame, at(0, CORK_Y0 - 0.03, front));                                       // frame bottom
  kit.box(0.9, 0.13, 0.05, frame, at(0, CORK_Y1 + 0.13, front));                                    // title plank
  kit.box(W, 0.05, 0.12, pal.brass, at(0, LEDGE_Y, front + 0.04));                                  // brass ledge

  // ── cards (canvas planes; painted by the machine) ──
  const card = (w: number, h: number, x: number, y: number, z: number): Card => {
    const pw = Math.round(w * TEXEL), ph = Math.round(h * TEXEL);
    const tex = kit.tex.canvas(pw, ph, () => undefined, { wrap: 'clamp' });
    crispTexture(tex, 4);                                              // linear + mips: px5 stays readable minified (as the sic bo / roulette sheets)
    const node = new THREE.Object3D();
    node.position.set(x, y, z);
    kit.plane(w, h, kit.mat({ map: tex, lit: false, snap: false, affine: false, unique: true }), { shade: false, parent: node });
    root.add(node);
    return { root: node, g: (tex.image as HTMLCanvasElement).getContext('2d')!, tex, w: pw, h: ph };
  };
  const zCard = front + 0.03;
  const rowY = (i: number): number => SLIP_TOP - SLIP_H / 2 - i * (SLIP_H + GAP);
  const offers = Array.from({ length: BOARD_SLOTS }, (_, i) => card(SLIP_W, SLIP_H, -COL_X, rowY(i), zCard));
  const signed = Array.from({ length: MAX_ACTIVE }, (_, i) => card(SLIP_W, SLIP_H, COL_X, rowY(i), zCard));
  const stackH = BOARD_SLOTS * SLIP_H + (BOARD_SLOTS - 1) * GAP;
  const note = card(SLIP_W, stackH, -COL_X, SLIP_TOP - stackH / 2, zCard);
  const headY = SLIP_TOP + 0.035 + 0.025;
  const heads: BountyBoardParts['heads'] = [
    card(0.82, 0.1, 0, CORK_Y1 + 0.13, front + 0.03),
    card(SLIP_W, 0.07, -COL_X, headY, zCard),
    card(SLIP_W, 0.07, COL_X, headY, zCard),
  ];

  // ── stamp on the ledge (animated) ──
  const stamp = new THREE.Object3D();
  stamp.position.set(0.5, LEDGE_Y + 0.045, front + 0.12);
  kit.cyl(0.02, 0.02, 0.22, pal.black, { pos: [0, 0.11, 0], parent: stamp, seg: 8 });       // handle
  kit.box(0.1, 0.03, 0.08, 0xc02828, { pos: [0, 0, 0], parent: stamp });                    // red face
  root.add(stamp);

  // ── lamp on the ledge ──
  // x -0.5: its glow sprite must stay inside the 1.2 m footprint
  kit.cyl(0.05, 0.06, 0.08, pal.brass, at(-0.5, LEDGE_Y + 0.065, front + 0.2, { seg: 10 }));
  const lamp = kit.lamp({ r: 0.05, color: 0xff8a50, shape: 'dome' });
  lamp.root.position.set(-0.5, LEDGE_Y + 0.23, front + 0.2);
  root.add(lamp.root);

  // ── anchors ──
  const prompt = new THREE.Object3D(); prompt.position.set(0, 1.9, front + 0.5); root.add(prompt);
  const coinOut = new THREE.Object3D(); coinOut.position.set(0.45, LEDGE_Y + 0.2, front + 0.35); root.add(coinOut);
  const light = new THREE.Object3D();
  light.position.set(0, 1.9, front + 0.6);
  light.userData = { color: 0xff8a50, intensity: 0.6, range: 2.4, flicker: 'STEADY' };
  root.add(light);

  const parts: BountyBoardParts = { offers, signed, note, heads, stamp, lamp };
  kit.finalize(root, { keep: [...offers.map((c) => c.root), ...signed.map((c) => c.root), note.root, ...heads.map((c) => c.root), stamp, lamp.root, light] });

  return {
    root,
    parts,
    // the cork and the plank in one frame (1.0 – 2.65 m at the board, about 1.6 m tall); 1.55 m back, a hair above the middle
    playPose: { pos: new THREE.Vector3(0, 1.78, zCard + 1.55), look: new THREE.Vector3(0, 1.83, zCard), fov: 55, mouse: 'primary' },
    colliders: [
      { min: [-W / 2, 0, BOARD_BACK_Z - 0.04], max: [W / 2, H, front + 0.05] },
    ],
    interact: { min: [-W / 2, 0.3, BOARD_BACK_Z], max: [W / 2, H, front + 0.6] },
    anchors: { speaker: prompt, prompt, light, coinOut },
  };
}
