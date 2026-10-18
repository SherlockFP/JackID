/**
 * THE HOME COMPUTER, headless balance (wave 77): a ledger sim of the ventures over the 8-Night ladder, run by the economy test and
 * reported in the wave notes. It does not play the machines: each paid Dawn leaves the player a seeded surplus of `carry` × that
 * Night's quota (`CARRY`, a survivor band), and a strategy decides what to buy in the Evening. Pure and seeded.
 *
 * Strategies: 'none' (never buys), 'greedy' (buys the best payback it can afford above a reserve of half the next quota), and
 * 'all-in' (no reserve: buys every venture it can, best payback first), and 'smart' (the greedy reserve, but only a venture that
 * earns its price back before the last Evening, and it sells everything on that Evening to pay Night 8). The test asserts that a greedy investor's ventures pay a
 * real share of the run (so money has a use) but do not carry the late ladder on their own (so the quota stays the game).
 */
import { createRng, hashSeed } from '@/core/rng';
import { BASE_RUN_NIGHTS, START, quotaFor } from '../data/schedule';
import { VENTURES, VENTURE_IDS, meanPay, rollDawn, sellValue, type Holdings, type VentureId } from './ventures';

export type Strategy = 'none' | 'greedy' | 'all-in' | 'smart';

export interface BalanceOpts {
  seed: number;
  strategy: Strategy;
  /** The surplus band carried out of each paid Dawn, as a share of that Night's quota. */
  carry?: readonly [number, number];
  /** The Collector's Heat at each Dawn (index 0 = Night 1). Default: 0, then 1-3 from Night 4. */
  heat?: readonly number[];
  nights?: number;
}

export interface BalanceResult {
  /** Coins the ventures paid over the run. */
  income: number;
  /** Coins spent on ventures. */
  spent: number;
  /** Sell value held at the end. */
  worth: number;
  /** income + sales + worth − spent: what investing gained over keeping the coins. */
  net: number;
  /** The ventures' pay at each Dawn, as a share of the next Night's quota (index 0 = Dawn 1 vs quota 2). */
  shareOfNext: number[];
  /** Total income ÷ the whole ladder. */
  shareOfLadder: number;
  /** Units held at the end, per venture. */
  held: Partial<Record<VentureId, number>>;
}

const DEFAULT_HEAT = [0, 0, 1, 2, 2, 3, 3, 3];
/**
 * The surplus band a surviving player carries out of a paid Dawn, as a share of that Night's quota. Wave 58 notes put a survivor's
 * Dawn wealth near 3x the quota by Night 5 (~900 against 288); the band takes the pocket part of it, after the next Night's stake.
 */
export const CARRY: readonly [number, number] = [0.5, 2];

/** Best payback first, for the strategies. */
const BY_PAYBACK = [...VENTURE_IDS].sort((a, b) => VENTURES[a].price / meanPay(VENTURES[a]) - VENTURES[b].price / meanPay(VENTURES[b]));

export function simulate(o: BalanceOpts): BalanceResult {
  const nights = o.nights ?? BASE_RUN_NIGHTS;
  const [lo, hi] = o.carry ?? CARRY;
  const heat = o.heat ?? DEFAULT_HEAT;
  const rng = createRng(hashSeed(o.seed, 'econ-balance'));
  let held: Holdings = {};
  const count = (id: VentureId): number => held[id]?.length ?? 0;
  let pocket = START.pocket, income = 0, spent = 0, ladder = 0, sold = 0;
  const shareOfNext: number[] = [];
  for (let n = 1; n <= nights; n++) {
    const q = quotaFor(n - 1);
    ladder += q;
    // the Dawn: the Night is paid, the surplus comes back and the ventures pay
    pocket += Math.round(q * (lo + (hi - lo) * rng.next()));
    const dawn = rollDawn(o.seed, n, held, heat[n - 1] ?? 0);
    held = dawn.after;
    const pay = dawn.total;
    pocket += pay;
    income += pay;
    if (n < nights) shareOfNext.push(pay / quotaFor(n));
    if (n >= nights || o.strategy === 'none') continue;
    // the last Evening: the smart investor cashes out for the biggest Night
    if (o.strategy === 'smart' && n === nights - 1) {
      for (const id of VENTURE_IDS) { const v = count(id) * sellValue(VENTURES[id]); sold += v; pocket += v; }
      held = {};
      continue;
    }
    // the Evening after Night n: buy for the Nights to come
    const reserve = o.strategy === 'all-in' ? 0 : Math.round(quotaFor(n) * 0.5);
    const dawnsLeft = nights - 1 - n;   // the smart investor sells on the last Evening, so the last Dawn does not count
    let bought = true;
    while (bought) {
      bought = false;
      for (const id of BY_PAYBACK) {
        const d = VENTURES[id];
        if (n < d.from || count(id) >= d.cap || pocket - d.price < reserve) continue;
        if (o.strategy === 'smart' && dawnsLeft * meanPay(d) + sellValue(d) < d.price) continue;
        pocket -= d.price;
        spent += d.price;
        held[id] = [...(held[id] ?? []), 0];
        bought = true;
        break;
      }
    }
  }
  const worth = VENTURE_IDS.reduce((s, id) => s + count(id) * sellValue(VENTURES[id]), 0);
  const units: Partial<Record<VentureId, number>> = {};
  for (const id of VENTURE_IDS) if (count(id) > 0) units[id] = count(id);
  return { income, spent, worth, net: income + sold + worth - spent, shareOfNext, shareOfLadder: income / ladder, held: units };
}

/** Averages over `runs` seeds (the wave report's numbers). */
export function simulateMany(strategy: Strategy, runs: number, seed0 = 20261019): { income: number; spent: number; net: number; shareOfLadder: number; shareN7: number; shareN8: number } {
  let income = 0, spent = 0, net = 0, ladder = 0, s7 = 0, s8 = 0;
  for (let i = 0; i < runs; i++) {
    const r = simulate({ seed: seed0 + i, strategy });
    income += r.income; spent += r.spent; net += r.net; ladder += r.shareOfLadder;
    s7 += r.shareOfNext[5] ?? 0;   // Dawn 6 pays toward Night 7
    s8 += r.shareOfNext[6] ?? 0;   // Dawn 7 pays toward Night 8
  }
  const k = Math.max(1, runs);
  return { income: income / k, spent: spent / k, net: net / k, shareOfLadder: ladder / k, shareN7: s7 / k, shareN8: s8 / k };
}
