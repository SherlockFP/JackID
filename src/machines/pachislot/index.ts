/**
 * Oni Feast pachislot (`pachislot`) — skill-stop slot, solo occupant (MACHINES §7, tier 2, gallery).
 *
 * The logic / present split of the reference machines (`coinflip`, `bigone`):
 *  - authority (the local occupant): the lever draws the lottery FLAG (not sent), the stops are chosen by the reel
 *    control (`rules.chooseStop`) on each press, and every press is emitted as a `stop` event carrying the final stop.
 *    After the third stop the outcome is judged and a `result` event is emitted. Its `credit` step settles the wallet
 *    BEFORE the reels are shown (DECISIONS G). A BIG / REG line opens a bonus session, which runs its games on the
 *    authority and settles the whole session once at the end (tag `bonus`).
 *  - `present()` is the only place the reels, lamps and LCD change, on every peer.
 *  - a REPLAY returns its 3 medals (a push) and makes the next game free; a BIG / REG flag not aligned is carried and
 *    not redrawn until it is (the carried flag has priority for alignment).
 *  - the reels run at a constant 28 stops/s from the sim clock, so the stop under the payline at each press is exact;
 *    the reels stop after the press with a 0–4 stop slip. After 30 s the remaining reels stop at random.
 *  - juice: anticipation (lever spring, reel whir), crisp stop clacks with a thud, a 0.3 s sound cut before the
 *    announcement, a taiko hit and the oni eyes flaring, a rotating beacon and a rainbow lamp run during BIG, the
 *    medal waterfall on pay, near-miss on a flagged role that slipped away.
 *
 * Controls: Space / Enter = lever · 1 / 2 / 3 = stop left / centre / right (any order) · Z / X bet step · B max bet ·
 * H roles card · E stand. No autoplay (skill game).
 *
 * Charm hooks (`def.modHooks`): slipFrames, bonusGames, replayValue, autoAim, settingShift, settingPeek, jackpotChance,
 * and the core `luck`. The setting (1–6) is rolled once per instance from the world stream (identical on all peers).
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { KitX } from '@/kit';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TAU } from '@/core/math';
import { buildModel, type PachislotParts } from './model';
import {
  BET_STEPS, BET_IN, CYCLE_S, AUTO_STOP_S, HOOK, MEDALS_IN, SLIP, STOPS, UNITS,
  bonusPlan, chooseStop, clampSetting, clampSlip, drawFlag, hintColour, judge, maskOf, playHeadless, posAt,
  rollSetting, type Bonus, type Hint, type Role, type Setting,
} from './rules';
import { STRINGS } from './pachislot.strings';

export { playHeadless };

/** Event payloads (type aliases so they stay JSON-compatible). The lottery flag is never sent. */
type StartEv = { k: 'start'; v: number; free: boolean; game: number };
type StopEv = { k: 'stop'; reel: number; press: number; final: number; slip: number };
type ResultEv = {
  k: 'result'; v: number; game: number; role: string; medals: number; replay: boolean; free: boolean; bonus: Bonus | null;
  of: number; carry: Bonus | null; lost: boolean; tease: boolean; stops: number[];
};
type BonusEv = { k: 'bonus'; v: number; type: Bonus; game: number; of: number; out: number; net: number };
type BonusEndEv = { k: 'bonusEnd'; v: number; type: Bonus; net: number; hint: Hint };
type Ev = StartEv | StopEv | ResultEv | BonusEv | BonusEndEv;

type BonusState = { type: Bonus; of: number; game: number; net: number; v: number };
type State = {
  /** Base setting 1–6 (0 = not rolled yet). The effective setting adds `settingShift`. */
  setting: number;
  games: number;
  /** A BIG / REG flag carried until aligned. */
  held: Bonus | null;
  /** The next game is free (a REPLAY just paid its 3 medals back). */
  freeNext: boolean;
  bonus: BonusState | null;
  stops: number[];
  last: { role: string; medals: number };
  hint: Hint | null;
};

