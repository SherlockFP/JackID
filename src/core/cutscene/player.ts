/**
 * Cutscene player (CUTSCENE WP). Contract: `cutscene/types.ts` (frozen), BRIEF ADDENDUM 2.
 *
 * `createCutscenePlayer()` owns the registry (defs + hooks), a FIFO of pending scenes and ONE live {@link Run}.
 * A run flattens every track into a single time-sorted cue list and walks it with a cursor:
 *
 *   start()   input lock ('cutscene' mode), HUD off, letterbox in, black until t = 0
 *   begin()   at `startAt` (host clock) — a late peer SEEKS: older cues are applied with `seeking = true`
 *   advance() timeline time += real dt (freezes in SP pause and on gates); due cues fire in order
 *   finish()  done | skipped | aborted — state cues are replayed on skip, everything is released, chain / queue go on
 *
 * Camera: sampled every frame (`camera.ts`) and handed to the FX layer, which writes it over the state's camera for
 * the draw only (`fx/layer.ts`), so gameplay code never sees it. Actors, audio, screen FX, lights and subtitles are
 * applied by `actors.ts` / `effects.ts`. The run never touches `setTimeout` or DOM listeners: skipping reads the
 * `skip` action (hold 0.8 s) and tap-gates use `input.on('skip')`.
 *
 * Multiplayer glue (the NET layer owns the messages):
 *  - the host calls `play(id, { startAt, seed })`; every peer does the same with the same `startAt`;
 *  - `skip()` online emits the bus event `cutscene:skip` (a vote); when the vote passes the net calls `forceSkip()`;
 *  - choice / input / hook gates are resolved by the HOST; it emits `cutscene:gate` and the net relays the value to
 *    every peer's `resolveGate(id, value)` (a value that arrives before the gate opens is remembered).
 * Authors own light/music state: nothing is auto-restored on exit except input, HUD, camera, letterbox, fade, subtitles.
 */
import type * as THREE from 'three';
import type {
  ActorCue, AudioCue, CamKey, CamPath, CutTarget, CutsceneDef, CutsceneHookCtx, CutsceneHookFn, CutsceneId, CutscenePlayOpts,
  CutscenePlayer, CutsceneResult, FxCue, GateCue, HookCue, LightCue, SubtitleCue,
} from './types';
import type { InputMode } from '../input/types';
import type { AppStateId } from '../states';
import type { LocalPlayer } from '@/player/types';
import { app } from '../app';
import { bus } from '../events';
import { t } from '../i18n';
import { log } from '../log';
import { fxLayer } from '../fx/layer';
import { CutActors } from './actors';
import { CutCamera, newCameraPose } from './camera';
import { applyAudio, applyFx, applyLight, showSubtitle, type EffectCtx, type TrackedVoice } from './effects';
import { resolveTarget } from './targets';

declare module '@/core/events' {
  interface GameEvents {
    /** The host resolved a cutscene gate; the net layer relays it to peers, which call `resolveGate(gate, value)`. */
    'cutscene:gate': { id: CutsceneId; gate: string; value: number };
  }
}

const SKIP_HOLD = 0.8;          // s, hold-to-skip
const HINT_SECS = 4;            // s, the skip ring is shown dimly at the start of every scene
const TAP_MAX = 0.4;            // s, a shorter press of the skip key resolves an `input` gate (longer = skip hold)
const SEEK_MIN = 0.05;          // s, a late start below this is just played
const READY_WAIT = 2;           // s, SP: wait this long for mannequin meshes before starting
const GATE_FAILSAFE = 90;       // s, online: a lost gate message must never soft-lock a client
const FADE_BACK = 0.45;         // s, black → world after the last scene

type Flat =
  | { t: number; k: 'actor'; actor: string; cue: ActorCue }
  | { t: number; k: 'subtitle'; cue: SubtitleCue }
  | { t: number; k: 'audio'; cue: AudioCue }
  | { t: number; k: 'fx'; cue: FxCue }
  | { t: number; k: 'light'; cue: LightCue }
  | { t: number; k: 'hook'; cue: HookCue }
  | { t: number; k: 'gate'; cue: GateCue };

interface Compiled { cues: Flat[]; keys: CamKey[]; paths: CamPath[]; handheld: number }

