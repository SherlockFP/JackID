/**
 * Synth toolkit — owned by CORE-AUDIO. Context-agnostic DSP shared by the sfx recipes (`sfx.ts`), the engine
 * (`audio.ts`), the adaptive score (`music.ts`) and OfflineAudioContext renders:
 *  - cosmetic random + pitch helpers (`rnd`, `hz('E6')`, `semi`)
 *  - noise bank (white/pink/brown, seamless loops), generated impulse responses, saturation curves
 *  - `Kit`: the {@link SynthKit} implementation (osc / noise / chord / sample + FM, LFO, pan, path glides)
 *  - formant "babble" speech: planner (text → syllables) and renderer (single formant-synth graph)
 * Nothing here owns a context or a voice; sources are reported through {@link KitHost.track}.
 */
import type { Adsr, SynthKit } from './types';
import { createRng, randomSeed, type Rng } from '../rng';
import { clamp, smoothstep } from '../math';

// ── random + pitch helpers (cosmetic only — audio never feeds the simulation) ─────────────────────
export const arng: Rng = createRng(randomSeed());
export const rnd = (a: number, b: number): number => a + arng.next() * (b - a);
export const rndi = (a: number, b: number): number => arng.int(a, b);
export const pick = <T>(arr: readonly T[]): T => arng.pick(arr);
export const chance = (p: number): boolean => arng.next() < p;
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** Frequency ratio of `s` semitones. */
export const semi = (s: number): number => Math.pow(2, s / 12);
export const dbGain = (d: number): number => Math.pow(10, d / 20);

const NOTE_BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const hzCache = new Map<string, number>();
/** `hz('A4') === 440`; accepts `C#5`, `Eb3`. */
export function hz(name: string): number {
  let v = hzCache.get(name);
  if (v === undefined) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) throw new Error(`audio: bad note "${name}"`);
    v = mtof(12 * (parseInt(m[3], 10) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
    hzCache.set(name, v);
  }
  return v;
}

// ── buffers ───────────────────────────────────────────────────────────────────────────────────────
export interface NoiseBank { readonly white: AudioBuffer; readonly pink: AudioBuffer; readonly brown: AudioBuffer }
export type NoiseColor = keyof NoiseBank;

/** Decoded vendor samples (Kenney OGGs). AudioBuffers are context-independent, so engines and offline renders share it. */
export const sampleStore = new Map<string, AudioBuffer>();

/** Peak |sample| of a window of a decoded buffer (seconds). Used to normalise recorded clips to a target level. */
export function windowPeak(buf: AudioBuffer, off: number, len: number): number {
  const sr = buf.sampleRate, i0 = Math.max(0, Math.floor(off * sr)), i1 = Math.min(buf.length, Math.ceil((off + len) * sr));
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = i0; i < i1; i++) { const x = d[i] < 0 ? -d[i] : d[i]; if (x > m) m = x; }
  }
  return m;
}

/** Three seamless-looping noise buffers, RMS-matched (≈0.3) so `vol` means the same across colours. */
export function createNoiseBank(sampleRate: number, seconds = 4): NoiseBank {
  const len = Math.floor(sampleRate * seconds), xf = 2048, n = len + xf;
  const r = createRng('audio:noise-bank');
  const raw = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < n; i++) {
    const x = r.next() * 2 - 1;
    raw[0][i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    raw[1][i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    brown = (brown + 0.02 * x) / 1.02; raw[2][i] = brown;
  }
  const out = raw.map((src) => {
    // equal-power crossfade of the surplus tail into the head → the loop point is continuous
    const buf = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 1 });
    const d = buf.getChannelData(0);
    let e = 0;
    for (let i = 0; i < len; i++) {
      let v = src[i];
      if (i < xf) { const a = (i / xf) * Math.PI * 0.5; v = v * Math.sin(a) + src[len + i] * Math.cos(a); }
      d[i] = v; e += v * v;
    }
    const k = 0.3 / Math.sqrt(e / len);
    for (let i = 0; i < len; i++) d[i] = Math.max(-1, Math.min(1, d[i] * k));
    return buf;
  });
  return { white: out[0], pink: out[1], brown: out[2] };
}

/** Generated reverb impulse: decaying noise that darkens with time + sparse early reflections. */
export function makeImpulse(sampleRate: number, seconds = 1.8, o: { predelay?: number; bright0?: number; bright1?: number; seed?: string } = {}): AudioBuffer {
  const len = Math.floor(sampleRate * seconds), pre = Math.floor((o.predelay ?? 0.012) * sampleRate);
  const buf = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) {
    const r = createRng(`${o.seed ?? 'audio:ir'}:${c}`), d = buf.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const a = (o.bright0 ?? 0.75) + ((o.bright1 ?? 0.07) - (o.bright0 ?? 0.75)) * Math.sqrt(t);   // one-pole coefficient: dark tail
      y += a * ((r.next() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.9 * t) * (1 - Math.exp(-(i - pre) / 120));
    }
    for (let k = 0; k < 7; k++) d[pre + Math.floor(r.float(0.004, 0.07) * sampleRate)] += r.float(0.4, 0.9) * (r.chance(0.5) ? 1 : -1);
  }
  return buf;
}

