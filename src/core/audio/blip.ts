/**
 * Character blips: the voice of every character in the game. Nobody speaks. Each visible character of a line is one
 * short typewriter / keyboard "tik" (Undertale-style), and each speaker owns its pitch range, waveform and noise
 * balance, so the House squawks through a PA, a collector growls low, Mira is bright and the mannequin only breathes.
 *
 * Pure planning lives here (`planBlips`, `charEvent`) so it can be tested without an AudioContext. The renderers take
 * any {@link KitHost} (a live voice or an OfflineAudioContext host), which is what `audio.ts` and `renderSpeech` use.
 */
import { createRng, type Rng } from '../rng';
import { clamp } from '../math';
import { Kit, semi, type KitHost, type Mood } from './synth';

export interface BlipVoice {
  wave: OscillatorType;   // tone carrier
  f0: number;             // base pitch (Hz)
  span: number;           // semitone spread of the melodic degrees (roughly 2–7)
  dur: number;            // blip length (s) for a vowel; consonants are shorter
  vol: number;            // tone level 0..1
  lp: number;             // tone lowpass (Hz)
  noise: number;          // click / breath mix 0..1
  bp: number;             // click band-pass centre (Hz), 0 = high-pass at 3.5 kHz
  q: number;              // click resonance
  cps: number;            // default characters per second
  glide: number;          // semitones of downward glide per blip
}

const VOICE = (o: Partial<BlipVoice> & Pick<BlipVoice, 'wave' | 'f0'>): BlipVoice => ({
  span: 4, dur: 0.04, vol: 0.22, lp: 4000, noise: 0.1, bp: 0, q: 1.2, cps: 28, glide: 0, ...o,
});
/** Fixed voices. Every other speaker id gets a stable one derived from its name ({@link blipVoiceFor}). */
export const BLIP_VOICES: Readonly<Record<string, BlipVoice>> = {
  house: VOICE({ wave: 'square', f0: 520, span: 3, dur: 0.035, vol: 0.24, lp: 3200, noise: 0.25, bp: 1500, q: 1.4, cps: 30, glide: 0.5 }),   // PA squawk
  collector: VOICE({ wave: 'triangle', f0: 165, span: 4, dur: 0.05, vol: 0.42, lp: 1400, noise: 0.08, cps: 22, glide: 2 }),                  // low, slow, gravel
  bartender: VOICE({ wave: 'triangle', f0: 300, span: 5, dur: 0.04, vol: 0.26, lp: 3000, noise: 0.05, cps: 28 }),
  mira: VOICE({ wave: 'sine', f0: 880, span: 7, dur: 0.035, vol: 0.24, lp: 7000, noise: 0.06, cps: 34 }),                              // bright
  oracle: VOICE({ wave: 'sine', f0: 440, span: 5, dur: 0.07, vol: 0.22, lp: 4000, noise: 0.12, cps: 20, glide: 1 }),                      // long, breathy
  // The spouse (wave 69): a warm, low-middle voice with a tired breath in it; slower than Mira, softer than the House
  spouse: VOICE({ wave: 'triangle', f0: 290, span: 4, dur: 0.05, vol: 0.2, lp: 2400, noise: 0.16, cps: 21, glide: 1 }),
  // The Dark Lords (THE HOLLOW DOOR): deep, slow, almost no inflection
  lord_ash: VOICE({ wave: 'triangle', f0: 96, span: 2, dur: 0.11, vol: 0.4, lp: 520, noise: 0.05, cps: 10 }),
  lord_ledgers: VOICE({ wave: 'sine', f0: 118, span: 2, dur: 0.1, vol: 0.4, lp: 640, noise: 0.07, cps: 10 }),
  lord_mirrors: VOICE({ wave: 'triangle', f0: 132, span: 3, dur: 0.09, vol: 0.36, lp: 900, noise: 0.14, cps: 11 }),
  dealer: VOICE({ wave: 'square', f0: 660, span: 4, dur: 0.022, vol: 0.1, lp: 5000, noise: 0.3, bp: 2400, q: 2, cps: 38 }),               // crisp clicks
  mannequin: VOICE({ wave: 'sine', f0: 240, span: 2, dur: 0.06, vol: 0.085, lp: 1800, noise: 0.85, bp: 2600, q: 3, cps: 16 }),              // breath ticks
};

/** Stable voice for any other speaker id (rival ids, 'notary', 'clerk', 'you'...). */
const blipCache = new Map<string, BlipVoice>();
export function blipVoiceFor(speaker: string): BlipVoice {
  const known = BLIP_VOICES[speaker];
  if (known) return known;
  const hit = blipCache.get(speaker);
  if (hit) return hit;
  const r = createRng(`blip:${speaker}`);
  const made = VOICE({
    wave: r.pick(['triangle', 'square', 'sine'] as const), f0: r.float(200, 620), span: r.int(3, 6), vol: r.float(0.2, 0.26),
    lp: r.float(2800, 4800), noise: r.float(0.04, 0.22), bp: r.chance(0.4) ? r.float(1400, 2600) : 0, cps: r.float(24, 34),
  });
  blipCache.set(speaker, made);
  return made;
}

