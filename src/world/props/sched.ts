/**
 * Frame-driven tweens for world props (WORLD-ARCH). No timers and no rAF: each prop owns a `Sched` and forwards its
 * `update(dt)` to it, so animations pause with the game clock and never leak after `dispose()`.
 */
export type Ease = (k: number) => number;
export const easeLinear: Ease = (k) => k;
export const easeInQuad: Ease = (k) => k * k;
export const easeOutQuad: Ease = (k) => 1 - (1 - k) * (1 - k);
export const easeInOutCubic: Ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

interface Job { t: number; dur: number; step: (k: number) => void; done: () => void }

export class Sched {
  private jobs: Job[] = [];

  /** Run `step(k)` with k going 0 → 1 over `dur` seconds (eased), then resolve. `dur` ≤ 0 completes immediately. */
  run(dur: number, step: (k: number) => void, ease: Ease = easeLinear): Promise<void> {
    return new Promise<void>((resolve) => {
      if (dur <= 0) { step(ease(1)); resolve(); return; }
      this.jobs.push({ t: 0, dur, step: (k) => step(ease(k)), done: resolve });
    });
  }

  /** Resolve after `dur` seconds without a step. */
  wait(dur: number): Promise<void> {
    return this.run(dur, () => undefined);
  }

  /** Advance every job; finished jobs get their final step and resolve. */
  update(dt: number): void {
    if (this.jobs.length === 0) return;
    const live: Job[] = [];
    for (const j of this.jobs) {
      j.t += dt;
      const k = Math.min(1, j.t / j.dur);
      j.step(k);
      if (k >= 1) j.done(); else live.push(j);
    }
    this.jobs = live;
  }

  get busy(): boolean { return this.jobs.length > 0; }

  /** Drop every pending job without resolving (dispose). */
  clear(): void { this.jobs = []; }
}

/** Deterministic PRNG for prop dressing (coins, ledger seeds). Never Math.random. */
export function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
