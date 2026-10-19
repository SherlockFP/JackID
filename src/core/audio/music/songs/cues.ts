/**
 * High-stakes cues (CORE-AUDIO / music): the duel themes, the Burning Wager, Last Call and the jackpot chase. Same
 * format as the beds; the conductor (`music/index.ts`) picks them from bus events. A duel theme's "final round"
 * layers are gated by the stakes (`byS`), which the conductor raises to 0.85 on a final round.
 *
 * Last Call and the chase hit / miss are built from the bed that is playing (`lastCallOf`, `hitOf`, `missOf`), so
 * they share its key (Last Call also its chart, +15 % tempo).
 */
import { D } from '../dsp';
import { FX } from '../instruments';
import { ALWAYS, byI, byS, type PartDef, type SongDef } from '../model';
import {
  arp, bassPat, comp, drone, drumLane, fillPart, fxHits, heartPulse, motif, note, pad, revSwell, theme, walk, type Groove,
} from '../parts';
import { SWING_BRUSH, SWING_RIDE, WALTZ, kit } from '../songkit';
import { pcName } from '../theory';

/** Final-round gate: in at stakes 0.7 (a final round is 0.85, an ordinary round 0.35). */
const FINAL = byS(0.7);

// ── LUCAN: a cold minor waltz on harpsichord ─────────────────────────────────────────────────────
const lucan: SongDef = {
  id: 'duel_lucan', title: 'Lucan', bpm: 138, beats: 3, sub: 4, swing: 0.5, key: 2, mode: 'harmonicMinor', human: 0.5,
  sections: {
    A: 'Dm | Dm/C | Bbmaj7 | A7 | Gm | Dm/F | Em7b5 | A7',
    B: 'Gm | C7 | Fmaj7 | Bbmaj7 | Em7b5 | A7 | Dm | A7b9',
  },
  form: ['A', 'A', 'B', 'A'],
  fx: { room: 1.2, hall: 0.9, lofi: 0.08, bright: 0.95 },
  iFloor: 0.5,
  parts: [
    comp('harpsi', 'harpsi', { rh: 'waltz', kind: 'triad', lo: 55, hi: 74, vel: 0.62, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'waltz', lo: 31, hi: 50, vel: 0.75, gate: ALWAYS }),
    theme('lead', 'harpsi', { lo: 67, hi: 88, style: 'waltz', vel: 0.6, gate: ALWAYS, orn: 0.25 }),
    pad('cold', 'strings', { kind: 'open', lo: 50, hi: 72, vel: 0.28, gate: ALWAYS }),
    ...kit('d', WALTZ, { kick: byI(0.3), snare: byI(0.5), hat: byI(0.4) }, 0.7),
    // final round: the harpsichord runs in sixteenths, the strings tighten, the timpani walk, the choir comes in
    arp('run', 'harpsi', { lo: 62, hi: 86, step: 0.25, mode: 'updown', vel: 0.42, gate: FINAL }),
    pad('tension', 'strings', { kind: 'tension', lo: 46, hi: 70, vel: 0.5, gate: FINAL }),
    drone('timp', 'sub', { near: 31, bars: 2, vel: 0.7, gate: FINAL }),
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 72, vel: 0.5, gate: byS(0.8), x: 2 }),
    heartPulse(byS(0.8), 0.8),
  ],
};

