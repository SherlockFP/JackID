/**
 * Sic Bo "The Birdcage" (`sicbo`) — pure rules (no three, kit or DOM). Shared by the live table (`index.ts`) and the
 * headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_tables §8.
 *
 * Three dice, faces 1–6, drawn as weighted integers (base 100 per face + `m.sicbo.dieWeight.n` hooks). Every bet is a
 * spot id: `small`, `big`, `odd`, `even`, `total:N` (4–17), `single:N`, `double:N`, `triple:N`, `anytriple`, `combo:a-b`.
 * Pay multipliers are returned gross (stake included) per coin staked, so `gross = stake × payMult`.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';

export const DICE = 3;
export const FACES = 6;
export const BASE_WEIGHT = 100;
export const TABLE_MAX = 2000;

/** Paytable (MACHINES_tables §8.3). Odds are "x : 1"; exact RTP over 216 outcomes is in the doc. */
export const TOTAL_ODDS: Readonly<Record<number, number>> = { 4: 62, 5: 33, 6: 19, 7: 13, 8: 9, 9: 7, 10: 6, 11: 6, 12: 7, 13: 9, 14: 13, 15: 19, 16: 33, 17: 62 };
/** Exactly 1 / 2 / 3 dice showing N. */
export const SINGLE_ODDS: readonly number[] = [1, 2, 12];
export const DOUBLE_ODDS = 11;
export const TRIPLE_ODDS = 200;
export const ANYTRIPLE_ODDS = 33;
export const COMBO_ODDS = 6;

/** Layout rows, far to near. The cell order here is the panel order of the model. */
export const LAYOUT_ROWS: readonly (readonly string[])[] = [
  Array.from({ length: 14 }, (_, i) => `total:${i + 4}`),
  ['small', 'big'],
  ['odd', 'even'],
  Array.from({ length: 6 }, (_, i) => `single:${i + 1}`),
  Array.from({ length: 6 }, (_, i) => `double:${i + 1}`),
  [...Array.from({ length: 6 }, (_, i) => `triple:${i + 1}`), 'anytriple'],
  Array.from({ length: 15 }, (_, i) => {
    let k = i;
    for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) { if (k === 0) return `combo:${a}-${b}`; k--; }
    return '';
  }),
];
export const ALL_SPOTS: readonly string[] = LAYOUT_ROWS.flat();

const EVEN_MONEY = new Set(['small', 'big', 'odd', 'even']);

export type Dice = readonly [number, number, number];
export interface Outcome { faces: Dice; total: number; triple: boolean; counts: readonly number[] /* index 1..6 */ }
export type Bet = { s: string; a: number };
export interface SeatSettle { stake: number; gross: number; winners: number; nearmiss: boolean }

/** Charm modifiers, all integers. `totalAdd[t]` is added to the total's odds; `singleTripleAdd` to the 3-match 12:1. */
export interface Mods {
  weights: readonly number[];          // 6 weights, face 1..6
  singleTripleAdd: number;
  totalAdd: readonly number[];         // index = total (0..18)
  tripleShield: boolean;               // small/big/odd/even push on a triple instead of losing
}
export const defaultMods = (): Mods => ({
  weights: new Array<number>(FACES).fill(BASE_WEIGHT),
  singleTripleAdd: 0,
  totalAdd: new Array<number>(19).fill(0),
  tripleShield: false,
});

export function outcomeOf(faces: Dice): Outcome {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const f of faces) counts[f]++;
  const total = faces[0] + faces[1] + faces[2];
  return { faces, total, triple: counts.some((c) => c === DICE), counts };
}

/** Valid spot id? Totals 4–17, singles/doubles/triples 1–6, combos a<b. */
export function isValidSpot(spot: string): boolean {
  const [kind, arg = ''] = spot.split(/:(.*)/s);
  const n = Number(arg);
  switch (kind) {
    case 'small': case 'big': case 'odd': case 'even': case 'anytriple': return spot === kind;
    case 'total': return Number.isInteger(n) && n >= 4 && n <= 17;
    case 'single': case 'double': case 'triple': return Number.isInteger(n) && n >= 1 && n <= 6;
    case 'combo': {
      const [a, b] = arg.split('-').map(Number);
      return Number.isInteger(a) && Number.isInteger(b) && a >= 1 && a < b && b <= 6;
    }
    default: return false;
  }
}

/** Table limits per spot (coins). Even-money 5–500, triples 1–20, everything else 1–100. Null for an invalid spot. */
export function limitsFor(spot: string): { min: number; max: number } | null {
  if (!isValidSpot(spot)) return null;
  if (EVEN_MONEY.has(spot)) return { min: 5, max: 500 };
  if (spot.startsWith('triple:') || spot === 'anytriple') return { min: 1, max: 20 };
  return { min: 1, max: 100 };
}

/**
 * Gross multiplier per coin staked for one spot (0 = lost, 1 = pushed, k = pays (k−1):1).
 * Even-money spots lose on any triple (or push with `tripleShield`).
 */
