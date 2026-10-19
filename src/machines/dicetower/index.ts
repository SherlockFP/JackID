/**
 * Dice Tower "Zar Kulesi" (`dicetower`) — shared TableBase device, 4 seats around a round felt (MACHINES_machines §13).
 *
 * Host timeline (every peer presents): IDLE (no human seated) → BETTING 10 s (ends early when every seated human presses
 * Ready; chips are public, the host keeps the book) → LOCK 0.5 s (fairness hash published, fresh stakes debited) → DROP
 * (the shooter presses Space; auto-drop after 6 s, bots after 1 s) → RESULT (dice resolved and paid at once on the host,
 * 2.4 s tumble + 3 s show) → next BETTING. Winning spots can ride up to three rolls under the Parlay charm; their winnings
 * stay on the felt as virtual chips and are paid when the chain ends.
 *
 * Shape of the code (the TableBase pattern of craps / pisti): HOST ONLY (`hs`) holds the books, the round seed, the
 * shooter and every timer; EVERY PEER (`present`) is the only place the visible state (`st`) and the pools change.
 * The dice are a pure function of the seed (rules.ts), so the seed revealed at RESULT replays the exact roll.
 *
 * Juice: anticipation (knocks down the tower, the lamp flips), action (dice rattle out of the funnel), impact (the flip
 * digits, the pegs, doubles light the slits, snake eyes and boxcars pop the skull), follow-through (pops, celebrations).
 */
import * as THREE from 'three';
import type { ChipValue, Kit } from '@/kit/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { isBot, type PlayerId } from '@/core/types';
import { createRng } from '@/core/rng';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import {
  buildModel, DICE_REST, LAYOUT_CZ, SEATS as SEAT_COUNT, SPOT_XZ, TOP, spotAt, drawLayout, type DicetowerParts,
} from './model';
import {
  CHIP_STEP, SPOTS, SPOTS_MAX, SPOT_MAX, commitOf, defaultMods, isValidSpot, luckP, playHeadless,
  rollRound, settleSpot, type Mods, type RideState,
} from './rules';
import { STRINGS } from './dicetower.strings';

// ── timing (seconds, sim clock) and table limits ─────────────────────────────────────────────────
const BET_S = 10;          // betting window (ends early when every seated human is ready)
const LOCK_S = 0.5;        // fairness hash out, stakes debited
const DROP_S = 6;          // a human shooter has this long before the auto-drop
const BOT_DROP_S = 1.0;    // bots and absent shooters drop after this
const TUMBLE_S = 2.4;      // dice in the air (presentation)
const RESULT_S = 3.0;      // result show
const SEATS = SEAT_COUNT;
const BOT_SPOTS_MAX = 2;   // a bot places one or two spots per roll

// ── contract types (aliases so they are assignable to `Json`) ───────────────────────────────────
type Phase = 'idle' | 'betting' | 'lock' | 'drop' | 'result';
type Bets = Array<[string, number]>;
type Ev =
  | { k: 'phase'; p: Phase; endsAt: number; shooter: number }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'lay'; seat: number; bets: Bets; rides: string[] }
  | { k: 'lock'; fair: string; seats: number[] }
  | { k: 'drop'; shooter: number; d1: number; d2: number; path: number }
  | { k: 'result'; d1: number; d2: number; seats: Array<{ p: number; stake: number; gross: number }>; seed: number };
type Act =
  | { k: 'chip'; spot: string; v: number }        // v = signed coins: +selected chip on the spot, −selected chip off it
  | { k: 'ready'; on: boolean }
  | { k: 'drop' }
  | { k: 'repeat' }
  | { k: 'clear' };

/** What every peer knows (public felt state). Mutated only in `present`. */
type Pub = {
  phase: Phase; endsAt: number; shooter: number; ready: boolean[];
  lay: Bets[]; rides: string[][]; hist: number[]; fair: string; last: number[];
};
/** HOST-ONLY authority: books, riding chains, the round seed, timers (secret: the seed until RESULT). */
type HostSnap = {
  phase: Phase; timer: number; shooter: number; ready: boolean[];
  books: Array<Record<string, number>>; rides: Array<Record<string, RideState>>;
  roundPid: Array<number | null>; lastBook: Array<Record<string, number>>; seed: number;
};
type Snap = { st: Pub; h: HostSnap | null };

