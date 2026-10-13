/**
 * Moth Shrine (`shrine`, system, PAR-SHRINE) — pure rules, no three, kit or DOM (devices-lobby lane). GDD §3.8.5 and the
 * blessing / curse rows of §3.8.2.
 *
 * Light a candle for `max(5 × SI, 5 % of pocket)` coins, once per Watch per player. 70 % a blessing, 30 % a curse,
 * each of the four equally likely. The Votive Candle charm makes it 85 / 15. The outcome is drawn from a seeded stream
 * keyed by run seed, player, Night, Watch and the candle count, so every peer sees the same flame and the same omen.
 * The coins go through `run.spend`, the buff through `run.buffs.add`. Nothing here moves money.
 */
import { createRng, hashSeed } from '@/core/rng';
import type { PlayerId } from '@/core/types';
import type { RunApi } from '@/game/types';

/** Blessing buff ids (GDD §3.8.2). The buff defs themselves belong to the game (`src/game/buffs`). */
export const BLESSINGS = ['blessing_steady_hand', 'blessing_open_purse', 'blessing_quiet', 'blessing_far_sight'] as const;
/** Curse buff ids (GDD §3.8.2). */
export const CURSES = ['curse_heavy_pockets', 'curse_sour_luck', 'curse_tithe', 'curse_attention'] as const;

export type Omen = 'blessing' | 'curse';
export interface Outcome { kind: Omen; buffId: string }

/** Candles one run can hold (GDD §3.8.5: max 64). */
export const CANDLE_CAP = 64;
/** Share of blessings (GDD: 70 %). */
export const BLESS_ODDS = 0.7;
/** Share of blessings with the Votive Candle charm (GDD: 85 / 15). */
export const BLESS_ODDS_VOTIVE = 0.85;
/** Charm id that changes the odds. */
export const VOTIVE_CHARM = 'votive_candle';

/** Coins to light one candle: `max(5 × SI, 5 % of the pocket)`, rounded down. */
export function candleCost(si: number, pocket: number): number {
  return Math.max(5 * Math.max(1, si), Math.floor(pocket * 0.05));
}

/** Once-per-Watch key: the Night and the Watch index. A new key means a new candle is allowed. */
export function watchKey(night: number, watch: number): string {
  return `${night}:${watch}`;
}

/** Blessing share for `pid`, from the charms they own. */
export function blessOdds(run: RunApi, pid: PlayerId): number {
  return run.charms(pid).some((c) => c.id === VOTIVE_CHARM) ? BLESS_ODDS_VOTIVE : BLESS_ODDS;
}

/**
 * The omen for candle number `lit` lit by `pid` in this Watch. Pure in its inputs: the same seed, player, Night,
 * Watch, candle count and odds always give the same omen. The `odds` argument is the blessing share.
 */
export function rollOmen(seed: number, pid: PlayerId, key: string, lit: number, odds: number): Outcome {
  const rng = createRng(hashSeed(seed, 'shrine', pid, key, lit));
  if (rng.chance(odds)) return { kind: 'blessing', buffId: rng.pick(BLESSINGS) };
  return { kind: 'curse', buffId: rng.pick(CURSES) };
}

/** Shrine state that every peer must agree on (snapshotted for late joiners). */
export type ShrineState = {
  /** Candles lit this run (one flame each, capped at CANDLE_CAP). */
  lit: number;
  /** Last Watch key each player lit a candle in. */
  watch: { [pid: string]: string };
}

export type LightCheck = 'ok' | 'once' | 'funds' | 'full';

/** Can `pid` light a candle now? Pure: reads the shrine state, the Watch and the wallet. */
export function canLight(st: ShrineState, run: RunApi, pid: PlayerId): LightCheck {
  if (st.lit >= CANDLE_CAP) return 'full';
  const key = watchKey(run.night(), run.shift.state().segment?.index ?? 0);
  if (st.watch[String(pid)] === key) return 'once';
  const cost = candleCost(run.shift.state().stake, run.balance('coin', pid));
  return run.balance('coin', pid) >= cost ? 'ok' : 'funds';
}

/** Price for `pid` right now (for the tag and the HUD). */
export function priceNow(run: RunApi, pid: PlayerId): number {
  return candleCost(run.shift.state().stake, run.balance('coin', pid));
}

/** Applies a light through RunApi: the coins, then the buff. Returns false when the spend is refused. */
export function applyLight(run: RunApi, pid: PlayerId, buffId: string, cost: number): boolean {
  if (!run.spend('coin', cost, 'shrine', pid)) return false;
  run.buffs.add(buffId, { pid, source: { kind: 'shrine', id: buffId } });
  return true;
}
