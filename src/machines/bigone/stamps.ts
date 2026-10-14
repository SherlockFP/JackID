/**
 * Gild levels for the Big One symbols (gold paint + glint on a gilded symbol), read from `@/core/stampLevels`.
 * Read once per frame or per paint pass with `gildLevels()`, never per cell.
 */
import { getStampLevels } from '@/core/stampLevels';
import { SYM_NAMES } from './rules';

/** Gild level per symbol id 0..6 (0 = plain, clamped to 0..3). MAW and GHOST never take gold. */
export function gildLevels(): number[] {
  let gild: Record<string, number> = {};
  try {
    gild = getStampLevels().gild;
  } catch {
    gild = {};
  }
  return SYM_NAMES.map((name) => {
    const v = Math.floor(gild[name] ?? 0);
    return v > 0 ? Math.min(3, v) : 0;
  });
}
