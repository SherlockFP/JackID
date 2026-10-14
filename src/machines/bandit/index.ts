/**
 * One-Armed Bandit (`bandit`) — solo slot, MACHINES_machines §3. Built on the coinflip reference pattern.
 *
 * What it demonstrates
 *  - the logic / present split: `pull()` rolls on the authority (the local occupant) with the pure `rules.ts`, packs the
 *    full outcome into a `pull` event and `emit`s it; `presentPull()` is the only place reels and lamps move, on every peer;
 *  - a pointer-driven lever (`pick` pose): drag the knob down past the trip angle to pull, Space = automatic pull;
 *    the lever is streamed as cosmetic `lever` events to watchers (≤ 15 Hz);
 *  - the settle-before-present rule (DECISIONS G): the wallet is credited in the emit's credit step, then the reels show it;
 *  - juice: lever ratchet and spring, reel spin, staggered stops at 1.2 / 1.6 / 2.0 s with clacks, Lucky Nudge clunk,
 *    mechanical bell rings per 10 credits, hopper coins or a tiered celebration, near-miss tease, loss feedback;
 *  - horror: the maw fills with every loss and swallows the pile after five losses in a row; the eye vents glow;
 *    THUMP (3 in 10 s) locks the cabinet into TILT for 8 s;
 *  - charm hooks `m.bandit.*` (see `def.modHooks`), attract mode (breathing reel lamp, an occasional lever twitch),
 *    snapshots for late joiners, and `playHeadless` for staff auto-play and sims.
 *
 * Controls: Space pull · LMB-drag the knob (release past the trip) · wheel / Z / X credits · B max credits ·
 * 1 cycles the coin · 2 thump · E stand.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp, breathe } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { Kit, ScreenSurface } from '@/kit/types';
import { fmtCoins } from '@/core/i18n';
import { px5Width } from '@/core/texgen/font';
import { clamp, lerp } from '@/core/math';
import { buildModel, LEVER_MAX, LEVER_TRIP, MAW_COINS, type BanditParts } from './model';
import {
  DENOMS, facetOf, HOOK_JACKPOT, HOOK_LUCK, MAX_CREDITS, STOPS, coinsFor, playHeadless, readCfg, roll, tagsOf,
  type PayCfg, type Roll, type Sym,
} from './rules';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { STRINGS } from './strings';

export { playHeadless };

const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((k) => ({ k: 'm.bandit.' + k }));

type Ev =
  | { k: 'lever'; angle: number }
  /** One pull. `stops` are the final physical stops; `nudge` the reel moved one stop after the base result. */
  | { k: 'pull'; credits: number; denom: number; stops: [number, number, number]; nudge: { reel: number; dir: number } | null;
    pay: number; kind: string; forced: boolean; near: boolean; tags: string[] }
  | { k: 'tilt'; until: number };
type State = { stops: [number, number, number]; tiltUntil: number; round: number; losses: number; lastWin: number };

const LEVER_SENS = 2.6;            // rad of lever per unit of screen height
const LEVER_EMIT_MS = 66;          // ≤ 15 Hz cosmetic lever stream
const THUMP_WINDOW_MS = 10000, THUMP_LIMIT = 3, TILT_MS = 8000;
const SPIN_RPS = 6;                // reel revolutions per second while spinning
const STOP_AT = [1.2, 1.6, 2.0];   // seconds after the lever trips, per reel (the mechanical stop order)
const GOLD = 0xffd040, RED = 0xff3020;
const SHOE_TEXT = 'SHOE';
/** Largest integer px5 scale (≤ maxS) at which `text` fits the box; never below 1. */
const fitScale = (text: string, maxW: number, maxH: number, maxS: number): number => {
  for (let s = maxS; s > 1; s--) if (px5Width(text, s) <= maxW && 7 * s <= maxH) return s;
  return 1;
};

