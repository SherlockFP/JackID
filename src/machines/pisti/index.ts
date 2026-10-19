/**
 * Pişti — party card table (`pisti`), 2–4 players on a 4-seat felt (TableBase, host-authoritative).
 *
 * Shape of the code (the TableBase pattern of blackjack / demoTable):
 *  - HOST ONLY (`hs`): the deck, every hand, the pot and all timers. Clients send `act()` (stake + ready, or play a
 *    card by its hand index). The host validates with the pure rules (`rules.ts`), charges and pays through the seat
 *    helpers, and publishes PUBLIC events (table, counts, captured counts, scores). Each player's own hand goes only
 *    in a PRIVATE `hand` event (`emitPrivate`), and late joiners get a per-recipient snapshot with only their hand.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) and the pools change. Events are queued, so
 *    the host's presentation runs in the same order as everyone else's.
 *  - Round: bet (ready with a stake, 20 s) → start (deal 4 each, 4 face up) → turns (20 s per human, bots 0.9–1.6 s)
 *    → when hands run out the next 4 are dealt → last card → final count → pot paid to the top score (ties split)
 *    → 6 s pause → next bet. Stake is one amount for the whole table, so a pot never exceeds four times a stake.
 *  - Bots: a single human gets one mannequin opponent (difficulty 1–3 picked by the host's seeded stream); with two
 *    or more humans the table plays with humans only (2–4 players). Bots never hold a wallet.
 *  - Leaving: before the round the stake is refunded; during a round the seat is played by the auto-player (level 1)
 *    and its stake stays in the pot as TableBase requires.
 *
 * Controls: Space / Enter ready · ← → stake (before ready) · 1–4 play the card in that slot · click a card to play ·
 * H rules (bilingual sheet). Juice: deal whoosh, card slaps, capture sweep, pişti flash and shake, jack pişti in cyan,
 * tiered celebration for the pot, lamp on the turn seat.
 *
 * Not in v1: spectator side bets, house-rule toggles (the PartyDef carries them for later), headless staff play.
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { fmtCoins } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { KitX } from '@/kit/index';
import { STRINGS } from './pisti.strings';
import { buildModel, handSlot, pilePos, tableSpot, HAND_MAX, SEATS, type PistiParts } from './model';
import * as R from './rules';

const BET_S = 20, TURN_S = 20, END_S = 6;
const BOT_MIN = 0.9, BOT_STEP = 0.1, BOT_SPAN = 8;
const GOLD = 0xffd040, CYAN = 0x39e6ff;
const STAKES: number[] = [0, 5, 10, 25, 50, 100, 250, 500];
const KEY_PLAY: Partial<Record<string, number>> = { n1: 0, n2: 1, n3: 2, n4: 3 };
const RULE_KEYS = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7', 'rule8'] as const;

type Phase = 'bet' | 'play' | 'end';

// ── public events, actions, snapshot ───────────────────────────────────────────────────────────
type Row = { seat: number; pts: number; cards: number; pistis: number; pay: number; win: boolean };
type Ev =
  | { k: 'bet'; seat: number; stake: number; ready: boolean }
  /** `seats` = playing seats in turn order; `counts` = cards in each hand; `table` = the 4 face-up cards. */
  | { k: 'start'; seats: number[]; stake: number; pot: number; deck: number; table: string[]; counts: number[] }
  /** Private to one player: their own hand, in index order (the play action uses the index). */
  | { k: 'hand'; cards: string[] }
  | { k: 'deal'; counts: number[]; deck: number }
  | { k: 'turn'; seat: number }
  /** A card left seat `seat`'s hand slot `idx`. `took` = cards swept into the seat's pile; `pisti` = points made. */
  | { k: 'play'; seat: number; idx: number; card: string; took: number; pisti: number; jack: boolean; table: string[]; counts: number[]; caps: number[]; pts: number[]; deck: number }
  | { k: 'end'; rows: Row[]; pot: number }
  | { k: 'away'; seat: number }
  | { k: 'clear' };
type Act = { k: 'bet'; stake: number; ready: boolean } | { k: 'play'; i: number };

type PubSeat = { ready: boolean; stake: number; hand: number; caps: number; pts: number };
type Pub = { phase: Phase; seats: PubSeat[]; order: number[]; table: string[]; deck: number; pot: number; stake: number; turn: number; end: Row[] | null };
type Secret = {
  order: number[]; turnSeat: number; turnLeft: number; botAt: number; endLeft: number; away: boolean[];
  game: { n: number; hands: string[][]; piles: string[][]; pistis: number[]; pistiPts: number[]; table: string[]; deck: string[]; turn: number; lastCap: number };
};
type Snap = { st: Pub; hand: string[]; secret: Secret | null };

