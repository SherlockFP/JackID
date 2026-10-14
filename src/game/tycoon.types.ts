/**
 * Tycoon / incremental layer — TD-FROZEN types (+ pure reference cost/value maths). Implementation:
 * GAME-TYCOON (`game/tycoon/**`, data in `game/data/tycoon/**`). Contract: BRIEF ADDENDUM 1 + 5, GDD §3.7.
 *
 * Design in one paragraph: upgrades are NEVER hand-written one by one. A small set of
 * {@link UpgradeTemplate}s (track id, curves, milestones, machine filter) is expanded against the machine
 * catalogue × slot sizes × tiers into {@link UpgradeDef}s by the {@link UpgradeCatalog}; the player's state
 * is just `levels: Record<upgradeId, level>`. Every effect is a {@link ModEffect}, so upgrades, charms,
 * buffs and totems fold through the same pipeline. Numbers are plain JS doubles (≤ 1e308) formatted by
 * `fmtCoins` (K M B T Qa Qi …). All purchases are host-validated (`TycoonRequest`).
 */
import type { Hex, InstanceId, MachineId, PlayerId, SlotSize, Unsub, ZoneId } from '@/core/types';
import type { Rng } from '@/core/rng';
import type { SymbolId } from '@/core/texgen/types';
import type { MannequinClip } from '@/kit/types';
import type { MachineCategory } from '@/machines/_base/types';
import type { CurrencyId } from './economy.types';
import type { ModEffect, ModHook, ModScope } from './modifiers.types';

// ── curves (data) ───────────────────────────────────────────────────────────────────────────────
/** Which machines a template / staff def applies to. All present fields must match (AND); `exclude` wins. */
export interface MachineFilter {
  ids?: MachineId[];
  categories?: MachineCategory[];
  tags?: string[];
  sizes?: SlotSize[];
  tiers?: number[];
  exclude?: MachineId[];
}

/** value(level): a number as a function of the upgrade level (level 0 = nothing bought). */
export type ValueCurve =
  | { kind: 'const'; v: number }
  | { kind: 'linear'; base: number; perLevel: number }                     // base + perLevel × L
  | { kind: 'exp'; base: number; growth: number }                          // base × growth^L
  | { kind: 'steps'; steps: Array<[level: number, v: number]>; base?: number };   // last step with level ≤ L

/**
 * Price of going from level L to L+1:
 *   `round( base × size[slotSize] × tier[machineTier] × growth^L × (1 − discount) )`
 * GDD example (M, tier 1, Payout): base 20, growth 1.20 → L0→1 20 · L9→10 103 · L99→100 1.38 B.
 */
export interface CostCurve {
  base: number;
  growth: number;
  /** Multiplier per slot size (default S 0.6 · M 1 · L 1.5 · XL 2.2). */
  size?: Partial<Record<SlotSize, number>>;
  /** Multiplier per catalogue tier index (tier 1 → [0], tier 2 → [1] …); default 1. */
  tier?: number[];
  /** Explicit prices for the first levels, overriding the formula (e.g. Seats L1 2 500, L2 250 000). */
  fixed?: number[];
  round?: 'sig3' | 'int' | 'none';     // default 'sig3'
  currency?: CurrencyId;               // default 'coin'
}

export interface EffectCurve {
  hook: ModHook;
  op: ModEffect['op'];
  value: ValueCurve;
  scope?: ModScope;
}
export interface MilestoneDef {
  level: number;
  /** Extra modifiers granted from this level on (e.g. the ×1.05 at L10). */
  effects?: ModEffect[];
  /** Feature flag the machine reads via `run.tycoon.hasFeature(instance, id)` (e.g. 'bandit.extraLine'). */
  feature?: string;
  /** Visual attachment id the model applies at this level (brass trim, gold marquee, crown topper …). */
  visual?: string;
  /** i18n key suffix for the unlock toast/description ('upg.<track>.milestone.<machine>.<level>'). */
  text?: string;
}

