/**
 * Pawn Window — pure rules and the stock contract (devices-core). No three, kit or DOM.
 *
 * GDD §4.1: four slots (3 regular + 1 under the counter), reroll 1 Ticket then +1 per further paid reroll, lock an item
 * so it stays on the shelf (1 Ticket), remove a cursed charm (5 Tickets), price = base × SI. The stock, the odds, the
 * prices and the Ticket costs belong to game-charms. This lane only shows them and asks for the buy.
 *
 * Stock contract: `PawnApi` is read from `run.pawn` (see `pawnFrom`; the implementation is `Pawn` in game/shop.ts). RunApi
 * has no pawn member in its type, so until the run exposes it the window stays shut and says so.
 */
import type { PlayerId } from '@/core/types';
import type { CharmRarity, RunApi } from '@/game/types';
import type { StampApi, StampOffer, StampBuy } from '@/game/stamps';

export const SLOTS = 4;
/** Regular shelves the house can add on top of SLOTS (Second Window): a back row on the counter. */
export const SLOTS_MAX = 6;
export const UNDER_COUNTER_INDEX = 3;

export interface PawnSlot {
  charmId: string;
  /** Coins; negative for a cursed charm (the house pays you a sign-on fee). Free stubs are 0. */
  price: number;
  rarity: CharmRarity;
  cursed: boolean;
  /** The charm's family tag (picks the Pawn icon glyph). */
  tag?: string;
  underCounter: boolean;
  /** Locked: the item stays on the shelf across rerolls and intermissions until it is bought or unlocked (1 Ticket). */
  locked: boolean;
  /** FIT badge: how many of your charms (plus your most-played machine) this charm works with. 0 = no synergy. */
  fit: number;
  /** The shelf-bias slot (x3 weight toward the suit / archetype you hold most). */
  bias: boolean;
  /** Priced below the plain SI price (a discount charm or the discount slot). */
  discounted: boolean;
  /** EVOLVE: a second copy of an owned engine charm. It takes a second stack (no peg) and its numbers move to the evolved tune. */
  evolve?: boolean;
}

/** One charm that can be swapped out when the pegs are full, with its 50 % sellback. */
export interface SwapChoice { id: string; refund: number }

/** Result of `PawnApi.buy`. `swap` = the pegs are full and a `replaceId` is needed. */
export type BuyWhy = '' | 'closed' | 'none' | 'funds' | 'swap' | 'limit' | 'fail';
export interface PawnBuy { ok: boolean; why: BuyWhy }

/** Payout preview on the player's most-played machine: "×1.62 → ×1.88". */
export interface PawnPreview { machineId: string; from: number; to: number }

/** Game-side pawn service (game/shop.ts `Pawn`). All Ticket costs are charged by the game, not by the machine. */
export interface PawnApi {
  /** True while the window is open (intermissions only). */
  open(): boolean;
  /** Shelves in the window (SLOTS plus the Second Window's extras). Optional on older hosts. */
  slotCount?(): number;
  /** Stock for `pid` (co-op: one shared stock). `null` = sold or empty slot. */
  stock(pid: PlayerId): readonly (PawnSlot | null)[];
  /** Tickets the next reroll costs (0 while a free reroll is left, then 1, +1 per further paid reroll). */
  rerollCost(): number;
  reroll(): boolean;
  /** True when a reroll would change anything (some slot is unlocked and unsold). */
  canReroll(): boolean;
  /** Free rerolls left this intermission (they are used before Tickets). */
  freeRerolls(): number;
  /** Lock slot `i` (1 Ticket; the lock carries over until the item is bought). */
  lock(i: number): boolean;
  /** Take the lock off slot `i` (free). */
  unlock(i: number): boolean;
  /** Buy slot `i`. Pass `replaceId` when `needsSwap` (the replaced charm sells back for 50 %). The coins move here. */
  buy(pid: PlayerId, i: number, replaceId?: string): PawnBuy;
  /** True when the pegs are full and slot `i` needs a charm to be replaced. */
  needsSwap(pid: PlayerId, i: number): boolean;
  /** Charms that can be replaced for slot `i`, with their sellback (cursed charms cannot be sold). */
  swapChoices(pid: PlayerId, i: number): readonly SwapChoice[];
  /** Payout preview of slot `i` on the most-played machine, or null. */
  preview(pid: PlayerId, i: number): PawnPreview | null;
  /** Cursed charms `pid` owns (ids), for the 5-Ticket remove-curse service. */
  cursedOwned(pid: PlayerId): readonly string[];
  removeCurse(charmId: string): boolean;
}

export const REMOVE_CURSE_TICKETS = 5;
export const LOCK_TICKETS = 1;
/** At most this many slots may be locked at once. */
export const MAX_LOCKS = 2;

