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
 *    A lock lost to the browser's Esc becomes a synthetic `pause` press.
 *  - Lock refused (or `?nolock=1`) → automatic DRAG-TO-LOOK fallback (`dragLook`): in walk mode, holding LMB or RMB on
 *    the canvas and moving turns the camera through `look()`. No "click to continue" veil is raised any more.
 *  - Seated rules (§11.6): RMB is a TAP (< 0.28 s, or a press that never moved the pointer more than 4 px at any
 *    duration → `secondary`), RMB hold + drag = free-look (`freeLook`, `look()` deltas);
 *    at `mouse:'pick'` poses RMB goes to `onPointer` and free-look is hold-Alt instead;
 *    wheel notches become `WheelUp/WheelDown` presses; unbound keys reach the sink as `{action:'key'}` with their `code`
 *    (device letters J/K/L, P, [ ] …); Esc pauses, E stands up.
 *  - Key-repeat reaches a machine only for the bet ladder and cursor / aim movement (`REPEATABLE_MACHINE_ACTIONS`).
 *  - Seat glide: while the camera glides into a seat (`seatTransition(true)`, called by the player) the mode is still
 *    'walk'; machine-layer presses made then are buffered (last one wins) and replayed once the machine sink attaches.
 *  - Lock refused in walk mode → a small non-blocking centre hint "CLICK TO CAPTURE MOUSE"; any click while walking and
 *    unlocked requests the lock again (the hint hides on `input:lock`).
 *  - Never binds Ctrl/Alt/Meta chords (browser shortcuts keep working); F5/F11/F12 stay with the browser.
 */
