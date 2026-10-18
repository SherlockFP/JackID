/**
 * Hanging signposts over the pit aisles (Wave 27, WORLD-ARCH): a double-sided board per `SIGNPOSTS` entry in layout.ts,
 * a lit text plate with a brass arrow (left / right / up / down as the READER sees it), hung from two chains. They point
 * from the spawn to the vendors, the terminal, the phone and the lift so a new player is never lost.
 *
 * `level.ts` adds `buildSignposts(kit, { ceilingAt }).root` to its root once (WIRING in the task report).
 * Face 'S' has its normal on +Z (read by someone walking north); face 'N' on -Z (read walking south).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { WorldProp } from '../types';
import { SIGNPOSTS, type SignSide, type Signpost } from '../layout';
import { crispLabel } from './signs';

const BOARD_H = 0.52;
const GOLD = 0xffd34a;

/** Right-pointing arrow outline (x 0..0.42, y ±0.17), the other directions rotate it. */
const ARROW: Array<[number, number]> = [[0, -0.065], [0.2, -0.065], [0.2, -0.17], [0.42, 0], [0.2, 0.17], [0.2, 0.065], [0, 0.065]];
const ARROW_ROT_Z: Record<SignSide['arrow'], number> = { right: 0, up: 90, left: 180, down: 270 };

export interface SignpostsProp extends WorldProp {
  /** Number of boards built (tests, bench). */
  readonly count: number;
}

function buildFace(kit: KitX, sp: Signpost, side: SignSide): THREE.Group {
  const g = kit.group(`${sp.id}.${side.face}`);
  g.rotation.y = side.face === 'S' ? 0 : Math.PI;
  g.position.z = side.face === 'S' ? 0.035 : -0.035;
  const textW = sp.w - 0.62;
  // the arrow sits at the end it points to; vertical arrows sit at the left end
  const arrowAtRight = side.arrow === 'right';
  const textX = arrowAtRight ? -0.3 : 0.3;
  const label = crispLabel(kit, { text: { key: `prop.${side.key}` }, w: textW, h: BOARD_H - 0.12, bg: 0x1a120c, color: GOLD, frame: 0x8c6b29 });
  label.mesh.position.set(textX, 0, 0.012);
  g.add(label.mesh);
  const arrow = kit.extrude(ARROW, 0.02, GOLD, { bevel: 0 });
  // centre the outline on its own origin, then rotate it
  const holder = kit.group('arrow');
  arrow.position.set(-0.21, 0, 0);
  holder.add(arrow);
  holder.rotation.z = (ARROW_ROT_Z[side.arrow] * Math.PI) / 180;
  const ax = side.arrow === 'right' ? sp.w / 2 - 0.32 : side.arrow === 'left' ? -sp.w / 2 + 0.32 : -sp.w / 2 + 0.32;
  holder.position.set(ax, 0, 0.014);
  g.add(holder);
  return g;
}

/**
 * Builds every signpost. `ceilingAt(x, z)` is the ceiling height over the board (the chains reach it); without it the chains
 * are 0.9 m long. Everything is static: no `update`.
 */
export function buildSignposts(kit: KitX, o: { ceilingAt?: (x: number, z: number) => number; posts?: readonly Signpost[] } = {}): SignpostsProp {
  const root = kit.group('signposts');
  const posts = o.posts ?? SIGNPOSTS;
  for (const sp of posts) {
    const g = kit.group(sp.id);
    g.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    kit.box(sp.w, BOARD_H, 0.07, kit.pal.woodDark, { parent: g, bevel: 0.015 });
    kit.box(sp.w + 0.04, 0.03, 0.08, kit.pal.brass, { pos: [0, BOARD_H / 2, 0], parent: g });
    kit.box(sp.w + 0.04, 0.03, 0.08, kit.pal.brass, { pos: [0, -BOARD_H / 2, 0], parent: g });
    const up = Math.max(0.6, (o.ceilingAt?.(sp.pos[0], sp.pos[2]) ?? sp.pos[1] + 0.9) - sp.pos[1] - BOARD_H / 2);
    for (const sx of [-1, 1]) kit.cyl(0.012, 0.012, up, kit.pal.chrome, { pos: [sx * (sp.w / 2 - 0.12), BOARD_H / 2 + up / 2, 0], parent: g, seg: 4 });
    for (const side of sp.sides) g.add(buildFace(kit, sp, side));
    root.add(g);
  }
  return {
    id: 'signposts',
    root,
    count: posts.length,
    dispose() {
      root.removeFromParent();
      root.traverse((c) => { const m = c as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}
