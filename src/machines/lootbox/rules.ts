/**
 * Mystery Capsule Vendor — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the headless
 * play contract (`playHeadless`), so the simulated RTP IS the live value RTP (MACHINES_machines §14).
 *
 * Three tiers: TIN 10 / BRASS 40 / GILDED 150 coins × stake index. Each capsule rolls one content kind from the tier
 * table (weights in basis points, sum 10 000): DUD trinket, COINS (weighted amounts), or a charm of Common / Uncommon /
 * Rare / Legendary / Cursed rarity. Charm ids come from the launch pool of that rarity.
 *
 * Duplicate non-stackable → 50 % of the charm's price in coins (kind 'charm', dupe). Empty rarity pool → the rarity's
 * reference price in coins (kind 'empty'). Luck moves 1 % absolute per point (cap 20 %) from the lowest tier present
 * (DUD, else COINS) to the next rarity up. Pity forces a Rare+ result on the 10th BRASS/GILDED open without one.
 *
 * The RNG draw count depends only on the path taken (category, coin tier, charm pick), never on charms held.
 */
import type { Rng } from '@/core/rng';
import { roundSig, type HeadlessPlay } from '@/game/types';

export type TierId = 0 | 1 | 2;                   // 0 TIN, 1 BRASS, 2 GILDED
export type Rarity = 'dud' | 'coins' | 'common' | 'uncommon' | 'rare' | 'legendary' | 'cursed';
export type Kind = 'dud' | 'coins' | 'charm' | 'empty';
export type CharmRarityKey = Exclude<Rarity, 'dud' | 'coins'>;

/** A charm the rolls may grant: id, base price (× stake index at roll time) and whether it stacks. */
export interface PoolCharm { readonly id: string; readonly price: number; readonly maxStacks?: number }
/** Empty pool: every charm roll falls back to the reference price in coins (value-equivalent). */
export const NO_POOL: readonly PoolCharm[] = [];

/** Result of one capsule. Plain data so it can travel in events. `charmId` is '' unless kind is 'charm'. */
export interface Content {
  kind: Kind; rarity: Rarity; charmId: string; coins: number; dupe: boolean;
}

export interface TierDef {
  readonly id: 'tin' | 'brass' | 'gilded';
  readonly price: number;                                          // coins at stake index 1
  readonly weights: Readonly<Record<Rarity, number>>;              // basis points of the capsule, sum 10 000
  readonly coins: ReadonlyArray<{ amount: number; w: number }>;    // amount at SI 1; w in basis points of the capsule
}

export const TIERS: readonly TierDef[] = [
  {
    id: 'tin', price: 10,
    weights: { dud: 3240, coins: 4000, common: 2200, uncommon: 500, rare: 60, legendary: 0, cursed: 0 },
    coins: [{ amount: 3, w: 2000 }, { amount: 6, w: 1200 }, { amount: 15, w: 600 }, { amount: 40, w: 200 }],
  },
  {
    id: 'brass', price: 40,
    weights: { dud: 1025, coins: 3500, common: 2500, uncommon: 2000, rare: 700, legendary: 75, cursed: 200 },
    coins: [{ amount: 10, w: 1500 }, { amount: 25, w: 1200 }, { amount: 60, w: 600 }, { amount: 150, w: 200 }],
  },
  {
    id: 'gilded', price: 150,
    weights: { dud: 0, coins: 3000, common: 0, uncommon: 3200, rare: 2500, legendary: 800, cursed: 500 },
    coins: [{ amount: 50, w: 1100 }, { amount: 100, w: 1000 }, { amount: 250, w: 600 }, { amount: 750, w: 300 }],
  },
];

/** Reference prices per charm rarity at SI 1 (value RTP and the empty-pool fallback). */
export const REF_PRICE: Readonly<Record<CharmRarityKey, number>> = {
  common: 15, uncommon: 40, rare: 120, legendary: 400, cursed: 120,
};

/** Order for the weighted category pick. */
const ORDER: readonly Rarity[] = ['dud', 'coins', 'common', 'uncommon', 'rare', 'legendary', 'cursed'];
/** Luck ladder: the first present rarity above the source. */
const LADDER: readonly CharmRarityKey[] = ['common', 'uncommon', 'rare', 'legendary'];
const LUCK_STEP_BP = 100;        // 1 % absolute per luck point
const LUCK_CAP_BP = 2000;        // 20 % absolute
export const PITY_BASE = 10;     // BRASS/GILDED opens without Rare+ before the forced Rare+
export const PITY_MIN = 5;

export const isRarePlus = (r: Rarity): boolean => r === 'rare' || r === 'legendary' || r === 'cursed';

/** Clamp a machine-side tier index into the table. */
export function tierDef(t: number): TierDef {
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.floor(t) || 0))];
}

