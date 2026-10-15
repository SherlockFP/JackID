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
 *
 * Wave 23 (flow-fixes): the N3 -> N4 step was a wall (115 -> 205 = 1.78x; playtest 110 -> 195 with 9 pulls against an 89 pocket).
 * N4 is 140 (1.22x from N3, 1.79x to N5; every step <= 2.2x). Human bot (2000 runs, seeds 20261013, 1, 7, 99): N3 51 %, N4 36-37 % (was 31 %),
 * N5 28-29 %. The pull count barely moves N4 reach (11 pulls: 32 %), so the quota is the lever.
 */
/**
 * Wave 46 (director, HOUSE MOOD): the payout mood (houseMood.ts: N1 x1.12 … N8 x0.95) pays the early Nights more, so the human bot
 * reaches N1-N3 more often and the ladder is re-tuned for the same targets. Human bot, 2000 runs, seed 20261013: quota ladder
 * 31, 42, 84, 168, 336, 576, 1150, 2300 gives reach N1 88.5 %, N2 72 %, N3 52 %, N4 40 %, N5 35 %, N6 32 %, N7 30 %, N8 28 %.
 * N5 cannot reach ~30 % under the 2x cap: N5 <= 2 x N4 and N4 <= 2 x N3, so with N3 at 52 % N4 cannot fall below ~40 %, and N5
 * stays ~35 %. A design call for the director (a higher N3 quota drops N3 under target).
 */
/**
 * Wave 42 (director decision 1): interest falls smoothly, one step per Night: 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20 (N1..N8),
 * monotonic, so no Night is a cliff. Overdrawn interest continues the slope (0.20 - 0.04 k, floor 0.04).
 * The quota ladder is then tuned for the same human bot (scripts/sim/run.mjs, 2000 runs, seed 20261013), each step <= 2x and
 * strictly increasing: N2 44, N3 88, N4 176 ... N8 2816 (the N2 and N3 targets are the lever; N5 and N8 are bounded, see the
 * sim header). Reach: N1 86 %, N2 66 %, N3 50 %, N4 39 %, N5 33 %, N6 29 %, N7 26 %, N8 23 %.
 * Why N5 and N8 stay high: with each Night at most 2x the one before, N5 <= 4 x N3 and N8 <= 64 x N2. A quota of 20 000 at N8
 * still leaves ~20 % reaching it (the survivors' pockets are far above the quota), so the late reach has a floor the ladder cannot cut.
 */
/**
 * Wave 41 (director decision 4): Night 1 interest 0.90 -> 0.50 (the bank was the first Night's cash engine: "30 -> 98 coins by
 * Night 2" was too easy), and Night 2 0.30 -> 0.90 because without it the human bot's Night 3 reach fell 52 % -> 23 % (the
 * Night 1 surplus is the Night 2 pocket). Human bot, 2000 runs, seed 20261013: N1 84.7 %, N2 62.8 %, N3 48.7 %, N4 36.9 %,
 * N5 28.9 %, N6 23.4 %, N7 17.9 %, N8 15.3 %. N1 at 0.55 would give 86 %.
 */
/**
 * Wave 45 (director, between-Watch flow and smart stakes): the human bot now stakes 5-15 % of the pocket a pull (scripts/sim/run.mjs),
 * which lifts its early reach, so the ladder is re-tuned to base 31, 38, 72, 144, 288, 576, 1150, 2300 (each step <= 2x, strictly
 * increasing, sig-3 values). Human bot, 2000 runs, seed 20261013: N1 86.8 %, N2 70.5 %, N3 50.0 %, N4 38.1 %, N5 34.0 %, N6 31.1 %,
 * N7 28.8 %, N8 26.9 %. N5 stays near 34 %, not 30: with N3 at ~50 % the 2x cap allows N5 <= 4 x N3 = 288, and a higher N5 needs a
 * higher N3 (which drops N3 below target). A design call for the director.
 */
