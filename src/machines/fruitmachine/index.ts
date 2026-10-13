/**
 * Nudge & Hold fruit machine (`fruitmachine`) — solo occupant, tier 3, gallery (MACHINES §17). Pattern: `pachislot/index.ts`.
 *
 * The logic / present split of the reference machines:
 *  - authority (the local occupant): START charges the stake and runs `rules.startSpin`; a line win opens the HI/LO
 *    gamble (paid on collect), STEP advances the trail, a loss may release HOLD / NUDGE / STEP+1. NUDGE presses run
 *    `rules.nudgeReel`; HI / LO run `rules.gambleStep`. Every step is emitted as a small event and the wallet is
 *    credited inside the emit's `credit` step (settle BEFORE presentation, DECISIONS G).
 *  - a round stays open while nudges remain (busy = false, so the player may leave); START, COLLECT or leaving closes it.
 *  - `present()` is the only place the reels, lamps, LEDs and the top glass change, on every peer. It works from its own
 *    `view`, never from the authority state (presentations run later than the logic).
 *
 * Controls: Space / Enter START · 1 / 2 / 3 hold a reel (lamp lit) or nudge it (nudge phase) · W = HI · S = LO ·
 * Q or RMB COLLECT · Z / X stake · B max stake · H pays · E stand. LMB = Space (the buttons are not individually picked).
 *
 * Charm hooks (`def.modHooks`): holdOdds, gambleSafety, trailStart, and the core `luck`.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import { blinkOn } from '@/machines/_base/juice';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtCoins, t } from '@/core/i18n';
import { buildModel, REEL_X, type FruitParts } from './model';
import {
  HOOK, LADDER, STOPS, SQUARES, TOP_RUNG, canPick, gambleStep, newCore, nudgeReel, openGamble,
  pay, playHeadless, startSpin, type Core, type Feature, type Gamble, type Pick, type Square,
} from './rules';
import { STRINGS } from './strings';

export { playHeadless };

type Pub = { trail: number; hold: boolean; nudges: number };
type SquareEv = { k: Square['k']; m: number; n: number; cash: number; skipped: boolean };
type StartEv = { k: 'start'; stake: number; held: boolean[]; game: number; pub: Pub };
type SpinEv = {
  k: 'spin'; stake: number; stops: number[]; held: boolean[]; line: number; squares: SquareEv[]; release: Feature | null;
  gamble: { shown: number; value: number } | null; forced: boolean; gross: number; pub: Pub;
};
type NudgeEv = {
  k: 'nudge'; stake: number; reel: number; stops: number[]; line: number; squares: SquareEv[];
  gamble: { shown: number; value: number } | null; pub: Pub;
};
type GambleEv = {
  k: 'gamble'; stake: number; pick: 'HI' | 'LO' | 'COLLECT' | 'END'; shown: number; next: number;
  result: 'win' | 'lose' | 'push' | 'collect' | 'end'; value: number; collected: number; done: boolean; safe: boolean; pub: Pub;
};
type Ev = StartEv | SpinEv | NudgeEv | GambleEv;

type State = {
  inited: boolean;
  core: Core;
  games: number;
  /** Stake of the open round (persisted so a reload resumes the gamble or the nudges). */
  stake: number;
  /** Gross paid so far in the open round (cash squares and collected wins). */
  gross: number;
  gamble: Gamble | null;
};

/** Stops per second of the visual reel spin, and each reel's phase. */
const SPIN_RATE = 16;
const SPIN_OFF = [0, 7, 13] as const;
const CYCLE_S = 1.6;
const GAMBLE_S = 10;
const STOP_GAP_S = 0.3;
const FIRST_STOP_S = 1.0;
const LED_AMBER = '#ffb020';

const SQ_KEY: Record<Square['k'], string> = { NUDGE: 'lab_nudge', CASH: 'lab_win', HOLD: 'lab_hold' };

