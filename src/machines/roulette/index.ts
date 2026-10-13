/**
 * European Roulette "The Bone Wheel" (`roulette`) — shared TableBase device, 6 seats (MACHINES_tables §2, plan logicBrief).
 *
 * Host timeline (every peer presents): OPEN (solo: until Ready; shared: 20 s, early on all-Ready) → LOCK (stakes charged,
 * pocket drawn, paid out at once, so leaving mid-spin never loses money) → spin / ball / drop / settle / announce
 * → PAYOUT → CLEAR → OPEN. Chips are placed locally and sent as absolute spot totals (`set`); the host validates limits.
 *
 * Juice: anticipation (bell, Rake lifts, phase lamp blinks) → action (wheel and ball spin the other way) → impact
 * (sparks at the pocket, dolly drops, history flips) → follow-through (pop text, tier celebration, loss/near-miss beats).
 */
import * as THREE from 'three';
import type { Kit, LampPart, ChipValue } from '@/kit/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, numberXZ, pocketAngle, spotXZ, TOP, type RouletteParts } from './model';
import {
  BASE_WEIGHT, POCKETS, callPlan, colorOf, defaultMods, limitsFor, parseSpot, playHeadless, spin, wheelAt,
  type Bet, type CallId, type Mods,
} from './rules';
import { STRINGS } from './strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const OPEN_S = 20;          // shared betting window
const LOCK_S = 0.8;         // bell, Rake hand up
const LAUNCH_S = 0.6;
const SETTLE_S = 0.6;
const ANNOUNCE_S = 1.5;
const PAYOUT_S = 1.2;
const CLEAR_S = 0.8;
const TABLE_MAX = 2000;     // per player per spin
const CHIP_CAP = 590;       // InstancedMesh budget (600 chips)
const GOLD = 0xffd040, GREEN = 0x7dff7a;

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Phase = 'idle' | 'open' | 'lock' | 'spin' | 'payout' | 'clear';
type Ev =
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'phase'; p: Phase }
  | { k: 'spin'; pocket: number; orbitMs: number; dropMs: number; bounces: number }
  | { k: 'result'; pocket: number; rerolled: boolean; seats: Array<{ seat: number; stake: number; gross: number; nearmiss: boolean }> };
type Act = { k: 'set'; spot: string; a: number } | { k: 'clear' } | { k: 'ready' };
/** What every peer knows (public felt state). Mutated only in `present`. */
type State = { phase: Phase; layouts: Bet[][]; ready: boolean[]; history: number[] };
type Snap = State;

const SEATS = 6;
const emptyLayouts = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyReady = (): boolean[] => new Array<boolean>(SEATS).fill(false);

/** Chip stack for an amount, greedy largest-first. */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [500, 100, 25, 10, 5, 1] as const) while (left >= v && out.length < 60) { out.push(v); left -= v; }
  return out;
}

/** Every spot a pointer can hit (straights, splits, corners, streets, outside bets, dozens and columns). */
const CANDIDATES: readonly string[] = (() => {
  const out: string[] = [];
  for (let n = 0; n <= 36; n++) out.push(`straight:${n}`);
  for (let a = 1; a <= 35; a++) {
    if (a % 3 !== 0) out.push(`split:${a}-${a + 1}`);
    if (a <= 33) out.push(`split:${a}-${a + 3}`);
  }
  for (const a of [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26, 28, 29, 31, 32]) out.push(`corner:${a}`);
  for (let r = 1; r <= 12; r++) out.push(`street:${r}`);
  for (const s of ['red', 'black', 'odd', 'even', 'low', 'high', 'doz:1', 'doz:2', 'doz:3', 'col:1', 'col:2', 'col:3', 'split:0-1', 'split:0-2', 'split:0-3', 'first4']) out.push(s);
  return out;
})();

