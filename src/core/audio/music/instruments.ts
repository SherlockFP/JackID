/**
 * Instrument patches for the procedural composer (CORE-AUDIO / music). Each patch builds a small bus
 * (trim → pan → arrangement mix, + reverb sends) and exposes `play(t, midi, dur, vel)`. Patches follow
 * GDD §6.9: FM Rhodes (14:1 tine, tremolo 4.5 Hz), upright bass (pluck, LP 900 Hz, 15 ¢ slide-in),
 * brushed kit (pre-rendered buffers), vibraphone (×3.9 partial, 5.5 Hz motor), harmon-muted trumpet
 * (saw → BP 1.2 kHz, vibrato after 0.25 s), drawbar organ + Leslie, detuned music box, choir (3 detuned
 * saws → "ah" formants, 1.5 s attack), Karplus–Strong nylon, plus synth / brass / calliope / reed /
 * flute / bell voices for the synthwave, carnival, tango and fanfare material.
 * Shared LFOs live on the bus (tremolo, motor, Leslie, vibrato) to keep per-note node counts low;
 * anything a long-lived source connects into a per-note node is disconnected when the note ends.
 */
import { D, renderPluck, reverseBuffer, type Plucked } from './dsp';
import type { InstId } from './model';
import type { Rig } from './rig';
import { mtof } from './theory';

export interface InstCtx {
  rig: Rig;
  ctx: BaseAudioContext;
  dest: AudioNode;               // arrangement mix (crossfader)
  send: AudioNode;               // arrangement room-reverb send bus
  hall: () => AudioNode;         // arrangement hall send bus (built lazily)
  beat: () => number;            // seconds per beat right now (tempo-synced echoes)
}
export interface Instrument {
  /** `m` < 0 is a control event (sidechain duck, see `duck`). `x` is a patch-specific option. */
  play(t: number, m: number, dur: number, v: number, x?: number): void;
  duck?(t: number, amt: number): void;
  dispose(): void;
}

/** FX kinds for the `fx` instrument (carried in `Ev.m`). */
export const FX = { RISER: 1, WHISPER: 2, SCRAPE: 3, BREATH: 4, BUZZ: 5, SUCK: 6 } as const;

// ── graph helpers ───────────────────────────────────────────────────────────────────────────────
class Kit {
  private readonly keep: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private sealed = false;
  constructor(readonly c: InstCtx) {}
  get ctx(): BaseAudioContext { return this.c.ctx; }
  /** After construction only bus-level nodes are retained; per-note nodes are left to the GC. */
  seal(): void { this.sealed = true; }
  private k<T extends AudioNode>(n: T): T { if (!this.sealed) this.keep.push(n); return n; }
  g(v = 1): GainNode { const n = this.ctx.createGain(); n.gain.value = v; return this.k(n); }
  f(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = freq; n.Q.value = q; return this.k(n);
  }
  pan(v: number): StereoPannerNode { const n = this.ctx.createStereoPanner(); n.pan.value = v; return this.k(n); }
  delay(max: number): DelayNode { return this.k(this.ctx.createDelay(max)); }
  /** Free-running LFO (bus level). */
  lfo(freq: number, depth: number, target: AudioParam): OscillatorNode {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = this.g(depth); o.connect(g); g.connect(target); o.start(); this.srcs.push(o);
    return o;
  }
  /** Free-running oscillator with no output yet (vibrato source). */
  vibrato(freq: number): OscillatorNode {
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq; o.start(); this.srcs.push(o);
    return o;
  }
  bus(o: { gain?: number; pan?: number; send?: number; hall?: number }): { input: GainNode; out: StereoPannerNode } {
    const input = this.g(o.gain ?? 1), p = this.pan(o.pan ?? 0);
    input.connect(p); p.connect(this.c.dest);
    if (o.send) { const s = this.g(o.send); p.connect(s); s.connect(this.c.send); }
    if (o.hall) { const s = this.g(o.hall); p.connect(s); s.connect(this.c.hall()); }
    return { input, out: p };
  }
  /** Oscillator wired to the global detune; stops at `stop`. */
  osc(type: OscillatorType, freq: number, t: number, stop: number, cents = 0): OscillatorNode {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (cents) o.detune.value = cents;
    this.followDetune(o.detune, o, stop - t);
    o.start(t); o.stop(stop);
    return o;
  }
  /**
   * Global pitch drift (dread sag, Last Call rise, tape-stop): long notes stay wired to the rig's detune source;
   * short notes just take its current value, because an audio-rate `detune` makes the engine compute a pow() per sample.
   */
  followDetune(p: AudioParam, end: AudioScheduledSourceNode, dur: number): void {
    const rig = this.c.rig;
    if (dur >= rig.liveDetuneMin) this.tapParam(rig.detune, p, end);
    else p.value += rig.detuneNow;
  }
  /** Connect a long-lived source into a per-note node and undo it when `end` stops. */
  tap(from: AudioNode, to: AudioNode, end: AudioScheduledSourceNode): void {
    from.connect(to);
    end.addEventListener('ended', () => { try { from.disconnect(to); } catch { /* noop */ } }, { once: true });
  }
  tapParam(from: AudioNode, to: AudioParam, end: AudioScheduledSourceNode): void {
    from.connect(to);
    end.addEventListener('ended', () => { try { from.disconnect(to); } catch { /* noop */ } }, { once: true });
  }
  /** Disconnect per-note `nodes` once `end` has stopped. */
  free(end: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    end.addEventListener('ended', () => { for (const n of nodes) { try { n.disconnect(); } catch { /* noop */ } } }, { once: true });
  }
  dispose(): void {
    for (const s of this.srcs) { try { s.stop(); } catch { /* stopped */ } }
    for (const n of this.keep) { try { n.disconnect(); } catch { /* noop */ } }
  }
}

