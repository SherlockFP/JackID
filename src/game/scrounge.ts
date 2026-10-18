/**
 * THE SCROUNGE (broke-state side job). When the pocket cannot cover the cheapest bet AND the bank has nothing to give back, the
 * casino floor gets critters: 3 to 5 rats and cockroaches that scurry near walls and machines. Walk within 1 m, press E, and the
 * critter goes into the pocket of the player (carried, up to 6). Sell them at the pawn window or the cashier for coins. A
 * cockroach is worth 1 coin, a rat 2. Coins from bugs stop at 12 per Night, so the side job cannot be farmed.
 *
 * Also the WATCH: the run starts with a watch on the wrist. Once per run, while broke, the player can sell it at the pawn window
 * or the cashier for 8 coins. The hands then lose the watch.
 *
 * Pure logic only: no i18n, no THREE, no app. The run is passed in as a small structural view (balance, cheapestBet, bank, earn,
 * and the Night). Movement uses the seeded rng and the sim `dt`, so a seed always plays out the same. Saved with `snapshot` and
 * `restore`. `mountScrounge` (below) is the thin layer that spawns the visuals and registers the E interactions.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import type { Kit } from '@/kit/types';
import type { World } from '@/world/types';

/** A sound on the scrounge: a catch squeaks, a sale hands over cash. Silent when there is no audio (benches, tests). */
const sfx = (name: string, pos?: THREE.Object3D): void => {
  try { app.audio.play(name, pos ? { pos } : undefined); } catch { /* no audio in benches */ }
};

export type CritterKind = 'rat' | 'roach';

/** Coins a sold critter pays. */
export const CRITTER_VALUE: Readonly<Record<CritterKind, number>> = { roach: 1, rat: 2 };
/** Critters on the floor when a broke spell starts. */
export const SCROUNGE_MIN_SPAWN = 3;
export const SCROUNGE_MAX_SPAWN = 5;
/** Most critters the player can carry at once. */
export const SCROUNGE_CARRY_MAX = 6;
/** Reach of a catch, metres (the E press must come from this close). */
export const SCROUNGE_REACH_M = 1;
/** Most coins bugs can pay in one Night. */
export const SCROUNGE_NIGHT_CAP = 12;
/** Coins for the wristwatch (once per run, while broke). */
export const SCROUNGE_WATCH_PRICE = 8;
/** Scurry speed (m/s) and how far a critter wanders from its anchor (m). */
export const SCURRY_SPEED = 1.6;
export const SCURRY_RANGE = 1.5;
/** Seconds a critter sits still between scurries. */
const PAUSE_MIN = 0.4;
const PAUSE_MAX = 1.8;
/** Seconds before a new batch appears once every critter on the floor has been caught (while still broke). */
const RESPAWN_MIN = 20;
const RESPAWN_MAX = 40;

/** The part of the run the scrounge reads and writes. A `DebtRun` fits it. */
export interface ScroungeRun {
  balance(cur: 'coin' | 'ticket'): number;
  cheapestBet(): number;
  bank(): { withdrawable: number };
  earn(cur: 'coin', amount: number, reason: string): void;
  /** The Night in progress (1-based). Optional: when it is missing the Night cap never resets. */
  night?(): number;
}

/** A place critters may wander near: a wall or machine slot. */
export interface ScroungeSpot { x: number; z: number }

export interface ScroungeOpts {
  seed: number;
  spots: readonly ScroungeSpot[];
}

export interface Critter {
  id: number;
  kind: CritterKind;
  x: number;
  z: number;
  /** The spot it wanders around. */
  ax: number;
  az: number;
  /** Where it is scurrying to. */
  tx: number;
  tz: number;
  /** Seconds left to sit still before the next scurry. */
  pause: number;
}

export type CatchResult =
  | { ok: true; id: number; kind: CritterKind; value: number }
  | { ok: false; reason: 'none' | 'full' };

export type SellResult =
  | { ok: true; n: number; coins: number }
  | { ok: false; reason: 'none' | 'capped' };

export type WatchResult =
  | { ok: true; coins: number }
  | { ok: false; reason: 'gone' | 'not-broke' };

