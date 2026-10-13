/**
 * Displays and signage: `screen` (live canvas-texture CRT with bezel), `label`, `marquee` (text + chaser
 * bulbs), `neon` (tube text + dithered additive halo, ignition + BUZZ flicker).
 *
 * Canvas textures are per-instance (unique materials, non-shared textures) so `disposeObject3D` frees them.
 * Text is bound to the language hub: `{ key }` sources repaint on `lang:changed`. Screen uploads are queued
 * and flushed by `Kit.update` (≤ 4 per frame, ≤ ~20 Hz per screen) — `draw()` itself is cheap.
 */
import * as THREE from 'three';
import type { TextOpts } from '@/core/texgen/types';
import { createRng } from '@/core/rng';
import { makeCanvas } from '@/core/texgen/pixel';
import { patchShader, psx } from './materials';
import { buildMesh } from './prims';
import { scaleUV } from './geo';
import { isLive } from './anim';
import { keep, part, type Flushable, type KitCtx } from './ctx';
import { fitText, renderNeon } from './draw';
import { css } from './palette';
import { createBulbChain, rectLoop, spread } from './lights';
import type { Kit, LabelPart, MarqueePart, NeonPart, ScreenSurface } from './types';

const MIN_FLUSH_INTERVAL = 0.045;   // s — ≈ 20 Hz per screen

const canvasOf = (t: THREE.Texture): HTMLCanvasElement => t.image as HTMLCanvasElement;
const ctx2d = (c: HTMLCanvasElement): CanvasRenderingContext2D => {
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return g;
};
/** Canvas px for a physical size at ~160 px/m, clamped to sign-friendly bounds. */
const autoPx = (w: number, h: number, maxW = 256, maxH = 64): [number, number] =>
  [Math.max(16, Math.min(maxW, Math.round(w * 160))), Math.max(8, Math.min(maxH, Math.round(h * 160)))];

/** Plane whose centre bulges towards +Z (CRT glass). */
function bulgedPlane(w: number, h: number, bulge: number): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h, 6, 4);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) / (w / 2)), v = (pos.getY(i) / (h / 2));
    pos.setZ(i, bulge * (1 - u * u) * (1 - v * v));
  }
  g.computeVertexNormals();
  return g;
}

