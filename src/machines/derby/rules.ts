/**
 * Derby "The Rat Run" (the horse race, back on the floor) — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the headless
 * play contract (`playHeadless`), so the simulated RTP IS the live RTP. Contract: MACHINES_tables §13, plan logicBrief.
 *
 * Each race the strengths {0.6, 1.0, 1.4, 2.0, 2.8, 4.0} (+ The Albino at L10) are shuffled over the lanes. The tote prints
 * odds = margin / p to 1 dp, min ×1.1 (margin 0.90 Win/Place/Show, 0.85 Exacta/Quinella), fixed before LOCK. The finishing
 * order is sampled Plackett–Luce. Luck: a solo race reroll (p = L/100) on a losing table; a shared race refunds losing
 * seats with p = L/100.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const BASE_STRENGTHS: readonly number[] = [0.6, 1.0, 1.4, 2.0, 2.8, 4.0];
export const ALBINO_RANGE: readonly [number, number] = [0.6, 4.0];
export const WP_MARGIN = 0.9;
export const EX_MARGIN = 0.85;
export const MIN_ODDS = 1.1;
export const BET_MIN = 1, BET_MAX = 200, RACE_CAP = 1000, MAX_BETS_PER_SEAT = 30;
export const KEYFRAMES = 28, KEY_DT = 0.5;      // 28 positions every 0.5 s = 14.0 s of race
export const PHOTO_GAP = 0.1;                   // 1st-2nd gap under this = photo finish
export const WINNER_MIN = 12.8, WINNER_MAX = 13.6, GAP_MIN = 0.08, GAP_MAX = 0.6;

export type BetType = 'win' | 'place' | 'show' | 'exacta' | 'quinella';
export const BET_TYPES: readonly BetType[] = ['win', 'place', 'show', 'exacta', 'quinella'];
export const PICKS_NEEDED: Readonly<Record<BetType, number>> = { win: 1, place: 1, show: 1, exacta: 2, quinella: 2 };

/** A bet: `p` are 0-based runner indices (1 pick for Win/Place, 2 for Exacta (ordered) and Quinella (any order)). */
export type Bet = { t: BetType; p: number[]; a: number };
export type Odds = { win: number[]; place: number[]; show: number[]; exacta: number[]; quinella: number[] };
/** Charm modifiers (all neutral by default). `oddsBonus` and `longshot` are fractions (0.1 = +10 %). */
export type Mods = { deadHeat: boolean; longshot: number; exactaInsurance: boolean; oddsBonus: number };
export const NO_MODS: Mods = { deadHeat: false, longshot: 0, exactaInsurance: false, oddsBonus: 0 };

/** Charm / upgrade hooks (documented in `def.modHooks`). `lane` is 1-based. */
export const hookRunnerWeight = (lane: number): ModHook => `m.derby.runnerWeight.${lane}` as ModHook;
export const HOOK_ALBINO = 'm.derby.albino' as ModHook;
export const HOOK_ODDS = 'm.derby.oddsBonus' as ModHook;
export const HOOK_DEAD_HEAT = 'm.derby.deadHeat' as ModHook;
export const HOOK_LONGSHOT = 'm.derby.longshotBonus' as ModHook;
export const HOOK_EXACTA_INS = 'm.derby.exactaInsurance' as ModHook;

/** Printed odds: margin / p to one decimal (nearest tenth: a floor would shave ~1.5 % off the Place RTP), min ×1.1. */
const oddsOf = (p: number, margin: number): number => Math.max(MIN_ODDS, Math.round((margin / p) * 10) / 10);

/** Index of the ordered pair (i first, j second) in the exacta table (n·(n−1) entries). */
export const exactaIndex = (n: number, i: number, j: number): number => i * (n - 1) + (j < i ? j : j - 1);
/** Index of the unordered pair {i, j} in the quinella table (n·(n−1)/2 entries). */
export function quinellaIndex(n: number, i: number, j: number): number {
  const lo = Math.min(i, j), hi = Math.max(i, j);
  return lo * (n - 1) - (lo * (lo - 1)) / 2 + (hi - lo - 1);
}

