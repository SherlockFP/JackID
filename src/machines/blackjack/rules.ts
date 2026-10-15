/**
 * Blackjack "Twenty-One" — pure rules (TECH §3.4, MACHINES_tables §3). No three, no DOM, no kit.
 *
 * Shared by the live host (`index.ts`, one call per decision) and the Node RTP sim (`playSimRound`), so the simulated
 * RTP is the live RTP. House rules: 2 decks, cut card at 65 % (68 cards), S17, DAS, late surrender, split to 4 hands
 * (split aces take one card each, no re-split of aces, A+10 after a split = 21 and not a natural), insurance ≤ ½ main
 * at 2:1, even money, dealer peek on Ace or ten, natural pays 3:2, Twin Souls side bet on the first two cards.
 *
 * Money convention: every `*Return` is the total the player gets BACK (stake included). A 1:1 win returns 2× bet.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';
import { bjCardValue, bjTotal, cardId, newShoe, rankOf, isRed, SUITS, type Suit } from '@/machines/_base/cards';

export type Action = 'hit' | 'stand' | 'double' | 'split' | 'surrender';
export const ACTIONS: readonly Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

export const DECKS = 2;
export const PENETRATION = 0.65;
export const MIN_REMAIN = 20;
export const MAX_HANDS = 4;               // up to 3 splits per box
export const DEALER_STAND = 17;
export const BJ_PAY = 1.5;                // 3:2 (base; charms add via bjPayAdd)
export const TWIN_PAY = { mixed: 8, coloured: 15, perfect: 30 } as const;
export const SIDE_LADDER = [1, 5, 10, 25, 50] as const;

/** One hand on a box. */
export interface PHand {
  cards: CardId[];
  bet: number;
  doubled: boolean;
  split: boolean;       // came from a split (A+10 is not a natural)
  aceSplit: boolean;    // split aces: one card only
  stood: boolean;
  surrendered: boolean;
}

export const newHand = (cards: CardId[], bet: number, split = false, aceSplit = false): PHand =>
  ({ cards, bet, doubled: false, split, aceSplit, stood: false, surrendered: false });

export const isTen = (c: CardId): boolean => { const r = rankOf(c); return r >= 10 && r <= 13; };
export const isAce = (c: CardId): boolean => rankOf(c) === 14;
export const sameRank = (a: CardId, b: CardId): boolean => rankOf(a) === rankOf(b);

export const total = (cards: readonly CardId[]): number => bjTotal([...cards]).total;
export const isBust = (h: PHand): boolean => total(h.cards) > 21;
/** Natural: exactly two cards worth 21, not a split hand. */
export const isNatural = (h: PHand): boolean => !h.split && h.cards.length === 2 && total(h.cards) === 21;

/** A hand is finished when no decision can change it. */
export function handDone(h: PHand): boolean {
  if (h.stood || h.surrendered || h.doubled || isBust(h) || isNatural(h)) return true;
  if (h.aceSplit && h.cards.length >= 2) return true;
  return total(h.cards) === 21;
}

export interface LegalCtx {
  /** Hands already on this box (splits used = hands - 1). */
  boxHands: number;
  /** Aces were split on this box (aces may not be re-split). */
  boxAceSplit: boolean;
  /** The bank covers the extra stake of a double / split. */
  canAfford: boolean;
  /** Surrender only on the first decision of the box's only hand. */
  singleHand: boolean;
  /** Charm `blackjack.doubleAny`: double on 3+ cards too. */
  doubleAny?: boolean;
}

