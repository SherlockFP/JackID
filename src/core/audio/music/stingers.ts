/**
 * Stingers (CORE-AUDIO / music): one-shot musical punctuation. Each recipe schedules a handful of notes on the
 * same instrument patches as the score, but through the rig's un-ducked stinger bus, so the bed ducks (−9 dB for
 * ~1.5 s by default) without ducking the stinger. Stingers fire immediately (a few ms ahead) and are unquantised.
 */
import { D } from './dsp';
import { FX, createInstrument, type InstCtx, type Instrument } from './instruments';
import type { InstId } from './model';
import type { Rig } from './rig';

export interface StingerHooks {
  /** Bias (cents) added to the conductor's global detune — tape-stop effects. Reset by passing 0. */
  detune(cents: number, ramp: number): void;
}
interface Pen {
  /** One note `at` seconds after the stinger starts. */
  n(inst: InstId, at: number, m: number, dur: number, vel: number, x?: number): void;
  /** Run of notes `step` seconds apart. */
  run(inst: InstId, at: number, notes: readonly number[], step: number, dur: number, vel: number, velStep?: number): void;
  hooks: StingerHooks;
  rig: Rig;
}
interface Sting { duck?: number; hold?: number; /** Velocity trim keeping the loud ones under −3 dBFS (jump scares under −6, GDD 6.12). */ trim?: number; play(p: Pen): void }

const PENT_UP = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91];

