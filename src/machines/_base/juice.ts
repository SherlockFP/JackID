/**
 * Machine juice helpers (base-machines WP). BRIEF ADDENDUM 8 "JUICE IS KING": every interaction =
 * anticipation → action → impact → follow-through. This file standardises the machine-side half so ~40 machines
 * feel alike: tiered win celebrations, loss feedback, near-miss tease, coin pours with a count-up, and the
 * attract-mode scheduler. Particles / screen effects come from `ctx.fx`, sounds from `ctx.audio`, stingers
 * from `ctx.audio.music`; this file only decides WHEN and HOW MUCH, per tier (GDD §10.4, ART_BIBLE §9).
 *
 * Rules of use
 *  - Call from `present()` (all peers). Spectators automatically get an attenuated version (no hit-stop /
 *    flash / shake unless they stand next to the machine).
 *  - Speed upgrade: via the MachineBase wrappers (`celebrate`/`nearMiss`/`pourCoins`) every wait is scaled; calling
 *    these functions directly uses real durations unless you pass `speed`/`dur` yourself.
 *  - Everything is on the sim clock (`ctx.timers` / `ctx.tweens`): it freezes with SP pause and slow-mo.
 *  - Shows are fire-and-forget: `void celebrate(...)`. Do NOT await a 7 s show inside `present()` — it would
 *    block the next event of the same machine. Await only the short helpers (`nearMiss`, `pourCoins`).
 *  - `fast` (PresentCtx.fast) collapses every wait to ~0.1 s and skips screen-space effects.
 */
import type * as THREE from 'three';
import type { Hex } from '@/core/types';
import type { SfxName, StingerId } from '@/core/audio/types';
import type { Rng } from '@/core/rng';
import type { BulbChain, LampPart, MarqueePart } from '@/kit/types';
import { clamp, lerp, tmpV3a, tmpV3b } from '@/core/math';
import { toWinTier, tierMin, type JuiceTier } from './tiers';
import type { MachineContext, MachineModel } from './types';

/** What juice needs from a machine; `MachineBase` satisfies it. */
export interface JuiceHost {
  readonly ctx: MachineContext;
  readonly model: MachineModel<object>;
  readonly isLocalOccupant: boolean;
  readonly disposed: boolean;
  readonly cosmetic: Rng;
}

/** Machine-side presentation numbers per tier. `fx.winBurst` supplies the particles / screen punch on top. */
export interface TierShow {
  /** Seconds the marquee / bulbs run the win pattern (GDD §10.4: bigwin 3 s, hugewin 5 s, megawin 7 s). */
  show: number;
  /** Chase frequency of bulbs / marquee while the show runs. */
  hz: number;
  /** Sound layered over `audio.winJingle`; null = jingle only. */
  sfx: SfxName | null;
  /** Music stinger for the room; null = none. */
  stinger: StingerId | null;
  /** Colour of the light pulse at the machine. */
  glow: Hex;
}

export const TIER_SHOW: Readonly<Record<JuiceTier, TierShow>> = {
  none:    { show: 0,   hz: 0,  sfx: null,       stinger: null,     glow: 0 },
  push:    { show: 0.4, hz: 2,  sfx: 'coin',     stinger: null,     glow: 0xe8d35a },
  small:   { show: 1.2, hz: 6,  sfx: 'sparkle',  stinger: null,     glow: 0xffce5a },
  medium:  { show: 2,   hz: 8,  sfx: 'sparkle',  stinger: null,     glow: 0xffce5a },
  big:     { show: 3,   hz: 8,  sfx: 'chime',    stinger: 'bigWin', glow: 0xffd040 },
  huge:    { show: 5,   hz: 10, sfx: 'chime',    stinger: 'bigWin', glow: 0xffd040 },
  mega:    { show: 7,   hz: 12, sfx: 'jackpot',  stinger: 'bigWin', glow: 0xffd040 },
  jackpot: { show: 9,   hz: 14, sfx: 'jackpotSiren', stinger: 'jackpot', glow: 0xfff0a0 },
};

const GOLD_FLASH: Hex = 0xffd040;
const RED_PULSE: Hex = 0xff3b30;

function anchorOf(host: JuiceHost, ...names: string[]): THREE.Object3D {
  const a = host.model.anchors;
  for (const n of names) if (a[n]) return a[n];
  return host.model.root;
}

/** World distance camera → object, using shared scratch vectors (hot-path safe). */
function distanceToCamera(host: JuiceHost, obj: THREE.Object3D): number {
  host.ctx.camera.getWorldPosition(tmpV3a);
  obj.getWorldPosition(tmpV3b);
  return tmpV3a.distanceTo(tmpV3b);
}

