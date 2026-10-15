/**
 * THE KNOCK (wave 71, Home layer): the Evening's visitor, the pure rules and the state machine (docs/DESIGN_PILLARS.md pillars 1, 3,
 * 5 and 7: Heat is the Collector's patience, a visitor is the mob made audible, and the counters are chain, lights and stillness).
 *
 * From Night 2 an Evening may bring one visitor, rolled with hashSeed(seed, night, 'knock') from Heat: Heat 0-1 none; 2-3 THE
 * LISTENER 60 %; 4 THE LEANER 75 %; 5-6 THE PICKER 90 %. The telegraph is sound first, light second: 12-25 s into the Evening
 * footsteps come down the hall, the door's shadow strip turns on, then the visitor acts.
 *  - LISTENER: stands at the door. Lights OFF and no walk input or interaction for 8 s inside a 12 s window. Pass: Heat -1.
 *    Fail: a slip under the door, toll 8 % of the pocket and Heat +1.
 *  - LEANER: a knock, then three shoves 2 s apart. Chain ON before the second shove: he gives up (Heat unchanged, Harmony -1).
 *    Chain off: the third shove cracks the door 10 cm, toll 15 %, Heat +1, Harmony -1.
 *  - PICKER: scrapes the lock for 10 s. Needs the chain ON and the lights OFF at the end. Pass: Heat -1. Fail: toll 20 %, one
 *    random non-legendary charm gone, Heat +1.
 * A toll is a share of the pocket, at least 1 coin and at most a quarter of the Night's quota. Calm mode stretches every timer
 * by 1.5 and drops the jolts (the host reads `calm` once, at the visit's start, and the visit keeps it).
 *
 * This file has no THREE, no DOM and no app: the host (evening.ts) hands the machine effect callbacks (`KnockIO`) and per-step
 * inputs, and applies the `VisitResult` it gets back. All state is one plain object (`VisitState`), saved with the phone slice,
 * so a reload resumes the visit (a visitor caught mid-act is resolved as a fail).
 */
import { createRng, hashSeed } from '@/core/rng';

export type VisitorKind = 'listener' | 'leaner' | 'picker';
export const VISITORS: readonly VisitorKind[] = ['listener', 'leaner', 'picker'];

/** First Night with a visitor. */
export const KNOCK_FIRST_NIGHT = 2;
/** The visitor arrives this many sim seconds into the Evening (seeded between the two). */
export const ARRIVE_SEC: readonly [number, number] = [12, 25];
/** Footsteps in the hall: `STEP_N` steps, `STEP_GAP` s apart (the approach), then the shadow strip and the act. */
export const STEP_N = 7;
export const STEP_GAP = 0.6;
/** Leaving: this many receding steps. */
export const LEAVE_N = 4;
/** Calm mode stretches every timer by this. */
export const CALM_SCALE = 1.5;
/** Listener: hold still and dark for HOLD_SEC inside a WINDOW_SEC window. */
export const LISTENER = { window: 12, hold: 8 } as const;
/** Leaner: the knock at 0, the shoves at these offsets (the chain must be on at the second). */
export const LEANER_SHOVES: readonly number[] = [2, 4, 6];
/** Picker: the scrape lasts this long, with a lock sound every SCRAPE_GAP s. */
export const PICKER = { scrape: 10 } as const;
export const SCRAPE_GAP = 1.25;
/** After the verdict the visitor lingers this long (s) before he turns away (the cracked door shuts, the shadow goes). */
export const LEAVE_HOLD = 1;
/** The cracked door, as a `doorTo` amount (about 10 cm at the leaf's free edge: 6.4 degrees of 83). */
export const CRACK_AMOUNT = 0.077;
/** A toll is at most this share of the Night's quota. */
export const TOLL_QUOTA_CAP = 0.25;

