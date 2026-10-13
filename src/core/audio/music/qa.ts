/**
 * Offline QA for the composer (CORE-AUDIO / music; dev tooling, never imported by the game). Renders songs, single
 * notes and stingers into an `OfflineAudioContext` and measures them (peak, RMS, per-second loudness, band
 * balance, NaN/DC/clipping), so levels can be checked without ears. Use from the browser dev console:
 *
 *   const qa = await import('/src/core/audio/music/qa.ts');
 *   await qa.validate();                             // charts parse, every generator runs
 *   await qa.renderSong('velvet_ledger', 30);        // { peakDb, rmsDb, perSecond, bands, loadMean, ... }
 *   await qa.renderNote('rhodes', 60);               // patch loudness reference
 *   qa.dumpBars('menu', 0, 4);                       // the notes a song plays, bar by bar
 *   await qa.clickTest('bass', 40); await qa.benchInst('choir', 60); await qa.renderStinger('jackpot');
 *
 * Long renders: the Vite dev server reloads every open page when any agent edits any file, so bundle this file
 * (`vite build` in lib mode, entry = this file) and serve the output statically for sessions longer than a few seconds.
 */
import { Rig } from './rig';
import { Arrangement, flatten } from './sequencer';
import { BEDS } from './songs/beds';
import { JUKEBOX } from './songs/jukebox';
import { createInstrument } from './instruments';
import { Stingers } from './stingers';
import type { InstId, SongDef } from './model';

const SR = 32000;
const db = (x: number): number => 20 * Math.log10(Math.max(1e-9, x));

export interface RenderStats {
  id: string; seconds: number; peakDb: number; rmsDb: number; crest: number; clipped: number; nan: number; dc: number;
  /** RMS in dBFS for each second. */
  perSecond: number[];
  /** Energy share (0..1) in <150 Hz, 150–1200, 1200–5000, >5000 Hz. */
  bands: number[];
  ms: number;
  /** Wall time spent scheduling (JS) and rendering (DSP), ms; render/seconds ≈ audio-thread load at 32 kHz. */
  schedMs?: number; renderMs?: number;
  /** Voice-budget estimate (`rig.load`): mean and max over the render. */
  loadMean?: number; loadMax?: number;
}

const ALL: SongDef[] = [...JUKEBOX.map((e) => e.def), ...Object.values(BEDS)];
export const songs = (): string[] => ALL.map((s) => s.id);
const find = (id: string): SongDef => {
  const s = ALL.find((x) => x.id === id);
  if (!s) throw new Error(`no song "${id}"`);
  return s;
};

/** Every chart parses and every generator runs for a few bars at several intensity / dread settings. */
export async function validate(): Promise<string[]> {
  const out: string[] = [];
  for (const s of ALL) {
    try {
      const f = flatten(s);
      out.push(`${s.id}: ${f.bars.length} bars, ${s.parts.length} parts`);
      const seen = new Set<string>();
      for (const p of s.parts) { if (seen.has(p.id)) out.push(`  !! duplicate part id ${p.id}`); seen.add(p.id); }
      for (const [i, d] of [[0, 0], [0.5, 0.3], [1, 1]]) {
        const ctx = new OfflineAudioContext(2, SR * 2, SR);
        const rig = new Rig(ctx, ctx.destination);
        const arr = new Arrangement(rig, s, { seed: 7 });
        arr.i = i; arr.d = d; arr.start(0.05);
        for (let t = 0; t < 12; t += 0.1) arr.pump(t, t + 0.16);
        arr.dispose(); rig.dispose();
      }
    } catch (e) { out.push(`${s.id}: FAILED ${(e as Error).stack ?? e}`); }
  }
  return out;
}