const RECIPES: Record<string, Sting> = {
  /** The Watch bell: a struck bell with its octave below and a vibes halo. */
  bell: {
    duck: 0.45, hold: 1.2, trim: 1.6,
    play: (p) => { p.n('bell', 0, 74, 2.5, 0.9); p.n('bell', 0.012, 62, 2.5, 0.55); p.n('vibes', 0.02, 86, 1.2, 0.3); },
  },
  /** Quota met: rising Cmaj9 arpeggio, a held bell and a warm string bed. */
  quotaMet: {
    duck: 0.6, hold: 2.2, trim: 1,
    play: (p) => {
      p.run('vibes', 0, [72, 76, 79, 84, 88], 0.085, 0.8, 0.62, 0.06);
      p.n('bell', 0.36, 84, 2.5, 0.8); p.n('bell', 0.4, 91, 2.5, 0.55);
      for (const m of [60, 64, 67, 71]) p.n('strings', 0.25, m, 2.2, 0.62);
      p.n('rhodes', 0.36, 74, 1.6, 0.6); p.n('rhodes', 0.36, 67, 1.6, 0.55);
      p.n('drums', 0, D.CHIME_HIT, 0.1, 0.5);
    },
  },
  /** Quota failed: the descending tritone (A over E♭) under a low toll. */
  quotaFail: {
    duck: 0.7, hold: 3.2, trim: 1.2,
    play: (p) => {
      p.n('bell', 0, 69, 1.6, 0.8); p.n('bell', 0.55, 63, 3, 0.9);
      p.n('tuba', 0.55, 38, 1.8, 0.8); p.n('choir', 0.5, 50, 3, 0.7, 0.25); p.n('choir', 0.5, 56, 3, 0.6, 0.25);
      p.n('drums', 0.55, D.BOOM, 0.1, 0.75);
    },
  },
  /** Jackpot: crash, brass stab, a glissando up the pentatonic and a choir. */
  jackpot: {
    duck: 0.75, hold: 3.6, trim: 0.62,
    play: (p) => {
      p.n('drums', 0, D.CRASH, 0.1, 0.85);
      for (const m of [60, 64, 67, 72]) p.n('brass', 0, m, 0.55, 0.85);
      p.run('vibes', 0.02, PENT_UP, 0.045, 0.7, 0.55, 0.02);
      p.run('bell', 0.35, [84, 88, 91, 96], 0.08, 2.5, 0.55);
      for (const m of [48, 55, 60, 64]) p.n('strings', 0.2, m, 3, 0.6);
      for (const m of [60, 67, 72]) p.n('choir', 0.3, m, 2.8, 0.7, 0.25);
      p.n('brass', 0.6, 79, 1.4, 0.8); p.n('brass', 0.6, 72, 1.4, 0.7);
      p.n('drums', 0.6, D.CHIME_HIT, 0.1, 0.5);
    },
  },
  /** Big win: a shorter, brighter cousin of the jackpot. */
  bigWin: {
    duck: 0.55, hold: 1.8, trim: 1.3,
    play: (p) => {
      for (const m of [64, 67, 72]) p.n('brass', 0, m, 0.5, 0.75);
      p.run('vibes', 0.02, [72, 76, 79, 84, 88, 91], 0.06, 0.8, 0.55, 0.03);
      p.n('bell', 0.34, 84, 2, 0.7); p.n('drums', 0, D.CLAP, 0.1, 0.5);
    },
  },
  /** Curse: a choir cluster, a reversed bell and a sub-bass drop. */
  curse: {
    duck: 0.7, hold: 3.2, trim: 1.2,
    play: (p) => {
      for (const m of [50, 51, 56, 62]) p.n('choir', 0, m, 3.2, 0.75, 0.8);
      p.n('bell', 0, 57, 3.5, 0.7, 1); p.n('bell', 0.01, 45, 3.5, 0.5, 1);
      p.n('sub', 0, 26, 3.2, 0.85); p.n('fx', 0, FX.SUCK, 1.4, 0.6); p.n('fx', 0.2, FX.WHISPER, 2.2, 0.55);
    },
  },
  /** The Collector's step: three low tolls over a pedal and a creeping cluster. */
  collector: {
    duck: 0.65, hold: 3.4, trim: 1.3,
    play: (p) => {
      p.n('tuba', 0, 38, 3.2, 0.7); p.n('drone', 0, 38, 3.4, 0.7);
      p.n('bell', 0.1, 50, 3, 0.8); p.n('bell', 1.0, 50, 3, 0.7); p.n('bell', 1.9, 51, 3, 0.8);
      p.n('drums', 0.1, D.HEART, 0.1, 0.9); p.n('drums', 1.0, D.HEART, 0.1, 0.8); p.n('drums', 1.9, D.BOOM, 0.1, 0.6);
      p.n('strings', 1.6, 62, 1.6, 0.55); p.n('strings', 1.6, 63, 1.6, 0.55);
    },
  },
  /** Jump scare: reversed crash in, brass cluster, boom and a scrape. Level kept moderate (peak ≤ −6 dBFS after master). */
  jumpscare: {
    duck: 0.85, hold: 1.8, trim: 0.55,
    play: (p) => {
      p.n('drums', 0, D.BOOM, 0.1, 0.85);
      for (const m of [47, 48, 54, 59]) p.n('brass', 0, m, 0.7, 0.8);
      for (const m of [83, 84, 90]) p.n('strings', 0, m, 1.1, 0.7);
      p.n('fx', 0, FX.SCRAPE, 0.9, 0.7);
    },
  },
  /** Discovery: a harp run up Dm9 and a music-box note over a soft choir. */
  discovery: {
    duck: 0.4, hold: 2.2, trim: 1.2,
    play: (p) => {
      p.run('harp', 0, [62, 65, 69, 72, 76, 81], 0.1, 2, 0.6, 0.02);
      p.n('box', 0.62, 88, 2, 0.6); p.n('bell', 0.7, 93, 2.4, 0.4);
      for (const m of [57, 64, 69]) p.n('choir', 0.2, m, 3, 0.5, 0.7);
    },
  },
  /** Blackout: the tape stops (pitch slides down), a boom and a suck of air; the bed comes back pitched up a hair. */
  blackout: {
    duck: 0.8, hold: 2, trim: 1.3,
    play: (p) => {
      p.hooks.detune(-1200, 0.9);
      p.n('drums', 0.05, D.BOOM, 0.1, 0.9); p.n('fx', 0, FX.SUCK, 1.3, 0.7); p.n('sub', 0.1, 24, 2.4, 0.8);
      setTimeout(() => p.hooks.detune(0, 0.6), 1600);
    },
  },
  /** A heavy door: wood thud, scrape and a minor second. */
  door: {
    duck: 0.5, hold: 1.2, trim: 1.4,
    play: (p) => {
      p.n('drums', 0, D.TOM_LO, 0.1, 0.9); p.n('drums', 0.01, D.WOOD, 0.1, 0.7); p.n('fx', 0.04, FX.SCRAPE, 0.7, 0.45);
      p.n('choir', 0.2, 50, 1.6, 0.45, 0.3); p.n('choir', 0.2, 51, 1.6, 0.45, 0.3);
    },
  },
  /** Ascend: a shimmering pentatonic climb with a riser and a swelling choir. */
  ascend: {
    duck: 0.5, hold: 2, trim: 1.4,
    play: (p) => {
      p.run('harp', 0, [74, 76, 79, 81, 86, 88], 0.09, 1.6, 0.55, 0.03);
      p.run('bell', 0.4, [86, 91, 93], 0.14, 2, 0.45);
      p.n('fx', 0, FX.RISER, 1.3, 0.5);
      for (const m of [67, 74]) p.n('choir', 0.1, m, 2.4, 0.5, 0.6);
    },
  },
  /** Descend: the same shape falling, with a sub drop. */
  descend: {
    duck: 0.6, hold: 2.4, trim: 1.4,
    play: (p) => {
      p.run('harp', 0, [86, 81, 79, 76, 74, 69], 0.1, 1.6, 0.55, -0.02);
      p.n('fx', 0.1, FX.SUCK, 1.6, 0.55); p.n('sub', 0.2, 28, 2.4, 0.7);
      for (const m of [50, 56]) p.n('choir', 0.3, m, 2.4, 0.5, 0.7);
    },
  },
  /** Buff: a bright major triad up. */
  buff: {
    duck: 0.3, hold: 0.9, trim: 1.5,
    play: (p) => { p.run('vibes', 0, [76, 80, 83, 88], 0.07, 0.8, 0.6, 0.05); p.n('bell', 0.24, 88, 1.4, 0.45); },
  },
  /** Debuff: three falling notes, the last a flat bell. */
  debuff: {
    duck: 0.3, hold: 0.9, trim: 1.5,
    play: (p) => { p.run('rhodes', 0, [65, 61, 58], 0.12, 0.6, 0.6, -0.04); p.n('bell', 0.36, 45, 1.6, 0.5, 1); },
  },
};

