/**
 * Dark patrons (w72 npc lane): a handful of near-black guests that wander the patrol graph and stop at the machines.
 * They are plain ActorDirector actors (`dressing: 'shadow'`, so the dark NPC look applies), walked with `walkPath` over
 * `NAV_POINTS` and turned to face their machine during a stop. Cheap by design: 4-6 actors, one A* per stop, no timers
 * outside `tick`. Deterministic: every random pick comes from the injected `rnd` (the horror director's seeded rng), and
 * time is the caller's dt (real dt, like the other actors), never Date.now or setTimeout.
 *
 * Wiring (owned by the horror director): `new DarkPatrons({...}).start()` once the level is up, `tick(realDt)` each
 * frame next to `actors.update`, and `dispose()` with the director.
 */
import type { ActorHandle } from '@/core/cutscene/types';
import type { ActorDirectorImpl } from './actorDirector';
import type { V3 } from '@/core/types';
import { SLOTS } from '@/world/layout';
import { NAV_POINTS, nearestNode, type Vec2 } from './nav';

export const DARK_PATRON_COUNT = 5;
const MIN_COUNT = 4, MAX_COUNT = 6;
const MACHINE_CHANCE = 0.6;          // share of walks that end at a machine (the rest pass through the halls)
const STOP_MIN = 4, STOP_SPAN = 5;   // s paused at a machine (min + up to span)
const HALL_MIN = 0.5, HALL_SPAN = 2; // s paused in the halls
const SPEED_MIN = 0.9, SPEED_SPAN = 0.5;   // m/s (slower than the Collector's patrol pace)
const GAZE_Y = 1.4;                  // m: a patron looks at the machine's face, not its base

export interface DarkPatronDeps {
  actors: ActorDirectorImpl;
  /** Deterministic generator in [0, 1). Pass the seeded rng of the owner; never Math.random. */
  rnd: () => number;
  /** Actor count, clamped to 4..6 (default 5). */
  count?: number;
  /** Patrol nodes to wander (default: every patrol node). */
  points?: readonly Vec2[];
}

interface Stop { node: V3; gaze: V3 }
interface Patron { h: ActorHandle | null; rest: number; busy: boolean }

/** Patrol node nearest each machine slot, one stop per node (first slot wins), in slot order. */
function machineStops(): Stop[] {
  const seen = new Set<number>();
  const out: Stop[] = [];
  for (const s of SLOTS) {
    const i = nearestNode([s.pos[0], s.pos[2]]);
    if (seen.has(i)) continue;
    seen.add(i);
    const p = NAV_POINTS[i];
    out.push({ node: [p[0], 0, p[1]], gaze: [s.pos[0], GAZE_Y, s.pos[2]] });
  }
  return out;
}

export class DarkPatrons {
  private readonly patrons: Patron[] = [];
  private readonly points: readonly V3[];
  private readonly stops: readonly Stop[];
  private readonly count: number;
  private alive = true;

  constructor(private readonly d: DarkPatronDeps) {
    const pts = d.points ?? NAV_POINTS;
    this.points = pts.map((p): V3 => [p[0], 0, p[1]]);
    this.stops = machineStops();
    this.count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, d.count ?? DARK_PATRON_COUNT));
  }

  /** Spawn the crowd in a fixed order, each on a random patrol node. Resolves when every spawn has settled. */
  async start(): Promise<void> {
    if (this.points.length === 0) return;
    for (let i = 0; i < this.count && this.alive; i++) {
      const slot: Patron = { h: null, rest: this.d.rnd() * HALL_SPAN, busy: false };
      this.patrons.push(slot);
      const h = await this.d.actors.spawn(`dark-patron-${i}`, this.pick(this.points), { dressing: 'shadow' });
      if (!h) { this.patrons.splice(this.patrons.indexOf(slot), 1); continue; }
      if (!this.alive) { this.d.actors.despawn(h); return; }
      slot.h = h;
    }
  }

  /** Per frame (real dt): a patron rests, then walks to its next stop. Walking patrons are left alone. */
  tick(dt: number): void {
    if (!this.alive || this.points.length === 0) return;
    for (const p of this.patrons) {
      if (!p.h || p.busy) continue;
      p.rest -= dt;
      if (p.rest > 0) continue;
      const h = p.h;
      const machine = this.stops.length > 0 && this.d.rnd() < MACHINE_CHANCE;
      const stop = machine ? this.stops[Math.floor(this.d.rnd() * this.stops.length)] : null;
      const to = stop ? stop.node : this.pick(this.points);
      p.busy = true;
      this.d.actors.lookForward(h);
      void this.d.actors.walkPath(h, to, { speed: SPEED_MIN + this.d.rnd() * SPEED_SPAN }).then((ok) => {
        p.busy = false;
        if (!ok || !this.alive) { p.rest = HALL_MIN; return; }
        if (stop) {
          p.rest = STOP_MIN + this.d.rnd() * STOP_SPAN;
          this.d.actors.lookAt(h, stop.gaze);
        } else {
          p.rest = HALL_MIN + this.d.rnd() * HALL_SPAN;
        }
      });
    }
  }

  /** Despawn every patron; pending walks resolve false. */
  dispose(): void {
    this.alive = false;
    for (const p of this.patrons) if (p.h) this.d.actors.despawn(p.h);
    this.patrons.length = 0;
  }

  /** Live patron count (tests and the bench readout). */
  get size(): number { return this.patrons.filter((p) => p.h).length; }

  private pick<T>(list: readonly T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.d.rnd() * list.length))];
  }
}
