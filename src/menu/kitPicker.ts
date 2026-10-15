/**
 * Starting-kit picker (WAVE8 item 6), with stakes (game/stakes.ts) and the daily run (game/daily.ts). Shown once a normal
 * Debt run is about to start (menuState, after the burst; a resumed run and the other modes skip it). It lists the kits
 * from `src/game/data/kits.ts`. A kit the player has not unlocked is greyed out with its Obol cost. The chosen kit goes to
 * `onPick` with a `KitPick` (stake and daily flag); the run carries them as `RunConfig.kit`, `RunConfig.stake`, `RunConfig.daily`.
 *
 * Stakes: a row of chips 0-7 under the cards. A chip is open once the selected kit has cleared the stake below it
 * (`meta.stakeCleared`, per kit). Each kit card shows a sticker with its best cleared stake.
 * Daily run: the toggle in the foot. The kit is today's kit, the stake is DAILY_STAKE and the seed is the day's; the
 * kit cards and stake chips wait, and START plays the day's run. Its best result is shown here.
 *
 * Keys: arrows or WASD move, '[' and ']' change the stake, Enter or Space starts. Mouse: click selects, a second click
 * or START starts. FOUNDATIONS (the button in the foot) opens the meta tree over the picker; the picker's keys wait until it closes.
 * Unlock state: a kit with `obols` > 0 is open when `meta.unlocked` holds `kit:<id>` (see `kitUnlockKey`).
 */
import { app } from '@/core/app';
import { has, t } from '@/core/i18n';
import './kitPicker.css';
import { openFoundations } from './foundations';
import { createMetaPrestige } from './foundations.logic';
import { DAILY_STAKE, dailyKit, dayKey } from '@/game/daily';
import { STAKE_MAX, bestStakeCleared, clampStake, stakeUnlocked } from '@/game/stakes';

export interface KitRow { id: string; obols: number }
/** What the run starts with besides the kit: the stake (0-7) and whether it is the day's daily run. */
export interface KitPick { stake: number; daily: boolean }
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

/** The stake's text: every effect from stake 1 up to it, then the Obols bonus. */
function stakeText(stake: number): string {
  if (stake <= 0) return t('stakes.none');
  const lines: string[] = [];
  for (let k = 1; k <= stake; k++) lines.push(t(`stakes.lvl.${k}`));
  lines.push(t('stakes.obols', { p: Math.round(15 * stake) }));
  return lines.join(' · ');
}

