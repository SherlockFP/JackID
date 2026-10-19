/**
 * Sic Bo "The Birdcage" (`sicbo`) — shared TableBase device, 8 standing spots (MACHINES_tables §8, plan logicBrief).
 *
 * Host timeline (every peer presents): OPEN (solo: until Ready; shared: 15 s, early on all-Ready) → LOCK (stakes charged,
 * the three dice drawn and every payout settled at once, so leaving mid-roll never loses money) → FLIP (cage turns) →
 * TUMBLE → SETTLE → LIGHTS → PAYOUT → CLEAR → OPEN. Chips are placed locally and sent as absolute spot totals (`set`);
 * the host validates limits.
 *
 * Juice: anticipation (bell, cage rattles, phase lamp blinks) → action (cage flips, dice tumble) → impact (dice land,
 * shake, sparks, TRIPLE stamp drops on a triple) → follow-through (lit winners, pop text, tier celebration, loss and
 * near-miss beats).
 */
import * as THREE from 'three';
import type { Kit, LampPart, ChipValue } from '@/kit/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { crispTexture } from '@/core/ui/textOverlay';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { ModelOpts } from '@/machines/_base/MachineBase';
import { juiceTier } from '@/machines/_base/tiers';
import { CELLS, DIM, LIT, TOP, buildModel, drawLayoutLabels, spotAt, spotXZ, type SicBoParts } from './model';
import {
  ALL_SPOTS, BASE_WEIGHT, TABLE_MAX, defaultMods, isValidSpot, limitsFor, outcomeOf, playHeadless, roll, winningSpots,
  type Bet, type Dice, type Mods,
} from './rules';
import { STRINGS } from './sicbo.strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const OPEN_S = 15;          // shared betting window
const LOCK_S = 0.6;         // bell, cage rattles
const FLIP_S = 1.4;         // cage turns 180° twice
const TUMBLE_S = 1.8;       // dice bounce inside the bulb
const SETTLE_S = 0.6;
const LIGHTS_S = 1.5;       // every winning panel lights
const PAYOUT_S = 2.5;       // chip push
const CLEAR_S = 0.8;
const SEATS = 8;
const CHIP_CAP = 390;       // InstancedMesh budget (400 chips)
const HISTORY_N = 20;
const GOLD = 0xffd040, GREEN = 0x7dff7a, RED_TINT: [number, number, number] = [1.0, 0.25, 0.2];

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Phase = 'idle' | 'open' | 'lock' | 'roll' | 'payout' | 'clear';
type Ev =
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'phase'; p: 'open' | 'lock' | 'clear' }
  | { k: 'roll'; faces: number[]; first: number[]; rerolled: boolean; refunded: boolean;
      seats: Array<{ seat: number; stake: number; gross: number; nearmiss: boolean }> };
type Act = { k: 'set'; spot: string; a: number } | { k: 'clear' } | { k: 'ready' };
/** What every peer knows (public layout state). Mutated only in `present`. */
type State = { phase: Phase; layouts: Bet[][]; ready: boolean[]; history: number[][] };
type Snap = State;

const emptyLayouts = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyReady = (): boolean[] => new Array<boolean>(SEATS).fill(false);
const toDice = (f: number[]): Dice => [f[0] ?? 1, f[1] ?? 1, f[2] ?? 1];
const isTriple = (f: Dice): boolean => f[0] === f[1] && f[1] === f[2];

/** Chip stack for an amount, greedy largest-first. */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [500, 100, 25, 10, 5, 1] as const) while (left >= v && out.length < 60) { out.push(v); left -= v; }
  return out;
}

export { playHeadless };

