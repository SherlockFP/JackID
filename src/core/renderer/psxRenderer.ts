/**
 * PSX renderer (CORE-RENDER). Contract: TECH_SPEC §2.3 / §11.7, ART_BIBLE §1.
 *
 * Frame graph (one `render()` call):
 *   scene ─▶ RT_LOW (low-res, nearest, depth) ─▶ FX layer (same camera) ─▶ clearDepth ─▶ overlay (viewmodel)
 *   RT_LOW ─▶ post pass (zoom, glitch, chroma, flash/tint, vignette, Bayer dither, 15-bit quantize, CRT) ─▶ canvas
 *
 * Resolution (TECH_SPEC §11.7, ART §1.2): the internal frame is `targetHeight` rows tall and `2·round(h·aspect/2)` wide,
 * the aspect clamped to 4:3 … 21:9 (beyond that: letter/pillar-boxed `#080808`). Scale mode FILL (default) stretches it
 * over the whole image rectangle with nearest sampling, so the scale may be fractional and pixels differ by one screen
 * px; INTEGER uses the largest whole scale and centres the frame with bars. `settings.scaleMode` is an optional
 * extension of the frozen `PsxSettings` (see {@link PsxSettingsX}).
 * `enabled:false` keeps the same pipeline at native resolution without snap/affine/quantize/CRT, so the juice
 * (flash, tint, chroma, zoom) still renders. `apply()` only writes uniforms and re-allocates the target; it never
 * recompiles a shader.
 *
 * Global colour rules (keep!): ColorManagement off, linear output, no tone mapping, no shadows — hex colours
 * appear on screen exactly as written.
 */
import * as THREE from 'three';
import type { PsxPostState, PsxRenderer, PsxSettings, PsxUniforms } from './types';
import { psxUniforms } from './psxMaterial';
import { createPostPass } from './postShader';
import { fxLayer } from '../fx/layer';
import { app } from '../app';
import { log } from '../log';

THREE.ColorManagement.enabled = false;

/**
 * `PsxSettings` + the §11.7 scale mode. The frozen interface has no such field yet (request to TD: promote it, default
 * 'fill'); until then a missing value means FILL and callers may pass it through `apply()` with a cast.
 */
export type PsxSettingsX = PsxSettings & { scaleMode?: 'fill' | 'integer' };

const MIN_ASPECT = 4 / 3;
const MAX_ASPECT = 21 / 9;
// Fog: states build THREE.Fog with `makeFog()` (renderer/fog.ts), so the shader applies it unscaled (DECISIONS §G).
const BAR_COLOR = 0x080808;

function makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export function createPsxRenderer(canvas: HTMLCanvasElement, initial: PsxSettings): PsxRenderer {
  THREE.ColorManagement.enabled = false;
  const three = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance',
  });
  three.outputColorSpace = THREE.LinearSRGBColorSpace;
  three.toneMapping = THREE.NoToneMapping;
  three.shadowMap.enabled = false;
  three.setPixelRatio(1);
  three.setClearColor(BAR_COLOR, 1);
  three.info.autoReset = false;            // counted per `render()` (scene + fx + overlay + post)

  const settings: PsxSettingsX = { ...initial };
  const lowRes = new THREE.Vector2(400, 225);
  const uniforms: PsxUniforms = psxUniforms;
  const post: PsxPostState = {
    flashColor: 0xffffff, flashAlpha: 0, tintColor: 0x000000, tintAlpha: 0, chroma: 0, zoom: 1,
    vignetteBoost: 0, desaturate: 0, blackout: 0, glitch: 0,
  };
  const pass = createPostPass();
  let rt = makeTarget(2, 2);
  const grabRts: Array<THREE.WebGLRenderTarget | undefined> = [undefined, undefined];
  let grabIdx = 0;
  const color = new THREE.Color();

  const st = {
    scale: 1, viewX: 0, viewY: 0, viewW: 1, viewH: 1,
    dirty: true, lost: false, cpuMs: 0, lastNow: 0, simTime: 0, realTime: 0,
  };

  /** Push everything derived from `settings` + size into the shared uniforms. */
  function derive(): void {
    const on = settings.enabled;
    uniforms.uPsxSnap.value = on && settings.jitter > 0 ? 1 : 0;
    uniforms.uPsxAffine.value = on && settings.affine ? 1 : 0;
    uniforms.uPsxSnapRes.value.copy(lowRes).divideScalar(2 * (1 + 2 * settings.jitter));
    psxUniforms.uPsxFogScale.value = 1;                  // draw distance lives in the scene's THREE.Fog (see fog.ts)
    psxUniforms.uPsxLowRes.value.copy(lowRes);
  }

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const H = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    three.setSize(W, H, false);
    let vw = W, vh = H, lw = W, lh = H;                  // vw×vh = image rectangle on the canvas, lw×lh = internal frame
    if (settings.enabled) {
      const aspect = W / H;
      if (aspect > MAX_ASPECT) vw = Math.round(H * MAX_ASPECT);
      else if (aspect < MIN_ASPECT) vh = Math.round(W / MIN_ASPECT);
      lh = Math.max(1, Math.round(settings.targetHeight));
      lw = Math.max(2, 2 * Math.round((lh * vw) / vh / 2));
      if (settings.scaleMode === 'integer') {
        const k = Math.floor(Math.min(vw / lw, vh / lh));
        if (k >= 1) { vw = lw * k; vh = lh * k; }        // a window smaller than the frame falls back to FILL
      }
    }
    st.scale = vh / lh;
    st.viewW = vw; st.viewH = vh;
    st.viewX = Math.floor((W - vw) / 2); st.viewY = Math.floor((H - vh) / 2);
    if (rt.width !== lw || rt.height !== lh) rt.setSize(lw, lh);
    lowRes.set(lw, lh);
    derive();
  }

  const onLost = (e: Event): void => { e.preventDefault(); st.lost = true; log.warn('render', 'WebGL context lost'); };
  const onRestored = (): void => { st.lost = false; st.dirty = true; log.info('render', 'WebGL context restored'); };
  const onResize = (): void => { st.dirty = true; };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(canvas);
  resize();

  function syncAspect(cam: THREE.Camera): void {
    const pc = cam as THREE.PerspectiveCamera;
    if (!pc.isPerspectiveCamera) return;
    const aspect = st.viewW / st.viewH;                  // the image rectangle (equals lowRes.x / lowRes.y up to rounding)
    if (Math.abs(pc.aspect - aspect) > 1e-4) { pc.aspect = aspect; pc.updateProjectionMatrix(); }
  }

  function writePost(): void {
    const u = pass.uniforms;
    const on = settings.enabled;
    const bits = settings.colorBits;
    u.tScene.value = rt.texture;
    u.uLowRes.value.copy(lowRes);
    u.uView.value.set(st.viewX, st.viewY, st.viewW, st.viewH);
    u.uLevels.value = on ? (1 << bits) - 1 : 255;
    u.uDither.value = on && settings.dither && bits < 8 ? 1 : 0;
    u.uScan.value = on && settings.crt && st.scale >= 2 ? settings.scanlines : 0;
    u.uVig.value = Math.min(1.2, (on && settings.crt ? settings.vignette : 0) + post.vignetteBoost);
    color.setHex(post.flashColor); u.uFlash.value.set(color.r, color.g, color.b, post.flashAlpha);
    color.setHex(post.tintColor); u.uTint.value.set(color.r, color.g, color.b, post.tintAlpha);
    u.uChroma.value = post.chroma;
    u.uZoom.value = post.zoom;
    u.uDesat.value = post.desaturate;
    u.uBlackout.value = post.blackout;
    u.uGlitch.value = post.glitch;
    u.uPostTime.value = st.realTime;
  }

  const self: PsxRenderer & { dispose(): void } = {
    /** Remove listeners (HMR / tests). */
    dispose() {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    },

    three, canvas, lowRes,
    get scale() { return st.scale; },
    uniforms, settings, post,

    apply(patch) {
      const p = patch as Partial<PsxSettingsX>;
      const sizeChanged = (p.enabled !== undefined && p.enabled !== settings.enabled)
        || (p.targetHeight !== undefined && p.targetHeight !== settings.targetHeight)
        || (p.scaleMode !== undefined && p.scaleMode !== settings.scaleMode);
      Object.assign(settings, patch);
      if (sizeChanged) resize(); else derive();
    },

    resize,

    render(scene, camera, overlay) {
      if (st.lost) return;
      if (st.dirty) { st.dirty = false; resize(); }
      const t0 = performance.now();
      const real = st.lastNow === 0 ? 0 : Math.min((t0 - st.lastNow) / 1000, 0.1);
      st.lastNow = t0;
      st.realTime += real;
      const a = app;
      st.simTime += real * (a && !a.simPaused && a.hitstopLeft <= 0 ? a.timeScale : 0);
      uniforms.uTime.value = st.simTime;
      fxLayer.tick(t0);

      syncAspect(camera);
      if (overlay) syncAspect(overlay.camera);

      three.info.reset();
      fxLayer.beginFrame(scene, camera);
      three.setRenderTarget(rt);
      three.autoClear = true;
      three.render(scene, camera);
      if (fxLayer.hasContent) {
        fxLayer.scene.fog = scene.fog;
        three.autoClear = false;
        three.render(fxLayer.scene, camera);
      }
      if (overlay) {
        three.autoClear = false;
        three.clearDepth();
        // the viewmodel always uses the finest snap grid (ART §1.3 exceptions)
        const sr = uniforms.uPsxSnapRes.value;
        const sx = sr.x, sy = sr.y;
        sr.copy(lowRes).divideScalar(2);
        three.render(overlay.scene, overlay.camera);
        sr.set(sx, sy);
      }
      three.autoClear = true;
      fxLayer.endFrame();

      three.setRenderTarget(null);
      writePost();
      three.render(pass.scene, pass.camera);
      st.cpuMs = performance.now() - t0;
    },

    grab() {
      let g = grabRts[grabIdx];
      if (!g || g.width !== rt.width || g.height !== rt.height) {
        g?.dispose();
        g = makeTarget(rt.width, rt.height);
        grabRts[grabIdx] = g;
      }
      grabIdx ^= 1;
      pass.copy.uniforms.tScene.value = rt.texture;
      pass.copy.uniforms.uLowRes.value.copy(lowRes);
      three.setRenderTarget(g);
      three.render(pass.copy.scene, pass.camera);
      three.setRenderTarget(null);
      return g.texture;
    },

    async compile(scene, camera) {
      await three.compileAsync(scene, camera);
      // FX + post programs too, so the first coin shower / flash cannot hitch.
      const kids = fxLayer.scene.children;
      const was = kids.map((k) => k.visible);
      kids.forEach((k) => { k.visible = true; });
      fxLayer.scene.fog = scene.fog;
      try {
        await three.compileAsync(fxLayer.scene, camera);
        await three.compileAsync(pass.scene, pass.camera);
      } finally {
        kids.forEach((k, i) => { k.visible = was[i]; });
      }
    },

    info() {
      const i = three.info;
      return {
        // -1: excludes the full-screen post triangle
        calls: Math.max(0, i.render.calls - 1), tris: Math.max(0, i.render.triangles - 1),
        geometries: i.memory.geometries, textures: i.memory.textures,
        programs: i.programs?.length ?? 0, cpuMs: st.cpuMs,
      };
    },
  };
  return self;
}
