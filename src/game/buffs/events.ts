/**
 * Nightly / global events (BRIEF ADDENDUM 5 "Nightly random events", ADDENDUM 3 "global events").
 * Implements `NightEventsApi` and is a `ModProvider` (kind 'event', owner 0 = the pit). World look (lights, fog,
 * dread) is read from `def.world` by the World layer; machines never special-case an event.
 * Each Bell the host calls `roll()`; events never overlap inside one `exclusive` group.
 */
import type { PlayerId, Unsub } from '@/core/types';
import type { ActiveEvent, ModProvider, ModQuery, ModSource, ModSourceKind, NightEventDef, NightEventsApi, RunApi } from '@/game/types';
import type { Rng } from '@/core/rng';
import { bus } from '@/core/events';

export interface EventHost {
  readonly selfId: PlayerId;
  readonly isHost: boolean;
  run(): RunApi;
  rng: Rng;
  now(): number;
  touch(): void;
}

const DEFAULT_CHANCE = 0.35;

export class NightEvents implements NightEventsApi, ModProvider {
  readonly kind: ModSourceKind = 'event';
  private readonly defMap = new Map<string, NightEventDef>();
  private live: ActiveEvent[] = [];
  private chanceP = DEFAULT_CHANCE;

  constructor(private readonly host: EventHost) {}

  register(def: NightEventDef): Unsub {
    this.defMap.set(def.id, def);
    return () => { if (this.defMap.get(def.id) === def) this.defMap.delete(def.id); };
  }
  defs(): NightEventDef[] { return [...this.defMap.values()]; }
  def(id: string): NightEventDef | undefined { return this.defMap.get(id); }
  active(): readonly ActiveEvent[] { return this.live; }
  isActive(id: string): boolean { return this.live.some((e) => e.id === id); }
  chance(): number { return this.chanceP; }

  /** Tuning hook for the shift director: probability that the next Bell starts an event. */
  setChance(p: number): void { this.chanceP = Math.max(0, Math.min(1, p)); }

  /** Host: start an event now (scripted beats, debug). Replaces an active event of the same exclusive group. */
  trigger(id: string, o: { durationS?: number } = {}): void {
    const def = this.defMap.get(id);
    if (!def || !this.host.isHost) return;
    if (this.isActive(id)) return;
    const group = def.exclusive;
    if (group) for (const e of [...this.live]) if (this.defMap.get(e.id)?.exclusive === group) this.end(e.id);
    const now = this.host.now();
    const secs = o.durationS ?? (typeof def.duration === 'number' ? def.duration : 0);
    const ev: ActiveEvent = { id, startedAt: now, endsAt: secs > 0 ? now + secs * 1000 : 0, seed: this.host.rng.int(1, 0x7fffffff) };
    this.live.push(ev);
    this.host.touch();
    bus.emit('event:start', { id });
  }

  end(id: string): void {
    const i = this.live.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.live.splice(i, 1);
    this.host.touch();
    bus.emit('event:end', { id });
  }

  /** Host, once per Bell: roll the nightly event. Returns the started event id, or null. */
  roll(): string | null {
    if (!this.host.isHost || !this.host.rng.chance(this.chanceP)) return null;
    const night = this.host.run().night() + 1;
    const pool = [...this.defMap.values()].filter((d) =>
      (d.minShift === undefined || night >= d.minShift)
      && (d.maxShift === undefined || night <= d.maxShift)
      && !this.isActive(d.id)
      && !(d.exclusive && this.live.some((e) => this.defMap.get(e.id)?.exclusive === d.exclusive)));
    if (pool.length === 0) return null;
    const pick = this.host.rng.weighted(pool, pool.map((d) => Math.max(0, d.weight)));
    this.trigger(pick.id);
    return pick.id;
  }

  /** Host: called on every frame with real seconds. Expires timed events. */
  tick(): void {
    if (!this.host.isHost) return;
    const now = this.host.now();
    for (const e of [...this.live]) if (e.endsAt > 0 && now >= e.endsAt) this.end(e.id);
  }

  /** Shift end: events with duration 'shift' (and any left over) finish. A boss (exclusive 'boss') lasts the whole Night: the run ends it at Dawn. */
  onShiftEnd(): void {
    for (const e of [...this.live]) {
      if (this.defMap.get(e.id)?.exclusive === 'boss') continue;
      const d = this.defMap.get(e.id)?.duration;
      if (d === 'shift' || e.endsAt === 0) this.end(e.id);
    }
  }

  /** Every active event's effects apply to the whole pit (owner 0). */
  collect(_q: ModQuery, out: ModSource[]): void {
    for (const e of this.live) {
      const def = this.defMap.get(e.id);
      if (!def?.effects?.length) continue;
      out.push({ kind: 'event', id: def.id, owner: 0, effects: def.effects, order: out.length });
    }
  }
}
