/**
 * Baccarat "The Mirror Table" (Punto Banco) — pure rules (MACHINES_tables §6). No three, no DOM, no kit.
 *
 * Shared by the live host (`index.ts`, one call per coup) and the Node RTP sim, so the simulated RTP is the live RTP.
 * Eight decks, the first card is shown and burned with its point count (ten/face = 10), cut card 14 cards from the
 * end: the coup in progress is the last of the shoe. Natural 8/9 stands both hands; the tableau is in `_base/cards.ts`.
 *
 * Money convention: `spotReturn` gives the total the player gets BACK (stake included), exactly as blackjack does.
 * Commission is 5 % of the Banker's winnings (98.94 % RTP); the milestone and charm hooks are passed in `PayOpts`.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';
import {
  baccaratBankerDraws, baccaratCardValue, baccaratPlayerDraws, baccaratValue, newShoe, rankOf,
} from '@/machines/_base/cards';

export const DECKS = 8;
export const CUT_LEFT = 14;                 // cards left in the shoe when the coup in progress is the last one
export const COMMISSION = 0.05;             // on the Banker's winnings
export const TABLE_MAX = 3000;              // total stake one seat may put down per coup

/** Spot indices (the order of `bets[seat][spot]` everywhere). */
export const SP = { B: 0, P: 1, T: 2, PP: 3, BP: 4 } as const;
export const SPOT_COUNT = 5;
export const SPOT_NAMES = ['banker', 'player', 'tie', 'ppair', 'bpair'] as const;
/** Per-spot limits (Player/Banker 10–1,000; Tie and pairs 1–100), before the stake multipliers. */
export const LIMITS: ReadonlyArray<{ min: number; max: number }> = [
  { min: 10, max: 1000 }, { min: 10, max: 1000 }, { min: 1, max: 100 }, { min: 1, max: 100 }, { min: 1, max: 100 },
];

export type Winner = 'P' | 'B' | 'T';
export interface Coup { p: CardId[]; b: CardId[] }
export interface Outcome {
  p: CardId[]; b: CardId[];
  pt: number; bt: number;           // totals 0..9
  winner: Winner;
  pairP: boolean; pairB: boolean;   // first two cards of a side share a rank
  pNat: boolean; bNat: boolean;     // first two cards total 8 or 9
  natural: boolean;
}

/** Burn count of a shown card: ace 1, 2–9 face value, ten and face cards 10. */
export function burnCount(c: CardId): number {
  const r = rankOf(c);
  return r === 14 ? 1 : r >= 10 ? 10 : r;
}

/** Eight-deck shoe with the opening shown card, its burn and the cut card. */
export class BacShoe {
  private cards: CardId[] = [];
  private pos = 0;
  /** The face-up first card of this shoe (for display). */
  shown: CardId | null = null;
  /** Number of shoes started (0 before the first `reshuffle`). */
  shoes = 0;

  constructor(private readonly rng: Rng) { this.reshuffle(); }

  get remaining(): number { return this.cards.length - this.pos; }
  /** True once the coup just dealt was the last one of the shoe (shuffle before the next OPEN). */
  get atCut(): boolean { return this.remaining <= CUT_LEFT; }

  reshuffle(): void {
    this.cards = newShoe(DECKS, this.rng);
    this.pos = 0;
    this.shown = this.cards[this.pos++];
    for (let n = burnCount(this.shown); n > 0; n--) this.pos++;
    this.shoes++;
  }
  /** Next card. Reshuffles only as a safety net (the cut card makes this unreachable inside a coup). */
  draw(): CardId {
    if (this.remaining <= 0) this.reshuffle();
    return this.cards[this.pos++];
  }
  /** The next card that `draw()` would return (host-only; used for the Mirror peek charge). */
  top(): CardId | null { return this.remaining > 0 ? this.cards[this.pos] : null; }
  /** Put cards back at random positions in the remaining shoe (the invisible luck reroll). */
  reinsert(cards: readonly CardId[]): void {
    for (const c of cards) {
      const at = this.pos + this.rng.int(0, this.remaining);
      this.cards.splice(at, 0, c);
    }
  }
}

