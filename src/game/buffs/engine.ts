/**
 * Buff / debuff engine (BRIEF ADDENDUM 3). Implements `BuffsApi` and is a `ModProvider` (kind 'buff'), so every
 * active buff folds into the same `mod()` pipeline as charms, upgrades and totems.
 *
 * State lives per owner key: 'p:<pid>' (player), 'i:<instance>' (machine), 'team', 'pit'. Stack scaling and fold
 * order are the modifier pipeline's job; this file only keeps stacks, durations and lifecycles.
 * Host-authoritative: `add` is applied on the host only (clients are refused until the net layer relays requests).
 */
import type { PlayerId, InstanceId, Json, Unsub } from '@/core/types';
import type {
  BuffAddOpts, BuffCtx, BuffDef, BuffOwnerKey, BuffScope, BuffState, BuffsApi, ModEffect, ModProvider, ModQuery,
  ModSource, ModSourceKind, RunApi,
} from '@/game/types';
import { bus } from '@/core/events';
import { log } from '@/core/log';

export interface BuffHost {
  readonly selfId: PlayerId;
  /** Host-authoritative apply. Clients get false and the call is dropped. */
  readonly isHost: boolean;
  run(): RunApi;
  /** Host ms (monotonic, replicated clock). */
  now(): number;
  /** Invalidate the modifier cache after any state change. */
  touch(): void;
  /** Players to evaluate player auras for (co-op roster; solo = [selfId]). */
  players(): readonly PlayerId[];
}

type Metric = (pid: PlayerId, mid?: InstanceId) => number;

const AURA_PERIOD_S = 1;

/** Owner key for a def's scope; null when the scope needs a machine and none was given. */
export function ownerKey(scope: BuffScope, pid: PlayerId, mid?: InstanceId): BuffOwnerKey | null {
  switch (scope) {
    case 'player': return `p:${pid}`;
    case 'instance': return mid ? `i:${mid}` : null;
    case 'team': return 'team';
    case 'pit': return 'pit';
  }
}

/** Owner value carried by ModSource / events: the player, the machine instance, or 0 for team and pit. */
function ownerOf(key: BuffOwnerKey): PlayerId | InstanceId {
  if (key.startsWith('p:')) return Number(key.slice(2));
  if (key.startsWith('i:')) return key.slice(2);
  return 0;
}

/** Save shape of the buff store: `[ownerKey, buffs]` pairs. */
export type BuffSave = Array<[BuffOwnerKey, BuffState[]]>;

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Strength multiplier an instance carries in its data (`effectScale`, written by Streaks from a charm hook such as
 * Heat Lamp's `x.overheat.mult`). Absent or invalid means ×1.
 */
function effectScaleOf(st: BuffState): number {
  const d = st.data;
  const k = d && typeof d === 'object' && !Array.isArray(d) ? d.effectScale : undefined;
  return typeof k === 'number' && Number.isFinite(k) && k >= 0 ? k : 1;
}

/** A `mult` effect keeps its direction and scales its distance from ×1 (×1.5 at k=2 is ×2); `add`/`inc` scale linearly. */
function scaleEffect(e: ModEffect, k: number): ModEffect {
  if (k === 1 || e.op === 'set' || e.op === 'min' || e.op === 'max') return e;
  if (e.op === 'mult') return { ...e, value: Math.max(0, 1 + (e.value - 1) * k) };
  return { ...e, value: e.value * k };
}

function dataOf(st: BuffState): Record<string, Json> {
  const d = st.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) return d;
  const fresh: Record<string, Json> = {};
  st.data = fresh;
  return fresh;
}

export class Buffs implements BuffsApi, ModProvider {
  readonly kind: ModSourceKind = 'buff';
  private readonly defMap = new Map<string, BuffDef>();
  private readonly store = new Map<BuffOwnerKey, BuffState[]>();
  private readonly metrics = new Map<string, Metric>();
  private readonly tickAcc = new Map<string, number>();
  private auraAcc = 0;

  constructor(private readonly host: BuffHost) {}

