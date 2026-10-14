/**
 * Foundations: the meta tree screen (GDD §11.3, WAVE 7). A DOM screen in the kit picker's style: one row per branch
 * (V Vault, F Floor, H Hand, L Lamp, T Lift, R Root), each node placed by its `pos[0]` column, with its level, next
 * price, the effect text and whatever requirement still holds it back. Buying calls `PrestigeApi.buyNode`, so it is the
 * same screen from the die menu (a standalone prestige on the save, see foundations.logic.ts) and from the results
 * receipt. Obols are only ever taken by the prestige, never below zero.
 *
 * Keys: arrows (or WASD) move, Enter or Space buys the selected node, Esc closes. Mouse: click selects, a second click
 * (or BUY) buys. The keys are captured on the window, so the screen under it (kit picker, results) never sees them.
 *
 * `mount`: the results overlay sits above the UI panel layer, so the results screen passes its own element to draw in.
 */
import { app } from '@/core/app';
import { fmtNum, has, t } from '@/core/i18n';
import { uiSfx } from '@/core/ui/widgets';
import type { MetaNode, MetaState, PrestigeApi } from '@/game/tycoon.types';
import { metaBuyBlock, metaCost, metaLevel, metaReqMissing } from '@/game/data/upgrades';
import './foundations.css';

export interface FoundationsOpts {
  prestige: PrestigeApi;
  /** Draw inside this element instead of the UI panel layer (the results overlay covers that layer). */
  mount?: HTMLElement;
  /** Runs once when the screen closes, however it closes. */
  onClose?(): void;
}
export interface FoundationsHandle {
  close(): void;
}

const PANEL = 'foundations';
/** Branch rows in screen order. A node belongs to the branch its id starts with (V1 is the Vault). */
const BRANCHES = ['V', 'F', 'H', 'L', 'T', 'R'];

interface Row { key: string; items: MetaNode[] }