export const def: MachineDef = {
  id: 'fruitmachine',
  category: 'slot',
  slotSize: 'M',
  zone: 'gallery',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 20, betSteps: [1, 2, 5, 10, 20],
  // top line BAG ×100, plus a gamble that climbs to ×100 and trail cash in the same round: ×200 is the host sanity cap
  maxPayoutMult: 200,
  rtp: 0.88,
  tier: 3,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'slot', 'hold', 'nudge', 'gamble'],
  modHooks: {
    'm.fruitmachine.holdOdds': 'Multiplies the feature release chance pf (base 1).',
    'm.fruitmachine.gambleSafety': 'Above 0: the first loss of each HI/LO gamble is a free push.',
    'm.fruitmachine.trailStart': 'Starts the feature trail at square N (1–6). Base 1.',
    luck: 'Luck: float F + 1 × stake per point (cap +20 points).',
  },
  strings: STRINGS,
};

export default class FruitMachine extends MachineBase<FruitParts, Ev, State> {
  private s: State = {
    inited: false, core: newCore(), games: 0, stake: 1, gross: 0, gamble: null,
  };
  /** What the reels, lamps and glass show. Presentation-side only. */
  private view: { stops: number[]; trail: number; hold: boolean; nudges: number; gamble: { shown: number; value: number } | null; win: number; stake: number } = {
    stops: [0, 0, 0], trail: 0, hold: false, nudges: 0, gamble: null, win: 0, stake: 1,
  };
  private picks: boolean[] = [false, false, false];
  private spinSet: boolean[] = [false, false, false];
  private spinT = 0;
  private cycle = 0;
  private gambleT = 0;
  private noT = 0;
  private card = false;
  private attractOn = false;
  private lastBlink = -1;

