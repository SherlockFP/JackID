/**
 * Red Dog "The Kennel" (`reddog`) — the dog-headed dealer's shared acey-deucey table (MACHINES_tables §17). Tier 2, shared.
 *
 * Shape of the code (the TableBase pattern of cardwar / blackjack):
 *  - HOST ONLY (`hs`): the shoe, every bet and raise, the two face-up cards, the third card and the payouts. Clients send
 *    `act()` (bet, raise full / half / none). The host validates with the pure rules (`rules.ts`), charges and pays through
 *    the seat helpers, and publishes the two cards and the third card as PUBLIC events. Raises are charged together at the
 *    end of RAISE_WINDOW, so nobody sees another seat's raise before deciding.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) changes. Events are queued, so the host's own
 *    presentation runs in the same order as everyone else's.
 *  - Hand: OPEN (solo ∞ / shared 12 s) → DEAL 0.8 → SPREAD (the dog barks the gap, 0.25 s per bark; skipped on pair and
 *    consecutive) → RAISE_WINDOW (solo ∞ / shared 8 s; skipped on pair and consecutive; default no raise) → THIRD 0.9
 *    (pair and spread) → SETTLE 2.0 → OPEN (or SHUFFLE 5.0 at the cut card).
 *  - Luck (MACHINES_tables §17.4): a missed third card is redrawn once solo; on a shared table it refunds the wager.
 *  - Bots sit in host code: they bet the table minimum on half of the hands and raise a big spread half of the time.
 *
 * Not in v1 (recorded in the report): autoplay (G), the raise prompt's win-chance overlay (only the spread-bar odds on
 * L10 are shown), and Shift+1 for the half raise (the machine keymap has no shifted actions, so half is `n3`).
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import type { ChipValue, LampPart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type HudResultKind, type HudTone, type Txt } from '@/machines/_base/seatHud';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier } from '@/machines/_base/tiers';
import { cardText, rankOf } from '@/machines/_base/cards';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { STRINGS } from './reddog.strings';
import {
  buildModel, betVec, cardSpotVec, DEALER_Z, DOG_Y, SEATS, TABLE_D, TABLE_W, shoeMouth, type DogParts, type ReddogParts,
} from './model';
import * as R from './rules';

// ── timings (seconds) ────────────────────────────────────────────────────────────────────────────
const OPEN_S = 12, RAISE_S = 8, DEAL_S = 0.8, THIRD_S = 0.9, SETTLE_S = 2.0, SHUFFLE_S = 5.0;
const BARK_PAUSE_S = 0.02;
const CHIP_VALUES: ChipValue[] = [1000, 500, 100, 25, 10, 5, 1];
const FELT_W = TABLE_W - 0.2, FELT_D = TABLE_D - 0.14;
const EARS_UP = 0, EARS_DOWN = 0.8;

type Phase = 'open' | 'deal' | 'spread' | 'raise' | 'third' | 'settle' | 'shuffle';

// ── events (all public unless noted), actions, snapshot ─────────────────────────────────────────
type Ev =
  /** Main bets per seat and who has locked. Sent on every change and at each OPEN. */
  | { k: 'bets'; bets: number[]; locked: boolean[] }
  | { k: 'phase'; p: Phase }
  | { k: 'shoe'; remaining: number; last: boolean; rc: number; tc: number }
  /** The two face-up cards with the spread and the spread's pay (0 on a pair or consecutive hand). */
  | { k: 'two'; c1: string; c2: string; kind: string; spread: number; pays: number }
  /** A raise charged at the end of the window (`amount` is the extra stake). */
  | { k: 'raise'; seat: number; amount: number }
  /** The third card ('' when the hand has none). */
  | { k: 'third'; card: string }
  /** `kind`: consec | pairTrips | pairPush | win | lose | push | refund. Rows: [seat, payout]. */
  | { k: 'result'; kind: string; seats: number[][] }
  /** PRIVATE: the dog's ears tell whether the third card is 8 or above (Peek charm). */
  | { k: 'peek'; high: boolean };
type Act =
  | { k: 'bet'; amt: number }
  | { k: 'raise'; r: R.Raise };
type ResultEv = Extract<Ev, { k: 'result' }>;

/** What every peer sees. Mutated only in `present`. */
type Snap = {
  phase: Phase; bets: number[]; locked: boolean[]; raises: number[];
  c1: string; c2: string; third: string; kind: string; spread: number; pays: number;
  shoeLeft: number; last: boolean; rc: number; tc: number; result: string;
};