/** AR/ADSR on a gain param. Returns the time after which the voice is silent. */
function env(p: AudioParam, t: number, peak: number, atk: number, hold: number, rel: number, tau = 0, sus = 1): number {
  const end = t + Math.max(hold, atk + 0.005);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + atk);
  if (tau > 0) p.setTargetAtTime(peak * sus, t + atk, tau);
  p.setTargetAtTime(0, end, rel / 4.5);
  return end + rel * 1.7 + 0.05;
}
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const vcurve = (v: number): number => 0.18 + 0.82 * Math.pow(Math.max(0, Math.min(1, v)), 1.25);

type Make = (k: Kit) => Instrument;

// ── keyboards ───────────────────────────────────────────────────────────────────────────────────
const rhodes: Make = (k) => {
  const c = k.c;
  const trem = k.g(0.9);
  k.lfo(4.5, 0.1, trem.gain);                                // tremolo 4.5 Hz, 20 % deep
  const b = k.bus({ pan: 0, send: 0.34, hall: 0.06 });
  k.lfo(4.5, 0.22, b.out.pan);                               // suitcase auto-pan
  trem.connect(b.input);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const tau = clamp(2.6 - (m - 40) * 0.032, 0.5, 2.6);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.3 * vel, 0.003, dur, 0.28, tau, 0.16);
      const car = k.osc('sine', f, t, stop);
      const mod = k.osc('sine', f, t, stop);                 // 1:1 modulator
      const mg = k.g(0);
      mg.gain.setValueAtTime((1.0 + 2.4 * vel) * f, t);      // index 3 → 0.5 over ~0.4 s
      mg.gain.setTargetAtTime(0.5 * f, t, 0.13);
      mod.connect(mg); mg.connect(car.frequency);
      const nodes: AudioNode[] = [out, mg];
      if (f * 14 < 15000) {                                  // 14:1 tine click
        const tine = k.osc('sine', f * 14, t, t + 0.12), tg = k.g(0);
        tg.gain.setValueAtTime(f * (0.5 + 1.1 * vel), t); tg.gain.setTargetAtTime(0, t, 0.012);
        tine.connect(tg); tg.connect(car.frequency); nodes.push(tg);
      }
      car.connect(out); out.connect(trem);
      k.free(car, ...nodes);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const piano: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: -0.12, send: 0.3, hall: 0.05 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const tau = clamp(3.6 - (m - 36) * 0.05, 0.45, 3.2);
      const lp = k.f('lowpass', 1500 + 5200 * vel, 0.5);
      lp.frequency.setTargetAtTime(Math.min(1300, 600 + f * 1.5), t, 0.3);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.27 * vel, 0.002, dur, 0.22, tau, 0.05);
      const o1 = k.osc('sine', f, t, stop), o2 = k.osc('triangle', f * 2.004, t, stop), o3 = k.osc('sine', f * 3.012, t, t + 1.2);
      const g2 = k.g(0.3), g3 = k.g(0.1), th = k.osc('triangle', Math.max(70, f * 0.5), t, t + 0.06), tg = k.g(0);
      g3.gain.setTargetAtTime(0, t, 0.18);
      tg.gain.setValueAtTime(0.1 * vel, t); tg.gain.setTargetAtTime(0, t, 0.006);   // hammer thump
      o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp); th.connect(tg); tg.connect(lp);
      lp.connect(out); out.connect(b.input);
      k.free(o1, out, lp, g2, g3, tg);
      c.rig.track(stop, 4);
    },
    dispose: () => k.dispose(),
  };
};

