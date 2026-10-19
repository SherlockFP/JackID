/**
 * The progressive floor's glass vitrine and NEW marquee (Wave 27, WORLD-ARCH; the vitrine replaced the dust sheet in wave 87).
 * Both are local to a slot group: origin = slot floor centre, +Z = the machine's front, exactly like a machine root, so the
 * session adds them with `world.slotGroup(instance).add(prop.root)`.
 *
 *   createCover(kit, { size, night, box })   a brass-framed smoked-glass case over a machine that has not opened yet: the
 *                                            machine stands inside, powered down (`MachineBase.setLocked` dims it), and a
 *                                            small brass plate on the glass reads "OPENS NIGHT n" (and the BUY price).
 *                                            `setCovered(false)` lifts the glass into the ceiling, with a light spill.
 *   createNewMarquee(kit, { size })          a two-sided "NEW" neon with chasing bulbs above a machine that opened this Night.
 *
 * The case is sized from `box` (the machine's bounds in slot space, padded), else from `SLOT_DIMS` and `COVER_H`.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { SlotSize } from '@/core/types';
import { SLOT_DIMS } from '@/core/types';
import { disposeObject3D } from '@/core/dispose';
import type { WorldProp } from '../types';
import { Sched, easeInOutCubic, easeOutQuad } from './sched';
import { crispLabel, crispNeon } from './signs';

/** Case height per slot class when the machine's bounds are not given. */
const COVER_H: Record<SlotSize, number> = { S: 1.95, M: 2.7, L: 1.5, XL: 1.9 };
const PAD = 0.06;
/** How far the glass rises when the machine opens: past any ceiling in the pit. */
const LIFT_M = 4.5;

export interface CoverProp extends WorldProp {
  readonly covered: boolean;
  /**
   * True while a lift or drop tween is running. The tween only advances through `update(dt)`, so the owner must keep
   * calling `update` on this cover until `busy` is false (the session's `frame()` loop does, while the cover is in its map).
   */
  readonly busy: boolean;
  /** Where the dust falls from when the glass lifts (slot space: the case's top centre). */
  readonly top: THREE.Vector3;
  /** Re-print the plate ("OPENS NIGHT n"). */
  setNight(n: number): void;
  /** Tycoon: the second plate line "E: BUY <price>" under "OPENS NIGHT n" (null hides it). */
  setPrice(price: string | null): void;
  /**
   * Lift the glass (Dawn animation) or drop it back. `dur` 0 = instant. Resolves when the tween has finished. Calling it
   * again with the same target while a tween runs returns that tween's promise (no second tween).
   */
  setCovered(on: boolean, dur?: number): Promise<void>;
}

