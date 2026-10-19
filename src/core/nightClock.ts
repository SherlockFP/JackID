/**
 * The night cycle's clock and the CRT's pose, pure and dependency-free so the machines (`machines/_base/powerRig.ts`) can read them
 * (world/nightLights.ts drives them). See nightLights.ts for the cycle itself.
 */
export type NightPhase = 'opening' | 'watch' | 'lastCall' | 'mola' | 'dawn';

export const LIFT_XZ = [-4, -30] as const;
/** Farthest a lit place stands from the lift (m). */
const REACH = 62;
export const SPAN_S = 3;

/** Seconds of stagger for a place: 'out' counts from the lift, 'in' from the far end. `room` = span minus the step's own fade. */
export function sectionDelay(x: number, z: number, dir: 'out' | 'in', room: number): number {
  const k = Math.min(1, Math.hypot(x - LIFT_XZ[0], z - LIFT_XZ[1]) / REACH);
  return room * (dir === 'out' ? k : 1 - k);
}

// ── what a machine's screen shows ──────────────────────────────────────────────────────────────────────

/** Where the cycle stands, for the machines (render rate, read-only). `fromDark`: the phase was entered out of Dawn. */
export interface NightClock { phase: NightPhase | null; age: number; fromDark: boolean }
/** Written by the cycle (world/nightLights.ts) only. */
export const nightClockRef: NightClock = { phase: null, age: 0, fromDark: false };
export const nightClock = (): Readonly<NightClock> => nightClockRef;

/** A screen's look: `shutter` 0 open .. 1 shut (the CRT collapse), `line` the bright line left in the middle, `tint` brightness, `closed` the KAPALI plate. */
export interface ScreenPose { shutter: number; line: number; tint: number; closed: boolean }
const LIVE: ScreenPose = { shutter: 0, line: 0, tint: 1, closed: false };
const OFF: ScreenPose = { shutter: 1, line: 0, tint: 1, closed: false };
const COLLAPSE_S = 0.12, LINE_S = 0.18, BOOT_S = 0.6;

/** Pure: the screen's pose `age` seconds into the phase, `delay` seconds after the section it stands in has been reached. */
export function screenPose(phase: NightPhase | null, age: number, delay: number, fromDark: boolean, reduced: boolean): ScreenPose {
  const a = age - delay;
  switch (phase) {
    case 'mola': return { ...LIVE, closed: true };
    case 'dawn': {
      if (a < 0) return LIVE;
      if (reduced) return { ...LIVE, shutter: Math.min(1, a / 0.8) };
      if (a < COLLAPSE_S) return { ...LIVE, shutter: a / COLLAPSE_S };
      return { shutter: 1, line: Math.max(0, 1 - (a - COLLAPSE_S) / LINE_S), tint: 1, closed: false };
    }
    case 'opening': {
      if (!fromDark) return LIVE;
      if (a < 0) return OFF;
      if (reduced) return { ...LIVE, shutter: Math.max(0, 1 - a / 0.8) };
      if (a >= BOOT_S) return LIVE;
      // a deterministic flicker: the shutter jumps open and the tube stutters
      const flick = Math.sin(a * 53) + Math.sin(a * 31 + 1) > -0.3 ? 1 : 0.15;
      return { shutter: a < 0.1 ? 1 - a / 0.1 : 0, line: a < 0.1 ? 1 : 0, tint: flick, closed: false };
    }
    default: return LIVE;
  }
}

