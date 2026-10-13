/**
 * A 3D CRT monitor (optionally on a stand, with a keyboard tray in front of it). The glass is a canvas texture painted by
 * the screen owner; the keys are real meshes that sink when pressed. Built in local space: the monitor body centre sits at
 * (0, 1.6, -0.25), the glass faces +Z. The owner (stage or lobby) places `group` and raycasts `pickables`.
 */
import * as THREE from 'three';
import { psxMaterial } from '@/core/renderer/psxMaterial';
import { makeScreenCanvas, scanlineCanvas, SCREEN_H, SCREEN_W, type ScreenCanvas } from './crtArt';

const BEIGE = 0xb8ab86;
const DARK = 0x231f1a;
const TRAY = 0x6e6557;
const KEY = 0xd8cfb3;
const KEY_SPECIAL = 0xa99a7a;
const BRASS = 0xc9a040;
const KEY_U = 0.28;               // one key unit (metres)

/** Key tray rows: `code`, the `key` value the screen sees, and width in key units. Rows run back to front. */
export interface KeyDef { code: string; key: string; w?: number; special?: boolean }
const DIGITS = '1234567890'.split('').map((d, i): KeyDef => ({ code: `Digit${(i + 1) % 10}`, key: d }));
const row = (s: string): KeyDef[] => s.split('').map((c): KeyDef => ({ code: `Key${c}`, key: c.toLowerCase() }));
export const KEY_ROWS: KeyDef[][] = [
  DIGITS,
  row('QWERTYUIOP'),
  [...row('ASDFGHJKL'), { code: 'Enter', key: 'Enter', w: 2, special: true }],
  [...row('ZXCVBNM'), { code: 'Backspace', key: 'Backspace', w: 2, special: true }],
  [{ code: 'Space', key: ' ', w: 6, special: true }, { code: 'ArrowLeft', key: 'ArrowLeft', special: true },
    { code: 'ArrowUp', key: 'ArrowUp', special: true }, { code: 'ArrowDown', key: 'ArrowDown', special: true },
    { code: 'ArrowRight', key: 'ArrowRight', special: true }],
];

export interface KeyCap {
  readonly mesh: THREE.Mesh;
  readonly def: KeyDef;
  press: number;                  // 0..1, sinks and glows, decays
  baseY: number;
}

export interface CrtOpts { stand?: boolean; keyboard?: boolean }

export class CrtRig {
  readonly group = new THREE.Group();
  readonly screen: ScreenCanvas = makeScreenCanvas(SCREEN_W, SCREEN_H);
  /** The glass: raycast it for screen coordinates (uv, v = 0 at the bottom). */
  readonly glass: THREE.Mesh;
  readonly keys: KeyCap[] = [];
  private readonly scan = scanlineCanvas();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly led: THREE.Mesh;

  constructor(o: CrtOpts = {}) {
    const g = this.group;
    const stand = o.stand !== false;
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, c: number): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, h, d);
      this.geos.push(geo);
      const m = new THREE.Mesh(geo, psxMaterial({ color: c }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (stand) {
      solid(1.7, 0.12, 1.2, 0, 0.06, -0.1, DARK);
      solid(0.5, 0.42, 0.5, 0, 0.33, -0.2, DARK);
    }
    solid(3.3, 2.7, 1.6, 0, 1.6, -0.25, BEIGE);        // body
    solid(3.1, 2.5, 0.12, 0, 1.6, 0.6, DARK);           // bezel
    solid(0.5, 0.06, 0.06, 0, 0.26, 0.65, DARK);        // chin

    const glassGeo = new THREE.PlaneGeometry(2.7, 2.1);
    this.geos.push(glassGeo);
    this.glass = new THREE.Mesh(glassGeo, psxMaterial({ map: this.screen.tex, color: 0xffffff, lit: false, snap: false, affine: false, unique: true }));
    this.glass.position.set(0, 1.62, 0.67);
    g.add(this.glass);
    // scanlines over the glass
    this.scan.tex.repeat.set(1, 60);
    const scanGeo = new THREE.PlaneGeometry(2.7, 2.1);
    this.geos.push(scanGeo);
    const scan = new THREE.Mesh(scanGeo, psxMaterial({ map: this.scan.tex, color: 0xffffff, lit: false, transparent: true, depthWrite: false, snap: false, affine: false, unique: true }));
    scan.position.set(0, 1.62, 0.675);
    g.add(scan);

    const ledGeo = new THREE.SphereGeometry(0.035, 6, 4);
    this.geos.push(ledGeo);
    this.led = new THREE.Mesh(ledGeo, psxMaterial({ color: 0x5cff7a, lit: false, unique: true }));
    this.led.position.set(1.38, 0.45, 0.68);
    g.add(this.led);
    solid(0.14, 0.14, 0.08, 1.1, 0.45, 0.66, BRASS).rotation.x = Math.PI / 2;

    if (o.keyboard) this.buildKeys(solid);
  }

  private buildKeys(solid: (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => THREE.Mesh): void {
    solid(3.1, 0.14, 0.82, 0, 0.2, 1.3, TRAY);
    const keyY = 0.3;
    const zs = [1.55, 1.42, 1.29, 1.16, 1.03];
    KEY_ROWS.forEach((defs, r) => {
      const units = defs.reduce((s, d) => s + (d.w ?? 1), 0);
      let x = -(units * KEY_U) / 2;
      for (const def of defs) {
        const w = (def.w ?? 1) * KEY_U;
        const geo = new THREE.BoxGeometry(w * 0.86, 0.07, 0.1);
        this.geos.push(geo);
        const mat = psxMaterial({ color: def.special ? KEY_SPECIAL : KEY, unique: true }) as THREE.MeshLambertMaterial;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x + w / 2, keyY, zs[r]!);
        this.group.add(mesh);
        this.keys.push({ mesh, def, press: 0, baseY: keyY });
        x += w;
      }
    });
  }

  /** Meshes a raycast should test: the glass first, then the keycaps. */
  get pickables(): THREE.Object3D[] {
    return [this.glass, ...this.keys.map((k) => k.mesh)];
  }

  /** Press the keycap for `code` (visual only; the owner handles the input). */
  pressKey(code: string): void {
    const k = this.keys.find((c) => c.def.code === code);
    if (k) k.press = 1;
  }

  update(dt: number, time: number): void {
    for (const k of this.keys) {
      if (k.press > 0) k.press = Math.max(0, k.press - dt * 9);
      k.mesh.position.y = k.baseY - k.press * 0.035;
      const m = k.mesh.material as THREE.MeshLambertMaterial;
      m.emissive?.setRGB(k.press * 0.5, k.press * 0.36, k.press * 0.08);
    }
    // the LED breathes slightly, like a warm tube
    const l = 0.8 + 0.2 * Math.sin(time * 3.1);
    (this.led.material as THREE.MeshBasicMaterial).color.setRGB(0.36 * l, 1 * l, 0.48 * l);
  }

  dispose(): void {
    this.screen.tex.dispose();
    this.scan.tex.dispose();
    for (const g of this.geos) g.dispose();
  }
}