export const def: MachineDef = {
  id: 'bandit',
  category: 'slot',
  slotSize: 'S',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 75, betSteps: [1, 2, 3, 5, 10, 15, 25, 50, 75],
  maxPayoutMult: 2000,             // top award at 3 credits on a 3-credit bet is ×1 667 base; charms add headroom
  rtp: 0.92,                       // 91.96 % (1–2 credits) / 92.98 % (3 credits), see the sim in rules.ts
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'reels', 'slot', 'horror'],
  modHooks: {
    'm.bandit.luckBonus': 'Lucky Nudge percent (0 = off, max nudge chance 30 %).',
    'm.bandit.payoutMult': 'Multiplies every payout. Base 1.',
    'm.bandit.jackpotChance': 'Extra STAR×3 chance on a non-jackpot pull: (mult − 1) / 65 536. Base 1.',
    'm.bandit.shoeWild': 'SHOE substitutes for PLUM, ORANGE and MELON in a triple when > 0.',
    'm.bandit.thirdCoinBonus': 'Multiplier on the 3-credit top-award bonus (base 1; the bonus is 2 000 of the 5 000).',
    'm.bandit.symbolPayAdd.SYM': 'Adds coins per credit to a triple of SYM (STAR, PLUM, ORANGE, MELON, BAR, 2BAR, 3BAR, SHOE).',
  },
  strings: STRINGS,
};

