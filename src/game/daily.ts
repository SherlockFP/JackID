/**
 * Daily run (pure). One run per UTC day for everyone: the seed, the kit and the stake come from the date, so the same day
 * always gives the same run. The best result of each day is kept in `save.dailyBest` (save.ts). The results receipt
 * prints `dailyLine` for copying.
 *
 * Kit: picked from the whole kit list by the date, so it does not need an unlock. Stake: always `DAILY_STAKE`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { KITS } from '@/game/data/kits';

export const DAILY_STAKE = 3;

/** One day's best run. `night` is the Night reached (the receipt's floor), `obols` what the run banked. */
export interface DailyBest {
  date: string;
  seed: number;
  kit: string;
  night: number;
  obols: number;
  result: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC day as `YYYY-MM-DD`. */
export function dayKey(now: Date = new Date()): string {
  const y = String(now.getUTCFullYear()).padStart(4, '0');
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a `YYYY-MM-DD` string. */
export function isDayKey(s: unknown): s is string {
  return typeof s === 'string' && DAY_KEY.test(s);
}

/** The compact `YYYYMMDD` form the seed is keyed on. */
export function dayCode(key: string): string {
  return key.replace(/-/g, '');
}

/** The day's run seed: `hashSeed('daily', YYYYMMDD)`. */
export function dailySeed(key: string): number {
  return hashSeed('daily', dayCode(key));
}

/** The day's kit: one pick from every kit id, seeded by the date. */
export function dailyKit(key: string): string {
  const ids = KITS.map((k) => k.id);
  return createRng(hashSeed('daily', dayCode(key), 'kit')).pick(ids);
}

/** True when `next` beats `prev` for the same day: more Nights reached first, then more Obols. */
export function dailyBetter(prev: DailyBest | undefined, next: DailyBest): boolean {
  if (!prev) return true;
  if (next.night !== prev.night) return next.night > prev.night;
  return next.obols > prev.obols;
}

/** The copyable result line: `JackID daily 2026-10-15 · Night 7 · +120 Obols`. */
export function dailyLine(date: string, night: number, obols: number): string {
  return `JackID daily ${date} · Night ${night} · +${Math.max(0, Math.round(obols))} Obols`;
}
