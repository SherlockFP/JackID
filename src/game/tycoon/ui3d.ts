/**
 * In-world 3D UI toolkit (INGAME pause card, Intermission terminal, Upgrade Ledger book). Every surface is a kit-style
 * mesh in the first-person OVERLAY scene (the same pass that draws the hands, depth cleared, FOV 50), painted from
 * low-res `Pix` canvases with nearest filtering. Input is a ray from the overlay camera through the pointer, and the
 * hit's UV says which pixel of the surface was touched. This module is presentation only; the panels own the logic.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { clamp } from '@/core/math';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { finishTexture, Pix } from '@/core/texgen/pixel';
import { microPix, microWidth, px5Pix, px5Width } from '@/core/texgen/font';
import type { Hex } from '@/core/types';

export const ease = {
  outCubic: (k: number): number => 1 - Math.pow(1 - clamp(k, 0, 1), 3),
  outBack: (k: number): number => { const x = clamp(k, 0, 1) - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; },
  inOut: (k: number): number => { const t = clamp(k, 0, 1); return t * t * (3 - 2 * t); },
};

/** Short UI cue on the UI bus (silently skipped when audio is unavailable). */
export function cue(name: string, vol = 0.6): void {
  try { app.audio.play(name, { bus: 'ui', vol }); } catch { /* audio is optional */ }
}

// ── materials and geometry ────────────────────────────────────────────────────────────────────────
export type Mat = THREE.MeshBasicMaterial;
export interface MatOpts {
  color?: Hex; map?: THREE.Texture | null; side?: 'front' | 'back' | 'double';
  transparent?: boolean; opacity?: number; vertexColors?: boolean;
}
/** Unlit PSX material (the overlay has no lights); unique so it can be disposed with its owner. */
export function unlit(o: MatOpts = {}): Mat {
  return psxMaterial({ lit: false, unique: true, ...o }) as unknown as Mat;
}

const LIGHT = new THREE.Vector3(0.35, 0.85, 0.4).normalize();
/** Bake directional vertex shading so the unlit box still reads as a solid (same trick as the viewmodel hands). */
export function shaded<T extends THREE.BufferGeometry>(g: T, floor = 0.6): T {
  const n = g.getAttribute('normal'), p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const d = n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z;
    const v = floor + (1 - floor) * clamp(d * 0.5 + 0.5, 0, 1);
    c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
export const boxGeo = (w: number, h: number, d: number): THREE.BoxGeometry => shaded(new THREE.BoxGeometry(w, h, d));

// ── pixel text ───────────────────────────────────────────────────────────────────────────────────
export interface TxtOpts { micro?: boolean; align?: 'left' | 'center' | 'right'; scale?: number }
export function txtWidth(s: string, o: TxtOpts = {}): number {
  return o.micro ? microWidth(s, o.scale ?? 1) : px5Width(s, o.scale ?? 1);
}
/** Paint a line of pixel text (the pixel fonts have no `×`, so it is written as `x`). */
export function txt(p: Pix, s: string, x: number, y: number, c: Hex, o: TxtOpts = {}): void {
  const str = s.replace(/×/g, 'x');
  const sc = o.scale ?? 1;
  if (o.micro) {
    const w = microWidth(str, sc);
    const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    microPix(p, str, Math.round(x0), y, c, sc);
  } else {
    px5Pix(p, str, x, y, c, sc, o.align ?? 'left');
  }
}
/** Trim `s` with `..` until it fits `maxW` pixels. */
export function fit(s: string, maxW: number, o: TxtOpts = {}): string {
  const str = s.replace(/×/g, 'x');
  if (txtWidth(str, o) <= maxW) return str;
  let out = str;
  while (out.length > 1 && txtWidth(out + '..', o) > maxW) out = out.slice(0, -1);
  return out + '..';
}
/** Word-wrap `s` into lines no wider than `maxW` (micro font by default). */
export function wrap(s: string, maxW: number, o: TxtOpts = { micro: true }): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of s.replace(/×/g, 'x').split(' ')) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || txtWidth(cand, o) <= maxW) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ── painted surfaces ─────────────────────────────────────────────────────────────────────────────
/** A low-res `Pix` buffer mirrored to a canvas and a nearest-filtered texture. */
export class PixSurface {
  readonly pix: Pix;
  readonly tex: THREE.CanvasTexture;
  private readonly cv: HTMLCanvasElement;
  constructor(readonly w: number, readonly h: number) {
    this.pix = new Pix(w, h);
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.tex = finishTexture(this.cv, { wrap: 'clamp' }, false);
  }
  /** Repaint: `fn` draws into the pixel buffer, then the canvas and GPU texture follow. */
  paint(fn: (p: Pix) => void): void { fn(this.pix); this.flush(); }
  /** Copy another buffer of the same size (page turns keep a frozen copy of the old page). */
  copyFrom(src: Pix): void { this.pix.d.set(src.d); this.flush(); }
  private flush(): void { this.pix.paintInto(this.cv); this.tex.needsUpdate = true; }
  dispose(): void { this.tex.dispose(); }
}

