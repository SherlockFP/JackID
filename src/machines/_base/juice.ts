/**
 * Machine juice helpers (base-machines WP). BRIEF ADDENDUM 8 "JUICE IS KING": every interaction =
 * anticipation → action → impact → follow-through. This file standardises the machine-side half so ~40 machines
 * feel alike: tiered win celebrations, loss feedback, near-miss tease, coin pours with a count-up, and the
 * attract-mode scheduler. Particles / screen effects come from `ctx.fx`, sounds from `ctx.audio` (win jingles via
 * `audio.winJingle`, never `music.stinger`: DECISIONS G); this file only decides WHEN and HOW MUCH, per tier
 * (GDD §10.4, ART_BIBLE §9).
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
import type { SfxName } from '@/core/audio/types';
import type { Rng } from '@/core/rng';
import type { BulbChain, LampPart, MarqueePart } from '@/kit/types';
import { clamp, lerp, tmpV3a, tmpV3b } from '@/core/math';
import { setPostLevel } from '@/core/fx';
import type { WinTier } from '@/game/types';
import { fmtCoins } from '@/core/i18n';
import { tierAtLeast, toWinTier, tierMin, winFeel, TIER_FLOOR_MULT, type JuiceTier, type WinFeel } from './tiers';
import type { MachineContext, MachineModel } from './types';

// Pit-wide juice events. The world layer may listen (floor lights, ceiling rain); juice never waits on them.
declare module '@/core/events' {
  interface GameEvents {
    /** Jackpot gold wave rolling out from a machine across the pit. */
    'juice:pitWave': { x: number; y: number; z: number; radius: number; dur: number };
    /** Floor lights strobe for the length of a mega win or jackpot show. */
    'juice:floorStrobe': { tier: WinTier; hz: number; dur: number; color: Hex };
    /** A machine's combo light show (Big One, 3+ patterns): the world flicks at x,y,z; nearby machines twinkle (see comboTwinkle). */
    'show:combo': ComboShowEv;
  }
}

/** Combo light show broadcast.  = the emitting instance; positions are world space. */
/** Player flash settings. Machines may not import the app core, so the story layer registers the reader (`setFlashPrefsHost`). */
export interface FlashPrefs { reduced: boolean; calm: boolean }
let flashHost: (() => FlashPrefs) | null = null;
export function setFlashPrefsHost(fn: (() => FlashPrefs) | null): void { flashHost = fn; }
export function flashPrefs(): FlashPrefs {
  try { return flashHost?.() ?? { reduced: false, calm: false }; } catch { return { reduced: false, calm: false }; }
}

export interface ComboShowEv {
  mid: string;
  x: number; y: number; z: number;
  /** Patterns in the tally that started the show. */
  n: number;
  /** Reach of the twinkle, metres. */
  radius: number;
  /** Show length, seconds. */
  dur: number;
}

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
  /** Colour of the light pulse at the machine. */
  glow: Hex;
}

export const TIER_SHOW: Readonly<Record<JuiceTier, TierShow>> = {
  none:    { show: 0,   hz: 0,  sfx: null,       glow: 0 },
  push:    { show: 0.4, hz: 2,  sfx: 'coin',     glow: 0xe8d35a },
  small:   { show: 1.2, hz: 6,  sfx: 'sparkle',  glow: 0xffce5a },
  medium:  { show: 2,   hz: 8,  sfx: 'sparkle',  glow: 0xffce5a },
  big:     { show: 3,   hz: 8,  sfx: 'chime',    glow: 0xffd040 },
  huge:    { show: 5,   hz: 10, sfx: 'chime',    glow: 0xffd040 },
  mega:    { show: 7,   hz: 12, sfx: 'bell',       glow: 0xffd040 },
  jackpot: { show: 6,   hz: 14, sfx: 'jackpotSiren', glow: 0xfff0a0 },
};

