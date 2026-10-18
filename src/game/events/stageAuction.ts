/**
 * STAGE AUCTION (wave 75 floor event). A crate sits on the Well stage for 20 s. The House names a price (visible). At 10 s the
 * House raises once by a seeded 1 to 3. The player bids pocket coins: each bid must beat the player's own top bid, and the
 * charge is only the raise over the top bid. At the close, a bid above the House price wins the crate (a seeded boost is
 * already rolled); anything else loses and the player gets one Ticket as a consolation.
 *
 * Pure state. The run charges the pocket with the `charge` from `bidAuction` and applies the award from the outcome.
 */
import type { Rng } from '@/core/rng';
import type { FloorAward } from './types';

export const AUCTION_BID_S = 20;
export const AUCTION_RAISE_AT_S = 10;
export const AUCTION_TIME_BOOST_S = 15;
export const AUCTION_TONICS = ['tonic.lucky_mint', 'tonic.iron_nerve', 'tonic.quick_pulse'] as const;

export type AuctionPhase = 'bid' | 'done';

export interface AuctionState {
  /** The House's opening price, coins. */
  house: number;
  /** How much the House adds at AUCTION_RAISE_AT_S. */
  raiseBy: number;
  raised: boolean;
  elapsedS: number;
  /** The player's highest bid so far (0 = none). Coins paid to the House, in total. */
  top: number;
  phase: AuctionPhase;
  /** The boost a win gives. Rolled at the start, so the outcome never needs the rng again. */
  boost: FloorAward;
}

/** Rolls one auction: opening price, the raise, and the boost a win would give. */
export function rollAuction(rng: Rng): AuctionState {
  const house = rng.int(4, 10);
  const raiseBy = rng.int(1, 3);
  const k = rng.weighted(['ticket', 'tonic', 'time'], [3, 2, 2]);
  const boost: FloorAward = k === 'tonic'
    ? { kind: 'tonic', id: rng.pick(AUCTION_TONICS) }
    : k === 'time' ? { kind: 'time', s: AUCTION_TIME_BOOST_S } : { kind: 'ticket', n: 2 };
  return { house, raiseBy, raised: false, elapsedS: 0, top: 0, phase: 'bid', boost };
}

/** The price to beat now: the opening price, plus the raise once it has happened. */
export function auctionPrice(s: AuctionState): number {
  return s.house + (s.raised ? s.raiseBy : 0);
}

export type BidResult = { ok: true; charge: number } | { ok: false; why: 'closed' | 'low' | 'pocket' };

/**
 * One bid: whole coins, above the player's own top bid, and the raise must fit the pocket. Returns the charge (the raise over
 * the top bid) for the run to take from the pocket.
 */
export function bidAuction(s: AuctionState, amount: number, pocket: number): BidResult {
  if (s.phase !== 'bid') return { ok: false, why: 'closed' };
  const a = Math.floor(amount);
  if (!(a > s.top)) return { ok: false, why: 'low' };
  const charge = a - s.top;
  if (charge > Math.max(0, Math.floor(pocket))) return { ok: false, why: 'pocket' };
  s.top = a;
  return { ok: true, charge };
}

/** One frame of the bidding clock. `raised` carries the new price on the one frame the House raises. */
export function tickAuction(s: AuctionState, dtS: number): { raised: number | null } {
  if (s.phase !== 'bid') return { raised: null };
  s.elapsedS += dtS;
  if (!s.raised && s.elapsedS >= AUCTION_RAISE_AT_S) {
    s.raised = true;
    return { raised: auctionPrice(s) };
  }
  return { raised: null };
}

export interface AuctionSettle { won: boolean; award: FloorAward | null; consolation: FloorAward | null }

/** Closes the auction (time up, or the Watch ended first). A bid above the House price wins the boost. */
export function closeAuction(s: AuctionState): AuctionSettle {
  if (s.phase !== 'bid') return { won: false, award: null, consolation: null };
  s.phase = 'done';
  const won = s.top > auctionPrice(s);
  return won
    ? { won, award: s.boost, consolation: null }
    : { won, award: null, consolation: { kind: 'ticket', n: 1 } };
}