  // ── definitions ───────────────────────────────────────────────────────────────────────────────
  register(def: BuffDef): Unsub {
    this.defMap.set(def.id, def);
    return () => { if (this.defMap.get(def.id) === def) this.defMap.delete(def.id); };
  }
  def(id: string): BuffDef | undefined { return this.defMap.get(id); }
  defs(): BuffDef[] { return [...this.defMap.values()]; }

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  add(id: string, o: BuffAddOpts = {}): void {
    const def = this.defMap.get(id);
    if (!def || !this.host.isHost) return;
    const pid = o.pid ?? this.host.selfId;
    const key = ownerKey(def.scope, pid, o.mid);
    if (!key) { log.warnOnce(`buff:noMid:${id}`, 'buffs', `buff "${id}" is instance-scoped; pass mid`); return; }
    const now = this.host.now();
    const incoming = Math.max(1, Math.min(def.maxStacks, Math.floor(o.stacks ?? 1)));
    const dur = this.durationMs(def, o.durationScale ?? 1);
    const list = this.listOf(key);
    const hit = list.find((b) => b.id === id);

    if (hit) {
      switch (def.reapply ?? 'refresh') {
        case 'ignore': return;
        case 'replace': hit.stacks = incoming; break;
        case 'extend':
          hit.stacks = Math.min(def.maxStacks, hit.stacks + incoming);
          if (dur > 0) hit.expiresAt = Math.max(hit.expiresAt, now) + dur;
          break;
        case 'refresh':
        default:
          hit.stacks = Math.min(def.maxStacks, hit.stacks + incoming);
          if (dur > 0) hit.expiresAt = now + dur;
          break;
      }
      if (def.reapply === 'replace' && dur > 0) hit.expiresAt = now + dur;
      this.host.touch();
      bus.emit('buff:add', { owner: key, buff: hit });
      return;
    }

    const st: BuffState = {
      id, stacks: incoming, source: o.source ?? { kind: 'system' }, startedAt: now,
      expiresAt: dur > 0 ? now + dur : 0, data: { total: dur, ...(o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? o.data : {}) },
    };
    const d = def.duration;
    if (d.kind === 'plays') st.playsLeft = d.n;
    if (d.kind === 'wins') st.winsLeft = d.n;
    if (d.kind === 'shifts') st.shiftsLeft = d.n;
    list.push(st);
    this.host.touch();
    bus.emit('buff:add', { owner: key, buff: st });
    def.on?.add?.(this.ctx(key, st));
  }

  remove(id: string, o: { pid?: PlayerId; mid?: InstanceId; all?: boolean } = {}): void {
    if (!this.host.isHost) return;
    const keys = o.all ? [...this.store.keys()] : this.candidateKeys(o.pid, o.mid);
    for (const key of keys) {
      const st = this.store.get(key)?.find((b) => b.id === id);
      if (st) this.removeState(key, st);
    }
  }

  cleanse(tag: string, o: { pid?: PlayerId } = {}): number {
    if (!this.host.isHost) return 0;
    let n = 0;
    const keys = o.pid === undefined ? [...this.store.keys()] : this.candidateKeys(o.pid);
    for (const key of keys) {
      for (const st of [...(this.store.get(key) ?? [])]) {
        if (this.defMap.get(st.id)?.tags?.includes(tag)) { this.removeState(key, st); n++; }
      }
    }
    return n;
  }

  has(id: string, o: { pid?: PlayerId; mid?: InstanceId } = {}): boolean {
    return this.list(o).some((b) => b.id === id);
  }

  stacks(id: string, o: { pid?: PlayerId; mid?: InstanceId } = {}): number {
    return this.list(o).reduce((sum, b) => (b.id === id ? sum + b.stacks : sum), 0);
  }

