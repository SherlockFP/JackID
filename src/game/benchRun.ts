/**
 * BenchRun (base-machines WP) — the `RunApi` behind `/?bench=<id>` (TECH_SPEC §10.4): infinite deadline, a debug
 * wallet (10 000), and a REAL modifier pipeline (`foldEffects` from modifiers.types) so charms / luck / payout
 * multipliers can be dialled in from the bench panel and every machine hook is exercised exactly as in a run.
 *
 * Implemented for real: wallet, bet / win (payout.mult, payout.flat, loss.refund, bet.costMult), host variants,
 * the modifier API, tycoon feature flags, stats, secondary currencies, jackpot pools, `bus` events
 * (`machine:round`, `machine:result`, `eco:wallet`). Everything else (shift, buffs, totems …) is a documented stub
 * that logs once when a machine touches it — see {@link stubApi}.
 */
import type { GameMode, InstanceId, MachineId, PlayerId } from '@/core/types';
import type {
  ActiveRule, CharmState, DebtState, EcoSource, HeadlessResult, ModBreakdown, ModBreakdownStep, ModEffect, ModHook, ModProvider,
  ModQuery, ModSource, ModifierApi, RunApi, RunWindow, WinMeta, TycoonApi, ShiftApi, BuffsApi, TotemsApi, CollateralApi,
  NightEventsApi, ContractsApi, JackpotsApi, CurrencyId, BetLimits, BetOpts, RefusalReason,
} from '@/game/types';
import { foldEffects, modHookMeta, scopeMatches, stackedValue } from '@/game/types';
import type { PhoneCallState, RunConfig } from '@/net/protocol';
import type { ShiftState } from '@/game/shift.types';
import type { CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import { createRng } from '@/core/rng';
import { bus } from '@/core/events';
import { log } from '@/core/log';
import { fmtCoins, t } from '@/core/i18n';
import type { UIOverlay } from '@/core/ui/types';
import * as registry from '@/machines/_base/registry';
import { scopeTags } from './suits';

export const BENCH_WALLET = 10_000;

/** Object whose unknown members are no-op functions that log once — keeps untouched sub-APIs honest but harmless. */
export function stubApi<T extends object>(name: string, impl: Partial<T> = {}): T {
  return new Proxy(impl as T, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv) as unknown;
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (): undefined => {
        log.warnOnce(`bench:${name}.${prop}`, 'bench', `${name}.${prop}() is stubbed in the bench`);
        return undefined;
      };
    },
  });
}

// ── modifier pipeline ──────────────────────────────────────────────────────────────────────────────
class BenchMods implements ModifierApi {
  revision = 0;
  private providers = new Set<ModProvider>();

  register(p: ModProvider): () => void {
    this.providers.add(p); this.touch();
    return () => { this.providers.delete(p); this.touch(); };
  }
  touch(): void { this.revision++; }

  private collectSources(q: ModQuery): ModSource[] {
    const sources: ModSource[] = [];
    for (const p of this.providers) p.collect(q, sources);
    return sources;
  }
  private matching(hook: ModHook, machineId: MachineId, q: ModQuery, sources: ModSource[]): Array<{ src: ModSource; eff: ModEffect; value: number }> {
    const def = registry.get(machineId)?.def;
    const m = { machineId, category: def?.category, tags: scopeTags(machineId, def?.tags), zone: def?.zone, instance: q.instance, mode: 'free' as GameMode, pid: q.pid ?? 1, pos: q.pos };
    const out: Array<{ src: ModSource; eff: ModEffect; value: number }> = [];
    for (const src of sources) {
      for (const eff of src.effects) {
        if (eff.hook === hook && scopeMatches(eff.scope, m)) out.push({ src, eff, value: stackedValue(eff, src.stacks ?? 1) });
      }
    }
    return out;
  }
  private modify(hook: ModHook, machineId: MachineId, v: number, q: ModQuery, sources: ModSource[]): number {
    for (const s of sources) if (s.modify) v = s.modify(hook, machineId, v, q);
    return v;
  }

  mod(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): number {
    const sources = this.collectSources(q);      // collected once, shared by match + modify
    const effs = this.matching(hook, machineId, q, sources).map((m) => ({ op: m.eff.op, value: m.value, priority: m.eff.priority }));
    return this.modify(hook, machineId, foldEffects(hook, base, effs), q, sources);
  }

