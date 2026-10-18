/**
 * LAST CALL DARE (wave 75 floor event). In the last 20 s of a Watch the dare arms. The player may take it (opt-in). The next
 * result is then a coin on the win: a win is doubled, or wiped to nothing. A loss stays a loss. Either way the dare is spent on
 * that result. The coin is rolled when the dare is rolled (at the Watch start), so the outcome never needs the rng again.
 *
 * The dare is a `payout.mult` (×2 or ×0) that exists only between accept and the next result. The caller reports that result
 * with `settleDare(s, won)`, where `won` is the result before the floor's multipliers.
 */
import type { Rng } from '@/core/rng';
import type { ModEffect } from '@/game/modifiers.types';
import type { DareResult } from './types';

/** The dare arms when the Watch clock has this many seconds left. */
export const DARE_ARM_S = 20;
export const DARE_WIN_MULT = 2;

export interface DareState {
  armed: boolean;
  accepted: boolean;
  spent: boolean;
  /** The seeded coin: true = a win is doubled, false = a win is wiped. */
  doubles: boolean;
}

export function rollDare(rng: Rng): DareState {
  return { armed: false, accepted: false, spent: false, doubles: rng.chance(0.5) };
}

/** Takes the dare: only once it is armed, once, and before its result. */
export function acceptDare(s: DareState): boolean {
  if (!s.armed || s.accepted || s.spent) return false;
  s.accepted = true;
  return true;
}

/** The payout effect for the next result only: ×2 or ×0 on the coin. Empty when the dare is not taken or is spent. */
export function dareEffects(s: DareState): ModEffect[] {
  if (!s.accepted || s.spent) return [];
  return [{ hook: 'payout.mult', op: 'mult', value: s.doubles ? DARE_WIN_MULT : 0 }];
}

/** The result of the dared round. Spends the dare. `won` is the round's result before the floor's multipliers. */
export function settleDare(s: DareState, won: boolean): DareResult {
  s.spent = true;
  if (!won) return 'loss';
  return s.doubles ? 'doubled' : 'wiped';
}
