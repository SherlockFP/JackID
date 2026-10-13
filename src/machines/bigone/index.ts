/**
 * The Big One (`bigone`) — hero 5×3 pattern slot (MACHINES §2). Copies the coinflip pattern: the logic / present split.
 *
 *  - `spin()` runs on the authority (the local occupant): `beginRound` charges the stake, the pure rules in
 *    `rules.ts` roll the grid, and the outcome is packed into a `spin` event and an `eval` event. The `eval` event
 *    carries the settle as its `credit` (settle-before-present, DECISIONS G).
 *  - `present()` is the only place state changes and the reels move, on every peer.
 *  - juice: lever pull, reel spin-up, staggered stops (1.00 + 0.25 n s) with a bounce, tease crawl on the last reel,
 *    cell and pattern lamps, coin pour, tiered win shows through `celebrate` (big / huge / mega / jackpot), curse
 *    (red flash, chroma glitch), jackpot (lid, medallion, gold count-up).
 *  - autoplay (G) with a size cycled by Backspace; it stops on big wins, curses, jackpots, no funds and no pulls.
 *
 * Controls: Space / LMB / Enter spin · Z / X / wheel stake · B max · G autoplay (again = stop) · Backspace auto size
 * · 1–5 hold a reel (charm / milestone) · H pattern card · F fast · E stand.
 */
import type * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import { countUp, blinkOn } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { KitX } from '@/kit';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TAU } from '@/core/math';
import { buildModel, type BigOneParts } from './model';
import {
  CELLS, MAW, MAX_STAKE, PATTERN_IDS, PATTERN_MULT, SEED_STAKES, SYM_COUNT, buildMods, curseChance,
  play, playHeadless, type Mods, type Outcome, type PatternId,
} from './rules';
import { STRINGS } from './strings';
import { SYMBOL_BG, paintSymbol } from './symbols';

export { playHeadless };

/** Event payloads (type aliases so they stay JSON-compatible). */
type PayEv = { pat: string; sym: number; cells: number[]; amount: number };
type SpinEv = {
  k: 'spin'; stake: number; grid: number[]; pre: number[] | null; coalesced: number[]; teaser: number[];
  curse: boolean; curseCol: number; ward: boolean; fill: boolean; fillSym: number; respin: boolean; tease: boolean;
  hold: number; meter: number; since: number; night: number;
};
type EvalEv = {
  k: 'eval'; stake: number; gross: number; jackpot: number; curse: boolean; fill: boolean; tease: boolean;
  pays: PayEv[]; clusters: PayEv[]; tags: string[]; meter: number;
};
type HoldEv = { k: 'hold'; reel: number };
type Ev = SpinEv | EvalEv | HoldEv;
type State = {
  grid: number[]; meter: number; k: number; night: number; last10: number[]; hold: number; wardUsed: number; gross: number;
};

/** Reel n stops at 1.00 + 0.25 n s (MACHINES §2.3 spin order, juice timing). */
const STOP_T = [1.0, 1.25, 1.5, 1.75, 2.0];
const TEASE_T = 1.4;
const BOUNCE = 0.12;
const EVAL_STEP = 0.4;
const EVAL_CAP = 3.3;
const CURSE_SHOW = 3.2;
const JACKPOT_COUNT = 2.0;
const LAST10 = 10;
const LID_OPEN = (25 * Math.PI) / 180;
const LEVER_PULL = 1.05;
const GOLD = 0xffd040;
const RED = 0xff1a2a;
const PINK = 0xff4fa0;
const AUTO_SIZES = [5, 10, 25];
const DEFAULT_GRID = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0];
const HOLD_KEYS: Record<string, number> = { n1: 0, n2: 1, n3: 2, n4: 3, n5: 4 };

