/**
 * Three Card Poker "Üç Kart Poker" (`threecard`) — shared half-moon table, six seats, host-resolved (TECH §3.4,
 * MACHINES_tables §16). Tier 2 (DECISIONS B).
 *
 * Shape of the code (the TableBase pattern of blackjack / pisti):
 *  - HOST ONLY (`hs`): the deck (reshuffled every hand), the dealer's three cards, every timer, the fate draw and the
 *    payouts. Clients send `act()` (bet, or Play / Fold); the host validates with the pure rules (`rules.ts`), charges and
 *    pays through the seat helpers, and publishes every event. Each player's own three cards go out with `emitPrivate`
 *    (only the owner's `present` sees faces); everyone else gets the public backs (`cards: null`).
 *  - EVERY PEER (`present`): the only place the visible state (`st`) changes. Events are queued, so the host's own
 *    presentation runs in order with everyone else's.
 *  - Round: OPEN (ante / Pair Plus, ready) → DEAL (3 cards each, shuffler whirr) → DECIDE (Play or Fold; shared 12 s,
 *    default Fold; solo waits) → REVEAL (dealer turns up; QUALIFIES lamp) → SETTLE (Ante, Play, Ante Bonus, Pair Plus) →
 *    END (3.5 s) → OPEN. A seat with Pair Plus only has no decision and settles at REVEAL's hand.
 *  - Bots bet the lowest ante and play basic strategy (Q-6-4 or better) on the host, one decision ~1.2 s after deal.
 *  - Leaving: before the deal the bet is refunded; during the round the seat is forfeited (its stake is written off, as
 *    TableBase requires). A disconnect counts as Fold for the rest of the round, so it never pays.
 *
 * Controls: Space / Enter ready · ← → Ante step (before ready) · N8 Pair Plus (cycles 0 → 1 → 5 → 10 → 25 → 50 → 100) ·
 * 1 Play · 2 Fold. Not in v1 (documented, not silently dropped): the swap-one charm (`threecard.swapOne`), the table peek
 * charge, the Q·6·4 placard milestone lamp (the lamp exists; the tycoon wiring is pending), mouse circles.
 * Juice: deal whoosh and card flips, Play chip stacks, fold pop, qualify / no-qualify text, win tiers (pop text, sparks,
 * celebrate), straight flush lid pop with sparks, push and loss feedback, the status screen counts the phases.
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { ChipValue } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { newDeck } from '@/machines/_base/cards';
import { STRINGS } from './threecard.strings';
import {
  buildModel, arcAt, cardSlot, dealerSlot, seatPhi, SEATS, ANTE_R, PLAY_R, PAIR_R, TOP, SHUFFLER_POS, type ThreecardParts,
} from './model';
import * as R from './rules';

const BET_S = 15, DECIDE_S = 12, REVEAL_S = 0.9, END_S = 3.5, BOT_MIN = 0.8, BOT_MAX = 1.6;
const GOLD = 0xffd040, GREEN = 0x7dff7a, RED = 0xff5a4a, WHITE = 0xffffff, SEAT_GOLD = 0xc9a227;
const CHIP_VALUES: ChipValue[] = [100, 25, 10, 5, 1];
const SHUFFLER_START = new THREE.Vector3(SHUFFLER_POS.x, TOP + 0.12, SHUFFLER_POS.z);
const CAT_KEY: Record<R.Cat, string> = { high: 'rHigh', pair: 'rPair', flush: 'rFlush', straight: 'rStraight', trips: 'rTrips', sf: 'rSf' };

type Phase = 'bet' | 'deal' | 'decide' | 'reveal' | 'settle' | 'end';
type Choice = 'none' | 'play' | 'fold';
type SeatResult = { seat: number; ante: number; play: number; bonus: number; pairPlus: number; out: string; ret: number; stake: number; cat: string };

// ── events (public unless noted), actions, snapshot ─────────────────────────────────────────────
type Ev =
  | { k: 'bet'; seat: number; ante: number; pp: number; ready: boolean }
  | { k: 'shuffle' }
  | { k: 'phase'; p: Phase }
  /** seat −1 = dealer. `cards: null` = public backs. The owner also gets `cards` (faces) through emitPrivate. */
  | { k: 'deal'; seat: number; cards: string[] | null }
  | { k: 'act'; seat: number; choice: 'play' | 'fold' }
  /** `dealer` is the three cards now; `shown` are the hands still in (folded hands stay hidden). */
  | { k: 'reveal'; dealer: string[]; qualifies: boolean; shown: Array<{ seat: number; cards: string[] }> }
  | { k: 'result'; seats: SeatResult[] }
  | { k: 'clear' };
