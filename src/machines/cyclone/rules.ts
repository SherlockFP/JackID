/**
 * Cyclone Light Ring — pure rules (no three, kit or DOM). Shared by the live machine (`index.ts`) and the headless
 * play contract (`playHeadless`), so the simulated RTP IS the live RTP. Catalogue: MACHINES_machines §11.
 *
 * Rules: insert a stake (1–50). A light chases clockwise around 48 lamps at 41–51 lamps/s (a seeded, slowly
 * varying lap speed). Press STOP within 10 s (a seeded auto-stop follows at 10–11 s). The light then coasts
 * k lamps (k uniform 0–5) and stops on the lamp it lands on, which pays stake × lamp value.
 *
 * Layout: lamp 0 is the JACKPOT (paid only when the Eye is open, i.e. armed). For i = 1…47 the value is
 * PATTERN[i mod 6] = [0,1,0,3,0,1][i mod 6]. Every 6 consecutive lamps sum to 5, so the base expectation is 5/6
 * whatever the press; only the armed jackpot rewards aiming (5 of the 6 windows that contain lamp 0 pay 5×).
 *
 * Randomness: a commit always draws exactly four values (arm, speed seed, coast k, auto-stop time), whatever the
 * luck or charms, so a seed replays identically.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const LAMPS = 48;                 // ring size (period-6 layout needs 48 = 8 × 6)
export const JP = 0;                     // jackpot lamp index (12 o'clock)
export const SECOND_OFFSET = 24;         // the second light sits 24 lamps away (opposite side)
export const PATTERN: readonly number[] = [0, 1, 0, 3, 0, 1];   // lamp i ≥ 1: PATTERN[i mod 6]
export const JP_BASE = 25;               // armed JACKPOT multiplier before charms
export const ARM_BASE = 1 / 30;          // arm chance before charms
export const LUCK_STEP = 0.01;           // Metronome: per luck point +1 % absolute arm chance …
export const LUCK_CAP = 0.2;             // … capped at +20 %
export const STOP_LIMIT_S = 10;          // player window for STOP
export const AUTO_JITTER_S = 1;          // seeded auto-stop lands in [10, 11) s
export const COAST_MAX = 5;              // coast k in 0…5
export const MAX_WINDOW = 3;             // jpWindow cap: armed coast range never shrinks below 0…2
export const SPEED_MEAN = 46;            // lamps / s
export const SPEED_AMP = 5;              // speed = 46 ± 5 lamps/s (41…51, inside the 40–52 band)
export const WOBBLE_S = 6;               // the lap speed wobbles with a 6 s period (smooth per lap)
export const SLOW_MULT = 0.8;            // Slow-mo milestone: the chase runs at ×0.8
export const NUDGE_FRAC = 0.25;          // Golden Ratchet: 25 % of the stake …
export const NUDGE_WINDOW_S = 3;         // … within 3 s after the stop, moves the result one lamp clockwise
export const MIN_STAKE = 1, MAX_STAKE = 50;
export const REVEAL_S = 0.8;             // armed reveal before the chase
export const MAX_PAY_MULT = JP_BASE * 2 * 2;   // JP with ×2 milestone and a 2× charm, for the host sanity cap

export const HOOK_JACKPOT = 'x.jackpotChance' as ModHook;    // × on the 1/30 arm chance (base 1)
export const HOOK_JPMULT = 'm.cyclone.jpMult' as ModHook;    // × on the JP value (base 1)
export const HOOK_WINDOW = 'm.cyclone.jpWindow' as ModHook;  // N: armed coast range 0…(5 − N) (base 0)
export const HOOK_SLOW = 'm.cyclone.slowMo' as ModHook;      // 1 = chase × 0.8 (base 0)
export const HOOK_SECOND = 'm.cyclone.secondLight' as ModHook; // 1 = second light, pays the better (base 0)
export const HOOK_NUDGE = 'x.wheel.nudge' as ModHook;        // Golden Ratchet, 1 = nudge window (base 0)

/** Wrap any integer to a lamp index 0…47. */
export const lampOf = (i: number): number => ((i % LAMPS) + LAMPS) % LAMPS;

/** Value shown for lamp `i`. Lamp 0 is the JP: paid only when armed (`jpMult` = hook multiplier, base 1). */
export function lampValue(i: number, armed: boolean, jpMult = 1): number {
  const j = lampOf(i);
  if (j === JP) return armed ? JP_BASE * jpMult : 0;
  return PATTERN[j % 6];
}

/** Lap speed phase from the seed (seed in [0, 1)). */
export const phaseOf = (speedSeed: number): number => 2 * Math.PI * speedSeed;

/**
 * Light position in lamps, `t` seconds after the chase starts. Closed form of
 * `∫ (46 + 5·sin(ωt + φ)) dt`, so the speed is smooth, seeded and always within 41–51 lamps/s.
 */
