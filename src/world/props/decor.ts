/**
 * Architecture and dressing props (WORLD-ARCH, ART_BIBLE §6.2–6.7, GDD §8.4 / §8.9): wing gates, columns, the Sump,
 * the Furnace, the Collector's chair, the brass X plate, and the neon and plaque signage. Gates are `WorldProp`s with
 * `setOpen`, the shape `GateDef.prop` expects. Everything is built from kit primitives and vendor textures.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { WorldProp } from '../types';
import { Sched, easeInOutCubic, easeOutQuad, lcg } from './sched';

export interface GateProp extends WorldProp {
  setOpen(open: boolean, dur?: number): Promise<void>;
}
export const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((obj) => { const m = obj as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
};

// ── columns (ART_BIBLE §6.2) ─────────────────────────────────────────────────────────────────────────
export interface ColumnParts { root: THREE.Group; radius: number }
/** Octagonal marble shaft (dia 0.6), brass base rings, three stepped capitals. Origin = floor centre. */
export function buildColumn(kit: KitX, tex: TexGen, o: { h: number; pos: [number, number, number] }): ColumnParts {
  const root = kit.group('column');
  const marble = kit.mat({ color: 0x9a8a78, map: tex.tiles(0x9a8a78, 0x7a6c5e, 2) });
  const brass = kit.pal.brass;
  const shaftTop = o.h - 0.35;
  kit.cyl(0.3, 0.3, shaftTop - 0.25, marble, { pos: [0, 0.25 + (shaftTop - 0.25) / 2, 0], parent: root, seg: 8 });
  kit.cyl(0.375, 0.375, 0.1, brass, { pos: [0, 0.05, 0], parent: root, seg: 8 });
  kit.cyl(0.375, 0.375, 0.1, brass, { pos: [0, 0.2, 0], parent: root, seg: 8 });
  for (const [r, y] of [[0.35, 0.04], [0.4, 0.12], [0.45, 0.2]] as Array<[number, number]>) {
    kit.cyl(r, r, 0.08, marble, { pos: [0, shaftTop + y, 0], parent: root, seg: 8 });
  }
  kit.box(0.9, 0.04, 0.9, brass, { pos: [0, o.h - 0.02, 0], parent: root });
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  return { root, radius: 0.45 };
}

// ── wing gates (GDD §8.1: roll-down iron grilles, 3 s rattle) ────────────────────────────────────────
/**
 * Roll-down grille for a 4 m doorway. `rotY` 0 when the wall runs along x, 90 when it runs along z. Closed = slats
 * fill the opening; open = the curtain rolls up into the lintel (hidden behind it). Opening rattles for 3 s first.
 */
export class Grille implements GateProp {
  readonly id: string;
  readonly root: THREE.Group;
  private readonly slats: THREE.Object3D;
  private readonly sched = new Sched();
  private open_ = false;
  private rattle = 0;

  constructor(id: string, root: THREE.Group, slats: THREE.Object3D) {
    this.id = id;
    this.root = root;
    this.slats = slats;
  }

  setOpen(open: boolean, dur = 1.2): Promise<void> {
    if (this.open_ === open) return Promise.resolve();
    this.open_ = open;
    const y0 = this.slats.position.y, y1 = open ? 4.6 : 1.5;
    const ratt = open ? this.sched.run(3, (k) => { this.rattle = Math.sin(k * 3 * 40) * 0.012 * (1 - k * 0.5); }) : Promise.resolve();
    return ratt.then(() => this.sched.run(dur, (k) => { this.slats.position.y = y0 + (y1 - y0) * k; this.rattle = 0; }, easeInOutCubic));
  }

  update(dt: number): void {
    this.sched.update(dt);
    this.root.position.x = this.root.userData.baseX + this.rattle;
  }

  dispose(): void { this.sched.clear(); disposeTree(this.root); }
}