const GOLD_FLASH: Hex = 0xffd040;
const GOLD_WAVE: Hex = 0xffe27a;
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
  /** Stake of the round: with `amount` it gives the win multiple that scales flash, pour, pop and pitch (else the tier's floor multiple is used). */
  bet?: number;
  /** The win multiple directly (overrides `amount / bet`). */
  mult?: number;
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
 * Tier-escalating win show. Base: `fx.winBurst` (coins/sparks/flash/shake/hit-stop per tier) + jingle + layer sound +
 * gold light pulse + marquee/bulb/lamp pattern for `TIER_SHOW[tier].show` seconds. Escalation (not `fast`):
 *   big      coin fountain + shake
 *   huge     0.4 s slow-mo at 40 % speed, rising chord, gold flash
 *   mega     screen-wide confetti, chromatic pulse, zoom punch, floor-light strobe (+ `juice:floorStrobe`)
 *   jackpot  6 s show: pit-wide gold wave (+ `juice:pitWave`), bell layer, coin rain from the ceiling
 * Spectators get the attenuated tier, so they see the fountain/shake at most. Resolves when the show ends.
 */
export function celebrate(host: JuiceHost, tier: JuiceTier, o: CelebrateOpts = {}): Promise<void> {
  const { ctx } = host;
  if (tier === 'none' || host.disposed) return Promise.resolve();
  const at = o.at ?? anchorOf(host, 'coinOut', 'prompt', 'speaker');
  const speaker = anchorOf(host, 'speaker');
  const dist = host.isLocalOccupant ? 0 : distanceToCamera(host, at);
  const shown = host.isLocalOccupant ? tier : spectatorTier(tier, dist);
  const show = TIER_SHOW[tier];
  const fast = !!o.fast;
  const sp = o.speed ?? 1;

  if (tier === 'push') {
    ctx.audio.play('coin', { pos: speaker });
  } else {
    // every win is felt: flash, pour and pop scale with the multiplier (spectators see their attenuated tier's weight)
    const given = o.mult ?? (o.bet && o.bet > 0 && o.amount ? o.amount / o.bet : 0);
    const feel = winFeel(shown !== tier ? TIER_FLOOR_MULT[shown] : Math.max(TIER_FLOOR_MULT[tier], given));
    const own = !fast && o.amount !== undefined && o.amount > 0;      // the scaled pop below replaces winBurst's fixed one
    // core `winBurst` has no 'mega' branch: mega = the huge burst plus the mega layer in `escalate`
    if (!fast) winFeelLayer(host, shown, feel, at, dist, sp);
    ctx.fx.winBurst(shown === 'mega' ? 'huge' : shown, at, { amount: own ? undefined : o.amount, flyToWallet: host.isLocalOccupant && !fast });
    if (own) winPop(host, feel, at, o.amount as number);
    ctx.audio.winJingle(toWinTier(tier), { pos: speaker, pitch: tier === 'jackpot' ? 0 : feel.pitch });
    if (show.sfx && !fast) ctx.audio.play(show.sfx, { pos: speaker, vol: 0.8, pitch: tier === 'jackpot' ? 0 : feel.pitch });
    ctx.fx.lightPulse(at, { color: show.glow, mul: tier === 'small' ? 1.15 : tier === 'medium' ? 1.3 : 1.7, dur: 0.5 });
    if (!fast) escalate(host, shown, at, speaker, sp);
  }

  const run = !fast && show.show > 0;
  if (run) {
    o.marquee?.chase('win', show.hz);
    o.bulbs?.pattern(tier === 'huge' || tier === 'mega' || tier === 'jackpot' ? 'rainbow' : 'chase', show.hz);
    o.lamps?.forEach((l) => l.blink(show.hz, show.show));
  }
  if (!run) { o.restore?.(); return Promise.resolve(); }
  return ctx.timers.wait(show.show * sp).then(() => { if (!host.disposed) o.restore?.(); });
}

/**
 * The multiplier-scaled half of a win (see {@link winFeel}): screen flash, coin pour, coin-pour sound. Tiers from `big` up
 * already get a fountain, a flash and a shake from `winBurst` / {@link escalate}, so they only get the pitch and the pop.
 * Screen-space parts only run for the player (or a spectator standing at the machine).
 */