/** Actions the player may take now on `h`, in key order (1..5). */
export function legalActions(h: PHand, c: LegalCtx): Action[] {
  if (handDone(h)) return [];
  const out: Action[] = ['hit', 'stand'];
  const first = h.cards.length === 2;
  if (c.canAfford && (first || c.doubleAny)) out.push('double');
  if (c.canAfford && first && sameOrTens(h.cards[0], h.cards[1]) && c.boxHands < MAX_HANDS
      && !(isAce(h.cards[0]) && c.boxAceSplit)) out.push('split');
  if (first && !h.split && c.singleHand) out.push('surrender');
  return out.sort((a, b) => ACTIONS.indexOf(a) - ACTIONS.indexOf(b));
}
// ── decision odds shown on the seat HUD (display only: no effect on the play or the RTP) ──────────────────────────
/**
 * The cards not on the table: a fresh DECKS-deck shoe minus `seen` (every card face up on the felt). This is the estimate a
 * player can make without counting; the live shoe may hold other cards, the odds do not change the deal.
 */
export function unseenCards(seen: readonly CardId[]): CardId[] {
  const left = new Map<CardId, number>();
  for (const s of SUITS) for (let r = 2; r <= 14; r++) left.set(cardId(r, s), DECKS);
  for (const c of seen) { const n = left.get(c) ?? 0; if (n > 0) left.set(c, n - 1); }
  const out: CardId[] = [];
  for (const [c, n] of left) for (let i = 0; i < n; i++) out.push(c);
  return out;
}
/** Chance (0..1) that the next card busts the active `hand`. `seen` = every card on the table, the hand included. */
export function bustChanceOnHit(hand: readonly CardId[], seen: readonly CardId[]): number {
  const pool = unseenCards(seen);
  if (pool.length === 0) return 0;
  let bust = 0;
  for (const c of pool) if (bjTotal([...hand, c]).bust) bust++;
  return bust / pool.length;
}
/** Chance (0..1) that the hidden card under an ace makes a dealer blackjack (a ten-value card). */
export function dealerBjChance(seen: readonly CardId[]): number {
  const pool = unseenCards(seen);
  if (pool.length === 0) return 0;
  return pool.filter((c) => bjCardValue(c) === 10).length / pool.length;
}

/** Equal rank, or any two ten-values (T J Q K). */
export function sameOrTens(a: CardId, b: CardId): boolean {
  return sameRank(a, b) || (isTen(a) && isTen(b));
}

// ── shoe with a cut card and fate draws (a card returned to a random spot) ───────────────────────
export class BjShoe {
  private cards: CardId[] = [];
  private pos = 0;
  private cut = 0;
  constructor(private readonly rng: Rng, private readonly decks = DECKS, private readonly penetration = PENETRATION) {
    this.shuffle();
  }
  get remaining(): number { return this.cards.length - this.pos; }
  get needsShuffle(): boolean { return this.pos >= this.cut || this.remaining < MIN_REMAIN; }
  get dealt(): number { return this.pos; }
  shuffle(): void {
    this.cards = newShoe(this.decks, this.rng);
    this.pos = 0;
    this.cut = Math.ceil(this.cards.length * this.penetration);   // 104 cards → cut after 68
  }
  draw(): CardId {
    if (this.pos >= this.cards.length) this.shuffle();            // safety net; the host respects needsShuffle
    return this.cards[this.pos++];
  }
  /** Fate draw: the card goes back to a random position among the cards not yet dealt. */
  returnRandom(card: CardId, rng: Rng): void {
    const at = this.pos + rng.int(0, this.cards.length - this.pos);
    this.cards.splice(at, 0, card);
  }
  /** Host only (bench / tests): the next cards, top first. */
  peek(n: number): readonly CardId[] { return this.cards.slice(this.pos, this.pos + n); }
}

/** Dealer draws to 17 and stands on every 17 (S17). Returns the drawn cards (may be empty). */
export function dealerDraws(dealer: readonly CardId[], shoe: BjShoe): CardId[] {
  const hand = [...dealer];
  const out: CardId[] = [];
  while (total(hand) < DEALER_STAND) { const c = shoe.draw(); hand.push(c); out.push(c); }
  return out;
}

