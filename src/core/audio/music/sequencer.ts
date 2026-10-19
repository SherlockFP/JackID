/**
 * Sequencer (CORE-AUDIO / music): plays one {@link SongDef} as an "arrangement" — a bar-by-bar generator that
 * feeds the instrument patches through a lookahead queue.
 *
 *   chart → bars → per-part generators (seeded per part × bar) → events in sequencer steps → swing warp,
 *   humanise (lag + gaussian jitter + velocity) → queue → gated at dispatch time → `Instrument.play`
 *
 * Gates (intensity / dread) are evaluated when an event is dispatched, so layers join within ~one lookahead
 * instead of waiting for the next bar. Generators run every bar regardless of gates (their voice-leading state is
 * deterministic: same seed ⇒ same arrangement, whatever the intensity did). High dread "sours" chord qualities.
 * The owner (`music.ts`) calls {@link Arrangement.pump} from its 25 ms timer; offline renders call it once with
 * `until = song length`.
 */
import { createRng, hashSeed, type Rng } from '../../rng';
import { createInstrument, type InstCtx, type Instrument } from './instruments';
import {
  ACCENT, OPT, RAW, smooth,
  type BarCtx, type GenFn, type InstId, type PartDef, type Push, type SongDef,
} from './model';
import type { Rig } from './rig';
import { MODES, mod12, parseChart, reQuality, type Seg } from './theory';

interface BarDef { sec: string; secBar: number; secLen: number; segs: Seg[] }
interface Flat { bars: BarDef[]; loopBar: number }
interface QEv { ts: number; ds: number; m: number; v: number; o: number; x: number | undefined; i: InstId; p: number }
/** Optional notes (arps, solos, sparkle) are dropped while more than this many oscillators are alive. */
const VOICE_BUDGET = 92;
/** Above this nothing but rhythm section notes starts (a pile-up guard for dread 1 with every layer on). */
const HARD_BUDGET = 130;
export interface BeatMark { t: number; bpm: number; beat: number; bar: number }

const flatCache = new Map<string, Flat>();
/** Chart text → per-bar chord segments for the whole form (cached per song id). */
export function flatten(song: SongDef): Flat {
  const key = `${song.id}|${song.beats}|${song.sub}`;
  let f = flatCache.get(key);
  if (f) return f;
  const spb = song.beats * song.sub;
  const bars: BarDef[] = [];
  let loopBar = 0;
  song.form.forEach((name, fi) => {
    const chart = song.sections[name];
    if (chart === undefined) throw new Error(`song ${song.id}: no section "${name}"`);
    const segs = parseChart(chart, spb);
    if (fi === (song.loopFrom ?? 0)) loopBar = bars.length;
    segs.forEach((sg, k) => bars.push({ sec: name, secBar: k, secLen: segs.length, segs: sg }));
  });
  f = { bars, loopBar };
  flatCache.set(key, f);
  return f;
}

// ── dread: chord souring ────────────────────────────────────────────────────────────────────────
const SOUR_TO: Record<string, readonly string[]> = {
  '': ['m', 'dim'], maj: ['m', 'dim'], '6': ['m6', 'dim7'], '69': ['m6'], add9: ['m'],
  maj7: ['mM7', 'm7b5'], maj9: ['mM7', 'm7b5'], 'maj7#11': ['mM7'], maj13: ['mM7'],
  m: ['dim'], m6: ['dim7'], m7: ['m7b5', 'dim7'], m9: ['m7b5'], m11: ['m7b5'],
  '7': ['7alt', '7b9', 'dim7'], '9': ['7alt', '7b9'], '13': ['7alt', '7b13'], '7b9': ['dim7'], '7#9': ['7alt'], '7sus4': ['7b9'],
  sus4: ['dim'], sus2: ['dim'],
};
function sourSegs(segs: Seg[], d: number, rng: Rng): Seg[] {
  const p = smooth(0.3, 0.95, d) * 0.85;
  if (p <= 0.02) return segs;
  return segs.map((s) => {
    const opts = SOUR_TO[s.chord.q];
    if (!opts || !rng.chance(p)) return s;
    return { ...s, chord: reQuality(s.chord, opts[rng.int(0, opts.length - 1)]) };
  });
}

