/**
 * Settings screen (CORE-UI). One modal DOM panel built from the widget kit, opened from the main menu (SETTINGS), from the
 * pause card and from F1 (the CONTROLS page). Pages:
 *
 *   CONTROLS  mouse sensitivity · invert Y · FOV · every key binding (walk | seated columns) with rebinding + RESET ALL
 *   VIDEO     Performance / Standard presets · PSX look and filters · resolution · draw distance
 *   AUDIO     master · effects · interface · music · ambience · voice
 *   ACCESS    language · calm mode · head bob · screen shake · flashing · text size · crosshair · subtitles · colour-blind ·
 *             hold to confirm
 *
 * Every control writes through `save.setSetting` the moment it changes, so the game reacts live and the value persists.
 * Input: the panel is a `modalPanel`, so the Input service switches to 'ui' while it is open and falls back to whatever mode
 * the game had (walk, seated machine, menu) when it closes. The screen never touches the input mode itself, which is what
 * makes the restore exact: pointer lock is requested again only when the mode that returns is 'walk'. Esc closes the panel
 * (core/ui handles it, except while a key is being rebound). ←/→ or Q/E switch pages, W/S move between controls.
 */
import './settingsScreen.css';
import { app } from '../app';
import { bus } from '../events';
import { t } from '../i18n';
import { log } from '../log';
import type { InputExt } from '../input';
import { actionLabel, layerOf } from '../keymap';
import { PERFORMANCE_PSX } from '../renderer/perfPreset';
import type { PsxSettings } from '../renderer/types';
import { DEFAULT_PSX, type Settings } from '../settings';
import {
  button, cycle, field, frame, h, keyBind, keyCaptureActive, modalPanel, scroll, slider, tabs, tip, toggle, uiSfx,
  type Tabs,
} from './widgets';

export const SETTINGS_PANEL = 'settings-screen';

export type SettingsPage = 'controls' | 'video' | 'audio' | 'access';
export interface SettingsOpts {
  /** Page to show first (default CONTROLS). */
  page?: SettingsPage;
  /** `'keys'` scrolls the CONTROLS page down to the key bindings (F1 opens it this way). */
  focus?: 'keys';
  /** Runs once when the screen closes, for any reason (Esc, BACK, the panel being replaced or the state exiting). */
  onClose?(): void;
}

const PAGES: readonly SettingsPage[] = ['controls', 'video', 'audio', 'access'];
const FRAME_W = 430;

/** The open screen, if any: lets a second `openSettingsScreen` just flip the page instead of rebuilding. */
let live: { select(page: SettingsPage, focus?: 'keys'): void } | null = null;

export function settingsScreenOpen(): boolean { return live !== null; }

export function openSettingsScreen(o: SettingsOpts = {}): void {
  if (live) { live.select(o.page ?? 'controls', o.focus); return; }
  app.ui.panel(SETTINGS_PANEL, (el) => mount(el, o));
}

export function closeSettingsScreen(): void { app.ui.closePanel(SETTINGS_PANEL); }

// ── small helpers ─────────────────────────────────────────────────────────────────────────────────
const S = (): Settings => app.save.data.settings;
function put<K extends keyof Settings>(k: K, v: Settings[K]): void { app.save.setSetting(k, v); }
function putVol(k: keyof Settings['vol'], v: number): void { put('vol', { ...S().vol, [k]: v }); }
function putPsx<K extends keyof PsxSettings>(k: K, v: PsxSettings[K]): void { put('psx', { ...S().psx, [k]: v }); }
const pct = (v: number): string => `${Math.round(v * 100)}%`;

type PresetId = 'performance' | 'standard' | 'custom';
type PresetKeys = Pick<PsxSettings, 'targetHeight' | 'crt' | 'drawDistance'>;
const STANDARD_PSX: PresetKeys = { targetHeight: DEFAULT_PSX.targetHeight, crt: DEFAULT_PSX.crt, drawDistance: DEFAULT_PSX.drawDistance };
const sameKeys = (p: PsxSettings, k: PresetKeys): boolean => p.targetHeight === k.targetHeight && p.crt === k.crt && p.drawDistance === k.drawDistance;
function currentPreset(): PresetId {
  const p = S().psx;
  return sameKeys(p, PERFORMANCE_PSX) ? 'performance' : sameKeys(p, STANDARD_PSX) ? 'standard' : 'custom';
}

