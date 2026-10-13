/**
 * Big Six Money Wheel "The Six-Score Wheel" (`bigsix`) — pure rules (no three, kit or DOM). Shared by the live table
 * (`index.ts`) and the headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_tables §9.
 *
 * 54 uniform segments (base weight 100 each). Bets are on six symbols (1, 3, 6, 12, 25, EYE); the HOUSE segment
 * beats every bet (its eye closes). Pays x:1 on the stake, the stake is returned on the win (gross = stake × (x+1)).
 * Every draw is a weighted integer pick; hooks and milestones only add integer weight or change the odds.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const SEGMENT_COUNT = 54;
/** Bettable symbols (the six lit counter spots), in spot order. */
export const BET_SYMS = ['1', '3', '6', '12', '25', 'EYE'] as const;
export type BetSym = (typeof BET_SYMS)[number];
export type Sym = BetSym | 'HOUSE';

/** Segment order, clockwise from the top (index 0 = EYE). Counts: 1×26, 3×13, 6×7, 12×4, 25×2, EYE×1, HOUSE×1. */
export const SEGMENTS: readonly Sym[] = (
  'EYE 1 3 1 6 1 3 12 1 1 3 1 6 1 25 3 1 1 3 6 1 12 1 3 1 1 3 HOUSE '
  + '6 1 1 3 1 12 1 6 3 1 1 3 1 25 6 1 3 1 1 12 3 1 6 1 3 1'
).split(' ') as Sym[];

/** Base pay x:1 per symbol (EYE is 50:1 before charms and milestones). */
export const ODDS: Record<BetSym, number> = { '1': 1, '3': 3, '6': 6, '12': 12, '25': 25, EYE: 50 };
export const EYE_ODDS = 50;
export const LIMIT = { min: 1, max: 200 };     // per symbol
export const TABLE_MAX = 1000;                 // per seat, all symbols together
export const BASE_WEIGHT = 100;
/** Golden Ratchet price: a fraction of the seat's stake, charged at LOCK. */
export const NUDGE_COST = 0.25;

export type Bet = { s: BetSym; a: number };
export interface SeatSettle { stake: number; gross: number; nearmiss: boolean; winners: number }

/** Folded spin inputs. Pure: the same mod/feature readings give the same Mods. */
export interface Mods {
  /** 54 integer weights, indexed by segment. */
  weights: readonly number[];
  /** Croupier's Rake / milestone L25: HOUSE returns every stake (push) instead of losing it. */
  houseShield: boolean;
  /** EYE odds x:1 (50 + charm add + milestone L50 +10). */
  eyeOdds: number;
  /** Segment that carries the ×2 multiplier lamp (milestone L10), −1 for none. Chosen per spin by the host. */
  multSeg: number;
  /** Charm `m.bigsix.nudge` charges: a stop one peg from a backed segment creeps onto it with p = 50 %. */
  creep: number;
}

/** Hook reader: `mod(hook, base)` from the machine, or a constant in tests. */
export type Modify = (hook: ModHook, base: number) => number;

/** Folds charms and milestone features into the spin inputs. `feature` reads tycoon milestone flags. */
export function buildMods(mod: Modify, feature: (name: string) => boolean = () => false): Mods {
  const weights = SEGMENTS.map((sym) => {
    const add = Math.round(mod(`m.bigsix.segmentWeight.${sym}` as ModHook, 0));
    return Math.max(0, BASE_WEIGHT + add);
  });
  return {
    weights,
    houseShield: mod('m.bigsix.houseShield' as ModHook, 0) > 0 || feature('bigsix.housePush'),
    eyeOdds: EYE_ODDS + Math.round(mod('m.bigsix.eyePayAdd' as ModHook, 0)) + (feature('bigsix.eye60') ? 10 : 0),
    multSeg: -1,
    creep: Math.max(0, Math.round(mod('m.bigsix.nudge' as ModHook, 0))),
  };
}

export const defaultMods = (): Mods => ({
  weights: new Array<number>(SEGMENT_COUNT).fill(BASE_WEIGHT), houseShield: false, eyeOdds: EYE_ODDS, multSeg: -1, creep: 0,
});

/** Limits for one symbol spot. */
export const limitsFor = (_s: BetSym): { min: number; max: number } => ({ ...LIMIT });

/** One weighted segment draw (exactly one rng draw). */
export const drawSeg = (rng: Rng, weights: readonly number[]): number => rng.weightedIndex(weights);

/** Is `seg` one peg (adjacent segment) away from any segment carrying `sym`? */
export function adjacentTo(seg: number, sym: Sym): boolean {
  const n = SEGMENT_COUNT;
  return SEGMENTS[(seg + 1) % n] === sym || SEGMENTS[(seg - 1 + n) % n] === sym;
}