const vibes: Make = (k) => {
  const c = k.c;
  const trem = k.g(0.84);
  k.lfo(5.5, 0.16, trem.gain);                               // motor
  const b = k.bus({ pan: 0.28, send: 0.42, hall: 0.08 });
  trem.connect(b.input);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const tau = clamp(2.1 - (m - 53) * 0.03, 0.5, 2);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.26 * vel, 0.002, Math.min(dur, 1.4), 0.45, tau, 0.1);
      const o1 = k.osc('sine', f, t, stop);
      o1.connect(out);
      const nodes: AudioNode[] = [out];
      if (f * 3.9 < 13000) {
        const o2 = k.osc('sine', f * 3.9, t, t + 1.2), g2 = k.g(0.2);
        g2.gain.setTargetAtTime(0, t + 0.002, 0.2);
        o2.connect(g2); g2.connect(out); nodes.push(g2);
      }
      if (f * 10.1 < 14000) {
        const o3 = k.osc('sine', f * 10.1, t, t + 0.2), g3 = k.g(0.06);
        g3.gain.setTargetAtTime(0, t, 0.035);
        o3.connect(g3); g3.connect(out); nodes.push(g3);
      }
      out.connect(trem);
      k.free(o1, ...nodes);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const organ: Make = (k) => {
  const c = k.c;
  const am = k.g(0.9);
  k.lfo(6.5, 0.1, am.gain);                                  // Leslie
  const b = k.bus({ pan: 0.05, send: 0.3, hall: 0.12 });
  k.lfo(6.5, 0.16, b.out.pan);
  am.connect(b.input);
  return {
    play(t, m, dur, v, x = 0) {
      const f = mtof(m), vel = 0.35 + 0.65 * v;
      const out = k.g(0);
      const stop = env(out.gain, t, 0.15 * vel, x === 1 ? 0.5 : 0.012, dur, x === 1 ? 0.9 : 0.07);
      const bars: Array<[number, number]> = [[0.5, 0.5], [1, 0.8], [2, 0.55], [3, 0.24], [4, 0.16]];
      if (x === 1) bars.push([1, 0.35], [6, 0.08]);
      let first: OscillatorNode | null = null;
      const nodes: AudioNode[] = [out];
      for (const [r, g] of bars) {
        if (f * r > 12000) continue;
        const o = k.osc('sine', f * r, t, stop), og = k.g(g);
        o.connect(og); og.connect(out); nodes.push(og);
        first ??= o;
      }
      out.connect(am);
      if (first) k.free(first, ...nodes);
      c.rig.track(stop, bars.length);
    },
    dispose: () => k.dispose(),
  };
};

// ── bass / plucks ───────────────────────────────────────────────────────────────────────────────
const bass: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: -0.05, send: 0.1 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const lp = k.f('lowpass', 1500, 0.7);
      lp.frequency.setTargetAtTime(Math.max(500, Math.min(900, f * 5)), t, 0.1);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.44 * vel, 0.005, Math.max(0.12, dur * 0.97), 0.1, 0.35, 0.3);
      const slide = Math.pow(2, -15 / 1200);
      const o1 = k.osc('sine', f, t, stop), o2 = k.osc('triangle', f * 2, t, stop), o3 = k.osc('sine', f * 3, t, stop);
      for (const o of [o1, o2, o3]) {                        // 15-cent slide-in
        const base = o.frequency.value;
        o.frequency.setValueAtTime(base * slide, t); o.frequency.exponentialRampToValueAtTime(base, t + 0.04);
      }
      const g2 = k.g(0.4), g3 = k.g(0.1), cl = k.osc('triangle', Math.max(90, f * 4), t, t + 0.03), cg = k.g(0);
      cg.gain.setValueAtTime(0.16 * vel, t); cg.gain.setTargetAtTime(0, t, 0.004);   // finger click
      o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp); cl.connect(cg); cg.connect(lp);
      lp.connect(out); out.connect(b.input);
      k.free(o1, out, lp, g2, g3, cg);
      c.rig.track(stop, 5);
    },
    dispose: () => k.dispose(),
  };
};

const pluckKit = (o: { damp: number; len: number; bright: number; pan: number; send: number; hall: number; gain: number }): Make => (k) => {
  const c = k.c;
  const b = k.bus({ gain: o.gain, pan: o.pan, send: o.send, hall: o.hall });
  const cache = new Map<number, Plucked>();
  const rev = new Map<number, AudioBuffer>();
  const get = (m: number): Plucked => {
    let p = cache.get(m);
    if (!p) {
      p = renderPluck(c.ctx, m, o.len, o.damp, o.bright);
      if (cache.size > 48) { const first = cache.keys().next().value as number; cache.delete(first); rev.delete(first); }
      cache.set(m, p);
    }
    return p;
  };
  return {
    play(t, m, dur, v, x = 0) {
      const p = get(m), vel = vcurve(v);
      const src = c.ctx.createBufferSource();
      const len = p.buffer.duration / p.rate;
      const g = k.g(0.5 * vel);
      src.connect(g); g.connect(b.input);
      src.playbackRate.value = p.rate;
      if (x === 1) {                                         // reversed swell that lands on t + dur
        let rb = rev.get(m);
        if (!rb) { rb = reverseBuffer(c.ctx, p.buffer); rev.set(m, rb); }
        src.buffer = rb;
        g.gain.value = 0.55 * vel;
        src.start(Math.max(c.ctx.currentTime, t + dur - len));
        src.onended = () => { try { g.disconnect(); } catch { /* noop */ } };
        return;
      }
      src.buffer = p.buffer;
      k.followDetune(src.detune, src, len);
      if (dur < len * 0.8) { g.gain.setValueAtTime(0.5 * vel, t); g.gain.setTargetAtTime(0, t + dur, 0.06); }   // palm mute
      src.start(t); src.stop(t + Math.min(len, dur + 0.5));
      src.onended = () => { try { g.disconnect(); } catch { /* noop */ } };
      c.rig.track(t + Math.min(len, dur + 0.5), 1);
    },
    dispose: () => k.dispose(),
  };
};