/** Spring-tank impulse for the PA voice: dense short tail plus repeating dispersive "boing" chirps. */
export function makeSpringImpulse(sampleRate: number): AudioBuffer {
  const len = Math.floor(sampleRate * 1.1);
  const buf = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 2 });
  for (let c = 0; c < 2; c++) {
    const r = createRng(`audio:spring:${c}`), d = buf.getChannelData(c), period = 0.031 + c * 0.0023;
    for (let i = 0; i < len; i++) d[i] = (r.next() * 2 - 1) * 0.07 * Math.exp(-i / sampleRate * 5.5);
    for (let k = 0, amp = 0.9; k < 22; k++, amp *= 0.78) {
      const t0 = Math.floor((0.008 + k * period) * sampleRate), n = Math.floor(0.016 * sampleRate);
      for (let i = 0; i < n && t0 + i < len; i++) {
        const u = i / n, f = 3600 - 3000 * u, ph = (i / sampleRate) * f * Math.PI * 2;
        d[t0 + i] += Math.sin(ph) * amp * (1 - u) * 0.5;
      }
    }
  }
  return buf;
}

const satCache = new Map<number, Float32Array<ArrayBuffer>>();
/** tanh waveshaper curve; `drive` ≈ 1 (gentle) … 12 (fuzz). Cached. */
export function satCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 4);
  let c = satCache.get(key);
  if (!c) {
    const n = 1024, k = key / 4;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    satCache.set(key, c);
  }
  return c;
}

// ── envelope ──────────────────────────────────────────────────────────────────────────────────────
const FLOOR = 0.0001;
/**
 * ADSR on `p`: floor → `peak` (linear attack `a`) → `s·peak` (exponential decay `d`) → held until `dur` →
 * exponential release `r` to floor. `dur` is the gate length; returns the end time of the tail.
 * Default (no `env`): percussive — instant attack, exponential decay across `dur`.
 */
export function applyEnv(p: AudioParam, at: number, dur: number, peak: number, env?: Adsr): number {
  const pk = Math.max(peak, FLOOR);
  const e = env ?? { a: 0.003, d: Math.max(0.01, dur - 0.003), s: 0, r: 0.02 };
  const a = Math.max(e.a, 0.0008), d = Math.max(e.d, 0.001), r = Math.max(e.r, 0.004);
  const sus = Math.max(e.s * pk, FLOOR);
  p.setValueAtTime(FLOOR, at);
  p.linearRampToValueAtTime(pk, at + a);
  p.exponentialRampToValueAtTime(sus, at + a + d);
  const off = at + Math.max(dur, a + d);
  p.setValueAtTime(sus, off);
  p.exponentialRampToValueAtTime(FLOOR, off + r);
  return off + r;
}

/** Approximate RMS makeup so a filtered noise keeps the level of full-band noise (`vol` stays meaningful). */
export function noiseMakeup(type: BiquadFilterType | undefined, f0: number, q: number, f1: number | undefined, sr: number): number {
  if (!type) return 1;
  const f = f1 ? Math.sqrt(f0 * f1) : f0, nyq = sr / 2;
  switch (type) {
    case 'bandpass': return clamp(1 / Math.sqrt(clamp((f / Math.max(q, 0.1)) / nyq * 1.57, 0.002, 1)), 1, 14);
    case 'lowpass': return clamp(1 / Math.sqrt(clamp(f / nyq * 1.57, 0.002, 1)), 1, 10);
    case 'highpass': return clamp(1 / Math.sqrt(clamp(1 - f / nyq, 0.05, 1)), 1, 4);
    default: return 1;
  }
}

// ── Kit ───────────────────────────────────────────────────────────────────────────────────────────
/** What a Kit needs from whoever owns the voice (the engine's voice, or a tiny offline host). */
export interface KitHost {
  readonly ctx: BaseAudioContext;
  readonly noise: NoiseBank;
  /** Cents source wired to every oscillator/buffer `detune`: voice pitch + slow-motion. `null` = none. */
  readonly pitch: AudioNode | null;
  sample(url: string): AudioBuffer | null;
  /** Every started source is reported so the voice knows when it is finished and can cut it. */
  track(src: AudioScheduledSourceNode): void;
}