/** Flatten a def's tracks into one cue list (gates sort after other cues at the same time). */
function compile(def: CutsceneDef): Compiled {
  const out: Compiled = { cues: [], keys: [], paths: [], handheld: 0 };
  for (const tr of def.tracks) {
    switch (tr.kind) {
      case 'camera':
        out.keys.push(...(tr.keys ?? []));
        out.paths.push(...(tr.paths ?? []));
        out.handheld = Math.max(out.handheld, tr.handheld ?? 0);
        break;
      case 'actor': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'actor', actor: tr.actor, cue }); break;
      case 'subtitle': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'subtitle', cue }); break;
      case 'audio': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'audio', cue }); break;
      case 'fx': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'fx', cue }); break;
      case 'light': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'light', cue }); break;
      case 'hook': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'hook', cue }); break;
      case 'gate': for (const cue of tr.cues) out.cues.push({ t: cue.t, k: 'gate', cue }); break;
    }
  }
  out.cues.sort((a, b) => a.t - b.t || Number(a.k === 'gate') - Number(b.k === 'gate'));
  return out;
}

interface ActiveGate { cue: GateCue; waited: number; off: (() => void) | null }

interface RunHost {
  readonly hooks: ReadonlyMap<string, CutsceneHookFn>;
  ended(run: Run, result: CutsceneResult): void;
}

class Run {
  /** Timeline seconds (frozen by gates and SP pause). */
  t = 0;
  readonly vars: Record<string, string | number>;
  readonly startState: AppStateId;

  private readonly cues: Flat[];
  private cursor = 0;
  private readonly actors: CutActors;
  private readonly camera: CutCamera | null;
  private readonly pose = newCameraPose();
  private readonly voices: TrackedVoice[] = [];
  private readonly fxCtx: EffectCtx;
  private readonly skippable: boolean;
  private readonly locked: boolean;
  private readonly early = new Map<string, number>();
  private gate: ActiveGate | null = null;
  private clock = 0;                 // real seconds since start()
  private readyWait = 0;
  private hold = 0;
  private voted = false;
  private staged = false;
  private begun = false;
  private fadedOut = false;
  private ended = false;
  private prevMode: InputMode = 'walk';
  private hidHud = false;
  private player: LocalPlayer | null = null;

