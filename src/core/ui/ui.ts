/**
 * DOM UI overlay (CORE-UI). Implements the frozen `UIOverlay` (ui/types.ts, TECH_SPEC §2.10, ART_BIBLE §10) on the
 * `#ui` element above the canvas. Keep `import './ui.css'` and the factory name `createUI`.
 *
 *  scale      pixel unit `--px` = `floor(innerHeight × dpr / 270)` device px × `settings.uiScale` (Settings > Access "UI
 *             scale", 60–130 %, def 75 %; 100 % = the spec's `floor(innerHeight / 270)` CSS px at DPR 1). Live via
 *             `settings:changed`. Text scale and Reduce Flashing /
 *             colour-blind flags follow `settings:changed`. Fonts: Press Start 2P headings, VT323 body (core/ui/ui.css).
 *  gameplay   prompt (+ crosshair brackets) · toasts · machine HUD strip · subtitles · phone `choice()` (number keys)
 *  juice      `bigWin()` banner (letters drop, rolling amount, rays, coins, flash/shake) · `banner()` · `fly()` numbers that
 *             arc into HUD anchors and bump them · `bump()` · flash / fade / letterbox · skip ring
 *  surfaces   `modal()` dialogs and `panel()`s; modal ones (see `widgets.modalPanel`) set `blocking`, which core/input
 *             turns into mode 'ui' through the `ui:blocking` event. Esc closes the topmost modal / escClose panel.
 *
 * Extensions beyond the frozen interface (`UIOverlayX`): `hudLayer` (permanent HUD container, hidden by
 * `setHudVisible(false)`), `banner()`, extra toast kinds, `dispose()`.
 */
import './ui.css';
import './subtitles.css';
import type * as THREE from 'three';
import { hintKey, type BindingKey } from '../input/types';
import type {
  FlyOpts, HudAnchorId, MachineHudSpec, ModalSpec, PanelHandle, ToastKind, UIOverlay,
} from './types';
import type { WinTier } from '@/game/types';
import { app } from '../app';
import { bus } from '../events';
import { fmtCoins, fmtNum, t, upper } from '../i18n';
import { clamp } from '../math';
import { log } from '../log';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { subtitles, SUB_TICK, type SubView } from './subtitles';
import { bannerToastKind, fitBannerSize } from './bannerKit';
import type { VoiceSpeaker } from '../audio/types';
import {
  COLORS, button, counter, focusFirst, frame, gloveCursors, h, iconEl, initWidgets, keycap, navGroup, navItems, pixelIcon, textField,
  keyCaptureActive, tickWidgets, uiRng, uiSfx, type Button, type Counter, type IconName, type TextField,
} from './widgets';

export interface UiDeps { keyLabel(a: BindingKey): string }

/** Toast kinds beyond the frozen five (ART_BIBLE §10.7): MONEY gold, CURSE violet flicker, PHONE amber. */
export type ExtraToastKind = 'money' | 'curse' | 'phone' | 'loki';
/** Which toasts `dismissToasts` takes: by kind, by tag, or both. An empty match takes every toast. */
export interface ToastMatch { kind?: ToastKind | ExtraToastKind; tag?: string }
export interface BannerOpts {
  color?: string;
  shadow?: string;
  /** Seconds the text holds before the dither-dissolve (default 1.5). */
  hold?: number;
  /** Sine wave through the letters (jackpot). */
  wave?: boolean;
  /** Font size in UI px: 8 | 16 | 24 (default 24). */
  size?: 8 | 16 | 24;
}
export interface UIOverlayX extends UIOverlay {
  /** Permanent HUD container (wallet, quota, clock …); hidden by `setHudVisible(false)`. */
  readonly hudLayer: HTMLElement;
  /** `tag` names the toast for `dismissToasts`; a warning (kind 'warn') never waits behind the news on screen. */
  toast(text: string, kind?: ToastKind | ExtraToastKind, dur?: number, tag?: string): void;
  /** Removes the toasts that match, on screen or queued, at once. Their news is forgotten, so the next news with the same
   *  words shows instead of merging into a toast that is gone (a result replaces its confirm prompt). */
  dismissToasts(match?: ToastMatch): void;
  /** Holds the toasts while a modal they would cover is open (the Night Card panel; the toast layer paints over panels): the
   *  news on screen and in line is taken off and new news queues, in order, until `holdToasts(false)` shows it all. */
  holdToasts(on: boolean): void;
  /** Big banner ("NIGHT 3", "LAST CALL", "PAID IN FULL"): letters drop in, hold, dither-dissolve. */
  banner(text: string, o?: BannerOpts): Promise<void>;
  dispose(): void;
}

const TOAST_ICON: Record<string, IconName> = {
  info: 'info', good: 'check', bad: 'cross', warn: 'warn', sys: 'net', money: 'coin', curse: 'curse', phone: 'bell',
};
/** A soft cue per toast kind, quiet so it sits under the sound that caused the toast. 'phone' and 'loki' have their own (the buzz, his card riffle). */
export const TOAST_SFX: Readonly<Record<string, readonly [string, number]>> = {
  info: ['msgBlip', 0.3], good: ['countDing', 0.4], bad: ['error', 0.4], warn: ['error', 0.3], sys: ['popUp', 0.3], money: ['coinClink', 0.45], curse: ['whisper', 0.3],
};
/** Toasts on screen at once; the rest wait in line. */
const TOAST_VISIBLE = 2;
/** Toasts held behind an open modal (`holdToasts`); the oldest drops past this many. */
const TOAST_HELD_MAX = 6;
/** A toast or banner with the same news as one shown in the last this-many ms merges into it (or is dropped). */
const ANNOUNCE_MERGE_MS = 3000;
const MAX_FLY = 48;
const HINT_IDLE_S = 4;

interface BwCfg { dur: number; size: 16 | 24; rays: boolean; coins: number; flashes: number; shake: number; wave: boolean; color: string; shadow: string }
type BwKey = 'mini' | 'big' | 'huge' | 'mega' | 'jackpot';
const BW: Record<BwKey, BwCfg> = {
  mini: { dur: 1.6, size: 16, rays: false, coins: 6, flashes: 0, shake: 0, wave: false, color: COLORS.shine, shadow: COLORS.red },
  big: { dur: 2.5, size: 16, rays: false, coins: 18, flashes: 0, shake: 1.5, wave: false, color: COLORS.shine, shadow: COLORS.red },
  huge: { dur: 4, size: 24, rays: true, coins: 40, flashes: 1, shake: 3, wave: false, color: COLORS.bulb, shadow: COLORS.red },
  mega: { dur: 5, size: 24, rays: true, coins: 60, flashes: 2, shake: 4, wave: true, color: COLORS.bulb, shadow: COLORS.signal },
  jackpot: { dur: 6, size: 24, rays: true, coins: 80, flashes: 2, shake: 5, wave: true, color: COLORS.shine, shadow: COLORS.signal },
};
/** `WinTier` may or may not carry 'mega' yet (TECH_SPEC §11.5); unknown / low tiers fall back to the mini banner. */
const bwKey = (tier: string): BwKey => (tier === 'jackpot' || tier === 'mega' || tier === 'huge' || tier === 'big' ? tier : 'mini');
const DISSOLVE_MS = 400;
const BW_SKIP_AFTER_MS = 800;
/** Quiet time between two banners (after one dissolves), so the next title card reads on its own. */
const BANNER_GAP_MS = 350;

