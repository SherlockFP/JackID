/**
 * THE HOLLOW DOOR (TR: Oyuk Kapı): shared constants and types. Pure data, no THREE, no DOM.
 *
 * A secret portal, once per run. Three reveal triggers (the crack knock, the 3:33 phone call, the red seam) open a
 * doorway; walking through it drops you into THE UNDERNEATH, a void room far below the pit where one Dark Lord
 * plays Russian roulette with you at the Lords' table (the `lordstable` machine, placed on `HOLLOW_TABLE_SLOT`).
 */
import type { V3 } from '@/core/types';
import type { SlotDef } from '../types';

export type LordId = 'ash' | 'ledgers' | 'mirrors';
export const LORD_IDS: readonly LordId[] = ['ash', 'ledgers', 'mirrors'];

/** a: the crack knock (Last Call, Night 2+), b: the 3:33 phone call ("go down"), c: the red seam (empty pocket, loan refused). */
export type HollowReason = 'crack' | 'phone333' | 'seam';
/** sealed: nothing revealed yet · open: a doorway is up · inside: in THE UNDERNEATH · spent: gone for this run. */
export type HollowPhase = 'sealed' | 'open' | 'inside' | 'spent';
/** How the run left the door: walked back up, the duel resolved (won), or the reveal timed out. */
export type HollowExit = 'left' | 'resolved' | 'missed';

/**
 * THE UNDERNEATH origin: the floor of the void room sits at `HOLLOW_HOME[1]`. It is far from the pit footprint (120 m out;
 * the camera far plane is 60 m). The height must stay above the player's fall limit (FALL_LIMIT_Y = -12 in
 * `src/player/controller.ts`): below it the player counts as lost and the screen fades out for good.
 */
const H: V3 = [120, -10, 120];
/** THE UNDERNEATH origin (see above). */
export const HOLLOW_HOME: V3 = H;
/** Room half-extent (m) and ceiling height above its floor. */
export const UNDER_HALF = 9;
export const UNDER_H = 4.6;
/** Doorway opening (m). */
export const DOOR_W = 1.2;
export const DOOR_H = 2.2;
/** Lord mannequins are scaled up by this factor. */
export const LORD_SCALE = 1.6;

/** The table's top height and centre. The lordstable machine stands on it. */
export const TABLE_Y = 0.9;
export const TABLE_POS: V3 = [H[0], H[1] + TABLE_Y, H[2] - 1.5];
/** Where a walk-in lands: just inside the south doorway, facing the table (yaw 0 faces −Z). */
export const ARRIVE: V3 = [H[0], H[1], H[2] + 6];
/** The way back up (south wall, opening faces the room). */
export const EXIT_DOOR: V3 = [H[0], H[1], H[2] + UNDER_HALF];
/**
 * Lord stations: the three dealers of the lordstable machine, behind the table (its LORD_X ±1.3 / 0 and LORD_Z −0.72 from the
 * table centre). The floor point under each Lord's feet.
 */
export const LORD_POS: Record<LordId, V3> = {
  ash: [H[0] - 1.3, H[1], H[2] - 2.22],
  ledgers: [H[0], H[1], H[2] - 2.22],
  mirrors: [H[0] + 1.3, H[1], H[2] - 2.22],
};
/** Lord interaction band (m above the floor): above the table's own pick band (0.2 to 1.4), so E on the table sits and E on a Lord picks him. */
export const LORD_PICK_Y: readonly [number, number] = [1.5, 2.9];

/** The hanging lamp: its shade sits this far below the room's ceiling (the cord runs up to the ceiling). */
export const LAMP_DROP = 2.2;

/**
 * Trigger (a) doorway: the cracked wall plate, the Sump's north wall (inner face z = 6, facing +Z). The Sump is the
 * underground pit under the Lobby trapdoor, the only corridor below the floor with a bare wall and no machine on it.
 */
export const CRACK_DOOR: V3 = [-2.2, -30, 6.0];
/** Where the player stands when the crack door closes or they climb back out (in front of the plate, facing it). */
export const CRACK_RETURN: V3 = [-2.2, -30, 7.4];

/** Knocks: this many E presses inside this many seconds open the crack. */
export const KNOCKS = 3;
export const KNOCK_WINDOW_S = 4;

/** How long a revealed doorway stays open before it closes unused (the reveal is then spent). */
export const OPEN_S: Record<HollowReason, number> = { crack: 45, phone333: 40, seam: 30 };
/** A seam opens this far in front of the player (m). */
export const SEAM_AHEAD_M = 2.2;
/** Leaves split over this long (seconds); Calm Mode uses the shorter one. */
export const SPLIT_S = 1.6;
export const SPLIT_CALM_S = 0.7;

/** Lord duel table slot (WORLD-ARCH): append to `layout.ts` SLOTS and give the zone a ZONES entry (`hollow`). */
export const HOLLOW_TABLE_SLOT: SlotDef = { id: 'HOLLOW-TABLE', size: 'L', zone: 'hollow', pos: [H[0], H[1], H[2] - 1.5], rotY: 0, y: TABLE_Y };
