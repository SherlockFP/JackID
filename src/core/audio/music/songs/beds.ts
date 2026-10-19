/**
 * The adaptive beds (CORE-AUDIO / music): menu theme, the zone themes of GDD 6.9, elevator, cutscene underscore,
 * chase, jackpot, defeat and ending. Every bed layers over the whole intensity range (calm → tense) and wears
 * the dread overlay (`withHorror`). The conductor in `music.ts` maps macro-states and zones onto these ids.
 */
import { D } from '../dsp';
import { FX } from '../instruments';
import { ALWAYS, bandI, byI, calmOnly, outI, type SongDef } from '../model';
import {
  accents, arp, bassPat, comp, drone, drumLane, fillPart, fxHits, hatRun, heartPulse, motif, pad, pulse, revSwell,
  sidechain, solo, sparkle, theme, walk, type Groove,
} from '../parts';
import { BALLAD, BOP, BOSSA, CHASE, MARCH68, SWING_BRUSH, SWING_RIDE, SYNTH4, TANGO, kit, withHorror } from '../songkit';
import { withStakes } from '../stakes';
import { CUES, hitOf, lastCallOf, missOf } from './cues';

const bright = (lo: number): ReturnType<typeof byI> => calmOnly(byI(lo), 0.4, 0.8);
const rep = (chart: string, n: number): string => Array.from({ length: n }, () => chart).join(' | ');
const AABA = ['A', 'A', 'B', 'A'];

// ── MENU: "Inside the Jackpot" ──────────────────────────────────────────────────────────────────
/** Slot reels clacking on the beat; the last bar of every phrase rolls. */
const REEL: Groove = {
  beats: 4,
  perc: [[0, D.CLACK, 0.34], [1, D.CLACK, 0.2], [2, D.CLACK, 0.26], [3, D.CLACK, 0.2]],
  ghost: [[3, D.CLACK, 0.2], [3.25, D.CLACK, 0.26], [3.5, D.CLACK, 0.32], [3.75, D.CLACK, 0.42]],
};

const menu: SongDef = withHorror({
  id: 'menu', title: 'Inside the Jackpot', bpm: 84, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian', tempoFollowsIntensity: false,
  sections: {
    A: 'Dm9 | Bbmaj7 | Gm9 | A7b9 | Dm9 | Bbmaj7#11 | Gm9 | A7b9',
    B: 'Bbmaj7 | Gm9 | Dm9 | A7alt | Bbmaj7 | Gm9 | A7b9 | A7b9',
  },
  form: AABA,
  fx: { room: 1.3, hall: 1.1, lofi: 0.3, tape: 1.8, bright: 0.85 },
  iFloor: 0.5,
  parts: [
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 72, vel: 0.5, gate: ALWAYS, x: 2 }),
    comp('keys', 'rhodes', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 70, vel: 0.55, gate: ALWAYS }),
    motif('motif', 'box', { lo: 74, hi: 98, vel: 0.62, prob: 1, gate: ALWAYS }),
    theme('lead', 'box', { lo: 74, hi: 98, style: 'lullaby', vel: 0.48, gate: byI(0.1), when: (b) => b.phraseBar !== 0, orn: 0.1 }),
    bassPat('bass', 'bass', { pat: 'halves', lo: 31, hi: 50, vel: 0.7, gate: byI(0.15) }),
    ...kit('reel', REEL, { perc: ALWAYS }, 0.9),
    drumLane('reel.roll', REEL, 'ghost', byI(0.2), 0.9, (b) => b.phraseBar === 3),
    ...kit('d', BALLAD, { kick: byI(0.3), ride: byI(0.35), snare: byI(0.5) }, 0.8),
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 70, vel: 0.4, gate: byI(0.4) }),
    sparkle('glit1', 'bell', { lo: 84, hi: 103, prob: 0.8, vel: 0.3, gate: ALWAYS }),
    sparkle('glit2', 'harp', { lo: 72, hi: 96, prob: 0.5, vel: 0.4, gate: byI(0.2) }),
    fxHits('whisper', FX.WHISPER, { prob: 0.1, beats: 5, vel: 0.35, gate: ALWAYS }),
    revSwell('rev', { lo: 55, hi: 79, prob: 0.2, vel: 0.45, gate: ALWAYS }),
  ],
});

