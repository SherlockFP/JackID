/**
 * Stacker (`stacker`) — MACHINES_machines §16, Tier 3, solo. Pattern: `plinko/index.ts`, `hilo/index.ts` (ladder).
 *
 * What it demonstrates
 *  - logic / present split: the occupant is the authority. Every stop is resolved on the authority from the deterministic
 *    `Motion` at the local press time (`stopCell`), packed into a `stop` event and `emit`ted. `present()` plays it on every
 *    peer. The bar is driven from the same `Motion` on every peer, so the on-screen bar and the outcome always agree;
 *  - ladder round: `beginRound` charges the stake; between rows the round stays open with `busy = false` (release = forfeit,
 *    E on a rung = TAKE). Every ending goes through `finish()`: settle-before-present, then the show;
 *  - a rung (rows 4, 7, 10) opens the cash-out decision: it runs on the sim clock (5 s, default TAKE) in `tick`;
 *  - juice: anticipation (bar sweep, rising chime per row), chunk on stop, falling whistle + smash on overhang, rung bell
 *    (MINOR ding-dong + amber glow on row 10), MAJOR gold fill top-down + capsule + pit-wide bell, LOSE commiseration;
 *  - instanced grid painted through instance colours; `playHeadless` (shared rules) for staff auto-play and the bench Sim.
 *
 * Controls: Space / LMB STOP (first press starts the round) · Q on a rung = TAKE · R on a rung = CLIMB · wheel / Z / X stake ·
 * E leave (on a rung = TAKE, otherwise forfeit). Round life-cycle: `beginRound(stake)` → `emit(bar)` → `stop` … →
 * `emit(end, credit)` → present → release.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { Kit } from '@/kit/types';
import { fmtCoins, t } from '@/core/i18n';
import { clamp } from '@/core/math';
import { buildModel, cellPos, setCell, GOLD, AMBER, LIT, type StackerParts } from './model';
import { STRINGS } from './stacker.strings';
import {
  COLS, ROWS, MINOR_ROW, MAJOR_ROW, MIN_STAKE, MAX_STAKE, MAJOR_MULT, DECIDE_S, ROW_GAP_S,
  HOOK_EXTRA, HOOK_SAVE, HOOK_MINOR, RTP, Motion, rowWidth, speedOf, resolveStop, stopCell, roundPrize, playHeadless,
  rungMult, takeMult, type Seg, type Outcome,
} from './rules';

export { playHeadless };

type StopEv = {
  row: number; w: number; v: number; seed: number; tp: number; cs: number;
  kept: number[]; fell: number[]; saved: boolean; ok: boolean;
};
type EndEv = { row: number; outcome: Outcome; gross: number; bet: number; capsule: boolean; tags: string[] };
type Ev =
  | { k: 'bar'; row: number; w: number; v: number; seed: number; stake: number }
  | ({ k: 'stop' } & StopEv)
  | { k: 'decide'; climb: boolean }
  | ({ k: 'end' } & EndEv);
type State = { hist: number[] };

const HIST = 12;
const WHITE = 0xfff0e0;
const DIM_PREVIEW = 0x3a1010;
const DIM_PANEL = '#ff3020';
/** Length of the riser that lands on the take-or-climb deadline (tensionRise at param 1). */
const RISER_S = 1.6;

/** Colour of a placed row: amber on MINOR (row 10), gold on MAJOR, red otherwise (rungs 4 and 7 included). */
export function rowColour(row: number): number {
  return row === MAJOR_ROW ? GOLD : row === MINOR_ROW ? AMBER : LIT;
}

/** Authority-only state of one play (never in a snapshot: only the occupant owns it). */
interface Play {
  seed: number; stake: number; luck: number; extra: number; save: boolean; minorMult: number;
  row: number; top: Seg | null; motion: Motion | null; w: number; v: number; t0: number;
  phase: 'gap' | 'moving' | 'rung' | 'done'; gapAt: number; decideAt: number;
}

