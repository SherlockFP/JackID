/**
 * Bingo Pinball "Tombala Langırtı" (`bingopin`) — MACHINES_machines §18. Solo, tier 3 (addition), laundry zone, slot L.
 *
 * What it demonstrates
 *  - the logic / present split: the occupant draws every hole (`drawHole`, pure rules) and every nudge (`nudgeStep`) and
 *    `emit`s the outcome; `present()` is the only place the board changes, on every peer. Balls are animated along a
 *    cosmetic path ending in the rolled hole, so the path is never simulated;
 *  - a hold-to-pull plunger: power 0–100 % over 1 s, release to fire, weak shots (< 5 %) roll back for free. The power
 *    picks the hole zone (SOFT / MEDIUM / HARD), so the player steers the odds with the plunger;
 *  - the last 0.8 s of each roll is a nudge window: A/D can hop the ball into the neighbouring free hole, but every nudge
 *    raises the chance of a TILT that voids the game (`tiltGuard` absorbs the first);
 *  - after five balls an EXTRA BALL offer, priced at ceil(1.25 × the exact marginal EV of one more ball) so extras pay back
 *    80 %. The price wheel ratchets and the LED shows the price; up to three extras per game, each re-priced;
 *  - lines (rows, columns, diagonals) pay independently; the card flashes line by line and the win counts up;
 *  - juice: plunger creak and thwack, bumper "clack-ding" bells, the rolling rumble, relay chatter on the backglass, a
 *    ratchet price wheel, a tilt buzzer with every lamp out;
 *  - `playHeadless` (shared rules, `rules.ts`) for staff auto-play and the bench "Sim" button, same RTP as live (≈ 93.5 %).
 *
 * Controls: hold Space pull plunger / release fire · A / D nudge (last 0.8 s of a roll) · Space at the offer = buy extra ball
 * · C or Q collect · wheel / Z / X stake (between games) · H info · E stand (a game in progress finishes with the remaining
 * balls auto-fired at MEDIUM power and no extras).
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { Kit } from '@/kit/types';
import { fmtCoins, type I18nVars } from '@/core/i18n';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { clamp } from '@/core/math';
import { buildModel, type BingoParts, BALL_R, LANE, holePos } from './model';
import {
  BALLS_PER_GAME, CENTRE, DEFAULT_OPTS, EXTRA_MAX, HOLES, IDENTITY_CARD, LINES, MEDIUM_POWER, NUDGE_WINDOW_S, POWER_MIN_LAUNCH,
  type Opts, drawHole, extraPrice, holeFree, linesPay, litCells, nudgeStep, playHeadless, powerZone, readOpts, rollSeconds,
} from './rules';
import { STRINGS } from './bingopin.strings';

export { playHeadless };

type LineOut = { line: number; n: number };
type Ev =
  | { k: 'start'; stake: number; fs: boolean }
  | { k: 'launch'; b: number; power: number; hole: number; path: number }
  | { k: 'nudge'; b: number; dir: number; moved: boolean; tilt: boolean; hole: number }
  | { k: 'land'; b: number; hole: number; lit: number }
  | { k: 'offer'; price: number; n: number }
  | { k: 'bought'; price: number; n: number }
  | { k: 'end'; lit: number; lines: LineOut[]; pay: number; tilt: boolean; stake: number };

/** Replicated board: the card and the occupied holes. Rebuilt from snapshots; never edited by the local player. */
type State = { card: number[]; occ: number; fs: boolean; stake: number };
type Phase = 'ready' | 'roll' | 'offer' | 'tilt';
/** Authority-only bookkeeping (the occupant's machine). Never sent; rebuilt from `State` on sit-down. */
type Auth = {
  phase: Phase; stake: number; fs: boolean; occ: number;
  plunging: boolean; power: number;
  launched: number; landed: number; extras: number;
  hole: number; rollT: number; rollDur: number; nudges: number; guardUsed: boolean;
  offerT: number; price: number; tiltT: number;
  leaving: boolean; zone: string;
};