// ── fade curves (equal power) ───────────────────────────────────────────────────────────────────
const CURVE_N = 48;
const curveCache = new Map<string, Float32Array<ArrayBuffer>>();
function powerCurve(kind: 'in' | 'out', level: number): Float32Array<ArrayBuffer> {
  const key = `${kind}${level.toFixed(3)}`;
  let c = curveCache.get(key);
  if (!c) {
    c = new Float32Array(CURVE_N);
    for (let i = 0; i < CURVE_N; i++) {
      const x = (i / (CURVE_N - 1)) * Math.PI * 0.5;
      c[i] = (kind === 'in' ? Math.sin(x) : Math.cos(x)) * level;
    }
    curveCache.set(key, c);
  }
  return c;
}

export interface ArrOptions {
  /** Audio seed of the arrangement (same seed ⇒ same notes). */
  seed: number;
  /** Macro-state id, forwarded to generators through `BarCtx.state`. */
  state?: string;
}

export class Arrangement {
  readonly song: SongDef;
  readonly rig: Rig;
  /** Crossfade gain; every instrument bus of this arrangement ends here. */
  readonly mix: GainNode;
  /** Beat marks the owner drains to drive `onBeat` / the `beat` getter. */
  readonly beatQ: BeatMark[] = [];
  /** Effective intensity / dread / stakes / tempo multiplier, written by the owner before each pump. */
  i = 0; d = 0; s = 0; tempoMul = 1;
  state: string;
  nextBarTime = 0;
  barNo = 0;
  /** True once no more bars will be generated (one-shot ended, or `stopGen`). */
  genDone = false;
  /** End time of the last generated bar (valid once `genDone`). */
  endTime = 0;
  startAt = 0;
  started = false;

  private readonly ctx: BaseAudioContext;
  private readonly seed: number;
  private readonly flat: Flat;
  private readonly parts: Array<{ def: PartDef; inst: InstId; gen: GenFn }>;
  private readonly insts = new Map<InstId, Instrument>();
  private readonly ictx: InstCtx;
  private readonly send: GainNode;
  private hallSend: GainNode | null = null;
  private readonly human: Rng;
  private readonly scale: number[];
  private readonly level: number;
  private queue: QEv[] = [];
  private dirty = false;
  private pos = 0;
  private genLimit = Infinity;
  private beatSec = 0.6;
  private inEnd = 0;
  private disposed = false;
  private readonly scratch: QEv[] = [];
  /** QA hook: called for every note actually played (part id, instrument, time, midi, duration, velocity). */
  trace: ((part: string, inst: InstId, t: number, m: number, d: number, v: number) => void) | null = null;

  constructor(rig: Rig, song: SongDef, o: ArrOptions) {
    this.rig = rig;
    this.ctx = rig.ctx;
    this.song = song;
    this.seed = o.seed >>> 0;
    this.state = o.state ?? 'lounge';
    this.flat = flatten(song);
    this.level = song.gain ?? 1;
    this.scale = (MODES[song.mode] as readonly number[]).map((s) => mod12(song.key + s));
    this.human = createRng(hashSeed(this.seed, 'human'));

    this.mix = this.ctx.createGain();
    this.mix.gain.value = 0;
    this.mix.connect(rig.input);
    this.send = this.ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(rig.sendRoom);
    this.ictx = {
      rig, ctx: this.ctx, dest: this.mix, send: this.send,
      hall: () => this.getHall(), beat: () => this.beatSec,
    };

    const root = createRng(this.seed);
    this.parts = song.parts.map((def) => {
      const choices = Array.isArray(def.inst) ? def.inst : [def.inst];
      const inst = choices.length > 1 ? root.fork(`inst:${def.id}`).pick(choices) : choices[0];
      return { def, inst, gen: def.make({ song, rng: root.fork(`make:${def.id}`), inst }) };
    });
    for (const p of this.parts) this.inst(p.inst);
    this.beatSec = 60 / song.bpm;
  }

  private getHall(): GainNode {
    if (!this.hallSend) {
      this.hallSend = this.ctx.createGain();
      this.hallSend.gain.value = this.song.fx?.hall ?? 0.55;
      this.hallSend.connect(this.rig.getHall());
    }
    return this.hallSend;
  }

  private inst(id: InstId): Instrument {
    let i = this.insts.get(id);
    if (!i) { i = createInstrument(id, this.ictx); this.insts.set(id, i); }
    return i;
  }

  /** Total length of one pass of the form, in bars. */
  get length(): number { return this.flat.bars.length; }
  /** Seconds per beat at the tempo of the bar generated last. */
  get beatDur(): number { return this.beatSec; }

