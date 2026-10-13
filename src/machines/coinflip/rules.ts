/**
 * Coin Flip Booth — pure rules (base-machines WP, reference machine). Shared by the live machine (`index.ts`) and
 * the headless play contract (`playHeadless`: staff auto-play, balance sims, bench "Sim" button), so the simulated
 * RTP IS the live RTP.
 *
 * Rules: call heads or tails, stake S. A win pays 2S (RTP 98 % at p = 0.49). After a win the player may RIDE
 * (double-or-nothing: re-stake the whole pot at no extra cost, up to the ride cap) or COLLECT. A loss ends the round.
 * Luck (GDD §3.8.1): L % chance a losing flip is rerolled once (a negative L rerolls a win instead).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Side = 'H' | 'T';

export const WIN_P = 0.49;
export const PAYOUT_MULT = 2;
export const RIDE_CAP = 4;             // rides (doubles) allowed after the first win → max pot = bet × 2^(1 + cap) = ×32
export const MAX_RIDE_CAP = 6;         // hard ceiling with every hook/feature stacked → ×128 (= def.maxPayoutMult)
const P_MIN = 0.05, P_MAX = 0.9;
const NEAR_MISS_P = 0.15;              // share of losses shown as an edge-teeter

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_P = 'm.coinflip.pWin' as ModHook;        // base win chance, e.g. add +0.05
export const HOOK_RIDES = 'm.coinflip.rideCap' as ModHook; // extra doubles allowed, int

export const clampP = (p: number): number => Math.min(P_MAX, Math.max(P_MIN, p));
export const clampRides = (n: number): number => Math.min(MAX_RIDE_CAP, Math.max(0, Math.round(n)));

export interface Roll {
  win: boolean;
  /** A luck reroll fired (either direction). */
  rerolled: boolean;
  /** Cosmetic: a losing flip that teeters on its edge first. */
  near: boolean;
  /** Cosmetic: full rotations of the toss. */
  turns: number;
}

/**
 * One flip. Always consumes exactly five draws so the stream position never depends on luck or on the result
 * (a given seed replays identically whatever the charms).
 */
export function roll(rng: Rng, p: number, luck: number): Roll {
  const d1 = rng.next(), gate = rng.next(), d3 = rng.next(), d4 = rng.next();
  const turns = rng.int(4, 7);
  let win = d1 < p;
  let rerolled = false;
  if (!win && luck > 0 && gate < luck / 100) { rerolled = true; win = d3 < p; }
  else if (win && luck < 0 && gate < -luck / 100) { rerolled = true; win = d3 < p; }
  return { win, rerolled, near: !win && d4 < NEAR_MISS_P, turns };
}

/** Headless single flip, collected immediately (what an Attendant does). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = roll(rng, clampP(h.mod(HOOK_P, WIN_P)), h.luck);
  return { gross: r.win ? bet * PAYOUT_MULT : 0, tags: r.rerolled ? ['lucky'] : [] };
};
