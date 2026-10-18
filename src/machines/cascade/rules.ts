/**
 * Gilded Cascade (`cascade`) — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the
 * headless play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * A 6 × 5 grid of nine casino symbols plus two specials: the SCATTER (the house wheel) and the multiplier ORB (x2 .. x50).
 * Eight or more of the same symbol ANYWHERE pay. Every paying symbol bursts, what is left falls, new symbols drop in from
 * the top and the grid is read again (a tumble). The tumbles go on while anything pays. Scatters and orbs never burst:
 * they sit where they landed until the spin is over.
 *
 *  - BASE spin: when the tumbles are over and something paid, the orbs on the grid add up and multiply the whole spin.
 *  - 4 or more scatters on the grid at the end: pays 3x / 5x / 100x the bet (4 / 5 / 6+) and opens the FREE ROUND, 15 spins.
 *  - FREE spins: every orb adds to one TOTAL multiplier that never goes down inside the round (a spin with orbs and no
 *    win still adds). Every winning spin is multiplied by the total (when it is above 0). 3 scatters add 5 spins.
 *  - The whole round (base spin and free spins) is capped at 5000x the bet.
 *
 * Money is counted in HALF-bets ("H" units) so every pay is a whole number for an even bet. Every roll goes through the
 * `rng` argument: no hidden state, no wall clock.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const COLS = 6;
export const ROWS = 5;
export const CELLS = COLS * ROWS;
/** The cell at (col, row): column-major, row 0 = the top. */
export const at = (col: number, row: number): number => col * ROWS + row;

/** Paying symbols, id 0..8, low to high. */
export const SYMS = ['dice', 'chip', 'key', 'card', 'ring', 'watch', 'mask', 'bag', 'coin'] as const;
export const SYM_N = SYMS.length;
/** Cell codes beyond the nine symbols. */
export const SCATTER = 9;
export const ORB_AT = 100;                       // an orb of value v is the code 100 + v
export const isOrb = (c: number): boolean => c >= ORB_AT;
export const orbValue = (c: number): number => c - ORB_AT;
export const isSym = (c: number): boolean => c >= 0 && c < SYM_N;

export const MIN_CLUSTER = 8;
/** Pay in half-bets by [8-9, 10-11, 12+] matching symbols. */
export const PAY_H: readonly (readonly [number, number, number])[] = [
  [1, 1, 4],        // dice   0.5x  0.5x  2x
  [1, 2, 8],        // chip   0.5x  1x    4x
  [1, 2, 10],       // key    0.5x  1x    5x
  [2, 3, 16],       // card   1x    1.5x  8x
  [2, 3, 20],       // ring   1x    1.5x  10x
  [3, 4, 24],       // watch  1.5x  2x    12x
  [4, 10, 30],      // mask   2x    5x    15x
  [5, 20, 50],      // bag    2.5x  10x   25x
  [20, 50, 100],    // coin   10x   25x   50x
];
/** Drawing weights of the nine symbols (the low ones are common). */
export const SYM_W: readonly number[] = [15, 14, 13, 12, 11, 9, 8, 5, 3];
const SYM_W_SUM = SYM_W.reduce((a, b) => a + b, 0);

/** Orb values and their weights. */
export const ORB_VALUES: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50];
export const ORB_W: readonly number[] = [300, 220, 160, 120, 80, 50, 30, 20, 12, 6, 3, 1];
const ORB_W_SUM = ORB_W.reduce((a, b) => a + b, 0);

/** Chance a freshly dropped cell is a scatter / an orb (base spin, free spin). */
export const P_SCATTER = 0.017;
export const P_ORB: readonly [number, number] = [0.0045, 0.031];

export const FREE_SPINS = 15;
export const RETRIGGER_SPINS = 5;
export const RETRIGGER_AT = 3;
export const TRIGGER_AT = 4;
export const MAX_FREE_SPINS = 60;
/** Scatter pay in half-bets by count 4, 5, 6+. */
export const SCATTER_H: readonly [number, number, number] = [6, 10, 200];
export const CAP_X = 5000;
export const CAP_H = CAP_X * 2;
export const MAX_TUMBLES = 40;