/** Pentatonic degrees over two octaves (semitones before the span scale). */
const DEG = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const VOWEL = /[aeiouyâîûöüıAEIOUYÂÎÛÖÜİ]/;
const WORD = /[\p{L}\p{N}]/u;
/** Pauses after punctuation, in seconds. Spaces are a short gap. */
const PAUSE: Readonly<Record<string, number>> = { '.': 0.3, '!': 0.3, '?': 0.3, '…': 0.45, ',': 0.14, ';': 0.2, ':': 0.2 };

export interface BlipEvent { t: number; semis: number; vowel: boolean; vol: number }
export interface BlipPlan { events: BlipEvent[]; duration: number }

const MOOD: Record<Mood, { cps: number; vol: number; shift: number; glide: number }> = {
  calm: { cps: 1, vol: 1, shift: 0, glide: 0 },
  cheery: { cps: 1.15, vol: 1.05, shift: 2, glide: 0 },
  angry: { cps: 1.3, vol: 1.2, shift: -1, glide: 1 },
  sad: { cps: 0.7, vol: 0.85, shift: -2, glide: 2 },
  whisper: { cps: 0.8, vol: 0.55, shift: 0, glide: 0 },
};

/** One blip for a single typed character (no rng: the same character always sounds the same for one speaker). */
export function charEvent(v: BlipVoice, ch: string): BlipEvent | null {
  if (!WORD.test(ch)) return null;
  const cp = ch.codePointAt(0) ?? 0;
  const deg = DEG[cp % DEG.length];
  return { t: 0, semis: (deg * v.span) / 12, vowel: VOWEL.test(ch), vol: 1 };
}

/**
 * Plans the blips for a whole line: one blip per letter or digit, with a random walk over the pentatonic degrees
 * (so it sounds like a melody, not a ticking clock), pauses at punctuation and the speaker's typing speed.
 * Deterministic for a given rng.
 */
export function planBlips(text: string, v: BlipVoice, o: { mood?: Mood; pitch?: number; rng: Rng }): BlipPlan {
  const m = MOOD[o.mood ?? 'calm'];
  const gap = 1 / (v.cps * m.cps);
  const events: BlipEvent[] = [];
  let t = 0, idx = 4;
  for (const ch of Array.from(text)) {
    const pause = PAUSE[ch];
    if (pause !== undefined) { t += pause; continue; }
    if (ch === ' ' || ch === '\n') { t += gap * 0.6; continue; }
    const ev = charEvent(v, ch);
    if (!ev) { t += gap * 0.5; continue; }
    idx = clamp(idx + o.rng.pick([-2, -1, -1, 0, 1, 1, 2, 3]), 0, DEG.length - 1);
    events.push({
      t, vowel: ev.vowel, vol: m.vol,
      semis: (DEG[idx] * v.span) / 12 + m.shift + (o.pitch ?? 0),
    });
    t += gap * o.rng.float(0.85, 1.15);
  }
  const last = events[events.length - 1];
  return { events, duration: last ? last.t + 0.1 : 0 };
}

/** Schedules one blip at `t` (absolute AudioContext time) into `out`. Returns its length in seconds. */
export function scheduleBlip(host: KitHost, out: AudioNode, t: number, v: BlipVoice, e: { semis: number; vowel: boolean; vol: number }, glide = 0): number {
  const k = new Kit(host, out, t);
  const f = v.f0 * semi(e.semis);
  const d = v.dur * (e.vowel ? 1.25 : 0.7);
  const g = e.vol * (e.vowel ? 1 : 0.8);
  const env = { a: 0.002, d, s: 0, r: 0.006 };
  k.osc(v.wave, f, d, { vol: v.vol * g, to: (v.glide + glide) > 0 ? f * semi(-(v.glide + glide)) : undefined, lp: v.lp, env });
  if (v.noise > 0) {
    k.noise(d * 0.8, { vol: v.noise * g, filter: v.bp ? 'bandpass' : 'highpass', freq: v.bp || 3500, q: v.q, env: { a: 0.001, d: d * 0.8, s: 0, r: 0.004 } });
  }
  return d;
}

/** Schedules a whole plan starting at `t0`. Returns the time the last blip ends. */
export function renderBlips(host: KitHost, out: AudioNode, plan: BlipPlan, v: BlipVoice, t0: number, glide = 0): number {
  let end = t0;
  for (const e of plan.events) end = Math.max(end, t0 + e.t + scheduleBlip(host, out, t0 + e.t, v, e, glide));
  return end;
}
