/**
 * Music theory for the procedural composer (CORE-AUDIO / music): pitch maths, chord-symbol parser,
 * chord-scales, voice-leading voicer and scale-step helpers. Pure functions, no WebAudio.
 */
import type { Rng } from '../../rng';

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const mod12 = (n: number): number => ((n % 12) + 12) % 12;
export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ── scales (semitone offsets from the tonic) ────────────────────────────────────────────────────
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  locrian2: [0, 2, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  wholeHalf: [0, 2, 3, 5, 6, 8, 9, 11],
  wholeTone: [0, 2, 4, 6, 8, 10],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
} as const;
export type ModeName = keyof typeof MODES;

// ── chord symbols ───────────────────────────────────────────────────────────────────────────────
interface QDef { t: number[]; s: readonly number[] }
const QUAL: Record<string, QDef> = {
  '': { t: [0, 4, 7], s: MODES.ionian },
  'maj': { t: [0, 4, 7], s: MODES.ionian },
  '6': { t: [0, 4, 7, 9], s: MODES.ionian },
  '69': { t: [0, 4, 7, 9, 14], s: MODES.ionian },
  'maj7': { t: [0, 4, 7, 11], s: MODES.ionian },
  'maj9': { t: [0, 4, 7, 11, 14], s: MODES.ionian },
  'maj13': { t: [0, 4, 7, 11, 14, 21], s: MODES.ionian },
  'maj7#11': { t: [0, 4, 7, 11, 18], s: MODES.lydian },
  'add9': { t: [0, 4, 7, 14], s: MODES.ionian },
  'm': { t: [0, 3, 7], s: MODES.dorian },
  'm6': { t: [0, 3, 7, 9], s: MODES.dorian },
  'm7': { t: [0, 3, 7, 10], s: MODES.dorian },
  'm9': { t: [0, 3, 7, 10, 14], s: MODES.dorian },
  'm11': { t: [0, 3, 7, 10, 14, 17], s: MODES.dorian },
  'm7b5': { t: [0, 3, 6, 10], s: MODES.locrian2 },
  'dim': { t: [0, 3, 6], s: MODES.wholeHalf },
  'dim7': { t: [0, 3, 6, 9], s: MODES.wholeHalf },
  'mM7': { t: [0, 3, 7, 11], s: MODES.harmonicMinor },
  '7': { t: [0, 4, 7, 10], s: MODES.mixolydian },
  '9': { t: [0, 4, 7, 10, 14], s: MODES.mixolydian },
  '13': { t: [0, 4, 7, 10, 14, 21], s: MODES.mixolydian },
  '7b9': { t: [0, 4, 7, 10, 13], s: MODES.phrygianDominant },
  '7#9': { t: [0, 4, 7, 10, 15], s: MODES.altered },
  '7#11': { t: [0, 4, 7, 10, 18], s: MODES.lydianDominant },
  '7b13': { t: [0, 4, 8, 10], s: [0, 2, 4, 5, 7, 8, 10] },
  '7alt': { t: [0, 4, 8, 10, 13], s: MODES.altered },
  '7sus4': { t: [0, 5, 7, 10], s: MODES.mixolydian },
  'sus4': { t: [0, 5, 7], s: MODES.mixolydian },
  'sus2': { t: [0, 2, 7], s: MODES.ionian },
  'aug': { t: [0, 4, 8], s: MODES.wholeTone },
  '5': { t: [0, 7], s: MODES.aeolian },
};