// ── templates → generated defs ──────────────────────────────────────────────────────────────────
export interface UpgradeTemplate {
  /** Track id and the stable part of every generated upgrade id: 'payout' | 'luck' | 'speed' | 'cap' | 'seats' | 'staff' | … */
  id: string;
  /** 'instance' = one level per placed machine · 'type' = shared by every instance of a machine id · 'global' = pit-wide (House improvements). */
  scope: 'instance' | 'type' | 'global';
  icon: SymbolId;
  color?: Hex;
  maxLevel: number;
  cost: CostCurve;
  effects: EffectCurve[];
  /** Per-machine-family milestone table, or a shared one. First matching entry wins. */
  milestones?: Array<{ filter?: MachineFilter; at: MilestoneDef[] }>;
  /** Machines that get this track. Default: all. */
  appliesTo?: MachineFilter;
  /** Gate: another upgrade level, shift index, or feature must be reached first. */
  requires?: { upgrade?: string; level?: number; shift?: number; feature?: string };
  /** Hide from the panel until visible (secret tracks). */
  hidden?: boolean;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };   // → 'upg.<id>.name|desc'
}

export type UpgradeTarget =
  | { scope: 'instance'; instance: InstanceId; machineId: MachineId }
  | { scope: 'type'; machineId: MachineId }
  | { scope: 'global' };

/** A concrete, generated upgrade (template × target). Pure + deterministic; never serialised. */
export interface UpgradeDef {
  /** 'upg.<instance|machineId|global>.<track>' — the key into `TycoonState.levels`. */
  id: string;
  track: string;
  template: UpgradeTemplate;
  target: UpgradeTarget;
  maxLevel: number;
  /** Price of level → level+1 for the given context (discount applied by caller via `upgrade.costMult`). */
  costOf(level: number, discount?: number): number;
  /** Every effect active at `level` (curves evaluated + reached milestones), scoped to the target. */
  effectsAt(level: number): ModEffect[];
  featuresAt(level: number): string[];
  nextMilestone(level: number): MilestoneDef | null;
}

export interface UpgradeCatalog {
  registerTemplate(t: UpgradeTemplate): Unsub;
  templates(): readonly UpgradeTemplate[];
  /** Lazily generated + memoised defs for a target (empty if no template applies). */
  defsFor(target: UpgradeTarget): readonly UpgradeDef[];
  def(id: string): UpgradeDef | undefined;
  /** Number of distinct (target, track, level) purchases the current content can generate. */
  count(): number;
}

export type BuyMode = 1 | 10 | 'max';
export type BuyBlock = 'maxed' | 'locked' | 'funds' | 'phase' | 'requires' | 'owner';
export interface BuyQuote {
  upgrade: string;
  from: number; to: number; levels: number;
  cost: number; currency: CurrencyId;
  affordable: boolean;
  /** Why `levels` is 0 (or reduced). */
  blocked?: BuyBlock;
}
/** What the Service Plate / Upgrade Ledger panel renders per row. */
export interface UpgradeView {
  def: UpgradeDef;
  level: number;
  quote: BuyQuote;
  next: MilestoneDef | null;
}

// ── machines, staff, expansion ──────────────────────────────────────────────────────────────────
export interface OwnedMachine {
  instance: InstanceId;
  machineId: MachineId;
  owner: PlayerId;                     // 0 = shared (co-op house machine)
  name?: string;                       // player-given name on the Service Plate
  skin?: string;
  price: number;                       // what it cost (sell-back, holdings)
  boughtAt: number;                    // host ms
  stats: { rounds: number; wagered: number; won: number };
}
/** Pricing of buying a new machine into an empty pad. */
export interface OrderPricing {
  /** `price = sizeBase[size] × growth^ordersSoFar` (GDD: S 60 · M 120 · L 250 · XL 500, ×2.6). */
  sizeBase: Record<SlotSize, number>;
  growth: number;
  sellBack: number;                    // fraction refunded on sell (0.3)
}
export interface WingDef {
  zone: ZoneId;
  /** Early-buy price as a multiple of the current quota. */
  priceQuotaMult: number;
  requires?: { shift?: number; feature?: string };
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}

export type StaffKind = 'attendant' | 'shill' | 'dealer' | 'cleaner' | 'security' | 'bartender' | (string & {});
export interface StaffDef {
  kind: StaffKind;
  icon: SymbolId;
  /** 'house' earns for the casino (idle yield); 'player' plays your stake headlessly (auto-play). */
  mode: 'house' | 'player';
  hire: CostCurve;                     // price grows with the number already hired this run
  maxCount: number;
  levelCost: CostCurve;
  maxLevel: number;
  /** Seated idle clip pair for the mannequin (kit.mannequin): sit / talk. */
  clips: { idle: MannequinClip; act: MannequinClip };
  /** Income per minute at staff level 1 for a machine of yield 1; the system multiplies by the machine's `yield`, stake, caps, `income.mult`. */
  income?: { perMin: number; perLevel: number; wage: number };
  /** Auto-play: fraction of the instance's max bet staked per play and plays per minute at level 1. */
  autoplay?: { stakeFrac: number; playsPerMin: number; perLevel: number };
  appliesTo?: MachineFilter;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}
