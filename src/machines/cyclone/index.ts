/**
 * Cyclone Light Ring (`cyclone`) — MACHINES_machines §11, Tier 2, solo. Pattern: `plinko/index.ts`.
 *
 * What it demonstrates
 *  - logic / present split: the authority (the local occupant) rolls the commit (arm, lap-speed seed, coast k,
 *    auto-stop time) with the pure `rules.ts`, reads the press lamp from its own clock, and `emit`s `start` and
 *    `land`. `present()` plays both on every peer; watchers rebuild the chase from `speedSeed` and the press time;
 *  - settle-before-present: the payout is credited in the `land` credit step, before its show is queued;
 *  - visuals run on a visual clock (`visT`, advanced in `tick`, painted in `frame`) driven by the same `lampPos`
 *    curve as the rules, so the lamp under the light is the lamp that pays;
 *  - charms: `luck` (Metronome arm chance), `x.jackpotChance`, `m.cyclone.jpMult`, `m.cyclone.jpWindow`,
 *    `m.cyclone.slowMo`, `m.cyclone.secondLight`, `x.wheel.nudge` (Golden Ratchet: N within 3 s, 25 % of the stake,
 *    one lamp clockwise);
 *  - juice: siren card spins and the JP reveals, ticks at chase rate that slow and fall on the coast, a blink on the
 *    landing lamp, bonk / chime / triad / JP fanfare by tier, a three-lamp fading trail, and a rare horror lap that
 *    runs backwards on screen while the ticks keep their forward order;
 *  - `playHeadless` (shared rules) for staff auto-play and the bench "Sim" button.
 *
 * Controls: Space or LMB on the STOP mushroom starts a play, then stops it · wheel / Z / X stake · N4 nudge (Golden
 * Ratchet window only) · E leave.
 * Round life-cycle: `beginRound(stake)` → `emit(start)` → STOP (or the seeded auto-stop) → `emit(land, settle)` →
 * present → release.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import { blinkOn } from '@/machines/_base/juice';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { Kit } from '@/kit/types';
import { fmtCoins, t } from '@/core/i18n';
import { lerp, TAU } from '@/core/math';
import { buildModel, LAMP_HEX, LAMP_Z, RING_Y, lampXY, valueHex, type CyclonParts } from './model';
import {
  HOOK_JACKPOT, HOOK_JPMULT, HOOK_NUDGE, HOOK_SECOND, HOOK_SLOW, HOOK_WINDOW, JP_BASE, LAMPS, MAX_PAY_MULT,
  MAX_STAKE, MIN_STAKE, NUDGE_WINDOW_S, REVEAL_S, SLOW_MULT, lampAt, lampOf, lampPos, nudgeCost, phaseOf,
  playHeadless, resolve, rollCommit, roundPayout, type Commit, type Outcome,
} from './rules';
import { STRINGS } from './cyclone.strings';

export { playHeadless };

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────────
type StartEv = { k: 'start'; stake: number; armed: boolean; speedSeed: number; slow: number };
type LandEv = {
  k: 'land'; press: number; pressT: number; coast: number; lamp: number; lamp2: number; paid: number;
  value: number; gross: number; bet: number; nudged: boolean; jp: boolean; tags: string[];
};
type Ev = StartEv | LandEv;
type State = { hist: number[] };

const HIST = 12;
const GOLD = LAMP_HEX.jpOn, RED = 0xff2020, AMBER = LAMP_HEX.x1, GREEN = LAMP_HEX.x3;
const DIM = 0.35;                           // resting lamp intensity
const TRAIL = [1, 0.5, 0.25];               // head, then the two lamps behind it

/** Colour of a multiplier on lamps, plates and LEDs. */
export function colourOf(value: number, jp: boolean): number {
  if (jp) return GOLD;
  if (value >= 3) return GREEN;
  if (value >= 1) return AMBER;
  return LAMP_HEX.zero;
}

/** Text of a lamp value in the centre display. */
function labelOf(value: number, jp: boolean): string {
  if (jp) return 'JP';
  return value > 0 ? `×${value}` : '0';
}

/** Lamp value as the visuals show it (JP counts only when armed). */
function valueOfLamp(i: number, armed: boolean): number {
  const j = lampOf(i);
  if (j === 0) return armed ? JP_BASE : 0;
  return [0, 1, 0, 3, 0, 1][j % 6];
}

