/**
 * The pantheon's face (docs/BLESSINGS.md §2, wave B2): at a paid Dawn the card turns over to the owners' offer, one card per god
 * with its sigil, its Favour pips and the boon's numbers. 1-4 or a click keeps a card (two on the golden tier: the panel deals the
 * rest again), and from Night 3 [R] lets Loki swap the marked card for one of his. The Dawn receipt counts up on top. A Dawn that
 * cost a name seal opens the receipt alone, with the memory it took. `mountPantheonUi(run)` is called once per solo Debt Run; the
 * returned disposer closes the panel. Rules live in `pantheon.ts`; the run holds the offer (`run.boonOffer()`, `run.pickBoon()`).
 *
 * Juice: the cards turn over 120 ms apart (boonOffer, then a flip each). A pick lifts the card in gold, fades the others and plays
 * boonPick; Loki's swap plays the omen. Calm mutes the flash, reduced motion drops the motion. The ticker is the UI frame: no timers.
 */
import './pantheon.css';
import { app } from '@/core/app';
import { bus } from '@/core/events';
import type { Unsub } from '@/core/types';
import { fmtCoins, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { addTicker, h, modalPanel, uiSfx } from '@/core/ui/widgets';
import type { DawnReceipt, DebtRun } from './run';
import { FAVOUR_MAX, OFFER_TIMEOUT_SEC, type BoonDef } from './pantheon';

const PANEL = 'pantheon';
/** Keys that take a card, by card index. */
const KEYS = ['1', '2', '3', '4'];
/** The receipt's count-up, in UI seconds. */
const RECEIPT_SEC = 1.5;
/** The timer pulses in its last this-many seconds. */
const PULSE_LAST_SEC = 5;
/** The deal: each card turns over this long after the one before it. */
const DEAL_GAP_S = 0.12;
/** A pick: the card rises for PICK_RISE_MS, and the panel closes (or deals again) at PICK_DONE_S. */
const PICK_RISE_MS = 220;
const PICK_DONE_S = 0.6;

const calmOn = (): boolean => !!app?.save?.data?.settings?.calm;
const reduceMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The open panel takes a pick as its animation (set while the panel is up). Returns false when it cannot. */
let activePick: ((id: string) => boolean) | null = null;

export function mountPantheonUi(run: DebtRun): () => void {
  run.setBoonGate(true);   // the lever now waits for a pick or this panel's timer
  const ui = app.ui as UIOverlayX;
  const offs: Unsub[] = [];
  // A short Dawn that cost a name seal has no offer: the receipt alone opens, with the memory it took (docs/BLESSINGS.md §1).
  offs.push(bus.on('quota:sealed', () => { showSealed(run); }));
  offs.push(bus.on('run:boon', (e) => {
    if (e.pid !== run.selfId) return;
    if (e.state === 'offer') { uiSfx('boonOffer', 0.9); showCards(run, true); return; }
    if (e.state === 'swap') { uiSfx('omen', 0.8); showCards(run, false); return; }
    if (e.state === 'picked' && activePick?.(e.ids[0] ?? '')) return;   // the panel deals again or closes when the lift ends
    if (e.state === 'picked' && run.boonOffer()) { showCards(run, false); return; }   // a pick from elsewhere with one more to keep
    app.ui.closePanel(PANEL);   // the held toasts show now
    if (e.state === 'auto' && e.ids.length > 0) {
      ui.toast(t('pantheon.timeout', { card: e.ids.map((id) => t(`pantheon.${id}.name`)).join(', ') }), 'warn', 3);
    }
  }));
  if (run.boonOffer()) showCards(run, true);
  return () => {
    app.ui.closePanel(PANEL);
    for (const off of offs.splice(0)) off();
  };
}

/** The Dawn receipt block: the settlement counts up (about 1.5 s, a coin tick while it rolls). A sealed Dawn adds the memory it took. */
function receiptBlock(box: HTMLElement, receipt: DawnReceipt, alive: () => boolean): void {
  const rows: { to: number; v: HTMLElement }[] = [];
  const rec = h('div', 'pt-receipt', box);
  h('div', receipt.memory ? 'pt-rec-title pt-sealed' : 'pt-rec-title', rec, t(receipt.memory ? 'pantheon.receipt.sealed' : 'pantheon.receipt.title', { n: receipt.night }));
  const grid = h('div', 'pt-rec-grid', rec);
  const lines = [
    { to: receipt.due, key: 'pantheon.receipt.due' },
    { to: receipt.paid, key: 'pantheon.receipt.paid' },
    { to: receipt.interest, key: 'pantheon.receipt.interest' },
    { to: receipt.tithe, key: 'pantheon.receipt.tithe' },
  ];
  for (const r of lines) {
    const line = h('div', 'pt-rec-row', grid);
    h('span', 'pt-rec-k', line, t(r.key));
    rows.push({ to: r.to, v: h('span', 'pt-rec-v', line, fmtCoins(0)) });
    // The quota grew inside the Night by the missed tithes: say so under the quota, with the amount.
    if (r.key === 'pantheon.receipt.due' && receipt.tithe > 0) h('div', 'pt-rec-sub', line, t('pantheon.receipt.titheAdd', { n: fmtCoins(receipt.tithe) }));
  }
  if (receipt.memory) {
    h('div', 'pt-rec-sub pt-rec-mem', rec, t(`run.mem.${receipt.memory}.lost`));
    h('div', 'pt-rec-sub', rec, t('pantheon.receipt.sealsLeft', { n: receipt.seals ?? 0 }));
  }
  let rolled = 0;
  let lastStep = -1;
  addTicker((dt) => {
    if (!alive()) return false;
    rolled = Math.min(RECEIPT_SEC, rolled + dt);
    const k = rolled / RECEIPT_SEC;
    const ease = 1 - Math.pow(1 - k, 3);
    for (const r of rows) r.v.textContent = fmtCoins(k >= 1 ? r.to : Math.round(r.to * ease));
    const step = Math.floor(k * 14);   // a coin tick about every 0.1 s while the numbers roll
    if (k < 1 && step !== lastStep) { lastStep = step; uiSfx('coin', 0.4); }
    return k < 1;
  });
}

/** The receipt alone, for a Dawn that cost a seal: modal, Esc or the button closes it. */
function showSealed(run: DebtRun): void {
  const receipt = run.dawnReceipt();
  if (!receipt?.memory) return;
  const ui = app.ui as UIOverlayX;
  app.ui.panel(PANEL, (host) => {
    ui.holdToasts(true);
    let alive = true;
    const root = h('div', 'pt-root', host);
    modalPanel(host, { escClose: true, dim: true });
    const box = h('div', 'pt-box', root);
    receiptBlock(box, receipt, () => alive);
    const go = h('button', 'pt-go', box, t('pantheon.receipt.go'));
    go.type = 'button';
    go.addEventListener('click', () => app.ui.closePanel(PANEL));
    go.focus({ preventScroll: true });
    return () => { alive = false; ui.holdToasts(false); };
  });
}

/** One god card: the sigil, the god and its Favour pips, the kind tag, the boon's name and numbers, and the Rite's debt line. */
function godCard(run: DebtRun, row: HTMLElement, def: BoonDef, key: string): HTMLButtonElement {
  const card = h('button', `pt-card pt-${def.kind} pt-god-${def.god}`, row) as HTMLButtonElement;
  card.type = 'button';
  card.setAttribute('data-nav', '');   // Up / Down (W / S) move between the cards, as in the other panels
  const head = h('span', 'pt-head', card);
  h('span', 'pt-key', head, key);
  h('i', `pt-sigil pt-sig-${def.god}`, head);
  if (def.god2) h('i', `pt-sigil pt-sig-${def.god2}`, head);
  h('span', 'pt-god', head, t(`pantheon.god.${def.god}.name`));
  if (def.god !== 'loki') {
    const fav = run.boonFavour(def.god);
    const pips = h('span', 'pt-pips', head);
    pips.title = t('pantheon.favour', { n: fav });
    for (let i = 0; i < FAVOUR_MAX; i++) h('i', i < fav ? 'pt-pip pt-lit' : 'pt-pip', pips);
  }
  h('span', 'pt-kind', card, t(`pantheon.kind.${def.kind}`));
  h('span', 'pt-name', card, t(`pantheon.${def.id}.name`));
  h('span', 'pt-desc', card, t(`pantheon.${def.id}.desc`));
  if (def.kind === 'rite') h('span', 'pt-debt', card, t('pantheon.rite.line'));
  h('span', 'pt-take', card, t('pantheon.take'));
  return card;
}

/**
 * The offer panel: modal (the veil blocks the walk), no Esc (a card must be kept), keys 1-4 and R captured before the game sees
 * them. `fresh` is a new Dawn (the receipt counts up on top); a second pick or a swap deals the cards again without it.
 */
function showCards(run: DebtRun, fresh: boolean): void {
  const offer = run.boonOffer();
  if (!offer) return;
  const ui = app.ui as UIOverlayX;
  const ids = offer.candidates.map((d) => d.id);
  const receipt = fresh ? run.dawnReceipt() : null;
  const reduce = reduceMotion();
  const calm = calmOn();
  app.ui.panel(PANEL, (host) => {
    ui.holdToasts(true);   // the news waits behind the panel: released by the cleanup below
    let alive = true;
    const root = h('div', 'pt-root', host);
    modalPanel(host, { escClose: false, dim: true });
    const box = h('div', 'pt-box', root);
    if (receipt) receiptBlock(box, receipt, () => alive);
    h('h2', 'pt-title', box, t('pantheon.title'));
    h('p', 'pt-hint', box, t(offer.picks > 1 ? 'pantheon.hint.two' : 'pantheon.hint', { n: ids.length }));
    const timer = h('div', 'pt-timer', box);
    const timerTxt = h('span', 'pt-timer-txt', timer);
    const fill = h('i', '', h('span', 'pt-timer-bar', timer));
    const row = h('div', 'pt-row', box);
    const cards = offer.candidates.map((def, i) => godCard(run, row, def, KEYS[i] ?? ''));
    // Loki's swap (Night 3+, once an offer): R swaps the marked card (the one under the pointer or the focus; the first by default).
    let marked = 0;
    const mark = (i: number): void => { marked = i; cards.forEach((c, j) => c.classList.toggle('pt-marked', offer.canSwap && j === i)); };
    if (offer.canSwap) {
      const free = run.boons().includes('loki_coat');
      h('p', 'pt-swap', box, free ? t('pantheon.swap.free') : t('pantheon.swap'));
      cards.forEach((c, i) => { c.addEventListener('pointerenter', () => mark(i)); c.addEventListener('focus', () => mark(i)); });
      mark(0);
    }
    // The deal: each card turns over DEAL_GAP_S after the one before it (Web Animations, delayed; no timer of its own).
    if (!reduce) {
      cards.forEach((card, i) => {
        card.animate([
          { opacity: 0, transform: 'perspective(600px) rotateY(90deg)' },
          { opacity: 1, transform: 'perspective(600px) rotateY(0deg)' },
        ], { duration: 260, delay: i * DEAL_GAP_S * 1000, fill: 'backwards', easing: 'ease-out' });
      });
    }
    const dealt = cards.map(() => false);
    let dealT = 0;
    let pickT = -1;   // seconds since a pick started; -1 while the offer is open
    const startPick = (idx: number): boolean => {
      if (pickT >= 0) return true;   // a second pick while the first rises is ignored
      const chosen = cards[idx];
      if (!chosen) return false;
      pickT = 0;
      chosen.classList.add('pt-picked');
      if (!reduce) chosen.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }], { duration: PICK_RISE_MS, fill: 'forwards', easing: 'ease-out' });
      cards.forEach((c, j) => {
        if (j === idx) return;
        if (reduce) c.style.opacity = '0';
        else c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
      });
      if (!calm) app.fx.flash(0xffd34a, 0.3, 0.25);   // the gold flash (fx.flash honours reduced flashing)
      uiSfx('boonPick', 0.9);
      return true;
    };
    const pickFromEvent = (id: string): boolean => {
      const idx = ids.indexOf(id);
      return idx >= 0 && startPick(idx);
    };
    activePick = pickFromEvent;
    cards.forEach((card, i) => card.addEventListener('click', () => { const id = ids[i]; if (id) run.pickBoon(id); }));
    addTicker((dt) => {
      if (!alive) return false;
      if (pickT >= 0) {
        pickT += dt;
        if (pickT < PICK_DONE_S) return undefined;   // the countdown freezes while the card rises (the boon is already kept)
        if (run.boonOffer()) showCards(run, false);   // a second pick (golden tier): deal the rest again
        else app.ui.closePanel(PANEL);
        return false;
      }
      dealT += dt;
      cards.forEach((_, i) => { if (!dealt[i] && dealT >= i * DEAL_GAP_S) { dealt[i] = true; uiSfx('cardFlip', 0.8); } });
      const left = Math.max(0, run.boonOffer()?.left ?? 0);
      timerTxt.textContent = t('pantheon.timer', { s: Math.ceil(left) });
      timer.classList.toggle('pt-pulse', left > 0 && left <= PULSE_LAST_SEC);
      fill.style.width = `${Math.min(100, (left / OFFER_TIMEOUT_SEC) * 100)}%`;
      return undefined;
    });
    const onKey = (e: KeyboardEvent): void => {
      const i = KEYS.indexOf(e.key);
      const swap = e.key === 'r' || e.key === 'R';
      if (!swap && (i < 0 || i >= cards.length)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (pickT >= 0) return;
      if (swap) { if (offer.canSwap) run.swapBoon(marked); return; }
      const id = ids[i];
      if (id) run.pickBoon(id);
    };
    // The veil owns its keys while it is open, whatever has focus (a capture listener runs before the game's).
    window.addEventListener('keydown', onKey, true);
    cards[0]?.focus({ preventScroll: true });
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey, true);
      if (activePick === pickFromEvent) activePick = null;
      ui.holdToasts(false);   // the news held behind the panel shows now
    };
  });
}
