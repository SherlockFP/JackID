/**
 * Party lobby = the Lift (GDD §9.5). Roster with READY lamps, the host's mode and max settings, chat, and START. The host
 * starts the run (`start` to everyone, then `app.go('ingame', { online: true })`); clients follow the `start` message.
 * Entered after a successful host or join (`role`). Keep the factory name `createLobbyState`.
 */
import * as THREE from 'three';
import type { AppStateHandler, StateParams } from '@/core/states';
import { app } from '@/core/app';
import { has, t } from '@/core/i18n';
import type { GameMode, Hex, PlayerId, Unsub } from '@/core/types';
import type { PlayerInfo, RunConfig } from '@/net/protocol';
import { button, frame, h, modalPanel, textField, type Button, type TextField } from '@/core/ui/widgets';
import { CHAT_LINES, CHAT_MAX, MP_MAX_MAX, MP_MAX_MIN, MP_MODES, defaultRunConfig, roomSeed } from './mp/config';
import './mp/mp.css';

export const LOBBY_PANEL = 'mp-lobby';

const css = (c: Hex): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

interface LobbyView {
  dispose(): void;
}

/** Turn a `start` (host) or local decision into the in-game params. */
function beginRun(mode: GameMode, seed: number, cfg: RunConfig): void {
  void app.go('ingame', { mode, seed, online: true, config: cfg });
}

export function createLobbyState(): AppStateHandler<'lobby'> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0a09);
  let view: LobbyView | null = null;

  return {
    enter(params: StateParams['lobby']) {
      if (!app.net.room) {
        void app.go('menu', { toast: t('mp.lobby.noRoom') });
        return;
      }
      view = openLobby(params.role);
    },
    exit() {
      view?.dispose();
      view = null;
      app.ui.closePanel(LOBBY_PANEL);
    },
    fixedUpdate() {},
    frame() {
      app.renderer.render(scene, app.camera);
    },
  };
}

