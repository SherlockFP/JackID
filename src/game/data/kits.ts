/**
 * Starting kits (wave 8, item 6) as pure data, plus `applyKit`: the grants a kit makes when a run starts.
 * Kits unlock with Obols. Pauper is free; the rest cost 30 / 60 / 60 / 90 / 120 in list order.
 * Names and descriptions live in `data/kits.strings.ts` under `kit.<id>.name|desc`.
 */
import type { PlayerId } from '@/core/types';
import type { RunApi } from '@/game/types';

export interface KitDef {
  id: string;
  /** Obols to unlock (0 = free). */
  unlockCost: number;
  /** Starting coins; the run uses this in place of `RunConfig.startWallet`. */
  coins: number;
  /** Tickets granted at start. */
  tickets: number;
  /** Coins already deposited toward the first quota. */
  predeposit: number;
  /** Charm ids granted at start (must exist in the catalogue; cursed ones are allowed). */
  charms: readonly string[];
}

export const KITS: readonly KitDef[] = [
  // Playtest 5.5/10: Pauper's 50 coins trivialised Night 1 (quota 14). Kits are scaled (about x0.6) and Night 1 re-verified with scripts/sim/run.mjs (rotator >= 95 %, camper >= 75 %; Night 1 quota 19 in schedule.ts).
  { id: 'pauper', unlockCost: 0, coins: 30, tickets: 2, predeposit: 0, charms: [] },
  { id: 'rotator', unlockCost: 30, coins: 25, tickets: 0, predeposit: 0, charms: ['suit_ladder'] },
  { id: 'hot_hand', unlockCost: 60, coins: 25, tickets: 0, predeposit: 0, charms: ['lampwick', 'cold_hands'] },
  { id: 'clutch', unlockCost: 60, coins: 22, tickets: 0, predeposit: 0, charms: ['last_gasp', 'night_owl'] },
  { id: 'banker', unlockCost: 90, coins: 12, tickets: 0, predeposit: 25, charms: ['piggy_tooth', 'wax_seal'] },
  { id: 'heir', unlockCost: 120, coins: 120, tickets: 0, predeposit: 0, charms: ['glass_heart'] },
];

export const kitById = (id: string): KitDef | undefined => KITS.find((k) => k.id === id);

/** What the run takes from a kit besides the grants already made: the wallet and the pre-deposit. */
export interface KitGrant {
  coins: number;
  predeposit: number;
  /** Charms actually granted (a charm refused by the run, e.g. no free peg, is left out). */
  charms: string[];
}

/**
 * Apply a kit's grants at run start: tickets through `earn`, charms through `grantCharm`. Returns the coins and the
 * pre-deposit for the run to apply to its wallet and first quota (run.ts is not touched here), or null for an
 * unknown kit.
 */
export function applyKit(run: Pick<RunApi, 'earn' | 'grantCharm'>, kit: KitDef | string, pid?: PlayerId): KitGrant | null {
  const k = typeof kit === 'string' ? kitById(kit) : kit;
  if (!k) return null;
  if (k.tickets > 0) run.earn('ticket', k.tickets, `kit:${k.id}`, pid);
  const charms = k.charms.filter((id) => run.grantCharm(id));
  return { coins: k.coins, predeposit: k.predeposit, charms };
}
