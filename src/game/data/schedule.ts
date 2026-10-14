/**
 * Night schedule, quota curve, interest and overpay tiers (GDD §2.4, §2.6). Pure data + pure maths: no three, no DOM.
 * Index convention (ShiftState.index, DebtState.index): 0-based. `nightNo = index + 1` is the printed Night.
 */
import type { OvershootTier } from '@/game/types';
/** Round to d significant digits without float noise (1.6e7 stays 1.6e7). */
const sig = (n: number, d: number): number => Number(n.toPrecision(d));

export interface NightDef {
  /** Printed Night number (1..8 base run). */
  no: number;
  /** Floor dial label. */
  floor: string;
  /** i18n key suffix → `game.night.<no>.name`. */
  name: string;
  /** Base quota before Assessment (GDD §2.4). */
  base: number;
  watches: number;
  pulls: number;
  /** Clock seconds per Watch. */
  clock: number;
  /** Interest rate per Settle. */
  interest: number;
  /** House Favour M-factor on payouts (1 = none). */
  favour: number;
  /** Stake index (SI). */
  si: number;
  /** Punch card side length (0 = no card yet). */
  card: number;
}

/**
 * GDD §2.4 base run, Nights 1–8 (index 0..7).
 * Economy decision (wave 13): base machines are slightly negative EV (RTP 0.91–0.97); the player turns +EV through decisions
 * (Hot Lamp, rotating off Tilt, interest, phone deals, Pawn charms). The base quota ladder is STRICTLY increasing, from just above
 * the Pauper pocket (30) up to the late Nights where stakes and Pawn prices scale with SI.
 *
 * Wave 19 (director): the quota ladder is SMOOTH, no Night steps up more than ~2.1× the one before (the old 40 → 198 and
 * 208 → 1000 → 14000 → 115000 jumps were cliffs). Tuned with the casual human bot as the primary target (scripts/sim/run.mjs,
 * 2000 runs, seed 20261013): reach N1 90 %, N2 76 %, N3 51 %, N4 32 %, N5 26 %, N6 22 %, N7 20 %, N8 20 %. N8 ~5 % is not
 * reachable with a 2.1× cap while SI steps 3.3× a Night: a surviving player's pocket outruns the quota. SI's late steps are the
 * lever (1, 2, 4 … 128 gives N8 ~4 %), a design call left to the director.
 */
export const BASE_NIGHTS: readonly NightDef[] = [
  { no: 1, floor: 'B7', name: 'first', base: 31, watches: 3, pulls: 7, clock: 150, interest: 0.90, favour: 1.25, si: 1, card: 0 },
  { no: 2, floor: 'B6', name: 'second', base: 58, watches: 3, pulls: 7, clock: 150, interest: 0.30, favour: 1.15, si: 3, card: 3 },
  { no: 3, floor: 'B5', name: 'third', base: 115, watches: 3, pulls: 8, clock: 165, interest: 0.28, favour: 1.07, si: 10, card: 3 },
  { no: 4, floor: 'B4', name: 'fourth', base: 205, watches: 3, pulls: 9, clock: 165, interest: 0.26, favour: 1, si: 30, card: 4 },
  { no: 5, floor: 'B3', name: 'fifth', base: 250, watches: 4, pulls: 8, clock: 180, interest: 0.22, favour: 1, si: 100, card: 4 },
  { no: 6, floor: 'B2', name: 'sixth', base: 520, watches: 4, pulls: 9, clock: 180, interest: 0.20, favour: 1, si: 300, card: 4 },
  { no: 7, floor: 'B1', name: 'seventh', base: 1100, watches: 4, pulls: 9, clock: 195, interest: 0.16, favour: 1, si: 1000, card: 4 },
  { no: 8, floor: 'G', name: 'final', base: 2300, watches: 4, pulls: 10, clock: 210, interest: 0.12, favour: 1, si: 3000, card: 5 },
];

export const BASE_RUN_NIGHTS = BASE_NIGHTS.length;

