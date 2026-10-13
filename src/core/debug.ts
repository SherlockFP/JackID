/**
 * Dev tools (CORE-RENDER). Active in `vite dev` or with `?debug=1`; stripped from the player's way otherwise.
 *
 *  - `window.jackid`   the app + helpers for the console (`stats()`, `colliders()`, `win('jackpot')`, `devCut()` …)
 *  - F3 / `stats()`    stats overlay: fps, draw calls, tris, GPU memory, particles, net, last log lines (4 Hz refresh)
 *  - F4 / `colliders()` collider wireframes drawn in the FX layer (needs `world.collision.forEach`, see WORLD-SYS)
 *  - `devCut()`        a throw-away cutscene around the camera that exercises path, gate, subtitles, actors and fx
 * F3/F4 arrive as input actions, so they work while walking or seated; `?debug=1` opens the overlay at boot.
 */
import * as THREE from 'three';
import type { App } from './app';
import type { CutsceneDef, CutsceneResult } from './cutscene/types';
import type { WinTier } from '@/game/types';
import type { V3 } from './types';
import { bootParams } from './bootParams';
import { fxLayer, type FxSystem } from './fx/layer';
import { registerStrings } from './i18n';
import devStrings from './debug.strings';
import { log, type LogLine } from './log';

declare global {
  interface Window { jackid?: Record<string, unknown> }
}

// ── collider wireframes ──────────────────────────────────────────────────────────────────────────
interface ColliderView { id: number; tag: string; on: boolean; box: THREE.Box3 }
type ColliderSource = { forEach?: (fn: (c: ColliderView) => void) => void };

const TAG_COLOR: Record<string, number> = { solid: 0xff4a4a, low: 0xffd24a, walkable: 0x4aff7a };
const OFF_COLOR = 0x6a6a80;
const MAX_BOXES = 6000;
const EDGES = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];

class ColliderLines implements FxSystem {
  private readonly geo = new THREE.BufferGeometry();
  private readonly lines: THREE.LineSegments;
  private readonly pos = new Float32Array(MAX_BOXES * 72);
  private readonly col = new Float32Array(MAX_BOXES * 72);
  private acc = 0;
  private on = false;
  private readonly c = new THREE.Color();

  constructor(private readonly app: App) {
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false, transparent: true, opacity: 0.85 });
    const pa = new THREE.BufferAttribute(this.pos, 3), ca = new THREE.BufferAttribute(this.col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('color', ca);
    this.geo.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 200;
    this.lines.visible = false;
    this.lines.name = 'debug:colliders';
    fxLayer.scene.add(this.lines);
    fxLayer.register(this);
  }

  get active(): boolean { return this.on; }

  toggle(force?: boolean): boolean {
    this.on = force ?? !this.on;
    this.lines.visible = this.on;
    this.acc = 1;
    return this.on;
  }

  update(dt: number): void {
    if (!this.on) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const src = this.app.world?.collision as unknown as ColliderSource | undefined;
    if (!src?.forEach) { this.geo.setDrawRange(0, 0); return; }
    let n = 0;
    const corners: number[] = new Array(24);
    src.forEach((c) => {
      if (n >= MAX_BOXES) return;
      const b = c.box;
      for (let i = 0; i < 8; i++) {
        corners[i * 3] = i & 1 ? b.max.x : b.min.x;
        corners[i * 3 + 1] = i & 4 ? b.max.y : b.min.y;
        corners[i * 3 + 2] = i & 2 ? b.max.z : b.min.z;
      }
      this.c.setHex(c.on ? (TAG_COLOR[c.tag] ?? 0xffffff) : OFF_COLOR);
      for (let e = 0; e < EDGES.length; e++) {
        const o = (n * 24 + e) * 3, k = EDGES[e] * 3;
        this.pos[o] = corners[k]; this.pos[o + 1] = corners[k + 1]; this.pos[o + 2] = corners[k + 2];
        this.col[o] = this.c.r; this.col[o + 1] = this.c.g; this.col[o + 2] = this.c.b;
      }
      n++;
    });
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
    this.geo.setDrawRange(0, n * 24);
  }
}

