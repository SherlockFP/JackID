/**
 * Bingo "Hall of Calls" (`bingo`) — pure rules (no three, kit or DOM). Shared by the live hall (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP. Contract: MACHINES_tables §18.
 *
 * A card is a 5 × 5 grid (B 1–15, I 16–30, N 31–45, G 46–60, O 61–75). The centre is free and pre-marked. The host
 * orders all 75 balls at LOCK; the first 40 are base calls that mark every card. Later balls are extras that only mark
 * the cards of players who bought them (`daubs`). Each card is scored for its single best completed pattern (the
 * highest pay among the ones it holds). Integer coins; gross = floor(stake × multiplier).
 * Every hook goes through one `Adj` callback, so the live hall and the headless contract read the same modifiers.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const CELLS = 25;
export const FREE_CELL = 12;
export const BALLS = 75;
export const BASE_CALLS = 40;
export const MAX_EXTRA = 8;
export const CARD_CAP = 4;
export const MIN_STAKE = 2;
export const MAX_STAKE = 50;
/** Extra-ball price = ceil(PRICE_MARK × exact EV gain of that ball for the buyer's cards). */
export const PRICE_MARK = 1.15;

/** Pattern pays (× card stake). Line pays for any single line; Double and Triple count completed lines. */
export type Pattern = 'none' | 'line' | 'corners' | 'double' | 'triple' | 'x' | 'frame';
export const BASE_PAY: Readonly<Record<Exclude<Pattern, 'none'>, number>> = {
  line: 0.8, corners: 1.5, double: 2.5, triple: 10, x: 30, frame: 250,
};
export const LINES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];
export const DIAG_A: readonly number[] = LINES[10];
export const DIAG_B: readonly number[] = LINES[11];
export const CORNERS: readonly number[] = [0, 4, 20, 24];
export const FRAME: readonly number[] = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24];
const X_SET: readonly number[] = [...new Set([...DIAG_A, ...DIAG_B])];

/** Hook adjuster: `(name, base) → value`. `name` is the hook tail after `m.bingo.`. */
export type Adj = (name: string, base: number) => number;
export const identity: Adj = (_name, base) => base;

/** One card: `grid[i]` = the number in cell i (0 for the free centre); `free` = pre-marked cells (always the centre). */
export interface Card { grid: number[]; free: number[] }

/** Five columns of 15 numbers; the N column has four numbers and the free centre. */
export function makeCard(rng: Rng, secondFree = false): Card {
  const grid = new Array<number>(CELLS).fill(0);
  for (let c = 0; c < 5; c++) {
    const pool = Array.from({ length: 15 }, (_, i) => c * 15 + 1 + i);
    rng.shuffle(pool);
    const col = pool.slice(0, c === 2 ? 4 : 5).sort((a, b) => a - b);
    let k = 0;
    for (let r = 0; r < 5; r++) {
      if (r === 2 && c === 2) continue;
      grid[r * 5 + c] = col[k++];
    }
  }
  const free = [FREE_CELL];
  if (secondFree) {
    const cells = Array.from({ length: CELLS }, (_, i) => i).filter((i) => i !== FREE_CELL);
    free.push(cells[rng.int(0, cells.length - 1)]);
  }
  return { grid, free };
}

/** A shuffled order of all 75 balls. Index 0..39 are base calls, the rest are extras. */
export function orderBalls(rng: Rng): number[] {
  return rng.shuffle(Array.from({ length: BALLS }, (_, i) => i + 1));
}

/** Base calls as a lookup (index = number). */
export function baseSet(order: readonly number[], calls = BASE_CALLS): boolean[] {
  const out = new Array<boolean>(BALLS + 1).fill(false);
  for (let i = 0; i < calls && i < order.length; i++) out[order[i]] = true;
  return out;
}

/** Marked cells: pre-marked, base-called numbers, and the card's own daubs (extras and free daubs). */
export function marksOf(card: Card, base: readonly boolean[], daubs: readonly number[]): boolean[] {
  const m = card.grid.map((n, i) => card.free.includes(i) || (n !== 0 && base[n]));
  for (const i of daubs) m[i] = true;
  return m;
}

const full = (m: readonly boolean[], idx: readonly number[]): boolean => idx.every((i) => m[i]);

/** Best completed pattern (highest adjusted pay). Lines count: ≥1 Line, ≥2 Double, ≥3 Triple, plus Corners/X/Frame. */
export function best(m: readonly boolean[], adj: Adj = identity): { pattern: Pattern; mult: number } {
  let lines = 0;
  for (const l of LINES) if (full(m, l)) lines++;
  const cand: Array<Exclude<Pattern, 'none'>> = [];
  if (lines >= 1) cand.push('line');
  if (full(m, CORNERS)) cand.push('corners');
  if (lines >= 2) cand.push('double');
  if (lines >= 3) cand.push('triple');
  if (full(m, DIAG_A) && full(m, DIAG_B)) cand.push('x');
  if (full(m, FRAME)) cand.push('frame');
  let pattern: Pattern = 'none';
  let mult = 0;
  for (const p of cand) {
    const v = Math.max(0, adj(`patternPayAdd.${p}`, BASE_PAY[p]));
    if (v > mult) { mult = v; pattern = p; }
  }
  return { pattern, mult };
}

