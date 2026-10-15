/**
 * Blackjack "Twenty-One" (`blackjack`) — shared half-moon table, five spots, host-resolved (TECH §3.4, MACHINES_tables §3).
 *
 * Shape of the code (the TableBase pattern of demoTable.ts / coinflip):
 *  - HOST ONLY (`hs`): the shoe, the dealer's hole card, every decision timer and the payouts. Clients send `act()`
 *    (bet / insurance / play); the host validates with the pure rules (`rules.ts`), charges and pays through the seat
 *    helpers, and publishes every card and result as a PUBLIC event. The hole card is published as `card: ''` until
 *    the reveal, so no secret ever leaves the host.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) changes. Events are queued, so the host's own
 *    presentation runs in order with everyone else's.
 *  - Seat i is spot i (one box per seated player). Round: bet (ready) → deal → insurance / even money (8 s) → peek
 *    (Ace or ten up) → turns (15 s per decision, default stand) → dealer (reveal, draws to 17) → settle → clear (3.5 s).
 *  - Bots (`addBot`) bet the lowest steps and play basic strategy on the host, one decision every ~1.1 s.
 *  - Leaving: before the deal the bet is refunded; during a round the box is forfeited (its hands stop, its stake is
 *    written off) as TableBase requires.
 *
 * Controls: Space / Enter ready · ← → bet step (before ready) · N8 side bet (Twin Souls, cycles 0 → 1 → 5 → 10 → 25 → 50) ·
 * 1 Hit · 2 Stand · 3 Double · 4 Split · 5 Surrender · 6 Insurance (or Even money on a natural) · 7 decline.
 * Juice: deal whoosh and card slaps, hands lift before the peek, insurance lamp, win tiers (pop text, sparks, celebrate),
 * blackjack sting, push and loss feedback, the scoreboard counts the totals.
 *
 * Not in v1 (documented, not silently dropped): the 2–3 box "seats" track, the shoe gauge and rail meters, the
 * Five-Card Charlie and bust-shield hooks; `m.blackjack.bjPayAdd` and `m.blackjack.doubleAny` are wired.
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { ChipValue } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type HudResultKind, type Txt } from '@/machines/_base/seatHud';
import { bjTotal, rankOf } from '@/machines/_base/cards';
import { juiceTier, tierAtLeast } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { STRINGS } from './blackjack.strings';
import {
  buildModel, arcAt, dealerSlot, shoeMouth, slotPos, spotPhi, type BlackjackParts, SPOTS, SPOT_R, TOP, CARD_SLOT_R,
} from './model';
import * as R from './rules';

const BET_S = 15, INS_S = 8, TURN_S = 15, END_S = 3.5, BOT_MIN = 0.8, BOT_MAX = 1.6;
const GOLD = 0xffd040, CYAN = 0x39e6ff, GREEN = 0x7dff7a, RED = 0xff5a4a;
type Phase = 'bet' | 'deal' | 'ins' | 'turn' | 'dealer' | 'settle' | 'end';
const CHIP_VALUES: ChipValue[] = [500, 100, 25, 10, 5, 1];
const SIDE_STEPS: number[] = [0, ...R.SIDE_LADDER];
const KEY_ACTION: Partial<Record<string, R.Action>> = { n1: 'hit', n2: 'stand', n3: 'double', n4: 'split', n5: 'surrender' };
const ACTION_KEY: Record<string, MachineAction> = { hit: 'n1', stand: 'n2', double: 'n3', split: 'n4', surrender: 'n5' };

// ── events (public), actions, snapshot ───────────────────────────────────────────────────────────
type Ev =
  | { k: 'bet'; box: number; main: number; side: number; ready: boolean }
  | { k: 'shuffle' }
  | { k: 'phase'; p: Phase }
  /** box −1 = dealer. `card` is '' while the dealer's hole card is face down. */
  | { k: 'deal'; box: number; hand: number; card: string; hole: boolean }
  | { k: 'ins'; box: number; open: boolean; offer: number; amount: number }
  | { k: 'insure'; box: number; take: boolean; even: boolean; amount: number }
  | { k: 'peek'; dealerBJ: boolean }
  | { k: 'turn'; box: number; hand: number; legal: string[] }
  | { k: 'act'; box: number; hand: number; a: string; extra: number }
  | { k: 'split'; box: number; from: number; newHand: number; extra: number }
  | { k: 'reveal'; card: string }
  | { k: 'settle'; box: number; ret: number; stake: number; results: string[]; twin: string }
  | { k: 'clear' };
type Act = { k: 'bet'; main: number; side: number; ready: boolean } | { k: 'ins'; take: boolean } | { k: 'play'; a: string };

type PubHand = { cards: string[]; bet: number };
type PubBox = {
  main: number; side: number; extra: number; ready: boolean;
  offer: number;          // 0 none · 1 insurance · 2 even money (open offer)
  ins: number; even: boolean;
  hands: PubHand[]; results: string[]; twin: string;
};
type PubTurn = { box: number; hand: number; legal: string[] };
type Snap = { phase: Phase; boxes: PubBox[]; dealer: string[]; turn: PubTurn | null };

// ── host-only authority state ────────────────────────────────────────────────────────────────────
type HBox = {
  owner: PlayerId | null; ready: boolean; main: number; side: number; extra: number;
  ins: number; even: boolean; offer: number; insOpen: boolean;
  hands: R.PHand[]; first2: CardId[]; forfeit: boolean;
};
type HostState = {
  phase: Phase; boxes: HBox[]; dealer: CardId[]; shoe: R.BjShoe; turn: { box: number; hand: number } | null;
  timer: number; botAt: number; active: number[]; dealerBJ: boolean;
};

const freshBox = (): HBox => ({
  owner: null, ready: false, main: 0, side: 0, extra: 0, ins: 0, even: false, offer: 0, insOpen: false,
  hands: [], first2: [], forfeit: false,
});
const pubBox = (): PubBox => ({ main: 0, side: 0, extra: 0, ready: false, offer: 0, ins: 0, even: false, hands: [], results: [], twin: 'none' });
const freshHost = (shoe: R.BjShoe): HostState => ({
  phase: 'bet', boxes: [0, 1, 2, 3, 4].map(freshBox), dealer: [], shoe, turn: null, timer: 0, botAt: 0, active: [], dealerBJ: false,
});
const freshPub = (): Snap => ({ phase: 'bet', boxes: [0, 1, 2, 3, 4].map(pubBox), dealer: [], turn: null });

