/**
 * Watch clock (GDD §2.2–2.3): a seconds countdown driven by the SIM clock, never wall time, so it pauses with the game
 * and resumes frozen after a quit. Pure: `run.ts` decides what a zero or a Last Call threshold means.
 */
export interface ClockSnapshot { left: number; total: number; running: boolean }

export class WatchClock {
  private left = 0;
  private total = 0;
  private running = false;

  /** Start a fresh countdown of `seconds` (the whole Watch). */
  start(seconds: number): void {
    this.total = Math.max(0, seconds);
    this.left = this.total;
    this.running = true;
  }

  /** Advance by `dt` sim seconds. Returns the seconds left (clamped at 0). */
  tick(dt: number): number {
    if (!this.running || dt <= 0) return this.left;
    this.left = Math.max(0, this.left - dt);
    if (this.left === 0) this.running = false;
    return this.left;
  }

  /** Add (or with a negative value, remove) seconds. Never revives a finished clock. */
  extend(sec: number): void {
    this.total = Math.max(0, this.total + sec);
    if (this.running) this.left = Math.max(0, Math.min(this.total, this.left + sec));
  }

  stop(): void { this.running = false; }
  resume(): void { if (this.left > 0) this.running = true; }

  get remaining(): number { return this.left; }
  get length(): number { return this.total; }
  get isRunning(): boolean { return this.running; }
  /** Progress 0..1 across the Watch (cosmetic clock hand). */
  get progress(): number { return this.total > 0 ? 1 - this.left / this.total : 1; }

  snapshot(): ClockSnapshot { return { left: this.left, total: this.total, running: this.running }; }
  restore(s: ClockSnapshot): void {
    this.left = Math.max(0, s.left);
    this.total = Math.max(0, s.total);
    this.running = s.running && this.left > 0;
  }
}