// ── melodic voices ──────────────────────────────────────────────────────────────────────────────
const trumpet: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.18, send: 0.36, hall: 0.12 });
  const vib = k.vibrato(5);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.3 * vel, 0.022, dur, 0.1, 0.16, 0.82);
      const o = k.osc('sawtooth', f, t, stop);
      o.detune.setValueAtTime(-55, t); o.detune.linearRampToValueAtTime(0, t + 0.075);   // scoop
      const vg = k.g(0);                                    // vibrato ±15 ¢ after 0.25 s
      vg.gain.setValueAtTime(0, t + 0.25); vg.gain.linearRampToValueAtTime(15, t + 0.55);
      k.tap(vib, vg, o); vg.connect(o.detune);
      const bp = k.f('bandpass', 1200, 4), lp = k.f('lowpass', 3000 + 800 * vel, 0.6);   // harmon mute
      const gb = k.g(1.9), gl = k.g(0.22);
      o.connect(bp); bp.connect(gb); gb.connect(out);
      o.connect(lp); lp.connect(gl); gl.connect(out);
      out.connect(b.input);
      k.free(o, out, bp, lp, gb, gl, vg);
      c.rig.track(stop, 1);
    },
    dispose: () => k.dispose(),
  };
};

const flute: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.2, send: 0.4, hall: 0.1 });
  const vib = k.vibrato(5.1);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.26 * vel, 0.07, dur, 0.14);
      const o = k.osc('sine', f, t, stop), o2 = k.osc('triangle', f * 2, t, stop), g2 = k.g(0.1), vg = k.g(0);
      vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(8, t + 0.6);
      k.tap(vib, vg, o); vg.connect(o.detune); vg.connect(o2.detune);
      o.connect(out); o2.connect(g2); g2.connect(out);
      const br = c.ctx.createBufferSource();                 // breath
      br.buffer = c.rig.perc.get(D.SHAKER_UP);
      const bf = k.f('bandpass', Math.min(5200, f * 3), 1.4), bg = k.g(0.5 * vel);
      br.connect(bf); bf.connect(bg); bg.connect(out); br.start(t);
      out.connect(b.input);
      k.free(o, out, g2, vg, bf, bg);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const box: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.1, send: 0.5, hall: 0.2 });
  return {
    play(t, m, _dur, v, x = 0) {
      const dread = c.rig.dread;
      const f = mtof(m) * Math.pow(2, ((c.rig.random() * 2 - 1) * (18 + 40 * dread * dread + x)) / 1200), vel = vcurve(v);
      const out = k.g(0);
      const stop = t + 1.9;
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.27 * vel, t + 0.0015);
      out.gain.setTargetAtTime(0, t + 0.0015, 0.27);
      const o = k.osc('triangle', f, t, stop);
      o.connect(out);
      const nodes: AudioNode[] = [out];
      if (f * 8 < 14000) {                                  // 8th partial "tooth"
        const o8 = k.osc('sine', f * 8, t, t + 0.4), g8 = k.g(0.1);
        g8.gain.setTargetAtTime(0, t, 0.07);
        o8.connect(g8); g8.connect(out); nodes.push(g8);
      }
      out.connect(b.input);
      k.free(o, ...nodes);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const choir: Make = (k) => {
  const c = k.c;
  const sum = k.g(1);
  const bus = k.bus({ pan: 0, send: 0.4, hall: 0.55 });
  const f1 = k.f('bandpass', 800, 5), f2 = k.f('bandpass', 1150, 6), f3 = k.f('bandpass', 2800, 8);   // "ah"
  const g1 = k.g(5.5), g2 = k.g(4), g3 = k.g(1.4), sm = k.f('lowpass', 1500, 0.5), gd = k.g(0.5);
  sum.connect(f1); sum.connect(f2); sum.connect(f3); sum.connect(sm);
  f1.connect(g1); f2.connect(g2); f3.connect(g3); sm.connect(gd);
  g1.connect(bus.input); g2.connect(bus.input); g3.connect(bus.input); gd.connect(bus.input);
  k.lfo(0.11, 90, f1.frequency); k.lfo(0.08, 140, f2.frequency);      // the vowel breathes
  const vib = k.vibrato(5.2);
  return {
    play(t, m, dur, v, x = 0) {
      const f = mtof(m), vel = 0.3 + 0.7 * v;
      const atk = Math.min(x > 0 ? x : 1.5, dur * 0.6 + 0.05);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.075 * vel, atk, dur, 1.2);
      const vg = k.g(5);
      let first: OscillatorNode | null = null;
      for (const cents of [-8, 8]) {                          // two detuned saws are enough for the ensemble shimmer
        const o = k.osc('sawtooth', f, t, stop, cents);
        vg.connect(o.detune); o.connect(out); first ??= o;
      }
      if (first) { k.tap(vib, vg, first); k.free(first, out, vg); }
      out.connect(sum);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const strings: Make = (k) => {
  const c = k.c;
  const lp = k.f('lowpass', 2300, 0.5), b = k.bus({ pan: 0, send: 0.35, hall: 0.35 });
  lp.connect(b.input);
  const vib = k.vibrato(5.4), duckG = k.g(1);
  duckG.connect(lp);
  return {
    play(t, m, dur, v) {
      if (m < 0) return;
      const f = mtof(m), vel = 0.3 + 0.7 * v;
      const out = k.g(0);
      const stop = env(out.gain, t, 0.07 * vel, Math.min(0.45, dur * 0.5 + 0.05), dur, 0.7);
      const vg = k.g(6);
      let first: OscillatorNode | null = null;
      for (const cents of [-9, 9]) {
        const o = k.osc('sawtooth', f, t, stop, cents);
        vg.connect(o.detune); o.connect(out); first ??= o;
      }
      if (first) { k.tap(vib, vg, first); k.free(first, out, vg); }
      out.connect(duckG);
      c.rig.track(stop, 2);
    },
    duck(t, amt) { duckG.gain.setTargetAtTime(1 - amt, t, 0.008); duckG.gain.setTargetAtTime(1, t + 0.04, 0.11); },
    dispose: () => k.dispose(),
  };
};

const reed: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: -0.18, send: 0.34, hall: 0.1 });
  const vib = k.vibrato(5.3);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.24 * vel, 0.05, dur, 0.1, 0.2, 0.85);   // bellows swell
      const o1 = k.osc('sawtooth', f, t, stop, -4), o2 = k.osc('sawtooth', f, t, stop, 5), o3 = k.osc('square', f * 0.5, t, stop);
      const g3 = k.g(0.3), vg = k.g(0);
      vg.gain.setValueAtTime(0, t + 0.12); vg.gain.linearRampToValueAtTime(10, t + 0.4);
      k.tap(vib, vg, o1); vg.connect(o1.detune); vg.connect(o2.detune);
      const bp = k.f('bandpass', 1000, 1.0), lp = k.f('lowpass', 2300, 0.6), gb = k.g(1.2), gl = k.g(0.35);
      o1.connect(bp); o2.connect(bp); o3.connect(g3); g3.connect(bp);
      o1.connect(lp); o2.connect(lp);
      bp.connect(gb); gb.connect(out); lp.connect(gl); gl.connect(out);
      out.connect(b.input);
      k.free(o1, out, g3, vg, bp, lp, gb, gl);
      c.rig.track(stop, 3);
    },
    dispose: () => k.dispose(),
  };
};

