/**
 * THE NIGHT CYCLE (presentation only): the world follows the run's clock. A small pure state machine maps the run phase to
 * target light levels per kind of place, a planner turns a phase change into timed steps (section by section from the lift
 * outward when the Night opens, far end to the lift when Dawn closes it), and `createNightCycle` plays those steps on the
 * light pool (`setLevel` per zone, `setAmbient`), the fixtures, the audio and the machines' screens (via `nightClock`).
 *
 *   bell      OPENING  lights come on from the lift outward (~3 s), machines boot with a jingle
 *   play      WATCH    full lights
 *   lastCall  LAST CALL amber pulses, the bell rings, the music sits low
 *   closing.. MOLA     floor lights at half, the bar and pawn stay lit, machines read CLOSED, the crowd bed drops
 *   dawn      DAWN     lights click off far end to lift, screens collapse, the music stops; terminal glow and lift light stay
 *
 * No rule changes. Calm Mode and reduceFlashing get smooth fades and no pulses. The Lights Die (horror director) dims a zone on
 * its own; when it ends it calls `restoreNightLights`, which puts the cycle's levels back instead of forcing everything to 1.
 */
import type { WorldLights } from './types';
import { SPAN_S, nightClockRef as clock, sectionDelay, type NightPhase } from '@/core/nightClock';
export { LIFT_XZ, SPAN_S, nightClock, screenPose, sectionDelay, type NightPhase, type NightClock, type ScreenPose } from '@/core/nightClock';

export type SpotKind = 'floor' | 'keep' | 'core';

/** Run phase (`ShiftPhase`) and the Night's paid flag to the cycle's phase. `null` = no cycle (bench, Free mode, run over). */
export function nightPhaseOf(shift: string | undefined, nightDone: boolean): NightPhase | null {
  switch (shift) {
    case 'bell': return 'opening';
    case 'play': return 'watch';
    case 'lastCall': return 'lastCall';
    case 'closing': case 'settle': return 'mola';
    case 'collection': return 'dawn';
    case 'intermission': return nightDone ? 'dawn' : 'mola';
    default: return null;
  }
}

/** Target level by kind: floor = every zone, keep = the bar and the pawn, core = the terminal and the lift. */
export interface PhaseLevels { floor: number; keep: number; core: number; ambient: number }
const FULL: PhaseLevels = { floor: 1, keep: 1, core: 1, ambient: 1 };
export const LEVELS: Readonly<Record<NightPhase, PhaseLevels>> = {
  opening: FULL,
  watch: FULL,
  lastCall: FULL,
  mola: { floor: 0.5, keep: 1, core: 1, ambient: 0.6 },
  dawn: { floor: 0, keep: 0, core: 0.6, ambient: 0.15 },
};

export interface Spot { id: string; kind: SpotKind; x: number; z: number }
export interface NightStep { at: number; id: string; kind: SpotKind; level: number; dur: number }
export interface NightPlan { steps: NightStep[]; ambient: { level: number; dur: number } }

const KIND_ORDER: Record<SpotKind, number> = { floor: 0, keep: 1, core: 2 };

/**
 * The steps of one phase change. `from === null` is a snap (a load into the middle of a Night). Floor steps are staggered; the
 * bar, pawn, terminal and lift follow once the floor has finished, so a zone step can never overwrite them mid-fade.
 */
export function planNight(from: NightPhase | null, to: NightPhase, spots: readonly Spot[], reduced: boolean): NightPlan {
  const lv = LEVELS[to], was = from ? LEVELS[from] : null;
  if (!was) return { steps: spots.map((s) => ({ at: 0, id: s.id, kind: s.kind, level: lv[s.kind], dur: 0 })), ambient: { level: lv.ambient, dur: 0 } };
  const dir = to === 'dawn' ? 'in' : to === 'opening' || from === 'dawn' ? 'out' : null;
  const fade = dir === null ? 1.5 : reduced ? 1.2 : to === 'dawn' ? 0.18 : 0.5;
  const room = dir === null ? 0 : SPAN_S - fade;
  const steps: NightStep[] = [];
  let floorEnd = 0;
  for (const s of spots) {
    if (lv[s.kind] === was[s.kind]) continue;
    const staggered = dir !== null && s.kind === 'floor';
    const at = staggered ? sectionDelay(s.x, s.z, dir, room) : dir !== null ? SPAN_S : 0;
    if (s.kind === 'floor') floorEnd = Math.max(floorEnd, at + fade);
    steps.push({ at, id: s.id, kind: s.kind, level: lv[s.kind], dur: fade });
  }
  if (dir !== null) for (const st of steps) if (st.kind !== 'floor') st.at = floorEnd;
  steps.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { steps, ambient: { level: lv.ambient, dur: dir === null ? 1.5 : SPAN_S } };
}

// ── the runtime ────────────────────────────────────────────────────────────────────────────────────────

export interface NightCycleDeps {
  lights: WorldLights;
  /** Floor zones plus the bar, pawn, terminal and lift markers (ids resolve through `target`). */
  spots: readonly Spot[];
  /** A light target for a spot id: a zone id, or the marker object for keep and core. */
  target(id: string): Parameters<WorldLights['setLevel']>[0];
  phase(): NightPhase | null;
  /** Calm Mode or reduceFlashing: smooth fades, no pulses. */
  reduced(): boolean;
  /** A cutscene is playing; its end re-asserts the cycle's levels (a cutscene may have set its own). */
  busy(): boolean;
  /** Fixtures of a zone on or off (the lamp meshes). */
  fixtures(zone: string, on: boolean): void;
  ringBell(): void;
  audio: {
    sfx(name: 'powerUp' | 'powerDown'): void;
    duck(bus: 'music' | 'amb', amount: number, dur: number): void;
    musicState(): string;
    setMusicState(s: string, fade: number): void;
  };
}

