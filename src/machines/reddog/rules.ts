/**
 * Red Dog "The Kennel" (`reddog`) — pure rules (MACHINES_tables §17). No three, no DOM, no kit.
 *
 * One shared hand for the whole table, six seats, six decks, ranks 2…A (A high). Two cards are dealt face up:
 *  - consecutive ranks → push (the third card is never drawn);
 *  - a pair → a third card: three of a kind pays 11:1, otherwise push;
 *  - otherwise the spread = the number of ranks strictly between the two. The third card must land strictly inside
 *    the spread to win at the spread's pay on the WHOLE wager (main bet + raise), else the wager is lost.
 * Each seat may raise once, up to its original bet (`raiseMax` × bet), by a full or a half raise.
 *
 * The live host (`index.ts`) and the Node RTP sim both call these functions, so the simulated RTP is the live RTP.
 * Every `settle*` returns the total the wager gets BACK (stake included), as in cardwar and baccarat.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { HeadlessHooks, HeadlessPlay, ModHook } from '@/game/types';
import { newShoe, rankOf } from '@/machines/_base/cards';

export const SEATS = 6;
export const DECKS = 6;
export const CUT = 0.8;                     // penetration: the cut card sits at 80 % of the shoe
export const BET_MIN = 5;
export const BET_MAX = 200;
/** Optimal play raises on a spread of this size or more (the 97.20 % strategy). */
export const RAISE_MIN_SPREAD = 7;
export const BARK_S = 0.25;                 // one bark per rank of the spread
/** Index = spread (1…11). Spread 0 never pays (consecutive pushes). */
export const SPREAD_PAY: readonly number[] = [0, 5, 4, 2, 1, 1, 1, 1, 1, 1, 1, 1];
export const TRIPS_PAY = 11;

export type Kind = 'consecutive' | 'pair' | 'spread';
export type Raise = 'none' | 'half' | 'full';

export interface Deal { c1: CardId; c2: CardId; r1: number; r2: number; lo: number; hi: number; kind: Kind; spread: number }
/** Charm and milestone adjustments read on the host once per hand (all default to the base game). */
export interface Pay { spreadAdd: number; spread1Add: number; tripsPay: number; pairWin: boolean; raiseMax: number }
export const BASE_PAY: Pay = { spreadAdd: 0, spread1Add: 0, tripsPay: TRIPS_PAY, pairWin: false, raiseMax: 1 };

/** Hi-Lo value of a card (2–6 +1, 10–A −1). Public once dealt, so the Counting Bead may show it. */
export function hiLo(c: CardId): number {
  const r = rankOf(c);
  if (r >= 2 && r <= 6) return 1;
  if (r >= 10) return -1;
  return 0;
}

// ── shoe ─────────────────────────────────────────────────────────────────────────────────────────
export class RdShoe {
  private cards: CardId[] = [];
  private pos = 0;
  private count = 0;
  /** Number of shoes started (1 after the constructor). */
  shoes = 0;

  constructor(private readonly rng: Rng, readonly decks: number) { this.reshuffle(); }

  get remaining(): number { return this.cards.length - this.pos; }
  /** True once the hand just dealt crossed the cut card (reshuffle before the next OPEN). */
  get atCut(): boolean { return this.pos >= Math.floor(this.cards.length * CUT); }
  /** Hi-Lo running count of the cards dealt from this shoe. */
  get running(): number { return this.count; }
  /** Hi-Lo true count: running count per remaining deck. */
  get trueCount(): number { return this.count / Math.max(0.5, this.remaining / 52); }

  reshuffle(): void {
    this.cards = newShoe(this.decks, this.rng);
    this.pos = 0;
    this.count = 0;
    this.shoes++;
  }
  /** Next card. Reshuffles only as a safety net (the cut card makes this unreachable inside a hand). */
  draw(): CardId {
    if (this.remaining <= 0) this.reshuffle();
    const c = this.cards[this.pos++]!;
    this.count += hiLo(c);
    return c;
  }
  /** The card `k` places ahead of the next draw (0 = next). Host-only; used for the peek charm. */
  peek(k = 0): CardId | null { return this.pos + k < this.cards.length ? this.cards[this.pos + k]! : null; }
  /** Put one card back at a random place in the remaining shoe (a solo redraw). */
  reinsert(card: CardId): void {
    this.count -= hiLo(card);
    const at = this.pos + this.rng.int(0, this.remaining);
    this.cards.splice(at, 0, card);
  }
}

// ── classification and payouts ───────────────────────────────────────────────────────────────────
export function classify(c1: CardId, c2: CardId): Deal {
  const r1 = rankOf(c1), r2 = rankOf(c2);
  const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
  const gap = hi - lo;
  const kind: Kind = gap === 0 ? 'pair' : gap === 1 ? 'consecutive' : 'spread';
  return { c1, c2, r1, r2, lo, hi, kind, spread: kind === 'spread' ? gap - 1 : 0 };
}

