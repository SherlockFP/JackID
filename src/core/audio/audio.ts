/**
 * Audio engine — owned by CORE-AUDIO. Implements the frozen `AudioEngine` (types.ts, TECH_SPEC §2.5).
 *
 *   voice → [panner → distance fade] → bus (user volume → duck) → master → compressor(−12 dB, 4:1)
 *         → lowpass 11 kHz (muffle sweeps it to 600 Hz) → destination
 *   sfx + amb buses also feed a generated 1.8 s reverb at 0.15; the PA voice adds a spring tank.
 *
 * Pieces: voice pool (32, steal lowest priority then oldest) · recipes (`sfx.ts`) run on a per-voice {@link Kit} ·
 * loops are scheduled chunk-by-chunk with lookahead · pitch/slow-motion reach live voices through one
 * ConstantSource per voice wired into every `detune` · ducking is a set of holds per bus · ambience beds crossfade ·
 * `voice.speak` and `blip` play typewriter blips in each speaker's voice (`blip.ts`) · Kenney samples are decoded once into
 * `sampleStore` · the adaptive score is plugged in from `music.ts` when that file exists (see {@link MusicHost}).
 *
 * Extras for tooling: `renderSfx` / `renderSpeech` (OfflineAudioContext renders for loudness checks) and `sfxNames`.
 */
import type * as THREE from 'three';
import type {
  AmbienceId, AudioEngine, BeatEvent, Bus, JukeboxTrack, MusicApi, MusicStateId, PlayOpts, SfxRecipe, SfxRegisterMeta, SpeakOpts,
  Voice, VoiceApi, VoiceSpeaker,
} from './types';
import type { Unsub } from '../types';
import type { WinTier } from '@/game/types';
import { log } from '../log';
import { clamp, smoothstep } from '../math';
import { createRng, randomSeed } from '../rng';
import {
  Kit, arng, createNoiseBank, makeImpulse, makeSpringImpulse, rnd, sampleStore,
  type KitHost, type NoiseBank,
} from './synth';
import {
  SAMPLE_URLS, SFX_DEFS, buildAmbience, coinCascade, winSfx, type AmbBed, type SfxDef,
} from './sfx';
import { blipVoiceFor, charEvent, planBlips, renderBlips, scheduleBlip } from './blip';
import { wireGambleFx } from './gambleFx';
import { WARM_URLS, horrorForStinger, setAudioCalm } from './real';

const MAX_VOICES = 32;
const BUSES: readonly Bus[] = ['sfx', 'ui', 'music', 'amb', 'voice'];
const REVERB_SEND = 0.15;
/** Room-tone level of ambience beds: they are built from full-scale noise, so this lands them near −26 dBFS RMS. */
const AMB_BED_LEVEL = 0.35;
const MUFFLE_OPEN = 11000, MUFFLE_CLOSED = 600;
const REF_DIST = 1.5, ROLLOFF = 1.4, MAX_DIST = 30, FADE_FROM = 22;
const LOOKAHEAD = 0.2, PUMP_MS = 33;
const TAU = Math.PI * 2;
/** Slider (0..1) → gain: squared taper so the middle of the slider is roughly half as loud. */
const taper = (v: number): number => { const x = clamp(v, 0, 1.5); return x * x; };

/**
 * What the adaptive score receives. `music/index.ts` exports `createMusic(host: MusicHost): MusicApi` and is wired here
 * (eagerly, via glob). If it is missing or throws, a state-tracking silent fallback is used and the error is logged.
 * Route ALL music audio into `host.out`; the score keeps stingers on their own un-ducked bus (see `music/rig.ts`).
 * `createKit` / `makeImpulse` / `createNoiseBank` in `synth.ts` are free to import.
 */
export interface MusicHost {
  readonly ctx: AudioContext;
  /** Music bus input — user volume, ducking and the master chain apply downstream. */
  readonly out: AudioNode;
  /** Shared reverb send input (generated IR, post-bus); send as much as you like. */
  readonly reverb: AudioNode;
  readonly noise: NoiseBank;
  /** The engine itself: play sfx stingers, duck other buses, sample the House voice state, … */
  readonly engine: AudioEngine;
}
type MusicFactory = (host: MusicHost, ...rest: unknown[]) => MusicApi;
const musicModules = import.meta.glob<{ createMusic?: MusicFactory }>('./music/index.ts', { eager: true });

