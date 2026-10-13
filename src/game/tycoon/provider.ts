/**
 * Modifier provider for the tycoon layer (GAME-TYCOON). Registered once with `run.mods` (`Mods.register`), it turns
 * every purchased upgrade level, pit-wide House Improvement and Foundations node into {@link ModSource}s.
 * Instance sources are emitted only for the queried instance; global sources always. The caches are rebuilt
 * lazily after `invalidate()`, so the hot `mod()` path does no allocation beyond the output array.
 */
import type { InstanceId, MachineId } from '@/core/types';
import type { ModEffect, ModProvider, ModSource, ModQuery, ModHook } from '@/game/modifiers.types';
import { foldEffects, stackedValue } from '@/game/modifiers.types';
import { valueAt, type MetaNode, type UpgradeTemplate } from '@/game/tycoon.types';
import type { Catalog } from './catalog';

/** What the provider needs from the tycoon state, read at rebuild time. */
export interface ProviderHost {
  readonly catalog: Catalog;
  levels(): Readonly<Record<string, number>>;
  /** Every placed machine that can hold tracks (owned + pre-placed). */
  instances(): ReadonlyArray<{ instance: InstanceId; machineId: MachineId }>;
  metaNodes(): ReadonlyArray<{ node: MetaNode; level: number }>;
}

/** Track templates that are pit-wide (scope 'global'). */
function isGlobal(t: UpgradeTemplate): boolean { return t.scope === 'global'; }

export class TycoonMods implements ModProvider {
  readonly kind = 'upgrade' as const;
  private dirty = true;
  private global: ModSource[] = [];
  private perInstance = new Map<InstanceId, ModSource[]>();

  constructor(private readonly host: ProviderHost) {}

  /** Call on every change to levels, owned machines or Foundations. */
  invalidate(): void { this.dirty = true; }

  collect(q: ModQuery, out: ModSource[]): void {
    if (this.dirty) this.rebuild();
    for (const s of this.global) out.push(s);
    if (q.instance) {
      const list = this.perInstance.get(q.instance);
      if (list) for (const s of list) out.push(s);
    }
  }

  /** Effects of ONE instance's tracks only (no charms, no pit-wide sources). Used by Shill auto-play. */
  instanceEffects(instance: InstanceId): ModEffect[] {
    if (this.dirty) this.rebuild();
    const out: ModEffect[] = [];
    for (const s of this.perInstance.get(instance) ?? []) out.push(...s.effects);
    return out;
  }

  /** Fold `base` through the pit-wide sources (House Improvements + Foundations) for one hook. */
  globalFold(hook: ModHook, base: number): number {
    if (this.dirty) this.rebuild();
    const effs: Array<{ op: ModEffect['op']; value: number; priority?: number }> = [];
    for (const s of this.global) for (const e of s.effects) if (e.hook === hook) effs.push({ op: e.op, value: stackedValue(e, s.stacks ?? 1), priority: e.priority });
    return foldEffects(hook, base, effs);
  }

  private rebuild(): void {
    this.dirty = false;
    const levels = this.host.levels();
    const catalog = this.host.catalog;
    const global: ModSource[] = [];

    for (const t of catalog.templates()) {
      if (!isGlobal(t)) continue;
      const def = catalog.def(`upg.global.${t.id}`) ?? catalog.defsFor({ scope: 'global' }).find((d) => d.track === t.id);
      const level = def ? levels[def.id] ?? 0 : 0;
      if (def && level > 0) global.push({ kind: 'upgrade', id: def.id, owner: 0, effects: def.effectsAt(level) });
    }
    for (const { node, level } of this.host.metaNodes()) {
      if (level <= 0) continue;
      const effects: ModEffect[] = [];
      for (const e of node.effects ?? []) effects.push({ hook: e.hook, op: e.op, value: valueAt(e.value, level) });
      if (effects.length) global.push({ kind: 'prestige', id: node.id, owner: 0, effects });
    }

    const perInstance = new Map<InstanceId, ModSource[]>();
    for (const { instance, machineId } of this.host.instances()) {
      const list: ModSource[] = [];
      for (const d of catalog.defsFor({ scope: 'instance', instance, machineId })) {
        const level = levels[d.id] ?? 0;
        if (level > 0) list.push({ kind: 'upgrade', id: d.id, owner: instance, effects: d.effectsAt(level) });
      }
      if (list.length) perInstance.set(instance, list);
    }
    this.global = global;
    this.perInstance = perInstance;
  }
}
