/**
 * Pattern library for the procedural composer (CORE-AUDIO / music): drum grooves and fills, comping rhythms,
 * walking / root / waltz / tango basses, arpeggios, improvised solos, pads, the House motif, pedals and hats.
 * Every generator is a `GenFn` factory: voice-leading state lives in its closure and all randomness comes from
 * `b.rng`, so one seed always writes the same bar. Positions are BEATS inside the bar; `note()` converts to steps.
 */
import { D } from './dsp';
import { OPT, RAW, type BarCtx, type Gate, type GenFn, type InstId, type PartDef, type Push } from './model';
import {
  HOUSE_MOTIF_MAJOR, HOUSE_MOTIF_MINOR, chordPcs, isChordTone, mod12, placePc, scaleFor, stepIn, voice,
  type Chord, type Seg, type VoicingKind,
} from './theory';

/** A drum hit: beat position, drum code (`D.*`), velocity. */
export type Hit = readonly [pos: number, code: number, vel: number];
/** A comping template: (beat position, duration, velocity) triples relative to the chord segment. */
export type Rh = ReadonlyArray<readonly [pos: number, dur: number, vel: number]>;

/** Push one note given in beats; converted to sequencer steps. */
export function note(push: Push, b: BarCtx, inst: InstId, pos: number, dur: number, m: number, v: number, o = 0, x?: number): void {
  push(inst, pos * b.sub, dur * b.sub, m, v, o, x);
}

/** The chord segment sounding at beat `pos`. */
export function segAt(b: BarCtx, pos: number): Seg {
  const st = pos * b.sub;
  for (const s of b.segs) if (st >= s.at - 1e-6 && st < s.at + s.len - 1e-6) return s;
  return b.segs[b.segs.length - 1];
}

/** MIDI note whose pitch class is in `pcs`, nearest to `near`, inside [lo, hi]. */
export function nearIn(pcs: readonly number[], near: number, lo: number, hi: number): number {
  let best = -1, bd = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (!pcs.includes(mod12(m))) continue;
    const d = Math.abs(m - near);
    if (d < bd) { bd = d; best = m; }
  }
  return best < 0 ? Math.round((lo + hi) / 2) : best;
}

/** Octave-fold `m` into [lo, hi]. */
export function fitRange(m: number, lo: number, hi: number): number {
  while (m > hi) m -= 12;
  while (m < lo) m += 12;
  return m;
}

/** Chord-tone pitch class by degree: 0 bass, 1 fifth, 2 third, 3 seventh (or flat seventh). */
function degPc(c: Chord, deg: number): number {
  if (deg === 0) return c.bass;
  if (deg === 1) return mod12(c.root + (c.tones.includes(6) && !c.tones.includes(7) ? 6 : 7));
  if (deg === 2) return mod12(c.root + (c.third || 4));
  return mod12(c.root + (c.seventh || 10));
}

// ── drums ───────────────────────────────────────────────────────────────────────────────────────
/** A groove is written for one bar length (`beats`); lanes that are absent simply stay silent. */
export interface Groove {
  beats: number;
  kick?: readonly Hit[]; kickAlt?: readonly Hit[];
  snare?: readonly Hit[]; ghost?: readonly Hit[];
  hat?: readonly Hit[]; ride?: readonly Hit[];
  perc?: readonly Hit[];
}
export type Lane = 'kick' | 'snare' | 'ghost' | 'hat' | 'ride' | 'perc';

/** One drum lane of a groove as its own part, so every lane has its own intensity gate. */
export function drumLane(id: string, g: Groove, lane: Lane, gate: Gate, vel = 1, when?: (b: BarCtx) => boolean): PartDef {
  return {
    id: `drum.${id}`, inst: 'drums', gate, when,
    make: () => (b, push) => {
      if (b.beats !== g.beats) return;
      let hits = g[lane];
      if (lane === 'kick' && g.kickAlt && b.rng.chance(0.3)) hits = g.kickAlt;
      if (!hits) return;
      const main = lane === 'kick' || lane === 'snare';
      for (const [p, code, v] of hits) {
        if (!main && b.rng.chance(0.06)) continue;          // the odd missing hat or ghost
        note(push, b, 'drums', p, 0.1, code, v * vel * (0.92 + 0.16 * b.rng.next()));
      }
    },
  };
}

