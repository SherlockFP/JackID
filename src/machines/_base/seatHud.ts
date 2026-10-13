/**
 * Seat HUD (`_base`) — the readability standard for seated card / table machines. One reusable DOM overlay inside
 * `#ui`, drawn in the PSX style of ui.css (bitmap fonts, high contrast, integer `--u` scale) so it reads at 400×225.
 *
 *   GOAL       one sentence: what wins                         goal(key)
 *   STATE      big banner: whose turn / what phase             state(key, tone, subKey?)
 *   NUMBERS    labelled key figures (bet, balance, totals)     numbers([{label, value, tone}])
 *   CONTROLS   the valid actions RIGHT NOW, with bound keys    controls([{key, label, action, primary}])
 *   RESULT     WIN / LOSE / PUSH / BLACKJACK + amount, 1.5 s   result(kind, amount)
 *   FIRST SIT  3-line how-to, once per machine (localStorage)  firstTip(machineId, lines) → true if shown
 *   RULES      full rules card, re-opened by the help key      rules(lines) / dismiss()
 *
 * Lifecycle: the machine calls `show()` when the local player is seated and `hide()` on stand-up. Every text
 * argument is an i18n key (`{ k, v? }`) or a literal string for values that need no translation (numbers). The
 * machine re-sends its content from `onLang()`. While `blocking` is true the machine routes its next action to
 * `dismiss()` and swallows it (any key closes a card).
 */
import { t as tr, fmtCoins, type I18nVars } from '@/core/i18n';
import './seatHud.css';

export type HudTone = 'neutral' | 'gold' | 'good' | 'bad' | 'cyan' | 'warn';
export type HudResultKind = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender' | 'even';
/** A translatable text (`{ k: 'm.blackjack.sBet', v: { n: 5 } }`) or a literal (`'16'`). */
export type Txt = string | { k: string; v?: I18nVars };
export interface HudNumber { label: Txt; value: Txt; tone?: HudTone }
export interface HudControl { key: string; label: Txt; action?: string; primary?: boolean }

const seenKey = (id: string): string => `jackid.seatTip.${id}`;
const RESULT_KEY: Record<HudResultKind, string> = {
  win: 'hud.seat.kWin', lose: 'hud.seat.kLose', push: 'hud.seat.kPush', blackjack: 'hud.seat.kBlackjack',
  bust: 'hud.seat.kBust', surrender: 'hud.seat.kSurrender', even: 'hud.seat.kEven',
};

