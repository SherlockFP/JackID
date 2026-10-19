/**
 * Gilded Cascade (`cascade`) — tumble / multiplier video slot, solo occupant (MACHINES: new, tier 3, gallery).
 *
 * The logic / present split of the reference machines (`pachislot`, `fruitmachine`):
 *  - authority (the local occupant): SPIN charges the stake and runs `rules.playSpin` on the round's seeded stream. Every
 *    spin is ONE `spin` event that carries the whole tumble trace (first grid, each step's hits and refill, the orbs, the
 *    multiplier and the pay). A base spin that finds four or more wheels opens the free round: its spins run here one by
 *    one, each emitted as a `spin` event. The wallet is credited inside the `credit` step of the LAST event of the round
 *    (settle BEFORE presentation, DECISIONS G), so a reload mid-show can never lose a payout.
 *  - `present()` is the only place the cabinet screen, lamps and LEDs change, on every peer. It replays the trace with
 *    `rules.applyStep`, so the show and the maths cannot drift apart.
 *  - a free round that is open at a reload (`state.feature`) goes on from the saved counters; its remaining spins are drawn
 *    from the new round stream.
 *
 * Juice: the grid drops in column by column, winners flash, burst into pixel particles and the rest falls; each tumble
 * chimes a step higher; orbs pulse and fly into the meter one by one; the multiplier lands with a banner and a count-up;
 * the wheels freeze the grid before the free round; big wins run the shared ladder (`celebrate`) with a count-up overlay
 * on the screen. Calm / reduced flashing is respected by the shared juice (no strobe is drawn here: the flashes are
 * stepped at 7 Hz and only the cell plates blink).
 *
 * Controls: Space / Enter / LMB = spin · Z / X bet step · B max bet · F fast spins · H rules · E stand.
 * Charm hooks (`def.modHooks`): freeSpins and the core `luck`.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast, type JuiceTier } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { KitX } from '@/kit';
import type { Ease } from '@/core/tween';
import { fmtCoins } from '@/core/i18n';
import { TAU } from '@/core/math';
import type { Rng } from '@/core/rng';
import { SeatHud, type HudControl, type HudNumber, type HudPay, type Txt } from '@/machines/_base/seatHud';
import { flashPrefs, scorePop } from '@/machines/_base/juice';
import { buildModel, type CascadeParts } from './model';
import { CELL, CascadeView, orbColour } from './view';
import {
  BET_STEPS, CAP_H, CAP_X, CELLS, COLS, HOOK, ROWS, SCATTER, SYM_N, TRIGGER_AT, advanceFeature, applyStep, at, coinsOf,
  extraSpins, findHits, isOrb, luckOrb, orbValue, PAY_H, pickSym, playHeadless, playSpin, startFeature,
  type Feature, type SpinResult,
} from './rules';
import { STRINGS } from './cascade.strings';

export { playHeadless };

/** One spin of a round (base or free). `f` = the free round after this spin (null = none). */
type SpinEv = {
  k: 'spin'; v: number; free: boolean; r: SpinResult; n: number; of: number; more: number; trig: boolean; last: boolean;
  pay: number; round: number; capped: boolean; f: Feature | null; hadFree: boolean;
};
type Ev = SpinEv;

type State = {
  /** The resting grid (no orbs, no wheels). */
  grid: number[];
  feature: Feature | null;
  /** Stake of the open round and what it has won so far, in H units and in coins. */
  v: number;
  roundH: number;
  roundCoins: number;
  /** Pay of the last finished round, coins. */
  last: number;
};

const SYM_COL = ['#d02838', '#2a62d8', '#e0b040', '#f4efe4', '#48e0ff', '#e8b830', '#a848ff', '#c09040', '#ffcc20'];
const GOLD = '#ffd040';
const T_FLASH = 0.32, T_BURST = 0.22, T_FALL = 0.34, T_DROP = 0.42;

