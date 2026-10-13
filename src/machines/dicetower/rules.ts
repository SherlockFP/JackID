/**
 * Dice Tower "Zar Kulesi" (`dicetower`) — pure rules (no three, kit or DOM). Shared by the live table (`index.ts`) and
 * the headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_machines §13.
 *
 * Two dice, faces 1–6, drawn as weighted integers from one seeded stream per round (`createRng(seed)`), so the seed
 * revealed at RESULT replays the exact roll. Spot ids: `under`, `over`, `lucky7`, `doubles`, `field`, `corners` and
 * `exact:N` (N = 2..6, 8..12). Pays are gross multipliers per coin staked (stake included): 2 = 1:1, 0.5 = half back.
 */
import { createRng, type Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';

export const SEATS = 4;
export const BASE_WEIGHT = 100;
export const CHIP_STEP = 2;            // every stake is a multiple of 2
export const SPOT_MAX = 200;           // per spot, per seat
export const SPOTS_MAX = 4;            // distinct spots per seat
export const PARLAY_RIDES = 3;         // a winning spot rides up to this many rolls
export const RIDE_STEP = 1.05;         // +5 % on every ride
export const LUCKY_MAX_P = 0.3;        // Lucky Chip refund chance cap

export const EXACT_TOTALS: readonly number[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
/** Every spot id, in layout order of the felt print. */
export const SPOTS: readonly string[] = ['under', 'over', 'lucky7', 'doubles', 'field', 'corners', ...EXACT_TOTALS.map((n) => `exact:${n}`)];

/** Gross multiplier of an EXACT spot (31:1, 15:1, 10:1, 7:1, 11:2). */
const EXACT_GROSS: Readonly<Record<number, number>> = { 2: 32, 3: 16, 4: 11, 5: 8, 6: 6.5, 8: 6.5, 9: 8, 10: 11, 11: 16, 12: 32 };
/** Printed pay text per spot (felt print only; not translated). */
export const PAY_TEXT: Readonly<Record<string, string>> = {
  under: '1:1', over: '1:1', lucky7: '9:2', doubles: '9:2', field: '1:1 2:1', corners: '15:1',
  'exact:2': '31:1', 'exact:3': '15:1', 'exact:4': '10:1', 'exact:5': '7:1', 'exact:6': '11:2',
  'exact:8': '11:2', 'exact:9': '7:1', 'exact:10': '10:1', 'exact:11': '15:1', 'exact:12': '31:1',
};

export type Dice = readonly [number, number];

/** Charm modifiers (integers and halves only, so every gross stays a whole coin for even stakes). */
export interface Mods {
  weights: readonly (readonly number[])[];   // two dice × six faces
  fieldTwelve: number;                       // extra gross on FIELD 12 (Field boost: 3:1 → 4)
  sevenAdd: number;                          // extra gross on LUCKY 7 (Seven pay: +1:2)
}
export const defaultMods = (): Mods => ({
  weights: [new Array<number>(6).fill(BASE_WEIGHT), new Array<number>(6).fill(BASE_WEIGHT)],
  fieldTwelve: 0,
  sevenAdd: 0,
});

/** The exact total of an `exact:N` spot (null for any other spot). */
export function exactOf(spot: string): number | null {
  if (!spot.startsWith('exact:')) return null;
  const n = Number(spot.slice(6));
  return EXACT_TOTALS.includes(n) ? n : null;
}
export function isValidSpot(spot: string): boolean {
  return SPOTS.includes(spot);
}

/** Table limit of one spot for one seat (coins). Every spot shares the same cap. */
export const spotLimit = (): { min: number; max: number } => ({ min: CHIP_STEP, max: SPOT_MAX });

/** Gross multiplier per coin staked for a spot on a roll (0 = lost, 0.5 = half back, k = pays (k−1):1). */
export function payMult(spot: string, d: Dice, m: Mods): number {
  const t = d[0] + d[1];
  switch (spot) {
    case 'under': return t < 7 ? 2 : t === 7 ? 0.5 : 0;
    case 'over': return t > 7 ? 2 : t === 7 ? 0.5 : 0;
    case 'lucky7': return t === 7 ? 5.5 + m.sevenAdd : 0;
    case 'doubles': return d[0] === d[1] ? 5.5 : 0;
    case 'field':
      if (t === 2) return 3;
      if (t === 12) return 3 + m.fieldTwelve;
      return t === 3 || t === 4 || t === 9 || t === 10 || t === 11 ? 2 : 0;
    case 'corners': return t === 2 || t === 12 ? 16 : 0;
    default: {
      const n = exactOf(spot);
      return n !== null && n === t ? EXACT_GROSS[n] : 0;
    }
  }
}

/** A winning spot that keeps riding: rolls won so far (1..PARLAY_RIDES−1) and the fresh stake the chain started with. */
export type RideState = { n: number; orig: number };
export interface SpotCtx {
  d: Dice; m: Mods;
  /** Lucky Chip: a losing fresh spot gets its stake back (the caller draws the gate once per seat per roll). */
  refund: boolean;
  /** This seat is the shooter (Shooter bonus applies to its wins). */
  shooter: boolean;
  shooterPct: number;
  /** Parlay charm: wins ride automatically (see `RIDE_STEP`, `PARLAY_RIDES`). */
  parlay: boolean;
}
export interface SpotSettle {
  gross: number;          // coins paid NOW to the seat
  settled: number;        // stake closed this roll (what the wallet tier maths sees)
  carry: number;          // amount riding on the spot for the next roll (0 = none)
  ride: RideState | null; // ride state after this roll (null = spot closed)
}

/**
 * Settles one spot for one roll. `a` is the spot's amount now (the fresh stake, or the carried ride amount when
 * `ride` is set). Integer coins: every stake is even, so the halves above always land on whole coins.
 */
export function settleSpot(spot: string, a: number, ride: RideState | null, c: SpotCtx): SpotSettle {
  const mult = payMult(spot, c.d, c.m);
  let gross = Math.floor(a * mult);
  if (gross <= a) {
    // A riding chain closes here; a half back still pays its half.
    if (ride) return { gross, settled: ride.orig, carry: 0, ride: null };
    if (c.refund && gross < a) gross = a;
    return { gross, settled: a, carry: 0, ride: null };
  }
  if (c.shooter && c.shooterPct > 0) gross = a + Math.floor((gross - a) * (1 + c.shooterPct / 100));
  if (!c.parlay) return { gross, settled: ride ? ride.orig : a, carry: 0, ride: null };
  gross = Math.floor(gross * RIDE_STEP);
  const n = (ride?.n ?? 0) + 1;
  const orig = ride?.orig ?? a;
  if (n < PARLAY_RIDES) return { gross: 0, settled: 0, carry: gross, ride: { n, orig } };
  return { gross, settled: orig, carry: 0, ride: null };
}

/** Lucky Chip refund chance for a luck value (per seat, per roll). */
export const luckP = (luck: number): number => Math.min(LUCKY_MAX_P, Math.max(0, luck) * 0.01);

/** Public round commitment: FNV-1a 32 of the seed, hex. Published at LOCK, the seed itself is revealed at RESULT. */
export function commitOf(seed: number): string {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface RoundRoll { d: Dice; gates: number[]; path: number }
/** One round's dice, the per-seat Lucky Chip gates and the seed of the tumble path. Same draws for any charm set. */
export function rollRound(seed: number, m: Mods): RoundRoll {
  const rng = createRng(seed);
  return rollWith(rng, m);
}
function rollWith(rng: Rng, m: Mods): RoundRoll {
  const d1 = rng.weightedIndex(m.weights[0]) + 1;
  const d2 = rng.weightedIndex(m.weights[1]) + 1;
  const gates: number[] = [];
  for (let s = 0; s < SEATS; s++) gates.push(rng.next());
  const path = rng.int(1, 0x7fffffff);
  return { d: [d1, d2], gates, path };
}

/** Headless round for staff auto-play and balance sims: one random spot, riding to its end like the live table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const m: Mods = {
    weights: [new Array<number>(6).fill(BASE_WEIGHT), new Array<number>(6).fill(BASE_WEIGHT)],
    fieldTwelve: h.mod('m.dicetower.fieldBoost', 0) > 0 ? 1 : 0,
    sevenAdd: h.mod('m.dicetower.sevenPay', 0) > 0 ? 0.5 : 0,
  };
  const spot = rng.pick(SPOTS);
  const parlay = h.mod('m.dicetower.parlay', 0) > 0;
  const p = luckP(h.luck);
  let a = bet;
  let ride: RideState | null = null;
  let gross = 0;
  for (let i = 0; i < PARLAY_RIDES; i++) {
    const r = rollWith(rng, m);
    const s = settleSpot(spot, a, ride, { d: r.d, m, refund: r.gates[0] < p, shooter: false, shooterPct: 0, parlay });
    gross += s.gross;
    if (s.carry <= 0) break;
    a = s.carry;
    ride = s.ride;
  }
  return { gross, tags: [] };
};
