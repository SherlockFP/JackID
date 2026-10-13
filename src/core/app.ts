/**
 * App service container + state machine (TD-owned). Contract: TECH_SPEC §2.2, §1.5.
 *
 * `app` is assigned exactly once by `createApp()` in `main.ts`; everywhere else it is read-only.
 * Machines must use `this.ctx` instead of this singleton (keeps bench/tests isolated).
 */
import type * as THREE from 'three';
import type { PsxRenderer } from './renderer/types';
import type { AudioEngine } from './audio/types';
import type { Input } from './input/types';
import type { UIOverlay } from './ui/types';
import type { TexGen } from './texgen/types';
import type { FxApi } from './fx/types';
import type { CutscenePlayer } from './cutscene/types';
import type { Kit } from '@/kit/types';
import type { Session } from '@/net/types';
import type { World } from '@/world/types';
import type { RunApi } from '@/game/types';
import type { LocalPlayer } from '@/player/types';
import type { SaveStore } from './save';
import type { Rng } from './rng';
import type { TimeInfo } from './types';
import type { AppStateHandler, AppStateId, StateParams } from './states';
import { bus, type EventBus, type GameEvents } from './events';
import { createTweenSystem, type TweenSystem } from './tween';
import { createTimers, type Timers } from './timers';
import { log } from './log';

export interface App {
  readonly version: string;                 // __APP_VERSION__
  readonly canvas: HTMLCanvasElement;
  readonly renderer: PsxRenderer;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly events: EventBus<GameEvents>;
  readonly ui: UIOverlay;
  readonly save: SaveStore;
  readonly tex: TexGen;
  readonly kit: Kit;
  readonly fx: FxApi;
  readonly net: Session;
  readonly cutscene: CutscenePlayer;
  readonly rng: { root: Rng; cosmetic: Rng };
  readonly tweens: { sim: TweenSystem; ui: TweenSystem };
  readonly timers: { sim: Timers; ui: Timers };
  readonly time: TimeInfo;
  readonly camera: THREE.PerspectiveCamera;
  readonly state: AppStateId;
  readonly current: AppStateHandler;
  simPaused: boolean;
  /**
   * Sim speed multiplier (1 = normal). Cosmetic slow-mo: written by `FxApi.slowmo`; the loop clamps it to ≥ 0.6
   * while a session is online so the host never falls behind.
   */
  timeScale: number;
  /** Real seconds of hit-stop left (sim frozen, audio/UI continue). Written by `FxApi.hitstop`. */
  hitstopLeft: number;
  world: World | null;                      // set by InGame state
  run: RunApi | null;                       // set by InGame state
  player: LocalPlayer | null;               // set by InGame state
  register<K extends AppStateId>(id: K, h: AppStateHandler<K>): void;
  go<K extends AppStateId>(to: K, params: StateParams[K]): Promise<void>;
}

/** Everything `main.ts` builds before the app exists. */
export interface AppParts {
  canvas: HTMLCanvasElement;
  renderer: PsxRenderer;
  audio: AudioEngine;
  input: Input;
  ui: UIOverlay;
  save: SaveStore;
  tex: TexGen;
  kit: Kit;
  fx: FxApi;
  net: Session;
  cutscene: CutscenePlayer;
  camera: THREE.PerspectiveCamera;
  rng: { root: Rng; cosmetic: Rng };
  version: string;
}

/** Assigned once by `createApp()`. Read-only elsewhere. */
export let app: App;

const IDLE_STATE: AppStateHandler = { enter() {}, exit() {}, fixedUpdate() {}, frame() {} };

class AppImpl implements App {
  readonly version: string;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: PsxRenderer;
  readonly audio: AudioEngine;
  readonly input: Input;
  readonly events: EventBus<GameEvents> = bus;
  readonly ui: UIOverlay;
  readonly save: SaveStore;
  readonly tex: TexGen;
  readonly kit: Kit;
  readonly fx: FxApi;
  readonly net: Session;
  readonly cutscene: CutscenePlayer;
  readonly rng: { root: Rng; cosmetic: Rng };
  readonly tweens = { sim: createTweenSystem(), ui: createTweenSystem() };
  readonly timers = { sim: createTimers(), ui: createTimers() };
  readonly time: TimeInfo = { real: 0, sim: 0, frame: 0, step: 0 };
  readonly camera: THREE.PerspectiveCamera;
  simPaused = false;
  timeScale = 1;
  hitstopLeft = 0;
  world: World | null = null;
  run: RunApi | null = null;
  player: LocalPlayer | null = null;

  private _state: AppStateId = 'boot';
  private _current: AppStateHandler = IDLE_STATE;
  private handlers = new Map<AppStateId, AppStateHandler<AppStateId>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(p: AppParts) {
    this.version = p.version; this.canvas = p.canvas; this.renderer = p.renderer; this.audio = p.audio;
    this.input = p.input; this.ui = p.ui; this.save = p.save; this.tex = p.tex; this.kit = p.kit; this.fx = p.fx;
    this.net = p.net; this.cutscene = p.cutscene; this.camera = p.camera; this.rng = p.rng;
  }

  get state(): AppStateId { return this._state; }
  get current(): AppStateHandler { return this._current; }

  register<K extends AppStateId>(id: K, h: AppStateHandler<K>): void {
    this.handlers.set(id, h as AppStateHandler<AppStateId>);
    if (id === this._state) this._current = h as AppStateHandler<AppStateId>;
  }

  /** Serialized: a `go()` issued during a `go()` waits for it. Never rejects; failures return to the menu. */
  go<K extends AppStateId>(to: K, params: StateParams[K]): Promise<void> {
    this.queue = this.queue.then(() => this.transition(to, params));
    return this.queue;
  }

  private async transition<K extends AppStateId>(to: K, params: StateParams[K]): Promise<void> {
    const from = this._state;
    const next = this.handlers.get(to);
    if (!next) { log.error('app', `no handler registered for state "${to}"`); return; }
    try { await this._current.exit(to); } catch (e) { log.error('app', `exit(${from}→${to})`, e); }
    // Gameplay clocks never leak across states; UI clocks keep running.
    this.timers.sim.clear();
    this.tweens.sim.clear();
    this.simPaused = false;
    this.timeScale = 1;
    this.hitstopLeft = 0;
    this._state = to;
    this._current = next;
    try {
      await next.enter(params as never, from);
    } catch (e) {
      log.error('app', `enter(${to})`, e);
      if (to !== 'menu' && this.handlers.has('menu')) {
        const menu = this.handlers.get('menu')!;
        this._state = 'menu'; this._current = menu;
        try { await menu.enter({ toast: String((e as Error)?.message ?? e) }, to); } catch (e2) { log.error('app', 'menu fallback', e2); }
      }
    }
    this.events.emit('app:state', { from, to: this._state });
  }
}

/** Build the singleton. Call once from `main.ts` after the services exist. */
export function createApp(parts: AppParts): App {
  if (app) log.warn('app', 'createApp called twice');
  app = new AppImpl(parts);
  return app;
}
