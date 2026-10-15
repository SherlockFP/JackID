/**
 * Overpay choice UI (director D3, Wave 65): the "choose 1 of N" charm pick that an overshoot tier queues at Dawn. The run holds
 * the queue (`run.overpayOffer()`, head first, with the 30 s auto-pick timer). This module shows the head as a card panel like the
 * Starter Draft: 1 / 2 / 3 or a click takes a charm, and the countdown is the offer's own `left`. A full charm board refuses the
 * pick; the panel says so and stays open. The panel waits while another modal is up (the Starter Draft, the Night Cards, any
 * `modalPanel`) or a cutscene or the Night title card plays, and closes once the queue is empty. The run has no bus event for the
 * queue, so the UI ticker polls it. `mountOverpayUi(run)` is the one call the session makes per Debt Run. The returned disposer
 * closes the panel; a session that ends (the session clears `app.run`) closes it on the next tick.
 */
import './overpay.css';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { addTicker, h, modalPanel, uiSfx } from '@/core/ui/widgets';
import type { DebtRun, OverpayOffer } from './run';

const PANEL = 'overpay-pick';
/** Keys that take a card, by card index. */
const KEYS = ['1', '2', '3'];
/** Longest a title card may hold the panel (seconds of its own time). */
const CARD_HOLD_CAP_SEC = 8;
/** The Night title card (a ui banner in the banner layer) is on screen: read from the DOM, as draft.ui.ts does. */
const titleCardUp = (): boolean => typeof document !== 'undefined' && document.querySelector('.px-bwl .px-bw') !== null;
/** Another modal panel than `own` is on screen (`modalPanel` marks each one with `data-modal="1"`). */
const otherModalUp = (own: HTMLElement | null): boolean => {
  if (typeof document === 'undefined') return false;
  for (const el of document.querySelectorAll<HTMLElement>('[data-modal="1"]')) if (el !== own) return true;
  return false;
};
/** The candidate ids of an offer: tells a new offer from the one on screen. */
const keyOf = (o: OverpayOffer): string => o.candidates.map((d) => d.id).join('|');

export function mountOverpayUi(run: DebtRun): () => void {
  let alive = true;
  /** The candidate key of the offer on screen; '' while the panel is closed. */
  let shown = '';
  let root: HTMLElement | null = null;
  let timerEl: HTMLElement | null = null;
  let lastTimer = '';

  const close = (): void => {
    shown = '';
    root = null;
    timerEl = null;
    app.ui.closePanel(PANEL);
  };

  const open = (o: OverpayOffer): void => {
    shown = keyOf(o);
    lastTimer = '';
    app.ui.panel(PANEL, (host) => {
      const el = h('div', 'op-root', host);
      modalPanel(el, { escClose: false, dim: true });   // no Esc: a charm must be taken (the auto-pick is the fallback)
      root = el;
      const box = h('div', 'op-box', el);
      h('h2', 'op-title', box, t('overpay.title'));
      h('p', 'op-hint', box, t('overpay.hint'));
      const row = h('div', 'op-row', box);
      const ids = o.candidates.map((d) => d.id);
      const status = h('div', 'op-status', box, '');
      const take = (i: number): void => {
        const id = ids[i];
        if (!id) return;
        if (run.pickOverpay(id)) {
          uiSfx('purchase', 0.6);
          close();   // the next queued offer, if any, reopens on the next tick
          return;
        }
        uiSfx('buzzer', 0.4);
        status.textContent = t('overpay.full');
      };
      const cards = o.candidates.map((def, i) => {
        const card = h('button', `op-card op-tier-${def.rarity}`, row);
        card.type = 'button';
        h('span', 'op-key', card, KEYS[i] ?? '');
        h('span', 'op-tag', card, t(`overpay.rarity.${def.rarity}`));
        h('span', 'op-name', card, t(`charm.${def.id}.name`));
        h('span', 'op-desc', card, t(`charm.${def.id}.desc`));
        h('span', 'op-take', card, t('overpay.take'));
        card.addEventListener('click', () => take(i));
        return card;
      });
      timerEl = h('div', 'op-timer', box, '');
      const onKey = (e: KeyboardEvent): void => {
        const i = KEYS.indexOf(e.key);
        if (i < 0 || i >= cards.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        take(i);
      };
      // The veil owns its keys: 1-3 take a card while it is open, whatever has focus (a capture listener runs before the game's own).
      window.addEventListener('keydown', onKey, true);
      cards[0]?.focus({ preventScroll: true });
      return () => { window.removeEventListener('keydown', onKey, true); };
    });
  };

  // The queue is polled on the UI ticker (frame time, no timer of its own). The panel opens for the head offer only when no other
  // modal is up; while it waits the offer keeps its place and its timer runs on, so the auto-pick stays the fallback.
  // A title card holds the panel for at most CARD_HOLD_CAP_SEC of its own time (as the Starter Draft does): a banner that never
  // dissolves (the fixed QA clock) must not stall the offer.
  let cardHeld = 0;
  addTicker((dt) => {
    if (!alive || app.run !== run) { close(); return false; }   // disposed, or the Debt Run ended (the session cleared app.run)
    const o = run.overpayOffer();
    const card = titleCardUp();
    cardHeld = card ? cardHeld + dt : 0;
    const blocked = !o || o.candidates.length === 0
      || run.starterDraft() !== null || run.nightCardOffer() !== null
      || Boolean(app.cutscene.playing) || (card && cardHeld < CARD_HOLD_CAP_SEC) || otherModalUp(root);
    if (!o || blocked) {
      if (shown) close();
      return true;
    }
    if (keyOf(o) !== shown || !root?.isConnected) open(o);
    if (timerEl) {
      const text = t('overpay.timer', { s: Math.max(0, Math.ceil(o.left)) });
      if (text !== lastTimer) { lastTimer = text; timerEl.textContent = text; }
    }
    return true;
  });

  return () => {
    alive = false;
    close();
  };
}
