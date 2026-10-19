/**
 * THE WALK HOME (world/street): the plan and the walk's cues. Pure data, no THREE, no DOM.
 *
 * The block's corridor, the night street and the casino's street door, planned in the flat's local metres (world/home/config `at`):
 * +X east, +Z south. The flat's hall runs east as the ground corridor to the building door in the façade (x 8.3); the street runs
 * north-south in front of it, and the casino door is an alcove in the same façade line 32 m north. The lift up from the casino
 * lands the player at that door; in the morning the same door takes them down.
 */
import { HOME_ORIGIN } from '@/game/home/contract';

/** Zone id of the corridor and the street (layout.ts ZONES): its own look, culled as one group. */
export const STREET_ZONE = 'street';

/** The corridor: the flat's hall (x -1.6 .. 0.4, z 2.8 .. 5.2) runs on east to the façade wall (inner face x 8.0). */
export const CORRIDOR_X1 = 8.0;
/** The block's street face (the façade wall is x 8.0 .. 8.3). */
export const FACADE_X = 8.3;
/** The building door: an opening in the façade wall, z0 .. z1, `h` high. */
export const ENTRY = { z0: 3.4, z1: 4.6, h: 2.3 } as const;
/** The apartment block's façade span (z) and height. */
export const BLOCK = { z0: -6.5, z1: 7.5, h: 15 } as const;
/** The street: near pavement x 8.3 .. 10.8, the road to 17.5, the far pavement to the shopfronts at x 20. */
export const STREET = { x0: FACADE_X, x1: 20, z0: -34, z1: 10, curbNear: 10.8, curbFar: 17.5 } as const;
/** The casino's street door: an alcove in the façade line, its lift doors at the back (x0). */
export const CASINO_DOOR = { x0: 6.6, z0: -29.2, z1: -26.8, h: 2.6 } as const;

/** The zone rectangle in world space [x0, z0, x1, z1]: the corridor, the street and the casino alcove. */
export const STREET_ZONE_RECT: readonly [number, number, number, number] = [
  HOME_ORIGIN[0] - 1.9, HOME_ORIGIN[2] + STREET.z0 - 0.3, HOME_ORIGIN[0] + STREET.x1 + 0.3, HOME_ORIGIN[2] + STREET.z1 + 0.3,
];
/** Night and rain: a cold blue-grey fog, an ambient low but readable (the street lamps carry the warmth). */
export const STREET_LOOK = { fog: { color: 0x0e1018, near: 6, far: 34 }, ambient: 0x2c3040 } as const;

/** Named anchors (world.anchor): the lift's arrival, the two doors the wayfinder points at, and the camera spots. */
export const STREET_ANCHORS = {
  arrive: 'street.arrive',          // out of the casino door, facing down the street
  casino: 'street.casinoDoor',      // in the alcove, at the lift doors (the morning's goal)
  building: 'street.buildingDoor',  // the block's door, from the pavement (the walk home's goal)
  flatDoor: 'street.flatDoor',      // in the hall at your door, facing it
  adaDoor: 'street.adaDoor',        // in the corridor, looking down the hall at both doors
  mid: 'street.mid',                // mid-street, looking at the block
} as const;

/** Plan points [x, y, z] and facings (yaw 0 faces north, π south, π/2 west, -π/2 east). */
export const ANCHOR_PLAN: Record<keyof typeof STREET_ANCHORS, { p: [number, number, number]; yaw: number }> = {
  arrive: { p: [9.4, 0, -28], yaw: Math.PI },
  casino: { p: [7.2, 0, -28], yaw: Math.PI / 2 },
  building: { p: [10.2, 0, 4], yaw: Math.PI / 2 },
  flatDoor: { p: [-0.6, 0, 4.2], yaw: 0 },
  adaDoor: { p: [2.6, 0, 4.0], yaw: Math.PI / 2 },
  mid: { p: [15.5, 0, -6], yaw: Math.PI * 0.6 },
};

/** The taxi rank: one cab at the casino door (home), one at the block (to the casino). From Night 3 on. */
export const TAXI = { casino: { x: 11.7, z: -17 }, home: { x: 11.7, z: 8 } } as const;
export const TAXI_NIGHT = 3;

/** The street lamps (near pavement edge), every 10 m or so. */
export const LAMPS_Z: readonly number[] = [-24, -13, -2, 8];

// ── the walk's cues ─────────────────────────────────────────────────────────────────────────────────
/** Which way the player walks: home from the casino door, or out from the flat to it. */
export type WalkLeg = 'home' | 'out';
/**
 * What the walk does at a plan point:
 *  - home leg: 'door' in the hall at your door (or just inside it): the key turns and the door opens; 'in' well inside the room,
 *    clear of the leaf's swing: the door shuts behind.
 *  - out leg: 'hall' in the hall or the corridor: the door shuts behind; 'lift' in the casino alcove: the lift down.
 */
export type WalkCue = 'door' | 'in' | 'hall' | 'lift' | null;

/** The leaf sweeps to z 1.72; past this line the player is clear of it. */
const CLEAR_Z = 1.3;

export function walkCue(leg: WalkLeg, x: number, z: number): WalkCue {
  const inRoom = x > -3 && x < 3 && z > -2.5 && z < 2.5;
  if (leg === 'home') {
    if (inRoom) return z < CLEAR_Z ? 'in' : 'door';
    return x > -1.6 && x < 0.4 && z >= 2.5 && z < 4.4 ? 'door' : null;
  }
  if (x > CASINO_DOOR.x0 && x < FACADE_X + 0.4 && z > CASINO_DOOR.z0 && z < CASINO_DOOR.z1) return 'lift';
  return x > -1.6 && x < CORRIDOR_X1 && z > 3.0 && z < 5.2 ? 'hall' : null;
}

/**
 * Which door the waymark hangs on (a STREET_ANCHORS key) for a walk leg, from the player's WORLD x / z. The casino door is 30 m off
 * behind walls from the flat, so the mark leads door to door: your front door, the building door, then the street's far door.
 * The anchors sit where the player walks (the hall, the pavement, the alcove), never in a wall.
 */
export function walkWaypoint(leg: WalkLeg, wx: number, wz: number): keyof typeof STREET_ANCHORS {
  const x = wx - HOME_ORIGIN[0], z = wz - HOME_ORIGIN[2];
  if (x >= CORRIDOR_X1) return leg === 'out' ? 'casino' : 'building';
  return leg === 'out' && z >= 2.5 ? 'building' : 'flatDoor';
}
