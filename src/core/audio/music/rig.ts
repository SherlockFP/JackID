/**
 * The music "rig" (CORE-AUDIO / music): the shared mastering chain every arrangement and stinger feeds.
 *
 *   input → drive → tanh saturation → bit-crush mix → tone lowpass ┐
 *   room IR (1.8 s, 25 ms predelay, 6 kHz wet LP) / hall IR (3.6 s) ┘→ highpass → TAPE WOBBLE (modulated
 *   delay: 0.45 Hz ±8 ¢ + 0.07 Hz drift ±4 ¢ + flutter) → hiss/crackle/rain beds → glue compressor → duck → out
 *
 * `setLook()` morphs the chain with the dread axis and the song's FxPreset (lo-fi, tape, brightness).
 * One global detune source lets every oscillator drift sharp/flat together (dread, "Last Call" +3 %).
 */
import { D, PercBank, crushCurve, crackleLoop, makeIR, makeRand, noiseLoop, satCurve } from './dsp';
import type { FxPreset } from './model';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const SAT_K = 1.25;

export class Rig {
  readonly ctx: BaseAudioContext;
  readonly input: GainNode;
  readonly sendRoom: GainNode;
  readonly out: GainNode;
  readonly detune: ConstantSourceNode;
  readonly perc: PercBank;
  private hallIn: GainNode | null = null;
  private hallGain: GainNode | null = null;
  private readonly drive: GainNode;
  private readonly crushWet: GainNode;
  private readonly crushDry: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly air: BiquadFilterNode;
  private readonly wetGain: GainNode;
  private readonly wobDepth: GainNode[] = [];
  private readonly hiss: GainNode;
  private readonly crackle: GainNode;
  private readonly rain: GainNode;
  /** The stinger duck: everything that rides on the bed (the recorded tracks) joins here so a stinger ducks it too. */
  readonly duckGain: GainNode;
  private readonly bed: GainNode;                // level of the bed only (stingers join after it)
  private readonly tail: GainNode;                 // sum point before the wobble delay
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private readonly noiseBuf: AudioBuffer;
  private rnd = makeRand(0xc0ffee);
  private busy: number[] = [];
  private lastLook = '';
  private fx: Required<FxPreset> = { room: 1, hall: 0, lofi: 0, tape: 1, bright: 1, crackle: 0, rain: 0 };
  private dreadNow = 0;
  /** Last global detune target in cents; short notes bake it in at their start. */
  detuneNow = 0;
  /** Notes at least this long (s) follow the live detune source sample-accurately; shorter ones use `detuneNow`. */
  liveDetuneMin = 2;
  private toneHz = 16000;
  private sBus: { input: GainNode; send: GainNode } | null = null;
  private sTone: BiquadFilterNode | null = null;
  private dead = false;
  /** Current dread (0..1) the rig was last set to. */
  get dread(): number { return this.dreadNow; }

  constructor(ctx: BaseAudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.drive = ctx.createGain();
    const sat = ctx.createWaveShaper();
    sat.curve = satCurve(SAT_K);
    const satTrim = ctx.createGain();
    satTrim.gain.value = Math.tanh(SAT_K) / SAT_K * 1.04;
    this.crushDry = ctx.createGain();
    this.crushWet = ctx.createGain();
    this.crushWet.gain.value = 0;
    const crush = ctx.createWaveShaper();
    crush.curve = crushCurve(9);
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass'; this.tone.Q.value = 0.6;
    this.tone.frequency.value = Math.min(16000, ctx.sampleRate * 0.45);
    this.presence = ctx.createBiquadFilter(); this.presence.type = 'peaking'; this.presence.frequency.value = 3200; this.presence.Q.value = 0.8;
    this.air = ctx.createBiquadFilter(); this.air.type = 'highshelf'; this.air.frequency.value = 7000;
    this.tail = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.5;

    this.input.connect(this.drive); this.drive.connect(sat); sat.connect(satTrim);
    satTrim.connect(this.crushDry); satTrim.connect(crush); crush.connect(this.crushWet);
    this.crushDry.connect(this.tone); this.crushWet.connect(this.tone);

    // room reverb (generated 1.8 s IR with 25 ms predelay, wet lowpass 6 kHz)
    this.sendRoom = ctx.createGain();
    const room = ctx.createConvolver();
    room.buffer = makeIR(ctx, { seconds: 1.8, predelay: 0.025, hf0: 9000, hf1: 1800, seed: 101, metallic: 0.3 });
    const wetLP = ctx.createBiquadFilter(); wetLP.type = 'lowpass'; wetLP.frequency.value = 6000; wetLP.Q.value = 0.5;
    this.wetGain = ctx.createGain(); this.wetGain.gain.value = 1;
    this.sendRoom.connect(room); room.connect(wetLP); wetLP.connect(this.wetGain); this.wetGain.connect(this.tone);

    this.tone.connect(this.presence); this.presence.connect(this.air); this.air.connect(hp); hp.connect(this.tail);

    // tape wobble: delay-time modulation (Δpitch = 2π·f·ΔT)
    const wob = ctx.createDelay(0.2);
    wob.delayTime.value = 0.06;
    const lfo = (freq: number, depthSec: number, phase = 0): void => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = depthSec;
      o.connect(g); g.connect(wob.delayTime); o.start(ctx.currentTime + phase);
      this.srcs.push(o); this.wobDepth.push(g);
    };
    lfo(0.45, 0.00163);          // ±8 ¢
    lfo(0.07, 0.00525);          // ±4 ¢ drift
    lfo(0.19, 0.0009, 0.7);      // un-periodic third wheel
    lfo(6.1, 0.00005);           // flutter (grows with dread/lofi)
    this.tail.connect(wob);

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 14; glue.ratio.value = 3.2; glue.attack.value = 0.012; glue.release.value = 0.24;
    wob.connect(glue);