const TILT_LOCK_S = 2;               // lockout after a tilt
const OFFER_S = 10;                  // extra-ball offer window
const LEAVE_LAUNCH_POWER = MEDIUM_POWER;
const PINK_ZONE = { soft: 'zoneSoft', medium: 'zoneMedium', hard: 'zoneHard' } as const;
const BALL_SLOTS = 8;
const PLUNGER_TRAVEL = 0.06;

export const def: MachineDef = {
  id: 'bingopin',
  category: 'physics',
  slotSize: 'L',
  zone: 'laundry',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 25, betSteps: [1, 2, 5, 10, 25],    // coins per game (stake)
  maxPayoutMult: 600,
  rtp: 0.935,
  tier: 3,
  actionCost: 2,
  headless: playHeadless,
  tags: ['solo', 'physics', 'lines', 'extraballs'],
  modHooks: {
    'm.bingopin.freeSpace': 'Centre card cell starts lit (base off; any value > 0 turns it on).',
    'm.bingopin.tiltGuard': 'First TILT of each game is ignored (base off).',
    'm.bingopin.extraBallDiscount': 'Extra-ball price × (1 − N), N in 0..1 (base 0).',
    'm.bingopin.lineMult.3': 'Multiplier on 3-lit lines (base 1).',
    'm.bingopin.lineMult.4': 'Multiplier on 4-lit lines (base 1).',
    'm.bingopin.lineMult.5': 'Multiplier on 5-lit lines (base 1; milestone L100 ×2).',
  },
  strings: STRINGS,
};

function freshAuth(s: State): Auth {
  return {
    phase: 'ready', stake: s.stake, fs: s.fs, occ: s.occ,
    plunging: false, power: 0,
    launched: 0, landed: 0, extras: 0,
    hole: -1, rollT: 0, rollDur: 0, nudges: 0, guardUsed: false,
    offerT: 0, price: 0, tiltT: 0,
    leaving: false, zone: '',
  };
}

