/**
 * Mode rules (GDD §7): what a mode changes about the run's skeleton. Pure data; `run.ts` reads it and never branches
 * on the mode name anywhere else.
 */
import type { GameMode } from '@/core/types';

export interface ModeRules {
  readonly id: GameMode;
  /** Quota, Dawn Collection and the Night schedule exist. Free Casino has none. */
  readonly quota: boolean;
  /** Real-time Watch clock runs (sim seconds). */
  readonly timed: boolean;
  /** Night count before the win screen (Infinity = endless). */
  readonly nights: number;
  /** Pulls per Watch are unlimited (sandbox). */
  readonly unlimitedPulls: boolean;
  /** Starting pocket (coins). */
  readonly startWallet: number;
  /** Starting tickets. */
  readonly startTickets: number;
  /** Starting charm pegs. */
  readonly startPegs: number;
}
