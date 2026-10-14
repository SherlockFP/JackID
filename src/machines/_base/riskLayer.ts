/**
 * RiskLayer (`_base`): the seat-side controller of the risk / reward layer (rules in `game/gamble.ts`, drawing in
 * `game/gambleUi.ts`). MachineBase owns one per local seat and calls it from its bet / settle / input / step paths, so every
 * machine gets DOUBLE OR NOTHING, HIGH STAKES and the ALL-IN SHOT without a line of its own.
 *
 * DOM-free on purpose (the UI arrives through `RiskHost.ui()`), so the node tests drive it with a mock host and a mock run port.
 * Every coin movement goes through `GambleRunPort` (`run.gamble`, see the WIRING note in the wave report); without the port the
 * whole layer stays dormant. Keys (all consumed here, none reach the machine):
 *   G (auto)        open DOUBLE OR NOTHING while the offer after a win is live
 *   left / 1, right / 2   RED / BLACK on the ladder      Q / Space / Enter   collect
 *   Shift+H         HIGH STAKES on / off (Night 2+; plain H stays the machine's rules key)
 *   K               ALL-IN SHOT: first press warns, second press inside 5 s fires (once per Watch)
 */
import { createRng, hashSeed } from '@/core/rng';
import { t, fmtCoins } from '@/core/i18n';
import {
  ALLIN_MIN_POCKET, AllInArm, GAMBLE_MIN_WIN, GAMBLE_OFFER_S, GambleLadder, HS_MULT, HsLedger,
  allInPayout, allInRoll, gamblePortOf, hsUnlocked,
  type CardColor, type GambleCard, type GambleRunPort,
} from '@/game/gamble';
import type { EcoSource } from '@/game/types';

/** The slice of GambleUi the layer draws with. */
export interface RiskUi {
  relang(): void;
  setHighStakes(on: boolean): void;
  showOffer(amount: number): void; hideOffer(): void;
  openLadder(pot: number): void; closeLadder(): void;
  setRung(step: number, pot: number, phase: 'pick' | 'flip' | 'done'): void;
  tension(): void; flip(card: GambleCard, won: boolean): void;
  speak(text: string, tone: 'good' | 'bad' | ''): void; popPot(): void;
  showAllIn(pocket: number, win: number): void; hideAllIn(): void;
  flash(text: string, tone: 'good' | 'bad' | 'gold', frames?: number): void;
  frame(): void; dispose(): void;
}

/** What the layer needs from its machine (MachineBase supplies this). */
export interface RiskHost {
  readonly id: string;
  readonly src: EcoSource;
  readonly runSeed: number;
  readonly shared: boolean;
  readonly isLocalOccupant: boolean;
  readonly roundOpen: boolean;
  busy: boolean;
  run: { wallet(): number; night(): number; window(): string };
  wait(sec: number): Promise<void>;
  toast(text: string, kind?: 'warn' | 'bad' | 'good'): void;
  sfx(name: string): void;
  fx(kind: string, step: number, pot: number): void;
  ui(): RiskUi;
}

interface InputLike { action: string; down: boolean; repeat: boolean; code?: string; mods?: { shift?: boolean } }

export class RiskLayer {
  private port: GambleRunPort | null;
  private readonly _ui: { v: RiskUi | null } = { v: null };
  private clock = 0;
  private offer: { amount: number; until: number } | null = null;
  private ladder: GambleLadder | null = null;
  private phase: 'pick' | 'flip' | 'end' = 'end';
  private exitAsked = false;
  private ladderN = 0;
  private hs = false;
  readonly ledger = new HsLedger();
  private readonly arm = new AllInArm();
  private allInBusy = false;
  private dead = false;

  constructor(private readonly h: RiskHost, port: unknown) { this.port = gamblePortOf(port); }

  // ── state ──
  get active(): boolean { return this.port !== null; }
  get highStakes(): boolean { return this.hs; }
  get ladderOpen(): boolean { return this.ladder !== null || this.allInBusy; }
  get offerLive(): boolean { return this.offer !== null; }
  private ui(): RiskUi { return (this._ui.v ??= this.h.ui()); }
  private fx(kind: string, step = 0, pot = 0): void { this.h.fx(kind, step, pot); }

