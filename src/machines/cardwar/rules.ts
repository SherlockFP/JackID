/**
 * War Table (`cardwar`) — pure rules (MACHINES_tables §10). No three, no DOM, no kit.
 *
 * Two rule-sets share one table: `war` (Casino War, 6 decks, A high, seats 0–5) and `dragontiger` (8 decks, A low,
 * K high, all 8 seats). The live host (`index.ts`) and the Node RTP sim both call these functions, so the simulated
 * RTP is the live RTP. Money convention: every `*Gross` returns the total the seat gets BACK (stake included), exactly
 * as baccarat does; the raise of a war is a second stake that the host charges with `chargeSeat`.
 *
 * Spots (`bets[seat][spot]`, 12 per seat for both variants):
 *  - War:          0 MAIN (5–500), 1 TIE side (1–50). Tie side pays 10:1.
 *  - Dragon-Tiger: 0 DRAGON, 1 TIGER (5–500), 2 TIE 11:1, 3 SUITED TIE 50:1, 4–7 Dragon Big/Small/Odd/Even,
 *                  8–11 Tiger Big/Small/Odd/Even (1–50, 1:1, a 7 loses both pairs).
 *
 * Luck (solo only, the host passes `luck` only when one human sits): a round that loses every backed main bet is
 * reinserted and dealt again with p = luck / 100, before anything is shown. Shared tables never reroll.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';
import { newShoe, rankOf } from '@/machines/_base/cards';

export const SEATS = 8;
export const WAR_SEATS = 6;                 // War uses seats 0–5 only
export const WAR_DECKS = 6;
export const DT_DECKS = 8;
export const CUT = 0.8;                     // penetration: the cut card sits at 80 % of the shoe
export const SPOT_COUNT = 12;
export const TABLE_MAX = 2000;              // total stake one seat may put down per round (all spots)
export const WAR_BURN = 3;

export type Variant = 'war' | 'dragontiger';
export type WarRes = 'win' | 'lose' | 'tie';
export type WarChoice = 'war' | 'surrender';
export type DtWinner = 'D' | 'T' | 'TIE'; // i18n-ok: outcome code, never shown

/** Spot indices, per variant (see the header). */
export const WAR_SPOT = { MAIN: 0, TIE: 1 } as const;
export const DT_SPOT = {
  DRAGON: 0, TIGER: 1, TIE: 2, SUITED: 3,
  D_BIG: 4, D_SMALL: 5, D_ODD: 6, D_EVEN: 7,
  T_BIG: 8, T_SMALL: 9, T_ODD: 10, T_EVEN: 11,
} as const;

/** Stake limits per spot, before the stake multipliers (`× SI × Cap`). Spots without a limit are not bettable. */
export function limitOf(variant: Variant, spot: number): { min: number; max: number } | null {
  if (variant === 'war') {
    if (spot === WAR_SPOT.MAIN) return { min: 5, max: 500 };
    if (spot === WAR_SPOT.TIE) return { min: 1, max: 50 };
    return null;
  }
  if (spot === DT_SPOT.DRAGON || spot === DT_SPOT.TIGER) return { min: 5, max: 500 };
  if (spot >= 0 && spot < SPOT_COUNT) return { min: 1, max: 50 };
  return null;
}
/** Bettable spots of a variant, in display order. */
export const spotsOf = (variant: Variant): number[] =>
  variant === 'war' ? [WAR_SPOT.MAIN, WAR_SPOT.TIE] : Array.from({ length: SPOT_COUNT }, (_, i) => i);

// ── cards ────────────────────────────────────────────────────────────────────────────────────────
/** War rank: 2–14, ace high. */
export const warRank = (c: CardId): number => rankOf(c);
/** Dragon-Tiger rank: ace 1 … king 13. */
export const dtRank = (c: CardId): number => { const r = rankOf(c); return r === 14 ? 1 : r; };
/** Dragon-Tiger side-bet predicates. A 7 is neither big nor small and counts as odd, so it loses both pairs. */
export const dtBig = (c: CardId): boolean => dtRank(c) >= 8;
export const dtSmall = (c: CardId): boolean => dtRank(c) <= 6;
export const dtOdd = (c: CardId): boolean => dtRank(c) !== 7 && dtRank(c) % 2 === 1;
export const dtEven = (c: CardId): boolean => dtRank(c) % 2 === 0;