// ── THE LOUNGE (Mouth / Well / Lobby) ───────────────────────────────────────────────────────────
const lounge: SongDef = withHorror({
  id: 'lounge', title: 'The Lounge', bpm: 92, beats: 4, sub: 4, swing: 0.62, key: 5, mode: 'ionian', tempoFollowsIntensity: true,
  sections: {
    A: 'Gm9 | C13 | Fmaj9 | D7b9 | Gm9 | C13 | Fmaj9 Dm9 | Gm9 C13',
    B: 'Bbmaj9 | Bbm7 Eb13 | Am9 | D7b9 | Gm9 | C13 | Fmaj9 | Fmaj9',
  },
  form: AABA,
  fx: { room: 1.1, lofi: 0.15, bright: 0.95, crackle: 0.05 },
  parts: [
    comp('keys0', 'rhodes', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 70, vel: 0.55, gate: outI(0.4, 0.6) }),
    comp('keys', 'rhodes', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 70, vel: 0.58, gate: byI(0.45) }),
    bassPat('bass0', 'bass', { pat: 'halves', lo: 33, hi: 52, vel: 0.8, gate: outI(0.1, 0.25) }),
    walk('bass', 'bass', { lo: 33, hi: 53, vel: 0.88, gate: byI(0.14) }),
    ...kit('brush', SWING_BRUSH, { ride: bandI(0.2, 0.62), snare: bandI(0.25, 0.62), kick: bandI(0.3, 0.62) }, 0.9),
    ...kit('d', SWING_RIDE, { ride: byI(0.58), hat: byI(0.3), kick: byI(0.62), ghost: byI(0.5), snare: byI(0.62) }, 0.85),
    fillPart(byI(0.4), 0.8),
    comp('vibes', 'vibes', { rh: 'bossa', kind: 'shell', lo: 62, hi: 80, vel: 0.34, gate: bright(0.3) }),
    theme('lead', 'vibes', { lo: 64, hi: 84, style: 'swing', vel: 0.55, gate: bright(0.35), lag: 0.02, orn: 0.15 }),
    solo('trumpet', 'trumpet', { lo: 62, hi: 82, prob: 0.85, vel: 0.62, gate: bright(0.3), when: (b) => b.bar % 32 >= 16 && b.bar % 32 < 24 }),
    motif('motif', 'bell', { lo: 74, hi: 92, vel: 0.4, prob: 0.5, gate: byI(0.15) }),
    pad('tension', 'strings', { kind: 'open', lo: 46, hi: 68, vel: 0.42, gate: byI(0.65) }),
    hatRun(byI(0.88), 0.7),
  ],
});

// ── NEON ARCADE (Slot Gallery) ──────────────────────────────────────────────────────────────────
const arcade: SongDef = withHorror({
  id: 'arcade', gain: 1.05, title: 'Neon Arcade', bpm: 104, beats: 4, sub: 4, swing: 0.5, key: 9, mode: 'aeolian', human: 0.2, tempoFollowsIntensity: true,
  sections: {
    A: 'Am | F | C | G | Am | F | C | G',
    B: 'F | G | Am | Em | F | G | E7 | E7',
  },
  form: AABA,
  fx: { room: 0.9, hall: 0.4, lofi: 0.1 },
  parts: [
    pad('pad', 'synPad', { kind: 'open', lo: 52, hi: 73, vel: 0.5, gate: ALWAYS }),
    bassPat('bass0', 'synBass', { pat: 'halves', lo: 28, hi: 47, vel: 0.75, gate: outI(0.1, 0.25) }),
    bassPat('bass', 'synBass', { pat: 'pump', lo: 28, hi: 47, vel: 0.8, gate: byI(0.15) }),
    arp('arp', 'synArp', { lo: 57, hi: 84, step: 0.5, mode: 'updown', vel: 0.48, gate: byI(0.25) }),
    arp('arp16', 'synArp', { lo: 60, hi: 88, step: 0.25, mode: 'up', vel: 0.4, gate: byI(0.7) }),
    comp('keys', 'rhodes', { rh: 'dance', kind: 'triad', lo: 55, hi: 72, vel: 0.4, gate: byI(0.4) }),
    ...kit('d', SYNTH4, { kick: byI(0.2), hat: byI(0.35), snare: byI(0.45), ghost: byI(0.6), ride: byI(0.7) }, 0.95),
    theme('lead', 'synLead', { lo: 64, hi: 88, style: 'straight', vel: 0.5, gate: bright(0.5), orn: 0.1 }),
    hatRun(byI(0.88), 0.6),
    sidechain('sc', ['synPad', 'synArp'], { pos: [0, 1.5, 2, 3.5], amt: 0.45, gate: byI(0.2) }),
  ],
});

