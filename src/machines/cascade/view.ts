/**
 * Gilded Cascade — the cabinet screen. A 216 × 192 canvas (nearest-neighbour on the 3D screen mesh) drawn from a small
 * scene: 30 animated cells, pixel particles, orbs in flight, a header, a multiplier meter, a footer and two overlays
 * (the banner and the big-win ladder). It owns no rules and no text: `index.ts` pushes already translated strings and
 * drives the numbers with tweens; this file only paints. Nothing here runs at import time (no DOM on load).
 *
 * PSX honesty: flat colours, 1-px outlines, integer positions, stepped flashes, chunky square particles.
 */
import type { ScreenSurface } from '@/kit/types';
import { COLS, ROWS, CELLS, SCATTER, SYM_N, at, isOrb, orbValue } from './rules';

export const SCREEN_PX: [number, number] = [216, 192];
export const CELL = 30;
export const GX = 18;
export const GY = 22;
const GW = COLS * CELL;
const GH = ROWS * CELL;

const BG = '#0b0710';
const CELL_A = '#160d1d';
const CELL_B = '#1c1125';
const GOLD = '#ffd040';
const CRIMSON = '#c01830';
const INK = '#120a18';

export type VCell = {
  code: number;
  /** Row position in cell units (float while falling). */
  row: number;
  /** Scale and alpha of the sprite, 0..1+. */
  sc: number;
  al: number;
  /** 0 none, 1 flashing white (a paying cell), 2 orb pulse. */
  hl: number;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; s: number };
type Pop = { x: number; y: number; text: string; col: string; life: number };
type Fly = { x0: number; y0: number; x1: number; y1: number; k: number; dur: number; col: string; text: string };
export type Banner = { text: string; sub: string; k: number; col: string };
export type BigShow = { title: string; amount: string; k: number; tier: number };

export const orbColour = (v: number): string => (v <= 5 ? '#3a7aff' : v <= 10 ? '#a848ff' : v <= 20 ? '#ff48a8' : GOLD);

/** The biggest integer scale (≤ `max`) at which `str` still fits `w` pixels in the 6-px bitmap font. */
const fit = (str: string, w: number, max: number): number => {
  for (let k = max; k > 1; k--) if (str.length * 6 * k <= w) return k;
  return 1;
};
const nearest = (g: CanvasRenderingContext2D): void => { g.imageSmoothingEnabled = false; };