export default class SicBo extends TableBase<SicBoParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', layouts: emptyLayouts(), ready: emptyReady(), history: [] };
  /** HOST-ONLY authority: stakes not yet locked, ready flags, round timer. */
  private hs: { phase: 'idle' | 'open' | 'busy'; layouts: Bet[][]; ready: boolean[]; timer: number } =
    { phase: 'idle', layouts: emptyLayouts(), ready: emptyReady(), timer: 0 };
  /** Local only: my layout at the last LOCK, for Rebet (R). */
  private lastMine: Bet[] = [];
  private lastLock: Bet[] = [];

  protected createModel(kit: Kit): MachineModel<SicBoParts> { return buildModel(kit, this.modelOpts); }

  /** Seat HUD overlay (readability standard, see _base/seatHud.ts); shown while seated. */
  private seatHud?: SeatHud;

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root); this.hud(null); this.paintAll();
    // layout text is drawn by the native-resolution pass (placard3d standard): sharp at any PSX target size
    crispTexture(this.parts.labelTex, 4);   // linear + mipmaps for the label sheet (placard3d texture rule)
  }
  dispose(): void { this.seatHud?.dispose(); super.dispose(); }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.ruleLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (this.st.phase !== 'open' && this.st.phase !== 'idle') break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': if (this.st.phase === 'open') this.act({ k: 'ready' }); break;   // Space: roll (solo) / Ready (shared)
      case 'clear': if (this.canBet()) this.act({ k: 'clear' }); break;
      case 'double': this.rebet(); break;                                              // R
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6':
        if (this.canBet()) this.nudge(`single:${a.slice(1)}`, 1);                       // 1–6: quick single die
        break;
      default: break;
    }
  }

  /** LMB places one chip (the selected value) on the spot under the pointer; RMB takes one back. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || !this.canBet()) return;
    const hit = this.pick([this.parts.panels]);
    if (!hit) return;
    const local = this.parts.panels.worldToLocal(hit.point.clone());
    const spot = spotAt(local.x, local.z);
    if (!spot) return;
    this.nudge(spot, e.button === 2 ? -1 : 1);
  }

  private canBet(): boolean { return this.localSeat >= 0 && this.st.phase === 'open' && !this.st.ready[this.localSeat]; }
  private myBets(): Bet[] { return this.st.layouts[this.localSeat] ?? []; }
  private myAmount(spot: string): number { return this.myBets().find((b) => b.s === spot)?.a ?? 0; }

  /** Adds (`dir` = 1) or removes (`dir` = −1) one selected chip on a spot. */
  private nudge(spot: string, dir: 1 | -1): void {
    const lim = limitsFor(spot);
    if (!lim) { this.toast(tr('m.sicbo.badSpot'), 'warn'); return; }
    const cur = this.myAmount(spot);
    let next = dir > 0 ? cur + this.bet : cur - this.bet;
    if (dir > 0 && next > lim.max) { next = lim.max; this.toast(tr('m.sicbo.limit', { n: fmtCoins(lim.max) }), 'warn'); }
    if (dir > 0 && next < lim.min) next = lim.min;
    if (dir < 0 && next < lim.min) next = 0;
    const total = this.myBets().reduce((s, b) => s + (b.s === spot ? 0 : b.a), 0) + next;
    if (total > TABLE_MAX) { this.toast(tr('m.sicbo.limit', { n: fmtCoins(TABLE_MAX) }), 'warn'); return; }
    if (next === cur) return;
    this.sfx('chip');
    this.act({ k: 'set', spot, a: next });
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
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.sicbo.busy'); return; }
      if (!isValidSpot(a.spot)) { this.nak(pid, rid, 'm.sicbo.badSpot'); return; }
      const lim = limitsFor(a.spot);
      if (!lim || !Number.isInteger(a.a) || a.a < 0 || (a.a > 0 && (a.a < lim.min || a.a > lim.max))) { this.nak(pid, rid, 'm.sicbo.limit'); return; }
      const others = hs.layouts[seat].reduce((s, b) => s + (b.s === a.spot ? 0 : b.a), 0);
      if (others + a.a > TABLE_MAX) { this.nak(pid, rid, 'm.sicbo.limit'); return; }
      const next = hs.layouts[seat].filter((b) => b.s !== a.spot);
      if (a.a > 0) next.push({ s: a.spot, a: a.a });
      hs.layouts[seat] = next;
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: next });
    } else if (a.k === 'clear') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.sicbo.busy'); return; }
      hs.layouts[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    } else if (a.k === 'ready') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.sicbo.busy'); return; }
      if (!hs.layouts[seat].length) { this.nak(pid, rid, 'm.sicbo.noChips'); return; }
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

  /** Host: betting window opens (solo: no timer; shared: 15 s). */
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

  /** Die weights and charm modifiers for this roll (`m.sicbo.*` hooks; base 100 per face). */
  private mods(): Mods {
    const m = defaultMods();
    return {
      ...m,
      weights: [1, 2, 3, 4, 5, 6].map((f) => Math.max(0, BASE_WEIGHT + Math.round(this.mod(`m.sicbo.dieWeight.${f}`, 0)))),
      singleTripleAdd: Math.round(this.mod('m.sicbo.singleTripleAdd', 0)),
      totalAdd: Array.from({ length: 19 }, (_, t) => Math.round(this.mod(`m.sicbo.totalPayAdd.${t}`, 0))),
      tripleShield: this.mod('m.sicbo.tripleShield', 0) > 0,
    };
  }

  /** Host: LOCK → charge, roll, pay, then announce the whole roll to every peer. */
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
        if (pid !== null) this.nak(pid, 0, 'm.sicbo.noFunds');
        hs.layouts[s] = [];
        this.unready(s);
        void this.emit({ k: 'lay', seat: s, bets: [] });
        continue;
      }
      active.push({ seat: s, bets, stake });
    }
    if (!active.length) { this.openBetting(); return; }

    const out = roll(this.hostRng, active.map((a) => a.bets), this.mods(), this.luck());
    active.forEach((a, i) => { this.paySeat(a.seat, out.seats[i].gross, { bet: a.stake }); });

    this.lastLock = active.find((a) => a.seat === this.localSeat)?.bets ?? [];
    hs.phase = 'busy';
    const cage = out.rerolled ? 2 : 1;
    hs.timer = LOCK_S + FLIP_S + TUMBLE_S * cage + SETTLE_S + LIGHTS_S + PAYOUT_S + CLEAR_S;
    hs.layouts = emptyLayouts();
    hs.ready = emptyReady();
    void this.emit({ k: 'phase', p: 'lock' });
    void this.emit({
      k: 'roll', faces: [...out.faces], first: [...out.first], rerolled: out.rerolled, refunded: out.refunded,
      seats: active.map((a, i) => ({ seat: a.seat, stake: a.stake, gross: out.seats[i].gross, nearmiss: out.seats[i].nearmiss })),
    });
  }

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
      case 'roll': await this.rollShow(ev, pc); return;
    }
  }

  private async onPhase(p: 'open' | 'lock' | 'clear', pc: PresentCtx): Promise<void> {
    const s = this.st;
    if (p === 'lock') {
      s.phase = 'lock';
      this.lastMine = [...this.lastLock];
      this.sfx('chime');                                                       // anticipation: the bell
      this.parts.phaseLamp.blink(6, 0.8);
      await this.rattle(pc.fast);
    } else if (p === 'clear') {
      s.phase = 'clear';
      s.layouts = emptyLayouts();
      s.ready = emptyReady();
      this.paintChips();
      this.paintPanels(new Set());
      this.parts.stamp.visible = false;
      if (!pc.fast) await this.wait(CLEAR_S * 0.5);
    } else {
      s.phase = 'open';
      this.parts.phaseLamp.setOn(true);
    }
    this.paintLamps();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Anticipation: the cage rattles in its bearings and settles. */
  private async rattle(fast: boolean): Promise<void> {
    const cage = this.parts.cageSpin;
    if (fast) { cage.rotation.x = 0; return; }
    await this.anim(LOCK_S, (k) => { cage.rotation.x = Math.sin(k * Math.PI * 8) * 0.12 * (1 - k); }, 'outQuad');
    cage.rotation.x = 0;
  }

  /** Action → impact → lights → payout for one roll. */
  private async rollShow(ev: Extract<Ev, { k: 'roll' }>, pc: PresentCtx): Promise<void> {
    const { cageSpin, dice, phaseLamp } = this.parts;
    const faces = toDice(ev.faces), first = toDice(ev.first);
    const fast = pc.fast;
    this.st.phase = 'roll';
    if (this.isLocalOccupant) this.showHud();

    // ACTION: the cage turns 180° twice on the crank
    this.sfx('ratchet');
    if (fast) cageSpin.rotation.x = 0;
    else {
      await this.anim(FLIP_S, (k) => { cageSpin.rotation.x = Math.PI * 2 * k; }, 'outQuad');
      cageSpin.rotation.x = 0;
    }
    // ACTION: the dice tumble inside the bulb (a luck reroll tumbles twice)
    await this.tumble(first, fast, 1);
    if (ev.rerolled) {
      this.sfx('chime', { vol: 0.8 });
      this.ctx.fx.popText(phaseLamp.root, tr('m.sicbo.lucky'), GOLD, { dur: 1.2, rise: 0.3 });
      if (!fast) await this.wait(0.6);
      await this.tumble(faces, fast, 0.6);
    }
    // NEAR MISS: the local ticket missed by one, so the last die stops one face off for a beat before it lands
    if (!fast && ev.seats.some((r) => r.seat === this.localSeat && r.stake > 0 && r.gross <= 0 && r.nearmiss)) {
      await this.holdLastDie(faces);
    }

    // IMPACT: the dice land, the layout shakes, a triple drops the stamp
    this.sfx('diceLand');
    this.ctx.fx.shake(0.012, 0.25, { roll: 0.4 });
    for (const m of dice.dice) this.ctx.fx.sparks(m, 6, isTriple(faces) ? GOLD : 0xffffff);
    if (isTriple(faces)) await this.tripleStamp(faces[0], fast);
    this.st.history = [[...faces], ...this.st.history].slice(0, HISTORY_N);
    this.drawHistory();

    // LIGHTS: every winning spot lights; a triple strobes the layout first
    if (!fast && isTriple(faces)) {
      for (let k = 0; k < 4; k++) {
        this.paintPanels(new Set(ALL_SPOTS), RED_TINT);
        await this.wait(0.12);
        this.paintPanels(new Set(ALL_SPOTS), LIT);
        await this.wait(0.12);
      }
    }
    this.paintPanels(new Set(winningSpots(outcomeOf(faces))));
    if (!fast) await this.wait(LIGHTS_S * 0.5);

    // FOLLOW-THROUGH: payout pop text, tier celebration, loss and near-miss beats
    await this.payoutShow(ev, pc);
    this.drawHistory();
    if (this.isLocalOccupant) this.showHud();
  }

  /** The brass TRIPLE stamp drops onto the layout. */
  private async tripleStamp(n: number, fast: boolean): Promise<void> {
    const stamp = this.parts.stamp;
    stamp.visible = true;
    if (fast) { stamp.position.y = TOP + 0.04; }
    else {
      stamp.position.y = 1.1;
      await this.anim(0.35, (k) => { stamp.position.y = 1.1 - (1.1 - (TOP + 0.04)) * k * k; });
    }
    this.sfx('cardSlap', { vol: 0.9 });
    this.ctx.fx.shake(0.03, 0.4, { roll: 0.8 });
    this.ctx.fx.popText(stamp, tr('m.sicbo.rTriple', { n }), GOLD, { dur: 1.4, rise: 0.4 });
    this.ctx.fx.glow(stamp, GOLD, 0.6, 0.8);
  }

  /** The last die rolls to the face one off, holds ~0.4 s, then rolls onto its real face (presentation only). */
  private async holdLastDie(faces: Dice): Promise<void> {
    const { dice, diceRest, diceFrom } = this.parts;
    const i = 2, real = faces[i];
    const off = real > 1 ? real - 1 : real + 1;
    await dice.roll(i, diceFrom, diceRest[i], off, TUMBLE_S * 0.15);
    await this.wait(0.4);
    await dice.roll(i, diceFrom, diceRest[i], real, TUMBLE_S * 0.15);
  }

  /** Rolls the dice to `faces`; the cosmetic tumble is on the local clock. */
  private async tumble(faces: Dice, fast: boolean, scale: number): Promise<void> {
    const { dice, diceRest, diceFrom } = this.parts;
    if (fast) {
      faces.forEach((f, i) => { dice.setFace(i, f); dice.dice[i].position.copy(diceRest[i]); });
      return;
    }
    this.sfx('dice');
    await Promise.all(faces.map((f, i) => dice.roll(i, diceFrom, diceRest[i], f, TUMBLE_S * scale)));
  }

  private async payoutShow(ev: Extract<Ev, { k: 'roll' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'payout';
    const mine = ev.seats.find((r) => r.seat === this.localSeat && r.stake > 0);
    if (mine && this.isLocalOccupant) {
      const net = mine.gross - mine.stake;
      this.seatHud?.result(mine.gross <= 0 ? 'lose' : net > 0 ? 'win' : 'push', net);
    }
    const lamps = this.parts.seatLamps, at = this.parts.cageSpin;
    const winners = [...ev.seats].filter((r) => r.gross > 0).sort((x, y) => y.gross - x.gross);
    const best = winners[0];
    if (best) {
      const tier = juiceTier(best.gross, best.stake);
      void this.celebrate(tier, { amount: best.gross, bet: best.stake, at, lamps: [lamps[best.seat]], fast: pc.fast, restore: () => this.paintLamps() });
    } else {
      this.sfx('coin');
    }
    for (const r of ev.seats) {
      if (r.gross <= 0 && r.stake > 0) {
        if (r.seat === this.localSeat) {
          this.commiserate({ at });
          if (r.nearmiss) void this.nearMiss({ at });
        }
        continue;
      }
      if (r.gross <= 0) continue;
      const seatTile = lamps[r.seat];
      seatTile.blink(8, 1.2);
      if (r.gross === r.stake) this.ctx.fx.popText(seatTile.root, tr('m.sicbo.push'), GREEN, { dur: 1.0, rise: 0.25 });
      else this.ctx.fx.popText(seatTile.root, tr('m.sicbo.win', { n: fmtCoins(r.gross) }), r.gross > r.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
    }
    const [a, b, c] = toDice(ev.faces);
    this.ctx.ui.toast(tr('m.sicbo.rolled', { a, b, c, t: a + b + c }), 'sys');
    if (ev.refunded) this.ctx.ui.toast(tr('m.sicbo.refund'), 'sys');
    if (!pc.fast) await this.wait(PAYOUT_S * 0.5);
  }

  // ── snapshots: public layout state only ───────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return { phase: this.st.phase, layouts: this.st.layouts.map((l) => [...l]), ready: [...this.st.ready], history: this.st.history.map((h) => [...h]) };
  }
  applySnapshot(sn: Snap): void {
    this.st = { phase: sn.phase, layouts: sn.layouts.map((l) => [...l]), ready: [...sn.ready], history: sn.history.map((h) => [...h]) };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.seatHud?.show();
      this.showHud();
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
  override onLang(): void { this.paintLabels(); this.drawHistory(); this.paintChips(); if (this.isLocalOccupant) this.showHud(); }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private paintLamps(): void {
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
    this.parts.phaseLamp.setOn(this.st.phase !== 'idle');
  }

  /** Lit panels (`lit` spots take `tint`), the rest stay milk-glass dim. One attribute write per frame. */
  private paintPanels(lit: ReadonlySet<string>, tint: [number, number, number] = LIT): void {
    const attr = this.parts.panels.geometry.getAttribute('color') as THREE.BufferAttribute;
    CELLS.forEach((c, i) => {
      const col = lit.has(c.spot) ? tint : DIM;
      for (let k = 0; k < 4; k++) attr.setXYZ(i * 4 + k, col[0], col[1], col[2]);
    });
    attr.needsUpdate = true;
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

  private spotText(spot: string): string {
    const [kind, arg = ''] = spot.split(/:(.*)/s);
    switch (kind) {
      case 'small': case 'big': case 'odd': case 'even': return this.t(kind);
      case 'anytriple': return this.t('anyTriple');
      case 'total': case 'single': return arg;
      case 'double': return arg + arg;
      case 'triple': return arg + arg + arg;
      case 'combo': return arg.replace('-', '·');
      default: return spot;
    }
  }

  private paintLabels(): void {
    const cv = this.parts.labelCanvas;
    const g = cv.getContext('2d');
    if (!g) return;
    drawLayoutLabels(g, cv.width, cv.height, (spot) => this.spotText(spot));
    this.parts.labelTex.needsUpdate = true;
  }

  private paintDiceRest(): void {
    this.parts.dice.dice.forEach((m, i) => m.position.copy(this.parts.diceRest[i]));
  }

  private paintAll(): void {
    this.paintLamps();
    this.paintChips();
    this.paintPanels(new Set());
    this.paintLabels();
    this.drawHistory();
    this.paintDiceRest();
    this.parts.stamp.visible = false;
    this.parts.cageSpin.rotation.x = 0;
  }

  /** Last 20 rolls as bars: height = total, gold = triple, blue = small, red = big. */
  private drawHistory(): void {
    this.parts.history.draw((g, s) => {
      g.fillStyle = '#080a10';
      g.fillRect(0, 0, s.w, s.h);
      this.st.history.forEach((f, i) => {
        const total = f[0] + f[1] + f[2];
        const bar = Math.max(2, Math.round((total / 18) * (s.h - 2)));
        g.fillStyle = isTriple(toDice(f)) ? '#ffd040' : total <= 10 ? '#5ab0ff' : '#ff7a5a';
        g.fillRect(i * 6 + 1, s.h - bar, 5, bar);
      });
    });
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

  private ruleLines(): Txt[] {
    return [
      { k: 'm.sicbo.hR1' },
      { k: 'm.sicbo.hR2' },
      { k: 'm.sicbo.hR3' },
      { k: 'm.sicbo.hR4' },
      { k: 'm.sicbo.hR5', v: { quick: `${this.k('n1')}-${this.k('n6')}` } },
      { k: 'm.sicbo.hR6', v: { rebet: this.k('double') } },
    ];
  }

  /** Banner, key numbers and the valid controls only. Only while the local player sits at the layout. */
  private showHud(): void {
    const sh = this.seatHud, seat = this.localSeat;
    if (!sh || seat < 0) return;
    const st = this.st, open = st.phase === 'open';
    const ready = st.ready[seat];
    const betting = open && !ready;
    const layout = this.myBets().reduce((s, b) => s + b.a, 0);
    sh.goal({ k: 'm.sicbo.hGoal' });

    // STATE: what phase, and what you have to do
    if (st.phase === 'idle') sh.state({ k: 'm.sicbo.hWait' }, 'neutral');
    else if (open && ready) sh.state({ k: 'm.sicbo.hReady' }, 'cyan');
    else if (open) {
      const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
      sh.state({ k: 'm.sicbo.hBet' }, 'gold', left > 0 ? { k: 'm.sicbo.hSecs', v: { n: left } } : undefined);
    }
    else if (st.phase === 'lock') sh.state({ k: 'm.sicbo.hLock' }, 'warn');
    else if (st.phase === 'roll') sh.state({ k: 'm.sicbo.hRoll' }, 'cyan');
    else if (st.phase === 'payout') sh.state({ k: 'm.sicbo.hPay' }, 'neutral');
    else sh.state({ k: 'm.sicbo.hClear' }, 'neutral');

    // KEY NUMBERS: chip, your layout, last roll, balance
    const nums: HudNumber[] = [{ label: { k: 'm.sicbo.hNBet' }, value: fmtCoins(this.bet), tone: 'gold' }];
    if (layout > 0) nums.push({ label: { k: 'm.sicbo.hNLayout' }, value: fmtCoins(layout), tone: 'cyan' });
    const last = st.history[0];
    if (last && last.length === 3) {
      const triple = last[0] === last[1] && last[1] === last[2];
      const sum = last[0] + last[1] + last[2];
      nums.push({ label: { k: 'm.sicbo.hNLast' }, value: `${last.join('-')} = ${sum}`, tone: triple ? 'warn' : 'neutral' });
    }
    nums.push({ label: { k: 'm.sicbo.hNBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    if (betting || st.phase === 'idle') ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.sicbo.hCBet' }, action: 'betUp' });
    if (betting && layout > 0) {
      const many = this.humans().length >= 2;
      ctrl.push({ key: this.k('confirm'), label: { k: many ? 'm.sicbo.hCReady' : 'm.sicbo.hCRoll' }, action: 'confirm', primary: true });
      ctrl.push({ key: this.k('clear'), label: { k: 'm.sicbo.hCClear' }, action: 'clear' });
    }
    if (betting && this.lastMine.length > 0) ctrl.push({ key: this.k('double'), label: { k: 'm.sicbo.hCRebet' }, action: 'double' });
    if (betting) ctrl.push({ key: `${this.k('n1')}-${this.k('n6')}`, label: { k: 'm.sicbo.hCSingle' }, action: 'n1' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.sicbo.hCRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.sicbo.hCLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

}

export const def: MachineDef = {
  id: 'sicbo',
  category: 'dice',
  slotSize: 'L',
  zone: 'boiler',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: 1, maxBet: 500, betSteps: [1, 5, 10, 25, 50, 100, 250, 500],
  maxPayoutMult: 201,
  rtp: 0.972,
  actionCost: 1,
  idleYield: 0.53,
  tags: ['table', 'dice', 'sicbo'],
  headless: playHeadless,
  modHooks: {
    'm.sicbo.dieWeight.n': 'int add to one face weight on all three dice (base 100), n = 1..6',
    'm.sicbo.singleTripleAdd': 'int added to the 12:1 three-match of a single-die bet',
    'm.sicbo.totalPayAdd.t': 'int added to the odds of total t (4..17)',
    'm.sicbo.tripleShield': 'bool: Small / Big / Odd / Even push instead of losing on a triple',
    luck: 'solo only: reroll a losing layout once with p = luck/100; shared: losing seats refunded with the same gate',
  },
  strings: STRINGS,
};