function createFallbackMusic(): MusicApi {
  let state: MusicStateId = 'silent', current: string | null = null;
  const beat: BeatEvent = { bpm: 90, beat: 0, bar: 0, phase: 0 };
  return {
    setState(s) { state = s; }, get state() { return state; },
    setIntensity() {}, setDread() {}, setZone() {}, stinger() {}, setSeed() {},
    beat, onBeat(): Unsub { return () => {}; },
    play(id) { current = id; }, stop() { current = null; }, get current() { return current; },
    tracks: () => [], catalog: (): readonly JukeboxTrack[] => [],
  };
}

/** Engine used when the browser has no WebAudio at all: every call is a no-op. */
function createSilentAudio(): AudioEngine {
  return {
    ctx: null as unknown as AudioContext, resume: () => Promise.resolve(), setVolume() {}, play: () => null, register() {},
    winJingle() {}, coins() {}, ambience() {}, music: createFallbackMusic(), voice: { speak: () => Promise.resolve(), stop() {}, speaking: false },
    setListener() {}, voices: 0, loadSamples: () => Promise.resolve(), setMuffle() {}, setTimeScale() {}, duck() {}, blip() {},
  };
}

interface Hold { amount: number; until: number }
interface Pos { x: number; y: number; z: number }
type Follow = { matrixWorld: { elements: ArrayLike<number> } };