/** Printed odds for a field of strengths (Plackett–Luce). Pure: the same numbers the tote shows. */
export function oddsFor(s: readonly number[]): Odds {
  const n = s.length;
  const S = s.reduce((a, b) => a + b, 0);
  const win: number[] = [], place: number[] = [], show: number[] = [];
  for (let i = 0; i < n; i++) {
    const pw = s[i] / S;
    let pp = pw;                                  // P(i finishes 1st or 2nd)
    let p3 = 0;                                   // P(i finishes 3rd)
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      pp += (s[j] / S) * (s[i] / (S - s[j]));
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        p3 += (s[j] / S) * (s[k] / (S - s[j])) * (s[i] / (S - s[j] - s[k]));
      }
    }
    win.push(oddsOf(pw, WP_MARGIN));
    place.push(oddsOf(pp, WP_MARGIN));
    show.push(oddsOf(n >= 3 ? pp + p3 : 1, WP_MARGIN));   // P(i in the first three)
  }
  const pe = (i: number, j: number): number => (s[i] / S) * (s[j] / (S - s[i]));   // P(i 1st, j 2nd)
  const exacta = new Array<number>(n * (n - 1)).fill(0);
  const quinella = new Array<number>((n * (n - 1)) / 2).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) exacta[exactaIndex(n, i, j)] = oddsOf(pe(i, j), EX_MARGIN);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) quinella[quinellaIndex(n, i, j)] = oddsOf(pe(i, j) + pe(j, i), EX_MARGIN);
  return { win, place, show, exacta, quinella };
}

/** The field for one race: base strengths (+ The Albino at L10), shuffled over the lanes. Consumes draws from `rng`. */
export function field(rng: Rng, albino: boolean): number[] {
  const s = [...BASE_STRENGTHS];
  if (albino) s.push(rng.float(ALBINO_RANGE[0], ALBINO_RANGE[1]));
  return rng.shuffle(s);
}

/** Solo only: adds each lane's `runnerWeight` to its strength (floored at 0.1). Shared races never call this. */
export function weighted(s: readonly number[], weight: (lane: number) => number): number[] {
  return s.map((v, i) => Math.max(0.1, v + weight(i + 1)));
}

/** Plackett–Luce finishing order: winner ∝ strength, removed, repeat. Returns runner indices, winner first. */
export function sampleOrder(rng: Rng, s: readonly number[]): number[] {
  const rest = s.map((_, i) => i);
  const out: number[] = [];
  while (rest.length) {
    const k = rng.weightedIndex(rest.map((i) => s[i]));
    out.push(rest[k]);
    rest.splice(k, 1);
  }
  return out;
}

export type Settle = { stake: number; gross: number; nearmiss: boolean; winners: number };

/** Settles one seat's bets against a finished race. Gross is fractional here; `runRace` makes it whole coins. */
export function settleBets(bets: readonly Bet[], order: readonly number[], odds: Odds, photo: boolean, gap: number, m: Mods): Settle {
  const n = order.length;
  const first = order[0], second = order[1];
  let stake = 0, gross = 0, nearmiss = false, winners = 0;
  const pay = (a: number, o: number): number => {
    let g = a * o;
    if (o >= 10) g *= 1 + m.longshot;
    return g * (1 + m.oddsBonus);
  };
  for (const b of bets) {
    if (!(b.a > 0)) continue;
    stake += b.a;
    const p0 = b.p[0], p1 = b.p[1];
    let g = 0;
    if (b.t === 'win') {
      if (p0 === first) g = pay(b.a, odds.win[p0]);
      else if (p0 === second && photo && m.deadHeat) g = pay(b.a, odds.win[p0]) / 2;   // dead heat: half odds
      if (p0 === second && gap < PHOTO_GAP) nearmiss = true;
    } else if (b.t === 'place') {
      if (p0 === first || p0 === second) g = pay(b.a, odds.place[p0]);
    } else if (b.t === 'show') {
      if (p0 === first || p0 === second || p0 === order[2]) g = pay(b.a, odds.show[p0]);
    } else if (b.t === 'exacta') {
      if (p0 === first && p1 === second) g = pay(b.a, odds.exacta[exactaIndex(n, p0, p1)]);
      else if (m.exactaInsurance && p0 === second && p1 === first) g = b.a;
    } else if ((p0 === first && p1 === second) || (p0 === second && p1 === first)) {
      g = pay(b.a, odds.quinella[quinellaIndex(n, p0, p1)]);
    }
    if (g > 0) { gross += g; winners++; }
  }
  return { stake, gross, nearmiss, winners };
}

/** Checks one bet against the table rules. Returns a reason key (`''` when valid). */
export function validBet(b: Bet, runners: number, seatTotal: number): string {
  if (!BET_TYPES.includes(b.t)) return 'badType';
  if (b.p.length !== PICKS_NEEDED[b.t]) return PICKS_NEEDED[b.t] === 1 ? 'badPick' : 'pickTwo';
  if (b.p.some((p) => !Number.isInteger(p) || p < 0 || p >= runners)) return 'badRat';
  if (PICKS_NEEDED[b.t] === 2 && b.p[0] === b.p[1]) return 'pickTwo';
  if (!Number.isInteger(b.a) || b.a < BET_MIN || b.a > BET_MAX) return 'limit';
  if (seatTotal + b.a > RACE_CAP) return 'raceLimit';
  return '';
}

