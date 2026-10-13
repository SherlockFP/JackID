/**
 * Upgrade Ledger panel (GAME-TYCOON, GDD §10.3): the DOM overlay that buys tycoon tracks for one machine instance.
 * It is a plain view over `TycoonApi`: rows come from `upgradesFor`, purchases go through `buy` (host applies,
 * clients forward), and the panel re-renders on `onChange`. Keys: W/S or arrows select, Space/Enter buy,
 * M cycles ×1 / ×10 / MAX, Esc or U closes. The HUD owns when the panel opens (stand still or sit, GDD §10.3).
 */
import type { InstanceId } from '@/core/types';
import { fmtCoins, lang, t } from '@/core/i18n';
import type { BuyMode, TycoonApi, UpgradeView } from '@/game/tycoon.types';

const MODES: readonly BuyMode[] = [1, 10, 'max'];

export interface LedgerOpts {
  /** Called once when the panel closes (Esc / U / `close()`). */
  onClose?(): void;
  /** Optional toast sink (HUD feed). Receives refusal and milestone text. */
  toast?(text: string): void;
}
export interface LedgerHandle {
  close(): void;
  readonly instance: InstanceId;
}

/** Localised refusal text for a `TycoonNoReason`. */
export function refusalText(reason: string | null | undefined): string {
  return t(`tyc.refuse.${reason ?? 'invalid'}`);
}

function modeLabel(m: BuyMode): string {
  return m === 'max' ? t('tyc.ledger.modeMax') : t('tyc.ledger.mode', { n: m });
}

/** Template strings hold i18n keys (`tyc.upg.<track>.name|desc`); `t()` resolves them in the current language. */
function trackName(v: UpgradeView): string {
  return t(v.def.template.strings.en.name);
}
function trackDesc(v: UpgradeView): string {
  return t(v.def.template.strings.en.desc);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/**
 * Mount the ledger for `instance` into `host` (created by the caller, usually a fixed overlay). Returns a handle;
 * `close()` removes listeners and the DOM. Safe to call again for another instance after `close()`.
 */
export function mountLedger(host: HTMLElement, api: TycoonApi, instance: InstanceId, opts: LedgerOpts = {}): LedgerHandle {
  let mode: BuyMode = 1;
  let sel = 0;
  let closed = false;
  let rows: UpgradeView[] = [];

  const root = el('div', 'tyc-ledger');
  root.setAttribute('role', 'dialog');
  root.style.cssText = 'font-family:VT323,monospace;color:#f2e8c9;background:#1a1410;border:2px solid #c9a24a;'
    + 'padding:8px 10px;min-width:320px;max-width:420px;image-rendering:pixelated;';
  const head = el('div', 'tyc-head');
  const body = el('div', 'tyc-body');
  const foot = el('div', 'tyc-foot');
  foot.style.cssText = 'opacity:0.7;font-size:14px;margin-top:6px;';
  foot.textContent = t('tyc.ledger.hint');
  root.append(head, body, foot);
  host.append(root);

  const onKey = (e: KeyboardEvent): void => {
    if (closed) return;
    const k = e.key;
    if (k === 'Escape' || k === 'u' || k === 'U') { e.preventDefault(); handle.close(); return; }
    if (k === 'w' || k === 'W' || k === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); return; }
    if (k === 's' || k === 'S' || k === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); render(); e.preventDefault(); return; }
    if (k === 'm' || k === 'M') { mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]; render(); return; }
    if (k === ' ' || k === 'Enter') { e.preventDefault(); buySelected(); }
  };
  const off = api.onChange(() => render());
  window.addEventListener('keydown', onKey);

  function buySelected(): void {
    const v = rows[sel];
    if (!v) return;
    const q = api.quote(v.def.id, mode);
    if (q.levels <= 0) { opts.toast?.(refusalText(q.blocked)); return; }
    if (!api.buy(v.def.id, mode)) opts.toast?.(refusalText('funds'));
  }

  function render(): void {
    if (closed) return;
    rows = [...api.upgradesFor(instance)];
    if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
    const owned = api.owned(instance);
    head.textContent = '';
    head.append(el('div', 'tyc-title', t('tyc.ledger.title')));
    head.append(el('div', 'tyc-sub', `${instance}${owned ? ' · ' + t('tyc.ledger.owner', { who: owned.owner ? String(owned.owner) : '—' }) : ''}`));
    body.textContent = '';
    if (!owned) { body.append(el('div', 'tyc-note', t('tyc.ledger.notOwned'))); return; }
    if (rows.length === 0) { body.append(el('div', 'tyc-note', t('tyc.ledger.empty'))); return; }
    rows.forEach((v, i) => body.append(rowEl(v, i === sel)));
    const hold = api.holdings();
    body.append(el('div', 'tyc-holdings', `${t('tyc.ledger.pit')}: ${fmtCoins(hold, true)}`));
  }

  function rowEl(v: UpgradeView, selected: boolean): HTMLElement {
    const row = el('div', 'tyc-row' + (selected ? ' sel' : ''));
    row.style.cssText = `display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:4px 6px;margin:2px 0;${selected ? 'background:#3a2c18;' : ''}`;
    const max = v.def.maxLevel;
    const name = el('div', 'tyc-name', `${trackName(v)}  ${t('tyc.ledger.level', { n: v.level, max })}`);
    name.style.color = v.def.template.color !== undefined ? `#${v.def.template.color.toString(16).padStart(6, '0')}` : '#f2e8c9';
    row.append(name);
    const q = api.quote(v.def.id, mode);
    const btn = el('button', 'tyc-buy', v.level >= max ? t('tyc.ledger.maxed') : `${t('tyc.ledger.buy')} ${fmtCoins(q.cost, true)}`);
    btn.type = 'button';
    btn.disabled = v.level >= max || !q.affordable;
    btn.style.cssText = 'font:inherit;color:inherit;background:#2a2014;border:1px solid #c9a24a;padding:0 6px;';
    btn.onclick = (ev) => { ev.stopPropagation(); sel = rows.indexOf(v); buySelected(); };
    row.append(btn);
    const sub = el('div', 'tyc-desc', trackDesc(v));
    sub.style.cssText = 'grid-column:1 / span 2;font-size:14px;opacity:0.8;';
    row.append(sub);
    const next = v.next;
    const nextTxt = next ? t('tyc.ledger.next', { n: next.level, what: next.feature ?? next.visual ?? '' }) : t('tyc.ledger.nextNone');
    const nl = el('div', 'tyc-next', nextTxt);
    nl.style.cssText = 'grid-column:1 / span 2;font-size:14px;color:#c9a24a;';
    row.append(nl);
    row.onclick = () => { sel = rows.indexOf(v); render(); };
    return row;
  }

  const handle: LedgerHandle = {
    instance,
    close(): void {
      if (closed) return;
      closed = true;
      off();
      window.removeEventListener('keydown', onKey);
      root.remove();
      opts.onClose?.();
    },
  };
  render();
  return handle;
}

