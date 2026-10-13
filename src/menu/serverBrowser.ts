/**
 * Server browser (GDD §9.6): the MULTIPLAYER face of the die menu opens this lit DOM panel. Columns: lock, room, host, mode,
 * players, ping, state, net. Keys: W/S select · Enter join · R refresh · H host · J join by code · F filter · Esc back.
 * Joining succeeds → `app.go('lobby', { role: 'client' })`; hosting → `openHostPanel` → `app.go('lobby', { role: 'host' })`.
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { button, focusFirst, frame, h, modalPanel, tabs, textField } from '@/core/ui/widgets';
import { listRooms, targetOf, type ListedRoom } from './mp/directory';
import { joinByCode, joinTarget, type JoinResult } from './mp/join';
import { openHostPanel } from './hostPanel';
import { enterLobby } from './mp/nav';
import './mp/mp.css';

export const BROWSER_PANEL = 'mp-browser';
const PASS_PANEL = 'mp-pass';
const CODE_PANEL = 'mp-code';
const REFRESH_MS = 5000;

type Tab = 'lobby' | 'tab';
type Filter = 'all' | 'coop' | 'versus' | 'free' | 'space';
const FILTERS: readonly Filter[] = ['all', 'coop', 'versus', 'free', 'space'];
const MODE_OF: Record<Filter, string | null> = { all: null, coop: 'coop', versus: 'versus', free: 'free', space: null };

/** Open the server browser over the menu (the MULTIPLAYER face calls this). */
export function openServerBrowser(): void {
  app.ui.panel(BROWSER_PANEL, (el) => buildBrowser(el));
}

function pingClass(ms: number | undefined): string {
  if (ms === undefined) return 'mp-dim';
  if (ms < 60) return 'mp-ping-good';
  if (ms < 150) return 'mp-ping-mid';
  return 'mp-ping-bad';
}

/** Visible list: filter, then full rooms last, then ping ascending (unknown ping last). */
export function arrangeRooms(rooms: readonly ListedRoom[], tab: Tab, filter: Filter): ListedRoom[] {
  const wantNet = tab === 'tab' ? 'TAB' : 'LOBBY';
  const mode = MODE_OF[filter];
  return rooms
    .filter((r) => (tab === 'tab' ? r.net === wantNet : r.net !== 'TAB'))
    .filter((r) => (mode ? r.mode === mode : true))
    .filter((r) => (filter === 'space' ? r.players < r.max && !r.started : true))
    .sort((a, b) => {
      const fa = a.players >= a.max ? 1 : 0, fb = b.players >= b.max ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return (a.ping ?? 1e9) - (b.ping ?? 1e9);
    });
}

