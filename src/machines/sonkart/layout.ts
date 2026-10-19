/**
 * SON KART table layout (owner: sonkart). Pure numbers, no three.js, so the tests can check them. Table frame: metres,
 * origin = table centre, y up, seat 0 on +Z (the front), seats go 0 = +Z, 1 = -X, 2 = -Z, 3 = +X.
 *
 *  - round card table, felt radius 0.46 m + a padded rail, four chairs on a 0.67 m circle: the chair backs end at 0.9 m, inside
 *    the L footprint (2.6 x 1.8 m), and the seat 0 chair stays out of the stand strip in front of the machine
 *  - the top card lies in the exact centre inside a colour ring; the draw pile is beside it on the far-left diagonal
 *  - every opponent holds a fan of card backs on the felt in front of them (pivot behind the rail, cards point at the centre)
 *  - the seat camera sits 1.2 m behind the table centre and 1.65 m up (37 degrees above the felt at the centre), looking down at about 41 degrees
 */
export const SEAT_DIR: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]];
export const FELT_Y = 0.76;
export const FELT_R = 0.46;
export const CHAIR_R = 0.67;
export const CHAIR_H = 0.48;
/** Mannequin root sits this far in front of the chair centre (the sitting clips put the pelvis behind the root). */
export const SIT_FWD = 0.285;
/** Card size of the kit card pools at scale 1 (kit/pools.ts), metres. */
export const CARD_W = 0.088;
export const CARD_H = 0.123;
/** Pool scales: cards on the felt, the face-up top card, the first-person hand. */
export const FELT_SCALE = 0.9;
export const TOP_SCALE = 1.9;
export const HAND_SCALE = 0.85;
/** Card height above the felt, m. */
export const CARD_Y = FELT_Y + 0.006;
/** Colour ring around the top card (inner / outer radius). */
export const RING_IN = 0.155;
export const RING_OUT = 0.215;
/** Draw pile, beside the top card on the far-left diagonal (clear of every opponent fan). */
export const DECK = { x: -0.225, z: -0.215 } as const;

/** Yaw (about +Y) that makes a card lying on the felt read upright for the player sitting at `seat` (its top points at the centre). */
export const seatYaw = (seat: number): number => Math.atan2(SEAT_DIR[seat][0], SEAT_DIR[seat][1]);

export interface Spot { x: number; z: number; yaw: number }

/** Fan pivot (behind the rail) and card distance from it. */
const FAN_PIVOT = 0.58;
const FAN_LEN = 0.22;
const FAN_STEP = 0.1;
const FAN_SPREAD = 0.56;

/** Where the opponent at `seat` holds their `n` face-down cards: a fan on the felt, centre first card to last. */
export function fanSpots(seat: number, n: number): Spot[] {
  const [dx, dz] = SEAT_DIR[seat];
  const step = n < 2 ? 0 : Math.min(FAN_STEP, FAN_SPREAD / (n - 1));
  const out: Spot[] = [];
  for (let k = 0; k < n; k++) {
    const yaw = seatYaw(seat) + (k - (n - 1) / 2) * step;
    out.push({ x: dx * FAN_PIVOT - Math.sin(yaw) * FAN_LEN, z: dz * FAN_PIVOT - Math.cos(yaw) * FAN_LEN, yaw });
  }
  return out;
}

/** The middle of the opponent's fan: where their cards leave from and arrive at. */
export const handSpot = (seat: number): Spot => ({ x: SEAT_DIR[seat][0] * (FAN_PIVOT - FAN_LEN), z: SEAT_DIR[seat][1] * (FAN_PIVOT - FAN_LEN), yaw: seatYaw(seat) });

/** Chair centre of `seat`. */
export const chairAt = (seat: number): { x: number; z: number } => ({ x: SEAT_DIR[seat][0] * CHAIR_R, z: SEAT_DIR[seat][1] * CHAIR_R });

/** Seat camera: behind the seat, high, looking at a point a little in front of the centre (that puts the table in the free band between the HUD's top and bottom stacks, with the side opponents' heads in frame). */
export function seatCamera(seat: number): { pos: [number, number, number]; look: [number, number, number]; fov: number } {
  const [dx, dz] = SEAT_DIR[seat];
  return { pos: [dx * 1.2, 1.65, dz * 1.2], look: [dx * 0.16, FELT_Y, dz * 0.16], fov: 55 };
}

/** Where the name chip of an opponent hangs (its bottom centre): just outside the rail in front of them, clear of their fan (table frame). */
export const chipAnchor = (seat: number): [number, number, number] => [SEAT_DIR[seat][0] * 0.58, FELT_Y + 0.05, SEAT_DIR[seat][1] * 0.58];

/** Corners of a card lying at `s` (card size `w` x `h`), table frame: for overlap checks. */
export function cardCorners(s: Spot, w: number, h: number): Array<[number, number]> {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const).map(([x, z]) => [s.x + x * c + z * n, s.z - x * n + z * c] as [number, number]);
}
