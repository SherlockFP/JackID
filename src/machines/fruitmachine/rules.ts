/**
 * Nudge & Hold fruit machine — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * One line, three reels, 20 stops each (MACHINES §17). A START charges the stake and spins the unheld reels.
 * Three equal fruits pay (× stake). STEP on reel 3 advances the feature trail. A losing spin may release a feature
 * (HOLD / NUDGE / STEP+1). A win opens the HI/LO gamble. Everything that pays is capped by the compensator:
 *
 *   bank B (per instance, persisted per run): START adds RTP × stake, every payout subtracts.
 *   float  F = stake × (10 + luck, cap +20). A spin whose line win exceeds B + F is redrawn (≤ 8) or forced to a loss;
 *   a trail cash square above B + F is skipped; a gamble climb above B + F is a loss; a nudge above B + F is refused.
 *   Feature release after a loss: pf = clamp(0.03 × (B/stake − 10), 0, 0.6) × holdOdds, then HOLD 40 / NUDGE 35 / STEP 25.
 *
 * Because payouts never exceed B + F, the bank is bounded below by −F, so the long-run return converges to RTP = 0.88.
 *
 * Coins are integers only where the design says so; the bank is a float. No `Math.random`: every draw comes from the Rng.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const REELS = 3;
export const STOPS = 20;
export type Sym = 'PEAR' | 'GRAPES' | 'STRAW' | 'MELON' | 'BAR' | 'STAR' | 'BAG' | 'STEP';
export const SYMS: readonly Sym[] = ['PEAR', 'GRAPES', 'STRAW', 'MELON', 'BAR', 'STAR', 'BAG', 'STEP'];
export type Feature = 'HOLD' | 'NUDGE' | 'STEP';
export type Pick = 'HI' | 'LO';

/** Strips: the stop counts per symbol match MACHINES §17.2 (reel 1 and 2 have no STEP, reel 3 has three). */
export const STRIPS: readonly (readonly Sym[])[] = [
  ['PEAR', 'GRAPES', 'STRAW', 'MELON', 'PEAR', 'BAR', 'GRAPES', 'STAR', 'PEAR', 'STRAW',
    'MELON', 'GRAPES', 'PEAR', 'BAG', 'STRAW', 'MELON', 'BAR', 'PEAR', 'GRAPES', 'STAR'],
  ['GRAPES', 'PEAR', 'MELON', 'STRAW', 'PEAR', 'STAR', 'BAR', 'PEAR', 'GRAPES', 'MELON',
    'STRAW', 'PEAR', 'STAR', 'GRAPES', 'BAG', 'PEAR', 'STRAW', 'MELON', 'GRAPES', 'BAR'],
  ['PEAR', 'STEP', 'GRAPES', 'STRAW', 'MELON', 'BAR', 'PEAR', 'STAR', 'GRAPES', 'STEP',
    'STRAW', 'PEAR', 'BAG', 'MELON', 'STAR', 'GRAPES', 'BAR', 'STEP', 'PEAR', 'STRAW'],
];

/** Line pays × stake (three of a kind). STEP never pays. */
export const PAY: Partial<Record<Sym, number>> = {
  PEAR: 4, GRAPES: 6, STRAW: 8, MELON: 12, BAR: 20, STAR: 50, BAG: 100,
};

export const RTP = 0.88;
export const STAKES: readonly number[] = [1, 2, 5, 10, 20];
export const MAX_STAKE = 20;
/** New run: B = +5 × max stake. */
export const BANK_START = 5 * MAX_STAKE;
export const FLOAT_BASE = 10;
export const LUCK_CAP = 20;
export const REDRAWS = 8;

export type Square = { k: 'CASH' | 'NUDGE' | 'HOLD'; m: number; n: number };
/** The trail: STEP lands on the next square; the trail resets after the last. Cash is × stake. */
export const SQUARES: readonly Square[] = [
  { k: 'NUDGE', m: 0, n: 2 }, { k: 'CASH', m: 3, n: 0 }, { k: 'HOLD', m: 0, n: 0 },
  { k: 'CASH', m: 6, n: 0 }, { k: 'NUDGE', m: 0, n: 4 }, { k: 'CASH', m: 15, n: 0 },
];
export const NUDGE_MIN = 1, NUDGE_MAX = 5, NUDGE_CAP = 15;
/** HI/LO ladder rungs (× stake). A correct guess moves the win to the next rung above it. */
export const LADDER: readonly number[] = [2, 4, 8, 15, 25, 50, 100];
const PF_SLOPE = 0.03, PF_OFFSET = 10, PF_CAP = 0.6;

