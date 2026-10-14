/**
 * SFX recipes + ambience beds — owned by CORE-AUDIO. One layered recipe per `SfxName` (plus aliases and a few
 * extras: doors, elevator ding, footstep surfaces, win jingles per tier, coin cascades) built on the
 * {@link Kit}: a synthetic transient + a pitched body + a metallic/noisy tail, and — for chips, cards and dice —
 * a Kenney CC0 sample layered underneath (random variant, ±8 % pitch). Recipes return their duration; loop
 * recipes (`PlayOpts.loop`) fade in/out over {@link LOOP_FADE} so chunks crossfade seamlessly.
 *
 * Conventions: `vol` inside a recipe is relative to the recipe; the final loudness balance lives in {@link TRIM}.
 * `PlayOpts.param` meanings are documented next to each recipe (footstep surface, reelStop index, …).
 */
import type { AmbienceId, Bus, PlayOpts } from './types';
import type { WinTier } from '@/game/types';
import { Kit, arng, chance, hz, noiseMakeup, pick, rnd, rndi, semi, type NoiseBank, type NoiseColor } from './synth';

export interface SfxMeta {
  bus?: Bus;
  /** Voice-stealing priority 0..10 (default 5). */
  pri?: number;
  /** Max starts of this sound per 100 ms (default 5). */
  max?: number;
  /** Loudness trim (see {@link TRIM}). */
  gain?: number;
  /** Sound lasts long enough to be worth wiring into slow-motion / pitch (set by {@link LONG}). */
  long?: boolean;
}
export type KitRecipe = (k: Kit, o: PlayOpts) => number;
export interface SfxDef { run: KitRecipe; meta: SfxMeta }
export const SFX_DEFS = new Map<string, SfxDef>();

/** Crossfade length of looping chunks (seconds). The engine starts chunk n+1 exactly `dur` after chunk n. */
export const LOOP_FADE = 0.03;
const LOOP_ENV = { a: LOOP_FADE, d: 0.001, s: 1, r: LOOP_FADE };

/**
 * Per-recipe loudness trim. Calibrated offline with `renderSfx` (samples loaded): the median peak of three renders is
 * normalised to 0.60 full scale (UI ticks 0.45, big jingles 0.72), clamped to 0.3–3. Re-run when a recipe changes.
 */
const TRIM: Record<string, number> = {
  click: 1.13, hover: 3, button: 0.86, popUp: 1.19, numberTick: 3, quotaTick: 2.16, charmTick: 2.2,
  beep: 2.37, error: 1.64, chime: 1.64, lever: 0.46, ratchet: 1.73, reelStart: 1.11,
  reelLoop: 1.75, reelSpin: 1.91, reelTick: 2.79, reelStop: 0.69, crank: 1.75, motor: 0.47,
  gunClick: 2.6, gunBlank: 2.4, blankClick: 2.4, gunLoad: 1.09, shellRack: 1.17, shellEject: 2.53,
  gunShot: 0.38, coin: 0.78, coinDrop: 0.65, coinFlick: 2.99, coinLand: 0.57, coinShower: 0.81,
  coinPour: 0.64, coinMagnet: 0.89, chip: 0.85, chipStack: 0.84, card: 0.77, cardFlip: 0.9,
  shuffle: 0.81, cardSlap: 0.77, dice: 0.68, diceRoll: 0.66, diceLand: 0.74, wheelTick: 2.45,
  ballRoll: 2.82, ballBounce: 1.8, ballDrop: 1.17, bell: 1.01, buzzer: 1.22, lose: 1.76,
  whoosh: 1.2, thud: 0.6, glass: 1.08, glassBreak: 1.08, win1: 0.87, win2: 0.61,
  win3: 0.8, winHuge: 0.5, winRise: 0.8, winMega: 0.6, winPush: 0.85, jackpot: 0.62, jackpotSiren: 1.77, jackpotBells: 1.76,
  stinger: 0.57, quotaMet: 0.82, quotaFail: 0.46, upgrade: 1.05, purchase: 1.06, cashRegister: 0.89,
  unlock: 1.15, buffGain: 1.02, buffLose: 1.24, stamp: 0.64, printer: 1.82, sparkle: 3,
  whisper: 0.9, whispers: 0.98, heartbeat: 0.6, lightFlicker: 2.14, powerDown: 1.02, powerUp: 0.98,
  neonBuzz: 3, paClick: 1.3, tapeStop: 1.74, tinnitus: 3, defib: 0.58, totemPlace: 0.64,
  totemPulse: 1.38, porcelainCrack: 1.21, creak: 2.73, mannequinCreak: 2.52, drip: 1.89, phoneRing: 2.5,
  phonePickup: 1.46, clockTick: 2.71, clockAlarm: 2.65, trapdoor: 0.66, elevator: 2.03, elevatorDing: 1.69,
  typewriter: 1.81, tileClack: 1.42, door: 0.83, doorCreak: 3, doorSlam: 0.53, footstep: 1.52,
  footstepCarpet: 1.61, footstepConcrete: 1.23, footstepMetal: 1.35, footstepWood: 1.07, footstepWet: 1.1, boom: 0.44,
  coinInsert: 0.78, coinRain: 1.75, tensionRise: 0.83, tallyTick: 2.8,
};

function def(names: string | string[], run: KitRecipe, meta: SfxMeta = {}): void {
  for (const name of Array.isArray(names) ? names : [names]) SFX_DEFS.set(name, { run, meta: { ...meta, gain: meta.gain ?? TRIM[name] ?? 1 } });
}

