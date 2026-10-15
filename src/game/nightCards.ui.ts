/**
 * Night Cards UI (director): the two-card offer at each Dawn, the Dawn receipt (last Night's settlement, counted up in the modal's
 * head), and the HUD chip of the card in play. `mountNightCardsUi(run)` is called once per fresh solo Debt Run, next to the Starter
 * Draft. A card takes 1 / 2 or a click; the run's `run:nightcard` event closes the panel (picked, or auto-picked with the SAFE card
 * when the 20 s run out, which a toast names). While the panel is open, new toasts wait behind it (`holdToasts`). The returned
 * disposer closes the panel and removes the chip. Rules and the deck live in `nightCards.ts`; the run holds the offer and the kept card.
 *
 * Juice (wave 7): the cards deal in 120 ms apart with the flip sound. A pick scales the chosen card up with a gold flash, fades the
 * others, and flies the card to the chip; the panel closes when it lands. Calm mutes the flash, reduced motion drops the motion (the
 * sounds stay). Nothing here starts a timer of its own: the ticker is the UI frame, and the flight runs on the Web Animations API.
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
/** The deal: each card lands this long after the one before it (sound and motion). */
const DEAL_GAP_S = 0.12;
/** A pick: the chosen card's gold rise runs for PICK_RISE_MS; the card flies to the chip from PICK_FLY_S; the panel closes at PICK_DONE_S. */
const PICK_RISE_MS = 220;
const PICK_FLY_S = 0.3;
const PICK_FLY_MS = 500;
const PICK_DONE_S = 0.85;

/** The open card panel takes a pick as the flight (set while the panel is up; null otherwise). Returns false when it cannot. */
let activePick: ((card: string) => boolean) | null = null;

const calmOn = (): boolean => !!app?.save?.data?.settings?.calm;
const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
    if (e.state === 'offer') { showCards(run, book, chip, refreshChip); return; }
    // A pick flies its card to the chip, and the panel closes when it lands (activePick). Any other state closes at once.
    if (e.state === 'picked' && e.card && activePick?.(e.card)) return;
    app.ui.closePanel(PANEL);   // the held toasts show now
    refreshChip();
    // A warning kind: the auto-pick is news the player must see now, so it takes a toast slot ahead of the news in line.
    if (e.state === 'auto' && e.card) ui.toast(t('nightcard.timeout', { card: t(`nightcard.${e.card}.name`) }), 'warn', 3);
  }));
  refreshChip();
  if (run.nightCardOffer()) showCards(run, book, chip, refreshChip);
  return () => {
    app.ui.closePanel(PANEL);
    for (const off of offs.splice(0)) off();
    chip.remove();
  };
}