/** Overdrawn (endless) Night n ≥ 9 (GDD §2.4). */
export function overdrawnNight(no: number): NightDef {
  const k = no - 8;
  return {
    no,
    floor: `B${no - 7}`,
    name: 'overdrawn',
    base: sig(BASE_NIGHTS[BASE_RUN_NIGHTS - 1].base * Math.pow(1.7, k), 3),
    watches: 4,
    pulls: 10,
    clock: 210,
    interest: Math.max(0.04, 0.12 - 0.01 * k),
    favour: 1,
    si: sig(3000 * Math.pow(3.5, k), 2),
    card: 5,
  };
}

/** Night definition for a 0-based index (base run or Overdrawn). */
export function nightDef(index: number): NightDef {
  const no = index + 1;
  return no <= BASE_RUN_NIGHTS ? BASE_NIGHTS[index] : overdrawnNight(no);
}

/**
 * Witching Watch (GDD §2.2): the Watch that begins at or contains 03:00.
 * 3-Watch Nights: Watch 2 (index 1). 4-Watch Nights: Watch 3 (index 2).
 */
export function isWitchingWatch(watches: number, watchIndex: number): boolean {
  return watches === 3 ? watchIndex === 1 : watchIndex === 2;
}

/** Last Call length in seconds (30 in the last Watch of a Night, 20 otherwise). */
export function lastCallSeconds(isLastWatch: boolean): number { return isLastWatch ? 30 : 20; }
/** Closing grace in seconds (15 in the last Watch, 10 otherwise). */
export function closingSeconds(isLastWatch: boolean): number { return isLastWatch ? 15 : 10; }

/** Base quota before modifiers, Discount and Assessment ("BaseQuota(n)"). */
export function baseQuota(index: number): number { return nightDef(index).base; }

/** Assessment applies from Night 3 (index 2): round(rate × Holdings). Rate 8 % (charm `property_deed` → 4 %). */
export function assessmentFor(index: number, holdings: number, rate = 0.08): number {
  return index >= 2 ? Math.round(rate * holdings) : 0;
}

/**
 * Quota(n) = round3sig(BaseQuota × (1 − discount) × coopScale × houseEdge) + Assessment(n) (GDD §2.6.2).
 * `discount` (≤ 0.15), `coopScale` and `houseEdge` are passed in by the caller; the mod pipeline folds into them.
 */
export function quotaFor(index: number, o: { discount?: number; coopScale?: number; houseEdge?: number; holdings?: number; assessRate?: number } = {}): number {
  const discount = Math.min(0.15, Math.max(0, o.discount ?? 0));
  const core = sig(baseQuota(index) * (1 - discount) * (o.coopScale ?? 1) * (o.houseEdge ?? 1), 3);
  return core + assessmentFor(index, o.holdings ?? 0, o.assessRate);
}

/** Overpay tiers on `r = deposit ÷ quota` (GDD §2.6.5). Cumulative; each tier is awarded once per Night. */
export const OVERSHOOT_TIERS: readonly OvershootTier[] = [
  { id: 'gratuity', ratio: 1.1, reward: { currencies: { coin: 0, ticket: 2, obol: 0 }, text: 'game.overshoot.gratuity' } },
  { id: 'favoured', ratio: 1.25, reward: { buffs: [{ id: 'favoured' }], text: 'game.overshoot.favoured' } },
  { id: 'uncommon', ratio: 1.5, reward: { charm: { choose: 1, of: 3, rarity: 'uncommon' }, text: 'game.overshoot.uncommon' } },
  { id: 'golden', ratio: 2, reward: { charm: { choose: 1, of: 3, rarity: 'rare' }, nextQuotaDiscount: 0.05, text: 'game.overshoot.golden' } },
];

/** Interest rate for a Watch: schedule rate + `x.econ.interestAdd` bonuses (charms), floored at 0 (GDD §2.6.3). */
export function interestRate(scheduleRate: number, bonus: number): number {
  return Math.max(0, scheduleRate + bonus);
}

