/**
 * The Big One — pure rules (MACHINES §2). Shared by the live machine (`index.ts`) and the headless play contract
 * (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP.
 *
 * No three, kit, DOM or Math.random: every draw comes from the Rng passed in. Grid = 15 int cells, index r·5 + c
 * (r0 top, c0 left). Symbols 0..6 = MOTH TOOTH KEY CANDLE RING CROWN SUN, MAW = 7 (dead cell), GHOST = 8 (wild).
 *
 * Spin order (§2.3, RNG draws in this order): curse roll → fill roll → base grid → GHOST injection → coalesce (luck)
 * → teaser MAWs → (EATEN: curse trio) → hold → evaluate → respin (losing spins only) → payout.
 * Charm hooks use the `x.bigone.*` names the charm data already references (see `buildMods`).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const SUN = 6;
export const MAW = 7;
export const GHOST = 8;
export const SYM_COUNT = 7;
export const SYM_NAMES = ['MOTH', 'TOOTH', 'KEY', 'CANDLE', 'RING', 'CROWN', 'SUN'] as const;
export const BASE_VALUE = [1, 1, 1, 1, 2, 3, 4];
/** Base weights out of 100 for symbols 0..6 (MAW and GHOST are weight 0 unless a charm adds GHOST). */
export const BASE_WEIGHT = [24, 24, 14, 14, 10, 8, 6];
export const CELLS = 15;
export const MIN_STAKE = 1;
export const MAX_STAKE = 100;
/** Hard ceiling on a line payout (x stake, jackpot claims exempt). The best stacked tally sits far below it. */
export const MAX_LINE_MULT = 500;
export const FULL_MULT = 40;
/** FULL pays ×40 × the symbol value (E[value] 1.44, about 1.4 % RTP), plus the meter. Odds 1 in 4 000 before `jackpot.mult`. */
export const FULL_P = 1 / 4000;
/** Meter seed = SEED_STAKES × the ladder cap. */
export const SEED_STAKES = 50;
export const FEED_DEFAULT = 0.01;
export const WILD_CAP = 0.2;
export const MIN_SYMBOLS = 3;
const CURSE_CAP = 0.05;
const TEASER_P = 0.06;
const TEASER2_P = 0.35;
const COALESCE_CAP = 0.3;
const RESPIN_COLS = [3, 4];

export const PATTERN_IDS = [
  'TREY', 'QUAD', 'RAIL', 'PILLAR', 'SLASH', 'VALLEY', 'PEAK', 'CROSS', 'PENTACLE', 'HALO',
  'CLUSTER', 'FULL', 'TWIN_RAILS', 'CORNERSTONE', 'EYE',
] as const;
export type PatternId = (typeof PATTERN_IDS)[number];
/** Patterns tested by cell-set instances (CLUSTER is a flood fill, FULL is the fill roll). */
export type LinePattern = Exclude<PatternId, 'CLUSTER' | 'FULL'>;
export const PATTERN_MULT: Record<PatternId, number> = {
  TREY: 2, QUAD: 4, RAIL: 16, PILLAR: 2, SLASH: 2, VALLEY: 12, PEAK: 12, CROSS: 12, PENTACLE: 18, HALO: 30,
  CLUSTER: 0, FULL: FULL_MULT, TWIN_RAILS: 25, CORNERSTONE: 8, EYE: 5,
};
/** Feel knobs (exported so the headless sim can sweep them; game code never mutates them). */
export const TUNE = {
  /** Chance that a cell equal to a left / upper / upper-diagonal neighbour is drawn once more (fewer clumps = fewer cheap hits). */
  clump: 0.42,
  /** A row pair of this symbol value or more (or any run of 3+) makes the next reel anticipate. */
  teaseValue: 4,
  /** Stacking bonus per tally step: the n-th pattern of a spin (0-based) pays x(1 + combo n). */
  combo: 0.3,
};
const LINES = PATTERN_IDS.filter((p): p is LinePattern => p !== 'CLUSTER' && p !== 'FULL');

const at = (r: number, c: number): number => r * 5 + c;
const rowCells = (r: number): number[] => [0, 1, 2, 3, 4].map((c) => at(r, c));