export const HOOK = {
  holdOdds: 'm.fruitmachine.holdOdds' as ModHook,
  gambleSafety: 'm.fruitmachine.gambleSafety' as ModHook,
  trailStart: 'm.fruitmachine.trailStart' as ModHook,
};

/** Persisted machine state. Plain JSON. `bank` never leaves the authority in events. */
export type Core = {
  bank: number;
  /** Index of the next trail square. */
  trail: number;
  stops: number[];
  /** HOLD lamp: the next START may hold reels. */
  hold: boolean;
  /** Reels locked by the last spin's holds (no nudge on them). */
  locks: boolean[];
  /** Nudges left in this round (lost on START). */
  nudges: number;
};

export type SquareHit = { square: Square; cash: number; skipped: boolean };

export type Spin = {
  stops: number[];
  syms: Sym[];
  held: boolean[];
  /** Line win before the gamble (coins). 0 = loss. */
  line: number;
  squares: SquareHit[];
  release: Feature | null;
  redraws: number;
  forced: boolean;
};

export type Nudge = {
  ok: boolean;
  /** True when the nudge would have pushed the line above B + F (the machine shows NO). */
  refused: boolean;
  stops: number[];
  line: number;
  squares: SquareHit[];
};

export type Gamble = { value: number; shown: number; safety: number };
export type GambleStep = { result: 'win' | 'lose' | 'push'; next: number; value: number; safetyUsed: boolean };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function newCore(trailStart = 1): Core {
  return {
    bank: BANK_START, trail: clamp(Math.floor(trailStart) - 1, 0, SQUARES.length - 1),
    stops: [0, 0, 0], hold: false, locks: [false, false, false], nudges: 0,
  };
}

export const floatOf = (stake: number, luck: number): number =>
  stake * (FLOAT_BASE + clamp(Math.floor(luck), 0, LUCK_CAP));

export const symAt = (reel: number, stop: number): Sym => STRIPS[reel][((stop % STOPS) + STOPS) % STOPS];
export const symsOf = (stops: readonly number[]): Sym[] => stops.map((s, r) => symAt(r, s));

/** Multiplier of the line: three equal non-STEP fruits, else 0. */
export function lineMult(sy: readonly Sym[]): number {
  const a = sy[0];
  if (a === 'STEP' || a !== sy[1] || a !== sy[2]) return 0;
  return PAY[a] ?? 0;
}

/** pf = clamp(0.03 × (B/stake − 10), 0, 0.6) × holdOdds (a probability). */
export function featureChance(bank: number, stake: number, holdOdds: number): number {
  return clamp(clamp(PF_SLOPE * (bank / stake - PF_OFFSET), 0, PF_CAP) * holdOdds, 0, 1);
}

/** The next rung above `value` (× stake). At the top the value stays. */
export function climb(value: number, stake: number): number {
  for (const m of LADDER) if (m * stake > value) return m * stake;
  return value;
}

export const TOP_RUNG = (stake: number): number => LADDER[LADDER.length - 1] * stake;

/** STEP lands: advance the trail one square, pay cash (skipped above B + F − reserve), award nudges or a hold. */
export function applySquare(core: Core, stake: number, reserve: number, F: number): SquareHit {
  const square = SQUARES[core.trail];
  core.trail = (core.trail + 1) % SQUARES.length;
  if (square.k === 'NUDGE') {
    core.nudges = Math.min(NUDGE_CAP, core.nudges + square.n);
    return { square, cash: 0, skipped: false };
  }
  if (square.k === 'HOLD') {
    core.hold = true;
    return { square, cash: 0, skipped: false };
  }
  const amt = square.m * stake;
  if (amt + reserve > core.bank + F) return { square, cash: 0, skipped: true };
  core.bank -= amt;
  return { square, cash: amt, skipped: false };
}

function sanitizeHolds(want: readonly boolean[]): boolean[] {
  const out = [false, false, false];
  let n = 0;
  for (let r = 0; r < REELS; r++) if (want[r] && n < 2) { out[r] = true; n++; }
  return out;
}

