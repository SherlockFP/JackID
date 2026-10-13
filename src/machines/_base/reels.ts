/**
 * Reel helpers (base-machines WP). Contract: TECH_SPEC §3.7. Pure functions over symbol strips: weighted stops
 * (with a bias hook for luck / charm weights), visible windows, payline and pattern evaluation, and outcome-first
 * helpers (find the stop that shows a symbol) so logic can pick the result and the reels animate to it.
 *
 * Conventions
 *  - A `Strip` is a circular list of symbols. `weights[i]` (default 1) is how likely stop `i` is.
 *  - A STOP is the strip index sitting ON THE PAYLINE (the middle row; the lower-middle row for even heights).
 *    `windowOf(strip, stop, rows)` returns the visible symbols top → bottom around it.
 *  - A GRID is column-major: `grid[reel][row]`, row 0 on top. A payline `line[reel] = row`.
 *  - `pays[symbol][n]` = multiplier for exactly `n` matching symbols from the left (index = count; sparse zeros ok),
 *    e.g. `pays.cherry = [0, 0, 2, 5]` → two cherries ×2, three ×5.
 */
import type { Rng } from '@/core/rng';
import type { SymbolId } from '@/core/texgen/types';

export interface Strip { symbols: SymbolId[]; weights?: number[] }
export interface LineWin { line: number; symbol: SymbolId; count: number; mult: number }
export interface PatternDef { id: string; cells: Array<[c: number, r: number]>; mult: number }
export interface PatternWin { id: string; symbol: SymbolId; mult: number }

/**
 * One stop index per reel. `bias(reel, symbol)` multiplies that symbol's weight (≥ 0): luck charms, tycoon
 * `symbolWeight` hooks, near-miss shaping. Cost: O(strip length) per reel, no allocation besides the result.
 */
export function spin(rng: Rng, strips: readonly Strip[], bias?: (reel: number, symbol: SymbolId) => number): number[] {
  return strips.map((s, reel) => {
    const n = s.symbols.length;
    if (!bias && !s.weights) return rng.int(0, n - 1);
    let total = 0;
    for (let i = 0; i < n; i++) total += Math.max(0, (s.weights?.[i] ?? 1) * (bias ? bias(reel, s.symbols[i]) : 1));
    if (total <= 0) return rng.int(0, n - 1);
    let r = rng.next() * total;
    for (let i = 0; i < n; i++) {
      const w = Math.max(0, (s.weights?.[i] ?? 1) * (bias ? bias(reel, s.symbols[i]) : 1));
      if (r < w) return i;
      r -= w;
    }
    return n - 1;
  });
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Visible symbols top → bottom for `rows` rows with the payline at `payRow` (default: the middle). */
export function windowOf(strip: Strip, stop: number, rows: number, payRow = Math.floor(rows / 2)): SymbolId[] {
  const n = strip.symbols.length, out: SymbolId[] = new Array<SymbolId>(rows);
  for (let r = 0; r < rows; r++) out[r] = strip.symbols[wrap(stop - payRow + r, n)];
  return out;
}

/** The full column-major grid for the given stops. */
export function gridOf(strips: readonly Strip[], stops: readonly number[], rows: number): SymbolId[][] {
  return strips.map((s, c) => windowOf(s, stops[c], rows));
}

/** Probability (0..1) that `symbol` is the stop of this strip, under optional weights. */
export function stopChance(strip: Strip, symbol: SymbolId): number {
  let hit = 0, total = 0;
  for (let i = 0; i < strip.symbols.length; i++) {
    const w = strip.weights?.[i] ?? 1;
    total += w;
    if (strip.symbols[i] === symbol) hit += w;
  }
  return total > 0 ? hit / total : 0;
}

/** All stop indices of `symbol` on the strip. */
export function stopsOf(strip: Strip, symbol: SymbolId): number[] {
  const out: number[] = [];
  strip.symbols.forEach((s, i) => { if (s === symbol) out.push(i); });
  return out;
}

/**
 * Outcome-first: pick a stop on `strip` that shows `symbol` on the payline (random among the matches with `rng`,
 * or the first when `rng` is omitted). Returns −1 when the strip has no such symbol.
 */
export function findStop(strip: Strip, symbol: SymbolId, rng?: Rng): number {
  const hits = stopsOf(strip, symbol);
  if (hits.length === 0) return -1;
  return rng ? rng.pick(hits) : hits[0];
}

/** How many cells of `grid` show `symbol` (scatter counts). */
export function countSymbol(grid: readonly (readonly SymbolId[])[], symbol: SymbolId): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === symbol) n++;
  return n;
}

