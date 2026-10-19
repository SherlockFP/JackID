/**
 * Put-and-Take Top "Al-Ver Topacı" (`teetotum`) — shared pot table, 6 seats, bots keep it running (TableBase, host-authoritative).
 *
 * Shape of the code (the TableBase pattern of pisti / tavla):
 *  - HOST ONLY (`hs`): the cycle (pure `rules.ts`), the pre-rolled face of each spin, every timer, every charge and payout.
 *    Clients send `act()` (sit in with an ante, spin, declare Double). The host publishes PUBLIC events only; the face is
 *    revealed when the spin starts. A private `peek` (charm) goes to one player only. Late joiners get a snapshot.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) and the pool/top change. Events are queued, so the
 *    presentation runs in the same order everywhere.
 *  - Cycle: ANTE (1.5 s) → TURN (8 s, clockwise; auto-spin at timeout) → SPIN (2.5–5.0 s) → APPLY (1.0 s) → … → END (2.0 s).
 *    A cycle ends on ALL, an empty pot, a lone seat or the 20-spin cap; every seat's gross is paid once (`paySeat`).
 *  - Seats: a human sits in with `Space` (ante from the table, chosen by the first one in). Bots fill up to 3 players
 *    when fewer humans are seated and leave when humans take their places. A cycle starts once a human is ready.
 *  - Luck and charm hooks follow MACHINES_tables §23.5: luck respins a losing face once for a lone human vs bots,
 *    `m.teetotum.faceWeight.<face>` only with no other human seated, `m.teetotum.takeBonus` and `m.teetotum.putShield`
 *    are read from the host's run, `x.table.rakeDelta` and `x.table.peekCharges` from the table family.
 *
 * Controls: Space sit in / spin on your turn · click the top = spin · R Double (before the spin) · 1 sit out next
 * cycle · Q leave after this cycle · ←→ ante (before sitting in) · H rules. Juice: top hum, precession wobble, a
 * rattle that stops dead on the face, chip flights, ALL avalanche, ALL+ patron groan, golden face glow.
 */
import * as THREE from 'three';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { fmtCoins, t } from '@/core/i18n';
import type { ModHook } from '@/game/types';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { KitX } from '@/kit/index';
import { STRINGS } from './teetotum.strings';
import { buildModel, faceYaw, GLYPH, type TeetotumParts } from './model';
import * as R from './rules';

export { playHeadless } from './rules';
const RULE_LINES: Txt[] = ['hr1', 'hr2', 'hr3', 'hr4', 'hr5', 'hr6'].map((k) => ({ k: 'm.teetotum.' + k }));

const BET_S = 10;
const TURN_S = 8;
const ANTE_S = 1.5;
const APPLY_S = 1.0;
const END_S = 2.0;
const SPIN_MIN_S = 2.5, SPIN_SPAN_S = 2.5;
const BOT_MIN = 0.9, BOT_STEP = 0.1, BOT_SPAN = 8;
const GOLD = 0xffd040;
const TWO_PI = Math.PI * 2;

type Phase = 'bet' | 'ante' | 'turn' | 'spin' | 'apply' | 'end';

// ── public events, actions, snapshot ───────────────────────────────────────────────────────────
type Row = { seat: number; stake: number; won: number };
type Ev =
  | { k: 'ready'; seat: number; on: boolean; ante: number }
  /** `seats` = seats in this cycle (clockwise); `golden` = index of the golden face or −1. */
  | { k: 'ante'; seats: number[]; ante: number; pot: number; golden: number }
  | { k: 'turn'; seat: number; timeoutMs: number }
  | { k: 'double'; seat: number }
  /** Private to one player (a charm): the top wobbles toward a take (`take`) or a put. */
  | { k: 'peek'; take: boolean }
  | { k: 'spin'; seat: number; face: string; durMs: number; precessSeed: number; doubled: boolean }
  | { k: 'apply'; seat: number; face: string; moves: { seat: number; delta: number }[]; pot: number; live: number[]; spins: number }
  | { k: 'end'; rows: Row[]; rake: number; split: boolean; pot: number }
  | { k: 'away'; seat: number }
  | { k: 'clear' };
type Act = { k: 'bet'; ready: boolean; ante: number } | { k: 'spin' } | { k: 'double' };

type PubSeat = { ready: boolean; live: boolean; stake: number; won: number };
type Pub = {
  phase: Phase; ante: number; pot: number; seats: PubSeat[]; turn: number; doubled: boolean; face: string;
  golden: number; end: Row[] | null; rake: number;
};
type Snap = { st: Pub; secret: { hs: string } | null };