export interface ScroungeView {
  broke: boolean;
  critters: readonly Critter[];
  carried: { rat: number; roach: number; total: number };
  carryMax: number;
  /** Coins bugs paid tonight, and what is left before the Night cap. */
  nightEarned: number;
  nightLeft: number;
  watchOwned: boolean;
  watchSold: boolean;
  canSellWatch: boolean;
}

export interface ScroungeSave {
  v: 1;
  night: number;
  earned: number;
  carry: { rat: number; roach: number };
  watchOwned: boolean;
  watchSold: boolean;
  critters: Critter[];
  nextId: number;
  respawnIn: number;
  wasBroke: boolean;
  rng: [number, number, number, number];
}

export interface Scrounge {
  /** Sim tick. Spawns or clears the critters as the broke state turns on or off, and scurries them. */
  tick(dt: number): void;
  /** A Night starts: the bug cap resets. (`tick` also calls this when `run.night()` moves on.) */
  beginNight(n: number): void;
  /** Whether the pocket is broke right now (below the cheapest bet and nothing to withdraw). */
  isBroke(): boolean;
  state(): ScroungeView;
  /** Catch the critter nearest to (x, z) within the reach. */
  catchNear(x: number, z: number): CatchResult;
  /** Catch a specific critter (the E prompt on it). */
  catchById(id: number): CatchResult;
  /** Sell everything carried at a sell station. Pays up to the Night cap. */
  sell(): SellResult;
  /** Sell the wristwatch (broke only, once per run). */
  sellWatch(): WatchResult;
  snapshot(): ScroungeSave;
  restore(s: unknown): void;
}

const toCount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const toNum = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Broke: the pocket is below the cheapest bet and the bank has nothing it can give back. */
export function isBroke(pocket: number, minBet: number, bankWithdrawable: number): boolean {
  return pocket < minBet && bankWithdrawable <= 0;
}

/** Coins a set of carried critters is worth (before the Night cap). */
export function carriedValue(carry: { rat: number; roach: number }): number {
  return carry.rat * CRITTER_VALUE.rat + carry.roach * CRITTER_VALUE.roach;
}