/**
 * Wave 47b (director): 3x late steps made Night 5 a cliff (160 -> 504); the base ladder is back to 2x steps and the House-notice wealth floor carries the late tension.
 * Wave 47 (director, late snowball): from Night 4 a ladder step may be up to 3x (N5 504 = 3 x N4; N6 1510, N7 4520, N8 13500 are
 * ~3x each), and from Night 5 the House takes notice of the wealth (`houseNoticeQuota`: quota >= 1.2 x the coins held at the Dawn
 * before). Human bot, 2000 runs, seed 20261013 (scripts/sim/run.mjs): reach N1 89 %, N2 72 %, N3 52 %, N4 40 %, N5 25 %, N6 21 %,
 * N7 18 %, N8 10 %; survivors' N8 pocket 33k against a quota of 93k (about 2.8x). Seeds 1 and 99 give N8 11 % and 10 %.
 * The ladder values after N5 do not move the human numbers (the wealth floor binds from N5); they set the floor for weak runs.
 * Cost (a design call for the director): the rotator and banker bots fall off late (rotator N6 22 %, N7 4 %, N8 0 %, was 76/75/75 %);
 * a share of 0.6 keeps them but leaves the human N8 near 23 %. See the sim header for the grid.
 * Wave 47b (director decision): the share is 1.2, not 1.9 (1.9 punished success too hard). Human bot, 2000 runs, seed 20261013:
 * reach N1 88.5 %, N2 72 %, N3 52 %, N4 40 %, N5 31 %, N6 25 %, N7 23 %, N8 22 %; the rotator and banker keep N8 near 25 %.
 * The human N8 ~22 % is accepted by the director (the design floor was ~15 %).
 */
