/**
 * Emissive light parts (no THREE.Light anywhere): lamp, chaser bulb chains, additive glow sprites, blob
 * shadows. Bulb patterns follow ART_BIBLE §9.4 (CHASE / MARCH / FILL / COMET / TWINKLE / ALL_FLASH / RAINBOW);
 * lit = colour × 1.0, unlit = colour × 0.25, 2–5 % of bulbs per chain are dead (seeded, always unlit).
 */
import * as THREE from 'three';
import type { Hex, V3 } from '@/core/types';
import { createRng } from '@/core/rng';
import { psx } from './materials';
import { keep, part, type KitCtx } from './ctx';
import { scaleHex } from './palette';
import type { BulbChain, Kit, LampPart } from './types';

export type BulbPattern = 'chase' | 'alt' | 'blink' | 'rainbow' | 'all' | 'off' | 'march' | 'comet' | 'fill' | 'twinkle';
const RAINBOW: Hex[] = [0xffce5a, 0xef5a4a, 0xff42a5, 0x63e6de, 0x5aff7b];
const DEFAULT_HZ: Record<BulbPattern, number> = { chase: 10, alt: 3, blink: 2, rainbow: 12, all: 1, off: 1, march: 8, comet: 14, fill: 1, twinkle: 10 };

/** `count` points evenly spaced along a polyline (open) or a closed loop. */
export function spread(points: V3[], count: number, closed: boolean): V3[] {
  const pts = closed ? [...points, points[0]] : points;
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); seg.push(l); total += l; }
  const out: V3[] = [];
  const step = closed ? total / count : total / Math.max(1, count - 1);
  for (let n = 0; n < count; n++) {
    let d = n * step, i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const k = seg[i] > 0 ? Math.min(1, d / seg[i]) : 0;
    const a = pts[i], b = pts[i + 1] ?? pts[i];
    out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
  }
  return out;
}
/** Rectangle perimeter (XY plane, centred) starting bottom-left going up — i.e. clockwise seen from +Z. */
export const rectLoop = (w: number, h: number, z = 0): V3[] => [[-w / 2, -h / 2, z], [-w / 2, h / 2, z], [w / 2, h / 2, z], [w / 2, -h / 2, z]];

export interface BulbChainImpl extends BulbChain { setPattern(p: BulbPattern, hz?: number): void }

export function createBulbChain(ctx: KitCtx, positions: V3[], colors: Hex[], r: number, seed = 1, shape?: THREE.BufferGeometry): BulbChainImpl {
  const n = positions.length;
  const geo = shape ?? new THREE.OctahedronGeometry(r, 0);
  const mat = psx({ color: 0xffffff, lit: false, snap: true });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'bulbs';
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m4.makeTranslation(positions[i][0], positions[i][1], positions[i][2]));
  mesh.userData.chase = Array.from({ length: n }, (_, i) => i);
  keep(mesh);

  const rng = createRng(seed);
  const dead = new Uint8Array(n);
  for (let i = 0; i < n; i++) dead[i] = rng.chance(0.03) ? 1 : 0;
  const base = positions.map((_, i) => colors[i % colors.length] ?? 0xffce5a);
  const override: Array<Hex | null> = new Array(n).fill(null);
  const level = new Float32Array(n);
  const arr = mesh.instanceColor.array as Float32Array;
  let pat: BulbPattern = 'off', hz = 1, lastStep = -1;
  const tmp = new THREE.Color();

  /** Recolour every bulb; the GPU upload is queued only when at least one bulb actually changed. */
  const paint = (): void => {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let c = base[i], k = dead[i] ? 0 : level[i];
      if (pat === 'rainbow' && !dead[i]) c = RAINBOW[(i + Math.floor(ctx.anim.time * hz)) % RAINBOW.length];
      if (override[i] !== null) { c = override[i] as Hex; k = 1; }
      tmp.setHex(c);
      const f = 0.25 + 0.75 * k;
      const r = tmp.r * f, g = tmp.g * f, b = tmp.b * f;
      if (arr[i * 3] !== r || arr[i * 3 + 1] !== g || arr[i * 3 + 2] !== b) {
        changed = true;
        arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b;
      }
    }
    if (changed) (mesh.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
  };

  const compute = (step: number, t: number): void => {
    switch (pat) {
      case 'all': level.fill(1); break;
      case 'off': level.fill(0); break;
      case 'blink': level.fill(Math.floor(t * hz * 2) % 2 === 0 ? 1 : 0); break;
      case 'alt': { const ph = Math.floor(t * hz * 2) % 2; for (let i = 0; i < n; i++) level[i] = (i + ph) % 2 === 0 ? 1 : 0; break; }
      case 'chase': for (let i = 0; i < n; i++) level[i] = (((i - step) % 3) + 3) % 3 === 0 ? 1 : 0; break;
      case 'march': for (let i = 0; i < n; i++) level[i] = (((i - step) % 4) + 4) % 4 < 2 ? 1 : 0; break;
      case 'rainbow': level.fill(1); break;
      case 'comet': {
        const tail = [1, 0.75, 0.5, 0.25, 0.12];
        level.fill(0);
        for (let j = 0; j < tail.length; j++) level[(((step - j) % n) + n) % n] = tail[j];
        break;
      }
      case 'fill': {                                          // fill around, then empty around (hz = bulbs per second)
        const ph = step % (2 * n);
        for (let i = 0; i < n; i++) level[i] = ph < n ? (i <= ph ? 1 : 0) : (i > ph - n ? 1 : 0);
        break;
      }
      case 'twinkle': for (let i = 0; i < n; i++) if (rng.chance(0.15)) level[i] = level[i] > 0.5 ? 0 : 1; break;
    }
  };

  const setPattern = (p: BulbPattern, h?: number): void => {
    pat = p; hz = h && h > 0 ? h : p === 'fill' ? n : DEFAULT_HZ[p]; lastStep = -1;
    compute(0, ctx.anim.time);
    paint();
  };
  ctx.anim.tick(mesh, (_dt, t) => {
    if (pat === 'all' || pat === 'off') { if (lastStep !== -2) { lastStep = -2; compute(0, t); paint(); } return; }
    const rate = pat === 'blink' || pat === 'alt' ? hz * 2 : hz;
    const step = Math.floor(t * rate);
    if (step === lastStep) return;
    lastStep = step;
    compute(step, t);
    paint();
  });
  setPattern('off');

  return {
    root: mesh,
    pattern: (p, h) => setPattern(p, h),
    setPattern,
    setBulb(i, c) { if (i >= 0 && i < n) { override[i] = c; paint(); } },
  };
}

