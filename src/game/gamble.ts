/**
 * RISK LAYER (tycoon pass): pure rules for the three ways to push a stake harder. No DOM, no wallet, no globals: every
 * roll takes a seeded Rng, so the tests drive it directly and MachineBase wires it to the run through `GambleRunPort`.
 *
 *  1. DOUBLE OR NOTHING  after a win the player may put the credited win on a card ladder: pick red or black, win and the
 *     pot doubles (x2, x4, x8, x16), lose and it is gone. P(win) = 0.485, so each rung is worth 0.97 of the pot (EV 0.97).
 *  2. HIGH STAKES        from Night 2: every stake costs x5 and pays x5; the payouts get a bigger tail. A top win (x25 or more)
 *                        pays x1.3, and what that extra cost the house is clawed back from later small wins (the ledger), so
 *                        the machine's RTP stays within 2 points of its normal value in the long run.
 *  3. ALL-IN SHOT        once per Watch: the whole pocket on a 1-in-4 shot paying x4.5 (EV 1.125, brutal variance).
 */
import type { Rng } from '@/core/rng';
import type { EcoSource } from '@/game/types';

// ── DOUBLE OR NOTHING ──────────────────────────────────────────────────────────────────────────────
export const GAMBLE_STEPS = 4;                 // x2, x4, x8, x16
export const GAMBLE_WIN_P = 0.485;             // 2 x 0.485 = 0.97 per rung
export const GAMBLE_MIN_WIN = 2;               // smaller credits are not worth a ladder
export const GAMBLE_OFFER_S = 7;               // how long the offer stays open after a win

export type CardColor = 'red' | 'black';
export type Suit = 'H' | 'D' | 'S' | 'C';
export interface GambleCard { color: CardColor; suit: Suit; rank: number }
export interface GambleStepResult { pick: CardColor; card: GambleCard; won: boolean; pot: number; step: number; over: boolean; maxed: boolean }

/** The face-up card of a rung: colour decided by the odds roll, then a suit and rank for show. */
export function drawCard(rng: Rng, color: CardColor): GambleCard {
  const suit: Suit = color === 'red' ? (rng.next() < 0.5 ? 'H' : 'D') : (rng.next() < 0.5 ? 'S' : 'C');
  return { color, suit, rank: rng.int(1, 13) };
}

export class GambleLadder {
  private _pot: number;
  private _step = 0;
  private _over = false;
  constructor(private readonly rng: Rng, readonly stake: number, readonly steps = GAMBLE_STEPS) { this._pot = Math.max(0, Math.floor(stake)); }
  get pot(): number { return this._pot; }
  get step(): number { return this._step; }
  get over(): boolean { return this._over; }
  /** The pot if the next rung is won. */
  get nextPot(): number { return this._pot * 2; }
  /** Empties the pot (it was paid out): a later release or collect pays nothing. */
  drain(): void { this._pot = 0; this._over = true; }
  /** One rung: the player calls a colour. Lost: pot 0 and the ladder is over. Won: pot x2; the top rung ends it too (`maxed`). */
  pick(color: CardColor): GambleStepResult {
    if (this._over) throw new Error('gamble: ladder is over');
    const won = this.rng.next() < GAMBLE_WIN_P;
    const card = drawCard(this.rng, won ? color : (color === 'red' ? 'black' : 'red'));
    this._step++;
    if (won) this._pot *= 2; else this._pot = 0;
    const maxed = won && this._step >= this.steps;
    this._over = !won || maxed;
    return { pick: color, card, won, pot: this._pot, step: this._step, over: this._over, maxed };
  }
}
/** Expected value of climbing `rungs` rungs and collecting, as a fraction of the stake. */
export function ladderEv(rungs: number): number { return (2 * GAMBLE_WIN_P) ** rungs; }

