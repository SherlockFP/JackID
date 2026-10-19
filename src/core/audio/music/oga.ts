/**
 * The two recorded tracks of the score (CORE-AUDIO / music): "Drunken Saloon" (iamoneabe) under the bar and "Determined Pursuit"
 * (Emma_MA) at the top of the stakes, both CC0 from OpenGameArt (public/assets/vendor/music-oga/LICENSE.txt). They play on top
 * of the procedural conductor, never instead of it: the bed keeps running (the beat clock and the stakes overlay stay alive)
 * and only ducks while a recording is in. When a recording is not loaded (offline, failed, still decoding) the bed stays at
 * full level, so nothing is ever missing.
 *
 * Pure (no audio): which recording is wanted, with hysteresis, and how far the bed ducks under it. `ogaLayer.ts` plays them,
 * `index.ts` feeds the decisions. Unit-tested in scripts/tests/music.oga.test.mjs.
 */

export type OgaId = 'drunken_saloon' | 'determined_pursuit';

export interface OgaDef {
  id: OgaId;
  /** File under assets/vendor/music-oga/ (Ogg Opus; the whole file is one seamless loop). */
  file: string;
  /** Linear gain into the music bus: loudness trim to sit with the beds (measured, see docs/ASSETS.md) times how loud it should be. */
  gain: number;
  /** Seconds into the loop where it starts (the pursuit skips its quiet 18 s intro and comes in on the downbeat of the full orchestra; starting a bar earlier dips the crossfade). */
  from: number;
  /** A diegetic tune keeps its place while it is out of earshot (walking back into the bar finds the song still going). */
  resume: boolean;
  /** The jukebox can ask for it by id (`music.play`). */
  juke: boolean;
}

export const OGA: Readonly<Record<OgaId, OgaDef>> = {
  drunken_saloon: { id: 'drunken_saloon', file: 'drunken_saloon.ogg', gain: 2.9, from: 0, resume: true, juke: true },
  determined_pursuit: { id: 'determined_pursuit', file: 'determined_pursuit.ogg', gain: 0.9, from: 18, resume: false, juke: false },
};

/**
 * The bar: `BAR_POS` in world/layout.ts (a prop in the lobby, there is no bar zone; core may not import the world, and
 * the unit test pins these two numbers to the layout). In = within `inM`, out = beyond `outM`.
 */
export const BAR = { x: -6.0, z: 14.2, inM: 7, outM: 10 } as const;
/** Dread (0..1, effective) under which the saloon plays: in = below `in`, out = at `out`. A horror bed is not a bar tune. */
export const BAR_DREAD = { in: 0.35, out: 0.5 } as const;
/** Stakes (stakes.ts) at which the pursuit comes in and goes out. It falls with the meter (FALL_TAU 4 s), so it lingers ~2 s. */
export const EPIC = { on: 0.8, off: 0.55 } as const;
/** How far the procedural bed ducks under each recording (linear). The saloon replaces it; the pursuit rides over its drums. */
export const DUCK = { bar: 0.08, epic: 0.22 } as const;
/** Crossfade seconds (95 % of the way) into and out of a recording. */
export const FADE = { in: 3, out: 3.5 } as const;

export interface BarIn {
  /** The room the player is in (`setZone`). 'bar' is accepted for a world that gets a real bar zone one day. */
  zone: string | null;
  /** The player's floor position, or null when unknown (then only the zone counts). */
  x: number | null; z: number | null;
  dread: number;
  /** A floor state (lounge, tense, dread): the only ones where the floor's own music plays. */
  floor: boolean;
  /** The jukebox track playing, if any. */
  juke: string | null;
}

/** Is the saloon wanted? `was` = it was wanted a moment ago (the hysteresis: a wider ring and a higher dread to leave). */
export function barWanted(was: boolean, i: BarIn): boolean {
  if (!i.floor) return false;
  if (i.juke) return i.juke === 'drunken_saloon';                                   // the jukebox asked for it, or plays something else
  if (i.dread >= (was ? BAR_DREAD.out : BAR_DREAD.in)) return false;
  if (i.zone === 'bar') return true;
  if (i.zone !== 'lobby' || i.x === null || i.z === null) return false;
  return Math.hypot(i.x - BAR.x, i.z - BAR.z) < (was ? BAR.outM : BAR.inM);
}

export interface EpicIn {
  stakes: number;
  /** The Burning Wager is on: the pursuit does not wait for the meter to climb. */
  cue: boolean;
  /** A cue song that owns the moment is playing (a jackpot chase and its hit or miss, a rival's duel theme): the pursuit would bury it. */
  busy: boolean;
  floor: boolean;
  juke: string | null;
  /** Calm Mode: no frantic music (the meter is capped under the stabs anyway). */
  calm: boolean;
}

/** Is the pursuit wanted? `was` = it was wanted a moment ago. */
export function epicWanted(was: boolean, i: EpicIn): boolean {
  if (i.calm || !i.floor || i.juke) return false;
  return i.cue || (!i.busy && i.stakes >= (was ? EPIC.off : EPIC.on));
}

/** What is audible: which recording (the pursuit wins; the saloon never plays under it) and how loud the bed stays. */
export function mixOf(bar: boolean, epic: boolean): { bar: boolean; epic: boolean; bed: number } {
  return { bar: bar && !epic, epic, bed: epic ? DUCK.epic : bar ? DUCK.bar : 1 };
}
