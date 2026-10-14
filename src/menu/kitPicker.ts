/**
 * Starting-kit picker (WAVE8 item 6). Shown once a normal Debt run is about to start (menuState, after the burst; a
 * resumed run and the other modes skip it). It lists the kits from `src/game/data/kits.ts`. A kit the player has not
 * unlocked is greyed out with its Obol cost. The chosen id goes to `onPick`, and the run carries it as `RunConfig.kit`.
 *
 * Keys: arrows or WASD move, Enter or Space starts. Mouse: click selects, a second click or START starts.
 * FOUNDATIONS (the button in the foot) opens the meta tree over the picker; the picker's keys wait until it closes.
 * Unlock state: a kit with `obols` > 0 is open when `meta.unlocked` holds `kit:<id>` (see `kitUnlockKey`).
 */
import { app } from '@/core/app';
import { has, t } from '@/core/i18n';
import './kitPicker.css';
import { openFoundations } from './foundations';
import { createMetaPrestige } from './foundations.logic';

export interface KitRow { id: string; obols: number }
interface KitsModule { KITS?: ReadonlyArray<{ id: string; obols?: number; cost?: number; unlockCost?: number }> }
/** `kits.ts` may land after this file: read it through the glob seam, as WORLD-SYS does for `layout.ts`. */
const kitMods = import.meta.glob<KitsModule>('../game/data/kits.ts', { eager: true });

const PANEL = 'kit-picker';
const DEFAULT_KIT = 'pauper';

/** The `meta.unlocked` key that opens a kit. */
export const kitUnlockKey = (id: string): string => `kit:${id}`;

/** Kits to show, in data order. While `kits.ts` is absent the picker offers Pauper alone (free). */
export function kitRows(): KitRow[] {
  const list = Object.values(kitMods)[0]?.KITS ?? [];
  const rows = list.map((k) => ({ id: k.id, obols: Math.max(0, k.obols ?? k.unlockCost ?? k.cost ?? 0) }));
  return rows.length > 0 ? rows : [{ id: DEFAULT_KIT, obols: 0 }];
}

/** Free kits are always open; paid ones open once their unlock key is saved. */
export function kitUnlocked(row: KitRow): boolean {
  if (row.obols <= 0) return true;
  return app.save.data.meta.unlocked.includes(kitUnlockKey(row.id));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, parent?: Node): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** Opens the picker over the die menu. `onPick` runs once, with the chosen kit id, and the picker closes. */
export function openKitPicker(onPick: (kit: string) => void): void {
  const rows = kitRows();
  let sel = Math.max(0, rows.findIndex((r) => r.id === DEFAULT_KIT));
  let closed = false;
  /** The Foundations tree is open above the picker: its keys belong to it. */
  let sub = false;
  const cards: HTMLButtonElement[] = [];
  const statuses: HTMLElement[] = [];
  let startBtn: HTMLButtonElement | null = null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    app.ui.closePanel(PANEL);
  };
  const commit = (i: number): void => {
    const row = rows[i];
    if (closed || !row) return;
    if (!kitUnlocked(row)) {
      // buy the unlock with banked Obols (meta.obols), then stay on the picker
      const cost = row.obols;
      if (app.save.data.meta.obols < cost) return;
      app.save.update((d) => { d.meta.obols -= cost; d.meta.spent += cost; d.meta.unlocked.push(kitUnlockKey(row.id)); });
      app.save.flush();
      render();
      return;
    }
    close();
    onPick(row.id);
  };
  const select = (i: number): void => {
    sel = (i + rows.length) % rows.length;
    render();
  };
  let balanceEl: HTMLElement | null = null;
  const render = (): void => {
    if (balanceEl) balanceEl.textContent = t('kitpick.obols', { n: app.save.data.meta.obols });
    rows.forEach((row, i) => {
      const open = kitUnlocked(row);
      const card = cards[i];
      if (!card) return;
      card.classList.toggle('sel', i === sel);
      card.classList.toggle('locked', !open);
      card.setAttribute('aria-checked', String(i === sel));
      card.setAttribute('aria-disabled', String(!open));
      card.title = open ? '' : t('kitpick.lockedNote');
      const status = statuses[i];
      if (status) {
        status.textContent = !open
          ? t('kitpick.locked', { n: row.obols })
          : row.obols <= 0 ? t('kitpick.free') : t('kitpick.owned');
      }
    });
    const row = rows[sel];
    if (startBtn && row) {
      const open = kitUnlocked(row);
      startBtn.disabled = !open;
    }
  };

  const openMeta = (): void => {
    if (closed || sub) return;
    sub = true;
    openFoundations({
      prestige: createMetaPrestige(app.save),
      onClose: () => { sub = false; if (!closed) render(); },
    });
  };

  // Capture phase, so the die menu's own key handler never sees these keys while the picker is up.
  const onKey = (e: KeyboardEvent): void => {
    if (closed || sub) return;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'a' || k === 'A' || k === 'w' || k === 'W') select(sel - 1);
    else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'd' || k === 'D' || k === 's' || k === 'S') select(sel + 1);
    else if (k === 'Enter' || k === ' ') commit(sel);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  };

  window.addEventListener('keydown', onKey, true);
  app.ui.panel(PANEL, (host) => {
    const root = el('div', 'kp-root', undefined, host);
    const box = el('div', 'kp-box', undefined, root);
    el('h2', 'kp-title', t('kitpick.title'), box);
    el('p', 'kp-hint', t('kitpick.hint'), box);
    const grid = el('div', 'kp-grid', undefined, box);
    grid.setAttribute('role', 'radiogroup');
    rows.forEach((row, i) => {
      const card = el('button', 'kp-kit', undefined, grid);
      card.type = 'button';
      card.setAttribute('role', 'radio');
      const name = `kitpick.kit.${row.id}`;
      el('span', 'kp-name', has(name) ? t(name) : row.id, card);
      const start = `${name}.start`;
      if (has(start)) el('span', 'kp-start', t(start, { c: t('common.coinSuffix') }), card);
      statuses[i] = el('span', 'kp-status', '', card);
      card.addEventListener('click', () => { if (sel === i) commit(i); else select(i); });
      cards.push(card);
    });
    const foot = el('div', 'kp-foot', undefined, box);
    balanceEl = el('span', 'kp-balance', t('kitpick.obols', { n: app.save.data.meta.obols }), foot);
    startBtn = el('button', 'kp-start-btn', t('kitpick.start'), foot);
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => commit(sel));
    const metaBtn = el('button', 'fd-btn alt', t('found.title'), foot);
    metaBtn.type = 'button';
    metaBtn.addEventListener('click', () => openMeta());
    render();
    cards[sel]?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey, true); };
  });
}