  protected createModel(kit: KitX): MachineModel<FruitParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    if (!this.s.inited) {
      this.s.core = newCore(Math.max(1, Math.floor(this.mod(HOOK.trailStart, 1))));
      this.s.inited = true;
    }
    this.syncView();
    this.refresh();
  }

  // ── attract: the side bulbs breathe ─────────────────────────────────────────────────────────────
  attract(dt: number, time: number): void {
    const on = Math.floor(time) % 2 === 0;
    if (on !== this.attractOn && !this.occupant) {
      this.attractOn = on;
      this.parts.side.forEach((c) => c.pattern(on ? 'alt' : 'off', 0.5));
    }
    this.attractor.update(dt);
  }

  tick(dt: number): void {
    if (this.cycle > 0) this.cycle = Math.max(0, this.cycle - dt);
    this.spinT += dt;
    const { reels, buttons } = this.parts;
    for (let k = 0; k < 3; k++) {
      if (this.spinSet[k]) reels[k].setIndex(Math.floor((this.spinT * SPIN_RATE + SPIN_OFF[k]) % STOPS));
    }
    if (this.s.gamble && this.isLocalOccupant) {
      this.gambleT -= dt;
      if (this.gambleT <= 0) this.collectGamble();
    }
    if (this.noT > 0) {
      this.noT -= dt;
      if (this.noT <= 0) this.drawGlass();
    }
    // HOLD buttons blink at 3 Hz while a hold is available (picked ones stay lit)
    if (this.view.hold && !this.busy) {
      const on = blinkOn(this.spinT, 3) ? 1 : 0;
      if (on !== this.lastBlink) {
        this.lastBlink = on;
        buttons.hold.forEach((b, r) => b.setLit(this.picks[r] || on === 1));
      }
    } else if (this.lastBlink !== -1) {
      this.lastBlink = -1;
      buttons.hold.forEach((b, r) => b.setLit(this.picks[r]));
    }
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.syncView();
    if (local) {
      this.sfx('chime');
      if (this.s.gamble || this.s.core.nudges > 0 || this.s.gross > 0) this.resumeOpen();
      this.showHud();
    }
    this.refresh();
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      if (this.s.gamble) {                       // leaving with a win on the table collects it
        const v = this.s.gamble.value;
        pay(this.s.core, v);
        this.s.gross += v;
        this.s.gamble = null;
      }
      this.closeRound();
      this.picks = [false, false, false];
      this.card = false;
    }
    this.busy = false;
    this.syncView();
    this.refresh();
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.lever(); break;
      case 'n1': this.pressReel(0); break;
      case 'n2': this.pressReel(1); break;
      case 'n3': this.pressReel(2); break;
      case 'up': this.gamblePick('HI'); break;
      case 'down': this.gamblePick('LO'); break;
      case 'collect': case 'secondary': this.collectGamble(); break;
      case 'betUp': this.changeStake(() => this.stepBet(1)); break;
      case 'betDown': this.changeStake(() => this.stepBet(-1)); break;
      case 'betMax': this.changeStake(() => this.maxBet()); break;
      case 'help': this.card = !this.card; this.sfx('click'); this.drawGlass(); this.showHud(); break;
    }
  }

  private changeStake(fn: () => void): void {
    if (this.busy || this.roundOpen || this.s.gamble) return;
    fn();
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  /** 1 / 2 / 3: nudge the reel during the nudge phase, otherwise pick a hold (max two). */
  private pressReel(r: number): void {
    if (!this.isLocalOccupant || this.busy || this.s.gamble) return;
    if (this.roundOpen && this.s.core.nudges > 0) { this.nudge(r); return; }
    if (!this.view.hold || this.roundOpen) return;
    const on = !this.picks[r];
    if (on && this.picks.filter(Boolean).length >= 2) { this.sfx('buzzer', { vol: 0.4 }); return; }
    this.picks[r] = on;
    this.sfx('click', { vol: 0.7 });
    this.refresh();
    this.showHud();
  }

  // ── authority: START ─────────────────────────────────────────────────────────────────────────────
  private lever(): void {
    if (!this.isLocalOccupant || this.busy || this.s.gamble || this.cycle > 0) return;
    this.closeRound();                                   // unused nudges are lost; the previous round settles here
    if (!this.beginRound(this.bet)) return;               // charges the stake, busy = true
    const stake = this.bet;
    this.s.stake = stake;
    const want = this.picks;
    this.picks = [false, false, false];
    const sp = startSpin(this.rng, this.s.core, stake, this.luck(), want, this.mod(HOOK.holdOdds, 1));
    const cash = sp.squares.reduce((a, q) => a + q.cash, 0);
    let gross = cash;
    let gamble: Gamble | null = null;
    if (sp.line > 0) {
      if (sp.line < TOP_RUNG(stake)) gamble = openGamble(this.rng, sp.line, this.safety());
      else { pay(this.s.core, sp.line); gross += sp.line; }
    }
    this.s.gamble = gamble;
    this.s.gross = gross;
    this.s.games += 1;
    this.cycle = CYCLE_S;
    this.gambleT = GAMBLE_S;
    const ev: SpinEv = {
      k: 'spin', stake, stops: sp.stops, held: sp.held, line: sp.line,
      squares: sp.squares.map(toSquareEv), release: sp.release,
      gamble: gamble ? { shown: gamble.shown, value: gamble.value } : null,
      forced: sp.forced, gross, pub: this.pub(),
    };
    void this.emit(ev, () => this.settleOrWait());
    this.showHud();
  }

  /** A nudge press (authority). Refused when the line would climb above B + F. */
  private nudge(reel: number): void {
    if (!this.isLocalOccupant || this.busy || this.s.gamble || !this.roundOpen) return;
    const stake = this.s.stake;
    const r = nudgeReel(this.s.core, reel, stake, this.luck());
    if (!r.ok) {
      if (r.refused) { this.noT = 0.7; this.sfx('buzzer', { vol: 0.6 }); this.drawGlass(); }
      return;
    }
    const cash = r.squares.reduce((a, q) => a + q.cash, 0);
    this.s.gross += cash;
    let gamble: Gamble | null = null;
    if (r.line > 0) {
      if (r.line < TOP_RUNG(stake)) gamble = openGamble(this.rng, r.line, this.safety());
      else { pay(this.s.core, r.line); this.s.gross += r.line; }
    }
    this.s.gamble = gamble;
    if (gamble) { this.busy = true; this.gambleT = GAMBLE_S; }
    const ev: NudgeEv = {
      k: 'nudge', stake, reel, stops: r.stops, line: r.line, squares: r.squares.map(toSquareEv),
      gamble: gamble ? { shown: gamble.shown, value: gamble.value } : null, pub: this.pub(),
    };
    void this.emit(ev, () => this.settleOrWait());
    this.showHud();
  }

  /** HI / LO on the shown number (authority). A top-rung win collects itself. */
  private gamblePick(pick: Pick): void {
    const g = this.s.gamble;
    if (!g || !this.isLocalOccupant || !canPick(pick, g.shown)) return;
    const stake = this.s.stake;
    const shown = g.shown;
    const st = gambleStep(this.rng, g, pick, stake, this.s.core.bank, this.luck());
    if (st.safetyUsed) g.safety = Math.max(0, g.safety - 1);
    let collected = 0;
    let done = false;
    if (st.result === 'lose') {
      this.s.gamble = null;
      done = true;
    } else {
      g.value = st.value;
      g.shown = st.next;
      if (g.value >= TOP_RUNG(stake)) {
        collected = g.value;
        done = true;
        pay(this.s.core, collected);
        this.s.gross += collected;
        this.s.gamble = null;
      }
    }
    const ev: GambleEv = {
      k: 'gamble', stake, pick, shown, next: st.next, result: st.result, value: st.result === 'lose' ? 0 : st.value,
      collected, done, safe: st.safetyUsed, pub: this.pub(),
    };
    void this.emit(ev, () => this.settleOrWait());
    this.showHud();
  }

  /** COLLECT (authority): pays the gamble value, or closes an open nudge phase. */
  private collectGamble(): void {
    if (!this.isLocalOccupant) return;
    const g = this.s.gamble;
    if (!g) {
      if (!this.roundOpen || this.busy) return;
      const stake = this.s.stake;
      const ev: GambleEv = {
        k: 'gamble', stake, pick: 'END', shown: 0, next: 0, result: 'end', value: 0, collected: 0, done: true, safe: false, pub: this.pub(),
      };
      this.s.core.nudges = 0;
      void this.emit(ev, () => this.closeRound());
      this.showHud();
      return;
    }
    pay(this.s.core, g.value);
    this.s.gross += g.value;
    this.s.gamble = null;
    const ev: GambleEv = {
      k: 'gamble', stake: this.s.stake, pick: 'COLLECT', shown: g.shown, next: g.shown, result: 'collect', value: g.value,
      collected: g.value, done: true, safe: false, pub: this.pub(),
    };
    void this.emit(ev, () => this.settleOrWait());
    this.showHud();
  }

  /** Credit point of every authority step: a gamble or a nudge phase keeps the round open, otherwise it settles. */
  private settleOrWait(): void {
    if (this.s.gamble) return;                          // busy until the gamble is collected or lost
    if (this.s.core.nudges > 0) { this.busy = false; return; }   // nudge phase: the player may leave
    this.closeRound();
  }

  /** Settles the open round once with everything paid in it. Authority only. */
  private closeRound(): void {
    if (!this.roundOpen) return;
    this.s.core.nudges = 0;
    const gross = this.s.gross;
    this.s.gross = 0;
    this.settle({ gross, tags: gross > 0 ? ['fruit'] : [] });
  }

  private resumeOpen(): void {
    this.resumeRound(this.s.stake);
    this.busy = this.s.gamble !== null;
    this.gambleT = GAMBLE_S;
  }

  private safety(): number { return this.mod(HOOK.gambleSafety, 0) > 0 ? 1 : 0; }

  private pub(): Pub {
    return { trail: this.s.core.trail, hold: this.s.core.hold, nudges: this.s.core.nudges };
  }

  // ── presentation: every peer, including the emitter ───────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'spin': return this.presentSpin(ev, pc);
      case 'nudge': return this.presentNudge(ev, pc);
      case 'gamble': return this.presentGamble(ev, pc);
    }
  }

  private setPub(p: Pub): void {
    this.view.trail = p.trail;
    this.view.hold = p.hold;
    this.view.nudges = p.nudges;
  }

  private presentStart(ev: StartEv, pc: PresentCtx): void {
    const { buttons, lamps } = this.parts;
    this.setPub(ev.pub);
    ev.held.forEach((h, k) => { this.spinSet[k] = !h; });
    buttons.start.setLit(false);
    lamps.feature.setOn(false);
    this.view.gamble = null;
    this.view.win = 0;
    this.view.stake = ev.stake;
    this.sfx('lever', { vol: 0.9 });
    this.sfx('ratchet', { vol: 0.5 });
    this.sfx('reelStart', { vol: 0.8 });
    this.refresh();
  }

  private async presentSpin(ev: SpinEv, pc: PresentCtx): Promise<void> {
    const { reels, lamps, leds } = this.parts;
    const fast = pc.fast;
    this.setPub(ev.pub);
    if (!fast) await this.wait(FIRST_STOP_S);
    for (let r = 0; r < REEL_X.length; r++) {
      if (ev.held[r]) { this.spinSet[r] = false; this.view.stops[r] = ev.stops[r]; continue; }
      this.spinSet[r] = false;
      this.view.stops[r] = ev.stops[r];
      void reels[r].stopAt(ev.stops[r], fast ? 0.04 : 0.10, 0.12);
      this.sfx('reelStop', { vol: 0.9, param: r / 2 });
      this.ctx.fx.shake(0.002, 0.06);
      if (!fast) await this.wait(STOP_GAP_S);
    }
    for (const q of ev.squares) this.showSquare(q, fast);
    if (ev.release) {
      lamps.feature.setOn(true);
      const key = ev.release === 'HOLD' ? 'featHold' : ev.release === 'NUDGE' ? 'featNudge' : 'featStep';
      this.ctx.fx.popText(reels[1].root, this.t(key), 0xff6a20, { dur: 1.0, rise: 0.25, scale: 1.1, shake: true });
      this.sfx('jackpot', { vol: 0.5 });
    }
    this.refresh();
    if (ev.line > 0 && ev.gamble) {
      this.view.gamble = ev.gamble;
      this.view.win = ev.line;
      leds.win.set(String(ev.line));
      this.sfx('chime', { vol: 0.8 });
      this.ctx.fx.popText(reels[1].root, this.t('win', { n: fmtCoins(ev.line) }), 0xffd040, { dur: 1.1, rise: 0.3, scale: 1.1 });
      this.refresh();
      return;
    }
    const coins = ev.gross;
    if (coins > 0) {
      this.view.win = coins;
      leds.win.set(String(Math.floor(coins)));
      await this.payShow(coins, ev.stake, fast);
    } else if (ev.squares.length === 0 && !ev.release) {
      this.commiserate({ at: reels[1].root });
    }
    this.refresh();
  }

  private async presentNudge(ev: NudgeEv, pc: PresentCtx): Promise<void> {
    const { reels, leds } = this.parts;
    this.setPub(ev.pub);
    this.view.stops = ev.stops.slice();
    void reels[ev.reel].stopAt(ev.stops[ev.reel], pc.fast ? 0.03 : 0.08, 0.1);
    this.sfx('thud', { vol: 0.8 });
    this.sfx('click', { vol: 0.7, pitch: ev.reel });
    for (const q of ev.squares) this.showSquare(q, pc.fast);
    this.view.gamble = ev.gamble;
    if (ev.gamble) {
      this.view.win = ev.line;
      leds.win.set(String(ev.line));
      this.ctx.fx.popText(reels[1].root, this.t('nudged'), 0xffd040, { dur: 0.8, rise: 0.2, scale: 1.0 });
    } else if (ev.line > 0) {
      await this.payShow(ev.line, ev.stake, pc.fast);
    }
    this.refresh();
  }

  private async presentGamble(ev: GambleEv, pc: PresentCtx): Promise<void> {
    const { reels, leds } = this.parts;
    this.setPub(ev.pub);
    const at = reels[1].root;
    if (ev.result === 'end') {
      this.view.gamble = null;
      this.refresh();
      return;
    }
    if (ev.result === 'lose') {
      this.view.gamble = null;
      this.sfx('buzzer', { vol: 0.9 });
      this.ctx.fx.popText(at, this.t('gambleLost'), 0xff4040, { dur: 0.9, rise: 0.2, scale: 1.1, shake: true });
      this.commiserate({ at });
      this.refresh();
      return;
    }
    if (ev.result !== 'collect') {
      if (!pc.fast) await this.wait(0.25);
      leds.hilo.set(String(ev.next));
    }
    if (ev.result === 'push') {
      this.sfx('click', { vol: 0.9 });
      this.ctx.fx.popText(at, ev.safe ? this.t('gambleSafe') : this.t('push'), 0xdddddd, { dur: 0.8, rise: 0.2, scale: 0.9 });
    } else if (ev.result === 'win') {
      this.sfx('chime', { vol: 0.8, pitch: 1 });
      this.ctx.fx.popText(at, this.t('gambleWon', { n: fmtCoins(ev.value) }), 0xffd040, { dur: 0.9, rise: 0.25, scale: 1.1 });
    }
    this.view.gamble = ev.done || ev.value <= 0 ? null : { shown: ev.next, value: ev.value };
    if (ev.collected > 0) {
      this.view.win = ev.collected;
      leds.win.set(String(Math.floor(ev.collected)));
      await this.payShow(ev.collected, ev.stake, pc.fast);
    }
    this.refresh();
  }

  private showSquare(q: SquareEv, fast: boolean): void {
    const at = this.parts.reels[1].root;
    if (q.skipped) {
      this.ctx.fx.popText(at, this.t('cashSkip'), 0xff6060, { dur: 0.7, rise: 0.2, scale: 0.9 });
      return;
    }
    if (q.k === 'CASH') this.ctx.fx.popText(at, `${this.t('lab_win')} x${q.m}`, 0xffd040, { dur: 0.9, rise: 0.3, scale: 1.0 });
    else if (q.k === 'NUDGE') this.ctx.fx.popText(at, `${this.t('lab_nudges')} ${q.n}`, 0xffb020, { dur: 0.9, rise: 0.3, scale: 1.0 });
    else this.ctx.fx.popText(at, this.t('lab_hold'), 0xffd030, { dur: 0.9, rise: 0.3, scale: 1.0 });
    this.sfx(q.k === 'CASH' ? 'coinDrop' : 'chime', { vol: 0.7 });
    if (!fast) void this.wait(0.05);
  }

  private async payShow(amount: number, stake: number, fast: boolean): Promise<void> {
    const tier = juiceTier(amount, stake);
    if (tierAtLeast(tier, 'medium')) await this.celebrate(tier, { amount, restore: () => this.refresh(), fast });
    else await this.pourCoins(amount, { bet: stake, fast });
    this.refresh();
  }

  // ── late join / save ─────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return JSON.parse(JSON.stringify(this.s)) as State;
  }

  applySnapshot(s: State): void {
    this.s = JSON.parse(JSON.stringify(s)) as State;
    this.syncView();
    if ((this.s.gamble || this.s.core.nudges > 0) && this.isLocalOccupant) this.resumeOpen();
    this.refresh();
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────
  private syncView(): void {
    this.view.stops = this.s.core.stops.slice();
    this.view.stake = this.s.stake;
    this.setPub(this.pub());
    this.view.gamble = this.s.gamble ? { shown: this.s.gamble.shown, value: this.s.gamble.value } : null;
  }

  /** Puts every visual in the resting pose of `view`. Idempotent. */
  private refresh(): void {
    const { reels, buttons, lamps, leds } = this.parts;
    reels.forEach((r, k) => {
      if (!this.spinSet[k]) r.setIndex(this.view.stops[k] ?? 0);   // a spinning reel is left to the tick
    });
    this.lastBlink = -1;
    buttons.hold.forEach((b, r) => b.setLit(this.picks[r]));
    buttons.start.setLit(!this.busy);
    buttons.collect.setLit(this.s.gamble !== null || (this.roundOpen && this.view.nudges > 0));
    buttons.hi.setLit(this.s.gamble !== null);
    buttons.lo.setLit(this.s.gamble !== null);
    lamps.hold.setOn(this.view.hold);
    lamps.feature.setOn(this.view.nudges > 0);
    leds.nudges.set(String(this.view.nudges));
    leds.hilo.set(this.view.gamble ? String(this.view.gamble.shown).padStart(2, '0') : '--');
    leds.bet.set(String(this.bet));
    leds.win.set(String(Math.floor(this.view.win)));
    leds.credit.set(String(Math.floor(this.ctx.run.wallet())));
    this.drawGlass();
  }

  /** Top glass: the feature trail, the HI/LO ladder, the state line (ASCII only, px5 font). */
  private drawGlass(): void {
    const v = this.view;
    const gv = v.gamble;
    const stake = v.stake;
    this.parts.glass.draw((g, sc) => {
      g.fillStyle = '#05080d';
      g.fillRect(0, 0, sc.w, sc.h);
      if (this.card) {
        [0, 1, 2, 3].forEach((i) => sc.text(t(`m.fruitmachine.card${i}`), sc.w / 2, 18 + i * 26, { font: 'px5', color: '#ffd040', align: 'center' }));
        return;
      }
      const cw = sc.w / SQUARES.length;
      SQUARES.forEach((sq, i) => {
        const lit = i === v.trail;
        g.fillStyle = lit ? '#ffb020' : '#2a2030';
        g.fillRect(i * cw + 3, 6, cw - 6, 40);
        const label = sq.k === 'CASH' ? `x${sq.m}` : sq.k === 'NUDGE' ? `${t(`m.fruitmachine.${SQ_KEY[sq.k]}`)} ${sq.n}` : t(`m.fruitmachine.${SQ_KEY.HOLD}`);
        sc.text(label, i * cw + cw / 2, 20, { font: 'px5', color: lit ? '#000000' : '#ffd040', align: 'center' });
      });
      const rungNow = gv ? LADDER.findIndex((m) => m * stake >= gv.value) : -1;
      const lw = sc.w / LADDER.length;
      LADDER.forEach((m, i) => {
        g.fillStyle = i === rungNow ? '#ff5aa0' : '#1c1830';
        g.fillRect(i * lw + 3, 92, lw - 6, 30);
        sc.text(`x${m}`, i * lw + lw / 2, 102, { font: 'px5', color: i === rungNow ? '#000000' : '#ff9ad0', align: 'center' });
      });
      const line = this.noT > 0 ? t('m.fruitmachine.lab_no')
        : gv ? `${t('m.fruitmachine.lab_win')} ${Math.floor(gv.value)}`
        : v.nudges > 0 ? `${t('m.fruitmachine.lab_nudges')} ${v.nudges}`
        : v.hold ? t('m.fruitmachine.lab_hold')
        : t('m.fruitmachine.lab_ready');
      sc.text(line, sc.w / 2, 64, { font: 'px5', color: '#ffffff', align: 'center' });
    });
  }

  private showHud(): void {
    const hints: HudHint[] = [];
    if (this.s.gamble) {
      if (canPick('HI', this.s.gamble.shown)) hints.push({ action: 'up', label: this.t('hi') });
      if (canPick('LO', this.s.gamble.shown)) hints.push({ action: 'down', label: this.t('lo') });
      hints.push({ action: 'collect', label: this.t('collect') });
    } else if (this.roundOpen && this.view.nudges > 0) {
      hints.push({ action: 'n1', label: this.t('nudge', { n: 1 }) }, { action: 'n2', label: this.t('nudge', { n: 2 }) });
      hints.push({ action: 'n3', label: this.t('nudge', { n: 3 }) });
      hints.push({ action: 'collect', label: this.t('collect') });
    } else if (!this.busy) {
      hints.push({ action: 'primary', label: this.t('start') });
      if (this.view.hold) {
        hints.push({ action: 'n1', label: this.t('hold', { n: 1 }) }, { action: 'n2', label: this.t('hold', { n: 2 }) });
        hints.push({ action: 'n3', label: this.t('hold', { n: 3 }) });
      }
      hints.push({ action: 'betUp', label: t('common.bet') }, { action: 'betMax', label: this.t('max') });
      hints.push({ action: 'help', label: this.t('help') });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: this.roundOpen || this.s.gamble ? null : this.bet,
      hints,
      stats: [
        { label: this.t('featNudge'), value: String(this.view.nudges) },
        { label: this.t('lab_win'), value: fmtCoins(this.view.win) },
      ],
    });
  }
}

function toSquareEv(q: { square: Square; cash: number; skipped: boolean }): SquareEv {
  return { k: q.square.k, m: q.square.m, n: q.square.n, cash: q.cash, skipped: q.skipped };
}