/** Every instance of a line pattern as cell indices. Counts: TREY 9, QUAD 6, RAIL 3, PILLAR 5, SLASH 6, VALLEY 1 … */
function instancesOf(p: LinePattern): number[][] {
  const out: number[][] = [];
  switch (p) {
    case 'TREY':
      for (let r = 0; r < 3; r++) for (let c = 0; c <= 2; c++) out.push([at(r, c), at(r, c + 1), at(r, c + 2)]);
      break;
    case 'QUAD':
      for (let r = 0; r < 3; r++) for (let c = 0; c <= 1; c++) out.push([at(r, c), at(r, c + 1), at(r, c + 2), at(r, c + 3)]);
      break;
    case 'RAIL':
      for (let r = 0; r < 3; r++) out.push(rowCells(r));
      break;
    case 'PILLAR':
      for (let c = 0; c < 5; c++) out.push([at(0, c), at(1, c), at(2, c)]);
      break;
    case 'SLASH':
      for (let c = 0; c <= 2; c++) {
        out.push([at(0, c), at(1, c + 1), at(2, c + 2)]);
        out.push([at(2, c), at(1, c + 1), at(0, c + 2)]);
      }
      break;
    case 'VALLEY':
      out.push([at(0, 0), at(1, 1), at(2, 2), at(1, 3), at(0, 4)]);
      break;
    case 'PEAK':
      out.push([at(2, 0), at(1, 1), at(0, 2), at(1, 3), at(2, 4)]);
      break;
    case 'CROSS':
      for (let c = 1; c <= 3; c++) out.push([at(1, c), at(0, c), at(2, c), at(1, c - 1), at(1, c + 1)]);
      break;
    case 'PENTACLE':
      out.push([at(0, 0), at(0, 4), at(1, 2), at(2, 0), at(2, 4)]);
      break;
    case 'HALO':
      for (let c = 1; c <= 3; c++) {
        out.push([at(0, c - 1), at(0, c), at(0, c + 1), at(1, c - 1), at(1, c + 1), at(2, c - 1), at(2, c), at(2, c + 1)]);
      }
      break;
    case 'TWIN_RAILS':
      for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) out.push([...rowCells(a), ...rowCells(b)]);
      break;
    case 'CORNERSTONE':
      out.push([at(0, 0), at(0, 4), at(2, 0), at(2, 4)]);
      break;
    case 'EYE': // a diamond ring around an empty centre (the centre cell may be anything)
      for (let c = 1; c <= 3; c++) out.push([at(0, c), at(2, c), at(1, c - 1), at(1, c + 1)]);
      break;
  }
  return out;
}
const INSTANCES = Object.fromEntries(LINES.map((p) => [p, instancesOf(p)])) as Record<LinePattern, number[][]>;

