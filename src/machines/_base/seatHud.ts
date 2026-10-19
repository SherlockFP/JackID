/**
 * Seat HUD (`_base`) — the readability standard for seated card / table machines. One reusable DOM overlay inside
 * `#ui`, drawn in the PSX style of ui.css (bitmap fonts, high contrast, integer `--u` scale) so it reads at 400×225.
 *
 *   GOAL       one sentence: what wins                         goal(key)
 *   STATE      big banner: whose turn / what phase             state(key, tone, subKey?)
 *   NUMBERS    labelled key figures (bet, balance, totals)     numbers([{label, value, tone}])
 *   CONTROLS   the valid actions RIGHT NOW, with bound keys    controls([{key, label, action, primary}])
 *   RESULT     WIN / LOSE / PUSH / BLACKJACK + amount, 1.5 s   result(kind, amount)
 *   PAY        a machine's symbols and what each pays           pay(items)
 *   COACH      the instruction line while it speaks, the key to press pulsing (coach.ts, from `coach:view`)
 *   RULES      full rules card, opened by the help key         rules(lines) / dismiss()
 *
 * SEATED FOCUS (a seat that takes a stake, `focus`): one instruction line at the top (coach, else goal), BET / POCKET and the big
 * button at the bottom centre with the state title as its caption, the other actions as small chips under it. The pay strip and the
 * odds line wait behind the rules key; `seat-focus` on #ui tells the main HUD to step back to a small quota / clock strip.
 * A seat with no stake whose own screen carries the figures (the bank terminal, the cashier) opts in with `screenSeat()`: the same
 * focus, minus the BET / POCKET box and the numbers row.
 *
 * The RULES card is a 3D placard (`placard3d.ts`): a board held up in front of the eye in the first-person overlay, with
 * bitmap text and page buttons. Everything else is DOM.
 *
 * Lifecycle: the machine calls `show()` when the local player is seated and `hide()` on stand-up. Every text
 * argument is an i18n key (`{ k, v? }`) or a literal string for values that need no translation (numbers). The
 * machine re-sends its content from `onLang()`. While `blocking` is true the machine routes its next action to
 * `dismiss()` and swallows it (any key closes the card; a click on the card closes it too).
 */
import { bus } from '@/core/events';
import { t as tr, fmtCoins, type I18nVars } from '@/core/i18n';
import type { TiltView } from '@/game/circuit';
import type { OddsLine } from '@/game/pace';
import { BRASS, CREAM, INK, INK_SOFT, Placard3D, button, paginate, put, rowsIn, wrapPx5 } from './placard3d';
import type { CoachView } from './coach';
import { STAKE_PRESET_KEYS, type StakePresetKey, type StakePresetsEvent } from './stakePresets';
import { flashPrefs } from './juice';
import { tierAtLeast, type JuiceTier } from './tiers';
import { uiSfx } from '@/core/ui/widgets';
import './seatHud.css';
import './seatHudLayout.css';
import './coach.css';

declare module '@/core/events' {
  interface GameEvents {
    /** The econ lane's high-stake flag: `need` true while the next bet wants a confirm press (the STAKE panel warns). */
    'stake:confirm': { need: boolean };
    /** A HUD term this seat shows (a `TERMS` id of game/terms.ts): the main HUD explains it once per profile. */
    'term:need': { id: string };
  }
}

export type HudTone = 'neutral' | 'gold' | 'good' | 'bad' | 'cyan' | 'warn';
export type HudResultKind = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | 'surrender' | 'even';
/** A translatable text (`{ k: 'm.blackjack.sBet', v: { n: 5 } }`) or a literal (`'16'`). */
export type Txt = string | { k: string; v?: I18nVars };
export interface HudNumber { label: Txt; value: Txt; tone?: HudTone }
export interface HudControl { key: string; label: Txt; action?: string; primary?: boolean }
/** One cell of the pay strip: the symbol's icon (the machine paints it on a `px` square) and what it pays. */
export interface HudPay { px: number; paint(g: CanvasRenderingContext2D): void; pays: string }

