/**
 * Secondary currencies, rewards, progressive jackpots, contracts/bounties — TD-FROZEN types.
 * Implementation: GAME-RUN (`economy.ts`) + GAME-CONTRACTS. Contract: BRIEF ADDENDA 1, 3, 5, 8.
 * Everything here is data-driven: defs are registered from `src/game/**\/*.def.ts`-style glob files by the
 * owning WP; this file only fixes shapes.
 */
import type { InstanceId, MachineId, PlayerId, Unsub } from '@/core/types';
import type { CutsceneId } from '@/core/cutscene/types';
import type { CharmRarity, EcoSource, WinTier } from './types';

/** 'coin' is the main currency (RunApi.wallet). 'ticket' = run stubs, 'obol' = permanent meta currency. */
export type CurrencyId = 'coin' | 'ticket' | 'obol' | (string & {});

/**
 * A bundle of things handed out by overshoot tiers, contracts, favours, bosses, events.
 * Applied atomically by the host (`economy.grant(reward, pid)`), shown as a receipt line.
 */
export interface RewardSpec {
  /** Absolute coins, or a fraction of the current quota ("+25 % of quota"). */
  coins?: number | { quotaFrac: number };
  currencies?: Record<CurrencyId, number>;
  buffs?: Array<{ id: string; stacks?: number; durationScale?: number }>;
  /** Free charm: a specific id, or "choose `choose` of `of` random ones of this rarity". */
  charm?: { id: string } | { choose: number; of: number; rarity: CharmRarity | CharmRarity[] };
  totems?: string[];
  /** Feature / wing / machine / character / track unlock ids. */
  unlocks?: string[];
  /** Next shift's quota ×(1 − x). */
  nextQuotaDiscount?: number;
  cutscene?: CutsceneId;
  /** i18n key of the receipt line. */
  text?: string;
}

// ── progressive network jackpot ─────────────────────────────────────────────────────────────────
/** Pool id of the global network jackpot every machine feeds and every friend can win. */
export const NETWORK_JACKPOT = 'net';

export interface JackpotPool {
  id: string;                          // NETWORK_JACKPOT, 'm.<machineId>' for a machine's own meter, …
  value: number;                       // current coins
  seed: number;                        // value after a claim
  /** Fraction of every bet (and of every House-limit excess) that feeds the pool. */
  feed: number;
  /** Passive growth in coins per second ("grows over time"). */
  drip: number;
  cap?: number;
  scope: 'network' | 'machine' | 'zone';
  lastWin: { pid: PlayerId; amount: number; at: number; mid: InstanceId; machineId: MachineId } | null;
}
export interface JackpotsApi {
  list(): readonly JackpotPool[];
  get(id: string): JackpotPool | undefined;
  value(id: string): number;
  /** Per-play chance to be offered the network jackpot on a win of `tier` (modded by `jackpot.mult`-adjacent hooks). */
  chance(machineId: MachineId, bet: number, tier: WinTier): number;
  /** Host: add coins (bet feed, tycoon dividends). Clients see `jp` messages. */
  add(id: string, amount: number): void;
  /** Host: pay the pool to the claimant and reset it to `seed`. Returns coins paid (after `jackpot.mult`). */
  claim(id: string, src: EcoSource): number;
  onChange(fn: (p: JackpotPool) => void): Unsub;
}

// ── contracts / bounties / dailies ──────────────────────────────────────────────────────────────
/**
 * Progress rule evaluated from game events. Example "win 3 hands of blackjack in a row":
 * `{ on: 'machine:result', where: { machineId: 'blackjack', minTier: 'small' }, count: 3, streak: true }`.
 */
export interface ContractGoal {
  on: 'machine:result' | 'machine:round' | 'eco:wallet' | 'run:deposit' | 'machine:jackpot' | 'stat';
  where?: { machineId?: MachineId; tags?: string[]; minTier?: WinTier; minBet?: number; minGross?: number; stat?: string };
  /** How many matching events complete the contract (or the stat target). */
  count: number;
  /** Matching events must be consecutive; a non-matching result on the same `where.machineId` resets. */
  streak?: boolean;
  /** Sum an amount field instead of counting events ('gross' | 'bet' | 'credited' | 'amount'). */
  sum?: 'gross' | 'bet' | 'credited' | 'amount';
}
export type ContractKind = 'bounty' | 'daily' | 'weekly' | 'side' | 'story';
export interface ContractDef {
  id: string;                          // strings → 'contract.<id>.title|desc'
  kind: ContractKind;
  goal: ContractGoal;
  reward: RewardSpec;
  /** 'player' = personal progress, 'team' = shared (co-op), 'versus' = race. */
  scope: 'player' | 'team' | 'versus';
  timeLimitS?: number;                 // from acceptance, host clock
  weight?: number;                     // draw weight on the board
  minShift?: number;
  strings: { en: { title: string; desc: string }; tr: { title: string; desc: string } };
}
export type ContractStatus = 'offered' | 'active' | 'done' | 'claimed' | 'failed' | 'expired';
export interface ContractState {
  uid: string;                         // unique instance id
  def: string;
  owner: PlayerId;                     // 0 = team
  status: ContractStatus;
  progress: number;
  target: number;
  streak?: number;
  expiresAt?: number;                  // host ms
}
export interface ContractsApi {
  register(def: ContractDef): Unsub;
  defs(): ContractDef[];
  /** Contracts on the bounty board right now (offered). */
  board(): readonly ContractState[];
  active(pid?: PlayerId): readonly ContractState[];
  accept(uid: string): boolean;
  abandon(uid: string): boolean;
  /** Pays the reward of a `done` contract. */
  claim(uid: string): boolean;
  /** Host: draw `n` new offers (shift start / reroll). */
  roll(n: number): void;
}