/** Coins for one capsule of `tier` at stake index `si`, after the discount hook (fraction, clamped 0..0.9). */
export function tierPrice(tier: number, si: number, discount = 0): number {
  const d = Math.min(0.9, Math.max(0, discount));
  return Math.max(1, Math.round(tierDef(tier).price * si * (1 - d)));
}

/** Nearest tier to a bet, in log space (headless staff play bets a tier price at SI 1). */
export function tierForBet(bet: number): TierId {
  let best = 0;
  for (let i = 1; i < TIERS.length; i++) {
    if (Math.abs(Math.log(bet / TIERS[i].price)) < Math.abs(Math.log(bet / TIERS[best].price))) best = i;
  }
  return best as TierId;
}

/** Basis-point weights after the cursed multiplier and the luck shift. Not renormalised (the pick does that). */
export function effectiveWeights(tier: number, luck: number, cursedMult: number): Record<Rarity, number> {
  const w: Record<Rarity, number> = { ...tierDef(tier).weights };
  w.cursed = w.cursed * Math.max(0, cursedMult);
  const shift = Math.min(LUCK_CAP_BP, Math.max(0, Math.floor(luck)) * LUCK_STEP_BP);
  if (shift > 0) {
    const src: Rarity = w.dud > 0 ? 'dud' : 'coins';
    const dst = LADDER.find((r) => w[r] > 0);
    if (dst) {
      const moved = Math.min(shift, w[src]);
      w[src] -= moved;
      w[dst] += moved;
    }
  }
  return w;
}

export interface RollEnv {
  /** Machine luck points (`mod('luck')`). */
  luck: number;
  /** `m.lootbox.cursedOdds` multiplier on the cursed weight (×0 at L100). */
  cursedMult: number;
  /** Pity fired: the result must be Rare+ (proportional redraw over Rare / Legendary / Cursed). */
  forceRarePlus: boolean;
  /** `m.lootbox.rerollToken`: a DUD or COINS result is re-opened once and the second roll is kept. */
  reroll: boolean;
  /** Stake index: scales coin amounts, charm prices and reference values. */
  si: number;
  /** Charm ids the player already holds. */
  owned: (id: string) => boolean;
  /** Launch charm pool of one rarity, from the run (empty = the reference-price coin fallback). */
  pool: (rarity: CharmRarityKey) => readonly PoolCharm[];
}

function drawOnce(rng: Rng, tier: TierId, w: Record<Rarity, number>, env: RollEnv): Content {
  const def = tierDef(tier);
  let cat: Rarity;
  if (env.forceRarePlus) {
    const cands: Rarity[] = ['rare', 'legendary', 'cursed'];
    const ws = cands.map((r) => w[r]);
    cat = ws.some((x) => x > 0) ? cands[rng.weightedIndex(ws)] : 'rare';
  } else {
    cat = ORDER[rng.weightedIndex(ORDER.map((r) => w[r]))];
  }
  if (cat === 'dud') return { kind: 'dud', rarity: 'dud', charmId: '', coins: 0, dupe: false };
  if (cat === 'coins') {
    const amount = def.coins[rng.weightedIndex(def.coins.map((c) => c.w))].amount;
    return { kind: 'coins', rarity: 'coins', charmId: '', coins: Math.round(amount * env.si), dupe: false };
  }
  const rk = cat as CharmRarityKey;
  const pool = env.pool(rk);
  if (pool.length === 0) {
    return { kind: 'empty', rarity: cat, charmId: '', coins: Math.round(REF_PRICE[rk] * env.si), dupe: false };
  }
  const charm = rng.pick(pool);
  if (env.owned(charm.id) && (charm.maxStacks ?? 1) <= 1) {
    return { kind: 'charm', rarity: cat, charmId: charm.id, coins: Math.round(roundSig(charm.price * env.si, 2) * 0.5), dupe: true };
  }
  return { kind: 'charm', rarity: cat, charmId: charm.id, coins: 0, dupe: false };
}

/** Roll one capsule. The tier is fixed at crank commit; the content is decided here and revealed at open. */
export function rollCapsule(rng: Rng, tier: number, env: RollEnv): Content {
  const t = Math.min(2, Math.max(0, Math.floor(tier) || 0)) as TierId;
  const w = effectiveWeights(t, env.luck, env.cursedMult);
  let c = drawOnce(rng, t, w, env);
  if (env.reroll && (c.kind === 'dud' || c.kind === 'coins')) c = drawOnce(rng, t, w, env);
  return c;
}

/** Coins the player keeps for a capsule. Granted charms pay nothing; dupes and empty pools pay coins. */
export function payoutOf(c: Content): number {
  return c.kind === 'charm' && !c.dupe ? 0 : c.coins;
}

