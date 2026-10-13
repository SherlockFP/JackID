/**
 * Pace (WAVE8 item 5, the Tell Sheet): the quota arithmetic behind the quota board's NEED line and the seat HUD's
 * odds line. Pure: no DOM, no i18n, no run state. Callers pass numbers and turn the results into text.
 *
 *   need      = max(0, due − deposited − pocket)      coins still to find (pocket = the wallet, not yet deposited)
 *   perPull   = need / pullsLeft                       coins the average pull must return
 *   NEED ×k   = perPull × pullsPerPlay / bet           the gross multiple one play must return on this machine
 *   1 in j    = 1 / chanceAtLeast(profile, k)          how often a play on this machine gets there
 *
 * Odds come from `MACHINE_PROFILES` (scripts/sim-profiles.mjs). Between the tiers the chance is interpolated
 * log-log, so a ×6 need reads between the ×5 and ×10 rows.
 */
import type { MachineProfile, OddsClass } from './data/machineProfiles';
import type { InstanceId } from '@/core/types';

export interface PaceInput {
  /** Quota due this Night (`QuotaState.due`). */
  due: number;
  /** Coins already deposited (`QuotaState.deposited`, or the run's debt paid). */
  deposited: number;
  /** The wallet: coins that could still be deposited (`RunApi.wallet()`). */
  pocket: number;
  /** Pulls left in this Watch (`RunApi.pulls()`). */
  pullsLeft: number;
}

/** met: nothing left to find. open: pulls left to find it. dead: coins still missing and no pulls left. */
export type PaceState = 'met' | 'open' | 'dead';

export interface Pace {
  /** Coins still to find (>= 0). */
  need: number;
  /** Coins the average remaining pull must return (0 when met, Infinity when dead). */
  perPull: number;
  /** Pulls left, floored at 0. */
  pullsLeft: number;
  state: PaceState;
}

/** The quota pace from the run's numbers. */
export function paceOf(i: PaceInput): Pace {
  const need = Math.max(0, i.due - i.deposited - i.pocket);
  const pullsLeft = Math.max(0, Math.floor(i.pullsLeft));
  if (need <= 0) return { need: 0, perPull: 0, pullsLeft, state: 'met' };
  if (pullsLeft <= 0) return { need, perPull: Number.POSITIVE_INFINITY, pullsLeft: 0, state: 'dead' };
  return { need, perPull: need / pullsLeft, pullsLeft, state: 'open' };
}

/**
 * The gross multiple (return ÷ bet) one play must reach to carry its share of the need. A play that spends
 * `pullsPerPlay` pulls (`def.actionCost`) must return `perPull × pullsPerPlay`. Infinity when the stake is not
 * positive or the pace is dead; 0 when met.
 */
export function requiredMultiplier(p: Pace, pullsPerPlay: number, bet: number): number {
  if (p.state === 'met') return 0;
  if (p.state === 'dead' || !(bet > 0)) return Number.POSITIVE_INFINITY;
  return (p.perPull * Math.max(1, pullsPerPlay)) / bet;
}

/** The odds fields of a machine profile (the rest is display-only). */
export type OddsSource = Pick<MachineProfile, 'hit' | 'p2' | 'p5' | 'p10' | 'p25' | 'p100'>;

/** The tiers of the profile, as [multiplier, P(multiplier >= that)]. `hit` is P(> 0), used as the ×1 anchor. */
function anchors(o: OddsSource): Array<[number, number]> {
  return [[1, o.hit], [2, o.p2], [5, o.p5], [10, o.p10], [25, o.p25], [100, o.p100]];
}

/**
 * P(a play returns at least `mult` times its stake). 1 for mult <= 0, `hit` for mult in (0, 1], 0 beyond ×100 or
 * where the simulation never reached the tier. Between tiers it interpolates log(P) against log(mult). The result is
 * non-increasing in `mult`.
 */
export function chanceAtLeast(o: OddsSource, mult: number): number {
  if (Number.isNaN(mult)) return 0;
  if (mult <= 0) return 1;
  if (mult <= 1) return o.hit;
  const pts = anchors(o);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, p0] = pts[i];
    const [x1, p1] = pts[i + 1];
    if (mult > x1) continue;
    if (mult === x1) return p1;
    if (p0 <= 0 || p1 <= 0) return 0;
    const t = (Math.log(mult) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
    return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
  }
  return 0;
}

/** The "1 in N" figure for a chance, or null when the chance is zero (the simulation never saw it). */
export function oneIn(chance: number): number | null {
  return chance > 0 ? 1 / chance : null;
}

const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The N of "1 in N": one decimal under 10 (3.1), whole numbers with separators above (1,204). */
export function fmtOddsN(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 10) return String(Number(n.toFixed(1)));
  return grouped(n);
}

/** A coin figure for the NEED line: whole coins, rounded up so the stated need is never short. */
export function fmtNeed(x: number): string {
  if (!Number.isFinite(x)) return '∞';
  return grouped(Math.ceil(x));
}

/** The NEED multiple for the odds line: one decimal under 10 (×6.4), whole numbers above. */
export function fmtMult(k: number): string {
  if (!Number.isFinite(k)) return '∞';
  if (k < 10) return String(Number(k.toFixed(1)));
  return grouped(k);
}

/** The NEED part of the odds line: met / dead, or the multiple this play must return and its formatted 1-in-N. */
export type NeedOdds =
  | { kind: 'met' }
  | { kind: 'dead' }
  | { kind: 'open'; k: string; odds: string | null };

/**
 * The Tell Sheet line for one seat (WAVE8 item 5), as plain formatted parts so the seat HUD (a `_base` module, which may
 * not import game values) only lays out text. `profile` null = no odds (no headless play): returns null.
 * `pace` null = the odds alone. `odds: null` in NEED means the simulation never saw that multiple.
 */
export interface OddsLine {
  /** Plays behind the figures, formatted (200,000). */
  plays: string;
  cls: OddsClass;
  /** 1 in N for any win; null when never seen. */
  hit: string | null;
  /** 1 in N for a ×10 or better. */
  big: string | null;
  need: NeedOdds | null;
}

export function oddsLine(profile: MachineProfile | null, pace: Pace | null, pullsPerPlay: number, bet: number): OddsLine | null {
  if (!profile) return null;
  const one = (c: number): string | null => { const n = oneIn(c); return n === null ? null : fmtOddsN(n); };
  let need: NeedOdds | null = null;
  if (pace) {
    if (pace.state === 'met') need = { kind: 'met' };
    else if (pace.state === 'dead') need = { kind: 'dead' };
    else {
      const k = requiredMultiplier(pace, pullsPerPlay, bet);
      need = { kind: 'open', k: fmtMult(k), odds: one(chanceAtLeast(profile, k)) };
    }
  }
  return {
    plays: fmtOddsN(profile.plays),
    cls: profile.cls,
    hit: one(profile.hit),
    big: one(profile.p10),
    need,
  };
}

/** The run tells the seat HUD the odds line of the seat the player is in (on sitting, after each play, on a new Watch). */
export interface SeatOddsEvent { pid: number; mid: InstanceId; line: OddsLine | null }
declare module '@/core/events' {
  interface GameEvents {
    'seat:odds': SeatOddsEvent;
  }
}