export interface StaffState {
  uid: string;
  kind: StaffKind;
  /** null = idle roamer (cleaner/security/bartender). */
  instance: InstanceId | null;
  owner: PlayerId;
  level: number;
  hiredAt: number;
  stake?: number;                      // player-mode: coins per play (auto-refill from float)
  float?: number;
  suspendedUntil?: number;             // host ms (out-of-order event)
  name?: string;
}
export interface IdleReport {
  /** Real seconds away / credited (capped & scaled by rules, e.g. ≤ 600 s at 25 %). */
  awayS: number; creditedS: number;
  earned: number;
  perInstance: Record<InstanceId, number>;
}

/** Headless play contract for staff auto-play and sims (`MachineDef.headless`). */
export interface HeadlessHooks { luck: number; mod(hook: ModHook, base: number): number }
export interface HeadlessResult { gross: number; tags?: string[] }
export type HeadlessPlay = (rng: Rng, bet: number, h: HeadlessHooks) => HeadlessResult;

// ── prestige / meta ─────────────────────────────────────────────────────────────────────────────
export interface MetaNode {
  id: string;                          // strings → 'meta.<id>.name|desc'
  icon: SymbolId;
  cost: CostCurve;                     // in obols (currency 'obol')
  maxLevel: number;
  effects?: EffectCurve[];
  requires?: string[];                 // other node ids
  /** Tree layout hint for the UI (grid units). */
  pos?: [number, number];
  /** Unlock ids granted at level ≥ 1: charms, machines, characters, stakes, music tracks … */
  unlocks?: string[];
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}
export interface MetaState {
  obols: number;
  spent: number;
  nodes: Record<string, number>;
  descents: number;
  bestShift: number;
  bestFloor: number;
  unlocked: string[];
}
export interface PrestigeApi {
  state(): Readonly<MetaState>;
  /** Obols the player would gain by descending now. */
  preview(): { obols: number; multiplier: number };
  /** Reset the run for permanent currency ("Descend"). Host-authoritative in MP; plays the prestige cutscene. */
  descend(): Promise<void>;
  buyNode(id: string): boolean;
  nodes(): readonly MetaNode[];
  registerNode(n: MetaNode): Unsub;
}

/** Start perk + flaw ("The Gambler", "The Widow" …). Unlocked via meta; picked in the lobby. */
export interface CharacterDef {
  id: string;                          // strings → 'char.<id>.name|desc|perk|flaw'
  icon: SymbolId;
  perk: ModEffect[];
  flaw: ModEffect[];
  startWallet?: number;
  startCharms?: string[];
  startBuffs?: string[];
  unlock?: string;
  /** Avatar look. */
  color: Hex;
  strings: { en: { name: string; desc: string; perk: string; flaw: string }; tr: { name: string; desc: string; perk: string; flaw: string } };
}
/** Difficulty ladder rung ("stakes") and run modifiers (daily seed / weekly challenge). */
export interface StakeDef {
  level: number;
  effects: ModEffect[];
  unlock?: string;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}
export interface RunModifierDef {
  id: string;
  effects: ModEffect[];
  /** Multiplies meta rewards (harder = more obols). */
  rewardMult?: number;
  strings: { en: { name: string; desc: string }; tr: { name: string; desc: string } };
}

// ── state & API ─────────────────────────────────────────────────────────────────────────────────
/** Everything the tycoon layer persists / replicates (JSON-safe). */
export interface TycoonState {
  levels: Record<string, number>;
  machines: Record<InstanceId, OwnedMachine>;
  staff: StaffState[];
  /** Wings / zones the player has opened. */
  zones: ZoneId[];
  /** Deepest unlocked floor. */
  floor: number;
  /** Sum of everything bought, depreciating each shift — the taxable base (GDD "Holdings"). */
  holdings: number;
  /** Machines ordered this run (price growth). */
  orders: number;
  /** Lifetime idle earnings this run (stats). */
  idleEarned: number;
}