// ── GREEN FELT (Card Room) ──────────────────────────────────────────────────────────────────────
const felt: SongDef = withHorror({
  id: 'felt', title: 'Green Felt', bpm: 76, beats: 4, sub: 4, swing: 0.6, key: 10, mode: 'ionian', tempoFollowsIntensity: true,
  sections: {
    A: 'Bbmaj7 Gm7 | Cm7 F7 | Bbmaj7 Gm7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Bbmaj7 G7 | Cm7 F7',
    B: 'Ebmaj7 | Ebm7 Ab7 | Bbmaj7 | G7 | Cm7 | F7 | Bbmaj7 G7 | Cm7 F7',
  },
  form: AABA,
  fx: { room: 1.15, lofi: 0.22, bright: 0.9, crackle: 0.1 },
  parts: [
    comp('piano0', 'piano', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 70, vel: 0.55, gate: outI(0.35, 0.55) }),
    comp('piano', 'piano', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 70, vel: 0.58, gate: byI(0.4) }),
    bassPat('bass0', 'bass', { pat: 'halves', lo: 33, hi: 52, vel: 0.8, gate: outI(0.1, 0.25) }),
    walk('bass', 'bass', { lo: 33, hi: 53, vel: 0.88, gate: byI(0.14) }),
    ...kit('d', SWING_BRUSH, { ride: byI(0.2), snare: byI(0.3), kick: byI(0.3), hat: byI(0.5), ghost: byI(0.55) }, 0.9),
    theme('lead', 'trumpet', { lo: 60, hi: 80, style: 'ballad', vel: 0.62, gate: bright(0.3), lag: 0.03, orn: 0.15 }),
    comp('vibes', 'vibes', { rh: 'sustain', kind: 'shell', lo: 62, hi: 80, vel: 0.3, gate: bright(0.5) }),
    motif('motif', 'piano', { lo: 70, hi: 88, vel: 0.45, prob: 0.4, gate: byI(0.2) }),
    pad('tension', 'strings', { kind: 'open', lo: 46, hi: 68, vel: 0.42, gate: byI(0.65) }),
    hatRun(byI(0.9), 0.5),
  ],
});

// ── PIPES (Boiler) ──────────────────────────────────────────────────────────────────────────────
const pipes: SongDef = withHorror({
  id: 'pipes', gain: 0.92, title: 'Pipes', bpm: 120, beats: 4, sub: 4, swing: 0.66, key: 7, mode: 'aeolian', tempoFollowsIntensity: true,
  sections: {
    A: 'Gm7 | Cm7 | F7 | Gm7 | Gm7 | Cm7 | F7 Bb7 | Gm7 D7alt',
    B: 'Ebmaj7 | Ebmaj7 | D7b9 | D7b9 | Cm7 | F7 | Bb7 | D7alt',
  },
  form: AABA,
  fx: { room: 0.9, lofi: 0.25, tape: 1.2, bright: 0.85 },
  parts: [
    walk('bass', 'bass', { lo: 31, hi: 52, vel: 0.88, gate: ALWAYS }),
    comp('organ', 'organ', { rh: 'stabs', kind: 'rootless', lo: 50, hi: 68, vel: 0.5, gate: byI(0.2) }),
    ...kit('d', BOP, { ride: ALWAYS, hat: byI(0.2), kick: byI(0.3), snare: byI(0.2), ghost: byI(0.45) }, 0.85),
    fillPart(byI(0.4), 0.8),
    theme('lead', 'trumpet', { lo: 60, hi: 80, style: 'swing', vel: 0.6, gate: bright(0.45), lag: 0.015, orn: 0.15 }),
    pulse('steam', { period: 7.3, hits: [[0, D.STEAM, 0.5]], gate: byI(0.2) }),
    pulse('clank', { period: 4.7, hits: [[0, D.CLACK, 0.5], [0.19, D.WOOD, 0.3]], gate: byI(0.1) }),
    pad('tension', 'organ', { kind: 'open', lo: 38, hi: 62, vel: 0.4, gate: byI(0.65), x: 1 }),
    hatRun(byI(0.9), 0.5),
  ],
});

