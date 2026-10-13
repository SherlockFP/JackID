/**
 * Pachinko "Deep Rain" (`pachinko`) — MACHINES_machines §8. Solo, tier 2, laundry zone, slot M.
 *
 * What it demonstrates
 *  - the logic / present split again: the occupant rolls every ball (`ballStep`, pure rules) and `emit`s the outcome;
 *    `present()` is the only place state changes, on every peer. Balls are animated on the lane graph (`lanes.ts`), so
 *    the path is never simulated: the sink was rolled at launch and the walk only chooses how it looks;
 *  - a rolling fire: hold to shoot 1.6 balls/s, the wallet is charged in 1 s batches (`addStake`), a block of 50 normal
 *    balls settles as ONE outcome (`settle` before presentation), a jackpot chain settles as its own outcome;
 *  - a power dial: handle strength zones (FOUL / LEFT-LOW / SWEET / LEFT-HIGH / RIGHT) set the sink table;
 *  - an attacker sub-game: 10 gate rounds (9 entries or 25 s each); kakuhen keeps the right shot alive until the next
 *    jackpot; leaving mid-chain auto-shoots for up to 60 s and then credits the player;
 *  - juice: anticipation (plate and lamps wind up), a launch tick per ball, pocket-specific impact (pon, flap clack,
 *    chime, pink glow, pop text), reach tension (heartbeat, stepped digits), a jackpot celebration and a coin count-up;
 *  - `playHeadless` (shared rules, `rules.ts`) for staff auto-play and the bench "Sim" button, same RTP as live.
 *
 * Controls: hold Space / LMB fire · A / D (←/→) power ±25 %/s · Shift (`fast`) snap to RIGHT-SHOT 90 % · ↑/↓ ball
 * value (only with no balls in flight and no round open) · H info · E stand (an open attacker auto-shoots first).
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type Txt } from '@/machines/_base/seatHud';
import type { TweenHandle } from '@/core/tween';
import type { Kit } from '@/kit/types';
import { fmtCoins, type I18nVars } from '@/core/i18n';
import { clamp, lerp } from '@/core/math';
import { buildModel, type PachinkoParts } from './model';
import { LANE_NODES, POCKET_DEFS, laneRng, railNode, walkPath, type Pocket } from './lanes';
import {
  BALL_RATE, DEFAULT_OPTS, ENTRIES_PER_ROUND, ROUNDS, initSim, endRound, openGate, readOpts, spinSeconds, ballStep, playHeadless,
  zoneOf, type Mode, type Opts, type ReachType, type Sim, type Sink, type Spin, type Zone,
} from './rules';
import { STRINGS } from './pachinko.strings';

export { playHeadless };

type Digits = [number, number, number];
type Ev =
  | { k: 'ball'; b: number; zone: Zone; sink: Sink; pocket: string; s: number; foul: boolean; tray: number; tu: boolean }
  | { k: 'spin'; n: number; digits: Digits; reach: ReachType | null; jackpot: boolean; kaku: boolean; holds: number; secs: number; land: number }
  | { k: 'mode'; mode: Mode; round: number; gate: boolean; kaku: boolean }
  | { k: 'block'; amount: number; bet: number; balls: number }
  | { k: 'chain'; amount: number; bet: number; jackpots: number; bonus: boolean };
type State = {
  mode: Mode; round: number; gate: boolean; kaku: boolean; holds: number; digits: Digits; reach: ReachType | null;
  tray: number; tulip: boolean; zone: Zone; spinNo: number;
};
/** Authority-only bookkeeping (the occupant's machine). Never sent; rebuilt from `State` on sit-down. */
type Auth = {
  sim: Sim; strength: number; left: boolean; right: boolean; firing: boolean; fireAcc: number; batchAcc: number; pending: number;
  blockFired: number; blockRet: number; chainOn: boolean; chainFired: number; chainRet: number; chainJp: number;
  roundT: number; closeT: number; holds: number; tray: number; leaving: boolean; leaveT: number; seq: number; lastZone: Zone;
  bonusFired: number; bonusRet: number;   // kakuhen balls, settled every 50 (one outcome per bonus block)
};

