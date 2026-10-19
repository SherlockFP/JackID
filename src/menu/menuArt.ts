/**
 * Canvas painters for every menu texture (menu-3d). Pure drawing: no state, no i18n lookups (callers pass
 * translated strings). Textures are NoColorSpace + nearest filtering (DECISIONS C14, PSX look).
 */
import * as THREE from 'three';
import { createRng } from '@/core/rng';

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

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, border: string, inset: number, u = w): void {
  ctx.strokeStyle = border;
  ctx.lineWidth = Math.max(4, u / 28);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
  ctx.lineWidth = Math.max(2, u / 96);
  ctx.strokeRect(inset * 2.2, inset * 2.2, w - inset * 4.4, h - inset * 4.4);
  ctx.fillStyle = border;
  const k = u / 22;
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
    case 'foundations': {
      // three stacked slabs and a pillar: the tree's trunk
      ctx.fillRect(cx - r * 0.95, cy + r * 0.55, r * 1.9, r * 0.38);
      ctx.fillRect(cx - r * 0.65, cy + r * 0.08, r * 1.3, r * 0.38);
      ctx.fillRect(cx - r * 0.35, cy - r * 0.38, r * 0.7, r * 0.38);
      ctx.beginPath(); ctx.moveTo(cx, cy - r * 0.98); ctx.lineTo(cx + r * 0.3, cy - r * 0.5); ctx.lineTo(cx - r * 0.3, cy - r * 0.5); ctx.closePath(); ctx.fill();
      break;
    }
    case 'continue': {
      // two play triangles: pick the run up where it stopped
      for (const dx of [-0.42, 0.42]) {
        ctx.beginPath();
        ctx.moveTo(cx + (dx - 0.36) * r, cy - r * 0.8);
        ctx.lineTo(cx + (dx + 0.5) * r, cy);
        ctx.lineTo(cx + (dx - 0.36) * r, cy + r * 0.8);
        ctx.closePath(); ctx.fill();
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

/** One die face: red enamel (or teal for the settings die), gold frame, icon and a BIG label (two lines for two words).
 *  `sub` is an optional small line under the label (the Continue face's floor and shift). */
export function paintDieFace(ctx: CanvasRenderingContext2D, w: number, h: number, o: { label: string; icon: string; lit: boolean; dark?: boolean; sub?: string }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (o.dark) { g.addColorStop(0, '#0d2a30'); g.addColorStop(1, '#04100f'); }
  else { g.addColorStop(0, o.lit ? '#b82238' : '#8a1226'); g.addColorStop(1, '#1c0609'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,220,140,0.06)';
  for (let y = 10; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 16; x < w; x += 16) ctx.fillRect(x, y, 3, 3);
  frame(ctx, w, h, o.lit ? GOLD_HI : GOLD, w / 16);
  const words = o.label.split(' ');
  const two = words.length === 2 && o.label.length > 7;
  // with a sub-line the icon and the labels move up, so the line stays inside the inner frame (about 0.86 h)
  const sub = Boolean(o.sub);
  drawIcon(ctx, o.icon, w / 2, h * (sub ? 0.24 : two ? 0.27 : 0.31), w * (sub ? 0.1 : 0.12), o.lit ? GOLD_HI : (o.dark ? '#5fd6c0' : '#e8485c'));
  const col = o.lit ? GOLD_HI : '#fff0c8';
  // a dark plate behind the label keeps it readable on the red enamel at a distance
  ctx.fillStyle = o.dark ? 'rgba(2,14,14,0.55)' : 'rgba(18,2,6,0.55)';
  const top = h * (sub ? 0.37 : two ? 0.42 : 0.57), bot = h * (sub ? 0.73 : 0.84);
  ctx.fillRect(w * 0.12, top, w * 0.76, bot - top);
  if (two) {
    bigLabel(ctx, words[0], w / 2, h * (sub ? 0.47 : 0.55), w * 0.76, w * 0.24, col);
    bigLabel(ctx, words[1], w / 2, h * (sub ? 0.64 : 0.74), w * 0.76, w * 0.24, col);
  } else bigLabel(ctx, o.label, w / 2, h * (sub ? 0.6 : 0.7), w * 0.8, w * 0.3, col);
  if (o.sub) bodyText(ctx, o.sub, w / 2, h * 0.8, Math.round(w * 0.1), o.lit ? GOLD_HI : '#f0dca8', 'center');
}

/** A die-face label in the tall pixel font, as large as fits `maxW`, with a drop shadow and a faux-bold double strike. */
function bigLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, maxPx: number, color: string): void {
  let px = Math.round(maxPx);
  for (; px > 10; px -= 2) {
    ctx.font = `${px}px ${BODY}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = `${px}px ${BODY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillText(text, x + 3, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.fillText(text, x + 1.5, y);
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

/** One centred line of the panel's body face, shrunk until it fits `maxW`. */
export function panelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px0: number, color: string): void {
  fitText(ctx, text, x, y, maxW, px0, color, 'center');
}

/** The CREDITS button of the compact plate, as fractions of the panel (centre x / y, width / height). Painter and picker share it. */
export const PANEL_BUTTON = { cx: 0.5, cy: 0.653, w: 0.36, h: 0.17 };

/** What the info panel shows. Prose wraps to `maxLines` (the size shrinks to fit); a list keeps its lines. The body block
 *  sits in `bodyTop..bodyTop+bodyH` (fractions of the panel height). `button` draws the CREDITS button, `hint` the controls line. */
export interface PanelOpts {
  title: string;
  body?: string | string[];
  /** Older name for a list body (menuCabinet's blank screens). `body` wins when both are given. */
  lines?: string[];
  maxLines?: number;
  hint?: string;
  button?: string;
  bodyTop?: number;
  bodyH?: number;
  /** A strip at the foot of the panel with only the CREDITS button and the controls hint (the die already names its face).
   *  It is tall enough for the button when there is one, a slim strip for the hint alone otherwise. */
  compact?: boolean;
}

/** Greedy word wrap at `maxW`. */
function greedyWrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width <= maxW || !line) line = trial;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/** Word wrap at pixel size `px` (VT323) that keeps the greedy line count but narrows the measure, so no line is an orphan word. */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number): string[] {
  ctx.font = `${px}px ${BODY}`;
  let best = greedyWrap(ctx, text, maxW);
  for (let w = maxW * 0.94; best.length > 1 && w > maxW * 0.4; w *= 0.94) {
    const l = greedyWrap(ctx, text, w);
    if (l.length !== best.length || l.some((x) => ctx.measureText(x).width > w)) break;
    best = l;
  }
  return best;
}

/** The largest size (at most `px0`) at which the body fits: lines within `maxW`, the block within `maxH`, prose within `maxLines`. */
function fitBody(ctx: CanvasRenderingContext2D, body: string | string[], maxW: number, maxH: number, px0: number, maxLines?: number): { px: number; lines: string[] } {
  for (let px = px0; px > 16; px -= 2) {
    const lines = typeof body === 'string' ? wrapWords(ctx, body, maxW, px) : body;
    ctx.font = `${px}px ${BODY}`;
    const fits = lines.every((l) => ctx.measureText(l).width <= maxW)
      && (maxLines === undefined || lines.length <= maxLines)
      && lines.length * px * 1.25 <= maxH;
    if (fits) return { px, lines };
  }
  return { px: 16, lines: typeof body === 'string' ? wrapWords(ctx, body, maxW, 16) : body };
}

/** A single line in the body face, shrunk until it fits `maxW`. */
function fitLine(ctx: CanvasRenderingContext2D, text: string, maxW: number, px0: number, min = 14): number {
  let px = px0;
  for (; px > min; px -= 2) {
    ctx.font = `${px}px ${BODY}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return px;
}

function drawButton(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  const b = PANEL_BUTTON;
  const x = (b.cx - b.w / 2) * w, y = (b.cy - b.h / 2) * h, bw = b.w * w, bh = b.h * h;
  ctx.fillStyle = '#2a0a12';
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = Math.max(3, h / 120);
  ctx.strokeRect(x + 2, y + 2, bw - 4, bh - 4);
  fitText(ctx, label, w / 2, b.cy * h, bw * 0.9, bh * 0.5, GOLD_HI);
}

/** Info panel under the glass (1120 x 480 texels; drawn in the crisp pass at native size). The full card has a title, a body
 *  and the controls line; the compact plate only the CREDITS button (if any) and the controls line. Every size is fitted,
 *  so nothing runs off the frame. */
export function paintPanel(ctx: CanvasRenderingContext2D, w: number, h: number, o: PanelOpts): void {
  const y0 = o.compact ? (o.button ? 0.44 : 0.7) * h : 0;   // the compact plate sits at the foot of the texture
  const ph = h - y0;
  ctx.save();
  ctx.translate(0, y0);
  const g = ctx.createLinearGradient(0, 0, 0, ph);
  g.addColorStop(0, '#120812');
  g.addColorStop(1, '#050205');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, ph);
  ctx.fillStyle = 'rgba(255,200,90,0.05)';
  for (let y = 0; y < ph; y += 4) ctx.fillRect(0, y, w, 1);
  frame(ctx, w, ph, GOLD, h / 40, h);   // inset by the full height, so the wide plate keeps a thin frame and room for its bands
  ctx.restore();
  if (!o.compact) {
    // bands inside the frame: title (to .25), body (.27 .. .73), controls hint (.78 .. .91)
    fitText(ctx, o.title, w / 2, h * 0.17, w * 0.9, h * 0.13, GOLD_HI);
    const { px, lines } = fitBody(ctx, o.body ?? o.lines ?? [], w * 0.88, (o.bodyH ?? 0.33) * h, Math.round(h * 0.15), o.maxLines);
    const step = px * 1.25;
    let y = (o.bodyTop ?? 0.27) * h + step / 2;
    for (const line of lines) {
      bodyText(ctx, line, w / 2, y, px, '#f2d9a0', 'center');
      y += step;
    }
  }
  if (o.button) drawButton(ctx, w, h, o.button);
  // the hint never drops below h * 0.075 texels (14 px on screen at 720p)
  if (o.hint) bodyText(ctx, o.hint, w / 2, h * (o.compact ? 0.86 : 0.845), fitLine(ctx, o.hint, w * 0.86, Math.round(h * 0.1), Math.round(h * 0.075)), '#8fd9ff', 'center');
}

/** A neighbour peek (the menu facets that roll in from the sides): dark enamel, gold frame, the hero entry with
 *  its roll chevron in the middle and the up / down neighbours as small dim rows. `dir` is the roll direction. */
export function paintPeek(ctx: CanvasRenderingContext2D, w: number, h: number, o: { hero: string; up: string; down: string; dir: 'left' | 'right' }): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2a0a14');
  g.addColorStop(1, '#0d0409');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  frame(ctx, w, h, GOLD, w / 12);
  const out = o.dir === 'left' ? -1 : 1;
  // hero row: chevron pointing the roll direction, then the entry
  const cy = h * 0.5;
  ctx.fillStyle = GOLD_HI;
  ctx.beginPath();
  const ax = w / 2 - out * w * 0.3, s = w * 0.09;
  ctx.moveTo(ax + out * s, cy - s * 1.2);
  ctx.lineTo(ax - out * s * 0.6, cy);
  ctx.lineTo(ax + out * s, cy + s * 1.2);
  ctx.closePath();
  ctx.fill();
  fitText(ctx, o.hero, w / 2 + out * w * 0.06, cy, w * 0.58, Math.round(w * 0.2), '#fff0c8');
  // the up / down neighbours, dim, so the whole die is advertised
  fitText(ctx, `^ ${o.up}`, w / 2, h * 0.17, w * 0.82, Math.round(w * 0.13), '#c9a86a');
  fitText(ctx, `v ${o.down}`, w / 2, h * 0.83, w * 0.82, Math.round(w * 0.13), '#c9a86a');
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

/** Screen vignette: clear in the middle, near-black at the rim. */
export function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.72);
  g.addColorStop(0, 'rgba(3,1,5,0)');
  g.addColorStop(1, 'rgba(3,1,5,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Night sky behind the skyline: near-black blue, a dim warm glow along the horizon (texture y 0.5), a few faint stars. */
export function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#04050d');
  g.addColorStop(0.3, '#080a1a');
  g.addColorStop(0.45, '#1a1530');
  g.addColorStop(0.5, '#38243a');
  g.addColorStop(0.56, '#1a1226');
  g.addColorStop(1, '#07050c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const r = createRng('menu-sky');
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = `rgba(190,200,255,${0.15 + r.next() * 0.3})`;
    ctx.fillRect(Math.floor(r.next() * w), Math.floor(r.next() * h * 0.4), 1, 1);
  }
}

/** One tower of a painted skyline, in texels: `top` is its roofline, `peak` the highest point (crown or mast). */
export interface Tower { x: number; w: number; top: number; peak: number }
export interface SkylineOpts {
  seed: string;
  /** Roofline range, as fractions of the texture height (0 = top). */
  top: readonly [number, number];
  /** Tower width range in texels. */
  width: readonly [number, number];
  body: string;
  /** Window grid pitch in texels (a lit window is half of it). */
  cell: number;
  /** Chance that a window on a lit tower is on. */
  lit: number;
  /** Extra towers forced at a place: `x` and `top` as fractions of the texture, `w` in texels. */
  tall?: ReadonlyArray<{ x: number; w: number; top: number }>;
}
const WARM = ['#ffb45a', '#ffd48a', '#ff9a4a'];
const COOL = ['#8fc8ff', '#c8e4ff', '#7ab0e8'];

/** A row of tower silhouettes standing on the bottom edge of a transparent texture, each with a grid of warm and cool lit
 *  windows (some towers dark, some bright). Returns the towers: window (col, row) of a tower sits at
 *  x + 2 + col * cell, top + cell + row * cell, which is where the menu's flickering lights go. */
export function paintSkyline(ctx: CanvasRenderingContext2D, w: number, h: number, o: SkylineOpts): Tower[] {
  const r = createRng(o.seed);
  const towers: Tower[] = [];
  for (let x = -o.width[0]; x < w;) {
    const bw = r.int(o.width[0], o.width[1]);
    const top = Math.round(h * r.float(o.top[0], o.top[1]));
    towers.push({ x, w: bw, top, peak: top });
    x += bw + r.int(0, 2);
  }
  for (const f of o.tall ?? []) towers.push({ x: Math.round(f.x * w - f.w / 2), w: f.w, top: Math.round(f.top * h), peak: Math.round(f.top * h) });
  const win = Math.max(1, o.cell >> 1);
  for (const t of towers) {
    ctx.fillStyle = o.body;
    ctx.fillRect(t.x, t.top, t.w, h - t.top);
    if (t.w >= 6 * o.cell && r.chance(0.4)) {   // a stepped crown
      ctx.fillRect(t.x + (t.w >> 2), t.top - 2 * o.cell, t.w >> 1, 2 * o.cell);
      t.peak = t.top - 2 * o.cell;
    }
    if (r.chance(0.25)) { ctx.fillRect(t.x + (t.w >> 1), t.top - 5 * o.cell, 1, 5 * o.cell); t.peak = t.top - 5 * o.cell; }   // a mast
    ctx.fillStyle = 'rgba(120,110,160,0.3)';
    ctx.fillRect(t.x, t.top, t.w, 1);   // the roofline catches a little sky
    const on = o.lit * r.float(0.2, 1);
    for (let cy = t.top + o.cell; cy < h - 1; cy += o.cell) {
      for (let cx = t.x + 2; cx + win <= t.x + t.w - 1; cx += o.cell) {
        if (!r.chance(on)) continue;
        ctx.globalAlpha = r.float(0.3, 0.85);
        ctx.fillStyle = r.pick(r.chance(0.7) ? WARM : COOL);
        ctx.fillRect(cx, cy, win, win);
      }
    }
    ctx.globalAlpha = 1;
  }
  return towers;
}

/** A band of haze (white, tinted by the material): clear at the top, thickest at texture y `peak`, thinning to the bottom. */
export function paintHaze(ctx: CanvasRenderingContext2D, w: number, h: number, peak: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(peak, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0.2)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Faint slanted streaks, the room's reflection on the window glass (white, tinted and dimmed by the material). */
export function paintSheen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  for (const [x, bw, a] of [[0.12, 0.05, 0.5], [0.2, 0.014, 0.35], [0.55, 0.09, 0.4], [0.7, 0.02, 0.3]] as const) {
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.moveTo(x * w, 0);
    ctx.lineTo((x + bw) * w, 0);
    ctx.lineTo((x + bw) * w - h * 0.6, h);
    ctx.lineTo(x * w - h * 0.6, h);
    ctx.closePath();
    ctx.fill();
  }
}

// ── The menu window: rain, lightning, landmarks, road lights, the neon sign and the room's edges ─────────────────────────
// Every painter draws on a transparent canvas, in texels, and is seeded (createRng) so a repaint is identical.

/** A tile of pale rain streaks, 1 texel wide, a soft tail above a bright head. It wraps in y, so a scrolling tile has no seam. */
export function paintRain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, n: number, len: readonly [number, number]): void {
  const r = createRng(seed);
  for (let i = 0; i < n; i++) {
    const x = r.int(0, w - 1), y0 = r.int(0, h - 1), l = r.int(len[0], len[1]), a = r.float(0.4, 1);
    for (let k = 0; k < l; k++) {
      ctx.fillStyle = `rgba(200,222,255,${a * ((k + 1) / l) ** 1.6})`;
      ctx.fillRect(x, (y0 + k) % h, 1, 1);
    }
  }
}

/** Wet glass: pale beads and the thin trails that sliding drops left behind (for a faint additive quad). */
export function paintWetGlass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = createRng('menu-wet');
  const bead = (x: number, y: number, big: boolean): void => {
    ctx.fillStyle = `rgba(200,224,255,${r.float(0.2, 0.45)})`;
    ctx.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
    if (big) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x, y, 1, 1); }
  };
  for (let i = 0; i < 28; i++) {
    const x = r.int(2, w - 3), y = r.int(0, h - 48), l = r.int(10, 44);
    for (let k = 0; k < l; k++) { ctx.fillStyle = `rgba(190,215,255,${0.05 + (0.1 * k) / l})`; ctx.fillRect(x, y + k, 1, 1); }
    bead(x, y + l, true);
  }
  for (let i = 0; i < 220; i++) bead(r.int(0, w - 2), r.int(0, h - 2), r.chance(0.12));
}

/** One drop sliding down the glass: a 3 x 3 head with a glint, a thin trail above it (3 x 16 texels). */
export function paintDrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  for (let k = 0; k < h - 3; k++) { ctx.fillStyle = `rgba(190,215,255,${0.06 + (0.3 * k) / h})`; ctx.fillRect(1, k, 1, 1); }
  ctx.fillStyle = 'rgba(160,195,245,0.6)';
  ctx.fillRect(0, h - 3, w, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillRect(0, h - 3, 1, 1);
}

/** Storm cloud streaks (white), drawn only while a flash lights them. */
export function paintClouds(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = createRng('menu-clouds');
  for (let i = 0; i < 110; i++) {
    const cw = r.int(20, 80), ch = r.int(2, 5), x = r.int(-20, w), y = r.int(2, h - 8);
    ctx.fillStyle = `rgba(255,255,255,${r.float(0.1, 0.45) * Math.sin((Math.PI * y) / h) ** 1.5})`;   // thinner towards the top and bottom edge
    ctx.fillRect(x, y, cw, ch);
    ctx.fillRect(x + (cw >> 2), y - 1, cw >> 1, ch + 2);
  }
}

/** A forked lightning bolt: a jagged 1-texel core in a pale halo, one branch. */
export function paintBolt(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const r = createRng('menu-bolt-shape');
  const px = (x: number, y: number, a: number): void => {
    ctx.fillStyle = `rgba(150,170,255,${a * 0.3})`; ctx.fillRect(x - 1, y, 3, 1);
    ctx.fillStyle = `rgba(240,244,255,${a})`; ctx.fillRect(x, y, 1, 1);
  };
  const fork = (h * 0.4) | 0;
  let x = w >> 1, bx = x;
  for (let y = 0; y < h; y++) {
    px(x, y, 1);
    if (y === fork) bx = x;
    if (y % 2 === 0) x = Math.min(w - 3, Math.max(2, x + r.int(-1, 1)));
  }
  for (let y = fork; y < h * 0.75; y++) {
    px(bx, y, 0.7);
    if (y % 2) bx = Math.min(w - 3, bx + r.int(0, 1));
  }
}

/** The room's rim light for a flash: clear in the middle, cold white at the edges (the vignette, inverted). */
export function paintRoomEdge(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.74);
  g.addColorStop(0, 'rgba(170,185,255,0)');
  g.addColorStop(1, 'rgba(170,185,255,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A velvet drape hanging from the left of the texture: wine folds that sway, a gold cord, a wavy free edge. `side` -1 mirrors it. */
export function paintCurtain(ctx: CanvasRenderingContext2D, w: number, h: number, side: 1 | -1): void {
  const edge = (y: number): number => Math.round(w * (0.78 + 0.07 * Math.sin(y * 0.05 + (side > 0 ? 0 : 2)) + 0.03 * Math.sin(y * 0.17)));
  for (let y = 0; y < h; y++) {
    const inner = edge(y);
    const shade = 0.5 + 0.5 * Math.min(1, y / (h * 0.2), (h - y) / (h * 0.1));   // the valance and the floor sit in shadow
    for (let i = 0; i < inner; i++) {
      const k = (Math.round(((Math.sin(i * 0.9 + Math.sin(y * 0.07) * 1.4) + 1) / 2) * 4) / 4) * shade * (i > inner - 3 ? 1.5 : 1);
      ctx.fillStyle = `rgb(${Math.round(14 + 34 * k)},${Math.round(3 + 6 * k)},${Math.round(8 + 14 * k)})`;
      ctx.fillRect(side > 0 ? i : w - 1 - i, y, 1, 1);
    }
  }
  const cy = Math.round(h * 0.62), len = edge(cy) - 2;
  ctx.fillStyle = '#2a200c';
  ctx.fillRect(side > 0 ? 0 : w - len, cy, len, 2);   // the tie-back cord
  ctx.fillStyle = '#140e05';
  ctx.fillRect(side > 0 ? 0 : w - len, cy + 2, len, 1);
}

/** The back of a winged armchair seen from behind (40 x 48): a tall padded back between lower arms, legs, brass nails, a warm rim on the left. */
export function paintChair(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
  const block = (x0: number, x1: number, y0: number, y1: number, r: number, c: string): void => {
    for (let y = y0; y < y1; y++) {
      const inset = y - y0 < r ? r - Math.round(Math.sqrt(r * r - (r - (y - y0) - 0.5) ** 2)) : 0;
      ctx.fillStyle = c;
      ctx.fillRect(x0 + inset, y, x1 - x0 - inset * 2, 1);
      ctx.fillStyle = 'rgba(255,150,70,0.26)';
      ctx.fillRect(x0 + inset, y, 2, 1);
    }
  };
  ctx.fillStyle = '#0a0305';
  ctx.fillRect(5, 42, 3, 6); ctx.fillRect(32, 42, 3, 6);
  ctx.fillStyle = '#1a0810';
  ctx.fillRect(3, 37, 34, 6);
  block(2, 38, 21, 38, 5, '#12050a');
  block(9, 31, 0, 38, 10, '#16070c');
  ctx.fillStyle = '#1f0b13';
  ctx.fillRect(13, 7, 14, 27);
  ctx.fillStyle = '#0c0306';
  ctx.fillRect(19, 8, 1, 26);
  ctx.fillStyle = 'rgba(214,170,70,0.55)';
  for (let x = 13; x < 27; x += 3) ctx.fillRect(x, 6, 1, 1);
  for (let x = 4; x < 36; x += 4) ctx.fillRect(x, 22, 1, 1);
}

// 3 x 5 letters of the rooftop sign, one row per number (a bit is a lit texel, left to right). The dotted capital I of KASINO
// (Turkish) is the I glyph with a dot row above it.
const GLYPH: Record<string, { w: number; rows: readonly number[] }> = {
  K: { w: 3, rows: [5, 5, 6, 5, 5] },
  A: { w: 3, rows: [2, 5, 7, 5, 5] },
  S: { w: 3, rows: [7, 4, 7, 1, 7] },
  I: { w: 3, rows: [7, 2, 2, 2, 7] },
  N: { w: 4, rows: [9, 13, 11, 9, 9] },
  O: { w: 3, rows: [7, 5, 5, 5, 7] },
};
const SIGN = ['K', 'A', 'S', 'I', 'N', 'O'];   // the 4th letter carries the dot
const BROKEN = 2;                              // the S: a tube that stutters on its own
/** The far rooftop sign (28 x 13 texels). `part`: the dark board with its legs, the lit letters, or the one broken letter. */
export function paintNeon(ctx: CanvasRenderingContext2D, _w: number, _h: number, part: 'board' | 'word' | 'broken'): void {
  if (part === 'board') {
    ctx.fillStyle = '#0a0610';
    ctx.fillRect(0, 0, 28, 10);
    ctx.fillStyle = '#5a1030';
    ctx.fillRect(0, 0, 28, 1); ctx.fillRect(0, 9, 28, 1); ctx.fillRect(0, 0, 1, 10); ctx.fillRect(27, 0, 1, 10);
    ctx.fillStyle = '#07050c';
    ctx.fillRect(4, 10, 1, 3); ctx.fillRect(23, 10, 1, 3);
    return;
  }
  ctx.fillStyle = '#ff5a8c';
  let x = 2;
  SIGN.forEach((c, i) => {
    if (part === 'broken' ? i === BROKEN : i !== BROKEN) {
      GLYPH[c].rows.forEach((row, y) => { for (let k = 0; k < GLYPH[c].w; k++) if ((row >> (GLYPH[c].w - 1 - k)) & 1) ctx.fillRect(x + k, 3 + y, 1, 1); });
      if (i === 3) ctx.fillRect(x + 1, 2, 1, 1);
    }
    x += GLYPH[c].w + 1;
  });
}

/** A filled half-disc (a dome) of radius `r` standing on row `base`, one pixel row at a time. */
function dome(ctx: CanvasRenderingContext2D, cx: number, base: number, r: number): void {
  for (let k = 0; k < r; k++) {
    const hw = Math.round(Math.sqrt(r * r - k * k));
    ctx.fillRect(cx - hw, base - k - 1, hw * 2 + 1, 1);
  }
}

/** A TV tower on a skyline texture: a slim shaft, a saucer pod with lit rooms, an aerial. Returns the aerial's tip. */
export function paintTvTower(ctx: CanvasRenderingContext2D, x: number, top: number, h: number, body: string): { x: number; y: number } {
  const pod = top + 24;
  ctx.fillStyle = body;
  ctx.fillRect(x, top, 1, 16);
  ctx.fillRect(x - 1, top + 16, 3, h - top - 16);
  [5, 9, 13, 9, 5].forEach((pw, i) => ctx.fillRect(x - (pw >> 1), pod + i, pw, 1));
  ctx.fillStyle = 'rgba(120,110,160,0.3)';
  ctx.fillRect(x - 1, top + 16, 1, pod - top - 16);
  ctx.fillStyle = 'rgba(255,196,120,0.85)';
  for (let k = -5; k <= 5; k += 2) ctx.fillRect(x + k, pod + 2, 1, 1);
  return { x, y: top };
}

/** A mosque on a skyline texture (21 texels wide): hall and big dome, two minarets, warm floodlight and lit windows. It stands on
 *  `base` and runs down to the texture foot `h`, so it reads as one more tower of the skyline. */
export function paintMosque(ctx: CanvasRenderingContext2D, cx: number, base: number, h: number, body: string): void {
  ctx.fillStyle = body;
  ctx.fillRect(cx - 7, base - 6, 15, h - base + 6);
  dome(ctx, cx, base - 6, 6);
  ctx.fillRect(cx, base - 15, 1, 3);
  for (const m of [cx - 9, cx + 9]) {
    ctx.fillRect(m - 1, base - 22, 2, h - base + 22);
    ctx.fillRect(m - 2, base - 15, 4, 1);
    ctx.fillRect(m - 1, base - 24, 2, 2);
    ctx.fillRect(m, base - 27, 1, 3);
  }
  ctx.fillStyle = 'rgba(255,170,90,0.22)';   // floodlit: the hall, the dome and the minarets above their balconies
  ctx.fillRect(cx - 7, base - 6, 15, 6);
  dome(ctx, cx, base - 6, 6);
  ctx.fillRect(cx - 10, base - 24, 2, 24);
  ctx.fillRect(cx + 8, base - 24, 2, 24);
  ctx.fillStyle = 'rgba(255,200,140,0.4)';
  for (let k = 0; k < 6; k++) ctx.fillRect(cx - Math.round(Math.sqrt(36 - k * k)), base - 7 - k, 1, 1);
  ctx.fillStyle = 'rgba(255,200,120,0.85)';
  for (let x = cx - 5; x <= cx + 5; x += 3) ctx.fillRect(x, base - 4, 1, 2);
  ctx.fillRect(cx - 10, base - 16, 2, 1);
  ctx.fillRect(cx + 8, base - 16, 2, 1);
}

/** A tower crane on a roof (`base` is the roofline): lattice mast, long jib, short counter jib, a hook. Returns the light on top. */
export function paintCrane(ctx: CanvasRenderingContext2D, x: number, base: number, body: string): { x: number; y: number } {
  const top = base - 26, apex = top - 6;
  ctx.fillStyle = body;
  for (let y = top; y < base; y++) {
    ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
    if (y % 3 === 0) ctx.fillRect(x + 1, y, 1, 1);
  }
  ctx.fillRect(x - 28, top, 40, 1);
  ctx.fillRect(x, apex, 3, 6);
  for (let i = 0; i <= 28; i++) ctx.fillRect(x - i, apex + Math.round((6 * i) / 28), 1, 1);
  for (let i = 0; i <= 10; i++) ctx.fillRect(x + 2 + i, apex + Math.round((6 * i) / 10), 1, 1);
  ctx.fillRect(x + 8, top + 1, 4, 3);
  ctx.fillRect(x - 20, top + 1, 1, 9);
  ctx.fillRect(x - 21, top + 10, 3, 2);
  ctx.fillStyle = 'rgba(120,110,160,0.3)';
  ctx.fillRect(x - 28, top - 1, 40, 1);
  ctx.fillStyle = 'rgba(255,196,120,0.9)';
  ctx.fillRect(x - 28, top + 1, 1, 1);
  return { x: x + 1, y: apex - 1 };
}

/** A far elevated road across a city texture: a thin dark deck on row `r` with a rail that catches the sky, sodium lamps above. */
export function paintRoad(ctx: CanvasRenderingContext2D, w: number, _h: number, r: number): void {
  ctx.fillStyle = 'rgba(8,6,16,0.95)';
  ctx.fillRect(0, r + 1, w, 2);
  ctx.fillStyle = 'rgba(120,110,160,0.25)';
  ctx.fillRect(0, r + 1, w, 1);
  ctx.fillStyle = 'rgba(255,176,96,0.6)';
  for (let x = 3; x < w; x += 8) ctx.fillRect(x, r - 3, 1, 1);
}

/** One lane of car lights, a strip that tiles: a 2-texel white head and a 1-texel red tail, 3 apart, moving `dir` (-1 left, +1 right). */
export function paintCars(ctx: CanvasRenderingContext2D, w: number, _h: number, dir: 1 | -1, seed: string): void {
  const r = createRng(seed);
  for (let x = r.int(0, 12); x < w - 8; x += r.int(14, 34)) {
    const head = dir < 0 ? x : x + 2, tail = dir < 0 ? x + 3 : x;
    ctx.fillStyle = 'rgba(255,238,200,0.95)';
    ctx.fillRect(head, 0, 2, 1);
    ctx.fillStyle = 'rgba(255,50,40,0.95)';
    ctx.fillRect(tail, 0, 1, 1);
  }
}