export function buildGrille(kit: KitX, tex: TexGen, o: { id: string; pos: [number, number, number]; rotY: 0 | 90; width?: number }): Grille {
  const width = o.width ?? 4;
  const root = kit.group(`grille:${o.id}`);
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  root.rotation.y = THREE.MathUtils.degToRad(o.rotY);
  root.userData.baseX = o.pos[0];
  const iron = kit.mat({ color: 0x2a2a2a, map: tex.metal(0x2a2a2a, { brushed: true }), side: 'double' });
  const slats = kit.plane(width, 3, iron, { pos: [0, 1.5, 0], parent: root, segW: 4, segH: 12 });
  kit.box(0.14, 3.1, 0.14, kit.pal.steel, { pos: [-width / 2, 1.55, 0], parent: root });
  kit.box(0.14, 3.1, 0.14, kit.pal.steel, { pos: [width / 2, 1.55, 0], parent: root });
  return new Grille(o.id, root, slats);
}

/** Velvet curtain + padlocked chain across the 2 m Lobby ↔ Parlour arch (GDD §8.4). Open = parted and chain dropped. */
export class VelvetCurtain implements GateProp {
  readonly id = 'gate:parlour';
  readonly root: THREE.Group;
  private readonly panels: THREE.Object3D[];
  private readonly chain: THREE.Object3D;
  private readonly sched = new Sched();
  private open_ = false;

  constructor(root: THREE.Group, panels: THREE.Object3D[], chain: THREE.Object3D) {
    this.root = root;
    this.panels = panels;
    this.chain = chain;
  }

  setOpen(open: boolean, dur = 1.0): Promise<void> {
    if (this.open_ === open) return Promise.resolve();
    this.open_ = open;
    const [a, b] = this.panels;
    return this.sched.run(dur, (k) => {
      const s = open ? k : 1 - k;
      a.position.x = -0.5 - s * 0.7;
      b.position.x = 0.5 + s * 0.7;
      a.scale.x = b.scale.x = 1 - s * 0.6;
      this.chain.visible = s < 0.5;
    }, easeOutQuad);
  }

  update(dt: number): void { this.sched.update(dt); }
  dispose(): void { this.sched.clear(); disposeTree(this.root); }
}

export function buildVelvetCurtain(kit: KitX, tex: TexGen, o: { pos: [number, number, number]; rotY: 0 | 90 }): VelvetCurtain {
  const root = kit.group('gate:parlour');
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  root.rotation.y = THREE.MathUtils.degToRad(o.rotY);
  const velvet = kit.mat({ color: 0x6a0a14, map: tex.carpet('diamond', [0x6a0a14, 0x4a060e]), side: 'double' });
  const a = kit.plane(1.0, 2.7, velvet, { pos: [-0.5, 1.35, 0.05], parent: root, segW: 8, segH: 2 });
  const b = kit.plane(1.0, 2.7, velvet, { pos: [0.5, 1.35, 0.05], parent: root, segW: 8, segH: 2 });
  const chain = kit.group('chain');
  for (let i = 0; i < 9; i++) kit.torus(0.05, 0.012, kit.pal.brass, { pos: [-0.8 + i * 0.2, 1.2, 0.12], rot: [0, 90, 0], parent: chain, seg: 6, tubeSeg: 3 });
  kit.box(0.14, 0.12, 0.05, kit.pal.steel, { pos: [0, 1.15, 0.14], parent: chain });
  root.add(chain);
  return new VelvetCurtain(root, [a, b], chain);
}

/** Steel MANAGEMENT door (Lobby ↔ Counting Room). Hinged on its north/south edge; open swings 100°. */
export class ManagementDoor implements GateProp {
  readonly id = 'gate:counting';
  readonly root: THREE.Group;
  private readonly leaf: THREE.Object3D;
  private readonly sched = new Sched();
  private open_ = false;

  constructor(root: THREE.Group, leaf: THREE.Object3D) {
    this.root = root;
    this.leaf = leaf;
  }

