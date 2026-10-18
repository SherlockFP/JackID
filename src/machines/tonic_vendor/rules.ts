/**
 * Apothecary (tonic_vendor) — pure rules, no three, kit or DOM. Stock per Night, prices and juice come from
 * TONIC_CATALOGUE below (the machine owns its stock, not the run). The machine asks for the purchase; the run charges coins and applies the buff.
 *
 * Stock is seeded by the run seed and the Night index, so every peer sees the same four doses for a Night.
 */
import { createRng, hashSeed } from '@/core/rng';

export const SLOTS = 4;

export type TonicJuice = 'plain' | 'rare' | 'cursed';
/** What a shelf slot sells: a timed buff (tonic), a physical totem (carried item) or a snack from the food page (a `food.*` buff). */
export type TonicKind = 'buff' | 'totem' | 'food';

/** Totems the Apothecary stocks (ids from items/data.ts). Their prices come from that catalogue. */
export const SHELF_TOTEMS: readonly string[] = ['lucky_idol', 'loss_shield', 'profit_bell'];

interface CatalogueEntry { kind: TonicKind; id: string; price: number; juice: TonicJuice }

/** Shelf catalogue: buff or totem id, coin price, juice tier for the sale. The Apothecary rolls 4 of these per Night. */
export const TONIC_CATALOGUE: ReadonlyArray<CatalogueEntry> = [
  { kind: 'buff', id: 'tonic.lucky_mint', price: 40, juice: 'plain' },
  { kind: 'buff', id: 'tonic.iron_nerve', price: 60, juice: 'plain' },
  { kind: 'buff', id: 'tonic.quick_pulse', price: 80, juice: 'plain' },
  { kind: 'buff', id: 'tonic.cold_coffee', price: 35, juice: 'plain' },
  { kind: 'buff', id: 'tonic.dread_salts', price: 50, juice: 'rare' },
  { kind: 'buff', id: 'tonic.energy_drink', price: 90, juice: 'rare' },
  { kind: 'buff', id: 'tonic.cursed_candy', price: 25, juice: 'cursed' },
  // Prices mirror items/data.ts (lucky_idol 120, loss_shield 150, profit_bell 260). Kept inline: machines must not import game/items.
  { kind: 'totem', id: 'lucky_idol', price: 120, juice: 'rare' },
  { kind: 'totem', id: 'loss_shield', price: 150, juice: 'rare' },
  { kind: 'totem', id: 'profit_bell', price: 260, juice: 'rare' },
];

/**
 * The food page (client: "put food like bananas we can eat"): the same four slots, a snack each. Each is a one-Watch buff `food.*`
 * (src/game/data/buffs.ts; the rules and the fridge are src/game/food.ts, which machines may not import, so the prices are mirrored
 * here and a test keeps them in step). Eating one replaces the food bonus you already had. The stock never changes.
 */
export const FOOD_SHELF: ReadonlyArray<CatalogueEntry> = [
  { kind: 'food', id: 'food.banana', price: 8, juice: 'plain' },
  { kind: 'food', id: 'food.coffee', price: 14, juice: 'plain' },
  { kind: 'food', id: 'food.sandwich', price: 20, juice: 'plain' },
  { kind: 'food', id: 'food.energy', price: 28, juice: 'plain' },
];
/** Every buff the food page can leave on the player (and the hidden slot a meal waits in): cleared before a new snack so the show replays. */
export const FOOD_BUFF_IDS: readonly string[] = [...FOOD_SHELF.map((f) => f.id), 'food.pending'];

export interface TonicOffer {
  kind: TonicKind;
  /** Buff id (tonic.*) or totem id (lucky_idol …). */
  id: string;
  price: number;
  juice: TonicJuice;
}

/** The four slots on the shelf for `night` of the run with `seed`. Infinite supply within a Night. */
export function tonicStock(seed: number, night: number): TonicOffer[] {
  const rng = createRng(hashSeed(seed, 'apothecary', night));
  return rng.shuffle([...TONIC_CATALOGUE]).slice(0, SLOTS).map((c) => ({ kind: c.kind, id: c.id, price: c.price, juice: c.juice }));
}

/** The food page's four slots. */
export function foodStock(): TonicOffer[] {
  return FOOD_SHELF.map((c) => ({ kind: c.kind, id: c.id, price: c.price, juice: c.juice }));
}

/** Cursor step over the slots, wrapping. */
export function wrapSlot(i: number, dir: 1 | -1): number {
  return (i + dir + SLOTS) % SLOTS;
}

/** Price tag text: the coin price, or FREE when a dose costs nothing. */
export function priceText(o: TonicOffer | null, fmt: (n: number) => string, free: string): string {
  if (!o) return '--';
  return o.price <= 0 ? free : fmt(o.price);
}

/** Stock fingerprint so the tags and the ledger repaint only when the shelf changes. */
export function stockKey(stock: readonly TonicOffer[]): string {
  return stock.map((o) => `${o.kind}:${o.id}:${o.price}`).join('|');
}
