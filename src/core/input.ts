/**
 * Input service (CORE-INPUT). Implements the frozen `Input` (input/types.ts, TECH_SPEC §2.6) on keyboard, mouse,
 * wheel and the Pointer Lock API. CORE-INPUT must keep the type re-export below: the spec's path is `@/core/input`.
 *
 * Model
 *  - DOM events are queued with their timestamp and dispatched once per fixed step in `beginStep()`:
 *    walk actions become polled state (`down/pressed/released`, edge flags cleared in `endStep()`) plus `on()` callbacks;
 *    machine actions go to the seated machine's `MachineSink` (with raw `code` + `mods`, see `MachineInputEventX`).
 *  - Effective `mode` = 'ui' while the UI overlay is blocking (`ui:blocking` event) or a text field has focus,
 *    otherwise the mode the game set. Entering 'walk' (re)acquires pointer lock; 'machine' / 'menu' / 'ui' release it.
 *    A lock lost to the browser's Esc becomes a synthetic `pause` press. A refused lock raises the "CLICK TO CONTINUE"
 *    veil (`input:veil`, drawn by core/ui).
 *  - Seated rules (§11.6): RMB is a TAP (< 0.2 s → `secondary`), RMB hold = free-look (`freeLook`, `look()` deltas);
 *    wheel notches become `WheelUp/WheelDown` presses; unbound keys reach the sink as `{action:'key'}` with their `code`
 *    (device letters J/K/L, P, [ ] …); Esc pauses, E stands up.
 *  - Never binds Ctrl/Alt/Meta chords (browser shortcuts keep working); F5/F11/F12 stay with the browser.
 */
import * as THREE from 'three';
import type {
  Action, BindingKey, Input, InputMode, MachineAction, MachineInputEvent, MachineSink,
} from './input/types';
import {
  ALL_DEFAULTS, CUTSCENE_SKIP_CODES, MODIFIER_CODES, RESERVED_CODES, SEATED_WALK_ACTIONS, TAP_ONLY_CODES,
  codeLabel,
} from './keymap';
import { bus } from './events';
import { app } from './app';
import { damp, DEG2RAD } from './math';
import { t } from './i18n';
import { log } from './log';

export type * from './input/types';

declare module './events' {
  interface GameEvents {
    /** Show / hide the "CLICK TO CONTINUE" veil (pointer lock refused or lost). Drawn by core/ui. */
    'input:veil': { show: boolean };
    /** A binding changed (rebind / reset). `key` = binding key, or '*' for a full reset. */
    'input:rebind': { key: string };
    /** The UI overlay gained / lost a modal-like surface (modal, choice-with-focus, flagged panel). */
    'ui:blocking': { blocking: boolean };
  }
}

export interface Mods { shift: boolean; ctrl: boolean; alt: boolean }
/** What machines actually receive: the frozen event plus the raw code and modifier state (§11.6). */
export interface MachineInputEventX extends MachineInputEvent { code: string; mods: Mods }

/** Service surface beyond the frozen `Input` (cast `app.input as InputExt` where needed). */
export interface InputExt extends Input {
  /** True while the seated player holds RMB past the tap window (camera free-look; `look()` delivers deltas). */
  readonly freeLook: boolean;
  /** Drop every user rebinding and persist. */
  resetBindings(): void;
  /** Codes currently bound to a binding key (copy). */
  codesOf(key: string): string[];
  /** Every binding key with its codes (frozen + extra, copy). */
  allBindings(): Record<string, string[]>;
}

/** Parallax state of the seated camera (radians); advance with {@link stepParallax}. */
export interface Parallax { yaw: number; pitch: number }

/**
 * Cursor parallax while seated (§2.6): yaw offset = ndc.x × 4°, pitch = ndc.y × 3°, damped k = 10 / s.
 * Add `p.yaw` / `p.pitch` to the seat pose's orientation; `strength` 0..1 scales it (accessibility / cutscenes).
 */
export function stepParallax(p: Parallax, ndc: THREE.Vector2, dt: number, strength = 1): Parallax {
  p.yaw = damp(p.yaw, ndc.x * 4 * DEG2RAD * strength, 10, dt);
  p.pitch = damp(p.pitch, ndc.y * 3 * DEG2RAD * strength, 10, dt);
  return p;
}