/** Fill hits in the last beat of a section, chosen from six patterns (GDD §6.9 "drum fills"). */
const FILLS: ReadonlyArray<readonly Hit[]> = [
  [[2.5, D.TOM_HI, 0.55], [2.75, D.TOM_HI, 0.6], [3, D.TOM_MID, 0.7], [3.25, D.TOM_MID, 0.7], [3.5, D.TOM_LO, 0.8], [3.75, D.TOM_LO, 0.9]],
  [[2, D.SNARE_GHOST, 0.22], [2.25, D.SNARE_GHOST, 0.28], [2.5, D.SNARE_GHOST, 0.34], [2.75, D.SNARE_GHOST, 0.4],
    [3, D.SNARE_GHOST, 0.5], [3.25, D.SNARE_GHOST, 0.6], [3.5, D.SNARE, 0.75], [3.75, D.SNARE, 0.9]],
  [[3.5, D.REV_CRASH, 0.6]],
  [[2.5, D.CLACK, 0.5], [3, D.CLACK, 0.6], [3.5, D.CLACK, 0.7], [3.75, D.CLACK, 0.8]],
  [[2.75, D.TOM_LO, 0.55], [3.5, D.CHIME_HIT, 0.5]],
  [[2, D.SNARE_BRUSH, 0.5], [2.5, D.SWISH_UP, 0.6], [3, D.SNARE_BRUSH, 0.6], [3.5, D.SWISH_UP, 0.7]],
];

export function fillPart(gate: Gate, vel = 1): PartDef {
  return {
    id: 'drum.fill', inst: 'drums', gate,
    when: (b) => b.beats === 4 && b.lastOfSec && b.secLen >= 4 && b.rng.chance(0.85),
    make: () => (b, push) => {
      const f = FILLS[b.rng.int(0, FILLS.length - 1)];
      for (const [p, code, v] of f) note(push, b, 'drums', p, 0.1, code, v * vel);
    },
  };
}

/** Lub-dub heartbeat (sub kick), used under high dread. */
export function heartbeat(gate: Gate, vel = 1): PartDef {
  return {
    id: 'drum.heart', inst: 'drums', gate,
    make: () => (b, push) => {
      note(push, b, 'drums', 0, 0.1, D.HEART, 0.9 * vel);
      note(push, b, 'drums', 0.42, 0.1, D.HEART, 0.55 * vel);
    },
  };
}

/** Sixteenth-note closed hats, the "Last Call" layer. */
export function hatRun(gate: Gate, vel = 1): PartDef {
  return {
    id: 'drum.run', inst: 'drums', gate,
    make: () => (b, push) => {
      for (let p = 0; p < b.beats - 1e-6; p += 0.25) {
        note(push, b, 'drums', p, 0.1, D.HAT, (p % 0.5 === 0 ? 0.32 : 0.18) * vel);
      }
    },
  };
}

// ── chords ──────────────────────────────────────────────────────────────────────────────────────
/** Comping rhythm templates; one is picked per bar (a seeded "3 options per bar"). */
const COMP: Record<string, readonly Rh[]> = {
  stabs: [
    [[0, 1.5, 0.8], [2, 1.5, 0.7]],
    [[0.5, 1, 0.6], [2.5, 1.5, 0.75]],
    [[1.5, 0.5, 0.6], [2, 2, 0.8]],
  ],
  bossa: [
    [[0, 1.5, 0.8], [1.5, 0.5, 0.6], [2.5, 1.5, 0.7]],
    [[0, 1, 0.8], [1.5, 1, 0.6], [3, 1, 0.6]],
  ],
  sustain: [[[0, 4, 0.75]], [[0, 2, 0.75], [2, 2, 0.6]]],
  waltz: [[[0, 1, 0.75], [1.5, 1.5, 0.5]], [[1, 1, 0.6], [2, 1, 0.6]]],
  tango: [[[0, 0.5, 0.9], [1.5, 0.5, 0.6], [2, 0.5, 0.8], [3.5, 0.5, 0.6]]],
  stab16: [[[0, 0.5, 0.8], [1.5, 0.5, 0.6], [2, 0.5, 0.7], [3.5, 0.5, 0.6]]],
  dance: [[[0, 1, 0.8], [1, 1, 0.6], [2, 1, 0.8], [3, 1, 0.6]]],
  six: [[[0, 1, 0.8], [1, 1, 0.6]]],
};
export type CompRh = keyof typeof COMP;

