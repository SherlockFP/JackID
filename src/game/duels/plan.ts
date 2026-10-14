/**
 * The cheat plan (Wave 25 TALLY, lane A): seeded by `hashSeed(runSeed, 'duel', rivalId, night)`, so the same run
 * and Night always produce the same cheat. The plan is HOST-ONLY: it lives in a `PlanVault` whose JSON form is
 * `null`, so it cannot slip into a snapshot or an event by accident; it reaches clients only through the final
 * `reveal` event.
 */
import { hashSeed } from '@/core/rng'
import type { CheatPlan, DuelRules } from './types'

export function planSeedOf(runSeed: number, rivalId: string, night: number): number {
  return hashSeed(runSeed, 'duel', rivalId, night)
}

export interface PlanVault {
  /** The one door to the plan. Host code only. */
  open(): CheatPlan
  toJSON(): null
}

export function sealPlan(plan: CheatPlan): PlanVault {
  const copy: CheatPlan = JSON.parse(JSON.stringify(plan)) as CheatPlan
  const vault: PlanVault = { open: (): CheatPlan => copy, toJSON: (): null => null }
  return Object.freeze(vault)
}

/** Draws the plan of one duel: same run, rival and Night give the same plan. */
export function makeDuelPlan(rules: DuelRules, runSeed: number, rivalId: string, night: number): { seed: number; vault: PlanVault } {
  const seed = planSeedOf(runSeed, rivalId, night)
  return { seed, vault: sealPlan(rules.makePlan(seed)) }
}

/** The text fragments of a plan that identify it (its kind and every string inside `detail`). */
function leaves(v: unknown, out: string[]): void {
  if (typeof v === 'string') { if (v.length >= 3) out.push(v) }
  else if (Array.isArray(v)) for (const x of v) leaves(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out)
}

/**
 * Leak scan for tests and dev assertions: the plan fragments found inside `value` once it is serialised.
 * Empty array = clean.
 */
export function planLeaks(value: unknown, plan: CheatPlan): string[] {
  const text = JSON.stringify(value) ?? ''
  const frags: string[] = []
  leaves(plan.kind, frags)
  leaves(plan.detail, frags)
  return [...new Set(frags)].filter((f) => text.includes(f))
}
