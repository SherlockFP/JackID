/**
 * UI widget kit (CORE-UI). Small DOM builders in the JackID pixel style (ART_BIBLE §10): every size is a multiple of
 * the integer pixel unit `--u` (= `--px` CSS px), fonts are Press Start 2P (labels) / VT323 (body), colours come from the
 * 48-colour palette. Menus, settings, the HUD and the pause screen compose these instead of hand-rolling DOM.
 *
 *  frames & layout   frame · field · scroll · keycap · pixelIcon · iconEl · modalPanel · navGroup
 *  controls          button (hold-to-confirm) · toggle · slider · cycle · textField · tabs · list · keyBind
 *  HUD pieces        counter (rolling numbers) · bar · statusRow (buff / debuff icons) · tip (tooltips)
 *
 * Widgets return a handle `{ el, … }`; `el` is already appended to `parent`. Every player-visible string passed in must
 * already be translated; the few built-in ones live in `ui.strings.ts`. All pointer sounds go through `uiSfx`.
 */
import { app } from '../app';
import { bus } from '../events';
import { t, upper } from '../i18n';
import { clamp } from '../math';
import { createRng } from '../rng';
import { actionLabel, codeLabels, conflictsFor, layerOf, MODIFIER_CODES, RESERVED_CODES } from '../keymap';
import type { InputExt } from '../input';
import type { BindingKey } from '../input/types';

// ── palette (ART_BIBLE §2.1) ─────────────────────────────────────────────────────────────────────
export const COLORS = {
  void: '#080808', black: '#101019', soot: '#191921', coal: '#292131', ash: '#3a3a42', slate: '#5a525a',
  concrete: '#7b736b', grout: '#9c9484', bone: '#c5bda5', ivory: '#e6dec5', paper: '#f7efde',
  oxblood: '#5a1019', red: '#8c1921', signal: '#c52129', coral: '#ef5a4a', amber: '#e69431', bulb: '#ffce5a',
  brassDark: '#4a3a19', brass: '#8c6b29', gold: '#c59c42', shine: '#efd67b', green: '#5aff7b', cyan: '#63e6de',
  violet: '#9c4aff', ice: '#bdf7ef',
} as const;

/** Cosmetic randomness for UI juice only (never outcomes). */
export const uiRng = createRng(0x6a61636b);

// ── tiny DOM helpers ─────────────────────────────────────────────────────────────────────────────
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, parent?: Node | null, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

let rootEl: HTMLElement | null = null;
let blockingHook: (() => void) | null = null;
/** Called by `createUI`; widgets that float (tooltips) attach to this root. */
export function initWidgets(r: HTMLElement, onBlockingChange: () => void): void { rootEl = r; blockingHook = onBlockingChange; }
const root = (): HTMLElement => rootEl ?? document.getElementById('ui') ?? document.body;
const settings = (): { reduceFlashing: boolean; holdToConfirm: boolean; colorblind: boolean } | undefined =>
  app?.save?.data?.settings;

const lastSfx: Record<string, number> = {};
/** UI-bus sound with a 40 ms per-name rate limit; silent if audio is not ready. */
export function uiSfx(name: string, vol = 1): void {
  const now = performance.now();
  if (now - (lastSfx[name] ?? -1e9) < 40) return;
  lastSfx[name] = now;
  try { app?.audio?.play(name, { bus: 'ui', vol }); } catch { /* audio is optional */ }
}

// ── tickers (counters etc. register while animating; ui.update(dt) drives them) ───────────────────
const tickers = new Set<(dt: number) => boolean | void>();
/** Run `fn(dt)` every frame until it returns `false`. */
export function addTicker(fn: (dt: number) => boolean | void): void { tickers.add(fn); }
export function tickWidgets(dt: number): void {
  if (tickers.size === 0) return;
  for (const fn of tickers) if (fn(dt) === false) tickers.delete(fn);
}

// ── pixel icons (box-shadow bitmaps, scale with --u, no images) ───────────────────────────────────
const PAL: Record<string, string> = {
  o: COLORS.black, w: COLORS.paper, i: COLORS.ivory, g: COLORS.gold, s: COLORS.shine, b: COLORS.brass, r: COLORS.signal,
  d: COLORS.oxblood, n: COLORS.green, a: COLORS.amber, c: COLORS.cyan, v: COLORS.violet, k: COLORS.concrete, y: COLORS.grout,
};
export type IconName =
  | 'coin' | 'ticket' | 'check' | 'cross' | 'warn' | 'info' | 'net' | 'bell' | 'lock' | 'star' | 'arrowL' | 'arrowR' | 'curse';