/** The card panel: modal (the veil blocks the walk), no Esc (a card must be kept), keys 1-2 captured before the game sees them. */
function showCards(run: DebtRun, book: TitheBook, chip: HTMLElement, refreshChip: () => void): void {
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
  const reduce = reduceMotion();
  const calm = calmOn();
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
    // The deal: each card lands DEAL_GAP_S after the one before it. The motion is on the Web Animations API (delayed, no timer of its own).
    if (!reduce) {
      cards.forEach((card, i) => {
        card.animate([
          { opacity: 0, transform: 'translateY(-12%) scale(.8)' },
          { opacity: 1, transform: 'translateY(0) scale(1.05)', offset: 0.7 },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ], { duration: 260, delay: i * DEAL_GAP_S * 1000, fill: 'backwards', easing: 'ease-out' });
      });
    }
    const dealt = cards.map(() => false);
    let dealT = 0;
    // The pick flight, once a card is chosen: null while the offer is open.
    let pick: { idx: number; t: number; flown: boolean; ghost: HTMLElement | null; target: { x: number; y: number } } | null = null;
    /** Chooses a card: the chosen one rises gold, the others fade, and the flight to the chip starts at PICK_FLY_S. */
    const startPick = (idx: number): boolean => {
      if (pick) return true;   // a second pick while the first flies is ignored (the panel closes on its own)
      const chosen = cards[idx];
      if (!chosen) return false;
      pick = { idx, t: 0, flown: false, ghost: null, target: { x: 0, y: 0 } };
      chosen.classList.add('nc-picked');
      if (!reduce) chosen.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: PICK_RISE_MS, fill: 'forwards', easing: 'ease-out' });
      cards.forEach((c, j) => {
        if (j === idx) return;
        if (reduce) c.style.opacity = '0';
        else c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
      });
      if (!calm) app.fx.flash(0xffd34a, 0.3, 0.25);   // the gold flash (fx.flash honours reduced flashing)
      uiSfx('chime', 0.8);
      return true;
    };
    /** The chosen card flies to its chip: the chip's place is measured while it is shown (the kept card is set by now), then it hides. */
    const flyChosen = (p: NonNullable<typeof pick>): void => {
      refreshChip();
      const cr = chip.getBoundingClientRect();
      chip.hidden = true;
      p.target = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 };
      const card = cards[p.idx];
      if (!card || reduce) return;
      const r = card.getBoundingClientRect();
      const g = card.cloneNode(true) as HTMLElement;
      g.classList.add('nc-ghost');
      g.style.left = `${r.left}px`; g.style.top = `${r.top}px`; g.style.width = `${r.width}px`; g.style.height = `${r.height}px`;
      app.ui.root.appendChild(g);
      const dx = p.target.x - (r.left + r.width / 2), dy = p.target.y - (r.top + r.height / 2);
      g.animate([
        { transform: 'translate(0, 0) scale(1.08)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0.4 },
      ], { duration: PICK_FLY_MS, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      p.ghost = g;
    };
    /** The chip lands: it shows, pops, and the panel closes. */
    const landPick = (p: NonNullable<typeof pick>): void => {
      p.ghost?.remove();
      p.ghost = null;
      refreshChip();
      if (!chip.hidden && !reduce) chip.animate([
        { transform: 'translateX(-50%) skewX(-8deg) scale(1.5)' },
        { transform: 'translateX(-50%) skewX(-8deg) scale(1)' },
      ], { duration: 220, easing: 'ease-out' });
      app.ui.closePanel(PANEL);
    };
    const pickFromEvent = (card: string): boolean => {
      const idx = ids.findIndex((id) => id === card);
      return idx >= 0 && startPick(idx);
    };
    activePick = pickFromEvent;
    // The countdown rides the UI ticker (frame time, no timer of its own); it stops with the panel. The deal sound and the pick flight ride it too.
    addTicker((dt) => {
      if (!alive) return false;
      if (!pick) {
        dealT += dt;
        cards.forEach((_, i) => { if (!dealt[i] && dealT >= i * DEAL_GAP_S) { dealt[i] = true; uiSfx('cardFlip', 0.8); } });
      } else {
        pick.t += dt;
        if (!pick.flown && pick.t >= PICK_FLY_S) { pick.flown = true; flyChosen(pick); }
        if (pick.t >= PICK_DONE_S) { const p = pick; pick = null; landPick(p); return false; }
        return undefined;   // the countdown freezes while the card flies (the offer is already taken)
      }
      const left = Math.max(0, run.nightCardOffer()?.left ?? 0);
      timerTxt.textContent = t('nightcard.timer', { s: Math.ceil(left) });
      timer.classList.toggle('nc-pulse', left > 0 && left <= PULSE_LAST_SEC);
      fill.style.width = `${Math.min(100, (left / NIGHT_CARD_TIMEOUT_SEC) * 100)}%`;
      return undefined;
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
      pick?.ghost?.remove();
      if (activePick === pickFromEvent) activePick = null;
      ui.holdToasts(false);   // the news held behind the panel shows now
    };
  });
}
