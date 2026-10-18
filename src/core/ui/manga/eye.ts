/**
 * THE GAMBLER'S EYE (STORY_BIBLE section 6.5 and 6.6). A short slow-motion read used when a tell is visible: the world slows and goes
 * grey under a dark vignette, a manga eye panel cuts in (the rival's eye with the coloured rim, a sideways glance at the watch, or
 * the watch glass holding your glove), a heartbeat and a sting land, and one inner thought is shown. The panel is drawn in code
 * (no image files) in the same ink / paper / one-accent look as the cut-ins.
 *
 *   gamblersEye({ rival, kind, line, hand })   kind 'watch' (a glance), 'glass' (the reflection), 'wide' (the key-throw cut, 0.6 s)
 *
 * It rides the manga presentation queue, so it runs after the one in front, honours Skip (and Esc / E), and is skipped when seeking.
 * Calm Mode: no flash, no hit-stop, no slide or zoom, a softer vignette, a quieter sting; the slow motion and the thought stay.
 * reduceFlashing: no white flash. The world half of the cut (zoom, slow motion, tint) is `eyeCloseUp` in core/cutscene/effects.ts.
 */
import { has, t } from '@/core/i18n';
import { app } from '@/core/app';
import { eyeCloseUp } from '@/core/cutscene/effects';
import { innerLine } from './inner';
import { portraitSpec } from './portrait';
import { el, enqueue, pause, show, skipButton, stage } from './mangaPanel';

export type EyeKind = 'watch' | 'glass' | 'wide';
export interface EyeOpts {
  /** Rival portrait id: its accent colour is the rim of the eye. */
  rival?: string;
  kind?: EyeKind;
  /** i18n key of the inner thought (shown with the panel). */
  line?: string;
  /** For 'glass': the hand the glass shows ('rock' | 'paper' | 'scissors'). */
  hand?: string;
}

const STYLE_ID = 'mg-eye-style';
const CSS = `
.mg-eye-stage .eye-grey{position:absolute;inset:0;opacity:0;transition:opacity .22s ease-out;background:rgba(30,34,44,.28);
  backdrop-filter:grayscale(.92) contrast(1.08) brightness(.82);-webkit-backdrop-filter:grayscale(.92) contrast(1.08) brightness(.82)}
.mg-eye-stage .eye-vig{position:absolute;inset:0;opacity:0;transition:opacity .28s ease-out;
  background:radial-gradient(ellipse at 50% 46%,transparent 34%,rgba(6,4,10,.5) 66%,rgba(6,4,10,.9) 100%)}
.mg-eye-stage.on .eye-grey,.mg-eye-stage.on .eye-vig{opacity:1}
.mg-eye-stage[data-calm] .eye-grey{backdrop-filter:grayscale(.55);-webkit-backdrop-filter:grayscale(.55);background:rgba(30,34,44,.12)}
.mg-eye-stage[data-calm] .eye-vig{background:radial-gradient(ellipse at 50% 46%,transparent 42%,rgba(6,4,10,.35) 74%,rgba(6,4,10,.6) 100%)}
.mg-eye-stage .eye-panel{position:absolute;left:50%;top:44%;width:min(80vw,740px);aspect-ratio:720/270;opacity:0;
  transform:translate(-50%,-50%) skewX(-6deg) scale(1.14);transition:transform .45s cubic-bezier(.1,.9,.2,1),opacity .06s linear;
  filter:drop-shadow(0 6px 0 rgba(0,0,0,.55))}
.mg-eye-stage .eye-panel.in{opacity:1;transform:translate(-50%,-50%) skewX(-6deg) scale(1)}
.mg-eye-stage .eye-panel canvas{display:block;width:100%;height:100%;image-rendering:auto}
.mg-eye-stage[data-calm] .eye-panel{transform:translate(-50%,-50%);transition:opacity .4s ease-out}
.mg-eye-stage[data-calm] .eye-panel.in{transform:translate(-50%,-50%)}
@media (prefers-reduced-motion:reduce){.mg-eye-stage .eye-panel{transform:translate(-50%,-50%);transition:opacity .3s}.mg-eye-stage .eye-panel.in{transform:translate(-50%,-50%)}}
`;

