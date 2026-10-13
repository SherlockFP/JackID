/**
 * Hi-Lo Ladder (`hilo`) — solo, tier 2, MACHINES_tables §11. Pattern: `coinflip/index.ts`.
 *
 *  - logic / present split: every outcome (card, guess result, multiplier, payout, refund) is rolled on the authority
 *    (the local occupant), packed into an event and `emit`ted; `present()` is the only place state changes or
 *    animation happens, on every peer. Settle-before-present (DECISIONS G): the wallet step runs as `emit`'s `credit`.
 *  - a multi-step round: the stake is charged on DEAL; the round stays OPEN between decisions (busy = false while the
 *    player chooses); a bust closes it at 0 (or the safety-net refund); COLLECT pays stake × running multiplier;
 *    auto-collect at ×1,000; standing up collects with ≥ 1 step, refunds with 0 steps.
 *  - juice: anticipation (button press, marquee race), split-flap clatter, a rung tone per climb (+2 semitones), the
 *    thermometer rising, near-miss tease, bust drain (power-down, rungs fall one by one), tiered collect celebration.
 *  - charms: hooks `m.hilo.skipAdd`, `stepRtpAdd`, `safetyNet`, `sameBonus`, `startMult`; `luck` fate draws.
 *  - `playHeadless` (rules.ts) for staff auto-play and the bench "Sim" button, so simulated RTP IS the live RTP.
 *
 * Controls: 1 / W / wheel up Higher · 2 / S / wheel down Lower · 3 Skip · Q Collect · Space Deal · LMB on the brass
 * buttons (idle: any button deals). X / Z and B change the stake when no round is live.
 */
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp } from '@/machines/_base/juice';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { KitX } from '@/kit';
import { fmtCoins, t } from '@/core/i18n';
import { clamp, lerp } from '@/core/math';
import { buildModel, FLAP_REST, type FlapCard, type HiloParts } from './model';
import {
  AUTO_COLLECT, BET_STEPS, BASE_RTP, HOOK_RTP, HOOK_SAFETY, HOOK_SAME, HOOK_SKIP, HOOK_START, MAX_BET, MAX_RUN, MIN_BET,
  RUNGS, RUNG_AT, SKIPS_MAX, advance, clampRtp, drawCard, guessable, payoutOf, playHeadless, resolveGuess, rankText, stepMult,
  type Card, type Dir, type GuessOpts,
} from './rules';
import STRINGS from './hilo.strings';

export { playHeadless };

type Ev =
  | { k: 'deal'; c: Card; bet: number; run: number }
  | {
    k: 'guess'; dir: Dir; from: Card; next: Card; ok: boolean; mult: number; run: number; steps: number;
    same: boolean; lucky: boolean; near: boolean; refund: number; bet: number; skips: number;
  }
  | { k: 'skip'; from: Card; next: Card; used: number; left: number }
  | { k: 'collect'; amount: number; bet: number; run: number; steps: number };

type State = { cur: Card | null; run: number; steps: number; skips: number; bet: number };

const GOLD = 0xffd040;
const LAMP = 0xffc83d;
const BLANK = '#0e1a14';
const CREAM = '#e8e0c8';
const LED_CAP = 99999;

/** Rung lamps lit at a running multiplier (RUNG_AT is ascending). */
const rungLevel = (run: number): number => RUNG_AT.filter((m) => run >= m).length;
/** Thermometer fill, log scale from ×1 to the auto-collect line. */
const fill = (run: number): number => clamp(Math.log(Math.max(1, run)) / Math.log(AUTO_COLLECT), 0, 1);

export const def: MachineDef = {
  id: 'hilo',
  category: 'card',
  slotSize: 'M',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: MIN_BET, maxBet: MAX_BET, betSteps: BET_STEPS,
  maxPayoutMult: MAX_RUN,
  rtp: BASE_RTP,                  // per step (table §11.3): 98.46–99.00 %
  tier: 2,
  actionCost: 1,
  idleYield: 0.3,
  headless: playHeadless,
  tags: ['solo', 'cards', 'ladder'],
  modHooks: {
    'm.hilo.skipAdd': `Extra free skips per round (base ${SKIPS_MAX}).`,
    'm.hilo.stepRtpAdd': 'Float added to the 0.99 step target (cap 1.02).',
    'm.hilo.safetyNet': 'At ≥ 1: the first bust after a step refunds 50 % of the current collect value.',
    'm.hilo.sameBonus': 'Float: exact-rank hits multiply that step by 1 + x.',
    'm.hilo.startMult': 'Float: the ladder starts at ×(1 + x).',
  },
  strings: { en: STRINGS.en, tr: STRINGS.tr },
};

