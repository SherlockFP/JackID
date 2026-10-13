/**
 * Offline sample synthesis for the composer (CORE-AUDIO / music): the percussion bank, Karplus–Strong
 * plucks, noise/crackle loops, generated reverb impulse responses and waveshaper curves. Everything is
 * rendered in plain JS into AudioBuffers once (lazily) and then played back as 1-node voices, which is
 * what keeps the sequencer CPU-cheap. Deterministic (xorshift), no Math.random.
 */
import { mtof } from './theory';

export function makeRand(seed: number): () => number {
  let s = (seed | 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

// ── tiny RBJ biquad on Float32Array ─────────────────────────────────────────────────────────────
type FType = 'lp' | 'hp' | 'bp';
export function filterInPlace(x: Float32Array, type: FType, f: number, q: number, sr: number): void {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0, na1 = a1 / a0, na2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = nb0 * xi + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
}

export type F32 = Float32Array<ArrayBuffer>;
export type NoiseKind = 'white' | 'pink' | 'brown';
function normalize(x: F32, peak = 0.9): F32 {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  if (m > 1e-6) { const g = peak / m; for (let i = 0; i < x.length; i++) x[i] *= g; }
  return x;
}
function whiteNoise(n: number, rnd: () => number): F32 {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  return x;
}

// ── percussion bank ─────────────────────────────────────────────────────────────────────────────
/** Percussion codes carried in `Ev.m` for the `drums` instrument. */
export const D = {
  KICK: 1, KICK_SOFT: 2, KICK_808: 3, SNARE: 4, SNARE_GHOST: 5, SNARE_BRUSH: 6, RIM: 7, CLAP: 8,
  HAT: 9, HAT_PEDAL: 10, HAT_OPEN: 11, RIDE: 12, RIDE_BELL: 13, SWISH_UP: 14, SWISH_DOWN: 15,
  SHAKER: 16, SHAKER_UP: 17, CRASH: 18, TOM_HI: 19, TOM_MID: 20, TOM_LO: 21, TICK: 22, TOCK: 23,
  CLACK: 24, WOOD: 25, HEART: 26, BOOM: 27, STEAM: 28, REV_CRASH: 29, TAMB: 30, TOY: 31, CHIME_HIT: 32,
} as const;

type Render = (sr: number, rnd: () => number) => F32;
const exp = Math.exp, sin = Math.sin, PI2 = Math.PI * 2;
const secs = (sr: number, s: number): F32 => new Float32Array(Math.floor(sr * s));

function kick(f0: number, f1: number, sweep: number, tau: number, len: number, click: number, drive: number): Render {
  return (sr, rnd) => {
    const x = secs(sr, len);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      ph += (PI2 * (f0 + (f1 - f0) * exp(-t / sweep))) / sr;
      x[i] = Math.tanh(drive * sin(ph) * exp(-t / tau)) + (rnd() * 2 - 1) * click * exp(-t / 0.0022);
    }
    return normalize(x, 0.95);
  };
}

function snare(tone: number, noiseTau: number, toneTau: number, bpF: number, len: number, mix: number): Render {
  return (sr, rnd) => {
    const x = secs(sr, len), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'bp', bpF, 0.6, sr);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      ph += (PI2 * (tone + 70 * exp(-t / 0.018))) / sr;
      x[i] = n[i] * exp(-t / noiseTau) * 1.6 * mix + sin(ph) * exp(-t / toneTau) * 0.55;
    }
    return normalize(x, 0.9);
  };
}

function noiseHit(type: FType, f: number, q: number, atk: number, tau: number, len: number, sweepUp = 0): Render {
  return (sr, rnd) => {
    const x = whiteNoise(Math.floor(sr * len), rnd);
    filterInPlace(x, type, f, q, sr);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      const e = sweepUp > 0
        ? (t < sweepUp ? Math.pow(t / sweepUp, 1.3) : exp(-(t - sweepUp) / tau))
        : (t < atk ? t / atk : exp(-(t - atk) / tau));
      x[i] *= e;
    }
    return normalize(x, 0.85);
  };
}

function metal(base: number, ratios: number[], taus: number[], noiseTau: number, len: number): Render {
  return (sr, rnd) => {
    const x = secs(sr, len), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'hp', 6500, 0.7, sr);
    for (let k = 0; k < ratios.length; k++) {
      const w = (PI2 * base * ratios[k]) / sr, ph0 = rnd() * PI2;
      for (let i = 0; i < x.length; i++) x[i] += sin(w * i + ph0) * exp(-i / sr / taus[k]) * (0.5 / (1 + k * 0.35));
    }
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] += n[i] * exp(-t / noiseTau) * 0.5 + (rnd() * 2 - 1) * exp(-t / 0.0025) * 0.7;
    }
    return normalize(x, 0.85);
  };
}