interface Ctx {
  body: HTMLElement;
  input: InputExt;
  /** Rebuild the current page in place (scroll and focus are kept). */
  reload(): void;
  /** Register a disposer that runs before the page is rebuilt or the screen closes. */
  track(d: () => void): void;
}

// ── page builders ─────────────────────────────────────────────────────────────────────────────────
const head = (c: Ctx, text: string): HTMLElement => h('div', 'st-h', c.body, text);
const note = (c: Ctx, text: string): HTMLElement => h('div', 'st-note', c.body, text);

/** A labelled control row; the control's root element gets `data-sk` so focus survives a rebuild. */
function row<W extends { el: HTMLElement }>(c: Ctx, key: string, label: string, make: (slot: HTMLElement) => W, hint?: string): W {
  const slot = field(c.body, label);
  const w = make(slot);
  w.el.dataset.sk = key;
  if (hint) tip(w.el, hint);
  return w;
}

function slide(c: Ctx, key: string, label: string, o: { min: number; max: number; step: number; value: number; format: (v: number) => string; apply(v: number): void }): void {
  row(c, key, label, (slot) => slider(slot, { min: o.min, max: o.max, step: o.step, value: o.value, format: o.format, onInput: o.apply }));
}
function flag(c: Ctx, key: string, label: string, value: boolean, apply: (v: boolean) => void, hint?: string): void {
  row(c, key, label, (slot) => toggle(slot, { value, onChange: apply }), hint);
}

function controlsPage(c: Ctx): void {
  head(c, t('settings.sec.mouse'));
  slide(c, 'mouseSens', t('settings.mouseSens'), {
    min: 0.0005, max: 0.006, step: 0.0001, value: S().mouseSens, format: (v) => (v * 1000).toFixed(1), apply: (v) => put('mouseSens', v),
  });
  flag(c, 'invertY', t('settings.invertY'), S().invertY, (v) => put('invertY', v));
  slide(c, 'fov', t('settings.fov'), {
    min: 60, max: 95, step: 1, value: S().fov, format: (v) => `${v}°`, apply: (v) => put('fov', v),
  });

  const keysHead = head(c, t('settings.sec.keys'));
  keysHead.dataset.anchor = 'keys';
  note(c, t('settings.keys.hint'));
  const bar = h('div', 'st-row', c.body);
  const reset = button(bar, {
    label: t('settings.keys.reset'), kind: 'danger',
    onClick: () => { c.input.resetBindings(); app.ui.toast(t('settings.keys.resetDone'), 'sys'); },
  });
  reset.el.dataset.sk = 'keys-reset';

  const all = c.input.allBindings();
  const grid = h('div', 'st-keys', c.body);
  for (const layer of ['walk', 'machine'] as const) {
    const col = h('div', 'col', grid);
    h('div', 'px-h', col, t(layer === 'walk' ? 'ui.controls.walk' : 'ui.controls.seated'));
    for (const k of Object.keys(all)) {
      if (layerOf(k) !== layer) continue;
      const r = h('div', 'row', col);
      h('span', 'what', r, actionLabel(k));
      const kb = keyBind(r, { key: k, input: c.input });
      kb.el.dataset.sk = `bind:${k}`;
      c.track(() => kb.destroy());
    }
  }
}