export function makeLights(ctx: KitCtx): Pick<Kit, 'lamp' | 'bulbChain' | 'glow' | 'blobShadow'> {
  const { P, M } = ctx;

  return {
    glow(o) {
      const s = new THREE.Sprite(ctx.glowMat(o.color, o.intensity ?? 1));
      s.scale.set(o.size, o.size, 1);
      s.name = 'glow';
      return s;
    },

    blobShadow(w, d, opacity = 0.35) {
      const g = new THREE.CircleGeometry(0.5, 8);
      g.rotateX(-Math.PI / 2);
      const m = psx({ color: 0x101019, lit: false, transparent: true, opacity, depthWrite: false, fog: true }) as THREE.MeshBasicMaterial;
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      const me = new THREE.Mesh(g, m);
      me.scale.set(w, 1, d);
      me.position.y = 0.004;
      me.renderOrder = 1;
      me.name = 'blob_shadow';
      return me;
    },

    bulbChain(o) {
      const closed = !Array.isArray(o.path);
      const pts = Array.isArray(o.path) ? o.path : rectLoop(o.path.rect[0], o.path.rect[1]);
      return createBulbChain(ctx, spread(pts, o.count, closed), o.colors.length ? o.colors : [0xffce5a], o.r ?? 0.012, o.count * 31 + 7);
    },

    lamp(o): LampPart {
      const root = P.group('lamp');
      const r = o.r;
      const shape = o.shape ?? 'dome';
      const cover = psx({ color: o.color, lit: false, unique: true }) as THREE.MeshBasicMaterial;
      let on = false, baseOn = false, color = o.color;
      let blinkHz = 0, blinkUntil = 0;
      // housing
      if (shape === 'flat') {
        P.cyl(r * 1.12, r * 1.18, 0.012, M.chrome(), { pos: [0, 0.006, 0], seg: 10, parent: root });
        const face = P.cyl(r, r, 0.008, cover, { pos: [0, 0.014, 0], seg: 10, shade: false, parent: root });
        face.userData.kitKeep = true;
      } else {
        P.cyl(r * 1.15, r * 1.25, r * 0.3, M.chrome(), { pos: [0, r * 0.15, 0], seg: 10, parent: root });
        const cap = shape === 'dome'
          ? P.sphere(r, cover, { pos: [0, r * 0.3, 0], hemi: true, wSeg: 10, hSeg: 5, shade: false, parent: root })
          : P.sphere(r * 0.9, cover, { pos: [0, r * 1.05, 0], wSeg: 8, hSeg: 6, shade: false, parent: root });
        cap.userData.kitKeep = true;
      }
      const halo = new THREE.Sprite(ctx.glowMat(color, 0.7));
      halo.scale.set(r * 7, r * 7, 1);
      halo.position.y = shape === 'flat' ? 0.03 : r * 0.9;
      halo.visible = false;
      root.add(halo);
      part(root);

      const apply = (v: boolean): void => {
        on = v;
        cover.color.setHex(v ? color : scaleHex(color, 0.2));
        halo.visible = v;
      };
      const stopBlink = (): void => { blinkHz = 0; };
      apply(false);
      ctx.anim.tick(root, (_dt, t) => {
        if (blinkHz <= 0) return;
        if (blinkUntil > 0 && t >= blinkUntil) { stopBlink(); apply(baseOn); return; }
        const v = Math.floor(t * blinkHz * 2) % 2 === 0;
        if (v !== on) apply(v);
      });
      return {
        root,
        setOn(v) { baseOn = v; stopBlink(); apply(v); },
        setColor(c) { color = c; halo.material = ctx.glowMat(c, 0.7); apply(on); },
        blink(hz, dur) { blinkHz = hz; blinkUntil = dur && dur > 0 ? ctx.anim.time + dur : 0; },
      };
    },
  };
}
