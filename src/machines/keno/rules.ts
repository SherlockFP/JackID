/**
 * Keno Lounge (`keno`) — pure rules (no three, kit or DOM). Shared by the live lounge (`index.ts`) and the headless
 * play contract (`playHeadless`), so the simulated RTP IS the live RTP. Contract: MACHINES_tables §12.
 *
 * Pool 1..80. A ticket picks 1–10 spots. The lounge draws 20 numbers without replacement (integer weights, base 100
 * per number, hooks add integer weight). A ticket pays `stake × multiplier(spots, hits)` (paytable §12.3, exact RTP
 * 93.6–95.4 %). Every hook goes through one `Adjust` callback, so the live machine and the headless contract read the
 * same modifiers. Draws always consume a fixed number of rng calls per attempt, so a seed replays identically.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const POOL = 80;
export const DRAWN = 20;
export const MAX_SPOTS = 10;
export const MIN_SPOTS = 1;
export const MIN_STAKE = 1;
export const MAX_STAKE = 100;
export const DRAW_COUNTS = [1, 5, 10, 20] as const;
export type DrawCount = (typeof DRAW_COUNTS)[number];
export const BASE_WEIGHT = 100;
/** Top prize on this many spots or more carries the `jackpot` tag. */
export const JACKPOT_SPOTS = 7;
/** The staff gambler plays this many spots (Quick Pick). */
export const STAFF_SPOTS = 4;

/** Paytable §12.3: spots → [hits, gross multiplier] for every paying combination. */
export const PAYTABLE: Readonly<Record<number, ReadonlyArray<readonly [hits: number, mult: number]>>> = {
  1: [[1, 3.8]],
  2: [[2, 10], [1, 0.9]],
  3: [[3, 44], [2, 2.4]],
  4: [[4, 120], [3, 6], [2, 1.5]],
  5: [[5, 600], [4, 25], [3, 3]],
  6: [[6, 2000], [5, 100], [4, 8.5], [3, 1]],
  7: [[7, 7000], [6, 250], [5, 25], [4, 4], [3, 1]],
  8: [[8, 25000], [7, 1500], [6, 90], [5, 12], [4, 2]],
  9: [[9, 50000], [8, 5000], [7, 300], [6, 40], [5, 7], [4, 1]],
  10: [[10, 200000], [9, 10000], [8, 1000], [7, 150], [6, 20], [5, 3], [0, 2]],
};

/** Hook adjuster: `(name, base) → value`. `name` is the hook tail after `m.keno.`; live = `mod`, headless = `h.mod`. */
export type Adjust = (name: string, base: number) => number;
export const identity: Adjust = (_name, base) => base;

export interface TicketIn {
  picks: readonly number[];
  /** Stake for this draw (already validated 1..100). */
  stake: number;
  /** Charm owner's ticket: the owner's extra numbers count here only. */
  owner: boolean;
}
export interface TicketOut {
  spots: number;
  hits: number;
  mult: number;
  gross: number;
  /** One hit short of the top prize on 6+ spots (cosmetic beat). */
  nearmiss: boolean;
  /** Top prize on 7+ spots (`jackpot` tag). */
  top: boolean;
}
export interface DrawOpts {
  weights: readonly number[];
  /** Extra numbers drawn publicly after the 20 (counted for owners only). */
  extraN: number;
  /** Solo luck: reroll the whole draw once with p = luck/100 when it pays nothing. */
  luck: number;
  adj: Adjust;
}
export interface DrawOutcome {
  drawn: number[];
  extra: number[];
  rerolled: boolean;
  tickets: TicketOut[];
  gross: number;
}

export const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Exact probability that a ticket with `spots` picks hits exactly `hits` of the 20 drawn numbers (hypergeometric). */
export function hitProb(spots: number, hits: number): number {
  return (choose(spots, hits) * choose(POOL - spots, DRAWN - hits)) / choose(POOL, DRAWN);
}

/** Paytable base multiplier (before hooks). 0 when the combination does not pay. */
export function baseMult(spots: number, hits: number): number {
  for (const [h, m] of PAYTABLE[spots] ?? []) if (h === hits) return m;
  return 0;
}

