/**
 * Three Card Poker "Üç Kart Poker" — pure rules (MACHINES_tables §16). No three, no DOM, no kit.
 *
 * Shared by the live host (`index.ts`, one settle per round) and the Node RTP sim (`playHeadless`, `playSimRound`), so
 * the simulated RTP is the live RTP. Hands: three cards, A-2-3 is a straight, the top straight is A-K-Q. Order (low →
 * high): high card < pair < flush < straight < three of a kind < straight flush.
 *
 * Money convention (as blackjack): every `*Return` is what the seat gets BACK, stake included. A 1:1 win returns 2× stake.
 * Ante Bonus is a pure win (no stake returned); Pair Plus returns its stake plus the pay.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';
import { rankOf, suitOf, newDeck } from '@/machines/_base/cards';

export type Cat = 'high' | 'pair' | 'flush' | 'straight' | 'trips' | 'sf';
/** Per-seat result: `nq` = dealer did not qualify (ante 1:1, play pushes), `fold` = the seat folded its Ante. */
export type Outcome = 'win' | 'lose' | 'push' | 'nq' | 'fold' | 'none';

export const CAT_ORDER: Record<Cat, number> = { high: 0, pair: 1, flush: 2, straight: 3, trips: 4, sf: 5 };
/** Ante Bonus (paid when the seat played, regardless of the dealer): multiplier of the ante. */
export const ANTE_BONUS: Partial<Record<Cat, number>> = { straight: 1, trips: 4, sf: 5 };
/** Pair Plus (paid on the seat's own hand, regardless of the dealer): multiplier of the Pair Plus stake. */
export const PAIR_PLUS: Record<Cat, number> = { high: 0, pair: 1, flush: 3, straight: 6, trips: 30, sf: 40 };
export const MINI_ROYAL_PAY = 100;           // suited A-K-Q on Pair Plus (charm `m.threecard.miniRoyal`)
export const QUALIFY_RANK = 12;              // dealer needs Q-high or better
export const ANTE_LADDER: readonly number[] = [5, 10, 25, 50, 100, 200];
export const PP_LADDER: readonly number[] = [0, 1, 5, 10, 25, 50, 100];
export const CARDS_PER_HAND = 3;

export interface HandEval {
  cat: Cat;
  /** Comparable across hands: higher wins. */
  score: number;
  /** Highest card (the top of a straight for straights). */
  top: number;
  suited: boolean;
}

const BASE = 15;

/** Evaluates a three-card hand. Cards are atlas ids (`'AS'`, `'TH'`). */
export function evalHand(cards: readonly CardId[]): HandEval {
  const r = cards.map(rankOf).sort((a, b) => b - a);
  const suited = suitOf(cards[0]) === suitOf(cards[1]) && suitOf(cards[1]) === suitOf(cards[2]);
  const wheel = r[0] === 14 && r[1] === 3 && r[2] === 2;                 // A-2-3
  const straight = wheel || (r[0] - r[2] === 2 && r[0] !== r[1] && r[1] !== r[2]);
  const sHigh = wheel ? 3 : r[0];
  let cat: Cat;
  let v: [number, number, number];
  if (straight && suited) { cat = 'sf'; v = [sHigh, 0, 0]; }
  else if (r[0] === r[2]) { cat = 'trips'; v = [r[0], 0, 0]; }
  else if (straight) { cat = 'straight'; v = [sHigh, 0, 0]; }
  else if (suited) { cat = 'flush'; v = [r[0], r[1], r[2]]; }
  else if (r[0] === r[1] || r[1] === r[2]) {
    const pairRank = r[0] === r[1] ? r[0] : r[1];
    const kicker = r[0] === r[1] ? r[2] : r[0];
    cat = 'pair'; v = [pairRank, kicker, 0];
  } else { cat = 'high'; v = [r[0], r[1], r[2]]; }
  const score = CAT_ORDER[cat] * BASE * BASE * BASE + v[0] * BASE * BASE + v[1] * BASE + v[2];
  return { cat, score, top: v[0], suited };
}

/** Dealer qualifies with Q-high or better (any pair, flush or straight qualifies outright). */
export const qualifies = (h: HandEval): boolean => h.cat !== 'high' || h.top >= QUALIFY_RANK;

/** Suited A-K-Q: the mini-royal (Pair Plus charm). */
export function isMiniRoyal(cards: readonly CardId[]): boolean {
  const r = cards.map(rankOf);
  return evalHand(cards).cat === 'sf' && r.includes(14) && r.includes(13) && r.includes(12);
}

/** Basic strategy: play with Q-6-4 or better (the reference strategy behind the published RTP). */
const Q64 = evalHand(['QS', '6H', '4D'] as CardId[]).score; // i18n-ok: atlas ids
export const basicPlay = (cards: readonly CardId[]): boolean => evalHand(cards).score >= Q64;

