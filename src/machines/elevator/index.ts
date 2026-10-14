/**
 * The Elevator (`elevator`) — crash game on a shared 8-seat table (TableBase). Pattern: coinflip (present/logic split,
 * juice) + demoTable (host-resolved TableBase, bots, snapshots, leaving mid-round).
 *
 * Timeline (host): IDLE → BOARDING 8.0 s (riders pick a stake 1–500 and an optional auto target; bots may join) →
 * DOORS 1.5 s (stakes debited, crash point drawn from a round seed, fairness commitment broadcast) → RIDE (the car
 * climbs m(t) = e^(0.07·t) on the host clock; `go` carries t0 so every peer computes m locally) → SNAP 2.0 s (or ROOF
 * at 250, every rider still aboard is paid ×250) → AFTERMATH 4.0 s → IDLE.
 *
 * Cash-out: a rider presses Space / their STEP-OFF lever; the host credits it `grace` seconds in the past
 * (`outTime`, lag compensation) and accepts it only if that time is before the snap. Stepping off = cash out.
 * Leaving during BOARDING is free (nothing is debited yet). Auto targets cash out exactly at the target.
 *
 * Controls: Space / Enter = join (BOARDING) or STEP OFF (RIDE) · Z/X or wheel = stake · 1–9 = auto target toggle
 * (1.5, 2, 3, 5, 10, 20, 50, 100, 250) · E sits / leaves (BOARDING) · H rules.
 *
 * Presentation only in `present()`/`frame()`. Crash point stays host-side until `snap`.
 */
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { KitX } from '@/kit';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier, tierTags, toWinTier } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { t, fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { TAU, clamp01, lerp } from '@/core/math';
import { buildModel, layoutCable, type ElevatorParts } from './model';
import {
  AFTER_S, BOARD_S, BOT_MAX, DOORS_S, HOOK_FLOOR, HOOK_INSURE, HOOK_LATE, INSURE_MIN, MAX_MULT, RATE, RTP, SNAP_S,
  STAKE_MAX, STAKE_MIN, TABLE_CAP, TARGETS, botTarget, cashMult, crashFromSeed, multAt, outTime, playHeadless,
  carYOf, refundChance, snapAt,
} from './rules';
import STR from './strings';

// ── contract types (aliases: they must be assignable to `Json`) ────────────────────────────────
type Phase = 'idle' | 'board' | 'doors' | 'ride' | 'snap' | 'after';
type RiderSt = 'empty' | 'board' | 'ride' | 'out' | 'fell';
type Rider = { st: RiderSt; stake: number; auto: number; mult: number; payout: number; bot: boolean };
type Ev =
  | { k: 'phase'; p: Phase }
  | { k: 'seat'; seat: number; st: RiderSt; stake: number; auto: number; bot: boolean }
  | { k: 'lock'; fair: string }
  | { k: 'go'; t0: number }
  | { k: 'out'; seat: number; mult: number; payout: number; stake: number; auto: boolean; roof: boolean }
  | { k: 'fall'; seat: number; refund: number }
  | { k: 'snap'; crash: number; tSnap: number; seed: number; roof: boolean };
type Act = { k: 'ride'; stake: number; auto: number } | { k: 'out' };
/** What every peer knows. The crash point is only filled in at `snap`. */
type State = {
  phase: Phase; riders: Rider[]; t0: number; fair: string; crash: number; tSnap: number; roof: boolean; seed: number; hist: number[];
};
type HostState = {
  phase: Phase; timer: number; elapsed: number; crash: number; tSnap: number; seed: number; lastOut: number; riders: Rider[];
};

const SEATS = 8;
const GOLD = 0xffd040, GREEN = 0x40ff60, RED = 0xff4a3a, CYAN = 0x40e0ff, GREY = 0x6a6a6a;
const BOT_STAKES = [5, 10, 25, 50, 100];

const empty = (): Rider => ({ st: 'empty', stake: 0, auto: 0, mult: 0, payout: 0, bot: false });
const freshState = (): State => ({
  phase: 'idle', riders: Array.from({ length: SEATS }, empty), t0: 0, fair: '', crash: 0, tSnap: 0, roof: false, seed: 0, hist: [],
});
const freshHost = (): HostState => ({
  phase: 'idle', timer: 0, elapsed: 0, crash: 1, tSnap: 0, seed: 0, lastOut: 0, riders: Array.from({ length: SEATS }, empty),
});

/** Public commitment to a round seed (32-bit FNV-1a, hex). Sync on purpose: TableBase cannot await. */
function commit(seed: number): string {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const def: MachineDef = {
  id: 'elevator',
  category: 'physics',
  slotSize: 'XL',
  zone: 'midway',
  seats: SEATS,
  shared: true,
  minBet: STAKE_MIN,
  maxBet: STAKE_MAX,
  betSteps: [1, 5, 10, 25, 50, 100, 250, 500],
  maxPayoutMult: 375,              // ROOF ×250 with a payout-factor headroom
  rtp: RTP,
  tier: 1,
  actionCost: 1,
  headless: playHeadless,
  tags: ['shared', 'crash', 'table'],
  modHooks: {
    'm.elevator.autoInsurance': 'Set to 1: a fall at a target of at least ×1.5 is converted into a cash-out at ×1.0.',
    'm.elevator.lateStep': 'Extra cash-out latency grace in ms (base 150).',
    'm.elevator.floorBonus': 'Adds this much per floor passed (one floor per doubling) to cash-outs only.',
  },
  strings: { en: STR.en, tr: STR.tr },
};

export default class Elevator extends TableBase<ElevatorParts, Ev, State, Act> {
  private st: State = freshState();
  private hs: HostState = freshHost();
  private autoIdx = 0;                       // local auto target: 0 = none, n = TARGETS[n-1]
  private carMode: 'rest' | 'ride' | 'free' = 'rest';
  private ledText = '';
  private clockText = '';
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;
  private hudTick = 0;                        // throttle for the live multiplier on the HUD (ms, host clock)

  protected createModel(kit: KitX): MachineModel<ElevatorParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.drawHistory();
    this.attractor.every('chase', 9, () => this.parts.shaftBulbs.pattern('chase', 3), { first: 2 });
    this.parts.shaftBulbs.pattern('chase', 1.5);
    for (let seat = 0; seat < SEATS; seat++) this.paintSeat(seat);
  }

  attract(dt: number): void { this.attractor.update(dt); }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('elevator', this.tipLines());
    }
  }

  onLang(): void {
    this.drawHistory();
    for (let seat = 0; seat < SEATS; seat++) this.paintSeat(seat);
    if (this.isLocalOccupant) this.showHud();
  }

  // ── input (local occupant) ──────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    const isAuto = /^n[1-9]$/.test(a);
    if (e.repeat && !isBet && !isAuto) return;
    const seat = this.localSeat;
    const r = seat >= 0 ? this.st.riders[seat] : null;
    switch (a) {
      case 'primary': case 'confirm': case 'secondary': case 'collect':
        if (!r) break;
        if (r.st === 'ride' && this.st.phase === 'ride') this.act({ k: 'out' });
        else if (this.st.phase === 'board' && (a === 'primary' || a === 'confirm')) this.sendRide();
        break;
      case 'betUp': this.changeSetting(() => this.stepBet(1)); break;
      case 'betDown': this.changeSetting(() => this.stepBet(-1)); break;
      case 'betMax': this.changeSetting(() => this.maxBet()); break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': case 'n6': case 'n7': case 'n8': case 'n9': {
        const idx = Number(a.slice(1));
        this.autoIdx = this.autoIdx === idx ? 0 : idx;
        this.sfx('click');
        this.changeSetting(() => undefined);
        break;
      }
    }
  }

  /** Stake / auto changes are only valid while boarding; a seated rider's choice is re-sent to the host. */
  private changeSetting(fn: () => void): void {
    if (this.st.phase !== 'board') return;
    fn();
    this.sfx('click');
    const r = this.localSeat >= 0 ? this.st.riders[this.localSeat] : null;
    if (r && r.st === 'board') this.sendRide();
    this.showHud();
  }

  private sendRide(): void {
    if (this.localSeat < 0) return;
    const auto = this.autoIdx > 0 ? TARGETS[this.autoIdx - 1] : 0;
    this.act({ k: 'ride', stake: this.bet, auto });
  }

  // ── HOST: actions ───────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'ride') {
      if (hs.phase !== 'board') { this.nak(pid, rid, 'm.elevator.closed'); return; }
      const bad = !Number.isInteger(a.stake) || a.stake < STAKE_MIN || a.stake > STAKE_MAX || (a.auto !== 0 && !TARGETS.includes(a.auto));
      if (bad) { this.nak(pid, rid, 'm.elevator.badBet'); return; }
      hs.riders[seat] = { st: 'board', stake: a.stake, auto: a.auto, mult: 0, payout: 0, bot: false };
      void this.emit({ k: 'seat', seat, st: 'board', stake: a.stake, auto: a.auto, bot: false });
      return;
    }
    // step off
    if (hs.phase !== 'ride' || hs.riders[seat].st !== 'ride') { this.nak(pid, rid, 'm.elevator.closed'); return; }
    const tc = outTime(hs.elapsed, hs.lastOut, this.mod(HOOK_LATE, 0));
    if (tc >= hs.tSnap) { this.nak(pid, rid, 'm.elevator.tooLate'); return; }
    this.cashOut(seat, pid, tc, multAt(tc), false, false);
  }

  /** Host: a rider leaves the car. Boarding is free; stepping off mid-ride cashes out; anything else is written off. */
  override onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (local) { this.hud(null); this.seatHud?.hide(); }
    if (!this.isHost) return;
    const hs = this.hs;
    const r = hs.riders[seat];
    if (r.st === 'ride' && hs.phase === 'ride') {
      const tc = outTime(hs.elapsed, hs.lastOut, this.mod(HOOK_LATE, 0));
      this.cashOut(seat, pid, tc, multAt(tc), false, false);
    } else if (r.st === 'ride' && hs.phase === 'doors') {
      this.cashOut(seat, pid, 0, 1, false, false);     // stake comes back at ×1 (debited, nothing ridden yet)
    }
    if (hs.riders[seat].st !== 'empty') this.clear(seat);
  }

  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'idle':
        if (this.humans().length > 0) this.startBoarding();
        return;
      case 'board':
        if ((hs.timer -= dt) <= 0) this.doors();
        return;
      case 'doors':
        if ((hs.timer -= dt) <= 0) this.go();
        return;
      case 'ride':
        this.rideTick(dt);
        return;
      case 'snap':
        if ((hs.timer -= dt) <= 0) { hs.phase = 'after'; hs.timer = AFTER_S; void this.emit({ k: 'phase', p: 'after' }); }
        return;
      case 'after':
        if ((hs.timer -= dt) <= 0) this.endRound();
        return;
    }
  }

  private startBoarding(): void {
    const hs = this.hs;
    hs.phase = 'board'; hs.timer = BOARD_S; hs.crash = 1; hs.tSnap = 0; hs.elapsed = 0;
    void this.emit({ k: 'phase', p: 'board' });
    void this.countdown(BOARD_S, 'elevator');
    const room = Math.min(BOT_MAX, Math.max(0, TABLE_CAP - this.humans().length));
    const n = this.hostRng.int(0, room);
    for (let i = 0; i < n; i++) {
      const seat = this.seats.indexOf(null);
      if (seat < 0) break;
      this.addBot(seat, this.t('debtor', { n: i + 1 }));
      const stake = this.hostRng.pick(BOT_STAKES);
      const auto = botTarget(this.hostRng);
      hs.riders[seat] = { st: 'board', stake, auto, mult: 0, payout: 0, bot: true };
      void this.emit({ k: 'seat', seat, st: 'board', stake, auto, bot: true });
    }
  }

  private doors(): void {
    const hs = this.hs;
    this.cancelCountdown();
    let any = false;
    hs.riders.forEach((r, seat) => {
      if (r.st !== 'board') return;
      const pid = this.seats[seat];
      if (pid === null || !this.chargeSeat(seat, r.stake)) {
        if (pid !== null) this.nak(pid, 0, 'common.noFunds');
        this.clear(seat);
        return;
      }
      r.st = 'ride'; any = true;
      void this.emit({ k: 'seat', seat, st: 'ride', stake: r.stake, auto: r.auto, bot: r.bot });
    });
    if (!any) { this.endRound(); return; }
    hs.seed = this.hostRng.int(1, 2147483646);
    hs.crash = crashFromSeed(hs.seed);
    hs.tSnap = snapAt(hs.crash);
    hs.phase = 'doors'; hs.timer = DOORS_S; hs.elapsed = 0; hs.lastOut = 0;
    void this.emit({ k: 'lock', fair: commit(hs.seed) });
  }

  private go(): void {
    this.hs.phase = 'ride';
    this.hs.elapsed = 0;
    void this.emit({ k: 'go', t0: this.ctx.net.hostTime() });
  }

  private rideTick(dt: number): void {
    const hs = this.hs;
    hs.elapsed += dt;
    hs.riders.forEach((r, seat) => {
      if (r.st !== 'ride' || r.auto <= 0) return;
      const tAuto = Math.log(r.auto) / RATE;
      if (hs.elapsed >= tAuto && tAuto < hs.tSnap) this.cashOut(seat, this.seats[seat], tAuto, r.auto, true, false);
    });
    if (hs.elapsed >= hs.tSnap) this.snap();
  }

  /** Credit a cash-out (humans only), mark the rider out and tell everyone. `mult` is the car's multiplier at `tc`. */
  private cashOut(seat: number, pid: PlayerId | null, tc: number, mult: number, auto: boolean, roof: boolean): void {
    const hs = this.hs;
    const r = hs.riders[seat];
    if (r.st !== 'ride' || pid === null) return;
    const cm = roof ? mult : cashMult(mult, this.mod(HOOK_FLOOR, 0));
    const tags = roof ? ['elevator:roof', 'jackpot'] : mult >= 100 ? ['elevator:top'] : [];
    const payout = isBot(pid) ? 0 : this.pay(pid, r.stake, cm, tags);
    r.st = 'out'; r.mult = mult; r.payout = payout;
    hs.lastOut = Math.max(hs.lastOut, tc);
    this.forfeit(seat);
    void this.emit({ k: 'out', seat, mult, payout, stake: r.stake, auto, roof });
  }

  /** Host: pay `stake × cm × payoutFactor`. The factor is applied here (factorApplied), not by the run. */
  private pay(pid: PlayerId, stake: number, cm: number, tags: string[]): number {
    const gross = Math.floor(stake * cm * this.ctx.run.payoutFactor(this.def.id, this.id));
    const jt = juiceTier(gross, stake, tags);
    return this.ctx.run.hostWin(pid, gross, this.src, {
      bet: stake, tier: toWinTier(jt), tags: [...tags, ...tierTags(jt)], factorApplied: true,
    });
  }

  /** The cable snaps (or the car reaches the roof). Riders still aboard fall, or are paid ×250 on ROOF. */
  private snap(): void {
    const hs = this.hs;
    const roof = hs.crash >= MAX_MULT;
    hs.phase = 'snap'; hs.timer = SNAP_S;
    void this.emit({ k: 'snap', crash: hs.crash, tSnap: hs.tSnap, seed: hs.seed, roof });
    const insure = this.mod(HOOK_INSURE, 0) > 0;
    hs.riders.forEach((r, seat) => {
      if (r.st !== 'ride') return;
      const pid = this.seats[seat];
      if (roof) { this.cashOut(seat, pid, hs.tSnap, MAX_MULT, false, true); return; }
      if (insure && r.auto >= INSURE_MIN) { this.cashOut(seat, pid, hs.tSnap, 1, true, false); return; }
      let refund = 0;
      if (this.hostRng.next() < refundChance(this.luck())) refund = Math.floor(r.stake / 2);
      if (refund > 0 && pid !== null && !isBot(pid)) {
        this.ctx.run.hostWin(pid, refund, this.src, { bet: r.stake, tier: 'none', tags: ['refund'], raw: true });
      }
      r.st = 'fell'; r.mult = 0; r.payout = 0;
      this.forfeit(seat);
      void this.emit({ k: 'fall', seat, refund });
    });
  }

  private endRound(): void {
    const hs = this.hs;
    for (const b of [...this.bots]) this.removeBot(b.seat);
    hs.riders.forEach((r, seat) => { if (r.st !== 'empty') this.clear(seat); });
    hs.phase = 'idle'; hs.timer = 0; hs.elapsed = 0; hs.crash = 1; hs.tSnap = 0;
    void this.emit({ k: 'phase', p: 'idle' });
  }

  /** Host: forget a seat's rider (public state reset). */
  private clear(seat: number): void {
    this.hs.riders[seat] = empty();
    void this.emit({ k: 'seat', seat, st: 'empty', stake: 0, auto: 0, bot: false });
  }

  // ── presentation (every peer) ───────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const s = this.st, fast = pc.fast, p = this.parts;
    switch (ev.k) {
      case 'phase':
        s.phase = ev.p;
        if (ev.p === 'board') { this.drawHistory(); this.sfx('elevator'); }
        if (ev.p === 'after') { this.carMode = 'free'; await this.returnCar(fast); }
        if (ev.p === 'idle') this.carMode = 'rest';
        this.showHud();
        return;
      case 'seat':
        s.riders[ev.seat] = { st: ev.st, stake: ev.stake, auto: ev.auto, mult: 0, payout: 0, bot: ev.bot };
        this.paintSeat(ev.seat);
        if (ev.st === 'ride') this.sfx('lever');
        if (ev.seat === this.localSeat) this.showHud();
        return;
      case 'lock': {
        s.phase = 'doors'; s.fair = ev.fair; s.crash = 0; s.tSnap = 0; s.roof = false; s.seed = 0;
        this.sfx('motor');
        this.sfx('stinger');
        // anticipation: the car sways on its cable while the doors close
        this.carMode = 'free';
        void this.anim(fast ? 0.05 : 1.2, (k) => { p.car.position.y = carYOf(1) - 0.03 * Math.sin(k * TAU * 2) * (1 - k); });
        this.showHud();
        return;
      }
      case 'go':
        s.phase = 'ride'; s.t0 = ev.t0;
        this.sfx('creak');
        this.sfx('motor');
        this.carMode = 'ride';
        this.showHud();
        return;
      case 'out': {
        const r = s.riders[ev.seat];
        if (r) { r.st = 'out'; r.mult = ev.mult; r.payout = ev.payout; }
        this.paintSeat(ev.seat);
        const at = p.stations[ev.seat].strapLamp.root;
        void p.stations[ev.seat].lever.pull();
        this.sfx('lever');
        this.sfx('coin');
        this.ctx.fx.popText(at, `x${ev.mult.toFixed(2)}`, GOLD, { dur: 1, rise: 0.25 });
        if (ev.seat === this.localSeat) {
          const net = ev.payout - ev.stake;
          this.seatHud?.result(net > 0 ? 'win' : 'even', net);
          this.showHud();
          const tier = juiceTier(ev.payout, ev.stake, ev.roof ? ['elevator:roof', 'jackpot'] : []);
          await this.celebrate(tier, { amount: ev.payout, at });
        } else {
          this.ctx.fx.sparks(at, 4, GREEN);
        }
        return;
      }
      case 'fall': {
        const r = s.riders[ev.seat];
        if (r) { r.st = 'fell'; }
        this.paintSeat(ev.seat);
        const at = p.stations[ev.seat].strapLamp.root;
        this.ctx.fx.popText(at, ev.refund > 0 ? t('m.elevator.refund') : t('m.elevator.fell'), ev.refund > 0 ? GOLD : RED, { dur: 1.2, rise: 0.3 });
        if (ev.seat === this.localSeat) {
          const stake = r ? r.stake : 0;
          if (ev.refund > 0) this.seatHud?.result('lose', ev.refund - stake);
          else this.seatHud?.result('bust', -stake);
          this.commiserate({ amount: ev.refund, at });
          this.showHud();
        }
        return;
      }
      case 'snap': {
        s.phase = 'snap'; s.crash = ev.crash; s.tSnap = ev.tSnap; s.roof = ev.roof; s.seed = ev.seed;
        s.hist = [...s.hist, ev.crash].slice(-8);
        this.drawHistory();
        this.carMode = 'free';
        if (ev.roof) {
          p.roofFlood.visible = true;
          this.sfx('jackpot');
          this.ctx.fx.flash(0xfff4d0, 0.8, 0.3);
          void this.celebrate('mega', { amount: 0, at: p.car });
          void this.anim(fast ? 0.05 : 0.6, (k) => { p.car.position.y = lerp(p.car.position.y, carYOf(MAX_MULT), k * 0.5); });
          await this.wait(1.5);
          p.roofFlood.visible = false;
        } else {
          this.sfx('thud');
          this.sfx('whoosh');
          this.sfx('glassBreak');
          this.ctx.fx.shake(0.06, 0.5);
          this.ctx.fx.flash(0xff2a1a, 0.4, 0.25);
          const y0 = p.car.position.y;
          await this.anim(fast ? 0.05 : 0.6, (k) => { p.car.position.y = Math.max(0.1, y0 - 3 * k * k); });
        }
        p.frays.forEach((f) => { f.visible = true; });
        return;
      }
    }
  }

  // ── car, lamps, boards ──────────────────────────────────────────────────────────────────────
  /** Visual-only: the car follows the local clock while riding; the cable frays with the multiplier. */
  frame(_dt: number, _t: number): void {
    const s = this.st, p = this.parts;
    const now = this.ctx.net.hostTime();
    const live = this.carMode === 'ride' && s.t0 > 0;
    const m = live ? Math.min(MAX_MULT, multAt(Math.max(0, (now - s.t0) / 1000))) : 1;
    if (live && this.isLocalOccupant && now - this.hudTick > 150) { this.hudTick = now; this.showHud(); }
    if (this.carMode === 'ride') {
      const amp = 0.002 + 0.006 * clamp01(Math.log(Math.max(1, m)) / Math.log(50));
      p.car.position.y = carYOf(m);
      p.car.position.x = Math.sin((now / 1000) * TAU * 6) * amp;
    } else {
      p.car.position.x = 0;
    }
    layoutCable(p.cable, p.car.position.y + 0.2);
    if (this.carMode === 'ride') p.frays.forEach((f, i) => { f.visible = m >= 2 ** (i + 1); });
    else if (this.carMode === 'rest') p.frays.forEach((f) => { f.visible = false; });
    p.needle.rotation.z = -1.25 + 2.5 * clamp01(Math.log(m) / Math.log(MAX_MULT));

    const shown = s.phase === 'ride' ? m : s.phase === 'snap' || s.phase === 'after' ? s.crash : 1;
    this.setLed(shown.toFixed(2).padStart(5, ' '));
    let clock = '    ';
    if (this.timerState) clock = String(Math.max(0, Math.ceil(this.timerLeft))).padStart(4, ' ');
    else if (s.phase === 'doors' || s.phase === 'ride') clock = s.fair.slice(0, 4).toUpperCase().padStart(4, ' ');
    if (clock !== this.clockText) { this.clockText = clock; p.leds.clock.set(clock); }
  }

  private setLed(txt: string): void {
    if (txt === this.ledText) return;
    this.ledText = txt;
    this.parts.leds.mult.set(txt);
  }

  private async returnCar(fast: boolean): Promise<void> {
    const car = this.parts.car;
    const y0 = car.position.y, y1 = carYOf(1);
    await this.anim(fast ? 0.05 : 2.0, (k) => { car.position.y = lerp(y0, y1, k * k * (3 - 2 * k)); });
    this.carMode = 'rest';
  }

  /** Station visuals: strap lamp colour per state, name plate. */
  private paintSeat(seat: number): void {
    const r = this.st.riders[seat];
    const stn = this.parts.stations[seat];
    const colour = r.st === 'out' ? GREEN : r.st === 'fell' ? RED : r.st === 'ride' ? GOLD : r.st === 'board' ? CYAN : GREY;
    stn.strapLamp.setColor(colour);
    stn.strapLamp.setOn(r.st !== 'empty');
    stn.namePlate.setText(this.nameOf(seat));
  }

  private nameOf(seat: number): string {
    const pid = this.seats[seat];
    if (pid === null) return '-';
    const bot = this.bots.find((b) => b.seat === seat);
    return bot ? bot.name : this.ctx.net.playerName(pid);
  }

  /** Recent crashes on the history board (last six, oldest left). */
  private drawHistory(): void {
    const sc = this.parts.history;
    sc.clear('#120c0a');
    sc.text(this.t('history'), 4, 10, { font: 'px5', color: '#c8a070' });
    this.st.hist.slice(-6).forEach((c, i) => {
      sc.text(c.toFixed(2), 6 + i * 26, 26, { font: 'px5', color: c >= 2 ? '#40ff60' : '#ff5a4a' });
    });
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.elevator.tip1' },
      { k: 'm.elevator.tip2', v: { ride: this.k('primary'), bet: `${this.k('betDown')}/${this.k('betUp')}`, auto: `${this.k('n1')}-${this.k('n9')}` } },
      { k: 'm.elevator.tip3', v: { out: this.k('primary'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.elevator.' + k }));
  }

  /** The multiplier on the car right now (host clock, the same maths as `frame`). */
  private liveMult(): number {
    const s = this.st;
    if (this.carMode !== 'ride' || s.t0 <= 0) return 1;
    return Math.min(MAX_MULT, multAt(Math.max(0, (this.ctx.net.hostTime() - s.t0) / 1000)));
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits in the car line. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.st, r = s.riders[this.localSeat], ph = s.phase;
    const live = this.liveMult();
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.elevator.goal' });

    // STATE: what phase, and where this rider stands in it
    switch (ph) {
      case 'board': {
        const secs: Txt | undefined = this.timerState ? { k: 'm.elevator.stBoardSub', v: { n: Math.ceil(this.timerLeft) } } : undefined;
        if (r.st === 'board') sh.state({ k: 'm.elevator.stIn' }, 'cyan', { k: 'm.elevator.stInSub' });
        else sh.state({ k: 'm.elevator.stBoard' }, 'gold', secs);
        break;
      }
      case 'doors': sh.state({ k: 'm.elevator.stDoors' }, 'warn'); break;
      case 'ride':
        if (r.st === 'ride') sh.state({ k: 'm.elevator.stRide' }, 'good', { k: 'm.elevator.stRideSub' });
        else if (r.st === 'out') sh.state({ k: 'm.elevator.stOut' }, 'good', { k: 'm.elevator.stOutSub', v: { n: r.mult.toFixed(2) } });
        else sh.state({ k: 'm.elevator.stWatch' }, 'cyan', { k: 'm.elevator.stWatchSub' });
        break;
      case 'snap':
        if (r.st === 'out') sh.state({ k: s.roof ? 'm.elevator.stRoof' : 'm.elevator.stOut' }, 'gold', { k: 'm.elevator.stOutSub', v: { n: r.mult.toFixed(2) } });
        else if (r.st === 'fell') sh.state({ k: 'm.elevator.stFell' }, 'bad', { k: 'm.elevator.stFellSub', v: { n: s.crash.toFixed(2) } });
        else sh.state({ k: 'm.elevator.stWatch' }, 'cyan');
        break;
      case 'after': sh.state({ k: 'm.elevator.stAfter' }, 'neutral'); break;
      default: sh.state({ k: 'm.elevator.stIdle' }, 'neutral');
    }

    // KEY NUMBERS: stake, live multiplier and cash-out value, last crash, auto target, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.elevator.nStake' }, value: fmtCoins(r.stake || this.bet), tone: 'gold' });
    if (ph === 'ride' && r.st === 'ride') {
      nums.push({ label: { k: 'm.elevator.nMult' }, value: `x${live.toFixed(2)}`, tone: 'good' });
      nums.push({ label: { k: 'm.elevator.nCash' }, value: fmtCoins(Math.floor(r.stake * cashMult(live, this.mod(HOOK_FLOOR, 0)))), tone: 'good' });
    } else if (r.st === 'out') {
      nums.push({ label: { k: 'm.elevator.nMult' }, value: `x${r.mult.toFixed(2)}`, tone: 'good' });
    }
    const last = s.hist[s.hist.length - 1];
    if (last !== undefined) nums.push({ label: { k: 'm.elevator.nLast' }, value: `x${last.toFixed(2)}`, tone: 'neutral' });
    nums.push({
      label: { k: 'm.elevator.nAuto' },
      value: this.autoIdx > 0 ? `x${TARGETS[this.autoIdx - 1]}` : { k: 'm.elevator.nOff' },
      tone: 'cyan',
    });
    nums.push({ label: { k: 'm.elevator.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only the actions valid right now, with the keys the machine really reads
    if (ph === 'board') {
      if (r.st !== 'board') ctrl.push({ key: this.k('primary'), label: { k: 'm.elevator.cRide' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.elevator.cStake' }, action: 'betUp' });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n9')}`, label: { k: 'm.elevator.cAuto' }, action: 'n1' });
    }
    if (ph === 'ride' && r.st === 'ride') {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.elevator.cStepOff' }, action: 'primary', primary: true });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.elevator.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.elevator.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── snapshots (late join): the crash point is only ever in `st` after `snap` ─────────────────
  getSnapshot(_forPid?: PlayerId): State {
    const s = this.st;
    return { ...s, riders: s.riders.map((r) => ({ ...r })), hist: [...s.hist] };
  }
  applySnapshot(sn: State): void {
    this.st = { ...sn, riders: sn.riders.map((r) => ({ ...r })), hist: [...sn.hist] };
    this.carMode = sn.phase === 'ride' ? 'ride' : sn.phase === 'snap' || sn.phase === 'after' ? 'free' : 'rest';
    for (let seat = 0; seat < SEATS; seat++) this.paintSeat(seat);
    this.drawHistory();
    this.showHud();
  }
}
