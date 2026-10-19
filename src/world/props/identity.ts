/**
 * The building's identity (docs/ART.md "Identity"): a Northern Cyprus casino of the 90s set in the bones of a late-Soviet building.
 *
 *   - the casino's own signs, Turkish big and English small: KASİNO over the way into the Well (YİNE BEKLERİZ on its back), HOŞ GELDİNİZ
 *     over the lift exit, the DÖVİZ board with its rates beside the cashier, a nazar boncuğu hung by the window
 *   - what the old building left: the Lobby mosaic (a worker raising a die) and the precast concrete panels of the Boiler
 *   - the small Turkish things other builders put on their counters and tables: `cayGlass`, `tavla`, `semaver`, `nazar`
 *
 * Static kit primitives under `parent` (the level's `statical`, merged by kit.finalize); the sign plates keep their own material (they
 * repaint on a language change), so they are never merged. No timers, no rng.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import { presets } from '@/kit/presets';
import { crispBilingual } from './signs';
import { concretePanelTex, mosaicTex, rateBoardTex } from './surfaces';

type V3 = [number, number, number];

/**
 * Splits the wall run [a0, a1] around the `gaps` into panels no wider than `w`, each span cut into equal panels.
 * Returns [start, end] per panel; spans shorter than 0.5 m are dropped.
 */
export function panelSpans(a0: number, a1: number, gaps: ReadonlyArray<readonly [number, number]>, w: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = a0;
  const cuts = [...gaps].filter(([g0, g1]) => g1 > a0 && g0 < a1).sort((p, q) => p[0] - q[0]);
  for (const [g0, g1] of [...cuts, [a1, a1] as const]) {
    const e = Math.min(g0, a1);
    if (e - s >= 0.5) {
      const n = Math.ceil((e - s) / w - 1e-9), pw = (e - s) / n;
      for (let i = 0; i < n; i++) out.push([s + i * pw, s + (i + 1) * pw]);
    }
    s = Math.max(s, g1);
  }
  return out;
}

/** A tulip çay glass of tea on its saucer, standing on a surface at (x, y, z). */
export function cayGlass(kit: KitX, parent: THREE.Object3D, x: number, y: number, z: number): void {
  const P = presets(kit.tex);
  kit.cyl(0.048, 0.04, 0.008, P.porcelain(), { pos: [x, y + 0.004, z], parent, seg: 10, shade: false });
  kit.cyl(0.049, 0.049, 0.002, kit.mat({ color: 0xc8a048, lit: false }), { pos: [x, y + 0.0085, z], parent, seg: 10, shade: false });   // the gold line
  kit.lathe([[0, 0], [0.019, 0], [0.02, 0.006], [0.014, 0.032], [0.013, 0.048], [0.018, 0.074], [0.0215, 0.094]], 8, kit.mat({ color: 0x9a2c0c, lit: false }), {
    pos: [x, y + 0.009, z], parent, shade: false,
  });
  kit.cyl(0.022, 0.0215, 0.008, kit.mat({ color: 0xd8e4e0, lit: false }), { pos: [x, y + 0.107, z], parent, seg: 8, open: true, shade: false });   // the clear rim above the tea
  kit.box(0.07, 0.003, 0.006, P.chrome(), { pos: [x + 0.03, y + 0.011, z + 0.03], rot: [0, -40, 0], parent, shade: false });   // the spoon on the saucer
}

/** An open tavla board on a table top at (x, y, z), turned `yaw` degrees: walnut case, painted points, a few checkers and two dice. */
export function tavla(kit: KitX, parent: THREE.Object3D, x: number, y: number, z: number, yaw = 0): void {
  const P = presets(kit.tex);
  const g = kit.group('tavla');
  g.position.set(x, y, z);
  g.rotation.y = (yaw * Math.PI) / 180;
  parent.add(g);
  kit.box(0.44, 0.024, 0.3, P.wood('dark'), { pos: [0, 0.012, 0], parent: g });
  const field = kit.tex.canvas(32, 24, (c, w, h) => {
    c.fillStyle = '#d8c49a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a2414'; c.fillRect(15, 0, 2, h);
    for (let i = 0; i < 12; i++) {
      const x0 = (i < 6 ? 1 : 3) + i * 2.4;
      c.fillStyle = i % 2 ? '#1a1410' : '#8a1c18';
      for (let r = 0; r < 9; r++) { c.fillRect(Math.round(x0 + r * 0.1), r, Math.max(1, Math.round(2 - r * 0.2)), 1); c.fillRect(Math.round(x0 + r * 0.1), h - 1 - r, Math.max(1, Math.round(2 - r * 0.2)), 1); }
    }
  }, { key: 'env:tavla', wrap: 'clamp' });
  kit.plane(0.4, 0.26, kit.mat({ map: field, color: 0xffffff, lit: false }), { pos: [0, 0.0245, 0], rot: [-90, 0, 0], parent: g, shade: false });
  const ivory = kit.mat({ color: 0xece0c4, lit: false }), ebony = kit.mat({ color: 0x241810, lit: false });
  for (const [cx, cz, k] of [[-0.17, -0.1, 0], [-0.17, -0.078, 0], [-0.14, 0.1, 1], [0.05, -0.1, 1], [0.05, -0.078, 1], [0.12, 0.1, 0], [0.17, 0.1, 0], [0.17, 0.078, 0]] as const) {
    kit.cyl(0.011, 0.011, 0.005, k ? ebony : ivory, { pos: [cx, 0.027, cz], parent: g, seg: 8, shade: false });
  }
  for (const [dx, dr] of [[-0.06, 15], [-0.035, -20]] as const) kit.box(0.012, 0.012, 0.012, ivory, { pos: [dx, 0.031, 0.01], rot: [0, dr, 0], parent: g, shade: false });
}