const BANK: Record<number, Render> = {
  [D.KICK]: kick(48, 150, 0.022, 0.17, 0.5, 0.18, 1.6),
  [D.KICK_SOFT]: kick(52, 105, 0.016, 0.09, 0.28, 0.06, 1.2),
  [D.KICK_808]: kick(46, 150, 0.025, 0.2, 0.6, 0.12, 2.0),
  [D.HEART]: kick(44, 66, 0.03, 0.1, 0.4, 0, 1.4),
  [D.BOOM]: (sr, rnd) => {
    const x = secs(sr, 2.6), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'lp', 160, 0.8, sr);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      ph += (PI2 * (28 + 70 * exp(-t / 0.09))) / sr;
      x[i] = sin(ph) * exp(-t / 0.7) + n[i] * 2.4 * exp(-t / 0.9);
    }
    return normalize(x, 0.95);
  },
  [D.SNARE]: snare(185, 0.1, 0.05, 1900, 0.4, 1),
  [D.SNARE_GHOST]: snare(200, 0.035, 0.02, 2400, 0.15, 0.7),
  [D.SNARE_BRUSH]: noiseHit('bp', 3300, 0.7, 0.008, 0.1, 0.32),
  [D.RIM]: (sr, rnd) => {
    const x = secs(sr, 0.1);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      x[i] = sin(PI2 * 1700 * t) * exp(-t / 0.006) * 0.5 + sin(PI2 * 810 * t) * exp(-t / 0.012) * 0.4
        + (rnd() * 2 - 1) * exp(-t / 0.0012) * 0.55;
    }
    return normalize(x, 0.85);
  },
  [D.CLAP]: (sr, rnd) => {
    const x = secs(sr, 0.45), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'bp', 1500, 0.9, sr);
    const bursts = [0, 0.009, 0.019, 0.03];
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      let e = exp(-(t - 0.03) / 0.09) * (t >= 0.03 ? 0.55 : 0);
      for (const b of bursts) if (t >= b) e += exp(-(t - b) / 0.006) * (t - b < 0.02 ? 1 : 0);
      x[i] = n[i] * e;
    }
    return normalize(x, 0.9);
  },
  [D.HAT]: noiseHit('hp', 7200, 0.7, 0.001, 0.02, 0.12),
  [D.HAT_PEDAL]: noiseHit('bp', 5200, 0.8, 0.002, 0.03, 0.12),
  [D.HAT_OPEN]: noiseHit('hp', 6500, 0.7, 0.002, 0.17, 0.65),
  [D.RIDE]: metal(410, [1, 1.43, 1.74, 2.31, 2.68, 3.52], [0.5, 0.42, 0.36, 0.3, 0.26, 0.2], 0.22, 1.6),
  [D.RIDE_BELL]: metal(590, [1, 1.5, 2.0, 2.76, 3.9], [0.9, 0.7, 0.5, 0.4, 0.3], 0.12, 1.8),
  [D.SWISH_UP]: noiseHit('bp', 5500, 0.9, 0, 0.05, 0.34, 0.14),
  [D.SWISH_DOWN]: noiseHit('bp', 5800, 0.9, 0.004, 0.1, 0.32),
  [D.SHAKER]: noiseHit('hp', 6500, 0.7, 0.006, 0.022, 0.13),
  [D.SHAKER_UP]: noiseHit('hp', 6000, 0.7, 0.014, 0.03, 0.14),
  [D.CRASH]: (sr, rnd) => {
    const x = secs(sr, 3.2), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'hp', 2600, 0.7, sr);
    const ratios = [1, 1.35, 1.82, 2.4, 3.1, 4.3];
    for (let k = 0; k < ratios.length; k++) {
      const w = (PI2 * 330 * ratios[k]) / sr;
      for (let i = 0; i < x.length; i++) x[i] += sin(w * i) * exp(-i / sr / (0.9 - k * 0.08)) * 0.12;
    }
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] += n[i] * exp(-t / 0.85) * (t < 0.004 ? t / 0.004 : 1); }
    return normalize(x, 0.85);
  },
  [D.REV_CRASH]: (sr, rnd) => {
    const src = BANK[D.CRASH](sr, rnd), n = Math.floor(sr * 2.0), x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = src[n - 1 - i] * (i / n);
    return normalize(x, 0.8);
  },
  [D.TOM_HI]: tom(1.6), [D.TOM_MID]: tom(1.25), [D.TOM_LO]: tom(1),
  [D.TICK]: (sr, rnd) => {
    const x = secs(sr, 0.06), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'bp', 4200, 1.2, sr);
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = sin(PI2 * 2100 * t) * exp(-t / 0.0035) * 0.7 + n[i] * exp(-t / 0.0016) * 1.2; }
    return normalize(x, 0.8);
  },
  [D.TOCK]: (sr, rnd) => {
    const x = secs(sr, 0.07), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'bp', 2200, 1.0, sr);
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = sin(PI2 * 1250 * t) * exp(-t / 0.005) * 0.8 + n[i] * exp(-t / 0.002) * 1.0; }
    return normalize(x, 0.8);
  },
  [D.CLACK]: (sr, rnd) => {
    const x = secs(sr, 0.09), n = whiteNoise(x.length, rnd);
    filterInPlace(n, 'bp', 2800, 2, sr);
    for (let i = 0; i < x.length; i++) {
      const t = i / sr, t2 = t - 0.011;
      x[i] = n[i] * exp(-t / 0.0025) + (t2 > 0 ? n[i] * exp(-t2 / 0.0022) * 0.6 : 0) + sin(PI2 * 230 * t) * exp(-t / 0.014) * 0.5;
    }
    return normalize(x, 0.8);
  },
  [D.WOOD]: (sr) => {
    const x = secs(sr, 0.12);
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = sin(PI2 * 880 * t) * exp(-t / 0.014) + sin(PI2 * 1330 * t) * exp(-t / 0.008) * 0.45; }
    return normalize(x, 0.8);
  },
  [D.STEAM]: noiseHit('bp', 3800, 0.45, 0.06, 0.22, 0.75),
  [D.TAMB]: (sr, rnd) => {
    const r = BANK[D.SHAKER](sr, rnd), x = new Float32Array(r.length);
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = r[i] * 0.6 + sin(PI2 * 5200 * t) * exp(-t / 0.03) * 0.25 + sin(PI2 * 7300 * t) * exp(-t / 0.02) * 0.2; }
    return normalize(x, 0.8);
  },
  [D.TOY]: snare(330, 0.05, 0.03, 3000, 0.2, 0.9),
  [D.CHIME_HIT]: (sr) => {
    const x = secs(sr, 1.4);
    for (let i = 0; i < x.length; i++) { const t = i / sr; x[i] = sin(PI2 * 1244 * t) * exp(-t / 0.5) + sin(PI2 * 3430 * t) * exp(-t / 0.25) * 0.4 + sin(PI2 * 6700 * t) * exp(-t / 0.12) * 0.2; }
    return normalize(x, 0.7);
  },
};

