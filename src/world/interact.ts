/**
 * Interaction system (WORLD-SYS). Contract: TECH_SPEC §2.14 / §5.4.
 *
 * Every fixed step: ray from the camera centre → every enabled `Interactable` box within its `maxDist`
 * (default 2.2 m, tables 2.8 m) → the best by `priority` then distance, discarded when a `solid` collider is
 * nearer → `ui.prompt` ("[E] Play Coin Flip" + sub line) → `E` calls `onInteract()`.
 *
 * Boxes may overlap the collider of their own machine (modelers often make the crosshair volume a bit
 * bigger than the cabinet), so occlusion is tested against the ENTRY distance of the box and a box that
 * contains the camera is never occluded. `disabled()` (extension) greys the prompt while keeping the box
 * focusable — `onInteract` then explains why ("Occupied", "Locked").
 */
import type * as THREE from 'three';
import { Box3, Vector3 } from 'three';
import type { Action } from '@/core/input/types';
import type { CollisionWorld, Interactable, InteractionSystem } from './types';
import { app } from '@/core/app';
import { log } from '@/core/log';

export const DEFAULT_REACH = 2.2;
/** A solid collider must be at least this much nearer than the target to occlude it. */
const OCCLUDE_MARGIN = 0.02;
const COOLDOWN_S = 0.2;
/**
 * Vertical slack on every interactable box (playtest: tables needed a hard look down). The ray is tested against the box
 * grown by this much above and below, so a table top ~1 m below the eye is reached with a gentle pitch.
 */
export const INTERACT_SLACK_DOWN_M = 0.5;
export const INTERACT_SLACK_UP_M = 0.3;

export interface InteractableX extends Interactable {
  /** Prompt is drawn disabled (still focusable; `onInteract` should toast the reason). */
  disabled?(): boolean;
}

export interface PromptSpec { action: Action; label: string; sub?: string; disabled?: boolean }
/** Side effects of the interaction system; defaults are `app.ui.prompt` and `app.input.pressed('interact')`. */
export interface InteractionIO {
  prompt(p: PromptSpec | null): void;
  pressed(): boolean;
}

export interface InteractionHost extends InteractionSystem {
  /** Recompute `focused`, refresh the prompt, handle the interact key. Call once per fixed step. */
  update(dt?: number): void;
  /** Off while seated, in cutscenes, as a ghost…: clears focus and hides the prompt. */
  setActive(on: boolean): void;
  readonly active: boolean;
  /** Number of registered interactables (debug). */
  readonly size: number;
  /** Hide the prompt and forget everything (world dispose). */
  clear(): void;
}

/** Entry distance of the ray into `box`: 0 when the origin is inside, −1 when it misses. */
export function rayBoxEntry(box: THREE.Box3, o: THREE.Vector3, d: THREE.Vector3): number {
  let tmin = 0, tmax = Infinity;
  if (d.x !== 0) {
    const a = (box.min.x - o.x) / d.x, b = (box.max.x - o.x) / d.x;
    tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
  } else if (o.x < box.min.x || o.x > box.max.x) return -1;
  if (d.y !== 0) {
    const a = (box.min.y - o.y) / d.y, b = (box.max.y - o.y) / d.y;
    tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
  } else if (o.y < box.min.y || o.y > box.max.y) return -1;
  if (d.z !== 0) {
    const a = (box.min.z - o.z) / d.z, b = (box.max.z - o.z) / d.z;
    tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b));
  } else if (o.z < box.min.z || o.z > box.max.z) return -1;
  return tmax >= tmin ? tmin : -1;
}

const defaultIO: InteractionIO = {
  prompt: (p) => app.ui.prompt(p),
  pressed: () => app.input.pressed('interact'),
};

export function createInteraction(camera: THREE.Camera, collision: CollisionWorld, io: InteractionIO = defaultIO): InteractionHost {
  const items = new Set<InteractableX>();
  const origin = new Vector3(), dir = new Vector3();
  const candItem: InteractableX[] = [];
  const candDist: number[] = [];
  const candScore: number[] = [];
  const slackBox = new Box3();
  let focused: InteractableX | null = null;
  let active = true;
  let cooldown = 0;
  let shownKey = '';

  function showPrompt(i: InteractableX | null): void {
    if (!i) {
      if (shownKey !== '') { shownKey = ''; io.prompt(null); }
      return;
    }
    const label = i.label();
    const sub = i.sub?.();
    const disabled = i.disabled?.() ?? false;
    const key = `${i.id}\u0001${label}\u0001${sub ?? ''}\u0001${disabled ? 1 : 0}`;
    if (key === shownKey) return;
    shownKey = key;
    io.prompt({ action: 'interact', label, sub: sub || undefined, disabled });
  }

  function pickFocus(): InteractableX | null {
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    let n = 0;
    for (const i of items) {
      if (!i.enabled()) continue;
      slackBox.copy(i.box);
      slackBox.min.y -= INTERACT_SLACK_DOWN_M;
      slackBox.max.y += INTERACT_SLACK_UP_M;
      const d = rayBoxEntry(slackBox, origin, dir);
      if (d < 0 || d > (i.maxDist ?? DEFAULT_REACH)) continue;
      candItem[n] = i; candDist[n] = d; candScore[n] = (i.priority ?? 0) * 1000 - d;
      n++;
    }
    // best score first; an occluded candidate falls through to the next one
    for (let k = 0; k < n; k++) {
      let b = -1, bs = -Infinity;
      for (let j = 0; j < n; j++) if (candScore[j] > bs) { bs = candScore[j]; b = j; }
      if (b < 0) break;
      const d = candDist[b];
      const wall = d > 0 ? collision.raycast(origin, dir, d) : null;
      if (!wall || wall.dist >= d - OCCLUDE_MARGIN) return candItem[b];
      candScore[b] = -Infinity;
    }
    return null;
  }

  return {
    add(i) { items.add(i); return () => { items.delete(i); if (focused === i) { focused = null; showPrompt(null); } }; },
    get focused() { return focused; },
    get active() { return active; },
    get size() { return items.size; },
    setActive(on) {
      if (active === on) return;
      active = on;
      if (!on) { focused = null; showPrompt(null); }
    },
    update(dt = 1 / 60) {
      if (cooldown > 0) cooldown -= dt;
      if (!active) return;
      focused = pickFocus();
      showPrompt(focused);
      if (focused && cooldown <= 0 && io.pressed()) {
        cooldown = COOLDOWN_S;
        const hit = focused;
        shownKey = '';                                   // text may change after the action
        try { hit.onInteract(); } catch (e) { log.error('interact', hit.id, e); }
      }
    },
    clear() { items.clear(); focused = null; showPrompt(null); },
  };
}