/** 4-connected neighbours of cell `i` (row-major grid). */
export function neighbours(i: number): number[] {
  const r = Math.floor(i / 5), c = i % 5;
  const out: number[] = [];
  if (r > 0) out.push(i - 5);
  if (r < 2) out.push(i + 5);
  if (c > 0) out.push(i - 1);
  if (c < 4) out.push(i + 1);
  return out;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** True when `v` equals an already-drawn neighbour of cell `i`: left, up, up-left or up-right (row-major draw order). */
function touches(g: readonly number[], i: number, v: number): boolean {
  const c = i % 5;
  return (c > 0 && g[i - 1] === v) || (i >= 5 && (g[i - 5] === v || (c > 0 && g[i - 6] === v) || (c < 4 && g[i - 4] === v)));
}

/** Chance that the next spin is EATEN, from spins since the last curse (k). Capped before the charm multiplier. */
export function curseChance(k: number, mult: number): number {
  return Math.min(CURSE_CAP, 0.015 + 0.0025 * Math.max(0, k)) * mult;
}

/** Hook fold: `mod(hook, base)` (the machine mod, or the headless hooks). */
export type Modify = (hook: ModHook, base: number) => number;
export type FeatureOf = (name: string) => boolean;

/** Every charm / milestone input, folded once per spin. */
export interface Mods {
  /** Payout value per symbol 0..6 (base + add, × mult). */
  values: number[];
  /** Draw weights, indexes 0..8 (MAW 7 is always 0). */
  weights: number[];
  /** Additive pattern multiplier per pattern (charm `x.bigone.patternMult`). */
  patAdd: Record<PatternId, number>;
  /** Line patterns that can pay (TWIN RAILS / CORNERSTONE are locked until unlocked). */
  lines: LinePattern[];
  wild: number;
  curse: number;
  fill: number;
  feed: number;
  holdOn: boolean;
  respin: number;
  wardCharges: number;
}

/** Fold charms and milestone features into the spin inputs. Pure: the same `mod` gives the same Mods. */
export function buildMods(mod: Modify, feature: FeatureOf = () => false): Mods {
  const valueMult = Math.max(0, mod('x.bigone.symbolValueMult' as ModHook, 1));
  const banned = SYM_NAMES.map((n) => mod(`x.bigone.symbolBan[${n}]` as ModHook, 0) >= 1);
  // bans in order, never leaving fewer than MIN_SYMBOLS symbols
  let remaining = SYM_COUNT;
  for (let s = 0; s < SYM_COUNT; s++) {
    if (!banned[s]) continue;
    if (remaining > MIN_SYMBOLS) remaining--;
    else banned[s] = false;
  }
  const values = SYM_NAMES.map((n, s) => Math.max(0, BASE_VALUE[s] + mod(`x.bigone.symbolValueAdd[${n}]` as ModHook, 0)) * valueMult);
  const weights = SYM_NAMES.map((n, s) => (banned[s] ? 0 : Math.max(0, BASE_WEIGHT[s] + mod(`x.bigone.symbolWeight[${n}]` as ModHook, 0))));
  weights.push(0, Math.max(0, mod('x.bigone.symbolWeight[GHOST]' as ModHook, 0)));
  const patAll = mod('x.bigone.patternMult' as ModHook, 0);
  const patAdd = Object.fromEntries(PATTERN_IDS.map((p) => [p, mod(`x.bigone.patternMult[${p}]` as ModHook, patAll)])) as Record<PatternId, number>;
  const extra = mod('x.bigone.extraPattern' as ModHook, 0) >= 1;
  const lines = LINES.filter((p) => {
    if (p === 'TWIN_RAILS') return extra || feature('bigone.twinRails');
    if (p === 'CORNERSTONE') return extra || feature('bigone.cornerstone');
    return true;
  });
  return {
    values,
    weights,
    patAdd,
    lines,
    wild: clamp(mod('x.bigone.wildChance' as ModHook, feature('bigone.wild50') ? 0.02 : 0), 0, WILD_CAP),
    curse: Math.max(0, mod('x.bigone.curseChanceMult' as ModHook, 1)),
    fill: Math.max(0, mod('jackpot.mult' as ModHook, 1)),
    feed: Math.max(0, mod('x.bigone.jackpotFeed' as ModHook, feature('bigone.feed15') ? 0.015 : FEED_DEFAULT)),
    holdOn: mod('x.bigone.holdReel' as ModHook, feature('bigone.holdReel') ? 1 : 0) >= 1,
    respin: clamp(mod('x.bigone.respin' as ModHook, 0), 0, 1),
    wardCharges: Math.max(0, Math.floor(mod('x.bigone.curseWard' as ModHook, 0))),
  };
}

/** Weighted pick over `w` (index = symbol). Falls back to the last positive weight. */
export function pickW(rng: Rng, w: readonly number[]): number {
  let total = 0;
  for (const x of w) total += x;
  if (total <= 0) return SUN;
  let x = rng.next() * total;
  let last = SUN;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    last = i;
    x -= w[i];
    if (x < 0) return i;
  }
  return last;
}

/** Concrete symbol of a cell set (GHOST is wild, an all-GHOST set pays as SUN), or -1 when dead or mixed. */
function matchSym(g: readonly number[], cells: readonly number[]): number {
  let s = -1;
  for (const i of cells) {
    const v = g[i];
    if (v === MAW) return -1;
    if (v === GHOST) continue;
    if (s < 0) s = v;
    else if (s !== v) return -1;
  }
  return s < 0 ? SUN : s;
}

const isStrictSubset = (a: readonly number[], b: readonly number[]): boolean =>
  a.length < b.length && a.every((x) => b.includes(x));

export interface Pay { pat: PatternId; sym: number; cells: number[]; raw: number }
export interface Cluster { sym: number; cells: number[]; raw: number }