export default class HiLo extends MachineBase<HiloParts, Ev, State> {
  private state: State = { cur: null, run: 1, steps: 0, skips: 0, bet: 0 };

  protected createModel(kit: KitX): MachineModel<HiloParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.refresh();
    this.idleChase();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    this.idleChase();
    if (local) {
      if (this.state.cur && !this.roundOpen) this.resumeRound(this.state.bet);   // restored round: the sitter owns it
      this.sfx('chime');
      this.showHud();
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    // Normal path: standUp() closed the round first. Safety net for forced / external releases.
    if (local && this.roundOpen) {
      const s = this.state;
      this.settle({ gross: s.steps > 0 ? payoutOf(this.rng, this.roundBet, s.run) : this.roundBet, tags: s.steps > 0 ? ['ladder'] : [] });
    }
    this.state = { cur: null, run: 1, steps: 0, skips: 0, bet: 0 };          // every peer drops the ladder of whoever left
    this.refresh();
    this.idleChase();
  }

  onLang(): void {
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving with a ladder on the table collects it first (≥ 1 step) or refunds the stake (0 steps). */
  protected override standUp(): void {
    if (this.roundOpen && !this.busy) {
      if (this.state.steps > 0) void this.collect();
      else this.settle({ gross: this.roundBet });
    }
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'up': case 'n1': void this.guess('hi'); break;
      case 'down': case 'n2': void this.guess('lo'); break;
      case 'n3': void this.skip(); break;
      case 'collect': void this.collect(); break;
      case 'primary': case 'confirm': void this.deal(); break;
      case 'betUp': if (this.roundOpen) void this.guess('hi'); else this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': if (this.roundOpen) void this.guess('lo'); else this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    const b = this.parts.buttons;
    const hit: 'higher' | 'lower' | 'skip' | 'collect' | null =
      this.pick([b.higher.root]) ? 'higher'
        : this.pick([b.lower.root]) ? 'lower'
          : this.pick([b.skip.root]) ? 'skip'
            : this.pick([b.collect.root]) ? 'collect' : null;
    if (!hit) return;
    if (!this.roundOpen) { void this.deal(); return; }
    if (hit === 'higher') void this.guess('hi');
    else if (hit === 'lower') void this.guess('lo');
    else if (hit === 'skip') void this.skip();
    else void this.collect();
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  // ── charm-aware parameters (authority side) ───────────────────────────────────────────────────────
  private guessOpts(): GuessOpts {
    return {
      rtp: clampRtp(BASE_RTP + this.mod(HOOK_RTP, 0)),
      luck: this.luck(),
      same: Math.max(0, this.mod(HOOK_SAME, 0)),
    };
  }
  private skipCap(): number { return SKIPS_MAX + Math.max(0, Math.floor(this.mod(HOOK_SKIP, 0))); }
  private startRun(): number { return Math.min(MAX_RUN, 1 + Math.max(0, this.mod(HOOK_START, 0))); }
  private safetyOn(): boolean { return this.mod(HOOK_SAFETY, 0) >= 1; }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private async deal(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    if (!this.beginRound(this.bet)) return;                  // charges the stake, busy = true, re-seeds this.rng
    const c = drawCard(this.rng);
    const run = this.startRun();
    this.showHud();
    try {
      await this.emit({ k: 'deal', c, bet: this.roundBet, run });
    } finally {
      if (this.roundOpen && this.state.cur === null) this.settle({ gross: this.roundBet });   // never strand a stake
      this.busy = false;
      this.showHud();
    }
  }

  private async guess(dir: Dir): Promise<void> {
    const s = this.state;
    if (this.busy || !this.roundOpen || !s.cur) return;
    if (!guessable(s.cur.rank, dir)) { this.toast(this.t('noGuess'), 'bad'); this.sfx('buzzer'); return; }
    this.busy = true;
    this.showHud();
    const from = s.cur, bet = this.roundBet;
    const o = resolveGuess(this.rng, from, dir, this.guessOpts());
    let autoCollect = false;
    try {
      if (o.ok) {
        const run = advance(s.run, o.mult);
        await this.emit({
          k: 'guess', dir, from, next: o.next, ok: true, mult: o.mult, run, steps: s.steps + 1,
          same: o.same, lucky: o.lucky, near: false, refund: 0, bet, skips: s.skips,
        });
        autoCollect = run >= AUTO_COLLECT;
      } else {
        // Bust: settle-before-present. The safety-net refund is 50 % of the collect value (steps > 0 only).
        const refund = this.safetyOn() && s.steps > 0 ? payoutOf(this.rng, bet, s.run / 2) : 0;
        const tags = [...(s.steps > 0 ? ['ladder'] : []), ...(o.nearmiss ? ['nearmiss'] : []), ...(o.lucky ? ['lucky'] : [])];
        const credit = (): void => { this.settle({ gross: refund, tags }); this.busy = true; };
        const shown = this.emit({
          k: 'guess', dir, from, next: o.next, ok: false, mult: 0, run: s.run, steps: s.steps,
          same: false, lucky: o.lucky, near: o.nearmiss, refund, bet, skips: s.skips,
        }, credit);
        if (this.roundOpen) credit();                       // the emit was refused: still close the round
        await shown;
      }
    } finally {
      this.busy = false;
      this.showHud();
    }
    if (autoCollect) await this.collect();
  }

  private async skip(): Promise<void> {
    const s = this.state;
    if (this.busy || !this.roundOpen || !s.cur) return;
    const cap = this.skipCap();
    if (s.skips >= cap) { this.toast(this.t('noSkips'), 'bad'); this.sfx('buzzer'); return; }
    this.busy = true;
    this.showHud();
    const used = s.skips + 1;
    try {
      await this.emit({ k: 'skip', from: s.cur, next: drawCard(this.rng), used, left: cap - used });
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  private async collect(): Promise<void> {
    const s = this.state;
    if (this.busy || !this.roundOpen || !s.cur) return;
    if (s.steps < 1) { this.toast(this.t('needStep'), 'bad'); this.sfx('buzzer'); return; }
    this.busy = true;
    this.showHud();
    const bet = this.roundBet;
    const amount = payoutOf(this.rng, bet, s.run);
    const tags = ['ladder', ...(s.steps >= 3 ? [`steps:${s.steps}`] : [])];
    const credit = (): void => { this.settle({ gross: amount, tags }); this.busy = true; };   // credit FIRST, present after
    const shown = this.emit({ k: 'collect', amount, bet, run: s.run, steps: s.steps }, credit);
    if (this.roundOpen) credit();                            // the emit was refused: still pay out, never strand the ladder
    try { await shown; } finally { this.busy = false; this.showHud(); }
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'deal': return this.presentDeal(ev, pc);
      case 'guess': return this.presentGuess(ev, pc);
      case 'skip': return this.presentSkip(ev, pc);
      case 'collect': return this.presentCollect(ev, pc);
    }
  }

  private async presentDeal(ev: Extract<Ev, { k: 'deal' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.cur = ev.c; s.run = ev.run; s.steps = 0; s.skips = 0; s.bet = ev.bet;
    const { marquee, rungs, flapCur } = this.parts;
    if (pc.fast) { this.refresh(); return; }
    rungs.pattern('off');
    marquee.chase('chase', 10);
    this.sfx('shuffle', { vol: 0.6 });
    await this.flapTo(flapCur, ev.c, 0.6, pc);
    if (this.disposed) return;
    this.refresh();
    marquee.chase('chase', 4);
  }

  private async presentGuess(ev: Extract<Ev, { k: 'guess' }>, pc: PresentCtx): Promise<void> {
    const { buttons, marquee, flapCur, flapNext, thermo } = this.parts;
    const fx = this.ctx.fx;
    const s = this.state;
    const prevRun = s.run;
    const btn = ev.dir === 'hi' ? buttons.higher : buttons.lower;

    // 1. data first (snapshots stay consistent), pixels later
    if (ev.ok) { s.cur = ev.next; s.run = ev.run; s.steps = ev.steps; }
    else { s.cur = null; s.run = 1; s.steps = 0; s.skips = 0; s.bet = 0; }

    if (pc.fast) {
      this.refresh();
      return;
    }

    // 2. anticipation: the button goes down, the marquee races
    void btn.press();
    marquee.chase('chase', 10);
    this.sfx('button');
    await this.wait(0.12);
    if (this.disposed) return;

    // 3. near miss: a held breath before the card that was one rank away
    if (!ev.ok && ev.near) await this.nearMiss({ dur: 0.7, at: flapNext.root });

    // 4. reveal the NEXT card
    await this.flapTo(flapNext, ev.next, 0.5, pc);
    if (this.disposed) return;

    if (ev.ok) {
      // STEP: the NEXT card slides into CURRENT, the ladder climbs, the thermometer rises
      await this.flapTo(flapCur, ev.next, 0.4, pc);
      this.paintFace(flapNext, null);
      this.lightRungs(prevRun, ev.run, pc);
      const from = thermo.scale.y, to = Math.max(0.0001, fill(ev.run));
      void this.anim(0.4, (k) => { thermo.scale.y = Math.max(0.0001, lerp(from, to, k)); });
      fx.sparks(flapCur.root, 8 + 2 * ev.steps, GOLD);
      fx.glow(flapCur.root, GOLD, 0.25 + 0.03 * ev.steps, 0.4);
      fx.popText(flapCur.root, `×${ev.run.toFixed(2)}`, GOLD, { dur: 1.1, rise: 0.35, scale: 1.1 + 0.1 * Math.min(ev.steps, 5), shake: ev.run >= 10 });
      if (ev.same) fx.popText(flapNext.root, this.t('same'), GOLD, { dur: 0.9, rise: 0.25, scale: 1.1 });
      if (ev.lucky && pc.local) this.sfx('sparkle', { vol: 0.5, pitch: 7 });
      this.sfx(ev.steps >= 3 ? 'win3' : ev.steps === 2 ? 'win2' : 'win1');
      marquee.chase('win', 6 + ev.steps);
      if (ev.run >= 50) this.sfx('heartbeat', { vol: 0.7 });
      this.refreshButtons();
      this.refreshLeds();
      await this.wait(0.3);
    } else {
      // BUST: power-down, the ladder drains, the flaps go blank
      if (pc.local) fx.shake(0.008, 0.25);
      this.sfx('powerDown');
      this.commiserate({ amount: ev.bet, at: flapNext.root });
      marquee.chase('blink', 1.5);
      await this.drainLadder(prevRun, pc);
      if (ev.refund > 0) {
        fx.popText(flapCur.root, `${this.t('refund')} ${fmtCoins(ev.refund)}`, 0x7dff7a, { dur: 1.1, rise: 0.3, scale: 1.0 });
        await this.pourCoins(ev.refund, { bet: ev.bet, fast: pc.fast });
      }
      if (this.disposed) return;
      this.paintFace(flapCur, null);
      this.paintFace(flapNext, null);
      await this.wait(0.2);
    }
    if (!this.disposed) this.refresh();
  }

  private async presentSkip(ev: Extract<Ev, { k: 'skip' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.cur = ev.next;
    s.skips = ev.used;
    if (!pc.fast) {
      this.sfx('whoosh', { vol: 0.5 });
      await this.flapTo(this.parts.flapCur, ev.next, 0.6, pc);
    }
    if (!this.disposed) this.refresh();
  }

  private async presentCollect(ev: Extract<Ev, { k: 'collect' }>, pc: PresentCtx): Promise<void> {
    const { marquee, rungs } = this.parts;
    const s = this.state;
    s.cur = null; s.run = 1; s.steps = 0; s.skips = 0; s.bet = ev.bet;
    const tier = juiceTier(ev.amount, ev.bet);
    if (pc.fast) { this.refresh(); return; }
    rungs.pattern('off');
    this.sfx('coinPour', { vol: 0.6 });
    for (let i = 0; i < RUNGS; i++) { rungs.setBulb(i, LAMP); await this.wait(0.03); }   // the ladder lights up to the top
    this.drawWin(0);
    if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
      void this.celebrate(tier, { amount: ev.amount, marquee, lamps: [], restore: () => this.idleChase(), fast: pc.fast });
      await countUp(this.ctx, 0, ev.amount, 1.2 * this.speed, (v) => this.drawWin(v));
    } else {
      await this.pourCoins(ev.amount, { bet: ev.bet, fast: pc.fast, onCount: (v) => this.drawWin(v) });
    }
    if (!this.disposed) this.refresh();
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    return { ...this.state };
  }
  applySnapshot(s: State): void {
    this.state = { ...s };
    if (s.cur) this.resumeRound(s.bet);             // a ladder still at risk stays playable
    this.refresh();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────────
  private idleChase(): void {
    const { rungs, marquee } = this.parts;
    if (this.state.cur) return;                     // a live round owns the lamps (refresh paints them)
    rungs.pattern(this.occupant !== null ? 'alt' : 'chase', 2);
    marquee.chase('chase', this.occupant !== null ? 4 : 2);
  }

  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const s = this.state;
    const p = this.parts;
    p.rungs.pattern('off');
    this.paintFace(p.flapCur, s.cur);
    this.paintFace(p.flapNext, null);
    for (const f of [p.flapCur, p.flapNext]) this.setLeaves(f, FLAP_REST);
    this.paintRungs(s.cur ? s.run : 0);
    p.thermo.scale.y = Math.max(0.0001, s.cur ? fill(s.run) : 0.0001);
    this.refreshButtons();
    this.refreshLeds();
    this.drawWin(0);
    this.showHud();
  }

  private refreshButtons(): void {
    const s = this.state, b = this.parts.buttons;
    const c = s.cur;
    b.higher.setEnabled(!c || guessable(c.rank, 'hi'));
    b.lower.setEnabled(!c || guessable(c.rank, 'lo'));
    b.skip.setEnabled(!!c && s.skips < this.skipCap());
    b.collect.setEnabled(!!c && s.steps > 0);
    b.higher.setLit(!!c && guessable(c.rank, 'hi'));
    b.lower.setLit(!!c && guessable(c.rank, 'lo'));
  }

  /** 5-digit windows: the live multiplier of each guess, the skips left, and the running payout. */
  private refreshLeds(): void {
    const s = this.state, l = this.parts.leds;
    const live = (dir: Dir): string => {
      const c = s.cur;
      if (!c || !guessable(c.rank, dir)) return '--';
      return stepMult(c.rank, dir, clampRtp(BASE_RTP + this.mod(HOOK_RTP, 0))).toFixed(2);
    };
    l.higher.set(live('hi'));
    l.lower.set(live('lo'));
    l.skips.set(String(s.cur ? Math.max(0, this.skipCap() - s.skips) : 0));
    l.win.set(s.cur && s.steps > 0 ? String(Math.min(LED_CAP, Math.floor(s.bet * s.run))) : '0');
  }

  private drawWin(v: number): void {
    this.parts.leds.win.set(String(Math.min(LED_CAP, Math.floor(v))));
  }

  /** Paint the ladder for a running multiplier (no sound). */
  private paintRungs(run: number): void {
    const lit = rungLevel(run);
    for (let i = 0; i < RUNGS; i++) this.parts.rungs.setBulb(i, i < lit ? LAMP : null);
  }

  /** Climb: light the rungs reached between `from` and `to`, a rising tone for the new top rung (+2 semitones each). */
  private lightRungs(from: number, to: number, pc: Pick<PresentCtx, 'fast' | 'local'>): void {
    const a = rungLevel(from), b = rungLevel(to);
    this.paintRungs(to);
    if (b > a && !pc.fast) this.sfx('chime', { pitch: 2 * (b - 1), vol: 0.7 });
  }

  /** Bust: the rungs fall one by one from the top while the thermometer drains. */
  private async drainLadder(run: number, pc: PresentCtx): Promise<void> {
    const { rungs, thermo } = this.parts;
    const lit = rungLevel(run);
    const from = thermo.scale.y;
    if (pc.fast) { for (let i = 0; i < RUNGS; i++) rungs.setBulb(i, null); thermo.scale.y = 0.0001; return; }
    void this.anim(0.6, (k) => { thermo.scale.y = Math.max(0.0001, lerp(from, 0, k)); });
    for (let i = lit - 1; i >= 0; i--) { rungs.setBulb(i, null); this.sfx('click', { vol: 0.4, pitch: -i }); await this.wait(0.05); }
    for (let i = 0; i < RUNGS; i++) rungs.setBulb(i, null);
  }

  /** Flip a card: leaves swing flat over the face and back; the new face is painted while they cover it. */
  private async flapTo(f: FlapCard, c: Card | null, dur: number, pc: PresentCtx): Promise<void> {
    if (pc.fast) { this.paintFace(f, c); this.setLeaves(f, FLAP_REST); return; }
    this.sfx('reelTick', { vol: 0.5 });
    let painted = false;
    await this.anim(dur, (k) => {
      f.leaves.forEach((leaf, i) => {
        const local = clamp((k - i * 0.12) / 0.6, 0, 1);
        leaf.rotation.x = FLAP_REST * (1 - Math.sin(local * Math.PI));
      });
      if (!painted && k >= 0.5) { painted = true; this.paintFace(f, c); }
    });
    this.setLeaves(f, FLAP_REST);
    this.sfx('reelStop', { vol: 0.5 });
  }

  private setLeaves(f: FlapCard, rot: number): void {
    for (const leaf of f.leaves) leaf.rotation.x = rot;
  }

  /** The card face: cream stock, rank big, suit letter below (red hearts / diamonds). Null = blank back. */
  private paintFace(f: FlapCard, c: Card | null): void {
    f.face.draw((g, sc) => {
      if (!c) { g.fillStyle = BLANK; g.fillRect(0, 0, sc.w, sc.h); return; }
      g.fillStyle = CREAM; g.fillRect(0, 0, sc.w, sc.h);
      g.strokeStyle = '#6a5a3a'; g.lineWidth = 2; g.strokeRect(2, 2, sc.w - 4, sc.h - 4);
      const red = c.suit === 'H' || c.suit === 'D';
      sc.text(rankText(c.rank), 32, 24, { font: 'px5', scale: 4, color: red ? '#b0202a' : '#1a1a1a', align: 'center' });
      sc.text(c.suit, 32, 66, { font: 'px5', scale: 3, color: red ? '#b0202a' : '#1a1a1a', align: 'center' });
    });
  }

  private showHud(): void {
    const s = this.state;
    const open = this.roundOpen;
    const hints: HudHint[] = [];
    if (!this.busy) {
      if (open && s.cur) {
        const c = s.cur, r = this.rtpNow();
        if (guessable(c.rank, 'hi')) hints.push({ action: 'up', label: `${this.t('higher')} ×${stepMult(c.rank, 'hi', r).toFixed(2)}` });
        if (guessable(c.rank, 'lo')) hints.push({ action: 'down', label: `${this.t('lower')} ×${stepMult(c.rank, 'lo', r).toFixed(2)}` });
        hints.push({ action: 'n3', label: `${this.t('skip')} ${Math.max(0, this.skipCap() - s.skips)}` });
        if (s.steps > 0) hints.push({ action: 'collect', label: `${this.t('collect')} ${fmtCoins(Math.floor(this.roundBet * s.run))}` });
      } else {
        hints.push({ action: 'primary', label: this.t('deal') });
        hints.push({ action: 'betUp', label: t('common.bet') });
      }
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: open ? null : this.bet,
      hints,
      stats: open ? [
        { label: this.t('runLabel'), value: `×${s.run.toFixed(2)}` },
        { label: this.t('stepsLabel'), value: String(s.steps) },
      ] : [],
    });
  }

  private rtpNow(): number { return clampRtp(BASE_RTP + this.mod(HOOK_RTP, 0)); }
}