export function createScrounge(run: ScroungeRun, opts: ScroungeOpts): Scrounge {
  const rng: Rng = createRng(opts.seed);
  const spots: ScroungeSpot[] = opts.spots.map((s) => ({ x: s.x, z: s.z }));
  let night = 0;
  let earned = 0;
  let carry = { rat: 0, roach: 0 };
  let watchOwned = true;
  let watchSold = false;
  let critters: Critter[] = [];
  let nextId = 1;
  let respawnIn = 0;
  let wasBroke = false;

  const carryTotal = (): number => carry.rat + carry.roach;
  const brokeNow = (): boolean => isBroke(Math.floor(run.balance('coin')), run.cheapestBet(), run.bank().withdrawable);

  /** A fresh critter next to a spot, sitting still for a moment. */
  function spawnOne(): void {
    const spot = rng.pick(spots);
    const kind: CritterKind = rng.weighted<CritterKind>(['roach', 'rat'], [3, 2]);
    const x = spot.x + rng.float(-SCURRY_RANGE, SCURRY_RANGE);
    const z = spot.z + rng.float(-SCURRY_RANGE, SCURRY_RANGE);
    critters.push({ id: nextId++, kind, x, z, ax: spot.x, az: spot.z, tx: x, tz: z, pause: rng.float(0, PAUSE_MAX) });
  }

  function spawnBatch(): void {
    respawnIn = rng.float(RESPAWN_MIN, RESPAWN_MAX);
    if (spots.length === 0) return;
    const n = rng.int(SCROUNGE_MIN_SPAWN, SCROUNGE_MAX_SPAWN);
    for (let i = 0; i < n; i++) spawnOne();
  }

  function scurry(c: Critter, dt: number): void {
    if (c.pause > 0) {
      c.pause -= dt;
      if (c.pause > 0) return;
      // Pick the next place to scurry to, near the anchor.
      c.tx = c.ax + rng.float(-SCURRY_RANGE, SCURRY_RANGE);
      c.tz = c.az + rng.float(-SCURRY_RANGE, SCURRY_RANGE);
      c.pause = 0;
    }
    const dx = c.tx - c.x;
    const dz = c.tz - c.z;
    const d = Math.hypot(dx, dz);
    const step = SCURRY_SPEED * dt;
    if (d <= step) {
      c.x = c.tx;
      c.z = c.tz;
      c.pause = rng.float(PAUSE_MIN, PAUSE_MAX);
    } else {
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
    }
  }

  function takeCritter(c: Critter): CatchResult {
    if (carryTotal() >= SCROUNGE_CARRY_MAX) return { ok: false, reason: 'full' };
    critters = critters.filter((o) => o.id !== c.id);
    carry = { ...carry, [c.kind]: carry[c.kind] + 1 };
    if (critters.length === 0) respawnIn = rng.float(RESPAWN_MIN, RESPAWN_MAX);
    return { ok: true, id: c.id, kind: c.kind, value: CRITTER_VALUE[c.kind] };
  }

  const api: Scrounge = {
    tick(dt: number): void {
      const n = run.night?.();
      if (n !== undefined && n !== night) api.beginNight(n);
      const broke = brokeNow();
      if (!broke) {
        critters = [];
        respawnIn = 0;
        wasBroke = false;
        return;
      }
      if (!wasBroke) {
        wasBroke = true;
        spawnBatch();
      } else if (critters.length === 0) {
        respawnIn -= dt;
        if (respawnIn <= 0) spawnBatch();
      }
      for (const c of critters) scurry(c, dt);
    },

    beginNight(n: number): void {
      night = n;
      earned = 0;
    },

    isBroke: brokeNow,

    state(): ScroungeView {
      const broke = brokeNow();
      return {
        broke,
        critters: critters.map((c) => ({ ...c })),
        carried: { rat: carry.rat, roach: carry.roach, total: carryTotal() },
        carryMax: SCROUNGE_CARRY_MAX,
        nightEarned: earned,
        nightLeft: Math.max(0, SCROUNGE_NIGHT_CAP - earned),
        watchOwned,
        watchSold,
        canSellWatch: watchOwned && !watchSold && broke,
      };
    },

    catchNear(x: number, z: number): CatchResult {
      let best: Critter | null = null;
      let bestD = SCROUNGE_REACH_M;
      for (const c of critters) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d <= bestD) { best = c; bestD = d; }
      }
      if (!best) return { ok: false, reason: 'none' };
      return takeCritter(best);
    },

    catchById(id: number): CatchResult {
      const c = critters.find((o) => o.id === id);
      if (!c) return { ok: false, reason: 'none' };
      return takeCritter(c);
    },

    sell(): SellResult {
      const n = carryTotal();
      if (n === 0) return { ok: false, reason: 'none' };
      const left = Math.max(0, SCROUNGE_NIGHT_CAP - earned);
      if (left <= 0) return { ok: false, reason: 'capped' };
      const coins = Math.min(carriedValue(carry), left);
      earned += coins;
      carry = { rat: 0, roach: 0 };
      if (coins > 0) run.earn('coin', coins, 'scrounge:sell');
      return { ok: true, n, coins };
    },

    sellWatch(): WatchResult {
      if (!watchOwned || watchSold) return { ok: false, reason: 'gone' };
      if (!brokeNow()) return { ok: false, reason: 'not-broke' };
      watchOwned = false;
      watchSold = true;
      run.earn('coin', SCROUNGE_WATCH_PRICE, 'scrounge:watch');
      return { ok: true, coins: SCROUNGE_WATCH_PRICE };
    },

    snapshot(): ScroungeSave {
      const [a, b, c, d] = rng.getState();
      return {
        v: 1,
        night,
        earned,
        carry: { ...carry },
        watchOwned,
        watchSold,
        critters: critters.map((o) => ({ ...o })),
        nextId,
        respawnIn,
        wasBroke,
        rng: [a, b, c, d],
      };
    },

    restore(s: unknown): void {
      const e = s && typeof s === 'object' ? (s as Partial<ScroungeSave>) : {};
      night = toCount(e.night);
      earned = Math.min(SCROUNGE_NIGHT_CAP, toCount(e.earned));
      carry = {
        rat: toCount(e.carry?.rat),
        roach: toCount(e.carry?.roach),
      };
      while (carry.rat + carry.roach > SCROUNGE_CARRY_MAX) {
        if (carry.roach > 0) carry.roach -= 1; else carry.rat -= 1;
      }
      watchSold = e.watchSold === true;
      watchOwned = e.watchOwned !== false && !watchSold;
      const list = Array.isArray(e.critters) ? e.critters : [];
      critters = [];
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const k = (raw as Critter).kind;
        if (k !== 'rat' && k !== 'roach') continue;
        critters.push({
          id: toCount((raw as Critter).id),
          kind: k,
          x: toNum((raw as Critter).x, 0), z: toNum((raw as Critter).z, 0),
          ax: toNum((raw as Critter).ax, 0), az: toNum((raw as Critter).az, 0),
          tx: toNum((raw as Critter).tx, 0), tz: toNum((raw as Critter).tz, 0),
          pause: Math.max(0, toNum((raw as Critter).pause, 0)),
        });
      }
      nextId = Math.max(toCount(e.nextId), 1, ...critters.map((o) => o.id + 1));
      respawnIn = Math.max(0, toNum(e.respawnIn, 0));
      wasBroke = e.wasBroke === true;
      const st = Array.isArray(e.rng) && e.rng.length === 4 ? (e.rng as [number, number, number, number]) : null;
      if (st) rng.setState(st);
    },
  };
  return api;
}