  list(o: { pid?: PlayerId; mid?: InstanceId } = {}): readonly BuffState[] {
    const out: BuffState[] = [];
    for (const key of this.candidateKeys(o.pid, o.mid)) {
      const list = this.store.get(key);
      if (list) out.push(...list);
    }
    // buffs before debuffs, then by id: a stable HUD order
    return out.sort((a, b) => {
      const ka = this.defMap.get(a.id)?.kind === 'debuff' ? 1 : 0;
      const kb = this.defMap.get(b.id)?.kind === 'debuff' ? 1 : 0;
      return ka - kb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  registerMetric(name: string, fn: Metric): Unsub {
    this.metrics.set(name, fn);
    return () => { if (this.metrics.get(name) === fn) this.metrics.delete(name); };
  }

  remaining(s: BuffState): number {
    const d = this.defMap.get(s.id)?.duration;
    if (s.expiresAt > 0) {
      const total = typeof s.data === 'object' && s.data && !Array.isArray(s.data) && typeof s.data.total === 'number' ? s.data.total : 0;
      if (total > 0) return Math.max(0, Math.min(1, (s.expiresAt - this.host.now()) / total));
    }
    if (d?.kind === 'plays' && s.playsLeft !== undefined) return Math.max(0, Math.min(1, s.playsLeft / d.n));
    if (d?.kind === 'wins' && s.winsLeft !== undefined) return Math.max(0, Math.min(1, s.winsLeft / d.n));
    return 1;
  }

  // ── lifecycle (driven by the system's tick and bus wiring in index.ts) ─────────────────────────
  /** Once per frame with real seconds: expiry, `while` conditions, `tickEvery` hooks and proximity auras. */
  tick(dt: number): void {
    if (!this.host.isHost) return;
    const now = this.host.now();
    for (const [key, list] of this.store) {
      for (const st of [...list]) {
        const def = this.defMap.get(st.id);
        if (!def) continue;
        const pid = key.startsWith('p:') ? Number(key.slice(2)) : this.host.selfId;
        const mid = key.startsWith('i:') ? key.slice(2) : undefined;
        let dead = st.expiresAt > 0 && now >= st.expiresAt;
        if (def.duration.kind === 'while') dead = !this.holds(def.duration.cond, pid, mid);
        if (dead) { this.removeState(key, st); continue; }
        if (def.tickEvery && def.on?.tick) {
          const k = `${key}|${st.id}`;
          const acc = (this.tickAcc.get(k) ?? 0) + dt;
          if (acc >= def.tickEvery) { this.tickAcc.set(k, acc - def.tickEvery); def.on.tick(this.ctx(key, st), def.tickEvery); }
          else this.tickAcc.set(k, acc);
        }
      }
    }
    this.auraAcc += dt;
    if (this.auraAcc >= AURA_PERIOD_S) { this.auraAcc = 0; this.evalAuras(); }
  }

  /** A machine round was played by `pid` on `mid`: spends `plays` durations. */
  onRound(pid: PlayerId, mid: InstanceId): void {
    this.spend([`p:${pid}`, `i:${mid}`], 'plays');
  }

  /** A round settled: spends `wins` durations when `won`. */
  onResult(pid: PlayerId, mid: InstanceId, won: boolean): void {
    if (won) this.spend([`p:${pid}`, `i:${mid}`], 'wins');
  }

  /** The shift ended: `shift` buffs expire, `shifts` buffs lose one. */
  onShiftEnd(): void {
    for (const [key, list] of this.store) {
      for (const st of [...list]) {
        const d = this.defMap.get(st.id)?.duration;
        if (d?.kind === 'shift') this.removeState(key, st);
        else if (d?.kind === 'shifts' && st.shiftsLeft !== undefined) {
          st.shiftsLeft -= 1;
          if (st.shiftsLeft <= 0) this.removeState(key, st);
        }
      }
    }
  }

  // ── save and resume ───────────────────────────────────────────────────────────────────────────
  /** JSON-safe copy of every owner key with its buffs (stored under `resume.ext.buffs`). */
  snapshot(): BuffSave {
    return [...this.store].map(([key, list]) => [key, list.map((st) => cloneJson(st))]);
  }

  /** Rebuilds the store from a save. Buffs whose def is no longer registered are dropped. Does not re-run `on.add`. */
  restore(s: BuffSave | null | undefined): void {
    this.store.clear();
    this.tickAcc.clear();
    if (Array.isArray(s)) {
      for (const entry of s) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, list] = entry;
        if (typeof key !== 'string' || !Array.isArray(list)) continue;
        const kept = (list as BuffState[])
          .filter((st) => !!st && typeof st.id === 'string' && this.defMap.has(st.id))
          .map((st) => cloneJson(st));
        if (kept.length) this.store.set(key as BuffOwnerKey, kept);
      }
    }
    this.host.touch();
  }

  // ── ModProvider ───────────────────────────────────────────────────────────────────────────────
  /** Every buff on the queried player, team, pit and (when given) machine contributes its effects. */
  collect(q: ModQuery, out: ModSource[]): void {
    const pid = q.pid ?? this.host.selfId;
    const keys: BuffOwnerKey[] = [`p:${pid}`, 'team', 'pit'];
    if (q.instance) keys.push(`i:${q.instance}`);
    for (const key of keys) {
      const list = this.store.get(key);
      if (!list) continue;
      for (const st of list) {
        const def = this.defMap.get(st.id);
        if (!def?.effects?.length) continue;
        const inst = key.startsWith('i:') ? q.instance : undefined;
        const k = effectScaleOf(st);
        const scaled = k === 1 ? def.effects : def.effects.map((e) => scaleEffect(e, k));
        const effects: ModEffect[] = inst
          ? scaled.map((e) => ({ ...e, scope: { ...e.scope, instances: [inst] } }))
          : scaled;
        out.push({ kind: 'buff', id: def.id, owner: ownerOf(key), stacks: st.stacks, effects, order: out.length });
      }
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────
  /** Candidate owner keys for a query: the player, team, pit and (optionally) the machine. */
  private candidateKeys(pid?: PlayerId, mid?: InstanceId): BuffOwnerKey[] {
    const p = pid ?? this.host.selfId;
    const keys: BuffOwnerKey[] = [`p:${p}`, 'team', 'pit'];
    if (mid) keys.push(`i:${mid}`);
    return keys;
  }

  private listOf(key: BuffOwnerKey): BuffState[] {
    let list = this.store.get(key);
    if (!list) { list = []; this.store.set(key, list); }
    return list;
  }

  private durationMs(def: BuffDef, scale: number): number {
    const d = def.duration;
    if (d.kind === 'seconds') return d.s > 0 ? d.s * 1000 * scale : 0;
    return 0;
  }

  private ctx(key: BuffOwnerKey, st: BuffState): BuffCtx {
    return {
      owner: ownerOf(key),
      stacks: st.stacks,
      data: dataOf(st),
      remove: () => this.removeState(key, st),
    };
  }

  private removeState(key: BuffOwnerKey, st: BuffState): void {
    const list = this.store.get(key);
    const i = list?.indexOf(st) ?? -1;
    if (!list || i < 0) return;
    const def = this.defMap.get(st.id);
    def?.on?.remove?.(this.ctx(key, st));
    list.splice(i, 1);
    if (list.length === 0) this.store.delete(key);
    this.tickAcc.delete(`${key}|${st.id}`);
    this.host.touch();
    bus.emit('buff:remove', { owner: key, id: st.id });
  }

  private spend(keys: BuffOwnerKey[], what: 'plays' | 'wins'): void {
    if (!this.host.isHost) return;
    for (const key of keys) {
      for (const st of [...(this.store.get(key) ?? [])]) {
        const d = this.defMap.get(st.id)?.duration;
        if (what === 'plays' && d?.kind === 'plays' && st.playsLeft !== undefined) {
          st.playsLeft -= 1;
          if (st.playsLeft <= 0) this.removeState(key, st);
        } else if (what === 'wins' && d?.kind === 'wins' && st.winsLeft !== undefined) {
          st.winsLeft -= 1;
          if (st.winsLeft <= 0) this.removeState(key, st);
        }
      }
    }
  }

  private holds(cond: { metric: string; cmp: string; value: number }, pid: PlayerId, mid?: InstanceId): boolean {
    const v = this.metric(cond.metric, pid, mid);
    switch (cond.cmp) {
      case '>=': return v >= cond.value;
      case '>': return v > cond.value;
      case '<=': return v <= cond.value;
      case '<': return v < cond.value;
      default: return v === cond.value;
    }
  }

  private metric(name: string, pid: PlayerId, mid?: InstanceId): number {
    const fn = this.metrics.get(name);
    return fn ? fn(pid, mid) : 0;
  }

  /** Proximity auras: `needs` maps to the metric `<needs>.near` (count of allies near `pid`). */
  private evalAuras(): void {
    for (const def of this.defMap.values()) {
      if (!def.aura) continue;
      const a = def.aura;
      for (const pid of this.host.players()) {
        const n = this.metric(`${a.needs}.near`, pid);
        if (n > 0) this.add(def.id, { pid, stacks: a.perUnit ? Math.floor(n) : 1, source: { kind: 'aura' } });
        else this.remove(def.id, { pid });
      }
    }
  }
}