// ── stage ────────────────────────────────────────────────────────────────────────────────────────
export interface PickHit { obj: THREE.Object3D; uv: THREE.Vector2 }
export type StageListener = (e: Event, hit: PickHit | null) => void;
interface Tween { t: number; dur: number; step: (k: number) => void; done?: () => void }

/**
 * One in-world UI: a group under the overlay scene, its own animation clock, pointer picking (objects with
 * `userData.pick`) and window listeners. `dispose()` removes everything it created.
 */
export class Stage3D {
  readonly root = new THREE.Group();
  private readonly ov: { scene: THREE.Scene; camera: THREE.Camera } | null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tweens: Tween[] = [];
  private readonly tickers: Array<(dt: number) => void> = [];
  private readonly offs: Array<() => void> = [];
  private readonly disposers: Array<() => void> = [];
  private raf = 0;
  private last = 0;
  private alive = true;

  constructor() {
    // `LocalPlayer` omits the viewmodel overlay; the host from `createLocalPlayer` carries it at runtime (player/local.ts).
    const p = (app.player as unknown as { overlay?: { scene: THREE.Scene; camera: THREE.Camera } } | null)?.overlay;
    this.ov = p ? { scene: p.scene, camera: p.camera } : null;
    this.ov?.scene.add(this.root);
    const loop = (now: number): void => {
      if (!this.alive) return;
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      this.step(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get isAlive(): boolean { return this.alive; }
  add(o: THREE.Object3D): void { this.root.add(o); }
  /** Register something to run on dispose (textures, DOM hooks). */
  own(fn: () => void): void { this.disposers.push(fn); }
  onTick(fn: (dt: number) => void): void { this.tickers.push(fn); }
  animate(dur: number, step: (k: number) => void, done?: () => void): void { this.tweens.push({ t: 0, dur, step, done }); }

  /** Window listener; pointer events also get the picked surface (null when nothing is under the pointer). */
  listen(type: string, fn: StageListener): void {
    const h = (e: Event): void => {
      if (!this.alive) return;
      const hit = 'clientX' in e ? this.pick(e as MouseEvent) : null;
      fn(e, hit);
    };
    window.addEventListener(type, h);
    this.offs.push(() => window.removeEventListener(type, h));
  }

  /** Ray from the overlay camera through the pointer; returns the first `userData.pick` object hit and its UV. */
  pick(e: MouseEvent): PickHit | null {
    if (!this.ov || !this.alive) return null;
    const r = app.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ov.camera.updateMatrixWorld();
    this.root.updateMatrixWorld(true);
    this.ray.setFromCamera(this.ndc, this.ov.camera);
    const objs: THREE.Object3D[] = [];
    this.root.traverse((o) => { if (o.userData.pick && this.shown(o)) objs.push(o); });
    const hit = this.ray.intersectObjects(objs, false)[0];
    if (!hit || !hit.uv) return null;
    return { obj: hit.object, uv: hit.uv };
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    cancelAnimationFrame(this.raf);
    for (const off of this.offs.splice(0)) off();
    this.ov?.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) mt.dispose();
    });
    for (const d of this.disposers.splice(0)) d();
  }

  private shown(o: THREE.Object3D): boolean {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      if (!n.visible) return false;
      if (n === this.root) break;
    }
    return true;
  }

  private step(dt: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      if (!this.alive) return;
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }
    if (!this.alive) return;
    for (const fn of this.tickers) fn(dt);
  }
}

/** Full-view dark veil behind the in-world UI (placed far back so the objects draw over it). */
export function dimVeil(s: Stage3D, opacity: number): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), unlit({ color: 0x050308, transparent: true, opacity: 0 }));
  m.position.set(0, 0, -0.9);
  s.add(m);
  s.animate(0.25, (k) => { m.material.opacity = opacity * k; });
}
