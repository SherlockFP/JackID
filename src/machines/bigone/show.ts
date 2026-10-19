/**
 * The Big One light show, pure logic (no three, DOM or settings reads): the combo show plan, the flash caps and the
 * symbol idle-frame clock. `index.ts` reads the settings and drives the bulbs; this file only says how fast and how long.
 *
 * Rules: a tally of COMBO_MIN patterns or more starts the show (crown comet, then rainbow; window march; a world light
 * flick and `show:combo` for the nearby machines). Calm Mode and reduceFlashing cap every rhythm at 2 Hz and drop the
 * rainbow. The pit strobe stays at 3 Hz or less (juiceFx), and the symbol cycle is motion inside the cell, not a flash.
 */

import { MAW } from './rules';

/** Tally size that starts the combo show. */
export const COMBO_MIN = 3;
/** Ceiling for any rhythm in the show (Hz). Calm / reduceFlashing lower it to CALM_HZ_MAX. */
export const FLASH_HZ_MAX = 3;
export const CALM_HZ_MAX = 2;
/** Winning cells cycle their symbol frames at this rate (Hz), idle cells at IDLE_HZ. */
export const LIVE_HZ = 4;
export const IDLE_HZ = 1.5;
/** Symbol frames per loop (MOTH flap, CANDLE flicker, SUN turn, …). */
export const SYM_FRAMES = 4;

export interface FlashOpts { reduced: boolean; calm: boolean }

/** A rhythm capped by the player's flash settings (Hz). */
export function hzCap(hz: number, o: FlashOpts): number {
  return Math.min(hz, o.reduced || o.calm ? CALM_HZ_MAX : FLASH_HZ_MAX);
}

/** The rainbow is colour cycling; Calm and reduceFlashing both turn it off. */
export function rainbowOk(o: FlashOpts): boolean {
  return !(o.reduced || o.calm);
}

export interface ComboPlan {
  /** Whole show length in seconds (sim clock). */
  totalS: number;
  /** Crown comet length before the crown moves on. */
  cometS: number;
  cometHz: number;
  /** Crown pattern after the comet: rainbow, or a chase when the rainbow is off. */
  crown: 'rainbow' | 'chase';
  crownHz: number;
  marchHz: number;
}

/** The show for a tally of `n` patterns: longer and busier the more patterns stack, always inside the flash caps. */
export function comboPlan(n: number, o: FlashOpts): ComboPlan {
  return {
    totalS: Math.min(3.2, 1.6 + 0.4 * Math.max(0, n - COMBO_MIN + 1)),
    cometS: 1.0,
    cometHz: hzCap(8, o),
    crown: rainbowOk(o) ? 'rainbow' : 'chase',
    crownHz: hzCap(3, o),
    marchHz: hzCap(3, o),
  };
}

/**
 * Longest run of one symbol on a single row that ends on reel `i` (1 = nothing lined up), read from the grid the reels show
 * (row-major, 5 columns): the line-up tick says what the player can see. The curse's MAW cells and blanks never line up.
 */
export function lineRun(grid: readonly number[], i: number): number {
  let best = 1;
  for (let r = 0; r < 3; r++) {
    const s = grid[r * 5 + i];
    if (!(s >= 0) || s === MAW) continue;
    let n = 1;
    while (n <= i && grid[r * 5 + i - n] === s) n++;
    if (n > best) best = n;
  }
  return best;
}

/** Semitones of the line-up tick for a run of `n` (2 = a pair is the base note, then up a third, a fifth, an octave). */
export function lineUpPitch(n: number): number {
  return [0, 0, 0, 4, 7, 12][Math.min(5, Math.max(0, Math.floor(n)))];
}

/** Idle / live symbol frame 0..SYM_FRAMES-1 at render time `t`: `hz` steps a second, `phase` staggers neighbours. */
export function symFrame(t: number, hz: number, phase = 0): number {
  return Math.floor(t * hz + phase) % SYM_FRAMES;
}
