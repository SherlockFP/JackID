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
 * The FIRST-SIT tip and the RULES card are 3D placards (`placard3d.ts`): a board held up in front of the eye in the
 * first-person overlay, with bitmap text and page buttons. The DOM part is the HUD bar only.
 *
 * Lifecycle: the machine calls `show()` when the local player is seated and `hide()` on stand-up. Every text
 * argument is an i18n key (`{ k, v? }`) or a literal string for values that need no translation (numbers). The
 * machine re-sends its content from `onLang()`. While `blocking` is true the machine routes its next action to
 * `dismiss()` and swallows it (any key closes a card; a click on the card closes it too).
 */
import { bus } from '@/core/events';
import { t as tr, fmtCoins, type I18nVars } from '@/core/i18n';
import type { TiltView } from '@/game/circuit';
import type { OddsLine } from '@/game/pace';
import { BRASS, CREAM, INK, INK_SOFT, Placard3D, button, paginate, put, rowsIn, rulesFirstEver, rulesMarkShown, wrapPx5 } from './placard3d';
import { showRulesHint } from './rulesHint';
import './seatHud.css';
import './seatHudLayout.css';

declare module '@/core/events' {
  interface GameEvents {
    /** The econ lane's high-stake flag: `need` true while the next bet wants a confirm press (the STAKE panel warns). */
    'stake:confirm': { need: boolean };
  }
}

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

/** The Tell Sheet parts as text: HIT · ×10+ · CLASS · NEED. The numbers are formatted in pace.ts; this lays out words. */
function oddsText(l: OddsLine): string[] {
  const out = [
    l.hit === null ? tr('pace.odds.hitRare', { n: l.plays }) : tr('pace.odds.hit', { n: l.hit }),
    l.big === null ? tr('pace.odds.bigRare', { x: 10, n: l.plays }) : tr('pace.odds.big', { x: 10, n: l.big }),
    tr(`pace.odds.cls.${l.cls}`),
  ];
  const need = l.need;
  if (need) {
    if (need.kind === 'met') out.push(tr(need.pocket ? 'pace.odds.pocket' : 'pace.odds.met'));
    else if (need.kind === 'dead') out.push(tr('pace.odds.dead'));
    else out.push(need.odds === null
      ? tr('pace.odds.needRare', { k: need.k, n: l.plays })
      : tr('pace.odds.need', { k: need.k, n: need.odds }));
  }
  return out;
}

