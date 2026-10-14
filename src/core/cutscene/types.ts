/**
 * Cutscene system interfaces — TD-FROZEN. Implementation: CUTSCENE WP (`core/cutscene/player.ts`).
 * Contract: BRIEF ADDENDUM 2 (data-driven PSX timeline, letterboxed, skippable, subtitled, MP-synced).
 *
 * A cutscene is **pure data** (`CutsceneDef`): a duration and a flat list of typed tracks whose cues
 * are keyed by absolute time `t` (seconds since start). Story content ships as
 * `src/game/cutscenes/<id>.cutscene.ts` files with `export default def: CutsceneDef`; `main.ts` globs
 * them (`import.meta.glob('./**\/*.cutscene.ts', { eager: true })`) and registers them — no shared file.
 * Text is never inline: subtitles carry i18n keys (`story.<id>.<n>` in the file's own `*.strings.ts`).
 *
 * Multiplayer: the HOST decides when a scene runs (`RunApi.playCutscene`), sends `{t:'cut', id, at, seed}`
 * with `at = hostTime() + lead` and every peer calls `play(id, { startAt: at, seed })`. A peer waits
 * until `hostTime() >= startAt`, or — if already late (late join, lag) — SEEKS: all cues with
 * `t < elapsed` are applied in "seeking" mode (state hooks jump to their end state, camera/actors snap),
 * so everyone shows the same frame. Skipping is a vote (`vote.kind === 'cutscene'`); alone it is instant.
 */
import type { Hex, InstanceId, Json, PlayerId, V3, Unsub, ZoneId } from '../types';
import type { Ease } from '../tween';
import type { AmbienceId, MusicStateId, SfxName, StingerId, VoiceSpeaker } from '../audio/types';
import type { MannequinClip } from '@/kit/types';

export type CutsceneId = string;
export type CutsceneKind =
  | 'intro' | 'quota' | 'quotaMet' | 'quotaFail' | 'floor' | 'prestige' | 'ending' | 'stinger' | 'story'
  | (string & {});

/** Anything the camera / lights / actors can point at. Resolved every frame, so moving targets work. */
export type CutTarget =
  | V3
  | { actor: string; bone?: string; offset?: V3 }                    // actor declared in `def.actors` (default bone: head for look, root for pos)
  | { anchor: string; offset?: V3 }                                  // named world anchor: 'terminal', 'trapdoor', 'elevator.door', 'clock', …
  | { player: 'local' | PlayerId; offset?: V3 }                      // a player's eye position
  | { machine: InstanceId; anchor?: string; offset?: V3 };           // a machine instance (+ optional anchor name)

// ── camera ──────────────────────────────────────────────────────────────────────────────────────
export interface CamKey {
  t: number;
  pos: CutTarget;
  look?: CutTarget;            // omitted = keep previous orientation
  fov?: number;                // degrees
  roll?: number;               // degrees
  ease?: Ease;                 // easing INTO this key, default 'inOutCubic'
  cut?: boolean;               // jump to this key at `t` instead of interpolating
}
/** Catmull-Rom path through `points` between `t0` and `t1` (dolly/crane shots). */
export interface CamPath {
  t0: number; t1: number;
  points: CutTarget[];
  look?: CutTarget;
  fov?: [from: number, to: number];
  roll?: [from: number, to: number];
  ease?: Ease;
}
export interface CameraTrack {
  kind: 'camera';
  keys?: CamKey[];
  paths?: CamPath[];
  /** 0..1 handheld sway (PSX-era cheap-camera feel); also applied during `paths`. */
  handheld?: number;
}

// ── actors ──────────────────────────────────────────────────────────────────────────────────────
/** Declared in `def.actors` and referred to by key. Spawned before t=0, disposed at the end. */
export interface ActorSpec {
  kind: 'mannequin';
  pos: V3; rotY: number;                  // degrees
  color?: Hex; tint?: Hex; height?: number; mask?: string;
  clip?: MannequinClip | string;          // initial animation
  visible?: boolean;                      // default true
  /** Props parented to a bone from t=0 (key into the kit's prop builders, e.g. 'hat_collector', 'coin'). */
  props?: Array<{ prop: string; bone: string; pos?: V3; rot?: V3; scale?: number }>;
}
export interface ActorCue {
  t: number;
  clip?: MannequinClip | string; fade?: number; loop?: boolean; speed?: number;
  moveTo?: { pos: V3; dur: number; ease?: Ease; faceMove?: boolean };
  turnTo?: { target: CutTarget; dur?: number } | { rotY: number; dur?: number };
  look?: CutTarget | null;                // head tracks a target (null releases)
  visible?: boolean; tint?: Hex | null; scale?: number;
  stepFps?: number | null;                // PSX stepped animation (15) or null for smooth
}
export interface ActorTrack { kind: 'actor'; actor: string; cues: ActorCue[] }