  setOpen(open: boolean, dur = 1.4): Promise<void> {
    if (this.open_ === open) return Promise.resolve();
    this.open_ = open;
    const to = open ? -Math.PI * 100 / 180 : 0;
    const from = this.leaf.rotation.y;
    return this.sched.run(dur, (k) => { this.leaf.rotation.y = from + (to - from) * k; }, easeInOutCubic);
  }

  update(dt: number): void { this.sched.update(dt); }
  dispose(): void { this.sched.clear(); disposeTree(this.root); }
}

export function buildManagementDoor(kit: KitX, tex: TexGen, o: { pos: [number, number, number]; rotY: 0 | 90 }): ManagementDoor {
  const root = kit.group('gate:counting');
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  root.rotation.y = THREE.MathUtils.degToRad(o.rotY);
  const hinge = kit.group('hinge');
  hinge.position.set(-0.95, 0, 0);
  const steel = kit.mat({ color: 0x5a5e62, map: tex.metal(0x5a5e62, { brushed: true }) });
  kit.box(1.9, 2.6, 0.08, steel, { pos: [0.95, 1.3, 0], parent: hinge });
  kit.box(0.5, 0.12, 0.02, kit.pal.brass, { pos: [0.7, 1.2, 0.05], parent: hinge });
  root.add(hinge);
  const sign = kit.plaque({ text: { key: 'prop.sign.management' }, w: 1.4, h: 0.3, color: 0x1a120c });
  sign.position.set(0, 2.85, 0.06);
  root.add(sign);
  return new ManagementDoor(root, hinge);
}

// ── sump (ART_BIBLE §6.2 / GDD §8.9) ───────────────────────────────────────────────────────────────
/** The Sump: a 12 × 12 × 4 m pit at y −30, a coin mound, the corkboard Sump Wall and a rope ladder in the shaft. */
export class Sump implements WorldProp {
  readonly id = 'sump';
  readonly root: THREE.Group;
  constructor(root: THREE.Group) {
    this.root = root;
  }
  dispose(): void { disposeTree(this.root); }
}

export function buildSump(kit: KitX, tex: TexGen, o: { pos: [number, number, number]; seed?: number; coinCount?: number }): Sump {
  const root = kit.group('sump');
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  const concrete = kit.mat({ color: 0x4a4a52, map: tex.concrete(0x4a4a52) });
  const tile = kit.mat({ color: 0x3a3c44, map: tex.tiles(0x3a3c44, 0x2a2c34, 2) });
  kit.plane(12, 12, tile, { rot: [-90, 0, 0], pos: [0, 0.01, 0], parent: root, segW: 6, segH: 6 });
  kit.box(12.3, 4, 0.3, concrete, { pos: [0, -2, -6.15], parent: root });
  kit.box(12.3, 4, 0.3, concrete, { pos: [0, -2, 6.15], parent: root });
  kit.box(0.3, 4, 12, concrete, { pos: [-6.15, -2, 0], parent: root });
  kit.box(0.3, 4, 12, concrete, { pos: [6.15, -2, 0], parent: root });
  // pipe runs under the ceiling line (rust, valve wheels)
  kit.cyl(0.12, 0.12, 12, kit.mat({ color: 0x6a4a30, map: tex.rust(0x6a4a30) }), { rot: [0, 0, 90], pos: [0, -3.6, -5.8], parent: root, seg: 8 });
  kit.cyl(0.2, 0.2, 12, kit.mat({ color: 0x5a3a24, map: tex.rust(0x5a3a24) }), { rot: [90, 0, 0], pos: [-5.7, -3.3, 0], parent: root, seg: 8 });

  // coin mound Ø 6 m × 1.2 m, one instanced draw (350 coins × 4 segments: half the old 700 × 8, see docs/PERF.md)
  const n = o.coinCount ?? 350;
  const coinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 4);
  const coinMat = kit.mat({ color: 0xc8a040, emissive: 0x3a2a08, emissiveIntensity: 0.4 });
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, n);
  const rnd = lcg(o.seed ?? 7);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const r = 3 * Math.sqrt(rnd()) * 0.96;
    const a = rnd() * Math.PI * 2;
    const h = 1.2 * Math.max(0, 1 - (r / 3) ** 2) * (0.7 + 0.3 * rnd());
    p.set(Math.cos(a) * r, h, Math.sin(a) * r);
    e.set(rnd() * 0.3, rnd() * Math.PI * 2, rnd() * 0.3);
    q.setFromEuler(e);
    m.compose(p, q, s);
    coins.setMatrixAt(i, m);
  }
  coins.instanceMatrix.needsUpdate = true;
  coins.position.y = 0.01;
  root.add(coins);

  // Sump Wall (north wall of the pit): corkboard with the last JackIDs (placeholder list until the save feeds it)
  const cork = tex.canvas(256, 192, (g, w, h) => {
    g.fillStyle = '#8a6a44';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8dcc0';
    g.fillRect(8, 8, w - 16, h - 16);
    const rnd2 = lcg(91);
    for (let i = 0; i < 12; i++) {
      const id = 'JK-' + Math.floor(rnd2() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
      tex.drawText(g, id, 16 + (i % 3) * 78, 30 + Math.floor(i / 3) * 34, { font: 'px5', color: '#2a1a10', align: 'left', scale: 2 });
    }
  }, { wrap: 'clamp' });
  kit.plane(3.2, 2.4, kit.mat({ map: cork, lit: true }), { pos: [0, -1.8, -5.97], parent: root });

  // rope ladder hanging in the shaft (x 0, z 0.7 from the hero plate line)
  const rope = kit.mat({ color: 0x8a7050, map: tex.metal(0x8a7050) });
  for (const x of [-0.25, 0.25]) kit.tube([[x, -0.2, 0.2], [x, 29.6, 0.2]], 0.015, rope, { parent: root, seg: 16, radialSeg: 4 });

  return new Sump(root);
}