function styleOnce(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── the panel ────────────────────────────────────────────────────────────────────────────────────────────
const W = 720;
const H = 270;

/** A stable 0..1 value for speed lines (no Math.random: the same panel always looks the same). */
const hash01 = (i: number): number => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function speedLines(g: CanvasRenderingContext2D, cx: number, cy: number, ink: string, inner: number): void {
  g.fillStyle = ink;
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash01(i) * 0.05;
    const wide = 0.004 + hash01(i + 40) * 0.016;
    const r0 = inner * (1 + hash01(i + 7) * 0.5);
    const r1 = W;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - wide) * r1, cy + Math.sin(a - wide) * r1);
    g.lineTo(cx + Math.cos(a + wide) * r1, cy + Math.sin(a + wide) * r1);
    g.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.closePath();
    g.fill();
  }
}

function halftone(g: CanvasRenderingContext2D, ink: string): void {
  g.fillStyle = ink;
  for (let y = 10; y < H; y += 12) {
    for (let x = ((y / 12) % 2) * 6 + 4; x < W; x += 12) {
      const k = Math.max(0, (y - H * 0.55) / (H * 0.45));
      if (k <= 0) continue;
      g.beginPath();
      g.arc(x, y, 0.8 + k * 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

interface Pal { ink: string; paper: string; accent: string }

function paintEye(g: CanvasRenderingContext2D, p: Pal, glance: boolean, wide: boolean): void {
  const cx = W / 2;
  const cy = H * 0.5;
  const ew = W * 0.34;
  const eh = H * (wide ? 0.3 : 0.25);
  const lid = (): void => {
    g.beginPath();
    g.moveTo(cx - ew, cy + eh * 0.12);
    g.quadraticCurveTo(cx - ew * 0.1, cy - eh * 2.1, cx + ew, cy - eh * 0.08);
    g.quadraticCurveTo(cx + ew * 0.1, cy + eh * 1.55, cx - ew, cy + eh * 0.12);
    g.closePath();
  };
  g.save();
  lid();
  g.clip();
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, W, H);
  const ix = cx + (glance ? ew * 0.4 : 0);
  const iy = cy + (glance ? eh * 0.34 : -eh * 0.05);
  const ir = eh * 1.12;
  const grad = g.createRadialGradient(ix, iy, ir * 0.15, ix, iy, ir);
  grad.addColorStop(0, '#120a0c');
  grad.addColorStop(0.5, p.accent);
  grad.addColorStop(1, p.ink);
  g.fillStyle = grad;
  g.beginPath(); g.arc(ix, iy, ir, 0, Math.PI * 2); g.fill();
  g.fillStyle = p.ink;
  g.beginPath(); g.arc(ix, iy, ir * (wide ? 0.34 : 0.5), 0, Math.PI * 2); g.fill();
  // lid shadow: hatch over the top of the iris
  g.strokeStyle = p.ink; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const x = ix - ir + (i / 8) * ir * 2;
    g.beginPath(); g.moveTo(x, iy - ir); g.lineTo(x + 8, iy - ir * 0.35); g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(ix - ir * 0.34, iy - ir * 0.36, ir * 0.17, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(ix + ir * 0.3, iy + ir * 0.3, ir * 0.07, 0, Math.PI * 2); g.fill();
  g.restore();
  // lid lines, lash flick, brow
  g.strokeStyle = p.ink; g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = 11;
  g.beginPath(); g.moveTo(cx - ew, cy + eh * 0.12); g.quadraticCurveTo(cx - ew * 0.1, cy - eh * 2.1, cx + ew, cy - eh * 0.08); g.stroke();
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(cx - ew, cy + eh * 0.12); g.quadraticCurveTo(cx + ew * 0.1, cy + eh * 1.55, cx + ew, cy - eh * 0.08); g.stroke();
  g.lineWidth = 8;
  g.beginPath(); g.moveTo(cx + ew, cy - eh * 0.08); g.lineTo(cx + ew + W * 0.055, cy - eh * 0.55); g.stroke();
  g.fillStyle = p.ink;
  g.beginPath();
  g.moveTo(cx - ew * 0.95, cy - eh * 2.2);
  g.quadraticCurveTo(cx, cy - eh * 2.9, cx + ew * 0.95, cy - eh * 2.05);
  g.lineTo(cx + ew * 0.8, cy - eh * 1.78);
  g.quadraticCurveTo(cx, cy - eh * 2.4, cx - ew * 0.85, cy - eh * 1.95);
  g.closePath(); g.fill();
  g.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.moveTo(cx - ew * 0.5 + i * 38, cy + eh * 1.6); g.lineTo(cx - ew * 0.5 + i * 38 + 22, cy + eh * 1.9); g.stroke();
  }
}

/** A small cracked pocket watch in the corner of the 'watch' panel: where he is looking. */
function paintWatch(g: CanvasRenderingContext2D, p: Pal, x: number, y: number, r: number): void {
  g.fillStyle = '#b08a3a'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e9efe8'; g.beginPath(); g.arc(x, y, r * 0.8, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.ink; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + r * 0.1, y - r * 0.55); g.moveTo(x, y); g.lineTo(x + r * 0.42, y + r * 0.12); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x - r * 0.6, y - r * 0.5); g.lineTo(x - r * 0.1, y + r * 0.15); g.lineTo(x + r * 0.3, y + r * 0.7); g.stroke();
  g.lineWidth = 5; g.strokeStyle = p.ink; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}

/** A gloved hand as a plain white shape with an ink outline, centred on (x, y), about `s` px tall. */
function glove(g: CanvasRenderingContext2D, p: Pal, x: number, y: number, s: number, hand: string): void {
  g.fillStyle = '#fbfbf6'; g.strokeStyle = p.ink; g.lineWidth = 4; g.lineJoin = 'round';
  const part = (px: number, py: number, w: number, h: number, r: number, rot = 0): void => {
    g.save(); g.translate(px, py); g.rotate(rot); rr(g, -w / 2, -h / 2, w, h, r); g.fill(); g.stroke(); g.restore();
  };
  if (hand === 'paper') {
    part(x, y + s * 0.2, s * 0.62, s * 0.5, s * 0.1);
    const len = [0.42, 0.52, 0.48, 0.36];
    for (let i = 0; i < 4; i++) part(x - s * 0.24 + i * s * 0.16, y - s * 0.12 - len[i] * s * 0.5, s * 0.14, s * len[i], s * 0.06);
    part(x + s * 0.4, y + s * 0.12, s * 0.3, s * 0.14, s * 0.06, -0.5);
  } else if (hand === 'scissors') {
    part(x, y + s * 0.26, s * 0.5, s * 0.4, s * 0.1);
    part(x - s * 0.08, y - s * 0.12, s * 0.13, s * 0.62, s * 0.06, -0.2);
    part(x + s * 0.12, y - s * 0.12, s * 0.13, s * 0.62, s * 0.06, 0.2);
    part(x + s * 0.3, y + s * 0.24, s * 0.26, s * 0.13, s * 0.06, -0.4);
  } else {
    part(x, y + s * 0.05, s * 0.62, s * 0.5, s * 0.14);
    for (let i = 0; i < 4; i++) part(x - s * 0.23 + i * s * 0.155, y - s * 0.22, s * 0.14, s * 0.15, s * 0.06);
    part(x + s * 0.02, y + s * 0.16, s * 0.4, s * 0.15, s * 0.07, -0.1);
  }
}

function paintGlass(g: CanvasRenderingContext2D, p: Pal, hand: string): void {
  const cx = W / 2;
  const cy = H * 0.5;
  const r = H * 0.43;
  g.fillStyle = '#b08a3a'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  const gl = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r * 0.88);
  gl.addColorStop(0, '#f3fbff'); gl.addColorStop(1, '#a9c7d6');
  g.fillStyle = gl; g.beginPath(); g.arc(cx, cy, r * 0.88, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, r * 0.88, 0, Math.PI * 2); g.clip();
  g.globalAlpha = 0.9;
  glove(g, p, cx, cy + r * 0.02, r * 1.25, hand);
  g.globalAlpha = 1;
  g.strokeStyle = p.ink; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx - r * 0.55, cy - r * 0.8); g.lineTo(cx - r * 0.08, cy - r * 0.05); g.lineTo(cx + r * 0.3, cy + r * 0.85); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 8;
  g.beginPath(); g.moveTo(cx - r * 0.7, cy - r * 0.1); g.lineTo(cx - r * 0.1, cy - r * 0.7); g.stroke();
  g.restore();
  g.strokeStyle = p.ink; g.lineWidth = 7;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, r * 0.88, 0, Math.PI * 2); g.stroke();
}

