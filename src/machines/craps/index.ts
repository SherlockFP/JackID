/**
 * Craps "The Bone Pit" (`craps`) — shared TableBase device, 8 rail spots, rotating shooter (MACHINES_tables §7).
 *
 * Host timeline (every peer presents): COMEOUT or POINT window (solo: until the shooter throws; shared: 12 s / 8 s, then an
 * automatic throw) → THROW (dice resolved on the host, stakes paid at once so leaving mid-roll never loses money) → ROLL
 * → CALL (the Hook calls the total) → SETTLE (chips paid or taken per seat) → next window. Bets persist across rolls
 * (Pass, Come, odds, place, hardways), so a seat's layout lives in its book on the host and is mirrored to every peer.
 *
 * PRESS (push your luck): once a point is set, a seat may press its Pass line on that point (key 3). The press equals the
 * line bet, pays true odds (a fair bet), and rides until the point is made or a 7 comes. One press per point.
 *
 * Juice: anticipation (the Hook raises the stick, the puck flips, the rail lamps blink) → action (dice rattle and fly,
 * pendant buzzes) → impact (the call pop text, the seven-out flicker and shake, furnace flames) → follow-through
 * (settle pop text, tier celebration, loss and near-miss beats).
 */
import * as THREE from 'three';
import type { Kit, ChipValue } from '@/kit/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, DICE_REST, drawLayout, PLACE_ORDER, spotXZ, TOP, type CrapsParts } from './model';
import {
  BASE_WEIGHT, defaultMods, oddsCap, playHeadless, pressChance, pressRatio, resolveRoll, throwDice, validSpot,
  type Book, type Mods, type Roll, type RollOutcome,
} from './rules';
import { STRINGS } from './strings';

// ── timing (seconds, ×1 speed) and table limits ─────────────────────────────────────────────────
const COMEOUT_S = 12;       // shared come-out window
const POINT_S = 8;          // shared point window
const SETTLE_MIN = 0.6, SETTLE_MAX = 2.5;
const CALL_S = 1.0;
const SEVEN_OUT_S = 2.0;
const NO_ROLL_S = 1.5;
const SEATS = 8;
const TABLE_MAX = 5000;     // per seat, all bets together
const CHIP_CAP = 590;       // InstancedMesh budget (600 chips)
const GOLD = 0xffd040, GREEN = 0x7dff7a, RED = 0xff4a3a, FLAME = 0xff6a00;

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Bet = { s: string; a: number };
type Win = 'idle' | 'comeout' | 'point' | 'busy';
type Ev =
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'work'; seat: number; on: boolean }
  | { k: 'phase'; p: Win }
  | { k: 'shooter'; seat: number }
  | { k: 'throw'; seat: number; d1: number; d2: number; traj: number; noRoll: boolean; ms: number }
  | { k: 'call'; total: number; hard: boolean; comeout: boolean; point: number; madePoint: number; sevenOut: boolean }
  | { k: 'puck'; on: boolean; point: number }
  | { k: 'settle'; seat: number; spots: Array<[string, number]>; stake: number; gross: number };
type Act =
  | { k: 'set'; spot: string; a: number }
  | { k: 'throw' }
  | { k: 'work'; on: boolean }
  | { k: 'down'; group: 'place' | 'odds' | 'all' }
  | { k: 'maxOdds' }
  | { k: 'press' };
/** What every peer knows (public felt state). Mutated only in `present`. */
type State = { phase: Win; point: number; shooter: number; lay: Bet[][]; working: boolean[]; last: number[] };
type Snap = State;

const emptyLay = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyWorking = (): boolean[] => new Array<boolean>(SEATS).fill(false);

/** Chip stack for an amount, greedy largest-first. */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [500, 100, 25, 5, 1] as const) while (left >= v && out.length < 60) { out.push(v); left -= v; }
  return out;
}