export function createCover(kit: KitX, o: { size: SlotSize; night: number; id?: string; box?: { min: readonly number[]; max: readonly number[] } }): CoverProp {
  const d = SLOT_DIMS[o.size];
  // the machine's own bounds, kept inside its slot footprint; the old fixed sheet sizes when there are none
  const bx = o.box;
  const x0 = bx ? Math.max(-d.w / 2, bx.min[0]) - PAD : -d.w / 2 - PAD, x1 = bx ? Math.min(d.w / 2, bx.max[0]) + PAD : d.w / 2 + PAD;
  const z0 = bx ? Math.max(-d.d / 2, bx.min[2]) - PAD : -d.d / 2 - PAD, z1 = bx ? Math.min(d.d / 2, bx.max[2]) + PAD : d.d / 2 + PAD;
  const W = x1 - x0, D = z1 - z0, H = bx ? Math.min(3.4, bx.max[1] + 0.08) : COVER_H[o.size];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const { pal } = kit;
  const root = kit.group(`cover:${o.id ?? o.size}`);
  root.position.set(cx, 0, cz);

  // the plinth stays on the floor: a walnut skirt with a brass top edge, open in the middle (the machine stands on the floor)
  const BASE = 0.09, RIM = 0.035;
  const base = kit.group('vitrineBase');
  root.add(base);
  for (const [w, dd, px, pz] of [[W, RIM * 2, 0, D / 2 - RIM], [W, RIM * 2, 0, -D / 2 + RIM], [RIM * 2, D, W / 2 - RIM, 0], [RIM * 2, D, -W / 2 + RIM, 0]] as const) {
    kit.box(w, BASE, dd, pal.woodDark, { pos: [px, BASE / 2, pz], parent: base });
    kit.box(w + 0.01, 0.012, dd + 0.01, pal.brass, { pos: [px, BASE + 0.006, pz], parent: base });
  }

  // the case: smoked glass on four sides and the top in a brass frame. Smoked, so the machine inside reads dim at a glance.
  const glass = kit.group('vitrineGlass');
  root.add(glass);
  const GH = H - BASE, gy = BASE + GH / 2;
  // plain smoked glass (no glint map: kit.glass stretches its 16 px streak tile into big blocky bands on a pane this size)
  const smoked = kit.mat({ color: 0x232a30, lit: false, transparent: true, opacity: 0.4, depthWrite: false, side: 'double' });
  const pane = (w: number, h: number): THREE.Mesh => { const m = kit.plane(w, h, smoked); m.renderOrder = 2; return m; };
  for (const s of [1, -1]) {
    const f = pane(W - 0.03, GH); f.position.set(0, gy, s * (D / 2 - 0.015)); glass.add(f);
    const side = pane(D - 0.03, GH); side.rotation.y = Math.PI / 2; side.position.set(s * (W / 2 - 0.015), gy, 0); glass.add(side);
  }
  const lid = pane(W - 0.03, D - 0.03); lid.rotation.x = -Math.PI / 2; lid.position.set(0, H - 0.01, 0); glass.add(lid);
  const F = 0.03;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(F, GH, F, pal.brass, { pos: [sx * (W / 2 - F / 2), gy, sz * (D / 2 - F / 2)], parent: glass });
  for (const y of [BASE + 0.025 + F / 2, H - F / 2]) {
    for (const sz of [-1, 1]) kit.box(W, F, F, pal.brass, { pos: [0, y, sz * (D / 2 - F / 2)], parent: glass });
    for (const sx of [-1, 1]) kit.box(F, F, D, pal.brass, { pos: [sx * (W / 2 - F / 2), y, 0], parent: glass });
  }
  // reflection streaks on the front pane and edge glints down the front posts (faint, unlit, so they read in a dark wing)
  const streak = kit.mat({ color: 0xbfd8e8, lit: false, transparent: true, opacity: 0.1, additive: true });
  for (const [px, w, len] of [[-0.22, 0.07, 0.75], [-0.08, 0.025, 0.55], [0.3, 0.05, 0.45]] as const) {
    const m = kit.plane(w * W, len * GH, streak, { pos: [px * W, gy + 0.05 * GH, D / 2 + 0.002], rot: [0, 0, 24], parent: glass });
    m.renderOrder = 3;
  }
  const glintMat = kit.mat({ color: 0xfff1d0, lit: false });
  for (const sx of [-1, 1]) kit.box(0.006, GH * 0.4, 0.006, glintMat, { pos: [sx * (W / 2 - 0.004), gy + GH * 0.18, D / 2 + 0.004], parent: glass });

  // the plate: a small brass museum plaque on the front glass at hand height, "OPENS NIGHT n" and the BUY price under it
  const plateW = Math.min(0.7, W * 0.8), plateH = plateW * 0.24;
  const plate = kit.group('plate');
  const py = Math.min(1.05, GH * 0.5 + BASE);
  plate.position.set(0, py, D / 2 + 0.006);
  kit.box(plateW + 0.04, plateH + 0.04, 0.01, pal.brass, { parent: plate, bevel: 0.004 });
  const label = crispLabel(kit, { text: { key: 'prop.cover.opens', vars: { n: o.night } }, w: plateW, h: plateH, bg: 0x1a120c, color: 0xffd34a, font: 'public' });
  label.mesh.position.z = 0.007;
  plate.add(label.mesh);
  const tagW = plateW * 0.9, tagH = plateH * 0.8;   // large enough to read from the floor at the BUY distance
  const tag = crispLabel(kit, { text: { key: 'prog.tag', vars: { price: '' } }, w: tagW, h: tagH, bg: 0x1a120c, color: 0x7dffb0 });
  tag.mesh.position.set(0, -(plateH / 2 + tagH / 2 + 0.04), 0.007);
  tag.mesh.visible = false;
  plate.add(tag.mesh);
  glass.add(plate);

  // the light spill when the glass lifts: a warm shaft down onto the machine and a pool on the floor (hidden until then)
  const shaftMat = kit.mat({ color: 0xffe2a8, lit: false, transparent: true, opacity: 0, additive: true, unique: true }) as THREE.MeshBasicMaterial;
  const shaft = kit.box(W * 0.9, H + 1.5, D * 0.9, shaftMat, { pos: [0, (H + 1.5) / 2, 0], parent: root });
  const pool = kit.plane(W + 0.8, D + 0.8, shaftMat, { pos: [0, 0.012, 0], rot: [-90, 0, 0], parent: root });
  shaft.visible = pool.visible = false;
  shaft.renderOrder = pool.renderOrder = 4;

  let covered = true;
  let night = o.night;
  let priceText = '';
  let pending: Promise<void> | null = null;
  const sched = new Sched();
  const api: CoverProp = {
    id: `cover:${o.id ?? o.size}`,
    root,
    top: new THREE.Vector3(cx, H, cz),
    get covered() { return covered; },
    get busy() { return sched.busy; },
    setNight(n: number) { if (n === night) return; night = n; label.setText({ key: 'prop.cover.opens', vars: { n } }); },
    setPrice(price: string | null) {
      tag.mesh.visible = price !== null;
      if (price !== null && price !== priceText) { priceText = price; tag.setText({ key: 'prog.tag', vars: { price } }); }
    },
    setCovered(on: boolean, dur = 1.1): Promise<void> {
      if (on === covered) return pending ?? Promise.resolve();
      // a tween still running (a quick toggle) lands on its final pose first, so two tweens never fight over the glass
      sched.finish();
      covered = on;
      if (on) root.visible = true;
      if (dur <= 0) {
        glass.position.y = on ? 0 : LIFT_M; root.visible = on; shaft.visible = pool.visible = false;
        pending = null;
        return Promise.resolve();
      }
      const y0 = glass.position.y, y1 = on ? 0 : LIFT_M;
      shaft.visible = pool.visible = !on;
      const p: Promise<void> = sched.run(dur, (k) => {
        // lifting: the glass rises into the ceiling; the light spills in as it clears and fades as the machine boots
        glass.position.y = y0 + (y1 - y0) * k;
        shaftMat.opacity = on ? 0 : 0.22 * Math.sin(Math.min(1, k * 1.15) * Math.PI);
      }, on ? easeOutQuad : easeInOutCubic).then(() => {
        shaft.visible = pool.visible = false;
        if (!covered) root.visible = false;   // only the tween that ends uncovered hides the root
        if (pending === p) pending = null;
      });
      pending = p;
      return p;
    },
    update(dt: number) { sched.update(dt); },
    dispose() {
      // a lift still running ends at its final pose (the promise resolves, the owner can remove the root)
      sched.finish();
      pending = null;
      // shared kit materials and geometry are left alone; the per-instance plate textures, the shaft material and the panes go
      disposeObject3D(root);
    },
  };
  return api;
}

