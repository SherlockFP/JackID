/**
 * The seam between WORLD-SYS (this folder, `world.ts`) and WORLD-ARCH (`layout.ts`, `level.ts`, `props/**`).
 *
 * WORLD-SYS never imports those files directly: it discovers them with `import.meta.glob`, so either side can
 * land first and the world still runs (a small built-in hall + demo slots stand in until the real level exists).
 * What WORLD-SYS reads from them (all optional; unknown shapes are ignored with a dev warning):
 *
 *   layout.ts   `SLOTS: SlotDef[]` · `ZONES: ZoneDef[]` (or a record keyed by id) ·
 *               `ASSIGN: Record<'default' | GameMode, Partial<Record<InstanceId, MachineId | null>>>`
 *               or `assignment(mode)`
 *   level.ts    `buildLevel(ctx: LevelCtx): LevelBuild`  (alias `createLevel`) — geometry, static colliders, light
 *               hints, named anchors, props (clock, trapdoor, elevator, quotaBoard …), zone gates, spawn points.
 *
 * `GDD_ZONE_LOOK` carries the per-zone fog/ambient from GDD §8.7 so a layout that only lists rectangles still
 * gets the right atmosphere.
 */
import * as THREE from 'three';
import type { GameMode, Hex, InstanceId, MachineId, SlotSize, V3, ZoneId } from '@/core/types';
import { SLOT_DIMS } from '@/core/types';
import type { Kit } from '@/kit/types';
import type { TexGen } from '@/core/texgen/types';
import { log } from '@/core/log';
import type { CollisionWorld, InteractionSystem, SlotDef, WorldLights, WorldProp } from '../types';

// ── seam types ────────────────────────────────────────────────────────────────────────────────────
export interface ZoneDef {
  id: ZoneId;
  /** Floor footprint [x0, z0, x1, z1] in metres. Smaller rectangles win where zones overlap. */
  rect: readonly [number, number, number, number];
  fog?: { color: Hex; near: number; far: number };
  /** Ambient (hemisphere) colour. */
  ambient?: Hex;
  /** Behind a grille: starts closed (instances inside are locked) until `setZoneOpen(id, true)`. */
  gated?: boolean;
}

export type FlickerId = 'STEADY' | 'BUZZ' | 'DYING' | 'RARE' | 'CANDLE' | 'SICK' | 'STROBE' | 'CHASE' | 'RING' | (string & {});

/** A place a pooled point light may be parked (ART_BIBLE §1.7, TECH_SPEC §5.5). */
export interface LightHint {
  id: string;
  pos: V3;
  color: Hex;
  /** Default 1.2. */
  intensity?: number;
  /** Default 8 m. */
  range?: number;
  flicker?: FlickerId;
  zone?: ZoneId;
}

export interface GateDef {
  /** Blocks the doorway while closed. */
  colliders?: THREE.Box3[];
  /** Optional visual (grille). `setOpen` animates it. */
  prop?: WorldProp & { setOpen?(open: boolean, dur?: number): Promise<void> | void };
}

export interface SpawnPoint { pos: V3; yaw: number }
export type SpawnKind = 'solo' | 'mouth' | 'lift' | 'ghost' | 'bench';

export interface LevelBuild {
  /** Added under `world.root`. */
  root: THREE.Object3D;
  /** Static colliders (walls, floor plates, pillars). */
  statics?: Array<{ box: THREE.Box3; tag?: 'solid' | 'low' | 'walkable' }>;
  lights?: LightHint[];
  anchors?: Record<string, THREE.Object3D>;
  props?: Record<string, WorldProp>;
  gates?: Record<ZoneId, GateDef>;
  spawns?: Partial<Record<SpawnKind, SpawnPoint[]>>;
  update?(dt: number, t: number): void;
  dispose?(): void;
}

export interface LevelCtx {
  mode: GameMode;
  seed: number;
  slots: readonly SlotDef[];
  kit: Kit;
  tex: TexGen;
  /** Levels may register their colliders directly instead of returning `statics`. */
  collision: CollisionWorld;
  bench: boolean;
  /** Interaction ray (rooms: grille plates, lockers, the vent). Optional so the level builds headless. */
  interact?: InteractionSystem;
  /** Light-pool facade (marquee flicker, key-ready pulses). Optional. */
  lights?: WorldLights;
  /** Wing open state (grille plates hide when open). Defaults to open. */
  isZoneOpen?: (zone: ZoneId) => boolean;
}

export interface ArchProvider {
  slots: readonly SlotDef[];
  zones: readonly ZoneDef[];
  assign(mode: GameMode): Partial<Record<InstanceId, MachineId | null>>;
  buildLevel(ctx: LevelCtx): LevelBuild | null;
  /** True when the real WORLD-ARCH files were found. */
  readonly real: boolean;
}