    // beds that sit after the wobble (hiss, crackle, rain)
    this.noiseBuf = noiseLoop(ctx, 3, 'pink', 3);
    const bed = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number): GainNode => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(glue); s.start();
      this.srcs.push(s);
      return g;
    };
    this.hiss = bed(this.noiseBuf, 'highpass', 3400, 0.5);
    this.crackle = bed(crackleLoop(ctx, 4, 13, 9), 'highpass', 600, 0.5);
    this.rain = bed(noiseLoop(ctx, 4, 'white', 21), 'bandpass', 2600, 0.35);

    this.duckGain = ctx.createGain();
    this.bed = ctx.createGain();
    this.out = ctx.createGain();
    glue.connect(this.bed); this.bed.connect(this.duckGain); this.duckGain.connect(this.out); this.out.connect(dest);

    this.detune = ctx.createConstantSource();
    this.detune.offset.value = 0;
    this.detune.start();
    this.srcs.push(this.detune);

    this.perc = new PercBank(ctx);
    this.setLook(0, undefined, 0);
  }

  // ── look (dread × preset) ─────────────────────────────────────────────────────────────────────
  setLook(dread: number, fx?: FxPreset, ramp = 1.2): void {
    if (fx) this.fx = { ...{ room: 1, hall: 0, lofi: 0, tape: 1, bright: 1, crackle: 0, rain: 0 }, ...fx };
    this.dreadNow = dread;
    const key = `${dread.toFixed(3)}|${JSON.stringify(this.fx)}`;
    if (key === this.lastLook) return;
    this.lastLook = key;
    const f = this.fx, d = dread, now = this.ctx.currentTime, tc = Math.max(0.02, ramp / 3);
    const baseHz = lerp(16000, 6800, f.lofi) * lerp(0.55, 1, f.bright);
    const toneHz = Math.min(this.ctx.sampleRate * 0.45, baseHz * Math.pow(0.13, Math.pow(d, 1.15)));
    this.tone.frequency.setTargetAtTime(toneHz, now, tc);
    this.toneHz = toneHz;
    const open = (1 - 0.6 * f.lofi) * (1 - 0.8 * d);                 // presence and air fade as the tape degrades / dread rises
    this.presence.gain.setTargetAtTime(2.8 * open, now, tc);
    this.air.gain.setTargetAtTime(2.2 * open, now, tc);
    this.sTone?.frequency.setTargetAtTime(Math.min(this.ctx.sampleRate * 0.45, toneHz * 1.5), now, tc);
    const wob = f.tape * (1 + f.lofi * 1.4) * (1 + 5 * Math.pow(d, 1.5));
    this.wobDepth[0].gain.setTargetAtTime(0.00163 * wob, now, tc);
    this.wobDepth[1].gain.setTargetAtTime(0.00525 * wob, now, tc);
    this.wobDepth[2].gain.setTargetAtTime(0.0009 * wob, now, tc);
    this.wobDepth[3].gain.setTargetAtTime(0.00005 * (1 + 8 * f.lofi + 14 * d * d), now, tc);
    this.drive.gain.setTargetAtTime(1 + 0.45 * d + 0.3 * f.lofi, now, tc);
    this.crushWet.gain.setTargetAtTime(0.32 * f.lofi + 0.22 * d * d, now, tc);
    this.crushDry.gain.setTargetAtTime(1 - 0.2 * f.lofi, now, tc);
    this.hiss.gain.setTargetAtTime(0.0065 + 0.014 * f.lofi + 0.03 * d, now, tc);
    this.crackle.gain.setTargetAtTime(f.crackle * 0.5, now, tc);
    this.rain.gain.setTargetAtTime(f.rain * 0.075, now, tc);
    this.wetGain.gain.setTargetAtTime(f.room * (1 + 0.7 * d), now, tc);
    if (this.hallGain) this.hallGain.gain.setTargetAtTime(0.9 + 0.8 * d, now, tc);
  }

  /** Global pitch offset in cents (sour drift, "Last Call" rise). */
  setDetune(cents: number, ramp = 0.5): void {
    this.detuneNow = cents;
    this.detune.offset.setTargetAtTime(cents, this.ctx.currentTime, Math.max(0.02, ramp / 3));
  }

  /** The long-hall send bus, built on first use (3.6 s IR, 40 ms predelay, dark). */
  getHall(): GainNode {
    if (this.hallIn) return this.hallIn;
    const ctx = this.ctx;
    this.hallIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, { seconds: 3.6, predelay: 0.04, hf0: 6000, hf1: 1000, seed: 303, metallic: 0.12 });
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200; lp.Q.value = 0.5;
    this.hallGain = ctx.createGain(); this.hallGain.gain.value = 0.9 + 0.8 * this.dreadNow;
    this.hallIn.connect(conv); conv.connect(lp); lp.connect(this.hallGain); this.hallGain.connect(this.tone);
    return this.hallIn;
  }

  /**
   * Un-ducked path for stingers (so they can duck the bed without ducking themselves): soft saturation → tone
   * (darkens with dread, like the bed) → out, plus its own 2.6 s room. Built on first use.
   */
  getStingerBus(): { input: GainNode; send: GainNode } {
    if (this.sBus) return this.sBus;
    const ctx = this.ctx;
    const input = ctx.createGain(), send = ctx.createGain(), wet = ctx.createGain();
    const sat = ctx.createWaveShaper(); sat.curve = satCurve(1.1);
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.6;
    tone.frequency.value = Math.min(ctx.sampleRate * 0.45, this.toneHz * 1.5);
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, { seconds: 2.6, predelay: 0.03, hf0: 8000, hf1: 1500, seed: 707, metallic: 0.2 });
    wet.gain.value = 0.9;
    input.gain.value = 0.7;                          // headroom before the soft clipper
    input.connect(sat); sat.connect(tone);
    send.connect(conv); conv.connect(wet); wet.connect(tone);
    tone.connect(this.out);
    this.sTone = tone;
    this.sBus = { input, send };
    return this.sBus;
  }

  /** Render the percussion bank in small slices so a rare kit piece never glitches the scheduler on first use. */
  prewarm(): void {
    const kinds = Object.values(D);
    let i = 0;
    const step = (): void => {
      if (this.dead || i >= kinds.length) return;
      this.perc.get(kinds[i++]);
      setTimeout(step, 24);
    };
    setTimeout(step, 400);
  }

  /** Attenuate the whole score (stingers −9 dB for ~1.5 s, voice −6 dB). `amount` 0..1. */
  duck(amount: number, hold: number, at = this.ctx.currentTime): void {
    const g = this.duckGain.gain, a = Math.max(0, Math.min(0.95, amount));
    g.cancelScheduledValues(at);
    g.setTargetAtTime(1 - a, at, 0.05);
    g.setTargetAtTime(1, at + hold, 0.4);
  }

  /** Level of the bed (intensity scaling; 0 while nothing plays, which also silences the hiss / crackle / rain beds). Stingers are unaffected. */
  setLevel(v: number, ramp = 0.1): void { this.bed.gain.setTargetAtTime(v, this.ctx.currentTime, Math.max(0.01, ramp / 3)); }

  // ── helpers for instruments ───────────────────────────────────────────────────────────────────
  /** Cheap cosmetic randomness (0..1), not part of the seeded arrangement. */
  random(): number { return this.rnd(); }

  /** Register `n` oscillator-class voices alive until `end` (voice budget). */
  track(end: number, n = 1): void { for (let i = 0; i < n; i++) this.busy.push(end); }
  /** Current approximate number of live voices. */
  load(now: number): number {
    const b = this.busy;
    if (b.length > 64) { let w = 0; for (let i = 0; i < b.length; i++) if (b[i] > now) b[w++] = b[i]; b.length = w; }
    let n = 0;
    for (let i = 0; i < b.length; i++) if (b[i] > now) n++;
    return n;
  }

  /** Free the audio graph. */
  dispose(): void {
    this.dead = true;
    for (const s of this.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    try { this.out.disconnect(); } catch { /* noop */ }
  }
}
