/**
 * Server browser (GDD §9.6): the MULTIPLAYER face of the die menu. An old CRT monitor rises in front of the dice cabinet
 * (see mp/stage.ts) and shows the room list in green phosphor. Keys: W/S or arrows select · Enter join · R refresh · H host ·
 * J join by code · F filter · Esc back. Mouse: click a row (double-click joins), click the tabs and buttons, or press the keys
 * on the 3D keyboard. Joining succeeds → `enterLobby('client')`; hosting → the host screen → `enterLobby('host')`.
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { addRoomSource, listRooms, targetOf, type ListedRoom } from './mp/directory';
import { joinByCode, joinTarget, type JoinResult } from './mp/join';
import { httpBaseOf, resolveLobbyUrl } from '@/net/lobbyClient';
import { openHostPanel } from './hostPanel';
import { enterLobby } from './mp/nav';
import { stage, hookStageOverlay, type Screen, type StageKey } from './mp/stage';
import { HitMap, PHOS, PIX, box, button, say, sayFit, wrapLines } from './mp/crtArt';

const REFRESH_MS = 5000;
/** Footer and tab labels, and the hint line: brighter than the dim phosphor so they read on the glass. */
const LABEL = '#7ff0a0';
const LABEL_DIM = '#5fcf86';
const LOBBY_PROBE_MS = 3000;

/**
 * Is the lobby server answering? The net layer's `discoverServer()` returns an empty list when the socket is down, so
 * an empty LOBBY list alone cannot tell "nobody is hosting" from "offline". This probes the same `/api/rooms` endpoint
 * the net layer falls back to, with a short timeout. Settings-level lobby URLs are not visible here, so the default URL
 * (same host `/lobby`, or VITE_LOBBY_URL) is probed.
 */