export interface TapInfo<S extends AudioScheduledSourceNode> { src: S; filter: BiquadFilterNode | null; gain: GainNode; at: number; end: number; peak: number }
export interface OscOpts {
  at?: number; vol?: number; to?: number; env?: Adsr; out?: AudioNode;
  /** Seconds the `to` glide takes (default `dur`). */
  glide?: number; curve?: 'exp' | 'lin';
  /** Piecewise-linear frequency path, evenly spread over `dur` (overrides `to`). */
  path?: number[];
  detune?: number;                     // cents
  lp?: number; lpTo?: number; q?: number;   // optional lowpass (+ sweep)
  pan?: number;                        // −1..1
  vib?: [rateHz: number, depthCents: number];
  /** Tremolo applied multiplicatively after the envelope: rate Hz, depth 0..1 (1 = dips to silence). */
  am?: [rateHz: number, depth: number];
  tap?: (n: TapInfo<OscillatorNode>) => void;
}
export interface NoiseOpts {
  at?: number; vol?: number; filter?: BiquadFilterType; freq?: number; q?: number; env?: Adsr; out?: AudioNode;
  /** Filter sweep target (exponential over `dur`). */
  to?: number; color?: NoiseColor; pan?: number; rate?: number;
  /** Skip the automatic level makeup for narrow filters. */
  raw?: boolean;
  /** Tremolo after the envelope (see {@link OscOpts.am}). */
  am?: [rateHz: number, depth: number];
  tap?: (n: TapInfo<AudioBufferSourceNode>) => void;
}
export interface FmOpts extends Omit<OscOpts, 'tap' | 'lp' | 'lpTo' | 'q' | 'vib' | 'path' | 'am'> {
  /** Final index as a fraction of the start index (default 0.12) reached after `idxDecay`·dur (default 0.7). */
  idxEnd?: number; idxDecay?: number;
}

export class Kit implements SynthKit {
  readonly ctx: AudioContext;
  constructor(readonly host: KitHost, readonly out: AudioNode, readonly t: number) { this.ctx = host.ctx as AudioContext; }

  /** Wire pitch, report and schedule a source (optionally with a buffer offset). */
  start(src: AudioScheduledSourceNode, at: number, end?: number, offset?: number): void {
    const d = (src as OscillatorNode).detune as AudioParam | undefined;
    if (d && this.host.pitch) this.host.pitch.connect(d);
    this.host.track(src);
    if (offset !== undefined) (src as AudioBufferSourceNode).start(at, offset); else src.start(at);
    if (end !== undefined) src.stop(end);
  }