export const def: MachineDef = {
  id: 'stacker',
  category: 'skill',
  slotSize: 'M',
  zone: 'midway',
  seats: 1,
  shared: false,
  minBet: MIN_STAKE, maxBet: MAX_STAKE, betSteps: [1, 2, 5, 10, 25],   // per play
  maxPayoutMult: MAJOR_MULT * 2,
  rtp: RTP,
  tier: 3,
  actionCost: 2,                                                       // per play, no autoplay
  idleYield: 0.12,
  headless: playHeadless,
  tags: ['solo', 'skill', 'stack', 'timing'],
  modHooks: {
    luck: 'Metronome: each luck point makes the bar 2 % slower per row (cap 20 %).',
    'x.stacker.extraBlock': 'Extra width for the bar on rows 1–5. Base 0 (Brass Knuckles +1).',
    'm.stacker.saveCell': 'Above 0: the first falling overhang cell is caught, once per play. Base 0.',
    'm.stacker.minorMult': 'Multiplier on the top ladder take (row 10, ×1.6 base). Base 1.',
    'm.stacker.majorCharm': 'Rarity bonus of the MAJOR charm capsule. Base 0.',
  },
  strings: STRINGS,
};

export default class Stacker extends MachineBase<StackerParts, Ev, State> {
  private state: State = { hist: [] };
  /** Authority-side play in progress (null when idle or on a remote peer). */
  private play: Play | null = null;
  /** Sim clock (s), advanced in `tick` on every peer. */
  private simT = 0;
  /** The bar being driven: this peer's own (authority) or a remote row (presentation). */
  private bar: { m: Motion; t0: number; row: number; w: number } | null = null;
  /** Painted bar cells: row (game row) at column `barCs` of width `barW`. */
  private barCs = -1;
  private barRow = -1;
  private barW = 0;
  /** Take-or-climb window cues (authority only, presentation): next tick time, riser fired, and whether the row screen shows the countdown. */
  private rungTickAt = 0;
  private rungRiser = false;
  private rungShown = false;
  private rungRow = 0;