/** Multiplier after hooks: `zeroHitPay` replaces the zero-hit pay on 8+ spots; `payAdd.S.H` adds to any cell. */
export function multOf(spots: number, hits: number, adj: Adjust = identity): number {
  let m = baseMult(spots, hits);
  if (hits === 0 && spots >= 8) m = adj('zeroHitPay', m);
  return Math.max(0, adj(`payAdd.${spots}.${hits}`, m));
}

/** Lounge weights per number 1..80 (index 0 = number 1). `spotWeight.n` adds integer weight; callers decide solo-only. */
export function weightsFor(adj: Adjust = identity): number[] {
  return Array.from({ length: POOL }, (_, i) => Math.max(0, BASE_WEIGHT + Math.round(adj(`spotWeight.${i + 1}`, 0))));
}

/** Picks are distinct integers 1..80 and 1..10 of them. */
export function validPicks(picks: readonly number[]): boolean {
  if (picks.length < MIN_SPOTS || picks.length > MAX_SPOTS) return false;
  const seen = new Set<number>();
  for (const n of picks) {
    if (!Number.isInteger(n) || n < 1 || n > POOL || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

/** Quick Pick: `spots` distinct numbers, each drawn by lounge weight (uniform unless hooks add weight). */
export function quickPick(rng: Rng, spots: number, weights: readonly number[] = weightsFor()): number[] {
  const w = weights.slice();
  return takeWeighted(rng, w, spots).sort((a, b) => a - b);
}

/** Weighted draw without replacement; mutates `w` (taken numbers get weight 0). Returns 1-based numbers in order. */
function takeWeighted(rng: Rng, w: number[], n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = rng.weightedIndex(w);
    out.push(i + 1);
    w[i] = 0;
  }
  return out;
}

/** Hits of a ticket on the drawn set plus (owner only) the extra set. */
export function scoreTicket(t: TicketIn, drawn: readonly number[], extra: readonly number[], adj: Adjust = identity): TicketOut {
  const spots = t.picks.length;
  const board = new Set(drawn);
  if (t.owner) for (const n of extra) board.add(n);
  let hits = 0;
  for (const n of t.picks) if (board.has(n)) hits++;
  const mult = multOf(spots, hits, adj);
  return {
    spots,
    hits,
    mult,
    gross: Math.round(t.stake * mult * 100) / 100,
    nearmiss: spots >= 6 && hits === spots - 1,
    top: spots >= JACKPOT_SPOTS && hits === spots,
  };
}

function once(rng: Rng, tickets: readonly TicketIn[], o: DrawOpts): Omit<DrawOutcome, 'rerolled'> {
  const w = o.weights.slice();
  const drawn = takeWeighted(rng, w, DRAWN);
  const extra = o.extraN > 0 ? takeWeighted(rng, w, o.extraN) : [];
  const outs = tickets.map((t) => scoreTicket(t, drawn, extra, o.adj));
  return { drawn, extra, tickets: outs, gross: outs.reduce((s, x) => s + x.gross, 0) };
}

/**
 * One lounge draw for every live ticket. Always consumes the gate draw first, so the stream position never depends
 * on the result. A solo draw that pays nothing may be rerolled once (`luck`).
 */
export function runDraw(rng: Rng, tickets: readonly TicketIn[], o: DrawOpts): DrawOutcome {
  const gate = rng.next();
  const first = once(rng, tickets, o);
  if (o.luck > 0 && first.gross === 0 && gate < o.luck / 100) return { ...once(rng, tickets, o), rerolled: true };
  return { ...first, rerolled: false };
}

/** Headless round for staff auto-play and balance sims: one Quick Pick ticket, one draw, collected at once. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const adj: Adjust = (name, base) => h.mod(`m.keno.${name}` as ModHook, base);
  const weights = weightsFor(adj);
  const picks = quickPick(rng, STAFF_SPOTS, weights);
  const out = runDraw(rng, [{ picks, stake: bet, owner: true }], {
    weights,
    extraN: Math.max(0, Math.round(adj('extraNumber', 0))),
    luck: h.luck,
    adj,
  });
  const t = out.tickets[0];
  const tags: string[] = [];
  if (out.rerolled) tags.push('lucky');
  if (t.top) tags.push('jackpot');
  return { gross: t.gross, tags };
};
