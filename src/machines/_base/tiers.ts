/**
 * Win tiers (base-machines WP). Contract: TECH_SPEC §2.13 as AMENDED by §11.5, GDD §10.4 "Juice tiers".
 *
 * Thresholds are multiples of the round stake (`gross / bet`):
 *   0 → none · ≤ 1× push · < 3× small · < 10× medium · < 25× big (tag `bigwin`) · < 50× huge (`hugewin`)
 *   · ≥ 50× mega (`megawin`) · `jackpot` only when the machine tags the round `jackpot`.
 *
 * 'mega' is a member of the frozen `WinTier` (Contracts v1.1), so `JuiceTier` and `WinTier` are one scale.
 */
import { WIN_TIERS, type WinTier } from '@/game/types';

/** Presentation tiers (= `WinTier` since v1.1). */
export type JuiceTier = WinTier;

/** Lower bounds (× stake) of each tier. */
export const TIER_MULT = { medium: 3, big: 10, huge: 25, mega: 50 } as const;
const ORDER: readonly JuiceTier[] = ['none', 'push', 'small', 'medium', 'big', 'huge', 'mega', 'jackpot'];

/** Presentation tier of a result. `tags` containing `'jackpot'` forces `'jackpot'`. */
export function juiceTier(gross: number, bet: number, tags?: readonly string[]): JuiceTier {
  if (!(gross > 0)) return 'none';
  if (tags?.includes('jackpot')) return 'jackpot';
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
