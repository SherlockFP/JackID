/**
 * Night Cards UI (director): the two-card offer at each Dawn, the Dawn receipt (last Night's settlement, counted up in the modal's
 * head), and the HUD chip of the card in play. `mountNightCardsUi(run)` is called once per fresh solo Debt Run, next to the Starter
 * Draft. A card takes 1 / 2 or a click; the run's `run:nightcard` event closes the panel (picked, or auto-picked with the SAFE card
 * when the 20 s run out, which a toast names). While the panel is open, new toasts wait behind it (`holdToasts`). The returned
 * disposer closes the panel and removes the chip. Rules and the deck live in `nightCards.ts`; the run holds the offer and the kept card.
 */
import './nightCards.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { Unsub } from '@/core/types';
import { fmtCoins, lang, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { addTicker, h, modalPanel, uiSfx } from '@/core/ui/widgets';
import * as registry from '@/machines/_base/registry';
import type { DebtRun } from './run';
import { NIGHT_CARD_TIMEOUT_SEC, nightCardPreview } from './nightCards';

const PANEL = 'night-cards';
/** Keys that take a card, by card index. */
const KEYS = ['1', '2'];
/** The receipt's count-up, in UI seconds. */
const RECEIPT_SEC = 1.5;
/** The timer pulses in its last this-many seconds. */
const PULSE_LAST_SEC = 5;

/** Unpaid tithe booked since the last Dawn receipt: the `run:tithe` shortfalls of the missed Watches. */
interface TitheBook { unpaid: number }

/** The numbers of one preview line: a multiplier takes the language's decimal mark (1.3 / 1,3). */
function previewVars(vars: Record<string, number>): Record<string, string | number> {
  const comma = lang() === 'tr';
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = k === 'x' ? String(v).replace('.', comma ? ',' : '.') : v;
  return out;
}

/** The cheapest minimum bet on the floor (any machine that takes a stake); HIGH TABLE doubles it for the pocket line. */
function cheapestBet(): number {
  let min = Number.POSITIVE_INFINITY;
  for (const m of registry.all()) {
    const b = m.def.minBet;
    if (b > 0 && b < min) min = b;
  }
  return Number.isFinite(min) ? min : 1;
}

export function mountNightCardsUi(run: DebtRun): () => void {
  run.setNightCardGate(true);   // the lever now waits for a pick or this panel's timer
  const ui = app.ui as UIOverlayX;
  const book: TitheBook = { unpaid: 0 };
  const chip = h('div', 'nc-chip', app.ui.root);   // inside #ui so it follows the UI scale (--u)
  chip.hidden = true;
  const refreshChip = (): void => {
    const c = run.nightCard();
    chip.hidden = !c;
    if (c) chip.textContent = t('nightcard.chip', { name: t(`nightcard.${c.id}.name`) });
  };
  const offs: Unsub[] = [];
  offs.push(bus.on('run:tithe', (e) => {
    if (e.pid === run.selfId && e.state === 'missed') book.unpaid += e.shortfall;
  }));
  offs.push(bus.on('run:nightcard', (e) => {
    if (e.pid !== run.selfId) return;
    if (e.state === 'offer') { showCards(run, book); return; }
    app.ui.closePanel(PANEL);   // the held toasts show now
    refreshChip();
    // A warning kind: the auto-pick is news the player must see now, so it takes a toast slot ahead of the news in line.
    if (e.state === 'auto' && e.card) ui.toast(t('nightcard.timeout', { card: t(`nightcard.${e.card}.name`) }), 'warn', 3);
  }));
  refreshChip();
  if (run.nightCardOffer()) showCards(run, book);
  return () => {
    app.ui.closePanel(PANEL);
    for (const off of offs.splice(0)) off();
    chip.remove();
  };
}

/** The card panel: modal (the veil blocks the walk), no Esc (a card must be kept), keys 1-2 captured before the game sees them. */
function showCards(run: DebtRun, book: TitheBook): void {
  const offer = run.nightCardOffer();
  if (!offer) return;
  const ui = app.ui as UIOverlayX;
  const ids = offer.candidates.map((d) => d.id);
  const take = (i: number): void => {
    const id = ids[i];
    if (id) run.pickNightCard(id);
  };
  // The receipt is the Night that just settled (the offer's Night is the next one): its quota, what it paid in (the quota plus the
  // surplus Dawn returned, `ledger.carried`), its interest and the tithes it missed. The books reset when the next Night opens.
  const books = run.nightLedger();
  const due = run.bank().due;
  const receipt = { n: offer.night, due, paid: due + books.carried, interest: books.interest, tithe: book.unpaid };
  book.unpaid = 0;
  const cheap = cheapestBet();
  app.ui.panel(PANEL, (host) => {
    ui.holdToasts(true);   // the news waits behind the panel: released by the cleanup below
    let alive = true;
    const root = h('div', 'nc-root', host);
    // The panel element itself is the modal: ui.ts counts `panel.el` as blocking (banners hold out of sight, the walk stops).
    modalPanel(host, { escClose: false, dim: true });
    const box = h('div', 'nc-box', root);
    // The Dawn receipt, on top: last Night's settlement counts up (about 1.5 s, a coin tick while it rolls).
    const rec = h('div', 'nc-receipt', box);
    h('div', 'nc-rec-title', rec, t('nightcard.receipt.title', { n: receipt.n }));
    const grid = h('div', 'nc-rec-grid', rec);
    const rows = [
      { to: receipt.due, key: 'nightcard.receipt.due' },
      { to: receipt.paid, key: 'nightcard.receipt.paid' },
      { to: receipt.interest, key: 'nightcard.receipt.interest' },
      { to: receipt.tithe, key: 'nightcard.receipt.tithe' },
    ].map((r) => {
      const line = h('div', 'nc-rec-row', grid);
      h('span', 'nc-rec-k', line, t(r.key));
      return { to: r.to, v: h('span', 'nc-rec-v', line, fmtCoins(0)) };
    });
    let rolled = 0;
    let lastStep = -1;
    addTicker((dt) => {
      if (!alive) return false;
      rolled = Math.min(RECEIPT_SEC, rolled + dt);
      const k = rolled / RECEIPT_SEC;
      const ease = 1 - Math.pow(1 - k, 3);
      for (const r of rows) r.v.textContent = fmtCoins(k >= 1 ? r.to : Math.round(r.to * ease));
      const step = Math.floor(k * 14);   // a coin tick about every 0.1 s while the numbers roll
      if (k < 1 && step !== lastStep) { lastStep = step; uiSfx('coin', 0.4); }
      return k < 1;
    });
    h('h2', 'nc-title', box, t('nightcard.title'));
    h('p', 'nc-hint', box, t('nightcard.hint'));
    // The countdown: a bar that drains over the 20 s and a number; the last 5 s pulse.
    const timer = h('div', 'nc-timer', box);
    const timerTxt = h('span', 'nc-timer-txt', timer);
    const fill = h('i', '', h('span', 'nc-timer-bar', timer));
    const row = h('div', 'nc-row', box);
    const cards = offer.candidates.map((def, i) => {
      const card = h('button', `nc-card nc-${def.tone}`, row);
      card.type = 'button';
      card.setAttribute('data-nav', '');   // Up / Down (W / S) move between the cards, as in the other panels
      h('span', 'nc-key', card, KEYS[i] ?? '');
      h('span', 'nc-tone', card, t(`nightcard.tone.${def.tone}`));
      h('span', 'nc-name', card, t(`nightcard.${def.id}.name`));
      h('span', 'nc-desc', card, t(`nightcard.${def.id}.desc`));
      // The concrete result for the coming Night (exact quota and Watches before → after, the payout multiplier, …).
      const prev = nightCardPreview(def, offer.night, (m) => run.nextQuotaPreview(m)?.due ?? null, cheap)
        .map((p) => t(`nightcard.prev.${p.key}`, previewVars(p.vars)));
      h('span', 'nc-prev', card, prev.join(' · '));
      h('span', 'nc-take', card, t('nightcard.take'));
      card.addEventListener('click', () => take(i));
      return card;
    });
    // The countdown rides the UI ticker (frame time, no timer of its own); it stops with the panel.
    addTicker(() => {
      if (!alive) return false;
      const left = Math.max(0, run.nightCardOffer()?.left ?? 0);
      timerTxt.textContent = t('nightcard.timer', { s: Math.ceil(left) });
      timer.classList.toggle('nc-pulse', left > 0 && left <= PULSE_LAST_SEC);
      fill.style.width = `${Math.min(100, (left / NIGHT_CARD_TIMEOUT_SEC) * 100)}%`;
    });
    const onKey = (e: KeyboardEvent): void => {
      const i = KEYS.indexOf(e.key);
      if (i < 0 || i >= cards.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      take(i);
    };
    // The veil owns its keys: 1-2 keep a card while it is open, whatever has focus (a capture listener runs before the game's).
    window.addEventListener('keydown', onKey, true);
    cards[0]?.focus({ preventScroll: true });
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey, true);
      ui.holdToasts(false);   // the news held behind the panel shows now
    };
  });
}