const calliope: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.08, send: 0.4, hall: 0.2 });
  return {
    play(t, m, dur, v, x = 0) {
      const dread = c.rig.dread;
      const f = mtof(m) * Math.pow(2, ((c.rig.random() * 2 - 1) * (22 + 40 * dread + x)) / 1200), vel = vcurve(v);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.15 * vel, 0.008, dur, 0.07);
      const o1 = k.osc('square', f, t, stop), o2 = k.osc('sawtooth', f * 2.003, t, stop), g2 = k.g(0.35);
      const bp = k.f('bandpass', 2300, 0.8), g = k.g(1.6), lp = k.f('lowpass', 5200, 0.5);
      o1.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g); g.connect(lp); lp.connect(out);
      const ch = c.ctx.createBufferSource(); ch.buffer = c.rig.perc.get(D.SHAKER); ch.playbackRate.value = 0.8;   // chiff
      const cg = k.g(0.5 * vel); ch.connect(cg); cg.connect(out); ch.start(t);
      out.connect(b.input);
      k.free(o1, out, g2, bp, g, lp, cg);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const tuba: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: -0.15, send: 0.12 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const lp = k.f('lowpass', 700, 0.8);
      lp.frequency.setValueAtTime(220, t); lp.frequency.linearRampToValueAtTime(760, t + 0.03); lp.frequency.setTargetAtTime(480, t + 0.03, 0.2);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.36 * vel, 0.012, Math.max(0.1, dur), 0.06, 0.25, 0.4);
      const o1 = k.osc('triangle', f, t, stop), o2 = k.osc('sawtooth', f, t, stop), g2 = k.g(0.28);
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out); out.connect(b.input);
      k.free(o1, out, lp, g2);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const bell: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.2, send: 0.5, hall: 0.35 });
  const parts: Array<[number, number, number]> = [[1, 1, 1], [2.76, 0.42, 0.5], [5.4, 0.2, 0.25], [8.93, 0.09, 0.12]];
  return {
    play(t, m, _dur, v, x = 0) {
      const f = mtof(m), vel = vcurve(v);
      const out = k.g(0);
      const tau = clamp(1.6 - (m - 60) * 0.02, 0.35, 1.7) * (x === 1 ? 1.8 : 1);
      const stop = t + tau * 5 + 0.1;
      out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.2 * vel, t + 0.001);
      let first: OscillatorNode | null = null;
      const nodes: AudioNode[] = [out];
      for (const [r, g, d] of parts) {
        if (f * r > 13000) continue;
        const o = k.osc('sine', f * r, t, stop), og = k.g(g);
        og.gain.setTargetAtTime(0, t + 0.001, (tau * d) / 2.2);
        o.connect(og); og.connect(out); nodes.push(og);
        first ??= o;
      }
      out.connect(b.input);
      if (first) k.free(first, ...nodes);
      c.rig.track(stop, 3);
    },
    dispose: () => k.dispose(),
  };
};

