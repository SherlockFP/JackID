/**
 * ActorDirector implementation (DECISIONS C33): spawns kit mannequins, walks them over the nav graph (A* in `nav.ts`),
 * plays clips and turns their heads. Owned by horror; the world only supplies the graph and seats.
 * Movement runs on real dt (like cutscene actors); the horror director decides when anything happens.
 */
import * as THREE from 'three';
import type { ActorDirector, ActorHandle } from '@/core/cutscene/types';
import type { Kit, MannequinActor, MannequinOpts } from '@/kit/types';
import type { V3 } from '@/core/types';
import { lerpAngle } from '@/core/math';
import { log } from '@/core/log';
import { findPath, type NavOpts } from './nav';

export const DEFAULT_WALK_SPEED = 1.4;     // m/s (GDD §6.3 patrol pace)
const TURN_RATE = 7;                       // 1/s, body turn towards the heading
const COLLECTOR_HEIGHT = 2.45;             // m (mannequin ×1.4)

export interface SeatSpot { pos: V3; rotY: number }
export interface ActorDirectorDeps {
  kit: Kit;
  /** Parent for spawned actors (the level root); null = not attached yet. */
  scene: () => THREE.Object3D | null;
  closedZone?: NavOpts['closedZone'];
  /** Seat lookup for `sitAt`. Unknown ids resolve null. */
  seat?: (seatId: string) => SeatSpot | null;
}

/** Concrete actor: an ActorHandle that also owns its mannequin and walk state. */
export class LiveActor implements ActorHandle {
  readonly id: string;
  readonly root: THREE.Group;
  readonly m: MannequinActor;
  /** Clip used while walking (the Collector uses 'Walk_Formal_Loop'). */
  walkClip = 'Walk_Loop';
  walkSpeed = DEFAULT_WALK_SPEED;
  /** Optional per-step hook: called every `stepEvery` metres walked (footsteps, coin clinks). */
  onStep: ((a: LiveActor) => void) | null = null;
  stepEvery = 0;
  alive = true;

  // walk state (owned by ActorDirectorImpl)
  path: THREE.Vector3[] | null = null;
  done: ((ok: boolean) => void) | null = null;
  stepAcc = 0;

  constructor(id: string, root: THREE.Group, m: MannequinActor) {
    this.id = id; this.root = root; this.m = m;
  }

  get pos(): V3 { const p = this.root.position; return [p.x, p.y, p.z]; }
  get walking(): boolean { return this.path !== null; }
}

const TMP = new THREE.Vector3();

export class ActorDirectorImpl implements ActorDirector {
  private readonly live = new Set<LiveActor>();
  private seq = 0;

  constructor(private readonly deps: ActorDirectorDeps) {}

  /** Every spawned, not yet despawned actor. */
  all(): readonly LiveActor[] { return [...this.live]; }

  async spawn(id: string, at: V3, o?: { dressing?: string; frozen?: boolean }): Promise<ActorHandle | null> {
    const d = o?.dressing ?? 'plain';
    const opts: MannequinOpts = { frozen: o?.frozen ?? false };
    if (d === 'collector') { opts.style = 'collector'; opts.height = COLLECTOR_HEIGHT; }
    else if (d === 'porcelain' || d === 'ghost' || d === 'shadow') opts.style = d;
    else opts.style = 'plain';
    let m: MannequinActor;
    try { m = this.deps.kit.mannequin(opts); }
    catch (e) { log.warn('actors', `spawn "${id}" failed`, e); return null; }
    m.root.position.set(at[0], at[1], at[2]);
    const a = new LiveActor(`${id}#${++this.seq}`, m.root, m);
    this.live.add(a);
    this.deps.scene()?.add(m.root);
    try { await m.ready; }
    catch (e) { log.warn('actors', `"${id}" mesh failed`, e); this.despawn(a); return null; }
    if (!a.alive) return null;
    return a;
  }

  /** Remove an actor from the scene and free its GPU resources. A pending walk resolves false. */
  despawn(actor: ActorHandle): void {
    const a = this.asLive(actor);
    if (!a || !a.alive) return;
    this.finishWalk(a, false);
    a.alive = false;
    this.live.delete(a);
    a.root.removeFromParent();
    a.m.dispose();
  }

  disposeAll(): void { for (const a of [...this.live]) this.despawn(a); }