const BALL_R = 0.0055;
const BLOCK_BALLS = 50;             // a normal block settles every 50 fired balls (one outcome)
const GATE_CLOSE = 2;               // s the gate stays shut between rounds
const ROUND_LIMIT = 25;             // s before a round times out
const LEAVE_AUTO = 60;              // s a leaving player may auto-shoot an open chain
const PINK = 0xff4fa0, GOLD = 0xffd040, KAKU = 0xa040ff;
const ZONE_KEY: Readonly<Record<Zone, string>> = { FOUL: 'zFoul', LOW: 'zLow', SWEET: 'zSweet', HIGH: 'zHigh', RIGHT: 'zRight' };
const DEG = Math.PI / 180;

export const def: MachineDef = {
  id: 'pachinko',
  category: 'physics',
  slotSize: 'M',
  zone: 'laundry',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 5, betSteps: [1, 2, 5],          // coins per ball (V)
  maxPayoutMult: 60,
  rtp: 0.925,
  tier: 2,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'physics', 'attacker'],
  modHooks: {
    'm.pachinko.jackpotChance': 'Jackpot chance × (base 1; each spin is 1/199 normal, 1/40 kakuhen).',
    'm.pachinko.kakuhenRate': 'Chance a jackpot chain ends in kakuhen (base 0.5, cap 0.8).',
    'm.pachinko.attackerPay': 'Extra balls per attacker entry (base 0).',
    'm.pachinko.tulipBoost': 'Relative open-tulip catch boost (base 0; 0.1 = +10 %).',
    'm.pachinko.holdMax': 'Max queued digital-slot spins (base 4).',
    'x.pachinko.sweetWiden': 'Sweet zone widened on both sides, fraction (charm Glass Funnel: +0.1).',
    'm.pachinko.payoutMult': 'Multiplier on jackpot-chain payouts only (base 1).',
  },
  strings: STRINGS,
};

function freshAuth(s: State): Auth {
  const sim = initSim(s.tulip);
  sim.mode = s.mode;
  sim.round = s.round;
  sim.kaku = s.kaku;
  sim.gate = s.gate;
  return {
    sim, strength: 62, left: false, right: false, firing: false, fireAcc: 0, batchAcc: 0, pending: 0,
    blockFired: 0, blockRet: 0, chainOn: false, chainFired: 0, chainRet: 0, chainJp: 0,
    roundT: 0, closeT: s.mode === 'A' && !s.gate ? GATE_CLOSE : 0, holds: 0, tray: s.tray, leaving: false, leaveT: 0, seq: 0,
    lastZone: 'SWEET', bonusFired: 0, bonusRet: 0,
  };
}