const brass: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0, send: 0.3, hall: 0.3 });
  const vib = k.vibrato(5.6);
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.24 * vel, 0.02, dur, 0.14, 0.14, 0.78);
      const lp = k.f('lowpass', 500, 0.9);
      lp.frequency.setValueAtTime(450, t); lp.frequency.linearRampToValueAtTime(3200 + 1200 * vel, t + 0.09); lp.frequency.setTargetAtTime(2100, t + 0.09, 0.25);
      const vg = k.g(0);
      vg.gain.setValueAtTime(0, t + 0.25); vg.gain.linearRampToValueAtTime(7, t + 0.6);
      let first: OscillatorNode | null = null;
      for (const cents of [-9, 0, 9]) {
        const o = k.osc('sawtooth', f, t, stop, cents);
        vg.connect(o.detune); o.connect(lp); first ??= o;
      }
      lp.connect(out); out.connect(b.input);
      if (first) { k.tap(vib, vg, first); k.free(first, out, lp, vg); }
      c.rig.track(stop, 3);
    },
    dispose: () => k.dispose(),
  };
};

// ── synths ──────────────────────────────────────────────────────────────────────────────────────
const synBass: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0, send: 0.06 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m), vel = vcurve(v);
      const lp = k.f('lowpass', 200, 5);
      lp.frequency.setValueAtTime(600 + 1800 * vel, t); lp.frequency.setTargetAtTime(170 + f * 2, t, 0.11);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.24 * vel, 0.004, Math.max(0.05, dur * 0.92), 0.06);
      const o1 = k.osc('sawtooth', f, t, stop), o2 = k.osc('square', f * 0.5, t, stop), g2 = k.g(0.7);
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(out); out.connect(b.input);
      k.free(o1, out, lp, g2);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const synArp: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: -0.2, send: 0.3, hall: 0.12 });
  const duckG = k.g(1); duckG.connect(b.input);
  const echo = k.delay(2), fb = k.g(0.36), el = k.f('lowpass', 2600, 0.5), eg = k.g(0.3);
  duckG.connect(echo); echo.connect(el); el.connect(fb); fb.connect(echo); el.connect(eg); eg.connect(b.input);
  return {
    play(t, m, dur, v) {
      if (m < 0) return;
      echo.delayTime.setValueAtTime(c.beat() * 0.75, t);
      const f = mtof(m), vel = vcurve(v);
      const lp = k.f('lowpass', 3800, 3);
      lp.frequency.setValueAtTime(900 + 3600 * vel, t); lp.frequency.setTargetAtTime(620, t, 0.085);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.17 * vel, 0.003, Math.min(dur, 0.5), 0.05, 0.16, 0.2);
      const o1 = k.osc('sawtooth', f, t, stop, -7), o2 = k.osc('sawtooth', f, t, stop, 7);
      o1.connect(lp); o2.connect(lp); lp.connect(out); out.connect(duckG);
      k.free(o1, out, lp);
      c.rig.track(stop, 2);
    },
    duck(t, amt) { duckG.gain.setTargetAtTime(1 - amt, t, 0.008); duckG.gain.setTargetAtTime(1, t + 0.04, 0.1); },
    dispose: () => k.dispose(),
  };
};

const synLead: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0.1, send: 0.3, hall: 0.18 });
  const echo = k.delay(2), fb = k.g(0.38), el = k.f('lowpass', 2400, 0.5), eg = k.g(0.34);
  const inG = k.g(1); inG.connect(b.input); inG.connect(echo);
  echo.connect(el); el.connect(fb); fb.connect(echo); el.connect(eg); eg.connect(b.input);
  const vib = k.vibrato(5.4);
  let lastF = 0, lastT = -9;
  return {
    play(t, m, dur, v) {
      echo.delayTime.setValueAtTime(c.beat() * 0.75, t);
      const f = mtof(m), vel = vcurve(v);
      const lp = k.f('lowpass', 2800 + 1500 * vel, 1.4);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.2 * vel, 0.012, dur, 0.16, 0.3, 0.8);
      const vg = k.g(0);
      vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(9, t + 0.5);
      let first: OscillatorNode | null = null;
      const glide = lastF > 0 && t - lastT < 0.45 && Math.abs(Math.log2(f / lastF)) < 0.6;
      for (const cents of [-12, 0, 12]) {
        const o = k.osc('sawtooth', f, t, stop, cents);
        if (glide) { o.frequency.setValueAtTime(lastF, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
        vg.connect(o.detune); o.connect(lp); first ??= o;
      }
      const sq = k.osc('square', f * 0.5, t, stop), sg = k.g(0.18);
      sq.connect(sg); sg.connect(lp);
      lp.connect(out); out.connect(inG);
      lastF = f; lastT = t + dur;
      if (first) { k.tap(vib, vg, first); k.free(first, out, lp, vg, sg); }
      c.rig.track(stop, 4);
    },
    dispose: () => k.dispose(),
  };
};

