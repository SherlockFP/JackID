/**
 * Behind the menu cabinet: a dark high-floor room with a floor-to-ceiling window onto a rainy night city far below. Painted
 * PSX style from low-res canvas quads, no lights. The city is four skyline layers at different depths (far, mid-far, mid,
 * near) with haze between them, a far road whose car lights slide, a TV tower and a mosque on the far layer, a crane on a
 * mid tower, and a flickering KASINO sign on a rooftop; windows pulse and switch on and off and a red light blinks on the
 * crane and the TV tower. On the glass: two scrolling rain layers, beads and sliding drops, and every 20-40 s a faint
 * lightning flash (the sky and clouds, a bolt, the room's edges; none under Calm or Reduce flashing). In the room's edges:
 * velvet curtains, the back of an armchair, a warm off-screen lamp glow on the left, the frame's wet rim with a few glints.
 * Dark and low contrast on purpose: the gold cabinet stays the brightest thing. Cosmetic and deterministic (seeded Rng and
 * the menu clock, never Math.random or Date.now). Every material is unlit, unfogged and unsnapped.
 */
import * as THREE from 'three';
import { createRng, type Rng } from '@/core/rng';
import { app } from '@/core/app';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import {
  makeCanvasTex, paintBolt, paintCars, paintChair, paintClouds, paintCrane, paintCurtain, paintDrop, paintGlow, paintHaze, paintMosque,
  paintNeon, paintRain, paintRoad, paintRoomEdge, paintSheen, paintSky, paintSkyline, paintTvTower, paintVignette, paintWetGlass,
  type SkylineOpts, type Tower,
} from './menuArt';

export interface Background {
  readonly root: THREE.Group;
  update(t: number, cam: THREE.PerspectiveCamera): void;
}

const FLOOR_Y = -2.85;
const GLASS_Z = -3;       // the window wall: mullions and the glass reflection
const PANE_Z = -3.05;     // the rain, wet glass and drops sit just behind the frame, so the mullions, sill and ceiling clip them
const VIGNETTE_Z = -2.2;
const CURTAIN_Z = -1.2, CHAIR_Z = -0.6;
const TEX_W = 1024, TEX_H = 256;   // every city texture is 4 : 1
const MARGIN = 1.25;      // a layer is a quarter taller than the view, so mouse parallax never shows an edge
const ASPECT = 16 / 9;
const ZOOM = { far: 1, midfar: 1.12, road: 1.2, mid: 1.25, near: 1.6 } as const;

/** Texel x / y of a spot on a city layer, from fractions of a 16:9 view (so a landmark clears the cabinet at every aspect). */
const tx = (f: number, zoom: number): number => Math.round((0.5 + ((f - 0.5) * ASPECT) / (4 * MARGIN * zoom)) * TEX_W);
const ty = (f: number, zoom: number): number => Math.round((0.5 + (f - 0.5) / (MARGIN * zoom)) * TEX_H);
const ROAD_ROW = ty(0.585, ZOOM.road);
const SIGN_X = tx(0.185, ZOOM.mid);

const city = (seed: string, o: Omit<SkylineOpts, 'seed'>): SkylineOpts => ({ seed, ...o });
// Far to near: smaller, hazier, fewer lights -> bigger, darker. `tall` towers sit just outside the cabinet's shadow on 16:9 and 21:9.
const FAR = city('menu-far', { top: [0.45, 0.55], width: [10, 26], body: '#17142a', cell: 4, lit: 0.35, tall: [{ x: 0.63, w: 12, top: 0.4 }] });
const MIDFAR = city('menu-midfar', { top: [0.47, 0.58], width: [14, 34], body: '#120f24', cell: 4, lit: 0.4 });
// MID: the first tall tower carries the crane, the third the rooftop sign (see `forced`)
const MID = city('menu-mid', { top: [0.56, 0.64], width: [18, 44], body: '#0e0c1c', cell: 4, lit: 0.45, tall: [{ x: 0.61, w: 22, top: 0.42 }, { x: 0.37, w: 26, top: 0.47 }, { x: SIGN_X / TEX_W, w: 38, top: 0.575 }] });
const NEAR = city('menu-near', { top: [0.58, 0.64], width: [40, 100], body: '#07060e', cell: 6, lit: 0.5, tall: [{ x: 0.31, w: 60, top: 0.48 }, { x: 0.7, w: 70, top: 0.5 }] });
/** The i-th forced (`tall`) tower of a painted skyline: they are appended after the random ones. */
const forced = (towers: Tower[], o: SkylineOpts, i: number): Tower => towers[towers.length - (o.tall?.length ?? 0) + i];

