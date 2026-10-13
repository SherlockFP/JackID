/**
 * Totems — physical radius items (BRIEF ADDENDUM 8). Implements `TotemsApi` and is a `ModProvider` (kind 'totem').
 *
 * Lifecycle: `grant` (shop or reward) → carried in hand or backpack → `place(uid, pos)` on the floor → rings the
 * machines and players inside `def.radius` through the modifier pipeline → expires by `durationS`, runs out of
 * `uses`, or is picked up / discarded. Placed totems show a glowing floor ring (items/view.ts).
 *
 * Host-authoritative: mutations run on the host; the net layer replicates `totem:*` bus events to every peer.
 */
import type { InstanceId, PlayerId, Unsub, V3 } from '@/core/types';
import type { ModProvider, ModQuery, ModSource, ModSourceKind, RunApi, TotemDef, TotemProc, TotemState, TotemsApi } from '@/game/types';
import type { Rng } from '@/core/rng';
import { bus } from '@/core/events';
import { log } from '@/core/log';

export interface TotemHost {
  readonly selfId: PlayerId;
  readonly isHost: boolean;
  readonly rng: Rng;
  run(): RunApi;
  now(): number;
  touch(): void;
  /** Co-op: is `b` on `a`'s team (true for a === b)? Solo: identity only. */
  allied(a: PlayerId, b: PlayerId): boolean;
  /** Machine instance position for ring checks on rounds. */
  instancePos(mid: InstanceId): V3 | undefined;
}

/** Placed totems per player. Carried totems are not limited here (the hand/backpack rules apply). */
export const MAX_PLACED_PER_PLAYER = 3;

type ProcFn = (uid: string, proc: TotemProc) => void;

