/**
 * Shared frame for the anime presentation: a DOM root over the canvas, a serial queue (one presentation at a time),
 * the Skip / key handling, the motion policy (Calm Mode, reduceFlashing), and the cut-in panel itself.
 *
 * Every presentation is a `Ctl` run: `pause()` and `typewrite()` resolve early when the player skips, so a skipped
 * sequence falls through to its end state instead of waiting.
 */
import { has, t } from '@/core/i18n';
import { portraitSpec, portraitSrc, type Expr } from './portrait';

export interface Motion { calm: boolean; noFlash: boolean }
export interface Ctl {
  skipped: boolean;
  /** Called on Skip: each entry resolves a pending pause or typewriter. */
  wake: Set<() => void>;
  /** Called on E / Space / Enter while this presentation is on screen. */
  key: (() => void) | null;
  m: Motion;
  stages: HTMLElement[];
}

const NO_MOTION: Motion = { calm: false, noFlash: false };
let motionSource: () => Motion = () => NO_MOTION;

/** Where Calm Mode and reduceFlashing come from. `installManga(app)` sets it to the save settings. */
export function setMotionSource(fn: () => Motion): void { motionSource = fn; }

export function motion(): Motion {
  try { return motionSource(); } catch { return NO_MOTION; }
}

let root: HTMLElement | null = null;
let active: Ctl | null = null;
let chain: Promise<unknown> = Promise.resolve();

function onKey(e: KeyboardEvent): void {
  const c = active;
  if (!c) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(c); return; }
  if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    c.key?.();
  }
}

function ensureRoot(): HTMLElement {
  if (!root) {
    root = document.createElement('div');
    root.className = 'manga-root';
    root.setAttribute('aria-live', 'polite');
    window.addEventListener('keydown', onKey, true);
  }
  if (!root.isConnected) document.body.appendChild(root);
  return root;
}

/** Run one presentation after the ones already queued. Resolves with its result when it ends or is skipped. */
export function enqueue<T>(run: (ctl: Ctl) => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const ctl: Ctl = { skipped: false, wake: new Set(), key: null, m: motion(), stages: [] };
    active = ctl;
    try {
      return await run(ctl);
    } finally {
      active = null;
      sayLine(false);
      for (const el of ctl.stages) el.remove();
      ctl.stages.length = 0;
    }
  });
  chain = next.catch((): undefined => undefined);
  return next;
}

/** Whether a presentation is on screen now (used by callers that must not stack). */
export function busy(): boolean { return active !== null; }

export function skip(ctl: Ctl | null = active): void {
  if (!ctl || ctl.skipped) return;
  ctl.skipped = true;
  for (const w of [...ctl.wake]) w();
}

/** A full-screen layer for one presentation step, tagged for Calm / reduceFlashing styling. */
export function stage(ctl: Ctl, cls: string): HTMLElement {
  const el = document.createElement('section');
  el.className = `mg-stage ${cls}`;
  if (ctl.m.calm) el.dataset.calm = '1';
  if (ctl.m.noFlash) el.dataset.noflash = '1';
  ensureRoot().appendChild(el);
  ctl.stages.push(el);
  return el;
}

/** Adds the `on` class on the next frame so CSS transitions run from the initial state. */
export function show(el: HTMLElement): void {
  void el.getBoundingClientRect();
  el.classList.add('on');
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function skipButton(ctl: Ctl): HTMLButtonElement {
  const b = el('button', 'mg-skip', t('manga.skip'));
  b.type = 'button';
  b.addEventListener('click', (e) => { e.stopPropagation(); skip(ctl); });
  return b;
}

/** Resolves after `ms`, or at once when the presentation is skipped. */
export function pause(ctl: Ctl, ms: number): Promise<void> {
  if (ctl.skipped || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let id = 0;
    const done = (): void => { clearTimeout(id); ctl.wake.delete(done); resolve(); };
    id = window.setTimeout(done, ms);
    ctl.wake.add(done);
  });
}

/** Types `text` into `node` at `cps` characters per second. `finish()` shows it all at once. */
export function typewrite(ctl: Ctl, node: HTMLElement, text: string, cps = 40): { done: Promise<void>; finish: () => void } {
  const chars = Array.from(text);
  let i = 0;
  let id = 0;
  let settled = false;
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((r) => { resolveDone = r; });
  const finish = (): void => {
    if (settled) return;
    settled = true;
    clearInterval(id);
    ctl.wake.delete(finish);
    node.textContent = text;
    resolveDone();
  };
  if (ctl.skipped) {
    finish();
  } else {
    ctl.wake.add(finish);
    node.textContent = '';
    id = window.setInterval(() => {
      i++;
      node.textContent = chars.slice(0, i).join('');
      if (i >= chars.length) finish();
    }, 1000 / cps);
  }
  return { done, finish };
}

/** Translated text for a key that may be missing for a given id (falls back to `fallbackKey`). */
export function textOr(key: string, fallbackKey: string): string {
  return has(key) ? t(key) : t(fallbackKey);
}

export function speakerName(id: string): string { return textOr(`manga.who.${id}`, 'manga.who.you'); }
export function speakerTitle(id: string): string { return textOr(`manga.title.${id}`, 'manga.title.you'); }

// ── cut-in ──────────────────────────────────────────────────────────────────────────────────────
export interface CutinOpts { side?: 'left' | 'right'; hold?: number }

/**
 * Skewed manga panel with the portrait sliding in over 0.25 s, halftone and speed lines, the speaker's plate and an
 * optional line. Calm Mode fades instead of sliding; reduceFlashing freezes the speed lines.
 */
export function cutin(rivalId: string, expr: Expr, lineKey?: string, opts: CutinOpts = {}): Promise<void> {
  return enqueue(async (ctl) => {
    const host = stage(ctl, 'mg-cutin');
    host.classList.add(opts.side === 'left' ? 'side-left' : 'side-right');
    const band = el('div', 'mg-band');
    const panel = el('div', 'mg-panel');
    const pal = portraitSpec(rivalId).palette;
    panel.style.setProperty('--acc', pal.accent);
    panel.style.setProperty('--ink', pal.ink);
    panel.style.setProperty('--paper', pal.paper);
    const halftone = el('div', 'mg-halftone');
    const speed = el('div', 'mg-speed');
    const img = el('img', 'mg-portrait');
    img.alt = '';
    img.src = portraitSrc(rivalId, expr);
    const plate = el('div', 'mg-plate');
    plate.append(el('span', 'mg-name', speakerName(rivalId)), el('span', 'mg-title', speakerTitle(rivalId)));
    panel.append(halftone, speed, img, plate);
    if (lineKey) { panel.append(el('p', 'mg-line', t(lineKey))); sayLine(true); }
    band.append(panel);
    host.append(band, skipButton(ctl));
    show(host);
    await pause(ctl, opts.hold ?? (lineKey ? 2600 : 1500));
    host.classList.remove('on');
    await pause(ctl, ctl.m.calm ? 120 : 230);
  });
}

/**
 * Marks the presentation's own line as on screen, so the standard subtitle bar steps aside instead of rendering the
 * same words behind the panel (CSS: `body.mg-say .px-subtitle`). Cleared when the presentation ends or is skipped.
 */
export function sayLine(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.body?.classList.toggle('mg-say', on);
}
