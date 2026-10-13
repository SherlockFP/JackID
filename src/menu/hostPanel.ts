/**
 * Host form (GDD §7.6, §9.6): room name, mode (co-op / versus / free), max players 2–8, optional password, and visibility
 * (public / friends-only / same-browser tabs). OPEN THE LIFT opens the room and enters the party lobby as host.
 */
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import type { GameMode } from '@/core/types';
import type { HostOptions } from '@/net/types';
import { button, cycle, field, focusFirst, frame, h, modalPanel, textField } from '@/core/ui/widgets';
import { MP_MAX_MAX, MP_MAX_MIN, MP_MODES, ROOM_NAME_MAX } from './mp/config';
import { enterLobby } from './mp/nav';
import './mp/mp.css';

export const HOST_PANEL = 'mp-host';
type Vis = 'public' | 'friends' | 'tab';

/** Open the host form over the server browser. Hosting closes every MP panel and enters the lobby as host. */
export function openHostPanel(): void {
  app.ui.panel(HOST_PANEL, (el) => buildHost(el));
}

/** Visibility → host options: friends-only rooms are hidden from the browser, same-browser rooms only show to tabs. */
export function visibilityOptions(v: Vis): Pick<HostOptions, 'public' | 'friendsOnly'> {
  if (v === 'public') return { public: true, friendsOnly: false };
  if (v === 'friends') return { public: false, friendsOnly: true };
  return { public: false, friendsOnly: false };
}

function buildHost(el: HTMLElement): void {
  modalPanel(el, { escClose: true, dim: true });
  el.dataset.panel = HOST_PANEL;
  el.classList.add('mp-wide');
  const f = frame(el, { title: t('mp.host.title'), variant: 'brass' });
  const who = app.save.data.profile.name || 'JackID';

  const name = textField(f.body, { value: who, maxLength: ROOM_NAME_MAX });
  field(f.body, t('mp.host.name'), name.el);

  const mode = cycle<GameMode>(f.body, {
    options: MP_MODES.map((m) => ({ value: m, label: t(`mp.mode.${m}`) })),
    value: 'coop',
  });
  field(f.body, t('mp.host.mode'), mode.el);

  const max = cycle<number>(f.body, {
    options: Array.from({ length: MP_MAX_MAX - MP_MAX_MIN + 1 }, (_, i) => ({ value: MP_MAX_MIN + i, label: String(MP_MAX_MIN + i) })),
    value: 4,
  });
  field(f.body, t('mp.host.max'), max.el);

  const pw = textField(f.body, { password: true, maxLength: 32, placeholder: t('mp.host.password') });
  field(f.body, t('mp.host.password'), pw.el);

  const vis = cycle<Vis>(f.body, {
    options: [
      { value: 'public', label: t('mp.host.vis.public') },
      { value: 'friends', label: t('mp.host.vis.friends') },
      { value: 'tab', label: t('mp.host.vis.tab') },
    ],
    value: 'public',
  });
  field(f.body, t('mp.host.vis'), vis.el);

  const err = h('div', 'mp-err', f.body);
  h('p', 'mp-hint', f.body, t('mp.host.hint'));

  let busy = false;
  const go = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    err.textContent = '';
    const opts: HostOptions = {
      name: name.value.trim().slice(0, ROOM_NAME_MAX) || who,
      mode: mode.value,
      max: max.value,
      public: visibilityOptions(vis.value).public,
      lateJoin: true,
      friendsOnly: visibilityOptions(vis.value).friendsOnly,
      ...(pw.value ? { password: pw.value } : {}),
    };
    try {
      await app.net.host(opts);
      enterLobby('host');
    } catch (e) {
      busy = false;
      err.textContent = t('mp.host.failed', { msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const bar = h('div', 'mp-row', f.body);
  button(bar, { label: t('mp.host.start'), kind: 'primary', onClick: () => { void go(); } });
  button(bar, { label: t('mp.browser.back'), kind: 'ghost', onClick: () => { app.ui.closePanel(HOST_PANEL); } });
  focusFirst(el);
}