export interface Chord {
  name: string;
  root: number;                  // pitch class 0..11
  q: string;                     // quality suffix as written
  bass: number;                  // pitch class of the bass note (slash chords)
  tones: number[];               // semitones above the root, ascending (may exceed 12 for extensions)
  scale: number[];               // chord-scale pitch classes (absolute), ascending
  third: number;                 // offset of the third (3|4|5|2) — 0 if none
  seventh: number;               // offset of the seventh (9|10|11) — 0 if none
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parsePc(s: string): number {
  let pc = LETTER[s[0].toUpperCase()];
  if (pc === undefined) throw new Error(`bad note "${s}"`);
  for (let i = 1; i < s.length; i++) pc += s[i] === '#' ? 1 : s[i] === 'b' ? -1 : 0;
  return mod12(pc);
}

const chordCache = new Map<string, Chord>();
const CHORD_RE = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;

/** Parse a chord symbol such as `Gm9`, `C13`, `D7b9`, `Fmaj7#11`, `Bb/D`. */
export function chord(name: string): Chord {
  const hit = chordCache.get(name);
  if (hit) return hit;
  const m = CHORD_RE.exec(name);
  if (!m) throw new Error(`bad chord "${name}"`);
  const root = parsePc(m[1]);
  const q = m[2];
  const def = QUAL[q] ?? QUAL[q.replace(/^min/, 'm')] ?? QUAL[''];
  const tones = def.t.slice();
  const bass = m[3] ? parsePc(m[3]) : root;
  const third = tones.find((t) => t === 3 || t === 4 || t === 5 || t === 2) ?? 0;
  const seventh = tones.find((t) => t === 9 && q.includes('dim7')) ?? tones.find((t) => t === 10 || t === 11) ?? 0;
  const c: Chord = {
    name, root, q, bass, tones, third, seventh,
    scale: def.s.map((s) => mod12(root + s)).sort((a, b) => a - b),
  };
  chordCache.set(name, c);
  return c;
}

/** Same chord with a different quality (used for dread "souring"). */
export function reQuality(c: Chord, q: string): Chord {
  return chord(pcName(c.root) + q + (c.bass !== c.root ? '/' + pcName(c.bass) : ''));
}
const PC_NAME = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pcName = (pc: number): string => PC_NAME[mod12(pc)];

export interface Seg { at: number; len: number; chord: Chord }   // steps within the bar
/** `'Gm9 C13 | Fmaj9 | …'` → per-bar chord segments (chords in a bar share it equally). */
export function parseChart(chart: string, stepsPerBar: number): Seg[][] {
  return chart.split('|').map((b) => b.trim()).filter(Boolean).map((bar) => {
    const names = bar.split(/\s+/);
    const len = stepsPerBar / names.length;
    return names.map((n, i) => ({ at: i * len, len, chord: chord(n) }));
  });
}

// ── pitch-set helpers ───────────────────────────────────────────────────────────────────────────
const maskCache = new Map<string, boolean[]>();
export function maskOf(pcs: readonly number[]): boolean[] {
  const key = pcs.join(',');
  let m = maskCache.get(key);
  if (!m) { m = new Array<boolean>(12).fill(false); for (const p of pcs) m[mod12(p)] = true; maskCache.set(key, m); }
  return m;
}

export function chordPcs(c: Chord): number[] { return c.tones.map((t) => mod12(c.root + t)); }
export function isChordTone(m: number, c: Chord): boolean { return maskOf(chordPcs(c))[mod12(m)]; }

/** Scale to improvise over `c`: the song's own scale when the chord fits it, else the chord-scale. */
export function scaleFor(c: Chord, songScale?: readonly number[] | null): number[] {
  if (songScale && songScale.length) {
    const m = maskOf(songScale);
    if (chordPcs(c).every((p) => m[p])) return songScale.slice();
  }
  return c.scale;
}

/** Move `steps` scale degrees from `m` (first snapped down onto the scale). */
export function stepIn(m: number, steps: number, scalePcs: readonly number[]): number {
  const mask = maskOf(scalePcs);
  let n = Math.round(m);
  let guard = 0;
  while (!mask[mod12(n)] && guard++ < 12) n--;
  const dir = steps < 0 ? -1 : 1;
  let left = Math.abs(steps);
  guard = 0;
  while (left > 0 && guard++ < 400) {
    n += dir;
    if (mask[mod12(n)]) left--;
  }
  return n;
}

/** Nearest note to `m` (within ±6) whose pitch class is in `pcs`; ties go to `prefer` (+1 up / −1 down). */
export function snapTo(m: number, pcs: readonly number[], prefer = 0): number {
  const mask = maskOf(pcs);
  const r = Math.round(m);
  for (let d = 0; d <= 6; d++) {
    const up = mask[mod12(r + d)], dn = mask[mod12(r - d)];
    if (up && dn) return r + (prefer < 0 ? -d : d);
    if (up) return r + d;
    if (dn) return r - d;
  }
  return r;
}

/** Octave placement of pitch class `pc` nearest to `near`. */
export function placePc(pc: number, near: number): number {
  const base = near - mod12(near - pc);
  const up = base + 12;
  return near - base <= up - near ? base : up;
}
/** Lowest placement of `pc` that is ≥ `lo`. */
export function floorPc(pc: number, lo: number): number {
  return lo + mod12(pc - lo);
}
/** Highest placement of `pc` that is ≤ `hi`. */
export function ceilPc(pc: number, hi: number): number {
  return hi - mod12(hi - pc);
}

// ── voicing & voice leading ─────────────────────────────────────────────────────────────────────
export type VoicingKind = 'rootless' | 'full' | 'shell' | 'triad' | 'open' | 'tension';

/** The chord tones (semitones above root) a voicing kind uses, in preferred stacking order. */
export function voicingTones(c: Chord, kind: VoicingKind): number[] {
  const t = c.tones;
  const has = (x: number): boolean => t.includes(x);
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : 7;
  const ninth = has(14) ? 14 : has(13) ? 13 : has(15) ? 15 : 14;
  const thirteenth = has(21) ? 21 : has(8) && !has(7) ? 8 : 21;
  const third = c.third || 4;
  const sev = c.seventh;
  switch (kind) {
    case 'triad': return [0, third, fifth];
    case 'shell': return sev ? [0, third, sev] : [0, third, fifth];
    case 'full': return sev ? [0, third, fifth, sev, ...(t.some((x) => x > 12) ? [ninth] : [])] : [0, third, fifth];
    case 'open': return sev ? [0, fifth, sev, third + 12, ...(t.some((x) => x > 12) ? [ninth] : [])] : [0, fifth, third + 12];
    case 'tension': return [0, 1, 6, 7];
    case 'rootless':
    default: {
      if (!sev) return [0, third, fifth];                    // triads: nothing to omit
      if (sev === 10 && third === 4 && has(21)) return [third, sev, 14, 21];   // 13th chords: 3 7 9 13
      const color = t.some((x) => x > 12) ? (has(21) && !has(14) ? 21 : ninth) : 14;
      return [third, fifth, sev, color];                     // A-form 3 5 7 9 (rotations give the B-form)
    }
  }
}

export interface VoiceOpts { lo: number; hi: number; kind: VoicingKind; rng?: Rng; jitter?: number; bass?: boolean }

/**
 * Choose a voicing of `c` inside [lo, hi] that moves least from `prev` (sorted MIDI list). Every
 * rotation × octave placement is scored (movement, range, minor-second clashes, spread) and one of the
 * best three is picked with the seeded rng — this is the "3 voicing options per bar" of the jukebox.
 */
export function voice(c: Chord, prev: readonly number[] | null, o: VoiceOpts): number[] {
  const tones = voicingTones(c, o.kind);
  const pcs = tones.map((t) => mod12(c.root + t));
  const n = pcs.length;
  const centre = (o.lo + o.hi) / 2;
  const cands: Array<{ v: number[]; cost: number }> = [];
  for (let rot = 0; rot < n; rot++) {
    for (let oct = -1; oct <= 1; oct++) {
      const v: number[] = [];
      let cur = floorPc(pcs[rot], o.lo - 4) + oct * 12;
      v.push(cur);
      for (let k = 1; k < n; k++) {
        const pc = pcs[(rot + k) % n];
        cur = cur + 1 + mod12(pc - cur - 1);
        v.push(cur);
      }
      // drop-2 style widening for open voicings
      if (o.kind === 'open' && n >= 4) v[1] += 12;
      v.sort((a, b) => a - b);
      let cost = 0;
      const lowest = v[0], highest = v[v.length - 1];
      if (lowest < o.lo) cost += (o.lo - lowest) * 3;
      if (highest > o.hi) cost += (highest - o.hi) * 3;
      for (let k = 1; k < v.length; k++) {
        const gap = v[k] - v[k - 1];
        if (gap === 1) cost += 6;
        if (gap > 9) cost += (gap - 9) * 1.2;
      }
      if (prev && prev.length) {
        for (let k = 0; k < v.length; k++) cost += Math.abs(v[k] - prev[Math.min(k, prev.length - 1)]);
        cost += Math.abs(v.length - prev.length) * 1.5;
      } else {
        cost += Math.abs((lowest + highest) / 2 - centre) * 0.8;
      }
      cands.push({ v, cost });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  const pickFrom = Math.min(cands.length, o.rng ? 3 : 1);
  const jit = o.jitter ?? 1.5;
  let best = cands[0], bestScore = Infinity;
  for (let i = 0; i < pickFrom; i++) {
    const score = cands[i].cost + (o.rng ? o.rng.next() * jit : 0);
    if (score < bestScore) { bestScore = score; best = cands[i]; }
  }
  return best.v.slice();
}

/** The House motif (GDD §6.9) as semitones above the tonic + durations in beats: D F A G♯ A in D. */
export const HOUSE_MOTIF_MINOR = { iv: [0, 3, 7, 6, 7], beats: [1, 1, 1, 0.5, 3] } as const;
export const HOUSE_MOTIF_MAJOR = { iv: [0, 4, 7, 6, 7], beats: [1, 1, 1, 0.5, 3] } as const;