function winFeelLayer(host: JuiceHost, shown: JuiceTier, feel: WinFeel, at: THREE.Object3D, dist: number, sp: number): void {
  const { ctx } = host;
  const near = host.isLocalOccupant || dist <= 3;
  const tall = tierAtLeast(shown, 'big');
  if (near && shown !== 'jackpot' && feel.flashAlpha > 0) ctx.fx.flash(feel.flashColor, feel.flashAlpha, feel.flashDur);
  if (tall) return;
  if (near && feel.shake > 0) ctx.fx.shake(feel.shake, 0.18 + 0.4 * feel.k, { roll: feel.shake * 40 });
  if (near && feel.zoom > 0) ctx.fx.zoomPunch(feel.zoom, 0.3);
  const speaker = anchorOf(host, 'speaker');
  ctx.fx.coins(at, feel.coins, { spread: 0.12 + 0.1 * feel.k, up: 1.6 + 1.6 * feel.k, over: feel.pourDur * sp });
  ctx.audio.coins(Math.min(40, feel.coins), { pos: speaker, pitch: feel.pitch });
  if (feel.k > 0.25) ctx.audio.play('coinPour', { pos: speaker, vol: 0.5 + 0.6 * feel.k, pitch: feel.pitch });
}

/** The win pop: bigger and warmer with the multiplier, flying into the wallet counter for the player. */
function winPop(host: JuiceHost, feel: WinFeel, at: THREE.Object3D, amount: number): void {
  at.getWorldPosition(tmpV3a);
  host.ctx.fx.popText([tmpV3a.x, tmpV3a.y + 0.25, tmpV3a.z], `+${fmtCoins(amount, true)}`, feel.popColor, {
    dur: 1.1 + 0.5 * feel.k, rise: 0.4 + 0.3 * feel.k, scale: feel.popScale, shake: feel.mult >= 10,
    flyTo: host.isLocalOccupant ? 'wallet' : undefined, sfx: host.isLocalOccupant ? 'numberTick' : undefined,
  });
}

/** The extra layers that make each tier feel bigger than the one below (see {@link celebrate}). */
function escalate(host: JuiceHost, shown: JuiceTier, at: THREE.Object3D, speaker: THREE.Object3D, sp: number): void {
  const { ctx } = host;
  if (tierAtLeast(shown, 'big')) {
    ctx.fx.coins(at, 60, { spread: 0.25, up: 3.2, over: 1.4 });          // coin fountain
    ctx.fx.shake(0.03, 0.6, { roll: 1.2 });
  }
  if (tierAtLeast(shown, 'huge')) {
    ctx.fx.slowmo(0.4, 0.4);                                             // 0.4 s held breath
    ctx.audio.play('winRise', { pos: speaker, vol: 0.8 });               // rising chord
    ctx.timers.wait(0.1 * sp).then(() => { if (!host.disposed) ctx.fx.flash(GOLD_FLASH, 0.4, 0.3); });
  }
  if (tierAtLeast(shown, 'mega')) {
    // screen-wide confetti: a volley spawned in front of the camera
    ctx.camera.getWorldPosition(tmpV3a);
    ctx.camera.getWorldDirection(tmpV3b);
    const cx = tmpV3a.x + tmpV3b.x * 3.5, cy = tmpV3a.y + tmpV3b.y * 3.5 + 0.6, cz = tmpV3a.z + tmpV3b.z * 3.5;
    ctx.fx.burst('confetti', [cx, cy, cz], 120, { spread: 3, up: 2.5, over: 1.2 });
    ctx.fx.chroma(2.2, 0.7);
    ctx.fx.zoomPunch(0.08, 0.5);
    floorStrobe(host, shown, at, sp);
  }
  if (shown === 'jackpot') {
    pitWave(host, at, sp);
    ctx.timers.wait(0.4 * sp).then(() => { if (!host.disposed) ctx.audio.play('jackpotBells', { pos: speaker, vol: 0.9 }); });
    // coin rain: six waves from ceiling height over the first 3 s
    at.getWorldPosition(tmpV3a);
    const bx = tmpV3a.x, by = tmpV3a.y + 3.2, bz = tmpV3a.z;
    for (let w = 0; w < 6; w++) {
      ctx.timers.wait(w * 0.5 * sp).then(() => {
        if (host.disposed) return;
        ctx.fx.coins([bx + host.cosmetic.float(-2, 2), by, bz + host.cosmetic.float(-1.5, 1.5)], 24, { spread: 1.4, up: 0, over: 1.2 });
      });
    }
  }
}

