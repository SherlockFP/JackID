/**
 * Boss Night logic (wave 8, item 4): which boss a Night gets, decided by the run seed. Pure and deterministic. The
 * data is in `data/bosses.ts`.
 *
 * Wiring (see the report): the boss must be registered and active before `startWatch()` reads the clock and pull mods;
 * the random event chance is 0 on boss Nights; the boss is announced on the previous Dawn card; and the reward is
 * `BOSS_REWARD` (one pick of three Rare charms via `choiceOffer(rng, 'rare', 3, owned)`, plus 3 Tickets).
 */
import { createRng, hashSeed } from '@/core/rng';
import type { NightEventDef } from '@/game/types';
import { BOSS_EXCLUSIVE, BOSS_NIGHTS, BOSS_POOLS, BOSS_TEMPLATES, type BossId } from '@/game/data/bosses';
import { SUIT_FAMILY_TAGS } from '@/game/data/charmsEngines';

/** A boss as a NightEventDef, plus the boss id and the embargoed suit (null unless Embargo). */
export interface BossNight extends NightEventDef {
  boss: BossId;
  suit: string | null;
}

/** True on Nights 3, 6 and 8. */
export const isBossNight = (night: number): boolean => BOSS_NIGHTS.includes(night);

/**
 * The boss for `night` (1-based Night number) in the run with `seed`, or null when the Night has no boss. Same seed and
 * Night always give the same boss; each call returns a fresh object, so callers may keep it.
 */
export function bossFor(seed: number, night: number): BossNight | null {
  const pool = BOSS_POOLS[night];
  if (!pool) return null;
  const rng = createRng(hashSeed(seed, 'boss', night));
  const boss = rng.pick(pool);
  const suit = rng.pick(SUIT_FAMILY_TAGS);
  const t = BOSS_TEMPLATES[boss];
  return {
    id: t.id,
    icon: t.icon,
    weight: 0,
    duration: 'shift',
    minShift: night,
    maxShift: night,
    exclusive: BOSS_EXCLUSIVE,
    effects: t.effects(boss === 'embargo' ? suit : null),
    strings: t.strings,
    boss,
    suit: boss === 'embargo' ? suit : null,
  };
}