const emptyLay = (): Bets[] => Array.from({ length: SEATS }, () => [] as Bets);
const noRides = (): string[][] => Array.from({ length: SEATS }, () => [] as string[]);
const falses = (): boolean[] => new Array<boolean>(SEATS).fill(false);
const freshPub = (): Pub => ({
  phase: 'idle', endsAt: 0, shooter: -1, ready: falses(), lay: emptyLay(), rides: noRides(), hist: [], fair: '', last: [],
});
const freshHost = (): HostSnap => ({
  phase: 'idle', timer: 0, shooter: -1, ready: falses(),
  books: Array.from({ length: SEATS }, () => ({} as Record<string, number>)),
  rides: Array.from({ length: SEATS }, () => ({} as Record<string, RideState>)),
  roundPid: new Array<number | null>(SEATS).fill(null),
  lastBook: Array.from({ length: SEATS }, () => ({} as Record<string, number>)),
  seed: 0,
});

/** Chip stack for an amount, greedy largest-first (the pool knows 1, 5, 10, 25, 100 …). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [100, 25, 10, 5, 1] as const) while (left >= v && out.length < 40) { out.push(v); left -= v; }
  return out;
}
const sumOf = (bets: Bets): number => bets.reduce((s, [, a]) => s + a, 0);
const sumBook = (b: Record<string, number>): number => Object.values(b).reduce((s, v) => s + v, 0);
/** Fresh stake in a book: every spot that is not riding. */
const freshOf = (b: Record<string, number>, r: Record<string, RideState>): number =>
  Object.keys(b).reduce((s, k) => s + (r[k] ? 0 : b[k]), 0);

const GOLD = 0xffd040, GREEN = 0x7dff7a, RED = 0xff4a3a, ORANGE = 0xff8020, BONE = 0xe8e0c8;
const TOTAL_TINT = (n: number): number => (n === 7 ? RED : n === 2 || n === 12 ? GOLD : BONE);