export interface CompOpts { rh: CompRh; kind: VoicingKind; lo: number; hi: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean; jitter?: number; lag?: number }

/** Block-chord comping on the chord segments of each bar, with smooth voice leading. */
export function comp(id: string, inst: InstId | InstId[], o: CompOpts): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when, lag: o.lag,
    make: (c) => {
      let prev: number[] | null = null;
      return (b, push) => {
        const opts = COMP[o.rh];
        const tpl = opts[b.rng.int(0, opts.length - 1)];
        for (const s of b.segs) {
          const v = voice(s.chord, prev, { lo: o.lo, hi: o.hi, kind: o.kind, rng: b.rng, jitter: o.jitter ?? 1.2 });
          prev = v;
          const base = s.at / b.sub, span = s.len / b.sub;
          for (const [p, d, vel] of tpl) {
            if (p >= span - 1e-6 || p >= b.beats - 1e-6) continue;
            const dd = Math.min(d, span - p);
            for (const m of v) note(push, b, c.inst, base + p, dd, m, vel * (o.vel ?? 1));
          }
        }
      };
    },
  };
}

/** Sustained chord pad (choir, strings, synth pad, organ); each bar re-triggers with a little overlap. */
export function pad(id: string, inst: InstId | InstId[], o: { kind: VoicingKind; lo: number; hi: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean; x?: number }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => {
      let prev: number[] | null = null;
      return (b, push) => {
        for (const s of b.segs) {
          const v = voice(s.chord, prev, { lo: o.lo, hi: o.hi, kind: o.kind, rng: b.rng, jitter: 1.5 });
          prev = v;
          const base = s.at / b.sub, span = s.len / b.sub;
          for (const m of v) note(push, b, c.inst, base, span + 0.25, m, o.vel ?? 0.6, 0, o.x);
        }
      };
    },
  };
}

/** Stabbed or sustained single notes at fixed beat positions on the chord root (bells, box, calliope accents). */
export function accents(id: string, inst: InstId, o: { pos: readonly number[]; lo: number; hi: number; vel?: number; gate: Gate; dur?: number }): PartDef {
  return {
    id, inst, gate: o.gate,
    make: (c) => (b, push) => {
      for (const p of o.pos) {
        if (p >= b.beats - 1e-6) continue;
        const s = segAt(b, p);
        const m = nearIn([s.chord.root], (o.lo + o.hi) / 2, o.lo, o.hi);
        note(push, b, c.inst, p, o.dur ?? 1, m, o.vel ?? 0.6);
      }
    },
  };
}

// ── bass ────────────────────────────────────────────────────────────────────────────────────────
/** Bass patterns: [beat position, duration, chord degree (0 bass, 1 fifth, 2 third, 3 seventh), velocity]. */
const BASS: Record<string, ReadonlyArray<readonly [pos: number, dur: number, deg: number, vel: number]>> = {
  root8: [[0, 0.5, 0, 0.8], [0.5, 0.5, 1, 0.5], [1, 0.5, 0, 0.7], [1.5, 0.5, 1, 0.5], [2, 0.5, 0, 0.8], [2.5, 0.5, 1, 0.5], [3, 0.5, 0, 0.7], [3.5, 0.5, 1, 0.5]],
  pump: [[0, 0.4, 0, 0.9], [0.5, 0.4, 1, 0.55], [1, 0.4, 0, 0.7], [1.5, 0.4, 1, 0.55], [2, 0.4, 0, 0.9], [2.5, 0.4, 1, 0.55], [3, 0.4, 0, 0.7], [3.5, 0.4, 3, 0.55]],
  halves: [[0, 2, 0, 0.85], [2, 2, 1, 0.7]],
  tango: [[0, 0.75, 0, 0.95], [1.5, 0.5, 1, 0.6], [2, 0.75, 0, 0.85], [3.5, 0.5, 2, 0.6]],
  waltz: [[0, 1.2, 0, 0.9], [1, 0.9, 1, 0.55], [2, 0.9, 1, 0.55]],
  six: [[0, 1, 0, 0.9], [1, 1, 1, 0.6]],
  bossa: [[0, 1.5, 0, 0.8], [1.5, 1, 1, 0.6], [2.5, 1.5, 0, 0.7]],
  sustain: [[0, 4, 0, 0.8]],
};
export type BassPat = keyof typeof BASS;