function openLobby(role: 'host' | 'client'): LobbyView {
  const net = app.net;
  const room = net.room!;
  const isHost = role === 'host' && net.isHost;
  const offs: Unsub[] = [];
  let mode: GameMode = room.mode;
  let max = room.max;
  let runCfg: RunConfig = defaultRunConfig(mode);
  let started = false;
  let closed = false;

  // UI refs filled by the panel builder below.
  let rosterHead: HTMLElement | null = null;
  let rosterList: HTMLElement | null = null;
  let headerEl: HTMLElement | null = null;
  let logEl: HTMLElement | null = null;
  let readyBtn: Button | null = null;
  let modeBtn: Button | null = null;
  let maxBtn: Button | null = null;
  let chat: TextField | null = null;

  const nameOf = (pid: PlayerId): string => net.players.get(pid)?.name || `#${pid}`;

  function appendLine(kind: 'chat' | 'sys', who: string, text: string): void {
    if (!logEl) return;
    const line = h('div', kind === 'sys' ? 'mp-sys' : '', logEl);
    if (kind === 'chat') {
      h('span', 'mp-from', line, `${who}: `);
      line.appendChild(document.createTextNode(text));
    } else {
      line.textContent = text;
    }
    while (logEl.childElementCount > CHAT_LINES) logEl.firstElementChild?.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderHeader(): void {
    if (headerEl) headerEl.textContent = `${t('mp.lobby.code', { code: room.id })}  ·  ${t('mp.lobby.mode', { m: t(`mp.mode.${mode}`) })}  ·  ${t('mp.lobby.max', { n: max })}`;
    modeBtn?.setLabel(t('mp.lobby.mode', { m: t(`mp.mode.${mode}`) }));
    maxBtn?.setLabel(t('mp.lobby.max', { n: max }));
  }

  function renderRoster(): void {
    if (!rosterList || !rosterHead) return;
    const players: PlayerInfo[] = [...net.players.values()].sort((a, b) => a.id - b.id);
    rosterHead.textContent = t('mp.lobby.roster', { n: players.length, max });
    rosterList.replaceChildren();
    for (const p of players) {
      const li = h('li', 'mp-seat', rosterList);
      const sw = h('span', 'mp-swatch', li);
      sw.style.background = css(p.color);
      h('span', '', li, p.name || `#${p.id}`);
      if (p.host) h('span', 'mp-tag mp-tag-host', li, t('mp.lobby.host'));
      if (p.id === net.selfId) h('span', 'mp-tag mp-tag-you', li, t('mp.lobby.you'));
      h('span', p.ready ? 'mp-lamp mp-lamp-on' : 'mp-lamp', li, t(p.ready ? 'mp.lobby.lampOn' : 'mp.lobby.lampOff'));
    }
    const me = net.players.get(net.selfId);
    readyBtn?.setLabel(me?.ready ? t('mp.lobby.unready') : t('mp.lobby.ready'));
  }

  function refresh(): void {
    renderHeader();
    renderRoster();
  }

  const sendReady = (r: boolean): void => {
    net.send({ t: 'ready', r }, isHost ? net.selfId : 'host');
  };

  function startGame(): void {
    if (!isHost || started || closed) return;
    started = true;
    const seed = roomSeed(room.id, Date.now(), app.save.data.profile.id);
    const cfg: RunConfig = { ...runCfg, sharedBank: mode === 'coop' };
    net.send({ t: 'start', mode, seed, cfg, at: net.hostTime() + 600 }, 'others');
    app.ui.toast(t('mp.lobby.starting'), 'sys', 2);
    beginRun(mode, seed, cfg);
  }

  function sendChat(): void {
    if (!chat) return;
    const text = chat.input.value.trim().slice(0, CHAT_MAX);
    chat.input.value = '';
    if (!text) return;
    if (isHost) {
      net.send({ t: 'chat', from: net.selfId, text }, 'others');
      appendLine('chat', nameOf(net.selfId), text);
    } else {
      net.send({ t: 'chat', text }, 'host');
    }
  }

  const leave = (): void => {
    if (closed) return;
    closed = true;
    net.leave('left');
    void app.go('menu', undefined);
  };

  app.ui.panel(LOBBY_PANEL, (el) => {
    modalPanel(el, { escClose: false, dim: true });
    el.dataset.panel = LOBBY_PANEL;
    el.classList.add('mp-wide');
    const f = frame(el, { title: t('mp.lobby.title'), variant: 'brass' });

    headerEl = h('div', 'mp-title', f.body);
    rosterHead = h('div', 'mp-hint', f.body);
    rosterList = h('ul', 'mp-roster', f.body);

    const actions = h('div', 'mp-row', f.body);
    readyBtn = button(actions, { label: t('mp.lobby.ready'), kind: 'primary', onClick: () => {
      const me = net.players.get(net.selfId);
      sendReady(!(me?.ready ?? false));
    } });
    if (isHost) {
      modeBtn = button(actions, { label: '', onClick: () => {
        mode = MP_MODES[(MP_MODES.indexOf(mode) + 1) % MP_MODES.length]!;
        runCfg = { ...runCfg, sharedBank: mode === 'coop' };
        net.send({ t: 'lcfg', mode, max, lateJoin: room.lateJoin, cfg: runCfg }, 'others');
        refresh();
      } });
      maxBtn = button(actions, { label: '', onClick: () => {
        const floor = Math.max(MP_MAX_MIN, net.players.size);
        let next = max + 1 > MP_MAX_MAX ? MP_MAX_MIN : max + 1;
        if (next < floor) next = floor;
        max = next;
        net.send({ t: 'lcfg', mode, max, lateJoin: room.lateJoin, cfg: runCfg }, 'others');
        refresh();
      } });
      button(actions, { label: t('mp.lobby.start'), kind: 'primary', onClick: startGame });
    } else {
      h('span', 'mp-hint', actions, t('mp.lobby.hostOnly'));
    }
    button(actions, { label: t('mp.lobby.leave'), kind: 'danger', hold: true, onClick: leave });

    logEl = h('div', 'mp-log', f.body);
    const chatRow = h('div', 'mp-row', f.body);
    chat = textField(chatRow, { maxLength: CHAT_MAX, placeholder: t('mp.lobby.chat'), onSubmit: sendChat });
    chat.el.classList.add('mp-grow');
    button(chatRow, { label: t('mp.lobby.send'), onClick: sendChat });
    h('p', 'mp-hint', f.body, t('mp.lobby.hint'));

    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); leave(); }
    });
    return () => { /* the state's exit() closes the panel */ };
  });

  // Network: roster, settings, chat and the start signal.
  offs.push(net.on('pjoin', (m) => { appendLine('sys', '', t('mp.lobby.joined', { name: m.p.name })); refresh(); }));
  offs.push(net.on('pupd', () => refresh()));
  offs.push(net.on('pleave', (m) => {
    appendLine('sys', '', t('mp.lobby.left', { name: nameOf(m.id) }));
    refresh();
  }));
  offs.push(net.on('lcfg', (m) => { mode = m.mode; max = m.max; runCfg = m.cfg; refresh(); }));
  offs.push(net.on('chat', (m, from) => { appendLine('chat', nameOf(m.from ?? from), m.text); }));
  offs.push(net.on('sys', (m) => {
    const key = has(`mp.${m.key}`) ? `mp.${m.key}` : has(m.key) ? m.key : 'mp.sys.generic';
    appendLine('sys', '', t(key, { ...(m.vars ?? {}), text: m.key }));
  }));
  offs.push(net.on('start', (m) => {
    if (isHost || started || closed) return;
    started = true;
    beginRun(m.mode, m.seed, m.cfg);
  }));
  offs.push(net.on('kick', (m) => {
    if (closed) return;
    closed = true;
    app.net.leave(m.reason ?? 'kicked');
    void app.go('menu', { toast: t('mp.lobby.kicked') });
  }));
  offs.push(net.on('close', (m) => {
    if (closed) return;
    closed = true;
    const key = m.reason === 'hostQuit' ? 'mp.close.hostQuit' : m.reason === 'error' ? 'mp.close.error' : 'mp.close.hostLeft';
    void app.go('menu', { toast: t(key) });
  }));

  refresh();
  appendLine('sys', '', t('mp.sys.joined', { name: nameOf(net.selfId) }));

  return {
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
    },
  };
}
