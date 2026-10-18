/**
 * Player contracts — TD-FROZEN. Implementation: PLAYER WP (`player/*`). Contract: TECH_SPEC §2.14.
 * `player/local.ts` re-exports these types (`export type * from './types'`) so the spec's import path works.
 *
 * FPS constants (PLAYER WP): eye 1.62 m (crouch 1.05), body AABB half-extents 0.25×0.9×0.25 (crouch 0.25×0.6×0.25),
 * walk 3.0 m/s, sprint 5.0, crouch 1.6, accel 30 m/s², friction 12/s, gravity 9.8, step-up ≤ 0.35 m,
 * pitch clamp ±85°, head-bob 0.035 m / 0.02 m at 1.9 Hz walk / 2.6 Hz sprint (× settings.headBob),
 * footstep sfx at each bob trough, fall below y = −12 → fade. Glide to a play pose: 0.6 s inOutCubic;
 * stand-up 0.45 s to a point 0.9 m in front of the interact box. Collateral modifiers (`player.*` hooks /
 * `PlayerFx`) scale speed, action speed and force crawl.
 */
import type * as THREE from 'three';
import type { Hex, InstanceId, PlayerId, V3 } from '@/core/types';
import type { Ease } from '@/core/tween';
import type { PlayPose } from '@/core/types';
import type { PlayerFx } from '@/game/types';
import type { MannequinActor, MannequinClip } from '@/kit/types';

export interface CinematicKey { pos: V3; look: V3; dur: number; ease?: Ease }

/** First-person hands / held items (own scene, fov 50, near 0.01 — TECH §11.7). */
export type HeldItem = 'none' | 'coin' | 'card' | 'totem' | 'tonic' | 'gun' | 'phone' | 'ticket' | 'ledger' | (string & {});
export interface Viewmodel {
  setVisible(on: boolean): void;
  hold(item: HeldItem, obj?: THREE.Object3D): void;
  /** One-shot hand animation: 'drink' | 'throw' | 'point' | 'flip' | 'punchCard' | 'recoil' … */
  play(anim: string): Promise<void>;
  /** Finger-tax / collateral looks (unsettling, not gory): visible fingers 0..5 and a porcelain hand. */
  setHandLook(o: { fingers?: number; porcelain?: boolean }): void;
  update(dt: number): void;
  /** Show or hide the wristwatch on the left wrist (optional: stubs may omit it). Anims also include 'grab' | 'checkWatch' | 'unwatch'. */
  setWatch?(on: boolean): void;
}

export interface LocalPlayer {
  readonly id: PlayerId;
  readonly camera: THREE.PerspectiveCamera;
  readonly pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  readonly mode: 'walk' | 'gliding' | 'seated' | 'falling' | 'ghost' | 'cinematic' | 'crawling' | 'carried';
  readonly seat: { mid: InstanceId; seat: number } | null;
  readonly viewmodel: Viewmodel;
  enterMachine(mid: InstanceId, seat: number, pose: PlayPose, poseMatrix: THREE.Matrix4): Promise<void>;
  exitMachine(): Promise<void>;
  teleport(pos: THREE.Vector3, yaw: number): void;
  cinematic(keys: CinematicKey[]): Promise<void>;
  shake(amp: number, dur: number): void;
  setGhost(on: boolean): void;
  /** Apply collateral/buff presentation + penalties (speed, crawl). Called by the game when `PlayerFx` changes. */
  applyFx(fx: Readonly<PlayerFx>): void;
  /** Carried by a teammate (legs lost): follows the carrier. */
  setCarriedBy(pid: PlayerId | null): void;
  /** Camera + movement owned by a cutscene (input locked, body hidden). */
  setCutscene(on: boolean): void;
}

/** Remote player visuals: mannequin avatar + nameplate + emotes, interpolated from `pts`. */
export interface RemoteAvatar {
  readonly pid: PlayerId;
  readonly actor: MannequinActor;
  readonly root: THREE.Group;
  setName(name: string, color: Hex): void;
  setPose(clip: MannequinClip | string): void;
  emote(id: string): void;
  /** Cracked-porcelain parts (collateral) shown on the body. */
  setPorcelain(parts: Array<'eye' | 'ear' | 'mouth' | 'hand' | 'legs'>): void;
  dispose(): void;
}
export interface AvatarManager {
  add(pid: PlayerId, name: string, color: Hex): RemoteAvatar;
  remove(pid: PlayerId): void;
  get(pid: PlayerId): RemoteAvatar | undefined;
  /** Feed an interpolated transform sample (host time ms). */
  sample(pid: PlayerId, t: number, p: V3, yaw: number, pitch: number, flags: number): void;
  update(dt: number, hostTimeMs: number): void;
  clear(): void;
}