/** Pattern bass (root/fifth/octave movers, waltz oom-pah, tango, bossa, half notes …). */
export function bassPat(id: string, inst: InstId, o: { pat: BassPat; lo: number; hi: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean; lag?: number }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when, lag: o.lag,
    make: (c) => {
      let prev = -1;
      return (b, push) => {
        for (const [p, d, deg, v] of BASS[o.pat]) {
          if (p >= b.beats - 1e-6) continue;
          const pc = degPc(segAt(b, p).chord, deg);
          const m = nearIn([pc], prev < 0 ? (o.lo + o.hi) / 2 : prev, o.lo, o.hi);
          prev = m;
          note(push, b, c.inst, p, Math.min(d, b.beats - p), m, v * (o.vel ?? 1));
        }
      };
    },
  };
}

/** Walking bass: root on the one, chord tones and scale steps on the middle beats, chromatic approach into the next bar. */
export function walk(id: string, inst: InstId, o: { lo: number; hi: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => {
      let prev = -1;
      return (b, push) => {
        for (let k = 0; k < b.beats; k++) {
          const ch = segAt(b, k).chord;
          const reg = prev < 0 ? (o.lo + o.hi) / 2 : prev;
          let m: number;
          if (prev < 0 || k === 0) m = nearIn([ch.bass], reg, o.lo, o.hi);
          else if (k === b.beats - 1) {
            const tgt = b.next.bass;
            const pc = b.rng.chance(0.6) ? mod12(tgt - 1) : mod12(tgt + 2);
            m = nearIn([pc], reg, o.lo, o.hi);
          } else {
            const scale = scaleFor(ch, b.scale);
            const cand = [stepIn(prev, 1, scale), stepIn(prev, -1, scale), stepIn(prev, 2, scale), stepIn(prev, -2, scale)];
            const tones = cand.filter((x) => isChordTone(x, ch));
            m = tones.length && b.rng.chance(0.75) ? b.rng.pick(tones) : b.rng.pick(cand);
          }
          m = fitRange(m, o.lo, o.hi);
          prev = m;
          note(push, b, c.inst, k, 0.9, m, (k === 0 ? 0.9 : 0.72) * (o.vel ?? 1));
        }
      };
    },
  };
}

/** Held drone on the chord bass, placed near `near` (sub-bass pedal, organ drone). */
export function pedal(id: string, inst: InstId, o: { near: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => (b, push) => {
      const m = placePc(segAt(b, 0).chord.bass, o.near);
      note(push, b, c.inst, 0, b.beats, m, o.vel ?? 0.7);
    },
  };
}

// ── single lines ────────────────────────────────────────────────────────────────────────────────
/** Arpeggio through the chord tones of each segment (`step` in beats; `updown` ping-pongs). */
export function arp(id: string, inst: InstId, o: { lo: number; hi: number; step: number; mode: 'up' | 'down' | 'updown'; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => (b, push) => {
      for (const s of b.segs) {
        const pcs = chordPcs(s.chord);
        const pool: number[] = [];
        for (let m = o.lo; m <= o.hi; m++) if (pcs.includes(mod12(m))) pool.push(m);
        if (!pool.length) continue;
        const n = pool.length, base = s.at / b.sub, span = s.len / b.sub;
        const count = Math.floor(span / o.step + 1e-6);
        const off = b.rng.int(0, n - 1);
        const L = Math.max(1, 2 * n - 2);
        for (let k = 0; k < count; k++) {
          const q = (k + off) % (o.mode === 'updown' ? L : n);
          const idx = o.mode === 'down' ? n - 1 - q : o.mode === 'updown' ? (q < n ? q : L - q) : q;
          const onBeat = Math.abs((k * o.step) % 1) < 1e-6;
          note(push, b, c.inst, base + k * o.step, o.step * 0.9, pool[idx], (onBeat ? 0.8 : 0.55) * (o.vel ?? 1), OPT);
        }
      }
    },
  };
}