/** Opens the picker over the die menu. `onPick` runs once, with the chosen kit id and its `KitPick`, and the picker closes. */
export function openKitPicker(onPick: (kit: string, pick: KitPick) => void): void {
  const rows = kitRows();
  const today = dayKey();
  const todayKit = dailyKit(today);
  let sel = Math.max(0, rows.findIndex((r) => r.id === DEFAULT_KIT));
  let stake = 0;
  let daily = false;
  let closed = false;
  /** The Foundations tree is open above the picker: its keys belong to it. */
  let sub = false;
  const cards: HTMLButtonElement[] = [];
  const statuses: HTMLElement[] = [];
  const stickers: HTMLElement[] = [];
  const chips: HTMLButtonElement[] = [];
  let startBtn: HTMLButtonElement | null = null;
  let dailyBtn: HTMLButtonElement | null = null;
  let dailyInfo: HTMLElement | null = null;
  let stakeInfo: HTMLElement | null = null;
  let balanceEl: HTMLElement | null = null;

  const clears = (): Record<string, number> => app.save.data.stakeCleared ?? {};
  /** The kit the next run uses: today's while the daily run is on, else the selected card. */
  const kitId = (): string => (daily ? todayKit : rows[sel]?.id ?? DEFAULT_KIT);

  const close = (): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    app.ui.closePanel(PANEL);
  };
  const commit = (i: number): void => {
    if (closed) return;
    if (daily) {
      // The daily run has its own kit and stake, and needs no unlock.
      close();
      onPick(todayKit, { stake: DAILY_STAKE, daily: true });
      return;
    }
    const row = rows[i];
    if (!row) return;
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
    onPick(row.id, { stake, daily: false });
  };
  const select = (i: number): void => {
    if (daily) return;   // the daily run fixes the kit
    sel = (i + rows.length) % rows.length;
    // a stake the new kit has not cleared yet falls back to the plain run
    if (!stakeUnlocked(clears(), kitId(), stake)) stake = 0;
    render();
  };
  const setStake = (n: number): void => {
    if (closed || sub || daily) return;   // the daily run fixes the stake
    const s = clampStake(n);
    if (!stakeUnlocked(clears(), kitId(), s)) return;
    stake = s;
    render();
  };
  const toggleDaily = (): void => {
    if (closed || sub) return;
    daily = !daily;
    if (daily) sel = Math.max(0, rows.findIndex((r) => r.id === todayKit));
    render();
  };

  const render = (): void => {
    if (balanceEl) balanceEl.textContent = t('kitpick.obols', { n: app.save.data.meta.obols });
    const c = clears();
    rows.forEach((row, i) => {
      const open = kitUnlocked(row);
      const card = cards[i];
      if (!card) return;
      const locked = !open && !daily;
      card.classList.toggle('sel', i === sel);
      card.classList.toggle('locked', locked);
      card.classList.toggle('dim', daily && row.id !== todayKit);
      card.setAttribute('aria-checked', String(i === sel));
      card.setAttribute('aria-disabled', String(locked));
      card.title = locked ? t('kitpick.lockedNote') : '';
      const status = statuses[i];
      if (status) {
        status.textContent = !open
          ? t('kitpick.locked', { n: row.obols })
          : row.obols <= 0 ? t('kitpick.free') : t('kitpick.owned');
      }
      const best = bestStakeCleared(c, row.id);
      const sticker = stickers[i];
      if (sticker) {
        sticker.hidden = best < 0;
        sticker.textContent = best < 0 ? '' : t('stakes.sticker', { n: best });
      }
    });
    const shown = daily ? DAILY_STAKE : stake;
    chips.forEach((chip, n) => {
      const ok = stakeUnlocked(c, kitId(), n);
      chip.classList.toggle('sel', n === shown);
      chip.classList.toggle('locked', !ok && !daily);
      chip.classList.toggle('fixed', daily);
      chip.disabled = daily || !ok;
      chip.setAttribute('aria-checked', String(n === shown));
      chip.title = ok ? t('stakes.title', { n }) : t('stakes.locked', { n: n - 1 });
    });
    if (stakeInfo) stakeInfo.textContent = stakeText(shown);
    if (dailyBtn) {
      dailyBtn.textContent = t(daily ? 'daily.toggle.on' : 'daily.toggle.off');
      dailyBtn.setAttribute('aria-pressed', String(daily));
    }
    if (dailyInfo) {
      const best = app.save.data.dailyBest?.[today];
      const bestText = best ? t('daily.best', { n: best.night, o: best.obols }) : t('daily.none');
      dailyInfo.textContent = daily ? `${t('daily.hint', { n: DAILY_STAKE })}  ${bestText}` : bestText;
    }
    const row = rows[sel];
    if (startBtn && row) startBtn.disabled = !daily && !kitUnlocked(row);
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
    else if (k === '[') setStake(stake - 1);
    else if (k === ']') setStake(Math.min(STAKE_MAX, stake + 1));
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
      stickers[i] = el('span', 'kp-sticker', '', card);
      card.addEventListener('click', () => { if (daily) return; if (sel === i) commit(i); else select(i); });
      cards.push(card);
    });
    const stakeRow = el('div', 'kp-stakes', undefined, box);
    el('span', 'kp-stakes-label', t('stakes.chooser'), stakeRow);
    for (let n = 0; n <= STAKE_MAX; n++) {
      const chip = el('button', 'kp-stake', String(n), stakeRow);
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.addEventListener('click', () => setStake(n));
      chips.push(chip);
    }
    stakeInfo = el('p', 'kp-stake-info', '', box);
    dailyInfo = el('p', 'kp-daily-info', '', box);
    const foot = el('div', 'kp-foot', undefined, box);
    balanceEl = el('span', 'kp-balance', t('kitpick.obols', { n: app.save.data.meta.obols }), foot);
    dailyBtn = el('button', 'kp-daily-btn', '', foot);
    dailyBtn.type = 'button';
    dailyBtn.addEventListener('click', () => toggleDaily());
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