type Act = { k: 'bet'; ante: number; pp: number; ready: boolean } | { k: 'choose'; choice: 'play' | 'fold' };

type PubSeat = { ante: number; pp: number; ready: boolean; cards: string[]; choice: Choice; out: string; ret: number; cat: string };
type Snap = { phase: Phase; seats: PubSeat[]; dealer: string[]; qual: boolean | null };

// ── host-only authority state ────────────────────────────────────────────────────────────────────
type HSeat = { owner: PlayerId | null; ready: boolean; ante: number; pp: number; hand: CardId[]; choice: Choice; forfeit: boolean };
type HostState = { phase: Phase; seats: HSeat[]; dealer: CardId[]; active: number[]; timer: number; botAt: number; qual: boolean };

const freshSeat = (): HSeat => ({ owner: null, ready: false, ante: 0, pp: 0, hand: [], choice: 'none', forfeit: false });
const pubSeat = (): PubSeat => ({ ante: 0, pp: 0, ready: false, cards: [], choice: 'none', out: '', ret: 0, cat: '' });
const freshHost = (): HostState => ({
  phase: 'bet', seats: Array.from({ length: SEATS }, () => freshSeat()), dealer: [], active: [], timer: 0, botAt: 0, qual: false,
});
const freshPub = (): Snap => ({ phase: 'bet', seats: Array.from({ length: SEATS }, () => pubSeat()), dealer: [], qual: null });

