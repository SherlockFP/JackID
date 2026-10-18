/**
 * Starter Draft (draft wave): the three charms the player picks from in the Night 1 Mola, after the first Watch of a new Debt Run
 * (wave 72: never on the first frame, never during the prologue). Pure: the
 * offer is a function of the run seed and what the player already owns, so a seed always shows the same three cards (the
 * same in every save and on every peer). The cards are drawn by `draft.ui.ts`; the run holds the open offer
 * (`run.openStarterDraft()`, `run.pickStarter()`, `run.starterDraft()`) and holds the Bell while it is open.
 *
 * Rules: three distinct Launch charms of rarity Common or Uncommon, exactly one of them an engine charm (an archetype tag,
 * data/charmsEngines.ts), so every run has a build from Watch 1. The engine slot ignores the Night unlock gate on purpose: the
 * engine charms unlock at Nights 2 to 4, and the starter is the run's first build, not a shop roll. Everything else keeps
 * the usual gate (an unlock code means it is earned elsewhere, so it is never offered here).
 */
import { allCharmDefs } from './charms/engine';
import { LAUNCH_CHARM_IDS } from './data/charms';
import { ENGINE_ARCHETYPES } from './data/charmsEngines';
import type { CharmDef } from './types';
import { createRng, hashSeed } from '@/core/rng';

/** Cards in the starter offer. */
export const STARTER_SIZE = 3;
/** Engine charms in the offer: exactly one (the build). */
export const STARTER_ENGINE_SLOTS = 1;
/** Bell seconds (sim time) the offer waits before the first card is taken for the player. */
export const STARTER_TIMEOUT_SEC = 30;

const STARTER_RARITIES: ReadonlySet<CharmDef['rarity']> = new Set<CharmDef['rarity']>(['common', 'uncommon']);

/** The engine archetype of a charm (`rotation`, `hot`, `clutch` …), or null for a plain charm. */
export function archetypeOf(def: CharmDef): string | null {
  const tag = def.tags?.find((t) => (ENGINE_ARCHETYPES as readonly string[]).includes(t));
  return tag ?? null;
}

/**
 * The three starter charm ids for a run seed. `owned` excludes charms the player already holds (the starting kit). Empty when
 * the pool cannot fill the offer (never with the shipped data). Same seed and same owned set give the same ids, in the same order.
 */
export function starterOffer(seed: number, owned: (id: string) => boolean = () => false): string[] {
  const rng = createRng(hashSeed('starter', seed));
  const open = allCharmDefs().filter((d) => STARTER_RARITIES.has(d.rarity) && LAUNCH_CHARM_IDS.has(d.id) && !owned(d.id));
  const engines = open.filter((d) => archetypeOf(d) !== null);
  const plain = open.filter((d) => archetypeOf(d) === null && !d.unlock);
  if (engines.length < STARTER_ENGINE_SLOTS || plain.length < STARTER_SIZE - STARTER_ENGINE_SLOTS) return [];
  const picks: CharmDef[] = [];
  for (let i = 0; i < STARTER_ENGINE_SLOTS; i++) {
    const d = rng.pick(engines.filter((e) => !picks.includes(e)));
    picks.push(d);
  }
  const rest = rng.shuffle([...plain]).slice(0, STARTER_SIZE - STARTER_ENGINE_SLOTS);
  return rng.shuffle([...picks, ...rest]).map((d) => d.id);
}
