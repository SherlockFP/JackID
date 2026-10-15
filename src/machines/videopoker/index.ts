/**
 * Video Poker "Jacks Up / Deuces Down" (`videopoker`, MACHINES §4). Solo machine, no autoplay.
 *
 * Rounds (logic on the local occupant, presentation on every peer):
 *   READY → DEAL (bet charged in `beginRound`, five cards from a fresh shuffle) → HOLD (1–5 toggle, local)
 *   → DRAW (held mask sent with the result; Second Look may redraw a loss) → WIN (pot waits: DOUBLE or COLLECT)
 *   → DOUBLE PICK (dealer card vs four face-down cards, up to 5 steps) → COLLECT → READY.
 * A losing DRAW or DOUBLE closes the round in the settle step, before the presentation (DECISIONS G).
 *
 * Controls (TECH §11.6): 1–5 hold / pick · Space or Enter deal and draw · R or Alt double · Q collect · B bet max and deal ·
 * Z / X credits · V denomination · G game · E leave. Idle: HOLD 90 s → draw with the current mask and collect; WIN or PICK
 * 15 s → collect.
 *
 * Juice: deal (shuffle, cards flip one by one), draw (held-out cards flip, EVAL row blinks), escalating wins
 * (small pop → medium sparks → big shake → royal: CRT glitch and jackpot stinger; count-up on collect), double
 * (heartbeat during pick, rising win or falling bust), HINT lamps blink when `videopoker.hintOptimal` is unlocked.
 */
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { MachineBase } from '@/machines/_base/MachineBase';
import { juiceTier } from '@/machines/_base/tiers';
import { blinkOn, countUp } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { ScreenSurface } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { ModHook } from '@/game/modifiers.types';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { buildModel, type VideoPokerParts, type VpButton } from './model';
import { STRINGS } from './strings';
import {
  DOUBLE_CAP, DOUBLE_STEPS, DENOMS, HOLD_IDLE_S, MAX_CREDITS, WIN_IDLE_S, type Cat, type Game, type Variant,
  doubleDeal, doubleResult, drawHand, holdHint, holdOdds, newDeck, payCredits, payTable, rankChar, secondLookChance,
  suitChar, isRed, playHeadless,
} from './rules';

export { playHeadless };

type Phase = 'ready' | 'hold' | 'win' | 'pick';
type State = {
  game: Game; credits: number; denom: number;
  phase: Phase;
  hand: number[]; held: number; deck: number[];
  pot: number; steps: number;
  dealer: number; faces: number[];
  cat: Cat;
};

type Ev =
  | { k: 'set'; game: string; credits: number; denom: number }
  | { k: 'deal'; hand: number[] }
  /** `mask` = held cards sent with the draw; `pay` = coins won (0 = no hit). */
  | { k: 'draw'; mask: number; final: number[]; cat: string; pay: number; rerolled: boolean }
  | { k: 'double'; step: number; dealer: number; cards: number[]; pick: number; res: string; pot: number }
  | { k: 'collect'; amount: number; bet: number };

const HOLDS: readonly VpButton[] = ['hold0', 'hold1', 'hold2', 'hold3', 'hold4'];
const CARD_W = 28, CARD_H = 46;
const CRT_BLUE = '#0B1E8C', CRT_YELLOW = '#FFE45C', CARD_WHITE = '#F4F4F0', CARD_RED = '#D01818', CARD_INK = '#101010';
const GAMES: readonly Game[] = ['jacks', 'deuces'];

const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((k) => ({ k: 'm.videopoker.' + k }));

