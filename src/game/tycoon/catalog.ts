/**
 * Upgrade catalog (GAME-TYCOON): expands the data templates × machines × levels into {@link UpgradeDef}s lazily.
 * Pure: no three, kit or DOM. Machines are read from the registry (`registry.get`), so every newly registered
 * device is automatically upgradeable. Defs are memoised per target and rebuilt when a template changes.
 */
import type { MachineId, InstanceId, SlotSize } from '@/core/types';
import type { MachineDef } from '@/machines/_base/types';
import * as registry from '@/machines/_base/registry';
import type { ModEffect, ModScope } from '@/game/modifiers.types';
import {
  costAt, valueAt, type MachineFilter, type MilestoneDef, type UpgradeCatalog, type UpgradeDef, type UpgradeTarget,
  type UpgradeTemplate,
} from '@/game/tycoon.types';
import { ALL_TEMPLATES, DEVICE_TIER, STAFF_TRACK, familyMilestones } from '@/game/data/upgrades';

/** A generated def that also exposes its resolved milestone list (for visuals and ledger rows). */
export interface TycoonDef extends UpgradeDef {
  readonly milestones: readonly MilestoneDef[];
}

/** Stable id of a generated upgrade: `upg.<instance>.<track>`, `upg.<machineId>.<track>` or `upg.global.<track>`. */
export function upgradeId(target: UpgradeTarget, track: string): string {
  if (target.scope === 'global') return `upg.global.${track}`;
  if (target.scope === 'type') return `upg.${target.machineId}.${track}`;
  return `upg.${target.instance}.${track}`;
}

/** Size rank for the "a slot accepts its class or any smaller one" rule. */
export const SIZE_RANK: Record<SlotSize, number> = { S: 0, M: 1, L: 2, XL: 3 };
export function sizeFits(device: SlotSize, slot: SlotSize): boolean {
  return SIZE_RANK[device] <= SIZE_RANK[slot];
}

export function machineDefOf(machineId: MachineId): MachineDef | undefined {
  return registry.get(machineId)?.def;
}

/** Whether a machine matches a filter (all present fields must match; `exclude` wins). */
export function filterMatches(f: MachineFilter | undefined, machineId: MachineId, def: MachineDef | undefined): boolean {
  if (!f) return true;
  if (f.exclude?.includes(machineId)) return false;
  if (f.ids && !f.ids.includes(machineId)) return false;
  if (f.categories && (!def || !f.categories.includes(def.category))) return false;
  if (f.tags && !(def?.tags && f.tags.some((t) => def.tags!.includes(t)))) return false;
  if (f.sizes && (!def || !f.sizes.includes(def.slotSize))) return false;
  if (f.tiers && !f.tiers.includes(DEVICE_TIER[machineId] ?? 1)) return false;
  return true;
}

/** Whether a track applies to a machine id. System devices never get tracks. */
export function trackApplies(t: UpgradeTemplate, machineId: MachineId): boolean {
  const def = machineDefOf(machineId);
  if (!def || def.category === 'system') return false;
  if (t.id === STAFF_TRACK && !((def.idleYield ?? 0) > 0)) return false;
  return filterMatches(t.appliesTo, machineId, def);
}

/** Milestones of a template for one machine: device families use their own ladder, others the template table. */
export function milestonesFor(t: UpgradeTemplate, machineId: MachineId): MilestoneDef[] {
  let at: MilestoneDef[] = [];
  if (t.id === 'payout') at = familyMilestones(machineId);
  else {
    const def = machineDefOf(machineId);
    const hit = t.milestones?.find((m) => filterMatches(m.filter, machineId, def));
    at = hit ? [...hit.at] : [];
  }
  return at.sort((a, b) => a.level - b.level);
}

function scopeFor(target: UpgradeTarget, base?: ModScope): ModScope | undefined {
  if (target.scope === 'instance') return { ...(base ?? {}), instances: [target.instance] };
  if (target.scope === 'type') return { ...(base ?? {}), machines: [target.machineId] };
  return base;
}

function targetKey(t: UpgradeTarget): string {
  return t.scope === 'global' ? 'g' : t.scope === 'type' ? `t:${t.machineId}` : `i:${t.instance}`;
}