  osc(type: OscillatorType, freq: number, dur: number, o: OscOpts = {}): void {
    const ctx = this.ctx, at = this.t + (o.at ?? 0);
    const s = ctx.createOscillator();
    s.type = type;
    s.frequency.setValueAtTime(freq, at);
    if (o.path && o.path.length > 1) {
      const n = o.path.length - 1;
      for (let i = 0; i <= n; i++) s.frequency.linearRampToValueAtTime(o.path[i], at + (dur * i) / n);
    } else if (o.to !== undefined && o.to !== freq) {
      const when = at + Math.max(0.005, o.glide ?? dur);
      if (o.curve === 'lin') s.frequency.linearRampToValueAtTime(o.to, when); else s.frequency.exponentialRampToValueAtTime(o.to, when);
    }
    if (o.detune) s.detune.value = o.detune;
    const g = ctx.createGain();
    const end = applyEnv(g.gain, at, dur, o.vol ?? 1, o.env);
    let f: BiquadFilterNode | null = null;
    if (o.lp) {
      f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q ?? 0.7;
      f.frequency.setValueAtTime(o.lp, at);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, at + dur);
      s.connect(f); f.connect(g);
    } else s.connect(g);
    this.shape(g, at, end, o.am, o.pan, o.out);
    if (o.vib) this.lfo(s.detune, o.vib[0], o.vib[1], at, end);
    o.tap?.({ src: s, filter: f, gain: g, at, end, peak: o.vol ?? 1 });
    this.start(s, at, end + 0.02);
  }

  noise(dur: number, o: NoiseOpts = {}): void {
    const ctx = this.ctx, at = this.t + (o.at ?? 0);
    const buf = this.host.noise[o.color ?? 'white'];
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    if (o.rate) s.playbackRate.value = o.rate;
    const g = ctx.createGain();
    let f: BiquadFilterNode | null = null, makeup = 1;
    if (o.filter) {
      f = ctx.createBiquadFilter(); f.type = o.filter;
      const fr = o.freq ?? 1000, q = o.q ?? 0.8;
      f.Q.value = q;
      f.frequency.setValueAtTime(fr, at);
      if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, at + dur);
      if (!o.raw) makeup = noiseMakeup(o.filter, fr, q, o.to, ctx.sampleRate);
      s.connect(f); f.connect(g);
    } else s.connect(g);
    const end = applyEnv(g.gain, at, dur, (o.vol ?? 1) * makeup, o.env);
    this.shape(g, at, end, o.am, o.pan, o.out);
    o.tap?.({ src: s, filter: f, gain: g, at, end, peak: (o.vol ?? 1) * makeup });
    this.start(s, at, end + 0.02, arng.next() * (buf.duration - 0.2));
  }

  chord(freqs: number[], dur: number, type: OscillatorType = 'triangle', o: { at?: number; vol?: number; arp?: number } = {}): void {
    const v = (o.vol ?? 1) / Math.sqrt(freqs.length);
    freqs.forEach((fr, i) => this.osc(type, fr, dur, { at: (o.at ?? 0) + i * (o.arp ?? 0), vol: v, env: { a: 0.006, d: dur * 0.5, s: 0.3, r: 0.12 } }));
  }

  sample(url: string, o: { at?: number; vol?: number; rate?: number; rand?: number; out?: AudioNode } = {}): void {
    const buf = this.host.sample(url);
    if (!buf) return;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = (o.rate ?? 1) * (1 + (arng.next() * 2 - 1) * (o.rand ?? 0.08));
    const g = this.ctx.createGain();
    g.gain.value = o.vol ?? 1;
    s.connect(g); g.connect(o.out ?? this.out);
    this.start(s, this.t + (o.at ?? 0));
  }

  /**
   * Play a trimmed window of a recorded sample, peak-normalised so `vol` is the final peak (0..1) whatever the file's level.
   * `off`/`dur` pick the window (source seconds), `a`/`r` its fades, `rand` the ± random pitch. Returns false when the
   * file is not decoded yet (the host starts loading it), so the caller can fall back to its procedural version.
   */
  clip(url: string, o: { at?: number; vol?: number; rate?: number; rand?: number; off?: number; dur?: number; a?: number; r?: number; pan?: number; out?: AudioNode } = {}): boolean {
    const buf = this.host.sample(url);
    if (!buf) return false;
    const ctx = this.ctx, rate = (o.rate ?? 1) * (1 + (arng.next() * 2 - 1) * (o.rand ?? 0.05));
    const off = Math.max(0, Math.min(o.off ?? 0, buf.duration - 0.02));
    const dur = Math.min(o.dur ?? Infinity, (buf.duration - off) / rate);
    if (dur <= 0.01) return false;
    const peak = windowPeak(buf, off, dur * rate), v = (o.vol ?? 0.5) / Math.max(peak, 0.01);
    const at = this.t + (o.at ?? 0), a = o.a ?? 0.004, r = Math.min(o.r ?? 0.06, dur * 0.5);
    const s = ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(v, at + a);
    g.gain.setValueAtTime(v, Math.max(at + a, at + dur - r)); g.gain.linearRampToValueAtTime(0, at + dur);
    s.connect(g);
    let tail: AudioNode = g;
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); tail = p; }
    tail.connect(o.out ?? this.out);
    this.start(s, at, at + dur + 0.02, off);
    return true;
  }

  // ── extras beyond the frozen SynthKit (sfx recipes, ambience, music) ──
  /** Two-operator FM voice: carrier `freq`, modulator `freq·ratio`, brightness envelope `index` → `index·idxEnd`. */
  fm(freq: number, ratio: number, index: number, dur: number, o: FmOpts = {}): void {
    const ctx = this.ctx, at = this.t + (o.at ?? 0);
    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    car.frequency.setValueAtTime(freq, at); mod.frequency.setValueAtTime(freq * ratio, at);
    if (o.to !== undefined && o.to !== freq) {
      const when = at + Math.max(0.005, o.glide ?? dur);
      car.frequency.exponentialRampToValueAtTime(o.to, when); mod.frequency.exponentialRampToValueAtTime(o.to * ratio, when);
    }
    if (o.detune) { car.detune.value = o.detune; mod.detune.value = o.detune; }
    const dev = index * freq * ratio, mg = ctx.createGain();
    mg.gain.setValueAtTime(dev, at);
    mg.gain.exponentialRampToValueAtTime(Math.max(dev * (o.idxEnd ?? 0.12), 0.01), at + dur * (o.idxDecay ?? 0.7));
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain();
    const end = applyEnv(g.gain, at, dur, o.vol ?? 1, o.env);
    car.connect(g);
    this.route(g, o.pan, o.out);
    this.start(car, at, end + 0.02);
    this.start(mod, at, end + 0.02);
  }

  /** Modulate `param` with a low-frequency oscillator (`depth` in the param's own units) over [at, end]. */
  lfo(param: AudioParam, rate: number, depth: number, at: number, end: number, type: OscillatorType = 'sine'): void {
    const l = this.ctx.createOscillator(), g = this.ctx.createGain();
    l.type = type; l.frequency.value = rate; g.gain.value = depth;
    l.connect(g); g.connect(param);
    this.start(l, at, end + 0.02);
  }

  /** A StereoPanner feeding `out` — pass it as `o.out` to spread layers across the field. */
  pan(p: number): StereoPannerNode {
    const n = this.ctx.createStereoPanner();
    n.pan.value = clamp(p, -1, 1);
    n.connect(this.out);
    return n;
  }

  /** Envelope gain → optional multiplicative tremolo (`am`) → pan → out. The tremolo never leaves a tail behind. */
  private shape(env: GainNode, at: number, end: number, am: [number, number] | undefined, pan: number | undefined, out: AudioNode | undefined): void {
    if (!am || am[1] <= 0) { this.route(env, pan, out); return; }
    const m = this.ctx.createGain();
    m.gain.value = 1 - am[1] / 2;                       // sits at the middle of [1 − depth, 1]
    this.lfo(m.gain, am[0], am[1] / 2, at, end);
    env.connect(m);
    this.route(m, pan, out);
  }
  private route(g: AudioNode, pan: number | undefined, out: AudioNode | undefined): void {
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(out ?? this.out); } else g.connect(out ?? this.out);
  }
}

/** A Kit with no voice bookkeeping (no pitch offset, no tracking) — for the score and one-off tools. */
export function createKit(ctx: BaseAudioContext, noise: NoiseBank, out: AudioNode, t = ctx.currentTime): Kit {
  return new Kit({ ctx, noise, pitch: null, sample: (u) => sampleStore.get(u) ?? null, track() {} }, out, t);
}

