/**
 * Machine registry (base-machines WP). Contract: TECH_SPEC §3.5. Auto-discovers `src/machines/<id>/index.ts`
 * (eager glob) — there is NO shared list to edit; a folder without a valid `index.ts` is simply absent
 * (its slots show `kit.outOfOrder`). Never create `_base/index.ts`.
 */
import type { MachineId } from '@/core/types';
import { registerStrings } from '@/core/i18n';
import { log } from '@/core/log';
import { SLOT_DIMS, type MachineDef, type MachineModule } from './types';

const mods = import.meta.glob<MachineModule>('../*/index.ts', { eager: true });
const table = new Map<MachineId, MachineModule>();
/** Dev-only machines that live outside `src/machines/<id>/` (the bench reference table). Never listed by `all()` / `ids()`. */
const extra = new Map<MachineId, MachineModule>();

/** Returns human-readable problems; empty = valid. */
export function validateDef(def: MachineDef | undefined, folder: string): string[] {
  const errs: string[] = [];
  if (!def) return ['missing `export const def`'];
  if (def.id !== folder) errs.push(`def.id "${def.id}" !== folder "${folder}"`);
  if (!/^[a-z][a-z0-9_]*$/.test(folder)) errs.push('folder/id must be lower-case letters, digits and underscores');
  if (!SLOT_DIMS[def.slotSize]) errs.push(`bad slotSize "${def.slotSize}"`);
  if (!def.strings?.en?.name || !def.strings?.en?.desc) errs.push('strings.en needs name + desc');
  if (!def.strings?.tr?.name || !def.strings?.tr?.desc) errs.push('strings.tr needs name + desc');
  if (def.seats < 1 || def.seats > 8) errs.push('seats must be 1..8');
  if (def.seats > 1 && !def.shared) errs.push('seats > 1 requires shared: true');
  if (def.party && (!def.shared || def.party.maxPlayers > def.seats || def.party.minPlayers < 2)) errs.push('bad party config');
  if (def.maxBet < def.minBet) errs.push('maxBet < minBet');
  return errs;
}

/** Load + validate every machine module and merge its strings (boot step 8). Idempotent. */
export function load(): void {
  table.clear();
  for (const [path, mod] of Object.entries(mods)) {
    const folder = path.split('/')[1];
    if (folder.startsWith('_')) continue;
    const errs = validateDef(mod.def, folder);
    if (errs.length || typeof mod.default !== 'function') {
      log.error('registry', `invalid machine in ${path}: ${errs.join('; ') || 'no default export class'}`);
      continue;
    }
    registerStrings(`m.${folder}.`, mod.def.strings);
    table.set(folder, mod);
  }
  log.info('registry', `${table.size} machine(s) registered`);
}

/** Register a machine that is only reachable through `get()` / `resolve()` (`/?bench=demotable`); merges its strings. */
export function registerExtra(mod: MachineModule): void {
  const errs = validateDef(mod.def, mod.def?.id);
  if (errs.length) { log.error('registry', `invalid extra machine: ${errs.join('; ')}`); return; }
  registerStrings(`m.${mod.def.id}.`, mod.def.strings);
  extra.set(mod.def.id, mod);
}

export const get = (id: MachineId): MachineModule | undefined => table.get(id) ?? extra.get(id);
export const all = (): MachineModule[] => [...table.values()];
export const ids = (): MachineId[] => [...table.keys()];

/** Spec-era (TECH_SPEC v1.0 / ART) ids → catalogue ids (§11.1). Only those that differ by more than underscores. */
const LEGACY: Record<string, MachineId> = {
  crash_cable: 'elevator', crash_elevator: 'elevator', scratch_vend: 'scratch', peg_drop: 'plinko', light_ring: 'cyclone',
  tower_stack: 'stacker', claw_crane: 'claw', rat_derby: 'derby', devils_table: 'devilstable', revolver: 'devilstable',
  money_wheel: 'bigsix', big_six: 'bigsix', dragon_tiger: 'cardwar', hi_lo: 'hilo',
};
const squash = (id: string): string => id.replace(/_/g, '');

/**
 * Find a machine id the registry knows from a possibly spec-era / differently-spelled one
 * (`coinflip` ⇄ `coin_flip`, `big_one` → `bigone`, `crash_cable` → `elevator`). Used by `?bench=`.
 */
export function resolve(id: MachineId): MachineId | undefined {
  if (table.has(id) || extra.has(id)) return id;
  const legacy = LEGACY[id];
  if (legacy && (table.has(legacy) || extra.has(legacy))) return legacy;
  const want = squash(legacy ?? id);
  for (const k of [...table.keys(), ...extra.keys()]) if (squash(k) === want) return k;
  return undefined;
}