// ── subtitles / voice ───────────────────────────────────────────────────────────────────────────
export interface SubtitleCue {
  t: number; dur: number;
  key: string;                            // i18n key, translated with `vars` at display time
  vars?: Record<string, string | number>;
  speaker?: string;                       // i18n key of the speaker label, or null for narration
  voice?: VoiceSpeaker;                   // also plays typewriter blips in this speaker's voice
  mood?: 'calm' | 'cheery' | 'angry' | 'sad' | 'whisper';
}
export interface SubtitleTrack { kind: 'subtitle'; cues: SubtitleCue[] }

// ── audio ───────────────────────────────────────────────────────────────────────────────────────
export type AudioCue = { t: number } & (
  | { do: 'sfx'; name: SfxName | string; vol?: number; pitch?: number; at?: CutTarget; loop?: boolean; stopAfter?: number }
  | { do: 'music'; state: MusicStateId; fade?: number; intensity?: number; dread?: number }
  | { do: 'stinger'; id: StingerId; vol?: number }
  | { do: 'ambience'; id: AmbienceId | null; fade?: number }
  | { do: 'jukebox'; track: string | null }
  | { do: 'muffle'; amount: number; ramp?: number }
);
export interface AudioTrack { kind: 'audio'; cues: AudioCue[] }

// ── screen effects ──────────────────────────────────────────────────────────────────────────────
export type FxCue = { t: number } & (
  | { do: 'fade'; alpha: number; dur: number; color?: string }
  | { do: 'letterbox'; amount: number; dur?: number }
  | { do: 'shake'; amp: number; dur: number; roll?: number }
  | { do: 'flash'; color: Hex; alpha?: number; dur: number }
  | { do: 'tint'; color: Hex; alpha: number; dur: number }
  | { do: 'chroma'; px: number; dur: number }
  | { do: 'zoom'; amount: number; dur: number }
  | { do: 'slowmo'; scale: number; dur: number }
  | { do: 'hitstop'; sec: number }
  | { do: 'glitch'; amount: number; dur: number }
);
export interface FxTrack { kind: 'fx'; cues: FxCue[] }

// ── lights ──────────────────────────────────────────────────────────────────────────────────────
export interface LightCue {
  t: number;
  target: 'all' | ZoneId | { anchor: string } | { machine: InstanceId };
  /** Multiplier on the target's normal intensity (0 = out). */
  level?: number; color?: Hex | null; flicker?: number;
  dur?: number; ease?: Ease;
  /** Return to normal after `dur` (momentary pulse). */
  restore?: boolean;
}
export interface LightTrack { kind: 'light'; cues: LightCue[] }

// ── game hooks & waits ──────────────────────────────────────────────────────────────────────────
/**
 * Calls a named handler registered via `CutscenePlayer.registerHook` (door opens, trapdoor swings,
 * prop appears, elevator rides, quota board stamps PAID …). Handlers must be idempotent and honour
 * `ctx.seeking` (jump straight to the end state).
 */
export interface HookCue { t: number; hook: string; args?: Json }
export interface HookTrack { kind: 'hook'; cues: HookCue[] }

/**
 * The timeline clock stops at `t` until the gate resolves. `timeout` = auto-resolve after N seconds;
 * `input` = any key/click; `choice` = the player picks one of `options` (i18n keys) and the result
 * index is written to `vars[id]`; `hook` = resolved by `CutscenePlayer.resolveGate(id)`.
 * In MP the host resolves gates and broadcasts the result as a normal vote/choice message.
 */
export interface GateCue {
  t: number; id: string;
  until: 'timeout' | 'input' | 'choice' | 'hook';
  timeout?: number;
  options?: string[];
}
export interface GateTrack { kind: 'gate'; cues: GateCue[] }