function tom(ratio: number): Render {
  return (sr, rnd) => {
    const x = secs(sr, 0.55);
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / sr;
      ph += (PI2 * 112 * ratio * (1 + 0.55 * exp(-t / 0.03))) / sr;
      x[i] = sin(ph) * exp(-t / 0.2) + (rnd() * 2 - 1) * exp(-t / 0.004) * 0.25;
    }
    return normalize(x, 0.9);
  };
}

/** Lazy per-context cache of rendered percussion buffers. */
export class PercBank {
  private cache = new Map<number, AudioBuffer>();
  constructor(private ctx: BaseAudioContext) {}
  get(kind: number): AudioBuffer | null {
    let b = this.cache.get(kind);
    if (b) return b;
    const render = BANK[kind];
    if (!render) return null;
    const data = render(this.ctx.sampleRate, makeRand(0x51ed + kind * 7919));
    b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.copyToChannel(data, 0);
    this.cache.set(kind, b);
    return b;
  }
}

// ── Karplus–Strong pluck ────────────────────────────────────────────────────────────────────────
export interface Plucked { buffer: AudioBuffer; rate: number }
/** KS string, decay 0.996 per loop; the rate returned retunes the integer delay line exactly. */
export function renderPluck(ctx: BaseAudioContext, midi: number, len = 1.6, damp = 0.996, bright = 0.55): Plucked {
  const sr = ctx.sampleRate, f = mtof(midi);
  const N = Math.max(3, Math.round(sr / f));
  const rnd = makeRand(0x7a1c + midi * 131);
  const line: F32 = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) { lp += (rnd() * 2 - 1 - lp) * bright; line[i] = lp * 1.8; }
  const out: F32 = new Float32Array(Math.floor(sr * len));
  for (let i = 0, idx = 0; i < out.length; i++) {
    const nx = idx + 1 === N ? 0 : idx + 1;
    const v = line[idx];
    out[i] = v;
    line[idx] = damp * 0.5 * (v + line[nx]);
    idx = nx;
  }
  const fade = Math.floor(sr * 0.05);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  normalize(out, 0.8);
  const buffer = ctx.createBuffer(1, out.length, sr);
  buffer.copyToChannel(out, 0);
  return { buffer, rate: (sr / N) / f };
}

