/**
 * Wall clock Ø 2.4 m at MOUTH-CLOCK (GDD §8.2, ART_BIBLE §6.6): brass case with sunburst rays, a round cream dial with
 * 60 ticks, 12 Roman numerals and a red deadline band on the rim (9 to 12 o'clock), cut hands (hour, minute, red second)
 * standing in front of the face, a minute hand that shows shift progress and a red second hand that ticks once per
 * second. Faces +Z (south) when placed with rotY 0. Origin = face centre.
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
  /** The tiny XIII label inside the ring (shown on Night 8). */
  xiii: THREE.Mesh;
  dispose(): void;
}

/** A flat hand cut from a polygon (x across, y along the hand; the pivot is the origin), `z0` in front of the face. */
const hand = (kit: KitX, shape: Array<[number, number]>, z0: number, depth: number, color: number, parent: THREE.Object3D): THREE.Group => {
  const g = kit.group('hand');
  kit.extrude(shape, depth, color, { pos: [0, 0, z0], parent: g });
  parent.add(g);
  return g;
};

/**
 * The dial: a cream disc (the rest of the square is transparent, the plane alpha-tests it), a rim, 60 ticks and 12 Roman numerals on
 * two rings (cardinals bigger), and the deadline band, a red arc along the rim from 9 to 12 o'clock (the last quarter of the shift,
 * where the minute hand ends). No XIII here: Night 8 shows the little XIII label inside the ring (see `buildClock`).
 */
function faceTexture(tex: TexGen): THREE.Texture {
  return tex.canvas(256, 256, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const disc = (r: number, col: string): void => { g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
    disc(127, '#2a1a10');
    disc(124, '#e2d2a8');
    // ticks: pixel by pixel along the radius so the edges stay hard
    g.fillStyle = '#2a1a10';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0, sz = big ? 3 : 2;
      for (let r = big ? 115 : 118; r <= 121; r++) g.fillRect(Math.round(cx + Math.sin(a) * r - sz / 2), Math.round(cy - Math.cos(a) * r - sz / 2), sz, sz);
    }
    // deadline band, 9 -> 12 o'clock (canvas angle runs clockwise from 3 o'clock)
    g.fillStyle = '#a82424';
    for (let a = Math.PI; a <= Math.PI * 1.5; a += 0.006) {
      g.fillRect(Math.round(cx + Math.cos(a) * 111 - 2), Math.round(cy + Math.sin(a) * 111 - 2), 4, 4);
    }
    // numerals: scale 3 on XII III VI IX, scale 2 on the rest; (x, y) is the glyph centre, y -> cap top
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, card = i % 3 === 0, sc = card ? 3 : 2, r = card ? 78 : 82;
      tex.drawText(g, ROMAN[i], Math.round(cx + Math.sin(a) * r), Math.round(cy - Math.cos(a) * r - (7 * sc) / 2), { font: 'px5', color: '#1a0f08', align: 'center', scale: sc });
    }
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
  // two brass rods to the ceiling (`ceiling` = local y of the ceiling, origin = face centre); they stood at z -0.2, inside the wall, so they never showed
  if (o.ceiling !== undefined && o.ceiling > R + 0.05) {
    const y0 = R - 0.1, len = o.ceiling - y0;   // from inside the case top up to the ceiling plane
    for (const x of [-0.5, 0.5]) kit.cyl(0.02, 0.02, len, brass, { pos: [x, y0 + len / 2, -0.02], parent: root, seg: 6 });
  }

  // the face plane alpha-tests the round dial out of its square; everything on it stands in front (hour < minute < second < hub)
  const face = kit.plane(2 * R, 2 * R, { map: faceTexture(kit.tex), lit: false, fog: false, alphaTest: 0.5 }, { pos: [0, 0, 0.1], parent: root, shade: false });
  const L = R;
  const hourHand = hand(kit, [[0, -0.14], [-0.05, 0], [-0.04, L * 0.3], [-0.075, L * 0.38], [0, L * 0.58], [0.075, L * 0.38], [0.04, L * 0.3], [0.05, 0]], 0.108, 0.02, 0x1a0f08, root);
  const minuteHand = hand(kit, [[0, -0.16], [-0.03, 0], [-0.018, L * 0.7], [0, L * 0.86], [0.018, L * 0.7], [0.03, 0]], 0.132, 0.02, 0x1a0f08, root);
  const secondHand = hand(kit, [[-0.008, -0.22], [-0.008, L * 0.9], [0.008, L * 0.9], [0.008, -0.22]], 0.156, 0.01, kit.pal.red, root);
  // counterweight disc on the second hand's tail
  kit.cyl(0.035, 0.035, 0.012, kit.pal.red, { rot: [90, 0, 0], pos: [0, -0.16, 0.161], parent: secondHand, seg: 8 });
  // the tiny XIII: tucked inside the ring between XII and I, shown on Night 8
  const xiii = kit.label({ text: 'XIII', w: 0.2, h: 0.09, px: [48, 22], color: 0x8a1a14, bg: null, font: 'px5' }).mesh;   // i18n-ok: a Roman numeral, not prose
  xiii.position.set(Math.sin(Math.PI / 12) * 0.56, Math.cos(Math.PI / 12) * 0.56, 0.104);
  xiii.rotation.z = -Math.PI / 12;
  root.add(xiii);
  xiii.visible = false;

  // hub
  kit.cyl(0.05, 0.05, 0.04, brass, { rot: [90, 0, 0], pos: [0, 0, 0.17], parent: root, seg: 8 });

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