/** Tier that is safe to show to someone who is NOT playing the machine (no flash/shake/hit-stop from afar). */
function spectatorTier(t: JuiceTier, dist: number): JuiceTier {
  return tierMin(t, dist <= 3 ? 'big' : 'medium');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Win celebration
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface CelebrateOpts {
  /** Coins won (pop text). */
  amount?: number;
  /** FX origin; default `anchors.coinOut` → `prompt` → `speaker` → root. */
  at?: THREE.Object3D;
  /** Machine parts that run the win pattern for the show's duration. */
  marquee?: MarqueePart;
  bulbs?: BulbChain;
  lamps?: readonly LampPart[];
  /** Called when the show ends (put the idle patterns back). Also called immediately for `fast`. */
  restore?: () => void;
  /** `PresentCtx.fast`. */
  fast?: boolean;
  /** Time multiplier (Speed upgrade; MachineBase fills it in). */
  speed?: number;
}

/**
 * Tier-escalating win show: `fx.winBurst` (coins/sparks/flash/shake/hit-stop per tier) + jingle + layer sound +
 * stinger + gold light pulse + marquee/bulb/lamp pattern for `TIER_SHOW[tier].show` seconds. Mega adds a gold
 * strobe flash and an extra coin fountain. Resolves when the show ends.
 */
export function celebrate(host: JuiceHost, tier: JuiceTier, o: CelebrateOpts = {}): Promise<void> {
  const { ctx } = host;
  if (tier === 'none' || host.disposed) return Promise.resolve();
  const at = o.at ?? anchorOf(host, 'coinOut', 'prompt', 'speaker');
  const speaker = anchorOf(host, 'speaker');
  const dist = host.isLocalOccupant ? 0 : distanceToCamera(host, at);
  const shown = host.isLocalOccupant ? tier : spectatorTier(tier, dist);
  const spec = TIER_SHOW[tier];
  const fast = !!o.fast;

  if (tier === 'push') {
    ctx.audio.play('coin', { pos: speaker });
  } else {
    ctx.fx.winBurst(toWinTier(shown), at, { amount: o.amount, flyToWallet: host.isLocalOccupant && !fast });
    ctx.audio.winJingle(toWinTier(tier), { pos: speaker });
    if (spec.sfx && !fast) ctx.audio.play(spec.sfx, { pos: speaker, vol: 0.8 });
    if (spec.stinger && (host.isLocalOccupant || dist < 10)) ctx.audio.music.stinger(spec.stinger);
    if (tier !== 'small') ctx.fx.lightPulse(at, { color: spec.glow, mul: tier === 'medium' ? 1.3 : 1.7, dur: 0.5 });
    if ((tier === 'mega' || tier === 'jackpot') && host.isLocalOccupant && !fast) {
      ctx.fx.flash(GOLD_FLASH, 0.35, 0.25);
      ctx.fx.coins(at, 40, { spread: 0.08, up: 1.8, over: 2 });
    }
  }

  const run = !fast && spec.show > 0;
  if (run) {
    o.marquee?.chase('win', spec.hz);
    o.bulbs?.pattern(tier === 'huge' || tier === 'mega' || tier === 'jackpot' ? 'rainbow' : 'chase', spec.hz);
    o.lamps?.forEach((l) => l.blink(spec.hz, spec.show));
  }
  if (!run) { o.restore?.(); return Promise.resolve(); }
  return ctx.timers.wait(spec.show * (o.speed ?? 1)).then(() => { if (!host.disposed) o.restore?.(); });
}

/** Small, readable loss feedback (dust puff, short low shake, red-tinted pop) + the loss sound. */
export function loss(host: JuiceHost, o: { amount?: number; at?: THREE.Object3D } = {}): void {
  if (host.disposed) return;
  const at = o.at ?? anchorOf(host, 'coinOut', 'prompt', 'speaker');
  host.ctx.fx.loss(at, { amount: o.amount });
  host.ctx.audio.play('lose', { pos: anchorOf(host, 'speaker') });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Near-miss tease
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface NearMissOpts {
  dur?: number;
  at?: THREE.Object3D;
  lamps?: readonly LampPart[];
  fast?: boolean;
}

/**
 * The beat of held breath before a losing result "almost" wins: heartbeat, red light pulse, a hair of zoom for
 * the player, lamps flutter. Resolves after `dur` (default 0.9 s) so the caller can then land the losing face.
 */
export async function nearMiss(host: JuiceHost, o: NearMissOpts = {}): Promise<void> {
  const { ctx } = host;
  if (host.disposed) return;
  const dur = o.fast ? 0.1 : o.dur ?? 0.9;
  const at = o.at ?? anchorOf(host, 'coinOut', 'prompt', 'speaker');
  if (!o.fast) {
    ctx.audio.play('heartbeat', { pos: anchorOf(host, 'speaker'), vol: 0.9 });
    ctx.fx.lightPulse(at, { color: RED_PULSE, mul: 1.4, dur });
    if (host.isLocalOccupant) ctx.fx.zoomPunch(0.015, dur);
    o.lamps?.forEach((l) => l.blink(7, dur));
  }
  await ctx.timers.wait(dur);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Coins + count-up
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface PourOpts {
  /** Stake of the round: scales the pour by the win multiple. Omit to scale by the absolute amount. */
  bet?: number;
  /** Where the coins appear (a tray anchor); default `anchors.coinOut`. */
  from?: THREE.Object3D;
  /** Called every frame with the running amount (0 → `amount`), for LED / screen count-ups. */
  onCount?: (value: number) => void;
  fast?: boolean;
  /** Time multiplier (Speed upgrade; MachineBase fills it in). */
  speed?: number;
}

/** Number of sprite coins for a payout of `amount` on stake `bet` (default 10): ~8 at ×1, ~14 at ×10, ~23 at ×100, max 60. */
export function coinCount(amount: number, bet = 10): number {
  const m = Math.max(0, amount) / Math.max(1, bet);
  return clamp(Math.round(5 + 9 * Math.log10(1 + m)), 4, 60);
}

/**
 * Pour `amount` coins into the tray with a count-up. Resolves when the pour ends (≈ 0.4–2.4 s). Cheaper than a
 * tier show: use it for cash-outs, refunds, ladder collects; `celebrate` already spawns its own coins (don't stack both).
 */
export function pourCoins(host: JuiceHost, amount: number, o: PourOpts = {}): Promise<void> {
  const { ctx } = host;
  if (host.disposed || !(amount > 0)) return Promise.resolve();
  const speaker = anchorOf(host, 'speaker');
  const n = coinCount(amount, o.bet);
  const dur = o.fast ? 0.1 : clamp(0.4 + n * 0.03, 0.4, 2.4) * (o.speed ?? 1);
  if (!o.fast) {
    ctx.fx.coins(o.from ?? anchorOf(host, 'coinOut', 'prompt', 'speaker'), n, { spread: 0.05, up: 1.2, over: dur });
    ctx.audio.play('coinPour', { pos: speaker });
    ctx.audio.coins(Math.min(n, 40), { pos: speaker });
  }
  if (!o.onCount) return ctx.timers.wait(dur);
  const cb = o.onCount;
  return ctx.tweens.run(dur, (k) => cb(Math.round(lerp(0, amount, k))), { ease: 'outCubic' }).promise;
}

/** Eased integer count-up on the sim clock (LED windows, "WIN 1,250"). Resolves at the end. */
export function countUp(ctx: MachineContext, from: number, to: number, dur: number, onValue: (v: number) => void): Promise<void> {
  return ctx.tweens.run(dur, (k) => onValue(Math.round(lerp(from, to, k))), { ease: 'outCubic' }).promise;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Attract mode
// ─────────────────────────────────────────────────────────────────────────────────────────────────
interface AttractEntry { id: string; period: number; jitter: number; left: number; fn: () => void }

/**
 * Idle-animation scheduler for `attract(dt, t)`: "every ~20 s the thumb taps the glass twice". Periods are
 * jittered with the machine's cosmetic RNG so a row of identical machines never moves in unison.
 * `update()` costs a few float ops per entry — fine at render rate for visible machines only.
 */
export class AttractScript {
  private entries: AttractEntry[] = [];
  constructor(private readonly rng: Rng) {}

  /** Run `fn` every `period` s (± `jitter` s). First run after `first` s (default: one period). */
  every(id: string, period: number, fn: () => void, o: { jitter?: number; first?: number } = {}): this {
    const jitter = o.jitter ?? period * 0.25;
    this.entries.push({ id, period, jitter, left: o.first ?? this.next(period, jitter), fn });
    return this;
  }
  update(dt: number): void {
    for (const e of this.entries) {
      e.left -= dt;
      if (e.left > 0) continue;
      e.left = this.next(e.period, e.jitter);
      e.fn();
    }
  }
  /** Restart all timers (call from `onRelease`). */
  reset(): void {
    for (const e of this.entries) e.left = this.next(e.period, e.jitter);
  }
  private next(period: number, jitter: number): number {
    return Math.max(0.05, period + this.rng.float(-jitter, jitter));
  }
}

/** 0↔1 sine pulse at `hz` (lamp breathing). */
export const breathe = (t: number, hz: number): number => 0.5 + 0.5 * Math.sin(t * hz * Math.PI * 2);
/** Square blink at `hz` with `duty` on-fraction. */
export const blinkOn = (t: number, hz: number, duty = 0.5): boolean => (t * hz) % 1 < duty;
