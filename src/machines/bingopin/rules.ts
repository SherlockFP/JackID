/**
 * Bingo Pinball "Tombala Langırtı" (`bingopin`) — pure rules (no three, no DOM, no kit). Shared by the live machine
 * (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS the live RTP (MACHINES §18).
 *
 * Board: 25 holes (hole h = 0..24, number h+1, row-major top → bottom). The player's card is a scrambled 5×5 of the
 * same numbers (`card[cell] = number`). A ball that lands in hole h lights the card cell holding number h+1.
 * Lines (5 rows, 5 columns, 2 diagonals) pay independently: 3 lit ×1, 4 lit ×20, 5 lit ×250 (× lineMult hooks).
 *
 * RNG discipline: `drawHole` draws exactly one number per launch; `nudgeStep` draws exactly two (tilt, then hop).
 * Headless uses the identity card: a uniformly random hole set is invariant under relabelling, so RTP is card-free.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const HOLES = 25;
export const CENTRE = 12;                  // card cell 3,3 (free space)
export const BALLS_PER_GAME = 5;
export const EXTRA_MAX = 3;                // extra balls buyable per game
export const EXTRA_PRICE_K = 1.25;         // price = ceil(1.25 × marginal EV): extras pay back 80 %
export const TILT_STEP = 0.10;             // nudge n tilts with chance 10 % × n
export const HOP_BASE = 0.35;              // a nudge hops into the adjacent free hole with this chance …
export const HOP_LUCK = 0.02;              // … +2 % per luck point …
export const HOP_LUCK_CAP = 0.30;          // … capped at +30 %
export const POWER_MIN_LAUNCH = 5;         // below 5 % the ball rolls back (free relaunch)
export const MEDIUM_POWER = 55;            // auto-launch power (leaving, E key)
export const SOFT_BELOW = 35;              // power < 35 % → SOFT zone
export const HARD_ABOVE = 75;              // power > 75 % → HARD zone
export const ZONE_WEIGHT = 1.8;
export const ROLL_MIN_S = 1.8;
export const ROLL_MAX_S = 2.6;
export const NUDGE_WINDOW_S = 0.8;         // A/D only in the last 0.8 s of the roll

export type PowerZone = 'soft' | 'medium' | 'hard';
/** Base line payouts (× stake) for 3, 4 and 5 lit cells. */
export const LINE_PAY: Readonly<Record<3 | 4 | 5, number>> = { 3: 1, 4: 20, 5: 250 };

/** Card cell indices of the 12 lines: 0–4 rows, 5–9 columns, 10 main diagonal, 11 anti-diagonal. */
export const LINES: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < 5; r++) out.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) out.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  out.push([0, 1, 2, 3, 4].map((i) => i * 5 + i));
  out.push([0, 1, 2, 3, 4].map((i) => i * 5 + (4 - i)));
  return out;
})();

export const IDENTITY_CARD: readonly number[] = Array.from({ length: HOLES }, (_, i) => i + 1);

/** Hook names this machine honours (documented in `def.modHooks`). */
export const HOOK_FREE = 'm.bingopin.freeSpace' as ModHook;
export const HOOK_TILT_GUARD = 'm.bingopin.tiltGuard' as ModHook;
export const HOOK_EXTRA_DISC = 'm.bingopin.extraBallDiscount' as ModHook;
export const HOOK_LINE: readonly ModHook[] = [
  'm.bingopin.lineMult.3' as ModHook, 'm.bingopin.lineMult.4' as ModHook, 'm.bingopin.lineMult.5' as ModHook,
];

export interface Opts {
  luck: number;
  freeSpace: boolean;                                   // centre cell starts lit
  tiltGuard: boolean;                                   // first TILT per game is ignored
  extraDisc: number;                                    // 0..1, off the extra-ball price
  lineMult: readonly [number, number, number];          // × for 3, 4, 5 lit
}

export const DEFAULT_OPTS: Opts = { luck: 0, freeSpace: false, tiltGuard: false, extraDisc: 0, lineMult: [1, 1, 1] };

/** Read the hooks through the run's modifier fold (live and headless alike). */
export function readOpts(mod: (hook: ModHook, base: number) => number, luck: number): Opts {
  return {
    luck,
    freeSpace: mod(HOOK_FREE, 0) > 0,
    tiltGuard: mod(HOOK_TILT_GUARD, 0) > 0,
    extraDisc: Math.min(1, Math.max(0, mod(HOOK_EXTRA_DISC, 0))),
    lineMult: [Math.max(0, mod(HOOK_LINE[0], 1)), Math.max(0, mod(HOOK_LINE[1], 1)), Math.max(0, mod(HOOK_LINE[2], 1))],
  };
}

export function powerZone(power: number): PowerZone {
  if (power < SOFT_BELOW) return 'soft';
  if (power > HARD_ABOVE) return 'hard';
  return 'medium';
}

/** Roll time in seconds for a launch at `power` (0–100 %): 1.8 s at a weak shot, 2.6 s at full power. */
export function rollSeconds(power: number): number {
  return ROLL_MIN_S + (ROLL_MAX_S - ROLL_MIN_S) * Math.min(100, Math.max(0, power)) / 100;
}

export function holeFree(occ: number, h: number): boolean {
  return ((occ >>> h) & 1) === 0;
}

export function freeCount(occ: number): number {
  let n = 0;
  for (let h = 0; h < HOLES; h++) if (holeFree(occ, h)) n++;
  return n;
}

/**
 * One launch: the hole is drawn from the free holes with power-zone weights (SOFT → holes 16–25 ×1.8, HARD → holes 1–10
 * ×1.8, MEDIUM uniform). Consumes exactly one number. Returns the hole index 0..24, or −1 when the board is full.
 */
