/**
 * Pawn Window — pure rules and the stock contract (devices-core). No three, kit or DOM.
 *
 * GDD §4.1: four slots (3 regular + 1 under the counter), reroll 1 Ticket then +1 per further reroll, lock one item
 * for the next visit (1 Ticket), remove a cursed charm (5 Tickets), price = base × SI. The stock, the odds, the prices
 * and the Ticket costs belong to game-charms. This lane only shows them and asks for the buy.
 *
 * Stock contract: `PawnApi` is read from `run.pawn` (see `pawnFrom`). RunApi has no pawn member yet, so until the
 * game exposes it the window stays shut and says so (the director was asked to add `pawn: PawnApi` to RunApi).
 */
import type { PlayerId } from '@/core/types';
import type { CharmRarity, RunApi } from '@/game/types';

export const SLOTS = 4;
export const UNDER_COUNTER_INDEX = 3;

export interface PawnSlot {
  charmId: string;
  /** Coins; negative for a cursed charm (the house pays you a sign-on fee). Free stubs are 0. */
  price: number;
  rarity: CharmRarity;
  cursed: boolean;
  underCounter: boolean;
  /** Locked for this visit (1 Ticket, game side). */
  locked: boolean;
}

/** Game-side pawn service (game-charms). All Ticket costs are charged by the game, not by the machine. */
export interface PawnApi {
  /** True while the window is open (intermissions only). */
  open(): boolean;
  /** Stock for `pid` (co-op: per-player seed). `null` = sold or empty slot. */
  stock(pid: PlayerId): readonly (PawnSlot | null)[];
  /** Tickets the next reroll costs (1, then +1 per further reroll this intermission). */
  rerollCost(): number;
  reroll(): boolean;
  /** Lock slot `i` for the next visit. */
  lock(i: number): boolean;
  /** Cursed charms `pid` owns (ids), for the 5-Ticket remove-curse service. */
  cursedOwned(pid: PlayerId): readonly string[];
  removeCurse(charmId: string): boolean;
}

export const REMOVE_CURSE_TICKETS = 5;
export const LOCK_TICKETS = 1;

const isFn = (v: unknown): boolean => typeof v === 'function';

/** Reads the pawn service off the run, or null when the game does not expose one yet (no casts). */
export function pawnFrom(run: RunApi): PawnApi | null {
  const p: unknown = Reflect.get(run, 'pawn');
  if (typeof p !== 'object' || p === null) return null;
  const ok = isFn(Reflect.get(p, 'open')) && isFn(Reflect.get(p, 'stock')) && isFn(Reflect.get(p, 'reroll'))
    && isFn(Reflect.get(p, 'lock')) && isFn(Reflect.get(p, 'cursedOwned')) && isFn(Reflect.get(p, 'removeCurse'))
    && isFn(Reflect.get(p, 'rerollCost'));
  return ok ? (p as PawnApi) : null;
}

/** Can the player take this slot with `wallet` coins? Cursed slots (negative price) always can: the house pays. */
export function canTake(slot: PawnSlot, wallet: number): boolean {
  return slot.price <= 0 || wallet >= slot.price;
}

/** Cursor step over the four slots, wrapping. */
export function wrapSlot(i: number, dir: 1 | -1): number {
  return (i + dir + SLOTS) % SLOTS;
}

/** Price tag text: "FREE", "+40" (house pays you for a cursed charm) or the coin price. */
export function priceText(slot: PawnSlot | null, fmt: (n: number) => string, free: string): string {
  if (!slot) return '--';
  if (slot.price === 0) return free;
  if (slot.price < 0) return `+${fmt(-slot.price)}`;
  return fmt(slot.price);
}

/** Rarity → juice tier for the purchase (rare = a flash, legendary = the big stamp). */
export function buyJuice(rarity: CharmRarity, cursed: boolean): 'plain' | 'rare' | 'legend' | 'cursed' {
  if (cursed) return 'cursed';
  if (rarity === 'legendary') return 'legend';
  if (rarity === 'rare') return 'rare';
  return 'plain';
}

/** Stock fingerprint, so the tags and the ledger repaint only when something changed. */
export function stockKey(stock: readonly (PawnSlot | null)[]): string {
  return stock.map((s) => (s ? `${s.charmId}:${s.price}:${s.locked ? 1 : 0}` : '-')).join('|');
}
