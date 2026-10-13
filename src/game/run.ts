/**
 * Run (GAME-RUN): the single-player Debt Run behind `RunApi` (GDD §2, §3.3, §7.1). Replaces `BenchRun` in the real game.
 *
 * Owns: the Night / Watch / Dawn state machine (Bell → Play → Last Call → Closing → Settle → Intermission → Dawn
 * Collection), pulls, the real-time Watch clock, the wallet and the Debt Terminal (deposits, quota, interest, overpay),
 * the payout choke point, the House Limit, the trapdoor, the mod() pipeline (charms + house Favour/Witching), the network
 * jackpot pool and save/resume after every resolved action.
 *
 * Time: `tick(dt)` advances everything in SIM seconds; call it from the fixed step. Nothing here reads wall time.
 * Indices: `shift.index` / `debt.index` are 0-based; `night()` is the printed 1-based Night number.
 */
import type {
  ActiveRule, BetLimits, BetOpts, BuffsApi, CharmDef, CharmState, CollateralApi, ContractsApi, CurrencyId,
  DebtState, EcoSource, JackpotPool, JackpotsApi, ModBreakdown, ModBreakdownStep, ModEffect, ModHook, ModProvider, ModQuery,
  ModSource, ModifierApi, NightEventsApi, OvershootClaim, QuotaState, RefusalReason, RewardSpec, RunApi, RunWindow,
  ShiftApi, ShiftPhase, ShiftRuleDef, ShiftState, TotemsApi, TycoonApi, WinMeta, WinTier,
} from '@/game/types';
import { foldEffects, modHookMeta, scopeMatches, stackedValue, WIN_TIERS } from '@/game/types';
import type { GameMode, InstanceId, MachineId, PlayerId, SlotSize, Unsub, V3 } from '@/core/types';
import type { PhoneCallState, RunConfig, RunSnapshot, RunSummary } from '@/net/protocol';
import type { CutscenePlayOpts, CutsceneResult } from '@/core/cutscene/types';
import type { GameEvents } from '@/core/events';
import { bus } from '@/core/events';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { log } from '@/core/log';
import type { SaveStore } from '@/core/save';
import * as registry from '@/machines/_base/registry';
import { WatchClock, type ClockSnapshot } from './clock';
import {
  ACTIVITY_MIN_PULLS, BASE_RUN_NIGHTS, NETWORK_FEED, OVERSHOOT_TIERS, START, TICKET_CAP,
  assessmentFor, closingSeconds, interestFor, interestRate, isWitchingWatch, lastCallSeconds, nightDef, quotaFor,
} from './data/schedule';
import { PAYOUT_GUARD, bettingLadder, charmPrice, settlePayout, snapDown, type PayoutResult } from './economy';
import { Charms, PEG_CAP_RUN, choiceOffer, charmDef, rollPawnWindow } from './charms/engine';
import { playableMode, rulesFor, type ModeRules } from './modes';
import { createTycoon, type Tycoon } from './tycoon';
import { createBuffSystem, type BuffSystem } from './buffs';
import { createItemSystem, type ItemSystem } from './items';
import type { EventBannerShow } from './buffs/banner';
import type { IdleReport, TycoonState } from '@/game/types';

/**
 * Win-tier juice event (DECISIONS §F): emitted by `win()` for every paid play above the stake, after settle. `credited`
 * is what the wallet got; `capped` means the House Limit (5 × quota) clipped it and `excess` went to the jackpot pool.
 * `factor` is the effective payout factor and `dampened` means the even-money rule halved the bonuses.
 */
export interface RunWinTierEvent {
  pid: PlayerId; mid: InstanceId; machineId: MachineId; tier: WinTier;
  bet: number; gross: number; credited: number; factor: number; dampened: boolean; capped: boolean; excess: number;
}
declare module '@/core/events' {
  interface GameEvents {
    'run:wintier': RunWinTierEvent;
  }
}

/** Seconds of sim time an overpay choice waits for the player before the first candidate is taken automatically. */
const OVERPAY_TIMEOUT_SEC = 30;
/** Hot-path saves (every win) are coalesced: at most one serialise per this many sim seconds. */
const SAVE_SOON_SEC = 2;

/** A pending overpay choice (GDD §2.6.5): take one of `candidates`, or it auto-picks when `left` reaches 0. */
export interface OverpayOffer { rarity: CharmDef['rarity']; candidates: CharmDef[]; left: number }
/** Queue entry: `ids` are the candidate charm ids, frozen when the offer was rolled (so a save restores the same choice). */
interface PendingOverpay { rarity: CharmDef['rarity']; ids: string[]; left: number }

/** Bell strike length (GDD §2.3). */
const BELL_SEC = 2;
/** Settle length (GDD §2.3). */
const SETTLE_SEC = 3;
/** Dawn Collection length (GDD §2.7). */
const COLLECTION_SEC = 12;
/** Overtime Watch from the Rope Ladder (GDD §4.2 #89). */
const OVERTIME_PULLS = 5;
const OVERTIME_SEC = 90;
/** Buy-a-pull: 3 Tickets for +1 pull, at most +2 per Watch (GDD §3.1). */
const PULL_PRICE_TICKETS = 3;
const PULLS_BOUGHT_MAX = 2;
/** Machine id used for run-level modifier queries (no machine). */
const RUN_MACHINE = 'run';

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────
/** Run-private state that the shared `RunSnapshot` shape does not carry. Stored under `resume.ext` (JSON-safe). */
export interface RunExt {
  v: 1;
  index: number; watch: number; watches: number; overtimeIdx: number;
  phase: ShiftPhase; phaseLeft: number; nightDone: boolean; topside: boolean; metFired: boolean; ropeUsed: boolean;
  clock: ClockSnapshot; clockLen: number; lastCallSec: number;
  pulls: number; pullsMax: number; watchPulls: number; boughtThisWatch: number;
  tickets: number; debtPaid: number; dreadPts: number;
  freeRerolls: number; pawnRerolls: number; skipRest: number;
  discount: number; nextDiscount: number; elapsed: number; maxWallet: number; biggest: number; rounds: number;
  rng: [number, number, number, number];
  /** Pending overpay choices (optional: older v1 saves have none). */
  overpays?: PendingOverpay[];
  /** Tycoon layer state (owned machines, levels, staff). Optional: older saves have none. */
  tycoon?: Partial<TycoonState>;
  /** Host ms wall clock at save time; resume credits the time away to the tycoon (idle income). */
  savedAt?: number;
}
export interface RunSave extends RunSnapshot { ext: RunExt }

function isRunSave(s: RunSnapshot): s is RunSave {
  const e = (s as { ext?: unknown }).ext;
  return typeof e === 'object' && e !== null && (e as { v?: unknown }).v === 1;
}

// ── public surface ───────────────────────────────────────────────────────────────────────────────────
export interface RunOpts {
  seed: number;
  /** Default 'debt'. 'free' = Free Casino sandbox. 'coop' / 'versus' are refused until M3. */
  mode?: GameMode;
  cfg?: Partial<RunConfig>;
  /** When set, every resolved action is written to `save.data.resume` (the store debounces the disk write). */
  save?: SaveStore;
  /** Event banners (night events) for the HUD. Optional: without it events still run, silently. */
  banner?: EventBannerShow;
}