// ── TAMSIN: a jazzy noir walk ────────────────────────────────────────────────────────────────────
const tamsin: SongDef = {
  id: 'duel_tamsin', title: 'Tamsin', bpm: 88, beats: 4, sub: 4, swing: 0.64, key: 0, mode: 'dorian',
  sections: {
    A: 'Cm9 | Fm9 | Dm7b5 G7b9 | Cm9 | Abmaj7 | Fm9 | Dm7b5 | G7alt',
    B: 'Ebmaj7 | Abmaj7 | Dm7b5 | G7b9 | Cm9 | Ab7 | Dm7b5 G7alt | Cm9',
  },
  form: ['A', 'A', 'B', 'A'],
  fx: { room: 1.15, lofi: 0.2, bright: 0.85, crackle: 0.08 },
  iFloor: 0.45,
  parts: [
    walk('bass', 'bass', { lo: 31, hi: 52, vel: 0.9, gate: ALWAYS }),
    comp('piano', 'piano', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 70, vel: 0.5, gate: ALWAYS }),
    ...kit('brush', SWING_BRUSH, { ride: ALWAYS, snare: ALWAYS, kick: ALWAYS, hat: ALWAYS }, 0.85),
    theme('lead', 'trumpet', { lo: 60, hi: 80, style: 'swing', vel: 0.62, gate: ALWAYS, lag: 0.03, orn: 0.2 }),
    comp('vibes', 'vibes', { rh: 'sustain', kind: 'shell', lo: 62, hi: 80, vel: 0.26, gate: byI(0.5) }),
    // final round: the ride takes over from the brushes, the brass stabs and the strings close in
    ...kit('d', SWING_RIDE, { ride: FINAL, ghost: FINAL, snare: FINAL }, 0.9),
    fillPart(FINAL, 0.85),
    comp('stabs', 'brass', { rh: 'stab16', kind: 'triad', lo: 53, hi: 72, vel: 0.4, gate: FINAL }),
    pad('tension', 'strings', { kind: 'tension', lo: 46, hi: 70, vel: 0.45, gate: FINAL }),
    drone('sub', 'sub', { near: 31, bars: 4, pc: 0, vel: 0.6, gate: byS(0.8) }),
  ],
};

// ── ADA'S KITCHEN WAGER: an intimate music box that turns dark ───────────────────────────────────
const LULL: Groove = { beats: 3, perc: [[0, D.TOCK, 0.2], [1.5, D.TICK, 0.12]] };
const ada: SongDef = {
  id: 'duel_ada', title: 'Kitchen Wager', bpm: 76, beats: 3, sub: 4, swing: 0.5, key: 5, mode: 'ionian', human: 0.6,
  sections: {
    A: 'F | Dm | Bb | C7 | F | Am | Bb C7 | F',
    // the same tune in the parallel minor: the room has gone cold
    B: 'Fm | Db | Bbm | C7 | Fm | Db | Bbm C7 | Fm',
  },
  form: ['A', 'A', 'B', 'B'],
  fx: { room: 1.3, hall: 1.0, lofi: 0.3, tape: 1.6, bright: 0.85, crackle: 0.1 },
  parts: [
    theme('box', 'box', { lo: 72, hi: 96, style: 'lullaby', vel: 0.55, gate: ALWAYS, orn: 0.1 }),
    comp('harp', 'harp', { rh: 'waltz', kind: 'triad', lo: 55, hi: 74, vel: 0.36, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'waltz', lo: 33, hi: 50, vel: 0.5, gate: byI(0.2) }),
    ...kit('l', LULL, { perc: ALWAYS }, 1),
    // dark: the reversed swells, the drone and the sour strings; the final round adds the heart and the choir
    revSwell('rev', { lo: 55, hi: 79, prob: 0.4, vel: 0.45, gate: byS(0.5) }),
    drone('pedal', 'drone', { near: 41, bars: 4, pc: 5, vel: 0.5, gate: FINAL }),
    pad('tension', 'strings', { kind: 'tension', lo: 46, hi: 70, vel: 0.42, gate: FINAL, when: (b) => b.sec === 'B' || b.secBar % 2 === 0 }),
    heartPulse(byS(0.8), 0.9),
    pad('choir', 'choir', { kind: 'open', lo: 48, hi: 70, vel: 0.42, gate: byS(0.8), x: 2 }),
  ],
};