const ICONS: Record<IconName, readonly string[]> = {
  coin: ['..oooo..', '.ossssgo', 'ossgggbo', 'osggsgbo', 'osggsgbo', 'osgggbbo', '.ogbbbo.', '..oooo..'],
  ticket: ['........', 'oooooooo', 'orrrrrro', 'orriirro', 'orriirro', 'orrrrrro', 'oooooooo', '........'],
  check: ['........', '......nn', '.....nn.', 'nn..nn..', '.nnnn...', '..nn....', '........', '........'],
  cross: ['rr....rr', 'rrr..rrr', '.rrrrrr.', '..rrrr..', '..rrrr..', '.rrrrrr.', 'rrr..rrr', 'rr....rr'],
  warn: ['...aa...', '...aa...', '..aaaa..', '..aooa..', '.aaooaa.', '.aaaaaa.', 'aaaooaaa', 'aaaaaaaa'],
  info: ['..cccc..', '.cccccc.', '.ccwwcc.', '.cccccc.', '.ccwwcc.', '.ccwwcc.', '.ccwwcc.', '..cccc..'],
  net: ['......cc', '......cc', '....cccc', '....cccc', '..cccccc', '..cccccc', 'cccccccc', 'cccccccc'],
  bell: ['...aa...', '..aaaa..', '.aaaaaa.', '.aaaaaa.', '.aaaaaa.', 'aaaaaaaa', '........', '...aa...'],
  lock: ['..kkkk..', '.k....k.', '.k....k.', 'kkkkkkkk', 'kyyyyyyk', 'kyyooyyk', 'kyyooyyk', 'kkkkkkkk'],
  star: ['...ss...', '...ss...', 'ssssssss', '.ssssss.', '..ssss..', '..ssss..', '.ss..ss.', '.s....s.'],
  arrowL: ['...i', '..ii', '.iii', 'iiii', '.iii', '..ii', '...i'],
  arrowR: ['i...', 'ii..', 'iii.', 'iiii', 'iii.', 'ii..', 'i...'],
  curse: ['..vvvv..', '.vvvvvv.', 'vvwwwwvv', 'vwwooowv', 'vwwooowv', 'vvwwwwvv', '.vvvvvv.', '..vvvv..'],
};
const shadowCache = new Map<string, string>();
function shadowsFor(name: IconName, recolor?: Record<string, string>): string {
  const key = recolor ? `${name}|${JSON.stringify(recolor)}` : name;
  let css = shadowCache.get(key);
  if (css === undefined) {
    const parts: string[] = [];
    ICONS[name].forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = recolor?.[row[x]] ?? PAL[row[x]];
        if (c) parts.push(`calc(${x} * var(--u)) calc(${y} * var(--u)) 0 0 ${c}`);
      }
    });
    css = parts.join(',');
    shadowCache.set(key, css);
  }
  return css;
}
/** A pixel-art icon sized in UI px (8×8 for most). `recolor` swaps palette letters, e.g. `{ s: '#9c4aff' }`. */
export function pixelIcon(name: IconName, recolor?: Record<string, string>): HTMLElement {
  const rows = ICONS[name];
  const box = h('span', 'px-ico');
  box.style.width = `calc(${rows[0].length} * var(--u))`;
  box.style.height = `calc(${rows.length} * var(--u))`;
  h('i', undefined, box).style.boxShadow = shadowsFor(name, recolor);
  box.setAttribute('aria-hidden', 'true');
  return box;
}

/** What an icon slot accepts: a texgen symbol id (`'icon.mint'`), an image / canvas, or a literal glyph. */
export type IconSpec = string | HTMLCanvasElement | HTMLImageElement | { glyph: string; color?: string };
const symbolUrls = new Map<string, string>();
/** An `size`-UI-px square holding the icon (texgen symbols are drawn via `app.tex`, cached as data URLs). */
export function iconEl(spec: IconSpec, size = 16): HTMLElement {
  const box = h('span', 'px-icon');
  box.style.width = box.style.height = `calc(${size} * var(--u))`;
  if (typeof spec === 'object' && 'glyph' in spec) {
    h('b', undefined, box, spec.glyph);
    if (spec.color) box.style.color = spec.color;
    return box;
  }
  if (typeof spec !== 'string') {
    const el = spec instanceof HTMLCanvasElement ? spec : spec.cloneNode() as HTMLImageElement;
    box.appendChild(el);
    return box;
  }
  const key = `${spec}@${size}`;
  let url = symbolUrls.get(key);
  if (url === undefined) {
    url = '';
    try {
      const tex = app?.tex?.symbol(spec, size <= 16 ? 16 : size <= 24 ? 24 : size <= 32 ? 32 : 48);
      const img = tex?.image as unknown;
      if (img instanceof HTMLCanvasElement) url = img.toDataURL();
      else if (img instanceof HTMLImageElement) url = img.src;
    } catch { /* unknown symbol → glyph fallback */ }
    symbolUrls.set(key, url);
  }
  if (url) { const im = h('img', undefined, box); im.src = url; im.alt = ''; im.draggable = false; }
  else h('b', undefined, box, upper(spec.replace(/^icon\./, '').slice(0, 1)));
  return box;
}

/** Key cap glyph (`[E]`, `[SPACE]`). */
export function keycap(label: string, parent?: Node): HTMLElement {
  return h('kbd', 'px-key', parent, label);
}

// ── frames, rows, scroll ─────────────────────────────────────────────────────────────────────────
export type FrameVariant = 'brass' | 'cyan' | 'red' | 'violet';
export interface FrameOpts { title?: string; variant?: FrameVariant; width?: number; className?: string }
export interface Frame { readonly el: HTMLElement; readonly body: HTMLElement; setTitle(s: string): void }
/** Art-deco panel: bevelled brass frame, stepped corners, optional title plaque. `width` in UI px. */
export function frame(parent: Node | null, o: FrameOpts = {}): Frame {
  const el = h('div', `px-frame v-${o.variant ?? 'brass'} ${o.className ?? ''}`.trim(), parent);
  if (o.width) el.style.width = `calc(${o.width} * var(--u))`;
  let titleEl: HTMLElement | null = null;
  const setTitle = (s: string): void => {
    if (!titleEl) { titleEl = h('div', 'px-frame-title'); el.prepend(titleEl); }
    titleEl.textContent = s;
  };
  if (o.title) setTitle(o.title);
  const body = h('div', 'px-frame-body', el);
  return { el, body, setTitle };
}

/** Label + control row for settings forms. */
export function field(parent: Node, label: string, control?: Node): HTMLElement {
  const row = h('div', 'px-field', parent);
  h('span', 'px-field-label', row, label);
  const slot = h('div', 'px-field-ctl', row);
  if (control) slot.appendChild(control);
  return slot;
}

/** Scroll area with pixel scrollbars; `heightU` caps its height in UI px. */
export function scroll(parent: Node, heightU?: number): HTMLElement {
  const el = h('div', 'px-scroll', parent);
  if (heightU) el.style.maxHeight = `calc(${heightU} * var(--u))`;
  return el;
}

