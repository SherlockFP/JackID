/**
 * Tycoon / incremental layer (GAME-TYCOON). Implements `TycoonApi` from `game/tycoon.types.ts` and is created by the
 * run (`run.tycoon`). Host-authoritative: clients call the same methods, which forward a `TycoonRequest` through
 * `deps.send`; the host applies it with `apply(req, pid)` and replicates a `tycD` delta.
 *
 * Pieces: catalogue (`catalog.ts`, templates × machines × levels), modifier provider (`provider.ts`), this API
 * (buy / order / sell / staff / wings / idle income / shill auto-play / Descend), and pure data (`game/data/upgrades.ts`).
 * Coins go through `run.spend` / `run.earn` only, so the run's wallet and events stay the single source of truth.
 */
import { bus } from '@/core/events';
import type { InstanceId, MachineId, PlayerId, SlotSize, Unsub, ZoneId } from '@/core/types';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { defaultMeta, type SaveStore } from '@/core/save';
import { log } from '@/core/log';
import * as registry from '@/machines/_base/registry';
import type { RunApi } from '@/game/types';
import {
  costAt, roundSig,
  type BuyBlock, type BuyMode, type BuyQuote, type IdleReport, type MetaNode, type MetaState, type OwnedMachine,
  type PrestigeApi, type StaffDef, type StaffKind, type StaffState, type TycoonApi, type TycoonNoReason, type TycoonRequest,
  type TycoonState, type UpgradeDef, type UpgradeView, type WingDef,
} from '@/game/tycoon.types';
import type { ModHook, ModProvider } from '@/game/modifiers.types';
import { foldEffects } from '@/game/modifiers.types';
import { META_NODES, ORDER_PRICING, PATRON_RATE, STAFF_DEFS, STAFF_TRACK, WING_DEFS, metaReqMissing } from '@/game/data/upgrades';
import { createCatalog, machineDefOf, sizeFits, type Catalog, type TycoonDef } from './catalog';
import { TycoonMods } from './provider';

/** Host-side dependencies supplied by the run / world. Everything optional has a safe single-player default. */
export interface TycoonDeps {
  /** The run that owns this layer (lazy: the run constructs the tycoon inside its own constructor). */
  run(): RunApi;
  /** Run seed; the Shill stream is derived from it. */
  seed: number;
  /** True on the authority (single player, or the room host). */
  isHost(): boolean;
  /** Client only: forward a request to the host (`tyc` message). */
  send?(req: TycoonRequest): void;
  /** Every placed machine that holds tracks (pre-placed and tycoon-owned). Pads are not listed. */
  machines?(): ReadonlyArray<{ instance: InstanceId; machineId: MachineId; size?: SlotSize }>;
  /** Pad / slot size of an instance (order fit check). Default: from `machines()`, else M. */
  slotSize?(instance: InstanceId): SlotSize | undefined;
  /** False during Closing, Settle, Collection and cutscenes (GDD §3.7.1). Default true. */
  tradeOpen?(): boolean;
  /** Current quota due, for wing prices (`priceQuotaMult × quota`). Default 0. */
  quotaDue?(): number;
  /** Current shift index, for `bestShift`. */
  shiftIndex?(): number;
  /** Coins deposited this run (Descend preview). */
  deposited?(): number;
  /** Run house edge (Descend preview). */
  houseEdge?(): number;
  /** Persistent save (meta tree lives in `save.data.meta`). */
  save?: SaveStore;
  /** Called after Descend banks the Obols: the run ends and plays its cutscene. */
  onDescend?(): void | Promise<void>;
  /** Host ms clock (stamps purchases; must be the run clock, never wall time). Default 0. */
  now?(): number;
}

