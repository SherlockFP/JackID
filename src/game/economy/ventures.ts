/**
 * THE HOME COMPUTER, INVESTMENTS (wave 77, money with purpose): the small ventures the player buys from the old PC on the apartment
 * desk. Each one costs coins once, pays a seeded amount at every paid Dawn (with a little variance and a rare bad night), has a cap
 * on how many you may hold, and sells back for half its price. Pure data and maths: no state, no bus. `homeEconomy.ts` holds them.
 *
 * A venture grows while you hold it: it finds its regulars, and each Dawn it has paid adds GROWTH to its pay, up to GROWTH_MAX. So an
 * early buy snowballs (the run's build), and a late one mostly holds value (the sell-back).
 *
 * Tuning (2026-10-19): every venture pays its price back in 4 to 5 Nights on average (bad nights and growth included). A venture
 * bought on the Evening after Night k pays at Dawns k+1 .. 8. The bigger ones open later. Numbers: `balance.ts` and the economy test.
 */
import { createRng, hashSeed } from '@/core/rng';

export const VENTURE_IDS = ['vending', 'laundry', 'taxi', 'cards', 'bakery'] as const;
export type VentureId = (typeof VENTURE_IDS)[number];

export interface VentureDef {
  id: VentureId;
  /** Coins to buy one. */
  price: number;
  /** Base pay of one at a Dawn, before the variance. */
  base: number;
  /** The pay swings by up to ± this share of `base` (uniform). */
  swing: number;
  /** Chance a Dawn is a bad night for one: it pays nothing. */
  bad: number;
  /** Most you may hold at once. */
  cap: number;
  /** First Night (printed, 1-based) whose Evening offers it. */
  from: number;
}

/** Each Dawn a venture has paid adds this share of its base pay, up to GROWTH_MAX x base. A frozen Dawn does not count. */
export const GROWTH = 0.1;
export const GROWTH_MAX = 1.5;

/** The share of the price a sale gives back. */
export const SELL_SHARE = 0.5;

export const VENTURES: Readonly<Record<VentureId, VentureDef>> = {
  vending: { id: 'vending', price: 30, base: 7, swing: 0.25, bad: 0.08, cap: 3, from: 1 },
  laundry: { id: 'laundry', price: 90, base: 20, swing: 0.2, bad: 0.06, cap: 2, from: 1 },
  taxi: { id: 'taxi', price: 260, base: 56, swing: 0.3, bad: 0.1, cap: 2, from: 2 },
  cards: { id: 'cards', price: 700, base: 165, swing: 0.5, bad: 0.15, cap: 1, from: 3 },
  bakery: { id: 'bakery', price: 1500, base: 330, swing: 0.1, bad: 0.04, cap: 1, from: 4 },
};

/** Heat at or above which the Collector freezes your best venture for the Dawn; at HEAT_FREEZE_TWO, the best two. */
export const HEAT_FREEZE_ONE = 3;
export const HEAT_FREEZE_TWO = 5;

export const ventureDef = (id: string): VentureDef | undefined => (VENTURES as Record<string, VentureDef>)[id];

/** The pay factor of a venture that has paid `age` Dawns. */
export function growthOf(age: number): number { return Math.min(GROWTH_MAX, 1 + GROWTH * Math.max(0, Math.floor(age))); }

/** The average pay of one at a Dawn at `age`: base x growth x the chance it is not a bad night (the swing is symmetric). */
export function meanPay(d: VentureDef, age = 0): number { return d.base * growthOf(age) * (1 - d.bad); }

/** Dawns to earn the price back on average, growth included (fractional: the last Dawn counts in part). */
export function paybackNights(d: VentureDef): number {
  let sum = 0;
  for (let age = 0; age < 50; age++) {
    const m = meanPay(d, age);
    if (sum + m >= d.price) return Math.round((age + (d.price - sum) / m) * 10) / 10;
    sum += m;
  }
  return 50;
}

export function sellValue(d: VentureDef): number { return Math.floor(d.price * SELL_SHARE); }

/** One venture's line in a Dawn report. */
export interface VentureLine {
  id: VentureId;
  /** Which one of that kind (0-based). */
  k: number;
  amount: number;
  kind: 'ok' | 'bad' | 'frozen';
}

export interface DawnPay { night: number; lines: VentureLine[]; total: number; frozen: number }

/** The ventures held: one age (Dawns paid) per unit, oldest first. */
export type Holdings = Partial<Record<VentureId, number[]>>;

/** How many units the Collector freezes at this Heat. */
export function freezeCount(heat: number): number {
  return heat >= HEAT_FREEZE_TWO ? 2 : heat >= HEAT_FREEZE_ONE ? 1 : 0;
}

/**
 * The pay of every venture held at the Dawn of `night`. Seeded by (seed, night, venture, unit), so a reload pays the same. The
 * Collector freezes the most valuable units first (his men sit in the taxi before they bother with the vending machines). Returns
 * the report and the holdings after the Dawn (every unit that was not frozen is one Dawn older).
 */
export function rollDawn(seed: number, night: number, held: Readonly<Holdings>, heat: number): DawnPay & { after: Holdings } {
  const units: Array<{ d: VentureDef; k: number; age: number }> = [];
  for (const id of VENTURE_IDS) {
    const ages = held[id] ?? [];
    for (let k = 0; k < ages.length; k++) units.push({ d: VENTURES[id], k, age: Math.max(0, Math.floor(ages[k] ?? 0)) });
  }
  // the freeze takes the dearest (then the oldest) units first; the order of the report stays the shop order
  const byValue = [...units].sort((a, b) => b.d.price * growthOf(b.age) - a.d.price * growthOf(a.age) || a.k - b.k);
  const frozenSet = new Set(byValue.slice(0, freezeCount(heat)));
  const lines: VentureLine[] = [];
  const after: Holdings = {};
  let total = 0;
  for (const u of units) {
    const ages = (after[u.d.id] ??= []);
    if (frozenSet.has(u)) { ages.push(u.age); lines.push({ id: u.d.id, k: u.k, amount: 0, kind: 'frozen' }); continue; }
    ages.push(u.age + 1);
    const rng = createRng(hashSeed(seed, 'venture', night, u.d.id, u.k));
    if (rng.chance(u.d.bad)) { lines.push({ id: u.d.id, k: u.k, amount: 0, kind: 'bad' }); continue; }
    const amount = Math.max(1, Math.round(u.d.base * growthOf(u.age) * (1 + u.d.swing * (2 * rng.next() - 1))));
    total += amount;
    lines.push({ id: u.d.id, k: u.k, amount, kind: 'ok' });
  }
  return { night, lines, total, frozen: frozenSet.size, after };
}