/** Value of a capsule at SI `si`: coins, plus the reference price of a granted charm. Used by the RTP sim. */
export function valueOf(c: Content, si: number): number {
  if (c.kind === 'charm' && !c.dupe) return Math.round(REF_PRICE[c.rarity as CharmRarityKey] * si);
  return c.coins;
}

/**
 * TRADE UP. After a reveal the player may give the prize up as credit toward a sealed capsule of the next tier. The
 * credit is the prize's value (`valueOf`), the player pays the difference to the next tier's price. Marginal EV of the
 * trade = E(next tier) − price(next tier), i.e. exactly that tier's own edge: a trade never adds an edge of its own.
 * Offered only when the prize is worth less than the next capsule (the difference is always positive) and never at GILDED.
 */
export function nextTierOf(tier: number): TierId | null {
  const t = Math.floor(tier) || 0;
  return t >= 0 && t < TIERS.length - 1 ? ((t + 1) as TierId) : null;
}

export function tradeOpen(tier: number, c: Content, si: number, discount = 0): boolean {
  const nt = nextTierOf(tier);
  return nt !== null && valueOf(c, si) < tierPrice(nt, si, discount);
}

/** Coins the player pays to trade a prize up: the next tier's price less the prize's value (≥ 1 when `tradeOpen`). */
export function tradeCost(tier: number, c: Content, si: number, discount = 0): number {
  const nt = nextTierOf(tier);
  return nt === null ? 0 : Math.max(1, tierPrice(nt, si, discount) - valueOf(c, si));
}

/** Normalised probability weights (0..1) of one tier after luck and the cursed multiplier. Sums to 1. */
function shares(tier: number, luck: number, cursedMult: number): Record<Rarity, number> {
  const w = effectiveWeights(tier, luck, cursedMult);
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  const out = {} as Record<Rarity, number>;
  for (const r of ORDER) out[r] = w[r] / total;
  return out;
}

/** Share of capsules that are Rare or better (the shown odds of a sealed capsule). */
export function rarePlusShare(tier: number, luck: number, cursedMult: number): number {
  const s = shares(tier, luck, cursedMult);
  return s.rare + s.legendary + s.cursed;
}

/** Average value of one capsule of `tier` at stake index `si` (coins, charms at the reference price). Shown as the odds. */
export function tierEv(tier: number, si: number, luck: number, cursedMult: number): number {
  const s = shares(tier, luck, cursedMult);
  const def = tierDef(tier);
  const coinW = def.coins.reduce((a, c) => a + c.w, 0);
  const coinMean = coinW > 0 ? def.coins.reduce((a, c) => a + c.amount * c.w, 0) / coinW : 0;
  let ev = s.coins * coinMean * si;
  for (const r of LADDER_REFS) ev += s[r] * REF_PRICE[r] * si;
  return ev;
}
const LADDER_REFS: readonly CharmRarityKey[] = ['common', 'uncommon', 'rare', 'legendary', 'cursed'];

/** Pity threshold: 10 by default, `m.lootbox.pityAt` adds a negative offset, never below 5. */
export function pityThreshold(pityAtMod: number): number {
  return Math.max(PITY_MIN, PITY_BASE + Math.floor(pityAtMod));
}

/** True when this open is the one that reaches the threshold (BRASS and GILDED only). */
export function pityArmed(count: number, tier: number, threshold: number): boolean {
  return tier >= 1 && count + 1 >= threshold;
}

/** Counter after an open: BRASS/GILDED non-Rare+ +1, a Rare+ from BRASS/GILDED resets, TIN leaves it alone. */
export function nextPity(count: number, tier: number, rarity: Rarity): number {
  if (tier < 1) return count;
  return isRarePlus(rarity) ? 0 : count + 1;
}

/**
 * Headless play (staff auto-play and balance sims). Coins only, as the live machine settles. Charm rolls use the empty
 * pool, so they pay the reference price in coins: the sim measures value RTP.
 *
 * The stake buys `bet / price` of a capsule: the tier is the nearest one to the bet and the payout is scaled by the
 * stake over that tier's price (after the discount hook). So gross / bet is the value RTP of the tier for ANY stake, and
 * a stake below the TIN price can no longer be paid as a full 10-coin capsule.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const tier = tierForBet(bet);
  const c = rollCapsule(rng, tier, {
    luck: h.luck,
    cursedMult: h.mod('m.lootbox.cursedOdds', 1),
    forceRarePlus: false,
    reroll: h.mod('m.lootbox.rerollToken', 0) >= 1,
    si: 1,
    owned: () => false,
    pool: () => NO_POOL,
  });
  const price = tierPrice(tier, 1, h.mod('m.lootbox.discount', 0));
  const share = bet > 0 ? bet / price : 0;
  return { gross: payoutOf(c) * share, tags: [c.rarity] };
};