const RESULT_KEY: Record<HudResultKind, string> = {
  win: 'hud.seat.kWin', lose: 'hud.seat.kLose', push: 'hud.seat.kPush', blackjack: 'hud.seat.kBlackjack',
  bust: 'hud.seat.kBust', surrender: 'hud.seat.kSurrender', even: 'hud.seat.kEven',
};

const txt = (x: Txt): string => (typeof x === 'string' ? x : tr(x.k, x.v));
/** Bar actions drawn as dim chips (bet, auto, rules, leave); a play action's chip is bright. */
const META = new Set(['help', 'exit', 'betUp', 'betDown', 'auto']);
/** A number cell the BET / POCKET box already shows (`nBet`, `nStake`, `nBalance`, `hNBet`...): focus mode drops it. */
const DUP_NUM = /\.(n|hN)(Bet|Stake|Balance)$/;
/** The state title adds nothing over the big button it captions ("SPIN [SPACE]" over "SPIN"): the caption steps aside. */
export function captionRepeats(caption: string, buttons: readonly string[]): boolean {
  const c = caption.trim().toLocaleUpperCase();
  return c === '' || buttons.some((b) => b.trim() !== '' && c.startsWith(b.trim().toLocaleUpperCase()));
}
/** Count-up length of a big win's amount on the result callout (s). */
const RESULT_COUNT_S = 0.8;

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
  private readonly topEl: HTMLElement;
  private readonly goalEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly stateT: HTMLElement;
  private readonly stateS: HTMLElement;
  /** The big STAKE / POCKET readout (always shown while seated); warns above half the pocket. */
  private readonly stakeEl: HTMLElement;
  private readonly stakeL: HTMLElement;
  private readonly stakeV: HTMLElement;
  private readonly pocketL: HTMLElement;
  private readonly pocketV: HTMLElement;
  /** PULLS per ROUND of the seated machine (`pullRate()`), drawn as a line under the STAKE readout; 0 hides it. */
  private readonly rateEl: HTMLElement;
  private pullsPer = 0;
  /** The smart-stake preset row (stakePresets.ts) and the last state the seated machine published. */
  private readonly presetsEl: HTMLElement;
  private presetsState: StakePresetsEvent | null = null;
  /** Re-places the stack edges (`--seat-top-b` / `--seat-bot-t`) when the goal, banner or stake stack changes size. */
  private readonly stackRo: ResizeObserver | null;
  private stakeBet = 0;
  /** True once THIS machine reported a stake (a round or `stake()`); non-staking seats (terminal, cashier, vendor) never show the readout. */
  private stakeKnown = false;
  /** `screenSeat()`: the seat's own screen carries the figures, so SEATED FOCUS applies without a stake. */
  private screen = false;
  private stakeNeed = false;
  private stakeKey = '';
  private readonly resultEl: HTMLElement;
  private readonly resultT: HTMLElement;
  private readonly resultA: HTMLElement;
  private readonly numsEl: HTMLElement;
  /** The big button (the primary action) beside BET / POCKET, the state title over it as a caption; the rest of the bar is chips. */
  private readonly mainEl: HTMLElement;
  private readonly capEl: HTMLElement;
  /** The last bet the presets reported: a new one (Z / X, a preset) shows at once, a pocket-only change keeps the round's bet. */
  private presetBet = -1;
  private readonly ctrlEl: HTMLElement;
  private readonly payEl: HTMLElement;
  /** The coach box (coach.ts): practice tag, key cap, line, rule; drawn from the last `coach:view`. */
  private readonly coachEl: HTMLElement;
  private coachV: CoachView | null = null;
  private coachKey = '';
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
  /** The open rules card (3D placard), or null. */
  private cardP: Placard3D | null = null;
  private shown = false;
  private card: 'none' | 'rules' = 'none';
  private cancelResult: (() => void) | null = null;

  /** `mount` is normally the machine's `ctx.ui.root` (`#ui`). */
  constructor(mount: HTMLElement) {
    this.root = make('div', 'seat-hud', mount);
    // Top band order (fixed): the Night / Watch clock line (HUD band, above), then the state banner, then the machine tooltip.
    const top = make('div', 'shud-top', this.root);
    this.topEl = top;
    this.stateEl = make('div', 'shud-state shud-panel', top);
    this.stateT = make('span', 'shud-state-t', this.stateEl);
    this.stateS = make('span', 'shud-state-s', this.stateEl);
    // The coach line takes the goal's place while it speaks (SEATED FOCUS: one instruction line at the top).
    this.coachEl = make('div', 'shud-coach shud-panel', top);
    this.coachEl.style.display = 'none';
    this.goalEl = make('div', 'shud-goal shud-panel', top);
    this.payEl = make('div', 'shud-pay shud-panel', top);
    this.payEl.style.display = 'none';
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
    this.numsEl = make('div', 'shud-nums', bottom);
    // One row: BET / POCKET, then the big button with the state title over it
    const main = make('div', 'shud-row', bottom);
    this.stakeEl = make('div', 'shud-stake shud-panel tone-gold', main);
    const betCell = make('span', 'shud-cell shud-bet', this.stakeEl);
    this.stakeL = make('span', 'shud-stake-l', betCell);
    this.stakeV = make('span', 'shud-stake-v', betCell);
    const pocketCell = make('span', 'shud-cell shud-pocket', this.stakeEl);
    this.pocketL = make('span', 'shud-stake-l', pocketCell);
    this.pocketV = make('span', 'shud-stake-v', pocketCell);
    this.rateEl = make('div', 'shud-rate', this.stakeEl);
    this.rateEl.style.display = 'none';
    this.mainEl = make('div', 'shud-main', main);
    this.capEl = make('div', 'shud-cap', this.mainEl);
    // SMART STAKES: the SAFE / BOLD / BIG presets (keys 7 / 8 / 9) under the STAKE readout; drawn from `stake:presets`
    this.presetsEl = make('div', 'shud-presets', bottom);
    this.presetsEl.style.display = 'none';
    // The odds footer is its own row, directly above the control bar (it used to hang on the bar's top edge and cover its keys).
    this.oddsEl = make('div', 'shud-odds shud-panel', bottom);
    this.oddsEl.style.display = 'none';
    this.ctrlEl = make('div', 'shud-ctrl shud-panel', bottom);
    this.stackRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.placeToasts()) : null;
    this.stackRo?.observe(top);
    this.stackRo?.observe(bottom);
    this.offs.push(bus.on('circuit:tilt', (e) => { this.tilt = e.tilt; this.refreshTilt(); }));
    this.offs.push(bus.on('seat:odds', (e) => this.odds(e.line)));
    // the seated machine publishes before it shows the HUD, so the last view is kept and drawn on show()
    this.offs.push(bus.on('coach:view', (e) => { this.coachV = e.view; this.refreshCoach(); }));
    this.offs.push(bus.on('ui:blocking', ({ blocking }) => this.setUiBlocked(blocking)));
    // STAKE: the local player's bet (machine:round) and pocket (wallet) feed the readout; the econ lane may flag a high stake.
    const mine = (pid: number): boolean => pid === SeatHud.stakeSource().self;
    this.offs.push(bus.on('machine:round', (e) => { if (this.shown && mine(e.pid)) { this.stakeBet = e.bet; this.stakeKnown = true; this.refreshStake(); } }));
    this.offs.push(bus.on('machine:result', (e) => { if (mine(e.pid)) this.refreshStake(); }));
    this.offs.push(bus.on('eco:wallet', (e) => { if (mine(e.pid)) this.refreshStake(); }));
    this.offs.push(bus.on('stake:confirm', ({ need }) => { this.stakeNeed = need; this.refreshStake(); }));
    this.offs.push(bus.on('run:stakeConfirm', (e) => { if (mine(e.pid)) { this.stakeNeed = e.state === 'ask'; this.refreshStake(); } }));
    // the seated machine publishes before its machine shows the HUD, so the last state is kept and drawn on show()
    this.offs.push(bus.on('stake:presets', (e) => {
      this.presetsState = e.on ? e : null;
      // a staking seat: BET shows from the first frame, not only after the first round
      if (e.on && this.shown && e.bet !== this.presetBet) { this.presetBet = e.bet; this.stake(e.bet); }
      this.refreshPresets();
      this.pullRate(e.on ? (e.pullCost ?? 1) : null);
    }));
  }

  /**
   * What one play of the seated machine costs in PULLS (`def.actionCost`): "1 PULL = 1 ROUND", "2 PULLS = 1 ROUND". Say what a
   * pull buys. `null`, 0 or a non-number hides the line. The line shows while seated and the UI is not blocking.
   */
  pullRate(perRound: number | null): void {
    this.pullsPer = perRound !== null && Number.isFinite(perRound) && perRound >= 1 ? Math.round(perRound) : 0;
    this.refreshRate();
  }

  /** Repaints the PULLS-per-ROUND line (DOM only on change of the text). */
  private refreshRate(): void {
    const n = this.pullsPer;
    const show = this.shown && !this.uiBlocked && n > 1;   // "1 PULL = 1 ROUND" is the default: only the odd machine says so
    this.rateEl.style.display = show ? '' : 'none';
    if (!show) return;
    const text = n === 1 ? tr('hud.seat.pullRate1') : tr('hud.seat.pullRateN', { n });
    if (this.rateEl.textContent !== text) this.rateEl.textContent = text;
  }

  /** Repaints the SAFE / BOLD / BIG row: the active preset lit, a BIG waiting for its second press blinking. */
  private refreshPresets(): void {
    const s = this.presetsState;
    // Onboarding: a preset row waits for its Night (SeatHud.readout, set by menu/hud.ts). The key still works; only the row waits.
    const allowed = SeatHud.readout().presets;
    // SEATED FOCUS keeps SAFE / BOLD on the row; BIG still works by its key
    const rows = s ? s.rows.filter((r) => allowed.includes(r.key) && !(this.focus && r.key === 'big')) : [];
    const show = this.shown && !this.uiBlocked && s !== null && rows.length > 0;
    this.presetsEl.style.display = show ? '' : 'none';
    if (!show || s === null) return;
    bus.emit('term:need', { id: 'stakes' });   // SAFE / BOLD are on the row: say what they are, once
    this.presetsEl.replaceChildren();
    for (const r of rows) {
      const cls = ['shud-preset', r.key === s.active ? 'on' : '', r.key === s.armed ? 'armed' : ''].filter(Boolean).join(' ');
      const b = make('div', cls, this.presetsEl);
      make('span', 'shud-key shud-preset-k', b).textContent = r.keyLabel;
      make('span', 'shud-preset-l', b).textContent = tr(`stakePreset.${r.key}`);
      make('span', 'shud-preset-v', b).textContent = fmtCoins(r.amount);
    }
  }

  /** A machine's own stake (e.g. set before the round event) for the STAKE readout; the pocket is read from the run. */
  stake(bet: number): void { this.stakeBet = Number.isFinite(bet) && bet > 0 ? bet : 0; this.stakeKnown = true; this.refreshStake(); }

  /** Repaints the STAKE / POCKET readout (cheap: DOM only on change). Warns when the stake is above half the pocket. */
  private refreshStake(): void {
    const pocket = SeatHud.stakeSource().pocket;
    const bet = this.stakeBet;
    const high = bet > pocket * 0.5;
    const show = this.shown && this.stakeKnown;
    const focus = this.focus;
    const key = `${show ? 1 : 0}|${focus ? 1 : 0}|${bet}|${pocket}|${high ? 1 : 0}|${this.stakeNeed ? 1 : 0}`;
    if (key === this.stakeKey) return;
    this.stakeKey = key;
    this.stakeEl.style.display = show ? '' : 'none';
    // SEATED FOCUS is on at a staking seat (and a screen seat): the main HUD (menu/hud) and this overlay drop everything but the play (seatHudLayout.css)
    this.root.classList.toggle('focus', focus);
    if (this.shown) this.root.parentElement?.classList.toggle('seat-focus', focus);   // the other seats' HUDs never touch #ui
    const tone = this.stakeNeed ? 'bad' : high ? 'warn' : 'gold';
    this.stakeEl.className = `shud-stake shud-panel tone-${tone}${this.stakeNeed ? ' need' : ''}`;
    this.stakeL.textContent = tr(this.stakeNeed ? 'hud.stake.confirm' : 'hud.seat.betL');
    this.stakeV.textContent = fmtCoins(bet);
    this.pocketL.textContent = tr('hud.seat.pocketL');
    this.pocketV.textContent = fmtCoins(pocket);
  }

  /**
   * Steps the HUD aside while the UI is blocking (`ui:blocking`, wired in the constructor). Machines can also call it
   * from their own input-mode check: the mode is 'ui' during text entry too, which emits no event.
   */
  setUiBlocked(on: boolean): void {
    this.uiBlocked = on;
    this.root.style.display = on ? 'none' : '';
    this.refreshRate();
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
    // Onboarding: the Tilt bulbs wait for Night 2 (SeatHud.readout). The rule itself applies from Night 1.
    const v: TiltView | null = this.shown && SeatHud.readout().tilt ? this.tilt : null;
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
  /** SEATED FOCUS: seated at a machine that takes a stake (the BET / POCKET box is up), or at a screen seat. */
  get focus(): boolean { return this.shown && (this.stakeKnown || this.screen); }
  /**
   * A seat with no stake whose own screen carries the figures (the bank terminal's CRT, the cashier's board): SEATED FOCUS applies
   * to it too, and the numbers row (the same figures again) is dropped. Call once, after the constructor.
   */
  screenSeat(): void { this.screen = true; this.root.classList.add('screen'); }
  /** The rules card is open: route the next action to `dismiss()`. */
  get blocking(): boolean { return this.card !== 'none'; }
  /** A card or a modal covers the view: DOM drawn over the world (a machine's key chips) steps aside while this is true. */
  get covered(): boolean { return this.card !== 'none' || this.uiBlocked; }

  /** Seated: show the overlay. */
  show(): void {
    this.shown = true; this.root.classList.add('on'); this.root.parentElement?.classList.add('seated');
    // each seat reports its own stake (its presets came before show()); a seat that never does shows no STAKE readout
    this.stakeKnown = this.presetsState !== null; this.stakeBet = this.presetsState?.bet ?? 0; this.presetBet = this.stakeBet;
    this.refreshTilt(); this.refreshStake(); this.refreshRate(); this.refreshPresets(); this.refreshCoach(); this.placeToasts();
  }
  /**
   * The local player's id and pocket for the STAKE readout. The in-game HUD (`menu/hud.ts`) points this at the run while a
   * Night is on; the default reads nothing (zero pocket, no own events).
   */
  static stakeSource: () => { self: number; pocket: number } = () => ({ self: -1, pocket: 0 });
  /**
   * What the seat shows of the onboarding schedule (set by menu/hud.ts from its disclosure rules): the Tilt bulbs, and the
   * stake presets on the row. Everything shows until the HUD sets it.
   */
  static readout: () => { tilt: boolean; presets: readonly StakePresetKey[] } = () => ({ tilt: true, presets: STAKE_PRESET_KEYS });
  /**
   * Whether the floor is open for play (a Night's play window or last call). The in-game session points this at the run;
   * the default says open, so a standalone bench keeps its prompts.
   */
  static floorOpen: () => boolean = () => true;
  /** Stood up: hide everything, drop the result and the rules card. */
  hide(): void {
    this.shown = false;
    this.root.classList.remove('on');
    this.root.parentElement?.classList.remove('seated', 'seat-focus');
    this.clearResult();
    this.refreshStake();
    this.closeCard();
    this.refreshTilt();
    this.refreshRate();
    this.refreshPresets();
    this.refreshCoach();
    this.placeToasts();
  }
  dispose(): void {
    for (const off of this.offs.splice(0)) off(); this.clearResult(); this.cardP?.dispose(); this.cardP = null;
    this.stackRo?.disconnect();
    this.root.parentElement?.style.removeProperty('--seat-top-b');
    this.root.parentElement?.style.removeProperty('--seat-bot-t');
    this.root.remove();
  }

  // ── standard slots ────────────────────────────────────────────────────────────────────────────
  /**
   * Seats whose top edge is a plate or readout of the machine itself (the Big One's JACKPOT plate and meter): the instruction line
   * starts `pct` % down the screen, under that header. The result callout takes the same slot (the line steps aside while it shows),
   * so it never lands on the reels.
   * shortcut: one fixed fraction of the screen height (the seat camera is fixed); a machine whose header moves needs its own measure.
   */
  topBelow(pct: number): void {
    this.root.classList.add('hdr');
    this.topEl.style.top = `${pct}%`;
    this.resultEl.style.top = `${pct}%`;
    this.placeToasts();
  }

  goal(text: Txt): void { this.goalEl.textContent = txt(text); this.placeToasts(); }

  state(text: Txt, tone: HudTone = 'gold', sub?: Txt): void {
    this.stateEl.className = `shud-state shud-panel tone-${tone}`;
    this.stateT.textContent = txt(text);
    this.stateS.textContent = sub === undefined ? '' : txt(sub);
    this.stateS.style.display = this.stateS.textContent === '' ? 'none' : '';
    this.capEl.className = `shud-cap tone-${tone}`;
    this.refreshCap();
    this.placeToasts();
  }

  /**
   * The floor is closed (between Watches, or Dawn): the banner says FLOOR CLOSED instead of an action prompt such as
   * PRESS SPIN. Machines call this in place of their ready state when `SeatHud.floorOpen()` is false.
   */
  floorClosed(): void {
    this.state({ k: 'hud.floorClosed' }, 'neutral', { k: 'hud.floorClosedSub' });
  }

  /**
   * Re-places the stack edges. The toast column (`.px-toasts`, the news and every banner while seated) is NOT moved from here:
   * ui.css anchors it upper right under the HUD's right stack (`--hud-rs-b`), clear of this header, the machine and its tip. An
   * inline `top` under this header used to override that and sat the toasts on the right stack.
   */
  private placeToasts(): void {
    this.placeStack();
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
      const dup = typeof n.label !== 'string' && DUP_NUM.test(n.label.k);   // SEATED FOCUS hides it: the BET / POCKET box says it
      const box = make('div', `shud-num shud-panel tone-${n.tone ?? 'gold'}${dup ? ' dup' : ''}`, this.numsEl);
      make('span', 'shud-num-l', box).textContent = txt(n.label);
      make('span', 'shud-num-v', box).textContent = txt(n.value);
    }
    this.numsEl.style.display = items.length ? '' : 'none';
  }

  /**
   * Only the actions valid right now; pass [] to clear the bar's buttons. The primary action is the big button beside BET / POCKET; the
   * rest is a row of small chips under them, rules as a "?" chip.
   */
  controls(items: HudControl[]): void {
    this.ctrlEl.replaceChildren();
    this.mainEl.replaceChildren(this.capEl);
    for (const c of items) {
      const cls = c.primary ? 'shud-btn main primary' : `shud-btn chip${META.has(c.action ?? '') ? ' meta' : ''}`;
      const b = make('div', cls, c.primary ? this.mainEl : this.ctrlEl);
      if (c.action) b.dataset.action = c.action;
      make('span', 'shud-key', b).textContent = c.key;
      make('span', 'shud-btn-l', b).textContent = c.action === 'help' ? '?' : txt(c.label);
    }
    this.ctrlEl.style.display = this.ctrlEl.childElementCount ? '' : 'none';
    this.refreshCap();
    this.coachKey = '';
    this.refreshCoach();                                  // the pulse sits on a button of the bar just built
  }

  /** The state title over the big button: hidden when it only repeats the button ("SPIN [SPACE]" over SPIN). */
  private refreshCap(): void {
    const labels = [...this.mainEl.querySelectorAll('.shud-btn-l')].map((e) => e.textContent ?? '');
    const t = this.stateT.textContent ?? '';
    this.capEl.textContent = t;
    this.capEl.style.display = labels.length > 0 && captionRepeats(t, labels) ? 'none' : '';
  }

  /** The pay strip under the goal: each symbol's icon and what it pays (`×2`). Null or [] hides it. */
  pay(items: HudPay[] | null): void {
    this.payEl.replaceChildren();
    for (const p of items ?? []) {
      const cell = make('span', 'shud-pay-i', this.payEl);
      const icon = make('canvas', '', cell);
      icon.width = icon.height = p.px;
      const g = icon.getContext('2d');
      if (g) p.paint(g);
      make('span', '', cell).textContent = p.pays;
    }
    this.payEl.style.display = items?.length ? '' : 'none';
    this.placeToasts();
  }

  /**
   * Draws the coach box and pulses the step's key in the bar. A step line shows only while its key is in the bar (the bar
   * lists what is valid right now), and its key cap is the bar's own. A result note (no keys) shows as is.
   */
  private refreshCoach(): void {
    const v = this.shown ? this.coachV : null;
    const btns = (v?.keys ?? []).flatMap((k) => [...this.root.querySelectorAll<HTMLElement>(`.shud-btn[data-action="${k}"]`)]);
    const line = v && (v.keys.length === 0 || btns.length > 0) ? v.line : '';
    const cap = btns.map((b) => b.querySelector('.shud-key')?.textContent ?? '').join('/');
    const key = v ? `${v.keys.join(' ')}|${cap}|${line}|${v.why}|${v.tone}|${v.tag}` : '';
    if (key === this.coachKey) return;
    this.coachKey = key;
    for (const b of this.root.querySelectorAll('.coach-pulse')) b.classList.remove('coach-pulse');
    for (const b of btns) b.classList.add('coach-pulse');
    // SEATED FOCUS: the box is the instruction line, so a bare practice tag (no line to say) leaves the goal in its place
    const show = !!v && (line !== '' || (v.tag !== '' && !this.focus));
    this.coachEl.style.display = show ? '' : 'none';
    this.root.classList.toggle('coaching', show);         // the coach speaks in the goal's place
    if (!v || !show) return;
    this.coachEl.className = `shud-coach shud-panel${v.tone ? ` tone-${v.tone}` : ''}`;
    this.coachEl.replaceChildren();
    make('span', 'shud-coach-tag', this.coachEl).textContent = v.tag;
    make('span', 'shud-key', this.coachEl).textContent = line ? cap : '';
    make('span', 'shud-coach-l', this.coachEl).textContent = line;
    make('span', 'shud-coach-s', this.coachEl).textContent = v.why;
  }

  /**
   * Colour-coded callout held for `hold` seconds. `amount` = net coins (negative = lost). `tier` (optional): the round's
   * tier, or for a loss the tier of the stake. A win at big or above slams in with a gold glow and counts up over 0.8 s
   * (numberTick). A loss at big or above flashes red once. The slam and the red flash are off under reduce-flashing / calm.
   */
  result(kind: HudResultKind, amount = 0, hold = 1.5, label?: string, tier?: JuiceTier): void {
    this.clearResult();
    if (this.coachV?.tag) amount = 0;                    // a practice round (coach.ts): nothing was won or lost, so no amount
    const prefs = flashPrefs();
    const big = tier !== undefined && tierAtLeast(tier, 'big');
    const slam = big && amount > 0;
    const cls = ['shud-result', `r-${kind}`];
    if (slam) { cls.push('gold'); if (!prefs.reduced && !prefs.calm) cls.push('slam'); }
    if (big && amount < 0 && !prefs.reduced && !prefs.calm) cls.push('red');
    this.resultEl.className = cls.join(' ');
    this.resultT.textContent = label ?? tr(RESULT_KEY[kind]);
    this.resultA.textContent = slam ? `+${fmtCoins(0)}` : amount > 0 ? `+${fmtCoins(amount)}` : amount < 0 ? `-${fmtCoins(-amount)}` : '';
    this.resultA.style.display = amount === 0 ? 'none' : '';
    void this.resultEl.offsetWidth;                       // restart the pop-in
    this.resultEl.classList.add('on');
    this.root.classList.add('res');
    const endMs = hold * 1000;
    let start = -1;                                       // the first frame's timestamp: the callout's clock
    let live = true;
    let last = -1;
    const tick = (now: number): void => {
      if (!live) return;
      if (start < 0) start = now;
      const el = now - start;
      if (slam && el < endMs) {
        const k = Math.min(1, el / (RESULT_COUNT_S * 1000));
        const v = Math.round(amount * (1 - Math.pow(1 - k, 3)));          // outCubic count-up
        if (v !== last) { last = v; this.resultA.textContent = `+${fmtCoins(v)}`; uiSfx('numberTick', 0.5); }
      }
      if (el >= endMs) {
        if (slam) this.resultA.textContent = `+${fmtCoins(amount)}`;
        this.resultEl.classList.remove('on'); this.root.classList.remove('res'); this.cancelResult = null; return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.cancelResult = () => { live = false; };
  }
  private clearResult(): void {
    this.cancelResult?.();
    this.cancelResult = null;
    this.resultEl.classList.remove('on');
    this.root.classList.remove('res');
  }

  // ── cards ─────────────────────────────────────────────────────────────────────────────────────
  /** Full rules card (the help key). */
  rules(lines: Txt[], title?: Txt): void {
    this.openCard(title === undefined ? tr('hud.seat.rulesTitle') : txt(title), lines);
  }

  /** Closes the open card. Returns true when something closed. */
  dismiss(): boolean {
    if (this.card === 'none') return false;
    this.closeCard();
    return true;
  }

  /** The card as a 3D placard: short bulleted rules, paginated, with page buttons; a click on the board closes it. */
  private openCard(title: string, lines: Txt[]): void {
    this.cardP?.dispose();
    this.card = 'rules';
    this.root.classList.add('rules-on');                  // SEATED FOCUS: the pay strip and the odds come back with the rules
    const rows: string[] = [];
    for (const l of lines) for (const r of wrapPx5(`• ${txt(l)}`, CARD_TEXT_W)) rows.push(r);
    const pages = paginate(rows, rowsIn(CARD_BODY_H));
    const hint = tr('hud.seat.anyKey');
    const p = new Placard3D({
      name: 'seat-rules',
      w: CARD_W, h: CARD_H, px: CARD_PX,
      pages: () => pages.length,
      bg: CREAM,
      frame: { color: 0x6b4f1d, pad: 0.012, depth: 0.008 },
      rest: [0, -0.03, -0.5],
      onGone: () => {
        if (this.cardP !== p) return;                              // dismissed by hand already (or replaced)
        this.card = 'none'; this.cardP = null; this.root.classList.remove('rules-on');
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
    this.root.classList.remove('rules-on');
    const p = this.cardP;
    this.cardP = null;
    p?.hide();
  }
}