const dist2 = (a: V3, b: V3): number => {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

export class Totems implements TotemsApi, ModProvider {
  readonly kind: ModSourceKind = 'totem';
  private readonly defMap = new Map<string, TotemDef>();
  private items: TotemState[] = [];
  private readonly procFns = new Set<ProcFn>();
  private readonly lastProc = new Map<string, number>();
  private seq = 0;

  constructor(private readonly host: TotemHost) {}

  // ── definitions ───────────────────────────────────────────────────────────────────────────────
  register(def: TotemDef): Unsub {
    this.defMap.set(def.id, def);
    return () => { if (this.defMap.get(def.id) === def) this.defMap.delete(def.id); };
  }
  def(id: string): TotemDef | undefined { return this.defMap.get(id); }
  defs(): TotemDef[] { return [...this.defMap.values()]; }

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  list(): readonly TotemState[] { return this.items; }

  mine(pid: PlayerId = this.host.selfId): readonly TotemState[] {
    return this.items.filter((t) => t.owner === pid);
  }

  grant(pid: PlayerId, defId: string): string | null {
    const def = this.defMap.get(defId);
    if (!def || !this.host.isHost) return null;
    if (def.carry === 'hand' && this.items.some((t) => t.owner === pid && t.pos === null && this.carryOf(t) === 'hand')) {
      log.warnOnce(`totem:hand:${pid}`, 'items', 'only one hand totem at a time');
      return null;
    }
    const uid = `t${pid}-${++this.seq}`;
    this.items.push({ uid, def: defId, owner: pid, pos: null, rotY: 0, carriedBy: pid, placedAt: 0, usesLeft: def.uses });
    this.host.touch();
    return uid;
  }

  place(uid: string, pos: V3, rotY = 0): boolean {
    const t = this.find(uid);
    if (!t || !this.host.isHost || t.pos !== null) return false;
    const def = this.defMap.get(t.def);
    if (!def?.placeable) return false;
    if (this.placedBy(t.owner) >= MAX_PLACED_PER_PLAYER) return false;
    const now = this.host.now();
    t.pos = [pos[0], pos[1], pos[2]];
    t.rotY = rotY;
    t.carriedBy = null;
    t.placedAt = now;
    t.expiresAt = def.durationS && def.durationS > 0 ? now + def.durationS * 1000 : undefined;
    if (t.usesLeft === undefined && def.uses !== undefined) t.usesLeft = def.uses;
    this.host.touch();
    bus.emit('totem:place', { uid, def: t.def, owner: t.owner });
    return true;
  }

  pickup(uid: string): boolean {
    const t = this.find(uid);
    if (!t || t.pos === null || !this.host.isHost) return false;
    t.pos = null;
    t.carriedBy = t.owner;
    this.host.touch();
    bus.emit('totem:pickup', { uid, pid: t.owner });
    return true;
  }

  discard(uid: string): boolean {
    const i = this.items.findIndex((t) => t.uid === uid);
    if (i < 0 || !this.host.isHost) return false;
    this.items.splice(i, 1);
    this.host.touch();
    return true;
  }

  inRadius(pos: V3): readonly TotemState[] {
    return this.items.filter((t) => {
      if (!t.pos) return false;
      const def = this.defMap.get(t.def);
      return !!def && dist2(t.pos, pos) <= def.radius * def.radius;
    });
  }

  onProc(fn: ProcFn): Unsub {
    this.procFns.add(fn);
    return () => { this.procFns.delete(fn); };
  }

  // ── save and resume ───────────────────────────────────────────────────────────────────────────
  /** JSON-safe copy of every owned totem (stored under `resume.ext.totems`). */
  snapshot(): TotemState[] {
    return this.items.map((t) => JSON.parse(JSON.stringify(t)) as TotemState);
  }

  /** Rebuilds the list from a save. Totems whose def is no longer registered are dropped; uid sequence resumes after the highest. */
  restore(list: readonly TotemState[] | null | undefined): void {
    this.items = [];
    this.seq = 0;
    if (Array.isArray(list)) {
      for (const t of list) {
        if (!t || typeof t.uid !== 'string' || !this.defMap.has(t.def)) continue;
        this.items.push(JSON.parse(JSON.stringify(t)) as TotemState);
        const n = Number(t.uid.split('-').pop());
        if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
      }
    }
    this.host.touch();
  }

  // ── lifecycle (driven by the system's tick and bus wiring) ───────────────────────────────────────
  /** Once per frame: expire timed totems. */
  tick(): void {
    if (!this.host.isHost) return;
    const now = this.host.now();
    const before = this.items.length;
    this.items = this.items.filter((t) => t.expiresAt === undefined || now < t.expiresAt);
    if (this.items.length !== before) this.host.touch();
  }

  /**
   * A machine round settled inside the ring of a placed totem: spends `uses` and rolls procs (rewind, jinx …).
   * Ring membership uses the instance position; relation (owner / ally / rival) uses `pid`, the round's player.
   */
  onRound(pid: PlayerId, mid: InstanceId): void {
    if (!this.host.isHost) return;
    const at = this.host.instancePos(mid);
    if (!at) return;
    const now = this.host.now();
    for (const t of [...this.items]) {
      if (!t.pos || !this.relates(t.owner, pid, this.defMap.get(t.def)?.targets)) continue;
      const def = this.defMap.get(t.def);
      if (!def || dist2(t.pos, at) > def.radius * def.radius) continue;
      if (t.usesLeft !== undefined) {
        t.usesLeft -= 1;
        if (t.usesLeft <= 0) {
          this.items.splice(this.items.indexOf(t), 1);
          this.host.touch();
          bus.emit('totem:proc', { uid: t.uid, proc: 'spent' });
          continue;
        }
      }
      for (const proc of def.procs ?? []) {
        const k = `${t.uid}|${proc.id}`;
        const last = this.lastProc.get(k);
        if (last !== undefined && proc.cooldownS && now - last < proc.cooldownS * 1000) continue;
        if (!this.host.rng.chance(proc.chance ?? 1)) continue;
        this.lastProc.set(k, now);
        bus.emit('totem:proc', { uid: t.uid, proc: proc.id });
        for (const fn of this.procFns) fn(t.uid, proc);
      }
    }
  }

  // ── ModProvider ───────────────────────────────────────────────────────────────────────────────
  /** Every placed totem whose relation fits the player contributes its effects, scoped to its ring. */
  collect(q: ModQuery, out: ModSource[]): void {
    const pid = q.pid ?? this.host.selfId;
    for (const t of this.items) {
      if (!t.pos) continue;
      const def = this.defMap.get(t.def);
      if (!def?.effects?.length || !this.relates(t.owner, pid, def.targets)) continue;
      const center = t.pos;
      const effects = def.effects.map((e) => ({ ...e, scope: { ...e.scope, radius: { center, r: def.radius } } }));
      out.push({ kind: 'totem', id: def.id, owner: t.owner, stacks: 1, effects, order: out.length });
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────
  /** `targets`: owner = only the owner · allies = owner + teammates (default) · rivals = not on the owner's team · everyone. */
  private relates(owner: PlayerId, pid: PlayerId, targets: TotemDef['targets'] = 'allies'): boolean {
    const mine = owner === pid;
    const allied = mine || this.host.allied(owner, pid);
    switch (targets) {
      case 'owner': return mine;
      case 'rivals': return !allied;
      case 'everyone': return true;
      case 'allies':
      default: return allied;
    }
  }

  private find(uid: string): TotemState | undefined {
    return this.items.find((t) => t.uid === uid);
  }

  private placedBy(pid: PlayerId): number {
    return this.items.filter((t) => t.owner === pid && t.pos !== null).length;
  }

  private carryOf(t: TotemState): TotemDef['carry'] | undefined {
    return this.defMap.get(t.def)?.carry;
  }
}