// ── TANGO ROJO (Wheel House) ────────────────────────────────────────────────────────────────────
const tango: SongDef = withHorror({
  id: 'tango', title: 'Tango Rojo', bpm: 116, beats: 4, sub: 4, swing: 0.5, key: 9, mode: 'aeolian', tempoFollowsIntensity: true,
  sections: {
    A: 'Am | Dm | E7 | Am | Am | Dm | E7 | Am E7',
    B: 'C | G7 | C | Am | Dm | Bm7b5 | E7 | E7',
  },
  form: AABA,
  fx: { room: 1.0, hall: 0.6, lofi: 0.2 },
  parts: [
    bassPat('bass', 'bass', { pat: 'tango', lo: 31, hi: 52, vel: 0.88, gate: ALWAYS }),
    comp('piano', 'piano', { rh: 'tango', kind: 'triad', lo: 50, hi: 70, vel: 0.55, gate: byI(0.3) }),
    pad('strings', 'strings', { kind: 'open', lo: 48, hi: 72, vel: 0.45, gate: ALWAYS }),
    ...kit('d', TANGO, { kick: byI(0.15), snare: byI(0.3), ghost: byI(0.5), perc: byI(0.2), hat: byI(0.45) }, 0.9),
    theme('lead', 'reed', { lo: 62, hi: 86, style: 'tango', vel: 0.58, gate: bright(0.2), orn: 0.2 }),
    motif('motif', 'reed', { lo: 62, hi: 80, vel: 0.5, prob: 0.4, gate: byI(0.25) }),
    hatRun(byI(0.9), 0.5),
  ],
});

// ── SPIN CYCLE (Laundry) ────────────────────────────────────────────────────────────────────────
const laundry: SongDef = withHorror({
  id: 'laundry', gain: 1.1, title: 'Spin Cycle', bpm: 96, beats: 4, sub: 4, swing: 0.5, key: 4, mode: 'dorian', tempoFollowsIntensity: true,
  sections: {
    A: 'Em9 | A9 | Cmaj7 | B7#9 | Em9 | A9 | Cmaj7 | B7#9',
    B: 'Gmaj7 | F#m7b5 B7b9 | Em9 | A9 | Cmaj7 | Am9 | F#m7b5 | B7alt',
  },
  form: AABA,
  fx: { room: 1.2, lofi: 0.18, tape: 1.2 },
  parts: [
    comp('guitar', 'pluck', { rh: 'bossa', kind: 'shell', lo: 52, hi: 72, vel: 0.58, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'bossa', lo: 33, hi: 52, vel: 0.85, gate: byI(0.1) }),
    ...kit('d', BOSSA, { hat: ALWAYS, kick: byI(0.2), snare: byI(0.3), ride: byI(0.5) }, 0.95),
    comp('vibes', 'vibes', { rh: 'sustain', kind: 'triad', lo: 60, hi: 80, vel: 0.3, gate: bright(0.3) }),
    theme('lead', ['flute', 'vibes'], { lo: 67, hi: 90, style: 'bossa', vel: 0.55, gate: bright(0.4), lag: 0.015, orn: 0.15 }),
    motif('motif', 'vibes', { lo: 67, hi: 86, vel: 0.45, prob: 0.4, gate: byI(0.2) }),
    pulse('spin', { period: 2.2, hits: [[0, D.SWISH_UP, 0.35], [1.1, D.SWISH_DOWN, 0.35]], gate: byI(0.1) }),
    pad('tension', 'strings', { kind: 'open', lo: 46, hi: 68, vel: 0.4, gate: byI(0.65) }),
    hatRun(byI(0.9), 0.5),
  ],
});

// ── CARNIVAL OF TEETH (Midway) ──────────────────────────────────────────────────────────────────
const carnival: SongDef = withHorror({
  id: 'carnival', title: 'Carnival of Teeth', bpm: 128, beats: 2, sub: 3, swing: 0.5, key: 1, mode: 'phrygian', tempoFollowsIntensity: true,
  sections: {
    A: rep('C#m | D | C#m | B', 2),
    B: 'D | D | C#m | C#m | B | B | C#m | G#7',
  },
  form: AABA,
  fx: { room: 1.1, hall: 0.5, lofi: 0.25, tape: 1.6 },
  parts: [
    bassPat('bass', 'tuba', { pat: 'six', lo: 28, hi: 48, vel: 0.8, gate: ALWAYS }),
    comp('oompah', 'piano', { rh: 'six', kind: 'triad', lo: 50, hi: 68, vel: 0.48, gate: byI(0.15) }),
    theme('lead', 'calliope', { lo: 64, hi: 88, style: 'carnival', vel: 0.52, gate: byI(0.3), orn: 0.2 }),
    arp('box', 'box', { lo: 72, hi: 96, step: 1 / 3, mode: 'updown', vel: 0.38, gate: byI(0.4) }),
    motif('motif', 'box', { lo: 74, hi: 96, vel: 0.5, prob: 0.5, gate: ALWAYS }),
    ...kit('d', MARCH68, { kick: byI(0.1), snare: byI(0.25), ghost: byI(0.55), hat: byI(0.35) }, 0.85),
    sparkle('bell', 'bell', { lo: 84, hi: 100, prob: 0.5, vel: 0.28, gate: byI(0.5) }),
  ],
});