// ── THE BURNING WAGER (Night 8 final): full epic ─────────────────────────────────────────────────
const EPIC: Groove = {
  beats: 4,
  kick: [[0, D.BOOM, 1], [2, D.BOOM, 0.85], [2.5, D.KICK, 0.6]],
  snare: [[1, D.SNARE, 0.7], [3, D.SNARE, 0.8]],
  perc: [[0.5, D.TOM_LO, 0.5], [1.5, D.TOM_MID, 0.45], [1.75, D.TOM_MID, 0.4], [3.5, D.TOM_LO, 0.55], [3.75, D.TOM_LO, 0.6]],
  hat: [[0, D.HAT, 0.3], [0.5, D.HAT, 0.2], [1, D.HAT, 0.3], [1.5, D.HAT, 0.2], [2, D.HAT, 0.3], [2.5, D.HAT, 0.2], [3, D.HAT, 0.3], [3.5, D.HAT, 0.2]],
  ride: [[0, D.CRASH, 0.6]],
};
const burning: SongDef = {
  id: 'burning_wager', gain: 0.9, title: 'The Burning Wager', bpm: 100, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian', human: 0.3,
  sections: {
    // i – VI – III – VII, the heroic minor climb; B lifts to the relative major and lands on the V
    A: 'Dm | Bb | F | C | Dm | Bb | Gm | A',
    B: 'Bb | C | Dm | Dm | Bb | C | Asus4 | A',
  },
  form: ['A', 'A', 'B', 'A'],
  fx: { room: 1.1, hall: 1.2, lofi: 0.05, bright: 1 },
  iFloor: 0.8,
  parts: [
    ...kit('d', EPIC, { kick: ALWAYS, snare: byI(0.85), perc: ALWAYS, hat: byI(0.9) }, 1),
    drumLane('d.crash', EPIC, 'ride', ALWAYS, 1, (b) => b.secBar === 0),
    fillPart(ALWAYS, 1),
    bassPat('bass', 'synBass', { pat: 'root8', lo: 26, hi: 43, vel: 0.8, gate: ALWAYS }),
    drone('sub', 'sub', { near: 31, bars: 2, vel: 0.7, gate: ALWAYS }),
    arp('ostinato', 'harp', { lo: 50, hi: 74, step: 0.25, mode: 'updown', vel: 0.5, gate: ALWAYS }),
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 74, vel: 0.55, gate: ALWAYS }),
    comp('brass', 'brass', { rh: 'stabs', kind: 'triad', lo: 50, hi: 72, vel: 0.6, gate: ALWAYS }),
    motif('horns', 'brass', { lo: 58, hi: 79, vel: 0.72, prob: 1, gate: ALWAYS }),
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 76, vel: 0.62, gate: ALWAYS, x: 2 }),
    theme('lead', 'trumpet', { lo: 64, hi: 86, style: 'straight', vel: 0.55, gate: byS(0.85), when: (b) => b.sec === 'B' }),
    fxHits('riser', FX.RISER, { prob: 1, beats: 4, vel: 0.45, gate: ALWAYS, when: (b) => b.lastOfSec }),
  ],
};

// ── JACKPOT CHASE: the last reel turns over a heartbeat ──────────────────────────────────────────
const reelChase: SongDef = {
  id: 'reel_chase', title: 'Last Reel', bpm: 66, beats: 4, sub: 4, swing: 0.5, key: 0, mode: 'aeolian',
  sections: { A: 'Cm' },
  form: ['A'],
  fx: { room: 0.6, lofi: 0, bright: 0.9 },
  parts: [heartPulse(ALWAYS, 1.1)],
};

// ── built from the playing bed ───────────────────────────────────────────────────────────────────
/** Tick-tock on the beat, sixteenths in the last bar of a section: tempo-locked, unlike the counting room's clock. */
const clock = (): PartDef => ({
  id: 'lc.clock', inst: 'drums', gate: ALWAYS,
  make: () => (b, push) => {
    const step = b.lastOfSec ? 0.25 : 0.5;
    for (let p = 0; p < b.beats - 1e-6; p += step) {
      const on = Math.abs(p % 1) < 1e-6;
      note(push, b, 'drums', p, 0.1, on ? D.TICK : D.TOCK, (on ? 0.62 : 0.4) * (0.75 + 0.35 * b.energy));
    }
  },
});

