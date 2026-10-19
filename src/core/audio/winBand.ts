/**
 * The win cues' band: the music engine's own patches (bell, vibes, brass, strings, drums) played inside one sfx voice, so a win
 * stinger, its rollup and the anticipation riser are music in the key of the score that is playing (sfx.ts writes them in
 * C major; `band` moves them). Each recipe gets its own patches, released when its `life` is over.
 */
import { PercBank } from './music/dsp';
import { createInstrument, type InstCtx, type Instrument } from './music/instruments';
import type { InstId } from './music/model';
import type { Rig } from './music/rig';
import { MODES, type ModeName } from './music/theory';
import { arng, type Kit } from './synth';

let shift = 0;
/** The score's song changed (music/index.ts): win cues move to its major key (a minor song's relative major), within -7..+4 semitones of C. */
export function setWinKey(key: number, mode: ModeName): void {
  const pc = (MODES[mode] as readonly number[]).includes(4) ? key : key + 3;
  shift = ((((pc % 12) + 12) % 12) + 7) % 12 - 7;
}
/** Semitones from C major to the current win key. */
export const winKey = (): number => shift;

const percs = new WeakMap<BaseAudioContext, PercBank>();

export interface Band {
  /** One note `at` s after the recipe starts. `m` is MIDI in C major (moved to the win key); for 'drums' it is a `D` kind. */
  n(inst: InstId, at: number, m: number, dur: number, vel: number, x?: number): void;
}

/** A band playing into recipe `k` for `life` seconds (tails included). */
export function band(k: Kit, life: number): Band {
  const ctx: BaseAudioContext = k.ctx;
  let perc = percs.get(ctx);
  if (!perc) percs.set(ctx, (perc = new PercBank(ctx)));
  // the slice of the score's Rig the patches read: no live detune, no dread, the shared drum buffers
  const rig = { liveDetuneMin: Infinity, detuneNow: 0, dread: 0, perc, random: () => arng.next(), track() {} } as unknown as Rig;
  const out = ctx.createGain(), sink = ctx.createGain();      // the patches' reverb sends go nowhere: the sfx bus has its reverb
  out.connect(k.out);
  const ic: InstCtx = { rig, ctx, dest: out, send: sink, hall: () => sink, beat: () => 0.5 };
  const insts = new Map<InstId, Instrument>();
  const keep = ctx.createConstantSource();                    // holds the voice open for the notes' tails, then frees the patches
  keep.addEventListener('ended', () => { for (const i of insts.values()) i.dispose(); out.disconnect(); }, { once: true });
  k.start(keep, k.t, k.t + life);
  const s = shift;
  return {
    n(inst, at, m, dur, vel, x) {
      let i = insts.get(inst);
      if (!i) insts.set(inst, (i = createInstrument(inst, ic)));
      i.play(k.t + at, inst === 'drums' ? m : m + s, dur, vel, x);
    },
  };
}