/** Lines (absorbed as in §2.2), then CLUSTER flood fills (≥ 7, never absorbed). `raw` = value × mult (before stake). */
export function evaluate(g: readonly number[], m: Mods): { pays: Pay[]; clusters: Cluster[]; raw: number } {
  const hits: Array<{ pat: LinePattern; sym: number; cells: number[] }> = [];
  for (const p of m.lines) {
    for (const cells of INSTANCES[p]) {
      const sym = matchSym(g, cells);
      if (sym >= 0) hits.push({ pat: p, sym, cells });
    }
  }
  let raw = 0;
  const pays: Pay[] = [];
  for (const h of hits) {
    if (hits.some((o) => o !== h && o.sym === h.sym && isStrictSubset(h.cells, o.cells))) continue;
    const r = m.values[h.sym] * Math.max(0, PATTERN_MULT[h.pat] + m.patAdd[h.pat]);
    pays.push({ pat: h.pat, sym: h.sym, cells: h.cells, raw: r });
    raw += r;
  }
  const clusters: Cluster[] = [];
  const seen = new Array<boolean>(CELLS).fill(false);
  for (let i = 0; i < CELLS; i++) {
    const v = g[i];
    if (seen[i] || v > SUN) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = true;
    while (stack.length) {
      const j = stack.pop() as number;
      comp.push(j);
      for (const k of neighbours(j)) {
        if (!seen[k] && g[k] === v) { seen[k] = true; stack.push(k); }
      }
    }
    const mult = comp.length - 5 + m.patAdd.CLUSTER;
    if (comp.length >= 7 && mult > 0) {
      const r = m.values[v] * mult;
      clusters.push({ sym: v, cells: comp.sort((a, b) => a - b), raw: r });
      raw += r;
    }
  }
  return { pays, clusters, raw };
}

/** The near-miss tell: the reel that should crawl, and why. */
export interface Tease {
  /** Reel (1..4) that anticipates: the one that would complete the run. */
  reel: number;
  row: number;
  /** Cells already lined up left of `reel` (2 = "two of three", 3 = a trey asking for a quad, 4 = one short of a rail). */
  len: number;
  sym: number;
}

/**
 * Near-miss tell (cosmetic, drives the anticipation crawl): in a row, a run of 2+ equal cells that reads left to right
 * and is cut off by a different cell on the next reel. Only runs that matter qualify: a pair of a valuable symbol
 * (value >= TUNE.teaseValue, or a GHOST pair) or any run of 3+. The longest run wins, then the value, then the earlier
 * reel. The reel that would complete it is the one that slows down, so reels stop left to right as ever.
 */
export function teaseInfo(g: readonly number[], values: readonly number[] = BASE_VALUE): Tease | null {
  let best: Tease | null = null;
  let bestScore = -1;
  for (let r = 0; r < 3; r++) {
    let c = 0;
    while (c < 4) {
      // maximal run of matching cells starting at column c
      let sym = -1;
      let e = c;
      const first = g[at(r, c)];
      if (first === MAW) { c++; continue; }
      sym = first === GHOST ? -1 : first;
      let ok = true;
      while (e + 1 < 5 && ok) {
        const v = g[at(r, e + 1)];
        if (v === MAW) { ok = false; break; }
        if (v === GHOST) { e++; continue; }
        if (sym < 0) { sym = v; e++; continue; }
        if (v === sym) { e++; continue; }
        ok = false;
      }
      const len = e - c + 1;
      const nextReel = e + 1;
      if (len >= 2 && nextReel <= 4) {
        const val = sym < 0 ? values[SUN] : values[sym] ?? 0;
        if (len >= 3 || val >= TUNE.teaseValue) {
          const score = len * 100 + val * 10 - nextReel;
          if (score > bestScore) { bestScore = score; best = { reel: nextReel, row: r, len, sym: sym < 0 ? SUN : sym }; }
        }
      }
      c = Math.max(c + 1, e);
    }
  }
  return best;
}

/** True when a near-miss tell applies (kept for callers that only need the flag). */
export const teaseOf = (g: readonly number[], values: readonly number[] = BASE_VALUE): boolean => teaseInfo(g, values) !== null;