// ── mount (visuals + E interactions) ──────────────────────────────────────────────────────────────

/** A critter's visual: the root object (placed by the scrounge) and an optional cleanup. */
export interface CritterVisual { root: THREE.Object3D; dispose?(): void }
export type CreateCritter = (kind: CritterKind, kit: Kit) => CritterVisual;

/** The module that may export `createCritter` (src/world/critters). Absent until it is written: the mount falls back to a box. */
const critterModules = import.meta.glob<{ createCritter?: CreateCritter }>('../world/critters{.ts,/index.ts}', { eager: true });

function resolveCritterFactory(): CreateCritter | null {
  for (const m of Object.values(critterModules)) {
    if (typeof m?.createCritter === 'function') return m.createCritter;
  }
  return null;
}

/** The sell stations: the pawn window and the cashier (lobby slots). */
const SELL_SLOTS = ['LOB-PAWN', 'LOB-CASH'] as const;
/** Reach of a catch and of a sell (the interact box is grown by this). */
const BOX_HALF = 0.25;
const BOX_H = 0.4;
const SIM_STEP_S = 0.05;

/** The part of the hands the watch uses (optional: the viewmodel may not have these yet). */
interface WatchHands { setWatch?(on: boolean): void; play?(name: string): void }

const live = new WeakMap<object, Scrounge>();

/** The scrounge for a run, once `mountScrounge` has run for it. Null before. */
export function scroungeFor(run: object): Scrounge | null {
  return live.get(run) ?? null;
}

function toast(text: string): void {
  app.ui?.toast(text);
}

function hideWatch(): void {
  const hands = app.player?.viewmodel as unknown as WatchHands | undefined;
  hands?.setWatch?.(false);
  hands?.play?.('unwatch');
}