export interface Tycoon extends TycoonApi {
  /** Register once with `run.mods` (`Mods.register(tycoon.provider)`). */
  readonly provider: ModProvider;
  /** Host: apply a request from `pid` (the local player in single player). `null` = applied, else the refusal. */
  apply(req: TycoonRequest, pid?: PlayerId): TycoonNoReason | null;
  /** Host: Shill stake and staff name helpers (not in TycoonApi). */
  setStake(uid: string, stake: number): boolean;
  rename(instance: InstanceId, name: string): boolean;
  /** Host, once per frame or per second while in Play: pays idle income and runs Shill plays. */
  tick(dtSec: number): void;
  /** Host, on resume: credits time away (≤ 600 s, 25 %). Result via `takeIdleReport()`. */
  catchUp(awayS: number): void;
  /** Host, at Dawn Collection: Holdings depreciate 25 %. */
  onDawn(): void;
  /** Replace the per-run state (resume or a new run). Meta is kept. */
  restore(s: Partial<TycoonState> | null | undefined): void;
  /** New run: clear per-run state, keep the meta tree. */
  reset(): void;
  /** Host: banks a win on Night `night` (1-based) for the Foundations gates (`won:N`). False when already banked. */
  recordWin(night: number): boolean;
}

const SHILL_STAKE_FRAC = 0.01;
const SHILL_SKIP_MAX = 60;
const AWAY_CAP_S = 600;
const AWAY_RATE = 0.25;

function emptyState(): TycoonState {
  return { levels: {}, machines: {}, staff: [], zones: [], floor: 1, holdings: 0, orders: 0, idleEarned: 0 };
}
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);

function reasonOf(b: BuyBlock | undefined): TycoonNoReason {
  switch (b) {
    case 'maxed': return 'maxed';
    case 'locked': return 'locked';
    case 'funds': return 'funds';
    case 'phase': return 'phase';
    case 'requires': return 'requires';
    case 'owner': return 'owner';
    default: return 'invalid';
  }
}

function staffDefOf(kind: StaffKind): StaffDef | undefined {
  return STAFF_DEFS.find((d) => d.kind === kind);
}

class TycoonImpl implements Tycoon {
  readonly catalog: Catalog;
  readonly provider: ModProvider;
  readonly prestige: PrestigeApi;

  private st: TycoonState = emptyState();
  private readonly mods: TycoonMods;
  private meta: MetaState;
  private readonly nodes = new Map<string, MetaNode>();
  private readonly listeners = new Set<() => void>();
  private readonly featCache = new Map<InstanceId, ReadonlySet<string>>();
  private readonly playAcc = new Map<string, number>();
  private readonly rng: Rng;
  private pendingHouse = 0;
  private report: IdleReport | null = null;

  constructor(private readonly deps: TycoonDeps) {
    this.catalog = createCatalog();
    this.mods = new TycoonMods({
      catalog: this.catalog,
      levels: () => this.st.levels,
      instances: () => this.allInstances(),
      metaNodes: () => [...this.nodes.values()].map((node) => ({ node, level: this.metaLevel(node.id) })),
    });
    this.provider = this.mods;
    this.rng = createRng(hashSeed(deps.seed, 'shill'));
    this.meta = this.loadMeta();
    for (const n of META_NODES) this.nodes.set(n.id, n);
    this.prestige = this.makePrestige();
  }

  // ── identity & helpers ──────────────────────────────────────────────────────────────────────────
  private run(): RunApi { return this.deps.run(); }
  private selfId(): PlayerId { return this.run().selfId; }
  private now(): number { return this.deps.now?.() ?? 0; }
  private tradeOpenNow(): boolean { return this.deps.tradeOpen?.() ?? true; }
  private levelById(id: string): number { return this.st.levels[id] ?? 0; }
  level(upgradeId: string): number { return this.levelById(upgradeId); }
  private levelOf(instance: InstanceId, track: string): number { return this.levelById(`upg.${instance}.${track}`); }
  private metaLevel(id: string): number { return this.meta.nodes[id] ?? 0; }

  /** Owned machine or a pre-placed one from `deps.machines()`. */
  private machineOf(instance: InstanceId): MachineId | undefined {
    const owned = this.st.machines[instance];
    if (owned) return owned.machineId;
    const found = this.deps.machines?.().find((m) => m.instance === instance);
    if (found) this.catalog.bind(instance, found.machineId);
    return found?.machineId;
  }
  private allInstances(): Array<{ instance: InstanceId; machineId: MachineId }> {
    const out = new Map<InstanceId, MachineId>();
    for (const m of this.deps.machines?.() ?? []) out.set(m.instance, m.machineId);
    for (const m of Object.values(this.st.machines)) out.set(m.instance, m.machineId);
    for (const [instance, machineId] of out) this.catalog.bind(instance, machineId);
    return [...out].map(([instance, machineId]) => ({ instance, machineId }));
  }
  private slotSize(instance: InstanceId): SlotSize {
    return this.deps.slotSize?.(instance) ?? this.deps.machines?.().find((m) => m.instance === instance)?.size ?? 'M';
  }
  private defOf(id: string): TycoonDef | undefined { return this.catalog.def(id) as TycoonDef | undefined; }