function mk(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  nearest(g);
  return { c, g };
}
const circ = (g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void => {
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
};
const box = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void => {
  g.fillStyle = col; g.fillRect(x, y, w, h);
};

/** The nine symbols + the scatter, 30 × 30 each, painted once. */
function paintSymbol(g: CanvasRenderingContext2D, id: number): void {
  switch (id) {
    case 0: { // dice: a red die with white pips
      box(g, 4, 4, 22, 22, INK); box(g, 5, 5, 20, 20, '#d02838'); box(g, 5, 5, 20, 3, '#f06070');
      for (const [x, y] of [[10, 10], [20, 10], [15, 15], [10, 20], [20, 20]]) circ(g, x, y, 2.2, '#fff4e8');
      break;
    }
    case 1: { // chip: blue chip, white edge blocks
      circ(g, 15, 15, 13, INK); circ(g, 15, 15, 12, '#2a62d8');
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        g.save(); g.translate(15 + Math.cos(a) * 10, 15 + Math.sin(a) * 10); g.rotate(a);
        box(g, -1.5, -3, 3, 6, '#f4f0e8'); g.restore();
      }
      circ(g, 15, 15, 7, '#1a44a0'); circ(g, 15, 15, 5, '#2a62d8'); circ(g, 15, 15, 2, '#f4f0e8');
      break;
    }
    case 2: { // key: a brass key set on the slant
      g.save(); g.translate(15, 15); g.rotate(-0.7);
      circ(g, -8, 0, 7, INK); circ(g, -8, 0, 6, '#e0b040'); circ(g, -8, 0, 2.6, INK);
      box(g, -3, -2, 18, 4, INK); box(g, -2, -1, 16, 2, '#e0b040');
      box(g, 8, 1, 3, 6, INK); box(g, 9, 1, 1, 5, '#e0b040'); box(g, 12, 1, 3, 4, INK); box(g, 13, 1, 1, 3, '#e0b040');
      g.restore();
      break;
    }
    case 3: { // card: an ace, a heart on white
      box(g, 7, 2, 16, 26, INK); box(g, 8, 3, 14, 24, '#f4efe4');
      circ(g, 12.5, 13, 3.6, '#d02838'); circ(g, 17.5, 13, 3.6, '#d02838');
      g.fillStyle = '#d02838'; g.beginPath(); g.moveTo(9, 14.5); g.lineTo(21, 14.5); g.lineTo(15, 22); g.closePath(); g.fill();
      box(g, 10, 5, 2, 4, '#d02838'); box(g, 10, 5, 4, 1, '#d02838');
      break;
    }
    case 4: { // ring: gold band, cyan stone
      g.strokeStyle = INK; g.lineWidth = 6; g.beginPath(); g.arc(15, 19, 8, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#f0c040'; g.lineWidth = 4; g.beginPath(); g.arc(15, 19, 8, 0, Math.PI * 2); g.stroke();
      g.fillStyle = INK; g.beginPath(); g.moveTo(15, 1); g.lineTo(22, 8); g.lineTo(15, 14); g.lineTo(8, 8); g.closePath(); g.fill();
      g.fillStyle = '#48e0ff'; g.beginPath(); g.moveTo(15, 3); g.lineTo(20, 8); g.lineTo(15, 12); g.lineTo(10, 8); g.closePath(); g.fill();
      box(g, 12, 5, 3, 3, '#e8ffff');
      break;
    }
    case 5: { // watch: a pocket watch
      box(g, 12, 2, 6, 5, INK); box(g, 13, 3, 4, 3, '#e8b830');
      circ(g, 15, 18, 12, INK); circ(g, 15, 18, 11, '#e8b830'); circ(g, 15, 18, 8.5, '#f4efe4');
      box(g, 14, 12, 2, 7, INK); box(g, 15, 17, 5, 2, INK);
      for (const [x, y] of [[15, 11], [15, 25], [8, 18], [22, 18]]) box(g, x - 0.5, y - 0.5, 1, 1, '#d02838');
      break;
    }
    case 6: { // mask: a purple domino mask
      g.fillStyle = INK; g.beginPath(); g.moveTo(2, 10); g.quadraticCurveTo(15, 2, 28, 10); g.lineTo(26, 21); g.quadraticCurveTo(21, 25, 17, 18); g.lineTo(13, 18); g.quadraticCurveTo(9, 25, 4, 21); g.closePath(); g.fill();
      g.fillStyle = '#8a30b8'; g.beginPath(); g.moveTo(4, 11); g.quadraticCurveTo(15, 4, 26, 11); g.lineTo(24.5, 19.5); g.quadraticCurveTo(21, 23, 17.5, 17); g.lineTo(12.5, 17); g.quadraticCurveTo(9, 23, 5.5, 19.5); g.closePath(); g.fill();
      g.fillStyle = INK; g.beginPath(); g.ellipse(9.5, 14, 3.4, 2.4, -0.3, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(20.5, 14, 3.4, 2.4, 0.3, 0, Math.PI * 2); g.fill();
      box(g, 14, 8, 2, 4, GOLD); box(g, 4, 11, 22, 1, '#d8a0ff');
      break;
    }
    case 7: { // bag: a money bag
      circ(g, 15, 19, 10.5, INK); circ(g, 15, 19, 9.5, '#c09040');
      g.fillStyle = INK; g.beginPath(); g.moveTo(9, 4); g.lineTo(21, 4); g.lineTo(19, 12); g.lineTo(11, 12); g.closePath(); g.fill();
      g.fillStyle = '#c09040'; g.beginPath(); g.moveTo(10.5, 5); g.lineTo(19.5, 5); g.lineTo(18, 11); g.lineTo(12, 11); g.closePath(); g.fill();
      box(g, 10, 11, 10, 2, CRIMSON);
      g.fillStyle = '#2a4a18'; g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.fillText('$', 15, 24);
      break;
    }
    case 8: { // coin: the big gold coin
      circ(g, 15, 15, 14, INK); circ(g, 15, 15, 13, '#ffcc20'); circ(g, 15, 15, 10, '#fff080'); circ(g, 15, 15, 9, '#ffcc20');
      g.fillStyle = '#b87810'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? 7 : 3; const a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(15 + Math.cos(a) * r, 15 + Math.sin(a) * r); }
      g.closePath(); g.fill();
      break;
    }
    default: { // the scatter: a crimson wheel with gold spokes
      circ(g, 15, 15, 14, INK); circ(g, 15, 15, 13, GOLD); circ(g, 15, 15, 11, CRIMSON);
      g.strokeStyle = GOLD; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.moveTo(15 - Math.cos(a) * 11, 15 - Math.sin(a) * 11); g.lineTo(15 + Math.cos(a) * 11, 15 + Math.sin(a) * 11); g.stroke(); }
      circ(g, 15, 15, 5, INK); circ(g, 15, 15, 3.4, '#f4efe4'); box(g, 14, 14, 2, 2, CRIMSON);
    }
  }
}

