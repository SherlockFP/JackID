/**
 * Slot state overlays. `lockOverlay(size)` is the powered-down shade over a locked machine (the floor's glass vitrine,
 * world/props/cover.ts, carries the "not open yet" read);
 * `outOfOrder(size)` is the stand-in cabinet MachineBase uses when a model fails to build. Both are sized from
 * `SLOT_DIMS`, origin = floor centre of the slot, +Z = front, all text through i18n (`kit.outOfOrder`).
 */
import * as THREE from 'three';
import { SLOT_DIMS } from '@/core/types';
import { psx } from './materials';
import { finalizeModel } from './finalize';
import { PAL } from './palette';
import { keep, part, type KitCtx } from './ctx';
import type { Kit } from './types';

export function makeStates(ctx: KitCtx, deps: Pick<Kit, 'label' | 'cabinet' | 'screen'>): Pick<Kit, 'lockOverlay' | 'outOfOrder'> {
  const { P, tex } = ctx;

  const stripeTex = (): THREE.Texture => tex.stripes([PAL.BULB_YELLOW, PAL.PIT_BLACK], 'd');

  const lockOverlay: Kit['lockOverlay'] = (size) => {
    const d = SLOT_DIMS[size];
    const root = part(P.group('lock_overlay'));
    const H = Math.min(d.h, 2.4), W = d.w - 0.08, z = d.d / 2 - 0.02;
    root.userData.noAO = true;
    // powered down: a dark shade over the front dims the screens and lamps. The floor's glass vitrine (world/props/cover.ts) is
    // what says "not open yet"; the chains, padlock and CLOSED sign that used to hang here would sit inside the glass.
    P.plane(W, H, psx({ color: 0x08080c, lit: false, transparent: true, opacity: 0.5, depthWrite: false }), { pos: [0, H / 2, z - 0.015], shade: false, parent: root });
    finalizeModel(root, { keep: [] });
    return root;
  };

  const outOfOrder: Kit['outOfOrder'] = (size) => {
    const d = SLOT_DIMS[size];
    const root = part(P.group('out_of_order'));
    const pal = ctx.pal;
    const w = size === 'S' ? 0.7 : size === 'M' ? 1.2 : size === 'L' ? Math.min(2.6, d.w - 0.6) : Math.min(3.2, d.w - 0.8);
    const dd = size === 'S' ? 0.65 : size === 'M' ? 0.9 : size === 'L' ? 1.2 : 1.6;
    const h = size === 'S' ? 1.8 : size === 'M' ? 2.05 : size === 'L' ? 0.95 : 2.4;
    const cab = deps.cabinet({
      style: size === 'L' ? 'counter' : 'upright', w, h, d: dd, body: 0x3a3a42, trim: pal.chrome, grime: 0.8,
      screen: size === 'L' ? undefined : { w: w * 0.5, h: w * 0.38, y: h * 0.72 },
      topper: size === 'L' ? undefined : { h: h * 0.14 },
    });
    root.add(cab.root);
    if (cab.anchors.screen) {
      const s = deps.screen({ w: w * 0.5, h: w * 0.38, px: [64, 48], bezel: pal.black });
      cab.anchors.screen.add(s.mesh);
      s.clear('#101019');
      s.text('X X', 6, 8, { font: 'px5', scale: 2, color: '#c52129' });
    }
    // hazard tape X + sign
    const tape = psx({ map: stripeTex(), color: 0xffffff, vertexColors: true });
    const front = dd / 2 + 0.06;
    for (const sg of [-1, 1]) {
      const len = Math.hypot(w, h * 0.6) * 1.02;
      const ang = Math.atan2(h * 0.6, w) * sg;
      P.box(len, 0.1, 0.012, tape, { pos: [0, h * 0.45, front], rot: [0, 0, (ang * 180) / Math.PI], parent: root });
    }
    const sw = Math.min(0.62, w * 0.9), sh = sw * 0.22;
    const label = deps.label({ text: { key: 'kit.outOfOrder' }, w: sw, h: sh, bg: PAL.BULB_YELLOW, color: PAL.PIT_BLACK, px: [96, 20] });
    label.mesh.position.set(0, h * 0.45, front + 0.012);
    root.add(label.mesh);
    const lamp = psx({ color: PAL.SIGNAL_RED, lit: false, unique: true }) as THREE.MeshBasicMaterial;
    const lm = P.sphere(0.04, lamp, { pos: [0, h + 0.05, 0], hemi: true, wSeg: 8, hSeg: 3, shade: false, parent: root });
    keep(lm);
    ctx.anim.tick(root, (_dt, t) => { lamp.color.setHex(Math.floor(t * 2) % 2 === 0 ? PAL.SIGNAL_RED : PAL.DRIED_BLOOD); });
    finalizeModel(root, { keep: [] });
    return root;
  };

  return { lockOverlay, outOfOrder };
}
