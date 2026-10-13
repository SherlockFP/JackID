/**
 * The Elevator — pure rules (crash game). Shared by the live machine (`index.ts`) and the headless play contract
 * (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS the live RTP. No three, no DOM, no kit.
 *
 * Model: the car climbs with multiplier m(t) = e^(0.07·t). The crash point is drawn at DOORS from the host stream:
 *   U ∈ (0,1] uniform, crash = min(250, max(1, floor(96 / U) / 100)).
 *   P(crash ≥ m) = 0.96 / m for 1.01 ≤ m ≤ 250, so every cash-out target has RTP 96 %.
 *   P(crash = 1.00) = 4.95 %. crash = 250 is a ROOF (riders still aboard are paid ×250).
 * The snap happens at tSnap = ln(crash) / 0.07 seconds after departure.
 */
import { createRng, type Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const RATE = 0.07;             // m(t) = e^(RATE·t)
export const RTP = 0.96;
export const MAX_MULT = 250;          // crash ceiling and ROOF multiplier
export const BOARD_S = 8;             // BOARDING
export const DOORS_S = 1.5;           // DOORS (bets locked and debited, fairness commitment broadcast)
export const SNAP_S = 2;              // SNAP / ROOF
export const AFTER_S = 4;             // AFTERMATH (winch returns the car to B7)
export const STAKE_MIN = 1, STAKE_MAX = 500;
export const TABLE_CAP = 6;           // seated humans + bots
export const BOT_MAX = 4;
export const BASE_GRACE_MS = 150;     // latency grace for cash-outs (+ m.elevator.lateStep)
export const INSURE_MIN = 1.5;        // auto-insurance covers falls at a target of at least ×1.5
export const REFUND_CAP = 0.30;       // Safety Net: at most 30 % chance
export const TARGETS: readonly number[] = [1.5, 2, 3, 5, 10, 20, 50, 100, 250];
export const HEADLESS_TARGET = 2;     // staff auto-play cashes at ×2

/** Charm hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_INSURE = 'm.elevator.autoInsurance' as ModHook; // 1 = on
export const HOOK_LATE = 'm.elevator.lateStep' as ModHook;        // extra grace, ms
export const HOOK_FLOOR = 'm.elevator.floorBonus' as ModHook;     // +x per floor (doubling) passed, cash-outs only

/** Crash point from a uniform U in (0,1]. */
export function crashFromU(u: number): number {
  if (!(u > 0)) return MAX_MULT;
  return Math.min(MAX_MULT, Math.max(1, Math.floor(96 / u) / 100));
}
/** One crash draw from a stream (always consumes exactly one value). */
export function drawCrash(rng: Rng): number { return crashFromU(1 - rng.next()); }
/** Fairness check: the crash point a revealed round seed produces. */
export function crashFromSeed(seed: number): number { return drawCrash(createRng(seed)); }
/** Multiplier after `t` seconds of riding. */
export const multAt = (t: number): number => Math.exp(RATE * t);
/** Seconds after departure at which the cable snaps at this crash point. */
export const snapAt = (crash: number): number => Math.log(crash) / RATE;
/** Height of the car centre on the log scale, machine-local (×1 = 0.30 m, ×250 = 3.50 m). */
export const carYOf = (m: number): number => 0.3 + 1.335 * Math.log10(Math.max(1, m));
/** Floors passed: one per doubling. */
export const floorsPassed = (m: number): number => Math.max(0, Math.floor(Math.log2(Math.max(1, m))));
/** Cash-out multiplier including the floor bonus (ROOF and insurance are exact and skip it). */
export const cashMult = (m: number, floorBonus: number): number => m + floorBonus * floorsPassed(m);
/**
 * Host-side time of an accepted cash-out: the request is credited `grace` seconds in the past (lag compensation),
 * never before the previous accepted cash-out, never after now. Accepted only if the result is before tSnap.
 */
export function outTime(nowSec: number, lastSec: number, lateStepMs: number): number {
  const grace = (BASE_GRACE_MS + Math.max(0, lateStepMs)) / 1000;
  return Math.min(nowSec, Math.max(nowSec - grace, lastSec));
}
/** Safety Net: chance per 1 point of luck, capped. */
export const refundChance = (luck: number): number => Math.min(REFUND_CAP, Math.max(0, 0.01 * luck));
/** Bot cash-out target (cosmetic): 0.96 / U' clipped to 1.1–50. */
export function botTarget(rng: Rng): number {
  const u = 1 - rng.next();
  return Math.min(50, Math.max(1.1, RTP / u));
}

/** Headless single ride: cash out at ×2 (or fall), with the Safety Net refund on a fall. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const crash = drawCrash(rng);
  const gate = rng.next();
  if (crash >= HEADLESS_TARGET) {
    return { gross: Math.floor(bet * cashMult(HEADLESS_TARGET, h.mod(HOOK_FLOOR, 0))), tags: [] };
  }
  const refund = gate < refundChance(h.luck);
  return { gross: refund ? Math.floor(bet / 2) : 0, tags: refund ? ['refund'] : [] };
};