/** Greedy chip stack for an amount (at most 8 chips). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) while (rest >= v && out.length < 8) { out.push(v); rest -= v; }
  return out;
}
const ringPoint = (seat: number, r: number): THREE.Vector3 => {
  const c = arcAt(r, seatPhi(seat));
  return new THREE.Vector3(c.x, TOP + 0.005, c.z);
};
const nextPp = (v: number): number => R.PP_LADDER[(R.PP_LADDER.indexOf(v) + 1) % R.PP_LADDER.length];
const rankText = (cards: readonly string[]): string => cards.filter((c) => c !== '').map((c) => c[0]).join(' ');

export const def: MachineDef = {
  id: 'threecard',
  category: 'card',
  slotSize: 'L',
  zone: 'cards',
  seats: SEATS,
  shared: true,
  minBet: 5, maxBet: 200, betSteps: [...R.ANTE_LADDER],
  // host sanity cap per unit of stake: Pair Plus 100:1 (mini-royal) returns 101× its stake; the Ante side is far lower
  maxPayoutMult: 101,
  rtp: 0.9805,
  tier: 2,
  actionCost: 1,
  tags: ['cards', 'table', 'shared', 'skill'],
  headless: R.playHeadless,
  modHooks: {
    'm.threecard.pairPlusAdd': 'Adds x to every Pair Plus multiplier (not the high card). Pair-plus charm.',
    'm.threecard.anteBonusMult': 'Multiplies the Ante Bonus payout (1 = the table; 1.5 = +50 %).',
    'm.threecard.miniRoyal': 'Non-zero: suited A-K-Q pays 100:1 on Pair Plus.', // i18n-ok: dev hook docs
  },
  strings: STRINGS,
};

export { playHeadless } from './rules';

export default class ThreeCard extends TableBase<ThreecardParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Snap = freshPub();
  /** HOST ONLY authority state. */
  private hs: HostState = freshHost();
  /** Local bet preview (what the next Ready commits). */
  private ante: number = R.ANTE_LADDER[0];
  private pp = 0;
  private cardRefs = new Map<string, number>();
  private chipRefs = new Map<string, number[]>();
  private shownSecond = -1;

  protected createModel(kit: KitX): MachineModel<ThreecardParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.repaintAll();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax' || a === 'n8';
    if (e.repeat && !isBet) return;
    const st = this.st, seat = this.localSeat;
    const b = seat >= 0 ? st.seats[seat] : undefined;
    switch (a) {
      case 'primary': case 'confirm':
        if (st.phase === 'bet' && b && !b.ready) this.act({ k: 'bet', ante: this.ante, pp: this.pp, ready: true });
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (st.phase !== 'bet' || (b && b.ready)) break;
        this.stepAnte(a);
        this.sfx('click');
        this.act({ k: 'bet', ante: this.ante, pp: this.pp, ready: false });
        this.showHud();
        break;
      case 'n8':
        if (st.phase !== 'bet' || (b && b.ready)) break;
        this.pp = nextPp(this.pp);
        this.sfx('click');
        this.act({ k: 'bet', ante: this.ante, pp: this.pp, ready: false });
        this.showHud();
        break;
      case 'n1': case 'n2':
        if (st.phase === 'decide' && b && b.ante > 0 && b.choice === 'none') {
          this.act({ k: 'choose', choice: a === 'n1' ? 'play' : 'fold' });
        }
        break;
    }
  }

  private stepAnte(a: 'betUp' | 'betDown' | 'betMax'): void {
    const ladder = R.ANTE_LADDER;
    const i = ladder.indexOf(this.ante);
    if (a === 'betMax') this.ante = ladder[ladder.length - 1];
    else this.ante = ladder[Math.max(0, Math.min(ladder.length - 1, i + (a === 'betUp' ? 1 : -1)))];
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    if (a.k === 'bet') this.onBet(pid, seat, a, rid);
    else this.onChoose(pid, seat, a.choice, rid);
  }

  private onBet(pid: PlayerId, seat: number, a: Extract<Act, { k: 'bet' }>, rid: number): void {
    const hs = this.hs, b = hs.seats[seat];
    if (hs.phase !== 'bet' || b.ready) { this.nak(pid, rid, 'm.threecard.busy'); return; }
    const anteOk = a.ante === 0 || R.ANTE_LADDER.includes(a.ante);
    if (!anteOk || !R.PP_LADDER.includes(a.pp)) {
      this.nak(pid, rid, 'm.threecard.badBet'); return;
    }
    if (!a.ready) {                                           // a preview: show the stake, charge nothing
      b.ante = a.ante; b.pp = a.pp;
      void this.emit({ k: 'bet', seat, ante: a.ante, pp: a.pp, ready: false });
      return;
    }
    if (a.ante === 0 && a.pp === 0) { this.nak(pid, rid, 'm.threecard.badBet'); return; }
    if (!this.chargeSeat(seat, a.ante + a.pp, pid)) { this.nak(pid, rid, 'common.noFunds'); return; }
    b.owner = pid; b.ready = true; b.ante = a.ante; b.pp = a.pp;
    void this.emit({ k: 'bet', seat, ante: a.ante, pp: a.pp, ready: true });
    this.afterBet();
  }

  private afterBet(): void {
    const hs = this.hs;
    this.botsBet();
    const humans = this.humans();
    if (humans.length > 0 && humans.every((h) => hs.seats[h.seat].ready)) { this.startRound(); return; }
    if (hs.timer <= 0 && humans.length > 1) { hs.timer = BET_S; void this.countdown(BET_S, 'bet'); }
  }

  private humanReady(): boolean {
    return this.humans().some((h) => this.hs.seats[h.seat].ready);
  }

  /** Bots ante the lowest or second step and are ready for the round. */
  private botsBet(): void {
    const hs = this.hs;
    for (const bot of this.bots) {
      const b = hs.seats[bot.seat];
      const pid = this.seats[bot.seat];
      if (b.ready || pid === null || !isBot(pid)) continue;
      const ante = R.ANTE_LADDER[bot.rng.int(0, 1)];
      this.chargeSeat(bot.seat, ante, pid);
      b.owner = pid; b.ready = true; b.ante = ante; b.pp = 0;
      void this.emit({ k: 'bet', seat: bot.seat, ante, pp: 0, ready: true });
    }
  }

  private onChoose(pid: PlayerId, seat: number, choice: 'play' | 'fold', rid: number): void {
    const b = this.hs.seats[seat];
    if (this.hs.phase !== 'decide' || !b || b.owner !== pid || b.forfeit || b.ante === 0 || b.choice !== 'none') {
      this.nak(pid, rid, this.hs.phase === 'decide' ? 'm.threecard.notYourTurn' : 'm.threecard.busy');
      return;
    }
    if (!this.decide(seat, choice)) this.nak(pid, rid, 'common.noFunds');
  }

  /** Records a Play or Fold (Play charges the Play bet). Returns false when the Play bet cannot be charged. */
  private decide(seat: number, choice: 'play' | 'fold'): boolean {
    const hs = this.hs, b = hs.seats[seat];
    if (hs.phase !== 'decide' || b.choice !== 'none') return false;
    if (choice === 'play' && !this.chargeSeat(seat, b.ante, b.owner)) return false;
    b.choice = choice;
    void this.emit({ k: 'act', seat, choice });
    this.checkDecided();
    return true;
  }

  private checkDecided(): void {
    const hs = this.hs;
    if (hs.phase !== 'decide') return;
    const pending = hs.active.some((i) => { const b = hs.seats[i]; return !b.forfeit && b.ante > 0 && b.choice === 'none'; });
    if (!pending) { this.cancelCountdown(); this.reveal(); }
  }

  /** Bots decide by basic strategy (Q-6-4 or better), once, after the bot delay. */
  private botsDecide(): void {
    const hs = this.hs;
    for (const i of [...hs.active]) {
      const b = hs.seats[i];
      if (b.forfeit || b.ante === 0 || b.choice !== 'none' || b.owner === null || !isBot(b.owner)) continue;
      this.decide(i, R.basicPlay(b.hand) ? 'play' : 'fold');
    }
  }

  /** Shared table timeout: every undecided seat folds (default). */
  private timeoutFold(): void {
    const hs = this.hs;
    for (const i of [...hs.active]) {
      const b = hs.seats[i];
      if (!b.forfeit && b.ante > 0 && b.choice === 'none') this.decide(i, 'fold');
    }
  }

  // ── round ────────────────────────────────────────────────────────────────────────────────────
  private startRound(): void {
    const hs = this.hs;
    if (hs.phase !== 'bet') return;
    this.cancelCountdown();
    hs.timer = 0;
    hs.active = [];
    hs.seats.forEach((b, i) => { if (b.ready && b.owner !== null && b.ante + b.pp > 0) hs.active.push(i); });
    if (!hs.active.some((i) => !isBot(hs.seats[i].owner as PlayerId))) return;
    const deck = this.hostRng.shuffle(newDeck());
    hs.dealer = [];
    for (const i of hs.active) hs.seats[i].hand = [];
    void this.emit({ k: 'shuffle' });
    hs.phase = 'deal';
    void this.emit({ k: 'phase', p: 'deal' });
    // round-robin: one card to each seat, then the dealer, three times
    for (let k = 0; k < R.CARDS_PER_HAND; k++) {
      for (const i of hs.active) hs.seats[i].hand.push(deck.pop() as CardId);
      hs.dealer.push(deck.pop() as CardId);
    }
    for (const i of hs.active) {
      const b = hs.seats[i];
      void this.emit({ k: 'deal', seat: i, cards: null });                // public backs
      if (b.owner !== null) void this.emitPrivate(b.owner, { k: 'deal', seat: i, cards: b.hand as string[] });
    }
    void this.emit({ k: 'deal', seat: -1, cards: null });
    hs.phase = 'decide';
    void this.emit({ k: 'phase', p: 'decide' });
    const needs = hs.active.filter((i) => hs.seats[i].ante > 0);
    const humansNeed = needs.filter((i) => !isBot(hs.seats[i].owner as PlayerId)).length;
    hs.botAt = needs.some((i) => isBot(hs.seats[i].owner as PlayerId)) ? this.hostRng.float(BOT_MIN, BOT_MAX) : 0;
    const humansIn = hs.active.filter((i) => !isBot(hs.seats[i].owner as PlayerId)).length;
    if (humansNeed > 0 && humansIn > 1) { hs.timer = DECIDE_S; void this.countdown(DECIDE_S, 'decide'); }
    else hs.timer = 0;
    this.checkDecided();
  }

  /** Dealer turns up. Solo fate draw (a losing solo seat may get the dealer's three cards drawn again). */
  private reveal(): void {
    const hs = this.hs;
    hs.phase = 'reveal';
    this.cancelCountdown();
    void this.emit({ k: 'phase', p: 'reveal' });
    const live = hs.active.filter((i) => !hs.seats[i].forfeit);
    const humanLive = live.filter((i) => !isBot(hs.seats[i].owner as PlayerId));
    const luck = this.luck();
    if (luck > 0 && humanLive.length === 1 && live.length >= 1) {
      const i = humanLive[0];
      const before = this.paidFor(i, R.evalHand(hs.dealer), R.qualifies(R.evalHand(hs.dealer)));
      if (before.ret < before.stake && this.hostRng.chance(luck / 100)) {
        hs.dealer = R.fateDealer(live.map((j) => hs.seats[j].hand), this.hostRng);
      }
    }
    const dEval = R.evalHand(hs.dealer);
    hs.qual = R.qualifies(dEval);
    void this.emit({
      k: 'reveal', dealer: hs.dealer as string[], qualifies: hs.qual,
      shown: live.filter((i) => hs.seats[i].choice !== 'fold').map((i) => ({ seat: i, cards: hs.seats[i].hand as string[] })),
    });
    hs.timer = REVEAL_S;
  }

  private seatOpts(): R.SeatOpts {
    return {
      bonusMult: this.mod('m.threecard.anteBonusMult', 1),
      ppAdd: this.mod('m.threecard.pairPlusAdd', 0),
      miniRoyal: this.mod('m.threecard.miniRoyal', 0) > 0,
    };
  }

  private paidFor(i: number, dEval: R.HandEval, dq: boolean): R.SeatPaid {
    const b = this.hs.seats[i];
    return R.settleSeat({ ante: b.ante, pp: b.pp, played: b.choice === 'play', hand: b.hand }, dEval, dq, this.seatOpts());
  }

  /** Pays every live seat, then announces the results. Shared tables: a losing seat may get its Ante back (refund luck). */
  private settleRound(): void {
    const hs = this.hs;
    hs.phase = 'settle';
    void this.emit({ k: 'phase', p: 'settle' });
    const dEval = R.evalHand(hs.dealer), dq = hs.qual;
    const live = hs.active.filter((i) => !hs.seats[i].forfeit && hs.seats[i].owner !== null);
    const humanLive = live.filter((i) => !isBot(hs.seats[i].owner as PlayerId));
    const results: SeatResult[] = [];
    for (const i of live) {
      const b = hs.seats[i];
      const p = this.paidFor(i, dEval, dq);
      let ret = p.ret;
      const tags = [...p.tags];
      if (humanLive.length >= 2 && !isBot(b.owner as PlayerId) && p.ret < p.stake && b.ante > 0
        && this.hostRng.chance(this.luck() / 100)) {
        ret += b.ante; tags.push('refund');
      }
      this.paySeat(i, ret, { bet: p.stake, tags }, b.owner);
      results.push({ seat: i, ante: b.ante, play: p.play, bonus: p.bonus, pairPlus: p.pairPlus, out: p.out, ret, stake: p.stake, cat: R.evalHand(b.hand).cat });
    }
    void this.emit({ k: 'result', seats: results });
    hs.phase = 'end';
    hs.timer = END_S;
    void this.emit({ k: 'phase', p: 'end' });
  }

  private finishRound(): void {
    this.hs = freshHost();
    void this.emit({ k: 'clear' });
    void this.emit({ k: 'phase', p: 'bet' });
  }

  /** Leaving: before the deal the bet is refunded; during the round the seat is forfeited (a disconnect is a Fold). */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs, b = hs.seats[seat];
      if (b.owner === pid) {
        if (hs.phase === 'bet') {
          if (b.ready) this.paySeat(seat, b.ante + b.pp, { bet: b.ante + b.pp, tier: 'push', tags: ['refund'] }, pid);
          hs.seats[seat] = freshSeat();
          void this.emit({ k: 'bet', seat, ante: 0, pp: 0, ready: false });
        } else if (hs.phase !== 'end' && hs.phase !== 'settle') {
          b.forfeit = true;
          this.checkDecided();
        }
      }
    }
    if (local) this.hud(null);
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.refreshLamps();
    if (local) { this.sfx('chime'); this.showHud(); }
  }

  // ── host timers ──────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'bet':
        if (hs.timer > 0 && (hs.timer -= dt) <= 0) {
          hs.timer = 0;
          if (this.humanReady()) this.startRound();
        }
        break;
      case 'decide':
        if (hs.botAt > 0 && (hs.botAt -= dt) <= 0) { hs.botAt = 0; this.botsDecide(); }
        if (hs.timer > 0 && (hs.timer -= dt) <= 0) { hs.timer = 0; this.timeoutFold(); }
        break;
      case 'reveal':
        if ((hs.timer -= dt) <= 0) this.settleRound();
        break;
      case 'end':
        if ((hs.timer -= dt) <= 0) this.finishRound();
        break;
    }
  }

  // ── presentation (every peer, including the host) ────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const st = this.st, p = this.parts, fast = pc.fast;
    switch (ev.k) {
      case 'shuffle':
        this.sfx('shuffle');
        if (!fast) await this.anim(0.6, (k) => { p.drum.rotation.x = k * Math.PI * 8; });
        p.drum.rotation.x = 0;
        return;
      case 'bet': {
        const s = st.seats[ev.seat];
        if (ev.ready && !s.ready) this.sfx('chip');
        s.ante = ev.ante; s.pp = ev.pp; s.ready = ev.ready;
        if (!ev.ready) { s.choice = 'none'; }
        this.repaintBets(ev.seat);
        this.refreshLamps();
        this.drawStatus();
        if (this.localSeat === ev.seat) this.showHud();
        return;
      }
      case 'phase':
        st.phase = ev.p;
        p.phaseLamp.setOn(ev.p !== 'bet');
        this.refreshLamps();
        this.drawStatus();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'deal':
        await this.presentDeal(ev, fast);
        this.drawStatus();
        return;
      case 'act': {
        const s = st.seats[ev.seat];
        s.choice = ev.choice;
        if (ev.choice === 'play') {
          this.sfx('chipStack');
          this.stackChips(`y${ev.seat}`, chipsFor(s.ante), ringPoint(ev.seat, PLAY_R));
        } else {
          this.sfx('card');
          this.ctx.fx.popText(p.spots[ev.seat], this.t('rFold'), RED, { dur: 0.8, rise: 0.2 });
        }
        if (this.localSeat === ev.seat) this.showHud();
        this.drawStatus();
        return;
      }
      case 'reveal':
        await this.presentReveal(ev, fast);
        return;
      case 'result':
        await this.presentResult(ev, fast);
        this.drawStatus();
        return;
      case 'clear':
        this.clearTable();
        return;
    }
  }

  private async presentDeal(ev: Extract<Ev, { k: 'deal' }>, fast: boolean): Promise<void> {
    const p = this.parts, st = this.st;
    const dur = fast ? 0 : 0.25;
    if (ev.seat < 0) {                                        // dealer, face down
      st.dealer = ['', '', ''];
      for (let k = 0; k < R.CARDS_PER_HAND; k++) {
        const id = p.cards.add(null, SHUFFLER_START, 0);
        this.cardRefs.set(`d.${k}`, id);
        this.sfx('card');
        if (fast) void p.cards.move(id, dealerSlot(k), 0);
        else await p.cards.move(id, dealerSlot(k), dur);
      }
      return;
    }
    const s = st.seats[ev.seat];
    if (ev.cards === null) {                                  // public: backs
      s.cards = ['', '', ''];
      for (let k = 0; k < R.CARDS_PER_HAND; k++) {
        const id = p.cards.add(null, SHUFFLER_START, 0);
        this.cardRefs.set(`${ev.seat}.${k}`, id);
        this.sfx('card');
        if (fast) void p.cards.move(id, cardSlot(ev.seat, k), 0);
        else await p.cards.move(id, cardSlot(ev.seat, k), dur);
      }
      return;
    }
    // private: the owner's own faces turn over
    s.cards = ev.cards.slice();
    for (let k = 0; k < ev.cards.length; k++) {
      const id = this.cardRefs.get(`${ev.seat}.${k}`);
      if (id === undefined) continue;
      p.cards.setCard(id, ev.cards[k] as CardId);
      this.sfx('cardFlip');
      if (fast) void p.cards.flip(id, 0);
      else await p.cards.flip(id, 0.2);
    }
  }

  private async presentReveal(ev: Extract<Ev, { k: 'reveal' }>, fast: boolean): Promise<void> {
    const p = this.parts, st = this.st;
    st.dealer = ev.dealer.slice();
    st.qual = ev.qualifies;
    for (let k = 0; k < ev.dealer.length; k++) {
      const id = this.cardRefs.get(`d.${k}`);
      if (id === undefined) continue;
      p.cards.setCard(id, ev.dealer[k] as CardId);
      this.sfx('cardFlip');
      if (fast) void p.cards.flip(id, 0); else await p.cards.flip(id, 0.3);
    }
    for (const sh of ev.shown) {
      const s = st.seats[sh.seat];
      for (let k = 0; k < sh.cards.length; k++) {
        if (s.cards[k] !== '') continue;                      // the owner already has faces
        const id = this.cardRefs.get(`${sh.seat}.${k}`);
        if (id === undefined) continue;
        p.cards.setCard(id, sh.cards[k] as CardId);
        s.cards[k] = sh.cards[k];
        void p.cards.flip(id, fast ? 0 : 0.2);
      }
    }
    p.qualifyLamp.setOn(ev.qualifies);
    this.sfx(ev.qualifies ? 'bell' : 'buzzer');
    this.ctx.fx.popText(p.cards.root, this.t(ev.qualifies ? 'sQual' : 'sNoQual'), ev.qualifies ? GOLD : RED, { dur: 1.0, rise: 0.25 });
    this.drawStatus();
    if (!fast) await this.wait(REVEAL_S * 0.6);
  }

  private async presentResult(ev: Extract<Ev, { k: 'result' }>, fast: boolean): Promise<void> {
    const p = this.parts, st = this.st;
    for (const r of ev.seats) {
      const s = st.seats[r.seat];
      s.out = r.out; s.ret = r.ret; s.cat = r.cat;
      const at = p.spots[r.seat];
      const win = r.ret - r.stake;
      const tags = r.cat === 'sf' ? ['sf'] : r.bonus > 0 ? ['bonus'] : [];
      const tier = juiceTier(r.ret, r.stake, tags);
      if (r.ret > r.stake && r.stake > 0) {
        this.sfx(tier === 'small' ? 'win1' : tier === 'medium' ? 'win2' : 'win3');
        this.ctx.fx.popText(at, `+${fmtCoins(win)}`, GOLD, { dur: 1.1, rise: 0.3, scale: 1.1 });
        this.ctx.fx.popText(at, this.t(CAT_KEY[r.cat as R.Cat] ?? 'rWin'), GREEN, { dur: 1.0, rise: 0.4 });
        if (r.cat === 'sf') { this.ctx.fx.sparks(at, 16, GOLD); void this.popLid(); }
        if (tier !== 'small') void this.celebrate(tier, { amount: win, at, fast });
      } else if (r.stake > 0 && r.ret === r.stake) {
        this.sfx('coin', { vol: 0.6 });
        this.ctx.fx.popText(at, this.t('rPush'), WHITE, { dur: 0.9, rise: 0.2 });
      } else if (r.stake > 0) {
        if (r.ret === 0) this.commiserate({ at, amount: r.stake });
        this.ctx.fx.popText(at, this.t(r.out === 'fold' ? 'rFold' : 'rLose'), RED, { dur: 0.9, rise: 0.2 });
      }
      this.clearChipsFor(r.seat);
    }
    if (!fast) await this.wait(0.2);
  }

  /** Straight flush: the Shuffler's lid pops open in gold light, then settles. */
  private async popLid(): Promise<void> {
    const lid = this.parts.lid;
    await this.anim(0.9, (k) => { lid.rotation.x = -1.1 * Math.sin(k * Math.PI); });
    lid.rotation.x = 0;
  }

  private stackChips(key: string, vs: ChipValue[], at: THREE.Vector3): void {
    const old = this.chipRefs.get(key);
    if (old) for (const id of old) this.parts.chips.remove(id);
    this.chipRefs.delete(key);
    if (vs.length) this.chipRefs.set(key, this.parts.chips.stack(vs, at));
  }

  private repaintBets(seat: number): void {
    const s = this.st.seats[seat];
    this.stackChips(`a${seat}`, chipsFor(s.ante), ringPoint(seat, ANTE_R));
    this.stackChips(`p${seat}`, chipsFor(s.pp), ringPoint(seat, PAIR_R));
  }

  private clearChipsFor(seat: number): void {
    for (const key of [`a${seat}`, `p${seat}`, `y${seat}`]) {
      const ids = this.chipRefs.get(key);
      if (ids) for (const id of ids) this.parts.chips.remove(id);
      this.chipRefs.delete(key);
    }
  }

  private clearTable(): void {
    const p = this.parts;
    p.cards.clear(); p.chips.clear();
    this.cardRefs.clear(); this.chipRefs.clear();
    this.st = freshPub();
    p.qualifyLamp.setOn(false);
    p.phaseLamp.setOn(false);
    this.refreshLamps();
    this.drawStatus();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: everything in `st` is public; a late joiner also gets their own faces ─────────
  getSnapshot(forPid?: PlayerId): Snap {
    const sn = JSON.parse(JSON.stringify(this.st)) as Snap;
    if (forPid !== undefined) {
      this.hs.seats.forEach((b, i) => { if (b.owner === forPid && b.hand.length > 0) sn.seats[i].cards = [...b.hand] as string[]; });
    }
    return sn;
  }
  applySnapshot(sn: Snap): void {
    this.st = JSON.parse(JSON.stringify(sn)) as Snap;
    this.repaintAll();
  }

  /** Rebuilds every pool and screen from `st` (init, late join). */
  private repaintAll(): void {
    const st = this.st, p = this.parts;
    p.cards.clear(); p.chips.clear();
    this.cardRefs.clear(); this.chipRefs.clear();
    st.dealer.forEach((c, k) => { this.cardRefs.set(`d.${k}`, p.cards.add(c === '' ? null : (c as CardId), dealerSlot(k), 0)); });
    st.seats.forEach((s, i) => {
      s.cards.forEach((c, k) => { this.cardRefs.set(`${i}.${k}`, p.cards.add(c === '' ? null : (c as CardId), cardSlot(i, k), 0)); });
      this.repaintBets(i);
    });
    p.qualifyLamp.setOn(st.qual === true);
    p.phaseLamp.setOn(st.phase !== 'bet');
    this.refreshLamps();
    this.drawStatus();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  frame(): void {
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.drawStatus(); }
  }
  onLang(): void { this.drawStatus(); if (this.isLocalOccupant) this.showHud(); }

  private refreshLamps(): void {
    const p = this.parts;
    for (let i = 0; i < SEATS; i++) p.seatLamps.setBulb(i, this.seats[i] !== null ? SEAT_GOLD : null);
  }

  private statusText(): string {
    const st = this.st, seat = this.localSeat, mine = seat >= 0 ? st.seats[seat] : undefined;
    switch (st.phase) {
      case 'bet': return mine && mine.ready ? this.t('sWait') : this.t('sBet');
      case 'deal': return this.t('sDeal');
      case 'decide':
        if (mine && mine.ante > 0 && mine.choice === 'none') return this.t('sDecide');
        return mine && mine.choice === 'fold' ? this.t('sFoldWait') : this.t('sWait');
      case 'reveal': return this.t('sReveal');
      case 'settle': return this.t('sSettle');
      default: return this.t('hClear');
    }
  }

  private drawStatus(): void {
    const st = this.st, p = this.parts;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const hidden = st.dealer.length === 0 || st.dealer.some((c) => c === '');
    const dealerText = hidden ? (st.dealer.length ? this.t('dealerHidden') : '') : this.t('dealer', { n: rankText(st.dealer) });
    p.status.draw((g, w) => {
      g.fillStyle = '#080b08'; g.fillRect(0, 0, w.w, w.h);
      w.text(this.statusText(), 128, 2, { font: 'px5', color: '#7dff7a', align: 'center' });
      w.text(dealerText, 4, 30, { font: 'px5', color: '#e0c060' });
      if (st.qual !== null && !hidden) {
        w.text(st.qual ? this.t('sQual') : this.t('sNoQual'), 252, 30, { font: 'px5', color: st.qual ? '#7dff7a' : '#ff5a4a', align: 'right' });
      }
      if (left > 0) w.text(String(left), 252, 2, { font: 'px5', color: '#ffffff', align: 'right' });
    });
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────────────────────
  private showHud(): void {
    const st = this.st, seat = this.localSeat;
    const b = seat >= 0 ? st.seats[seat] : undefined;
    const hints: HudHint[] = [];
    if (st.phase === 'bet' && b && !b.ready) {
      hints.push({ action: 'primary', label: this.t('ready') }, { action: 'betUp', label: this.t('anteStep') }, { action: 'n8', label: this.t('side') });
    }
    if (st.phase === 'decide' && b && b.ante > 0 && b.choice === 'none') {
      hints.push({ action: 'n1', label: this.t('hintPlay') }, { action: 'n2', label: this.t('hintFold') });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: st.phase === 'bet' && b && !b.ready ? this.ante : null,
      hints,
      stats: st.phase === 'bet' && this.pp > 0 ? [{ label: this.t('side'), value: fmtCoins(this.pp) }] : [],
    });
  }
}