/** Improvised line: onsets on the half-beat grid, stepwise motion over the scale, chord tones on strong beats. */
export function solo(id: string, inst: InstId | InstId[], o: { lo: number; hi: number; prob: number; vel?: number; dense?: boolean; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => {
      let last = -1;
      return (b, push) => {
        if (!b.rng.chance(o.prob)) return;
        const grid: number[] = [];
        for (let p = 0; p < b.beats - 1e-6; p += 0.5) grid.push(p);
        const n = Math.min(grid.length, b.rng.int(o.dense ? 5 : 3, o.dense ? 8 : 5));
        const onsets = b.rng.shuffle(grid.slice()).slice(0, n).sort((x, y) => x - y);
        for (let k = 0; k < onsets.length; k++) {
          const p = onsets[k];
          const dur = Math.min((onsets[k + 1] ?? b.beats) - p, b.rng.pick([0.5, 1, 1.5]));
          const ch = segAt(b, p).chord;
          const pcs = chordPcs(ch), scale = scaleFor(ch, b.scale);
          let m: number;
          if (last < 0) m = nearIn(pcs, (o.lo + o.hi) / 2, o.lo, o.hi);
          else {
            const r = b.rng.next();
            if (r < 0.55) m = stepIn(last, (b.rng.chance(0.5) ? 1 : -1) * (b.rng.chance(0.3) ? 2 : 1), scale);
            else if (r < 0.85) m = nearIn(pcs, last + (b.rng.chance(0.5) ? 3 : -3), o.lo, o.hi);
            else m = last + (b.rng.chance(0.5) ? 1 : -1);
          }
          m = fitRange(m, o.lo, o.hi);
          last = m;
          const strong = Math.abs(p - Math.round(p)) < 1e-6;
          note(push, b, c.inst, p, dur * 0.92, m, (o.vel ?? 0.7) * (strong ? 1 : 0.8), OPT);
        }
      };
    },
  };
}

/** The House motif (GDD §6.9: D F A G♯ A, quarter quarter quarter eighth dotted-half), written at each phrase start. */
export function motif(id: string, inst: InstId | InstId[], o: { lo: number; hi: number; vel?: number; prob?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when,
    make: (c) => (b, push) => {
      if (b.phraseBar !== 0 || !b.rng.chance(o.prob ?? 1)) return;
      const minor = b.scale.includes(mod12(b.key + 3));
      const motifShape = minor ? HOUSE_MOTIF_MINOR : HOUSE_MOTIF_MAJOR;
      let base = nearIn([b.key], (o.lo + o.hi) / 2 - 2, o.lo, o.hi - 7);
      if (b.rng.chance(0.3) && base + 12 <= o.hi) base += 5;     // variation: up a fourth
      let t = 0;
      motifShape.iv.forEach((iv, i) => {
        const d = HOUSE_MOTIF_MINOR.beats[i];
        note(push, b, c.inst, t, d * 0.9, base + iv, (o.vel ?? 0.7) * (i === 0 ? 1 : 0.92));
        t += d;
      });
    },
  };
}

/** Sparse dressing: a chime or wood tick on random beats of a bar (music-box and carnival textures). */
export function sparkle(id: string, inst: InstId, o: { lo: number; hi: number; prob: number; vel?: number; gate: Gate }): PartDef {
  return {
    id, inst, gate: o.gate,
    make: (c) => (b, push) => {
      if (!b.rng.chance(o.prob)) return;
      const p = b.rng.int(0, Math.max(0, b.beats - 1)) + (b.rng.chance(0.5) ? 0.5 : 0);
      if (p >= b.beats) return;
      const m = nearIn(chordPcs(segAt(b, p).chord), (o.lo + o.hi) / 2 + b.rng.int(-3, 3), o.lo, o.hi);
      note(push, b, c.inst, p, 0.5, m, (o.vel ?? 0.5) * (0.85 + 0.3 * b.rng.next()), OPT);
    },
  };
}

