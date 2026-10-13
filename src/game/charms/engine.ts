/**
 * Charm engine: who owns which charm, how owned charms enter the modifier pipeline, how host-side triggers fire, and the
 * Pawn Window roll. Charms are data (`data/charms.ts`) merged with behaviours (`behaviours.ts`); this file owns state.
 */
import type { CharmCtx, CharmDef, CharmState, ModProvider, ModQuery, ModSource, ModSourceKind, RunApi } from '@/game/types';
import type { Json, PlayerId } from '@/core/types';
import type { GameEvents } from '@/core/events';
import { bus } from '@/core/events';
import { registerStrings } from '@/core/i18n';
import type { Rng } from '@/core/rng';
import { CHARM_DATA, LAUNCH_CHARM_IDS, SUIT_SCALED_CHARMS } from '@/game/data/charms';
import { BEHAVIOURS, DYNAMIC_EFFECTS as BASE_DYNAMIC, type DynamicEffects } from './behaviours';
import { ENGINE_BEHAVIOURS, ENGINE_DYNAMIC_EFFECTS } from './engines';
import { CHARM_ENGINE_DATA } from '@/game/data/charmsEngines';
import { rollRarity, type ShopRarity } from '@/game/economy';

/** Per-instant effects: base table plus the engine charms (wave 8). */
const DYNAMIC_EFFECTS: Readonly<Record<string, DynamicEffects>> = { ...BASE_DYNAMIC, ...ENGINE_DYNAMIC_EFFECTS };

/** Charm pegs on the Charm Board: 6 at start, +3 per House Improvement, 9 in run (GDD §4.1). */
export const PEG_CAP_RUN = 9;

/** Definition table with behaviours merged in. Built once. */
const DEFS: ReadonlyMap<string, CharmDef> = new Map(
  [...CHARM_DATA, ...CHARM_ENGINE_DATA].map((d) => [d.id, { ...d, ...BEHAVIOURS[d.id], ...ENGINE_BEHAVIOURS[d.id] }] as const),
);

// Charm names and descriptions → `charm.<id>.name|desc` (check.mjs warns on charm.* keys that do not resolve).
for (const d of DEFS.values()) registerStrings(`charm.${d.id}.`, { en: d.strings.en, tr: d.strings.tr });

export const charmDef = (id: string): CharmDef | undefined => DEFS.get(id);
export const allCharmDefs = (): CharmDef[] => [...DEFS.values()];

/** Read the charm's persistent data bag, creating it if absent. The object is stored on the state (mutations persist). */
function bagOf(state: CharmState): Record<string, Json> {
  const d = state.data;
  if (d && typeof d === 'object' && !Array.isArray(d)) return d;
  const fresh: Record<string, Json> = {};
  state.data = fresh;
  return fresh;
}

export interface CharmHost {
  readonly selfId: PlayerId;
  run(): RunApi;
  rng: Rng;
  /** Invalidate the modifier cache (called on every acquire / remove). */
  touch(): void;
}

export class Charms implements ModProvider {
  readonly kind: ModSourceKind = 'charm';
  private readonly owned = new Map<PlayerId, CharmState[]>();

  constructor(private readonly host: CharmHost) {}

  def(id: string): CharmDef | undefined { return DEFS.get(id); }

  list(pid: PlayerId = this.host.selfId): readonly CharmState[] { return this.owned.get(pid) ?? []; }

  find(pid: PlayerId, id: string): CharmState | undefined { return this.list(pid).find((s) => s.id === id); }

  has(pid: PlayerId, id: string): boolean { return this.find(pid, id) !== undefined; }

  /** Distinct charms held (stacks count once against the pegs). */
  pegsUsed(pid: PlayerId = this.host.selfId): number { return this.list(pid).length; }

  /**
   * Add a charm (or one stack of it when already held and below `maxStacks`). Returns false when unknown, at max
   * stacks, or when no peg is free for a new charm.
   */
  add(pid: PlayerId, id: string, pegs: number): boolean {
    const def = DEFS.get(id);
    if (!def) return false;
    const existing = this.find(pid, id);
    if (existing) {
      if ((existing.stacks ?? 1) >= (def.maxStacks ?? 1)) return false;
      existing.stacks = (existing.stacks ?? 1) + 1;
    } else {
      if (this.pegsUsed(pid) >= pegs) return false;
      const list = this.owned.get(pid) ?? [];
      list.push({ id, stacks: 1 });
      this.owned.set(pid, list);
      bus.emit('charm:add', { pid, charmId: id });
    }
    this.host.touch();
    return true;
  }

  remove(pid: PlayerId, id: string): boolean {
    const list = this.owned.get(pid);
    const i = list?.findIndex((s) => s.id === id) ?? -1;
    if (!list || i < 0) return false;
    list.splice(i, 1);
    this.host.touch();
    bus.emit('charm:remove', { pid, charmId: id });
    return true;
  }

  /** Replace the whole owned set (save restore). Emits nothing. */
  restore(pid: PlayerId, states: readonly CharmState[]): void {
    this.owned.set(pid, states.filter((s) => DEFS.has(s.id)).map((s) => ({ id: s.id, stacks: s.stacks ?? 1, data: s.data })));
    this.host.touch();
  }