function buildDef(t: UpgradeTemplate, target: UpgradeTarget): TycoonDef {
  const machineId: MachineId = target.scope === 'global' ? '' : target.scope === 'type' ? target.machineId : target.machineId;
  const size: SlotSize = machineDefOf(machineId)?.slotSize ?? 'M';
  const tierIdx = Math.max(0, (DEVICE_TIER[machineId] ?? 1) - 1);
  const milestones = target.scope === 'global' ? [] : milestonesFor(t, machineId);
  const id = upgradeId(target, t.id);

  const def: TycoonDef = {
    id,
    track: t.id,
    template: t,
    target,
    maxLevel: t.maxLevel,
    milestones,
    costOf: (level: number, discount = 0): number => Math.max(1, Math.round(costAt(t.cost, level, size, tierIdx, discount))),
    effectsAt(level: number): ModEffect[] {
      if (level <= 0) return [];
      const out: ModEffect[] = [];
      for (const e of t.effects) {
        out.push({ hook: e.hook, op: e.op, value: valueAt(e.value, level), scope: scopeFor(target, e.scope) });
      }
      for (const m of milestones) {
        if (m.level > level) break;
        for (const eff of m.effects ?? []) out.push({ ...eff, scope: scopeFor(target, eff.scope) });
      }
      return out;
    },
    featuresAt(level: number): string[] {
      const out: string[] = [];
      for (const m of milestones) if (m.level <= level && m.feature) out.push(m.feature);
      return out;
    },
    nextMilestone(level: number): MilestoneDef | null {
      return milestones.find((m) => m.level > level) ?? null;
    },
  };
  return def;
}

/**
 * The catalogue. Templates may be registered at runtime (charms or events can add tracks); the memo is
 * dropped whenever the template set changes.
 */
export class Catalog implements UpgradeCatalog {
  private readonly tpls = new Map<string, UpgradeTemplate>();
  private readonly memo = new Map<string, readonly TycoonDef[]>();
  private readonly owners = new Map<InstanceId, MachineId>();
  private readonly byId = new Map<string, TycoonDef>();

  constructor(templates: readonly UpgradeTemplate[] = ALL_TEMPLATES) {
    for (const t of templates) this.tpls.set(t.id, t);
  }

  registerTemplate(t: UpgradeTemplate): () => void {
    this.tpls.set(t.id, t);
    this.reset();
    return () => {
      if (this.tpls.get(t.id) === t) { this.tpls.delete(t.id); this.reset(); }
    };
  }

  templates(): readonly UpgradeTemplate[] { return [...this.tpls.values()]; }

  /** The tycoon layer tells the catalogue which machine an instance holds, so `def(id)` can resolve it. */
  bind(instance: InstanceId, machineId: MachineId): void {
    if (this.owners.get(instance) === machineId) return;
    this.owners.set(instance, machineId);
    this.memo.delete(targetKey({ scope: 'instance', instance, machineId }));
  }
  unbind(instance: InstanceId): void {
    this.owners.delete(instance);
    for (const k of [...this.memo.keys()]) if (k === `i:${instance}`) this.memo.delete(k);
  }
  boundMachine(instance: InstanceId): MachineId | undefined { return this.owners.get(instance); }

  defsFor(target: UpgradeTarget): readonly UpgradeDef[] {
    const key = targetKey(target);
    const hit = this.memo.get(key);
    if (hit) return hit;
    const out: TycoonDef[] = [];
    for (const t of this.tpls.values()) {
      if (t.scope !== target.scope) continue;
      if (target.scope === 'instance' && !trackApplies(t, target.machineId)) continue;
      if (target.scope === 'type' && !trackApplies(t, target.machineId)) continue;
      const d = buildDef(t, target);
      out.push(d);
      this.byId.set(d.id, d);
    }
    this.memo.set(key, out);
    return out;
  }

  def(id: string): UpgradeDef | undefined {
    const hit = this.byId.get(id);
    if (hit) return hit;
    if (id.startsWith('upg.global.')) {
      return this.defsFor({ scope: 'global' }).find((d) => d.id === id);
    }
    const cut = id.lastIndexOf('.');
    if (!id.startsWith('upg.') || cut < 5) return undefined;
    const owner = id.slice(4, cut);
    const machineId = this.owners.get(owner);
    if (machineId === undefined) return undefined;
    return this.defsFor({ scope: 'instance', instance: owner, machineId }).find((d) => d.id === id);
  }

  count(): number {
    let n = 0;
    const ids = registry.ids();
    for (const t of this.tpls.values()) {
      if (t.scope === 'global') n += t.maxLevel;
      else if (t.scope === 'instance') for (const m of ids) if (trackApplies(t, m)) n += t.maxLevel;
    }
    return n;
  }

  private reset(): void {
    this.memo.clear();
    this.byId.clear();
  }
}

export function createCatalog(templates?: readonly UpgradeTemplate[]): Catalog {
  return new Catalog(templates);
}