  // ── input: returns true when the event was consumed ──
  route(e: InputLike): boolean {
    if (!this.port || this.dead) return false;
    if (this.ladderOpen) {                                   // a ladder / all-in flip owns the keyboard
      if (e.down && !e.repeat) this.ladderKey(e);
      return true;
    }
    if (!e.down || e.repeat) return false;
    const code = e.code ?? '';
    if (this.arm.armed(this.clock) && !(code === 'KeyK')) { this.cancelAllIn(); }
    if (this.offer && (e.action === 'auto' || code === 'KeyG')) { void this.openLadder(); return true; }
    if ((e.action === 'help' || code === 'KeyH') && e.mods?.shift) return this.toggleHs();
    if (code === 'KeyK') { this.allInPress(); return true; }
    return false;
  }
  /** The player pressed EXIT: an idle ladder pays out now; a flipping one pays when the card lands. */
  onExit(): void {
    if (!this.ladder) return;
    if (this.phase === 'pick') void this.collect(); else this.exitAsked = true;
  }
  /** The seat was released (stand-up completed): pay any pot still on the ladder, drop the modes. */
  onRelease(): void {
    this.offer = null;
    this.cancelAllIn();
    if (this.ladder && this.ladder.pot > 0) this.payPot('collect');
    this.ladder = null; this.phase = 'end';
    if (this.hs) { this.hs = false; this._ui.v?.setHighStakes(false); }
    this._ui.v?.hideOffer(); this._ui.v?.closeLadder();
  }
  onLang(): void { this._ui.v?.relang(); }
  dispose(): void { this.dead = true; this._ui.v?.dispose(); this._ui.v = null; }

  /** Fixed step: offer countdown, the all-in confirm window. */
  step(dt: number): void {
    this.clock += dt;
    if (this.offer && this.clock >= this.offer.until) { this.offer = null; this._ui.v?.hideOffer(); }
    if (this.armShown && !this.arm.armed(this.clock)) this.cancelAllIn();
  }
  frame(): void { this._ui.v?.frame(); }
  private armShown = false;

  // ── HIGH STAKES ──
  private toggleHs(): boolean {
    if (this.h.shared) return false;
    if (!this.port) { this.h.toast(t('gamble.noPort'), 'warn'); return true; }
    if (!hsUnlocked(this.h.run.night())) { this.h.toast(t('gamble.hsLocked'), 'warn'); return true; }
    if (this.h.busy || this.h.roundOpen) return true;
    this.hs = !this.hs;
    this.ui().setHighStakes(this.hs);
    this.h.toast(t(this.hs ? 'gamble.hsOn' : 'gamble.hsOff'), this.hs ? 'warn' : 'good');
    this.fx(this.hs ? 'hsOn' : 'hsOff');
    return true;
  }
  /**
   * Before a stake: the multiplier this round runs at. 1 = normal; HS_MULT = high stakes (the extra x4 is debited here);
   * 0 = refused (toast shown): not enough pocket for the x5 stake.
   */
  hsBegin(bet: number, cost: number): number {
    this.offer = null; this._ui.v?.hideOffer();
    if (!this.hs || !this.port) return 1;
    const extra = (HS_MULT - 1) * bet;
    if (this.h.run.wallet() < cost + extra) { this.h.toast(t('gamble.hsNoFunds', { m: HS_MULT, need: fmtCoins(cost + extra) }), 'warn'); return 0; }
    return this.port.debit(extra, this.h.src, 'highstakes') ? HS_MULT : 0;
  }
  /** The stake itself was refused after the extra was taken: give the extra back. */
  hsUndo(bet: number): void { this.port?.credit((HS_MULT - 1) * bet, this.h.src, 'highstakes'); }
  /** Settle: reshape the machine's gross and scale it by the round multiplier. Returns the gross to pay (already x mult). */
  hsPay(gross: number, nominalBet: number, mult: number): number {
    if (mult <= 1) return gross;
    const shaped = this.ledger.shape(gross, nominalBet);
    if (shaped > gross) { this.fx('hsBoost', 0, (shaped - gross) * mult); this._ui.v?.flash(t('gamble.hsBoost', { n: fmtCoins((shaped - gross) * mult) }), 'gold'); }
    return shaped * mult;
  }