// ── formant babble (Animal-Crossing-style "speech" for the House / NPCs; subtitles carry the words) ───
export type Mood = 'calm' | 'cheery' | 'angry' | 'sad' | 'whisper';
type V3 = [number, number, number];
export interface SpeakerProfile {
  f0: number;            // base pitch (Hz)
  rate: number;          // syllables per second
  formant: number;       // vocal-tract scale (<1 deeper, >1 smaller)
  mode: 'voiced' | 'whisper' | 'tones';
  breath: number;        // aspiration mixed into voiced speech 0..1
  radio: boolean;        // 300–3000 Hz PA band-pass
  distort: number;       // default distortion 0..1
  spring: number;        // spring-reverb send 0..1
  vibrato: number;       // cents
  chorus: number;        // cents of a second, detuned glottal voice (0 = none)
  under: number;         // octave-below voice mix 0..1
  over: number;          // octave-above voice mix 0..1
  tilt: number;          // brightness lowpass (Hz)
  comb: number;          // ms of a hollow comb filter (0 = none)
}
const P = (o: Partial<SpeakerProfile> & { f0: number; rate: number }): SpeakerProfile =>
  ({ formant: 1, mode: 'voiced', breath: 0.1, radio: false, distort: 0, spring: 0.12, vibrato: 8, chorus: 0, under: 0, over: 0, tilt: 6500, comb: 0, ...o });
export const SPEAKERS: Readonly<Record<string, SpeakerProfile>> = {
  house: P({ f0: 95, rate: 9, formant: 0.92, breath: 0.08, radio: true, distort: 0.28, spring: 0.36, vibrato: 6, chorus: 14, under: 0.28, tilt: 5200 }),
  collector: P({ f0: 68, rate: 6.2, formant: 0.82, breath: 0.12, distort: 0.12, spring: 0.24, vibrato: 4, chorus: 9, under: 0.35, tilt: 3800 }),
  bartender: P({ f0: 118, rate: 7.4, formant: 0.98, vibrato: 8, spring: 0.08 }),
  mira: P({ f0: 235, rate: 9.2, formant: 1.2, breath: 0.22, vibrato: 12, spring: 0.16, tilt: 8000 }),
  oracle: P({ f0: 160, rate: 6.8, formant: 1.05, breath: 0.3, spring: 0.55, vibrato: 18, chorus: 22, over: 0.24, under: 0.1 }),
  dealer: P({ f0: 330, rate: 11, mode: 'tones', breath: 0, radio: true, distort: 0.1, spring: 0.2, vibrato: 0, chorus: 7 }),
  mannequin: P({ f0: 140, rate: 7, mode: 'whisper', breath: 1, spring: 0.35, tilt: 4500, comb: 3.6 }),
};
/** Known speakers use their profile; any other id gets a stable pseudo-random voice derived from its name. */
export function profileFor(speaker: string): SpeakerProfile {
  const known = SPEAKERS[speaker];
  if (known) return known;
  const r = createRng(`voice:${speaker}`);
  return P({ f0: r.float(80, 260), rate: r.float(6.5, 10), formant: r.float(0.85, 1.2), breath: r.float(0.05, 0.3), vibrato: r.float(4, 14), spring: r.float(0.08, 0.3), chorus: r.chance(0.3) ? r.float(8, 20) : 0 });
}

const VOWELS: Record<string, V3> = {
  a: [800, 1200, 2500], e: [550, 1800, 2500], i: [300, 2300, 3000], o: [500, 900, 2500], u: [330, 800, 2400],
  'ı': [400, 1300, 2300], 'ö': [480, 1450, 2400], 'ü': [300, 1700, 2300], y: [300, 2200, 3000],
  'â': [780, 1250, 2500], 'î': [300, 2300, 3000], 'û': [330, 800, 2400],
};
const FRIC_HZ: Record<string, number> = { s: 6500, z: 5400, f: 3800, v: 3200, h: 1800, 'ş': 3300, x: 3300, j: 2900, 'ç': 4300, c: 4300 };
const PLOS_HZ: Record<string, number> = { p: 900, b: 700, t: 4200, d: 3500, k: 2200, g: 1800, q: 1600 };
type OnsetKind = 'none' | 'fric' | 'plos' | 'nasal' | 'liquid' | 'breath';
interface Syl {
  t: number; dur: number;
  onset: OnsetKind; onsetDur: number; noiseHz: number;
  coda: 'none' | 'fric' | 'plos'; codaHz: number;
  f0: number; f0End: number; f: V3; fEnd: V3; amp: number;
}
export interface BabblePlan { syls: Syl[]; duration: number }
const MOODS: Record<Mood, { pitch: number; rate: number; range: number; amp: number }> = {
  calm: { pitch: 0, rate: 1, range: 1, amp: 1 }, cheery: { pitch: 3, rate: 1.12, range: 1.7, amp: 1.05 },
  angry: { pitch: -1.5, rate: 1.18, range: 1.35, amp: 1.2 }, sad: { pitch: -2.5, rate: 0.78, range: 0.55, amp: 0.85 },
  whisper: { pitch: 0, rate: 0.95, range: 0.7, amp: 0.9 },
};
const PAUSE: Record<string, number> = { '.': 0.34, '?': 0.3, '!': 0.3, '…': 0.55, ',': 0.16, ';': 0.2, ':': 0.2, '-': 0.1, '—': 0.12, '–': 0.1 };
const PENT = [0, 2, 4, 7, 9];
const VOWEL_RE = /([^aeıioöuüyâîû]*)([aeıioöuüyâîû]+)/g;
const TOKEN_RE = /[a-zçğışöüâîû]+|\d|[.!?…]+|[,;:—–-]+/gi;

