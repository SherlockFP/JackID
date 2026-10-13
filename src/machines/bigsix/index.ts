/**
 * Big Six Money Wheel "The Six-Score Wheel" (`bigsix`) — shared TableBase device, 8 standing spots (MACHINES_tables §9).
 *
 * Host timeline (every peer presents): OPEN (solo: until Ready; shared: 15 s, early on all-Ready) → LOCK (stakes charged,
 * the flapper's stop is drawn at OPEN for `peek`, paid out at once, so leaving mid-spin never loses money) → SPIN (6–11 s
 * exponential decay that lands on the drawn segment) → STOP (wobble) → ANNOUNCE → PAYOUT → CLEAR → OPEN.
 * Chips are placed locally and sent as absolute symbol totals (`set`); the host validates limits.
 *
 * Juice: anticipation (bell, handle lever, phase lamp) → action (the flapper clacks off every peg, the rim chases) →
 * impact (EYE opens and stares at the winner; HOUSE blacks out the rim and slams the lid) → follow-through (pop text,
 * tier celebration, loss and near-miss beats).
 *
 * Keys: LMB spot / RMB remove · 1–6 quick bet · Space Pull/Ready · R repeat · Backspace clear · 9 Golden Ratchet (charm) ·
 * wheel/Z/X chip value · E stand · H help.
 */
import * as THREE from 'three';
import type { ChipValue, Kit } from '@/kit/types';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, HUB, SEGMENT_HEX, SPOT_X, TOP, type BigSixParts } from './model';
import {
  BET_SYMS, NUDGE_COST, SEGMENTS, SEGMENT_COUNT, TABLE_MAX, LIMIT, buildMods, drawSeg, playHeadless,
  spin, type Bet, type BetSym, type Mods,
} from './rules';
import { STRINGS } from './bigsix.strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const OPEN_S = 15;          // shared betting window
const LOCK_S = 0.6;         // bell, handle clunk
const STOP_S = 1.0;         // wobble back onto the segment
const ANNOUNCE_S = 1.5;
const PAYOUT_S = 2.5;
const CLEAR_S = 0.8;
const SPIN_MIN_MS = 6000, SPIN_MAX_MS = 11000;
const SEATS = 8;
const CHIP_CAP = 290;       // InstancedMesh budget (300 chips)
const PEG = (Math.PI * 2) / SEGMENT_COUNT;
const FLAP_MAX = 0.436;     // 25° per peg
const GOLD = 0xffd040, GREEN = 0x7dff7a;
const CHIP_Z = 0.42;

// ── contract types ──────────────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'open' | 'lock' | 'spin' | 'payout' | 'clear';
type Ev =
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'nudge'; seat: number; on: boolean }
  | { k: 'phase'; p: Phase }
  | { k: 'mult'; seg: number }
  | { k: 'spin'; seg: number; durMs: number; turns: number; nudges: number; creeped: boolean }
  | { k: 'result'; seg: number; rerolled: boolean; seats: Array<{ seat: number; stake: number; gross: number; nearmiss: boolean }> }
  | { k: 'peek'; isOne: boolean };
type Act = { k: 'set'; spot: BetSym; a: number } | { k: 'clear' } | { k: 'ready' } | { k: 'nudge' };
/** What every peer knows (public counter state). Mutated only in `present`. */
type State = { phase: Phase; layouts: Bet[][]; ready: boolean[]; nudge: boolean[]; mult: number; history: number[] };
type Snap = State;

const emptyLayouts = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyFlags = (): boolean[] => new Array<boolean>(SEATS).fill(false);
const symIndex = (s: BetSym): number => BET_SYMS.indexOf(s);

/** Chip stack for an amount, greedy largest-first. */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [500, 100, 25, 10, 5, 1] as const) while (left >= v && out.length < 60) { out.push(v); left -= v; }
  return out;
}

/** Nearest bettable symbol spot to a counter x (machine-local), or null when the pointer is between spots. */
function spotAtX(x: number): BetSym | null {
  let best = -1, bestD = 0.09 * 0.09;
  SPOT_X.forEach((sx, i) => { const d = (sx - x) ** 2; if (d < bestD) { bestD = d; best = i; } });
  return best < 0 ? null : BET_SYMS[best];
}

