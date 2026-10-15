/**
 * THE APARTMENT (wave 69, Home layer): the player's flat at `HOME_ORIGIN`, reached by the lift after a Night
 * (docs/WAVE69_HOME.md). The contract (stations, anchors, room controls) lives in src/game/home/contract.ts.
 *
 * DIRECTOR STUB: the world lane replaces this body with the real room (walls, door with peephole + chain, light switch, bed,
 * kitchen table, seated spouse, wall phone, window) following the THE UNDERNEATH pattern (src/world/hollow). The exported
 * names and shapes below are the contract and must not change.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { HomeRoomApi } from '@/game/home/contract';
import type { CollisionWorld, InteractionSystem } from '../types';
import type { LightHint } from '../sys/arch';

export interface HomeBuild {
  readonly root: THREE.Group;
  readonly statics: Array<{ box: THREE.Box3; tag?: 'solid' | 'walkable' }>;
  readonly lights: LightHint[];
  readonly anchors: Record<string, THREE.Object3D>;
  readonly api: HomeRoomApi;
  update(dt: number, t: number): void;
  dispose(): void;
}

/** Builds the apartment and its controls. Called from `level.ts` next to the Hollow. */
export function buildHome(_o: { kit: KitX; tex: TexGen; seed: number; interact?: InteractionSystem; collision?: CollisionWorld }): HomeBuild {
  const root = new THREE.Group();
  root.name = 'home';
  let lights = true;
  let chain = false;
  const api: HomeRoomApi = {
    setLights: (on) => { lights = on; },
    lightsOn: () => lights,
    setChain: (on) => { chain = on; },
    chainOn: () => chain,
    doorTo: () => Promise.resolve(),
    setSpouse: () => undefined,
    setDoorShadow: () => undefined,
  };
  return { root, statics: [], lights: [], anchors: {}, api, update: () => undefined, dispose: () => undefined };
}
