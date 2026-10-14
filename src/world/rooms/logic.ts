/**
 * Pure rules for the room dressing: grille plate views, cue edges, locker layout, gauge needle, nearest key-ready grille,
 * note anchor ids. No THREE, no engine: `scripts/tests` loads it directly.
 */
import type { WingId, WingState } from './bridge';

export type PlateView = 'gone' | 'sealed' | 'keyReady';

/** One doorway grille of the pit (layout.ts `grilles` in level.ts). `x` is the wall, `z` the doorway centre. */
export interface GrilleSpec {
  wing: WingId;
  x: number;
  z: number;
  /** -1: the room lies west of the wall (the nave is east). +1: the room lies east (the nave is west). */
  side: -1 | 1;
  /** Height of the marquee sign inside the room (m); kept under each ceiling. */
  signY: number;
  /** Marquee colour. */
  neon: number;
}

export const GRILLES: readonly GrilleSpec[] = [
  { wing: 'midway', x: -11, z: -23, side: -1, signY: 2.6, neon: 0xff4d6d },
  { wing: 'cards', x: -11, z: -9, side: -1, signY: 2.4, neon: 0x7cff9a },
  { wing: 'laundry', x: -11, z: 5, side: -1, signY: 2.6, neon: 0xa8f0ff },
  { wing: 'counting', x: -11, z: 16, side: -1, signY: 2.1, neon: 0xffb000 },
  { wing: 'boiler', x: 11, z: -23, side: 1, signY: 2.6, neon: 0xff4a3a },
  { wing: 'gallery', x: 11, z: -9, side: 1, signY: 2.6, neon: 0xff3fa4 },
  { wing: 'wheels', x: 11, z: 5, side: 1, signY: 2.6, neon: 0xffd34a },
];

/** Plate mount offset from the wall face, toward the nave (m). */
export const PLATE_NAVE_OFFSET = 0.28;

/** Plate centre x for a grille (on the nave face of the wall). */
export function plateX(g: GrilleSpec): number {
  return g.x - g.side * PLATE_NAVE_OFFSET;
}

/** Marquee centre x for a grille (inside the room, behind the bars). */
export function signX(g: GrilleSpec): number {
  return g.x + g.side * 1.5;
}

/** Yaw (degrees) that turns a plate or sign to face the nave. */
export function faceDeg(g: GrilleSpec): number {
  return g.side === -1 ? 90 : -90;
}

/** A plate is gone when its wing is open, by either source. Otherwise it reads SEALED or KEY READY. */
export function plateView(state: WingState, open: boolean): PlateView {
  if (open || state === 'open') return 'gone';
  return state === 'keyReady' ? 'keyReady' : 'sealed';
}

/** The music-box cue and toast fire on the sealed → key-ready edge only (not on the first read). */
export function shouldCue(prev: WingState | undefined, next: WingState): boolean {
  return prev === 'sealed' && next === 'keyReady';
}

/** Boiler gauge: P 0 → −135°, P 100 → +135° (degrees, measured clockwise from the top). */
export function needleDeg(p: number): number {
  const c = Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));
  return -135 + c * 2.7;
}

export const LOCKER_COUNT = 12;
/** Lockers stand against the Laundry's east wall, one bank of 12 along z, clear of the doorway (z 3–7). */
export const LOCKER_X = -11.6;
export const LOCKER_Z0 = -1.6;
export const LOCKER_DZ = 0.38;

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Locker centre z for locker `n` (1–12). */
export function lockerZ(n: number): number {
  return LOCKER_Z0 + (clampInt(n, 1, LOCKER_COUNT) - 1) * LOCKER_DZ;
}

/** The number painted on a locker door: "01"–"12". */
export function lockerLabel(n: number): string {
  return String(clampInt(n, 1, LOCKER_COUNT)).padStart(2, '0');
}

/** Anchor ids for the lore notes n15–n28 (`world.anchor('note.n15')`). Placed by `dressing.ts`. */
export const NOTE_NUMBERS: readonly number[] = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
export function noteAnchorId(n: number): string {
  return `note.n${n}`;
}

/** Room anchors (cutscene and lore targets) besides the notes. */
export const ROOM_ANCHOR_IDS = {
  jadeLin: 'room.jade.lin',
  washLockers: 'room.wash.lockers',
  boilerGauge: 'room.boiler.gauge',
  boilerVent: 'room.boiler.vent',
  collectorChair: 'room.parlour.chair',
  countingLedger: 'room.counting.ledger',
  countingAbacus: 'room.counting.abacus',
} as const;

/** The nearest grille whose wing is key-ready, from a point in the pit (x, z). Null when none is. */
export function nearestKeyReady(
  from: { x: number; z: number },
  states: Partial<Record<WingId, WingState>>,
): { wing: WingId; dist: number } | null {
  let best: { wing: WingId; dist: number } | null = null;
  for (const g of GRILLES) {
    if (states[g.wing] !== 'keyReady') continue;
    const d = Math.hypot(from.x - plateX(g), from.z - g.z);
    if (!best || d < best.dist) best = { wing: g.wing, dist: d };
  }
  return best;
}

/** The Collector's chair is on the floor on Nights 3–7 only. */
export function chairVisible(night: number): boolean {
  return night >= 3 && night <= 7;
}
