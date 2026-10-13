/**
 * The machine contract — TD-FROZEN. Implementation of the base classes: `MachineBase.ts`, `TableBase.ts` (TD).
 * Contract: TECH_SPEC §3, extended for party tables (2–8 seats, bots, hidden information), tycoon hooks
 * (headless play, idle yield, upgrade visuals) and cutscenes (BRIEF ADDENDA 1, 6, 7, 8).
 *
 * `SlotSize`, `ZoneId`, `LocalAABB`, `PlayPose`, `SeatDef` live in `core/types` (kit/ needs them) and are
 * re-exported here so the spec's import paths keep working.
 *
 * Model bounds rule: everything inside `x∈[−w/2,w/2], z∈[−d/2,d/2], y∈[0,h]`; the strip
 * `z∈[d/2, d/2+stand]` in front must stay free of colliders (players stand there).
 *
 * Anchors a model may expose (`anchors.<name>`): `speaker` (REQUIRED, positional sfx), `prompt`, `light`
 * (pooled-light hint, `userData.color`/`intensity`), `insideGlass`, `coinOut` (FX origin for wins),
 * `plate` (tycoon Service Plate), `staff` (where an Attendant mannequin sits), `dealer`, plus machine-specific ones.
 */
import type * as THREE from 'three';
import type {
  GameMode, Hex, InstanceId, Json, LocalAABB, MachineId, PlayerId, PlayPose, SeatDef, SlotSize, TimeInfo, ZoneId,
} from '@/core/types';
import type { AudioEngine } from '@/core/audio/types';
import type { EventBus, GameEvents } from '@/core/events';
import type { CutscenePlayer } from '@/core/cutscene/types';
import type { FxApi } from '@/core/fx/types';
import type { Input } from '@/core/input/types';
import type { TweenSystem } from '@/core/tween';
import type { Timers } from '@/core/timers';
import type { UIOverlay } from '@/core/ui/types';
import type { Kit } from '@/kit/types';
import type { RunApi, HeadlessPlay } from '@/game/types';
import type { SlotDef } from '@/world/types';
import type { MachineBase } from './MachineBase';

export type { SlotSize, ZoneId, LocalAABB, PlayPose, SeatDef } from '@/core/types';
export { SLOT_DIMS } from '@/core/types';

export type MachineCategory = 'slot' | 'video' | 'table' | 'card' | 'dice' | 'wheel' | 'physics'
  | 'lottery' | 'skill' | 'oddity' | 'system'
  | 'party'   // multi-seat card/tile/dice party games (Last Card, Okey, Tavla …)
  | 'duel';   // hidden-information duels (the Devil's Table)
export interface MachineStrings { en: Record<string, string>; tr: Record<string, string> }  // must contain name, desc

/** Multi-seat party game configuration (BRIEF ADDENDUM 6). Requires `shared: true` and a `TableBase` class. */
export interface PartyDef {
  /** Seats actually played: 2..8, ≤ `def.seats`. Empty seats are bot-filled when `bots` and the room allows. */
  minPlayers: number; maxPlayers: number;
  bots: boolean;
  /** Bot difficulty levels the AI implements (default 3). */
  botLevels?: 1 | 2 | 3;
  /** Optional pot buy-in (coins, scaled by the stake index) feeding the run economy/quota. */
  buyIn?: { min: number; max: number };
  /** Spectators may place side bets on a seated player. */
  spectatorBets?: boolean;
  /** Player-visible rule toggles with defaults (stacking +2, 7-0 swap, jump-in …); host edits at the table. */
  houseRules?: Record<string, boolean | number | string>;
  /** Per-seat private information exists (hands, tiles, shells) ⇒ use `emitPrivate` and redacted snapshots. */
  hidden: boolean;
  /** Seconds per turn before the auto-move (default 20). */
  turnTimerS?: number;
}

export interface MachineDef {
  id: MachineId;                  // === folder name
  category: MachineCategory;
  slotSize: SlotSize;             // must fit SLOT_DIMS[slotSize]
  zone: ZoneId;                   // preferred zone for auto-placement
  seats: number;                  // 1 for solo machines; >1 ⇒ class must extend TableBase (max 8)
  shared: boolean;                // true ⇒ TableBase, host-resolved
  minBet: number; maxBet: number; // coins; system machines 0/0
  betSteps?: number[];            // default: doubling from minBet to maxBet
  maxPayoutMult: number;          // host sanity cap: gross ≤ bet × this (jackpot claims exempt)
  rtp?: number;                   // informational target RTP (catalogue)
  tier?: number;                  // unlock: available from deadline index ≥ tier (0 = always)
  modes?: GameMode[];             // default: all
  attractRadius?: number;         // m, default 14
  strings: MachineStrings;        // keys auto-prefixed 'm.<id>.'
  // ── v1 extensions (all optional) ──
  /** Free-form tags used by charm affinity / modifier scopes / contracts (suit names, 'solo', 'table', 'physics'…). */
  tags?: string[];
  /** Pulls / action points one play costs when the run uses a per-play budget (default 1). */
  actionCost?: number;
  /** Idle yield `Y` for staff income (coins/min per stake index at staff level 1); 0/undefined = not staffable. */
  idleYield?: number;
  /** Headless round for staff auto-play and balance sims: same rules as `present`, no visuals. */
  headless?: HeadlessPlay;
  /** `m.<id>.<name>` hooks this machine honours → one-line description (documentation + debug UI). */
  modHooks?: Record<string, string>;
  /** Present for party tables. */
  party?: PartyDef;
}

