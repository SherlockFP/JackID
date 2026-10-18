/**
 * THE APARTMENT, more furniture (world/home): the FRIDGE in the south-east corner (with a banana and a coffee cup on top) and the DESK with the
 * old CRT PC under the north wall (the screen glows; the economy lane opens its market on the `computer` station). Static parts go to
 * `shell`, the screen and its glow to `dyn`. The stations are wired in index.ts (`fridge` -> src/game/food.ts, `computer` -> the economy lane).
 */
import * as THREE from 'three';
import type { LightHint } from '../sys/arch';
import { buildFoodProp } from '../props/food';
import { at, DESK, DESK_CHAIR, FRIDGE, HOME_ZONE } from './config';
import type { RoomCtx, Statics } from './room';

export interface FurnitureParts {
  readonly statics: Statics[];
  readonly lights: LightHint[];
  /** Per frame: the PC's cursor blinks on the sim clock `t` (seconds). */
  update(dt: number, t: number): void;
}

const solid = (b: readonly number[]): Statics => ({
  box: new THREE.Box3(new THREE.Vector3(...at(b[0], b[1], b[2])), new THREE.Vector3(...at(b[3], b[4], b[5]))),
  tag: 'solid',
});

export function buildFurniture(c: RoomCtx): FurnitureParts {
  const { kit, shell, dyn } = c;
  const statics: Statics[] = [];
  const slab = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: THREE.Material): void => {
    kit.box(x1 - x0, y1 - y0, z1 - z0, m, { pos: at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), parent: shell });
  };
  const enamel = kit.mat({ color: 0xcfc8b4 });
  const seam = kit.mat({ color: kit.pal.black });
  const beige = kit.mat({ color: 0xb8ad94 });
  const beigeDark = kit.mat({ color: 0x8c826c });
  const wood = kit.mat({ color: kit.pal.wood });
  const trim = kit.mat({ color: kit.pal.woodDark });

  // ── the fridge: a cream box, a seam between freezer and fridge, a black handle, snacks on top ──
  const [fx0, , fz0, fx1, fy1, fz1] = FRIDGE.box;
  slab(fx0, 0.04, fz0, fx1, fy1, fz1, enamel);
  slab(fx0 - 0.02, 0.06, fz0 + 0.02, fx0, fy1 - 0.04, fz1 - 0.02, enamel);           // the door panel, a hair proud of the body
  slab(fx0 - 0.025, 1.17, fz0 + 0.02, fx0, 1.2, fz1 - 0.02, seam);                     // freezer / fridge seam
  slab(fx0 - 0.05, 0.85, fz0 + 0.07, fx0 - 0.02, 1.12, fz0 + 0.1, seam);               // handle, lower door
  slab(fx0 - 0.05, 1.26, fz0 + 0.07, fx0 - 0.02, 1.52, fz0 + 0.1, seam);               // handle, freezer door
  slab(fx0 + 0.04, 0, fz0 + 0.04, fx1 - 0.04, 0.04, fz1 - 0.04, seam);                  // kick plinth
  const banana = buildFoodProp(kit, 'banana');
  banana.position.set(...at(2.62, fy1, 1.85));
  banana.rotation.y = 0.5;
  shell.add(banana);
  const cup = buildFoodProp(kit, 'coffee');
  cup.position.set(...at(2.78, fy1, 2.12));
  shell.add(cup);
  statics.push(solid(FRIDGE.box));

  // ── the desk: a top on four legs with a drawer front, the old PC on it ──
  const { x0, x1, z0, z1, top } = DESK;
  slab(x0, top - 0.04, z0, x1, top, z1, wood);
  for (const lx of [x0 + 0.04, x1 - 0.04]) for (const lz of [z0 + 0.04, z1 - 0.04]) slab(lx - 0.03, 0, lz - 0.03, lx + 0.03, top - 0.04, lz + 0.03, trim);
  slab(x0 + 0.1, top - 0.16, z1 - 0.02, x0 + 0.6, top - 0.05, z1, trim);                 // drawer front
  slab(x0 + 0.3, top - 0.12, z1, x0 + 0.4, top - 0.1, z1 + 0.015, kit.mat({ color: kit.pal.brass }));
  statics.push(solid([x0, 0, z0, x1, top, z1]));

  const mx = 1.18, mz = -2.22;                                                             // monitor centre on the desk
  slab(mx - 0.22, top, mz - 0.2, mx + 0.22, top + 0.04, mz + 0.2, beigeDark);            // foot
  slab(mx - 0.23, top + 0.04, mz - 0.22, mx + 0.23, top + 0.4, mz + 0.14, beige);        // the CRT body (deep at the back)
  slab(mx - 0.2, top + 0.04, mz - 0.16, mx + 0.2, top + 0.38, mz + 0.2, beige);          // the bezel block
  const screen = kit.screen({ w: 0.33, h: 0.25, px: [96, 72], bezel: kit.pal.black, glow: 0.6, scanlines: true });
  screen.mesh.position.set(...at(mx, top + 0.22, mz + 0.202));
  dyn.add(screen.mesh);
  slab(x1 - 0.5, top, mz - 0.22, x1 - 0.18, top + 0.4, mz + 0.2, beige);                 // the tower
  slab(x1 - 0.46, top + 0.3, mz + 0.2, x1 - 0.22, top + 0.33, mz + 0.205, beigeDark);    // floppy slot
  slab(mx - 0.2, top, mz + 0.34, mx + 0.2, top + 0.02, mz + 0.5, beigeDark);             // keyboard
  slab(mx + 0.3, top, mz + 0.38, mx + 0.36, top + 0.02, mz + 0.46, beigeDark);           // mouse
  const mug = buildFoodProp(kit, 'coffee');
  mug.position.set(...at(x0 + 0.12, top, mz + 0.3));
  shell.add(mug);

  const chair = kit.chair({ h: 0.46, seat: kit.pal.leather, wood: kit.pal.woodDark });
  chair.position.set(...at(DESK_CHAIR.x, 0, DESK_CHAIR.z));
  chair.rotation.y = Math.PI;
  shell.add(chair);
  statics.push(solid([DESK_CHAIR.x - 0.2, 0, DESK_CHAIR.z - 0.2, DESK_CHAIR.x + 0.2, 0.5, DESK_CHAIR.z + 0.2]));

  // the screen: a dim green terminal with a blinking cursor (the market itself is the economy lane's overlay)
  let blink = -1;
  const paint = (cursor: boolean): void => {
    screen.draw((g) => {
      g.fillStyle = '#04100a'; g.fillRect(0, 0, 96, 72);
      g.fillStyle = '#58f0a0';
      g.font = '8px monospace';
      g.fillText('JACKID-OS 1.0', 6, 12); // i18n-ok: the prop's screen
      g.fillText('MARKET  BANK', 6, 26); // i18n-ok
      g.fillText('FOOD DELIVERY', 6, 38); // i18n-ok
      g.fillText(cursor ? 'C:\> _' : 'C:\>', 6, 56);
    });
  };
  paint(true);
  const glow: LightHint = {
    id: 'home:pc', pos: at(mx, top + 0.3, mz + 0.5), color: 0x60e0a0, intensity: 0.22, range: 1.8, flicker: 'STEADY', zone: HOME_ZONE,
  };

  return {
    statics,
    lights: [glow],
    update(_dt, t) {
      const on = Math.floor(t * 1.2) % 2 === 0;
      const k = on ? 1 : 0;
      if (k !== blink) { blink = k; paint(on); }
    },
  };
}
