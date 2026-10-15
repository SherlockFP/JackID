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
import type { DuelRunHooks } from './duels/stakes';
import type { ModEffect, ModHook, ModBreakdown, ModQuery, ModifierApi } from './modifiers.types';
import type { ShiftApi, NightEventsApi } from './shift.types';
import type { TycoonApi } from './tycoon.types';
import type { BuffsApi } from './buffs.types';
import type { TotemsApi, CollateralApi } from './items.types';
import type { ContractsApi, CurrencyId, JackpotsApi } from './economy.types';
import type { DoorTrigger, DuelEnd, LordId } from './hollow/rules';

export * from './modifiers.types';
export * from './shift.types';
export * from './tycoon.types';
export * from './buffs.types';
export * from './items.types';
export * from './economy.types';

export type WinTier = 'none' | 'push' | 'small' | 'medium' | 'big' | 'huge' | 'mega' | 'jackpot';
/** Ascending order, for comparisons: `WIN_TIERS.indexOf(a) >= WIN_TIERS.indexOf(b)`. */
export const WIN_TIERS: readonly WinTier[] = ['none', 'push', 'small', 'medium', 'big', 'huge', 'mega', 'jackpot'];
/** Seconds the second press of a big stake stays valid after the first (economy.ts re-exports it; machines read it from here). */
export const STAKE_CONFIRM_SEC = 6;
// tierFor(gross, bet) (machines/_base/tiers.ts): 0 → none; ≤1× → push; <3× small; <10× medium; <50× big; <200× huge; else jackpot
// 'mega' (v1.1, DECISIONS §G) has its own fx/jingle tier; tiers.ts thresholds for it follow the amended §2.13 comment.

/**
 * Time words (TECH §11.5 / DECISIONS C17) — `RunPhase` is removed.
 * Night = `QuotaState.index` (the night you are in); Watch = one play window (shift timer running);
 * Dawn = collection (between windows, the quota is settled).
 */
export type RunWindow = 'watch' | 'dawn';

/** Why a Debt Terminal deposit is refused (director decision 3): the terminal shows the matching line. */
export type DepositRefusal = 'notQuota' | 'closed' | 'nightPaid' | 'nothing' | 'float';

/**
 * Why `run.bet()` / a play / a run action was refused (`run.lastRefusal()`): the bet and pulls codes, the deposit codes
 * (`DepositRefusal`) and the rest of the run's refusals (the Pawn window, the lever and the Bell, the settle, the quota).
 */
export type RefusalReason = 'funds' | 'pulls' | 'phase' | 'limit' | 'confirm' | 'locked' | DepositRefusal
  | 'shopShut' | 'watchRunning' | 'watchEnding' | 'belling' | 'settling' | 'noWatch' | 'nightUnpaid' | 'quotaShort' | 'nightCard'
  /** `locked`: a WITHDRAW the seal holds (coins above the quota wait for Dawn; BREAK SEAL takes them). `noSeal`: nothing to break. */
  | 'noSeal';

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
  /** Live counter shown on the HUD peg (null or '' = no counter). Reads the charm's data bag only. */
  badge?(data: Readonly<Record<string, Json>>): string | number | null;
}
export interface CharmCtx { pid: PlayerId; stacks: number; run: RunApi; rng: Rng; proc(tier?: number, label?: string): void; data: Record<string, Json> }

/**
 * The economy / run facade every machine, HUD and system talks to. Single-player = offline host:
 * code is written once as `if (isHost) apply() else request()`.
 *
 * Sub-APIs (`shift`, `tycoon`, `buffs`, …) are separate objects so each WP implements and tests its
 * own; machines normally need only the flat economy members at the top plus `mod`/`getModifier`.
 */
export interface RunApi {
  readonly mode: GameMode; readonly seed: number; readonly selfId: PlayerId;
  /** The Tally Bench's run-side hooks (Soul Marks, Pledge, boss rewards). Absent on bench runs: the duel table then offers Coins and Pledge only. */
  readonly duel?: DuelRunHooks;
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
  /** What `win()` would credit for this gross (net of House Favour, modifiers, factors, limit). Pays nothing; WIN callouts show it. */
  previewCredit(gross: number, src: EcoSource, meta: Pick<WinMeta, 'bet' | 'raw' | 'factorApplied'>): number;
  deposit(amount: number, confirmAll?: boolean): boolean;   // Debt Terminal only; the first deposit of a Watch keeps a float unless confirmAll
  /** Pocket floor the first deposit of a Watch must leave (src/game/float.ts). */
  depositFloor?(): number;
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

  // ── the Hollow Door (src/game/hollow): once per run, saved in the run. The world and the Lords' table call these. ──
  /** Opens the door for a trigger when the rules allow it (once per run). The world shows the doorway on `hollow:open`. */
  hollowTrigger(trigger: DoorTrigger): boolean;
  /** The 3:33 call may ring this Watch (Night 2+, door unused, phone not spent). */
  hollowCanRing(): boolean;
  /** The 3:33 call starts ringing. */
  hollowRing(): boolean;
  /** The 3:33 call: 'godown' opens the door, 'hangup' spends the phone for the run. */
  hollowAnswer(choice: 'godown' | 'hangup'): boolean;
  /** The player walked into THE UNDERNEATH. */
  hollowEnter(): void;
  /** The player sat with a Lord. */
  hollowPick(lord: LordId): void;
  /** The player climbed back out, or the open doorway timed out: the door closes for the run. */
  hollowLeave(): void;
  /** The Lords' duel ended ('won' | 'taken' | 'left'): the door seals for the run. */
  hollowFinish(ended: DuelEnd): void;
  // Run effects of a Lord's duel (`applyEffects` in src/game/hollow/rules.ts)
  /** Quota relief: the Nights from the current one for `nights` Nights owe nothing. */
  forgiveQuota(nights: number): void;
  /** The Lord takes the run: it ends here ('taken'; Obols still bank). */
  takeRun(): void;
  /** One Soul Mark goes back on the card (a caught Mirror cheat). */
  restoreSoulMark(): void;
  /** Multiplies the Obols this run banks at its end (a taken run: ×1.5). */
  hollowBankObols(mult: number): void;

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