/** Nearest bettable spot to a felt point (machine-local x, z). */
function nearestSpot(x: number, z: number): string | null {
  let best: string | null = null, bestD = 0.07 * 0.07;
  for (const s of CANDIDATES) {
    const p = spotXZ(s);
    if (!p) continue;
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

const wrapTau = (a: number): number => ((a % (Math.PI * 2)) + Math.PI * 4) % (Math.PI * 2);

export default class RouletteWheel extends TableBase<RouletteParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', layouts: emptyLayouts(), ready: emptyReady(), history: [] };
  /** HOST-ONLY authority: stakes not yet locked, ready flags, round timer. */
  private hs: { phase: Phase; layouts: Bet[][]; ready: boolean[]; timer: number } = { phase: 'idle', layouts: emptyLayouts(), ready: emptyReady(), timer: 0 };
  /** Local only: my layout at the last LOCK, for Rebet (R). */
  private lastMine: Bet[] = [];

  protected createModel(kit: Kit): MachineModel<RouletteParts> { return buildModel(kit, this.modelOpts); }

  /** Seat HUD overlay (readability standard, see _base/seatHud.ts); shown while seated. */
  private seatHud?: SeatHud;

  init(): void { this.seatHud = new SeatHud(this.ctx.ui.root); this.hud(null); this.paintAll(); }
  dispose(): void { this.seatHud?.dispose(); super.dispose(); }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.ruleLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (this.st.phase !== 'open' && this.st.phase !== 'idle') break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': if (this.st.phase === 'open') this.act({ k: 'ready' }); break;   // Space: spin (solo) / Ready (shared)
      case 'clear': if (this.canBet()) this.act({ k: 'clear' }); break;
      case 'double': this.rebet(); break;                                              // R
      case 'n2': this.callBet('neighboursZero'); break;
      case 'n3': this.callBet('third'); break;
      case 'n4': this.callBet('orphans'); break;
      case 'n5': this.callBet('zeroGame'); break;
      default: break;
    }
  }

  /** LMB places one chip (the selected value) on the spot under the pointer; RMB takes one back. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || !this.canBet()) return;
    const hit = this.pick([this.parts.layout]);
    if (!hit) return;
    const local = this.parts.layout.worldToLocal(hit.point.clone());
    const spot = nearestSpot(local.x + 0.4, -local.y);
    if (!spot) return;
    if (e.button === 2) this.nudge(spot, -1); else this.nudge(spot, 1);
  }

  private canBet(): boolean { return this.localSeat >= 0 && this.st.phase === 'open' && !this.st.ready[this.localSeat]; }
  private myBets(): Bet[] { return this.st.layouts[this.localSeat] ?? []; }
  private myAmount(spot: string): number { return this.myBets().find((b) => b.s === spot)?.a ?? 0; }

  /** Adds (`dir` = 1) or removes (`dir` = −1) one selected chip on a spot. */
  private nudge(spot: string, dir: 1 | -1): void {
    const lim = limitsFor(spot);
    const cur = this.myAmount(spot);
    let next = dir > 0 ? cur + this.bet : cur - this.bet;
    if (dir > 0 && next > lim.max) { next = lim.max; this.toast(tr('m.roulette.limit', { n: fmtCoins(lim.max) }), 'warn'); }
    if (dir > 0 && next < lim.min) next = lim.min;
    if (dir < 0) next = Math.max(0, next);
    const total = this.myBets().reduce((s, b) => s + (b.s === spot ? 0 : b.a), 0) + next;
    if (total > TABLE_MAX) { this.toast(tr('m.roulette.limit', { n: fmtCoins(TABLE_MAX) }), 'warn'); return; }
    if (next === cur) return;
    this.sfx('chip');
    this.act({ k: 'set', spot, a: next });
  }

  /** Racetrack call bet: places one selected chip per call chip (duplicates stack). */
  private callBet(call: CallId): void {
    if (!this.canBet()) return;
    const counts = new Map<string, number>();
    for (const s of callPlan(call)) counts.set(s, (counts.get(s) ?? 0) + 1);
    for (const [spot, n] of counts) this.act({ k: 'set', spot, a: this.myAmount(spot) + n * this.bet });
    this.sfx('chipStack');
  }

  /** Repeats the last LOCKed layout where the table still allows it. */
  private rebet(): void {
    if (!this.canBet()) return;
    for (const b of this.lastMine) if (this.myAmount(b.s) !== b.a) this.act({ k: 'set', spot: b.s, a: b.a });
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'set') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.roulette.busy'); return; }
      const d = parseSpot(a.spot);
      if (!d) { this.nak(pid, rid, 'm.roulette.badSpot'); return; }
      const lim = limitsFor(a.spot);
      if (!Number.isInteger(a.a) || a.a < 0 || (a.a > 0 && (a.a < lim.min || a.a > lim.max))) { this.nak(pid, rid, 'm.roulette.limit'); return; }
      const others = hs.layouts[seat].reduce((s, b) => s + (b.s === a.spot ? 0 : b.a), 0);
      if (others + a.a > TABLE_MAX) { this.nak(pid, rid, 'm.roulette.limit'); return; }
      const next = hs.layouts[seat].filter((b) => b.s !== a.spot);
      if (a.a > 0) next.push({ s: a.spot, a: a.a });
      hs.layouts[seat] = next;
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: next });
    } else if (a.k === 'clear') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.roulette.busy'); return; }
      hs.layouts[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    } else if (a.k === 'ready') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.roulette.busy'); return; }
      if (!hs.layouts[seat].length) { this.nak(pid, rid, 'm.roulette.noChips'); return; }
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

  /** Host: betting window opens (solo: no timer; shared: 20 s). */
  private openBetting(): void {
    const hs = this.hs;
    hs.phase = 'open';
    hs.timer = OPEN_S;
    if (this.humans().length >= 2) void this.countdown(OPEN_S, 'bet');
    void this.emit({ k: 'phase', p: 'open' });
  }

  /** Host timeline. */
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans().length;
    if (hs.phase === 'idle') {
      if (humans > 0) this.openBetting();
    } else if (hs.phase === 'open') {
      if (humans === 0) { this.hs = { phase: 'idle', layouts: emptyLayouts(), ready: emptyReady(), timer: 0 }; return; }
      if (humans >= 2 && (hs.timer -= dt) <= 0) {
        if (hs.layouts.some((l) => l.length > 0)) this.lock();
        else this.openBetting();                       // nobody has chips yet: the window restarts
      }
    } else if ((hs.timer -= dt) <= 0) {
      void this.emit({ k: 'phase', p: 'clear' });
      this.openBetting();
    }
  }

  /** Pocket weights and charm modifiers for this spin (`m.roulette.*` hooks; base 100 each). */
  private mods(): Mods {
    const red = this.mod('m.roulette.colorWeight.red' as ModHook, 0);
    const black = this.mod('m.roulette.colorWeight.black' as ModHook, 0);
    const weights = Array.from({ length: POCKETS }, (_, n) => {
      const colour = colorOf(n) === 'red' ? red : colorOf(n) === 'black' ? black : 0;
      return Math.max(0, BASE_WEIGHT + Math.round(this.mod(`m.roulette.pocketWeight.${n}` as ModHook, 0)) + Math.round(colour));
    });
    const m = defaultMods();
    return {
      ...m,
      weights,
      zeroShield: this.mod('m.roulette.zeroShield' as ModHook, 0) > 0,
      straightAdd: Math.round(this.mod('m.roulette.straightPayAdd' as ModHook, 0)),
      neighbourPay: this.mod('m.roulette.neighbourPay' as ModHook, 0) > 0,
    };
  }

  /** Host: LOCK → charge, draw, pay, then announce the whole spin to every peer. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    const active: Array<{ seat: number; bets: Bet[]; stake: number }> = [];
    for (let s = 0; s < SEATS; s++) {
      const bets = hs.layouts[s];
      if (!bets.length) continue;
      const stake = bets.reduce((acc, b) => acc + b.a, 0);
      const pid = this.seats[s];
      if (pid === null || !this.chargeSeat(s, stake)) {
        if (pid !== null) this.nak(pid, 0, 'm.roulette.noFunds');
        hs.layouts[s] = [];
        this.unready(s);
        void this.emit({ k: 'lay', seat: s, bets: [] });
        continue;
      }
      active.push({ seat: s, bets, stake });
    }
    if (!active.length) { this.openBetting(); return; }

    // the luck reroll is for solo tables; refund mode (≥ 2 humans on the spin) draws once, no reroll
    const luck = active.length >= 2 ? 0 : this.luck();
    const out = spin(this.hostRng, active.map((a) => a.bets), this.mods(), luck);
    active.forEach((a, i) => { this.paySeat(a.seat, out.seats[i].gross, { bet: a.stake }); });

    this.lastLock = active.find((a) => a.seat === this.localSeat)?.bets ?? [];
    hs.phase = 'lock';
    const dur = LOCK_S + LAUNCH_S + out.orbitMs / 1000 + out.dropMs / 1000 + SETTLE_S + ANNOUNCE_S + PAYOUT_S + CLEAR_S;
    hs.timer = dur;
    hs.layouts = emptyLayouts();
    hs.ready = emptyReady();
    void this.emit({ k: 'phase', p: 'lock' });
    void this.emit({ k: 'spin', pocket: out.pocket, orbitMs: out.orbitMs, dropMs: out.dropMs, bounces: out.bounces });
    void this.emit({
      k: 'result', pocket: out.pocket, rerolled: out.rerolled,
      seats: active.map((a, i) => ({ seat: a.seat, stake: a.stake, gross: out.seats[i].gross, nearmiss: out.seats[i].nearmiss })),
    });
  }
  private lastLock: Bet[] = [];

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'lay':
        this.st.layouts[ev.seat] = ev.bets;
        this.paintChips();
        if (ev.bets.length) this.sfx('chip');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'ready':
        this.st.ready[ev.seat] = ev.on;
        if (ev.on) { this.parts.seatLamps[ev.seat].blink(4, 0.6); this.sfx('click'); }
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'phase': await this.onPhase(ev.p, pc); return;
      case 'spin': await this.spinShow(ev, pc); return;
      case 'result': await this.resultShow(ev, pc); return;
    }
  }

  private async onPhase(p: Phase, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.phase = p;
    if (p === 'lock') {
      this.lastMine = [...this.lastLock];
      this.sfx('chime');                                                       // anticipation: the bell
      this.parts.phaseLamp.blink(6, 0.8);
      await this.raiseRake(pc.fast);
    } else if (p === 'clear') {
      s.layouts = emptyLayouts();
      s.ready = emptyReady();
      this.paintChips();
      await this.lowerRake(pc.fast);
    } else if (p === 'open') {
      this.parts.phaseLamp.setOn(true);
    }
    this.paintLamps();
    this.drawHistory();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Action: the wheel and the ball run in opposite directions, the ball decays onto the pocket. */
  private async spinShow(ev: Extract<Ev, { k: 'spin' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'spin';
    if (this.isLocalOccupant) this.showHud();
    const { rotor, ballPivot, rim, dolly, ball } = this.parts;
    const a = pocketAngle(ev.pocket);
    const rStart = rotor.rotation.y;
    const rEnd = rStart + Math.PI * 2 * 4 + wrapTau(-a - rStart);
    const bStart = ballPivot.rotation.y;
    const bEnd = bStart - Math.PI * 2 * 6 - wrapTau(bStart);
    rim.pattern('chase', 14);
    dolly.visible = false;
    if (pc.fast) {
      rotor.rotation.y = rEnd; ballPivot.rotation.y = bEnd;
    } else {
      this.sfx('chipStack', { vol: 0.6 });
      const spinS = (ev.orbitMs + ev.dropMs) / 1000;
      await this.anim(spinS, (k) => {
        rotor.rotation.y = rStart + (rEnd - rStart) * k;
        ballPivot.rotation.y = bStart + (bEnd - bStart) * (1 - Math.pow(1 - k, 2));
      }, 'outQuad');
    }
    // impact: the ball drops into the pocket
    rotor.rotation.y = rEnd;
    ballPivot.rotation.y = bEnd;
    dolly.position.set(Math.sin(a) * 0.275, 0.05, Math.cos(a) * 0.275);
    dolly.visible = true;
    this.ctx.fx.sparks(ball, 10, colorOf(ev.pocket) === 'red' ? 0xff4040 : GOLD);
    this.ctx.fx.shake(0.012, 0.25, { roll: 0.4 });
    this.sfx('cardSlap', { vol: 0.8 });
    this.parts.rim.pattern('blink', 4);
    this.st.history = [ev.pocket, ...this.st.history].slice(0, 12);
    this.drawHistory();
    if (!pc.fast) await this.wait(ANNOUNCE_S * 0.3);
  }

  /** Follow-through: pop text, tier celebration, loss and near-miss beats. */
  private async resultShow(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'payout';
    const lamps = this.parts.seatLamps, wheel = this.parts.wheel;
    const winners = [...ev.seats].filter((r) => r.gross > 0).sort((x, y) => y.gross - x.gross);
    const best = winners[0];
    if (best) {
      const tier = juiceTier(best.gross, best.stake);
      void this.celebrate(tier, { amount: best.gross, at: wheel, lamps: [lamps[best.seat]], fast: pc.fast, restore: () => this.paintLamps() });
    } else {
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
      const seatTile = this.parts.seatLamps[r.seat];
      seatTile.blink(8, 1.2);
      if (r.gross > 0) this.ctx.fx.popText(seatTile.root, tr('m.roulette.win', { n: fmtCoins(r.gross) }), r.gross > r.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
    }
    this.ctx.ui.toast(tr('m.roulette.winNum', { n: ev.pocket, color: tr(`m.roulette.${colorOf(ev.pocket)}`) }), 'sys');
    const mine = ev.seats.find((r) => r.seat === this.localSeat && r.stake > 0);
    if (mine && this.isLocalOccupant) {
      const net = mine.gross - mine.stake;
      this.seatHud?.result(mine.gross <= 0 ? 'lose' : net > 0 ? 'win' : 'push', net);
    }
    if (ev.rerolled) this.ctx.fx.glow(wheel, GREEN, 0.4, 0.6);
    if (!pc.fast) await this.wait(PAYOUT_S * 0.5);
    this.drawHistory();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: public felt state only ─────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return { phase: this.st.phase, layouts: this.st.layouts.map((l) => [...l]), ready: [...this.st.ready], history: [...this.st.history] };
  }
  applySnapshot(sn: Snap): void {
    this.st = { phase: sn.phase, layouts: sn.layouts.map((l) => [...l]), ready: [...sn.ready], history: [...sn.history] };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('roulette', this.tipLines());
    }
  }
  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && this.hs.phase === 'open' && this.hs.layouts[seat].length) {
      this.hs.layouts[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    }
    if (local) { this.lastMine = []; this.seatHud?.hide(); this.hud(null); }
    this.paintLamps();
  }
  override onLang(): void { this.drawHistory(); this.paintChips(); if (this.isLocalOccupant) this.showHud(); }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private paintLamps(): void {
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
    this.parts.phaseLamp.setOn(this.st.phase !== 'idle');
    this.parts.fairLamp.setOn(true);
  }

  private paintChips(): void {
    const { chips } = this.parts;
    chips.clear();
    for (const seat of this.st.layouts) {
      for (const b of seat) {
        const at = spotXZ(b.s);
        if (!at) continue;
        const v = new THREE.Vector3(at[0], TOP + 0.012, at[1]);
        for (const c of chipsFor(b.a)) {
          if (chips.count >= CHIP_CAP) return;
          chips.add(c, v);
        }
      }
    }
  }

  private paintAll(): void {
    this.paintLamps();
    this.paintChips();
    this.drawHistory();
    this.parts.dolly.visible = false;
  }

  private drawHistory(): void {
    this.parts.history.draw((g, w) => {
      g.fillStyle = '#06100a';
      g.fillRect(0, 0, w.w, w.h);
      w.text(tr('m.roulette.history'), 16, 2, { font: 'px5', color: '#ffd040', align: 'center' });
      this.st.history.forEach((n, i) => {
        const c = colorOf(n);
        g.fillStyle = c === 'red' ? '#9e1b22' : c === 'green' ? '#1e6b3a' : '#141414';
        g.fillRect(2, 14 + i * 14, w.w - 4, 12);
        w.text(String(n), 16, 16 + i * 14, { font: 'px5', color: '#ffffff', align: 'center' });
      });
    });
  }

  private async raiseRake(fast: boolean): Promise<void> {
    const rake = this.parts.rake;
    if (fast) { rake.rotation.x = -0.5; return; }
    await this.anim(0.4, (k) => { rake.rotation.x = -0.5 * k; }, 'outQuad');
  }
  private async lowerRake(fast: boolean): Promise<void> {
    const rake = this.parts.rake;
    if (fast) { rake.rotation.x = 0; this.parts.dolly.visible = false; return; }
    await this.anim(0.5, (k) => { rake.rotation.x = -0.5 * (1 - k); }, 'outQuad');
    this.parts.dolly.visible = false;
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** Refreshes the banner once per displayed second of the shared betting window. */
  private shownSecond = -1;
  frame(): void {
    if (!this.isLocalOccupant) return;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.showHud(); }
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.roulette.hTip1', v: { up: this.k('betUp'), down: this.k('betDown') } },
      { k: 'm.roulette.hTip2', v: { ready: this.k('confirm') } },
      { k: 'm.roulette.hTip3', v: { help: this.k('help') } },
    ];
  }

  private ruleLines(): Txt[] {
    const keys: Txt[] = ['hR1', 'hR2', 'hR3', 'hR4', 'hR5'].map((k) => ({ k: `m.roulette.${k}` }));
    return [...keys, { k: 'm.roulette.hR6', v: { rebet: this.k('double') } }];
  }

  /** Banner, key numbers and the valid controls only. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud, seat = this.localSeat;
    if (!sh || seat < 0) return;
    const st = this.st, open = st.phase === 'open';
    const ready = st.ready[seat];
    const betting = open && !ready;
    const layout = this.myBets().reduce((s, b) => s + b.a, 0);
    sh.goal({ k: 'm.roulette.hGoal' });

    // STATE: what phase, and what you have to do
    if (st.phase === 'idle') sh.state({ k: 'm.roulette.hWait' }, 'neutral');
    else if (open && ready) sh.state({ k: 'm.roulette.hReady' }, 'cyan');
    else if (open) {
      const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
      sh.state({ k: 'm.roulette.hBet' }, 'gold', left > 0 ? { k: 'm.roulette.hSecs', v: { n: left } } : undefined);
    }
    else if (st.phase === 'lock') sh.state({ k: 'm.roulette.hLock' }, 'warn');
    else if (st.phase === 'spin') sh.state({ k: 'm.roulette.hSpin' }, 'cyan');
    else if (st.phase === 'payout') sh.state({ k: 'm.roulette.hPay' }, 'neutral');
    else sh.state({ k: 'm.roulette.hClear' }, 'neutral');

    // KEY NUMBERS: chip, your layout, last pocket, balance
    const nums: HudNumber[] = [{ label: { k: 'm.roulette.hNBet' }, value: fmtCoins(this.bet), tone: 'gold' }];
    if (layout > 0) nums.push({ label: { k: 'm.roulette.hNLayout' }, value: fmtCoins(layout), tone: 'cyan' });
    const last = st.history[0];
    if (last !== undefined) {
      const c = colorOf(last);
      nums.push({ label: { k: 'm.roulette.hNLast' }, value: `${last} ${tr(`m.roulette.${c}`)}`, tone: c === 'red' ? 'bad' : c === 'green' ? 'good' : 'neutral' });
    }
    nums.push({ label: { k: 'm.roulette.hNBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    if (betting || st.phase === 'idle') ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.roulette.hCBet' }, action: 'betUp' });
    if (betting && layout > 0) {
      const many = this.humans().length >= 2;
      ctrl.push({ key: this.k('confirm'), label: { k: many ? 'm.roulette.hCReady' : 'm.roulette.hCSpin' }, action: 'confirm', primary: true });
      ctrl.push({ key: this.k('clear'), label: { k: 'm.roulette.hCClear' }, action: 'clear' });
    }
    if (betting && this.lastMine.length > 0) ctrl.push({ key: this.k('double'), label: { k: 'm.roulette.hCRebet' }, action: 'double' });
    if (betting) {
      ctrl.push({ key: this.k('n2'), label: { k: 'm.roulette.hCZero' }, action: 'n2' });
      ctrl.push({ key: this.k('n3'), label: { k: 'm.roulette.hCThird' }, action: 'n3' });
      ctrl.push({ key: this.k('n4'), label: { k: 'm.roulette.hCOrph' }, action: 'n4' });
      ctrl.push({ key: this.k('n5'), label: { k: 'm.roulette.hCZeroGame' }, action: 'n5' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.roulette.hCRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.roulette.hCLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

export const def: MachineDef = {
  id: 'roulette',
  category: 'wheel',
  slotSize: 'XL',
  zone: 'well',
  seats: SEATS,
  shared: true,
  tier: 1,
  minBet: 1, maxBet: 500, betSteps: [1, 5, 10, 25, 50, 100, 250, 500],
  maxPayoutMult: 36,
  rtp: 0.973,
  actionCost: 1,
  tags: ['table', 'wheel', 'hero'],
  headless: playHeadless,
  modHooks: {
    'm.roulette.pocketWeight.n': 'int add to one pocket weight (base 100), n = 0..36',
    'm.roulette.colorWeight.red': 'int add to all 18 red pockets',
    'm.roulette.colorWeight.black': 'int add to all 18 black pockets',
    'm.roulette.zeroShield': 'bool: every losing bet gets half back on 0',
    'm.roulette.straightPayAdd': 'int added to the 35:1 straight-up odds',
    'm.roulette.neighbourPay': 'bool: a losing straight-up pays 1:1 when the ball lands ±1 pocket',
    luck: 'solo only: reroll a losing table once with p = luck/100',
  },
  strings: STRINGS,
};
