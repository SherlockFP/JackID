/**
 * WAYFINDING (new players: "I don't know where things are"). Driven every frame by the objective line (`game/tutorial.ts`):
 *   - the waymark: a small gold diamond over the objective's world spot with its distance in metres. Off screen it sticks to the
 *     screen edge with an arrow toward the spot. Shown on Nights 1 and 2, and later only when the player has made no progress
 *     toward the spot for `STALL_S` seconds. The setting `waymark` (Advanced > Interface) turns it off.
 *   - the floor trail (Night 1): a dotted gold line from the lift to the Big One, then to the terminal; it fades after the first visit
 *     (remembered in the save, so a second run does not repeat it).
 *   - the Bar's call-out (Night 1, once): Selim says which way the machines and the bank lie, worked out from the layout.
 * The maths (`placeMark`, `createStall`, `waymarkWanted`) is pure and tested; the DOM and the world are thin.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import type { InstanceId } from '@/core/types';
import type { UIOverlayX } from '@/core/ui/ui';
import type { WorldHost } from '@/world/world';
import { BAR_POS, LIFT_DOOR } from '@/world/layout';
import { STREET_ANCHORS } from '@/world/street';
import { barDirections, standSpot } from '@/world/floorplan';
import { createTrail, trailPath } from '@/world/props/wayfinding';
import type { Vec2 } from '@/world/actors/nav';
import { objectiveShown, type ObjectiveTarget } from './disclose';

/** Seconds without progress toward the spot before a later Night shows the waymark. */
export const STALL_S = 20;
/** Metres of progress that count (a step back and forth does not reset the clock). */
export const STALL_STEP_M = 1;
/** Closer than this the diamond steps aside: you are there. */
export const ARRIVED_M = 3;
const TRAIL_DONE_M = 2.4;       // within this of a leg's end the leg counts as visited
const BAR_NEAR_M = 5;           // "passes the bar": within this of the customers' side

export interface Mark { x: number; y: number; on: boolean; /** radians, 0 = up, clockwise: the arrow's turn when off screen */ angle: number }

/**
 * Where the diamond goes. `c` is the spot in CAMERA space (x right, y up, the camera looks down -z); `p00` / `p11` are the
 * projection matrix's x and y scales. In front and inside the padded screen: at the spot. Otherwise clamped to the padded edge
 * along the line from the screen centre toward it (behind the camera the line uses the camera-space x and y, so it points the right way).
 */
export function placeMark(c: { x: number; y: number; z: number }, p00: number, p11: number, w: number, h: number, pad: { x: number; top: number; bottom: number }): Mark {
  const front = c.z < -1e-3;
  let sx = w / 2, sy = h / 2;
  if (front) {
    sx = (1 + (p00 * c.x) / -c.z) * (w / 2);
    sy = (1 - (p11 * c.y) / -c.z) * (h / 2);
    if (sx >= pad.x && sx <= w - pad.x && sy >= pad.top && sy <= h - pad.bottom) return { x: sx, y: sy, on: true, angle: 0 };
  }
  let dx = front ? sx - w / 2 : c.x, dy = front ? sy - h / 2 : -c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;   // dead behind: the bottom edge
  // the box is not centred (the top band is taller than the bottom row): clamp each half against its own pad
  const k = Math.min((w / 2 - pad.x) / Math.max(Math.abs(dx), 1e-6), (dy < 0 ? h / 2 - pad.top : h / 2 - pad.bottom) / Math.max(Math.abs(dy), 1e-6));
  return { x: w / 2 + dx * k, y: h / 2 + dy * k, on: false, angle: Math.atan2(dx, -dy) };
}

/**
 * The no-progress clock. `update(key, dist, dt)` returns true once `limitS` seconds passed without getting `stepM` closer to the
 * spot `key`; it stays true until the key changes. A new key restarts it.
 */
export function createStall(limitS = STALL_S, stepM = STALL_STEP_M): { update(key: string, dist: number, dt: number): boolean } {
  let cur = '', best = Infinity, idle = 0, on = false;
  return {
    update(key, dist, dt) {
      if (key !== cur) { cur = key; best = dist; idle = 0; on = false; return false; }
      if (dist < best - stepM) { best = dist; idle = 0; } else idle += dt;
      if (idle >= limitS) on = true;
      return on;
    },
  };
}

