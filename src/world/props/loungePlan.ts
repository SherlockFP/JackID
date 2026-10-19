/**
 * The lived-in casino (wave 81, interior pass): WHERE the furniture goes. Pure data: no THREE, no DOM, so a test can run it.
 *
 * `planLounge` returns the list of rugs, planters, chairs, tables, benches, carts, lamps, frames and sconces for the three nave
 * rooms (Mouth, Well, Lobby: the first five minutes of a run) and a few props for every wing. Furniture that blocks walking
 * (`solid`) is dropped when it would overlap a machine, its standing zone, a column, a doorway lane, the central aisle or an
 * earlier piece, so the plan can be tuned by eye without ever walling off a seat or a door. The builder (`lounge.ts`) draws it.
 *
 * Conventions: yaw is degrees about Y with the piece's front on local +z (yaw 0 faces south, 90 east, 180 north, 270 west);
 * wall pieces take the yaw of the direction they FACE (a west-wall frame faces east: yaw 90).
 */
import { SLOT_DIMS, type SlotSize } from '@/core/types';

/** [x0, z0, x1, z1] in metres. */
export type Rect = readonly [number, number, number, number];
export type RugTone = 'red' | 'green' | 'navy';

export type LoungeItem =
  | { k: 'rug'; rect: Rect; tone: RugTone }
  | { k: 'plant'; x: number; z: number; h: number }
  | { k: 'chair'; x: number; z: number; yaw: number }
  | { k: 'table'; x: number; z: number; r: number; lamp: boolean }
  | { k: 'bench'; x: number; z: number; yaw: number; len: number }
  | { k: 'cart'; x: number; z: number; yaw: number }
  | { k: 'torch'; x: number; z: number }
  | { k: 'frame'; x: number; y: number; z: number; yaw: number; w: number; art: number }
  | { k: 'sconce'; x: number; y: number; z: number; yaw: number }
  | { k: 'pendant'; x: number; z: number; y: number; ceil: number }
  | { k: 'ropes'; pts: ReadonlyArray<readonly [number, number]> };

export interface LoungeLight { id: string; pos: [number, number, number]; color: number; intensity: number; range: number; flicker: 'STEADY' | 'CANDLE'; zone: string }
export interface LoungePlan { items: LoungeItem[]; lights: LoungeLight[]; skipped: string[] }

export const WALL = 10.85;
/** Doorways in the two nave side walls (z ranges), the same on both sides: Midway/Boiler, Cards/Gallery, Laundry/Wheels, Counting/Parlour. */
export const DOORS: ReadonlyArray<readonly [number, number]> = [[-25, -21], [-11, -7], [3, 7], [15, 17]];
/** The column rows (x = +-7). */
export const COLUMN_Z: readonly number[] = [-27, -21, -15, -9, -3, 3, 9, 15];

const rot = (r: Rect, yaw: number): Rect => {
  const q = ((Math.round(yaw / 90) % 4) + 4) % 4;
  return q % 2 === 0 ? r : [r[1], r[0], r[3], r[2]];
};

/** The floor a slot's machine and its standing zone take (the zone runs `stand` m out of the front, as wide as the machine). */
export function slotRect(s: { size: SlotSize; pos: readonly number[]; rotY: number }): Rect {
  const d = SLOT_DIMS[s.size];
  const sideways = s.rotY === 90 || s.rotY === 270;
  const hw = (sideways ? d.d : d.w) / 2, hd = (sideways ? d.w : d.d) / 2;
  const [x, , z] = s.pos as [number, number, number];
  const fx = s.rotY === 90 ? 1 : s.rotY === 270 ? -1 : 0, fz = s.rotY === 0 ? 1 : s.rotY === 180 ? -1 : 0;
  const reach = d.stand + 0.3;
  return [Math.min(x - hw, x - hw + fx * reach), Math.min(z - hd, z - hd + fz * reach), Math.max(x + hw, x + hw + fx * reach), Math.max(z + hd, z + hd + fz * reach)];
}
/** Just the machine body of a slot (wall pieces keep clear of it). */
export function slotBody(s: { size: SlotSize; pos: readonly number[]; rotY: number }): Rect {
  const d = SLOT_DIMS[s.size];
  const sideways = s.rotY === 90 || s.rotY === 270;
  const hw = (sideways ? d.d : d.w) / 2, hd = (sideways ? d.w : d.d) / 2;
  const [x, , z] = s.pos as [number, number, number];
  return [x - hw, z - hd, x + hw, z + hd];
}

const hit = (a: Rect, b: Rect, pad = 0): boolean => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad;

