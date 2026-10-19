/**
 * Moth Shrine (`shrine`, system, PAR-SHRINE) — pure rules, no three, kit or DOM (devices-lobby lane). docs/BLESSINGS.md §2.2.
 *
 * Light a candle for `max(5 × SI, 5 % of pocket)` coins, once per Watch per player, then pick a statue: that owner's Favour
 * goes up by one (0..3, the pantheon's own scale). No dice, no curse. The coins go through `run.spend`; the Favour goes to the
 * run on the `shrine:favour` bus event (the shrine cannot reach the pantheon itself). Nothing here draws a random number.
 */
import { bus } from '@/core/events';
import type { PlayerId } from '@/core/types';
import type { RunApi } from '@/game/types';
import type { GodId } from '@/game/pantheon';

/** The four statues, in shelf order. Loki has no statue (he is not a god). shortcut: copies pantheon.ts OWNERS and FAVOUR_MAX (machines may not import game values, TECH_SPEC §1.1); omens.test.mjs pins them equal. */
export const STATUES: readonly GodId[] = ['well', 'ledgers', 'ash', 'mirrors'];
/** Favour runs 0..this (pantheon.ts FAVOUR_MAX). */
export const FAVOUR_MAX = 3;

/** Candles one run can hold (GDD §3.8.5: max 64). */
export const CANDLE_CAP = 64;

/** Coins to light one candle: `max(5 × SI, 5 % of the pocket)`, rounded down. */
export function candleCost(si: number, pocket: number): number {
  return Math.max(5 * Math.max(1, si), Math.floor(pocket * 0.05));
}

/** Once-per-Watch key: the Night and the Watch index. A new key means a new candle is allowed. */
export function watchKey(night: number, watch: number): string {
  return `${night}:${watch}`;
}

/** A god's Favour 0..3. shortcut: duck-typed because RunApi (types.ts) has no `boonFavour` yet; 0 on a run without a pantheon. */
export function favourOf(run: RunApi, god: GodId): number {
  return (run as unknown as { boonFavour?: (g: GodId) => number }).boonFavour?.(god) ?? 0;
}

/** Shrine state that every peer must agree on (snapshotted for late joiners). */
export type ShrineState = {
  /** Candles lit this run (one flame each, capped at CANDLE_CAP). */
  lit: number;
  /** Last Watch key each player lit a candle in. */
  watch: { [pid: string]: string };
}

export type LightCheck = 'ok' | 'once' | 'funds' | 'full';

/** Can `pid` light a candle now? Pure: reads the shrine state, the Watch, the wallet and the statues ('full': every owner is at Favour 3). */
export function canLight(st: ShrineState, run: RunApi, pid: PlayerId): LightCheck {
  if (st.lit >= CANDLE_CAP || STATUES.every((g) => favourOf(run, g) >= FAVOUR_MAX)) return 'full';
  const key = watchKey(run.night(), run.shift.state().segment?.index ?? 0);
  if (st.watch[String(pid)] === key) return 'once';
  const cost = candleCost(run.shift.state().stake, run.balance('coin', pid));
  return run.balance('coin', pid) >= cost ? 'ok' : 'funds';
}

/** Price for `pid` right now (for the tag and the HUD). */
export function priceNow(run: RunApi, pid: PlayerId): number {
  return candleCost(run.shift.state().stake, run.balance('coin', pid));
}

/** Applies a light through RunApi: the coins, then +1 Favour for `god` (the run listens). Returns false when the spend is refused. */
export function applyLight(run: RunApi, pid: PlayerId, god: GodId, cost: number): boolean {
  if (!run.spend('coin', cost, 'shrine', pid)) return false;
  bus.emit('shrine:favour', { pid, god });
  return true;
}