export default class Dicetower extends TableBase<DicetowerParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Pub = freshPub();
  /** HOST ONLY authority state. */
  private hs: HostSnap = freshHost();

  protected createModel(kit: Kit): MachineModel<DicetowerParts> { return buildModel(kit, this.modelOpts); }

  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    const seat = this.localSeat;
    switch (e.action) {
      case 'betUp': case 'n2': this.stepBet(1); this.sfx('click'); this.showHud(); break;     // X / wheel up
      case 'betDown': case 'n1': this.stepBet(-1); this.sfx('click'); this.showHud(); break;  // Z / wheel down
      case 'betMax': this.maxBet(); this.sfx('click'); this.showHud(); break;
      case 'confirm':                                                                          // Space
        if (e.repeat || seat < 0) break;
        if (this.st.phase === 'drop') {
          if (this.st.shooter === seat) this.act({ k: 'drop' });
          else this.toast(tr('m.dicetower.notShooter'), 'warn');
        } else if (this.st.phase === 'betting') this.act({ k: 'ready', on: !this.st.ready[seat] });
        break;
      case 'double': if (!e.repeat && seat >= 0) this.act({ k: 'repeat' }); break;            // R
      case 'clear': if (seat >= 0) this.act({ k: 'clear' }); break;                          // Backspace
      case 'help': if (!e.repeat) this.seatHud?.rules(this.rulesLines(), { k: 'm.dicetower.rulesTitle' }); break;                              // H
      default: break;
    }
  }

  /** LMB adds one selected chip on the spot under the pointer; RMB takes one back. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || this.localSeat < 0) return;
    const hit = this.pick([this.parts.layout]);
    if (!hit) return;
    const local = this.parts.layout.worldToLocal(hit.point.clone());
    const spot = spotAt(local.x, LAYOUT_CZ - local.y);   // the print plane is turned −90° about X
    if (!spot) return;
    this.act({ k: 'chip', spot, v: e.button === 2 ? -this.bet : this.bet });
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    switch (a.k) {
      case 'chip': this.onChip(pid, seat, a.spot, a.v, rid); break;
      case 'ready':
        if (hs.phase === 'betting' && hs.ready[seat] !== a.on) {
          hs.ready[seat] = a.on;
          void this.emit({ k: 'ready', seat, on: a.on });
        }
        break;
      case 'drop':
        if (hs.phase !== 'drop') this.nak(pid, rid, 'm.dicetower.busy');
        else if (hs.shooter !== seat) this.nak(pid, rid, 'm.dicetower.notShooter');
        else this.resolveRoll();
        break;
      case 'repeat': this.onRepeat(pid, seat, rid); break;
      case 'clear': this.onClear(pid, seat, rid); break;
    }
  }

  private onChip(pid: PlayerId, seat: number, spot: string, v: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'betting') { this.nak(pid, rid, 'm.dicetower.closed'); return; }
    if (!isValidSpot(spot)) { this.nak(pid, rid, 'm.dicetower.badSpot'); return; }
    if (!Number.isInteger(v) || Math.abs(v) < CHIP_STEP || Math.abs(v) > SPOT_MAX || v % CHIP_STEP !== 0) return;
    const book = hs.books[seat];
    if (hs.rides[seat][spot]) { this.nak(pid, rid, 'm.dicetower.riding'); return; }
    const cur = book[spot] ?? 0;
    const next = Math.max(0, Math.min(SPOT_MAX, cur + v));
    if (next === cur) { if (v > 0) this.nak(pid, rid, 'm.dicetower.spotMax'); return; }   // removing from an empty spot is a no-op
    if (cur === 0 && Object.keys(book).length >= SPOTS_MAX) { this.nak(pid, rid, 'm.dicetower.spotsMax'); return; }
    if (next === 0) delete book[spot]; else book[spot] = next;
    this.emitLay(seat);
  }

  private onRepeat(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'betting') { this.nak(pid, rid, 'm.dicetower.closed'); return; }
    const book = hs.books[seat];
    const last = hs.lastBook[seat];
    if (!Object.keys(last).length) { this.nak(pid, rid, 'm.dicetower.nothing'); return; }
    for (const spot of Object.keys(last)) {
      if (book[spot] === undefined && Object.keys(book).length < SPOTS_MAX) book[spot] = last[spot];
    }
    this.emitLay(seat);
  }

  private onClear(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'betting') { this.nak(pid, rid, 'm.dicetower.closed'); return; }
    const book = hs.books[seat];
    for (const spot of Object.keys(book)) if (!hs.rides[seat][spot]) delete book[spot];   // riding chains stay
    this.emitLay(seat);
  }

  /** HOST: publish one seat's public book (riding amounts included) and its riding spots. */
  private emitLay(seat: number): void {
    const hs = this.hs;
    void this.emit({ k: 'lay', seat, bets: Object.entries(hs.books[seat]), rides: Object.keys(hs.rides[seat]) });
  }

  // ── HOST: the round ──────────────────────────────────────────────────────────────────────────────
  private endsIn(sec: number): number { return this.ctx.net.hostTime() + sec * 1000; }

  /** HOST: BETTING window; bots put one or two spots on the felt; the 10 s countdown is shown to everyone. */
  private startBetting(): void {
    const hs = this.hs;
    hs.phase = 'betting';
    hs.timer = BET_S;
    hs.ready = falses();
    for (const { seat, pid } of this.seated()) {
      if (!isBot(pid)) continue;
      const book = hs.books[seat];
      const n = this.hostRng.int(1, BOT_SPOTS_MAX);
      for (let i = 0; i < n && Object.keys(book).length < SPOTS_MAX; i++) {
        const spot = SPOTS[this.hostRng.int(0, SPOTS.length - 1)];
        if (!hs.rides[seat][spot]) book[spot] = (book[spot] ?? 0) + CHIP_STEP * this.hostRng.int(1, 3);
      }
      this.emitLay(seat);
    }
    void this.emit({ k: 'phase', p: 'betting', endsAt: this.endsIn(BET_S), shooter: -1 });
    void this.countdown(BET_S, 'bet');
  }

  private endBetting(): void {
    this.cancelCountdown();
    const hs = this.hs;
    if (!hs.books.some((b) => Object.keys(b).length > 0)) { this.startBetting(); return; }
    this.lockRound();
  }

  /** HOST: debit the fresh stakes, publish the fairness hash, pick the shooter. */
  private lockRound(): void {
    const hs = this.hs;
    const seats: number[] = [];
    for (let s = 0; s < SEATS; s++) {
      const book = hs.books[s];
      if (!Object.keys(book).length) continue;
      const pid = this.seats[s];
      const fresh = freshOf(book, hs.rides[s]);
      if (fresh > 0 && !this.chargeSeat(s, fresh, pid)) {
        for (const spot of Object.keys(book)) if (!hs.rides[s][spot]) delete book[spot];   // could not pay: those chips go back
        this.emitLay(s);
        if (!Object.keys(book).length) continue;
      }
      hs.roundPid[s] = pid ?? hs.roundPid[s];
      hs.lastBook[s] = Object.fromEntries(Object.entries(book).filter(([k]) => !hs.rides[s][k]));
      seats.push(s);
    }
    if (!seats.length) { this.startBetting(); return; }
    hs.seed = this.hostRng.int(1, 0x7fffffff);
    hs.shooter = this.nextShooter(hs.shooter, seats);
    hs.phase = 'lock';
    hs.timer = LOCK_S;
    void this.emit({ k: 'phase', p: 'lock', endsAt: this.endsIn(LOCK_S), shooter: hs.shooter });
    void this.emit({ k: 'lock', fair: commitOf(hs.seed), seats });
  }

  /** HOST: the next seat (after the last shooter) that has chips on the felt; the table starts at seat 0. */
  private nextShooter(after: number, seats: number[]): number {
    if (!seats.length) return -1;
    for (let k = 1; k <= SEATS; k++) {
      const s = (after + k + SEATS) % SEATS;
      if (seats.includes(s)) return s;
    }
    return seats[0];
  }

  private enterDrop(): void {
    const hs = this.hs;
    const pid = hs.shooter >= 0 ? this.seats[hs.shooter] : null;
    hs.phase = 'drop';
    hs.timer = pid !== null && pid !== undefined && !isBot(pid) ? DROP_S : BOT_DROP_S;
    void this.emit({ k: 'phase', p: 'drop', endsAt: this.endsIn(hs.timer), shooter: hs.shooter });
  }

  /** Charm modifiers that shape the dice and the pays (host). */
  private mods(): Mods {
    const m = defaultMods();
    m.fieldTwelve = this.mod('m.dicetower.fieldBoost', 0) > 0 ? 1 : 0;
    m.sevenAdd = this.mod('m.dicetower.sevenPay', 0) > 0 ? 0.5 : 0;
    return m;
  }

  /** HOST: roll the dice from the round seed, settle and pay every seat at once, then announce the result. */
  private resolveRoll(): void {
    const hs = this.hs;
    if (hs.phase !== 'drop') return;
    const mods = this.mods();
    const rr = rollRound(hs.seed, mods);
    const [d1, d2] = rr.d;
    const pair = d1 === d2;
    const parlay = this.mod('m.dicetower.parlay', 0) > 0;
    const pct = Math.max(0, this.mod('m.dicetower.shooterBonus', 0));
    const p = luckP(this.luck());
    const seatsOut: Array<{ p: number; stake: number; gross: number }> = [];
    for (let s = 0; s < SEATS; s++) {
      const book = hs.books[s];
      const spots = Object.keys(book);
      if (!spots.length) continue;
      let gross = 0, stake = 0;
      const nextBook: Record<string, number> = {};
      const nextRide: Record<string, RideState> = {};
      for (const spot of spots) {
        const res = settleSpot(spot, book[spot], hs.rides[s][spot] ?? null, {
          d: rr.d, m: mods, refund: rr.gates[s] < p, shooter: s === hs.shooter, shooterPct: pct, parlay,
        });
        gross += res.gross;
        stake += res.settled;
        if (res.carry > 0 && res.ride) { nextBook[spot] = res.carry; nextRide[spot] = res.ride; }
      }
      const pid = hs.roundPid[s];
      if (gross > 0 || stake > 0) {
        const tags = pair ? ['doubles'] : [];
        this.paySeat(s, gross, { bet: stake, tags }, pid);
        seatsOut.push({ p: s, stake, gross });
      }
      hs.books[s] = nextBook;
      hs.rides[s] = nextRide;
    }
    hs.phase = 'result';
    hs.timer = TUMBLE_S + RESULT_S;
    void this.emit({ k: 'phase', p: 'result', endsAt: this.endsIn(hs.timer), shooter: hs.shooter });
    void this.emit({ k: 'drop', shooter: hs.shooter, d1, d2, path: rr.path });
    void this.emit({ k: 'result', d1, d2, seats: seatsOut, seed: hs.seed });
    for (let s = 0; s < SEATS; s++) if (Object.keys(hs.books[s]).length || this.st.lay[s].length) this.emitLay(s);
  }

  // ── host tick ────────────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'idle':
        if (this.humans().length) this.startBetting();
        return;
      case 'betting': {
        if (!this.humans().length) { this.goIdle(); return; }
        hs.timer -= dt;
        const allReady = this.humans().every(({ seat }) => hs.ready[seat]);
        if (hs.timer <= 0 || allReady) this.endBetting();
        return;
      }
      case 'lock':
        hs.timer -= dt;
        if (hs.timer <= 0) this.enterDrop();
        return;
      case 'drop':
        hs.timer -= dt;
        if (hs.timer <= 0) this.resolveRoll();
        return;
      case 'result':
        hs.timer -= dt;
        if (hs.timer <= 0) { if (this.humans().length) this.startBetting(); else this.goIdle(); }
        return;
    }
  }

  private goIdle(): void {
    this.cancelCountdown();
    this.hs.phase = 'idle';
    void this.emit({ k: 'phase', p: 'idle', endsAt: 0, shooter: -1 });
  }

  // ── seats ───────────────────────────────────────────────────────────────────────────────────────
  onOccupy(pid: PlayerId, _seat: number, local: boolean): void {
    if (this.isHost && this.hs.phase === 'idle' && !isBot(pid)) this.startBetting();
    this.paintLamps();
    if (local) {
      this.parts.stools.forEach((s) => { s.visible = false; });   // seat standard: the chrome stool bases stay out of the seat view
      this.sfx('chime', { vol: 0.5 });
      this.seatHud?.show();
      this.showHud();
    }
  }

  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (local) this.parts.stools.forEach((s) => { s.visible = true; });
    if (this.isHost) {
      const hs = this.hs;
      if (hs.phase === 'betting') {
        // nothing debited yet: the seat's fresh chips go back; riding chains stay until they end
        const keep = hs.rides[seat];
        hs.books[seat] = Object.fromEntries(Object.entries(hs.books[seat]).filter(([k]) => keep[k]));
        hs.ready[seat] = false;
        this.emitLay(seat);
        if (!this.humans().length) this.goIdle();
      } else if (hs.phase === 'drop' && hs.shooter === seat) {
        hs.timer = Math.min(hs.timer, BOT_DROP_S);
      }
    }
    this.paintLamps();
    if (local) { this.hud(null); this.seatHud?.hide(); }
  }

  override onLang(): void { this.paintAll(); if (this.isLocalOccupant) this.showHud(); }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'phase':
        this.st.phase = ev.p;
        this.st.endsAt = ev.endsAt;
        this.st.shooter = ev.shooter;
        if (ev.p === 'betting') { this.st.ready = falses(); this.st.last = []; }
        this.paintLamps();
        this.drawBoard();
        this.showHud();
        return;
      case 'ready':
        this.st.ready[ev.seat] = ev.on;
        this.showHud();
        return;
      case 'lay':
        this.st.lay[ev.seat] = ev.bets;
        this.st.rides[ev.seat] = ev.rides;
        this.paintChips();
        this.drawMeters();
        if (pc.local && ev.seat === this.localSeat) this.sfx('chip');
        if (ev.seat === this.localSeat) this.showHud();
        return;
      case 'lock':
        this.st.fair = ev.fair;
        this.parts.fairLamp.setOn(true);
        this.sfx('stamp', { vol: 0.8 });
        this.drawBoard();
        return;
      case 'drop':
        await this.dropShow(ev, pc);
        return;
      case 'result':
        await this.resultShow(ev, pc);
        return;
    }
  }

  /** Anticipation → action: baffle knocks descend the tower (pan follows the height), the dice fly out of the funnel. */
  private async dropShow(ev: Extract<Ev, { k: 'drop' }>, pc: PresentCtx): Promise<void> {
    const { dice, diceFrom, tower } = this.parts;
    this.st.last = [];
    this.drawBoard();
    this.sfx('dice');
    if (!pc.fast) {
      const rng = createRng(ev.path);
      for (let i = 0; i < 4; i++) {
        const t = 0.35 + i * 0.5 + rng.next() * 0.15;
        this.ctx.timers.after(t, () => this.sfx('ballBounce', { pos: tower, pitch: -6 + i * 2, vol: 0.7 }));
      }
    }
    const dur = pc.fast ? 0.1 : TUMBLE_S;
    const from = (i: number): THREE.Vector3 => diceFrom.clone().add(new THREE.Vector3(i ? 0.02 : -0.02, 0, 0));
    await Promise.all([
      dice.roll(0, from(0), new THREE.Vector3(...DICE_REST[0]), ev.d1, dur),
      dice.roll(1, from(1), new THREE.Vector3(...DICE_REST[1]), ev.d2, dur),
    ]);
    this.sfx('diceLand');
    if (!pc.fast) await this.wait(0.2);
  }

  /** Impact → follow-through: flip digits, pegs, slits on doubles, skull on snake eyes or boxcars, pays per seat. */
  private async resultShow(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    const total = ev.d1 + ev.d2;
    const pair = ev.d1 === ev.d2;
    const snake = ev.d1 === 1 && ev.d2 === 1, boxcars = ev.d1 === 6 && ev.d2 === 6;
    this.st.last = [ev.d1, ev.d2];
    this.st.hist = [total, ...this.st.hist].slice(0, 12);
    this.paintPegs();
    this.drawBoard();
    this.sfx('bell', { vol: 0.9 });
    if (pair) {
      this.setSlits(true);
      this.ctx.timers.after(2, () => this.setSlits(false));
    }
    if (snake || boxcars) this.popSkull(pc.fast);
    for (const s of ev.seats) {
      const lamp = this.parts.seatLamps[s.p];
      const won = s.gross > s.stake;
      const tier = juiceTier(s.gross, s.stake, pair ? ['doubles'] : []);
      if (s.gross > 0) {
        this.ctx.fx.popText(lamp.root, tr(won ? 'm.dicetower.win' : 'm.dicetower.lose', { n: fmtCoins(won ? s.gross - s.stake : s.stake) }), won ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
      }
      if (s.p === this.localSeat && s.stake > 0) {
        if (s.gross > s.stake) this.seatHud?.result('win', s.gross - s.stake);
        else if (s.gross === s.stake) this.seatHud?.result('push');
        else this.seatHud?.result('lose', s.gross - s.stake);
      }
      if (s.p === this.localSeat) {
        if (won) void this.celebrate(tier, { amount: s.gross - s.stake, fast: pc.fast, lamps: [lamp], restore: () => this.paintLamps() });
        else if (s.stake > 0) this.commiserate({ amount: s.stake - s.gross, at: this.parts.tower });
      }
    }
    if (!pc.fast) await this.wait(RESULT_S);
  }

  private setSlits(on: boolean): void {
    for (const m of this.parts.slits) (m.material as THREE.MeshLambertMaterial).emissive?.setHex(on ? ORANGE : 0x000000);
  }

  private popSkull(fast: boolean): void {
    const sk = this.parts.skullCuckoo;
    this.sfx('whisper', { vol: 0.8 });
    if (fast) return;
    void this.anim(1.4, (k) => {
      const pop = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      sk.position.y = 1.70 + 0.06 * pop;
    });
  }

  private paintLamps(): void {
    const p = this.st.phase;
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null || this.st.shooter === s));
    this.parts.phaseLamp.setOn(p !== 'idle');
    this.parts.phaseLamp.setColor(p === 'drop' ? ORANGE : p === 'betting' ? GOLD : 0x4a3a10);
    this.parts.fairLamp.setOn(p === 'lock' || p === 'drop' || p === 'result');
  }

  private paintChips(): void {
    const { chips } = this.parts;
    chips.clear();
    for (const bets of this.st.lay) {
      for (const [spot, amount] of bets) {
        const xz = SPOT_XZ[spot];
        if (!xz) continue;
        const at = new THREE.Vector3(xz[0], TOP + 0.012, xz[1]);
        for (const c of chipsFor(amount)) {
          if (chips.count >= 190) return;
          chips.add(c, at);
        }
      }
    }
  }

  private paintPegs(): void {
    this.parts.historyPegs.forEach((l, i) => {
      const n = this.st.hist[i];
      l.setOn(n !== undefined);
      if (n !== undefined) l.setColor(TOTAL_TINT(n));
    });
  }

  private drawBoard(): void {
    const st = this.st;
    const label = st.last.length === 2 ? String(st.last[0] + st.last[1]) : '';
    this.parts.resultBoard.draw((g, w) => {
      g.fillStyle = '#120806';
      g.fillRect(0, 0, w.w, w.h);
      w.text(label || (st.phase === 'betting' ? tr('m.dicetower.boardBet') : st.phase === 'drop' ? tr('m.dicetower.boardRoll') : '--'), Math.round(w.w / 2), 8, {
        font: 'px5', scale: 3, color: st.phase === 'drop' ? '#ff8020' : '#ffd040', align: 'center',
      });
    });
    this.drawMeters();
  }

  private drawMeters(): void {
    this.parts.railMeters.forEach((m, s) => {
      const total = sumOf(this.st.lay[s]);
      m.draw((g, w) => {
        g.fillStyle = '#070707';
        g.fillRect(0, 0, w.w, w.h);
        w.text(total > 0 ? fmtCoins(total) : '-', 3, 6, { font: 'px5', color: '#e8c060', align: 'left' });
      });
    });
  }

  private paintLayout(): void {
    drawLayout(this.parts.layoutCanvas, (k, n) => (k === 'lay.exact' ? this.t('lay.exact', { n: n ?? 0 }) : this.t(k)));
    this.parts.layoutTex.needsUpdate = true;
  }

  private paintAll(): void {
    this.paintLayout();
    this.paintLamps();
    this.paintChips();
    this.paintPegs();
    this.drawBoard();
  }

  // ── local HUD and help ──────────────────────────────────────────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private rulesLines(): Txt[] { return ['rule1', 'rule2', 'rule3', 'rule4'].map((k) => ({ k: 'm.dicetower.' + k })); }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the tower. */
  private showHud(): void {
    const sh = this.seatHud;
    const seat = this.localSeat;
    if (!sh || seat < 0) return;
    const st = this.st, ph = st.phase;
    const ready = st.ready[seat] === true;
    const myDrop = ph === 'drop' && st.shooter === seat;
    const last = st.last.length === 2 ? st.last : null;
    const total = last ? last[0] + last[1] : 0;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.dicetower.goal' });

    // STATE: whose turn, what phase
    switch (ph) {
      case 'idle': sh.state({ k: 'm.dicetower.stIdle' }, 'neutral', { k: 'm.dicetower.stIdleSub' }); break;
      case 'betting':
        if (ready) sh.state({ k: 'm.dicetower.stReady' }, 'good', { k: 'm.dicetower.stReadySub' });
        else sh.state({ k: 'm.dicetower.stBet' }, 'gold', { k: 'm.dicetower.stBetSub', v: { ready: this.k('confirm') } });
        break;
      case 'lock': sh.state({ k: 'm.dicetower.stLock' }, 'warn', { k: 'm.dicetower.stLockSub' }); break;
      case 'drop':
        if (myDrop) sh.state({ k: 'm.dicetower.stYouDrop' }, 'good', { k: 'm.dicetower.stYouDropSub', v: { drop: this.k('confirm') } });
        else sh.state({ k: 'm.dicetower.stWaitDrop' }, 'cyan', { k: 'm.dicetower.stWaitDropSub' });
        break;
      case 'result':
        sh.state(last ? { k: 'm.dicetower.stResult', v: { n: total } } : { k: 'm.dicetower.stRoll' }, 'gold', { k: 'm.dicetower.stResultSub' });
        break;
      default: sh.state({ k: 'm.dicetower.stRoll' }, 'neutral');
    }

    // KEY NUMBERS: your bets on the felt, chip size, last roll, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.dicetower.nBets' }, value: fmtCoins(sumOf(st.lay[seat] ?? [])), tone: 'gold' });
    nums.push({ label: { k: 'm.dicetower.nChip' }, value: fmtCoins(this.bet), tone: 'cyan' });
    if (last) nums.push({ label: { k: 'm.dicetower.nLast' }, value: `${last[0]} + ${last[1]} = ${total}`, tone: total === 7 ? 'bad' : 'neutral' });
    nums.push({ label: { k: 'm.dicetower.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys the tower really reads
    if (ph === 'betting') {
      ctrl.push({
        key: this.k('confirm'), label: { k: ready ? 'm.dicetower.cUnready' : 'm.dicetower.cReady' }, action: 'confirm', primary: !ready,
      });
      ctrl.push({ key: this.k('double'), label: { k: 'm.dicetower.cRepeat' }, action: 'double' });
      ctrl.push({ key: this.k('clear'), label: { k: 'm.dicetower.cClear' }, action: 'clear' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.dicetower.cChip' }, action: 'betUp' });
    }
    if (myDrop) ctrl.push({ key: this.k('confirm'), label: { k: 'm.dicetower.cDrop' }, action: 'confirm', primary: true });
    ctrl.push({ key: this.k('help'), label: { k: 'm.dicetower.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.dicetower.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

}

export { playHeadless };

export const def: MachineDef = {
  id: 'dicetower',
  category: 'dice',
  slotSize: 'L',
  zone: 'boiler',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: CHIP_STEP, maxBet: SPOT_MAX, betSteps: [2, 4, 10, 20, 50, 100, 200],
  // host sanity cap: EXACT 2/12 gross 32 × the parlay rides (1.05³) and the Shooter bonus stays under 48 × stake
  maxPayoutMult: 48,
  rtp: 0.91,
  actionCost: 1,
  idleYield: 0.18,
  tags: ['table', 'dice', 'social'],
  headless: playHeadless,
  modHooks: {
    'm.dicetower.fieldBoost': 'FIELD 12 pays 3:1 (gross 4) when > 0',
    'm.dicetower.sevenPay': 'LUCKY 7 pays +1:2 (gross 6) when > 0',
    'm.dicetower.parlay': 'a winning spot rides up to three rolls, +5 % per ride, paid when the chain ends',
    'm.dicetower.shooterBonus': 'percent added to your winnings on rolls where you are the shooter',
  },
  strings: STRINGS,
};
