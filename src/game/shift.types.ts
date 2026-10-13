/**
 * Shift / quota / rules / nightly events / dread — TD-FROZEN types. Implementation: GAME-RUN
 * (`run.ts`, `clock.ts`, `modes/**`) + GAME-EVENTS. Contract: BRIEF ADDENDA 1, 3, 5, 8; GDD §2.
 *
 * Vocabulary (GDD "Night/Watch" maps onto this generically so design can retune without touching types):
 *  - **shift**   one quota period (the brief's "deadline", the GDD's "Night"). Real-time, host-clocked.
 *  - **segment** optional sub-period inside a shift (GDD "Watch"); `ShiftState.segment`.
 *  - **quota**   coins that must be deposited into the Debt Terminal before the shift ends.
 * All times in the state are HOST milliseconds (`Session.hostTime()`); `timeLeft()` is in seconds.
 */
import type { Hex, Json, PlayerId, Unsub } from '@/core/types';
import type { SymbolId } from '@/core/texgen/types';
import type { CutsceneId } from '@/core/cutscene/types';
import type { MusicStateId, StingerId } from '@/core/audio/types';
import type { ModEffect } from './modifiers.types';
import type { RewardSpec } from './economy.types';

/**
 * Fine phase inside a shift.
 * bell → play → lastCall (final N s, red clock) → closing (grace to finish plays/deposits) → settle (interest,
 * tilt reset) → collection (the Collector arrives; pay or fall) → intermission (shop, upgrades, vote) → next shift.
 * `idle` before the first shift / in Free mode.
 */
export type ShiftPhase = 'idle' | 'bell' | 'play' | 'lastCall' | 'closing' | 'settle' | 'collection' | 'intermission' | 'over';

/** One reward tier of the quota overshoot bonus ("deposit ≥ 125 % → free charm"). */
export interface OvershootTier {
  id: string;                          // strings → 'overshoot.<id>'
  /** deposited ÷ due at which the tier is earned (cumulative with lower tiers). */
  ratio: number;
  reward: RewardSpec;
}
/** Tier earned in the current shift (shown in the receipt). */
export interface OvershootClaim { id: string; at: number /* host ms */ }

export interface QuotaState {
  /** Coins that must be deposited this shift, after all `quota.*` modifiers and assessment. */
  due: number;
  /** Pre-modifier base amount (terminal printout "BASE x · ASSESSMENT y"). */
  base: number;
  /** Extra tax on built assets (tycoon holdings) — see GDD §3.7.9. 0 if unused. */
  assessment: number;
  /** Deposited so far: the team pool in co-op, the player's own in versus/solo. */
  deposited: number;
  /** Contribution ledger for "who paid what" (co-op feed, ledger board). */
  perPlayer: Record<PlayerId, number>;
  met: boolean;
  /** max(0, deposited − due). */
  overshoot: number;
  /** deposited ÷ due (0 if due is 0). */
  ratio: number;
  /** Overshoot tiers already awarded this shift. */
  claimed: OvershootClaim[];
}

/** An active boss/ante/house rule (data id + runtime payload). */
export interface ActiveRule { id: string; since: number; data?: Json }
export interface ShiftRuleDef {
  id: string;                          // strings → 'rule.<id>.name|desc'
  kind: 'boss' | 'ante' | 'house' | 'curse';
  icon: SymbolId;
  /** Modifier contributions while active. */
  effects?: ModEffect[];
  /** Opaque world/game hooks (e.g. 'all-sevens-cursed', 'twins-duel') interpreted by their owners. */
  hooks?: string[];
  /** Eligible shift index range (inclusive); boss rules pin `shift` instead. */
  minShift?: number; maxShift?: number;
  shift?: number | number[];
  weight?: number;
  /** Scripted intro / defeat cutscenes for bosses. */
  introCutscene?: CutsceneId;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}

export interface ShiftState {
  /** 0-based shift number within the run. */
  index: number;
  /** Floor depth shown on the dial (1 = start; endless goes beyond the printed scale). */
  floor: number;
  phase: ShiftPhase;
  /** Host ms: when the real-time play window started / ends; 0 outside play. */
  startedAt: number;
  endsAt: number;
  /** Total length of the play window (s) and the red "last call" tail (s). */
  duration: number;
  lastCallSec: number;
  /** Optional sub-periods (GDD "Watch"). */
  segment?: { index: number; count: number };
  /** Stake index: multiplies max bets and SI-priced items (GDD §3.2). */
  stake: number;
  /** Cosmetic wall-clock progress 0..1 across the shift (the clock prop, music). */
  clock: number;
  quota: QuotaState;
  rules: ActiveRule[];
}

export interface ShiftApi {
  state(): Readonly<ShiftState>;
  readonly phase: ShiftPhase;
  /** Seconds left in the play window (0 outside play). */
  timeLeft(): number;
  quota(): Readonly<QuotaState>;
  /** Projected base quota of shift `index` (the exponential curve; Lift Operator calls, previews). */
  quotaFor(index: number): number;
  overshootTiers(): readonly OvershootTier[];
  /** Host: add (or remove) seconds from the play window. Mirrors `time.bonus`. */
  extend(sec: number): void;
  /** Host: end the play window early once the quota is met (GDD "Settle Early"). */
  settleEarly(): boolean;
  rules(): readonly ActiveRule[];
  registerRule(def: ShiftRuleDef): Unsub;
  ruleDef(id: string): ShiftRuleDef | undefined;
}

// ── nightly / global events ─────────────────────────────────────────────────────────────────────
/** World-side look of an event, applied by `World`/lights/audio — never by machines. */
export interface EventWorldFx {
  dread?: number;                      // + added to the dread meter while active
  lightLevel?: number;                 // × all lights (0 = blackout)
  lightColor?: Hex;
  fogMul?: number;
  keepLit?: Array<'screens' | 'phaseLamps' | 'railMeters'>;   // blackout exceptions
  music?: MusicStateId;
  sting?: StingerId;
}
export interface NightEventDef {
  id: string;                          // strings → 'event.<id>.name|desc|announce'
  icon: SymbolId;
  weight: number;
  /** Seconds, or 'shift' for the whole shift. */
  duration: number | 'shift';
  minShift?: number; maxShift?: number;
  effects?: ModEffect[];
  world?: EventWorldFx;
  /** Events in the same group never overlap. */
  exclusive?: string;
  cutscene?: CutsceneId;
  strings: { en: { name: string; desc: string; announce: string }; tr: { name: string; desc: string; announce: string } };
}
export interface ActiveEvent {
  id: string;
  startedAt: number;                   // host ms
  endsAt: number;                      // host ms, 0 = until shift end
  seed?: number;
}
export interface NightEventsApi {
  register(def: NightEventDef): Unsub;
  defs(): NightEventDef[];
  def(id: string): NightEventDef | undefined;
  active(): readonly ActiveEvent[];
  isActive(id: string): boolean;
  /** Host: start an event now (scripted beats, debug). */
  trigger(id: string, o?: { durationS?: number }): void;
  end(id: string): void;
  /** Probability that the roll at the next bell starts an event. */
  chance(): number;
}

// ── dread (horror meter) ────────────────────────────────────────────────────────────────────────
/** Thresholds the world/audio/music react to (0..1 scale of the 0..100 meter). */
export const DREAD_LEVELS = { calm: 0, uneasy: 0.25, afterHours: 0.5, visitation: 0.75, max: 1 } as const;