/** Floor lights strobe: a local pulse chain at the machine plus the `juice:floorStrobe` event for the world layer. */
function floorStrobe(host: JuiceHost, tier: JuiceTier, at: THREE.Object3D, sp: number): void {
  const { ctx } = host;
  const show = TIER_SHOW[tier];
  ctx.events.emit('juice:floorStrobe', { tier: toWinTier(tier), hz: show.hz, dur: show.show, color: show.glow });
  at.getWorldPosition(tmpV3a);
  const bx = tmpV3a.x, by = tmpV3a.y, bz = tmpV3a.z;
  const gap = 0.25;                                                  // four strobe flashes a second
  const steps = Math.min(16, Math.round(show.show / gap));           // budget cap: 16 flashes per show
  for (let i = 0; i < steps; i++) {
    ctx.timers.wait(i * gap * sp).then(() => {
      if (host.disposed) return;
      const side = i % 2 ? 2 : -2;
      ctx.fx.lightPulse([bx + side, by + 1.5, bz], { color: show.glow, mul: 2.6, radius: 7, dur: gap * 0.8 });
    });
  }
}

/** Jackpot gold wave: four expanding rings of light pulses across the pit, plus `juice:pitWave`. */
function pitWave(host: JuiceHost, at: THREE.Object3D, sp: number): void {
  const { ctx } = host;
  at.getWorldPosition(tmpV3a);
  const x = tmpV3a.x, y = tmpV3a.y, z = tmpV3a.z;
  ctx.events.emit('juice:pitWave', { x, y, z, radius: 12, dur: 1.6 });
  for (let r = 0; r < 4; r++) {
    const rad = 2.5 + r * 3;
    const n = 4 + r * 2;
    ctx.timers.wait(r * 0.35 * sp).then(() => {
      if (host.disposed) return;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fx.lightPulse([x + Math.cos(a) * rad, y + 1.2, z + Math.sin(a) * rad], { color: GOLD_WAVE, mul: 2.6, radius: 6, dur: 0.7 });
      }
    });
  }
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
    if (host.isLocalOccupant) {
      ctx.fx.zoomPunch(0.015, dur);
      setPostLevel('vignetteBoost', 0.45, dur * 0.25);                  // vignette pulse: the screen closes in
      ctx.timers.wait(dur * 0.5).then(() => { if (!host.disposed) setPostLevel('vignetteBoost', 0, dur * 0.4); });
    }
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
// Combo light show (Big One and any machine that wants to answer it)
// ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Broadcast a combo show from `root` (the machine's world position). Other machines answer with comboTwinkle. */
export function emitComboShow(ctx: MachineContext, root: THREE.Object3D, n: number, dur: number, radius = 9): void {
  root.getWorldPosition(tmpV3a);
  ctx.events.emit('show:combo', { mid: String(ctx.instanceId), x: tmpV3a.x, y: tmpV3a.y, z: tmpV3a.z, n, radius, dur });
}

/**
 * A nearby machine's answer to `show:combo`: one soft gold pulse on its own lamps, scaled by distance (none past
 * `radius`). Wire it in `init()` with `bus.on('show:combo', (e) => comboTwinkle(this.ctx, this.model.root, e))` and
 * keep the unsubscribe for `dispose()`. One pulse per show, so it stays inside the flash caps.
 */
export function comboTwinkle(ctx: MachineContext, root: THREE.Object3D, ev: ComboShowEv): void {
  if (String(ctx.instanceId) === ev.mid) return;
  root.getWorldPosition(tmpV3a);
  const d = Math.hypot(tmpV3a.x - ev.x, tmpV3a.y - ev.y, tmpV3a.z - ev.z);
  if (!(d <= ev.radius)) return;
  ctx.fx.lightPulse(root, { color: GOLD_WAVE, mul: 1 + 0.5 * (1 - d / ev.radius), dur: Math.min(1, ev.dur) });
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
