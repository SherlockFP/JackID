/**
 * World contracts — TD-FROZEN. Implementation: WORLD-ARCH (`level`, `lights`, `layout`, `props/**`) and
 * WORLD-SYS (`world`, `collision`, `interact`). Contract: TECH_SPEC §2.14, §5; ART_BIBLE §6.
 * `LocalAABB`, `SlotSize`, `ZoneId` are defined in `core/types` (kit/ needs them) and re-exported here.
 *
 * World units: metres, Y up, floor y = 0, north = −Z. Slot `rotY` ∈ {0,90,180,270}: machine front (+Z local)
 * faces 0 → +Z (south), 90 → +X (east), 180 → −Z (north), 270 → −X (west).
 */
import type * as THREE from 'three';
import type { GameMode, Hex, InstanceId, LocalAABB, MachineId, PlayerId, SlotSize, Unsub, V3, Vec3Like, ZoneId } from '@/core/types';
import type { AnyMachine } from '@/machines/_base/types';
import type { HomeRoomApi } from '@/game/home/contract';

export type { LocalAABB, SlotSize, ZoneId, KnownZoneId } from '@/core/types';

/** One placement position. **Ids, sizes and zones are the contract; coordinates may be tuned by WORLD-ARCH.** */
/**
 * `y` = floor height of the slot's dais / platform in metres (DECISIONS C25; WELL-01 dais y = 0.15). Optional, default 0.
 * Machines are placed on `y`; `pos[1]` stays the level-floor height used by the layout tables.
 */
export interface SlotDef { id: InstanceId; size: SlotSize; pos: V3; rotY: 0 | 90 | 180 | 270; zone: ZoneId; y?: number }

// ── interaction & collision (TECH_SPEC §2.14) ────────────────────────────────────────────────────
export interface Interactable {
  id: string; box: THREE.Box3;               // world space
  maxDist?: number;                          // default 2.2 m (tables 2.8)
  priority?: number;                         // higher wins when overlapping
  enabled(): boolean;
  label(): string;                           // translated, e.g. "Play Coin Flip"
  sub?(): string;                            // "Bet 5–100" / "Occupied: Ayşe" / "Locked until floor 3"
  onInteract(): void;
}
export interface InteractionSystem {
  add(i: Interactable): () => void;
  readonly focused: Interactable | null;     // updated each step: ray from camera centre, occluded by 'solid'
}
export interface CollisionWorld {
  addStatic(box: THREE.Box3, tag?: LocalAABB['tag']): number;
  addLocal(boxes: LocalAABB[], matrix: THREE.Matrix4, tag?: string): number[];  // machine colliders → world AABBs
  remove(id: number): void;
  setEnabled(id: number, on: boolean): void;   // trapdoor floor panels
  moveAndSlide(pos: THREE.Vector3, half: THREE.Vector3, delta: THREE.Vector3): { grounded: boolean; hitX: boolean; hitZ: boolean };
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { dist: number; id: number } | null;
  floorAt(x: number, z: number, fromY: number): number | null;   // null = hole
}

// ── props (WORLD-ARCH) ──────────────────────────────────────────────────────────────────────────
export interface WorldProp {
  readonly id: string;
  readonly root: THREE.Object3D;
  update?(dt: number): void;
  dispose(): void;
}
export interface TrapdoorProp extends WorldProp {
  readonly isOpen: boolean;
  /** Swing the plates under `who` (a player, or everyone). Resolves when fully open. */
  open(who?: PlayerId | 'all', dur?: number): Promise<void>;
  close(dur?: number): Promise<void>;
}
export interface ElevatorProp extends WorldProp {
  readonly doorsOpen: boolean;
  doors(open: boolean, dur?: number): Promise<void>;
  /** Cabin ride between floors (the Ascent / final ride). */
  ride(dir: 'up' | 'down', dur?: number): Promise<void>;
  /** Floor dial needle (1 = start; beyond the printed scale in endless). */
  setFloor(n: number, animate?: boolean): void;
}
export interface ClockProp extends WorldProp {
  /** 0..1 progress of the shift on the wall clock face. */
  setProgress(frac: number): void;
  setRemaining(sec: number, lastCall: boolean): void;
  alarm(on: boolean): void;
}
/** Diegetic quota board above the Debt Terminal (also read by the HUD for numbers). */
export interface QuotaBoardProp extends WorldProp {
  set(q: { due: number; deposited: number; ratio: number; timeLeft: number; lastCall: boolean; pace?: import('@/game/pace').Pace | null }): void;
  stamp(kind: 'PAID' | 'SHORT'): Promise<void>;
  /** "Who paid what" ledger lines (co-op). */
  setLedger(lines: Array<{ name: string; color: Hex; amount: number }>): void;
}
/** Lobby atrium stage (wave 75): a curtain, footlights and the dark Compere at a microphone. Anchors `stage.center`, `stage.compere`. */
export interface StageProp extends WorldProp {
  readonly compere: import('@/kit/types').MannequinActor;
  readonly curtainOpen: boolean;
  setCurtain(open: boolean, dur?: number): Promise<void>;
  /** The Compere talks (true) or stands idle (false). */
  speak(on: boolean): void;
}
/** Jackpot LED wall behind the Big One dais. The game feeds it already translated lines. */
export interface JackpotWallProp extends WorldProp {
  /** Up to 4 lines; the first is the big one. An empty list shows the idle title. */
  setLines(lines: string[]): void;
  /** A 1.8 s gold flash with a chasing border. */
  flash(): Promise<void>;
}
/** Prize showcase beside the cashier: 5 lit slots. */
export interface PrizeCaseProp extends WorldProp {
  readonly count: number;
  /** Already translated labels; the first 5 are shown, an empty slot stays dark. */
  setPrizes(labels: string[]): void;
}
/** Slow light show: chandeliers, footlights, wall border and zone pulses. Safe for reduce-flashing (no strobe). */
export interface LightShowProp extends WorldProp {
  readonly active: boolean;
  lightShow(dur?: number): void;
}
/** Known prop ids; the type stays open for decor props. */
export type PropId = 'clock' | 'trapdoor' | 'elevator' | 'quotaBoard' | 'stage' | 'jackpotWall' | 'prizeCase' | 'lightShow' | (string & {});