  protected createModel(kit: Kit): MachineModel<StackerParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh();
    this.idleChase();
    this.attractor.every('sweep', 6, () => this.sweep(), { first: 3 });
  }

  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    this.idleChase();
    if (local) { this.sfx('chime'); this.showHud(); }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local && this.roundOpen) {
      // E on a rung = TAKE; any other point of the round is a forfeit.
      const p = this.play;
      const gross = p && p.phase === 'rung' ? roundPrize(p.stake * takeMult(p.row, p.minorMult), this.rng.next()) : 0;
      this.settle({ gross, tags: gross > 0 ? ['stacker:take'] : [] });
    }
    this.play = null;
    this.bar = null;
    this.refresh();
    this.idleChase();
  }

  onLang(): void {
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (e.repeat && (a === 'primary' || a === 'collect' || a === 'double')) return;
    switch (a) {
      case 'primary': this.press(); break;
      case 'collect': this.take(); break;
      case 'double': this.climb(); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen || this.busy) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  /** Space / LMB: start the round when idle, stop the bar while it moves, TAKE on a rung. */
  private press(): void {
    if (!this.roundOpen) { this.commit(); return; }
    const p = this.play;
    if (!p) return;
    if (p.phase === 'moving') this.stop();
    else if (p.phase === 'rung') this.take();
  }

  // ── authority-side logic: runs only on the local occupant ──────────────────────────────────────
  private commit(): void {
    if (this.busy || this.roundOpen) return;
    const stake = this.bet;
    if (!this.beginRound(stake)) return;                    // charges the wallet, busy = true, re-seeds this.rng
    this.play = {
      seed: this.rng.int(1, 0x7fffffff), stake, luck: this.luck(), extra: this.mod(HOOK_EXTRA, 0),
      save: this.mod(HOOK_SAVE, 0) > 0, minorMult: this.mod(HOOK_MINOR, 1),
      row: 0, top: null, motion: null, w: 0, v: 0, t0: 0, phase: 'gap', gapAt: this.simT, decideAt: 0,
    };
    this.busy = false;                                      // ladder: the round stays open, release = forfeit
    this.startRow();
    this.showHud();
  }

  private startRow(): void {
    const p = this.play;
    if (!p) return;
    p.row += 1;
    const w = rowWidth(p.row, p.top ? p.top.b - p.top.a : null, p.extra);
    const v = speedOf(p.row, p.luck);
    p.w = w; p.v = v;
    p.motion = new Motion(p.seed, p.row, w, v);
    p.t0 = this.simT;
    p.phase = 'moving';
    this.bar = { m: p.motion, t0: p.t0, row: p.row, w };
    void this.emit({ k: 'bar', row: p.row, w, v, seed: p.seed, stake: p.stake });
    this.showHud();
  }

  private stop(): void {
    const p = this.play;
    if (!p || p.phase !== 'moving' || !p.motion) return;
    const tp = this.simT - p.t0;
    const cs = stopCell(p.motion, tp);
    const r = resolveStop(p.seed, p.row, p.top, cs, p.w, p.save);
    if (r.saved) p.save = false;
    this.bar = null;
    void this.emit({ k: 'stop', row: p.row, w: p.w, v: p.v, seed: p.seed, tp, cs, kept: r.kept, fell: r.fell, saved: r.saved, ok: r.ok });
    if (!r.ok || !r.seg) { void this.finish('lose'); return; }
    p.top = r.seg;
    if (p.row === MAJOR_ROW) { void this.finish('major'); return; }
    if (rungMult(p.row) > 0) {
      p.phase = 'rung';
      p.decideAt = this.simT + DECIDE_S;
      this.rungTickAt = this.simT;
      this.rungRiser = false;
    } else {
      p.phase = 'gap';
      p.gapAt = this.simT + ROW_GAP_S;
    }
    this.showHud();
  }

  private take(): void {
    const p = this.play;
    if (!p || p.phase !== 'rung') return;
    void this.finish('take');
  }

  private climb(): void {
    const p = this.play;
    if (!p || p.phase !== 'rung') return;
    p.phase = 'gap';
    p.gapAt = this.simT + ROW_GAP_S;
    void this.emit({ k: 'decide', climb: true });
    this.showHud();
  }

  /** Every ending: a rung take, MAJOR, or a lost stack. Settle first (credit), then the show. */
  private async finish(outcome: Outcome): Promise<void> {
    const p = this.play;
    if (!p || p.phase === 'done') return;
    p.phase = 'done';
    this.bar = null;
    const exact = outcome === 'take' ? p.stake * takeMult(p.row, p.minorMult)
      : outcome === 'major' ? p.stake * MAJOR_MULT : 0;
    const gross = roundPrize(exact, this.rng.next());
    const tags = outcome === 'take' ? ['stacker:take'] : outcome === 'major' ? ['stacker:major'] : [];
    const ev: Ev = { k: 'end', row: p.row, outcome, gross, bet: p.stake, capsule: outcome === 'major', tags };
    const credit = (): void => { this.settle({ gross, tags }); this.busy = true; };   // credit FIRST, present after
    try {
      const shown = this.emit(ev, credit);
      if (this.roundOpen) credit();                         // emit refused: still pay out, never strand the stake
      await shown;
    } finally {
      this.play = null;
      this.busy = false;
      this.refresh();
      this.showHud();
    }
  }

  /** Tick (fixed 60 Hz, every peer): row gaps and the rung decision window (default TAKE). */
  tick(dt: number): void {
    this.simT += dt;
    const p = this.play;
    if (!p) return;
    if (p.phase === 'gap' && this.simT >= p.gapAt) this.startRow();
    else if (p.phase === 'rung') {
      this.rungCue(p);
      if (this.simT >= p.decideAt) this.take();
    }
  }

  /**
   * The take-or-climb window, as the authority hears it: the ticks speed up as the window closes, and a riser lands on
   * the deadline. Presentation only; the window still ends on the sim clock (default TAKE).
   */
  private rungCue(p: Play): void {
    const left = Math.max(0, p.decideAt - this.simT);
    if (!this.rungRiser && left <= RISER_S) { this.rungRiser = true; this.sfx('tensionRise', { vol: 0.6, param: 1 }); }
    if (this.simT >= this.rungTickAt) {
      this.sfx('clockTick', { vol: 0.4, pitch: Math.round(6 * (1 - left / DECIDE_S)) });   // climbs a tritone as it closes
      this.rungTickAt = this.simT + clamp(left * 0.2, 0.12, 0.6);                      // ticks speed up as it closes
    }
  }

  // ── present: every peer, including the emitter ──────────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'bar':
        if (!pc.local) this.bar = { m: new Motion(ev.seed, ev.row, ev.w, ev.v), t0: this.simT, row: ev.row, w: ev.w };
        return this.presentBar(ev);
      case 'stop':
        if (!pc.local) this.bar = null;
        return this.presentStop(ev);
      case 'decide':
        this.sfx('chime', { vol: 0.5, pitch: 5 });
        this.parts.marquee.chase('chase', 9);
        return;
      case 'end':
        return this.presentEnd(ev, pc);
    }
  }

  private presentBar(ev: Extract<Ev, { k: 'bar' }>): void {
    this.drawRow(ev.row);
    this.parts.marquee.chase('chase', 6);
    this.sfx('chime', { vol: 0.35, pitch: Math.min(12, ev.row) });   // drone: a semitone up per row
  }

  private async presentStop(ev: Extract<Ev, { k: 'stop' }>): Promise<void> {
    const { grid } = this.parts;
    this.paintBar(null);
    const r = ev.row - 1;
    const colour = rowColour(ev.row);
    for (const c of ev.kept) setCell(grid, c, r, colour);
    this.sfx('thud', { vol: 0.6 });                          // chunk on stop
    if (ev.fell.length) {
      for (const c of ev.fell) setCell(grid, c, r, WHITE);
      this.sfx('whoosh', { vol: 0.5 });                      // falling whistle
      await this.wait(0.3);
      if (this.disposed) return;
      for (const c of ev.fell) setCell(grid, c, r, null);
      this.sfx('glassBreak', { vol: 0.35 });                 // smash
    }
    if (ev.saved) this.ctx.fx.popText(this.model.anchors.label, this.t('saved'), GOLD, { dur: 0.8, rise: 0.2, scale: 1.0 });
    if (ev.ok) this.drawRow(ev.row);
    if (ev.ok && rungMult(ev.row) > 0) {
      if (ev.row === MINOR_ROW) this.ctx.fx.glow(this.parts.bands.minor, AMBER, 0.6, 1.2);
      this.sfx('bell', { vol: 0.6 });                        // rung ding-dong (row 10: amber band glows too)
      await this.wait(0.22);
      if (!this.disposed) this.sfx('chime', { vol: 0.6, pitch: -5 });
    } else if (ev.ok && ev.row === MAJOR_ROW) {
      this.ctx.fx.glow(this.parts.bands.major, GOLD, 0.6, 1.2);
    }
  }

  private async presentEnd(ev: Extract<Ev, { k: 'end' }>, pc: PresentCtx): Promise<void> {
    const { marquee } = this.parts;
    this.state.hist = [ev.row, ...this.state.hist].slice(0, HIST);
    this.paintBar(null);
    if (ev.outcome === 'lose' || ev.gross <= 0) {
      this.drawPanel(0);
      this.commiserate({ amount: ev.bet, at: this.model.anchors.label });
      marquee.chase('blink', 1.5);
      await this.wait(1.5);
    } else {
      const tier = juiceTier(ev.gross, ev.bet, ev.tags);
      if (ev.outcome === 'major') await this.majorShow(ev);
      if (tierAtLeast(tier, 'medium')) {
        await this.celebrate(tier, { amount: ev.gross, bet: ev.bet, marquee, restore: () => this.idleChase(), fast: pc.fast });
      } else {
        await this.pourCoins(ev.gross, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawPanel(v) });
      }
    }
    if (!this.disposed) { this.refresh(); this.idleChase(); }
  }

  /** MAJOR: the grid fills top-down in gold, the capsule shows on the turntable, a pit-wide bell. */
  private async majorShow(ev: Extract<Ev, { k: 'end' }>): Promise<void> {
    const { grid, capsule, marquee } = this.parts;
    this.sfx('bell', { vol: 0.9 });
    marquee.chase('win', 8);
    await this.anim(1.2, (k) => {
      const lit = Math.round(k * ROWS);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) setCell(grid, c, r, ROWS - 1 - r < lit ? GOLD : null);
    });
    if (this.disposed) return;
    if (ev.capsule) {
      capsule.visible = true;
      this.ctx.fx.popText(this.parts.prizeAnchor, this.t('capsule'), GOLD, { dur: 1.2, rise: 0.3, scale: 1.1 });
      void this.wait(2.5).then(() => { if (!this.disposed) capsule.visible = false; });
    }
    this.ctx.fx.glow(this.model.anchors.label, GOLD, 0.6, 1.5);
  }

  // ── visuals ─────────────────────────────────────────────────────────────────────────────────────
  /** Bar drive (render rate): the bar cells follow the shared motion; the light follows the active row. */
  frame(dt: number, _time: number): void {
    this.parts.prizeTurntable.rotation.y += dt * 0.5;
    const p = this.play;
    if (p && p.phase === 'rung') this.drawWindow(p.row, Math.max(0, (p.decideAt - this.simT) / DECIDE_S));
    else if (this.rungShown) { this.rungShown = false; this.drawRow(this.rungRow); }
    const b = this.bar;
    if (!b) { if (this.barCs >= 0) this.paintBar(null); return; }
    const cs = clamp(Math.round(b.m.posAt(this.simT - b.t0)), 0, b.m.max);
    if (cs !== this.barCs || b.row !== this.barRow) {
      if (cs !== this.barCs && this.barCs >= 0) this.sfx('click', { vol: 0.2 });   // tick per cell step
      this.paintBar(cs, b.row, b.w);
    }
    this.model.anchors.light.position.y = cellPos(0, b.row - 1).y;
  }

  /** Paint the moving bar at `cs` on game row `row` (width `w`), or clear it when `cs` is null. */
  private paintBar(cs: number | null, row = this.barRow, w = this.barW): void {
    const { grid } = this.parts;
    if (this.barCs >= 0) for (let c = this.barCs; c < this.barCs + this.barW; c++) setCell(grid, c, this.barRow - 1, null);
    if (cs === null) { this.barCs = -1; this.barRow = -1; this.barW = 0; return; }
    for (let c = cs; c < cs + w; c++) setCell(grid, c, row - 1, WHITE);
    this.barCs = cs; this.barRow = row; this.barW = w;
  }

  /** Attract: a dim band sweeps up the grid while the machine is idle. */
  private sweep(): void {
    if (this.busy || this.occupant !== null) return;
    void this.anim(1.4, (k) => {
      const at = Math.min(ROWS - 1, Math.floor(k * ROWS));
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) setCell(this.parts.grid, c, r, r === at ? DIM_PREVIEW : null);
    }).then(() => { if (!this.disposed && this.occupant === null) this.refresh(); });
  }

  private idleChase(): void {
    this.parts.marquee.chase('chase', this.occupant !== null ? 5 : 3);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    this.paintBar(null);
    const { grid, capsule } = this.parts;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) setCell(grid, c, r, null);
    capsule.visible = false;
    this.model.anchors.light.position.set(0, 1.4, 0.5);
    this.drawRow(0);
    this.drawPanel();
  }

  /** 2-digit readout: the active row (0 = idle). */
  private drawRow(row: number): void {
    const n = String(row).padStart(2, '0');
    this.parts.leds.row.draw((g, sc) => {
      g.fillStyle = '#080808'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(n, 4, 4, { font: 'px5', color: DIM_PANEL });
    });
  }

  /** The row screen doubles as the decision clock: the row number, and a bar that shrinks over the take-or-climb window. */
  private drawWindow(row: number, frac: number): void {
    const n = String(row).padStart(2, '0');
    this.rungRow = row;
    this.rungShown = true;
    this.parts.leds.row.draw((g, sc) => {
      g.fillStyle = '#080808'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(n, 4, 4, { font: 'px5', color: DIM_PANEL });
      g.fillStyle = frac < 0.3 ? '#ff4040' : '#ffb020';
      g.fillRect(0, sc.h - 3, Math.round(sc.w * frac), 3);
    });
  }

  /** Credit / bet / win panel. `winShown` replaces the READY line while the payout counts up. */
  private drawPanel(winShown?: number): void {
    const bet = this.roundOpen ? this.roundBet : this.bet;
    this.parts.leds.panel.draw((g, sc) => {
      g.fillStyle = '#080808'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(`${this.t('credit')} ${fmtCoins(this.ctx.run.wallet())}`, 4, 3, { font: 'px5', color: DIM_PANEL });
      sc.text(this.t('bet', { n: fmtCoins(bet) }), 4, 14, { font: 'px5', color: DIM_PANEL });
      sc.text(winShown !== undefined && winShown > 0 ? this.t('win', { n: fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(winShown, this.src, { bet }) : winShown) }) : this.t('ready'), 4, 25, { font: 'px5', color: '#ffd040' });
    });
  }

  private showHud(): void {
    const p = this.play;
    const bet = this.roundOpen && p ? p.stake : this.bet;
    const hints: HudHint[] = [];
    if (!this.busy) {
      if (p && p.phase === 'rung') {
        const prize = Math.floor(p.stake * takeMult(p.row, p.minorMult));
        hints.push({ action: 'collect', label: `${this.t('hintTake')} ${fmtCoins(prize)}` });
        hints.push({ action: 'double', label: this.t('hintClimb') });
      } else {
        hints.push({ action: 'primary', label: this.roundOpen ? this.t('hintStop') : this.t('start') });
      }
      hints.push({ action: 'betUp', label: `${this.t('hintStake')} ${fmtCoins(this.bet)}` });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: this.roundOpen ? bet : null,
      hints,
      stats: [
        { label: this.t('potLabel'), value: fmtCoins(bet) },
        { label: this.t('rowShort'), value: String(p ? p.row : 0) },
      ],
    });
  }

  // ── late join / save ────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { hist: [...this.state.hist] };
  }
  applySnapshot(s: State): void {
    this.state = { hist: s.hist.slice(0, HIST) };
    this.refresh();
  }
}