// ── host-only authority state ──────────────────────────────────────────────────────────────────
type HSeat = { ready: boolean };
type Host = {
  phase: Phase; ante: number; seats: HSeat[]; cycle: R.Cycle | null; golden: number;
  turnSeat: number; turnLeft: number; botAt: number; face: string; doubled: boolean; waitLeft: number;
  timer: number; away: boolean[]; peeked: boolean;
};
const freshSeats = (): HSeat[] => Array.from({ length: R.SEATS }, () => ({ ready: false }));
const freshHost = (): Host => ({
  phase: 'bet', ante: 0, seats: freshSeats(), cycle: null, golden: -1, turnSeat: -1, turnLeft: 0, botAt: 0,
  face: '', doubled: false, waitLeft: 0, timer: 0, away: new Array<boolean>(R.SEATS).fill(false), peeked: false,
});
const pubSeat = (): PubSeat => ({ ready: false, live: false, stake: 0, won: 0 });
const freshPub = (): Pub => ({
  phase: 'bet', ante: 0, pot: 0, seats: Array.from({ length: R.SEATS }, pubSeat), turn: -1, doubled: false, face: '',
  golden: -1, end: null, rake: 0,
});

export const def: MachineDef = {
  id: 'teetotum',
  category: 'party',
  slotSize: 'L',
  zone: 'boiler',
  seats: R.SEATS,
  shared: true,
  minBet: 5, maxBet: 500, betSteps: [5, 20, 100, 500],
  // a cycle's gross is the pot share of the seat: bounded by the puts it could collect in 20 spins
  maxPayoutMult: 60,
  rtp: 0.974,
  tier: 3,
  actionCost: 1,
  tags: ['table', 'party', 'pot', 'skill'],
  modHooks: {
    'm.teetotum.faceWeight.<face>': 'integer add to one face weight (p1 p2 pa m1 m2 half all none), only with no other human seated',
    'm.teetotum.takeBonus': 'fraction added to every take, paid by the House (never from the pot)',
    'm.teetotum.putShield': 'charges: negate one of your puts per cycle',
    'x.table.rakeDelta': 'added to the 5 % rake (negative lowers it)',
    'x.table.peekCharges': 'the top wobbles toward a take before a take spin (80 % reliable)',
  },
  party: {
    minPlayers: 2, maxPlayers: R.SEATS, bots: true, botLevels: 3,
    buyIn: { min: 0, max: 500 },
    spectatorBets: false,
    houseRules: {},
    hidden: true,
    turnTimerS: TURN_S,
  },
  headless: R.playHeadless,
  strings: STRINGS,
};