/** Forces a losing stop set: changes one free reel to the first offset that breaks the line. */
function forceLoss(stops: number[], free: number[]): void {
  for (const r of free) {
    const base = stops[r];
    for (let off = 1; off < STOPS; off++) {
      stops[r] = (base + off) % STOPS;
      if (lineMult(symsOf(stops)) === 0) return;
    }
    stops[r] = base;
  }
}

function pickFeature(rng: Rng, heldAny: boolean): Feature {
  const w = heldAny ? [0, 35, 25] : [40, 35, 25];
  return (['HOLD', 'NUDGE', 'STEP'] as const)[rng.weightedIndex(w)];
}

/**
 * START. Charges the stake into the bank, spins the unheld reels (holds only when the HOLD lamp is lit), judges the
 * line against the compensator, applies a STEP square, and on a loss may release a feature.
 * Mutates `core`; the caller pays the line win later (gamble collect) or settles at once when there is none.
 */
export function startSpin(rng: Rng, core: Core, stake: number, luck: number, want: readonly boolean[], holdOdds: number): Spin {
  const F = floatOf(stake, luck);
  const hadHold = core.hold;
  const held = core.hold ? sanitizeHolds(want) : [false, false, false];
  core.hold = false;
  core.locks = held.slice();
  const heldAny = held.some(Boolean);
  // a HOLD is never offered twice in a row: not on a START that already had the lamp, nor after a held spin
  const blockHold = hadHold || heldAny;
  core.bank += RTP * stake;
  const free: number[] = [0, 1, 2].filter((r) => !held[r]);
  const stops = core.stops.slice();
  const over = (): boolean => lineMult(symsOf(stops)) * stake > core.bank + F;
  let redraws = 0, forced = false;
  for (;;) {
    for (const r of free) stops[r] = rng.int(0, STOPS - 1);
    if (!over()) break;
    if (redraws >= REDRAWS) { forced = true; forceLoss(stops, free); break; }
    redraws++;
  }
  core.stops = stops;
  const sy = symsOf(stops);
  const line = lineMult(sy) * stake;
  const squares: SquareHit[] = [];
  if (sy[2] === 'STEP') squares.push(applySquare(core, stake, line, F));
  let release: Feature | null = null;
  if (line === 0 && rng.chance(featureChance(core.bank, stake, holdOdds))) {
    release = pickFeature(rng, blockHold);
    if (release === 'HOLD') core.hold = true;
    else if (release === 'NUDGE') core.nudges = rng.int(NUDGE_MIN, NUDGE_MAX);
    else squares.push(applySquare(core, stake, 0, F));
  }
  return { stops: stops.slice(), syms: sy, held, line, squares, release, redraws, forced };
}

/**
 * NUDGE: moves one unlocked reel down one stop (a press). A nudge that would make a win above B + F is refused.
 * A nudge that lands STEP on the line advances the trail. Consumes one nudge when it succeeds.
 */
export function nudgeReel(core: Core, reel: number, stake: number, luck: number): Nudge {
  const F = floatOf(stake, luck);
  const none = { ok: false, refused: false, stops: core.stops.slice(), line: 0, squares: [] as SquareHit[] };
  if (core.nudges <= 0 || core.locks[reel]) return none;
  const before = symsOf(core.stops);
  const stops = core.stops.slice();
  stops[reel] = (stops[reel] + 1) % STOPS;
  const sy = symsOf(stops);
  const line = lineMult(sy) * stake;
  if (line > core.bank + F) return { ...none, refused: true };
  core.stops = stops;
  core.nudges -= 1;
  const squares: SquareHit[] = [];
  if (reel === 2 && sy[2] === 'STEP' && before[2] !== 'STEP') squares.push(applySquare(core, stake, line, F));
  return { ok: true, refused: false, stops: stops.slice(), line, squares };
}

/** Pay the (collected) amount out of the bank. */
export function pay(core: Core, amount: number): void {
  core.bank -= amount;
}

export function openGamble(rng: Rng, value: number, safety: number): Gamble {
  return { value, shown: rng.int(1, 12), safety };
}

export const canPick = (pick: Pick, shown: number): boolean => (pick === 'HI' ? shown < 12 : shown > 1);

