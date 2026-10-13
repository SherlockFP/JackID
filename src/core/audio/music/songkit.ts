/**
 * Song-writing kit (CORE-AUDIO / music): drum grooves, the shared horror overlay and small helpers the
 * song definitions in `songs/` are built from. A groove is data; `kit()` turns it into one part per lane so
 * every lane gets its own intensity gate.
 */
import { D } from './dsp';
import { FX } from './instruments';
import { byD, type Gate, type PartDef, type SongDef } from './model';
import { drone, drumLane, fxHits, heartPulse, pad, revSwell, type Groove, type Lane } from './parts';

const T3 = 1 / 3;
const every = (step: number, beats: number, code: number, vel: number, off = 0): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let p = off; p < beats - 1e-6; p += step) out.push([p, code, vel]);
  return out;
};

// ── grooves ─────────────────────────────────────────────────────────────────────────────────────
/** Spang-a-lang ride, hat on 2 and 4, feathered kick, ghosted snare. */
export const SWING_RIDE: Groove = {
  beats: 4,
  ride: [[0, D.RIDE, 0.5], [1, D.RIDE, 0.46], [1.5, D.RIDE, 0.34], [2, D.RIDE, 0.5], [3, D.RIDE, 0.46], [3.5, D.RIDE, 0.34]],
  hat: [[1, D.HAT_PEDAL, 0.6], [3, D.HAT_PEDAL, 0.6]],
  kick: [[0, D.KICK_SOFT, 0.3], [1, D.KICK_SOFT, 0.2], [2, D.KICK_SOFT, 0.26], [3, D.KICK_SOFT, 0.2]],
  kickAlt: [[0, D.KICK_SOFT, 0.32], [2, D.KICK_SOFT, 0.28], [2.5, D.KICK_SOFT, 0.2], [3, D.KICK_SOFT, 0.2]],
  ghost: [[0.5, D.SNARE_GHOST, 0.2], [2.5, D.SNARE_GHOST, 0.24], [3.5, D.SNARE_GHOST, 0.2]],
  snare: [[1, D.RIM, 0.3], [3, D.RIM, 0.34]],
};
/** Hard-bop: the same ride with rim-click backbeat and busier snare comping. */
export const BOP: Groove = {
  ...SWING_RIDE,
  snare: [[1, D.RIM, 0.55], [3, D.RIM, 0.6]],
  ghost: [[0.5, D.SNARE_GHOST, 0.3], [1.5, D.SNARE_GHOST, 0.26], [2.5, D.SNARE_GHOST, 0.3], [3.5, D.SNARE, 0.32]],
};
/** Brush sweeps for ballads. */
export const SWING_BRUSH: Groove = {
  beats: 4,
  ride: [[0, D.SWISH_DOWN, 0.5], [1, D.SWISH_UP, 0.4], [1.5, D.SWISH_DOWN, 0.28], [2, D.SWISH_DOWN, 0.5], [3, D.SWISH_UP, 0.4], [3.5, D.SWISH_DOWN, 0.28]],
  snare: [[1, D.SNARE_BRUSH, 0.4], [3, D.SNARE_BRUSH, 0.44]],
  hat: [[1, D.HAT_PEDAL, 0.4], [3, D.HAT_PEDAL, 0.4]],
  kick: [[0, D.KICK_SOFT, 0.34], [2, D.KICK_SOFT, 0.26]],
  ghost: [[2.5, D.SNARE_GHOST, 0.18]],
};
export const BOSSA: Groove = {
  beats: 4,
  kick: [[0, D.KICK_SOFT, 0.5], [1.5, D.KICK_SOFT, 0.4], [2, D.KICK_SOFT, 0.5], [3.5, D.KICK_SOFT, 0.4]],
  snare: [[0, D.RIM, 0.42], [1.5, D.RIM, 0.4], [3, D.RIM, 0.4]],
  hat: every(0.5, 4, D.SHAKER, 0.26).map(([p, c, v]) => [p, c, p % 1 === 0 ? v : v * 0.7] as [number, number, number]),
  ride: [[0, D.HAT_PEDAL, 0.35], [2, D.HAT_PEDAL, 0.35]],
};
export const WALTZ: Groove = {
  beats: 3,
  kick: [[0, D.KICK_SOFT, 0.45]],
  snare: [[1, D.SNARE_BRUSH, 0.34], [2, D.SNARE_BRUSH, 0.3]],
  ride: [[0, D.SWISH_DOWN, 0.4], [1.5, D.SWISH_UP, 0.28], [2.5, D.SWISH_DOWN, 0.26]],
  hat: [[1, D.HAT_PEDAL, 0.3], [2, D.HAT_PEDAL, 0.3]],
};
/** 80s machine: 808 kick, snare + clap, straight hats. */
export const SYNTH4: Groove = {
  beats: 4,
  kick: [[0, D.KICK_808, 0.95], [1.5, D.KICK_808, 0.55], [2, D.KICK_808, 0.9], [3.5, D.KICK_808, 0.5]],
  kickAlt: [[0, D.KICK_808, 0.95], [2, D.KICK_808, 0.9], [2.5, D.KICK_808, 0.6], [3.25, D.KICK_808, 0.45]],
  snare: [[1, D.SNARE, 0.8], [3, D.SNARE, 0.85]],
  ghost: [[1, D.CLAP, 0.55], [3, D.CLAP, 0.6]],
  hat: every(0.5, 4, D.HAT, 0.3).map(([p, c, v]) => [p, c, p % 1 === 0 ? v : v * 0.7] as [number, number, number]),
  ride: [[0.5, D.HAT_OPEN, 0.35], [2.5, D.HAT_OPEN, 0.35]],
};
export const LOFI: Groove = {
  beats: 4,
  kick: [[0, D.KICK_SOFT, 0.8], [0.75, D.KICK_SOFT, 0.5], [2.5, D.KICK_SOFT, 0.7]],
  kickAlt: [[0, D.KICK_SOFT, 0.8], [1.75, D.KICK_SOFT, 0.45], [2.5, D.KICK_SOFT, 0.7]],
  snare: [[1, D.SNARE, 0.5], [3, D.SNARE, 0.55]],
  ghost: [[3.75, D.SNARE_GHOST, 0.3], [2.25, D.SNARE_GHOST, 0.2]],
  hat: every(0.5, 4, D.HAT, 0.3).map(([p, c, v]) => [p, c, p % 1 === 0 ? v : v * 0.65] as [number, number, number]),
  ride: [[3.5, D.HAT_OPEN, 0.3]],
};
export const TANGO: Groove = {
  beats: 4,
  kick: [[0, D.KICK_SOFT, 0.62], [2, D.KICK_SOFT, 0.58]],
  kickAlt: [[0, D.KICK_SOFT, 0.62], [1, D.KICK_SOFT, 0.4], [2, D.KICK_SOFT, 0.58], [3, D.KICK_SOFT, 0.4]],
  snare: [[1, D.SNARE_GHOST, 0.5], [3, D.SNARE_GHOST, 0.52]],
  ghost: [[3.75, D.SNARE_GHOST, 0.3]],
  perc: [[0, D.WOOD, 0.42], [1.5, D.WOOD, 0.38], [3, D.WOOD, 0.42]],
  hat: [[0.5, D.TAMB, 0.2], [2.5, D.TAMB, 0.2]],
};
/** 6/8 march: two dotted-quarter beats, three eighths each. */
export const MARCH68: Groove = {
  beats: 2,
  kick: [[0, D.KICK_SOFT, 0.7]],
  snare: [[1, D.TOY, 0.62]],
  ghost: [[T3, D.TOY, 0.22], [2 * T3, D.TOY, 0.22], [1 + T3, D.TOY, 0.26], [1 + 2 * T3, D.TOY, 0.3]],
  hat: [[0, D.TAMB, 0.26], [T3, D.TAMB, 0.18], [2 * T3, D.TAMB, 0.18], [1, D.TAMB, 0.26], [1 + T3, D.TAMB, 0.18], [1 + 2 * T3, D.TAMB, 0.18]],
};
export const CHASE: Groove = {
  beats: 4,
  kick: [[0, D.KICK_808, 1], [1, D.KICK_808, 0.7], [2, D.KICK_808, 0.95], [3, D.KICK_808, 0.7]],
  snare: [[1, D.SNARE, 0.85], [3, D.SNARE, 0.9]],
  ghost: [[1, D.CLAP, 0.4], [3, D.CLAP, 0.45], [3.75, D.SNARE_GHOST, 0.4]],
  hat: every(0.25, 4, D.HAT, 0.26).map(([p, c, v]) => [p, c, p % 0.5 === 0 ? v : v * 0.6] as [number, number, number]),
  ride: [[0.5, D.HAT_OPEN, 0.35], [1.5, D.HAT_OPEN, 0.3], [2.5, D.HAT_OPEN, 0.35], [3.5, D.HAT_OPEN, 0.3]],
};
export const BALLAD: Groove = {
  beats: 4,
  kick: [[0, D.KICK_SOFT, 0.4]],
  snare: [[2, D.SNARE_BRUSH, 0.3]],
  ride: [[0, D.SWISH_DOWN, 0.35], [2, D.SWISH_UP, 0.3]],
};