/** Spot the pointer resolves to (static layout spots only). */
function nearestSpot(x: number, z: number): string | null {
  let best: string | null = null, bestD = 0.07 * 0.07;
  for (const s of Object.keys(SPOT_CANDIDATES)) {
    const p = SPOT_CANDIDATES[s];
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
const SPOT_CANDIDATES: Record<string, [number, number]> = (() => {
  const out: Record<string, [number, number]> = {};
  for (const s of ['pass', 'dpass', 'odds', 'dodds', 'come', 'dcome', 'field', 'any7', 'anycraps', 'p:2', 'p:3', 'p:11', 'p:12',
    'horn', 'ce', 'furnace', 'big:6', 'big:8', 'hard:4', 'hard:6', 'hard:8', 'hard:10', 'buy:4', 'buy:10']) {
    const p = spotXZ(s);
    if (p) out[s] = p;
  }
  for (const n of PLACE_ORDER) { const p = spotXZ(`place:${n}`); if (p) out[`place:${n}`] = p; }
  return out;
})();

const LINE = new Set(['pass', 'dpass', 'come', 'dcome']);
const ODDS = new Set(['odds', 'dodds', 'codds', 'dcodds']);
const PLACE_LIKE = new Set(['place', 'buy', 'hard', 'big']);

/** Table limit for one spot (coins). Lines and place-type 5–500, props 1–100, Furnace 1–20. */
function limitFor(spot: string): { min: number; max: number } {
  const kind = spot.split(':')[0];
  if (LINE.has(kind) || PLACE_LIKE.has(kind) || ODDS.has(kind)) return { min: 5, max: 500 };
  if (kind === 'furnace') return { min: 1, max: 20 };
  return { min: 1, max: 100 };
}

const sumBook = (b: Book): number => Object.values(b).reduce((s, v) => s + v, 0);

export default class CrapsTable extends TableBase<CrapsParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', point: 0, shooter: -1, lay: emptyLay(), working: emptyWorking(), last: [] };
  /** HOST-ONLY authority: books (every open bet), working flags, point, shooter, shield charges, made points. */
  private hs: {
    phase: 'idle' | 'open' | 'busy'; timer: number; point: number; shooter: number;
    books: Book[]; working: boolean[]; made: number[]; shield: number; last: number[];
  } = { phase: 'idle', timer: 0, point: 0, shooter: -1, books: Array.from({ length: SEATS }, () => ({} as Book)), working: emptyWorking(), made: [], shield: 0, last: [] };

  protected createModel(kit: Kit): MachineModel<CrapsParts> { return buildModel(kit, this.modelOpts); }

  /** Seat HUD overlay (readability standard, see _base/seatHud.ts); shown while seated. */
  private seatHud?: SeatHud;
  private shownSecond = -1;

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
    const seat = this.localSeat;
    const open = this.st.phase === 'comeout' || this.st.phase === 'point';
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm':                                                               // Space: throw (shooter only)
        if (open && seat >= 0 && this.st.shooter === seat) this.act({ k: 'throw' });
        else if (seat >= 0 && this.st.shooter !== seat) this.toast(tr('m.craps.notShooter'), 'warn');
        break;
      case 'clear': if (seat >= 0) this.act({ k: 'down', group: 'all' }); break;     // take down every working prop
      case 'n1': if (seat >= 0) this.act({ k: 'maxOdds' }); break;                   // max odds behind line and come
      case 'n2': if (seat >= 0) this.act({ k: 'work', on: !this.st.working[seat] }); break;
      case 'n3': if (seat >= 0) this.act({ k: 'press' }); break;                    // PRESS: double the Pass line on the point
      case 'n4': if (seat >= 0) this.act({ k: 'down', group: 'place' }); break;      // take down place and buy
      case 'n5': if (seat >= 0) this.hornBet(); break;
      case 'n6': if (seat >= 0) this.act({ k: 'down', group: 'odds' }); break;      // take down odds
      default: break;
    }
  }

  /** LMB adds one selected chip on the spot under the pointer; RMB takes one back. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || this.localSeat < 0) return;
    const hit = this.pick([this.parts.layout]);
    if (!hit) return;
    const local = this.parts.layout.worldToLocal(hit.point.clone());
    const spot = nearestSpot(local.x, -local.y);
    if (!spot) return;
    this.nudge(spot, e.button === 2 ? -1 : 1);
  }

  private myBook(): Book { return this.hostBookOf(this.localSeat); }
  /** Local mirror of the seat's layout (from the public state; amounts are authoritative on the host). */
  private hostBookOf(seat: number): Book {
    const out: Book = {};
    for (const b of this.st.lay[seat] ?? []) out[b.s] = b.a;
    return out;
  }
  private myAmount(spot: string): number { return this.myBook()[spot] ?? 0; }

  /** Adds (`dir` = 1) or removes (`dir` = −1) one selected chip on a spot. The host validates. */
  private nudge(spot: string, dir: 1 | -1): void {
    const cur = this.myAmount(spot);
    const next = Math.max(0, dir > 0 ? cur + this.bet : cur - this.bet);
    if (next === cur) return;
    this.sfx('chip');
    this.act({ k: 'set', spot, a: next });
  }

  /** Key 5: a horn bet in fours with the selected chip. */
  private hornBet(): void {
    const cur = this.myAmount('horn');
    this.act({ k: 'set', spot: 'horn', a: cur + Math.max(4, Math.floor(this.bet / 4) * 4) });
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'throw') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.craps.busy'); return; }
      if (hs.shooter !== seat) { this.nak(pid, rid, 'm.craps.notShooter'); return; }
      this.throwNow();
    } else if (a.k === 'set') {
      this.setBet(pid, seat, a.spot, a.a, rid);
    } else if (a.k === 'work') {
      hs.working[seat] = a.on;
      void this.emit({ k: 'work', seat, on: a.on });
    } else if (a.k === 'down') {
      this.takeDown(pid, seat, a.group, rid);
    } else if (a.k === 'maxOdds') {
      this.maxOdds(pid, seat, rid);
    } else if (a.k === 'press') {
      this.press(pid, seat, rid);
    }
  }

  /**
   * Host: PRESS doubles the seat's Pass line on the point (once per point). The press is a true-odds bet on the point:
   * it wins when the point is made, loses on a seven, and stays up on any other total (see `resolveRoll`).
   */
  private press(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    const book = hs.books[seat];
    if (hs.phase !== 'open') { this.nak(pid, rid, 'm.craps.busy'); return; }
    if (hs.point === 0 || !(book.pass > 0)) { this.nak(pid, rid, 'm.craps.noPress'); return; }
    const spot = `press:${hs.point}`;
    if (book[spot]) { this.nak(pid, rid, 'm.craps.pressed'); return; }
    const amount = book.pass;                                  // "double": the press equals the line bet
    if (sumBook(book) + amount > TABLE_MAX) { this.nak(pid, rid, 'm.craps.limit'); return; }
    if (!this.chargeSeat(seat, amount, pid)) { this.nak(pid, rid, 'm.craps.noFunds'); return; }
    book[spot] = amount;
    this.emitLay(seat);
  }

  /** Host: validates one absolute spot amount, then charges or refunds the difference. */
  private setBet(pid: PlayerId, seat: number, spot: string, amount: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'open') { this.nak(pid, rid, 'm.craps.busy'); return; }
    if (!validSpot(spot)) { this.nak(pid, rid, 'm.craps.badSpot'); return; }
    if (!Number.isInteger(amount) || amount < 0) { this.nak(pid, rid, 'm.craps.limit'); return; }
    const book = hs.books[seat];
    const cur = book[spot] ?? 0;
    const mods = this.mods();
    const point = hs.point;
    const kind = spot.split(':')[0];
    const n = Number(spot.split(':')[1] ?? 0);
    const delta = amount - cur;
    if (delta === 0) return;
    if (kind === 'press') { this.nak(pid, rid, 'm.craps.noPress'); return; }   // presses come only from the PRESS key
    if (delta > 0) {
      if (kind === 'pass' || kind === 'dpass') { if (point !== 0) { this.nak(pid, rid, 'm.craps.needPass'); return; } }
      else if (kind === 'come' || kind === 'dcome') { if (point === 0) { this.nak(pid, rid, 'm.craps.needPoint'); return; } }
      else if (kind === 'odds' || kind === 'dodds') {
        const line = book[kind === 'odds' ? 'pass' : 'dpass'] ?? 0;
        if (point === 0 || line <= 0) { this.nak(pid, rid, 'm.craps.noPass'); return; }
        const cap = kind === 'odds' ? oddsCap(point, mods.oddsAdd) : 6;
        if (amount > cap * line) { this.nak(pid, rid, 'm.craps.oddsCap'); return; }
      } else if (kind === 'codds' || kind === 'dcodds') {
        const line = book[kind === 'codds' ? `come:${n}` : `dcome:${n}`] ?? 0;
        if (line <= 0) { this.nak(pid, rid, 'm.craps.noComeBet'); return; }
        const cap = kind === 'codds' ? oddsCap(n, mods.oddsAdd) : 6;
        if (amount > cap * line) { this.nak(pid, rid, 'm.craps.oddsCap'); return; }
      } else if (spot === 'horn' && amount % 4 !== 0) { this.nak(pid, rid, 'm.craps.hornUnit'); return; }
      else if (spot === 'ce' && amount % 2 !== 0) { this.nak(pid, rid, 'm.craps.ceEven'); return; }
      const lim = limitFor(spot);
      if (!ODDS.has(kind) && (amount < lim.min || amount > lim.max)) {
        this.nak(pid, rid, kind === 'furnace' ? 'm.craps.furnaceLimit' : lim.max > 100 ? 'm.craps.limit' : 'm.craps.propLimit');
        return;
      }
      if (sumBook(book) - cur + amount > TABLE_MAX) { this.nak(pid, rid, 'm.craps.limit'); return; }
    } else if (LINE.has(kind) || kind === 'odds') {
      this.nak(pid, rid, 'm.craps.needPass');        // line bets and their odds cannot be taken down mid-hand
      return;
    }
    if (delta > 0) {
      if (!this.chargeSeat(seat, delta, pid)) { this.nak(pid, rid, 'm.craps.noFunds'); return; }
    } else {
      this.paySeat(seat, -delta, { bet: -delta, silent: true }, pid);
    }
    if (amount > 0) book[spot] = amount; else delete book[spot];
    this.emitLay(seat);
  }

  /** Host: takes down working place/buy, hardway/big/prop, or odds bets for one seat (refund, no charge). */
  private takeDown(pid: PlayerId, seat: number, group: 'place' | 'odds' | 'all', rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'open') { this.nak(pid, rid, 'm.craps.busy'); return; }
    const book = hs.books[seat];
    const hit = Object.keys(book).filter((s) => {
      const kind = s.split(':')[0];
      if (group === 'place') return kind === 'place' || kind === 'buy';
      if (group === 'odds') return ODDS.has(kind);
      return PLACE_LIKE.has(kind) || ['field', 'any7', 'anycraps', 'p', 'horn', 'ce'].includes(kind);
    });
    if (!hit.length) { this.nak(pid, rid, 'm.craps.nothingToTake'); return; }
    let refund = 0;
    for (const s of hit) { refund += book[s]; delete book[s]; }
    this.paySeat(seat, refund, { bet: refund, silent: true }, pid);
    this.emitLay(seat);
  }

  /** Host: brings every pass and come odds up to the maximum on their line. */
  private maxOdds(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'open' || hs.point === 0) { this.nak(pid, rid, 'm.craps.needPoint'); return; }
    const mods = this.mods();
    const book = hs.books[seat];
    if (book.pass) this.setBet(pid, seat, 'odds', oddsCap(hs.point, mods.oddsAdd) * book.pass, rid);
    for (const k of Object.keys(book)) {
      if (!k.startsWith('come:')) continue;
      const n = Number(k.slice(5));
      this.setBet(pid, seat, `codds:${n}`, oddsCap(n, mods.oddsAdd) * book[k], rid);
    }
  }

  private emitLay(seat: number): void {
    const bets: Bet[] = Object.keys(this.hs.books[seat]).map((s) => ({ s, a: this.hs.books[seat][s] }));
    void this.emit({ k: 'lay', seat, bets });
  }

  // ── HOST: timeline ────────────────────────────────────────────────────────────────────────────
  /** Pendant-free: the table opens a window for bets and the throw. */
  private openWindow(): void {
    const hs = this.hs;
    if (hs.shooter < 0 || this.seats[hs.shooter] === null) this.setShooter(this.pickShooter());
    hs.phase = 'open';
    hs.timer = hs.point ? POINT_S : COMEOUT_S;
    if (this.humans().length >= 2) void this.countdown(hs.timer, 'throw');
    void this.emit({ k: 'phase', p: hs.point ? 'point' : 'comeout' });
  }

  /** Host: first seat clockwise from the current shooter with a line bet; otherwise the first human. */
  private pickShooter(): number {
    const hs = this.hs;
    const humanSeats = this.humans().map((h) => h.seat);
    if (!humanSeats.length) return -1;
    const start = hs.shooter < 0 ? -1 : hs.shooter;
    for (let i = 1; i <= SEATS; i++) {
      const s = (start + i + SEATS) % SEATS;
      if (humanSeats.includes(s) && (hs.books[s].pass || hs.books[s].dpass)) return s;
    }
    if (hs.shooter >= 0 && humanSeats.includes(hs.shooter)) return hs.shooter;
    return humanSeats[0];
  }

  private setShooter(seat: number): void {
    if (seat === this.hs.shooter) return;
    this.hs.shooter = seat;
    this.hs.shield = this.mods().sevenOutShield;   // Hollow Dice: one seven-out shield per shooter
    void this.emit({ k: 'shooter', seat });
  }

  /** Host timeline. */
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans();
    if (hs.phase === 'idle') { if (humans.length) this.openWindow(); return; }
    if (humans.length === 0) { this.resetTable(); return; }
    if (hs.phase === 'open') {
      if (humans.length >= 2 && (hs.timer -= dt) <= 0) this.throwNow();    // shared: the throw is automatic at zero
      return;
    }
    if ((hs.timer -= dt) <= 0) this.openWindow();
  }

  private resetTable(): void {
    const hs = this.hs;
    hs.phase = 'idle'; hs.point = 0; hs.shooter = -1; hs.made = []; hs.shield = 0;
    for (let s = 0; s < SEATS; s++) {
      if (Object.keys(hs.books[s]).length) { hs.books[s] = {}; this.emitLay(s); }
    }
    void this.emit({ k: 'phase', p: 'idle' });
  }

  private mods(): Mods {
    const m = defaultMods();
    const die = (d: 0 | 1): number[] => Array.from({ length: 6 }, (_, f) =>
      Math.max(0, BASE_WEIGHT + Math.round(this.mod(`x.craps.dieWeight.${d}.${f + 1}` as ModHook, 0))));
    return {
      ...m,
      dice: [die(0), die(1)],
      sevenOutShield: Math.round(this.mod('x.craps.sevenOutShield' as ModHook, 0)),
      oddsAdd: Math.round(this.mod('x.craps.oddsMaxAdd' as ModHook, 0)),
      hardwayAdd: Math.round(this.mod('x.craps.hardwayPayAdd' as ModHook, 0)),
      fieldTwelveAdd: Math.round(this.mod('x.craps.fieldTwelveAdd' as ModHook, 0)),
      furnaceMult: this.mod('x.craps.furnaceMult' as ModHook, 1),
    };
  }

  /** Host: THROW → resolve every seat's book against one roll, pay at once, then announce the whole roll. */
  private throwNow(): void {
    const hs = this.hs;
    if (hs.phase !== 'open') return;
    this.cancelCountdown();
    const mods = this.mods();
    const humans = this.humans().length;
    const solo = humans < 2;
    const luckSeat = hs.books.findIndex((b) => Object.keys(b).length > 0);
    const ctxFor = (s: number): Parameters<typeof resolveRoll>[2] => ({ point: hs.point, working: hs.working[s], mods, shield: false, made: hs.made });
    const netOf = (r: Roll): number => {
      if (!solo || luckSeat < 0) return 0;
      const o = resolveRoll(hs.books[luckSeat], r, ctxFor(luckSeat));
      return o.gross - o.resolvedStake;
    };
    let noRolls = 0;
    let th = throwDice(this.hostRng, mods, solo ? this.luck() : 0, netOf);
    for (;;) {
      const absorb = !th.noRoll && hs.point > 0 && th.roll.total === 7 && hs.shield > 0;
      if (!th.noRoll && !absorb) break;
      if (absorb) hs.shield--;
      noRolls++;
      void this.emit({ k: 'throw', seat: hs.shooter, d1: th.roll.d1, d2: th.roll.d2, traj: this.hostRng.int(0, 63), noRoll: true, ms: 800 });
      if (noRolls >= 20) break;
      th = throwDice(this.hostRng, mods, solo ? this.luck() : 0, netOf);
    }
    const roll = th.roll;
    const shooterBefore = hs.shooter;
    const wasPoint = hs.point;
    const base: RollOutcome = resolveRoll({}, roll, { point: hs.point, working: false, mods, shield: false, made: hs.made });
    // money first (host authority), presentation after: throw → call → puck → settle per seat → shooter
    const results: Array<{ s: number; o: RollOutcome; gross: number }> = [];
    for (let s = 0; s < SEATS; s++) {
      const book = hs.books[s];
      if (!Object.keys(book).length) continue;
      const o = resolveRoll(book, roll, ctxFor(s));
      hs.books[s] = o.book;
      // shared (2+ humans): losing bets on the roll are refunded; solo keeps the house edge
      const gross = o.gross + (solo ? 0 : o.lostStake);
      if (o.resolvedStake > 0) this.paySeat(s, gross, { bet: o.resolvedStake });
      results.push({ s, o, gross });
    }
    hs.point = base.point;
    hs.made = base.made;
    hs.last = [roll.total, ...hs.last].slice(0, 10);
    const rollMs = Math.round(this.hostRng.float(1600, 2600));
    void this.emit({ k: 'throw', seat: shooterBefore, d1: roll.d1, d2: roll.d2, traj: this.hostRng.int(0, 63), noRoll: false, ms: rollMs });
    void this.emit({
      k: 'call', total: roll.total, hard: roll.hard && (roll.total === 4 || roll.total === 6 || roll.total === 8 || roll.total === 10),
      comeout: wasPoint === 0, point: base.point, madePoint: base.madePoint, sevenOut: base.sevenOut,
    });
    void this.emit({ k: 'puck', on: base.point > 0, point: base.point });
    let settled = 0;
    for (const { s, o, gross } of results) {
      if (o.resolvedStake > 0) {
        settled++;
        void this.emit({ k: 'settle', seat: s, spots: o.settled, stake: o.resolvedStake, gross });
      }
      this.emitLay(s);
    }
    if (base.sevenOut) {
      // new shooter: the next seat clockwise with a line bet; a fresh shield and an empty made-point list
      hs.shooter = this.pickShooter();
      hs.shield = mods.sevenOutShield;
      void this.emit({ k: 'shooter', seat: hs.shooter });
    }
    const settleS = Math.min(SETTLE_MAX, Math.max(SETTLE_MIN, SETTLE_MIN + 0.2 * settled));
    hs.phase = 'busy';
    hs.timer = rollMs / 1000 + CALL_S + settleS + (base.sevenOut ? SEVEN_OUT_S : 0) + noRolls * NO_ROLL_S;
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'lay':
        this.st.lay[ev.seat] = ev.bets;
        this.paintChips();
        if (ev.bets.length && ev.seat === this.localSeat) this.sfx('chip');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'work':
        this.st.working[ev.seat] = ev.on;
        this.toast(tr(`m.craps.working`) + (ev.on ? ' ✓' : ''), 'sys');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'phase':
        this.st.phase = ev.p;
        if (ev.p !== 'point') this.st.point = 0;
        this.paintLamps();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'shooter':
        this.st.shooter = ev.seat;
        this.paintLamps();
        if (ev.seat === this.localSeat) this.ctx.ui.toast(tr('m.craps.youShoot'), 'sys');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'throw': await this.throwShow(ev, pc); return;
      case 'call': await this.callShow(ev, pc); return;
      case 'puck': this.st.point = ev.point; this.paintPuck(); return;
      case 'settle': await this.settleShow(ev, pc); return;
    }
  }

  /** Anticipation → action: the Hook raises the stick, the dice rattle and fly to the layout. */
  private async throwShow(ev: Extract<Ev, { k: 'throw' }>, pc: PresentCtx): Promise<void> {
    const { dice, stick, throwOrigins } = this.parts;
    const origin = throwOrigins[Math.max(0, ev.seat)] ?? throwOrigins[0];
    if (ev.noRoll) {
      this.sfx('thud');
      this.toast(tr('m.craps.callNoRoll'), 'warn');
      if (!pc.fast) await this.anim(0.25, (k) => { dice.dice[0].position.lerpVectors(origin.position, new THREE.Vector3(...DICE_REST[0]), k); dice.dice[1].position.lerpVectors(origin.position, new THREE.Vector3(...DICE_REST[1]), k); }, 'outQuad');
      return;
    }
    if (!pc.fast) {
      this.sfx('dice');
      await this.anim(0.25, (k) => { stick.rotation.x = -0.9 * k; }, 'outQuad');
    }
    dice.setFace(0, ev.d1);
    dice.setFace(1, ev.d2);
    const dur = pc.fast ? 0 : Math.max(0.2, ev.ms / 1000 * 0.6);
    if (pc.fast) {
      dice.dice[0].position.set(...DICE_REST[0]);
      dice.dice[1].position.set(...DICE_REST[1]);
    } else {
      await Promise.all([
        dice.roll(0, origin.position.clone(), new THREE.Vector3(...DICE_REST[0]), ev.d1, dur),
        dice.roll(1, origin.position.clone(), new THREE.Vector3(...DICE_REST[1]), ev.d2, dur),
      ]);
      this.sfx('diceLand');
    }
    await this.anim(pc.fast ? 0.01 : 0.2, (k) => { stick.rotation.x = -0.9 * (1 - k); }, 'outQuad');
    this.ctx.fx.shake(0.008, 0.18, { roll: 0.3 });
    this.ctx.fx.sparks(dice.dice[0], 6, RED);
    // the dice stay in the lit frame after the throw: a gold glow on each die, the table lamps lift for a beat
    this.ctx.fx.glow(dice.dice[0], GOLD, 0.35, 1.6);
    this.ctx.fx.glow(dice.dice[1], GOLD, 0.35, 1.6);
    if (!pc.fast) {
      const { light, light2 } = this.parts;
      await this.anim(0.5, (k) => {
        const lift = 0.6 * Math.sin(k * Math.PI);
        light.userData.intensity = 2.0 + lift;
        light2.userData.intensity = 2.0 + lift;
      }, 'outQuad');
    }
    this.drawLast();
  }

  /** Impact → follow-through: the Hook calls the total; seven-out flickers the room, a made point lights a flame. */
  private async callShow(ev: Extract<Ev, { k: 'call' }>, pc: PresentCtx): Promise<void> {
    const { furnaceLamps, pointLamps, light, light2 } = this.parts;
    let text: string, color: number;
    if (ev.sevenOut) { text = tr('m.craps.callSeven'); color = RED; }
    else if (ev.madePoint) { text = tr('m.craps.callPointMade'); color = GOLD; }
    else if (ev.total === 11 && ev.comeout) { text = tr('m.craps.callYo'); color = GREEN; }
    else if (ev.comeout && (ev.total === 2 || ev.total === 3 || ev.total === 12)) { text = tr('m.craps.callCraps'); color = RED; }
    else if (ev.hard) { text = tr('m.craps.callHard', { n: ev.total }); color = GOLD; }
    else { text = tr('m.craps.callEasy', { n: ev.total }); color = 0xffffff; }
    this.ctx.fx.popText(this.parts.puck, text, color, { dur: 1.2, rise: 0.35 });
    // the total, big, over the dice that made it
    this.ctx.fx.popText(this.parts.dice.dice[0], String(ev.total), color, { dur: 1.8, rise: 0.22, scale: 2.6 });
    this.drawLast();
    if (ev.sevenOut) {
      this.sfx('buzzer');
      this.ctx.fx.shake(0.04, 0.5, { roll: 0.6 });
      this.ctx.fx.glow(this.parts.stick, RED, 0.9, 0.6);
      if (!pc.fast) await this.anim(0.6, (k) => {
        const f = Math.abs(Math.sin(k * Math.PI * 6)) * (1 - k);
        light.userData.intensity = 1.2 * (1 - f);
        light2.userData.intensity = 1.2 * (1 - f);
      }, 'outQuad');
    } else if (ev.madePoint) {
      this.sfx('chime');
      const lamp = pointLamps[PLACE_ORDER.indexOf(ev.madePoint)];
      lamp?.blink(8, 1.0);
      this.ctx.fx.glow(this.parts.puck, GOLD, 0.5, 0.5);
    } else {
      this.sfx('click', { vol: 0.8 });
    }
    this.paintLamps();
    if (!pc.fast) await this.wait(CALL_S * 0.6);
  }

  /** Follow-through: chips paid or taken per seat, win pop texts and celebrations. */
  private async settleShow(ev: Extract<Ev, { k: 'settle' }>, pc: PresentCtx): Promise<void> {
    const lamps = this.parts.seatLamps;
    const tier = juiceTier(ev.gross, ev.stake);
    const won = ev.gross > ev.stake;
    if (ev.seat === this.localSeat && ev.stake > 0) {
      const net = ev.gross - ev.stake;
      this.seatHud?.result(ev.gross <= 0 ? 'lose' : net > 0 ? 'win' : 'push', net);
    }
    if (ev.gross > 0) {
      if (ev.seat === this.localSeat) {
        if (won) void this.celebrate(tier, { amount: ev.gross - ev.stake, at: this.parts.stick, lamps: [lamps[ev.seat]], fast: pc.fast, restore: () => this.paintLamps() });
        else this.commiserate({ amount: ev.stake - ev.gross, at: this.parts.puck });
      }
      this.ctx.fx.popText(lamps[ev.seat].root, tr('m.craps.win', { n: fmtCoins(ev.gross - ev.stake) }), won ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
    } else if (ev.seat === this.localSeat && ev.stake > 0) {
      this.commiserate({ amount: ev.stake, at: this.parts.puck });
      if (ev.spots.some(([s]) => s.startsWith('p:') || s === 'any7' || s === 'anycraps')) void this.nearMiss({ at: this.parts.puck });
    }
    if (ev.spots.some(([s, g]) => s === 'furnace' && g > 0)) this.parts.furnaceLamps.forEach((l) => l.blink(6, 1.0));
    if (ev.spots.some(([s, g]) => s.startsWith('hard:') && g > 0)) this.ctx.fx.shake(0.02, 0.35, { roll: 0.2 });
    if (!pc.fast) await this.wait(0.3);
  }

  // ── snapshots: public felt state only ─────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase, point: this.st.point, shooter: this.st.shooter,
      lay: this.st.lay.map((l) => l.map((b) => ({ ...b }))), working: [...this.st.working], last: [...this.st.last],
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, point: sn.point, shooter: sn.shooter,
      lay: sn.lay.map((l) => l.map((b) => ({ ...b }))), working: [...sn.working], last: [...sn.last],
    };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('craps', this.tipLines());
    }
  }
  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost) {
      if (Object.keys(this.hs.books[seat]).length) { this.hs.books[seat] = {}; this.emitLay(seat); }
      this.hs.working[seat] = false;
    }
    this.paintLamps();
    if (local) { this.seatHud?.hide(); this.hud(null); }
  }
  override onLang(): void { this.paintLayout(); this.drawLast(); this.paintChips(); if (this.isLocalOccupant) this.showHud(); }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private paintLamps(): void {
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null || this.st.shooter === s));
    this.parts.pointLamps.forEach((l, i) => l.setOn(this.st.point === PLACE_ORDER[i]));
    this.parts.furnaceLamps.forEach((l) => l.setOn(this.st.phase !== 'idle'));
    this.paintPuck();
  }

  private paintPuck(): void {
    const on = this.st.point > 0;
    this.parts.puckOn.visible = on;
    this.parts.puckOff.visible = !on;
  }

  private paintChips(): void {
    const { chips } = this.parts;
    chips.clear();
    for (const seat of this.st.lay) {
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

  private paintLayout(): void {
    drawLayout(this.parts.layoutCanvas, (k) => this.t(k));
    this.parts.layoutTex.needsUpdate = true;
  }

  private drawLast(): void {
    const last = this.st.last;
    this.parts.last10.draw((g, w) => {
      g.fillStyle = '#070707';
      g.fillRect(0, 0, w.w, w.h);
      last.forEach((n, i) => {
        w.text(String(n), Math.round(2 + i * 6.2), 4, { font: 'px5', color: n === 7 ? '#ff4a3a' : '#f2ead2', align: 'left' });
      });
    });
  }

  private paintAll(): void {
    this.paintLayout();
    this.paintLamps();
    this.paintChips();
    this.drawLast();
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.craps.hTip1', v: { up: this.k('betUp'), down: this.k('betDown') } },
      { k: 'm.craps.hTip2', v: { throw: this.k('confirm') } },
      { k: 'm.craps.hTip3', v: { help: this.k('help') } },
    ];
  }

  private ruleLines(): Txt[] {
    return [
      { k: 'm.craps.hR1' },
      { k: 'm.craps.hR2' },
      { k: 'm.craps.hR3' },
      { k: 'm.craps.hR4' },
      { k: 'm.craps.hR5', v: { working: this.k('n2') } },
      { k: 'm.craps.hR6', v: { clear: this.k('clear') } },
      { k: 'm.craps.hR7', v: { press: this.k('n3') } },
    ];
  }

  /** The banner and the countdown: refresh once per displayed second while a window is open. */
  frame(): void {
    if (!this.isLocalOccupant) return;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.showHud(); }
  }

  /** Banner, key numbers and the valid controls only. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud, seat = this.localSeat;
    if (!sh || seat < 0) return;
    const st = this.st;
    const open = st.phase === 'comeout' || st.phase === 'point';
    const mine = open && st.shooter === seat;
    const total = sumBook(this.myBook());
    sh.goal({ k: 'm.craps.hGoal' });

    // STATE: whose roll it is, and the point
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const secs: Txt | undefined = left > 0 ? { k: 'm.craps.hSecs', v: { n: left } } : undefined;
    const who: Txt = mine ? { k: 'm.craps.hYouShoot' } : { k: 'm.craps.hShooter', v: { n: st.shooter + 1 } };
    if (st.phase === 'comeout') sh.state({ k: 'm.craps.hComeout' }, mine ? 'good' : 'gold', secs ?? who);
    else if (st.phase === 'point') sh.state({ k: 'm.craps.hPoint', v: { n: st.point } }, mine ? 'good' : 'warn', secs ?? who);
    else if (st.phase === 'busy') sh.state({ k: 'm.craps.hBusy' }, 'cyan');
    else if (st.phase === 'idle') sh.state({ k: 'm.craps.hWait' }, 'neutral');
    else sh.state({ k: 'm.craps.hPay' }, 'neutral');

    // KEY NUMBERS: chip, your felt, the point, last roll, working flag, balance
    const nums: HudNumber[] = [{ label: { k: 'm.craps.hNBet' }, value: fmtCoins(this.bet), tone: 'gold' }];
    if (total > 0) nums.push({ label: { k: 'm.craps.hNFelt' }, value: fmtCoins(total), tone: 'cyan' });
    nums.push({ label: { k: 'm.craps.hNPoint' }, value: st.point > 0 ? String(st.point) : tr('m.craps.hOff'), tone: st.point > 0 ? 'gold' : 'neutral' });
    const last = st.last[0];
    if (last !== undefined) nums.push({ label: { k: 'm.craps.hNLast' }, value: String(last), tone: last === 7 ? 'bad' : 'neutral' });
    nums.push({ label: { k: 'm.craps.hNWorking' }, value: tr(st.working[seat] ? 'm.craps.hOn' : 'm.craps.hOff'), tone: st.working[seat] ? 'good' : 'neutral' });
    // PRESS: the visible odds and payout on the point, or PRESSED once this point is pressed
    const pressable = open && st.point > 0 && this.myAmount('pass') > 0;
    const pressedNow = st.point > 0 && this.myAmount(`press:${st.point}`) > 0;
    if (pressable || pressedNow) {
      const [pa, pb] = pressRatio(st.point);
      const pct = Math.round(pressChance(st.point) * 100);
      nums.push({
        label: { k: 'm.craps.hNPress' },
        value: pressedNow ? { k: 'm.craps.hPressed' } : { k: 'm.craps.hPressVal', v: { p: pct, a: pa, b: pb } },
        tone: pressedNow ? 'gold' : 'cyan',
      });
    }
    nums.push({ label: { k: 'm.craps.hNBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.craps.hCBet' }, action: 'betUp' });
    if (mine) ctrl.push({ key: this.k('confirm'), label: { k: 'm.craps.hCThrow' }, action: 'confirm', primary: true });
    if (open) {
      ctrl.push({ key: this.k('n2'), label: { k: 'm.craps.hCWorking' }, action: 'n2' });
      if (pressable && !pressedNow) ctrl.push({ key: this.k('n3'), label: { k: 'm.craps.hCPress' }, action: 'n3', primary: true });
      if (st.point > 0) ctrl.push({ key: this.k('n1'), label: { k: 'm.craps.hCMaxOdds' }, action: 'n1' });
      ctrl.push({ key: this.k('n4'), label: { k: 'm.craps.hCPlace' }, action: 'n4' });
      ctrl.push({ key: this.k('n5'), label: { k: 'm.craps.hCHorn' }, action: 'n5' });
      if (st.point > 0) ctrl.push({ key: this.k('n6'), label: { k: 'm.craps.hCOdds' }, action: 'n6' });
      if (total > 0) ctrl.push({ key: this.k('clear'), label: { k: 'm.craps.hCClear' }, action: 'clear' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.craps.hCRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.craps.hCLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

export { playHeadless };

export const def: MachineDef = {
  id: 'craps',
  category: 'dice',
  slotSize: 'XL',
  zone: 'boiler',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: 5, maxBet: 500, betSteps: [5, 10, 25, 50, 100, 250, 500],
  maxPayoutMult: 1000,
  rtp: 0.9,
  actionCost: 1,
  idleYield: 0.45,
  tags: ['table', 'dice', 'hero'],
  headless: playHeadless,
  modHooks: {
    'x.craps.dieWeight.d.face': 'int add to one die face weight (base 100), d = 0 or 1, face = 1..6',
    'x.craps.sevenOutShield': 'charges: one seven-out per shooter becomes a no-roll re-throw',
    'x.craps.oddsMaxAdd': 'int added to the odds multiple (3× / 4× / 5×)',
    'x.craps.hardwayPayAdd': 'int added to the hardway pay (9:1 / 7:1)',
    'x.craps.fieldTwelveAdd': 'int added to the 12 pay on the field (3:1)',
    'x.craps.furnaceMult': 'float multiplier on the Furnace pays',
  },
  strings: STRINGS,
};
