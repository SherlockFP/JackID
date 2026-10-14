/**
 * Room dressing (WAVE 24 §2): Jade (lacquer, lanterns, tile frieze, green fog), The Wash (drum washers, 12 numbered
 * lockers), The Boiler (rust, steam, pressure gauge, Vent lever), the Parlour's Collector's Chair (Nights 3–7), and the
 * Counting Room (ledgers, Ledger Wall, abacus). Also the lore note anchors `note.n15`–`note.n28` and the room anchors.
 * Reuses kit pieces; the only lights are fixture hints that join the pooled light list.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { V3, ZoneId } from '@/core/types';
import type { Interactable, InteractionSystem, WorldLights } from '../types';
import type { LightHint } from '../sys/arch';
import { t } from '@/core/i18n';
import { roomsBridge } from './bridge';
import {
  LOCKER_COUNT, LOCKER_X, ROOM_ANCHOR_IDS, chairVisible, lockerLabel, lockerZ, needleDeg, noteAnchorId,
} from './logic';

const WHITE = 0xe9ede6;
const CHROME = 0xa9b0b6;
const RUST = 0x7b3a19;
const JADE = 0x2f8a5a;
const RED = 0xb0202a;

export interface DressingCtx {
  kit: KitX;
  tex: TexGen;
  /** The Collector's chair built by the level (shown on Nights 3–7). */
  chair: THREE.Object3D | null;
  /** Sump centre (the lore note n28 sits by it). */
  sumpPos: V3;
  isOpen: (zone: ZoneId) => boolean;
  interact?: InteractionSystem;
  lights?: WorldLights;
}

export interface DressingBuild {
  root: THREE.Group;
  lights: LightHint[];
  anchors: Record<string, THREE.Object3D>;
  statics: Array<{ box: THREE.Box3; tag?: 'solid' }>;
  update(dt: number, t: number): void;
  dispose(): void;
}

