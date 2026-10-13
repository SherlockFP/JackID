/**
 * The twelve jukebox songs (GDD 6.9; CORE-AUDIO / music). Each is a fixed AABA form of chord charts; the melody,
 * voicings, drum fills and solo instrument are generated per play from the seed. Jukebox songs always run at a
 * high intensity (the whole band plays), so gates here only shape the order in which layers would enter.
 */
import { D } from '../dsp';
import { ALWAYS, byI, calmOnly, type SongDef } from '../model';
import {
  accents, arp, bassPat, comp, fillPart, pad, revSwell, sidechain, solo, sparkle, theme, walk,
} from '../parts';
import { BOP, BOSSA, LOFI, MARCH68, SWING_BRUSH, SWING_RIDE, SYNTH4, TANGO, WALTZ, kit } from '../songkit';
import type { Groove } from '../parts';
import type { JukeboxTrack } from '../../types';

export interface JukeboxEntry { def: SongDef; track: JukeboxTrack }

const bright = (lo: number): ReturnType<typeof byI> => calmOnly(byI(lo), 0.45, 0.9);
const rep = (chart: string, n: number): string => Array.from({ length: n }, () => chart).join(' | ');
const barsOf = (s: SongDef): number => s.form.reduce((n, name) => n + s.sections[name].split('|').length, 0);

const LULLABY: Groove = { beats: 3, perc: [[0, D.TOCK, 0.22], [1.5, D.TICK, 0.12]] };

// 1 ─ lounge jazz ────────────────────────────────────────────────────────────────────────────────
const velvetLedger: SongDef = {
  id: 'velvet_ledger', title: 'jukebox.velvet_ledger', bpm: 96, beats: 4, sub: 4, swing: 0.63, key: 5, mode: 'ionian',
  sections: {
    A: 'Fmaj9 D7b9 | Gm9 C13 | Am7 D7b9 | Gm7 C13 | Fmaj9 Dm9 | Gm9 C13 | Am7 Abdim7 | Gm9 C13',
    B: 'Bbmaj9 | Bbm7 Eb13 | Am9 | Abm7 Db13 | Gm9 | Gm7 C13 | Abmaj7#11 | Gm7 C7alt',
    A2: 'Fmaj9 D7b9 | Gm9 C13 | Am7 D7b9 | Gm7 C13 | Fmaj9 Dm9 | Gm9 C13 | Fmaj9 D7b9 | Gm7 C7alt',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.1, lofi: 0.12, bright: 0.9, crackle: 0.04 },
  parts: [
    comp('keys', 'rhodes', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 71, vel: 0.62, gate: ALWAYS }),
    pad('strings', 'strings', { kind: 'open', lo: 48, hi: 69, vel: 0.45, gate: byI(0.5) }),
    walk('bass', 'bass', { lo: 33, hi: 53, vel: 0.9, gate: ALWAYS }),
    ...kit('d', SWING_RIDE, { ride: ALWAYS, hat: ALWAYS, kick: byI(0.15), ghost: byI(0.4), snare: byI(0.55) }, 0.9),
    fillPart(byI(0.35), 0.8),
    comp('vibes', 'vibes', { rh: 'bossa', kind: 'shell', lo: 62, hi: 80, vel: 0.36, gate: bright(0.3) }),
    theme('lead', ['trumpet', 'vibes'], { lo: 62, hi: 82, style: 'swing', vel: 0.7, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.02, orn: 0.15 }),
  ],
};