/** Fixed no-build zones: the central aisle, the lift lane, the doorway lanes, the stage, the bar, the trapdoor, the dais. */
const LANES: Rect[] = [
  [-1.7, -30, 1.7, 20],
  [-5.4, -30, -2.6, -25],
  ...DOORS.flatMap(([z0, z1]): Rect[] => [[WALL - 3.2, z0 - 0.4, 12, z1 + 0.4], [-12, z0 - 0.4, -(WALL - 3.2), z1 + 0.4]]),
  [-6.4, 7.0, -0.9, 10.9],      // the stage and its apron
  [-8.8, 12.4, -3.2, 16.4],     // the bar, its stools and shelves
  [-1.4, 10.6, 1.4, 13.4],      // the trapdoor plate
  [-3.0, -6.4, 3.0, -1.6],      // the Big One dais
];

export function planLounge(blockers: readonly Rect[]): LoungePlan {
  const items: LoungeItem[] = [];
  const lights: LoungeLight[] = [];
  const skipped: string[] = [];
  const placed: Rect[] = [];
  const bodies: Rect[] = [];
  const free = (fp: Rect, why: string, pad = 0.12): boolean => {
    for (const b of [...blockers, ...LANES, ...placed]) {
      if (hit(fp, b, pad)) { skipped.push(`${why} blocked at ${fp.map((n) => n.toFixed(1)).join(',')}`); return false; }
    }
    return true;
  };
  /** Pieces that block walking: kept only where they fit. */
  const solid = (it: LoungeItem, fp: Rect): void => { if (free(fp, it.k)) { items.push(it); placed.push(fp); } };
  const rect = (x: number, z: number, hw: number, hd: number): Rect => [x - hw, z - hd, x + hw, z + hd];
  const add = (it: LoungeItem): void => { items.push(it); };
  /** A wall piece at height `y` (sconce, frame): dropped if a machine body could stand behind it below 3.4 m. */
  const wall = (it: LoungeItem & { y: number; x: number; z: number }, half: number): void => {
    if (it.y < 3.4 && bodies.some((b) => hit(rect(it.x, it.z, half, half), b, 0.25))) { skipped.push(`${it.k} behind a machine at ${it.x},${it.z}`); return; }
    items.push(it);
  };

  // slot bodies for the wall-piece test come from the blockers' machine parts: the caller passes both (see slotBody); a body is
  // recognised as a blocker hugging a side wall
  for (const b of blockers) if (Math.abs(b[0] + WALL) < 0.01 || Math.abs(b[2] - WALL) < 0.01 || Math.abs(b[1] + 29.85) < 0.01 || Math.abs(b[3] - 19.85) < 0.01) bodies.push(b);

  // ── rugs: the green runner from the lift to the Big One, the arrival rug, rugs under the table groups ────────────────────
  add({ k: 'rug', rect: [-6.6, -29.6, -1.4, -25.6], tone: 'red' });
  add({ k: 'rug', rect: [-1.5, -25.6, 1.5, -9.2], tone: 'green' });
  add({ k: 'rug', rect: [-3.9, -9.2, 3.9, -6.05], tone: 'navy' });          // the approach to the Big One
  add({ k: 'rug', rect: [-8.0, -15.0, -2.0, -10.2], tone: 'navy' });        // roulette
  add({ k: 'rug', rect: [2.6, -14.6, 7.4, -10.4], tone: 'navy' });          // blackjack
  add({ k: 'rug', rect: [-6.5, -7.1, -4.1, -2.4], tone: 'red' });           // the starter bank, west
  add({ k: 'rug', rect: [4.1, -7.1, 6.5, -2.4], tone: 'red' });             // the starter bank, east
  add({ k: 'rug', rect: [-1.5, 1.6, 1.5, 10.6], tone: 'green' });           // Well door to the stage
  add({ k: 'rug', rect: [-1.5, 13.4, 1.5, 17.4], tone: 'green' });          // trapdoor to the desk
  add({ k: 'rug', rect: [-6.6, 4.0, -1.55, 7.0], tone: 'red' });             // stage-front tables
  add({ k: 'rug', rect: [-8.7, 12.0, -3.3, 13.3], tone: 'navy' });          // the bar
  add({ k: 'rug', rect: [4.9, 3.9, 7.6, 7.4], tone: 'navy' });              // the east lounge

  // ── the Mouth: arrival ─────────────────────────────────────────────────────────────────────────────────────────────
  solid({ k: 'plant', x: -10.2, z: -29.2, h: 1.6 }, rect(-10.2, -29.2, 0.45, 0.45));
  solid({ k: 'plant', x: 9.4, z: -29.3, h: 1.6 }, rect(9.4, -29.3, 0.45, 0.45));
  solid({ k: 'torch', x: 2.85, z: -29.5 }, rect(2.85, -29.5, 0.3, 0.3));
  solid({ k: 'torch', x: 6.0, z: -29.4 }, rect(6.0, -29.4, 0.3, 0.3));
  solid({ k: 'bench', x: -10.55, z: -26.6, yaw: 90, len: 2.0 }, rect(-10.55, -26.6, 0.3, 1.0));
  solid({ k: 'table', x: -9.55, z: -26.6, r: 0.38, lamp: true }, rect(-9.55, -26.6, 0.4, 0.4));
  solid({ k: 'chair', x: -8.6, z: -26.6, yaw: 270 }, rect(-8.6, -26.6, 0.35, 0.35));
  solid({ k: 'cart', x: 9.9, z: -26.4, yaw: 270 }, rect(9.9, -26.4, 0.3, 0.55));
  for (const sx of [-1, 1]) {
    wall({ k: 'sconce', x: sx * 10.85, y: 2.7, z: -26.3, yaw: sx < 0 ? 90 : 270 }, 0.3);
    add({ k: 'frame', x: sx * 10.85, y: 4.5, z: -27.4, yaw: sx < 0 ? 90 : 270, w: 1.5, art: sx < 0 ? 0 : 3 });
    add({ k: 'frame', x: sx * 10.85, y: 4.5, z: -19.6, yaw: sx < 0 ? 90 : 270, w: 1.5, art: sx < 0 ? 4 : 1 });
  }
  // velvet ropes line the runner from the arrival rug to the Well, and two planters flank the way into the Well
  add({ k: 'ropes', pts: [[-1.95, -24.6], [-1.95, -22.2], [-1.95, -19.8]] });
  add({ k: 'ropes', pts: [[1.95, -24.6], [1.95, -22.2], [1.95, -19.8]] });
  solid({ k: 'plant', x: -3.5, z: -17.4, h: 1.9 }, rect(-3.5, -17.4, 0.45, 0.45));
  solid({ k: 'plant', x: 3.5, z: -17.4, h: 1.9 }, rect(3.5, -17.4, 0.45, 0.45));
  lights.push({ id: 'lounge:mouthW', pos: [-9.5, 2.0, -26.6], color: 0xffb060, intensity: 0.55, range: 5, flicker: 'CANDLE', zone: 'mouth' });
  lights.push({ id: 'lounge:mouthE', pos: [9.0, 1.9, -26.4], color: 0xffa860, intensity: 0.45, range: 4, flicker: 'CANDLE', zone: 'mouth' });

  // ── the Well: the Big One, the tables, the lounges under the balcony ────────────────────────────────────────────────────
  solid({ k: 'torch', x: -2.7, z: -1.0 }, rect(-2.7, -1.0, 0.3, 0.3));
  solid({ k: 'torch', x: 2.7, z: -1.0 }, rect(2.7, -1.0, 0.3, 0.3));
  solid({ k: 'plant', x: -4.5, z: -0.8, h: 1.9 }, rect(-4.5, -0.8, 0.45, 0.45));
  solid({ k: 'plant', x: 4.5, z: -0.8, h: 1.9 }, rect(4.5, -0.8, 0.45, 0.45));
  for (const sx of [-1, 1]) {
    const yaw = sx < 0 ? 90 : 270;
    solid({ k: 'bench', x: sx * 10.5, z: -13.7, yaw, len: 3.0 }, rect(sx * 10.5, -13.7, 0.35, 1.5));
    solid({ k: 'table', x: sx * 9.3, z: -14.7, r: 0.4, lamp: true }, rect(sx * 9.3, -14.7, 0.42, 0.42));
    solid({ k: 'table', x: sx * 9.3, z: -12.7, r: 0.4, lamp: false }, rect(sx * 9.3, -12.7, 0.42, 0.42));
    solid({ k: 'chair', x: sx * 8.3, z: -13.7, yaw: sx < 0 ? 90 : 270 }, rect(sx * 8.3, -13.7, 0.36, 0.36));
    add({ k: 'frame', x: sx * 10.85, y: 3.7, z: -13.7, yaw, w: 2.3, art: sx < 0 ? 2 : 5 });
    wall({ k: 'sconce', x: sx * 10.85, y: 3.0, z: -15.5, yaw }, 0.3);
    wall({ k: 'sconce', x: sx * 10.85, y: 3.0, z: -11.5, yaw }, 0.3);
    lights.push({ id: `lounge:well${sx < 0 ? 'W' : 'E'}`, pos: [sx * 9.3, 2.1, -13.7], color: 0xffa860, intensity: 0.65, range: 5.5, flicker: 'CANDLE', zone: 'well' });
  }
  lights.push({ id: 'lounge:dais', pos: [0, 2.6, -0.4], color: 0xffd290, intensity: 0.8, range: 6, flicker: 'STEADY', zone: 'well' });
  lights.push({ id: 'lounge:tablesW', pos: [-5, 3.4, -12.4], color: 0x8fd8e0, intensity: 0.5, range: 6, flicker: 'STEADY', zone: 'well' });
  lights.push({ id: 'lounge:tablesE', pos: [5, 3.4, -12.4], color: 0x8fd8e0, intensity: 0.5, range: 6, flicker: 'STEADY', zone: 'well' });

  // ── the Lobby: supper tables at the stage, the bar, the east lounge ─────────────────────────────────────────────────────
  add({ k: 'ropes', pts: [[-6.0, 6.9], [-4.6, 6.9], [-3.2, 6.9], [-1.8, 6.9]] });
  for (const tx of [-5.0, -2.9]) {
    solid({ k: 'table', x: tx, z: 5.4, r: 0.42, lamp: true }, rect(tx, 5.4, 0.45, 0.45));
    solid({ k: 'chair', x: tx, z: 4.4, yaw: 0 }, rect(tx, 4.4, 0.36, 0.36));       // faces south, to the table
    solid({ k: 'chair', x: tx, z: 6.4, yaw: 180 }, rect(tx, 6.4, 0.36, 0.36));     // faces north
  }
  solid({ k: 'table', x: 6.4, z: 5.6, r: 0.45, lamp: true }, rect(6.4, 5.6, 0.48, 0.48));
  solid({ k: 'chair', x: 5.4, z: 5.6, yaw: 90 }, rect(5.4, 5.6, 0.36, 0.36));
  solid({ k: 'chair', x: 6.4, z: 4.6, yaw: 0 }, rect(6.4, 4.6, 0.36, 0.36));
  solid({ k: 'plant', x: -9.6, z: 2.0, h: 1.7 }, rect(-9.6, 2.0, 0.45, 0.45));
  solid({ k: 'plant', x: 9.6, z: 2.0, h: 1.7 }, rect(9.6, 2.0, 0.45, 0.45));
  solid({ k: 'plant', x: -9.9, z: 19.1, h: 1.7 }, rect(-9.9, 19.1, 0.45, 0.45));
  solid({ k: 'plant', x: 10.2, z: 18.1, h: 1.7 }, rect(10.2, 18.1, 0.45, 0.45));
  solid({ k: 'torch', x: 2.3, z: 19.4 }, rect(2.3, 19.4, 0.3, 0.3));
  for (const bx of [-7.2, -6.0, -4.8]) add({ k: 'pendant', x: bx, z: 14.2, y: 2.55, ceil: 4.5 });
  for (const sx of [-1, 1]) wall({ k: 'sconce', x: sx * 10.85, y: 3.0, z: 17.6, yaw: sx < 0 ? 90 : 270 }, 0.3);
  add({ k: 'frame', x: -10.85, y: 3.95, z: 5.0, yaw: 90, w: 1.7, art: 1 });
  add({ k: 'frame', x: 10.85, y: 3.95, z: 5.0, yaw: 270, w: 1.7, art: 4 });
  lights.push({ id: 'lounge:supper', pos: [-4.0, 2.0, 5.4], color: 0xffa860, intensity: 0.7, range: 5.5, flicker: 'CANDLE', zone: 'lobby' });
  lights.push({ id: 'lounge:lobbyE', pos: [6.4, 2.1, 5.6], color: 0xffb870, intensity: 0.55, range: 5, flicker: 'CANDLE', zone: 'lobby' });
  lights.push({ id: 'lounge:barPendants', pos: [-6.0, 2.4, 14.2], color: 0xffc070, intensity: 0.7, range: 4.5, flicker: 'STEADY', zone: 'lobby' });

  // ── the wings: an entry rug, two planters and two lamps just inside each doorway (dim, simple, not empty) ─────────────────
  const wings: Array<{ side: -1 | 1; door: readonly [number, number] }> = [];
  for (const side of [-1, 1] as const) for (const door of DOORS) wings.push({ side, door });
  for (const { side, door } of wings) {
    const [z0, z1] = door;
    const x0 = side * (WALL + 0.45), x1 = side * (WALL + 4.6);
    add({ k: 'rug', rect: [Math.min(x0, x1), z0 - 0.2, Math.max(x0, x1), z1 + 0.2], tone: 'red' });
    for (const [dz, k] of [[z0 - 1.1, 'plant'], [z1 + 1.1, 'plant']] as const) {
      const x = side * (WALL + 1.0);
      if (k === 'plant') solid({ k: 'plant', x, z: dz, h: 1.5 }, rect(x, dz, 0.45, 0.45));
    }
    solid({ k: 'torch', x: side * (WALL + 1.0), z: z0 - 2.1 }, rect(side * (WALL + 1.0), z0 - 2.1, 0.3, 0.3));
  }
  return { items, lights, skipped };
}
