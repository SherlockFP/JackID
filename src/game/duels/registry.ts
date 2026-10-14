/**
 * Duel registry (Wave 25 TALLY, lane A). The duel games (`sealedwall`, `ghostshell`, `steamcount`, ...) call
 * `registerDuel(rules)` when their module loads; the engine and the `tallytable` machine look them up by game id
 * or by the rival who plays them. Re-registering an id replaces it (HMR, tests). `autoload.ts` imports every game
 * folder's `index.ts`.
 */
import type { DuelRules } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRules = DuelRules<any>

const table = new Map<string, AnyRules>()

export function registerDuel(rules: AnyRules): void {
  table.set(rules.id, rules)
}

export function getDuel(id: string): AnyRules | undefined {
  return table.get(id)
}

/** The duel a rival plays (`DuelRules.rival`), or undefined when no game is registered for them yet. */
export function duelForRival(rivalId: string): AnyRules | undefined {
  for (const r of table.values()) if (r.rival === rivalId) return r
  return undefined
}

export function listDuels(): AnyRules[] {
  return [...table.values()]
}

/** Test helper: forget a game (or all of them). */
export function unregisterDuel(id?: string): void {
  if (id === undefined) table.clear()
  else table.delete(id)
}
