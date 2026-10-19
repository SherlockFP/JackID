/**
 * Win tiers (base-machines WP). Contract: TECH_SPEC §2.13 as AMENDED by §11.5, GDD §10.4 "Juice tiers".
 *
 * Thresholds are multiples of the round stake (`gross / bet`):
 *   0 → none · ≤ 1× push · < 3× small · < 10× medium · < 25× big (tag `bigwin`) · < 50× huge (`hugewin`)
 *   · ≥ 50× mega (`megawin`) · `jackpot` only when the machine tags the round `jackpot`.
 *
 * 'mega' is a member of the frozen `WinTier` (Contracts v1.1), so `JuiceTier` and `WinTier` are one scale.
 */
import type { Hex } from '@/core/types';
import { WIN_TIERS, type WinTier } from '@/game/types';

/** Presentation tiers (= `WinTier` since v1.1). */
export type JuiceTier = WinTier;

/** Lower bounds (× stake) of each tier. */
export const TIER_MULT = { medium: 3, big: 10, huge: 25, mega: 50 } as const;
const ORDER: readonly JuiceTier[] = ['none', 'push', 'small', 'medium', 'big', 'huge', 'mega', 'jackpot'];

/** Presentation tier of a result. `tags` containing `'jackpot'` (or a namespaced `'<machine>:jackpot'`) forces `'jackpot'`. */
export function juiceTier(gross: number, bet: number, tags?: readonly string[]): JuiceTier {
  if (!(gross > 0)) return 'none';
  if (tags?.some((tag) => tag === 'jackpot' || tag.endsWith(':jackpot'))) return 'jackpot';
  const m = bet > 0 ? gross / bet : Infinity;
  if (m <= 1) return 'push';
  if (m < TIER_MULT.medium) return 'small';
  if (m < TIER_MULT.big) return 'medium';
  if (m < TIER_MULT.huge) return 'big';
  if (m < TIER_MULT.mega) return 'huge';
  return 'mega';
}

/** Economy-facing tier (frozen `WinTier`). Never returns `'jackpot'` unless the machine tags it (see {@link juiceTier}). */
export function tierFor(gross: number, bet: number, tags?: readonly string[]): WinTier {
  return toWinTier(juiceTier(gross, bet, tags));
}

export function toWinTier(t: JuiceTier): WinTier {
  return t;
}

/** Catalogue tags implied by a tier (`bigwin` ≥ ×10, `hugewin` ≥ ×25, `megawin` ≥ ×50, `jackpot`); cumulative. */
export function tierTags(t: JuiceTier): string[] {
  const i = ORDER.indexOf(t);
  const out: string[] = [];
  if (i >= ORDER.indexOf('big')) out.push('bigwin');
  if (i >= ORDER.indexOf('huge')) out.push('hugewin');
  if (i >= ORDER.indexOf('mega')) out.push('megawin');
  if (t === 'jackpot') out.push('jackpot');
  return out;
}

/** `tierAtLeast('big', 'medium')` → true. Works for both scales. */
export function tierAtLeast(t: JuiceTier, min: JuiceTier): boolean {
  return ORDER.indexOf(t) >= ORDER.indexOf(min);
}

/** The lower of two tiers (spectator attenuation). */
export function tierMin(a: JuiceTier, b: JuiceTier): JuiceTier {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b;
}

/** Re-exported so callers comparing frozen tiers need only one import. */
export { WIN_TIERS };

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Win feel: every win is felt. A continuous curve over the multiplier (gross / stake) so a x2 is already a small
// flash + a coin pour + a readable pop, a x5 is punchier, and a x10+ shakes the screen. Losing spins have no feel.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Presentation numbers for one win, scaled by its multiplier ({@link winFeel}). */
export interface WinFeel {
  /** Multiplier the numbers were derived from. */
  mult: number;
  /** 0..1 position on the x1 → x50 curve (log scale). */
  k: number;
  /** Screen flash colour / opacity / length (s). */
  flashColor: Hex;
  flashAlpha: number;
  flashDur: number;
  /** Sprite coins in the pour (≤ 60 per fx call) and how long it lasts (s). */
  coins: number;
  pourDur: number;
  /** Win pop text: scale (1 = base glyph size), colour. */
  popScale: number;
  popColor: Hex;
  /** Semitones added to the win jingle and the layered coin sound. */
  pitch: number;
  /** Camera shake amplitude in metres (0 = none) and FOV punch. */
  shake: number;
  zoom: number;
}

