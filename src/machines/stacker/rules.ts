/**
 * Stacker — pure rules (MACHINES_machines §16). No three, kit or DOM; every random draw comes from the Rng passed in.
 *
 * Board: 7 columns × 15 rows (row 1 at the bottom). Row r's bar width = min(stack top width, cap(r)), cap = 3 (rows 1–5),
 * 2 (rows 6–10), 1 (rows 11–15), +extraBlock on rows 1–5. The bar bounces across the board; the occupant's press time
 * picks the stop cell from the deterministic `Motion` (seeded per play, per row). Overhang falls; no overlap = lose.
 * Row 10 complete → MINOR (TAKE ×2.5 or CLIMB). Row 15 complete → MAJOR (×25 + a charm capsule).
 *
 * The live machine and `playHeadless` share `Motion`, `settleRow` and the payout maths, so the simulated RTP IS the live
 * RTP for the same press-timing model. Payouts are stochastically rounded (floor(exact + u)): 1-coin stakes stay unbiased.
 */
import { createRng, hashSeed, type Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const COLS = 7;
export const ROWS = 15;
export const MINOR_ROW = 10;
export const MAJOR_ROW = 15;
export const MIN_STAKE = 1;
export const MAX_STAKE = 25;
export const MINOR_MULT = 1.6;
export const MAJOR_MULT = 25;
/**
 * Speed table: row r moves at (SPEED0 + SPEED_STEP·(r−1)) cells/s before luck. The only RTP knob. Tuned in the scratchpad
 * sim so the average-player model (AVG_SIGMA, AVG_TAKE) gives ≈ 70 %. The brief's 5.0 start was ≈ 9 % for that model.
 * Balance note: with MINOR 2.5× a fine-aim expert (σ 0.03) TAKEs reliably, so the 110 % expert ceiling is not met by
 * speed and slip alone (see the sim notes in the balance report).
 */
export const SPEED0 = 1.8;
export const SPEED_STEP = 0.6;
export const LUCK_STEP = 0.02;          // −2 % speed per luck point …
export const LUCK_CAP = 0.2;            // … capped at −20 %
export const JITTER_ROW = 8;            // from this row each traverse is faster/slower and dwells at the edge
export const JITTER = 0.2;              // traverse speed × (1 ± JITTER)
export const SLIP_ROW = 6;              // from this row a seeded slip may jolt the bar (skill-independent width loss)
export const SLIP_P = 0.6;              // chance per row that the bar slips by one cell (width-loss randomness)
export const HIGH_RAMP = 2;             // speed × on rows above MINOR_ROW (expert ceiling: fast top rows punish fine aim less than luck)
export const SLIP_T = 1.2;              // slip lands at a seeded time in [0, SLIP_T) s after the row starts
export const DWELL_MAX = 0.12;          // edge dwell 0–120 ms
export const COLLAPSE_P = 0.03;         // skill-independent per-row collapse chance (rows 1..MINOR_ROW), was 0.09
export const DECIDE_S = 5;             // MINOR decision window (default TAKE)
export const ROW_GAP_S = 0.45;          // fall + beat between rows

export const HOOK_EXTRA = 'x.stacker.extraBlock' as ModHook;   // +1 width rows 1–5 (Brass Knuckles)
export const HOOK_SAVE = 'm.stacker.saveCell' as ModHook;      // > 0: the first falling overhang cell is caught, once
export const HOOK_MINOR = 'm.stacker.minorMult' as ModHook;    // × on the MINOR take (base 1)
export const HOOK_CHARM = 'm.stacker.majorCharm' as ModHook;   // capsule rarity +N (base 0)

/** Target RTP for an average player (informational; the sim checks the average-player model, see scratchpad). */
export const RTP = 0.70;

/** Half-open column span [a, b) of the stack top. */
export interface Seg { a: number; b: number }

export interface RowOut {
  ok: boolean;
  /** Stop cell (left column of the bar). */
  cs: number;
  /** Columns that stay (the new top). */
  kept: number[];
  /** Columns that fall. */
  fell: number[];
  /** The first falling cell was caught by saveCell. */
  saved: boolean;
  /** New top, null when the row missed. */
  seg: Seg | null;
}

/** Bar width cap for a row (before extraBlock). */
export function rowCap(row: number): number {
  return row <= 5 ? 3 : row <= MINOR_ROW ? 2 : 1;
}

/** Bar width of `row` given the current top width (null on row 1). */
export function rowWidth(row: number, topW: number | null, extra: number): number {
  const cap = rowCap(row) + (row <= 5 ? Math.max(0, Math.round(extra)) : 0);
  return topW === null ? cap : Math.min(topW, cap);
}

/** Bar speed in cells/s for `row` at `luck` points. */
export function speedOf(row: number, luck: number): number {
  const cut = Math.min(LUCK_CAP, Math.max(0, luck) * LUCK_STEP);
  return (SPEED0 + SPEED_STEP * (row - 1)) * (row > MINOR_ROW ? HIGH_RAMP : 1) * (1 - cut);
}

interface Leg { t0: number; t1: number; end: number; from: number; to: number }

/**
 * The bar's left edge over time for one row: an alternating sweep between the two edges of [0, COLS − w]. Row 1 starts on
 * the left and the side alternates each row. From JITTER_ROW each traverse's speed and each edge dwell are drawn from the
 * (seed, row) stream, so the motion is identical on every peer and for the live press and the sim. Legs are generated
 * lazily in order, so query order never changes the result.
 */
export class Motion {
  private readonly rng: Rng;
  private readonly span: number;
  private readonly speed: number;
  private readonly jit: boolean;
  private readonly start: number;
  private readonly legs: Leg[] = [];
  private cursor = 0;
  private edge: number;
  /** Slip (skill-independent width loss): from SLIP_ROW a seeded jolt moves the bar by one cell at `slipAt` s. */
  private slipAt = Infinity;
  private slipBy = 0;

  constructor(seed: number, row: number, w: number, speed: number) {
    this.rng = createRng(hashSeed(seed, row, 'stacker'));
    this.span = COLS - w;
    this.speed = Math.max(0.1, speed);
    this.jit = row >= JITTER_ROW;
    this.start = row % 2 === 1 ? 0 : this.span;
    this.edge = this.start;
    if (row >= SLIP_ROW && this.rng.next() < SLIP_P) {
      this.slipAt = this.rng.next() * SLIP_T;
      this.slipBy = this.rng.next() < 0.5 ? -1 : 1;
    }
  }

  /** Largest left-edge column (COLS − w). */
  get max(): number { return this.span; }

  private grow(t: number): void {
    while (this.legs.length === 0 || this.legs[this.legs.length - 1].end <= t) {
      const from = this.edge, to = this.span - from;
      const m = this.jit ? 1 + (this.rng.next() * 2 - 1) * JITTER : 1;
      const dwell = this.jit ? this.rng.next() * DWELL_MAX : 0;
      const t0 = this.cursor;
      const t1 = t0 + (this.span > 0 ? this.span / (this.speed * m) : 0);
      const end = t1 + dwell;
      this.legs.push({ t0, t1, end, from, to });
      this.cursor = end;
      this.edge = to;
    }
  }

  /** Continuous left edge at `t` seconds after the row started. */
  posAt(t: number): number {
    const base = this.baseAt(t);
    if (t < this.slipAt) return base;
    return Math.min(this.span, Math.max(0, base + this.slipBy));
  }

  private baseAt(t: number): number {
    if (t <= 0) return this.start;
    this.grow(t);
    for (const L of this.legs) {
      if (t < L.end) return t < L.t1 ? L.from + (L.to - L.from) * ((t - L.t0) / (L.t1 - L.t0)) : L.to;
    }
    return this.legs[this.legs.length - 1].to;
  }

  /** First time (s) the left edge equals `target` (an integer column in [0, max]). */
  firstAt(target: number): number {
    if (target === this.start) return 0;
    this.grow(0);
    const L = this.legs[0];
    return L.t0 + ((target - L.from) / (L.to - L.from)) * (L.t1 - L.t0);
  }
}

/** Stop cell for a press `tp` seconds into the row (nearest column, clamped). */
export function stopCell(m: Motion, tp: number): number {
  return Math.min(m.max, Math.max(0, Math.round(m.posAt(tp))));
}

/**
 * Resolve one stop against the current top. Row 1 (`top` null) keeps the whole bar. Otherwise the kept columns are the
 * overlap of the bar with the top and the rest falls. `saveAvail`: the first falling cell next to the top is caught.
 */
export function settleRow(top: Seg | null, cs: number, w: number, saveAvail: boolean): RowOut {
  const span = (lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (let c = lo; c < hi; c++) out.push(c);
    return out;
  };
  if (top === null) return { ok: true, cs, kept: span(cs, cs + w), fell: [], saved: false, seg: { a: cs, b: cs + w } };
  let lo = Math.max(cs, top.a), hi = Math.min(cs + w, top.b);
  if (hi <= lo) return { ok: false, cs, kept: [], fell: span(cs, cs + w), saved: false, seg: null };
  let saved = false;
  if (saveAvail && (lo > cs || hi < cs + w)) {
    if (lo > cs) lo -= 1; else hi += 1;      // left overhang first, else right
    saved = true;
  }
  const fell = [...span(cs, lo), ...span(hi, cs + w)];
  return { ok: true, cs, kept: span(lo, hi), fell, saved, seg: { a: lo, b: hi } };
}

/**
 * Skill-independent collapse: on rows 1..MINOR_ROW the stack may give way (a loss) with COLLAPSE_P, whatever the aim.
 * A pure function of (seed, row), so the live machine (which holds the seed, not the sim rng) checks the same roll.
 */
export function collapses(seed: number, row: number): boolean {
  return row <= MINOR_ROW && createRng(hashSeed(seed, row, 'collapse')).next() < COLLAPSE_P;
}

/**
 * Resolve one stop: the collapse roll first (a collapsed row loses the whole bar), then `settleRow`. Shared by `playOnce`
 * and the live machine so both apply the same collapse and the simulated RTP stays the live RTP.
 */
export function resolveStop(seed: number, row: number, top: Seg | null, cs: number, w: number, saveAvail: boolean): RowOut {
  if (collapses(seed, row)) {
    const fell: number[] = [];
    for (let c = cs; c < cs + w; c++) fell.push(c);
    return { ok: false, cs, kept: [], fell, saved: false, seg: null };
  }
  return settleRow(top, cs, w, saveAvail);
}

/** Stochastic rounding of an exact payout: unbiased for fractional stakes. `u` in [0, 1). */
export function roundPrize(exact: number, u: number): number {
  return exact > 0 ? Math.floor(exact + u) : 0;
}

export type Outcome = 'lose' | 'minor' | 'major' | 'forfeit';

/** Average-player timing model for the headless sim: press error σ (s) around the first pass over the target column. */
export const AVG_SIGMA = 0.09;
/** Average player TAKEs the MINOR this fraction of the time (the rest CLIMB). */
export const AVG_TAKE = 0.5;

export interface PlayOpts {
  luck: number;
  extra: number;
  save: boolean;
  minorMult: number;
  sigma: number;
  takeP: number;
  /** Speed table override (sim tuning only); live and headless use `speedOf`. */
  speed?: (row: number, luck: number) => number;
}

export interface PlayResult { gross: number; outcome: Outcome; row: number; capsule: boolean; tags: string[] }

/** One full play under the timing model above. Pure. Draw order: seed, per row (σ noise), MINOR choice, final u. */
export function playOnce(rng: Rng, stake: number, o: PlayOpts): PlayResult {
  const seed = rng.int(1, 0x7fffffff);
  let top: Seg | null = null;
  let save = o.save;
  for (let row = 1; row <= ROWS; row++) {
    const topW = top ? top.b - top.a : null;
    const w = rowWidth(row, topW, o.extra);
    const m = new Motion(seed, row, w, (o.speed ?? speedOf)(row, o.luck));
    const target = top ? top.a + Math.floor((topW! - w) / 2) : Math.floor(m.max / 2);
    const u1 = Math.max(rng.next(), 1e-12), u2 = rng.next();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const cs = stopCell(m, Math.max(0, m.firstAt(target) + o.sigma * gauss));
    const r = resolveStop(seed, row, top, cs, w, save);
    if (r.saved) save = false;
    if (!r.ok) return finish(rng, stake, 0, 'lose', row, false);
    top = r.seg;
    if (row === MAJOR_ROW) return finish(rng, stake, MAJOR_MULT, 'major', row, true);
    if (row === MINOR_ROW && rng.next() < o.takeP) return finish(rng, stake, MINOR_MULT * o.minorMult, 'minor', row, false);
  }
  return finish(rng, stake, 0, 'lose', ROWS, false);
}

function finish(rng: Rng, stake: number, mult: number, outcome: Outcome, row: number, capsule: boolean): PlayResult {
  const gross = roundPrize(stake * mult, rng.next());
  const tags = outcome === 'minor' ? ['stacker:minor'] : outcome === 'major' ? ['stacker:major'] : [];
  return { gross, outcome, row, capsule, tags };
}

/** Headless single play (staff auto-play, bench Sim): the average player, same rules as the live machine. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = playOnce(rng, bet, {
    luck: h.luck, extra: h.mod(HOOK_EXTRA, 0), save: h.mod(HOOK_SAVE, 0) > 0,
    minorMult: h.mod(HOOK_MINOR, 1), sigma: AVG_SIGMA, takeP: AVG_TAKE,
  });
  return { gross: r.gross, tags: r.tags };
};