type Game = { flag: Role; target: Role; avoidTease: boolean; free: boolean; v: number; slipMax: number; autoAim: boolean };

const HINT_COLOUR: Record<Hint, number> = { white: 0xffffff, blue: 0x3060ff, purple: 0xb040ff, gold: 0xffd040 };
const LCD_PINK = '#ff5aa0';
const LCD_GOLD = '#ffd040';

export const def: MachineDef = {
  id: 'pachislot',
  category: 'skill',
  slotSize: 'M',
  zone: 'gallery',
  seats: 1,
  shared: false,
  minBet: BET_STEPS[0], maxBet: BET_STEPS[BET_STEPS.length - 1], betSteps: [...BET_STEPS],
  maxPayoutMult: 150,
  rtp: 0.948,
  tier: 2,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'slot', 'skill', 'bonus'],
  modHooks: {
    'm.pachislot.slipFrames': 'Max slip +N stops (base 4, cap 8). Easier aim.',
    'm.pachislot.bonusGames': 'BIG session +N games.',
    'm.pachislot.replayValue': 'REPLAY also pays N medals.',
    'm.pachislot.autoAim': 'Above 0: FAN and LANTERN become auto-catch.',
    'm.pachislot.settingShift': 'Effective setting +N (capped at 6).',
    'm.pachislot.settingPeek': 'Above 0: the LCD shows the setting for 3 s on sit-down.',
    'm.pachislot.jackpotChance': 'Multiplies the BIG weight (base 1).',
    luck: 'Luck: BIG and REG weights × (1 + 0.02·L), capped at ×1.6.',
  },
  strings: STRINGS,
};

const RULE_LINES: Txt[] = [
  ...['rule1', 'rule2', 'rolesHelp', 'rBigPay', 'rRegPay'].map((k) => ({ k: 'm.pachislot.' + k })),
];

export default class Pachislot extends MachineBase<PachislotParts, Ev, State> {
  private state: State = {
    setting: 0, games: 0, held: null, freeNext: false, bonus: null, stops: [6, 10, 14],
    last: { role: 'MISS', medals: 0 }, hint: null,
  };
  private game: Game | null = null;
  private stopped: (number | null)[] = [null, null, null];
  /** Reel clock (sim s) since the spin started; positions are `posAt(reel, spinT)`. */
  private spinT = 0;
  private spinning = false;
  private reelSpin: boolean[] = [false, false, false];
  private cycle = 0;
  private peekT = 0;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  private beaconOn = false;
  private bonusRunning = false;
  private attractOn = false;

