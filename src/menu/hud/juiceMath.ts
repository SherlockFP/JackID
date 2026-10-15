/**
 * HUD juice maths (wave 7 juice, meta moments). Pure: no DOM, no app, no timers. `hud.ts` and `results.ts` read these and
 * do the presentation. Owner: HUD lane. Tested by scripts/tests/hudJuice.test.mjs.
 *  - `countUpSec(idx)`: how long the centre win figure rolls from 0, by win tier (WIN_TIERS index, 0 none .. 7 jackpot).
 *  - `rollPitch(progress)`: semitones for a roll tick, rising 0..12 with the roll's progress.
 *  - `TickGate`: at most `12` Hz for a rolling tick, so a long count-up does not buzz.
 *  - `heatTone(heat)`: the heat meter's colour (amber to red) and whether it blinks (above 75).
 *  - `quotaCrossings(prev, next)`: the quota bar's 25 / 50 / 75 / 100 % marks that a fill crossed.
 *  - `overTierSting(id)` / `overTierLevel(id)`: the overshoot tier's sound and its rank (gratuity 0 .. envy 5).
 */

/** Count-up length in seconds by WIN_TIERS index: none, push, small, medium, big, huge, mega, jackpot. */
const COUNT_SEC: readonly number[] = [0.5, 0.5, 0.5, 0.6, 0.7, 0.85, 0.95, 1.1];

export function countUpSec(idx: number): number {
  const k = Math.max(0, Math.min(COUNT_SEC.length - 1, Math.floor(Number.isFinite(idx) ? idx : 0)));
  return COUNT_SEC[k];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/** Semitones for one roll tick: 0 at the start of a roll, 12 at its end (one octave up over the count). */
export function rollPitch(progress: number): number {
  return 12 * clamp01(progress);
}

/**
 * Throttle for a rolling tick: `pass(dt, want)` is true when a tick may play now. At most `1 / gap` ticks a second
 * (default 12 Hz). Call once per frame with the frame time; the gate only counts down while `want` is false.
 */
export class TickGate {
  private left = 0;
  constructor(readonly gap = 1 / 12) {}
  pass(dt: number, want: boolean): boolean {
    this.left = Math.max(0, this.left - Math.max(0, dt));
    // a sliver of float residue left after the countdown is spent (1/60 steps do not divide 1/12 exactly) does not hold a tick back
    if (!want || this.left > 1e-6) return false;
    this.left = this.gap;
    return true;
  }
}

/** The heat meter's colour: amber at 0, red at 100 (a straight RGB blend), and whether it blinks (heat above 75). */
export function heatTone(heat: number): { color: string; blink: boolean } {
  const k = clamp01(heat / 100);
  const from = [0xe6, 0x94, 0x31];   // amber (COLORS.amber)
  const to = [0xc5, 0x21, 0x29];     // signal red (COLORS.signal)
  const c = from.map((a, i) => Math.round(a + (to[i] - a) * k));
  const hex = c.map((v) => v.toString(16).padStart(2, '0')).join('');
  return { color: `#${hex}`, blink: heat > 75 };
}

/** The quota marks a fill crossed when it moved from `prev` to `next` (percent, 0..100): each mark once, in order. */
export function quotaCrossings(prev: number, next: number): number[] {
  const out: number[] = [];
  for (const m of [25, 50, 75, 100]) if (prev < m && next >= m) out.push(m);
  return out;
}

/** The overshoot tiers in OVERSHOOT_TIERS order (data/schedule.ts). A tier id outside the list ranks -1. */
const OVER_ORDER: readonly string[] = ['gratuity', 'favoured', 'uncommon', 'golden', 'seal', 'envy'];
/** The sound for an overshoot crossing: a small win for the cheap tiers, the jackpot stings for the top two. */
const OVER_SFX: Readonly<Record<string, string>> = {
  gratuity: 'win1', favoured: 'win1', uncommon: 'win2', golden: 'win3', seal: 'winHuge', envy: 'winMega',
};

export function overTierLevel(id: string | null | undefined): number {
  return id ? OVER_ORDER.indexOf(id) : -1;
}

export function overTierSting(id: string | null | undefined): string {
  return (id && OVER_SFX[id]) || 'win1';
}