/** True when the diamond shows: the setting is on, and it is Night 1-2 or the player has stalled. */
export function waymarkWanted(night: number, enabled: boolean, stalled: boolean): boolean {
  return enabled && (objectiveShown(night) || stalled);
}

// ── the DOM diamond ────────────────────────────────────────────────────────────────────────────────
interface Diamond { show(m: Mark, metres: number): void; hide(): void; dispose(): void }

function createDiamond(parent: HTMLElement): Diamond {
  const el = document.createElement('div');
  el.className = 'px-wm';
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  const arrow = document.createElement('i');
  arrow.className = 'ar';
  const gem = document.createElement('b');
  gem.className = 'd';
  const num = document.createElement('span');
  num.className = 'm';
  el.append(arrow, gem, num);
  parent.appendChild(el);
  let shownM = -1;
  return {
    show(m, metres) {
      el.style.display = '';
      el.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px)`;
      el.classList.toggle('off', !m.on);
      if (!m.on) arrow.style.setProperty('--a', `${m.angle}rad`);
      const r = Math.round(metres);
      if (r !== shownM) { shownM = r; num.textContent = `${r} m`; }
    },
    hide() { el.style.display = 'none'; },
    dispose() { el.remove(); },
  };
}

// ── the wayfinder ──────────────────────────────────────────────────────────────────────────────────
export interface WayfinderHost { readonly world: WorldHost }
export interface Wayfinder {
  /** Every frame the objective is live. `target` is the objective's spot (null: none). */
  update(a: { target: ObjectiveTarget; night: number }): void;
  /** The objective is not live (home, the Underneath, the prologue): nothing shows. */
  hide(): void;
  dispose(): void;
}

/** Heights (m) above a spot's own position where the diamond hangs. */
const LIFT_Y = 0.5, BELL_Y = 1.6, MACHINE_Y = 2.4;
const FLAG = (k: string): string => `wf.${k}`;

const flagSet = (k: string): boolean => { try { return (app.save.data.stats[FLAG(k)] ?? 0) > 0; } catch { return false; } };
function setFlag(k: string): void {
  try { app.save.update((d) => { d.stats[FLAG(k)] = 1; }); } catch { /* storage refused: it stays in memory for the session */ }
}

export function createWayfinder(host: WayfinderHost): Wayfinder {
  const { world } = host;
  const overlay = (app.ui as UIOverlayX | undefined)?.hudLayer?.parentElement ?? document.body;
  const diamond = createDiamond(overlay);
  const trail = createTrail(world.root);
  const stall = createStall();
  const v = new THREE.Vector3();
  const done = new Set<number>([1, 2].filter((l) => flagSet(`trail.${l}`)));
  let shownLeg = 0;
  let selimSaid = flagSet('selim');
  let seen = app.time.sim;
  const found = new Map<string, InstanceId>();
  const legs = new Map<number, Vec2[]>();

  const machineId = (def: string): InstanceId | null => {
    const hit = found.get(def);
    if (hit !== undefined) return hit;
    const m = world.machines().find((x) => x.def.id === def);
    if (!m) return null;
    found.set(def, m.id);
    return m.id;
  };
  const slotPoint = (mid: InstanceId | null): THREE.Vector3 | null => {
    const s = mid === null ? undefined : world.slot(mid);
    if (!s) return null;
    return world.root.localToWorld(v.set(s.pos[0], s.pos[1] + MACHINE_Y, s.pos[2]));
  };
  /** The spot in the world, or null when it is not built yet. The Big One falls back to the nearest open machine. */
  const point = (target: Exclude<ObjectiveTarget, null>, from: THREE.Vector3): THREE.Vector3 | null => {
    if (target === 'buildingDoor' || target === 'casinoDoor') {   // the walk home and out (world/street)
      const a = world.anchor(target === 'buildingDoor' ? STREET_ANCHORS.building : STREET_ANCHORS.casino);
      if (!a) return null;
      a.getWorldPosition(v);
      v.y += BELL_Y;
      return v;
    }
    if (target === 'lift' || target === 'bell') {
      const a = world.anchor(target === 'lift' ? 'elevator.door' : 'bell');
      if (a) { a.getWorldPosition(v); v.y += target === 'lift' ? LIFT_Y : BELL_Y; return v; }
      return slotPoint(machineId('debt_terminal'));   // the Bell hangs at the terminal
    }
    const direct = slotPoint(machineId(target));
    if (direct || target !== 'bigone') return direct;
    let best: InstanceId | null = null, bestD = Infinity;
    for (const m of world.machines()) {
      const s = world.slot(m.id);
      if (!s || m.def.category === 'system' || world.isLocked(m.id)) continue;
      const d = Math.hypot(s.pos[0] - from.x, s.pos[2] - from.z);
      if (d < bestD) { bestD = d; best = m.id; }
    }
    return slotPoint(best);
  };

  const legPath = (leg: number): Vec2[] | null => {
    const hit = legs.get(leg);
    if (hit) return hit;
    const big = standSpot('bigone'), bank = standSpot('debt_terminal', 3);
    const lift: Vec2 = [LIFT_DOOR.x, LIFT_DOOR.z + 1.4];
    const path = leg === 1 ? (big ? trailPath(lift, [big.x, big.z]) : null) : big && bank ? trailPath([big.x, big.z], [bank.x, bank.z]) : null;
    if (path) legs.set(leg, path);
    return path;
  };

  const hide = (): void => { diamond.hide(); trail.show(null); shownLeg = 0; };

  return {
    hide,
    update(a) {
      const dt = Math.max(0, app.time.sim - seen);
      seen = app.time.sim;
      const p = app.player;
      const cam = app.camera;
      if (!p) { hide(); return; }
      const walking = p.mode === 'walk' && app.input.mode === 'walk';   // not seated, not in a cutscene, no journal or menu up
      const night = Math.floor(a.night);

      // the Bar's call-out: once, on Night 1, as the player passes the customers' side of the bar
      if (!selimSaid && night === 1 && walking && Math.hypot(p.pos.x - BAR_POS.x, p.pos.z - (BAR_POS.z - 1)) < BAR_NEAR_M) {
        const d = barDirections(p.pos.x, p.pos.z, p.yaw);
        selimSaid = true;
        if (d) {
          setFlag('selim');
          bus.emit('floor:say', {
            text: d.machines === d.bank ? t('way.selim.same', { dir: t(`way.dir.${d.bank}`) }) : t('way.selim', { machines: t(`way.dir.${d.machines}`), bank: t(`way.dir.${d.bank}`) }),
            speaker: t('story.speaker.selim'), voice: 'bartender', source: 'bonds.selim',
          });
        }
      }

      // the floor trail: leg 1 while the Big One is the goal, leg 2 while the terminal or the Bell is
      const want = night === 1 ? (a.target === 'bigone' ? 1 : a.target === 'debt_terminal' || a.target === 'bell' ? 2 : 0) : 0;
      if (want !== shownLeg) { trail.show(null); shownLeg = 0; }
      const path = want && !done.has(want) ? legPath(want) : null;
      if (path) {
        trail.show(path);
        shownLeg = want;
        const end = path[path.length - 1];
        if (Math.hypot(p.pos.x - end[0], p.pos.z - end[1]) < TRAIL_DONE_M) { done.add(want); setFlag(`trail.${want}`); trail.fade(); }
      }
      trail.update(dt);

      // the diamond
      const pt = a.target === null ? null : point(a.target, p.pos);
      if (!pt) { stall.update('', 0, 0); diamond.hide(); return; }
      const dist = Math.hypot(pt.x - p.pos.x, pt.z - p.pos.z);
      const stalled = stall.update(a.target as string, dist, walking ? dt : 0);
      const enabled = app.save.data.settings.waymark !== false;
      if (!walking || dist < ARRIVED_M || !waymarkWanted(night, enabled, stalled)) { diamond.hide(); return; }
      cam.updateMatrixWorld();
      const c = v.applyMatrix4(cam.matrixWorldInverse);
      const px = (app.ui as UIOverlayX | undefined)?.px ?? 3;
      const e = cam.projectionMatrix.elements;
      // the top band (clock, night bar) is the tallest HUD strip; the bottom row (pulls, phone hint) is shorter
      diamond.show(placeMark(c, e[0], e[5], window.innerWidth, window.innerHeight, { x: 10 * px + 8, top: Math.max(96, 44 * px), bottom: Math.max(60, 22 * px) }), dist);
    },
    dispose() { diamond.dispose(); trail.dispose(); },
  };
}