// 2 ─ bossa ──────────────────────────────────────────────────────────────────────────────────────
const bossaBottom: SongDef = {
  id: 'bossa_for_the_bottom', gain: 1.03, title: 'jukebox.bossa_for_the_bottom', bpm: 132, beats: 4, sub: 4, swing: 0.5, key: 4, mode: 'dorian',
  sections: {
    A: 'Em9 | Em9 | Am9 | Am9 | Cmaj9 | F#m7b5 B7b9 | Em9 | Em9 B7alt',
    B: 'Gmaj9 | Gmaj9 | A9 | A9 | Dmaj9 | Bm7b5 E7b9 | Am9 | F#m7b5 B7b9',
    A2: 'Em9 | Em9 | Am9 | Am9 | Cmaj9 | F#m7b5 B7b9 | Em9 | Em9',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.15, lofi: 0.1, bright: 0.95 },
  parts: [
    comp('guitar', 'pluck', { rh: 'bossa', kind: 'shell', lo: 52, hi: 72, vel: 0.62, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'bossa', lo: 33, hi: 52, vel: 0.9, gate: ALWAYS }),
    ...kit('d', BOSSA, { kick: ALWAYS, hat: ALWAYS, snare: byI(0.25), ride: byI(0.4) }, 1),
    comp('keys', 'rhodes', { rh: 'sustain', kind: 'rootless', lo: 55, hi: 73, vel: 0.38, gate: byI(0.3) }),
    theme('lead', ['flute', 'vibes'], { lo: 65, hi: 86, style: 'bossa', vel: 0.62, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.015, orn: 0.15 }),
    sparkle('spark', 'bell', { lo: 79, hi: 96, prob: 0.3, vel: 0.3, gate: bright(0.5) }),
  ],
};

// 3 ─ swing ──────────────────────────────────────────────────────────────────────────────────────
const brassElevator: SongDef = {
  id: 'brass_elevator', gain: 0.92, title: 'jukebox.brass_elevator', bpm: 168, beats: 4, sub: 4, swing: 0.64, key: 10, mode: 'ionian',
  sections: {
    A: 'Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Bbmaj7 Bb7 | Ebmaj7 Ebm7 | Dm7 G7 | Cm7 F7',
    B: 'D7 | D7 | G7 | G7 | C7 | C7 | F7 | F7',
    A2: 'Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Bbmaj7 Bb7 | Ebmaj7 Ebm7 | Bbmaj7 G7 | Cm7 F7',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.0, lofi: 0.08 },
  parts: [
    comp('piano', 'piano', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 71, vel: 0.6, gate: ALWAYS }),
    comp('brass', 'brass', { rh: 'stabs', kind: 'triad', lo: 55, hi: 74, vel: 0.4, gate: bright(0.3) }),
    walk('bass', 'bass', { lo: 33, hi: 53, vel: 0.9, gate: ALWAYS }),
    ...kit('d', SWING_RIDE, { ride: ALWAYS, hat: ALWAYS, kick: byI(0.1), ghost: byI(0.35), snare: byI(0.5) }, 0.9),
    fillPart(byI(0.3), 0.85),
    theme('lead', 'trumpet', { lo: 62, hi: 84, style: 'swing', vel: 0.72, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.012, orn: 0.2 }),
    sparkle('ding', 'bell', { lo: 84, hi: 96, prob: 0.12, vel: 0.28, gate: bright(0.5) }),
  ],
};

// 4 ─ sad waltz ──────────────────────────────────────────────────────────────────────────────────
const waltzUnpaid: SongDef = {
  id: 'waltz_of_the_unpaid', title: 'jukebox.waltz_of_the_unpaid', bpm: 84, beats: 3, sub: 4, swing: 0.5, key: 2, mode: 'aeolian',
  sections: {
    A: 'Dm | Dm/C | Bb | A7 | Dm | Gm | A7 | Dm A7',
    B: 'F | C/E | Dm | Bb | Gm7 | C7 | F | A7b9',
    A2: 'Dm | Dm/C | Bb | A7 | Dm | Gm | A7sus4 A7b9 | Dm',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.2, lofi: 0.2, tape: 1.3, bright: 0.85, crackle: 0.12 },
  parts: [
    comp('piano', 'piano', { rh: 'waltz', kind: 'triad', lo: 50, hi: 69, vel: 0.58, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'waltz', lo: 33, hi: 52, vel: 0.85, gate: ALWAYS }),
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 70, vel: 0.5, gate: byI(0.3) }),
    ...kit('d', WALTZ, { kick: byI(0.35), snare: byI(0.45), ride: byI(0.3), hat: byI(0.5) }, 0.9),
    theme('lead', ['reed', 'flute'], { lo: 62, hi: 84, style: 'waltz', vel: 0.62, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.02, orn: 0.18 }),
    sparkle('box', 'box', { lo: 79, hi: 98, prob: 0.4, vel: 0.3, gate: bright(0.4) }),
  ],
};