  start(at: number): void {
    this.startAt = at;
    this.nextBarTime = at;
    this.started = true;
  }

  // ── fades ─────────────────────────────────────────────────────────────────────────────────────
  fadeIn(at: number, dur: number): void {
    const g = this.mix.gain;
    g.cancelScheduledValues(0);
    g.setValueAtTime(0, at);
    if (dur < 0.06) { g.setValueAtTime(this.level, at + 0.01); this.inEnd = at; return; }
    g.setValueCurveAtTime(powerCurve('in', this.level), at, dur);
    this.inEnd = at + dur;
  }

  fadeOut(at: number, dur: number): void {
    const g = this.mix.gain;
    if (at >= this.inEnd - 0.01) {
      g.cancelScheduledValues(at);
      g.setValueAtTime(this.level, at);
      if (dur < 0.06) g.setValueAtTime(0, at + dur);
      else g.setValueCurveAtTime(powerCurve('out', this.level), at, dur);
    } else {                                    // interrupted mid fade-in: continue from wherever the gain is
      const cur = g.value, now = this.ctx.currentTime;
      g.cancelScheduledValues(0);
      g.setValueAtTime(cur, now);
      g.setTargetAtTime(0, Math.max(now, at), Math.max(0.03, dur / 3.5));
    }
  }

  /** Stop generating at `at`: later bars are never written and queued events at/after it are dropped. */
  stopGen(at: number): void {
    this.genLimit = Math.min(this.genLimit, at);
    if (this.nextBarTime >= this.genLimit) { this.genDone = true; this.endTime = Math.min(this.endTime || at, at); }
    const q = this.queue;
    for (let k = q.length - 1; k >= 0; k--) if (q[k].ts >= at) q.splice(k, 1);
  }

  // ── bar generation ────────────────────────────────────────────────────────────────────────────
  private nextPos(): number {
    const n = this.pos + 1;
    if (n < this.flat.bars.length) return n;
    return this.song.oneShot ? this.pos : this.flat.loopBar;
  }

  private warp(steps: number, swung: boolean): number {
    const sub = this.song.sub;
    const u = steps / sub;
    if (!swung) return u;
    const k = Math.floor(u + 1e-9), f = u - k, s = this.song.swing;
    return k + (f < 0.5 ? f * 2 * s : s + (f - 0.5) * 2 * (1 - s));
  }

  private genBar(): void {
    const song = this.song, bars = this.flat.bars;
    const def = bars[this.pos];
    const nextDef = bars[this.nextPos()];
    const t0 = this.nextBarTime, barNo = this.barNo;
    const bpm = song.bpm * this.tempoMul;
    const beatSec = 60 / bpm, stepSec = beatSec / song.sub;
    const spb = song.beats * song.sub;
    this.beatSec = beatSec;

    const d = this.d;
    const segs = d > 0.3 ? sourSegs(def.segs, d, createRng(hashSeed(this.seed, 'sour', barNo))) : def.segs;
    const swung = song.swing !== 0.5 && (song.sub === 2 || song.sub === 4);
    const humanK = (song.human ?? 1) * 0.006;
    const tmp = this.scratch;
    const base = {
      bar: barNo, idx: this.pos, sec: def.sec, secBar: def.secBar, secLen: def.secLen, phraseBar: def.secBar % 4,
      segs, chord: segs[0].chord, next: nextDef.segs[0].chord, nextSec: nextDef.sec,
      lastOfSec: def.secBar === def.secLen - 1, spb, sub: song.sub, beats: song.beats, stepSec, t0,
      i: this.i, d, energy: def.secLen > 1 ? def.secBar / (def.secLen - 1) : 0,
      key: song.key, scale: this.scale, state: this.state,
      secToStep: (s: number) => s / stepSec,
    };

    for (let pi = 0; pi < this.parts.length; pi++) {
      const part = this.parts[pi];
      const rng = createRng(hashSeed(this.seed, part.def.id, barNo));
      const b: BarCtx = { ...base, rng };
      if (part.def.when && !part.def.when(b)) continue;
      tmp.length = 0;
      const push: Push = (inst, t, dd, m, v, o = 0, x) => {
        tmp.push({ ts: t, ds: dd, m, v, o, x, i: inst, p: pi });
      };
      part.gen(b, push);
      const orn = part.def.orn ?? 0;
      const n = tmp.length;
      for (let k = 0; k < n; k++) {
        const e = tmp[k];
        const sw = swung && !(e.o & RAW);
        const a = this.warp(e.ts, sw), z = this.warp(e.ts + e.ds, sw);
        const ts = t0 + a * beatSec;
        const ds = Math.max(0.02, (z - a) * beatSec);
        const jit = e.m < 0 ? 0 : Math.max(-0.02, Math.min(0.02, this.human.gauss(0, humanK * (e.i === 'drums' ? 0.45 : 1))));
        const ev: QEv = { ts: ts + jit, ds, m: e.m, v: e.v, o: e.o, x: e.x, i: e.i, p: pi };
        this.queue.push(ev);
        if (orn > 0 && e.m > 0 && ds > 0.3 && rng.chance(orn)) {              // grace-note ornament
          this.queue.push({ ts: ts + jit - 0.075, ds: 0.07, m: e.m - rng.pick([1, 2, 2]), v: e.v * 0.55, o: OPT, x: undefined, i: e.i, p: pi });
        }
      }
    }
    this.dirty = true;

    for (let k = 0; k < song.beats; k++) this.beatQ.push({ t: t0 + k * beatSec, bpm, beat: k, bar: barNo });
    if (this.beatQ.length > 64) this.beatQ.splice(0, this.beatQ.length - 64);

    this.nextBarTime = t0 + spb * stepSec;
    this.barNo++;
    const atEnd = song.oneShot && this.pos === bars.length - 1;
    this.pos = this.nextPos();
    if (atEnd) { this.genDone = true; this.endTime = this.nextBarTime; }
    else if (this.nextBarTime >= this.genLimit) { this.genDone = true; this.endTime = this.nextBarTime; }
  }