export interface ModalPanelOpts {
  /** Esc closes this panel (default true). */
  escClose?: boolean;
  /** Dark backdrop behind the panel (default true). */
  dim?: boolean;
}
/**
 * Mark a panel built by `ui.panel(id, build)` as modal: it blocks gameplay input (Input mode 'ui'), gets a backdrop and
 * closes on Esc. Call it inside `build(el)`. Panels that are not marked stay passive (HUD, Upgrade Ledger …).
 */
export function modalPanel(el: HTMLElement, o: ModalPanelOpts = {}): void {
  el.dataset.modal = '1';
  el.dataset.esc = o.escClose === false ? '0' : '1';
  el.dataset.dim = o.dim === false ? '0' : '1';
  blockingHook?.();
}

const NAV_SEL = '[data-nav]:not([disabled]):not([aria-disabled="true"])';
/** Focusable controls inside `container`, in DOM order. */
export function navItems(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(NAV_SEL)].filter((e) => e.offsetParent !== null || e.getClientRects().length > 0);
}
export function focusFirst(container: ParentNode): void { navItems(container)[0]?.focus({ preventScroll: true }); }
/** Up / Down (and W / S) move focus between `[data-nav]` controls inside `container`. Returns the disposer. */
export function navGroup(container: HTMLElement): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
    const down = e.code === 'ArrowDown' || e.code === 'KeyS', up = e.code === 'ArrowUp' || e.code === 'KeyW';
    if (!down && !up) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    const items = navItems(container);
    if (!items.length) return;
    const i = items.indexOf(e.target as HTMLElement);
    const next = items[(i + (down ? 1 : -1) + items.length) % items.length];
    e.preventDefault();
    next.focus({ preventScroll: false });
    uiSfx('hover', 0.5);
  };
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}

// ── tooltip ──────────────────────────────────────────────────────────────────────────────────────
let tipEl: HTMLElement | null = null;
let tipTimer = 0;
export function hideTip(): void {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.classList.remove('on');
}
/** Hover / focus tooltip; `content` may be a function evaluated on show (live timers). Returns the remover. */
export function tip(el: HTMLElement, content: string | (() => string)): () => void {
  const show = (): void => {
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => {
      const text = typeof content === 'function' ? content() : content;
      if (!text) return;
      if (!tipEl) tipEl = h('div', 'px-tip', root());
      tipEl.textContent = text;
      tipEl.classList.add('on');
      const r = el.getBoundingClientRect(), tr = tipEl.getBoundingClientRect();
      const x = clamp(r.left + r.width / 2 - tr.width / 2, 4, window.innerWidth - tr.width - 4);
      const y = r.top - tr.height - 4 < 4 ? r.bottom + 4 : r.top - tr.height - 4;
      tipEl.style.left = `${Math.round(x)}px`; tipEl.style.top = `${Math.round(y)}px`;
    }, 180);
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('mouseleave', hideTip);
  el.addEventListener('blur', hideTip);
  return () => { el.removeEventListener('mouseenter', show); el.removeEventListener('focus', show); el.removeEventListener('mouseleave', hideTip); el.removeEventListener('blur', hideTip); hideTip(); };
}

// ── button ───────────────────────────────────────────────────────────────────────────────────────
export interface ButtonOpts {
  label: string;
  onClick?: () => void;
  kind?: 'normal' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  /** Dangerous action: needs a hold when the "hold to confirm" accessibility setting is on. */
  hold?: boolean;
  /** Keycap shown at the left (already localized). */
  key?: string;
  title?: string;
  silent?: boolean;
  /** Sound on press (default: `confirm` for primary buttons, `click` for the rest). */
  sfx?: string;
}
export interface Button { readonly el: HTMLButtonElement; setLabel(s: string): void; setDisabled(b: boolean): void }
const HOLD_MS = 700;
export function button(parent: Node | null, o: ButtonOpts): Button {
  const el = h('button', `px-btn k-${o.kind ?? 'normal'}`, parent);
  el.type = 'button';
  el.dataset.nav = '1';
  const fill = h('span', 'fill', el);
  if (o.key) keycap(o.key, el);
  const lab = h('span', 'lab', el, o.label);
  if (o.title) tip(el, o.title);
  el.disabled = !!o.disabled;

  const fire = (): void => { if (!o.silent) uiSfx(o.sfx ?? (o.kind === 'primary' ? 'confirm' : 'click')); o.onClick?.(); };
  const needHold = (): boolean => !!o.hold && !!settings()?.holdToConfirm;
  let anim: Animation | null = null;
  const startHold = (): void => {
    if (anim) return;
    el.classList.add('holding');
    anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: HOLD_MS, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => { stopHold(); fire(); };
  };
  const stopHold = (): void => { if (anim) { anim.onfinish = null; anim.cancel(); anim = null; } el.classList.remove('holding'); };

  el.addEventListener('mouseenter', () => { if (!el.disabled) { if (!o.silent) uiSfx('hover', 0.6); if (document.activeElement !== el) el.focus({ preventScroll: true }); } });
  el.addEventListener('click', (e) => { if (needHold()) { e.preventDefault(); return; } fire(); });
  el.addEventListener('pointerdown', () => { if (needHold() && !el.disabled) startHold(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) el.addEventListener(ev, stopHold);
  el.addEventListener('keydown', (e) => {
    if (needHold() && (e.code === 'Enter' || e.code === 'Space') && !el.disabled) { e.preventDefault(); if (!e.repeat) startHold(); }
  });
  el.addEventListener('keyup', (e) => { if (e.code === 'Enter' || e.code === 'Space') stopHold(); });
  el.addEventListener('blur', stopHold);
  return {
    el,
    setLabel: (s) => { lab.textContent = s; },
    setDisabled: (b) => { el.disabled = b; if (b) stopHold(); },
  };
}

// ── toggle / cycle ───────────────────────────────────────────────────────────────────────────────
export interface ToggleOpts { label?: string; value: boolean; onChange?: (v: boolean) => void }
export interface Toggle { readonly el: HTMLButtonElement; value: boolean; set(v: boolean): void }
let toggleLangHooked = false;
/** One global listener re-texts every live ON / OFF label when the language changes (no per-toggle subscriptions to leak). */
function hookToggleLang(): void {
  if (toggleLangHooked) return;
  toggleLangHooked = true;
  bus.on('lang:changed', () => {
    for (const el of root().querySelectorAll<HTMLElement>('.px-toggle')) {
      const s = el.querySelector('.state');
      if (s) s.textContent = t(el.classList.contains('on') ? 'ui.toggle.on' : 'ui.toggle.off');
    }
  });
}
export function toggle(parent: Node | null, o: ToggleOpts): Toggle {
  hookToggleLang();
  const el = h('button', 'px-toggle', parent);
  el.type = 'button'; el.dataset.nav = '1'; el.setAttribute('role', 'switch');
  h('span', 'box', el);
  const state = h('span', 'state', el);
  if (o.label) h('span', 'lab', el, o.label);
  const api: Toggle = {
    el, value: o.value,
    set(v) {
      api.value = v;
      el.setAttribute('aria-checked', String(v));
      el.classList.toggle('on', v);
      state.textContent = t(v ? 'ui.toggle.on' : 'ui.toggle.off');
    },
  };
  api.set(o.value);
  const flip = (): void => { api.set(!api.value); uiSfx(api.value ? 'click' : 'hover'); o.onChange?.(api.value); };
  el.addEventListener('click', flip);
  el.addEventListener('mouseenter', () => { uiSfx('hover', 0.6); el.focus({ preventScroll: true }); });
  el.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') { e.preventDefault(); flip(); }
  });
  return api;
}