const settingsNow = (): Settings | undefined => app?.save?.data?.settings;

// ── subtitles: the bar that draws the one subtitle system (ui/subtitles.ts). The queue runs on the UI timers and
// freezes while the game is paused, the manga box (body.mg-say) or the hotline deal sheet (.hl-sheet) is up.
let subDriverOn = false;
let subEl: HTMLElement | null = null;
let subWho: HTMLElement | null = null;
let subTxt: HTMLElement | null = null;
function armSubtitleDriver(): void {
  if (subDriverOn || !app?.timers?.ui) return;
  subDriverOn = true;
  app.timers.ui.every(SUB_TICK, () => subtitles.tick(SUB_TICK, subFrozen()));
}
function subFrozen(): boolean {
  return !!app?.simPaused || !!document.body?.classList.contains('mg-say') || !!subEl?.parentElement?.classList.contains('hl-sheet');
}
function renderSub(v: SubView | null): void {
  if (!subEl || !subWho || !subTxt) return;
  if (!v || settingsNow()?.subtitles === false) { subEl.classList.remove('on'); subEl.removeAttribute('data-phase'); return; }
  subWho.textContent = v.speaker ? upper(v.speaker) : ''; subWho.style.display = v.speaker ? '' : 'none';
  subTxt.textContent = v.shown;
  subEl.dataset.lane = v.lane; subEl.dataset.phase = v.phase;
  subEl.classList.toggle('sub-still', !!settingsNow()?.reduceMotion);
  subEl.classList.add('on');
}
const eat = (e: Event): void => { e.preventDefault(); e.stopImmediatePropagation(); };
const isTextTarget = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

interface PanelRec { el: HTMLElement; cleanup?: () => void; backdrop: HTMLElement | null; nav?: () => void }
interface ModalRec { el: HTMLElement; cancel(): void; primary(): void }
interface ChoiceJob { title: string; options: string[]; timeout?: number; resolve(i: number): void }
interface ToastRec { text: string; kind: string; dur: number; words: string[]; count: number; timer: number; shown: boolean; tag?: string; el?: HTMLElement; cnt?: HTMLElement }

/**
 * Words that identify a piece of news: upper-cased letter/number runs, 2+ characters (any digit run counts).
 * "EVENT OVER: Lucky Moon" and "ENDED: LUCKY MOON" both give LUCKY and MOON.
 */
export function announceWords(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLocaleUpperCase('en').split(/[^\p{L}\p{N}]+/u)) if (w.length >= 2 || /\d/.test(w)) out.add(w);
  return [...out];
}

/** Same news when they share at least 60 % of the shorter message's words (and at least one). */
function sameNews(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const inB = new Set(b);
  let shared = 0;
  for (const w of a) if (inB.has(w)) shared++;
  return shared >= 1 && shared / Math.min(a.length, b.length) >= 0.6;
}

/** Everything announced (toast or banner or feed line) in the last ANNOUNCE_MERGE_MS. `rec` is set for toasts. */
interface Announce { words: string[]; at: number; rec?: ToastRec }
const announced: Announce[] = [];

function recentNews(words: string[]): Announce | undefined {
  const now = performance.now();
  for (let i = announced.length - 1; i >= 0; i--) if (now - announced[i].at > ANNOUNCE_MERGE_MS) announced.splice(i, 1);
  return announced.find((a) => sameNews(a.words, words));
}

/**
 * Claims a banner / feed line for its news. True = new, now recorded (show it). False = the same news was announced in
 * the last 3 s, so the caller drops it. Toasts and banners share this record, so one news item never shows twice.
 */
export function claimAnnounce(text: string): boolean {
  const words = announceWords(text);
  if (recentNews(words)) return false;
  announced.push({ words, at: performance.now() });
  return true;
}