// ── host-only authority state ──────────────────────────────────────────────────────────────────
type HSeat = { ready: boolean; stake: number };
type Host = {
  phase: Phase; seats: HSeat[]; stake: number; pot: number; order: number[]; game: R.Game | null; away: boolean[];
  timer: number; turnSeat: number; turnLeft: number; botAt: number; endLeft: number;
};
const freshSeats = (): HSeat[] => [0, 1, 2, 3].map(() => ({ ready: false, stake: 0 }));
const freshHost = (): Host => ({
  phase: 'bet', seats: freshSeats(), stake: 0, pot: 0, order: [], game: null, away: [false, false, false, false],
  timer: 0, turnSeat: -1, turnLeft: 0, botAt: 0, endLeft: 0,
});
const pubSeat = (): PubSeat => ({ ready: false, stake: 0, hand: 0, caps: 0, pts: 0 });
const freshPub = (): Pub => ({
  phase: 'bet', seats: [0, 1, 2, 3].map(pubSeat), order: [], table: [], deck: 52, pot: 0, stake: 0, turn: -1, end: null,
});

export const def: MachineDef = {
  id: 'pisti',
  category: 'party',
  slotSize: 'L',
  zone: 'parlour',
  seats: SEATS,
  shared: true,
  minBet: 0, maxBet: 500, betSteps: STAKES,
  // the table stake is shared by everyone, so the pot is at most 4 × stake (winner takes all)
  maxPayoutMult: 4,
  rtp: 0.97,
  tier: 1,
  actionCost: 1,
  tags: ['cards', 'table', 'party', 'skill'],
  modHooks: {},
  party: {
    minPlayers: 2, maxPlayers: 4, bots: true, botLevels: 3,
    buyIn: { min: 0, max: 500 },
    spectatorBets: false,
    houseRules: {},
    hidden: true,
    turnTimerS: TURN_S,
  },
  strings: STRINGS,
};