export interface SeatRound {
  ante: number;                 // 0 = Pair Plus only
  pp: number;                   // 0 = no Pair Plus
  played: boolean;              // Play bet (= ante) was placed
  hand: CardId[];
}
export interface SeatOpts { bonusMult?: number; ppAdd?: number; miniRoyal?: boolean }
export interface SeatPaid {
  ante: number; play: number; bonus: number; pairPlus: number;
  out: Outcome;                 // per seat, for the UI and the juice tier
  ret: number;                  // total back (the four components)
  stake: number;                // ante + play + Pair Plus, what the seat put on the table
  tags: string[];
}

/** Settles one seat against the dealer hand. Pure; the host pays the total in one `paySeat`. */
export function settleSeat(s: SeatRound, dealer: HandEval, dq: boolean, o: SeatOpts = {}): SeatPaid {
  const h = evalHand(s.hand);
  const A = s.ante;
  let ante = 0, play = 0, bonus = 0, pairPlus = 0, out: Outcome = 'none';
  if (A > 0) {
    if (!s.played) out = 'fold';                     // Fold loses the Ante; Pair Plus still settles below
    else if (!dq) { ante = 2 * A; play = A; out = 'nq'; }
    else if (h.score > dealer.score) { ante = 2 * A; play = 2 * A; out = 'win'; }
    else if (h.score === dealer.score) { ante = A; play = A; out = 'push'; }
    else out = 'lose';
  }
  if (s.played && A > 0) {
    const m = ANTE_BONUS[h.cat] ?? 0;
    if (m > 0) bonus = Math.floor(A * m * (o.bonusMult ?? 1));
  }
  if (s.pp > 0) {
    let m = PAIR_PLUS[h.cat];
    if (m > 0) m += o.ppAdd ?? 0;
    if (o.miniRoyal && isMiniRoyal(s.hand)) m = MINI_ROYAL_PAY;
    if (m > 0) pairPlus = s.pp * (m + 1);
  }
  const tags: string[] = [];
  if (bonus > 0) tags.push('bonus');
  if (h.cat === 'sf') tags.push('sf');
  if (h.cat === 'trips') tags.push('trips');
  return {
    ante, play, bonus, pairPlus, out, tags,
    ret: ante + play + bonus + pairPlus,
    stake: A + (s.played && A > 0 ? A : 0) + s.pp,
  };
}

/** Solo fate draw: the dealer's three cards come again from the 49 cards outside the player's hand(s). */
export function fateDealer(players: readonly (readonly CardId[])[], rng: Rng): CardId[] {
  const used = new Set<string>(players.flat());
  const pool = newDeck().filter((c) => !used.has(c));
  return rng.shuffle(pool).slice(0, CARDS_PER_HAND);
}

// ── RTP sim (Node) and headless round ─────────────────────────────────────────────────────────
export interface SimRoundResult {
  anteStake: number; anteRet: number; playStake: number; playRet: number;
  ppStake: number; ppRet: number; bonusRet: number; played: boolean; dealerQ: boolean;
}

/**
 * One complete round for one seat: unit ante, optional fixed Pair Plus stake, basic strategy, and the solo fate draw at
 * `luck` percent (dealer redraw when the seat's net is negative). Returns the components for per-ante / per-total RTP.
 */
export function playSimRound(rng: Rng, o: { ante?: number; pp?: number; luck?: number } = {}): SimRoundResult {
  const A = o.ante ?? 1, pp = o.pp ?? 0, luck = o.luck ?? 0;
  const deck = rng.shuffle(newDeck());
  const player = deck.slice(0, CARDS_PER_HAND) as CardId[];
  let dealer = deck.slice(CARDS_PER_HAND, CARDS_PER_HAND * 2) as CardId[];
  const played = basicPlay(player);
  const seat: SeatRound = { ante: A, pp, played, hand: player };
  let dq = qualifies(evalHand(dealer));
  let s = settleSeat(seat, evalHand(dealer), dq);
  if (luck > 0 && s.ret < s.stake && rng.next() < luck / 100) {
    dealer = fateDealer([player], rng);
    dq = qualifies(evalHand(dealer));
    s = settleSeat(seat, evalHand(dealer), dq);
  }
  return {
    anteStake: A, anteRet: s.ante, playStake: played ? A : 0, playRet: s.play, ppStake: pp, ppRet: s.pairPlus,
    bonusRet: s.bonus, played, dealerQ: dq,
  };
}

/** Basic-strategy Play frequency (1e6-round sim, `scripts` scratch sim). Expected total wager per unit ante = 1 + this. */
export const PLAY_RATE = 0.6743;

/**
 * Headless round for staff auto-play and the bench: `bet` is the ante, basic strategy, no Pair Plus. Gross is everything
 * returned on the round (ante, play, bonus). The live table charges ante + play, so the gross is scaled by the expected
 * total wager per ante: E[gross] / bet = RTP per total wager (≈ 98.05 %, the live economics).
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = playSimRound(rng, { ante: 1, luck: h.luck });
  const gross = (r.anteRet + r.playRet + r.bonusRet) * bet / (1 + PLAY_RATE);
  return { gross: Math.floor(gross + rng.next()), tags: r.bonusRet > 0 ? ['bonus'] : [] };
};
