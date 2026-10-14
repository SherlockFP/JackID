/**
 * Hi-Lo Ladder — pure rules (MACHINES_tables §11). No three, no DOM, no kit. Shared by the live machine (`index.ts`)
 * and the headless play contract (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP.
 *
 * Rules: infinite deck, rank uniform A=1 … K=13 (suit cosmetic). Guess HIGHER-OR-SAME or LOWER-OR-SAME, or SKIP
 * (free, a new current card, max 1 per round). A guess with probability 1 is disabled (Higher on A, Lower on K).
 * Correct → running multiplier ×= step multiplier m = floor(rtp / p, 2 decimals). Wrong → bust.
 * Luck (L %): a busting card is redrawn once with probability L/100 (tag `lucky`).
 * Every function consumes a FIXED number of draws, so a seed replays identically whatever the charms.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Dir = 'hi' | 'lo';
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Card = { rank: number; suit: Suit };

export const RANKS = 13;
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const BASE_RTP = 0.99;          // per-step target (table §11.3)
export const RTP_CAP = 1.02;           // hard ceiling with every charm stacked
export const SKIPS_MAX = 1;            // free skips per round (base): one skip, so spending it is a real choice
export const AUTO_COLLECT = 1000;      // running multiplier that cashes out automatically
export const MAX_RUN = 13000;          // hard ceiling on the running multiplier (= def.maxPayoutMult)
export const MIN_BET = 5, MAX_BET = 200;
export const BET_STEPS = [5, 10, 25, 50, 100, 200];
export const RUNGS = 12;               // ladder lamps; rung i lights at RUNG_AT[i] (top = ×500+)
export const RUNG_AT: readonly number[] = [1.5, 2, 3, 4, 6, 8, 12, 16, 25, 50, 100, 500];
/** Headless policy: collect after this many correct guesses. */
export const HEADLESS_STEPS = 2;

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_SKIP = 'm.hilo.skipAdd' as ModHook;        // extra skips per round, int
export const HOOK_RTP = 'm.hilo.stepRtpAdd' as ModHook;      // float added to 0.99 (cap 1.02)
export const HOOK_SAFETY = 'm.hilo.safetyNet' as ModHook;    // ≥ 1 → first bust per round refunds 50 % of the collect value
export const HOOK_SAME = 'm.hilo.sameBonus' as ModHook;      // exact-rank hits multiply the step by 1 + x
export const HOOK_START = 'm.hilo.startMult' as ModHook;     // ladder starts at ×(1 + x)

const RANK_TEXT = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const rankText = (rank: number): string => RANK_TEXT[rank] ?? '?';
export const clampLuck = (l: number): number => Math.min(100, Math.max(0, l));

/** How many ranks win a guess: higher-or-same counts ranks ≥ current, lower-or-same counts ranks ≤ current. */
export function winRanks(rank: number, dir: Dir): number {
  return dir === 'hi' ? RANKS + 1 - rank : rank;
}
export const winProb = (rank: number, dir: Dir): number => winRanks(rank, dir) / RANKS;
/** A guess is disabled when it is certain to win (Higher on A, Lower on K). */
export const guessable = (rank: number, dir: Dir): boolean => winRanks(rank, dir) < RANKS;

/** Step multiplier m = floor(rtp / p) with 2 decimals. Integer-safe: the epsilon stops 12.87 landing on 12.86. */
export function stepMult(rank: number, dir: Dir, rtp: number = BASE_RTP): number {
  return Math.floor((rtp * RANKS / winRanks(rank, dir)) * 100 + 1e-9) / 100;
}

/** Clamp the effective per-step target RTP to [0, RTP_CAP]. */
export const clampRtp = (r: number): number => Math.min(RTP_CAP, Math.max(0, r));

/** Running multiplier after a correct step (capped at MAX_RUN). */
export const advance = (run: number, mult: number): number => Math.min(MAX_RUN, run * mult);

/** Unbiased whole-coin payout of `stake × mult` (the wallet is integer). Always consumes one draw. */
export function payoutOf(rng: Rng, stake: number, mult: number): number {
  const v = stake * mult;
  const base = Math.floor(v);
  return base + (rng.next() < v - base ? 1 : 0);
}

/** One card: rank uniform 1..13, suit cosmetic. Always two draws. */
export function drawCard(rng: Rng): Card {
  const rank = rng.int(1, RANKS);
  return { rank, suit: SUITS[rng.int(0, 3)] };
}

export const isWin = (cur: number, next: number, dir: Dir): boolean => (dir === 'hi' ? next >= cur : next <= cur);

export interface GuessOpts { rtp: number; luck: number; same: number }

export interface Outcome {
  ok: boolean;
  next: Card;
  /** Multiplier of this step (0 on a bust). Includes the same-rank bonus. */
  mult: number;
  /** Exact-rank hit (sameBonus applied). */
  same: boolean;
  /** Fate draw fired (invisible tag). */
  lucky: boolean;
  /** Bust by exactly one rank (cosmetic tease). */
  nearmiss: boolean;
}

/** Resolve one guess. Always consumes five draws (card, gate, redraw) whatever the outcome or luck. */
export function resolveGuess(rng: Rng, cur: Card, dir: Dir, o: GuessOpts): Outcome {
  let next = drawCard(rng);
  const gate = rng.next();
  const again = drawCard(rng);
  let ok = isWin(cur.rank, next.rank, dir);
  let lucky = false;
  if (!ok && gate < clampLuck(o.luck) / 100) {
    lucky = true;
    next = again;
    ok = isWin(cur.rank, next.rank, dir);
  }
  const same = next.rank === cur.rank;
  let mult = 0;
  if (ok) {
    mult = stepMult(cur.rank, dir, o.rtp);
    if (same && o.same > 0) mult = Math.floor(mult * (1 + o.same) * 100 + 1e-9) / 100;
  }
  const nearmiss = !ok && (dir === 'hi' ? next.rank === cur.rank - 1 : next.rank === cur.rank + 1);
  return { ok, next, mult, same: ok && same, lucky, nearmiss };
}

/** Headless / bench policy: the side with the better chance of winning (ties go to Higher). */
export function bestDir(rank: number): Dir {
  const hi = guessable(rank, 'hi') ? winProb(rank, 'hi') : -1;
  const lo = guessable(rank, 'lo') ? winProb(rank, 'lo') : -1;
  return hi >= lo ? 'hi' : 'lo';
}

/** Headless single round: the same resolver as the live ladder, a fixed policy (no skips), collected after HEADLESS_STEPS. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const o: GuessOpts = {
    rtp: clampRtp(BASE_RTP + h.mod(HOOK_RTP, 0)),
    luck: h.luck,
    same: Math.max(0, h.mod(HOOK_SAME, 0)),
  };
  const safety = h.mod(HOOK_SAFETY, 0) >= 1;
  let cur = drawCard(rng);
  let run = Math.min(MAX_RUN, 1 + Math.max(0, h.mod(HOOK_START, 0)));
  const tags: string[] = ['ladder'];
  for (let steps = 0; steps < HEADLESS_STEPS; steps++) {
    const r = resolveGuess(rng, cur, bestDir(cur.rank), o);
    if (r.lucky) tags.push('lucky');
    if (!r.ok) {
      if (r.nearmiss) tags.push('nearmiss');
      const refund = safety && steps > 0 ? payoutOf(rng, bet, run / 2) : 0;
      return { gross: refund, tags };
    }
    if (r.same) tags.push('same');
    run = advance(run, r.mult);
    cur = r.next;
    if (run >= AUTO_COLLECT) break;
  }
  return { gross: payoutOf(rng, bet, run), tags };
};