export interface PlayIn {
  mods: Mods;
  luck: number;
  /** Spins since the last EATEN spin (hunger). */
  sinceCurse: number;
  /** A curse ward charge is available (converts an EATEN spin into a normal one). */
  wardOn: boolean;
  /** Jackpot meter before this stake. */
  meter: number;
  /** Ladder cap (meter seed = SEED_STAKES × maxStake). */
  maxStake: number;
  /** Previous grid (used by a held reel). */
  prev: readonly number[];
  /** Reel to hold (0..4) or -1. */
  hold: number;
}

/** One tallied pattern: `raw` = symbol value x pattern multiplier, `combo` = the stacking factor of its place in the tally, `amount` in coins. */
export interface PayOut { pat: PatternId; sym: number; cells: number[]; amount: number; raw: number; combo: number }
export interface ClusterOut { sym: number; cells: number[]; amount: number; raw: number; combo: number }

export interface Outcome {
  grid: number[];
  /** Grid before the luck coalesce pass (sent only when luck > 0), else null. */
  pre: number[] | null;
  coalesced: number[];
  teaser: number[];
  curse: boolean;
  curseCol: number;
  ward: boolean;
  fill: boolean;
  fillSym: number;
  respin: boolean;
  tease: boolean;
  /** The near-miss tell (reel to slow, its row, the run length lined up) or null. */
  teaseAt: Tease | null;
  /** Reel actually held this spin, or -1. */
  hold: number;
  pays: PayOut[];
  clusters: ClusterOut[];
  /** Every paying pattern (lines and clusters) in tally order: smallest first, so the show escalates. */
  tally: PayOut[];
  /** Base gross in coins (before run payout mults). */
  gross: number;
  /** Meter coins paid by FULL. */
  jackpot: number;
  /** Meter after the stake feed, before the payout (presentation). */
  meterFed: number;
  /** Meter after the round. */
  meter: number;
  tags: string[];
}

/** Paying patterns in tally order (smallest raw first, ties keep evaluation order) with the stacking combo applied. */
export function tallyOf(stake: number, pays: readonly Pay[], clusters: readonly Cluster[]): PayOut[] {
  const items = [
    ...pays.map((p) => ({ pat: p.pat as PatternId, sym: p.sym, cells: p.cells, raw: p.raw })),
    ...clusters.map((c) => ({ pat: 'CLUSTER' as PatternId, sym: c.sym, cells: c.cells, raw: c.raw })),
  ].sort((a, b) => a.raw - b.raw);
  return items.map((it, i) => {
    const combo = 1 + TUNE.combo * i;
    return { ...it, combo, amount: Math.floor(stake * it.raw * combo) };
  });
}