// ── furnace, collector's chair, X plate ───────────────────────────────────────────────────────────
export function buildFurnace(kit: KitX, tex: TexGen, o: { pos: [number, number, number]; rotY: 0 | 90 | 180 | 270 }): { root: THREE.Group; glow: THREE.Object3D } {
  const root = kit.group('furnace');
  root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  root.rotation.y = THREE.MathUtils.degToRad(o.rotY);
  const iron = kit.mat({ color: 0x4a3a30, map: tex.rust(0x4a3a30) });
  kit.box(1.6, 2.4, 1.2, iron, { pos: [0, 1.2, 0], parent: root });
  kit.box(0.9, 0.9, 0.06, kit.pal.black, { pos: [0, 0.6, 0.62], parent: root });
  const glow = kit.plane(0.7, 0.5, kit.mat({ color: 0xff5a1a, emissive: 0xff5a1a, emissiveIntensity: 1.0, lit: false }), { pos: [0, 0.6, 0.66], parent: root });
  kit.cyl(0.18, 0.18, 1.2, iron, { pos: [0.4, 3.0, 0], parent: root, seg: 8 });
  return { root, glow };
}

export function buildCollectorChair(kit: KitX, o: { pos: [number, number, number]; rotY: 0 | 90 | 180 | 270 }): THREE.Group {
  const chair = kit.chair({ h: 1.0, seat: 0x3a1018, wood: 0x2a1a10 });
  chair.position.set(o.pos[0], o.pos[1], o.pos[2]);
  chair.rotation.y = THREE.MathUtils.degToRad(o.rotY);
  return chair;
}

export function buildXPlate(kit: KitX, o: { pos: [number, number, number] }): THREE.Group {
  const g = kit.group('xplate');
  g.position.set(o.pos[0], o.pos[1] + 0.012, o.pos[2]);
  kit.box(0.8, 0.02, 0.8, kit.pal.brass, { parent: g });
  kit.box(0.9, 0.02, 0.06, kit.pal.gold, { rot: [0, 45, 0], parent: g, pos: [0, 0.01, 0] });
  kit.box(0.9, 0.02, 0.06, kit.pal.gold, { rot: [0, -45, 0], parent: g, pos: [0, 0.011, 0] });
  return g;
}
