/**
 * THE APARTMENT (wave 69, Home layer): the player's flat at `HOME_ORIGIN`, reached by the lift after a Night
 * (docs/WAVE69_HOME.md). The contract (stations, anchors, room controls) lives in src/game/home/contract.ts.
 *
 * This file assembles the flat: the room and its dressing (room.ts), the front door (door.ts), the seated spouse, the anchors
 * and the stations. A station is an E prompt that emits `home:interact` with its name; the game decides what it does. The
 * room controls (`HomeRoomApi`) are exposed as `World.home` through `homeRoom()`.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { HOME_ANCHORS, type HomeRoomApi, type HomeStation } from '@/game/home/contract';
import type { CollisionWorld, InteractionSystem, WorldLights } from '../types';
import type { InteractableX } from '../interact';
import type { LightHint } from '../sys/arch';
import { ANCHOR_PLAN, at, DOOR_H, DOOR_X0, DOOR_X1, HOME_ZONE, SPOUSE_SEAT, WIN_X0, WIN_X1, WIN_Y0, WIN_Y1 } from './config';
import { buildRoom, type Statics } from './room';
import { HomeDoor } from './door';

export interface HomeBuild {
  readonly root: THREE.Group;
  readonly statics: Statics[];
  readonly lights: LightHint[];
  readonly anchors: Record<string, THREE.Object3D>;
  readonly api: HomeRoomApi;
  update(dt: number, t: number): void;
  dispose(): void;
}

let active: HomeRoomApi | null = null;

/** The apartment's controls for this run, or null (no world yet, or the level has not built the apartment). */
export function homeRoom(): HomeRoomApi | null {
  return active;
}

/** A world-space box from plan coordinates (local metres). */
const boxAt = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.Box3 =>
  new THREE.Box3(new THREE.Vector3(...at(x0, y0, z0)), new THREE.Vector3(...at(x1, y1, z1)));

/** Builds the apartment and its controls. Called from `level.ts` next to the Hollow. */
export function buildHome(o: { kit: KitX; tex: TexGen; seed: number; interact?: InteractionSystem; collision?: CollisionWorld; lights?: WorldLights }): HomeBuild {
  const root = new THREE.Group();
  root.name = 'home';
  // the zoned group is culled by distance like the rest of the level (world.ts), so the far flat costs nothing in the pit
  root.userData.zone = HOME_ZONE;
  const shell = new THREE.Group();
  shell.name = 'home:shell';
  const dyn = new THREE.Group();
  dyn.name = 'home:dyn';
  root.add(shell, dyn);

  const room = buildRoom({ kit: o.kit, tex: o.tex, seed: o.seed, shell, dyn });
  const door = new HomeDoor({ kit: o.kit, dyn, collision: o.collision ?? null });

  // the spouse sits at the kitchen table, facing the door; the mannequin is skinned, so it stays out of `shell`
  const spouse = o.kit.mannequin({ color: 0x5a4a52, jointColor: 0x2a2226, style: 'plain', clip: 'Sitting_Idle_Loop', height: 1.68 });
  spouse.root.position.set(...at(SPOUSE_SEAT.x, 0, SPOUSE_SEAT.z));
  root.add(spouse.root);

  // merge the static shell into a few draw calls (the moving and lit parts are in `dyn`, which is not merged)
  o.kit.finalize(shell);

  const anchors: Record<string, THREE.Object3D> = {};
  for (const [key, a] of Object.entries(ANCHOR_PLAN)) {
    const obj = new THREE.Object3D();
    obj.position.set(...at(a.p[0], a.p[1], a.p[2]));
    obj.rotation.y = a.yaw;
    root.add(obj);
    anchors[HOME_ANCHORS[key as keyof typeof HOME_ANCHORS]] = obj;
  }

  // ── room state (the api below moves it; the stations read it) ──────────────────────────────────
  let lightsOn = true;
  let chainOn = false;
  let spouseHere = true;

  const api: HomeRoomApi = {
    setLights(on) {
      lightsOn = on;
      room.setSwitched(on);
      o.lights?.setLevel(HOME_ZONE, on ? 1 : 0, 0.4);
    },
    lightsOn: () => lightsOn,
    setChain(on) {
      chainOn = on;
      door.setChain(on);
    },
    chainOn: () => chainOn,
    doorTo: (amount, dur) => door.doorTo(amount, dur),
    setSpouse(present) {
      spouseHere = present;
      spouse.setVisible(present);
    },
    setDoorShadow(on) {
      door.setShadow(on);
    },
  };

  // ── stations: each is an E prompt that reports to the game with `home:interact` ─────────────────
  const station = (id: HomeStation, box: THREE.Box3, priority: number, spec: Pick<InteractableX, 'label' | 'sub'> & { disabled?(): boolean }): InteractableX => ({
    id: `home:${id}`,
    box,
    maxDist: 2.2,
    priority,
    enabled: () => true,
    label: spec.label,
    sub: spec.sub,
    disabled: spec.disabled,
    onInteract: () => { bus.emit('home:interact', { station: id }); },
  });
  const stations: InteractableX[] = [
    // the bed's box reaches eye height: a horizontal ray from a standing player must hit it (the box's slack adds 0.3 m above)
    station('bed', boxAt(-3.0, 0, -1.5, -1.0, 1.7, 0.3), 2, {
      label: () => t('home.station.bed'),
      sub: () => t('home.station.bed.sub'),
    }),
    station('spouse', boxAt(1.0, 0, -1.2, 2.2, 1.45, -0.2), 2, {
      label: () => t('home.station.spouse'),
      sub: () => (spouseHere ? undefined : t('home.station.spouse.sub')),
      disabled: () => !spouseHere,
    }),
    station('phone', boxAt(1.95, 0.9, -2.75, 2.45, 1.6, -2.1), 2, {
      label: () => t('home.station.phone'),
    }),
    station('switch', boxAt(0.45, 0.95, 2.25, 0.95, 1.45, 2.6), 3, {
      label: () => t('home.station.switch'),
      sub: () => (lightsOn ? t('home.station.switch.on') : t('home.station.switch.off')),
    }),
    station('chain', boxAt(DOOR_X0 + 0.1, 1.3, 2.35, DOOR_X1 - 0.1, 1.55, 2.72), 3, {
      label: () => t('home.station.chain'),
      sub: () => (chainOn ? t('home.station.chain.on') : t('home.station.chain.off')),
    }),
    station('peephole', boxAt(-0.75, 1.43, 2.35, -0.45, 1.67, 2.72), 3, {
      label: () => t('home.station.peephole'),
    }),
    // the door is locked for the night in wave 69: it stays focusable (so the reason shows), but greyed
    station('door', boxAt(DOOR_X0, 0, 2.3, DOOR_X1, DOOR_H, 2.72), 1, {
      label: () => t('home.station.door'),
      sub: () => t('home.station.door.sub'),
      disabled: () => true,
    }),
    station('window', boxAt(WIN_X0 - 0.2, WIN_Y0 - 0.05, -2.85, WIN_X1 + 0.2, WIN_Y1 + 0.1, -2.3), 2, {
      label: () => t('home.station.window'),
      sub: () => t('home.station.window.sub'),
    }),
  ];
  const offs: Array<() => void> = [];
  if (o.interact) for (const i of stations) offs.push(o.interact.add(i));

  active = api;

  return {
    root,
    statics: room.statics,
    lights: room.lights,
    anchors,
    api,
    update() {
      // nothing per frame: the rain scrolls in the shader, the spouse is driven by the kit's mannequin update
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      door.dispose();
      spouse.dispose();
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
      if (active === api) active = null;
    },
  };
}