// ── vendor samples (Kenney casino audio, CC0) ─────────────────────────────────────────────────────
const DIR = `${import.meta.env.BASE_URL}assets/vendor/kenney-casino-audio/Audio/`;
const grp = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${DIR}${prefix}-${i + 1}.ogg`);
const SMP = {
  cardFan: grp('card-fan', 2), cardPlace: grp('card-place', 4), cardShove: grp('card-shove', 4), cardSlide: grp('card-slide', 8),
  cardShuffle: [`${DIR}card-shuffle.ogg`], packOpen: grp('cards-pack-open', 2), packTake: grp('cards-pack-take-out', 2),
  chipLay: grp('chip-lay', 3), chipsCollide: grp('chips-collide', 4), chipsHandle: grp('chips-handle', 6), chipsStack: grp('chips-stack', 6),
  diceGrab: grp('dice-grab', 2), diceShake: grp('dice-shake', 3), diceThrow: grp('dice-throw', 3), dieThrow: grp('die-throw', 4),
};
/** Every vendor sample the recipes use (the engine preloads them all in the background). */
export const SAMPLE_URLS: string[] = Object.values(SMP).flat();
const lastVariant = new Map<readonly string[], number>();
/** Random variant of a sample group, never the same twice in a row. */
function smp(group: readonly string[]): string {
  let i = rndi(0, group.length - 1);
  const prev = lastVariant.get(group);
  if (group.length > 1 && i === prev) i = (i + 1 + rndi(0, group.length - 2)) % group.length;
  lastVariant.set(group, i);
  return group[i];
}

// ── building blocks ───────────────────────────────────────────────────────────────────────────────
const TICK_ENV = (d: number) => ({ a: 0.0005, d, s: 0, r: 0.004 });
/** Short filtered-noise transient: the "click" every mechanical sound starts with. */
function snap(k: Kit, at: number, vol = 0.6, f = 3200, dur = 0.012, q = 1.2, type: BiquadFilterType = 'bandpass', pan = 0): void {
  k.noise(dur, { at, vol, filter: type, freq: f, q, pan, env: TICK_ENV(dur) });
}
/** Pitched body that glides f0 → f1 (kick, knock, thud). */
function thump(k: Kit, at: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
  k.osc(type, f0, dur, { at, vol, to: f1, glide: dur * 0.85, env: { a: 0.002, d: dur, s: 0, r: 0.01 } });
}
const METAL = [1, 2.32, 4.25, 6.63], METAL_A = [1, 0.5, 0.28, 0.14];
/** Inharmonic metallic ring (bars, bells, glass, casings). */
function ring(k: Kit, at: number, f: number, decay: number, vol: number, o: { pan?: number; ratios?: number[]; amps?: number[] } = {}): void {
  const r = o.ratios ?? METAL, a = o.amps ?? METAL_A;
  for (let i = 0; i < r.length; i++) {
    const d = decay / (1 + i * 0.55);
    k.osc('sine', f * r[i], d, { at, vol: vol * a[i], pan: o.pan, env: { a: 0.0008, d, s: 0, r: 0.01 } });
  }
}
const COIN = [1, 1.62, 2.76, 4.1], COIN_A = [1, 0.62, 0.34, 0.16];
/** One coin clink: bright inharmonic ring + a tiny noise tick. */
function clink(k: Kit, at: number, vol = 0.5, f = rnd(2300, 3500), decay = 0.09 + rnd(0, 0.05), pan = rnd(-0.5, 0.5)): void {
  ring(k, at, f, decay, vol, { ratios: COIN, amps: COIN_A, pan });
  snap(k, at, vol * 0.7, rnd(5200, 7000), 0.006, 1.5, 'bandpass', pan);
}
/** `n` coin clinks thinning out over `spread` seconds (front-loaded), with the odd chip sample for body. */
function cascade(k: Kit, start: number, spread: number, n: number, vol = 0.4): void {
  for (let i = 0; i < n; i++) {
    const u = (i + rnd(0, 0.9)) / n, t = start + spread * Math.pow(u, 1.5);
    clink(k, t, vol * rnd(0.55, 1) * (1 - 0.45 * u));
    if (i % 5 === 0) k.sample(smp(SMP.chipsCollide), { at: t, vol: vol * 0.35, rate: 1.7 });
  }
}
/** Random twinkling high pings. */
function sparkle(k: Kit, at: number, dur: number, n: number, vol = 0.08): void {
  for (let i = 0; i < n; i++) {
    const d = rnd(0.05, 0.12);
    k.osc('sine', rnd(3200, 8200), d, { at: at + rnd(0, dur), vol: vol * rnd(0.5, 1), pan: rnd(-0.7, 0.7) });
  }
}
/** Casino bell: FM 1 : 3.5 (GDD §6.10) plus a quiet octave sine. */
function bellNote(k: Kit, at: number, f: number, vol: number, dur = 0.9): void {
  k.fm(f, 3.5, 2.2, dur, { at, vol, idxEnd: 0.08 });
  k.osc('sine', f * 2, dur * 0.4, { at, vol: vol * 0.12 });
}
/** Vibraphone-ish mallet: sine + 3.9× partial, soft tremolo. */
function mallet(k: Kit, at: number, f: number, vol: number, dur = 0.7): void {
  k.osc('sine', f, dur, { at, vol, env: { a: 0.002, d: dur, s: 0, r: 0.02 }, am: [5.5, 0.36] });
  k.osc('sine', f * 3.9, dur * 0.35, { at, vol: vol * 0.25 });
}
/** Brass-like stack: detuned saws through a lowpass, gentle swell. */
function brass(k: Kit, at: number, freqs: number[], dur: number, vol: number, env = { a: 0.025, d: 0.12, s: 0.7, r: 0.16 }): void {
  const v = vol / Math.sqrt(freqs.length * 2);
  for (const f of freqs) for (const dt of [-8, 8]) k.osc('sawtooth', f, dur, { at, vol: v, detune: dt, lp: Math.min(f * 5, 5200), q: 0.9, env });
}
/** Choir-ish pad: three detuned saws per note through "ah" formant lowpass, slow attack. */
function pad(k: Kit, at: number, freqs: number[], dur: number, vol: number): void {
  const v = vol / Math.sqrt(freqs.length * 3);
  for (const f of freqs) for (const dt of [-7, 0, 7]) k.osc('sawtooth', f, dur, { at, vol: v, detune: dt, lp: 1500, q: 1.4, env: { a: Math.min(0.5, dur * 0.3), d: 0.2, s: 0.8, r: Math.min(0.8, dur * 0.4) } });
}
/** Rising whoosh / riser. */
function riser(k: Kit, at: number, dur: number, vol: number, f0 = 300, f1 = 7000): void {
  k.noise(dur, { at, vol, filter: 'bandpass', freq: f0, to: f1, q: 1.4, env: { a: dur * 0.9, d: dur * 0.1, s: 0.3, r: 0.03 } });
}

// ── UI ────────────────────────────────────────────────────────────────────────────────────────────
def('click', (k) => {
  snap(k, 0, 0.5, 4200, 0.008, 1);
  k.osc('triangle', rnd(1500, 1700), 0.03, { vol: 0.28, to: 900, env: { a: 0.001, d: 0.03, s: 0, r: 0.005 } });
  return 0.05;
}, { bus: 'ui', pri: 8, max: 3 });
def('hover', (k) => { k.osc('sine', rnd(1900, 2100), 0.035, { vol: 0.14, to: 2500, env: { a: 0.004, d: 0.03, s: 0, r: 0.005 } }); return 0.05; }, { bus: 'ui', pri: 4, max: 2 });
def('button', (k) => {
  thump(k, 0, 260, 110, 0.06, 0.5, 'triangle');
  snap(k, 0, 0.5, 2500, 0.01, 1);
  k.osc('square', 880, 0.02, { vol: 0.07 });
  return 0.08;
}, { bus: 'ui', pri: 8, max: 3 });
def('popUp', (k, o) => {
  const f = 280 * semi((o.param ?? 0.4) * 10);
  k.osc('sine', f, 0.08, { vol: 0.35, to: f * 3, env: { a: 0.005, d: 0.075, s: 0, r: 0.01 } });
  k.osc('sine', f * 2, 0.05, { vol: 0.1, to: f * 5 });
  snap(k, 0, 0.18, 2800, 0.006);
  return 0.12;
}, { bus: 'ui', pri: 6, max: 3 });
def('numberTick', (k) => {
  snap(k, 0, 0.3, rnd(3800, 4600), 0.006, 4);
  k.osc('sine', rnd(1450, 1700), 0.01, { vol: 0.06 });
  return 0.03;
}, { bus: 'ui', pri: 3, max: 3 });
def('quotaTick', (k, o) => {
  const f = 500 + 900 * (o.param ?? 0.5);
  k.osc('sine', f, 0.045, { vol: 0.22, env: { a: 0.003, d: 0.04, s: 0, r: 0.01 } });
  snap(k, 0, 0.2, 3000, 0.006, 3);
  return 0.06;
}, { bus: 'ui', pri: 4, max: 3 });
// Charm proc tick (wave 8 juice). Pitch rises with the proc tier: the HUD passes PlayOpts.pitch = 12·log2(1 + 0.06·tier).
def('charmTick', (k) => {
  k.osc('triangle', 1320, 0.05, { vol: 0.2, env: { a: 0.002, d: 0.035, s: 0, r: 0.012 } });
  snap(k, 0, 0.2, 3600, 0.005, 3);
  return 0.06;
}, { bus: 'ui', pri: 4, max: 6 });
def('beep', (k) => { k.osc('square', 1000, 0.07, { vol: 0.16, lp: 3500, env: { a: 0.003, d: 0.01, s: 0.8, r: 0.012 } }); return 0.09; }, { bus: 'ui', pri: 6 });
def('error', (k) => {
  k.osc('square', 440, 0.09, { vol: 0.16, lp: 2200, env: { a: 0.003, d: 0.01, s: 0.8, r: 0.01 } });
  k.osc('square', 330, 0.13, { at: 0.1, vol: 0.16, lp: 2200, env: { a: 0.003, d: 0.01, s: 0.8, r: 0.03 } });
  k.osc('sawtooth', 110, 0.2, { at: 0.04, vol: 0.12, lp: 600, env: { a: 0.01, d: 0.01, s: 0.8, r: 0.06 } });
  return 0.28;
}, { bus: 'ui', pri: 7 });
def('chime', (k, o) => {
  const f = hz('C6') * semi([0, 2, 4, 7, 9][Math.round((o.param ?? 0.4) * 4)]);
  mallet(k, 0, f, 0.3, 1.4); k.osc('sine', f * 2, 0.5, { vol: 0.05 });
  return 1.5;
}, { pri: 5 });

// ── slots / mechanics ─────────────────────────────────────────────────────────────────────────────
def('lever', (k) => {
  thump(k, 0, 170, 80, 0.08, 0.55, 'triangle'); snap(k, 0, 0.5, 1000, 0.025, 1.5);       // grab
  for (let i = 0; i < 7; i++) {                                                          // ratchet down the stroke
    const t = 0.05 + i * (0.04 + i * 0.006);
    snap(k, t, 0.4, 2300 - i * 120, 0.009, 7);
    k.osc('square', 520 - i * 25, 0.012, { at: t, vol: 0.04 });
  }
  k.noise(0.28, { at: 0.04, vol: 0.14, filter: 'bandpass', freq: 500, to: 1400, q: 1.6, env: { a: 0.04, d: 0.24, s: 0, r: 0.02 } });
  thump(k, 0.4, 120, 42, 0.16, 0.9); snap(k, 0.4, 0.7, 1500, 0.03, 1.1); ring(k, 0.4, 620, 0.22, 0.09);   // end-stop clunk
  return 0.7;
}, { pri: 7 });
/** param 0..1 → 4..14 clicks. */
def('ratchet', (k, o) => {
  const n = Math.round(4 + (o.param ?? 0.4) * 10);
  for (let i = 0; i < n; i++) {
    const t = i * 0.032;
    snap(k, t, 0.45, 2400 + i * 50, 0.01, 6);
    k.osc('triangle', 700 + i * 30, 0.012, { at: t, vol: 0.08 });
  }
  return n * 0.032 + 0.03;
}, { pri: 5 });
def('reelStart', (k) => {
  thump(k, 0, 150, 70, 0.08, 0.55); snap(k, 0, 0.5, 1800, 0.025, 1.2);
  k.osc('sawtooth', 50, 0.4, { at: 0.02, vol: 0.2, to: 170, curve: 'lin', lp: 400, lpTo: 1400, env: { a: 0.05, d: 0.3, s: 0.6, r: 0.08 } });
  k.noise(0.4, { at: 0.02, vol: 0.28, filter: 'bandpass', freq: 300, to: 1800, q: 1.2, env: { a: 0.12, d: 0.25, s: 0.4, r: 0.06 } });
  for (let i = 0; i < 4; i++) snap(k, 0.08 + i * 0.05, 0.25, 2600, 0.008, 6);
  return 0.5;
}, { pri: 6 });
/** Spinning reel strip. param 0..1 = speed. Loop-safe. */
def(['reelLoop', 'reelSpin'], (k, o) => {
  const sp = o.param ?? 0.5, dur = o.loop ? 0.4 : 0.8, env = o.loop ? LOOP_ENV : { a: 0.02, d: 0.01, s: 1, r: 0.08 };
  k.noise(dur, { vol: 0.2, filter: 'bandpass', freq: 1400, q: 1.5, env, am: [20 + sp * 16, 0.9] });
  k.osc('sawtooth', 62, dur, { vol: 0.1, lp: 300, env });
  const n = Math.max(1, Math.round(dur / (0.04 - sp * 0.012)));      // whole ticks per chunk: even spacing across loop seams
  for (let i = 0; i < n; i++) snap(k, (i * dur) / n, 0.2, 2600, 0.007, 6);
  return dur;
}, { pri: 5, max: 2 });
def('reelTick', (k, o) => {
  const f = 1100 * semi((o.param ?? 0.3) * 6);
  snap(k, 0, 0.4, 3000, 0.008, 5);
  k.osc('sine', f, 0.016, { vol: 0.16, to: f * 0.65 });
  return 0.03;
}, { pri: 3, max: 4 });
/** param 0..1 = reel index → pitch climbs up to +5 semitones. */
def('reelStop', (k, o) => {
  const s = semi((o.param ?? 0) * 5);
  thump(k, 0, 140 * s, 55, 0.12, 0.85); snap(k, 0, 0.7, 1800, 0.03, 1);
  snap(k, 0, 0.35, 4200, 0.006, 3);
  ring(k, 0.005, 900 * s, 0.25, 0.1);
  snap(k, 0.09, 0.25, 2200, 0.008, 5);                                                   // rebound
  return 0.4;
}, { pri: 6 });
def('crank', (k, o) => {
  const dur = o.loop ? 0.5 : 0.8, env = o.loop ? LOOP_ENV : { a: 0.02, d: 0.01, s: 1, r: 0.06 };
  const n = Math.max(1, Math.round(dur / 0.083)), st = dur / n;
  for (let i = 0; i < n; i++) { snap(k, i * st, 0.4, 1900 + (i % 2) * 300, 0.01, 6); thump(k, i * st, 220, 140, 0.02, 0.12, 'triangle'); }
  k.osc('sawtooth', 120, dur, { vol: 0.05, to: 140, lp: 500, env });
  return dur;
}, { pri: 4, max: 2 });
def('motor', (k, o) => {
  const dur = o.loop ? 0.5 : 1.2, env = o.loop ? LOOP_ENV : { a: 0.05, d: 0.01, s: 1, r: 0.15 };
  k.osc('sawtooth', 72, dur, { vol: 0.13, lp: 300, env, am: [18, 0.3] });
  k.osc('sine', 36, dur, { vol: 0.14, env });
  k.noise(dur, { vol: 0.16, color: 'brown', filter: 'lowpass', freq: 200, env });
  return dur;
}, { pri: 4, max: 2 });
def('gunClick', (k) => {
  snap(k, 0, 0.5, 3500, 0.006, 5); thump(k, 0, 300, 200, 0.02, 0.15, 'triangle');
  ring(k, 0.045, 1900, 0.08, 0.1); snap(k, 0.045, 0.3, 2800, 0.006, 6);
  return 0.15;
}, { pri: 7 });
def(['gunBlank', 'blankClick'], (k) => {
  snap(k, 0, 0.5, 3000, 0.006, 5); thump(k, 0, 200, 120, 0.03, 0.2, 'triangle');
  k.noise(0.12, { at: 0.02, vol: 0.12, filter: 'lowpass', freq: 700, env: { a: 0.01, d: 0.1, s: 0, r: 0.02 } });
  return 0.25;
}, { pri: 7 });
/** Pump-action rack: slide back, slide forward + lock. */
def(['gunLoad', 'shellRack'], (k) => {
  k.noise(0.05, { vol: 0.3, filter: 'bandpass', freq: 1500, q: 1.2, env: TICK_ENV(0.05) }); ring(k, 0, 1300, 0.1, 0.12); thump(k, 0, 220, 150, 0.03, 0.2, 'triangle');
  k.noise(0.04, { at: 0.18, vol: 0.35, filter: 'bandpass', freq: 1800, q: 1.2, env: TICK_ENV(0.04) }); ring(k, 0.18, 1700, 0.08, 0.1);
  thump(k, 0.18, 180, 90, 0.05, 0.45); snap(k, 0.2, 0.4, 2400, 0.008, 4);
  return 0.45;
}, { pri: 7 });
def('shellEject', (k) => {
  for (const [t, v] of [[0, 1], [0.09, 0.55], [0.15, 0.3]] as const) { ring(k, t, 3800, 0.07, 0.16 * v, { ratios: [1, 2.1], amps: [1, 0.4], pan: 0.3 }); thump(k, t, 320, 240, 0.015, 0.1 * v, 'triangle'); }
  k.noise(0.06, { at: 0.2, vol: 0.05, filter: 'bandpass', freq: 4000, q: 2 });
  return 0.4;
}, { pri: 5 });
def('gunShot', (k) => {
  k.noise(0.02, { vol: 0.9, filter: 'highpass', freq: 1500, env: TICK_ENV(0.02) });                                         // crack
  k.noise(0.22, { vol: 0.8, filter: 'lowpass', freq: 3500, to: 300, q: 0.9, env: { a: 0.0008, d: 0.22, s: 0, r: 0.02 } });  // body
  thump(k, 0, 160, 40, 0.22, 0.9); thump(k, 0, 90, 30, 0.35, 0.5);                                                         // chest
  k.noise(0.5, { at: 0.04, vol: 0.14, color: 'pink', filter: 'lowpass', freq: 900, env: { a: 0.02, d: 0.48, s: 0, r: 0.02 } }); // room
  ring(k, 0.02, 520, 0.4, 0.05);
  return 0.75;
}, { pri: 8, max: 3 });

// ── coins / chips / cards / dice / balls ──────────────────────────────────────────────────────────
def('coin', (k) => { clink(k, 0, 0.5); k.sample(smp(SMP.chipsCollide), { vol: 0.12, rate: 1.9 }); return 0.2; }, { pri: 4, max: 8 });
def('coinDrop', (k) => {
  clink(k, 0, 0.55, rnd(2100, 2700));
  [[0.075, 0.38], [0.125, 0.25], [0.16, 0.14]].forEach(([t, v]) => clink(k, t + rnd(0, 0.01), v));
  k.sample(smp(SMP.chipsCollide), { vol: 0.2, rate: 1.5 });
  return 0.4;
}, { pri: 4, max: 6 });
def('coinFlick', (k) => {
  k.osc('sine', 3300, 0.5, { vol: 0.12, vib: [7, 40], env: { a: 0.003, d: 0.45, s: 0, r: 0.05 } });
  k.osc('sine', 4430, 0.4, { vol: 0.06, vib: [7, 50] });
  k.noise(0.12, { vol: 0.12, filter: 'bandpass', freq: 2000, to: 5000, q: 1.5, env: { a: 0.02, d: 0.1, s: 0, r: 0.01 } });
  snap(k, 0, 0.35, 5500, 0.006, 2);
  return 0.55;
}, { pri: 4 });
def('coinLand', (k) => {
  clink(k, 0, 0.6, 2200, 0.14); thump(k, 0, 300, 180, 0.03, 0.18, 'triangle');
  let t = 0.09, gap = 0.085, v = 0.35;                                                      // spinning settle: accelerating, fading
  while (gap > 0.011) { clink(k, t, v, rnd(2700, 3300), 0.05); t += gap; gap *= 0.8; v *= 0.9; }
  k.osc('sine', 2900, 0.1, { at: t, vol: 0.05, env: { a: 0.005, d: 0.09, s: 0, r: 0.01 } });
  return t + 0.15;
}, { pri: 4 });
def('coinShower', (k) => { cascade(k, 0, 1.2, 24, 0.4); return 1.6; }, { pri: 5 });
/** param 0..1 intensity. Loop-safe. */
def('coinPour', (k, o) => {
  const it = 0.4 + (o.param ?? 0.6) * 0.6, dur = o.loop ? 0.5 : 0.9, env = o.loop ? LOOP_ENV : { a: 0.04, d: 0.01, s: 1, r: 0.2 };
  k.noise(dur, { vol: 0.22 * it, filter: 'bandpass', freq: 5000, q: 0.7, env });
  k.noise(dur, { vol: 0.18 * it, color: 'brown', filter: 'lowpass', freq: 700, env });
  const n = Math.round(dur * 22 * it);
  for (let i = 0; i < n; i++) clink(k, rnd(0, dur), rnd(0.12, 0.28));
  return dur;
}, { pri: 4, max: 2 });
def('coinMagnet', (k) => {
  k.osc('sine', 500, 0.42, { vol: 0.14, to: 2400, env: { a: 0.04, d: 0.3, s: 0.4, r: 0.06 } });
  riser(k, 0, 0.4, 0.2, 800, 5000);
  for (let i = 0; i < 6; i++) clink(k, i * 0.065, 0.28, 2000 + i * 260);
  k.osc('sine', 1800, 0.05, { at: 0.42, vol: 0.3, to: 600, env: { a: 0.002, d: 0.05, s: 0, r: 0.01 } });
  return 0.55;
}, { pri: 5 });
def('chip', (k) => {
  k.sample(smp(SMP.chipLay), { vol: 0.9 });
  k.osc('sine', 1300, 0.025, { vol: 0.14, to: 850 }); thump(k, 0, 520, 380, 0.025, 0.12, 'triangle'); snap(k, 0, 0.2, 4500, 0.008, 2);
  return 0.2;
}, { pri: 4, max: 6 });
/** param 0..1 → 3..6 chips. */
def('chipStack', (k, o) => {
  const n = 3 + Math.round((o.param ?? 0.4) * 3);
  k.sample(smp(SMP.chipsStack), { vol: 0.9 });
  for (let i = 0; i < n; i++) { const t = 0.03 + i * 0.045; k.osc('sine', 1100 + i * 90, 0.02, { at: t, vol: 0.09, to: 800 }); snap(k, t, 0.18, 4000 + i * 150, 0.008, 2); }
  k.sample(smp(SMP.chipsHandle), { at: 0.12, vol: 0.45 });
  return 0.5;
}, { pri: 4, max: 4 });
def('card', (k) => {
  k.sample(smp(SMP.cardPlace), { vol: 0.9 });
  k.noise(0.06, { vol: 0.12, filter: 'bandpass', freq: 2000, to: 900, q: 1, env: { a: 0.004, d: 0.05, s: 0, r: 0.01 } }); snap(k, 0, 0.25, 3200, 0.01, 1.2, 'highpass');
  return 0.25;
}, { pri: 5, max: 5 });
def('cardFlip', (k) => {
  k.sample(smp(SMP.cardSlide), { vol: 0.8, rate: 1.1 });
  k.noise(0.05, { vol: 0.18, filter: 'bandpass', freq: 1500, to: 4500, q: 1.2, env: { a: 0.005, d: 0.04, s: 0, r: 0.01 } }); snap(k, 0.03, 0.3, 3600, 0.007, 2);
  return 0.25;
}, { pri: 5, max: 5 });
def('shuffle', (k) => {
  k.sample(smp(SMP.cardShuffle), { vol: 1 });
  let t = 0.02, gap = 0.032;
  for (let i = 0; i < 24; i++) { snap(k, t, 0.22, 2800, 0.006, 2, 'bandpass', (i % 2 ? 0.3 : -0.3)); t += gap * rnd(0.7, 1.3); gap *= 0.97; }
  k.noise(0.15, { at: t, vol: 0.12, filter: 'bandpass', freq: 800, env: { a: 0.01, d: 0.13, s: 0, r: 0.02 } });
  return Math.max(0.9, t + 0.15);
}, { pri: 5 });
def('cardSlap', (k) => {
  k.sample(smp(SMP.cardPlace), { vol: 1, rate: 0.85 });
  thump(k, 0, 220, 110, 0.05, 0.55); snap(k, 0, 0.55, 1100, 0.03, 1); snap(k, 0, 0.3, 3500, 0.02, 1, 'highpass');
  return 0.3;
}, { pri: 6 });
def(['dice', 'diceRoll'], (k) => {
  k.sample(smp(SMP.diceShake), { vol: 0.85 });
  k.sample(smp(SMP.diceThrow), { at: 0.5, vol: 1 });
  for (let i = 0; i < 9; i++) { const t = 0.55 + Math.pow(rnd(0, 1), 1.4) * 0.6; snap(k, t, 0.35 * (1 - (t - 0.55)), rnd(1500, 2800), 0.008, 4, 'bandpass', rnd(-0.4, 0.4)); thump(k, t, rnd(260, 360), 150, 0.02, 0.1, 'triangle'); }
  return 1.3;
}, { pri: 5 });
def('diceLand', (k) => {
  k.sample(smp(SMP.dieThrow), { vol: 0.95 });
  thump(k, 0, 260, 140, 0.04, 0.5, 'triangle'); snap(k, 0, 0.45, 1500, 0.015, 2);
  for (const [t, v] of [[0.1, 0.5], [0.17, 0.3], [0.22, 0.15]] as const) { thump(k, t, 280, 170, 0.025, 0.25 * v, 'triangle'); snap(k, t, 0.3 * v, 1800, 0.008, 3); }
  return 0.6;
}, { pri: 5 });
/** param 0..1 → flapper speed (pitch). */
def('wheelTick', (k, o) => {
  const s = semi((o.param ?? 0.3) * 5);
  snap(k, 0, 0.4, 3200 * s, 0.01, 6); k.osc('triangle', 1500 * s, 0.018, { vol: 0.2, to: 1000 * s }); thump(k, 0, 400, 220, 0.015, 0.1);
  return 0.06;
}, { pri: 3, max: 4 });
/** param 0..1 = speed. Loop-safe. */
def('ballRoll', (k, o) => {
  const sp = o.param ?? 0.5, dur = o.loop ? 0.6 : 1, env = o.loop ? LOOP_ENV : { a: 0.05, d: 0.01, s: 1, r: 0.15 };
  k.noise(dur, { vol: 0.2, filter: 'lowpass', freq: 800 + sp * 400, q: 0.9, env, am: [6 + sp * 8, 0.8] });
  const n = Math.max(1, Math.round(dur / (0.08 - sp * 0.04)));
  for (let i = 0; i < n; i++) snap(k, (i * dur) / n, 0.08, 2600, 0.006, 4);
  return dur;
}, { pri: 4, max: 2 });
/** param 0..1 = impact velocity. */
def('ballBounce', (k, o) => {
  const v = Math.max(0.15, o.param ?? 0.6);
  k.osc('sine', 340 + 240 * v, 0.045, { vol: 0.5 * v, to: 240, env: { a: 0.002, d: 0.045, s: 0, r: 0.01 } });
  snap(k, 0, 0.5 * v, 3500, 0.008, 2); k.noise(0.025, { vol: 0.15 * v, filter: 'lowpass', freq: 900, env: TICK_ENV(0.025) });
  return 0.12;
}, { pri: 4, max: 5 });
def('ballDrop', (k) => {
  let t = 0, gap = 0.1, v = 1;
  for (let i = 0; i < 5; i++) { k.osc('sine', 400, 0.04, { at: t, vol: 0.4 * v, to: 250 }); snap(k, t, 0.4 * v, 3300, 0.008, 2); t += gap; gap *= 0.7; v *= 0.65; }
  thump(k, t, 200, 90, 0.06, 0.5); ring(k, t, 1400, 0.2, 0.08); k.noise(0.06, { at: t, vol: 0.15, filter: 'lowpass', freq: 700 });
  return t + 0.3;
}, { pri: 5 });

// ── bells, jingles, stingers ──────────────────────────────────────────────────────────────────────
def('bell', (k) => {
  k.fm(660, 3.5, 2.4, 1.2, { vol: 0.42, idxEnd: 0.08 }); k.fm(1320, 3.5, 1.6, 0.8, { vol: 0.12 }); ring(k, 0, 1990, 0.5, 0.05);
  snap(k, 0, 0.3, 3500, 0.006, 2);
  return 1.4;
}, { pri: 6 });
def('buzzer', (k) => {
  const env = { a: 0.01, d: 0.01, s: 1, r: 0.08 };
  k.osc('sawtooth', 98, 0.5, { vol: 0.2, lp: 1100, env, am: [30, 0.7] });
  k.osc('sawtooth', 103, 0.5, { vol: 0.2, lp: 1100, env }); k.osc('square', 49, 0.5, { vol: 0.14, lp: 400, env });
  k.noise(0.5, { vol: 0.08, filter: 'lowpass', freq: 600, env });
  return 0.6;
}, { pri: 8 });
def('lose', (k) => {
  // "womp womp" — muted trombone slides
  const notes: [number, number, number][] = [[233, 0, 0.22], [220, 0.27, 0.22], [208, 0.54, 0.22], [196, 0.81, 0.6]];
  for (const [f, t, d] of notes) k.osc('sawtooth', f, d, { at: t, vol: 0.28, to: t > 0.8 ? 138 : f * 0.97, glide: d, lp: 760, lpTo: 330, q: 1.2, vib: [5.2, 28], env: { a: 0.03, d: 0.05, s: 0.8, r: 0.07 } });
  thump(k, 0, 120, 55, 0.12, 0.4);
  return 1.5;
}, { pri: 8 });
def('whoosh', (k, o) => {
  const dur = 0.2 + (o.param ?? 0.4) * 0.5;
  k.noise(dur, { vol: 0.5, filter: 'bandpass', freq: 300, to: 2800, q: 1.2, env: { a: dur * 0.55, d: dur * 0.45, s: 0, r: 0.03 } });
  k.noise(dur, { vol: 0.2, filter: 'highpass', freq: 3000, env: { a: dur * 0.6, d: dur * 0.4, s: 0, r: 0.03 } });
  return dur + 0.05;
}, { pri: 4 });
def('thud', (k) => {
  thump(k, 0, 110, 38, 0.22, 0.95); k.noise(0.04, { vol: 0.4, filter: 'lowpass', freq: 250, env: TICK_ENV(0.04) }); snap(k, 0, 0.3, 500, 0.03, 1);
  return 0.35;
}, { pri: 6 });
def('glass', (k) => { ring(k, 0, 3100, 0.35, 0.28, { ratios: [1, 1.5, 2.2, 3.4], amps: [1, 0.5, 0.3, 0.14] }); snap(k, 0, 0.3, 6500, 0.005, 2); return 0.5; }, { pri: 4 });
def('glassBreak', (k) => {
  k.noise(0.5, { vol: 0.5, filter: 'highpass', freq: 2500, env: { a: 0.001, d: 0.5, s: 0, r: 0.03 } });
  thump(k, 0, 600, 180, 0.08, 0.35); k.noise(0.1, { vol: 0.3, filter: 'bandpass', freq: 600, q: 0.8, env: TICK_ENV(0.1) });
  for (let i = 0; i < 26; i++) { const t = Math.pow(rnd(0, 1), 1.6) * 0.75; ring(k, t, rnd(3000, 9000), rnd(0.03, 0.09), 0.08 * (1 - t), { ratios: [1, 1.7], amps: [1, 0.4], pan: rnd(-0.7, 0.7) }); }
  return 0.95;
}, { pri: 7 });
def('win1', (k) => {
  thump(k, 0, 210, 90, 0.09, 0.45, 'triangle'); snap(k, 0, 0.3, 2600, 0.012, 1.2);
  ['G5', 'B5', 'D6', 'G6'].forEach((n, i) => bellNote(k, 0.015 + i * 0.065, hz(n), 0.32 - i * 0.02, 0.7));
  for (let i = 0; i < 3; i++) clink(k, 0.12 + i * 0.07, 0.3);
  sparkle(k, 0.28, 0.4, 5, 0.06);
  return 0.9;
}, { pri: 8 });
def('win2', (k) => {
  thump(k, 0, 150, 60, 0.18, 0.7); snap(k, 0, 0.35, 2000, 0.02, 1);
  brass(k, 0, [hz('C4'), hz('E4'), hz('G4')], 0.28, 0.24);
  ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => bellNote(k, 0.02 + i * 0.055, hz(n), 0.3, 0.8));
  cascade(k, 0.12, 0.9, 18, 0.36); sparkle(k, 0.35, 0.6, 8, 0.07);
  bellNote(k, 0.42, hz('C7'), 0.2, 1.2);
  return 1.7;
}, { pri: 8 });
def('win3', (k) => {
  thump(k, 0, 80, 40, 0.5, 0.8); snap(k, 0, 0.4, 1500, 0.03, 1);
  k.noise(1.1, { at: 0.02, vol: 0.2, filter: 'highpass', freq: 5000, env: { a: 0.02, d: 1.08, s: 0, r: 0.05 } });
  brass(k, 0, [hz('C4'), hz('E4'), hz('G4')], 0.14, 0.26, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, 0.16, [hz('C4'), hz('E4'), hz('G4')], 0.14, 0.26, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, 0.34, [hz('G4'), hz('C5'), hz('E5')], 0.9, 0.3);
  ['C6', 'E6', 'G6', 'C7', 'E7'].forEach((n, i) => bellNote(k, 0.38 + i * 0.07, hz(n), 0.28, 0.9));
  for (let i = 0; i < 8; i++) bellNote(k, 0.75 + i * 0.12, hz(i % 2 ? 'G6' : 'C7'), 0.2 - i * 0.015, 0.7);
  cascade(k, 0.15, 1.3, 18, 0.34); sparkle(k, 0.5, 0.9, 10, 0.07);
  pad(k, 0.38, [hz('C5'), hz('E5'), hz('G5'), hz('C6')], 1.4, 0.12);
  return 2.5;
}, { pri: 9 });
def('winHuge', (k) => {
  riser(k, 0, 0.5, 0.3, 400, 6000); k.osc('sine', 200, 0.5, { vol: 0.12, to: 1600, env: { a: 0.45, d: 0.05, s: 0.5, r: 0.03 } });
  thump(k, 0.5, 70, 30, 0.8, 0.9); k.noise(1.2, { at: 0.5, vol: 0.4, filter: 'lowpass', freq: 3500, to: 200, env: { a: 0.002, d: 1.2, s: 0, r: 0.05 } });
  k.noise(1.5, { at: 0.5, vol: 0.2, filter: 'highpass', freq: 5000, env: { a: 0.02, d: 1.5, s: 0, r: 0.05 } });
  const T = 0.5;
  brass(k, T, [hz('C4'), hz('E4'), hz('G4'), hz('C5')], 0.14, 0.3, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, T + 0.17, [hz('C4'), hz('E4'), hz('G4'), hz('C5')], 0.14, 0.3, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, T + 0.36, [hz('G4'), hz('C5'), hz('E5'), hz('G5')], 1.5, 0.34);
  pad(k, T, [hz('C3'), hz('G3'), hz('E4'), hz('B4')], 2.6, 0.2);
  for (let r = 0; r < 2; r++) ['C6', 'E6', 'G6', 'C7', 'E7'].forEach((n, i) => bellNote(k, T + 0.4 + r * 0.45 + i * 0.065, hz(n), 0.26 - r * 0.04, 1));
  cascade(k, T + 0.1, 2.2, 30, 0.34); sparkle(k, T + 0.3, 1.8, 16, 0.07);
  bellNote(k, T + 2.4, hz('C7'), 0.3, 1.6);
  return 3.9;
}, { pri: 9 });
/** Push (part of the stake back): two clinks and a bell, so even a small return is heard. */
def('winPush', (k) => {
  clink(k, 0, 0.42); clink(k, 0.09, 0.3); bellNote(k, 0.03, hz('E5'), 0.2, 0.5);
  return 0.45;
}, { pri: 6 });
/** Huge win rising chord: fast ascending arpeggio over a riser (≈1.1 s), layered on the huge-win slow-mo. */
def('winRise', (k) => {
  riser(k, 0, 0.5, 0.22, 250, 5000);
  ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6'].forEach((n, i) => brass(k, i * 0.075, [hz(n)], 0.42, 0.2, { a: 0.008, d: 0.05, s: 0.6, r: 0.08 }));
  pad(k, 0.45, [hz('C4'), hz('E4'), hz('G4'), hz('C5')], 0.9, 0.18);
  bellNote(k, 0.5, hz('C6'), 0.2, 1);
  return 1.1;
}, { pri: 9, max: 2 });
/** Mega win jingle (≈3.6 s): riser into a bright brass fanfare, a bell shimmer and a coin-shower tail. */
def('winMega', (k) => {
  riser(k, 0, 0.6, 0.28, 300, 6500);
  const T = 0.6;
  thump(k, T, 90, 36, 0.6, 0.9); snap(k, T, 0.45, 1400, 0.03, 1);
  brass(k, T, [hz('C4'), hz('E4'), hz('G4')], 0.16, 0.26, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, T + 0.18, [hz('C4'), hz('E4'), hz('G4')], 0.16, 0.26, { a: 0.012, d: 0.05, s: 0.6, r: 0.06 });
  brass(k, T + 0.36, [hz('F4'), hz('A4'), hz('C5')], 0.4, 0.3);
  brass(k, T + 0.8, [hz('G4'), hz('B4'), hz('D5'), hz('G5')], 2.2, 0.34);
  pad(k, T, [hz('C3'), hz('G3'), hz('E4'), hz('C5')], 3, 0.2);
  ['C6', 'E6', 'G6', 'C7', 'E7', 'G7'].forEach((n, i) => bellNote(k, T + 0.4 + i * 0.09, hz(n), 0.26 - i * 0.02, 1.2));
  cascade(k, T + 0.2, 2.4, 34, 0.34);
  sparkle(k, T + 0.6, 2.2, 18, 0.07);
  bellNote(k, T + 2.6, hz('C7'), 0.3, 1.6);
  return 3.6;
}, { pri: 10, max: 2 });
/** The big one: riser → boom → fanfare (C → A♭) → bell rain → coin flood → shimmer. */
def('jackpot', (k) => {
  for (let i = 0; i < 14; i++) { const t = 0.9 * Math.pow(i / 14, 0.8); k.osc('sine', 700 + i * 70, 0.05, { at: t, vol: 0.14, env: { a: 0.002, d: 0.05, s: 0, r: 0.01 } }); snap(k, t, 0.25, 3000, 0.008, 3); }
  riser(k, 0, 0.9, 0.36, 200, 8000); k.osc('sawtooth', 100, 0.9, { vol: 0.1, to: 1200, lp: 800, lpTo: 4000, env: { a: 0.85, d: 0.04, s: 0.5, r: 0.03 } });
  const T = 0.9;
  thump(k, T, 60, 28, 1.4, 1); thump(k, T, 200, 60, 0.3, 0.6); k.noise(2.2, { at: T, vol: 0.5, filter: 'lowpass', freq: 5000, to: 150, env: { a: 0.002, d: 2.2, s: 0, r: 0.1 } });
  k.noise(2.5, { at: T, vol: 0.22, filter: 'highpass', freq: 4500, env: { a: 0.03, d: 2.5, s: 0, r: 0.1 } });
  const C = [hz('C4'), hz('E4'), hz('G4'), hz('C5')], Ab = [hz('Ab3'), hz('C4'), hz('Eb4'), hz('Ab4')], F = [hz('F4'), hz('A4'), hz('C5'), hz('F5')];
  brass(k, T, C, 0.2, 0.34, { a: 0.012, d: 0.06, s: 0.6, r: 0.08 }); brass(k, T + 0.24, C, 0.2, 0.34, { a: 0.012, d: 0.06, s: 0.6, r: 0.08 });
  brass(k, T + 0.5, F, 0.5, 0.34); brass(k, T + 1.05, Ab, 0.6, 0.36); brass(k, T + 1.7, [hz('G4'), hz('B4'), hz('D5'), hz('G5')], 0.45, 0.34);
  brass(k, T + 2.2, [hz('C4'), hz('E4'), hz('G4'), hz('C5'), hz('E5')], 2.2, 0.38);
  pad(k, T, [hz('C3'), hz('G3'), hz('E4'), hz('B4'), hz('E5')], 4.2, 0.24);
  const scale = ['C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7'];
  for (let t = 0; t < 3.6; t += rnd(0.05, 0.11)) bellNote(k, T + 0.15 + t, hz(pick(scale)), 0.2 * (1 - t / 4.2), 1.1);   // bell rain
  cascade(k, T + 0.1, 3.4, 40, 0.34); sparkle(k, T + 0.4, 3.4, 26, 0.08);
  bellNote(k, T + 3.7, hz('C7'), 0.34, 2); bellNote(k, T + 3.7, hz('C6'), 0.3, 2.4); sparkle(k, T + 3.7, 1.2, 10, 0.06);
  return 6.4;
}, { pri: 10, max: 2 });
/** Rotating beacon siren (seamless 1.6 s chunk = 2 LFO cycles) with bell pings. Loop-safe. */
def('jackpotSiren', (k, o) => {
  const v = 0.22 * (0.6 + 0.4 * (o.param ?? 1));
  k.osc('sawtooth', 1050, 1.6, { vol: v, lp: 3500, env: LOOP_ENV, tap: ({ src, at, end }) => k.lfo(src.frequency, 1.25, 450, at, end) });
  for (let i = 0; i < 4; i++) k.fm(1760, 1, 1.2, 0.35, { at: i * 0.4, vol: 0.08 });
  for (let i = 0; i < 2; i++) thump(k, i * 0.8, 85, 60, 0.3, 0.14);
  return 1.6;
}, { pri: 7, max: 2 });
/** Bell shower used by jackpot-style celebrations (also standalone). */
def('jackpotBells', (k) => {
  const scale = ['C6', 'E6', 'G6', 'A6', 'C7', 'E7'];
  for (let t = 0; t < 1.8; t += rnd(0.05, 0.1)) bellNote(k, t, hz(pick(scale)), 0.22 * (1 - t / 2.2), 1);
  return 2.8;
}, { pri: 8 });
def('stinger', (k) => {
  riser(k, 0, 0.8, 0.3, 500, 7000); k.osc('sine', 330, 0.8, { vol: 0.16, to: 660, env: { a: 0.75, d: 0.04, s: 0.4, r: 0.03 } });
  const T = 0.8;
  thump(k, T, 70, 30, 0.9, 0.9); snap(k, T, 0.5, 1200, 0.04, 1);
  for (const f of [hz('E3'), hz('F3'), hz('Bb3')]) k.osc('sawtooth', f, 1.1, { at: T, vol: 0.12, lp: 1800, lpTo: 300, env: { a: 0.004, d: 1.1, s: 0, r: 0.1 } });
  k.fm(180, 1.41, 3.2, 1.4, { at: T, vol: 0.28, idxEnd: 0.15 });
  return 2.2;
}, { pri: 9 });
def('quotaMet', (k) => {
  thump(k, 0, 140, 60, 0.14, 0.8); snap(k, 0, 0.5, 900, 0.04, 1);
  brass(k, 0.08, [hz('C4'), hz('E4'), hz('G4'), hz('C5')], 0.6, 0.3);
  ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => bellNote(k, 0.25 + i * 0.08, hz(n), 0.26, 1));
  cascade(k, 0.2, 1, 12, 0.3); sparkle(k, 0.5, 0.8, 8, 0.07);
  return 1.9;
}, { pri: 9 });
def('quotaFail', (k) => {
  k.fm(98, 1.41, 4, 2.6, { vol: 0.5, idxEnd: 0.2, idxDecay: 1 }); k.fm(147, 2.04, 3, 1.8, { vol: 0.2 });
  thump(k, 0, 80, 28, 0.8, 0.9); snap(k, 0, 0.4, 700, 0.04, 1);
  k.osc('sawtooth', hz('Bb2'), 1.3, { at: 0.2, vol: 0.12, lp: 500, env: { a: 0.2, d: 0.2, s: 0.7, r: 0.7 } });
  k.osc('sawtooth', hz('E3'), 1.3, { at: 0.2, vol: 0.1, lp: 500, env: { a: 0.2, d: 0.2, s: 0.7, r: 0.7 } });
  k.noise(1.6, { at: 0.1, vol: 0.12, color: 'brown', filter: 'lowpass', freq: 300, env: { a: 0.5, d: 0.5, s: 0.4, r: 0.6 } });
  return 2.8;
}, { pri: 9 });
def('upgrade', (k) => {
  for (let i = 0; i < 4; i++) snap(k, i * 0.035, 0.4, 2400 + i * 150, 0.009, 6);
  thump(k, 0, 120, 60, 0.1, 0.45);
  k.fm(1320, 2.76, 3, 0.6, { at: 0.14, vol: 0.34, idxEnd: 0.1 });
  ['E6', 'G6', 'B6'].forEach((n, i) => bellNote(k, 0.24 + i * 0.06, hz(n), 0.16, 0.6)); clink(k, 0.2, 0.25);
  return 1;
}, { pri: 8 });
def('purchase', (k) => {
  thump(k, 0, 190, 90, 0.08, 0.5); snap(k, 0, 0.5, 1300, 0.025, 1.2);
  k.fm(2400, 2, 1.6, 0.5, { at: 0.06, vol: 0.26 }); clink(k, 0.1, 0.35); clink(k, 0.16, 0.3);
  return 0.7;
}, { pri: 7 });
def('cashRegister', (k) => {
  thump(k, 0, 190, 90, 0.08, 0.5); snap(k, 0, 0.5, 1300, 0.03, 1.2);
  k.noise(0.12, { at: 0.04, vol: 0.2, filter: 'bandpass', freq: 900, to: 2500, q: 1.4, env: { a: 0.01, d: 0.1, s: 0, r: 0.01 } });
  k.noise(0.15, { at: 0.15, vol: 0.2, filter: 'lowpass', freq: 1200, env: { a: 0.03, d: 0.1, s: 0, r: 0.03 } });
  ring(k, 0.12, 2900, 0.6, 0.2, { ratios: [1, 2.4, 3.8], amps: [1, 0.5, 0.25] }); ring(k, 0.2, 2900, 0.6, 0.2, { ratios: [1, 2.4, 3.8], amps: [1, 0.5, 0.25] });
  thump(k, 0.28, 100, 50, 0.15, 0.7); for (let i = 0; i < 6; i++) clink(k, 0.3 + i * 0.03 + rnd(0, 0.02), 0.2);
  return 1.1;
}, { pri: 7 });
def('unlock', (k) => {
  for (const t of [0, 0.09]) { snap(k, t, 0.5, 2200, 0.012, 8); ring(k, t, 1500, 0.06, 0.1); }
  thump(k, 0.17, 120, 60, 0.12, 0.6);
  k.osc('sine', 400, 0.45, { at: 0.18, vol: 0.12, to: 1600, env: { a: 0.05, d: 0.35, s: 0.3, r: 0.06 } });
  ['G6', 'B6', 'D7'].forEach((n, i) => bellNote(k, 0.22 + i * 0.09, hz(n), 0.2, 0.8));
  k.noise(0.5, { at: 0.2, vol: 0.06, filter: 'highpass', freq: 6000, env: { a: 0.1, d: 0.4, s: 0, r: 0.02 } });
  return 1;
}, { pri: 8 });
def('buffGain', (k) => {
  ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => mallet(k, i * 0.06, hz(n), 0.3, 0.7));
  k.osc('sine', 600, 0.35, { vol: 0.08, to: 2400, env: { a: 0.1, d: 0.2, s: 0.3, r: 0.05 } });
  k.chord([hz('C4'), hz('G4'), hz('E5')], 0.5, 'triangle', { at: 0.1, vol: 0.12 });
  return 0.9;
}, { pri: 7 });
def('buffLose', (k) => {
  ['G5', 'Eb5', 'C5', 'Ab4'].forEach((n, i) => k.osc('sawtooth', hz(n), 0.18, { at: i * 0.1, vol: 0.18, detune: i * 6, lp: 1400, lpTo: 500, env: { a: 0.01, d: 0.05, s: 0.6, r: 0.1 } }));
  k.osc('sawtooth', hz('Ab4'), 0.35, { at: 0.4, vol: 0.14, to: hz('Ab4') * 0.8, lp: 900, lpTo: 300, env: { a: 0.01, d: 0.05, s: 0.7, r: 0.2 } });
  thump(k, 0, 110, 50, 0.2, 0.5);
  return 0.9;
}, { pri: 7 });
def('stamp', (k) => {
  thump(k, 0, 170, 60, 0.1, 0.9); k.noise(0.08, { vol: 0.45, filter: 'bandpass', freq: 700, q: 1, env: TICK_ENV(0.08) });
  snap(k, 0, 0.35, 3000, 0.012, 1, 'highpass'); snap(k, 0.1, 0.12, 2200, 0.01, 3);
  return 0.25;
}, { pri: 6 });
def('printer', (k) => {
  for (let l = 0; l < 4; l++) {
    const t = l * 0.27;
    k.noise(0.2, { at: t, vol: 0.32, filter: 'bandpass', freq: 2600, q: 3, env: { a: 0.01, d: 0.01, s: 1, r: 0.02 }, am: [85, 0.8] });
    k.noise(0.06, { at: t + 0.2, vol: 0.2, filter: 'bandpass', freq: 3500, to: 700, q: 1.5, env: TICK_ENV(0.06) });
  }
  k.osc('sawtooth', 140, 1.1, { vol: 0.04, lp: 500, env: { a: 0.05, d: 0.01, s: 1, r: 0.1 } });
  return 1.2;
}, { pri: 4 });
def('sparkle', (k) => {
  sparkle(k, 0, 0.5, 11, 0.1);
  k.osc('sine', 4000, 0.2, { vol: 0.05, to: 7000, env: { a: 0.02, d: 0.18, s: 0, r: 0.01 } }); k.noise(0.3, { vol: 0.04, filter: 'highpass', freq: 7000, env: { a: 0.05, d: 0.25, s: 0, r: 0.02 } });
  return 0.7;
}, { pri: 4, max: 3 });

// ── horror ────────────────────────────────────────────────────────────────────────────────────────
const WHISPER_VOWELS: [number, number][] = [[800, 1200], [550, 1800], [300, 2300], [500, 900], [330, 800], [450, 1500]];
def(['whisper', 'whispers'], (k) => {
  let t = 0;
  for (let w = 0, words = rndi(3, 5); w < words; w++) {
    const pan = rnd(-0.85, 0.85);
    for (let s = 0, syl = rndi(2, 3); s < syl; s++) {
      const [f1, f2] = pick(WHISPER_VOWELS), d = rnd(0.07, 0.13), env = { a: 0.02, d: d * 0.7, s: 0.5, r: 0.04 };
      k.noise(d, { at: t, vol: 0.5, filter: 'bandpass', freq: f1, q: 4, pan, env });
      k.noise(d, { at: t, vol: 0.35, filter: 'bandpass', freq: f2, q: 5, pan, env });
      t += d + rnd(0.02, 0.05);
    }
    k.noise(0.12, { at: t, vol: 0.22, filter: 'highpass', freq: 5500, pan, env: { a: 0.03, d: 0.1, s: 0, r: 0.02 } });
    t += rnd(0.12, 0.3);
  }
  return t + 0.1;
}, { pri: 5 });
/** Lub-dub, 0.9 s cycle. param 0..1 = intensity (pitch + weight). Loop-safe. */
def('heartbeat', (k, o) => {
  const it = o.param ?? 0.5, s = semi(it * 3);
  thump(k, 0, 48 * s, 34 * s, 0.14, 0.9); k.noise(0.1, { vol: 0.3, color: 'brown', filter: 'lowpass', freq: 120, env: { a: 0.004, d: 0.1, s: 0, r: 0.01 } });
  thump(k, 0.22, 54 * s, 38 * s, 0.12, 0.6); k.noise(0.08, { at: 0.22, vol: 0.2, color: 'brown', filter: 'lowpass', freq: 150, env: { a: 0.004, d: 0.08, s: 0, r: 0.01 } });
  return 0.9;
}, { pri: 6, max: 2 });
def('lightFlicker', (k) => {
  let t = 0;
  for (let i = 0; i < 6; i++) {
    const d = rnd(0.03, 0.09);
    k.osc('sawtooth', 120, d, { at: t, vol: 0.08, lp: 2000, env: { a: 0.002, d: 0.01, s: 1, r: 0.01 } }); snap(k, t, 0.3, 2500, 0.01, 4);
    k.noise(d, { at: t, vol: 0.04, filter: 'highpass', freq: 5000 }); t += d + rnd(0.02, 0.1);
  }
  k.osc('sine', 100, 0.3, { at: t - 0.05, vol: 0.05, env: { a: 0.01, d: 0.28, s: 0, r: 0.02 } });
  return t + 0.3;
}, { pri: 5 });
def('powerDown', (k) => {
  snap(k, 0, 0.4, 1800, 0.02, 3); thump(k, 0, 150, 80, 0.06, 0.4);
  k.osc('sawtooth', 260, 1.4, { at: 0.03, vol: 0.28, to: 24, lp: 1600, lpTo: 120, env: { a: 0.01, d: 1.35, s: 0, r: 0.1 } });
  k.osc('sine', 90, 1.4, { at: 0.03, vol: 0.2, to: 20 }); k.noise(1.2, { at: 0.03, vol: 0.15, filter: 'bandpass', freq: 2500, to: 150, q: 1.5, env: { a: 0.01, d: 1.2, s: 0, r: 0.05 } });
  thump(k, 1.45, 90, 40, 0.15, 0.4);
  return 1.7;
}, { pri: 8 });
def('powerUp', (k) => {
  thump(k, 0, 110, 55, 0.12, 0.6); snap(k, 0, 0.5, 1500, 0.03, 1.2);
  k.osc('sawtooth', 30, 0.9, { at: 0.05, vol: 0.2, to: 260, lp: 100, lpTo: 1800, env: { a: 0.7, d: 0.2, s: 0.5, r: 0.05 } });
  k.osc('sine', 120, 0.5, { at: 0.8, vol: 0.08, env: { a: 0.02, d: 0.3, s: 0.4, r: 0.15 } });
  for (const t of [0.72, 0.8, 0.87]) snap(k, t, 0.4, 3200, 0.008, 5);
  k.fm(1500, 1.5, 2, 0.4, { at: 0.93, vol: 0.12 });
  return 1.4;
}, { pri: 8 });
/** Loop-safe fluorescent/neon buzz. */
def('neonBuzz', (k, o) => {
  const dur = o.loop ? 0.5 : 1, env = o.loop ? LOOP_ENV : { a: 0.05, d: 0.01, s: 1, r: 0.1 };
  k.osc('sawtooth', 120, dur, { vol: 0.09, lp: 1500, env }); k.osc('square', 240, dur, { vol: 0.03, lp: 1500, env });
  k.noise(dur, { vol: 0.03, filter: 'highpass', freq: 5000, env });
  if (chance(0.5)) snap(k, rnd(0.05, dur - 0.05), 0.2, 3000, 0.008, 3);
  return dur;
}, { pri: 3, max: 2 });
def('paClick', (k) => {
  thump(k, 0, 100, 60, 0.05, 0.5); snap(k, 0, 0.6, 3000, 0.02, 0.8);
  k.noise(0.08, { at: 0.02, vol: 0.12, filter: 'highpass', freq: 2500, env: { a: 0.003, d: 0.08, s: 0, r: 0.01 } });
  for (let i = 0; i < 8; i++) snap(k, 0.03 + i * 0.012, 0.15, rnd(2000, 5000), 0.004, 2);
  k.osc('sine', 120, 0.15, { at: 0.04, vol: 0.08, env: { a: 0.01, d: 0.13, s: 0, r: 0.02 } });
  return 0.3;
}, { bus: 'voice', pri: 8 });
def('tapeStop', (k) => {
  k.osc('sawtooth', 440, 0.9, { vol: 0.25, to: 20, lp: 4000, lpTo: 200, vib: [6, 40], env: { a: 0.005, d: 0.9, s: 0, r: 0.05 } });
  k.noise(0.9, { vol: 0.1, color: 'pink', filter: 'bandpass', freq: 3000, to: 200, q: 0.8, env: { a: 0.01, d: 0.9, s: 0, r: 0.05 } });
  return 1.1;
}, { pri: 7 });
def('tinnitus', (k) => {
  const env = { a: 0.06, d: 0.01, s: 1, r: 1.5 };
  k.osc('sine', 7200, 2.6, { vol: 0.1, env }); k.osc('sine', 7233, 2.6, { vol: 0.08, env });
  return 4.2;
}, { pri: 9 });
def('defib', (k) => {
  k.osc('sine', 300, 1.3, { vol: 0.15, to: 2400, env: { a: 0.05, d: 0.2, s: 0.8, r: 0.05 } }); k.osc('sawtooth', 150, 1.3, { vol: 0.04, to: 1200, lp: 1500 });
  k.osc('sine', 1000, 0.12, { at: 1.4, vol: 0.2, env: { a: 0.004, d: 0.01, s: 0.9, r: 0.02 } });
  thump(k, 1.6, 120, 40, 0.25, 1); k.noise(0.08, { at: 1.6, vol: 0.6, filter: 'bandpass', freq: 3000, q: 0.8, env: TICK_ENV(0.08) }); snap(k, 1.6, 0.8, 1500, 0.02, 1);
  return 2.3;
}, { pri: 8 });
def('totemPlace', (k) => {
  thump(k, 0, 100, 45, 0.3, 0.9); k.noise(0.08, { vol: 0.5, filter: 'bandpass', freq: 600, q: 1, env: TICK_ENV(0.08) });
  k.fm(330, 2.01, 3.5, 1.6, { at: 0.03, vol: 0.22, idxEnd: 0.1 });
  ['A4', 'C5', 'E5', 'A5'].forEach((n, i) => mallet(k, 0.1 + i * 0.07, hz(n), 0.14, 0.9)); sparkle(k, 0.2, 0.5, 6, 0.05);
  return 1.8;
}, { pri: 7 });
def('totemPulse', (k) => {
  k.osc('sine', 580, 0.45, { vol: 0.32, to: 560, env: { a: 0.004, d: 0.45, s: 0, r: 0.03 } });
  k.osc('sine', 580, 0.4, { at: 0.18, vol: 0.14, env: { a: 0.004, d: 0.4, s: 0, r: 0.03 } }); k.osc('sine', 580, 0.35, { at: 0.36, vol: 0.06, env: { a: 0.004, d: 0.35, s: 0, r: 0.03 } });
  k.osc('sine', 58, 0.7, { vol: 0.28, env: { a: 0.05, d: 0.4, s: 0.2, r: 0.2 } });
  k.noise(0.3, { vol: 0.1, filter: 'bandpass', freq: 3000, to: 400, q: 1.2, env: { a: 0.01, d: 0.28, s: 0, r: 0.02 } });
  return 1.1;
}, { pri: 6 });
def('porcelainCrack', (k) => {
  snap(k, 0, 0.8, 5000, 0.012, 1, 'highpass'); thump(k, 0, 230, 110, 0.05, 0.4, 'triangle');
  [0.03, 0.08, 0.14].forEach((t, i) => k.noise(0.006, { at: t, vol: 0.5, filter: 'bandpass', freq: 4000 + i * 900, q: 2, env: TICK_ENV(0.006) }));
  for (let i = 0; i < 5; i++) ring(k, 0.04 + i * 0.05 + rnd(0, 0.03), rnd(3000, 6500), 0.12, 0.1, { ratios: [1, 1.8, 2.7], amps: [1, 0.5, 0.25], pan: rnd(-0.6, 0.6) });
  k.osc('sine', 700, 0.15, { vol: 0.12, to: 450 });
  return 0.6;
}, { pri: 7 });
/** param 0..1 → pitch (0 = low wood groan, 1 = high metal). */
def('creak', (k, o) => {
  const sc = semi(((o.param ?? 0.3) - 0.3) * 14), dur = rnd(0.7, 1.1), n = 24;
  const path = Array.from({ length: n }, (_, i) => (170 + 60 * Math.sin(i * 0.5 + rnd(0, 1)) + rnd(-18, 18)) * sc);
  k.osc('sawtooth', path[0], dur, { path, vol: 0.2, lp: 900 * sc, lpTo: 450 * sc, q: 5, env: { a: 0.12, d: 0.2, s: 0.7, r: 0.25 }, am: [rnd(9, 18), 0.9] });
  k.osc('square', path[0] * 2.01, dur, { path: path.map((f) => f * 2.01), vol: 0.05, lp: 1500 * sc, env: { a: 0.15, d: 0.2, s: 0.6, r: 0.25 } });
  for (let i = 0; i < 5; i++) snap(k, rnd(0.05, dur), 0.18, rnd(900, 1800), 0.006, 3);
  return dur + 0.25;
}, { pri: 3 });
def('mannequinCreak', (k) => {
  const dur = rnd(0.25, 0.4), f = rnd(300, 420), path = [f, f * 1.15, f * 0.95, f * 1.2, f];
  k.osc('sawtooth', f, dur, { path, vol: 0.14, lp: 1300, q: 4, env: { a: 0.04, d: 0.1, s: 0.6, r: 0.1 } });
  k.osc('sine', 1800, 0.05, { at: 0.05, vol: 0.03, to: 2600 });
  for (let i = 0; i < 3; i++) { snap(k, rnd(0, dur), 0.3, 2200, 0.006, 6); thump(k, rnd(0, dur), 400, 250, 0.01, 0.08, 'triangle'); }
  return dur + 0.15;
}, { pri: 3 });
def('drip', (k) => {
  const f = rnd(800, 1200);
  for (const [t, v, s] of [[0, 1, 1], [0.15, 0.3, 1.1], [0.31, 0.12, 1.2]] as const) {
    k.osc('sine', f * s, 0.04, { at: t, vol: 0.32 * v, to: f * s * 1.9, env: { a: 0.002, d: 0.04, s: 0, r: 0.01 } }); snap(k, t, 0.12 * v, 3000, 0.005, 3);
  }
  return 0.5;
}, { pri: 2, max: 3 });

// ── diegetic world ────────────────────────────────────────────────────────────────────────────────
def('phoneRing', (k, o) => {
  const ring1 = (at: number): void => {
    for (const f of [425, 480]) k.osc('sine', f, 1, { at, vol: 0.12, lp: 3000, env: { a: 0.01, d: 0.02, s: 1, r: 0.03 }, am: [20, 0.9] });
    snap(k, at, 0.2, 2000, 0.01, 3);
  };
  ring1(0);
  if (o.loop) return 1.7;
  ring1(1.7);
  return 3.4;
}, { pri: 6, max: 2 });
def('phonePickup', (k) => {
  thump(k, 0, 200, 120, 0.05, 0.5, 'triangle'); snap(k, 0, 0.5, 1000, 0.02, 1);
  for (let i = 0; i < 3; i++) snap(k, 0.03 + i * 0.025, 0.12, 2400, 0.006, 3, 'highpass');
  const env = { a: 0.03, d: 0.01, s: 1, r: 0.15 };
  k.osc('sine', 350, 0.3, { at: 0.1, vol: 0.06, env }); k.osc('sine', 440, 0.3, { at: 0.1, vol: 0.06, env });
  k.noise(0.4, { at: 0.08, vol: 0.05, filter: 'highpass', freq: 3000, env: { a: 0.02, d: 0.35, s: 0, r: 0.02 } });
  return 0.55;
}, { pri: 6 });
/** param 0 = tick, 1 = tock (lower). */
def('clockTick', (k, o) => {
  const tock = (o.param ?? 0) > 0.5, s = tock ? 0.72 : 1;
  snap(k, 0, 0.5, 2200 * s, 0.008, 8); k.osc('sine', 1800 * s, 0.008, { vol: 0.14, to: 1500 * s }); thump(k, 0, 700 * s, 400 * s, 0.01, 0.12);
  return 0.05;
}, { pri: 3, max: 2 });
def('clockAlarm', (k) => {
  for (let b = 0; b < 3; b++) {
    const t = b * 0.5;
    for (const f of [1850, 1960]) k.osc('square', f, 0.4, { at: t, vol: 0.07, lp: 4000, env: { a: 0.004, d: 0.01, s: 1, r: 0.02 }, am: [24, 0.95] });
    ring(k, t, 1850, 0.3, 0.05);
  }
  return 1.5;
}, { pri: 6, max: 2 });
def('trapdoor', (k) => {
  k.osc('square', 70, 0.15, { vol: 0.3, lp: 400, env: { a: 0.002, d: 0.14, s: 0, r: 0.01 } }); k.noise(0.05, { vol: 0.5, filter: 'bandpass', freq: 1800, q: 1, env: TICK_ENV(0.05) }); snap(k, 0, 0.5, 2500, 0.01, 4);
  thump(k, 0.1, 95, 35, 0.3, 0.95); k.osc('sawtooth', 220, 0.25, { at: 0.08, vol: 0.12, to: 160, lp: 700, env: { a: 0.02, d: 0.2, s: 0.4, r: 0.1 } });
  k.noise(1.4, { at: 0.2, vol: 0.5, color: 'pink', filter: 'bandpass', freq: 400, to: 1200, q: 1.3, env: { a: 0.3, d: 1.1, s: 0, r: 0.1 } });
  k.osc('sine', 1400, 1.3, { at: 0.25, vol: 0.05, to: 300, env: { a: 0.3, d: 1, s: 0.2, r: 0.1 } });
  return 1.8;
}, { pri: 9 });
/** Cabin ride: motor hum + cable ticks. Loop-safe. */
def('elevator', (k, o) => {
  const dur = o.loop ? 1.4 : 2.2, env = o.loop ? LOOP_ENV : { a: 0.15, d: 0.01, s: 1, r: 0.4 };
  k.osc('sawtooth', 58, dur, { vol: 0.12, lp: 380, env }); k.osc('sine', 116, dur, { vol: 0.06, env });
  k.noise(dur, { vol: 0.12, filter: 'bandpass', freq: 600, q: 1, env });
  for (let t = 0.1; t < dur; t += 0.35) snap(k, t, 0.1, 1500, 0.008, 4);
  return dur;
}, { pri: 5, max: 2 });
/** Lift chime: sine 784 → 523 Hz (GDD §6.10). */
def('elevatorDing', (k) => {
  k.fm(784, 2, 1, 0.9, { vol: 0.36, idxEnd: 0.1 }); k.fm(523.25, 2, 0.9, 1.1, { at: 0.42, vol: 0.32, idxEnd: 0.1 });
  return 1.6;
}, { pri: 7 });
def('typewriter', (k, o) => {
  const s = rnd(0.93, 1.07);
  snap(k, 0, 0.5, 1700 * s, 0.01, 1.5); thump(k, 0, 190 * s, 110 * s, 0.03, 0.35); k.osc('square', 2400 * s, 0.004, { vol: 0.05 });
  if ((o.param ?? 0) >= 1) { ring(k, 0.05, 2400, 0.5, 0.15); k.noise(0.18, { at: 0.2, vol: 0.12, filter: 'bandpass', freq: 800, to: 2500, q: 1, env: { a: 0.02, d: 0.14, s: 0, r: 0.02 } }); }
  return o.param ? 0.7 : 0.08;
}, { pri: 4, max: 6 });
def('tileClack', (k) => { snap(k, 0, 0.45, 2300, 0.01, 5); thump(k, 0, 480, 320, 0.02, 0.4, 'triangle'); snap(k, 0, 0.2, 800, 0.02, 1); return 0.06; }, { pri: 4, max: 5 });
def('door', (k) => {
  snap(k, 0, 0.4, 2000, 0.01, 4); ring(k, 0, 1100, 0.05, 0.08);
  k.osc('sawtooth', 500, 0.45, { at: 0.04, vol: 0.09, path: [480, 540, 600, 570, 620, 560], lp: 1200, q: 3, env: { a: 0.08, d: 0.1, s: 0.6, r: 0.15 } });
  thump(k, 0.5, 110, 55, 0.15, 0.6); snap(k, 0.5, 0.4, 1200, 0.02, 1);
  return 0.8;
}, { pri: 5 });
def('doorCreak', (k) => {
  k.osc('sawtooth', 500, 0.9, { vol: 0.12, path: [480, 560, 520, 640, 600, 700, 650], lp: 1300, q: 4, env: { a: 0.12, d: 0.1, s: 0.6, r: 0.25 }, am: [11, 0.8] });
  return 1.2;
}, { pri: 4 });
def('doorSlam', (k) => {
  thump(k, 0, 95, 32, 0.35, 1); k.noise(0.3, { vol: 0.5, filter: 'lowpass', freq: 600, env: { a: 0.002, d: 0.3, s: 0, r: 0.02 } });
  ring(k, 0, 700, 0.3, 0.1); k.noise(0.12, { at: 0.03, vol: 0.2, filter: 'highpass', freq: 3000, env: TICK_ENV(0.12) });
  return 0.6;
}, { pri: 8 });

// footsteps — param: 0 carpet · 0.35 concrete · 0.65 metal · 1 wood
type Surface = 'carpet' | 'concrete' | 'metal' | 'wood';
function step(k: Kit, surface: Surface): number {
  const s = rnd(0.92, 1.08);
  switch (surface) {
    case 'carpet':
      k.noise(0.08, { vol: 0.45, filter: 'lowpass', freq: 450 * s, env: { a: 0.008, d: 0.07, s: 0, r: 0.01 } }); thump(k, 0, 95 * s, 55, 0.07, 0.4);
      k.noise(0.03, { vol: 0.04, filter: 'highpass', freq: 3000, env: TICK_ENV(0.03) }); return 0.12;
    case 'concrete':
      thump(k, 0, 130 * s, 70, 0.06, 0.5); snap(k, 0, 0.35, 1500 * s, 0.04, 1); k.noise(0.05, { vol: 0.12, filter: 'bandpass', freq: 2800, q: 1, env: TICK_ENV(0.05) }); return 0.12;
    case 'metal':
      snap(k, 0, 0.4, 2400 * s, 0.015, 1); ring(k, 0, 780 * s, 0.12, 0.12, { ratios: [1, 2.3, 3.9], amps: [1, 0.5, 0.25] }); thump(k, 0, 160 * s, 90, 0.05, 0.35); return 0.2;
    case 'wood':
      thump(k, 0, 170 * s, 100, 0.07, 0.5); snap(k, 0, 0.35, 900 * s, 0.03, 1.2); k.noise(0.03, { vol: 0.08, filter: 'highpass', freq: 3000, env: TICK_ENV(0.03) }); return 0.12;
  }
}
const surfaceOf = (p: number): Surface => (p < 0.2 ? 'carpet' : p < 0.5 ? 'concrete' : p < 0.8 ? 'metal' : 'wood');
def('footstep', (k, o) => step(k, surfaceOf(o.param ?? 0)), { pri: 2, max: 2 });
def('footstepCarpet', (k) => step(k, 'carpet'), { pri: 2, max: 2 });
def('footstepConcrete', (k) => step(k, 'concrete'), { pri: 2, max: 2 });
def('footstepMetal', (k) => step(k, 'metal'), { pri: 2, max: 2 });
def('footstepWood', (k) => step(k, 'wood'), { pri: 2, max: 2 });
def('footstepWet', (k) => {
  k.noise(0.14, { vol: 0.5, filter: 'lowpass', freq: 1400, to: 250, env: { a: 0.01, d: 0.13, s: 0, r: 0.01 }, am: [30, 0.6] });
  thump(k, 0, 120, 60, 0.08, 0.4); k.noise(0.06, { at: 0.02, vol: 0.15, filter: 'bandpass', freq: 3000, q: 1, env: TICK_ENV(0.06) });
  k.osc('sine', 1500, 0.03, { at: 0.08, vol: 0.08, to: 2300 });
  return 0.25;
}, { pri: 2, max: 2 });

/** Game-friendly alias ('boom' = the light gunshot). */
SFX_DEFS.set('boom', SFX_DEFS.get('gunShot')!);

// ── wave 27: coin insert, coin rain (jackpot loop), near-miss riser, per-pattern tally tick ────────
/** A coin dropped into the slot: a thunk, then two clinks as it rattles down the chute. */
def('coinInsert', (k) => {
  thump(k, 0, 620, 300, 0.03, 0.35, 'triangle'); snap(k, 0, 0.4, 1200, 0.01, 2);
  clink(k, 0.025, 0.42, 3100, 0.07, 0); clink(k, 0.1, 0.22, 2600, 0.05, 0);
  return 0.22;
}, { pri: 6, max: 4 });
/** Coin rain: a dense shower of clinks over a hiss. Loop-safe (chunks crossfade); one-shot is 1.8 s. */
def('coinRain', (k, o) => {
  const dur = o.loop ? 0.6 : 1.8, env = o.loop ? LOOP_ENV : { a: 0.02, d: 0.01, s: 1, r: 0.2 };
  k.noise(dur, { vol: 0.05, filter: 'bandpass', freq: 6000, q: 1.2, env });
  const n = Math.max(2, Math.round(dur * 16));
  for (let i = 0; i < n; i++) clink(k, ((i + rnd(0.1, 0.9)) * dur) / n, rnd(0.1, 0.2), rnd(2900, 5200), rnd(0.05, 0.09));
  return dur;
}, { pri: 7, max: 2 });
/** Near-miss anticipation: a riser with accelerating ticks that lands on a thud. param 0..1 scales the length (0.6–1.6 s). */
def('tensionRise', (k, o) => {
  const L = 0.6 + 1.0 * (o.param ?? 1);
  riser(k, 0, L - 0.1, 0.2, 260, 4200);
  for (let i = 0; i < 12; i++) { const t = L * Math.pow(i / 12, 1.8); k.osc('sine', 900 + i * 60, 0.04, { at: t, vol: 0.08 + 0.01 * i, env: { a: 0.002, d: 0.035, s: 0, r: 0.01 } }); }
  thump(k, L - 0.12, 110, 50, 0.25, 0.7); snap(k, L - 0.12, 0.5, 1600, 0.02, 1);
  return L;
}, { pri: 8, max: 2 });
/** One count-up step of the tally. Pitch comes from PlayOpts.pitch so the ticks climb through a pattern. */
def('tallyTick', (k) => {
  k.osc('triangle', 1400, 0.03, { vol: 0.2, env: { a: 0.001, d: 0.028, s: 0, r: 0.008 } });
  snap(k, 0, 0.22, 3800, 0.005, 3);
  return 0.04;
}, { bus: 'ui', pri: 4, max: 12 });

/** Sounds longer than ~0.8 s: their voices are wired into slow-motion (`setTimeScale`) so a big win drags with the screen. */
const LONG = ['win2', 'win3', 'winHuge', 'winRise', 'winMega', 'jackpot', 'jackpotBells', 'quotaMet', 'quotaFail', 'stinger', 'tensionRise', 'trapdoor', 'powerDown', 'powerUp', 'tapeStop',
  'tinnitus', 'defib', 'totemPlace', 'lose', 'bell', 'upgrade', 'unlock', 'coinShower', 'glassBreak', 'shuffle', 'dice', 'printer', 'whisper', 'creak',
  'phoneRing', 'clockAlarm', 'cashRegister', 'elevatorDing', 'gunShot', 'door', 'doorCreak', 'heartbeat'];
for (const n of LONG) { const d = SFX_DEFS.get(n); if (d) d.meta.long = true; }

// ── composites used by the engine ─────────────────────────────────────────────────────────────────
/** `n` rapid coin clinks (n ≤ 40) as a single voice. */
export function coinCascade(n: number): KitRecipe {
  const count = Math.max(1, Math.min(40, Math.round(n)));
  return (k) => { const spread = Math.min(1.7, 0.18 + count * 0.045); cascade(k, 0, spread, count, 0.4); return spread + 0.3; };
}
/** Win tier → recipe name (`null` = silence). */
export function winSfx(tier: WinTier): string | null {
  switch (tier) {
    case 'none': return null;
    case 'push': return 'winPush';
    case 'small': return 'win1';
    case 'medium': return 'win2';
    case 'big': return 'win3';
    case 'huge': return 'winHuge';
    case 'mega': return 'winMega';
    case 'jackpot': return 'jackpot';
  }
}

// ── ambience beds ─────────────────────────────────────────────────────────────────────────────────
export interface AmbEnv {
  readonly ctx: BaseAudioContext;
  /** Bed output (already crossfaded + on the `amb` bus). */
  readonly out: AudioNode;
  readonly noise: NoiseBank;
  /** One-shot on the amb bus placed `dist` metres around the listener. */
  event(name: string, o?: { vol?: number; pitch?: number; dist?: [number, number]; param?: number }): void;
}
export interface AmbBed { stop(): void }

class Bed implements AmbBed {
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private readonly timers = new Set<number>();
  private dead = false;
  constructor(private readonly env: AmbEnv) {}
  /** Looping filtered-noise layer (`gain` ≈ RMS fraction). `lfo` modulates the filter frequency by ±depth Hz. */
  noise(o: { color?: NoiseColor; type?: BiquadFilterType; freq: number; q?: number; gain: number; lfo?: [rate: number, depth: number] }): GainNode {
    const c = this.env.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.env.noise[o.color ?? 'white']; s.loop = true; s.playbackRate.value = rnd(0.9, 1.1);
    f.type = o.type ?? 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q ?? 0.8;
    g.gain.value = o.gain * noiseMakeup(f.type, o.freq, f.Q.value, undefined, c.sampleRate);
    s.connect(f); f.connect(g); g.connect(this.env.out);
    if (o.lfo) this.mod(f.frequency, o.lfo[0], o.lfo[1]);
    this.srcs.push(s); s.start(0, arng.next() * 3);
    return g;
  }
  osc(type: OscillatorType, freq: number, gain: number, o: { detune?: number; lp?: number; lfo?: [rate: number, depth: number] } = {}): void {
    const c = this.env.ctx, s = c.createOscillator(), g = c.createGain();
    s.type = type; s.frequency.value = freq; s.detune.value = o.detune ?? 0; g.gain.value = gain;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; s.connect(f); f.connect(g); } else s.connect(g);
    g.connect(this.env.out);
    if (o.lfo) this.mod(g.gain, o.lfo[0], o.lfo[1]);
    this.srcs.push(s); s.start();
  }
  mod(param: AudioParam, rate: number, depth: number): void {
    const c = this.env.ctx, l = c.createOscillator(), g = c.createGain();
    l.frequency.value = rate * rnd(0.9, 1.1); g.gain.value = depth; l.connect(g); g.connect(param);
    this.srcs.push(l); l.start();
  }
  /** Call `fn` at random intervals (seconds) until the bed stops. */
  every(min: number, max: number, fn: () => void): void {
    const tick = (): void => {
      if (this.dead) return;
      const id = window.setTimeout(() => { this.timers.delete(id); if (this.dead) return; fn(); tick(); }, rnd(min, max) * 1000);
      this.timers.add(id);
    };
    tick();
  }
  event(name: string, vol: number, dist: [number, number] = [6, 18], o: { pitch?: number; param?: number } = {}): void { this.env.event(name, { vol, dist, ...o }); }
  stop(): void {
    this.dead = true;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    for (const s of this.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    this.srcs.length = 0;
  }
}

/** Build a looping ambience bed. Unknown ids get the generic 'pit' room tone. */
export function buildAmbience(id: AmbienceId, env: AmbEnv): AmbBed {
  const b = new Bed(env);
  switch (id) {
    case 'menu':                                   // inside the jackpot: warm hum, breathing air, far machines
      b.noise({ color: 'brown', type: 'lowpass', freq: 220, gain: 0.2, lfo: [0.06, 60] });
      b.noise({ color: 'pink', freq: 900, q: 0.5, gain: 0.05, lfo: [0.07, 250] });
      b.osc('sine', 55, 0.03); b.osc('sine', 82.4, 0.018, { detune: 7, lfo: [0.4, 0.006] });
      b.every(2, 5, () => b.event('chime', 0.07, [8, 20], { pitch: rnd(-7, 5) }));
      b.every(3, 8, () => b.event('coinDrop', 0.08, [8, 22]));
      b.every(6, 12, () => b.event('reelStop', 0.05, [10, 24], { param: rnd(0, 1) }));
      b.every(8, 16, () => b.event('sparkle', 0.05, [6, 16]));
      break;
    case 'void':                                   // deep drone, wind, rare unease
      b.osc('sine', 41.2, 0.06); b.osc('sine', 61.7, 0.035, { detune: 9, lfo: [0.11, 0.01] }); b.osc('sine', 82.4, 0.02, { detune: -11 });
      b.noise({ color: 'pink', freq: 500, q: 4, gain: 0.08, lfo: [0.08, 250] });
      b.every(7, 18, () => b.event('creak', 0.12, [6, 16], { param: rnd(0, 0.5) }));
      b.every(14, 30, () => b.event('whisper', 0.1, [3, 8]));
      b.every(4, 10, () => b.event('drip', 0.1, [4, 14], { pitch: rnd(-5, 3) }));
      b.every(60, 120, () => b.event('tinnitus', 0.04, [2, 4]));
      break;
    case 'elevator':                               // cabin hum, cable rattle
      b.osc('sawtooth', 58, 0.045, { lp: 260 }); b.osc('sine', 116, 0.02);
      b.noise({ color: 'pink', freq: 700, q: 1, gain: 0.06 }); b.noise({ color: 'brown', type: 'lowpass', freq: 120, gain: 0.14 });
      b.noise({ type: 'highpass', freq: 3000, gain: 0.008 });
      b.every(0.5, 1.5, () => b.event('tileClack', 0.03, [1, 3]));
      b.every(10, 25, () => b.event('creak', 0.08, [2, 6], { param: 0.2 }));
      b.every(18, 40, () => b.event('thud', 0.1, [3, 8]));
      break;
    case 'shaft':                                  // cavernous wind, distant clangs and drips
      b.noise({ color: 'pink', freq: 380, q: 7, gain: 0.1, lfo: [0.13, 140] }); b.noise({ color: 'pink', freq: 900, q: 5, gain: 0.05, lfo: [0.09, 300] });
      b.noise({ color: 'brown', type: 'lowpass', freq: 90, gain: 0.2 });
      b.every(6, 14, () => b.event('creak', 0.14, [5, 20], { param: 0.1 }));
      b.every(10, 20, () => b.event('thud', 0.1, [10, 24], { pitch: rnd(-6, 0) }));
      b.every(3, 8, () => b.event('drip', 0.12, [4, 12], { pitch: rnd(-6, 2) }));
      break;
    case 'parlour':                                // one bulb, a clock, something breathing
      b.osc('sawtooth', 120, 0.018, { lp: 900 }); b.osc('sine', 240, 0.008);
      b.noise({ type: 'highpass', freq: 7000, gain: 0.008 }); b.noise({ color: 'brown', type: 'lowpass', freq: 150, gain: 0.1 });
      { let tock = 0; b.every(1, 1, () => { b.event('clockTick', 0.1, [2, 4], { param: tock }); tock = 1 - tock; }); }
      b.every(20, 45, () => b.event('whisper', 0.07, [2, 6]));
      b.every(12, 25, () => b.event('creak', 0.08, [3, 8]));
      b.every(18, 40, () => b.event('lightFlicker', 0.06, [2, 5]));
      break;
    case 'sump':                                   // water, pipes, sub rumble
      b.noise({ color: 'brown', type: 'lowpass', freq: 70, gain: 0.25 }); b.noise({ color: 'pink', freq: 250, q: 1.2, gain: 0.08, lfo: [0.2, 80] });
      b.noise({ color: 'pink', freq: 450, q: 6, gain: 0.05, lfo: [0.7, 150] }); b.noise({ type: 'highpass', freq: 4500, gain: 0.01 });
      b.every(0.8, 3, () => b.event('drip', 0.15, [3, 12], { pitch: rnd(-6, 4) }));
      b.every(15, 30, () => b.event('creak', 0.09, [4, 12], { param: 0.15 }));
      b.every(25, 50, () => b.event('footstepWet', 0.08, [4, 10]));
      break;
    default:                                       // 'pit' (and any unknown id): the casino floor
      b.noise({ color: 'pink', freq: 600, q: 0.6, gain: 0.16, lfo: [0.11, 200] }); b.noise({ color: 'brown', type: 'lowpass', freq: 160, gain: 0.22 });
      b.noise({ type: 'highpass', freq: 6000, gain: 0.018 }); b.osc('sine', 120, 0.012); b.osc('sine', 60, 0.015);
      b.every(2.5, 7, () => b.event('chime', 0.06, [10, 24], { pitch: rnd(-5, 7) }));
      b.every(3, 9, () => b.event('coinDrop', 0.08, [8, 22]));
      b.every(5, 14, () => b.event('bell', 0.05, [12, 26]));
      b.every(6, 16, () => b.event('sparkle', 0.04, [8, 20]));
  }
  return b;
}