// ── HIGH STAKES ────────────────────────────────────────────────────────────────────────────────────
export const HS_MULT = 5;
export const HS_UNLOCK_NIGHT = 2;              // run.night() is 1-based (index + 1): 2 = Night 2
export const HS_TOP_X = 25;                    // a win of this many bets or more is a top outcome
export const HS_TOP_BOOST = 1.3;
export const HS_TRIM = 0.25;                   // share of a small win the ledger may take back
export const HS_SMALL_MAX_X = 5;               // wins above 1x and below this are "small"
export const hsUnlocked = (night: number): boolean => night >= HS_UNLOCK_NIGHT;

/** Pays the top-outcome boost and claws it back from later small wins, so RTP only moves by what is still owed. */
export class HsLedger {
  owed = 0;
  /** `gross` and `bet` are the machine's own (unscaled) numbers; returns the reshaped gross (still unscaled). */
  shape(gross: number, bet: number): number {
    if (gross <= 0 || bet <= 0) return Math.max(0, gross);
    const m = gross / bet;
    if (m >= HS_TOP_X) {
      const out = Math.round(gross * HS_TOP_BOOST);
      this.owed += out - gross;
      return out;
    }
    if (m > 1 && m < HS_SMALL_MAX_X && this.owed > 0) {
      const trim = Math.min(this.owed, Math.floor(gross * HS_TRIM));
      this.owed -= trim;
      return gross - trim;
    }
    return gross;
  }
  snapshot(): number { return this.owed; }
  restore(n: number): void { this.owed = Math.max(0, n || 0); }
}

// ── ALL-IN SHOT ────────────────────────────────────────────────────────────────────────────────────
export const ALLIN_P = 0.25;
export const ALLIN_MULT = 4.5;
export const ALLIN_MIN_POCKET = 10;
export const ALLIN_CONFIRM_S = 5;              // the second press must come within this many seconds
export const allInEv = (): number => ALLIN_P * ALLIN_MULT;
/** The payout of a won shot for a pocket (the stake is already taken). */
export const allInPayout = (pocket: number): number => Math.floor(pocket * ALLIN_MULT);
export function allInRoll(rng: Rng): boolean { return rng.next() < ALLIN_P; }

/** Two-press flow: the first press arms (warning on screen), the second inside the window fires. Time is fed by the caller (seconds). */
export class AllInArm {
  private armedAt = -Infinity;
  armed(now: number): boolean { return now - this.armedAt <= ALLIN_CONFIRM_S; }
  /** Returns 'arm' on the first press, 'fire' on a confirming one. */
  press(now: number): 'arm' | 'fire' {
    if (this.armed(now)) { this.armedAt = -Infinity; return 'fire'; }
    this.armedAt = now; return 'arm';
  }
  cancel(): void { this.armedAt = -Infinity; }
}

// ── run wiring ─────────────────────────────────────────────────────────────────────────────────────
export type GambleReason = 'gamble' | 'highstakes' | 'allin';
/**
 * What the run must offer (see WIRING). `debit` takes coins from the pocket and counts them as wagered, with no pull cost, stake
 * limit or confirm; `credit` pays coins raw (no modifiers) and counts them as paid. Both emit `eco:wallet`.
 */
export interface GambleRunPort {
  /** Unique id of the current Watch (changes every Watch and every Night). */
  watchId(): number;
  /** The All-In Shot is once per Watch: the run remembers it (saved), so a reload cannot give a second one. */
  allInUsed(): boolean;
  markAllIn(): void;
  debit(amount: number, src: EcoSource, reason: GambleReason): boolean;
  credit(amount: number, src: EcoSource, reason: GambleReason): number;
}
export const gamblePortOf = (run: unknown): GambleRunPort | null => (run as { gamble?: GambleRunPort }).gamble ?? null;

declare module '@/core/events' {
  interface GameEvents {
    /** Audio / juice hook for the risk layer. `step` is the rung (1-based), `pot` the coins at stake. */
    'gamble:fx': {
      kind: 'offer' | 'open' | 'tension' | 'flip' | 'win' | 'lose' | 'collect' | 'max'
        | 'hsOn' | 'hsOff' | 'hsBoost' | 'allinArm' | 'allinCancel' | 'allinFire' | 'allinWin' | 'allinLose';
      mid: string; step: number; pot: number;
    };
  }
}