const isFn = (v: unknown): boolean => typeof v === 'function';
const NEEDED = [
  'open', 'stock', 'reroll', 'canReroll', 'freeRerolls', 'lock', 'unlock', 'buy', 'needsSwap', 'swapChoices', 'preview',
  'cursedOwned', 'removeCurse', 'rerollCost',
] as const;

/** Reads the pawn service off the run, or null when the game does not expose one yet (no casts). */
export function pawnFrom(run: RunApi): PawnApi | null {
  const p: unknown = Reflect.get(run, 'pawn');
  if (typeof p !== 'object' || p === null) return null;
  return NEEDED.every((k) => isFn(Reflect.get(p, k))) ? (p as PawnApi) : null;
}

/** Can the player take this slot with `wallet` coins? Cursed slots (negative price) always can: the house pays. */
export function canTake(slot: PawnSlot, wallet: number): boolean {
  return slot.price <= 0 || wallet >= slot.price;
}

/** Cursor step over the four slots, wrapping. */
export function wrapSlot(i: number, dir: 1 | -1): number {
  return (i + dir + SLOTS) % SLOTS;
}

/** Cursor step over `n` entries, wrapping (the swap picker). */
export function wrapIndex(i: number, dir: 1 | -1, n: number): number {
  return n <= 0 ? 0 : (i + dir + n) % n;
}

/** Seconds the second Space stays armed after the first: a purchase takes two presses inside this window. */
export const BUY_CONFIRM_S = 3;

/** Cursor step over the four slots, stopping at the ends (no wrap). Every slot is visited, empty ones included. */
export function stepSlot(i: number, dir: 1 | -1, n: number = SLOTS): number {
  return Math.min(Math.max(SLOTS, n) - 1, Math.max(0, i + dir));
}

/** Cursor step over `n` entries, stopping at the ends (the swap picker). */
export function stepIndex(i: number, dir: 1 | -1, n: number): number {
  return n <= 0 ? 0 : Math.min(n - 1, Math.max(0, i + dir));
}

/** "×1.62" multiplier text. */
export function multText(v: number): string {
  return `×${(Math.round(v * 100) / 100).toFixed(2)}`;
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
  return stock.map((s) => (s ? `${s.charmId}:${s.price}:${s.locked ? 1 : 0}:${s.fit}:${s.evolve ? 1 : 0}` : '-')).join('|');
}

// ── Symbol Stamps tab (game/stamps.ts `StampBook`, read from `run.stamps`) ───────────────────────────────
/** The STAMPS tab shows this many offers (stamps.ts OFFER_COUNT). */
export const STAMP_SLOTS = 3;
/** The stamp service as the tab uses it (a structural subset of `StampApi`: types only, so no value import from game/). */
export type { StampApi, StampOffer, StampBuy };

const STAMP_NEEDED = ['open', 'offers', 'rerollCost', 'canReroll', 'reroll', 'lock', 'unlock', 'buy', 'count', 'cap', 'levels'] as const;

/** Reads the stamp service off the run, or null while the game does not expose one (the tab then stays hidden). */
export function stampsFrom(run: RunApi): StampApi | null {
  const s: unknown = Reflect.get(run, 'stamps');
  if (typeof s !== 'object' || s === null) return null;
  return STAMP_NEEDED.every((k) => isFn(Reflect.get(s, k))) ? (s as StampApi) : null;
}

/** Step the stamp cursor over the offers, stopping at the ends. */
export function stepStamp(i: number, dir: 1 | -1): number {
  return Math.min(STAMP_SLOTS - 1, Math.max(0, i + dir));
}

/** Offer fingerprint, so the tags, icons and ledger repaint only when something changed. */
export function stampKey(offers: readonly (StampOffer | null)[]): string {
  return offers.map((o) => (o ? `${o.kind}:${o.target}:${o.level}:${o.price}:${o.locked ? 1 : 0}` : '-')).join('|');
}

/** Level pips for the card: one entry per level of the stamp, 'own' = owned, 'next' = what this buy adds, 'free' = still to come. */
export function stampPips(level: number, max: number): Array<'own' | 'next' | 'free'> {
  return Array.from({ length: max }, (_, i) => (i < level ? 'own' : i === level ? 'next' : 'free'));
}

/** Card colour of a stamp kind (0xRRGGBB). */
export function stampColor(kind: StampOffer['kind']): number {
  return kind === 'gild' ? 0xffd23c : kind === 'shift' ? 0x62a4ff : 0xe88a48;
}

/** At most this many stamp offers may be locked at once (stamps.ts MAX_STAMP_LOCKS). */
export const STAMP_MAX_LOCKS = 1;