  explain(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): ModBreakdown {
    const sources = this.collectSources(q);
    const list = this.matching(hook, machineId, q, sources);
    const steps: ModBreakdownStep[] = [];
    let before = foldEffects(hook, base, []);
    const acc: Array<{ op: ModEffect['op']; value: number; priority?: number }> = [];
    for (const m of list) {
      acc.push({ op: m.eff.op, value: m.value, priority: m.eff.priority });
      const after = foldEffects(hook, base, acc);
      steps.push({ source: { kind: m.src.kind, id: m.src.id, owner: m.src.owner }, op: m.eff.op, value: m.value, stacks: m.src.stacks ?? 1, before, after });
      before = after;
    }
    const result = this.modify(hook, machineId, before, q, sources);
    const meta = modHookMeta(hook);
    return { hook, machineId, base, result, clamped: result <= meta.min || result >= meta.max, steps };
  }
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────
export interface BenchStats { rounds: number; wagered: number; paid: number; biggest: number; wins: number }

export class BenchRun implements RunApi {
  readonly mode: GameMode = 'free';
  private win_: RunWindow = 'watch';
  private refusal: RefusalReason | null = null;
  night(): number { return 0; }
  window(): RunWindow { return this.win_; }
  pulls(_pid?: PlayerId): number { return Number.POSITIVE_INFINITY; }
  lastRefusal(): RefusalReason | null { return this.refusal; }
  betLimits(_machineId: MachineId, _instanceId: InstanceId): BetLimits {
    return { min: 1, max: 100, ladder: [1, 5, 10, 25, 50, 100] };
  }
  payoutFactor(_machineId: MachineId, _instanceId: InstanceId): number { return 1; }
  readonly selfId: PlayerId = 1;
  readonly config: Readonly<RunConfig> = { startWallet: BENCH_WALLET, deadlines: 99, difficulty: 'normal', friendlyGive: true };
  readonly mods = new BenchMods();
  readonly stats: BenchStats = { rounds: 0, wagered: 0, paid: 0, biggest: 0, wins: 0 };

  readonly shift = stubApi<ShiftApi>('shift', {
    phase: 'idle',
    timeLeft: () => 3599,
    rules: (): readonly ActiveRule[] => [],
    // Machines read `state().stake` / `.floor` / `.segment` (cashier, shrine, charms): give the bench a real shape.
    state: (): Readonly<ShiftState> => ({
      index: 0, floor: 1, phase: 'idle', startedAt: 0, endsAt: 0, duration: 0, lastCallSec: 0,
      stake: 1, clock: 0, rules: [],
    } as unknown as ShiftState),
  });
  readonly tycoon: TycoonApi;
  readonly buffs = stubApi<BuffsApi>('buffs', { has: () => false, stacks: () => 0, list: () => [] });
  readonly totems = stubApi<TotemsApi>('totems', { list: () => [], mine: () => [], inRadius: () => [] });
  readonly collateral = stubApi<CollateralApi>('collateral');
  readonly nightEvents = stubApi<NightEventsApi>('nightEvents', { active: () => [], isActive: () => false });
  readonly contracts = stubApi<ContractsApi>('contracts', { board: () => [], active: () => [] });
  readonly jackpots = stubApi<JackpotsApi>('jackpots', { value: () => 0, list: () => [] });

  private coins: number;
  private readonly currencies = new Map<string, number>();
  private readonly pools = new Map<string, number>();
  private readonly counters = new Map<string, number>();
  private readonly features = new Set<string>();
  private readonly debug = new Map<string, ModEffect>();
  private readonly openRounds = new Set<string>();
  private readonly listeners = new Set<() => void>();

  /**
   * @param ui toasts / banners for wins (the real HUD replaces this); omit for headless sims.
   * @param seed run seed (`?seed=`).
   */
  constructor(readonly seed: number, private readonly ui?: UIOverlay, wallet = BENCH_WALLET) {
    this.coins = wallet;
    const features = this.features;
    this.tycoon = stubApi<TycoonApi>('tycoon', {
      hasFeature: (_i: InstanceId, f: string) => features.has(f),
      features: () => features,
      level: () => 0,
      incomePerSec: () => 0,
      holdings: () => 0,
    });
    this.mods.register({
      kind: 'debug',
      collect: (_q, out) => { if (this.debug.size) out.push({ kind: 'debug', id: 'bench', owner: 0, effects: [...this.debug.values()] }); },
    });
  }

