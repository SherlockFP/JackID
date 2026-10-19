/**
 * Bingo "Hall of Calls" (`bingo`) — shared draw hall, 8 desks + patrons (MACHINES_tables §18). A `TableBase` device.
 *
 * Host timeline: BUY (shared 15 s window; solo waits for Ready) → LOCK 0.8 s (the host orders all 75 balls and charges
 * nothing new) → CALL (40 base balls, 1.4 s each; solo 0.7 s) → EXTRA (up to 8 balls: an offer per eligible buyer, 6 s,
 * then the ball is revealed to everyone and applied to the buyers only; EV-priced) → AWARD (every card scored for its
 * best pattern, paid before the presentation) → BUY. Hidden information: the ball order and extra offers are private
 * to the host; offers and peeks are sent with `emitPrivate`.
 *
 * Juice: anticipation (cage spins up, crank turns, Caller's bell) → action (each ball pops from the chute, a tile clack,
 * the flash-board lamp lights, daubs thump onto the local cards) → impact (pattern pop text, frame = caller stands and
 * the screen shakes) → follow-through (tier celebration, commiseration or the "1 TO GO" amber blink).
 */
import type { KitX } from '@/kit';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierTags } from '@/machines/_base/tiers';
import { buildModel, commitBoard, setLamp, type BingoDesk, type BingoParts } from './model';
import {
  BASE_CALLS, CARD_CAP, MAX_EXTRA, MAX_STAKE, MIN_STAKE, baseSet, best, cellOf, extraPrice, freeDaubs,
  makeCard, marksOf, orderBalls, playHeadless, settleCard, targetOf, type Adj, type Card,
} from './rules';
import { STRINGS } from './bingo.strings';

// ── timing (seconds, ×1 speed) and limits ────────────────────────────────────────────────────────
const SEATS = 8;
const BUY_S = 15;              // shared buy window
const LOCK_S = 0.8;            // cage spin-up
const CALL_SHARED_MS = 1400;   // 40 × 1.4 s = 56 s
const CALL_SOLO_MS = 700;      // solo: 28 s
const OFFER_S = 6;             // extra-ball offer window
const REVEAL_S = 1.4;          // one extra ball on screen
const AWARD_S = 2.0;
const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.bingo.' + k }));
const GOLD = 0xffd040, GREEN = 0x7dff7a, RED = 0xff3b30, AMBER = 0xffb000;
const PATTERN_KEY: Record<string, string> = {
  line: 'pLine', corners: 'pCorners', double: 'pDouble', triple: 'pTriple', x: 'pX', frame: 'pFrame', none: 'pNone',
};

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Phase = 'idle' | 'buy' | 'lock' | 'call' | 'extra' | 'award';
type CardPub = { id: number; grid: number[]; free: number[]; daubs: number[] };
type SeatPub = { seat: number; stake: number; cards: CardPub[] };
type Ev =
  | { k: 'phase'; p: Phase }
  | { k: 'cards'; seat: number; stake: number; cards: Array<{ id: number; grid: number[]; free: number[] }> }
  | { k: 'drop'; seat: number }
  | { k: 'draw'; n: number[]; stepMs: number; daubs: number[] }
  | { k: 'ball'; idx: number; n: number; hits: number[] }
  | { k: 'offer'; idx: number; price: number; n: number; pattern: string }
  | { k: 'peek'; n: number }
  | { k: 'award'; seat: number; total: number; stake: number; cards: Array<{ id: number; pattern: string; gross: number; nearmiss: boolean }> };
type Act = { k: 'buy'; n: number; stake: number } | { k: 'accept'; yes: boolean };
/** What every peer knows (public felt state). Mutated only in `present`. */
type State = { phase: Phase; called: number[]; seats: SeatPub[] };
type Snap = State;

/** Host-only authority. */
type HCard = { id: number; card: Card; daubs: number[] };
type HBet = { pid: PlayerId; seat: number; stake: number; cards: HCard[]; staked: number; peek: number; auto: number; left: boolean };
type Offer = { seat: number; price: number; open: boolean; buy: boolean };
type Host = {
  phase: Phase; timer: number; sub: 'offer' | 'reveal';
  bets: Array<HBet | null>; order: number[]; revealed: boolean[]; idx: number;
  offers: Map<number, Offer>; nextId: number;
};

