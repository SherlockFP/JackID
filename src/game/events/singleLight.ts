/**
 * SINGLE LIGHT (wave 75 floor event). The power trips for 40 s and only ONE machine stays lit: the Night's spotlight machine
 * when it is on the floor, else a seeded pick. That machine pays ×1.5 (a scoped `payout.mult`, the same hook the Spotlight
 * uses). Every other machine refuses a play while the event runs. The rule is a gate, not a payout change on the others.
 */
import type { Rng } from '@/core/rng';
import type { MachineId } from '@/core/types';
import type { ModEffect } from '@/game/modifiers.types';
import { NO_FLOOR, type WatchFloor } from './types';
import { SIGIL_MULT } from './omens';

export const SINGLE_LIGHT_S = 40;
export const SINGLE_LIGHT_MULT = 1.5;

/** The lit machine: the spotlight when it is open on the floor, otherwise a seeded pick. Null on an empty floor. */
export function pickLitMachine(rng: Rng, floor: WatchFloor = NO_FLOOR): MachineId | null {
  const ms = floor.machines;
  if (ms.length === 0) return null;
  if (floor.spotlight && ms.includes(floor.spotlight)) return floor.spotlight;
  return rng.pick(ms);
}

/** The lit machine's payout bonus for the event's life (scoped, so no other machine gets it). */
export function singleLightEffects(lit: MachineId): ModEffect[] {
  return [{ hook: 'payout.mult', op: 'mult', value: SINGLE_LIGHT_MULT, scope: { machines: [lit] } }];
}

/** The Sigil omen's version: the lit machine pays x2 and nothing else is gated (omens.ts). */
export function sigilEffects(lit: MachineId): ModEffect[] {
  return [{ hook: 'payout.mult', op: 'mult', value: SIGIL_MULT, scope: { machines: [lit] } }];
}

/** The play gate: with the event live, only the lit machine may be played. No lit machine means no gate (degrade). */
export function singleLightAllows(lit: MachineId | null | undefined, mid: MachineId): boolean {
  return !lit || mid === lit;
}