// 5 ─ synthwave ──────────────────────────────────────────────────────────────────────────────────
const neonUndertow: SongDef = {
  id: 'neon_undertow', gain: 1.1, title: 'jukebox.neon_undertow', bpm: 104, beats: 4, sub: 4, swing: 0.5, key: 9, mode: 'aeolian', human: 0.15,
  sections: {
    A: 'Am | F | C | G | Am | F | C | G',
    B: 'F | G | Am | Em | F | G | E7 | E7',
    A2: 'Am | F | C | G | Am | F | G | E7',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 0.9, hall: 0.4, lofi: 0.15, bright: 1 },
  parts: [
    bassPat('bass', 'synBass', { pat: 'pump', lo: 28, hi: 47, vel: 0.8, gate: ALWAYS }),
    pad('pad', 'synPad', { kind: 'open', lo: 52, hi: 73, vel: 0.55, gate: ALWAYS }),
    arp('arp', 'synArp', { lo: 57, hi: 84, step: 0.5, mode: 'updown', vel: 0.5, gate: byI(0.3) }),
    theme('lead', 'synLead', { lo: 64, hi: 88, style: 'straight', vel: 0.55, gate: calmOnly(byI(0.4), 0.55, 0.95), orn: 0.1 }),
    ...kit('d', SYNTH4, { kick: ALWAYS, snare: byI(0.2), ghost: byI(0.35), hat: byI(0.1), ride: byI(0.5) }, 0.95),
    sidechain('sc', ['synPad', 'synArp'], { pos: [0, 1.5, 2, 3.5], amt: 0.5, gate: ALWAYS }),
  ],
};

// 6 ─ creepy carnival 6/8 ────────────────────────────────────────────────────────────────────────
const carnivalTeeth: SongDef = {
  id: 'carnival_of_teeth', title: 'jukebox.carnival_of_teeth', bpm: 116, beats: 2, sub: 3, swing: 0.5, key: 1, mode: 'phrygian',
  sections: {
    A: rep('C#m | D | C#m | B | C#m | D | Bsus4 B | G#7b9', 2),
    B: rep('F#m | F#m | C#m | C#m | D | D | C#m | G#7', 2),
    A2: rep('C#m | D | C#m | B | C#m | D | C#m B | C#m', 2),
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.1, hall: 0.5, lofi: 0.25, tape: 1.6, bright: 0.9 },
  parts: [
    bassPat('bass', 'tuba', { pat: 'six', lo: 28, hi: 48, vel: 0.8, gate: ALWAYS }),
    comp('oompah', 'piano', { rh: 'six', kind: 'triad', lo: 50, hi: 68, vel: 0.5, gate: byI(0.2) }),
    theme('lead', ['calliope', 'reed'], { lo: 64, hi: 88, style: 'carnival', vel: 0.6, gate: ALWAYS, orn: 0.2 }),
    arp('box', 'box', { lo: 72, hi: 96, step: 1 / 3, mode: 'updown', vel: 0.4, gate: byI(0.4) }),
    ...kit('d', MARCH68, { kick: byI(0.1), snare: byI(0.2), ghost: byI(0.5), hat: byI(0.3) }, 0.9),
    sparkle('bell', 'bell', { lo: 84, hi: 100, prob: 0.5, vel: 0.3, gate: byI(0.5) }),
  ],
};

