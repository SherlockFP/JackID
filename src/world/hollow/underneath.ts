/**
 * THE UNDERNEATH (world/hollow): a closed void room far below the pit. A long table with its lordstable seat in the
 * middle, one hanging lamp over it, three Lords behind it, and the doorway back up on the south wall. Everything is built
 * at `HOLLOW_HOME`, far from the pit, so the room needs no fog of its own: the walls hide the pit, and the lights are
 * its only light (the lamp, a red glow at the Lords' eyes, and the red rim of the exit).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';
import type { LightHint } from '../sys/arch';
import { pendant } from '../lights';
import { buildDoorway, type Doorway } from './doorway';
import { buildLords, type LordRig } from './lords';
import { ARRIVE, DOOR_H, DOOR_W, EXIT_DOOR, HOLLOW_HOME, LORD_POS, TABLE_POS, TABLE_Y, UNDER_H, UNDER_HALF } from './config';

export interface Underneath {
  readonly root: THREE.Group;
  readonly statics: Array<{ box: THREE.Box3; tag?: 'solid' | 'walkable' }>;
  readonly lights: LightHint[];
  readonly anchors: Record<string, THREE.Object3D>;
  readonly lords: LordRig[];
  /** The way back up, on the south wall. */
  readonly exit: Doorway;
  /** Per frame: the Lords' idle head turns (`calm` shortens and slows them). */
  update(dt: number, player: THREE.Vector3 | null, calm: boolean): void;
  dispose(): void;
}

const WALL_T = 0.4;