// ── ONE BULB (Parlour) ──────────────────────────────────────────────────────────────────────────
const parlour: SongDef = withHorror({
  id: 'parlour', title: 'One Bulb', bpm: 60, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian', dFloor: 0.2,
  sections: {
    A: 'Dm | Dm | Dm | Dm/C',
    B: 'Dm | Bb/D | Dm | A7sus4',
  },
  form: AABA,
  fx: { room: 1.4, hall: 1.2, lofi: 0.5, tape: 2.0, bright: 0.65, crackle: 0.15 },
  parts: [
    drone('pedal', 'organ', { near: 38, bars: 4, pc: 2, vel: 0.6, x: 1, gate: ALWAYS }),
    revSwell('rev', { lo: 55, hi: 79, prob: 0.5, vel: 0.55, gate: ALWAYS }),
    accents('bell', 'bell', { pos: [0], lo: 62, hi: 74, vel: 0.28, dur: 4, gate: byI(0.15) }),
    fxHits('buzz', FX.BUZZ, { prob: 0.3, beats: 6, vel: 0.45, gate: ALWAYS }),
    motif('motif', 'box', { lo: 70, hi: 94, vel: 0.4, prob: 0.35, gate: byI(0.1) }),
    pad('choir', 'choir', { kind: 'open', lo: 48, hi: 70, vel: 0.45, gate: byI(0.4), x: 2 }),
  ],
});

// ── COUNTING ROOM: ticking only ─────────────────────────────────────────────────────────────────
const counting: SongDef = withHorror({
  id: 'counting', title: 'Counting Room', bpm: 60, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian',
  sections: { A: 'Dm | Dm | Dm | Dm' },
  form: ['A'],
  fx: { room: 0.8, lofi: 0.1, bright: 0.9 },
  parts: [
    pulse('tick', { period: 1, hits: [[0, D.TICK, 0.9], [0.5, D.TOCK, 0.7]], gate: ALWAYS }),
    pulse('quick', { period: 0.5, hits: [[0.25, D.TICK, 0.4]], gate: byI(0.6) }),
    pulse('drawer', { period: 11.3, hits: [[0, D.CHIME_HIT, 0.3]], gate: byI(0.3) }),
  ],
});

// ── ELEVATOR MUZAK ──────────────────────────────────────────────────────────────────────────────
const elevator: SongDef = withHorror({
  id: 'elevator', gain: 1.05, title: 'Please Hold', bpm: 100, beats: 4, sub: 4, swing: 0.5, key: 5, mode: 'ionian', tempoFollowsIntensity: false,
  sections: {
    A: 'Fmaj9 | Dm9 | Gm9 | C13 | Fmaj9 | Am7 D7b9 | Gm9 | C13 Fmaj9',
    B: 'Bbmaj9 | Gm9 | Am7 | D7 | Gm9 | C13 | Fmaj9 | Gm7 C7',
  },
  form: AABA,
  fx: { room: 1.3, lofi: 0.3, tape: 1.5, bright: 0.85 },
  iFloor: 0.3,
  parts: [
    comp('vibes', 'vibes', { rh: 'bossa', kind: 'shell', lo: 60, hi: 80, vel: 0.42, gate: bright(0.1) }),
    comp('keys', 'rhodes', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 70, vel: 0.5, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'bossa', lo: 33, hi: 52, vel: 0.7, gate: ALWAYS }),
    ...kit('d', BOSSA, { hat: byI(0.2), snare: byI(0.3), kick: byI(0.4) }, 0.7),
    theme('lead', 'flute', { lo: 67, hi: 88, style: 'bossa', vel: 0.45, gate: bright(0.2), lag: 0.02 }),
    sparkle('spark', 'bell', { lo: 84, hi: 100, prob: 0.4, vel: 0.22, gate: bright(0.15) }),
  ],
});

// ── SUMP: dripping dark ─────────────────────────────────────────────────────────────────────────
const sump: SongDef = withHorror({
  id: 'sump', title: 'Sump', bpm: 50, beats: 4, sub: 4, swing: 0.5, key: 0, mode: 'phrygian', dFloor: 0.3,
  sections: { A: 'Cm | Cm | Db | Cm', B: 'Cm | Bb/C | Cm | Cm/G' },
  form: AABA,
  fx: { room: 1.5, hall: 1.4, lofi: 0.45, tape: 2.0, bright: 0.55 },
  parts: [
    drone('pedal', 'drone', { near: 36, bars: 4, pc: 0, vel: 0.6, gate: ALWAYS }),
    sparkle('drip', 'box', { lo: 84, hi: 100, prob: 0.75, vel: 0.35, gate: ALWAYS }),
    fxHits('breath', FX.BREATH, { prob: 0.25, beats: 5, vel: 0.4, gate: ALWAYS }),
    revSwell('rev', { lo: 55, hi: 76, prob: 0.3, vel: 0.5, gate: byI(0.2) }),
    pad('choir', 'choir', { kind: 'open', lo: 48, hi: 68, vel: 0.4, gate: byI(0.5), x: 2 }),
  ],
});

