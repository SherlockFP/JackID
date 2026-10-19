/**
 * Pure helpers of ui.ts `banner()` (no DOM, so the unit tests load them): where a banner goes while the player is seated, and how
 * big it may be in the top band.
 */
import type { ToastKind } from './types';
import type { ExtraToastKind } from './ui';

/**
 * Which toast a banner turns into while the player is seated (a title card there would sit over the machine, so the news goes to
 * the toast column). The banner's colour picks the toast's bar: red = bad, gold = money, violet = curse, cyan = sys, green = good,
 * anything else (ivory, grey, none) = info.
 */
export function bannerToastKind(color?: string): ToastKind | ExtraToastKind {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? '');
  if (!m) return 'info';
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  if (r > 180 && g < 150) return 'bad';                         // red, coral, orange
  if (r > 200 && g > 180 && b < 170) return 'money';            // gold, shine, bulb
  if (b > 200 && g < 170) return 'curse';                       // violet
  if (r < 190 && b > 190 && g > 190) return 'sys';              // cyan, ice (not ivory / paper)
  if (g > 190 && r < 190 && b < 190) return 'good';             // green
  return 'info';
}

export type BannerSize = 8 | 16 | 24;

/**
 * The largest banner size, up to `want`, whose text fits ONE row of the centre column `colPx` wide (46 % of the screen, at most 300 UI
 * px: clear of the left objective / tutorial panel and the right stack). The heading face is 1 em a letter, plus
 * 0.6 em between words. Past size 8 it still wraps, in two rows, inside the same column.
 */
export function fitBannerSize(text: string, want: BannerSize, colPx: number, px: number): BannerSize {
  const em = Array.from(text).length + 0.6 * Math.max(0, text.trim().split(/\s+/).length - 1);
  for (const s of [24, 16, 8] as const) if (s <= want && em * s * px <= colPx) return s;
  return 8;
}