// keyframes at x1, x2, x5, x10, x25, x50 (interpolated on log2 of the multiplier)
const FEEL_AT = [1, 2, 5, 10, 25, 50] as const;
const FEEL_ALPHA = [0.1, 0.22, 0.34, 0.46, 0.56, 0.66] as const;
const FEEL_FLASH_DUR = [0.1, 0.18, 0.22, 0.26, 0.3, 0.34] as const;
const FEEL_COINS = [6, 12, 24, 38, 54, 60] as const;
const FEEL_POUR = [0.4, 0.6, 0.9, 1.3, 1.8, 2.2] as const;
const FEEL_POP = [1.1, 1.3, 1.6, 2, 2.4, 2.8] as const;
const FEEL_PITCH = [-1, 0, 2, 4, 6, 8] as const;
const FEEL_SHAKE = [0, 0, 0.005, 0.02, 0.035, 0.05] as const;
const FEEL_ZOOM = [0, 0, 0.01, 0.03, 0.05, 0.07] as const;
/** Flash / pop colour ramp: pale gold → gold → amber → hot orange → white-gold. */
const FEEL_FLASH_COL = [0xfff0b0, 0xffe27a, 0xffc030, 0xff9a20, 0xff7030, 0xfff4d0] as const;
const FEEL_POP_COL = [0xfff0a0, 0xffe060, 0xffc030, 0xff9a20, 0xff6a3c, 0xffffff] as const;

function lerpHex(a: Hex, b: Hex, t: number): Hex {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Lower bound of the multiplier a tier stands for, used when the caller does not know the stake. */
export const TIER_FLOOR_MULT: Readonly<Record<JuiceTier, number>> = {
  none: 0, push: 1, small: 2, medium: TIER_MULT.medium, big: TIER_MULT.big, huge: TIER_MULT.huge, mega: TIER_MULT.mega, jackpot: 100,
};

/** The feel of a win of `mult` x stake. `mult` <= 0 → all zero (a loss is quiet). Pure and cheap: safe on a hot path. */
export function winFeel(mult: number): WinFeel {
  const m = Number.isFinite(mult) ? Math.max(0, mult) : 0;
  if (m <= 0) {
    return { mult: 0, k: 0, flashColor: 0, flashAlpha: 0, flashDur: 0, coins: 0, pourDur: 0, popScale: 1, popColor: 0xffffff, pitch: 0, shake: 0, zoom: 0 };
  }
  const last = FEEL_AT.length - 1;
  const x = Math.min(Math.max(m, FEEL_AT[0]), FEEL_AT[last]);
  let i = 0;
  while (i < last - 1 && x >= FEEL_AT[i + 1]) i++;
  const t = Math.log(x / FEEL_AT[i]) / Math.log(FEEL_AT[i + 1] / FEEL_AT[i]);
  const f = (arr: readonly number[]): number => arr[i] + (arr[i + 1] - arr[i]) * t;
  const c = (arr: readonly Hex[]): Hex => lerpHex(arr[i], arr[i + 1], t);
  // below x1 (a partial refund) the numbers fade down instead of holding the x1 floor
  const lo = m < 1 ? m : 1;
  return {
    mult: m,
    k: Math.log(x) / Math.log(FEEL_AT[last]),
    flashColor: c(FEEL_FLASH_COL),
    flashAlpha: f(FEEL_ALPHA) * lo,
    flashDur: f(FEEL_FLASH_DUR),
    coins: Math.max(3, Math.round(f(FEEL_COINS) * lo)),
    pourDur: f(FEEL_POUR),
    popScale: f(FEEL_POP),
    popColor: c(FEEL_POP_COL),
    pitch: f(FEEL_PITCH),
    shake: f(FEEL_SHAKE),
    zoom: f(FEEL_ZOOM),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Juice numbers (pure: no DOM, no audio, no rng). Used by juice.ts, MachineBase and the juice unit tests.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Wins in a row (local player) from which the streak shows: the `xN STREAK` pop, a longer chase, a rising jingle. */
export const STREAK_MIN = 3;
/** The win jingle climbs this many semitones at most. */
export const STREAK_STEP_CAP = 8;

/**
 * The pop value of a win: the NET (gross less the stake) when the stake is given, else the amount as given. Callers
 * pass the gross to `celebrate` / `pourCoins` with the stake, so the net is computed in one place.
 */
export function netWin(gross: number, bet?: number): number {
  return bet !== undefined && bet > 0 ? gross - bet : gross;
}

/** Semitones the win jingle climbs for a streak of `n` wins in a row: +1 per win from the third, capped (3 → +1, 10 → +8). */
export function streakSteps(n: number): number {
  return Math.min(STREAK_STEP_CAP, Math.max(0, Math.floor(n) - STREAK_MIN + 1));
}

/**
 * Semitones a spin cue (lever, button, reel start / stop, the reel whirr) is raised by a win streak of `n`: +0.5 per win after
 * the first, capped at +4. Softer than {@link streakSteps} (which starts at the third win and lifts the jingle): the machine
 * itself starts to sound hotter from the second win on.
 */
export function streakPitch(n: number): number {
  return Math.min(4, Math.max(0, Math.floor(n) - 1) * 0.5);
}

/** Brightness multiplier of the win light pulse for a streak of `n`: +5 % per win after the first, capped at +40 %. */
export function streakGlow(n: number): number {
  return 1 + Math.min(8, Math.max(0, Math.floor(n) - 1)) * 0.05;
}

/** Anticipation before an impact of tier `t`, in sim seconds: `big` 0.6 s, `huge` and up 1.2 s, lower tiers none. */
export function windupSec(t: JuiceTier): number {
  return t === 'big' ? 0.6 : tierAtLeast(t, 'huge') ? 1.2 : 0;
}