// ── CUTSCENE UNDERSCORE ─────────────────────────────────────────────────────────────────────────
const cutscene: SongDef = withHorror({
  id: 'cutscene', gain: 1.05, title: 'Underscore', bpm: 66, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian', iFloor: 0.2,
  sections: { A: 'Dm9 | Bbmaj7 | Gm9 | A7b9 | Dm9 | Gm9 | Bbmaj7 | A7sus4 A7b9', B: 'Bbmaj7 | A7 | Dm | Dm/C | Bbmaj7 | Gm9 | A7b9 | A7b9' },
  form: AABA,
  fx: { room: 1.3, hall: 1.1, lofi: 0.25, tape: 1.5, bright: 0.85 },
  parts: [
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 70, vel: 0.5, gate: ALWAYS }),
    comp('keys', 'piano', { rh: 'sustain', kind: 'rootless', lo: 52, hi: 70, vel: 0.45, gate: byI(0.25) }),
    motif('motif', 'box', { lo: 72, hi: 96, vel: 0.55, prob: 0.8, gate: ALWAYS }),
    theme('lead', 'vibes', { lo: 67, hi: 88, style: 'ballad', vel: 0.4, gate: bright(0.45), when: (b) => b.phraseBar !== 0, lag: 0.03 }),
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 72, vel: 0.45, gate: byI(0.4), x: 2 }),
    bassPat('bass', 'bass', { pat: 'sustain', lo: 31, hi: 48, vel: 0.55, gate: byI(0.3) }),
    sparkle('spark', 'bell', { lo: 84, hi: 100, prob: 0.4, vel: 0.25, gate: bright(0.2) }),
  ],
});

// ── CHASE ───────────────────────────────────────────────────────────────────────────────────────
const chase: SongDef = withHorror({
  id: 'chase', gain: 0.8, title: 'Run', bpm: 148, beats: 4, sub: 4, swing: 0.5, key: 9, mode: 'phrygian', human: 0.3, iFloor: 0.8, dFloor: 0.55,
  sections: {
    A: 'Am | Am | Bb | Am | Am | Am | Dm | E7',
    B: 'F | G | Am | Am | F | G | E7 | E7',
  },
  form: AABA,
  fx: { room: 0.8, lofi: 0.2, tape: 1.2, bright: 0.9 },
  parts: [
    ...kit('d', CHASE, { kick: ALWAYS, snare: ALWAYS, ghost: byI(0.7), hat: ALWAYS, ride: byI(0.8) }, 1),
    bassPat('bass', 'synBass', { pat: 'pump', lo: 26, hi: 45, vel: 0.85, gate: ALWAYS }),
    arp('arp', 'synArp', { lo: 52, hi: 80, step: 0.25, mode: 'up', vel: 0.45, gate: ALWAYS }),
    pad('pad', 'synPad', { kind: 'tension', lo: 48, hi: 72, vel: 0.4, gate: ALWAYS }),
    comp('stabs', 'brass', { rh: 'stab16', kind: 'triad', lo: 50, hi: 70, vel: 0.38, gate: byI(0.85) }),
    fxHits('riser', FX.RISER, { prob: 0.35, beats: 4, vel: 0.5, gate: ALWAYS, when: (b) => b.lastOfSec }),
    sidechain('sc', ['synPad', 'synArp'], { pos: [0, 1, 2, 3], amt: 0.4, gate: ALWAYS }),
  ],
});