export function drawHole(rng: Rng, power: number, occ: number): number {
  const free: number[] = [];
  const w: number[] = [];
  const zone = powerZone(power);
  for (let h = 0; h < HOLES; h++) {
    if (!holeFree(occ, h)) continue;
    free.push(h);
    const boosted = (zone === 'soft' && h >= 15) || (zone === 'hard' && h <= 9);
    w.push(boosted ? ZONE_WEIGHT : 1);
  }
  if (free.length === 0) return -1;
  const total = w.reduce((a, b) => a + b, 0);
  const u = rng.next();
  let acc = 0;
  for (let i = 0; i < free.length; i++) {
    acc += w[i] / total;
    if (u < acc) return free[i];
  }
  return free[free.length - 1];
}

/** Card cell mask of lit cells: the cells whose number's hole is occupied, plus the centre under free space. */
export function litCells(card: readonly number[], occ: number, freeSpace: boolean): number {
  let mask = freeSpace ? 1 << CENTRE : 0;
  for (let k = 0; k < HOLES; k++) if (!holeFree(occ, card[k] - 1)) mask |= 1 << k;
  return mask >>> 0;
}

/** Card cell holding the number of hole `h`. */
export function cellOfHole(card: readonly number[], h: number): number {
  for (let k = 0; k < HOLES; k++) if (card[k] === h + 1) return k;
  return -1;
}

export interface LineHit { line: number; n: number }

/** Lines with ≥ 3 lit cells (n = 3, 4 or 5), and the total multiplier they pay (× stake). */
export function linesPay(cellMask: number, o: Pick<Opts, 'lineMult'>): { lines: LineHit[]; mult: number } {
  const lines: LineHit[] = [];
  let mult = 0;
  LINES.forEach((cells, line) => {
    let n = 0;
    for (const k of cells) if ((cellMask >>> k) & 1) n++;
    if (n < 3) return;
    const tier = Math.min(5, n) as 3 | 4 | 5;
    lines.push({ line, n: tier });
    mult += LINE_PAY[tier] * o.lineMult[tier - 3];
  });
  return { lines, mult };
}

/**
 * One nudge (A/D in the last 0.8 s). `n` is this nudge's 1-based index in the game; the tilt chance is 10 % × n (capped at 1)
 * and the first TILT of a game is absorbed when `tiltGuard` is on. Consumes exactly two numbers: tilt, then hop.
 * A hop moves the ball to the neighbouring hole in its row on that side when that hole is free.
 */
export function nudgeStep(
  rng: Rng, hole: number, dir: -1 | 1, occ: number, n: number, o: Pick<Opts, 'luck' | 'tiltGuard'>, guardUsed: boolean,
): { moved: boolean; tilt: boolean; hole: number; guardUsed: boolean } {
  const uTilt = rng.next();
  let tilt = uTilt < Math.min(1, TILT_STEP * n);
  let used = guardUsed;
  if (tilt && o.tiltGuard && !used) { used = true; tilt = false; }
  const uHop = rng.next();
  const p = HOP_BASE + Math.min(HOP_LUCK_CAP, HOP_LUCK * o.luck);
  if (tilt || uHop >= p) return { moved: false, tilt, hole, guardUsed: used };
  const col = (hole % 5) + dir;
  if (col < 0 || col > 4) return { moved: false, tilt, hole, guardUsed: used };
  const target = Math.floor(hole / 5) * 5 + col;
  if (!holeFree(occ, target)) return { moved: false, tilt, hole, guardUsed: used };
  return { moved: true, tilt, hole: target, guardUsed: used };
}

/**
 * Exact marginal expected pay of ONE more MEDIUM ball given the board, in multiples of the game stake
 * (uniform over free holes; a hole whose cell is already lit adds nothing).
 */
export function marginalEV(card: readonly number[], occ: number, freeSpace: boolean, o: Pick<Opts, 'lineMult'>): number {
  const free = freeCount(occ);
  if (free === 0) return 0;
  const base = litCells(card, occ, freeSpace);
  const basePay = linesPay(base, o).mult;
  let sum = 0;
  for (let h = 0; h < HOLES; h++) {
    if (!holeFree(occ, h)) continue;
    const k = cellOfHole(card, h);
    if ((base >>> k) & 1) continue;
    sum += linesPay(base | (1 << k), o).mult - basePay;
  }
  return sum / free;
}

/** Extra-ball price in coins: ceil(1.25 × stake × marginal EV), discounted, at least 1 coin. */
export function extraPrice(card: readonly number[], occ: number, freeSpace: boolean, stake: number, o: Opts): number {
  const ev = marginalEV(card, occ, freeSpace, o) * stake * (1 - o.extraDisc);
  return Math.max(1, Math.ceil(EXTRA_PRICE_K * ev));
}

/**
 * Headless round = five MEDIUM balls, no nudges, no extras (the baseline the RTP sim checks: ≈ 93.5 %).
 * `bet` is the game stake; gross = stake × line multipliers.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const o = readOpts((hook, base) => h.mod(hook, base), h.luck);
  let occ = 0;
  for (let i = 0; i < BALLS_PER_GAME; i++) {
    const hole = drawHole(rng, MEDIUM_POWER, occ);
    if (hole < 0) break;
    occ |= 1 << hole;
  }
  const { lines, mult } = linesPay(litCells(IDENTITY_CARD, occ, o.freeSpace), o);
  return { gross: Math.max(0, mult) * bet, tags: lines.length > 0 ? ['bingo'] : [] };
};
