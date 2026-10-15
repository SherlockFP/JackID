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
/** A ui banner (ui.ts `.px-bw` in the banner layer) is on screen: the title card of the Night, read from the DOM (ui.ts keeps no getter). */
const titleCardUp = (): boolean => typeof document !== 'undefined' && document.querySelector('.px-bwl .px-bw') !== null;
/** A modal panel is on screen (`modalPanel` marks it `data-modal="1"`): the offer waits for it, as the overpay panel does. */
const modalUp = (): boolean => typeof document !== 'undefined' && document.querySelector('[data-modal="1"]') !== null;
/**
 * Sim seconds one title card may hold the offer. A banner clears on its own timers, and a stepped harness (the QA clock) can run
 * those late: one long step fires one hold tick per call, so a card can outlive its wait. A normal card clears in about 3 s, so the
 * gate gives up on a card after this and the offer opens (a modal hides any banner under it, and the card resumes after).
 */
const CARD_HOLD_CAP_SEC = 8;

export function mountDraftUi(run: DebtRun): () => void {
  const offs: Unsub[] = [];
  // Every Settle's interest is a coin sound (the bank's work, heard as well as read).
  offs.push(bus.on('run:interest', (e) => { if (e.pid === run.selfId) uiSfx('coin', 0.8); }));
  offs.push(bus.on('run:draft', (e) => { if (e.pid === run.selfId) app.ui.closePanel(PANEL); }));
  // The offer waits for the opening cutscenes (intro, Collector), the Night's title card ("1. GECE", a ui banner) and any other
  // modal to clear, then a short beat, so it never covers them (a title card gives way after CARD_HOLD_CAP_SEC). It is asked on
  // every frame until it opens: a pull before the cards clear does not lose it (run.openStarterDraft takes it at the Night 1
  // Mola). An open offer (a resumed save) shows at once.
  let quiet = 0;
  let cardHeld = 0;
  let shown = false;
  let done = false;
  addTicker((dt) => {
    if (done) return false;
    // Nothing left to offer: taken (or timed out), or the run left Night 1.
    if (!run.starterPending() && run.starterDraft() === null) { done = true; return false; }
    if (shown) return true;
    if (app.cutscene.playing || modalUp()) { quiet = 0; cardHeld = 0; return true; }
    if (titleCardUp()) {
      // A card holds the offer for at most CARD_HOLD_CAP_SEC of its own sim time; past that the quiet beat runs over it.
      cardHeld += dt;
      if (cardHeld < CARD_HOLD_CAP_SEC) { quiet = 0; return true; }
    } else cardHeld = 0;
    quiet += dt;
    if (quiet < 0.6) return true;
    if (run.starterDraft() !== null || run.openStarterDraft()) { shown = true; showCards(run); }
    return true;
  });
  return () => {
    done = true;
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
    // The veil owns its keys: 1-3 take a card while it is open, whatever has focus (a capture listener on the window runs
    // before the game's own bubble listener, and stopImmediatePropagation keeps the keys from it).
    window.addEventListener('keydown', onKey, true);
    cards[0]?.focus({ preventScroll: true });
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey, true);
    };
  });
}
