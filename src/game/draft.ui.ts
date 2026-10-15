/**
 * Starter Draft UI (draft wave): the three-card pick before the first Bell, and the coin sound of a Settle's interest.
 * `mountDraftUi(run)` is the one call the session makes after a fresh solo Debt Run: it opens the offer on the run and shows
 * the cards. A card takes 1 / 2 / 3 or a click; the run's `run:draft` event closes the panel (picked or auto-picked). The
 * returned disposer closes it and unhooks the sound. Rules and the offer itself live in `draft.ts` and `run.ts`.
 */
import './draft.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { Unsub } from '@/core/types';
import { t } from '@/core/i18n';
import { addTicker, h, modalPanel, uiSfx } from '@/core/ui/widgets';
import type { DebtRun } from './run';
import { archetypeOf } from './draft';

const PANEL = 'starter-draft';
/** Keys that take a card, by card index. */
const KEYS = ['1', '2', '3'];

export function mountDraftUi(run: DebtRun): () => void {
  const offs: Unsub[] = [];
  // Every Settle's interest is a coin sound (the bank's work, heard as well as read).
  offs.push(bus.on('run:interest', (e) => { if (e.pid === run.selfId) uiSfx('coin', 0.8); }));
  offs.push(bus.on('run:draft', (e) => { if (e.pid === run.selfId) app.ui.closePanel(PANEL); }));
  if (run.openStarterDraft()) showCards(run);
  return () => {
    app.ui.closePanel(PANEL);
    for (const off of offs.splice(0)) off();
  };
}

/** The card panel: modal (the veil blocks the walk), no Esc (a charm must be taken), keys 1-3 captured before the game sees them. */
function showCards(run: DebtRun): void {
  const draft = run.starterDraft();
  if (!draft) return;
  const ids = draft.candidates.map((d) => d.id);
  const take = (i: number): void => {
    const id = ids[i];
    if (id) run.pickStarter(id);
  };
  app.ui.panel(PANEL, (host) => {
    const root = h('div', 'sd-root', host);
    modalPanel(root, { escClose: false, dim: true });
    const box = h('div', 'sd-box', root);
    h('h2', 'sd-title', box, t('draft.title'));
    h('p', 'sd-hint', box, t('draft.hint'));
    const row = h('div', 'sd-row', box);
    const cards = draft.candidates.map((def, i) => {
      const card = h('button', 'sd-card', row);
      card.type = 'button';
      h('span', 'sd-key', card, KEYS[i] ?? '');
      h('span', 'sd-rarity', card, t(`draft.rarity.${def.rarity}`));
      h('span', 'sd-name', card, t(`charm.${def.id}.name`));
      h('span', 'sd-desc', card, t(`charm.${def.id}.desc`));
      const arch = archetypeOf(def);
      if (arch) h('span', 'sd-arch', card, t('draft.engine', { arch: t(`draft.arch.${arch}`) }));
      h('span', 'sd-take', card, t('draft.take'));
      card.addEventListener('click', () => take(i));
      return card;
    });
    const timer = h('div', 'sd-timer', box, '');
    let alive = true;
    // The countdown rides the UI ticker (frame time, no timer of its own); it stops with the panel.
    addTicker(() => {
      if (!alive) return false;
      timer.textContent = t('draft.timer', { s: Math.max(0, Math.ceil(run.starterDraft()?.left ?? 0)) });
    });
    const onKey = (e: KeyboardEvent): void => {
      const i = KEYS.indexOf(e.key);
      if (i < 0 || i >= cards.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      take(i);
    };
    root.addEventListener('keydown', onKey);   // the veil owns its keys: 1-3 take a card while it is open
    cards[0]?.focus({ preventScroll: true });
    return () => {
      alive = false;
      root.removeEventListener('keydown', onKey);
    };
  });
}