export interface CycleOpts<T> { label?: string; options: Array<{ value: T; label: string }>; value: T; onChange?: (v: T) => void; wrap?: boolean }
export interface Cycle<T> { readonly el: HTMLElement; value: T; set(v: T): void }
/** ◄ VALUE ► selector for short enums (resolution presets, language). */
export function cycle<T>(parent: Node | null, o: CycleOpts<T>): Cycle<T> {
  const el = h('div', 'px-cycle', parent);
  el.tabIndex = 0; el.dataset.nav = '1'; el.setAttribute('role', 'spinbutton');
  const prev = h('button', 'arr', el); prev.type = 'button'; prev.tabIndex = -1; prev.appendChild(pixelIcon('arrowL'));
  const val = h('span', 'val', el);
  const next = h('button', 'arr', el); next.type = 'button'; next.tabIndex = -1; next.appendChild(pixelIcon('arrowR'));
  let idx = Math.max(0, o.options.findIndex((x) => x.value === o.value));
  const api: Cycle<T> = {
    el, value: o.options[idx]?.value,
    set(v) {
      idx = Math.max(0, o.options.findIndex((x) => x.value === v));
      api.value = o.options[idx]?.value;
      val.textContent = o.options[idx]?.label ?? '';
      el.setAttribute('aria-valuetext', val.textContent);
    },
  };
  api.set(o.value);
  const step = (d: number): void => {
    const n = o.options.length;
    if (!n) return;
    const j = o.wrap === false ? clamp(idx + d, 0, n - 1) : (idx + d + n) % n;
    if (j === idx) return;
    api.set(o.options[j].value);
    uiSfx('click', 0.7);
    o.onChange?.(api.value);
  };
  prev.addEventListener('click', () => { step(-1); el.focus({ preventScroll: true }); });
  next.addEventListener('click', () => { step(1); el.focus({ preventScroll: true }); });
  el.addEventListener('mouseenter', () => { uiSfx('hover', 0.6); el.focus({ preventScroll: true }); });
  el.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); step(-1); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); step(1); }
  });
  return api;
}

// ── slider ───────────────────────────────────────────────────────────────────────────────────────
export interface SliderOpts {
  min: number; max: number; step?: number; value: number;
  format?: (v: number) => string;
  onInput?: (v: number) => void;      // while dragging / each key step
  onChange?: (v: number) => void;     // on release / key step
  label?: string;
}
export interface Slider { readonly el: HTMLElement; value: number; set(v: number): void }
export function slider(parent: Node | null, o: SliderOpts): Slider {
  const step = o.step ?? (o.max - o.min) / 100;
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step || 1))));
  const fmt = o.format ?? ((v: number) => String(v));
  const el = h('div', 'px-slider', parent);
  el.tabIndex = 0; el.dataset.nav = '1'; el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', String(o.min)); el.setAttribute('aria-valuemax', String(o.max));
  if (o.label) h('span', 'lab', el, o.label);
  const track = h('span', 'track', el);
  const fillEl = h('span', 'fill', track);
  h('span', 'knob', fillEl);
  const val = h('span', 'val', el);
  const api: Slider = {
    el, value: o.value,
    set(v) {
      const q = clamp(Math.round((v - o.min) / step) * step + o.min, o.min, o.max);
      api.value = Number(q.toFixed(decimals));
      const k = o.max === o.min ? 0 : (api.value - o.min) / (o.max - o.min);
      fillEl.style.width = `${(k * 100).toFixed(2)}%`;
      val.textContent = fmt(api.value);
      el.setAttribute('aria-valuenow', String(api.value));
    },
  };
  api.set(o.value);
  const fromPointer = (e: PointerEvent): number => {
    const r = track.getBoundingClientRect();
    return o.min + clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * (o.max - o.min);
  };
  let dragging = false, lastTick = -1;
  const apply = (v: number, commit: boolean): void => {
    const before = api.value;
    api.set(v);
    if (api.value !== before) {
      o.onInput?.(api.value);
      if (Math.floor(api.value / step) !== lastTick) { lastTick = Math.floor(api.value / step); uiSfx('hover', 0.4); }
    }
    if (commit) o.onChange?.(api.value);
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true; track.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
    apply(fromPointer(e), false);
  });
  track.addEventListener('pointermove', (e) => { if (dragging) apply(fromPointer(e), false); });
  const end = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    o.onChange?.(api.value);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  el.addEventListener('mouseenter', () => { if (document.activeElement !== el) el.focus({ preventScroll: true }); });
  el.addEventListener('keydown', (e) => {
    const d = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    if (d) { e.preventDefault(); apply(api.value + d * step * (e.shiftKey ? 10 : 1), true); }
    else if (e.code === 'Home') { e.preventDefault(); apply(o.min, true); }
    else if (e.code === 'End') { e.preventDefault(); apply(o.max, true); }
  });
  return api;
}