  snapshot(): Record<number, CharmState[]> {
    const out: Record<number, CharmState[]> = {};
    for (const [pid, list] of this.owned) out[pid] = list.map((s) => ({ id: s.id, stacks: s.stacks, data: s.data }));
    return out;
  }

  /** Charms of one suit family held by `pid` (stacks count), the charm's own copy included. */
  private suitHeld(pid: PlayerId, suit: string): number {
    let n = 0;
    for (const s of this.owned.get(pid) ?? []) if (DEFS.get(s.id)?.tag === suit) n += s.stacks ?? 1;
    return n;
  }

  /** ModProvider: every owned charm of the queried player contributes its effects (and its code modify, if any). */
  collect(q: ModQuery, out: ModSource[]): void {
    const pid = q.pid ?? this.host.selfId;
    const list = this.owned.get(pid);
    if (!list) return;
    list.forEach((state, order) => {
      const def = DEFS.get(state.id);
      if (!def) return;
      const dyn = DYNAMIC_EFFECTS[state.id];
      // Suit-tag charms scale per same-suit charm held (data: SUIT_SCALED_CHARMS / SUIT_SCALE_STEP).
      const scaled = SUIT_SCALED_CHARMS.has(state.id) && def.tag
        ? (def.effects ?? []).map((e) => ({ ...e, value: e.value * this.suitHeld(pid, def.tag as string) }))
        : (def.effects ?? []);
      const effects = dyn ? [...scaled, ...dyn({ data: bagOf(state), run: this.host.run(), pid }, q)] : scaled;
      const src: ModSource = {
        kind: 'charm', id: state.id, owner: pid, stacks: state.stacks ?? 1, effects, order,
      };
      if (def.modify) {
        const modify = def.modify;
        src.modify = (hook, machineId, value) => modify(hook, machineId, value, this.ctx(pid, state));
      }
      out.push(src);
    });
  }

  /** Fire every owned charm's `on` handler for a bus event (host side). */
  dispatch<K extends keyof GameEvents>(key: K, payload: GameEvents[K]): void {
    for (const pid of this.owned.keys()) {
      for (const state of [...(this.owned.get(pid) ?? [])]) {
        const handler = DEFS.get(state.id)?.on?.[key];
        if (handler) handler(payload, this.ctx(pid, state));
      }
    }
  }

  private ctx(pid: PlayerId, state: CharmState): CharmCtx {
    const id = state.id;
    return {
      pid,
      stacks: state.stacks ?? 1,
      run: this.host.run(),
      rng: this.host.rng.fork(`charm:${id}`),
      proc: () => { bus.emit('charm:proc', { pid, charmId: id }); },
      data: bagOf(state),
    };
  }
}

/**
 * Pawn Window roll (GDD §4.1): three regular slots by rarity odds (no cursed), plus one "under the counter" slot from
 * Night 2 (Rare+ or Cursed, 50/50). Never offers an owned non-stackable charm. `launchOnly` keeps v1.0 content.
 */
export function rollPawnWindow(
  rng: Rng, nightIndex: number, owned: (id: string) => boolean, o: { launchOnly?: boolean; slots?: number } = {},
): CharmDef[] {
  const ok = (d: CharmDef): boolean => !owned(d.id) && (!o.launchOnly || LAUNCH_CHARM_IDS.has(d.id)) && unlockedAt(d, nightIndex);
  const out: CharmDef[] = [];
  const regular = o.slots ?? 3;
  for (let i = 0; i < regular; i++) {
    const rarity: ShopRarity = rollRarity(rng, nightIndex);
    const pool = [...DEFS.values()].filter((d) => d.rarity === rarity && ok(d) && !out.includes(d));
    if (pool.length) out.push(rng.pick(pool));
  }
  if (nightIndex >= 1) {
    const counter = rng.chance(0.5)
      ? [...DEFS.values()].filter((d) => d.rarity === 'cursed' && ok(d))
      : [...DEFS.values()].filter((d) => (d.rarity === 'rare' || d.rarity === 'legendary') && ok(d));
    if (counter.length) out.push(rng.pick(counter));
  }
  return out;
}

/** Night-based unlock gate: 'N<k>' = reached Night k; other codes are gated elsewhere (achievements, wins, falls). */
function unlockedAt(def: CharmDef, nightIndex: number): boolean {
  const u = def.unlock ?? '';
  if (!u) return true;
  const m = /^N(\d+)$/.exec(u);
  return m ? nightIndex + 1 >= Number(m[1]) : false;
}

/** Turn a list of charm ids into the three-choice offer used by overpay rewards (GDD §2.6.5). */
export function choiceOffer(rng: Rng, rarity: CharmDef['rarity'], n: number, owned: (id: string) => boolean): CharmDef[] {
  const pool = [...DEFS.values()].filter((d) => d.rarity === rarity && !owned(d.id) && LAUNCH_CHARM_IDS.has(d.id));
  return rng.shuffle(pool).slice(0, n);
}
