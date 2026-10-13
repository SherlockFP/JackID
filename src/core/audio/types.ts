/**
 * Audio interfaces — TD-FROZEN. Implementation: CORE-AUDIO (`audio.ts`, `synth.ts`, `sfx.ts`, `music.ts`).
 * Contract: TECH_SPEC §2.5 + BRIEF ADDENDUM 4 (adaptive procedural score, jukebox, House PA voice,
 * vendor Kenney casino samples) + ADDENDUM 8 (juice: slow-mo, ducking).
 *
 * Mixing: buses → master gain → DynamicsCompressor(−12 dB, 4:1) → lowpass 11 kHz (SPU feel) →
 * destination. Reverb send (generated 1.8 s noise impulse) on sfx/amb at 0.15. Positional sounds use
 * `PannerNode` (equalpower, inverse, refDistance 1.5, rolloff 1.4, max 30 m). Max 32 voices (steal
 * lowest priority, then oldest). Default volumes: master 0.8, sfx 0.9, ui 0.8, music 0.6, amb 0.7, voice 0.9.
 */
import type * as THREE from 'three';
import type { Unsub, ZoneId } from '../types';
import type { WinTier } from '@/game/types';

export type Bus = 'sfx' | 'ui' | 'music' | 'amb' | 'voice';

export type SfxName =
  | 'click' | 'hover' | 'button' | 'lever' | 'ratchet' | 'coin' | 'coinDrop' | 'coinFlick' | 'coinLand'
  | 'coinShower' | 'reelStart' | 'reelLoop' | 'reelTick' | 'reelStop' | 'chip' | 'chipStack'
  | 'card' | 'cardFlip' | 'shuffle' | 'dice' | 'diceLand' | 'wheelTick' | 'ballRoll' | 'ballBounce'
  | 'ballDrop' | 'bell' | 'buzzer' | 'beep' | 'error' | 'win1' | 'win2' | 'win3' | 'jackpot' | 'lose'
  | 'whoosh' | 'thud' | 'glass' | 'glassBreak' | 'phoneRing' | 'phonePickup' | 'clockTick' | 'clockAlarm'
  | 'trapdoor' | 'elevator' | 'footstep' | 'gunClick' | 'gunShot' | 'crank' | 'motor' | 'chime' | 'typewriter'
  // juice / tycoon / horror additions (recipes by CORE-AUDIO; machines may use any of them)
  | 'upgrade' | 'purchase' | 'unlock' | 'buffGain' | 'buffLose' | 'quotaTick' | 'quotaMet' | 'quotaFail'
  | 'stamp' | 'printer' | 'cashRegister' | 'coinPour' | 'coinMagnet' | 'sparkle' | 'popUp' | 'numberTick'
  | 'whisper' | 'heartbeat' | 'stinger' | 'lightFlicker' | 'powerDown' | 'powerUp' | 'neonBuzz' | 'paClick'
  | 'tapeStop' | 'tinnitus' | 'defib' | 'gunBlank' | 'gunLoad' | 'shellEject' | 'tileClack' | 'cardSlap'
  | 'totemPlace' | 'totemPulse' | 'porcelainCrack' | 'jackpotSiren' | 'jackpotBells' | 'creak' | 'drip' | 'footstepWet';

/** Defaults a registered recipe plays with (same meaning as the built-in table). All optional. */
export interface SfxRegisterMeta {
  bus?: Bus;          // default 'sfx'
  pri?: number;       // voice-stealing priority 0..10, default 5
  max?: number;       // max starts per 100 ms, default 5
  long?: boolean;     // worth wiring into slow-motion / pitch
}

export interface PlayOpts {
  pos?: THREE.Vector3 | THREE.Object3D;  // positional (PannerNode) if set
  vol?: number;        // 0..2, default 1
  pitch?: number;      // semitones, default 0
  bus?: Bus;           // default 'sfx'
  loop?: boolean;      // returns a Voice you must stop()
  priority?: number;   // 0..10 voice stealing, default 5
  param?: number;      // recipe-specific 0..1 (e.g. reelStop index, ballBounce velocity)
}
export interface Voice { stop(fade?: number): void; setPitch(semi: number): void; setVol(v: number): void; readonly playing: boolean }

export interface Adsr { a: number; d: number; s: number; r: number }
export interface SynthKit {
  readonly ctx: AudioContext; readonly t: number;          // start time
  osc(type: OscillatorType, freq: number, dur: number, o?: { at?: number; vol?: number; to?: number; env?: Adsr; out?: AudioNode }): void;
  noise(dur: number, o?: { at?: number; vol?: number; filter?: BiquadFilterType; freq?: number; q?: number; env?: Adsr; out?: AudioNode }): void;
  chord(freqs: number[], dur: number, type?: OscillatorType, o?: { at?: number; vol?: number; arp?: number }): void;
  /** Play a preloaded vendor sample (see {@link AudioEngine.loadSamples}); ±`rand` random pitch (default 0.08). */
  sample(url: string, o?: { at?: number; vol?: number; rate?: number; rand?: number; out?: AudioNode }): void;
  out: AudioNode;
}
export type SfxRecipe = (k: SynthKit, o: PlayOpts) => number;   // returns duration (s)

// ── adaptive music (BRIEF ADDENDUM 4) ───────────────────────────────────────────────────────────
/** Macro state of the score. Open union: the composer may add states; unknown ids fall back to 'lounge'. */
export type MusicStateId =
  | 'silent' | 'menu' | 'lounge' | 'tense' | 'dread' | 'chase' | 'jackpot' | 'cutscene' | 'elevator'
  | 'defeat' | 'ending' | (string & {});
