/**
 * Fan-Tan (`fantan`, "Düğme Sayma") — pure rules (no three, kit or DOM). Shared by the live table (`index.ts`) and
 * the headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_tables §22.
 *
 * Sides 1–4 are numbered clockwise from the players: 1 front (+Z), 2 right (+X), 3 back (−Z), 4 left (−X).
 * SCOOP draws N = 40 + 4k + r (r uniform 1–4, k uniform 0–19). COUNT removes groups of 4 from the top of the heap
 * until r buttons remain, so r = ((N − 1) mod 4) + 1 always holds. Winning bets pay less commission on the winnings.
 * Stochastic rounding keeps the coin payouts exact in expectation, so the RTP has no integer-rounding drift.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const SIDE_COUNT = 4;
export const GROUP = 4;
export const N_BASE = 40;                      // N = N_BASE + 4k + r
export const KMAX = 19;
export const LIMIT = { min: 5, max: 500 };     // per spot
export const TABLE_MAX = 2000;                 // per seat, all spots together
export const BASE_WEIGHT = 100;                // per side (r is uniform while no charm skews it)
export const BASE_RAKE = 5;                    // commission on winnings, percent
export const GOLD_ODDS_MULT = 2;               // Golden Button: winning bets pay double

export type Kind = 'fan' | 'nim' | 'kwok' | 'odd' | 'even' | 'ssh';
/** One bettable spot. `wins` are the sides that win, `push` the sides that return the stake (Nim only). */
export interface Spot { id: string; kind: Kind; wins: readonly number[]; push: readonly number[]; odds: number }
export type Bet = { s: string; a: number };

const build = (): Spot[] => {
  const out: Spot[] = [];
  for (let n = 1; n <= SIDE_COUNT; n++) out.push({ id: `fan:${n}`, kind: 'fan', wins: [n], push: [], odds: 3 });
  for (let n = 1; n <= SIDE_COUNT; n++) {
    for (let m = 1; m <= SIDE_COUNT; m++) {
      if (m !== n) out.push({ id: `nim:${n}/${m}`, kind: 'nim', wins: [n], push: [m], odds: 2 });
    }
  }
  for (const [a, b] of [[1, 2], [2, 3], [3, 4], [1, 4]]) {
    out.push({ id: `kwok:${a}-${b}`, kind: 'kwok', wins: [a, b], push: [], odds: 1 });
  }
  out.push({ id: 'odd', kind: 'odd', wins: [1, 3], push: [], odds: 1 });
  out.push({ id: 'even', kind: 'even', wins: [2, 4], push: [], odds: 1 });
  for (let omit = 1; omit <= SIDE_COUNT; omit++) {
    const wins = [1, 2, 3, 4].filter((x) => x !== omit);
    out.push({ id: `ssh:${omit}`, kind: 'ssh', wins, push: [], odds: 1 / 3 });   // "1:3": a third of the stake
  }
  return out;
};

export const SPOTS: readonly Spot[] = build();
const BY_ID = new Map<string, Spot>(SPOTS.map((s) => [s.id, s]));
export const spotOf = (id: string): Spot | undefined => BY_ID.get(id);

/** Folded round inputs. Pure: the same readings give the same Mods. */
export interface Mods {
  /** Four integer weights for r (side 1..4). Equal unless a solo charm skews them. */
  weights: readonly number[];
  /** Commission on winnings, percent (5 base, L10 4, L100 0; `x.table.rakeDelta` adds points). */
  rake: number;
  /** Nim push side pays this many x:1 instead of returning the stake (0 = push). Milestone L25: 0.5. */
  nimPushOdds: number;
  /** Golden Button is in the heap this round (milestone L50 or the charm). */
  golden: boolean;
}

/** Hook reader: `mod(hook, base)` from the machine, or a constant in tests. */
export type Modify = (hook: ModHook, base: number) => number;

/** Folds charms and milestone features into the round inputs. `solo` gates the side-weight charm (solo only). */
export function buildMods(mod: Modify, feature: (name: string) => boolean = () => false, solo = true): Mods {
  const weights = [1, 2, 3, 4].map((n) => {
    const add = solo ? Math.round(mod(`m.fantan.sideWeight.${n}` as ModHook, 0)) : 0;
    return Math.max(0, BASE_WEIGHT + add);
  });
  let base = BASE_RAKE;
  if (feature('fantan.rake4')) base = 4;
  if (feature('fantan.rake0')) base = 0;
  const rake = Math.min(100, Math.max(0, base + mod('x.table.rakeDelta' as ModHook, 0)));
  return {
    weights,
    rake,
    nimPushOdds: Math.max(feature('fantan.nimPush') ? 0.5 : 0, mod('m.fantan.nimPushPays' as ModHook, 0)),
    golden: feature('fantan.golden') || mod('m.fantan.goldenButton' as ModHook, 0) > 0,
  };
}

