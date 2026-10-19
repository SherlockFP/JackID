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
/** The leaf is 0.9 m wide. Its collider is the plan footprint of the leaf at its swing angle, padded for the thickness. */
export const LEAF_W = 0.9;
const LEAF_PAD = 0.04;

/**
 * The leaf's plan footprint [x0, z0, x1, z1] (plan metres) at a swing of `rad` into the room. The hinge is the
 * fixed end, the tip sweeps toward -z (north, into the room). At rad 0 it covers the shut leaf in the south wall's opening.
 */
export function leafFootprint(rad: number): [number, number, number, number] {
  const tx = DOOR_HINGE_X + LEAF_W * Math.cos(rad);
  const tz = DOOR_Z - LEAF_W * Math.sin(rad);
  return [
    Math.min(DOOR_HINGE_X, tx) - LEAF_PAD, Math.min(DOOR_Z, tz) - LEAF_PAD,
    Math.max(DOOR_HINGE_X, tx) + LEAF_PAD, Math.max(DOOR_Z, tz) + LEAF_PAD,
  ];
}

/** The peephole lens: 0.45 m out from the hinge on the leaf, at eye height, on the room face of the leaf. */
export const PEEP = { x: DOOR_HINGE_X + 0.45, y: 1.55 } as const;
/**
 * The peephole look's camera: in the door's plane, 0.02 m behind the lens, facing out (south). The lens and the leaf's room
 * face are then behind the camera and the leaf's outer face is culled from inside, so the view runs through the opening to
 * the hall (the wave 70 visitors stand there). The camera sits outside the room zone, which is right: it looks out.
 */
export const PEEP_EYE_Z = DOOR_Z - 0.02;

/**
 * The stations on the room side of the south wall (plan boxes [x0, y0, z0, x1, y1, z1]). Each sits in the room, in front of
 * the wall face (z 2.5) and the shut leaf (z 2.58), so a ray from the room reaches it before either occludes it.
 * The interaction ray grows every box 0.5 m down and 0.3 m up, so the boxes' depth matters: the peephole is shallow (z 2.3
 * .. 2.5) so its slack stops above the door's reach. A steep look down at the centre then passes the peephole's depth
 * below its slack and takes the low door. The door takes the low leaf, the chain the track (reached just off-centre, where
 * the peephole column does not cover it). Priorities are set in index.ts: peephole > door > chain.
 */
export const WALL_STATIONS = {
  peephole: [PEEP.x - 0.14, 1.42, 2.3, PEEP.x + 0.14, 1.7, 2.5],
  door: [DOOR_X0, 0, 2.0, DOOR_X1, 0.8, 2.5],
  chain: [DOOR_X0 + 0.1, 1.3, 2.0, DOOR_X1 - 0.1, 1.55, 2.5],
  switch: [0.45, 0.95, 2.1, 0.95, 1.45, 2.5],
} as const;

/** The interaction priorities of the door-side stations (higher wins an overlap, index.ts). */
export const STATION_PRIORITY = { peephole: 5, door: 4, chain: 3, switch: 3 } as const;

/** The south wall's solid pieces (plan boxes): both sides of the 1 m opening and the lintel above it. */
export const SOUTH_WALL_SOLIDS = [
  [-3.3, 0, 2.5, DOOR_X0, CEIL, 2.8],
  [DOOR_X1, 0, 2.5, 3.3, CEIL, 2.8],
  [DOOR_X0, DOOR_H, 2.5, DOOR_X1, CEIL, 2.8],
] as const;

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
  candle: { color: 0xffa24a, intensity: 0.4, range: 2.4 },
} as const;

/** The seated spouse's chair (the mannequin sits here, facing the door) and the empty chair opposite it. */
export const SPOUSE_SEAT = { x: 1.6, z: -0.75 } as const;
export const EMPTY_SEAT = { x: 1.6, z: 1.25 } as const;
/**
 * How the seated spouse sits on that chair. The `Sitting_Idle_Loop` clip puts the pelvis 0.18 x height behind the actor root (kit/mannequin
 * `SEATED_HIP`), so the root goes `fwd` in front of the chair centre or the hips sit in the backrest (it did, wave 80). `fwd` keeps her
 * dress 3 cm clear of the backrest and her hair in front of it; `y` and the seat height put the seat contact on the cushion, the soles 3 cm off the floor.
 */
export const SPOUSE_SIT = { fwd: 0.23, y: -0.025, seat: 0.42 } as const;

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
  peephole: { p: [PEEP.x, PEEP.y, PEEP_EYE_Z], yaw: Math.PI },
  hall: { p: [-0.6, 0, 3.9], yaw: 0 },
  switch: { p: [0.7, 1.2, 2.2], yaw: 0 },
  phone: { p: [2.2, 1.3, -2.45], yaw: 0 },
  table: { p: [1.6, TABLE.top, 0.3], yaw: 0 },
  spouse: { p: [SPOUSE_SEAT.x, 0, SPOUSE_SEAT.z], yaw: 0 },
  window: { p: [-0.6, 1.5, -2.2], yaw: 0 },
} as const;

/**
 * The fridge (south-east corner, against the east wall; its door faces west into the room) and the desk with the old CRT PC (north
 * wall, east of the window). Plan boxes [x0, y0, z0, x1, y1, z1]. The stations (`fridge`, `computer`) are in index.ts.
 */
export const FRIDGE = { box: [2.35, 0, 1.6, 3.0, 1.75, 2.3], station: [2.3, 0, 1.55, 3.0, 1.95, 2.35] } as const;
export const DESK = { x0: 0.75, x1: 1.9, z0: -2.45, z1: -1.85, top: 0.74, station: [0.7, 0, -2.5, 1.9, 1.45, -1.75] } as const;
/** The desk chair (turned to face the desk, north). */
export const DESK_CHAIR = { x: 1.3, z: -1.45 } as const;