/**
 * One HI/LO guess. Honest draw 1–12. Equal = push. A correct guess climbs the ladder; a climb above B + F is redrawn as
 * a loss. `gambleSafety` (hook count) turns the first loss of each gamble into a push.
 */
export function gambleStep(rng: Rng, g: Gamble, pick: Pick, stake: number, bank: number, luck: number): GambleStep {
  const cap = bank + floatOf(stake, luck);
  let next = rng.int(1, 12);
  let result: 'win' | 'lose' | 'push';
  if (next === g.shown) result = 'push';
  else result = (pick === 'HI') === (next > g.shown) ? 'win' : 'lose';
  let value = g.value;
  if (result === 'win') {
    const up = climb(g.value, stake);
    if (up > cap) {
      result = 'lose';
      next = pick === 'HI' ? rng.int(1, g.shown - 1) : rng.int(g.shown + 1, 12);
    } else value = up;
  }
  let safetyUsed = false;
  if (result === 'lose' && g.safety > 0) { result = 'push'; safetyUsed = true; next = g.shown; }
  if (result === 'lose') value = 0;
  return { result, next, value, safetyUsed };
}

/**
 * Stationary bank quantiles: B / stake before a START (luck 0, holdOdds 1, collect-at-once policy), measured by the RTP
 * sim over 1e6 spins. A headless round has no instance bank, so it draws one from this distribution. The expected
 * payout of a round is then the stationary one, which is the live RTP (88 %).
 */
const BANK_Q: readonly number[] = [-9.96, -4.2, -2, -0.4, 0.92, 2.08, 3.08, 4, 4.88, 5.68, 6.44, 7.2, 7.92, 8.64, 9.32, 10, 10.68, 11.36, 12, 12.68, 13.36, 14.04, 14.76, 15.52, 16.28, 17.12, 18, 18.96, 20.08, 21.4, 23.12, 25.68, 102.28];

/** Inverse of the stationary bank distribution (linear between the 33 quantile points). */
export function stationaryBank(u: number): number {
  const top = BANK_Q.length - 1;
  const x = clamp(u, 0, 1) * top;
  const i = Math.min(top - 1, Math.floor(x));
  return BANK_Q[i] + (BANK_Q[i + 1] - BANK_Q[i]) * (x - i);
}

/** Share of STARTs that begin with the HOLD lamp lit (collect policy, 1e6 spins). */
const HEADLESS_HOLD_P = 0.068;

/** Headless round for staff auto-play: one START from a stationary bank, nudges greedy, the win collected at once. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const stake = Math.max(1, bet);
  const luck = h.luck;
  const holdOdds = h.mod(HOOK.holdOdds, 1);
  const core = newCore(rng.int(1, SQUARES.length));
  core.bank = stationaryBank(rng.next()) * stake;
  // the previous START's state: the HOLD lamp is lit for about 7 % of STARTs; the held pair comes from a losing stop set
  const want = [false, false, false];
  if (rng.next() < HEADLESS_HOLD_P) {
    core.hold = true;
    for (let t = 0; t < 40; t++) {
      core.stops = [rng.int(0, STOPS - 1), rng.int(0, STOPS - 1), rng.int(0, STOPS - 1)];
      if (lineMult(symsOf(core.stops)) === 0) break;
    }
    const sy = symsOf(core.stops);
    if (sy[0] === sy[1]) { want[0] = true; want[1] = true; }
    else if (sy[0] === sy[2]) { want[0] = true; want[2] = true; }
    else if (sy[1] === sy[2]) { want[1] = true; want[2] = true; }
  }
  const sp = startSpin(rng, core, stake, luck, want, holdOdds);
  let gross = 0;
  for (const s of sp.squares) gross += s.cash;
  let win = sp.line;
  while (core.nudges > 0) {
    let best = -1;
    for (let r = 0; r < REELS; r++) {
      const trial = { ...core, stops: core.stops.slice(), locks: core.locks.slice() };
      if (nudgeReel(trial, r, stake, luck).line > 0) { best = r; break; }
    }
    if (best < 0) break;
    const nd = nudgeReel(core, best, stake, luck);
    win += nd.line;
    for (const s of nd.squares) gross += s.cash;
  }
  gross += win;
  return { gross, tags: [...(sp.line > 0 ? ['line'] : []), ...(sp.release ? [`feature:${sp.release}`] : [])] };
};