import * as THREE from 'three';
import type {
  Action, BindingKey, Input, InputMode, MachineAction, MachineInputEvent, MachineSink,
} from './input/types';
import {
  ALL_DEFAULTS, BUFFERABLE_MACHINE_ACTIONS, CUTSCENE_SKIP_CODES, MODIFIER_CODES, REPEATABLE_MACHINE_ACTIONS,
  RESERVED_CODES, SEATED_WALK_ACTIONS, TAP_ONLY_CODES, codeLabel,
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
  /** True when walk look comes from drag-to-look (lock refused, or `?nolock=1`) instead of pointer lock. */
  readonly dragLook: boolean;
  /**
   * The player starts (`true`) / ends (`false`) the camera glide into a seat. While on, machine-layer presses are
   * buffered instead of lost and walk actions other than the seated ones are ignored; the last buffered press is
   * replayed once `setMachineSink` attaches a sink in 'machine' mode.
   */
  seatTransition(on: boolean): void;
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

interface Raw {
  code: string; down: boolean; repeat: boolean; t: number; mods: Mods;
  /** RMB release only: the largest pointer travel (px) since the press. */
  moved?: number;
}
interface PtrEvt { type: 'down' | 'up' | 'move'; button: 0 | 1 | 2; ndc: THREE.Vector2; t: number }

const PREVENT = new Set([
  'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F1', 'F3', 'F4', 'Slash', 'Quote',
]);
const TAP_MS = 280;               // RMB tap window (a press that never moved is a tap at any duration)
const TAP_MOVE_PX = 4;            // pointer travel (px) above which an RMB hold turns into free-look
const SEAT_REPLAY_MS = 1500;      // a press buffered during the glide-in is replayed only if younger than this
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
  /** Drag-to-look fallback active (see the header). Set by `?nolock=1` or a refused lock; cleared by a successful lock. */
  dragLook = false;
  /** `?nolock=1`: never request pointer lock (QA automation, odd browsers). */
  private readonly noLock: boolean;
  private dragging = false;                // LMB / RMB held on the canvas during drag-to-look

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
  private rmbX = 0; private rmbY = 0;      // RMB press position (client px)
  private rmbMoved = 0;                    // largest pointer travel since the RMB press
  private seatGlide = false;               // the camera is gliding into a seat (mode still 'walk', no sink yet)
  private seatBuf: { action: string; code: string; mods: Mods; t: number } | null = null;
  private hintEl: HTMLDivElement | null = null;   // "CLICK TO CAPTURE MOUSE"
  private wheelAcc = 0;
  private readonly moveOut = { x: 0, z: 0 };
  private readonly lookOut = { dx: 0, dy: 0 };

  constructor(private readonly canvas: HTMLCanvasElement, keybinds: Partial<Record<string, string[]>>) {
    this.noLock = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nolock') === '1';
    this.dragLook = this.noLock;
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
    bus.on('input:lock', ({ locked }) => { if (locked) this.setCaptureHint(false); });
    bus.on('lang:changed', () => { if (this.hintEl && this.hintEl.style.display !== 'none') this.hintEl.textContent = t('ui.ctl.capture'); });
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
    this.rmbT = -1; this.freeLook = false; this.wheelAcc = 0; this.dragging = false;
    this.pendDx = this.pendDy = this.availDx = this.availDy = 0;
    this.ptrQueue.length = 0;
    this.applyCursor(cur);
    if (cur === 'walk' || cur === 'machine' || cur === 'cutscene') this.focusCanvas();
    if (cur === 'walk') { void this.requestLock(); }
    else {
      if (cur !== 'cutscene') this.exitLock();
      this.setVeil(false);
      this.setCaptureHint(false);
    }
  }

  private applyCursor(m: InputMode): void {
    // walk hides the OS cursor only under pointer lock; drag-to-look keeps it visible so the player can aim the drag
    const hidden = (m === 'walk' && !this.dragLook) || (m === 'cutscene' && this.locked);
    this.canvas.dataset.cursor = hidden ? 'none' : 'glove';
  }
  private focusCanvas(): void {
    const a = document.activeElement;
    if (a instanceof HTMLElement && a !== this.canvas && a !== document.body) a.blur();
    this.canvas.focus({ preventScroll: true });
  }

  // ── pointer lock ────────────────────────────────────────────────────────────────────────────────
  requestLock(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    if (this.noLock) return Promise.resolve(false);                  // ?nolock=1: drag-to-look only
    if (this.lockPending) return this.lockPending;
    const p = this.acquireLock().then((ok) => {
      this.lockPending = null;
      // refused → drag-to-look takes over (no veil); a later successful lock switches back in onLockChange
      if (!ok && !this.dragLook) { this.dragLook = true; this.applyCursor(this.mode); }
      this.setVeil(false);
      this.setCaptureHint(!ok && !this.seatGlide && this.mode === 'walk' && !this.locked);   // refused: tell the player a click will capture
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
    if (this.locked) {
      this.setVeil(false);
      if (this.dragLook) { this.dragLook = false; this.dragging = false; this.applyCursor(this.mode); }
    }
    bus.emit('input:lock', { locked: this.locked });
  }

  /** Small non-blocking centre hint (never a veil): shown when walk-mode pointer lock was refused, hidden on lock. */
  private setCaptureHint(show: boolean): void {
    // never while seated or gliding into a seat (the seat HUD owns the screen; a refused lock during the glide is not a walk hint)
    if (show && (this.seatGlide || this.mode !== 'walk' || this.locked)) show = false;
    if (!show && !this.hintEl) return;
    if (!this.hintEl) {
      const el = document.createElement('div');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,calc(5 * var(--u, 2px)));z-index:6;'
        + 'pointer-events:none;white-space:nowrap;padding:calc(2 * var(--u, 2px)) calc(4 * var(--u, 2px));'
        + 'background:rgba(8,8,8,0.7);color:#efd67b;letter-spacing:0.04em;'
        + "font:calc(6 * var(--u, 2px))/1 var(--f-head, 'Press Start 2P', monospace);display:none;";
      (document.getElementById('ui') ?? document.body).appendChild(el);
      this.hintEl = el;
    }
    if (show) this.hintEl.textContent = t('ui.ctl.capture');
    this.hintEl.style.display = show ? 'block' : 'none';
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
    const dragBtn = e.button === 0 || e.button === 2;
    if (down) {
      if (e.target !== this.canvas || mode === 'ui') return;
      if (mode === 'walk' && !this.locked && !this.seatGlide) {
        // every click while walking unlocked asks for the lock again (a refused auto re-lock needs this gesture)
        if (!this.noLock) void this.requestLock();
        if (!this.dragLook) return;                                   // the click that re-locks is swallowed
        if (dragBtn) this.dragging = true;                            // drag-to-look: this click also starts the drag
      }
      this.phys.add(code);
      if (e.button === 2) { this.rmbX = e.clientX; this.rmbY = e.clientY; this.rmbMoved = 0; }
    } else {
      this.phys.delete(code);
      if (dragBtn) this.dragging = false;
      if (mode === 'ui') return;
    }
    const raw: Raw = { code, down, repeat: false, t: performance.now(), mods: this.mods(e) };
    if (!down && e.button === 2) raw.moved = this.rmbMoved;
    this.queue.push(raw);
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
    if (this.phys.has('Mouse2')) this.rmbMoved = Math.max(this.rmbMoved, Math.hypot(e.clientX - this.rmbX, e.clientY - this.rmbY));
    if (mode === 'walk' && this.dragging) {                          // drag-to-look (unlocked fallback)
      if (Math.abs(e.movementX) < MAX_LOOK_PX && Math.abs(e.movementY) < MAX_LOOK_PX) { this.pendDx += e.movementX; this.pendDy += e.movementY; }
      return;
    }
    if (mode === 'machine') {
      // pick poses: free-look is hold-Alt (RMB belongs to onPointer); other poses: RMB hold past the tap window
      if (this.sink?.mouse === 'pick') this.freeLook = this.altHeld();
      else if (this.rmbT >= 0 && performance.now() - this.rmbT >= TAP_MS && this.rmbMoved > TAP_MOVE_PX) this.freeLook = true;
      if (this.freeLook) { this.pendDx += e.movementX; this.pendDy += e.movementY; }
      this.pushPtr({ type: 'move', button: 0, ndc: this.pointerNdc.clone(), t: performance.now() });
    }
  }

  private altHeld(): boolean { return this.phys.has('AltLeft') || this.phys.has('AltRight'); }

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
  anyPressed(): boolean { return this.pressed_.size > 0; }
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
    if (s === null) this.seatBuf = null;                  // leaving the seat: a stale press must never reach the next one
    if (s === this.sink) return;
    this.releaseMachine();
    this.sink = s;
  }

  seatTransition(on: boolean): void {
    this.seatGlide = on;
    if (on) { this.seatBuf = null; this.releaseWalk(); this.setCaptureHint(false); }   // walk actions end; the buffer starts empty
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
    if (this.mode === 'machine') {
      if (this.sink?.mouse === 'pick') this.freeLook = this.altHeld();
      else if (this.rmbT >= 0 && !this.freeLook && performance.now() - this.rmbT >= TAP_MS && this.rmbMoved > TAP_MOVE_PX) this.freeLook = true;
    }
  }

  beginStep(): void {
    if (this.seatBuf) this.replaySeatBuffer();
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
    const gliding = this.seatGlide && mode === 'walk';     // gliding into a seat: seated walk rules, machine presses buffered
    const wmode = gliding ? 'machine' : mode;
    const keys = this.reverse.get(r.code) ?? EMPTY;
    let machineBound = false;
    let walkHandled = false;
    let skipped = false;
    for (const k of keys) {
      if (k.startsWith('m.')) {
        if (mode === 'machine') { machineBound = true; this.dispatchMachine(k.slice(2), r); }
        else if (gliding) this.bufferSeatPress(k.slice(2), r);
      } else {
        if (k === 'skip') skipped = true;
        if (this.dispatchWalk(k, r, wmode)) walkHandled = true;
      }
    }
    if (mode === 'cutscene' && !skipped && (CUTSCENE_SKIP_CODES.includes(r.code) || r.code === '__pause')) this.dispatchWalk('skip', r, mode);
    // unbound at the machine (and not a live seated walk action such as Esc / Tab / F1) → device letters: delivered raw
    if (mode === 'machine' && !machineBound && !walkHandled && !MODIFIER_CODES.has(r.code) && !r.code.startsWith('Mouse')
        && !r.code.startsWith('Wheel') && r.code !== '__pause' && !(r.down && r.repeat)) {   // device letters never auto-repeat
      this.sendMachine('key', r.down, r.repeat, r);
    }
  }

  /** Remember the last machine-layer press made while the camera glides into the seat (see `seatTransition`). */
  private bufferSeatPress(action: string, r: Raw): void {
    if (!r.down || r.repeat || !BUFFERABLE_MACHINE_ACTIONS.has(action)) return;
    this.seatBuf = { action, code: r.code, mods: r.mods, t: r.t };
  }

  /** The sink attached and the mode is 'machine': replay the buffered press once (down + up), or drop it when stale. */
  private replaySeatBuffer(): void {
    const b = this.seatBuf;
    if (!b) return;
    const now = performance.now();
    if (now - b.t > SEAT_REPLAY_MS) { this.seatBuf = null; return; }
    if (this.seatGlide || this.mode !== 'machine' || !this.sink) return;          // still gliding: keep waiting
    this.seatBuf = null;
    this.dispatchMachine(b.action, { code: b.code, down: true, repeat: false, t: now, mods: b.mods });
    this.dispatchMachine(b.action, { code: b.code, down: false, repeat: false, t: now, mods: b.mods });
  }

  /** Route a walk-layer action. Returns whether the action is live in the current mode (it may still be a repeat). */
  private dispatchWalk(a: string, r: Raw, mode: InputMode): boolean {
    const allowed = mode === 'walk'
      || (mode === 'machine' && SEATED_WALK_ACTIONS.has(a) && !(a === 'chat' && (r.code === 'Enter' || r.code === 'NumpadEnter')))
      || (mode === 'cutscene' && a === 'skip')                       // cutscenes: Esc / lock loss only skip, never pause
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
      // tap = a short press, or one that never moved the pointer (more than TAP_MOVE_PX) however long it lasted
      const tap = this.rmbT >= 0 && (r.t - this.rmbT < TAP_MS || (r.moved ?? 0) <= TAP_MOVE_PX);
      this.rmbT = -1; this.freeLook = false;
      if (tap) { this.sendMachine(action, true, false, r); this.sendMachine(action, false, false, r); }
      return;
    }
    let set = this.machHeld.get(action);
    if (r.down) {
      if (r.repeat) {                                                 // auto-repeat: bet ladder and cursor movement only
        if (set?.has(r.code) && REPEATABLE_MACHINE_ACTIONS.has(action)) this.sendMachine(action, true, true, r);
        return;
      }
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
