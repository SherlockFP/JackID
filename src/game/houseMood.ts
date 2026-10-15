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
import { isWitchingWatch, nightDef } from './data/schedule';
import houseMoodStrings from './houseMood.strings';
import payoutStrings from './payout.strings';

registerStrings(houseMoodStrings.prefix, { en: houseMoodStrings.en, tr: houseMoodStrings.tr });
registerStrings(payoutStrings.prefix, { en: payoutStrings.en, tr: payoutStrings.tr });

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

/* ── PAYOUT chip (wave 47): every global payout.mult source under the quota, in play and in Mola ───────────────────── */

/** One global payout source for the chip: a multiplier (`mult`, x1.25) or an additive bonus (`inc`, +0.05). */
export interface PayoutPart { label: string; op: 'mult' | 'inc'; value: number }
export type PayoutTone = 'up' | 'down' | 'flat';
export interface PayoutChipView {
  /** The folded payout factor: (1 + sum of inc) x product of mult, the same fold the engine applies to a gross. */
  total: number;
  totalTone: PayoutTone;
  /** The total as printed ("×1.40"). */
  totalText: string;
  parts: Array<{ text: string; tone: PayoutTone }>;
}

/** The Witching Watch's additive payout bonus (run.ts House source: `payout.mult` inc). Mirrored here for the Mola preview. */
export const WITCH_PAYOUT_INC = 0.05;

/** The signed whole percent of one part: x1.25 -> +25%, x0.95 -> -5%, +0.05 -> +5%. */
function partPct(p: PayoutPart): number {
  return Math.round(p.op === 'mult' ? (p.value - 1) * 100 : p.value * 100);
}

function toneOf(pct: number): PayoutTone { return pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'; }

/** The chip's numbers: the total and one text per part (signed percent, toned by sign). Pure. */
export function payoutChip(parts: readonly PayoutPart[]): PayoutChipView {
  let add = 0;
  let mult = 1;
  for (const p of parts) {
    if (p.op === 'inc') add += p.value;
    else mult *= p.value;
  }
  const total = (1 + add) * mult;
  const rounded = Math.round(total * 100) / 100;
  return {
    total,
    totalTone: toneOf(Math.round((total - 1) * 100)),
    totalText: `×${rounded.toFixed(2)}`,
    parts: parts.map((p) => {
      const pct = partPct(p);
      const shown = pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : '0%';
      return { text: t('payout.part', { label: p.label, pct: shown }), tone: toneOf(pct) };
    }),
  };
}

/**
 * The Mola preview: the parts the next Watch will carry (mood and House Favour always, the Witching bonus when
 * the next Watch is the witching one). `index` is the Night's 0-based index; `watchIndex` the next Watch's 0-based index.
 */
export function houseMoodPreviewParts(index: number, watches: number, watchIndex: number): PayoutPart[] {
  const parts: PayoutPart[] = [{ label: t('payout.mood'), op: 'mult', value: houseMoodMult(index) }];
  const favour = nightDef(index).favour;
  if (favour !== 1) parts.push({ label: t('payout.favour'), op: 'mult', value: favour });
  if (watchIndex < watches && isWitchingWatch(watches, watchIndex)) parts.push({ label: t('payout.witch'), op: 'inc', value: WITCH_PAYOUT_INC });
  return parts;
}
