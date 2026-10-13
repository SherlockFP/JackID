/**
 * Game-layer contract — TD-FROZEN (change only via the Tech Director). Implementation: GAME-RUN (+ siblings).
 * Contract: TECH_SPEC §2.13, extended with the data-driven systems of BRIEF ADDENDA 1–8.
 *
 * This file is the barrel: machines, HUD, net and world import ONLY from `@/game/types`.
 * Sibling type files (all frozen, all re-exported here):
 *   modifiers.types  unified `mod()` pipeline: ModHook/ModEffect/ModSource/ModifierApi + reference fold
 *   shift.types      real-time shift, quota + overshoot, boss/ante rules, nightly events, dread
 *   tycoon.types     upgrade templates → generated defs, owned machines, staff/automatons, prestige/meta
 *   buffs.types      buff/debuff defs, state, BuffsApi
 *   items.types      Totems (radius items) and Collateral (porcelain body parts)
 *   economy.types    currencies, RewardSpec, progressive network jackpot, contracts/bounties
 */
import type { GameMode, InstanceId, Json, MachineId, PlayerId } from '@/core/types';
import type { Rng } from '@/core/rng';
import type { GameEvents } from '@/core/events';
import type { SymbolId } from '@/core/texgen/types';
import type { CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import type { PhoneCallState, RunConfig } from '@/net/protocol';
import type { ModEffect, ModHook, ModBreakdown, ModQuery, ModifierApi } from './modifiers.types';
import type { ShiftApi, NightEventsApi } from './shift.types';
import type { TycoonApi } from './tycoon.types';
import type { BuffsApi } from './buffs.types';
import type { TotemsApi, CollateralApi } from './items.types';
import type { ContractsApi, CurrencyId, JackpotsApi } from './economy.types';

export * from './modifiers.types';
export * from './shift.types';
export * from './tycoon.types';
export * from './buffs.types';
export * from './items.types';
export * from './economy.types';

export type WinTier = 'none' | 'push' | 'small' | 'medium' | 'big' | 'huge' | 'mega' | 'jackpot';
/** Ascending order, for comparisons: `WIN_TIERS.indexOf(a) >= WIN_TIERS.indexOf(b)`. */
export const WIN_TIERS: readonly WinTier[] = ['none', 'push', 'small', 'medium', 'big', 'huge', 'mega', 'jackpot'];
// tierFor(gross, bet) (machines/_base/tiers.ts): 0 → none; ≤1× → push; <3× small; <10× medium; <50× big; <200× huge; else jackpot
// 'mega' (v1.1, DECISIONS §G) has its own fx/jingle tier; tiers.ts thresholds for it follow the amended §2.13 comment.

/**
 * Time words (TECH §11.5 / DECISIONS C17) — `RunPhase` is removed.
 * Night = `QuotaState.index` (the night you are in); Watch = one play window (shift timer running);
 * Dawn = collection (between windows, the quota is settled).
 */
export type RunWindow = 'watch' | 'dawn';

/** Why `run.bet()` / a play was refused (`run.lastRefusal()`). */
export type RefusalReason = 'funds' | 'pulls' | 'phase' | 'limit';

/** Catalogue range × SI × Cap (TECH §11.5). `ladder` = the bet steps `stepBet()` walks. */
export interface BetLimits { min: number; max: number; ladder: number[] }

export interface EcoSource { mid: InstanceId; machineId: MachineId }
export interface WinMeta {
  bet: number; tier: WinTier; tags?: string[]; silent?: boolean;
  /** No modifiers, no juice: buy-ins, cash-outs, refunds (TECH §11.5). */
  raw?: boolean;
  /** Set by GAME-RUN when `payoutFactor` was already applied to `gross` (elevator). */
  factorApplied?: boolean;
}
export interface BetOpts {
  /** Pulls this bet costs (default: the machine's `def.actionCost`; block-cost devices pass their own). */
  pulls?: number;
}
export interface DebtState { index: number; due: number; paid: number; deadlineAt: number /* host ms */; floor: number; total: number }
export interface CharmState { id: string; stacks: number; data?: Json }

export type CharmRarity = 'common' | 'uncommon' | 'rare' | 'cursed' | 'legendary';

/**
 * Charm definition (`src/game/charms/defs/<id>.ts`, glob-registered, `export const charm: CharmDef`).
 * Charms fold into the modifier pipeline: declaratively via `effects` (preferred, serialisable) and/or
 * by code via `modify` (acquisition order; runs after the declarative fold of the same hook).
 */
export interface CharmDef {
  id: string;
  rarity: CharmRarity;
  price: number;                       // base price; the shop multiplies by the stake index
  maxStacks?: number;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };   // → 'charm.<id>.*'
  icon: SymbolId;
  /** Affinity tag (suit / family / 'LEDGER' / 'TYCOON'); 2–4 of the same tag unlock bonuses. */
  tag?: string;
  tags?: string[];
  effects?: ModEffect[];
  modify?(hook: ModHook, machineId: MachineId, value: number, c: CharmCtx): number;
  on?: { [K in keyof GameEvents]?: (p: GameEvents[K], c: CharmCtx) => void };      // host-side triggers
  /** Unlock code: '' = from the start, 'N3' = pay night 3, 'W' = win once, 'A:<achievement>' … */
  unlock?: string;
  /** Cursed charms cannot be sold; they pay a sign-on fee. */
  signOnFee?: number;
}
export interface CharmCtx { pid: PlayerId; stacks: number; run: RunApi; rng: Rng; proc(): void; data: Record<string, Json> }