// ── stats overlay ────────────────────────────────────────────────────────────────────────────────
const LOG_COLOR: Record<LogLine['level'], string> = { debug: '#7a8', info: '#9cf', warn: '#fd5', error: '#f66' };

class StatsOverlay {
  private readonly box: HTMLDivElement;
  private readonly head: HTMLPreElement;
  private readonly logs: HTMLDivElement;
  private on = false;
  private lastFrame = 0;
  private lastReal = 0;
  private fps = 0;
  private off: (() => void) | null = null;

  constructor(private readonly app: App) {
    this.box = document.createElement('div');
    this.box.style.cssText = 'position:fixed;left:6px;top:6px;z-index:2147483000;pointer-events:none;display:none;'
      + 'font:12px/1.3 monospace;color:#9f9;background:rgba(0,0,0,.62);padding:4px 6px;max-width:min(92vw,720px)';
    this.head = document.createElement('pre');
    this.head.style.cssText = 'margin:0;font:inherit;white-space:pre';
    this.logs = document.createElement('div');
    this.logs.style.cssText = 'margin-top:4px;white-space:pre-wrap;word-break:break-word;font-size:11px';
    this.box.append(this.head, this.logs);
    document.body.appendChild(this.box);
  }

  toggle(force?: boolean): boolean {
    this.on = force ?? !this.on;
    this.box.style.display = this.on ? 'block' : 'none';
    this.off?.();
    this.off = null;
    if (this.on) {
      this.lastFrame = this.app.time.frame; this.lastReal = this.app.time.real;
      this.off = this.app.timers.ui.every(0.25, () => this.refresh());
      this.refresh();
    }
    return this.on;
  }

  private refresh(): void {
    const a = this.app;
    const dReal = a.time.real - this.lastReal;
    if (dReal > 0) { this.fps = (a.time.frame - this.lastFrame) / dReal; this.lastFrame = a.time.frame; this.lastReal = a.time.real; }
    const i = a.renderer.info();
    const r = a.renderer;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const lines = [
      `JackID ${a.version}  ${a.state}  ${this.fps.toFixed(0)} fps  cpu ${i.cpuMs.toFixed(1)} ms`,
      `psx ${r.lowRes.x}x${r.lowRes.y} x${+r.scale.toFixed(2)}  calls ${i.calls}  tris ${(i.tris / 1000).toFixed(1)}k  geo ${i.geometries}  tex ${i.textures}  prog ${i.programs}`,
      `fx ${fxLayer.count} live  post f${r.post.flashAlpha.toFixed(2)} c${r.post.chroma.toFixed(1)} z${r.post.zoom.toFixed(2)}  time x${a.timeScale.toFixed(2)}${a.hitstopLeft > 0 ? ' HITSTOP' : ''}`,
      `net ${a.net.mode}  players ${a.net.players.size}  rtt ${Math.round(a.net.rtt())} ms  sim ${a.time.sim.toFixed(1)}s`
      + (heap ? `  heap ${(heap / 1048576).toFixed(0)} MB` : '')
      + (a.cutscene.playing ? `  CUT ${a.cutscene.playing} ${a.cutscene.time.toFixed(1)}s` : ''),
    ];
    this.head.textContent = lines.join('\n');
    const recent = log.recent().filter((l) => l.level !== 'debug').slice(-7);
    this.logs.replaceChildren(...recent.map((l) => {
      const d = document.createElement('div');
      d.style.color = LOG_COLOR[l.level];
      d.textContent = `[${l.tag}] ${l.msg.slice(0, 160)}`;
      return d;
    }));
  }
}