export function reverseBuffer(ctx: BaseAudioContext, src: AudioBuffer, swell = true): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const a = src.getChannelData(c), b = out.getChannelData(c);
    for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i] * (swell ? Math.pow(i / a.length, 0.6) : 1);
  }
  return out;
}

// ── noise loops ─────────────────────────────────────────────────────────────────────────────────
export function noiseLoop(ctx: BaseAudioContext, seconds: number, kind: NoiseKind, seed = 7): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds), x: F32 = new Float32Array(n), rnd = makeRand(seed);
  if (kind === 'white') for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1;
  else if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else {
    let l = 0;
    for (let i = 0; i < n; i++) { l = (l + 0.02 * (rnd() * 2 - 1)) / 1.02; x[i] = l * 3.5; }
  }
  // seamless loop: cross-fade the tail into the head
  const xf = Math.min(Math.floor(n / 8), Math.floor(ctx.sampleRate * 0.1));
  for (let i = 0; i < xf; i++) { const k = i / xf; x[i] = x[i] * k + x[n - xf + i] * (1 - k); }
  const out = ctx.createBuffer(1, n - xf, ctx.sampleRate);
  out.copyToChannel(x.subarray(0, n - xf), 0);
  return out;
}

/** Vinyl crackle: sparse clicks of random size over a faint dust floor. */
export function crackleLoop(ctx: BaseAudioContext, seconds: number, density = 14, seed = 11): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), x: F32 = new Float32Array(n), rnd = makeRand(seed);
  for (let i = 0; i < n; i++) x[i] = (rnd() * 2 - 1) * 0.015;
  const pops = Math.floor(seconds * density);
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(rnd() * (n - 400)), amp = (0.2 + rnd() * rnd() * 0.9) * (rnd() < 0.5 ? -1 : 1), tau = 12 + rnd() * 70;
    for (let k = 0; k < 300; k++) x[at + k] += amp * exp(-k / tau) * (k === 0 ? 1 : (rnd() * 2 - 1) * 0.7);
  }
  filterInPlace(x, 'hp', 900, 0.7, sr);
  const out = ctx.createBuffer(1, n, sr);
  out.copyToChannel(normalize(x, 0.9), 0);
  return out;
}

// ── reverb impulse response (PSX-SPU flavoured: smeared, slightly metallic) ─────────────────────
export interface IrOpts { seconds: number; predelay: number; hf0: number; hf1: number; seed: number; metallic?: number }
export function makeIR(ctx: BaseAudioContext, o: IrOpts): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * (o.seconds + o.predelay));
  const buf = ctx.createBuffer(2, n, sr);
  const tau = o.seconds / 6.9;                      // −60 dB at `seconds`
  const pre = Math.floor(sr * o.predelay);
  for (let c = 0; c < 2; c++) {
    const rnd = makeRand(o.seed + c * 977), x = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const hf = o.hf0 * Math.pow(o.hf1 / o.hf0, Math.min(1, t / o.seconds));
      const a = 1 - exp((-PI2 * hf) / sr);
      lp += (rnd() * 2 - 1 - lp) * a;
      x[i] = lp * exp(-t / tau) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let k = 0; k < 9; k++) {                   // early reflections
      const at = pre + Math.floor(sr * (0.006 + rnd() * 0.07));
      x[at] += (rnd() < 0.5 ? -1 : 1) * (0.5 - k * 0.04);
    }
    if (o.metallic) {                               // comb smear = the "tin can" hardware colour
      const D1 = Math.floor(sr * (0.0113 + c * 0.0017));
      for (let i = n - 1; i >= D1; i--) x[i] += x[i - D1] * o.metallic;
    }
    for (let i = n - Math.floor(sr * 0.1); i < n; i++) x[i] *= (n - i) / (sr * 0.1);
  }
  return buf;
}

// ── waveshaper curves ───────────────────────────────────────────────────────────────────────────
export function satCurve(k: number, n = 2048): F32 {
  const c = new Float32Array(n), d = Math.tanh(k);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((k * (i / (n - 1) * 2 - 1))) / d;
  return c;
}
export function crushCurve(bits: number, n = 8192): F32 {
  const c = new Float32Array(n), lv = Math.pow(2, bits - 1);
  for (let i = 0; i < n; i++) c[i] = Math.round((i / (n - 1) * 2 - 1) * lv) / lv;
  return c;
}