/** Lightning: a hard strike, a dip, a second stroke, a slow afterglow (`e` = seconds since the strike). 0..1 */
const strike = (e: number): number =>
  e < 0 ? 0 : e < 0.07 ? 1 : e < 0.13 ? 0.2 : e < 0.22 ? 0.75 : e < 1.1 ? 0.3 * (1 - (e - 0.22) / 0.88) ** 2 : 0;
const fract = (v: number): number => v - Math.floor(v);

export function buildBackground(): Background {
  const root = new THREE.Group();
  const mat = (o: Parameters<typeof psxMaterial>[0]): THREE.MeshBasicMaterial =>
    psxMaterial({ lit: false, fog: false, snap: false, affine: false, depthWrite: false, ...o, unique: true }) as THREE.MeshBasicMaterial;
  const unit = new THREE.PlaneGeometry(1, 1);
  const quad = (w: number, h: number, x: number, y: number, z: number, o: Parameters<typeof psxMaterial>[0], order = 0): THREE.Mesh => {
    const m = new THREE.Mesh(unit, mat(o));
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    m.renderOrder = order;
    root.add(m);
    return m;
  };
  const tex = (w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture => {
    const t = makeCanvasTex(w, h);
    t.paint(paint);
    return t.tex;
  };
  const setOpacity = (m: THREE.Mesh, v: number): void => { (m.material as THREE.MeshBasicMaterial).opacity = v; m.visible = v > 0.004; };

  // ── the city: layers of unit height, 4 : 1, scaled to fill the view each frame ───────────────────────────────────
  // `par` is the mouse parallax (fraction of the layer height per metre of camera travel); `order` the render order
  // (negative: behind everything the cabinet draws).
  interface Layer { g: THREE.Group; z: number; zoom: number; par: number; order: number; mat: THREE.MeshBasicMaterial }
  const layers: Layer[] = [];
  const layer = (map: THREE.Texture, z: number, zoom: number, par: number, order: number, o: Parameters<typeof psxMaterial>[0] = {}): Layer => {
    const g = new THREE.Group();
    const m = mat({ map, transparent: true, ...o });
    const plane = new THREE.Mesh(unit, m);
    plane.scale.set(4, 1, 1);
    plane.renderOrder = order;
    g.add(plane);
    root.add(g);
    const l = { g, z, zoom, par, order, mat: m };
    layers.push(l);
    return l;
  };
  /** Put `m` on a layer at a texel rectangle (centre `cx`, `cy`; size `w`, `h`). */
  const place = (l: Layer, m: THREE.Mesh, cx: number, cy: number, w: number, h: number, order = 0.5): void => {
    m.scale.set((w / TEX_W) * 4, h / TEX_H, 1);
    m.position.set((cx / TEX_W - 0.5) * 4, 0.5 - cy / TEX_H, 0.001);
    m.renderOrder = l.order + order;
    l.g.add(m);
  };
  const skyline = (o: SkylineOpts, extra?: (c: CanvasRenderingContext2D, towers: Tower[], h: number) => void): { tex: THREE.Texture; towers: Tower[] } => {
    const t = makeCanvasTex(TEX_W, TEX_H);
    let towers: Tower[] = [];
    t.paint((c, w, h) => { towers = paintSkyline(c, w, h, o); extra?.(c, towers, h); });
    return { tex: t.tex, towers };
  };

  let tvTip = { x: 0, y: 0 }, craneTip = { x: 0, y: 0 }, signAt = { x: 0, y: 0 };
  const far = skyline(FAR);
  const midfar = skyline(MIDFAR);
  const mid = skyline(MID, (c, towers, h) => {
    const mast = forced(towers, MID, 0), sign = forced(towers, MID, 2);
    craneTip = paintCrane(c, mast.x + mast.w - 5, mast.top, MID.body);
    signAt = { x: sign.x + 5, y: sign.top - 13 };
    // the landmarks stand on this layer (the hazes behind it would wash them out): a TV tower in the left pane, a mosque in the
    // right pane between the mullion and the crane tower
    tvTip = paintTvTower(c, tx(0.1, ZOOM.mid), ty(0.2, ZOOM.mid), h, MID.body);
    paintMosque(c, tx(0.808, ZOOM.mid), ty(0.6, ZOOM.mid), h, MID.body);
  });
  const near = skyline(NEAR);
  const hazeTex = (peak: number): THREE.Texture => tex(16, 64, (c, w, h) => paintHaze(c, w, h, peak));

  const sky = layer(tex(512, 128, paintSky), -34, 1, 0, -30);
  const farL = layer(far.tex, -28, ZOOM.far, 0.012, -29);
  const hazeA = layer(hazeTex(0.5), -26.5, 1.05, 0.02, -28, { color: 0x5a4a78, opacity: 0.4 });
  const midfarL = layer(midfar.tex, -25, ZOOM.midfar, 0.022, -27);
  const roadL = layer(tex(TEX_W, TEX_H, (c, w, h) => paintRoad(c, w, h, ROAD_ROW)), -23.8, ZOOM.road, 0.026, -26);
  const hazeB = layer(hazeTex(0.55), -23, 1.2, 0.028, -25, { color: 0x3a3058, opacity: 0.22 });
  const midL = layer(mid.tex, -22, ZOOM.mid, 0.03, -24);
  const hazeC = layer(hazeTex(0.6), -20, ZOOM.mid, 0.04, -23, { color: 0x4a4068, opacity: 0.3 });
  const nearL = layer(near.tex, -16, ZOOM.near, 0.07, -22);
  const hazes = [hazeA, hazeB, hazeC].map((l) => ({ m: l.mat, base: l.mat.opacity }));
  const lit = [farL, midfarL, roadL, midL, nearL].map((l) => l.mat);   // brightened a little by a flash

  // car lights on the far road: two lanes that tile and scroll, white head lamps and red tail lamps
  const lane = (dir: 1 | -1, row: number, speed: number, seed: string): void => {
    const t = tex(256, 1, (c, w, h) => paintCars(c, w, h, dir, seed));
    t.repeat.set(4, 1);
    const m = new THREE.Mesh(unit, mat({ map: t, transparent: true, additive: true, opacity: 0.95, scroll: [dir < 0 ? speed : -speed, 0] }));
    place(roadL, m, TEX_W / 2, row + 0.5, TEX_W, 1);
  };
  lane(-1, ROAD_ROW - 1, 0.03, 'menu-cars-a');
  lane(1, ROAD_ROW, 0.045, 'menu-cars-b');

  // windows: some pulse (four phases so they never beat together), some switch on and off every so often
  const flick = [0xffc070, 0xffd890, 0x9ccbff, 0xffb060].map((color) => mat({ color, transparent: true, opacity: 0 }));
  const flickRate = [0.9, 0.55, 0.7, 1.3], flickPhase = [0, 2.1, 4.2, 5.5];
  const rng = createRng('menu-flicker');
  /** `n` window-sized quads on windows of the towers that show beside the cabinet (the grid of `src`). */
  const windowsOf = (l: Layer, src: SkylineOpts, towers: Tower[], n: number, rg: Rng, material: (i: number) => THREE.Material): THREE.Mesh[] => {
    const maxY = TEX_H * (0.5 + 0.21 / (MARGIN * l.zoom));   // the sill hides what is lower
    const seen = towers.filter((t) => {
      const d = (Math.abs((t.x + t.w / 2) / TEX_W - 0.5) * 4 * MARGIN * l.zoom) / ASPECT;   // distance from the view centre, in 16:9 widths
      return d > 0.2 && d < 0.66 && t.top < maxY - 2 * src.cell;
    });
    const win = src.cell >> 1, out: THREE.Mesh[] = [];
    for (let i = 0; i < n && seen.length; i++) {
      const t = rg.pick(seen);
      const px = t.x + 2 + rg.int(0, Math.max(0, (((t.w - 3) / src.cell) | 0) - 1)) * src.cell;
      const py = t.top + src.cell + rg.int(0, Math.max(0, (((maxY - t.top) / src.cell) | 0) - 1)) * src.cell;
      const m = new THREE.Mesh(unit, material(i));
      place(l, m, px + win / 2, py + win / 2, win * 1.2, win * 1.2);
      out.push(m);
    }
    return out;
  };
  windowsOf(farL, FAR, far.towers, 8, rng, (i) => flick[i % flick.length]);
  windowsOf(midfarL, MIDFAR, midfar.towers, 5, rng, (i) => flick[i % flick.length]);
  windowsOf(midL, MID, mid.towers, 12, rng, (i) => flick[i % flick.length]);
  windowsOf(nearL, NEAR, near.towers, 6, rng, (i) => flick[i % flick.length]);
  const warmOn = mat({ color: 0xffd08a, transparent: true, opacity: 0.85 }), coolOn = mat({ color: 0x9ccbff, transparent: true, opacity: 0.8 });
  const toggles = ([[farL, FAR, far, 4], [midfarL, MIDFAR, midfar, 4], [midL, MID, mid, 5]] as const).flatMap(([l, src, c, n]) =>
    windowsOf(l, src, c.towers, n, rng, (i) => (i % 3 ? warmOn : coolOn)).map((m) => ({ m, T: rng.float(14, 40), ph: rng.next(), duty: rng.float(0.35, 0.7) })));

  // red aircraft lights: a slow blink on the crane and on the TV tower, out of step
  const glow = tex(64, 64, (c, w, h) => paintGlow(c, w, h, '255,60,50'));
  const beacons = ([[midL, craneTip, 2.4, 0], [midL, tvTip, 3.1, 0.37]] as const).map(([l, tip, period, phase]) => {
    const m = new THREE.Mesh(unit, mat({ map: glow, color: 0xff3328, transparent: true, additive: true, opacity: 0 }));
    place(l, m, tip.x + 0.5, tip.y, 0.04 * TEX_H, 0.04 * TEX_H);
    m.position.z = 0.002;
    return { m, period, phase };
  });

  // the far rooftop sign: a dark board, a pink glow, the lit letters, and one letter (the S) that stutters on its own
  const signPart = (part: 'board' | 'word' | 'broken'): THREE.Texture => tex(28, 13, (c, w, h) => paintNeon(c, w, h, part));
  const sx = signAt.x + 14, sy = signAt.y + 6.5;
  const signGlow = new THREE.Mesh(unit, mat({ map: tex(64, 64, (c, w, h) => paintGlow(c, w, h, '255,50,110')), transparent: true, additive: true, opacity: 0 }));
  const word = new THREE.Mesh(unit, mat({ map: signPart('word'), transparent: true, additive: true, opacity: 0.9 }));
  const broken = new THREE.Mesh(unit, mat({ map: signPart('broken'), transparent: true, additive: true, opacity: 0.9 }));
  place(midL, new THREE.Mesh(unit, mat({ map: signPart('board'), transparent: true })), sx, sy, 28, 13, 0.45);
  place(midL, signGlow, sx, sy - 2, 28 * 2.6, 13 * 3, 0.46);
  place(midL, word, sx, sy, 28, 13, 0.5);
  place(midL, broken, sx, sy, 28, 13, 0.5);

  // ── the glass: far and near rain, wet beads, sliding drops ───────────────────────────────────────────────────────
  /** A scrolling rain quad (additive): a `tile`-unit streak texture repeated over w x h, falling `speed` tiles/s, tilted. */
  const rain = (z: number, w: number, h: number, tile: number, n: number, len: readonly [number, number], speed: number, tilt: number, order: number, opacity: number, seed: string): THREE.Mesh => {
    const t = tex(256, 256, (c, a, b) => paintRain(c, a, b, seed, n, len));
    t.repeat.set(w / tile, h / tile);
    const m = quad(w, h, 0, 1, z, { map: t, additive: true, opacity, scroll: [0, speed] }, order);
    m.rotation.z = tilt;
    return m;
  };
  const rainFar = rain(-9, 60, 30, 24, 90, [5, 12], 0.28, 0.1, -21.5, 0.12, 'menu-rain-far');
  const wet = quad(42, 21, 0, 1.3, PANE_Z, { map: tex(512, 256, paintWetGlass), transparent: true, additive: true, opacity: 0.4 }, -21);
  const rainNear = rain(PANE_Z, 70, 20, 15.9, 120, [6, 16], 0.5, 0.14, -20.5, 0.2, 'menu-rain-near');
  const dropMat = mat({ map: tex(3, 16, paintDrop), additive: true, opacity: 0.8 });
  const dr = createRng('menu-drops');
  const drops = Array.from({ length: 12 }, () => {
    const m = new THREE.Mesh(unit, dropMat);
    m.scale.set(0.2, 1, 1);
    m.renderOrder = -20;
    root.add(m);
    return { m, x: (dr.chance(0.5) ? -1 : 1) * dr.float(4.4, 13), T: dr.float(16, 34), ph: dr.next(), n: dr.int(4, 8) };
  });

  // ── the room: mullions, ceiling, floor, the glass reflection, the wet rim, the lamp, the edges ───────────────────
  const dark = { color: 0x040308, depthWrite: true } as const;
  for (const x of [-10.8, -5.2, 5.2, 10.8]) quad(0.22, 40, x, 0, GLASS_Z, dark);
  quad(80, 0.22, 0, 3.9, GLASS_Z, dark);                // transom
  quad(80, 10, 0, 10, GLASS_Z, dark);                   // ceiling line, above y = 5
  quad(80, 0.5, 0, FLOOR_Y + 0.25, GLASS_Z, dark);      // skirting
  const floor = quad(80, 12, 0, FLOOR_Y, 3, { color: 0x0b0710, depthWrite: true });
  floor.rotation.x = -Math.PI / 2;
  quad(30, 12, 0, 0, GLASS_Z + 0.05, { map: tex(256, 128, paintSheen), color: 0x6a6a9a, transparent: true, additive: true, opacity: 0.07 }, -12);
  const warm = tex(64, 64, (c, w, h) => paintGlow(c, w, h, '255,176,80'));
  const pool = quad(13, 6, 0, FLOOR_Y + 0.02, 1.2, { map: warm, transparent: true, additive: true, opacity: 0.14 });
  pool.rotation.x = -Math.PI / 2;
  const lampPool = quad(9, 4, -6.8, FLOOR_Y + 0.02, 0.3, { map: warm, transparent: true, additive: true, opacity: 0.11 });
  lampPool.rotation.x = -Math.PI / 2;
  const vignette = quad(1, 1, 0, 0, VIGNETTE_Z, { map: tex(128, 128, paintVignette), transparent: true }, -11);

  // the frame's wet rim (the edge that faces the room's centre) and a few glints that catch the city
  const rimMat = mat({ color: 0x8a7ac8, transparent: true, additive: true, opacity: 0.1 });
  for (const x of [-10.7, -5.1, 5.1, 10.7]) {
    const m = new THREE.Mesh(unit, rimMat);
    m.scale.set(0.03, 40, 1);
    m.position.set(x, 0, GLASS_Z + 0.05);
    m.renderOrder = -12.5;
    root.add(m);
  }
  const glintMat = mat({ color: 0xcfd8ff, transparent: true, additive: true, opacity: 0.45 });
  const gl = createRng('menu-glints');
  const glints = Array.from({ length: 6 }, (_, i) => {
    const m = new THREE.Mesh(unit, glintMat);
    m.scale.set(0.06, 0.28, 1);
    m.position.set([-5.1, 5.1, -10.7, 10.7, -5.1, 5.1][i], gl.float(-2, 3.4), GLASS_Z + 0.05);
    m.renderOrder = -12.5;
    root.add(m);
    return { m, rate: gl.float(0.5, 0.9), ph: gl.float(0, 6.28) };
  });

  // curtains and the armchair hug the edges of the view (laid out each frame from the camera), the lamp glow lights the left
  const curtainL = quad(1, 1, 0, 0, CURTAIN_Z, { map: tex(32, 128, (c, w, h) => paintCurtain(c, w, h, 1)), transparent: true }, -10);
  const curtainR = quad(1, 1, 0, 0, CURTAIN_Z, { map: tex(32, 128, (c, w, h) => paintCurtain(c, w, h, -1)), transparent: true }, -10);
  const lamp = quad(1, 1, 0, 0, CURTAIN_Z + 0.1, { map: warm, transparent: true, additive: true, opacity: 0.15 }, -9.9);
  const chair = quad(1, 1, 0, 0, CHAIR_Z, { map: tex(40, 48, paintChair), transparent: true }, -9.8);
  const edge = quad(1, 1, 0, 0, VIGNETTE_Z + 0.1, { map: tex(64, 64, paintRoomEdge), transparent: true, additive: true, opacity: 0 }, -10.9);

  // ── lightning: the sky wash, the lit clouds and a bolt live on the sky layer; the edge light is the quad above ──────
  const skyFx = (map: THREE.Texture, o: Parameters<typeof psxMaterial>[0], w: number, h: number, y: number, order: number): THREE.Mesh => {
    const m = new THREE.Mesh(unit, mat({ map, transparent: true, additive: true, opacity: 0, ...o }));
    m.scale.set(w, h, 1);
    m.position.set(0, y, 0.001);
    m.renderOrder = order;
    sky.g.add(m);
    return m;
  };
  const wash = skyFx(hazeTex(0.5), { color: 0x5a6ab8 }, 4, 1, 0, -29.9);
  const clouds = skyFx(tex(512, 64, paintClouds), { color: 0x8091ea }, 4, 0.45, 0.12, -29.8);
  const bolt = skyFx(tex(32, 96, paintBolt), {}, 0.11, 0.33, 0.2, -29.7);
  const boltRng = createRng('menu-bolt');
  let nextBolt = boltRng.float(20, 40), boltAt = -99;

  const dir = new THREE.Vector3();
  return {
    root,
    update(t, cam): void {
      const tanV = Math.tan((cam.fov * Math.PI) / 360);
      cam.getWorldDirection(dir);
      for (const l of layers) {
        // fill the view at the layer's depth (centred on where the camera looks), then slide by the mouse parallax
        const d = cam.position.z - l.z;
        const h = 2 * d * tanV * MARGIN * l.zoom;
        const k = d / Math.max(0.2, -dir.z);
        l.g.scale.setScalar(h);
        l.g.position.set(cam.position.x + dir.x * k - cam.position.x * l.par * h, cam.position.y + dir.y * k - cam.position.y * l.par * h * 0.5, l.z);
      }

      // lightning: seeded gaps of 20-40 s, a four-level flash; none while Calm or Reduce flashing is on
      const s = app.save?.data.settings;
      const still = Boolean(s && (s.calm || s.reduceFlashing));
      if (t >= nextBolt) {
        boltAt = nextBolt;
        nextBolt += boltRng.float(20, 40);
        bolt.position.x = (boltRng.chance(0.5) ? -1 : 1) * boltRng.float(0.46, 0.64);
      }
      const F = still ? 0 : Math.round(strike(t - boltAt) * 4) / 4;
      setOpacity(wash, 0.3 * F);
      setOpacity(clouds, 0.5 * F);
      setOpacity(bolt, F >= 0.75 ? 0.95 : 0);
      setOpacity(edge, 0.3 * F);
      for (const m of lit) m.color.setRGB(1 + 0.25 * F, 1 + 0.3 * F, 1 + 0.45 * F);
      (curtainL.material as THREE.MeshBasicMaterial).color.setRGB(1 + 0.5 * F, 1 + 0.6 * F, 1 + 0.9 * F);
      (curtainR.material as THREE.MeshBasicMaterial).color.copy((curtainL.material as THREE.MeshBasicMaterial).color);
      (chair.material as THREE.MeshBasicMaterial).color.copy((curtainL.material as THREE.MeshBasicMaterial).color);
      (wet.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 + 1.2 * F);
      (rainNear.material as THREE.MeshBasicMaterial).opacity = 0.2 * (0.85 + 0.15 * Math.sin(t * 0.3)) * (1 + F);
      (rainFar.material as THREE.MeshBasicMaterial).opacity = 0.12 * (0.85 + 0.15 * Math.sin(t * 0.21 + 1)) * (1 + F);
      rimMat.opacity = 0.1 + 0.5 * F;
      glintMat.opacity = 0.45 + 0.5 * F;

      // the city: pulsing and switching windows, blinking lights, drifting haze
      flick.forEach((m, i) => { m.opacity = 0.85 * Math.min(1, Math.max(0, Math.sin(t * flickRate[i] + flickPhase[i]) * 2.2)); });
      for (const w of toggles) w.m.visible = fract(t / w.T + w.ph) < w.duty;
      for (const b of beacons) {
        const ph = fract(t / b.period + b.phase);
        setOpacity(b.m, 0.05 + (ph < 0.14 ? Math.sin((ph / 0.14) * Math.PI) : 0));
      }
      hazes.forEach((h, i) => { h.m.opacity = h.base * (0.9 + 0.1 * Math.sin(t * 0.23 + i * 2)); });
      // the sign: steady glow with rare buzzing dropouts; the S stutters on its own (all steady under Reduce flashing)
      const steady = Boolean(s?.reduceFlashing);
      const buzz = steady ? 1 : Math.sin(t * 2.1) * Math.sin(t * 5.3 + 1) * Math.sin(t * 11.7 + 2) > 0.62 ? 0.25 : 1;
      const stutter = steady ? 1 : Math.sin(t * 3.7) * Math.sin(t * 9.1 + 0.5) > 0.35 ? 0.15 : 1;
      setOpacity(word, 0.9 * buzz);
      setOpacity(broken, 0.9 * buzz * stutter);
      setOpacity(signGlow, 0.32 * buzz * (0.55 + 0.45 * stutter));

      // the glass: sliding drops (slide, pause, slide), sparkles on the rim
      for (const d of drops) {
        const u = fract(t / d.T + d.ph) * d.n, k = Math.floor(u), f = Math.min(1, (u - k) * 2.2);
        d.m.position.set(d.x + Math.sin(k * 1.7 + d.ph * 9) * 0.05, 5.1 - (7.6 * (k + f * f * (3 - 2 * f))) / d.n + 0.4, PANE_Z + 0.004);
      }
      for (const g of glints) g.m.visible = Math.sin(t * g.rate + g.ph) > 0.9;
      (lamp.material as THREE.MeshBasicMaterial).opacity = 0.15 * (1 + 0.05 * Math.sin(t * 1.7));

      // the screen-locked room: vignette, edge light, curtains, chair and the lamp glow, sized from the camera
      const at = (z: number): { cx: number; cy: number; hh: number; hw: number } => {
        const d = cam.position.z - z, k = d / Math.max(0.2, -dir.z), hh = d * tanV;
        return { cx: cam.position.x + dir.x * k, cy: cam.position.y + dir.y * k, hh, hw: hh * (cam.aspect || 1) };
      };
      const v = 2 * (cam.position.z - VIGNETTE_Z) * tanV * 1.06;
      vignette.scale.set(v * (cam.aspect || 1), v, 1);
      vignette.position.set(cam.position.x, cam.position.y, VIGNETTE_Z);
      const e = at(VIGNETTE_Z + 0.1);
      edge.scale.set(e.hh * 2.12 * (cam.aspect || 1), e.hh * 2.12, 1);
      edge.position.set(e.cx, e.cy, VIGNETTE_Z + 0.1);
      const c = at(CURTAIN_Z), cl = 0.3 * c.hh, cr = 0.26 * c.hh;
      curtainL.scale.set(cl, c.hh * 2.12, 1);
      curtainL.position.set(c.cx - c.hw + cl / 2 - 0.03 * c.hh, c.cy, CURTAIN_Z);
      curtainR.scale.set(cr, c.hh * 2.12, 1);
      curtainR.position.set(c.cx + c.hw - cr / 2 + 0.03 * c.hh, c.cy, CURTAIN_Z);
      lamp.scale.setScalar(c.hh * 2.2);
      lamp.position.set(c.cx - c.hw, c.cy + 0.15 * c.hh, CURTAIN_Z + 0.1);
      const ch = at(CHAIR_Z), cw = 0.4 * ch.hh;
      chair.scale.set(cw, cw * 1.2, 1);
      chair.position.set(ch.cx + ch.hw - cw / 2 - 0.1 * ch.hh, FLOOR_Y + cw * 0.6, CHAIR_Z);
    },
  };
}
