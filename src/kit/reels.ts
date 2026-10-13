/**
 * Gambling wheels: `reel` (slot drum; N symbol faces on a cylinder, axis X, payline at +Z) and `wheel` (roulette /
 * Big Six style disc with painted segments, optional pegs and pockets). Both pivot on their axis and expose
 * `angleOf(i)` so a machine can land any segment on the pointer; `stopAt` / `spinTo` ease into the target with a
 * small bounce on the kit clock (promise always resolves).
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import type { SymbolId } from '@/core/texgen/types';
import { ease } from '@/core/tween';
import { psx } from './materials';
import { bakeShade } from './geo';
import { keep, part, type KitCtx } from './ctx';
import { finalizeModel } from './finalize';
import { css, PAL } from './palette';
import type { Kit, ReelPart, TextSource, WheelPart } from './types';

const TAU = Math.PI * 2;

// ── reel ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Drum geometry: slot k covers the arc centred on angle k·2π/N (measured from +Z, towards +Y). Its texture cell
 * runs bottom → top along the arc (v) and left → right across the width (u), so symbols read upright at the payline.
 */
function drumGeometry(radius: number, width: number, n: number, cellV: number): THREE.BufferGeometry {
  const P: number[] = [], UV: number[] = [], N: number[] = [], I: number[] = [];
  const half = Math.PI / n;
  for (let k = 0; k < n; k++) {
    const t0 = k * (TAU / n) - half, t1 = k * (TAU / n) + half;
    const vTop = 1 - k * cellV, vBot = 1 - (k + 1) * cellV;
    const base = P.length / 3;
    const corners: Array<[number, number, number, number]> = [          // x, θ, u, v
      [-width / 2, t0, 0, vBot], [width / 2, t0, 1, vBot], [width / 2, t1, 1, vTop], [-width / 2, t1, 0, vTop],
    ];
    for (const [x, t, u, v] of corners) {
      P.push(x, radius * Math.sin(t), radius * Math.cos(t));
      N.push(0, Math.sin(t), Math.cos(t));
      UV.push(u, v);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  return g;
}

export function makeReel(ctx: KitCtx, o: { radius: number; width: number; symbols: SymbolId[]; cell?: number }): ReelPart {
  const n = Math.max(1, o.symbols.length);
  const { tex, cellV } = ctx.tex.symbolStrip(o.symbols, o.cell ?? 32);
  const root = new THREE.Group();
  root.name = 'reel';
  const drum = new THREE.Mesh(drumGeometry(o.radius, o.width, n, cellV), psx({ map: tex, lit: true, affine: true, unique: true }));
  drum.name = 'drum';
  keep(drum);
  root.add(drum);
  // dark core and flanges so the drum reads as a physical cylinder from the cabinet window
  const core = ctx.P.cyl(o.radius * 0.92, o.radius * 0.92, o.width, ctx.M.enamel(PAL.PIT_BLACK, 0.2), {
    rot: [0, 0, 90], seg: 12, shade: true, parent: root,
  });
  core.name = 'drum_core';
  for (const s of [-1, 1]) {
    ctx.P.cyl(o.radius * 1.04, o.radius * 1.04, 0.006, ctx.M.chrome(), { rot: [0, 0, 90], pos: [s * (o.width / 2 + 0.003), 0, 0], seg: 16, parent: root });
  }
  part(root);                                   // core + flanges are rotation-symmetric: merged into the model

  const step = TAU / n;
  const angleOf = (index: number): number => ((((index % n) + n) % n) * step);
  let spinRate = 0, stopGen = 0, stopToken: object = {};
  ctx.anim.tick(root, (dt) => {
    if (spinRate !== 0) root.rotation.x += spinRate * dt * TAU;
  });

  return {
    root, drum, count: n,
    angleOf,
    setIndex(index) { spinRate = 0; root.rotation.x = angleOf(index); },
    startSpin(speed) { spinRate = speed; stopGen++; ctx.anim.cancel(stopToken); },
    stopAt(index, dur, bounce = 0.12) {
      spinRate = 0;
      ctx.anim.cancel(stopToken);
      stopToken = {};
      const my = ++stopGen;
      const a0 = root.rotation.x;
      const fwd = ((angleOf(index) - a0) % TAU + TAU) % TAU;
      const target = a0 + fwd + (dur > 0.4 ? TAU : 0);          // one extra turn when the stop is long
      return ctx.anim.run(dur, (k) => {
        // overshoot past the stop in the first 75 %, then settle back onto it
        const over = target + bounce * step;
        root.rotation.x = k < 0.75 ? a0 + (over - a0) * ease.outCubic(k / 0.75) : over + (target - over) * ease.inOutCubic((k - 0.75) / 0.25);
      }, { owner: stopToken }).then(() => { if (stopGen === my) root.rotation.x = target; });
    },
  };
}

// ── wheel ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Disc geometry is canonical: cap normal +Y, pointer at +Z, spins about its own Y. The root orients it:
 * 'horizontal' = lies flat (roulette, spins about world Y, pointer at the front rim); 'vertical' = stands facing
 * the player (spins about world Z, pointer at the top). Everything that spins is one kept `disc` group holding the
 * painted face plus ONE merged fixtures mesh (pocket dividers and pegs); `pegs[i]` are marker nodes at the peg tips
 * (for collision / flapper logic), not meshes.
 */
export function makeWheel(ctx: KitCtx, o: {
  radius: number; segments: Array<{ label: TextSource; color: Hex }>; axis: 'vertical' | 'horizontal';
  pegs?: boolean; pocketed?: boolean; hub?: Hex;
}): WheelPart {
  const n = Math.max(1, o.segments.length);
  const R = o.radius;
  const root = new THREE.Group();
  root.name = 'wheel';
  part(root);
  if (o.axis === 'vertical') root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 1).normalize(), Math.PI);
  const disc = new THREE.Group();
  disc.name = 'disc';
  keep(disc);
  root.add(disc);

  // ── face texture (repainted on language change) ──
  const px = R > 0.3 ? 256 : 128;
  const face = ctx.tex.canvas(px, px, () => {}, { wrap: 'clamp' });
  const g = (face.image as HTMLCanvasElement).getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const scale = px >= 256 ? 2 : 1;
  const centre = px / 2, rad = px / 2 - 1;
  const paint = (): void => {
    g.clearRect(0, 0, px, px);
    o.segments.forEach((s, i) => {
      const a = (i / n) * TAU, b = ((i + 1) / n) * TAU;
      // canonical angle θ ↦ canvas angle −θ (see the cap UV convention in three's CylinderGeometry)
      g.fillStyle = css(s.color);
      g.beginPath(); g.moveTo(centre, centre); g.arc(centre, centre, rad, -b, -a, false); g.closePath(); g.fill();
    });
    o.segments.forEach((s, i) => {
      const mid = -((i + 0.5) / n) * TAU;
      const text = ctx.text.resolve(s.label);
      if (!text) return;
      g.save();
      g.translate(centre + Math.cos(mid) * rad * 0.66, centre + Math.sin(mid) * rad * 0.66);
      g.rotate(mid);
      ctx.tex.drawText(g, text, 0, 0, { font: 'px5', scale, color: '#f7efde', align: 'center', outline: '#101019' });
      g.restore();
    });
    face.needsUpdate = true;
  };
  ctx.text.watch(face, paint);

  // ── disc body ──
  const thick = Math.max(0.012, R * 0.05);
  const geo = new THREE.CylinderGeometry(R, R, thick, Math.max(24, n * 2), 1);
  bakeShade(geo, { top: 1, bottom: 0.8 });
  const capMat = psx({ map: face, vertexColors: true, unique: true });
  const rimMat = ctx.M.enamel(PAL.BONE, 0.2);
  // two meshes (face, rim) instead of a 3-group multi-material mesh: one draw call less
  const pick = (groups: number[]): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.getAttribute(k));
    const idx = geo.getIndex()!;
    const out: number[] = [];
    for (const gi of groups) { const gr = geo.groups[gi]; for (let i = gr.start; i < gr.start + gr.count; i++) out.push(idx.getX(i)); }
    g.setIndex(out);
    return g;
  };
  const faceMesh = new THREE.Mesh(pick([1]), capMat);
  faceMesh.name = 'face';
  faceMesh.position.y = thick / 2;
  const rimMesh = new THREE.Mesh(pick([0, 2]), rimMat);
  rimMesh.name = 'rim';
  rimMesh.position.y = thick / 2;
  disc.add(faceMesh, rimMesh);

  // hub never changes its look while spinning → hoisted into the static model
  ctx.P.cyl(R * 0.12, R * 0.14, 0.03, o.hub !== undefined ? psx({ color: o.hub, vertexColors: true }) : ctx.M.gold(), { pos: [0, thick + 0.012, 0], seg: 10, parent: root, name: 'hub' });

  // pocket dividers and pegs: built as loose meshes, merged into one fixtures mesh that spins with the disc
  const fix = new THREE.Group();
  fix.name = 'fixtures';
  fix.userData.noAO = true;
  if (o.pocketed) {
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      ctx.P.box(R * 0.2, 0.012, 0.004, ctx.M.chrome(), {
        pos: [Math.sin(th) * R * 0.88, thick + 0.006, Math.cos(th) * R * 0.88], rot: [0, ((th - Math.PI / 2) * 180) / Math.PI, 0], parent: fix, name: 'pocket',
      });
    }
  }
  const pegs: THREE.Object3D[] = [];
  if (o.pegs) {
    const count = Math.max(8, Math.min(n * 2, 48));
    const peg = ctx.M.brass();
    for (let i = 0; i < count; i++) {
      const th = ((i + 0.5) / count) * TAU;
      const x = Math.sin(th) * R * 0.95, z = Math.cos(th) * R * 0.95;
      ctx.P.cyl(R * 0.02, R * 0.02, 0.02, peg, { pos: [x, thick + 0.01, z], seg: 6, parent: fix, name: 'peg' });
      const marker = new THREE.Object3D();
      marker.name = 'peg_marker';
      marker.position.set(x, thick + 0.02, z);
      disc.add(marker);
      pegs.push(marker);
    }
  }
  if (fix.children.length) { finalizeModel(fix); disc.add(fix); }

  const angleOf = (i: number): number => -(((i + 0.5) / n) * TAU);
  let spinGen = 0;
  return {
    root, disc, pegs,
    angleOf(i) { return angleOf(((i % n) + n) % n); },
    spinTo(i, turns, dur) {
      const a0 = disc.rotation.y;
      const target0 = angleOf(((i % n) + n) % n);
      const fwd = ((target0 - a0) % TAU + TAU) % TAU;
      const target = a0 + fwd + turns * TAU;
      ctx.anim.cancel(disc);
      const my = ++spinGen;
      return ctx.anim.run(dur, (k) => { disc.rotation.y = a0 + (target - a0) * ease.outCubic(k); }, { owner: disc })
        .then(() => { if (spinGen === my) disc.rotation.y = target; });
    },
  };
}

export function makeReelAndWheel(ctx: KitCtx): Pick<Kit, 'reel' | 'wheel'> {
  return {
    reel: (o) => makeReel(ctx, o),
    wheel: (o) => makeWheel(ctx, o),
  };
}