/** Authority-side state of the play in progress (never sent; the events carry what watchers need). */
type Round = {
  stake: number;
  commit: Commit;
  slow: number;
  jpMult: number;
  second: boolean;
  nudgeOk: boolean;
  revealLeft: number;
  chaseT: number;
  pressed: boolean;
  press: number;
  pressT: number;
  nudgeOpen: boolean;
  nudgeLeft: number;
  nudged: boolean;
};

type VisMode = 'idle' | 'reveal' | 'chase' | 'hold' | 'coast' | 'land';

export const def: MachineDef = {
  id: 'cyclone',
  category: 'wheel',
  slotSize: 'M',
  zone: 'midway',
  seats: 1,
  shared: false,
  minBet: MIN_STAKE, maxBet: MAX_STAKE, betSteps: [1, 2, 5, 10, 20, 50],   // per play
  maxPayoutMult: MAX_PAY_MULT,
  rtp: 0.851,
  tier: 2,
  actionCost: 1,                                                         // per play, no autoplay
  headless: playHeadless,
  tags: ['solo', 'wheel', 'lamps', 'jackpot'],
  modHooks: {
    luck: 'Metronome: each luck point adds 1 % absolute to the arm chance (cap +20 %).',
    'x.jackpotChance': 'Multiplier on the base 1/30 arm chance. Base 1.',
    'm.cyclone.jpMult': 'Multiplier on the armed JACKPOT value (×25 base). Base 1.',
    'm.cyclone.jpWindow': 'Armed plays only: coast k is drawn 0…(5 − N), so aiming pays more. N capped at 3. Base 0.',
    'm.cyclone.slowMo': 'Chase speed × 0.8 when 1. Base 0.',
    'm.cyclone.secondLight': 'A second light 24 lamps away; the play pays the better of the two when 1. Base 0.',
    'x.wheel.nudge': 'Golden Ratchet: within 3 s after STOP, pay 25 % of the stake to move the result one lamp clockwise. Base 0.',
  },
  strings: STRINGS,
};

export default class Cyclone extends MachineBase<CyclonParts, Ev, State> {
  private st: State = { hist: [] };
  /** Authority-side fractional payout carried between plays (per machine instance). */
  private dust = 0;
  /** The play in progress on the authority (null when idle). */
  private rnd: Round | null = null;
  /** Visual state, every peer. */
  private visMode: VisMode = 'idle';
  private visT = 0;            // seconds of chase shown (advances only in 'chase')
  private visClock = 0;        // always advancing, for breathing / blinking
  private visPhase = 0;
  private visSlow = 1;
  private visArmed = false;
  private visReverse = false;
  private visPos = 0;          // float lamp position during hold / coast
  private visLamp = -1;        // landing lamp
  private visLamp2 = -1;       // second light landing lamp (or −1)
  private visBlink = 0;
  private lastTickStep = -1;
  /** Last result shown on the centre display (kept until the next play). */
  private centreVal = -1;
  private centreJp = false;
  /** Seconds until the next horror lap (cosmetic, 5–9 min). */
  private horrorIn = 300;
  private lightAcc = 0;
  private centreKey = '';
  private ledKey = '';
  private beaconAngle = 0;

