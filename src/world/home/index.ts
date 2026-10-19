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
import type { MannequinOpts } from '@/kit/types';
import type { TexGen } from '@/core/texgen/types';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { HOME_ANCHORS, type HomeRoomApi, type HomeStation } from '@/game/home/contract';
import type { CollisionWorld, InteractionSystem, WorldLights } from '../types';
import type { InteractableX } from '../interact';
import type { LightHint } from '../sys/arch';
import { ANCHOR_PLAN, at, DESK, FRIDGE, HOME_ZONE, SPOUSE_SEAT, SPOUSE_SIT, STATION_PRIORITY, WALL_STATIONS, WIN_X0, WIN_X1, WIN_Y0, WIN_Y1 } from './config';
import { buildRoom, type Statics } from './room';
import { buildFurniture } from './furniture';
import { HomeDoor } from './door';
import { HallVisitors, type HomeVisitor } from './visitors';

export type { HomeVisitor } from './visitors';

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
let activeDoor: HomeDoor | null = null;
let activeVisitors: HallVisitors | null = null;

/** The apartment's controls for this run, or null (no world yet, or the level has not built the apartment). */
export function homeRoom(): HomeRoomApi | null {
  return active;
}

/**
 * THE VISITORS (wave 71). These helpers sit beside the frozen `HomeRoomApi` (src/game/home/contract.ts) and act on the one
 * apartment built for this run; each is a no-op when no apartment is built. They are exported from this module (the game
 * imports `@/world/home`), not through `World.home`:
 *  - `showVisitor(type | null)`: shows THE LISTENER, THE LEANER or THE PICKER standing in the hall at `home.hall`, or hides
 *    them all (null). Pose and colour tell the type at the peephole.
 *  - `visitorShown()`: the visitor on show, or null.
 *  - `shakeDoor(strength?, dur?)`: rattles the shut front door (a few mm of yaw, decaying, 0.25 s of sim time by default).
 *    `strength` is 0..1 (default 1). Use it for a shove or a shoulder; the thud and the knock are the sound lane's.
 *  - `setDoorShadow` is on `World.home` (HomeRoomApi) and shows the two feet on the light strip under the door.
 */
export function showVisitor(type: HomeVisitor | null): void {
  activeVisitors?.show(type);
}

/** The visitor on show in the hall, or null. */
export function visitorShown(): HomeVisitor | null {
  return activeVisitors?.current() ?? null;
}

/** Rattles the shut front door: `strength` 0..1 (default 1), `dur` seconds of sim time (default 0.25). */
export function shakeDoor(strength = 1, dur = 0.25): void {
  activeDoor?.shake(strength, dur);
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
  const furniture = buildFurniture({ kit: o.kit, tex: o.tex, seed: o.seed, shell, dyn });   // the fridge, the desk and the old PC
  const door = new HomeDoor({ kit: o.kit, dyn, collision: o.collision ?? null });
  activeDoor = door;

  // the spouse sits at the kitchen table, facing the door; the mannequin is skinned, so it stays out of `shell`
  // Ada is a normal lit girl, NOT a dark other-dimension NPC (npc: false: no rim, no glowing eyes): warm skin, brown hair, a plum
  // dress and a painted face; the candle and a soft key light (room.ts) light her. The kit's female option gives build and idle.
  const spouseOpts: MannequinOpts & { npc: boolean; female: boolean; hair: number; dress: number } = {
    color: 0xeab08c, jointColor: 0xe0a07c, style: 'plain', clip: 'Sitting_Idle_Loop', height: 1.66,
    npc: false, female: true, hair: 0x6b3f2a, dress: 0xa8456a,
  };
  const spouse = o.kit.mannequin(spouseOpts);
  spouse.root.position.set(...at(SPOUSE_SEAT.x, SPOUSE_SIT.y, SPOUSE_SEAT.z + SPOUSE_SIT.fwd));
  root.add(spouse.root);

  // the three hall visitors (hidden until the game shows one); they stand in the corridor outside the door
  const visitors = new HallVisitors(o.kit, root);
  activeVisitors = visitors;

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
  // the lens-view anchor the game asks for (src/game/home/evening.ts PEEP_VIEW_ANCHOR): the same pose as the peephole, a
  // separate node so the camera cut owns its own transform
  const peepEye = anchors[HOME_ANCHORS.peephole];
  const peepView = new THREE.Object3D();
  peepView.name = 'home:peephole:view';
  peepView.position.copy(peepEye.position);
  peepView.rotation.copy(peepEye.rotation);
  root.add(peepView);
  anchors['home.peephole.view'] = peepView;

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
    station('switch', boxAt(...WALL_STATIONS.switch), STATION_PRIORITY.switch, {
      label: () => t('home.station.switch'),
      sub: () => (lightsOn ? t('home.station.switch.on') : t('home.station.switch.off')),
    }),
    // the door-side stations sit inside the room (config WALL_STATIONS). Priority decides the overlaps: the peephole at eye
    // height beats the low door, which beats the chain on the track.
    station('chain', boxAt(...WALL_STATIONS.chain), STATION_PRIORITY.chain, {
      label: () => t('home.station.chain'),
      sub: () => (chainOn ? t('home.station.chain.on') : t('home.station.chain.off')),
    }),
    station('peephole', boxAt(...WALL_STATIONS.peephole), STATION_PRIORITY.peephole, {
      label: () => t('home.station.peephole'),
    }),
    // the door is locked for the night in wave 69: it stays focusable (so the reason shows), but greyed
    station('door', boxAt(...WALL_STATIONS.door), STATION_PRIORITY.door, {
      label: () => t('home.station.door'),
      sub: () => t('home.station.door.sub'),
      disabled: () => true,
    }),
    // the fridge (Ada's snack, the market's deliveries: src/game/food.ts) and the old PC on the desk (the economy lane's market)
    station('fridge', boxAt(...FRIDGE.station), 2, {
      label: () => t('home.station.fridge'),
      sub: () => t('home.station.fridge.sub'),
    }),
    station('computer', boxAt(...DESK.station), 2, {
      label: () => t('home.station.computer'),
      sub: () => t('home.station.computer.sub'),
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
    statics: [...room.statics, ...furniture.statics],
    lights: [...room.lights, ...furniture.lights],
    anchors,
    api,
    update(dt, t) {
      // the rain scrolls in the shader and the spouse is driven by the kit's mannequin update; only the PC's cursor blinks here
      furniture.update(dt, t);
    },
    dispose() {
      for (const off of offs.splice(0)) off();
      door.dispose();
      visitors.dispose();
      spouse.dispose();
      if (activeDoor === door) activeDoor = null;
      if (activeVisitors === visitors) activeVisitors = null;
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      });
      if (active === api) active = null;
    },
  };
}
