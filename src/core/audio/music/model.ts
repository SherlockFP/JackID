/**
 * Data model of the procedural composer (CORE-AUDIO / music). A SONG is data (key, mode, chart, form, parts, FX preset);
 * a PART is a generator that writes the note events of one layer for one bar, gated by intensity and dread; the
 * sequencer (`sequencer.ts`) turns those events into scheduled instrument notes. Event times and durations are
 * sequencer STEPS relative to the bar start (fractions allowed); `pos`/`dur` helpers in `parts.ts` work in beats.
 */
import type { Rng } from '../../rng';
import type { Chord, ModeName, Seg } from './theory';

export type InstId =
  | 'rhodes' | 'piano' | 'bass' | 'vibes' | 'trumpet' | 'organ' | 'reed' | 'box' | 'choir' | 'strings'
  | 'pluck' | 'synBass' | 'synArp' | 'synLead' | 'synPad' | 'calliope' | 'tuba' | 'flute' | 'bell'
  | 'brass' | 'sub' | 'drone' | 'drums' | 'fx' | 'harp';

/** A note event. `t`/`d` are sequencer steps relative to the bar start; `m` is a MIDI note (or a drum/FX code). */
export interface Ev {
  t: number; d: number; m: number; v: number; i: InstId;
  /** Flag bits (`OPT` | `ACCENT` | `RAW`). */
  o?: number;
  /** Patch-specific option forwarded to `Instrument.play` (drum playback rate, attack time, FX kind …). */
  x?: number;
}
/** Event flag bits: OPT = droppable when the voice budget is tight, ACCENT = louder, RAW = skip the swing warp. */
export const OPT = 1, ACCENT = 2, RAW = 4;

export type Push = (i: InstId, t: number, d: number, m: number, v: number, o?: number, x?: number) => void;

/** Everything a part may read while writing one bar. `rng` is re-seeded per part and per bar before each call. */
export interface BarCtx {
  bar: number;                  // absolute bar number since the arrangement started
  idx: number;                  // index into the arrangement's flattened form
  sec: string;                  // section name ('A', 'B', …)
  secBar: number;               // bar within the section
  secLen: number;
  phraseBar: number;            // secBar % 4
  segs: Seg[];                  // chord segments of this bar (already soured when dread is high)
  chord: Chord;                 // first chord of the bar
  next: Chord;                  // first chord of the next bar (approach tones)
  nextSec: string;
  lastOfSec: boolean;
  spb: number; sub: number; beats: number;   // steps per bar, steps per beat, beats per bar
  stepSec: number;              // seconds per step in this bar
  t0: number;                   // audio-clock time the bar starts (absolute; for independent-clock layers)
  rng: Rng;                     // per-part, per-bar stream (independent of gating ⇒ deterministic)
  i: number; d: number;         // current intensity / effective dread (0..1)
  energy: number;               // 0..1 build toward the section end
  key: number; scale: readonly number[];   // tonic pitch class; song scale as absolute pitch classes
  state: string;
  /** Convert wall seconds into steps for this bar (independent-clock layers such as heartbeats). */
  secToStep(s: number): number;
}

export type GenFn = (b: BarCtx, push: Push) => void;
export interface Gate { (g: { i: number; d: number }): number }

export interface MakeCtx { song: SongDef; rng: Rng; inst: InstId }
export interface PartDef {
  id: string;
  /** An array = "solo instrument chosen from N" (seeded once per arrangement). */
  inst: InstId | InstId[];
  gate: Gate;
  make: (c: MakeCtx) => GenFn;
  /** Optional bar condition; evaluated with the same per-part bar stream as the generator. */
  when?: (b: BarCtx) => boolean;
  /** Level multiplier (mix balance). */
  vel?: number;
  /** Seconds the part sits behind the beat (laid-back lead). */
  lag?: number;
  /** Chance (0..1) that a long note of this part gets a grace-note ornament (GDD: 15 %). */
  orn?: number;
}

export interface FxPreset {
  room?: number;      // reverb send multiplier (default 1)
  hall?: number;      // extra long-hall send (0 = none)
  lofi?: number;      // 0..1 tape/vinyl degradation: lowpass, crush, hiss, wobble
  tape?: number;      // wobble multiplier (default 1)
  bright?: number;    // 0..1 master tone
  crackle?: number;   // vinyl crackle level
  rain?: number;      // rain bed level
}

export interface SongDef {
  id: string;
  /** i18n key of the display title (jukebox songs) or a debug name. */
  title: string;
  bpm: number;
  beats: number;                // beats per bar
  sub: number;                  // steps per beat (4 = 16ths, 3 = triplets / compound meter, 2 = 8ths)
  swing: number;                // 0.5 straight … 0.67 triplet feel (applies to sub 4 and sub 2)
  key: number;                  // tonic pitch class
  mode: ModeName;
  sections: Record<string, string>;
  form: string[];
  /** Form index to loop back to (default 0). Ignored for one-shots. */
  loopFrom?: number;
  /** Plays the form once and ends (stingers, fanfares, topside). */
  oneShot?: boolean;
  /** Song id the conductor continues into, gaplessly, when a one-shot ends. */
  then?: string;
  /** Timing looseness multiplier (1 = band, 0.15 = drum machine). */
  human?: number;
  parts: PartDef[];
  fx?: FxPreset;
  /** Tempo rises with intensity (zone beds breathe; jukebox songs keep their tempo). */
  tempoFollowsIntensity?: boolean;
  /** Master level multiplier for balancing songs against each other. */
  gain?: number;
  /** Floors the effective intensity / dread while this song plays (a room that is tense by design). */
  iFloor?: number;
  dFloor?: number;
}

export const smooth = (lo: number, hi: number, x: number): number => {
  const t = x <= lo ? 0 : x >= hi ? 1 : (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
};
/** Layer enters as intensity passes `lo` (full at `lo + w`). */
export const byI = (lo: number, w = 0.14): Gate => (g) => smooth(lo - w * 0.5, lo + w, g.i);
/** Layer enters as dread passes `lo`. */
export const byD = (lo: number, w = 0.16): Gate => (g) => smooth(lo - w * 0.5, lo + w, g.d);
/** Layer lives between two intensities, fading out above `hi`. */
export const bandI = (lo: number, hi: number, w = 0.14): Gate => (g) =>
  smooth(lo - w * 0.5, lo + w, g.i) * (1 - smooth(hi - w * 0.5, hi + w, g.i));
/** Layer that thins out as dread rises (bright instruments in a horror cue). */
export const calmOnly = (base: Gate, from = 0.55, to = 0.9): Gate => (g) => base(g) * (1 - smooth(from, to, g.d));
/** Layer that leaves as intensity rises (a sparse part hands over to a busier one). */
export const outI = (lo: number, hi: number): Gate => (g) => 1 - smooth(lo, hi, g.i);
export const ALWAYS: Gate = () => 1;