export type CutsceneTrack =
  | CameraTrack | ActorTrack | SubtitleTrack | AudioTrack | FxTrack | LightTrack | HookTrack | GateTrack;

export interface CutsceneDef {
  id: CutsceneId;
  kind?: CutsceneKind;
  duration: number;                       // s (without gates)
  skippable?: boolean;                    // default true
  letterbox?: boolean;                    // default true: bars in/out 0.5 s
  hideHud?: boolean;                      // default true
  lockInput?: boolean;                    // default true: Input mode 'cutscene', player mode 'cinematic'
  actors?: Record<string, ActorSpec>;
  tracks: CutsceneTrack[];
  /** On skip/seek, idempotent state cues (hooks, audio states, lights) up to the end are still applied. Default true. */
  applyOnSkip?: boolean;
  /** Play this scene right after (branching: a `choice` gate's result can pick via `RunApi`). */
  chain?: CutsceneId;
  /** Fade from/to black around the scene (s). Default 0.4 in, 0.4 out. */
  fadeIn?: number; fadeOut?: number;
}

export interface CutscenePlayOpts {
  /** Host clock (ms) when t = 0 happens; late peers seek. Omit to start immediately. */
  startAt?: number;
  seed?: number;
  /** i18n vars for subtitles and initial gate results (e.g. { n: 3, name: 'Ayşe' }). */
  vars?: Record<string, string | number>;
  skippable?: boolean;
  /** Replace/patch declared actors for this run (e.g. a Hall of Losers mannequin wearing the player's colour). */
  actors?: Record<string, Partial<ActorSpec>>;
}
export type CutsceneResult = 'done' | 'skipped' | 'aborted';
export interface CutsceneHookCtx {
  id: CutsceneId; t: number;
  /** True while fast-forwarding (late join / skip): jump to the end state, no animation. */
  seeking: boolean;
  vars: Record<string, string | number>;
}
export type CutsceneHookFn = (args: Json | undefined, ctx: CutsceneHookCtx) => void | Promise<void>;

export interface CutscenePlayer {
  register(def: CutsceneDef): Unsub;
  has(id: CutsceneId): boolean;
  get(id: CutsceneId): CutsceneDef | undefined;
  list(): CutsceneDef[];
  registerHook(name: string, fn: CutsceneHookFn): Unsub;
  readonly playing: CutsceneId | null;
  readonly time: number;                  // timeline seconds (gates freeze it)
  play(id: CutsceneId, o?: CutscenePlayOpts): Promise<CutsceneResult>;
  /** Local skip request. SP: instant. MP: casts a vote (`'cutscene:skip'` event → net layer). */
  skip(): void;
  /** Host-approved skip (vote passed): everyone jumps to the end. */
  forceSkip(): void;
  abort(): void;                          // immediate; no cues applied (state change / disconnect)
  resolveGate(id: string, value?: number): void;
  onEnd(fn: (id: CutsceneId, r: CutsceneResult) => void): Unsub;
  update(dt: number): void;               // real-time dt, called once per frame by the loop
}

// ── Actor director (DECISIONS C33) — owned by horror; world-sys provides A* over the nav graph ─────────
/** Opaque handle to a spawned actor (mannequin-backed in practice). */
export interface ActorHandle { readonly id: string; readonly pos: V3 }
export interface ActorDirector {
  /** Spawn a dressed actor at `at`. Resolves null when the kit cannot build it. */
  spawn(id: string, at: V3, o?: { dressing?: string; frozen?: boolean }): Promise<ActorHandle | null>;
  /** Walk along an A* path over the world nav graph; resolves false when no path exists. */
  walkPath(actor: ActorHandle, to: V3, o?: { speed?: number }): Promise<boolean>;
  /** Play a mannequin clip; one-shot clips resolve when done (instantly when the actor is frozen). */
  play(actor: ActorHandle, clip: string, o?: { loop?: boolean }): Promise<void>;
  lookAt(actor: ActorHandle, target: V3): void;
  /** Sit the actor at a seat of a machine or prop (seat id from the world). */
  sitAt(actor: ActorHandle, seatId: string): Promise<boolean>;
}