// ── text field ───────────────────────────────────────────────────────────────────────────────────
export interface TextFieldOpts {
  value?: string; placeholder?: string; maxLength?: number; password?: boolean;
  onInput?: (v: string) => void; onSubmit?: (v: string) => void; onCancel?: () => void;
}
export interface TextField { readonly el: HTMLElement; readonly input: HTMLInputElement; value: string; focus(): void }
/** Single-line input. While focused the Input service switches to 'ui' mode (game keys are not captured). */
export function textField(parent: Node | null, o: TextFieldOpts = {}): TextField {
  const el = h('div', 'px-text', parent);
  const input = h('input', undefined, el);
  input.type = o.password ? 'password' : 'text';
  input.dataset.nav = '1';
  input.autocomplete = 'off'; input.spellcheck = false;
  if (o.placeholder) input.placeholder = o.placeholder;
  if (o.maxLength) input.maxLength = o.maxLength;
  if (o.value) input.value = o.value;
  input.addEventListener('input', () => o.onInput?.(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); o.onSubmit?.(input.value); }
    else if (e.code === 'Escape') { input.blur(); o.onCancel?.(); }
  });
  return {
    el, input,
    get value() { return input.value; },
    set value(v: string) { input.value = v; },
    focus() { input.focus({ preventScroll: true }); },
  };
}

// ── tabs ─────────────────────────────────────────────────────────────────────────────────────────
export interface TabsOpts {
  tabs: Array<{ id: string; label: string }>;
  active?: string;
  onChange?: (id: string) => void;
}
export interface Tabs { readonly el: HTMLElement; readonly active: string; select(id: string): void }
export function tabs(parent: Node | null, o: TabsOpts): Tabs {
  const el = h('div', 'px-tabs', parent);
  el.setAttribute('role', 'tablist');
  const btns = new Map<string, HTMLButtonElement>();
  let active = o.active ?? o.tabs[0]?.id ?? '';
  const api: Tabs = {
    el,
    get active() { return active; },
    select(id) {
      if (!btns.has(id)) return;
      active = id;
      for (const [k, b] of btns) {
        b.classList.toggle('on', k === id); b.setAttribute('aria-selected', String(k === id)); b.tabIndex = k === id ? 0 : -1;
        // only the active tab joins the W/S focus walk; ←/→ (or Q/E in the settings screen) switch tabs
        if (k === id) b.dataset.nav = '1'; else delete b.dataset.nav;
      }
    },
  };
  for (const tb of o.tabs) {
    const b = h('button', 'px-tab', el, tb.label);
    b.type = 'button'; b.dataset.nav = '1'; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { if (active !== tb.id) { api.select(tb.id); uiSfx('click', 0.8); o.onChange?.(tb.id); } });
    b.addEventListener('mouseenter', () => uiSfx('hover', 0.5));
    b.addEventListener('keydown', (e) => {
      const i = o.tabs.findIndex((x) => x.id === tb.id);
      const d = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = o.tabs[(i + d + o.tabs.length) % o.tabs.length];
      api.select(n.id); btns.get(n.id)?.focus(); o.onChange?.(n.id);
    });
    btns.set(tb.id, b);
  }
  api.select(active);
  return api;
}