interface Word { syl: { onset: string; nucleus: string; coda: string }[]; caps: boolean }
interface Phrase { words: Word[]; end: string }

function tokenize(text: string): Phrase[] {
  const out: Phrase[] = [];
  let cur: Phrase = { words: [], end: '' };
  for (const raw of text.normalize('NFC').replace(/İ/g, 'i').match(TOKEN_RE) ?? []) {
    const c = raw[0];
    if (/[.!?…,;:—–-]/.test(c)) { cur.end = c === '.' && raw.length > 2 ? '…' : c; out.push(cur); cur = { words: [], end: '' }; continue; }
    const caps = raw.length > 2 && raw === raw.toUpperCase() && raw !== raw.toLowerCase();
    const w = /\d/.test(c) ? 'aeiouaeioa'[+c] : raw.toLowerCase();
    const syl: Word['syl'] = [];
    let last = 0, m: RegExpExecArray | null;
    VOWEL_RE.lastIndex = 0;
    while ((m = VOWEL_RE.exec(w))) { syl.push({ onset: m[1], nucleus: m[2], coda: '' }); last = VOWEL_RE.lastIndex; }
    if (!syl.length) syl.push({ onset: w, nucleus: 'u', coda: '' }); else syl[syl.length - 1].coda = w.slice(last);
    cur.words.push({ syl, caps });
  }
  if (cur.words.length) out.push(cur);
  return out;
}

function onsetOf(ch: string): { kind: OnsetKind; dur: number; hz: number } {
  if (!ch) return { kind: 'none', dur: 0, hz: 0 };
  if (ch === 'h') return { kind: 'breath', dur: 0.05, hz: 1800 };
  if (FRIC_HZ[ch]) return { kind: 'fric', dur: ch === 'c' || ch === 'ç' ? 0.05 : 0.045, hz: FRIC_HZ[ch] };
  if (PLOS_HZ[ch]) return { kind: 'plos', dur: 0.024, hz: PLOS_HZ[ch] };
  if (ch === 'm' || ch === 'n') return { kind: 'nasal', dur: 0.04, hz: 0 };
  return { kind: 'liquid', dur: 0.03, hz: 0 };
}

/** Text → syllable timeline (pure; deterministic for a given `rng`). Rhythm and contour follow punctuation. */
export function planBabble(text: string, p: SpeakerProfile, o: { mood?: Mood; pitch?: number; rng: Rng }): BabblePlan {
  const rng = o.rng, mood = MOODS[o.mood ?? 'calm'], tones = p.mode === 'tones';
  const base = 1 / (p.rate * mood.rate);
  const f0Base = p.f0 * semi((o.pitch ?? 0) + mood.pitch);
  const syls: Syl[] = [];
  let t = 0.04, walk = 0;
  for (const ph of tokenize(text)) {
    const n = ph.words.reduce((a, w) => a + w.syl.length, 0) || 1;
    let k = 0;
    for (const w of ph.words) {
      for (let i = 0; i < w.syl.length; i++, k++) {
        const s = w.syl[i], prog = k / n, last = k === n - 1;
        let st = 2 - 4 * prog;
        if (ph.end === '?') st += 6 * smoothstep(0.55, 1, prog) - 1;
        else if (ph.end === '!') st += 2 * (1 - prog);
        else if (ph.end === ',') st += 1.5 * smoothstep(0.7, 1, prog);
        if (i === 0) st += 1.6 * mood.range;
        if (w.caps) st += 2.2;
        walk = clamp(walk * 0.6 + rng.float(-1.4, 1.4) * mood.range, -3, 3);
        st = st * mood.range + walk;
        const v1 = VOWELS[s.nucleus[0]] ?? VOWELS.a, v2 = VOWELS[s.nucleus[s.nucleus.length - 1]] ?? v1;
        const on = tones ? onsetOf('') : onsetOf(s.onset[0] ?? '');
        const cc = tones ? '' : s.coda.slice(-1);
        const coda = cc && FRIC_HZ[cc] ? 'fric' as const : cc && PLOS_HZ[cc] ? 'plos' as const : 'none' as const;
        const codaDur = coda === 'none' ? 0 : 0.04;
        let dur = base * rng.float(0.8, 1.25) * (s.nucleus.length > 1 ? 1.15 : 1) * (last ? 1.35 : 1);
        if (tones) dur = Math.min(dur, 0.12);
        dur = Math.max(dur, on.dur + codaDur + 0.075);
        let f0 = f0Base * semi(st);
        if (tones) f0 = f0Base * semi(PENT[(('aeiouıöüy'.indexOf(s.nucleus[0]) + 1) + k * 2 + i) % 5] + (k % 3 === 2 ? 12 : 0) - 5);
        const rise = ph.end === '?' && prog > 0.6 ? 1.4 : -0.7;
        const fs = p.formant * (1 + rng.float(-0.05, 0.05));
        const sc = (v: V3): V3 => [v[0] * fs, v[1] * fs, v[2] * fs];
        syls.push({
          t, dur, onset: on.kind, onsetDur: on.dur, noiseHz: on.hz * rng.float(0.92, 1.08), coda, codaHz: coda === 'none' ? 0 : (FRIC_HZ[cc] ?? PLOS_HZ[cc]),
          f0, f0End: f0 * semi(rise), f: sc(v1), fEnd: sc(v2),
          amp: clamp((0.75 + (i === 0 ? 0.15 : 0) + (w.caps ? 0.25 : 0) + (ph.end === '!' ? 0.1 : 0)) * mood.amp * (last ? 0.85 : 1), 0.2, 1.3),
        });
        t += dur + 0.012 + rng.float(0, 0.02) * base * 8;
      }
      t += rng.float(0.02, 0.06) * base * 8;
    }
    t += PAUSE[ph.end] ?? 0;
  }
  if (!syls.length) t = 0.15;
  return { syls, duration: t + 0.05 };
}

