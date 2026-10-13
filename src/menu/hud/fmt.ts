/** Pure HUD formatting + timing helpers (no DOM, no app). */
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const pad2 = (n: number): string => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/** "02:31" for 151 s (the Watch clock, GDD §10.1). */
export function mmss(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** Wall time for the shift clock: progress 0..1 maps 00:00 → 06:00 (GDD §10.2). */
export function wallClock(progress: number): string {
  const m = Math.round(clamp01(progress) * 360);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Signed amount for pops: "+1,250", "−250". */
export function signed(n: number, fmt: (v: number) => string): string {
  return (n < 0 ? '−' : '+') + fmt(Math.abs(n));
}

/**
 * Rolling counter (GDD §10.1: count-up 30 ticks/s on gain). `tick(dt)` returns true when `shown` changed;
 * each step moves `shown` towards `target` by ~15 % of the gap (min 1), so big jumps visibly roll.
 */
export class Roller {
  shown = 0;
  target = 0;
  private acc = 0;
  set(v: number, snap = false): void {
    this.target = v;
    if (snap) { this.shown = v; this.acc = 0; }
  }
  tick(dt: number): boolean {
    const gap = this.target - this.shown;
    if (gap === 0) { this.acc = 0; return false; }
    this.acc += dt * 30;
    let moved = false;
    while (this.acc >= 1 && this.shown !== this.target) {
      this.acc -= 1;
      const g = this.target - this.shown;
      const step = Math.max(1, Math.ceil(Math.abs(g) * 0.15)) * Math.sign(g);
      this.shown = Math.abs(step) >= Math.abs(g) ? this.target : this.shown + step;
      moved = true;
    }
    return moved;
  }
}
