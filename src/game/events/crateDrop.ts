/**
 * CRATE DROP (wave 75 floor event). A crate lands on the Lobby spot. Its reward is rolled when it drops (a Ticket, a tonic or a
 * charm), so the reveal never needs the rng again. The player walks within `CRATE_OPEN_R` and presses E. The first press opens
 * it, once. With no Lobby anchor in the world the crate opens on any press (degrade), and with no player position it is in reach.
 */
import type { Rng } from '@/core/rng';
import type { FloorAward, FloorPt, WatchFloor } from './types';

export const CRATE_OPEN_R = 2.5;
export const CRATE_TONICS = ['tonic.lucky_mint', 'tonic.iron_nerve', 'tonic.quick_pulse', 'tonic.dread_salts'] as const;

export interface CrateState {
  /** Where it landed; null = no anchor in the world. */
  at: FloorPt | null;
  reward: FloorAward;
  open: boolean;
}

export function rollCrate(rng: Rng, floor: WatchFloor = { machines: [] }): CrateState {
  const k = rng.weighted(['ticket', 'tonic', 'charm'], [5, 3, 2]);
  const reward: FloorAward = k === 'ticket'
    ? { kind: 'ticket', n: 1 }
    : k === 'tonic' ? { kind: 'tonic', id: rng.pick(CRATE_TONICS) } : { kind: 'charm' };
  return { at: floor.lobby ?? null, reward, open: false };
}

/** Within reach of the crate. No anchor or no player position counts as in reach (degrade). */
export function crateInReach(s: CrateState, pos: FloorPt | null): boolean {
  if (!s.at || !pos) return true;
  return Math.hypot(pos.x - s.at.x, pos.z - s.at.z) <= CRATE_OPEN_R;
}

/** One press of E. Returns the reward the first time, and null on every other call. */
export function tryOpenCrate(s: CrateState, pos: FloorPt | null, pressed: boolean): FloorAward | null {
  if (s.open || !pressed || !crateInReach(s, pos)) return null;
  s.open = true;
  return s.reward;
}
