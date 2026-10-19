/**
 * Seat geometry of the Tally Table (machine-local metres, +Z = the player's side): the chairs, where a seated mannequin's root goes
 * and the player's seat camera. Pure numbers, no three.js objects, so the layout can be tested without a renderer.
 *
 * Shared cause of "the opponent sank into his chair": the `Sitting_*` clips keep the pelvis ABOVE and BEHIND the mannequin root
 * (`SEATED_HIP`, src/kit/mannequin.ts, measured on the rig), so a root placed at the chair centre puts the hips behind the backrest.
 * The root must stand a little in front of the chair (`seatedRoot`), like the kit's own casino seats do with `SeatDef.stand`.
 */
import { SEATED_HIP } from '@/kit/mannequin';

/** Cushion top and the chairs' centres. */
export const CHAIR_TOP = 0.48;
export const PLAYER_CHAIR_Z = 0.68;
export const RIVAL_CHAIR_Z = -0.7;
/** The octagonal top: radius of the felt (table top height `TOP` lives in model.ts). */
export const TABLE_R = 0.56;
/** Heights the seated figures are built for (the default avatar and the rival model before `lookOf` rescales it). */
export const PLAYER_HEIGHT = 1.75;
export const RIVAL_HEIGHT = 1.76;

/**
 * Where a seated mannequin's ROOT goes so its hips land on the cushion. `toward` is +1 for a sitter who faces +Z (the rival) and -1
 * for one who faces -Z (the player). A tall sitter whose legs would pass under the floor stays at the floor.
 */
export function seatedRoot(height: number, chairZ: number, toward: 1 | -1, seatTop = CHAIR_TOP): { y: number; z: number } {
  return {
    y: Math.max(0, seatTop - (SEATED_HIP.up - SEATED_HIP.contact) * height),
    z: chairZ + toward * (SEATED_HIP.back * height - 0.02),
  };
}

/**
 * The player's seat camera: high over the chair and pitched about 46 degrees down, so the felt, the rival's head and shoulders and the
 * floor all sit between the HUD's top stack and its bottom stack (rival head ~ line 45 of 225, table far edge ~ 100, near edge ~ 200).
 * A standing figure anywhere in the footprint would fill this view, which is why the Clerk steps out of it while you sit (index.ts).
 */
export const SEAT_EYE: readonly [number, number, number] = [0, 2.2, PLAYER_CHAIR_Z + 0.37];
export const SEAT_LOOK: readonly [number, number, number] = [0, 0.74, -0.36];
export const SEAT_FOV = 60;