/** Pay-to-1 of a spread (1…11), with the charm/milestone add-on. */
export function spreadPay(spread: number, pay: Pay = BASE_PAY): number {
  const base = SPREAD_PAY[spread] ?? 0;
  return base > 0 ? base + pay.spreadAdd + (spread === 1 ? pay.spread1Add : 0) : 0;
}

export const inside = (third: CardId, d: Deal): boolean => {
  const r = rankOf(third);
  return r > d.lo && r < d.hi;
};

/** Total returned on a wager (stake included). `third` is required for a pair and for a spread. */
export function grossOf(d: Deal, third: CardId | null, wager: number, pay: Pay = BASE_PAY): number {
  if (d.kind === 'consecutive') return wager;
  if (d.kind === 'pair') {
    if (third !== null && rankOf(third) === d.r1) return wager * (1 + pay.tripsPay);
    return pay.pairWin ? wager * 2 : wager;
  }
  if (third !== null && inside(third, d)) return wager * (1 + spreadPay(d.spread, pay));
  return 0;
}

/** Raise amount for a seat: `full` = bet × raiseMax, `half` = half of that (whole coins, at least 1). */
export function raiseAmount(bet: number, raise: Raise, pay: Pay = BASE_PAY): number {
  if (raise === 'none') return 0;
  const full = Math.max(1, Math.floor(bet * pay.raiseMax));
  return raise === 'full' ? full : Math.max(1, Math.floor(full / 2));
}

/** Only a spread that is big enough is worth raising on (the raise window is skipped on consecutive and pair). */
export const raiseWorthIt = (d: Deal): boolean => d.kind === 'spread' && d.spread >= RAISE_MIN_SPREAD;

// ── one hand ─────────────────────────────────────────────────────────────────────────────────────
export interface Plan {
  deal: Deal;
  /** The third card (null on a consecutive hand, which never draws one). */
  third: CardId | null;
  /** Shared table only: a missed third card refunds the wager instead (luck, p = L/100). */
  refund: boolean;
}

/**
 * Draws the two face-up cards and, unless the hand is consecutive, the third card. A missed spread is luck-checked
 * with p = luck / 100: solo → the third card is redrawn once; shared → the wager is refunded (refund mode).
 */
export function plan(shoe: RdShoe, rng: Rng, solo: boolean, luck = 0): Plan {
  const deal = classify(shoe.draw(), shoe.draw());
  if (deal.kind === 'consecutive') return { deal, third: null, refund: false };
  let third = shoe.draw();
  let refund = false;
  if (deal.kind === 'spread' && !inside(third, deal) && luck > 0 && rng.chance(luck / 100)) {
    if (solo) { shoe.reinsert(third); third = shoe.draw(); } else refund = true;
  }
  return { deal, third, refund };
}

/** Gross back on a wager for a planned hand. */
export function settle(p: Plan, wager: number, pay: Pay = BASE_PAY): number {
  if (p.refund) return wager;
  return grossOf(p.deal, p.third, wager, pay);
}

/** Pay adjustments from the modifier stack. Milestones are features; the charm hooks are numeric or boolean. */
export function payFrom(mod: (hook: ModHook, base: number) => number, feature: (name: string) => boolean): Pay {
  return {
    spreadAdd: mod('m.reddog.spreadPayAdd.spread', 0),
    spread1Add: feature('spread1Pays6') ? 1 : 0,
    tripsPay: TRIPS_PAY + mod('m.reddog.tripsPayAdd', 0) + (feature('trips15') ? 4 : 0),
    pairWin: mod('m.reddog.pairWin', 0) > 0,
    raiseMax: Math.max(1, mod('m.reddog.raiseMax', 1) + (feature('raise2x') ? 1 : 0)),
  };
}

// ── headless (staff auto-play and balance sims) ──────────────────────────────────────────────────
/** Round the gross to whole coins with stochastic rounding (unbiased on average, as in cardwar). */
export const roundCoins = (x: number, rng: Rng): number => Math.floor(x + rng.next());

/**
 * Headless round for staff auto-play: a flat bet on a fresh six-deck shoe, never raising (the economy charges one
 * stake per play and cannot charge a raise). The RTP of that policy is the no-raise figure, see the report.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h: HeadlessHooks) => {
  const shoe = new RdShoe(rng, DECKS);
  const p = plan(shoe, rng, true, h.luck);
  const pay = payFrom((k, b) => h.mod(k, b), () => false);
  return { gross: roundCoins(settle(p, bet, pay), rng) };
};

/**
 * One full simulated hand for the RTP sims: a unit bet, optionally with the optimal full raise on a big spread.
 * Returns the gross and the total wager (stake incl. raise).
 */
export function simRound(shoe: RdShoe, rng: Rng, raise: boolean, pay: Pay = BASE_PAY, luck = 0): { gross: number; stake: number } {
  const p = plan(shoe, rng, true, luck);
  const wantsRaise = raise && raiseWorthIt(p.deal);
  const stake = wantsRaise ? 1 + raiseAmount(1, 'full', pay) : 1;
  return { gross: settle(p, stake, pay), stake };
}