  constructor(readonly def: CutsceneDef, private readonly opts: CutscenePlayOpts, private readonly host: RunHost) {
    this.vars = { ...(opts.vars ?? {}) };
    this.startState = app.state;
    this.skippable = (opts.skippable ?? def.skippable) !== false;
    this.locked = def.lockInput !== false;
    const c = compile(def);
    this.cues = c.cues;
    const resolve = (tg: CutTarget, role: 'pos' | 'look', out: THREE.Vector3): THREE.Vector3 =>
      resolveTarget(tg, role, out, (k) => this.actors.get(k));
    this.actors = new CutActors(app.kit, resolve);
    this.camera = c.keys.length + c.paths.length > 0
      ? new CutCamera(c.keys, c.paths, c.handheld, resolve, app.camera.fov, opts.seed ?? 1)
      : null;
    this.fxCtx = { resolve, t: 0, voices: this.voices };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────────
  start(): void {
    const a = app, def = this.def;
    bus.emit('cutscene:start', { id: def.id });
    if (this.locked) {
      this.prevMode = a.input.mode;
      a.input.setMode('cutscene');
      this.player = a.player;
      this.player?.setCutscene(true);
    }
    if (def.hideHud !== false) { a.ui.setHudVisible(false); this.hidHud = true; }
    if (def.letterbox !== false) void a.ui.letterbox(1, 0.5);
    if ((def.fadeIn ?? 0.4) > 0) void a.ui.fade(1, 0);              // black until t = 0, then fades in
    if (Object.keys(def.actors ?? {}).length > 0) {
      try { void a.kit.loadMannequin().catch((): void => { /* placeholders stay */ }); } catch { /* kit not ready */ }
    } else this.staged = true;
  }

  /** Spawn the declared actors into the main scene (needs one rendered frame). Returns false while waiting. */
  private stage(): boolean {
    const scene = fxLayer.mainScene;
    if (this.staged) { if (scene) this.actors.rehome(scene); return true; }
    if (!scene) return false;
    this.actors.rehome(scene);
    const specs = this.def.actors ?? {};
    for (const [key, base] of Object.entries(specs)) {
      const spec = { ...base, ...(this.opts.actors?.[key] ?? {}) };
      try { this.actors.spawn(key, spec); } catch (e) { log.error('cutscene', `actor "${key}" failed to spawn`, e); }
    }
    this.staged = true;
    return true;
  }

  private begin(): void {
    this.begun = true;
    const a = app, def = this.def;
    const late = this.opts.startAt !== undefined ? (a.net.hostTime() - this.opts.startAt) / 1000 : 0;
    const fadeIn = def.fadeIn ?? 0.4;
    void a.ui.fade(0, late > 0.5 ? 0.2 : Math.max(0, fadeIn));
    if (late > SEEK_MIN) {
      if (late >= def.duration) { this.finish('skipped'); return; }
      this.seekTo(late);
    }
    this.advance(0);
  }

  /** Apply every cue before `time` in seeking mode (late join / lag) and jump the clock there. */
  private seekTo(time: number): void {
    while (this.cursor < this.cues.length && this.cues[this.cursor].t < time) { const c = this.cues[this.cursor++]; this.fire(c, true, time - c.t); }
    this.t = time;
  }

  /** Called once per frame with REAL dt. */
  update(dt: number): void {
    if (this.ended) return;
    this.clock += dt;
    if (!this.begun) {
      if (!this.stage()) {
        if (this.clock <= READY_WAIT + 2) return;
        log.warn('cutscene', `no main scene to stage actors for "${this.def.id}"; starting without`);
        this.staged = true;
      }
      this.applyCamera();                                        // frame 0 while waiting for the host clock
      const startAt = this.opts.startAt;
      if (startAt !== undefined) {
        if (app.net.hostTime() < startAt) return;
      } else if (!this.actors.ready && (this.readyWait += dt) < READY_WAIT) return;
      this.begin();
      if (this.ended) return;
    } else this.stage();

    const paused = app.simPaused;
    this.updateSkip(dt, paused);
    if (this.ended) return;
    if (!paused) {
      this.stepVoices();
      this.advance(dt);
      if (this.ended) return;
    }
    // continuous actor motion follows slow-mo / hit-stop like the rest of the sim
    this.actors.update(paused ? 0 : dt * (app.hitstopLeft > 0 ? 0 : app.timeScale));
    this.applyCamera();
  }

  private applyCamera(): void {
    if (!this.camera) return;
    fxLayer.setCameraPose(this.camera.sample(this.t, this.pose) ? this.pose : null);
  }

  // ── timeline ────────────────────────────────────────────────────────────────────────────────────
  private advance(dt: number): void {
    if (this.gate) { this.tickGate(dt); if (this.gate) return; }
    const dur = this.def.duration;
    const target = Math.min(this.t + dt, dur);
    while (this.cursor < this.cues.length && this.cues[this.cursor].t <= target) {
      const c = this.cues[this.cursor++];
      this.t = Math.max(this.t, c.t);
      if (c.k === 'gate') { this.openGate(c.cue); if (this.gate) return; continue; }
      this.fire(c, false);
      if (this.ended) return;
    }
    this.t = target;
    const fadeOut = this.def.fadeOut ?? 0.4;
    if (!this.fadedOut && fadeOut > 0 && this.t >= dur - fadeOut) {
      this.fadedOut = true;
      void app.ui.fade(1, Math.max(0.05, dur - this.t));
    }
    if (this.t >= dur) this.finish('done');
  }

  /** Fire one cue. `since` (seeking only) = how long ago it was due. */
  private fire(c: Flat, seek: boolean, since = 0): void {
    try {
      switch (c.k) {
        case 'actor': this.actors.cue(c.actor, c.cue, seek, since); break;
        case 'subtitle': showSubtitle(c.cue, this.vars, seek, since); break;
        case 'audio': this.fxCtx.t = c.t; applyAudio(c.cue, seek, this.fxCtx); break;
        case 'fx': applyFx(c.cue, seek); break;
        case 'light': applyLight(c.cue, seek); break;
        case 'hook': this.runHook(c.cue, seek); break;
        case 'gate': if (this.vars[c.cue.id] === undefined) this.vars[c.cue.id] = this.early.get(c.cue.id) ?? 0; break;
      }
    } catch (e) {
      log.error('cutscene', `${this.def.id}: ${c.k} cue at ${c.t}s failed`, e);
    }
  }

  private runHook(cue: HookCue, seeking: boolean): void {
    const fn = this.host.hooks.get(cue.hook);
    if (!fn) { log.warnOnce(`cutscene:hook:${cue.hook}`, 'cutscene', `no handler for hook "${cue.hook}" (${this.def.id})`); return; }
    const ctx: CutsceneHookCtx = { id: this.def.id, t: cue.t, seeking, vars: this.vars };
    const fail = (e: unknown): void => log.error('cutscene', `hook "${cue.hook}"`, e);
    try { Promise.resolve(fn(cue.args, ctx)).catch(fail); } catch (e) { fail(e); }       // sync part runs now, async part is not awaited
  }

  private stepVoices(): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].until <= this.t) { this.voices[i].voice.stop(0.1); this.voices.splice(i, 1); }
    }
  }

  // ── gates ───────────────────────────────────────────────────────────────────────────────────────
  private openGate(cue: GateCue): void {
    const early = this.early.get(cue.id);
    if (early !== undefined) { this.early.delete(cue.id); this.vars[cue.id] = early; return; }
    const g: ActiveGate = { cue, waited: 0, off: null };
    this.gate = g;
    const a = app;
    if (a.net.online && !a.net.isHost) return;                   // the host decides; we wait for resolveGate()
    if (cue.until === 'choice') {
      const options = (cue.options ?? []).map((k) => t(k));
      a.ui.choice(t('cutscene.choose'), options, { timeout: cue.timeout })
        .then((i) => this.settle(cue.id, Math.max(0, i)), () => this.settle(cue.id, 0));
    } else if (cue.until === 'input') {
      let downAt = -1;
      g.off = a.input.on('skip', (down) => {
        if (down) downAt = this.clock;
        else if (downAt >= 0 && this.clock - downAt < TAP_MAX) this.settle(cue.id, 0);
      });
    }
  }

  private tickGate(dt: number): void {
    const g = this.gate;
    if (!g) return;
    g.waited += dt;
    const c = g.cue;
    const limit = c.until === 'timeout' ? (c.timeout ?? 0)
      : c.timeout !== undefined ? c.timeout + (c.until === 'choice' ? 1 : 0)
        : app.net.online ? GATE_FAILSAFE : Infinity;
    if (g.waited >= limit) this.settle(c.id, 0);
  }

  /** Resolve gate `id` (or remember the value if it has not opened yet). */
  settle(id: string, value: number): void {
    if (this.ended) return;
    const g = this.gate;
    if (!g || g.cue.id !== id) { this.early.set(id, value); return; }
    g.off?.();
    this.gate = null;
    this.vars[id] = value;
    if (app.net.online && app.net.isHost) bus.emit('cutscene:gate', { id: this.def.id, gate: id, value });
  }

  // ── skipping ────────────────────────────────────────────────────────────────────────────────────
  private updateSkip(dt: number, paused: boolean): void {
    if (!this.skippable || !this.locked) return;
    const a = app;
    // A choice dialog cannot be cancelled from here, so skipping is ignored while one is open.
    const held = !paused && !this.voted && this.gate?.cue.until !== 'choice' && a.input.down('skip');
    this.hold = held ? Math.min(SKIP_HOLD, this.hold + dt) : Math.max(0, this.hold - dt * 3);
    if (this.voted) a.ui.skipHint(1, t('cutscene.skipVote'));
    else if (this.hold > 0 || this.clock < HINT_SECS) a.ui.skipHint(this.hold / SKIP_HOLD);
    else a.ui.skipHint(null);
    if (held && this.hold >= SKIP_HOLD) this.requestSkip();
  }

  /** SP: skip now. Online: cast a vote (`cutscene:skip`); the net calls `forceSkip()` when it passes. */
  requestSkip(): void {
    if (this.ended || !this.skippable) return;
    if (!app.net.online) { this.finish('skipped'); return; }
    if (!this.voted) { this.voted = true; bus.emit('cutscene:skip', { id: this.def.id }); }
  }

  // ── end ─────────────────────────────────────────────────────────────────────────────────────────
  finish(result: CutsceneResult): void {
    if (this.ended) return;
    this.ended = true;
    if (result === 'skipped' && this.def.applyOnSkip !== false) {
      void app.ui.fade(1, 0);                                    // the jump happens under black
      this.t = this.def.duration;
      while (this.cursor < this.cues.length) { const c = this.cues[this.cursor++]; this.fire(c, true, this.t - c.t); }
    }
    this.release();
    this.host.ended(this, result);
  }

  private release(): void {
    const a = app;
    this.gate?.off?.();
    this.gate = null;
    for (const v of this.voices) v.voice.stop(0.2);
    this.voices.length = 0;
    this.actors.dispose();
    fxLayer.setCameraPose(null);
    a.ui.skipHint(null);
    a.ui.subtitle(null);
    if (this.def.letterbox !== false) void a.ui.letterbox(0, 0.4);
    if (this.locked) {
      // a state change already set its own mode: only undo what is still ours
      if (a.input.mode === 'cutscene') a.input.setMode(this.prevMode === 'cutscene' ? 'walk' : this.prevMode);
      try { this.player?.setCutscene(false); } catch { /* player already disposed */ }
    }
    if (this.hidHud && a.state === this.startState) a.ui.setHudVisible(true);
  }
}

