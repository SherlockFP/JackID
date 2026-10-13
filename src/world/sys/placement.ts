/**
 * Slot → machine resolution (WORLD-SYS). TECH_SPEC §5.3 (the resolution rules survive the layout rewrite of §11.2):
 *
 *   mode override → default → null (an empty pad: "FOR LEASE")
 *   1. a machine id the registry does not know          → out-of-order cabinet
 *   2. `def.slotSize` larger than the slot              → warning + out-of-order cabinet
 *   3. `def.modes` excludes the current mode            → out-of-order cabinet
 *   4. (demo hall only, `fill`) registered machines are cycled into the empty slots they fit
 *
 * Pure: no THREE, no DOM — easy to test in Node. Spec-era ids (`coin_flip`, `big_one`) are mapped by `registry.resolve`.
 */
import type { GameMode, InstanceId, MachineId, SlotSize } from '@/core/types';
import { SLOT_SIZES } from '@/core/types';
import type { MachineDef } from '@/machines/_base/types';
import { log } from '@/core/log';
import type { SlotDef } from '../types';

export type Placement =
  | { kind: 'machine'; machineId: MachineId; def: MachineDef }
  | { kind: 'broken'; machineId: MachineId | null; reason: 'unregistered' | 'toBig' | 'mode' }
  | { kind: 'pad' };

/** The slice of the machine registry the resolver needs (injectable for tests). */
export interface MachineLookup {
  resolve(id: MachineId): MachineId | undefined;
  def(id: MachineId): MachineDef | undefined;
  all(): readonly MachineDef[];
}

export interface PlacementInput {
  slots: readonly SlotDef[];
  assign: Partial<Record<InstanceId, MachineId | null>>;
  mode: GameMode;
  lookup: MachineLookup;
  /** Cycle registered machines into empty slots (demo hall while WORLD-ARCH's layout is missing). */
  fill?: boolean;
}

const rank = (s: SlotSize): number => SLOT_SIZES.indexOf(s);
export const fits = (machine: SlotSize, slot: SlotSize): boolean => rank(machine) <= rank(slot);

export function resolvePlacements(inp: PlacementInput): Map<InstanceId, Placement> {
  const out = new Map<InstanceId, Placement>();
  for (const slot of inp.slots) {
    const wanted = inp.assign[slot.id];
    if (wanted === null || wanted === undefined) { out.set(slot.id, { kind: 'pad' }); continue; }
    const id = inp.lookup.resolve(wanted);
    const def = id ? inp.lookup.def(id) : undefined;
    if (!id || !def) { out.set(slot.id, { kind: 'broken', machineId: wanted, reason: 'unregistered' }); continue; }
    if (!fits(def.slotSize, slot.size)) {
      log.warn('world', `${slot.id}: ${id} is ${def.slotSize} but the slot is ${slot.size} — out of order`);
      out.set(slot.id, { kind: 'broken', machineId: id, reason: 'toBig' });
      continue;
    }
    if (def.modes && !def.modes.includes(inp.mode)) { out.set(slot.id, { kind: 'broken', machineId: id, reason: 'mode' }); continue; }
    out.set(slot.id, { kind: 'machine', machineId: id, def });
  }

  if (inp.fill) {
    const pool = inp.lookup.all().filter((d) => !d.modes || d.modes.includes(inp.mode));
    let cursor = 0;
    for (const slot of inp.slots) {
      if (out.get(slot.id)?.kind !== 'pad' || pool.length === 0) continue;
      for (let tries = 0; tries < pool.length; tries++) {
        const def = pool[(cursor + tries) % pool.length];
        if (!fits(def.slotSize, slot.size)) continue;
        out.set(slot.id, { kind: 'machine', machineId: def.id, def });
        cursor = (cursor + tries + 1) % pool.length;
        break;
      }
    }
  }
  return out;
}