function analyse(id: string, buf: AudioBuffer, from: number, to: number, ms: number): RenderStats {
  const n = buf.length, l = buf.getChannelData(0), r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const a = Math.max(0, Math.floor(from * buf.sampleRate)), b = Math.min(n, Math.floor(to * buf.sampleRate));
  let peak = 0, sum = 0, clipped = 0, nan = 0, dc = 0;
  const secN = buf.sampleRate, per: number[] = [];
  let secSum = 0, secCount = 0;
  const lp1 = [0, 0], lp2 = [0, 0], lp3 = [0, 0];
  const e = [0, 0, 0, 0];
  const k1 = 1 - Math.exp((-2 * Math.PI * 150) / buf.sampleRate), k2 = 1 - Math.exp((-2 * Math.PI * 1200) / buf.sampleRate), k3 = 1 - Math.exp((-2 * Math.PI * 5000) / buf.sampleRate);
  for (let i = a; i < b; i++) {
    const x = (l[i] + r[i]) * 0.5;
    if (x !== x) { nan++; continue; }
    const ax = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (ax > peak) peak = ax;
    if (ax >= 0.999) clipped++;
    sum += x * x; dc += x; secSum += x * x; secCount++;
    lp1[0] += (x - lp1[0]) * k1; lp2[0] += (x - lp2[0]) * k2; lp3[0] += (x - lp3[0]) * k3;
    const b0 = lp1[0], b1 = lp2[0] - lp1[0], b2 = lp3[0] - lp2[0], b3 = x - lp3[0];
    e[0] += b0 * b0; e[1] += b1 * b1; e[2] += b2 * b2; e[3] += b3 * b3;
    if (secCount >= secN) { per.push(Math.round(db(Math.sqrt(secSum / secCount)) * 10) / 10); secSum = 0; secCount = 0; }
  }
  const cnt = Math.max(1, b - a), tot = e[0] + e[1] + e[2] + e[3] || 1;
  const rms = Math.sqrt(sum / cnt);
  return {
    id, seconds: (b - a) / buf.sampleRate, peakDb: Math.round(db(peak) * 10) / 10, rmsDb: Math.round(db(rms) * 10) / 10,
    crest: Math.round((db(peak) - db(rms)) * 10) / 10, clipped, nan, dc: Math.round((dc / cnt) * 1e5) / 1e5,
    perSecond: per, bands: e.map((v) => Math.round((v / tot) * 100) / 100), ms: Math.round(ms),
  };
}

export interface RenderOpts { intensity?: number; dread?: number; seed?: number; skip?: number; tempoMul?: number; /** Part ids to keep (all others muted). */ only?: string[]; /** Part ids to mute. */ mute?: string[]; /** Rig `liveDetuneMin` override (0 = every note wired to the live detune source). */ liveDetuneMin?: number; /** Cut the room / hall reverb to see what they cost. */ noRoom?: boolean; noHall?: boolean }

/** Render `seconds` of a song through the real rig (trim/tone/reverb/wobble); the master chain is not included. */
export async function renderSong(id: string, seconds = 30, o: RenderOpts = {}): Promise<RenderStats> {
  const base = find(id);
  const song = o.only || o.mute ? { ...base, parts: base.parts.filter((p) => (o.only ? o.only.includes(p.id) : true) && !(o.mute ?? []).includes(p.id)) } : base;
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, Math.floor(SR * (seconds + 1.5)), SR);
  const rig = new Rig(ctx, ctx.destination);
  if (o.liveDetuneMin !== undefined) rig.liveDetuneMin = o.liveDetuneMin;
  if (o.noRoom) rig.sendRoom.disconnect();
  if (o.noHall) { const dead = ctx.createGain(); rig.getHall = () => dead; }
  const arr = new Arrangement(rig, song, { seed: o.seed ?? 12345, state: 'lounge' });
  const i = o.intensity ?? (JUKEBOX.some((e) => e.def.id === id) ? 0.9 : 0.6);
  arr.i = Math.max(i, song.iFloor ?? 0); arr.d = Math.max(o.dread ?? 0, song.dFloor ?? 0);
  arr.tempoMul = song.tempoFollowsIntensity ? 1 + 0.1 * arr.i : 1;
  rig.setLook(arr.d, song.fx, 0);
  arr.start(0.05); arr.fadeIn(0.05, 0.05);
  let lm = 0, lx = 0, ln = 0;
  for (let t = 0; t < seconds; t += 0.1) {
    arr.pump(t, t + 0.16);
    if (t > 2) { const l = rig.load(t); lm += l; ln++; if (l > lx) lx = l; }
  }
  const t1 = performance.now();
  const buf = await ctx.startRendering();
  const stats = analyse(id, buf, o.skip ?? 2, seconds, performance.now() - t0);
  stats.loadMean = Math.round(lm / Math.max(1, ln)); stats.loadMax = lx; stats.schedMs = Math.round(t1 - t0); stats.renderMs = Math.round(performance.now() - t1);
  arr.dispose(); rig.dispose();
  return stats;
}

