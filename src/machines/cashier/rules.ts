/**
 * Cashier cage (`cashier`, system, LOB-CASH) — pure rules, no three, kit or DOM (devices-lobby lane). GDD §2 Tickets,
 * §7.4 Free Casino (House Credit), §10 currency table.
 *
 * The teller swaps coins for Tickets and back, and in the Free Casino lends House Credit. The rates below are the
 * lane's tuning, scaled by the stake index (SI). The director owns the final numbers (flagged in the lane report).
 * Nothing here moves money: the machine asks `run.spend` / `run.earn` in the credit step.
 */
import type { PlayerId } from '@/core/types';
import type { RunApi } from '@/game/types';

/** Coins per Ticket when buying (× SI). Expensive on purpose: Tickets come mostly from play and contracts. */
export const BUY_PER_SI = 15;
/** Coins paid per Ticket when selling (× SI). Always below the buy price, so a round trip loses coins. */
export const SELL_PER_SI = 5;
/** House Credit lent per request (× SI), Free Casino only (GDD §7.4). */
export const LOAN_PER_SI = 500;
/** Ticket ceiling for the cage (GDD §10: Tickets cap at 99). */
export const TICKET_CAP = 99;
/** Stat key the loan total is tracked under on the scoreboard ("House Credit"). */
export const HOUSE_CREDIT_STAT = 'house_credit';

export type OfferOp = 'buy' | 'sell' | 'loan';
export interface Offer {
  id: string;
  op: OfferOp;
  /** Tickets moved (0 for a loan). */
  tickets: number;
}

/** The five buttons on the cage counter, in cursor order. */
export const OFFERS: readonly Offer[] = [
  { id: 'buy1', op: 'buy', tickets: 1 },
  { id: 'buy5', op: 'buy', tickets: 5 },
  { id: 'sell1', op: 'sell', tickets: 1 },
  { id: 'sell5', op: 'sell', tickets: 5 },
  { id: 'loan', op: 'loan', tickets: 0 },
];

export type ExchangeCheck = 'ok' | 'funds' | 'cap' | 'tickets' | 'mode';

export interface Quote {
  /** Coin amount, always positive. Buy: paid out of the wallet. Sell and loan: paid into the wallet. */
  coins: number;
  /** Tickets arriving (+, buy) or leaving (−, sell). */
  tickets: number;
}

/** Price of an offer for stake index `si`. Loans are a credit: the house pays out `LOAN_PER_SI × si`. */
export function quote(offer: Offer, si: number): Quote {
  const s = Math.max(1, si);
  if (offer.op === 'buy') return { coins: BUY_PER_SI * s * offer.tickets, tickets: offer.tickets };
  if (offer.op === 'sell') return { coins: SELL_PER_SI * s * offer.tickets, tickets: -offer.tickets };
  return { coins: LOAN_PER_SI * s, tickets: 0 };
}

/** Stake index of the run (GDD §3.2), at least 1. */
export const stakeOf = (run: RunApi): number => Math.max(1, run.shift.state().stake);

/** Checks an offer against the wallet, the cage ceiling and the run mode. Pure: reads RunApi only. */
export function check(offer: Offer, run: RunApi, pid: PlayerId): ExchangeCheck {
  if (offer.op === 'loan') return run.mode === 'free' ? 'ok' : 'mode';
  const q = quote(offer, stakeOf(run));
  if (offer.op === 'buy') {
    if (run.balance('ticket', pid) + offer.tickets > TICKET_CAP) return 'cap';
    return run.balance('coin', pid) >= q.coins ? 'ok' : 'funds';
  }
  return run.balance('ticket', pid) >= offer.tickets ? 'ok' : 'tickets';
}

/** Applies an exchange through RunApi. Returns false when the spend is refused (the caller shows the refusal). */
export function apply(offer: Offer, run: RunApi, pid: PlayerId, si: number): boolean {
  const q = quote(offer, si);
  if (offer.op === 'loan') {
    run.earn('coin', q.coins, 'house_credit', pid);
    run.stat(HOUSE_CREDIT_STAT, q.coins);
    return true;
  }
  if (offer.op === 'buy') {
    if (!run.spend('coin', q.coins, 'cashier', pid)) return false;
    run.earn('ticket', offer.tickets, 'cashier', pid);
    return true;
  }
  if (!run.spend('ticket', offer.tickets, 'cashier', pid)) return false;
  run.earn('coin', q.coins, 'cashier', pid);
  return true;
}

/** Cursor step over the offers, wrapping. */
export function wrapOffer(i: number, dir: 1 | -1): number {
  return (i + dir + OFFERS.length) % OFFERS.length;
}