/** What the world exposes to the run (machines and slot positions). Attached once the pit exists. */
export interface RunWorldLink {
  machines(): ReadonlyArray<{ instance: InstanceId; machineId: MachineId; size?: SlotSize }>;
  instancePos(mid: InstanceId): V3 | undefined;
}

/** One Pawn Window slot: the charm and its SI price. */
export interface PawnOffer { def: CharmDef; price: number }

/** Run control surface on top of `RunApi` (HUD, intermission UI, frame loop). */
export interface DebtRun extends RunApi {
  /** Advance the run by `dt` sim seconds. Call from the fixed step. */
  tick(dt: number): void;
  /** Write any coalesced save now. Call on page hide / unload (`tick` also flushes within SAVE_SOON_SEC). */
  flush(): void;
  /** Overpay choice at the head of the queue (null when none). The UI shows `candidates` and calls `pickOverpay`. */
  overpayOffer(): OverpayOffer | null;
  /** Take one candidate of the head offer. False when there is no such offer, or the charm has no free peg. */
  pickOverpay(charmId: string): boolean;
  /** Take the first candidate that fits and drop the offer (the timeout fallback; also used by `tick`). */
  autoPickOverpay(): boolean;
  /** Intermission → Bell (the BELL ROPE). */
  startWatch(): boolean;
  /** Night intermission → next Night (OPEN THE FLOOR). Refused while the Topside choice is open. */
  openFloor(): boolean;
  /** Pay the rest of the Night now (SETTLE lever). Needs `deposit ≥ quota`. */
  settleEarly(): boolean;
  /** Buy +1 pull for 3 Tickets (max +2 per Watch). */
  buyPull(): boolean;
  /** Pawn Window: current offers at SI prices (empty outside intermissions). */
  pawnOffers(): PawnOffer[];
  /** Pawn Window: 1 Ticket, then +1 per further reroll in the same intermission (free rerolls first). */
  rerollPawn(): boolean;
  /** Sell a charm for 50 % (70 % with Pawn Ticket). Cursed charms cannot be sold. */
  sellCharm(id: string): boolean;
  /** Topside: STAY UP ends the run as a win. */
  stayUp(): boolean;
  /** Topside: GO BACK DOWN continues into Overdrawn. */
  goBackDown(): boolean;
  /** Abandon the run. */
  quit(): boolean;
  /** Connect the pit (owned machines, slot positions for totems). Null detaches. */
  attachWorld(link: RunWorldLink | null): void;
  /** Idle income credited on resume, read once (null when none). */
  takeIdleReport(): IdleReport | null;
  /** Unhook the buff and totem systems. Call when the session ends. */
  dispose(): void;
  readonly over: boolean;
  readonly topsideOpen: boolean;
  readonly rules: ModeRules;
}

/** A fresh run. */
export function createRun(opts: RunOpts): DebtRun {
  return new Run(opts, null);
}

/** Continue the saved run, if the save holds a resumable run; otherwise null. The Watch clock resumes frozen. */
export function resumeRun(save: SaveStore, extra: { banner?: EventBannerShow } = {}): DebtRun | null {
  const snap = save.data.resume;
  if (!snap || !isRunSave(snap)) return null;
  return new Run({ seed: snap.seed, mode: snap.mode, cfg: snap.cfg, save, banner: extra.banner }, snap);
}

// ── inert sub-APIs (owned by other packages; warns once when touched) ─────────────────────────────────
function inert<T extends object>(name: string, impl: Partial<T>): T {
  return new Proxy(impl, {
    get(target, prop, recv) {
      if (prop in target) return Reflect.get(target, prop, recv);
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      return (): undefined => {
        log.warnOnce(`run:${name}.${String(prop)}`, 'run', `${name}.${String(prop)}() is not implemented yet`);
        return undefined;
      };
    },
  }) as T;
}

const noop: Unsub = () => {};

// ── modifier pipeline (the reference fold from modifiers.types) ─────────────────────────────────────
class Mods implements ModifierApi {
  revision = 0;
  private readonly providers = new Set<ModProvider>();
  constructor(private readonly run: () => Run) {}

  register(p: ModProvider): () => void {
    this.providers.add(p);
    this.touch();
    return () => { this.providers.delete(p); this.touch(); };
  }
  touch(): void { this.revision++; }

  private sources(q: ModQuery): ModSource[] {
    const out: ModSource[] = [];
    for (const p of this.providers) p.collect(q, out);
    return out;
  }
  private matching(hook: ModHook, machineId: MachineId, q: ModQuery, sources: ModSource[]): Array<{ src: ModSource; eff: ModEffect; value: number }> {
    const r = this.run();
    const def = registry.get(machineId)?.def;
    const m = {
      machineId, category: def?.category, tags: def?.tags, zone: def?.zone, instance: q.instance,
      mode: r.mode, pid: q.pid ?? r.selfId, pos: q.pos,
    };
    const out: Array<{ src: ModSource; eff: ModEffect; value: number }> = [];
    for (const src of sources) {
      for (const eff of src.effects) {
        if (eff.hook === hook && scopeMatches(eff.scope, m)) out.push({ src, eff, value: stackedValue(eff, src.stacks ?? 1) });
      }
    }
    return out;
  }
  private modify(hook: ModHook, machineId: MachineId, v: number, q: ModQuery, sources: ModSource[]): number {
    let out = v;
    for (const s of sources) if (s.modify) out = s.modify(hook, machineId, out, q);
    return out;
  }

  mod(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): number {
    const sources = this.sources(q);
    const effs = this.matching(hook, machineId, q, sources).map((m) => ({ op: m.eff.op, value: m.value, priority: m.eff.priority }));
    return this.modify(hook, machineId, foldEffects(hook, base, effs), q, sources);
  }