export class CascadeView {
  readonly cells: VCell[] = [];
  head = { l: '', r: '' };
  meter = { label: '', value: 0, on: false, flash: 0 };
  foot = { l: '', r: '', pulse: 0 };
  banner: Banner | null = null;
  big: BigShow | null = null;
  /** Greys the grid while a pause is on (the scatter freeze). */
  dim = 0;
  /** True while something moves by itself (particles, orbs in flight, the overlays). */
  live = false;
  dirty = true;
  private readonly sprites: HTMLCanvasElement[] = [];
  private parts: Particle[] = [];
  private flys: Fly[] = [];
  private pops: Pop[] = [];
  private clock = 0;

  constructor(private readonly scr: ScreenSurface) {
    for (let i = 0; i <= SYM_N; i++) {
      const { c, g } = mk(CELL, CELL);
      paintSymbol(g, i);
      this.sprites.push(c);
    }
    for (let i = 0; i < CELLS; i++) this.cells.push({ code: 0, row: i % ROWS, sc: 1, al: 1, hl: 0 });
  }

  /** Put a whole grid at rest. */
  setGrid(codes: readonly number[]): void {
    for (let i = 0; i < CELLS; i++) { const c = this.cells[i]; c.code = codes[i]; c.row = i % ROWS; c.sc = 1; c.al = 1; c.hl = 0; }
    this.dirty = true;
  }
  codes(): number[] { return this.cells.map((c) => c.code); }

  /** Pixel centre of a cell at its resting spot. */
  centre(col: number, row: number): [number, number] { return [GX + col * CELL + CELL / 2, GY + row * CELL + CELL / 2]; }
  /** Metres-free position of the meter (for orbs to fly to). */
  meterPos(): [number, number] { return [108, 10]; }

