/**
 * European Roulette "The Bone Wheel" — pure rules (no three, kit or DOM). Shared by the live table (`index.ts`) and the
 * headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_tables §2.
 *
 * Single zero, 37 pockets. Spots are string ids (`straight:17`, `split:4-7`, `street:3`, `trio:0-2-3`, `corner:5`,
 * `first4`, `line:2`, `col:1`, `doz:2`, `red`, `black`, `odd`, `even`, `low`, `high`). Even-money spots use la partage:
 * when 0 lands, half the stake comes back. Every draw is a weighted integer pick; hooks only add integer weight.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';

export const POCKETS = 37;
/** European wheel order, clockwise seen from above, starting at 0. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_SET = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const WHEEL_POS: number[] = [];
WHEEL_ORDER.forEach((n, i) => { WHEEL_POS[n] = i; });

export type PocketColor = 'green' | 'red' | 'black';
export const colorOf = (n: number): PocketColor => (n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black');

/** Wheel-distance (pockets, around the rim) between two pockets. */
export function wheelDist(a: number, b: number): number {
  const d = Math.abs(WHEEL_POS[a] - WHEEL_POS[b]);
  return Math.min(d, POCKETS - d);
}
/** The pocket `k` places away on the wheel (negative = anticlockwise). */
export const wheelAt = (n: number, k: number): number => WHEEL_ORDER[(((WHEEL_POS[n] + k) % POCKETS) + POCKETS) % POCKETS];

export const EVEN_MONEY = new Set(['red', 'black', 'odd', 'even', 'low', 'high']);
export const isEvenMoney = (spot: string): boolean => EVEN_MONEY.has(spot);

export interface SpotDef { nums: number[]; odds: number; inside: boolean }

const TRIOS = new Set(['trio:0-1-2', 'trio:0-2-3']);
/** Valid split: horizontal neighbours in one column, vertical neighbours in one row, or 0 with 1/2/3. */
function validSplit(a: number, b: number): boolean {
  let lo = Math.min(a, b), hi = Math.max(a, b);
  if (lo === 0) return hi >= 1 && hi <= 3;
  if (hi === lo + 1) return lo % 3 !== 0;
  return hi === lo + 3 && hi <= 36;
}

/** Parses a spot id into its covered numbers and odds (x:1). Returns null for an invalid spot. */
export function parseSpot(spot: string): SpotDef | null {
  const [kind, arg = ''] = spot.split(/:(.*)/s);
  const nums = (...xs: number[]): SpotDef => ({ nums: xs, odds: 0, inside: false });
  const inside = (d: SpotDef, odds: number): SpotDef => ({ ...d, odds, inside: true });
  switch (kind) {
    case 'straight': {
      const n = Number(arg);
      return Number.isInteger(n) && n >= 0 && n <= 36 ? inside(nums(n), 35) : null;
    }
    case 'split': {
      const [a, b] = arg.split('-').map(Number);
      return validSplit(a, b) ? inside(nums(a, b), 17) : null;
    }
    case 'street': {
      const r = Number(arg);
      return r >= 1 && r <= 12 ? inside(nums(3 * r - 2, 3 * r - 1, 3 * r), 11) : null;
    }
    case 'trio': return TRIOS.has(spot) ? inside(nums(...arg.split('-').map(Number)), 11) : null;
    case 'corner': {
      const a = Number(arg);
      return Number.isInteger(a) && a >= 1 && a <= 32 && a % 3 !== 0 ? inside(nums(a, a + 1, a + 3, a + 4), 8) : null;
    }
    case 'first4': return spot === 'first4' ? inside(nums(0, 1, 2, 3), 8) : null;
    case 'line': {
      const r = Number(arg);
      return r >= 1 && r <= 11 ? inside(nums(6 * r - 5, 6 * r - 4, 6 * r - 3, 6 * r - 2, 6 * r - 1, 6 * r), 5) : null;
    }
    case 'col': {
      const k = Number(arg);
      if (!(k >= 1 && k <= 3)) return null;
      const xs: number[] = [];
      for (let n = 1; n <= 36; n++) if (n % 3 === k % 3) xs.push(n);
      return { nums: xs, odds: 2, inside: false };
    }
    case 'doz': {
      const k = Number(arg);
      if (!(k >= 1 && k <= 3)) return null;
      const xs: number[] = [];
      for (let n = (k - 1) * 12 + 1; n <= k * 12; n++) xs.push(n);
      return { nums: xs, odds: 2, inside: false };
    }
    default: break;
  }
  const xs: number[] = [];
  for (let n = 1; n <= 36; n++) {
    const ok = spot === 'red' ? RED_SET.has(n) : spot === 'black' ? !RED_SET.has(n)
      : spot === 'odd' ? n % 2 === 1 : spot === 'even' ? n % 2 === 0
        : spot === 'low' ? n <= 18 : spot === 'high' ? n >= 19 : false;
    if (ok) xs.push(n);
  }
  return xs.length === 18 ? { nums: xs, odds: 1, inside: false } : null;
}