export const def: MachineDef = {
  id: 'cascade',
  category: 'slot',
  slotSize: 'M',
  zone: 'gallery',
  seats: 1,
  shared: false,
  minBet: BET_STEPS[0], maxBet: BET_STEPS[BET_STEPS.length - 1], betSteps: [...BET_STEPS],
  maxPayoutMult: CAP_X,
  rtp: 0.96,
  tier: 3,
  actionCost: 1,
  headless: playHeadless,
  tags: ['solo', 'slot', 'bonus', 'tumble'],
  modHooks: {
    'm.cascade.freeSpins': 'Free round +N spins (cap +5).',
    luck: 'Luck: orb chance x(1 + 0.02 L), capped at x1.5.',
  },
  // seat coach (_base/coach.ts): taught by doing on the first sits
  coach: [
    { key: 'primary', say: 'spin', done: 'round' },
    { key: 'betUp', say: 'bet', done: 'bet' },
  ],
  strings: STRINGS,
};

const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5'].map((k) => ({ k: 'm.cascade.' + k }));

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/** A fall that lands with a small give (outBack). */
const fallEase = (p: number): number => { const q = p - 1; return 1 + 2.0 * q * q * q + 1.0 * q * q; };

/** A calm resting grid with no paying cluster, from the world stream (identical on every peer). */
function restGrid(rng: Rng): number[] {
  for (let tries = 0; tries < 30; tries++) {
    const g = Array.from({ length: CELLS }, () => pickSym(rng));
    if (!findHits(g).length) return g;
  }
  return Array.from({ length: CELLS }, (_, i) => (i * 5 + 2) % SYM_N);
}
/** A finished grid at rest: orbs and wheels (which are gone after the spin) become plain symbols. */
const restify = (g: readonly number[]): number[] => g.map((c, i) => (c >= SYM_N ? (i * 5 + 2) % SYM_N : c));

export default class Cascade extends MachineBase<CascadeParts, Ev, State> {
  private state: State = { grid: [], feature: null, v: 0, roundH: 0, roundCoins: 0, last: 0 };
  private view!: CascadeView;
  private seatHud?: SeatHud;
  /** The free round is being run by the authority loop. */
  private running = false;
  private turbo = false;
  private beaconOn = false;
  /** Time factor of the spin being shown (fast queue 0.12, turbo 0.5, normal 1). */
  private fac = 1;
  /** A round with a free round in it (for the tags). */
  private hadFree = false;
  private crownOn = false;