// ── JACKPOT: fanfare (C → A♭ at bar 5) and the party that follows ───────────────────────────────
const FANFARE: Groove = {
  beats: 4,
  kick: [[0, D.KICK, 1], [1, D.KICK, 0.7], [2, D.KICK, 0.95], [3, D.KICK, 0.7]],
  snare: [[1, D.SNARE, 0.85], [2.5, D.SNARE, 0.6], [3, D.SNARE, 0.9], [3.5, D.SNARE, 0.7]],
  hat: [[0.5, D.HAT, 0.4], [1.5, D.HAT, 0.4], [2.5, D.HAT, 0.4], [3.5, D.HAT_OPEN, 0.5]],
  perc: [[0, D.CRASH, 0.7]],
  ghost: [[3.25, D.TOM_HI, 0.5], [3.5, D.TOM_MID, 0.6], [3.75, D.TOM_LO, 0.7]],
};
const jackpot: SongDef = {
  id: 'jackpot', gain: 0.87, title: 'Jackpot', bpm: 132, beats: 4, sub: 4, swing: 0.55, key: 0, mode: 'ionian', oneShot: true, then: 'jackpot_party',
  sections: { A: 'C | Am7 | Dm7 G7 | Cadd9 | Ab | Fm7 | Db Dbm6 | Gsus4 G7' },
  form: ['A'],
  fx: { room: 1.1, hall: 0.8, lofi: 0.05, bright: 1 },
  iFloor: 1,
  parts: [
    comp('brass', 'brass', { rh: 'stabs', kind: 'triad', lo: 53, hi: 76, vel: 0.62, gate: ALWAYS }),
    pad('strings', 'strings', { kind: 'open', lo: 48, hi: 74, vel: 0.5, gate: ALWAYS }),
    pad('choir', 'choir', { kind: 'open', lo: 52, hi: 76, vel: 0.5, gate: ALWAYS, x: 0.4 }),
    arp('vibes', 'vibes', { lo: 67, hi: 96, step: 0.25, mode: 'updown', vel: 0.55, gate: ALWAYS }),
    arp('bells', 'bell', { lo: 79, hi: 103, step: 0.5, mode: 'up', vel: 0.4, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'root8', lo: 31, hi: 52, vel: 0.9, gate: ALWAYS }),
    ...kit('d', FANFARE, { kick: ALWAYS, snare: ALWAYS, hat: ALWAYS, perc: ALWAYS, ghost: ALWAYS }, 1),
    motif('motif', 'brass', { lo: 60, hi: 84, vel: 0.7, prob: 1, gate: ALWAYS }),
  ],
};
const jackpotParty: SongDef = {
  id: 'jackpot_party', gain: 0.95, title: 'Jackpot Party', bpm: 132, beats: 4, sub: 4, swing: 0.6, key: 0, mode: 'ionian', iFloor: 1,
  sections: {
    A: 'C | Am7 | Dm7 | G7 | C | Am7 | Fmaj7 | G7',
    B: 'F | Fm | C | Am7 | Dm7 | G7 | C | G7',
  },
  form: AABA,
  fx: { room: 1.0, hall: 0.6, lofi: 0.05 },
  parts: [
    comp('keys', 'piano', { rh: 'stabs', kind: 'rootless', lo: 52, hi: 72, vel: 0.55, gate: ALWAYS }),
    comp('brass', 'brass', { rh: 'dance', kind: 'triad', lo: 55, hi: 76, vel: 0.38, gate: ALWAYS }),
    walk('bass', 'bass', { lo: 31, hi: 53, vel: 0.88, gate: ALWAYS }),
    ...kit('d', SWING_RIDE, { ride: ALWAYS, hat: ALWAYS, kick: ALWAYS, ghost: ALWAYS, snare: ALWAYS }, 1),
    fillPart(ALWAYS, 0.9),
    theme('lead', ['trumpet', 'vibes'], { lo: 64, hi: 88, style: 'swing', vel: 0.7, gate: ALWAYS, orn: 0.2 }),
    sparkle('spark', 'bell', { lo: 84, hi: 103, prob: 0.6, vel: 0.35, gate: ALWAYS }),
  ],
};

