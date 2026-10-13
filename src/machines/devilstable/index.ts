/**
 * The Devil's Table — SHELLS duel (`devilstable`, BRIEF Addendum 7, MACHINES_tables §5A). The main mode of the table;
 * the SIX CHAMBERS quick variant is not built in this pass.
 *
 * Shape (copy this for any host-resolved duel)
 *  - `TableBase`: seated players send `act()`; the HOST validates through `rules.ts` (pure) and `emit`s the public
 *    events; each peer's `present()` animates them. Hidden information (the magazine order) never leaves the host;
 *    Loupe / Burner Phone results are PRIVATE (`emitPrivate`), and `getSnapshot` carries only public state.
 *  - The Devil is a bot in seat 1 (`addBot`) that plays `rules.choose` on its own `bot.rng` with a 1.2–2.6 s think time.
 *    In PvP (2–4 humans) bots are removed and the last seat standing per round wins; the first to two rounds wins the match.
 *  - Solo: the stake pays 1.9× (Loaded Chip 3.8×) and up to three RIDES (double or nothing) before COLLECT.
 *    PvP: the pot N·S minus the 5 % rake goes to the match winner.
 *
 * Phases on the host: idle → bet (15 s window, or as soon as every seated human has staked) → pause (load / shot
 * beats) → play (turns: a human has 20 s, timeout = shoot yourself) → pause … → ride (solo win: R double / Q collect,
 * 15 s auto-collect) → pause → idle. Leaving mid-match forfeits the seat; leaving before the match refunds the stake.
 *
 * Controls (seated): primary = stake (before a match) · hold primary 0.8 s and release = fire at the aimed lantern ·
 * ← / → cycle the aim · 1–8 use the item in that tray slot · R ride · Q collect · RMB lower the gun · Z/X stake.
 */
import * as THREE from 'three';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { fmtCoins } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { Kit } from '@/kit/types';
import { SEAT_DIR, SLOTS, TOP, buildModel, type DevilParts } from './model';
import * as R from './rules';
import { STRINGS } from './strings';

// ── contract types (aliases, not interfaces: they must be assignable to `Json`) ───────────────────
type Ev =
  | R.Ev
  | { k: 'stake'; seat: number; S: number }
  | { k: 'match'; seats: number[]; S: number; ride: boolean }
  | { k: 'count'; live: number; blank: number }
  | { k: 'matchEnd'; winner: number; payout: number; ride: boolean; rides: number }
  | { k: 'collect'; seat: number; amount: number };
type Act = { k: 'stake'; S: number } | { k: 'item'; id: R.ItemId; target: number } | { k: 'fire'; target: number }
  | { k: 'ride' } | { k: 'collect' };
/** Public state every peer keeps (the presentation's view; also the late-join snapshot). */
type View = {
  inMatch: boolean; round: number; charges: number[]; items: R.ItemId[][]; live: number; blank: number; turn: number;
  wins: number[]; stake: number[]; S: number; seats: number[]; rides: number; gross: number; rider: number;
};
type Snap = View;

const BET_S = 15, TURN_S = 20, RIDE_S = 15;
const PAUSE_ITEM = 1.0, PAUSE_SHOT = 1.6, PAUSE_ROUND = 2.8, PAUSE_LOAD = 2.6, PAUSE_END = 3.0;
const THINK: [number, number] = [1.2, 2.6];
const GOLD = 0xffd040, RED = 0xff3a3a, GLASS = 0xffd9a0, GREY = 0x9a9a9a;
const HOLD_S = 0.8;
/** Kit prop that stands in for each item in its tray slot (`kit.prop` ids). */
const ITEM_PROP: Readonly<Record<R.ItemId, string>> = {
  loupe: 'glass', tonic: 'tonic', cuffs: 'key', mint: 'mint_tin', hacksaw: 'gavel', burner: 'phone',
  inverter: 'watch', adrenaline: 'cigar', pills: 'cane', chip: 'envelope', mirror: 'lantern', coin: 'ledger',
};

export const playHeadless = R.playHeadless;

export const def: MachineDef = {
  id: 'devilstable',
  category: 'duel',
  slotSize: 'L',
  zone: 'parlour',
  seats: 4,
  shared: true,
  minBet: 20, maxBet: 5000, betSteps: [20, 50, 100, 250, 500, 1000, 2500, 5000],
  maxPayoutMult: Math.pow(R.CHIP_PAYOUT, 1 + R.MAX_RIDES),
  rtp: 0.95,
  tier: 1,
  actionCost: 2,
  headless: R.playHeadless,
  tags: ['duel', 'table', 'devil', 'shells'],
  party: { minPlayers: 2, maxPlayers: 4, bots: true, hidden: true, turnTimerS: TURN_S },
  modHooks: {
    'm.devilstable.misfireAdd': 'Added to the misfire luck (L/100), cap 0.5. A LIVE shot at a lucky seat misfires once per round.',
  },
  strings: STRINGS,
};