export const BET_STEPS: readonly number[] = [2, 4, 10, 20, 50, 100, 200];

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK = {
  freeSpins: 'm.cascade.freeSpins' as ModHook,
};
/** Orb chance bonus from luck: x(1 + 0.02 L), capped at x1.5. */
export const luckOrb = (luck: number): number => Math.min(1.5, Math.max(1, 1 + 0.02 * luck));
export const extraSpins = (n: number): number => Math.max(0, Math.min(5, Math.floor(n)));

export type Mode = 0 | 1;      // 0 base spin, 1 free spin

// ── drawing ────────────────────────────────────────────────────────────────────────────────────────
export function pickSym(rng: Rng): number {
  let u = rng.next() * SYM_W_SUM;
  for (let i = 0; i < SYM_N; i++) { u -= SYM_W[i]; if (u < 0) return i; }
  return SYM_N - 1;
}
export function pickOrb(rng: Rng): number {
  let u = rng.next() * ORB_W_SUM;
  for (let i = 0; i < ORB_VALUES.length; i++) { u -= ORB_W[i]; if (u < 0) return ORB_VALUES[i]; }
  return ORB_VALUES[0];
}
/** One freshly dropped cell. `lo` = the luck factor on the orb chance. */
export function drawCell(rng: Rng, mode: Mode, lo = 1): number {
  const u = rng.next();
  if (u < P_SCATTER) return SCATTER;
  if (u < P_SCATTER + P_ORB[mode] * lo) return ORB_AT + pickOrb(rng);
  return pickSym(rng);
}

// ── paying ─────────────────────────────────────────────────────────────────────────────────────────
export const tierOf = (count: number): 0 | 1 | 2 => (count >= 12 ? 2 : count >= 10 ? 1 : 0);
export const payFor = (sym: number, count: number): number => (count >= MIN_CLUSTER ? PAY_H[sym][tierOf(count)] : 0);
export const scatterPay = (n: number): number => (n >= 6 ? SCATTER_H[2] : n === 5 ? SCATTER_H[1] : n === 4 ? SCATTER_H[0] : 0);

/** A paying symbol in one tumble: [symbol, how many, pay in H]. */
export type Hit = [sym: number, count: number, h: number];
export type Step = { hits: Hit[]; fill: number[] };

/** The symbols that pay on this grid. */
export function findHits(grid: readonly number[]): Hit[] {
  const n = new Array<number>(SYM_N).fill(0);
  for (let i = 0; i < CELLS; i++) { const c = grid[i]; if (c >= 0 && c < SYM_N) n[c]++; }
  const hits: Hit[] = [];
  for (let s = 0; s < SYM_N; s++) if (n[s] >= MIN_CLUSTER) hits.push([s, n[s], payFor(s, n[s])]);
  return hits;
}

/**
 * Burst the paying symbols, let the rest fall to the bottom of their column and put `fill` in from the top (column by
 * column, top row first). Returns the new grid. Pure: the presenter replays a spin with the same call.
 */
export function applyStep(grid: readonly number[], hits: readonly Hit[], fill: readonly number[]): number[] {
  const gone = new Set(hits.map((h) => h[0]));
  const out = new Array<number>(CELLS);
  let f = 0;
  for (let c = 0; c < COLS; c++) {
    const keep: number[] = [];
    for (let r = 0; r < ROWS; r++) { const v = grid[at(c, r)]; if (!gone.has(v)) keep.push(v); }
    const fresh = ROWS - keep.length;
    for (let r = 0; r < fresh; r++) out[at(c, r)] = fill[f++];
    for (let r = 0; r < keep.length; r++) out[at(c, fresh + r)] = keep[r];
  }
  return out;
}

export type SpinResult = {
  mode: Mode;
  g0: number[];
  steps: Step[];
  grid: number[];
  /** Sum of the tumble pays, H, before any multiplier. */
  base: number;
  orbs: number;
  scatters: number;
  scatterH: number;
  /** The multiplier the spin was paid with (1 when none). */
  mult: number;
  /** Free spins only: the running total multiplier AFTER this spin's orbs. */
  total: number;
  /** What the spin pays, H (multiplied tumbles + scatter pay), after the round cap. */
  win: number;
  capped: boolean;
};

