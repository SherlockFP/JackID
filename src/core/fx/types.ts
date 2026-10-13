/**
 * FX / juice interface — TD-FROZEN. Implementation: CORE-RENDER (`core/fx.ts`, `core/debug.ts`).
 * `core/fx.ts` re-exports everything here (`export type * from './fx/types'`) so `import type { FxApi } from '@/core/fx'`
 * (the spec's path) keeps working — CORE-RENDER must keep that line.
 *
 * BRIEF ADDENDUM 8 "JUICE IS KING": every interaction = anticipation → action → impact → follow-through.
 * This is the shared toolkit EVERY machine uses: particles (coins, sparks, confetti, smoke, dust, glow),
 * floating numbers that can fly into a HUD anchor, screen-space shake/flash/chromatic/tint/zoom-punch,
 * slow-mo + hit-stop, squash & stretch, light pulses, and the tier-escalating `winBurst` composite.
 *
 * Budgets: one pooled `Points`/instanced mesh per effect type (≤ 512 particles each, ≤ 2 000 total).
 * All screen-space effects are local-peer only (nothing here is networked) and honour
 * `settings.shake` (multiplier) and `settings.reduceFlashing` (flash alpha ×0.35, ≤ 3 per second).
 * Numbers below follow ART_BIBLE §9 (coin bursts, shake rows, flash frames, hit-stop).
 */
import type * as THREE from 'three';
import type { Hex, PosLike, Unsub, V3 } from '../types';
import type { Ease, TweenHandle } from '../tween';
import type { HudAnchorId } from '../ui/types';
import type { SfxName } from '../audio/types';
import type { WinTier } from '@/game/types';

export type ParticlePreset = 'coins' | 'sparks' | 'confetti' | 'smoke' | 'dust' | 'glow' | 'embers' | 'drips';

export interface BurstOpts {
  color?: Hex | Hex[];        // single, or random pick per particle
  spread?: number;            // m, initial radial scatter
  speed?: number;             // m/s outward
  up?: number;                // m/s extra upward kick
  dir?: V3;                   // bias direction (e.g. coin tray: [0,1,1])
  life?: number;              // s
  size?: number;              // m (sprite) — presets have sane defaults
  gravity?: number;           // m/s², default per preset (coins 9.81, smoke −0.2)
  spin?: number;              // rad/s
  bounce?: number;            // floor restitution (coins 0.35)
  /** Spread the `n` particles over this many seconds (fountain) instead of a single burst. */
  over?: number;
}

export interface PopTextOpts {
  dur?: number;               // s, default 1.0
  rise?: number;              // m, default 0.4
  scale?: number;             // default 1; wins use 1.3–2
  /** Instead of fading out, fly into this HUD anchor, bump it and call `onArrive`. */
  flyTo?: HudAnchorId;
  onArrive?: () => void;
  /** Sound when it lands (default none; wallet pops use 'numberTick'). */
  sfx?: SfxName;
  /** Quick horizontal shake on spawn (big numbers). */
  shake?: boolean;
}

export interface ShakeOpts {
  roll?: number;              // peak roll in degrees
  freq?: number;              // Hz, default 25
  /** Shake is multiplied by `(1 − t/D)²`; set `sustain` seconds to hold full amplitude first. */
  sustain?: number;
}

export interface FxApi {
  // ── particles (world space; `at` may be a vector, tuple or an object → its world position) ──
  burst(preset: ParticlePreset, at: PosLike, n: number, o?: BurstOpts): void;
  coins(at: PosLike, n: number, o?: { spread?: number; up?: number; over?: number }): void;   // ≤ 60 per call
  sparks(at: PosLike, n: number, color: Hex): void;
  confetti(at: PosLike, n: number): void;
  smoke(at: PosLike, n: number): void;
  dust(at: PosLike, n?: number): void;
  /** Additive neon glow sprite that pulses once (size m, default dur 0.4 s). */
  glow(at: PosLike, color: Hex, size: number, dur?: number): void;
  /** Particle trail behind a moving object (coin in flight, ball). Returns stop(). */
  trail(target: THREE.Object3D, o?: { color?: Hex; life?: number; rate?: number; size?: number }): Unsub;
  /** Flat decal on a surface (scorch, stain, crack, hand print). `kind` is a texgen key. */
  decal(at: PosLike, kind: 'scorch' | 'stain' | 'crack' | 'hand' | (string & {}), o?: { size?: number; life?: number; rotY?: number }): void;

  // ── floating numbers ──
  /** Floating "+250". `dur` may be a number (seconds) or full options (fly into the wallet, etc.). */
  popText(at: PosLike, text: string, color: Hex, dur?: number | PopTextOpts): void;

  // ── screen space (local peer only) ──
  shake(amp: number, dur: number, o?: ShakeOpts): void;                 // local camera, amp in metres
  flash(color: Hex, alpha: number, dur: number): void;                  // dithered post flash
  chroma(px: number, dur: number): void;                                // chromatic aberration pulse
  tint(color: Hex, alpha: number, dur: number): void;                   // curse violet, ghost ice, red alarm
  zoomPunch(amount: number, dur: number): void;                         // amount 0.04 = +4 % FOV punch, eased back
  /** Time-scale the sim (and audio) to `scale` for `dur` real seconds, easing back. Cosmetic; online clamps to ≥ 0.6. */
  slowmo(scale: number, dur: number, o?: { ease?: Ease }): void;
  /** Freeze sim time for `sec` real seconds (big win 0.06, jackpot 0.12, bang 0.2); audio continues. Online: ≤ 0.12. */
  hitstop(sec: number): void;

  // ── object juice ──
  /** Volume-preserving squash & stretch about the object's origin; restores scale. amount 0.2 = ±20 %. */
  squash(obj: THREE.Object3D, amount: number, dur: number): TweenHandle;
  /** Momentary light bump: boosts the nearest pooled light or spawns an additive glow at the target. */
  lightPulse(target: PosLike, o?: { color?: Hex; mul?: number; radius?: number; dur?: number }): void;

  // ── composites (use these; do not hand-roll win feedback) ──
  /**
   * Standard tier-escalating win feedback at `at` (usually `anchors.coinOut`):
   * small → 8 coins · medium → +sparks, light pulse · big → +flash, shake, 40 coins, hit-stop 0.06 ·
   * huge → +100 coins over 2 s, confetti, zoom punch · jackpot → 200 coins over 3 s, hit-stop 0.12, tint, chroma.
   * Includes the matching `popText` when `o.amount` is given. Does NOT play audio (`audio.winJingle` does).
   */
  winBurst(tier: WinTier, at: PosLike, o?: { amount?: number; color?: Hex; flyToWallet?: boolean }): void;
  /** Small, readable loss feedback (dust puff, short low shake, red-tinted pop). */
  loss(at: PosLike, o?: { amount?: number }): void;

  clear(): void;
}