const freshView = (): View => ({
  inMatch: false, round: 0, charges: [0, 0, 0, 0], items: [[], [], [], []], live: 0, blank: 0, turn: -1,
  wins: [0, 0, 0, 0], stake: [0, 0, 0, 0], S: 0, seats: [], rides: 0, gross: 0, rider: -1,
});

/** Host-only authority state: the rules `Game` (magazine order included) and the table clocks. Never sent. */
type Phase = 'idle' | 'bet' | 'pause' | 'play' | 'ride';
interface Host {
  phase: Phase; timer: number;
  ante: boolean[]; S0: number; matchS: number;
  matchSeats: number[]; solo: boolean;
  game: R.Game | null;
  rides: number; gross: number; rider: number;
  turnSeat: number; turnLeft: number; thinkLeft: number;
}
const freshHost = (): Host => ({
  phase: 'idle', timer: 0, ante: [false, false, false, false], S0: 0, matchS: 0,
  matchSeats: [], solo: false, game: null, rides: 0, gross: 0, rider: -1, turnSeat: -1, turnLeft: 0, thinkLeft: 0,
});

/** Yaw that points the coach gun at seat `t`'s lantern (barrels run along local +Z). */
const yawTo = (t: number): number => Math.atan2(SEAT_DIR[t][0], SEAT_DIR[t][1]);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const lanternAt = (t: number): THREE.Vector3 => new THREE.Vector3(SEAT_DIR[t][0] * 0.58, 1.0, SEAT_DIR[t][1] * 0.58);

export default class DevilsTable extends TableBase<DevilParts, Ev, Snap, Act> {
  private view: View = freshView();
  private host: Host = freshHost();
  private mine: R.Shell | null = null;      // the chamber this seat has seen (Loupe): private, local only
  private shattered: boolean[] = [false, false, false, false];   // lanterns hit by a BANG this round
  private trayKey: string[][] = [[], [], [], []];   // the item currently shown in each tray slot ('' = empty)
  private gunYaw = 0;
  private aim = -1;
  private holding = false;
  private holdT = 0;
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;
  /** The stake this seat put in for the current match (net result = payout minus this). */
  private myStake = 0;

