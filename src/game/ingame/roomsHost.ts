/**
 * Special rooms, host side (WAVE 24 integrator): the one place that joins the world's room dressing (`world/rooms` bridge),
 * the run (`wingKeys`, Boiler, lockers, Back Office) and the screen (toasts, the pressure chip, the locker note, Mira's call).
 * `startRoomsHost(run, world)` returns the disposer for the session.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import type { DebtRun } from '@/game/run';
import type { WorldHost } from '@/world/world';
import { setRoomsBridge, type WingId } from '@/world/rooms';
import { BOILER, LOCKER, buyPrice, wingState, bindWingSource } from '@/game/rooms';
import { NOTES, notesInZone } from '@/game/story/notes.data';
import { openNote } from '@/game/story/notes';
import { holdForStory } from '@/game/story';
import { holdClockFor } from '@/game/clockHold';

const wingName = (z: string): string => t(`rooms.wing.${z}.name`);
const LINE_S = 3.2;

/** Payout multiplier the Boiler's pressure gives (mirrors `boilerEffects`). */
const boilerMult = (p: number): number => Math.min(BOILER.maxPayoutMult, 1 + Math.max(0, p) / 100);

export function startRoomsHost(run: DebtRun, world: WorldHost): () => void {
  const ui = app.ui as UIOverlayX;
  const offs: Array<() => void> = [];

  // ── the world's seam ───────────────────────────────────────────────────────────────────────────
  setRoomsBridge({
    wingState: (w) => wingState(w),
    keys: () => run.wingKeys,
    night: () => run.night(),
    sendZone: (w: WingId, key: boolean) => {
      if (key && w !== 'counting' && run.wingKeys < 1) { ui.toast(t('roomsx.noKey'), 'warn'); return; }
      if (!run.tycoon.unlockZone(w, key)) {
        if (key) ui.toast(t('roomsx.locked'), 'warn');
        else ui.toast(t('roomsx.noFunds', { p: String(buyPrice(run.shift.quota().due)) }), 'warn');
      }
    },
    openLocker: (n) => {
      const r = run.openLocker(n);
      if (!r.ok) {
        if (r.reason === 'used') ui.toast(t('rooms.locker.used', { n: String(n) }), 'warn');
        else if (r.reason === 'tickets') ui.toast(t('rooms.locker.noTicket', { n: String(n) }), 'warn');
      }
    },
    pressure: () => run.rooms.p,
    vent: () => {
      if (run.rooms.p <= 0) { ui.toast(t('roomsx.ventNone'), 'info'); return; }
      if (run.ventBoiler()) ui.toast(t('rooms.boiler.vent'), 'good');
      else ui.toast(t('roomsx.ventFail'), 'warn');
    },
    readLedger: () => {
      const b = run.backOffice();
      if (b.obols > 0) ui.toast(t('rooms.backOffice.paid', { obols: String(b.obols), tickets: String(b.tickets) }), 'good');
      else ui.toast(t('roomsx.office.none'), 'warn');
    },
  });
  offs.push(() => setRoomsBridge({
    wingState: () => 'sealed', keys: () => 0, night: () => 1, sendZone: () => undefined, openLocker: () => undefined,
    pressure: () => 0, vent: () => undefined, readLedger: undefined,
  }));
  offs.push(() => bindWingSource(null));

  // ── toasts ─────────────────────────────────────────────────────────────────────────────────────
  offs.push(bus.on('room:keys', ({ n, why }) => {
    ui.toast(t(`roomsx.keys.${why === 'boss' ? 'boss' : why === 'manager' ? 'manager' : 'dawn'}`, { n: String(n) }), 'good', 4);
  }));
  offs.push(bus.on('room:opened', ({ zone }) => {
    ui.toast(t('roomsx.opened', { wing: wingName(zone) }), 'good', 3.5);
  }));
  offs.push(bus.on('room:blown', () => ui.toast(t('roomsx.blown'), 'bad', 4)));
  offs.push(bus.on('room:locker', ({ n, result }) => {
    const N = String(n);
    if (result.k === 'coins') ui.toast(t('rooms.locker.coins', { n: N, n2: String(result.n) }), 'good');
    else if (result.k === 'blank') ui.toast(t('rooms.locker.blank', { n: N, obols: String(result.obols) }), 'warn');
    else if (result.k === 'charm') ui.toast(t('rooms.locker.charm', { n: N, charm: t(`charm.${result.id}.name`) }), 'good');
    else {
      ui.toast(t('rooms.locker.note', { n: N }), 'info');
      // the note comes out of the Wash pool (n17 to n19), after any scene that is playing has finished
      const pool = notesInZone('laundry');
      const def = pool.length ? pool[(n + run.night()) % pool.length] : NOTES.find((d) => d.zone === 'laundry');
      if (def) void holdForStory().then(() => { if (app.run === run) openNote(def); });
    }
  }));
  offs.push(bus.on('room:locker', () => {
    if (run.rooms.lockers.length > LOCKER.dreadAfter) ui.toast(t('rooms.locker.dread'), 'warn', 3.5);
  }));

  // ── Mira's wrong-number call: her lines play as subtitles over the pickup ──────────────────────────
  offs.push(bus.on('phone:story', ({ lines, speaker }) => {
    lines.forEach((k, i) => {
      app.timers.ui.after(i * LINE_S, () => {
        if (app.run !== run) return;
        ui.subtitle(t(k), t(speaker), LINE_S);
      });
    });
    holdClockFor('miraCall', lines.length * LINE_S);
  }));

  // ── the Boiler pressure chip (HUD): shown while the Boiler is open ──────────────────────────────────
  const chip = document.createElement('div');
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'off');
  Object.assign(chip.style, {
    position: 'absolute', right: 'calc(4 * var(--u, 3px))', top: '22%', boxSizing: 'border-box',
    padding: 'calc(2 * var(--u, 3px)) calc(4 * var(--u, 3px))', background: 'rgba(8, 6, 4, 0.74)',
    border: 'calc(1 * var(--u, 3px)) solid var(--amber, #e69431)', color: 'var(--ivory, #e6dec5)',
    fontFamily: 'var(--f-head, monospace)', fontSize: 'calc(5 * var(--u, 3px))', lineHeight: '1.3',
    pointerEvents: 'none', display: 'none', zIndex: '4',
  } satisfies Partial<CSSStyleDeclaration>);
  ui.hudLayer.appendChild(chip);
  let chipKey = '';
  const syncChip = (): void => {
    const open = run.tycoon.state().zones.includes('boiler');
    const r = run.rooms;
    const key = open ? `${r.p}|${r.blown ? 1 : 0}` : '';
    if (key === chipKey) return;
    chipKey = key;
    if (!open) { chip.style.display = 'none'; return; }
    chip.style.display = 'block';
    chip.textContent = r.blown ? t('roomsx.chipBlown') : t('roomsx.chip', { p: String(Math.round(r.p)), m: boilerMult(r.p).toFixed(2) });
    const hot = r.blown ? '#ff4a3a' : r.p >= 70 ? '#ff7a3a' : r.p >= 40 ? '#e6a431' : '#e6dec5';
    chip.style.borderColor = hot;
    chip.style.color = hot;
  };
  offs.push(run.tycoon.onChange(syncChip));
  offs.push(bus.on('room:blown', syncChip));
  offs.push(bus.on('room:pressure', syncChip));
  offs.push(bus.on('room:opened', syncChip));
  syncChip();
  offs.push(() => chip.remove());

  void world;
  return () => { for (const off of offs.splice(0)) off(); };
}