const synPad: Make = (k) => {
  const c = k.c;
  const lp = k.f('lowpass', 1600, 0.7), b = k.bus({ pan: 0, send: 0.35, hall: 0.3 });
  const duckG = k.g(1); duckG.connect(lp); lp.connect(b.input);
  return {
    play(t, m, dur, v) {
      if (m < 0) return;
      const f = mtof(m), vel = 0.3 + 0.7 * v;
      const out = k.g(0);
      const stop = env(out.gain, t, 0.085 * vel, Math.min(0.9, dur * 0.5 + 0.05), dur, 1.1);
      let first: OscillatorNode | null = null;
      for (const cents of [-12, 12]) { const o = k.osc('sawtooth', f, t, stop, cents); o.connect(out); first ??= o; }
      const tr = k.osc('triangle', f, t, stop), tg = k.g(0.5); tr.connect(tg); tg.connect(out);
      out.connect(duckG);
      if (first) k.free(first, out, tg);
      c.rig.track(stop, 3);
    },
    duck(t, amt) { duckG.gain.setTargetAtTime(1 - amt, t, 0.006); duckG.gain.setTargetAtTime(1, t + 0.05, 0.13); },
    dispose: () => k.dispose(),
  };
};

const sub: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0, send: 0.05, hall: 0.1 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.15 * (0.4 + 0.6 * v), Math.min(1.2, dur * 0.4 + 0.1), dur, 1.1);
      const o = k.osc('sine', f, t, stop), o2 = k.osc('triangle', f * 2, t, stop), g2 = k.g(0.12);
      o.connect(out); o2.connect(g2); g2.connect(out); out.connect(b.input);
      k.free(o, out, g2);
      c.rig.track(stop, 2);
    },
    dispose: () => k.dispose(),
  };
};

const drone: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0, send: 0.35, hall: 0.6 });
  return {
    play(t, m, dur, v) {
      const f = mtof(m);
      const lp = k.f('lowpass', 360, 1.1);
      const lf = c.ctx.createOscillator(); lf.type = 'sine'; lf.frequency.value = 0.05 + c.rig.random() * 0.06;
      const lg = k.g(120); lf.connect(lg); lg.connect(lp.frequency); lf.start(t); lf.stop(t + dur + 6);
      const out = k.g(0);
      const stop = env(out.gain, t, 0.13 * (0.4 + 0.6 * v), Math.min(2.2, dur * 0.4 + 0.1), dur, 2.4);
      const o1 = k.osc('sawtooth', f, t, stop, -6), o2 = k.osc('sawtooth', f, t, stop, 6), o3 = k.osc('square', f * 0.5, t, stop), g3 = k.g(0.4);
      o1.connect(lp); o2.connect(lp); o3.connect(g3); g3.connect(lp); lp.connect(out); out.connect(b.input);
      k.free(o1, out, lp, lg, g3);
      c.rig.track(stop, 4);
    },
    dispose: () => k.dispose(),
  };
};

// ── drums ───────────────────────────────────────────────────────────────────────────────────────
const KIND: Record<number, { g: number; pan: number }> = {
  [D.KICK]: { g: 0.4, pan: 0 }, [D.KICK_SOFT]: { g: 0.36, pan: 0 }, [D.KICK_808]: { g: 0.34, pan: 0 },
  [D.HEART]: { g: 0.36, pan: 0 }, [D.BOOM]: { g: 0.45, pan: 0 },
  [D.SNARE]: { g: 0.8, pan: 0.04 }, [D.SNARE_GHOST]: { g: 0.5, pan: 0.04 }, [D.SNARE_BRUSH]: { g: 0.75, pan: 0.05 },
  [D.RIM]: { g: 0.6, pan: 0.1 }, [D.CLAP]: { g: 0.65, pan: 0 },
  [D.HAT]: { g: 0.55, pan: 0.3 }, [D.HAT_PEDAL]: { g: 0.6, pan: 0.3 }, [D.HAT_OPEN]: { g: 0.5, pan: 0.3 },
  [D.RIDE]: { g: 0.5, pan: 0.36 }, [D.RIDE_BELL]: { g: 0.45, pan: 0.36 },
  [D.SWISH_UP]: { g: 0.5, pan: -0.06 }, [D.SWISH_DOWN]: { g: 0.5, pan: -0.06 },
  [D.SHAKER]: { g: 0.55, pan: -0.32 }, [D.SHAKER_UP]: { g: 0.5, pan: -0.32 },
  [D.CRASH]: { g: 0.45, pan: -0.25 }, [D.REV_CRASH]: { g: 0.45, pan: 0 },
  [D.TOM_HI]: { g: 0.6, pan: -0.25 }, [D.TOM_MID]: { g: 0.6, pan: 0.05 }, [D.TOM_LO]: { g: 0.6, pan: 0.3 },
  [D.TICK]: { g: 0.6, pan: -0.12 }, [D.TOCK]: { g: 0.6, pan: 0.12 }, [D.CLACK]: { g: 0.6, pan: 0 }, [D.WOOD]: { g: 0.5, pan: 0.15 },
  [D.STEAM]: { g: 0.4, pan: 0.2 }, [D.TAMB]: { g: 0.55, pan: 0.2 }, [D.TOY]: { g: 0.6, pan: 0.1 }, [D.CHIME_HIT]: { g: 0.4, pan: 0.2 },
};