/** "1 TO GO" for X or Frame: exactly one unmarked cell left on either shape. */
export function nearMiss(m: readonly boolean[]): boolean {
  const left = (idx: readonly number[]): number => idx.filter((i) => !m[i]).length;
  return left(X_SET) === 1 || left(FRAME) === 1;
}

/** Cell index of number `n` on the card, or −1. */
export function cellOf(card: Card, n: number): number { return card.grid.indexOf(n); }

/** Multiplier gained if number `n` (still uncalled) were daubed on this card now. 0 when it does nothing. */
export function gainOf(card: Card, m: readonly boolean[], n: number, adj: Adj = identity): number {
  const i = cellOf(card, n);
  if (i < 0 || m[i]) return 0;
  const after = m.slice();
  after[i] = true;
  return best(after, adj).mult - best(m, adj).mult;
}

/** Exact EV gain (× stake) of one extra ball drawn uniformly from the uncalled pool. */
export function evGain(card: Card, m: readonly boolean[], pool: readonly number[], adj: Adj = identity): number {
  if (!pool.length) return 0;
  let s = 0;
  for (const n of pool) s += gainOf(card, m, n, adj);
  return s / pool.length;
}

/** A card is "one number away" from a better pattern when some uncalled number would raise its pay. */
export function targetOf(card: Card, m: readonly boolean[], pool: readonly number[], adj: Adj = identity): { n: number; gain: number } | null {
  let out: { n: number; gain: number } | null = null;
  for (const n of pool) {
    const g = gainOf(card, m, n, adj);
    if (g > 0 && (!out || g > out.gain)) out = { n, gain: g };
  }
  return out;
}

/** Price of the next extra ball for one player: ceil(1.15 × Σ stake × EV gain), discounted by hook, min 1. */
export function extraPrice(cards: ReadonlyArray<{ card: Card; stake: number; daubs: readonly number[] }>, base: readonly boolean[], pool: readonly number[], adj: Adj = identity): number {
  const discount = Math.min(0.9, Math.max(0, adj('extraBallDiscount', 0)));
  let ev = 0;
  for (const c of cards) ev += c.stake * evGain(c.card, marksOf(c.card, base, c.daubs), pool, adj);
  return Math.max(1, Math.ceil(PRICE_MARK * ev * (1 - discount)));
}

/** Daubs the owner's free marks on the best uncalled number, once per charge (`freeDaub`). */
export function freeDaubs(card: Card, base: readonly boolean[], pool: readonly number[], charges: number, adj: Adj = identity): number[] {
  const out: number[] = [];
  for (let k = 0; k < charges; k++) {
    const m = marksOf(card, base, out);
    let pick = -1, gain = 0;
    for (const n of pool) {
      const g = gainOf(card, m, n, adj);
      if (g > gain) { gain = g; pick = cellOf(card, n); }
    }
    if (pick < 0) break;
    out.push(pick);
  }
  return out;
}

export interface CardOut { pattern: Pattern; mult: number; gross: number; nearmiss: boolean; top: boolean }

/** Settles one card after the calls. `shared` refunds a losing card (luck, shared hall). */
export function settleCard(card: Card, base: readonly boolean[], daubs: readonly number[], stake: number, shared: boolean, adj: Adj = identity): CardOut {
  const m = marksOf(card, base, daubs);
  const { pattern, mult } = best(m, adj);
  let gross = Math.floor(stake * mult);
  if (gross === 0 && shared) gross = stake;
  return { pattern, mult, gross, nearmiss: pattern !== 'x' && pattern !== 'frame' && nearMiss(m), top: pattern === 'frame' };
}

/**
 * One solo round of base calls for a set of cards: first 40 balls, free daubs, settle. Returns gross, the net, and the
 * per-card results. Solo luck reroll: if the net is negative, a `gate < luck / 100` reshuffle replays the round once.
 */
export interface RoundOut { gross: number; net: number; rerolled: boolean; cards: CardOut[] }
export function playSolo(rng: Rng, cards: readonly Card[], stake: number, luck: number, adj: Adj = identity): RoundOut {
  const gate = rng.next();
  const run = (order: number[]): RoundOut => {
    const base = baseSet(order);
    const uncalled = order.filter((n) => !base[n]);
    const charges = Math.max(0, Math.round(adj('freeDaub', 0)));
    const outs = cards.map((c) => {
      const daubs = freeDaubs(c, base, uncalled, charges, adj);
      return settleCard(c, base, daubs, stake, false, adj);
    });
    const gross = outs.reduce((s, o) => s + o.gross, 0);
    return { gross, net: gross - stake * cards.length, rerolled: false, cards: outs };
  };
  const first = run(orderBalls(rng));
  if (luck > 0 && first.net < 0 && gate < luck / 100) return { ...run(orderBalls(rng)), rerolled: true };
  return first;
}

/** Headless round for staff auto-play and balance sims: one card, one stake, base calls only (no extra balls). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const adj: Adj = (name, base) => h.mod(`m.bingo.${name}` as ModHook, base);
  const secondFree = adj('secondFree', 0) >= 1;
  const card = makeCard(rng, secondFree);
  const round = playSolo(rng, [card], bet, h.luck, adj);
  const tags: string[] = [];
  if (round.rerolled) tags.push('lucky');
  if (round.cards[0].top) tags.push('jackpot');
  return { gross: round.gross, tags };
};
