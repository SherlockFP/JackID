/**
 * Economy maths (GDD §3.2–3.3): the payout choke point, bet ladder, SI-priced charms, shop rarity odds. Pure: no state,
 * no bus, no three. `run.ts` feeds it the modifier fold and owns all side effects.
 */
import type { CharmDef, CharmRarity } from '@/game/types';
import { roundSig } from '@/game/types';
import type { Rng } from '@/core/rng';
import { HOUSE_LIMIT_QUOTA_MULT } from './data/schedule';

/** Hook-stack guard: the combined factor `(1 + A) × M` never exceeds this (GDD §3.3). */
export const PAYOUT_GUARD = 1000;

export interface PayoutInput {
  /** Base gross for total stake `bet` (before any payout factor). */
  gross: number;
  bet: number;
  /** Additive bonus sum A (GDD "(A)"). */
  A: number;
  /** Multiplicative factor product M (GDD "(M)"). */
  M: number;
  /** Flat coins added on a win (`payout.flat`). */
  flat: number;
  /** Current quota (House Limit = 5 × quota). 0 = no quota (Free Casino): no cap. */
  quota: number;
}

export interface PayoutResult {
  /** Coins to credit. */
  credited: number;
  /** Coins above the House Limit (feed the network jackpot). */
  excess: number;
  /** Effective factor applied to the gross (1 for losses). */
  factor: number;
  /** Even-money dampener applied (gross ≤ 2 × bet). */
  dampened: boolean;
  capped: boolean;
}

/**
 * Settle one play (GDD §3.3):
 *  - loss / push / partial refund (gross ≤ bet): no bonuses, the gross is credited as is;
 *  - win: A is halved when gross ≤ 2 × bet (dampener); final = floor(gross × min(1000, (1+A) × M)) + flat;
 *  - House Limit: min(final, 5 × quota); the excess is returned for the jackpot pool.
 */
export function settlePayout(i: PayoutInput): PayoutResult {
  const gross = Math.max(0, i.gross);
  if (gross <= 0) return { credited: 0, excess: 0, factor: 0, dampened: false, capped: false };
  if (gross <= i.bet) return { credited: Math.floor(gross), excess: 0, factor: 1, dampened: false, capped: false };
  const dampened = gross <= 2 * i.bet;
  const a = dampened ? i.A * 0.5 : i.A;
  const factor = Math.min(PAYOUT_GUARD, Math.max(0, 1 + a) * i.M);
  const cap = i.quota > 0 ? HOUSE_LIMIT_QUOTA_MULT * i.quota : Number.POSITIVE_INFINITY;
  const raw = Math.floor(gross * factor) + Math.max(0, i.flat);
  const capped = raw > cap;
  const credited = capped ? cap : raw;
  return { credited, excess: capped ? raw - cap : 0, factor, dampened, capped };
}

/** Price of a catalogue item at stake index `si`: base × SI, 2 significant digits (GDD §3.2). Negative = cursed fee. */
export function charmPrice(def: Pick<CharmDef, 'price'>, si: number): number {
  return roundSig(def.price * si, 2);
}

/** Selling pays 50 % of the price paid (70 % with `pawn_ticket`). Cursed charms cannot be sold. */
export function sellPrice(pricePaid: number, pawnTicket: boolean): number {
  return Math.floor(Math.max(0, pricePaid) * (pawnTicket ? 0.7 : 0.5));
}

export type ShopRarity = Exclude<CharmRarity, 'cursed'>;
/**
 * Regular shop-slot rarity odds by Night index (GDD §4.1). `index` is 0-based (`shift.index`), NOT the printed Night
 * number: Night 1 is index 0. See `indexConventionProblems()` in data/schedule.ts.
 */
export function rarityOdds(index: number): Record<ShopRarity, number> {
  if (index <= 0) return { common: 0.75, uncommon: 0.25, rare: 0, legendary: 0 };
  if (index === 1) return { common: 0.65, uncommon: 0.28, rare: 0.07, legendary: 0 };
  if (index <= 3) return { common: 0.52, uncommon: 0.33, rare: 0.15, legendary: 0 };
  if (index <= 5) return { common: 0.4, uncommon: 0.35, rare: 0.21, legendary: 0.04 };
  return { common: 0.35, uncommon: 0.35, rare: 0.24, legendary: 0.06 };
}

export function rollRarity(rng: Rng, index: number): ShopRarity {
  const odds = rarityOdds(index);
  const keys: ShopRarity[] = ['common', 'uncommon', 'rare', 'legendary'];
  return rng.weighted(keys, keys.map((k) => odds[k]));
}

/**
 * Bet ladder `1, 2, 5, 10, 20, 50, …` (×10 per decade, GDD §3.2) up to and including `max`. Min bets never scale.
 * Returns the steps ≥ `min`; if the catalogue gives its own `betSteps`, the caller uses those instead.
 */
export function bettingLadder(min: number, max: number): number[] {
  const out: number[] = [];
  if (max <= 0) return out;
  for (let decade = 1; decade <= max * 10 && out.length < 40; decade *= 10) {
    for (const m of [1, 2, 5]) {
      const v = m * decade;
      if (v > max) return out.length ? out : [];
      if (v >= min) out.push(v);
    }
  }
  return out;
}

/** Largest ladder step ≤ `value` (0 if none). */
export function snapDown(value: number, ladder: readonly number[]): number {
  let best = 0;
  for (const v of ladder) if (v <= value) best = v;
  return best;
}
