/**
 * MACHINE MODS (design backlog #7): every machine instance has MOD_SOCKETS (2) sockets. The Ledger's MODS tab (U, then T)
 * sells named mods for a share of the Night's quota (`MOD_DEFS` in `data/upgrades.ts`), and an installed mod stays on its
 * machine for the run. No three, no DOM.
 *
 *   HOT WIRE     Hot lamp ×1.8, Cold lamp ×0.6            (x.lamp.hotMult / x.lamp.coldMult, multiplied)
 *   LUCKY LATCH  luck +2, max bet ×0.8                      (luck, bet.maxMult)
 *   TILT GUARD   two more plays before Tilt                 (x.tilt.grace)
 *   DEEP FEED    Big One jackpot feed 1% → 2.5%, Big One only (x.bigone.jackpotFeed)
 *   BRAKE        rounds 15% faster                          (speed.mult)
 *
 * `MachineMods` is a mod provider (kind 'machine'). For the queried instance it emits ONE source whose effects are the
 * installed mods, each scoped to that instance (and to its machine family when the def names one), so a mod never reaches
 * another machine. The run supplies a `ModsHost`; this file never touches run.ts. `snapshot()` / `restore()` are plain JSON
 * for the run save. Seeded rng only: there is none here, and prices are a pure function of the Night's quota.
 */
import type { InstanceId, MachineId } from '@/core/types';
import type { ModEffect, ModProvider, ModQuery, ModSource } from './modifiers.types';
import { MOD_DEFS, type MachineModDef } from './data/upgrades';

/** Sockets per machine instance. */
export const MOD_SOCKETS = 2;

/** Why a mod cannot be installed now ('' = it can). `funds` is the only reason that depends on the wallet alone. */
export type ModWhy = '' | 'closed' | 'owner' | 'unknown' | 'machine' | 'dup' | 'full' | 'funds';

export interface ModBuy { ok: boolean; why: ModWhy }
export interface ModQuote { price: number; why: ModWhy }

/** What the run provides. Everything is read at call time, so the book follows the run without holding it. */
export interface ModsHost {
  /** The Night's quota due (the price base). */
  quota(): number;
  wallet(): number;
  /** True while the Ledger may trade (the same gate as upgrades). */
  open(): boolean;
  /** The machine family of an owned instance, or null when it is not owned. */
  owns(instance: InstanceId): MachineId | null;
  /** Debit coins. Atomic: false means nothing was charged. */
  spend(coins: number, reason: string): boolean;
  /** `modifiers.touch()` after a change, so the fold caches refresh. */
  touch?(): void;
}

/** Plain JSON: `sockets` maps an instance id to the mod ids installed on it, in install order. */
export interface ModsSnapshot { v: 1; sockets: Record<InstanceId, string[]> }

export function modDef(id: string): MachineModDef | undefined {
  return MOD_DEFS.find((d) => d.id === id);
}

/** A mod's price on this quota: its share, rounded, and never below one coin. */
export function modPrice(def: MachineModDef, quota: number): number {
  return Math.max(1, Math.round(def.share * Math.max(0, quota)));
}

export class MachineMods implements ModProvider {
  readonly kind = 'machine' as const;
  /** Bumped on every change (sockets). The per-instance sources are rebuilt when it moves. */
  rev = 0;
  private readonly sockets = new Map<InstanceId, string[]>();
  private readonly listeners = new Set<() => void>();
  private cache = new Map<InstanceId, ModSource>();
  private cacheRev = -1;

  constructor(private readonly host: ModsHost, snap?: ModsSnapshot | null) {
    if (snap) this.load(snap);
  }

  // ── reads ──
  /** The mod ids installed on `instance`, in install order (empty when none or not socketed). */
  installed(instance: InstanceId): readonly string[] {
    return this.sockets.get(instance) ?? [];
  }

  /** The socket cap (the same for every machine). */
  get socketCap(): number { return MOD_SOCKETS; }

  /** Subscribe to changes (a Ledger repaints). Returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Whether `id` can be installed on `instance` now, and its price. The order of the checks is the order of the reasons. */
  quote(instance: InstanceId, id: string): ModQuote {
    const def = modDef(id);
    const price = def ? modPrice(def, this.host.quota()) : 0;
    if (!this.host.open()) return { price, why: 'closed' };
    const mid = this.host.owns(instance);
    if (!mid) return { price, why: 'owner' };
    if (!def) return { price, why: 'unknown' };
    if (def.machines && !def.machines.includes(mid)) return { price, why: 'machine' };
    const list = this.sockets.get(instance) ?? [];
    if (list.includes(id)) return { price, why: 'dup' };
    if (list.length >= MOD_SOCKETS) return { price, why: 'full' };
    if (this.host.wallet() < price) return { price, why: 'funds' };
    return { price, why: '' };
  }

  // ── writes ──
  /** Install `id` on `instance` for its price. Atomic: nothing changes unless every check passes. */
  buy(instance: InstanceId, id: string): ModBuy {
    const q = this.quote(instance, id);
    if (q.why) return { ok: false, why: q.why };
    if (!this.host.spend(q.price, `mod:${id}:${instance}`)) return { ok: false, why: 'funds' };
    const list = this.sockets.get(instance) ?? [];
    list.push(id);
    this.sockets.set(instance, list);
    this.bump();
    return { ok: true, why: '' };
  }

  // ── provider ──
  collect(q: ModQuery, out: ModSource[]): void {
    if (!q.instance) return;
    const list = this.sockets.get(q.instance);
    if (!list || list.length === 0) return;
    if (this.cacheRev !== this.rev) { this.cache.clear(); this.cacheRev = this.rev; }
    let src = this.cache.get(q.instance);
    if (!src) {
      src = { kind: 'machine', id: `mods:${q.instance}`, owner: q.instance, stacks: 1, effects: this.effectsOf(q.instance, list) };
      this.cache.set(q.instance, src);
    }
    out.push(src);
  }

  private effectsOf(instance: InstanceId, ids: readonly string[]): ModEffect[] {
    const out: ModEffect[] = [];
    for (const id of ids) {
      const def = modDef(id);
      if (!def) continue;
      for (const e of def.effects) {
        out.push({ ...e, scope: { instances: [instance], ...(def.machines ? { machines: def.machines } : {}) } });
      }
    }
    return out;
  }

  // ── save ──
  snapshot(): ModsSnapshot {
    const sockets: Record<InstanceId, string[]> = {};
    for (const [inst, list] of this.sockets) if (list.length) sockets[inst] = [...list];
    return { v: 1, sockets };
  }

  /** Replace every socket from a snapshot (unknown mods and extra sockets are dropped). Does not charge coins. */
  restore(snap: ModsSnapshot | null | undefined): void {
    this.load(snap);
    this.bump();
  }

  private load(snap: ModsSnapshot | null | undefined): void {
    this.sockets.clear();
    if (!snap || snap.v !== 1 || !snap.sockets || typeof snap.sockets !== 'object') return;
    for (const inst of Object.keys(snap.sockets)) {
      const raw = snap.sockets[inst];
      if (!Array.isArray(raw)) continue;
      const keep: string[] = [];
      for (const id of raw) {
        if (typeof id === 'string' && modDef(id) && !keep.includes(id) && keep.length < MOD_SOCKETS) keep.push(id);
      }
      if (keep.length) this.sockets.set(inst, keep);
    }
    this.rev++;
  }

  private bump(): void {
    this.rev++;
    this.host.touch?.();
    for (const fn of this.listeners) fn();
  }
}