/** One spin. Always consumes the same leading draws (curse + fill) so a seed replays identically. */
export function play(rng: Rng, stake: number, s: PlayIn): Outcome {
  const m = s.mods;
  const pCurse = curseChance(s.sinceCurse, m.curse);
  const curseRoll = rng.next();
  const ward = curseRoll < pCurse && s.wardOn;
  const eaten = curseRoll < pCurse && !ward;
  const fillRoll = rng.next();
  const fill = !eaten && fillRoll < FULL_P * m.fill;

  let grid: number[];
  let fillSym = -1;
  let curseCol = -1;
  let pre: number[] | null = null;
  const coalesced: number[] = [];
  const teaser: number[] = [];
  if (fill) {
    fillSym = pickW(rng, m.weights);
    grid = new Array<number>(CELLS).fill(fillSym);
  } else {
    grid = [];
    for (let i = 0; i < CELLS; i++) {
      let v = pickW(rng, m.weights);
      for (let k = 0; k < 2 && TUNE.clump > 0 && touches(grid, i, v) && rng.next() < TUNE.clump; k++) v = pickW(rng, m.weights);
      grid.push(v);
    }
    for (let i = 0; i < CELLS; i++) if (rng.next() < m.wild) grid[i] = GHOST;
    if (s.luck > 0) pre = grid.slice();
    const pCo = Math.min(COALESCE_CAP, 0.01 * Math.max(0, s.luck));
    for (let i = 0; i < CELLS; i++) {
      if (pCo > 0 && rng.next() < pCo) {
        const nb = neighbours(i);
        grid[i] = grid[nb[rng.int(0, nb.length - 1)]];
        coalesced.push(i);
      }
    }
    if (rng.next() < TEASER_P) {
      const i = rng.int(0, CELLS - 1);
      grid[i] = MAW;
      teaser.push(i);
      if (rng.next() < TEASER2_P) {
        const j = rng.int(0, CELLS - 1);
        grid[j] = MAW;
        teaser.push(j);
      }
    }
    if (eaten) {
      curseCol = rng.int(0, 2);
      for (let c = curseCol; c < curseCol + 3; c++) grid[at(1, c)] = MAW;
    }
  }

  const hold = !eaten && !fill && m.holdOn && s.hold >= 0 && s.hold < 5 ? s.hold : -1;
  if (hold >= 0) for (let r = 0; r < 3; r++) grid[at(r, hold)] = s.prev[at(r, hold)] ?? grid[at(r, hold)];

  let pays: Pay[] = [];
  let clusters: Cluster[] = [];
  let raw = 0;
  let respin = false;
  if (!eaten && !fill) {
    ({ pays, clusters, raw } = evaluate(grid, m));
    if (raw === 0 && m.respin > 0 && rng.next() < m.respin) {
      respin = true;
      for (const c of RESPIN_COLS) {
        if (c === hold) continue;
        for (let r = 0; r < 3; r++) grid[at(r, c)] = pickW(rng, m.weights);
      }
      ({ pays, clusters, raw } = evaluate(grid, m));
    }
  }
  const teaseI = !fill && !eaten ? teaseInfo(grid, m.values) : null;
  const tease = teaseI !== null;

  // tally: each pattern is one step of the count-up, smallest first; every later step stacks a combo bonus
  const tally = fill || eaten ? [] : tallyOf(stake, pays, clusters);

  // money: the meter takes its feed on every stake; FULL pays the meter pro rata and reseeds on a full-ladder hit
  const meterFed = s.meter + stake * m.feed;
  let meter = meterFed;
  let gross = 0;
  let jackpot = 0;
  const tags: string[] = [];
  if (fill) {
    const seed = SEED_STAKES * s.maxStake;
    jackpot = Math.floor((meterFed * stake) / s.maxStake);
    const fillValue = m.values[fillSym === GHOST ? SUN : fillSym] ?? 0;
    gross = Math.floor(stake * FULL_MULT * fillValue) + jackpot;
    meter = stake >= s.maxStake ? seed : meterFed - jackpot;
    tags.push('jackpot');
  } else if (!eaten) {
    for (const t of tally) gross += t.amount;
    gross = Math.min(gross, Math.floor(stake * MAX_LINE_MULT));
  }
  const payOut: PayOut[] = tally.filter((t) => t.pat !== 'CLUSTER');
  const clusterOut: ClusterOut[] = tally.filter((t) => t.pat === 'CLUSTER');
  if (fill) {
    const full = { pat: 'FULL' as PatternId, sym: fillSym, cells: Array.from({ length: CELLS }, (_, i) => i), amount: gross, raw: FULL_MULT * (m.values[fillSym === GHOST ? SUN : fillSym] ?? 0), combo: 1 };
    payOut.push(full);
    tally.push(full);
  }
  if (gross > 0) tags.push('win');
  for (const p of payOut) tags.push(`bigone:pattern:${p.pat}`);
  for (const _c of clusterOut) tags.push('bigone:pattern:CLUSTER');
  if (eaten) tags.push('curse');
  if (tease && gross === 0) tags.push('nearmiss');
  return {
    grid, pre, coalesced, teaser, curse: eaten, curseCol, ward, fill, fillSym, respin, tease, teaseAt: teaseI, hold,
    pays: payOut, clusters: clusterOut, tally, gross, jackpot, meterFed, meter, tags,
  };
}

/** Headless single spin for staff auto-play and sims (no hunger state: k is drawn uniformly 0..9, the deadline average). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const mods = buildMods(h.mod);
  const out = play(rng, bet, {
    mods, luck: h.luck, sinceCurse: rng.int(0, 9), wardOn: false, meter: SEED_STAKES * MAX_STAKE,
    maxStake: MAX_STAKE, prev: [], hold: -1,
  });
  return { gross: out.gross, tags: out.tags };
};