/**
 * One spin from a fresh grid. `total` = the free-round multiplier so far (0 in the base game). `room` = what is left
 * under the round cap, H. Pure given the rng.
 */
export function playSpin(rng: Rng, mode: Mode, total: number, lo: number, room: number): SpinResult {
  const g0: number[] = new Array(CELLS);
  for (let i = 0; i < CELLS; i++) g0[i] = drawCell(rng, mode, lo);
  let grid = g0;
  const steps: Step[] = [];
  let base = 0;
  for (let n = 0; n < MAX_TUMBLES; n++) {
    const hits = findHits(grid);
    if (!hits.length) break;
    let cleared = 0;
    for (const h of hits) { cleared += h[1]; base += h[2]; }
    const fill: number[] = new Array(cleared);
    for (let i = 0; i < cleared; i++) fill[i] = drawCell(rng, mode, lo);
    steps.push({ hits, fill });
    grid = applyStep(grid, hits, fill);
  }
  let orbs = 0, scatters = 0;
  for (let i = 0; i < CELLS; i++) { const c = grid[i]; if (c >= ORB_AT) orbs += c - ORB_AT; else if (c === SCATTER) scatters++; }
  let mult = 1;
  let after = total;
  if (mode === 1) { after = total + orbs; mult = Math.max(1, after); } else if (base > 0 && orbs > 0) mult = orbs;
  const scatterH = scatterPay(scatters);
  let win = base * mult + scatterH;
  let capped = false;
  if (win >= room) { win = room; capped = true; }
  return { mode, g0, steps, grid, base, orbs, scatters, scatterH, mult, total: after, win, capped };
}

// ── the free round ─────────────────────────────────────────────────────────────────────────────────
export type Feature = { left: number; played: number; total: number; won: number; spins: number };

export function startFeature(extra = 0): Feature {
  return { left: FREE_SPINS + extraSpins(extra), played: 0, total: 0, won: 0, spins: FREE_SPINS + extraSpins(extra) };
}

/** Fold one free spin into the feature. Returns the extra spins awarded (0 or RETRIGGER_SPINS). */
export function advanceFeature(f: Feature, r: SpinResult): number {
  f.left -= 1;
  f.played += 1;
  f.total = r.total;
  f.won += r.win;
  let more = 0;
  if (r.scatters >= RETRIGGER_AT && !r.capped && f.spins < MAX_FREE_SPINS) {
    more = Math.min(RETRIGGER_SPINS, MAX_FREE_SPINS - f.spins);
    f.left += more; f.spins += more;
  }
  return more;
}

export type RoundResult = { firstH: number; freeH: number; totalH: number; triggered: boolean; spins: number; capped: boolean; maxTotal: number };

/** A whole round without the show: the base spin and, on 4+ scatters, the free round. */
export function playRound(rng: Rng, luck = 0, extra = 0): RoundResult {
  const lo = luckOrb(luck);
  const first = playSpin(rng, 0, 0, lo, CAP_H);
  let total = first.win;
  let capped = first.capped;
  let freeH = 0, spins = 0, maxTotal = 0;
  const triggered = first.scatters >= TRIGGER_AT && !capped;
  if (triggered) {
    const f = startFeature(extra);
    while (f.left > 0) {
      const r = playSpin(rng, 1, f.total, lo, CAP_H - total);
      advanceFeature(f, r);
      total += r.win; freeH += r.win;
      if (r.capped) { capped = true; break; }
    }
    spins = f.played; maxTotal = f.total;
  }
  return { firstH: first.win, freeH, totalH: total, triggered, spins, capped, maxTotal };
}

/** Coins from H units for an (even) bet. */
export const coinsOf = (h: number, bet: number): number => Math.round((h * bet) / 2);

/** Headless single bet for staff auto-play and balance sims. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = playRound(rng, h.luck, h.mod(HOOK.freeSpins, 0));
  const tags: string[] = [];
  if (r.triggered) tags.push('bonus', 'freespins');
  if (r.capped) tags.push('maxwin');
  return { gross: coinsOf(r.totalH, bet), tags };
};