/** Shoe of `decks` packs with a cut card at 80 %. Burned cards leave the shoe; `reinsert` is the invisible luck reroll. */
export class CwShoe {
  private cards: CardId[] = [];
  private pos = 0;
  /** Number of shoes started (1 after the constructor). */
  shoes = 0;

  constructor(private readonly rng: Rng, readonly decks: number) { this.reshuffle(); }

  get remaining(): number { return this.cards.length - this.pos; }
  /** True once the round just dealt crossed the cut card (reshuffle before the next OPEN). */
  get atCut(): boolean { return this.pos >= Math.floor(this.cards.length * CUT); }

  reshuffle(): void {
    this.cards = newShoe(this.decks, this.rng);
    this.pos = 0;
    this.shoes++;
  }
  /** Next card. Reshuffles only as a safety net (the cut card makes this unreachable inside a round). */
  draw(): CardId {
    if (this.remaining <= 0) this.reshuffle();
    return this.cards[this.pos++];
  }
  burn(n: number): CardId[] { const out: CardId[] = []; for (let i = 0; i < n; i++) out.push(this.draw()); return out; }
  /** The card `k` places ahead of the next draw (0 = next). Host-only; used for the peek charms. */
  peek(k = 0): CardId | null { return this.pos + k < this.cards.length ? this.cards[this.pos + k] : null; }
  /** Put cards back at random positions in the remaining shoe. */
  reinsert(cards: readonly CardId[]): void {
    for (const c of cards) {
      const at = this.pos + this.rng.int(0, this.remaining);
      this.cards.splice(at, 0, c);
    }
  }
}

// ── War ──────────────────────────────────────────────────────────────────────────────────────────
export interface WarDeal {
  /** One card per backed seat (null = no bet on this seat). */
  seats: (CardId | null)[];
  dealer: CardId;
  /** Per seat: null without a bet, else the comparison result. */
  res: (WarRes | null)[];
}

export function warCompare(seatCard: CardId, dealer: CardId): WarRes {
  const a = warRank(seatCard), b = warRank(dealer);
  return a > b ? 'win' : a < b ? 'lose' : 'tie';
}

function dealWarOnce(shoe: CwShoe, backed: readonly number[]): WarDeal {
  const seats: (CardId | null)[] = Array.from({ length: SEATS }, (): CardId | null => null);
  for (const s of backed) seats[s] = shoe.draw();
  const dealer = shoe.draw();
  const res = seats.map((c) => (c ? warCompare(c, dealer) : null));
  return { seats, dealer, res };
}

/**
 * Deals one card per backed seat and one to the dealer. Solo luck: when every backed seat loses, the round is
 * reinserted and dealt again with p = luck / 100 (once).
 */
export function dealWar(shoe: CwShoe, rng: Rng, backed: readonly number[], luck = 0): WarDeal {
  const d = dealWarOnce(shoe, backed);
  const allLose = backed.length > 0 && backed.every((s) => d.res[s] === 'lose');
  if (luck > 0 && allLose && rng.next() * 100 < luck) {
    const back: CardId[] = [d.dealer];
    for (const s of backed) back.push(d.seats[s]!);
    shoe.reinsert(back);
    return dealWarOnce(shoe, backed);
  }
  return d;
}

/**
 * The war draw: burn 3, then per warring seat one player card and one dealer card (in seat order).
 * `win` = the player card is at least the dealer card (ties in the war go to the player).
 */
export function warBattle(shoe: CwShoe, seats: readonly number[]): { burn: CardId[]; rows: Array<{ seat: number; p: CardId; d: CardId; win: boolean }> } {
  const burn = shoe.burn(WAR_BURN);
  const rows = seats.map((seat) => {
    const p = shoe.draw();
    const d = shoe.draw();
    return { seat, p, d, win: warRank(p) >= warRank(d) };
  });
  return { burn, rows };
}