// ── host-only authority state ───────────────────────────────────────────────────────────────────
type HostState = {
  phase: Phase; timer: number; shoe: R.RdShoe;
  bets: number[]; locked: boolean[];
  /** Per seat: the raise chosen in this window (null = not decided yet). */
  raise: Array<R.Raise | null>;
  /** Total wager per seat (bet + charged raise). */
  stake: number[];
  plan: R.Plan | null; pay: R.Pay;
};

const zeros = (): number[] => new Array<number>(SEATS).fill(0);
const falses = (): boolean[] => new Array<boolean>(SEATS).fill(false);
const nulls = (): Array<R.Raise | null> => new Array<R.Raise | null>(SEATS).fill(null);

const freshHost = (shoe: R.RdShoe): HostState => ({
  phase: 'open', timer: 0, shoe, bets: zeros(), locked: falses(), raise: nulls(), stake: zeros(), plan: null, pay: R.BASE_PAY,
});
const freshSnap = (): Snap => ({
  phase: 'open', bets: zeros(), locked: falses(), raises: zeros(), c1: '', c2: '', third: '', kind: '', spread: 0, pays: 0,
  shoeLeft: R.DECKS * 52, last: false, rc: 0, tc: 0, result: '',
});

/** Greedy chip stack for an amount (at most 12 chips). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) while (rest >= v && out.length < 12) { out.push(v); rest -= v; }
  return out;
}

export const def: MachineDef = {
  id: 'reddog',
  category: 'card',
  slotSize: 'L',
  zone: 'cards',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: R.BET_MIN, maxBet: R.BET_MAX, betSteps: [5, 10, 25, 50, 100, 200],
  // host sanity cap per unit of bet: a raised trips at the milestone pays 16:1 on 3 units
  maxPayoutMult: 48,
  rtp: 0.972,
  actionCost: 1,
  tags: ['cards', 'table', 'dog', 'shared'],
  headless: R.playHeadless,
  modHooks: {
    'm.reddog.spreadPayAdd.spread': 'Every spread pays x more to one (added to the spread pay table).', // i18n-ok: debug hook docs
    'm.reddog.raiseMax': 'A raise may go up to x times the original bet (1 = the base game).', // i18n-ok: debug hook docs
    'm.reddog.pairWin': 'A pair without trips pays 1:1 (> 0 enables).', // i18n-ok: debug hook docs
    'm.reddog.tripsPayAdd': 'Three of a kind pays 11:1 plus x.', // i18n-ok: debug hook docs
    'x.table.peekCharges': 'The dog\'s ears show privately whether the third card is 8 or above.', // i18n-ok: debug hook docs
    'x.table.shoeInfo': 'The Counting Bead shows the Hi-Lo running and true count of the shoe.', // i18n-ok: debug hook docs
  },
  strings: STRINGS,
};

export { playHeadless } from './rules';

export default class RedDog extends TableBase<ReddogParts, Ev, Snap, Act> {
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** What every peer sees (mutated only in `present`). */
  private st: Snap = freshSnap();
  /** HOST ONLY authority state. */
  private hs: HostState = freshHost(new R.RdShoe(this.hostRng, R.DECKS));
  // presentation bookkeeping (all peers)
  private raiseSent = false;
  private cardIds = new Map<string, number>();
  private betIds: number[][] = Array.from({ length: SEATS }, (): number[] => []);
  private raiseIds: number[][] = Array.from({ length: SEATS }, (): number[] => []);

  protected createModel(kit: KitX): MachineModel<ReddogParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.hs = freshHost(new R.RdShoe(this.hostRng, R.DECKS));
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input ──────────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const seat = this.localSeat;
    const s = this.st;
    const open = s.phase === 'open' && seat >= 0 && !s.locked[seat];
    const raising = s.phase === 'raise' && seat >= 0 && s.locked[seat] && !this.raiseSent;
    switch (e.action) {
      case 'primary': case 'confirm':
        if (open) this.act({ k: 'bet', amt: this.bet });
        break;
      case 'n1': if (raising) this.sendRaise('full'); break;
      case 'n3': if (raising) this.sendRaise('half'); break;
      case 'n2': if (raising) this.sendRaise('none'); break;
      case 'betUp': case 'betDown': case 'betMax':
        if (!open) break;
        if (e.action === 'betMax') this.maxBet(); else this.stepBet(e.action === 'betUp' ? 1 : -1);
        this.sfx('click');
        break;
    }
    this.showHud();
  }

  private sendRaise(r: R.Raise): void {
    this.raiseSent = true;
    this.act({ k: 'raise', r });
  }

  // ── HOST: actions ──────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    switch (a.k) {
      case 'bet': {
        if (hs.phase !== 'open' || hs.locked[seat]) { this.nak(pid, rid, 'm.reddog.busy'); return; }
        const amt = Math.floor(a.amt);
        if (amt < R.BET_MIN || amt > R.BET_MAX) { this.nak(pid, rid, 'm.reddog.badBet'); return; }
        if (!this.chargeSeat(seat, amt)) { this.nak(pid, rid, 'common.noFunds'); return; }
        hs.bets[seat] = amt;
        hs.locked[seat] = true;
        this.emitBets();
        if (this.isSolo() || this.humans().every((h) => hs.locked[h.seat])) this.startRound();
        return;
      }
      case 'raise': {
        if (hs.phase !== 'raise' || !hs.locked[seat] || hs.raise[seat] !== null) { this.nak(pid, rid, 'm.reddog.raiseClosed'); return; }
        hs.raise[seat] = a.r;
        if (this.raiseDone()) this.endRaise();
        return;
      }
    }
  }

  // ── HOST: round flow ───────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'open':
        if (this.isSolo()) break;
        if ((hs.timer -= dt) <= 0) {
          if (hs.locked.some(Boolean)) this.startRound();
          else this.beginOpen();
        }
        break;
      case 'deal': if ((hs.timer -= dt) <= 0) this.afterDeal(); break;
      case 'spread': if ((hs.timer -= dt) <= 0) this.beginRaise(); break;
      case 'raise': if (!this.isSolo() && (hs.timer -= dt) <= 0) this.endRaise(); break;
      case 'third': if ((hs.timer -= dt) <= 0) this.settleHand(); break;
      case 'settle': if ((hs.timer -= dt) <= 0) this.afterSettle(); break;
      case 'shuffle': if ((hs.timer -= dt) <= 0) this.beginOpen(); break;
    }
  }

  private isSolo(): boolean { return this.humans().length <= 1; }

  private setPhase(p: Phase, dur: number): void {
    this.hs.phase = p;
    this.hs.timer = dur;
    void this.emit({ k: 'phase', p });
  }

  private emitBets(): void { void this.emit({ k: 'bets', bets: [...this.hs.bets], locked: [...this.hs.locked] }); }

  private emitShoe(): void {
    const sh = this.hs.shoe;
    void this.emit({ k: 'shoe', remaining: sh.remaining, last: sh.atCut, rc: sh.running, tc: Math.round(sh.trueCount) });
  }

  private beginOpen(): void {
    const hs = this.hs;
    hs.bets = zeros(); hs.locked = falses(); hs.raise = nulls(); hs.stake = zeros(); hs.plan = null;
    // bots sit in: house chips, the table minimum, on about six hands in ten
    for (const b of this.bots) {
      if (this.hostRng.chance(0.6) && this.chargeSeat(b.seat, R.BET_MIN)) { hs.bets[b.seat] = R.BET_MIN; hs.locked[b.seat] = true; }
    }
    this.emitBets();
    const solo = this.isSolo();
    this.setPhase('open', solo ? 0 : OPEN_S);
    if (!solo) void this.countdown(OPEN_S, 'open');
  }

  private startRound(): void {
    const hs = this.hs;
    this.cancelCountdown();
    hs.pay = this.payNow();
    hs.plan = R.plan(hs.shoe, this.hostRng, this.isSolo(), this.luck());
    hs.stake = [...hs.bets];
    hs.raise = hs.locked.map((l): R.Raise | null => (l ? null : 'none'));
    this.emitShoe();
    const d = hs.plan.deal;
    void this.emit({
      k: 'two', c1: d.c1, c2: d.c2, kind: d.kind, spread: d.spread,
      pays: d.kind === 'spread' ? R.spreadPay(d.spread, hs.pay) : 0,
    });
    this.setPhase('deal', DEAL_S);
  }

  private afterDeal(): void {
    const hs = this.hs, plan = hs.plan!, d = plan.deal;
    if (d.kind === 'consecutive') { this.settleHand(); return; }
    if (d.kind === 'spread') {
      // Peek charm: the dog's ears tell each seated player privately whether the third card is 8 or above
      if (this.tableMod('peekCharges', 0) > 0 && plan.third !== null) {
        const high = rankOf(plan.third) >= 8;
        for (const h of this.humans()) void this.emitPrivate(h.pid, { k: 'peek', high });
      }
      this.setPhase('spread', R.BARK_S * d.spread + 0.3);
      return;
    }
    this.revealThird();
  }

  private beginRaise(): void {
    const hs = this.hs, solo = this.isSolo();
    const worth = R.raiseWorthIt(hs.plan!.deal);
    for (const b of this.bots) {
      if (hs.locked[b.seat]) hs.raise[b.seat] = worth && this.hostRng.chance(0.5) ? 'full' : 'none';
    }
    this.setPhase('raise', solo ? 0 : RAISE_S);
    if (!solo) void this.countdown(RAISE_S, 'raise');
    if (this.raiseDone()) this.endRaise();
  }

  /** Every seated player in the hand has chosen a raise. */
  private raiseDone(): boolean {
    const hs = this.hs;
    return this.humans().every((h) => !hs.locked[h.seat] || hs.raise[h.seat] !== null);
  }

  /** Charges every raise at once, then the third card (or the settlement) follows. */
  private endRaise(): void {
    const hs = this.hs;
    if (hs.phase !== 'raise') return;
    this.cancelCountdown();
    for (let s = 0; s < SEATS; s++) {
      const r = hs.raise[s];
      if (!hs.locked[s] || r === null || r === 'none') continue;
      const amt = R.raiseAmount(hs.bets[s], r, hs.pay);
      if (this.chargeSeat(s, amt)) {
        hs.stake[s] += amt;
        void this.emit({ k: 'raise', seat: s, amount: amt });
      } else {
        const pid = this.seats[s];
        if (pid !== null) this.nak(pid, 0, 'm.reddog.noRaise');
      }
    }
    this.revealThird();
  }

  /** A pair or a spread draws its third card; the hand waits for it to land. */
  private revealThird(): void {
    const plan = this.hs.plan!;
    void this.emit({ k: 'third', card: plan.third ?? '' });
    this.setPhase('third', THIRD_S);
  }

  /** Settles every staked seat BEFORE the result is shown (MachineBase rule). */
  private settleHand(): void {
    const hs = this.hs, plan = hs.plan!, pay = hs.pay, d = plan.deal;
    let kind: string;
    if (d.kind === 'consecutive') kind = 'consec';
    else if (d.kind === 'pair') {
      if (plan.third !== null && rankOf(plan.third) === d.r1) kind = 'pairTrips';
      else kind = pay.pairWin ? 'win' : 'pairPush';
    } else if (plan.refund) kind = 'refund';
    else kind = plan.third !== null && R.inside(plan.third, d) ? 'win' : 'lose';
    const rows: number[][] = [];
    for (let s = 0; s < SEATS; s++) {
      const stake = hs.stake[s];
      if (!hs.locked[s] || stake <= 0) continue;
      const payout = R.roundCoins(R.settle(plan, stake, pay), this.hostRng);
      this.paySeat(s, payout, { bet: stake });
      rows.push([s, payout]);
    }
    void this.emit({ k: 'result', kind, seats: rows });
    this.setPhase('settle', SETTLE_S);
  }

  private afterSettle(): void {
    const hs = this.hs;
    if (hs.shoe.atCut) {
      hs.shoe.reshuffle();
      this.emitShoe();
      this.setPhase('shuffle', SHUFFLE_S);
    } else {
      this.beginOpen();
    }
  }

  /** Pay adjustments from the modifier stack and the milestones (read on the host once per hand). */
  private payNow(): R.Pay {
    return R.payFrom((k, b) => this.mod(k, b), (n) => this.feature(n));
  }

  /** A seat was vacated. Runs on every peer; the seat is already empty, so the pay helpers take the `pid`. */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    const hs = this.hs;
    if (this.isHost && hs) {
      if (hs.locked[seat] && hs.phase === 'open') {
        const bet = hs.bets[seat];
        this.paySeat(seat, bet, { bet, tier: 'push', tags: ['refund'] }, pid);
        hs.bets[seat] = 0;
        hs.locked[seat] = false;
        this.emitBets();
      }
      if (hs.phase === 'raise' && hs.raise[seat] === null) {
        hs.raise[seat] = 'none';
        if (this.raiseDone()) this.endRaise();
      }
    }
    if (local) { this.raiseSent = false; this.seatHud?.hide(); }
    this.paintLamps();
    this.paintBets();
    this.showHud();
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
    }
  }

  // ── presentation (every peer) ──────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const fast = pc.fast, st = this.st;
    switch (ev.k) {
      case 'bets': {
        st.bets = [...ev.bets];
        st.locked = [...ev.locked];
        this.paintBets();
        if (!fast && pc.local && this.localSeat >= 0 && st.locked[this.localSeat]) this.sfx('chip');
        this.showHud();
        return;
      }
      case 'phase': {
        st.phase = ev.p;
        if (ev.p === 'open') { this.clearTable(); this.raiseSent = false; }
        if (ev.p === 'raise') { this.raiseSent = false; this.sfx('bell'); }
        if (ev.p === 'spread') await this.barkSpread(st.spread, fast);
        if (ev.p === 'shuffle') this.sfx('shuffle');
        this.showHud();
        return;
      }
      case 'shoe': {
        st.shoeLeft = ev.remaining;
        st.last = ev.last;
        st.rc = ev.rc;
        st.tc = ev.tc;
        this.paintShoe();
        this.paintBead();
        this.showHud();
        return;
      }
      case 'two': {
        st.c1 = ev.c1; st.c2 = ev.c2; st.kind = ev.kind; st.spread = ev.spread; st.pays = ev.pays; st.third = '';
        this.paintPay();
        await this.dealTo('a', ev.c1 as CardId, cardSpotVec(0), fast);
        await this.dealTo('b', ev.c2 as CardId, cardSpotVec(1), fast);
        return;
      }
      case 'raise': {
        st.raises[ev.seat] = ev.amount;
        this.paintBets();
        this.sfx('chip');
        this.showHud();
        return;
      }
      case 'third': {
        if (ev.card === '') return;
        st.third = ev.card;
        await this.dealTo('c', ev.card as CardId, cardSpotVec(2), fast);
        this.sfx('cardFlip');
        return;
      }
      case 'peek': {
        this.toast(this.t(ev.high ? 'peekHigh' : 'peekLow'), 'sys');
        await this.flapEars(ev.high, fast);
        return;
      }
      case 'result': {
        await this.presentResult(ev, fast, pc);
        return;
      }
    }
  }

  /** The dog counts the spread: one bark per rank, the lamps climb with each bark. */
  private async barkSpread(n: number, fast: boolean): Promise<void> {
    const dog = this.model.parts.dog, lamps = this.model.parts.spreadLamps;
    for (let k = 0; k < n && !fast; k++) {
      lamps.forEach((l, i) => l.setOn(i <= k));
      this.sfx('thud', { vol: 0.6 });
      dog.jaw.rotation.x = -0.4;
      await this.wait(R.BARK_S * 0.5);
      dog.jaw.rotation.x = 0;
      await this.wait(R.BARK_S * 0.5);
    }
    lamps.forEach((l, i) => l.setOn(i < n));
    this.paintPay();
  }

  private async presentResult(ev: ResultEv, fast: boolean, pc: PresentCtx): Promise<void> {
    const st = this.st, dog = this.model.parts.dog;
    st.phase = 'settle';
    st.result = ev.kind;
    // the dog reacts to the whole table
    if (ev.kind === 'trips') { void this.howl(dog, fast); this.sfx('stinger', { vol: 0.8 }); }
    else if (ev.kind === 'win') { void this.wag(dog, fast); this.sfx('win2', { vol: 0.6 }); }
    else if (ev.kind === 'lose') { void this.droop(dog, fast); this.sfx('creak', { vol: 0.5 }); }
    else { void this.shrug(dog, fast); this.sfx('click', { vol: 0.5 }); }   // push: the whimper and the shrug
    const mine = this.localSeat;
    for (const row of ev.seats) {
      const seat = row[0], payout = row[1];
      if (seat !== mine) continue;
      const stake = st.bets[seat] + st.raises[seat];
      if (stake > 0) {
        const net = payout - stake;
        const kind: HudResultKind = net > 0 ? 'win' : net === 0 ? 'push' : 'lose';
        this.seatHud?.result(kind, net);
      }
      if (payout > 0) {
        const tier = juiceTier(payout, stake);
        void this.celebrate(tier, {
          amount: payout, at: this.model.anchors.coinOut, lamps: [], fast: pc.fast,
          restore: () => this.paintLamps(),
        });
        void this.pourCoins(payout, { bet: stake, fast });
      } else if (stake > 0) {
        this.commiserate({ at: this.model.anchors.coinOut });
      }
    }
    // the cards go to the discard tray; the chips are paid out and cleared at OPEN
    if (this.isLocalOccupant) this.showHud();
    if (!fast) await this.wait(0.3);
    this.model.parts.cards.clear();
    this.cardIds.clear();
    this.paintShoe();
    this.showHud();
  }

  /** Eyes-up howl for a trips: the jaw opens wide and the head lunges once at the seats. */
  private howl(dog: DogParts, fast: boolean): Promise<void> {
    void this.wait(0.7).then(() => this.resetDog());
    return this.anim(fast ? 0.01 : 0.6, (k) => {
      const s = Math.sin(k * Math.PI);
      dog.jaw.rotation.x = -0.6 * s;
      dog.head.position.z = DEALER_Z + 0.08 * s;
    });
  }

  /** The tail wags on a win. */
  private wag(dog: DogParts, fast: boolean): Promise<void> {
    void this.wait(0.9).then(() => { dog.tail.rotation.y = 0; });
    return this.anim(fast ? 0.01 : 0.8, (k) => { dog.tail.rotation.y = Math.sin(k * Math.PI * 6) * 0.6; });
  }

  /** The head sinks on a loss. */
  private droop(dog: DogParts, fast: boolean): Promise<void> {
    void this.wait(0.8).then(() => this.resetDog());
    return this.anim(fast ? 0.01 : 0.4, (k) => { dog.head.rotation.x = 0.25 * Math.sin(k * Math.PI); });
  }

  /** A push: the head tilts one way and back, the ears drop. */
  private shrug(dog: DogParts, fast: boolean): Promise<void> {
    void this.wait(0.7).then(() => this.resetDog());
    return this.anim(fast ? 0.01 : 0.5, (k) => { dog.head.rotation.z = 0.15 * Math.sin(k * Math.PI * 2); });
  }

  /** The ears go up for a high third card and down for a low one. */
  private flapEars(high: boolean, fast: boolean): Promise<void> {
    const dog = this.model.parts.dog;
    const target = high ? EARS_UP : EARS_DOWN;
    return this.anim(fast ? 0.01 : 0.3, (k) => {
      dog.earL.rotation.z = target * k;
      dog.earR.rotation.z = -target * k;
    });
  }

  /** Moves one card from the shoe mouth to `at`. */
  private async dealTo(key: string, card: CardId, at: THREE.Vector3, fast: boolean): Promise<void> {
    const p = this.model.parts;
    const old = this.cardIds.get(key);
    if (old !== undefined) { p.cards.remove(old); this.cardIds.delete(key); }
    const id = p.cards.add(card, shoeMouth(), 0);
    this.cardIds.set(key, id);
    this.sfx('card');
    await p.cards.move(id, at, fast ? 0.01 : 0.26, { arc: 0.05 });
  }

  /** Clears the felt and the lamps ahead of the next OPEN. Bets stay until the next bets event. */
  private clearTable(): void {
    this.model.parts.cards.clear();
    this.cardIds.clear();
    const st = this.st;
    st.c1 = ''; st.c2 = ''; st.third = ''; st.kind = ''; st.spread = 0; st.pays = 0; st.result = '';
    st.raises = zeros();
    this.paintPay();
    this.model.parts.spreadLamps.forEach((l) => l.setOn(false));
    this.resetDog();
    this.paintBets();
  }

  private resetDog(): void {
    const dog = this.model.parts.dog;
    dog.jaw.rotation.x = 0;
    dog.head.rotation.set(0, 0, 0);
    dog.head.position.set(0, DOG_Y, DEALER_Z);
    dog.tail.rotation.y = 0;
    dog.earL.rotation.z = EARS_UP;
    dog.earR.rotation.z = -EARS_UP;
  }

  // ── snapshots (late joiners get the public state only) ─────────────────────────────────────────
  getSnapshot(_forPid?: PlayerId): Snap {
    const s = this.st;
    return {
      phase: s.phase, bets: [...s.bets], locked: [...s.locked], raises: [...s.raises],
      c1: s.c1, c2: s.c2, third: s.third, kind: s.kind, spread: s.spread, pays: s.pays,
      shoeLeft: s.shoeLeft, last: s.last, rc: s.rc, tc: s.tc, result: s.result,
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, bets: [...sn.bets], locked: [...sn.locked], raises: [...sn.raises],
      c1: sn.c1, c2: sn.c2, third: sn.third, kind: sn.kind, spread: sn.spread, pays: sn.pays,
      shoeLeft: sn.shoeLeft, last: sn.last, rc: sn.rc, tc: sn.tc, result: sn.result,
    };
    this.paintAll();
    this.showHud();
  }

  // ── visuals ────────────────────────────────────────────────────────────────────────────────────
  override onLang(): void { this.paintFelt(); this.paintPay(); this.showHud(); }

  /** Resting pose of every visual for `this.st` (idempotent). */
  private paintAll(): void {
    this.paintLamps();
    this.paintBets();
    this.paintShoe();
    this.paintBead();
    this.paintFelt();
    this.paintPay();
    this.model.parts.cards.clear();
    this.cardIds.clear();
    this.model.parts.spreadLamps.forEach((l) => l.setOn(false));
    this.resetDog();
  }

  private paintLamps(): void {
    this.model.parts.seatLamps.forEach((l: LampPart, s: number) => l.setOn(this.seats[s] !== null));
  }

  /** Main bets (stacked at the seat's bet spot) and raises (stacked beside them). */
  private paintBets(): void {
    const p = this.model.parts;
    for (let s = 0; s < SEATS; s++) {
      for (const id of this.betIds[s]) p.chips.remove(id);
      for (const id of this.raiseIds[s]) p.chips.remove(id);
      this.betIds[s] = [];
      this.raiseIds[s] = [];
      const amount = this.st.bets[s];
      if (amount > 0) this.betIds[s] = p.chips.stack(chipsFor(amount), betVec(s));
      const raised = this.st.raises[s];
      if (amount > 0 && raised > 0) {
        const at = betVec(s).add(new THREE.Vector3(0.07, 0, 0));
        this.raiseIds[s] = p.chips.stack(chipsFor(raised), at);
      }
    }
  }

  private paintPay(): void {
    const st = this.st;
    const text = st.kind === 'spread' ? `${st.pays}:1` : st.kind === 'pair' ? `${R.TRIPS_PAY}:1` : st.kind === 'consecutive' ? '--' : '';
    this.model.parts.payLabel.draw((g, w) => {
      g.fillStyle = '#100808';
      g.fillRect(0, 0, w.w, w.h);
      w.text(text, w.w / 2, 3, { font: 'px5', color: '#ffd040', align: 'center' });
    });
  }

  private paintShoe(): void {
    const p = this.model.parts;
    const total = R.DECKS * 52;
    const used = Math.max(0, Math.min(1, (total - this.st.shoeLeft) / total));
    p.discardStack.scale.y = 0.2 + 0.8 * used;
    p.shoeLevel.scale.y = Math.max(0.1, this.st.shoeLeft / total);
  }

  /** The Counting Bead: its beads climb with the true count. Only visible with the charm. */
  private paintBead(): void {
    const p = this.model.parts;
    const on = this.tableMod('shoeInfo', 0) > 0;
    p.beadCounter.visible = on;
    if (!on) return;
    const v = Math.max(-5, Math.min(5, this.st.tc)) + 5;
    p.beadRods.slice(1).forEach((b, i) => { b.position.x = i < v ? 0.02 : 0; });
  }

  /** Felt canvas: the table name and one bet box per seat. Canvas top = the dealer side (−Z). */
  private paintFelt(): void {
    const X = (x: number, w: number): number => ((x + FELT_W / 2) / FELT_W) * w;
    const Y = (z: number, h: number): number => ((z + FELT_D / 2) / FELT_D) * h;
    this.model.parts.felt.draw((g, w) => {
      g.fillStyle = '#5a1a1e';
      g.fillRect(0, 0, w.w, w.h);
      g.strokeStyle = '#c9a227';
      g.lineWidth = 2;
      for (let s = 0; s < SEATS; s++) {
        const c = betVec(s);
        const bw = 0.2, bd = 0.1;
        const x0 = X(c.x - bw / 2, w.w), y0 = Y(c.z - bd / 2, w.h);
        g.strokeRect(x0, y0, (bw / FELT_W) * w.w, (bd / FELT_D) * w.h);
        w.text(this.t('box'), X(c.x, w.w), y0 + 2, { font: 'px5', color: '#ffd040', align: 'center' });
      }
      w.text(this.t('felt'), w.w / 2, Math.max(0, Y(-0.3, w.h) - 10), { font: 'px5', color: '#f4ead2', align: 'center' });
    });
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Settle banner for the round's result kind (see `presentResult`). */
  private resultBanner(kind: string): { k: string; tone: HudTone } {
    switch (kind) {
      case 'win': return { k: 'm.reddog.hResWin', tone: 'good' };
      case 'trips': case 'pairTrips': return { k: 'm.reddog.hResTrips', tone: 'gold' };
      case 'consec': return { k: 'm.reddog.hResConsec', tone: 'neutral' };
      case 'pairPush': return { k: 'm.reddog.hResPairNo', tone: 'neutral' };
      case 'lose': return { k: 'm.reddog.hResLose', tone: 'bad' };
      case 'refund': return { k: 'm.reddog.hResRefund', tone: 'neutral' };
      default: return { k: 'm.reddog.hResPush', tone: 'neutral' };
    }
  }

  private rulesLines(): Txt[] {
    return ['hRule1', 'hRule2', 'hRule3', 'hRule4', 'hRule5', 'hRule6'].map((r) => ({ k: 'm.reddog.' + r }));
  }

  /** Banner, key numbers and valid controls. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || this.localSeat < 0) return;
    const s = this.st, seat = this.localSeat;
    const inHand = s.locked[seat];
    const open = s.phase === 'open' && !inHand;
    const raising = s.phase === 'raise' && inHand && !this.raiseSent;
    const stake = inHand ? s.bets[seat] + s.raises[seat] : this.bet;
    const pay = this.payNow();
    sh.goal({ k: 'm.reddog.hGoal' });

    // STATE: what phase, what the player must decide
    switch (s.phase) {
      case 'open':
        if (inHand) sh.state({ k: 'm.reddog.hStLocked' }, 'cyan', { k: 'm.reddog.hStLockedSub' });
        else sh.state({ k: 'm.reddog.hStBet' }, 'gold', { k: 'm.reddog.hStBetSub', v: { bet: this.k('primary') } });
        break;
      case 'deal': sh.state({ k: 'm.reddog.hStDeal' }, 'neutral'); break;
      case 'spread':
        if (s.kind === 'consecutive') sh.state({ k: 'm.reddog.hStConsec' }, 'neutral');
        else if (s.kind === 'pair') sh.state({ k: 'm.reddog.hStPair' }, 'gold', { k: 'm.reddog.hStPairSub' });
        else sh.state({ k: 'm.reddog.hStSpread', v: { n: String(s.spread) } }, 'gold', { k: 'm.reddog.hStSpreadSub', v: { n: String(s.pays) } });
        break;
      case 'raise':
        if (raising) sh.state({ k: 'm.reddog.hStRaise' }, 'warn', { k: 'm.reddog.hStRaiseSub', v: { n: fmtCoins(R.raiseAmount(s.bets[seat], 'full', pay)) } });
        else if (inHand && this.raiseSent) sh.state({ k: 'm.reddog.hStRaiseSent' }, 'cyan');
        else sh.state({ k: 'm.reddog.hStRaiseWait' }, 'neutral');
        break;
      case 'third': sh.state({ k: 'm.reddog.hStThird' }, 'gold'); break;
      case 'settle': {
        const b = this.resultBanner(s.result);
        sh.state({ k: b.k }, b.tone);
        break;
      }
      default: sh.state({ k: 'm.reddog.hStShuffle' }, 'neutral');
    }

    // KEY NUMBERS: bet, raise, the two cards, the pay of the spread, the third card, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.reddog.hNBet' }, value: fmtCoins(stake), tone: 'gold' });
    if (inHand && s.raises[seat] > 0) nums.push({ label: { k: 'm.reddog.hNRaise' }, value: fmtCoins(s.raises[seat]), tone: 'warn' });
    if (s.c1 && s.c2) nums.push({ label: { k: 'm.reddog.hNCards' }, value: `${cardText(s.c1 as CardId)}  ${cardText(s.c2 as CardId)}`, tone: 'cyan' });
    if (s.kind === 'spread' && s.phase !== 'open') nums.push({ label: { k: 'm.reddog.hNPays' }, value: { k: 'm.reddog.hNPaysV', v: { n: String(s.pays) } }, tone: 'good' });
    if (s.third) nums.push({ label: { k: 'm.reddog.hNThird' }, value: cardText(s.third as CardId), tone: 'neutral' });
    nums.push({ label: { k: 'm.reddog.hNBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    if (open) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.reddog.hCBet' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.reddog.hCAmount' }, action: 'betUp' });
    }
    if (raising) {
      ctrl.push({ key: this.k('n1'), label: { k: 'm.reddog.hCRaise' }, action: 'n1', primary: true });
      ctrl.push({ key: this.k('n3'), label: { k: 'm.reddog.hCHalf' }, action: 'n3' });
      ctrl.push({ key: this.k('n2'), label: { k: 'm.reddog.hCPass' }, action: 'n2' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.reddog.hCRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.reddog.hCLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