  // ── bench controls (panel) ──
  setWallet(n: number): void { const d = n - this.coins; this.coins = n; this.changed(d, 'debug'); }
  /** Set (or with null remove) a debug modifier effect, keyed so sliders can replace their own. */
  setEffect(key: string, e: ModEffect | null): void {
    if (e) this.debug.set(key, e); else this.debug.delete(key);
    this.mods.touch();
    this.listeners.forEach((fn) => fn());
  }
  effects(): ReadonlyMap<string, ModEffect> { return this.debug; }
  setFeature(name: string, on: boolean): void { if (on) this.features.add(name); else this.features.delete(name); }
  featureList(): string[] { return [...this.features]; }
  resetStats(): void { Object.assign(this.stats, { rounds: 0, wagered: 0, paid: 0, biggest: 0, wins: 0 }); this.listeners.forEach((fn) => fn()); }
  /** Panel refresh hook (wallet / stats / effects changed). */
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  rtp(): number { return this.stats.wagered > 0 ? this.stats.paid / this.stats.wagered : 0; }

  private changed(delta: number, reason: string): void {
    bus.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta, reason });
    this.listeners.forEach((fn) => fn());
  }

  // ── economy ──
  wallet(_pid?: PlayerId): number { return this.coins; }
  canAfford(cost: number, _pid?: PlayerId): boolean { return this.coins >= cost; }

  bet(amount: number, src: EcoSource, _o?: BetOpts): boolean {
    const cost = Math.ceil(amount * this.mod('bet.costMult', src.machineId, 1));
    if (cost > this.coins) { this.refusal = 'funds'; return false; }
    this.refusal = null;
    this.coins -= cost;
    this.stats.wagered += cost;
    if (!this.openRounds.has(src.mid)) {          // extra stakes (double, split …) belong to the same round
      this.openRounds.add(src.mid);
      this.stats.rounds++;
      bus.emit('machine:round', { mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: amount });
    }
    this.changed(-cost, `bet:${src.machineId}`);
    return true;
  }

  previewCredit(gross: number, src: EcoSource, meta: Pick<WinMeta, 'bet' | 'raw' | 'factorApplied'>): number {
    if (gross <= 0) return Math.floor(meta.bet * this.mod('loss.refund', src.machineId, 0));
    return Math.max(0, Math.floor(gross * this.mod('payout.mult', src.machineId, 1) + this.mod('payout.flat', src.machineId, 0)));
  }

  win(gross: number, src: EcoSource, meta: WinMeta): number {
    let g = gross;
    this.openRounds.delete(src.mid);
    if (g > 0) g = g * this.mod('payout.mult', src.machineId, 1) + this.mod('payout.flat', src.machineId, 0);
    else g = Math.floor(meta.bet * this.mod('loss.refund', src.machineId, 0));
    const credited = Math.max(0, Math.floor(g));
    this.coins += credited;
    this.stats.paid += credited;
    if (credited > 0) this.stats.wins++;
    this.stats.biggest = Math.max(this.stats.biggest, credited);
    bus.emit('machine:result', {
      mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: meta.bet, gross, credited, tier: meta.tier, tags: meta.tags ?? [],
    });
    this.changed(credited, `win:${src.machineId}`);
    if (!meta.silent && credited > 0) this.announce(credited, meta);
    return credited;
  }

  private announce(credited: number, meta: WinMeta): void {
    const ui = this.ui;
    if (!ui) return;
    ui.bump('wallet');
    if (meta.tier === 'big' || meta.tier === 'huge' || meta.tier === 'jackpot') {
      void ui.bigWin(credited, meta.tier, t(meta.tier === 'jackpot' ? 'common.jackpot' : 'common.win'));
    } else {
      ui.toast(`+${fmtCoins(credited, true)}`, 'good', 1.5);
    }
  }

  deposit(_amount: number): boolean { return false; }
  give(_to: PlayerId, _amount: number): boolean { return false; }
  buyCharm(_id: string, _price: number): boolean { return false; }
  grantCharm(_id: string): boolean { return false; }

  hostBet(pid: PlayerId, amount: number, src: EcoSource): boolean { return pid === this.selfId && this.bet(amount, src); }
  hostWin(pid: PlayerId, gross: number, src: EcoSource, meta: WinMeta): number { return pid === this.selfId ? this.win(gross, src, meta) : 0; }

  // ── modifiers ──
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number { return this.mods.mod(hook, machineId, base, { pid }); }
  mod(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): number { return this.mods.mod(hook, machineId, base, q); }
  explain(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): ModBreakdown { return this.mods.explain(hook, machineId, base, q); }
  luck(machineId: MachineId, pid?: PlayerId): number { return this.mods.mod('luck', machineId, 0, { pid }); }
  charms(_pid?: PlayerId): readonly CharmState[] { return []; }

  // ── pools / info ──
  jackpot(pool: string): number { return this.pools.get(pool) ?? 0; }
  jackpotAdd(pool: string, amount: number): void { this.pools.set(pool, this.jackpot(pool) + amount); }
  jackpotClaim(pool: string, _src: EcoSource): number { const v = this.jackpot(pool); this.pools.set(pool, 0); this.coins += v; this.changed(v, `jackpot:${pool}`); return v; }
  debt(_pid?: PlayerId): DebtState { return { index: 0, due: 0, paid: 0, deadlineAt: 0, floor: 1, total: 99 }; }
  timeLeft(): number { return 3599; }
  isLocked(_machineId: MachineId): boolean { return false; }
  alive(_pid?: PlayerId): boolean { return true; }
  stat(key: string, add = 0): number { const v = (this.counters.get(key) ?? 0) + add; if (add) this.counters.set(key, v); return v; }
  phone(): PhoneCallState | null { return null; }
  answerPhone(_choice: number): void {}
  // The Hollow Door is off on the bench (no floor below the pit to open it on).
  hollowTrigger(): boolean { return false; }
  hollowCanRing(): boolean { return false; }
  hollowRing(): boolean { return false; }
  hollowAnswer(): boolean { return false; }
  hollowEnter(): void {}
  hollowPick(): void {}
  hollowLeave(): void {}
  hollowFinish(): void {}
  forgiveQuota(): void {}
  takeRun(): void {}
  restoreSoulMark(): void {}
  hollowBankObols(): void {}

  balance(cur: CurrencyId, _pid?: PlayerId): number { return cur === 'coin' ? this.coins : this.currencies.get(cur) ?? 0; }
  earn(cur: CurrencyId, amount: number, reason: string, _pid?: PlayerId): void {
    if (cur === 'coin') { this.coins += amount; this.changed(amount, reason); } else this.currencies.set(cur, this.balance(cur) + amount);
  }
  spend(cur: CurrencyId, amount: number, reason: string, _pid?: PlayerId): boolean {
    if (this.balance(cur) < amount) return false;
    if (cur === 'coin') { this.coins -= amount; this.changed(-amount, reason); } else this.currencies.set(cur, this.balance(cur) - amount);
    return true;
  }
  dread(): number { return 0; }
  addDread(_delta: number, _reason?: string): void {}
  playCutscene(_id: string, _o?: CutscenePlayOpts): Promise<CutsceneResult> { return Promise.resolve('aborted'); }
}