export function createAudio(volumes: Record<Bus | 'master', number>): AudioEngine {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext;
  try {
    if (!Ctor) throw new Error('no AudioContext');
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch (e) {
    log.error('audio', 'WebAudio unavailable — running silent', e);
    return createSilentAudio();
  }
  const noise = createNoiseBank(ctx.sampleRate);

  // ── graph ──
  const master = ctx.createGain();
  master.gain.value = taper(volumes.master);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.22;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = MUFFLE_OPEN; lp.Q.value = 0.7;
  master.connect(comp); comp.connect(lp); lp.connect(ctx.destination);

  const busIn = {} as Record<Bus, GainNode>, busDuck = {} as Record<Bus, GainNode>;
  for (const b of BUSES) {
    busIn[b] = ctx.createGain(); busIn[b].gain.value = taper(volumes[b]);
    busDuck[b] = ctx.createGain();
    busIn[b].connect(busDuck[b]); busDuck[b].connect(master);
  }
  const reverbIn = ctx.createGain(), convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx.sampleRate, 1.8);
  reverbIn.connect(convolver); convolver.connect(master);
  for (const b of ['sfx', 'amb'] as const) { const s = ctx.createGain(); s.gain.value = REVERB_SEND; busDuck[b].connect(s); s.connect(reverbIn); }
  const springIn = ctx.createGain(), spring = ctx.createConvolver();
  spring.buffer = makeSpringImpulse(ctx.sampleRate);
  springIn.connect(spring); spring.connect(busIn.voice);

  // ── state ──
  const active: VoiceImpl[] = [];
  const custom = new Map<string, SfxDef>();
  const rate = new Map<string, { t: number; n: number }>();
  const holds = {} as Record<Bus, Set<Hold>>;
  const duckTarget = {} as Record<Bus, number>;
  for (const b of BUSES) { holds[b] = new Set(); duckTarget[b] = 1; }
  const utterances = new Set<VoiceImpl>();
  let tsCents = 0;
  let lx = 0, ly = 0, lz = 0, listenerSet = false;
  let ambWant: AmbienceId | null = null;
  let ambCur: { id: AmbienceId; bed: AmbBed; fade: GainNode } | null = null;
  const lis = ctx.listener;
  const lisLegacy = 'positionX' in lis ? null : (lis as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(...a: number[]): void });

  // ── samples ──
  const loading = new Map<string, Promise<void>>();
  function loadOne(url: string): Promise<void> {
    if (sampleStore.has(url)) return Promise.resolve();
    let p = loading.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { sampleStore.set(url, buf); loading.delete(url); })
        .catch((e) => { log.warnOnce(`audio:sample:${url}`, 'audio', `sample unavailable (${url}) — synth layers only`, e); });
      loading.set(url, p);
    }
    return p;
  }
  const loadSamples = (urls: string[]): Promise<void> => Promise.all(urls.map(loadOne)).then((): void => {});

  // ── ducking: every bus has a set of holds; the deepest one wins ──
  function applyDuck(bus: Bus): void {
    const now = ctx.currentTime;
    let amt = 0;
    for (const h of holds[bus]) { if (h.until <= now) holds[bus].delete(h); else if (h.amount > amt) amt = h.amount; }
    const target = 1 - clamp(amt, 0, 0.98);
    busDuck[bus].gain.setTargetAtTime(target, now, target < duckTarget[bus] ? 0.03 : 0.22);
    duckTarget[bus] = target;
  }
  function addHold(bus: Bus, amount: number, dur: number): Hold {
    const h: Hold = { amount, until: dur === Infinity ? Infinity : ctx.currentTime + dur };
    holds[bus].add(h); applyDuck(bus);
    return h;
  }
  function releaseHold(bus: Bus, h: Hold): void { holds[bus].delete(h); applyDuck(bus); }

  // ── voices ──
  class VoiceImpl implements Voice, KitHost {
    playing = true;
    readonly ctx = ctx;
    readonly noise = noise;
    readonly gain: GainNode;
    readonly born = ctx.currentTime;
    panner: PannerNode | null = null;
    dist: GainNode | null = null;
    follow: Follow | null = null;
    loopRun: ((t: number) => number) | null = null;
    nextT = 0;
    deadline = Infinity;
    killAt = 0;
    sealed = false;
    stopping = false;
    onFinish: (() => void) | null = null;
    private cs: ConstantSourceNode | null = null;
    private readonly srcs = new Set<AudioScheduledSourceNode>();
    private pending = 0;
    private semis: number;
    private distValue = 1;
    private readonly trim: number;
    private vol: number;

    constructor(readonly name: string, readonly bus: Bus, readonly priority: number, vol: number, trim: number, semis: number, wire: boolean) {
      this.vol = vol; this.trim = trim; this.semis = semis;
      this.gain = ctx.createGain();
      this.gain.gain.value = vol * trim;
      if (wire || semis !== 0) this.wire();
    }
    get pitch(): AudioNode | null { return this.cs; }
    private get rated(): boolean { return this.bus !== 'music'; }
    private wire(): void {
      if (this.cs) return;
      this.cs = ctx.createConstantSource();
      this.cs.offset.value = this.cents();
      this.cs.start();
    }
    private cents(): number { return this.semis * 100 + (this.rated ? tsCents : 0); }
    /** Slow-motion changed: retarget a wired voice (voices started while unwired keep playing at normal speed). */
    applyRate(ramp: number): void { this.cs?.offset.setTargetAtTime(this.cents(), ctx.currentTime, Math.max(0.005, ramp / 3)); }

    sample(url: string): AudioBuffer | null {
      const b = sampleStore.get(url);
      if (!b && !loading.has(url)) void loadOne(url);
      return b ?? null;
    }
    track(src: AudioScheduledSourceNode): void {
      this.srcs.add(src); this.pending++;
      src.onended = () => {
        src.onended = null; this.srcs.delete(src);
        try { src.disconnect(); } catch { /* already disconnected */ }
        if (--this.pending <= 0 && this.sealed && !this.loopRun) this.finalize();
      };
    }
    /** The recipe has finished scheduling; a voice that started nothing is released immediately. */
    seal(): void { this.sealed = true; if (!this.loopRun && this.pending <= 0) this.finalize(); }

    addSend(target: AudioNode, level: number): void {
      const s = ctx.createGain();
      s.gain.value = level; this.gain.connect(s); s.connect(target);
    }
    place(bus: AudioNode, pos: Pos | null, follow: Follow | null): void {
      if (!pos) { this.gain.connect(bus); return; }
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = REF_DIST; p.rolloffFactor = ROLLOFF; p.maxDistance = MAX_DIST;
      this.panner = p; this.dist = ctx.createGain(); this.follow = follow;
      this.setPos(pos.x, pos.y, pos.z);
      this.gain.connect(p); p.connect(this.dist); this.dist.connect(bus);
    }
    private setPos(x: number, y: number, z: number): void {
      const p = this.panner!;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
      const dx = x - lx, dy = y - ly, dz = z - lz;
      const g = listenerSet ? 1 - smoothstep(FADE_FROM, MAX_DIST, Math.sqrt(dx * dx + dy * dy + dz * dz)) : 1;
      if (Math.abs(g - this.distValue) > 0.02) { this.distValue = g; this.dist!.gain.setTargetAtTime(g, ctx.currentTime, 0.05); }
    }
    /** ~30 Hz: moving emitters re-aim their panner; everything positional re-evaluates the distance fade. */
    updateSpatial(): void {
      if (!this.panner) return;
      if (this.follow) { const e = this.follow.matrixWorld.elements; this.setPos(e[12], e[13], e[14]); }
      else { const p = this.panner; this.setPos(p.positionX.value, p.positionY.value, p.positionZ.value); }
    }

    runChunk(): void {
      const t = this.nextT;
      let dur = 0.1;
      try { dur = this.loopRun!(t); } catch (e) { log.warn('audio', `loop recipe "${this.name}" failed`, e); this.stop(0.01); return; }
      this.nextT = t + Math.max(0.05, dur);
    }

    stop(fade = 0.05): void {
      if (!this.playing || this.stopping) return;
      this.stopping = true; this.loopRun = null;
      if (fade <= 0.001) { this.finalize(); return; }
      const now = ctx.currentTime;
      this.gain.gain.setTargetAtTime(0, now, fade / 4);
      this.killAt = now + fade + 0.03;
    }
    setPitch(semi: number): void {
      this.semis = semi;
      if (semi !== 0) this.wire();
      this.cs?.offset.setTargetAtTime(this.cents(), ctx.currentTime, 0.02);
    }
    setVol(v: number): void { if (this.stopping) return; this.vol = v; this.gain.gain.setTargetAtTime(v * this.trim, ctx.currentTime, 0.015); }
    /** Release every node; idempotent. */
    finalize(): void {
      if (!this.playing) return;
      this.playing = false; this.loopRun = null;
      for (const s of this.srcs) { s.onended = null; try { s.stop(); } catch { /* never started / already stopped */ } }
      this.srcs.clear();
      if (this.cs) { try { this.cs.stop(); } catch { /* ignore */ } this.cs.disconnect(); }
      this.gain.disconnect(); this.panner?.disconnect(); this.dist?.disconnect();
      const i = active.indexOf(this);
      if (i >= 0) active.splice(i, 1);
      const f = this.onFinish; this.onFinish = null;
      f?.();
    }
  }

  const liveCount = (): number => { let n = 0; for (const v of active) if (!v.stopping) n++; return n; };
  /** Make room for a voice of priority `pri`; false = every playing voice outranks it. */
  function reserveSlot(pri: number): boolean {
    if (liveCount() < MAX_VOICES) return true;
    let victim: VoiceImpl | null = null;
    for (const v of active) {
      if (v.stopping) continue;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.born < victim.born)) victim = v;
    }
    if (!victim || victim.priority > pri) return false;
    victim.stop(0.015);
    return true;
  }
  function allow(name: string, max: number, now: number): boolean {
    let r = rate.get(name);
    if (!r || now - r.t > 0.1) { r = { t: now, n: 0 }; rate.set(name, r); }
    return ++r.n <= max;
  }
  function resolvePos(p: NonNullable<PlayOpts['pos']>): { pos: Pos; follow: Follow | null } {
    if ('matrixWorld' in p) { const e = p.matrixWorld.elements; return { pos: { x: e[12], y: e[13], z: e[14] }, follow: p }; }
    return { pos: { x: p.x, y: p.y, z: p.z }, follow: null };
  }
  /** Create a pooled voice routed to its bus (positional if `pos`). Null if culled or out-ranked. */
  function openVoice(name: string, bus: Bus, pri: number, vol: number, trim: number, o: PlayOpts, long: boolean): VoiceImpl | null {
    let place: { pos: Pos; follow: Follow | null } | null = null;
    if (o.pos) {
      place = resolvePos(o.pos);
      if (listenerSet && !o.loop) {
        const dx = place.pos.x - lx, dy = place.pos.y - ly, dz = place.pos.z - lz;
        if (dx * dx + dy * dy + dz * dz > MAX_DIST * MAX_DIST) return null;
      }
    }
    if (!reserveSlot(pri)) return null;
    const v = new VoiceImpl(name, bus, pri, vol, trim, o.pitch ?? 0, !!o.loop || long || (bus !== 'music' && tsCents !== 0));
    v.place(busIn[bus], place?.pos ?? null, place?.follow ?? null);
    active.push(v);
    return v;
  }

  function playDef(name: string, d: SfxDef, o: PlayOpts): Voice | null {
    if (o.param !== undefined) o = { ...o, param: Number.isFinite(o.param) ? clamp(o.param, 0, 1) : 0.5 };
    if (ctx.state !== 'running') return null;
    const now = ctx.currentTime, pri = o.priority ?? d.meta.pri ?? 5;
    if (!o.loop && pri < 9 && !allow(name, d.meta.max ?? 5, now)) return null;
    const v = openVoice(name, o.bus ?? d.meta.bus ?? 'sfx', pri, clamp(o.vol ?? 1, 0, 2), d.meta.gain ?? 1, o, !!d.meta.long);
    if (!v) return null;
    const t = now + 0.005;
    let dur: number;
    try { dur = d.run(new Kit(v, v.gain, t), o); } catch (e) {
      log.warn('audio', `recipe "${name}" failed`, e); v.finalize(); return null;
    }
    if (o.loop) { v.loopRun = (at) => d.run(new Kit(v, v.gain, at), o); v.nextT = t + Math.max(0.05, dur); }
    else v.deadline = t + dur * 4 + 3;
    v.seal();
    return v.playing ? v : null;
  }
  const lookup = (name: string): SfxDef | undefined => custom.get(name) ?? SFX_DEFS.get(name);
  // Unlock queue: UI feedback requested before the first user gesture (browsers keep the context suspended) is kept
  // for a moment and replayed once audio runs, so the first click or menu blip is not lost.
  const UNLOCK_MAX = 6, UNLOCK_TTL_MS = 3000;
  const unlockQueue: Array<{ name: string; o: PlayOpts; t: number }> = [];
  function play(name: string, o: PlayOpts = {}): Voice | null {
    const d = lookup(name);
    if (!d) { log.warnOnce(`audio:missing:${name}`, 'audio', `no sfx recipe "${name}"`); return null; }
    if (ctx.state !== 'running') {
      if ((o.bus ?? d.meta.bus ?? 'sfx') === 'ui' && unlockQueue.length < UNLOCK_MAX) unlockQueue.push({ name, o, t: performance.now() });
      return null;
    }
    return playDef(name, d, o);
  }
  function flushUnlockQueue(): void {
    const now = performance.now();
    for (const q of unlockQueue.splice(0)) {
      const d = lookup(q.name);
      if (d && now - q.t <= UNLOCK_TTL_MS) playDef(q.name, d, q.o);
    }
  }

  /** Housekeeping at ~30 Hz: loop chunks, expiries, ducks, spatial updates. */
  function pump(): void {
    const now = ctx.currentTime;
    for (let i = active.length - 1; i >= 0; i--) {
      const v = active[i];
      if (!v) continue;
      if (v.killAt && now >= v.killAt) { v.finalize(); continue; }
      if (v.loopRun) {
        if (v.nextT < now) v.nextT = now + 0.01;                               // stalled (throttled tab / long frame): resync, never clump
        for (let g = 0; g < 4 && v.loopRun && v.nextT < now + LOOKAHEAD; g++) v.runChunk();
      }
      else if (now > v.deadline) { v.finalize(); continue; }
      v.updateSpatial();
    }
    for (const b of BUSES) for (const h of holds[b]) if (h.until <= now) { applyDuck(b); break; }
  }
  const pumpId = window.setInterval(pump, PUMP_MS);
  import.meta.hot?.dispose(() => { clearInterval(pumpId); void ctx.close(); });

  // ── ambience ──
  function eventPos(dist: [number, number]): Pos {
    const a = arng.next() * TAU, d = rnd(dist[0], dist[1]);
    return { x: lx + Math.cos(a) * d, y: ly, z: lz + Math.sin(a) * d };
  }
  function applyAmbience(fade: number): void {
    if ((ambCur?.id ?? null) === ambWant) return;
    const now = ctx.currentTime, old = ambCur;
    if (old) {
      old.fade.gain.setTargetAtTime(0, now, fade / 4);
      window.setTimeout(() => { old.bed.stop(); old.fade.disconnect(); }, fade * 1000 + 400);
    }
    ambCur = null;
    if (ambWant) {
      const g = ctx.createGain();
      g.gain.value = 0; g.gain.setTargetAtTime(AMB_BED_LEVEL, now, fade / 4); g.connect(busIn.amb);
      const bed = buildAmbience(ambWant, {
        ctx, out: g, noise,
        sample: (url) => { const b = sampleStore.get(url); if (!b) void loadOne(url); return b ?? null; },
        event: (name, o = {}) => { void play(name, { bus: 'amb', vol: o.vol, pitch: o.pitch, param: o.param, pos: eventPos(o.dist ?? [6, 18]) as unknown as THREE.Vector3 }); },
      });
      ambCur = { id: ambWant, bed, fade: g };
    }
  }

  // ── speech: typewriter blips in the speaker's own voice (no spoken words) ──
  function speak(o: SpeakOpts): Promise<void> {
    const speaker = o.speaker ?? 'house', bv = blipVoiceFor(speaker), mood = o.mood ?? 'calm';
    const plan = planBlips(o.text, bv, { mood, pitch: o.pitch, rng: createRng(o.seed ?? randomSeed()) });
    const pace = (): Promise<void> => new Promise((r) => window.setTimeout(r, plan.duration * 1000));
    if (ctx.state !== 'running') return pace();                                   // keep pacing while muted
    const diegetic = !!o.pos;
    if (!diegetic) for (const u of utterances) if (!u.panner) u.stop(0.08);      // one line at a time on the non-positional channel
    const v = openVoice(`speak:${speaker}`, 'voice', 9, 1, 1, { pos: o.pos }, true);
    if (!v) return pace();
    const t0 = ctx.currentTime + 0.02;
    const ducking = o.duck !== false;                                              // opt-out: plays over the score
    const hm = ducking ? addHold('music', mood === 'whisper' ? 0.2 : 0.35, Infinity) : null;
    renderBlips(v, v.gain, plan, bv, t0);
    v.deadline = t0 + plan.duration + 3; v.seal();
    utterances.add(v);
    return new Promise<void>((resolve) => {
      v.onFinish = () => {
        utterances.delete(v);
        if (hm) releaseHold('music', hm);
        resolve();
      };
    });
  }
  /** One typewriter blip for a typed character (dialogue box). Silent for non-letters; at most 14 per 100 ms. */
  function blip(speaker: VoiceSpeaker, ch: string, o: { pos?: THREE.Object3D; vol?: number } = {}): void {
    if (ctx.state !== 'running') return;
    const bv = blipVoiceFor(speaker), e = charEvent(bv, ch), now = ctx.currentTime;
    if (!e || !allow('blip', 14, now)) return;
    const v = openVoice(`blip:${speaker}`, 'voice', 4, 1, 1, o.pos ? { pos: o.pos } : {}, false);
    if (!v) return;
    scheduleBlip(v, v.gain, now + 0.005, bv, { semis: e.semis, vowel: e.vowel, vol: clamp(o.vol ?? 1, 0, 2) });
    v.deadline = now + 1; v.seal();
  }
  const voice: VoiceApi = {
    speak,
    stop() { for (const u of [...utterances]) u.stop(0.08); },
    get speaking() { return utterances.size > 0; },
  };

  let musicProxy: MusicApi | null = null, musicProxyOf: MusicApi | null = null;   // stinger wrapper cache (musicWrapped)
  // ── public engine ──
  const engine: AudioEngine = {
    ctx,
    async resume() {
      if (ctx.state !== 'running') {
        await ctx.resume().catch((e) => log.warn('audio', 'resume failed', e));
        const b = ctx.createBufferSource();            // iOS: a silent tick unlocks output
        b.buffer = ctx.createBuffer(1, 1, 22050); b.connect(ctx.destination); b.start(0);
      }
      if (ctx.state === 'running') onRunning();   // idempotent; statechange may already have run it
    },
    setVolume(bus, v) {
      const g = bus === 'master' ? master : busIn[bus];
      if (!g) return;
      if (ctx.state === 'running') g.gain.setTargetAtTime(taper(v), ctx.currentTime, 0.03); else g.gain.value = taper(v);
    },
    play,
    register(name, recipe: SfxRecipe, meta: SfxRegisterMeta = {}) { custom.set(name, { run: recipe, meta: { ...meta } }); },
    winJingle(tier: WinTier, o: PlayOpts = {}) {
      const n = winSfx(tier);
      if (!n) return;
      play(n, o);
      if (tier === 'big') { addHold('music', 0.4, 1.8); void play('cheer', { param: 0.4, vol: 0.6 }); }
      else if (tier === 'huge') { addHold('music', 0.5, 3.2); void play('cheer', { param: 0.7, vol: 0.8 }); }
      else if (tier === 'mega') { addHold('music', 0.6, 4.2); void play('cheer', { param: 0.9, vol: 0.9 }); }
      else if (tier === 'jackpot') { addHold('music', 0.65, 5.5); void play('cheer', { param: 1, vol: 1 }); }
    },
    coins(n: number, o: PlayOpts = {}) { playDef('coins', { run: coinCascade(n), meta: { pri: 4, max: 4, gain: 1 } }, o); },
    ambience(id, fade = 1.5) { ambWant = id; if (ctx.state === 'running') applyAmbience(fade); },
    get music() { return musicWrapped(); },
    setCalm(on: boolean) { setAudioCalm(on); },
    voice,
    setListener(cam: THREE.Camera) {
      const e = cam.matrixWorld.elements;
      lx = e[12]; ly = e[13]; lz = e[14]; listenerSet = true;
      if (lisLegacy) { lisLegacy.setPosition(lx, ly, lz); lisLegacy.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]); return; }
      lis.positionX.value = lx; lis.positionY.value = ly; lis.positionZ.value = lz;
      lis.forwardX.value = -e[8]; lis.forwardY.value = -e[9]; lis.forwardZ.value = -e[10];
      lis.upX.value = e[4]; lis.upY.value = e[5]; lis.upZ.value = e[6];
    },
    get voices() { return liveCount(); },
    loadSamples,
    setMuffle(amount, ramp = 0.25) {
      const f = MUFFLE_OPEN * Math.pow(MUFFLE_CLOSED / MUFFLE_OPEN, clamp(amount, 0, 1));
      lp.frequency.setTargetAtTime(f, ctx.currentTime, Math.max(0.005, ramp / 3));
    },
    setTimeScale(k, ramp = 0.15) {
      tsCents = 1200 * Math.log2(clamp(k, 0.25, 2));
      for (const v of active) if (v.bus !== 'music') v.applyRate(ramp);
    },
    blip,
    duck(bus, amount, dur) { if (holds[bus]) addHold(bus, amount, dur); },
  };

  // ── music: wire music/index.ts (createMusic) when it exists, otherwise a silent state tracker ──
  let music: MusicApi = createFallbackMusic();
  const factory = Object.values(musicModules)[0]?.createMusic;
  if (factory) {
    const host: MusicHost = { ctx, out: busIn.music, reverb: reverbIn, noise, engine };
    // canonical: createMusic(host); a composer that only needs a context and a destination may take (ctx, dest, host)
    try { music = factory.length >= 2 ? (factory as unknown as (c: AudioContext, d: AudioNode, h: MusicHost) => MusicApi)(ctx, busIn.music, host) : factory(host); } catch (e) { log.error('audio', 'music/index.ts failed to start — using silent fallback', e); }
  } else log.debug('audio', 'no music/index.ts — silent music fallback');

  // ── lifecycle ── the first user gesture calls `engine.resume()` (main.ts veil, menu buttons); no DOM listeners here.
  // Once audio runs: replay queued UI blips, restore the ambience, and start the menu score so the game is never silent
  // (the game's own states take over with setState from there).
  function onRunning(): void {
    flushUnlockQueue();
    applyAmbience(1.5);
    if (music.state === 'silent') music.setState('menu', { fade: 1.5 });
  }
  ctx.onstatechange = (): void => { if (ctx.state === 'running') onRunning(); };
  if (ctx.state === 'running') onRunning();
  void loadSamples(SAMPLE_URLS);
  // Recorded sounds: the small files are warmed a few seconds in (never competing with start-up); the long ones load on first use.
  const warm = window.setTimeout(() => { void loadSamples(WARM_URLS); }, 3500);
  import.meta.hot?.dispose(() => window.clearTimeout(warm));
  // Music stingers that are scares also get a recorded horror hit (never in Calm; the hit is a no-op there).
  function musicWrapped(): MusicApi {
    if (musicProxy && musicProxyOf === music) return musicProxy;
    musicProxyOf = music;
    return (musicProxy = new Proxy({} as MusicApi, {
    get(_t, key) {
      if (key === 'stinger') {
        return (id: string, o?: { vol?: number; duck?: number }): void => {
          music.stinger(id, o);
          const p = horrorForStinger(id);
          if (p !== null) void play('horrorHit', { param: p, vol: Math.min(1, (o?.vol ?? 1) * 0.9) });
        };
      }
      const v = (music as unknown as Record<string | symbol, unknown>)[key];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(music) : v;
    },
    }));
  }
  const offGamble = wireGambleFx(engine);
  import.meta.hot?.dispose(offGamble);
  return engine;
}