/** Per-kind visit rules. `chance` is the roll at the Heat band that brings the kind. */
export const KIND_RULES: Readonly<Record<VisitorKind, { chance: number; tollPct: number }>> = {
  listener: { chance: 0.6, tollPct: 0.08 },
  leaner: { chance: 0.75, tollPct: 0.15 },
  picker: { chance: 0.9, tollPct: 0.2 },
};

/** The visitor kind a Heat brings, or null (Heat 0-1). */
export function kindForHeat(heat: number): VisitorKind | null {
  const h = Math.floor(heat);
  if (h >= 5) return 'picker';
  if (h === 4) return 'leaner';
  if (h >= 2) return 'listener';
  return null;
}

/** The visit planned for an Evening: kind and the sim second (into the Evening) it arrives, or null (no visitor). */
export function rollVisit(seed: number, night: number, heat: number): { kind: VisitorKind; at: number } | null {
  if (night < KNOCK_FIRST_NIGHT) return null;
  const kind = kindForHeat(heat);
  if (!kind) return null;
  const r = createRng(hashSeed(seed, night, 'knock'));
  const roll = r.next();
  const at = Math.round((ARRIVE_SEC[0] + r.next() * (ARRIVE_SEC[1] - ARRIVE_SEC[0])) * 10) / 10;
  if (roll >= KIND_RULES[kind].chance) return null;
  return { kind, at };
}

/** The toll: `pct` of the pocket, at least 1 and at most TOLL_QUOTA_CAP of the quota (and never more than the pocket holds). */
export function tollOf(pct: number, pocket: number, quota: number): number {
  const have = Math.max(0, Math.floor(pocket));
  if (pct <= 0 || have <= 0) return 0;
  const cap = Math.max(1, Math.floor(Math.max(0, quota) * TOLL_QUOTA_CAP));
  return Math.min(have, Math.min(cap, Math.max(1, Math.round(have * pct))));
}

/** What a finished visit does: Heat and Harmony deltas, the toll share, whether he takes a charm. */
export interface VisitResult { kind: VisitorKind; pass: boolean; heat: number; harmony: number; tollPct: number; steal: boolean }

export function resultOf(kind: VisitorKind, pass: boolean): VisitResult {
  const base = { kind, pass, heat: 0, harmony: 0, tollPct: 0, steal: false };
  if (kind === 'listener') return pass ? { ...base, heat: -1 } : { ...base, heat: 1, tollPct: KIND_RULES.listener.tollPct };
  if (kind === 'leaner') return pass ? { ...base, harmony: -1 } : { ...base, heat: 1, harmony: -1, tollPct: KIND_RULES.leaner.tollPct };
  return pass ? { ...base, heat: -1 } : { ...base, heat: 1, tollPct: KIND_RULES.picker.tollPct, steal: true };
}

/** The charm a Picker takes: a seeded pick among the owned non-legendary, non-cursed ones (null: nothing to take). */
export function pickCharm(seed: number, night: number, owned: ReadonlyArray<{ id: string; rarity: string }>): string | null {
  const pool = owned.filter((c) => c.rarity !== 'legendary' && c.rarity !== 'cursed');
  if (pool.length === 0) return null;
  return pool[createRng(hashSeed(seed, night, 'knock.charm')).int(0, pool.length - 1)].id;
}

// ── the state machine ────────────────────────────────────────────────────────────────────────────────────────────────
export type VisitPhase = 'wait' | 'steps' | 'act' | 'leave' | 'done';

/** The whole visit as plain data (saved in the phone slice). */
export interface VisitState {
  v: 1;
  night: number;
  kind: VisitorKind;
  /** Sim seconds into the Evening when the footsteps start. */
  at: number;
  phase: VisitPhase;
  /** Seconds in the current phase, and the beats already fired in it. */
  t: number;
  n: number;
  /** Seconds into the Evening (counted while the Evening runs). */
  el: number;
  /** Timer scale (1, or CALM_SCALE for a visit that began in Calm mode). */
  k: number;
  /** Listener: the current unbroken stretch of stillness in the dark (s). */
  hold: number;
  /** Leaner: was the chain on at the second shove (null until it is checked). */
  latched: boolean | null;
  /** The outcome (null until the act resolves). */
  pass: boolean | null;
  /** He has turned away (the shadow is off, a cracked door is shut). */
  out: boolean;
}

