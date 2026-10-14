/**
 * World (WORLD-SYS). The implementation of the frozen `World` (TECH_SPEC §2.14, §5): it builds the pit, places a
 * machine in every slot, and keeps the whole thing alive, visible and lit. Orchestration only — each concern has its own
 * module under `world/sys/`:
 *
 *   arch.ts       the seam to WORLD-ARCH (`layout.ts` slots/zones/assignment, `level.ts` geometry/props/gates)
 *   placement.ts  slot → machine resolution (TECH §5.3)          pads.ts      pads, out-of-order cabinets, order animation
 *   zones.ts      zone lookup + blended fog/ambient              lightPool.ts 6 pooled PointLights + the `WorldLights` facade
 *   router.ts     seating, machine networking, late join         items.ts     totems / pickups / notes
 *   slot.ts       per-slot transform + bookkeeping
 *
 * Life-cycle (§3.2): `registry.get(id)` → `new Ctor(ctx)` → `_build()` → add to the slot group → colliders + interaction
 * target + light anchors → `init()` → `setLocked()`. Building ~60 machines in one go would freeze the tab, so the initial
 * build is TIME-SLICED: `frame()` runs queued jobs within a ~7 ms budget; `prebuild()` drives it by itself and returns the
 * `ready` promise; `flushBuild()` does it all synchronously (tests). Per-frame work: level/prop updates, culling
 * (distance + frustum → `machine.visible`, LOD detail nodes, zone groups), machine `frame()/attract()`, light pool,
 * atmosphere (zone-blended fog on the scene, hemisphere ambient, dread grade).
 *
 * Wing gating is per instance (§11.2): a closed zone locks its machines (`setLocked(true)`), solid gate colliders block the
 * doorway and the grille prop animates. `setZoneOpen(zone, true)` reverses it.
 *
 * Without WORLD-ARCH's files the world still runs: a plain hall, demo slots filled with the registered machines.
 */
import * as THREE from 'three';
import type { GameMode, InstanceId, MachineId, PlayerId, SlotSize, Unsub, V3, Vec3Like, ZoneId } from '@/core/types';
import type { AnyMachine, MachineContext, MachineModule } from '@/machines/_base/types';
import type { MachineSnap } from '@/machines/_base/MachineBase';
import type { RunApi } from '@/game/types';
import * as registry from '@/machines/_base/registry';
import { BenchRun } from '@/game/benchRun';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { log } from '@/core/log';
import { clamp, damp, lerp } from '@/core/math';
import { fmtCoins, t } from '@/core/i18n';
import { psxUniforms } from '@/core/renderer/psxMaterial';
import type { LocalPlayer } from '@/player/types';
import type { LocalPlayerHost } from '@/player/local';
import { createCollisionWorld, type CollisionHost } from './collision';
import { createInteraction, type InteractableX, type InteractionHost } from './interact';
import type {
  SlotDef, World, WorldBuildOpts, WorldLights, WorldProp, PropId,
} from './types';
import { benchSlot, fallbackZones, loadArch, type FlickerId, type GateDef, type LevelBuild, type SpawnKind, type SpawnPoint } from './sys/arch';
import { LightPool, type LightSourceInit } from './sys/lightPool';
import { createLampGlow } from './sys/lamps';
import { createJuiceFx } from './sys/juiceFx';
import { ItemManager } from './sys/items';
import { buildBroken, buildPad, playDelivery, playRemoval, type PadServices } from './sys/pads';
import { fits, resolvePlacements, type Placement } from './sys/placement';
import { Router, type SeatPhase } from './sys/router';
import { SlotRec } from './sys/slot';
import { newLook, ZoneMap } from './sys/zones';

declare module '@/core/events' {
  interface GameEvents {
    /** E on an empty pad: the tycoon layer opens its machine-order UI for this instance. */
    'world:pad': { slot: InstanceId; size: SlotSize };
  }
}

// ── tuning ────────────────────────────────────────────────────────────────────────────────────────
const BUILD_BUDGET_MS = 7;
// Playtest: the pit read too dark to find things. Raised about a third; fog (horror mood) is unchanged.
const AMBIENT_SKY_GAIN = 6.4;
const AMBIENT_GROUND_GAIN = 3.5;
const ATMOSPHERE_RATE = 6;
const TELEPORT_JUMP_M = 8;
const DEFAULT_ATTRACT_M = 14;
const CULL_MARGIN_M = 2;
const LOD_NEAR_M = 8;
const LOD_FAR_M = 9.5;
const ZONE_CULL_PERIOD_S = 0.1;
const LOCK_PERIOD_S = 1;
const TABLE_REACH_M = 2.8;
const SOLO_REACH_M = 2.2;
/** Extra reach on a machine: one E press walks the player up to the stand point and then sits (see `walkUpAndSit`). */
const WALK_UP_EXTRA_M = 1.4;
const SEAT_STAND_OFFSET_M = 0.55;     // same as the router's default stand point (in front of the machine's interact box)
const WALK_UP_NEAR_M = 0.4;           // already at the stand point: sit without walking
const NEAREST_DEFAULT_M = 6;

