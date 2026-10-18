/**
 * Lift (ART_BIBLE §6.6 ELEVATOR, GDD §8.4): the opening at (−4, 0, −30) in the Mouth's north wall, a brass surround,
 * a fan transom with the floor dial (B7 … B1, G; the needle rests on B7), a gate of brass diamonds that collapses
 * sideways on open, a walnut car in the niche north of the opening, a chain across the doors, a lit HOME sign above them
 * and a small DUE / PAID counter beside them (Wave 72: the lift is the landmark that says where the Night ends).
 *
 * The car lives in the niche (z −32.2 … −30) and rides the shaft: `ride('up')` lifts it out of view, `ride('down')`
 * drops it into the Sump. Doors and ride are frame-driven (`update`), so nothing blocks the game clock.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { ElevatorProp } from '../types';
import { Sched, easeInOutCubic, easeOutQuad } from './sched';
import type { NeonPart, ScreenSurface } from '@/kit/types';
import { app } from '@/core/app';
import { t } from '@/core/i18n';

export const LIFT_OPEN_W = 2.0;
export const LIFT_OPEN_H = 2.6;
const FLOOR_LABELS = ['B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'G'];

export interface ElevatorParts {
  root: THREE.Group;
  /** Gate halves (scale.x collapses them to 0.15 when open). */
  gateL: THREE.Group;
  gateR: THREE.Group;
  /** Car: moves on y; its origin is the car floor centre. */
  car: THREE.Group;
  needle: THREE.Object3D;
  /** Chain and padlock shown while locked. */
  lock: THREE.Group;
  /** The lit HOME sign over the doors. */
  sign: THREE.Object3D;
  neon: NeonPart;
  /** DUE / PAID counter beside the doors. */
  counter: ScreenSurface;
  /** Repaint the counter (`null` = no quota in this mode: just the lift label). */
  paint(q: { due: number; met: boolean } | null): void;
  dispose(): void;
}

function dialTexture(tex: TexGen): THREE.Texture {
  return tex.canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#1a120c';
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h - 8, r = w / 2 - 10;
    g.strokeStyle = '#c8a050';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI, 0);
    g.stroke();
    FLOOR_LABELS.forEach((label, i) => {
      const a = Math.PI - (i / (FLOOR_LABELS.length - 1)) * Math.PI;
      const x = cx + Math.cos(a) * (r - 18), y = cy - Math.sin(a) * (r - 18);
      tex.drawText(g, label, x, y, { font: 'px5', color: '#ffb000', align: 'center' });
    });
  }, { wrap: 'clamp' });
}

