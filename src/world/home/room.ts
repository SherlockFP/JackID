/**
 * THE APARTMENT, the room and its dressing (world/home): walls with the window and the front door openings, floors, the
 * ceiling, the hallway, the bed, the kitchen (a table, two chairs, a counter), the wall phone and answering machine, the
 * family photo, the coat hook, the light switch, the lights (zone `home`, and the hall bulb outside it) and the window's
 * city with rain. Static parts go to `shell` (merged by kit.finalize); moving or lit parts go to `dyn` (kept apart).
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { TexGen } from '@/core/texgen/types';
import { createRng } from '@/core/rng';
import { pendant } from '../lights';
import { FLOOR_TILE_M } from '../layout';
import { placeCouch } from '../props/vendorModels';
import type { LightHint } from '../sys/arch';
import {
  at, BED, CEIL, DOOR_H, DOOR_X0, DOOR_X1, EMPTY_SEAT, HALL_X0, HALL_X1, HALL_Z1, HOME_ZONE, LIGHT, SOUTH_WALL_SOLIDS,
  SPOUSE_SEAT, SPOUSE_SIT, TABLE,
  WIN_X0, WIN_X1, WIN_Y0, WIN_Y1,
} from './config';

export interface Statics { box: THREE.Box3; tag?: 'solid' | 'walkable' }

export interface RoomParts {
  readonly statics: Statics[];
  /** The point lights: the ceiling light and the pendant (zone `home`), and the hall bulb (outside the zone). */
  readonly lights: LightHint[];
  /** The room's switch: the ceiling light and the pendant (the hall bulb stays lit). */
  setSwitched(on: boolean): void;
}

export interface RoomCtx { kit: KitX; tex: TexGen; seed: number; shell: THREE.Group; dyn: THREE.Group }