export default class Bandit extends MachineBase<BanditParts, Ev, State> {
  private state: State = { stops: [0, 0, 0], tiltUntil: 0, round: 0, losses: 0, lastWin: 0 };
  private credits = 1;
  private denomIdx = 0;
  private leverAngle = 0;
  private dragging: { y0: number; a0: number } | null = null;
  private lastLeverEmit = -1e9;
  private thumps: number[] = [];
  private lampOn = false;
  private tiltLampOn = false;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: Kit): MachineModel<BanditParts> {
    return buildModel(kit, this.modelOpts);
  }

  private get denom(): number { return DENOMS[this.denomIdx]; }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.bet = this.credits * this.denom;
    this.refresh();
    this.drawAward();
    this.attractor.every('jiggle', 45, () => this.jiggleLever(), { jitter: 15, first: 30 });
  }

  // ── attract: the reel lamp breathes, the lever twitches now and then, as if touched by no one ────────────
  attract(dt: number, time: number): void {
    const on = breathe(time, 0.3) > 0.5;
    if (on !== this.lampOn) { this.lampOn = on; this.parts.lampReel.setOn(on); }
    this.attractor.update(dt);
  }

  private jiggleLever(): void {
    if (this.busy || this.occupant !== null || this.roundOpen) return;
    this.setLever(0.15);
    void this.anim(0.4, (k) => this.setLever(0.15 * (1 - k)));
  }

  tick(_dt: number): void {
    const on = this.tiltOn();
    if (on !== this.tiltLampOn) { this.tiltLampOn = on; this.parts.lampTilt.setOn(on); this.showHud(); }
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('bandit', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    this.dragging = null;
    this.attractor.reset();
    this.refresh();
    if (local) { this.setLever(0); this.seatHud?.hide(); }
  }

  onLang(): void {
    this.drawAward();
    this.drawLeds();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ─────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax' || a === 'n1';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': void this.pull(); break;
      case 'betUp': this.changeBet(() => { this.credits = Math.min(MAX_CREDITS, this.credits + 1); }); break;
      case 'betDown': this.changeBet(() => { this.credits = Math.max(1, this.credits - 1); }); break;
      case 'betMax': this.changeBet(() => { this.credits = this.affordableCredits(); }); break;
      case 'n1': this.changeBet(() => { this.denomIdx = (this.denomIdx + 1) % DENOMS.length; }); break;
      case 'n2': this.thump(); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (!this.isLocalOccupant) return;
    if (e.type === 'down' && e.button === 0) {
      if (this.busy || this.roundOpen || this.tiltOn()) return;      // the latch holds the lever while reels spin
      if (this.pick([this.parts.knob])) this.dragging = { y0: e.ndc.y, a0: this.leverAngle };
    } else if (e.type === 'move' && this.dragging) {
      const a = clamp(this.dragging.a0 + (this.dragging.y0 - e.ndc.y) * LEVER_SENS, 0, LEVER_MAX);
      this.setLever(a);
      const now = this.ctx.net.hostTime();
      if (now - this.lastLeverEmit >= LEVER_EMIT_MS) { this.lastLeverEmit = now; void this.emit({ k: 'lever', angle: a }); }
    } else if (e.type === 'up' && this.dragging) {
      const a = this.leverAngle;
      this.dragging = null;
      if (a >= LEVER_TRIP) void this.pull();
      else void this.anim(0.4, (k) => this.setLever(a * (1 - k)));           // no pull: springs back
    }
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.bet = this.credits * this.denom;
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  private affordableCredits(): number {
    const n = Math.floor(this.ctx.run.wallet() / this.denom);
    return Math.max(1, Math.min(MAX_CREDITS, n));
  }

  private tiltOn(): boolean { return this.ctx.net.hostTime() < this.state.tiltUntil; }

  /** Three thumps in 10 s lock the cabinet into TILT (cosmetic jolt + an 8 s lockout). */
  private thump(): void {
    if (!this.isLocalOccupant) return;
    const now = this.ctx.net.hostTime();
    this.thumps = this.thumps.filter((x) => now - x < THUMP_WINDOW_MS);
    this.thumps.push(now);
    this.sfx('thud', { vol: 0.6 });
    this.ctx.fx.shake(0.006, 0.15);
    if (this.thumps.length >= THUMP_LIMIT && !this.tiltOn()) {
      this.thumps = [];
      void this.emit({ k: 'tilt', until: now + TILT_MS });
    }
  }

  // ── authority-side logic: runs only on the local occupant ──────────────────────────────────────
  private payCfg(): PayCfg {
    return readCfg((hook, base) => this.mod(hook, base));
  }

  private async pull(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    if (this.tiltOn()) { this.sfx('buzzer'); this.toast(this.t('tiltMsg'), 'sys'); return; }
    if (!this.beginRound(this.bet)) return;                    // charges the wallet, busy = true, re-seeds this.rng
    const credits = this.credits, denom = this.denom;
    this.showHud();
    let r: Roll | null = null;
    try {
      const luck = this.luck() + this.mod(HOOK_LUCK, 0);
      r = roll(this.rng, { credits, luck, cfg: this.payCfg(), jackpot: this.mod(HOOK_JACKPOT, 1) });
      const pay = coinsFor(r.line.units, denom);
      const tags = tagsOf(r);
      const ev: Ev = {
        k: 'pull', credits, denom, stops: r.seg, nudge: r.nudge, pay, kind: r.line.kind, forced: r.forced, near: r.near, tags,
      };
      // settle before presentation (DECISIONS G): the wallet is credited, then the reels show the result
      const credit = (): void => { this.settle({ gross: pay, tags }); this.busy = true; };
      await this.emit(ev, credit);
    } finally {
      if (this.roundOpen) this.settle({ gross: 0 });           // never strand a stake (rule 7)
      this.busy = false;
    }
    this.showHud();
  }

  // ── presentation: every peer, including the emitter ────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'lever': if (!pc.local) this.setLever(ev.angle); return;
      case 'pull': return this.presentPull(ev, pc);
      case 'tilt': return this.presentTilt(ev, pc);
    }
  }

  private async presentPull(ev: Extract<Ev, { k: 'pull' }>, pc: PresentCtx): Promise<void> {
    const P = this.parts;
    const fx = this.ctx.fx;
    const fast = pc.fast;
    const s = this.state;
    s.round++;
    s.stops = ev.stops;
    // base stops are the final ones with the nudged reel moved back one stop
    const base: [number, number, number] = [ev.stops[0], ev.stops[1], ev.stops[2]];
    if (ev.nudge) base[ev.nudge.reel] = (ev.stops[ev.nudge.reel] - ev.nudge.dir + STOPS) % STOPS;
    const won = ev.pay > 0;

    if (fast) {
      P.reels.forEach((reel, r) => reel.setIndex(facetOf(r, ev.stops[r])));
      this.setLever(0);
    } else {
      // 1. lever: ratchet pull to the trip, then a damped spring back
      const a0 = this.leverAngle;
      const top = Math.max(a0, LEVER_TRIP);
      this.sfx('lever');
      await this.anim(0.12, (k) => this.setLever(lerp(a0, top, k)));
      if (this.disposed) return;
      // 2. reels start: the latch drops, drums blur
      P.latch.visible = true;
      P.reels.forEach((reel) => reel.startSpin(SPIN_RPS));
      this.sfx('reelStart');
      const spring = this.anim(0.5, (k) => this.setLever(top * (1 - k) * (1 + 0.12 * Math.sin(k * Math.PI * 3) * (1 - k))));
      this.sfx('ratchet');
      await spring;
      this.setLever(0);
      // 3. stops in order, 1.2 / 1.6 / 2.0 s after the lever trips
      let last = 0.62;                                       // the lever pull and spring already took 0.62 s
      for (let r = 0; r < 3; r++) {
        await this.wait(Math.max(0, STOP_AT[r] - last));
        last = STOP_AT[r];
        if (this.disposed) return;
        P.reels[r].stopAt(facetOf(r, base[r]), 0.32, 0.25);
        this.sfx('reelStop', { vol: 0.9 });
        if (r === 2) fx.shake(0.003, 0.12);
      }
      await this.wait(0.35);
      P.latch.visible = false;
      // 4. Lucky Nudge: a solenoid clunk moves one reel one stop
      if (ev.nudge) {
        this.sfx('thud', { vol: 0.8 });
        P.reels[ev.nudge.reel].stopAt(facetOf(ev.nudge.reel, ev.stops[ev.nudge.reel]), 0.14, 0);
        fx.popText(P.reels[ev.nudge.reel].root, this.t('nudge'), GOLD, { dur: 0.9, rise: 0.2, scale: 0.9 });
        await this.wait(0.35);
      }
    }
    if (this.disposed) return;

    // 5. verdict
    s.lastWin = ev.pay;
    s.losses = won ? 0 : s.losses + 1;
    const net = ev.pay - ev.credits * ev.denom;
    if (pc.local) this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
    this.drawLeds(ev.pay);
    if (won) {
      const bet = ev.credits * ev.denom;
      const tier = juiceTier(ev.pay, bet, ev.tags);
      if (ev.kind === 'top' || ev.forced) fx.popText(P.reels[1].root, this.t('jackpot'), GOLD, { dur: 1.4, rise: 0.4, scale: 1.4, shake: true });
      this.sfx(ev.pay >= bet * 10 ? 'jackpot' : ev.pay >= bet * 3 ? 'win2' : 'win1');
      const rings = Math.max(1, Math.min(8, Math.floor(ev.pay / (10 * ev.denom))));
      if (!fast) for (let i = 0; i < rings; i++) { this.sfx('bell', { vol: 0.7 }); await this.wait(0.2); }
      P.lampReel.blink(6, 1.2);
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
        void this.celebrate(tier, { amount: ev.pay, lamps: [P.lampReel, P.lampCoin], restore: () => P.lampReel.setOn(true), fast });
        await countUp(this.ctx, 0, ev.pay, fast ? 0.1 : 1.2 * this.speed, (v) => this.drawLeds(v));
      } else {
        await this.pourCoins(ev.pay, { bet, fast, onCount: (v) => this.drawLeds(v) });
      }
    } else {
      if (ev.near) await this.nearMiss({ dur: 0.9, at: P.reels[2].root, lamps: [P.lampReel], fast });
      else this.commiserate({ at: P.reels[2].root });
      if (s.losses >= 5 && !fast) await this.swallow();
    }
    if (!this.disposed) this.refresh();
  }

  /** The maw takes the pile after five losses in a row: the coins sink away, the eye vents glow for 2 s. */
  private async swallow(): Promise<void> {
    const P = this.parts;
    this.ctx.fx.popText(this.model.anchors.fxTwist, this.t('swallowed'), RED, { dur: 1.6, rise: 0.3, scale: 1.1 });
    P.eyes.forEach((e) => { e.setColor(RED); e.setOn(true); });
    await this.anim(1.2, (k) => { P.maw.position.y = -0.05 * k; P.maw.count = Math.round(MAW_COINS * (1 - k)); });
    P.maw.position.y = 0;
    P.maw.count = 0;
    await this.wait(2.0);
    P.eyes.forEach((e) => e.setOn(false));
    this.state.losses = 0;
    P.maw.count = 8;
  }

  private presentTilt(ev: Extract<Ev, { k: 'tilt' }>, pc: PresentCtx): void {
    this.state.tiltUntil = ev.until;
    this.sfx('buzzer');
    this.parts.lampTilt.blink(4, 8);
    if (pc.local) this.toast(this.t('tiltMsg'), 'sys');
    this.showHud();
  }

  // ── late join / save ───────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, stops: [...this.state.stops] as [number, number, number] };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, stops: [...s.stops] as [number, number, number] };
    this.refresh();
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  private setLever(a: number): void {
    this.leverAngle = a;
    this.parts.lever.rotation.x = -a;
  }

  /** Put every visual in the resting pose of `this.state` (drums on their stops, LEDs, lamps). Idempotent. */
  private refresh(): void {
    const P = this.parts;
    P.reels.forEach((reel, r) => reel.setIndex(facetOf(r, this.state.stops[r])));
    P.latch.visible = false;
    P.lampCoin.setOn(this.occupant !== null);
    P.maw.count = Math.min(MAW_COINS, 8 + 4 * this.state.losses);
    this.drawLeds();
    if (this.isLocalOccupant) this.showHud();
  }

  /** The three red 7-segment style LEDs: wallet, bet, win (the win LED shows `winShown` while counting up). */
  private drawLeds(winShown?: number): void {
    const L = this.parts.leds;
    const wallet = this.ctx.run.wallet();
    const bet = this.roundOpen ? this.roundBet : this.bet;
    this.drawLed(L.credit, `${fmtCoins(wallet)}`);
    this.drawLed(L.bet, `${fmtCoins(bet)}`);
    this.drawLed(L.win, `${fmtCoins(winShown ?? this.state.lastWin)}`);
  }

  private drawLed(s: ScreenSurface, text: string): void {
    s.draw((g, sc) => {
      g.fillStyle = '#200404'; g.fillRect(0, 0, sc.w, sc.h);
      const k = fitScale(text, sc.w - 8, sc.h - 4, 4);
      sc.text(text, sc.w / 2, Math.floor((sc.h - 7 * k) / 2), { font: 'px5', scale: k, color: '#FF3020', align: 'center' });
    });
  }

  /** The 128 × 64 award glass: the paytable per credit, centre line. Redrawn on language change. */
  private drawAward(): void {
    const names = (s: Sym): string => this.t(`sym_${s}`);
    this.parts.award.draw((g, sc) => {
      g.fillStyle = '#0c0c14'; g.fillRect(0, 0, sc.w, sc.h);
      g.fillStyle = '#1E4D7A'; g.fillRect(0, 0, sc.w, 24);
      const title = this.t('paytable'), ts = fitScale(title, sc.w - 8, 22, 3);
      sc.text(title, sc.w / 2, 1 + Math.floor((22 - 7 * ts) / 2), { font: 'px5', scale: ts, color: '#F0E6CC', align: 'center' });
      // two columns, each: name (scale 2 when it fits, else 1) then the payout as a big scale-2 numeral, right-aligned
      const left: Array<[string, string]> = [[names('STAR'), '1000'], [names('3BAR'), '200'], [names('2BAR'), '100'], [names('BAR'), '50']];
      const right: Array<[string, string]> = [[names('MELON'), '100'], [names('ORANGE'), '30'], [names('PLUM'), '20'], [names('SHOE'), '50']];
      const row = (n: string, v: string, x0: number, y: number, color: string): void => {
        const colW = 108, vW = px5Width(v, 2);
        const ns = fitScale(n, colW - vW - 6, 14, 2);
        sc.text(n, x0, y + Math.floor((14 - 7 * ns) / 2), { font: 'px5', scale: ns, color });
        sc.text(v, x0 + colW, y, { font: 'px5', scale: 2, color: '#F0E6CC', align: 'right' });
      };
      left.forEach(([n, v], i) => row(n, v, 12, 28 + i * 20, i === 0 ? '#FF4040' : '#F0E6CC'));
      right.forEach(([n, v], i) => row(n, v, 132, 28 + i * 20, '#F0E6CC'));
      const foot = `${this.t('anyBar')} 15  ${SHOE_TEXT} 2/6`, fs = fitScale(foot, sc.w - 8, 14, 2);
      sc.text(foot, sc.w / 2, 110 + Math.floor((14 - 7 * fs) / 2), { font: 'px5', scale: fs, color: '#D02020', align: 'center' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.bandit.tip1', v: { pull: this.k('primary') } },
      { k: 'm.bandit.tip2', v: { bet: `${this.k('betDown')}/${this.k('betUp')}`, coin: this.k('n1'), max: this.k('betMax') } },
      { k: 'm.bandit.tip3', v: { help: this.k('help') } },
    ];
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const busy = this.busy || this.roundOpen;
    const tilt = this.tiltOn();
    sh.goal({ k: 'm.bandit.goal' });

    // STATE: what the cabinet is doing
    if (tilt) sh.state({ k: 'm.bandit.stTilt' }, 'bad', { k: 'm.bandit.stTiltSub' });
    else if (busy) sh.state({ k: 'm.bandit.stSpin' }, 'cyan');
    else sh.state({ k: 'm.bandit.stReady' }, 'gold', { k: 'm.bandit.stReadySub', v: { n: fmtCoins(this.bet) } });

    // KEY NUMBERS: stake, credits, coin size, balance, last win
    const nums: HudNumber[] = [
      { label: { k: 'm.bandit.nBet' }, value: fmtCoins(this.bet), tone: 'gold' },
      { label: { k: 'm.bandit.nCredits' }, value: `${this.credits}/${MAX_CREDITS}`, tone: 'neutral' },
      { label: { k: 'm.bandit.nCoin' }, value: fmtCoins(this.denom), tone: 'neutral' },
      { label: { k: 'm.bandit.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
      { label: { k: 'm.bandit.nLast' }, value: fmtCoins(this.state.lastWin), tone: this.state.lastWin > 0 ? 'good' : 'neutral' },
    ];
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (!busy && !tilt) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.bandit.cPull' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.bandit.cCredits' }, action: 'betUp' });
      ctrl.push({ key: this.k('n1'), label: { k: 'm.bandit.cCoin' }, action: 'n1' });
      ctrl.push({ key: this.k('betMax'), label: { k: 'm.bandit.cMax' }, action: 'betMax' });
    }
    if (!tilt) ctrl.push({ key: this.k('n2'), label: { k: 'm.bandit.cThump' }, action: 'n2' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.bandit.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.bandit.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.dragging = null;
    this.seatHud?.dispose();
    super.dispose();
  }
}

