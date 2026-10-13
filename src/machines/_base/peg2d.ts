/**
 * Peg2D (base-machines WP). Contract: TECH_SPEC §3.7. A tiny deterministic 2D circle-vs-peg physics world for
 * pachinko / plinko style machines: balls fall under gravity, bounce off static circular pegs and line
 * segments, and are caught by rectangular sensor zones (pockets, bins).
 *
 * Coordinates: metres, **y up**; `gravity` is a positive magnitude (balls accelerate towards −y). Balls do not
 * collide with each other. No trigonometry in the step, so every peer replaying the same launch events with the
 * same fixed `dt` (call `step(1/60)` from `tick`) sees the same trajectories. Ball ids are slot indices in
 * `0..maxBalls-1`, recycled after a ball dies — map them straight onto an `InstancedMesh` instance index.
 *
 * Segments and zones are scanned linearly per ball and sub-step: keep them few (≲ 30). Zones fire `onHit` on entry only.
 *
 * Cost: a uniform grid over the pegs, adaptive sub-stepping (ball moves ≤ ½ radius per sub-step); 60 balls
 * through ~120 pegs is far below the 1 ms/step budget.
 */
export interface Peg2DOptions {
  gravity: number;
  restitution: number;
  ballR: number;
  /** Tangential speed lost on every bounce, 0..1 (default 0.02). */
  friction?: number;
  /** Speed clamp in m/s (default 12). */
  maxSpeed?: number;
  /** Pool size (default 64). `spawn` returns −1 when all slots are alive. */
  maxBalls?: number;
  /** Balls falling below this y die with tag `'out'` (default: never). */
  floorY?: number;
}
export interface Ball2D { id: number; x: number; y: number; vx: number; vy: number; alive: boolean }

interface Peg { x: number; y: number; r: number; tag: string }
interface Seg { ax: number; ay: number; dx: number; dy: number; len2: number; tag: string }
interface Zone { x0: number; y0: number; x1: number; y1: number; tag: string; kill: boolean }

const MIN_HIT_SPEED = 0.08;      // m/s: slower contacts are silent (resting / rolling)
const MAX_SUBSTEPS = 48;

export class Peg2D {
  /** Called on a bounce (tag of the peg / wall, impact speed ≥ 0.08 m/s), on entering a zone (its tag) and on `'out'`. */
  onHit: ((ball: number, tag: string) => void) | null = null;

  private readonly g: number;
  private readonly e: number;
  private readonly R: number;
  private readonly fr: number;
  private readonly vmax: number;
  private readonly floorY: number;
  private readonly pool: Ball2D[];
  /** Zone index each ball currently sits in (−1 none): sensors fire on entry only. */
  private readonly inZone: Int16Array;
  private pegs: Peg[] = [];
  private segs: Seg[] = [];
  private zones: Zone[] = [];
  private grid = new Map<number, number[]>();
  private cell: number;
  private dirty = true;

  constructor(o: Peg2DOptions) {
    this.g = o.gravity; this.e = o.restitution; this.R = o.ballR;
    this.fr = o.friction ?? 0.02; this.vmax = o.maxSpeed ?? 12; this.floorY = o.floorY ?? -Infinity;
    this.cell = Math.max(0.02, o.ballR * 6);
    this.pool = Array.from({ length: o.maxBalls ?? 64 }, (_, id) => ({ id, x: 0, y: 0, vx: 0, vy: 0, alive: false }));
    this.inZone = new Int16Array(this.pool.length).fill(-1);
  }