/** LAST CALL: the bed itself, 15 % faster, with a ticking clock, strings tightening and a riser into each section. */
export function lastCallOf(bed: SongDef): SongDef {
  return {
    ...bed, id: `lastcall@${bed.id}`, title: 'Last Call', bpm: Math.round(bed.bpm * 1.15), tempoFollowsIntensity: false,
    iFloor: Math.max(bed.iFloor ?? 0, 0.65),
    parts: [
      ...bed.parts,
      clock(),
      pad('lc.tension', 'strings', { kind: 'tension', lo: 48, hi: 72, vel: 0.4, gate: ALWAYS, when: (b) => b.energy > 0.3 }),
      fxHits('lc.riser', FX.RISER, { prob: 1, beats: 4, vel: 0.4, gate: ALWAYS, when: (b) => b.lastOfSec }),
    ],
  };
}

/** The chase HIT: two bars of bVI – bVII – I fanfare in the bed's key, then the conductor hands back to the bed. */
export function hitOf(bed: SongDef): SongDef {
  const k = bed.key, n = pcName;
  return {
    id: `chase_hit@${bed.id}`, title: 'Chase Hit', gain: 0.95, bpm: 120, beats: 4, sub: 4, swing: 0.5, key: k, mode: 'ionian', oneShot: true,
    sections: { A: `${n(k + 8)} ${n(k + 10)} | ${n(k)}` },
    form: ['A'],
    fx: { room: 1.0, hall: 1.0, lofi: 0, bright: 1 },
    iFloor: 1,
    parts: [
      { id: 'hit.drums', inst: 'drums', gate: ALWAYS, make: () => (b, push) => {
        note(push, b, 'drums', 0, 0.1, D.CRASH, 0.9); note(push, b, 'drums', 0, 0.1, D.BOOM, 1);
        if (b.bar === 0) for (const p of [2, 3, 3.5]) note(push, b, 'drums', p, 0.1, D.TOM_MID, 0.7);
      } },
      comp('brass', 'brass', { rh: 'stab16', kind: 'triad', lo: 55, hi: 79, vel: 0.75, gate: ALWAYS }),
      pad('strings', 'strings', { kind: 'open', lo: 48, hi: 76, vel: 0.6, gate: ALWAYS }),
      pad('choir', 'choir', { kind: 'open', lo: 52, hi: 76, vel: 0.55, gate: ALWAYS, x: 0.4 }),
      arp('bells', 'bell', { lo: 79, hi: 103, step: 0.25, mode: 'up', vel: 0.45, gate: ALWAYS }),
      bassPat('bass', 'bass', { pat: 'root8', lo: 31, hi: 50, vel: 0.85, gate: ALWAYS }),
    ],
  };
}

/** The chase MISS: the air goes out — a falling suck over a minor iv – i in the bed's key, quiet. */
export function missOf(bed: SongDef): SongDef {
  const k = bed.key, n = pcName;
  return {
    id: `chase_miss@${bed.id}`, title: 'Chase Miss', gain: 0.8, bpm: 70, beats: 4, sub: 4, swing: 0.5, key: k, mode: 'aeolian', oneShot: true,
    sections: { A: `${n(k + 5)}m | ${n(k)}m` },
    form: ['A'],
    fx: { room: 1.3, hall: 1.1, lofi: 0.3, tape: 2.0, bright: 0.6 },
    parts: [
      { id: 'miss.air', inst: 'fx', gate: ALWAYS, when: (b) => b.bar === 0, make: () => (b, push) => note(push, b, 'fx', 0, 2.5, FX.SUCK, 0.6) },
      pad('strings', 'strings', { kind: 'open', lo: 46, hi: 66, vel: 0.4, gate: ALWAYS }),
      bassPat('bass', 'bass', { pat: 'sustain', lo: 31, hi: 46, vel: 0.5, gate: ALWAYS }),
    ],
  };
}

/** The cues with a fixed song, by id. */
export const CUES: Readonly<Record<string, SongDef>> = Object.fromEntries([lucan, tamsin, ada, burning, reelChase].map((s) => [s.id, s]));
