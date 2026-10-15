/**
 * Night Cards UI (director): the two-card offer at each Dawn, and the HUD chip of the card in play. `mountNightCardsUi(run)` is
 * called once per fresh solo Debt Run, next to the Starter Draft. A card takes 1 / 2 or a click; the run's `run:nightcard` event
 * closes the panel (picked, or auto-picked when the 20 s run out). The returned disposer closes the panel and removes the chip.
 * Rules and the deck live in `nightCards.ts`; the run holds the offer and the kept card.
 */
import './nightCards.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { Unsub } from '@/core/types';
import { lang, t } from '@/core/i18n';
import { addTicker, h, modalPanel } from '@/core/ui/widgets';
import type { DebtRun } from './run';
import { nightCardPreview } from './nightCards';

const PANEL = 'night-cards';
/** Keys that take a card, by card index. */
const KEYS = ['1', '2'];

/** The numbers of one preview line: a multiplier takes the language's decimal mark (1.3 / 1,3). */
function previewVars(vars: Record<string, number>): Record<string, string | number> {
  const comma = lang() === 'tr';
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = k === 'x' ? String(v).replace('.', comma ? ',' : '.') : v;
  return out;
}

export function mountNightCardsUi(run: DebtRun): () => void {
  run.setNightCardGate(true);   // the lever now waits for a pick or this panel's timer
  const chip = h('div', 'nc-chip', document.body);
  chip.hidden = true;
  const refreshChip = (): void => {
    const c = run.nightCard();
    chip.hidden = !c;
    if (c) chip.textContent = t('nightcard.chip', { name: t(`nightcard.${c.id}.name`) });
  };
  const offs: Unsub[] = [];
  offs.push(bus.on('run:nightcard', (e) => {
    if (e.pid !== run.selfId) return;
    if (e.state === 'offer') { showCards(run); return; }
    app.ui.closePanel(PANEL);
    refreshChip();
  }));
  refreshChip();
  if (run.nightCardOffer()) showCards(run);
  return () => {
    app.ui.closePanel(PANEL);
    for (const off of offs.splice(0)) off();
    chip.remove();
  };
}

/** The card panel: modal (the veil blocks the walk), no Esc (a card must be kept), keys 1-2 captured before the game sees them. */
function showCards(run: DebtRun): void {
  const offer = run.nightCardOffer();
  if (!offer) return;
  const ids = offer.candidates.map((d) => d.id);
  const take = (i: number): void => {
    const id = ids[i];
    if (id) run.pickNightCard(id);
  };
  app.ui.panel(PANEL, (host) => {
    const root = h('div', 'nc-root', host);
    modalPanel(root, { escClose: false, dim: true });
    const box = h('div', 'nc-box', root);
    h('h2', 'nc-title', box, t('nightcard.title'));
    h('p', 'nc-hint', box, t('nightcard.hint'));
    const row = h('div', 'nc-row', box);
    const cards = offer.candidates.map((def, i) => {
      const card = h('button', `nc-card nc-${def.tone}`, row);
      card.type = 'button';
      h('span', 'nc-key', card, KEYS[i] ?? '');
      h('span', 'nc-tone', card, t(`nightcard.tone.${def.tone}`));
      h('span', 'nc-name', card, t(`nightcard.${def.id}.name`));
      h('span', 'nc-desc', card, t(`nightcard.${def.id}.desc`));
      // The concrete result for the coming Night (exact quota and Watches before → after, the payout multiplier, …).
      const prev = nightCardPreview(def, offer.night, (m) => run.nextQuotaPreview(m)?.due ?? null).map((p) => t(`nightcard.prev.${p.key}`, previewVars(p.vars)));
      h('span', 'nc-prev', card, prev.join(' · '));
      h('span', 'nc-take', card, t('nightcard.take'));
      card.addEventListener('click', () => take(i));
      return card;
    });
    const timer = h('div', 'nc-timer', box, '');
    let alive = true;
    // The countdown rides the UI ticker (frame time, no timer of its own); it stops with the panel.
    addTicker(() => {
      if (!alive) return false;
      timer.textContent = t('nightcard.timer', { s: Math.max(0, Math.ceil(run.nightCardOffer()?.left ?? 0)) });
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
    };
  });
}
