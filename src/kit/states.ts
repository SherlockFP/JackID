/**
 * Slot state overlays. `lockOverlay(size)` hangs a chain X, a brass padlock and a swaying CLOSED sign in front of a
 * machine whose wing is shut (chains are two crossed alpha strips each, so forty locked machines cost almost nothing);
 * `outOfOrder(size)` is the stand-in cabinet MachineBase uses when a model fails to build. Both are sized from
 * `SLOT_DIMS`, origin = floor centre of the slot, +Z = front, all text through i18n (`kit.closed`, `kit.outOfOrder`).
 */
import * as THREE from 'three';
import { SLOT_DIMS } from '@/core/types';
import { psx } from './materials';
import { finalizeModel } from './finalize';
import { PAL, css } from './palette';
import { keep, part, type KitCtx } from './ctx';
import type { Kit } from './types';

export function makeStates(ctx: KitCtx, deps: Pick<Kit, 'label' | 'cabinet' | 'screen'>): Pick<Kit, 'lockOverlay' | 'outOfOrder'> {
  const { P, M, tex } = ctx;

  /** 16×8 chain: a wide link, then an edge-on link. Alpha-tested. */
  const chainTex = (): THREE.Texture => tex.canvas(16, 8, (g) => {
    g.clearRect(0, 0, 16, 8);
    g.fillStyle = css(PAL.SLATE);
    const ring = (cx: number, rx: number, ry: number): void => {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - 4) / ry, d = dx * dx + dy * dy;
        if (d <= 1 && d >= 0.35) { g.fillStyle = y < 4 ? css(PAL.CHROME_MID) : css(PAL.SLATE); g.fillRect(x, y, 1, 1); }
      }
    };
    ring(4.5, 4.2, 3.8);
    g.fillStyle = css(PAL.CHROME_HI); g.fillRect(11, 2, 1, 4);
    g.fillStyle = css(PAL.SLATE); g.fillRect(12, 2, 1, 4);
    g.fillStyle = css(PAL.CHROME_MID); g.fillRect(8, 3, 3, 1); g.fillRect(8, 5, 3, 1);
  }, { key: 'kit:chain', wrap: 'repeat' });

  const stripeTex = (): THREE.Texture => tex.stripes([PAL.BULB_YELLOW, PAL.PIT_BLACK], 'd');

  /** A chain between two points as two crossed alpha strips. */
  const chain = (parent: THREE.Object3D, a: [number, number, number], b: [number, number, number]): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mat = psx({ map: chainTex(), color: 0xffffff, alphaTest: 0.5, side: 'double', vertexColors: true });
    const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    for (const roll of [0, 90]) {
      const m = P.plane(len, 0.055, mat, { segW: 1, segH: 1 });
      const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const reps = Math.max(1, len / 0.1);
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
      m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (roll * Math.PI) / 180));
      m.position.copy(mid);
      parent.add(m);
    }
  };

  const lockOverlay: Kit['lockOverlay'] = (size) => {
    const d = SLOT_DIMS[size];
    const root = part(P.group('lock_overlay'));
    const H = Math.min(d.h, 2.4), W = d.w - 0.08, z = d.d / 2 - 0.02;
    root.userData.noAO = true;
    // dust sheet: dims the machine behind the chains
    P.plane(W, H, psx({ color: 0x08080c, lit: false, transparent: true, opacity: 0.45, depthWrite: false }), { pos: [0, H / 2, z - 0.015], shade: false, parent: root });
    chain(root, [-W / 2, 0.12, z], [W / 2, H - 0.12, z + 0.01]);
    chain(root, [W / 2, 0.12, z + 0.01], [-W / 2, H - 0.12, z]);
    chain(root, [-W / 2, H * 0.5, z + 0.02], [W / 2, H * 0.5, z + 0.02]);
    // padlock at the crossing
    const lock = new THREE.Group();
    lock.name = 'padlock';
    lock.position.set(0, H * 0.5 - 0.02, z + 0.06);
    root.add(lock);
    P.box(0.17, 0.14, 0.06, M.brass(), { bevel: 0.012, pos: [0, -0.07, 0], parent: lock });
    P.torus(0.05, 0.013, M.chrome(), { pos: [0, 0.02, 0], seg: 8, tubeSeg: 4, arc: Math.PI, parent: lock });
    P.box(0.018, 0.04, 0.01, 0x08080c, { pos: [0, -0.08, 0.032], parent: lock });
    P.cyl(0.014, 0.014, 0.01, 0x08080c, { pos: [0, -0.06, 0.032], rot: [90, 0, 0], seg: 6, parent: lock });
    // hanging CLOSED sign
    const sign = new THREE.Group();
    sign.name = 'closed_sign';
    sign.position.set(0, H * 0.5 - 0.3, z + 0.07);
    root.add(sign);
    const sw = Math.min(0.7, d.w * 0.5), sh = sw * 0.3;
    P.box(sw + 0.04, sh + 0.04, 0.02, M.enamel(PAL.CASINO_RED, 0.4), { bevel: 0.006, pos: [0, -sh / 2, 0], parent: sign });
    for (const sx of [-1, 1]) P.box(0.01, 0.1, 0.008, M.chrome(), { pos: [sx * sw * 0.35, 0.03, 0], parent: sign });
    const label = deps.label({ text: { key: 'kit.closed' }, w: sw, h: sh, bg: PAL.CASINO_RED, color: PAL.PAPER, px: [64, 20] });
    label.mesh.position.set(0, -sh / 2, 0.012);
    sign.add(label.mesh);
    keep(sign);
    finalizeModel(root, { keep: [sign] });
    ctx.anim.tick(sign, (_dt, t) => { sign.rotation.z = Math.sin(t * 1.3 + z) * 0.05; sign.rotation.y = Math.sin(t * 0.9) * 0.05; });
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