// ═══ composed melody ═══════════════════════════════════════════════════════════════════════════════
export type ThemeStyle = 'swing' | 'ballad' | 'straight' | 'bossa' | 'tango' | 'waltz' | 'lullaby' | 'carnival';
type Cell = ReadonlyArray<readonly [pos: number, dur: number]>;
const T3 = 1 / 3;
/** Rhythm cells (beat position, duration) per style; the bar length picks the family when the style does not fit. */
const CELLS: Record<ThemeStyle, readonly Cell[]> = {
  swing: [
    [[0.5, 0.5], [1, 1], [2.5, 0.5], [3, 1]],
    [[0, 1.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
    [[1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0, 0.5], [0.5, 0.5], [1, 2], [3.5, 0.5]],
  ],
  ballad: [
    [[0, 1.5], [1.5, 0.5], [2, 2]],
    [[0.5, 1.5], [2, 1], [3, 1]],
    [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5]],
  ],
  straight: [
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0, 1.5], [1.5, 1.5], [3, 1]],
  ],
  bossa: [
    [[0, 1.5], [1.5, 1], [2.5, 0.5], [3, 1]],
    [[0.5, 1], [1.5, 1], [2.5, 1.5]],
    [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 2]],
  ],
  tango: [
    [[0, 0.75], [0.75, 0.25], [1, 1], [2, 0.75], [2.75, 0.25], [3, 1]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2]],
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
  ],
  waltz: [
    [[0, 1.5], [1.5, 0.5], [2, 1]],
    [[0, 1], [1, 1], [2, 1]],
    [[1, 1], [2, 1]],
  ],
  lullaby: [
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]],
    [[0, 2], [2, 1]],
    [[0, 1.5], [1.5, 1.5]],
  ],
  carnival: [
    [[0, T3], [T3, T3], [2 * T3, T3], [1, 2 * T3], [5 * T3, T3]],
    [[0, 1], [1, 1]],
    [[0, 2 * T3], [2 * T3, T3], [1, T3], [4 * T3, T3], [5 * T3, T3]],
  ],
};
const CADENCE: Record<number, readonly Cell[]> = {
  4: [[[0, 1], [1, 1], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1.5]], [[0.5, 0.5], [1, 1], [2, 2]]],
  3: [[[0, 1], [1, 2]], [[0, 0.5], [0.5, 0.5], [1, 2]]],
  2: [[[0, T3], [T3, T3], [2 * T3, T3], [1, 1]], [[0, 1], [1, 1]]],
};
interface PNote { p: number; d: number; m: number; v: number; ch: string }

export interface ThemeOpts {
  lo: number; hi: number;
  style: ThemeStyle;
  vel?: number;
  /** Fraction of non-first notes kept (1 = every note of the cell). */
  density?: number;
  /** Per-note chance that a replay of an earlier phrase shifts the note by one scale step. */
  vary?: number;
  /** Chance that each time the form wraps around the tune is re-composed instead of replayed (default 0.4). */
  refresh?: number;
  gate: Gate;
  when?: (b: BarCtx) => boolean;
  lag?: number;
  orn?: number;
}

/**
 * A hummable melody: every four bars it states a motif (bar 1), answers it (bar 2), sequences it up a step (bar 3)
 * and cadences onto a chord tone (bar 4). Phrases are remembered per section and bar, so a repeated A section
 * plays the same tune (lightly varied) and B has its own. Strong beats are snapped to chord tones.
 */
