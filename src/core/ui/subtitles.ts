/**
 * The one subtitle system (W72). Every caller reaches it through `ui.subtitle` (bar lines) or `subtitles.say` (cutscene
 * cues, which need a voice and an exact fit). A pure state machine, no DOM and no `app`: the owner (ui.ts) binds the
 * renderer, the blip sink and the settings, and drives `tick(dt, frozen)` on a pausable timer.
 *
 * Model: one line on screen, a FIFO queue behind it. A line goes in (a short slide), types one letter per `1/cps`
 * (a pause after sentence and clause punctuation), blips each typed letter in its speaker's voice, holds, then goes
 * out. A `source` replaces the line on screen or queued with the same source. A `cutscene` line replaces everything,
 * because the cue timeline is authoritative. `fit` is the on-screen time including the typing, so authored cue
 * durations and caller durations keep their timing; without it the hold is `readHold(text)`.
 */

export type SubLane = 'cutscene' | 'story' | 'ambient';
export type SubSpeed = 'slow' | 'normal' | 'instant';
export type SubPhase = 'in' | 'typing' | 'hold' | 'out';

export interface SubLine {
  text: string;
  /** Speaker label, already translated. Absent = narration. */
  speaker?: string;
  /** Blip voice for typed letters (blip.ts). Absent = silent. */
  voice?: string;
  /** Default 'story'. */
  lane?: SubLane;
  /** A line with the same source replaces the one on screen, or the one waiting with it. */
  source?: string;
  /** Total seconds on screen, typing included (cue `dur`, caller `dur`). */
  fit?: number;
  /** Reading seconds after typing when there is no `fit`. Default `readHold(text)`. */
  hold?: number;
  /** Show the text at once, with no blips (seek, speed instant, reduced motion). */
  instant?: boolean;
}

export interface SubView { phase: SubPhase; lane: SubLane; speaker: string; shown: string }

export interface SubDeps {
  /** One blip for a typed letter or digit. Spaces and punctuation are not called. */
  blip?(voice: string, ch: string): void;
  /** The renderer. `null` = nothing on screen. */
  render(view: SubView | null): void;
  speed?(): SubSpeed;
  reduceMotion?(): boolean;
  /** Called on every `say`, so the owner can start its clock lazily. */
  arm?(): void;
}

export const SUB_BASE_CPS = 40;
export const SUB_SLOW_CPS = 20;
export const SUB_IN = 0.12;
export const SUB_OUT = 0.12;
export const SUB_QUEUE_MAX = 4;
/** Driver period (s) for the owner's clock: 30 steps a second is smooth at 40 cps. */
export const SUB_TICK = 1 / 30;
/** Share of a `fit` budget that typing may use; the rest is the slide and the hold. */
const TYPE_SHARE = 0.7;
const LETTER = /[\p{L}\p{N}]/u;

/** Reading time after typing: 1.2 s + 1 s per 16 characters, 2 to 7 s. */
export function readHold(text: string): number {
  const n = Array.from(text).length;
  return Math.min(7, Math.max(2, 1.2 + n / 16));
}

/** Extra pause after a character: sentence ends, then clause marks. Spaces and letters pause nothing. */
export function pauseAfter(ch: string): number {
  if (ch === '.' || ch === '!' || ch === '?' || ch === '…') return 0.35;
  if (ch === ',' || ch === ';' || ch === ':' || ch === '—') return 0.15;
  return 0;
}

interface Active {
  text: string;
  lane: SubLane;
  source?: string;
  voice?: string;
  speaker: string;
  chars: string[];
  /** Time (s from line start) at which each character appears. */
  revealAt: number[];
  shown: number;
  age: number;
  inDur: number;
  outDur: number;
  /** Age at which the out phase starts. */
  outAt: number;
}

export interface Subtitles {
  say(line: SubLine): void;
  /** Clear one lane, or everything when no lane is given. */
  clear(lane?: SubLane): void;
  /** Reveal the rest of the typing line at once. Returns true when it did something (the caller then stops). */
  finishTyping(): boolean;
  /** Advance the clock by `dt` seconds. `frozen` (paused, manga box or hotline sheet up) holds the line in place. */
  tick(dt: number, frozen?: boolean): void;
  bind(deps: Partial<SubDeps>): void;
  /** Lines waiting behind the one on screen. */
  queued(): number;
  /** Text of the line on screen (full text, not the typed part), its source, or null. */
  current(): { text: string; lane: SubLane; phase: SubPhase; source?: string } | null;
}