export function buildRoom(c: RoomCtx): RoomParts {
  const { kit, tex, seed, shell, dyn } = c;
  const statics: Statics[] = [];

  // a solid (or visual-only) box in plan coordinates
  const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material, solid = false): void => {
    kit.box(x1 - x0, y1 - y0, z1 - z0, m, { pos: at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), parent: shell });
    if (solid) statics.push({ box: new THREE.Box3(new THREE.Vector3(...at(x0, y0, z0)), new THREE.Vector3(...at(x1, y1, z1))), tag: 'solid' });
  };

  // ── materials (the palette from kit.pal; procedural textures for the walls, floors and the window) ──
  const wallTex = tex.canvas(64, 64, (g, w, h) => {
    g.fillStyle = '#46504c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a443f';
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 3, h);
    g.fillStyle = '#5a5246'; g.fillRect(0, h - 6, w, 6);
  });
  const wall = kit.mat({ color: 0xffffff, map: wallTex });
  // vendored boards and stone tile at the shared floor density (the kit tags a 64 px vendor map as 1 m: widen it to FLOOR_TILE_M)
  const floorMap = (p: string): THREE.Texture => { const m = kit.tex.vendor(p, { size: 64 }); m.userData.tile = FLOOR_TILE_M; return m; };
  const floor = kit.mat({ color: 0xd8a880, map: floorMap('sbs-tiny2/128x128/Wood/Wood_01-128x128.png') });
  const hallFloor = kit.mat({ color: 0x9a8a78, map: floorMap('sbs-horror/128x128/Floor/Horror_Floor_12-128x128.png') });
  const ceil = kit.mat({ color: 0x2c2926 });
  const trim = kit.mat({ color: kit.pal.woodDark });
  const wood = kit.mat({ color: kit.pal.wood });
  const cream = kit.mat({ color: kit.pal.cream });
  const black = kit.mat({ color: kit.pal.black });
  const steel = kit.mat({ color: kit.pal.steel });
  const brass = kit.mat({ color: kit.pal.brass });
  const blanket = kit.mat({ color: kit.pal.redDark });
  const coat = kit.mat({ color: kit.pal.leather });

  // ── floors and ceilings ────────────────────────────────────────────────────────────────────
  slab(-3.3, -0.1, -2.8, 3.3, 0, 2.8, floor);
  slab(HALL_X0 - 0.3, -0.1, 2.8, HALL_X1 + 0.3, 0, HALL_Z1 + 0.3, hallFloor);
  statics.push({ box: new THREE.Box3(new THREE.Vector3(...at(-3.3, -0.5, -2.8)), new THREE.Vector3(...at(3.3, 0, 2.8))), tag: 'walkable' });
  statics.push({
    box: new THREE.Box3(new THREE.Vector3(...at(HALL_X0 - 0.3, -0.5, 2.8)), new THREE.Vector3(...at(HALL_X1 + 0.3, 0, HALL_Z1 + 0.3))),
    tag: 'walkable',
  });
  slab(-3.3, CEIL, -2.8, 3.3, CEIL + 0.12, 2.8, ceil);
  slab(HALL_X0 - 0.3, CEIL, 2.8, HALL_X1 + 0.3, CEIL + 0.12, HALL_Z1 + 0.3, ceil);

  // ── walls: the room (window in the north wall, front door in the south) and the hallway ─────────
  slab(-3.3, 0, -2.8, -3.0, CEIL, 2.8, wall, true);
  slab(3.0, 0, -2.8, 3.3, CEIL, 2.8, wall, true);
  slab(-3.3, 0, -2.8, WIN_X0, CEIL, -2.5, wall, true);
  slab(WIN_X1, 0, -2.8, 3.3, CEIL, -2.5, wall, true);
  slab(WIN_X0, 0, -2.8, WIN_X1, WIN_Y0, -2.5, wall, true);
  slab(WIN_X0, WIN_Y1, -2.8, WIN_X1, CEIL, -2.5, wall, true);
  for (const s of SOUTH_WALL_SOLIDS) slab(s[0], s[1], s[2], s[3], s[4], s[5], wall, true);
  slab(HALL_X0 - 0.3, 0, 2.8, HALL_X0, CEIL, HALL_Z1 + 0.3, wall, true);
  slab(HALL_X1, 0, 2.8, HALL_X1 + 0.3, CEIL, HALL_Z1 + 0.3, wall, true);
  slab(HALL_X0 - 0.3, 0, HALL_Z1, HALL_X1 + 0.3, CEIL, HALL_Z1 + 0.3, wall, true);

  // door frame trims on both faces of the opening
  for (const z of [2.46, 2.8]) {
    slab(DOOR_X0 - 0.05, 0, z, DOOR_X0, DOOR_H + 0.03, z + 0.04, trim);
    slab(DOOR_X1, 0, z, DOOR_X1 + 0.05, DOOR_H + 0.03, z + 0.04, trim);
    slab(DOOR_X0 - 0.05, DOOR_H, z, DOOR_X1 + 0.05, DOOR_H + 0.03, z + 0.04, trim);
  }

  // ── the window: frame, sill, mullion and transom; the glass, the city and the rain sit in `dyn` / outside ──────
  slab(WIN_X0 - 0.05, WIN_Y1, -2.52, WIN_X1 + 0.05, WIN_Y1 + 0.06, -2.46, trim);
  slab(WIN_X0 - 0.1, WIN_Y0 - 0.05, -2.52, WIN_X1 + 0.1, WIN_Y0, -2.28, trim);
  slab(WIN_X0 - 0.04, WIN_Y0, -2.52, WIN_X0, WIN_Y1, -2.46, trim);
  slab(WIN_X1, WIN_Y0, -2.52, WIN_X1 + 0.04, WIN_Y1, -2.46, trim);
  slab(-0.62, WIN_Y0, -2.52, -0.58, WIN_Y1, -2.46, trim);
  slab(WIN_X0, 1.48, -2.52, WIN_X1, 1.52, -2.46, trim);
  const glass = kit.glass({ w: WIN_X1 - WIN_X0, h: WIN_Y1 - WIN_Y0, d: 0.02, tint: 0x6a88b0, opacity: 0.2 });
  glass.position.set(...at((WIN_X0 + WIN_X1) / 2, (WIN_Y0 + WIN_Y1) / 2, -2.6));
  dyn.add(glass);

  const cityTex = tex.canvas(256, 160, (g, w, h) => {
    const rng = createRng(seed ^ 0x51ab);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a0c1a');
    sky.addColorStop(1, '#2a2030');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    let x = 0;
    while (x < w) {
      const bw = 8 + rng.int(0, 14);
      const bh = 30 + rng.int(0, 70);
      g.fillStyle = '#07081a';
      g.fillRect(x, h - bh, bw, bh);
      for (let yy = h - bh + 4; yy < h - 4; yy += 6) {
        for (let xx = x + 2; xx < x + bw - 2; xx += 4) {
          if (rng.chance(0.18)) { g.fillStyle = rng.chance(0.8) ? '#ffcc66' : '#ff8a5a'; g.fillRect(xx, yy, 2, 2); }
        }
      }
      x += bw + rng.int(0, 3);
    }
  });
  const cityMat = kit.mat({ color: 0xffffff, map: cityTex, lit: false, fog: false });
  kit.plane(5.6, 2.8, cityMat, { pos: at(-0.6, 1.5, -4.4), parent: shell });

  const rainTex = tex.canvas(64, 64, (g, w) => {
    g.strokeStyle = '#b8d4f0';
    g.lineWidth = 1;
    for (let i = -1; i < 6; i++) {
      const x = i * 12;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 8, w); g.stroke();
    }
  });
  const rainMat = kit.mat({ color: 0xffffff, map: rainTex, lit: false, alphaTest: 0.5, scroll: [0, -1.6], fog: false, side: 'double' });
  kit.plane(WIN_X1 - WIN_X0, WIN_Y1 - WIN_Y0, rainMat, { pos: at((WIN_X0 + WIN_X1) / 2, (WIN_Y0 + WIN_Y1) / 2, -2.95), parent: dyn });

  // ── the bed against the west wall (headboard on the wall) ──────────────────────────────────────
  slab(BED.x0, 0, BED.z0, BED.x1, BED.h, BED.z1, wood, true);
  slab(-3.0, 0, -1.35, -2.9, 1.0, 0.15, trim, true);
  slab(-2.9, BED.h, -1.25, -1.15, 0.6, 0.05, cream);
  slab(-2.05, 0.6, -1.27, -1.12, 0.64, 0.07, blanket);
  slab(-2.88, 0.6, -1.05, -2.55, 0.72, -0.6, cream);
  slab(-2.88, 0.6, -0.35, -2.55, 0.72, -0.1, cream);

  // ── the kitchen: the table with a solid top, two chairs (the spouse's faces the door), a counter on the east wall ──
  slab(TABLE.x0, TABLE.top - 0.04, TABLE.z0, TABLE.x1, TABLE.top, TABLE.z1, wood, true);
  for (const lx of [TABLE.x0 + 0.06, TABLE.x1 - 0.06]) for (const lz of [TABLE.z0 + 0.06, TABLE.z1 - 0.06]) {
    slab(lx - 0.03, 0, lz - 0.03, lx + 0.03, TABLE.top - 0.04, lz + 0.03, trim);
  }
  const seatChair = kit.chair({ h: SPOUSE_SIT.seat, seat: kit.pal.wood, wood: kit.pal.woodDark });
  seatChair.position.set(...at(SPOUSE_SEAT.x, 0, SPOUSE_SEAT.z));
  shell.add(seatChair);
  const emptyChair = kit.chair({ h: SPOUSE_SIT.seat, seat: kit.pal.wood, wood: kit.pal.woodDark });
  emptyChair.position.set(...at(EMPTY_SEAT.x, 0, EMPTY_SEAT.z));
  emptyChair.rotation.y = Math.PI;
  shell.add(emptyChair);
  slab(2.5, 0, -0.3, 3.0, 0.92, 1.5, black, true);
  slab(2.46, 0.9, -0.34, 3.02, 0.93, 1.54, steel);

  // ── the couch in the living corner (north-west, against the north wall beside the window, facing the room) ──
  // the PSX couch GLB loads async; its footprint is solid from the first frame, so the room plays the same either way
  void placeCouch(dyn, { pos: at(-2.0, 0, -2.1), lookYaw: Math.PI, length: 1.8 });
  statics.push({ box: new THREE.Box3(new THREE.Vector3(...at(-2.9, 0, -2.5)), new THREE.Vector3(...at(-1.1, 0.85, -1.7))), tag: 'solid' });

  // ── the wall phone (north wall) and the answering machine on its shelf, with the red light ─────────
  slab(2.0, 0.96, -2.5, 2.45, 0.99, -2.32, trim);
  slab(2.05, 0.99, -2.46, 2.35, 1.1, -2.32, black);
  slab(2.12, 1.22, -2.5, 2.28, 1.42, -2.44, cream);
  slab(2.05, 1.42, -2.46, 2.35, 1.47, -2.39, black);
  const led = kit.lamp({ r: 0.014, color: 0xff2a1a, shape: 'flat' });
  led.root.position.set(...at(2.3, 1.06, -2.31));
  led.setOn(true);
  dyn.add(led.root);

  // ── the family photo (east wall) in a dark frame ─────────────────────────────────────────────
  slab(2.95, 1.2, -1.55, 3.0, 1.8, -0.85, trim);
  const photoTex = tex.canvas(96, 96, (g, w, h) => {
    g.fillStyle = '#6b5a3e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8c49a'; g.fillRect(0, 0, w, h * 0.35);
    const figure = (cx: number, base: number, s: number, color: string): void => {
      g.fillStyle = color;
      g.beginPath(); g.arc(cx, base - 34 * s, 7 * s, 0, Math.PI * 2); g.fill();
      g.fillRect(cx - 9 * s, base - 26 * s, 18 * s, 26 * s);
    };
    figure(30, h - 6, 1.0, '#3a2a22');
    figure(64, h - 6, 1.0, '#4a3328');
    figure(48, h - 4, 0.6, '#7a4a3a');
  });
  kit.plane(0.56, 0.5, kit.mat({ color: 0xffffff, map: photoTex, lit: false }), { pos: at(2.93, 1.5, -1.2), rot: [0, -90, 0], parent: shell });

  // ── the coat hook beside the door (the coat is only dressing) ──────────────────────────────────
  kit.cyl(0.012, 0.012, 0.07, brass, { pos: at(-2.2, 1.7, 2.46), rot: [90, 0, 0], parent: shell, seg: 6 });
  kit.box(0.42, 0.72, 0.1, coat, { pos: at(-2.2, 1.3, 2.4), parent: shell });

  // ── the light switch by the door: the plate on the wall, the lever and the pilot plate in `dyn` ─────
  // the pilot is a small plate above the lever: warm and lit when the ceiling light is on, dark when it is off
  kit.box(0.12, 0.18, 0.02, cream, { pos: at(0.7, 1.2, 2.49), parent: shell });
  const lever = kit.box(0.03, 0.06, 0.02, kit.mat({ color: kit.pal.white }), { pos: at(0.7, 1.2, 2.47), parent: dyn });
  const pilotOn = kit.box(0.04, 0.03, 0.012, kit.mat({ color: 0xffd27a, lit: false }), { pos: at(0.7, 1.31, 2.468), parent: dyn });
  const pilotOff = kit.box(0.04, 0.03, 0.012, kit.mat({ color: 0x2a2622, lit: false }), { pos: at(0.7, 1.31, 2.468), parent: dyn });

  // ── the lights ────────────────────────────────────────────────────────────────────────────────
  // the ceiling light is a bare point light (the pendant below is the one visible fixture: a second shade at the room centre read as a stray blob)
  const ceilingHint: LightHint = {
    id: 'home:ceiling', pos: at(0, CEIL - 0.25, 0), color: LIGHT.ceiling.color, intensity: LIGHT.ceiling.intensity,
    range: LIGHT.ceiling.range, flicker: 'STEADY', zone: HOME_ZONE,
  };

  const pend = pendant(kit, {
    id: 'home:pendant', pos: at(1.6, 1.85, 0.3), drop: CEIL - 1.85, color: LIGHT.pendant.color,
    intensity: LIGHT.pendant.intensity, range: LIGHT.pendant.range, flicker: 'STEADY', zone: HOME_ZONE,
  });
  pend.setOn(true);
  dyn.add(pend.root);

  // a candle in a saucer at the near edge of the table: a small warm light on Ada (the key light below adds the rest)
  const candleAt = at(SPOUSE_SEAT.x, TABLE.top, TABLE.z0 + 0.1);
  kit.cyl(0.05, 0.05, 0.008, cream, { pos: [candleAt[0], candleAt[1] + 0.004, candleAt[2]], parent: shell, seg: 8 });
  kit.cyl(0.014, 0.014, 0.07, cream, { pos: [candleAt[0], candleAt[1] + 0.043, candleAt[2]], parent: shell, seg: 6 });
  const flame = kit.lamp({ r: 0.012, color: LIGHT.candle.color, shape: 'bulb' });
  flame.root.position.set(candleAt[0], candleAt[1] + 0.088, candleAt[2]);
  flame.setOn(true);
  dyn.add(flame.root);
  const candleHint: LightHint = {
    id: 'home:candle', pos: [candleAt[0], candleAt[1] + 0.11, candleAt[2]], color: LIGHT.candle.color, intensity: LIGHT.candle.intensity,
    range: LIGHT.candle.range, flicker: 'CANDLE', zone: HOME_ZONE,
  };

  // a soft warm key light in front of her face (the candle is too low to reach it): she must read as a person, not a silhouette
  const adaKey: LightHint = {
    id: 'home:adakey', pos: at(SPOUSE_SEAT.x - 0.1, 1.45, SPOUSE_SEAT.z + 0.85), color: 0xffc89a, intensity: 0.5,
    range: 2.1, flicker: 'STEADY', zone: HOME_ZONE,
  };

  // the hallway bulb hangs outside the zone: the switch does not reach it, and its light leaks under the door
  kit.cyl(0.006, 0.006, 0.4, black, { pos: at(-0.6, 2.4, 3.9), parent: dyn, seg: 4 });
  const hallLamp = kit.lamp({ r: 0.09, color: LIGHT.hall.color, shape: 'bulb' });
  hallLamp.root.position.set(...at(-0.6, 2.2, 3.9));
  hallLamp.setOn(true);
  dyn.add(hallLamp.root);
  const hallHint: LightHint = {
    id: 'home:hall', pos: at(-0.6, 2.15, 3.9), color: LIGHT.hall.color, intensity: LIGHT.hall.intensity,
    range: LIGHT.hall.range, flicker: 'STEADY',
  };

  return {
    statics,
    lights: [ceilingHint, pend.hint, candleHint, adaKey, hallHint],
    setSwitched(on: boolean) {
      pend.setOn(on);
      flame.setOn(on);
      lever.rotation.x = on ? -0.45 : 0.45;
      pilotOn.visible = on;
      pilotOff.visible = !on;
    },
  };
}