export const defaultMods = (): Mods => buildMods(() => 0, () => false, true);

/** One round's hidden draw. `goldIdx` is the Golden Button's place in the heap (−1 when there is none). */
export interface Round { r: number; k: number; n: number; goldIdx: number }

/** SCOOP draw: r by weight (one draw), k uniform 0–19, N = 40 + 4k + r, and the Golden Button place when live. */
export function drawRound(rng: Rng, m: Mods): Round {
  const r = rng.weightedIndex(m.weights) + 1;
  const k = rng.int(0, KMAX);
  const n = N_BASE + GROUP * k + r;
  const goldIdx = m.golden ? rng.int(0, n - 1) : -1;
  return { r, k, n, goldIdx };
}

/** The Golden Button is removed from the top of the heap, so it survives iff its index is among the final r. */
export const goldLive = (rd: Round): boolean => rd.goldIdx >= 0 && rd.goldIdx < rd.r;

/** COUNT steps in ms: groups of 4 every 0.35 s; after ten groups 0.20 s; the last twelve buttons at 0.60 s. */
export function countSteps(n: number, r: number): number[] {
  const out: number[] = [];
  const groups = (n - r) / GROUP;
  for (let i = 0; i < groups; i++) {
    const remaining = n - GROUP * i;
    out.push(remaining <= 12 ? 600 : i < 10 ? 350 : 200);
  }
  return out;
}

/** Stochastic rounding: floor plus one with probability equal to the fraction. One rng draw. */
function roundCoins(x: number, rng: Rng): number {
  const f = Math.floor(x);
  return f + (rng.next() < x - f ? 1 : 0);
}

export interface SeatSettle { stake: number; gross: number; winners: number }

/** Settles one seat's spots against the round. `gross` is what the seat is paid (stake returned on a win or push). */
export function settleSeat(bets: readonly Bet[], rd: Round, m: Mods, rng: Rng, golden: boolean): SeatSettle {
  let stake = 0, gross = 0, winners = 0;
  const keep = 1 - m.rake / 100;
  for (const { s, a } of bets) {
    const spot = spotOf(s);
    if (!spot || !(a > 0)) continue;
    stake += a;
    if (spot.wins.includes(rd.r)) {
      const w = a * spot.odds * (golden ? GOLD_ODDS_MULT : 1);
      gross += a + roundCoins(w * keep, rng);
      winners++;
    } else if (spot.push.includes(rd.r)) {
      gross += m.nimPushOdds > 0 ? a + roundCoins(a * m.nimPushOdds * keep, rng) : a;
      winners++;
    }
  }
  return { stake, gross, winners };
}

/** Float expectation of a layout's net for `r` (no rng). Used only for the solo luck gate. */
function expectNet(layouts: readonly (readonly Bet[])[], r: number, m: Mods): number {
  const keep = 1 - m.rake / 100;
  let net = 0;
  for (const bets of layouts) {
    for (const { s, a } of bets) {
      const spot = spotOf(s);
      if (!spot || !(a > 0)) continue;
      if (spot.wins.includes(r)) net += a * spot.odds * keep;
      else if (spot.push.includes(r)) net += m.nimPushOdds > 0 ? a * m.nimPushOdds * keep : 0;
      else net -= a;
    }
  }
  return net;
}

export interface Outcome {
  round: Round;
  rerolled: boolean;   // solo luck reroll replaced the first draw
  seats: SeatSettle[]; // one per layout, in order
}

/**
 * One round for every seat's layout. `pre` is the draw made at OPEN (so `peek` can read its parity); pass null to
 * draw now. Luck (`luck` %, solo only): if the table is net negative on the first draw, one reroll with p = luck/100.
 * Always consumes the gate draw, so a seed replays identically.
 */
export function resolve(
  rng: Rng, layouts: readonly (readonly Bet[])[], m: Mods, luck: number, pre: Round | null = null,
): Outcome {
  let round = pre ?? drawRound(rng, m);
  const gate = rng.next();
  let rerolled = false;
  if (luck > 0 && expectNet(layouts, round.r, m) < 0 && gate < luck / 100) {
    round = drawRound(rng, m);
    rerolled = true;
  }
  const golden = goldLive(round);
  const seats = layouts.map((l) => settleSeat(l, round, m, rng, golden));
  return { round, rerolled, seats };
}

/** Headless round for staff auto-play and balance sims: one random side of Fan, same rules as the live table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const m = defaultMods();
  const side = rng.int(1, SIDE_COUNT);
  const out = resolve(rng, [[{ s: `fan:${side}`, a: bet }]], m, h.luck);
  return { gross: out.seats[0].gross, tags: out.rerolled ? ['lucky'] : [] };
};
