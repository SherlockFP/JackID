/**
 * Floor event shared types (wave 75, events lane). Pure data: the Watch event module (`src/game/watchEvents.ts`) and the run
 * read and write these. No DOM, no three, no clock. Every reward is handed to the run, which owns Tickets, tonics, charms
 * and the Watch clock.
 */
import type { MachineId } from '@/core/types';

/** A point on the floor plane, metres (x, z). */
export interface FloorPt { x: number; z: number }

/** A reward a floor event hands to the run. The run applies it. */
export type FloorAward =
  | { kind: 'ticket'; n: number }
  | { kind: 'tonic'; id: string }
  | { kind: 'time'; s: number }
  | { kind: 'charm' };

/** What the run takes from `WatchEvents.takeOutcomes()`, once per frame. */
export type FloorOutcome =
  | { kind: 'raise'; price: number }
  | { kind: 'auction'; won: boolean; spent: number; award: FloorAward | null; consolation: FloorAward | null }
  | { kind: 'crate'; reward: FloorAward }
  | { kind: 'dare'; result: DareResult };

export type DareResult = 'doubled' | 'wiped' | 'loss';

/**
 * Floor facts the run hands in through `WatchEventHost.floor()`. Every field is optional in effect: a missing anchor or an
 * empty machine list degrades the event (see each event), it never throws.
 */
export interface WatchFloor {
  /** Machine ids open on the floor now. */
  machines: readonly MachineId[];
  /** The Night's spotlight machine, when it is on the floor. */
  spotlight?: MachineId | null;
  /** The Lobby crate spot (the centre of the Lobby), when the world has one. */
  lobby?: FloorPt | null;
}

/** No floor facts: every event that needs one degrades. */
export const NO_FLOOR: WatchFloor = { machines: [] };