/** Racetrack call bets: a list of single-spot chips (a spot may repeat for ×2 chips). */
export type CallId = 'neighboursZero' | 'third' | 'orphans' | 'zeroGame' | 'neighbours';
export function callPlan(call: CallId, n = 17, k = 1): string[] {
  switch (call) {
    case 'neighboursZero': return ['trio:0-2-3', 'trio:0-2-3', 'split:4-7', 'split:12-15', 'split:18-21', 'split:19-22', 'split:32-35', 'corner:25', 'corner:25'];
    case 'third': return ['split:5-8', 'split:10-11', 'split:13-16', 'split:23-24', 'split:27-30', 'split:33-36'];
    case 'orphans': return ['straight:1', 'split:6-9', 'split:14-17', 'split:17-20', 'split:31-34'];
    case 'zeroGame': return ['split:0-3', 'split:12-15', 'split:32-35', 'straight:26'];
    case 'neighbours': {
      const out: string[] = [];
      for (let j = -k; j <= k; j++) out.push(`straight:${wheelAt(n, j)}`);
      return out;
    }
  }
}

/** Table limits (coins per spot). Inside 1–100, outside 5–500. */
export const limitsFor = (spot: string): { min: number; max: number } => {
  const d = parseSpot(spot);
  return d?.inside ? { min: 1, max: 100 } : { min: 5, max: 500 };
};

export interface Mods {
  /** 37 integer weights (base 100 + hooks), indexed by pocket number. */
  weights: readonly number[];
  zeroShield: boolean;     // every losing bet gets half back on 0
  straightAdd: number;     // int added to the straight-up odds (35 → 35 + k)
  neighbourPay: boolean;   // a losing straight-up pays 1:1 when the ball lands ±1 pocket on the wheel
}
export const BASE_WEIGHT = 100;
export const defaultMods = (): Mods => ({ weights: new Array<number>(POCKETS).fill(BASE_WEIGHT), zeroShield: false, straightAdd: 0, neighbourPay: false });

export type Bet = { s: string; a: number };
export type SeatSettle = { stake: number; gross: number; nearmiss: boolean; winners: number };

/** Settles one seat's layout against a pocket. Integer coins; halves round down. */
export function settleBets(bets: readonly Bet[], pocket: number, m: Mods): SeatSettle {
  let stake = 0, gross = 0, nearmiss = false, winners = 0;
  for (const { s, a } of bets) {
    const d = parseSpot(s);
    if (!d || a <= 0) continue;
    stake += a;
    if (d.nums.includes(pocket)) {
      const odds = d.odds + (s.startsWith('straight:') ? m.straightAdd : 0);
      gross += a * (odds + 1);
      winners++;
      continue;
    }
    if (pocket === 0 && (isEvenMoney(s) || m.zeroShield)) gross += Math.floor(a / 2);
    else if (m.neighbourPay && s.startsWith('straight:') && wheelDist(Number(s.slice(9)), pocket) === 1) gross += 2 * a;
    if (s.startsWith('straight:') && wheelDist(Number(s.slice(9)), pocket) === 1) nearmiss = true;
  }
  return { stake, gross, nearmiss, winners };
}

/** One weighted pocket draw (exactly one rng draw). */
export const drawPocket = (rng: Rng, weights: readonly number[]): number => rng.weightedIndex(weights);

export interface SpinOutcome {
  pocket: number;
  first: number;             // the pocket as first drawn (differs only after a luck reroll)
  rerolled: boolean;
  seats: SeatSettle[];
  orbitMs: number;           // cosmetic: ORBIT 5.5–7.5 s
  dropMs: number;            // cosmetic: DROP 1.2–2.4 s
  bounces: number;           // cosmetic: 2–5 deflector bounces
}

/**
 * One spin for every seat's layout. Luck (`luck` %, 0 in refund mode): if the whole table's net is a loss, a single
 * reroll with p = luck/100. Always consumes the same draws so a seed replays identically whatever the charms.
 */
export function spin(rng: Rng, layouts: readonly (readonly Bet[])[], m: Mods, luck: number): SpinOutcome {
  const first = drawPocket(rng, m.weights);
  const second = drawPocket(rng, m.weights);
  const gate = rng.next();
  const orbitMs = Math.round(rng.float(5500, 7500));
  const dropMs = Math.round(rng.float(1200, 2400));
  const bounces = rng.int(2, 5);
  const netOf = (p: number): number => layouts.reduce((acc, l) => { const s = settleBets(l, p, m); return acc + s.gross - s.stake; }, 0);
  const rerolled = luck > 0 && netOf(first) < 0 && gate < luck / 100;
  const pocket = rerolled ? second : first;
  return { pocket, first, rerolled, seats: layouts.map((l) => settleBets(l, pocket, m)), orbitMs, dropMs, bounces };
}

/** Headless round for staff auto-play and balance sims: one red bet of `bet`, same rules as the live table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const out = spin(rng, [[{ s: 'red', a: bet }]], defaultMods(), h.luck);
  const s = out.seats[0];
  return { gross: s.gross, tags: out.rerolled ? ['lucky'] : [] };
};