/**
 * The economy / run facade every machine, HUD and system talks to. Single-player = offline host:
 * code is written once as `if (isHost) apply() else request()`.
 *
 * Sub-APIs (`shift`, `tycoon`, `buffs`, …) are separate objects so each WP implements and tests its
 * own; machines normally need only the flat economy members at the top plus `mod`/`getModifier`.
 */
export interface RunApi {
  readonly mode: GameMode; readonly seed: number; readonly selfId: PlayerId;
  readonly config: Readonly<RunConfig>;
  /** Current Night (= `shift.quota.index`) and Watch/Dawn window (TECH §11.5, C17). */
  night(): number;
  window(): RunWindow;
  wallet(pid?: PlayerId): number;
  canAfford(cost: number, pid?: PlayerId): boolean;
  /** Pulls (action points) left for the player (tickets are `balance('ticket')`, not pulls). */
  pulls(pid?: PlayerId): number;
  /** Reason of the last refused `bet()` / play, or null. */
  lastRefusal(): RefusalReason | null;
  /** Catalogue range × SI × Cap (`x.bet.maxStep`, GDD §3.2). `stepBet()` / `maxBet()` use it. */
  betLimits(machineId: MachineId, instanceId: InstanceId): BetLimits;
  /** GDD §3.3 `econ.payoutFactor` (read-only; elevator uses it). */
  payoutFactor(machineId: MachineId, instanceId: InstanceId): number;
  /** Local player stakes `amount` (nominal). Charges ceil(amount × bet.costMult). Sync. MP: optimistic + host confirm.
   *  Refusals set `lastRefusal()`. Pulls: `o.pulls`, else the machine's `actionCost` (GAME-RUN applies x.actionCostDelta). */
  bet(amount: number, src: EcoSource, o?: BetOpts): boolean;
  /** Local player wins `gross` (pre-modifier). Applies payout.mult/flat or loss.refund. Shows personal toast/banner by tier. Returns coins credited. */
  win(gross: number, src: EcoSource, meta: WinMeta): number;
  deposit(amount: number): boolean;                         // Debt Terminal only
  give(to: PlayerId, amount: number): boolean;              // co-op transfer
  buyCharm(charmId: string, price: number): boolean;        // Charm vendor only
  /** Free charm from a prize (lootbox, claw, coin pusher, bounty). No phase gate. True when it was added. */
  grantCharm(charmId: string): boolean;
  // HOST ONLY — shared tables (throws in dev if !isHost)
  hostBet(pid: PlayerId, amount: number, src: EcoSource): boolean;
  hostWin(pid: PlayerId, gross: number, src: EcoSource, meta: WinMeta): number;
  // modifiers (one pipeline for charms, upgrades, buffs, totems, events, collateral, perks …)
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number;
  /** Full form of `getModifier` with instance/position context (instance upgrades, radius totems). */
  mod(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): number;
  explain(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): ModBreakdown;
  readonly mods: ModifierApi;
  luck(machineId: MachineId, pid?: PlayerId): number;
  charms(pid?: PlayerId): readonly CharmState[];
  // shared pools (the network jackpot is pool 'net'); richer API in `jackpots`
  jackpot(pool: string): number;
  jackpotAdd(pool: string, amount: number): void;
  jackpotClaim(pool: string, src: EcoSource): number;       // host pays pool value at receipt
  // run info
  debt(pid?: PlayerId): DebtState;                          // co-op: team debt (pid 0)
  timeLeft(): number;                                       // s to current deadline / end of the real-time shift
  isLocked(machineId: MachineId): boolean;                  // tier gating
  alive(pid?: PlayerId): boolean;
  stat(key: string, add?: number): number;
  // hotline (system machine 'hotline' only)
  phone(): PhoneCallState | null;
  answerPhone(choice: number): void;                        // −1 = pick up; host resolves

  // ── subsystems (BRIEF ADDENDA 1, 3, 5, 8) ──
  readonly shift: ShiftApi;
  readonly tycoon: TycoonApi;
  readonly buffs: BuffsApi;
  readonly totems: TotemsApi;
  readonly collateral: CollateralApi;
  readonly nightEvents: NightEventsApi;
  readonly contracts: ContractsApi;
  readonly jackpots: JackpotsApi;
  /** Secondary currencies ('ticket', 'obol'). Coins stay on `wallet()`. */
  balance(cur: CurrencyId, pid?: PlayerId): number;
  earn(cur: CurrencyId, amount: number, reason: string, pid?: PlayerId): void;
  spend(cur: CurrencyId, amount: number, reason: string, pid?: PlayerId): boolean;
  /** Horror meter 0..1 (quota pressure + events + collateral). Drives lights, music, audio. */
  dread(): number;
  addDread(delta: number, reason?: string): void;
  /** Host: broadcast + play a scripted scene on every peer (vote-skippable). Client: no-op, resolves 'aborted'. */
  playCutscene(id: string, o?: CutscenePlayOpts): Promise<CutsceneResult>;
}
