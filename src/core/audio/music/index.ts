/**
 * Adaptive score — the conductor (CORE-AUDIO / music). Implements the frozen `MusicApi` (audio/types.ts) on top of
 * the procedural composer in `music/` (theory → parts → songs → sequencer → instruments → rig).
 *
 *   game  ──setState / setIntensity / setDread / setZone / stinger / play ──►  conductor
 *   conductor ── picks the song for (state, zone, jukebox) ── one {@link Arrangement} at a time, equal-power
 *                crossfaded at a bar line ── lookahead pump (25 ms tick, 220 ms ahead; stretches to ~1.8 s when the timer is throttled)
 *   arrangements → rig (saturation, tape wobble, room/hall reverb, glue) → `host.out` (the music bus)
 *   stingers     → rig stinger bus (un-ducked) while the bed ducks −9 dB for ~1.5 s
 *
 * Intensity (calm → tense) and dread (horror) are slewed continuously; macro-states only set floors for them and
 * pick the song, so lounge → tense → dread is one song getting busier and sourer, not a cut. Seeded: with
 * `setSeed` the same seed writes the same arrangement; without it every start differs.
 */
import { log } from '../../log';
import { hashSeed, randomSeed } from '../../rng';
import type { Unsub, ZoneId } from '../../types';
import type { MusicHost } from '../audio';
import type { BeatEvent, JukeboxTrack, MusicApi, MusicStateId, StingerId } from '../types';
import type { SongDef } from './model';
import { Rig } from './rig';
import { Arrangement, type BeatMark } from './sequencer';
import { BEDS } from './songs/beds';
import { JUKEBOX } from './songs/jukebox';
import { Stingers } from './stingers';
import { setWinKey } from '../winBand';
import { audioCalm } from '../real';
import { bus } from '../../events';
import { CUES, hitOf, lastCallOf, missOf } from './songs/cues';
import { HOLD, STAKE, STAKES_TO_I, StakesMeter, betStakes, dreadStakes, gambleStakes } from './stakes';

declare module '../../events' {
  interface GameEvents {
    /**
     * A high-stakes music cue. `cue`: 'tease' (a near miss: stakes only), 'reel_chase' (the jackpot chase; off with `hit`
     * set to explode or deflate), 'duel:<rival>' (Lucan, Tamsin, Ada's kitchen 'duel:ada'; `final` = a final round),
     * 'burning_wager'. Emitted by the local player's machines and tables; the conductor listens.
     */
    'music:cue': { cue: string; on: boolean; final?: boolean; hit?: boolean };
  }
}

const PUMP_MS = 25;
const LOOKAHEAD = 0.22, LOOKAHEAD_MAX = 1.8;
const JUKE_INTENSITY = 0.9;
/** Milestone stingers: exempt from the cue cap and from bed ducking (the moment must not pump the score down). */
const MILESTONES: ReadonlySet<string> = new Set(['quotaMet', 'quotaFail', 'jackpot', 'bigWin']);
/** Rise (cents) of a tempo-following song or a jukebox track at full intensity — Last Call pitches up +3 %. */
const LAST_CALL_CENTS = 51;
const DEFAULT_FADE = 2.5;
const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);   // NaN → 0
const smooth = (lo: number, hi: number, x: number): number => {
  const t = x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
};

// ── state → song / floors ──────────────────────────────────────────────────────────────────────
const ZONE_BED: Record<string, string> = {
  mouth: 'lounge', well: 'lounge', lobby: 'lounge', atrium: 'lounge', services: 'lounge',
  gallery: 'arcade', slots: 'arcade', arcade: 'arcade', lottery: 'arcade',
  cards: 'felt', tables: 'felt', boiler: 'pipes', wheels: 'tango', laundry: 'laundry', midway: 'carnival',
  parlour: 'parlour', parlor: 'parlour', counting: 'counting', lift: 'elevator', sump: 'sump',
};
const zoneBed = (z: ZoneId | null): string => (z ? ZONE_BED[z] ?? 'lounge' : 'lounge');

