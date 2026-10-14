/**
 * Watch-clock hold (wave 13): anything that puts words on the screen the player has to read (the Night 1 tutorial steps
 * 1-3, a Collector line, a cutscene) holds the Watch clock, so the clock never runs out under a paragraph. Pure state, no
 * three, no DOM, no timers: the run ticks it with its own sim `dt`.
 *
 *   holdClock('tutorial', 5)      keeps the clock stopped for the next 5 s; call it again every frame to keep holding
 *   holdClockFor('collector', 6)  same, for a subtitle of known length (the horror director / cutscene subtitle path)
 *   releaseClock('tutorial')      lets the clock run again now
 *
 * Every hold carries a time limit (default 60 s), so a caller that forgets to release can never freeze the Watch for good.
 */
const holds = new Map<string, number>();
const DEFAULT_MAX_SEC = 60;

/** Hold the clock for `maxSec` more seconds under `reason` (re-calling refreshes it; the longer of the two wins only on a fresh call). */
export function holdClock(reason: string, maxSec: number = DEFAULT_MAX_SEC): void {
  if (!(maxSec > 0)) return;
  holds.set(reason, Math.min(maxSec, 600));
}
/** A hold of known length (a subtitle that stays `sec` seconds). Never shortens a hold that is already longer. */
export function holdClockFor(reason: string, sec: number): void {
  if (!(sec > 0)) return;
  holds.set(reason, Math.max(holds.get(reason) ?? 0, Math.min(sec, 600)));
}
export function releaseClock(reason: string): void { holds.delete(reason); }
export function clearClockHolds(): void { holds.clear(); }
/** True while any hold is live. */
export function clockHeld(): boolean { return holds.size > 0; }
/** The reasons currently holding (debug and tests). */
export function clockHolders(): string[] { return [...holds.keys()]; }
/** Run the hold timers down by `dt` sim seconds. */
export function tickClockHold(dt: number): void {
  if (!(dt > 0)) return;
  for (const [k, left] of holds) {
    const n = left - dt;
    if (n <= 0) holds.delete(k); else holds.set(k, n);
  }
}