// ── list (server browser, saves, leaderboards) ───────────────────────────────────────────────────
export interface ListColumn { id: string; label: string; width?: string; align?: 'left' | 'right' | 'center' }
export interface ListRow { id: string; cells: Array<string | HTMLElement>; disabled?: boolean; className?: string }
export interface ListOpts {
  columns?: ListColumn[];
  rows?: ListRow[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  onActivate?: (id: string) => void;
  emptyText?: string;
  /** Visible rows before it scrolls. */
  visibleRows?: number;
}
export interface List { readonly el: HTMLElement; readonly selected: string | null; setRows(rows: ListRow[]): void; select(id: string | null): void }
export function list(parent: Node | null, o: ListOpts = {}): List {
  const el = h('div', 'px-list', parent);
  el.tabIndex = 0; el.dataset.nav = '1'; el.setAttribute('role', 'listbox');
  const cols = o.columns ?? [];
  const template = cols.length ? cols.map((c) => c.width ?? '1fr').join(' ') : '1fr';
  el.style.setProperty('--cols', template);
  if (cols.length) {
    const head = h('div', 'head', el);
    for (const c of cols) { const cell = h('span', undefined, head, c.label); if (c.align) cell.style.textAlign = c.align; }
  }
  const bodyEl = h('div', 'rows', el);
  bodyEl.style.maxHeight = `calc(${(o.visibleRows ?? 8) * 16} * var(--u))`;
  let rows: ListRow[] = [];
  let sel: string | null = o.selected ?? null;
  const api: List = {
    el,
    get selected() { return sel; },
    setRows(next) {
      rows = next;
      bodyEl.replaceChildren();
      if (!rows.length && o.emptyText) h('div', 'empty', bodyEl, o.emptyText);
      for (const r of rows) {
        const row = h('div', `row ${r.className ?? ''}`.trim(), bodyEl);
        row.dataset.id = r.id; row.setAttribute('role', 'option');
        if (r.disabled) row.classList.add('off');
        r.cells.forEach((c, i) => {
          const cell = h('span', undefined, row);
          if (typeof c === 'string') cell.textContent = c; else cell.appendChild(c);
          const al = cols[i]?.align; if (al) cell.style.textAlign = al;
        });
        row.addEventListener('click', () => { if (!r.disabled) api.select(r.id); });
        row.addEventListener('dblclick', () => { if (!r.disabled) o.onActivate?.(r.id); });
      }
      if (sel && !rows.some((r) => r.id === sel)) sel = null;
      paint();
    },
    select(id) {
      if (id === sel) return;
      sel = id; paint();
      if (id !== null) { uiSfx('click', 0.6); o.onSelect?.(id); }
    },
  };
  const paint = (): void => {
    for (const row of bodyEl.querySelectorAll<HTMLElement>('.row')) {
      const on = row.dataset.id === sel;
      row.classList.toggle('sel', on); row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
  };
  el.addEventListener('keydown', (e) => {
    const live = rows.filter((r) => !r.disabled);
    if (!live.length) return;
    const i = live.findIndex((r) => r.id === sel);
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      if (i === live.length - 1) return;                       // bubble to navGroup → next control
      e.preventDefault(); e.stopPropagation(); api.select(live[Math.min(live.length - 1, i + 1)].id);
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (i <= 0 && sel !== null) return;
      e.preventDefault(); e.stopPropagation(); api.select(live[Math.max(0, i - 1)].id);
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && sel) { e.preventDefault(); o.onActivate?.(sel); }
  });
  api.setRows(o.rows ?? []);
  return api;
}

// ── counter (rolling numbers) ────────────────────────────────────────────────────────────────────
export interface CounterOpts {
  value?: number;
  fmt?: (n: number) => string;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Sound played on every 2nd visible change while rolling (e.g. 'numberTick'). */
  tickSfx?: string | null;
  /** Longest roll in seconds (default 1.2, GDD §9.7). */
  maxDur?: number;
}
export interface Counter {
  readonly el: HTMLElement;
  /** Target value. */
  readonly value: number;
  /** Value currently on screen. */
  readonly shown: number;
  set(v: number, o?: { instant?: boolean; dur?: number }): void;
  add(dv: number): void;
}
const TICK_HZ = 30;
const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3);
/**
 * Number that rolls toward its target at 30 steps/s (ease-out, ≤ `maxDur`). Gains pop the element, spends flash it red.
 * Format defaults to `String`; pass `fmtCoins` for money. Ticks only while rolling (no idle cost).
 */
export function counter(parent: Node | null, o: CounterOpts = {}): Counter {
  const el = h('span', `px-counter ${o.className ?? ''}`.trim(), parent);
  if (o.prefix) h('span', 'pre', el, o.prefix);
  const num = h('span', 'num', el);
  if (o.suffix) h('span', 'suf', el, o.suffix);
  const fmt = o.fmt ?? ((n: number) => String(Math.round(n)));
  let target = o.value ?? 0, shown = target, from = target, elapsed = 0, dur = 0, rendered = NaN, ticks = 0, running = false;
  const render = (): void => {
    if (shown === rendered) return;
    rendered = shown; num.textContent = fmt(shown);
  };
  render();
  const step = (dt: number): boolean => {
    if (!running) return false;                              // snapped (instant) or cancelled while queued
    elapsed += dt;
    const q = Math.floor(elapsed * TICK_HZ) / TICK_HZ;       // stepped, PSX-style
    const k = dur <= 0 ? 1 : Math.min(1, q / dur);
    const prev = shown;
    shown = k >= 1 ? target : Math.round(from + (target - from) * easeOutCubic(k));
    if (shown !== prev && o.tickSfx && (++ticks & 1) === 0) uiSfx(o.tickSfx, 0.5);
    render();
    if (k >= 1) { running = false; return false; }
    return true;
  };
  const api: Counter = {
    el,
    get value() { return target; },
    get shown() { return shown; },
    set(v, opt) {
      const delta = v - shown;
      if (opt?.instant || !isFinite(delta)) { target = shown = v; running = false; render(); return; }
      if (v === target) return;                              // already rolling there: HUDs re-assert the value every frame
      if (v < target) el.animate([{ color: COLORS.signal }, { color: 'inherit' }], { duration: 220, easing: 'steps(4,end)' });                                   // spend → red flash
      else if (v > target) el.animate([{ scale: '1' }, { scale: '1.18' }, { scale: '1' }], { duration: 180, easing: 'ease-out' });   // gain → pop
      target = v; from = shown; elapsed = 0;
      dur = opt?.dur ?? clamp(0.35 + Math.log10(Math.abs(delta) + 1) * 0.14, 0.35, o.maxDur ?? 1.2);
      if (!running) { running = true; addTicker(step); }
    },
    add(dv) { api.set(target + dv); },
  };
  return api;
}

