/**
 * Tombola Raffle Drum (`tombola`) — pure rules (no three, kit or DOM). Shared by the live drum (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP. Contract: MACHINES_tables §20.
 *
 * The drum holds 100 paper tickets numbered 00–99, drawn without replacement. Tickets ending in 0 or 5 (20 of them)
 * are winners: ticket `t` maps to cubby `t / 5`, and the cubby holds one prize from the shelf bag (10 × 2P, 5 × 3P,
 * 3 × 6P, 1 × 12P, 1 × 25P, dealt at random at every restock). Total prize value 90P over 100 tickets, so a full drum
 * pays exactly 90.0 %. A restock (new drum, new shelf) runs when at most `restockAt` tickets stay in the drum or the
 * shelf is empty; the undrawn tickets are discarded, which keeps the expectation at 90 % (every draw is uniform over
 * the drum, so a draw is worth 90P / 100 in expectation). Hooks reach the rules through plain numbers (price, prize
 * scale, luck, spare, peek), so the live machine and the headless contract read the same modifiers.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const DRUM = 100;
export const WIN_STEP = 5;
export const CUBBIES = 20;
/** Base ticket price in coins (× the bet ladder; the live price is `bet × m.tombola.priceMult`). */
export const BASE_PRICE = 10;
export const MIN_STAKE = 10;
export const MAX_STAKE = 100;
export const DEFAULT_RESTOCK_AT = 30;
/** Seconds the Widow spends refilling the drum (the drum is blocked for this long). */
export const RESTOCK_S = 6.0;
/** A pulled ticket that nobody unfolds settles itself after this many seconds. */
export const HOLD_S = 2.5;

export type PrizeId = 'p2' | 'p3' | 'p6' | 'p12' | 'grand';
/** Prize multiple of the ticket price, per prize kind. */
export const PRIZE_MULT: Readonly<Record<PrizeId, number>> = { p2: 2, p3: 3, p6: 6, p12: 12, grand: 25 };
/** How many of each prize one shelf holds (20 prizes = 20 winning tickets). */
export const PRIZE_COUNT: Readonly<Record<PrizeId, number>> = { p2: 10, p3: 5, p6: 3, p12: 1, grand: 1 };
export const PRIZE_ORDER: readonly PrizeId[] = ['p2', 'p3', 'p6', 'p12', 'grand'];

/** Ticket ends in 0 or 5. */
export const isWinner = (ticket: number): boolean => ticket % WIN_STEP === 0;
/** Cubby index (0..19) of a winning ticket. */
export const cubbyOf = (ticket: number): number => Math.floor(ticket / WIN_STEP);
/** Ticket number printed on a cubby. */
export const numberOf = (cubby: number): number => cubby * WIN_STEP;

/** Coins for a prize (rounded to whole coins). */
export function coinValue(prize: PrizeId, price: number, prizeMult = 1): number {
  return Math.round(PRIZE_MULT[prize] * price * prizeMult);
}

/** Ticket price charged for a bet (at least 1 coin). */
export function priceOf(stake: number, priceMult = 1): number {
  return Math.max(1, Math.round(stake * priceMult));
}

export function newDrum(): number[] {
  return Array.from({ length: DRUM }, (_, i) => i);
}

/** A shelf: one entry per cubby, `null` once the cubby has paid out. Prizes are dealt at random. */
export function newShelf(rng: Rng): Array<PrizeId | null> {
  const bag: PrizeId[] = [];
  for (const p of PRIZE_ORDER) for (let i = 0; i < PRIZE_COUNT[p]; i++) bag.push(p);
  return rng.shuffle(bag);
}

/** Removes and returns one ticket chosen uniformly from the drum (null when empty). */
export function drawOne(rng: Rng, drum: number[]): number | null {
  if (drum.length === 0) return null;
  const [t] = drum.splice(rng.int(0, drum.length - 1), 1);
  return t;
}

/** Slips a ticket back into the drum at a random depth. */
export function slipBack(rng: Rng, drum: number[], ticket: number): void {
  drum.splice(rng.int(0, drum.length), 0, ticket);
}