// ── lights (WORLD-ARCH `lights.ts`) ─────────────────────────────────────────────────────────────
export type WorldLightTarget = 'all' | ZoneId | InstanceId | THREE.Object3D;
/** Light-pool facade used by cutscenes, events, dread and big-win light shows. One pool of 6 PointLights, constant count. */
export interface WorldLights {
  /** Tween a target's light level (1 = normal, 0 = out) and optional colour grade. */
  setLevel(target: WorldLightTarget, level: number, dur?: number, color?: Hex | null): void;
  flicker(target: WorldLightTarget, amount: number, dur: number): void;
  /** One momentary bump (jackpot ripple, buff proc). */
  pulse(target: WorldLightTarget, o?: { color?: Hex; mul?: number; dur?: number }): void;
  /** Pit-wide strobe (Jackpot lightshow ART_BIBLE §9.5; honours reduceFlashing). */
  strobe(target: WorldLightTarget, hz: number, dur: number, color?: Hex): void;
  /** 0..1 horror grade: darker rooms, colder colour, shorter fog, more flicker. */
  setDread(v: number): void;
  /** The night cycle's ambient and fog multiplier (1 = lit, lower = dark), tweened over `dur` seconds. Separate from `setLevel('all')`, so no event resets it. */
  setAmbient(level: number, dur?: number): void;
  reset(): void;
}

// ── world items (totems, notes, pickups) ────────────────────────────────────────────────────────
export interface WorldItemSpec {
  id: string;
  kind: 'totem' | 'pickup' | 'note' | 'prop';
  model: THREE.Object3D;
  pos: V3; rotY?: number;
  /** Shows a glowing floor ring of this radius (Totems). */
  radius?: number; color?: Hex;
  interact?: { label(): string; sub?(): string; enabled(): boolean; onInteract(): void; maxDist?: number };
}
export interface WorldItemHandle {
  readonly id: string;
  readonly root: THREE.Object3D;
  setPos(p: V3, dur?: number): void;
  setRadius(r: number | null): void;
  setActive(on: boolean): void;
  remove(): void;
}

// ── the world ───────────────────────────────────────────────────────────────────────────────────
export interface WorldBuildOpts {
  mode: GameMode;
  seed: number;
  /** `?bench=<id>`: build the single-machine test room instead of the pit. */
  bench?: MachineId;
  /** Override slots/assignment (tests, randomised line-up per floor visit). */
  slots?: SlotDef[];
  assign?: Partial<Record<InstanceId, MachineId | null>>;
}
export interface World {
  /** Root group ("world" in the scene graph) holding level, props, machines. */
  readonly root: THREE.Group;
  readonly slots: readonly SlotDef[];
  readonly collision: CollisionWorld;
  readonly interact: InteractionSystem;
  readonly lights: WorldLights;
  readonly items: { spawn(spec: WorldItemSpec): WorldItemHandle; all(): readonly WorldItemHandle[] };

  // machines
  machine(id: InstanceId): AnyMachine | undefined;
  machines(): readonly AnyMachine[];
  slot(id: InstanceId): SlotDef | undefined;
  zoneAt(p: Vec3Like): ZoneId | null;
  nearestMachine(p: Vec3Like, maxDist?: number): AnyMachine | null;

  // tycoon expansion: empty pads, ordering, wings
  /** Slots with no machine ("FOR LEASE" stands). */
  pads(): readonly SlotDef[];
  /** Build + register a machine into a pad (delivery animation, colliders, interact, net routing). */
  place(slot: InstanceId, machineId: MachineId): Promise<AnyMachine | null>;
  remove(slot: InstanceId): Promise<void>;
  setZoneOpen(zone: ZoneId, open: boolean, animate?: boolean): Promise<void>;
  isZoneOpen(zone: ZoneId): boolean;

  // props & named anchors (cutscene targets: 'terminal', 'trapdoor', 'elevator.door', 'clock', …)
  prop<T extends WorldProp = WorldProp>(id: PropId): T | null;
  anchor(name: string): THREE.Object3D | null;
  registerAnchor(name: string, obj: THREE.Object3D): Unsub;

  /** The apartment's controls (wave 69 Home layer, src/world/home). Absent in bench rooms. */
  readonly home?: HomeRoomApi;

  fixedUpdate(dt: number): void;
  frame(dt: number, t: number): void;
  dispose(): void;
}