function videoPage(c: Ctx): void {
  const cur = currentPreset();
  head(c, t('settings.sec.presets'));
  const status = h('div', 'st-row', c.body);
  h('span', 'st-grow', status, t('settings.preset.now'));
  h('span', 'st-status', status, t(`settings.preset.${cur}`));
  const apply = (id: 'performance' | 'standard'): void => {
    put('psx', { ...S().psx, ...(id === 'performance' ? PERFORMANCE_PSX : STANDARD_PSX) });
    app.ui.toast(t('settings.preset.applied', { name: t(`settings.preset.${id}`) }), 'sys');
    c.reload();
  };
  const btns = h('div', 'st-row', c.body);
  const perf = button(btns, { label: t('settings.preset.performance'), kind: cur === 'performance' ? 'primary' : 'normal', onClick: () => apply('performance') });
  perf.el.dataset.sk = 'preset-performance';
  tip(perf.el, t('settings.preset.performanceHint'));
  const std = button(btns, { label: t('settings.preset.standard'), kind: cur === 'standard' ? 'primary' : 'normal', onClick: () => apply('standard') });
  std.el.dataset.sk = 'preset-standard';
  tip(std.el, t('settings.preset.standardHint'));
  note(c, t(cur === 'standard' ? 'settings.preset.standardHint' : 'settings.preset.performanceHint'));

  head(c, t('settings.sec.picture'));
  flag(c, 'psx.enabled', t('settings.psx'), S().psx.enabled, (v) => putPsx('enabled', v));
  row(c, 'psx.targetHeight', t('settings.res'), (slot) => cycle<number>(slot, {
    options: [180, 224, 240, 288, 360].map((v) => ({ value: v, label: `${v}p` })),
    value: S().psx.targetHeight, wrap: false, onChange: (v) => { putPsx('targetHeight', v); c.reload(); },
  }));
  row(c, 'psx.drawDistance', t('settings.dist'), (slot) => cycle<PsxSettings['drawDistance']>(slot, {
    options: (['near', 'normal', 'far'] as const).map((v) => ({ value: v, label: t(`settings.dist.${v}`) })),
    value: S().psx.drawDistance, wrap: false, onChange: (v) => { putPsx('drawDistance', v); c.reload(); },
  }));
  flag(c, 'psx.crt', t('settings.crt'), S().psx.crt, (v) => { putPsx('crt', v); c.reload(); });

  head(c, t('settings.sec.filters'));
  slide(c, 'psx.jitter', t('settings.jitter'), { min: 0, max: 1, step: 0.05, value: S().psx.jitter, format: pct, apply: (v) => putPsx('jitter', v) });
  flag(c, 'psx.affine', t('settings.affine'), S().psx.affine, (v) => putPsx('affine', v));
  flag(c, 'psx.dither', t('settings.dither'), S().psx.dither, (v) => putPsx('dither', v));
  row(c, 'psx.colorBits', t('settings.colorBits'), (slot) => cycle<PsxSettings['colorBits']>(slot, {
    options: ([5, 6, 8] as const).map((v) => ({ value: v, label: `${v * 3}-bit` })),
    value: S().psx.colorBits, wrap: false, onChange: (v) => putPsx('colorBits', v),
  }));
  slide(c, 'psx.scanlines', t('settings.scanlines'), { min: 0, max: 1, step: 0.05, value: S().psx.scanlines, format: pct, apply: (v) => putPsx('scanlines', v) });
  slide(c, 'psx.vignette', t('settings.vignette'), { min: 0, max: 1, step: 0.05, value: S().psx.vignette, format: pct, apply: (v) => putPsx('vignette', v) });
}

function audioPage(c: Ctx): void {
  head(c, t('settings.sec.volume'));
  for (const k of ['master', 'sfx', 'ui', 'music', 'amb', 'voice'] as const) {
    slide(c, `vol.${k}`, t(`settings.vol.${k}`), { min: 0, max: 1, step: 0.05, value: S().vol[k], format: pct, apply: (v) => putVol(k, v) });
  }
}

function accessPage(c: Ctx): void {
  head(c, t('settings.sec.language'));
  row(c, 'lang', t('settings.lang'), (slot) => cycle<Settings['lang']>(slot, {
    options: [{ value: 'en', label: 'English' }, { value: 'tr', label: 'Türkçe' }],   // i18n-ok: language names are shown in their own language
    value: S().lang, onChange: (v) => put('lang', v),
  }));

  head(c, t('settings.sec.comfort'));
  flag(c, 'calm', t('settings.calm'), S().calm, (v) => put('calm', v), t('settings.calm.tip'));
  slide(c, 'headBob', t('settings.headBob'), { min: 0, max: 1, step: 0.05, value: S().headBob, format: pct, apply: (v) => put('headBob', v) });
  slide(c, 'shake', t('settings.shake'), { min: 0, max: 1, step: 0.05, value: S().shake, format: pct, apply: (v) => put('shake', v) });
  flag(c, 'reduceFlashing', t('settings.reduceFlashing'), S().reduceFlashing, (v) => put('reduceFlashing', v), t('settings.reduceFlashing.tip'));

  head(c, t('settings.sec.interface'));
  slide(c, 'textScale', t('settings.textScale'), { min: 1, max: 1.5, step: 0.05, value: S().textScale, format: pct, apply: (v) => put('textScale', v) });
  row(c, 'crosshair', t('settings.crosshair'), (slot) => cycle<Settings['crosshair']>(slot, {
    options: (['dot', 'cross', 'none'] as const).map((v) => ({ value: v, label: t(`settings.crosshair.${v}`) })),
    value: S().crosshair, onChange: (v) => put('crosshair', v),
  }));
  flag(c, 'subtitles', t('settings.subtitles'), S().subtitles, (v) => put('subtitles', v));
  flag(c, 'colorblind', t('settings.colorblind'), S().colorblind, (v) => put('colorblind', v));
  flag(c, 'holdToConfirm', t('settings.holdToConfirm'), S().holdToConfirm, (v) => put('holdToConfirm', v), t('settings.holdToConfirm.tip'));
}