/** Prize multiple a ticket would pay right now (0 for blanks and emptied cubbies). */
export function valueOf(ticket: number, shelf: ReadonlyArray<PrizeId | null>): number {
  if (!isWinner(ticket)) return 0;
  const p = shelf[cubbyOf(ticket)];
  return p ? PRIZE_MULT[p] : 0;
}

export interface PullOpts {
  /** Luck, percent: a blank is slipped back and another pulled with p = luck / 100 (once). */
  luck: number;
  /** Spare Number: pull two, keep the better, the other returns to the drum. */
  spare: boolean;
}
export interface PullOut {
  /** The ticket taken out of the drum (not yet settled). */
  ticket: number;
  /** The ticket returned by Spare Number, or -1. */
  alt: number;
  /** A luck reroll replaced a blank. */
  lucky: boolean;
}

/**
 * One pull from the drum. The drum and shelf are mutated: the taken ticket leaves the drum, slipped-back tickets return
 * to it. Returns null on an empty drum. Consumes the rng in a fixed order per branch, so a seed replays identically.
 */
export function pullTicket(rng: Rng, drum: number[], shelf: ReadonlyArray<PrizeId | null>, o: PullOpts): PullOut | null {
  let ticket = drawOne(rng, drum);
  if (ticket === null) return null;
  let alt = -1;
  if (o.spare && drum.length > 0) {
    const second = drawOne(rng, drum) as number;
    if (valueOf(second, shelf) > valueOf(ticket, shelf)) { alt = ticket; ticket = second; } else alt = second;
    slipBack(rng, drum, alt);
  }
  let lucky = false;
  if (!isWinner(ticket) && o.luck > 0 && rng.chance(o.luck / 100)) {
    slipBack(rng, drum, ticket);
    ticket = drawOne(rng, drum) as number;
    lucky = true;
  }
  return { ticket, alt, lucky };
}

export interface Settlement {
  winner: boolean;
  /** Cubby index, -1 for a blank. */
  cubby: number;
  prize: PrizeId | null;
  /** Coins paid (0 for a blank). */
  gross: number;
}

/** Settles one ticket against the shelf (read before the cubby is emptied). */
export function settle(ticket: number, shelf: ReadonlyArray<PrizeId | null>, price: number, prizeMult = 1): Settlement {
  if (!isWinner(ticket)) return { winner: false, cubby: -1, prize: null, gross: 0 };
  const cubby = cubbyOf(ticket);
  const prize = shelf[cubby] ?? null;
  if (!prize) return { winner: false, cubby, prize: null, gross: 0 };
  return { winner: true, cubby, prize, gross: coinValue(prize, price, prizeMult) };
}

/** Restock when the drum is down to `restockAt` tickets or the shelf is bare. */
export function needsRestock(drumLeft: number, shelf: ReadonlyArray<PrizeId | null>, restockAt: number): boolean {
  return drumLeft <= restockAt || shelf.every((p) => p === null);
}

/** Live EV: prize value still on the shelf ÷ tickets still in the drum, as a fraction of the price. */
export function liveEV(drumLeft: number, shelf: ReadonlyArray<PrizeId | null>): number {
  if (drumLeft <= 0) return 0;
  let v = 0;
  for (const p of shelf) if (p) v += PRIZE_MULT[p];
  return v / drumLeft;
}

/**
 * Headless round for staff auto-play and balance sims: one pull from a fresh drum, settled at once. The uniform draw
 * over a full drum pays exactly 90 % of the price in expectation.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const price = priceOf(bet, h.mod('m.tombola.priceMult' as ModHook, 1));
  const drum = newDrum();
  const shelf = newShelf(rng);
  const out = pullTicket(rng, drum, shelf, {
    luck: h.luck,
    spare: h.mod('m.tombola.doublePull' as ModHook, 0) >= 1,
  });
  if (!out) return { gross: 0, tags: [] };
  const s = settle(out.ticket, shelf, price, h.mod('m.tombola.prizeMult' as ModHook, 1));
  const tags: string[] = [];
  if (out.lucky) tags.push('lucky');
  if (s.prize === 'grand') tags.push('grand');
  return { gross: s.gross, tags };
};