// ── NEW marquee ──────────────────────────────────────────────────────────────────────────────────────
export interface NewMarqueeProp extends WorldProp {
  setOn(on: boolean): void;
}

/** Height of the machine top per slot class (where the sign hangs). */
const TOP_Y: Record<SlotSize, number> = { S: 2.0, M: 3.2, L: 2.5, XL: 3.9 };

export function createNewMarquee(kit: KitX, o: { size: SlotSize; id?: string }): NewMarqueeProp {
  const root = kit.group(`new:${o.id ?? o.size}`);
  const board = kit.group('board');
  root.add(board);
  board.position.y = TOP_Y[o.size] + 0.35;
  const w = o.size === 'S' ? 0.9 : o.size === 'M' ? 1.1 : 1.5, h = w * 0.42;
  const faces: Array<{ neon: ReturnType<KitX['neon']> }> = [];
  for (const side of [1, -1]) {
    const face = kit.group('face');
    face.rotation.y = side > 0 ? 0 : Math.PI;
    face.position.z = side * 0.03;
    board.add(face);
    kit.box(w, h, 0.05, kit.pal.black, { parent: face, bevel: 0.01 });
    kit.box(w + 0.04, 0.025, 0.06, kit.pal.gold, { pos: [0, h / 2, 0], parent: face });
    kit.box(w + 0.04, 0.025, 0.06, kit.pal.gold, { pos: [0, -h / 2, 0], parent: face });
    const neon = crispNeon(kit, { text: { key: 'prop.sign.new' }, h: h * 0.7, color: 0xffe14a, flicker: 0.15, font: 'chetyre' });
    neon.root.position.z = 0.04;
    face.add(neon.root);
    faces.push({ neon });
  }
  // chasing bulbs round the board edge (one chain, both sides see it)
  const chain = kit.bulbChain({ path: { rect: [w + 0.1, h + 0.1] }, count: 16, colors: [0xffe14a, 0xff4a8a, 0x63e6de], r: 0.02 });
  chain.pattern('chase', 6);
  board.add(chain.root);
  // two short rods up to the ceiling clamp
  for (const sx of [-1, 1]) kit.cyl(0.012, 0.012, 0.5, kit.pal.chrome, { pos: [sx * w * 0.38, h / 2 + 0.25, 0], parent: board, seg: 4 });

  let t = 0;
  let on = false;
  const api: NewMarqueeProp = {
    id: `new:${o.id ?? o.size}`,
    root,
    setOn(v: boolean) {
      on = v;
      root.visible = v;
      for (const f of faces) f.neon.setOn(v);
    },
    update(dt: number) {
      if (!on) return;
      t += dt;
      board.rotation.y = Math.sin(t * 1.4) * 0.12;
      board.position.y = TOP_Y[o.size] + 0.35 + Math.sin(t * 2.2) * 0.03;
    },
    dispose() {
      disposeObject3D(root);
    },
  };
  api.setOn(true);
  return api;
}