export const def: MachineDef = {
  id: 'bigone',
  category: 'slot',
  slotSize: 'XL',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: MAX_STAKE, betSteps: [1, 2, 5, 10, 20, 50, 100],
  maxPayoutMult: 400,
  rtp: 0.947,
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'slot', 'hero', 'pattern'],
  modHooks: {
    'x.bigone.symbolValueAdd[SYM]': 'Symbol value +N (int).',
    'x.bigone.symbolValueMult': 'Multiplier on every symbol value (float).',
    'x.bigone.symbolWeight[SYM]': 'Draw weight +N (GHOST included).',
    'x.bigone.symbolBan[SYM]': 'Bans a symbol (weight 0). At least three symbols always remain.',
    'x.bigone.patternMult[PATTERN]': 'Pattern multiplier +N (float). Plain x.bigone.patternMult adds to every pattern.',
    'x.bigone.extraPattern': 'Unlocks TWIN RAILS and CORNERSTONE (charm).',
    'x.bigone.wildChance': 'Chance each cell becomes GHOST (wild), 0 to 0.2.',
    'x.bigone.curseChanceMult': 'Multiplies the curse (EATEN) chance.',
    'x.bigone.curseWard': 'Curse ward charges: an EATEN spin becomes a normal spin, consuming one.',
    'x.bigone.jackpotFeed': 'Meter feed as a fraction of every stake (default 0.01).',
    'x.bigone.respin': 'Chance after a losing spin to respin reels 4 and 5 for free.',
    'x.bigone.holdReel': 'Allows holding one reel between spins (keys 1 to 5).',
    'jackpot.mult': 'Multiplies the FULL (jackpot) odds.',
    luck: 'Luck: coalesce chance +1 % per point (cap 30 %), plus the pre-coalesce grid for a visible jump.',
  },
  strings: STRINGS,
};

export default class BigOne extends MachineBase<BigOneParts, Ev, State> {
  private state: State = {
    grid: DEFAULT_GRID.slice(), meter: SEED_STAKES * MAX_STAKE, k: 0, night: -1, last10: [], hold: -1, wardUsed: 0, gross: 0,
  };
  private autoLeft = 0;
  private autoSize = AUTO_SIZES[0];
  private fastOn = false;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  private attractStep = -1;
  private inRound = false;

  protected createModel(kit: KitX): MachineModel<BigOneParts> {
    return buildModel(kit, this.modelOpts);
  }

  /** Fast mode halves every animation (local presentation only; the sim clock is unchanged). */
  protected override get speed(): number {
    return super.speed * (this.fastOn ? 0.5 : 1);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.bulbsIdle();
    this.attractor.every('medal', 9, () => this.spinMedal(), { first: 4 });
  }

  // ── attract: the pattern plate chases, the medallion turns now and then ─────────────────────────
  attract(dt: number, time: number): void {
    const step = Math.floor(time * 6) % PATTERN_IDS.length;
    if (step !== this.attractStep) {
      this.attractStep = step;
      this.parts.patternLamps.forEach((l, i) => l.setOn(i === step));
    }
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    this.bulbsIdle();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('bigone', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.autoLeft = 0;
      this.seatHud?.hide();
      if (this.roundOpen) this.settle({ gross: 0 });   // safety net: never strand a stake
    }
    this.attractor.reset();
    this.refresh();
    this.bulbsIdle();
  }