export type { SpawnKind, SpawnPoint } from './sys/arch';
export type { SeatPhase } from './sys/router';

export interface SlotChange { slot: InstanceId; kind: 'placed' | 'removed' | 'locked' | 'unlocked'; machine: AnyMachine | null }

/** The world plus the pieces integration code (in-game state, net, add-on systems) needs beyond the frozen contract. */
export interface WorldHost extends World {
  readonly collision: CollisionHost;
  readonly interact: InteractionHost;
  /** Resolves when the initial machine build has finished. */
  readonly ready: Promise<void>;
  /** 0..1 build progress. */
  readonly progress: number;
  /** Start (and drive, once per animation frame) the time-sliced build; resolves with `ready`. */
  prebuild(): Promise<void>;
  /** Build everything now, in one go (tests, tools). */
  flushBuild(): void;
  spawns(kind: SpawnKind): readonly SpawnPoint[];
  /** First spawn of a kind (falls back to `solo`, then the origin). */
  spawn(kind: SpawnKind, index?: number): SpawnPoint;
  /** Mounting group of a slot (Circuit badge, Service Plate, upgrade visuals). */
  slotGroup(id: InstanceId): THREE.Group | null;
  /** 0..1 brightness at a world point (dims the first-person hands, drives horror). */
  lightLevelAt(p: Vec3Like): number;
  isLocked(id: InstanceId): boolean;
  // seating (E on a machine is wired by the world itself; these are for the pause menu, ghosts, cutscenes)
  readonly seat: { mid: InstanceId; seat: number } | null;
  readonly seatPhase: SeatPhase;
  occupy(mid: InstanceId, seat?: number): void;
  standUp(): void;
  // net glue (NET-SESSION): late join + drops
  occupancy(): Array<[InstanceId, number, PlayerId]>;
  applyOccupancy(list: ReadonlyArray<readonly [InstanceId, number, PlayerId]>): void;
  bots(): Array<[InstanceId, number, string, number]>;
  machineSnapshot(mid: InstanceId, forPid?: PlayerId): MachineSnap | null;
  applyMachineSnapshot(mid: InstanceId, snap: MachineSnap, from?: PlayerId): void;
  dropPlayer(pid: PlayerId): void;
  /** Subscribe to machines appearing / disappearing / locking (badges, plates, upgrade visuals). */
  onSlotChange(fn: (e: SlotChange) => void): Unsub;
  stats(): { slots: number; machines: number; visible: number; pads: number; lights: number; colliders: number; interactables: number };
}

/** Light-anchor `userData` shape (TECH §11.5). */
interface LightUserData { color?: number; intensity?: number; range?: number; flicker?: FlickerId }

