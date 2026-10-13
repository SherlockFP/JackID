/**
 * Lotto Ball Blower (`lottoblower`) — pure rules (no three, kit or DOM). Shared by the live blower (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP. Contract: MACHINES_tables §19.
 *
 * A line is 5 distinct numbers from 1–30 plus 1 Moon from 1–8. The blower draws 5 main balls without replacement, then
 * 1 Moon (integer weights, base 100, hooks add integer weight). A line pays `bet × multiplier` (paytable §19.3, fixed
 * RTP 85.97 %). Main 5 + Moon is the progressive jackpot: the machine feeds 8 % of every paid line into the pool and the
 * host pays the pool (split equally between winning lines) — the pool itself lives in `index.ts`, never here.
 * Every hook goes through one `Adjust` callback so the live machine and the headless contract read the same modifiers.
 * Draws consume a fixed number of rng calls whatever the outcome, so a seed always replays identically.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const MAIN_POOL = 30;
export const MAIN_PICK = 5;
export const MOON_POOL = 8;
/** Base line price (coins). Live stakes are multiples chosen with the bet keys; the paytable scales with the bet. */
export const LINE_PRICE = 5;
export const MIN_BET = LINE_PRICE;
export const MAX_BET = 100;
export const MAX_LINES = 20;
/** Share of every paid line that feeds the progressive jackpot. */
export const FEED = 0.08;
/** Pool seed: 20,000 lines of the base price. */
export const JACKPOT_SEED = 20000 * LINE_PRICE;
export const BASE_WEIGHT = 100;
/** Quick-pick batch sizes for the ×5 / ×10 / ×20 key. */
export const QUICK_BATCHES = [5, 10, 20] as const;
/** The staff gambler plays this many lines (Quick Pick). */
export const STAFF_LINES = 1;

export const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/** Exact odds of the jackpot (5 main + Moon): 1 in 1,140,048. */
export const JACKPOT_ODDS = 1 / (choose(MAIN_POOL, MAIN_PICK) * MOON_POOL);

/** Paytable §19.3: [main matches, Moon matched, gross multiplier of the line price]. Jackpot is not listed here. */
export const PAYTABLE: ReadonlyArray<readonly [main: number, moon: boolean, mult: number]> = [
  [5, false, 5000],
  [4, true, 500],
  [4, false, 80],
  [3, true, 40],
  [3, false, 8],
  [2, true, 8],
  [2, false, 1],
  [1, true, 2],
  [0, true, 1],
];

/** Hook adjuster `(name, base) → value`. `name` is the hook tail after `x.lottoblower.`; live = `mod`, headless = `h.mod`. */
export type Adjust = (name: string, base: number) => number;
export const identity: Adjust = (_name, base) => base;

/** One line: 5 distinct main numbers (ascending) and one Moon. */
export interface Line { picks: number[]; moon: number }

export interface TicketIn {
  lines: readonly Line[];
  /** The first `paid` lines are charged `bet` each; the rest are free lines (charm). */
  paid: number;
  bet: number;
  /** Charm owner's ticket: the owner's extra balls count on these lines. */
  owner: boolean;
  /** Luck 0..100 for this ticket: solo = reroll a losing draw once; shared = refund this losing ticket. */
  luck: number;
}

export interface LineOut {
  main: number;
  moon: boolean;
  jackpot: boolean;
  mult: number;
  gross: number;
  /** Four main matches with the wrong Moon (cosmetic beat). */
  nearmiss: boolean;
  /** Which picks matched (for the tally stamp). */
  matched: number[];
}

export interface TicketOut {
  lines: LineOut[];
  /** Coins charged before the draw (paid lines × bet). */
  charged: number;
  /** Non-jackpot gross incl. refunds (the host adds jackpot shares). */
  gross: number;
  /** Refunded on a losing batch by luck (shared draws). */
  refund: boolean;
  /** Owner's lines (or any line) that hit the jackpot. */
  jackpotLines: number;
  nearmiss: boolean;
}

export interface Draw { main: number[]; moon: number; extra: number[] }

export interface DrawOpts {
  mainW: readonly number[];
  moonW: readonly number[];
  /** Extra main balls drawn publicly after the five (counted for the owner's lines only). */
  extraN: number;
  solo: boolean;
  adj: Adjust;
  /** A draw rolled ahead of time (shared cadence: peeked before close). Never rerolled. */
  pre?: Draw;
}

export interface DrawOutcome { draw: Draw; tickets: TicketOut[]; rerolled: boolean }

/** Paytable base multiplier (before any hook). 0 when the combination does not pay. */
export function baseMult(main: number, moon: boolean): number {
  for (const [m, mo, mult] of PAYTABLE) if (m === main && mo === moon) return mult;
  return 0;
}

export const isJackpot = (main: number, moon: boolean): boolean => main === MAIN_PICK && moon;

/** Main weights: base 100 for every ball (no hook on the 30 white balls). */
export function mainWeights(): number[] {
  return Array.from({ length: MAIN_POOL }, () => BASE_WEIGHT);
}

/** Moon weights 1..8. `moonWeight.n` adds integer weight; callers decide whether it applies (solo only). */
export function moonWeights(adj: Adjust = identity): number[] {
  return Array.from({ length: MOON_POOL }, (_, i) => Math.max(0, BASE_WEIGHT + Math.round(adj(`moonWeight.${i + 1}`, 0))));
}