/** The effects the host provides. Every one is a cue with a subtitle twin (`caption`). */
export interface KnockIO {
  /** Footstep `i` of `n` in the hall. `leaving` = receding. */
  footstep(i: number, n: number, leaving: boolean): void;
  shadow(on: boolean): void;
  knock(): void;
  /** Shove `i` (0-based) against the door. */
  shove(i: number): void;
  /** The chain rattles under a shove. */
  chainRattle(): void;
  scrape(): void;
  crack(open: boolean): void;
  /** A subtitle for a cue: `key` is under the `knock.` prefix. */
  caption(key: string): void;
  /** The act is decided: the host applies Heat, Harmony, the toll and the charm. */
  resolve(r: VisitResult): void;
}

/** What the host reads each step. `moved`: a walk input or an interaction this step. `looking`: the peephole look is up. */
export interface VisitInput { lights: boolean; chain: boolean; moved: boolean; looking: boolean }

export interface Visit {
  readonly state: VisitState;
  /** Advances the visit by `dt` sim seconds. `evening` is false when the Evening is not running (the clock then holds). */
  tick(dt: number, inp: VisitInput): void;
  /** A visitor is at the door (steps, act or leaving): the bed is blocked. */
  atDoor(): boolean;
  /** The act is running or done: a bot may wait for `acting() || finished()`. */
  acting(): boolean;
  finished(): boolean;
  /** The Evening ends with the visit still open (auto-sleep): the act, if running, is a fail; the shadow goes. */
  abandon(): void;
  /** After a restore: a visit caught mid-act resolves as a fail, a leaving visitor is gone, a walk in the hall starts over. */
  resume(): void;
}

/** A new visit state from a roll. */
export function newVisit(night: number, plan: { kind: VisitorKind; at: number }, calm: boolean): VisitState {
  return { v: 1, night, kind: plan.kind, at: plan.at, phase: 'wait', t: 0, n: 0, el: 0, k: calm ? CALM_SCALE : 1, hold: 0, latched: null, pass: null, out: false };
}

const num = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** A saved visit, checked field by field (a damaged slice is dropped: no visit). */
export function readVisit(x: unknown): VisitState | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!VISITORS.includes(o.kind as VisitorKind)) return null;
  const phases: readonly VisitPhase[] = ['wait', 'steps', 'act', 'leave', 'done'];
  if (!phases.includes(o.phase as VisitPhase)) return null;
  return {
    v: 1, night: Math.round(num(o.night, 1, 999, 1)), kind: o.kind as VisitorKind, at: num(o.at, 0, 600, ARRIVE_SEC[0]),
    phase: o.phase as VisitPhase, t: num(o.t, 0, 600, 0), n: Math.round(num(o.n, 0, 99, 0)), el: num(o.el, 0, 600, 0),
    k: o.k === CALM_SCALE ? CALM_SCALE : 1, hold: num(o.hold, 0, 600, 0),
    latched: typeof o.latched === 'boolean' ? o.latched : null, pass: typeof o.pass === 'boolean' ? o.pass : null,
    out: o.out === true,
  };
}