/** Deals one coup in the casino order P, B, P, B, then the third cards by the tableau. */
export function drawCoup(shoe: BacShoe): Coup {
  const p: CardId[] = [shoe.draw()];
  const b: CardId[] = [shoe.draw()];
  p.push(shoe.draw());
  b.push(shoe.draw());
  const pt = baccaratValue(p), bt = baccaratValue(b);
  if (pt >= 8 || bt >= 8) return { p, b };                         // natural: both stand
  if (baccaratPlayerDraws(pt, bt)) p.push(shoe.draw());
  const third = p.length === 3 ? baccaratCardValue(p[2]) : null;
  if (baccaratBankerDraws(bt, third)) b.push(shoe.draw());
  return { p, b };
}

export function outcomeOf(c: Coup): Outcome {
  const pt = baccaratValue(c.p), bt = baccaratValue(c.b);
  const winner: Winner = pt > bt ? 'P' : bt > pt ? 'B' : 'T';
  const pNat = baccaratValue(c.p.slice(0, 2)) >= 8, bNat = baccaratValue(c.b.slice(0, 2)) >= 8;
  return {
    p: c.p, b: c.b, pt, bt, winner,
    pairP: rankOf(c.p[0]) === rankOf(c.p[1]), pairB: rankOf(c.b[0]) === rankOf(c.b[1]),
    pNat, bNat, natural: pNat || bNat,
  };
}

/** Milestone and charm pay hooks (`m.baccarat.*`, `x.table.rakeDelta`, the `lucky6` / `tie9` features). */
export interface PayOpts {
  commission: number;       // default 0.05; the Dealer's Button and L25 reduce it
  naturalBonus: number;     // extra winnings (× stake) on a winning P/B bet when the coup had a natural
  tiePayAdd: number;        // added to the Tie multiplier (8 → 8 + x)
  pairPayAdd: number;       // added to the pair multiplier (11 → 11 + x)
  tieSweetener: boolean;    // a Tie returns 110 % of the P/B stake instead of a plain push
  lucky6: boolean;          // L50: a Banker win on 6 pays 1:1 without commission
  tie9: boolean;            // L100: Tie pays 9:1
}
export const BASE_PAY: PayOpts = {
  commission: COMMISSION, naturalBonus: 0, tiePayAdd: 0, pairPayAdd: 0, tieSweetener: false, lucky6: false, tie9: false,
};

/** Gross return (stake included, exact, unrounded) of one spot for an outcome; 0 on a loss. */
export function spotReturn(spot: number, bet: number, o: Outcome, pay: PayOpts = BASE_PAY): number {
  if (!(bet > 0)) return 0;
  switch (spot) {
    case SP.B: {
      if (o.winner === 'T') return pay.tieSweetener ? bet * 1.1 : bet;
      if (o.winner !== 'B') return 0;
      const c = pay.lucky6 && o.bt === 6 ? 0 : pay.commission;
      const bonus = o.natural ? pay.naturalBonus : 0;
      return bet + bet * (1 - c) + bet * bonus;
    }
    case SP.P: {
      if (o.winner === 'T') return pay.tieSweetener ? bet * 1.1 : bet;
      if (o.winner !== 'P') return 0;
      return bet * 2 + (o.natural ? bet * pay.naturalBonus : 0);
    }
    case SP.T:
      return o.winner === 'T' ? bet * (1 + (pay.tie9 ? 9 : 8) + pay.tiePayAdd) : 0;
    case SP.PP:
      return o.pairP ? bet * (1 + 11 + pay.pairPayAdd) : 0;
    case SP.BP:
      return o.pairB ? bet * (1 + 11 + pay.pairPayAdd) : 0;
    default:
      return 0;
  }
}