/** Abbreviation for the last-12 strip. */
const abbrev = (seg: number): string => {
  const s = SEGMENTS[seg];
  return s === 'EYE' ? 'E' : s === 'HOUSE' ? 'H' : s;
};

export default class BigSixWheel extends TableBase<BigSixParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), nudge: emptyFlags(), mult: -1, history: [] };
  /** HOST-ONLY authority: stakes not yet locked, ready and nudge flags, round timer, the pre-drawn stop. */
  private hs: { phase: Phase; layouts: Bet[][]; ready: boolean[]; nudge: boolean[]; timer: number; pre: number; mult: number } = {
    phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), nudge: emptyFlags(), timer: 0, pre: -1, mult: -1,
  };
  /** Local only: my layout at the last LOCK, for Repeat (R). */
  private lastMine: Bet[] = [];
  private lastLock: Bet[] = [];

  protected createModel(kit: Kit): MachineModel<BigSixParts> { return buildModel(kit, this.modelOpts); }

  init(): void { this.paintAll(); }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (this.st.phase !== 'open' && this.st.phase !== 'idle') break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': if (this.st.phase === 'open') this.act({ k: 'ready' }); break;   // Space: pull (solo) / Ready (shared)
      case 'clear': if (this.canBet()) this.act({ k: 'clear' }); break;
      case 'double': this.rebet(); break;                                              // R
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6':
        if (this.canBet()) this.nudgeSpot(BET_SYMS[Number(a.slice(1)) - 1], 1);
        break;
      case 'n9': this.toggleRatchet(); break;
      default: break;
    }
  }

  /** LMB places one chip (the selected value) on the symbol under the pointer; RMB takes one back; the handle pulls. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down') return;
    if (this.pick([this.parts.handle.root])) {
      if (this.st.phase === 'open') this.act({ k: 'ready' });
      return;
    }
    if (!this.canBet()) return;
    const hit = this.pick([this.parts.layout]);
    if (!hit) return;
    const sym = spotAtX(this.parts.layout.worldToLocal(hit.point.clone()).x);
    if (!sym) return;
    this.nudgeSpot(sym, e.button === 2 ? -1 : 1);
  }

  private canBet(): boolean { return this.localSeat >= 0 && this.st.phase === 'open' && !this.st.ready[this.localSeat]; }
  private myBets(): Bet[] { return this.st.layouts[this.localSeat] ?? []; }
  private myAmount(s: BetSym): number { return this.myBets().find((b) => b.s === s)?.a ?? 0; }

  /** Adds (`dir` = 1) or removes (`dir` = −1) one selected chip on a symbol. */
  private nudgeSpot(s: BetSym, dir: 1 | -1): void {
    const cur = this.myAmount(s);
    let next = dir > 0 ? cur + this.bet : cur - this.bet;
    if (dir > 0 && next > LIMIT.max) { next = LIMIT.max; this.toast(tr('m.bigsix.limit', { n: fmtCoins(LIMIT.max) }), 'warn'); }
    if (dir > 0 && next < LIMIT.min) next = LIMIT.min;
    if (dir < 0) next = Math.max(0, next);
    const total = this.myBets().reduce((acc, b) => acc + (b.s === s ? 0 : b.a), 0) + next;
    if (total > TABLE_MAX) { this.toast(tr('m.bigsix.limit', { n: fmtCoins(TABLE_MAX) }), 'warn'); return; }
    if (next === cur) return;
    this.sfx('chip');
    this.act({ k: 'set', spot: s, a: next });
  }

  /** Golden Ratchet (charm): arm or disarm the paid nudge for this round. */
  private toggleRatchet(): void {
    if (this.localSeat < 0 || this.st.phase !== 'open') return;
    if (this.mod('x.wheel.nudge' as ModHook, 0) < 1) { this.toast(tr('m.bigsix.ratchetLocked'), 'warn'); return; }
    if (!this.myBets().length) { this.toast(tr('m.bigsix.ratchetNone'), 'warn'); return; }
    this.act({ k: 'nudge' });
  }

  /** Repeats the last LOCKed layout where the counter still allows it. */
  private rebet(): void {
    if (!this.canBet()) return;
    for (const b of this.lastMine) if (this.myAmount(b.s) !== b.a) this.act({ k: 'set', spot: b.s, a: b.a });
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'set') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.bigsix.busy'); return; }
      if (!BET_SYMS.includes(a.spot)) { this.nak(pid, rid, 'm.bigsix.badSpot'); return; }
      if (!Number.isInteger(a.a) || a.a < 0 || (a.a > 0 && (a.a < LIMIT.min || a.a > LIMIT.max))) { this.nak(pid, rid, 'm.bigsix.limit'); return; }
      const others = hs.layouts[seat].reduce((acc, b) => acc + (b.s === a.spot ? 0 : b.a), 0);
      if (others + a.a > TABLE_MAX) { this.nak(pid, rid, 'm.bigsix.limit'); return; }
      const next = hs.layouts[seat].filter((b) => b.s !== a.spot);
      if (a.a > 0) next.push({ s: a.spot, a: a.a });
      hs.layouts[seat] = next;
      this.unready(seat);
      if (!next.length) this.dropNudge(seat);
      void this.emit({ k: 'lay', seat, bets: next });
    } else if (a.k === 'clear') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.bigsix.busy'); return; }
      hs.layouts[seat] = [];
      this.unready(seat);
      this.dropNudge(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    } else if (a.k === 'nudge') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.bigsix.busy'); return; }
      if (this.mod('x.wheel.nudge' as ModHook, 0) < 1) { this.nak(pid, rid, 'm.bigsix.ratchetLocked'); return; }
      if (!hs.layouts[seat].length) { this.nak(pid, rid, 'm.bigsix.ratchetNone'); return; }
      hs.nudge[seat] = !hs.nudge[seat];
      this.unready(seat);
      void this.emit({ k: 'nudge', seat, on: hs.nudge[seat] });
    } else if (a.k === 'ready') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.bigsix.busy'); return; }
      if (!hs.layouts[seat].length) { this.nak(pid, rid, 'm.bigsix.noChips'); return; }
      hs.ready[seat] = true;
      void this.emit({ k: 'ready', seat, on: true });
      const bettors = this.humans().filter((h) => hs.layouts[h.seat].length > 0);
      if (bettors.every((h) => hs.ready[h.seat])) this.lock();
    }
  }
  private unready(seat: number): void {
    if (!this.hs.ready[seat]) return;
    this.hs.ready[seat] = false;
    void this.emit({ k: 'ready', seat, on: false });
  }
  private dropNudge(seat: number): void {
    if (!this.hs.nudge[seat]) return;
    this.hs.nudge[seat] = false;
    void this.emit({ k: 'nudge', seat, on: false });
  }

  /** Host: betting window opens (solo: no timer; shared: 15 s). The stop is drawn now so `peek` can read it. */
  private openBetting(): void {
    const hs = this.hs;
    const m = this.mods();
    hs.phase = 'open';
    hs.timer = OPEN_S;
    hs.pre = drawSeg(this.hostRng, m.weights);
    hs.mult = this.feature('bigsix.multiplier') ? Math.min(SEGMENT_COUNT - 1, Math.floor(this.hostRng.next() * SEGMENT_COUNT)) : -1;
    if (this.humans().length >= 2) void this.countdown(OPEN_S, 'bet');
    void this.emit({ k: 'phase', p: 'open' });
    void this.emit({ k: 'mult', seg: hs.mult });
    if (this.mod('x.table.peekCharges' as ModHook, 0) > 0) {
      const isOne = SEGMENTS[hs.pre] === '1';
      for (const h of this.humans()) void this.emitPrivate(h.pid, { k: 'peek', isOne });
    }
  }

  /** Host timeline. */
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans().length;
    if (hs.phase === 'idle') {
      if (humans > 0) this.openBetting();
    } else if (hs.phase === 'open') {
      if (humans === 0) { this.hs = { phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), nudge: emptyFlags(), timer: 0, pre: -1, mult: -1 }; return; }
      if (humans >= 2 && (hs.timer -= dt) <= 0) {
        if (hs.layouts.some((l) => l.length > 0)) this.lock();
        else this.openBetting();                       // nobody has chips yet: the window restarts
      }
    } else if ((hs.timer -= dt) <= 0) {
      void this.emit({ k: 'phase', p: 'clear' });
      this.openBetting();
    }
  }

  /** Charms and milestone flags folded for this spin (`m.bigsix.*` hooks; base 100 per segment). */
  private mods(): Mods {
    return buildMods((hook, base) => this.mod(hook, base), (f) => this.feature(f));
  }

  /** Host: LOCK → charge, draw, pay, then announce the whole spin to every peer. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    const active: Array<{ seat: number; bets: Bet[]; stake: number; nudge: boolean }> = [];
    for (let s = 0; s < SEATS; s++) {
      const bets = hs.layouts[s];
      if (!bets.length) continue;
      const stake = bets.reduce((acc, b) => acc + b.a, 0);
      const nudge = hs.nudge[s];
      const fee = nudge ? Math.ceil(stake * NUDGE_COST) : 0;
      const pid = this.seats[s];
      if (pid === null || !this.chargeSeat(s, stake + fee)) {
        if (pid !== null) this.nak(pid, 0, 'm.bigsix.noFunds');
        hs.layouts[s] = [];
        this.unready(s);
        this.dropNudge(s);
        void this.emit({ k: 'lay', seat: s, bets: [] });
        continue;
      }
      active.push({ seat: s, bets, stake, nudge });
    }
    if (!active.length) { this.openBetting(); return; }

    // the luck reroll is for solo tables; refund mode (≥ 2 humans on the spin) draws once, no reroll
    const luck = active.length >= 2 ? 0 : this.luck();
    const m: Mods = { ...this.mods(), multSeg: hs.mult };
    const first = hs.pre;
    hs.pre = -1;
    const out = spin(this.hostRng, active.map((a) => a.bets), m, luck, first, active.filter((a) => a.nudge).map((a) => a.bets));
    active.forEach((a, i) => { this.paySeat(a.seat, out.seats[i].gross, { bet: a.stake }); });

    this.lastLock = active.find((a) => a.seat === this.localSeat)?.bets ?? [];
    const durMs = Math.round(this.hostRng.float(SPIN_MIN_MS, SPIN_MAX_MS));
    const turns = 3 + Math.floor(durMs / 2000);
    hs.phase = 'lock';
    hs.timer = LOCK_S + durMs / 1000 + STOP_S + ANNOUNCE_S + PAYOUT_S + CLEAR_S;
    hs.layouts = emptyLayouts();
    hs.ready = emptyFlags();
    hs.nudge = emptyFlags();
    void this.emit({ k: 'phase', p: 'lock' });
    void this.emit({ k: 'spin', seg: out.seg, durMs, turns, nudges: out.nudges, creeped: out.creeped });
    void this.emit({
      k: 'result', seg: out.seg, rerolled: out.rerolled,
      seats: active.map((a, i) => ({ seat: a.seat, stake: a.stake, gross: out.seats[i].gross, nearmiss: out.seats[i].nearmiss })),
    });
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'lay':
        this.st.layouts[ev.seat] = ev.bets;
        this.paintChips();
        this.paintLamps();
        if (ev.bets.length) this.sfx('chip');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'ready':
        this.st.ready[ev.seat] = ev.on;
        if (ev.on) { this.parts.seatLamps[ev.seat].blink(4, 0.6); this.sfx('click'); }
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'nudge':
        this.st.nudge[ev.seat] = ev.on;
        if (ev.on) { this.sfx('ratchet'); this.toast(tr('m.bigsix.ratchetOn'), 'sys'); }
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'mult':
        this.st.mult = ev.seg;
        this.parts.multiplierPeg.setOn(ev.seg >= 0);
        return;
      case 'phase': await this.onPhase(ev.p, pc); return;
      case 'spin': await this.spinShow(ev, pc); return;
      case 'result': await this.resultShow(ev, pc); return;
      case 'peek':
        this.toast(tr(ev.isOne ? 'm.bigsix.peekOne' : 'm.bigsix.peekNotOne'), 'sys');
        return;
    }
  }

  private async onPhase(p: Phase, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.phase = p;
    if (p === 'lock') {
      this.lastMine = [...this.lastLock];
      this.sfx('bell');                                                        // anticipation: the bell
      this.parts.phaseLamp.blink(6, 0.8);
      await this.pullHandle(pc.fast);
    } else if (p === 'clear') {
      s.layouts = emptyLayouts();
      s.ready = emptyFlags();
      s.nudge = emptyFlags();
      this.paintChips();
    } else if (p === 'open') {
      this.parts.phaseLamp.setOn(true);
    }
    this.paintLamps();
    this.drawHistory();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Anticipation: the handle goes down with a clunk and the rim wakes up. */
  private async pullHandle(fast: boolean): Promise<void> {
    const h = this.parts.handle;
    if (fast) return;
    await h.pull(0.55);
  }

  /**
   * Action: the disc spins on a closed-form exponential decay θ(t) = Δ·(1 − e^(−λt)) / (1 − e^(−λT)), so the stop is
   * exact. The flapper flicks back on every peg crossed; the rim chases during the spin.
   */
  private async spinShow(ev: Extract<Ev, { k: 'spin' }>, pc: PresentCtx): Promise<void> {
    const { wheel, flapper, rim } = this.parts;
    const disc = wheel.disc;
    this.st.phase = 'spin';
    const a0 = disc.rotation.y;
    const target0 = wheel.angleOf(ev.seg);
    const fwd = ((target0 - a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const delta = fwd + ev.turns * Math.PI * 2;
    const T = ev.durMs / 1000;
    const lam = 3 / T;
    const norm = 1 - Math.exp(-lam * T);
    const final = a0 + delta;
    rim.pattern('chase', 14);
    if (pc.fast) {
      disc.rotation.y = final;
    } else {
      let lastPeg = -1, lastClack = -1;
      await this.anim(T, (k) => {
        const th = (delta * (1 - Math.exp(-lam * k * T))) / norm;
        disc.rotation.y = a0 + th;
        const pegs = th / PEG;
        const phase = pegs - Math.floor(pegs);
        flapper.rotation.z = -FLAP_MAX * Math.exp(-6 * phase);
        const peg = Math.floor(pegs);
        if (peg !== lastPeg) {
          lastPeg = peg;
          const now = k * T;
          if (now - lastClack > 0.03) { lastClack = now; this.sfx('wheelTick', { vol: 0.5 }); }
        }
      }, 'outQuad');
    }
    disc.rotation.y = final;
    flapper.rotation.z = 0;
    // stop: a wobble back onto the segment, no more than half a peg
    if (!pc.fast) {
      const amp = PEG * 0.35;
      await this.anim(STOP_S, (k) => { disc.rotation.y = final + amp * Math.sin(k * Math.PI * 3) * (1 - k); });
    }
    this.st.history = [ev.seg, ...this.st.history].slice(0, 12);
    this.drawHistory();
    if (!pc.fast) await this.wait(ANNOUNCE_S * 0.3);
  }

  /** Impact + follow-through: EYE opens, HOUSE blacks out, pop text, tier celebration, loss and near-miss beats. */
  private async resultShow(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'payout';
    const { eyeLid, pupil, hubHalves, rim, seatLamps } = this.parts;
    const wheel = this.parts.wheel.root;
    const sym = SEGMENTS[ev.seg];
    const winners = [...ev.seats].filter((r) => r.gross > 0).sort((x, y) => y.gross - x.gross);
    const best = winners[0];

    // announce the segment: its rim bulbs blink
    rim.setBulb(ev.seg, 0xffffff);
    rim.pattern('blink', 4);

    if (sym === 'EYE') {
      this.sfx('jackpotSiren', { vol: 0.5 });
      if (!pc.fast) await this.anim(0.6, (k) => { eyeLid.position.y = 0.4 * k; });
      else eyeLid.position.y = 0.4;
      if (best) pupil.position.x = HUB.x + ((best.seat - (SEATS - 1) / 2) / ((SEATS - 1) / 2)) * 0.04;   // the eye looks at the winner
      this.ctx.fx.glow(wheel, GOLD, 0.8, 1.2);
      this.ctx.fx.shake(0.02, 0.4, { roll: 0.3 });
    } else if (sym === 'HOUSE') {
      this.sfx('lose', { vol: 0.8 });
      rim.pattern('off');
      if (!pc.fast) {
        await this.anim(0.3, (k) => {
          hubHalves[0].position.x = HUB.x - 0.05 - 0.03 * k;
          hubHalves[1].position.x = HUB.x + 0.05 + 0.03 * k;
        });
        await this.wait(1.2);
      }
      eyeLid.position.y = 0;
      this.sfx('thud', { vol: 0.9 });
      this.ctx.fx.shake(0.03, 0.35, { roll: 0.5 });
      if (!pc.fast) await this.anim(0.3, (k) => {
        hubHalves[0].position.x = HUB.x - 0.08 + 0.03 * k;
        hubHalves[1].position.x = HUB.x + 0.08 - 0.03 * k;
      });
      hubHalves[0].position.x = HUB.x - 0.05;
      hubHalves[1].position.x = HUB.x + 0.05;
    } else {
      this.sfx('chime', { vol: 0.5 });
      this.ctx.fx.sparks(wheel, 6, SEGMENT_HEX[sym]);
    }
    if (ev.seg === this.st.mult && ev.seg >= 0) this.parts.multiplierPeg.blink(8, 1.0);

    // follow-through: payouts and the local player's feedback
    if (best && best.gross > best.stake) {
      const tier = juiceTier(best.gross, best.stake);
      void this.celebrate(tier, { amount: best.gross, at: wheel, lamps: [seatLamps[best.seat]], fast: pc.fast, restore: () => this.paintLamps() });
    } else if (!best) {
      this.sfx('coin');
    }
    for (const r of ev.seats) {
      if (r.gross <= 0 && r.stake > 0) {
        if (r.seat === this.localSeat) {
          this.commiserate({ at: wheel });
          if (r.nearmiss) void this.nearMiss({ at: wheel });
        }
        continue;
      }
      const seatTile = seatLamps[r.seat];
      seatTile.blink(8, 1.2);
      const text = r.gross === r.stake && sym === 'HOUSE'
        ? tr('m.bigsix.push', { n: fmtCoins(r.gross) })
        : tr('m.bigsix.win', { n: fmtCoins(r.gross) });
      if (r.gross > 0) this.ctx.fx.popText(seatTile.root, text, r.gross > r.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
    }
    this.ctx.ui.toast(tr('m.bigsix.stopped', { s: sym === 'EYE' ? tr('m.bigsix.symEye') : sym === 'HOUSE' ? tr('m.bigsix.symHouse') : sym }), 'sys');
    if (ev.rerolled) this.ctx.fx.glow(wheel, GREEN, 0.4, 0.6);
    if (!pc.fast) await this.wait(PAYOUT_S * 0.5);
    if (sym !== 'EYE') { eyeLid.position.y = 0; pupil.position.x = HUB.x; }
    rim.pattern('off');
    this.drawHistory();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: public counter state only ──────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase, layouts: this.st.layouts.map((l) => [...l]), ready: [...this.st.ready],
      nudge: [...this.st.nudge], mult: this.st.mult, history: [...this.st.history],
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, layouts: sn.layouts.map((l) => [...l]), ready: [...sn.ready], nudge: [...sn.nudge],
      mult: sn.mult, history: [...sn.history],
    };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, seat: number, local: boolean): void {
    this.paintLamps();
    if (local) { this.sfx('chime', { vol: 0.5 }); this.showHud(); }
  }
  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && this.hs.phase === 'open' && this.hs.layouts[seat].length) {
      this.hs.layouts[seat] = [];
      this.unready(seat);
      this.dropNudge(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    }
    if (local) this.lastMine = [];
    this.paintLamps();
  }
  override onLang(): void { this.drawHistory(); this.paintChips(); if (this.isLocalOccupant) this.showHud(); }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private paintLamps(): void {
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
    this.parts.phaseLamp.setOn(this.st.phase !== 'idle');
    BET_SYMS.forEach((sym, i) => {
      const lit = this.st.layouts.some((l) => l.some((b) => b.s === sym));
      this.parts.spots[i].setOn(lit);
    });
    this.parts.multiplierPeg.setOn(this.st.mult >= 0);
  }

  private paintChips(): void {
    const { chips } = this.parts;
    chips.clear();
    this.st.layouts.forEach((seat, s) => {
      for (const b of seat) {
        const i = symIndex(b.s);
        if (i < 0) continue;
        const v = new THREE.Vector3(SPOT_X[i], TOP + 0.012, CHIP_Z - 0.05 + s * 0.012);
        for (const c of chipsFor(b.a)) {
          if (chips.count >= CHIP_CAP) return;
          chips.add(c, v);
        }
      }
    });
  }

  private paintAll(): void {
    this.paintLamps();
    this.paintChips();
    this.drawHistory();
    this.parts.multiplierPeg.setOn(this.st.mult >= 0);
  }

  private drawHistory(): void {
    this.parts.last12.draw((g, w) => {
      g.fillStyle = '#080808';
      g.fillRect(0, 0, w.w, w.h);
      this.st.history.forEach((seg, i) => {
        const x = 1 + i * 8;
        g.fillStyle = `#${SEGMENT_HEX[SEGMENTS[seg]].toString(16).padStart(6, '0')}`;
        g.fillRect(x, 1, 7, w.h - 2);
        w.text(abbrev(seg), x + 3, 3, { font: 'px5', color: '#ffffff', align: 'center' });
      });
    });
  }

  private showHud(): void {
    const seat = this.localSeat;
    const hints: HudHint[] = [];
    const open = this.st.phase === 'open';
    if (open && seat >= 0) {
      hints.push({ action: 'confirm', label: this.st.ready[seat] ? tr('m.bigsix.ready') : tr('m.bigsix.spin') });
      hints.push({ action: 'clear', label: tr('m.bigsix.clear') }, { action: 'double', label: tr('m.bigsix.rebet') });
      if (this.mod('x.wheel.nudge' as ModHook, 0) >= 1) hints.push({ action: 'n9', label: tr('m.bigsix.nudge') });
    }
    hints.push({ action: 'betUp', label: tr('common.bet') }, { action: 'exit', label: tr('common.leave') });
    const total = this.myBets().reduce((acc, b) => acc + b.a, 0);
    this.hud({
      bet: open && seat >= 0 ? this.bet : null,
      hints,
      stats: total > 0 ? [{ label: this.t('potLabel'), value: fmtCoins(total) }] : [],
    });
  }
}

export { playHeadless } from './rules';

export const def: MachineDef = {
  id: 'bigsix',
  category: 'wheel',
  slotSize: 'L',
  zone: 'wheels',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: 1, maxBet: 200, betSteps: [1, 2, 5, 10, 25, 50, 100, 200],
  maxPayoutMult: 102,
  rtp: 0.9630,
  actionCost: 1,
  tags: ['table', 'wheel'],
  headless: playHeadless,
  modHooks: {
    'm.bigsix.segmentWeight.<sym>': 'int add to every segment of one symbol (1, 3, 6, 12, 25, EYE, HOUSE); base 100 per segment',
    'm.bigsix.houseShield': 'bool: HOUSE returns every stake (Croupier\'s Rake)',
    'm.bigsix.eyePayAdd': 'int added to the EYE odds (50:1)',
    'm.bigsix.nudge': 'int charges: a stop one peg from a backed symbol creeps onto it with p = 50 %',
    'x.wheel.nudge': 'Golden Ratchet: pay 25 % of the stake to nudge the wheel one step toward your symbol',
    'x.table.peekCharges': 'bool: during OPEN, see whether the next stop is a 1 (private)',
  },
  strings: STRINGS,
};