/** A line is valid when it has 5 distinct main numbers 1..30 and a Moon 1..8. */
export function validLine(l: Line): boolean {
  if (!Array.isArray(l.picks) || l.picks.length !== MAIN_PICK) return false;
  const seen = new Set<number>();
  for (const n of l.picks) {
    if (!Number.isInteger(n) || n < 1 || n > MAIN_POOL || seen.has(n)) return false;
    seen.add(n);
  }
  return Number.isInteger(l.moon) && l.moon >= 1 && l.moon <= MOON_POOL;
}

/** Weighted draw without replacement from a copy of `w`. Returns 1-based numbers in draw order. */
function takeWeighted(rng: Rng, w: number[], n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = rng.weightedIndex(w);
    out.push(i + 1);
    w[i] = 0;
  }
  return out;
}

/** Quick Pick: 5 distinct main numbers and a Moon, by the given weights (uniform unless hooks add weight). */
export function quickLine(rng: Rng, mainW: readonly number[] = mainWeights(), moonW: readonly number[] = moonWeights()): Line {
  const picks = takeWeighted(rng, mainW.slice(), MAIN_PICK).sort((a, b) => a - b);
  const moon = rng.weightedIndex(moonW) + 1;
  return { picks, moon };
}

/** One physical draw: 5 main, then Moon, then the extra public balls (fixed rng calls per draw). */
export function drawBalls(rng: Rng, mainW: readonly number[], moonW: readonly number[], extraN: number): Draw {
  const w = mainW.slice();
  const main = takeWeighted(rng, w, MAIN_PICK);
  const moon = rng.weightedIndex(moonW) + 1;
  const extra = extraN > 0 ? takeWeighted(rng, w, extraN) : [];
  return { main, moon, extra };
}

/** Scores one line against the drawn board (main set, owner's extra set already merged by the caller). */
export function scoreLine(l: Line, board: ReadonlySet<number>, moon: number, bet: number): LineOut {
  const matched = l.picks.filter((n) => board.has(n));
  const main = matched.length;
  const moonHit = l.moon === moon;
  const jackpot = isJackpot(main, moonHit);
  const mult = jackpot ? 0 : baseMult(main, moonHit);
  return {
    main, moon: moonHit, jackpot, mult, gross: bet * mult,
    nearmiss: main === MAIN_PICK - 1 && !moonHit, matched,
  };
}

/** Scores every line of one ticket. Free lines pay like paid ones but cost nothing. */
export function scoreTicket(t: TicketIn, draw: Draw): TicketOut {
  const board = new Set(draw.main);
  if (t.owner) for (const n of draw.extra) board.add(n);
  const lines = t.lines.map((l) => scoreLine(l, board, draw.moon, t.bet));
  const gross = lines.reduce((s, x) => s + x.gross, 0);
  return {
    lines,
    charged: t.paid * t.bet,
    gross,
    refund: false,
    jackpotLines: lines.filter((x) => x.jackpot).length,
    nearmiss: lines.some((x) => x.nearmiss),
  };
}

function once(rng: Rng, tickets: readonly TicketIn[], o: DrawOpts): { draw: Draw; tickets: TicketOut[] } {
  const draw = o.pre ?? drawBalls(rng, o.mainW, o.moonW, o.extraN);
  return { draw, tickets: tickets.map((t) => scoreTicket(t, draw)) };
}

/**
 * One blower draw for every live ticket. The gate draw comes first, so the stream position never depends on the result.
 * Solo: a draw that leaves the ticket in net loss is rerolled once with p = luck/100. Shared: every ticket draws its own
 * gate and a losing ticket is refunded its charge with p = its luck/100 (the gate is always consumed).
 */
export function runDraw(rng: Rng, tickets: readonly TicketIn[], o: DrawOpts): DrawOutcome {
  const gate = rng.next();
  const first = once(rng, tickets, o);
  if (o.solo) {
    const p = (tickets[0]?.luck ?? 0) / 100;
    const losing = first.tickets.some((t) => t.gross < t.charged);
    if (p > 0 && gate < p && losing) return { ...once(rng, tickets, { ...o, pre: undefined }), rerolled: true };
    return { ...first, rerolled: false };
  }
  const outs = first.tickets.map((t, i) => {
    const r = rng.next();
    const p = (tickets[i].luck ?? 0) / 100;
    if (r < p && t.gross < t.charged) return { ...t, gross: t.gross + t.charged, refund: true };
    return t;
  });
  return { draw: first.draw, tickets: outs, rerolled: false };
}

/** Splits the pool equally between winning lines (`weights` = 1 per line, owner lines scaled by the jackpot share). */
export function splitJackpot(pool: number, weights: readonly number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  return weights.map((w) => Math.floor((pool * w) / total));
}

/**
 * Headless round for staff auto-play and balance sims: one Quick Pick line, one draw, collected at once. The jackpot
 * pool is host state, so a headless jackpot pays its stationary expectation FEED × bet / odds (EV-neutral, so balance
 * sims stay honest without a pool).
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const adj: Adjust = (name, base) => h.mod(`x.lottoblower.${name}` as ModHook, base);
  const mainW = mainWeights();
  const moonW = moonWeights(adj);
  const line = quickLine(rng, mainW, moonW);
  const out = runDraw(rng, [{ lines: [line], paid: 1, bet, owner: true, luck: h.luck }], {
    mainW, moonW,
    extraN: Math.max(0, Math.round(adj('extraBall', 0))),
    solo: true,
    adj,
  });
  const t = out.tickets[0];
  const tags: string[] = [];
  let gross = t.gross;
  if (out.rerolled) tags.push('lucky');
  if (t.jackpotLines > 0) { gross += Math.round((bet * FEED) / JACKPOT_ODDS); tags.push('jackpot'); }
  if (t.nearmiss) tags.push('nearmiss');
  return { gross, tags };
};