  addPeg(x: number, y: number, r: number, tag = 'peg'): void {
    this.pegs.push({ x, y, r, tag });
    this.cell = Math.max(this.cell, (r + this.R) * 2);
    this.dirty = true;
  }
  addSeg(ax: number, ay: number, bx: number, by: number, tag = 'wall'): void {
    const dx = bx - ax, dy = by - ay;
    this.segs.push({ ax, ay, dx, dy, len2: Math.max(1e-12, dx * dx + dy * dy), tag });
  }
  /** Sensor rectangle. `kill` (default) removes the ball that enters it (pocket / bin). */
  addZone(x0: number, y0: number, x1: number, y1: number, tag: string, kill = true): void {
    this.zones.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), tag, kill });
  }

  /** Launch a ball; returns its id (slot), or −1 when the pool is full. */
  spawn(x: number, y: number, vx: number, vy: number): number {
    const b = this.pool.find((p) => !p.alive);
    if (!b) return -1;
    b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.alive = true; this.inZone[b.id] = -1;
    return b.id;
  }
  kill(id: number): void { const b = this.pool[id]; if (b) b.alive = false; }
  /** Remove every ball (keeps the geometry). */
  clear(): void { for (const b of this.pool) b.alive = false; }
  get aliveCount(): number { let n = 0; for (const b of this.pool) if (b.alive) n++; return n; }
  /** Live view of the pool (objects are reused: read, don't keep references across `spawn`). */
  balls(): ReadonlyArray<Ball2D> { return this.pool; }

  step(dt: number): void {
    if (this.dirty) this.rebuild();
    let fastest = 0;
    for (const b of this.pool) if (b.alive) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy) + this.g * dt);
    if (fastest === 0) return;
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((fastest * dt) / (this.R * 0.5))));
    const h = dt / n;
    for (let i = 0; i < n; i++) for (const b of this.pool) if (b.alive) this.sub(b, h);
  }

  // ── internals ──
  private key(ix: number, iy: number): number { return (ix + 4096) * 8192 + (iy + 4096); }
  private rebuild(): void {
    this.grid.clear();
    const c = this.cell;
    this.pegs.forEach((p, i) => {
      const reach = p.r + this.R;
      const x0 = Math.floor((p.x - reach) / c), x1 = Math.floor((p.x + reach) / c);
      const y0 = Math.floor((p.y - reach) / c), y1 = Math.floor((p.y + reach) / c);
      for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        const list = this.grid.get(k);
        if (list) list.push(i); else this.grid.set(k, [i]);
      }
    });
    this.dirty = false;
  }

  private sub(b: Ball2D, h: number): void {
    b.vy -= this.g * h;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > this.vmax) { const k = this.vmax / sp; b.vx *= k; b.vy *= k; }
    b.x += b.vx * h; b.y += b.vy * h;

    const near = this.grid.get(this.key(Math.floor(b.x / this.cell), Math.floor(b.y / this.cell)));
    if (near) for (const i of near) { const p = this.pegs[i]; this.bounce(b, p.x, p.y, p.r + this.R, p.tag); }
    for (const s of this.segs) {
      const t = Math.min(1, Math.max(0, ((b.x - s.ax) * s.dx + (b.y - s.ay) * s.dy) / s.len2));
      this.bounce(b, s.ax + s.dx * t, s.ay + s.dy * t, this.R, s.tag, s);
    }
    let zi = -1;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if (b.x < z.x0 || b.x > z.x1 || b.y < z.y0 || b.y > z.y1) continue;
      zi = i;
      if (this.inZone[b.id] !== i) {                  // entry edge only (no per-sub-step spam)
        this.inZone[b.id] = i;
        this.onHit?.(b.id, z.tag);
      }
      if (z.kill) { b.alive = false; return; }
      break;
    }
    if (zi < 0) this.inZone[b.id] = -1;
    if (b.y < this.floorY - this.R) { b.alive = false; this.onHit?.(b.id, 'out'); }
  }

  /** Push `b` out of the disc (cx, cy, rad) and reflect its velocity. */
  private bounce(b: Ball2D, cx: number, cy: number, rad: number, tag: string, seg?: Seg): void {
    let dx = b.x - cx, dy = b.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rad * rad) return;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {                                   // centre exactly on the contact point: use a stable normal
      if (seg) { const l = Math.sqrt(seg.len2); dx = -seg.dy / l; dy = seg.dx / l; } else { dx = 0; dy = 1; }
      d = 1;
    }
    const nx = dx / d, ny = dy / d;
    b.x = cx + nx * rad; b.y = cy + ny * rad;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return;                              // already separating
    const tx = -ny, ty = nx;
    const vt = (b.vx * tx + b.vy * ty) * (1 - this.fr);
    const rn = -vn * this.e;
    b.vx = nx * rn + tx * vt; b.vy = ny * rn + ty * vt;
    if (-vn > MIN_HIT_SPEED) this.onHit?.(b.id, tag);
  }
}