export default class Pachinko extends MachineBase<PachinkoParts, Ev, State> {
  private state: State = {
    mode: 'N', round: 0, gate: false, kaku: false, holds: 0, digits: [7, 7, 7], reach: null, tray: 0, tulip: false, zone: 'SWEET', spinNo: 0,
  };
  private auth: Auth = freshAuth(this.state);
  private opt: Opts = DEFAULT_OPTS;
  private optT = 0;
  private ballFree: boolean[] = new Array(64).fill(true);
  private tweens = new Set<TweenHandle>();
  private anchors: Partial<Record<Pocket, THREE.Object3D>> = {};
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). */
  private seatHud?: SeatHud;

  protected createModel(kit: Kit): MachineModel<PachinkoParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.attractor.every('drop', 3.2, () => this.attractDrop(), { first: 2 });
  }

  // ── attract: cosmetic ball drops (no outcome, no money) ─────────────────────────────────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private attractDrop(): void {
    if (this.busy || this.occupant !== null || this.disposed) return;
    const pockets: Pocket[] = ['OUT', 'SIDE_L', 'SIDE_R', 'TULIP_L', 'START'];
    const pocket = pockets[Math.floor(this.cosmetic.next() * pockets.length)];
    const seed = 1 + Math.floor(this.cosmetic.next() * 65534);
    this.presentBall({ k: 'ball', b: 0, zone: 'SWEET', sink: 'OUT', pocket, s: seed, foul: false, tray: this.state.tray, tu: this.state.tulip },
      { local: false, pid: 0, seq: 0, fast: false, priv: false, t: 0 });
  }

  frame(dt: number, _t: number): void {
    const w = this.parts.windmills;
    w[0].rotation.z += dt * 1.2;
    w[1].rotation.z -= dt * 1.4;
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    if (!local) return;
    this.auth = freshAuth(this.state);
    this.refreshOpts();
    this.refresh();
    this.sfx('chime', { vol: 0.5 });
    this.seatHud?.show();
    this.showHud();
    this.seatHud?.firstTip(this.def.id, this.tipLines());
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.seatHud?.hide(); this.flushPartials(true); }            // safety net for forced / external releases
    this.auth = freshAuth(this.state);
    this.refresh();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving: an open attacker auto-shoots (≤ 60 s, RIGHT-SHOT) before the seat is released; kakuhen stays. */
  protected override standUp(): void {
    if (this.disposed || this.auth.leaving) return;
    if (this.auth.sim.mode === 'A') {
      this.auth.leaving = true;
      this.auth.leaveT = LEAVE_AUTO;
      this.auth.firing = false;
      this.showHud();
      return;
    }
    this.finishLeave();
  }

  private finishLeave(): void {
    const a = this.auth;
    if (a.sim.mode === 'A') this.forceFinishChain();
    this.flushPartials(false);
    a.leaving = false;
    super.standUp();
  }

  /** Auto-shoot is over: the remaining attacker rounds are forfeited; the mode becomes K (kakuhen) or N. */
  private forceFinishChain(): void {
    const s = this.auth.sim;
    for (let i = 0; i < ROUNDS + 1 && s.mode === 'A'; i++) { s.gate = true; s.entries = ENTRIES_PER_ROUND; endRound(s); }
    this.emitMode();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (e.down && this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (e.down && a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (a === 'primary') {
      if (e.down && !e.repeat && !this.auth.leaving) this.sfx('lever', { vol: 0.4 });
      this.auth.firing = e.down && !this.auth.leaving;
      return;
    }
    if (a === 'left') { this.auth.left = e.down; return; }
    if (a === 'right') { this.auth.right = e.down; return; }
    if (a === 'fast') { if (e.down && !e.repeat) this.auth.strength = 90; return; }
    if (!e.down) return;
    switch (a) {
      case 'betUp': this.changeBall(() => this.stepBet(1)); break;
      case 'betDown': this.changeBall(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBall(() => this.maxBet()); break;
      default: break;
    }
  }

  private changeBall(fn: () => void): void {
    if (this.roundOpen || this.auth.sim.mode !== 'N' || this.auth.pending > 0 || this.inFlight() > 0) {
      this.toast(this.t('busy'), 'bad');
      return;
    }
    fn();
    this.sfx('click', { vol: 0.5 });
    this.showHud();
  }

  // ── tick: power dial, fire cadence, batches, attacker gate timers (local occupant only) ──────────
  tick(dt: number): void {
    if (this.disposed || !this.isLocalOccupant) return;
    const a = this.auth;
    this.optT -= dt;
    if (this.optT <= 0) { this.refreshOpts(); this.optT = 0.5; }
    if (a.left) a.strength = clamp(a.strength - 25 * dt, 0, 100);
    if (a.right) a.strength = clamp(a.strength + 25 * dt, 0, 100);
    const z = this.zoneNow();
    if (z !== a.lastZone) { a.lastZone = z; this.showHud(); }

    if (a.leaving) {
      a.leaveT -= dt;
      if (a.sim.mode !== 'A' || a.leaveT <= 0) { this.finishLeave(); return; }
    }

    const s = a.sim;
    if (s.mode === 'A') {
      if (s.gate) {
        a.roundT += dt;
        if (a.roundT >= ROUND_LIMIT) this.closeRound();
      } else {
        a.closeT -= dt;
        if (a.closeT <= 0) { openGate(s); a.roundT = 0; this.emitMode(); }
      }
    }

    if (a.firing && !a.leaving) {
      a.fireAcc += dt;
      while (a.fireAcc >= 1 / BALL_RATE) { a.fireAcc -= 1 / BALL_RATE; if (!this.fireBall(z)) { a.firing = false; break; } }
    } else if (a.leaving && s.mode === 'A') {
      a.fireAcc += dt;
      while (a.fireAcc >= 1 / BALL_RATE) { a.fireAcc -= 1 / BALL_RATE; this.fireBall('RIGHT'); }
    } else {
      a.fireAcc = 0;
    }

    a.batchAcc += dt;
    if (a.batchAcc >= 1) { a.batchAcc = 0; this.flushStake(); }
  }

  private refreshOpts(): void {
    this.opt = readOpts((hook, base) => this.mod(hook, base), this.luck());
  }

  private zoneNow(): Zone {
    return zoneOf(this.auth.strength, this.opt.sweetWiden);
  }

  // ── authority: one fired ball ───────────────────────────────────────────────────────────────────
  /** Returns false when the ball could not be fired (no funds). */
  private fireBall(zone: Zone): boolean {
    const a = this.auth, s = a.sim, o = this.opt;
    if (zone !== 'FOUL' && s.mode === 'N' && this.ctx.run.wallet() < a.pending + this.bet) {
      this.toast(this.t('noFire'), 'bad');
      this.sfx('buzzer');
      return false;
    }
    const wasChain = s.mode !== 'N';
    const wasA = s.mode === 'A';
    const wasK = s.mode === 'K';
    const prev = { mode: s.mode, round: s.round, gate: s.gate };
    const out = ballStep(this.rng, s, zone, o, a.holds < o.holdMax);
    const seed = 1 + Math.floor(this.cosmetic.next() * 65534);
    const pocket = this.pocketFor(out.sink);
    const tray = a.tray + (out.foul ? 0 : out.returns - 1);
    void this.emit({ k: 'ball', b: ++a.seq, zone, sink: out.sink, pocket, s: seed, foul: out.foul, tray, tu: s.tulip });
    if (out.foul) return true;

    if (!wasChain) { a.pending += this.bet; a.blockFired++; a.blockRet += out.returns; }
    else if (wasA) { a.chainFired++; a.chainRet += out.returns; if (out.jackpotStart) a.chainJp++; }
    else { a.bonusFired++; a.bonusRet += out.returns; }
    a.tray = tray;

    if (out.spin) {
      a.holds++;
      const secs = spinSeconds(out.spin.reach, wasK, a.holds - 1);
      const land = 1.6 + 0.8 * laneRng(seed)();
      void this.emit(this.spinEvent(out.spin, secs, land, wasK));
      const aa = a;
      void this.ctx.timers.wait(secs + land).then(() => { aa.holds = Math.max(0, aa.holds - 1); });
    }

    if (out.jackpotStart) {
      if (wasK) this.settleBonus(false);
      this.startChain();                                   // closes the normal block, opens the attacker phase
    }
    if (out.roundEnd) { a.closeT = GATE_CLOSE; a.roundT = 0; }
    if (s.mode !== prev.mode || s.gate !== prev.gate || s.round !== prev.round) this.emitMode();
    if (!wasChain && a.blockFired >= BLOCK_BALLS) this.closeBlock(false);
    if (wasK && a.bonusFired >= BLOCK_BALLS) this.settleBonus(false);
    if (out.chainEnd && a.chainOn) this.settleChain(false);
    return true;
  }

  private spinEvent(sp: Spin, secs: number, land: number, wasK: boolean): Ev {
    return {
      k: 'spin', n: ++this.auth.seq, digits: sp.digits, reach: sp.reach, jackpot: sp.jackpot,
      kaku: sp.jackpot ? sp.kakuNext : wasK, holds: this.auth.holds, secs, land,
    };
  }

  private pocketFor(sink: Sink): string {
    switch (sink) {
      case 'SIDE': return this.cosmetic.chance(0.5) ? 'SIDE_L' : 'SIDE_R';
      case 'TULIP': return this.cosmetic.chance(0.5) ? 'TULIP_L' : 'TULIP_R';
      case 'ATTACKER': return 'ATTACKER';
      case 'START': return 'START';
      case 'ECHU': return 'ECHU';
      default: return 'OUT';
    }
  }

  private emitMode(): void {
    const s = this.auth.sim;
    void this.emit({ k: 'mode', mode: s.mode, round: s.round, gate: s.gate, kaku: s.kaku });
  }

  /** A round timed out (25 s): close it; closing round 10 ends the attacker phase and settles its chain. */
  private closeRound(): void {
    const s = this.auth.sim;
    const wasA = s.mode === 'A';
    endRound(s);
    this.auth.roundT = 0;
    this.auth.closeT = GATE_CLOSE;
    this.emitMode();
    if (wasA && s.mode !== 'A') this.settleChain(false);
  }

  /** Wallet: pending ball costs go out in 1 s batches (or with the block close). */
  private flushStake(): void {
    const a = this.auth;
    if (a.pending <= 0) return;
    const amt = a.pending;
    a.pending = 0;
    const ok = this.roundOpen ? this.addStake(amt) : this.beginRound(amt);
    if (!ok) a.firing = false;
  }

  /** One outcome per block of 50 normal balls: credit (settle) first, then present the count-up. */
  private closeBlock(direct: boolean): void {
    const a = this.auth;
    if (a.blockFired === 0 && a.pending === 0) return;
    this.flushStake();
    const amount = a.blockRet * this.bet, balls = a.blockFired;
    a.blockFired = 0; a.blockRet = 0;
    if (!this.roundOpen) return;
    const bet = this.roundBet;
    const credit = (): void => { this.settle({ gross: amount, tags: ['pachinko', 'block'] }); };
    if (direct) credit();
    else void this.emit({ k: 'block', amount, bet, balls }, credit);
  }

  private startChain(): void {
    this.closeBlock(false);
    const a = this.auth;
    if (a.chainOn) return;                                 // a re-jackpot inside the attacker keeps the same chain
    a.chainOn = true; a.chainFired = 0; a.chainRet = 0; a.chainJp = 1;
  }

  /** One outcome per attacker chain: the fired balls are charged as the round stake, the returns (× payoutMult) paid. */
  private settleChain(direct: boolean): void {
    const a = this.auth;
    if (!a.chainOn) return;
    const cost = a.chainFired * this.bet;
    const amount = Math.round(a.chainRet * this.opt.payoutMult * this.bet);
    const jp = a.chainJp;
    a.chainOn = false; a.chainFired = 0; a.chainRet = 0; a.chainJp = 0;
    const ok = (cost > 0 && this.beginRound(cost)) || this.beginRound(0);
    if (!ok) return;
    const credit = (): void => { this.settle({ gross: amount, tags: ['jackpot', 'bonus'] }); };
    if (direct) credit();
    else void this.emit({ k: 'chain', amount, bet: cost, jackpots: jp, bonus: false }, credit);
  }

  /** One outcome per 50 kakuhen balls (free to fire, charged as the block's stake, like the attacker phase). */
  private settleBonus(direct: boolean): void {
    const a = this.auth;
    if (a.bonusFired === 0) return;
    const cost = a.bonusFired * this.bet;
    const amount = Math.round(a.bonusRet * this.bet);
    a.bonusFired = 0; a.bonusRet = 0;
    const ok = (cost > 0 && this.beginRound(cost)) || this.beginRound(0);
    if (!ok) return;
    const credit = (): void => { this.settle({ gross: amount, tags: ['bonus'] }); };
    if (direct) credit();
    else void this.emit({ k: 'chain', amount, bet: cost, jackpots: 0, bonus: true }, credit);
  }

  /** Leave / release: close the open block, any attacker chain and any kakuhen block, without waiting for presentation. */
  private flushPartials(direct: boolean): void {
    this.closeBlock(direct);
    this.settleChain(direct);
    this.settleBonus(direct);
  }

  private inFlight(): number {
    return this.ballFree.filter((f) => !f).length;
  }

  // ── presentation: every peer ───────────────────────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'ball': return this.presentBall(ev, pc);
      case 'spin': return this.presentSpin(ev);
      case 'mode': return this.presentMode(ev);
      case 'block': return this.presentBlock(ev, pc);
      case 'chain': return this.presentChain(ev, pc);
    }
  }

  private presentBall(ev: Extract<Ev, { k: 'ball' }>, pc: PresentCtx): void {
    const st = this.state;
    st.tray = ev.tray;
    st.zone = ev.zone;
    st.tulip = ev.tu;
    this.sfx('click', { vol: 0.25, pitch: ev.foul ? 0.6 : 1.1 });
    if (ev.foul) { this.drawScreen(); return; }
    const pocket = ev.pocket as Pocket;
    const path = walkPath(railNode(ev.zone as Exclude<Zone, 'FOUL'>), pocket, ev.s);
    const pts: Array<[number, number]> = path.map((id) => [LANE_NODES[id].x, LANE_NODES[id].y]);
    pts.push(POCKET_DEFS[pocket].pos);
    const dur = 1.6 + 0.8 * laneRng(ev.s)();
    if (pc.fast) { this.landed(ev); return; }
    const slot = this.ballFree.indexOf(true);
    if (slot < 0) { this.landed(ev); return; }
    this.ballFree[slot] = false;
    const balls = this.parts.balls;
    const handle = this.ctx.tweens.run(dur, (k) => {
      const f = k * (pts.length - 1);
      const i = Math.min(pts.length - 2, Math.floor(f));
      const u = f - i;
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      balls.set(slot, lerp(x0, x1, u), lerp(y0, y1, u) + 0.02 * Math.sin(u * Math.PI), BALL_R + 0.001);
    }, {
      onDone: () => {
        this.tweens.delete(handle);
        balls.hide(slot);
        this.ballFree[slot] = true;
        this.landed(ev);
      },
    });
    this.tweens.add(handle);
  }

  /** Impact on the pocket: pon, flap clack, chime, pink glow, pop text. */
  private landed(ev: Extract<Ev, { k: 'ball' }>): void {
    if (this.disposed || ev.foul) return;
    const at = this.anchor(ev.pocket as Pocket);
    this.drawScreen();
    switch (ev.sink) {
      case 'OUT': this.sfx('ballBounce', { vol: 0.35 }); break;
      case 'SIDE':
        this.sfx('chime', { vol: 0.6, pitch: 1.2 });
        this.ctx.fx.popText(at, '+5', PINK, { dur: 0.7, rise: 0.12, scale: 0.8 });
        break;
      case 'TULIP':
        this.sfx('thud', { vol: 0.5 });
        this.sfx('chime', { vol: 0.5, pitch: 1.4 });
        this.flap(this.parts.tulips[ev.pocket === 'TULIP_L' ? 0 : 1], -35 * DEG, 0.25);
        this.ctx.fx.popText(at, '+7', PINK, { dur: 0.8, rise: 0.15, scale: 0.9 });
        break;
      case 'START':
        this.sfx('chime', { vol: 0.7, pitch: 1.5 });
        this.ctx.fx.glow(this.parts.startPocket, PINK, 0.35, 0.45);
        this.ctx.fx.popText(at, '+3', GOLD, { dur: 0.8, rise: 0.15, scale: 0.9 });
        break;
      case 'ECHU':
        this.sfx('sparkle', { vol: 0.6 });
        this.flap(this.parts.eChu, 0.4, 0.2);
        this.ctx.fx.popText(at, '+3', PINK, { dur: 0.8, rise: 0.15, scale: 1.0 });
        break;
      case 'ATTACKER':
        for (let i = 0; i < 14; i++) void this.ctx.timers.wait(i * 0.045).then(() => { if (!this.disposed) this.sfx('numberTick', { vol: 0.5 }); });
        this.ctx.fx.popText(at, '+14', GOLD, { dur: 1.0, rise: 0.25, scale: 1.2 });
        break;
    }
  }

  private flap(obj: THREE.Object3D, angle: number, dur: number): void {
    const rest = obj.rotation.x;
    void this.anim(dur, (k) => { obj.rotation.x = rest + angle * Math.sin(k * Math.PI); });
  }

  /** FX anchor at a pocket (field coordinates), created on first use. */
  private anchor(p: Pocket): THREE.Object3D {
    let o = this.anchors[p];
    if (!o) {
      o = new THREE.Object3D();
      const [x, y] = POCKET_DEFS[p].pos;
      o.position.set(x, y, 0.02);
      this.parts.field.add(o);
      this.anchors[p] = o;
    }
    return o;
  }

  private presentSpin(ev: Extract<Ev, { k: 'spin' }>): void {
    this.state.holds = ev.holds;
    this.state.spinNo = ev.n;
    this.updateLamps();
    void this.ctx.timers.wait(ev.land).then(() => {
      if (this.disposed) return;
      this.sfx('reelStart', { vol: 0.5 });
      this.state.reach = null;
      const shuffle = this.ctx.tweens.run(ev.secs, (k) => {
        if (k < 0.98) this.state.digits = [1 + Math.floor(this.cosmetic.next() * 9), 1 + Math.floor(this.cosmetic.next() * 9), 1 + Math.floor(this.cosmetic.next() * 9)];
        this.drawScreen();
      }, { stepFps: 12, onDone: () => { this.tweens.delete(shuffle); this.revealSpin(ev); } });
      this.tweens.add(shuffle);
    });
  }

  private revealSpin(ev: Extract<Ev, { k: 'spin' }>): void {
    if (this.disposed) return;
    this.state.digits = ev.digits;
    this.state.reach = ev.reach;
    this.sfx('reelStop', { vol: 0.6 });
    if (ev.reach) {
      this.sfx('heartbeat', { vol: 0.5 });
      this.parts.holdLamps.forEach((l) => l.blink(6, 0.5));
    }
    if (ev.jackpot) {
      this.sfx('jackpot', { vol: 0.8 });
      this.ctx.fx.sparks(this.parts.startPocket, 14, GOLD);
      this.ctx.fx.popText(this.parts.field, this.t('jackpot'), GOLD, { dur: 1.4, rise: 0.3, scale: 1.4, shake: true });
    }
    this.drawScreen();
  }

  private presentMode(ev: Extract<Ev, { k: 'mode' }>): void {
    const st = this.state;
    const prev = st.mode;
    st.mode = ev.mode;
    st.round = ev.round;
    st.gate = ev.gate;
    st.kaku = ev.kaku;
    const attacker = this.parts.attacker;
    if (ev.gate) {
      this.sfx('lever', { vol: 0.6, pitch: 1.3 });
      void this.anim(0.3, (k) => { attacker.rotation.x = -60 * DEG * k; }, 'outQuad');
    } else {
      void this.anim(0.2, (k) => { attacker.rotation.x = -60 * DEG * (1 - k); }, 'inQuad');
    }
    if (ev.mode === 'A' && prev !== 'A') {
      this.sfx('jackpotSiren', { vol: 0.6 });
      this.ctx.fx.shake(0.008, 0.4);
    }
    if (ev.mode === 'K' && prev !== 'K') {
      this.sfx('powerUp', { vol: 0.5 });
      this.ctx.fx.glow(this.parts.field, KAKU, 0.4, 0.6);
    }
    this.drawScreen();
    this.updateLamps();
  }

  private presentBlock(ev: Extract<Ev, { k: 'block' }>, pc: PresentCtx): Promise<void> | void {
    this.callResult(ev.amount - ev.bet);
    if (ev.amount <= 0) { this.commiserate({ amount: ev.bet, at: this.parts.field }); return; }
    return this.pourCoins(ev.amount, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) }).then(() => {
      if (!this.disposed) this.drawScreen();
    });
  }

  private async presentChain(ev: Extract<Ev, { k: 'chain' }>, pc: PresentCtx): Promise<void> {
    this.callResult(ev.amount - ev.bet);
    const tags = ev.bonus ? ['bonus'] : ['jackpot', 'bonus'];
    const tier = juiceTier(ev.amount, ev.bet, tags);
    if (tier === 'none' || tier === 'push' || tier === 'small') {
      await this.pourCoins(ev.amount, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
    } else {
      void this.celebrate(tier, { amount: ev.amount, fast: pc.fast, restore: () => this.refresh() });
      await countUp(this.ctx, 0, ev.amount, pc.fast ? 0.1 : 1.2 * this.speed, (v) => this.drawScreen(v));
    }
    if (!this.disposed) this.drawScreen();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, digits: [...this.state.digits] as Digits };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, digits: [...s.digits] as Digits };
    this.refresh();
  }

  override dispose(): void {
    this.seatHud?.dispose();
    for (const h of this.tweens) h.cancel();
    this.tweens.clear();
    super.dispose();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    this.updateLamps();
    this.parts.attacker.rotation.x = this.state.gate ? -60 * DEG : 0;
    this.drawScreen();
  }

  private updateLamps(): void {
    const n = this.state.holds;
    this.parts.holdLamps.forEach((l, i) => {
      l.setOn(i < n);
      if (i < n) l.setColor(this.state.mode === 'K' ? KAKU : PINK);
    });
  }

  /** The 160×120 LCD: mode, the three digits, tray balls (or a count-up of `winShown`). */
  private drawScreen(winShown?: number): void {
    const s = this.state;
    this.parts.screens.lcd.draw((g, sc) => {
      g.fillStyle = '#060a1a';
      g.fillRect(0, 0, sc.w, sc.h);
      const mode = s.mode === 'K' ? this.t('kakuOn')
        : s.mode === 'A' ? (s.gate ? this.t('mAtt', { n: s.round }) : this.t('mClose'))
          : this.t('mNormal');
      const col = s.mode === 'K' ? '#ff4fa0' : s.mode === 'A' ? '#ffd040' : '#7dd3ff';
      sc.text(mode, 80, 6, { font: 'px5', color: col, align: 'center' });
      s.digits.forEach((d, i) => {
        g.fillStyle = s.reach ? '#3a1020' : '#101a33';
        g.fillRect(34 + i * 30, 34, 24, 36);
        sc.text(String(d), 46 + i * 30, 44, { font: 'px5', color: s.reach ? '#ff8080' : '#e8f4ff', align: 'center' });
      });
      if (s.reach) sc.text(this.t(s.reach === 'PREMIUM' ? 'reachP' : s.reach === 'SUPER' ? 'reachS' : 'reachN'), 80, 78, { font: 'px5', color: '#ff8080', align: 'center' });
      if (winShown !== undefined) sc.text(`+${fmtCoins(winShown)}`, 80, 98, { font: 'px5', color: '#ffd040', align: 'center' });
      else sc.text(this.t('tray', { n: s.tray }), 80, 98, { font: 'px5', color: '#7dff7a', align: 'center' });
    });
  }

  /** Seat HUD: goal, phase banner, key numbers and the valid controls only. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const a = this.auth, s = a.sim;
    const zone = this.zoneNow();
    const sweet = zone === 'SWEET';
    sh.goal(this.tx('goal'));
    if (a.leaving) sh.state(this.tx('stLeave'), 'neutral');
    else if (s.mode === 'A') {
      if (s.gate) sh.state(this.tx('stAttOpen'), 'good', this.tx('stAttSub', { n: s.round }));
      else sh.state(this.tx('stAttClosed'), 'warn');
    } else if (s.mode === 'K') sh.state(this.tx('stKaku'), 'warn', this.tx('stKakuSub'));
    else if (a.firing) sh.state(this.tx('stFire'), 'cyan');
    else sh.state(this.tx('stReady'), 'gold', this.tx('stReadySub'));
    sh.numbers([
      { label: this.tx('nBall'), value: fmtCoins(this.bet), tone: 'gold' },
      { label: this.tx('nPower'), value: `${Math.round(a.strength)}% ${this.t(ZONE_KEY[zone])}`, tone: sweet ? 'good' : 'warn' },
      { label: this.tx('nTray'), value: String(a.tray), tone: 'cyan' },
      { label: this.tx('nHolds'), value: String(a.holds), tone: 'neutral' },
      { label: this.tx('nBalance'), value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
    ]);
    const ctrl: HudControl[] = [];
    if (!a.leaving && !a.firing) {
      ctrl.push({ key: this.k('primary'), label: this.tx('cFire'), action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: this.tx('cPower'), action: 'left' });
      ctrl.push({ key: this.k('fast'), label: this.tx('cSnap'), action: 'fast' });
      if (!this.roundOpen && s.mode === 'N' && a.pending === 0 && this.inFlight() === 0) {
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: this.tx('cBall'), action: 'betUp' });
      }
    }
    if (!a.leaving) ctrl.push({ key: this.k('help'), label: this.tx('cRules'), action: 'help' });
    if (!a.leaving) ctrl.push({ key: this.k('exit'), label: this.tx('cLeave'), action: 'exit' });
    sh.controls(ctrl);
  }

  // ── seat HUD helpers ────────────────────────────────────────────────────────────────────────────
  private tx(key: string, v?: I18nVars): Txt { return v ? { k: `m.${this.def.id}.${key}`, v } : { k: `m.${this.def.id}.${key}` }; }
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }
  private tipLines(): Txt[] {
    return [
      this.tx('tip1', { fire: this.k('primary'), power: `${this.k('left')}/${this.k('right')}` }),
      this.tx('tip2'),
      this.tx('tip3', { help: this.k('help') }),
    ];
  }
  private rulesLines(): Txt[] {
    return [this.tx('rule1', { fire: this.k('primary') }), this.tx('rule2'), this.tx('rule3'), this.tx('rule4'), this.tx('rule5')];
  }
  /** Result callout for a settled block or chain (net = paid − staked). */
  private callResult(net: number): void {
    if (this.isLocalOccupant) this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }
}
