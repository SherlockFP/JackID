/**
 * THE APARTMENT, more furniture (world/home): the FRIDGE in the south-east corner (with a banana and a coffee cup on top) and the DESK with the
 * old CRT PC under the north wall (the screen glows; the economy lane opens its market on the `computer` station), and the lacquered wall
 * unit (sektsiya) with the TV, the glassware and the crystal bowl on the west wall. Static parts go to
 * `shell`, the screen and its glow to `dyn`. The stations are wired in index.ts (`fridge` -> src/game/food.ts, `computer` -> the economy lane).
 */
import * as THREE from 'three';
import type { LightHint } from '../sys/arch';
import { buildFoodProp } from '../props/food';
import { at, DESK, DESK_CHAIR, FRIDGE, HOME_ZONE, WALL_UNIT } from './config';
import { doilyTex } from '../props/surfaces';
import type { RoomCtx, Statics } from './room';
import { presets } from '@/kit/presets';

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
  const M = presets(kit.tex);
  const enamel = M.enamel(0xcfc8b4, 0.6);
  const seam = kit.mat({ color: kit.pal.black });
  const beige = kit.mat({ color: 0xb8ad94 });
  const beigeDark = kit.mat({ color: 0x8c826c });
  const wood = M.wood('walnut');
  const trim = M.wood('dark');

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

  // ── the wall unit (docs/ART.md "Identity"): a lacquered sektsiya on the west wall between the nightstand and the door corner.
  // A glass cabinet of good glasses and the crystal bowl, the small TV in the open niche with a doily on it, a wardrobe door, low cupboards.
  {
    const { x0: ux0, x1: ux1, z0: uz0, z1: uz1, h: uh } = WALL_UNIT, front = ux1;
    const lacquer = M.woodStain(0x5a2a16), dark = M.woodStain(0x2a140a), brass = M.brass();
    slab(ux0, 0.04, uz0, ux1 - 0.02, 0.72, uz1, lacquer);                                        // the low cupboards' body
    slab(ux0, 0.72, uz0, ux0 + 0.02, uh, uz1, lacquer);                                          // back
    for (const [z0, z1] of [[uz0, uz0 + 0.03], [uz1 - 0.03, uz1]]) slab(ux0, 0.72, z0, ux1 - 0.02, uh, z1, lacquer);   // sides
    slab(ux0, uh - 0.03, uz0, ux1 - 0.02, uh, uz1, lacquer);                                     // top
    slab(ux0 + 0.02, 0, uz0 + 0.02, ux1 - 0.04, 0.04, uz1 - 0.02, seam);                          // plinth, set back
    slab(ux0, uh, uz0 - 0.01, ux1 + 0.01, uh + 0.04, uz1 + 0.01, dark);                           // cornice
    for (let i = 0; i < 3; i++) {                                                                 // three low cupboard doors with pulls
      const z0 = uz0 + 0.03 + i * ((uz1 - uz0 - 0.06) / 3), z1 = z0 + (uz1 - uz0 - 0.06) / 3 - 0.02;
      slab(front - 0.02, 0.08, z0, front, 0.7, z1, lacquer);
      slab(front, 0.6, (z0 + z1) / 2 - 0.05, front + 0.015, 0.62, (z0 + z1) / 2 + 0.05, brass);
    }
    slab(front - 0.02, 0.72, uz0, front + 0.005, 0.75, uz1, dark);                               // the waist rail
    // the glass cabinet (north bay): a pale back, two shelves of glasses, the crystal bowl
    const gz0 = uz0 + 0.04, gz1 = uz0 + 0.52;
    slab(ux0 + 0.01, 0.76, gz0, ux0 + 0.02, uh - 0.05, gz1, kit.mat({ color: 0xc8b890 }));
    const crystal = kit.mat({ color: 0xd0e4ec, lit: false });
    for (const [sy, n] of [[1.12, 5], [1.48, 4]] as const) {
      slab(ux0 + 0.02, sy - 0.015, gz0, front - 0.04, sy, gz1, kit.mat({ color: 0x9ab8c0, lit: false }));
      for (let k = 0; k < n; k++) kit.cyl(0.024, 0.018, 0.09, crystal, { pos: at(ux0 + 0.2, sy + 0.045, gz0 + 0.06 + k * ((gz1 - gz0 - 0.12) / (n - 1))), parent: shell, seg: 6 });
    }
    kit.lathe([[0, 0], [0.04, 0], [0.05, 0.02], [0.11, 0.07], [0.12, 0.09]], 10, crystal, { pos: at(ux0 + 0.22, 0.75, (gz0 + gz1) / 2), parent: shell });   // the crystal bowl
    // a plain tinted pane: the kit's glint tile smears into a white blob over a door this size (docs/ART.md, Materials)
    const pane = kit.plane(gz1 - gz0, uh - 0.85, kit.mat({ color: 0x9ab8c8, lit: false, transparent: true, opacity: 0.14 }), { pos: at(front - 0.01, (0.78 + uh - 0.05) / 2, (gz0 + gz1) / 2), rot: [0, 90, 0], parent: dyn, shade: false });
    pane.renderOrder = 2;
    slab(ux0, 0.75, gz1, front, uh - 0.03, gz1 + 0.03, lacquer);                                 // the divider
    // the open niche (middle bay): the small TV with a doily, a lace runner under it
    const nz0 = gz1 + 0.03, nz1 = nz0 + 0.6, tz = (nz0 + nz1) / 2;
    slab(ux0 + 0.02, 0.75, nz0, ux0 + 0.03, 1.55, nz1, dark);                                     // the niche's dark back
    slab(ux0 + 0.02, 1.55, nz0, front, 1.58, nz1, dark);                                          // its top shelf
    slab(ux0 + 0.06, 0.75, tz - 0.25, ux0 + 0.42, 1.12, tz + 0.25, kit.mat({ color: 0x3a3a38 }));  // the TV
    slab(ux0 + 0.42, 0.79, tz - 0.21, ux0 + 0.425, 1.07, tz + 0.12, kit.mat({ color: 0x1c2a34, lit: false }));   // its dark screen
    for (const dy of [0.85, 0.93]) slab(ux0 + 0.42, dy, tz + 0.16, ux0 + 0.43, dy + 0.04, tz + 0.2, seam);   // two knobs
    kit.plane(0.36, 0.36, kit.mat({ map: doilyTex(kit.tex), color: 0xffffff, alphaTest: 0.5 }), { pos: at(ux0 + 0.24, 1.126, tz), rot: [-90, 0, 0], parent: shell, shade: false });
    kit.box(0.02, 0.06, 0.06, kit.mat({ color: 0x8a6a3a }), { pos: at(ux0 + 0.24, 1.158, tz + 0.05), parent: shell });       // a little brass horse on the doily
    kit.lathe([[0, 0], [0.03, 0], [0.05, 0.06], [0.025, 0.16], [0.035, 0.2]], 8, kit.mat({ color: 0x2a5a8a }), { pos: at(ux0 + 0.22, 1.58, tz + 0.1), parent: shell });   // a cobalt vase
    // the wardrobe bay (south): a closed body, a tall door with a pull
    slab(ux0, 0.75, nz1, front - 0.02, uh - 0.03, uz1 - 0.03, lacquer);
    slab(front - 0.02, 0.77, nz1 + 0.02, front, uh - 0.03, uz1 - 0.03, lacquer);
    slab(front, 1.25, nz1 + 0.05, front + 0.015, 1.45, nz1 + 0.07, brass);
    statics.push(solid([ux0, 0, uz0, ux1, uh, uz1]));
  }

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