/** Spawns the critter visuals and the sell stations for a run on a world. Returns the unmount. Ticks on the sim timer. */
export function mountScrounge(run: ScroungeRun & object, world: World): () => void {
  const spots: ScroungeSpot[] = world.slots
    .filter((s) => !s.id.startsWith('LOB-'))
    .map((s) => ({ x: s.pos[0], z: s.pos[2] }));
  const seed = hashSeed('scrounge', (run as { seed?: number }).seed ?? 0);
  const sc = createScrounge(run, { seed, spots });
  live.set(run, sc);

  const group = new THREE.Group();
  world.root.add(group);
  const make = resolveCritterFactory();
  const visuals = new Map<number, { vis: CritterVisual; box: THREE.Box3; off: () => void }>();
  const offs: Array<() => void> = [];

  const fallback = (kind: CritterKind): CritterVisual => {
    const size = kind === 'rat' ? 0.22 : 0.1;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * 0.6, size * 1.6),
      new THREE.MeshBasicMaterial({ color: kind === 'rat' ? 0x4a4038 : 0x3a2a18 }),
    );
    return { root: mesh, dispose: () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } };
  };

  const sync = (): void => {
    const view = sc.state();
    const keep = new Set<number>();
    for (const c of view.critters) {
      keep.add(c.id);
      let v = visuals.get(c.id);
      if (!v) {
        const vis = make ? make(c.kind, app.kit) : fallback(c.kind);
        group.add(vis.root);
        const box = new THREE.Box3();
        const off = world.interact.add({
          id: `scrounge.${c.id}`,
          box,
          maxDist: SCROUNGE_REACH_M,
          priority: 1,
          enabled: () => true,
          label: () => t(`scrounge.label.${c.kind}`),
          sub: () => t('scrounge.sub.carry', { n: sc.state().carried.total, max: SCROUNGE_CARRY_MAX }),
          onInteract: () => {
            const r = sc.catchById(c.id);
            if (!r.ok) {
              if ('reason' in r && r.reason === 'full') toast(t('scrounge.toast.full'));
              return;
            }
            sfx('ratSqueak', vis.root);
            toast(t('scrounge.toast.caught', { kind: t(`scrounge.name.${r.kind}`), n: sc.state().carried.total, max: SCROUNGE_CARRY_MAX }));
            sync();
          },
        });
        v = { vis, box, off };
        visuals.set(c.id, v);
      }
      v.vis.root.position.set(c.x, 0.05, c.z);
      v.vis.root.rotation.y = Math.atan2(c.tx - c.x, c.tz - c.z);
      v.box.setFromCenterAndSize(
        new THREE.Vector3(c.x, 0.15, c.z),
        new THREE.Vector3(BOX_HALF * 2, BOX_H, BOX_HALF * 2),
      );
    }
    for (const [id, v] of visuals) {
      if (keep.has(id)) continue;
      v.off();
      group.remove(v.vis.root);
      v.vis.dispose?.();
      visuals.delete(id);
    }
  };

  // Sell stations: the pawn window and the cashier. One prompt each: bugs first, then the watch.
  for (const slotId of SELL_SLOTS) {
    const slot = world.slot(slotId);
    if (!slot) continue;
    const y = slot.y ?? 0;
    const box = new THREE.Box3(
      new THREE.Vector3(slot.pos[0] - 1, y, slot.pos[2] - 1),
      new THREE.Vector3(slot.pos[0] + 1, y + 2.2, slot.pos[2] + 1),
    );
    offs.push(world.interact.add({
      id: `scrounge.sell.${slotId}`,
      box,
      priority: 2,
      enabled: () => { const v = sc.state(); return v.carried.total > 0 || v.canSellWatch; },
      label: () => (sc.state().carried.total > 0 ? t('scrounge.label.sell') : t('scrounge.label.watch')),
      sub: () => {
        const v = sc.state();
        return v.carried.total > 0
          ? t('scrounge.sub.sell', { n: v.carried.total, left: v.nightLeft })
          : t('scrounge.sub.watch', { c: SCROUNGE_WATCH_PRICE });
      },
      onInteract: () => {
        if (sc.state().carried.total > 0) {
          const r = sc.sell();
          if (r.ok && r.coins > 0) sfx('sellItem');
          if (r.ok) toast(r.coins === 0 ? t('scrounge.toast.capped') : t(r.n === 1 ? 'scrounge.toast.sold.one' : 'scrounge.toast.sold.other', { n: r.n, c: r.coins }));
          else toast(t('scrounge.toast.capped'));
        } else {
          const r = sc.sellWatch();
          if (r.ok) { sfx('cashHandle'); hideWatch(); toast(t('scrounge.toast.watch', { c: r.coins })); }
          else if ('reason' in r && r.reason === 'not-broke') toast(t('scrounge.toast.notbroke'));
        }
        sync();
      },
    }));
  }

  if (!sc.state().watchOwned) hideWatch();

  const stop = app.timers.sim.every(SIM_STEP_S, () => {
    sc.tick(SIM_STEP_S);
    sync();
  });

  return () => {
    stop();
    for (const off of offs) off();
    for (const v of visuals.values()) { v.off(); v.vis.dispose?.(); }
    visuals.clear();
    group.removeFromParent();
    live.delete(run);
  };
}