/** GDD §8.7 — fog colour, near/far and ambient per zone. */
export const GDD_ZONE_LOOK: Readonly<Record<string, { fog: { color: Hex; near: number; far: number }; ambient: Hex }>> = {
  mouth:    { fog: { color: 0x1c1008, near: 8, far: 34 }, ambient: 0x4a3020 },
  well:     { fog: { color: 0x160c08, near: 8, far: 38 }, ambient: 0x3e2a1a },
  lobby:    { fog: { color: 0x160e08, near: 8, far: 34 }, ambient: 0x3a2a1c },
  midway:   { fog: { color: 0x1a0c20, near: 6, far: 28 }, ambient: 0x3a1c44 },
  cards:    { fog: { color: 0x08180e, near: 6, far: 26 }, ambient: 0x16442c },
  laundry:  { fog: { color: 0x0e2028, near: 7, far: 30 }, ambient: 0x1e4c5c },
  boiler:   { fog: { color: 0x240808, near: 6, far: 28 }, ambient: 0x4c1a10 },
  gallery:  { fog: { color: 0x10081c, near: 6, far: 28 }, ambient: 0x301a4c },
  wheels:   { fog: { color: 0x240a0a, near: 6, far: 28 }, ambient: 0x461a10 },
  parlour:  { fog: { color: 0x120808, near: 4, far: 18 }, ambient: 0x2c1c14 },
  counting: { fog: { color: 0x120a06, near: 4, far: 18 }, ambient: 0x2c1e12 },
  lift:     { fog: { color: 0x2a2418, near: 20, far: 60 }, ambient: 0x2a2418 },
  sump:     { fog: { color: 0x0a0c10, near: 4, far: 20 }, ambient: 0x1a1c24 },
};
export const DEFAULT_LOOK = GDD_ZONE_LOOK.well;

// ── discovery ─────────────────────────────────────────────────────────────────────────────────────
type AnyModule = Record<string, unknown>;
const layoutMods = import.meta.glob<AnyModule>('../layout.ts', { eager: true });
const levelMods = import.meta.glob<AnyModule>('../level.ts', { eager: true });
const first = (m: Record<string, AnyModule>): AnyModule | null => Object.values(m)[0] ?? null;

function normalizeZones(raw: unknown): ZoneDef[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw as object).map(([id, v]) => ({ id, ...(v as object) })) : [];
  const out: ZoneDef[] = [];
  for (const z of list as Array<Record<string, unknown>>) {
    const id = z.id as string | undefined;
    const r = (z.rect ?? z.bounds ?? z.footprint) as number[] | undefined;
    const rect = r && r.length === 4 ? r : typeof z.x0 === 'number' ? [z.x0, z.z0, z.x1, z.z1] as number[] : null;
    if (!id || !rect) continue;
    const look = GDD_ZONE_LOOK[id];
    out.push({
      id, rect: [rect[0], rect[1], rect[2], rect[3]],
      fog: (z.fog as ZoneDef['fog']) ?? look?.fog, ambient: (z.ambient as Hex | undefined) ?? look?.ambient,
      gated: (z.gated as boolean | undefined) ?? (z.opens !== undefined && z.opens !== 'always'),
    });
  }
  return out;
}

// ── built-in stand-ins ────────────────────────────────────────────────────────────────────────────
const DEMO_SLOTS: SlotDef[] = [
  { id: 'DEMO-S', size: 'S', pos: [-6, 0, -6], rotY: 0, zone: 'well' },
  { id: 'DEMO-M1', size: 'M', pos: [-2.5, 0, -6], rotY: 0, zone: 'well' },
  { id: 'DEMO-M2', size: 'M', pos: [0.5, 0, -6], rotY: 0, zone: 'well' },
  { id: 'DEMO-L', size: 'L', pos: [5, 0, -6], rotY: 0, zone: 'well' },
  { id: 'DEMO-XL', size: 'XL', pos: [0, 0, -13], rotY: 0, zone: 'well' },
];

/** Single-slot test room for `?bench=<id>`: 12 × 12 m, machine against the north wall, player spawns south. */
export function benchSlot(size: SlotSize): SlotDef {
  const d = SLOT_DIMS[size];
  return { id: 'BENCH', size, pos: [0, 0, -6 + d.d / 2 + 0.3], rotY: 0, zone: 'well' };
}

function rectOf(slots: readonly SlotDef[], bench: boolean): [number, number, number, number] {
  if (bench) return [-6, -6, 6, 6];
  let x0 = -12, z0 = -16, x1 = 12, z1 = 10;
  for (const s of slots) {
    const d = SLOT_DIMS[s.size];
    const r = Math.max(d.w, d.d) / 2 + d.stand + 2;
    x0 = Math.min(x0, s.pos[0] - r); x1 = Math.max(x1, s.pos[0] + r);
    z0 = Math.min(z0, s.pos[2] - r); z1 = Math.max(z1, s.pos[2] + r);
  }
  return [x0, z0, x1, z1];
}