  // ── pump ──────────────────────────────────────────────────────────────────────────────────────
  /** Generate bars that start before `until` and dispatch every queued event due before `until`. */
  pump(now: number, until: number): void {
    if (this.disposed || !this.started) return;
    if (!this.genDone && this.nextBarTime < now - 0.4) this.nextBarTime = now + 0.05;   // stalled (throttled tab): resync
    let guard = 0;
    while (!this.genDone && this.nextBarTime < until && guard++ < 6) this.genBar();
    const q = this.queue;
    if (this.dirty) { q.sort((a, b) => a.ts - b.ts); this.dirty = false; }
    let n = 0;
    while (n < q.length && q[n].ts < until) this.fire(q[n++], now);
    if (n) q.splice(0, n);
  }

  private fire(e: QEv, now: number): void {
    const part = this.parts[e.p];
    const gate = part.def.gate({ i: this.i, d: this.d, s: this.s });
    if (gate < 0.025) return;
    const inst = this.inst(e.i);
    if (e.m < 0) { inst.duck?.(e.ts, e.v); return; }
    if (e.o & OPT) {
      if (gate < 1 && this.human.next() > gate * 1.25) return;
      if (this.rig.load(now) > VOICE_BUDGET) return;
    }
    if (this.rig.load(now) > HARD_BUDGET && e.i !== 'drums' && e.i !== 'bass' && e.i !== 'tuba' && e.i !== 'synBass') return;
    let ts = e.ts + (part.def.lag ?? 0);
    if (ts < now - 0.03) return;                                  // too late to be musical
    if (ts < now) ts = now;
    const v = e.v * (part.def.vel ?? 1) * Math.pow(gate, 0.7) * (e.o & ACCENT ? 1.12 : 1) * (1 + (this.human.next() - 0.5) * 0.12);
    if (v < 0.04) return;
    this.trace?.(part.def.id, e.i, ts, e.m, e.ds, v);
    inst.play(ts, e.m, e.ds, Math.min(1.25, v), e.x);
  }

  /** Remove beat marks that are due (`t <= upTo`), oldest first. */
  takeBeats(upTo: number): BeatMark | null {
    const q = this.beatQ;
    let last: BeatMark | null = null, n = 0;
    while (n < q.length && q[n].t <= upTo) last = q[n++];
    if (n) q.splice(0, n);
    return last;
  }

  /** Release everything. Notes still ringing are cut. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.queue.length = 0;
    for (const i of this.insts.values()) { try { i.dispose(); } catch { /* noop */ } }
    this.insts.clear();
    for (const n of [this.mix, this.send, this.hallSend]) { try { n?.disconnect(); } catch { /* noop */ } }
  }
}
