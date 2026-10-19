/**
 * Behind the menu cabinet: a dark high-floor room with a floor-to-ceiling window onto a night city far below. Painted PSX
 * style: a sky, three skyline layers at different depths (each a low-res canvas quad that slides a little against the
 * others with the mouse), two haze bands, thin dark mullions, a faint reflection of the room on the glass and a dark
 * glossy floor. A few windows flicker, a red aircraft light blinks on a far tower. Dark and low contrast on purpose: the
 * gold cabinet stays the brightest thing. Cosmetic and deterministic (the seeded Rng and the menu clock, never
 * Math.random). Every material is unlit, unfogged and unsnapped.
 */
import * as THREE from 'three';
import { createRng } from '@/core/rng';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { makeCanvasTex, paintGlow, paintHaze, paintSheen, paintSky, paintSkyline, paintVignette, type SkylineOpts, type Tower } from './menuArt';

export interface Background {
  readonly root: THREE.Group;
  update(t: number, cam: THREE.PerspectiveCamera): void;
}

const FLOOR_Y = -2.85;
const GLASS_Z = -3;       // the window wall: mullions and the glass reflection
const VIGNETTE_Z = -2.2;
const TEX_W = 1024, TEX_H = 256;   // every city texture is 4 : 1
const MARGIN = 1.25;      // a layer is a quarter taller than the view, so mouse parallax never shows an edge

const city = (seed: string, o: Omit<SkylineOpts, 'seed'>): SkylineOpts => ({ seed, ...o });
// Far to near: smaller, hazier, fewer lights -> bigger, darker. `tall` towers sit just outside the cabinet's shadow on 16:9 and 21:9.
const FAR = city('menu-far', { top: [0.45, 0.55], width: [10, 26], body: '#17142a', cell: 4, lit: 0.35, tall: [{ x: 0.38, w: 14, top: 0.37 }, { x: 0.63, w: 12, top: 0.4 }] });
const MID = city('menu-mid', { top: [0.53, 0.62], width: [18, 44], body: '#0e0c1c', cell: 4, lit: 0.45, tall: [{ x: 0.61, w: 22, top: 0.42 }, { x: 0.37, w: 26, top: 0.47 }] });
const NEAR = city('menu-near', { top: [0.58, 0.64], width: [40, 100], body: '#07060e', cell: 6, lit: 0.5, tall: [{ x: 0.31, w: 60, top: 0.48 }, { x: 0.7, w: 70, top: 0.5 }] });