// 7 ─ hard bop ───────────────────────────────────────────────────────────────────────────────────
const diceBoiler: SongDef = {
  id: 'dice_in_the_boiler', gain: 0.9, title: 'jukebox.dice_in_the_boiler', bpm: 180, beats: 4, sub: 4, swing: 0.65, key: 7, mode: 'aeolian',
  sections: {
    A: 'Gm7 | Cm7 | Gm7 | Eb7 D7 | Gm7 | Cm7 | Am7b5 D7b9 | Gm7 D7alt',
    B: 'Bbmaj7 | Bbmaj7 | Ebmaj7 | Ebmaj7 | Am7b5 | D7b9 | Gm7 | Gm7 D7b9',
    A2: 'Gm7 | Cm7 | Gm7 | Eb7 D7 | Gm7 | Cm7 | Am7b5 D7b9 | Gm7',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 0.9, lofi: 0.2, tape: 1.2 },
  parts: [
    comp('organ', 'organ', { rh: 'stabs', kind: 'rootless', lo: 50, hi: 68, vel: 0.55, gate: ALWAYS }),
    walk('bass', 'bass', { lo: 31, hi: 52, vel: 0.9, gate: ALWAYS }),
    ...kit('d', BOP, { ride: ALWAYS, hat: ALWAYS, kick: byI(0.1), snare: byI(0.3), ghost: byI(0.35) }, 0.9),
    fillPart(byI(0.3), 0.9),
    theme('lead', ['trumpet', 'reed'], { lo: 60, hi: 82, style: 'swing', vel: 0.7, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.01, orn: 0.2 }),
    solo('solo', 'vibes', { lo: 60, hi: 84, prob: 0.75, dense: true, vel: 0.5, gate: bright(0.5), when: (b) => b.sec === 'B' }),
  ],
};

// 8 ─ tango ──────────────────────────────────────────────────────────────────────────────────────
const roundRound: SongDef = {
  id: 'round_and_round', title: 'jukebox.round_and_round', bpm: 120, beats: 4, sub: 4, swing: 0.5, key: 9, mode: 'aeolian',
  sections: {
    A: 'Am | Dm | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7b9 | Am',
    B: 'Dm | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7b9 | Am | E7',
    A2: 'Am | Dm | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7b9 | Am E7',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.0, hall: 0.6, lofi: 0.18, bright: 0.95 },
  parts: [
    bassPat('bass', 'bass', { pat: 'tango', lo: 31, hi: 52, vel: 0.9, gate: ALWAYS }),
    comp('piano', 'piano', { rh: 'tango', kind: 'triad', lo: 50, hi: 70, vel: 0.6, gate: ALWAYS }),
    pad('strings', 'strings', { kind: 'open', lo: 48, hi: 72, vel: 0.5, gate: byI(0.3) }),
    ...kit('d', TANGO, { kick: byI(0.1), snare: byI(0.3), ghost: byI(0.5), perc: byI(0.2), hat: byI(0.4) }, 0.9),
    theme('lead', 'reed', { lo: 62, hi: 86, style: 'tango', vel: 0.64, gate: calmOnly(ALWAYS, 0.55, 0.95), orn: 0.2 }),
  ],
};

