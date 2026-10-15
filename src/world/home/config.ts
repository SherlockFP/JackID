/**
 * THE APARTMENT (wave 69, world/home): the plan and the tuning. Pure data, no THREE, no DOM.
 *
 * The flat is planned in local metres and placed at `HOME_ORIGIN` (src/game/home/contract.ts), far from the pit and from
 * THE UNDERNEATH. Local +X is east, +Z is south (the front door, and the hallway beyond it), -Z is north (the window).
 * Yaw follows the game's convention (forward = (-sin yaw, -cos yaw)): yaw 0 faces north, yaw π faces the front door.
 */
import { HOME_ORIGIN } from '@/game/home/contract';

/** A plan point (local metres) to world space. */
export const at = (x: number, y: number, z: number): [number, number, number] => [HOME_ORIGIN[0] + x, y, HOME_ORIGIN[2] + z];

/** Zone id of the apartment room (layout.ts ZONES). The hallway is outside it, so the switch never dims the hall bulb. */
export const HOME_ZONE = 'home';

/** The room's interior half-extents (m): x in [-3, 3], z in [-2.5, 2.5] (6 x 5 m). */
export const ROOM_X = 3;
export const ROOM_Z = 2.5;
/** Ceiling height (m). The walls run 0.3 m outward from the interior (room.ts). */
export const CEIL = 2.6;

/** The room's zone rectangle in world space [x0, z0, x1, z1] (layout.ts). */
export const HOME_ZONE_RECT: readonly [number, number, number, number] = [
  HOME_ORIGIN[0] - ROOM_X, HOME_ORIGIN[2] - ROOM_Z, HOME_ORIGIN[0] + ROOM_X, HOME_ORIGIN[2] + ROOM_Z,
];
/** The room's atmosphere (layout.ts ZONES look): a dark flat, the window the only light, the hallway is not in this zone. */
export const HOME_LOOK = { fog: { color: 0x08080e, near: 3, far: 14 }, ambient: 0x15151f } as const;

/**
 * The front door: a 1.0 m opening in the south wall, its leaf hinged on the west side. The leaf is 0.9 m wide and
 * swings into the room (positive yaw) by up to DOOR_OPEN_RAD.
 */
export const DOOR_X0 = -1.1;
export const DOOR_X1 = -0.1;
export const DOOR_H = 2.2;
export const DOOR_HINGE_X = -1.05;
export const DOOR_Z = 2.62;
export const DOOR_OPEN_RAD = 1.45;
/** The shut leaf's collider band (world z). */
export const DOOR_COLLIDE_Z: readonly [number, number] = [2.56, 2.68];

/** The window: a 2.0 x 1.2 m opening in the north wall. */
export const WIN_X0 = -1.6;
export const WIN_X1 = 0.4;
export const WIN_Y0 = 0.9;
export const WIN_Y1 = 2.1;

/** The hallway outside the front door (x in [-1.6, 0.4], z in [2.8, 5.2]). */
export const HALL_X0 = -1.6;
export const HALL_X1 = 0.4;
export const HALL_Z1 = 5.2;

/**
 * Light tuning. The level boosts every hint once (level.ts FIXTURE_GAIN 1.8, FIXTURE_RANGE 1.2), so these are the values
 * before that boost. Only the room lights carry zone `home`, so `world.lights.setLevel('home', ...)` is the switch.
 */
export const LIGHT = {
  ceiling: { color: 0xffe2b0, intensity: 0.7, range: 4.6 },
  pendant: { color: 0xffb070, intensity: 0.55, range: 3.2 },
  hall: { color: 0xffd9a0, intensity: 0.55, range: 3.5 },
} as const;

/** The seated spouse's chair (the mannequin sits here, facing the door) and the empty chair opposite it. */
export const SPOUSE_SEAT = { x: 1.6, z: -0.75 } as const;
export const EMPTY_SEAT = { x: 1.6, z: 1.25 } as const;

/** Furniture plan (local): the bed's footprint, the kitchen table's footprint and top height. */
export const BED = { x0: -2.95, x1: -1.1, z0: -1.3, z1: 0.1, h: 0.42 } as const;
export const TABLE = { x0: 1.05, x1: 2.15, z0: -0.1, z1: 0.7, top: 0.74 } as const;

/**
 * The anchors (world.anchor, the cutscene and camera targets). Each is a plan point; `yaw` is the facing (game convention).
 * `switch` is a point in the room, 0.2 m in front of the plate. `window` is a point in the room, 0.3 m in front of the glass.
 */
export const ANCHOR_PLAN = {
  spawn: { p: [-0.6, 0, 1.7], yaw: 0 },
  bed: { p: [-2.0, 0.5, -0.6], yaw: 0 },
  door: { p: [-1.0, 1.05, 2.4], yaw: 0 },
  peephole: { p: [-0.6, 1.55, 2.05], yaw: Math.PI },
  hall: { p: [-0.6, 0, 3.9], yaw: 0 },
  switch: { p: [0.7, 1.2, 2.2], yaw: 0 },
  phone: { p: [2.2, 1.3, -2.45], yaw: 0 },
  table: { p: [1.6, TABLE.top, 0.3], yaw: 0 },
  spouse: { p: [SPOUSE_SEAT.x, 0, SPOUSE_SEAT.z], yaw: 0 },
  window: { p: [-0.6, 1.5, -2.2], yaw: 0 },
} as const;