/** One-shot musical punctuation that ducks the bed. Open union. */
export type StingerId =
  | 'bell' | 'quotaMet' | 'quotaFail' | 'jackpot' | 'bigWin' | 'curse' | 'collector' | 'jumpscare' | 'discovery'
  | 'blackout' | 'door' | 'ascend' | 'descend' | 'buff' | 'debuff' | (string & {});
export type JukeboxGenre = 'lounge' | 'bossa' | 'swing' | 'waltz' | 'synthwave' | 'carnival' | 'noir' | 'music-box' | (string & {});

export interface JukeboxTrack {
  id: string;
  titleKey: string;                 // i18n key (e.g. 'jukebox.sad_waltz')
  genre: JukeboxGenre;
  bpm: number;
  bars: number;                     // loop length
  /** Marks tracks the jukebox may hide until unlocked (meta/achievement). */
  unlock?: string;
}
export interface BeatEvent { bpm: number; beat: number; bar: number; phase: number /* 0..1 within the beat */ }

export interface MusicApi {
  // ── adaptive score (driven by the game, never by machines) ──
  /** Switch macro state with a crossfade; `onBar:true` waits for the next bar line. Default fade 2.5 s. */
  setState(state: MusicStateId, o?: { fade?: number; onBar?: boolean }): void;
  readonly state: MusicStateId;
  /** 0..1 — adds/removes layers (drums, bass, lead) inside the current state. */
  setIntensity(v: number, ramp?: number): void;
  /** 0..1 — horror axis: dissonance, detune, tape wobble, lowpass. Driven by quota pressure/dread. */
  setDread(v: number, ramp?: number): void;
  /** Zone colour (patch/key swap) for floors/rooms; null = neutral. */
  setZone(zone: ZoneId | null, fade?: number): void;
  stinger(id: StingerId, o?: { vol?: number; duck?: number }): void;
  /** Seeded variations: same seed ⇒ same arrangement; otherwise never identical twice. */
  setSeed(seed: number): void;
  readonly beat: BeatEvent;
  onBeat(fn: (e: BeatEvent) => void): Unsub;      // lights/bulbs sync to the bar
  // ── diegetic jukebox (selectable songs; also usable by cutscenes) ──
  play(trackId: string, o?: { fade?: number }): void;
  stop(fade?: number): void;                       // stops jukebox/track; adaptive bed resumes
  readonly current: string | null;                 // jukebox track id or null
  tracks(): string[];                              // ids (spec-compatible)
  catalog(): readonly JukeboxTrack[];              // full metadata for the jukebox UI
}

// ── House / NPC voice (formant-ish babble, subtitles carry the real text) ───────────────────────
export type VoiceSpeaker = 'house' | 'collector' | 'bartender' | 'mira' | 'oracle' | 'dealer' | 'mannequin' | (string & {});
export interface SpeakOpts {
  speaker?: VoiceSpeaker;            // default 'house'
  /** Text drives babble length/rhythm only; callers show subtitles separately via `ui.subtitle`. */
  text: string;
  mood?: 'calm' | 'cheery' | 'angry' | 'sad' | 'whisper';
  pitch?: number;                    // semitones
  distort?: number;                  // 0..1 PA distortion
  pos?: THREE.Object3D;              // positional (diegetic speaker); omitted = PA (non-positional)
  seed?: number;
  /** Duck the music and ambience while speaking (default true). `false` = the line plays over the score untouched. */
  duck?: boolean;
}
export interface VoiceApi {
  speak(o: SpeakOpts): Promise<void>;   // resolves when the utterance ends (or is stopped)
  stop(): void;
  readonly speaking: boolean;
}

export type AmbienceId = 'menu' | 'pit' | 'void' | 'elevator' | 'shaft' | 'parlour' | 'sump' | (string & {});

export interface AudioEngine {
  readonly ctx: AudioContext;
  resume(): Promise<void>;
  setVolume(bus: Bus | 'master', v: number): void;
  play(name: SfxName | string, o?: PlayOpts): Voice | null;
  /** Machine-private sounds: name 'm.<id>.<snd>'. `meta` sets the defaults (bus, priority, rate cap, long). */
  register(name: string, recipe: SfxRecipe, meta?: SfxRegisterMeta): void;
  winJingle(tier: WinTier, o?: PlayOpts): void;
  coins(n: number, o?: PlayOpts): void;               // rapid coin clinks, n ≤ 40
  ambience(id: AmbienceId | null, fade?: number): void;
  readonly music: MusicApi;
  readonly voice: VoiceApi;
  setListener(cam: THREE.Camera): void;               // called each frame by InGame/menu
  readonly voices: number;
  // ── vendor samples (Kenney casino SFX; ASSETS.md) ──
  /** Fetch + decode OGGs once; later `SynthKit.sample(url)` plays them. Resolves when all are ready. */
  loadSamples(urls: string[]): Promise<void>;
  // ── global juice / state filters ──
  /** 0..1: sweeps the master lowpass from 11 kHz down to ~600 Hz (ear collateral, blackout, underwater). */
  setMuffle(amount: number, ramp?: number): void;
  /** Slow-motion: scales playback rate of non-music voices (1 = normal). Used by FxApi.slowmo. */
  setTimeScale(k: number, ramp?: number): void;
  /** Temporarily attenuate a bus (stingers, cutscene voice, big-win swell). */
  duck(bus: Bus, amount: number, dur: number): void;
}