/** Interest paid at Settle: floor(min(deposit, 2 × quota) × rate). */
export function interestFor(deposit: number, quota: number, rate: number): number {
  if (deposit <= 0 || rate <= 0) return 0;
  return Math.floor(Math.min(deposit, 2 * quota) * rate);
}

/** Pulls used in a Watch below this count forfeit that Watch's interest (activity clause). */
export const ACTIVITY_MIN_PULLS = 3;
/** Ceiling of the House limit: one play pays at most this multiple of the current quota. */
export const HOUSE_LIMIT_QUOTA_MULT = 5;
/** Share of each bet fed into the network jackpot pool. */
export const NETWORK_FEED = 0.01;
/** Ticket cap. */
export const TICKET_CAP = 99;
/** Starting values (GDD §2.5, kit Pauper). */
export const START: { pocket: number; tickets: number; pegs: number; pegCap: number; jackpotSeed: number } = { pocket: 30, tickets: 2, pegs: 6, pegCap: 9, jackpotSeed: 50 };

/**
 * Index convention self-check. `nightDef(index)` takes the 0-based Night index (`shift.index`, `debt.index`) and returns
 * the printed 1-based `no`. Returns the problems found (empty = consistent). `scripts/tests` should assert it is empty.
 */
export function indexConventionProblems(): string[] {
  const out: string[] = [];
  for (let i = 0; i < BASE_RUN_NIGHTS + 2; i++) {
    const no = nightDef(i).no;
    if (no !== i + 1) out.push(`nightDef(${i}).no is ${no}, expected ${i + 1}`);
  }
  return out;
}

// ── THE CIRCUIT (GDD §3.4): Tilt and Lamps ────────────────────────────────────────────────────────
/** Pulls on one instance per Watch that still pay in full (GDD §3.4.3: pulls 1–4 are ×1.00). */
export const TILT_FREE_PULLS = 4;
/** Hot Lamps come with Night 1 (playtest 6/10: the first Night needs a way out of a dry Watch). */
export const LAMP_FIRST_NIGHT = 1;
/** Cold Lamps and the punch card still come with B6 (GDD §1 tiers): Night 2. */
export const COLD_FIRST_NIGHT = 2;
/** Hot Lamps per Watch (GDD §3.4.4): 1 on Nights 1–4, 2 from Night 5. Co-op adds +1 per 3 players elsewhere. */
export function hotLampCount(nightNo: number): number {
  if (nightNo < LAMP_FIRST_NIGHT) return 0;
  return nightNo >= 5 ? 2 : 1;
}
/** Cold Lamps per Watch: none before Night 2, then 1 (+ `extra`, the `x.lamp.coldCount` charms), never below 0. */
export function coldLampCount(nightNo: number, extra = 0): number {
  if (nightNo < COLD_FIRST_NIGHT) return 0;
  return Math.max(0, 1 + Math.round(extra));
}

// ── Obols (GDD §11.2) ─────────────────────────────────────────────────────────────────────────────
export type ObolOutcome = 'fell' | 'descend' | 'topside' | 'quit';
/** Outcome multipliers: fall ×0.5, Descend ×1.0, Topside STAY UP ×1.5, abandon ×0.25. */
export const OBOL_OUTCOME_MULT: Readonly<Record<ObolOutcome, number>> = { fell: 0.5, descend: 1, topside: 1.5, quit: 0.25 };
/**
 * `floor( floor(0.6 × cbrt(totalDeposited)) × outcomeMult × (1 + 0.10 × HouseEdge) × gain )`.
 * `deposited` is the run's total deposited (it grows with every Night paid), `gain` the Foundations multiplier (`x.meta.obolGain`).
 */
export function obolsFor(o: { deposited: number; outcome: ObolOutcome; edge?: number; gain?: number }): number {
  const dep = Math.max(0, o.deposited);
  if (dep <= 0) return 0;
  const base = Math.floor(0.6 * Math.cbrt(dep));
  const v = base * OBOL_OUTCOME_MULT[o.outcome] * (1 + 0.1 * Math.max(0, o.edge ?? 0)) * Math.max(0, o.gain ?? 1);
  return Math.max(0, Math.floor(v + 1e-9));
}