export interface BabbleRender { end: number }
/**
 * Build one formant-synth graph for a whole utterance and schedule every syllable on it:
 * glottal saws (+chorus/octave voices) + aspiration noise → 3 band-pass formants → fricative/plosive noise mix →
 * saturation → tone lowpass → optional radio band-pass / hollow comb → `out`. Cheap: ~25 nodes regardless of length.
 */
export function renderBabble(host: KitHost, out: AudioNode, plan: BabblePlan, p: SpeakerProfile, o: { t0: number; mood?: Mood; distort?: number }): BabbleRender {
  const ctx = host.ctx, t0 = o.t0, end = t0 + plan.duration + 0.06;
  const whisper = p.mode === 'whisper' || o.mood === 'whisper', tones = p.mode === 'tones';
  const track = (s: AudioScheduledSourceNode, offset?: number): void => {
    const d = (s as OscillatorNode).detune as AudioParam | undefined;
    if (d && host.pitch) host.pitch.connect(d);
    host.track(s);
    if (offset !== undefined) (s as AudioBufferSourceNode).start(t0, offset); else s.start(t0);
    s.stop(end);
  };
  const first = plan.syls[0];
  const f0cs = ctx.createConstantSource();
  f0cs.offset.setValueAtTime(first?.f0 ?? p.f0, t0);
  track(f0cs);

  // glottal source(s)
  const voiced = ctx.createGain(), amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t0);
  const voice = (type: OscillatorType, mult: number, gain: number, detune: number): void => {
    const os = ctx.createOscillator(), vg = ctx.createGain();
    os.type = type; os.frequency.value = 0; os.detune.value = detune;
    vg.gain.value = gain;
    if (mult === 1) f0cs.connect(os.frequency); else { const m = ctx.createGain(); m.gain.value = mult; f0cs.connect(m); m.connect(os.frequency); }
    if (p.vibrato > 0) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5.2 + arng.next(); lg.gain.value = p.vibrato; l.connect(lg); lg.connect(os.detune); track(l); }
    os.connect(vg); vg.connect(voiced); track(os);
  };
  if (!whisper) {
    voice(tones ? 'square' : 'sawtooth', 1, tones ? 0.5 : 1, 0);
    if (p.chorus) voice(tones ? 'triangle' : 'sawtooth', 1, 0.6, p.chorus);
    if (p.under) voice('sawtooth', 0.5, p.under, 0);
    if (p.over) voice('sawtooth', 2, p.over, 4);
  }
  voiced.connect(amp);

  // aspiration + formant bank
  const noiseSrc = (): AudioBufferSourceNode => { const s = ctx.createBufferSource(); s.buffer = host.noise.white; s.loop = true; return s; };
  const breath = ctx.createGain(); breath.gain.setValueAtTime(0, t0);
  const bn = noiseSrc(); bn.connect(breath); track(bn, arng.next() * 2);
  const formMix = ctx.createGain(), qs = whisper ? [3, 4, 5] : tones ? [1.6, 2, 2.4] : [7, 9, 11], gains = [1, 0.7, 0.35];
  const fFreq: AudioParam[] = [];
  for (let i = 0; i < 3; i++) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'bandpass'; f.Q.value = qs[i]; f.frequency.setValueAtTime(first?.f[i] ?? 800, t0);
    g.gain.value = gains[i] * (whisper ? 5 : tones ? 3.2 : 8.5);
    amp.connect(f); breath.connect(f); f.connect(g); g.connect(formMix);
    fFreq.push(f.frequency);
  }

  // consonant noise (bypasses the formants)
  const cn = noiseSrc(), cf = ctx.createBiquadFilter(), cg = ctx.createGain();
  cf.type = 'bandpass'; cf.Q.value = 2.2; cf.frequency.setValueAtTime(4000, t0); cg.gain.setValueAtTime(0, t0);
  cn.connect(cf); cf.connect(cg); track(cn, arng.next() * 2);

  // tone chain
  const mix = ctx.createGain(); formMix.connect(mix); cg.connect(mix);
  let tail: AudioNode = mix;
  const dist = o.distort ?? p.distort;
  if (dist > 0.01) { const w = ctx.createWaveShaper(); w.curve = satCurve(1 + dist * 9); w.oversample = '2x'; tail.connect(w); const mk = ctx.createGain(); mk.gain.value = 1 / (1 + dist * 1.2); w.connect(mk); tail = mk; }
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.tilt; tail.connect(lp); tail = lp;
  if (p.radio) {
    const hp = ctx.createBiquadFilter(), l2 = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300; l2.type = 'lowpass'; l2.frequency.value = 3000; pk.type = 'peaking'; pk.frequency.value = 1400; pk.gain.value = 5; pk.Q.value = 1.1;
    tail.connect(hp); hp.connect(pk); pk.connect(l2); tail = l2;
  }
  if (p.comb) {
    const d = ctx.createDelay(0.02), fb = ctx.createGain(), sum = ctx.createGain();
    d.delayTime.value = p.comb / 1000; fb.gain.value = 0.55;
    tail.connect(sum); tail.connect(d); d.connect(fb); fb.connect(d); d.connect(sum); tail = sum;
  }
  // output limiter: the formant bank runs 2–4× full scale, so every speaker is held near the sfx level (−8 dB, 20:1)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 1; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.1;
  // Chrome adds makeup gain inside the compressor, so the limiter is trimmed back to ~0.55 peak
  const trim = ctx.createGain(); trim.gain.value = 0.55;
  tail.connect(limiter); limiter.connect(trim); trim.connect(out);

  // schedule — every param only ever receives time-ordered linear ramps / holds
  const A = amp.gain, B = breath.gain, C = cg.gain, F0 = f0cs.offset;
  for (const s of plan.syls) {
    const ts = t0 + s.t, tn = ts + s.onsetDur, te = ts + s.dur, cdur = s.coda === 'none' ? 0 : 0.04;
    for (let i = 0; i < 3; i++) { fFreq[i].linearRampToValueAtTime(s.f[i], tn + 0.015); fFreq[i].linearRampToValueAtTime(s.fEnd[i], te); }
    F0.linearRampToValueAtTime(s.f0, tn + 0.01); F0.linearRampToValueAtTime(s.f0End, te);
    const level = s.amp * (tones ? 0.8 : 1);
    // vowel
    A.setValueAtTime(0, ts); B.setValueAtTime(0, ts);
    const nasal = s.onset === 'nasal' ? 0.45 : 1;
    if (whisper) { B.linearRampToValueAtTime(level * 1.4 * nasal, tn + 0.012); B.setValueAtTime(level * 1.4, te - 0.03 - cdur); B.linearRampToValueAtTime(0, te - cdur); }
    else {
      A.setValueAtTime(0, tn - (s.onset === 'plos' ? 0 : 0.006));
      A.linearRampToValueAtTime(level * nasal, tn + 0.012 + (s.onset === 'nasal' ? 0.03 : 0));
      if (tones) A.exponentialRampToValueAtTime(level * 0.12, te - cdur - 0.005); else A.setValueAtTime(level, te - 0.03 - cdur);
      A.linearRampToValueAtTime(0, te - cdur);
      if (p.breath > 0.01 || s.onset === 'breath') {
        const bl = s.onset === 'breath' ? 0.9 : p.breath * level * 0.6;
        B.linearRampToValueAtTime(bl, tn + 0.02); B.setValueAtTime(bl, te - 0.04 - cdur); B.linearRampToValueAtTime(0, te - cdur);
      }
    }
    // consonants
    C.setValueAtTime(0, ts); cf.frequency.setValueAtTime(s.noiseHz || 3000, ts);
    if (s.onset === 'fric' || s.onset === 'plos') {
      const peak = (s.onset === 'plos' ? 0.9 : 0.6) * s.amp * (whisper ? 1.3 : 1) * (s.noiseHz > 5000 ? 1.4 : 1);
      const a = s.onset === 'plos' ? 0.003 : 0.012;
      C.linearRampToValueAtTime(peak, ts + a); C.setValueAtTime(peak, tn - 0.004); C.linearRampToValueAtTime(0, tn + (s.onset === 'plos' ? 0.004 : 0.012));
    }
    if (s.coda !== 'none') {
      cf.frequency.setValueAtTime(s.codaHz, te - cdur);
      C.setValueAtTime(0, te - cdur); C.linearRampToValueAtTime(0.5 * s.amp, te - cdur + 0.01); C.linearRampToValueAtTime(0, te);
    }
  }
  // wind everything down at the end
  A.linearRampToValueAtTime(0, end - 0.005); B.linearRampToValueAtTime(0, end - 0.005); C.linearRampToValueAtTime(0, end - 0.005);
  return { end };
}