export function payMult(spot: string, o: Outcome, m: Mods): number {
  const [kind, arg = ''] = spot.split(/:(.*)/s);
  const n = Number(arg);
  switch (kind) {
    case 'small': case 'big': {
      if (o.triple) return m.tripleShield ? 1 : 0;
      const ok = kind === 'small' ? o.total <= 10 : o.total >= 11;
      return ok ? 2 : 0;
    }
    case 'odd': case 'even': {
      if (o.triple) return m.tripleShield ? 1 : 0;
      const ok = kind === 'odd' ? o.total % 2 === 1 : o.total % 2 === 0;
      return ok ? 2 : 0;
    }
    case 'total': {
      if (!isValidSpot(spot) || o.total !== n) return 0;
      return 1 + TOTAL_ODDS[n] + (m.totalAdd[n] ?? 0);
    }
    case 'single': {
      const c = o.counts[n] ?? 0;
      if (!isValidSpot(spot) || c === 0) return 0;
      return 1 + SINGLE_ODDS[c - 1] + (c === DICE ? m.singleTripleAdd : 0);
    }
    case 'double': return isValidSpot(spot) && o.counts[n] >= 2 ? 1 + DOUBLE_ODDS : 0;
    case 'triple': return isValidSpot(spot) && o.counts[n] === DICE ? 1 + TRIPLE_ODDS : 0;
    case 'anytriple': return o.triple ? 1 + ANYTRIPLE_ODDS : 0;
    case 'combo': {
      if (!isValidSpot(spot)) return 0;
      const [a, b] = arg.split('-').map(Number);
      return o.counts[a] > 0 && o.counts[b] > 0 ? 1 + COMBO_ODDS : 0;
    }
    default: return 0;
  }
}

/** Spots that pay (more than a push) on this outcome, with default modifiers. Used for the lights. */
export const winningSpots = (o: Outcome): string[] => ALL_SPOTS.filter((s) => payMult(s, o, defaultMods()) > 1);

/** Settles one seat's layout against an outcome. Integer coins. */
export function settleBets(bets: readonly Bet[], o: Outcome, m: Mods): SeatSettle {
  let stake = 0, gross = 0, winners = 0, nearmiss = false;
  for (const { s, a } of bets) {
    if (!isValidSpot(s) || !(a > 0)) continue;
    stake += a;
    const mult = payMult(s, o, m);
    gross += a * mult;
    if (mult > 1) winners++;
    else if (s.startsWith('total:') && Math.abs(Number(s.slice(6)) - o.total) === 1) nearmiss = true;
  }
  return { stake, gross, winners, nearmiss };
}

/** Draws three weighted faces (exactly three rng draws). Returned faces are 1..6. */
export const drawDice = (rng: Rng, weights: readonly number[]): Dice => {
  const a = rng.weightedIndex(weights) + 1;
  const b = rng.weightedIndex(weights) + 1;
  const c = rng.weightedIndex(weights) + 1;
  return [a, b, c];
};

export interface RollOutcome {
  faces: Dice;
  first: Dice;               // the faces as first rolled (differs only after a luck reroll)
  rerolled: boolean;         // solo: a losing layout got a second roll
  refunded: boolean;         // shared: losing seats got their stake back
  seats: SeatSettle[];
}

/**
 * One roll for every seat's layout. Luck (`luck` %, 0 disables both): solo table, a losing layout is rolled once more
 * with p = luck/100; shared table (≥ 2 seats), with the same gate every losing seat is refunded its stake.
 * Always consumes the same draws (six dice draws + one gate) so a seed replays identically whatever the charms.
 */
export function roll(rng: Rng, layouts: readonly (readonly Bet[])[], m: Mods, luck: number): RollOutcome {
  const first = drawDice(rng, m.weights);
  const second = drawDice(rng, m.weights);
  const gate = rng.next();
  const o1 = outcomeOf(first);
  const netOf = (o: Outcome): number => layouts.reduce((acc, l) => { const s = settleBets(l, o, m); return acc + s.gross - s.stake; }, 0);
  const solo = layouts.length === 1;
  const rerolled = solo && luck > 0 && netOf(o1) < 0 && gate < luck / 100;
  const refunded = !solo && luck > 0 && layouts.length > 0 && gate < luck / 100;
  const o = rerolled ? outcomeOf(second) : o1;
  const seats = layouts.map((l) => {
    const s = settleBets(l, o, m);
    if (refunded && s.gross < s.stake) s.gross = s.stake;
    return s;
  });
  return { faces: o.faces, first, rerolled, refunded, seats };
}

/** Headless round for staff auto-play and balance sims: one big bet, same rules and modifiers as the live table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const m: Mods = {
    weights: [1, 2, 3, 4, 5, 6].map((f) => BASE_WEIGHT + Math.round(h.mod(`m.sicbo.dieWeight.${f}`, 0))),
    singleTripleAdd: Math.round(h.mod('m.sicbo.singleTripleAdd', 0)),
    totalAdd: Array.from({ length: 19 }, (_, t) => Math.round(h.mod(`m.sicbo.totalPayAdd.${t}`, 0))),
    tripleShield: h.mod('m.sicbo.tripleShield', 0) > 0,
  };
  const out = roll(rng, [[{ s: 'big', a: bet }]], m, h.luck);
  return { gross: out.seats[0].gross, tags: out.rerolled ? ['lucky'] : [] };
};