/** Commission chips taken from one spot's payout (5 % of the Banker's winnings; 0 for everything else). */
export function commissionOf(spot: number, bet: number, o: Outcome, pay: PayOpts = BASE_PAY): number {
  if (spot !== SP.B || o.winner !== 'B' || (pay.lucky6 && o.bt === 6)) return 0;
  return bet * pay.commission;
}

/** Stochastic rounding to whole coins: unbiased on average (the same trick as blackjack's headless round). */
export const roundCoins = (x: number, rng: Rng): number => Math.floor(x + rng.next());

/** Stake validation: each spot within its limits (or zero) and the seat total within `TABLE_MAX`. */
export function validBets(bets: readonly number[], mult = 1): boolean {
  if (bets.length !== SPOT_COUNT) return false;
  let total = 0;
  for (let s = 0; s < SPOT_COUNT; s++) {
    const v = bets[s];
    if (!Number.isInteger(v) || v < 0) return false;
    if (v === 0) continue;
    if (v < LIMITS[s].min * mult || v > LIMITS[s].max * mult) return false;
    total += v;
  }
  return total <= TABLE_MAX;
}

/** Who squeezes a side: the largest bettor on that side's stake (ties → lower seat); −1 when nobody backed it. */
export function squeezerFor(side: 'P' | 'B', bets: readonly (readonly number[])[]): number {
  const spot = side === 'P' ? SP.P : SP.B;
  let best = -1, amount = 0;
  bets.forEach((b, seat) => {
    if (b[spot] > amount) { amount = b[spot]; best = seat; }
  });
  return best;
}

export interface PrepareOpts {
  /** Solo luck in percent: a coup that loses every backed bet is reinserted and dealt again with p = luck/100. */
  luck?: number;
  /** Spots with a stake on this coup. */
  backed?: readonly number[];
}

/** Draws the next coup. Applies the luck reroll before anything is shown, so the reinsertion stays invisible. */
export function prepareCoup(shoe: BacShoe, rng: Rng, o: PrepareOpts = {}): { coup: Coup; out: Outcome; rerolled: boolean } {
  let coup = drawCoup(shoe);
  let out = outcomeOf(coup);
  let rerolled = false;
  const luck = o.luck ?? 0, backed = o.backed ?? [];
  if (luck > 0 && backed.length > 0 && backed.every((s) => spotReturn(s, 1, out) === 0) && rng.next() * 100 < luck) {
    shoe.reinsert([...coup.p, ...coup.b]);
    coup = drawCoup(shoe);
    out = outcomeOf(coup);
    rerolled = true;
  }
  return { coup, out, rerolled };
}

/** One coup with a unit stake on every spot (sim helper): returns the gross return per spot. */
export function playSimCoup(shoe: BacShoe, rng: Rng, o: PrepareOpts & { pay?: PayOpts; stakes?: readonly number[] } = {}): {
  ret: number[]; stake: number[]; out: Outcome;
} {
  const stakes = o.stakes ?? [1, 1, 1, 1, 1];
  const backed = o.backed ?? stakes.map((v, s) => (v > 0 ? s : -1)).filter((s) => s >= 0);
  const { out } = prepareCoup(shoe, rng, { luck: o.luck, backed });
  const ret = stakes.map((bet, s) => spotReturn(s, bet, out, o.pay ?? BASE_PAY));
  return { ret, stake: [...stakes], out };
}

/**
 * Headless round for staff auto-play and the balance sims: a flat Banker unit on a fresh shoe, luck from the instance.
 * Gross is rounded to whole coins with stochastic rounding, so small bets stay unbiased.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const shoe = new BacShoe(rng);
  const { out } = prepareCoup(shoe, rng, { luck: h.luck, backed: [SP.B] });
  const commission = Math.max(0, COMMISSION + h.mod('x.table.rakeDelta', 0));
  const gross = roundCoins(spotReturn(SP.B, bet, out, { ...BASE_PAY, commission }), rng);
  return { gross, tags: out.natural ? ['natural'] : [] };
};
