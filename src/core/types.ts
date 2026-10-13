/**
 * Shared primitives — TD-FROZEN (change only via the Tech Director).
 *
 * Pure types plus a handful of tiny constants/helpers. Everything every layer needs to talk about
 * (ids, vectors, slots, poses) lives here so that `kit/`, `core/` and `machines/` never have to
 * import from each other (TECH_SPEC §1.1 rules 1–3). `world/types.ts` and `machines/_base/types.ts`
 * re-export the relevant bits so the spec's import paths keep working.
 */
import type * as THREE from 'three';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * 1..8 (host = 1); 0 = "team"/nobody. **Bots use negative ids** (`-1 - seat`), see {@link isBot}.
 * Never use a PlayerId as an array index without checking the sign.
 */
export type PlayerId = number;
export type Lang = 'en' | 'tr';
export type GameMode = 'debt' | 'coop' | 'versus' | 'free';
/** 0xRRGGBB. Colours appear on screen exactly as written (no colour management). */
export type Hex = number;
export type V3 = [number, number, number];
/** folder name, snake_case, e.g. 'coin_flip' */
export type MachineId = string;
/** slot id, e.g. 'B07' (unique machine instance) */
export type InstanceId = string;
export interface TimeInfo { real: number; sim: number; frame: number; step: number }
/** Returned by every subscribe-style API. */
export type Unsub = () => void;
/** Anything with x/y/z — `THREE.Vector3` qualifies. */
export type Vec3Like = { x: number; y: number; z: number };
/** A world position given as tuple, vector or (its world position of) an object. */
export type PosLike = V3 | Vec3Like | THREE.Object3D;

/** Reserved player ids. */
export const TEAM: PlayerId = 0;
export const isBot = (pid: PlayerId): boolean => pid < 0;
export const botId = (seat: number): PlayerId => -1 - seat;

// ── machine slots / zones (needed by kit/ and machines/, hence here) ─────────────────────────────
export type SlotSize = 'S' | 'M' | 'L' | 'XL';
export const SLOT_SIZES: readonly SlotSize[] = ['S', 'M', 'L', 'XL'];
/**
 * Footprint of each slot size in metres (w = X, d = Z, h = Y) and the free strip `stand` in front (+Z)
 * where players stand. Models must fit inside; the strip must stay free of colliders.
 */
export const SLOT_DIMS: Record<SlotSize, { w: number; d: number; h: number; stand: number }> = {
  S:  { w: 1.2, d: 1.0, h: 2.4, stand: 1.2 },
  M:  { w: 1.8, d: 1.4, h: 2.8, stand: 1.2 },
  L:  { w: 3.6, d: 3.0, h: 2.6, stand: 0.8 },   // tables: stools/seats are inside the footprint
  XL: { w: 5.0, d: 3.6, h: 6.0, stand: 1.6 },
};
/** Zones the reference layout uses. The union is open: level/GDD may introduce more (e.g. 'parlor'). */
export type KnownZoneId = 'atrium' | 'slots' | 'tables' | 'parlour' | 'arcade' | 'lottery' | 'services';
export type ZoneId = KnownZoneId | (string & {});

/** Axis-aligned box in machine-local space (metres). */
export interface LocalAABB { min: V3; max: V3; tag?: 'solid' | 'low' | 'walkable' }

/** Camera pose while seated at a machine (machine-local space). */
export interface PlayPose {
  pos: THREE.Vector3;             // camera position, machine-local
  look: THREE.Vector3;            // look-at point, machine-local
  fov?: number;                   // default 55
  mouse?: 'primary' | 'pick';     // default 'primary'
}
export interface SeatDef {
  pose: PlayPose;
  stand: THREE.Vector3;           // where the avatar body stands/sits (machine-local, y = 0)
  avatar: 'stand' | 'sit';
}
