/**
 * The progressive floor's dust sheet and NEW marquee (Wave 27, WORLD-ARCH). Both are local to a slot group: origin = slot
 * floor centre, +Z = the machine's front, exactly like a machine root, so the session adds them with
 * `world.slotGroup(instance).add(prop.root)`.
 *
 *   createCover(kit, { size, night })   a canvas sheet draped over a machine that has not opened yet, a strap and a plate
 *                                       "OPENS NIGHT n". `setCovered(false)` lifts it at the Dawn the machine opens.
 *   createNewMarquee(kit, { size })     a two-sided "NEW" neon with chasing bulbs above a machine that opened this Night.
 *
 * Sizes follow `SLOT_DIMS`. The sheet is padded 6 cm past the footprint, so it also hides the chain overlay that
 * `MachineBase.setLocked` hangs at the front (z = depth/2 - 0.02).
 */
import type { KitX } from '@/kit';
import type { SlotSize } from '@/core/types';
import { SLOT_DIMS } from '@/core/types';
import { disposeObject3D } from '@/core/dispose';
import type { WorldProp } from '../types';
import { Sched, easeInOutCubic, easeOutQuad } from './sched';
import { crispLabel, crispNeon } from './signs';

/** Height of the sheet per slot class: tall cabinets are covered to the top, tables are covered like a table under a tarp. */
const COVER_H: Record<SlotSize, number> = { S: 1.95, M: 2.7, L: 1.5, XL: 1.9 };
const PAD = 0.06;

export interface CoverProp extends WorldProp {
  readonly covered: boolean;
  /**
   * True while a lift or drop tween is running. The tween only advances through `update(dt)`, so the owner must keep
   * calling `update` on this cover until `busy` is false (the session's `frame()` loop does, while the cover is in its map).
   */
  readonly busy: boolean;
  /** Re-print the plate ("OPENS NIGHT n"). */
  setNight(n: number): void;
  /** Tycoon: the second plate line "E: BUY <price>" under "OPENS NIGHT n" (null hides it). */
  setPrice(price: string | null): void;
  /**
   * Lift the sheet (Dawn animation) or drop it back. `dur` 0 = instant. Resolves when the tween has finished. Calling it
   * again with the same target while a tween runs returns that tween's promise (no second tween).
   */
  setCovered(on: boolean, dur?: number): Promise<void>;
}

export function createCover(kit: KitX, o: { size: SlotSize; night: number; id?: string }): CoverProp {
  const d = SLOT_DIMS[o.size];
  const W = d.w + PAD * 2, D = d.d + PAD * 2, H = COVER_H[o.size];
  const root = kit.group(`cover:${o.id ?? o.size}`);
  const sheet = kit.group('sheet');
  root.add(sheet);
  const canvas = kit.mat({ color: 0x8f8872 });
  const fold = kit.mat({ color: 0x6f6a58 });
  // stepped tarp: a wide skirt, a narrower shoulder and a cap (reads as a sheet thrown over a shape)
  const layers: Array<[number, number, number]> = [[0, 0.58, 1], [0.58, 0.86, 0.88], [0.86, 1, 0.66]];
  for (const [y0, y1, k] of layers) {
    const h = (y1 - y0) * H;
    kit.box(W * k, h, D * k, canvas, { pos: [0, y0 * H + h / 2, 0], parent: sheet, bevel: 0.03 });
  }
  // fold lines down the front corners and a dark hem at the floor
  for (const sx of [-1, 1]) kit.box(0.05, H * 0.55, 0.05, fold, { pos: [sx * W * 0.32, H * 0.3, D / 2 + 0.005], parent: sheet });
  kit.box(W + 0.02, 0.06, D + 0.02, fold, { pos: [0, 0.03, 0], parent: sheet });
  // strap + buckle (brass) across the front at knee height
  const strapY = H * 0.34;
  kit.box(W + 0.02, 0.07, 0.03, kit.pal.leather, { pos: [0, strapY, D / 2 + 0.012], parent: sheet });
  kit.box(0.1, 0.1, 0.04, kit.pal.brass, { pos: [0, strapY, D / 2 + 0.03], parent: sheet });

  // plate: dark enamel board with brass trim, "OPENS NIGHT n"
  const plateW = Math.min(1.1, W * 0.86), plateH = plateW * 0.28;
  const plate = kit.group('plate');
  const py = H * 0.5;
  plate.position.set(0, py, D / 2 + 0.04);
  kit.box(plateW + 0.06, plateH + 0.06, 0.04, kit.pal.brass, { parent: plate });
  kit.box(plateW + 0.02, plateH + 0.02, 0.05, kit.pal.black, { parent: plate });
  const label = crispLabel(kit, { text: { key: 'prop.cover.opens', vars: { n: o.night } }, w: plateW, h: plateH, bg: 0x1a120c, color: 0xffd34a, font: 'public' });
  label.mesh.position.z = 0.03;
  plate.add(label.mesh);
  // price tag (tycoon BUY): a small gold-on-black line under the plate, hidden until the session sets a price
  const tagW = plateW * 0.9, tagH = plateH * 0.8;   // large enough to read from the floor at the BUY distance
  const tag = crispLabel(kit, { text: { key: 'prog.tag', vars: { price: '' } }, w: tagW, h: tagH, bg: 0x1a120c, color: 0x7dffb0 });
  tag.mesh.position.set(0, -(plateH / 2 + tagH / 2 + 0.07), 0.03);
  tag.mesh.visible = false;
  plate.add(tag.mesh);
  root.add(plate);

  let covered = true;
  let night = o.night;
  let priceText = '';
  let pending: Promise<void> | null = null;
  const sched = new Sched();
  const api: CoverProp = {
    id: `cover:${o.id ?? o.size}`,
    root,
    get covered() { return covered; },
    get busy() { return sched.busy; },
    setNight(n: number) { if (n === night) return; night = n; label.setText({ key: 'prop.cover.opens', vars: { n } }); },
    setPrice(price: string | null) {
      tag.mesh.visible = price !== null;
      if (price !== null && price !== priceText) { priceText = price; tag.setText({ key: 'prog.tag', vars: { price } }); }
    },
    setCovered(on: boolean, dur = 1.1): Promise<void> {
      if (on === covered) return pending ?? Promise.resolve();
      // a tween still running (a quick toggle) lands on its final pose first, so two tweens never fight over the sheet
      sched.finish();
      covered = on;
      if (on) root.visible = true;
      if (dur <= 0) {
        sheet.scale.set(1, on ? 1 : 0.01, 1); plate.position.y = on ? py : -1; root.visible = on;
        pending = null;
        return Promise.resolve();
      }
      const s0 = sheet.scale.y, y0 = plate.position.y;
      const s1 = on ? 1 : 0.01, y1 = on ? py : py + 0.9;
      const p: Promise<void> = sched.run(dur, (k) => {
        // lifting: the plate floats up and the sheet slides off sideways-and-down (scaled flat)
        sheet.scale.y = s0 + (s1 - s0) * k;
        sheet.position.y = on ? 0 : Math.sin(k * Math.PI) * 0.15;
        plate.position.y = y0 + (y1 - y0) * k;
        plate.visible = on || k < 0.7;
      }, on ? easeOutQuad : easeInOutCubic).then(() => {
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
      // shared kit materials and geometry are left alone; the per-instance plate texture and its material go
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
