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
  ActiveRule, BetLimits, BetOpts, BuffsApi, CharmDef, CharmState, CollateralApi, ContractDef, ContractGoal, ContractsApi, ContractState, CurrencyId,
  DebtState, EcoSource, JackpotPool, JackpotsApi, ModBreakdown, ModBreakdownStep, ModEffect, ModHook, ModProvider, ModQuery,
  ModSource, ModifierApi, NightEventsApi, OvershootClaim, QuotaState, RefusalReason, RewardSpec, RunApi, RunWindow,
  ShiftApi, ShiftPhase, ShiftRuleDef, ShiftState, TotemState, TotemsApi, TycoonApi, WinMeta, WinTier,
} from '@/game/types';
import type { MetaState } from '@/game/types';
import type { BuffSave } from './buffs/engine';
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
  ACTIVITY_MIN_PULLS, BASE_RUN_NIGHTS, LAMP_FIRST_NIGHT, NETWORK_FEED, OVERSHOOT_TIERS, START, TICKET_CAP,
  assessmentFor, closingSeconds, hotLampCount, interestFor, interestRate, isWitchingWatch, lastCallSeconds, nightDef, obolsFor, quotaFor,
  type ObolOutcome,
} from './data/schedule';
import {
  COLD_MULT, Circuit, HOT_MULT, rollLamps, tiltBulbs, tiltFactor, tiltStep,
  type CircuitSave, type CircuitView, type LampCandidate, type LampView, type TiltView,
} from './circuit';
import { PAYOUT_GUARD, bettingLadder, charmPrice, settlePayout, snapDown, type PayoutResult } from './economy';
import { Charms, PEG_CAP_RUN, allCharmDefs, choiceOffer, charmDef } from './charms/engine';
import { Pawn, type PawnSnapshot } from './shop';
import { scopeTags } from './suits';
import { paceOf, oddsLine, type OddsLine } from './pace';
import { profileOf } from './data/machineProfiles';
import { bossFor, type BossNight } from './bosses';
import { applyKit, kitById } from './data/kits';
import { BOSS_REWARD, BOSS_TEMPLATES } from './data/bosses';
import { registerStrings, t } from '@/core/i18n';
import { playableMode, rulesFor, type ModeRules } from './modes';
import { createTycoon, type Tycoon } from './tycoon';
import { createBuffSystem, type BuffSystem } from './buffs';
import { createItemSystem, type ItemSystem } from './items';
import { createHotline, type Hotline, type HotlineSave } from './hotline';
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

let bossStringsDone = false;
/** Boss names and texts to `event.<id>.name|desc|announce` (the banner and HUD read them like any Night event). Once. */
function registerBossStrings(): void {
  if (bossStringsDone) return;
  bossStringsDone = true;
  for (const b of Object.values(BOSS_TEMPLATES)) registerStrings(`event.${b.id}.`, { en: b.strings.en, tr: b.strings.tr });
}
/** Red Thread (GDD §4.2 #41): its Tilt grace is for the first instance played in a Watch only. */
const RED_THREAD_GRACE = 3;
/** Bounty board: offers per Night and slips one player may hold (GDD §11.9: three per Night). */
const BOARD_OFFERS = 3;
const CONTRACT_MAX_ACTIVE = 3;

