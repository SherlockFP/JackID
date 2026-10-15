/**
 * Stakes (Balatro-style difficulty ladder, 0-7). Pure: the rules, the unlock state and the extra boss. The run reads
 * `stakeEffects` at each place a stake changes a number (run.ts); the kit picker reads the unlock helpers.
 *
 * Stakes are cumulative: stake k keeps every effect of stakes 1..k.
 *   1  Pawn prices ×1.10          5  one more Cold lamp, from Night 2
 *   2  quota ×1.08                6  a boss on Night 5 as well
 *   3  Tilt grace −1              7  interest −3 points
 *   4  each Pawn reroll +1 Ticket
 * Obols are multiplied by (1 + 0.15 × stake) at the run's end.
 *
 * Unlocks are per kit. `meta.stakeCleared` (save.ts: `stakeCleared`) holds the highest stake cleared with each kit. Clearing
 * Night 8 on stake k unlocks stake k + 1 for that kit. Stake 0 is always open.
 */
import { BASE_RUN_NIGHTS } from '@/game/data/schedule';
import { BOSS_EXCLUSIVE, BOSS_STAKE_NIGHT, BOSS_STAKE_POOL, BOSS_TEMPLATES, type BossId } from '@/game/data/bosses';
import { createRng, hashSeed } from '@/core/rng';
import type { BossNight } from '@/game/bosses';

export const STAKE_MAX = 7;
/** Obols per stake step: the run's Obols are ×(1 + 0.15 × stake). */
export const STAKE_OBOL_STEP = 0.15;
export const STAKE_PAWN_PRICE = 1.1;
export const STAKE_QUOTA = 1.08;
/** Interest cut at stake 7, as a rate (3 points). */
export const STAKE_INTEREST_CUT = 0.03;
/** The Night a run must clear (Topside, Night 8) to unlock the next stake for its kit. */
export const STAKE_CLEAR_NIGHT = BASE_RUN_NIGHTS;

/** Highest stake cleared per kit id. A kit with no clear is absent. */
export type StakeClears = Record<string, number>;

/** What each stake changes. Every field is the neutral value (1, 0, false) at stake 0. */
export interface StakeEffects {
  stake: number;
  pawnPriceMult: number;
  quotaMult: number;
  /** Added to the Tilt grace (negative = less grace). */
  tiltGrace: number;
  /** Extra Tickets per paid Pawn reroll. */
  rerollTickets: number;
  /** Extra Cold lamps (from Night 2; the Cold lamp count is 0 on Night 1 anyway). */
  coldLamps: number;
  extraBoss: boolean;
  /** Added to the interest rate (negative = less interest). */
  interestAdd: number;
  obolMult: number;
}

/** Stake value clamped to 0..STAKE_MAX (anything not a finite number is 0). */
export function clampStake(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(STAKE_MAX, Math.max(0, Math.floor(n))) : 0;
}

/** Obols multiplier of a stake: 1 + 0.15 × stake. */
export function stakeObolMult(stake: number): number {
  return 1 + STAKE_OBOL_STEP * clampStake(stake);
}

/** The cumulative effects of a stake. */
export function stakeEffects(stake: number): StakeEffects {
  const s = clampStake(stake);
  return {
    stake: s,
    pawnPriceMult: s >= 1 ? STAKE_PAWN_PRICE : 1,
    quotaMult: s >= 2 ? STAKE_QUOTA : 1,
    tiltGrace: s >= 3 ? -1 : 0,
    rerollTickets: s >= 4 ? 1 : 0,
    coldLamps: s >= 5 ? 1 : 0,
    extraBoss: s >= 6,
    interestAdd: s >= 7 ? -STAKE_INTEREST_CUT : 0,
    obolMult: stakeObolMult(s),
  };
}

/** The highest stake this kit has cleared, or -1 when none. */
export function bestStakeCleared(clears: StakeClears | undefined, kit: string): number {
  const v = clears?.[kit];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(STAKE_MAX, Math.floor(v)) : -1;
}

/** Stake 0 is always open. Stake k is open once the kit has cleared stake k - 1. */
export function stakeUnlocked(clears: StakeClears | undefined, kit: string, stake: number): boolean {
  const s = clampStake(stake);
  return s <= bestStakeCleared(clears, kit) + 1;
}

/** The clears map after a Night-8 clear on `stake` with `kit` (keeps the higher of old and new). Returns a new object. */
export function recordStakeClear(clears: StakeClears | undefined, kit: string, stake: number): StakeClears {
  const best = Math.max(bestStakeCleared(clears, kit), clampStake(stake));
  return { ...(clears ?? {}), [kit]: best };
}

/** A run ends a stake clear when it escapes Topside (or descends) on the clear Night or later. */
export function isStakeClear(result: string, nightNo: number): boolean {
  return result === 'escaped' && nightNo >= STAKE_CLEAR_NIGHT;
}

/**
 * The extra boss of stake 6: on `BOSS_STAKE_NIGHT` only, drawn from `BOSS_STAKE_POOL` with its own seed key. Null on every
 * other Night and below stake 6. Same shape as `bossFor` (game/bosses.ts), which it does not replace.
 */
export function stakeBossFor(seed: number, night: number, stake: number): BossNight | null {
  if (!stakeEffects(stake).extraBoss || night !== BOSS_STAKE_NIGHT) return null;
  const rng = createRng(hashSeed(seed, 'boss', night, 'stake'));
  const boss: BossId = rng.pick(BOSS_STAKE_POOL);
  const t = BOSS_TEMPLATES[boss];
  return {
    id: t.id,
    icon: t.icon,
    weight: 0,
    duration: 'shift',
    minShift: night,
    maxShift: night,
    exclusive: BOSS_EXCLUSIVE,
    effects: t.effects(null),
    strings: t.strings,
    boss,
    suit: null,
  };
}