/**
 * Left-to-right line evaluation. The first non-wild symbol on a line defines the winning symbol; wilds (`wild`)
 * substitute for it. A line made only of wilds pays as `pays[wild]` when the table has it. Only winning lines
 * (mult > 0) are returned, in line order.
 */
export function evalLines(
  grid: readonly (readonly SymbolId[])[],
  lines: readonly (readonly number[])[],
  pays: Readonly<Record<string, readonly number[]>>,
  wild?: SymbolId,
): LineWin[] {
  const out: LineWin[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let target: SymbolId | null = null;
    let count = 0, wilds = 0;
    for (let c = 0; c < grid.length; c++) {
      const s = grid[c][line[c]];
      if (wild !== undefined && s === wild) { count++; if (target === null) wilds++; continue; }
      if (target === null) { target = s; count++; continue; }
      if (s === target) count++; else break;
    }
    let best: LineWin | null = null;
    if (target !== null) {
      const m = pays[target]?.[count] ?? 0;
      if (m > 0) best = { line: li, symbol: target, count, mult: m };
    }
    if (wild !== undefined && wilds > 0) {                           // leading wilds may pay better as wilds
      const m = pays[wild]?.[wilds] ?? 0;
      if (m > 0 && (!best || m > best.mult)) best = { line: li, symbol: wild, count: wilds, mult: m };
    }
    if (best) out.push(best);
  }
  return out;
}

/**
 * Fixed-shape evaluation ("pattern slot"): a pattern wins when every one of its cells shows the same symbol
 * (wilds substitute). The result multiplier is `pattern.mult` × `symbolMult[symbol]` (default 1).
 */
export function evalPatterns(
  grid: readonly (readonly SymbolId[])[],
  patterns: readonly PatternDef[],
  wild?: SymbolId,
  symbolMult?: Readonly<Record<string, number>>,
): PatternWin[] {
  const out: PatternWin[] = [];
  for (const p of patterns) {
    let target: SymbolId | null = null, ok = true;
    for (const [c, r] of p.cells) {
      const s = grid[c]?.[r];
      if (s === undefined) { ok = false; break; }
      if (wild !== undefined && s === wild) continue;
      if (target === null) target = s; else if (s !== target) { ok = false; break; }
    }
    if (!ok) continue;
    const symbol = target ?? wild ?? '';
    out.push({ id: p.id, symbol, mult: p.mult * (symbolMult?.[symbol] ?? 1) });
  }
  return out;
}

/**
 * Near-miss detector for tease effects: exactly one reel of the line breaks an otherwise matching line of
 * `need` (default: all) reels. Returns the reel index that "just missed", or −1.
 */
export function nearMissLine(
  grid: readonly (readonly SymbolId[])[],
  line: readonly number[],
  symbol: SymbolId,
  need = grid.length,
  wild?: SymbolId,
): number {
  let hits = 0, missReel = -1;
  for (let c = 0; c < grid.length; c++) {
    const s = grid[c][line[c]];
    if (s === symbol || (wild !== undefined && s === wild)) hits++;
    else if (missReel < 0) missReel = c;
    else return -1;
  }
  return hits === need - 1 && missReel >= 0 ? missReel : -1;
}
