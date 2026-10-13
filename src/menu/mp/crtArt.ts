/**
 * Canvas painting for the multiplayer CRT screens (server browser, host form, lobby chat). Green phosphor, low-res
 * canvas with nearest filtering (PSX look). Pure drawing helpers: callers pass translated strings. Hit regions are kept
 * in a `HitMap` that each paint refills, so pointer picks always match what is on the glass.
 */
import * as THREE from 'three';

export const SCREEN_W = 512;
export const SCREEN_H = 384;
export const PHOS = {
  bg: '#031409', fg: '#8dff9e', dim: '#2b7342', hi: '#d6ffdc', sel: '#3ddc6a', ink: '#03140a',
  warn: '#ffd166', bad: '#ff7070', cyan: '#7ff3ff', amber: '#ffb347',
} as const;
export const VT = '"VT323", monospace';
export const PIX = '"Press Start 2P", monospace';

export interface ScreenCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  /** Clear, run `fn`, upload. */
  paint(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void;
}

/** A canvas texture for a screen: NoColorSpace, nearest filter, no mipmaps (same rules as the cabinet screens). */
export function makeScreenCanvas(w: number, h: number): ScreenCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  return {
    canvas, ctx, tex,
    paint(fn) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      fn(ctx, w, h);
      tex.needsUpdate = true;
    },
  };
}

interface Rect { id: string; x: number; y: number; w: number; h: number }

/** Clickable regions of one painted screen. `at` returns the topmost region under the point. */
export class HitMap {
  private rects: Rect[] = [];
  clear(): void { this.rects.length = 0; }
  add(id: string, x: number, y: number, w: number, h: number): void { this.rects.push({ id, x, y, w, h }); }
  at(x: number, y: number): string | null {
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i]!;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id;
    }
    return null;
  }
}

/** Every CRT glyph is drawn this much larger than its nominal size (the glass is small on screen). */
const FONT_K = 1.2;

export function font(ctx: CanvasRenderingContext2D, px: number, family: string = VT): void {
  ctx.font = `${Math.round(px * FONT_K)}px ${family}`;
}

/** Phosphor text: a soft glow in the text colour. */
export function say(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, px: number,
  align: CanvasTextAlign = 'left', family: string = VT): void {
  ctx.save();
  font(ctx, px, family);
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/** Text clipped to `maxW` (ends with "..." when cut). */
export function sayFit(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, color: string,
  px: number, align: CanvasTextAlign = 'left'): void {
  font(ctx, px);
  let out = s;
  while (out.length > 1 && ctx.measureText(out).width > maxW) out = out.slice(0, -1);
  if (out.length < s.length && out.length > 2) out = `${out.slice(0, -2)}..`;
  say(ctx, out, x, y, color, px, align);
}

export function wrapLines(ctx: CanvasRenderingContext2D, s: string, maxW: number, px: number): string[] {
  font(ctx, px);
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxW || !line) line = trial;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

export function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | null,
  stroke: string | null = PHOS.dim): void {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
}

/** A labelled push button; `on` inverts it (selected / pressed). */
export function button(ctx: CanvasRenderingContext2D, hits: HitMap, id: string, label: string, x: number, y: number,
  w: number, h: number, on = false, color: string = PHOS.fg): void {
  box(ctx, x, y, w, h, on ? color : PHOS.bg, color);
  const c = on ? PHOS.ink : color;
  say(ctx, label, x + w / 2, y + h / 2 - 9, c, 18, 'center');
  hits.add(id, x, y, w, h);
}

/** Phosphor static (bars of noise) for the power-on warm-up. `k` 1 = all static, 0 = none. Deterministic. */
export function staticBars(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, time: number): void {
  if (k <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, k);
  for (let y = 0; y < h; y += 3) {
    const v = Math.abs(Math.sin(y * 12.9898 + time * 61.7)) * 0.5 + 0.2;
    ctx.fillStyle = `rgba(${Math.round(120 * v)},${Math.round(255 * v)},${Math.round(150 * v)},0.85)`;
    ctx.fillRect(0, y, w, 2);
  }
  ctx.restore();
}

/** Scanline strip texture: two dark rows per four, repeated over the glass by the rig. */
export function scanlineCanvas(): ScreenCanvas {
  const s = makeScreenCanvas(4, 4);
  s.paint((c) => {
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, 0, 4, 2);
  });
  s.tex.wrapS = THREE.RepeatWrapping;
  s.tex.wrapT = THREE.RepeatWrapping;
  return s;
}