export default class Teetotum extends TableBase<TeetotumParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Pub = freshPub();
  /** HOST ONLY authority state. */
  private hs: Host = freshHost();
  /** Local: Q pressed, stand up once this cycle ends. */
  private leaveAfter = false;
  /** Seat HUD overlay (goal, state, key numbers, controls, result callout, tip and rules cards). */
  private seatHud?: SeatHud;
  private hudSig = '';

  protected createModel(kit: KitX): MachineModel<TeetotumParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    const p = this.parts;
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    p.topYaw.rotation.set(0, 0, 0);
    p.topTilt.rotation.set(0, 0, 0);
    this.repaintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    const a = e.action as MachineAction;
    const seat = this.localSeat;
    const mine = seat >= 0 ? this.st.seats[seat] : undefined;
    switch (a) {
      case 'primary': case 'confirm':
        if (e.repeat) break;
        this.primary();
        break;
      case 'double':
        if (!e.repeat && this.st.phase === 'turn' && this.st.turn === seat) this.act({ k: 'double' });
        break;
      case 'n1':
        if (e.repeat || !mine) break;
        this.leaveAfter = false;
        this.act({ k: 'bet', ready: !mine.ready, ante: this.anteHere() });
        break;
      case 'collect':
        if (e.repeat || !mine) break;
        this.leaveAfter = true;
        this.act({ k: 'bet', ready: false, ante: this.anteHere() });
        this.toast(this.t('sLeave'));
        this.showHud();
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (e.repeat || (mine && mine.ready)) break;
        this.anteStep(a === 'betUp' ? 1 : a === 'betDown' ? -1 : 2);
        this.sfx('click'); this.showHud();
        break;
      case 'help':
        if (!e.repeat) this.seatHud?.rules(RULE_LINES);
        break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    if (!this.pick(this.parts.picks)) return;
    this.primary();
  }

  /** Space / click: spin on your turn, otherwise sit in at the table ante. */
  private primary(): void {
    const seat = this.localSeat;
    if (seat < 0) return;
    if (this.st.phase === 'turn' && this.st.turn === seat) { this.sfx('click'); this.act({ k: 'spin' }); return; }
    const mine = this.st.seats[seat];
    if (!mine.ready) { this.leaveAfter = false; this.act({ k: 'bet', ready: true, ante: this.anteHere() }); }
  }

  /** The ante this player offers: the table's once it is set, otherwise the local choice. */
  private anteHere(): number { return this.st.ante > 0 ? this.st.ante : this.bet; }

  /** Ante ladder: step over the table's antes (L10 adds the 500 table). */
  private anteStep(dir: number): void {
    const ladder = R.anteLadder(this.feature('teetotum.ante500'));
    const wallet = this.ctx.run.wallet();
    if (dir === 2) {
      const best = [...ladder].reverse().find((v) => v <= wallet);
      if (best !== undefined) this.bet = best;
      return;
    }
    const cur = Math.max(0, ladder.indexOf(this.bet));
    const v = ladder[Math.min(ladder.length - 1, Math.max(0, cur + dir))];
    if (v !== undefined && (v <= wallet || dir < 0)) this.bet = v;
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    if (a.k === 'bet') return this.onBet(pid, seat, a, rid);
    if (a.k === 'spin') return this.onSpin(pid, seat, rid);
    return this.onDouble(pid, seat, rid);
  }

  private onBet(pid: PlayerId, seat: number, a: Extract<Act, { k: 'bet' }>, rid: number): void {
    const hs = this.hs;
    if (!a.ready) {
      if (hs.seats[seat].ready) { hs.seats[seat] = { ready: false }; this.readyChanged(seat, false); }
      return;
    }
    if (hs.seats[seat].ready) return;
    const ladder = R.anteLadder(this.feature('teetotum.ante500'));
    if (!ladder.includes(a.ante)) { this.nak(pid, rid, 'm.teetotum.badAnte'); return; }
    const others = hs.seats.some((x, i) => i !== seat && x.ready);
    if (others) {
      if (a.ante !== hs.ante) { this.nak(pid, rid, 'm.teetotum.badAnte'); return; }
    } else hs.ante = a.ante;
    hs.seats[seat] = { ready: true };
    this.readyChanged(seat, true);
    this.afterBet();
  }

  private readyChanged(seat: number, on: boolean): void {
    if (!this.hs.seats.some((x) => x.ready)) this.hs.ante = 0;
    void this.emit({ k: 'ready', seat, on, ante: this.hs.ante });
  }

  private onSpin(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'turn' || hs.turnSeat !== seat) { this.nak(pid, rid, 'm.teetotum.notYourTurn'); return; }
    this.beginSpin();
  }

  private onDouble(pid: PlayerId, seat: number, rid: number): void {
    const hs = this.hs;
    if (hs.phase !== 'turn' || hs.turnSeat !== seat) { this.nak(pid, rid, 'm.teetotum.notYourTurn'); return; }
    if (hs.doubled) return;
    hs.doubled = true;
    void this.emit({ k: 'double', seat });
  }

  // ── HOST: bets, seats and bots ───────────────────────────────────────────────────────────────
  /** Start a cycle now if a human is in and every seated human is in, else arm the bet countdown. */
  private afterBet(): void {
    const hs = this.hs;
    if (hs.phase !== 'bet') return;
    this.tidyBots();
    const humans = this.humans();
    const ready = humans.filter((h) => hs.seats[h.seat].ready);
    if (ready.length === 0) return;
    if (ready.length === humans.length) { this.startCycle(); return; }
    if (hs.timer <= 0) { hs.timer = BET_S; void this.countdown(BET_S, 'bet'); }
  }

  /** Bots keep the table at MIN_PLAYERS: they fill empty seats when humans are few and leave for humans. Host, bet phase. */
  private tidyBots(): void {
    if (!this.isHost || this.hs.phase !== 'bet') return;
    const want = Math.max(0, R.MIN_PLAYERS - this.humans().length);
    const have = this.bots.length;
    if (have > want) {
      for (const b of this.bots.slice(0, have - want)) this.removeBot(b.seat);
    } else {
      for (let k = have; k < want; k++) {
        const free = this.seats.findIndex((p) => p === null);
        if (free < 0) break;
        const level = (1 + this.hostRng.int(0, 2)) as 1 | 2 | 3;
        this.addBot(free, this.t(`bot${level}`), level);
      }
    }
  }

  private cycleOpts(): R.Opts {
    const hs = this.hs;
    return {
      rakeRate: R.rakeRate(this.feature('teetotum.rake4'), this.tableMod('rakeDelta', 0)),
      takeBonus: Math.max(0, this.mod('m.teetotum.takeBonus' as ModHook, 0)),
      golden: hs.golden >= 0 ? R.FACES[hs.golden] : null,
    };
  }

  /** HOST: open a pot cycle with every seat that is a bot or sat in and can cover the ante. */
  private startCycle(): void {
    const hs = this.hs;
    if (hs.phase !== 'bet' || hs.ante <= 0) return;
    this.cancelCountdown();
    this.tidyBots();
    const seatsIn: number[] = [];
    this.seats.forEach((pid, s) => {
      if (pid === null) return;
      if (isBot(pid) || hs.seats[s].ready) seatsIn.push(s);
    });
    if (!seatsIn.some((s) => !isBot(this.seats[s] as PlayerId))) return;
    hs.timer = 0;
    hs.away = new Array<boolean>(R.SEATS).fill(false);
    hs.golden = this.feature('teetotum.golden') ? this.hostRng.int(0, R.FACES.length - 1) : -1;
    const shield = this.seats.map((pid) => (pid !== null && pid === this.selfId && this.mod('m.teetotum.putShield' as ModHook, 0) >= 1 ? 1 : 0));
    const cycle = R.openCycle(hs.ante, seatsIn, (s, amt) => this.chargeSeat(s, amt), shield);
    hs.cycle = cycle;
    hs.phase = 'ante';
    hs.waitLeft = ANTE_S;
    void this.emit({ k: 'ante', seats: [...cycle.live], ante: hs.ante, pot: cycle.pot, golden: hs.golden });
    if (cycle.done) this.settleCycle();
  }

  /** Refunds (fewer than two seats in) and finished cycles: pay each seat once, then show the result. */
  private settleCycle(): void {
    const hs = this.hs, c = hs.cycle;
    if (!c) return;
    const rows: Row[] = [];
    for (let s = 0; s < R.SEATS; s++) {
      if (c.stake[s] <= 0) continue;
      const bet = c.stake[s], gross = c.won[s];
      if (gross > 0) this.paySeat(s, gross, { bet }); else this.forfeit(s);
      rows.push({ seat: s, stake: bet, won: gross });
    }
    hs.phase = 'end'; hs.waitLeft = END_S; hs.turnSeat = -1; hs.face = '';
    this.cancelCountdown();
    void this.emit({ k: 'end', rows, rake: c.rake, split: c.split, pot: c.pot });
  }

  private startTurn(seat: number): void {
    const hs = this.hs, c = hs.cycle;
    if (!c) return;
    hs.phase = 'turn';
    hs.turnSeat = seat;
    hs.turnLeft = TURN_S;
    hs.doubled = false;
    hs.botAt = BOT_MIN + BOT_STEP * this.hostRng.int(0, BOT_SPAN);
    hs.face = this.rollFace(seat);
    const pid = this.seats[seat];
    const bot = this.bots.find((b) => b.seat === seat);
    const human = pid !== null && !isBot(pid) && !hs.away[seat];
    if (bot) hs.doubled = R.botDouble(bot.rng, bot.level as 1 | 2 | 3, c);
    if (human) void this.countdown(TURN_S, 'turn'); else this.cancelCountdown();
    void this.emit({ k: 'turn', seat, timeoutMs: human ? TURN_S * 1000 : Math.round(hs.botAt * 1000) });
    if (human && !hs.peeked && this.tableMod('peekCharges', 0) >= 1 && pid !== null) {
      hs.peeked = true;
      const take = R.isTake(hs.face as R.Face) ? this.hostRng.chance(0.8) : this.hostRng.chance(0.5);
      void this.emitPrivate(pid, { k: 'peek', take });
    }
  }

  /** HOST: the spin's face, fixed now. Luck and face-weight charms apply only when no other human is seated. */
  private rollFace(seat: number): string {
    const solo = this.humans().length <= 1;
    const extra: Partial<Record<R.Face, number>> = {};
    if (solo) for (const f of R.FACES) extra[f] = this.mod(`m.teetotum.faceWeight.${f}` as ModHook, 0);
    const weights = R.faceWeights(extra);
    let face = R.drawFace(this.hostRng, weights);
    const spinner = this.seats[seat];
    if (solo && spinner !== null && !isBot(spinner) && R.isPut(face) && this.hostRng.chance(R.luckChance(this.luck()))) {
      face = R.drawFace(this.hostRng, weights);
    }
    return face;
  }

  private beginSpin(): void {
    const hs = this.hs;
    if (hs.phase !== 'turn') return;
    const durMs = Math.round((SPIN_MIN_S + this.hostRng.float(0, SPIN_SPAN_S)) * 1000);
    hs.phase = 'spin';
    hs.waitLeft = durMs / 1000;
    this.cancelCountdown();
    void this.emit({ k: 'spin', seat: hs.turnSeat, face: hs.face, durMs, precessSeed: this.hostRng.int(1, 1000000), doubled: hs.doubled });
  }

  /** HOST: land the spin in the pure cycle, pay nothing yet (takes wait for the end of the cycle). */
  private applySpin(): void {
    const hs = this.hs, c = hs.cycle;
    if (!c || hs.phase !== 'spin') return;
    const seat = hs.turnSeat;
    const step = R.spin(c, seat, hs.face as R.Face, hs.doubled, (s, amt) => this.chargeSeat(s, amt), this.cycleOpts());
    hs.phase = 'apply';
    hs.waitLeft = APPLY_S;
    void this.emit({ k: 'apply', seat, face: step.face, moves: step.moves, pot: c.pot, live: [...c.live], spins: c.spins });
  }

  private afterApply(): void {
    const hs = this.hs, c = hs.cycle;
    if (!c) return;
    if (c.done) { this.settleCycle(); return; }
    this.startTurn(R.nextSeat(c, hs.turnSeat));
  }

  /** After the end card: the next cycle starts at once while a human is still in; otherwise the table goes idle. */
  private afterEnd(): void {
    const hs = this.hs;
    hs.cycle = null;
    hs.phase = 'bet';
    hs.turnSeat = -1;
    hs.face = '';
    hs.timer = 0;
    this.tidyBots();
    if (this.humans().some((h) => hs.seats[h.seat].ready)) { this.startCycle(); return; }
    void this.emit({ k: 'clear' });
  }

  // ── HOST clock ───────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'bet':
        if (hs.timer > 0 && (hs.timer -= dt) <= 0) { hs.timer = 0; this.startCycle(); }
        break;
      case 'ante':
        if ((hs.waitLeft -= dt) <= 0 && hs.cycle) this.startTurn(hs.cycle.live[this.hostRng.int(0, hs.cycle.live.length - 1)]);
        break;
      case 'turn': {
        const seat = hs.turnSeat;
        const pid = this.seats[seat] ?? null;
        const auto = pid === null || isBot(pid) || hs.away[seat];
        if (auto) { if ((hs.botAt -= dt) <= 0) this.beginSpin(); } else if ((hs.turnLeft -= dt) <= 0) this.beginSpin();
        break;
      }
      case 'spin':
        if ((hs.waitLeft -= dt) <= 0) this.applySpin();
        break;
      case 'apply':
        if ((hs.waitLeft -= dt) <= 0) this.afterApply();
        break;
      case 'end':
        if ((hs.waitLeft -= dt) <= 0) this.afterEnd();
        break;
    }
  }

  // ── seats ────────────────────────────────────────────────────────────────────────────────────
  /** Leaving: a seat in the bet phase just drops out; mid-cycle the seat is auto-spun (its stake stays in the pot). */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) this.parts.bots[seat]?.setVisible(false);
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs;
      if (hs.seats[seat].ready) { hs.seats[seat] = { ready: false }; this.readyChanged(seat, false); }
      if (hs.phase !== 'bet' && hs.cycle?.live.includes(seat)) {
        hs.away[seat] = true;
        void this.emit({ k: 'away', seat });
        if (hs.turnSeat === seat) hs.botAt = Math.min(hs.botAt, BOT_MIN);
      }
      this.tidyBots();
    }
    if (local) { this.hud(null); this.seatHud?.hide(); this.leaveAfter = false; }
    this.refresh();
  }

  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) this.parts.bots[seat]?.setVisible(true);
    if (this.isHost && !isBot(pid)) this.tidyBots();
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.hud(null);
      this.seatHud?.show();
      this.hudSig = '';
      this.repaintAll();
      this.showHud();
    }
  }

  // ── presentation (every peer) ────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const st = this.st, p = this.parts, fast = pc.fast;
    switch (ev.k) {
      case 'ready': {
        st.seats[ev.seat].ready = ev.on;
        st.ante = ev.ante;
        this.sfx('chip');
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'ante': {
        st.phase = 'ante'; st.ante = ev.ante; st.pot = ev.pot; st.golden = ev.golden;
        st.end = null; st.turn = -1; st.face = ''; st.doubled = false; st.rake = 0;
        st.seats.forEach((x, s) => { x.live = ev.seats.includes(s); x.stake = 0; x.won = 0; });
        ev.seats.forEach((s) => { st.seats[s].stake = ev.ante; });
        p.goldGlow.visible = ev.golden >= 0;
        this.sfx('coinPour');
        if (!fast) await Promise.all(ev.seats.map((s) => this.coinFlight(s, true)));
        this.repaintPot(ev.pot, ev.ante);
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'turn': {
        st.phase = 'turn'; st.turn = ev.seat; st.doubled = false; st.face = '';
        this.lampsFor();
        this.refresh();
        if (this.localSeat === ev.seat) this.sfx('bell');
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'peek': {
        await this.wobble(ev.take, fast);
        return;
      }
      case 'double': {
        st.doubled = true;
        this.sfx('chime');
        this.ctx.fx.popText(p.top, this.t('double'), GOLD, { dur: 0.9, rise: 0.25, scale: 1.1 });
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'spin': {
        st.phase = 'spin'; st.face = ev.face; st.doubled = ev.doubled;
        this.lampsFor();
        this.refresh();
        await this.spinTop(ev, fast);
        return;
      }
      case 'apply': {
        st.phase = 'apply';
        st.turn = -1;
        st.pot = ev.pot;
        st.seats.forEach((x, s) => { x.live = ev.live.includes(s); });
        for (const m of ev.moves) {
          if (m.delta > 0) st.seats[m.seat].stake += m.delta; else st.seats[m.seat].won += -m.delta;
        }
        this.lampsFor();
        if (!fast) await Promise.all(ev.moves.map((m) => this.coinFlight(m.seat, m.delta > 0)));
        this.repaintPot(ev.pot, st.ante);
        this.faceFx(ev.face as R.Face, ev.seat, fast);
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'end': {
        st.phase = 'end'; st.turn = -1; st.end = ev.rows; st.pot = ev.pot; st.rake = ev.rake;
        p.goldGlow.visible = false;
        for (const r of ev.rows) { st.seats[r.seat].stake = r.stake; st.seats[r.seat].won = r.won; }
        const me = this.localSeat;
        for (const r of ev.rows) {
          if (r.won <= 0) continue;
          this.ctx.fx.popText(p.potBowl, `+${fmtCoins(r.won)}`, GOLD, { dur: 1.2, rise: 0.3, scale: 1.1 });
          if (r.seat === me) void this.celebrate(juiceTier(r.won, r.stake || 1));
        }
        if (ev.split) this.ctx.fx.popText(p.potBowl, this.t('split'), GOLD, { dur: 1.0, rise: 0.25, scale: 1 });
        if (me >= 0 && !ev.rows.some((r) => r.seat === me && r.won > 0) && ev.rows.some((r) => r.seat === me)) this.commiserate();
        const mineRow = ev.rows.find((r) => r.seat === me);
        if (mineRow) {
          const net = mineRow.won - mineRow.stake;
          this.seatHud?.result(mineRow.won <= 0 ? 'lose' : net === 0 ? 'push' : net > 0 ? 'win' : 'lose', net, 1.5);
        }
        this.repaintPot(0, st.ante);
        this.lampsFor();
        this.refresh();
        if (this.leaveAfter && me >= 0) { this.leaveAfter = false; this.requestStandUp(); }
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'away':
        this.refresh();
        return;
      case 'clear': {
        // idle table: keep who is sat in (the `ready` events own that), drop the cycle
        const ready = st.seats.map((x) => x.ready);
        this.st = freshPub();
        this.st.seats.forEach((x, s) => { x.ready = ready[s]; });
        p.goldGlow.visible = false;
        this.repaintAll();
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
    }
  }

  /** The top spins upright, precesses, then lays on its side with the chosen face up; the rattle stops dead. */
  private async spinTop(ev: Extract<Ev, { k: 'spin' }>, fast: boolean): Promise<void> {
    const p = this.parts;
    const face = ev.face as R.Face;
    const target = faceYaw(face);
    const y0 = p.topYaw.rotation.y;
    const turns = 4 + Math.floor((ev.precessSeed % 3));
    const yEnd = y0 + turns * TWO_PI + (((target - y0) % TWO_PI) + TWO_PI) % TWO_PI;
    if (fast) {
      p.topYaw.rotation.y = yEnd;
      p.topTilt.rotation.x = 0;
      p.topTilt.rotation.z = Math.PI / 2;
      this.ctx.fx.popText(p.top, GLYPH[face], 0xf7ecc4, { dur: 0.6, rise: 0.2, scale: 1 });
      return;
    }
    // stand the top up from wherever it lay, then hum and spin
    const z0 = p.topTilt.rotation.z;
    await this.anim(0.25, (k) => { p.topTilt.rotation.z = z0 * (1 - k); }, 'outCubic');
    const spinS = Math.max(0.5, ev.durMs / 1000 - 1.0);
    const hum = this.ctx.audio.play('motor', { loop: true, pos: p.top, vol: 0.6 });
    await this.anim(spinS, (k) => {
      p.topYaw.rotation.y = y0 + (yEnd - y0) * (1 - Math.pow(1 - k, 3));
      p.topTilt.rotation.x = Math.sin(k * 26 + ev.precessSeed) * 0.05 * (1 - k);
    }, 'linear');
    await this.anim(0.35, (k) => {
      p.topTilt.rotation.x = 0;
      p.topTilt.rotation.z = (Math.PI / 2) * k * k;
    }, 'linear');
    hum?.stop(0.1);
    this.sfx('thud');
    p.topTilt.rotation.z = Math.PI / 2;
    p.topYaw.rotation.y = yEnd;
    const clicks = 12;
    for (let i = 0; i < clicks; i++) {
      this.sfx('click');
      await this.wait(0.03 + i * 0.012);
    }
    this.ctx.fx.popText(p.top, GLYPH[face], 0xf7ecc4, { dur: 1.0, rise: 0.25, scale: 1.2 });
  }

  /** Private peek (charm): a short wobble of the top toward a take (or away from it). */
  private async wobble(take: boolean, fast: boolean): Promise<void> {
    const p = this.parts;
    if (fast) return;
    const dir = take ? 1 : -1;
    await this.anim(0.5, (k) => { p.topTilt.rotation.x = Math.sin(k * Math.PI * 3) * 0.06 * dir * (1 - k); }, 'linear');
    p.topTilt.rotation.x = 0;
  }

  /** Face-specific juice after the chips moved: ALL+ groans, ALL avalanches, takes pour, golden faces flare. */
  private faceFx(face: R.Face, seat: number, fast: boolean): void {
    const p = this.parts, me = seat === this.localSeat;
    if (face === 'none') { this.sfx('thud'); return; }
    if (R.isPut(face)) {
      this.sfx('chip');
      if (face === 'pa') { this.sfx('creak'); if (!fast) this.ctx.fx.shake(0.006, 0.2); }
      return;
    }
    if (face === 'all') {
      this.sfx('win2');
      this.sfx('coinShower');
      if (!fast) { this.ctx.fx.shake(0.016, 0.35); this.ctx.fx.sparks(p.potBowl, 18, GOLD); }
      if (me) void this.celebrate('big');
      return;
    }
    this.sfx(face === 'half' ? 'coinShower' : 'coinPour');
    if (this.st.golden >= 0 && R.FACES[this.st.golden] === face) {
      this.sfx('jackpot');
      this.ctx.fx.popText(p.potBowl, this.t('golden'), GOLD, { dur: 1.0, rise: 0.3, scale: 1.2 });
    }
  }

  /** One chip flies from a seat's stack into the bowl (`into`) or from the bowl back to the stack. */
  private coinFlight(seat: number, into: boolean): Promise<void> {
    const p = this.parts;
    const stack = p.stacks[seat].position.clone();
    const bowl = new THREE.Vector3(p.centre.x, p.feltY + 0.03, p.centre.z);
    const from = into ? stack : bowl;
    const to = into ? bowl : stack;
    const id = p.potChips.add(5, from);
    return p.potChips.move(id, to, 0.3, 0.12).then(() => { p.potChips.remove(id); });
  }

  /** The bowl's pile, n chips for pot / ante (cosmetic; capped at 60 visible chips). */
  private repaintPot(pot: number, ante: number): void {
    const p = this.parts;
    p.potChips.clear();
    const n = Math.min(60, Math.max(0, Math.round(pot / Math.max(1, ante))));
    for (let k = 0; k < n; k++) {
      p.potChips.add(5, new THREE.Vector3(p.centre.x + (((k * 37) % 7) - 3) * 0.006, p.feltY + 0.012 + k * 0.0032, p.centre.z + (((k * 53) % 5) - 2) * 0.006));
    }
  }

  /** Lit turn lamp on the seat whose turn it is. */
  private lampsFor(): void {
    const p = this.parts;
    p.turnLamps.forEach((l, i) => l.setOn(this.st.turn === i));
  }

  /** Lay the pot pile, the golden glow and the lamps out from the public state (the top keeps its pose). */
  private repaintAll(): void {
    const p = this.parts;
    p.goldGlow.visible = this.st.golden >= 0;
    this.repaintPot(this.st.pot, this.st.ante || this.def.minBet);
    this.lampsFor();
    this.drawBoard();
    this.drawRails();
  }

  // ── visuals: board screen, rail meters, HUD ──────────────────────────────────────────────────
  private shownSecond = -1;
  frame(): void {
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.drawBoard(); if (this.isLocalOccupant) this.showHud(); }
  }

  onLang(): void { this.drawBoard(); this.drawRails(); this.hudSig = ''; if (this.isLocalOccupant) this.showHud(); }

  private refresh(): void {
    this.drawBoard(); this.drawRails(); this.lampsFor();
    this.clipSeatView();
    if (this.isLocalOccupant) this.showHud();
  }

  /**
   * Seat view standard: the seated bots and the stools stand between the seated player's camera and the felt and fill the
   * frame. For the local seated player only they are clipped (this client's picture only); the felt, bowl and top stay.
   */
  private clipSeatView(): void {
    const seated = this.isLocalOccupant;
    this.parts.bots.forEach((bot, s) => {
      const occ = this.seats[s];
      bot.setVisible(occ !== null && isBot(occ) && !seated);
    });
    this.parts.stools.forEach((st) => { st.visible = !seated; });   // the chrome stool bases stay out of the seat view
  }

  private statusText(): string {
    const st = this.st, seat = this.localSeat;
    const mine = seat >= 0 ? st.seats[seat] : undefined;
    switch (st.phase) {
      case 'bet':
        if (mine && mine.ready) return this.t('sWait');
        return this.t('sBet', { a: fmtCoins(this.anteHere()) });
      case 'ante': return this.t('sAnte');
      case 'turn':
        if (st.turn === seat && seat >= 0) return this.t('sTurn');
        return st.turn >= 0 ? this.t('sWatch', { n: st.turn + 1 }) : this.t('sSpin');
      case 'spin': case 'apply': return this.t('sSpin');
      case 'end': return this.t('sEnd');
    }
  }

  private drawBoard(): void {
    const st = this.st, p = this.parts;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    p.screen.draw((g, w) => {
      g.fillStyle = '#080b08'; g.fillRect(0, 0, w.w, w.h);
      w.text(this.statusText(), 96, 2, { font: 'px5', color: '#7dff7a', align: 'center' });
      w.text(this.t('ante', { a: fmtCoins(st.ante || this.anteHere()) }), 4, 22, { font: 'px5', color: '#e0c060' });
      if (st.pot > 0) w.text(this.t('pot', { pot: fmtCoins(st.pot) }), 188, 22, { font: 'px5', color: '#e0c060', align: 'right' });
      if (left > 0) w.text(String(left), 188, 2, { font: 'px5', color: '#ffffff', align: 'right' });
      if (st.phase === 'turn' && st.doubled) w.text('x2', 4, 42, { font: 'px5', color: '#ff8a3d' });
      st.seats.forEach((x, s) => {
        const occ = this.seats[s] !== null;
        const col = st.turn === s ? '#ffd040' : x.live ? '#c8ffc8' : occ ? '#6a7a6a' : '#3a3a3a';
        w.text(`S${s + 1}`, 14 + s * 30, 58, { font: 'px5', color: col, align: 'center' });
      });
    });
    this.lampsFor();
  }

  private drawRails(): void {
    this.st.seats.forEach((x, s) => {
      const meter = this.parts.railMeters[s];
      if (!meter) return;
      meter.draw((g, w) => {
        g.fillStyle = '#080b08'; g.fillRect(0, 0, w.w, w.h);
        w.text(`${fmtCoins(x.stake)}`, 4, 14, { font: 'px5', color: '#e0c060' });
        w.text(`${fmtCoins(x.won)}`, 4, 30, { font: 'px5', color: x.won > 0 ? '#7dff7a' : '#c8c8c8' });
      });
    });
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Banner, key numbers and valid controls for the local player. Redraws only when something changed. */
  private showHud(): void {
    const sh = this.seatHud;
    const seat = this.localSeat;
    if (!sh || seat < 0) return;
    const st = this.st, mine = st.seats[seat];
    const myTurn = st.phase === 'turn' && st.turn === seat;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const wallet = this.ctx.run.wallet();
    const ante = this.anteHere();
    const sig = [st.phase, st.turn, st.doubled, st.face, st.pot, st.ante, mine.ready, mine.live, mine.stake, mine.won,
      seat, this.leaveAfter, left, ante, wallet].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    sh.goal({ k: 'm.teetotum.goal' });

    // STATE: sit in, the antes, whose spin it is, the top, the end of the cycle
    const secs: Txt | undefined = left > 0 ? { k: 'm.teetotum.stSecs', v: { n: left } } : undefined;
    if (myTurn) sh.state({ k: 'm.teetotum.stYourSpin' }, 'good', secs);
    else if (st.phase === 'turn') sh.state({ k: 'm.teetotum.stOther', v: { n: st.turn + 1 } }, 'cyan');
    else if (st.phase === 'bet') {
      if (mine.ready) sh.state({ k: 'm.teetotum.stReady' }, 'good', secs);
      else sh.state({ k: 'm.teetotum.stSitIn', v: { a: fmtCoins(ante) } }, 'gold', secs);
    } else if (st.phase === 'ante') sh.state({ k: 'm.teetotum.stAnte' }, 'neutral');
    else if (st.phase === 'spin' || st.phase === 'apply') sh.state({ k: 'm.teetotum.stSpin' }, 'neutral');
    else sh.state({ k: 'm.teetotum.stEnd' }, 'neutral');

    // KEY NUMBERS
    const nums: HudNumber[] = [
      { label: { k: 'm.teetotum.nAnte' }, value: fmtCoins(st.ante > 0 ? st.ante : ante), tone: 'gold' },
      { label: { k: 'm.teetotum.nPot' }, value: fmtCoins(st.pot), tone: 'gold' },
    ];
    if (mine.live || mine.stake > 0) nums.push({ label: { k: 'm.teetotum.nIn' }, value: fmtCoins(mine.stake), tone: 'cyan' });
    if (mine.won > 0) nums.push({ label: { k: 'm.teetotum.nWon' }, value: fmtCoins(mine.won), tone: 'good' });
    if (st.face) nums.push({ label: { k: 'm.teetotum.nFace' }, value: GLYPH[st.face as R.Face] ?? '-', tone: 'neutral' });
    nums.push({ label: { k: 'm.teetotum.nBalance' }, value: fmtCoins(wallet), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (myTurn) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.teetotum.cSpin' }, action: 'primary', primary: true });
      if (!st.doubled) ctrl.push({ key: this.k('double'), label: { k: 'm.teetotum.cDouble' }, action: 'double' });
    } else if (!mine.ready) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.teetotum.cSitIn' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.teetotum.cAnte' }, action: 'betUp' });
    }
    if (mine.ready) {
      ctrl.push({ key: this.k('n1'), label: { k: 'm.teetotum.cSitOut' }, action: 'n1' });
      if (st.phase !== 'end') ctrl.push({ key: this.k('collect'), label: { k: 'm.teetotum.cAfter' }, action: 'collect' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.teetotum.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.teetotum.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── snapshots: public state for everyone, the host's own timers and cycle only for a host save ──
  getSnapshot(forPid?: PlayerId): Snap {
    const st = JSON.parse(JSON.stringify(this.st)) as Pub;
    const secret = forPid === undefined ? { hs: JSON.stringify(this.hs) } : null;
    return { st, secret };
  }

  applySnapshot(sn: Snap): void {
    this.st = JSON.parse(JSON.stringify(sn.st)) as Pub;
    if (sn.secret && this.isHost) this.hs = JSON.parse(sn.secret.hs) as Host;
    this.repaintAll();
  }
}