  protected createModel(kit: KitX): MachineModel<PachislotParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    if (this.state.setting === 0) this.state.setting = rollSetting(this.worldRng);   // world 'init' stream: same on every peer
    this.refresh();
  }

  // ── attract: the side LEDs breathe, the oni eyes glance now and then ─────────────────────────────
  attract(dt: number, time: number): void {
    const on = Math.floor(time * 1.0) % 2 === 0;
    if (on !== this.attractOn && !this.occupant) {
      this.attractOn = on;
      this.parts.lamps.side.forEach((c) => c.pattern(on ? 'alt' : 'off', 0.5));
    }
    this.attractor.update(dt);
  }

  tick(dt: number): void {
    if (this.cycle > 0) this.cycle = Math.max(0, this.cycle - dt);
    if (this.peekT > 0) { this.peekT -= dt; if (this.peekT <= 0) this.drawScreen(); }
    if (this.beaconOn) this.parts.beacon.rotation.y += dt * TAU * 1.5;
    if (this.spinning) {
      this.spinT += dt;
      const { reels } = this.parts;
      for (let k = 0; k < 3; k++) if (this.reelSpin[k]) reels[k].setIndex(Math.floor(posAt(k, this.spinT)));
      // authority: after AUTO_STOP_S the remaining reels stop at random
      if (this.isLocalOccupant && this.game && this.spinT >= AUTO_STOP_S) {
        for (let k = 0; k < 3; k++) if (this.stopped[k] === null) this.pressReel(k, this.rng.int(0, STOPS - 1));
      }
    }
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      this.sfx('chime');
      if (this.mod(HOOK.peek, 0) > 0) this.peekT = 3;
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('pachislot', this.tipLines());
      if (this.state.bonus) void this.runBonus();      // a feast left unfinished (reload / snapshot) goes on
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.seatHud?.hide();
      if (this.roundOpen) this.settle({ gross: 0 });   // safety net: never strand a stake
      this.game = null;
      this.spinning = false;
      this.reelSpin = [false, false, false];
    }
    this.attractor.reset();
    this.refresh();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.lever(); break;
      case 'n1': this.pressKey(0); break;
      case 'n2': this.pressKey(1); break;
      case 'n3': this.pressKey(2); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  private changeBet(fn: () => void): void {
    if (this.busy || this.spinning || this.state.bonus || this.state.freeNext) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private pressKey(reel: number): void {
    if (!this.game || !this.spinning) return;
    this.pressReel(reel);
  }

  // ── authority: the lever starts a game ──────────────────────────────────────────────────────────
  private lever(): void {
    if (!this.isLocalOccupant || this.busy || this.spinning || this.bonusRunning || this.state.bonus) return;
    if (this.cycle > 0) return;                                    // minimum 4.1 s lever to lever
    const free = this.state.freeNext;
    if (!free && !this.beginRound(this.bet)) return;               // charges 3 medals × V, busy = true
    if (free) this.busy = true;                                    // a replayed game costs nothing (its wager is the refund)
    this.state.freeNext = false;
    const v = this.bet / MEDALS_IN;
    const flag = drawFlag(this.rng.int(0, UNITS - 1), this.effSetting(), this.luck(), this.jackpot(), this.state.held !== null);
    const target: Role = this.state.held ?? flag;
    this.game = {
      flag, target, free, v, slipMax: this.slipMax(), autoAim: this.autoAim(),
      avoidTease: target === 'MISS' && this.rng.next() < 0.5,
    };
    this.stopped = [null, null, null];
    this.spinT = 0;
    this.spinning = true;
    this.reelSpin = [true, true, true];
    this.cycle = CYCLE_S;
    this.state.games += 1;
    void this.emit({ k: 'start', v, free, game: this.state.games });
    this.showHud();
  }

  /** Reel control on a press: the stop under the payline now, then the plan (0–4 slip). Authority only. */
  private pressReel(reel: number, forcedPress?: number): void {
    const g = this.game;
    if (!g || !this.isLocalOccupant || this.stopped[reel] !== null) return;
    const press = forcedPress ?? Math.floor(posAt(reel, this.spinT));
    const plan = chooseStop({
      reel, press, stops: this.stopped, target: g.target, slipMax: g.slipMax, autoAim: g.autoAim, avoidTease: g.avoidTease,
    });
    this.stopped[reel] = plan.final;
    this.reelSpin[reel] = false;
    void this.emit({ k: 'stop', reel, press, final: plan.final, slip: plan.slip });
    if (this.stopped.every((s) => s !== null)) void this.resolve();
    this.showHud();
  }

  /** Judges the three stops and settles (or opens a bonus session). Authority only. */
  private async resolve(): Promise<void> {
    const g = this.game;
    if (!g) return;
    this.spinning = false;
    const stops = this.stopped as number[];
    const j = judge(maskOf(stops), g.flag, g.target, this.state.held, this.replayValue());
    const coins = j.medals * g.v;
    this.state.held = j.carry;
    this.state.freeNext = j.replay;
    this.state.stops = stops;
    this.state.last = { role: j.role, medals: j.medals };
    const of = j.bonus ? bonusPlan(j.bonus, this.bigExtra()).games : 0;
    if (j.bonus) this.state.bonus = { type: j.bonus, of, game: 0, net: 0, v: g.v };
    const tags = [...(g.free ? ['free'] : []), ...(j.bonus ? ['bonus'] : []), ...(j.role !== 'MISS' ? [`role:${j.role}`] : [])];
    const credit = j.bonus ? undefined : (): void => { this.settle({ gross: coins, tags }); };   // a bonus settles at its end
    const shown = this.emit({
      k: 'result', v: g.v, game: this.state.games, role: j.role, medals: j.medals, replay: j.replay, free: g.free, bonus: j.bonus,
      of, carry: j.carry, lost: j.lost, tease: j.tease, stops,
    }, credit);
    this.showHud();
    await shown;
    if (this.state.bonus) await this.runBonus();
    this.game = null;
  }

  /** The feast: its games run here on the authority, then one settle for the whole session. */
  private async runBonus(): Promise<void> {
    if (this.bonusRunning || !this.isLocalOccupant) return;
    const b = this.state.bonus;
    if (!b) return;
    this.bonusRunning = true;
    this.busy = true;
    this.showHud();
    try {
      const plan = bonusPlan(b.type, this.bigExtra());
      while (b.game < b.of) {
        b.game += 1;
        b.net += plan.out - BET_IN;
        await this.emit({ k: 'bonus', v: b.v, type: b.type, game: b.game, of: b.of, out: plan.out, net: b.net });
      }
      const hint = hintColour(this.effSetting(), this.rng);
      const net = b.net, v = b.v, type = b.type;
      this.state.bonus = null;
      this.state.hint = hint;
      const credit = (): void => { this.settle({ gross: net * v, tags: ['bonus', type] }); };
      await this.emit({ k: 'bonusEnd', v, type, net, hint }, credit);
    } finally {
      this.bonusRunning = false;
      if (this.busy && !this.roundOpen) this.busy = false;     // settle() normally clears busy; guard a refused emit
      this.showHud();
    }
  }

  // ── presentation: every peer, including the emitter ───────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'stop': return this.presentStop(ev, pc);
      case 'result': return this.presentResult(ev, pc);
      case 'bonus': return this.presentBonus(ev, pc);
      case 'bonusEnd': return this.presentBonusEnd(ev, pc);
    }
  }

  private async presentStart(ev: StartEv, pc: PresentCtx): Promise<void> {
    const { startLever, buttons } = this.parts;
    this.state.games = ev.game;
    if (!pc.local) {                                  // remote peers start their own reel clock
      this.spinT = 0;
      this.spinning = true;
      this.reelSpin = [true, true, true];
    }
    buttons.stop.forEach((b) => b.setLit(true));
    this.sfx('lever', { vol: 0.9 });
    this.sfx('ratchet', { vol: 0.5 });
    this.sfx('reelStart', { vol: 0.8 });
    this.drawScreen();
    await startLever.pull(pc.fast ? 0.03 : 0.10);
  }

  private async presentStop(ev: StopEv, pc: PresentCtx): Promise<void> {
    const { reels, buttons } = this.parts;
    this.reelSpin[ev.reel] = false;
    this.state.stops[ev.reel] = ev.final;
    buttons.stop[ev.reel].setLit(false);
    void buttons.stop[ev.reel].press(0.06);
    this.sfx('reelStop', { vol: 1, param: ev.reel / 2 });
    this.sfx('click', { vol: 0.6, pitch: 4 });
    if (pc.local) this.ctx.fx.shake(0.002, 0.08);
    const dur = pc.fast ? 0.04 : 0.05 + 0.03 * ev.slip;      // ≤ 0.19 s, the skill window
    await reels[ev.reel].stopAt(ev.final, dur, 0);
  }

  private async presentResult(ev: ResultEv, pc: PresentCtx): Promise<void> {
    const { lamps, beacon, reels, marquee } = this.parts;
    const s = this.state;
    s.games = ev.game;
    s.held = ev.carry;
    s.freeNext = ev.replay;
    s.last = { role: ev.role, medals: ev.medals };
    s.stops = ev.stops;
    if (ev.bonus) s.bonus = { type: ev.bonus, of: ev.of, game: 0, net: 0, v: ev.v };
    const bet = BET_IN * ev.v;
    const coins = ev.medals * ev.v;
    const tier = juiceTier(coins, bet);
    if (pc.local && !ev.bonus && (!ev.free || coins > 0)) {
      const net = coins - (ev.free ? 0 : bet);
      this.callout(net);
    }
    this.refresh();
    if (ev.bonus) {
      // the announcement: all sound cuts for 0.3 s, then a taiko hit, the oni eyes flare and the beacon turns
      await this.wait(0.3);                           // the sound cut
      this.sfx('thud', { vol: 1.3 });
      this.sfx('jackpot', { vol: 0.8 });
      this.beaconOn = true;
      lamps.oniEyes.forEach((e) => { e.setColor(0xff1010); e.setOn(true); });
      lamps.side.forEach((c) => c.pattern('rainbow', 20));
      marquee.chase('win', 10);
      this.ctx.fx.popText(reels[1].root, this.t(ev.bonus === 'BIG' ? 'announceBig' : 'announceReg'), 0xff5aa0, { dur: 1.2, rise: 0.25, scale: 1.2, shake: true });
      if (!pc.fast) await this.wait(0.9);
      return;
    }
    if (ev.replay) {
      lamps.lantern.blink(4, 0.8);
      this.ctx.fx.popText(reels[1].root, this.t('replayFree'), 0x4da6ff, { dur: 0.9, rise: 0.2, scale: 0.9 });
      this.sfx('click', { vol: 0.8 });
      if (!pc.fast) await this.wait(0.5);
      return;
    }
    if (coins > 0) {
      this.sfx('coinDrop');
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
        void this.celebrate(tier, { amount: coins, lamps: lamps.oniEyes, restore: () => this.refresh(), fast: pc.fast });
      } else {
        await this.pourCoins(coins, { bet, fast: pc.fast, onCount: () => this.drawScreen() });
      }
      this.drawScreen();
      return;
    }
    // a miss: the near-miss tease on a flagged role that slipped away, otherwise a plain loss beat
    if (ev.lost || ev.tease) {
      await this.nearMiss({ dur: 0.7, at: reels[1].root, lamps: [lamps.lantern], fast: pc.fast });
    } else {
      this.commiserate({ at: reels[1].root });
    }
    this.drawScreen();
  }

  private async presentBonus(ev: BonusEv, pc: PresentCtx): Promise<void> {
    const { reels, lamps } = this.parts;
    this.state.bonus = { type: ev.type, of: ev.of, game: ev.game, net: ev.net, v: ev.v };
    this.beaconOn = true;
    // the auto-aligned TRIBUTE: all three reels show the oni on the payline
    reels.forEach((r) => r.stopAt(0, pc.fast ? 0.04 : 0.12, 0));
    lamps.oniEyes.forEach((e) => e.setOn(true));
    this.sfx('coinShower', { vol: 0.5 });
    this.ctx.fx.popText(reels[1].root, `+${fmtCoins((ev.out - BET_IN) * ev.v)}`, 0xffd040, { dur: 1.0, rise: 0.3, scale: 1.0 });
    this.drawScreen();
    if (!pc.fast) await this.wait(2.5);
  }

  private async presentBonusEnd(ev: BonusEndEv, pc: PresentCtx): Promise<void> {
    const { lamps, beacon } = this.parts;
    if (pc.local) this.callout(ev.net * ev.v);
    this.state.bonus = null;
    this.state.hint = ev.hint;
    this.beaconOn = false;
    beacon.rotation.set(0, 0, 0);
    const colour = HINT_COLOUR[ev.hint];
    lamps.oniEyes.forEach((e) => { e.setColor(colour); e.setOn(true); });
    lamps.side.forEach((c) => c.pattern('alt', 1));
    const coins = ev.net * ev.v;
    const tier = juiceTier(coins, BET_IN * ev.v);
    this.drawScreen(coins);
    this.ctx.fx.popText(this.parts.reels[1].root, this.t('feastEnd'), 0xffd040, { dur: 1.3, rise: 0.35, scale: 1.2, shake: true });
    if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
      await this.celebrate(tier, { amount: coins, lamps: lamps.oniEyes, restore: () => this.refresh(), fast: pc.fast });
    } else {
      await this.pourCoins(coins, { bet: BET_IN * ev.v, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
    }
    this.refresh();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, stops: [...this.state.stops], bonus: this.state.bonus ? { ...this.state.bonus } : null };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, stops: [...s.stops], bonus: s.bonus ? { ...s.bonus } : null };
    this.refresh();
    if (this.state.bonus && this.isLocalOccupant) void this.runBonus();
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────────
  private effSetting(): Setting {
    return clampSetting(this.state.setting + Math.floor(this.mod(HOOK.shift, 0)));
  }
  private slipMax(): number { return clampSlip(SLIP + Math.floor(this.mod(HOOK.slip, 0))); }
  private replayValue(): number { return Math.max(0, Math.floor(this.mod(HOOK.replayValue, 0))); }
  private bigExtra(): number { return Math.max(0, Math.floor(this.mod(HOOK.bonusGames, 0))); }
  private jackpot(): number { return Math.max(0, this.mod(HOOK.jackpot, 1)); }
  private autoAim(): boolean { return this.mod(HOOK.autoAim, 0) > 0; }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const { reels, lamps, buttons, beacon } = this.parts;
    reels.forEach((r, k) => {
      this.reelSpin[k] = false;
      r.setIndex(this.state.stops[k] ?? 0);
    });
    buttons.stop.forEach((b) => b.setLit(false));
    buttons.betMax.setLit(!this.roundOpen);
    const held = this.state.held;
    lamps.oniEyes.forEach((e) => { e.setColor(0xff1010); e.setOn(held !== null || this.state.bonus !== null); });
    lamps.lantern.setOn(this.state.freeNext);
    this.beaconOn = this.state.bonus !== null;
    if (!this.beaconOn) beacon.rotation.set(0, 0, 0);
    lamps.side.forEach((c) => c.pattern(held ? 'chase' : 'alt', held ? 6 : 0.5));
    this.drawScreen();
  }

  /** The 160 × 120 LCD: game count, the bonus / hold / replay state, the last pay (or a count-up) and the setting peek. */
  private drawScreen(winShown?: number): void {
    const s = this.state;
    this.parts.screens.lcd.draw((g, sc) => {
      g.fillStyle = '#0a0408'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(this.t('game', { n: s.games }), 80, 6, { font: 'px5', color: LCD_PINK, align: 'center' });
      if (s.bonus) {
        const key = s.bonus.type === 'BIG' ? 'feast' : 'parade';
        sc.text(this.t(key, { n: s.bonus.game, of: s.bonus.of }), 80, 34, { font: 'px5', color: LCD_GOLD, align: 'center' });
        sc.text(`+${fmtCoins(s.bonus.net * s.bonus.v)}`, 80, 46, { font: 'px5', color: LCD_GOLD, align: 'center' });
      } else if (s.held) {
        sc.text(this.t(s.held === 'BIG' ? 'holdBig' : 'holdReg'), 80, 34, { font: 'px5', color: LCD_PINK, align: 'center' });
      } else if (s.freeNext) {
        sc.text(this.t('replayFree'), 80, 34, { font: 'px5', color: '#4da6ff', align: 'center' });
      } else {
        sc.text(this.t('ready'), 80, 34, { font: 'px5', color: '#7a7a8a', align: 'center' });
      }
      const pay = winShown !== undefined ? `+${fmtCoins(winShown)}` : this.t('pay', { n: s.last.medals });
      sc.text(pay, 80, 84, { font: 'px5', color: LCD_GOLD, align: 'center' });
      if (this.peekT > 0) sc.text(this.t('set', { n: this.effSetting() }), 80, 100, { font: 'px5', color: '#ffffff', align: 'center' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.pachislot.tip1', v: { lever: this.k('primary') } },
      { k: 'm.pachislot.tip2', v: { l: this.k('n1'), c: this.k('n2'), r: this.k('n3') } },
      { k: 'm.pachislot.tip3', v: { bet: `${this.k('betDown')}/${this.k('betUp')}`, max: this.k('betMax'), help: this.k('help') } },
    ];
  }

  /** Result callout for the local player: `net` = coins back minus the stake. */
  private callout(net: number): void {
    this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net);
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state;
    const stopping = this.spinning && this.game !== null;
    sh.goal({ k: 'm.pachislot.goal' });

    // STATE: what the cabinet waits for
    if (s.bonus) sh.state({ k: 'm.pachislot.stBonus', v: { n: s.bonus.game, of: s.bonus.of } }, 'warn', { k: 'm.pachislot.fullBonus' });
    else if (stopping) sh.state({ k: 'm.pachislot.stStop' }, 'cyan', { k: 'm.pachislot.stStopSub' });
    else if (this.busy) sh.state({ k: 'm.pachislot.stBusy' }, 'neutral');
    else if (s.freeNext) sh.state({ k: 'm.pachislot.stFree' }, 'cyan', { k: 'm.pachislot.stFreeSub' });
    else if (s.held) sh.state({ k: s.held === 'BIG' ? 'm.pachislot.stHoldOni' : 'm.pachislot.stHoldLantern' }, 'good', { k: 'm.pachislot.stHoldSub' });
    else sh.state({ k: 'm.pachislot.stLever' }, 'gold', { k: 'm.pachislot.stLeverSub', v: { n: fmtCoins(this.bet) } });

    // KEY NUMBERS: stake (free on a replay), game count, last pay, bonus net, balance
    const nums: HudNumber[] = [
      s.freeNext
        ? { label: { k: 'm.pachislot.nBet' }, value: { k: 'm.pachislot.nFree' }, tone: 'cyan' }
        : { label: { k: 'm.pachislot.nBet' }, value: fmtCoins(this.bet), tone: 'gold' },
      { label: { k: 'm.pachislot.nGame' }, value: String(s.games), tone: 'neutral' },
    ];
    if (s.last.medals > 0) nums.push({ label: { k: 'm.pachislot.nLast' }, value: { k: 'm.pachislot.medalsN', v: { n: s.last.medals } }, tone: 'good' });
    if (s.bonus) nums.push({ label: { k: 'm.pachislot.nBonus' }, value: fmtCoins(s.bonus.net * s.bonus.v), tone: s.bonus.net >= 0 ? 'good' : 'bad' });
    nums.push({ label: { k: 'm.pachislot.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (stopping) {
      const keys = ['n1', 'n2', 'n3'] as const;
      this.stopped.forEach((st, r) => {
        if (st === null) ctrl.push({ key: this.k(keys[r]), label: { k: 'm.pachislot.cStop', v: { n: r + 1 } }, action: keys[r], primary: true });
      });
    } else if (!this.busy && !s.bonus) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.pachislot.cLever' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.pachislot.cBet' }, action: 'betUp' });
      ctrl.push({ key: this.k('betMax'), label: { k: 'm.pachislot.cMax' }, action: 'betMax' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.pachislot.cRoles' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.pachislot.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }
}
