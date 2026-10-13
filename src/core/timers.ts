/**
 * Timers on a game clock (TD-owned). Contract: TECH_SPEC §2.9.
 * `app.timers.sim` advances in fixed steps (pausable) — use it for ALL gameplay waits; `app.timers.ui`
 * runs in real time. Never use `setTimeout/setInterval` for gameplay (allowed only in net/, core/ui,
 * menu/ panels and the worker ticker).
 */
import { log } from './log';

export interface Timers {
  after(sec: number, fn: () => void): () => void;   // returns cancel
  every(sec: number, fn: () => void): () => void;   // returns cancel
  wait(sec: number): Promise<void>;
  /** Cancel everything pending (state exit). Pending `wait()` promises are resolved. */
  clear(): void;
  update(dt: number): void;
}

interface Entry { at: number; every: number; fn: () => void; dead: boolean; waiter?: boolean }

class TimerSet implements Timers {
  private now = 0;
  private list: Entry[] = [];

  after(sec: number, fn: () => void): () => void {
    const e: Entry = { at: this.now + Math.max(0, sec), every: 0, fn, dead: false };
    this.list.push(e);
    return () => { e.dead = true; };
  }
  every(sec: number, fn: () => void): () => void {
    const iv = Math.max(1e-3, sec);
    const e: Entry = { at: this.now + iv, every: iv, fn, dead: false };
    this.list.push(e);
    return () => { e.dead = true; };
  }
  wait(sec: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.list.push({ at: this.now + Math.max(0, sec), every: 0, fn: resolve, dead: false, waiter: true });
    });
  }
  clear(): void {
    const list = this.list.splice(0);
    for (const e of list) {
      // Callbacks are dropped; only wait() promises are released so awaiting code can unwind.
      if (!e.dead && e.waiter) e.fn();
      e.dead = true;
    }
  }
  update(dt: number): void {
    this.now += dt;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead || e.at > this.now) continue;
      try { e.fn(); } catch (err) { log.error('timers', err); }
      if (e.every > 0 && !e.dead) { do e.at += e.every; while (e.at <= this.now); } else e.dead = true;
    }
    let w = 0;
    for (let r = 0; r < list.length; r++) if (!list[r].dead) list[w++] = list[r];
    list.length = w;
  }
}

export function createTimers(): Timers {
  return new TimerSet();
}