export function createWorld(opts: WorldBuildOpts, camera: THREE.Camera): WorldHost {
  const kit = app.kit;
  const root = new THREE.Group();
  root.name = 'world';
  const collision = createCollisionWorld();
  const interact = createInteraction(camera, collision);
  const arch = loadArch();
  const mode: GameMode = opts.mode;
  let disposed = false;
  const offs: Array<() => void> = [];

  // ── slots, assignment, zones ──────────────────────────────────────────────────────────────────
  const benchDef = opts.bench ? registry.get(registry.resolve(opts.bench) ?? opts.bench)?.def : undefined;
  const slotDefs: SlotDef[] = opts.slots ? [...opts.slots] : benchDef ? [benchSlot(benchDef.slotSize)] : [...arch.slots];
  const assign: Partial<Record<InstanceId, MachineId | null>> = benchDef
    ? { BENCH: benchDef.id }
    : { ...arch.assign(mode), ...(opts.assign ?? {}) };
  try {
    const owned = app.run?.tycoon.state().machines ?? {};
    for (const [instance, om] of Object.entries(owned)) assign[instance] = om.machineId;
  } catch { /* the tycoon layer is optional while the world is being built */ }
  const zones = new ZoneMap(arch.zones.length > 0 ? arch.zones : fallbackZones(slotDefs, !!benchDef));
  const placements = resolvePlacements({
    slots: slotDefs, assign, mode, fill: !arch.real && !benchDef,
    lookup: { resolve: registry.resolve, def: (id) => registry.get(id)?.def, all: () => registry.all().map((m) => m.def) },
  });
  const recs = new Map<InstanceId, SlotRec>();
  for (const d of slotDefs) { const r = new SlotRec(d); recs.set(d.id, r); root.add(r.group); }

  // ── lights ────────────────────────────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xbdf7ef, 0x3a0810, 1);
  hemi.name = 'ambient';
  root.add(hemi);
  let ringing = false;
  const pool = new LightPool({
    parent: root, rng: app.rng.cosmetic,
    reduced: () => app.save.data.settings.reduceFlashing,
    ringing: () => ringing,
    hasZone: (id) => zones.has(id),
  });
  offs.push(bus.on('phone:ring', () => { ringing = true; }));
  offs.push(bus.on('phone:end', () => { ringing = false; }));
  offs.push(bus.on('dread:change', ({ value }) => pool.api.setDread(value)));
  const juiceFx = createJuiceFx(pool.api);
  // Circuit Lamps: a warm breathing light over the Hot cabinet, a dim blue one over each Cold (sys/lamps.ts).
  const lampGlow = createLampGlow({
    pool,
    at: (mid) => { const r = recs.get(mid); return r ? { x: r.def.pos[0], y: r.def.pos[1], z: r.def.pos[2] } : null; },
    reduced: () => app.save.data.settings.reduceFlashing,
  });
  offs.push(() => lampGlow.dispose());

  // ── level (WORLD-ARCH) ────────────────────────────────────────────────────────────────────────
  const anchors = new Map<string, THREE.Object3D>();
  const props = new Map<string, WorldProp>();
  const zoneNodes: Array<{ obj: THREE.Object3D; zone: ZoneId }> = [];
  const gateColliders = new Map<ZoneId, number[]>();
  const zoneOpen = new Map<ZoneId, boolean>();
  for (const z of zones.defs) zoneOpen.set(z.id, mode === 'free' || benchDef ? true : !z.gated);
  try {
    for (const z of app.run?.tycoon.state().zones ?? []) if (zoneOpen.has(z)) zoneOpen.set(z, true);
  } catch { /* optional */ }

  const level: LevelBuild | null = arch.buildLevel({
    mode, seed: opts.seed, slots: slotDefs, kit, tex: app.tex, collision, bench: !!benchDef,
  });
  if (level) {
    root.add(level.root);
    for (const s of level.statics ?? []) collision.addStatic(s.box, s.tag);
    for (const [name, obj] of Object.entries(level.anchors ?? {})) anchors.set(name, obj);
    for (const [id, p] of Object.entries(level.props ?? {})) props.set(id, p);
    for (const h of level.lights ?? []) {
      pool.add({ id: h.id, pos: { x: h.pos[0], y: h.pos[1], z: h.pos[2] }, color: h.color, intensity: h.intensity, range: h.range, flicker: h.flicker, zone: h.zone ?? zones.zoneAt(h.pos[0], h.pos[2]) });
    }
    for (const c of level.root.children) {
      const zone = c.userData.zone as ZoneId | undefined;
      if (zone) zoneNodes.push({ obj: c, zone });
    }
    for (const [zone, g] of Object.entries(level.gates ?? {}) as Array<[ZoneId, GateDef]>) {
      if (zoneOpen.get(zone) === false) closeGate(zone, g, true);
      else void g.prop?.setOpen?.(true, 0);
    }
  }
  function closeGate(zone: ZoneId, g: GateDef, instant: boolean): void {
    if (!gateColliders.has(zone)) gateColliders.set(zone, (g.colliders ?? []).map((b) => collision.addStatic(b, 'solid')));
    void g.prop?.setOpen?.(false, instant ? 0 : undefined);
  }

  // ── services shared with sub-systems ──────────────────────────────────────────────────────────
  const sv: PadServices = { kit, fx: app.fx, audio: app.audio, tweens: app.tweens.sim, camera: app.camera, alive: () => !disposed };
  let fallbackRun: RunApi | null = null;
  /** The real run once the in-game state has made one; a debug wallet before that (dev stub world only). */
  const runOf = (): RunApi => {
    if (app.run) return app.run;
    if (!fallbackRun) { log.warn('world', 'no run yet — machines use the bench wallet'); fallbackRun = new BenchRun(opts.seed, app.ui); }
    return fallbackRun;
  };

  const isClosed = (r: SlotRec): boolean => zoneOpen.get(r.def.zone) === false;
  const router = new Router({
    slot: (id) => recs.get(id),
    isClosed,
    runSeed: opts.seed,
    clearAt: (x, y, z) => {
      const half = new THREE.Vector3(0.3, 0.9, 0.3);
      const c = new THREE.Vector3(x, y + 0.9, z);
      return collision.floorAt(x, z, y + 0.35) !== null && !collision.overlaps(c, half);
    },
    all: () => recs.values(),
  });
  const items = new ItemManager({ parent: root, interact, tweens: app.tweens.sim });

  // ── slot content ──────────────────────────────────────────────────────────────────────────────
  const changeFns = new Set<(e: SlotChange) => void>();
  const emitChange = (rec: SlotRec, kind: SlotChange['kind']): void => {
    for (const fn of [...changeFns]) { try { fn({ slot: rec.id, kind, machine: rec.machine }); } catch (e) { log.error('world', 'slot listener', e); } }
  };

  const localBox = (rec: SlotRec, b: { min: V3; max: V3 }): THREE.Box3 =>
    new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)).applyMatrix4(rec.group.matrixWorld);

  /** Remove whatever stands on the slot (machine, pad or out-of-order cabinet) and everything registered for it. */
  function clearContent(rec: SlotRec): void {
    rec.offInteract?.(); rec.offInteract = null;
    for (const id of rec.colliders) collision.remove(id);
    rec.colliders = [];
    for (const off of rec.offLights) off();
    rec.offLights = [];
    if (rec.machine) {
      try { rec.machine.dispose(); } catch (e) { log.error('world', rec.id, e); }
      rec.machine = null;
    }
    rec.pad?.dispose(); rec.pad = null;
    rec.broken?.dispose(); rec.broken = null;
    rec.detail = [];
    rec.ready = false;
  }

  function buildPadContent(rec: SlotRec): void {
    const pad = buildPad(kit, rec.size);
    rec.pad = pad;
    rec.group.add(pad.root);
    rec.group.updateMatrixWorld(true);
    const box = localBox(rec, pad.interact);
    rec.offInteract = interact.add({
      id: rec.id, box, maxDist: SOLO_REACH_M,
      enabled: () => !rec.busy && !isClosed(rec),
      label: () => t('world.padLabel'),
      sub: () => t('world.padSub', { size: rec.size }),
      onInteract: () => bus.emit('world:pad', { slot: rec.id, size: rec.size }),
    });
    rec.ready = true;
  }

  function buildBrokenContent(rec: SlotRec, why: string): void {
    log.warn('world', `${rec.id}: out of order (${why})`);
    const b = buildBroken(kit, rec.size);
    rec.broken = b;
    rec.group.add(b.root);
    rec.group.updateMatrixWorld(true);
    rec.colliders = collision.addLocal(b.colliders, rec.group.matrixWorld);
    rec.offInteract = interact.add({
      id: rec.id, box: localBox(rec, b.interact), maxDist: SOLO_REACH_M,
      enabled: () => !rec.busy,
      label: () => t('world.outOfOrder'),
      onInteract: () => { app.audio.play('buzzer', { vol: 0.4 }); },
    });
    rec.ready = true;
  }

  function makeContext(rec: SlotRec, mod: MachineModule): MachineContext {
    return {
      instanceId: rec.id, def: mod.def, slot: rec.def, kit, audio: app.audio, ui: app.ui, input: app.input, events: app.events,
      get run() { return runOf(); },
      net: router.netFor(rec),
      tweens: app.tweens.sim, timers: app.timers.sim, time: app.time, camera: app.camera, fx: app.fx, cutscene: app.cutscene,
      runSeed: opts.seed,
    };
  }

  function machineLabel(rec: SlotRec, m: AnyMachine): string {
    const name = t(`m.${m.def.id}.name`);
    return m.def.category === 'system' ? t('world.use', { name }) : t('common.play', { name });
  }

  function machineSub(rec: SlotRec, m: AnyMachine): string {
    if (isClosed(rec)) return t('world.wingClosed');
    if (rec.locked || m.locked) return t('common.locked', { n: m.def.tier ?? 1 });
    if (!m.seats.includes(null)) {
      const pid = m.seats.find((p): p is PlayerId => p !== null);
      return pid === undefined ? '' : t('common.occupied', { name: m.ctx.net.playerName(pid) });
    }
    if (m.def.maxBet <= 0) return '';
    // The run's real limit (Night 1 stake cap, the Night's stake index), not the catalogue range.
    const lim = runOf().betLimits(m.def.id, m.id);
    const max = Number.isFinite(lim.max) ? lim.max : m.def.maxBet;
    return t('world.betRange', { min: fmtCoins(lim.min), max: fmtCoins(max) });
  }

  /** Free seat for a press of E: the only one, or the one whose stand point is nearest to the player. */
  function pickSeat(rec: SlotRec, m: AnyMachine): number {
    const free: number[] = [];
    m.seats.forEach((p, i) => { if (p === null) free.push(i); });
    if (free.length <= 1) return free[0] ?? -1;
    const at = app.player?.pos ?? camera.position;
    let best = free[0], bestD = Infinity;
    for (const i of free) {
      const sd = m.model.seats?.[i];
      const w = rec.toWorld(sd?.stand ?? new THREE.Vector3());
      const d = Math.hypot(w.x - at.x, w.z - at.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Stand point (feet, world) of a seat: the seat's own `stand` anchor, else in front of the interact box. */
  function standPoint(rec: SlotRec, m: AnyMachine, seat: number): THREE.Vector3 {
    const sd = m.model.seats?.[seat];
    const itz = m.model.interact.max[2];
    const local = sd?.stand ?? new THREE.Vector3(0, 0, itz + SEAT_STAND_OFFSET_M);
    return rec.toWorld(local).setY(rec.def.pos[1]);
  }

  /**
   * One E press on a machine in reach: walk the body to the stand point (the prompt is held back meanwhile), then take the
   * first free seat and sit. An E press during the walk is absorbed: the sit is already queued for its end. A walk that is
   * interrupted (cutscene, fall, a closed wing, a denied seat) ends without sitting and the prompt returns.
   */
  let walkingTo: InstanceId | null = null;
  async function walkUpAndSit(rec: SlotRec, m: AnyMachine, seat: number): Promise<void> {
    const lp = app.player as (LocalPlayer & Partial<LocalPlayerHost>) | null;
    const stand = standPoint(rec, m, seat);
    const at = app.player?.pos ?? camera.position;
    const near = Math.hypot(stand.x - at.x, stand.z - at.z) <= WALK_UP_NEAR_M;
    if (!lp?.walkTo || near) { router.request(rec.id, seat); return; }
    const look = rec.toWorld(new THREE.Vector3(0, 0, 0)).setY(stand.y);
    walkingTo = rec.id;
    app.ui.prompt(null);
    let ok = false;
    try { ok = await lp.walkTo(stand, look); }
    finally { walkingTo = null; }
    if (!ok || rec.machine !== m || rec.locked || m.locked || isClosed(rec)) return;
    const now = pickSeat(rec, m);                              // the seat may have been taken during the walk
    if (now < 0) { app.ui.toast(t('world.noSeat'), 'warn'); app.audio.play('buzzer', { vol: 0.4 }); return; }
    router.request(rec.id, now);
  }

  function buildMachineContent(rec: SlotRec, machineId: MachineId): boolean {
    const mod = registry.get(machineId);
    if (!mod) { buildBrokenContent(rec, `unregistered ${machineId}`); return false; }
    let m: AnyMachine | null = null;
    try {
      m = new mod.default(makeContext(rec, mod));
      m._build();
      rec.machine = m;
      rec.group.add(m.root);
      rec.group.updateMatrixWorld(true);
      rec.colliders = collision.addLocal(m.model.colliders, rec.group.matrixWorld);
      const model = m.model;
      for (const key of ['light', 'light2'] as const) {
        const a = model.anchors[key];
        if (!a) continue;
        const u = a.userData as LightUserData;
        const init: LightSourceInit = {
          id: `${rec.id}.${key}`, pos: a.getWorldPosition(new THREE.Vector3()), color: u.color ?? 0xffe2a0,
          intensity: u.intensity, range: u.range, flicker: u.flicker, zone: rec.def.zone, owner: rec.id,
        };
        rec.offLights.push(pool.add(init));
      }
      m.root.traverse((o) => { if (o.userData.lodDetail === true) rec.detail.push(o); });
      const reach = m.def.seats > 1 ? TABLE_REACH_M : SOLO_REACH_M;
      const machine = m;
      const inter: InteractableX = {
        id: rec.id, box: localBox(rec, model.interact), maxDist: reach + WALK_UP_EXTRA_M,
        enabled: () => rec.ready && !rec.busy && rec.machine === machine,
        label: () => machineLabel(rec, machine),
        sub: () => machineSub(rec, machine),
        disabled: () => isClosed(rec) || rec.locked || machine.locked || !machine.seats.includes(null),
        onInteract: () => {
          if (walkingTo) return;                                   // already walking up: the sit is queued for its end
          if (isClosed(rec) || rec.locked || machine.locked) { app.ui.toast(machineSub(rec, machine), 'warn'); app.audio.play('buzzer', { vol: 0.4 }); return; }
          const seat = pickSeat(rec, machine);
          if (seat < 0) { app.ui.toast(t('world.noSeat'), 'warn'); app.audio.play('buzzer', { vol: 0.4 }); return; }
          if (!app.player) { app.ui.toast(t('world.unavailable'), 'warn'); return; }
          void walkUpAndSit(rec, machine, seat);
        },
      };
      rec.offInteract = interact.add(inter);
      m.init();
      m.setLocked(rec.locked);
      m.visible = true;
      rec.ready = true;
      return true;
    } catch (e) {
      log.error('world', `${rec.id} (${machineId}) failed to build — out of order`, e);
      clearContent(rec);
      buildBrokenContent(rec, `crash ${machineId}`);
      return false;
    }
  }

  function buildContent(rec: SlotRec, p: Placement): void {
    if (p.kind === 'pad') buildPadContent(rec);
    else if (p.kind === 'broken') buildBrokenContent(rec, `${p.machineId ?? '?'}: ${p.reason}`);
    else buildMachineContent(rec, p.machineId);
    if (rec.machine) emitChange(rec, 'placed');
  }

  // ── locks ─────────────────────────────────────────────────────────────────────────────────────
  function desiredLock(rec: SlotRec): boolean {
    if (isClosed(rec)) return true;
    const m = rec.machine;
    if (!m || !app.run) return false;
    try { return app.run.isLocked(m.def.id); } catch { return false; }
  }
  function refreshLocks(): void {
    for (const rec of recs.values()) {
      const want = desiredLock(rec);
      if (want === rec.locked) continue;
      rec.locked = want;
      const m = rec.machine;
      if (!m) continue;
      if (want) router.releaseAll(rec.id);
      try { m.setLocked(want); } catch (e) { log.error('world', rec.id, e); }
      emitChange(rec, want ? 'locked' : 'unlocked');
    }
  }

  // ── time-sliced build ─────────────────────────────────────────────────────────────────────────
  const jobs: Array<() => void> = [];
  let jobsTotal = 0, jobsDone = 0;
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => { readyResolve = r; });
  let finished = false;
  {
    const origin = level?.spawns?.solo?.[0]?.pos ?? level?.spawns?.bench?.[0]?.pos ?? [0, 0, 0];
    const order = [...recs.values()].sort((a, b) =>
      Math.hypot(a.def.pos[0] - origin[0], a.def.pos[2] - origin[2]) - Math.hypot(b.def.pos[0] - origin[0], b.def.pos[2] - origin[2]));
    for (const rec of order) {
      rec.locked = isClosed(rec);
      const p = placements.get(rec.id) ?? { kind: 'pad' as const };
      jobs.push(() => buildContent(rec, p));
    }
    jobsTotal = jobs.length;
    if (jobs.length === 0) { finished = true; readyResolve(); }
  }
  function finishBuild(): void {
    if (finished) return;
    finished = true;
    refreshLocks();
    log.info('world', `${[...recs.values()].filter((r) => r.machine).length} machines, ${pool.size} light sources, ${collision.count} colliders built`);
    readyResolve();
  }
  function pump(budgetMs: number): void {
    if (jobs.length === 0) return;
    const t0 = performance.now();
    do {
      const job = jobs.shift()!;
      try { job(); } catch (e) { log.error('world', 'build job failed', e); }
      jobsDone++;
    } while (jobs.length > 0 && performance.now() - t0 < budgetMs);
    if (jobs.length === 0) finishBuild();
  }
  let prebuilding = false;
  function prebuild(): Promise<void> {
    if (finished || prebuilding) return ready;
    prebuilding = true;
    const tick = (): void => {
      if (disposed || finished) return;
      pump(BUILD_BUDGET_MS);
      if (!finished) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return ready;
  }

  // ── wings ─────────────────────────────────────────────────────────────────────────────────────
  async function setZoneOpen(zone: ZoneId, open: boolean, animate = true): Promise<void> {
    if (!zoneOpen.has(zone) || zoneOpen.get(zone) === open) return;
    zoneOpen.set(zone, open);
    const gate = level?.gates?.[zone];
    if (!open) {
      if (gate) closeGate(zone, gate, !animate);
      refreshLocks();
      return;
    }
    if (animate) {
      app.audio.play('creak', { vol: 0.8, pitch: -4, priority: 7 });
      pool.api.pulse(zone, { mul: 1.8, dur: 1.4 });
    }
    refreshLocks();
    if (gate?.prop?.setOpen) await gate.prop.setOpen(true, animate ? undefined : 0);
    if (disposed) return;
    for (const id of gateColliders.get(zone) ?? []) collision.remove(id);
    gateColliders.delete(zone);
    if (animate) {
      app.audio.play('thud', { vol: 0.7, priority: 6 });
      pool.api.pulse(zone, { mul: 1.4, dur: 0.6 });
    }
  }

  // ── tycoon: order / sell ──────────────────────────────────────────────────────────────────────
  async function place(slotId: InstanceId, machineId: MachineId): Promise<AnyMachine | null> {
    const rec = recs.get(slotId);
    const id = registry.resolve(machineId);
    const mod = id ? registry.get(id) : undefined;
    if (!rec || !mod || disposed) return null;
    if (rec.machine?.def.id === mod.def.id) return rec.machine;
    if (rec.busy) return null;
    if (!fits(mod.def.slotSize, rec.size)) { log.warn('world', `${slotId}: ${mod.def.id} (${mod.def.slotSize}) does not fit a ${rec.size} slot`); return null; }
    rec.busy = true;
    if (rec.machine) router.releaseAll(rec.id);
    clearContent(rec);
    rec.locked = isClosed(rec);
    const ok = buildMachineContent(rec, mod.def.id);
    if (ok && rec.machine) {
      emitChange(rec, 'placed');
      await playDelivery(sv, rec.group, rec.size, rec.machine.root);
    }
    rec.busy = false;
    return ok ? rec.machine : null;
  }

  async function remove(slotId: InstanceId): Promise<void> {
    const rec = recs.get(slotId);
    if (!rec || !rec.machine || rec.busy || disposed) return;
    rec.busy = true;
    router.releaseAll(rec.id);
    await playRemoval(sv, rec.group, rec.size, rec.machine.root);
    if (disposed) return;
    clearContent(rec);
    buildPadContent(rec);
    rec.busy = false;
    emitChange(rec, 'removed');
  }

  offs.push(bus.on('tycoon:machine', ({ instance, machineId }) => {
    if (machineId) void place(instance, machineId); else void remove(instance);
  }));

  // ── culling ───────────────────────────────────────────────────────────────────────────────────
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  let zoneCullAt = 0;
  let fogFarNow = 26;

  function cull(dt: number): void {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    const cp = camera.position;
    const seatedAt = router.seat?.mid;
    const reach = fogFarNow * (psxUniforms.uPsxFogScale.value as number) + CULL_MARGIN_M;
    for (const rec of recs.values()) {
      const m = rec.machine;
      const d = Math.max(0, rec.sphere.center.distanceTo(cp) - rec.sphere.radius);
      const inRange = d < reach || seatedAt === rec.id;
      if (rec.group.visible !== inRange) rec.group.visible = inRange;
      if (!m) continue;
      const attract = m.def.attractRadius ?? DEFAULT_ATTRACT_M;
      m.visible = rec.id === seatedAt || (inRange && d < attract && frustum.intersectsSphere(rec.sphere));
      const lod: 0 | 1 = rec.lod === 0 ? (d > LOD_FAR_M ? 1 : 0) : (d < LOD_NEAR_M ? 0 : 1);
      if (lod !== rec.lod && rec.detail.length > 0) { rec.lod = lod; for (const o of rec.detail) o.visible = lod === 0; }
      else rec.lod = lod;
    }
    zoneCullAt -= dt;
    if (zoneCullAt <= 0 && zoneNodes.length > 0) {
      zoneCullAt = ZONE_CULL_PERIOD_S;
      for (const n of zoneNodes) n.obj.visible = zones.distanceTo(n.zone, cp.x, cp.z) < reach + 2;
    }
  }

  // ── atmosphere ────────────────────────────────────────────────────────────────────────────────
  const look = newLook();
  const target = newLook();
  let lookInit = false;
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  const ambientNow = new THREE.Color();

  function atmosphere(dt: number): void {
    const cp = camera.position;
    zones.lookAt(cp.x, cp.z, target);
    const gl = clamp(pool.globalLevel, 0, 1.2);
    const dread = pool.dread;
    target.fog.multiplyScalar(gl);
    target.ambient.multiplyScalar(gl);
    target.near *= lerp(1, 0.75, dread);
    target.far *= lerp(1, 0.7, dread);
    const jumped = Math.hypot(cp.x - lastCam.x, cp.z - lastCam.z) > TELEPORT_JUMP_M;
    lastCam.copy(cp);
    if (!lookInit || jumped) {
      look.fog.copy(target.fog); look.ambient.copy(target.ambient); look.near = target.near; look.far = target.far;
      lookInit = true;
    } else {
      const k = 1 - Math.exp(-ATMOSPHERE_RATE * dt);
      look.fog.lerp(target.fog, k); look.ambient.lerp(target.ambient, k);
      look.near = lerp(look.near, target.near, k); look.far = lerp(look.far, target.far, k);
    }
    fogFarNow = look.far;
    hemi.color.copy(look.ambient).multiplyScalar(AMBIENT_SKY_GAIN);
    hemi.groundColor.copy(look.ambient).multiplyScalar(AMBIENT_GROUND_GAIN);
    ambientNow.copy(look.ambient);
    const scene = root.parent as THREE.Scene | null;
    if (scene && scene.isScene) {
      if (scene.fog instanceof THREE.Fog) { scene.fog.color.copy(look.fog); scene.fog.near = look.near; scene.fog.far = look.far; }
      else scene.fog = new THREE.Fog(look.fog.getHex(), look.near, look.far);
      if (scene.background instanceof THREE.Color) scene.background.copy(look.fog); else scene.background = look.fog.clone();
    }
  }

  // ── per-step / per-frame ──────────────────────────────────────────────────────────────────────
  let lockClock = 0;
  let runSeen = false;
  function interactActive(): boolean {
    const p = app.player;
    if (!p || router.busy || walkingTo || app.simPaused) return false;
    return (p.mode === 'walk' || p.mode === 'crawling') && app.input.mode === 'walk';
  }

  /** Once the real run exists: open the wings the tycoon state lists and follow its changes. */
  function syncRun(): void {
    const run = app.run;
    if (!run || runSeen) return;
    runSeen = true;
    const sync = (): void => {
      try {
        for (const z of run.tycoon.state().zones) void setZoneOpen(z, true, true);
      } catch { /* not implemented yet */ }
    };
    sync();
    try { offs.push(run.tycoon.onChange(sync)); } catch { /* not implemented yet */ }
    refreshLocks();
  }

  const world: WorldHost = {
    root,
    slots: slotDefs,
    collision,
    interact,
    lights: pool.api as WorldLights,
    items: items.api,
    ready,
    get progress() { return jobsTotal === 0 ? 1 : jobsDone / jobsTotal; },
    prebuild,
    flushBuild() { pump(Infinity); },

    machine: (id) => recs.get(id)?.machine ?? undefined,
    machines: () => [...recs.values()].flatMap((r) => (r.machine ? [r.machine] : [])),
    slot: (id) => recs.get(id)?.def,
    zoneAt: (p: Vec3Like) => zones.zoneAt(p.x, p.z),
    nearestMachine(p, maxDist = NEAREST_DEFAULT_M) {
      let best: AnyMachine | null = null, bestD = maxDist;
      for (const r of recs.values()) {
        if (!r.machine) continue;
        const d = r.distanceTo(p);
        if (d <= bestD) { bestD = d; best = r.machine; }
      }
      return best;
    },
    pads: () => [...recs.values()].filter((r) => r.pad).map((r) => r.def),
    place,
    remove,
    setZoneOpen,
    isZoneOpen: (zone) => zoneOpen.get(zone) ?? true,

    prop<T extends WorldProp = WorldProp>(id: PropId): T | null { return (props.get(id) as T | undefined) ?? null; },
    anchor(name) {
      const a = anchors.get(name);
      if (a) return a;
      const dot = name.indexOf('.');
      const rec = recs.get(dot < 0 ? name : name.slice(0, dot));
      if (!rec) return null;
      return dot < 0 ? rec.group : (rec.machine?.model.anchors[name.slice(dot + 1)] ?? null);
    },
    registerAnchor(name, obj): Unsub {
      anchors.set(name, obj);
      return () => { if (anchors.get(name) === obj) anchors.delete(name); };
    },

    spawns: (kind) => level?.spawns?.[kind] ?? [],
    spawn(kind, index = 0) {
      const list = level?.spawns?.[kind] ?? level?.spawns?.solo ?? [];
      return list[index % Math.max(1, list.length)] ?? { pos: [0, 0, 0], yaw: 0 };
    },
    slotGroup: (id) => recs.get(id)?.group ?? null,
    lightLevelAt: (p) => pool.levelAt(p, 0.1 + 0.9 * (0.3 * ambientNow.r + 0.59 * ambientNow.g + 0.11 * ambientNow.b) * 2),
    isLocked: (id) => recs.get(id)?.locked ?? false,

    get seat() { return router.seat; },
    get seatPhase() { return router.phase; },
    occupy(mid, seat) {
      const rec = recs.get(mid);
      if (!rec?.machine) return;
      const s = seat ?? pickSeat(rec, rec.machine);
      if (s >= 0) router.request(mid, s);
    },
    standUp: () => router.standUp(),

    occupancy: () => router.occupancy(),
    applyOccupancy: (list) => router.applyOccupancy(list),
    bots: () => router.bots(),
    machineSnapshot: (mid, forPid) => router.snapshotOf(mid, forPid),
    applyMachineSnapshot: (mid, snap, from) => router.applySnapshot(mid, snap, from),
    dropPlayer: (pid) => router.dropPlayer(pid),
    onSlotChange(fn) { changeFns.add(fn); return () => { changeFns.delete(fn); }; },
    stats() {
      let machines = 0, visible = 0, padCount = 0;
      for (const r of recs.values()) { if (r.machine) { machines++; if (r.machine.visible) visible++; } if (r.pad) padCount++; }
      return { slots: recs.size, machines, visible, pads: padCount, lights: pool.size, colliders: collision.count, interactables: interact.size };
    },

    fixedUpdate(dt) {
      if (disposed) return;
      syncRun();
      interact.setActive(interactActive());
      interact.update(dt);
      for (const rec of recs.values()) {
        const m = rec.machine;
        if (!m || !rec.ready) continue;
        try { m._step(dt); } catch (e) { log.error('world', `${rec.id} tick`, e); }
      }
      lockClock += dt;
      if (lockClock >= LOCK_PERIOD_S) { lockClock = 0; refreshLocks(); }
    },

    frame(dt, time) {
      if (disposed) return;
      pump(BUILD_BUDGET_MS);
      try { level?.update?.(dt, time); } catch (e) { log.error('world', 'level update', e); }
      for (const p of props.values()) { try { p.update?.(dt); } catch (e) { log.error('world', `prop ${p.id}`, e); } }
      cull(dt);
      for (const rec of recs.values()) {
        const m = rec.machine;
        if (!m || !rec.ready || !m.visible) continue;
        try { m._frame(dt, time); } catch (e) { log.error('world', `${rec.id} frame`, e); }
      }
      juiceFx.update(dt);
      pool.update(dt, camera.position);
      lampGlow.update(dt);
      atmosphere(dt);
      items.update(dt);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      router.dispose();
      interact.clear();
      for (const o of offs.splice(0)) o();
      for (const rec of recs.values()) clearContent(rec);
      items.dispose();
      for (const p of props.values()) { try { p.dispose(); } catch (e) { log.error('world', `prop ${p.id}`, e); } }
      props.clear();
      try { level?.dispose?.(); } catch (e) { log.error('world', 'level dispose', e); }
      juiceFx.dispose();
      pool.dispose();
      collision.clear();
      changeFns.clear();
      anchors.clear();
      root.removeFromParent();
      hemi.dispose();
    },
  };
  return world;
}