  private changed(): void {
    this.featCache.clear();
    this.mods.invalidate();
    this.run().mods.touch();
    for (const s of this.st.staff) s.level = s.instance ? 1 + this.levelOf(s.instance, STAFF_TRACK) : 1;
    this.notify();
  }
  private notify(): void { for (const fn of this.listeners) fn(); }

  /** Clients forward; the host applies. Returns whether the request was accepted or sent. */
  private act(req: TycoonRequest): boolean {
    if (!this.deps.isHost()) {
      this.deps.send?.(req);
      return !!this.deps.send;
    }
    return this.apply(req) === null;
  }

  // ── state ───────────────────────────────────────────────────────────────────────────────────────
  state(): Readonly<TycoonState> { return this.st; }
  holdings(): number { return this.st.holdings; }
  onChange(fn: () => void): Unsub {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  restore(s: Partial<TycoonState> | null | undefined): void {
    const base = emptyState();
    if (s) {
      if (s.levels && typeof s.levels === 'object') for (const [k, v] of Object.entries(s.levels)) base.levels[k] = Math.max(0, Math.floor(num(v, 0)));
      if (s.machines && typeof s.machines === 'object') for (const [k, v] of Object.entries(s.machines)) if (v && typeof v.machineId === 'string') base.machines[k] = { ...v, instance: k };
      if (Array.isArray(s.staff)) base.staff = s.staff.filter((x) => x && typeof x.uid === 'string' && staffDefOf(x.kind));
      if (Array.isArray(s.zones)) base.zones = s.zones.filter((z): z is ZoneId => typeof z === 'string');
      base.floor = Math.max(1, Math.floor(num(s.floor, 1)));
      base.holdings = Math.max(0, num(s.holdings, 0));
      base.orders = Math.max(0, Math.floor(num(s.orders, 0)));
      base.idleEarned = Math.max(0, num(s.idleEarned, 0));
    }
    this.st = base;
    this.pendingHouse = 0;
    this.playAcc.clear();
    for (const m of Object.values(this.st.machines)) this.catalog.bind(m.instance, m.machineId);
    this.changed();
  }

  reset(): void {
    this.restore(null);
    this.report = null;
  }

  // ── upgrades ────────────────────────────────────────────────────────────────────────────────────
  upgradesFor(instance: InstanceId): readonly UpgradeView[] {
    const mid = this.machineOf(instance);
    if (!mid) return [];
    return this.catalog.defsFor({ scope: 'instance', instance, machineId: mid })
      .filter((d) => !(d.template.hidden && this.levelById(d.id) === 0))
      .map((d) => this.viewOf(d));
  }
  upgradesGlobal(): readonly UpgradeView[] {
    return this.catalog.defsFor({ scope: 'global' })
      .filter((d) => !(d.template.hidden && this.levelById(d.id) === 0))
      .map((d) => this.viewOf(d));
  }
  private viewOf(d: UpgradeDef): UpgradeView {
    const level = this.levelById(d.id);
    return { def: d, level, quote: this.quote(d.id, 1), next: d.nextMilestone(level) };
  }

  /** Discount from `upgrade.costMult` (F1, charms) for one instance or the pit. */
  private discountFor(instance: InstanceId | undefined, machineId: MachineId): number {
    const m = this.run().mod('upgrade.costMult', machineId, 1, instance ? { instance } : {});
    return Math.min(0.95, Math.max(0, 1 - m));
  }

  private requiresBlock(d: UpgradeDef, instance: InstanceId | undefined): BuyBlock | undefined {
    const req = d.template.requires;
    if (!req) return undefined;
    if (req.upgrade) {
      const id = instance ? `upg.${instance}.${req.upgrade}` : `upg.global.${req.upgrade}`;
      if (this.levelById(id) < (req.level ?? 1)) return 'requires';
    }
    if (req.shift !== undefined && this.run().night() < req.shift) return 'requires';
    if (req.feature && instance && !this.hasFeature(instance, req.feature)) return 'requires';
    return undefined;
  }

  quote(upgradeId: string, mode: BuyMode | number = 1): BuyQuote {
    const base: BuyQuote = { upgrade: upgradeId, from: 0, to: 0, levels: 0, cost: 0, currency: 'coin', affordable: false };
    const d = this.defOf(upgradeId);
    if (!d) return { ...base, blocked: 'locked' };
    const from = this.levelById(upgradeId);
    base.from = from; base.to = from;
    const inst = d.target.scope === 'instance' ? d.target.instance : undefined;
    const mid = d.target.scope === 'instance' ? d.target.machineId : '';
    if (!this.tradeOpenNow()) return { ...base, blocked: 'phase' };
    if (inst && !this.machineOf(inst)) return { ...base, blocked: 'locked' };
    if (from >= d.maxLevel) return { ...base, blocked: 'maxed' };
    const rq = this.requiresBlock(d, inst);
    if (rq) return { ...base, blocked: rq };

    const wallet = this.run().wallet();
    const discount = this.discountFor(inst, mid);
    const want = mode === 'max' ? d.maxLevel - from : Math.min(mode, d.maxLevel - from);
    let cost = 0; let n = 0;
    while (n < want && n < 5000) {
      const c = d.costOf(from + n, discount);
      if (mode === 'max' && cost + c > wallet) break;
      cost += c; n++;
    }
    if (n === 0) return { ...base, cost: d.costOf(from, discount), blocked: 'funds' };
    const affordable = cost <= wallet;
    return { ...base, to: from + n, levels: n, cost, affordable, blocked: affordable ? undefined : 'funds' };
  }

  buy(upgradeId: string, mode: BuyMode = 1): boolean {
    return this.act({ op: 'buy', upgrade: upgradeId, levels: mode === 'max' ? 0 : mode });   // levels 0 = MAX affordable
  }

  private doBuy(upgradeId: string, mode: BuyMode | number, pid: PlayerId): TycoonNoReason | null {
    const q = this.quote(upgradeId, mode);
    if (q.levels <= 0) return reasonOf(q.blocked);
    if (!q.affordable) return 'funds';
    if (!this.run().spend('coin', q.cost, 'upgrade', pid)) return 'funds';
    const d = this.defOf(upgradeId);
    this.st.levels[upgradeId] = q.to;
    this.st.holdings += q.cost;
    if (d) {
      for (let l = q.from + 1; l <= q.to; l++) {
        for (const m of d.milestones) if (m.level === l && (m.feature || m.visual)) {
          bus.emit('tycoon:milestone', { upgrade: upgradeId, level: l, feature: m.feature });
        }
      }
    }
    bus.emit('tycoon:buy', { pid, upgrade: upgradeId, from: q.from, to: q.to, cost: q.cost });
    this.changed();
    return null;
  }

  // ── features ────────────────────────────────────────────────────────────────────────────────────
  hasFeature(instance: InstanceId, feature: string): boolean { return this.features(instance).has(feature); }
  features(instance: InstanceId): ReadonlySet<string> {
    const hit = this.featCache.get(instance);
    if (hit) return hit;
    const out = new Set<string>();
    const mid = this.machineOf(instance);
    if (mid) {
      for (const d of this.catalog.defsFor({ scope: 'instance', instance, machineId: mid })) {
        const lv = this.levelById(d.id);
        if (lv > 0) for (const f of d.featuresAt(lv)) out.add(f);
      }
    }
    this.featCache.set(instance, out);
    return out;
  }

  // ── machines: owned, ordering, selling ──────────────────────────────────────────────────────────
  owned(instance: InstanceId): OwnedMachine | null {
    const own = this.st.machines[instance];
    if (own) return own;
    const mid = this.machineOf(instance);
    if (!mid) return null;
    return { instance, machineId: mid, owner: 0, price: 0, boughtAt: 0, stats: { rounds: 0, wagered: 0, won: 0 } };
  }

  orderPrice(machineId: MachineId): number {
    const d = machineDefOf(machineId);
    const base = d ? ORDER_PRICING.sizeBase[d.slotSize] : ORDER_PRICING.sizeBase.M;
    return roundSig(base * Math.pow(ORDER_PRICING.growth, this.st.orders), 3);
  }

  orderable(instance: InstanceId): MachineId[] {
    const slot = this.slotSize(instance);
    const run = this.run();
    return registry.ids().filter((id) => {
      const d = machineDefOf(id);
      return !!d && d.category !== 'system' && sizeFits(d.slotSize, slot) && !run.isLocked(id);
    });
  }

  order(instance: InstanceId, machineId: MachineId): boolean {
    return this.act({ op: 'order', instance, machineId });
  }
  sell(instance: InstanceId): boolean { return this.act({ op: 'sell', instance }); }

  // ── wings / zones ───────────────────────────────────────────────────────────────────────────────
  wings(): readonly WingDef[] { return WING_DEFS; }
  unlockZone(zone: ZoneId): boolean { return this.act({ op: 'zone', zone }); }

  // ── staff ───────────────────────────────────────────────────────────────────────────────────────
  staffDefs(): readonly StaffDef[] { return STAFF_DEFS; }
  staffAt(instance: InstanceId): readonly StaffState[] { return this.st.staff.filter((s) => s.instance === instance); }
  hire(kind: StaffKind, instance: InstanceId | null): boolean { return this.act({ op: 'hire', kind, instance }); }
  fire(uid: string): boolean { return this.act({ op: 'fire', uid }); }
  upgradeStaff(uid: string): boolean { return this.act({ op: 'staffUp', uid }); }
  setStake(uid: string, stake: number): boolean { return this.act({ op: 'stake', uid, stake }); }
  rename(instance: InstanceId, name: string): boolean { return this.act({ op: 'name', instance, name }); }

  // ── the host applies every request ──────────────────────────────────────────────────────────────
  apply(req: TycoonRequest, pid: PlayerId = this.selfId()): TycoonNoReason | null {
    switch (req.op) {
      case 'buy': return this.doBuy(req.upgrade, req.levels > 0 ? req.levels : 'max', pid);
      case 'order': return this.doOrder(req.instance, req.machineId, pid);
      case 'sell': return this.doSell(req.instance, pid);
      case 'hire': return this.doHire(req.kind, req.instance, pid);
      case 'fire': return this.doFire(req.uid);
      case 'staffUp': return this.doStaffUp(req.uid, pid);
      case 'stake': return this.doStake(req.uid, req.stake);
      case 'zone': return this.doZone(req.zone, pid);
      case 'name': return this.doName(req.instance, req.name) ? null : 'invalid';
      case 'prestige': void this.prestige.descend(); return null;
      case 'meta': return this.buyNodeReason(req.node, pid);
      default: return 'invalid';
    }
  }

  private doOrder(instance: InstanceId, machineId: MachineId, pid: PlayerId): TycoonNoReason | null {
    if (!this.tradeOpenNow()) return 'phase';
    if (this.machineOf(instance)) return 'occupied';
    const d = machineDefOf(machineId);
    if (!d || d.category === 'system') return 'invalid';
    if (!sizeFits(d.slotSize, this.slotSize(instance))) return 'invalid';
    if (this.run().isLocked(machineId)) return 'locked';
    const price = this.orderPrice(machineId);
    if (!this.run().spend('coin', price, 'order', pid)) return 'funds';
    this.st.machines[instance] = { instance, machineId, owner: pid, price, boughtAt: this.now(), stats: { rounds: 0, wagered: 0, won: 0 } };
    this.st.orders++;
    this.st.holdings += price;
    this.catalog.bind(instance, machineId);
    bus.emit('tycoon:machine', { pid, instance, machineId });
    this.changed();
    return null;
  }

  private doSell(instance: InstanceId, pid: PlayerId): TycoonNoReason | null {
    if (!this.tradeOpenNow()) return 'phase';
    const m = this.st.machines[instance];
    if (!m) return 'invalid';
    const refund = Math.floor(m.price * ORDER_PRICING.sellBack);
    if (refund > 0) this.run().earn('coin', refund, 'sell', pid);
    this.st.holdings = Math.max(0, this.st.holdings - m.price);
    delete this.st.machines[instance];
    for (const k of Object.keys(this.st.levels)) if (k.startsWith(`upg.${instance}.`)) delete this.st.levels[k];
    for (const s of this.st.staff) if (s.instance === instance) s.instance = null;
    this.catalog.unbind(instance);
    bus.emit('tycoon:machine', { pid, instance, machineId: null });
    this.changed();
    return null;
  }

  private doHire(kind: StaffKind, instance: InstanceId | null, pid: PlayerId): TycoonNoReason | null {
    if (!this.tradeOpenNow()) return 'phase';
    const sd = staffDefOf(kind);
    if (!sd) return 'invalid';
    const count = this.st.staff.filter((s) => s.kind === kind).length;
    if (count >= sd.maxCount) return 'maxed';
    if (sd.mode === 'player' && instance === null) return 'invalid';
    if (instance !== null) {
      const mid = this.machineOf(instance);
      if (!mid) return 'invalid';
      if (this.st.staff.some((s) => s.instance === instance && s.kind === kind)) return 'occupied';
      if (sd.mode === 'house' && !((machineDefOf(mid)?.idleYield ?? 0) > 0)) return 'invalid';
    }
    const cost = costAt(sd.hire, count, 'M');
    if (!this.run().spend('coin', cost, 'hire', pid)) return 'funds';
    const t = this.now();
    const uid = `${kind}-${Math.floor(t)}-${this.st.staff.length + 1}`;
    this.st.staff.push({ uid, kind, instance, owner: pid, level: 1, hiredAt: t });
    this.st.holdings += cost;
    bus.emit('tycoon:staff', { uid, kind, instance, hired: true });
    this.changed();
    return null;
  }

  private doFire(uid: string): TycoonNoReason | null {
    const i = this.st.staff.findIndex((s) => s.uid === uid);
    if (i < 0) return 'invalid';
    const [gone] = this.st.staff.splice(i, 1);
    bus.emit('tycoon:staff', { uid, kind: gone.kind, instance: gone.instance, hired: false });
    this.changed();
    return null;
  }

  /** Staff level IS the instance's `staff` track level: one purchase of `upg.<instance>.staff`. */
  private doStaffUp(uid: string, pid: PlayerId): TycoonNoReason | null {
    const s = this.st.staff.find((x) => x.uid === uid);
    if (!s || !s.instance) return 'invalid';
    return this.doBuy(`upg.${s.instance}.${STAFF_TRACK}`, 1, pid);
  }

  private doStake(uid: string, stake: number): TycoonNoReason | null {
    const s = this.st.staff.find((x) => x.uid === uid);
    if (!s || staffDefOf(s.kind)?.mode !== 'player') return 'invalid';
    s.stake = Math.max(0, Math.floor(num(stake, 0)));
    this.changed();
    return null;
  }

  private doZone(zone: ZoneId, pid: PlayerId): TycoonNoReason | null {
    if (!this.tradeOpenNow()) return 'phase';
    const w = WING_DEFS.find((x) => x.zone === zone);
    if (!w || this.st.zones.includes(zone)) return 'invalid';
    if (w.requires?.shift !== undefined && this.run().night() < w.requires.shift) return 'requires';
    const price = Math.round(w.priceQuotaMult * (this.deps.quotaDue?.() ?? 0));
    if (!this.run().spend('coin', price, 'wing', pid)) return 'funds';
    this.st.zones.push(zone);
    this.st.holdings += price;
    this.changed();
    return null;
  }

  private doName(instance: InstanceId, name: string): boolean {
    const m = this.st.machines[instance];
    if (!m) return false;
    m.name = String(name).trim().slice(0, 16);
    this.changed();
    return true;
  }

  // ── economy: idle income and Shill auto-play (host) ──────────────────────────────────────────────
  /** Staff house rate, coins per minute: `Y × stake × 1.06^capL × income.mult ÷ speed × 0.9` (GDD §3.7.5). */
  private houseRatePerMin(instance: InstanceId, machineId: MachineId): number {
    const y = machineDefOf(machineId)?.idleYield ?? 0;
    if (y <= 0) return 0;
    const run = this.run();
    const stake = run.betLimits(machineId, instance).max;
    const cap = Math.pow(1.06, this.levelOf(instance, 'cap'));
    const speed = Math.max(0.4, run.mod('speed.mult', machineId, 1, { instance }));
    const inc = run.mod('income.mult', machineId, 1, { instance });
    const charm = run.mod('x.tycoon.staffMult', machineId, 1, { instance });
    return (y * stake * cap * inc * charm * 0.9) / speed;
  }

  incomePerSec(): number {
    let perMin = 0;
    for (const s of this.st.staff) {
      if (!s.instance || staffDefOf(s.kind)?.mode !== 'house') continue;
      const mid = this.machineOf(s.instance);
      if (mid) perMin += this.houseRatePerMin(s.instance, mid);
    }
    return perMin / 60;
  }

  /** Fold `base` through ONE instance's tracks only (Shill: no charms, no pit-wide effects). */
  private instanceMod(instance: InstanceId, hook: string, base: number): number {
    const effs = this.mods.instanceEffects(instance).filter((e) => e.hook === hook).map((e) => ({ op: e.op, value: e.value, priority: e.priority }));
    return foldEffects(hook as ModHook, base, effs);
  }

  private playShill(s: StaffState, machineId: MachineId, dtSec: number): void {
    const instance = s.instance;
    if (!instance) return;
    const def = registry.get(machineId)?.def;
    const headless = def?.headless;
    const patron = PATRON_RATE[machineId] ?? 0;
    if (!headless || patron <= 0) return;
    const run = this.run();
    const speed = Math.max(0.4, run.mod('speed.mult', machineId, 1, { instance }));
    const perMin = (0.5 * patron / speed) * (1 + 0.04 * this.levelOf(instance, STAFF_TRACK));
    let acc = (this.playAcc.get(s.uid) ?? 0) + (perMin * dtSec) / 60;
    let plays = 0;
    while (acc >= 1 && plays < SHILL_SKIP_MAX) {
      acc -= 1; plays++;
      const lim = run.betLimits(machineId, instance);
      const seats = 1 + this.levelOf(instance, 'seats');
      const stake = s.stake && s.stake > 0 ? s.stake : Math.max(lim.min, Math.round(lim.max * SHILL_STAKE_FRAC)) * seats;
      if (!run.canAfford(stake, s.owner) || !run.spend('coin', stake, 'shill', s.owner)) { acc = 0; break; }
      const gross = headless(this.rng, stake, {
        luck: this.instanceMod(instance, 'luck', 0),
        mod: (hook, base) => this.instanceMod(instance, hook, base),
      });
      if (gross.gross > 0) run.earn('coin', Math.floor(gross.gross), 'shill', s.owner);
      const own = this.st.machines[instance];
      if (own) { own.stats.rounds++; own.stats.wagered += stake; own.stats.won += gross.gross; }
    }
    this.playAcc.set(s.uid, Math.min(acc, SHILL_SKIP_MAX));
  }

  tick(dtSec: number): void {
    if (!this.deps.isHost() || !(dtSec > 0)) return;
    let house = 0;
    for (const s of this.st.staff) {
      if (!s.instance) continue;
      const mid = this.machineOf(s.instance);
      if (!mid) continue;
      const sd = staffDefOf(s.kind);
      if (!sd) continue;
      if (sd.mode === 'house') house += this.houseRatePerMin(s.instance, mid) * dtSec / 60;
      else this.playShill(s, mid, dtSec);
    }
    this.pendingHouse += house;
    const whole = Math.floor(this.pendingHouse);
    if (whole > 0) {
      this.pendingHouse -= whole;
      this.run().earn('coin', whole, 'idle', this.selfId());
      this.st.idleEarned += whole;
      this.notify();
    }
  }

  catchUp(awayS: number): void {
    if (!this.deps.isHost() || !(awayS > 0)) return;
    const creditedS = Math.min(awayS, AWAY_CAP_S);
    const earned = Math.floor(this.incomePerSec() * creditedS * AWAY_RATE);
    if (earned > 0) {
      this.run().earn('coin', earned, 'idle', this.selfId());
      this.st.idleEarned += earned;
    }
    this.report = { awayS, creditedS, earned, perInstance: {} };
    this.notify();
  }

  takeIdleReport(): IdleReport | null {
    const r = this.report;
    this.report = null;
    return r;
  }

  onDawn(): void {
    this.st.holdings = Math.floor(this.st.holdings * 0.75);
    this.changed();
  }

  // ── prestige: Descend and the Foundations ───────────────────────────────────────────────────────
  private loadMeta(): MetaState {
    const m = this.deps.save?.data.meta ?? defaultMeta();
    return {
      obols: Math.max(0, num(m.obols, 0)), spent: Math.max(0, num(m.spent, 0)),
      nodes: { ...(m.nodes ?? {}) }, descents: Math.max(0, num(m.descents, 0)),
      bestShift: Math.max(0, num(m.bestShift, 0)), bestFloor: Math.max(0, num(m.bestFloor, 0)),
      unlocked: [...(m.unlocked ?? [])],
    };
  }
  private persistMeta(): void {
    const snap: MetaState = { ...this.meta, nodes: { ...this.meta.nodes }, unlocked: [...this.meta.unlocked] };
    this.deps.save?.update((d) => { d.meta = snap; });
  }

  /** Requirement tokens (node ids, `bestShift:N`, `won:N`) are read by `metaReqMissing`, shared with the menu screen. */
  private nodeReqOk(n: MetaNode): boolean {
    return metaReqMissing(this.meta, n) === null;
  }

  recordWin(night: number): boolean {
    const tok = `won:${Math.floor(night)}`;
    if (this.meta.unlocked.includes(tok)) return false;
    this.meta.unlocked.push(tok);
    this.persistMeta();
    this.notify();
    return true;
  }

  private buyNodeReason(id: string, pid: PlayerId): TycoonNoReason | null {
    void pid;
    const n = this.nodes.get(id);
    if (!n) return 'invalid';
    const lv = this.metaLevel(id);
    if (lv >= n.maxLevel) return 'maxed';
    if (!this.nodeReqOk(n)) return 'requires';
    const cost = costAt(n.cost, lv, 'M');
    if (this.meta.obols < cost) return 'funds';
    this.meta.obols -= cost;
    this.meta.spent += cost;
    this.meta.nodes[id] = lv + 1;
    for (const u of n.unlocks ?? []) if (!this.meta.unlocked.includes(u)) this.meta.unlocked.push(u);
    this.persistMeta();
    this.mods.invalidate();
    this.run().mods.touch();
    this.notify();
    return null;
  }

  private makePrestige(): PrestigeApi {
    const self = this;
    return {
      state: () => self.meta,
      preview: () => {
        const dep = Math.max(0, self.deps.deposited?.() ?? 0);
        const edge = Math.max(0, self.deps.houseEdge?.() ?? 0);
        const gain = self.mods.globalFold('x.meta.obolGain', 1);
        const obols = Math.floor(Math.floor(0.6 * Math.cbrt(dep)) * (1 + 0.1 * edge) * gain);
        return { obols, multiplier: gain };
      },
      descend: async (): Promise<void> => {
        if (!self.deps.isHost()) { self.deps.send?.({ op: 'prestige' }); return; }
        const p = self.prestige.preview();
        self.meta.obols += p.obols;
        self.meta.descents += 1;
        self.meta.bestShift = Math.max(self.meta.bestShift, self.deps.shiftIndex?.() ?? 0);
        self.meta.bestFloor = Math.max(self.meta.bestFloor, self.st.floor);
        self.persistMeta();
        bus.emit('tycoon:prestige', { obols: p.obols });
        self.notify();
        await self.deps.onDescend?.();
      },
      buyNode: (id: string): boolean => {
        if (!self.deps.isHost()) { self.deps.send?.({ op: 'meta', node: id }); return !!self.deps.send; }
        return self.buyNodeReason(id, self.selfId()) === null;
      },
      nodes: () => [...self.nodes.values()],
      registerNode: (n: MetaNode): Unsub => {
        self.nodes.set(n.id, n);
        self.mods.invalidate();
        return () => { if (self.nodes.get(n.id) === n) { self.nodes.delete(n.id); self.mods.invalidate(); } };
      },
    };
  }
}

/** Builds the tycoon layer for one run. Register `tycoon.provider` with `run.mods` and call `tick` in Play. */
export function createTycoon(deps: TycoonDeps): Tycoon {
  try {
    return new TycoonImpl(deps);
  } catch (e) {
    log.error('tycoon', 'failed to build the tycoon layer', e);
    throw e;
  }
}