// card geometry: canvas texels and metres (the board is ~0.44 m wide at arm's length)
const CARD_PX: [number, number] = [272, 232];
const CARD_W = 0.44, CARD_H = 0.375;
const CARD_HEAD = 24, CARD_BODY_Y = 32, CARD_PAD = 14;
const CARD_TEXT_W = CARD_PX[0] - CARD_PAD * 2;
const CARD_BODY_H = CARD_PX[1] - CARD_BODY_Y - 40;
const fmtX = (x: number): string => String(Number(x.toFixed(2)));
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
  /** The big STAKE / POCKET readout (always shown while seated); warns above half the pocket. */
  private readonly stakeEl: HTMLElement;
  private readonly stakeL: HTMLElement;
  private readonly stakeV: HTMLElement;
  /** Re-places the stack edges (`--seat-top-b` / `--seat-bot-t`) when the goal, banner or stake stack changes size. */
  private readonly stackRo: ResizeObserver | null;
  private stakeBet = 0;
  /** True once THIS machine reported a stake (a round or `stake()`); non-staking seats (terminal, cashier, vendor) never show the readout. */
  private stakeKnown = false;
  private stakeNeed = false;
  private stakeKey = '';
  private readonly resultEl: HTMLElement;
  private readonly resultT: HTMLElement;
  private readonly resultA: HTMLElement;
  private readonly numsEl: HTMLElement;
  private readonly ctrlEl: HTMLElement;
  private readonly tiltEl: HTMLElement;
  private readonly tiltL: HTMLElement;
  private readonly tiltLamp: HTMLElement;
  private readonly bulbs: HTMLElement[] = [];
  /** The Tell Sheet line (WAVE8 item 5): HIT · ×10+ · CLASS · NEED. */
  private readonly oddsEl: HTMLElement;
  private oddsShown = '';
  /** `ui:blocking` is on (pause card, ledger, any modal): the input mode is 'ui' and the HUD steps aside. */
  private uiBlocked = false;
  private tiltKey = '';
  /** The latest Tilt state the run announced (`circuit:tilt`); shown while this HUD is. */
  private tilt: TiltView | null = null;
  private readonly offs: Array<() => void> = [];
  /** The open tip / rules card (3D placard), or null. */
  private cardP: Placard3D | null = null;
  private shown = false;
  private card: 'none' | 'tip' | 'rules' = 'none';
  private tipId = '';
  private cancelResult: (() => void) | null = null;

  /** `mount` is normally the machine's `ctx.ui.root` (`#ui`). */
  constructor(mount: HTMLElement) {
    this.root = make('div', 'seat-hud', mount);
    // Top band order (fixed): the Night / Watch clock line (HUD band, above), then the state banner, then the machine tooltip.
    const top = make('div', 'shud-top', this.root);
    this.stateEl = make('div', 'shud-state shud-panel', top);
    this.stateT = make('span', 'shud-state-t', this.stateEl);
    this.stateS = make('span', 'shud-state-s', this.stateEl);
    this.goalEl = make('div', 'shud-goal shud-panel', top);
    this.resultEl = make('div', 'shud-result', this.root);
    this.resultT = make('span', 'shud-result-t', this.resultEl);
    this.resultA = make('span', 'shud-result-a', this.resultEl);
    const bottom = make('div', 'shud-bottom', this.root);
    // THE CIRCUIT: four Tilt bulbs and the TILT / HOT / COLD label for the instance you sit at
    this.tiltEl = make('div', 'shud-tilt shud-panel', bottom);
    this.tiltL = make('span', 'shud-tilt-l', this.tiltEl);
    const row = make('span', 'shud-bulbs', this.tiltEl);
    for (let i = 0; i < 4; i++) this.bulbs.push(make('i', '', row));
    this.tiltLamp = make('span', 'shud-tilt-lamp', this.tiltEl);
    this.tiltEl.style.display = 'none';
    this.oddsEl = make('div', 'shud-odds shud-panel', bottom);
    this.oddsEl.style.maxWidth = '70vw'; this.oddsEl.style.whiteSpace = 'normal'; this.oddsEl.style.overflowWrap = 'anywhere';
    this.oddsEl.style.display = 'none';
    this.stakeEl = make('div', 'shud-stake shud-panel tone-gold', bottom);
    this.stakeL = make('span', 'shud-stake-l', this.stakeEl);
    this.stakeV = make('span', 'shud-stake-v', this.stakeEl);
    this.numsEl = make('div', 'shud-nums', bottom);
    this.ctrlEl = make('div', 'shud-ctrl shud-panel', bottom);
    this.stackRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.placeToasts()) : null;
    this.stackRo?.observe(top);
    this.stackRo?.observe(bottom);
    this.offs.push(bus.on('circuit:tilt', (e) => { this.tilt = e.tilt; this.refreshTilt(); }));
    this.offs.push(bus.on('seat:odds', (e) => this.odds(e.line)));
    this.offs.push(bus.on('ui:blocking', ({ blocking }) => this.setUiBlocked(blocking)));
    // STAKE: the local player's bet (machine:round) and pocket (wallet) feed the readout; the econ lane may flag a high stake.
    const mine = (pid: number): boolean => pid === SeatHud.stakeSource().self;
    this.offs.push(bus.on('machine:round', (e) => { if (this.shown && mine(e.pid)) { this.stakeBet = e.bet; this.stakeKnown = true; this.refreshStake(); } }));
    this.offs.push(bus.on('machine:result', (e) => { if (mine(e.pid)) this.refreshStake(); }));
    this.offs.push(bus.on('eco:wallet', (e) => { if (mine(e.pid)) this.refreshStake(); }));
    this.offs.push(bus.on('stake:confirm', ({ need }) => { this.stakeNeed = need; this.refreshStake(); }));
    this.offs.push(bus.on('run:stakeConfirm', (e) => { if (mine(e.pid)) { this.stakeNeed = e.state === 'ask'; this.refreshStake(); } }));
  }

  /** A machine's own stake (e.g. set before the round event) for the STAKE readout; the pocket is read from the run. */
  stake(bet: number): void { this.stakeBet = Number.isFinite(bet) && bet > 0 ? bet : 0; this.stakeKnown = true; this.refreshStake(); }

  /** Repaints the STAKE / POCKET readout (cheap: DOM only on change). Warns when the stake is above half the pocket. */
  private refreshStake(): void {
    const pocket = SeatHud.stakeSource().pocket;
    const bet = this.stakeBet;
    const high = bet > pocket * 0.5;
    const show = this.shown && this.stakeKnown;
    const key = `${show ? 1 : 0}|${bet}|${pocket}|${high ? 1 : 0}|${this.stakeNeed ? 1 : 0}`;
    if (key === this.stakeKey) return;
    this.stakeKey = key;
    this.stakeEl.style.display = show ? '' : 'none';
    const tone = this.stakeNeed ? 'bad' : high ? 'warn' : 'gold';
    this.stakeEl.className = `shud-stake shud-panel tone-${tone}${this.stakeNeed ? ' need' : ''}`;
    this.stakeL.textContent = tr(this.stakeNeed ? 'hud.stake.confirm' : 'hud.stake.label');
    this.stakeV.textContent = `${fmtCoins(bet)} / ${fmtCoins(pocket)}`;
  }

  /**
   * Steps the HUD aside while the UI is blocking (`ui:blocking`, wired in the constructor). Machines can also call it
   * from their own input-mode check: the mode is 'ui' during text entry too, which emits no event.
   */
  setUiBlocked(on: boolean): void {
    this.uiBlocked = on;
    this.root.style.display = on ? 'none' : '';
    this.placeToasts();
  }

  /**
   * The Tell Sheet line (WAVE8 item 5): `HIT 1 in n · ×10+ 1 in m · CLASS · NEED ×k → 1 in j`. `line` comes from
   * `oddsLine()` (pace.ts) built run-side from MACHINE_PROFILES and the quota pace; pass null to hide the line.
   */
  odds(line: OddsLine | null): void {
    const next = line ? oddsText(line).join(' · ') : '';
    if (next === this.oddsShown) return;
    this.oddsShown = next;
    this.oddsEl.textContent = next;
    this.oddsEl.style.display = next === '' ? 'none' : '';
  }

  /** Repaints the Tilt bulbs (cheap: the DOM is touched only when the state changes). */
  private refreshTilt(): void {
    const v: TiltView | null = this.shown ? this.tilt : null;
    if (v === null) {
      if (this.tiltKey !== '') { this.tiltKey = ''; this.tiltEl.style.display = 'none'; }
      return;
    }
    const key = `${v.lit}:${v.step}:${v.hot ? 1 : 0}:${v.cold ? 1 : 0}:${fmtX(v.lamp)}:${fmtX(v.factor)}`;
    if (key === this.tiltKey) return;
    this.tiltKey = key;
    this.tiltEl.style.display = '';
    this.tiltEl.className = `shud-tilt shud-panel${v.hot ? ' lamp-hot' : ''}${v.step > 0 ? ` tilted step-${v.step}` : ''}`;
    this.tiltL.textContent = v.hot ? tr('circuit.hot', { x: fmtX(v.lamp) }) : v.step > 0 ? tr('circuit.tiltFactor', { x: fmtX(v.factor) }) : tr('circuit.tilt');
    this.bulbs.forEach((b, i) => { b.className = i < v.lit ? 'on' : ''; });
    this.tiltLamp.textContent = v.cold ? `${tr('circuit.cold')} ×${fmtX(v.lamp)}` : '';
    this.tiltLamp.style.display = v.cold ? '' : 'none';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────
  get visible(): boolean { return this.shown; }
  /** A tip or rules card is open: route the next action to `dismiss()`. */
  get blocking(): boolean { return this.card !== 'none'; }
  get rulesOpen(): boolean { return this.card === 'rules'; }

  /** Seated: show the overlay. */
  show(): void {
    this.shown = true; this.root.classList.add('on'); this.root.parentElement?.classList.add('seated');
    this.stakeKnown = false; this.stakeBet = 0;   // each seat reports its own stake; a seat that never does shows no STAKE readout
    this.refreshTilt(); this.refreshStake(); this.placeToasts();
  }
  /** Stood up: hide everything, drop the result and any open card (an unseen tip stays unseen). */
  /** Label of the help key; the in-game session points this at the live binding (default key H). */
  static helpKeyLabel: () => string = () => 'H';
  /**
   * The local player's id and pocket for the STAKE readout. The in-game HUD (`menu/hud.ts`) points this at the run while a
   * Night is on; the default reads nothing (zero pocket, no own events).
   */
  static stakeSource: () => { self: number; pocket: number } = () => ({ self: -1, pocket: 0 });
  private offHint: (() => void) | null = null;
  hide(): void {
    this.offHint?.(); this.offHint = null;
    this.shown = false;
    this.root.classList.remove('on');
    this.root.parentElement?.classList.remove('seated');
    this.clearResult();
    this.closeCard();
    this.refreshTilt();
    this.placeToasts();
  }
  dispose(): void {
    this.offHint?.(); this.offHint = null; for (const off of this.offs.splice(0)) off(); this.clearResult(); this.cardP?.dispose(); this.cardP = null;
    this.stackRo?.disconnect();
    this.root.parentElement?.style.removeProperty('--seat-top-b');
    this.root.parentElement?.style.removeProperty('--seat-bot-t');
    this.root.remove();
  }

  // ── standard slots ────────────────────────────────────────────────────────────────────────────
  goal(text: Txt): void { this.goalEl.textContent = txt(text); this.placeToasts(); }

  state(text: Txt, tone: HudTone = 'gold', sub?: Txt): void {
    this.stateEl.className = `shud-state shud-panel tone-${tone}`;
    this.stateT.textContent = txt(text);
    this.stateS.textContent = sub === undefined ? '' : txt(sub);
    this.stateS.style.display = this.stateS.textContent === '' ? 'none' : '';
    this.placeToasts();
  }

  /**
   * The toast stack (`.px-toasts`, the Night summary and other news) is pushed down to sit under this HUD's header while
   * the HUD is up; it used to cover the goal and the state banner. Restored when the HUD hides or the UI blocks.
   */
  private placeToasts(): void {
    this.placeStack();
    const stack = this.root.parentElement?.querySelector<HTMLElement>('.px-toasts');
    if (!stack) return;
    if (!this.shown || this.uiBlocked) { stack.style.top = ''; return; }
    const head = this.root.querySelector<HTMLElement>('.shud-top');
    stack.style.top = head ? `${head.offsetTop + head.offsetHeight + 6}px` : '';
  }

  /**
   * Publishes the seat stack's edges on `#ui` as `--seat-top-b` (bottom of the goal / state stack) and `--seat-bot-t` (top of
   * the STAKE / odds stack), in px from the top of `#ui`. The Night 1 tutorial box (`.px-tut`, ui.css) sits between them while
   * seated. Removed when the HUD is down.
   */
  private placeStack(): void {
    const host = this.root.parentElement;
    if (!host) return;
    if (!this.shown || this.uiBlocked) {
      host.style.removeProperty('--seat-top-b');
      host.style.removeProperty('--seat-bot-t');
      return;
    }
    const top = this.root.querySelector<HTMLElement>('.shud-top');
    const bot = this.root.querySelector<HTMLElement>('.shud-bottom');
    if (top) host.style.setProperty('--seat-top-b', `${top.offsetTop + top.offsetHeight}px`);
    if (bot) host.style.setProperty('--seat-bot-t', `${bot.offsetTop}px`);
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
  result(kind: HudResultKind, amount = 0, hold = 1.5, label?: string): void {
    this.clearResult();
    this.resultEl.className = `shud-result r-${kind}`;
    this.resultT.textContent = label ?? tr(RESULT_KEY[kind]);
    this.resultA.textContent = amount > 0 ? `+${fmtCoins(amount)}` : amount < 0 ? `-${fmtCoins(-amount)}` : '';
    this.resultA.style.display = amount === 0 ? 'none' : '';
    void this.resultEl.offsetWidth;                       // restart the pop-in
    this.resultEl.classList.add('on');
    const end = performance.now() + hold * 1000;
    let live = true;
    const tick = (): void => {
      if (!live) return;
      if (performance.now() >= end) { this.resultEl.classList.remove('on'); this.cancelResult = null; return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.cancelResult = () => { live = false; };
  }
  private clearResult(): void {
    this.cancelResult?.();
    this.cancelResult = null;
    this.resultEl.classList.remove('on');
  }

  // ── cards ─────────────────────────────────────────────────────────────────────────────────────
  /** First time at this machine: opens the how-to card and returns true. Remembered per machine (try/catch). */
  firstTip(machineId: string, lines: Txt[]): boolean {
    this.offHint?.(); this.offHint = null;
    if (!rulesFirstEver()) {
      this.offHint = showRulesHint(this.root, tr('hud.seat.rHelpHint', { help: SeatHud.helpKeyLabel() }));
      return false;
    }
    rulesMarkShown();
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

  /** The card as a 3D placard: numbered rules, paginated, with page buttons; a click on the board closes it. */
  private openCard(kind: 'tip' | 'rules', title: string, lines: Txt[]): void {
    this.cardP?.dispose();
    this.card = kind;
    const rows: string[] = [];
    lines.forEach((l, i) => { for (const r of wrapPx5(`${i + 1}. ${txt(l)}`, CARD_TEXT_W)) rows.push(r); });
    const pages = paginate(rows, rowsIn(CARD_BODY_H));
    const hint = tr('hud.seat.anyKey');
    const p = new Placard3D({
      name: `seat-${kind}`,
      w: CARD_W, h: CARD_H, px: CARD_PX,
      pages: () => pages.length,
      bg: CREAM,
      frame: { color: 0x6b4f1d, pad: 0.012, depth: 0.008 },
      rest: [0, -0.03, -0.5],
      autoHide: kind === 'tip' ? 6 : undefined,                    // a first-sit tip fades by itself; rules stay until closed
      onGone: () => {
        if (this.cardP !== p) return;                              // dismissed by hand already (or replaced)
        if (kind === 'tip' && this.tipId) { try { window.localStorage.setItem(seenKey(this.tipId), '1'); } catch { /* repeats */ } }
        this.card = 'none'; this.cardP = null;
      },
      paint: (c) => {
        const { g, w, h } = c;
        g.fillStyle = BRASS; g.fillRect(0, 0, w, CARD_HEAD);
        put(g, title, w / 2, 8, INK, 'center');
        pages[c.page].forEach((r, i) => put(g, r, CARD_PAD, CARD_BODY_Y + i * 10));
        put(g, hint, w / 2, h - 12, INK_SOFT, 'center');
        if (pages.length > 1) {
          button(c, CARD_PAD, h - 26, 22, 13, '<', 'prev');
          button(c, w - CARD_PAD - 22, h - 26, 22, 13, '>', 'next');
          put(g, `${c.page + 1}/${pages.length}`, w / 2, h - 23, INK, 'center');
        }
        c.region(0, 0, w, h, 'close');                           // the whole board closes it (registered last)
      },
      act: (a) => {
        if (a === 'prev') this.cardP?.turn(-1);
        else if (a === 'next') this.cardP?.turn(1);
        else if (a === 'close') this.dismiss();
      },
    });
    this.cardP = p;
    if (!p.show()) { p.dispose(); this.cardP = null; }            // no overlay (menus): the card is simply absent
  }
  private closeCard(): void {
    this.card = 'none';
    const p = this.cardP;
    this.cardP = null;
    p?.hide();
  }
}