export interface WarPay {
  warBonus: boolean;        // L10 / charm: winning a war also pays the original 1:1
  surrender: number;        // share of the main stake returned on surrender (0.5 + surrenderRefundAdd, L50 0.6)
  tieAdd: number;           // added to the War tie multiplier (10 + x)
}
export const WAR_BASE_PAY: WarPay = { warBonus: false, surrender: 0.5, tieAdd: 0 };

/** Gross return of the main bet of a seat that tied. `choice` null = no decision (surrender). */
export function warMainGross(bet: number, res: WarRes, choice: WarChoice | null, warWin: boolean, pay: WarPay = WAR_BASE_PAY): number {
  if (!(bet > 0)) return 0;
  if (res === 'win') return bet * 2;
  if (res === 'lose') return 0;
  if (choice === 'war') {
    if (!warWin) return 0;                                  // both the original and the raise lose
    return bet * (pay.warBonus ? 4 : 3);                    // raise wins 1:1 (2b back), original pushes (b) or wins 1:1 (2b)
  }
  return bet * pay.surrender;                               // surrender (or no decision)
}
/** Gross return of the Tie side bet (10:1 on a seat whose card tied the dealer's). */
export function warTieGross(bet: number, res: WarRes | null, pay: WarPay = WAR_BASE_PAY): number {
  return bet > 0 && res === 'tie' ? bet * (1 + 10 + pay.tieAdd) : 0;
}

/** Full gross of one seat for a finished War round (main + tie side). */
export function warSeatGross(main: number, tie: number, res: WarRes, choice: WarChoice | null, warWin: boolean, pay: WarPay = WAR_BASE_PAY): number {
  return warMainGross(main, res, choice, warWin, pay) + warTieGross(tie, res, pay);
}

// ── Dragon-Tiger ─────────────────────────────────────────────────────────────────────────────────
export interface DtOut {
  d: CardId; t: CardId;
  winner: DtWinner;
  suited: boolean;          // the two cards are the same card (same rank and suit)
}
export function dtOutcome(d: CardId, t: CardId): DtOut {
  const a = dtRank(d), b = dtRank(t);
  const winner: DtWinner = a > b ? 'D' : a < b ? 'T' : 'TIE'; // i18n-ok: outcome code, never shown
  return { d, t, winner, suited: d === t };
}

export interface DtPay {
  tieAdd: number;           // added to the Tie multiplier (11 + x; L25 +1)
  suitedAdd: number;        // added to the Suited Tie multiplier (50 + x)
  tieRefund: boolean;       // L100 / charm: Dragon and Tiger push in full on a tie
}
export const DT_BASE_PAY: DtPay = { tieAdd: 0, suitedAdd: 0, tieRefund: false };

/** Gross return of one Dragon-Tiger spot for an outcome; 0 on a loss. */
export function dtSpotGross(spot: number, bet: number, o: DtOut, pay: DtPay = DT_BASE_PAY): number {
  if (!(bet > 0)) return 0;
  switch (spot) {
    case DT_SPOT.DRAGON:
      return o.winner === 'D' ? bet * 2 : o.winner === 'TIE' ? bet * (pay.tieRefund ? 1 : 0.5) : 0; // i18n-ok: outcome code, never shown
    case DT_SPOT.TIGER:
      return o.winner === 'T' ? bet * 2 : o.winner === 'TIE' ? bet * (pay.tieRefund ? 1 : 0.5) : 0; // i18n-ok: outcome code, never shown
    case DT_SPOT.TIE:
      return o.winner === 'TIE' ? bet * (1 + 11 + pay.tieAdd) : 0; // i18n-ok: outcome code, never shown
    case DT_SPOT.SUITED:
      return o.suited ? bet * (1 + 50 + pay.suitedAdd) : 0;
    case DT_SPOT.D_BIG: return dtBig(o.d) ? bet * 2 : 0;
    case DT_SPOT.D_SMALL: return dtSmall(o.d) ? bet * 2 : 0;
    case DT_SPOT.D_ODD: return dtOdd(o.d) ? bet * 2 : 0;
    case DT_SPOT.D_EVEN: return dtEven(o.d) ? bet * 2 : 0;
    case DT_SPOT.T_BIG: return dtBig(o.t) ? bet * 2 : 0;
    case DT_SPOT.T_SMALL: return dtSmall(o.t) ? bet * 2 : 0;
    case DT_SPOT.T_ODD: return dtOdd(o.t) ? bet * 2 : 0;
    case DT_SPOT.T_EVEN: return dtEven(o.t) ? bet * 2 : 0;
    default: return 0;
  }
}