function buildBrowser(el: HTMLElement): () => void {
  modalPanel(el, { escClose: true, dim: true });
  el.dataset.panel = BROWSER_PANEL;
  el.classList.add('mp-wide');
  const f = frame(el, { title: t('mp.browser.title'), variant: 'cyan' });

  let tab: Tab = 'lobby';
  let filter: Filter = 'all';
  let rooms: ListedRoom[] = [];
  let shown: ListedRoom[] = [];
  let selected: string | null = null;
  let busy = false;
  let disposed = false;

  const tabBar = tabs(f.body, {
    tabs: [{ id: 'lobby', label: t('mp.browser.tab.lobby') }, { id: 'tab', label: t('mp.browser.tab.tab') }],
    active: 'lobby',
    onChange: (id) => { tab = id as Tab; selected = null; render(); },
  });
  void tabBar;

  const wrap = h('div', 'mp-scroll', f.body);
  const table = h('table', 'mp-table', wrap);
  const thead = h('thead', '', table);
  const headRow = h('tr', '', thead);
  const cols: Array<[string, string]> = [
    ['', ''], ['room', 'browser.col.room'], ['host', 'browser.col.host'], ['mode', 'browser.col.mode'],
    ['players', 'browser.col.players'], ['ping', 'browser.col.ping'], ['state', 'browser.col.state'], ['net', 'browser.col.net'],
  ];
  for (const [id, key] of cols) {
    const th = h('th', id === 'host' || id === 'mode' || id === 'net' ? 'mp-hide-sm' : '', headRow, key ? t(`mp.${key}`) : '');
    th.scope = 'col';
  }
  const tbody = h('tbody', '', table);

  const empty = h('div', 'mp-hint', f.body);
  const err = h('div', 'mp-err', f.body);

  const bar = h('div', 'mp-row', f.body);
  const filterBtn = button(bar, { label: '', onClick: () => cycleFilter() });
  button(bar, { label: t('mp.browser.refresh'), onClick: () => { void refresh(); } });
  button(bar, { label: t('mp.browser.joinCode'), onClick: () => openCodePrompt() });
  button(bar, { label: t('mp.browser.host'), kind: 'primary', onClick: () => openHostFromBrowser() });
  button(bar, { label: t('mp.browser.back'), kind: 'ghost', onClick: () => { app.ui.closePanel(BROWSER_PANEL); } });
  h('p', 'mp-hint', f.body, t('mp.browser.hint'));

  const setErr = (s: string): void => { err.textContent = s; };

  function render(): void {
    shown = arrangeRooms(rooms, tab, filter);
    filterBtn.setLabel(t('mp.browser.filter', { f: t(`mp.browser.filter.${filter}`) }));
    tbody.replaceChildren();
    for (const r of shown) {
      const full = r.players >= r.max;
      const tr = h('tr', `${r.id === selected ? 'mp-sel' : ''} ${full ? 'mp-dim' : ''}`.trim(), tbody);
      tr.dataset.id = roomKey(r);
      h('td', 'mp-lock', tr, r.locked ? t('mp.browser.lock') : '');
      h('td', '', tr, r.name);
      h('td', 'mp-hide-sm', tr, r.host);
      h('td', 'mp-hide-sm', tr, t(`mp.mode.${r.mode}`));
      h('td', '', tr, `${r.players}/${r.max}`);
      h('td', pingClass(r.ping), tr, r.ping === undefined ? '--' : `${Math.round(r.ping)}`);
      h('td', '', tr, full ? t('mp.browser.full') : r.started ? t('mp.browser.inProgress') : t('mp.state.lobby'));
      h('td', 'mp-tag mp-tag-net mp-hide-sm', tr, t(`mp.browser.net.${r.net}`));
      tr.addEventListener('click', () => { selected = roomKey(r); render(); });
      tr.addEventListener('dblclick', () => { selected = roomKey(r); void joinRow(r); });
    }
    empty.textContent = shown.length === 0 ? t('mp.browser.empty') : '';
    focusSelected();
  }

  const roomKey = (r: ListedRoom): string => `${r.net}:${r.id}`;
  const selectedRoom = (): ListedRoom | null => shown.find((r) => roomKey(r) === selected) ?? null;

  function focusSelected(): void {
    const row = tbody.querySelector<HTMLElement>('tr.mp-sel');
    row?.scrollIntoView({ block: 'nearest' });
  }

  async function refresh(): Promise<void> {
    rooms = await listRooms();
    if (disposed) return;
    if (selected && !rooms.some((r) => roomKey(r) === selected)) selected = null;
    render();
  }

  function cycleFilter(): void {
    filter = FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]!;
    render();
  }

  function moveSelection(step: number): void {
    if (shown.length === 0) return;
    const i = shown.findIndex((r) => roomKey(r) === selected);
    const next = (i < 0 ? (step > 0 ? 0 : shown.length - 1) : (i + step + shown.length) % shown.length);
    selected = roomKey(shown[next]!);
    render();
  }

  async function joinRow(r: ListedRoom): Promise<void> {
    if (busy) return;
    if (r.players >= r.max) { setErr(t('mp.browser.full')); return; }
    if (r.locked) {
      openPasswordPrompt(r.name, (pw) => joinTarget(targetOf(r), pw));
      return;
    }
    await runJoin(() => joinTarget(targetOf(r)));
  }

  async function runJoin(attempt: () => Promise<JoinResult>): Promise<JoinResult> {
    busy = true;
    setErr('');
    const res = await attempt();
    busy = false;
    if (res.ok === false) setErr(res.reason);
    else enterLobby('client');
    return res;
  }

  function openHostFromBrowser(): void {
    openHostPanel();
  }

  function openCodePrompt(): void {
    app.ui.panel(CODE_PANEL, (c) => {
      modalPanel(c, { escClose: true, dim: true });
      const cf = frame(c, { title: t('mp.code.title'), variant: 'cyan' });
      const field = textField(cf.body, { placeholder: t('mp.code.field'), maxLength: 8, onSubmit: () => { void go(); } });
      h('p', 'mp-hint', cf.body, t('mp.code.hint'));
      const e = h('div', 'mp-err', cf.body);
      const go = async (): Promise<void> => {
        const res = await joinByCode(field.value);
        if (res.ok === false) e.textContent = res.reason;
        else enterLobby('client');
      };
      button(cf.body, { label: t('mp.code.join'), kind: 'primary', onClick: () => { void go(); } });
      focusFirst(c);
      field.focus();
    });
  }

  function openPasswordPrompt(name: string, submit: (pw: string) => Promise<JoinResult>): void {
    app.ui.panel(PASS_PANEL, (p) => {
      modalPanel(p, { escClose: true, dim: true });
      const pf = frame(p, { title: t('mp.pass.title'), variant: 'brass' });
      h('p', 'mp-hint', pf.body, t('mp.pass.body', { name }));
      const field = textField(pf.body, { password: true, maxLength: 32, placeholder: t('mp.pass.field'), onSubmit: () => { void go(); } });
      const e = h('div', 'mp-err', pf.body);
      const go = async (): Promise<void> => {
        const res = await submit(field.value);
        if (res.ok === false) e.textContent = res.reason;
        else enterLobby('client');
      };
      button(pf.body, { label: t('mp.pass.join'), kind: 'primary', onClick: () => { void go(); } });
      focusFirst(p);
      field.focus();
    });
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': moveSelection(-1); break;
      case 'KeyS': case 'ArrowDown': moveSelection(1); break;
      case 'Enter': { const r = selectedRoom(); if (r) void joinRow(r); break; }
      case 'KeyR': void refresh(); break;
      case 'KeyH': openHostFromBrowser(); break;
      case 'KeyJ': openCodePrompt(); break;
      case 'KeyF': cycleFilter(); break;
      default: return;
    }
    e.preventDefault();
  };
  el.addEventListener('keydown', onKey);

  render();
  void refresh();
  const timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
  focusFirst(el);

  return () => {
    disposed = true;
    window.clearInterval(timer);
    el.removeEventListener('keydown', onKey);
  };
}