// 9 ─ music box ──────────────────────────────────────────────────────────────────────────────────
const lullabyMannequins: SongDef = {
  id: 'lullaby_for_mannequins', gain: 1.3, title: 'jukebox.lullaby_for_mannequins', bpm: 72, beats: 3, sub: 4, swing: 0.5, key: 3, mode: 'ionian',
  sections: {
    A: 'Eb | Cm | Ab | Bb7 | Eb | Cm | Fm | Bb7',
    B: 'Ab | Eb/G | Fm | Bb7 | Ab | Bbm | Cm | Bb7',
    A2: 'Eb | Cm | Ab | Bb7 | Eb Ab | Eb/G Bb7 | Eb | Eb',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.3, hall: 0.9, lofi: 0.3, tape: 1.8, bright: 0.85 },
  parts: [
    theme('lead', 'box', { lo: 74, hi: 98, style: 'lullaby', vel: 0.58, gate: ALWAYS, orn: 0.12 }),
    arp('harp', 'harp', { lo: 55, hi: 79, step: 1, mode: 'up', vel: 0.5, gate: byI(0.25) }),
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 72, vel: 0.5, gate: bright(0.5), x: 2 }),
    bassPat('bass', 'bass', { pat: 'sustain', lo: 33, hi: 50, vel: 0.5, gate: byI(0.2) }),
    sparkle('bell', 'bell', { lo: 84, hi: 100, prob: 0.5, vel: 0.28, gate: ALWAYS }),
    ...kit('d', LULLABY, { perc: ALWAYS }, 0.9),
  ],
};

// 10 ─ torch song ────────────────────────────────────────────────────────────────────────────────
const lastOrders: SongDef = {
  id: 'last_orders', title: 'jukebox.last_orders', bpm: 76, beats: 4, sub: 4, swing: 0.6, key: 1, mode: 'ionian',
  sections: {
    A: 'Dbmaj7 Bbm7 | Ebm7 Ab13 | Dbmaj7 Bbm7 | Ebm7 Ab7 | Gbmaj7 Gbm6 | Dbmaj7 Bbm7 | Ebm7 Ab13 | Dbmaj7 Ab7b9',
    B: 'Gbmaj7 | Gbm7 Cb7 | Dbmaj7 | Bb7b9 | Ebm9 | Ab13 | Dbmaj7 Bbm7 | Ebm7 Ab7alt',
    A2: 'Dbmaj7 Bbm7 | Ebm7 Ab13 | Dbmaj7 Bbm7 | Ebm7 Ab7 | Gbmaj7 Gbm6 | Dbmaj7 Bbm7 | Ebm7 Ab13 | Dbmaj9',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.25, hall: 0.7, lofi: 0.2, tape: 1.2, bright: 0.85, crackle: 0.1 },
  parts: [
    comp('keys', 'rhodes', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 71, vel: 0.6, gate: ALWAYS }),
    walk('bass', 'bass', { lo: 31, hi: 51, vel: 0.85, gate: byI(0.1) }),
    ...kit('d', SWING_BRUSH, { ride: byI(0.15), snare: byI(0.3), kick: byI(0.25), hat: byI(0.4), ghost: byI(0.5) }, 0.9),
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 70, vel: 0.5, gate: byI(0.4) }),
    theme('lead', 'trumpet', { lo: 60, hi: 80, style: 'ballad', vel: 0.7, gate: calmOnly(ALWAYS, 0.55, 0.95), lag: 0.03, orn: 0.15 }),
    sparkle('spark', 'vibes', { lo: 72, hi: 90, prob: 0.35, vel: 0.3, gate: bright(0.45) }),
  ],
};

// 11 ─ organ + choir ─────────────────────────────────────────────────────────────────────────────
const staticHymn: SongDef = {
  id: 'static_hymn', gain: 0.9, title: 'jukebox.static_hymn', bpm: 60, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'dorian',
  sections: {
    A: 'Dm7 | G7 | Dm7 | Cmaj7 | Dm7 | G7 | Am7 | Dm7',
    B: 'Bbmaj7#11 | Cmaj7 | Bbmaj7#11 | Am7 | G7 | Cmaj7 | Em7b5 | A7sus4',
    A2: 'Dm7 | G7 | Dm7 | Cmaj7 | Dm7 | G7 | Am7 | Dm7 A7sus4',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.3, hall: 1.0, lofi: 0.55, tape: 1.7, bright: 0.8, crackle: 0.45 },
  parts: [
    pad('organ', 'organ', { kind: 'open', lo: 38, hi: 66, vel: 0.6, gate: ALWAYS, x: 1 }),
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 74, vel: 0.55, gate: byI(0.2), x: 2 }),
    theme('lead', 'choir', { lo: 57, hi: 76, style: 'ballad', vel: 0.55, gate: byI(0.4), lag: 0.04 }),
    accents('bell', 'bell', { pos: [0], lo: 74, hi: 88, vel: 0.3, gate: bright(0.5), dur: 4 }),
    revSwell('rev', { lo: 55, hi: 79, prob: 0.35, vel: 0.5, gate: byI(0.3) }),
  ],
};