/** Point at parameter u ∈ [0, 1] along a polyline (arc-length parametrised). */
function walk(pts: ReadonlyArray<readonly [number, number]>, u: number): [number, number] {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let want = clamp(u, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] > 0 ? clamp(want / seg[i], 0, 1) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    want -= seg[i];
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

/** Cosmetic route from the plunger lane up the right rail, across the top and down into the rolled hole. */
function routeTo(hole: number, seed: number): Array<[number, number]> {
  const r = createRng(seed);
  const [hx, hy] = holePos(hole);
  const mid: [number, number] = [0.575 - 0.03 * r.next(), 0.42 + 0.1 * r.next()];
  return [[LANE.launch[0], LANE.launch[1]], mid, [0.56, 0.9], [hx, 0.92], [hx, hy]];
}

export default class Bingopin extends MachineBase<BingoParts, Ev, State> {
  private state: State = { card: [...IDENTITY_CARD], occ: 0, fs: false, stake: def.minBet };
  private auth: Auth = freshAuth(this.state);
  private opt: Opts = DEFAULT_OPTS;
  private optT = 0;
  private plungeK = 0;                       // plunger pull 0..1 (presentation)
  private ballNow: [number, number] = [0, 0];// last presented ball position (field coordinates)
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts) and the last key it was drawn from. */
  private seatHud?: SeatHud;
  private seatKey = '';

  protected createModel(kit: Kit): MachineModel<BingoParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    const rng = createRng(hashSeed(this.ctx.runSeed, this.id, 'card'));
    const card = [...IDENTITY_CARD];
    for (let i = card.length - 1; i > 0; i--) {                   // Fisher–Yates, per instance and run
      const j = rng.int(0, i);
      [card[i], card[j]] = [card[j], card[i]];
    }
    this.state = { ...this.state, card };
    this.refresh();
    this.attractor.every('drop', 3.4, () => this.attractDrop(), { first: 2 });
  }

  // ── attract: cosmetic ball drops (no outcome, no money) ─────────────────────────────────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private attractDrop(): void {
    if (this.busy || this.occupant !== null || this.disposed) return;
    const hole = Math.floor(this.cosmetic.next() * HOLES);
    const seed = 1 + Math.floor(this.cosmetic.next() * 65534);
    void this.travel(0, hole, seed, 2.2);
  }

  frame(_dt: number, _t: number): void {
    this.parts.plunger.position.y = LANE.launch[1] - PLUNGER_TRAVEL * this.plungeK;
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (!local) return;
    this.auth = freshAuth(this.state);
    this.optT = 0;
    this.refreshOpts();
    this.refresh();
    this.sfx('chime', { vol: 0.5 });
    this.seatKey = '';
    this.seatHud?.show();
    this.showHud();
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (!local) return;
    this.auth = freshAuth(this.state);
    this.seatHud?.hide();
    this.seatKey = '';
    this.plungeK = 0;
    this.refresh();
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  /** Leaving mid-game: the rest of the balls fire automatically at MEDIUM power, no extras, then the game pays. */
  protected override standUp(): void {
    if (this.disposed || this.auth.leaving) return;
    if (this.roundOpen) {
      this.auth.leaving = true;
      this.auth.plunging = false;
      this.showHud();
      this.tryLeave();
      return;
    }
    super.standUp();
  }

  private tryLeave(): void {
    const a = this.auth;
    if (!a.leaving) return;
    if (!this.roundOpen) { a.leaving = false; super.standUp(); return; }
    if (a.phase === 'ready') {
      if (a.landed < BALLS_PER_GAME + a.extras) this.launchBall(LEAVE_LAUNCH_POWER);
      else this.payout();
    } else if (a.phase === 'offer') {
      this.payout();
    }
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (e.down && this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (e.down && a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (a === 'primary') {
      if (e.down) { if (!e.repeat) this.pressPlunger(); } else this.releasePlunger();
      return;
    }
    if (a === 'left' || a === 'right') { if (e.down && !e.repeat) this.nudge(a === 'left' ? -1 : 1); return; }
    if (!e.down) return;
    switch (a) {
      case 'betUp': this.changeStake(() => this.stepBet(1)); break;
      case 'betDown': this.changeStake(() => this.stepBet(-1)); break;
      case 'betMax': this.changeStake(() => this.maxBet()); break;
      case 'collect': this.collect(); break;
      default: break;
    }
  }

  private changeStake(fn: () => void): void {
    if (this.roundOpen || this.auth.phase !== 'ready') { this.toast(this.t('busy'), 'bad'); return; }
    fn();
    this.sfx('click', { vol: 0.5 });
    this.showHud();
  }

  private pressPlunger(): void {
    const a = this.auth;
    if (a.leaving) return;
    if (a.phase === 'offer') { this.buy(); return; }
    if (a.phase === 'roll') { this.toast(this.t('busy'), 'bad'); return; }
    if (a.phase !== 'ready') return;
    a.plunging = true;
    a.power = 0;
    this.sfx('creak', { vol: 0.5 });
  }

  private releasePlunger(): void {
    const a = this.auth;
    if (!a.plunging) return;
    a.plunging = false;
    const power = Math.round(a.power);
    if (power < POWER_MIN_LAUNCH) {
      this.toast(this.t('rolledBack'));
      this.sfx('ballBounce', { vol: 0.4 });
      return;
    }
    this.launchBall(power);
  }

  /** Authority: fire one ball. Opens the game (charges the stake) on the first ball. */
  private launchBall(power: number): boolean {
    const a = this.auth;
    if (a.phase !== 'ready') return false;
    if (!this.roundOpen) {
      if (!this.beginRound(this.bet)) return false;
      a.stake = this.bet;
      a.fs = this.opt.freeSpace;
      a.occ = 0;
      a.landed = 0;
      a.extras = 0;
      a.launched = 0;
      void this.emit({ k: 'start', stake: a.stake, fs: a.fs });
    }
    const hole = drawHole(this.rng, power, a.occ);
    if (hole < 0) { this.toast(this.t('boardFull'), 'bad'); return false; }
    a.phase = 'roll';
    a.hole = hole;
    a.rollT = 0;
    a.rollDur = rollSeconds(power);
    a.nudges = 0;
    a.guardUsed = false;
    a.launched++;
    const path = 1 + Math.floor(this.cosmetic.next() * 65534);
    void this.emit({ k: 'launch', b: a.launched, power, hole, path });
    this.showHud();
    return true;
  }

  private nudge(dir: -1 | 1): void {
    const a = this.auth;
    if (a.phase !== 'roll') return;
    if (a.rollT < a.rollDur - NUDGE_WINDOW_S) return;          // only in the last 0.8 s
    const n = ++a.nudges;
    const r: Rng = this.rng;
    const res = nudgeStep(r, a.hole, dir, a.occ, n, { luck: this.opt.luck, tiltGuard: this.opt.tiltGuard }, a.guardUsed);
    a.guardUsed = res.guardUsed;
    a.hole = res.hole;
    void this.emit({ k: 'nudge', b: a.launched, dir, moved: res.moved, tilt: res.tilt, hole: res.hole });
    if (res.tilt) this.tiltOut();
  }

  /** Authority: TILT ends the game with no pay; the lockout runs in `tick`. */
  private tiltOut(): void {
    const a = this.auth;
    a.phase = 'tilt';
    a.tiltT = TILT_LOCK_S;
    a.plunging = false;
    const lit = litCells(this.state.card, a.occ, a.fs);
    const stake = a.stake;
    void this.emit({ k: 'end', lit, lines: [], pay: 0, tilt: true, stake }, () => this.settle({ gross: 0, tags: ['tilt'] }));
    a.occ = 0;
    a.landed = 0;
    a.extras = 0;
  }

  /** Authority: the rolled ball lands. */
  private landBall(): void {
    const a = this.auth;
    a.occ = (a.occ | (1 << a.hole)) >>> 0;
    a.landed++;
    const lit = litCells(this.state.card, a.occ, a.fs);
    void this.emit({ k: 'land', b: a.launched, hole: a.hole, lit });
    if (a.landed < BALLS_PER_GAME || a.leaving) { a.phase = 'ready'; return; }
    if (a.extras < EXTRA_MAX) this.openOffer();
    else this.payout();
  }

  private openOffer(): void {
    const a = this.auth;
    a.phase = 'offer';
    a.offerT = OFFER_S;
    a.price = extraPrice(this.state.card, a.occ, a.fs, a.stake, this.opt);
    void this.emit({ k: 'offer', price: a.price, n: a.extras });
    this.showHud();
  }

  private buy(): void {
    const a = this.auth;
    if (a.phase !== 'offer') return;
    if (a.extras >= EXTRA_MAX) { this.toast(this.t('extrasDone'), 'bad'); return; }
    if (!this.addStake(a.price)) return;
    a.extras++;
    a.phase = 'ready';
    void this.emit({ k: 'bought', price: a.price, n: a.extras });
    this.showHud();
  }

  private collect(): void {
    if (this.auth.phase !== 'offer') return;
    this.toast(this.t('collected'));
    this.payout();
  }

  /** Authority: close the game. Lines are scored on the card; the wallet is credited before the show. */
  private payout(): void {
    const a = this.auth;
    const lit = litCells(this.state.card, a.occ, a.fs);
    const { lines, mult } = linesPay(lit, this.opt);
    const pay = Math.floor(mult * a.stake);
    const stake = a.stake;
    a.phase = 'ready';
    a.occ = 0;
    a.landed = 0;
    a.extras = 0;
    a.launched = 0;
    void this.emit({ k: 'end', lit, lines, pay, tilt: false, stake }, () => this.settle({ gross: pay, tags: lines.length ? ['bingo'] : [] }));
    if (a.leaving) { a.leaving = false; super.standUp(); return; }
    this.showHud();
  }

  // ── tick: plunger, roll clock, offer window, tilt lockout (local occupant only) ──────────────────
  tick(dt: number): void {
    if (this.disposed || !this.isLocalOccupant) return;
    const a = this.auth;
    this.optT -= dt;
    if (this.optT <= 0) { this.refreshOpts(); this.optT = 0.5; }
    if (a.plunging) {
      a.power = Math.min(100, a.power + 100 * dt);
      this.plungeK = a.power / 100;
    }
    switch (a.phase) {
      case 'roll':
        a.rollT += dt;
        if (a.rollT >= a.rollDur) this.landBall();
        break;
      case 'offer':
        a.offerT -= dt;
        if (a.offerT <= 0) this.payout();
        break;
      case 'tilt':
        a.tiltT -= dt;
        if (a.tiltT <= 0) { a.phase = 'ready'; this.showHud(); }
        break;
      default: break;
    }
    if (a.leaving) this.tryLeave();
    const zone = powerZone(a.power);
    if (zone !== a.zone) a.zone = zone;
    this.showHud();
  }

  private refreshOpts(): void {
    this.opt = readOpts((hook, base) => this.mod(hook, base), this.luck());
  }

  // ── present: every peer, in order ────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'start': {
        this.state = { ...this.state, occ: 0, fs: ev.fs, stake: ev.stake };
        this.refresh();
        this.sfx('chime', { vol: 0.45 });
        return;
      }
      case 'launch': return this.presentLaunch(ev, pc);
      case 'nudge': return this.presentNudge(ev, pc);
      case 'land': return this.presentLand(ev, pc);
      case 'offer': return this.presentOffer(ev, pc);
      case 'bought': {
        this.sfx('purchase', { vol: 0.6 });
        if (this.isLocalOccupant) this.toast(this.t('bought', { n: fmtCoins(ev.price) }));
        await this.anim(pc.fast ? 0.05 : 0.25, (k) => { this.parts.priceWheel.rotation.x = -k * Math.PI * 2; });
        return;
      }
      case 'end': return this.presentEnd(ev, pc);
      default: return;
    }
  }

  private async presentLaunch(ev: Extract<Ev, { k: 'launch' }>, pc: PresentCtx): Promise<void> {
    const slot = (ev.b - 1) % BALL_SLOTS;
    const route = routeTo(ev.hole, ev.path);
    const roll = rollSeconds(ev.power);
    const pull = this.plungeK;
    this.sfx('lever', { vol: 0.7, pitch: 0.9 + ev.power / 400 });
    this.sfx('ballRoll', { vol: 0.35 });
    const dur = Math.max(0.2, roll - NUDGE_WINDOW_S) * this.speed;
    for (let j = 0; j < 3; j++) {
      void this.wait(dur * (0.2 + 0.25 * j)).then(() => { if (!this.disposed) this.sfx('bell', { vol: 0.3, pitch: 1 + 0.25 * this.cosmetic.next() }); });
    }
    const release = this.anim(pc.fast ? 0.08 : 0.14, (k) => { this.plungeK = pull * (1 - k); });
    await this.anim(pc.fast ? 0.1 : dur, (k) => {
      this.ballNow = walk(route, 0.82 * k);
      this.parts.balls.set(slot, this.ballNow[0], this.ballNow[1], BALL_R);
    });
    await release;
  }

  private async presentNudge(ev: Extract<Ev, { k: 'nudge' }>, pc: PresentCtx): Promise<void> {
    if (ev.tilt) {
      this.sfx('buzzer', { vol: 0.8 });
      this.parts.lamps.tilt.setOn(true);
      this.parts.lamps.tilt.blink(8, 1.5);
      if (this.isLocalOccupant) this.toast(this.t('tilted'), 'bad');
      return;
    }
    this.sfx('click', { vol: 0.5, pitch: ev.dir < 0 ? 0.9 : 1.1 });
    if (!ev.moved) return;
    const slot = (ev.b - 1) % BALL_SLOTS;
    const [hx, hy] = holePos(ev.hole);
    const from = this.ballNow;
    this.sfx('ballBounce', { vol: 0.3 });
    await this.anim(pc.fast ? 0.05 : 0.2, (k) => {
      this.ballNow = [from[0] + (hx - from[0]) * k, from[1] + (hy - from[1]) * k];
      this.parts.balls.set(slot, this.ballNow[0], this.ballNow[1], BALL_R);
    });
  }

  private async presentLand(ev: Extract<Ev, { k: 'land' }>, pc: PresentCtx): Promise<void> {
    const slot = (ev.b - 1) % BALL_SLOTS;
    const [hx, hy] = holePos(ev.hole);
    const from = this.ballNow;
    await this.anim(pc.fast ? 0.05 : 0.22, (k) => {
      this.parts.balls.set(slot, from[0] + (hx - from[0]) * k, from[1] + (hy - from[1]) * k, BALL_R * (1 - 0.5 * k));
    });
    this.parts.balls.hide(slot);
    this.ballNow = [hx, hy];
    this.sfx('ballDrop', { vol: 0.6 });
    this.state = { ...this.state, occ: (this.state.occ | (1 << ev.hole)) >>> 0 };
    this.parts.holeLamps[ev.hole].setOn(true);
    this.sfx('numberTick', { vol: 0.5 });
    this.drawBackglass(ev.lit, -1);
    if (!pc.fast) await this.wait(0.12);
    this.drawBackglass(ev.lit, -1);
  }

  private async presentOffer(ev: Extract<Ev, { k: 'offer' }>, pc: PresentCtx): Promise<void> {
    this.parts.lamps.extraBall.setOn(true);
    this.parts.lamps.extraBall.blink(2, OFFER_S);
    this.drawPrice(ev.price);
    this.sfx('ratchet', { vol: 0.6 });
    await this.anim(pc.fast ? 0.1 : 0.5, (k) => { this.parts.priceWheel.rotation.x = -k * Math.PI * 1.5; });
    this.sfx('chime', { vol: 0.4, pitch: 1.3 });
  }

  private async presentEnd(ev: Extract<Ev, { k: 'end' }>, pc: PresentCtx): Promise<void> {
    this.callResult(ev.pay - ev.stake);
    if (ev.tilt) {
      for (let i = 0; i < this.parts.balls.max; i++) this.parts.balls.hide(i);
      await this.wait(0.6);
      this.parts.lamps.tilt.setOn(false);
      this.state = { ...this.state, occ: 0 };
      this.refresh();
      return;
    }
    this.parts.lamps.extraBall.setOn(false);
    this.drawPrice(null);
    for (const ln of ev.lines) {
      this.sfx('numberTick', { vol: 0.5 });
      this.sfx('bell', { vol: 0.5, pitch: 1 + 0.12 * ln.n });
      this.drawBackglass(ev.lit, ln.line);
      await this.wait(pc.fast ? 0.05 : 0.4);
    }
    this.drawBackglass(ev.lit, -1);
    if (ev.pay > 0) {
      const tags = ev.lines.length ? ['bingo'] : [];
      const tier = juiceTier(ev.pay, ev.stake, tags);
      if (tier === 'none' || tier === 'push' || tier === 'small') {
        await this.pourCoins(ev.pay, { bet: ev.stake, fast: pc.fast, onCount: (v) => this.drawBackglass(ev.lit, -1, v) });
      } else {
        void this.celebrate(tier, { amount: ev.pay, fast: pc.fast, restore: () => this.refresh() });
        await countUp(this.ctx, 0, ev.pay, pc.fast ? 0.1 : 1.2 * this.speed, (v) => this.drawBackglass(ev.lit, -1, v));
      }
    } else {
      this.commiserate({ amount: ev.stake, at: this.parts.field });
    }
    this.state = { ...this.state, occ: 0 };
    this.refresh();
  }

  // ── late join / save ─────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { card: [...this.state.card], occ: this.state.occ, fs: this.state.fs, stake: this.state.stake };
  }
  applySnapshot(s: State): void {
    this.state = { card: [...s.card], occ: s.occ, fs: s.fs, stake: s.stake };
    this.refresh();
  }

  // ── presentation helpers ────────────────────────────────────────────────────────────────────────
  /** Cosmetic ball from `from` (0 = plunger) down a route to `hole`; used by the attract drops. */
  private async travel(from: number, hole: number, seed: number, dur: number): Promise<void> {
    const slot = 0;
    const route = routeTo(hole, seed);
    await this.anim(dur, (k) => {
      const p = walk(route, from + (1 - from) * k);
      this.parts.balls.set(slot, p[0], p[1], BALL_R);
    });
    this.parts.balls.hide(slot);
  }

  private litNow(): number { return litCells(this.state.card, this.state.occ, this.state.fs); }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    this.parts.holeLamps.forEach((l, h) => l.setOn(!holeFree(this.state.occ, h)));
    this.drawBackglass(this.litNow(), -1);
    this.drawPrice(null);
  }

  /** The 128 × 128 backglass: the scrambled 5 × 5 card, lit cells, a flashing line and an optional count-up value. */
  private drawBackglass(mask: number = this.litNow(), flash = -1, winShown?: number): void {
    const card = this.state.card;
    const fs = this.state.fs;
    this.parts.backglass.draw((g, sc) => {
      g.fillStyle = '#0e5e5e';
      g.fillRect(0, 0, sc.w, sc.h);
      sc.text(this.t('linesLabel'), 64, 3, { font: 'px5', color: '#ffd040', align: 'center' });
      const flashCells = flash >= 0 ? LINES[flash] : [];
      for (let k = 0; k < HOLES; k++) {
        const r = Math.floor(k / 5), c = k % 5;
        const x = 6 + c * 24, y = 16 + r * 19;
        const lit = ((mask >>> k) & 1) === 1;
        const hot = flashCells.includes(k);
        g.fillStyle = hot ? '#ffffff' : lit ? '#fff6a0' : '#0a4a4a';
        g.fillRect(x, y, 22, 17);
        const txt = k === CENTRE && fs ? this.t('freeSpace') : String(card[k]);
        sc.text(txt, x + 11, y + 5, { font: 'px5', color: lit || hot ? '#0e5e5e' : '#ffd040', align: 'center' });
      }
      if (winShown !== undefined) sc.text(`+${fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(winShown, this.src, { bet: this.roundBet }) : winShown)}`, 64, 113, { font: 'px5', color: '#fff6a0', align: 'center' });
    });
  }

  private drawPrice(price: number | null): void {
    this.parts.leds.price.draw((g, sc) => {
      g.fillStyle = '#080808';
      g.fillRect(0, 0, sc.w, sc.h);
      const txt = price === null ? '---' : String(Math.min(999, price)).padStart(3, ' ');
      sc.text(txt, sc.w / 2, 3, { font: 'px5', color: price === null ? '#3a2a10' : '#ff4040', align: 'center' });
    });
  }

  /** Seat HUD: goal, phase banner, key numbers and the valid controls. Cached: only redraws when a shown value changes. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const a = this.auth;
    const zone = powerZone(a.power);
    const nudgeOpen = a.phase === 'roll' && a.rollT >= a.rollDur - NUDGE_WINDOW_S;
    const secs = a.phase === 'offer' ? Math.ceil(a.offerT) : 0;
    const lit = litCells(this.state.card, a.occ, this.state.fs);
    const lines = linesPay(lit, this.opt).lines.length;
    const stake = this.roundOpen ? a.stake : this.bet;
    const wallet = this.ctx.run.wallet();
    const key = [a.phase, a.leaving, a.plunging, Math.round(a.power), zone, nudgeOpen, secs, a.landed, a.extras, a.price, lit, stake, wallet].join('|');
    if (key === this.seatKey) return;
    this.seatKey = key;

    sh.goal(this.tx('goal'));
    if (a.leaving) sh.state(this.tx('bLeave'), 'neutral');
    else if (a.phase === 'roll') {
      if (nudgeOpen) sh.state(this.tx('bNudge'), 'warn', this.tx('bNudgeSub', { nudge: `${this.k('left')}/${this.k('right')}` }));
      else sh.state(this.tx('bRoll'), 'cyan');
    } else if (a.phase === 'offer') sh.state(this.tx('bOffer'), 'warn', this.tx('bOfferSub', { price: fmtCoins(a.price), n: secs }));
    else if (a.phase === 'tilt') sh.state(this.tx('bTilt'), 'bad', this.tx('bTiltSub'));
    else if (a.plunging) sh.state(this.tx('bPull', { n: Math.round(a.power) }), 'cyan', this.tx(PINK_ZONE[zone]));
    else if (this.roundOpen) sh.state(this.tx('bNext'), 'gold', this.tx('bReadySub', { fire: this.k('primary') }));
    else sh.state(this.tx('bReady'), 'gold', this.tx('bReadySub', { fire: this.k('primary') }));

    const ball = Math.min(BALLS_PER_GAME, a.landed + 1);
    const third: HudNumber = a.phase === 'offer'
      ? { label: this.tx('nPrice'), value: fmtCoins(a.price), tone: 'warn' }
      : { label: this.tx('nPower'), value: `${Math.round(a.power)}%`, tone: 'neutral' };
    sh.numbers([
      { label: this.tx('nBet'), value: fmtCoins(stake), tone: 'gold' },
      { label: this.tx('nBall'), value: `${ball}/${BALLS_PER_GAME}${a.extras ? `+${a.extras}` : ''}`, tone: 'cyan' },
      { label: this.tx('nLines'), value: String(lines), tone: lines > 0 ? 'good' : 'neutral' },
      third,
      { label: this.tx('nBalance'), value: fmtCoins(wallet), tone: 'neutral' },
    ]);

    const ctrl: HudControl[] = [];
    if (!a.leaving) {
      if (a.phase === 'offer') {
        ctrl.push({ key: this.k('primary'), label: this.tx('cBuy'), action: 'primary', primary: true });
        ctrl.push({ key: this.k('collect'), label: this.tx('cCollect'), action: 'collect' });
      } else if (a.phase === 'ready') {
        ctrl.push({ key: this.k('primary'), label: this.tx('cPlunger'), action: 'primary', primary: true });
        if (!this.roundOpen) ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: this.tx('cStake'), action: 'betUp' });
      }
      if (nudgeOpen) ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: this.tx('cNudge'), action: 'left' });
      ctrl.push({ key: this.k('help'), label: this.tx('cRules'), action: 'help' });
      ctrl.push({ key: this.k('exit'), label: this.tx('cLeave'), action: 'exit' });
    }
    sh.controls(ctrl);
  }

  // ── seat HUD helpers ────────────────────────────────────────────────────────────────────────────
  private tx(key: string, v?: I18nVars): Txt { return v ? { k: `m.${this.def.id}.${key}`, v } : { k: `m.${this.def.id}.${key}` }; }
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private rulesLines(): Txt[] {
    return ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((r) => this.tx(r, r === 'rule4' ? { nudge: `${this.k('left')}/${this.k('right')}` } : undefined));
  }
  /** Result callout for a settled game (net = paid − staked; a tilt is a loss of the stake). */
  private callResult(net: number): void {
    if (this.isLocalOccupant) this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }
}