/** Greedy chip stack for an amount (at most 12 chips). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) while (rest >= v && out.length < 12) { out.push(v); rest -= v; }
  return out;
}
const spotPoint = (box: number, r: number): THREE.Vector3 => {
  const c = arcAt(r, spotPhi(box));
  return new THREE.Vector3(c.x, TOP + 0.005, c.z);
};
const nextSide = (s: number): number => SIDE_STEPS[(SIDE_STEPS.indexOf(s) + 1) % SIDE_STEPS.length];
const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.blackjack.' + k }));
const LABEL_W = 128, LABEL_H = 64;
type LabelSprite = { sp: THREE.Sprite; cv: HTMLCanvasElement; cx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string };
/** Callout kind for the local box's settlement (net = coins back minus stake). */
function resultKind(results: string[], net: number): HudResultKind {
  if (results.includes('even')) return 'even';
  if (results.includes('bj') && net > 0) return 'blackjack';
  if (results.includes('surr')) return 'surrender';
  if (results.length > 0 && results.every((r) => r === 'bust')) return 'bust';
  if (net > 0) return 'win';
  return net === 0 ? 'push' : 'lose';
}

export const def: MachineDef = {
  id: 'blackjack',
  category: 'card',
  slotSize: 'L',
  zone: 'well',
  seats: SPOTS,
  shared: true,
  minBet: 5, maxBet: 500, betSteps: [5, 10, 25, 50, 100, 250, 500],
  // host sanity cap: four doubled hands on the main bet plus a Twin Souls perfect pair (31×), per unit of stake
  maxPayoutMult: 32,
  rtp: 0.997,
  tier: 1,
  actionCost: 1,
  tags: ['cards', 'table', 'grinder', 'skill'],
  headless: R.playHeadless,
  modHooks: {
    'm.blackjack.bjPayAdd': 'Blackjack payout 1.5 → 1.5 + x (0.5 = 2:1). Dealer\'s Button charm.',
    'm.blackjack.doubleAny': 'Double on three or more cards too (non-zero enables).',
  },
  strings: STRINGS,
};

export { playHeadless } from './rules';