/** A two-tier semaver on a counter at (x, y, z): the brushed urn with its tap, the demlik on its crown. About 0.55 m tall. */
export function semaver(kit: KitX, parent: THREE.Object3D, x: number, y: number, z: number, yaw = 0): void {
  const P = presets(kit.tex);
  const g = kit.group('semaver');
  g.position.set(x, y, z);
  g.rotation.y = (yaw * Math.PI) / 180;
  parent.add(g);
  const steel = P.chrome(), brass = P.brass(), black = kit.mat({ color: 0x1a1612, lit: false });
  kit.lathe([[0, 0], [0.09, 0], [0.09, 0.03], [0.06, 0.05], [0.11, 0.08], [0.125, 0.16], [0.12, 0.27], [0.08, 0.31], [0.05, 0.33], [0, 0.33]], 10, steel, { parent: g });
  kit.cyl(0.127, 0.127, 0.015, brass, { pos: [0, 0.16, 0], parent: g, seg: 10 });
  for (const s of [-1, 1]) kit.torus(0.035, 0.006, black, { pos: [s * 0.14, 0.24, 0], parent: g, seg: 8, tubeSeg: 4 });
  kit.box(0.025, 0.025, 0.06, brass, { pos: [0, 0.1, 0.13], parent: g });                                          // the tap
  kit.box(0.02, 0.03, 0.02, black, { pos: [0, 0.13, 0.15], parent: g });
  // the demlik: a small pot on the crown, a spout, a lid knob
  kit.lathe([[0, 0], [0.045, 0], [0.062, 0.04], [0.055, 0.08], [0.03, 0.095], [0, 0.1]], 8, P.porcelain(), { pos: [0, 0.33, 0], parent: g });
  kit.cyl(0.008, 0.012, 0.07, P.porcelain(), { pos: [0.075, 0.385, 0], rot: [0, 0, -55], parent: g, seg: 5 });
  kit.sphere(0.012, brass, { pos: [0, 0.437, 0], parent: g, wSeg: 5, hSeg: 3 });
  kit.torus(0.03, 0.005, P.porcelain(), { pos: [-0.065, 0.38, 0], parent: g, seg: 8, tubeSeg: 4 });
}

/**
 * A nazar boncuğu hung from a nail on a wall: the glass eye (dark blue, white, pale blue, black, each disc 2 mm proud of the one behind)
 * on a red cord. `rotY` turns its face (0 faces +z).
 */
export function nazar(kit: KitX, parent: THREE.Object3D, pos: V3, rotY: number, r = 0.07): void {
  const g = kit.group('nazar');
  g.position.set(...pos);
  g.rotation.y = rotY;
  parent.add(g);
  const disc = (rr: number, c: number, z: number): void => { kit.cyl(rr, rr, 0.004, kit.mat({ color: c, lit: false }), { pos: [0, 0, z], rot: [90, 0, 0], parent: g, seg: 12, shade: false }); };
  disc(r, 0x0c2a8a, 0.01); disc(r * 0.68, 0xf4f2ea, 0.012); disc(r * 0.46, 0x4aa8e0, 0.014); disc(r * 0.22, 0x0a0a10, 0.016);
  kit.box(0.004, 0.16, 0.004, kit.mat({ color: 0xb01c1c, lit: false }), { pos: [0, r + 0.08, 0.01], parent: g, shade: false });
  kit.sphere(0.008, kit.mat({ color: 0x8a8070, lit: false }), { pos: [0, r + 0.16, 0.008], parent: g, wSeg: 4, hSeg: 3, shade: false });
}

/** Lobby wall heights the mosaic must clear: it hangs over the concession desk, under the cornice. */
export const MOSAIC = { x: 0, y: 3.45, z: 19.835, w: 2.8, h: 1.4 } as const;
/** The Boiler's precast panels: a 3 m storey over the wainscot, set 1 cm off the wall. */
const PANEL = { y0: 1.25, y1: 3.48, w: 1.5, t: 0.03 } as const;