export default class Pisti extends TableBase<PistiParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Pub = freshPub();
  /** This peer's own hand (private events). */
  private myHand: string[] = [];
  /** HOST ONLY authority state. */
  private hs: Host = freshHost();
  /** Pool ids of the cards on the table, for the capture sweep (valid until the next repaint). */
  private tableIds: number[] = [];

  protected createModel(kit: KitX): MachineModel<PistiParts> {
    return buildModel(kit, this.modelOpts);
  }

  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
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
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const a = e.action as MachineAction;
    const seat = this.localSeat;
    const mine = seat >= 0 ? this.st.seats[seat] : undefined;
    switch (a) {
      case 'primary': case 'confirm':
        if (e.repeat) break;
        if (this.st.phase === 'bet' && mine && !mine.ready) {
          // once someone is ready the table stake is fixed: join at that amount
          const others = this.st.seats.some((x, i) => i !== seat && x.ready);
          this.act({ k: 'bet', stake: others ? this.st.stake : this.bet, ready: true });
        }
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (e.repeat || this.st.phase !== 'bet' || (mine && mine.ready)) break;
        this.stakeStep(a === 'betUp' ? 1 : a === 'betDown' ? -1 : 2);
        this.sfx('click'); this.showHud();
        break;
      case 'n1': case 'n2': case 'n3': case 'n4': {
        const i = KEY_PLAY[a];
        if (i !== undefined && this.st.phase === 'play') this.playLocal(i);
        break;
      }
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type === 'down' && e.button === 0 && this.st.phase === 'play') {
      const hit = this.pick(this.parts.picks);
      if (!hit) return;
      const k = this.parts.picks.indexOf(hit.object as THREE.Mesh);
      if (k >= 0) this.playLocal(k);
    }
  }

  /** Local: play hand card `i` (checked here for feedback; the host checks again). */
  private playLocal(i: number): void {
    const seat = this.localSeat;
    if (seat < 0) return;
    if (this.st.turn !== seat) { this.toast(this.t('notYourTurn'), 'warn'); this.sfx('error'); return; }
    if (i < 0 || i >= this.myHand.length) { this.sfx('error'); return; }
    this.sfx('card');
    this.act({ k: 'play', i });
  }

  /** Stake ladder: step over the table's stake list (0 = free table). dir 1 / −1 one step, 2 = the largest stake the wallet covers. */
  private stakeStep(dir: number): void {
    const ladder = this.def.betSteps ?? STAKES;
    const wallet = this.ctx.run.wallet();
    if (dir === 2) {
      const best = [...ladder].reverse().find((v) => v <= wallet || v === 0);
      if (best !== undefined) this.bet = best;
      return;
    }
    const cur = Math.max(0, ladder.indexOf(this.bet));
    const v = ladder[Math.min(ladder.length - 1, Math.max(0, cur + dir))];
    if (v !== undefined && (v <= wallet || v === 0 || dir < 0)) this.bet = v;
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    if (a.k === 'bet') return this.onBet(pid, seat, a, rid);
    return this.onPlay(pid, seat, a.i, rid);
  }

  private onBet(pid: PlayerId, seat: number, a: Extract<Act, { k: 'bet' }>, rid: number): void {
    const hs = this.hs, s = hs.seats[seat];
    if (hs.phase !== 'bet' || s.ready) { this.nak(pid, rid, 'm.pisti.busy'); return; }
    if (!a.ready) return;                                   // previews stay local
    if (!STAKES.includes(a.stake)) { this.nak(pid, rid, 'm.pisti.badBet'); return; }
    const others = hs.seats.some((x, i) => i !== seat && x.ready);
    if (others && a.stake !== hs.stake) { this.nak(pid, rid, 'm.pisti.badBet'); return; }
    if (a.stake > 0 && !this.chargeSeat(seat, a.stake, pid)) { this.nak(pid, rid, 'common.noFunds'); return; }
    s.ready = true; s.stake = a.stake;
    if (!others) hs.stake = a.stake;
    void this.emit({ k: 'bet', seat, stake: a.stake, ready: true });
    this.afterBet();
  }

  private onPlay(pid: PlayerId, seat: number, i: number, rid: number): void {
    const hs = this.hs, g = hs.game;
    if (hs.phase !== 'play' || !g) { this.nak(pid, rid, 'm.pisti.busy'); return; }
    if (hs.turnSeat !== seat) { this.nak(pid, rid, 'm.pisti.notYourTurn'); return; }
    const p = hs.order.indexOf(seat);
    if (p < 0 || !Number.isInteger(i) || i < 0 || i >= g.hands[p].length) { this.nak(pid, rid, 'm.pisti.badCard'); return; }
    this.playFor(seat, i);
  }

  // ── HOST: bets and seats ─────────────────────────────────────────────────────────────────────
  private afterBet(): void {
    const hs = this.hs;
    this.tidyBots();
    const humans = this.humans();
    const ready = humans.filter((h) => hs.seats[h.seat].ready);
    if (ready.length > 0 && ready.length === humans.length) { this.startRound(); return; }
    if (ready.length > 0 && hs.timer <= 0) { hs.timer = BET_S; void this.countdown(BET_S, 'bet'); }
  }

  /** Solo human ⇒ one mannequin opponent (level from the host stream). Otherwise humans only. Host, bet phase. */
  private tidyBots(): void {
    if (!this.isHost || this.hs.phase !== 'bet') return;
    const hs = this.hs;
    const seated = this.humans().length;
    const readyH = this.humans().filter((h) => hs.seats[h.seat].ready).length;
    const want = seated === 1 || readyH === 1 ? 1 : 0;
    if (want === 0) {
      for (const b of [...this.bots]) this.removeBot(b.seat);
      return;
    }
    if (this.bots.length > 0) return;
    const free = this.seats.findIndex((p) => p === null);
    if (free < 0) return;
    const level = (1 + this.hostRng.int(0, 2)) as 1 | 2 | 3;
    this.addBot(free, this.t(`bot${level}`), level);
  }

  private startRound(): void {
    const hs = this.hs;
    if (hs.phase !== 'bet') return;
    this.tidyBots();
    for (const b of this.bots) {
      if (this.seats[b.seat] === null) continue;
      hs.seats[b.seat] = { ready: true, stake: hs.stake };
    }
    const order = hs.seats.map((s, i) => (s.ready ? i : -1)).filter((i) => i >= 0);
    if (order.length < 2) { this.abortRound(); return; }
    const pot = order.reduce((sum, s) => sum + hs.seats[s].stake, 0);
    const g = R.newGame(order.length, this.hostRng);
    g.turn = this.hostRng.int(0, order.length - 1);
    hs.game = g; hs.order = order; hs.pot = pot; hs.phase = 'play'; hs.away = [false, false, false, false];
    hs.timer = 0;
    void this.emit({
      k: 'start', seats: order, stake: hs.stake, pot, deck: g.deck.length, table: [...g.table],
      counts: g.hands.map((h) => h.length),
    });
    this.sendHands();
    this.turnTo(g.turn);
  }

  /** Not enough players after all (cannot happen with the bot rule, kept for safety): refund and reset. */
  private abortRound(): void {
    const hs = this.hs;
    hs.seats.forEach((s, seat) => {
      if (s.ready && s.stake > 0) this.paySeat(seat, s.stake, { bet: s.stake, tier: 'push', tags: ['refund'] });
    });
    this.resetRound();
  }

  private resetRound(): void {
    this.hs = freshHost();
    this.cancelCountdown();
    void this.emit({ k: 'clear' });
    this.tidyBots();
  }

  /** Private hand to every human at the table (host: the bots and sitters get nothing). */
  private sendHands(): void {
    const g = this.hs.game;
    if (!g) return;
    this.hs.order.forEach((seat, p) => {
      const pid = this.seats[seat];
      if (pid !== null && !isBot(pid)) void this.emitPrivate(pid, { k: 'hand', cards: g.hands[p] as string[] });
    });
  }

  // ── HOST: turns and plays ────────────────────────────────────────────────────────────────────
  private turnTo(p: number): void {
    const hs = this.hs, g = hs.game;
    if (!g) return;
    g.turn = p;
    const seat = hs.order[p];
    hs.turnSeat = seat;
    hs.turnLeft = TURN_S;
    hs.botAt = BOT_MIN + BOT_STEP * this.hostRng.int(0, BOT_SPAN);
    const pid = this.seats[seat];
    if (pid !== null && !isBot(pid) && !hs.away[seat]) void this.countdown(TURN_S, 'turn');
    else this.cancelCountdown();
    void this.emit({ k: 'turn', seat });
  }

  /** Auto-move for a bot, a seat with nobody in it, a leaver or a human whose clock ran out. */
  private autoPlay(seat: number, level: R.BotLevel): void {
    const g = this.hs.game;
    const p = this.hs.order.indexOf(seat);
    if (!g || p < 0) return;
    const bot = this.bots.find((b) => b.seat === seat);
    const rng = bot ? bot.rng : this.hostRng;
    this.playFor(seat, R.botChoose(g, p, level, rng));
  }

  private playFor(seat: number, idx: number): void {
    const hs = this.hs, g = hs.game;
    if (!g) return;
    const p = hs.order.indexOf(seat);
    const res = R.play(g, p, idx);
    this.cancelCountdown();
    void this.emit({
      k: 'play', seat, idx, card: res.card, took: res.took, pisti: res.pisti, jack: res.jack,
      table: [...g.table] as string[], counts: g.hands.map((h) => h.length), caps: g.piles.map((c) => c.length),
      pts: [...g.pistiPts], deck: g.deck.length,
    });
    const pid = this.seats[seat];
    if (pid !== null && !isBot(pid)) void this.emitPrivate(pid, { k: 'hand', cards: g.hands[p] as string[] });
    if (res.ended) { this.endGame(); return; }
    if (R.handsEmpty(g)) {
      R.dealRound(g);
      void this.emit({ k: 'deal', counts: g.hands.map((h) => h.length), deck: g.deck.length });
      this.sendHands();
    }
    this.turnTo(g.turn);
  }

  /** Final count, pot to the top score (ties split; the odd coin goes to the first winner). */
  private endGame(): void {
    const hs = this.hs, g = hs.game;
    if (!g) return;
    const sc = R.score(g);
    const best = R.winners(sc.points);
    const share = Math.floor(hs.pot / best.length);
    const rest = hs.pot - share * best.length;
    const rows: Row[] = hs.order.map((seat, p) => {
      const win = best.includes(p);
      const pay = win ? share + (p === best[0] ? rest : 0) : 0;
      if (pay > 0) this.paySeat(seat, pay, { bet: hs.seats[seat].stake });
      else this.forfeit(seat);
      return { seat, pts: sc.points[p], cards: sc.cards[p], pistis: g.pistis[p], pay, win };
    });
    hs.phase = 'end'; hs.endLeft = END_S; hs.turnSeat = -1;
    this.cancelCountdown();
    void this.emit({ k: 'end', rows, pot: hs.pot });
  }

  /** Leaving: before the round the stake is refunded; during a round the seat is auto-played. */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) this.parts.bots[seat]?.setVisible(false);
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs, s = hs.seats[seat];
      if (hs.phase === 'bet' && s.ready) {
        if (s.stake > 0) this.paySeat(seat, s.stake, { bet: s.stake, tier: 'push', tags: ['refund'] }, pid);
        hs.seats[seat] = { ready: false, stake: 0 };
        void this.emit({ k: 'bet', seat, stake: 0, ready: false });
        this.tidyBots();
      } else if (hs.phase === 'play' && hs.order.includes(seat)) {
        hs.away[seat] = true;
        void this.emit({ k: 'away', seat });
        if (hs.turnSeat === seat) hs.botAt = Math.min(hs.botAt, BOT_MIN);
      }
    }
    if (local) { this.seatHud?.hide(); this.repaintAll(); }
    this.refresh();
  }

  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) this.parts.bots[seat]?.setVisible(true);
    if (this.isHost && !isBot(pid)) this.tidyBots();
    this.refresh();
    if (local) {
      this.sfx('chime');
      this.seatHud?.show(); this.repaintAll(); this.showHud();
    }
  }

  // ── host clock ───────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.phase) {
      case 'bet':
        if (hs.timer > 0 && (hs.timer -= dt) <= 0) {
          hs.timer = 0;
          if (hs.seats.some((s) => s.ready)) this.startRound();
        }
        break;
      case 'play': {
        const seat = hs.turnSeat;
        if (seat < 0) break;
        const pid = this.seats[seat];
        if (pid === null || isBot(pid) || hs.away[seat]) {
          if ((hs.botAt -= dt) <= 0) this.autoPlay(seat, pid !== null && isBot(pid) ? this.levelOf(seat) : 1);
        } else if ((hs.turnLeft -= dt) <= 0) {
          this.autoPlay(seat, 1);
        }
        break;
      }
      case 'end':
        if ((hs.endLeft -= dt) <= 0) this.resetRound();
        break;
    }
  }

  private levelOf(seat: number): R.BotLevel {
    return (this.bots.find((b) => b.seat === seat)?.level ?? 2) as R.BotLevel;
  }

  // ── presentation (every peer) ────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const st = this.st, p = this.parts, fast = pc.fast;
    switch (ev.k) {
      case 'bet': {
        const s = st.seats[ev.seat];
        s.ready = ev.ready; s.stake = ev.stake;
        if (ev.ready && st.seats.filter((x) => x.ready).length === 1) st.stake = ev.stake;
        if (!ev.ready && !st.seats.some((x) => x.ready)) st.stake = 0;
        st.pot = st.seats.reduce((sum, x) => sum + (x.ready ? x.stake : 0), 0);
        this.sfx('chip');
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'start': {
        st.phase = 'play'; st.order = ev.seats; st.stake = ev.stake; st.pot = ev.pot; st.deck = ev.deck;
        st.table = ev.table; st.end = null; st.turn = -1;
        st.seats.forEach((x, i) => { x.hand = 0; x.caps = 0; x.pts = 0; if (!ev.seats.includes(i)) { x.ready = false; x.stake = 0; } });
        ev.seats.forEach((seat, k) => { st.seats[seat].hand = ev.counts[k]; st.seats[seat].ready = true; });
        this.sfx('shuffle');
        if (!fast) await this.dealIn();
        this.repaintAll();
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'hand': {
        this.myHand = [...ev.cards];
        const ls = this.localSeat;
        if (ls >= 0) st.seats[ls].hand = this.myHand.length;
        this.repaintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'deal': {
        st.order.forEach((seat, k) => { st.seats[seat].hand = ev.counts[k]; });
        st.deck = ev.deck;
        this.sfx('shuffle');
        if (!fast) await this.dealIn();
        this.repaintAll();
        return;
      }
      case 'turn': {
        st.turn = ev.seat;
        this.lampsFor();
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'play':
        return this.presentPlay(ev, fast);
      case 'end': {
        st.phase = 'end'; st.end = ev.rows; st.turn = -1; st.pot = ev.pot;
        ev.rows.forEach((r) => { st.seats[r.seat].pts = r.pts; });
        this.lampsFor();
        this.refresh();
        const me = this.localSeat;
        if (me >= 0 && st.seats[me]?.ready) {
          const mineRow = ev.rows.find((r) => r.seat === me);
          if (mineRow && mineRow.pay > 0) this.seatHud?.result('win', Math.max(0, mineRow.pay - st.stake));
          else this.seatHud?.result('lose', -st.stake);
        }
        for (const r of ev.rows) {
          if (r.pay <= 0) continue;
          const tier = juiceTier(r.pay, st.stake || 1);
          this.ctx.fx.popText(p.cards.root, `+${fmtCoins(r.pay)}`, GOLD, { dur: 1.2, rise: 0.3, scale: 1.1 });
          if (r.seat === me) void this.celebrate(tier);
        }
        if (me >= 0 && !ev.rows.some((r) => r.seat === me && r.pay > 0)) this.commiserate();
        this.repaintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'away':
        this.refresh();
        return;
      case 'clear':
        this.st = freshPub();
        this.myHand = [];
        this.tableIds = [];
        this.repaintAll();
        this.refresh();
        if (this.isLocalOccupant) this.showHud();
        return;
    }
  }

  /** One play: the card flies from its hand slot to the table; a capture sweeps the table to the pile. */
  private async presentPlay(ev: Extract<Ev, { k: 'play' }>, fast: boolean): Promise<void> {
    const st = this.st, p = this.parts;
    const seat = ev.seat;
    const k = st.order.indexOf(seat);
    const pileBefore = st.seats[seat].caps;
    // 1. the hand without the played card, the table as it was (repaint keeps the table ids for the sweep)
    if (seat === this.localSeat && ev.idx < this.myHand.length) this.myHand.splice(ev.idx, 1);
    st.order.forEach((sseat, j) => { st.seats[sseat].hand = ev.counts[j]; });
    st.turn = -1;
    this.repaintAll();
    // 2. the card flies to the table
    const from = handSlot(p, seat, ev.idx);
    const to = tableSpot(p, st.table.length);
    const mover = p.cards.add(ev.card as CardId, from, 0);
    this.sfx(ev.took > 0 ? 'cardSlap' : 'card');
    const fly = p.cards.move(mover, to, fast ? 0.05 : 0.32, { arc: 0.12 });
    if (fast) void fly; else await fly;
    // 3. a capture sweeps the table (and the taker's card) onto the pile
    if (ev.took > 0) {
      const sweep = [...this.tableIds, mover];
      const dest = pilePos(p, seat, pileBefore);
      this.sfx(ev.jack ? 'whoosh' : 'sparkle');
      if (!fast) await Promise.all(sweep.map((id) => p.cards.move(id, dest, 0.36, { arc: 0.05 })));
    }
    // 4. the public state after the play
    st.table = ev.table;
    st.deck = ev.deck;
    st.order.forEach((sseat, j) => {
      st.seats[sseat].caps = ev.caps[j];
      st.seats[sseat].pts = ev.pts[j];
    });
    if (k < 0) return;
    if (ev.pisti > 0) this.pistiFx(ev.pisti, seat, ev.jack);
    else if (ev.took > 0 && ev.jack) this.ctx.fx.shake(0.006, 0.18);
    if (ev.took > 0) this.ctx.fx.sparks(p.cards.root, ev.took > 4 ? 10 : 4, GOLD);
    this.repaintAll();
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Pişti feedback: a colour flash over the table, screen shake, pop text and a celebration for the taker. */
  private pistiFx(points: number, seat: number, jack: boolean): void {
    const p = this.parts;
    const colour = jack ? CYAN : GOLD;
    this.sfx(jack ? 'jackpot' : 'win2');
    this.ctx.fx.shake(jack ? 0.02 : 0.012, 0.4);
    this.ctx.fx.popText(p.cards.root, this.t(jack ? 'jackPisti' : 'pisti'), colour, { dur: 1.1, rise: 0.3, scale: 1.2 });
    this.ctx.fx.sparks(p.cards.root, 24, colour);
    p.flash.visible = true;
    p.flash.material.color = new THREE.Color(colour);
    p.flash.material.opacity = 0.9;
    const t0 = performance.now();
    const tick = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 700);
      p.flash.material.opacity = 0.9 * (1 - k);
      if (k < 1 && !this.disposed) requestAnimationFrame(tick);
      else p.flash.visible = false;
    };
    requestAnimationFrame(tick);
    if (seat === this.localSeat) void this.celebrate(points >= 20 ? 'big' : 'medium');
  }

  /** Lit lamp on the turn seat. */
  private lampsFor(): void {
    const p = this.parts;
    p.lamps.forEach((l, i) => l.setOn(this.st.turn === i));
  }

  // ── pool layout (rebuilt from `st` + `myHand`; cards are cosmetic, so a rebuild is always safe) ─
  /** Clear the pool and lay every card back out from the public state and this peer's own hand. */
  private repaintAll(): void {
    const st = this.st, p = this.parts, c = p.cards;
    c.clear();
    this.tableIds = [];
    const me = this.localSeat;
    if (st.deck > 0) c.add(null, p.deckPos, 0);
    st.table.forEach((card, k) => { this.tableIds.push(c.add(card as CardId, tableSpot(p, k), 0)); });
    for (let seat = 0; seat < SEATS; seat++) {
      const x = st.seats[seat];
      for (let k = 0; k < x.hand; k++) {
        const face = seat === me && this.myHand[k] !== undefined ? (this.myHand[k] as CardId) : null;
        c.add(face, handSlot(p, seat, k), 0);
      }
      for (let k = 0; k < x.caps; k++) c.add(null, pilePos(p, seat, k), 0);
    }
    this.placeLocalPicks();
    this.lampsFor();
    this.drawBoard();
  }

  /** Brief deal: backs fly from the deck to their slots. Resolves when they land (the caller repaints). */
  private dealIn(): Promise<void> {
    const st = this.st, p = this.parts;
    const flights: Promise<void>[] = [];
    st.order.forEach((seat) => {
      for (let k = 0; k < st.seats[seat].hand; k++) {
        const id = p.cards.add(null, p.deckPos, 0);
        flights.push(p.cards.move(id, handSlot(p, seat, k), 0.28, { arc: 0.1 }));
      }
    });
    return Promise.all(flights).then((): void => undefined);
  }

  /** Invisible pick boxes sit on the local hand slots. */
  private placeLocalPicks(): void {
    const p = this.parts, ls = this.localSeat;
    for (let k = 0; k < HAND_MAX; k++) {
      const m = p.picks[k];
      if (ls < 0 || k >= this.myHand.length) { m.visible = false; continue; }
      m.visible = true;
      m.position.copy(handSlot(p, ls, k)).add(new THREE.Vector3(0, 0.01, 0));
    }
  }

  // ── snapshots: public state for everyone, the own hand for its owner, secrets only for a host save ──
  getSnapshot(forPid?: PlayerId): Snap {
    const st = JSON.parse(JSON.stringify(this.st)) as Pub;
    const seat = forPid === undefined ? -1 : this.seats.indexOf(forPid);
    const k = seat >= 0 ? this.hs.order.indexOf(seat) : -1;
    const hand = this.hs.game && k >= 0 ? (this.hs.game.hands[k] as string[]).slice() : [];
    let secret: Secret | null = null;
    if (forPid === undefined && this.hs.game) {
      const g = this.hs.game;
      secret = {
        order: [...this.hs.order], turnSeat: this.hs.turnSeat, turnLeft: this.hs.turnLeft, botAt: this.hs.botAt,
        endLeft: this.hs.endLeft, away: [...this.hs.away],
        game: {
          n: g.n, hands: g.hands.map((h) => h as string[]), piles: g.piles.map((h) => h as string[]),
          pistis: [...g.pistis], pistiPts: [...g.pistiPts], table: g.table as string[], deck: g.deck as string[],
          turn: g.turn, lastCap: g.lastCap,
        },
      };
    }
    return { st, hand, secret };
  }

  applySnapshot(sn: Snap): void {
    this.st = JSON.parse(JSON.stringify(sn.st)) as Pub;
    this.myHand = [...sn.hand];
    if (sn.secret && this.isHost) {
      const s = sn.secret, g = s.game;
      this.hs = { ...freshHost(), phase: this.st.phase, order: s.order, turnSeat: s.turnSeat, turnLeft: s.turnLeft, botAt: s.botAt, endLeft: s.endLeft, away: s.away, pot: this.st.pot, stake: this.st.stake };
      this.hs.game = {
        n: g.n, hands: g.hands.map((h) => h as CardId[]), piles: g.piles.map((h) => h as CardId[]),
        pistis: g.pistis, pistiPts: g.pistiPts, table: g.table as CardId[], deck: g.deck as CardId[], turn: g.turn, lastCap: g.lastCap,
      };
      this.st.seats.forEach((x, i) => { this.hs.seats[i] = { ready: x.ready, stake: x.stake }; });
    }
    this.repaintAll();
  }

  // ── visuals: board screen, HUD ───────────────────────────────────────────────────────────────
  private shownSecond = -1;
  frame(): void {
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.drawBoard(); }
  }

  onLang(): void { this.drawBoard(); if (this.isLocalOccupant) this.showHud(); }

  private refresh(): void { this.drawBoard(); this.lampsFor(); }

  private statusText(): string {
    const st = this.st, seat = this.localSeat;
    switch (st.phase) {
      case 'bet': return seat >= 0 && st.seats[seat].ready ? this.t('sWait') : this.t('sBet');
      case 'play':
        if (st.turn === seat && seat >= 0) return this.t('sTurn');
        return st.turn >= 0 ? this.t('sWatch', { n: st.turn + 1 }) : this.t('sDeal');
      case 'end': return this.t('sEnd');
      default: return this.t('sShuffle');
    }
  }

  private drawBoard(): void {
    const st = this.st, p = this.parts;
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    p.screen.draw((g, w) => {
      g.fillStyle = '#080b08'; g.fillRect(0, 0, w.w, w.h);
      w.text(this.statusText(), 128, 2, { font: 'px5', color: '#7dff7a', align: 'center' });
      w.text(`${this.t('deckLeft', { n: st.deck })}`, 4, 22, { font: 'px5', color: '#e0c060' });
      if (st.pot > 0) w.text(this.t('pot', { pot: fmtCoins(st.pot) }), 252, 22, { font: 'px5', color: '#e0c060', align: 'right' });
      if (left > 0) w.text(String(left), 252, 2, { font: 'px5', color: '#ffffff', align: 'right' });
      for (let s = 0; s < SEATS; s++) {
        const row = st.seats[s];
        const occ = this.seats[s] !== null;
        const txt = st.phase === 'end' ? String(row.pts) : row.ready ? `${row.hand}/${row.caps}` : occ ? '·' : '';
        const col = st.turn === s ? '#ffd040' : '#c8ffc8';
        w.text(`P${s + 1} ${txt}`, 32 + s * 56, 48, { font: 'px5', color: col, align: 'center' });
      }
    });
    this.lampsFor();
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private rulesLines(): Txt[] {
    return RULE_KEYS.map((key) => ({ k: `m.pisti.${key}` }));
  }

  /** Banner, key numbers and the valid controls only. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const st = this.st, seat = this.localSeat;
    const mine = seat >= 0 ? st.seats[seat] : undefined;
    const others = st.seats.some((x, i) => i !== seat && x.ready);
    const myTurn = st.phase === 'play' && seat >= 0 && st.turn === seat;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.pisti.goal' });

    // STATE: phase and whose turn
    if (st.phase === 'bet') {
      if (mine && mine.ready) sh.state({ k: 'm.pisti.stWait' }, 'cyan', { k: 'm.pisti.stWaitSub' });
      else if (mine) sh.state({ k: 'm.pisti.stBet' }, 'gold', { k: 'm.pisti.stBetSub', v: { n: fmtCoins(others ? st.stake : this.bet) } });
      else sh.state({ k: 'm.pisti.stSit' }, 'neutral');
    } else if (st.phase === 'play') {
      if (myTurn) sh.state({ k: 'm.pisti.stTurn' }, 'good', { k: 'm.pisti.stTurnSub' });
      else if (st.turn >= 0) sh.state({ k: 'm.pisti.stOther' }, 'cyan', { k: 'm.pisti.stOtherOf', v: { n: st.turn + 1 } });
      else sh.state({ k: 'm.pisti.stDeal' }, 'neutral');
    } else if (st.phase === 'end') {
      sh.state({ k: 'm.pisti.stEnd' }, 'neutral');
    } else {
      sh.state({ k: 'm.pisti.stDeal' }, 'neutral');
    }

    // KEY NUMBERS
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.pisti.nStake' }, value: fmtCoins(others ? st.stake : this.bet), tone: 'gold' });
    nums.push({ label: { k: 'm.pisti.nPot' }, value: fmtCoins(st.pot), tone: 'gold' });
    if (mine && st.phase !== 'bet') nums.push({ label: { k: 'm.pisti.nCaps' }, value: String(mine.caps), tone: 'cyan' });
    if (seat >= 0 && this.myHand.length > 0) nums.push({ label: { k: 'm.pisti.nCards' }, value: String(this.myHand.length), tone: 'neutral' });
    nums.push({ label: { k: 'm.pisti.nDeck' }, value: String(st.deck), tone: 'neutral' });
    nums.push({ label: { k: 'm.pisti.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only the actions valid right now
    if (st.phase === 'bet' && mine && !mine.ready) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.pisti.cReady' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.pisti.cStake' }, action: 'betUp' });
    }
    if (myTurn) {
      this.myHand.forEach((_c, i) => {
        if (i < HAND_MAX) ctrl.push({ key: this.k(`n${i + 1}` as MachineAction), label: { k: 'm.pisti.cCard', v: { n: i + 1 } }, action: `n${i + 1}`, primary: i === 0 });
      });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.pisti.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.pisti.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