export interface MachineModel<P extends object = Record<string, THREE.Object3D>> {
  root: THREE.Group;              // origin = floor centre of footprint, +Z = front, Y up, metres
  parts: P;                       // named animated parts (contract with the coder)
  playPose: PlayPose;             // seat 0 pose (solo machines)
  seats?: SeatDef[];              // tables: one per seat (seats.length === def.seats)
  colliders: LocalAABB[];         // player-blocking boxes, machine-local
  interact: LocalAABB;            // crosshair target volume
  anchors: Record<string, THREE.Object3D>;  // 'speaker' (required), 'prompt', 'light', 'insideGlass', 'coinOut', …
  /**
   * Tycoon visuals: objects keyed by `MilestoneDef.visual` id (brass trim, gold marquee, crown topper …).
   * They start hidden; the world shows them when the matching milestone is reached. No code needed.
   */
  upgradeVisuals?: Record<string, THREE.Object3D>;
  dispose?: () => void;
}

export interface MachineEvent { k: string; [key: string]: Json }   // declare your events as `type` aliases

/**
 * `to` is set only on private envelopes (`MachineBase.emitPrivate`, host → one seat): only that player
 * receives it; it is never forwarded to others and never stored in snapshots.
 */
export interface MachineEnvelope {
  mid: InstanceId; seq: number; pid: PlayerId; ev: Json;
  to?: PlayerId;
  /** Host time (ms) at emission, stamped by `MachineBase.emit`; becomes `PresentCtx.t`. */
  t?: number;
}

export interface PresentCtx {
  local: boolean;                 // this peer emitted the event
  pid: PlayerId;                  // player who caused it (tables: acting player or 0 for dealer)
  seq: number;
  fast: boolean;                  // queue is lagging (>4 pending) → shorten animations to ≤ 0.1 s
  /** True for a private event addressed to this peer only (own hand, shell peek). */
  priv: boolean;
  /** Host time (ms) when the event was emitted — use it to sync shared animations/timers to the table. */
  t: number;
}

export interface MachineContext {
  readonly instanceId: InstanceId;
  readonly def: MachineDef;
  readonly slot: SlotDef;
  readonly kit: Kit;
  readonly audio: AudioEngine;
  readonly ui: UIOverlay;
  readonly input: Input;
  readonly events: EventBus<GameEvents>;
  readonly run: RunApi;
  readonly net: MachineNet;
  readonly tweens: TweenSystem;   // sim clock
  readonly timers: Timers;        // sim clock
  readonly time: TimeInfo;
  readonly camera: THREE.PerspectiveCamera;
  readonly fx: FxApi;
  readonly cutscene: CutscenePlayer;   // scripted set pieces (the Devil's Table jolt); host triggers via run.playCutscene
  readonly runSeed: number;
}

export interface MachineNet {
  readonly selfId: PlayerId; readonly isHost: boolean; readonly online: boolean;
  sendEvent(env: MachineEnvelope): void;                     // routed by Session
  /** HOST ONLY: deliver `env` to exactly one player (hidden information). No-op for bots/offline self (delivered locally). */
  sendPrivate(to: PlayerId, env: MachineEnvelope): void;
  sendAction(mid: InstanceId, seat: number, rid: number, a: Json): void;
  sendNak(to: PlayerId, mid: InstanceId, rid: number, reason: string): void;
  requestRelease(mid: InstanceId, seat: number): void;
  /** HOST ONLY: tell everyone a mannequin bot sat down (`name`) or left (`null`) — `TableBase.addBot/removeBot`. */
  announceBot(mid: InstanceId, seat: number, name: string | null, level?: number): void;
  playerName(pid: PlayerId): string; playerColor(pid: PlayerId): Hex;
  /** Host clock in ms (offline: performance.now()). */
  hostTime(): number;
  /** Players currently connected (host first), excluding bots. */
  players(): PlayerId[];
}

export interface MachineModule { def: MachineDef; default: new (ctx: MachineContext) => AnyMachine }
export type AnyMachine = MachineBase<object, MachineEvent, Json>;