interface Pending { def: CutsceneDef; opts: CutscenePlayOpts; resolvers: Array<(r: CutsceneResult) => void> }

export function createCutscenePlayer(): CutscenePlayer {
  const defs = new Map<CutsceneId, CutsceneDef>();
  const hooks = new Map<string, CutsceneHookFn>();
  const endFns = new Set<(id: CutsceneId, r: CutsceneResult) => void>();
  const queue: Pending[] = [];
  let run: Run | null = null;
  let cur: Pending | null = null;

  function pump(): void {
    if (run || cur) return;
    const p = queue.shift();
    if (!p) return;
    cur = p;
    const r = new Run(p.def, p.opts, host);
    run = r;
    try { r.start(); } catch (e) { log.error('cutscene', `${p.def.id} failed to start`, e); r.finish('aborted'); }
  }

  const host: RunHost = {
    hooks,
    ended(r, result) {
      const p = cur;
      run = null; cur = null;
      if (!p) return;
      const id = r.def.id;
      bus.emit('cutscene:end', { id, result });
      for (const fn of [...endFns]) { try { fn(id, result); } catch (e) { log.error('cutscene', 'onEnd', e); } }
      const next = r.def.chain ? defs.get(r.def.chain) : undefined;
      if (r.def.chain && !next) log.warn('cutscene', `${id}: chain target "${r.def.chain}" is not registered`);
      if (next && result !== 'aborted') queue.unshift({ def: next, opts: { vars: { ...r.vars }, seed: p.opts.seed }, resolvers: p.resolvers });
      else for (const res of p.resolvers) res(result);
      pump();
      if (!run) void app.ui.fade(0, FADE_BACK);                  // last scene: black → world
    },
  };

  const api: CutscenePlayer = {
    register(def) {
      if (!(def.duration > 0)) log.warn('cutscene', `${def.id}: duration must be > 0`);
      defs.set(def.id, def);
      return () => { if (defs.get(def.id) === def) defs.delete(def.id); };
    },
    has: (id) => defs.has(id),
    get: (id) => defs.get(id),
    list: () => [...defs.values()],
    registerHook(name, fn) { hooks.set(name, fn); return () => { if (hooks.get(name) === fn) hooks.delete(name); }; },
    get playing() { return cur?.def.id ?? null; },
    get time() { return run?.t ?? 0; },

    play(id, o = {}) {
      const def = defs.get(id);
      if (!def) { log.warn('cutscene', `unknown cutscene "${id}"`); return Promise.resolve('aborted'); }
      return new Promise<CutsceneResult>((resolve) => {
        queue.push({ def, opts: o, resolvers: [resolve] });
        pump();
      });
    },

    skip() { run?.requestSkip(); },
    forceSkip() { run?.finish('skipped'); },
    abort() {
      const waiting = queue.splice(0);
      run?.finish('aborted');
      for (const p of waiting) for (const res of p.resolvers) res('aborted');
    },
    resolveGate(id, value = 0) { run?.settle(id, value); },
    onEnd(fn) { endFns.add(fn); return () => { endFns.delete(fn); }; },
    update(dt) { run?.update(dt); },
  };

  // a scene never outlives the state that started it (the new state owns input, HUD and camera)
  bus.on('app:state', ({ to }) => { if (run && run.startState !== to) api.abort(); });
  return api;
}
