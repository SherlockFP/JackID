/**
 * The multiplayer CRT stage: one 3D monitor that rises in front of the dice cabinet while the server browser or the host
 * form is open. Screens are swapped on the same glass. While the monitor is up, input is taken in the capture phase (the
 * menu's die never sees the clicks or keys), and the stage is drawn as the renderer's overlay pass over the menu scene.
 */
import * as THREE from 'three';
import { app } from '@/core/app';
import { CrtRig, type KeyCap } from './crt';
import { staticBars, SCREEN_H, SCREEN_W } from './crtArt';

/** What the stage shows. Screens keep their own state; `open` / `close` run when the stage shows / drops them. */
export interface Screen {
  /** Draw into the canvas (called every frame while shown). `time` is real seconds. */
  paint(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void;
  key(e: StageKey): void;
  click(x: number, y: number): void;
  move?(x: number, y: number): void;
  open?(): void;
  close?(): void;
}
/** A keyboard event as the screens see it: a real DOM key event, or a key pressed on the 3D keyboard. */
export interface StageKey { code: string; key: string; repeat: boolean; preventDefault(): void }

const BASE_Y = -1.3;
const STAGE_Z = 2.4;
const STAGE_SCALE = 0.86;
const RISE_FROM = -4.6;
const WARM_S = 0.32;

const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3);

function sfx(name: string, vol: number): void {
  app.audio.play(name, { bus: 'ui', vol });
}

class Stage {
  readonly scene = new THREE.Scene();
  readonly rig = new CrtRig({ stand: true, keyboard: true });
  private screen: Screen | null = null;
  private wantOpen = false;
  private rise = 0;
  private vel = 0;
  private warm = 1;
  private time = 0;
  private attached = false;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hoverKey: KeyCap | null = null;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff0d0, 0x2a0a18, 1.0));
    const key = new THREE.PointLight(0xffe0a8, 8, 12, 1.4);
    key.position.set(0, 0.8, 4.2);
    this.scene.add(key);
    this.scene.add(this.rig.group);
    this.rig.group.visible = false;
  }

  /** The stage is drawn this frame (open, or still rising / falling). */
  get visible(): boolean { return this.wantOpen || this.rise > 0.002; }
  get isOpen(): boolean { return this.wantOpen; }

  /** Show `s` on the monitor: powers it on when closed, otherwise swaps the picture with a burst of static. */
  show(s: Screen): void {
    if (this.screen === s && this.wantOpen) return;
    const prev = this.screen;
    if (prev && prev !== s) prev.close?.();
    this.screen = s;
    s.open?.();
    this.warm = 0;
    if (!this.wantOpen) {
      this.wantOpen = true;
      this.attach();
      app.input.setMode('ui');
      sfx('powerUp', 0.9);
    } else {
      sfx('stamp', 0.7);
    }
  }

  /** Power the monitor off and drop the screen. */
  close(): void {
    if (!this.wantOpen) return;
    this.wantOpen = false;
    this.hoverKey = null;
    const s = this.screen;
    this.screen = null;
    this.detach();
    s?.close?.();
    sfx('powerDown', 0.9);
    if (app.state === 'menu') app.input.setMode('menu');
  }

  /** Advance the spring, the power-on warm-up and the monitor's pose, then paint the current screen. */
  update(dt: number): void {
    this.time += dt;
    const target = this.wantOpen ? 1 : 0;
    this.vel += ((target - this.rise) * 150 - this.vel * 17) * dt;
    this.rise += this.vel * dt;
    if (!this.wantOpen && this.rise < 0) { this.rise = 0; this.vel = 0; }
    this.warm = Math.min(1, this.warm + dt / WARM_S);
    const k = easeOutCubic(this.rise);
    this.rig.group.visible = this.visible;
    this.rig.group.position.set(0, BASE_Y + (1 - k) * RISE_FROM, STAGE_Z);
    this.rig.group.scale.setScalar(STAGE_SCALE * (0.9 + 0.1 * k));
    this.rig.glass.scale.y = 0.04 + 0.96 * easeOutCubic(Math.min(1, this.warm * 1.4));
    this.rig.update(dt, this.time);
    const s = this.screen;
    if (s) {
      const noise = 1 - this.warm;
      this.rig.screen.paint((c, w, h) => {
        s.paint(c, w, h, this.time);
        staticBars(c, w, h, noise, this.time);
      });
    }
  }

  /** Canvas coordinates of a raycast hit on the glass (y grows downwards). */
  private glassPoint(hit: THREE.Intersection): { x: number; y: number } {
    const uv = hit.uv!;
    return { x: uv.x * SCREEN_W, y: (1 - uv.y) * SCREEN_H };
  }

  private pick(e: PointerEvent): THREE.Intersection | null {
    const r = app.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1));
    this.ray.setFromCamera(this.ndc, app.camera);
    return this.ray.intersectObjects(this.rig.pickables, false)[0] ?? null;
  }

  private keyFor(hit: THREE.Intersection): KeyCap | null {
    return this.rig.keys.find((k) => k.mesh === hit.object) ?? null;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.screen || !this.wantOpen) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    this.rig.pressKey(e.code);
    if (!e.repeat) sfx('typewriter', 0.35);
    this.screen.key(e);
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.screen || !this.wantOpen) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void app.audio.resume();
    const hit = this.pick(e);
    if (!hit) return;
    const k = this.keyFor(hit);
    if (k) {
      this.rig.pressKey(k.def.code);
      sfx('typewriter', 0.35);
      this.screen.key({ code: k.def.code, key: k.def.key, repeat: false, preventDefault() { /* synthetic */ } });
      return;
    }
    if (hit.object === this.rig.glass) {
      const p = this.glassPoint(hit);
      this.screen.click(p.x, p.y);
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.screen || !this.wantOpen) return;
    e.stopImmediatePropagation();
    const hit = this.pick(e);
    const k = hit ? this.keyFor(hit) : null;
    if (k !== this.hoverKey) { this.hoverKey = k; if (k) sfx('hover', 0.25); }
    app.canvas.style.cursor = hit ? 'pointer' : '';
    if (hit && hit.object === this.rig.glass) {
      const p = this.glassPoint(hit);
      this.screen.move?.(p.x, p.y);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.wantOpen) return;
    e.stopImmediatePropagation();
  };

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKey, { capture: true });
    window.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove, { capture: true });
    window.addEventListener('pointerup', this.onUp, { capture: true });
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKey, { capture: true });
    window.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('pointermove', this.onMove, { capture: true });
    window.removeEventListener('pointerup', this.onUp, { capture: true });
    app.canvas.style.cursor = '';
  }
}

export const stage = new Stage();

let hooked = false;
let lastReal = 0;

/**
 * Draw the stage over the menu. The menu renders its own scene with `app.renderer.render(scene, camera)`; this wraps that
 * call once so the stage goes in as the renderer's overlay (drawn after a depth clear, in front of the cabinet). Only the
 * menu state is touched, so the lobby's frames are never affected.
 */
export function hookStageOverlay(): void {
  if (hooked) return;
  hooked = true;
  const r = app.renderer;
  const orig = r.render.bind(r);
  r.render = (scene, camera, overlay) => {
    if (app.state === 'menu') {
      stage.update(Math.min(0.1, Math.max(0, app.time.real - lastReal)));
      lastReal = app.time.real;
      if (!overlay && stage.visible) overlay = { scene: stage.scene, camera };
    }
    orig(scene, camera, overlay);
  };
}
