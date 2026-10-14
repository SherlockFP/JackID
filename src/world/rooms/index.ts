/**
 * Rooms (WAVE 24 §2, world side): grille plates and marquees for the sealed wings, plus the room dressing. Built inside
 * `level.ts` so the lights, anchors, statics and per-frame updates join the level's lists.
 *
 *   bridge.ts     the seam to the rooms lane (`setRoomsBridge`); the integrator wires it once
 *   logic.ts      pure rules (plate views, locker layout, gauge needle, nearest key-ready grille, note anchor ids)
 *   grilles.ts    brass plates, KEY/BUY interactables, marquees, the key-ready cue
 *   dressing.ts   Jade, Wash (lockers), Boiler (gauge, Vent), the Collector's chair, Counting, note anchors
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { V3, ZoneId } from '@/core/types';
import type { InteractionSystem, WorldLights } from '../types';
import type { LightHint } from '../sys/arch';
import { buildGrilles } from './grilles';
import { buildDressing } from './dressing';

export { setRoomsBridge, roomsBridge, type RoomsBridge, type WingId, type WingState } from './bridge';
export { ROOM_ANCHOR_IDS, NOTE_NUMBERS, noteAnchorId, GRILLES, LOCKER_COUNT } from './logic';

export interface RoomsCtx {
  kit: KitX;
  tex: TexGen;
  seed: number;
  chair: THREE.Object3D | null;
  sumpPos: V3;
  isOpen: (zone: ZoneId) => boolean;
  interact?: InteractionSystem;
  lights?: WorldLights;
}

export interface RoomsBuild {
  root: THREE.Group;
  lights: LightHint[];
  anchors: Record<string, THREE.Object3D>;
  statics: Array<{ box: THREE.Box3; tag?: 'solid' }>;
  update(dt: number, t: number): void;
  /** Re-read the wing states on the next update. */
  refresh(): void;
  dispose(): void;
}

export function buildRooms(ctx: RoomsCtx): RoomsBuild {
  const grilles = buildGrilles({ kit: ctx.kit, seed: ctx.seed, isOpen: ctx.isOpen, interact: ctx.interact, lights: ctx.lights });
  const dressing = buildDressing({
    kit: ctx.kit, tex: ctx.tex, chair: ctx.chair, sumpPos: ctx.sumpPos, isOpen: ctx.isOpen,
    interact: ctx.interact, lights: ctx.lights,
  });
  const root = new THREE.Group();
  root.name = 'rooms';
  root.add(grilles.root, dressing.root);
  return {
    root,
    lights: [...grilles.lights, ...dressing.lights],
    anchors: dressing.anchors,
    statics: dressing.statics,
    update(dt: number, t: number): void {
      grilles.update(dt);
      dressing.update(dt, t);
    },
    refresh(): void { grilles.refresh(); },
    dispose(): void {
      grilles.dispose();
      dressing.dispose();
    },
  };
}
