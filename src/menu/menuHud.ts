/**
 * Main-menu overlay (menu revamp): the neon JACKID logo, a readable entry list that mirrors the die faces (click a
 * name and the die rolls to it), a gold CONTINUE RUN card when a run is saved, and a footer with the version, the key
 * hints and the credits link. A DOM panel above the canvas; the state owns the logic and calls `setActive` as the die
 * settles. Nothing here steals keyboard focus: the die menu's own key handler stays in charge.
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import './menuHud.css';

export interface HudItem { id: string; label: string; desc: string }
export interface HudOpts {
  /** Entries in list order (called again on a language change). */
  items(): HudItem[];
  /** Saved-run facts for the Continue card, or null when there is no run to continue. */
  resume(): { floor: number; shift: number } | null;
  onPick(id: string): void;
  onContinue(): void;
  onCredits(): void;
}
export interface MenuHud {
  setActive(id: string | null): void;
  setVisible(on: boolean): void;
  /** Rebuild every label (language change, or the save changed). */
  refresh(): void;
  /** Called every frame with the menu clock: schedules the logo's occasional zap. */
  tick(time: number): void;
  /** A centred card (credits / quit) over the menu; `onClose` runs when it is clicked. */
  showInfo(o: { title: string; lines: string[]; hint: string }, onClose: () => void): void;
  hideInfo(): void;
  dispose(): void;
}

const PANEL = 'menuhud';
const ZAP_EVERY = [6.5, 9.1, 7.7];

/** Builds an element; `a` and `b` are the text and the parent in either order. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, a?: string | Node, b?: string | Node): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const x of [a, b]) {
    if (typeof x === 'string') n.textContent = x;
  }
  for (const x of [a, b]) {
    if (x && typeof x !== 'string') x.appendChild(n);
  }
  return n;
}

export function openMenuHud(o: HudOpts): MenuHud {
  let active: string | null = null;
  let root: HTMLElement | null = null;
  let side: HTMLElement | null = null;
  let logo: HTMLElement | null = null;
  let info: HTMLElement | null = null;
  let nextZap = 4.5;
  let zaps = 0;
  let zapOff = 0;
  const buttons = new Map<string, HTMLElement>();
  const hover = (): void => { app.audio.play('hover', { bus: 'ui', vol: 0.45 }); };

  const build = (): void => {
    if (!side) return;
    side.textContent = '';
    buttons.clear();
    const keyOf = (k: string): string => t(`menu.key.${k}`);
    const run = o.resume();
    if (run) {
      const b = el('button', 'mh-cont', side);
      b.type = 'button';
      b.tabIndex = -1;
      const top = el('span', 'mh-row', b);
      el('span', 'mh-lbl', t('menu.face.continue'), top);
      el('span', 'mh-key', keyOf('continue'), top);
      el('span', 'mh-sub2', t('menu.cont.sub', { floor: run.floor, shift: run.shift }), b);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('mouseenter', hover);
      b.addEventListener('click', () => o.onContinue());
    }
    o.items().forEach((it, i) => {
      const b = el('button', 'mh-item' + (it.id === active ? ' on' : ''), side);
      b.type = 'button';
      b.tabIndex = -1;
      const row = el('span', 'mh-row', b);
      el('span', 'mh-lbl', it.label, row);
      el('span', 'mh-key', String(i + 1), row);
      el('span', 'mh-desc', it.desc, b);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('mouseenter', hover);
      b.addEventListener('click', () => o.onPick(it.id));
      buttons.set(it.id, b);
    });
  };

  const handle = app.ui.panel(PANEL, (host) => {
    root = el('div', 'mh-root', host);
    logo = el('div', 'mh-logo', root);
    const title = el('h1', 'mh-title', logo);
    el('span', 'mh-jack', 'JACK', title);   // i18n-ok: the game's name
    el('span', 'mh-id', 'ID', title);       // i18n-ok: the game's name
    el('div', 'mh-sub', t('menu.logo.sub'), logo);
    side = el('nav', 'mh-side', root);
    side.setAttribute('aria-label', t('menu.list.aria'));
    build();
    const foot = el('div', 'mh-foot', root);
    el('span', 'mh-ver', t('menu.foot.ver', { v: app.version }), foot);
    el('span', 'mh-keys', t('menu.foot.keys'), foot);
    const cr = el('button', 'mh-credits', undefined, foot);
    cr.type = 'button';
    cr.tabIndex = -1;
    el('b', '', t('menu.key.credits'), cr);
    cr.append(t('menu.foot.credits'));
    cr.addEventListener('mousedown', (e) => e.preventDefault());
    cr.addEventListener('click', () => o.onCredits());
  });

  return {
    setActive(id: string | null): void {
      if (id === active) return;
      active = id;
      buttons.forEach((b, k) => b.classList.toggle('on', k === id));
    },
    setVisible(on: boolean): void { root?.classList.toggle('hide', !on); },
    refresh(): void {
      if (!root) return;
      const sub = root.querySelector('.mh-sub');
      if (sub) sub.textContent = t('menu.logo.sub');
      const ver = root.querySelector('.mh-ver');
      if (ver) ver.textContent = t('menu.foot.ver', { v: app.version });
      const keys = root.querySelector('.mh-keys');
      if (keys) keys.textContent = t('menu.foot.keys');
      const cr = root.querySelector('.mh-credits');
      if (cr) { cr.textContent = ''; el('b', '', t('menu.key.credits'), cr); cr.append(t('menu.foot.credits')); }
      build();
    },
    tick(time: number): void {
      if (zapOff && time >= zapOff) { logo?.classList.remove('zap'); zapOff = 0; }
      if (time >= nextZap) {
        logo?.classList.add('zap');
        zapOff = time + 0.75;
        app.audio.play('lightFlicker', { bus: 'ui', vol: 0.22 });
        nextZap = time + ZAP_EVERY[zaps++ % ZAP_EVERY.length];
      }
    },
    showInfo(i, onClose): void {
      if (!root) return;
      info?.remove();
      const box = el('div', 'mh-info', root);
      el('div', 'mh-info-title', i.title, box);
      for (const l of i.lines) el('p', 'mh-info-line', l, box);
      el('div', 'mh-info-hint', i.hint, box);
      box.addEventListener('click', onClose);
      info = box;
    },
    hideInfo(): void { info?.remove(); info = null; },
    dispose(): void { handle.close(); root = null; side = null; logo = null; buttons.clear(); },
  };
}