// ── tooling ───────────────────────────────────────────────────────────────────────────────────────
const noiseCache = new Map<number, NoiseBank>();
const bankFor = (sr: number): NoiseBank => { let b = noiseCache.get(sr); if (!b) { b = createNoiseBank(sr); noiseCache.set(sr, b); } return b; };

/** Names of every built-in recipe (for a sound-test screen / debug console). */
export const sfxNames = (): string[] => [...SFX_DEFS.keys()];

/**
 * Render a built-in recipe offline (stereo, trim applied, no bus/master chain). Samples must already be loaded
 * (`audio.loadSamples(...)`) for layered sounds to include them. Used for loudness calibration.
 */
export async function renderSfx(name: string, o: PlayOpts & { seconds?: number; sampleRate?: number } = {}): Promise<AudioBuffer> {
  const d = SFX_DEFS.get(name);
  if (!d) throw new Error(`audio: no recipe "${name}"`);
  const sr = o.sampleRate ?? 44100, off = new OfflineAudioContext(2, Math.ceil(sr * (o.seconds ?? 4)), sr);
  const host: KitHost = { ctx: off, noise: bankFor(sr), pitch: null, sample: (u) => sampleStore.get(u) ?? null, track() {} };
  const out = off.createGain();
  out.gain.value = (o.vol ?? 1) * (d.meta.gain ?? 1); out.connect(off.destination);
  d.run(new Kit(host, out, 0.005), o);
  return off.startRendering();
}

/** Render a line of blips offline (deterministic for a given `seed`). Used for loudness checks and the sound tests. */
export async function renderSpeech(o: SpeakOpts & { sampleRate?: number }): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 44100, bv = blipVoiceFor(o.speaker ?? 'house');
  const plan = planBlips(o.text, bv, { mood: o.mood, pitch: o.pitch, rng: createRng(o.seed ?? 1) });
  const off = new OfflineAudioContext(2, Math.ceil(sr * (plan.duration + 0.5)), sr);
  const host: KitHost = { ctx: off, noise: bankFor(sr), pitch: null, sample: () => null, track() {} };
  renderBlips(host, off.destination, plan, bv, 0);
  return off.startRendering();
}
