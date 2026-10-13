/**
 * `kit.totem({ shape, color, radius })` — the physical radius items of BRIEF Addendum 8 (≈ 0.45 m tall, carried in
 * hand, placed on the floor): a small carved model on a stepped base, an emissive glow that follows `setActive`, and a
 * floor ring that shows the effect radius (additive, dithered fill, rotating dashes, rim that pulses on a proc).
 *
 * Shapes are open: ids the kit knows get a dedicated model, any other id is hashed onto one of them, so every
 * `TotemDef.shape` renders something distinct and plausible.
 *   idol ward bell lantern hourglass coin eye skull horseshoe mirror magnet dice candle key moth tooth compass
 */
import * as THREE from 'three';
import type { Hex } from '@/core/types';
import { ease } from '@/core/tween';
import { psx } from './materials';
import { finalizeModel } from './finalize';
import { PAL, mixHex, scaleHex } from './palette';
import { keep, part, type KitCtx } from './ctx';
import type { Kit, TotemPart } from './types';

const TAU = Math.PI * 2;
const SHAPES = ['idol', 'ward', 'bell', 'lantern', 'hourglass', 'coin', 'eye', 'skull', 'horseshoe', 'mirror', 'magnet', 'dice', 'candle', 'key', 'moth', 'tooth', 'compass'] as const;
const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export function makeTotems(ctx: KitCtx): Pick<Kit, 'totem'> {
  const { P, M, tex } = ctx;

  /** 64×64 white-on-transparent ring: bright rim, tick dashes, dithered fill. */
  const ringTex = (): THREE.Texture => tex.canvas(64, 64, (g) => {
    const id = g.createImageData(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx = x - 31.5, dy = y - 31.5, r = Math.hypot(dx, dy) / 32, a = Math.atan2(dy, dx);
      let alpha = 0;
      if (r > 0.9 && r <= 1) alpha = 1;
      else if (r > 0.8 && r <= 0.9 && Math.floor(((a + Math.PI) / TAU) * 24) % 2 === 0) alpha = 0.9;
      else if (r <= 0.9 && ((x + y) & 1) === 0) alpha = r > 0.6 ? 0.2 : 0.1;
      const p = (y * 64 + x) * 4;
      id.data[p] = id.data[p + 1] = id.data[p + 2] = 255;
      id.data[p + 3] = Math.round(alpha * 255);
    }
    g.putImageData(id, 0, 0);
  }, { key: 'kit:totem:ring', wrap: 'clamp' });

  const totem: Kit['totem'] = (o): TotemPart => {
    const root = part(P.group('totem'));
    const color = o.color;
    const dim = scaleHex(color, 0.28);
    const glowMat = psx({ color: dim, lit: false, unique: true }) as THREE.MeshBasicMaterial;
    const glowDim = dim, glowLit = mixHex(color, 0xffffff, 0.25);
    const stone = M.enamel(mixHex(PAL.CONCRETE, color, 0.12), 0.55);
    const trim = M.brass();
    const model = new THREE.Group();
    model.name = 'totem_model';
    model.position.y = 0.05;
    root.add(model);

    // stepped base
    P.cyl(0.13, 0.15, 0.03, stone, { pos: [0, 0.015, 0], seg: 8, parent: root });
    P.cyl(0.1, 0.12, 0.025, trim, { pos: [0, 0.042, 0], seg: 8, parent: root });

    const shape = (SHAPES as readonly string[]).includes(o.shape) ? o.shape : SHAPES[hash(o.shape) % SHAPES.length];
    const at = (y: number): [number, number, number] => [0, y, 0];
    switch (shape) {
      case 'ward':
        P.cyl(0.001, 0.07, 0.34, stone, { pos: at(0.17), seg: 4, parent: model });
        P.box(0.018, 0.12, 0.012, glowMat, { pos: [0, 0.16, 0.052], shade: false, parent: model });
        P.box(0.07, 0.014, 0.012, glowMat, { pos: [0, 0.2, 0.046], shade: false, parent: model });
        break;
      case 'bell':
        P.lathe([[0.1, 0.0], [0.09, 0.05], [0.06, 0.14], [0.03, 0.2], [0.0, 0.21]], 8, trim, { parent: model });
        P.sphere(0.022, glowMat, { pos: at(0.015), wSeg: 6, hSeg: 4, shade: false, parent: model });
        P.torus(0.025, 0.006, trim, { pos: at(0.23), seg: 8, tubeSeg: 3, parent: model });
        break;
      case 'lantern':
        P.cyl(0.07, 0.08, 0.02, trim, { pos: at(0.01), seg: 6, parent: model });
        P.cyl(0.05, 0.05, 0.2, glowMat, { pos: at(0.12), seg: 6, shade: false, parent: model });
        P.cyl(0.001, 0.09, 0.06, trim, { pos: at(0.25), seg: 6, parent: model });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; P.cyl(0.006, 0.006, 0.2, trim, { pos: [Math.cos(a) * 0.055, 0.12, Math.sin(a) * 0.055], seg: 4, parent: model }); }
        break;
      case 'hourglass':
        for (const y of [0.0, 0.3]) P.cyl(0.07, 0.07, 0.02, trim, { pos: at(y + 0.01), seg: 6, parent: model });
        P.cyl(0.06, 0.008, 0.13, glowMat, { pos: at(0.095), seg: 6, shade: false, parent: model });
        P.cyl(0.008, 0.06, 0.13, glowMat, { pos: at(0.225), seg: 6, shade: false, parent: model });
        for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; P.cyl(0.007, 0.007, 0.3, trim, { pos: [Math.cos(a) * 0.065, 0.16, Math.sin(a) * 0.065], seg: 4, parent: model }); }
        break;
      case 'coin':
        P.cyl(0.1, 0.1, 0.02, M.gold(), { pos: at(0.18), rot: [90, 0, 0], seg: 12, parent: model });
        P.cyl(0.07, 0.07, 0.024, glowMat, { pos: at(0.18), rot: [90, 0, 0], seg: 10, shade: false, parent: model });
        P.box(0.04, 0.16, 0.03, stone, { pos: at(0.08), parent: model });
        break;
      case 'eye':
        P.sphere(0.1, M.porcelain(), { pos: at(0.16), wSeg: 8, hSeg: 6, parent: model });
        P.sphere(0.05, glowMat, { pos: [0, 0.16, 0.07], wSeg: 6, hSeg: 4, hemi: true, rot: [90, 0, 0], shade: false, parent: model });
        P.sphere(0.022, M.rubber(), { pos: [0, 0.16, 0.115], wSeg: 5, hSeg: 3, parent: model });
        P.cyl(0.03, 0.05, 0.07, stone, { pos: at(0.035), seg: 6, parent: model });
        break;
      case 'skull':
        P.sphere(0.09, M.bone(), { pos: at(0.17), wSeg: 8, hSeg: 6, parent: model });
        P.box(0.08, 0.05, 0.07, M.bone(), { pos: [0, 0.095, 0.02], parent: model });
        for (const s of [-1, 1]) P.sphere(0.022, glowMat, { pos: [s * 0.035, 0.17, 0.07], wSeg: 5, hSeg: 4, shade: false, parent: model });
        break;
      case 'horseshoe': {
        const pts: Array<[number, number, number]> = [];
        for (let i = 0; i <= 8; i++) { const a = -Math.PI * 0.35 + (i / 8) * Math.PI * 1.7; pts.push([Math.cos(a) * 0.09, 0.2 + Math.sin(a) * 0.09, 0]); }
        P.tube(pts, 0.016, M.chrome(), { seg: 12, radialSeg: 5, parent: model });
        P.sphere(0.02, glowMat, { pos: [0, 0.2, 0.0], wSeg: 5, hSeg: 4, shade: false, parent: model });
        P.cyl(0.02, 0.03, 0.1, stone, { pos: at(0.05), seg: 6, parent: model });
        break;
      }
      case 'mirror':
        P.cyl(0.09, 0.09, 0.016, M.gold(), { pos: at(0.2), rot: [90, 0, 0], seg: 10, parent: model });
        P.cyl(0.075, 0.075, 0.02, glowMat, { pos: at(0.2), rot: [90, 0, 0], seg: 10, shade: false, parent: model });
        P.cyl(0.015, 0.02, 0.1, stone, { pos: at(0.05), seg: 6, parent: model });
        break;
      case 'magnet':
        P.torus(0.07, 0.025, M.rust(), { pos: at(0.18), rot: [0, 0, 0], seg: 8, tubeSeg: 5, arc: Math.PI, parent: model });
        for (const s of [-1, 1]) P.box(0.05, 0.05, 0.05, glowMat, { pos: [s * 0.07, 0.115, 0], shade: false, parent: model });
        break;
      case 'dice':
        P.box(0.15, 0.15, 0.15, M.porcelain(), { bevel: 0.02, pos: at(0.1), rot: [18, 34, 0], parent: model });
        for (const s of [-1, 0, 1]) P.sphere(0.014, glowMat, { pos: [s * 0.04, 0.1 + s * 0.04, 0.083], wSeg: 5, hSeg: 4, shade: false, rot: [18, 34, 0], parent: model });
        break;
      case 'candle':
        P.cyl(0.04, 0.045, 0.2, M.paper(), { pos: at(0.1), seg: 8, parent: model });
        P.cyl(0.001, 0.025, 0.07, glowMat, { pos: at(0.235), seg: 6, shade: false, parent: model });
        P.cyl(0.07, 0.06, 0.012, trim, { pos: at(0.006), seg: 8, parent: model });
        break;
      case 'key':
        P.torus(0.05, 0.014, trim, { pos: at(0.3), seg: 8, tubeSeg: 4, parent: model });
        P.cyl(0.012, 0.012, 0.26, trim, { pos: at(0.15), seg: 5, parent: model });
        for (const y of [0.02, 0.06]) P.box(0.06, 0.025, 0.02, glowMat, { pos: [0.035, y + 0.04, 0], shade: false, parent: model });
        break;
      case 'moth':
        P.cyl(0.012, 0.014, 0.12, M.bone(), { pos: at(0.12), seg: 5, parent: model });
        for (const s of [-1, 1]) P.extrude([[0, 0], [s * 0.14, 0.06], [s * 0.12, -0.05], [s * 0.04, -0.09]], 0.008, glowMat, { pos: [0, 0.16, 0], shade: false, parent: model });
        break;
      case 'tooth':
        P.lathe([[0.0, 0.0], [0.05, 0.05], [0.07, 0.16], [0.045, 0.2], [0.02, 0.1], [0.0, 0.08]], 8, M.porcelain(), { pos: at(0.04), parent: model });
        P.sphere(0.02, glowMat, { pos: [0, 0.14, 0.06], wSeg: 5, hSeg: 4, shade: false, parent: model });
        break;
      case 'compass':
        P.cyl(0.1, 0.1, 0.03, trim, { pos: at(0.04), seg: 12, parent: model });
        P.cyl(0.085, 0.085, 0.032, M.paper(), { pos: at(0.04), seg: 12, parent: model });
        P.box(0.012, 0.014, 0.16, glowMat, { pos: at(0.062), shade: false, parent: model });
        break;
      default:   // idol: carved pillar with a face
        P.cyl(0.07, 0.085, 0.28, stone, { pos: at(0.14), seg: 6, parent: model });
        P.sphere(0.075, stone, { pos: at(0.3), wSeg: 6, hSeg: 4, parent: model });
        for (const s of [-1, 1]) P.box(0.026, 0.014, 0.012, glowMat, { pos: [s * 0.03, 0.31, 0.068], shade: false, parent: model });
        P.box(0.05, 0.01, 0.012, glowMat, { pos: [0, 0.27, 0.07], shade: false, parent: model });
        break;
    }
    finalizeModel(root);

    // glow sprite above the model
    const halo = new THREE.Sprite(ctx.glowMat(color, 0.8));
    halo.position.y = 0.3;
    halo.scale.setScalar(0.5);
    halo.visible = false;
    root.add(halo);

    // radius ring
    const ringMat = psx({ map: ringTex(), color, lit: false, additive: true, depthWrite: false, snap: false, unique: true }) as THREE.MeshBasicMaterial;
    const ringGeo = new THREE.CircleGeometry(1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'totem_ring';
    ring.position.y = 0.014;
    ring.renderOrder = 1;
    ring.visible = false;
    keep(ring);
    root.add(ring);
    let radius = o.radius, active = false, pulseK = 0;
    const apply = (): void => {
      const s = radius * (1 + 0.1 * Math.sin(pulseK * Math.PI));
      ring.scale.set(s, 1, s);
      ringMat.opacity = 0.8 + 0.2 * pulseK;
      glowMat.color.setHex(active ? glowLit : glowDim);
      halo.visible = active;
      ring.visible = active;
    };
    apply();
    ctx.anim.tick(root, (dt) => { if (active) ring.rotation.y += dt * 0.3; });

    return {
      root, ring,
      setRadius(r) { radius = Math.max(0.05, r); apply(); },
      setActive(on) { active = on; apply(); },
      pulse() {
        void ctx.anim.run(0.6, (k) => { pulseK = k < 0.25 ? ease.outCubic(k / 0.25) : 1 - ease.inOutQuad((k - 0.25) / 0.75); halo.scale.setScalar(0.5 + 0.5 * pulseK); apply(); }, { owner: ring }).then(() => { pulseK = 0; halo.scale.setScalar(0.5); apply(); });
      },
      dispose() {
        ctx.anim.cancel(ring);
        ringMat.dispose(); ringGeo.dispose(); glowMat.dispose();
        root.removeFromParent();
      },
    };
  };

  return { totem };
}