  walkPath(actor: ActorHandle, to: V3, o?: { speed?: number }): Promise<boolean> {
    const a = this.asLive(actor);
    if (!a || !a.alive) return Promise.resolve(false);
    const route = findPath([a.root.position.x, a.root.position.z], [to[0], to[2]], { closedZone: this.deps.closedZone });
    this.finishWalk(a, false);
    if (!route) return Promise.resolve(false);
    if (o?.speed !== undefined) a.walkSpeed = Math.max(0.1, o.speed);
    a.path = route.slice(1).map((p) => new THREE.Vector3(p[0], a.root.position.y, p[1]));
    if (a.path.length === 0) { a.path = null; return Promise.resolve(true); }
    a.stepAcc = 0;
    void a.m.play(a.walkClip, { loop: true, fade: 0.2 });
    return new Promise<boolean>((res) => { a.done = res; });
  }

  /** Play a clip. Interrupts a walk (its promise resolves false). One-shots resolve when they end; loops resolve at once. */
  play(actor: ActorHandle, clip: string, o?: { loop?: boolean }): Promise<void> {
    const a = this.asLive(actor);
    if (!a || !a.alive) return Promise.resolve();
    this.finishWalk(a, false);
    const loop = o?.loop ?? clip.endsWith('_Loop');
    const p = a.m.play(clip, { loop, fade: 0.2 });
    return loop ? Promise.resolve() : p;
  }

  lookAt(actor: ActorHandle, target: V3): void {
    const a = this.asLive(actor);
    if (!a || !a.alive) return;
    a.m.lookAt(TMP.set(target[0], target[1], target[2]), 0.3);
  }

  /** Release a head turn (the actor looks forward again). */
  lookForward(actor: ActorHandle): void {
    const a = this.asLive(actor);
    if (a && a.alive) a.m.lookAt(null);
  }

  async sitAt(actor: ActorHandle, seatId: string): Promise<boolean> {
    const a = this.asLive(actor);
    const s = this.deps.seat?.(seatId) ?? null;
    if (!a || !a.alive || !s) return false;
    const ok = await this.walkPath(a, s.pos);
    if (!ok || !a.alive) return false;
    a.root.position.set(s.pos[0], s.pos[1], s.pos[2]);
    a.root.rotation.y = s.rotY;
    await this.play(a, 'Sitting_Enter', { loop: false });
    if (a.alive) void this.play(a, 'Sitting_Idle_Loop', { loop: true });
    return a.alive;
  }

  /** Per-frame: advance every walking actor. Called by the horror director with real dt. */
  update(dt: number): void {
    for (const a of this.live) if (a.path) this.stepWalk(a, dt);
  }

  private stepWalk(a: LiveActor, dt: number): void {
    const p = a.root.position;
    let budget = a.walkSpeed * dt;
    let heading: number | null = null;
    while (budget > 0 && a.path && a.path.length) {
      const w = a.path[0];
      const dx = w.x - p.x, dz = w.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) heading = Math.atan2(dx, dz);
      if (d <= budget) {
        p.x = w.x; p.z = w.z;
        budget -= d;
        a.path.shift();
        this.countStep(a, d);
      } else {
        const k = budget / d;
        p.x += dx * k; p.z += dz * k;
        this.countStep(a, budget);
        budget = 0;
      }
    }
    if (heading !== null) a.root.rotation.y = lerpAngle(a.root.rotation.y, heading, 1 - Math.exp(-TURN_RATE * dt));
    if (a.path && a.path.length === 0) this.finishWalk(a, true);
  }

  private countStep(a: LiveActor, metres: number): void {
    if (!a.onStep || a.stepEvery <= 0) return;
    a.stepAcc += metres;
    while (a.stepAcc >= a.stepEvery) { a.stepAcc -= a.stepEvery; a.onStep(a); }
  }

  /** Ends a walk (idle clip on arrival) and resolves its promise. */
  private finishWalk(a: LiveActor, ok: boolean): void {
    const had = a.path !== null || a.done !== null;
    a.path = null;
    const done = a.done;
    a.done = null;
    if (!had) return;
    if (ok && a.alive) void a.m.play('Idle_Loop', { loop: true, fade: 0.3 });
    done?.(ok);
  }

  private asLive(actor: ActorHandle): LiveActor | null {
    return actor instanceof LiveActor ? actor : null;
  }
}

/** Build the director for a level. The horror director and the cutscene player both take it. */
export function createActorDirector(deps: ActorDirectorDeps): ActorDirectorImpl {
  return new ActorDirectorImpl(deps);
}