export function buildDressing(ctx: DressingCtx): DressingBuild {
  const { kit, tex, isOpen } = ctx;
  const root = kit.group('rooms:dressing');
  const lights: LightHint[] = [];
  const anchors: Record<string, THREE.Object3D> = {};
  const statics: Array<{ box: THREE.Box3; tag?: 'solid' }> = [];
  const unsubs: Array<() => void> = [];
  const disposables: Array<{ dispose(): void }> = [];
  const steps: Array<(dt: number, time: number) => void> = [];
  const boxAt = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 =>
    new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  const marker = (id: string, x: number, y: number, z: number): void => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    root.add(o);
    anchors[id] = o;
  };
  const addInteract = (i: Interactable): void => { if (ctx.interact) unsubs.push(ctx.interact.add(i)); };

  // ── Jade Room (cards): lacquer, paper lanterns, tile frieze, green fog ─────────────────────────
  const frieze = tex.canvas(256, 32, (g, w, h) => {
    g.fillStyle = '#1d5e3e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8fd6a6';
    g.lineWidth = 2;
    for (let x = 0; x < w; x += 16) { g.strokeRect(x + 3, 6, 10, 20); g.strokeRect(x + 6, 10, 4, 12); }
  }, { wrap: 'repeat' });
  kit.plane(19, 0.5, kit.mat({ color: 0xffffff, map: frieze }), { pos: [-21, 2.8, -15.84], parent: root });
  kit.box(19.2, 0.06, 0.08, kit.mat({ color: JADE }), { pos: [-21, 2.55, -15.8], parent: root });
  // jade lacquer dado along the south partition (the room side faces -z)
  kit.plane(19, 1.2, kit.mat({ color: JADE }), { pos: [-21, 0.6, -2.16], rot: [0, 180, 0], parent: root, segW: 6, segH: 2 });
  const lanterns: Array<[number, number]> = [[-27.5, -14.5], [-27.5, -5], [-13.5, -12], [-13.5, -4]];
  for (const [i, [x, z]] of lanterns.entries()) {
    kit.cyl(0.006, 0.006, 0.43, kit.pal.black, { pos: [x, 2.985, z], parent: root, seg: 4 });
    const lan = kit.lamp({ r: 0.17, color: 0xff4a2a, shape: 'dome' });
    lan.root.position.set(x, 2.6, z);
    root.add(lan.root);
    lights.push({ id: `cards:lantern${i}`, pos: [x, 2.5, z], color: 0xff5a3a, intensity: 0.9, range: 4, flicker: 'STEADY', zone: 'cards' });
  }
  const fogMat = new THREE.MeshBasicMaterial({ color: 0x3dff8f, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending });
  const fogGeo = new THREE.PlaneGeometry(18, 12);
  disposables.push(fogGeo, fogMat);
  for (const y of [0.3, 0.9]) {
    const fog = new THREE.Mesh(fogGeo, fogMat);
    fog.rotation.x = -Math.PI / 2;
    fog.position.set(-21, y, -9);
    root.add(fog);
  }
  marker(noteAnchorId(15), -23.5, 1.2, -15.2);
  marker(ROOM_ANCHOR_IDS.jadeLin, -13.4, 1.1, -5.6);
  marker(noteAnchorId(16), -13.4, 1.1, -5.6);

  // ── The Wash (laundry): drum washers, 12 numbered lockers, drains ────────────────────────────
  const enamel = kit.mat({ color: WHITE });
  const chromeMat = kit.mat({ color: CHROME });
  const glassMat = kit.mat({ color: 0x203040 });
  for (const x of [-27.6, -26.0]) {
    const body = kit.box(0.9, 1.6, 0.8, enamel, { pos: [x, 0.8, -1.3], parent: root });
    kit.torus(0.3, 0.04, chromeMat, { pos: [0, 0.1, 0.41], parent: body });
    kit.cyl(0.27, 0.27, 0.02, glassMat, { pos: [0, 0.1, 0.4], rot: [90, 0, 0], parent: body });
    const drum = new THREE.Group();
    drum.position.set(0, 0.1, 0.42);
    body.add(drum);
    for (let k = 0; k < 3; k++) {
      const vane = kit.box(0.05, 0.42, 0.02, chromeMat, { parent: drum });
      vane.rotation.z = (k * Math.PI) / 3;
    }
    steps.push((dt) => { drum.rotation.z -= dt * 2.4; });
  }
  for (const [x, z] of [[-13.2, -0.8], [-13.2, 8.6]] as Array<[number, number]>) {
    const drain = kit.cyl(0.18, 0.18, 0.01, kit.pal.black, { pos: [x, 0.004, z], parent: root, seg: 12 });
    drain.name = 'drain';
  }
  const lockerMat = kit.mat({ color: 0x5f7a6e });
  const doorMat = kit.mat({ color: 0x9fb5a8 });
  for (let n = 1; n <= LOCKER_COUNT; n++) {
    const z = lockerZ(n);
    kit.box(0.5, 1.9, 0.36, lockerMat, { pos: [LOCKER_X, 0.95, z], parent: root });
    kit.box(0.02, 1.7, 0.3, doorMat, { pos: [LOCKER_X - 0.26, 0.95, z], parent: root });
    const num = kit.label({ text: lockerLabel(n), w: 0.22, h: 0.16, color: 0x1a1a1a, bg: 0xe6dec5 });
    num.mesh.position.set(LOCKER_X - 0.27, 1.5, z);
    num.mesh.rotation.y = -Math.PI / 2;
    root.add(num.mesh);
    statics.push({ box: boxAt(LOCKER_X - 0.25, 0, z - 0.18, LOCKER_X + 0.25, 1.9, z + 0.18), tag: 'solid' });
    const n0 = n;
    addInteract({
      id: `rooms:locker:${n}`,
      box: boxAt(LOCKER_X - 0.42, 0.3, z - 0.2, LOCKER_X - 0.1, 1.9, z + 0.2),
      maxDist: 2.2,
      enabled: () => isOpen('laundry'),
      label: () => t('wroom.locker.label', { n: lockerLabel(n0) }),
      sub: () => t('wroom.locker.sub'),
      onInteract: () => roomsBridge().openLocker(n0),
    });
  }
  marker(ROOM_ANCHOR_IDS.washLockers, -12.8, 1.0, 0.0);
  marker(noteAnchorId(17), -13.2, 0.9, -0.6);
  marker(noteAnchorId(18), -26.8, 1.0, -0.2);
  marker(noteAnchorId(19), -26.0, 1.65, -1.2);

  // ── The Boiler (boiler): rust pipes, steam, pressure gauge, Vent lever ───────────────────────
  const rust = kit.mat({ color: RUST });
  kit.tube([[11.4, 3.1, -29.6], [29.6, 3.1, -29.6]], 0.09, rust, { parent: root });
  kit.tube([[11.4, 2.5, -29.6], [29.6, 2.5, -29.6]], 0.06, rust, { parent: root });
  kit.cyl(0.08, 0.08, 3.6, rust, { pos: [12.2, 1.8, -29.6], parent: root, seg: 8 });
  const steamSeeds: Array<{ sp: THREE.Sprite; x: number; z: number; ph: number }> = [];
  for (let i = 0; i < 5; i++) {
    const sp = kit.glow({ color: 0xd9e4dc, size: 1.6, intensity: 0.18 });
    const x = 15 + i * 3, z = -26 + (i % 2) * 6;
    sp.position.set(x, 0.5, z);
    root.add(sp);
    steamSeeds.push({ sp, x, z, ph: i / 5 });
  }
  steps.push((_dt, time) => {
    for (const s of steamSeeds) {
      const f = (time * 0.15 + s.ph) % 1;
      s.sp.position.set(s.x + Math.sin(time * 0.5 + s.ph * 6) * 0.2, 0.5 + f * 2.6, s.z);
    }
  });

  const dialTex = tex.canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#efe6cc';
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = w * 0.42;
    const pt = (deg: number, rad: number): [number, number] => {
      const a = (deg * Math.PI) / 180;
      return [cx + Math.sin(a) * rad, cy - Math.cos(a) * rad];
    };
    g.strokeStyle = '#b3202a';
    g.lineWidth = w * 0.07;
    g.beginPath();
    for (let s = 0; s <= 20; s++) {
      const [x, y] = pt(needleDeg(85) + (135 - needleDeg(85)) * (s / 20), r * 0.82);
      if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.strokeStyle = '#2a1a10';
    g.lineWidth = 3;
    for (let k = 0; k <= 10; k++) {
      const [x0, y0] = pt(-135 + k * 27, r * 0.7);
      const [x1, y1] = pt(-135 + k * 27, r * 0.95);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  });
  const gauge = kit.group('rooms:gauge');
  gauge.position.set(11.25, 1.9, -20.0);
  gauge.rotation.y = Math.PI / 2;
  root.add(gauge);
  kit.cyl(0.24, 0.24, 0.06, kit.pal.brass, { rot: [90, 0, 0], parent: gauge, seg: 16 });
  kit.plane(0.4, 0.4, kit.mat({ color: 0xffffff, map: dialTex }), { pos: [0, 0, 0.032], parent: gauge });
  const needle = new THREE.Group();
  needle.position.set(0, 0, 0.04);
  gauge.add(needle);
  kit.box(0.02, 0.16, 0.01, kit.mat({ color: 0xc52129 }), { pos: [0, 0.07, 0], parent: needle });
  steps.push(() => { needle.rotation.z = -THREE.MathUtils.degToRad(needleDeg(roomsBridge().pressure())); });
  lights.push({ id: 'boiler:gauge', pos: [12.2, 1.9, -20.0], color: 0xff5a3a, intensity: 0.4, range: 2.5, flicker: 'BUZZ', zone: 'boiler' });

  const lever = kit.lever({ length: 0.45, knob: RED, side: 'right' });
  lever.root.position.set(11.3, 1.2, -22.6);
  lever.root.rotation.y = Math.PI / 2;
  root.add(lever.root);
  addInteract({
    id: 'rooms:vent',
    box: boxAt(11.05, 0.9, -23.0, 11.9, 1.7, -22.2),
    maxDist: 2.2,
    enabled: () => isOpen('boiler'),
    label: () => t('wroom.vent.label'),
    sub: () => t('wroom.vent.sub', { p: String(Math.round(roomsBridge().pressure())) }),
    onInteract: () => { void lever.pull(); roomsBridge().vent(); },
  });
  marker(ROOM_ANCHOR_IDS.boilerGauge, 12.2, 1.4, -20.6);
  marker(ROOM_ANCHOR_IDS.boilerVent, 11.6, 1.2, -22.6);
  marker(noteAnchorId(20), 12.4, 1.3, -20.6);
  marker(noteAnchorId(21), 13.2, 2.4, -29.0);

  // ── The Parlour: the Collector's chair (Nights 3–7) and the two parlour notes ────────────────
  let chairIn = 0;
  steps.push((dt) => {
    chairIn -= dt;
    if (chairIn > 0) return;
    chairIn = 1;
    if (ctx.chair) ctx.chair.visible = chairVisible(roomsBridge().night());
  });
  marker(ROOM_ANCHOR_IDS.collectorChair, 29.5, 1.0, 19.0);
  marker(noteAnchorId(22), 16.5, 1.0, 18.0);
  marker(noteAnchorId(23), 25.0, 1.0, 19.5);

  // ── The Counting Room (counting): ledgers, Ledger Wall, abacus ───────────────────────────────
  const wood = kit.mat({ color: 0x523119 });
  kit.box(1.4, 0.06, 0.8, wood, { pos: [-22.5, 0.75, 16.5], parent: root });
  for (const [dx, dz] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]] as Array<[number, number]>) {
    kit.box(0.06, 0.72, 0.06, wood, { pos: [-22.5 + dx, 0.36, 16.5 + dz], parent: root });
  }
  for (const [i, c] of [0x3a1a1a, 0x1f3a2a, 0x2a2a3a, 0x4a3a1a].entries()) {
    kit.box(0.3, 0.05, 0.22, kit.mat({ color: c }), { pos: [-22.5, 0.805 + i * 0.05, 16.5], parent: root });
  }
  marker(ROOM_ANCHOR_IDS.countingLedger, -22.5, 0.95, 16.5);
  marker(noteAnchorId(24), -24.0, 0.95, 15.2);
  marker(noteAnchorId(25), -22.1, 0.95, 16.1);
  marker(noteAnchorId(26), -27.5, 0.9, 17.8);

  const spines = tex.canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#20160e';
    g.fillRect(0, 0, w, h);
    const cols = ['#5a1a1a', '#1f4a2f', '#2a2a4a', '#6a4a1a', '#3a1a3a', '#1a3a4a'];
    for (let x = 4, i = 0; x < w - 8; x += 13, i++) {
      g.fillStyle = cols[i % cols.length];
      g.fillRect(x, 10, 11, h - 20);
      g.fillStyle = '#c9b48a';
      g.fillRect(x + 2, 22, 7, 2);
      g.fillRect(x + 2, h - 26, 7, 2);
    }
  });
  kit.plane(3.0, 1.2, kit.mat({ color: 0xffffff, map: spines }), { pos: [-30.83, 1.7, 14.8], rot: [0, 90, 0], parent: root });
  for (const y of [1.0, 1.7, 2.4]) {
    kit.box(0.36, 0.04, 3.0, wood, { pos: [-30.66, y, 14.8], parent: root });
  }
  addInteract({
    id: 'rooms:ledger',
    box: boxAt(-30.95, 0.7, 13.3, -30.3, 2.6, 16.3),
    maxDist: 2.4,
    enabled: () => isOpen('counting'),
    label: () => t('wroom.ledger.label'),
    sub: () => t('wroom.ledger.sub'),
    onInteract: () => roomsBridge().readLedger?.(),
  });

  const abacusFrame = kit.mat({ color: 0x311910 });
  kit.box(2.4, 1.0, 0.05, abacusFrame, { pos: [-22, 2.1, 12.22], parent: root });
  const beadMat = kit.mat({ color: 0xb03a2a });
  const rodMat = kit.mat({ color: 0xc59c42 });
  for (const y of [2.4, 2.1, 1.8]) {
    kit.cyl(0.015, 0.015, 2.2, rodMat, { pos: [-22, y, 12.25], rot: [0, 0, 90], parent: root, seg: 6 });
    for (let k = 0; k < 9; k++) {
      kit.cyl(0.05, 0.05, 0.04, beadMat, { pos: [-22 - 1.0 + k * 0.25, y, 12.27], rot: [90, 0, 0], parent: root, seg: 8 });
    }
  }
  marker(ROOM_ANCHOR_IDS.countingAbacus, -22, 2.1, 12.4);
  lights.push({ id: 'counting:abacus', pos: [-22, 2.6, 13.2], color: 0xffd27a, intensity: 0.5, range: 3, flicker: 'CANDLE', zone: 'counting' });

  // ── lore note anchors not placed above ───────────────────────────────────────────────────────
  marker(noteAnchorId(27), -7.0, 1.2, -28.2);
  marker(noteAnchorId(28), ctx.sumpPos[0] - 2, -29.4, ctx.sumpPos[2] + 1);

  return {
    root,
    lights,
    anchors,
    statics,
    update(dt: number, time: number): void {
      for (const s of steps) s(dt, time);
    },
    dispose(): void {
      for (const u of unsubs.splice(0)) u();
      for (const d of disposables) d.dispose();
    },
  };
}
