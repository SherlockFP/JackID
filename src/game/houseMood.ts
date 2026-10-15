/**
 * HOUSE MOOD (wave 46, director decision): every floor machine has RTP < 1, so a pull can only lose money on average and the
 * bank does all the work. The House's mood is a Night-scaled payout multiplier on every floor machine, through the `payout.mult`
 * mod pipeline: early Nights pay generously so a skilled player grows the pocket; later Nights tighten and demand charms, lamps
 * and engines. Pure data plus a ModProvider: run.ts registers the provider, hud.ts shows the line under the quota.
 *
 * Overdrawn Nights (9 and up) keep the last value (x0.95). The multiplier stacks with House Favour (`nightDef().favour`).
 */
import type { ModEffect, ModProvider, ModQuery, ModSource } from '@/game/types';
import { registerStrings, t } from '@/core/i18n';
import houseMoodStrings from './houseMood.strings';

registerStrings(houseMoodStrings.prefix, { en: houseMoodStrings.en, tr: houseMoodStrings.tr });

/** Payout multiplier per printed Night, Nights 1..8 (director: N1 x1.12 … N8 x0.95). */
export const HOUSE_MOOD: readonly number[] = [1.12, 1.07, 1.03, 1.0, 0.98, 0.97, 0.96, 0.95];

/** The mood multiplier for a 0-based Night index (run.index). */
export function houseMoodMult(index: number): number {
  const i = Math.min(HOUSE_MOOD.length - 1, Math.max(0, Math.floor(index)));
  return HOUSE_MOOD[i];
}

/** Whole percent of the mood: +12, +7, +3, 0, -2, -3, -4, -5 for Nights 1..8. */
export function houseMoodPct(index: number): number {
  return Math.round((houseMoodMult(index) - 1) * 100);
}

export type HouseMoodTone = 'generous' | 'neutral' | 'tight';

/** The HUD line for a 0-based Night index: "HOUSE MOOD: GENEROUS +12%", plus the tone that colours it (by sign). */
export function houseMoodLine(index: number): { text: string; tone: HouseMoodTone; pct: number } {
  const pct = houseMoodPct(index);
  const tone: HouseMoodTone = pct > 0 ? 'generous' : pct < 0 ? 'tight' : 'neutral';
  const shown = pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : '0%';
  return { text: t('house.mood.line', { word: t(`house.mood.${tone}`), pct: shown }), tone, pct };
}

export interface HouseMoodHost {
  /** The Night's 0-based index (run.index). */
  index: () => number;
  /** True while the mood applies: a quota Watch in play (the same gate as House Favour). */
  active: () => boolean;
}

/** The mood as a ModProvider: one `payout.mult` multiplier on every machine's payout, while the host is active. */
export function houseMoodProvider(host: HouseMoodHost): ModProvider {
  return {
    kind: 'house',
    collect(_q: ModQuery, out: ModSource[]): void {
      if (!host.active()) return;
      const n = host.index();
      const effects: ModEffect[] = [{ hook: 'payout.mult', op: 'mult', value: houseMoodMult(n) }];
      out.push({ kind: 'house', id: `mood:${n + 1}`, owner: 0, effects });
    },
  };
}