const txt = (x: Txt): string => (typeof x === 'string' ? x : tr(x.k, x.v));
function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class SeatHud {
  private readonly root: HTMLElement;
  private readonly goalEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly stateT: HTMLElement;
  private readonly stateS: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly resultT: HTMLElement;
  private readonly resultA: HTMLElement;
  private readonly numsEl: HTMLElement;
  private readonly ctrlEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly cardH: HTMLElement;
  private readonly cardB: HTMLElement;
  private readonly cardF: HTMLElement;
  private shown = false;
  private card: 'none' | 'tip' | 'rules' = 'none';
  private tipId = '';
  private resultTimer = 0;

  /** `mount` is normally the machine's `ctx.ui.root` (`#ui`). */
  constructor(mount: HTMLElement) {
    this.root = make('div', 'seat-hud', mount);
    const top = make('div', 'shud-top', this.root);
    this.goalEl = make('div', 'shud-goal shud-panel', top);
    this.stateEl = make('div', 'shud-state shud-panel', top);
    this.stateT = make('span', 'shud-state-t', this.stateEl);
    this.stateS = make('span', 'shud-state-s', this.stateEl);
    this.resultEl = make('div', 'shud-result', this.root);
    this.resultT = make('span', 'shud-result-t', this.resultEl);
    this.resultA = make('span', 'shud-result-a', this.resultEl);
    const bottom = make('div', 'shud-bottom', this.root);
    this.numsEl = make('div', 'shud-nums', bottom);
    this.ctrlEl = make('div', 'shud-ctrl shud-panel', bottom);
    this.cardEl = make('div', 'shud-card', this.root);
    this.cardH = make('div', 'shud-card-h', this.cardEl);
    this.cardB = make('ol', 'shud-card-b', this.cardEl);
    this.cardF = make('div', 'shud-card-f', this.cardEl);
    this.cardEl.addEventListener('pointerdown', () => this.dismiss());
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────
  get visible(): boolean { return this.shown; }
  /** A tip or rules card is open: route the next action to `dismiss()`. */
  get blocking(): boolean { return this.card !== 'none'; }
  get rulesOpen(): boolean { return this.card === 'rules'; }

  /** Seated: show the overlay. */
  show(): void { this.shown = true; this.root.classList.add('on'); }
  /** Stood up: hide everything, drop the result and any open card (an unseen tip stays unseen). */
  hide(): void {
    this.shown = false;
    this.root.classList.remove('on');
    this.clearResult();
    this.closeCard();
  }
  dispose(): void { this.clearResult(); this.root.remove(); }

  // ── standard slots ────────────────────────────────────────────────────────────────────────────
  goal(text: Txt): void { this.goalEl.textContent = txt(text); }

  state(text: Txt, tone: HudTone = 'gold', sub?: Txt): void {
    this.stateEl.className = `shud-state shud-panel tone-${tone}`;
    this.stateT.textContent = txt(text);
    this.stateS.textContent = sub === undefined ? '' : txt(sub);
    this.stateS.style.display = this.stateS.textContent === '' ? 'none' : '';
  }

  numbers(items: HudNumber[]): void {
    this.numsEl.replaceChildren();
    for (const n of items) {
      const box = make('div', `shud-num shud-panel tone-${n.tone ?? 'gold'}`, this.numsEl);
      make('span', 'shud-num-l', box).textContent = txt(n.label);
      make('span', 'shud-num-v', box).textContent = txt(n.value);
    }
    this.numsEl.style.display = items.length ? '' : 'none';
  }

  /** Only the actions valid right now; pass [] to clear the bar's buttons. */
  controls(items: HudControl[]): void {
    this.ctrlEl.replaceChildren();
    for (const c of items) {
      const b = make('div', `shud-btn${c.primary ? ' primary' : ''}`, this.ctrlEl);
      if (c.action) b.dataset.action = c.action;
      make('span', 'shud-key', b).textContent = c.key;
      make('span', 'shud-btn-l', b).textContent = txt(c.label);
    }
    this.ctrlEl.style.display = items.length ? '' : 'none';
  }

  /** Colour-coded callout held for `hold` seconds. `amount` = net coins (negative = lost). */
  result(kind: HudResultKind, amount = 0, hold = 1.5): void {
    this.clearResult();
    this.resultEl.className = `shud-result r-${kind}`;
    this.resultT.textContent = tr(RESULT_KEY[kind]);
    this.resultA.textContent = amount > 0 ? `+${fmtCoins(amount)}` : amount < 0 ? `-${fmtCoins(-amount)}` : '';
    this.resultA.style.display = amount === 0 ? 'none' : '';
    void this.resultEl.offsetWidth;                       // restart the pop-in
    this.resultEl.classList.add('on');
    this.resultTimer = window.setTimeout(() => { this.resultEl.classList.remove('on'); this.resultTimer = 0; }, hold * 1000);
  }
  private clearResult(): void {
    if (this.resultTimer) window.clearTimeout(this.resultTimer);
    this.resultTimer = 0;
    this.resultEl.classList.remove('on');
  }

  // ── cards ─────────────────────────────────────────────────────────────────────────────────────
  /** First time at this machine: opens the how-to card and returns true. Remembered per machine (try/catch). */
  firstTip(machineId: string, lines: Txt[]): boolean {
    let seen = false;
    try { seen = window.localStorage.getItem(seenKey(machineId)) === '1'; } catch { seen = false; }
    if (seen) return false;
    this.tipId = machineId;
    this.openCard('tip', tr('hud.seat.firstSit'), lines);
    return true;
  }

  /** Full rules card (the help key). */
  rules(lines: Txt[], title?: Txt): void {
    this.tipId = '';
    this.openCard('rules', title === undefined ? tr('hud.seat.rulesTitle') : txt(title), lines);
  }

  /** Closes the open card (a first-sit tip is then remembered as seen). Returns true when something closed. */
  dismiss(): boolean {
    if (this.card === 'none') return false;
    if (this.card === 'tip' && this.tipId) {
      try { window.localStorage.setItem(seenKey(this.tipId), '1'); } catch { /* private window: the tip repeats */ }
    }
    this.closeCard();
    return true;
  }

  private openCard(kind: 'tip' | 'rules', title: string, lines: Txt[]): void {
    this.card = kind;
    this.cardH.textContent = title;
    this.cardB.replaceChildren();
    for (const l of lines) make('li', '', this.cardB).textContent = txt(l);
    this.cardF.textContent = tr('hud.seat.anyKey');
    this.cardEl.classList.add('on');
  }
  private closeCard(): void {
    this.card = 'none';
    this.cardEl.classList.remove('on');
  }
}