export type TycoonRequest =
  | { op: 'buy'; upgrade: string; levels: number }
  | { op: 'order'; instance: InstanceId; machineId: MachineId }
  | { op: 'sell'; instance: InstanceId }
  | { op: 'hire'; kind: StaffKind; instance: InstanceId | null }
  | { op: 'fire'; uid: string }
  | { op: 'staffUp'; uid: string }
  | { op: 'stake'; uid: string; stake: number }
  | { op: 'zone'; zone: ZoneId; key?: boolean }
  | { op: 'name'; instance: InstanceId; name: string }
  | { op: 'prestige' }
  | { op: 'meta'; node: string };
export type TycoonNoReason = 'funds' | 'maxed' | 'locked' | 'phase' | 'owner' | 'invalid' | 'occupied' | 'requires';

export interface TycoonApi {
  readonly catalog: UpgradeCatalog;
  readonly prestige: PrestigeApi;
  state(): Readonly<TycoonState>;
  level(upgradeId: string): number;
  /** Rows for an instance's Service Plate (all tracks that apply, with quotes). */
  upgradesFor(instance: InstanceId): readonly UpgradeView[];
  upgradesGlobal(): readonly UpgradeView[];
  quote(upgradeId: string, mode?: BuyMode): BuyQuote;
  /** Client: sends a request (optimistic nothing — UI waits for `tycD`). Host: applies. */
  buy(upgradeId: string, mode?: BuyMode): boolean;
  /** Milestone feature flags currently active for an instance (`ctx.run.tycoon.hasFeature(this.id, 'bandit.extraLine')`). */
  hasFeature(instance: InstanceId, feature: string): boolean;
  features(instance: InstanceId): ReadonlySet<string>;
  // expansion
  owned(instance: InstanceId): OwnedMachine | null;
  /** Machine ids that may be ordered into a pad of this size/zone. */
  orderable(instance: InstanceId): MachineId[];
  orderPrice(machineId: MachineId): number;
  order(instance: InstanceId, machineId: MachineId): boolean;
  sell(instance: InstanceId): boolean;
  /** `key` true: spend a Wing Key (the Manager's Key for the Counting Room) instead of paying the BUY price. */
  unlockZone(zone: ZoneId, key?: boolean): boolean;
  wings(): readonly WingDef[];
  // staff & idle income
  staffAt(instance: InstanceId): readonly StaffState[];
  hire(kind: StaffKind, instance: InstanceId | null): boolean;
  fire(uid: string): boolean;
  upgradeStaff(uid: string): boolean;
  staffDefs(): readonly StaffDef[];
  /** Current passive income in coins per second (HUD "+x/s"). */
  incomePerSec(): number;
  /** Receipt for time away (resume): shown once, then null. */
  takeIdleReport(): IdleReport | null;
  /** Taxable base; see `QuotaState.assessment`. */
  holdings(): number;
  onChange(fn: () => void): Unsub;
}

// ── reference maths (pure; implementations MUST agree) ──────────────────────────────────────────
export const DEFAULT_SIZE_MULT: Record<SlotSize, number> = { S: 0.6, M: 1, L: 1.5, XL: 2.2 };

/** Round to `sig` significant digits (1 234 567 → 1 230 000 for sig 3). Safe up to 1e308. */
export function roundSig(n: number, sig = 3): number {
  if (!isFinite(n) || n === 0) return n;
  const p = Math.pow(10, sig - 1 - Math.floor(Math.log10(Math.abs(n))));
  return Math.round(n * p) / p;
}
/** Price of level `level` → `level + 1`. `tierIndex` is 0-based (catalogue tier − 1). */
export function costAt(c: CostCurve, level: number, size: SlotSize, tierIndex = 0, discount = 0): number {
  const fixed = c.fixed?.[level];
  let v = fixed !== undefined
    ? fixed
    : c.base * (c.size?.[size] ?? DEFAULT_SIZE_MULT[size]) * (c.tier?.[tierIndex] ?? 1) * Math.pow(c.growth, level);
  v *= 1 - discount;
  const r = c.round ?? 'sig3';
  return r === 'sig3' ? Math.max(1, roundSig(v, 3)) : r === 'int' ? Math.max(1, Math.round(v)) : v;
}
export function valueAt(c: ValueCurve, level: number): number {
  switch (c.kind) {
    case 'const': return c.v;
    case 'linear': return c.base + c.perLevel * level;
    case 'exp': return c.base * Math.pow(c.growth, level);
    case 'steps': { let v = c.base ?? 0; for (const [l, x] of c.steps) if (level >= l) v = x; return v; }
  }
}
