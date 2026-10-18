/**
 * THE HOME COMPUTER, MARKET (wave 77): what the old PC can order. Food is delivered to the fridge (the food lane eats it), two
 * permanent home upgrades change the run, and a reroll slip adds a free Pawn reroll. Pure data: `homeEconomy.ts` sells them.
 *
 * - groceries / coffee: food to the fridge, once per Evening each.
 * - deadbolt (from Night 2, when the knocks start): a knock's toll is halved and a Picker cannot take a charm.
 * - frame (Ada's photo in a good frame): +1 ŞANS at the start of every Night.
 * - reroll: one free Pawn reroll, twice per Evening.
 */
export const MARKET_IDS = ['groceries', 'coffee', 'deadbolt', 'frame', 'reroll'] as const;
export type MarketId = (typeof MARKET_IDS)[number];
export type UpgradeId = 'deadbolt' | 'frame';

export interface MarketDef {
  id: MarketId;
  price: number;
  kind: 'food' | 'upgrade' | 'slip';
  /** Per-Evening limit (0: a permanent upgrade, bought once per run). */
  perEvening: number;
  /** First Night (printed, 1-based) whose Evening offers it. */
  from: number;
  /** Food delivered to the fridge (food only). */
  food?: Readonly<Record<string, number>>;
}

export const MARKET: Readonly<Record<MarketId, MarketDef>> = {
  groceries: { id: 'groceries', price: 14, kind: 'food', perEvening: 1, from: 1, food: { sandwich: 1, banana: 2 } },
  coffee: { id: 'coffee', price: 10, kind: 'food', perEvening: 1, from: 1, food: { coffee: 2 } },
  deadbolt: { id: 'deadbolt', price: 120, kind: 'upgrade', perEvening: 0, from: 2 },
  frame: { id: 'frame', price: 200, kind: 'upgrade', perEvening: 0, from: 2 },
  reroll: { id: 'reroll', price: 25, kind: 'slip', perEvening: 2, from: 1 },
};

export const marketDef = (id: string): MarketDef | undefined => (MARKET as Record<string, MarketDef>)[id];

/** The share of a knock's toll the deadbolt gives back. */
export const DEADBOLT_TOLL_BACK = 0.5;
/** ŞANS stars the frame adds at the start of each Night. */
export const FRAME_STARS = 1;
