/**
 * Wall clock Ø 2.4 m at MOUTH-CLOCK (GDD §8.2, ART_BIBLE §6.6): brass case with sunburst rays, a plaster face with
 * roman numerals and a painted deadline wedge, a minute hand that shows shift progress and a red second hand that
 * ticks once per second. Faces +Z (south) when placed with rotY 0. Origin = face centre.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { ClockProp } from '../types';
import type { TexGen } from '@/core/texgen/types';
import { Sched } from './sched';

export const CLOCK_RADIUS = 1.2;
const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

export interface ClockParts {
  root: THREE.Group;
  /** Face plane (its material colour tints the whole face: red on last call). */
  face: THREE.Mesh;
  hourHand: THREE.Object3D;
  minuteHand: THREE.Object3D;
  secondHand: THREE.Object3D;
  /** Pivot of the tiny XIII (fades in on Night 8). */
  xiii: THREE.Mesh;
  dispose(): void;
}

const hand = (kit: KitX, len: number, w: number, color: number, parent: THREE.Object3D): THREE.Group => {
  const g = kit.group('hand');
  kit.box(w, len, 0.025, color, { pos: [0, len / 2, 0.09], parent: g });
  parent.add(g);
  return g;
};

/** Builds the face texture: plaster base, roman numerals, a P14 deadline wedge from 9 o'clock to 12. */
function faceTexture(tex: TexGen): THREE.Texture {
  return tex.canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#c9b48a';
    g.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, r = w / 2 - 6;
    // deadline wedge (9 → 12 o'clock), rust red
    g.fillStyle = 'rgba(160,30,30,0.55)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r, (-90 * Math.PI) / 180, 0);
    g.closePath();
    g.fill();
    // hour ticks and numerals
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = cx + Math.sin(a) * (r - 9), y = cy - Math.cos(a) * (r - 9);
      tex.drawText(g, ROMAN[i], x, y + 2, { font: 'px5', color: '#1a0f08', align: 'center' });
    }
    // tiny XIII squeezed between XII and I (drawn faint; the prop toggles its mesh for Night 8)
    tex.drawText(g, 'XIII', cx + 4, cy - r + 10, { font: 'px5', color: 'rgba(26,15,8,0.35)', align: 'left' });
    g.strokeStyle = '#2a1a10';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }, { wrap: 'clamp' });
}

export function buildClock(kit: KitX, o: { ceiling?: number } = {}): ClockParts {
  const R = CLOCK_RADIUS;
  const root = kit.group('clock');
  const brass = kit.pal.brass;

  // case: brass drum, ring bezel, twelve sunburst rays
  kit.cyl(R + 0.12, R + 0.12, 0.3, brass, { rot: [90, 0, 0], pos: [0, 0, -0.1], parent: root, seg: 16 });
  kit.torus(R + 0.06, 0.05, brass, { pos: [0, 0, 0.12], parent: root, seg: 16, tubeSeg: 4 });
  for (let i = 0; i < 12; i++) {
    const holder = kit.group('ray');
    kit.box(0.07, 0.25, 0.06, brass, { pos: [0, R + 0.2, 0.02], parent: holder });
    holder.rotation.z = -THREE.MathUtils.degToRad((i / 12) * 360);
    root.add(holder);
  }
  // two brass rods to the ceiling (`ceiling` = local y of the ceiling, origin = face centre)
  if (o.ceiling !== undefined && o.ceiling > R + 0.05) {
    const len = o.ceiling - R;
    for (const x of [-0.5, 0.5]) kit.cyl(0.02, 0.02, len, brass, { pos: [x, R + len / 2 - 0.1, -0.2], parent: root, seg: 6 });
  }

  const face = kit.plane(2 * R, 2 * R, { map: faceTexture(kit.tex), lit: false, fog: false }, { pos: [0, 0, 0.1], parent: root });
  const hourHand = hand(kit, R * 0.4, 0.06, 0x1a0f08, root);
  const minuteHand = hand(kit, R * 0.58, 0.04, 0x1a0f08, root);
  const secondHand = hand(kit, R * 0.62, 0.015, kit.pal.red, root);
  // counterweight on the second hand
  kit.box(0.04, 0.12, 0.03, kit.pal.red, { pos: [0, -0.08, 0.12], parent: secondHand });
  const xiii = kit.box(0.14, 0.05, 0.01, 0x1a0f08, { pos: [0, 0.6, 0.1], parent: root });
  xiii.visible = false;

  // hub
  kit.cyl(0.05, 0.05, 0.06, brass, { rot: [90, 0, 0], pos: [0, 0, 0.13], parent: root, seg: 8 });

  return {
    root, face, hourHand, minuteHand, secondHand, xiii,
    dispose() {
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };
}

/** Clock prop: shift progress on the minute hand, seconds on the second hand, alarm lamp and last-call tint. */
export class WallClock implements ClockProp {
  readonly id = 'clock';
  readonly root: THREE.Group;
  private readonly sched = new Sched();
  private progress = 0;
  private alarmOn = false;
  private t = 0;

  constructor(private readonly parts: ClockParts) {
    this.root = parts.root;
  }

  /** 0..1 progress of the shift; the minute hand makes one turn per shift, the hour hand one twelfth. */
  setProgress(frac: number): void {
    this.progress = Math.min(1, Math.max(0, frac));
    this.parts.minuteHand.rotation.z = -this.progress * Math.PI * 2;
    this.parts.hourHand.rotation.z = -this.progress * Math.PI / 6;
  }

  /** Seconds left on the deadline; the red second hand ticks, the face tints on last call. */
  setRemaining(sec: number, lastCall: boolean): void {
    const s = Math.max(0, Math.floor(sec));
    this.parts.secondHand.rotation.z = -((s % 60) / 60) * Math.PI * 2;
    const mat = this.parts.face.material as THREE.MeshBasicMaterial;
    if (mat?.color) mat.color.set(lastCall ? 0xff9a8a : 0xffffff);
  }

  /** Alarm: the second hand chatters sideways while on. */
  alarm(on: boolean): void {
    this.alarmOn = on;
  }

  /** Night 8 reveal: the tiny XIII between XII and I. Visibility only, cheap. */
  showXIII(on: boolean): void {
    this.parts.xiii.visible = on;
  }

  update(dt: number): void {
    this.t += dt;
    this.sched.update(dt);
    this.parts.secondHand.position.x = this.alarmOn ? Math.sin(this.t * 60) * 0.004 : 0;
  }

  dispose(): void {
    this.sched.clear();
    this.parts.dispose();
  }
}

/** Factory used by level.ts. */
export function createClock(kit: KitX, o: { pos: [number, number, number]; ceiling?: number }): WallClock {
  const parts = buildClock(kit, { ceiling: o.ceiling });
  parts.root.position.set(o.pos[0], o.pos[1], o.pos[2]);
  return new WallClock(parts);
}
