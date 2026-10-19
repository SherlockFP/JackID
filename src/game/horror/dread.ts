/**
 * Dread meter (GDD §6.2). Pure: no three, no DOM, no bus. The director feeds it the run state each frame.
 *
 *   dread = clamp(nightBase[n] + pressure + eventDread + 3 × cursedCharms − 8 × brightBulbs − charmRelief, 0, cap)
 *
 * `cap` is 99 before Night 6 (no Visitation). The shown value slews towards the target so a single bump never snaps.
 */
import { clamp } from '@/core/math';

export type DreadTier = 'calm' | 'uneasy' | 'haunted' | 'watched' | 'dire';
export type DreadEventKind =
  | 'blackout' | 'fullMoon' | 'witchingWatch' | 'missedCall' | 'cursedCandy' | 'breathing' | 'shrineCurse' | 'flicker';

/** eventDread points per kind (GDD §6.2). Flicker bursts are cosmetic and add nothing. */
export const EVENT_DREAD: Record<DreadEventKind, number> = {
  blackout: 10, fullMoon: 15, witchingWatch: 10, missedCall: 5, cursedCandy: 10, breathing: 10, shrineCurse: 15, flicker: 0,
};

const EVENT_DECAY_PER_S = 1 / 6;   // eventDread decays 1 point per 6 s
const SLEW_PER_S = 20;             // shown value moves at most this many points per second
const NIGHT_BASE = [0, 5, 12, 20, 30, 40, 50, 60];

export interface DreadInput {
  /** Current Night, 1-based (QuotaState.index). */
  night: number;
  /** Fraction of the Night elapsed, 0..1. */
  nightElapsed: number;
  deposit: number;
  quota: number;
  /** Cursed charms held by the player (or the shared pool in co-op). */
  cursedCharms: number;
  /** Brighter Bulbs level, 0..4. */
  brightBulbs: number;
  /** Relief from calming charms / tonics (points, signed: negative adds Dread, e.g. cursed `dread.add` effects). */
  charmRelief: number;
}

/** nightBase: N1 0 … N8 60; Overdrawn (n > 8) min(80, 60 + 2·(n−8)). */
export function nightBase(n: number): number {
  if (n <= 8) return NIGHT_BASE[clamp(Math.floor(n), 1, 8) - 1];
  return Math.min(80, 60 + 2 * (n - 8));
}

/** DESCENT's quota-pressure term: 30 × clamp(elapsed × (1 − deposit/quota) × 1.5, 0, 1). */
export function pressure(nightElapsed: number, deposit: number, quota: number): number {
  const left = quota > 0 ? clamp(1 - deposit / quota, 0, 1) : 0;
  return 30 * clamp(nightElapsed * left * 1.5, 0, 1);
}

/** Upper bound of the meter for a Night: 99 before Night 6, 100 from Night 6 on. */
export function dreadCap(night: number): number { return night < 6 ? 99 : 100; }

/** Tier from a dread value (GDD §6.2 table). 100 reads as Dire (the Visitation itself is not modelled here). */
export function tierOf(v: number): DreadTier {
  if (v >= 80) return 'dire';
  if (v >= 60) return 'watched';
  if (v >= 40) return 'haunted';
  if (v >= 20) return 'uneasy';
  return 'calm';
}

/** Tier order for comparisons (calm < uneasy < haunted < watched < dire). */
export const TIER_RANK: Record<DreadTier, number> = { calm: 0, uneasy: 1, haunted: 2, watched: 3, dire: 4 };

/** Pure target value for a given input and accumulated event dread (no slew, no cap applied to the events). */
export function targetDread(i: DreadInput, eventDread: number): number {
  const raw = nightBase(i.night) + pressure(i.nightElapsed, i.deposit, i.quota) + eventDread
    + 3 * i.cursedCharms - 8 * i.brightBulbs - i.charmRelief;
  return clamp(raw, 0, dreadCap(i.night));
}

export class DreadMeter {
  private event = 0;      // accumulated eventDread
  private target = 0;
  private shown = 0;

  /** Add event dread for `kind` (scaled by `mul`, e.g. 0.5 in Calm Mode). */
  bump(kind: DreadEventKind, mul = 1): void {
    this.event += EVENT_DREAD[kind] * mul;
  }

  /** Advance by `dt` sim seconds with the current run state. Returns the shown value (0..100). */
  update(dt: number, i: DreadInput): number {
    if (dt > 0) {
      this.event = Math.max(0, this.event - dt * EVENT_DECAY_PER_S);
    }
    this.target = targetDread(i, this.event);
    const step = SLEW_PER_S * Math.max(0, dt);
    this.shown = this.shown + clamp(this.target - this.shown, -step, step);
    return this.shown;
  }

  /** Shown value 0..100 (slewed). */
  get value(): number { return this.shown; }
  /** Target value 0..100 before slew. */
  get goal(): number { return this.target; }
  get tier(): DreadTier { return tierOf(this.shown); }
  /** Accumulated event dread (diagnostics, tests). */
  get events(): number { return this.event; }

  /** Force a value (load / resume). Clears the event accumulator. */
  set(value: number, eventDread = 0): void {
    this.shown = clamp(value, 0, 100);
    this.target = this.shown;
    this.event = Math.max(0, eventDread);
  }
}