/** Persistent stinger voice set. Instruments are created lazily on first use. */
export class Stingers {
  private readonly insts = new Map<InstId, Instrument>();
  private readonly ictx: InstCtx;
  constructor(private readonly rig: Rig, private readonly hooks: StingerHooks) {
    const bus = rig.getStingerBus();
    this.ictx = { rig, ctx: rig.ctx, dest: bus.input, send: bus.send, hall: () => bus.send, beat: () => 0.5 };
  }

  private inst(id: InstId): Instrument {
    let i = this.insts.get(id);
    if (!i) { i = createInstrument(id, this.ictx); this.insts.set(id, i); }
    return i;
  }

  has(id: string): boolean { return id in RECIPES; }

  /** Play stinger `id` at `when` (audio-clock seconds). Returns how long the bed should stay ducked. */
  play(id: string, when: number, o: { vol?: number; duck?: number } = {}): number {
    const r = RECIPES[id] ?? RECIPES.bell;
    const vol = (o.vol ?? 1) * (r.trim ?? 1);
    const pen: Pen = {
      hooks: this.hooks, rig: this.rig,
      n: (inst, at, m, dur, vel, x) => {
        try { this.inst(inst).play(when + at, m, dur, Math.min(1.2, vel * vol), x); } catch { /* a failing patch must never stop the game */ }
      },
      run: (inst, at, notes, step, dur, vel, vs = 0) => {
        notes.forEach((m, k) => pen.n(inst, at + k * step, m, dur, Math.max(0.1, vel + vs * k)));
      },
    };
    r.play(pen);
    const hold = r.hold ?? 1.5;
    const duck = o.duck ?? r.duck ?? 0.65;
    if (duck > 0) this.rig.duck(duck, hold, when);                       // duck 0 = milestone, leave the bed alone
    return hold;
  }

  dispose(): void {
    for (const i of this.insts.values()) { try { i.dispose(); } catch { /* noop */ } }
    this.insts.clear();
  }
}