/** Render one note of a patch: peak and RMS over the note, for balancing patches against each other. */
export async function renderNote(inst: InstId, midi: number, vel = 0.7, dur = 1): Promise<RenderStats> {
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, Math.floor(SR * (dur + 3)), SR);
  const rig = new Rig(ctx, ctx.destination);
  const mix = ctx.createGain(); mix.connect(rig.input);
  const send = ctx.createGain(); send.connect(rig.sendRoom);
  const hall = ctx.createGain(); hall.connect(rig.getHall());
  const i = createInstrument(inst, { rig, ctx, dest: mix, send, hall: () => hall, beat: () => 0.5 });
  i.play(0.1, midi, dur, vel);
  const buf = await ctx.startRendering();
  const s = analyse(`${inst}@${midi}`, buf, 0.1, dur + 0.6, performance.now() - t0);
  i.dispose(); rig.dispose();
  return s;
}

const NOTE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nn = (m: number): string => (m > 0 ? `${NOTE[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}` : `#${m}`);

/** Text dump of the notes a song plays in bars [from, from + count): one line per note, grouped by bar. */
export function dumpBars(id: string, from = 0, count = 2, o: RenderOpts = {}): string {
  const song = find(id);
  const ctx = new OfflineAudioContext(2, SR * 2, SR);
  const rig = new Rig(ctx, ctx.destination);
  const arr = new Arrangement(rig, song, { seed: o.seed ?? 12345 });
  arr.i = Math.max(o.intensity ?? 0.9, song.iFloor ?? 0); arr.d = Math.max(o.dread ?? 0, song.dFloor ?? 0);
  const rows: Array<{ t: number; s: string }> = [];
  arr.trace = (part, inst, t, m, d, v) => rows.push({ t, s: `${inst.padEnd(8)} ${part.padEnd(12)} ${nn(m).padEnd(4)} d${d.toFixed(2)} v${v.toFixed(2)}` });
  arr.start(0);
  const barSec = (60 / song.bpm) * song.beats;
  const end = (from + count) * barSec + 0.5;
  for (let t = 0; t < end; t += 0.1) arr.pump(t, t + 0.16);
  arr.dispose(); rig.dispose();
  const out: string[] = [];
  for (const r of rows.sort((a, b) => a.t - b.t)) {
    const bar = Math.floor(r.t / barSec);
    if (bar < from || bar >= from + count) continue;
    out.push(`bar ${bar} beat ${(((r.t / barSec) % 1) * song.beats).toFixed(2)}  ${r.s}`);
  }
  return out.join('\n');
}

/** DSP cost of a patch: 60 notes (4/s, 0.8 s long) rendered offline; ms of render time per note (lower is cheaper). */
export async function benchInst(inst: InstId, midi = 60): Promise<number> {
  let best = Infinity;
  for (let rep = 0; rep < 2; rep++) {
    const ctx = new OfflineAudioContext(2, SR * 18, SR);
    const rig = new Rig(ctx, ctx.destination);
    const mix = ctx.createGain(); mix.connect(rig.input);
    const send = ctx.createGain(); send.connect(rig.sendRoom);
    const hall = ctx.createGain(); hall.connect(rig.getHall());
    const i = createInstrument(inst, { rig, ctx, dest: mix, send, hall: () => hall, beat: () => 0.5 });
    for (let n = 0; n < 60; n++) i.play(0.1 + n * 0.25, midi + (n % 5), 0.8, 0.7);
    const t0 = performance.now();
    await ctx.startRendering();
    best = Math.min(best, (performance.now() - t0 - 130 * 1.8) / 60);
    i.dispose(); rig.dispose();
  }
  return Math.round(best * 100) / 100;
}