  explain(hook: ModHook, machineId: MachineId, base: number, q: ModQuery = {}): ModBreakdown {
    const sources = this.sources(q);
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

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────
class Run implements DebtRun {
  readonly mode: GameMode;
  readonly seed: number;
  readonly selfId: PlayerId = 1;
  readonly config: Readonly<RunConfig>;
  readonly rules: ModeRules;
  readonly mods: ModifierApi;
  readonly charmBox: Charms;
  readonly shift: ShiftApi;
  readonly tycoon: TycoonApi;
  readonly buffs: BuffsApi;
  readonly totems: TotemsApi;
  readonly collateral: CollateralApi;
  readonly nightEvents: NightEventsApi;
  readonly contracts: ContractsApi;
  readonly jackpots: JackpotsApi;

  private readonly rng: Rng;
  private readonly save: SaveStore | null;
  private readonly modsImpl: Mods;
  private readonly tycoonSys: Tycoon;
  private readonly buffSys: BuffSystem;
  private readonly itemSys: ItemSystem;
  private worldLink: RunWorldLink | null = null;
  private readonly pools = new Map<string, JackpotPool>();
  private readonly poolListeners = new Set<(p: JackpotPool) => void>();
  private readonly counters = new Map<string, number>();
  private readonly currencies = new Map<string, number>();
  private readonly ruleDefs = new Map<string, ShiftRuleDef>();
  private readonly openRounds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly activeRules: ActiveRule[] = [];

  // shift and quota
  private index = 0;
  private watch = 0;
  private watches = 3;
  private overtimeIdx = -1;
  private phase: ShiftPhase = 'intermission';
  private phaseLeft = 0;
  private nightDone = false;
  private topside = false;
  private metFired = false;
  private skipRest = 0;
  private discount = 0;
  private nextDiscount = 0;
  private readonly clock = new WatchClock();
  private clockLen = 0;
  private lastCallSec = 0;
  private shiftState: ShiftState;
  private quota: QuotaState;

  // money, pulls, debt
  private coins = START.pocket;
  private tickets = START.tickets;
  private debtPaid = 0;
  private pullCount = 0;
  private pullsMax = 0;
  private watchPulls = 0;
  private boughtThisWatch = 0;
  private pawnRerolls = 0;
  private freeRerolls = 0;
  private ropeUsed = false;
  private dreadPts = 0;

  // status
  private living = true;
  private ended = false;
  private refusal: RefusalReason | null = null;
  private elapsed = 0;
  private clockAcc = 0;
  private stats: Record<string, number> = { rounds: 0, wagered: 0, paid: 0, biggest: 0, wins: 0, nightsPaid: 0, interest: 0 };
  private maxWallet = START.pocket;
  private biggest = 0;
  private rounds = 0;
  private dirty = false;
  private sinceFlush = 0;
  private overpays: PendingOverpay[] = [];

  constructor(opts: RunOpts, resume: RunSave | null) {
    this.mode = playableMode(opts.mode);
    this.seed = opts.seed;
    this.rules = rulesFor(this.mode);
    this.save = opts.save ?? null;
    this.rng = createRng(opts.seed);
    this.config = {
      startWallet: this.rules.startWallet, deadlines: BASE_RUN_NIGHTS, difficulty: 'normal', friendlyGive: false,
      realtimeShift: this.rules.timed, shiftSeconds: nightDef(0).clock, sharedBank: false, stake: 0, modifiers: [],
      daily: false, randomLineup: false, collateral: false, botFill: false, ...opts.cfg,
    };

    const nd = nightDef(0);
    this.shiftState = {
      index: 0, floor: 1, phase: 'intermission', startedAt: 0, endsAt: 0, duration: nd.clock, lastCallSec: lastCallSeconds(false),
      segment: { index: 0, count: nd.watches }, stake: nd.si, clock: 0, rules: this.activeRules,
      quota: { due: 0, base: 0, assessment: 0, deposited: 0, perPlayer: {}, met: false, overshoot: 0, ratio: 0, claimed: [] },
    };
    this.quota = this.shiftState.quota;
    this.watches = nd.watches;
    this.pullsMax = this.rules.unlimitedPulls ? Number.POSITIVE_INFINITY : 0;
    this.pullCount = this.pullsMax;

    this.modsImpl = new Mods(() => this);
    this.mods = this.modsImpl;
    this.charmBox = new Charms({ selfId: this.selfId, run: () => this, rng: this.rng, touch: () => this.modsImpl.touch() });
    this.modsImpl.register(this.charmBox);
    this.modsImpl.register({
      kind: 'house',
      collect: (_q, out) => {
        if (!this.rules.quota || !this.inWatch()) return;
        const effs: ModEffect[] = [];
        const favour = nightDef(this.index).favour;
        if (favour !== 1) effs.push({ hook: 'payout.mult', op: 'mult', value: favour });
        if (isWitchingWatch(this.watches, this.watch)) {
          effs.push({ hook: 'payout.mult', op: 'inc', value: 0.05 });
          effs.push({ hook: 'dread.add', op: 'add', value: 10 });
        }
        if (effs.length) out.push({ kind: 'house', id: `night:${this.index + 1}`, owner: 0, effects: effs });
      },
    });

    this.pools.set('net', { id: 'net', value: START.jackpotSeed, seed: START.jackpotSeed, feed: NETWORK_FEED, drip: 0, scope: 'network', lastWin: null });

    this.shift = this.makeShiftApi();
    // tycoon, buffs, night events and totems (BRIEF addenda 1–3, 8). Each registers its providers on `mods`.
    this.tycoonSys = createTycoon({
      run: () => this,
      seed: opts.seed,
      isHost: () => true,
      machines: () => this.worldLink?.machines() ?? [],
      tradeOpen: () => this.tradeOpen(),
      quotaDue: () => this.quota.due,
      shiftIndex: () => this.index,
      deposited: () => this.debtPaid,
      save: opts.save,
      onDescend: () => { this.endRun('escaped', 'descend'); },
      now: () => Math.round(this.elapsed * 1000),
    });
    this.modsImpl.register(this.tycoonSys.provider);
    this.tycoon = this.tycoonSys;
    this.tycoonSys.onChange(() => { this.persistSoon(); this.notify(); });

    this.buffSys = createBuffSystem({
      selfId: this.selfId,
      isHost: true,
      rng: createRng(hashSeed('buffs', opts.seed)),
      run: () => this,
      now: () => Math.round(this.elapsed * 1000),
      touch: () => this.modsImpl.touch(),
      players: () => [this.selfId],
    }, this.modsImpl, { banner: opts.banner });
    this.buffs = this.buffSys.buffs;
    this.nightEvents = this.buffSys.nightEvents;

    this.itemSys = createItemSystem({
      selfId: this.selfId,
      isHost: true,
      rng: createRng(hashSeed('totems', opts.seed)),
      run: () => this,
      now: () => Math.round(this.elapsed * 1000),
      touch: () => this.modsImpl.touch(),
      allied: (a, b) => a === b,
      instancePos: (mid) => this.worldLink?.instancePos(mid),
    }, this.modsImpl);
    this.totems = this.itemSys.totems;

    this.collateral = inert<CollateralApi>('collateral', {});
    this.contracts = inert<ContractsApi>('contracts', { board: () => [], active: () => [] });
    this.jackpots = this.makeJackpotsApi();

    if (resume) {
      this.restore(resume);
    } else {
      this.recomputeQuota();
      this.enter(this.rules.timed ? 'intermission' : 'play', 0);
    }
  }

  // ── identity and time words ───────────────────────────────────────────────────────────────────────
  get over(): boolean { return this.ended; }
  get topsideOpen(): boolean { return this.topside; }
  private get quotaMode(): boolean { return this.rules.quota; }

  night(): number { return this.index + 1; }
  window(): RunWindow { return this.phase === 'collection' ? 'dawn' : 'watch'; }
  private inWatch(): boolean {
    return this.phase === 'bell' || this.phase === 'play' || this.phase === 'lastCall' || this.phase === 'closing' || this.phase === 'settle';
  }
  private canPlay(): boolean { return this.phase === 'play' || this.phase === 'lastCall'; }
  private isLastWatch(): boolean { return this.watch === this.watches - 1; }

  // ── wallet, pulls, bets ───────────────────────────────────────────────────────────────────────────
  wallet(_pid?: PlayerId): number { return this.coins; }
  canAfford(cost: number, _pid?: PlayerId): boolean { return this.coins >= cost; }
  pulls(_pid?: PlayerId): number { return this.pullCount; }
  lastRefusal(): RefusalReason | null { return this.refusal; }

  betLimits(machineId: MachineId, instanceId: InstanceId): BetLimits {
    const def = registry.get(machineId)?.def;
    if (!def) return { min: 0, max: Number.POSITIVE_INFINITY, ladder: [] };
    const si = this.quotaMode ? nightDef(this.index).si : 1;
    const capMult = this.mod('bet.maxMult', machineId, 1, { instance: instanceId });
    const ceiling = def.maxBet * si * capMult;
    const ladder = (def.betSteps ?? bettingLadder(def.minBet, ceiling)).filter((v) => v >= def.minBet && v <= ceiling);
    const max = snapDown(ceiling, ladder) || def.minBet;
    return { min: def.minBet, max, ladder };
  }

  payoutFactor(machineId: MachineId, instanceId: InstanceId): number {
    const br = this.mods.explain('payout.mult', machineId, 1, { pid: this.selfId, instance: instanceId });
    return Math.min(PAYOUT_GUARD, br.result);
  }

  bet(amount: number, src: EcoSource, o?: BetOpts): boolean {
    if (!this.canPlay()) return this.refuse('phase');
    const q: ModQuery = { pid: this.selfId, instance: src.mid };
    const lim = this.betLimits(src.machineId, src.mid);
    if (amount < lim.min || amount > lim.max) return this.refuse('limit');
    const cost = Math.ceil(amount * this.mod('bet.costMult', src.machineId, 1, q));
    const base = o?.pulls ?? registry.get(src.machineId)?.def.actionCost ?? 1;
    const pullCost = Math.max(0, Math.round(this.mod('x.actionCostDelta', src.machineId, base, q)));
    if (!this.rules.unlimitedPulls && this.pullCount < pullCost) return this.refuse('pulls');
    if (cost > this.coins) return this.refuse('funds');
    this.refusal = null;

    if (!this.rules.unlimitedPulls) this.pullCount -= pullCost;
    this.watchPulls += pullCost;
    this.coins -= cost;
    this.stats.wagered = (this.stats.wagered ?? 0) + cost;
    if (this.quotaMode) this.feedJackpot('net', Math.floor(amount * NETWORK_FEED));
    if (!this.openRounds.has(src.mid)) {
      this.openRounds.add(src.mid);
      this.rounds++;
      this.stats.rounds = this.rounds;
      this.emit('machine:round', { mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: amount });
    }
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -cost, reason: `bet:${src.machineId}` });
    if (!this.rules.unlimitedPulls) {
      this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
      if (pullCost > 0 && this.pullCount <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
    }
    this.notify();
    return true;
  }

  win(gross: number, src: EcoSource, meta: WinMeta): number {
    this.openRounds.delete(src.mid);
    const q: ModQuery = { pid: this.selfId, instance: src.mid };
    let credited: number;
    let pr: PayoutResult | null = null;
    if (meta.raw) {
      credited = Math.max(0, Math.floor(gross));
    } else if (gross <= 0) {
      credited = Math.floor(meta.bet * this.mod('loss.refund', src.machineId, 0, q));
    } else {
      // Split the fold into A (additive bonuses, halved by the dampener) and M (the rest). `factorApplied` = the machine
      // already scaled the gross (elevator), so no factor and no flat are applied again.
      let A = 0;
      let M = 1;
      if (!meta.factorApplied) {
        const br = this.mods.explain('payout.mult', src.machineId, 1, q);
        for (const s of br.steps) if (s.op === 'inc') A += s.value;
        M = br.result / (1 + A);
      }
      const flat = meta.factorApplied ? 0 : this.mod('payout.flat', src.machineId, 0, q);
      const r = settlePayout({ gross, bet: meta.bet, A, M, flat, quota: this.quotaMode ? this.quota.due : 0 });
      pr = r;
      credited = r.credited;
      if (r.excess > 0) this.feedJackpot('net', r.excess);
    }
    this.coins += credited;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.stats.paid = (this.stats.paid ?? 0) + credited;
    this.biggest = Math.max(this.biggest, credited);
    this.stats.biggest = this.biggest;
    if (credited > meta.bet) this.stats.wins = (this.stats.wins ?? 0) + 1;
    this.emit('machine:result', {
      mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: meta.bet, gross, credited, tier: meta.tier, tags: meta.tags ?? [],
    });
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: credited, reason: `win:${src.machineId}` });
    if (pr && gross > meta.bet && !meta.silent) {
      this.emit('run:wintier', {
        pid: this.selfId, mid: src.mid, machineId: src.machineId, tier: meta.tier, bet: meta.bet, gross, credited,
        factor: pr.factor, dampened: pr.dampened, capped: pr.capped, excess: pr.excess,
      });
    }
    this.notify();
    this.persistSoon();
    return credited;
  }

  deposit(amount: number): boolean {
    if (!this.quotaMode || this.ended || this.phase === 'collection') return false;
    const amt = Math.min(Math.floor(amount), this.coins);
    if (amt <= 0) return false;
    this.coins -= amt;
    const credit = Math.floor(amt * (1 + this.mod('deposit.bonus', RUN_MACHINE, 0)));
    this.debtPaid += credit;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -amt, reason: 'deposit' });
    this.syncQuota();
    this.emit('run:deposit', { pid: this.selfId, amount: credit, paid: this.debtPaid, due: this.quota.due });
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.persist();
    return true;
  }

  give(_to: PlayerId, _amount: number): boolean { return false; }

  buyCharm(charmId: string, price: number): boolean {
    if (this.ended) return false;
    if (this.quotaMode && this.phase !== 'intermission') return this.refuse('phase');
    if (!charmDef(charmId)) return false;
    if (price > 0 && this.coins < price) return this.refuse('funds');
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return this.refuse('limit');
    this.refusal = null;
    this.coins -= price;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -price, reason: `charm:${charmId}` });
    this.notify();
    this.persist();
    return true;
  }

  sellCharm(id: string): boolean {
    const def = charmDef(id);
    if (!def || def.rarity === 'cursed') return false;
    if (this.quotaMode && this.phase !== 'intermission') return false;
    const pawnTicket = this.charmBox.has(this.selfId, 'pawn_ticket');
    if (!this.charmBox.remove(this.selfId, id)) return false;
    const got = Math.floor(charmPrice(def, this.shiftState.stake) * (pawnTicket ? 0.7 : 0.5));
    this.coins += got;
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: got, reason: `sell:${id}` });
    this.notify();
    this.persist();
    return true;
  }

  hostBet(pid: PlayerId, amount: number, src: EcoSource): boolean { return pid === this.selfId && this.bet(amount, src); }
  hostWin(pid: PlayerId, gross: number, src: EcoSource, meta: WinMeta): number { return pid === this.selfId ? this.win(gross, src, meta) : 0; }

  // ── modifiers ─────────────────────────────────────────────────────────────────────────────────────
  getModifier(hook: ModHook, machineId: MachineId, base: number, pid?: PlayerId): number { return this.mods.mod(hook, machineId, base, { pid }); }
  mod(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): number { return this.mods.mod(hook, machineId, base, q); }
  explain(hook: ModHook, machineId: MachineId, base: number, q?: ModQuery): ModBreakdown { return this.mods.explain(hook, machineId, base, q); }
  luck(machineId: MachineId, pid?: PlayerId): number { return this.mods.mod('luck', machineId, 0, { pid }); }
  charms(pid?: PlayerId): readonly CharmState[] { return this.charmBox.list(pid ?? this.selfId); }

  // ── pools and info ──────────────────────────────────────────────────────────────────────────────────
  jackpot(pool: string): number { return this.pools.get(pool)?.value ?? 0; }
  jackpotAdd(pool: string, amount: number): void { this.feedJackpot(pool, amount); }
  jackpotClaim(pool: string, src: EcoSource): number { return this.claimJackpot(pool, src); }

  debt(_pid?: PlayerId): DebtState {
    return { index: this.index, due: this.quota.due, paid: this.debtPaid, deadlineAt: 0, floor: this.index + 1, total: BASE_RUN_NIGHTS };
  }
  timeLeft(): number { return this.canPlay() || this.phase === 'closing' ? this.clock.remaining : 0; }
  isLocked(_machineId: MachineId): boolean { return false; }
  alive(_pid?: PlayerId): boolean { return this.living; }
  stat(key: string, add = 0): number {
    const v = (this.counters.get(key) ?? 0) + add;
    if (add) this.counters.set(key, v);
    return v;
  }
  phone(): PhoneCallState | null { return null; }
  answerPhone(_choice: number): void {}

  balance(cur: CurrencyId, _pid?: PlayerId): number {
    if (cur === 'coin') return this.coins;
    if (cur === 'ticket') return this.tickets;
    return this.currencies.get(cur) ?? 0;
  }
  earn(cur: CurrencyId, amount: number, _reason: string, _pid?: PlayerId): void {
    if (amount <= 0) return;
    if (cur === 'coin') {
      this.coins += Math.floor(amount);
      this.maxWallet = Math.max(this.maxWallet, this.coins);
      this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: Math.floor(amount), reason: _reason });
    } else if (cur === 'ticket') {
      this.tickets = Math.min(TICKET_CAP, this.tickets + Math.floor(amount));
    } else {
      this.currencies.set(cur, (this.currencies.get(cur) ?? 0) + amount);
    }
    this.notify();
  }
  spend(cur: CurrencyId, amount: number, reason: string, pid?: PlayerId): boolean {
    if (this.balance(cur, pid) < amount) return false;
    if (cur === 'coin') this.coins -= amount;
    else if (cur === 'ticket') this.tickets -= amount;
    else this.currencies.set(cur, this.balance(cur, pid) - amount);
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -amount, reason });
    this.notify();
    return true;
  }
  dread(): number {
    const add = this.mod('dread.add', RUN_MACHINE, 0);
    return Math.min(1, Math.max(0, (this.dreadPts + add) / 100));
  }
  addDread(delta: number, _reason?: string): void {
    this.dreadPts = Math.min(100, Math.max(0, this.dreadPts + delta));
    this.emit('dread:change', { value: this.dread() });
  }
  playCutscene(_id: string, _o?: CutscenePlayOpts): Promise<CutsceneResult> {
    log.warnOnce('run:playCutscene', 'run', 'playCutscene belongs to the cutscene player; resolving as aborted');
    return Promise.resolve('aborted');
  }

  // ── DebtRun controls ──────────────────────────────────────────────────────────────────────────────
  tick(dt: number): void {
    if (this.ended || dt <= 0) return;
    this.elapsed += dt;
    this.clockAcc += dt;
    if (this.dirty) {
      this.sinceFlush += dt;
      if (this.sinceFlush >= SAVE_SOON_SEC) this.persist();
    }
    const head = this.overpays[0];
    if (head) {
      head.left -= dt;
      if (head.left <= 0) this.autoPickOverpay();
    }
    if (this.clockAcc >= 1) {
      this.clockAcc -= 1;
      this.emit('run:clock', { remaining: this.clock.remaining });
    }
    this.buffSys.tick(dt);
    this.itemSys.tick(dt);
    if (this.phase === 'play' || this.phase === 'lastCall') this.tycoonSys.tick(dt);
    if (!this.rules.timed) return;
    switch (this.phase) {
      case 'bell':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.startPlay();
        break;
      case 'play':
      case 'lastCall':
        this.clock.tick(dt);
        if (this.clock.remaining <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
        else if (this.phase === 'play' && this.clock.remaining <= this.lastCallSec) this.enter('lastCall', 0);
        break;
      case 'closing':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.settleWatch();
        break;
      case 'settle':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.afterSettle();
        break;
      case 'collection':
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.dawn();
        break;
      default:
        break;
    }
  }

  startWatch(): boolean {
    if (this.ended || !this.quotaMode || this.phase !== 'intermission' || this.nightDone || this.topside) return false;
    const nd = nightDef(this.index);
    const isOvertime = this.watch === this.overtimeIdx;
    this.pawnRerolls = 0;
    this.boughtThisWatch = 0;
    this.clockLen = isOvertime ? OVERTIME_SEC : Math.max(10, Math.round(this.mod('x.run.clockAdd', RUN_MACHINE, nd.clock)));
    this.lastCallSec = lastCallSeconds(this.isLastWatch());
    this.pullsMax = isOvertime ? OVERTIME_PULLS : Math.max(1, Math.round(this.mod('x.run.pullsAdd', RUN_MACHINE, nd.pulls)));
    this.pullCount = this.pullsMax;
    this.watchPulls = 0;
    this.shiftState.duration = this.clockLen;
    this.shiftState.lastCallSec = this.lastCallSec;
    this.shiftState.segment = { index: this.watch, count: this.watches };
    this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
    this.emit('run:deadline', { index: this.index, due: this.quota.due, seconds: this.clockLen });
    this.enter('bell', BELL_SEC);
    this.buffSys.onBell();
    this.persist();
    return true;
  }

  openFloor(): boolean {
    if (this.ended || !this.quotaMode || this.phase !== 'intermission' || !this.nightDone || this.topside) return false;
    // Ascent: the pit rises one floor. The Elevator Token pays 5 % of the pocket (max 300 × SI).
    if (this.charmBox.has(this.selfId, 'elevator_token')) {
      const gain = Math.min(Math.floor(this.coins * 0.05), 300 * nightDef(this.index).si);
      if (gain > 0) this.earn('coin', gain, 'charm:elevator_token');
    }
    this.index += 1;
    const nd = nightDef(this.index);
    this.watches = nd.watches;
    this.watch = 0;
    this.overtimeIdx = -1;
    this.nightDone = false;
    this.metFired = false;
    this.skipRest = 0;
    this.discount = this.nextDiscount;
    this.nextDiscount = 0;
    this.quota.claimed = [];
    this.pawnRerolls = 0;
    this.shiftState.index = this.index;
    this.shiftState.floor = this.index + 1;
    this.shiftState.stake = nd.si;
    this.shiftState.segment = { index: 0, count: nd.watches };
    this.recomputeQuota();
    this.enter('intermission', 0);
    this.persist();
    return true;
  }

  settleEarly(): boolean {
    if (this.ended || !this.quotaMode || !this.canPlay()) return false;
    if (this.debtPaid < this.quota.due) return false;
    const skip = Math.max(0, this.watches - this.watch - 1);
    if (skip > 0) {
      this.tickets = Math.min(TICKET_CAP, this.tickets + 4 * skip);
      this.freeRerolls += skip;
    }
    this.skipRest = skip;
    this.settleWatch();
    return true;
  }

  buyPull(): boolean {
    if (this.ended || this.rules.unlimitedPulls || !this.canPlay()) return false;
    if (this.boughtThisWatch >= PULLS_BOUGHT_MAX) return false;
    if (this.tickets < PULL_PRICE_TICKETS) return this.refuse('funds');
    this.tickets -= PULL_PRICE_TICKETS;
    this.boughtThisWatch += 1;
    this.pullCount += 1;
    this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
    this.notify();
    this.persist();
    return true;
  }

  pawnOffers(): PawnOffer[] {
    if (this.phase !== 'intermission' || this.ended) return [];
    const rng = this.rng.fork(`pawn:${this.index}:${this.watch}:${this.pawnRerolls}`);
    const defs = rollPawnWindow(rng, this.index, (id) => this.charmBox.has(this.selfId, id), { launchOnly: true });
    const si = nightDef(this.index).si;
    return defs.map((def) => ({ def, price: charmPrice(def, si) }));
  }

  rerollPawn(): boolean {
    if (this.phase !== 'intermission' || this.ended) return false;
    if (this.freeRerolls > 0) {
      this.freeRerolls -= 1;
      this.pawnRerolls += 1;
      this.notify();
      this.persist();
      return true;
    }
    const cost = 1 + this.pawnRerolls;
    if (this.tickets < cost) return this.refuse('funds');
    this.tickets -= cost;
    this.pawnRerolls += 1;
    this.notify();
    this.persist();
    return true;
  }

  stayUp(): boolean {
    if (!this.topside || this.ended) return false;
    this.endRun('escaped', 'elevator');
    return true;
  }
  goBackDown(): boolean {
    if (!this.topside || this.ended) return false;
    this.topside = false;
    this.persist();
    return true;
  }
  quit(): boolean {
    if (this.ended) return false;
    this.endRun('quit');
    return true;
  }

  attachWorld(link: RunWorldLink | null): void { this.worldLink = link; }
  takeIdleReport(): IdleReport | null { return this.tycoonSys.takeIdleReport(); }
  dispose(): void { this.buffSys.dispose(); this.itemSys.dispose(); }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ── phases ─────────────────────────────────────────────────────────────────────────────────────────
  private enter(phase: ShiftPhase, left: number): void {
    const before = this.window();
    this.phase = phase;
    this.phaseLeft = left;
    this.shiftState.phase = phase;
    this.shiftState.clock = this.clock.progress;
    this.emit('shift:phase', { phase, index: this.index });
    const after = this.window();
    if (before !== after) this.emit('run:window', { window: after, night: this.night() });
    this.notify();
  }

  private startPlay(): void {
    this.clock.start(this.clockLen);
    this.shiftState.startedAt = this.elapsed;
    this.shiftState.endsAt = this.elapsed + this.clockLen;
    this.enter('play', 0);
  }

  private settleWatch(): void {
    this.clock.stop();
    const nd = nightDef(this.index);
    const lastWatch = this.isLastWatch();
    const overtime = this.watch === this.overtimeIdx;
    const pid = this.selfId;
    this.enter('settle', SETTLE_SEC);
    if (this.quotaMode) {
      const rate = interestRate(nd.interest, this.mod('x.econ.interestAdd', RUN_MACHINE, 0));
      const active = !overtime && this.watchPulls >= ACTIVITY_MIN_PULLS;
      if (active && rate > 0) {
        let interest = interestFor(this.debtPaid, this.quota.due, rate);
        if (lastWatch && this.charmBox.has(pid, 'seven_floor_key')) interest += interestFor(this.debtPaid + interest, this.quota.due, rate);
        if (interest > 0) {
          this.debtPaid += interest;
          this.stats.interest = (this.stats.interest ?? 0) + interest;
          this.emit('run:deposit', { pid, amount: interest, paid: this.debtPaid, due: this.quota.due });
        }
      }
      if (active && rate > 0 && this.charmBox.has(pid, 'perpetual_ledger')) {
        const pocket = Math.floor(this.coins * rate * 0.5);
        if (pocket > 0) this.earn('coin', pocket, 'charm:perpetual_ledger');
      }
    }
    if (!this.rules.unlimitedPulls && this.pullCount > 0) {
      this.earn('ticket', this.pullCount, 'settle:unused-pulls');
      this.pullCount = 0;
      this.emit('pulls:change', { pid, pulls: 0 });
    }
    this.syncQuota();
    this.checkMet();
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  private afterSettle(): void {
    if (this.skipRest === 0 && this.watch + 1 < this.watches) {
      this.watch += 1;
      this.enter('intermission', 0);
    } else {
      this.skipRest = 0;
      this.tycoonSys.onDawn();
      this.enter('collection', COLLECTION_SEC);
    }
    this.persist();
  }

  /** Dawn Collection: the quota is settled. Paid → overpay rewards, the surplus opens the next Night. Short → protections or the trapdoor. */
  private dawn(): void {
    const due = this.quota.due;
    let paid = this.debtPaid >= due;
    if (!paid && this.charmBox.has(this.selfId, 'false_bottom') && due - this.debtPaid <= 0.1 * due) {
      this.charmBox.remove(this.selfId, 'false_bottom');
      this.debtPaid = due;
      paid = true;
    }
    if (!paid && !this.ropeUsed && this.charmBox.has(this.selfId, 'rope_ladder')) {
      this.charmBox.remove(this.selfId, 'rope_ladder');
      this.ropeUsed = true;
      this.overtimeIdx = this.watches;
      this.watches += 1;
      this.watch = this.overtimeIdx;
      this.enter('intermission', 0);
      this.persist();
      return;
    }
    if (!paid) { this.fall(); return; }

    const ratio = due > 0 ? this.debtPaid / due : 1;
    for (const tier of OVERSHOOT_TIERS) {
      if (ratio >= tier.ratio && !this.quota.claimed.some((c) => c.id === tier.id)) {
        const claim: OvershootClaim = { id: tier.id, at: Math.round(this.elapsed * 1000) };
        this.quota.claimed.push(claim);
        this.grant(tier.reward);
        this.emit('quota:overshoot', { tier: tier.id, pid: this.selfId });
      }
    }
    this.debtPaid = Math.max(0, this.debtPaid - due);
    this.stats.nightsPaid = (this.stats.nightsPaid ?? 0) + 1;
    this.syncQuota();
    this.nightDone = true;
    if (nightDef(this.index).no === BASE_RUN_NIGHTS) this.topside = true;
    this.enter('intermission', 0);
    this.emit('quota:update', { quota: this.quota });
    this.persist();
  }

  private fall(): void {
    this.living = false;
    this.emit('quota:failed', { index: this.index });
    this.emit('player:fall', { pid: this.selfId });
    this.endRun('fell');
  }

  private endRun(result: RunSummary['result'], ending?: string): void {
    this.ended = true;
    this.clock.stop();
    this.enter('over', 0);
    const summary: RunSummary = {
      mode: this.mode, seed: this.seed, result, floor: this.index + 1, deadlines: this.index + 1, maxWallet: this.maxWallet,
      rounds: this.rounds, biggestWin: this.biggest, durationSec: Math.round(this.elapsed),
      players: [{ id: this.selfId, name: '', placement: 1, wallet: this.coins }],
      stats: { ...this.stats },
      ...(ending ? { ending } : {}),
    };
    this.emit('run:end', { summary });
    if (this.save) {
      this.save.update((d) => {
        d.resume = null;
        d.history = [...d.history, summary].slice(-20);
      });
      this.save.flush();
    }
    this.notify();
  }

  // ── quota and debt ─────────────────────────────────────────────────────────────────────────────────
  private recomputeQuota(): void {
    if (!this.quotaMode) { this.quota.due = 0; this.syncQuota(); return; }
    const nd = nightDef(this.index);
    const holdings = 0;
    const rate = this.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08);
    let due = quotaFor(this.index, { discount: this.discount, holdings, assessRate: rate });
    due = Math.round(due * this.mod('quota.mult', RUN_MACHINE, 1));
    due = Math.max(0, Math.round(due + this.mod('quota.add', RUN_MACHINE, 0)));
    if (this.index === BASE_RUN_NIGHTS - 1) due = Math.round(due * this.mod('x.quota.night8', RUN_MACHINE, 1));
    this.quota.base = nd.base;
    this.quota.assessment = assessmentFor(this.index, holdings, rate);
    this.quota.due = due;
    this.metFired = false;
    this.syncQuota();
  }

  private syncQuota(): void {
    const q = this.quota;
    q.deposited = this.debtPaid;
    q.perPlayer = { [this.selfId]: this.debtPaid };
    q.met = this.debtPaid >= q.due;
    q.overshoot = Math.max(0, this.debtPaid - q.due);
    q.ratio = q.due > 0 ? this.debtPaid / q.due : 0;
  }

  private checkMet(): void {
    if (this.metFired || !this.quotaMode || this.quota.due <= 0 || this.debtPaid < this.quota.due) return;
    this.metFired = true;
    this.emit('quota:met', { index: this.index, ratio: this.debtPaid / this.quota.due });
  }

  private grant(reward: RewardSpec): void {
    if (reward.currencies) {
      for (const [cur, n] of Object.entries(reward.currencies)) if (n > 0) this.earn(cur, n, reward.text ?? 'overshoot');
    }
    if (reward.buffs) {
      for (const b of reward.buffs) this.counters.set(`buff:${b.id}`, (this.counters.get(`buff:${b.id}`) ?? 0) + 1);
    }
    if (reward.nextQuotaDiscount) this.nextDiscount = Math.min(0.15, this.nextDiscount + reward.nextQuotaDiscount);
    if (reward.charm) {
      const offer = reward.charm;
      if ('id' in offer) {
        this.charmBox.add(this.selfId, offer.id, this.pegs());
      } else {
        // "Choose 1 of 3": roll the candidates now, queue them, and let the UI call pickOverpay (auto-pick on timeout).
        const rarity = Array.isArray(offer.rarity) ? offer.rarity[0] : offer.rarity;
        const cands = choiceOffer(this.rng.fork(`overpay:${this.index}:${this.overpays.length}:${rarity}`), rarity, offer.of, (id) => this.charmBox.has(this.selfId, id));
        if (cands.length) this.overpays.push({ rarity, ids: cands.map((d) => d.id), left: OVERPAY_TIMEOUT_SEC });
      }
    }
    this.notify();
  }

  private pegs(): number {
    return Math.min(PEG_CAP_RUN, START.pegs + Math.max(0, Math.round(this.mod('x.pegs.add', RUN_MACHINE, 0))));
  }

  /** Tycoon trade is shut during Closing, Settle, Dawn Collection and after the run (GDD §3.7.1). */
  private tradeOpen(): boolean {
    return !(this.phase === 'closing' || this.phase === 'settle' || this.phase === 'collection' || this.phase === 'over');
  }

  private refuse(reason: RefusalReason): false {
    this.refusal = reason;
    this.notify();
    return false;
  }

  private notify(): void { this.listeners.forEach((fn) => fn()); }

  /** Emit on the bus, then let owned charms react to the same event. */
  private emit<K extends keyof GameEvents>(key: K, payload: GameEvents[K]): void {
    bus.emit(key, payload);
    this.charmBox.dispatch(key, payload);
  }

  // ── shift API ──────────────────────────────────────────────────────────────────────────────────────
  private makeShiftApi(): ShiftApi {
    const run = this;
    return {
      state: () => run.shiftState,
      get phase() { return run.phase; },
      timeLeft: () => run.timeLeft(),
      quota: () => run.quota,
      quotaFor: (i: number) => quotaFor(i, { discount: run.discount, holdings: 0, assessRate: 0.08 }),
      overshootTiers: () => OVERSHOOT_TIERS,
      extend: (sec: number) => { run.clock.extend(sec); run.persist(); },
      settleEarly: () => run.settleEarly(),
      rules: () => run.activeRules,
      registerRule: (def: ShiftRuleDef): Unsub => {
        run.ruleDefs.set(def.id, def);
        return () => { run.ruleDefs.delete(def.id); };
      },
      ruleDef: (id: string) => run.ruleDefs.get(id),
    };
  }

  // ── jackpots ───────────────────────────────────────────────────────────────────────────────────────
  private makeJackpotsApi(): JackpotsApi {
    const run = this;
    return {
      list: () => [...run.pools.values()],
      get: (id: string) => run.pools.get(id),
      value: (id: string) => run.pools.get(id)?.value ?? 0,
      chance: (_machineId: MachineId, _bet: number, tier: WinTier) => (WIN_TIERS.indexOf(tier) >= WIN_TIERS.indexOf('huge') ? 0.05 : 0.002),
      add: (id: string, amount: number) => run.feedJackpot(id, amount),
      claim: (id: string, src: EcoSource) => run.claimJackpot(id, src),
      onChange: (fn: (p: JackpotPool) => void): Unsub => {
        run.poolListeners.add(fn);
        return () => { run.poolListeners.delete(fn); };
      },
    };
  }

  private feedJackpot(id: string, amount: number): void {
    const p = this.pools.get(id);
    if (!p || amount <= 0) return;
    p.value += amount;
    this.poolChanged(p);
  }

  private claimJackpot(id: string, src: EcoSource): number {
    const p = this.pools.get(id);
    if (!p) return 0;
    const paid = Math.floor(p.value * this.mod('jackpot.mult', src.machineId, 1));
    p.lastWin = { pid: this.selfId, amount: paid, at: Math.round(this.elapsed * 1000), mid: src.mid, machineId: src.machineId };
    p.value = p.seed;
    this.coins += paid;
    this.emit('jackpot:win', { pool: id, pid: this.selfId, amount: paid, mid: src.mid, machineId: src.machineId });
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: paid, reason: `jackpot:${id}` });
    this.poolChanged(p);
    this.persist();
    return paid;
  }

  private poolChanged(p: JackpotPool): void {
    this.emit('jackpot:change', { pool: p.id, value: p.value });
    this.poolListeners.forEach((fn) => fn(p));
    this.notify();
  }

  // ── save and resume ────────────────────────────────────────────────────────────────────────────────
  snapshot(): RunSave {
    const pid = this.selfId;
    const ext: RunExt = {
      v: 1, index: this.index, watch: this.watch, watches: this.watches, overtimeIdx: this.overtimeIdx,
      phase: this.phase, phaseLeft: this.phaseLeft, nightDone: this.nightDone, topside: this.topside,
      metFired: this.metFired, ropeUsed: this.ropeUsed,
      clock: this.clock.snapshot(), clockLen: this.clockLen, lastCallSec: this.lastCallSec,
      pulls: this.pullCount, pullsMax: this.pullsMax, watchPulls: this.watchPulls, boughtThisWatch: this.boughtThisWatch,
      tickets: this.tickets, debtPaid: this.debtPaid, dreadPts: this.dreadPts,
      freeRerolls: this.freeRerolls, pawnRerolls: this.pawnRerolls, skipRest: this.skipRest,
      discount: this.discount, nextDiscount: this.nextDiscount, elapsed: this.elapsed,
      maxWallet: this.maxWallet, biggest: this.biggest, rounds: this.rounds,
      rng: this.rng.getState(),
      overpays: this.overpays.map((o) => ({ rarity: o.rarity, ids: [...o.ids], left: o.left })),
      tycoon: JSON.parse(JSON.stringify(this.tycoonSys.state())) as Partial<TycoonState>,
      savedAt: Date.now(),
    };
    return {
      mode: this.mode, seed: this.seed, window: this.window(),
      debts: { [pid]: this.debt(pid) }, wallets: { [pid]: this.coins }, charms: this.charmBox.snapshot(),
      alive: { [pid]: this.living }, jackpots: { net: this.jackpot('net') },
      tier: this.index + 1, phone: null, stats: { ...this.stats },
      cfg: { ...this.config }, shift: { ...this.shiftState, rules: [...this.activeRules] },
      quota: { ...this.quota, perPlayer: { ...this.quota.perPlayer }, claimed: [...this.quota.claimed] },
      currencies: { ticket: { [pid]: this.tickets } }, dread: this.dread(),
      ext,
    };
  }

  /** Boundary save (phase, deposit, purchase, quota, jackpot …): serialises now and clears the coalescing state. */
  private persist(): void {
    this.dirty = false;
    this.sinceFlush = 0;
    if (!this.save || this.ended) return;
    const snap = this.snapshot();
    this.save.update((d) => { d.resume = snap; });
  }

  /** Hot-path save (every win): only marks the run dirty. `tick` or `flush()` writes it, at most every SAVE_SOON_SEC. */
  private persistSoon(): void {
    if (this.save && !this.ended) this.dirty = true;
  }

  flush(): void {
    if (this.dirty) this.persist();
  }

  // ── overpay choice (GDD §2.6.5) ─────────────────────────────────────────────────────────────────
  overpayOffer(): OverpayOffer | null {
    const head = this.overpays[0];
    if (!head) return null;
    const candidates = head.ids.map((id) => charmDef(id)).filter((d): d is CharmDef => d !== undefined);
    return { rarity: head.rarity, candidates, left: head.left };
  }

  pickOverpay(charmId: string): boolean {
    const head = this.overpays[0];
    if (!head || !head.ids.includes(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return this.refuse('limit');
    this.overpays.shift();
    this.notify();
    this.persist();
    return true;
  }

  autoPickOverpay(): boolean {
    const head = this.overpays.shift();
    if (!head) return false;
    let took = false;
    for (const id of head.ids) {
      if (this.charmBox.add(this.selfId, id, this.pegs())) { took = true; break; }
    }
    this.notify();
    this.persist();
    return took;
  }

  private restore(s: RunSave): void {
    const e = s.ext;
    this.index = e.index; this.watch = e.watch; this.watches = e.watches; this.overtimeIdx = e.overtimeIdx;
    this.phase = e.phase; this.phaseLeft = e.phaseLeft; this.nightDone = e.nightDone; this.topside = e.topside;
    this.metFired = e.metFired; this.ropeUsed = e.ropeUsed;
    this.clock.restore(e.clock); this.clockLen = e.clockLen; this.lastCallSec = e.lastCallSec;
    this.pullCount = this.rules.unlimitedPulls ? Number.POSITIVE_INFINITY : e.pulls;
    this.pullsMax = e.pullsMax; this.watchPulls = e.watchPulls; this.boughtThisWatch = e.boughtThisWatch;
    this.tickets = e.tickets; this.debtPaid = e.debtPaid; this.dreadPts = e.dreadPts;
    this.freeRerolls = e.freeRerolls; this.pawnRerolls = e.pawnRerolls; this.skipRest = e.skipRest;
    this.discount = e.discount; this.nextDiscount = e.nextDiscount; this.elapsed = e.elapsed;
    this.maxWallet = e.maxWallet; this.biggest = e.biggest; this.rounds = e.rounds;
    this.rng.setState(e.rng);
    this.overpays = (e.overpays ?? []).map((o) => ({ rarity: o.rarity, ids: [...o.ids], left: o.left }));
    this.coins = s.wallets[this.selfId] ?? this.rules.startWallet;
    this.charmBox.restore(this.selfId, s.charms[this.selfId] ?? []);
    this.living = s.alive[this.selfId] ?? true;
    this.stats = { ...this.stats, ...s.stats };
    this.shiftState = { ...(s.shift ?? this.shiftState), rules: this.activeRules };
    const q = s.quota ?? this.shiftState.quota;
    this.quota = { ...q, perPlayer: { ...q.perPlayer }, claimed: [...q.claimed] };
    this.shiftState.quota = this.quota;
    this.shiftState.phase = this.phase;
    const pool = this.pools.get('net');
    if (pool) pool.value = s.jackpots['net'] ?? pool.seed;
    this.syncQuota();
    if (e.tycoon) this.tycoonSys.restore(e.tycoon);
    if (typeof e.savedAt === 'number') this.tycoonSys.catchUp(Math.max(0, (Date.now() - e.savedAt) / 1000));
    this.ended = !this.living || this.phase === 'over';
  }
}