  protected createModel(kit: KitX): MachineModel<CascadeParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                          // the seat HUD replaces the generic bottom bar
    this.view = new CascadeView(this.parts.screens.main);
    if (!this.state.grid.length) this.state.grid = restGrid(this.worldRng);
    this.attractor.every('shine', 7, () => this.shine(), { jitter: 2, first: 2 });
    this.refresh();
  }

  // ── attract: the lamps breathe and one symbol shines now and then ─────────────────────────────────
  attract(dt: number, time: number): void {
    if (this.occupant) return;
    const { lamps, side } = this.parts;
    const on = Math.floor(time * 1.2) % 2 === 0;
    if (on !== this.crownOn) { this.crownOn = on; lamps.crown.setOn(on); }
    if (Math.floor(time) % 4 === 0) side.forEach((c) => c.pattern('alt', 0.6));
    this.attractor.update(dt);
  }

  /** Attract: every cell of one symbol flashes for a moment. */
  private shine(): void {
    if (this.occupant || this.busy || !this.view) return;
    const sym = this.cosmetic.int(0, SYM_N - 1);
    const hit = this.view.cells.filter((c) => c.code === sym);
    if (hit.length === 0) return;
    hit.forEach((c) => { c.hl = 1; });
    this.view.dirty = true;
    void this.ctx.timers.wait(0.9).then(() => {
      if (this.disposed || !this.view) return;
      this.view.cells.forEach((c) => { c.hl = 0; });
      this.view.dirty = true;
    });
  }

  frame(dt: number): void {
    if (!this.view) return;
    if (this.beaconOn) this.parts.beacon.rotation.y += dt * TAU * 1.2;
    if (this.view.update(dt)) this.view.draw();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.pay(this.payStrip());
      if (this.state.feature) void this.runFeature();        // a free round left unfinished (reload / snapshot) goes on
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) {
      this.seatHud?.hide();
      if (this.roundOpen) {                                  // safety net: never strand a stake or a win
        const gross = this.state.feature ? coinsOf(this.state.roundH, this.state.v) : 0;
        this.state.feature = null;
        this.settle({ gross });
      }
      this.running = false;
    }
    this.attractor.reset();
    this.refresh();
  }

  /** The pay strip on the seat HUD: each symbol and what eight or more of it pay, × the bet. */
  private payStrip(): HudPay[] {
    return PAY_H.map((p, i) => ({ px: CELL, pays: `×${p[0] / 2}`, paint: (g: CanvasRenderingContext2D) => g.drawImage(this.view.sprites[i], 0, 0) }));
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'primary': case 'confirm': void this.spin(); break;
      case 'fast': this.turbo = !this.turbo; this.toast(this.t(this.turbo ? 'fastOn' : 'fastOff')); this.sfx('click'); this.showHud(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  private changeBet(fn: () => void): void {
    if (this.busy || this.running || this.state.feature) return;
    fn();
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  // ── authority: a spin ─────────────────────────────────────────────────────────────────────────────
  private async spin(): Promise<void> {
    if (!this.isLocalOccupant || this.busy || this.running || this.state.feature) return;
    if (!this.beginRound(this.bet)) return;                   // charges the stake, busy = true, seeds this.rng for the round
    const v = this.bet;
    const r = playSpin(this.rng, 0, 0, luckOrb(this.luck()), CAP_H);
    const trig = r.scatters >= TRIGGER_AT && !r.capped;
    const s = this.state;
    s.v = v; s.roundH = r.win; s.roundCoins = coinsOf(r.win, v);
    this.hadFree = trig;
    s.feature = trig ? startFeature(this.mod(HOOK.freeSpins, 0)) : null;
    const f = s.feature;
    const round = s.roundCoins;
    const credit = trig ? undefined : (): void => { this.settle({ gross: round, tags: r.capped ? ['maxwin'] : [] }); };
    const shown = this.emit({
      k: 'spin', v, free: false, r, n: 0, of: f ? f.spins : 0, more: 0, trig, last: !trig, pay: round, round,
      capped: r.capped, f: f ? { ...f } : null, hadFree: trig,
    }, credit);
    this.showHud();
    await shown;
    if (trig) await this.runFeature();
  }

  /** The free round: its spins run here on the authority, one `spin` event each; the last one settles the round. */
  private async runFeature(): Promise<void> {
    if (this.running || !this.isLocalOccupant || !this.state.feature) return;
    this.running = true;
    this.busy = true;
    this.hadFree = true;
    this.showHud();
    try {
      const lo = luckOrb(this.luck());
      const s = this.state;
      while (s.feature && s.feature.left > 0 && !this.disposed && this.isLocalOccupant) {
        const f = s.feature;
        const v = s.v;
        const r = playSpin(this.rng, 1, f.total, lo, CAP_H - s.roundH);
        const more = advanceFeature(f, r);
        s.roundH += r.win;
        if (r.capped) f.left = 0;
        const last = f.left <= 0;
        const round = coinsOf(s.roundH, v);
        const pay = round - s.roundCoins;
        s.roundCoins = round;
        const tags = ['bonus', 'freespins', ...(r.capped ? ['maxwin'] : [])];
        const credit = last ? (): void => { s.feature = null; this.settle({ gross: round, tags }); } : undefined;
        await this.emit({
          k: 'spin', v, free: true, r, n: f.played, of: f.spins, more, trig: false, last, pay, round, capped: r.capped,
          f: last ? null : { ...f }, hadFree: true,
        }, credit);
      }
    } finally {
      this.running = false;
      if (this.busy && !this.roundOpen) this.busy = false;     // settle() normally clears busy; guard a refused emit
      this.showHud();
    }
  }

  // ── presentation: every peer, including the emitter ───────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    return this.presentSpin(ev, pc);
  }

  /** `anim` / `wait` scaled by the spin's speed factor. */
  private a(dur: number, fn: (k: number) => void, ease?: Ease): Promise<void> { return this.anim(dur * this.fac, fn, ease); }
  private w(sec: number): Promise<void> { return this.wait(sec * this.fac); }

  /** Count the footer up from `from` to `to` coins. */
  private countTo(from: number, to: number, dur: number): Promise<void> {
    const view = this.view;
    if (to === from) return Promise.resolve();
    let lastV = from;
    view.foot.pulse = 1;
    return this.a(dur, (k) => {
      const val = Math.round(lerp(from, to, k));
      view.foot.r = fmtCoins(val);
      view.dirty = true;
      if (val !== lastV && this.fac > 0.3) { lastV = val; if (Math.floor(k * 12) !== Math.floor((k - 0.04) * 12)) this.sfx('numberTick', { vol: 0.35, pitch: Math.floor(k * 8) }); }
    });
  }

  private async presentSpin(ev: SpinEv, pc: PresentCtx): Promise<void> {
    const view = this.view;
    const r = ev.r;
    const v = ev.v;
    const s = this.state;
    this.fac = pc.fast ? 0.12 : this.turbo ? 0.5 : ev.free ? 0.8 : 1;
    if (!pc.local) {                                         // a peer that did not author the spin follows the event
      s.v = v;
      s.feature = ev.f ? { ...ev.f } : null;
    }
    this.hadFree = ev.hadFree;
    this.beaconOn = ev.free || ev.trig;
    const before = ev.round - ev.pay;                         // coins the round had when this spin started
    view.head.l = ev.free ? this.t('hdrFree', { n: ev.n, of: ev.of }) : this.t('hdrBet', { n: fmtCoins(v) });
    view.head.r = '';
    view.meter.on = ev.free;
    view.meter.label = this.t('meterTotal');
    view.meter.value = Math.max(1, ev.free ? r.total - r.orbs : 0);
    view.foot.l = this.t(ev.free ? 'footRound' : 'footWin');
    view.foot.r = fmtCoins(before);
    view.banner = null;
    this.setLamps(true);
    if (!pc.fast) this.spinLights();
    if (pc.local) this.showHud();

    // ── the lever, the old symbols drop away, the new grid drops in ──
    if (!ev.free) { void this.parts.lever.pull(pc.fast ? 0.03 : 0.1); void this.parts.buttons.spin.press(0.06); }
    this.sfx('reelStart', { vol: 0.8 });
    this.sfx('lever', { vol: 0.7 });
    await this.clearOut();
    await this.dropIn(r.g0);

    // ── the tumbles ──
    let grid = r.g0.slice();
    let cumH = Math.round(before * 2 / v);                   // H units before this spin (exact for an even bet)
    let shown = before;
    for (let i = 0; i < r.steps.length; i++) {
      const st = r.steps[i];
      view.head.r = this.t('tumble', { n: i + 1 });
      const gone = new Set(st.hits.map((h) => h[0]));
      const idx: number[] = [];
      for (let c = 0; c < CELLS; c++) if (gone.has(grid[c])) idx.push(c);
      const stepH = st.hits.reduce((n, h) => n + h[2], 0);
      const target = coinsOf(cumH + stepH, v);
      // flash the winners and say what each symbol pays
      idx.forEach((c) => { view.cells[c].hl = 1; });
      for (const h of st.hits) {
        const first = idx.find((c) => grid[c] === h[0]) ?? 0;
        view.pop(Math.floor(first / ROWS), first % ROWS, `+${fmtCoins(coinsOf(h[2], v))}`, GOLD);
      }
      view.dirty = true;
      scorePop(this, i, r.steps.length);                     // each tumble pops a step higher, the last lands on the cha-ching
      if (stepH >= 20) this.sfx('coinShower', { vol: 0.5 });
      await this.w(T_FLASH);
      // burst
      for (const c of idx) view.burst(Math.floor(c / ROWS), c % ROWS, SYM_COL[grid[c]] ?? GOLD, this.fac < 0.3 ? 2 : 5);
      this.sfx('popUp', { vol: 0.7, pitch: Math.min(i, 8) });
      if (pc.local && !pc.fast) this.ctx.fx.shake(0.0012 + Math.min(i, 5) * 0.0004, 0.07);
      const count = this.countTo(shown, target, T_BURST * 1.4);
      await this.a(T_BURST, (k) => {
        for (const c of idx) { const cell = view.cells[c]; cell.sc = k < 0.35 ? 1 + 0.5 * (k / 0.35) : 1.5 * (1 - (k - 0.35) / 0.65); cell.al = 1 - Math.max(0, (k - 0.4) / 0.6); cell.hl = 0; }
        view.dirty = true;
      });
      await count;
      shown = target; cumH += stepH;
      // the rest falls, new symbols drop in
      const next = applyStep(grid, st.hits, st.fill);
      await this.fallTo(grid, st.hits, st.fill);
      grid = next;
      this.sfx('tileClack', { vol: 0.45, pitch: Math.min(i, 6) });
      await this.w(0.08);
    }
    view.head.r = '';

    // ── the wheels, the orbs, the multiplier ──
    const wheels: number[] = [];
    const orbs: number[] = [];
    for (let c = 0; c < CELLS; c++) { if (grid[c] === SCATTER) wheels.push(c); else if (isOrb(grid[c])) orbs.push(c); }
    if (!ev.free && !ev.trig && r.scatters === 3) {          // a near miss: one wheel short of the free round
      view.banner = { text: this.t('bTease'), sub: '', k: 0, col: '#ff6a6a' };
      void this.a(0.9, (k) => { if (view.banner) view.banner.k = k; view.dirty = true; });
      await this.nearMiss({ dur: 0.8, at: this.parts.screens.main.mesh, fast: pc.fast });
      view.banner = null;
    }
    if (orbs.length) shown = await this.collectOrbs(ev, orbs, grid, shown, cumH);
    if (r.scatterH > 0 || ev.trig || ev.more > 0) await this.wheelsShow(ev, wheels, shown);
    await this.countTo(shown, ev.round, 0.3);
    shown = ev.round;
    view.foot.r = fmtCoins(ev.round);
    s.roundCoins = ev.round;

    // ── the end of the round ──
    if (!ev.last) { await this.w(ev.free ? 0.25 : 0.1); return; }
    await this.finishRound(ev, pc, wheels);
  }

  /** The old grid falls out the bottom (nothing on the first spin after a reload). */
  private async clearOut(): Promise<void> {
    const cells = this.view.cells;
    const start = cells.map((c) => c.row);
    cells.forEach((c) => { c.hl = 0; });
    await this.a(0.2, (k) => {
      const e = k * k;
      cells.forEach((c, i) => { c.row = start[i] + 6.5 * e; });
      this.view.dirty = true;
    });
  }

  /** The first grid drops in column by column. */
  private async dropIn(codes: readonly number[]): Promise<void> {
    const cells = this.view.cells;
    const gap = 0.05;
    const total = T_DROP + gap * (COLS - 1);
    cells.forEach((c, i) => { c.code = codes[i]; c.sc = 1; c.al = 1; c.hl = 0; c.row = (i % ROWS) - ROWS - 1; });
    for (let c = 0; c < COLS; c++) {
      void this.w(gap * c + T_DROP * 0.85).then(() => { if (!this.disposed) this.sfx('reelStop', { vol: 0.4, param: c / (COLS - 1) }); });
    }
    await this.a(total, (k) => {
      const t = k * total;
      for (let i = 0; i < CELLS; i++) {
        const col = Math.floor(i / ROWS);
        const p = clamp01((t - gap * col) / T_DROP);
        const end = i % ROWS;
        cells[i].row = end - (ROWS + 1) * (1 - fallEase(p));
      }
      this.view.dirty = true;
    });
    cells.forEach((c, i) => { c.row = i % ROWS; });
  }

  /** Survivors fall to the bottom of their column, the refill drops in from above the grid. Updates the view cells. */
  private async fallTo(prev: readonly number[], hits: readonly (readonly [number, number, number])[], fill: readonly number[]): Promise<void> {
    const cells = this.view.cells;
    const gone = new Set(hits.map((h) => h[0]));
    const from = new Array<number>(CELLS);
    const to = new Array<number>(CELLS);
    let f = 0;
    for (let c = 0; c < COLS; c++) {
      const keep: number[] = [];
      for (let r = 0; r < ROWS; r++) if (!gone.has(prev[at(c, r)])) keep.push(r);
      const fresh = ROWS - keep.length;
      for (let j = 0; j < fresh; j++) {
        const i = at(c, j);
        const cell = cells[i];
        cell.code = fill[f++]; cell.sc = 1; cell.al = 1; cell.hl = 0;
        from[i] = j - fresh - 0.6; to[i] = j;
      }
      for (let m = 0; m < keep.length; m++) {
        const i = at(c, fresh + m);
        const cell = cells[i];
        cell.code = prev[at(c, keep[m])]; cell.sc = 1; cell.al = 1; cell.hl = 0;
        from[i] = keep[m]; to[i] = fresh + m;
      }
    }
    cells.forEach((c, i) => { c.row = from[i]; });
    await this.a(T_FALL, (k) => {
      const e = fallEase(k);
      cells.forEach((c, i) => { c.row = from[i] + (to[i] - from[i]) * e; });
      this.view.dirty = true;
    });
    cells.forEach((c, i) => { c.row = to[i]; });
  }

  /** The orbs pulse and fly into the meter one by one; returns the coins shown after the multiplier. */
  private async collectOrbs(ev: SpinEv, orbs: number[], grid: readonly number[], shown: number, cumH: number): Promise<number> {
    const view = this.view;
    const r = ev.r;
    const v = ev.v;
    const collecting = ev.free || r.base > 0;
    if (!collecting) {                                       // orbs on a spin that paid nothing are just lost
      await this.a(0.3, (k) => { orbs.forEach((c) => { view.cells[c].al = 1 - k; }); view.dirty = true; });
      return shown;
    }
    view.meter.on = true;
    view.meter.label = this.t(ev.free ? 'meterTotal' : 'meterOrbs');
    let acc = ev.free ? Math.max(0, r.total - r.orbs) : 0;
    view.meter.value = Math.max(ev.free ? 1 : 0, acc);
    const flight = 0.3;
    for (let n = 0; n < orbs.length; n++) {
      const c = orbs[n];
      const val = orbValue(grid[c]);
      const cell = view.cells[c];
      cell.hl = 2;
      view.dirty = true;
      scorePop(this, n, orbs.length, { mult: true });        // the multiplier's ding stack
      view.fly(Math.floor(c / ROWS), c % ROWS, `x${val}`, orbColour(val), flight * this.fac);
      void this.w(flight).then(() => {
        if (this.disposed) return;
        acc += val;
        view.meter.value = acc;
        view.meter.flash = 1;
        cell.al = 0; cell.hl = 0;
        view.dirty = true;
        this.sfx('numberTick', { vol: 0.6, pitch: Math.min(n * 2, 14) });
      });
      await this.w(orbs.length > 8 ? 0.09 : 0.16);
    }
    await this.w(flight);
    view.meter.value = Math.max(ev.free ? 1 : 0, ev.free ? r.total : r.orbs);
    view.meter.flash = 1;
    this.sfx('upgrade', { vol: 0.7 });
    if (this.parts.lamps.orbL) { this.parts.lamps.orbL.blink(8, 0.6); this.parts.lamps.orbR.blink(8, 0.6); }
    if (this.isLocalOccupant && r.orbs >= 20) this.ctx.fx.shake(0.003, 0.12);
    // the multiplier lands on the spin's tumbles
    if (r.base > 0 && r.mult > 1) {
      const to = coinsOf(cumH + r.base * (r.mult - 1), v);
      view.banner = { text: this.t('bMult', { n: r.mult }), sub: this.t('bMultSub'), k: 0, col: orbColour(r.mult) };
      this.sfx('jackpot', { vol: 0.55 });
      if (this.isLocalOccupant) this.ctx.fx.shake(0.004, 0.15);
      await Promise.all([
        this.a(0.9, (k) => { if (view.banner) view.banner.k = k; view.dirty = true; }),
        this.countTo(shown, to, 0.7),
      ]);
      view.banner = null;
      view.dirty = true;
      return to;
    }
    return shown;
  }

  /** The wheels: pay flash, the free round banner, the retrigger. */
  private async wheelsShow(ev: SpinEv, wheels: number[], shown: number): Promise<void> {
    const view = this.view;
    wheels.forEach((c) => { view.cells[c].hl = 1; });
    view.dirty = true;
    this.sfx('bell', { vol: 0.9 });
    if (ev.trig) {
      this.sfx('jackpotBells', { vol: 0.8 });
      this.parts.marquee.chase('win', 10);
      this.parts.side.forEach((c) => c.pattern('chase', 10));
      view.dim = 0.35;
      view.banner = { text: this.t('bFree'), sub: this.t('bFreeSub', { n: ev.of }), k: 0, col: GOLD };
      if (this.isLocalOccupant) this.ctx.fx.shake(0.004, 0.2);
      await this.a(1.8, (k) => { if (view.banner) view.banner.k = k; view.dirty = true; });
    } else if (ev.more > 0) {
      this.sfx('chime', { vol: 0.9, pitch: 5 });
      view.banner = { text: this.t('bMore', { n: ev.more }), sub: this.t('bMoreSub'), k: 0, col: GOLD };
      await this.a(1.2, (k) => { if (view.banner) view.banner.k = k; view.dirty = true; });
    } else {
      await this.w(0.5);
    }
    view.banner = null;
    view.dim = 0;
    wheels.forEach((c) => { view.cells[c].hl = 0; });
    view.dirty = true;
    void shown;
  }

  /** The last spin of a round: the win ladder, the callout, back to rest. */
  private async finishRound(ev: SpinEv, pc: PresentCtx, wheels: number[]): Promise<void> {
    const view = this.view;
    const v = ev.v;
    const round = ev.round;
    const tags = [...(ev.capped ? ['maxwin'] : [])];
    const tier = juiceTier(round, v, tags);
    const main = this.parts.screens.main.mesh;
    const lamps = [this.parts.lamps.orbL, this.parts.lamps.orbR, this.parts.lamps.crown];
    this.beaconOn = false;
    this.parts.beacon.rotation.set(0, 0, 0);
    this.state.last = round;
    if (!pc.local) this.state.feature = null;
    if (pc.local) this.callout(round - v, tier);
    if (round <= 0) {
      this.commiserate({ at: main });
    } else if (tierAtLeast(tier, 'big')) {
      void this.celebrate(tier, { amount: round, bet: v, marquee: this.parts.marquee, bulbs: this.parts.side[0], lamps, restore: () => this.restoreLamps(), fast: pc.fast });
      if (!pc.fast) await this.bigShow(round, tier, ev.capped);
    } else if (ev.hadFree && !pc.fast) {
      view.banner = { text: this.t('bEnd'), sub: this.t('bEndSub', { n: fmtCoins(round) }), k: 0, col: GOLD };
      void this.celebrate(tier, { amount: round, bet: v, marquee: this.parts.marquee, bulbs: this.parts.side[0], lamps, restore: () => this.restoreLamps(), fast: pc.fast });
      await this.a(1.6, (k) => { if (view.banner) view.banner.k = k; view.dirty = true; });
      view.banner = null;
    } else if (tierAtLeast(tier, 'medium')) {
      void this.celebrate(tier, { amount: round, bet: v, marquee: this.parts.marquee, bulbs: this.parts.side[0], lamps, restore: () => this.restoreLamps(), fast: pc.fast });
      await this.w(0.6);
    } else {
      await this.pourCoins(round, { bet: v, fast: pc.fast });
    }
    // the wheels and any orb left behind vanish, the grid rests
    if (wheels.length) await this.a(0.25, (k) => { wheels.forEach((c) => { view.cells[c].al = 1 - k; }); view.dirty = true; });
    this.state.grid = restify(ev.r.grid);
    this.state.roundCoins = 0;
    this.refresh();
    if (pc.local) this.showHud();
  }

  /** The big-win ladder on the screen: title, rays, a count-up with ticks and confetti. */
  private async bigShow(round: number, tier: JuiceTier, capped: boolean): Promise<void> {
    const view = this.view;
    const title = capped ? 'bMax' : tier === 'big' ? 'bBig' : tier === 'huge' ? 'bHuge' : 'bMega';
    const rank = capped ? 4 : tier === 'big' ? 1 : tier === 'huge' ? 2 : 3;
    const dur = [0, 2.2, 3.2, 4.2, 5.2][rank];
    view.big = { title: this.t(title), amount: '0', k: 0, tier: rank };
    let step = -1;
    await this.a(dur, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      if (!view.big) return;
      view.big.k = k;
      view.big.amount = fmtCoins(Math.round(round * e));
      const st = Math.floor(k * 14);
      if (st !== step) {
        step = st;
        this.sfx('numberTick', { vol: 0.5, pitch: Math.floor(k * 12) });
        if (st % 3 === 0) view.confetti(14 + rank * 6);
      }
      view.dirty = true;
    });
    if (view.big) view.big.amount = fmtCoins(round);
    await this.w(0.7);
    view.big = null;
    view.dirty = true;
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state, grid: [...this.state.grid], feature: this.state.feature ? { ...this.state.feature } : null };
  }
  applySnapshot(s: State): void {
    this.state = { ...s, grid: s.grid.length ? [...s.grid] : restGrid(this.worldRng), feature: s.feature ? { ...s.feature } : null };
    if (this.view) this.refresh();
    if (this.state.feature && this.isLocalOccupant) void this.runFeature();
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────────
  private restoreLamps(): void {
    if (this.disposed) return;
    const { marquee, side, lamps } = this.parts;
    const feat = this.state.feature !== null;
    marquee.chase(feat ? 'chase' : 'off', 3);
    side.forEach((c) => c.pattern(feat ? 'chase' : 'alt', feat ? 6 : 0.6));
    lamps.orbL.setOn(feat); lamps.orbR.setOn(feat); lamps.crown.setOn(feat);
  }
  /** The symbols drop: the marquee and side bulbs chase fast until the round ends (`refresh` → `restoreLamps`); slower under reduce-flashing / Calm. */
  private spinLights(): void {
    const p = flashPrefs();
    const hz = p.reduced || p.calm ? 4 : 9;
    this.parts.marquee.chase('chase', hz);
    this.parts.side.forEach((c) => c.pattern('chase', hz));
  }
  private setLamps(on: boolean): void {
    const { lamps } = this.parts;
    lamps.orbL.setOn(on); lamps.orbR.setOn(on); lamps.crown.setOn(on);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent; never called in the middle of a show. */
  private refresh(): void {
    const view = this.view;
    if (!view) return;
    const s = this.state;
    view.setGrid(s.grid);
    view.banner = null; view.big = null; view.dim = 0;
    const f = s.feature;
    view.head.l = this.occupant === null ? this.t('name') : f ? this.t('hdrFree', { n: f.played, of: f.spins }) : this.t('hdrBet', { n: fmtCoins(this.bet) });
    view.head.r = '';
    view.meter.on = f !== null;
    view.meter.label = this.t('meterTotal');
    view.meter.value = Math.max(1, f ? f.total : 0);
    view.foot.l = this.t(f ? 'footRound' : 'footWin');
    view.foot.r = fmtCoins(f ? s.roundCoins : s.last);
    this.beaconOn = f !== null;
    if (!this.beaconOn) this.parts.beacon.rotation.set(0, 0, 0);
    this.parts.buttons.spin.setLit(this.isLocalOccupant && !this.busy);
    this.restoreLamps();
    this.leds();
  }

  private leds(): void {
    const { credit, win } = this.parts.leds;
    credit.set(String(Math.max(0, Math.min(999999, Math.floor(this.ctx.run.wallet())))));
    win.set(String(Math.max(0, Math.min(999999, Math.floor(this.state.feature ? this.state.roundCoins : this.state.last)))));
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Result callout for the local player: `net` = coins back minus the stake. */
  private callout(net: number, tier: JuiceTier): void {
    this.seatHud?.result(net > 0 ? 'win' : net === 0 ? 'push' : 'lose', net, 1.5, undefined, tier);
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const f = this.state.feature;
    this.leds();
    sh.goal({ k: 'm.cascade.goal' });

    if (f) sh.state({ k: 'm.cascade.stFree', v: { n: f.played, of: f.spins } }, 'warn', { k: 'm.cascade.stFreeSub' });
    else if (this.busy) sh.state({ k: 'm.cascade.stBusy' }, 'neutral', { k: 'm.cascade.stBusySub' });
    else sh.state({ k: 'm.cascade.stSpin' }, 'gold', { k: 'm.cascade.stSpinSub', v: { n: fmtCoins(this.bet) } });

    const nums: HudNumber[] = [
      { label: { k: 'm.cascade.nBet' }, value: fmtCoins(f ? this.state.v : this.bet), tone: 'gold' },
    ];
    if (f) {
      nums.push({ label: { k: 'm.cascade.nSpins' }, value: String(f.left), tone: 'cyan' });
      nums.push({ label: { k: 'm.cascade.nMult' }, value: `x${Math.max(1, f.total)}`, tone: f.total > 1 ? 'good' : 'neutral' });
      nums.push({ label: { k: 'm.cascade.nWin' }, value: fmtCoins(this.state.roundCoins), tone: 'good' });
    } else if (this.state.last > 0) {
      nums.push({ label: { k: 'm.cascade.nLast' }, value: fmtCoins(this.state.last), tone: 'good' });
    }
    nums.push({ label: { k: 'm.cascade.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    const ctrl: HudControl[] = [];
    if (!this.busy && !f) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.cascade.cSpin' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.cascade.cBet' }, action: 'betUp' });
      ctrl.push({ key: this.k('betMax'), label: { k: 'm.cascade.cMax' }, action: 'betMax' });
    }
    ctrl.push({ key: this.k('fast'), label: { k: 'm.cascade.cFast' }, action: 'fast' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.cascade.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.cascade.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  override dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }
}
