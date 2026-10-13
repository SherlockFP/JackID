/**
 * Mines Terminal — pure rules (MACHINES_machines §12). No three, no DOM, no kit: shared by the live machine
 * (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS the live RTP.
 *
 * Rules: a 5×5 field hides `m` mines (1–24). Each safe reveal raises the multiplier
 *   mult(k) = RTP · C(25, k) / C(25 − m, k)           RTP = 0.97, capped at ×CAP (×1000; ×2000 with capRaise).
 * A mine ends the round, unless the round was "defused" (luck): then the first mine you hit is disarmed — shown,
 * the round goes on, no multiplier step. Cash out after ≥ 1 safe reveal; auto cash out when every safe tile is
 * open or the cap is reached.
 *
 * Commit–reveal: `commit()` draws the round seed and the defuse flag at commit time. The layout is a pure function
 * of the seed (`layoutFrom`), and the fairness hash `fairHash(seed)` is shown at commit. The seed and layout are
 * revealed at round end, so anyone can recompute the hash and the mine positions.
 *
 * Draw order (a given seed replays identically): seed (1 draw), defuse (1 draw), then the layout from its own stream.
 */
import { createRng, hashSeed, type Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const CELLS = 25;
export const COLS = 5;
export const MIN_MINES = 1;
export const MAX_MINES = 24;
export const PRESETS: readonly number[] = [1, 3, 5, 10, 24];
export const RTP = 0.97;
export const CAP = 1000;                 // base multiplier cap (×)
export const CAP_RAISED = 2000;          // with the capRaise hook
export const DEFUSE_MAX = 0.30;          // luck "Defuse" ceiling per round
export const IDLE_S = 90;                // idle seconds in PICK → auto cash out (k ≥ 1) or refund (k = 0)
/** Corners of the 5×5 field (edgeBonus). */
const CORNERS = [0, COLS - 1, CELLS - COLS, CELLS - 1];

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_SCAN = 'm.mines.scanner' as ModHook;       // count of marked safe tiles (0 = none, 1 = one)
export const HOOK_EDGE = 'm.mines.edgeBonus' as ModHook;     // + × per revealed safe corner (base 0)
export const HOOK_INSURE = 'm.mines.insurance' as ModHook;   // bust refund, percent of the stake (base 0)
export const HOOK_CAP = 'm.mines.capRaise' as ModHook;       // multiplier cap (base CAP)

/** Headless staff play: fixed mine count and stop point (its RTP is the same for any strategy). */
export const HEADLESS_MINES = 3;
export const HEADLESS_STOP = 3;

export const clampMines = (m: number): number => Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(m)));
export const clampCap = (c: number): number => Math.min(CAP_RAISED, Math.max(CAP, c));
export const clampInsure = (p: number): number => Math.min(100, Math.max(0, p));
export const defuseP = (luck: number): number => Math.min(DEFUSE_MAX, Math.max(0, 0.01 * luck));

/** Binomial coefficient C(n, k) for n ≤ 25 (exact in doubles). */
export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

export interface Opts { edge: number; cap: number }

/**
 * Multiplier after `k` safe reveals with `m` mines (corners = revealed safe corner tiles).
 * 0 for k = 0. Unreachable k (k > 25 − m) returns 0.
 */
export function multAt(k: number, corners: number, m: number, o: Opts): number {
  if (k <= 0) return 0;
  const safe = CELLS - m;
  if (k > safe) return 0;
  const base = (RTP * comb(CELLS, k)) / comb(safe, k);
  return Math.min(o.cap, base + o.edge * corners);
}

/** Every safe tile open, or the cap reached: the round cashes out by itself. */
export function autoCash(k: number, corners: number, m: number, o: Opts): boolean {
  return k >= CELLS - m || (k > 0 && multAt(k, corners, m, o) >= o.cap);
}

export const isCorner = (cell: number): boolean => CORNERS.includes(cell);

/** Cell centre → (row, col); row-major index, row 0 is the back row. */
export const rowOf = (cell: number): number => Math.floor(cell / COLS);
export const colOf = (cell: number): number => cell % COLS;

export interface Commit {
  seed: number;
  /** Bit i set = cell i holds a mine (25-bit mask). */
  mask: number;
  /** Luck "Defuse" roll: the first mine hit this round is disarmed. */
  defuse: boolean;
  /** Fairness hash shown at commit (hex of `fairHash(seed)`). */
  fair: string;
  /** Scanner: one safe cell to mark for the owner (-1 = none). Cosmetic only. */
  scan: number;
}

/** Commitment: a hash of the seed. The layout is recomputable from the seed, so the reveal can be checked. */
export function fairHash(seed: number): string {
  return (hashSeed('mines', seed) >>> 0).toString(16).padStart(8, '0');
}

/** The layout of a round: Fisher–Yates over the 25 cells from the seed's own stream, the first m are mines. */
export function layoutFrom(seed: number, m: number, scanner = false): { mask: number; scan: number } {
  const lr = createRng(seed);
  const order = Array.from({ length: CELLS }, (_, i) => i);
  lr.shuffle(order);
  let mask = 0;
  for (let i = 0; i < m; i++) mask |= 1 << order[i];
  let scan = -1;
  if (scanner) {
    const safe = order.slice(m);
    scan = lr.pick(safe);
  }
  return { mask, scan };
}