  burst(col: number, row: number, colour: string, n: number, speed = 1): void {
    const [x, y] = this.centre(col, row);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.4;
      const v = (18 + (i % 4) * 9) * speed;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 14, life: 0, max: 0.45 + (i % 3) * 0.12, col: colour, s: i % 2 ? 2 : 3 });
    }
    this.live = true;
  }
  fly(col: number, row: number, text: string, colour: string, dur: number): void {
    const [x, y] = this.centre(col, row);
    const [mx, my] = this.meterPos();
    this.flys.push({ x0: x, y0: y, x1: mx, y1: my, k: 0, dur, col: colour, text });
    this.live = true;
  }
  /** A short number that rises from a cell and fades (a tumble's pay). */
  pop(col: number, row: number, text: string, colour: string): void {
    const [x, y] = this.centre(col, row);
    this.pops.push({ x, y, text, col: colour, life: 0 });
    this.live = true;
  }
  confetti(n: number): void {
    const cols = [GOLD, CRIMSON, '#48e0ff', '#f4efe4', '#a848ff'];
    for (let i = 0; i < n; i++) {
      this.parts.push({ x: GX + ((i * 37) % GW), y: GY - 4 - (i % 5) * 3, vx: ((i % 7) - 3) * 6, vy: 20 + (i % 6) * 8, life: 0, max: 1.4 + (i % 5) * 0.2, col: cols[i % cols.length], s: 2 });
    }
    this.live = true;
  }

  /** Sim-time step: particles and flights. Returns true when it wants a repaint. */
  update(dt: number): boolean {
    this.clock += dt;
    let moved = false;
    if (this.parts.length) {
      for (const p of this.parts) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; }
      this.parts = this.parts.filter((p) => p.life < p.max);
      moved = true;
    }
    if (this.flys.length) {
      for (const f of this.flys) f.k = Math.min(1, f.k + dt / f.dur);
      this.flys = this.flys.filter((f) => f.k < 1);
      moved = true;
    }
    if (this.pops.length) {
      for (const p of this.pops) p.life += dt;
      this.pops = this.pops.filter((p) => p.life < 0.9);
      moved = true;
    }
    if (this.meter.flash > 0) { this.meter.flash = Math.max(0, this.meter.flash - dt * 3); moved = true; }
    if (this.foot.pulse > 0) { this.foot.pulse = Math.max(0, this.foot.pulse - dt * 3); moved = true; }
    this.live = moved || !!this.banner || !!this.big;
    return moved || this.dirty || this.live;
  }

  draw(): void {
    this.dirty = false;
    const t = this.clock;
    this.scr.draw((g, sc) => {
      nearest(g);
      g.fillStyle = BG; g.fillRect(0, 0, SCREEN_PX[0], SCREEN_PX[1]);
      // frame: a crimson rail with a gold edge around the grid
      box(g, GX - 3, GY - 3, GW + 6, GH + 6, GOLD); box(g, GX - 2, GY - 2, GW + 4, GH + 4, CRIMSON); box(g, GX - 1, GY - 1, GW + 2, GH + 2, INK);
      // cells
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) box(g, GX + c * CELL, GY + r * CELL, CELL, CELL, (c + r) % 2 ? CELL_A : CELL_B);
      g.save();
      g.beginPath(); g.rect(GX, GY, GW, GH); g.clip();
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const v = this.cells[at(c, r)];
          if (v.al <= 0.02 || v.code < 0) continue;
          this.drawCell(g, sc, v, c, t);
        }
      }
      if (this.dim > 0) { g.globalAlpha = this.dim; box(g, GX, GY, GW, GH, '#000000'); g.globalAlpha = 1; }
      g.restore();
      // particles and flights
      for (const p of this.parts) {
        g.globalAlpha = Math.max(0, 1 - p.life / p.max);
        box(g, Math.round(p.x), Math.round(p.y), p.s, p.s, p.col);
      }
      g.globalAlpha = 1;
      for (const f of this.flys) {
        const k = f.k * f.k * (3 - 2 * f.k);
        const x = f.x0 + (f.x1 - f.x0) * k;
        const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 14;
        circ(g, Math.round(x), Math.round(y), 5, f.col);
        circ(g, Math.round(x) - 1, Math.round(y) - 1, 2, '#ffffff');
      }
      for (const p of this.pops) {
        const x = Math.max(14, Math.min(SCREEN_PX[0] - 14, p.x));
        sc.text(p.text, Math.round(x), Math.round(p.y - 4 - p.life * 18), { font: 'px5', color: p.col, align: 'center', outline: INK });
      }
      this.drawHud(g, sc);
      if (this.banner) this.drawBanner(g, sc, this.banner);
      if (this.big) this.drawBig(g, sc, this.big, t);
    });
  }

  private drawCell(g: CanvasRenderingContext2D, sc: ScreenSurface, v: VCell, c: number, t: number): void {
    const x = GX + c * CELL;
    const y = Math.round(GY + v.row * CELL);
    const k = v.sc;
    g.globalAlpha = Math.min(1, v.al);
    if (v.hl === 1) {
      // a paying cell flashes: a white plate under the sprite, stepped
      const on = Math.floor(t * 14) % 2 === 0;
      g.globalAlpha = Math.min(1, v.al) * (on ? 0.55 : 0.22);
      box(g, x + 1, y + 1, CELL - 2, CELL - 2, '#fff2b0');
      g.globalAlpha = Math.min(1, v.al);
    }
    if (isOrb(v.code)) {
      const val = orbValue(v.code);
      const col = orbColour(val);
      const pulse = v.hl === 2 ? 1 + 0.18 * Math.sin(t * 24) : 1;
      const r = Math.round(11 * k * pulse);
      const cx = x + CELL / 2, cy = y + CELL / 2;
      circ(g, cx, cy, r + 3, 'rgba(255,255,255,0.18)');
      circ(g, cx, cy, r + 1, INK);
      circ(g, cx, cy, r, col);
      circ(g, cx - 3, cy - 4, Math.max(1, Math.round(r * 0.28)), 'rgba(255,255,255,0.7)');
      if (k > 0.3) sc.text(`x${val}`, cx, cy - 2, { font: 'px5', color: '#ffffff', align: 'center', outline: '#101018' });
    } else {
      const spr = this.sprites[v.code === SCATTER ? SYM_N : v.code];
      if (spr) {
        const w = Math.max(1, Math.round(CELL * k));
        const wob = v.code === SCATTER ? Math.round(Math.sin(t * 6) * 1) : 0;
        g.drawImage(spr, x + Math.round((CELL - w) / 2), y + Math.round((CELL - w) / 2) + wob, w, w);
      }
    }
    g.globalAlpha = 1;
  }

  private drawHud(g: CanvasRenderingContext2D, sc: ScreenSurface): void {
    box(g, 0, 0, SCREEN_PX[0], 18, INK); box(g, 0, 18, SCREEN_PX[0], 1, CRIMSON);
    sc.text(this.head.l, 4, 6, { font: 'px5', color: GOLD });
    sc.text(this.head.r, SCREEN_PX[0] - 4, 6, { font: 'px5', color: '#b8b8c8', align: 'right' });
    if (this.meter.on) {
      const m = this.meter;
      const w = 64, h = 13, x = 108 - w / 2, y = 3;
      box(g, x - 1, y - 1, w + 2, h + 2, m.flash > 0 ? '#ffffff' : GOLD);
      box(g, x, y, w, h, m.flash > 0 ? '#7a1c78' : '#2a0c30');
      sc.text(m.label, 108, y + 1, { font: 'px5', color: '#c8a0e8', align: 'center' });
      sc.text(`x${m.value}`, 108, y + 7, { font: 'px5', color: m.flash > 0 ? '#ffffff' : GOLD, align: 'center' });
    }
    // footer: the running win
    const fy = GY + GH + 6;
    box(g, 0, fy - 2, SCREEN_PX[0], SCREEN_PX[1] - fy + 2, INK); box(g, 0, fy - 3, SCREEN_PX[0], 1, CRIMSON);
    sc.text(this.foot.l, 6, fy + 3, { font: 'px5', color: '#b8b8c8' });
    sc.text(this.foot.r, SCREEN_PX[0] - 6, fy + 1, { font: 'px5', color: this.foot.pulse > 0 ? '#ffffff' : GOLD, align: 'right', scale: 2 });
  }

  private drawBanner(g: CanvasRenderingContext2D, sc: ScreenSurface, b: Banner): void {
    const k = b.k;
    const pop = k < 0.12 ? k / 0.12 : 1;
    const out = k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1;
    const a = pop * out;
    const hh = Math.round(34 * a);
    const y = GY + GH / 2 - hh / 2;
    g.globalAlpha = 0.9 * out;
    box(g, GX, y, GW, hh, '#000000');
    g.globalAlpha = 1;
    if (hh >= 30) {
      box(g, GX, y, GW, 2, b.col); box(g, GX, y + hh - 2, GW, 2, b.col);
      const ks = fit(b.text, GW - 8, 3);
      sc.text(b.text, GX + GW / 2, y + 7 + (3 - ks) * 3, { font: 'px5', color: b.col, align: 'center', scale: ks, outline: INK });
      if (b.sub) sc.text(b.sub, GX + GW / 2, y + 25, { font: 'px5', color: '#f4efe4', align: 'center' });
    }
  }

  private drawBig(g: CanvasRenderingContext2D, sc: ScreenSurface, b: BigShow, t: number): void {
    const a = Math.min(1, b.k * 6);
    g.globalAlpha = 0.82 * a;
    box(g, 0, 0, SCREEN_PX[0], SCREEN_PX[1], '#000000');
    g.globalAlpha = a;
    // rays: stepped wedges turning behind the title
    const cx = SCREEN_PX[0] / 2, cy = 82;
    g.fillStyle = b.tier >= 3 ? 'rgba(255,208,64,0.30)' : 'rgba(255,208,64,0.20)';
    for (let i = 0; i < 12; i++) {
      const a0 = t * 0.9 + (i * Math.PI) / 6;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * 130, cy + Math.sin(a0) * 130); g.lineTo(cx + Math.cos(a0 + 0.2) * 130, cy + Math.sin(a0 + 0.2) * 130); g.closePath(); g.fill();
    }
    const sz = Math.min(b.k < 0.15 ? 2 + (b.k / 0.15) : 3, fit(b.title, SCREEN_PX[0] - 10, 3));
    const bob = Math.round(Math.sin(t * 8) * 2);
    sc.text(b.title, cx, cy - 22 + bob, { font: 'px5', color: GOLD, align: 'center', scale: Math.max(1, Math.round(sz)), outline: CRIMSON });
    sc.text(b.amount, cx, cy + 8, { font: 'px5', color: '#ffffff', align: 'center', scale: fit(b.amount, SCREEN_PX[0] - 10, 3), outline: INK });
    g.globalAlpha = 1;
  }
}
