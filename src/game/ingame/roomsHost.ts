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
import { BOILER, LOCKER, buyPrice, isKeyringWing, wingState, bindWingSource } from '@/game/rooms';
import { chairVisible } from '@/world/rooms/logic';
import { createRng } from '@/core/rng';
import { charmDef } from '@/game/charms/engine';
import { NOTES, notesInZone } from '@/game/story/notes.data';
import { onNoteRead, openNote, setJournalLine } from '@/game/story/notes';
import { ledgerLine } from '@/game/story/quests';
import { holdForStory } from '@/game/story';
import { holdClockFor } from '@/game/clockHold';

const wingName = (z: string): string => t(`rooms.wing.${z}.name`);
const LINE_S = 3.2;

/** Payout multiplier the Boiler's pressure gives (mirrors `boilerEffects`). */
const boilerMult = (p: number): number => Math.min(BOILER.maxPayoutMult, 1 + Math.max(0, p) / 100);

export function startRoomsHost(run: DebtRun, world: WorldHost): () => void {
  const ui = app.ui as UIOverlayX;
  const offs: Array<() => void> = [];

  // ── the Collector's question (Parlour, Nights 3–7): one answered question per Night ──────────────
  let askedNight = -1;
  let asking = false;
  const collectorStatus = (): 'off' | 'ready' | 'done' => {
    const n = run.night();
    if (!chairVisible(n) || !run.tycoon.state().zones.includes('parlour')) return 'off';
    return askedNight === n ? 'done' : 'ready';
  };
  /** Right answer: the Collector buys one of your charms at 2x its sell value (Obols). Wrong: one Ticket goes to him. */
  const askCollector = async (): Promise<void> => {
    if (asking || app.run !== run) return;
    const status = collectorStatus();
    if (status === 'off') return;
    if (status === 'done') { ui.toast(t('roomsx.collector.done'), 'info'); return; }
    asking = true;
    try {
      const night = run.night();
      // the right answer's place is seeded per run and Night; the two wrong ones keep their order
      const rng = createRng(`rooms:collector:${run.seed}:${night}`);
      const correct = rng.int(0, 2);
      const wrongs = ['roomsx.collector.a0', 'roomsx.collector.a2'];
      const options = [0, 1, 2].map((i) => (i === correct ? 'roomsx.collector.a1' : wrongs.shift() as string));
      const pick = await ui.choice(t('roomsx.collector.q'), options.map((k) => t(k)), { timeout: 25 });
      if (app.run !== run) return;
      if (pick < 0) { ui.toast(t('roomsx.collector.timeout'), 'info'); return; }   // no answer: the question is not spent
      if (pick !== correct) {
        askedNight = night;
        if (run.spend('ticket', 1, 'collector:wrong')) ui.toast(t('roomsx.collector.wrong'), 'bad', 4);
        else ui.toast(t('roomsx.collector.wrongNone'), 'warn', 4);
        return;
      }
      const sellable = run.charms().filter((c) => charmDef(c.id)?.rarity !== 'cursed');
      if (sellable.length === 0) { ui.toast(t('roomsx.collector.none'), 'warn', 4); return; }   // nothing to sell: not spent
      askedNight = night;
      const i = await ui.choice(t('roomsx.collector.offer'), sellable.map((c) => t(`charm.${c.id}.name`)), { timeout: 25 });
      if (app.run !== run) return;
      if (i < 0) { ui.toast(t('roomsx.collector.timeout'), 'info'); return; }
      const sold = sellable[i];
      const before = run.balance('obol');
      if (run.collectorBuy(sold.id)) {
        ui.toast(t('roomsx.collector.bought', { charm: t(`charm.${sold.id}.name`), obols: String(run.balance('obol') - before) }), 'good', 4);
      } else {
        ui.toast(t('roomsx.collector.refused'), 'warn', 4);
      }
    } finally {
      asking = false;
    }
  };

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
    buyPrice: (w) => (isKeyringWing(w) ? buyPrice(run.shift.quota().due) : null),
    collectorStatus: () => collectorStatus(),
    askCollector: () => { void askCollector(); },
  });
  offs.push(() => setRoomsBridge({
    wingState: () => 'sealed', keys: () => 0, night: () => 1, sendZone: () => undefined, openLocker: () => undefined,
    pressure: () => 0, vent: () => undefined, readLedger: undefined,
    buyPrice: () => null, collectorStatus: () => 'off', askCollector: () => undefined,
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
  // each locker past the third adds Dread, but the warning shows once per Night (it used to stack five times)
  let dreadToastNight = -1;
  offs.push(bus.on('room:locker', () => {
    if (run.rooms.lockers.length <= LOCKER.dreadAfter || dreadToastNight === run.night()) return;
    dreadToastNight = run.night();
    ui.toast(t('rooms.locker.dread'), 'warn', 3.5);
  }));
  // Soul Marks (wave 25): a lost Mark and the BLANK card
  offs.push(bus.on('duel:marks', ({ left, lost, blank }) => {
    if (!lost) return;
    ui.toast(t(blank ? 'duelrun.marks.blank' : 'duelrun.marks.lost', { n: String(left) }), 'bad', 4);
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

  // ── the Wash ledger (quest 1, story/quests.ts): each page read counts here; the locker pick opens once the ledger is whole ──
  const syncLedgerLine = (): void => {
    const l = ledgerLine(run.rooms.ledger);
    setJournalLine(l ? t('quest.ledger.objective', { n: l.n, total: l.total }) : null);
  };
  let ledgerAsking = false;
  const askLedgerPick = async (): Promise<void> => {
    if (ledgerAsking || app.run !== run) return;
    const offer = run.ledgerOffer();
    if (offer.length === 0) return;
    ledgerAsking = true;
    try {
      const i = await ui.choice(t('quest.ledger.lockerOpen'), offer.map((id) => t(`charm.${id}.name`)));
      if (app.run !== run || i < 0) return;
      const pick = offer[i];
      if (!run.ledgerClaim(pick)) { ui.toast(t('quest.ledger.full'), 'warn', 4); return; }
      ui.toast(t('quest.ledger.claimed', { charm: t(`charm.${pick}.name`) }), 'good', 4);
      syncLedgerLine();
      ui.subtitle(t('quest.ledger.story'), '', 6);
    } finally {
      ledgerAsking = false;
    }
  };
  offs.push(onNoteRead((id) => {
    if (app.run !== run) return;
    const r = run.readLedgerNote(id);
    if (!r.fresh) return;   // a repeat read, or a note outside the ledger
    syncLedgerLine();
    ui.toast(t('quest.ledger.toast', { n: r.n, total: r.total, title: t(`story.note.${id}.t`) }), 'good', 4);
    if (!r.completed) return;
    ui.toast(t('quest.ledger.complete'), 'good', 5);
    void holdForStory().then(() => askLedgerPick());
  }));
  syncLedgerLine();
  // a resumed save with the ledger whole and unclaimed opens the locker pick again
  if (run.ledgerOffer().length > 0) void holdForStory().then(() => askLedgerPick());
  offs.push(() => setJournalLine(null));

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