/** Machine over a state object (mutated in place: the host keeps the same reference in its save slice). */
export function createVisit(st: VisitState, io: KnockIO): Visit {
  const go = (phase: VisitPhase): void => { st.phase = phase; st.t = 0; st.n = 0; };

  const finish = (pass: boolean): void => {
    st.pass = pass;
    io.resolve(resultOf(st.kind, pass));
    go('leave');
  };

  const leaver = (): void => {
    // the visitor turns away: the shadow goes, a door that was cracked is shut again
    st.out = true;
    io.shadow(false);
    io.crack(false);
  };

  const actListener = (inp: VisitInput, dt: number): void => {
    // stillness in the dark: any light or any input starts the stretch over; the look through the peephole only costs time
    if (inp.lights || inp.moved) st.hold = 0;
    else if (!inp.looking) st.hold += dt;
    if (st.hold >= LISTENER.hold * st.k) { io.caption('listener.gone'); finish(true); return; }
    if (st.t >= LISTENER.window * st.k) { io.caption('listener.slip'); finish(false); }
  };

  const actLeaner = (inp: VisitInput): void => {
    // st.n: 0 = the knock is due, 1 + i = shove i is due next
    if (st.n === 0) { io.knock(); io.caption('leaner.knock'); st.n = 1; }
    const s = st.n - 1;
    if (s >= LEANER_SHOVES.length || st.t < LEANER_SHOVES[s] * st.k) return;
    io.shove(s);
    if (inp.chain) io.chainRattle();
    io.caption('leaner.shove');
    st.n += 1;
    if (s === 1) {
      // the second shove is the deadline: the chain holds and he gives up, or the third shove finds the door loose
      st.latched = inp.chain;
      if (inp.chain) { io.caption('leaner.gone'); finish(true); }
    } else if (s === 2) {
      io.crack(true);
      io.caption('leaner.crack');
      finish(false);
    }
  };

  const actPicker = (inp: VisitInput): void => {
    if (st.t >= st.n * SCRAPE_GAP * st.k && st.t < PICKER.scrape * st.k) {
      if (st.n === 0) io.caption('picker.scrape');
      io.scrape();
      st.n += 1;
    }
    if (st.t >= PICKER.scrape * st.k) {
      const pass = inp.chain && !inp.lights;
      io.caption(pass ? 'picker.gone' : 'picker.in');
      finish(pass);
    }
  };

  return {
    state: st,
    atDoor: () => st.phase === 'steps' || st.phase === 'act' || st.phase === 'leave',
    acting: () => st.phase === 'act',
    finished: () => st.phase === 'done',

    tick(dt, inp) {
      if (st.phase === 'done') return;
      if (st.phase === 'wait') {
        st.el += dt;
        if (st.el >= st.at) { go('steps'); io.caption('steps'); }
        return;
      }
      st.el += dt;
      st.t += dt;
      switch (st.phase) {
        case 'steps': {
          while (st.n < STEP_N && st.t >= st.n * STEP_GAP * st.k) { io.footstep(st.n, STEP_N, false); st.n++; }
          if (st.t >= STEP_N * STEP_GAP * st.k) {
            io.shadow(true);
            io.caption(`arrive.${st.kind}`);
            go('act');
          }
          break;
        }
        case 'act':
          if (st.kind === 'listener') actListener(inp, dt);
          else if (st.kind === 'leaner') actLeaner(inp);
          else actPicker(inp);
          break;
        case 'leave': {
          // a beat after the verdict he turns away: the shadow goes and a cracked door is pushed shut
          if (!st.out && st.t >= LEAVE_HOLD * st.k) leaver();
          while (st.n < LEAVE_N && st.t >= (st.n + 0.5) * STEP_GAP * st.k) { io.footstep(st.n, LEAVE_N, true); st.n++; }
          if (st.t >= (LEAVE_N + 1) * STEP_GAP * st.k) go('done');
          break;
        }
        default: break;
      }
    },

    abandon() {
      if (st.phase === 'done') return;
      if (st.phase === 'act') { st.pass = false; io.resolve(resultOf(st.kind, false)); }
      leaver();
      go('done');
    },

    resume() {
      if (st.phase === 'act') { st.pass = false; io.resolve(resultOf(st.kind, false)); leaver(); go('done'); }
      else if (st.phase === 'leave') { leaver(); go('done'); }
      else if (st.phase === 'steps') { go('wait'); st.el = Math.max(st.el, st.at); }
    },
  };
}