interface StateCfg { song: string | ((z: ZoneId | null) => string); iMin: number; dMin: number; quantize: boolean; /** Ceiling for the effective dread (joy stays joyful). */ dMax?: number }
const STATES: Record<string, StateCfg> = {
  menu: { song: 'menu', iMin: 0.5, dMin: 0, quantize: false },
  lounge: { song: zoneBed, iMin: 0, dMin: 0, quantize: true },
  tense: { song: zoneBed, iMin: 0.55, dMin: 0.25, quantize: true },
  dread: { song: zoneBed, iMin: 0.4, dMin: 0.7, quantize: true },
  chase: { song: 'chase', iMin: 0.8, dMin: 0.55, quantize: false },
  jackpot: { song: 'jackpot', iMin: 1, dMin: 0, quantize: false, dMax: 0.05 },
  cutscene: { song: 'cutscene', iMin: 0.2, dMin: 0, quantize: false },
  elevator: { song: 'elevator', iMin: 0.3, dMin: 0, quantize: true },
  defeat: { song: 'defeat', iMin: 0.3, dMin: 0.5, quantize: false },
  ending: { song: 'ending', iMin: 0.8, dMin: 0, quantize: false, dMax: 0.1 },
};
/** States that keep a playing jukebox track alive (the jukebox is diegetic: it survives tension, not a cutscene). */
const KEEPS_JUKE = new Set(['lounge', 'tense', 'dread']);
/** High-stakes cues, first wins. They play over the floor states only (KEEPS_JUKE); Last Call gives way to the jukebox. */
const CUE_ORDER = ['chase_hit', 'chase_miss', 'reel_chase', 'burning_wager', 'duel_lucan', 'duel_tamsin', 'duel_ada', 'lastcall'];
/** Seconds a jackpot chase may hold the heartbeat before it counts as a miss. */
const CHASE_MAX = 15;

/**
 * Exponential slew of one control value (95 % of the way after `dur`). Unlike an eased ramp it keeps its slope when
 * retargeted, so a HUD that calls `setIntensity` every frame still gets a smooth, moving value.
 */
class Ramp {
  private v0: number; private target: number; private t0 = 0; private tau = 0;
  constructor(v: number) { this.v0 = v; this.target = v; }
  at(now: number): number {
    if (this.tau <= 0 || now <= this.t0) return this.tau <= 0 ? this.target : this.v0;
    const r = this.target + (this.v0 - this.target) * Math.exp(-(now - this.t0) / this.tau);
    return Math.abs(r - this.target) < 1e-4 ? this.target : r;
  }
  to(target: number, now: number, dur: number): void {
    this.v0 = this.at(now); this.target = target; this.t0 = now; this.tau = dur / 3;
  }
}

interface Slot { arr: Arrangement; song: SongDef; /** Id the state/zone/jukebox asked for (a one-shot may have moved on to its `then`). */ key: string; chained: boolean }