// 12 ─ lo-fi ─────────────────────────────────────────────────────────────────────────────────────
const topsideRain: SongDef = {
  id: 'topside_rain', title: 'jukebox.topside_rain', bpm: 88, beats: 4, sub: 4, swing: 0.57, key: 6, mode: 'aeolian',
  sections: {
    A: 'F#m9 | Dmaj9 | Amaj7 | C#7sus4 C#7b9 | F#m9 | Dmaj9 | Bm9 | C#7alt',
    B: 'Dmaj9 | C#m7 | Bm9 | C#7alt | Dmaj9 | Amaj7 | Bm9 | C#7b9',
    A2: 'F#m9 | Dmaj9 | Amaj7 | C#7sus4 C#7b9 | F#m9 | Dmaj9 | Bm9 C#7 | F#m9',
  },
  form: ['A', 'A', 'B', 'A2'],
  fx: { room: 1.2, hall: 0.5, lofi: 0.85, tape: 1.4, bright: 0.7, crackle: 0.55, rain: 0.7 },
  parts: [
    comp('keys', 'rhodes', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 71, vel: 0.62, gate: ALWAYS }),
    pad('pad', 'strings', { kind: 'open', lo: 46, hi: 68, vel: 0.35, gate: byI(0.4) }),
    bassPat('bass', 'bass', { pat: 'halves', lo: 31, hi: 50, vel: 0.8, gate: ALWAYS }),
    ...kit('d', LOFI, { kick: ALWAYS, snare: byI(0.2), hat: byI(0.15), ghost: byI(0.4), ride: byI(0.5) }, 0.85),
    theme('lead', ['vibes', 'bell'], { lo: 66, hi: 88, style: 'ballad', vel: 0.55, gate: bright(0.3), lag: 0.03, orn: 0.1 }),
    sparkle('spark', 'bell', { lo: 79, hi: 96, prob: 0.3, vel: 0.26, gate: bright(0.5) }),
  ],
};

const SONGS: Array<[SongDef, string, string?]> = [
  [velvetLedger, 'lounge'], [bossaBottom, 'bossa'], [brassElevator, 'swing'], [waltzUnpaid, 'waltz'],
  [neonUndertow, 'synthwave'], [carnivalTeeth, 'carnival'], [diceBoiler, 'hardbop', 'cassette'],
  [roundRound, 'tango', 'cassette'], [lullabyMannequins, 'music-box', 'cassette'], [lastOrders, 'noir', 'cassette'],
  [staticHymn, 'hymn', 'cassette'], [topsideRain, 'lofi', 'win'],
];

/** Jukebox songs in menu order. The `track` metadata is what `MusicApi.catalog()` returns. */
export const JUKEBOX: readonly JukeboxEntry[] = SONGS.map(([def, genre, unlock]) => ({
  def,
  // unlock key: `cassette:<trackId>` (a cassette prize, GDD 6.11) or `win` (win a run once); absent = available from the start
  track: { id: def.id, titleKey: def.title, genre, bpm: def.bpm, bars: barsOf(def), ...(unlock ? { unlock: unlock === 'cassette' ? `cassette:${def.id}` : unlock } : {}) },
}));