export function buildBackground(): Background {
  const root = new THREE.Group();
  const mat = (o: Parameters<typeof psxMaterial>[0]): THREE.MeshBasicMaterial =>
    psxMaterial({ lit: false, fog: false, snap: false, affine: false, depthWrite: false, ...o, unique: true }) as THREE.MeshBasicMaterial;
  const unit = new THREE.PlaneGeometry(1, 1);
  const quad = (w: number, h: number, x: number, y: number, z: number, o: Parameters<typeof psxMaterial>[0]): THREE.Mesh => {
    const m = new THREE.Mesh(unit, mat(o));
    m.scale.set(w, h, 1);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  // ── the city: layers of unit height, 4 : 1, scaled to fill the view each frame ───────────────────────────────────
  // `par` is the mouse parallax (fraction of the layer height per metre of camera travel).
  interface Layer { g: THREE.Group; z: number; zoom: number; par: number }
  const layers: Layer[] = [];
  const layer = (map: THREE.Texture, z: number, zoom: number, par: number, order: number, o: Parameters<typeof psxMaterial>[0] = {}): Layer => {
    const g = new THREE.Group();
    const plane = new THREE.Mesh(unit, mat({ map, transparent: true, ...o }));
    plane.scale.set(4, 1, 1);
    plane.renderOrder = order;   // negative: behind everything the cabinet draws
    g.add(plane);
    root.add(g);
    const l = { g, z, zoom, par };
    layers.push(l);
    return l;
  };
  const tex = (w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture => {
    const t = makeCanvasTex(w, h);
    t.paint(paint);
    return t.tex;
  };
  const skyline = (o: SkylineOpts): { tex: THREE.Texture; towers: Tower[] } => {
    const t = makeCanvasTex(TEX_W, TEX_H);
    let towers: Tower[] = [];
    t.paint((c, w, h) => { towers = paintSkyline(c, w, h, o); });
    return { tex: t.tex, towers };
  };

  layer(tex(512, 128, paintSky), -34, 1, 0, -20);
  const far = skyline(FAR), mid = skyline(MID), near = skyline(NEAR);
  layer(far.tex, -28, 1, 0.012, -19);
  layer(tex(16, 64, (c, w, h) => paintHaze(c, w, h, 0.5)), -26, 1, 0.02, -18, { color: 0x5a4a78, opacity: 0.4 });
  layer(mid.tex, -22, 1.25, 0.03, -17);
  layer(tex(16, 64, (c, w, h) => paintHaze(c, w, h, 0.6)), -20, 1.25, 0.04, -16, { color: 0x4a4068, opacity: 0.3 });
  layer(near.tex, -16, 1.6, 0.07, -15);

  // flickering windows: a window of a visible tower that goes on and off, in four phases so they never beat together
  const flick = [0xffc070, 0xffd890, 0x9ccbff, 0xffb060].map((color) => mat({ color, transparent: true, opacity: 0 }));
  const flickRate = [0.9, 0.55, 0.7, 1.3], flickPhase = [0, 2.1, 4.2, 5.5];
  const rng = createRng('menu-flicker');
  const addFlickers = (l: Layer, src: SkylineOpts, towers: Tower[], n: number): void => {
    const seen = towers.filter((t) => Math.abs(t.x + t.w / 2 - TEX_W / 2) < TEX_W * 0.19 && t.top < TEX_H * 0.8);
    const win = src.cell >> 1;
    for (let i = 0; i < n && seen.length; i++) {
      const t = rng.pick(seen);
      const px = t.x + 2 + rng.int(0, Math.max(0, ((t.w - 3) / src.cell | 0) - 1)) * src.cell;
      const py = t.top + src.cell + rng.int(0, Math.max(0, ((TEX_H * 0.8 - t.top) / src.cell | 0) - 1)) * src.cell;
      const m = new THREE.Mesh(unit, flick[i % flick.length]);
      m.renderOrder = -14;
      m.scale.setScalar((win * 1.2) / TEX_H);
      m.position.set(((px + win / 2) / TEX_W - 0.5) * 4, 0.5 - (py + win / 2) / TEX_H, 0.001);
      l.g.add(m);
    }
  };
  addFlickers(layers[1], FAR, far.towers, 8);
  addFlickers(layers[3], MID, mid.towers, 12);
  addFlickers(layers[5], NEAR, near.towers, 6);

  // aircraft light: a slow red blink on the tip of the right mid tower (the first forced tower of MID)
  const mast = mid.towers[mid.towers.length - 2];
  const glow = tex(64, 64, (c, w, h) => paintGlow(c, w, h, '255,60,50'));
  const beacon = new THREE.Mesh(unit, mat({ map: glow, color: 0xff3328, transparent: true, additive: true, opacity: 0 }));
  beacon.renderOrder = -14;
  beacon.scale.setScalar(0.04);
  beacon.position.set(((mast.x + mast.w / 2) / TEX_W - 0.5) * 4, 0.5 - mast.peak / TEX_H, 0.002);
  layers[3].g.add(beacon);

  // ── the room: mullions, ceiling, floor, the glass reflection, a vignette ────────────────────────────────────────
  const dark = { color: 0x040308, depthWrite: true } as const;
  for (const x of [-10.8, -5.2, 5.2, 10.8]) quad(0.22, 40, x, 0, GLASS_Z, dark);
  quad(80, 0.22, 0, 3.9, GLASS_Z, dark);                // transom
  quad(80, 10, 0, 10, GLASS_Z, dark);                   // ceiling line, above y = 5
  quad(80, 0.5, 0, FLOOR_Y + 0.25, GLASS_Z, dark);      // skirting
  const floor = quad(80, 12, 0, FLOOR_Y, 3, { color: 0x0b0710, depthWrite: true });
  floor.rotation.x = -Math.PI / 2;
  const sheenTex = tex(256, 128, paintSheen);
  quad(30, 12, 0, 0, GLASS_Z + 0.05, { map: sheenTex, color: 0x6a6a9a, transparent: true, additive: true, opacity: 0.07 }).renderOrder = -12;
  const warm = tex(64, 64, (c, w, h) => paintGlow(c, w, h, '255,176,80'));
  const pool = quad(13, 6, 0, FLOOR_Y + 0.02, 1.2, { map: warm, transparent: true, additive: true, opacity: 0.14 });
  pool.rotation.x = -Math.PI / 2;
  const vignette = quad(1, 1, 0, 0, VIGNETTE_Z, { map: tex(128, 128, paintVignette), transparent: true });
  vignette.renderOrder = -11;

  const dir = new THREE.Vector3();
  const fract = (v: number): number => v - Math.floor(v);
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
      flick.forEach((m, i) => { m.opacity = 0.85 * Math.min(1, Math.max(0, Math.sin(t * flickRate[i] + flickPhase[i]) * 2.2)); });
      const ph = fract(t / 2.4);
      (beacon.material as THREE.MeshBasicMaterial).opacity = 0.05 + (ph < 0.14 ? Math.sin((ph / 0.14) * Math.PI) : 0);
      const h = 2 * (cam.position.z - VIGNETTE_Z) * tanV * 1.06;
      vignette.scale.set(h * (cam.aspect || 1), h, 1);
      vignette.position.set(cam.position.x, cam.position.y, VIGNETTE_Z);
    },
  };
}