export function buildIdentity(kit: KitX, o: { parent: THREE.Object3D }): void {
  const P = presets(kit.tex);
  const { parent } = o;
  const walnut = P.wood('walnut'), brass = P.brass();
  const box = (w: number, h: number, d: number, m: THREE.Material, p: V3): THREE.Mesh => kit.box(w, h, d, m, { pos: p, parent });
  const sign = (text: string, sub: string, w: number, h: number, p: V3, rotY: number, color: number, bg: number, frame: number | null): void => {
    const s = crispBilingual(kit, { text: { key: text }, sub: { key: sub }, w, h, color, subColor: 0xe8dcc0, bg, frame, ppm: 160 });
    s.mesh.position.set(...p);
    s.mesh.rotation.y = rotY;
    parent.add(s.mesh);
  };
  const GOLD = 0xffd060, OXBLOOD = 0x3a0c10, FRAME = 0xc8a050;

  // ── KASİNO over the way from the Mouth into the Well (read walking south from the lift), YİNE BEKLERİZ on its back ──
  {
    const z = -18.25, y = 5.35, w = 4.4, h = 1.0;
    box(w + 0.16, h + 0.16, 0.08, walnut, [0, y, z]);
    box(w + 0.22, 0.04, 0.1, brass, [0, y + h / 2 + 0.08, z]);
    box(w + 0.22, 0.04, 0.1, brass, [0, y - h / 2 - 0.08, z]);
    sign('prop.id.casino', 'prop.id.casinoSub', w, h, [0, y, z - 0.045], Math.PI, GOLD, OXBLOOD, FRAME);
    sign('prop.id.again', 'prop.id.againSub', w * 0.8, h * 0.7, [0, y, z + 0.045], 0, GOLD, OXBLOOD, FRAME);
    for (const sx of [-1.8, 1.8]) box(0.02, 6.0 - (y + h / 2 + 0.1), 0.02, brass, [sx, (6.0 + y + h / 2 + 0.1) / 2, z]);
  }

  // ── HOŞ GELDİNİZ over the lift exit, facing the doors ──
  {
    const x = -4, z = -26.4, y = 3.3;
    box(1.82, 0.62, 0.05, walnut, [x, y, z]);
    sign('prop.id.welcome', 'prop.id.welcomeSub', 1.7, 0.5, [x, y, z - 0.03], Math.PI, GOLD, OXBLOOD, FRAME);
    for (const sx of [-0.7, 0.7]) box(0.015, 6.0 - y - 0.31, 0.015, brass, [x + sx, (6.0 + y + 0.31) / 2, z]);
  }

  // ── the cashier: the DÖVİZ board on the south wall east of the window, the nazar by the window ──
  {
    const x = 8.4, z = 19.85;
    box(1.12, 0.9, 0.04, walnut, [x, 2.3, z - 0.025]);                                       // 5 mm off the wall, above the prize case's glass
    box(1.16, 0.03, 0.05, brass, [x, 2.765, z - 0.03]);
    kit.plane(1.0, 0.5, { map: rateBoardTex(kit.tex), color: 0xffffff, lit: false }, { pos: [x, 2.16, z - 0.051], rot: [0, 180, 0], parent, shade: false });
    sign('prop.id.rates', 'prop.id.ratesSub', 1.0, 0.26, [x, 2.585, z - 0.051], Math.PI, GOLD, 0x120a08, null);
    nazar(kit, parent, [7.12, 2.25, z - 0.012], Math.PI, 0.1);
  }

  // ── the Lobby mosaic over the concession desk: smalt in a brass frame ──
  {
    const { x, y, z, w, h } = MOSAIC;
    box(w + 0.12, h + 0.12, 0.03, brass, [x, y, z - 0.02]);
    kit.plane(w, h, { map: mosaicTex(kit.tex), color: 0xffffff, lit: false }, { pos: [x, y, z - 0.042], rot: [0, 180, 0], parent, shade: false });
  }

  // ── the Boiler: precast concrete panels over the wainscot, around the DICE neon and the doorway with its posters ──
  {
    const conc = kit.mat({ map: concretePanelTex(kit.tex), color: 0xd8d4cc });
    const ph = PANEL.y1 - PANEL.y0, py = (PANEL.y0 + PANEL.y1) / 2, off = 0.01 + PANEL.t / 2;
    const wall = (axis: 'x' | 'z', c: number, n: 1 | -1, a0: number, a1: number, gaps: Array<[number, number]>): void => {
      for (const [s0, s1] of panelSpans(a0, a1, gaps, PANEL.w)) {
        const w = s1 - s0 - 0.02, m = (s0 + s1) / 2;   // a 2 cm joint between panels
        if (axis === 'z') box(w, ph, PANEL.t, conc, [m, py, c + n * off]);
        else box(PANEL.t, ph, w, conc, [c + n * off, py, m]);
      }
    };
    wall('z', -29.85, 1, 11.15, 30.85, [[20.4, 23.6]]);          // north: the DICE neon at x 22
    wall('z', -16.15, -1, 11.15, 30.85, []);                     // south
    wall('x', 30.85, -1, -29.85, -16.15, []);                    // east
    wall('x', 11.15, 1, -29.85, -16.15, [[-26.7, -19.3]]);       // west: the doorway, its architrave and its two posters
  }
}