  protected createModel(kit: Kit): MachineModel<CyclonParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.horrorIn = this.cosmetic.float(300, 540);
    this.refresh();
    this.attractor.every('sweep', 9, () => this.idleSweep(), { first: 3 });
  }

  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) { this.sfx('chime'); this.showHud(); }
  }

  onRelease(_pid: number, _seat: number, _local: boolean): void {
    this.refresh();
  }

  onLang(): void {
    this.ledKey = '';
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── fixed step: rules clock (authority), visual clock (every peer), horror countdown ─────────────
  tick(dt: number): void {
    this.horrorIn -= dt;
    this.visClock += dt;
    if (this.visMode === 'chase') this.visT += dt;
    const r = this.rnd;
    if (!r) return;
    if (r.revealLeft > 0) { r.revealLeft -= dt; return; }
    if (!r.pressed) {
      r.chaseT += dt;
      if (r.chaseT >= r.commit.autoT) this.press(true);
    } else if (r.nudgeOpen) {
      r.nudgeLeft -= dt;
      if (r.nudgeLeft <= 0) { r.nudgeOpen = false; void this.finish(); }
    }
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.primary(); break;
      case 'n4': this.nudge(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    if (!this.pick([this.parts.buttons.stop.root])) return;
    void this.parts.buttons.stop.press(0.12);
    this.primary();
  }

  /** START when idle, STOP while the light turns. Silent during the reveal and the coast. */
  private primary(): void {
    if (this.rnd) {
      if (this.rnd.revealLeft > 0) return;
      this.press(false);
      return;
    }
    if (!this.busy && !this.roundOpen) void this.play();
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen || this.busy) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  // ── authority-side logic: runs only on the local occupant ──────────────────────────────────────
  /** START: charge the stake, roll the commit, announce the play. The chase begins after the reveal. */
  private async play(): Promise<void> {
    const stake = this.bet;
    if (!this.beginRound(stake)) return;                    // charges the wallet, busy = true, re-seeds this.rng
    const commit = rollCommit(this.rng, {
      luck: this.luck(), jpChance: this.mod(HOOK_JACKPOT, 1), window: this.mod(HOOK_WINDOW, 0),
    });
    const slow = this.mod(HOOK_SLOW, 0) > 0 ? SLOW_MULT : 1;
    this.rnd = {
      stake, commit, slow, jpMult: this.mod(HOOK_JPMULT, 1), second: this.mod(HOOK_SECOND, 0) > 0,
      nudgeOk: this.mod(HOOK_NUDGE, 0) > 0, revealLeft: commit.armed ? REVEAL_S : 0, chaseT: 0,
      pressed: false, press: -1, pressT: 0, nudgeOpen: false, nudgeLeft: 0, nudged: false,
    };
    this.showHud();
    const shown = this.emit({ k: 'start', stake, armed: commit.armed, speedSeed: commit.speedSeed, slow });
    if (!this.isLocalOccupant && this.rnd) {               // refused: give the stake back, never strand it
      this.rnd = null;
      this.settle({ gross: stake });
    }
    await shown;
    this.showHud();
  }

  /** STOP (`auto` = the seeded auto-stop). Reads the lamp under the light on the authority clock. */
  private press(auto: boolean): void {
    const r = this.rnd;
    if (!r || r.pressed) return;
    r.pressed = true;
    r.pressT = r.chaseT;
    r.press = lampAt(r.chaseT, phaseOf(r.commit.speedSeed), r.slow);
    if (this.visMode === 'chase') { this.visMode = 'hold'; this.visPos = r.press; }
    this.parts.buttons.stop.setLit(false);
    if (auto) this.toast(this.t('auto'), 'bad');
    if (r.nudgeOk) {
      r.nudgeOpen = true;
      r.nudgeLeft = NUDGE_WINDOW_S;
      this.showHud();
      return;
    }
    void this.finish();
  }

  /** Golden Ratchet: pay 25 % of the stake for one lamp clockwise, once, inside the window. */
  private nudge(): void {
    const r = this.rnd;
    if (!r || !r.pressed || !r.nudgeOpen || r.nudged) return;
    if (!this.addStake(nudgeCost(r.stake))) return;
    r.nudged = true;
    r.nudgeOpen = false;
    this.sfx('ratchet');
    this.ctx.fx.popText(this.model.anchors.label, this.t('nudge'), AMBER, { dur: 0.7, rise: 0.2, scale: 1 });
    void this.finish();
  }

  /** LAND: resolve the play, credit it, then present it on every peer. */
  private async finish(): Promise<void> {
    const r = this.rnd;
    if (!r) return;
    this.rnd = null;
    const coast = r.commit.k + (r.nudged ? 1 : 0);          // the nudge is one more lamp clockwise
    const out: Outcome = resolve(r.press, coast, r.commit.armed, { jpMult: r.jpMult, second: r.second });
    const { gross, carry } = roundPayout(r.stake * out.value, this.dust);
    this.dust = carry;
    const tags = out.jp ? ['cyclone:jackpot'] : [];
    const ev: LandEv = {
      k: 'land', press: r.press, pressT: r.pressT, coast, lamp: out.lamp, lamp2: out.lamp2, paid: out.paid,
      value: out.value, gross, bet: r.stake + (r.nudged ? nudgeCost(r.stake) : 0), nudged: r.nudged, jp: out.jp, tags,
    };
    // Settle-before-present (DECISIONS G): the payout is credited before the show is queued.
    const credit = (): void => { this.settle({ gross, tags }); this.busy = true; };
    try {
      const shown = this.emit(ev, credit);
      if (this.roundOpen) credit();                          // emit refused: still pay out, never strand the stake
      await shown;
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  // ── present: every peer, including the emitter ──────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    if (ev.k === 'start') return this.presentStart(ev, pc);
    return this.presentLand(ev, pc);
  }

  private async presentStart(ev: StartEv, pc: PresentCtx): Promise<void> {
    this.visArmed = ev.armed;
    this.visPhase = phaseOf(ev.speedSeed);
    this.visSlow = ev.slow;
    this.visReverse = this.horrorIn <= 0;                    // horror lap (cosmetic): backwards on screen this play
    if (this.visReverse) this.horrorIn = this.cosmetic.float(300, 540);
    this.visT = 0;
    this.visPos = 0;
    this.visLamp = -1;
    this.visLamp2 = -1;
    this.visBlink = 0;
    this.lastTickStep = -1;
    this.centreVal = -1;
    this.centreJp = false;
    this.sfx('lever', { vol: 0.6 });
    if (pc.fast) { this.visMode = 'chase'; return; }
    if (ev.armed) {
      // the Eye opens: JP lamp goes gold, siren, marquee chases, 0.8 s reveal before the light moves
      this.visMode = 'reveal';
      this.sfx('jackpotSiren', { vol: 0.5 });
      this.ctx.fx.glow(this.model.anchors.label, RED, 0.5, 1.2);
      this.parts.marquee.chase('chase', 9);
      await this.wait(REVEAL_S);
      if (this.disposed) return;
    }
    this.visMode = 'chase';
    this.visT = 0;
    this.parts.buttons.stop.setLit(true);
    this.parts.marquee.chase('chase', 5);
  }

  private async presentLand(ev: LandEv, pc: PresentCtx): Promise<void> {
    this.st.hist = [ev.value, ...this.st.hist].slice(0, HIST);
    if (pc.fast) { this.finishVisual(ev); this.refresh(); return; }

    // 1. coast: the light runs `coast` lamps clockwise and slows, its ticks falling in pitch
    this.visMode = 'coast';
    this.visSlow = 1;
    const from = ev.press, to = ev.press + ev.coast;
    this.visPos = from;
    this.lastTickStep = Math.floor(from);
    const dur = 0.6 + 0.12 * ev.coast;
    await this.anim(dur, (k) => {
      this.visPos = lerp(from, to, easeOut(k));
      const step = Math.floor(this.visPos);
      if (step !== this.lastTickStep) {
        this.lastTickStep = step;
        this.sfx('clockTick', { vol: 0.35, pitch: -(1 - k) * 8 });
      }
    });
    if (this.disposed) return;

    // 2. landing: the lamp blinks; the second light (if any) blinks with it
    this.visMode = 'land';
    this.visLamp = lampOf(ev.lamp);
    this.visLamp2 = ev.lamp2 >= 0 ? lampOf(ev.lamp2) : -1;
    this.visBlink = 1;
    this.sfx('thud', { vol: 0.5 });
    await this.anim(0.5, (k) => { this.visBlink = blinkOn(k, 4) ? 1 : 0; });
    if (this.disposed) return;

    // 3. verdict: bonk, chime, triad, or the JACKPOT fanfare
    await this.verdict(ev);
    if (this.disposed) return;
    this.finishVisual(ev);
    this.refresh();
  }

  private finishVisual(ev: LandEv): void {
    this.visMode = 'idle';
    this.visArmed = false;
    this.visLamp = lampOf(ev.lamp);
    this.visLamp2 = -1;
    this.visBlink = 0;
    this.centreVal = ev.value;
    this.centreJp = ev.jp;
  }

  private async verdict(ev: LandEv): Promise<void> {
    const { marquee } = this.parts;
    const tier = juiceTier(ev.gross, ev.bet, ev.tags);
    this.centreVal = ev.value;
    this.centreJp = ev.jp;
    this.drawLeds(ev.gross);
    if (ev.jp && ev.gross > 0) {
      this.sfx('jackpot', { vol: 1 });
      this.sfx('jackpotSiren', { vol: 0.7 });
      this.ctx.fx.glow(this.model.anchors.label, GOLD, 1.2, 1.5);
      this.ctx.fx.popText(this.model.anchors.label, this.t('jackpot'), GOLD, { dur: 1.2, rise: 0.3, scale: 1.4 });
    } else if (ev.value >= 3) {
      this.sfx('win2');
      this.ctx.fx.popText(this.model.anchors.label, this.t('multLabel', { n: ev.value }), GREEN, { dur: 0.9, rise: 0.25, scale: 1.2 });
    } else if (ev.value === 1) {
      this.sfx('chime');
    } else {
      this.sfx('buzzer', { vol: 0.5, pitch: -4 });
    }
    if (ev.gross > 0) {
      if (tierAtLeast(tier, 'medium')) {
        await this.celebrate(tier, { amount: ev.gross, marquee, restore: () => this.refresh() });
      } else {
        await this.pourCoins(ev.gross, { bet: ev.bet, onCount: (v) => this.drawLeds(v) });
      }
    } else {
      this.commiserate({ amount: ev.bet, at: this.model.anchors.label });
      await this.wait(0.35);
    }
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  /** Cosmetic idle sweep: a short run of lamps while unoccupied. No outcome, no wallet. */
  private idleSweep(): void {
    if (this.busy || this.occupant !== null || this.visMode !== 'idle') return;
    this.visMode = 'hold';
    const from = this.cosmetic.int(0, LAMPS - 1);
    void this.anim(1.2, (k) => { this.visPos = from + k * 14; }, 'outQuad').then(() => {
      if (!this.disposed && this.visMode === 'hold') this.visMode = 'idle';
    });
  }

  /** Head lamp for the current visual state (−1 when nothing is lit). */
  private headLamp(): number {
    switch (this.visMode) {
      case 'chase': {
        const p = lampPos(this.visT, this.visPhase, this.visSlow);
        if (this.visReverse && p < LAMPS) return lampOf(LAMPS - Math.floor(p));
        return lampOf(Math.floor(p));
      }
      case 'hold': case 'coast': return lampOf(Math.floor(this.visPos));
      case 'land': return this.visLamp;
      default: return -1;
    }
  }

  /** Repaint the 47 lamps (JP handled by its own LampPart). Trail behind the head; blink on landing. */
  private paintRing(): void {
    const ic = this.parts.ringLamps.instanceColor;
    if (!ic) return;
    const lit = new Float32Array(LAMPS).fill(DIM);
    const head = this.headLamp();
    if (this.visMode === 'land') {
      if (this.visBlink > 0) { lit[this.visLamp] = 1; if (this.visLamp2 >= 0) lit[this.visLamp2] = 0.7; }
    } else if (head >= 0) {
      const dir = this.visMode === 'chase' && this.visReverse ? 1 : -1;
      TRAIL.forEach((a, n) => { const j = lampOf(head + dir * n); lit[j] = Math.max(lit[j], a); });
    }
    const c = new THREE.Color();
    for (let i = 1; i < LAMPS; i++) {
      c.setHex(valueHex(i)).multiplyScalar(lit[i]);
      this.parts.ringLamps.setColorAt(i, c);
    }
    ic.needsUpdate = true;
    // JACKPOT lamp: gold and breathing when armed, lit on landing, dark grey otherwise
    const jp = this.parts.jpLamp;
    if (this.visMode === 'land' && this.visLamp === 0) {
      jp.setColor(GOLD); jp.setOn(this.visBlink > 0);
    } else if (this.visArmed && this.visMode !== 'idle') {
      jp.setColor(GOLD); jp.setOn(blinkOn(this.visClock, 2, 0.5));
    } else {
      jp.setColor(LAMP_HEX.jpOff); jp.setOn(false);
    }
  }

  /** Light hint follows the head lamp (30 Hz); its colour is the lamp colour. */
  private moveLights(): void {
    const head = this.headLamp();
    const { light, light2 } = this.model.anchors;
    const at = lampXY(head >= 0 ? head : 0);
    light.position.set(at[0], at[1], LAMP_Z + 0.12);
    light.userData.color = head >= 0 ? colourOf(valueOfLamp(head, this.visArmed), lampOf(head) === 0 && this.visArmed) : LAMP_HEX.jpOff;
    light.userData.intensity = head >= 0 ? 0.5 : 0;
    if (this.visMode === 'land' && this.visLamp2 >= 0) {
      const at2 = lampXY(this.visLamp2);
      light2.position.set(at2[0], at2[1], LAMP_Z + 0.12);
      light2.userData.color = colourOf(valueOfLamp(this.visLamp2, this.visArmed), false);
      light2.userData.intensity = 0.4;
    } else {
      light2.userData.intensity = 0;
    }
  }

  /** Centre display: the lamp under the head while turning, the last result when resting. */
  private updateCentre(): void {
    if (this.visMode === 'idle') { this.drawCentre(this.centreVal, this.centreJp); return; }
    if (this.visMode === 'reveal') { this.drawCentre(-1, false); return; }
    const head = this.headLamp();
    if (head < 0) return;
    this.drawCentre(valueOfLamp(head, this.visArmed), lampOf(head) === 0 && this.visArmed);
  }

  private drawCentre(value: number, jp: boolean): void {
    const text = value < 0 ? '--' : labelOf(value, jp);
    const color = value < 0 ? '#404a60' : '#' + colourOf(value, jp).toString(16).padStart(6, '0');
    const key = `${text}|${color}`;
    if (key === this.centreKey) return;
    this.centreKey = key;
    this.parts.centre.draw((g, sc) => {
      g.fillStyle = '#050a18'; g.fillRect(0, 0, sc.w, sc.h);
      g.beginPath(); g.arc(sc.w / 2, sc.h / 2, sc.w / 2 - 1, 0, TAU); g.fillStyle = '#0a1230'; g.fill();
      sc.text(text, sc.w / 2, sc.h / 2 - 8, { font: 'px5', color, align: 'center', scale: 2 });
    });
  }

  /** 160 × 32 LED strip: credit / bet / win on top, the last twelve results as squares below. */
  private drawLeds(winShown?: number): void {
    const bet = this.roundOpen && this.rnd ? this.roundBet : this.bet;
    const hist = this.st.hist;
    const key = `${bet}|${winShown ?? '-'}|${hist.join(',')}`;
    if (key === this.ledKey) return;
    this.ledKey = key;
    this.parts.leds.draw((g, sc) => {
      g.fillStyle = '#080808'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(this.t('credit'), 4, 3, { font: 'px5', color: '#ff3020' });
      sc.text(this.t('bet', { n: fmtCoins(bet) }), 4, 12, { font: 'px5', color: '#ff3020' });
      sc.text(winShown !== undefined ? this.t('win', { n: fmtCoins(winShown) }) : this.t('last'), 96, 12, { font: 'px5', color: '#ffd040' });
      hist.forEach((v, i) => {
        g.fillStyle = '#' + colourOf(v, v >= JP_BASE).toString(16).padStart(6, '0');
        g.fillRect(4 + i * 12, 22, 8, 8);
      });
    });
  }

  /** Put every visual in its resting pose. Idempotent. */
  private refresh(): void {
    this.paintRing();
    this.updateCentre();
    this.drawLeds();
    this.parts.buttons.stop.setLit(this.rnd !== null);
  }

  private showHud(): void {
    const r = this.rnd;
    const hints: HudHint[] = [];
    if (r && r.nudgeOpen) {
      hints.push({ action: 'n4', label: this.t('hintNudge') });
    } else if (r && !r.pressed) {
      hints.push({ action: 'primary', label: this.t('hintStop') });
    } else if (!r && !this.busy && !this.roundOpen) {
      hints.push({ action: 'primary', label: `${this.t('hintStart')} ${fmtCoins(this.bet)}` });
      hints.push({ action: 'betUp', label: `${this.t('hintStake')} ${fmtCoins(this.bet)}` });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: this.roundOpen ? null : this.bet,
      hints,
      stats: [{ label: this.t('stakeLabel'), value: fmtCoins(r ? r.stake : this.bet) }],
    });
  }

  // ── per-frame presentation (only while visible) ───────────────────────────────────────────────
  frame(dt: number, _t: number): void {
    const armed = this.visArmed && this.visMode !== 'idle';
    this.beaconAngle += dt * (armed ? 9 : this.visMode === 'idle' ? 1.2 : 4);
    this.parts.beacon.rotation.y = this.beaconAngle;
    (this.parts.beacon.material as THREE.MeshBasicMaterial).color?.setHex(armed ? RED : AMBER);

    this.paintRing();
    this.lightAcc += dt;
    if (this.lightAcc >= 1 / 30) { this.lightAcc = 0; this.moveLights(); }
    if (this.visMode === 'chase') this.chaseTicks();
    this.updateCentre();
    this.drawLeds();
  }

  /** Chase ticks step with the lamps, forward in sound even during a horror lap (only the visual reverses). */
  private chaseTicks(): void {
    const step = Math.floor(lampPos(this.visT, this.visPhase, this.visSlow));
    if (step === this.lastTickStep) return;
    this.lastTickStep = step;
    this.sfx('clockTick', { vol: 0.3 });
    if (this.visArmed && step % 6 === 0) this.sfx('ballBounce', { vol: 0.15, pitch: 12 });
  }

  // ── late join / save ────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { hist: [...this.st.hist] };
  }
  applySnapshot(s: State): void {
    this.st = { hist: s.hist.slice(0, HIST) };
    this.refresh();
  }
}

/** Ease-out for the coast deceleration. */
function easeOut(k: number): number {
  return 1 - (1 - k) * (1 - k);
}