  // ── DOUBLE OR NOTHING ──
  /** After a credited win: open the offer chip. */
  offerWin(credited: number): void {
    if (!this.port || this.dead || !this.h.isLocalOccupant || credited < GAMBLE_MIN_WIN || this.ladderOpen) return;
    this.offer = { amount: credited, until: this.clock + GAMBLE_OFFER_S };
    this.ui().showOffer(credited);
    this.fx('offer', 0, credited);
  }
  private async openLadder(): Promise<void> {
    const o = this.offer; const port = this.port;
    if (!o || !port || this.ladder) return;
    this.offer = null; this.ui().hideOffer();
    if (this.h.roundOpen || this.h.run.wallet() < o.amount || !port.debit(o.amount, this.h.src, 'gamble')) {
      this.h.toast(t('gamble.noFunds'), 'warn'); return;
    }
    const rng = createRng(hashSeed(this.h.runSeed, this.h.id, 'gamble', ++this.ladderN, o.amount));
    this.ladder = new GambleLadder(rng, o.amount);
    this.phase = 'pick'; this.exitAsked = false;
    this.h.busy = true;
    this.ui().openLadder(o.amount);
    this.fx('open', 0, o.amount);
  }
  private ladderKey(e: InputLike): void {
    if (this.allInBusy || !this.ladder || this.phase !== 'pick') return;
    const a = e.action;
    if (a === 'left' || a === 'n1') void this.pickColor('red');
    else if (a === 'right' || a === 'n2' || a === 'betMax') void this.pickColor('black');
    else if (a === 'collect' || a === 'primary' || a === 'confirm') void this.collect();
  }
  private async pickColor(c: CardColor): Promise<void> {
    const L = this.ladder; if (!L || this.phase !== 'pick') return;
    this.phase = 'flip';
    const ui = this.ui();
    ui.setRung(L.step, L.pot, 'flip'); ui.tension();
    this.fx('tension', L.step + 1, L.pot);
    try {
      await this.h.wait(0.7 + 0.3 * L.step);
      if (this.dead) return;
      const r = L.pick(c);
      ui.flip(r.card, r.won);
      this.fx('flip', r.step, r.pot);
      await this.h.wait(0.6);
      if (this.dead) return;
      if (r.won) {
        ui.popPot(); ui.setRung(r.step, r.pot, r.maxed ? 'done' : 'pick');
        ui.speak(t('gamble.won', { n: fmtCoins(r.pot) }), 'good');
        this.fx(r.maxed ? 'max' : 'win', r.step, r.pot);
        if (r.maxed) { ui.speak(t('gamble.maxed', { n: fmtCoins(r.pot) }), 'good'); await this.h.wait(0.9); this.payPot('max'); this.endLadder(); return; }
        this.phase = 'pick';
        if (this.exitAsked) await this.collect();
      } else {
        ui.setRung(r.step, 0, 'done'); ui.speak(t('gamble.lost'), 'bad');
        this.h.sfx('buzzer');
        this.fx('lose', r.step, 0);
        await this.h.wait(1.1);
        this.endLadder();
      }
    } catch (err) { this.endLadder(); throw err; }
  }
  private async collect(): Promise<void> {
    const L = this.ladder; if (!L || this.phase !== 'pick') return;
    this.phase = 'end';
    this.payPot('collect');
    this.ui().speak(t('gamble.collected', { n: fmtCoins(L.pot) }), 'good');
    await this.h.wait(0.5);
    this.endLadder();
  }
  private payPot(kind: 'collect' | 'max'): void {
    const L = this.ladder;
    if (!L || L.pot <= 0 || !this.port) return;
    const pot = L.pot;
    this.port.credit(pot, this.h.src, 'gamble');
    if (kind === 'collect') this.fx('collect', L.step, pot);
    this._ui.v?.flash(t('gamble.collected', { n: fmtCoins(pot) }), 'good');
    L.drain();                                       // never pay twice (release after a collect)
  }
  private endLadder(): void {
    this.ladder = null; this.phase = 'end';
    this._ui.v?.closeLadder();
    this.h.busy = false;
  }

  // ── ALL-IN SHOT ──
  private allInPress(): void {
    const port = this.port; if (!port) return;
    if (this.h.busy || this.h.roundOpen) return;
    if (this.h.run.window() !== 'watch') return;
    if (port.allInUsed()) { this.h.toast(t('gamble.allinUsed'), 'warn'); return; }
    const pocket = this.h.run.wallet();
    if (pocket < ALLIN_MIN_POCKET) { this.h.toast(t('gamble.allinPoor'), 'warn'); return; }
    if (this.arm.press(this.clock) === 'arm') {
      this.armShown = true;
      this.ui().showAllIn(pocket, allInPayout(pocket));
      this.fx('allinArm', 0, pocket);
      return;
    }
    this.armShown = false;
    void this.fireAllIn();
  }
  private cancelAllIn(): void {
    if (!this.armShown) return;
    this.arm.cancel(); this.armShown = false;
    this._ui.v?.hideAllIn();
    this.fx('allinCancel');
  }
  private async fireAllIn(): Promise<void> {
    const port = this.port; if (!port || this.allInBusy) return;
    const pocket = this.h.run.wallet();
    this.ui().hideAllIn();
    if (pocket < ALLIN_MIN_POCKET || !port.debit(pocket, this.h.src, 'allin')) return;
    port.markAllIn();
    this.allInBusy = true; this.h.busy = true;
    const win = allInRoll(createRng(hashSeed(this.h.runSeed, 'allin', port.watchId())));
    const prize = allInPayout(pocket);
    this.fx('allinFire', 0, pocket);
    this.ui().flash(t('gamble.allinWait'), 'gold', 400);
    try {
      await this.h.wait(1.8);
      if (win) {
        port.credit(prize, this.h.src, 'allin');
        this.fx('allinWin', 0, prize);
        this.ui().flash(t('gamble.allinWin', { n: fmtCoins(prize) }), 'good', 360);
      } else {
        this.fx('allinLose', 0, pocket);
        this.h.sfx('buzzer');
        this.ui().flash(t('gamble.allinLose'), 'bad', 360);
      }
      await this.h.wait(0.8);
    } finally {
      this.allInBusy = false; this.h.busy = false;
    }
  }
}