export const BASE_NIGHTS: readonly NightDef[] = [
  { no: 1, floor: 'B7', name: 'first', base: 31, watches: 3, pulls: 7, clock: 150, interest: 0.55, favour: 1.25, si: 1, card: 0 },
  { no: 2, floor: 'B6', name: 'second', base: 42, watches: 3, pulls: 7, clock: 150, interest: 0.50, favour: 1.15, si: 3, card: 3 },
  { no: 3, floor: 'B5', name: 'third', base: 84, watches: 3, pulls: 8, clock: 165, interest: 0.45, favour: 1.07, si: 10, card: 3 },
  { no: 4, floor: 'B4', name: 'fourth', base: 168, watches: 3, pulls: 9, clock: 165, interest: 0.40, favour: 1, si: 30, card: 4 },
  { no: 5, floor: 'B3', name: 'fifth', base: 336, watches: 4, pulls: 8, clock: 180, interest: 0.35, favour: 1, si: 100, card: 4 },
  { no: 6, floor: 'B2', name: 'sixth', base: 672, watches: 4, pulls: 9, clock: 180, interest: 0.30, favour: 1, si: 300, card: 4 },
  { no: 7, floor: 'B1', name: 'seventh', base: 1344, watches: 4, pulls: 9, clock: 195, interest: 0.25, favour: 1, si: 1000, card: 4 },
  { no: 8, floor: 'G', name: 'final', base: 2688, watches: 4, pulls: 10, clock: 210, interest: 0.20, favour: 1, si: 3000, card: 5 },
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
    interest: Math.max(0.04, 0.20 - 0.04 * k),
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
/**
 * Closing window (director, wave 41): at most 3 s in every Watch. The HUD says WATCH ENDING; deposits, withdrawals and the Pawn
 * stay open during it, and the Watch settles when it ends. (It was 15 / 10 s and felt dead.)
 */
export const CLOSING_SEC = 3;
export function closingSeconds(_isLastWatch?: boolean): number { return CLOSING_SEC; }

/** Base quota before modifiers, Discount and Assessment ("BaseQuota(n)"). */
export function baseQuota(index: number): number { return nightDef(index).base; }

/**
 * Floor event per Watch (wave 43): the chance each Watch from Night 1 rolls one short event (seeded, see `watchEvents.ts`).
 * Boss Nights roll none.
 */
export const WATCH_EVENT_CHANCE = 0.75;

/**
 * Pawn price scale f(night) (Wave 20). A charm costs `def.price × SI × f`. f never raises a price: it is 1 until the dearest
 * Common (`commonTop` base price × SI) would cost more than PAWN_COMMON_QUOTA_SHARE of the Night's base quota, then it brings
 * that Common down to the share. The cheapest charm (a Common) is then at most ~30 % of the quota, and Rares / Legendaries
 * may still exceed it. `si` is the Night's live stake index.
 */
export const PAWN_COMMON_QUOTA_SHARE = 0.6;
export function pawnPriceScale(index: number, si: number, commonTop: number): number {
  const top = Math.max(0, commonTop) * Math.max(1, si);
  if (top <= 0) return 1;
  return Math.min(1, (PAWN_COMMON_QUOTA_SHARE * nightDef(index).base) / top);
}

/** Assessment applies from Night 3 (index 2): round(rate × Holdings). Rate 8 % (charm `property_deed` → 4 %). */
export function assessmentFor(index: number, holdings: number, rate = 0.08): number {
  return index >= 2 ? Math.round(rate * holdings) : 0;
}

/**
 * HOUSE TAKES NOTICE (wave 47, director: the late Nights were trivial for survivors). From `HOUSE_NOTICE_FROM` on, the quota of a
 * Night is at least `HOUSE_NOTICE_SHARE` x the coins the player held at the Dawn before (pocket + banked, before that Dawn pays
 * the quota). The ladder stays the floor, so the rule only bites a run that is rich: its threshold is the ladder value itself.
 * `share` 0 switches it off. Pure: the caller passes the wealth it read at Dawn.
 */
export const HOUSE_NOTICE_FROM = 5;
export const HOUSE_NOTICE_SHARE = 1.2;
export function houseNoticeQuota(no: number, ladderQuota: number, wealth: number, share = HOUSE_NOTICE_SHARE, from = HOUSE_NOTICE_FROM): number {
  if (share <= 0 || no < from || wealth <= 0) return ladderQuota;
  return Math.max(ladderQuota, sig(share * wealth, 3));
}
/**
 * Largest allowed step of the ladder into a Night (quota / quota of the Night before). 2x up to Night 3, 3x from Night 4 (wave 47):
 * the late Nights may step harder, the early ones stay gentle so the first three Nights keep their reach.
 */
export function maxLadderStep(no: number): number { return no >= 4 ? 3 : 2; }

/**
 * Quota(n) = round3sig(BaseQuota × (1 − discount) × coopScale × houseEdge) + Assessment(n) (GDD §2.6.2).
 * `discount` (≤ 0.15), `coopScale` and `houseEdge` are passed in by the caller; the mod pipeline folds into them.
 */
export function quotaFor(index: number, o: { discount?: number; coopScale?: number; houseEdge?: number; holdings?: number; assessRate?: number; wealth?: number } = {}): number {
  const discount = Math.min(0.15, Math.max(0, o.discount ?? 0));
  const core = sig(baseQuota(index) * (1 - discount) * (o.coopScale ?? 1) * (o.houseEdge ?? 1), 3);
  return houseNoticeQuota(index + 1, core, o.wealth ?? 0) + assessmentFor(index, o.holdings ?? 0, o.assessRate);
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

/**
 * Live interest for one Settle (Wave 20): the schedule rate plus the `x.econ.interestAdd` bonuses (charms, buffs), floored at 0,
 * on the deposit capped at 2 × the Night's due. `due` is the LOAN-INFLATED due (`quota.due`: Assessment, quota mods and rescue
 * loans included), the same number Settle and the rescue check read. The Terminal's "+N% per Watch" text reads `rate` too.
 */
export function liveInterest(index: number, bonus: number, deposit: number, due: number): { rate: number; amount: number; cap: number } {
  const rate = interestRate(nightDef(index).interest, bonus);
  return { rate, amount: interestFor(deposit, due, rate), cap: Math.max(0, 2 * due) };
}

/** A rate as the whole percent the player reads ("+90 %"). */
export function ratePercent(rate: number): number { return Math.round(rate * 100); }

/** Pulls used in a Watch below this count forfeit that Watch's interest (activity clause). */
export const ACTIVITY_MIN_PULLS = 1; // was 3: with the Bell always available, a hidden 3-pull gate silently zeroed interest
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

// ─â”€ THE CIRCUIT (GDD §3.4): Tilt and Lamps ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€
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

// ─â”€ Obols (GDD §11.2) ─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─â”€─
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
