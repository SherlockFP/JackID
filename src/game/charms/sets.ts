/**
 * Archetype sets (wave 7, Balatro-style build identity). Holding SET_SIZE distinct charms that carry one archetype tag
 * switches that set on. A set on adds its bonus while both charms are owned, and the bonus goes when one is sold.
 *  - Declarative bonuses reach the modifier pipeline through `Charms.collect` (charms/engine.ts): one source per set.
 *  - Copycat is read by the Understudy (charms/engines.ts), which copies one extra effect while its set is on.
 *  - Clutch's Last Call bonus is the hook `x.run.lastCallAdd` (seconds); the run reads it where it sets the Last Call.
 * Pure data and helpers. Its strings are in `sets.strings.ts`.
 */
import type { ModEffect } from '@/game/types';
import { ENGINE_ARCHETYPES, type EngineArchetype } from '@/game/data/charmsEngines';

export type SetId = EngineArchetype;

/** Distinct charms of one archetype needed to switch its set on. */
export const SET_SIZE = 2;

/** Bonus of each set while it is on. Copycat has none here: the Understudy reads it (see engines.ts). */
export const SET_EFFECTS: Readonly<Record<SetId, readonly ModEffect[]>> = {
  hot: [{ hook: 'x.lamp.hotMult', op: 'add', value: 0.1 }],
  clutch: [{ hook: 'x.run.lastCallAdd', op: 'add', value: 6 }],
  banker: [{ hook: 'x.econ.interestAdd', op: 'add', value: 0.01 }],
  whale: [{ hook: 'x.house.limitMult', op: 'mult', value: 1.25 }],
  rotation: [{ hook: 'x.tilt.grace', op: 'add', value: 1 }],
  copycat: [],
};

export const isSetId = (t: string): t is SetId => (ENGINE_ARCHETYPES as readonly string[]).includes(t);

/**
 * The sets switched on by a list of held charms. `tagsOf(id)` gives a charm's tags (undefined for an unknown charm).
 * Each held charm counts once, whatever its stacks. Result in the archetype table's order.
 */
export function activeSets(held: readonly { id: string }[], tagsOf: (id: string) => readonly string[] | undefined): SetId[] {
  const count = new Map<SetId, number>();
  const charms = new Set<string>();
  for (const s of held) {
    if (charms.has(s.id)) continue;
    charms.add(s.id);
    for (const t of new Set(tagsOf(s.id) ?? [])) {
      if (isSetId(t)) count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  return ENGINE_ARCHETYPES.filter((a) => (count.get(a) ?? 0) >= SET_SIZE);
}

/** The declarative bonus effects of the given active sets, in archetype order. */
export function setEffects(active: readonly SetId[]): ModEffect[] {
  return ENGINE_ARCHETYPES.filter((a) => active.includes(a)).flatMap((a) => [...SET_EFFECTS[a]]);
}
