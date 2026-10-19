/**
 * The casino bar in the Lobby (wave 87, docs/ART.md §2 "Bar"): a walnut counter with raised panels, a veined marble top, a brass
 * nosing and foot rail, three leather stools; behind it a back bar with a marble shelf cabinet, a smoked mirror, two lit glass shelves
 * of bottles, side columns, a crown with a BAR neon, and the life left on the counters (glasses, an ashtray, chip stacks, taps).
 * It replaced the vendored medieval tavern pieces, which read as flat brown slabs at the 360p render.
 *
 * Every part is a static kit primitive under `parent` (the level's `statical`, merged by kit.finalize). The colliders stay in
 * level.ts. Customers stand on the north side (-z); the back bar is at +z. No timers, no rng: the bottle rows come from a fixed table.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import { presets } from '@/kit/presets';
import { crispNeon } from './signs';
import { marbleTex, mirrorTex, worldUV } from './surfaces';

/** Bottle glass colours (unlit: the back bar's glow is what lights them). */
const GLASS = [0x8a4a14, 0x2a6a2a, 0x9ab8c0, 0x7a1420, 0xb08a3a, 0x4a2a14, 0x3a5a6a, 0xc8a050];

export function buildBar(kit: KitX, o: { parent: THREE.Object3D; root: THREE.Object3D; x: number; z: number }): void {
  const P = presets(kit.tex);
  const { parent, x, z } = o;
  const walnut = P.wood('walnut'), dark = P.wood('dark'), mahog = P.wood('mahogany'), brass = P.brass(), leather = P.leather(0x5a1418, false);
  const marble = kit.mat({ color: 0xffffff, map: marbleTex(kit.tex, 0x1e2c24, 0xb8c8a8) });
  const glow = kit.mat({ color: 0xffc070, lit: false });
  const ash = kit.mat({ color: 0x2a2a30, lit: false });
  const box = (w: number, h: number, d: number, m: THREE.Material, px: number, py: number, pz: number): THREE.Mesh =>
    kit.box(w, h, d, m, { pos: [x + px, py, z + pz], parent });
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, px: number, py: number, pz: number, seg = 6): void => {
    kit.cyl(rt, rb, h, m, { pos: [x + px, py, z + pz], parent, seg, shade: false });
  };

  // ── the counter (x ±2.2, z ±0.5, top at 1.06) ────────────────────────────────────────────────
  box(4.3, 0.12, 0.86, dark, 0, 0.06, 0.02);                          // kick plinth, set back
  box(4.4, 0.88, 0.95, walnut, 0, 0.56, 0);                           // body
  for (let i = 0; i < 4; i++) {                                       // four raised panels on the customers' face
    const px = -1.65 + i * 1.1;
    box(0.92, 0.52, 0.03, mahog, px, 0.6, -0.49);
    box(0.98, 0.04, 0.035, dark, px, 0.88, -0.49);
    box(0.98, 0.04, 0.035, dark, px, 0.32, -0.49);
  }
  for (let i = 0; i <= 4; i++) box(0.07, 0.86, 0.06, dark, -2.2 + i * 1.1, 0.55, -0.48);   // pilaster strips between them
  const top = box(4.6, 0.06, 1.1, marble, 0, 1.03, 0);
  worldUV(top, 2);
  box(4.62, 0.03, 0.03, brass, 0, 1.0, -0.56);                         // nosing
  box(4.5, 0.07, 0.12, leather, 0, 1.095, -0.49);                      // padded arm rest
  kit.tube([[x - 2.1, 0.2, z - 0.64], [x + 2.1, 0.2, z - 0.64]], 0.022, brass, { parent, seg: 4, radialSeg: 5 });   // foot rail
  for (const fx of [-2.0, -1.0, 0, 1.0, 2.0]) box(0.03, 0.03, 0.17, brass, fx, 0.2, -0.56);
  // the bartender's side: a speed rail of bottles under the top, a sink lip
  box(4.2, 0.04, 0.12, P.chrome(), 0, 0.7, 0.53);
  for (let i = 0; i < 12; i++) bottle(-1.9 + i * 0.34, 0.72, 0.53, i + 3, 0.7);

  // ── things left on the counter ──────────────────────────────────────────────────────────────
  for (const [gx, gz, k] of [[-1.7, -0.25, 0], [-1.45, -0.32, 1], [-0.5, -0.2, 2], [0.9, -0.28, 0], [1.6, -0.22, 1]] as const) glass(gx, 1.06, gz, k);
  ashtray(0.25, 1.06, -0.25);
  chips(-1.05, 1.06, -0.3, 5); chips(-0.95, 1.06, -0.18, 3); chips(1.25, 1.06, -0.3, 4);
  for (const tx of [-0.25, 0, 0.25]) {                                 // beer taps
    cyl(0.025, 0.025, 0.22, brass, tx, 1.17, 0.25);
    box(0.06, 0.04, 0.12, brass, tx, 1.27, 0.2);
    cyl(0.018, 0.012, 0.16, dark, tx, 1.37, 0.17);
  }
  box(0.9, 0.02, 0.24, P.chrome(), 0, 1.07, 0.3);                      // drip tray

  // ── stools ──────────────────────────────────────────────────────────────────────────────────
  for (const sx of [-1.4, 0, 1.4]) {
    const s = kit.stool({ h: 0.76, seat: 0x6a1420, leg: 0x8c6b29 });
    s.position.set(x + sx, 0, z - 1.15);
    parent.add(s);
  }

  // ── the back bar (x ±2.0, z 0.7 … 1.7 from the counter centre) ───────────────────────────────
  const bz = 1.45;                                                     // cabinet centre
  box(4.0, 0.92, 0.5, walnut, 0, 0.46, bz);
  for (let i = 0; i < 4; i++) box(0.88, 0.62, 0.03, mahog, -1.5 + i * 1.0, 0.48, bz - 0.26);   // cabinet doors
  for (let i = 0; i < 4; i++) box(0.12, 0.03, 0.03, brass, -1.5 + i * 1.0, 0.66, bz - 0.285);  // pulls
  const ctop = box(4.1, 0.05, 0.6, marble, 0, 0.945, bz);
  worldUV(ctop, 2);
  box(4.2, 1.4, 0.06, dark, 0, 1.67, 1.7);                             // back board
  kit.plane(3.5, 0.95, { map: mirrorTex(kit.tex), color: 0xc8d0d8, lit: false }, { pos: [x, 1.55, z + 1.665], rot: [0, 180, 0], parent, shade: false });
  for (const sy of [-1, 1]) box(3.62, 0.05, 0.04, brass, 0, 1.55 + sy * 0.5, 1.65);           // mirror frame
  for (const sx of [-1, 1]) box(0.05, 1.05, 0.04, brass, sx * 1.78, 1.55, 1.65);
  for (const sx of [-1, 1]) box(0.16, 1.4, 0.36, walnut, sx * 1.98, 1.67, 1.52);              // side columns
  box(4.36, 0.14, 0.4, walnut, 0, 2.43, 1.52);                          // crown
  box(4.4, 0.04, 0.42, brass, 0, 2.345, 1.52);   // its top 5 mm under the columns' tops
  // two glass shelves on brass brackets, lit from below, each with a row of bottles
  for (const [row, sy] of [[0, 1.3], [1, 1.72]] as const) {
    box(3.6, 0.025, 0.22, kit.mat({ color: 0x9ab8c0, lit: false }), 0, sy, 1.53);
    box(3.5, 0.012, 0.02, glow, 0, sy - 0.02, 1.43);
    for (const sx of [-1.6, 0, 1.6]) box(0.03, 0.08, 0.2, brass, sx, sy - 0.05, 1.55);
    for (let i = 0; i < 13; i++) bottle(-1.62 + i * 0.27, sy + 0.013, 1.55, i * 5 + row * 7, 1);
  }
  for (let i = 0; i < 10; i++) bottle(-1.75 + i * 0.39, 0.97, 1.3, i * 3 + 1, 0.9);             // the counter row, in front of the shelves
  for (let i = 0; i < 6; i++) glass(-1.55 + i * 0.12, 0.97, 1.21, i % 3);                    // clean glasses, upturned
  const neon = crispNeon(kit, { text: { key: 'prop.sign.bar' }, h: 0.32, color: 0xffb060, flicker: 0.05, font: 'chetyre' });
  neon.root.position.set(x, 2.43, z + 1.29);
  neon.root.rotation.y = Math.PI;
  neon.setOn(true);
  o.root.add(neon.root);

  // ── the end of the bar: a walnut service cabinet with an ice bucket and a bottle in it ─────────
  box(0.68, 1.04, 0.66, walnut, 2.85, 0.52, 0);
  const capTop = box(0.74, 0.05, 0.72, marble, 2.85, 1.065, 0);
  worldUV(capTop, 2);
  for (const sy of [0.08, 0.98]) box(0.7, 0.03, 0.68, brass, 2.85, sy, 0);
  cyl(0.11, 0.09, 0.2, P.chrome(), 2.85, 1.19, 0, 8);
  cyl(0.035, 0.035, 0.2, kit.mat({ color: 0x2a6a2a, lit: false }), 2.88, 1.33, 0.02);

  /** One bottle (body, shoulder, neck, cap) standing at local (bx, by, bz), colour picked from the table by `k`, scaled by `s`. */
  function bottle(bx: number, by: number, bzz: number, k: number, s: number): void {
    const c = GLASS[k % GLASS.length], h = (0.2 + ((k * 7) % 5) * 0.015) * s;
    const m = kit.mat({ color: c, lit: false });
    cyl(0.034 * s, 0.036 * s, h, m, bx, by + h / 2, bzz);
    cyl(0.013 * s, 0.03 * s, 0.04 * s, m, bx, by + h + 0.02 * s, bzz);
    cyl(0.012 * s, 0.012 * s, 0.06 * s, m, bx, by + h + 0.07 * s, bzz, 4);
    cyl(0.015 * s, 0.015 * s, 0.015 * s, k % 3 === 0 ? brass : ash, bx, by + h + 0.105 * s, bzz, 4);
  }
  /** A tumbler, a highball or a coupe on a surface at height gy. */
  function glass(gx: number, gy: number, gz: number, k: number): void {
    const m = kit.mat({ color: 0xc8dce0, lit: false });
    if (k === 0) { cyl(0.035, 0.03, 0.08, m, gx, gy + 0.04, gz); cyl(0.028, 0.028, 0.03, kit.mat({ color: 0xb06a20, lit: false }), gx, gy + 0.02, gz); }
    else if (k === 1) cyl(0.03, 0.027, 0.14, m, gx, gy + 0.07, gz);
    else { cyl(0.05, 0.012, 0.04, m, gx, gy + 0.12, gz); cyl(0.005, 0.005, 0.09, m, gx, gy + 0.055, gz, 4); cyl(0.03, 0.03, 0.008, m, gx, gy + 0.004, gz); }
  }
  /** A glass ashtray with a cigarette resting on its rim, the tip glowing. */
  function ashtray(ax: number, ay: number, az: number): void {
    cyl(0.07, 0.065, 0.02, kit.mat({ color: 0x6a7a80, lit: false }), ax, ay + 0.01, az, 8);
    cyl(0.05, 0.05, 0.004, ash, ax, ay + 0.022, az, 8);
    kit.box(0.08, 0.01, 0.01, kit.mat({ color: 0xe8e0d0, lit: false }), { pos: [x + ax + 0.05, ay + 0.026, z + az], rot: [0, 25, 0], parent, shade: false });
    kit.box(0.012, 0.012, 0.012, kit.mat({ color: 0xff6020, lit: false }), { pos: [x + ax + 0.093, ay + 0.026, z + az - 0.018], parent, shade: false });
  }
  /** A stack of `n` casino chips. */
  function chips(cx: number, cy: number, cz: number, n: number): void {
    const cols = [0xb01c28, 0x1c3a8a, 0xe8e0d0, 0x1c6a3a];
    for (let i = 0; i < n; i++) cyl(0.022, 0.022, 0.008, kit.mat({ color: cols[(i + n) % cols.length], lit: false }), cx, cy + 0.004 + i * 0.0085, cz, 8);
  }
}