/** Fate draw (luck): a card that busts the player goes back with probability `luck`% and the next card is dealt. */
export function luckyDraw(shoe: BjShoe, hand: readonly CardId[], luck: number, rng: Rng): { card: CardId; lucky: boolean } {
  const card = shoe.draw();
  if (luck > 0 && total([...hand, card]) > 21 && rng.next() < luck / 100) {
    shoe.returnRandom(card, rng);
    return { card: shoe.draw(), lucky: true };
  }
  return { card, lucky: false };
}

export type HandResult = 'win' | 'bj' | 'push' | 'loss' | 'bust' | 'surr';

/** Return of one hand against the dealer's final cards. `dealerBJ` = dealer natural (already peeked). */
export function settleHand(h: PHand, dealer: readonly CardId[], dealerBJ: boolean, bjPay = BJ_PAY): { ret: number; result: HandResult } {
  if (h.surrendered) return { ret: h.bet / 2, result: 'surr' };
  if (isBust(h)) return { ret: 0, result: 'bust' };
  if (isNatural(h)) return dealerBJ ? { ret: h.bet, result: 'push' } : { ret: h.bet * (1 + bjPay), result: 'bj' };
  if (dealerBJ) return { ret: 0, result: 'loss' };
  const pt = total(h.cards), dt = total(dealer);
  if (dt > 21 || pt > dt) return { ret: h.bet * 2, result: 'win' };
  if (pt === dt) return { ret: h.bet, result: 'push' };
  return { ret: 0, result: 'loss' };
}

/** Insurance pays 2:1 on a dealer natural. Returns the total back (stake included). */
export const insuranceReturn = (amount: number, dealerBJ: boolean): number => (dealerBJ ? amount * 3 : 0);
/** Even money: 1:1 on the player's natural, paid at once whatever the dealer holds. Returns the total back. */
export const evenMoneyReturn = (main: number): number => main * 2;
/** Insurance costs at most half the main bet (rounded down). */
export const insuranceMax = (main: number): number => Math.floor(main / 2);

/**
 * Twin Souls on the first two cards of a box: same rank and suit 30:1 · same rank and colour 15:1 · same rank,
 * other colour 8:1. Returns the total back for the side stake.
 */
export function twinReturn(side: number, a: CardId, b: CardId): { ret: number; kind: 'none' | 'mixed' | 'coloured' | 'perfect' } {
  if (side <= 0 || !sameRank(a, b)) return { ret: 0, kind: 'none' };
  if (a[1] === b[1]) return { ret: side * (TWIN_PAY.perfect + 1), kind: 'perfect' };
  if (isRed(a) === isRed(b)) return { ret: side * (TWIN_PAY.coloured + 1), kind: 'coloured' };
  return { ret: side * (TWIN_PAY.mixed + 1), kind: 'mixed' };
}

/** Dealer up-card value for the strategy table: ace = 11, faces = 10. */
const upValue = (c: CardId): number => (isAce(c) ? 11 : Math.min(rankOf(c), 10));

