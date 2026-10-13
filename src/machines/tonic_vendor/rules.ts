/**
 * Apothecary (tonic_vendor) — pure rules, no three, kit or DOM. Stock per Night, prices and juice come from
 * TONIC_CATALOGUE below (the machine owns its stock, not the run). The machine asks for the purchase; the run charges coins and applies the buff.
 *
 * Stock is seeded by the run seed and the Night index, so every peer sees the same four doses for a Night.
 */
import { createRng, hashSeed } from '@/core/rng';

export const SLOTS = 4;

/** Dose catalogue: buff id, coin price, juice tier for the sale. The Apothecary rolls 4 of these per Night. */
export const TONIC_CATALOGUE: ReadonlyArray<{ id: string; price: number; juice: 'plain' | 'rare' | 'cursed' }> = [
  { id: 'tonic.lucky_mint', price: 40, juice: 'plain' },
  { id: 'tonic.iron_nerve', price: 60, juice: 'plain' },
  { id: 'tonic.quick_pulse', price: 80, juice: 'plain' },
  { id: 'tonic.cold_coffee', price: 35, juice: 'plain' },
  { id: 'tonic.dread_salts', price: 50, juice: 'rare' },
  { id: 'tonic.energy_drink', price: 90, juice: 'rare' },
  { id: 'tonic.cursed_candy', price: 25, juice: 'cursed' },
];


export interface TonicOffer {
  /** Buff id applied on purchase (e.g. 'tonic.lucky_mint'). */
  buffId: string;
  price: number;
  juice: 'plain' | 'rare' | 'cursed';
}

/** The four doses on the shelf for `night` of the run with `seed`. Infinite supply within a Night. */
export function tonicStock(seed: number, night: number): TonicOffer[] {
  const rng = createRng(hashSeed(seed, 'apothecary', night));
  return rng.shuffle([...TONIC_CATALOGUE]).slice(0, SLOTS).map((c) => ({ buffId: c.id, price: c.price, juice: c.juice }));
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
  return stock.map((o) => `${o.buffId}:${o.price}`).join('|');
}
