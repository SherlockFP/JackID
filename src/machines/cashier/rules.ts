/**
 * Cashier cage (`cashier`, system, LOB-CASH) — pure rules, no three, kit or DOM (devices-lobby lane). GDD §2 Tickets,
 * §7.4 Free Casino (House Credit), §10 currency table.
 *
 * The teller swaps coins for Tickets and back, sells a Pull for Tickets, and in the Free Casino lends House Credit. The rates
 * below are the lane's tuning, scaled by the stake index (SI). Nothing here moves money: the machine asks `run.spend` /
 * `run.earn` in the credit step.
 *
 * Wave 27 (bank-econ): the cage is the answer to an empty pocket. Row 1 is SELL ALL TICKETS (every Ticket for coins, the one-press
 * rescue), row 2 sells one, row 3 buys a Pull with 3 Tickets (the Tickets' best use: one more play), then the buys. The Debt
 * mode used to carry a House Credit row that was always blocked; it now shows BUY 5.
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
/** Tickets one extra Pull costs (the run's `buyPull`, at most +2 a Watch). */
export const PULL_TICKETS = 3;
/** Stat key the loan total is tracked under on the scoreboard ("House Credit"). */
export const HOUSE_CREDIT_STAT = 'house_credit';

export type OfferOp = 'buy' | 'sell' | 'sellAll' | 'pull' | 'loan';
export interface Offer {
  id: string;
  op: OfferOp;
  /** Tickets moved (0 for a loan; for `sellAll` the count is the Tickets held). */
  tickets: number;
}

/** The five buttons on the cage counter, in cursor order. */
export const OFFERS: readonly Offer[] = [
  { id: 'sellAll', op: 'sellAll', tickets: 0 },
  { id: 'sell1', op: 'sell', tickets: 1 },
  { id: 'pull', op: 'pull', tickets: PULL_TICKETS },
  { id: 'buy1', op: 'buy', tickets: 1 },
  { id: 'buy5', op: 'buy', tickets: 5 },
];
const LOAN_OFFER: Offer = { id: 'loan', op: 'loan', tickets: 0 };

/** The five offers for a run mode: the Free Casino swaps BUY 5 for the House Credit loan. */
export function offersFor(mode: string): readonly Offer[] {
  return mode === 'free' ? [...OFFERS.slice(0, 4), LOAN_OFFER] : OFFERS;
}

export type ExchangeCheck = 'ok' | 'funds' | 'cap' | 'tickets' | 'mode' | 'phase';

export interface Quote {
  /** Coin amount, always positive. Buy: paid out of the wallet. Sell and loan: paid into the wallet. */
  coins: number;
  /** Tickets arriving (+, buy) or leaving (−, sell, pull). */
  tickets: number;
}

/** Price of an offer for stake index `si`. `held` = Tickets in hand (SELL ALL sells them all). Loans are a credit. */
export function quote(offer: Offer, si: number, held = 0): Quote {
  const s = Math.max(1, si);
  if (offer.op === 'buy') return { coins: BUY_PER_SI * s * offer.tickets, tickets: offer.tickets };
  if (offer.op === 'sell') return { coins: SELL_PER_SI * s * offer.tickets, tickets: -offer.tickets };
  if (offer.op === 'sellAll') { const n = Math.max(0, Math.floor(held)); return { coins: SELL_PER_SI * s * n, tickets: -n }; }
  if (offer.op === 'pull') return { coins: 0, tickets: -offer.tickets };
  return { coins: LOAN_PER_SI * s, tickets: 0 };
}

/** Stake index of the run (GDD §3.2), at least 1. */
export const stakeOf = (run: RunApi): number => Math.max(1, run.shift.state().stake);

/** `DebtRun` calls the cage reaches through the run (absent on the bench stub). */
type CageCtl = { buyPull?(): boolean };
/** Coins the pocket can still play with are below the cheapest bet: the cage is the way out. */
export function pocketBroke(run: RunApi): boolean {
  return !!(run as unknown as { brokeHelp?(): unknown }).brokeHelp?.();
}

/** Checks an offer against the wallet, the cage ceiling and the run mode. Pure: reads RunApi only. */
export function check(offer: Offer, run: RunApi, pid: PlayerId): ExchangeCheck {
  if (offer.op === 'loan') return run.mode === 'free' ? 'ok' : 'mode';
  const held = run.balance('ticket', pid);
  if (offer.op === 'pull') {
    if (held < offer.tickets) return 'tickets';
    const ph = run.shift.phase;
    return ph === 'play' || ph === 'lastCall' ? 'ok' : 'phase';
  }
  if (offer.op === 'sellAll') return held > 0 ? 'ok' : 'tickets';
  const q = quote(offer, stakeOf(run), held);
  if (offer.op === 'buy') {
    if (held + offer.tickets > TICKET_CAP) return 'cap';
    return run.balance('coin', pid) >= q.coins ? 'ok' : 'funds';
  }
  return held >= offer.tickets ? 'ok' : 'tickets';
}

/** Applies an exchange through RunApi. Returns false when the spend is refused (the caller shows the refusal). */
export function apply(offer: Offer, run: RunApi, pid: PlayerId, si: number): boolean {
  const held = run.balance('ticket', pid);
  const q = quote(offer, si, held);
  if (offer.op === 'loan') {
    run.earn('coin', q.coins, 'house_credit', pid);
    run.stat(HOUSE_CREDIT_STAT, q.coins);
    return true;
  }
  if (offer.op === 'pull') return (run as RunApi & CageCtl).buyPull?.() ?? false;
  if (offer.op === 'buy') {
    if (!run.spend('coin', q.coins, 'cashier', pid)) return false;
    run.earn('ticket', offer.tickets, 'cashier', pid);
    return true;
  }
  const n = -q.tickets;
  if (n <= 0) return false;
  if (!run.spend('ticket', n, 'cashier', pid)) return false;
  run.earn('coin', q.coins, 'cashier', pid);
  return true;
}

/** Cursor step over the offers, wrapping. */
export function wrapOffer(i: number, dir: 1 | -1): number {
  return (i + dir + OFFERS.length) % OFFERS.length;
}