export function theme(id: string, inst: InstId | InstId[], o: ThemeOpts): PartDef {
  return {
    id, inst, gate: o.gate, when: o.when, lag: o.lag, orn: o.orn,
    make: (c) => {
      const mem = new Map<string, PNote[]>();
      let motif: { cell: Cell; steps: number[]; anchor: number } | null = null;
      let last = -1, lastIdx = -1;
      const mid = (o.lo + o.hi) / 2;

      const chordTone = (ch: Chord, near: number): number => nearIn(chordPcs(ch), near, o.lo, o.hi);
      const family = (beats: number): ThemeStyle =>
        beats === 4 ? (o.style === 'waltz' || o.style === 'lullaby' || o.style === 'carnival' ? 'swing' : o.style)
          : beats === 3 ? (o.style === 'lullaby' ? 'lullaby' : 'waltz') : 'carnival';

      const compose = (b: BarCtx): PNote[] => {
        const rng = b.rng, pb = b.phraseBar, beats = b.beats;
        const out: PNote[] = [];
        const first = segAt(b, 0).chord;
        if (pb === 0 || !motif) {
          const cells = CELLS[family(beats)];
          const cell = cells[rng.int(0, cells.length - 1)];
          // a singable contour: mostly stepwise runs that turn now and then, the odd leap, rarely a repeated note
          const steps: number[] = [0];
          let acc = 0, dir = rng.chance(0.5) ? 1 : -1;
          for (let k = 1; k < cell.length; k++) {
            const r = rng.next();
            if (r < 0.58) acc += dir * (rng.chance(0.75) ? 1 : 2);
            else if (r < 0.8) { dir = -dir; acc += dir; }
            else if (r < 0.93) acc += dir * rng.pick([2, 3]);
            if (Math.abs(acc) > 4) { dir = -Math.sign(acc); acc += dir * 2; }
            steps.push(acc);
          }
          motif = { cell, steps, anchor: mid };
        }
        let cell: Cell = motif.cell, steps = motif.steps.slice();
        let anchor = chordTone(first, last >= 0 ? last : mid + rng.int(-3, 3));
        if (pb === 0) motif.anchor = anchor;
        if (pb === 1 && rng.chance(0.6)) steps = steps.map((s) => -s);
        if (pb === 2) anchor = chordTone(first, motif.anchor + rng.pick([2, 3, 4]));
        if (pb === 3) {
          const cads = CADENCE[beats] ?? CADENCE[4];
          cell = cads[rng.int(0, cads.length - 1)];
          const target = b.lastOfSec ? b.next : first;
          const homePcs = [mod12(target.root), mod12(target.root + (target.third || 4))];
          const finalM = nearIn(homePcs, last >= 0 ? last - 1 : mid, o.lo, o.hi);
          const sc = scaleFor(first, b.scale);
          for (let k = 0; k < cell.length; k++) {
            const [p, d] = cell[k];
            const end = k === cell.length - 1;
            const m = end ? finalM : stepIn(finalM, cell.length - 1 - k, sc);
            out.push({ p, d: d * (end ? 0.95 : 0.85), m: fitRange(m, o.lo, o.hi), v: end ? 0.9 : 0.78, ch: segAt(b, p).chord.name });
          }
          return out;
        }
        for (let k = 0; k < cell.length; k++) {
          const [p, d] = cell[k];
          if (k > 0 && !rng.chance(0.55 + 0.45 * (o.density ?? 1))) continue;
          const ch = segAt(b, p).chord;
          const sc = scaleFor(ch, b.scale);
          let m = stepIn(anchor, steps[k], sc);
          const strong = Math.abs(p - Math.round(p)) < 1e-6 && (k === 0 || d >= 1);
          if (strong && !isChordTone(m, ch)) m = chordTone(ch, m);
          if (k > 0 && steps[k] !== steps[k - 1] && m === out[out.length - 1]?.m) m = stepIn(m, steps[k] > steps[k - 1] ? 1 : -1, sc);   // snapping must not flatten a moving line
          out.push({ p, d: d * 0.92, m: fitRange(m, o.lo, o.hi), v: k === 0 ? 0.92 : 0.8, ch: ch.name });
        }
        return out;
      };

      return (b, push) => {
        if (b.idx < lastIdx && b.rng.chance(o.refresh ?? 0.4)) { mem.clear(); motif = null; }   // new loop, new tune (sometimes)
        lastIdx = b.idx;
        const key = `${b.sec.replace(/\d+$/, '')}:${b.secBar}`;
        let notes = mem.get(key);
        if (notes) {
          const vary = o.vary ?? 0.12;
          notes = notes.map((n, k) => {
            const ch = segAt(b, n.p).chord;
            let m = n.m;
            if (ch.name !== n.ch) m = nearIn(chordPcs(ch), m, o.lo, o.hi);
            else if (k > 0 && b.rng.chance(vary)) m = fitRange(stepIn(m, b.rng.chance(0.5) ? 1 : -1, scaleFor(ch, b.scale)), o.lo, o.hi);
            return { ...n, m };
          });
        } else {
          notes = compose(b);
          mem.set(key, notes);
        }
        if (notes.length) last = notes[notes.length - 1].m;
        for (const n of notes) note(push, b, c.inst, n.p, n.d, n.m, n.v * (o.vel ?? 0.7));
      };
    },
  };
}