// ── bar (quota / progress) ───────────────────────────────────────────────────────────────────────
export interface BarOpts { value?: number; width?: number; height?: number; color?: string; segments?: number; className?: string }
export interface Bar { readonly el: HTMLElement; set(v: number, color?: string): void; pulse(on: boolean): void }
/** Segmented progress bar, `value` 0..1. */
export function bar(parent: Node | null, o: BarOpts = {}): Bar {
  const el = h('div', `px-bar-w ${o.className ?? ''}`.trim(), parent);
  el.style.width = `calc(${o.width ?? 64} * var(--u))`;
  el.style.height = `calc(${o.height ?? 4} * var(--u))`;
  if (o.segments) el.style.setProperty('--seg', String(o.segments));
  const fillEl = h('span', 'fill', el);
  el.setAttribute('role', 'progressbar'); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
  const api: Bar = {
    el,
    set(v, color) {
      const k = clamp(v, 0, 1);
      fillEl.style.width = `${(k * 100).toFixed(1)}%`;
      el.setAttribute('aria-valuenow', String(Math.round(k * 100)));
      if (color) fillEl.style.background = color;
    },
    pulse(on) { el.classList.toggle('pulse', on); },
  };
  fillEl.style.background = o.color ?? COLORS.green;
  api.set(o.value ?? 0);
  return api;
}

// ── status row (buff / debuff icons) ─────────────────────────────────────────────────────────────
export interface StatusItem {
  id: string;
  icon: IconSpec;
  kind?: 'buff' | 'debuff' | 'neutral';
  stacks?: number;
  /** Time remaining as 0..1 (radial sweep); undefined = no timer. */
  remaining?: number;
  /** Tooltip: name, then description. */
  name?: string;
  desc?: string;
  /** Custom frame colour (CSS). */
  color?: string;
}
export interface StatusRowOpts { vertical?: boolean; iconSize?: number; max?: number; className?: string }
export interface StatusRow { readonly el: HTMLElement; set(items: StatusItem[]): void; pulse(id: string): void }
/**
 * Row (or column) of status icons: frame colour by kind (colour-blind mode adds ▲ / ▼ markers), stack digit,
 * radial timer sweep, blink when about to expire (not with Reduce Flashing), pop-in / shrink-out. `set()` diffs by id,
 * so calling it every frame is cheap.
 */
export function statusRow(parent: Node | null, o: StatusRowOpts = {}): StatusRow {
  const el = h('div', `px-status ${o.vertical ? 'v' : 'h'} ${o.className ?? ''}`.trim(), parent);
  const size = o.iconSize ?? 16;
  interface Cell { root: HTMLElement; stk: HTMLElement; sig: string; item: StatusItem; stackShown: number; remShown: number }
  const cells = new Map<string, Cell>();
  const build = (it: StatusItem): Cell => {
    const root = h('div', 'cell');
    root.style.setProperty('--sz', String(size));
    root.dataset.id = it.id;
    root.appendChild(iconEl(it.icon, size));
    h('span', 'ring', root);
    const stk = h('span', 'stk', root);
    h('span', 'mk', root);
    const cell: Cell = { root, stk, sig: '', item: it, stackShown: -1, remShown: -1 };
    tip(root, () => {
      const c = cell.item, pct = c.remaining !== undefined ? ` (${Math.round(clamp(c.remaining, 0, 1) * 100)}%)` : '';
      return [c.name ? c.name + pct : '', c.desc ?? ''].filter(Boolean).join('\n');
    });
    root.animate([{ scale: '0' }, { scale: '1.25' }, { scale: '1' }], { duration: 220, easing: 'ease-out' });
    return cell;
  };
  const api: StatusRow = {
    el,
    set(items) {
      const shown = o.max ? items.slice(0, o.max) : items;
      const seen = new Set<string>();
      let prev: Element | null = null;
      for (const it of shown) {
        seen.add(it.id);
        let c = cells.get(it.id);
        if (!c) { c = build(it); cells.set(it.id, c); }
        c.item = it;
        const kind = it.kind ?? 'neutral';
        const sig = `${kind}|${it.color ?? ''}`;
        if (sig !== c.sig) {
          c.sig = sig; c.root.dataset.kind = kind;
          if (it.color) c.root.style.setProperty('--frame', it.color); else c.root.style.removeProperty('--frame');
        }
        const stacks = it.stacks ?? 1;
        if (stacks !== c.stackShown) {
          if (c.stackShown > 0 && stacks > c.stackShown) c.root.animate([{ scale: '1' }, { scale: '1.3' }, { scale: '1' }], { duration: 160 });
          c.stackShown = stacks; c.stk.textContent = stacks > 1 ? String(stacks) : '';
        }
        const rem = it.remaining === undefined ? -1 : Math.round(clamp(it.remaining, 0, 1) * 200) / 200;
        if (rem !== c.remShown) {
          c.remShown = rem;
          if (rem < 0) c.root.style.removeProperty('--rem'); else c.root.style.setProperty('--rem', String(rem));
          c.root.classList.toggle('timed', rem >= 0);
          c.root.classList.toggle('expiring', rem >= 0 && rem < 0.15);
        }
        const want = prev ? prev.nextElementSibling : el.firstElementChild;
        if (want !== c.root) el.insertBefore(c.root, want);
        prev = c.root;
      }
      for (const [id, c] of cells) {
        if (seen.has(id)) continue;
        cells.delete(id);
        const a = c.root.animate([{ scale: '1', opacity: 1 }, { scale: '0', opacity: 0 }], { duration: 160, easing: 'ease-in' });
        a.onfinish = () => c.root.remove();
      }
    },
    pulse(id) { cells.get(id)?.root.animate([{ scale: '1' }, { scale: '1.4' }, { scale: '1' }], { duration: 200 }); },
  };
  return api;
}

// ── key rebinding ────────────────────────────────────────────────────────────────────────────────
export interface KeyBindOpts {
  /** Binding key: a walk action (`'interact'`) or machine action (`'m.betUp'`). */
  key: string;
  input: InputExt;
  onChange?: () => void;
}
export interface KeyBind { readonly el: HTMLButtonElement; refresh(): void; destroy(): void }
/**
 * Rebinding button: shows the key(s); click, press the new key (Esc cancels, Delete clears, mouse buttons 2–5 count).
 * A key already used in the same layer is swapped with the other action (never leaves an action unbound).
 */