export function createSubtitles(initial?: Partial<SubDeps>): Subtitles {
  let d: SubDeps = { render: () => { /* unbound */ }, ...initial };
  let active: Active | null = null;
  let queue: SubLine[] = [];
  let lastSig = '';

  const motion = (): boolean => !(d.reduceMotion?.() ?? false);

  function phaseOf(a: Active): SubPhase {
    if (a.age < a.inDur) return 'in';
    if (a.shown < a.chars.length) return 'typing';
    if (a.age < a.outAt) return 'hold';
    return 'out';
  }

  function emit(): void {
    if (!active) {
      if (lastSig !== '') { lastSig = ''; d.render(null); }
      return;
    }
    const a = active;
    const phase = phaseOf(a);
    const sig = `${phase}|${a.shown}|${a.lane}|${a.speaker}`;
    if (sig === lastSig) return;
    lastSig = sig;
    d.render({ phase, lane: a.lane, speaker: a.speaker, shown: a.chars.slice(0, a.shown).join('') });
  }

  function start(line: SubLine): void {
    const chars = Array.from(line.text);
    const n = chars.length;
    const speed: SubSpeed = d.speed?.() ?? 'normal';
    const still = !motion();
    const inDur = still ? 0 : SUB_IN;
    const outDur = still ? 0 : SUB_OUT;
    const instant = !!line.instant || speed === 'instant' || still;
    const revealAt: number[] = new Array(n).fill(0);
    if (!instant && n > 0) {
      let pauses = 0;
      for (let i = 0; i < n - 1; i++) pauses += pauseAfter(chars[i]);
      let cps = speed === 'slow' ? SUB_SLOW_CPS : SUB_BASE_CPS;
      // A cue that must fit its authored time types faster when the base speed would run past it.
      if (line.fit !== undefined && line.fit > 0) {
        const budget = TYPE_SHARE * line.fit - inDur - pauses;
        cps = Math.max(cps, n / Math.max(0.05, budget));
      }
      let at = inDur;
      for (let i = 0; i < n; i++) {
        at += 1 / cps;
        revealAt[i] = at;
        at += pauseAfter(chars[i]);
      }
    }
    const typeEnd = n > 0 ? revealAt[n - 1] : inDur;
    const outAt = line.fit !== undefined && line.fit > 0
      ? Math.max(typeEnd, line.fit - outDur)
      : typeEnd + (line.hold ?? readHold(line.text));
    active = {
      text: line.text, lane: line.lane ?? 'story', source: line.source, voice: instant ? undefined : line.voice,
      speaker: line.speaker ?? '', chars, revealAt, shown: instant ? n : 0, age: 0, inDur, outDur, outAt,
    };
    emit();
  }

  function promote(): void {
    active = null;
    const next = queue.shift();
    if (next) start(next);
    else emit();
  }

  const api: Subtitles = {
    say(line: SubLine): void {
      d.arm?.();
      if (!line.text) { api.clear(); return; }
      const norm: SubLine = { ...line, lane: line.lane ?? 'story' };
      if (norm.lane === 'cutscene') { queue = []; start(norm); return; }
      if (norm.source !== undefined) {
        if (active && active.source === norm.source && active.lane === norm.lane) { start(norm); return; }
        queue = queue.filter((q) => q.source !== norm.source);
      }
      if (!active) { start(norm); return; }
      if (queue.length >= SUB_QUEUE_MAX) return;
      queue.push(norm);
    },

    clear(lane?: SubLane): void {
      if (lane === undefined) { active = null; queue = []; emit(); return; }
      if (active && active.lane === lane) active = null;
      queue = queue.filter((q) => (q.lane ?? 'story') !== lane);
      if (active) emit(); else promote();
    },

    finishTyping(): boolean {
      const a = active;
      if (!a || a.shown >= a.chars.length) return false;
      a.shown = a.chars.length;
      emit();
      return true;
    },

    tick(dt: number, frozen = false): void {
      const a = active;
      if (!a) return;
      if (!frozen && dt > 0) {
        a.age += dt;
        while (a.shown < a.chars.length && a.revealAt[a.shown] <= a.age) {
          const ch = a.chars[a.shown++];
          if (a.voice && LETTER.test(ch)) d.blip?.(a.voice, ch);
        }
        if (a.age >= a.outAt + a.outDur) { promote(); return; }
      }
      emit();
    },

    bind(deps: Partial<SubDeps>): void {
      d = { ...d, ...deps };
      lastSig = '';
      emit();
    },

    queued(): number { return queue.length; },

    current() {
      const a = active;
      return a ? { text: a.text, lane: a.lane, phase: phaseOf(a), source: a.source } : null;
    },
  };
  return api;
}

/** The game's subtitle system. ui.ts binds the renderer; cutscenes and callers import this directly. */
export const subtitles: Subtitles = createSubtitles();