async function probeLobby(): Promise<boolean> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), LOBBY_PROBE_MS);
  try {
    const res = await fetch(`${httpBaseOf(resolveLobbyUrl())}/rooms`, { cache: 'no-store', signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}
const DOUBLE_MS = 380;
const ROW_H = 20;
const ROW_Y = 104;
const ROWS = 9;
const CODE_MAX = 8;
const PASS_MAX = 32;

type Tab = 'lobby' | 'tab';
type Filter = 'all' | 'coop' | 'versus' | 'free' | 'space';
type Mode = 'list' | 'code' | 'pass';
const FILTERS: readonly Filter[] = ['all', 'coop', 'versus', 'free', 'space'];
const MODE_OF: Record<Filter, string | null> = { all: null, coop: 'coop', versus: 'versus', free: 'free', space: null };

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

const roomKey = (r: ListedRoom): string => `${r.net}:${r.id}`;

function pingColor(ms: number | undefined): string {
  if (ms === undefined) return PHOS.dim;
  if (ms < 60) return PHOS.fg;
  if (ms < 150) return PHOS.warn;
  return PHOS.bad;
}

class BrowserScreen implements Screen {
  private tab: Tab = 'lobby';
  private filter: Filter = 'all';
  private rooms: ListedRoom[] = [];
  private shown: ListedRoom[] = [];
  private selected: string | null = null;
  private scroll = 0;
  private busy = false;
  private err = '';
  private mode: Mode = 'list';
  private buf = '';
  private passRoom: ListedRoom | null = null;
  private active = false;
  private timer = 0;
  private scanning = false;
  /** The lobby server did not answer the last probe: the LOBBY tab shows OFFLINE instead of an empty list. */
  private lobbyDown = false;
  private last = { id: '', at: 0 };
  private readonly hits = new HitMap();

  open(): void {
    if (this.active) return;
    this.active = true;
    this.mode = 'list';
    this.buf = '';
    void this.refresh();
    this.timer = window.setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  close(): void {
    this.active = false;
    window.clearInterval(this.timer);
  }

  private arrange(): void {
    this.shown = arrangeRooms(this.rooms, this.tab, this.filter);
    if (this.selected && !this.shown.some((r) => roomKey(r) === this.selected)) this.selected = null;
  }

  private async refresh(): Promise<void> {
    this.scanning = true;
    const [rooms, up] = await Promise.all([listRooms(), probeLobby()]);
    this.scanning = false;
    if (!this.active) return;
    this.rooms = rooms;
    this.lobbyDown = !up;
    this.arrange();
  }

  private cycleFilter(): void {
    this.filter = FILTERS[(FILTERS.indexOf(this.filter) + 1) % FILTERS.length]!;
    this.arrange();
  }

  private moveSelection(step: number): void {
    if (this.shown.length === 0) return;
    const i = this.shown.findIndex((r) => roomKey(r) === this.selected);
    const next = i < 0 ? (step > 0 ? 0 : this.shown.length - 1) : (i + step + this.shown.length) % this.shown.length;
    this.selected = roomKey(this.shown[next]!);
    this.keepVisible();
  }

  private keepVisible(): void {
    const i = this.shown.findIndex((r) => roomKey(r) === this.selected);
    if (i < 0) return;
    if (i < this.scroll) this.scroll = i;
    if (i >= this.scroll + ROWS) this.scroll = i - ROWS + 1;
  }

  private selectedRoom(): ListedRoom | null {
    return this.shown.find((r) => roomKey(r) === this.selected) ?? null;
  }

  private async joinRow(r: ListedRoom): Promise<void> {
    if (this.busy) return;
    if (r.players >= r.max) { this.err = t('mp.browser.full'); return; }
    if (r.locked) {
      this.passRoom = r;
      this.buf = '';
      this.err = '';
      this.mode = 'pass';
      return;
    }
    await this.runJoin(() => joinTarget(targetOf(r)));
  }

  private async runJoin(attempt: () => Promise<JoinResult>): Promise<void> {
    this.busy = true;
    this.err = '';
    const res = await attempt();
    this.busy = false;
    if (res.ok === false) this.err = res.reason;
    else enterLobby('client');
  }

  private openCode(): void {
    this.buf = '';
    this.err = '';
    this.mode = 'code';
  }

  /** Ctrl+V: the clipboard text goes into the open prompt (room code: A-Z 0-9 only; password: as typed, one line). */
  paste(text: string): void {
    if (this.mode === 'code') {
      const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
      this.buf = (this.buf + clean).slice(0, CODE_MAX);
    } else if (this.mode === 'pass') {
      const clean = text.replace(/[\r\n\t]/g, '');
      this.buf = (this.buf + clean).slice(0, PASS_MAX);
    }
  }

  private submitPrompt(): void {
    if (this.mode === 'code') {
      void this.runJoin(() => joinByCode(this.buf));
    } else if (this.mode === 'pass' && this.passRoom) {
      const room = this.passRoom;
      void this.runJoin(() => joinTarget(targetOf(room), this.buf));
    }
  }

  private host(): void {
    openHostPanel(() => showServerBrowser());
  }

  private back(): void {
    stage.close();
  }

  // ── Screen ────────────────────────────────────────────────────────────────────────────────────

  key(e: StageKey): void {
    if (this.mode !== 'list') {
      if (e.code === 'Escape') { this.mode = 'list'; this.err = ''; return; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') { this.submitPrompt(); return; }
      if (e.code === 'Backspace') { this.buf = this.buf.slice(0, -1); return; }
      const max = this.mode === 'code' ? CODE_MAX : PASS_MAX;
      if (e.key.length !== 1 || this.buf.length >= max) return;
      if (this.mode === 'code') { if (/^[A-Za-z0-9]$/.test(e.key)) this.buf += e.key.toUpperCase(); }
      else this.buf += e.key;
      return;
    }
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.moveSelection(-1); break;
      case 'KeyS': case 'ArrowDown': this.moveSelection(1); break;
      case 'Enter': case 'NumpadEnter': { const r = this.selectedRoom(); if (r) void this.joinRow(r); break; }
      case 'KeyR': void this.refresh(); break;
      case 'KeyH': this.host(); break;
      case 'KeyJ': this.openCode(); break;
      case 'KeyF': this.cycleFilter(); break;
      case 'Escape': this.back(); break;
      default: return;
    }
    e.preventDefault();
  }

  click(x: number, y: number): void {
    const id = this.hits.at(x, y);
    if (!id) return;
    if (id.startsWith('row:')) {
      const r = this.shown[Number(id.slice(4))];
      if (!r) return;
      const now = performance.now();
      const dbl = this.last.id === id && now - this.last.at < DOUBLE_MS;
      this.last = { id, at: now };
      this.selected = roomKey(r);
      if (dbl) void this.joinRow(r);
      return;
    }
    switch (id) {
      case 'tab:lobby': this.tab = 'lobby'; this.selected = null; this.scroll = 0; this.arrange(); break;
      case 'tab:tab': this.tab = 'tab'; this.selected = null; this.scroll = 0; this.arrange(); break;
      case 'filter': this.cycleFilter(); break;
      case 'refresh': void this.refresh(); break;
      case 'code': this.openCode(); break;
      case 'host': this.host(); break;
      case 'back': this.back(); break;
      case 'prompt:go': this.submitPrompt(); break;
      case 'prompt:cancel': this.mode = 'list'; this.err = ''; break;
      default: break;
    }
  }

  paint(c: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const hits = this.hits;
    hits.clear();
    c.fillStyle = PHOS.bg;
    c.fillRect(0, 0, w, h);
    say(c, t('mp.browser.title'), 18, 14, PHOS.fg, 12, 'left', PIX);
    if (this.scanning || Math.floor(time * 2) % 2 === 0) say(c, t('mp.browser.live'), w - 18, 16, PHOS.cyan, 16, 'right');
    box(c, 10, 8, w - 20, 34, null, PHOS.dim);

    if (this.mode !== 'list') { this.paintPrompt(c, w, time); return; }

    button(c, hits, 'tab:lobby', t('mp.browser.tab.lobby'), 18, 48, 130, 22, this.tab === 'lobby', LABEL);
    button(c, hits, 'tab:tab', t('mp.browser.tab.tab'), 156, 48, 170, 22, this.tab === 'tab', LABEL);
    const offline = this.tab === 'lobby' && this.lobbyDown && !this.scanning;
    if (offline) say(c, t('mp.browser.offline'), w - 18, 52, PHOS.bad, 16, 'right');
    else say(c, t('mp.browser.count', { n: this.shown.length }), w - 18, 52, LABEL_DIM, 16, 'right');

    const cols = [
      { x: 20, w: 18, label: '', align: 'left' as const },
      { x: 42, w: 150, label: t('mp.browser.col.room'), align: 'left' as const },
      { x: 196, w: 66, label: t('mp.browser.col.host'), align: 'left' as const },
      { x: 266, w: 54, label: t('mp.browser.col.net'), align: 'left' as const },
      { x: 324, w: 60, label: t('mp.browser.col.mode'), align: 'left' as const },
      { x: 388, w: 36, label: t('mp.browser.col.players'), align: 'right' as const },
      { x: 428, w: 28, label: t('mp.browser.col.ping'), align: 'right' as const },
      { x: 462, w: 50, label: t('mp.browser.col.state'), align: 'left' as const },
    ];
    for (const col of cols) sayFit(c, col.label, col.x, 78, col.w, LABEL_DIM, 16, col.align);
    c.fillStyle = PHOS.dim;
    c.fillRect(16, ROW_Y - 5, w - 32, 1);

    if (offline) {
      say(c, t('mp.browser.offline'), w / 2, ROW_Y + 36, PHOS.bad, 13, 'center', PIX);
      for (const [i, line] of wrapLines(c, t('mp.browser.offlineHint'), w - 80, 17).slice(0, 3).entries()) {
        say(c, line, w / 2, ROW_Y + 84 + i * 20, LABEL, 17, 'center');
      }
    } else if (this.shown.length === 0) {
      say(c, this.scanning ? t('mp.browser.scan') : t('mp.browser.empty'), w / 2, ROW_Y + 60, LABEL_DIM, 17, 'center');
    }
    this.keepVisible();
    for (let i = 0; i < ROWS; i++) {
      const idx = this.scroll + i;
      const r = this.shown[idx];
      if (!r) break;
      const y = ROW_Y + i * ROW_H;
      const sel = roomKey(r) === this.selected;
      const full = r.players >= r.max;
      const ink = sel ? PHOS.ink : full ? PHOS.dim : PHOS.fg;
      if (sel) { c.fillStyle = PHOS.sel; c.fillRect(16, y, w - 32, ROW_H - 1); }
      hits.add(`row:${idx}`, 16, y, w - 32, ROW_H - 1);
      if (r.locked) say(c, t('mp.browser.lock'), 20, y, sel ? ink : PHOS.amber, 15);
      sayFit(c, r.name, 42, y, 146, ink, 16);
      sayFit(c, r.host, 196, y, 64, ink, 16);
      sayFit(c, t(`mp.browser.net.${r.net}`), 266, y, 54, sel ? ink : PHOS.cyan, 15);
      sayFit(c, t(`mp.mode.${r.mode}`), 324, y, 58, ink, 16);
      say(c, `${r.players}/${r.max}`, 424, y, ink, 16, 'right');
      say(c, r.ping === undefined ? '--' : `${Math.round(r.ping)}`, 456, y, sel ? ink : pingColor(r.ping), 16, 'right');
      sayFit(c, full ? t('mp.browser.full') : r.started ? t('mp.browser.inProgress') : t('mp.state.lobby'), 462, y, 50, ink, 14);
    }

    if (this.err) sayFit(c, this.err, 20, 296, w - 40, PHOS.bad, 16);
    button(c, hits, 'filter', t('mp.browser.filter', { f: t(`mp.browser.filter.${this.filter}`) }), 18, 316, 200, 22, false, LABEL);
    button(c, hits, 'refresh', t('mp.browser.refresh'), 18, 344, 116, 24, false, LABEL);
    button(c, hits, 'code', t('mp.browser.joinCode'), 140, 344, 130, 24, false, LABEL);
    button(c, hits, 'host', t('mp.browser.host'), 276, 344, 104, 24, false, PHOS.warn);
    button(c, hits, 'back', t('mp.browser.back'), 386, 344, 108, 24, false, LABEL_DIM);
    for (const line of wrapLines(c, t('mp.browser.hint'), w - 36, 14)) say(c, line, w / 2, 372, LABEL_DIM, 14, 'center');
  }

  private paintPrompt(c: CanvasRenderingContext2D, w: number, time: number): void {
    const hits = this.hits;
    const pass = this.mode === 'pass';
    const title = pass ? t('mp.pass.title') : t('mp.code.title');
    box(c, 70, 70, w - 140, 230, PHOS.bg, PHOS.fg);
    say(c, title, w / 2, 90, PHOS.fg, 12, 'center', PIX);
    const body = pass && this.passRoom ? t('mp.pass.body', { name: this.passRoom.name }) : t('mp.code.hint');
    for (let i = 0; i < 2; i++) {
      const line = wrapLines(c, body, w - 170, 17)[i];
      if (line) say(c, line, w / 2, 118 + i * 24, PHOS.fg, 17, 'center');
    }
    say(c, pass ? t('mp.pass.field') : t('mp.code.field'), 100, 176, PHOS.dim, 15);
    box(c, 100, 196, w - 200, 30, PHOS.ink, PHOS.fg);
    const shown = pass ? '*'.repeat(this.buf.length) : this.buf;
    const cursor = Math.floor(time * 2) % 2 === 0 ? '_' : ' ';
    sayFit(c, `${shown}${cursor}`, 108, 201, w - 216, PHOS.hi, 20);
    say(c, t('mp.browser.pasteHint'), w / 2, 230, LABEL_DIM, 13, 'center');
    button(c, hits, 'prompt:go', pass ? t('mp.pass.join') : t('mp.code.join'), 100, 248, 150, 28, true);
    button(c, hits, 'prompt:cancel', t('mp.browser.back'), w - 250, 248, 150, 28, false, LABEL_DIM);
    if (this.err) sayFit(c, this.err, w / 2, 288, w - 140, PHOS.bad, 16, 'center');
  }
}

let browser: BrowserScreen | null = null;

/** Open the server browser on the CRT (the MULTIPLAYER face calls this). */
export function openServerBrowser(): void {
  // The LOBBY source (lobby server rooms). Re-registering replaces the previous entry, so this is safe to repeat.
  addRoomSource({ net: 'LOBBY', list: () => app.net.discoverServer() });
  hookStageOverlay();
  browser ??= new BrowserScreen();
  stage.show(browser);
}

/** Put the browser back on the monitor (the host form's BACK). */
export function showServerBrowser(): void {
  if (browser) stage.show(browser);
}