export function makeScreens(ctx: KitCtx): Pick<Kit, 'screen' | 'marquee' | 'label' | 'neon'> {
  const { tex, P, M, pal } = ctx;

  /** Per-instance canvas texture + 2D context. */
  const makeCanvasTex = (w: number, h: number): { t: THREE.CanvasTexture; g: CanvasRenderingContext2D } => {
    const t = tex.canvas(w, h, () => {}, { wrap: 'clamp' });
    return { t, g: ctx2d(canvasOf(t)) };
  };

  // ── screen ────────────────────────────────────────────────────────────────────────────────────
  /**
   * `canvas` IS the texture image: modelers draw straight into it (`draw`, `text`, `clear`, or their own 2D context).
   * CRT scanlines (every odd texel row ×0.78) and the 1-px rounded corners are applied in the fragment shader, so
   * nothing is composited per flush; uploads are throttled to ≈ 20 Hz per screen and ≤ 4 screens per frame.
   */
  const screen: Kit['screen'] = (o) => {
    const [pw, ph] = o.px;
    const scan = o.scanlines ?? true;
    const glowAmt = o.glow ?? 0;
    const { t: texture, g: dg } = makeCanvasTex(pw, ph);
    dg.fillStyle = '#000'; dg.fillRect(0, 0, pw, ph);
    const display = canvasOf(texture);
    const mat = psx({ map: texture, lit: false, affine: false, snap: false, unique: true });
    patchShader(mat, `crt:${pw}x${ph}:${scan ? 1 : 0}`, {
      fragAfterColor: `
        vec2 crtPx = vec2(floor(vMapUv.x * ${pw}.0), floor((1.0 - vMapUv.y) * ${ph}.0));
        ${scan ? 'diffuseColor.rgb *= 1.0 - 0.22 * mod(crtPx.y, 2.0);' : ''}
        if ((crtPx.x < 0.5 || crtPx.x > ${pw - 1}.5) && (crtPx.y < 0.5 || crtPx.y > ${ph - 1}.5)) diffuseColor.rgb = vec3(0.0);`,
    });
    const bulge = Math.min(o.w, o.h) * 0.07;
    const mesh = new THREE.Mesh(bulgedPlane(o.w, o.h, bulge), mat);
    mesh.name = 'screen';
    keep(mesh);
    part(mesh);                              // bezel + recess below are static: finalize merges them

    // bezel: rectangular frame with a hole, recessed housing behind the glass
    const bz = Math.max(0.014, Math.min(o.w, o.h) * 0.13);
    const shape = new THREE.Shape();
    const ow = o.w / 2 + bz, oh = o.h / 2 + bz;
    shape.moveTo(-ow, -oh); shape.lineTo(ow, -oh); shape.lineTo(ow, oh); shape.lineTo(-ow, oh); shape.lineTo(-ow, -oh);
    const hole = new THREE.Path();
    hole.moveTo(-o.w / 2, -o.h / 2); hole.lineTo(-o.w / 2, o.h / 2); hole.lineTo(o.w / 2, o.h / 2); hole.lineTo(o.w / 2, -o.h / 2); hole.lineTo(-o.w / 2, -o.h / 2);
    shape.holes.push(hole);
    const bGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelOffset: -0.004, bevelSegments: 1, steps: 1 });
    buildMesh(bGeo, M.enamel(o.bezel ?? pal.black, 0.25), { pos: [0, 0, -0.034], parent: mesh, name: 'bezel' }, true, (g, tile) => scaleUV(g, 1 / tile, 1 / tile));
    // dark recess behind the glass so the bulge reads as a tube
    P.box(o.w * 1.02, o.h * 1.02, 0.01, 0x08080c, { pos: [0, 0, -0.012], parent: mesh });

    let haloMat: THREE.SpriteMaterial | null = null;
    if (glowAmt > 0) {
      haloMat = new THREE.SpriteMaterial({ map: ctx.glowTex(), color: 0x63e6de, transparent: true, opacity: Math.min(1, glowAmt * 0.6), blending: THREE.AdditiveBlending, depthWrite: false });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(o.w * 1.7, o.h * 1.9, 1);
      halo.position.z = -0.004;
      mesh.add(halo);
    }
    const [, ag] = makeCanvas(1, 1);

    let disposed = false;
    const self: Flushable & { dirty: boolean } = {
      lastFlush: -1, dirty: false,
      flush(now) {
        if (disposed) return true;
        if (this.lastFlush >= 0 && now - this.lastFlush < MIN_FLUSH_INTERVAL) return false;
        texture.needsUpdate = true;
        if (haloMat && isLive(mesh)) {     // CPU readback only while the screen is visible
          ag.drawImage(display, 0, 0, 1, 1);
          const d = ag.getImageData(0, 0, 1, 1).data;
          const k = 1.4;                  // brighten the tiny average so dim screens still glow
          haloMat.color.setRGB(Math.min(1, (d[0] / 255) * k), Math.min(1, (d[1] / 255) * k), Math.min(1, (d[2] / 255) * k));
        }
        this.lastFlush = now; this.dirty = false;
        return true;
      },
    };
    const mark = (): void => { self.dirty = true; ctx.dirty.add(self); };
    const surface: ScreenSurface = {
      mesh, canvas: display, tex: texture, w: pw, h: ph,
      draw(fn) { fn(dg, surface); mark(); },
      text(str, x, y, to?: TextOpts) {
        const w = tex.drawText(dg, str, x, y, { font: 'px5', color: '#ffffff', ...to });
        mark();
        return w;
      },
      clear(color) { dg.fillStyle = color ?? '#000'; dg.fillRect(0, 0, pw, ph); mark(); },
      dispose() {
        disposed = true; ctx.dirty.delete(self);
        texture.dispose(); mesh.geometry.dispose(); mat.dispose(); haloMat?.dispose();
      },
    };
    ctx.dirty.add(self);
    return surface;
  };

  // ── label ─────────────────────────────────────────────────────────────────────────────────────
  const label: Kit['label'] = (o) => {
    const [pw, ph] = o.px ?? autoPx(o.w, o.h);
    const { t: texture, g } = makeCanvasTex(pw, ph);
    const bg = o.bg === null ? null : css(o.bg ?? pal.black);
    const paint = (s: string): void => {
      fitText(tex, g, s, pw, ph, { font: o.font ?? 'ps2p', color: css(o.color ?? pal.white), bg, pad: 1 });
      texture.needsUpdate = true;
    };
    const binding = ctx.text.bind(o.text, texture, paint);
    const mat = psx({ map: texture, lit: false, affine: false, snap: false, alphaTest: bg ? 0 : 0.5, unique: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
    mesh.name = 'label';
    keep(mesh);
    const api: LabelPart = { mesh, setText(t) { binding.set(t); } };
    return api;
  };

  // ── marquee ───────────────────────────────────────────────────────────────────────────────────
  const marquee: Kit['marquee'] = (o) => {
    const root = P.group('marquee');
    const depth = 0.1;
    const color = o.color ?? pal.neonYellow;
    const bgHex = o.bg ?? pal.black;
    P.box(o.w, o.h, depth, M.enamel(bgHex, 0.2), { bevel: Math.min(0.012, o.h * 0.08), pos: [0, 0, 0], parent: root });
    P.box(o.w + 0.02, 0.014, depth + 0.012, M.gold(), { pos: [0, o.h / 2, 0], parent: root });
    P.box(o.w + 0.02, 0.014, depth + 0.012, M.gold(), { pos: [0, -o.h / 2, 0], parent: root });
    const tw = o.w - 0.08, th = o.h - 0.08;
    const [pw, ph] = autoPx(tw, th, 256, 48);
    const { t: texture, g } = makeCanvasTex(pw, ph);
    const paint = (s: string): void => {
      fitText(tex, g, s, pw, ph, { font: o.font ?? 'ps2p', color: css(color), bg: css(bgHex), outline: null, pad: 2 });
      texture.needsUpdate = true;
    };
    const binding = ctx.text.bind(o.text, texture, paint);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(tw, th), psx({ map: texture, lit: false, affine: false, snap: false, unique: true }));
    face.position.z = depth / 2 + 0.002;
    face.name = 'marquee_text';
    keep(face);
    root.add(face);

    // bulbs around the perimeter, just proud of the front face
    const loop = rectLoop(o.w - 0.035, o.h - 0.035, depth / 2 + 0.012);
    const per = 2 * (o.w + o.h);
    const count = o.bulbs ?? Math.max(8, Math.round(per / 0.1));
    const chain = createBulbChain(ctx, spread(loop, count, true), [color, 0xffce5a], 0.011, count * 17 + 3);
    root.add(chain.root);
    part(root);
    chain.setPattern('blink', 1);

    const api: MarqueePart = {
      root,
      setText(t) { binding.set(t); },
      chase(p, hz) {
        switch (p) {
          case 'chase': chain.setPattern('chase', hz); break;
          case 'blink': chain.setPattern('blink', hz); break;
          case 'all': chain.setPattern('all'); break;
          case 'off': chain.setPattern('off'); break;
          case 'win': chain.setPattern('rainbow', hz ?? 12); break;
        }
      },
    };
    return api;
  };

  // ── neon ──────────────────────────────────────────────────────────────────────────────────────
  const neon: Kit['neon'] = (o) => {
    const root = P.group('neon');
    const font = 'ps2p' as const;
    const size = 16;
    const first = ctx.text.resolve(o.text);
    const textW = Math.max(16, Math.ceil(tex.measure(first, { font, size })) + 12);
    const pw = Math.min(256, textW), ph = size + 14;
    const { t: tubeTex, g: tg } = makeCanvasTex(pw, ph);
    const { t: haloTex, g: hg } = makeCanvasTex(pw, ph);
    const [, sg] = makeCanvas(pw, ph);
    const paint = (s: string): void => {
      sg.clearRect(0, 0, pw, ph);
      fitText(tex, sg, s, pw, ph, { font, color: '#ffffff', pad: 7, maxSize: size });
      const mask = sg.getImageData(0, 0, pw, ph);
      const tube = tg.createImageData(pw, ph), halo = hg.createImageData(pw, ph);
      renderNeon(mask, tube, halo, o.color);
      tg.putImageData(tube, 0, 0); hg.putImageData(halo, 0, 0);
      tubeTex.needsUpdate = true; haloTex.needsUpdate = true;
    };
    ctx.text.bind(o.text, tubeTex, paint);
    const w = o.h * (pw / ph), h = o.h;
    const tubeMat = psx({ map: tubeTex, lit: false, affine: false, snap: false, alphaTest: 0.5, unique: true }) as THREE.MeshBasicMaterial;
    const haloMat = psx({ map: haloTex, lit: false, additive: true, affine: false, snap: false, alphaTest: 0.5, opacity: 0.6, unique: true }) as THREE.MeshBasicMaterial;
    const tube = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tubeMat);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.0, h * 1.0), haloMat);
    halo.position.z = -0.012;
    tube.name = 'neon_tube'; halo.name = 'neon_halo';
    root.add(halo, tube);
    part(root); keep(tube); keep(halo);

    const rng = createRng(first.length * 131 + 7);
    let on = false, ignite = -1, igniteStart = 0, flickAmt = o.flicker ?? 0.1, nextEvent = 3, blackout = 0, ghostUntil = 0;
    const IGNITE: Array<[number, number]> = [[0.06, 1], [0.14, 0], [0.18, 1], [0.33, 0]];   // on 60 ms, off 80, on 40, off 150, then on
    const apply = (v: number): void => {
      tubeMat.color.setScalar(Math.max(0.05, v));
      haloMat.opacity = 0.6 * Math.min(1, v);
      tube.visible = v > 0.02; halo.visible = v > 0.02;
    };
    apply(0);
    let acc = 0;
    ctx.anim.tick(root, (dt, t) => {
      acc += dt;
      if (acc < 1 / 30) return;
      acc = 0;
      if (!on) { apply(0); return; }
      if (ignite >= 0) {
        const e = t - igniteStart;
        let v = 1;
        for (const [until, val] of IGNITE) if (e < until) { v = val; break; }
        apply(v);
        if (e > 0.33) ignite = -1;
        return;
      }
      let v = 1 + 0.04 * Math.sin(t * Math.PI * 2 * 47) + (rng.next() - 0.5) * 0.04;
      if (flickAmt > 0) {
        if (t >= nextEvent) { blackout = t + 0.04 + rng.next() * 0.08 * (0.5 + flickAmt); nextEvent = t + (2 + rng.next() * 7) / (0.3 + flickAmt * 2); if (rng.chance(flickAmt * 0.4)) ghostUntil = t + 2 + rng.next() * 6; }
        if (t < blackout) v = 0.08;
        else if (t < ghostUntil) v = 0.08;
      }
      apply(Math.max(0, v));
    });
    const api: NeonPart = {
      root,
      setOn(v) { if (v && !on) { ignite = 0; igniteStart = ctx.anim.time; } on = v; if (!v) apply(0); },
      flicker(a) { flickAmt = Math.max(0, Math.min(1, a)); },
    };
    return api;
  };

  return { screen, label, marquee, neon };
}