export default class Blackjack extends TableBase<BlackjackParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Snap = freshPub();
  /** HOST ONLY authority state. */
  private hs: HostState = freshHost(new R.BjShoe(this.hostRng));
  private sideBet = 0;
  private cardRefs = new Map<string, number>();
  private chipRefs = new Map<number, number[]>();
  private shownSecond = -1;
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** Floating totals: one per spot, then the dealer (index SPOTS). */
  private labels: LabelSprite[] = [];

  protected createModel(kit: KitX): MachineModel<BlackjackParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.buildLabels();
    this.repaintAll();
    void document.fonts?.ready.then(() => this.refreshLabels(true));
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    const st = this.st, seat = this.localSeat;
    const b = seat >= 0 ? st.boxes[seat] : undefined;
    switch (a) {
      case 'primary': case 'confirm':
        // the stake outruns the pocket: fitBet() steps it down (toasted); no affordable stake, no ready
        if (st.phase === 'bet' && b && !b.ready && this.fitBet()) this.act({ k: 'bet', main: this.bet, side: this.sideBet, ready: true });
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (st.phase !== 'bet' || (b && b.ready)) break;
        if (a === 'betUp') this.stepBet(1); else if (a === 'betDown') this.stepBet(-1); else this.maxBet();
        this.sfx('click'); this.refreshHud();
        break;
      case 'n8':
        if (st.phase !== 'bet' || (b && b.ready)) break;
        this.sideBet = nextSide(this.sideBet); this.sfx('click'); this.refreshHud();
        break;
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5': {
        const act = KEY_ACTION[a];
        if (act && st.phase === 'turn' && st.turn && st.turn.box === seat && st.turn.legal.includes(act)) this.act({ k: 'play', a: act });
        break;
      }
      case 'n6':
        if (st.phase === 'ins' && b && b.offer > 0) this.act({ k: 'ins', take: true });
        break;
      case 'n7':
        if (st.phase === 'ins' && b && b.offer > 0) this.act({ k: 'ins', take: false });
        break;
    }
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    switch (a.k) {
      case 'bet': return this.onBet(pid, seat, a, rid);
      case 'ins': return this.onInsurance(pid, seat, a.take, rid);
      case 'play': return this.onPlay(pid, seat, a.a, rid);
    }
  }

  private onBet(pid: PlayerId, seat: number, a: Extract<Act, { k: 'bet' }>, rid: number): void {
    const hs = this.hs, b = hs.boxes[seat];
    if (hs.phase !== 'bet' || b.ready) { this.nak(pid, rid, 'm.blackjack.busy'); return; }
    const ladder = this.betLadder();
    if (!ladder.includes(a.main) || !(a.side === 0 || (R.SIDE_LADDER as readonly number[]).includes(a.side))) {
      this.nak(pid, rid, 'm.blackjack.badBet'); return;
    }
    if (!a.ready) {                                           // stake not yet committed: show it, charge nothing
      b.main = a.main; b.side = a.side;
      void this.emit({ k: 'bet', box: seat, main: a.main, side: a.side, ready: false });
      return;
    }
    if (!this.chargeSeat(seat, a.main + a.side, pid)) { this.nak(pid, rid, 'common.noFunds'); return; }
    b.owner = pid; b.ready = true; b.main = a.main; b.side = a.side; b.extra = 0;
    void this.emit({ k: 'bet', box: seat, main: a.main, side: a.side, ready: true });
    this.afterBet();
  }

  private afterBet(): void {
    const hs = this.hs;
    this.botsBet();
    const humans = this.humans();
    if (humans.length > 0 && humans.every((h) => hs.boxes[h.seat].ready)) { this.startRound(); return; }
    if (hs.timer <= 0 && humans.length > 1) { hs.timer = BET_S; void this.countdown(BET_S, 'bet'); }
  }

  /** Bots bet the lowest or second step and are ready for the round. */
  private botsBet(): void {
    const hs = this.hs;
    for (const bot of this.bots) {
      const b = hs.boxes[bot.seat];
      const pid = this.seats[bot.seat];
      if (b.ready || pid === null || !isBot(pid)) continue;
      const ladder = this.betLadder();
      const main = ladder[Math.min(bot.rng.int(0, 1), ladder.length - 1)];
      this.chargeSeat(bot.seat, main, pid);
      b.owner = pid; b.ready = true; b.main = main; b.side = 0; b.extra = 0;
      void this.emit({ k: 'bet', box: bot.seat, main, side: 0, ready: true });
    }
  }

  private onInsurance(pid: PlayerId, seat: number, take: boolean, rid: number): void {
    const hs = this.hs, b = hs.boxes[seat];
    if (hs.phase !== 'ins' || !b.insOpen || b.owner !== pid) { this.nak(pid, rid, 'm.blackjack.busy'); return; }
    if (take && b.offer === 2) {                              // even money: 1:1 on the natural, settled at once
      b.even = true;
      void this.emit({ k: 'insure', box: seat, take: true, even: true, amount: b.main });
    } else if (take) {
      const amount = R.insuranceMax(b.main);
      if (amount > 0 && !this.chargeSeat(seat, amount, pid)) { this.nak(pid, rid, 'common.noFunds'); return; }
      b.ins = amount;
      void this.emit({ k: 'insure', box: seat, take: true, even: false, amount });
    } else {
      void this.emit({ k: 'insure', box: seat, take: false, even: false, amount: 0 });
    }
    b.insOpen = false;
    if (!hs.boxes.some((x) => x.insOpen)) this.afterInsurance();
  }

  private onPlay(pid: PlayerId, seat: number, a: string, rid: number): void {
    const hs = this.hs, tn = hs.turn;
    if (hs.phase !== 'turn' || !tn || tn.box !== seat || hs.boxes[seat].owner !== pid) { this.nak(pid, rid, 'm.blackjack.notYourTurn'); return; }
    const b = hs.boxes[seat], h = b.hands[tn.hand];
    const legal = R.legalActions(h, this.legalCtx(b));
    if (!legal.includes(a as R.Action)) { this.nak(pid, rid, 'm.blackjack.busy'); return; }
    if (!this.actOn(seat, tn.hand, a as R.Action)) this.nak(pid, rid, 'common.noFunds');
  }

  private legalCtx(b: HBox): R.LegalCtx {
    return {
      boxHands: b.hands.length,
      boxAceSplit: b.hands.some((x) => x.aceSplit),
      canAfford: true,
      singleHand: b.hands.length === 1,
      doubleAny: this.mod('m.blackjack.doubleAny', 0) > 0,
    };
  }

  /** Applies one decision of the box's hand. Returns false (nothing changed) when the stake cannot be charged. */
  private actOn(box: number, hand: number, a: R.Action): boolean {
    const hs = this.hs, b = hs.boxes[box], h = b.hands[hand];
    switch (a) {
      case 'hit': {
        const { card } = R.luckyDraw(hs.shoe, h.cards, this.luck(), this.hostRng);
        void this.emit({ k: 'act', box, hand, a, extra: b.extra });
        this.dealInto(box, hand, card);
        break;
      }
      case 'stand':
        h.stood = true;
        void this.emit({ k: 'act', box, hand, a, extra: b.extra });
        break;
      case 'double': {
        const add = h.bet;
        if (!b.owner || !this.chargeSeat(box, add, b.owner)) return false;
        h.bet += add; h.doubled = true; b.extra += add;
        void this.emit({ k: 'act', box, hand, a, extra: b.extra });
        const { card } = R.luckyDraw(hs.shoe, h.cards, this.luck(), this.hostRng);
        this.dealInto(box, hand, card);
        break;
      }
      case 'split': {
        const add = h.bet;
        if (!b.owner || !this.chargeSeat(box, add, b.owner)) return false;
        b.extra += add;
        const aces = R.isAce(h.cards[0]);
        const second = h.cards.pop() as CardId;
        h.split = true; h.aceSplit = aces;
        b.hands.push(R.newHand([second], add, true, aces));
        const newHand = b.hands.length - 1;
        void this.emit({ k: 'split', box, from: hand, newHand, extra: b.extra });
        this.dealInto(box, hand, hs.shoe.draw());
        this.dealInto(box, newHand, hs.shoe.draw());
        break;
      }
      case 'surrender':
        h.surrendered = true;
        void this.emit({ k: 'act', box, hand, a, extra: b.extra });
        break;
    }
    this.cancelCountdown();
    this.nextTurn();
    return true;
  }

  /** Puts a drawn card into a hand and publishes it. */
  private dealInto(box: number, hand: number, card: CardId): void {
    this.hs.boxes[box].hands[hand].cards.push(card);
    void this.emit({ k: 'deal', box, hand, card, hole: false });
  }
  private drawDealer(hole: boolean): CardId {
    const c = this.hs.shoe.draw();
    this.hs.dealer.push(c);
    void this.emit({ k: 'deal', box: -1, hand: 0, card: hole ? '' : c, hole });
    return c;
  }

  // ── HOST: round flow ─────────────────────────────────────────────────────────────────────────
  private startRound(): void {
    const hs = this.hs;
    this.cancelCountdown();
    hs.timer = 0;
    hs.active = [];
    hs.boxes.forEach((b, i) => { if (b.ready && b.owner !== null && b.main > 0) hs.active.push(i); });
    if (hs.active.length === 0) return;
    if (hs.shoe.needsShuffle) { hs.shoe.shuffle(); void this.emit({ k: 'shuffle' }); }
    hs.dealer = [];
    for (const i of hs.active) hs.boxes[i].hands = [R.newHand([], hs.boxes[i].main)];
    void this.emit({ k: 'phase', p: 'deal' });
    // box 1→5 face up, dealer up card, box 1→5 second card, dealer hole card
    for (const i of hs.active) this.dealCard(i);
    this.drawDealer(false);
    for (const i of hs.active) this.dealCard(i);
    for (const i of hs.active) hs.boxes[i].first2 = [...hs.boxes[i].hands[0].cards];
    this.drawDealer(true);
    const up = hs.dealer[0];
    if (R.isAce(up)) { this.openInsurance(); return; }
    this.peek();
  }
  private dealCard(box: number): void {
    const c = this.hs.shoe.draw();
    this.dealInto(box, 0, c);
  }

  private openInsurance(): void {
    const hs = this.hs;
    hs.phase = 'ins';
    hs.timer = INS_S;
    void this.emit({ k: 'phase', p: 'ins' });
    for (const i of hs.active) {
      const b = hs.boxes[i];
      if (b.owner === null || isBot(b.owner)) continue;       // bots decline
      const natural = R.isNatural(b.hands[0]);
      b.offer = natural ? 2 : b.main >= 2 ? 1 : 0;
      if (b.offer === 0) continue;
      b.insOpen = true;
      void this.emit({ k: 'ins', box: i, open: true, offer: b.offer, amount: natural ? b.main : R.insuranceMax(b.main) });
    }
    if (!hs.boxes.some((x) => x.insOpen)) this.afterInsurance();
  }

  private afterInsurance(): void {
    if (this.hs.phase !== 'ins') return;
    this.peek();
  }

  /** Dealer Ace or ten up: peek for a natural. Fate draw (b) may swap the hole card when the player is the only bettor. */
  private peek(): void {
    const hs = this.hs;
    const up = hs.dealer[0];
    if (!(R.isAce(up) || R.isTen(up))) { hs.dealerBJ = false; this.startTurns(); return; }
    let dealerBJ = R.total(hs.dealer) === 21 && hs.dealer.length === 2;
    const bettors = hs.active.filter((i) => { const b = hs.boxes[i]; return b.owner !== null && !isBot(b.owner); });
    const luck = this.luck();
    if (dealerBJ && luck > 0 && bettors.length === 1 && !R.isNatural(hs.boxes[bettors[0]].hands[0])
        && this.hostRng.next() < luck / 100) {
      const hole = hs.dealer[1];
      hs.shoe.returnRandom(hole, this.hostRng);
      hs.dealer[1] = hs.shoe.draw();
      dealerBJ = R.total(hs.dealer) === 21 && hs.dealer.length === 2;
    }
    hs.dealerBJ = dealerBJ;
    void this.emit({ k: 'peek', dealerBJ });
    if (dealerBJ) this.dealerPlay(); else this.startTurns();
  }

  private startTurns(): void {
    this.hs.phase = 'turn';
    void this.emit({ k: 'phase', p: 'turn' });
    this.nextTurn();
  }

  /** Next undone hand in box order, or the dealer's turn. */
  private nextTurn(): void {
    const hs = this.hs;
    hs.turn = null;
    for (const i of hs.active) {
      const b = hs.boxes[i];
      if (b.forfeit || b.even) continue;
      for (let j = 0; j < b.hands.length; j++) {
        if (R.handDone(b.hands[j])) continue;
        hs.turn = { box: i, hand: j };
        this.announceTurn();
        return;
      }
    }
    this.dealerPlay();
  }

  private announceTurn(): void {
    const hs = this.hs, tn = hs.turn;
    if (!tn) return;
    const b = hs.boxes[tn.box];
    const legal = R.legalActions(b.hands[tn.hand], this.legalCtx(b));
    const human = b.owner !== null && !isBot(b.owner);
    if (human) {
      hs.timer = TURN_S;
      void this.countdown(TURN_S, 'turn');
    } else {
      this.cancelCountdown();
      const bot = this.bots.find((x) => x.seat === tn.box);
      hs.botAt = bot ? bot.rng.float(BOT_MIN, BOT_MAX) : BOT_MIN;
    }
    void this.emit({ k: 'turn', box: tn.box, hand: tn.hand, legal });
  }

  /** Bots and timeouts: basic strategy, or stand when the clock ran out. */
  private autoPlay(forced: boolean): void {
    const hs = this.hs, tn = hs.turn;
    if (!tn) return;
    const b = hs.boxes[tn.box], h = b.hands[tn.hand];
    const ctx = this.legalCtx(b);
    const legal = R.legalActions(h, ctx);
    let a: R.Action = forced ? 'stand' : R.basicAction(h, hs.dealer[0], ctx);
    if (!legal.includes(a)) a = 'stand';
    if (!this.actOn(tn.box, tn.hand, a)) this.actOn(tn.box, tn.hand, 'stand');
  }

  private anyLive(): boolean {
    const hs = this.hs;
    return hs.active.some((i) => {
      const b = hs.boxes[i];
      return !b.forfeit && !b.even && b.hands.some((h) => !h.surrendered && !R.isBust(h));
    });
  }

  /** Reveal the hole card, draw to 17 when someone is still in, then settle. */
  private dealerPlay(): void {
    const hs = this.hs;
    hs.phase = 'dealer';
    hs.turn = null;
    this.cancelCountdown();
    void this.emit({ k: 'phase', p: 'dealer' });
    void this.emit({ k: 'reveal', card: hs.dealer[1] });
    if (!hs.dealerBJ && this.anyLive()) {
      for (const c of R.dealerDraws(hs.dealer, hs.shoe)) {
        hs.dealer.push(c);
        void this.emit({ k: 'deal', box: -1, hand: 0, card: c, hole: false });
      }
    }
    this.settleRound();
  }

  private settleRound(): void {
    const hs = this.hs;
    hs.phase = 'settle';
    void this.emit({ k: 'phase', p: 'settle' });
    for (const i of hs.active) this.settleBox(i);
    hs.phase = 'end';
    hs.timer = END_S;
    void this.emit({ k: 'phase', p: 'end' });
  }

  private settleBox(i: number): void {
    const hs = this.hs, b = hs.boxes[i];
    if (b.owner === null || b.forfeit) return;
    let ret = 0, stake = 0;
    const results: string[] = [];
    if (b.even) {
      ret += R.evenMoneyReturn(b.main); stake += b.main; results.push('even');
    } else {
      for (const h of b.hands) {
        const s = R.settleHand(h, hs.dealer, hs.dealerBJ, this.bjPay());
        ret += s.ret; stake += h.bet; results.push(s.result);
      }
    }
    ret += R.insuranceReturn(b.ins, hs.dealerBJ); stake += b.ins;
    const tw = R.twinReturn(b.side, b.first2[0], b.first2[1]);
    ret += tw.ret; stake += b.side;
    const tags = [
      ...(results.includes('bj') ? ['blackjack'] : []),
      ...(tw.kind !== 'none' ? ['twin'] : []),
    ];
    this.paySeat(i, ret, { bet: stake, tags }, b.owner);     // credit first, present after (DECISIONS G)
    void this.emit({ k: 'settle', box: i, ret, stake, results, twin: tw.kind });
  }

  private bjPay(): number {
    return this.mod('m.blackjack.bjPayAdd', R.BJ_PAY);
  }

  private finishRound(): void {
    this.hs = freshHost(this.hs.shoe);
    void this.emit({ k: 'clear' });
    void this.emit({ k: 'phase', p: 'bet' });
  }

  /** Leaving: before the deal the bet is refunded; during the round the box is forfeited (its hands stop). */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs, b = hs.boxes[seat];
      if (b.owner === pid) {
        if (hs.phase === 'bet') {
          if (b.ready) this.paySeat(seat, b.main + b.side, { bet: b.main + b.side, tier: 'push', tags: ['refund'] }, pid);
          hs.boxes[seat] = freshBox();
          void this.emit({ k: 'bet', box: seat, main: 0, side: 0, ready: false });
        } else if (hs.phase !== 'end' && hs.phase !== 'settle') {
          b.forfeit = true;
          b.insOpen = false;
          b.offer = 0;
          if (hs.turn?.box === seat) this.nextTurn();
          else if (hs.phase === 'ins' && !hs.boxes.some((x) => x.insOpen)) this.afterInsurance();
        }
      }
    }
    if (local) { this.hud(null); this.seatHud?.hide(); }
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.refreshLamps();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.refreshHud();
      this.seatHud?.firstTip('blackjack', this.tipLines());
    }
  }

  // ── host timers ──────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'bet':
        if (hs.timer > 0 && (hs.timer -= dt) <= 0) {
          hs.timer = 0;
          if (hs.boxes.some((b) => b.ready)) this.startRound();
        }
        break;
      case 'ins':
        if ((hs.timer -= dt) <= 0) {
          for (const i of hs.active) {
            const b = hs.boxes[i];
            if (!b.insOpen) continue;
            b.insOpen = false;
            void this.emit({ k: 'insure', box: i, take: false, even: false, amount: 0 });
          }
          this.afterInsurance();
        }
        break;
      case 'turn': {
        const tn = hs.turn;
        if (!tn) break;
        const owner = hs.boxes[tn.box].owner;
        if (owner !== null && isBot(owner)) {
          if ((hs.botAt -= dt) <= 0) this.autoPlay(false);
        } else if ((hs.timer -= dt) <= 0) {
          this.autoPlay(true);
        }
        break;
      }
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
        if (!fast) await this.anim(0.5, (k) => { p.shoe.rotation.z = Math.sin(k * Math.PI * 6) * 0.05 * (1 - k); });
        p.shoe.rotation.z = 0;
        return;
      case 'bet': {
        const b = st.boxes[ev.box];
        if (ev.ready && !b.ready) this.sfx('chip');
        b.main = ev.main; b.side = ev.side; b.ready = ev.ready;
        if (!ev.ready) b.extra = 0;
        this.repaintBets(ev.box);
        this.refreshLamps();
        this.drawTotals();
        if (this.isLocalOccupant) this.refreshHud();
        return;
      }
      case 'phase':
        st.phase = ev.p;
        if (ev.p === 'bet') st.turn = null;
        p.phaseLamp.setOn(ev.p !== 'bet');
        this.refreshLamps();
        this.drawTotals();
        if (this.isLocalOccupant) this.refreshHud();
        return;
      case 'deal':
        await this.presentDeal(ev, fast);
        this.drawTotals();
        return;
      case 'ins': {
        const b = st.boxes[ev.box];
        b.offer = ev.open ? ev.offer : 0;
        if (ev.open) { this.sfx('chime'); this.ctx.fx.glow(p.spots[ev.box], GOLD, 0.18, 0.4); }
        p.insuranceLine.setOn(st.boxes.some((x) => x.offer > 0));
        if (ev.open && this.localSeat === ev.box) this.refreshHud();
        this.drawTotals();
        return;
      }
      case 'insure': {
        const b = st.boxes[ev.box];
        b.offer = 0;
        if (ev.take) {
          b.ins = ev.even ? 0 : ev.amount;
          b.even = ev.even;
          this.sfx('chip');
          this.ctx.fx.popText(p.spots[ev.box], this.t(ev.even ? 'even' : 'insurance'), GOLD, { dur: 0.9, rise: 0.2 });
        }
        p.insuranceLine.setOn(st.boxes.some((x) => x.offer > 0));
        this.drawTotals();
        if (this.isLocalOccupant) this.refreshHud();
        return;
      }
      case 'peek':
        if (!fast) await this.tilt(0.4, 0.35);
        if (ev.dealerBJ) {
          this.sfx('bell');
          this.ctx.fx.popText(p.cards.root, this.t('sDealerBj'), GOLD, { dur: 1.1, rise: 0.25 });
          this.ctx.fx.shake(0.006, 0.2);
        }
        this.drawTotals();
        return;
      case 'turn':
        st.turn = { box: ev.box, hand: ev.hand, legal: ev.legal };
        this.paintButtons();
        this.refreshLamps();
        this.drawTotals();
        if (this.isLocalOccupant) this.refreshHud();
        return;
      case 'act': {
        const b = st.boxes[ev.box];
        b.extra = ev.extra;
        this.repaintBets(ev.box);
        const btn = p.boxButtons[ev.box].buttons[ev.a];
        if (btn) void btn.press(0.18);
        this.sfx(ev.a === 'stand' ? 'click' : 'button');
        this.ctx.fx.popText(p.spots[ev.box], this.t(ev.a), ev.a === 'surrender' ? RED : GOLD, { dur: 0.8, rise: 0.22 });
        return;
      }
      case 'split': {
        const b = st.boxes[ev.box];
        const from = b.hands[ev.from];
        const moved = from.cards.pop() as string;
        b.hands.push({ cards: [moved], bet: from.bet });
        b.extra = ev.extra;
        const oldKey = `${ev.box}.${ev.from}.1`, newKey = `${ev.box}.${ev.newHand}.0`;
        const id = this.cardRefs.get(oldKey);
        this.cardRefs.delete(oldKey);
        if (id !== undefined) {
          this.cardRefs.set(newKey, id);
          this.sfx('cardSlap', { vol: 0.7 });
          await p.cards.move(id, slotPos(ev.box, ev.newHand, 0), fast ? 0.01 : 0.35, { arc: 0.05 });
        }
        this.repaintBets(ev.box);
        this.ctx.fx.popText(p.spots[ev.box], this.t('split'), GOLD, { dur: 0.8, rise: 0.22 });
        this.drawTotals();
        return;
      }
      case 'reveal': {
        st.dealer[1] = ev.card;
        const id = this.cardRefs.get('d.1');
        if (id !== undefined) {
          p.cards.setCard(id, ev.card as CardId);
          this.sfx('cardFlip');
          await p.cards.flip(id, fast ? 0.01 : 0.36);
        }
        this.drawTotals();
        return;
      }
      case 'settle':
        await this.presentSettle(ev, fast);
        return;
      case 'clear':
        this.clearTable();
        return;
    }
  }

  private async presentDeal(ev: Extract<Ev, { k: 'deal' }>, fast: boolean): Promise<void> {
    const st = this.st, p = this.parts;
    const dealer = ev.box < 0;
    let key: string, to: THREE.Vector3, idx: number;
    if (dealer) {
      idx = st.dealer.length;
      st.dealer.push(ev.hole ? '' : ev.card);
      key = `d.${idx}`;
      to = dealerSlot(idx);
    } else {
      const b = st.boxes[ev.box];
      while (b.hands.length <= ev.hand) b.hands.push({ cards: [], bet: b.main });
      idx = b.hands[ev.hand].cards.length;
      b.hands[ev.hand].cards.push(ev.card);
      key = `${ev.box}.${ev.hand}.${idx}`;
      to = slotPos(ev.box, ev.hand, idx);
    }
    const id = p.cards.add(ev.hole ? null : (ev.card as CardId), shoeMouth(), 0);
    this.cardRefs.set(key, id);
    this.sfx('card', { vol: dealer ? 0.9 : 1 });
    if (dealer) this.gesture(p.handR, 0.45, fast); else this.gesture(p.handL, 0.3, fast);
    await p.cards.move(id, to, fast ? 0.01 : 0.32, { arc: 0.06 });
    if (!fast) this.sfx('cardSlap', { vol: 0.5 });
  }

  private async presentSettle(ev: Extract<Ev, { k: 'settle' }>, fast: boolean): Promise<void> {
    const st = this.st, p = this.parts;
    const b = st.boxes[ev.box];
    b.results = ev.results; b.twin = ev.twin; b.ready = false; b.offer = 0;
    const at = p.spots[ev.box];
    const bj = ev.results.includes('bj');
    const jt = juiceTier(ev.ret, ev.stake, bj ? ['blackjack'] : []);
    // a natural pays 3:2 (x2.5 gross), which the multiple alone reads as small: it is a set-piece, so it celebrates at medium
    const tier = bj && !tierAtLeast(jt, 'medium') ? 'medium' : jt;
    // callouts show the NET the run credits (previewCredit: House Favour, modifiers, limit) less the stake, never the gross
    const mine = this.isLocalOccupant && ev.box === this.localSeat && ev.stake > 0;
    const net = mine ? this.ctx.run.previewCredit(ev.ret, this.src, { bet: ev.stake }) - ev.stake : ev.ret - ev.stake;
    if (mine) this.seatHud?.result(resultKind(ev.results, net), net);
    this.drawTotals();
    if (net > 0 && ev.stake > 0) {
      const win = net;
      if (bj) { this.ctx.fx.sparks(at, 14, GOLD); this.sfx('win3'); }
      else this.sfx(tier === 'small' ? 'win1' : tier === 'medium' ? 'win2' : 'win3');
      this.ctx.fx.popText(at, `+${fmtCoins(win)}`, GOLD, { dur: 1.1, rise: 0.3, scale: 1.1 });
      if (bj) this.ctx.fx.popText(at, this.t('rBj'), GOLD, { dur: 1.1, rise: 0.4 });
      if (tier !== 'small') void this.celebrate(tier, { amount: win, bet: ev.stake, at, fast });
      void this.pourCoins(win, { bet: ev.stake, from: at, fast });
    } else if (net === 0 && ev.stake > 0) {
      this.sfx('coin', { vol: 0.6 });
      this.ctx.fx.popText(at, this.t('rPush'), 0xffffff, { dur: 0.9, rise: 0.2 });
    } else if (ev.stake > 0) {
      this.commiserate({ at, amount: ev.stake });
    }
    const ids = this.chipRefs.get(ev.box) ?? [];
    for (const id of ids) p.chips.remove(id);
    this.chipRefs.delete(ev.box);
    if (!fast) await this.wait(0.2);
  }

  /** Sets the local button panels to the legal actions of the active hand. */
  private paintButtons(): void {
    const st = this.st, p = this.parts;
    p.boxButtons.forEach((panel, i) => {
      const legal = st.turn && st.turn.box === i ? st.turn.legal : [];
      for (const btn of panel.list) {
        const on = legal.includes(btn.id);
        btn.setEnabled(on);
        btn.setLit(on);
      }
    });
  }

  private repaintBets(i: number): void {
    const p = this.parts, b = this.st.boxes[i];
    for (const id of this.chipRefs.get(i) ?? []) p.chips.remove(id);
    const ids: number[] = [];
    const main = b.main + b.extra;
    if (main > 0) ids.push(...p.chips.stack(chipsFor(main), spotPoint(i, SPOT_R)));
    if (b.side > 0) ids.push(...p.chips.stack(chipsFor(b.side), spotPoint(i, SPOT_R + 0.11)));
    this.chipRefs.set(i, ids);
  }

  private refreshLamps(): void {
    const st = this.st, p = this.parts;
    for (let i = 0; i < SPOTS; i++) {
      const b = st.boxes[i];
      const turn = st.turn !== null && st.turn.box === i;
      p.seatLamps.setBulb(i, turn ? CYAN : b.ready || this.seats[i] !== null ? GOLD : null);
    }
    p.fairLamp.setOn(true);
  }

  private clearTable(): void {
    const p = this.parts;
    p.cards.clear();
    p.chips.clear();
    this.cardRefs.clear();
    this.chipRefs.clear();
    this.st = freshPub();
    p.insuranceLine.setOn(false);
    this.paintButtons();
    this.refreshLamps();
    this.drawTotals();
    if (this.isLocalOccupant) this.refreshHud();
  }

  /** Dealer hands lift and tilt (peek): `angle` in radians, `dur` seconds. */
  private async tilt(dur: number, angle: number): Promise<void> {
    const { handL, handR } = this.parts;
    await this.anim(dur, (k) => {
      const a = Math.sin(k * Math.PI) * angle;
      handL.rotation.z = a; handR.rotation.z = -a;
    });
    handL.rotation.z = 0; handR.rotation.z = 0;
  }
  private gesture(hand: THREE.Object3D, amp: number, fast: boolean): void {
    if (fast) return;
    void this.anim(0.25, (k) => { hand.rotation.x = Math.sin(k * Math.PI) * amp; }).then(() => { hand.rotation.x = 0; });
  }

  // ── snapshots: everything in `st` is public, the hole card is '' until the reveal ────────────
  getSnapshot(_forPid?: PlayerId): Snap {
    return JSON.parse(JSON.stringify(this.st)) as Snap;
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
    st.boxes.forEach((b, i) => {
      b.hands.forEach((h, j) => h.cards.forEach((c, k) => {
        this.cardRefs.set(`${i}.${j}.${k}`, p.cards.add(c as CardId, slotPos(i, j, k), 0));
      }));
      this.repaintBets(i);
    });
    st.dealer.forEach((c, k) => {
      this.cardRefs.set(`d.${k}`, p.cards.add(c === '' ? null : (c as CardId), dealerSlot(k), 0));
    });
    p.insuranceLine.setOn(st.boxes.some((x) => x.offer > 0));
    p.phaseLamp.setOn(st.phase !== 'bet');
    this.paintButtons();
    this.refreshLamps();
    this.drawTotals();
    if (this.isLocalOccupant) this.refreshHud();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  frame(): void {
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.drawTotals(); this.refreshHud(); }
  }
  onLang(): void { this.drawTotals(); if (this.isLocalOccupant) this.refreshHud(); }

  private statusText(): string {
    const st = this.st, seat = this.localSeat, mine = seat >= 0 ? st.boxes[seat] : undefined;
    switch (st.phase) {
      case 'bet': return mine && mine.ready ? this.t('sWait') : this.t('sBet');
      case 'deal': return this.t('sDealer');
      case 'ins': return this.t('sIns');
      case 'turn': return st.turn && st.turn.box === seat ? this.t('sTurn') : this.t('sWait');
      case 'dealer': return this.t('sDealer');
      case 'settle': return this.t('sSettle');
      default: return this.t('sShuffle');
    }
  }
  private boxText(b: PubBox): { text: string; color: number } {
    if (b.results.length > 0) {
      const good = b.results.some((r) => r === 'win' || r === 'bj' || r === 'even');
      const bad = b.results.every((r) => r === 'loss' || r === 'bust');
      return { text: b.results.map((r) => this.t('r_' + r)).join(' '), color: good ? GREEN : bad ? RED : GOLD };
    }
    if (b.hands.length === 0) return { text: b.ready ? this.t('tagBet') : '', color: GOLD };
    const parts = b.hands.map((h) => {
      if (h.cards.length === 0) return '-';
      const cards = h.cards as CardId[];
      const tot = R.total(cards);
      if (tot > 21) return 'X';
      return cards.length === 2 && tot === 21 ? this.t('tagBj') : String(tot);
    });
    return { text: parts.join('/'), color: GOLD };
  }

  private drawTotals(): void {
    const st = this.st, p = this.parts;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const shownDealer = st.dealer.filter((c) => c !== '') as CardId[];
    const dealerText = shownDealer.length ? this.t('dealer', { n: R.total(shownDealer) }) : '';
    p.totals.draw((g, w) => {
      g.fillStyle = '#080b08'; g.fillRect(0, 0, w.w, w.h);
      w.text(this.statusText(), 128, 2, { font: 'px5', color: '#7dff7a', align: 'center' });
      w.text(dealerText, 4, 30, { font: 'px5', color: '#e0c060' });
      if (left > 0) w.text(String(left), 252, 2, { font: 'px5', color: '#ffffff', align: 'right' });
      for (let i = 0; i < SPOTS; i++) {
        const { text, color } = this.boxText(st.boxes[i]);
        const x = 70 + i * 40;
        w.text(text, x, 30, { font: 'px5', color: `#${color.toString(16).padStart(6, '0')}`, align: 'center' });
      }
    });
    this.refreshLabels();
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.blackjack.tip1' },
      { k: 'm.blackjack.tip2', v: { ready: this.k('primary'), bet: `${this.k('betDown')}/${this.k('betUp')}` } },
      { k: 'm.blackjack.tip3', v: { hit: this.k('n1'), stand: this.k('n2'), help: this.k('help') } },
    ];
  }

  /** One hand as the player reads it: total, soft total "7/17", BJ or BUST. */
  private handText(cards: readonly string[]): string {
    if (cards.length === 0) return '-';
    const tot = bjTotal(cards as CardId[]);
    if (tot.bust) return this.t('tagBust');
    if (tot.blackjack) return this.t('tagBj');
    return tot.soft ? `${tot.total - 10}/${tot.total}` : String(tot.total);
  }

  /** The dealer's up card as a label: A, K, Q, J or the pip value. */
  private upText(c: string): string {
    const r = rankOf(c as CardId);
    return r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);
  }

  /** Every card face up on the felt (all boxes' hands and the dealer's shown cards): the basis of the decision odds. */
  private seenCards(): CardId[] {
    const out: CardId[] = [];
    for (const bx of this.st.boxes) for (const h of bx.hands) for (const c of h.cards) if (c !== '') out.push(c as CardId);
    for (const c of this.st.dealer) if (c !== '') out.push(c as CardId);
    return out;
  }

  /** Banner, key numbers and valid controls. Only while the local player sits at a box. */
  private refreshHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const st = this.st, seat = this.localSeat, b = st.boxes[seat];
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const secs: Txt | undefined = left > 0 ? { k: 'm.blackjack.stSecs', v: { n: left } } : undefined;
    const myTurn = st.phase === 'turn' && st.turn !== null && st.turn.box === seat;
    const legal: string[] = myTurn && st.turn ? st.turn.legal : [];
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.blackjack.goal' });

    // STATE: whose turn, what phase
    switch (st.phase) {
      case 'bet':
        if (b.ready) sh.state({ k: 'm.blackjack.stReady' }, 'cyan');
        else sh.state({ k: 'm.blackjack.stBet' }, 'gold', secs);
        break;
      case 'deal': sh.state({ k: 'm.blackjack.stDeal' }, 'neutral'); break;
      case 'ins':
        if (b.offer === 2) sh.state({ k: 'm.blackjack.stInsEven' }, 'warn', secs);
        else if (b.offer === 1) {
          const pct = Math.round(100 * R.dealerBjChance(this.seenCards()));
          sh.state({ k: 'm.blackjack.stIns' }, 'warn', { k: 'm.blackjack.stInsOffer', v: { n: fmtCoins(R.insuranceMax(b.main)), pct } });
        } else sh.state({ k: 'm.blackjack.stIns' }, 'neutral');
        break;
      case 'turn':
        if (myTurn && st.turn) {
          // DECISION ODDS: the chance that a HIT on this hand busts (STAND keeps the total)
          const cards = (b.hands[st.turn.hand]?.cards ?? []).filter((c) => c !== '') as CardId[];
          const pct = Math.round(100 * R.bustChanceOnHit(cards, this.seenCards()));
          sh.state({ k: 'm.blackjack.stTurn' }, 'good', { k: 'm.blackjack.stTurnOdds', v: { pct, total: bjTotal(cards).total } });
        } else if (myTurn) sh.state({ k: 'm.blackjack.stTurn' }, 'good', secs);
        else sh.state({ k: 'm.blackjack.stOther' }, 'cyan');
        break;
      case 'dealer': sh.state({ k: 'm.blackjack.stDealerPlays' }, 'neutral'); break;
      case 'settle': sh.state({ k: 'm.blackjack.stPayout' }, 'neutral'); break;
      case 'end': sh.state({ k: 'm.blackjack.stEnd' }, 'neutral'); break;
      default: sh.state({ k: 'm.blackjack.stShuffle' }, 'neutral');
    }

    // KEY NUMBERS: bet, side stake, insurance, balance, your hand(s), dealer (hole card flagged)
    const nums: HudNumber[] = [];
    const stake = st.phase === 'bet' && !b.ready ? this.bet : b.main + b.extra;
    nums.push({ label: { k: 'm.blackjack.nBet' }, value: fmtCoins(stake), tone: 'gold' });
    const side = st.phase === 'bet' && !b.ready ? this.sideBet : b.side;
    if (side > 0) nums.push({ label: { k: 'm.blackjack.nSide' }, value: fmtCoins(side), tone: 'cyan' });
    if (b.ins > 0) nums.push({ label: { k: 'm.blackjack.nIns' }, value: fmtCoins(b.ins), tone: 'warn' });
    nums.push({ label: { k: 'm.blackjack.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    const dealt = b.hands.filter((h) => h.cards.length > 0);
    if (dealt.length > 0) {
      const first = bjTotal(dealt[0].cards as CardId[]);
      const tone = dealt.every((h) => bjTotal(h.cards as CardId[]).bust) ? 'bad' : first.total === 21 ? 'good' : 'neutral';
      nums.push({ label: { k: 'm.blackjack.nHand' }, value: dealt.map((h) => this.handText(h.cards)).join(' · '), tone });
    }
    const d = st.dealer;
    const hidden = d.length >= 2 && d[1] === '';
    const shown = d.filter((c) => c !== '');
    if (d.length > 0) {
      const dv: Txt = hidden ? { k: 'm.blackjack.nHidden', v: { n: this.upText(d[0]) } } : this.handText(shown);
      const dTone = !hidden && shown.length > 0 && bjTotal(shown as CardId[]).bust ? 'bad' : 'neutral';
      nums.push({ label: { k: hidden ? 'm.blackjack.nDealerHole' : 'm.blackjack.nDealer' }, value: dv, tone: dTone });
    }
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    if (st.phase === 'bet' && !b.ready) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.blackjack.cReady' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.blackjack.cBet' }, action: 'betUp' });
      ctrl.push({ key: this.k('n8'), label: { k: 'm.blackjack.cSide' }, action: 'n8' });
    }
    if (st.phase === 'ins' && b.offer > 0) {
      ctrl.push({ key: this.k('n6'), label: { k: b.offer === 2 ? 'm.blackjack.cEvenMoney' : 'm.blackjack.cInsure' }, action: 'n6', primary: true });
      ctrl.push({ key: this.k('n7'), label: { k: 'm.blackjack.cNoIns' }, action: 'n7' });
    }
    for (const a of legal) ctrl.push({ key: this.k(ACTION_KEY[a]), label: { k: `m.blackjack.${a}` }, action: a });
    ctrl.push({ key: this.k('help'), label: { k: 'm.blackjack.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.blackjack.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── floating 3D totals: one canvas sprite above each spot, one above the dealer ──────────────
  private buildLabels(): void {
    for (let i = 0; i <= SPOTS; i++) {
      const cv = document.createElement('canvas');
      cv.width = LABEL_W; cv.height = LABEL_H;
      const cx = cv.getContext('2d');
      if (!cx) continue;
      const tex = new THREE.CanvasTexture(cv);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      sp.renderOrder = 20;
      sp.scale.set(0.15, 0.075, 1);
      if (i < SPOTS) {
        const c = arcAt(CARD_SLOT_R, spotPhi(i));
        sp.position.set(c.x, TOP + 0.17, c.z);
      } else {
        const d = dealerSlot(0);
        sp.position.set(d.x + 0.05, TOP + 0.2, d.z);
      }
      this.root.add(sp);
      this.labels.push({ sp, cv, cx, tex, last: '\u0000' });
    }
  }

  private refreshLabels(force = false): void {
    for (let i = 0; i <= SPOTS; i++) {
      const L = this.labels[i];
      if (!L) continue;
      const { text, color } = i < SPOTS ? this.boxLabel(i) : this.dealerLabel();
      const key = `${text}|${color}`;
      if (!force && key === L.last) continue;
      L.last = key;
      this.paintLabel(L, text, color);
    }
  }

  private boxLabel(i: number): { text: string; color: string } {
    const b = this.st.boxes[i];
    if (b.results.length > 0) {
      const good = b.results.some((r) => r === 'win' || r === 'bj' || r === 'even');
      const bad = b.results.every((r) => r === 'loss' || r === 'bust' || r === 'surr');
      return { text: b.results.map((r) => this.t('r_' + r)).join(' '), color: good ? '#7dff7a' : bad ? '#ff5a4a' : '#ffd040' };
    }
    const dealt = b.hands.filter((h) => h.cards.length > 0);
    if (dealt.length === 0) return { text: '', color: '#ffd040' };
    const turn = this.st.turn !== null && this.st.turn.box === i;
    const bust = dealt.every((h) => bjTotal(h.cards as CardId[]).bust);
    return { text: dealt.map((h) => this.handText(h.cards)).join(' · '), color: turn ? '#39e6ff' : bust ? '#ff5a4a' : '#ffd040' };
  }

  private dealerLabel(): { text: string; color: string } {
    const d = this.st.dealer;
    if (d.length === 0) return { text: '', color: '#ffd040' };
    if (d.length >= 2 && d[1] === '') return { text: `${this.upText(d[0])}+?`, color: '#ffd040' };
    const cards = d.filter((c) => c !== '');
    return { text: this.handText(cards), color: bjTotal(cards as CardId[]).bust ? '#ff5a4a' : '#ffd040' };
  }

  private paintLabel(L: LabelSprite, text: string, color: string): void {
    const g = L.cx, w = LABEL_W, h = LABEL_H;
    g.clearRect(0, 0, w, h);
    L.sp.visible = text !== '';
    if (text) {
      g.fillStyle = 'rgba(6, 9, 6, 0.88)';
      g.fillRect(2, 8, w - 4, h - 16);
      g.strokeStyle = color; g.lineWidth = 4;
      g.strokeRect(2, 8, w - 4, h - 16);
      let size = 30;
      g.font = `${size}px "Press Start 2P", monospace`;
      while (size > 12 && g.measureText(text).width > w - 14) { size -= 2; g.font = `${size}px "Press Start 2P", monospace`; }
      g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 1);
    }
    L.tex.needsUpdate = true;
  }
}