/** Branch rows, columns in `pos[0]` order. Unknown id letters still get a row, after the known ones. */
function rowsOf(nodes: readonly MetaNode[]): Row[] {
  const seen = [...new Set(nodes.map((n) => n.id.charAt(0)))];
  const keys = [...BRANCHES.filter((k) => seen.includes(k)), ...seen.filter((k) => !BRANCHES.includes(k))];
  return keys.map((key) => ({
    key,
    items: nodes.filter((n) => n.id.charAt(0) === key).sort((a, b) => (a.pos?.[0] ?? 0) - (b.pos?.[0] ?? 0)),
  }));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Node, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** Opens the Foundations screen. Idempotent close; `onClose` runs once. */
export function openFoundations(o: FoundationsOpts): FoundationsHandle {
  const p = o.prestige;
  const rows = rowsOf(p.nodes());
  const flat = rows.flatMap((r) => r.items);
  const cards: HTMLElement[] = [];
  let sel = 0;
  let gone = false;
  let root: HTMLElement | null = null;
  let balance: HTMLElement | null = null;
  let dName: HTMLElement | null = null;
  let dDesc: HTMLElement | null = null;
  let dStat: HTMLElement | null = null;
  let buyBtn: HTMLButtonElement | null = null;

  const nameOf = (id: string): string => {
    const n = p.nodes().find((x) => x.id === id);
    return n ? t(n.strings.en.name) : id;
  };
  /** A requirement token as player text (see `metaReqMissing` for the tokens). */
  const reqText = (tok: string): string => {
    if (tok.startsWith('bestShift:')) return t('found.req.night', { n: Number(tok.slice(10)) + 1 });
    if (tok.startsWith('won:')) return t('found.req.win', { n: tok.slice(4) });
    if (tok.startsWith('descend:')) return t('found.req.descend', { n: tok.slice(8) });
    return t('found.req.node', { name: nameOf(tok) });
  };

  /** Level, the block that refuses a buy (or null), and the line that says why. */
  function statusOf(n: MetaNode, meta: Readonly<MetaState>): { lv: number; block: string | null; text: string } {
    const lv = metaLevel(meta, n.id);
    const block = metaBuyBlock(meta, n);
    const price = fmtNum(metaCost(n, lv));
    if (block === 'maxed') return { lv, block, text: t('found.status.maxed') };
    if (block === 'requires') {
      const miss = metaReqMissing(meta, n);
      return { lv, block, text: t('found.status.locked', { req: miss ? reqText(miss) : '' }) };
    }
    if (block === 'funds') return { lv, block, text: t('found.status.funds', { n: price, s: fmtNum(metaCost(n, lv) - meta.obols) }) };
    return { lv, block: null, text: t('found.status.buy', { n: price }) };
  }

  function render(): void {
    if (!root) return;
    const meta = p.state();
    if (balance) balance.textContent = t('found.obols', { n: fmtNum(meta.obols) });
    flat.forEach((n, i) => {
      const card = cards[i];
      if (!card) return;
      const s = statusOf(n, meta);
      card.classList.toggle('sel', i === sel);
      card.classList.toggle('maxed', s.block === 'maxed');
      card.classList.toggle('locked', s.block === 'requires');
      card.classList.toggle('short', s.block === 'funds');
      card.setAttribute('aria-selected', String(i === sel));
      const lvEl = card.querySelector<HTMLElement>('.fd-clv');
      const stEl = card.querySelector<HTMLElement>('.fd-cst');
      if (lvEl) lvEl.textContent = t('found.lv', { lv: s.lv, max: n.maxLevel });
      if (stEl) {
        stEl.textContent = s.block === 'maxed' ? t('found.card.maxed')
          : s.block === 'requires' ? t('found.card.locked')
            : t('found.card.cost', { n: fmtNum(metaCost(n, s.lv)) });
      }
    });
    const cur = flat[sel];
    if (cur) {
      const s = statusOf(cur, meta);
      if (dName) dName.textContent = t(cur.strings.en.name);
      if (dDesc) dDesc.textContent = t(cur.strings.en.desc);
      if (dStat) dStat.textContent = `${t('found.lv', { lv: s.lv, max: cur.maxLevel })} · ${s.text}`;
      if (buyBtn) buyBtn.disabled = s.block !== null;
    }
  }

  const select = (i: number): void => {
    if (!flat.length) return;
    sel = Math.max(0, Math.min(flat.length - 1, i));
    render();
  };
  const buy = (i: number): void => {
    const n = flat[i];
    if (!n) return;
    if (p.buyNode(n.id)) uiSfx('click', 0.6);
    render();
  };
  /** Left and right walk one branch; up and down go to the nearest column of the next branch that has nodes. */
  const move = (dx: number, dy: number): void => {
    if (!flat.length) return;
    const cur = flat[sel];
    const ri = rows.findIndex((r) => r.items.includes(cur));
    if (dx !== 0) {
      const items = rows[ri].items;
      const k = items.indexOf(cur) + dx;
      if (k >= 0 && k < items.length) select(flat.indexOf(items[k]));
      return;
    }
    const cx = cur.pos?.[0] ?? 0;
    for (let r = ri + dy; r >= 0 && r < rows.length; r += dy) {
      const items = rows[r].items;
      if (!items.length) continue;
      let best = items[0];
      for (const n of items) if (Math.abs((n.pos?.[0] ?? 0) - cx) < Math.abs((best.pos?.[0] ?? 0) - cx)) best = n;
      select(flat.indexOf(best));
      return;
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (gone) return;
    const k = e.key;
    let handled = true;
    if (k === 'Escape') close();
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') move(-1, 0);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') move(1, 0);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') move(0, -1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') move(0, 1);
    else if (k === 'Enter' || k === ' ') buy(sel);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  };

  /** Idempotent: removes the keys, the DOM (mount case) and calls `onClose` once. */
  const teardown = (): void => {
    if (gone) return;
    gone = true;
    window.removeEventListener('keydown', onKey, true);
    root?.remove();
    o.onClose?.();
  };
  function close(): void {
    if (gone) return;
    if (o.mount) teardown();
    else app.ui.closePanel(PANEL);   // the panel's cleanup calls teardown
  }

  function build(host: HTMLElement): void {
    root = el('div', o.mount ? 'fd-root fd-mounted' : 'fd-root', host);
    const box = el('div', 'fd-box', root);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', t('found.title'));
    const head = el('div', 'fd-head', box);
    el('h2', 'fd-title', head, t('found.title'));
    balance = el('span', 'fd-bal', head);
    el('p', 'fd-hint', box, t('found.hint'));
    const tree = el('div', 'fd-tree', box);
    rows.forEach((r) => {
      const sec = el('section', 'fd-branch', tree);
      el('h3', 'fd-bname', sec, has(`found.branch.${r.key}`) ? t(`found.branch.${r.key}`) : r.key);
      const cells = el('div', 'fd-cells', sec);
      for (const n of r.items) {
        const i = flat.indexOf(n);
        const card = el('div', 'fd-card', cells);
        card.setAttribute('role', 'button');
        card.tabIndex = -1;   // keys are handled by the screen; the card only takes the mouse
        card.style.gridColumn = String((n.pos?.[0] ?? 0) + 1);
        el('span', 'fd-cname', card, t(n.strings.en.name));
        el('span', 'fd-clv', card);
        el('span', 'fd-cst', card);
        card.addEventListener('click', () => { if (sel === i) buy(i); else select(i); });
        cards[i] = card;
      }
    });
    const detail = el('div', 'fd-detail', box);
    dName = el('div', 'fd-dname', detail);
    dDesc = el('div', 'fd-ddesc', detail);
    dStat = el('div', 'fd-dstat', detail);
    const foot = el('div', 'fd-foot', box);
    buyBtn = el('button', 'fd-btn', foot, t('found.buy'));
    buyBtn.type = 'button';
    buyBtn.addEventListener('click', () => buy(sel));
    const back = el('button', 'fd-btn alt', foot, t('found.back'));
    back.type = 'button';
    back.addEventListener('click', () => close());
  }

  if (o.mount) {
    build(o.mount);
    window.addEventListener('keydown', onKey, true);
    render();
  } else {
    app.ui.panel(PANEL, (host) => {
      build(host);
      window.addEventListener('keydown', onKey, true);
      render();
      return () => teardown();
    });
  }
  return { close };
}