interface Raw { code: string; down: boolean; repeat: boolean; t: number; mods: Mods }
interface PtrEvt { type: 'down' | 'up' | 'move'; button: 0 | 1 | 2; ndc: THREE.Vector2; t: number }

const PREVENT = new Set([
  'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F1', 'F3', 'F4', 'Slash', 'Quote',
]);
const TAP_MS = 200;               // RMB tap window
const WHEEL_MOUSE_PX = 50;        // |deltaY| at or above this = a real mouse notch (fires immediately)
const WHEEL_STEP_PX = 100;        // trackpad accumulation per notch
const MAX_LOOK_PX = 500;          // Chromium occasionally reports a huge movementX when the lock toggles
const EMPTY: readonly string[] = [];

function isTextEl(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    || (el instanceof HTMLInputElement && !/^(button|checkbox|radio|range|submit|reset|image|file|color)$/.test(el.type));
}

class InputImpl implements InputExt {
  locked = false;
  readonly pointerNdc = new THREE.Vector2();
  freeLook = false;

  private base: InputMode = 'menu';
  private uiBlocked = false;
  private domText = false;                 // a text-like element has DOM focus
  private textEl: HTMLElement | null = null;   // explicit `textFocus(el)`
  private bind: Record<string, string[]> = {};
  private custom: Record<string, string[]> = {};
  private reverse = new Map<string, string[]>();
  private queue: Raw[] = [];
  private ptrQueue: PtrEvt[] = [];
  private phys = new Set<string>();        // physically held codes (always mirrored at event time)
  private walkHeld = new Map<string, Set<string>>();
  private machHeld = new Map<string, Set<string>>();
  private down_ = new Set<string>();
  private pressed_ = new Set<string>();
  private released_ = new Set<string>();
  private pendDx = 0; private pendDy = 0;  // movement since the last frame sample
  private availDx = 0; private availDy = 0;
  private sink: MachineSink | null = null;
  private listeners = new Map<string, Set<(down: boolean) => void>>();
  private expectUnlock = false;
  private lockPending: Promise<boolean> | null = null;
  private veil = false;
  private rmbT = -1;                       // RMB press time (ms), −1 = up
  private wheelAcc = 0;
  private readonly moveOut = { x: 0, z: 0 };
  private readonly lookOut = { dx: 0, dy: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, keybinds: Partial<Record<string, string[]>>) {
    for (const [k, v] of Object.entries(ALL_DEFAULTS)) this.bind[k] = [...v];
    for (const [k, v] of Object.entries(keybinds)) {
      if (k in ALL_DEFAULTS && Array.isArray(v) && v.every((c) => typeof c === 'string')) {
        this.bind[k] = v.slice(0, 4);
        this.custom[k] = this.bind[k];
      }
    }
    this.rebuild();

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    canvas.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    document.addEventListener('contextmenu', (e) => { if (!isTextEl(e.target)) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('focusin', (e) => this.setFlags(() => { this.domText = isTextEl(e.target); }));
    document.addEventListener('focusout', (e) => {
      if (!isTextEl(e.relatedTarget)) this.setFlags(() => { this.domText = false; });
    });
    bus.on('ui:blocking', ({ blocking }) => this.setFlags(() => { this.uiBlocked = blocking; }));
    this.applyCursor(this.mode);
  }

  // ── mode ────────────────────────────────────────────────────────────────────────────────────────
  get mode(): InputMode { return this.uiBlocked || this.domText || this.textEl ? 'ui' : this.base; }

  setMode(m: InputMode): void { this.setFlags(() => { this.base = m; }); }

  /** Apply a state change, then run the enter / leave side effects if the *effective* mode changed. */
  private setFlags(change: () => void): void {
    const prev = this.mode;
    change();
    const cur = this.mode;
    if (cur === prev) return;
    this.releaseWalk();
    this.releaseMachine();
    this.rmbT = -1; this.freeLook = false; this.wheelAcc = 0;
    this.pendDx = this.pendDy = this.availDx = this.availDy = 0;
    this.ptrQueue.length = 0;
    this.applyCursor(cur);
    if (cur === 'walk' || cur === 'machine' || cur === 'cutscene') this.focusCanvas();
    if (cur === 'walk') { void this.requestLock(); }
    else {
      if (cur !== 'cutscene') this.exitLock();
      this.setVeil(false);
    }
  }

  private applyCursor(m: InputMode): void {
    this.canvas.dataset.cursor = m === 'walk' || (m === 'cutscene' && this.locked) ? 'none' : 'glove';
  }
  private focusCanvas(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== this.canvas && a !== document.body) a.blur();
    this.canvas.focus({ preventScroll: true });
  }

  // ── pointer lock ────────────────────────────────────────────────────────────────────────────────
  requestLock(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    if (this.lockPending) return this.lockPending;
    const p = this.acquireLock().then((ok) => {
      this.lockPending = null;
      this.setVeil(!ok && this.mode === 'walk');
      return ok;
    });
    this.lockPending = p;
    return p;
  }

  private attemptLock(opts?: { unadjustedMovement: boolean }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean): void => {
        if (settled) return;
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(v);
      };
      const onChange = (): void => finish(document.pointerLockElement === this.canvas);
      const onError = (): void => finish(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const r = (this.canvas.requestPointerLock as (o?: object) => Promise<void> | undefined).call(this.canvas, opts);
        if (r && typeof r.then === 'function') r.then(() => finish(document.pointerLockElement === this.canvas), () => finish(false));
      } catch { finish(false); }
      setTimeout(() => finish(document.pointerLockElement === this.canvas), 1500);
    });
  }

  private async acquireLock(): Promise<boolean> {
    let ok = await this.attemptLock({ unadjustedMovement: true });   // raw mouse (no OS acceleration) where supported
    if (!ok && !document.pointerLockElement) ok = await this.attemptLock();
    return ok;
  }

  exitLock(): void {
    if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock(); }
  }

  private onLockChange(): void {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.canvas;
    if (was && !this.locked) {
      if (this.expectUnlock) this.expectUnlock = false;
      else if (this.mode === 'walk' || this.mode === 'cutscene') this.pushPause();   // the browser ate Esc
    }
    if (this.locked) this.setVeil(false);
    bus.emit('input:lock', { locked: this.locked });
  }

  private setVeil(show: boolean): void {
    if (show === this.veil) return;
    this.veil = show;
    bus.emit('input:veil', { show });
  }

  /** Esc while pointer-locked never reaches the page; the lock loss stands in for it. */
  private pushPause(): void {
    const t0 = performance.now();
    const mods = { shift: false, ctrl: false, alt: false };
    this.queue.push({ code: '__pause', down: true, repeat: false, t: t0, mods }, { code: '__pause', down: false, repeat: false, t: t0, mods });
  }

  // ── DOM events ──────────────────────────────────────────────────────────────────────────────────
  private mods(e: KeyboardEvent | MouseEvent | WheelEvent): Mods { return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey }; }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    if (!code) return;
    if (down) this.phys.add(code); else this.phys.delete(code);
    if (isTextEl(e.target)) return;
    if (down && (e.ctrlKey || e.metaKey || e.altKey || RESERVED_CODES.has(code))) return;   // browser shortcuts
    const mode = this.mode;
    if (mode === 'ui') return;
    if (mode !== 'menu' && (PREVENT.has(code) || this.reverse.has(code))) e.preventDefault();
    if (!down && e.repeat) return;
    this.queue.push({ code, down, repeat: e.repeat, t: performance.now(), mods: this.mods(e) });
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    const mode = this.mode;
    if (e.button >= 3 && !isTextEl(e.target)) e.preventDefault();          // side buttons must not navigate history
    const b = Math.min(2, e.button) as 0 | 1 | 2;
    const code = `Mouse${e.button}`;
    if (down) {
      if (e.target !== this.canvas || mode === 'ui') return;
      if (mode === 'walk' && !this.locked) { void this.requestLock(); return; }   // the click that re-locks is swallowed
      this.phys.add(code);
    } else {
      this.phys.delete(code);
      if (mode === 'ui') return;
    }
    this.queue.push({ code, down, repeat: false, t: performance.now(), mods: this.mods(e) });
    if (mode === 'machine') {
      this.updateNdc(e);
      this.pushPtr({ type: down ? 'down' : 'up', button: b, ndc: this.pointerNdc.clone(), t: performance.now() });
    }
  }

  private onMove(e: MouseEvent): void {
    const mode = this.mode;
    if (this.locked) {
      if (Math.abs(e.movementX) < MAX_LOOK_PX && Math.abs(e.movementY) < MAX_LOOK_PX) { this.pendDx += e.movementX; this.pendDy += e.movementY; }
      return;
    }
    this.updateNdc(e);
    if (mode === 'machine') {
      if (this.rmbT >= 0 && performance.now() - this.rmbT >= TAP_MS) {
        this.freeLook = true;
        this.pendDx += e.movementX; this.pendDy += e.movementY;
      }
      this.pushPtr({ type: 'move', button: 0, ndc: this.pointerNdc.clone(), t: performance.now() });
    }
  }

  private pushPtr(p: PtrEvt): void {
    const last = this.ptrQueue[this.ptrQueue.length - 1];
    if (p.type === 'move' && last?.type === 'move') { last.ndc.copy(p.ndc); last.t = p.t; return; }   // coalesce moves
    if (this.ptrQueue.length < 64) this.ptrQueue.push(p);
  }

  private updateNdc(e: MouseEvent): void {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    this.pointerNdc.set((e.clientX / w) * 2 - 1, -((e.clientY / h) * 2 - 1));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const mode = this.mode;
    if (mode !== 'machine' && mode !== 'walk') return;
    const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);   // lines / pages → px
    let notch = 0;
    if (Math.abs(px) >= WHEEL_MOUSE_PX) { notch = Math.sign(px); this.wheelAcc = 0; }
    else {
      if (Math.sign(px) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
      this.wheelAcc += px;
      if (Math.abs(this.wheelAcc) >= WHEEL_STEP_PX) { notch = Math.sign(this.wheelAcc); this.wheelAcc = 0; }
    }
    if (!notch) return;
    const code = notch < 0 ? 'WheelUp' : 'WheelDown';
    const t0 = performance.now(), mods = this.mods(e);
    this.queue.push({ code, down: true, repeat: false, t: t0, mods }, { code, down: false, repeat: false, t: t0, mods });
  }

  /** Window lost focus / tab hidden: synthesize releases so nothing stays stuck. */
  private releaseAll(): void {
    const t0 = performance.now(), mods = { shift: false, ctrl: false, alt: false };
    for (const code of this.phys) this.queue.push({ code, down: false, repeat: false, t: t0, mods });
    this.phys.clear();
    this.rmbT = -1; this.freeLook = false;
  }

  // ── polling API ─────────────────────────────────────────────────────────────────────────────────
  down(a: Action): boolean { return this.down_.has(a); }
  pressed(a: Action): boolean { return this.pressed_.has(a); }
  released(a: Action): boolean { return this.released_.has(a); }
  move(): { x: number; z: number } {
    const x = (this.down_.has('right') ? 1 : 0) - (this.down_.has('left') ? 1 : 0);
    const z = (this.down_.has('back') ? 1 : 0) - (this.down_.has('fwd') ? 1 : 0);
    const l = Math.hypot(x, z) || 1;
    this.moveOut.x = x / l; this.moveOut.z = z / l;
    return this.moveOut;
  }
  look(): { dx: number; dy: number } {
    this.lookOut.dx = this.availDx; this.lookOut.dy = this.availDy;
    this.availDx = 0; this.availDy = 0;
    return this.lookOut;
  }
  on(a: Action, fn: (down: boolean) => void): () => void {
    let set = this.listeners.get(a);
    if (!set) { set = new Set(); this.listeners.set(a, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }
  setMachineSink(s: MachineSink | null): void {
    if (s === this.sink) return;
    this.releaseMachine();
    this.sink = s;
  }

  // ── bindings ────────────────────────────────────────────────────────────────────────────────────
  bindings(): Record<BindingKey, string[]> { return this.allBindings() as Record<BindingKey, string[]>; }
  allBindings(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(this.bind)) out[k] = [...v];
    return out;
  }
  codesOf(key: string): string[] { return [...(this.bind[key] ?? [])]; }

  rebind(a: BindingKey, codes: string[]): void {
    const key: string = a;
    if (!(key in ALL_DEFAULTS)) { log.warn('input', `rebind: unknown binding "${key}"`); return; }
    const clean = [...new Set(codes.filter((c) => typeof c === 'string' && c && !RESERVED_CODES.has(c)))].slice(0, 4);
    this.bind[key] = clean;
    if (sameCodes(clean, ALL_DEFAULTS[key])) delete this.custom[key]; else this.custom[key] = clean;
    this.rebuild();
    this.persist();
    bus.emit('input:rebind', { key });
  }

  resetBindings(): void {
    for (const [k, v] of Object.entries(ALL_DEFAULTS)) this.bind[k] = [...v];
    this.custom = {};
    this.rebuild();
    this.persist();
    bus.emit('input:rebind', { key: '*' });
  }

  keyLabel(a: BindingKey): string {
    const c = this.bind[a]?.[0];
    return c ? codeLabel(c) : t('ui.key.none');
  }

  private rebuild(): void {
    this.reverse.clear();
    const add = (code: string, key: string): void => {
      const list = this.reverse.get(code);
      if (list) list.push(key); else this.reverse.set(code, [key]);
    };
    for (const [k, codes] of Object.entries(this.bind)) for (const c of codes) add(c, k);
    add('__pause', 'pause');                    // synthetic: pointer lock lost to Esc
  }

  private persist(): void {
    try { app?.save?.setSetting('keybinds', { ...this.custom }); } catch (e) { log.warn('input', 'could not persist keybinds', e); }
  }

  // ── text fields ─────────────────────────────────────────────────────────────────────────────────
  textFocus(el: HTMLInputElement | null): void {
    if (el) {
      this.setFlags(() => { this.textEl = el; });
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      el.addEventListener('blur', () => { if (this.textEl === el) this.textFocus(null); }, { once: true });
    } else {
      this.setFlags(() => { this.textEl = null; });
    }
  }

  // ── step pipeline ───────────────────────────────────────────────────────────────────────────────
  beginFrame(): void {
    this.availDx += this.pendDx; this.availDy += this.pendDy;
    this.pendDx = 0; this.pendDy = 0;
    if (this.rmbT >= 0 && !this.freeLook && this.mode === 'machine' && performance.now() - this.rmbT >= TAP_MS) this.freeLook = true;
  }

  beginStep(): void {
    if (this.queue.length) {
      const q = this.queue; this.queue = [];
      for (const r of q) this.dispatch(r);
    }
    if (this.ptrQueue.length) {
      const pq = this.ptrQueue; this.ptrQueue = [];
      const s = this.sink;
      if (s && this.mode === 'machine' && s.mouse === 'pick') {
        for (const p of pq) { try { s.onPointer(p); } catch (e) { log.error('input', 'machine onPointer', e); } }
      }
    }
  }

  endStep(): void {
    if (this.pressed_.size) this.pressed_.clear();
    if (this.released_.size) this.released_.clear();
  }

  private dispatch(r: Raw): void {
    const mode = this.mode;
    if (mode === 'ui') return;
    const keys = this.reverse.get(r.code) ?? EMPTY;
    let machineBound = false;
    let walkHandled = false;
    let skipped = false;
    for (const k of keys) {
      if (k.startsWith('m.')) {
        if (mode === 'machine') { machineBound = true; this.dispatchMachine(k.slice(2), r); }
      } else {
        if (k === 'skip') skipped = true;
        if (this.dispatchWalk(k, r, mode)) walkHandled = true;
      }
    }
    if (mode === 'cutscene' && !skipped && CUTSCENE_SKIP_CODES.includes(r.code)) this.dispatchWalk('skip', r, mode);
    // unbound at the machine (and not a live seated walk action such as Esc / Tab / F1) → device letters: delivered raw
    if (mode === 'machine' && !machineBound && !walkHandled && !MODIFIER_CODES.has(r.code) && !r.code.startsWith('Mouse')
        && !r.code.startsWith('Wheel') && r.code !== '__pause') {
      this.sendMachine('key', r.down, r.repeat, r);
    }
  }

  /** Route a walk-layer action. Returns whether the action is live in the current mode (it may still be a repeat). */
  private dispatchWalk(a: string, r: Raw, mode: InputMode): boolean {
    const allowed = mode === 'walk'
      || (mode === 'machine' && SEATED_WALK_ACTIONS.has(a) && !(a === 'chat' && (r.code === 'Enter' || r.code === 'NumpadEnter')))
      || (mode === 'cutscene' && (a === 'skip' || a === 'pause'))
      || (mode === 'menu' && a === 'pause');
    if (!allowed) return false;
    let set = this.walkHeld.get(a);
    if (r.down) {
      if (r.repeat) return true;
      if (!set) { set = new Set(); this.walkHeld.set(a, set); }
      if (set.has(r.code)) return true;
      const first = set.size === 0;
      set.add(r.code);
      if (first) { this.down_.add(a); this.pressed_.add(a); this.fire(a, true); }
    } else {
      if (!set || !set.delete(r.code) || set.size > 0) return true;
      this.down_.delete(a); this.released_.add(a); this.fire(a, false);
    }
    return true;
  }

  private dispatchMachine(action: string, r: Raw): void {
    const sink = this.sink;
    if (!sink) return;
    const pick = sink.mouse === 'pick';
    if (r.code.startsWith('Mouse') && pick) return;                   // pick poses use onPointer only
    if (TAP_ONLY_CODES.has(r.code)) {                                 // RMB: tap = action, hold = free-look
      if (r.down) { this.rmbT = r.t; return; }
      const tap = this.rmbT >= 0 && r.t - this.rmbT < TAP_MS;
      this.rmbT = -1; this.freeLook = false;
      if (tap) { this.sendMachine(action, true, false, r); this.sendMachine(action, false, false, r); }
      return;
    }
    let set = this.machHeld.get(action);
    if (r.down) {
      if (r.repeat) { if (set?.has(r.code)) this.sendMachine(action, true, true, r); return; }
      if (!set) { set = new Set(); this.machHeld.set(action, set); }
      if (set.has(r.code)) return;
      const first = set.size === 0;
      set.add(r.code);
      if (first) this.sendMachine(action, true, false, r);
    } else {
      if (!set || !set.delete(r.code) || set.size > 0) return;
      this.sendMachine(action, false, false, r);
    }
  }

  private sendMachine(action: string, down: boolean, repeat: boolean, r: Raw): void {
    const s = this.sink;
    if (!s) return;
    const e: MachineInputEventX = { action: action as MachineAction, down, repeat, t: r.t, code: r.code, mods: r.mods };
    try { s.onInput(e); } catch (err) { log.error('input', `machine onInput(${action})`, err); }
  }

  private fire(a: string, down: boolean): void {
    const set = this.listeners.get(a);
    if (!set) return;
    for (const fn of [...set]) { try { fn(down); } catch (e) { log.error('input', `on(${a})`, e); } }
  }

  /** Mode left 'walk' (or a modal opened): every held walk action ends with a release so nothing sticks. */
  private releaseWalk(): void {
    if (!this.walkHeld.size) return;
    for (const [a, set] of this.walkHeld) {
      if (set.size && this.down_.delete(a)) { this.released_.add(a); this.fire(a, false); }
      set.clear();
    }
    this.walkHeld.clear();
  }

  /** Mode left 'machine' or the sink changed: release every held machine action on the sink that held it. */
  private releaseMachine(): void {
    if (!this.machHeld.size) return;
    const s = this.sink, t0 = performance.now();
    const mods = { shift: false, ctrl: false, alt: false };
    for (const [action, set] of this.machHeld) {
      if (!set.size) continue;
      const code = set.values().next().value as string;
      set.clear();
      if (s) {
        const e: MachineInputEventX = { action: action as MachineAction, down: false, repeat: false, t: t0, code, mods };
        try { s.onInput(e); } catch (err) { log.error('input', `machine release(${action})`, err); }
      }
    }
    this.machHeld.clear();
  }
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export function createInput(canvas: HTMLCanvasElement, keybinds: Partial<Record<string, string[]>> = {}): InputExt {
  return new InputImpl(canvas, keybinds);
}
