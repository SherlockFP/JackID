/**
 * The floor plan and the directions, both read from the layout data (no hand-drawn map). Pure: no THREE, no DOM.
 *
 *   floorPlan(...)     the zones, the open machines, the four landmarks and a "you are here" dot, scaled into a box (the Journal's MAP page)
 *   bearing(...)       where a spot lies from where you stand and face: ahead / right / left / behind
 *   barDirections(...) the Bar's call-out: which way the machines and the bank lie from the Bar's customer side
 */
import type { InstanceId, MachineId, ZoneId } from '@/core/types';
import { BAR_POS, BELL_POS, DEFAULT_ASSIGN, LIFT_DOOR, SLOTS, ZONES } from './layout';

/** Zones that are not part of the pit floor (a car niche, the Underneath, the apartment). */
const OFF_PLAN: readonly string[] = ['lift', 'hollow', 'home', 'street'];
const FLOOR_ZONES = ZONES.filter((z) => !OFF_PLAN.includes(z.id));

/** Slot position [x, z] of the first slot the default floor gives to `machineId`, or null. */
export function slotOf(machineId: MachineId): { x: number; z: number; rotY: number } | null {
  const id = (Object.keys(DEFAULT_ASSIGN) as InstanceId[]).find((k) => DEFAULT_ASSIGN[k] === machineId);
  const s = id === undefined ? undefined : SLOTS.find((x) => x.id === id);
  return s ? { x: s.pos[0], z: s.pos[2], rotY: s.rotY } : null;
}

/** The spot a player stands to use a machine: `reach` metres out from its face (rotY 0 faces +z). */
export function standSpot(machineId: MachineId, reach = 2.6): { x: number; z: number } | null {
  const s = slotOf(machineId);
  if (!s) return null;
  const r = (s.rotY * Math.PI) / 180;
  return { x: s.x + Math.sin(r) * reach, z: s.z + Math.cos(r) * reach };
}

export type Dir = 'ahead' | 'right' | 'left' | 'behind';

/** Where (tx, tz) lies from a player at (x, z) facing `yaw` (forward is (-sin yaw, -cos yaw)). */
export function bearing(x: number, z: number, yaw: number, tx: number, tz: number): Dir {
  const dx = tx - x, dz = tz - z;
  const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const a = Math.atan2(right, fwd);   // 0 = straight ahead, positive = to the right
  const m = Math.abs(a);
  return m <= Math.PI / 4 ? 'ahead' : m >= (3 * Math.PI) / 4 ? 'behind' : a > 0 ? 'right' : 'left';
}

/** The Bar's call-out: the machines (the Big One's corner) and the bank (the terminal) as seen from a player at (x, z) facing `yaw`. */
export function barDirections(x: number, z: number, yaw: number): { machines: Dir; bank: Dir } | null {
  const m = slotOf('bigone'), b = slotOf('debt_terminal');
  if (!m || !b) return null;
  return { machines: bearing(x, z, yaw, m.x, m.z), bank: bearing(x, z, yaw, b.x, b.z) };
}

export type PlanPin = 'bank' | 'bell' | 'lift' | 'bar';
export interface PlanIn {
  /** True when the zone's wing is open. */
  zoneOpen(zone: ZoneId): boolean;
  /** [x, z] of every machine the player can use now. */
  machines: ReadonlyArray<readonly [number, number]>;
  /** The player, or null. */
  you: { x: number; z: number; yaw: number } | null;
}
export interface Plan {
  zones: Array<{ id: ZoneId; x: number; y: number; w: number; h: number; open: boolean }>;
  pins: Array<{ kind: PlanPin; x: number; y: number }>;
  dots: Array<[number, number]>;
  you: { x: number; y: number; yaw: number } | null;
  w: number;
  h: number;
}

/** The landmarks, from the layout: the terminal slot, the Bell, the lift door and the Bar. */
function landmarks(): Array<{ kind: PlanPin; x: number; z: number }> {
  const bank = slotOf('debt_terminal');
  return [
    ...(bank ? [{ kind: 'bank' as const, x: bank.x, z: bank.z }] : []),
    { kind: 'bell', x: BELL_POS.x, z: BELL_POS.z },
    { kind: 'lift', x: LIFT_DOOR.x, z: LIFT_DOOR.z },
    { kind: 'bar', x: BAR_POS.x, z: BAR_POS.z },
  ];
}

/** Pin box size in px (a digit is 5 x 7): pins that would overlap are pushed apart sideways so every number reads. */
export const PIN_W = 8, PIN_H = 5;
export function spreadPins<T extends { x: number; y: number }>(pins: T[]): T[] {
  const out = [...pins].sort((a, b) => a.x - b.x);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    if (Math.abs(out[i].y - prev.y) < 2 * PIN_H && out[i].x - prev.x < PIN_W) out[i] = { ...out[i], x: prev.x + PIN_W };
  }
  return out;
}

/** The plan scaled to fit `maxW` x `maxH` pixels (whole-pixel scale steps are not needed: the page draws rects). */
export function floorPlan(inp: PlanIn, maxW: number, maxH: number): Plan {
  const x0 = Math.min(...FLOOR_ZONES.map((z) => z.rect[0])), z0 = Math.min(...FLOOR_ZONES.map((z) => z.rect[1]));
  const x1 = Math.max(...FLOOR_ZONES.map((z) => z.rect[2])), z1 = Math.max(...FLOOR_ZONES.map((z) => z.rect[3]));
  const s = Math.min(maxW / (x1 - x0), maxH / (z1 - z0));
  const px = (x: number): number => Math.round((x - x0) * s);
  const pz = (z: number): number => Math.round((z - z0) * s);
  return {
    zones: FLOOR_ZONES.map((z) => ({ id: z.id, x: px(z.rect[0]), y: pz(z.rect[1]), w: px(z.rect[2]) - px(z.rect[0]), h: pz(z.rect[3]) - pz(z.rect[1]), open: !z.gated || inp.zoneOpen(z.id) })),
    pins: spreadPins(landmarks().map((p) => ({ kind: p.kind, x: px(p.x), y: Math.max(PIN_H, Math.min(pz(z1) - PIN_H, pz(p.z))) }))),
    dots: inp.machines.map(([x, z]) => [px(x), pz(z)] as [number, number]),
    // off the pit floor (the apartment, the Underneath, the lift car): no dot
    you: inp.you && inp.you.x >= x0 && inp.you.x <= x1 && inp.you.z >= z0 && inp.you.z <= z1 ? { x: px(inp.you.x), y: pz(inp.you.z), yaw: inp.you.yaw } : null,
    w: px(x1), h: pz(z1),
  };
}