export function buildElevator(kit: KitX, tex: TexGen): ElevatorParts {
  const root = kit.group('elevator');
  const brass = kit.pal.brass;
  const marble = kit.mat({ color: 0x6a5a48, map: tex.tiles(0x6a5a48, 0x4a3e34, 4) });
  const walnut = kit.mat({ color: 0x4a2a18, map: tex.wood(0x4a2a18) });

  // surround (3.2 × 3.6), opening 2.0 × 2.6 is the hole in the wall
  kit.box(0.2, 3.6, 0.3, marble, { pos: [-LIFT_OPEN_W / 2 - 0.6, 1.8, 0.1], parent: root });
  kit.box(0.2, 3.6, 0.3, marble, { pos: [LIFT_OPEN_W / 2 + 0.6, 1.8, 0.1], parent: root });
  kit.box(3.2, 0.2, 0.3, marble, { pos: [0, LIFT_OPEN_H + 0.7, 0.1], parent: root });
  kit.box(3.4, 0.08, 0.36, brass, { pos: [0, 0.04, 0.12], parent: root });
  kit.box(3.4, 0.05, 0.36, brass, { pos: [0, LIFT_OPEN_H + 0.6, 0.12], parent: root });

  // transom with the floor dial above the opening
  const dialMat = kit.mat({ map: dialTexture(tex), lit: false, fog: false });
  kit.plane(2.0, 0.8, dialMat, { pos: [0, LIFT_OPEN_H + 0.3 + 0.02, 0.16], parent: root });
  // the needle pivots on the dial's centre (bottom edge of the transom plane)
  const needle = kit.group('needle');
  kit.box(0.03, 0.55, 0.02, kit.pal.red, { pos: [0, 0.275, 0.02], parent: needle });
  needle.position.set(0, LIFT_OPEN_H + 0.3 - 0.36, 0.18);
  root.add(needle);

  // gate halves: brass diamond lattice approximated by bars
  const gateL = kit.group('gateL');
  const gateR = kit.group('gateR');
  gateL.position.set(-LIFT_OPEN_W / 4, 0, 0.12);
  gateR.position.set(LIFT_OPEN_W / 4, 0, 0.12);
  for (const g of [gateL, gateR]) {
    for (let y = 0.1; y < LIFT_OPEN_H; y += 0.26) kit.box(LIFT_OPEN_W / 2, 0.02, 0.02, brass, { pos: [0, y, 0], parent: g });
    for (let i = -0.5; i <= 0.5; i += 0.2) kit.box(0.02, LIFT_OPEN_H, 0.02, brass, { pos: [i * LIFT_OPEN_W / 2, LIFT_OPEN_H / 2, 0], parent: g });
    root.add(g);
  }

  // car (walnut cabin 1.8 × 2.5 × 1.8) in the niche, centre z −1.1 relative to the wall
  const car = kit.group('car');
  car.position.set(0, 0, -1.1);
  kit.box(1.8, 0.1, 1.8, walnut, { pos: [0, 0.05, 0], parent: car });
  kit.box(1.8, 0.05, 1.8, walnut, { pos: [0, 2.5, 0], parent: car });
  kit.box(0.05, 2.5, 1.8, walnut, { pos: [-0.9, 1.25, 0], parent: car });
  kit.box(0.05, 2.5, 1.8, walnut, { pos: [0.9, 1.25, 0], parent: car });
  kit.box(1.8, 2.5, 0.05, walnut, { pos: [0, 1.25, -0.9], parent: car });
  kit.tube([[-0.8, 0.9, -0.85], [0.8, 0.9, -0.85]], 0.02, brass, { parent: car, seg: 4, radialSeg: 4 }); // handrail
  kit.box(1.4, 0.35, 0.5, kit.mat({ color: 0x5a1020, map: tex.carpet('diamond', [0x5a1020, 0x3a0a14]) }), { pos: [0, 0.2, -0.6], parent: car }); // velvet bench
  const bulb = kit.lamp({ r: 0.1, color: 0xfff2d0, shape: 'bulb' });
  bulb.root.position.set(0, 2.35, 0);
  car.add(bulb.root);
  const sw = kit.group('carSwitch');
  kit.cyl(0.1, 0.1, 0.03, brass, { rot: [90, 0, 0], parent: sw, seg: 10 });
  kit.box(0.02, 0.12, 0.02, brass, { pos: [0, 0.06, 0.03], parent: sw });
  sw.position.set(0.78, 1.3, 0.9);
  car.add(sw);
  root.add(car);

  // out-of-service chain and padlock across the opening
  const lock = kit.group('lock');
  for (let i = 0; i < 12; i++) {
    const x = -0.9 + i * 0.15;
    kit.torus(0.05, 0.012, kit.pal.steel, { pos: [x, 1.3, 0.14], rot: [0, 90, 0], parent: lock, seg: 6, tubeSeg: 3 });
  }
  kit.box(0.14, 0.12, 0.05, kit.pal.steel, { pos: [0, 1.25, 0.2], parent: lock });
  kit.torus(0.04, 0.012, kit.pal.steel, { pos: [0, 1.36, 0.2], parent: lock, seg: 6, tubeSeg: 3 });
  root.add(lock);

  // lit HOME sign above the transom (replaces the old OUT OF SERVICE plaque) and the DUE / PAID counter at the right-hand post
  // larger, tilted down toward the arrival point, on a dark backboard so the letters read from across the lobby
  kit.box(2.3, 0.78, 0.06, kit.mat({ color: 0x120c08 }), { pos: [0, LIFT_OPEN_H + 1.2, 0.2], rot: [14, 0, 0], parent: root });
  const neon = kit.neon({ text: { key: 'prop.sign.home' }, h: 0.6, color: 0xffd070, flicker: 0.03 });
  neon.root.position.set(0, LIFT_OPEN_H + 1.2, 0.27);
  neon.root.rotation.x = THREE.MathUtils.degToRad(14);
  neon.setOn(true);
  root.add(neon.root);
  const sign = neon.root;
  const counter = kit.screen({ w: 0.9, h: 0.38, px: [144, 60], bezel: 0x3a2a14, glow: 0.9 });
  counter.mesh.position.set(LIFT_OPEN_W / 2 + 1.25, 1.55, 0.2);
  root.add(counter.mesh);
  const paint = (q: { due: number; met: boolean } | null): void => {
    counter.draw((g, s) => {
      g.fillStyle = '#0d0906';
      g.fillRect(0, 0, s.w, s.h);
      const txt = q === null ? t('prop.sign.home') : q.met ? t('prop.lift.paid') : t('prop.lift.due', { n: Math.max(0, Math.ceil(q.due)) });
      const col = q === null ? '#ffd070' : q.met ? '#7dff7a' : '#ffb000';
      tex.drawText(g, txt, s.w / 2, 20, { font: 'px5', color: col, align: 'center', scale: 3 });
    });
  };
  paint(null);

  return {
    root, gateL, gateR, car, needle, lock, sign, neon, counter, paint,
    dispose() {
      counter.dispose();
      root.traverse((obj) => { const m = obj as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    },
  };
}

export class Elevator implements ElevatorProp {
  readonly id = 'elevator';
  readonly root: THREE.Group;
  private open_ = false;
  private readonly sched = new Sched();
  private needleDeg = -90;
  private needleTarget = -90;
  private counterAcc = 0;
  private counterKey = '';

  constructor(private readonly parts: ElevatorParts) {
    this.root = parts.root;
    this.applyGates(0);
    this.applyNeedle(-90);
  }

  get doorsOpen(): boolean { return this.open_; }

  /** Collapse both gate halves sideways (1.2 s) or close them. */
  doors(open: boolean, dur = 1.2): Promise<void> {
    this.open_ = open;
    const from = open ? 0 : 1, to = open ? 1 : 0;
    return this.sched.run(dur, (k) => this.applyGates(from + (to - from) * k), easeInOutCubic);
  }

  private applyGates(k: number): void {
    const s = 1 - k * 0.85; // 1 → 0.15 (scale.x) when open
    this.parts.gateL.scale.x = s;
    this.parts.gateR.scale.x = s;
    this.parts.gateL.position.x = -LIFT_OPEN_W / 4 * (1 - k * 0.8);
    this.parts.gateR.position.x = LIFT_OPEN_W / 4 * (1 - k * 0.8);
  }

  /** Cabin ride: 'up' lifts the car out of the top of the niche, 'down' drops it into the shaft to the Sump. */
  ride(dir: 'up' | 'down', dur = 4): Promise<void> {
    const car = this.parts.car;
    const y0 = car.position.y;
    const y1 = dir === 'up' ? 6 : -30;
    return this.sched.run(dur, (k) => { car.position.y = y0 + (y1 - y0) * k; }, easeInOutCubic);
  }

  /** Put the car back at the lobby level (after a ride, e.g. on Dawn). */
  resetCar(): void {
    this.parts.car.position.y = 0;
  }

  /** Floor dial needle: 1 = B7 (left), 8 = G (right). Values beyond the printed scale overshoot a little. */
  setFloor(n: number, animate = true): void {
    const deg = -90 + ((Math.min(Math.max(n, -1), 9) - 1) / 7) * 180;
    this.needleTarget = Math.max(-100, Math.min(100, deg));
    if (!animate) { this.needleDeg = this.needleTarget; this.applyNeedle(this.needleDeg); return; }
    const from = this.needleDeg;
    this.sched.run(0.6, (k) => { this.needleDeg = from + (this.needleTarget - from) * k; this.applyNeedle(this.needleDeg); }, easeOutQuad);
  }

  private applyNeedle(deg: number): void {
    this.parts.needle.rotation.z = -THREE.MathUtils.degToRad(deg);
  }

  /** Show or hide the chain across the doors. Padlock drop is instant here; animate in a cutscene if needed. */
  setLocked(on: boolean): void {
    this.parts.lock.visible = on;
  }

  update(dt: number): void {
    this.sched.update(dt);
    this.counterAcc -= dt;
    if (this.counterAcc > 0) return;
    this.counterAcc = 0.5;
    let q: { due: number; met: boolean } | null = null;
    try {
      const run = app.run;
      if (run && run.mode !== 'free') { const s = run.shift.quota(); q = { due: Math.max(0, s.due - s.deposited), met: s.met }; }
    } catch { q = null; }
    const key = q ? `${q.met ? 1 : 0}|${Math.ceil(q.due)}` : '-';
    if (key === this.counterKey) return;
    this.counterKey = key;
    this.parts.paint(q);
  }

  dispose(): void {
    this.sched.clear();
    this.parts.dispose();
  }
}

/** Factory used by level.ts. */
export function createElevator(kit: KitX, tex: TexGen, o: { pos: [number, number, number] }): Elevator {
  const parts = buildElevator(kit, tex);
  parts.root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  return new Elevator(parts);
}