// ── headless simulation (bench "Sim" button) ───────────────────────────────────────────────────────
export interface SimResult { rounds: number; wagered: number; paid: number; rtp: number; hitRate: number; biggest: number }

/** Play `n` rounds of `machineId` through `def.headless` with the run's CURRENT modifiers; wallet is untouched. */
export function simulate(run: RunApi, machineId: MachineId, n: number, bet: number, seed = 12345): SimResult | null {
  const def = registry.get(machineId)?.def;
  if (!def?.headless) return null;
  const rng = createRng(seed);
  const hooks = { luck: run.luck(machineId), mod: (hook: ModHook, base: number): number => run.mod(hook, machineId, base) };
  let paid = 0, wins = 0, biggest = 0;
  for (let i = 0; i < n; i++) {
    const r: HeadlessResult = def.headless(rng, bet, hooks);
    let g = r.gross;
    if (g > 0) g = g * run.mod('payout.mult', machineId, 1) + run.mod('payout.flat', machineId, 0);
    g = Math.floor(g);
    paid += g;
    if (g > 0) wins++;
    biggest = Math.max(biggest, g);
  }
  const wagered = bet * n;
  return { rounds: n, wagered, paid, rtp: wagered ? paid / wagered : 0, hitRate: n ? wins / n : 0, biggest };
}