  protected createModel(kit: Kit): MachineModel<DevilParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (!e.down) {
      if ((a === 'primary' || a === 'confirm') && this.holding) this.releaseShot();
      else if (a === 'secondary' && this.holding) { this.holding = false; this.holdT = 0; this.showHud(); }
      return;
    }
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    const s = this.localSeat, v = this.view;
    if (s < 0) return;
    switch (a) {
      case 'primary': case 'confirm':
        if (!v.inMatch && v.stake[s] <= 0) this.act({ k: 'stake', S: this.bet });
        else if (v.inMatch && v.turn === s) { this.holding = true; this.holdT = 0; this.showHud(); }
        else if (v.rider === s) this.act({ k: 'ride' });
        break;
      case 'double': case 'alt': if (v.rider === s) this.act({ k: 'ride' }); break;
      case 'collect': if (v.rider === s) this.act({ k: 'collect' }); break;
      case 'left': this.cycleAim(-1); break;
      case 'right': this.cycleAim(1); break;
      case 'secondary': if (this.holding) { this.holding = false; this.holdT = 0; this.showHud(); } break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': case 'n7': case 'n8':
        this.useSlot(Number(a.slice(1)) - 1);
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (v.inMatch || v.stake[s] > 0) break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
    }
  }

  private releaseShot(): void {
    const held = this.holdT;
    this.holding = false; this.holdT = 0;
    if (held >= HOLD_S && this.aim >= 0) this.act({ k: 'fire', target: this.aim });
    else this.sfx('lever', { vol: 0.4 });
    this.showHud();
  }

  private cycleAim(d: 1 | -1): void {
    const v = this.view;
    const seats = v.seats.filter((t) => v.charges[t] > 0);
    if (!seats.length || v.turn !== this.localSeat) return;
    const i = Math.max(0, seats.indexOf(this.aim));
    this.aimAt(seats[(i + d + seats.length) % seats.length]);
  }

  private aimAt(t: number): void {
    this.aim = t;
    this.gunYaw = yawTo(t);
    this.sfx('click', { vol: 0.5 });
    this.showHud();
  }

  private useSlot(i: number): void {
    const s = this.localSeat, v = this.view;
    const id = v.items[s]?.[i];
    if (!id || !v.inMatch || v.turn !== s) return;
    const needs = id === 'cuffs' || id === 'adrenaline';
    const target = needs ? this.targetOrFoe() : -1;
    if (needs && target < 0) { this.toast(this.t('noTarget'), 'warn'); return; }
    this.act({ k: 'item', id, target });
  }

  /** The aimed seat if it is another live seat, else the first live opponent. */
  private targetOrFoe(): number {
    const v = this.view, s = this.localSeat;
    if (this.aim >= 0 && this.aim !== s && v.charges[this.aim] > 0) return this.aim;
    return v.seats.find((t) => t !== s && v.charges[t] > 0) ?? -1;
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const h = this.host;
    switch (a.k) {
      case 'stake': {
        if (h.phase !== 'idle' && h.phase !== 'bet') { this.nak(pid, rid, 'm.devilstable.busy'); return; }
        if (h.ante[seat]) { this.nak(pid, rid, 'm.devilstable.busy'); return; }
        if (!this.betLadder().includes(a.S) || (h.phase === 'bet' && a.S !== h.S0)) { this.nak(pid, rid, 'm.devilstable.badBet'); return; }
        if (!this.chargeSeat(seat, a.S)) { this.nak(pid, rid, 'common.noFunds'); return; }
        if (h.phase === 'idle') { h.phase = 'bet'; h.timer = BET_S; h.S0 = a.S; }
        h.ante[seat] = true;
        void this.emit({ k: 'stake', seat, S: a.S });
        if (this.humans().every((x) => h.ante[x.seat])) this.closeBets();
        return;
      }
      case 'item': case 'fire': {
        const g = h.game;
        if (h.phase !== 'play' || !g || g.turn !== seat) { this.nak(pid, rid, 'm.devilstable.notYourTurn'); return; }
        const c: R.Choice = a.k === 'item' ? { k: 'item', id: a.id, target: a.target } : { k: 'fire', target: a.target };
        if (!this.applyChoice(seat, c)) this.nak(pid, rid, 'm.devilstable.illegal');
        return;
      }
      case 'ride':
        if (h.phase !== 'ride' || seat !== h.rider) { this.nak(pid, rid, 'm.devilstable.illegal'); return; }
        h.rides++; h.matchS = h.gross; h.gross = 0; h.rider = -1;
        this.startMatch(true);
        return;
      case 'collect':
        if (h.phase !== 'ride' || seat !== h.rider) { this.nak(pid, rid, 'm.devilstable.illegal'); return; }
        this.collectRide(seat, pid);
        return;
    }
  }

  /** Stakes are in: seat the match (a Devil seats itself for a solo player) or refund a lone stake. */
  private closeBets(): void {
    const h = this.host;
    if (!h.ante.some(Boolean)) { h.phase = 'idle'; return; }
    this.startMatch(false);
  }

  private startMatch(ride: boolean): void {
    const h = this.host;
    if (!ride) {
      const humans = this.humans().filter((x) => h.ante[x.seat]).map((x) => x.seat);
      h.solo = humans.length === 1;
      if (h.solo && this.seats[1] === null) this.addBot(1, this.t('bot'));
      if (!h.solo) for (const b of [...this.bots]) this.removeBot(b.seat);
      h.matchSeats = this.seats.flatMap((pid, s) => (h.ante[s] || (pid !== null && isBot(pid)) ? [s] : []));
      if (h.matchSeats.length < 2) {                                // nobody across the table: refund and close
        for (const s of humans) {
          this.paySeat(s, h.S0, { bet: h.S0, tier: 'push', tags: ['refund'] });
          h.ante[s] = false;
          void this.emit({ k: 'stake', seat: s, S: 0 });
        }
        h.phase = 'idle';
        return;
      }
      h.matchS = h.S0;
      h.rides = 0;
    }
    const ms = h.matchSeats;
    const game = R.newGame(this.seats.map((pid, s) => ({
      active: ms.includes(s),
      human: pid !== null && !isBot(pid),
      luck: pid !== null && !isBot(pid) && s === this.localSeat ? this.luck() + 100 * this.mod(R.HOOK_MISFIRE, 0) : 0,
    })));
    h.game = game;
    this.flush([{ k: 'match', seats: ms, S: h.matchS, ride }]);
    this.flush(R.startRound(game, this.hostRng, 1));
    h.phase = 'pause'; h.timer = PAUSE_LOAD;
  }

  /** Apply one choice from a seat on turn. Returns false when the rules refuse it (nothing changed). */
  private applyChoice(seat: number, c: R.Choice): boolean {
    const h = this.host, g = h.game;
    if (!g) return false;
    const ev = c.k === 'item' ? R.use(g, this.hostRng, seat, c.id, c.target) : R.fire(g, this.hostRng, seat, c.target);
    if (!ev) return false;
    this.flush(ev);
    h.phase = 'pause';
    h.timer = ev.some((e) => e.k === 'roundEnd') ? PAUSE_ROUND : c.k === 'fire' ? PAUSE_SHOT : PAUSE_ITEM;
    return true;
  }

  /** Emit the rules' events: peeks go to their owner only, the bot's own private peeks are dropped. */
  private flush(evs: Ev[]): void {
    const g = this.host.game;
    for (const e of evs) {
      if (e.k === 'turn') continue;                              // the host announces turns itself (see playTurn)
      if (e.k === 'peek' || e.k === 'whisper') {
        const pid = this.seats[e.seat];
        if (pid !== null && !isBot(pid)) void this.emitPrivate(pid, e);
        continue;
      }
      void this.emit(e);
    }
    if (g) void this.emit({ k: 'count', live: g.live, blank: g.blank });
  }

  private collectRide(seat: number, pid: PlayerId | null): void {
    const h = this.host;
    const amount = h.gross;
    this.paySeat(seat, amount, { bet: h.S0, tags: ['devilstable'] }, pid);
    void this.emit({ k: 'collect', seat, amount });
    h.gross = 0; h.rider = -1;
    this.endMatch();
  }

  /** The match is over: pay out (solo rides first), show it, then go back to the bet window. */
  private finishMatch(winner: number): void {
    const h = this.host, g = h.game!;
    if (h.solo) {
      const hs = h.matchSeats.find((s) => g.seats[s].human) ?? -1;
      if (winner === hs) {
        const chip = g.seats[winner].chip;
        const amount = R.gross(h.matchS, chip);
        if (h.rides < R.MAX_RIDES) {
          h.phase = 'ride'; h.rider = hs; h.gross = amount; h.timer = RIDE_S;
          void this.emit({ k: 'matchEnd', winner, payout: amount, ride: true, rides: h.rides });
          return;
        }
        this.paySeat(hs, amount, { bet: h.S0, tags: chip ? ['chip'] : [] });
        void this.emit({ k: 'matchEnd', winner, payout: amount, ride: false, rides: h.rides });
      } else {
        if (hs >= 0) this.paySeat(hs, 0, { bet: h.S0 });
        void this.emit({ k: 'matchEnd', winner, payout: 0, ride: false, rides: h.rides });
      }
    } else {
      const pot = R.pvpPot(h.S0, h.matchSeats.length);
      for (const s of h.matchSeats) {
        if (s === winner) this.paySeat(s, pot, { bet: h.S0 });
        else if (g.seats[s].human) this.paySeat(s, 0, { bet: h.S0 });
      }
      void this.emit({ k: 'matchEnd', winner, payout: winner >= 0 ? pot : 0, ride: false, rides: 0 });
    }
    this.endMatch();
  }

  private endMatch(): void {
    const h = this.host;
    if (h.phase === 'ride' && h.rider >= 0) return;
    h.ante = [false, false, false, false]; h.game = null; h.rides = 0; h.matchSeats = []; h.turnSeat = -1;
    h.phase = 'pause'; h.timer = PAUSE_END;
  }

  /** After every beat: next round / finish, or hand the turn on. */
  private afterPause(): void {
    const h = this.host, g = h.game;
    h.turnSeat = -1;
    if (!g) { h.phase = 'idle'; return; }
    if (g.roundDone) {
      const w = R.matchWinner(g);
      if (w >= 0) { this.finishMatch(w); return; }
      this.flush(R.startRound(g, this.hostRng, g.round + 1));
      h.phase = 'pause'; h.timer = PAUSE_LOAD;
      return;
    }
    h.phase = 'play';
  }

  /** Ready countdown, pauses, bot AI and turn timers. Host only. */
  hostTick(dt: number): void {
    const h = this.host;
    switch (h.phase) {
      case 'bet': if ((h.timer -= dt) <= 0) this.closeBets(); break;
      case 'pause': if ((h.timer -= dt) <= 0) this.afterPause(); break;
      case 'ride': if ((h.timer -= dt) <= 0) this.collectRide(h.rider, this.seats[h.rider]); break;
      case 'play': this.playTurn(dt); break;
    }
  }

  private isBotSeat(s: number): boolean { const pid = this.seats[s]; return pid !== null && isBot(pid); }

  private playTurn(dt: number): void {
    const h = this.host, g = h.game;
    if (!g || g.roundDone || g.turn < 0) return;
    const s = g.turn;
    if (h.turnSeat !== s) {                                       // a new turn: announce, arm the clocks
      h.turnSeat = s;
      h.turnLeft = TURN_S;
      h.thinkLeft = THINK[0] + this.hostRng.next() * (THINK[1] - THINK[0]);
      void this.emit({ k: 'turn', seat: s });
    }
    if (this.isBotSeat(s)) {
      if ((h.thinkLeft -= dt) > 0) return;
      const bot = this.bots.find((b) => b.seat === s);
      this.applyChoice(s, R.choose(g, s, bot ? bot.rng : this.hostRng, R.DEVIL_SKILL));
      return;
    }
    if ((h.turnLeft -= dt) <= 0) this.applyChoice(s, { k: 'fire', target: s });   // hesitated: shoot yourself
  }

  /** A seat was vacated (runs on every peer; the seat is already empty here). */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid)) {
      const h = this.host;
      if (h.phase === 'ride' && seat === h.rider) this.collectRide(seat, pid);
      else if (h.game && h.game.seats[seat].active) this.forfeitSeat(seat);
      else if (!h.game && h.ante[seat]) {
        this.paySeat(seat, h.S0, { bet: h.S0, tier: 'push', tags: ['refund'] }, pid);
        h.ante[seat] = false;
        void this.emit({ k: 'stake', seat, S: 0 });
      }
    }
    if (local) {
      this.mine = null; this.holding = false; this.myStake = 0;
      this.hud(null); this.seatHud?.hide();
    }
    this.paintAll();
  }

  /** A player walks away mid-match: their seat loses its charges, the turn moves on, a dead round is closed. */
  private forfeitSeat(seat: number): void {
    const h = this.host, g = h.game!;
    const S = g.seats[seat];
    S.active = false; S.charges = 0;
    this.forfeit(seat);
    if (g.turn === seat) g.turn = R.advance(g, seat);
    const evs: R.Ev[] = [{ k: 'charges', seats: g.seats.map((X) => X.charges) }];
    if (!g.roundDone && R.aliveCount(g) <= 1) {
      g.roundDone = true;
      const winner = g.seats.findIndex((_, i) => R.alive(g, i));
      if (winner >= 0) g.seats[winner].wins++;
      evs.push({ k: 'roundEnd', winner, round: g.round });
    }
    this.flush(evs);
    h.phase = 'pause'; h.timer = PAUSE_ROUND;
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('devilstable', this.tipLines());
    }
    this.paintAll();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── local clocks: the gun servo follows `gunYaw`; holding the trigger cocks the hammers ─────────
  tick(dt: number): void {
    const P = this.parts;
    const d = wrap(this.gunYaw - P.turntable.rotation.y);
    P.turntable.rotation.y += d * Math.min(1, dt * 7);
    if (this.holding) this.holdT += dt;
    const cock = this.holding ? Math.min(1, this.holdT / HOLD_S) * 0.6 : 0;
    for (const hm of P.hammers) hm.rotation.x = -cock;
  }

  // ── presentation (every peer, including the host) ─────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const v = this.view, P = this.parts, fx = this.ctx.fx;
    const local = (s: number): boolean => s === this.localSeat;
    switch (ev.k) {
      case 'stake':
        v.stake[ev.seat] = ev.S;
        if (ev.seat === this.localSeat) this.myStake = ev.S;
        if (ev.S > 0) { this.sfx('chip'); fx.sparks(P.lanterns[ev.seat], 6, GOLD); }
        this.paintAll();
        return;
      case 'match':
        v.inMatch = true; v.seats = [...ev.seats]; v.S = ev.S; v.wins = [0, 0, 0, 0]; v.rider = -1; v.gross = 0;
        if (!ev.ride) v.rides = 0;
        v.turn = -1; this.sfx('stinger', { vol: 0.6 });
        if (this.localSeat >= 0) this.aim = -1;
        this.paintAll();
        return;
      case 'round':
        v.round = ev.round; v.charges = [...ev.charges];
        this.shattered = [false, false, false, false];
        this.sfx('creak', { vol: 0.5 });
        this.paintAll();
        await this.beat(pc, 0.4);
        return;
      case 'load':
        v.live = ev.live; v.blank = ev.blank;
        for (const [seat, ids] of ev.items) v.items[seat] = [...v.items[seat], ...ids].slice(0, SLOTS);
        this.renderTrays();
        await this.showLoad(ev, pc);
        return;
      case 'turn':
        v.turn = ev.seat;
        if (local(ev.seat)) {
          this.aimAt(this.firstFoe(ev.seat));
          fx.glow(P.lanterns[ev.seat], GOLD, 0.25, 0.4);
          this.sfx('chime');
        } else if (this.isBotSeat(ev.seat)) {
          P.devil.lookAt(lanternAt(ev.seat), 0.4);
        }
        this.drawScreen();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'item': {
        const list = v.items[ev.seat], i = list.indexOf(ev.item);
        if (i >= 0) list.splice(i, 1);
        this.renderTrays();
        this.sfx(ev.item === 'coin' ? 'stamp' : 'sparkle', { vol: 0.7 });
        fx.popText(P.lanterns[ev.seat], this.t(`item_${ev.item}`), GOLD, { dur: 1, rise: 0.25 });
        if (ev.target >= 0) this.gunYaw = yawTo(ev.target);
        this.paintAll();
        await this.beat(pc, 0.7);
        return;
      }
      case 'eject':
        this.sfx('shellEject');
        fx.popText(P.lanterns[ev.seat], this.t('eject'), GREY, { dur: 0.9, rise: 0.2 });
        await this.ani(pc, 0.4, (k) => { P.shells[0].position.y = TOP + 0.035 + Math.sin(k * Math.PI) * 0.15; });
        P.shells[0].position.y = TOP + 0.035;
        return;
      case 'steal':
        v.items[ev.from] = v.items[ev.from].filter((id, i, all) => id !== ev.item || all.indexOf(id) !== i);
        v.items[ev.seat] = [...v.items[ev.seat], ev.item];
        this.renderTrays();
        fx.popText(P.lanterns[ev.seat], this.t('steal'), GOLD, { dur: 0.9, rise: 0.2 });
        return;
      case 'mirror':
        this.sfx('chime');
        fx.popText(P.lanterns[ev.seat], this.t('mirror'), GOLD, { dur: 0.9, rise: 0.2 });
        fx.glow(P.lanterns[ev.to], GOLD, 0.3, 0.5);
        return;
      case 'misfire':
        this.sfx('gunClick');
        fx.smoke(P.gun, 6);
        fx.popText(P.gun, this.t('misfire'), GREY, { dur: 1, rise: 0.2 });
        if (ev.seat === 1) void P.devil.gesture('shake');
        return;
      case 'shot':
        await this.presentShot(ev, pc);
        return;
      case 'charges': {
        const before = v.charges;
        v.charges = [...ev.seats];
        if (v.charges.some((c, s) => c < (before[s] ?? c))) this.sfx('defib', { vol: 0.7 });
        this.paintAll();
        return;
      }
      case 'roundEnd': {
        if (ev.winner >= 0) v.wins[ev.winner]++;
        this.drawScreen();
        if (this.localSeat >= 0 && v.seats.includes(this.localSeat)) {
          if (ev.winner === this.localSeat) this.seatHud?.result('win');
          else if (v.charges[this.localSeat] <= 0) this.seatHud?.result('lose');
        }
        if (ev.winner >= 0) {
          fx.popText(P.lanterns[ev.winner], this.t('sRound', { n: ev.round, name: this.seatName(ev.winner) }), GOLD, { dur: 1.4, rise: 0.3, scale: 1.2 });
          if (ev.winner === this.localSeat) this.celebrate('medium', { at: P.lanterns[ev.winner], fast: pc.fast });
          else if (this.localSeat >= 0) this.commiserate({ at: P.servicePlate });
          if (this.isBotSeat(ev.winner)) fx.sparks(P.moth, 36, 0xdfe8ff);
        }
        await this.beat(pc, 1.6);
        return;
      }
      case 'peek':
        this.mine = ev.shell;
        this.sfx('whisper', { vol: 0.8 });
        this.drawScreen();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'whisper':
        if (ev.shell) fx.popText(P.lanterns[ev.seat], this.t('whisper', { n: ev.n, shell: this.shellWord(ev.shell) }), GREY, { dur: 1.4, rise: 0.25 });
        this.sfx('whisper', { vol: 0.7 });
        return;
      case 'count':
        v.live = ev.live; v.blank = ev.blank;
        this.drawScreen();
        return;
      case 'matchEnd':
        await this.presentMatchEnd(ev, pc);
        return;
      case 'collect':
        v.gross = 0; v.rider = -1;
        this.sfx('coinPour');
        if (local(ev.seat)) { this.seatHud?.result('win', ev.amount - this.myStake); this.myStake = 0; }
        if (local(ev.seat)) await this.pourCoins(ev.amount, { bet: v.S, fast: pc.fast });
        this.paintAll();
        return;
    }
  }

  private async presentShot(ev: Extract<Ev, { k: 'shot' }>, pc: PresentCtx): Promise<void> {
    const P = this.parts, fx = this.ctx.fx, v = this.view;
    const lantern = P.lanterns[ev.target];
    this.gunYaw = yawTo(ev.target);
    await this.beat(pc, 0.5);                                     // the servo
    if (v.live + v.blank <= 1 && !pc.fast) fx.slowmo(0.5, 0.8);   // the last shell of a load: slow motion
    const recoil = async (amp: number): Promise<void> => {
      await this.ani(pc, 0.3, (k) => { P.gun.position.z = -amp * Math.sin(k * Math.PI); });
    };
    if (ev.misfire) {
      this.sfx('gunClick');
      fx.smoke(P.gun, 6);
      fx.popText(P.gun, this.t('misfire'), GREY, { dur: 1, rise: 0.2 });
      await recoil(0.01);
    } else if (ev.live) {
      this.sfx('gunShot');
      fx.flash(0xffffff, 0.9, 0.08);
      fx.shake(0.03, 0.35);
      fx.sparks(lantern, 24, GLASS);
      this.shattered[ev.target] = true;
      P.lanternGlass[ev.target].visible = false;
      P.lanternLamps[ev.target].setOn(false);
      fx.popText(lantern, `${this.t('bang')} −${ev.dmg}`, RED, { dur: 1.2, rise: 0.3, scale: 1.4, shake: true });
      fx.tint(0x000000, 0.85, 1.4);
      this.sfx('defib', { vol: 0.8 });
      if (ev.target === this.localSeat) { this.sfx('tinnitus'); fx.zoomPunch(0.04, 0.3); }
      if (this.isBotSeat(ev.target)) void P.devil.gesture('shake');
      await recoil(0.04);
      await this.beat(pc, 0.8);
    } else {
      this.sfx('gunBlank');
      fx.popText(lantern, this.t('click'), GREY, { dur: 0.9, rise: 0.2 });
      if (this.isBotSeat(ev.seat) && ev.target === ev.seat) void P.devil.gesture('nod');
      await recoil(0.015);
    }
    this.paintAll();
    if (!pc.fast) await this.beat(pc, 0.5);
  }

  private async presentMatchEnd(ev: Extract<Ev, { k: 'matchEnd' }>, pc: PresentCtx): Promise<void> {
    const v = this.view, P = this.parts, fx = this.ctx.fx;
    v.stake = [0, 0, 0, 0];
    v.rides = ev.rides;
    if (ev.ride) {
      v.gross = ev.payout;
      v.rider = ev.winner;
      this.sfx('win2', { vol: 0.8 });
      fx.popText(P.lanterns[ev.winner], `×1.9`, GOLD, { dur: 1.2, rise: 0.3, scale: 1.2 });
    } else {
      if (this.localSeat >= 0 && this.myStake > 0) {          // the callout only for a seat that staked
        if (ev.winner < 0) this.seatHud?.result('push');
        else if (ev.winner === this.localSeat) this.seatHud?.result('win', ev.payout - this.myStake);
        else this.seatHud?.result('lose', -this.myStake);
      }
      this.myStake = 0;
      v.inMatch = false; v.rider = -1; v.gross = 0;
      if (ev.winner === this.localSeat && ev.payout > 0) {
        this.celebrate(juiceTier(ev.payout, v.S || 1), { amount: ev.payout, at: P.lanterns[ev.winner], fast: pc.fast });
      } else if (this.localSeat >= 0 && this.view.seats.includes(this.localSeat)) {
        this.commiserate({ amount: v.S, at: P.servicePlate });
      }
      if (this.isBotSeat(ev.winner)) {
        fx.sparks(P.moth, 40, 0xdfe8ff);
        void P.devil.gesture('wave');
        this.sfx('stinger', { vol: 0.8 });
      }
    }
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
    await this.beat(pc, 0.6);
  }

  /** The two-stage load: shells face up for the count, then the leather flap sweeps them into the tube. */
  private async showLoad(ev: Extract<Ev, { k: 'load' }>, pc: PresentCtx): Promise<void> {
    const P = this.parts, fx = this.ctx.fx;
    const order: Array<'L' | 'B'> = [...Array<'L'>(ev.live).fill('L'), ...Array<'B'>(ev.blank).fill('B')];
    const n = order.length;
    P.shells.forEach((m, i) => {
      m.visible = i < n;
      m.material = order[i] === 'L' ? P.shellLive : P.shellBlank;
      m.position.x = -((n - 1) * 0.034) / 2 + i * 0.034;
      m.position.y = TOP + 0.035;
    });
    this.drawScreen();
    fx.popText(P.lanterns[0], this.t('sLoad', { live: ev.live, blank: ev.blank }), RED, { dur: 1.6, rise: 0.2 });
    for (let i = 0; i < n && !pc.fast; i++) {
      this.sfx('gunLoad', { vol: 0.7 });
      await this.wait(0.12);
    }
    if (!pc.fast) await this.wait(1.4);
    this.sfx('whoosh', { vol: 0.6 });
    await this.ani(pc, 0.5, (k) => { P.flap.rotation.x = Math.sin(k * Math.PI) * 1.1; });
    P.flap.rotation.x = 0;
    P.shells.forEach((m) => { m.visible = false; });
    this.sfx('shuffle', { vol: 0.5 });
    this.drawScreen();
  }

  private async beat(pc: PresentCtx, sec: number): Promise<void> {
    if (!pc.fast) await this.wait(sec);
  }

  private ani(pc: PresentCtx, dur: number, fn: (k: number) => void): Promise<void> {
    if (pc.fast) { fn(1); return Promise.resolve(); }
    return this.anim(dur, fn);
  }

  // ── visuals from the public view ───────────────────────────────────────────────────────────────
  private paintAll(): void {
    this.paintLamps();
    this.renderTrays();
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  private paintLamps(): void {
    const P = this.parts, v = this.view;
    for (let s = 0; s < 4; s++) {
      const c = v.charges[s] ?? 0;
      P.defibs[s].lamps.forEach((l, i) => l.setOn(i < c));
      P.lanternLamps[s].setOn(c > 0 || !v.inMatch);
      P.lanternGlass[s].visible = !this.shattered[s] && !(v.inMatch && c <= 0);
    }
  }

  /** Rebuild only the slots whose item changed (props are not free to make). */
  private renderTrays(): void {
    const P = this.parts, v = this.view;
    for (let s = 0; s < 4; s++) {
      P.itemSlots[s].forEach((anchor, k) => {
        const id = v.items[s]?.[k] ?? '';
        if (this.trayKey[s][k] === id) return;
        this.trayKey[s][k] = id;
        anchor.clear();
        if (id) anchor.add(this.ctx.kit.prop(ITEM_PROP[id as R.ItemId], { scale: 0.9 }));
      });
    }
  }

  private drawScreen(): void {
    const v = this.view;
    this.parts.screen.draw((g, sc) => {
      g.fillStyle = '#120407'; g.fillRect(0, 0, sc.w, sc.h);
      const head = v.inMatch ? this.t('round', { n: v.round }) : this.t('sBet');
      sc.text(head, 48, 3, { font: 'px5', color: '#ff3a3a', align: 'center' });
      if (v.inMatch) {
        sc.text(this.t('sCounts', { live: v.live, blank: v.blank }), 48, 16, { font: 'px5', color: '#e8d8c8', align: 'center' });
        const you = this.localSeat >= 0 && v.charges[this.localSeat] !== undefined ? v.charges[this.localSeat] : 0;
        sc.text(`${this.t('charges')} ${you}`, 48, 29, { font: 'px5', color: '#7dff7a', align: 'center' });
        if (this.mine) sc.text(this.t('chamberSeen', { shell: this.shellWord(this.mine) }), 48, 40, { font: 'px5', color: '#ffd040', align: 'center' });
      }
    });
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.devilstable.tip1' },
      { k: 'm.devilstable.tip2', v: { fire: this.k('primary'), aim: `${this.k('left')}/${this.k('right')}` } },
      { k: 'm.devilstable.tip3', v: { help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return [
      { k: 'm.devilstable.rule1' }, { k: 'm.devilstable.rule2' }, { k: 'm.devilstable.rule3' },
      { k: 'm.devilstable.rule4' }, { k: 'm.devilstable.rule5', v: { n1: this.k('n1'), n8: this.k('n8') } },
      { k: 'm.devilstable.rule6' },
    ];
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const v = this.view, s = this.localSeat;
    const staked = v.stake[s] > 0;
    const myTurn = v.inMatch && v.turn === s;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.devilstable.goal' });

    // STATE: whose turn, what phase
    if (v.rider === s) {
      sh.state({ k: 'm.devilstable.stRide' }, 'gold', { k: 'm.devilstable.stRideSub', v: { ride: this.k('double'), collect: this.k('collect') } });
    } else if (myTurn) {
      sh.state({ k: 'm.devilstable.stTurn' }, 'good', { k: 'm.devilstable.stTurnSub', v: { fire: this.k('primary') } });
    } else if (v.inMatch && v.turn >= 0) {
      sh.state({ k: this.isBotSeat(v.turn) ? 'm.devilstable.stDevil' : 'm.devilstable.stOther' }, 'cyan');
    } else if (v.inMatch) {
      sh.state({ k: 'm.devilstable.stRound', v: { n: v.round } }, 'neutral');
    } else if (staked) {
      sh.state({ k: 'm.devilstable.stWait' }, 'cyan', { k: 'm.devilstable.stBetSub' });
    } else {
      sh.state({ k: 'm.devilstable.stBet' }, 'gold');
    }

    // KEY NUMBERS: stake, charges, rounds, shells in the gun, winnings, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.devilstable.nStake' }, value: fmtCoins(staked ? v.stake[s] : this.bet), tone: 'gold' });
    const charges = v.charges[s] ?? 0;
    if (v.inMatch) {
      nums.push({ label: { k: 'm.devilstable.nCharges' }, value: String(charges), tone: charges > 1 ? 'good' : 'bad' });
      nums.push({ label: { k: 'm.devilstable.nRounds' }, value: `${v.wins[s] ?? 0}/${v.round || 0}`, tone: 'neutral' });
      if (v.live + v.blank > 0) {
        nums.push({ label: { k: 'm.devilstable.nShells' }, value: { k: 'm.devilstable.nShellsVal', v: { live: v.live, blank: v.blank } }, tone: 'warn' });
      }
    }
    if (v.gross > 0) nums.push({ label: { k: 'm.devilstable.nWin' }, value: fmtCoins(v.gross), tone: 'good' });
    nums.push({ label: { k: 'm.devilstable.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only the actions valid right now, with the keys the machine really reads
    if (!v.inMatch && !staked) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.devilstable.cStake' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.devilstable.cBet' }, action: 'betUp' });
    }
    if (v.rider === s) {
      ctrl.push({ key: this.k('double'), label: { k: 'm.devilstable.cRide' }, action: 'double', primary: true });
      ctrl.push({ key: this.k('collect'), label: { k: 'm.devilstable.cCollect' }, action: 'collect' });
    }
    if (myTurn) {
      ctrl.push({ key: this.k('primary'), label: { k: this.holding ? 'm.devilstable.cRelease' : 'm.devilstable.cFire' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: { k: 'm.devilstable.cAim' }, action: 'left' });
      const n = Math.min(8, v.items[s]?.length ?? 0);
      if (n > 0) {
        const slots: MachineAction[] = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'];
        const key = n === 1 ? this.k('n1') : `${this.k('n1')}-${this.k(slots[n - 1])}`;
        ctrl.push({ key, label: { k: 'm.devilstable.cItems' }, action: 'n1' });
      }
      if (this.holding) ctrl.push({ key: this.k('secondary'), label: { k: 'm.devilstable.cLower' }, action: 'secondary' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.devilstable.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.devilstable.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  private firstFoe(s: number): number {
    const v = this.view;
    return v.seats.find((t) => t !== s && v.charges[t] > 0) ?? s;
  }

  private seatName(s: number): string {
    return this.isBotSeat(s) ? this.t('devil') : this.t('self');
  }

  private shellWord(shell: R.Shell): string { return shell === 'L' ? this.t('shLive') : this.t('shBlank'); }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    const v = this.view;
    return { ...v, charges: [...v.charges], items: v.items.map((a) => [...a]), wins: [...v.wins], stake: [...v.stake], seats: [...v.seats] };
  }

  applySnapshot(s: Snap): void {
    this.view = { ...s, charges: [...s.charges], items: s.items.map((a) => [...a]), wins: [...s.wins], stake: [...s.stake], seats: [...s.seats] };
    this.paintAll();
  }
}