export function buildUnderneath(kit: KitX, tex: TexGen, rng: Rng): Underneath {
  const H = HOLLOW_HOME;
  const root = new THREE.Group();
  root.name = 'hollow:underneath';
  const statics: Underneath['statics'] = [];
  const lights: LightHint[] = [];
  const anchors: Record<string, THREE.Object3D> = {};

  const x0 = H[0] - UNDER_HALF, x1 = H[0] + UNDER_HALF, z0 = H[2] - UNDER_HALF, z1 = H[2] + UNDER_HALF;
  const floorMat = kit.mat({ color: 0xffffff, map: tex.concrete(0x2a2226) });
  const wallMat = kit.mat({ color: 0x1a1214, map: tex.concrete(0x1e1618) });
  const woodDark = kit.mat({ color: 0x241610, map: tex.wood(0x2a1a12) });
  const velvet = kit.mat({ color: 0x3a0a10 });

  // solid box: visual + static collider (min/max in world space)
  const solid = (a: number, b: number, c: number, d: number, e: number, f: number, m: THREE.Material): void => {
    kit.box(d - a, f - b, e - c, m, { pos: [(a + d) / 2, (b + f) / 2, (c + e) / 2], parent: root });
    statics.push({ box: new THREE.Box3(new THREE.Vector3(a, b, c), new THREE.Vector3(d, f, e)), tag: 'solid' });
  };

  // floor (walkable top at HOME.y) and ceiling (visual only)
  kit.box(x1 - x0 + 2 * WALL_T, 0.3, z1 - z0 + 2 * WALL_T, floorMat, { pos: [H[0], H[1] - 0.15, H[2]], parent: root });
  statics.push({ box: new THREE.Box3(new THREE.Vector3(x0 - WALL_T, H[1] - 0.5, z0 - WALL_T), new THREE.Vector3(x1 + WALL_T, H[1], z1 + WALL_T)), tag: 'walkable' });
  kit.box(x1 - x0 + 2 * WALL_T, 0.3, z1 - z0 + 2 * WALL_T, wallMat, { pos: [H[0], H[1] + UNDER_H + 0.15, H[2]], parent: root });

  // walls: west, east, north solid; south with the exit opening (door width, lintel above)
  const top = H[1] + UNDER_H;
  solid(x0 - WALL_T, H[1], z0 - WALL_T, x0, top, z1 + WALL_T, wallMat);
  solid(x1, H[1], z0 - WALL_T, x1 + WALL_T, top, z1 + WALL_T, wallMat);
  solid(x0, H[1], z0 - WALL_T, x1, top, z0, wallMat);
  const half = DOOR_W / 2;
  solid(x0, H[1], z1, H[0] - half, top, z1 + WALL_T, wallMat);
  solid(H[0] + half, H[1], z1, x1, top, z1 + WALL_T, wallMat);
  solid(H[0] - half, H[1] + DOOR_H, z1, H[0] + half, top, z1 + WALL_T, wallMat);

  // the long table; its top is solid so the player walks round the ends
  const tx = TABLE_POS[0], tz = TABLE_POS[2], ty = H[1];
  kit.box(5.4, 0.08, 1.0, woodDark, { pos: [tx, ty + TABLE_Y - 0.04, tz], parent: root });
  kit.box(5.2, 0.01, 0.8, velvet, { pos: [tx, ty + TABLE_Y + 0.005, tz], parent: root });
  for (const sx of [-2.5, 2.5]) for (const sz of [-0.4, 0.4]) {
    kit.box(0.1, TABLE_Y - 0.08, 0.1, woodDark, { pos: [tx + sx, ty + (TABLE_Y - 0.08) / 2, tz + sz], parent: root });
  }
  statics.push({ box: new THREE.Box3(new THREE.Vector3(tx - 2.7, ty, tz - 0.5), new THREE.Vector3(tx + 2.7, ty + TABLE_Y, tz + 0.5)), tag: 'solid' });
  for (const sx of [-2.1, 2.1]) {
    const c = kit.lamp({ r: 0.045, color: 0xffcf7a, shape: 'dome' });
    c.root.position.set(tx + sx, ty + TABLE_Y + 0.05, tz + 0.25);
    root.add(c.root);
  }

  // one hanging lamp over the table (its cord hooks to the ceiling)
  const lamp = pendant(kit, { id: 'hollow:lamp', pos: [H[0], top, H[2] - 1.5], drop: UNDER_H - 2.4, color: 0xff9a4a, intensity: 1.0, range: 7, flicker: 'SICK' });
  root.add(lamp.root);
  lights.push(lamp.hint);

  // the Lords, and the red glow at their eyes
  const lordsRoot = new THREE.Group();
  lordsRoot.name = 'hollow:lords';
  root.add(lordsRoot);
  const lords = buildLords(kit, lordsRoot, rng);
  lights.push({ id: 'hollow:eyes', pos: [H[0], H[1] + 2.4, H[2] - 3.9], color: 0xff2a1a, intensity: 0.5, range: 5, flicker: 'STEADY' });

  // the way back up
  const exit = buildDoorway(kit, { leaves: kit.mat({ color: 0x1a0a0a }), rim: 0xff1a1a });
  exit.root.position.set(EXIT_DOOR[0], EXIT_DOOR[1], EXIT_DOOR[2]);
  exit.root.rotation.y = Math.PI;
  exit.setSplit(0);
  root.add(exit.root);
  lights.push({ id: 'hollow:exit', pos: [H[0], H[1] + 1.2, H[2] + UNDER_HALF - 0.6], color: 0xff1a1a, intensity: 0.6, range: 4, flicker: 'STEADY' });

  // anchors (cutscene and machine targets)
  const marker = (p: readonly [number, number, number]): THREE.Object3D => {
    const o = new THREE.Object3D();
    o.position.set(p[0], p[1], p[2]);
    root.add(o);
    return o;
  };
  anchors['hollow.arrive'] = marker(ARRIVE);
  anchors['hollow.exit'] = marker(EXIT_DOOR);
  anchors['hollow.table'] = marker(TABLE_POS);
  anchors['hollow.lordstable'] = anchors['hollow.table'];
  anchors['hollow.lord.ash'] = marker(LORD_POS.ash);
  anchors['hollow.lord.ledgers'] = marker(LORD_POS.ledgers);
  anchors['hollow.lord.mirrors'] = marker(LORD_POS.mirrors);

  return {
    root, statics, lights, anchors, lords, exit,
    update(dt, player, calm) {
      for (const l of lords) l.tick(dt, player, calm);
    },
    dispose() {
      for (const l of lords) l.dispose();
      exit.dispose();
      root.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };
}