export interface NightCycle {
  update(dt: number): void;
  /** Put the cycle's levels back (the Lights Die ended, a cutscene ended). */
  resume(): void;
  dispose(): void;
}

const AMBER = 0xffa648;
const PULSE_EVERY_S = 2.6;
const DUCK_EVERY_S = 2;

let live: NightCycle | null = null;

/** Called by the horror director when the Lights Die ends: the cycle's levels come back, not a blanket 1. */
export function restoreNightLights(lights: WorldLights | null): void {
  if (live) live.resume();
  else lights?.setLevel('all', 1, 1.2);
}

export function createNightCycle(d: NightCycleDeps): NightCycle {
  let cur: NightPhase | null = null;
  let pending: NightStep[] = [];
  let t = 0;
  let pulseIn = 0, duckIn = 0;
  let wasBusy = false;
  let silenced: string | null = null;
  const zoneOn = new Map<string, boolean>();

  const run = (st: NightStep): void => {
    d.lights.setLevel(d.target(st.id), st.level, st.dur);
    if (st.kind !== 'floor') return;
    const on = st.level > 0;
    if ((zoneOn.get(st.id) ?? true) !== on) { zoneOn.set(st.id, on); d.fixtures(st.id, on); }
  };

  const change = (to: NightPhase): void => {
    const from = cur;
    if (from === 'opening' && to === 'watch') { cur = to; return; }   // the bell is 2 s, the opening 3: its steps and screens run on into the Watch
    const plan = planNight(from, to, d.spots, d.reduced());
    d.lights.setAmbient(plan.ambient.level, plan.ambient.dur);
    pending = plan.steps.filter((s) => s.at > 0);
    for (const s of plan.steps) if (s.at <= 0) run(s);
    t = 0;
    clock.fromDark = from === 'dawn';
    clock.phase = to;
    clock.age = 0;
    cur = to;
    pulseIn = 0; duckIn = 0;
    const fresh = from !== null;
    if (to === 'dawn') {
      if (fresh) d.audio.sfx('powerDown');
      const s = d.audio.musicState();
      if (s !== 'silent') { silenced = s; d.audio.setMusicState('silent', 2.5); }
    } else if (silenced) {
      d.audio.setMusicState(silenced, 2.5);
      silenced = null;
    }
    if (to === 'opening' && from === 'dawn') d.audio.sfx('powerUp');
    if (to === 'lastCall' && fresh) d.ringBell();
  };

  const self: NightCycle = {
    update(dt) {
      const p = d.phase();
      if (p && p !== cur) change(p);
      if (!cur) return;
      t += dt;
      clock.age = t;
      if (clock.phase === 'opening' && cur !== 'opening' && t >= SPAN_S + 0.7) clock.phase = cur;   // the boot is done
      while (pending.length && pending[0].at <= t) run(pending.shift()!);
      const busy = d.busy();
      if (wasBusy && !busy) self.resume();
      wasBusy = busy;
      const calm = d.reduced();
      if (cur === 'lastCall') {
        // the whole floor breathes with the amber pulse: the pool lights are only six, the ambient carries the look
        const hz = calm ? 1 / (PULSE_EVERY_S * 1.6) : 1 / PULSE_EVERY_S;
        d.lights.setAmbient(1 - (calm ? 0.06 : 0.14) * (0.5 - 0.5 * Math.cos(t * hz * 2 * Math.PI)), 0);
        if ((pulseIn -= dt) <= 0) {
          pulseIn = calm ? PULSE_EVERY_S * 1.6 : PULSE_EVERY_S;
          d.lights.pulse('all', { color: AMBER, mul: calm ? 1.12 : 1.3, dur: calm ? 2.4 : 1.6 });
        }
        if ((duckIn -= dt) <= 0) { duckIn = DUCK_EVERY_S; d.audio.duck('music', 0.5, DUCK_EVERY_S * 1.5); }
      } else if (cur === 'mola') {
        if ((duckIn -= dt) <= 0) { duckIn = DUCK_EVERY_S; d.audio.duck('amb', 0.5, DUCK_EVERY_S * 1.5); }
      }
    },
    resume() {
      if (!cur) { d.lights.setLevel('all', 1, 1.2); return; }   // no cycle running (Free mode, bench): the old blanket restore
      const lv = LEVELS[cur];
      pending = [];
      d.lights.setAmbient(lv.ambient, 1.2);
      for (const kind of ['floor', 'keep', 'core'] as const) for (const s of d.spots) if (s.kind === kind) d.lights.setLevel(d.target(s.id), lv[kind], 1.2);
      if (cur === 'dawn' && d.audio.musicState() !== 'silent') { silenced = silenced ?? d.audio.musicState(); d.audio.setMusicState('silent', 2.5); }
    },
    dispose() {
      if (live === self) live = null;
      clock.phase = null; clock.age = 0; clock.fromDark = false;
      if (silenced) { d.audio.setMusicState(silenced, 0.5); silenced = null; }
    },
  };
  live = self;
  return self;
}