/** Dragon and Tiger cards are dealt face down and revealed in turn; the draw itself is shared. */
export function dealDt(shoe: CwShoe, rng: Rng, backed: readonly number[], luck = 0): DtOut {
  const make = (): DtOut => { const d = shoe.draw(); return dtOutcome(d, shoe.draw()); };
  let o = make();
  const allLose = backed.length > 0 && backed.every((s) => dtSpotGross(s, 1, o) === 0);
  if (luck > 0 && allLose && rng.next() * 100 < luck) {
    shoe.reinsert([o.d, o.t]);
    o = make();
  }
  return o;
}

// ── betting validation ──────────────────────────────────────────────────────────────────────────
/** Stake validation: every spot within its limits (or zero), no bet on an unused spot, seat total within `TABLE_MAX`. */
export function validBets(variant: Variant, bets: readonly number[], mult = 1): boolean {
  if (bets.length !== SPOT_COUNT) return false;
  let total = 0;
  for (let s = 0; s < SPOT_COUNT; s++) {
    const v = bets[s];
    if (!Number.isInteger(v) || v < 0) return false;
    if (v === 0) continue;
    const lim = limitOf(variant, s);
    if (!lim || v < lim.min * mult || v > lim.max * mult) return false;
    total += v;
  }
  return total <= TABLE_MAX * mult;
}

/** Stochastic rounding to whole coins: unbiased on average (the same trick as baccarat's headless round). */
export const roundCoins = (x: number, rng: Rng): number => Math.floor(x + rng.next());

// ── headless (staff auto-play and balance sims) ─────────────────────────────────────────────────
/**
 * Headless round for staff auto-play: a flat War main bet on a fresh six-deck shoe, the tie resolved by surrender.
 * The economy charges one stake per play and cannot charge a war raise, so the staff path never raises (see the
 * report notes). Gross is rounded to whole coins with stochastic rounding.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const shoe = new CwShoe(rng, WAR_DECKS);
  const deal = dealWar(shoe, rng, [0], h.luck);
  const res = deal.res[0];
  if (res === null) return { gross: 0 };
  const pay: WarPay = { ...WAR_BASE_PAY, surrender: WAR_BASE_PAY.surrender + Math.max(0, h.mod('m.cardwar.surrenderRefundAdd', 0)) };
  const choice: WarChoice | null = res === 'tie' ? 'surrender' : null;
  const gross = roundCoins(warMainGross(bet, res, choice, false, pay), rng);
  return { gross };
};

/**
 * Full simulated round for the RTP sims: every seat backs the given `stakes` (per spot, same for all seats in the sim),
 * with the tie policy `policy` ('war' | 'surrender'). Returns the gross per spot and the total stake per spot.
 */
export function simWar(shoe: CwShoe, rng: Rng, mainBet: number, tieBet: number, policy: WarChoice, pay: WarPay = WAR_BASE_PAY, luck = 0): { gross: number; stake: number } {
  const deal = dealWar(shoe, rng, [0], luck);
  const res = deal.res[0]!;
  let stake = mainBet + tieBet;
  let choice: WarChoice | null = null;
  let warWin = false;
  if (res === 'tie') {
    choice = policy;
    if (policy === 'war') {
      stake += mainBet;
      const w = warBattle(shoe, [0]);
      warWin = w.rows[0].win;
    }
  }
  const gross = warSeatGross(mainBet, tieBet, res, choice, warWin, pay);
  return { gross, stake };
}

/** Full simulated Dragon-Tiger round for the RTP sims: one unit on every spot listed in `spots`. */
export function simDt(shoe: CwShoe, rng: Rng, spots: readonly number[], unit = 1, pay: DtPay = DT_BASE_PAY, luck = 0): { gross: number[]; out: DtOut } {
  const o = dealDt(shoe, rng, spots, luck);
  return { gross: spots.map((s) => dtSpotGross(s, unit, o, pay)), out: o };
}