export function lampPos(t: number, phase: number, slow = 1): number {
  const w = (2 * Math.PI) / WOBBLE_S;
  return slow * (SPEED_MEAN * t + (SPEED_AMP / w) * (Math.cos(phase) - Math.cos(w * t + phase)));
}

/** The lamp under the light at time `t` (what STOP reads). */
export function lampAt(t: number, phase: number, slow = 1): number {
  return lampOf(Math.floor(lampPos(t, phase, slow)));
}

export interface Commit {
  /** The Eye opened: lamp 0 pays the JP this play. */
  armed: boolean;
  /** Lap-speed seed in [0, 1). Watchers reproduce the chase from it. */
  speedSeed: number;
  /** Coast distance after STOP, 0…5 (armed plays may be narrowed by jpWindow). */
  k: number;
  /** Seconds after the chase starts when the seeded auto-stop fires. */
  autoT: number;
}

export interface CommitOpts {
  luck: number;
  /** × on the base arm chance (`x.jackpotChance`, base 1). */
  jpChance: number;
  /** jpWindow N (armed plays only), clamped to 0…MAX_WINDOW. */
  window: number;
}

/** Arm chance after charms: 1/30 × jpChance + 1 % per luck point (cap +20 %). */
export function armChance(o: CommitOpts): number {
  const bonus = Math.min(LUCK_CAP, Math.max(0, o.luck) * LUCK_STEP);
  return Math.min(1, Math.max(0, ARM_BASE * Math.max(0, o.jpChance) + bonus));
}

/** One commit: exactly four draws (arm, speed seed, coast, auto-stop), whatever the charms. */
export function rollCommit(rng: Rng, o: CommitOpts): Commit {
  const u1 = rng.next(), u2 = rng.next(), u3 = rng.next(), u4 = rng.next();
  const armed = u1 < armChance(o);
  const n = armed ? Math.min(MAX_WINDOW, Math.max(0, Math.floor(o.window))) : 0;
  const kMax = COAST_MAX - n;
  return {
    armed,
    speedSeed: u2,
    k: Math.min(kMax, Math.floor(u3 * (kMax + 1))),
    autoT: STOP_LIMIT_S + u4 * AUTO_JITTER_S,
  };
}

export interface Outcome {
  /** Lamp under the primary light at STOP. */
  press: number;
  k: number;
  /** Primary landing lamp, press + k. */
  lamp: number;
  /** Second light landing lamp (lamp + 24) or −1 without the second light. */
  lamp2: number;
  /** Lamp that pays (the better of the two when the second light exists). */
  paid: number;
  /** Multiplier paid (0, 1, 3 or the JP value). */
  value: number;
  jp: boolean;
}

export interface ResolveOpts { jpMult: number; second: boolean }

/** Landing and payout for a STOP at `press` with coast `k`. Pure. */
export function resolve(press: number, k: number, armed: boolean, o: ResolveOpts): Outcome {
  const lamp = lampOf(press + k);
  const v1 = lampValue(lamp, armed, o.jpMult);
  let paid = lamp, value = v1, lamp2 = -1;
  if (o.second) {
    lamp2 = lampOf(lamp + SECOND_OFFSET);
    const v2 = lampValue(lamp2, armed, o.jpMult);
    if (v2 > v1) { paid = lamp2; value = v2; }
  }
  return { press, k, lamp, lamp2, paid, value, jp: armed && paid === JP };
}

/** Nudge (Golden Ratchet): one lamp clockwise. */
export const nudgeLamp = (lamp: number): number => lampOf(lamp + 1);
/** Nudge cost in coins: 25 % of the stake, at least 1. */
export const nudgeCost = (stake: number): number => Math.max(1, Math.round(stake * NUDGE_FRAC));

/** Rounds the exact payout to whole coins, carrying the remainder (unbiased for 1-coin stakes). */
export function roundPayout(exact: number, carry: number): { gross: number; carry: number } {
  const t = exact + carry;
  const gross = Math.max(0, Math.floor(t + 1e-9));
  return { gross, carry: Math.max(0, t - gross) };
}

/** Headless single play (staff auto-play, bench Sim): random press, same commit and resolve as the live machine. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const c = rollCommit(rng, {
    luck: h.luck, jpChance: h.mod(HOOK_JACKPOT, 1), window: h.mod(HOOK_WINDOW, 0),
  });
  const press = rng.int(0, LAMPS - 1);
  const r = resolve(press, c.k, c.armed, {
    jpMult: h.mod(HOOK_JPMULT, 1), second: h.mod(HOOK_SECOND, 0) > 0,
  });
  const { gross } = roundPayout(bet * r.value, rng.next());
  return { gross, tags: r.jp ? ['cyclone:jackpot'] : [] };
};