/** Settles one seat's bets against a segment. Integer coins. HOUSE beats every bet (or pushes with `houseShield`). */
export function settleSeat(bets: readonly Bet[], seg: number, m: Mods): SeatSettle {
  const sym = SEGMENTS[seg];
  let stake = 0, gross = 0, winners = 0, nearmiss = false;
  for (const { s, a } of bets) {
    if (!(a > 0)) continue;
    stake += a;
    if (sym === 'HOUSE') { if (m.houseShield) gross += a; continue; }
    if (s === sym) {
      const odds = s === 'EYE' ? m.eyeOdds : ODDS[s];
      gross += a * (odds + 1) * (seg === m.multSeg ? 2 : 1);
      winners++;
    } else if ((s === 'EYE' || s === '25') && adjacentTo(seg, s)) {
      nearmiss = true;               // stopped one peg from an EYE or 25 you backed
    }
  }
  return { stake, gross, nearmiss, winners };
}

/**
 * Golden Ratchet: one step along the wheel toward the nearest segment this seat backs (the shorter way round; ties
 * go clockwise). A seat that already sits on a backed segment, or has no bets, leaves the wheel alone.
 */
export function stepToward(seg: number, bets: readonly Bet[]): number {
  const want = new Set<Sym>(bets.filter((b) => b.a > 0).map((b) => b.s));
  const n = SEGMENT_COUNT;
  if (!want.size || want.has(SEGMENTS[seg])) return seg;
  let fwd = -1, back = -1;
  for (let k = 1; k < n && (fwd < 0 || back < 0); k++) {
    if (fwd < 0 && want.has(SEGMENTS[(seg + k) % n])) fwd = k;
    if (back < 0 && want.has(SEGMENTS[(seg - k + n) % n])) back = k;
  }
  return fwd <= back ? (seg + 1) % n : (seg - 1 + n) % n;
}

export interface SpinOutcome {
  seg: number;               // the segment the wheel finally stops on
  first: number;             // the first draw (the one `peek` reports; a luck reroll can still replace it)
  rerolled: boolean;         // solo luck reroll took the second draw
  nudges: number;            // Golden Ratchet steps that actually moved the wheel
  creeped: boolean;          // a charm creep moved the stop onto a backed segment
  seats: SeatSettle[];       // one per layout, in order
}

/**
 * One spin for every seat's layout. `first` is the draw made earlier (at OPEN, for `peek`); pass `-1` to draw now.
 * Luck (`luck` %, 0 in refund mode): if the table is net negative, one reroll with p = luck/100. `nudgers` are the
 * layouts of seats that paid for a Golden Ratchet step. Always consumes the same draws, so a seed replays identically.
 */
export function spin(
  rng: Rng, layouts: readonly (readonly Bet[])[], m: Mods, luck: number, first = -1,
  nudgers: readonly (readonly Bet[])[] = [],
): SpinOutcome {
  const f = first >= 0 ? first : drawSeg(rng, m.weights);
  const second = drawSeg(rng, m.weights);
  const gate = rng.next();
  const creepRoll = rng.next();
  const netOf = (p: number): number => layouts.reduce((acc, l) => { const s = settleSeat(l, p, m); return acc + s.gross - s.stake; }, 0);
  const rerolled = luck > 0 && netOf(f) < 0 && gate < luck / 100;
  let seg = rerolled ? second : f;

  let nudges = 0;
  for (const bets of nudgers) {
    const next = stepToward(seg, bets);
    if (next !== seg) { seg = next; nudges++; }
  }

  let creeped = false;
  if (m.creep > 0 && creepRoll < 0.5) {
    const n = SEGMENT_COUNT;
    const backed = new Set<Sym>();
    for (const l of layouts) for (const b of l) if (b.a > 0) backed.add(b.s);
    for (const step of [1, -1]) {
      const near = (seg + step + n) % n;
      if (backed.has(SEGMENTS[near]) && SEGMENTS[seg] !== SEGMENTS[near]) { seg = near; creeped = true; break; }
    }
  }

  return { seg, first: f, rerolled, nudges, creeped, seats: layouts.map((l) => settleSeat(l, seg, m)) };
}

/** Headless round for staff auto-play and balance sims: one bet on "1" of `bet`, same rules as the live table. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const m = defaultMods();
  const out = spin(rng, [[{ s: '1', a: bet }]], m, h.luck);
  return { gross: out.seats[0].gross, tags: out.rerolled ? ['lucky'] : [] };
};