// ── dev cutscene ─────────────────────────────────────────────────────────────────────────────────
let devStringsDone = false;
/** A scene built around the current camera: orbit path, mannequin, gate, subtitles, fx. Exercises the whole player. */
function devScene(app: App): CutsceneDef {
  const cam = app.camera;
  const p = cam.getWorldPosition(new THREE.Vector3());
  const fwd = cam.getWorldDirection(new THREE.Vector3());
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const floor = app.world?.collision.floorAt(p.x, p.z, p.y) ?? p.y - 1.6;
  const c: V3 = [p.x + fwd.x * 3.6, floor, p.z + fwd.z * 3.6];
  const head: V3 = [c[0], floor + 1.5, c[2]];
  const ring = (a: number, r: number, h: number): V3 => [c[0] + Math.sin(a) * r, floor + h, c[2] + Math.cos(a) * r];
  const a0 = Math.atan2(-fwd.x, -fwd.z);
  if (!devStringsDone) { devStringsDone = true; registerStrings(devStrings.prefix, devStrings); }
  return {
    id: 'dev.test', kind: 'stinger', duration: 8, skippable: true,
    actors: { dummy: { kind: 'mannequin', pos: c, rotY: (a0 * 180) / Math.PI, clip: 'Idle_Loop', color: 0xc59c42 } },
    tracks: [
      {
        kind: 'camera', handheld: 0.6,
        keys: [{ t: 0, pos: ring(a0, 3.4, 1.7), look: { actor: 'dummy' }, fov: 60 }],
        paths: [{ t0: 0.2, t1: 7, points: [ring(a0, 3.4, 1.7), ring(a0 + 1.4, 2.6, 1.3), ring(a0 + 3.0, 2.2, 1.6), ring(a0 + 4.6, 2.8, 1.2)], look: head, fov: [60, 38], ease: 'inOutQuad' }],
      },
      { kind: 'actor', actor: 'dummy', cues: [{ t: 2, clip: 'Walk_Loop', moveTo: { pos: [c[0] + fwd.x, c[1], c[2] + fwd.z], dur: 3, faceMove: true } }, { t: 5.2, clip: 'Idle_Loop' }] },
      { kind: 'subtitle', cues: [{ t: 0.8, dur: 2.4, key: 'dev.cut.a', speaker: 'dev.cut.a' }, { t: 4.4, dur: 2.4, key: 'dev.cut.b' }] },
      { kind: 'gate', cues: [{ t: 4, id: 'beat', until: 'timeout', timeout: 0.6 }] },
      {
        kind: 'fx', cues: [
          { t: 3, do: 'flash', color: 0xefd67b, alpha: 0.5, dur: 0.15 }, { t: 3, do: 'shake', amp: 0.04, dur: 0.6 },
          { t: 3, do: 'zoom', amount: 0.06, dur: 0.5 }, { t: 6, do: 'glitch', amount: 0.7, dur: 0.5 },
        ],
      },
      { kind: 'audio', cues: [{ t: 3, do: 'sfx', name: 'coinLand' }] },
    ],
  };
}

// ── install ──────────────────────────────────────────────────────────────────────────────────────
export function installDebug(app: App): void {
  if (!import.meta.env.DEV && !bootParams.debug) return;
  const stats = new StatsOverlay(app);
  const colliders = new ColliderLines(app);
  app.input.on('debug', (down) => { if (down) stats.toggle(); });
  app.input.on('debugColliders', (down) => { if (down) colliders.toggle(); });
  if (bootParams.debug) stats.toggle(true);

  window.jackid = {
    app,
    version: app.version,
    state: () => app.state,
    info: () => app.renderer.info(),
    logs: () => log.recent(),
    go: (to: 'menu' | 'ingame', mode: 'free' | 'debt' = 'free') =>
      to === 'menu' ? app.go('menu', undefined) : app.go('ingame', { mode, seed: 1, online: false }),
    stats: (on?: boolean) => stats.toggle(on),
    colliders: (on?: boolean) => colliders.toggle(on),
    /** Fire the win feedback for a tier at a point 2.5 m ahead of the camera. */
    win: (tier: WinTier = 'big', amount = 12500) => {
      const p = app.camera.getWorldPosition(new THREE.Vector3());
      const d = app.camera.getWorldDirection(new THREE.Vector3());
      app.fx.winBurst(tier, p.addScaledVector(d, 2.5), { amount, flyToWallet: true });
    },
    loss: (amount = 500) => {
      const p = app.camera.getWorldPosition(new THREE.Vector3());
      app.fx.loss(p.addScaledVector(app.camera.getWorldDirection(new THREE.Vector3()), 2.5), { amount });
    },
    devCut: (): Promise<CutsceneResult> => {
      app.cutscene.register(devScene(app));
      return app.cutscene.play('dev.test');
    },
  };
  log.info('debug', 'window.jackid ready (F3 stats, F4 colliders)');
}