// ── DEFEAT: the descending tritone, then a slow dirge ───────────────────────────────────────────
const defeat: SongDef = {
  id: 'defeat', gain: 0.87, title: 'Short', bpm: 54, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian', oneShot: true, then: 'defeat_loop',
  sections: { A: 'Dm | Dm/C | Bbmaj7 | A7b9 | Gm | Abdim7 | Dm/F | Ab7' },
  form: ['A'],
  fx: { room: 1.4, hall: 1.3, lofi: 0.5, tape: 2.4, bright: 0.5 },
  dFloor: 0.5, iFloor: 0.3,
  parts: [
    pad('choir', 'choir', { kind: 'open', lo: 46, hi: 70, vel: 0.6, gate: ALWAYS, x: 2 }),
    pad('strings', 'strings', { kind: 'open', lo: 40, hi: 66, vel: 0.5, gate: ALWAYS }),
    drone('sub', 'sub', { near: 31, bars: 4, pc: 2, vel: 0.8, gate: ALWAYS }),
    accents('toll', 'bell', { pos: [0, 2], lo: 50, hi: 62, vel: 0.45, dur: 2, gate: ALWAYS }),
    theme('lead', 'piano', { lo: 50, hi: 72, style: 'ballad', vel: 0.5, gate: byI(0.2), lag: 0.05 }),
    heartPulse(byI(0.3)),
  ],
};
const defeatLoop: SongDef = {
  id: 'defeat_loop', title: 'Short (loop)', bpm: 54, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'aeolian',
  sections: { A: 'Dm | Dm/C | Bbmaj7 | A7b9 | Gm | Abdim7 | Dm/F | A7' },
  form: ['A'],
  fx: { room: 1.4, hall: 1.3, lofi: 0.5, tape: 2.4, bright: 0.5 },
  dFloor: 0.45, iFloor: 0.2,
  parts: [
    pad('choir', 'choir', { kind: 'open', lo: 46, hi: 70, vel: 0.5, gate: ALWAYS, x: 2 }),
    drone('sub', 'sub', { near: 31, bars: 4, pc: 2, vel: 0.7, gate: ALWAYS }),
    revSwell('rev', { lo: 52, hi: 74, prob: 0.4, vel: 0.5, gate: ALWAYS }),
    sparkle('drip', 'box', { lo: 79, hi: 96, prob: 0.4, vel: 0.28, gate: ALWAYS }),
  ],
};

// ── ENDING: Topside, the first major-key statement of the motif ─────────────────────────────────
const ending: SongDef = {
  id: 'ending', gain: 1.05, title: 'Topside', bpm: 72, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'ionian', oneShot: true, then: 'ending_loop',
  sections: { A: 'D | A/C# | Bm7 | Gmaj7 | D/F# | G | Em7 A7sus4 | D | Dadd9' },
  form: ['A'],
  fx: { room: 1.2, hall: 1.2, lofi: 0.05, bright: 1 },
  iFloor: 0.8,
  parts: [
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 76, vel: 0.8, gate: ALWAYS, x: 2.4 }),
    pad('strings', 'strings', { kind: 'open', lo: 46, hi: 74, vel: 0.55, gate: ALWAYS }),
    arp('harp', 'harp', { lo: 55, hi: 88, step: 0.5, mode: 'up', vel: 0.5, gate: ALWAYS }),
    motif('motif', ['vibes', 'bell'], { lo: 62, hi: 86, vel: 0.8, prob: 1, gate: ALWAYS }),
    bassPat('bass', 'bass', { pat: 'halves', lo: 33, hi: 50, vel: 0.7, gate: ALWAYS }),
    comp('organ', 'organ', { rh: 'sustain', kind: 'open', lo: 40, hi: 62, vel: 0.4, gate: ALWAYS }),
  ],
};
const endingLoop: SongDef = {
  id: 'ending_loop', gain: 1.4, title: 'Topside (loop)', bpm: 72, beats: 4, sub: 4, swing: 0.5, key: 2, mode: 'ionian',
  sections: { A: 'D | A/C# | Bm7 | Gmaj7 | D/F# | G | Em7 | A7sus4 A7' },
  form: ['A'],
  fx: { room: 1.2, hall: 1.2, lofi: 0.1, bright: 1 },
  iFloor: 0.5,
  parts: [
    pad('choir', 'choir', { kind: 'open', lo: 50, hi: 76, vel: 0.5, gate: ALWAYS, x: 2.4 }),
    arp('harp', 'harp', { lo: 55, hi: 88, step: 1, mode: 'up', vel: 0.4, gate: ALWAYS }),
    theme('lead', 'vibes', { lo: 64, hi: 88, style: 'ballad', vel: 0.45, gate: ALWAYS, lag: 0.03 }),
    sparkle('spark', 'bell', { lo: 84, hi: 100, prob: 0.4, vel: 0.22, gate: ALWAYS }),
  ],
};

/** All beds by id. The gambling-floor beds wear the stakes overlay; the high-stakes cues (`cues.ts`) sit beside them, with
 * Last Call and the chase hit / miss registered on the lounge and the arcade (the conductor builds them for the bed that plays). */
export const BEDS: Readonly<Record<string, SongDef>> = Object.fromEntries([
  ...[lounge, arcade, felt, pipes, tango, laundry, carnival].map(withStakes),
  menu, parlour, counting, elevator, sump, cutscene, chase, jackpot, jackpotParty, defeat, defeatLoop, ending, endingLoop,
  ...Object.values(CUES), { ...lastCallOf(withStakes(lounge)), id: 'lastcall' }, { ...hitOf(arcade), id: 'chase_hit' }, { ...missOf(arcade), id: 'chase_miss' },
].map((s) => [s.id, s]));