export function createUI(root: HTMLElement, deps: UiDeps): UIOverlayX {
  root.classList.add('px-root');
  root.replaceChildren();

  let px = 4;
  let lastH = -1;
  let lastDpr = -1;
  let settingsApplied = false;
  const disposers: Array<() => void> = [];
  const listen = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, capture = false): void => {
    window.addEventListener(type, fn as EventListener, capture);
    disposers.push(() => window.removeEventListener(type, fn as EventListener, capture));
  };

  // ── layers (back to front) ──────────────────────────────────────────────────────────────────────
  const hudLayer = h('div', 'px-layer px-hudlayer', root);
  const cross = h('div', 'px-cross s-dot', root);
  for (const c of ['tl', 'tr', 'bl', 'br']) h('i', `brk c-${c}`, cross);
  h('i', 'dot', cross);
  const promptEl = h('div', 'px-prompt', root);
  const pMain = h('div', 'px-prompt-main', promptEl);
  const pKey = keycap('', pMain);
  const pLabel = h('span', 'verb', pMain);
  const pSub = h('div', 'px-prompt-sub', promptEl);
  const mhud = h('div', 'px-mhud', hudLayer);
  const choiceLayer = h('div', 'px-layer px-choices', root);
  subEl = h('div', 'px-subtitle', root);
  subWho = h('span', 'who', subEl);
  subTxt = h('span', 'txt', subEl);
  subtitles.bind({
    blip: (voice, ch) => { app?.audio?.blip(voice as VoiceSpeaker, ch); },
    render: renderSub,
    speed: () => settingsNow()?.subtitleSpeed ?? 'normal',
    reduceMotion: () => !!settingsNow()?.reduceMotion,
    arm: armSubtitleDriver,
  });
  const panelLayer = h('div', 'px-layer px-panels', root);
  const toastsEl = h('div', 'px-toasts', root);
  toastsEl.setAttribute('role', 'status'); toastsEl.setAttribute('aria-live', 'polite');
  const flyLayer = h('div', 'px-layer px-flys', root);
  const bwLayer = h('div', 'px-layer px-bwl', root);
  const barTop = h('div', 'px-lbar top', root);
  const barBot = h('div', 'px-lbar bot', root);
  const skipEl = h('div', 'px-skip', root);
  const skipRing = h('div', 'ring', skipEl);
  const skipKey = keycap('', skipEl);
  const skipLbl = h('span', 'lbl', skipEl);
  const modalLayer = h('div', 'px-layer px-modals', root);
  const veilEl = h('div', 'px-veil', root);
  h('div', 'blink', veilEl, t('ui.veil.click'));
  const flashEl = h('div', 'px-flash', root);
  const fadeEl = h('div', 'px-fade', root);

  const anchors = new Map<HudAnchorId, HTMLElement>();
  const panels = new Map<string, PanelRec>();
  const modals: ModalRec[] = [];

  // ── scale + settings flags ──────────────────────────────────────────────────────────────────────
  let cursorPx = 0;
  function applyScale(): void {
    const H = window.innerHeight || 720;
    const dpr = window.devicePixelRatio || 1;
    lastH = H; lastDpr = dpr;
    // The 100 % unit is a whole number of DEVICE pixels, floor(H × DPR / 270) (= floor(H / 270) CSS px at DPR 1).
    // The Settings > Access "UI scale" slider (uiScale, 60–130 %, def 75 %) multiplies it; at the default 75 % that is
    // 1.5 px at 720p and 3 px at 1080p. Fractional units are fine: every size is N × --u and the whole overlay scales with it.
    const us = clamp(settingsNow()?.uiScale ?? DEFAULT_SETTINGS.uiScale, 0.6, 1.3);
    const base = Math.max(1, Math.floor((H * dpr) / 270));
    const dev = Math.max(1, base * us);
    px = Math.round((dev / dpr) * 64) / 64;                    // CSS px, on Chrome's 1/64 layout grid
    const ts = clamp(settingsNow()?.textScale ?? 1, 1, 1.5);
    root.style.setProperty('--px', String(px));
    root.style.setProperty('--fb', `${Math.round(16 * px * ts * 64) / 64}px`);
    root.style.setProperty('--fh', `${Math.round(8 * px * ts * 64) / 64}px`);
    root.style.setProperty('--bar-h', `${Math.floor((H * 0.12) / px) * px}px`);
    if (cursorPx !== px) {
      cursorPx = px;
      const c = gloveCursors(px);
      document.documentElement.style.setProperty('--px-cur', c.arrow);
      document.documentElement.style.setProperty('--px-cur-point', c.point);
    }
    syncHudHeight();
  }
  function applyFlags(): void {
    const s = settingsNow();
    root.classList.toggle('rf', !!s?.reduceFlashing);
    root.classList.toggle('cb', !!s?.colorblind);
    syncCrosshair();
    applyScale();
    settingsApplied = !!s;
  }

  // ── blocking ────────────────────────────────────────────────────────────────────────────────────
  let blockedLast = false;
  const computeBlocking = (): boolean => {
    if (modals.length) return true;
    for (const p of panels.values()) if (p.el.dataset.modal === '1') return true;
    return false;
  };
  function syncBlocking(): void {
    for (const p of panels.values()) {                    // late `modalPanel()` calls still get their backdrop + nav
      if (p.el.dataset.modal === '1') {
        if (!p.backdrop && p.el.dataset.dim !== '0') { p.backdrop = h('div', 'px-backdrop'); panelLayer.insertBefore(p.backdrop, p.el); }
        if (!p.nav) { p.nav = navGroup(p.el); if (!p.el.contains(document.activeElement)) focusFirst(p.el); }
      }
    }
    const b = computeBlocking();
    if (b !== blockedLast) {
      blockedLast = b;
      bwLayer.classList.toggle('held', b);      // a banner in flight is out of sight while a modal is open (ui.css .px-bwl.held)
      bus.emit('ui:blocking', { blocking: b });
      if (!b) pumpBw();                         // the banners queued behind the modal come on now
    }
  }
  initWidgets(root, syncBlocking);

  // ── crosshair + prompt ──────────────────────────────────────────────────────────────────────────
  let crossReq: 'dot' | 'hand' | 'none' = 'dot';
  let crossHidden = false;
  function syncCrosshair(): void {
    const pref = settingsNow()?.crosshair ?? 'dot';
    const style = crossReq === 'dot' ? (pref === 'cross' ? 'cross' : pref === 'none' ? 'none' : 'dot') : crossReq;
    cross.className = cross.className.replace(/\bs-\w+/g, '').trim() + ` s-${style}`;
  }
  let promptSig = '';
  let promptOn = false;

  // ── toasts ──────────────────────────────────────────────────────────────────────────────────────
  const toastShown: ToastRec[] = [];      // on screen, newest first (at most TOAST_VISIBLE)
  const toastWaiting: ToastRec[] = [];    // queued behind them, first come first shown (warnings ahead of the news)
  let toastHold = false;                  // holdToasts(true): toasts wait in toastHeld (in order) until it is released
  const toastHeld: Array<{ text: string; kind: string; dur: number; tag?: string }> = [];
  function showToast(rec: ToastRec): void {
    const el = h('div', `px-toast k-${rec.kind}`);
    h('i', 'bar', el);
    const ico = h('span', 'ico', el); ico.appendChild(rec.kind === 'loki' ? iconEl('icon.joker', 16) : pixelIcon(TOAST_ICON[rec.kind] ?? 'info'));
    h('span', 'txt', el, rec.text);
    rec.cnt = h('span', 'cnt', el, rec.count > 1 ? `×${rec.count}` : '');
    rec.el = el;
    rec.shown = true;
    toastsEl.prepend(el);
    toastShown.unshift(rec);
    el.animate([{ transform: `translateX(${40 * px}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.3,1)' });
    rec.timer = window.setTimeout(() => dismissToast(rec), rec.dur * 1000);
    const cue = TOAST_SFX[rec.kind];
    if (cue) uiSfx(cue[0], cue[1]);
  }
  /** Takes a shown toast off the screen. Does not promote the next one (the caller decides who takes the slot). */
  function hideToast(rec: ToastRec, quick = false): boolean {
    const i = toastShown.indexOf(rec);
    if (i < 0 || !rec.el) return false;
    toastShown.splice(i, 1);
    rec.shown = false;
    clearTimeout(rec.timer);
    const el = rec.el;
    const a = el.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${40 * px}px)`, opacity: 0 }],
      { duration: quick ? 90 : 220, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => el.remove();
    setTimeout(() => el.remove(), 400);
    return true;
  }
  function promoteToasts(): void {
    while (toastShown.length < TOAST_VISIBLE && toastWaiting.length) showToast(toastWaiting.shift()!);
  }
  function dismissToast(rec: ToastRec, quick = false): void {
    const w = toastWaiting.indexOf(rec);
    if (w >= 0) { toastWaiting.splice(w, 1); return; }
    if (hideToast(rec, quick)) promoteToasts();
  }
  /** Puts a toast in line. A warning goes behind the warnings already waiting and ahead of the news; `first` (a news displaced
   *  by a warning) goes to the head of the news. */
  function enline(rec: ToastRec, first = false): void {
    const news = toastWaiting.findIndex((w) => w.kind !== 'warn');
    const at = (rec.kind === 'warn' || first) && news >= 0 ? news : toastWaiting.length;
    toastWaiting.splice(at, 0, rec);
  }
  /** A warning (a confirm prompt, an arm prompt) never waits behind the news: it takes the slot of the oldest news on screen,
   *  and that news goes back first in line. Only news and warnings already on screen keep their place. */
  function admit(rec: ToastRec): void {
    if (toastShown.length < TOAST_VISIBLE) { showToast(rec); return; }
    if (rec.kind === 'warn') {
      let old: ToastRec | undefined;
      for (let i = toastShown.length - 1; i >= 0 && !old; i--) if (toastShown[i].kind !== 'warn') old = toastShown[i];
      if (old) { hideToast(old, true); enline(old, true); showToast(rec); return; }
    }
    enline(rec);
  }
  /** Same news while the toast is on screen or queued: count it on that toast and restart its timer. */
  function mergeToast(rec: ToastRec, dur: number): void {
    rec.count++;
    if (!rec.shown) return;
    if (rec.cnt) rec.cnt.textContent = `×${rec.count}`;
    rec.el?.animate([{ scale: '1.12' }, { scale: '1' }], { duration: 140 });
    clearTimeout(rec.timer);
    rec.dur = Math.max(rec.dur, dur);
    rec.timer = window.setTimeout(() => dismissToast(rec), rec.dur * 1000);
  }
  /** Removes the matching toasts (kind and/or tag; all when empty), shown or queued. Waiting ones go first, so none is promoted
   *  just to be removed. */
  function clearToasts(match: ToastMatch): void {
    const hit = (kind: string, tag?: string): boolean => !((match.kind && kind !== match.kind) || (match.tag && tag !== match.tag));
    for (let i = toastHeld.length - 1; i >= 0; i--) if (hit(toastHeld[i].kind, toastHeld[i].tag)) toastHeld.splice(i, 1);
    for (const rec of [...toastWaiting, ...toastShown]) {
      if (!hit(rec.kind, rec.tag)) continue;
      for (let i = announced.length - 1; i >= 0; i--) if (announced[i].rec === rec) announced.splice(i, 1);
      dismissToast(rec, true);
    }
  }

  // ── machine HUD ─────────────────────────────────────────────────────────────────────────────────
  const mhRow = h('div', 'mh-row', mhud);                    // one line: title · bet · wallet · stats; hints sit below
  const mhTitle = h('div', 'mh-title', mhRow);
  const mhBet = h('div', 'mh-bet', mhRow);
  const mhBetL = h('span', 'arr', mhBet); mhBetL.appendChild(pixelIcon('arrowL'));
  const mhBetLab = h('span', 'lab', mhBet);
  const mhBetNum = h('span', 'num', mhBet);
  const mhBetR = h('span', 'arr', mhBet); mhBetR.appendChild(pixelIcon('arrowR'));
  const mhWalletBox = h('div', 'mh-wallet', mhRow);
  mhWalletBox.appendChild(pixelIcon('coin'));
  const mhWallet: Counter = counter(mhWalletBox, { fmt: (n) => fmtCoins(n), className: 'gold' });
  const mhStats = h('div', 'mh-stats', mhRow);
  const mhHints = h('div', 'mh-hints', mhud);
  let mhSpec: MachineHudSpec | null = null;
  let mhBetShown: number | null = null;
  let mhSig = { stats: '', hints: '' };
  let lastActivity = performance.now();
  let walletClock = 0;
  const hintCaps: Array<{ cap: HTMLElement; action: BindingKey }> = [];

  function renderHints(spec: MachineHudSpec): void {
    mhHints.replaceChildren();
    hintCaps.length = 0;
    for (const hint of spec.hints) {
      const it = h('span', 'hint', mhHints);
      const action = hintKey(hint.action);
      hintCaps.push({ cap: keycap(deps.keyLabel(action), it), action });
      h('span', 'what', it, hint.label);
    }
  }
  function refreshKeyLabels(): void {
    for (const k of hintCaps) k.cap.textContent = deps.keyLabel(k.action);
    skipKey.textContent = deps.keyLabel('skip');
    syncHudHeight();
  }
  /** Publish the HUD strip's height (`--mh-h`) so subtitles and the skip ring stack above it. */
  function syncHudHeight(): void {
    if (mhSpec) root.style.setProperty('--mh-h', `${mhud.offsetHeight}px`);
  }
  function renderBet(bet: number | null): void {
    mhBet.style.display = bet === null || bet === undefined ? 'none' : '';
    if (bet === null || bet === undefined) { mhBetShown = null; return; }
    mhBetLab.textContent = upper(t('common.bet'));
    mhBetNum.textContent = fmtCoins(bet);
    if (mhBetShown !== null && bet !== mhBetShown) {
      const up = bet > mhBetShown;
      mhBetNum.animate([{ scale: '1.25' }, { scale: '1' }], { duration: 140, easing: 'ease-out' });
      (up ? mhBetR : mhBetL).animate([{ scale: '1.5' }, { scale: '1' }], { duration: 160, easing: 'ease-out' });
      uiSfx('hover', 0.5);
    }
    mhBetShown = bet;
  }

  // ── choice (phone / votes) ──────────────────────────────────────────────────────────────────────
  const choiceQueue: ChoiceJob[] = [];
  let choiceActive: { options: string[]; pick(i: number): void } | null = null;
  function pumpChoice(): void {
    if (choiceActive || !choiceQueue.length) return;
    const job = choiceQueue.shift()!;
    const box = h('div', 'px-choice', choiceLayer);
    h('div', 'ttl', box, job.title);
    let timer = 0;
    const finish = (i: number): void => {
      if (!choiceActive) return;
      choiceActive = null; clearTimeout(timer);
      box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).onfinish = () => box.remove();
      setTimeout(() => box.remove(), 300);
      if (i >= 0) uiSfx('click');
      job.resolve(i);
      pumpChoice();
    };
    job.options.forEach((label, i) => {
      const opt = h('button', 'opt', box);
      opt.type = 'button';
      if (i < 9) keycap(String(i + 1), opt);
      h('span', 'lab', opt, label);
      opt.addEventListener('click', () => finish(i));
      opt.addEventListener('mouseenter', () => uiSfx('hover', 0.5));
    });
    if (job.timeout && job.timeout > 0) {
      const tmr = h('div', 'tmr', box);
      h('i', undefined, tmr).animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: job.timeout * 1000, easing: 'linear', fill: 'forwards' });
      timer = window.setTimeout(() => finish(-1), job.timeout * 1000);
    }
    box.animate([{ opacity: 0, transform: `translateY(${4 * px}px)` }, { opacity: 1, transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
    uiSfx('popUp', 0.6);
    choiceActive = { options: job.options, pick: finish };
  }

  // ── big win / banner ────────────────────────────────────────────────────────────────────────────
  interface BwJob { run(): Promise<void>; resolve(): void; drop(): void }
  const bwQueue: BwJob[] = [];
  let bwActive: { skip(): void; skippableAt: number } | null = null;
  function pumpBw(): void {
    // No banner starts over an open modal (draft, night cards, deal sheet): the queue waits until it closes (syncBlocking).
    if (bwActive || !bwQueue.length || computeBlocking()) return;
    const job = bwQueue.shift()!;
    bwActive = { skip() { /* replaced by run() */ }, skippableAt: Infinity };
    // One banner at a time, with a short breath between them: the next title card never lands on the one still dissolving.
    job.run().catch((e) => log.error('ui', 'banner', e)).finally(() => {
      job.resolve();
      window.setTimeout(() => { bwActive = null; pumpBw(); }, BANNER_GAP_MS);
    });
  }
  function enqueueBw(run: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      bwQueue.push({ run, resolve, drop: resolve });
      while (bwQueue.length > 3) bwQueue.shift()?.drop();     // never build an unbounded backlog of banners
      pumpBw();
    });
  }
  /**
   * Letters drop in one by one (40 ms each, −12 px with a 2 px bounce). Returns the letter wrappers. `soft` (the top-band banners)
   * is a 1 px nudge 20 ms apart: those letters are readable from the first frame, so none of them rides off the baseline.
   */
  function dropLetters(parent: HTMLElement, text: string, wave: boolean, soft = false): HTMLElement[] {
    const rise = (soft ? 1 : 12) * px, gap = soft ? 20 : 40;
    const out: HTMLElement[] = [];
    let word: HTMLElement | null = null;                         // one nowrap box per word: a line break only falls between words
    Array.from(text).forEach((ch, i) => {
      if (ch === '\n') { word = null; h('span', 'Br', parent); return; }
      if (ch === ' ') { word = null; return; }
      if (!word) word = h('span', 'Wd', parent);
      const outer = h('span', 'L', word);
      outer.style.opacity = '0';
      outer.style.setProperty('--i', String(i));
      h('span', wave ? 'W wave' : 'W', outer, ch);
      outer.animate([
        { transform: `translateY(${-rise}px)`, opacity: 0 },
        { transform: `translateY(${soft ? 0 : 2 * px}px)`, opacity: 1, offset: 0.65 },
        { transform: 'translateY(0)', opacity: 1 },
      ], { duration: 240, delay: i * gap, easing: 'steps(6)', fill: 'forwards' });
      out.push(outer);
    });
    return out;
  }
  const dissolve = (el: HTMLElement): Promise<void> => new Promise<void>((res) => {
    const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DISSOLVE_MS, easing: 'steps(8)', fill: 'forwards' });
    a.onfinish = () => res();
    setTimeout(res, DISSOLVE_MS + 100);
  });
  const wait = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));
  /** A banner's hold: time while a modal is open does not count, so the banner waits out of sight and resumes after it. */
  async function heldWait(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 100);
      await wait(step);
      if (!computeBlocking()) left -= step;
    }
  }

  async function runBigWin(amount: number, tier: WinTier, title: string): Promise<void> {
    const key = bwKey(tier);
    const cfg = BW[key];
    const rf = !!settingsNow()?.reduceFlashing;
    const tStart = performance.now();
    const wrap = h('div', `px-bw t-${key}`, bwLayer);
    wrap.style.setProperty('--bw-s', String(cfg.size));
    wrap.style.setProperty('--bw-c', cfg.color);
    wrap.style.setProperty('--bw-sh', cfg.shadow);
    if (cfg.rays) {
      const rays = h('div', 'rays', wrap);
      rays.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: 'forwards' });
    }
    const stage = h('div', 'stage', wrap);
    const titleEl = h('div', 'title', stage);
    dropLetters(titleEl, upper(title), cfg.wave);
    const amtRow = h('div', 'amt', stage);
    h('span', 'plus', amtRow, '+');
    const amt = counter(amtRow, { fmt: (n) => fmtNum(n), tickSfx: 'numberTick', maxDur: cfg.dur });
    amtRow.appendChild(pixelIcon('coin'));
    amtRow.style.opacity = '0';
    // confetti coins (cosmetic RNG; DOM count capped by tier)
    const n = rf ? Math.ceil(cfg.coins / 2) : cfg.coins;
    for (let i = 0; i < n; i++) {
      const c = h('i', `coin c${i % 3}`, wrap);
      c.style.left = `${uiRng.float(2, 98).toFixed(1)}%`;
      c.style.setProperty('--dx', `${Math.round(uiRng.float(-14, 14))}`);
      c.style.setProperty('--d', `${uiRng.float(1.2, 2.2).toFixed(2)}s`);
      c.style.animationDelay = `${uiRng.float(0, cfg.dur * 0.55).toFixed(2)}s`;
    }
    // flash(es) and shake
    if (cfg.flashes >= 1) ui.flash(COLORS.paper, 0.18);
    if (cfg.flashes >= 2) setTimeout(() => ui.flash(COLORS.shine, 0.35), 120);
    const shakeAmp = cfg.shake * px * (settingsNow()?.shake ?? 1);
    if (shakeAmp > 0) {
      const steps = Math.round(0.8 * 30), frames: Keyframe[] = [];
      for (let i = 0; i <= steps; i++) {
        const k = 1 - i / steps, a = shakeAmp * k * k;
        frames.push({ transform: `translate(${Math.round(uiRng.float(-a, a))}px, ${Math.round(uiRng.float(-a, a))}px)`, easing: 'steps(1, end)' });
      }
      stage.animate(frames, { duration: 800 });
    }
    // amount roll starts after the title lands
    await wait(350);
    amtRow.style.opacity = '1';
    amtRow.animate([{ scale: '0.6' }, { scale: '1.15' }, { scale: '1' }], { duration: 260, easing: 'ease-out' });
    uiSfx('popUp', 0.7);
    amt.set(amount, { dur: Math.min(cfg.dur * 0.62, 3.6) });

    // hold, then dither-dissolve; skippable after 0.8 s (key / click)
    let skipped = false;
    let wake: (() => void) | null = null;
    if (bwActive) {
      bwActive.skippableAt = tStart + BW_SKIP_AFTER_MS;
      bwActive.skip = () => { skipped = true; wake?.(); };
    }
    await new Promise<void>((res) => {
      wake = res;
      setTimeout(res, Math.max(0, cfg.dur * 1000 - DISSOLVE_MS - 350));
    });
    if (skipped) amt.set(amount, { instant: true });
    await dissolve(wrap);
    wrap.remove();
  }

  async function runBanner(text: string, o: BannerOpts): Promise<void> {
    // The top band (ui.css `.px-bw.t-banner`): under the HUD top bar, clear of the Night 1 tutorial box and the eye-level neon.
    const wrap = h('div', 'px-bw t-banner', bwLayer);
    // The centre column (ui.css `.px-bw.t-banner .title`): a line that does not fit it on one row steps down to size 16, then 8 (two rows).
    const upperText = upper(text);
    const size = fitBannerSize(upperText, o.size ?? 24, Math.min(root.clientWidth * 0.46, 300 * px), px);
    wrap.style.setProperty('--bw-s', String(size));
    wrap.style.setProperty('--bw-c', o.color ?? COLORS.ivory);
    wrap.style.setProperty('--bw-sh', o.shadow ?? COLORS.black);
    const stage = h('div', 'stage', wrap);
    const titleEl = h('div', 'title', stage);
    dropLetters(titleEl, upperText, !!o.wave, true);
    uiSfx('stamp', 0.6);
    await heldWait((o.hold ?? 1.5) * 1000 + Array.from(text).length * 20 + 240);
    await dissolve(wrap);
    wrap.remove();
  }

  // ── fly + bump ──────────────────────────────────────────────────────────────────────────────────
  let flyActive = 0;
  const bumps = new WeakMap<HTMLElement, Animation>();
  function spark(at: { x: number; y: number }, color: string): void {
    if (flyActive > MAX_FLY / 2) return;
    for (let i = 0; i < 5; i++) {
      const s = h('i', 'px-spark', flyLayer);
      s.style.left = `${at.x}px`; s.style.top = `${at.y}px`; s.style.background = color;
      const ang = (i / 5) * Math.PI * 2 + uiRng.float(0, 1), r = uiRng.float(5, 9) * px;
      const a = s.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.round(Math.cos(ang) * r)}px, ${Math.round(Math.sin(ang) * r)}px) scale(0)`, opacity: 0 },
      ], { duration: 260, easing: 'steps(5, end)' });
      a.onfinish = () => s.remove();
      setTimeout(() => s.remove(), 500);
    }
  }
  function resolveFrom(from: FlyOpts['from']): { x: number; y: number } {
    if ('world' in from) {
      const v = (from.world as THREE.Vector3).clone().project(from.camera);
      if (v.z > 1) return { x: window.innerWidth / 2, y: window.innerHeight * 0.7 };       // behind the camera
      return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
    }
    return from;
  }

  // ── fade / flash ────────────────────────────────────────────────────────────────────────────────
  let fadeAnim: Animation | null = null;
  let fadeDone: (() => void) | null = null;
  let flashAnim: Animation | null = null;
  let lastFlash = -1e9;
  let veilOn = false;

  // ── the interface ───────────────────────────────────────────────────────────────────────────────
  const ui: UIOverlayX = {
    root,
    hudLayer,
    get blocking() { return computeBlocking(); },
    get px() { return px; },

    update(dt) {
      if ((window.innerHeight || 0) !== lastH || (window.devicePixelRatio || 1) !== lastDpr) applyScale();
      if (!settingsApplied && settingsNow()) applyFlags();
      const imode = app?.input?.mode;                           // the default dot only makes sense while walking (ART §10.5)
      const hideCross = crossReq === 'dot' && imode !== undefined && imode !== 'walk';
      if (hideCross !== crossHidden) { crossHidden = hideCross; cross.classList.toggle('hide', hideCross); }
      tickWidgets(dt);
      if (mhSpec) {
        walletClock += dt;
        if (walletClock >= 0.1) {
          walletClock = 0;
          const w = mhSpec.showWallet === false ? null : app?.run?.wallet?.();
          if (typeof w === 'number') mhWallet.set(w);
        }
        mhHints.classList.toggle('idle', performance.now() - lastActivity > HINT_IDLE_S * 1000);
      }
    },

    prompt(p) {
      if (!p) {
        if (promptOn) { promptOn = false; promptEl.classList.remove('on'); }
        cross.classList.remove('target', 'blocked');
        promptSig = '';
        return;
      }
      const key = deps.keyLabel(p.action);
      const sig = `${key}|${p.label}|${p.sub ?? ''}|${p.disabled ? 1 : 0}`;
      if (sig !== promptSig) {
        promptSig = sig;
        pKey.textContent = key; pLabel.textContent = p.label;
        pSub.textContent = p.sub ?? ''; pSub.style.display = p.sub ? '' : 'none';
        promptEl.classList.toggle('dis', !!p.disabled);
        cross.classList.toggle('blocked', !!p.disabled);
      }
      if (!promptOn) {
        promptOn = true; promptEl.classList.add('on');
        pMain.animate([{ transform: `translateY(${3 * px}px)` }, { transform: 'translateY(0)' }], { duration: 130, easing: 'steps(3, end)' });   // pops up 3 px
      }
      if (!cross.classList.contains('target')) cross.classList.add('target');
    },

    toast(text, kind: ToastKind | ExtraToastKind = 'info', dur = 2.5, tag) {
      if (toastHold) {                                        // a modal is open: the news waits, in order, for holdToasts(false)
        toastHeld.push({ text, kind, dur, tag });
        if (toastHeld.length > TOAST_HELD_MAX) toastHeld.shift();
        return;
      }
      // One queue: the same or similar news within 3 s merges into the toast already showing (or waiting), and a
      // banner / feed line for it that came first is enough. At most TOAST_VISIBLE on screen; the rest wait.
      const words = announceWords(text);
      const hit = recentNews(words);
      if (hit) { if (hit.rec) mergeToast(hit.rec, dur); return; }
      const rec: ToastRec = { text, kind, dur, words, count: 1, timer: 0, shown: false, tag };
      announced.push({ words, at: performance.now(), rec });
      admit(rec);
    },

    dismissToasts(match = {}) {
      clearToasts(match);
    },

    holdToasts(on) {
      if (on) {
        if (toastHold) return;
        toastHold = true;
        // The news on screen (oldest first) and in line goes behind the modal with the new news: a toast still painted there
        // would cover the modal's title. Each one's record is forgotten, so its replay shows instead of merging into nothing.
        for (const rec of [...[...toastShown].reverse(), ...toastWaiting]) {
          for (let i = announced.length - 1; i >= 0; i--) if (announced[i].rec === rec) announced.splice(i, 1);
          if (rec.shown) hideToast(rec, true);
          else { const w = toastWaiting.indexOf(rec); if (w >= 0) toastWaiting.splice(w, 1); }
          toastHeld.push({ text: rec.text, kind: rec.kind, dur: rec.dur, tag: rec.tag });
        }
        while (toastHeld.length > TOAST_HELD_MAX) toastHeld.shift();
        return;
      }
      if (!toastHold) return;
      toastHold = false;
      for (const x of toastHeld.splice(0)) ui.toast(x.text, x.kind as ToastKind | ExtraToastKind, x.dur, x.tag);   // in order
    },

    bigWin(amount: number, tier: WinTier, title: string) {
      return enqueueBw(() => runBigWin(amount, tier, title));
    },
    banner(text, o = {}) {
      // Seated, a title card would sit over the machine's screen (and over its first-sit tip): the news is a toast instead, in the
      // upper-right column the seat keeps clear (ui.css `.px-root.seated .px-toasts`). Toasts keep their own repeat check.
      if (root.classList.contains('seated')) { ui.toast(text, bannerToastKind(o.color), Math.max(2.5, o.hold ?? 1.5)); return Promise.resolve(); }
      if (!claimAnnounce(text)) return Promise.resolve();     // same news just announced: drop the repeat
      return enqueueBw(() => runBanner(text, o));
    },

    machineHud(spec: MachineHudSpec | null) {
      if (!spec) {
        mhSpec = null; mhud.classList.remove('on'); root.classList.remove('mh-on'); mhBetShown = null; mhSig = { stats: '', hints: '' };
        return;
      }
      const first = !mhSpec;
      mhSpec = spec;
      root.classList.add('mh-on');
      lastActivity = performance.now(); mhHints.classList.remove('idle');
      let relayout = first;                                     // only measure when the strip's shape can have changed
      const title = spec.title ?? '';
      if (mhTitle.textContent !== title) { mhTitle.textContent = title; mhTitle.style.display = title ? '' : 'none'; relayout = true; }
      const betWas = mhBetShown !== null;
      renderBet(spec.bet ?? null);
      if (betWas !== (mhBetShown !== null)) relayout = true;
      mhWalletBox.style.display = spec.showWallet === false ? 'none' : '';
      if (spec.showWallet !== false) {
        const w = app?.run?.wallet?.();
        if (typeof w === 'number') mhWallet.set(w, { instant: first });
      }
      const statSig = (spec.stats ?? []).map((s) => `${s.label}=${s.value}`).join('|');
      if (statSig !== mhSig.stats) {
        mhSig.stats = statSig; relayout = true;
        mhStats.replaceChildren();
        for (const s of spec.stats ?? []) {
          const it = h('span', 'stat', mhStats);
          h('span', 'k', it, upper(s.label));
          h('span', 'v', it, s.value);
        }
        mhStats.style.display = spec.stats?.length ? '' : 'none';
      }
      const hintSig = spec.hints.map((x) => `${x.action}:${x.label}`).join('|');
      if (hintSig !== mhSig.hints) { mhSig.hints = hintSig; renderHints(spec); relayout = true; }
      if (first) {
        mhud.classList.add('on');
        mhHints.animate([{ opacity: 0 }, { opacity: 0.4 }, { opacity: 0.4 }, { opacity: 0.7 }, { opacity: 1 }], { duration: 200, easing: 'steps(1, end)' });
      }
      if (relayout) syncHudHeight();
    },

    subtitle(text, speaker, dur) {
      // Same signature for every caller: a dur is the total on-screen time, typing included.
      if (!text) { subtitles.clear(); return; }
      subtitles.say({ text, speaker: speaker || undefined, fit: dur && dur > 0 ? dur : undefined });
    },

    choice(title, options, o) {
      return new Promise<number>((resolve) => {
        choiceQueue.push({ title, options, timeout: o?.timeout, resolve });
        pumpChoice();
      });
    },

    modal(spec: ModalSpec) {
      return new Promise<{ id: string; value?: string } | null>((resolve) => {
        const wrap = h('div', 'px-modal', modalLayer);
        wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
        const danger = spec.buttons.some((b) => b.kind === 'danger');
        const fr = frame(wrap, { title: spec.title, variant: danger ? 'red' : 'brass', className: 'px-dialog' });
        if (spec.body) h('p', 'px-dialog-body', fr.body, spec.body);
        let tf: TextField | null = null;
        const btns: Button[] = [];
        let done = false;
        const finish = (r: { id: string; value?: string } | null): void => {
          if (done) return;
          done = true;
          const i = modals.indexOf(rec);
          if (i >= 0) modals.splice(i, 1);
          wrap.remove();
          syncBlocking();
          resolve(r);
        };
        if (spec.input) {
          tf = textField(fr.body, {
            placeholder: spec.input.placeholder, maxLength: spec.input.maxLength, password: spec.input.password,
            onSubmit: () => rec.primary(),
          });
        }
        const row = h('div', 'px-dialog-row', fr.body);
        const primaryDef = spec.buttons.find((b) => b.kind === 'primary') ?? spec.buttons[0];
        for (const b of spec.buttons) {
          btns.push(button(row, {
            label: b.label, kind: b.kind ?? 'normal', hold: b.kind === 'danger',
            onClick: () => finish({ id: b.id, value: tf?.value }),
          }));
        }
        row.addEventListener('keydown', (e) => {
          const d = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
          if (!d) return;
          const list = btns.map((b) => b.el), i = list.indexOf(document.activeElement as HTMLButtonElement);
          e.preventDefault(); list[(i + d + list.length) % list.length]?.focus();
        });
        const rec: ModalRec = {
          el: wrap,
          cancel: () => finish(null),
          primary: () => {
            if (!primaryDef) { finish(null); return; }
            const idx = spec.buttons.indexOf(primaryDef);
            if (spec.buttons[idx].kind === 'danger') btns[idx].el.focus();       // danger needs an explicit press
            else finish({ id: primaryDef.id, value: tf?.value });
          },
        };
        modals.push(rec);
        wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
        fr.el.animate([{ transform: `translateY(${6 * px}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
        uiSfx('popUp', 0.6);
        syncBlocking();
        (tf?.input ?? btns[spec.buttons.indexOf(primaryDef)]?.el ?? btns[0]?.el)?.focus({ preventScroll: true });
      });
    },

    panel(id, build): PanelHandle {
      ui.closePanel(id);
      const el = h('div', 'px-panel', panelLayer);
      el.dataset.panel = id;
      let cleanup: void | (() => void);
      try { cleanup = build(el); } catch (e) { log.error('ui', `panel(${id}) build failed`, e); }
      const rec: PanelRec = { el, cleanup: typeof cleanup === 'function' ? cleanup : undefined, backdrop: null };
      panels.set(id, rec);
      syncBlocking();
      return { el, close: () => { if (panels.get(id) === rec) ui.closePanel(id); } };
    },
    closePanel(id) {
      const p = panels.get(id);
      if (!p) return;
      panels.delete(id);
      try { p.cleanup?.(); } catch (e) { log.error('ui', `panel(${id}) cleanup failed`, e); }
      p.nav?.();
      p.el.remove(); p.backdrop?.remove();
      syncBlocking();
    },

    crosshair(style) { crossReq = style; syncCrosshair(); },

    fade(alpha, dur, color = '#000') {
      const from = parseFloat(getComputedStyle(fadeEl).opacity) || 0;   // read the in-flight value before cancelling
      fadeAnim?.cancel(); fadeDone?.();
      fadeEl.style.opacity = String(from);
      fadeEl.style.background = color;
      if (dur <= 0 || from === alpha) { fadeEl.style.opacity = String(alpha); fadeAnim = null; return Promise.resolve(); }
      return new Promise<void>((resolve) => {
        const a = fadeEl.animate([{ opacity: from }, { opacity: alpha }], { duration: dur * 1000, easing: 'linear', fill: 'forwards' });
        fadeAnim = a;
        const end = (): void => {
          if (fadeDone !== end) return;
          fadeDone = null;
          if (fadeAnim === a) { fadeEl.style.opacity = String(alpha); a.cancel(); fadeAnim = null; }
          resolve();
        };
        fadeDone = end;
        a.onfinish = end;
        setTimeout(end, dur * 1000 + 150);
      });
    },

    flash(color, dur) {
      const rf = !!settingsNow()?.reduceFlashing;
      const now = performance.now();
      if (rf && now - lastFlash < 333) return;                 // Reduce Flashing: ≤ 3 per second, ×0.35
      lastFlash = now;
      flashEl.style.background = color;
      flashAnim?.cancel();
      flashAnim = flashEl.animate([{ opacity: rf ? 0.21 : 0.6 }, { opacity: 0 }], { duration: Math.max(40, dur * 1000), easing: 'ease-out' });
    },

    setHudVisible(on) { root.classList.toggle('hud-off', !on); },

    setAnchor(id, el) { if (el) anchors.set(id, el); else anchors.delete(id); },
    anchor(id) {
      const el = anchors.get(id);
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },

    fly(o: FlyOpts) {
      const dur = o.dur ?? 0.8;
      const to = ui.anchor(o.to);
      const from = resolveFrom(o.from);
      let arrived = false;
      const arrive = (): void => {
        if (arrived) return;
        arrived = true;
        if (to) { ui.bump(o.to, 1); spark(to, o.color ?? COLORS.shine); }
        o.onArrive?.();
      };
      if (!to || flyActive >= MAX_FLY || root.classList.contains('hud-off')) {
        // no HUD target (or too many in flight): still deliver the callback on time
        if (!to && flyActive < MAX_FLY) {
          const f = h('div', 'px-fly', flyLayer, o.text);
          f.style.color = o.color ?? COLORS.shine; f.style.left = `${from.x}px`; f.style.top = `${from.y}px`;
          flyActive++;
          const a = f.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${-14 * px}px)`, opacity: 0 }], { duration: dur * 1000, easing: 'ease-out' });
          a.onfinish = () => { f.remove(); flyActive--; };
          setTimeout(() => { if (f.isConnected) { f.remove(); flyActive--; } }, dur * 1000 + 200);
        }
        setTimeout(arrive, dur * 1000);
        return;
      }
      const f = h('div', 'px-fly', flyLayer, o.text);
      f.style.color = o.color ?? COLORS.shine;
      flyActive++;
      const snap = (v: number): number => Math.round(v / px) * px;
      const n = Math.max(6, Math.round(dur * 30));            // 30 fps stepped, pixel-snapped path (PSX feel)
      const cx = from.x + (to.x - from.x) * 0.25, cy = Math.min(from.y, to.y) - 40 * px;
      const frames: Keyframe[] = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n, e = k * k * (3 - 2 * k) * 0.35 + k * k * 0.65;              // slow start, fast finish
        const x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
        const y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
        const s = k < 0.12 ? 0.4 + (k / 0.12) * 0.9 : 1.3 - 0.5 * ((k - 0.12) / 0.88);
        frames.push({
          transform: `translate(${snap(x)}px, ${snap(y)}px) scale(${s.toFixed(2)})`, opacity: k > 0.9 ? 0.6 : 1,
          offset: k, easing: 'steps(1, end)',
        });
      }
      const a = f.animate(frames, { duration: dur * 1000, fill: 'forwards' });
      const finish = (): void => { if (f.isConnected) { f.remove(); flyActive--; } arrive(); };
      a.onfinish = finish;
      setTimeout(finish, dur * 1000 + 250);
    },

    bump(id, strength = 1) {
      const el = anchors.get(id);
      if (!el) return;
      bumps.get(el)?.cancel();
      bumps.set(el, el.animate([{ scale: '1' }, { scale: String(1 + 0.25 * strength) }, { scale: '1' }],
        { duration: 200, easing: 'cubic-bezier(.3,1.6,.5,1)' }));
    },

    letterbox(amount, dur = 0.5) {
      root.style.setProperty('--lb-dur', `${Math.max(0, dur)}s`);
      root.style.setProperty('--lb', String(clamp(amount, 0, 1)));
      return dur > 0 ? wait(dur * 1000) : Promise.resolve();
    },

    skipHint(progress, label) {
      if (progress === null) { skipEl.classList.remove('on'); return; }
      if (!skipEl.classList.contains('on')) { skipEl.classList.add('on'); skipKey.textContent = deps.keyLabel('skip'); }
      skipRing.style.setProperty('--p', clamp(progress, 0, 1).toFixed(3));
      const txt = label ?? t('ui.skip.hold', { key: deps.keyLabel('skip') });
      if (skipLbl.textContent !== txt) skipLbl.textContent = txt;
    },

    dispose() {
      for (const d of disposers.splice(0)) d();
      root.replaceChildren();
      root.classList.remove('px-root');
    },
  };

  // ── global listeners ────────────────────────────────────────────────────────────────────────────
  const relock = (): void => { void app?.input?.requestLock(); };
  veilEl.addEventListener('click', relock);
  listen('keydown', (e) => {
    lastActivity = performance.now(); mhHints.classList.remove('idle');
    if (keyCaptureActive()) return;                              // rebinding owns the keyboard (Esc cancels the capture)
    const code = e.code;
    if (!root.classList.contains('kb') && /^(Tab|Arrow|Enter|Space|Key[WASD])/.test(code)) root.classList.add('kb');   // show focus rings
    const enter = code === 'Enter' || code === 'NumpadEnter';
    if (veilOn && (enter || code === 'Space')) { eat(e); relock(); return; }
    if (bwActive && performance.now() >= bwActive.skippableAt && (enter || code === 'Space')) { eat(e); bwActive.skip(); return; }
    const text = isTextTarget(e.target);
    // seated (input mode 'machine'): Digit1-9 belong to the machine's buttons, so a choice never steals them; it stays
    // on screen and is answered with the mouse (or by number keys once the player is on their feet again)
    if (choiceActive && !text && !e.ctrlKey && !e.altKey && !e.metaKey && app?.input?.mode !== 'machine') {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m && Number(m[1]) <= choiceActive.options.length) { eat(e); choiceActive.pick(Number(m[1]) - 1); return; }
    }
    const top = modals[modals.length - 1];
    if (top) {
      if (code === 'Escape') { eat(e); top.cancel(); return; }
      if (code === 'Tab') {
        const items = navItems(top.el);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { eat(e); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { eat(e); items[0].focus(); }
        return;
      }
      if (enter && !(e.target instanceof HTMLButtonElement) && !text) { eat(e); top.primary(); }
      return;
    }
    if (code === 'Escape') {
      let target: string | null = null;
      for (const [id, p] of panels) if (p.el.dataset.modal === '1' && p.el.dataset.esc !== '0') target = id;
      if (target) { eat(e); ui.closePanel(target); }
    }
  }, true);
  listen('mousedown', (e) => {
    lastActivity = performance.now(); mhHints.classList.remove('idle');
    if (bwActive && performance.now() >= bwActive.skippableAt) { bwActive.skip(); e.stopImmediatePropagation(); }
  }, true);
  listen('mousemove', (e) => {                                  // pointer in use again: hide the keyboard focus rings
    if ((e.movementX || e.movementY) && root.classList.contains('kb')) root.classList.remove('kb');
  }, true);
  listen('resize', applyScale);
  disposers.push(bus.on('settings:changed', () => applyFlags()));
  disposers.push(bus.on('lang:changed', () => {
    veilEl.firstElementChild!.textContent = t('ui.veil.click');
    promptSig = '';
    if (mhSpec) { mhSig.hints = ''; renderHints(mhSpec); renderBet(mhSpec.bet ?? null); syncHudHeight(); }
  }));
  disposers.push(bus.on('input:rebind', refreshKeyLabels));
  disposers.push(bus.on('input:veil', ({ show }) => {
    veilOn = show;
    veilEl.classList.toggle('on', show);
  }));
  disposers.push(bus.on('input:lock', ({ locked }) => { if (locked) { veilOn = false; veilEl.classList.remove('on'); } }));

  applyFlags();
  return ui;
}

/** Type re-exports so menu code can `import type { Button } from '@/core/ui/ui'` without knowing the file split. */
export type { Button, Counter, TextField };