const emptyBets = (): Array<HBet | null> => new Array<HBet | null>(SEATS).fill(null);
const letterOf = (n: number): string => LETTERS[Math.min(4, Math.floor((n - 1) / 15))];
const hexStr = (c: number): string => `#${(c >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

export default class BingoHall extends TableBase<BingoParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', called: [], seats: [] };
  private hs: Host = {
    phase: 'idle', timer: 0, sub: 'offer', bets: emptyBets(), order: [],
    revealed: new Array<boolean>(76).fill(false), idx: 0, offers: new Map(), nextId: 1,
  };
  /** Local only: the seated player's card count and the open extra-ball offer. */
  private cardCount = 1;
  private offerLocal: { price: number; n: number; pattern: string } | null = null;
  /** Seat HUD overlay (goal, state, key numbers, controls, result callout, tip and rules cards). */
  private seatHud?: SeatHud;
  private hudSig = '';

  protected createModel(kit: KitX): MachineModel<BingoParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintBoardScreen();
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  private adjust(): Adj { return (name, base) => this.mod(`m.bingo.${name}` as ModHook, base); }
  private cap(): number { return CARD_CAP + Math.max(0, Math.round(this.mod('m.bingo.cardSlotsAdd' as ModHook, 0))); }
  private shared(): boolean { return this.humans().length >= 2; }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card; reading it never buys
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    const seat = this.localSeat;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'n6': this.cardCount = (this.cardCount % this.cap()) + 1; this.sfx('click'); this.showHud(); break;   // card count 1..cap
      case 'confirm': if (seat >= 0) this.act({ k: 'buy', n: this.cardCount, stake: this.bet }); break;       // buy / ready
      case 'n5': if (seat >= 0 && this.offerLocal) this.act({ k: 'accept', yes: true }); break;               // buy the offered ball
      case 'clear': if (seat >= 0 && this.offerLocal) this.act({ k: 'accept', yes: false }); break;           // decline
      default: break;
    }
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'buy') {
      if (hs.phase !== 'buy') { this.nak(pid, rid, 'm.bingo.busy'); return; }
      if (hs.bets[seat]) { this.nak(pid, rid, 'm.bingo.already'); return; }
      if (!Number.isInteger(a.n) || a.n < 1 || a.n > this.cap()) { this.nak(pid, rid, 'm.bingo.badCount'); return; }
      if (!Number.isInteger(a.stake) || a.stake < MIN_STAKE || a.stake > MAX_STAKE) { this.nak(pid, rid, 'm.bingo.badStake'); return; }
      const cost = a.n * a.stake;
      if (!this.chargeSeat(seat, cost, pid)) { this.nak(pid, rid, 'm.bingo.noFunds'); return; }
      const adj = this.adjust();
      const secondFree = adj('secondFree', 0) >= 1;
      const cards: HCard[] = [];
      for (let i = 0; i < a.n; i++) cards.push({ id: hs.nextId++, card: makeCard(this.hostRng, secondFree), daubs: [] });
      hs.bets[seat] = {
        pid, seat, stake: a.stake, cards, staked: cost,
        peek: Math.max(0, Math.round(this.tableMod('peekCharges', 0))),
        auto: Math.max(0, Math.round(adj('ballCountAdd', 0))), left: false,
      };
      void this.emit({
        k: 'cards', seat, stake: a.stake,
        cards: cards.map((c) => ({ id: c.id, grid: [...c.card.grid], free: [...c.card.free] })),
      });
      if (!this.shared()) this.startLock();                                 // solo: Ready is the buy
      return;
    }
    // accept / decline an extra-ball offer
    const o = hs.offers.get(seat);
    if (hs.phase !== 'extra' || hs.sub !== 'offer' || !o || !o.open) { this.nak(pid, rid, 'm.bingo.offerGone'); return; }
    if (!a.yes) { o.open = false; this.checkOffers(); return; }
    if (!this.chargeSeat(seat, o.price, pid)) { this.nak(pid, rid, 'm.bingo.noFunds'); o.open = false; this.checkOffers(); return; }
    o.open = false;
    o.buy = true;
    const bet = hs.bets[seat];
    if (bet) bet.staked += o.price;
    this.checkOffers();
  }

  // ── HOST: timeline ────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans().length;
    if (hs.phase === 'idle') { if (humans) this.startBuy(); return; }
    if (humans === 0) { this.resetHall(); return; }
    hs.timer -= dt;
    switch (hs.phase) {
      case 'buy':
        if (!this.shared()) return;                                         // solo waits for Ready
        if (hs.timer <= 0) { if (this.anyBets()) this.startLock(); else this.startBuy(); }
        return;
      case 'lock': if (hs.timer <= 0) this.startCall(); return;
      case 'call': if (hs.timer <= 0) this.nextExtra(); return;
      case 'extra':
        if (hs.sub === 'offer') { if (hs.timer <= 0) this.resolveOffers(); }
        else if (hs.timer <= 0) this.nextExtra();
        return;
      case 'award': if (hs.timer <= 0) this.endRound(); return;
    }
  }

  private liveBets(): HBet[] {
    const out: HBet[] = [];
    for (const b of this.hs.bets) if (b && !b.left) out.push(b);
    return out;
  }
  private anyBets(): boolean { return this.liveBets().length > 0; }

  private startBuy(): void {
    const hs = this.hs;
    hs.phase = 'buy';
    hs.timer = BUY_S;
    hs.order = [];
    hs.revealed = new Array<boolean>(76).fill(false);
    hs.idx = 0;
    hs.offers.clear();
    if (this.shared()) void this.countdown(BUY_S, 'buy');
    void this.emit({ k: 'phase', p: 'buy' });
  }

  private startLock(): void {
    this.cancelCountdown();
    this.hs.phase = 'lock';
    this.hs.timer = LOCK_S;
    void this.emit({ k: 'phase', p: 'lock' });
  }

  /** Host: orders all 75 balls, applies free daubs after the 40 base calls, then announces the base calls. */
  private startCall(): void {
    const hs = this.hs;
    const adj = this.adjust();
    const solo = !this.shared();
    const luck = solo ? this.luck() : 0;
    const charges = Math.max(0, Math.round(adj('freeDaub', 0)));
    const live = this.liveBets();
    const net = (order: number[]): number => {
      const base = baseSet(order);
      const unc = order.filter((n) => !base[n]);
      let g = 0, s = 0;
      for (const b of live) for (const c of b.cards) {
        g += settleCard(c.card, base, freeDaubs(c.card, base, unc, charges, adj), b.stake, false, adj).gross;
        s += b.stake;
      }
      return g - s;
    };
    let order = orderBalls(this.hostRng);
    const gate = this.hostRng.next();                                      // always drawn: stream stays fixed
    if (luck > 0 && gate < luck / 100 && net(order) < 0) order = orderBalls(this.hostRng);   // solo luck reroll

    const base = baseSet(order);
    const unc = order.filter((n) => !base[n]);
    const daubs: number[] = [];
    for (const b of live) for (const c of b.cards) {
      c.daubs = freeDaubs(c.card, base, unc, charges, adj);
      for (const cell of c.daubs) daubs.push(b.seat, c.id, cell);
    }
    hs.order = order;
    hs.revealed = new Array<boolean>(76).fill(false);
    for (const n of order.slice(0, BASE_CALLS)) hs.revealed[n] = true;
    hs.idx = 0;
    hs.offers.clear();
    const stepMs = solo ? CALL_SOLO_MS : CALL_SHARED_MS;
    hs.phase = 'call';
    hs.timer = (BASE_CALLS * stepMs) / 1000;
    void this.emit({ k: 'draw', n: order.slice(0, BASE_CALLS), stepMs, daubs });
  }

  /** Host: the next extra ball. Eligible buyers (one number from a better pattern) get a private, EV-priced offer. */
  private nextExtra(): void {
    const hs = this.hs;
    if (hs.idx >= MAX_EXTRA || BASE_CALLS + hs.idx >= hs.order.length) { this.startAward(); return; }
    const adj = this.adjust();
    const base = baseSet(hs.order);
    const pool: number[] = [];
    for (let n = 1; n <= 75; n++) if (!hs.revealed[n]) pool.push(n);
    const nextN = hs.order[BASE_CALLS + hs.idx];
    let anyOffer = false;
    let anyAuto = false;
    for (const b of this.liveBets()) {
      if (b.auto > hs.idx) { anyAuto = true; continue; }                    // Spare Number: counted for free, no offer
      let tgt: { n: number; pattern: string; gain: number } | null = null;
      for (const hc of b.cards) {
        const m = marksOf(hc.card, base, hc.daubs);
        const t = targetOf(hc.card, m, pool, adj);
        if (!t || (tgt && t.gain <= tgt.gain)) continue;
        const after = m.slice();
        after[cellOf(hc.card, t.n)] = true;
        tgt = { n: t.n, pattern: best(after, adj).pattern, gain: t.gain };
      }
      if (!tgt) continue;
      const price = extraPrice(b.cards.map((c) => ({ card: c.card, stake: b.stake, daubs: c.daubs })), base, pool, adj);
      hs.offers.set(b.seat, { seat: b.seat, price, open: true, buy: false });
      anyOffer = true;
      void this.emitPrivate(b.pid, { k: 'offer', idx: hs.idx, price, n: tgt.n, pattern: tgt.pattern });
      if (b.peek > 0) { b.peek--; void this.emitPrivate(b.pid, { k: 'peek', n: nextN }); }
    }
    if (anyOffer) {
      hs.phase = 'extra';
      hs.sub = 'offer';
      hs.timer = OFFER_S;
      return;
    }
    if (anyAuto) { this.reveal(new Set()); return; }
    this.startAward();
  }

  private checkOffers(): void {
    for (const o of this.hs.offers.values()) if (o.open) return;
    this.resolveOffers();
  }

  /** Host: the offer window closed (all answered or timed out). Reveal the ball to the buyers. */
  private resolveOffers(): void {
    const buyers = new Set<number>();
    for (const o of this.hs.offers.values()) if (o.buy) buyers.add(o.seat);
    this.hs.offers.clear();
    this.reveal(buyers);
  }

  /** Host: reveal the next extra ball; it marks the cards of the buyers and of the Spare Number owners only. */
  private reveal(buyers: Set<number>): void {
    const hs = this.hs;
    const n = hs.order[BASE_CALLS + hs.idx];
    const hits: number[] = [];
    for (const b of this.liveBets()) {
      if (!(buyers.has(b.seat) || b.auto > hs.idx)) continue;
      for (const hc of b.cards) {
        const cell = cellOf(hc.card, n);
        if (cell < 0 || hc.daubs.includes(cell)) continue;
        hc.daubs.push(cell);
        hits.push(b.seat, hc.id, cell);
      }
    }
    hs.revealed[n] = true;
    hs.phase = 'extra';
    hs.sub = 'reveal';
    hs.timer = REVEAL_S;
    hs.idx++;
    void this.emit({ k: 'ball', idx: hs.idx - 1, n, hits });
  }

  /** Host: score every card, pay every seat BEFORE the presentation, then announce each seat. */
  private startAward(): void {
    const hs = this.hs;
    const adj = this.adjust();
    const base = baseSet(hs.order);
    const shared = this.shared();
    hs.phase = 'award';
    hs.timer = AWARD_S;
    hs.offers.clear();
    for (const b of hs.bets) {
      if (!b) continue;
      const outs = b.cards.map((hc) => ({ id: hc.id, out: settleCard(hc.card, base, hc.daubs, b.stake, shared, adj) }));
      const gross = outs.reduce((s, o) => s + o.out.gross, 0);
      if (!b.left && gross > 0) this.paySeat(b.seat, gross, { bet: b.staked }, b.pid);
      else this.forfeit(b.seat);
      void this.emit({
        k: 'award', seat: b.seat, total: gross, stake: b.staked,
        cards: outs.map((o) => ({ id: o.id, pattern: o.out.pattern, gross: o.out.gross, nearmiss: o.out.nearmiss })),
      });
    }
  }

  private endRound(): void {
    const hs = this.hs;
    hs.bets = emptyBets();
    hs.order = [];
    hs.idx = 0;
    if (this.humans().length) this.startBuy();
    else this.resetHall();
  }

  private resetHall(): void {
    const hs = this.hs;
    this.cancelCountdown();
    hs.phase = 'idle';
    hs.bets = emptyBets();
    hs.order = [];
    hs.offers.clear();
    void this.emit({ k: 'phase', p: 'idle' });
  }

  override onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost) {
      const b = this.hs.bets[seat];
      if (b && this.hs.phase === 'buy') {                                   // leaving before the draw: refund
        this.paySeat(seat, b.staked, { bet: b.staked, silent: true }, pid);
        this.hs.bets[seat] = null;
        void this.emit({ k: 'drop', seat });
      } else if (b) {
        b.left = true;                                                      // mid-round: the stake is forfeit
      }
    }
    if (local) {
      this.cardCount = Math.min(this.cardCount, this.cap());
      this.offerLocal = null;
      this.hud(null);
      this.seatHud?.hide();
    }
    this.paintLamps();
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'phase': this.onPhase(ev.p, pc); return;
      case 'cards': this.putCards(ev.seat, ev.stake, ev.cards); return;
      case 'drop': this.st.seats = this.st.seats.filter((s) => s.seat !== ev.seat); this.paintAll(); return;
      case 'draw': await this.onDraw(ev.n, ev.stepMs, ev.daubs, pc); return;
      case 'ball': await this.onBall(ev, pc); return;
      case 'offer': this.onOffer(ev); return;
      case 'peek': this.toast(this.t('offerPeek', { n: ev.n }), 'sys'); return;
      case 'award': await this.onAward(ev, pc); return;
    }
  }

  private onPhase(p: Phase, pc: PresentCtx): void {
    this.st.phase = p;
    this.offerLocal = null;
    if (p === 'buy' || p === 'idle') { this.st.seats = []; this.st.called = []; }
    if (p === 'lock' && !pc.fast) void this.anim(LOCK_S, (k) => { this.parts.cage.rotation.z = k * Math.PI * 4; }, 'outQuad');
    if (p === 'lock') { this.sfx('chime', { vol: 0.5 }); void this.parts.crank.turn(4, LOCK_S); }
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
  }

  private putCards(seat: number, stake: number, cards: Array<{ id: number; grid: number[]; free: number[] }>): void {
    this.st.seats = this.st.seats.filter((s) => s.seat !== seat).concat([{
      seat, stake, cards: cards.map((c): CardPub => ({ id: c.id, grid: c.grid, free: c.free, daubs: [] })),
    }]);
    this.sfx('chip', { vol: 0.6 });
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Anticipation → action: the base 40 come out one by one, the lamp lights, the card daubs follow. */
  private async onDraw(n: number[], stepMs: number, daubs: number[], pc: PresentCtx): Promise<void> {
    this.st.phase = 'call';
    this.st.called = [...n];
    this.applyDaubs(daubs);
    this.paintBoard();
    this.paintSeats();
    this.parts.leds.balls.set(String(0).padStart(2, '0'));
    const step = pc.fast ? 0 : stepMs / 1000;
    for (let i = 0; i < n.length; i++) {
      const num = n[i];
      setLamp(this.parts.board, num, 'drawn');
      commitBoard(this.parts.board);
      this.showBall(num);
      this.parts.leds.balls.set(String(i + 1).padStart(2, '0'));
      this.sfx('tileClack', { vol: 0.8 });
      if (step) await this.wait(step);
    }
    if (this.isLocalOccupant) this.showHud();
  }

  /** The extra ball: pop from the chute, the lamp lights, the buyers' daubs thump in. */
  private async onBall(ev: Extract<Ev, { k: 'ball' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'extra';
    this.st.called.push(ev.n);
    this.offerLocal = null;
    this.applyDaubs(ev.hits);
    setLamp(this.parts.board, ev.n, 'drawn');
    commitBoard(this.parts.board);
    this.showBall(ev.n);
    this.parts.leds.balls.set(String(this.st.called.length).padStart(2, '0'));
    this.sfx('chime', { pitch: Math.min(12, 2 + ev.idx * 2), vol: 0.6 });
    this.ctx.fx.popText(this.parts.ballPop, `${letterOf(ev.n)}-${ev.n}`, GOLD, { dur: 0.9, rise: 0.25 });
    const mine = this.localSeat;
    let hitMine = false;
    for (let i = 0; i < ev.hits.length; i += 3) if (ev.hits[i] === mine) hitMine = true;
    if (hitMine) {
      this.sfx('thud', { vol: 0.8 });
      this.ctx.fx.shake(0.01, 0.12, { roll: 0.1 });
      this.ctx.fx.sparks(this.parts.desks[mine].dauber, 6, GOLD);
    }
    this.paintSeats();
    if (this.isLocalOccupant) this.showHud();
    if (!pc.fast) await this.wait(0.5);
  }

  private onOffer(ev: Extract<Ev, { k: 'offer' }>): void {
    this.offerLocal = { price: ev.price, n: ev.n, pattern: ev.pattern };
    this.sfx('bell', { vol: 0.7 });
    this.ctx.fx.glow(this.parts.light2, AMBER, 0.6, 0.5);
    this.showHud();
  }

  /** Follow-through: payouts, patterns, tier show for the local player, commiseration or "1 TO GO" for the rest. */
  private async onAward(ev: Extract<Ev, { k: 'award' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'award';
    this.offerLocal = null;
    const desk = this.parts.desks[ev.seat];
    const at = desk ? desk.cards[0] : this.parts.ballPop;
    const frame = ev.cards.some((c) => c.pattern === 'frame');
    const mine = ev.seat === this.localSeat;
    const tags = frame ? ['jackpot'] : [];
    for (const c of ev.cards) if (c.nearmiss && desk) void desk.oneToGo.blink(6, 1.0);
    if (mine) {
      const net = ev.total - ev.stake;
      this.seatHud?.result(ev.total === 0 ? 'lose' : frame ? 'win' : net === 0 ? 'even' : net > 0 ? 'win' : 'lose', net, 1.5);
    }
    if (ev.total > 0) {
      const tier = juiceTier(ev.total, ev.stake, tags);
      const shown = mine ? this.ctx.run.previewCredit(ev.total, this.src, { bet: ev.stake }) : ev.total;
      const text = frame ? this.t('jackpot', { n: fmtCoins(shown) }) : this.t('win', { n: fmtCoins(shown) });
      this.ctx.fx.popText(at, text, ev.total > ev.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
      if (frame) {
        this.ctx.fx.shake(0.04, 0.5, { roll: 0.6 });
        void this.parts.caller.pose('bow');
        void this.parts.caller.gesture('wave');
      }
      if (mine) {
        void this.celebrate(juiceTier(ev.total, ev.stake, [...new Set([...tags, ...tierTags(tier)])]), {
          amount: ev.total - ev.stake, at, lamps: desk ? [desk.rail] : [], fast: pc.fast,
          restore: () => this.paintAll(),
        });
      }
    } else if (mine) {
      if (ev.cards.some((c) => c.nearmiss)) void this.nearMiss({ at });
      else this.commiserate({ amount: ev.stake, at });
    }
    if (mine && ev.cards.length) {
      const top = ev.cards.reduce((a, b) => (b.gross > a.gross ? b : a));
      this.toast(this.t(PATTERN_KEY[top.pattern] ?? 'pNone'), top.gross > 0 ? 'sys' : 'warn');
    }
    if (!pc.fast) await this.wait(0.4);
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: public felt state only ─────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase,
      called: [...this.st.called],
      seats: this.st.seats.map((s) => ({
        seat: s.seat, stake: s.stake,
        cards: s.cards.map((c) => ({ id: c.id, grid: [...c.grid], free: [...c.free], daubs: [...c.daubs] })),
      })),
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase,
      called: [...sn.called],
      seats: sn.seats.map((s) => ({
        seat: s.seat, stake: s.stake,
        cards: s.cards.map((c) => ({ id: c.id, grid: [...c.grid], free: [...c.free], daubs: [...c.daubs] })),
      })),
    };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.hud(null);
      this.seatHud?.show();
      this.hudSig = '';
      this.showHud();
    }
  }

  override onLang(): void {
    this.paintAll();
    this.hudSig = '';
    if (this.isLocalOccupant) this.showHud();
  }

  /** The Caller's countdown runs on the balls LED while the buy window is open (visual only). */
  frame(_dt: number, _t: number): void {
    if (this.timerState && this.st.phase === 'buy') this.parts.leds.balls.set(String(Math.ceil(this.timerLeft)).padStart(2, '0'));
    if (this.isLocalOccupant) this.showHud();              // cheap: only redraws the HUD when its content changed
  }

  // ── state helpers (presentation) ──────────────────────────────────────────────────────────────
  private applyDaubs(triples: number[]): void {
    for (let i = 0; i + 2 < triples.length; i += 3) {
      const sp = this.st.seats.find((s) => s.seat === triples[i]);
      const c = sp?.cards.find((x) => x.id === triples[i + 1]);
      if (c && !c.daubs.includes(triples[i + 2])) c.daubs.push(triples[i + 2]);
    }
  }

  // ── painting ──────────────────────────────────────────────────────────────────────────────────
  private paintAll(): void {
    this.paintBoard();
    this.paintSeats();
    this.paintLamps();
  }

  private paintBoardScreen(): void {
    this.parts.boardScreen.draw((g, sc) => {
      g.fillStyle = '#0b0a08'; g.fillRect(0, 0, sc.w, sc.h);
      LETTERS.forEach((l, col) => sc.text(l, col * 32 + 16, 2, { font: 'px5', color: '#c9b98a', align: 'center' }));
    });
  }

  private paintBoard(): void {
    const on = new Set(this.st.called);
    for (let n = 1; n <= 75; n++) setLamp(this.parts.board, n, on.has(n) ? 'drawn' : 'off');
    commitBoard(this.parts.board);
  }

  private showBall(n: number): void {
    const label = `${letterOf(n)}-${n}`;
    this.parts.ballDisplay.draw((g, sc) => {
      g.fillStyle = '#0b0a08'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(label, sc.w / 2, 6, { font: 'px5', color: '#ffb347', align: 'center' });
    });
  }

  private paintSeats(): void {
    for (let s = 0; s < SEATS; s++) this.paintSeat(s);
  }

  private paintSeat(seat: number): void {
    const d = this.parts.desks[seat];
    if (!d) return;
    const sp = this.st.seats.find((x) => x.seat === seat);
    const pid = this.seats[seat];
    const color = pid !== null ? this.ctx.net.playerColor(pid) : 0xffffff;
    d.cards.forEach((mesh, k) => {
      const c = sp?.cards[k];
      mesh.visible = !!c;
      if (c) this.drawCard(d, k, c, color);
    });
    d.rail.setOn(!!sp);
  }

  /** 40 × 48 card canvas: B I N G O header, 5 × 5 numbers, daubs in the seat colour, FREE centre. */
  private drawCard(d: BingoDesk, k: number, c: CardPub, color: number): void {
    const cv = d.cardCanvas[k];
    const g = cv.getContext('2d');
    if (!g) return;
    const W = 40, H = 48, HEAD = 7;
    const S = cv.width / W;                       // canvas is 6 px per unit: draw the layout scaled so the text stays sharp
    g.setTransform(S, 0, 0, S, 0, 0);
    const cw = W / 5, ch = (H - HEAD) / 5;
    const marks = marksOf({ grid: c.grid, free: c.free }, baseSet(this.st.called), c.daubs);
    g.fillStyle = '#f2e7c9'; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 6px monospace';
    g.fillStyle = '#1a1206';
    LETTERS.forEach((l, col) => g.fillText(l, col * cw + cw / 2, HEAD / 2));
    for (let r = 0; r < 5; r++) for (let col = 0; col < 5; col++) {
      const i = r * 5 + col;
      const cx = col * cw + cw / 2, cy = HEAD + r * ch + ch / 2;
      if (marks[i]) {
        g.fillStyle = hexStr(color);
        g.beginPath(); g.arc(cx, cy, Math.min(cw, ch) / 2 - 0.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff';
      } else {
        g.fillStyle = '#1a1206';
      }
      g.fillText(c.grid[i] === 0 ? 'F' : String(c.grid[i]), cx, cy);
    }
    d.cardTex[k].needsUpdate = true;
  }

  private paintLamps(): void {
    for (let s = 0; s < SEATS; s++) {
      const sp = this.st.seats.find((x) => x.seat === s);
      this.parts.desks[s].rail.setOn(!!sp);
    }
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Banner, key numbers and valid controls for the local player. Redraws only when something changed. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const seat = this.localSeat, ph = this.st.phase, called = this.st.called;
    const mine = this.st.seats.find((x) => x.seat === seat);
    const offer = this.offerLocal;
    const left = this.timerState && (ph === 'buy' || (ph === 'extra' && offer)) ? Math.ceil(this.timerLeft) : 0;
    const wallet = this.ctx.run.wallet();
    const sig = [ph, seat, this.bet, this.cardCount, mine?.cards.length ?? 0, mine?.stake ?? 0, called.length,
      offer ? `${offer.n}:${offer.price}` : '', left, wallet].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    sh.goal({ k: 'm.bingo.goal' });

    // STATE: buy window, cage, calls, extra-ball offer, payout
    const secs: Txt | undefined = left > 0 ? { k: 'm.bingo.stSecs', v: { n: left } } : undefined;
    if (offer) {
      sh.state({ k: 'm.bingo.stOffer' }, 'warn', { k: 'm.bingo.stOfferSub', v: { ball: `${letterOf(offer.n)} ${offer.n}`, price: fmtCoins(offer.price), n: left } });
    } else if (ph === 'buy') {
      if (mine) sh.state({ k: 'm.bingo.stIn' }, 'good', secs);
      else sh.state({ k: 'm.bingo.stBuy' }, 'gold', secs);
    } else if (ph === 'lock') sh.state({ k: 'm.bingo.stLock' }, 'warn');
    else if (ph === 'call') sh.state({ k: 'm.bingo.stCall' }, 'neutral', { k: 'm.bingo.stCallSub', v: { n: called.length } });
    else if (ph === 'extra') sh.state({ k: 'm.bingo.stExtra' }, 'cyan');
    else if (ph === 'award') sh.state({ k: 'm.bingo.stAward' }, 'neutral');
    else sh.state({ k: 'm.bingo.stIdle' }, 'neutral');

    // KEY NUMBERS
    const nums: HudNumber[] = [];
    if (mine) {
      nums.push({ label: { k: 'm.bingo.nMyCards' }, value: String(mine.cards.length), tone: 'good' });
      nums.push({ label: { k: 'm.bingo.nStake' }, value: fmtCoins(mine.stake), tone: 'gold' });
    } else if (ph === 'buy') {
      nums.push({ label: { k: 'm.bingo.nCards' }, value: String(this.cardCount), tone: 'gold' });
      nums.push({ label: { k: 'm.bingo.nStake' }, value: fmtCoins(this.bet), tone: 'gold' });
      nums.push({ label: { k: 'm.bingo.nTotal' }, value: fmtCoins(this.cardCount * this.bet), tone: 'gold' });
    }
    if (called.length) {
      const last = called[called.length - 1];
      nums.push({ label: { k: 'm.bingo.nLast' }, value: `${letterOf(last)} ${last}`, tone: 'cyan' });
      nums.push({ label: { k: 'm.bingo.nCalled' }, value: `${called.length}/40`, tone: 'neutral' });
    }
    nums.push({ label: { k: 'm.bingo.nBalance' }, value: fmtCoins(wallet), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (ph === 'buy' && !mine) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.bingo.cBuy', v: { n: this.cardCount } }, action: 'confirm', primary: true });
      ctrl.push({ key: this.k('n6'), label: { k: 'm.bingo.cCards' }, action: 'n6' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.bingo.cBet' }, action: 'betUp' });
    }
    if (offer) {
      ctrl.push({ key: this.k('n5'), label: { k: 'm.bingo.cBall', v: { price: fmtCoins(offer.price) } }, action: 'n5', primary: true });
      ctrl.push({ key: this.k('clear'), label: { k: 'm.bingo.cNo' }, action: 'clear' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.bingo.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.bingo.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

// ── contract ──────────────────────────────────────────────────────────────────────────────────
export { playHeadless };

export const def: MachineDef = {
  id: 'bingo',
  category: 'lottery',
  slotSize: 'XL',
  zone: 'laundry',
  seats: SEATS,
  shared: true,
  tier: 3,
  minBet: MIN_STAKE, maxBet: MAX_STAKE, betSteps: [2, 5, 10, 20, 50],
  maxPayoutMult: 1000,
  rtp: 0.934,
  actionCost: 1,
  tags: ['table', 'draw', 'social', 'shared'],
  headless: playHeadless,
  modHooks: {
    'm.bingo.freeDaub': 'int charges per card: after ball 40, daub the best uncalled number',
    'm.bingo.extraBallDiscount': 'float 0..0.9: discount on the extra-ball price',
    'm.bingo.patternPayAdd.P': 'float add to the pay of pattern P (line, corners, double, triple, x, frame)',
    'm.bingo.cardSlotsAdd': 'int added to the card cap (4)',
    'm.bingo.secondFree': 'bool (>= 1): each card starts with a random second free cell',
    'm.bingo.ballCountAdd': 'int: the next N extra balls count as base balls for the owner (no offer)',
    'x.table.peekCharges': 'int: peek at the next extra ball before deciding',
    luck: 'solo only: reroll a losing 40-ball draw once with p = luck/100',
  },
  strings: STRINGS,
};