/** Commit a round: draws the seed and the defuse roll from `rng`, then derives the layout. */
export function commit(rng: Rng, m: number, luck: number, scanner = false): Commit {
  const seed = rng.int(1, 0x7fffffff);
  const defuse = rng.next() < defuseP(luck);
  const { mask, scan } = layoutFrom(seed, m, scanner);
  return { seed, mask, defuse, fair: fairHash(seed), scan };
}

/** Recomputes a revealed layout from its seed (verifier helper; the same answer on every peer). */
export const verifyLayout = (seed: number, m: number, mask: number): boolean => layoutFrom(seed, m).mask === mask;

/** The board as the rules see it (the live machine keeps the same fields in its state). */
export interface Board {
  m: number;
  mask: number;
  defuse: boolean;
  defused: boolean;
  k: number;
  corners: number;
  revealed: number;   // bitmask of opened cells (safe, defused or mine)
}

export type PickRes = 'safe' | 'mine' | 'defused';
export interface Step { cell: number; res: PickRes; mult: number; k: number; corners: number; defused: boolean }

export const isRevealed = (b: Board, cell: number): boolean => ((b.revealed >> cell) & 1) === 1;

/**
 * Resolve one pick. Precondition: the cell is not revealed yet. Pure: the caller applies the returned step.
 * A defused mine keeps the current multiplier (no step). A bust returns mult 0.
 */
export function pick(b: Board, cell: number, o: Opts): Step {
  if (((b.mask >> cell) & 1) === 0) {
    const k = b.k + 1;
    const corners = b.corners + (isCorner(cell) ? 1 : 0);
    return { cell, res: 'safe', mult: multAt(k, corners, b.m, o), k, corners, defused: b.defused };
  }
  if (b.defuse && !b.defused) {
    return { cell, res: 'defused', mult: multAt(b.k, b.corners, b.m, o), k: b.k, corners: b.corners, defused: true };
  }
  return { cell, res: 'mine', mult: 0, k: b.k, corners: b.corners, defused: b.defused };
}

/** Stake → gross payout with the dust rule: whole coins out, the fraction carried to the next payout. */
export function takeDust(stake: number, mult: number, dust: number): { gross: number; dust: number } {
  const raw = stake * mult + dust;
  const gross = Math.floor(raw + 1e-9);
  return { gross, dust: Math.max(0, raw - gross) };
}

/**
 * One whole round for staff auto-play and sims: commit, then reveal cells in index order (the layout is uniform,
 * so a fixed order is a fair sample). Cashes out at `stopAt` safe reveals (0 = play until auto cash out).
 * Returns the EXACT gross (float, stake 1 = ×1) so sims measure design RTP without rounding noise.
 */
export function playRound(rng: Rng, m: number, stopAt: number, luck: number, o: Opts): {
  mult: number; k: number; outcome: 'cash' | 'bust' | 'auto'; defused: boolean;
} {
  const c = commit(rng, m, luck, false);
  const b: Board = { m, mask: c.mask, defuse: c.defuse, defused: false, k: 0, corners: 0, revealed: 0 };
  for (let cell = 0; cell < CELLS; cell++) {
    const s = pick(b, cell, o);
    b.revealed |= 1 << cell;
    if (s.res === 'mine') return { mult: 0, k: b.k, outcome: 'bust', defused: b.defused };
    b.k = s.k; b.corners = s.corners; b.defused = s.defused;
    if (s.res === 'defused') continue;
    if (autoCash(b.k, b.corners, m, o)) return { mult: s.mult, k: b.k, outcome: 'auto', defused: b.defused };
    if (stopAt > 0 && b.k >= stopAt) return { mult: s.mult, k: b.k, outcome: 'cash', defused: b.defused };
  }
  return { mult: multAt(b.k, b.corners, m, o), k: b.k, outcome: 'auto', defused: b.defused };
}

/** Headless single round (staff auto-play): same rules and draws as the live round, collected at once. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const o: Opts = { edge: Math.max(0, h.mod(HOOK_EDGE, 0)), cap: clampCap(h.mod(HOOK_CAP, CAP)) };
  const r = playRound(rng, HEADLESS_MINES, HEADLESS_STOP, h.luck, o);
  // randomised rounding of the fraction: unbiased whole-coin payout (one draw, always consumed)
  const raw = bet * r.mult;
  const whole = Math.floor(raw);
  const paid = whole + (rng.next() < raw - whole ? 1 : 0);
  const insured = Math.floor((bet * clampInsure(h.mod(HOOK_INSURE, 0))) / 100);   // bust refund, as live
  const tags: string[] = [];
  if (r.outcome === 'bust') tags.push('bust');
  if (r.defused) tags.push('defused');
  return { gross: r.outcome === 'bust' ? insured : paid, tags };
};