export function createMusic(host: MusicHost): MusicApi {
  const ctx = host.ctx;
  const rig = new Rig(ctx, host.out);
  rig.prewarm();

  const jukeById = new Map(JUKEBOX.map((e) => [e.track.id, e]));
  const catalog: readonly JukeboxTrack[] = JUKEBOX.map((e) => e.track);

  let state: MusicStateId = 'silent';
  let zone: ZoneId | null = null;
  let jukeId: string | null = null;
  let seed = randomSeed(), seeded = false, plays = 0;
  let userI = 0, userD = 0;
  const effI = new Ramp(0), effD = new Ramp(0);
  let detuneBias = 0;

  let cur: Slot | null = null;
  const fading: Array<{ arr: Arrangement; killAt: number }> = [];
  let stingers: Stingers | null = null;
  let lastLook = 0, lastTick = performance.now(), lookahead = LOOKAHEAD;
  let failures = 0, healAt = 0, lastStateCall = -9;
  const meter = new StakesMeter();
  const cues = new Set<string>();
  const built = new Map<string, SongDef>();
  let lastPump = ctx.currentTime, wallet = 0, usualBet = 0, chaseUntil = 0;
  const lastSting = new Map<string, number>(), stingTimes: number[] = [];

  // beat clock (driven by the audible arrangement)
  const beatEv: BeatEvent = { bpm: 90, beat: 0, bar: 0, phase: 0 };
  let beatT = 0, beatDur = 60 / 90;
  const beatSubs = new Set<(e: BeatEvent) => void>();
  const outLatency = (): number => Math.min(0.25, ((ctx as AudioContext).outputLatency || ctx.baseLatency || 0));

  // ── song resolution ──────────────────────────────────────────────────────────────────────────
  const cfgOf = (s: string): StateCfg => STATES[s] ?? STATES.lounge;
  /** The cue song: fixed (`CUES`) or built for the bed under it (Last Call, chase hit / miss), memoised. */
  function cueSong(id: string, bed: SongDef): SongDef {
    if (CUES[id]) return CUES[id];
    const k = `${id}@${bed.id}`;
    let s = built.get(k);
    if (!s) { s = id === 'lastcall' ? lastCallOf(bed) : id === 'chase_hit' ? hitOf(bed) : missOf(bed); built.set(k, s); }
    return s;
  }

  function resolve(): { song: SongDef | null; key: string; juke: boolean } {
    const cue = KEEPS_JUKE.has(state) ? CUE_ORDER.find((c) => cues.has(c) && !(c === 'lastcall' && jukeId)) : undefined;
    if (cue) {
      const bed = BEDS[zoneBed(zone)] ?? BEDS.lounge;
      const song = cueSong(cue, bed);
      return { song, key: 'cue:' + song.id, juke: false };
    }
    if (jukeId) {
      const e = jukeById.get(jukeId);
      if (e) return { song: e.def, key: 'juke:' + jukeId, juke: true };
      const bed = BEDS[jukeId];
      if (bed) return { song: bed, key: 'juke:' + jukeId, juke: false };
    }
    if (state === 'silent') return { song: null, key: '', juke: false };
    const cfg = cfgOf(state);
    const id = typeof cfg.song === 'function' ? cfg.song(zone) : cfg.song;
    const song = BEDS[id] ?? BEDS.lounge;
    return { song, key: song.id, juke: false };
  }

  function targets(song: SongDef | null, juke: boolean): { i: number; d: number } {
    if (juke) return { i: Math.max(JUKE_INTENSITY, userI), d: Math.min(0.45, userD * 0.5) };
    const cfg = cfgOf(state);
    const bedState = !jukeId;
    return {
      i: Math.max(userI, bedState ? cfg.iMin : 0, song?.iFloor ?? 0, jukeId ? 0.6 : 0),
      d: Math.min(Math.max(userD, bedState ? cfg.dMin : 0, song?.dFloor ?? 0), bedState ? cfg.dMax ?? 1 : 1),
    };
  }

  function retarget(ramp: number): void {
    const r = resolve();
    const t = targets(r.song, r.juke);
    const now = ctx.currentTime;
    effI.to(t.i, now, ramp);
    effD.to(t.d, now, ramp);
  }

  // ── arrangements ─────────────────────────────────────────────────────────────────────────────
  const tempoOf = (song: SongDef, i: number): number => (song.tempoFollowsIntensity ? 1 + 0.1 * i : 1);

  function newArrangement(song: SongDef, at: number, fadeIn: number): Arrangement {
    const s = seeded ? hashSeed(seed, 'music', song.id) : hashSeed(seed, song.id, ++plays);
    const arr = new Arrangement(rig, song, { seed: s, state });
    setWinKey(song.key, song.mode);                              // the win cues play in the newest song's key
    const now = ctx.currentTime;
    arr.i = effI.at(now); arr.d = effD.at(now);
    arr.tempoMul = tempoOf(song, arr.i);
    arr.start(at);
    arr.fadeIn(at, fadeIn);
    return arr;
  }

  function retire(arr: Arrangement, at: number, fade: number): void {
    arr.stopGen(at);
    arr.fadeOut(at, fade);
    fading.push({ arr, killAt: at + fade + 0.6 });
  }

  /** Make `want` the audible song: crossfade at the next bar line (`quantize`) or right away. */
  function switchTo(song: SongDef, key: string, fade: number, quantize: boolean): void {
    const now = ctx.currentTime;
    const old = cur;
    let at = now + 0.07;
    if (old) {
      if (old.arr.startAt > now + 0.02) {                       // the old one has not started yet: take its slot
        at = old.arr.startAt;
        old.arr.dispose();
        cur = null;
      } else if (old.arr.genDone) {
        at = Math.max(old.arr.endTime, now + 0.07);
      } else if (quantize) {
        at = Math.max(old.arr.nextBarTime, now + 0.07);
      }
    }
    const inDur = old ? fade : Math.min(fade, 0.9);
    const arr = newArrangement(song, at, inDur);
    if (old && cur === old) retire(old.arr, at, fade);
    cur = { arr, song, key, chained: false };
    beatT = 0;
    log.debug('music', `→ ${song.id} (${state}${jukeId ? ' / ' + jukeId : ''}) at +${(at - now).toFixed(2)}s fade ${fade}s`);
  }

  function silence(fade: number): void {
    if (!cur) return;
    const now = ctx.currentTime;
    const at = now + 0.05;
    retire(cur.arr, at, Math.max(0.05, fade));
    cur = null;
  }

  /** Re-resolve (state, zone, jukebox) and cross over if the wanted song differs from what is playing. */
  function sync(fade: number, quantize: boolean, restart = false): void {
    const want = resolve();
    if (!want.song) { silence(fade); return; }
    if (cur && cur.key === want.key && !restart) return;
    switchTo(want.song, want.key, fade, quantize);
  }

  /** One-shot reached its last bar: continue gaplessly into `then`, or loop it if it has none. */
  function chain(slot: Slot): void {
    slot.chained = true;
    if (slot.key.startsWith('cue:chase_')) {                     // the hit / miss phrase is over: hand back to the bed
      cues.delete('chase_hit'); cues.delete('chase_miss');
      sync(1.5, false);
      return;
    }
    const nextId = slot.song.then;
    const next = nextId ? BEDS[nextId] : slot.song;
    const at = slot.arr.endTime;
    const arr = newArrangement(next, at, 0.05);
    arr.state = state;
    retire(slot.arr, at, 1.6);
    cur = { arr, song: next, key: slot.key, chained: false };
    retarget(0.5);
  }

  // ── pump ─────────────────────────────────────────────────────────────────────────────────────
  function fireBeat(m: BeatMark): void {
    beatEv.bpm = m.bpm; beatEv.beat = m.beat; beatEv.bar = m.bar; beatEv.phase = 0;
    beatT = m.t; beatDur = 60 / m.bpm;
    for (const fn of beatSubs) { try { fn(beatEv); } catch (e) { log.warn('music', 'onBeat handler failed', e); } }
  }

  function applyLook(now: number, force = false): void {
    if (!force && now - lastLook < 0.1) return;
    lastLook = now;
    const i = effI.at(now), d = effD.at(now);
    rig.setLook(Math.round(d * 100) / 100, cur ? cur.song.fx ?? {} : undefined, 0.8);
    const rise = cur && (jukeId || cur.song.tempoFollowsIntensity) ? LAST_CALL_CENTS * smooth(0.86, 1, i) : 0;   // Last Call: +3 %
    const sag = -40 * d * d + (d > 0.5 ? Math.sin(now * 0.9) * 22 * (d - 0.5) * 2 : 0);
    rig.setDetune(rise + sag + detuneBias, 0.35);
    // calm beds sit ~5 dB under tense ones (the glue compressor would otherwise flatten the difference); dread pulls back ~2 dB
    const idle = !cur && fading.length === 0;
    rig.setLevel(idle ? 0 : jukeId ? 1 : (0.56 + 0.44 * smooth(0, 0.85, i)) * (1 - 0.25 * d), idle ? 0.8 : 0.4);
  }

  function pump(): void {
    const now = ctx.currentTime;
    // adaptive lookahead: a throttled timer (hidden tab, long frame) is seen as a long gap between ticks
    const wall = performance.now(), gap = wall - lastTick;
    lastTick = wall;
    lookahead = gap > 150 ? Math.min(LOOKAHEAD_MAX, (gap / 1000) * 1.5 + 0.2) : Math.max(LOOKAHEAD, lookahead - 0.02);
    const until = now + lookahead;
    meter.calm = audioCalm();
    const s = meter.tick(now, now - lastPump);
    lastPump = now;
    const i = Math.max(effI.at(now), s * STAKES_TO_I), d = effD.at(now);
    if (cur) {
      const a = cur.arr;
      a.i = i; a.d = d; a.s = s; a.tempoMul = tempoOf(cur.song, i); a.state = state;
      try { a.pump(now, until); } catch (e) {
        log.error('music', 'arrangement failed — dropping it', e);
        a.dispose(); cur = null;
        if (++failures <= 5) healAt = now + 1.5;                 // try again shortly; a persistent bug must not loop forever
        return;
      }
      if (a.genDone && !cur.chained) chain(cur);
      if (cur) {
        const m = cur.arr.takeBeats(now - outLatency());
        if (m) fireBeat(m);
      }
    }
    if (healAt && now >= healAt && !cur) { healAt = 0; sync(1, false); }
    if (chaseUntil && now >= chaseUntil) endChase(false);       // the machine never said how it ended (stood up, disposed)
    for (let k = fading.length - 1; k >= 0; k--) {
      const f = fading[k];
      if (now >= f.killAt) { f.arr.dispose(); fading.splice(k, 1); continue; }
      f.arr.i = i; f.arr.d = d; f.arr.s = s;
      try { f.arr.pump(now, until); } catch { f.arr.dispose(); fading.splice(k, 1); }
    }
    applyLook(now);
  }
  setInterval(pump, PUMP_MS);

  // ── stakes and cues from the bus ─────────────────────────────────────────────────────────────
  /** Cue on / off; a change re-resolves the song (at the bar line, over `fade`, unless `quantize` is false). */
  function cue(id: string, on: boolean, fade = DEFAULT_FADE, quantize = true): void {
    if (on === cues.has(id)) return;
    if (on) cues.add(id); else cues.delete(id);
    if (KEEPS_JUKE.has(state)) sync(fade, quantize);
  }
  /** The last reel landed: a hit explodes at once (Calm skips the burst and eases back), a miss deflates. */
  function endChase(hit: boolean): void {
    chaseUntil = 0;
    if (!cues.has('reel_chase')) return;
    meter.set('chase', 0, ctx.currentTime);
    cues.delete('reel_chase');
    if (!KEEPS_JUKE.has(state)) return;
    if (hit && !audioCalm()) cue('chase_hit', true, 0.06, false);
    else if (hit) sync(1.5, false);
    else cue('chase_miss', true, 0.6, false);
  }
  const DUELS = CUE_ORDER.filter((c) => c.startsWith('duel_'));
  function duelOff(): void {
    meter.set('duel', 0, ctx.currentTime);
    for (const c of DUELS) cue(c, false);
  }
  bus.on('music:cue', (e) => {
    const now = ctx.currentTime;
    if (e.cue === 'tease') { meter.set('tease', e.on ? STAKE.tease : 0, now, HOLD.tease); return; }
    if (e.cue === 'reel_chase') {
      if (!e.on) { endChase(!!e.hit); return; }
      meter.set('chase', STAKE.chase, now, CHASE_MAX);
      chaseUntil = now + CHASE_MAX;
      cue('chase_hit', false); cue('chase_miss', false);
      cue('reel_chase', true, 0.35, false);                      // not on the bar: the drop-out lands with the reel
      return;
    }
    if (e.cue === 'burning_wager') { meter.set('duel', e.on ? STAKE.final : 0, now); cue('burning_wager', e.on); return; }
    if (e.cue.startsWith('duel:')) {
      if (!e.on) { duelOff(); return; }
      meter.set('duel', e.final ? STAKE.final : STAKE.duel, now);
      const id = 'duel_' + e.cue.slice(5);
      for (const c of DUELS) if (c !== id) cue(c, false);
      if (CUES[id]) cue(id, true);                                // a rival without a theme keeps the bed and its stakes
    }
  });
  bus.on('shift:phase', ({ phase }) => {
    meter.set('lastCall', phase === 'lastCall' ? STAKE.lastCall : 0, ctx.currentTime);
    cue('lastcall', phase === 'lastCall');
    if (phase !== 'play' && phase !== 'lastCall' && phase !== 'closing') duelOff();
  });
  bus.on('gamble:fx', ({ kind, step }) => meter.set('gamble', gambleStakes(kind, step) ?? 0, ctx.currentTime, HOLD.gamble));
  bus.on('eco:wallet', (e) => { wallet = e.wallet; });
  // shortcut: the run emits machine:round and eco:wallet for its own player only; the pocket is the last wallet seen (before or after the debit)
  bus.on('machine:round', ({ bet }) => {
    meter.set('bet', betStakes(bet, Math.max(wallet, bet), usualBet), ctx.currentTime, HOLD.bet);
    usualBet = usualBet > 0 ? usualBet * 0.8 + bet * 0.2 : bet;
  });
  bus.on('dread:change', ({ value }) => meter.set('dread', dreadStakes(value), ctx.currentTime));
  bus.on('app:state', () => { meter.clear(); cues.clear(); usualBet = 0; });

  // ── public API ───────────────────────────────────────────────────────────────────────────────
  const api = {
    setState(s: MusicStateId, o?: { fade?: number; onBar?: boolean }): void {
      const fade = o?.fade ?? DEFAULT_FADE;
      // asking again for the state a one-shot belongs to (a second jackpot) restarts it — unless a caller is
      // simply re-asserting its state every frame
      const sinceCall = ctx.currentTime - lastStateCall;
      lastStateCall = ctx.currentTime;
      const again = s === state && sinceCall > 1 && !!cur && !cur.key.startsWith('juke:') && !cur.key.startsWith('cue:') && cur.song.id !== cur.key;
      state = s;
      if (s === 'silent' || !KEEPS_JUKE.has(s)) jukeId = null;
      retarget(fade);
      sync(fade, o?.onBar ?? cfgOf(s).quantize, again);
    },
    get state(): MusicStateId { return state; },

    setIntensity(v: number, ramp = 1.5): void { userI = clamp01(v); retarget(ramp); },
    setDread(v: number, ramp = 1.5): void { userD = clamp01(v); retarget(ramp); },

    setZone(z: ZoneId | null, fade = DEFAULT_FADE): void {
      if (z === zone) return;
      zone = z;
      if (!jukeId && state !== 'silent') sync(fade, true);
    },

    stinger(id: StingerId, o?: { vol?: number; duck?: number }): void {
      const now = ctx.currentTime;
      const milestone = MILESTONES.has(id);
      if (now - (lastSting.get(id) ?? -9) < 0.12) return;                  // the same cue twice in a blink is one cue
      lastSting.set(id, now);
      if (!milestone) {                                                     // milestones are exempt from the cue cap
        while (stingTimes.length && now - stingTimes[0] > 1) stingTimes.shift();
        if (stingTimes.length >= 4) return;                                 // and never a machine-gun of cues
        stingTimes.push(now);
      }
      try {
        stingers ??= new Stingers(rig, {
          detune: (cents, ramp) => { detuneBias = cents; rig.setDetune(cents, ramp); lastLook = ctx.currentTime + ramp; },
        });
        stingers.play(id, ctx.currentTime + 0.03, milestone ? { ...o, duck: 0 } : o);   // duck 0 = no bed ducking
      } catch (e) { log.warn('music', `stinger "${id}" failed`, e); }
    },

    setSeed(s: number): void { seed = s >>> 0; seeded = true; },

    get beat(): BeatEvent {
      beatEv.phase = beatT > 0 ? clamp01((ctx.currentTime - outLatency() - beatT) / beatDur) : 0;
      return beatEv;
    },
    onBeat(fn: (e: BeatEvent) => void): Unsub { beatSubs.add(fn); return () => { beatSubs.delete(fn); }; },

    play(trackId: string, o?: { fade?: number }): void {
      if (!jukeById.has(trackId) && !BEDS[trackId]) { log.warn('music', `unknown track "${trackId}"`); return; }
      const fade = o?.fade ?? 1.5;
      jukeId = trackId;
      retarget(fade);
      sync(fade, false);
    },
    stop(fade = 1.5): void {
      if (!jukeId) return;
      jukeId = null;
      retarget(fade);
      sync(fade, false);
    },
    get current(): string | null { return jukeId; },
    tracks(): string[] { return JUKEBOX.map((e) => e.track.id); },
    catalog(): readonly JukeboxTrack[] { return catalog; },

    /** Dev console: what the conductor is doing. */
    debug() {
      const now = ctx.currentTime;
      return {
        state, zone, jukeId, song: cur?.song.id ?? null, key: cur?.key ?? null, userI, userD, stakes: meter.value, cues: [...cues],
        effI: effI.at(now), effD: effD.at(now), fading: fading.length, bar: cur?.arr.barNo ?? 0, load: rig.load(now), lookahead,
      };
    },
  };
  return api;
}