// ═══ independent-clock and utility layers ══════════════════════════════════════════════════════════
/** Percussion at fixed wall-clock intervals (heartbeat, clock ticks), unaffected by tempo and swing. */
export function pulse(id: string, o: { period: number; hits: ReadonlyArray<readonly [offset: number, code: number, vel: number]>; gate: Gate; vel?: number; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst: 'drums', gate: o.gate, when: o.when,
    make: () => (b, push) => {
      const t1 = b.t0 + b.spb * b.stepSec;
      for (const [off, code, vel] of o.hits) {
        for (let n = Math.ceil((b.t0 - off) / o.period - 1e-9); ; n++) {
          const t = n * o.period + off;
          if (t >= t1 - 1e-6) break;
          push('drums', (t - b.t0) / b.stepSec, 0.1, code, vel * (o.vel ?? 1), RAW);
        }
      }
    },
  };
}

/** Lub-dub heart at 0.9 s (GDD 6.9): independent of the song tempo. */
export const heartPulse = (gate: Gate, vel = 1): PartDef =>
  pulse('drum.heart', { period: 0.9, hits: [[0, D.HEART, 0.9], [0.38, D.HEART, 0.55]], gate, vel });

/** Sidechain-style ducking: control events (`m = -1`) tell `targets` to dip at each beat position. */
export function sidechain(id: string, targets: readonly InstId[], o: { pos: readonly number[]; amt: number; gate: Gate }): PartDef {
  return {
    id, inst: 'drums', gate: o.gate,
    make: () => (b, push) => {
      for (const p of o.pos) {
        if (p >= b.beats - 1e-6) continue;
        for (const t of targets) push(t, p * b.sub, 0.05, -1, o.amt);
      }
    },
  };
}

/** A noise FX (`FX.*`) fired at a random beat of some bars. */
export function fxHits(id: string, kind: number, o: { prob: number; beats: number; vel?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst: 'fx', gate: o.gate, when: o.when,
    make: () => (b, push) => {
      if (!b.rng.chance(o.prob)) return;
      const p = b.rng.float(0, Math.max(0, b.beats - 1));
      note(push, b, 'fx', p, o.beats, kind, o.vel ?? 0.6);
    },
  };
}

/** One very long note, re-struck every `bars` bars (chord-bass drone; a fixed pitch class when `pc` is given). */
export function drone(id: string, inst: InstId, o: { near: number; bars: number; vel?: number; pc?: number; x?: number; gate: Gate; when?: (b: BarCtx) => boolean }): PartDef {
  return {
    id, inst, gate: o.gate,
    when: (b) => b.bar % o.bars === 0 && (o.when ? o.when(b) : true),
    make: (c) => (b, push) => {
      const m = placePc(o.pc ?? segAt(b, 0).chord.bass, o.near);
      note(push, b, c.inst, 0, b.beats * o.bars + 0.5, m, o.vel ?? 0.7, 0, o.x);
    },
  };
}

/** Reversed-pluck swell that peaks on the next bar line (Parlour's "reversed piano"). */
export function revSwell(id: string, o: { lo: number; hi: number; prob: number; vel?: number; gate: Gate }): PartDef {
  return {
    id, inst: 'pluck', gate: o.gate,
    make: (c) => (b, push) => {
      if (!b.rng.chance(o.prob)) return;
      const ch = segAt(b, b.beats - 1).chord;
      const m = nearIn(chordPcs(ch), (o.lo + o.hi) / 2 + b.rng.int(-4, 4), o.lo, o.hi);
      note(push, b, c.inst, b.beats - 1.4, 1.4, m, o.vel ?? 0.6, 0, 1);
    },
  };
}
