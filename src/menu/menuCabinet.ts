/**
 * The jackpot cabinet around the menu die (menu-3d). Walnut shell, oxblood back wall, gold bezel, bulb chase,
 * two strip reels that spin on every roll, a pull lever, a marquee, a context screen under the glass, an info
 * screen that slides in front of the glass (CREDITS / QUIT), a halo behind the die and dust in the light.
 * Geometry is local to the cabinet group; the state places it and owns the die.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { makeCanvasTex, paintGlow, paintMarquee, paintPanel, paintReelStrip, paintWall, type CanvasTex } from './menuArt';

const WALNUT = 0x4a2412;
const BRASS = 0xc9a040;
const ENAMEL = 0x6a0c1c;
const GLASS_Z = 1.16;
export const DIE_CENTER = new THREE.Vector3(0, 0.05, 0.2);
/** Cabinet-local X of the two reels. */
const REEL_X = 1.85;

class Reel {
  readonly mesh: THREE.Mesh;
  private speed = 0;
  private angle = 0;
  private stopT = -1;
  private settle = false;
  private static readonly STEP = (Math.PI * 2) / 12;

  constructor(mat: THREE.Material, geo: THREE.BufferGeometry, x: number) {
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x, DIE_CENTER.y, 0.2);
  }

  /** Spin for `sec` seconds, then settle on the nearest symbol. */
  spin(sec: number): void {
    this.speed = 22;
    this.stopT = sec;
    this.settle = false;
  }

  update(dt: number): void {
    if (this.stopT > 0) {
      this.stopT -= dt;
      this.speed = Math.max(this.speed * Math.exp(-dt * 1.2), 9);
      if (this.stopT <= 0) this.settle = true;
    } else if (this.settle) {
      this.speed *= Math.exp(-dt * 9);
      const target = Math.round(this.angle / Reel.STEP) * Reel.STEP;
      this.angle += (target - this.angle) * (1 - Math.exp(-dt * 14));
      this.speed = 0;
      if (Math.abs(target - this.angle) < 1e-3) this.settle = false;
    } else {
      this.speed *= Math.exp(-dt * 6);
    }
    this.angle += this.speed * dt;
    this.mesh.rotation.x = this.angle;
  }
}

export interface Cabinet {
  readonly root: THREE.Group;
  readonly reels: Reel[];
  readonly glass: THREE.Mesh;
  readonly halo: THREE.Mesh;
  readonly lightsOn: THREE.Light[];
  readonly context: CanvasTex;
  readonly info: CanvasTex;
  readonly infoMesh: THREE.Mesh;
  readonly marquee: CanvasTex;
  /** Anchor points in cabinet-local space (world = root.position + local). */
  readonly anchors: { glassCenter: THREE.Vector3; pullLever: THREE.Vector3 };
  update(dt: number, t: number): void;
  spinReels(sec: number): void;
  pullLever(): void;
  /** Hide the glass (burst shatter) and bring it back on reset. */
  setGlassVisible(on: boolean): void;
  dispose(): void;
}

