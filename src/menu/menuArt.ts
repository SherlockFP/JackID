/**
 * Canvas painters for every menu texture (menu-3d). Pure drawing: no state, no i18n lookups (callers pass
 * translated strings). Textures are NoColorSpace + nearest filtering (DECISIONS C14, PSX look).
 */
import * as THREE from 'three';

export const GOLD = '#e6b23a';
export const GOLD_HI = '#ffe08a';
export const CRIMSON = '#c8243c';
const PIXEL = '"Press Start 2P", monospace';
const BODY = '"VT323", monospace';

export interface CanvasTex {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: THREE.CanvasTexture;
  /** Repaint with `fn` and upload. */
  paint(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void;
}

export function makeCanvasTex(w: number, h: number): CanvasTex {
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

/** Largest font size <= `px` at which `text` fits `maxW` (never below 8 px). */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number, family = PIXEL): number {
  let s = px;
  for (; s > 8; s -= 2) {
    ctx.font = `${s}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return s;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, color: string, align: CanvasTextAlign = 'center'): void {
  const s = fitFont(ctx, text, maxW, px);
  ctx.font = `${s}px ${PIXEL}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function bodyText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left'): void {
  ctx.font = `${px}px ${BODY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, border: string, inset: number): void {
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(4, w / 28);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.lineWidth = Math.max(2, w / 96);
  ctx.strokeRect(inset * 2.2, inset * 2.2, w - inset * 4.4, h - inset * 4.4);
  ctx.fillStyle = border;
  const k = w / 22;
  for (const [x, y] of [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]] as const) {
    ctx.fillRect(x - k / 2, y - k / 2, k, k);
  }
}

export function drawIcon(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, r / 6);
  switch (kind) {
    case 'play': {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r);
      ctx.lineTo(cx + r * 0.95, cy);
      ctx.lineTo(cx - r * 0.6, cy + r);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'multi': {
      for (const dx of [-0.45, 0.45]) {
        ctx.beginPath(); ctx.arc(cx + dx * r, cy - r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + dx * r, cy + r * 0.75, r * 0.5, Math.PI, 0); ctx.fill();
      }
      break;
    }
    case 'free': {
      for (const [x, y] of [[0, -0.45], [-0.42, 0.1], [0.42, 0.1]] as const) {
        ctx.beginPath(); ctx.arc(cx + x * r, cy + y * r, r * 0.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillRect(cx - r * 0.12, cy + r * 0.2, r * 0.24, r * 0.8);
      break;
    }
    case 'settings': {
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.lineWidth = r * 0.34; ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillRect(-r * 0.17, -r, r * 0.34, r * 0.42);
        ctx.restore();
      }
      break;
    }
    case 'credits': {
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - r * 0.2, cy - r * 0.2, r * 0.4, r * 1.2);
      break;
    }
    case 'quit': {
      ctx.strokeRect(cx - r * 0.7, cy - r * 0.95, r * 1.4, r * 1.9);
      ctx.beginPath(); ctx.arc(cx + r * 0.42, cy + r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.9, cy); ctx.lineTo(cx - r * 0.4, cy);
      ctx.moveTo(cx - r * 0.05, cy - r * 0.6); ctx.lineTo(cx - r * 0.7, cy); ctx.lineTo(cx - r * 0.05, cy + r * 0.6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** One die face: red enamel (or teal for the settings die), gold frame, icon and label. */
export function paintDieFace(ctx: CanvasRenderingContext2D, w: number, h: number, o: { label: string; icon: string; lit: boolean; dark?: boolean }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (o.dark) { g.addColorStop(0, '#0d2a30'); g.addColorStop(1, '#04100f'); }
  else { g.addColorStop(0, o.lit ? '#9c1a2c' : '#6a0c1c'); g.addColorStop(1, '#1c0609'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,220,140,0.06)';
  for (let y = 10; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 16; x < w; x += 16) ctx.fillRect(x, y, 2, 2);
  frame(ctx, w, h, o.lit ? GOLD_HI : GOLD, w / 16);
  drawIcon(ctx, o.icon, w / 2, h * 0.38, w * 0.17, o.lit ? GOLD_HI : (o.dark ? '#5fd6c0' : CRIMSON));
  fitText(ctx, o.label, w / 2, h * 0.78, w * 0.84, w * 0.085, o.lit ? GOLD_HI : '#f2d9a0');
}

/** Settings face: category on top, live value in the middle, < > hint below. */
export function paintValueFace(ctx: CanvasRenderingContext2D, w: number, h: number, o: { label: string; value: string; sub?: string; lit: boolean }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, o.lit ? '#135a60' : '#0d3d43');
  g.addColorStop(1, '#03100f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  frame(ctx, w, h, o.lit ? GOLD_HI : GOLD, w / 16);
  fitText(ctx, o.label, w / 2, h * 0.2, w * 0.84, w * 0.1, '#9ff3e0');
  fitText(ctx, o.value, w / 2, h * 0.5, w * 0.84, w * 0.17, o.lit ? GOLD_HI : '#ffcf5a');
  if (o.sub) bodyText(ctx, o.sub, w / 2, h * 0.7, Math.round(w * 0.12), '#c9f7ea', 'center');
  fitText(ctx, '< >', w / 2, h * 0.86, w * 0.5, w * 0.1, o.lit ? GOLD_HI : GOLD);
}

/** Left-context / info panel. Lines are already translated; `hint` sits at the bottom. */
export function paintPanel(ctx: CanvasRenderingContext2D, w: number, h: number, o: { title: string; lines: string[]; hint?: string; bodyPx?: number; titlePx?: number; hintPx?: number; titleColor?: string }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#120812');
  g.addColorStop(1, '#050205');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,200,90,0.05)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  frame(ctx, w, h, GOLD, w / 40);
  fitText(ctx, o.title, w / 2, h * 0.16, w * 0.86, o.titlePx ?? h * 0.1, o.titleColor ?? GOLD_HI);
  const px = o.bodyPx ?? Math.round(h * 0.12);
  const step = px * 1.25;
  let y = h * 0.34;
  for (const line of o.lines) {
    bodyText(ctx, line, w / 2, y, px, '#f2d9a0', 'center');
    y += step;
  }
  if (o.hint) bodyText(ctx, o.hint, w / 2, h * 0.9, o.hintPx ?? Math.round(h * 0.07), '#8fd9ff', 'center');
}

/** Marquee: the title in gold with a red halo that flickers. */
export function paintMarquee(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, flick: number): void {
  ctx.fillStyle = '#16050a';
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.5);
  glow.addColorStop(0, `rgba(230,40,60,${0.45 * flick})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  for (let x = 6; x < w; x += 28) {
    ctx.fillStyle = flick > 0.5 ? '#ffdf7a' : '#7a5a20';
    ctx.beginPath(); ctx.arc(x, h / 2, 4, 0, Math.PI * 2); ctx.fill();
  }
  fitText(ctx, title, w / 2, h / 2, w * 0.7, h * 0.52, flick > 0.5 ? GOLD_HI : GOLD);
}

/** Reel strip: 12 symbols around the circumference (u), one row (v). */
export function paintReelStrip(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const kinds = ['SEVEN', 'BAR', 'CHERRY', 'BELL', 'SUN', 'DIAMOND', 'SEVEN', 'BAR', 'CHERRY', 'BELL', 'SUN', 'DIAMOND'];
  const cell = w / kinds.length;
  kinds.forEach((k, i) => {
    const x0 = i * cell;
    ctx.fillStyle = i % 2 ? '#f3ecd6' : '#e7dcc0';
    ctx.fillRect(x0, 0, cell, h);
    ctx.strokeStyle = '#2a0b10';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 1, 1, cell - 2, h - 2);
    const cx = x0 + cell / 2, cy = h / 2, r = cell * 0.36;
    if (k === 'SEVEN') fitText(ctx, '7', cx, cy, cell * 0.8, h * 0.6, '#c8243c');
    else if (k === 'BAR') fitText(ctx, 'BAR', cx, cy, cell * 0.85, h * 0.22, '#1b1020');
    else if (k === 'CHERRY') {
      ctx.fillStyle = '#c8243c';
      ctx.beginPath(); ctx.arc(cx - r * 0.4, cy + r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + r * 0.4, cy + r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a7a2a';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.4, cy); ctx.lineTo(cx, cy - r * 0.9); ctx.lineTo(cx + r * 0.4, cy); ctx.stroke();
    } else if (k === 'BELL') {
      ctx.fillStyle = '#c99a2a';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.7, cy + r * 0.5);
      ctx.quadraticCurveTo(cx - r * 0.7, cy - r * 0.9, cx, cy - r * 0.9);
      ctx.quadraticCurveTo(cx + r * 0.7, cy - r * 0.9, cx + r * 0.7, cy + r * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - r * 0.9, cy + r * 0.5, r * 1.8, r * 0.18);
    } else if (k === 'SUN') {
      ctx.fillStyle = '#e6b23a';
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r * 0.5, cy + Math.sin(ang) * r * 0.5);
        ctx.lineTo(cx + Math.cos(ang - 0.12) * r, cy + Math.sin(ang - 0.12) * r);
        ctx.lineTo(cx + Math.cos(ang + 0.12) * r, cy + Math.sin(ang + 0.12) * r);
        ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#2fb8c9';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy);
      ctx.closePath(); ctx.fill();
    }
  });
}

/** Soft radial glow texture (solid centre fading to transparent). */
export function paintGlow(ctx: CanvasRenderingContext2D, w: number, h: number, rgb: string): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.35, `rgba(${rgb},0.45)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Back wall: dark oxblood, gold diamond lattice, warm vignette. */
export function paintWall(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#1a0609';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(230,178,58,0.16)';
  ctx.lineWidth = 3;
  const s = w / 8;
  for (let y = -s; y < h + s; y += s) for (let x = -s; x < w + s; x += s) {
    ctx.beginPath();
    ctx.moveTo(x, y - s / 2); ctx.lineTo(x + s / 2, y); ctx.lineTo(x, y + s / 2); ctx.lineTo(x - s / 2, y);
    ctx.closePath(); ctx.stroke();
  }
  const v = ctx.createRadialGradient(w / 2, h * 0.45, w * 0.1, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(255,160,80,0.22)');
  v.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}
