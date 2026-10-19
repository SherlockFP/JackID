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
import { doilyTex, tvGlassTex } from '../props/surfaces';
import { cayGlass } from '../props/identity';
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
  // Walnut carcass and mahogany veneer doors (the kit's two wood presets: the grain is the texture), a glass-fronted bay of good glasses and
  // the crystal bowl, the small CRT TV in the open niche with a lace doily on it, a cobalt vase above, a wardrobe door, low cupboards.
  // Glass is a faint tint, never the kit's glint tile (it smears into a light shaft over a door this size); every decal takes a polygon offset.
  {
    const { x0: ux0, x1: ux1, z0: uz0, z1: uz1, h: uh } = WALL_UNIT, front = ux1;
    const veneer = M.wood('mahogany'), brass = M.brass(), chrome = M.chrome();
    const tint = (color: number, opacity: number): THREE.Material => kit.mat({ color, transparent: true, opacity, depthWrite: false, side: 'double' });
    /** A decal plane (a screen, a doily): `kit.decal` carries the polygon offset; it stands at (x, y, z), turned `rot` degrees. */
    const decal = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, rot: [number, number, number], alphaTest = 0.5): void => {
      const d = kit.decal({ tex, w, h, alphaTest });
      d.position.set(...at(x, y, z));
      d.rotation.set(...rot.map((r) => (r * Math.PI) / 180) as [number, number, number]);
      shell.add(d);
    };
    const gz0 = uz0 + 0.03, gz1 = uz0 + 0.52;                      // the glass bay (north)
    const nz0 = gz1 + 0.03, nz1 = nz0 + 0.6, tz = (nz0 + nz1) / 2;  // the niche (middle); the wardrobe is south of it

    // the carcass: plinth, low body, a lipped deck, back, sides, top and a cornice
    slab(ux0 + 0.02, 0, uz0 + 0.02, front - 0.06, 0.08, uz1 - 0.02, trim);
    slab(ux0, 0.08, uz0, front - 0.03, 0.72, uz1, wood);
    slab(ux0, 0.72, uz0, front + 0.01, 0.76, uz1, trim);
    slab(ux0, 0.76, uz0, ux0 + 0.02, uh, uz1, wood);
    slab(ux0, 0.76, uz0, front, uh - 0.03, uz0 + 0.03, wood);
    slab(ux0, 0.76, uz1 - 0.03, front, uh - 0.03, uz1, wood);
    slab(ux0, uh - 0.03, uz0, front, uh, uz1, wood);
    slab(ux0, uh, uz0 - 0.01, front + 0.02, uh + 0.04, uz1 + 0.01, trim);
    slab(ux0 + 0.02, 0.76, gz1, front, uh - 0.03, gz1 + 0.03, wood);                              // the divider

    // three low cupboard doors: a veneer leaf, a walnut panel 1 cm proud of it and a brass bar
    const dw = (uz1 - uz0 - 0.06) / 3;
    for (let i = 0; i < 3; i++) {
      const z0 = uz0 + 0.03 + i * dw, z1 = z0 + dw - 0.02, zm = (z0 + z1) / 2;
      slab(front - 0.03, 0.1, z0, front - 0.005, 0.7, z1, veneer);
      slab(front - 0.005, 0.15, z0 + 0.05, front + 0.005, 0.6, z1 - 0.05, wood);
      slab(front - 0.005, 0.64, zm - 0.05, front + 0.02, 0.66, zm + 0.05, brass);
    }

    // the glass bay: a warm veneer back so the pale glass shows, three walnut shelves, a lamp bar on the back
    slab(ux0 + 0.02, 0.76, gz0, ux0 + 0.03, uh - 0.03, gz1, veneer);
    for (const sy of [1.0, 1.3, 1.6]) slab(ux0 + 0.03, sy - 0.018, gz0, front - 0.035, sy, gz1, wood);
    slab(ux0 + 0.03, 1.78, gz0 + 0.05, ux0 + 0.035, 1.835, gz1 - 0.05, kit.mat({ color: 0xf0dcb0, lit: false }));
    const gm = (gz0 + gz1) / 2, glassX = ux0 + 0.2;
    const crystal = tint(0xc8e4f0, 0.72);
    kit.lathe([[0, 0], [0.045, 0], [0.045, 0.008], [0.012, 0.022], [0.012, 0.05], [0.04, 0.07], [0.085, 0.1], [0.11, 0.135], [0.104, 0.135], [0.08, 0.11], [0.03, 0.08], [0, 0.075]], 10, crystal, { pos: at(glassX, 0.76, gm), parent: shell, shade: false });   // the crystal bowl on its foot
    for (let k = 0; k < 4; k++) { const [cx, cy, cz] = at(ux0 + 0.27, 1.0, gz0 + 0.085 + k * 0.105); cayGlass(kit, shell, cx, cy, cz); }   // tulip çay glasses on saucers
    for (let k = 0; k < 3; k++) {                                                                 // goblets
      kit.lathe([[0, 0], [0.03, 0], [0.03, 0.004], [0.006, 0.012], [0.006, 0.075], [0.03, 0.105], [0.033, 0.15], [0.028, 0.15], [0.024, 0.11], [0, 0.082]], 8, tint(0xd0e4ee, 0.7), { pos: at(glassX, 1.3, gz0 + 0.1 + k * 0.145), parent: shell, shade: false });
    }
    [0x7a2a24, 0x2a4a3a, 0xa08850, 0x2a3a5a, 0x6a4a2a].forEach((c, k) => {                        // a short row of books on the top shelf
      kit.box(0.14, 0.2 - (k % 2) * 0.03, 0.035, kit.mat({ color: c }), { pos: at(ux0 + 0.18, 1.6 + 0.1 - (k % 2) * 0.015, gz0 + 0.06 + k * 0.04), parent: shell });
    });

    // the glass door: a veneer frame round a faint tint and two thin edge lights
    const dx0 = front - 0.03, dx1 = front - 0.005, dy0 = 0.78, dy1 = 1.9, fw = 0.035, rail = 0.06;
    slab(dx0, dy0, gz0, dx1, dy1, gz0 + fw, veneer);
    slab(dx0, dy0, gz1 - fw, dx1, dy1, gz1, veneer);
    slab(dx0, dy0, gz0 + fw, dx1, dy0 + rail, gz1 - fw, veneer);
    slab(dx0, dy1 - rail, gz0 + fw, dx1, dy1, gz1 - fw, veneer);
    slab(front - 0.005, 1.15, gz1 - fw + 0.009, front + 0.02, 1.4, gz1 - fw + 0.021, brass);
    const pw = gz1 - gz0 - 2 * fw, ph = dy1 - dy0 - 2 * rail, py = (dy0 + dy1) / 2, paneX = front - 0.0175;
    const pane = kit.plane(pw, ph, kit.mat({ color: 0x9ab8c8, lit: false, transparent: true, opacity: 0.1, depthWrite: false }), { pos: at(paneX, py, gm), rot: [0, 90, 0], parent: dyn, shade: false });
    pane.renderOrder = 2;
    const edge = kit.mat({ color: 0xdff0f6, lit: false, additive: true, transparent: true, opacity: 0.2, unique: true });
    edge.polygonOffset = true; edge.polygonOffsetFactor = -2; edge.polygonOffsetUnits = -2;
    for (const [w, h, y, z] of [[0.012, ph, py, gz0 + fw + 0.006], [pw, 0.012, dy1 - rail - 0.006, gm]] as const) {
      const lit = kit.plane(w, h, edge, { pos: at(paneX + 0.001, y, z), rot: [0, 90, 0], parent: dyn, shade: false });
      lit.renderOrder = 3;
    }

    // the niche: a dark back, a shelf above the TV, the small CRT (dark walnut case, a plastic bezel, glass, chrome trim, knobs, a grille)
    slab(ux0 + 0.02, 0.76, nz0, ux0 + 0.03, uh - 0.03, nz1, trim);
    slab(ux0 + 0.03, 1.55, nz0, front - 0.01, 1.58, nz1, trim);
    const tvx0 = ux0 + 0.06, tvx1 = ux0 + 0.4, tvTop = 1.12, bz = tz - 0.225, bezel = M.plastic(0x2e2c2a);
    slab(tvx0, 0.76, tz - 0.24, tvx1, tvTop, tz + 0.24, wood);
    slab(tvx1, 0.78, bz, tvx1 + 0.012, 1.1, tz + 0.225, bezel);
    const sx = tvx1 + 0.012, sw = 0.28, sh = 0.21, sy = 0.94, sc = tz + 0.065;                    // the glass: 28 x 21 cm, left of the controls
    decal(tvGlassTex(kit.tex), sw, sh, sx + 0.003, sy, sc, [0, 90, 0], 0);
    for (const [y0, y1, z0, z1] of [[sy + sh / 2, sy + sh / 2 + 0.012, sc - sw / 2 - 0.012, sc + sw / 2 + 0.012], [sy - sh / 2 - 0.012, sy - sh / 2, sc - sw / 2 - 0.012, sc + sw / 2 + 0.012],
      [sy - sh / 2, sy + sh / 2, sc - sw / 2 - 0.012, sc - sw / 2], [sy - sh / 2, sy + sh / 2, sc + sw / 2, sc + sw / 2 + 0.012]]) slab(sx, y0, z0, sx + 0.006, y1, z1, chrome);
    for (const ky of [1.03, 0.96]) kit.cyl(0.014, 0.014, 0.018, chrome, { pos: at(sx + 0.009, ky, tz - 0.155), rot: [0, 0, 90], parent: shell, seg: 8 });
    slab(sx, 0.8, tz - 0.205, sx + 0.004, 0.9, tz - 0.105, M.grille());
    decal(doilyTex(kit.tex), 0.3, 0.3, ux0 + 0.23, tvTop + 0.004, tz, [-90, 0, 0]);               // the lace on top
    slab(ux0 + 0.2, tvTop + 0.004, tz + 0.04, ux0 + 0.24, tvTop + 0.032, tz + 0.1, kit.mat({ color: 0x8a6a3a }));    // a little brass horse on the doily: body, neck
    slab(ux0 + 0.21, tvTop + 0.032, tz + 0.09, ux0 + 0.23, tvTop + 0.06, tz + 0.11, kit.mat({ color: 0x8a6a3a }));
    kit.lathe([[0, 0], [0.03, 0], [0.05, 0.06], [0.026, 0.15], [0.02, 0.19], [0.034, 0.215]], 10, kit.mat({ color: 0x2a5a8a }), { pos: at(ux0 + 0.22, 1.58, tz + 0.1), parent: shell });   // a cobalt vase

    // the wardrobe bay (south): a closed body, a tall veneer door with two walnut panels and a pull
    slab(ux0, 0.76, nz1, front - 0.03, uh - 0.03, uz1 - 0.03, wood);
    slab(front - 0.03, 0.78, nz1 + 0.02, front - 0.005, uh - 0.05, uz1 - 0.04, veneer);
    slab(front - 0.005, 0.86, nz1 + 0.06, front + 0.005, 1.3, uz1 - 0.08, wood);
    slab(front - 0.005, 1.38, nz1 + 0.06, front + 0.005, 1.84, uz1 - 0.08, wood);
    slab(front - 0.005, 1.2, nz1 + 0.035, front + 0.02, 1.45, nz1 + 0.048, brass);
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