export function buildCabinet(): Cabinet {
  const root = new THREE.Group();
  const wood = (w: number, h: number, d: number, x: number, y: number, z: number, c = WALNUT): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), psxMaterial({ color: c }));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  // Shell: sides, top, plinth, back wall.
  wood(0.2, 4.7, 2.5, -2.6, -0.1, 0);
  wood(0.2, 4.7, 2.5, 2.6, -0.1, 0);
  wood(5.4, 0.16, 2.5, 0, 2.33, 0);
  wood(5.4, 0.3, 2.5, 0, -2.55, 0);
  const wall = makeCanvasTex(512, 512);
  wall.paint((ctx, w, h) => paintWall(ctx, w, h));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.7), psxMaterial({ map: wall.tex, color: 0xffffff }));
  back.position.set(0, -0.1, -1.2);
  root.add(back);

  // Marquee box on top.
  wood(5.4, 0.72, 0.3, 0, 2.75, 0.62, ENAMEL);
  const marquee = makeCanvasTex(512, 96);
  const marqueeMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 0.66), psxMaterial({ map: marquee.tex, color: 0xffffff, lit: false }));
  marqueeMesh.position.set(0, 2.75, 0.78);
  root.add(marqueeMesh);

  // Gold bezel around the glass.
  const glassW = 4.8, glassH = 3.7;
  wood(glassW + 0.3, 0.12, 0.12, 0, glassH / 2 + 0.02, GLASS_Z + 0.02, BRASS);
  wood(glassW + 0.3, 0.12, 0.12, 0, -glassH / 2 - 0.02, GLASS_Z + 0.02, BRASS);
  wood(0.12, glassH, 0.12, -glassW / 2 - 0.06, 0, GLASS_Z + 0.02, BRASS);
  wood(0.12, glassH, 0.12, glassW / 2 + 0.06, 0, GLASS_Z + 0.02, BRASS);

  // Glass: faint cyan sheen with two glare strips.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(glassW, glassH),
    psxMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.1, lit: false, depthWrite: false }),
  );
  glass.position.set(0, 0, GLASS_Z);
  root.add(glass);
  for (const [x, rot] of [[-1.3, 0.5], [1.5, 0.5]] as const) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.22, glassH * 1.3), psxMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, lit: false, depthWrite: false }));
    g.position.set(x, 0, GLASS_Z + 0.01);
    g.rotation.z = rot;
    root.add(g);
  }

  // Bulb chase on the bezel: 74 bulbs, each with its own unique material so it can flicker.
  const bulbGeo = new THREE.IcosahedronGeometry(0.045, 0);
  const bulbs: { mat: THREE.MeshBasicMaterial; i: number }[] = [];
  const addBulb = (x: number, y: number): void => {
    const mat = psxMaterial({ color: 0xffd060, lit: false, unique: true }) as THREE.MeshBasicMaterial;
    const m = new THREE.Mesh(bulbGeo, mat);
    m.position.set(x, y, GLASS_Z + 0.09);
    root.add(m);
    bulbs.push({ mat, i: bulbs.length });
  };
  for (let x = -2.4; x <= 2.41; x += 0.24) { addBulb(x, glassH / 2 + 0.07); addBulb(x, -glassH / 2 - 0.07); }
  for (let y = -glassH / 2 + 0.24; y < glassH / 2 - 0.1; y += 0.24) { addBulb(-glassW / 2 - 0.1, y); addBulb(glassW / 2 + 0.1, y); }

  // Reels (strip canvas 12 cells of 128 px; reel length 0.24 keeps each symbol square).
  const reelTex = makeCanvasTex(1536, 128);
  reelTex.paint((ctx, w, h) => paintReelStrip(ctx, w, h));
  const reelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.24, 12, 1, true);
  reelGeo.rotateZ(Math.PI / 2);
  const reelMat = psxMaterial({ map: reelTex.tex, color: 0xffffff, side: 'double', unique: true });
  const reels = [new Reel(reelMat, reelGeo, -REEL_X), new Reel(reelMat, reelGeo, REEL_X)];
  for (const r of reels) root.add(r.mesh);
  // reel housings
  for (const x of [-REEL_X, REEL_X]) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 16), psxMaterial({ color: BRASS }));
    frame.rotation.y = Math.PI / 2;
    frame.position.set(x, DIE_CENTER.y, 0.2);
    root.add(frame);
  }

  // Halo behind the die.
  const haloTex = makeCanvasTex(128, 128);
  haloTex.paint((ctx, w, h) => paintGlow(ctx, w, h, '255,190,90'));
  const haloMat = psxMaterial({ map: haloTex.tex, color: 0xffffff, transparent: true, opacity: 0.55, additive: true, lit: false, depthWrite: false, unique: true }) as THREE.MeshBasicMaterial;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), haloMat);
  halo.position.set(0, DIE_CENTER.y, -0.7);
  root.add(halo);

  // Lever on the right wall.
  const leverPivot = new THREE.Group();
  leverPivot.position.set(2.8, -0.55, 0.25);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.25, 8), psxMaterial({ color: BRASS }));
  rod.position.y = 0.62;
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), psxMaterial({ color: ENAMEL }));
  knob.position.y = 1.27;
  leverPivot.add(rod, knob);
  root.add(leverPivot);
  const leverBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 0.3), psxMaterial({ color: WALNUT }));
  leverBase.position.set(2.8, -0.55, 0.25);
  root.add(leverBase);

  // Context screen under the glass and info screen in front of it.
  const context = makeCanvasTex(640, 200);
  const contextMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.4), psxMaterial({ map: context.tex, color: 0xffffff, lit: false }));
  contextMesh.position.set(0, -2.25, GLASS_Z + 0.15);   // in front of the bottom bezel
  root.add(contextMesh);
  const info = makeCanvasTex(640, 360);
  const infoMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.25), psxMaterial({ map: info.tex, color: 0xffffff, lit: false, depthWrite: false, transparent: true }));
  infoMesh.position.set(0, 0.05, 1.95);
  infoMesh.visible = false;
  root.add(infoMesh);

  // Dust motes drifting in the light.
  const moteN = 140;
  const moteGeo = new THREE.BufferGeometry();
  const moteArr = new Float32Array(moteN * 3);
  const fract = (v: number): number => v - Math.floor(v);
  for (let i = 0; i < moteN; i++) {
    moteArr[i * 3] = fract(Math.sin(i * 12.9898) * 43758.5453) * 4.4 - 2.2;
    moteArr[i * 3 + 1] = fract(Math.sin(i * 78.233) * 43758.5453) * 3.4 - 1.7;
    moteArr[i * 3 + 2] = fract(Math.sin(i * 39.346) * 43758.5453) * 1.8 - 0.8;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(moteArr, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xffd98a, size: 0.035, transparent: true, opacity: 0.6, depthWrite: false }));
  root.add(motes);

  // Light inside the cabinet: warm key over the die, red bounce from below.
  const key = new THREE.PointLight(0xffc06a, 7, 9, 1.4);
  key.position.set(0, 0.6, 2.4);
  const bounce = new THREE.PointLight(0xff3050, 2.4, 7, 1.6);
  bounce.position.set(-1.5, -1.3, 1.6);
  root.add(key, bounce);

  let t = 0;
  let lever = 0;
  let leverT = -1;
  let marqueeT = 0;
  let flick = 1;
  const cab: Cabinet = {
    root,
    reels,
    glass,
    halo,
    lightsOn: [key, bounce],
    context,
    info,
    infoMesh,
    marquee,
    anchors: { glassCenter: new THREE.Vector3(0, 0, GLASS_Z), pullLever: new THREE.Vector3(2.8, -0.55, 0.25) },
    update(dt: number, time: number): void {
      t = time;
      for (const r of reels) r.update(dt);
      // bulbs: chase, quicker while the reels turn
      const spin = reels.some((r) => r.mesh.rotation.x !== 0) ? 1.8 : 1;
      for (const b of bulbs) {
        const v = 0.5 + 0.5 * Math.sin(t * 7 * spin - b.i * 0.42);
        b.mat.color.setRGB(0.35 + 0.65 * v, 0.2 + 0.45 * v, 0.05 + 0.1 * v);
      }
      // marquee flicker (repaint ~4 Hz)
      marqueeT += dt;
      if (marqueeT > 0.25) {
        marqueeT = 0;
        flick = Math.sin(t * 37.1) + Math.sin(t * 11.3) > -0.9 ? 1 : 0.2;   // deterministic flicker (no Math.random)
        marquee.paint((ctx, w, h) => paintMarquee(ctx, w, h, 'JACKID', flick));
      }
      haloMat.opacity = 0.42 + 0.14 * Math.sin(t * 2.1);
      motes.rotation.y = t * 0.02;
      // lever: pull then return with a bounce
      if (leverT >= 0) {
        leverT += dt;
        const k = Math.min(1, leverT / 0.7);
        lever = k < 0.3 ? (k / 0.3) * 0.9 : Math.max(0, 0.9 * (1 - (k - 0.3) / 0.7)) * (1 + 0.25 * Math.sin((k - 0.3) * 18));
        if (k >= 1) { leverT = -1; lever = 0; }
      }
      leavePivot(lever);
    },
    spinReels(sec: number): void { for (const r of reels) r.spin(sec); },
    pullLever(): void { leverT = 0; },
    setGlassVisible(on: boolean): void { glass.visible = on; },
    dispose(): void {
      reelTex.tex.dispose();
      wall.tex.dispose();
      marquee.tex.dispose();
      context.tex.dispose();
      info.tex.dispose();
      haloTex.tex.dispose();
      bulbGeo.dispose();
    },
  };
  function leavePivot(a: number): void { leverPivot.rotation.x = a; }
  // initial paint of the screens
  marquee.paint((ctx, w, h) => paintMarquee(ctx, w, h, 'JACKID', 1));
  context.paint((ctx, w, h) => paintPanel(ctx, w, h, { title: '', lines: [] }));
  info.paint((ctx, w, h) => paintPanel(ctx, w, h, { title: '', lines: [] }));
  return cab;
}