const drums: Make = (k) => {
  const c = k.c;
  const sends = k.bus({ pan: 0, send: 0.16, hall: 0.03 });
  const lanes = new Map<number, GainNode>();
  const lane = (kind: number): GainNode => {
    let g = lanes.get(kind);
    if (!g) {
      const d = KIND[kind] ?? { g: 0.4, pan: 0 };
      g = k.g(d.g); const p = k.pan(d.pan);
      g.connect(p); p.connect(sends.input);
      lanes.set(kind, g);
    }
    return g;
  };
  return {
    play(t, kind, _dur, v, x = 1) {
      const buf = c.rig.perc.get(kind);
      if (!buf) return;
      const s = c.ctx.createBufferSource();
      s.buffer = buf;
      const tom = kind === D.TOM_HI || kind === D.TOM_MID || kind === D.TOM_LO;
      s.playbackRate.value = (x || 1) * (1 + (c.rig.random() - 0.5) * (tom ? 0.01 : 0.05));
      k.followDetune(s.detune, s, buf.duration);
      const g = k.g(Math.pow(v, 1.15));
      s.connect(g); g.connect(lane(kind));
      s.start(t);
      k.free(s, g);
    },
    dispose: () => k.dispose(),
  };
};

// ── fx (noise-based) ────────────────────────────────────────────────────────────────────────────
const fx: Make = (k) => {
  const c = k.c;
  const b = k.bus({ pan: 0, send: 0.3, hall: 0.5 });
  const nb = c.ctx.createBuffer(1, Math.floor(c.ctx.sampleRate * 2), c.ctx.sampleRate);
  {
    const d = nb.getChannelData(0); let s = 12345;
    for (let i = 0; i < d.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
  }
  const src = (t: number, dur: number): AudioBufferSourceNode => {
    const s = c.ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(t); s.stop(t + dur); return s;
  };
  return {
    play(t, kind, dur, v) {
      const out = k.g(0), p = k.pan((c.rig.random() * 2 - 1) * 0.6);
      out.connect(p); p.connect(b.input);
      let ender: AudioScheduledSourceNode;
      if (kind === FX.RISER) {
        const s = src(t, dur + 0.2), bp = k.f('bandpass', 300, 3); ender = s;
        bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.5 * v, t + dur); out.gain.linearRampToValueAtTime(0, t + dur + 0.08);
        s.connect(bp); bp.connect(out);
      } else if (kind === FX.WHISPER) {
        const s = src(t, dur + 0.3), f1 = k.f('bandpass', 700, 7), f2 = k.f('bandpass', 1900, 9), g = k.g(1); ender = s;
        f1.frequency.setValueAtTime(500 + c.rig.random() * 500, t); f1.frequency.linearRampToValueAtTime(400 + c.rig.random() * 700, t + dur);
        f2.frequency.setValueAtTime(1500 + c.rig.random() * 900, t); f2.frequency.linearRampToValueAtTime(1200 + c.rig.random() * 1200, t + dur);
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.5 * v, t + dur * 0.35); out.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(f1); s.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
      } else if (kind === FX.SCRAPE) {
        const s = src(t, dur + 0.1), bp = k.f('bandpass', 900, 5), o = k.osc('sawtooth', 58, t, t + dur + 0.1), og = k.g(0.15); ender = s;
        bp.frequency.setValueAtTime(1400, t); bp.frequency.exponentialRampToValueAtTime(280, t + dur);
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.42 * v, t + 0.06); out.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(bp); bp.connect(out); o.connect(og); og.connect(out);
      } else if (kind === FX.BREATH) {
        const s = src(t, dur + 0.3), lp = k.f('lowpass', 800, 0.7); ender = s;
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.4 * v, t + dur * 0.45); out.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(lp); lp.connect(out);
      } else if (kind === FX.BUZZ) {
        const o = k.osc('sawtooth', 100, t, t + dur + 0.2), bp = k.f('bandpass', 420, 4); ender = o;
        out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.13 * v, t + 0.2); out.gain.setValueAtTime(0.13 * v, t + dur); out.gain.linearRampToValueAtTime(0, t + dur + 0.2);
        o.connect(bp); bp.connect(out);
      } else {                                              // SUCK
        const s = src(t, dur + 0.1), bp = k.f('bandpass', 2400, 2); ender = s;
        bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(90, t + dur);
        out.gain.setValueAtTime(0.45 * v, t); out.gain.linearRampToValueAtTime(0, t + dur);
        s.connect(bp); bp.connect(out);
      }
      k.free(ender, out, p);
      c.rig.track(t + dur + 0.3, 1);
    },
    dispose: () => k.dispose(),
  };
};

const FACTORY: Record<InstId, Make> = {
  rhodes, piano, vibes, organ, bass, trumpet, flute, box, choir, strings, reed, calliope, tuba, bell, brass,
  synBass, synArp, synLead, synPad, sub, drone, drums, fx,
  pluck: pluckKit({ damp: 0.996, len: 1.5, bright: 0.55, pan: -0.22, send: 0.3, hall: 0.08, gain: 1 }),
  harp: pluckKit({ damp: 0.9985, len: 2.6, bright: 0.75, pan: 0.18, send: 0.45, hall: 0.3, gain: 0.9 }),
};

export function createInstrument(id: InstId, c: InstCtx): Instrument {
  const k = new Kit(c);
  const inst = FACTORY[id](k);
  k.seal();
  return inst;
}