let capturingCount = 0;
/** True while a keyBind button is waiting for a key (the overlay must not treat Esc etc. as UI navigation). */
export function keyCaptureActive(): boolean { return capturingCount > 0; }
export function keyBind(parent: Node | null, o: KeyBindOpts): KeyBind {
  const el = h('button', 'px-keybind', parent);
  el.type = 'button'; el.dataset.nav = '1';
  const rb = (k: string, codes: string[]): void => o.input.rebind(k as BindingKey, codes);
  let capturing = false;
  const refresh = (): void => {
    const codes = o.input.codesOf(o.key);
    el.textContent = capturing ? t('ui.rebind.press') : codes.length ? codeLabels(codes).join(' / ') : t('ui.key.none');
    el.classList.toggle('capture', capturing);
  };
  const stop = (): void => {
    if (capturing) capturingCount = Math.max(0, capturingCount - 1);
    capturing = false;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    el.removeEventListener('blur', stop);
    refresh();
  };
  const assign = (code: string): void => {
    const own = o.input.codesOf(o.key);
    const all = o.input.allBindings();
    let swapped = '';
    for (const k of conflictsFor(all, o.key, code)) {
      // the other action loses `code` and takes over our old primary key (a swap), so it is never left unbound
      const rest = all[k].filter((c) => c !== code);
      const give = !swapped && own[0] && !rest.includes(own[0]) ? [own[0]] : [];
      rb(k, [...rest, ...give]);
      swapped = actionLabel(k);
    }
    rb(o.key, [code, ...own.slice(1).filter((c) => c !== code)].slice(0, 2));   // replaces the primary key, keeps alternates
    if (swapped) app?.ui?.toast(t('ui.rebind.swapped', { name: swapped }), 'warn');
    uiSfx('click');
    o.onChange?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat || !e.code) return;   // synthetic / IME events without a physical code never bind
    if (MODIFIER_CODES.has(e.code) && e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') return;   // chords are never bound
    if (e.code === 'Escape' && o.key !== 'pause') { stop(); return; }
    if (e.code === 'Delete') { rb(o.key, []); stop(); o.onChange?.(); return; }
    if (RESERVED_CODES.has(e.code)) { uiSfx('error'); return; }
    assign(e.code); stop();
  };
  const onMouse = (e: MouseEvent): void => {
    if (e.target === el) return;
    if (e.button >= 1 && e.button <= 4) { e.preventDefault(); e.stopImmediatePropagation(); assign(`Mouse${e.button}`); } // i18n-ok: KeyboardEvent-style code
    stop();
  };
  el.addEventListener('click', () => {
    if (capturing) { stop(); return; }
    capturing = true; capturingCount++; refresh(); uiSfx('click');
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    el.addEventListener('blur', stop);
  });
  el.addEventListener('mouseenter', () => uiSfx('hover', 0.5));
  const off = bus.on('input:rebind', refresh);
  const offLang = bus.on('lang:changed', refresh);
  refresh();
  return { el, refresh, destroy() { stop(); off(); offLang(); } };
}

// ── controls card (F1) ───────────────────────────────────────────────────────────────────────────
/** Read-only two-column list of the current bindings (walk | seated). Call again after a rebind to refresh. */
export function controlsCard(parent: Node, input: InputExt): HTMLElement {
  const el = h('div', 'px-controls', parent);
  const all = input.allBindings();
  const skip = new Set(['debug', 'debugColliders', 'skip', 'm.n2', 'm.n3', 'm.n4', 'm.n5', 'm.n6', 'm.n7', 'm.n8', 'm.n9']);
  for (const layer of ['walk', 'machine'] as const) {
    const col = h('div', 'col', el);
    h('div', 'px-h', col, t(layer === 'walk' ? 'ui.controls.walk' : 'ui.controls.seated'));
    for (const k of Object.keys(all)) {
      if (layerOf(k) !== layer || skip.has(k) || !all[k].length) continue;
      const row = h('div', 'row', col);
      const keys = h('span', 'keys', row);
      codeLabels(all[k]).forEach((l) => keycap(l, keys));
      h('span', 'what', row, k === 'm.n1' ? `${actionLabel('m.n1')} …` : actionLabel(k));
    }
  }
  return el;
}

// ── cursors ──────────────────────────────────────────────────────────────────────────────────────
const GLOVE_ARROW = [
  '..oo........', '.oiio.......', '.oiio.......', '.oiio.......', '.oiiooooo...', '.oiioiiiioo.',
  'ooiioiiiiioo', 'oiiiiiiiiiio', 'oiiiiiiiiiio', '.oiiiiiiiio.', '.oiiiiiiiio.', '..obbbbbbo..', '..obbbbbbo..', '..oooooooo..',
] as const;
function drawGlove(rows: readonly string[], px: number): string {
  const cv = document.createElement('canvas');
  const w = rows[0].length, hgt = rows.length;
  cv.width = w * px; cv.height = hgt * px;
  const g = cv.getContext('2d');
  if (!g) return '';
  const pal: Record<string, string> = { o: COLORS.black, i: COLORS.ivory, b: COLORS.brass };
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x * px, y * px, px, px); } }));
  return cv.toDataURL('image/png');
}
/** CSS `cursor` values for the white-glove pointer (ART_BIBLE §10.5), scaled by integer `px`. */
export function gloveCursors(px: number): { arrow: string; point: string } {
  const p = clamp(Math.round(px), 1, 8);
  const arrow = drawGlove(GLOVE_ARROW, p);
  // "tap" frame: the same glove one pixel lower
  const point = drawGlove(['............', ...GLOVE_ARROW.slice(0, 13)], p);
  return {
    arrow: arrow ? `url(${arrow}) ${p} 0, default` : 'default',
    point: point ? `url(${point}) ${p} ${p}, pointer` : 'pointer',
  };
}