/** Basic strategy (2 decks, S17, DAS, LS). The action a reasonable player takes; used by bots and the sim. */
export function basicAction(h: PHand, dealerUp: CardId, c: LegalCtx): Action {
  const legal = legalActions(h, c);
  const has = (a: Action): boolean => legal.includes(a);
  const up = upValue(dealerUp);
  const cards = h.cards;
  const t = total(cards);
  const twoCards = cards.length === 2;
  if (twoCards && sameRank(cards[0], cards[1]) && has('split')) {
    const r = rankOf(cards[0]);
    const split = r === 14 || r === 8
      || (r === 9 && up !== 7 && up !== 10 && up !== 11)
      || ((r === 7 || r === 3 || r === 2) && up <= 7)
      || (r === 6 && up >= 2 && up <= 6)
      || (r === 4 && (up === 5 || up === 6));
    if (split) return 'split';
  }
  const soft = bjTotal([...cards]).soft;
  if (soft) {
    if (t >= 19) return 'stand';
    if (t === 18) {
      if (up <= 6 && twoCards && has('double')) return 'double';
      return up >= 9 ? 'hit' : 'stand';
    }
    if (twoCards && up >= 4 && up <= 6 && has('double')) return 'double';
    return 'hit';
  }
  if (twoCards && t === 11 && has('double')) return 'double';
  if (twoCards && t === 10 && has('double') && up <= 9) return 'double';
  if (twoCards && t === 9 && has('double') && up >= 3 && up <= 6) return 'double';
  if (has('surrender')) {
    if (t === 16 && (up >= 9)) return 'surrender';
    if (t === 15 && up === 10) return 'surrender';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return up <= 6 ? 'stand' : 'hit';
  if (t === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  return 'hit';
}

// ── headless round (RTP sim, staff auto-play): one box, basic strategy, insurance never taken ────
/** `flat`: one unit, hit or stand only (no double, split or surrender) — the headless staff round. */
export interface SimOpts { luck?: number; side?: number; flat?: boolean }
export interface SimRound { main: number; side: number; stakeMain: number; stakeSide: number; natural: boolean; dealerBJ: boolean; hands: number }

/** Plays one complete round for a single player with basic strategy. The main stake is 1 unit (+ `side`). */
export function playSimRound(shoe: BjShoe, rng: Rng, o: SimOpts = {}): SimRound {
  if (shoe.needsShuffle) shoe.shuffle();
  const luck = o.luck ?? 0, side = o.side ?? 0, flat = o.flat ?? false;
  const p0 = shoe.draw(), p1 = shoe.draw();
  const up = shoe.draw();
  let hole = shoe.draw();
  const dealer: CardId[] = [up, hole];
  const twin = twinReturn(side, p0, p1);
  let dealerBJ = (isAce(up) || isTen(up)) && total(dealer) === 21;
  if (dealerBJ && luck > 0 && !(total([p0, p1]) === 21) && rng.next() < luck / 100) {
    shoe.returnRandom(hole, rng);            // fate draw (b): the natural goes back, the next card is the hole card
    hole = shoe.draw();
    dealer[1] = hole;
    dealerBJ = total(dealer) === 21;
  }
  const hands: PHand[] = [newHand([p0, p1], 1)];
  if (!dealerBJ) {
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      let guard = 0;
      while (!handDone(h) && guard++ < 24) {
        const ctx: LegalCtx = { boxHands: hands.length, boxAceSplit: hands.some((x) => x.aceSplit), canAfford: !flat, singleHand: !flat && hands.length === 1 };
        const a = basicAction(h, up, ctx);
        if (a === 'hit') h.cards.push(luckyDraw(shoe, h.cards, luck, rng).card);
        else if (a === 'stand') h.stood = true;
        else if (a === 'double') { h.bet *= 2; h.doubled = true; h.cards.push(luckyDraw(shoe, h.cards, luck, rng).card); }
        else if (a === 'surrender') h.surrendered = true;
        else if (a === 'split') {
          const aces = isAce(h.cards[0]);
          const second = h.cards.pop()!;
          h.split = true; h.aceSplit = aces;
          h.cards.push(shoe.draw());
          const nh = newHand([second, shoe.draw()], h.bet, true, aces);
          hands.push(nh);
        }
      }
    }
  }
  const anyLive = hands.some((h) => !h.surrendered && !isBust(h));
  if (!dealerBJ && anyLive) dealer.push(...dealerDraws(dealer, shoe));
  let main = 0, stakeMain = 0;
  for (const h of hands) { main += settleHand(h, dealer, dealerBJ).ret; stakeMain += h.bet; }
  return { main, side: twin.ret, stakeMain, stakeSide: side, natural: isNatural(hands[0]), dealerBJ, hands: hands.length };
}

/** Headless single round for staff auto-play and the bench "Sim" button: one box, basic strategy, main stake only. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = playSimRound(new BjShoe(rng), rng, { luck: h.luck, flat: true });
  // flat one-unit round: the return scales straight to `bet`; stochastic rounding keeps whole coins unbiased
  return { gross: Math.floor(r.main * bet + rng.next()), tags: r.dealerBJ ? ['lucky'] : [] };
};