/** Plain hall (floor, four walls, corner lights) used until WORLD-ARCH's level exists and for the bench room. */
function buildFallbackLevel(ctx: LevelCtx): LevelBuild {
  const [x0, z0, x1, z1] = rectOf(ctx.slots, ctx.bench);
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = 4.2, T = 0.3;
  const root = new THREE.Group();
  root.name = 'level:fallback';
  const { kit } = ctx;
  const floorMat = { color: 0x3a3530 };
  const wallMat = { color: 0x4a1a1e };
  const slab = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: object): THREE.Mesh =>
    kit.box(sx, sy, sz, m as never, { pos: [x, y, z], parent: root });
  slab(w, 0.3, d, cx, -0.15, cz, floorMat);
  slab(w + 2 * T, H, T, cx, H / 2, z0 - T / 2, wallMat);
  slab(w + 2 * T, H, T, cx, H / 2, z1 + T / 2, wallMat);
  slab(T, H, d, x0 - T / 2, H / 2, cz, wallMat);
  slab(T, H, d, x1 + T / 2, H / 2, cz, wallMat);
  const box = (a: number, b: number, c: number, e: number, f: number, g: number): THREE.Box3 => new THREE.Box3(new THREE.Vector3(a, b, c), new THREE.Vector3(e, f, g));
  const lights: LightHint[] = [];
  for (const [i, [lx, lz]] of ([[x0 + 3, z0 + 3], [x1 - 3, z0 + 3], [x0 + 3, z1 - 3], [x1 - 3, z1 - 3], [cx, cz]] as Array<[number, number]>).entries()) {
    lights.push({ id: `fallback:${i}`, pos: [lx, 3.4, lz], color: 0xffb45a, intensity: 1.1, range: 10, flicker: 'STEADY', zone: 'well' });
  }
  return {
    root,
    statics: [
      { box: box(x0, -0.5, z0, x1, 0, z1), tag: 'walkable' },
      { box: box(x0 - T, 0, z0 - T, x1 + T, H, z0) }, { box: box(x0 - T, 0, z1, x1 + T, H, z1 + T) },
      { box: box(x0 - T, 0, z0, x0, H, z1) }, { box: box(x1, 0, z0, x1 + T, H, z1) },
    ],
    lights,
    spawns: {
      solo: [{ pos: [cx, 0, z1 - 3], yaw: 0 }], bench: [{ pos: [0, 0, 3.5], yaw: 0 }],
      mouth: [{ pos: [cx, 0, z1 - 3], yaw: 0 }], ghost: [{ pos: [cx, 1, cz], yaw: 0 }], lift: [{ pos: [cx, 0, z1 - 3], yaw: 0 }],
    },
  };
}

/** Find WORLD-ARCH's modules (or fall back to the built-in hall). */
export function loadArch(): ArchProvider {
  const layout = first(layoutMods), level = first(levelMods);
  const slots = (layout?.SLOTS ?? layout?.slots) as SlotDef[] | undefined;
  const zones = normalizeZones(layout?.ZONES ?? layout?.zones);
  const assignTable = (layout?.ASSIGN ?? layout?.assign) as unknown;
  const assignFn = (layout?.assignment ?? layout?.assignFor) as ((m: GameMode) => Partial<Record<InstanceId, MachineId | null>>) | undefined;
  const build = (level?.buildLevel ?? level?.createLevel) as ((c: LevelCtx) => LevelBuild) | undefined;

  if (layout && !slots) log.warn('world', 'layout.ts found but exports no SLOTS — using demo slots');
  if (level && !build) log.warn('world', 'level.ts found but exports no buildLevel() — using the fallback hall');

  return {
    real: !!(slots && build),
    slots: slots ?? DEMO_SLOTS,
    zones,
    assign(mode) {
      if (typeof assignFn === 'function') return assignFn(mode) ?? {};
      if (assignTable && typeof assignTable === 'object') {
        const t = assignTable as Record<string, Partial<Record<InstanceId, MachineId | null>>>;
        return { ...(t.default ?? {}), ...(t[mode] ?? {}) };
      }
      return {};
    },
    buildLevel(ctx) {
      if (typeof build === 'function' && !ctx.bench) {
        try { return build(ctx); } catch (e) { log.error('world', 'buildLevel failed, using the fallback hall', e); }
      }
      return buildFallbackLevel(ctx);
    },
  };
}

export function fallbackZones(slots: readonly SlotDef[], bench: boolean): ZoneDef[] {
  const [x0, z0, x1, z1] = rectOf(slots, bench);
  return [{ id: 'well', rect: [x0, z0, x1, z1], ...GDD_ZONE_LOOK.well }];
}