// ── the panel ─────────────────────────────────────────────────────────────────────────────────────
function mount(el: HTMLElement, o: SettingsOpts): () => void {
  modalPanel(el, { escClose: true, dim: true });
  const input = app.input as InputExt;
  let page: SettingsPage = o.page ?? 'controls';
  let wantKeys = o.focus === 'keys';
  let pageOff: Array<() => void> = [];
  let tabsW: Tabs | null = null;
  let scrollEl: HTMLElement | null = null;
  let bodyEl: HTMLElement | null = null;
  let closed = false;

  const disposePage = (): void => { for (const d of pageOff.splice(0)) d(); };
  const focusedKey = (): string | null => {
    const a = document.activeElement;
    return a instanceof HTMLElement && el.contains(a) ? (a.dataset.sk ?? null) : null;
  };
  const refocus = (sk: string | null): void => {
    if (!sk) return;
    el.querySelector<HTMLElement>(`[data-sk="${CSS.escape(sk)}"]`)?.focus({ preventScroll: true });
  };

  const renderPage = (keepScroll: boolean): void => {
    if (!bodyEl || !scrollEl) return;
    const sk = focusedKey();
    const top = keepScroll ? scrollEl.scrollTop : 0;
    disposePage();
    bodyEl.replaceChildren();
    const ctx: Ctx = {
      body: bodyEl, input, reload: () => renderPage(true), track: (d) => { pageOff.push(d); },
    };
    if (page === 'controls') controlsPage(ctx);
    else if (page === 'video') videoPage(ctx);
    else if (page === 'audio') audioPage(ctx);
    else accessPage(ctx);
    scrollEl.scrollTop = top;
    if (wantKeys && page === 'controls') {
      wantKeys = false;
      bodyEl.querySelector<HTMLElement>('[data-anchor="keys"]')?.scrollIntoView({ block: 'start' });
    }
    refocus(sk);
  };

  const build = (): void => {
    const sk = focusedKey();
    disposePage();
    el.replaceChildren();
    const fr = frame(el, { title: t('settings.title'), width: FRAME_W, className: 'st-frame' });
    tabsW = tabs(fr.body, {
      tabs: PAGES.map((id) => ({ id, label: t(`settings.tab.${id}`) })),
      active: page,
      onChange: (id) => { page = id as SettingsPage; renderPage(false); },
    });
    tabsW.el.classList.add('st-tabs');
    scrollEl = scroll(fr.body);
    scrollEl.classList.add('st-scroll');
    bodyEl = h('div', 'st-body', scrollEl);
    const foot = h('div', 'st-foot', fr.body);
    h('div', 'hint', foot, t('settings.footer'));
    const back = button(foot, { label: t('common.back'), kind: 'primary', onClick: () => closeSettingsScreen() });
    back.el.dataset.sk = 'back';
    renderPage(false);
    refocus(sk);
  };

  const select = (next: SettingsPage, focus?: 'keys'): void => {
    page = next;
    wantKeys = focus === 'keys';
    tabsW?.select(next);
    renderPage(false);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (keyCaptureActive() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (input.codesOf('help').includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); closeSettingsScreen(); return; }
    const d = e.code === 'KeyQ' || e.code === 'PageUp' ? -1 : e.code === 'KeyE' || e.code === 'PageDown' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    select(PAGES[(PAGES.indexOf(page) + d + PAGES.length) % PAGES.length]);
    uiSfx('click', 0.6);
  };
  window.addEventListener('keydown', onKey);
  // a language change re-texts everything: rebuild the whole frame, keeping the page and the focused control
  const offLang = bus.on('lang:changed', () => { if (!closed) build(); });

  live = { select };
  build();
  uiSfx('popUp', 0.6);

  return () => {
    closed = true;
    live = null;
    window.removeEventListener('keydown', onKey);
    offLang();
    disposePage();
    try { o.onClose?.(); } catch (e) { log.error('settings', 'onClose failed', e); }
  };
}