export const def: MachineDef = {
  id: 'videopoker',
  category: 'card',
  slotSize: 'M',
  zone: 'cards',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 125,                         // 5 credits × 25
  maxPayoutMult: 4000,                            // a win is capped at 4 000 credits (double-up cap)
  rtp: 0.9730,                                    // Jacks Up optimal play; Deuces Down 0.9973 (MACHINES §4.2)
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'cards', 'skill'],
  modHooks: {
    'm.videopoker.royalBonus': 'Multiplier on natural royal payouts (base 1, milestone ×2).',
    'videopoker.payTableUpgrade': 'Feature: Jacks Up 9/6 and full-pay Deuces Down.',
    'videopoker.bonusQuads': 'Feature: four aces or four eights pay ×2.',
    'videopoker.hintOptimal': 'Feature: HOLD lamps blink on the suggested hold.',
  },
  strings: STRINGS,
};

export default class VideoPoker extends MachineBase<VideoPokerParts, Ev, State> {
  private state: State = {
    game: 'jacks', credits: MAX_CREDITS, denom: 1, phase: 'ready',
    hand: [], held: 0, deck: [], pot: 0, steps: 0, dealer: 0, faces: [], cat: 'none',
  };
  /** Presentation-only. The screen face-down mask (replaced cards not flipped yet). */
  private backs = 0;
  /** The double-up panel shown while a double resolves: dealer, four faces, pick, result. */
  private dbl: { dealer: number; faces: number[]; pick: number; res: string } | null = null;
  /** Row of the paytable that blinks (the EVAL row / the win row). */
  private evalCat: Cat | '' = '';
  private evalBlink = false;
  private hint = 0;
  private hintOn = false;
  private hintBlink = false;
  private attractLit = false;
  private idle = 0;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<VideoPokerParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.syncBet();
    this.refresh();
    this.showHud();
  }

  // ── attract: the DEAL lamp blinks, the marquee chases ─────────────────────────────────────────────
  attract(_dt: number, time: number): void {
    const on = blinkOn(time, 1.2);
    if (on !== this.attractLit) {
      this.attractLit = on;
      this.parts.buttons.deal.setLit(on);
    }
  }

  /** Round timers (local occupant only): HOLD idle → draw; WIN or PICK idle → collect. */
  tick(dt: number): void {
    if (!this.isLocalOccupant || this.busy) return;
    const ph = this.state.phase;
    if (ph === 'ready') { this.idle = 0; return; }
    this.idle += dt;
    if (ph === 'hold' && this.idle > HOLD_IDLE_S) { this.idle = 0; void this.draw(); }
    else if (ph !== 'hold' && this.idle > WIN_IDLE_S) { this.idle = 0; void this.collect(); }
  }

  /** Blinks the suggested holds (HINT) and the winning paytable row. Render rate, visible only. */
  frame(_dt: number, time: number): void {
    if (this.state.phase === 'hold' && this.hintOn) {
      const on = blinkOn(time, 3);
      if (on !== this.hintBlink) { this.hintBlink = on; this.litHolds(on); }
    }
    if (this.evalCat) {
      const on = blinkOn(time, 3);
      if (on !== this.evalBlink) { this.evalBlink = on; this.drawScreen(); }
    }
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      const s = this.state;
      if ((s.phase === 'hold' || s.phase === 'win' || s.phase === 'pick') && !this.roundOpen) this.resumeRound(this.stake());
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('videopoker', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    // Normal path: standUp() finishes the round first. Safety net for forced / external releases: never strand a stake.
    if (local && this.roundOpen && !this.busy) {
      const s = this.state;
      this.settle({ gross: s.phase === 'win' || s.phase === 'pick' ? s.pot : 0, tags: ['ladder'] });
    }
    this.state.pot = 0; this.state.phase = 'ready'; this.state.held = 0; this.evalCat = '';
    this.refresh();
    if (local) this.seatHud?.hide();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving mid-round finishes it first: a HOLD draws, a WIN or PICK collects. */
  protected override standUp(): void {
    if (this.roundOpen && !this.busy && this.state.phase !== 'ready') { void this.leave(); return; }
    super.standUp();
  }
  private async leave(): Promise<void> {
    if (this.state.phase === 'hold') await this.draw();
    if (this.roundOpen && !this.busy && (this.state.phase === 'win' || this.state.phase === 'pick')) await this.collect();
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    this.idle = 0;
    const ph = this.state.phase;
    switch (a) {
      case 'auto': this.cycleGame(); break;
      case 'camera': this.cycleDenom(); break;
      case 'betUp': this.changeCredits(1); break;
      case 'betDown': this.changeCredits(-1); break;
      case 'betMax':
        if (ph === 'ready' && !this.roundOpen) { this.setCredits(MAX_CREDITS); void this.deal(); }
        break;
      case 'primary': case 'confirm':
        if (ph === 'ready') void this.deal();
        else if (ph === 'hold') void this.draw();
        else void this.collect();
        break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': {
        const i = Number(a[1]) - 1;
        if (ph === 'hold') this.toggleHold(i);
        else if (ph === 'pick' && i < 4) void this.pickCard(i);
        break;
      }
      case 'double': case 'alt': this.startPick(); break;
      case 'collect': case 'secondary': void this.collect(); break;
      default: break;
    }
  }

  private cycleGame(): void {
    if (this.roundOpen || this.busy) return;
    const s = this.state;
    const next = GAMES[(GAMES.indexOf(s.game) + 1) % GAMES.length];
    void this.emit({ k: 'set', game: next, credits: s.credits, denom: s.denom });
  }
  private cycleDenom(): void {
    if (this.roundOpen || this.busy) return;
    const s = this.state;
    const next = DENOMS[(DENOMS.indexOf(s.denom) + 1) % DENOMS.length];
    void this.emit({ k: 'set', game: s.game, credits: s.credits, denom: next });
  }
  private changeCredits(d: number): void {
    this.setCredits(this.state.credits + d);
  }
  private setCredits(c: number): void {
    if (this.roundOpen || this.busy) return;
    const s = this.state;
    const credits = Math.min(MAX_CREDITS, Math.max(1, c));
    if (credits === s.credits) return;
    void this.emit({ k: 'set', game: s.game, credits, denom: s.denom });
  }
  private toggleHold(i: number): void {
    if (this.busy) return;
    this.state.held ^= 1 << i;
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  private variant(): Variant {
    return {
      upgraded: this.feature('videopoker.payTableUpgrade'),
      bonusQuads: this.feature('videopoker.bonusQuads'),
      royalMult: this.mod('m.videopoker.royalBonus' as ModHook, 1),
    };
  }
  private stake(): number { return this.state.credits * this.state.denom; }
  private syncBet(): void { this.bet = this.stake(); }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private async deal(): Promise<void> {
    if (this.busy || this.roundOpen || this.state.phase !== 'ready') return;
    if (!this.beginRound(this.stake())) return;            // charges the bet, busy = true, re-seeds this.rng
    const deck = newDeck(this.rng);
    this.state.deck = deck;                                  // the whole order is fixed here
    const hand = deck.slice(0, 5);
    this.showHud();
    try {
      await this.emit({ k: 'deal', hand });
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  private async draw(): Promise<void> {
    const s = this.state;
    if (this.busy || !this.roundOpen || s.phase !== 'hold') return;
    this.busy = true;
    this.idle = 0;
    const v = this.variant();
    const gate = this.rng.next() < secondLookChance(this.luck());   // always consumed: stream stays aligned
    const out = drawHand(s.deck, s.hand, s.held, s.game, v, gate);
    const pay = Math.floor(payCredits(out, s.credits, v) * s.denom);
    const credit = pay > 0 ? undefined : (): void => { this.settle({ gross: 0, tags: ['nohit'] }); this.busy = true; };
    this.showHud();
    try {
      await this.emit({ k: 'draw', mask: s.held, final: out.final, cat: out.cat, pay, rerolled: out.rerolled }, credit);
    } finally {
      if (this.roundOpen && pay === 0) this.settle({ gross: 0 });   // never strand a stake
      this.busy = false;
      this.showHud();
    }
  }

  private startPick(): void {
    const s = this.state;
    if (this.busy || s.phase !== 'win' || s.steps >= DOUBLE_STEPS || s.pot * 2 > DOUBLE_CAP * s.denom) return;
    const cards = doubleDeal(this.rng);
    s.dealer = cards[0]; s.faces = cards.slice(1);           // dealer face up, four face-down; the pick is the player's
    s.phase = 'pick';
    this.idle = 0;
    this.sfx('heartbeat', { vol: 0.5 });
    this.refresh();
    this.showHud();
  }

  private async pickCard(i: number): Promise<void> {
    const s = this.state;
    if (this.busy || s.phase !== 'pick') return;
    this.busy = true;
    this.idle = 0;
    const res = doubleResult(s.dealer, s.faces[i]);
    const pot = res === 'win' ? s.pot * 2 : s.pot;
    const credit = res === 'lose' ? (): void => { this.settle({ gross: 0, tags: ['bust'] }); this.busy = true; } : undefined;
    try {
      await this.emit({ k: 'double', step: s.steps + 1, dealer: s.dealer, cards: s.faces, pick: i, res, pot }, credit);
    } finally {
      if (this.roundOpen && res === 'lose') this.settle({ gross: 0 });
      this.busy = false;
      this.showHud();
    }
  }

  private async collect(): Promise<void> {
    const s = this.state;
    if (this.busy || !this.roundOpen || (s.phase !== 'win' && s.phase !== 'pick')) return;
    this.busy = true;
    this.showHud();
    const amount = s.pot, bet = this.roundBet;
    const tags = [...(isRoyalCat(s.cat) ? ['jackpot'] : []), ...(s.steps > 0 ? ['ladder'] : [])];
    // credit first, present after (DECISIONS G): a reload mid-show must not lose the pot
    const credit = (): void => { this.settle({ gross: amount, tags }); this.busy = true; };
    const shown = this.emit({ k: 'collect', amount, bet }, credit);
    if (this.roundOpen) credit();                    // the emit was refused: still pay out, never strand the pot
    try { await shown; } finally { this.busy = false; this.showHud(); }
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'set': return this.presentSet(ev);
      case 'deal': return this.presentDeal(ev, pc);
      case 'draw': return this.presentDraw(ev, pc);
      case 'double': return this.presentDouble(ev, pc);
      case 'collect': return this.presentCollect(ev, pc);
    }
  }

  private presentSet(ev: Extract<Ev, { k: 'set' }>): void {
    const s = this.state;
    s.game = ev.game as Game; s.credits = ev.credits; s.denom = ev.denom;
    this.syncBet();
    this.sfx('click');
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentDeal(ev: Extract<Ev, { k: 'deal' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const { buttons, marquee } = this.parts;
    s.hand = ev.hand.slice(); s.held = 0; s.phase = 'hold'; s.pot = 0; s.steps = 0; s.cat = 'none';
    this.evalCat = '';
    this.dbl = null;
    this.hint = holdHint(s.hand, s.game, MAX_CREDITS, this.variant());   // the paytable the hand actually pays
    this.hintOn = this.feature('videopoker.hintOptimal');
    void buttons.deal.press(0.12);
    this.sfx('shuffle');
    marquee.chase('chase', 6);
    if (pc.fast) { this.backs = 0; this.refresh(); return; }
    this.backs = 0x1f;                              // five backs: the cards flip in one by one
    this.refresh();
    await this.wait(0.2);
    for (let i = 0; i < 5; i++) {
      this.backs &= ~(1 << i);
      this.sfx('cardFlip', { vol: 0.8 });
      this.drawScreen();
      await this.wait(0.12);
    }
    this.refresh();
  }

  private async presentDraw(ev: Extract<Ev, { k: 'draw' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const { buttons, marquee, screen } = this.parts;
    const replaced = ~ev.mask & 0x1f;
    s.hand = ev.final.slice(); s.held = ev.mask;
    s.cat = ev.cat as Cat;
    void buttons.deal.press(0.12);
    this.sfx('button');
    if (!pc.fast) {
      this.backs = replaced;
      this.refresh();
      for (let i = 0; i < 5; i++) {
        if (!((replaced >> i) & 1)) continue;
        this.backs &= ~(1 << i);
        this.sfx('cardFlip');
        this.drawScreen();
        await this.wait(0.15);
      }
    }
    this.backs = 0;
    // EVAL: the paytable row of the made hand blinks
    this.evalCat = ev.pay > 0 ? (ev.cat as Cat) : '';
    this.hintOn = false;
    this.litHolds(false);
    this.drawScreen();
    if (!pc.fast) await this.wait(0.5);
    s.pot = ev.pay;
    s.phase = ev.pay > 0 ? 'win' : 'ready';
    if (pc.local) this.callout(this.ctx.run.previewCredit(ev.pay, this.src, { bet: this.roundBet }) - this.roundBet);
    this.refresh();
    if (ev.pay > 0) {
      const tier = juiceTier(ev.pay, this.roundBet, isRoyalCat(ev.cat) ? ['jackpot'] : []);
      const royal = isRoyalCat(ev.cat);
      this.ctx.fx.sparks(screen.mesh, 8 + 4 * (tierRank(tier)), 0xffd040);
      this.ctx.fx.popText(screen.mesh, this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(ev.pay, this.src, { bet: this.roundBet }) : ev.pay) }), 0xffd040, { dur: 1.1, rise: 0.3, scale: 1.1 + 0.1 * tierRank(tier), shake: royal });
      this.ctx.fx.glow(screen.mesh, 0xffd040, 0.3, 0.5);
      if (royal) {
        this.ctx.fx.shake(0.02, 0.4);
        this.sfx('jackpot');
        marquee.chase('win', 12);
      } else {
        this.sfx(tierRank(tier) >= 2 ? 'win3' : tierRank(tier) === 1 ? 'win2' : 'win1');
        marquee.chase('win', 8);
      }
      if (ev.rerolled && pc.local) this.sfx('sparkle', { vol: 0.5, pitch: 7 });
    } else {
      this.commiserate({ amount: this.roundBet, at: screen.mesh });
      marquee.chase('blink', 1.5);
    }
    if (!pc.fast) await this.wait(ev.pay > 0 ? 0.4 : 0.3);
  }

  private async presentDouble(ev: Extract<Ev, { k: 'double' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const { screen } = this.parts;
    this.dbl = { dealer: ev.dealer, faces: ev.cards, pick: -1, res: '' };
    if (!pc.fast) {
      this.dbl.pick = ev.pick;
      this.drawScreen();
      this.sfx('cardFlip', { vol: 0.9 });
      await this.wait(0.3);
    }
    this.dbl = { dealer: ev.dealer, faces: ev.cards, pick: ev.pick, res: ev.res };
    s.steps = ev.step;
    s.pot = ev.pot;
    s.phase = ev.res === 'lose' ? 'ready' : 'win';
    if (pc.local) {
      if (ev.res === 'win') this.callout(this.ctx.run.previewCredit(ev.pot, this.src, { bet: this.roundBet }) - this.roundBet);
      else if (ev.res === 'push') this.seatHud?.result('push', 0);
      else this.callout(-this.roundBet);
    }
    this.drawScreen();
    if (ev.res === 'win') {
      this.ctx.fx.sparks(screen.mesh, 10, 0xffd040);
      this.ctx.fx.popText(screen.mesh, `x2`, 0xffd040, { dur: 0.9, rise: 0.25, scale: 1.2 });
      this.sfx('win2');
    } else if (ev.res === 'push') {
      this.sfx('bell');
    } else {
      this.sfx('lose');
      this.ctx.fx.shake(0.01, 0.2);
      this.commiserate({ amount: this.roundBet, at: screen.mesh });
    }
    this.refresh();
    if (!pc.fast) await this.wait(0.6);
    this.dbl = null;
    this.drawScreen();
  }

  private async presentCollect(ev: Extract<Ev, { k: 'collect' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const { marquee, screen } = this.parts;
    s.pot = 0; s.phase = 'ready'; s.steps = 0; s.held = 0;
    this.evalCat = ''; this.dbl = null;
    if (pc.local) this.callout(ev.amount - ev.bet);
    const tier = juiceTier(ev.amount, ev.bet, isRoyalCat(s.cat) ? ['jackpot'] : []);
    this.refresh();
    if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
      void this.celebrate(tier, { amount: ev.amount, marquee, fast: pc.fast, at: screen.mesh });
      await countUp(this.ctx, 0, ev.amount, pc.fast ? 0.1 : 1.2 * this.speed, (v) => this.drawScreen(v));
    } else {
      await this.pourCoins(ev.amount, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
    }
    this.refresh();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────────
  private litHolds(blink: boolean): void {
    const s = this.state, b = this.parts.buttons;
    HOLDS.forEach((id, i) => {
      const hint = blink && this.hintOn && ((this.hint >> i) & 1) === 1;
      b[id].setLit(((s.held >> i) & 1) === 1 || hint);
    });
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const s = this.state, b = this.parts.buttons;
    this.litHolds(this.hintBlink);
    b.deal.setLit(s.phase === 'ready');
    b.betOne.setEnabled(s.phase === 'ready' && !this.roundOpen);
    b.betMax.setEnabled(s.phase === 'ready' && !this.roundOpen);
    b.game.setEnabled(s.phase === 'ready' && !this.roundOpen);
    b.double.setEnabled(s.phase === 'win' && s.steps < DOUBLE_STEPS);
    b.collect.setEnabled(s.phase === 'win' || s.phase === 'pick');
    this.drawScreen();
  }

  /** The 160 × 120 CRT: paytable (two columns), five cards or the double-up panel, status line. */
  private drawScreen(winShown?: number): void {
    const s = this.state;
    const v = this.variant();
    const rows = payTable(s.game, !!v.upgraded);
    const blinkRow = this.evalBlink ? this.evalCat : '';
    this.parts.screen.draw((g, sc) => {
      g.fillStyle = CRT_BLUE; g.fillRect(0, 0, sc.w, sc.h);
      // paytable: 5 rows per column, 10 px apart
      rows.forEach((r, i) => {
        const x = i < 5 ? 3 : 84, y = 3 + (i % 5) * 10;
        const lit = r.cat === blinkRow;
        if (lit) { g.fillStyle = CRT_YELLOW; g.fillRect(x - 2, y - 1, 77, 9); }
        const col = lit ? CRT_BLUE : CRT_YELLOW;
        sc.text(this.t(`cat_${r.cat}`), x, y, { font: 'px5', color: col });
        sc.text(String(r.ppc), x + 72, y, { font: 'px5', color: col, align: 'right' });   // right-aligned: 'FULL HOUSE ... 250' no longer runs into the next column
      });
      const x0 = (i: number): number => 3 + i * 31;
      if (this.dbl || s.phase === 'pick') {
        // double-up: dealer card face up, four face-down cards (the picked one is revealed)
        const d = this.dbl;
        const dealer = d ? d.dealer : s.dealer;
        drawFace(g, sc, dealer, x0(0), 60);
        sc.text(this.t('dealer'), x0(0), 52, { font: 'px5', color: CRT_YELLOW });
        for (let i = 0; i < 4; i++) {
          const shown = d && d.pick === i;
          if (shown) drawFace(g, sc, d.faces[i], x0(i + 1), 60);
          else drawBack(g, x0(i + 1), 60);
        }
        if (d && d.res) {
          const msg = d.res === 'win' ? this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(s.pot, this.src, { bet: this.roundBet }) : s.pot) }) : this.t(d.res === 'push' ? 'push' : 'bust');
          sc.text(msg, 4, 111, { font: 'px5', color: CRT_YELLOW });
        }
        else sc.text(this.t('pickCard'), 4, 111, { font: 'px5', color: CRT_YELLOW });
      } else {
        for (let i = 0; i < s.hand.length; i++) {
          const x = x0(i);
          if ((this.backs >> i) & 1) drawBack(g, x, 60);
          else drawFace(g, sc, s.hand[i], x, 60);
          if (s.phase === 'hold' && ((s.held >> i) & 1)) sc.text(this.t('held'), x + 1, 52, { font: 'px5', color: CRT_YELLOW });
        }
        const status = winShown !== undefined ? this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(winShown, this.src, { bet: this.roundBet }) : winShown) })
          : s.phase === 'win' ? this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(s.pot, this.src, { bet: this.roundBet }) : s.pot) })
          : s.phase === 'hold' ? this.t('hold')
          : `${this.t(s.game === 'jacks' ? 'gJacks' : 'gDeuces')} ${this.t('credits', { n: s.credits })} ${this.t('denom', { n: s.denom })}`;
        sc.text(status, 4, 111, { font: 'px5', color: CRT_YELLOW });
      }
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.videopoker.tip1', v: { deal: this.k('primary'), hold: `${this.k('n1')}-${this.k('n5')}` } },
      { k: 'm.videopoker.tip2', v: { draw: this.k('primary'), double: this.k('double'), collect: this.k('collect') } },
      { k: 'm.videopoker.tip3', v: { help: this.k('help') } },
    ];
  }

  /** Result callout for the local player: `net` = coins back minus the stake. */
  private callout(net: number): void {
    this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits here. */
  /** Chance (whole percent) that drawing with `mask` (bit i = card i held) ends on a paying hand. */
  private oddsPct(mask: number): number {
    const s = this.state;
    if (s.hand.length !== 5) return 0;
    return Math.round(holdOdds(s.hand, mask, s.game, this.variant()) * 100);
  }

  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const busy = this.busy;
    sh.goal({ k: 'm.videopoker.goal' });

    // STATE: what phase the hand is in
    if (busy) sh.state({ k: 'm.videopoker.stBusy' }, 'cyan');
    else if (s.phase === 'ready') sh.state({ k: 'm.videopoker.stReady' }, 'gold', { k: 'm.videopoker.stReadySub', v: { n: fmtCoins(this.stake()) } });
    else if (s.phase === 'hold') sh.state({ k: 'm.videopoker.stHold' }, 'good', { k: 'm.videopoker.stHoldSub', v: { pct: this.oddsPct(s.held) } });
    else if (s.phase === 'win') sh.state({ k: 'm.videopoker.stWin' }, 'gold', { k: 'm.videopoker.stWinSub' });
    else sh.state({ k: 'm.videopoker.stPick' }, 'warn', { k: 'm.videopoker.stPickSub' });

    // KEY NUMBERS: stake, credits, coin size, balance, then the live hand, pot and doubles
    const nums: HudNumber[] = [
      { label: { k: 'm.videopoker.nBet' }, value: fmtCoins(this.roundOpen ? this.roundBet : this.stake()), tone: 'gold' },
      { label: { k: 'm.videopoker.nCredits' }, value: `${s.credits}/${MAX_CREDITS}`, tone: 'neutral' },
      { label: { k: 'm.videopoker.nCoin' }, value: fmtCoins(s.denom), tone: 'neutral' },
      { label: { k: 'm.videopoker.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
    ];
    if (this.evalCat !== '') nums.push({ label: { k: 'm.videopoker.nHand' }, value: { k: `m.videopoker.cat_${this.evalCat}` }, tone: 'cyan' });
    // DRAW ODDS: chance that the draw ends on a paying hand, for your holds and (when unlocked) the suggested hold
    if (s.phase === 'hold' && !busy) {
      nums.push({ label: { k: 'm.videopoker.nYourOdds' }, value: `${this.oddsPct(s.held)}%`, tone: 'neutral' });
      if (this.hintOn) nums.push({ label: { k: 'm.videopoker.nBestOdds' }, value: `${this.oddsPct(this.hint)}%`, tone: 'good' });
    }
    if (s.pot > 0) nums.push({ label: { k: 'm.videopoker.nPot' }, value: fmtCoins(s.pot), tone: 'good' });
    if (s.phase === 'win' || s.phase === 'pick') nums.push({ label: { k: 'm.videopoker.nDouble' }, value: `${s.steps}/${DOUBLE_STEPS}`, tone: 'warn' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (!busy) {
      if (s.phase === 'ready') {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.videopoker.cDeal' }, action: 'primary', primary: true });
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.videopoker.cCredits' }, action: 'betUp' });
        ctrl.push({ key: this.k('betMax'), label: { k: 'm.videopoker.cMax' }, action: 'betMax' });
        ctrl.push({ key: this.k('camera'), label: { k: 'm.videopoker.cCoin' }, action: 'camera' });
        ctrl.push({ key: this.k('auto'), label: { k: 'm.videopoker.cGame' }, action: 'auto' });
      } else if (s.phase === 'hold') {
        ctrl.push({ key: `${this.k('n1')}-${this.k('n5')}`, label: { k: 'm.videopoker.cHold' }, action: 'n1' });
        ctrl.push({ key: this.k('primary'), label: { k: 'm.videopoker.cDraw' }, action: 'primary', primary: true });
      } else if (s.phase === 'win') {
        ctrl.push({ key: this.k('double'), label: { k: 'm.videopoker.cDouble' }, action: 'double' });
        ctrl.push({ key: this.k('collect'), label: { k: 'm.videopoker.cCollect' }, action: 'collect', primary: true });
      } else {
        ctrl.push({ key: `${this.k('n1')}-${this.k('n4')}`, label: { k: 'm.videopoker.cPick' }, action: 'n1' });
        ctrl.push({ key: this.k('collect'), label: { k: 'm.videopoker.cCollect' }, action: 'collect', primary: true });
      }
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.videopoker.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.videopoker.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    const s = this.state;
    return { ...s, hand: [...s.hand], deck: [...s.deck], faces: [...s.faces] };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, hand: [...s.hand], deck: [...s.deck], faces: [...s.faces] };
    if (this.state.phase === 'pick') this.state.phase = 'win';      // the pick is re-asked from WIN
    this.syncBet();
    if (this.state.phase !== 'ready') this.resumeRound(this.stake());   // a stake still at risk stays settleable
    this.refresh();
  }

}

// ── helpers (canvas, presentation only) ─────────────────────────────────────────────────────────────
function isRoyalCat(c: string): boolean { return c === 'royal' || c === 'naturalRoyal'; }
function tierRank(tier: string): number {
  return tier === 'huge' || tier === 'mega' || tier === 'jackpot' ? 3 : tier === 'big' ? 2 : tier === 'medium' ? 1 : 0;
}
function drawBack(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#1B3FD0'; g.fillRect(x, y, CARD_W, CARD_H);
  g.fillStyle = CARD_WHITE; g.fillRect(x + 3, y + 3, CARD_W - 6, 1); g.fillRect(x + 3, y + CARD_H - 4, CARD_W - 6, 1);
  g.fillStyle = '#2D52E8'; g.fillRect(x + 6, y + 8, CARD_W - 12, CARD_H - 16);
}
function drawFace(g: CanvasRenderingContext2D, sc: ScreenSurface, c: number, x: number, y: number): void {
  g.fillStyle = CARD_WHITE; g.fillRect(x, y, CARD_W, CARD_H);
  const ink = isRed(c) ? CARD_RED : CARD_INK;
  sc.text(rankChar(c), x + 3, y + 3, { font: 'px5', color: ink });
  sc.text(suitChar(c), x + 3, y + 11, { font: 'px5', color: ink });
  sc.text(suitChar(c), x + 13, y + 25, { font: 'px5', color: ink });
}