export interface RaceTiming { frames: number[][]; gaps: number[]; photo: boolean }

/** Number of changes of the front runner across the keyframes. */
export function leadChanges(frames: readonly number[][]): number {
  let changes = 0, prev = -1;
  for (const row of frames) {
    let lead = 0;
    row.forEach((x, i) => { if (x > row[lead]) lead = i; });
    if (prev >= 0 && lead !== prev) changes++;
    prev = lead;
  }
  return changes;
}

/**
 * Cosmetic timing for a finished order: the winner crosses at 12.8–13.6 s, each next rat 0.08–0.60 s later. Each rat has a
 * noisy speed profile, time-warped so it reaches the line at its finish time. Frames are progress 0..1 at 0.5 s steps
 * (28 keyframes). The noise is redrawn (up to 8 tries) until the front runner changes at least once.
 */
export function raceTiming(rng: Rng, order: readonly number[]): RaceTiming {
  const n = order.length;
  const finish = new Array<number>(n).fill(0);
  const gaps: number[] = [0];
  let t = rng.float(WINNER_MIN, WINNER_MAX);
  for (let k = 0; k < n; k++) {
    if (k > 0) { const g = rng.float(GAP_MIN, GAP_MAX); t += g; gaps.push(g); }
    finish[order[k]] = t;
  }
  let frames: number[][] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const curves: number[][] = [];
    for (let i = 0; i < n; i++) {
      const cum = [0];
      let noise = 0;
      for (let k = 1; k <= KEYFRAMES; k++) {
        noise = 0.6 * noise + rng.gauss(0, 0.45);
        cum.push(cum[k - 1] + Math.exp(noise));
      }
      curves.push(cum.map((c) => c / cum[KEYFRAMES]));
    }
    frames = [];
    for (let f = 1; f <= KEYFRAMES; f++) {
      const row: number[] = [];
      for (let i = 0; i < n; i++) {
        const u = Math.min(1, (f * KEY_DT) / finish[i]) * KEYFRAMES;
        const k0 = Math.min(KEYFRAMES - 1, Math.floor(u));
        const c = curves[i];
        row.push(c[k0] + (c[k0 + 1] - c[k0]) * (u - k0));
      }
      frames.push(row);
    }
    if (leadChanges(frames) >= 1) break;
  }
  return { frames, gaps, photo: n > 1 && gaps[1] < PHOTO_GAP };
}

export type RaceOutcome = {
  order: number[];
  rerolled: boolean;
  photo: boolean;
  gap: number;
  frames: number[][];
  seats: Settle[];
};

/**
 * One whole race for the table. The order draws always happen (two orders + one gate), so the stream does not depend on
 * luck. Then the luck rule, the timing and the per-seat settlement. `seatBets[i]` holds seat i's bets; `solo` = one human.
 */
export function runRace(rng: Rng, s: readonly number[], seatBets: readonly (readonly Bet[])[], odds: Odds, m: Mods, luck: number, solo: boolean): RaceOutcome {
  const first = sampleOrder(rng, s);
  const second = sampleOrder(rng, s);
  const gate = rng.next();
  const netOf = (order: number[]): number => seatBets.reduce((acc, bets) => {
    const st = settleBets(bets, order, odds, false, 1, m);
    return acc + st.gross - st.stake;
  }, 0);
  const rerolled = solo && luck > 0 && netOf(first) < 0 && gate < luck / 100;
  const order = rerolled ? second : first;
  const timing = raceTiming(rng, order);
  const gap = timing.gaps[1] ?? 1;
  // whole coins by stochastic rounding (one draw per seat): unbiased, so a 1-coin stake keeps the table RTP
  const seats = seatBets.map((bets) => {
    const st = settleBets(bets, order, odds, timing.photo, gap, m);
    return { ...st, gross: Math.floor(st.gross + rng.next()) };
  });
  if (!solo && luck > 0) {
    // shared tables: a losing seat is refunded with p = L/100 (one draw per losing seat, in seat order)
    seats.forEach((st) => { if (st.stake > 0 && st.gross === 0 && rng.next() < luck / 100) st.gross = st.stake; });
  }
  return { order, rerolled, photo: timing.photo, gap, frames: timing.frames, seats };
}

/** Headless round for staff auto-play and balance sims: one Win bet on a uniform random rat, same rules as the table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const s = field(rng, h.mod(HOOK_ALBINO, 0) > 0);
  const odds = oddsFor(s);
  const pick = rng.int(0, s.length - 1);
  const out = runRace(rng, s, [[{ t: 'win', p: [pick], a: bet }]], odds, NO_MODS, h.luck, true);
  return { gross: out.seats[0].gross, tags: out.rerolled ? ['lucky'] : [] };
};