// ── Crooked Table mark ───────────────────────────────────────────────────────────────────────────────
/** A small hanging plate with a number over one of the Crooked Table's three tables (amber letters on a dark ground). */
export function createTableMark(kit: KitX, o: { size: SlotSize; text: string; id?: string }): NewMarqueeProp {
  const root = kit.group(`tmark:${o.id ?? o.size}`);
  const board = kit.group('board');
  root.add(board);
  board.position.y = TOP_Y[o.size] + 0.3;
  const h = 0.26;
  for (const side of [1, -1]) {
    const face = kit.group('face');
    face.rotation.y = side > 0 ? 0 : Math.PI;
    face.position.z = side * 0.02;
    board.add(face);
    const neon = crispNeon(kit, { text: o.text, h, color: 0xffb23a, flicker: 0, font: 'chetyre' });
    neon.root.position.z = 0.01;
    face.add(neon.root);
  }
  kit.cyl(0.01, 0.01, 0.4, kit.pal.chrome, { pos: [0, h / 2 + 0.2, 0], parent: board, seg: 4 });
  let t = 0;
  const api: NewMarqueeProp = {
    id: `tmark:${o.id ?? o.size}`,
    root,
    setOn(v: boolean) { root.visible = v; },
    update(dt: number) {
      t += dt;
      board.rotation.y = Math.sin(t * 1.1) * 0.1;
    },
    dispose() { disposeObject3D(root); },
  };
  return api;
}