/** The fields a contract goal reads from a run event (`machine:result`, `machine:round`, `run:deposit`, `jackpot:win`). */
interface ContractEv {
  machineId: string; tier?: WinTier; tags?: readonly string[];
  bet?: number; gross?: number; credited?: number; amount?: number;
}
/** True when an event passes a goal's `where` filter. */
function contractMatches(w: NonNullable<ContractGoal['where']>, ev: ContractEv): boolean {
  if (w.machineId !== undefined && ev.machineId !== w.machineId) return false;
  if (w.minTier !== undefined && (ev.tier === undefined || WIN_TIERS.indexOf(ev.tier) < WIN_TIERS.indexOf(w.minTier))) return false;
  if (w.tags && !w.tags.every((t) => ev.tags?.includes(t) === true)) return false;
  if (w.minBet !== undefined && (ev.bet ?? 0) < w.minBet) return false;
  if (w.minGross !== undefined && (ev.gross ?? 0) < w.minGross) return false;
  return true;
}

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────
/** Run-private state that the shared `RunSnapshot` shape does not carry. Stored under `resume.ext` (JSON-safe). */
export interface RunExt {
  v: 1;
  index: number; watch: number; watches: number; overtimeIdx: number;
  phase: ShiftPhase; phaseLeft: number; nightDone: boolean; topside: boolean; metFired: boolean; ropeUsed: boolean;
  clock: ClockSnapshot; clockLen: number; lastCallSec: number;
  pulls: number; pullsMax: number; watchPulls: number; boughtThisWatch: number;
  tickets: number; debtPaid: number; dreadPts: number;
  freeRerolls: number; skipRest: number;
  /** Pawn Window stock (wave 8). Optional: older saves have none. */
  pawn?: PawnSnapshot;
  /** Rounds opened per machine id (the Pawn's most-played machine). Optional. */
  plays?: Record<string, number>;
  /** Legacy (pre-wave 8 reroll counter), ignored. */
  pawnRerolls?: number;
  discount: number; nextDiscount: number; elapsed: number; maxWallet: number; biggest: number; rounds: number;
  rng: [number, number, number, number];
  /** Pending overpay choices (optional: older v1 saves have none). */
  overpays?: PendingOverpay[];
  /** Tycoon layer state (owned machines, levels, staff). Optional: older saves have none. */
  tycoon?: Partial<TycoonState>;
  /** Host ms wall clock at save time; resume credits the time away to the tycoon (idle income). */
  savedAt?: number;
  /** Active buffs and tonics per owner key. Optional: older saves have none. */
  buffs?: BuffSave;
  /** Owned totems (carried and placed). Optional: older saves have none. */
  totems?: TotemState[];
  /** Bounty board: offers, signed and finished slips, stat baselines. Optional: older saves have none. */
  contracts?: ContractsSave;
  /** THE CIRCUIT: Tilt counters and Lamps of the Watch in progress. Optional: older saves have none. */
  circuit?: CircuitSave;
  /** The hotline: ring schedule and the live call. Optional: older saves have none. */
  hotline?: HotlineSave;
}
/** Contracts persisted under `ext.contracts`. `base` holds the stat value at signing, for stat goals. */
interface ContractsSave { night: number; seq: number; list: ContractState[]; base: Record<string, number> }
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
  /** Pawn Window stock keeper (wave 8): stock, locks, rerolls, swap. The charm vendor reads it. */
  readonly pawn: Pawn;
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
      machineId, category: def?.category, tags: scopeTags(machineId, def?.tags), zone: def?.zone, instance: q.instance,
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
  readonly pawn: Pawn;
  readonly collateral: CollateralApi;
  readonly nightEvents: NightEventsApi;
  readonly contracts: ContractsApi;
  readonly jackpots: JackpotsApi;
  /** THE CIRCUIT (Tilt bulbs and Lamps), read by the HUD, the seat HUD and the world beacons. */
  readonly circuit: CircuitView;

  private readonly rng: Rng;
  private readonly circ = new Circuit();
  /** The instance the local player sits at (from `player:seat`), for the seat HUD's Tilt bulbs. */
  private seatedMid: InstanceId | null = null;
  private readonly save: SaveStore | null;
  private readonly modsImpl: Mods;
  private readonly tycoonSys: Tycoon;
  private readonly buffSys: BuffSystem;
  private readonly itemSys: ItemSystem;
  private readonly hotline: Hotline;
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
  private freeRerolls = 0;
  private pawnRev = 0;
  private readonly lastBet = new Map<string, number>();
  private oddsKey = '';
  private baseEventChance = 0.35;
  private readonly plays = new Map<string, number>();
  private readonly banner: EventBannerShow | undefined;
  private ropeUsed = false;
  private dreadPts = 0;

  // status
  private living = true;
  private ended = false;
  private refusal: RefusalReason | null = null;
  private elapsed = 0;
  private clockAcc = 0;
  private stats: Record<string, number> = { rounds: 0, wagered: 0, paid: 0, biggest: 0, wins: 0, nightsPaid: 0, interest: 0, deposited: 0 };
  private maxWallet = START.pocket;
  private biggest = 0;
  private bestMachine: string | null = null;
  private rounds = 0;
  private dirty = false;
  private sinceFlush = 0;
  private overpays: PendingOverpay[] = [];
  // bounty board (ContractsApi): defs registered by the device catalogue, offers and slips for this run
  private readonly contractDefs = new Map<string, ContractDef>();
  private contractList: ContractState[] = [];
  private contractNight = -1;
  private contractSeq = 0;
  private contractBase = new Map<string, number>();
  private readonly unsubs: Unsub[] = [];

  constructor(opts: RunOpts, resume: RunSave | null) {
    this.mode = playableMode(opts.mode);
    this.seed = opts.seed;
    this.rules = rulesFor(this.mode);
    this.save = opts.save ?? null;
    this.banner = opts.banner;
    this.rng = createRng(opts.seed);
    this.config = {
      startWallet: this.rules.startWallet, deadlines: BASE_RUN_NIGHTS, difficulty: 'normal', friendlyGive: false,
      realtimeShift: this.rules.timed, shiftSeconds: nightDef(0).clock, sharedBank: false, stake: 0, modifiers: [],
      daily: false, randomLineup: true, collateral: false, botFill: false, ...opts.cfg,
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

    this.circuit = this.makeCircuitView();
    this.modsImpl.register(this.makeCircuitProvider());

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
      deposited: () => this.stats.deposited ?? 0,
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
      // buffs change outside the boundary actions (timers, auras, round spends): mark the save dirty, `tick` writes it
      touch: () => { this.modsImpl.touch(); this.persistSoon(); },
      players: () => [this.selfId],
    }, this.modsImpl, { banner: opts.banner });
    this.buffs = this.buffSys.buffs;
    this.hotline = createHotline(this, {
      now: () => performance.now(),   // = net.hostTime() offline and on the host (the run only lives on the host)
      host: {
        addPulls: (n) => {
          if (!Number.isFinite(this.pullCount)) return;
          this.pullCount = Math.max(0, this.pullCount + n);
          this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
          this.notify(); this.persist();
        },
        creditQuota: (c) => {
          if (!this.quotaMode || c <= 0) return;
          this.debtPaid += c;
          this.stats.deposited = (this.stats.deposited ?? 0) + c;
          this.syncQuota();
          this.emit('run:deposit', { pid: this.selfId, amount: c, paid: this.debtPaid, due: this.quota.due });
          this.checkMet();
          this.emit('quota:update', { quota: this.quota });
          this.persist();
        },
        previewNextHot: () => {
          if (!this.quotaMode) return null;
          const last = this.watch + 1 >= this.watches;
          const idx = last ? this.index + 1 : this.index;
          const wt = last ? 0 : this.watch + 1;
          if (idx + 1 < LAMP_FIRST_NIGHT) return null;
          const hot = rollLamps(createRng(hashSeed('lamps', this.seed, idx, wt)), this.lampCandidates(), {
            hot: Math.max(0, hotLampCount(idx + 1) + Math.round(this.mod('x.lamp.hotCount', RUN_MACHINE, 0))),
            cold: 0,
            prevHot: this.circ.hot(),
          }).hot[0];
          const c = hot === undefined ? undefined : this.lampCandidates().find((m) => m.mid === hot);
          return c ? { mid: c.mid, machineId: c.machineId } : null;
        },
      },
    });
    this.nightEvents = this.buffSys.nightEvents;
    this.baseEventChance = this.buffSys.nightEvents.chance();

    this.itemSys = createItemSystem({
      selfId: this.selfId,
      isHost: true,
      rng: createRng(hashSeed('totems', opts.seed)),
      run: () => this,
      now: () => Math.round(this.elapsed * 1000),
      allied: (a, b) => a === b,
      touch: () => { this.modsImpl.touch(); this.persistSoon(); },
      instancePos: (mid) => this.worldLink?.instancePos(mid),
    }, this.modsImpl);
    this.totems = this.itemSys.totems;

    this.pawn = this.makePawn();
    this.collateral = inert<CollateralApi>('collateral', {});
    this.contracts = this.makeContractsApi();
    this.unsubs.push(
      bus.on('player:seat', (p) => {
        if (p.pid !== this.selfId) return;
        this.seatedMid = p.on ? p.mid : null;
        this.oddsKey = '';
        if (p.on) { this.emitTilt(p.mid); this.refreshOdds(true); }
      }),
      bus.on('machine:result', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:result', p); }),
      bus.on('machine:round', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:round', p); }),
      bus.on('run:deposit', (p) => { if (p.pid === this.selfId) this.advanceContracts('run:deposit', { machineId: '', amount: p.amount }); }),
      bus.on('jackpot:win', (p) => { if (p.pid === this.selfId) this.advanceContracts('machine:jackpot', p); }),
    );
    this.jackpots = this.makeJackpotsApi();

    if (resume) {
      this.restore(resume);
    } else {
      this.recomputeQuota();
      this.enter(this.rules.timed ? 'intermission' : 'play', 0);
      this.applyStartKit();
    }
    this.prepareBoss();
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
    this.lastBet.set(src.mid, amount);
    if (!this.openRounds.has(src.mid)) {
      this.openRounds.add(src.mid);
      this.rounds++;
      this.stats.rounds = this.rounds;
      this.plays.set(src.machineId, (this.plays.get(src.machineId) ?? 0) + 1);
      this.countTilt(src.mid, src.machineId, pullCost);
      this.emit('machine:round', { mid: src.mid, machineId: src.machineId, pid: this.selfId, bet: amount });
    }
    this.emit('eco:wallet', { pid: this.selfId, wallet: this.coins, delta: -cost, reason: `bet:${src.machineId}` });
    if (!this.rules.unlimitedPulls) {
      this.emit('pulls:change', { pid: this.selfId, pulls: this.pullCount });
      if (pullCost > 0 && this.pullCount <= 0) this.enter('closing', closingSeconds(this.isLastWatch()));
    }
    this.notify();
    this.refreshOdds();
    return true;
  }

  win(gross: number, src: EcoSource, meta: WinMeta): number {
    this.openRounds.delete(src.mid);
    // betFrac (bet / max bet) lets Gilded Chip read the stake; Capacitor scopes through `instance`.
    const maxBet = this.betLimits(src.machineId, src.mid).max;
    const q: ModQuery = { pid: this.selfId, instance: src.mid, ctx: { betFrac: Number.isFinite(maxBet) && maxBet > 0 ? meta.bet / maxBet : 0 } };
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
      const limitMult = this.mod('x.house.limitMult', src.machineId, 1, q);
      const r = settlePayout({ gross, bet: meta.bet, A, M, flat, quota: this.quotaMode ? this.quota.due : 0, limitMult });
      pr = r;
      credited = r.credited;
      if (r.excess > 0) this.feedJackpot('net', r.excess);
    }
    this.coins += credited;
    this.maxWallet = Math.max(this.maxWallet, this.coins);
    this.stats.paid = (this.stats.paid ?? 0) + credited;
    if (credited > this.biggest) this.bestMachine = src.machineId;
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
    this.refreshOdds();
    return credited;
  }

  deposit(amount: number): boolean {
    if (!this.quotaMode || this.ended || this.phase === 'collection') return false;
    const amt = Math.min(Math.floor(amount), this.coins);
    if (amt <= 0) return false;
    this.coins -= amt;
    const credit = Math.floor(amt * (1 + this.mod('deposit.bonus', RUN_MACHINE, 0)));
    this.debtPaid += credit;
    this.stats.deposited = (this.stats.deposited ?? 0) + credit;
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
    if (add) {
      this.counters.set(key, v);
      this.syncStatContracts(key);
    }
    return v;
  }
  phone(): PhoneCallState | null { return this.hotline.phone(); }
  answerPhone(choice: number): void { this.hotline.answer(choice); }

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
    if (this.pawn.rev !== this.pawnRev) { this.pawnRev = this.pawn.rev; this.persistSoon(); }
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
    this.hotline.tick(dt);
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
    this.ensureBoss(); // before the clock and pull mods are read below
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
    this.rollLamps();
    this.buffSys.onBell();
    this.persist();
    this.refreshOdds();
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
    this.shiftState.index = this.index;
    this.shiftState.floor = this.index + 1;
    this.shiftState.stake = nd.si;
    this.shiftState.segment = { index: 0, count: nd.watches };
    this.recomputeQuota();
    this.prepareBoss();
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

  attachWorld(link: RunWorldLink | null): void {
    this.worldLink = link;
    // a resumed Watch already has Lamps: tell the beacons once the pit exists
    if (link && (this.circ.hot().length > 0 || this.circ.cold().length > 0)) this.emitLamps();
  }
  takeIdleReport(): IdleReport | null { return this.tycoonSys.takeIdleReport(); }
  dispose(): void {
    this.unsubs.splice(0).forEach((u) => u());
    this.hotline.dispose();
    this.buffSys.dispose();
    this.itemSys.dispose();
  }

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
    this.settleCircuit();
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
      this.announceNextBoss();
    }
    this.persist();
  }

  /** Dawn Collection: the quota is settled. Paid → overpay rewards, the surplus opens the next Night. Short → protections or the trapdoor. */
  private dawn(): void {
    this.expireContracts();
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
    this.finishBoss();
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

  private postMortem(): NonNullable<RunSummary['post']> {
    const q = this.shift.quota();
    let topCharm: string | null = null;
    let best = 0;
    for (const s of this.charmBox.list(this.selfId)) {          // owned order: ties go to the earliest
      const n = this.charmBox.procs.get(s.id) ?? 0;
      if (n > best) { best = n; topCharm = s.id; }
    }
    return {
      short: Math.max(0, q.due - q.deposited),
      pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0,
      bestMachine: this.bestMachine,
      topCharm,
    };
  }

  private endRun(result: RunSummary['result'], ending?: string): void {
    this.ended = true;
    this.clock.stop();
    this.enter('over', 0);
    const obols = this.quotaMode ? this.runObols(result, ending) : undefined;
    const summary: RunSummary = {
      mode: this.mode, seed: this.seed, result, floor: this.index + 1, deadlines: this.index + 1, maxWallet: this.maxWallet,
      rounds: this.rounds, biggestWin: this.biggest, durationSec: Math.round(this.elapsed),
      players: [{ id: this.selfId, name: '', placement: 1, wallet: this.coins }],
      stats: { ...this.stats },
      ...(ending ? { ending } : {}),
      ...(obols !== undefined ? { obols } : {}),
      post: this.postMortem(),
    };
    this.emit('run:end', { summary });
    if (this.save) {
      // Descend banked its Obols (and the descent count) in the tycoon's prestige; every other ending banks them here.
      const banked = ending === 'descend' ? null : this.bankObols(obols ?? 0);
      this.save.update((d) => {
        d.resume = null;
        d.history = [...d.history, summary].slice(-20);
        if (banked) d.meta = banked;
      });
      this.save.flush();
    }
    this.notify();
  }

  /**
   * Obols for this ending (GDD §11.2): a fall pays ×0.5, Descend ×1.0, Topside STAY UP ×1.5, abandoning ×0.25, on the
   * run's total deposited (so it grows with every Night paid) and the Foundations gain.
   */
  private runObols(result: RunSummary['result'], ending?: string): number {
    const outcome: ObolOutcome = ending === 'descend' ? 'descend' : result === 'fell' ? 'fell' : result === 'escaped' ? 'topside' : 'quit';
    const prestige = this.tycoonSys.prestige;
    if (outcome === 'descend') return prestige.preview().obols;
    return obolsFor({ deposited: this.stats.deposited ?? 0, outcome, gain: prestige.preview().multiplier });
  }

  /** Adds Obols to the tycoon's meta (so a later `persistMeta` keeps them) and returns the copy for the save. */
  private bankObols(obols: number): MetaState {
    const meta = this.tycoonSys.prestige.state() as MetaState;
    meta.obols += Math.max(0, obols);
    meta.bestShift = Math.max(meta.bestShift, this.index);
    return { ...meta, nodes: { ...meta.nodes }, unlocked: [...meta.unlocked] };
  }

  // ── THE CIRCUIT: Tilt and Lamps (GDD §3.4) ──────────────────────────────────────────────────────────
  /** The Circuit only applies inside a timed quota Watch (not in the Free Casino, not between Watches). */
  private circuitLive(): boolean { return this.quotaMode && this.rules.timed && this.inWatch(); }

  private tiltGrace(machineId: MachineId, mid: InstanceId, q: ModQuery): number {
    let g = this.mod('x.tilt.grace', machineId, 0, q);
    const first = this.circ.firstPlayed();
    if (first !== null && first !== mid) {
      g -= RED_THREAD_GRACE * (this.charmBox.list(this.selfId).find((c) => c.id === 'red_thread')?.stacks ?? 0);
    }
    return Math.round(g);
  }

  /** Tilt state of one instance now (shared by the payout fold and the views). */
  private tiltOf(machineId: MachineId, mid: InstanceId, q: ModQuery): TiltView {
    const plays = this.circ.playsOf(mid);
    const hot = this.circ.isHot(mid);
    const cold = this.circ.isCold(mid);
    // Tilt Switch: the most played instance ignores Tilt, every other one tilts harder
    const switchOn = this.mod('x.tilt.ignoreMostPlayed', machineId, 0, q) > 0;
    const ignored = hot || (switchOn && this.circ.mostPlayed() === mid);
    const grace = this.tiltGrace(machineId, mid, q);
    const step = ignored ? 0 : tiltStep(plays, grace);
    return {
      plays, hot, cold, step,
      lit: ignored ? 4 : tiltBulbs(plays, grace),
      factor: ignored ? 1 : tiltFactor(plays, grace, switchOn),
      lamp: hot ? this.hotMult(machineId, q) : cold ? this.coldMult(machineId, q) : 1,
    };
  }

  /** Hot Lamp factor: Hot Coal sets it to ×2.0, Warm Lamps (Foundations H4) scale it. */
  private hotMult(machineId: MachineId, q: ModQuery): number {
    let scale = 1;
    for (const s of this.explain('x.lamp.hot', machineId, 1, q).steps) if (s.op === 'mult') scale *= s.value;
    return this.mod('x.lamp.hotMult', machineId, HOT_MULT, q) * scale;
  }

  /** Cold Lamp factor: Cold Hands sets it to ×1.00. */
  private coldMult(machineId: MachineId, q: ModQuery): number {
    return this.mod('x.lamp.coldMult', machineId, COLD_MULT, q);
  }

  /** Lamp and Tilt factor (M) for one play. Hot ×1.5 ignores Tilt; Cold ×0.75 still tilts. */
  private circuitFactor(machineId: MachineId, q: ModQuery): number {
    const mid = q.instance;
    if (mid === undefined || (q.pid !== undefined && q.pid !== this.selfId) || !this.circuitLive()) return 1;
    const v = this.tiltOf(machineId, mid, q);
    return v.lamp * v.factor;
  }

  /** The Circuit's mod source: `payout.mult` ×(Lamp × Tilt) through `modify`, plus Red Thread's +10 % (A) on the first instance. */
  private makeCircuitProvider(): ModProvider {
    const base: ModSource = {
      kind: 'house', id: 'circuit', owner: 0, effects: [],
      modify: (hook, machineId, value, q) => (hook === 'payout.mult' ? value * this.circuitFactor(machineId, q) : value),
    };
    return {
      kind: 'house',
      collect: (q, out) => {
        if (q.instance === undefined || !this.circuitLive()) return;
        out.push(base);
        if (q.instance !== this.circ.firstPlayed()) return;
        const owned: ModSource[] = [];
        this.charmBox.collect(q, owned);
        const effs: ModEffect[] = [];
        for (const s of owned) {
          for (const e of s.effects) {
            if (e.hook === 'x.red.firstPlay') effs.push({ hook: 'payout.mult', op: e.op, value: stackedValue(e, s.stacks ?? 1) });
          }
        }
        if (effs.length) out.push({ kind: 'house', id: 'circuit:first', owner: 0, effects: effs });
      },
    };
  }

  private makeCircuitView(): CircuitView {
    return {
      active: () => this.circuitLive(),
      tilt: (mid) => {
        const machineId = this.tiltMachine(mid);
        return machineId === null ? null : this.tiltOf(machineId, mid, { pid: this.selfId, instance: mid });
      },
      lamps: () => this.lampView(),
    };
  }

  private lampView(): LampView {
    const entry = (mid: InstanceId): { mid: InstanceId; machineId: MachineId } => ({ mid, machineId: this.circ.machineOf(mid) });
    return { hot: this.circ.hot().map(entry), cold: this.circ.cold().map(entry) };
  }

  private emitLamps(): void {
    bus.emit('circuit:lamps', { ...this.lampView(), night: this.night(), watch: this.watch + 1 });
    if (this.seatedMid !== null) this.emitTilt(this.seatedMid);
  }

  /** The machine id of an instance that tracks Tilt right now (a gambling machine in a live Watch), else null. */
  private tiltMachine(mid: InstanceId): MachineId | null {
    if (!this.circuitLive()) return null;
    const id = this.circ.machineOf(mid) || this.worldLink?.machines().find((m) => m.instance === mid)?.machineId || '';
    const cat = id ? registry.get(id)?.def.category : undefined;
    return cat === undefined || cat === 'system' || cat === 'party' ? null : id;
  }

  /** Tells the seat HUD the Tilt state of an instance (null = no Tilt there). */
  private emitTilt(mid: InstanceId): void {
    const machineId = this.tiltMachine(mid);
    const tilt = machineId === null ? null : this.tiltOf(machineId, mid, { pid: this.selfId, instance: mid });
    bus.emit('circuit:tilt', { pid: this.selfId, mid, machineId: machineId ?? '', tilt });
  }

  /** A round opened on `mid`: the pulls it cost count toward Tilt (a free action does not tilt). */
  private countTilt(mid: InstanceId, machineId: MachineId, pulls: number): void {
    if (!this.circuitLive() || pulls <= 0) return;
    this.circ.note(mid, machineId);
    this.circ.addPlays(mid, pulls);
    this.emitTilt(mid);
  }

  /** Bell: seeded Lamp roll (stream `lamps`). Lamps start at Night 2; Night 1 only has Tilt. */
  private lampCandidates(): LampCandidate[] {
    const cands: LampCandidate[] = [];
    for (const m of this.worldLink?.machines() ?? []) {
      const cat = registry.get(m.machineId)?.def.category;
      if (cat === undefined || cat === 'system' || cat === 'party') continue;
      if (this.tycoonSys.staffAt(m.instance).length > 0) continue;        // staffed machines never take a Lamp
      cands.push({ mid: m.instance, machineId: m.machineId });
    }
    return cands;
  }

  private rollLamps(): void {
    if (!this.quotaMode) return;
    const cands = this.lampCandidates();
    const rng = createRng(hashSeed('lamps', this.seed, this.index, this.watch));
    this.circ.startWatch(rng, cands, {
      lamps: this.night() >= LAMP_FIRST_NIGHT,
      hot: Math.max(0, hotLampCount(this.night()) + Math.round(this.mod('x.lamp.hotCount', RUN_MACHINE, 0))),
      cold: Math.max(0, 1 + Math.round(this.mod('x.lamp.coldCount', RUN_MACHINE, 0))),
      newIsHot: this.mod('x.lamp.hot', RUN_MACHINE, 0) > 0,                // Grand Opening Ribbon: machines new this Watch are Hot
    });
    this.emitLamps();
  }

  /** Settle: Tilt resets, the Lamps go dark. */
  private settleCircuit(): void {
    this.circ.settle();
    this.emitLamps();
  }

  // ── quota and debt ─────────────────────────────────────────────────────────────────────────────────
  private recomputeQuota(): void {
    if (!this.quotaMode) { this.quota.due = 0; this.syncQuota(); return; }
    const nd = nightDef(this.index);
    const holdings = this.tycoonSys.holdings();
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
      for (const b of reward.buffs) {
        this.buffSys.buffs.add(b.id, { pid: this.selfId, stacks: b.stacks, durationScale: b.durationScale, source: { kind: 'system', id: 'reward' } });
      }
    }
    if (reward.totems) {
      for (const id of reward.totems) {
        // a full hand (one hand totem at a time) loses the reward; the receipt line is the bounty text
        if (!this.itemSys.totems.grant(this.selfId, id)) log.warnOnce(`reward:totem:${id}`, 'run', `totem reward "${id}" not granted (hand full or unknown)`);
      }
    }
    if (reward.nextQuotaDiscount) this.nextDiscount = Math.min(0.15, this.nextDiscount + reward.nextQuotaDiscount);
    if (reward.charm) {
      const offer = reward.charm;
      if ('id' in offer) {
        this.charmBox.add(this.selfId, offer.id, this.pegs());
      } else {
        // "Choose 1 of 3": roll the candidates now, queue them, and let the UI call pickOverpay (auto-pick on timeout).
        const rarity = Array.isArray(offer.rarity) ? offer.rarity[0] : offer.rarity;
        const cands = choiceOffer(this.rng.fork(`overpay:${this.index}:${this.overpays.length}:${rarity}`), rarity, offer.of, (id) => this.charmBox.has(this.selfId, id), this.index);
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
    this.modsImpl.touch(); // charm `on` handlers write their data bags
  }

  // ── shift API ──────────────────────────────────────────────────────────────────────────────────────
  private makeShiftApi(): ShiftApi {
    const run = this;
    return {
      state: () => run.shiftState,
      get phase() { return run.phase; },
      timeLeft: () => run.timeLeft(),
      quota: () => run.quota,
      quotaFor: (i: number) => quotaFor(i, { discount: run.discount, holdings: run.tycoonSys.holdings(), assessRate: run.mod('x.tycoon.assessRate', RUN_MACHINE, 0.08) }),
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

  // ── wave 8: Pawn Window, boss Nights, starting kits, Tell Sheet ───────────────────────────────────────
  private makePawn(): Pawn {
    return new Pawn({
      selfId: this.selfId,
      rng: () => this.rng,
      night: () => this.index,
      watch: () => this.watch,
      open: () => this.phase === 'intermission' && !this.ended,
      si: () => nightDef(this.index).si,
      held: () => this.charmBox.list(this.selfId).map((s) => s.id),
      canTake: (id) => {
        const s = this.charmBox.find(this.selfId, id);
        return !s || (s.stacks ?? 1) < (charmDef(id)?.maxStacks ?? 1);
      },
      pegsFree: () => this.pegs() - this.charmBox.pegsUsed(this.selfId),
      wallet: () => this.coins,
      tickets: () => this.tickets,
      spendTickets: (n) => {
        if (n < 0 || this.tickets < n) return false;
        this.tickets -= n;
        this.notify();
        this.persistSoon();
        return true;
      },
      freeRerolls: () => this.freeRerolls,
      useFreeReroll: () => {
        if (this.freeRerolls <= 0) return false;
        this.freeRerolls -= 1;
        this.notify();
        return true;
      },
      buyCharm: (id, price) => this.buyCharm(id, price),
      sellCharm: (id) => this.sellCharm(id),
      sellValue: (id) => {
        const def = charmDef(id);
        if (!def || def.rarity === 'cursed') return 0;
        return Math.floor(charmPrice(def, this.shiftState.stake) * (this.charmBox.has(this.selfId, 'pawn_ticket') ? 0.7 : 0.5));
      },
      removeCurse: (id) => {
        const ok = this.charmBox.remove(this.selfId, id);
        if (ok) { this.notify(); this.persist(); }
        return ok;
      },
      discount: () => Math.min(0.9, Math.max(0, this.mod('shop.discount', RUN_MACHINE, 0))),
      discountSlot: () => Math.min(0.9, Math.max(0, this.mod('x.shop.discountSlot', RUN_MACHINE, 0))),
      meta: (code) => {
        const d = this.save?.data;
        if (!d) return false;
        if (code.startsWith('A:')) return d.achievements.includes(code.slice(2));
        return d.meta.unlocked.includes(code);
      },
      mostPlayed: () => {
        let best = '';
        let n = 0;
        for (const [id, c] of this.plays) if (c > n || (c === n && best !== '' && id < best)) { best = id; n = c; }
        if (!best) return null;
        const def = registry.get(best)?.def;
        return { machineId: best, tags: [...(scopeTags(best, def?.tags) ?? [])], category: def?.category };
      },
      explain: (machineId) => this.explain('payout.mult', machineId, 1, { pid: this.selfId }),
    });
  }

  /** Kit from `RunConfig.kit` (debt run start): wallet, Tickets, charms and the pre-deposit toward the first quota. */
  private applyStartKit(): void {
    const kit = this.quotaMode && this.config.kit ? kitById(this.config.kit) : undefined;
    if (!kit) return;
    this.coins = kit.coins;
    this.maxWallet = kit.coins;
    this.tickets = 0;
    const got = applyKit(this, kit, this.selfId);
    if (got && got.predeposit > 0) {
      this.debtPaid += got.predeposit;
      this.stats.deposited = (this.stats.deposited ?? 0) + got.predeposit;
    }
    this.syncQuota();
    this.persist();
  }

  /** The Night's boss (null off boss Nights and outside the debt run). */
  private bossToday(): BossNight | null {
    return this.quotaMode ? bossFor(this.seed, this.night()) : null;
  }

  /** Registers the Night's boss and zeroes the random event chance on boss Nights. */
  private prepareBoss(): void {
    const boss = this.bossToday();
    this.buffSys.nightEvents.setChance(boss ? 0 : this.baseEventChance);
    if (!boss) return;
    registerBossStrings();
    this.buffSys.nightEvents.register(boss);
    if (this.inWatch()) this.ensureBoss();
  }

  /** Boss active for this Watch. Must run before `startWatch` reads the clock and pull mods. */
  private ensureBoss(): void {
    const boss = this.bossToday();
    if (!boss) return;
    registerBossStrings();
    const ne = this.buffSys.nightEvents;
    ne.setChance(0);
    ne.register(boss);
    if (!ne.isActive(boss.id)) ne.trigger(boss.id);
  }

  /** Night paid on a boss Night: the boss ends; reward = choose 1 of 3 Rare charms + 3 Tickets. */
  private finishBoss(): void {
    const boss = this.bossToday();
    if (!boss) return;
    this.buffSys.nightEvents.end(boss.id);
    this.grant({ currencies: { coin: 0, obol: 0, ticket: BOSS_REWARD.tickets }, charm: { choose: 1, of: BOSS_REWARD.charmChoices, rarity: BOSS_REWARD.charmRarity }, text: 'boss' });
  }

  /** Dawn card: names tomorrow's boss (if the Night was paid and a boss follows). */
  private announceNextBoss(): void {
    if (!this.banner || !this.quotaMode || this.debtPaid < this.quota.due) return;
    const next = bossFor(this.seed, this.night() + 1);
    if (!next) return;
    registerBossStrings();
    const p = { suit: (next.suit ?? '').toUpperCase(), name: t(`event.${next.id}.name`) };
    this.banner(t('boss.dawn.next', p), { color: '#ff7a5a', hold: 5, size: 16 });
    this.banner(t(`event.${next.id}.announce`, p), { color: '#ffd060', hold: 5, size: 8 });
  }

  /** Tell Sheet: sends the seat HUD the odds line of the seat the player is in (only when it changed). */
  private refreshOdds(force = false): void {
    const mid = this.seatedMid;
    if (mid === null) return;
    const machineId = this.circ.machineOf(mid) || this.worldLink?.machines().find((m) => m.instance === mid)?.machineId || '';
    const def = machineId ? registry.get(machineId)?.def : undefined;
    let line: OddsLine | null = null;
    if (def && def.category !== 'system' && def.category !== 'party') {
      const bet = this.lastBet.get(mid) ?? this.betLimits(machineId, mid).min;
      const pace = this.quotaMode
        ? paceOf({ due: this.quota.due, deposited: this.debtPaid, pocket: this.coins, pullsLeft: Number.isFinite(this.pullCount) ? this.pullCount : 0 })
        : null;
      line = oddsLine(profileOf(machineId), pace, def.actionCost ?? 1, bet);
    }
    const key = JSON.stringify(line);
    if (key === this.oddsKey && !force) return;
    this.oddsKey = key;
    bus.emit('seat:odds', { pid: this.selfId, mid, line });
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
      freeRerolls: this.freeRerolls, skipRest: this.skipRest,
      pawn: this.pawn.snapshot(), plays: Object.fromEntries(this.plays),
      discount: this.discount, nextDiscount: this.nextDiscount, elapsed: this.elapsed,
      maxWallet: this.maxWallet, biggest: this.biggest, rounds: this.rounds,
      rng: this.rng.getState(),
      overpays: this.overpays.map((o) => ({ rarity: o.rarity, ids: [...o.ids], left: o.left })),
      tycoon: JSON.parse(JSON.stringify(this.tycoonSys.state())) as Partial<TycoonState>,
      savedAt: Date.now(),
      buffs: this.buffSys.buffs.snapshot(),
      totems: this.itemSys.totems.snapshot(),
      contracts: {
        night: this.contractNight, seq: this.contractSeq, list: this.contractList.map((c) => ({ ...c })),
        base: Object.fromEntries(this.contractBase),
      },
      circuit: this.circ.snapshot(),
      hotline: this.hotline.snapshot(),
    };
    return {
      mode: this.mode, seed: this.seed, window: this.window(),
      debts: { [pid]: this.debt(pid) }, wallets: { [pid]: this.coins }, charms: this.charmBox.snapshot(),
      alive: { [pid]: this.living }, jackpots: { net: this.jackpot('net') },
      tier: this.index + 1, phone: this.hotline.phone(), stats: { ...this.stats },
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

  grantCharm(charmId: string): boolean {
    if (!charmDef(charmId)) return false;
    if (!this.charmBox.add(this.selfId, charmId, this.pegs())) return false;
    this.notify();
    this.persist();
    return true;
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

  /** Launch charm pool of one rarity (lootbox and claw prizes read it through `Reflect`). Unlock-gated charms are left out. */
  charmPool(rarity: string): Array<{ id: string; price: number; maxStacks?: number }> {
    return allCharmDefs()
      .filter((d) => d.rarity === rarity && !d.unlock)
      .map((d) => ({ id: d.id, price: Math.abs(d.price), maxStacks: d.maxStacks }));
  }

  // ── bounty board (ContractsApi, GDD §11.9) ──────────────────────────────────────────────────────
  private makeContractsApi(): ContractsApi {
    return {
      register: (def) => {
        this.contractDefs.set(def.id, def);
        return () => { if (this.contractDefs.get(def.id) === def) this.contractDefs.delete(def.id); };
      },
      defs: () => [...this.contractDefs.values()],
      board: () => {
        this.ensureOffers();
        return this.contractList.filter((c) => c.status === 'offered');
      },
      active: (pid) => {
        const who = pid ?? this.selfId;
        return this.contractList.filter((c) => c.owner === who && (c.status === 'active' || c.status === 'done'));
      },
      accept: (uid) => this.acceptContract(uid),
      abandon: (uid) => this.abandonContract(uid),
      claim: (uid) => this.claimContract(uid),
      roll: (n) => { this.rollContracts(n); this.notify(); },
    };
  }

  /** Draws the Night's offers once, the first time the board is read with defs registered. */
  private ensureOffers(): void {
    if (this.contractNight === this.index || this.contractDefs.size === 0 || this.ended) return;
    this.rollContracts(BOARD_OFFERS);
  }

  /** Replaces the unsigned offers with `n` weighted draws (no repeats, none the player already holds). */
  private rollContracts(n: number): void {
    this.contractList = this.contractList.filter((c) => c.status !== 'offered');
    const held = new Set(this.contractList.filter((c) => c.owner === this.selfId).map((c) => c.def));
    const r = this.rng.fork(`bounty:${this.index}:${++this.contractSeq}`);
    const pool = [...this.contractDefs.values()].filter((d) => !held.has(d.id) && (d.minShift ?? 0) <= this.index + 1);
    for (let i = 0; i < n && pool.length > 0; i++) {
      const total = pool.reduce((s, d) => s + (d.weight ?? 2), 0);
      let x = r.next() * total;
      let k = 0;
      while (k < pool.length - 1 && x >= (pool[k].weight ?? 2)) { x -= pool[k].weight ?? 2; k++; }
      const [d] = pool.splice(k, 1);
      this.contractList.push({
        uid: `k${this.index + 1}-${++this.contractSeq}`, def: d.id, owner: 0, status: 'offered', progress: 0, target: d.goal.count, streak: 0,
      });
    }
    this.contractNight = this.index;
    this.persistSoon();
  }

  private statGoal(c: ContractState): string | undefined {
    const d = this.contractDefs.get(c.def);
    return d?.goal.on === 'stat' ? d.goal.where?.stat : undefined;
  }

  private acceptContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.status === 'offered');
    if (!c || this.ended) return false;
    const held = this.contractList.filter((x) => x.owner === this.selfId && (x.status === 'active' || x.status === 'done')).length;
    if (held >= CONTRACT_MAX_ACTIVE) return false;
    c.status = 'active';
    c.owner = this.selfId;
    const key = this.statGoal(c);
    if (key !== undefined) this.contractBase.set(c.uid, this.stat(key));
    this.persist();
    this.notify();
    return true;
  }

  private abandonContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.owner === this.selfId && x.status === 'active');
    if (!c) return false;
    this.dropContract(c);
    this.persist();
    this.notify();
    return true;
  }

  /** Pays a finished slip: coins (absolute or quota fraction), then the grant bundle (tickets, buffs, totems, charm). */
  private claimContract(uid: string): boolean {
    const c = this.contractList.find((x) => x.uid === uid && x.owner === this.selfId && x.status === 'done');
    const d = c ? this.contractDefs.get(c.def) : undefined;
    if (!c || !d) return false;
    const rw = d.reward;
    if (rw.coins !== undefined) {
      const amt = typeof rw.coins === 'number' ? rw.coins : Math.round(this.quota.due * rw.coins.quotaFrac);
      this.earn('coin', amt, `contract:${d.id}`);
    }
    this.grant(rw);
    this.dropContract(c);
    this.persist();
    this.notify();
    return true;
  }

  private dropContract(c: ContractState): void {
    this.contractList = this.contractList.filter((x) => x !== c);
    this.contractBase.delete(c.uid);
  }

  /** Dawn: unsigned offers and unfinished slips expire (GDD §11.9). Finished slips stay until they are cashed. */
  private expireContracts(): void {
    for (const c of this.contractList) if (c.status === 'offered' || c.status === 'active') this.contractBase.delete(c.uid);
    this.contractList = this.contractList.filter((c) => c.status !== 'offered' && c.status !== 'active');
  }

  /** Counts run events toward signed slips whose goal is an event (not a stat). */
  private advanceContracts(on: ContractGoal['on'], ev: ContractEv): void {
    let changed = false;
    for (const c of this.contractList) {
      if (c.status !== 'active' || c.owner !== this.selfId) continue;
      const d = this.contractDefs.get(c.def);
      if (!d || d.goal.on !== on || d.goal.where?.stat !== undefined) continue;
      const w = d.goal.where ?? {};
      if (!contractMatches(w, ev)) {
        // a streak breaks on a non-matching result from the same machine
        if (d.goal.streak && w.machineId !== undefined && ev.machineId === w.machineId && c.progress > 0) {
          c.progress = 0;
          changed = true;
        }
        continue;
      }
      c.progress += d.goal.sum ? Math.max(0, ev[d.goal.sum] ?? 0) : 1;
      if (d.goal.streak) c.streak = c.progress;
      if (c.progress >= c.target) c.status = 'done';
      changed = true;
    }
    if (changed) { this.persistSoon(); this.notify(); }
  }

  /** Stat goals read the run counter minus the value at signing. */
  private syncStatContracts(key: string): void {
    let changed = false;
    for (const c of this.contractList) {
      if (c.status !== 'active' || c.owner !== this.selfId || this.statGoal(c) !== key) continue;
      const p = Math.max(0, this.stat(key) - (this.contractBase.get(c.uid) ?? 0));
      if (p === c.progress) continue;
      c.progress = p;
      if (p >= c.target) c.status = 'done';
      changed = true;
    }
    if (changed) { this.persistSoon(); this.notify(); }
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
    this.freeRerolls = e.freeRerolls; this.skipRest = e.skipRest;
    if (e.pawn) this.pawn.restore(e.pawn);
    this.plays.clear();
    for (const [id, n] of Object.entries(e.plays ?? {})) this.plays.set(id, n);
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
    this.buffSys.buffs.restore(e.buffs);
    this.hotline.restore(e.hotline);
    this.itemSys.totems.restore(e.totems);
    if (e.contracts) {
      this.contractNight = e.contracts.night;
      this.contractSeq = e.contracts.seq;
      this.contractList = e.contracts.list.map((c) => ({ ...c }));
      this.contractBase = new Map(Object.entries(e.contracts.base));
    }
    this.circ.restore(e.circuit);
    if (typeof e.savedAt === 'number') this.tycoonSys.catchUp(Math.max(0, (Date.now() - e.savedAt) / 1000));
    this.ended = !this.living || this.phase === 'over';
  }
}