  /** E / pause "STAND UP": cancel autoplay now. The current round (if any) still settles, then the seat is released. */
  protected override onStandUpRequest(): void {
    if (this.autoLeft === 0) return;
    this.autoLeft = 0;
    this.showHud();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': this.spinKey(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
      case 'auto': this.toggleAuto(); break;
      case 'clear': this.cycleAutoSize(); break;
      case 'fast': this.fastOn = !this.fastOn; this.sfx('click'); this.showHud(); break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': this.toggleHold(HOLD_KEYS[a]); break;
    }
  }

  private changeBet(fn: () => void): void {
    if (this.inRound || this.roundOpen || this.autoLeft > 0) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private spinKey(): void {
    if (this.autoLeft > 0) return;
    void this.spin();
  }

  private toggleAuto(): void {
    if (this.autoLeft > 0) { this.autoStop(); return; }
    this.autoLeft = this.autoSize;
    this.sfx('button');
    if (!this.inRound && !this.busy && !this.roundOpen) void this.spin();
    this.showHud();
  }

  private cycleAutoSize(): void {
    if (this.autoLeft > 0) return;
    const i = AUTO_SIZES.indexOf(this.autoSize);
    this.autoSize = AUTO_SIZES[(i + 1) % AUTO_SIZES.length];
    this.sfx('click');
    this.showHud();
  }

  private autoStop(): void {
    this.autoLeft = 0;
    this.showHud();
  }

  private toggleHold(reel: number): void {
    if (this.inRound || this.busy || this.roundOpen || this.autoLeft > 0 || !this.currentMods().holdOn) return;
    void this.emit({ k: 'hold', reel: this.state.hold === reel ? -1 : reel });
  }

  // ── authority-side logic: runs only on the local occupant ───────────────────────────────────────
  private async spin(): Promise<void> {
    if (this.inRound || this.busy || this.roundOpen || this.disposed || !this.isLocalOccupant) return;
    this.inRound = true;   // held until the eval presentation ends, so the next roll sees the final meter
    try {
      const stake = this.bet;
      if (!this.beginRound(stake)) { this.autoStop(); return; }
      this.showHud();
      let res: Outcome | null = null;
      try {
        const out = this.roll(stake);
        res = out;
        await this.emit(spinEvent(out, stake, this.sinceCurse(), this.ctx.run.night()));
        await this.emit(evalEvent(out, stake), () => this.settle({ gross: out.gross, tags: out.tags }));
      } finally {
        if (this.roundOpen) this.settle({ gross: 0 });   // never strand a stake (rule 7)
      }
      if (res && this.autoLeft > 0 && !this.disposed) {
        const big = tierAtLeast(juiceTier(res.gross, stake, res.tags), 'big');
        this.autoLeft = big || res.curse || res.fill ? 0 : this.autoLeft - 1;
        if (this.autoLeft > 0) void this.wait(0.6).then(() => this.autoTick());
      }
    } finally {
      this.inRound = false;
      this.showHud();
    }
  }

  private autoTick(): void {
    if (this.disposed || this.autoLeft <= 0 || this.inRound || this.busy || this.roundOpen) return;
    if (!this.isLocalOccupant || this.ctx.run.pulls() < this.def.actionCost) { this.autoStop(); return; }
    void this.spin();
  }

  /** The authority's roll: pure rules over the round rng and the current state. */
  private roll(stake: number): Outcome {
    const s = this.state;
    const mods = this.currentMods();
    const maxStake = this.maxStake();
    return play(this.rng, stake, {
      mods, luck: this.luck(), sinceCurse: this.sinceCurse(), wardOn: mods.wardCharges - s.wardUsed > 0,
      meter: s.meter, maxStake, prev: s.grid, hold: s.hold,
    });
  }

  /** Spins since the last curse, reset at each Night (the curse deadline, MACHINES §2.3). */
  private sinceCurse(): number {
    return this.ctx.run.night() === this.state.night ? this.state.k : 0;
  }

  private currentMods(): Mods {
    return buildMods((hook, base) => this.mod(hook, base), (f) => this.feature(f));
  }

  private maxStake(): number {
    const l = this.betLadder();
    return l[l.length - 1] ?? MAX_STAKE;
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'spin': return this.presentSpin(ev, pc);
      case 'eval': return this.presentEval(ev, pc);
      case 'hold': return this.presentHold(ev);
    }
  }

  private presentHold(ev: HoldEv): void {
    this.state.hold = ev.reel;
    this.sfx('click');
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  private async presentSpin(ev: SpinEv, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const p = this.parts;
    s.k = ev.curse ? 0 : ev.since + 1;
    s.night = ev.night;
    if (ev.ward) s.wardUsed += 1;
    s.hold = -1;
    s.grid = ev.grid.slice();
    s.meter = ev.meter;
    this.clearHighlights();
    if (pc.fast) {
      for (let i = 0; i < 5; i++) this.paintReel(i, ev.grid);
      p.reels.forEach((r) => { r.root.rotation.x = 0; });
      this.drawScreen();
      return;
    }

    // anticipation: lever pull and spin button, reels paint a random strip under the stop faces
    this.sfx('lever');
    void this.parts.buttons.spin.press(0.15);
    void this.anim(0.15, (k) => { p.lever.rotation.x = LEVER_PULL * k; }, 'outQuad')
      .then(() => this.anim(0.5, (k) => { p.lever.rotation.x = LEVER_PULL * (1 - k); }, 'outBounce'));
    for (let i = 0; i < 5; i++) this.paintReel(i, ev.grid);
    this.sfx('reelStart');

    const runs: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      if (i === ev.hold) { runs.push(Promise.resolve()); continue; }   // held reel stays put
      const extra = ev.respin && i >= 3 ? 0.8 : 0;
      const stop = STOP_T[i] + extra + (ev.tease && i === 4 ? TEASE_T : 0);
      runs.push(this.spinReel(i, stop));
    }
    if (ev.tease) void this.nearMiss({ dur: TEASE_T, at: p.screens.top.mesh, lamps: p.paylineLamps });
    if (ev.tease) this.drawText(this.t('tease'));
    await Promise.all(runs);
    for (const c of ev.coalesced) this.flashCell(c);
    this.drawScreen();
  }

  /** One reel: whole turns that end with facet 0 at the front, decelerating, then a bounce. */
  private spinReel(i: number, dur: number): Promise<void> {
    const reel = this.parts.reels[i];
    const a0 = reel.root.rotation.x;
    const end = Math.ceil((a0 + (4 + i) * TAU) / TAU) * TAU;
    return this.anim(dur, (k) => { reel.root.rotation.x = a0 + (end - a0) * k; }, 'outCubic').then(async () => {
      this.sfx('reelStop', { vol: 0.8 + 0.05 * i });
      await this.anim(BOUNCE, (k) => { reel.root.rotation.x = end + 0.08 * Math.sin(Math.PI * k); });
      reel.root.rotation.x = 0;
    });
  }

  private async presentEval(ev: EvalEv, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.meter = ev.meter;
    s.gross = ev.gross;
    if (pc.local) {
      if (ev.curse) this.seatHud?.result('bust', -ev.stake);
      else this.callout(ev.gross - ev.stake);
    }
    const code = ev.curse ? 2 : ev.fill ? 3 : ev.gross > 0 ? 1 : 0;
    s.last10 = [code, ...s.last10].slice(0, LAST10);
    this.drawLast10();
    if (ev.curse) return this.presentCurse(pc);
    if (ev.fill) return this.presentJackpot(ev, pc);

    if (!pc.fast && ev.pays.length) {
      const step = Math.min(EVAL_STEP, EVAL_CAP / ev.pays.length);
      for (const pay of ev.pays) {
        this.lightPay(pay);
        this.sfx('sparkle', { vol: 0.6 });
        await this.wait(step);
      }
    } else {
      for (const pay of ev.pays) this.lightPay(pay);
    }
    for (const c of ev.clusters) this.lightCells(c.cells);

    if (ev.gross > 0) {
      const tier = juiceTier(ev.gross, ev.stake, ev.tags);
      if (tierAtLeast(tier, 'medium')) {
        await Promise.all([
          this.celebrate(tier, {
            amount: ev.gross, bulbs: this.parts.bulbs.window, lamps: this.parts.paylineLamps,
            restore: () => this.bulbsIdle(), fast: pc.fast,
          }),
          countUp(this.ctx, 0, ev.gross, pc.fast ? 0.1 : 1.2 * this.speed, (v) => this.drawScreen(v)),
        ]);
      } else {
        await this.pourCoins(ev.gross, { bet: ev.stake, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
      }
    } else {
      this.commiserate({ amount: ev.stake, at: this.parts.screens.top.mesh });
      if (!pc.fast) await this.wait(0.3);
    }
    this.clearHighlights();
    this.drawScreen();
  }

  private async presentCurse(pc: PresentCtx): Promise<void> {
    this.sfx('error', { vol: 0.9 });
    this.drawScreen();
    if (pc.fast) return;
    const fx = this.ctx.fx;
    fx.flash(RED, 0.5, 0.25);
    fx.tint(RED, 0.3, 0.8);
    fx.chroma(14, 0.6);
    if (pc.local) fx.shake(0.02, 0.5);
    fx.glow(this.parts.screens.top.mesh, RED, 0.6, 0.6);
    this.drawText(this.t('curseWarn'));
    // glitch: the trio of MAW cells flickers; the other cells stay dark
    const maw: number[] = [];
    this.state.grid.forEach((v, i) => { if (v === MAW) maw.push(i); });
    await this.anim(CURSE_SHOW, (k) => {
      const on = blinkOn(k * CURSE_SHOW, 9, 0.6) || this.cosmetic.next() < 0.1;
      for (const i of maw) this.setCell(i, on);
    });
    this.clearHighlights();
    this.drawScreen();
  }

  private async presentJackpot(ev: EvalEv, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    this.sfx('jackpot');
    this.drawScreen();
    if (pc.fast) return;
    const fx = this.ctx.fx;
    fx.flash(GOLD, 0.8, 0.4);
    fx.hitstop(0.12);
    await Promise.all([
      this.celebrate('jackpot', { amount: ev.gross, bulbs: p.bulbs.window, lamps: p.last10, restore: () => this.bulbsIdle() }),
      countUp(this.ctx, 0, ev.gross, JACKPOT_COUNT * this.speed, (v) => this.drawScreen(v)),
      this.anim(0.4, (k) => { p.topLid.rotation.x = LID_OPEN * k; }, 'outBack')
        .then(() => this.anim(0.4, (k) => { p.topLid.rotation.x = LID_OPEN * (1 - k); })),
      this.anim(1.4, (k) => { p.medallion.rotation.y = TAU * 3 * k; }, 'outCubic'),
    ]);
    p.medallion.rotation.y = 0;
    this.clearHighlights();
    this.drawScreen();
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  private spinMedal(): void {
    if (this.busy || this.occupant !== null) return;
    void this.anim(1.2, (k) => { this.parts.medallion.rotation.y = TAU * k; }, 'outCubic');
  }

  /** Idle bulbs and the LED strip. Repeats are cheap and idempotent. */
  private bulbsIdle(): void {
    this.parts.bulbs.crown.pattern('chase', 3);
    this.parts.bulbs.window.pattern('alt', 2);
    this.parts.ledStrip.pattern('chase', 4);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const p = this.parts;
    p.reels.forEach((_, i) => this.paintReel(i, this.state.grid));
    p.reels.forEach((r) => { r.root.rotation.x = 0; });
    p.lever.rotation.x = 0;
    p.topLid.rotation.x = 0;
    p.medallion.rotation.y = 0;
    p.glassCrack.visible = !this.feature('bigone.upgraded');
    this.clearHighlights();
    this.drawLast10();
    this.setNeedle();
    this.drawScreen();
  }

  /** Paint one drum: facet 0 = middle row, facet 1 = top row, facet 15 = bottom row; other facets are cosmetic. */
  private paintReel(i: number, grid: readonly number[]): void {
    const reel = this.parts.reels[i];
    const g = reel.canvas.getContext('2d');
    if (!g) return;
    for (let f = 0; f < 16; f++) {
      const y = f * 32;
      g.fillStyle = SYMBOL_BG;
      g.fillRect(0, y, 32, 32);
      let sym: number;
      if (f === 0) sym = grid[5 + i];
      else if (f === 1) sym = grid[i];
      else if (f === 15) sym = grid[10 + i];
      else sym = this.cosmetic.int(0, SYM_COUNT - 1);
      paintSymbol(g, sym, 0, y);
    }
    reel.strip.needsUpdate = true;
  }

  private setCell(i: number, on: boolean): void {
    const m = this.parts.cellFrames[i]?.material as THREE.MeshStandardMaterial | undefined;
    if (m && 'emissiveIntensity' in m) m.emissiveIntensity = on ? 1.6 : 0.26;
  }

  private flashCell(i: number): void {
    this.setCell(i, true);
    void this.wait(0.25).then(() => this.setCell(i, false));
  }

  private lightCells(cells: readonly number[]): void {
    for (const c of cells) this.setCell(c, true);
  }

  /** A paying line: its cells glow, its pattern lamp lights, and the payline lamps of its rows. */
  private lightPay(pay: PayEv): void {
    this.lightCells(pay.cells);
    const idx = PATTERN_IDS.indexOf(pay.pat as PatternId);
    if (idx >= 0) this.parts.patternLamps[idx]?.setOn(true);
    for (const r of new Set(pay.cells.map((c) => Math.floor(c / 5)))) {
      this.parts.paylineLamps[r]?.setOn(true);
      this.parts.paylineLamps[3 + r]?.setOn(true);
    }
  }

  private clearHighlights(): void {
    for (let i = 0; i < CELLS; i++) this.setCell(i, false);
    this.parts.paylineLamps.forEach((l) => l.setOn(false));
    this.parts.patternLamps.forEach((l) => l.setOn(false));
  }

  private drawLast10(): void {
    this.parts.last10.forEach((lamp, i) => {
      const code = this.state.last10[i];
      if (code === undefined || code === 0) { lamp.setOn(false); return; }
      lamp.setColor(code === 2 ? RED : code === 3 ? PINK : GOLD);
      lamp.setOn(true);
    });
  }

  /** Hunger dial: needle from left (0 %) to right (5 %) of the curse chance. */
  private setNeedle(): void {
    this.parts.hungerNeedle.rotation.z = Math.PI / 2 - Math.PI * this.hungerPct();
  }

  private hungerPct(): number {
    const pc = curseChance(this.state.k, this.currentMods().curse);
    return Math.min(1, pc / 0.05);
  }

  /** The 160×48 top screen: meter, result line, hunger bar, autoplay / hold status (or the pattern card). */
  private drawScreen(shown?: number): void {
    const s = this.state;
    this.setNeedle();
    this.parts.screens.top.draw((g, sc) => {
      g.fillStyle = '#120406';
      g.fillRect(0, 0, sc.w, sc.h);
      sc.text(`${this.t('jackpot')} ${fmtCoins(Math.floor(s.meter))}`, 80, 3, { font: 'px5', color: '#ffd040', align: 'center' });
      if (shown !== undefined) {
        sc.text(`+${fmtCoins(shown)}`, 80, 13, { font: 'px5', color: '#ffd040', align: 'center' });
      } else if (s.last10[0] === 2) {
        sc.text(this.t('eaten'), 80, 13, { font: 'px5', color: '#ff3040', align: 'center' });
      } else if (s.gross > 0) {
        sc.text(this.t('win', { n: fmtCoins(s.gross) }), 80, 13, { font: 'px5', color: '#ffd040', align: 'center' });
      } else {
        sc.text(`${this.t('bet')} ${fmtCoins(this.bet)}`, 80, 13, { font: 'px5', color: '#4a8a4a', align: 'center' });
      }
      g.fillStyle = '#3a1010';
      g.fillRect(20, 24, 120, 4);
      g.fillStyle = '#c0182a';
      g.fillRect(20, 24, Math.round(120 * this.hungerPct()), 4);
      sc.text(this.t('hunger'), 80, 31, { font: 'px5', color: '#c0182a', align: 'center' });
      const status = this.autoLeft > 0
        ? this.t('autoOn', { n: this.autoLeft })
        : s.hold >= 0 ? this.t('hold', { n: s.hold + 1 }) : this.t('autoSize', { n: this.autoSize });
      sc.text(status, 80, 40, { font: 'px5', color: '#7dffe0', align: 'center' });
    });
  }

  /** A one-line caption on the top screen (tease, curse). Redrawn by `drawScreen` afterwards. */
  private drawText(line: string): void {
    this.parts.screens.top.draw((g, sc) => {
      g.fillStyle = '#120406';
      g.fillRect(0, 0, sc.w, sc.h);
      sc.text(line, 80, 20, { font: 'px5', color: '#ffb0b0', align: 'center' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.bigone.tip1', v: { spin: this.k('primary'), stake: `${this.k('betDown')}/${this.k('betUp')}` } },
      { k: 'm.bigone.tip2', v: { auto: this.k('auto') } },
      { k: 'm.bigone.tip3', v: { help: this.k('help') } },
    ];
  }

  /** The rules card: three rules, then every pattern with its multiplier, four to a line. */
  private rulesLines(): Txt[] {
    const lines: Txt[] = ['rule1', 'rule2', 'rule3'].map((k) => ({ k: 'm.bigone.' + k }));
    for (let i = 0; i < PATTERN_IDS.length; i += 4) {
      lines.push(PATTERN_IDS.slice(i, i + 4)
        .map((pat) => `${this.t(`pat_${pat}`)} x${pat === 'CLUSTER' ? 'n-5' : PATTERN_MULT[pat]}`)
        .join('   '));
    }
    return lines;
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
    const busy = this.inRound || this.busy || this.roundOpen;
    sh.goal({ k: 'm.bigone.goal' });

    // STATE: auto, spinning, a held reel, or ready for the next spin
    if (this.autoLeft > 0) sh.state({ k: 'm.bigone.stAuto', v: { n: this.autoLeft } }, 'cyan', { k: 'm.bigone.stAutoSub' });
    else if (busy) sh.state({ k: 'm.bigone.stSpinning' }, 'cyan');
    else if (s.hold >= 0) sh.state({ k: 'm.bigone.stHold', v: { n: s.hold + 1 } }, 'good', { k: 'm.bigone.stHoldSub' });
    else sh.state({ k: 'm.bigone.stReady' }, 'gold', { k: 'm.bigone.stReadySub', v: { n: fmtCoins(this.bet) } });

    // KEY NUMBERS: stake, last win, jackpot meter, hunger, balance
    const hunger = this.hungerPct();
    const nums: HudNumber[] = [
      { label: { k: 'm.bigone.nStake' }, value: fmtCoins(this.roundOpen ? this.roundBet : this.bet), tone: 'gold' },
      { label: { k: 'm.bigone.nLast' }, value: fmtCoins(s.gross), tone: s.gross > 0 ? 'good' : 'neutral' },
      { label: { k: 'm.bigone.nJackpot' }, value: fmtCoins(Math.floor(s.meter)), tone: 'gold' },
      { label: { k: 'm.bigone.nHunger' }, value: `${Math.round(hunger * 100)}%`, tone: hunger > 0.7 ? 'bad' : 'neutral' },
      { label: { k: 'm.bigone.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' },
    ];
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (this.autoLeft > 0) {
      ctrl.push({ key: this.k('auto'), label: { k: 'm.bigone.cStopAuto' }, action: 'auto', primary: true });
    } else {
      if (!busy) {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.bigone.cSpin' }, action: 'primary', primary: true });
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.bigone.cStake' }, action: 'betUp' });
        ctrl.push({ key: this.k('betMax'), label: { k: 'm.bigone.cMax' }, action: 'betMax' });
      }
      ctrl.push({ key: this.k('auto'), label: { k: 'm.bigone.cAuto' }, action: 'auto' });
      if (!busy) {
        ctrl.push({ key: this.k('clear'), label: { k: 'm.bigone.cSize', v: { n: this.autoSize } }, action: 'clear' });
        if (this.currentMods().holdOn) ctrl.push({ key: `${this.k('n1')}-${this.k('n5')}`, label: { k: 'm.bigone.cHold' }, action: 'n1' });
      }
    }
    ctrl.push({ key: this.k('fast'), label: { k: this.fastOn ? 'm.bigone.cFastOn' : 'm.bigone.cFast' }, action: 'fast' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.bigone.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.bigone.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── late join / save ────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, grid: [...this.state.grid], last10: [...this.state.last10] };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, grid: [...s.grid], last10: [...s.last10] };
    this.refresh();
  }
}

/** Build the `spin` presentation event from the authority's outcome. */
function spinEvent(o: Outcome, stake: number, since: number, night: number): SpinEv {
  return {
    k: 'spin', stake, grid: o.grid, pre: o.pre, coalesced: o.coalesced, teaser: o.teaser, curse: o.curse,
    curseCol: o.curseCol, ward: o.ward, fill: o.fill, fillSym: o.fillSym, respin: o.respin, tease: o.tease,
    hold: o.hold, meter: o.meterFed, since, night,
  };
}

/** Build the `eval` event: pays, clusters, the gross and the settle tags. */
function evalEvent(o: Outcome, stake: number): EvalEv {
  return {
    k: 'eval', stake, gross: o.gross, jackpot: o.jackpot, curse: o.curse, fill: o.fill, tease: o.tease,
    pays: o.pays.map((p) => ({ pat: p.pat, sym: p.sym, cells: p.cells, amount: p.amount })),
    clusters: o.clusters.map((c) => ({ pat: 'CLUSTER', sym: c.sym, cells: c.cells, amount: c.amount })),
    tags: o.tags, meter: o.meter,
  };
}