/** Dry (no reverb / rig) render of one note, scanned in 5 ms frames for abrupt level jumps (clicks, hard cut-offs). */
export async function clickTest(inst: InstId, midi: number, dur = 0.7): Promise<string> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * (dur + 3.5)), SR);
  const rig = new Rig(ctx, ctx.createGain());
  const hall = ctx.createGain(), send = ctx.createGain();
  const i = createInstrument(inst, { rig, ctx, dest: ctx.destination, send, hall: () => hall, beat: () => 0.5 });
  i.play(0.1, midi, dur, 0.8);
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0), f = Math.floor(SR * 0.005), n = Math.floor(x.length / f);
  const rms: number[] = [];
  for (let k = 0; k < n; k++) { let a = 0; for (let j = 0; j < f; j++) a += x[k * f + j] ** 2; rms.push(Math.sqrt(a / f)); }
  const peak = Math.max(...rms), hits: string[] = [];
  for (let k = 3; k < n; k++) {
    if (k * f / SR < 0.1 + 0.03) continue;                       // the attack itself
    const a = rms[k - 1], b = rms[k];
    if (Math.max(a, b) > peak * 0.02 && Math.max(a, b) > 6 * Math.min(a, b) + 1e-4) hits.push(`${(k * f / SR).toFixed(3)}s ${db(a).toFixed(0)}→${db(b).toFixed(0)}dB`);
  }
  i.dispose(); rig.dispose();
  return `${inst}@${midi}: ${hits.length ? hits.slice(0, 6).join(', ') : 'clean'}`;
}

/** Render a stinger on its own through the stinger bus. */
export async function renderStinger(id: string, seconds = 5): Promise<RenderStats> {
  const t0 = performance.now();
  const ctx = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
  const rig = new Rig(ctx, ctx.destination);
  const st = new Stingers(rig, { detune: () => undefined });
  st.play(id, 0.1);
  const buf = await ctx.startRendering();
  const s = analyse(`stinger:${id}`, buf, 0.1, seconds, performance.now() - t0);
  st.dispose(); rig.dispose();
  return s;
}

/** Mono 16-bit WAV bytes of a render (base64), for listening outside the game. */
export async function renderWav(id: string, seconds = 30, o: RenderOpts = {}): Promise<string> {
  const song = find(id);
  const ctx = new OfflineAudioContext(2, Math.floor(SR * (seconds + 1.5)), SR);
  const rig = new Rig(ctx, ctx.destination);
  const arr = new Arrangement(rig, song, { seed: o.seed ?? 12345 });
  arr.i = Math.max(o.intensity ?? 0.9, song.iFloor ?? 0); arr.d = Math.max(o.dread ?? 0, song.dFloor ?? 0);
  rig.setLook(arr.d, song.fx, 0);
  arr.start(0.05); arr.fadeIn(0.05, 0.05);
  for (let t = 0; t < seconds; t += 0.1) arr.pump(t, t + 0.16);
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0), n = buf.length, bytes = new Uint8Array(44 + n * 2), dv = new DataView(bytes.buffer);
  const w = (o2: number, s: string): void => { for (let k = 0; k < s.length; k++) dv.setUint8(o2 + k, s.charCodeAt(k)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) dv.setInt16(44 + k * 2, Math.max(-1, Math.min(1, l[k])) * 32767, true);
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  arr.dispose(); rig.dispose();
  return btoa(bin);
}