/** One part per lane that has a gate. */
export function kit(id: string, g: Groove, gates: Partial<Record<Lane, Gate>>, vel = 1): PartDef[] {
  const out: PartDef[] = [];
  for (const lane of Object.keys(gates) as Lane[]) {
    const gate = gates[lane];
    if (gate && g[lane]) out.push(drumLane(`${id}.${lane}`, g, lane, gate, vel));
  }
  return out;
}

// ── dread overlay ───────────────────────────────────────────────────────────────────────────────
/**
 * The horror stem every bed can wear (GDD 6.9 "tension stem" and friends), all gated by dread:
 * sub drone and choir pad (0.25 / 0.4), whispers (0.5), reversed swells, a tension cluster, scrapes, the 0.9 s heart.
 * `key` is the tonic pitch class the sub sits on.
 */
export function horror(key: number, o: { choir?: boolean; heart?: boolean } = {}): PartDef[] {
  const parts: PartDef[] = [
    drone('h.sub', 'sub', { near: 31, bars: 4, pc: key, vel: 0.8, gate: byD(0.25) }),
    fxHits('h.whisper', FX.WHISPER, { prob: 0.3, beats: 4, vel: 0.5, gate: byD(0.5) }),
    revSwell('h.rev', { lo: 55, hi: 79, prob: 0.4, vel: 0.55, gate: byD(0.45) }),
    pad('h.tension', 'strings', { kind: 'tension', lo: 46, hi: 72, vel: 0.5, gate: byD(0.62), when: (b) => b.secBar % 2 === 0 }),
    fxHits('h.scrape', FX.SCRAPE, { prob: 0.18, beats: 3, vel: 0.5, gate: byD(0.72) }),
    fxHits('h.buzz', FX.BUZZ, { prob: 0.16, beats: 6, vel: 0.5, gate: byD(0.58) }),
  ];
  if (o.choir !== false) parts.push(pad('h.choir', 'choir', { kind: 'open', lo: 50, hi: 74, vel: 0.62, gate: byD(0.38), x: 2 }));
  if (o.heart !== false) parts.push(heartPulse(byD(0.8), 1));
  return parts;
}

/** Song with the horror overlay appended (beds). */
export function withHorror(song: SongDef, o?: { choir?: boolean; heart?: boolean }): SongDef {
  return { ...song, parts: [...song.parts, ...horror(song.key, o)] };
}