/** Paints one Gambler's Eye panel onto a 720 x 270 canvas. */
export function paintEyePanel(canvas: HTMLCanvasElement, kind: EyeKind, p: Pal, hand = ''): void {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = p.paper; g.fillRect(0, 0, W, H);
  halftone(g, p.ink);
  speedLines(g, W / 2, H / 2, p.ink, kind === 'glass' ? H * 0.5 : H * 0.42);
  if (kind === 'glass') paintGlass(g, p, hand);
  else {
    paintEye(g, p, kind === 'watch', kind === 'wide');
    if (kind === 'watch') paintWatch(g, p, W * 0.88, H * 0.8, H * 0.16);
  }
  g.strokeStyle = p.ink; g.lineWidth = 12; g.strokeRect(0, 0, W, H);
}

// ── the presentation ─────────────────────────────────────────────────────────────────────────────────────
function sfx(name: 'heartbeat' | 'stinger', vol: number): void {
  try { void app.audio.play(name, { vol }); } catch { /* audio not ready (menu, tests) */ }
}

/**
 * Plays one Gambler's Eye moment. Resolves when it has faded out (or was skipped). Safe to call without a DOM: it then resolves at once.
 */
export function gamblersEye(o: EyeOpts = {}): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const kind: EyeKind = o.kind ?? 'watch';
  return enqueue(async (ctl) => {
    styleOnce();
    const calm = ctl.m.calm;
    const quick = kind === 'wide';
    const spec = portraitSpec(o.rival ?? 'lucan').palette;
    const host = stage(ctl, 'mg-eye-stage');
    const canvas = document.createElement('canvas');
    paintEyePanel(canvas, kind, { ink: spec.ink, paper: spec.paper, accent: spec.accent }, o.hand);
    const panel = el('div', 'eye-panel');
    panel.append(canvas);
    host.append(el('div', 'eye-grey'), el('div', 'eye-vig'), panel, skipButton(ctl));
    show(host);
    sfx('heartbeat', calm ? 0.3 : 0.55);
    try { eyeCloseUp({ calm, noFlash: ctl.m.noFlash, dur: quick ? 0.6 : 1.1, read: !quick }); } catch { /* no live world (bench) */ }
    await pause(ctl, quick ? 120 : calm ? 320 : 400);          // the world slows and greys first
    panel.classList.add('in');
    sfx('stinger', calm ? 0.25 : 0.6);
    if (o.line && has(o.line)) innerLine(t(o.line));
    await pause(ctl, quick ? 650 : calm ? 1400 : 1500);
    panel.classList.remove('in');
    host.classList.remove('on');
    await pause(ctl, 240);
  });
}
