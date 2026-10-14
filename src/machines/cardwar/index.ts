/**
 * War Table (`cardwar`) — Casino War and Dragon-Tiger on one lacquer table (MACHINES_tables §10). Tier 2, shared.
 *
 * Shape of the code (the TableBase pattern of baccarat / blackjack):
 *  - HOST ONLY (`hs`): the shoe, every stake, the dealt cards, the tie decisions and the payouts. Clients send `act()`
 *    (lock bets, go to war / surrender, switch the variant). The host validates with the pure rules (`rules.ts`), charges
 *    and pays through the seat helpers, and publishes every card as a PUBLIC event when it is dealt face up (War) or
 *    turned over (Dragon-Tiger). The Dragon-Tiger draw never leaves the host before the reveal.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) changes. Events are queued, so the host's own
 *    presentation runs in the same order as everyone else's.
 *  - War round: OPEN (solo ∞ / shared 15 s) → LOCK 0.6 → DEAL 0.35 s per card (seats, then the dealer) → COMPARE 1.0 →
 *    TIE (only when a seat ties: solo ∞ / shared 10 s, undecided = surrender) → WAR 2.5 (burn 3, a card each) → SETTLE 2.0.
 *  - Dragon-Tiger round: OPEN (solo ∞ / shared 12 s) → LOCK 0.6 → DEAL 0.7 (both face down) → REVEAL Dragon 0.8, pause 0.5,
 *    Tiger 0.8 → SETTLE 2.0. The heads roar for the winner (eyes glow, jaw opens, the head lunges).
 *  - Variant plaque: the table switches rules only while no chips are down; the shoe is rebuilt for the new deck count.
 *  - Luck (solo only): a round that loses every backed main bet is reinserted and dealt again with p = luck / 100 before
 *    anything is shown. Shared tables never reroll.
 *  - Seats 7 and 8 are closed for War (the table is laid out for eight, War uses six).
 *
 * Not in v1 (recorded in the report, not silently dropped): the two-faced mask prop on "the Twin", the smoke particle
 * stream (the sprite is a static puff), the per-seat rail meter readings (cosmetic only), and autoplay (G).
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import { isBot, type PlayerId } from '@/core/types';
import type { ChipValue, LampPart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type HudResultKind, type Txt } from '@/machines/_base/seatHud';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier } from '@/machines/_base/tiers';
import { cardText, isRed } from '@/machines/_base/cards';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { STRINGS } from './cardwar.strings';
import {
  buildModel, dealerCardVec, dealerWarVec, dtCardVec, seatCardVec, shoeMouth, spotVec, warCardVec,
  DEALER_Z, FELT_D, FELT_W, SEATS, WAR_SEATS, type CardwarParts, type HeadParts,
} from './model';
import * as R from './rules';

// ── timings (seconds) ────────────────────────────────────────────────────────────────────────────
const OPEN_WAR_S = 15, OPEN_DT_S = 12, LOCK_S = 0.6, DEAL_CARD_S = 0.35, DT_FACE_S = 0.7;
const COMPARE_S = 1.0, TIE_S = 10, WAR_S = 2.5, REVEAL_S = 0.8, PAUSE_S = 0.5, SETTLE_S = 2.0, SHUFFLE_S = 5.0;
const EYES_GLOW_S = 1.5;
const CHIP_VALUES: ChipValue[] = [1000, 500, 100, 25, 10, 5, 1];
const SPOTS = 12;

type Phase = 'open' | 'lock' | 'deal' | 'compare' | 'tie' | 'war' | 'reveal' | 'settle' | 'shuffle';
type Variant = R.Variant;

// ── events (public unless noted), actions, snapshot ─────────────────────────────────────────────
type Ev =
  /** Stakes per seat × spot (public), and who has locked. Sent on every change and at each OPEN. */
  | { k: 'bets'; seats: number[][]; locked: boolean[] }
  /** The table switched rules (plaque). */
  | { k: 'variant'; v: Variant }
  | { k: 'phase'; p: Phase }
  | { k: 'shoe'; remaining: number; last: boolean }
  /** War: one card face up to a seat, or to the dealer (seat −1). */
  | { k: 'deal'; to: 'seat' | 'dealer'; seat: number; card: string }
  /** Dragon-Tiger: both cards are dealt face down. */
  | { k: 'dtDeal' }
  /** Ties awaiting a decision, and the decision time (ms). */
  | { k: 'tie'; seats: number[]; timeoutMs: number }
  | { k: 'choice'; seat: number; choice: string }
  /** The war draw: burn count, a player card and a dealer card per warring seat. */
  | { k: 'war'; burn: number; cards: Array<{ seat: number; card: string }>; dealer: Array<{ seat: number; card: string }> }
  | { k: 'reveal'; side: string; card: string }
  /** `winner`: DT 'D' | 'T' | 'TIE'; War 'W' (players took more seats) | 'H' (dealer) | 'TIE'. Rows: [seat, payout]. */ // i18n-ok: outcome code, never shown
  | { k: 'result'; winner: string; suited: boolean; seats: number[][] }
  /** PRIVATE: the next card on top of the shoe (War: the dealer's war card; Mirror charm). */
  | { k: 'peek'; card: string }
  /** PRIVATE: the Dragon card's colour during OPEN (Dragon-Tiger charm). */
  | { k: 'peekRed'; red: boolean };
type Act =
  | { k: 'lock'; bets: number[] }
  | { k: 'choice'; choice: 'war' | 'surrender' }
  | { k: 'variant' };
type ResultEv = Extract<Ev, { k: 'result' }>;

/** What every peer sees. Mutated only in `present`. Card values appear only after they are dealt face up / revealed. */
type Snap = {
  phase: Phase; variant: Variant; bets: number[][]; locked: boolean[]; seatCards: string[]; dealer: string;
  dt: string[]; tie: number[]; choices: string[]; road: number[]; shoeLeft: number; last: boolean; win: string;
};

// ── host-only authority state ───────────────────────────────────────────────────────────────────
type HostState = {
  phase: Phase; timer: number; stage: number; variant: Variant; shoe: R.CwShoe;
  bets: number[][]; locked: boolean[];
  deal: R.WarDeal | null; dt: R.DtOut | null;
  choices: Array<R.WarChoice | null>; tieSeats: number[];
  warRows: Array<{ seat: number; p: CardId; d: CardId; win: boolean }>;
};

const zeroBets = (): number[][] => Array.from({ length: SEATS }, () => new Array<number>(SPOTS).fill(0));
const falses = (): boolean[] => Array.from({ length: SEATS }, () => false);
const nulls = (): Array<R.WarChoice | null> => Array.from({ length: SEATS }, (): R.WarChoice | null => null);
const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const decksOf = (v: Variant): number => (v === 'war' ? R.WAR_DECKS : R.DT_DECKS);
const shoeCards = (v: Variant): number => decksOf(v) * 52;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const freshHost = (shoe: R.CwShoe): HostState => ({
  phase: 'open', timer: 0, stage: 0, variant: 'war', shoe, bets: zeroBets(), locked: falses(), deal: null, dt: null,
  choices: nulls(), tieSeats: [], warRows: [],
});
const freshSnap = (): Snap => ({
  phase: 'open', variant: 'war', bets: zeroBets(), locked: falses(), seatCards: Array<string>(SEATS).fill(''), dealer: '',
  dt: ['', ''], tie: [], choices: Array<string>(SEATS).fill(''), road: [], shoeLeft: shoeCards('war'), last: false, win: '',
});

/** Greedy chip stack for an amount (at most 12 chips). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) while (rest >= v && out.length < 12) { out.push(v); rest -= v; }
  return out;
}

const SPOT_NAMES_DT = ['dragon', 'tiger', 'tie', 'suited', 'big', 'small', 'odd', 'even', 'big', 'small', 'odd', 'even'] as const;

export const def: MachineDef = {
  id: 'cardwar',
  category: 'card',
  slotSize: 'L',
  zone: 'cards',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: 5, maxBet: 500, betSteps: [5, 10, 25, 50, 100, 250, 500],
  // host sanity cap per unit of total seat stake: a suited tie pays 50:1 plus the stake
  maxPayoutMult: 60,
  rtp: 0.9712,
  actionCost: 1,
  tags: ['cards', 'table', 'war', 'dragontiger'],
  headless: R.playHeadless,
  modHooks: {
    'm.cardwar.warBonus': 'A war that wins also pays the original main bet 1:1 (> 0 enables).', // i18n-ok: debug hook docs
    'm.cardwar.surrenderRefundAdd': 'Surrender returns 50 % + x of the main stake.', // i18n-ok: debug hook docs
    'm.cardwar.tiePayAdd': 'Tie side bets pay 10:1 (War) and 11:1 (Dragon-Tiger) plus x.', // i18n-ok: debug hook docs
    'm.cardwar.dtTieRefund': 'Dragon-Tiger: Dragon and Tiger bets push in full on a tie (> 0 enables).', // i18n-ok: debug hook docs
    'm.cardwar.suitedTiePayAdd': 'Suited tie pays 50:1 plus x.', // i18n-ok: debug hook docs
    'x.table.peekCharges': 'War: the dealer\'s war card is shown privately on a tie. Dragon-Tiger: the Dragon colour at OPEN.', // i18n-ok: debug hook docs
  },
  strings: STRINGS,
};

export { playHeadless } from './rules';

export default class CardWar extends TableBase<CardwarParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Snap = freshSnap();
  /** HOST ONLY authority state. */
  private hs: HostState = freshHost(new R.CwShoe(this.hostRng, R.WAR_DECKS));
  // presentation bookkeeping (all peers)
  private draft: number[] = new Array<number>(SPOTS).fill(0);
  private draftIds: number[][] = Array.from({ length: SPOTS }, (): number[] => []);
  private betIds: number[][][] = Array.from({ length: SEATS }, () => Array.from({ length: SPOTS }, (): number[] => []));
  private cardIds = new Map<string, number>();
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<CardwarParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.hs = freshHost(new R.CwShoe(this.hostRng, R.WAR_DECKS));
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
    this.applyVariant();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input ────────────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const seat = this.localSeat;
    const v = this.st.variant;
    const open = this.st.phase === 'open' && seat >= 0 && !this.st.locked[seat];
    const deciding = this.st.phase === 'tie' && v === 'war' && seat >= 0 && this.st.tie.includes(seat) && this.st.choices[seat] === '';
    switch (e.action) {
      case 'primary': case 'confirm':
        if (open) {
          if (sumOf(this.draft) <= 0) { this.toast(this.t('noBets'), 'warn'); break; }
          this.act({ k: 'lock', bets: [...this.draft] });
        }
        break;
      case 'n1':
        if (deciding) this.act({ k: 'choice', choice: 'war' });
        else if (open) this.nudge(0, 1);
        break;
      case 'n2':
        if (deciding) this.act({ k: 'choice', choice: 'surrender' });
        else if (open && v === 'dragontiger') this.nudge(1, 1);
        break;
      case 'n3': if (open) this.nudge(v === 'dragontiger' ? 2 : 1, 1); break;
      case 'clear': if (open) this.clearDraft(); break;
      case 'betUp': case 'betDown': case 'betMax':
        if (!open) break;
        if (e.action === 'betMax') this.maxBet(); else this.stepBet(e.action === 'betUp' ? 1 : -1);
        this.sfx('click');
        break;
    }
    this.showHud();
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || (e.button !== 0 && e.button !== 2)) return;
    const p = this.model.parts, seat = this.localSeat, v = this.st.variant;
    if (e.button === 0 && this.st.phase === 'open') {
      const plaque = this.pick([p.plaque]);
      if (plaque) {
        if (this.st.bets.some((r) => r.some((x) => x > 0)) || this.st.locked.some(Boolean)) this.toast(this.t('sVariantBusy'), 'warn');
        else this.act({ k: 'variant' });
        return;
      }
    }
    if (seat < 0 || this.st.phase !== 'open' || this.st.locked[seat]) return;
    const hit = this.pick(p.spotHits[seat]);
    const spot = hit ? p.spotHits[seat].indexOf(hit.object as THREE.Mesh) : -1;
    if (spot >= 0 && R.spotsOf(v).includes(spot)) this.nudge(spot, e.button === 2 ? -1 : 1);
  }

  // ── HOST: actions ──────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    switch (a.k) {
      case 'lock': {
        if (hs.phase !== 'open' || hs.locked[seat]) { this.nak(pid, rid, 'm.cardwar.busy'); return; }
        if (hs.variant === 'war' && seat >= WAR_SEATS) { this.nak(pid, rid, 'm.cardwar.badSeat'); return; }
        const bets = a.bets.map((v) => Math.floor(v));
        const total = sumOf(bets);
        if (total <= 0 || !R.validBets(hs.variant, bets)) { this.nak(pid, rid, 'm.cardwar.badBet'); return; }
        if (!this.chargeSeat(seat, total)) { this.nak(pid, rid, 'common.noFunds'); return; }
        hs.bets[seat] = bets;
        hs.locked[seat] = true;
        void this.emit({ k: 'bets', seats: hs.bets.map((r) => [...r]), locked: [...hs.locked] });
        if (this.isSolo() || this.humans().every((h) => hs.locked[h.seat])) this.startRound();
        return;
      }
      case 'choice': {
        if (hs.phase !== 'tie' || hs.variant !== 'war' || !hs.tieSeats.includes(seat) || hs.choices[seat] !== null) {
          this.nak(pid, rid, 'm.cardwar.notYourTie');
          return;
        }
        // a war raise must be affordable: otherwise the only legal choice is surrender
        if (a.choice === 'war' && !this.chargeSeat(seat, hs.bets[seat][R.WAR_SPOT.MAIN])) { this.nak(pid, rid, 'm.cardwar.noRaise'); return; }
        hs.choices[seat] = a.choice;
        void this.emit({ k: 'choice', seat, choice: a.choice });
        if (hs.tieSeats.every((s) => hs.choices[s] !== null)) this.resolveTies();
        return;
      }
      case 'variant': {
        if (hs.phase !== 'open' || hs.locked.some(Boolean) || hs.bets.some((r) => r.some((x) => x > 0))) {
          this.nak(pid, rid, 'm.cardwar.busy');
          return;
        }
        hs.variant = hs.variant === 'war' ? 'dragontiger' : 'war';
        hs.shoe = new R.CwShoe(this.hostRng, decksOf(hs.variant));
        void this.emit({ k: 'variant', v: hs.variant });
        this.emitShoe();
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
      case 'lock': if ((hs.timer -= dt) <= 0) this.dealRound(); break;
      case 'deal': if ((hs.timer -= dt) <= 0) this.afterDeal(); break;
      case 'compare': if ((hs.timer -= dt) <= 0) this.afterCompare(); break;
      case 'tie': if ((hs.timer -= dt) <= 0) this.resolveTies(); break;
      case 'war': if ((hs.timer -= dt) <= 0) this.settleRound(); break;
      case 'reveal': if ((hs.timer -= dt) <= 0) this.revealStep(); break;
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

  private emitShoe(): void {
    void this.emit({ k: 'shoe', remaining: this.hs.shoe.remaining, last: this.hs.shoe.atCut });
  }

  private beginOpen(): void {
    const hs = this.hs;
    hs.bets = zeroBets(); hs.locked = falses(); hs.choices = nulls(); hs.tieSeats = [];
    hs.deal = null; hs.dt = null; hs.warRows = []; hs.stage = 0;
    void this.emit({ k: 'bets', seats: zeroBets(), locked: falses() });
    const solo = this.isSolo();
    this.setPhase('open', solo ? 0 : (hs.variant === 'war' ? OPEN_WAR_S : OPEN_DT_S));
    if (!solo) void this.countdown(hs.variant === 'war' ? OPEN_WAR_S : OPEN_DT_S, 'open');
    // Mirror charm (Dragon-Tiger): every seated player sees the Dragon's colour privately
    if (hs.variant === 'dragontiger' && this.tableMod('peekCharges', 0) > 0) {
      const next = hs.shoe.peek(0);
      if (next) for (const h of this.humans()) void this.emitPrivate(h.pid, { k: 'peekRed', red: isRed(next) });
    }
  }

  private startRound(): void {
    this.cancelCountdown();
    this.setPhase('lock', LOCK_S);
  }

  /** Draws the round (with the solo luck reroll, before anything is shown) and announces the cards. */
  private dealRound(): void {
    const hs = this.hs;
    const backed: number[] = [];
    for (let s = 0; s < SEATS; s++) if (hs.locked[s]) backed.push(s);
    const luck = this.isSolo() ? this.luck() : 0;
    this.emitShoe();
    if (hs.variant === 'war') {
      hs.deal = R.dealWar(hs.shoe, this.hostRng, backed, luck);
      hs.dt = null;
      for (const s of backed) void this.emit({ k: 'deal', to: 'seat', seat: s, card: hs.deal.seats[s]! });
      void this.emit({ k: 'deal', to: 'dealer', seat: -1, card: hs.deal.dealer });
      this.setPhase('deal', DEAL_CARD_S * (backed.length + 1));
    } else {
      hs.dt = R.dealDt(hs.shoe, this.hostRng, backed, luck);
      hs.deal = null;
      void this.emit({ k: 'dtDeal' });
      this.setPhase('deal', DT_FACE_S);
    }
  }

  private afterDeal(): void {
    if (this.hs.variant === 'war') { this.setPhase('compare', COMPARE_S); return; }
    this.hs.stage = 0;
    this.setPhase('reveal', REVEAL_S);
  }

  /** War: any tied seat with a bet decides between war and surrender; no ties settle at once. */
  private afterCompare(): void {
    const hs = this.hs;
    const ties: number[] = [];
    if (hs.deal) for (let s = 0; s < SEATS; s++) if (hs.deal.res[s] === 'tie') ties.push(s);
    if (ties.length === 0) { this.settleRound(); return; }
    hs.tieSeats = ties;
    const solo = this.isSolo();
    this.setPhase('tie', solo ? Infinity : TIE_S);
    if (!solo) void this.countdown(TIE_S, 'tie');
    void this.emit({ k: 'tie', seats: ties, timeoutMs: solo ? 0 : TIE_S * 1000 });
    if (this.tableMod('peekCharges', 0) > 0) {
      const next = hs.shoe.peek(R.WAR_BURN + 1);
      if (next) for (const s of ties) { const pid = this.seats[s]; if (pid !== null && !isBot(pid)) void this.emitPrivate(pid, { k: 'peek', card: next }); }
    }
  }

  /** Ends the tie decision: undecided seats surrender; any war draws its cards and plays out. */
  private resolveTies(): void {
    const hs = this.hs;
    if (hs.phase !== 'tie') return;
    this.cancelCountdown();
    for (const s of hs.tieSeats) {
      if (hs.choices[s] === null) {
        hs.choices[s] = 'surrender';
        void this.emit({ k: 'choice', seat: s, choice: 'surrender' });
      }
    }
    const warSeats = hs.tieSeats.filter((s) => hs.choices[s] === 'war');
    if (warSeats.length === 0) { this.settleRound(); return; }
    const w = R.warBattle(hs.shoe, warSeats);
    hs.warRows = w.rows;
    void this.emit({
      k: 'war', burn: w.burn.length,
      cards: w.rows.map((r) => ({ seat: r.seat, card: r.p })),
      dealer: w.rows.map((r) => ({ seat: r.seat, card: r.d })),
    });
    this.setPhase('war', WAR_S);
  }

  /** Dragon-Tiger reveal: Dragon, a pause, then Tiger. */
  private revealStep(): void {
    const hs = this.hs, o = hs.dt!;
    switch (hs.stage) {
      case 0: void this.emit({ k: 'reveal', side: 'D', card: o.d }); hs.stage = 1; hs.timer = REVEAL_S; return;
      case 1: hs.stage = 2; hs.timer = PAUSE_S; return;
      case 2: void this.emit({ k: 'reveal', side: 'T', card: o.t }); hs.stage = 3; hs.timer = REVEAL_S; return;
      default: this.settleRound();
    }
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

  /** Milestone and charm hooks, read on the host once per round. */
  private payOpts(): { war: R.WarPay; dt: R.DtPay } {
    const tieAdd = this.mod('m.cardwar.tiePayAdd', 0);
    return {
      war: {
        warBonus: this.feature('warBonus') || this.mod('m.cardwar.warBonus', 0) > 0,
        surrender: R.WAR_BASE_PAY.surrender + this.mod('m.cardwar.surrenderRefundAdd', 0) + (this.feature('surrender60') ? 0.1 : 0),
        tieAdd,
      },
      dt: {
        tieAdd: tieAdd + (this.feature('dtTie12') ? 1 : 0),
        suitedAdd: this.mod('m.cardwar.suitedTiePayAdd', 0),
        tieRefund: this.feature('dtTieRefund') || this.mod('m.cardwar.dtTieRefund', 0) > 0,
      },
    };
  }

  /** Settles every staked seat BEFORE the result is shown (MachineBase rule). */
  private settleRound(): void {
    const hs = this.hs, pay = this.payOpts();
    const rows: number[][] = [];
    let winner = 'TIE', suited = false; // i18n-ok: outcome code, never shown
    if (hs.variant === 'war' && hs.deal) {
      const rowOf = new Map(hs.warRows.map((r): [number, (typeof hs.warRows)[number]] => [r.seat, r]));
      let wins = 0, losses = 0;
      for (let s = 0; s < WAR_SEATS; s++) {
        const bets = hs.bets[s];
        const main = bets[R.WAR_SPOT.MAIN], tie = bets[R.WAR_SPOT.TIE];
        if (main + tie <= 0) continue;
        const res = hs.deal.res[s] ?? 'lose';
        const choice = res === 'tie' ? (hs.choices[s] ?? 'surrender') : null;
        const war = rowOf.get(s);
        const gross = R.warSeatGross(main, tie, res, choice, war?.win ?? false, pay.war);
        const staked = this.staked(s);
        const payout = R.roundCoins(gross, this.hostRng);
        this.paySeat(s, payout, { bet: staked });
        rows.push([s, payout]);
        if (res === 'win' || (choice === 'war' && war?.win)) wins++;
        else if (res === 'lose' || (choice === 'war' && !war?.win) || choice === 'surrender') losses++;
      }
      winner = wins > losses ? 'W' : losses > wins ? 'H' : 'TIE'; // i18n-ok: outcome code, never shown
    } else if (hs.dt) {
      const o = hs.dt;
      winner = o.winner;
      suited = o.suited;
      for (let s = 0; s < SEATS; s++) {
        const bets = hs.bets[s];
        const total = sumOf(bets);
        if (total <= 0) continue;
        let gross = 0;
        for (let k = 0; k < SPOTS; k++) gross += R.dtSpotGross(k, bets[k], o, pay.dt);
        const payout = R.roundCoins(gross, this.hostRng);
        this.paySeat(s, payout, { bet: total });
        rows.push([s, payout]);
      }
    }
    void this.emit({ k: 'result', winner, suited, seats: rows });
    this.setPhase('settle', SETTLE_S);
  }

  /** A seat was vacated. Runs on every peer; the seat is already empty, so the pay helpers take the `pid`. */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    const hs = this.hs;
    if (this.isHost && hs) {
      if (hs.locked[seat] && (hs.phase === 'open' || hs.phase === 'lock')) {
        const total = sumOf(hs.bets[seat]);
        this.paySeat(seat, total, { bet: total, tier: 'push', tags: ['refund'] }, pid);
        hs.bets[seat] = new Array<number>(SPOTS).fill(0);
        hs.locked[seat] = false;
        void this.emit({ k: 'bets', seats: zeroBets(), locked: falses() });
      }
      // a tied seat that leaves surrenders (its stakes are forfeited by TableBase)
      if (hs.phase === 'tie' && hs.tieSeats.includes(seat) && hs.choices[seat] === null) {
        hs.choices[seat] = 'surrender';
        if (hs.tieSeats.every((s) => hs.choices[s] !== null)) this.resolveTies();
      }
    }
    if (local) { this.draft = new Array<number>(SPOTS).fill(0); this.paintDraftAll(); this.seatHud?.hide(); this.model.parts.stools.visible = true; }
    this.paintLamps();
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.model.parts.stools.visible = false;   // seat camera: the stools are the foreground, hidden while seated
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('cardwar', this.tipLines());
    }
  }

  // ── presentation (every peer) ──────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const fast = pc.fast, p = this.model.parts, st = this.st;
    switch (ev.k) {
      case 'bets': {
        st.bets = ev.seats.map((r) => [...r]);
        st.locked = [...ev.locked];
        this.paintBets();
        if (pc.local && this.localSeat >= 0 && st.locked[this.localSeat]) this.clearDraft();
        if (!fast && st.bets.some((r) => r.some((v) => v > 0))) this.sfx('chip');
        this.showHud();
        return;
      }
      case 'variant': {
        st.variant = ev.v;
        this.draft = new Array<number>(SPOTS).fill(0);
        this.applyVariant();
        this.sfx('creak', { vol: 0.6 });
        this.showHud();
        return;
      }
      case 'phase': {
        st.phase = ev.p;
        if (ev.p === 'open') this.clearTable();
        if (ev.p === 'lock') {
          this.sfx('bell');
          p.seatLamps.forEach((l, s) => { if (this.seats[s] !== null) l.blink(6, 0.6); });
        }
        if (ev.p === 'shuffle') this.sfx('shuffle');
        this.showHud();
        return;
      }
      case 'shoe': {
        st.shoeLeft = ev.remaining;
        st.last = ev.last;
        this.paintShoe();
        return;
      }
      case 'deal': {
        if (ev.to === 'seat') {
          st.seatCards[ev.seat] = ev.card;
          await this.dealTo(`seat${ev.seat}`, ev.card as CardId, seatCardVec(ev.seat), fast);
        } else {
          st.dealer = ev.card;
          await this.dealTo('dealer', ev.card as CardId, dealerCardVec(), fast);
        }
        return;
      }
      case 'dtDeal': {
        st.dt = ['', ''];
        await this.dealTo('dtD', null, dtCardVec('D'), fast);
        await this.dealTo('dtT', null, dtCardVec('T'), fast);
        return;
      }
      case 'tie': {
        st.tie = [...ev.seats];
        this.sfx('bell');
        for (const s of ev.seats) p.seatLamps[s]?.blink(6, 0.6);
        this.showHud();
        return;
      }
      case 'choice': {
        st.choices[ev.seat] = ev.choice;
        this.sfx(ev.choice === 'war' ? 'thud' : 'click', { vol: 0.7 });
        this.showHud();
        return;
      }
      case 'war': {
        st.phase = 'war';
        // taiko-like drums: four hits, the burn is out of sight
        for (let k = 0; k < 4 && !fast; k++) { this.sfx('thud', { vol: 0.8 }); await this.wait(0.12); }
        for (const row of ev.cards) await this.dealTo(`warS${row.seat}`, row.card as CardId, warCardVec(row.seat), fast);
        for (const row of ev.dealer) await this.dealTo(`warD${row.seat}`, row.card as CardId, dealerWarVec(row.seat), fast);
        this.sfx('stinger', { vol: 0.8 });
        return;
      }
      case 'reveal': {
        const dragon = ev.side === 'D';
        const key = dragon ? 'dtD' : 'dtT';
        if (dragon) st.dt[0] = ev.card; else st.dt[1] = ev.card;
        const id = this.cardIds.get(key);
        if (id !== undefined) {
          p.cards.setCard(id, ev.card as CardId);
          await p.cards.flip(id, fast ? 0.01 : 0.36);
        }
        this.sfx('cardFlip');
        return;
      }
      case 'result': {
        await this.presentResult(ev, fast, pc);
        return;
      }
      case 'peek': {
        this.toast(this.t('peek', { card: cardText(ev.card as CardId) }), 'sys');
        return;
      }
      case 'peekRed': {
        this.toast(this.t('peekRed', { c: this.t(ev.red ? 'red' : 'black') }), 'sys');
        return;
      }
    }
  }

  private async presentResult(ev: ResultEv, fast: boolean, pc: PresentCtx): Promise<void> {
    const p = this.model.parts, st = this.st;
    st.phase = 'settle';
    st.win = ev.winner;
    st.road.push(ev.winner === 'D' || ev.winner === 'W' ? 1 : ev.winner === 'T' || ev.winner === 'H' ? 2 : 3);
    if (st.road.length > 48) st.road.shift();
    this.paintRoad();
    // the winning head roars (eyes glow, jaw opens, the head lunges); a tie lunges both heads and clashes
    if (ev.winner === 'D') void this.roar(p.dragon, fast);
    else if (ev.winner === 'T') void this.roar(p.tiger, fast);
    else if (ev.winner === 'W') void this.roar(p.tiger, fast);
    else if (ev.winner === 'H') void this.roar(p.dragon, fast);
    else if (ev.winner === 'TIE') { void this.roar(p.dragon, fast); void this.roar(p.tiger, fast); this.sfx('stinger', { vol: 0.7 }); } // i18n-ok: outcome code, never shown
    if (ev.suited) { this.sfx('jackpotSiren', { vol: 0.35 }); }
    const mine = this.localSeat;
    for (const row of ev.seats) {
      const seat = row[0], payout = row[1];
      if (seat !== mine) continue;
      const stake = sumOf(st.bets[seat]);
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
    if (!fast) await this.wait(0.3);
    p.cards.clear();
    this.cardIds.clear();
    this.paintShoe();
  }

  /** Eyes glow for 1.5 s, the jaw opens and the head lunges once towards the seats. */
  private roar(head: HeadParts, fast: boolean): Promise<void> {
    head.eyes.setOn(true);
    head.smoke.visible = true;
    this.sfx('win2', { vol: 0.6 });
    void this.wait(EYES_GLOW_S).then(() => { head.eyes.setOn(false); head.smoke.visible = false; });
    return this.anim(fast ? 0.01 : 0.4, (k) => {
      const s = Math.sin(k * Math.PI);
      head.root.position.z = DEALER_Z + 0.08 * s;
      head.jaw.rotation.x = -0.5 * s;
    });
  }

  /** Moves one card from the shoe mouth to `at` (face down when `card` is null). */
  private async dealTo(key: string, card: CardId | null, at: THREE.Vector3, fast: boolean): Promise<void> {
    const p = this.model.parts;
    const old = this.cardIds.get(key);
    if (old !== undefined) { p.cards.remove(old); this.cardIds.delete(key); }
    const id = p.cards.add(card, shoeMouth(), 0);
    this.cardIds.set(key, id);
    this.sfx('card');
    await p.cards.move(id, at, fast ? 0.01 : 0.26, { arc: 0.05 });
  }

  /** Clears the felt and the stakes ahead of the next OPEN. */
  private clearTable(): void {
    const p = this.model.parts;
    p.cards.clear();
    this.cardIds.clear();
    const st = this.st;
    st.seatCards = Array<string>(SEATS).fill('');
    st.dealer = '';
    st.dt = ['', ''];
    st.tie = [];
    st.choices = Array<string>(SEATS).fill('');
    st.win = '';
    this.resetHeads();
  }

  // ── snapshots (late joiners get the public state only) ─────────────────────────────────────────
  getSnapshot(_forPid?: PlayerId): Snap {
    const s = this.st;
    return {
      phase: s.phase, variant: s.variant, bets: s.bets.map((r) => [...r]), locked: [...s.locked],
      seatCards: [...s.seatCards], dealer: s.dealer, dt: [...s.dt], tie: [...s.tie], choices: [...s.choices],
      road: [...s.road], shoeLeft: s.shoeLeft, last: s.last, win: s.win,
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, variant: sn.variant, bets: sn.bets.map((r) => [...r]), locked: [...sn.locked],
      seatCards: [...sn.seatCards], dealer: sn.dealer, dt: [...sn.dt], tie: [...sn.tie], choices: [...sn.choices],
      road: [...sn.road], shoeLeft: sn.shoeLeft, last: sn.last, win: sn.win,
    };
    this.paintAll();
    this.applyVariant();
    this.showHud();
  }

  // ── visuals ────────────────────────────────────────────────────────────────────────────────────
  override onLang(): void { this.paintFelt(); this.paintRoad(); this.showHud(); }

  /** Re-lays the spots, the felt and the shoe for `this.st.variant` (idempotent). */
  private applyVariant(): void {
    const v = this.st.variant, p = this.model.parts;
    const live = R.spotsOf(v);
    for (let s = 0; s < SEATS; s++) {
      const seatOn = v === 'dragontiger' || s < WAR_SEATS;
      for (let k = 0; k < SPOTS; k++) {
        const vec = spotVec(v, s, k);
        const hit = p.spotHits[s][k];
        hit.position.copy(vec).add(new THREE.Vector3(0, 0.002, 0));
        hit.visible = seatOn && live.includes(k);
        p.spots[s][k].position.copy(vec).add(new THREE.Vector3(0, 0.02, 0));
      }
    }
    this.paintLamps();
    this.paintFelt();
    this.paintBets();
    this.paintDraftAll();
    this.paintShoe();
  }

  /** Resting pose of every visual for `this.st` (idempotent). */
  private paintAll(): void {
    this.paintLamps();
    this.paintBets();
    this.paintRoad();
    this.paintShoe();
    this.paintFelt();
    this.model.parts.cards.clear();
    this.cardIds.clear();
    this.resetHeads();
  }

  private resetHeads(): void {
    for (const h of [this.model.parts.dragon, this.model.parts.tiger]) {
      h.eyes.setOn(false);
      h.smoke.visible = false;
      h.jaw.rotation.x = 0;
      h.root.position.z = DEALER_Z;
    }
  }

  private paintLamps(): void {
    const v = this.st.variant;
    this.model.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null && (v === 'dragontiger' || s < WAR_SEATS)));
  }

  private paintBets(): void {
    const chips = this.model.parts.chips, v = this.st.variant;
    for (let s = 0; s < SEATS; s++) {
      for (let k = 0; k < SPOTS; k++) {
        for (const id of this.betIds[s][k]) chips.remove(id);
        this.betIds[s][k] = [];
        const amount = this.st.bets[s][k];
        if (amount > 0 && R.spotsOf(v).includes(k)) this.betIds[s][k] = chips.stack(chipsFor(amount), spotVec(v, s, k));
      }
    }
  }

  private paintDraft(spot: number): void {
    const chips = this.model.parts.chips;
    for (const id of this.draftIds[spot]) chips.remove(id);
    this.draftIds[spot] = [];
    if (this.localSeat >= 0 && this.draft[spot] > 0) {
      this.draftIds[spot] = chips.stack(chipsFor(this.draft[spot]), spotVec(this.st.variant, this.localSeat, spot));
    }
  }

  private paintDraftAll(): void { for (let k = 0; k < SPOTS; k++) this.paintDraft(k); }

  private clearDraft(): void {
    this.draft = new Array<number>(SPOTS).fill(0);
    this.paintDraftAll();
  }

  private paintShoe(): void {
    const p = this.model.parts;
    const total = shoeCards(this.st.variant);
    const used = Math.max(0, Math.min(1, (total - this.st.shoeLeft) / total));
    p.discardStack.scale.y = 0.2 + 0.8 * used;
    p.shoeLevel.scale.y = Math.max(0.1, this.st.shoeLeft / total);
  }

  /** Felt canvas: WAR boxes per seat, or the Dragon-Tiger grid. Canvas top = the dealer side (−Z). */
  private paintFelt(): void {
    const v = this.st.variant;
    const X = (x: number, w: number): number => ((x + FELT_W / 2) / FELT_W) * w;
    const Y = (z: number, h: number): number => ((z + FELT_D / 2) / FELT_D) * h;
    this.model.parts.felt.draw((g, w) => {
      g.fillStyle = '#0c1410';
      g.fillRect(0, 0, w.w, w.h);
      g.strokeStyle = '#c9a227';
      g.lineWidth = 2;
      const box = (cx: number, cz: number, bw: number, bd: number, label: string): void => {
        const x0 = X(cx - bw / 2, w.w), y0 = Y(cz - bd / 2, w.h);
        g.strokeRect(x0, y0, (bw / FELT_W) * w.w, (bd / FELT_D) * w.h);
        w.text(label, X(cx, w.w), y0 + 2, { font: 'px5', color: '#ffd040', align: 'center' });
      };
      if (v === 'war') {
        for (let s = 0; s < WAR_SEATS; s++) {
          const main = spotVec('war', s, R.WAR_SPOT.MAIN), tie = spotVec('war', s, R.WAR_SPOT.TIE);
          box(main.x, main.z, 0.2, 0.09, this.t('main'));
          box(tie.x, tie.z, 0.2, 0.08, this.t('tieSide'));
        }
      } else {
        for (let s = 0; s < SEATS; s++) {
          for (let k = 0; k < SPOTS; k++) {
            const c = spotVec('dragontiger', s, k);
            box(c.x, c.z, 0.042, 0.06, this.t(SPOT_NAMES_DT[k]).slice(0, 4));
          }
        }
      }
      w.text(this.t(v === 'war' ? 'variantWar' : 'variantDt'), w.w / 2, Math.max(0, Y(-0.44, w.h) - 10), { font: 'px5', color: '#f4ead2', align: 'center' });
    });
  }

  /** History strip: D / T / tie (War: H / W / tie) lamps, newest right. */
  private paintRoad(): void {
    const beads = this.st.road;
    this.model.parts.history.draw((g, w) => {
      g.fillStyle = '#06100a';
      g.fillRect(0, 0, w.w, w.h);
      const colour = (b: number): string => (b === 1 ? '#c8102e' : b === 2 ? '#e0a020' : '#3aa655');
      const from = Math.max(0, beads.length - 24);
      beads.slice(from).forEach((b, i) => {
        g.fillStyle = colour(b);
        g.fillRect(2 + i * 4, 3, 3, 10);
      });
    });
  }

  // ── HUD and betting helpers ──────────────────────────────────────────────────────────────────────
  private nudge(spot: number, dir: 1 | -1): void {
    if (this.localSeat < 0) { this.toast(this.t('notSeated'), 'warn'); return; }
    const v = this.st.variant;
    const lim = R.limitOf(v, spot);
    if (!lim) return;
    const cur = this.draft[spot];
    let next = cur + dir * this.bet;
    if (dir > 0 && next > lim.max) { next = lim.max; this.toast(this.t('limit', { n: fmtCoins(lim.max) }), 'warn'); }
    if (next > 0 && next < lim.min) next = lim.min;
    if (next < 0) next = 0;
    if (sumOf(this.draft) - cur + next > R.TABLE_MAX) {
      this.toast(this.t('tableMax', { n: fmtCoins(R.TABLE_MAX) }), 'warn');
      return;
    }
    if (next === cur) return;
    this.draft[spot] = next;
    this.paintDraft(spot);
    this.sfx('chip');
    this.showHud();
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.cardwar.hTip1', v: { n1: this.k('n1'), n2: this.k('n2'), n3: this.k('n3') } },
      { k: 'm.cardwar.hTip2', v: { lock: this.k('primary') } },
      { k: 'm.cardwar.hTip3', v: { war: this.k('n1'), surr: this.k('n2'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return ['hRule1', 'hRule2', 'hRule3', 'hRule4', 'hRule5', 'hRule6'].map((r) => ({ k: 'm.cardwar.' + r }));
  }

  /** Banner, key numbers and valid controls. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || this.localSeat < 0) return;
    const s = this.st, seat = this.localSeat, v = s.variant;
    const open = s.phase === 'open' && !s.locked[seat];
    const locked = s.locked[seat];
    const deciding = s.phase === 'tie' && v === 'war' && s.tie.includes(seat) && s.choices[seat] === '';
    const stake = locked ? sumOf(s.bets[seat]) : sumOf(this.draft);
    const picks = locked ? s.bets[seat] : this.draft;
    sh.goal({ k: v === 'war' ? 'm.cardwar.hGoalWar' : 'm.cardwar.hGoalDt' });

    // STATE: whose turn, what phase
    switch (s.phase) {
      case 'open':
        if (locked) sh.state({ k: 'm.cardwar.hStLocked' }, 'cyan', { k: 'm.cardwar.hStLockedSub' });
        else sh.state({ k: 'm.cardwar.hStBet' }, 'gold', { k: 'm.cardwar.hStBetSub', v: { lock: this.k('primary') } });
        break;
      case 'lock': sh.state({ k: 'm.cardwar.hStNoMore' }, 'warn'); break;
      case 'deal': sh.state({ k: 'm.cardwar.hStDeal' }, 'neutral'); break;
      case 'compare': case 'reveal': sh.state({ k: 'm.cardwar.hStTurn' }, 'neutral'); break;
      case 'tie':
        if (deciding) sh.state({ k: 'm.cardwar.hStTie' }, 'warn', { k: 'm.cardwar.hStTieSub', v: { war: this.k('n1'), surr: this.k('n2') } });
        else sh.state({ k: 'm.cardwar.hStTieWait' }, 'cyan');
        break;
      case 'war': sh.state({ k: 'm.cardwar.hStWar' }, 'bad'); break;
      case 'settle': sh.state({ k: 'm.cardwar.hStPay' }, 'neutral'); break;
      case 'shuffle': sh.state({ k: 'm.cardwar.hStShuffle' }, 'neutral'); break;
      default: sh.state({ k: 'm.cardwar.hStIdle' }, 'neutral');
    }

    // KEY NUMBERS: game, stake, picks, the cards in play, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.cardwar.hNGame' }, value: this.t(v === 'war' ? 'variantWar' : 'variantDt'), tone: 'neutral' });
    nums.push({ label: { k: 'm.cardwar.hNStake' }, value: fmtCoins(stake), tone: 'gold' });
    const legs: string[] = [];
    if (v === 'war') {
      if (picks[0] > 0) legs.push(`${this.t('hsMain')} ${fmtCoins(picks[0])}`);
      if (picks[1] > 0) legs.push(`${this.t('hsTie')} ${fmtCoins(picks[1])}`);
    } else {
      const named = ['hsD', 'hsT', 'hsTie', 'hsSuit'] as const;
      named.forEach((n, i) => { if (picks[i] > 0) legs.push(`${this.t(n)} ${fmtCoins(picks[i])}`); });
      const side = picks.slice(4).reduce((a, b) => a + b, 0);
      if (side > 0) legs.push(`${this.t('hsSide')} ${fmtCoins(side)}`);
    }
    if (legs.length > 0) nums.push({ label: { k: 'm.cardwar.hNPicks' }, value: legs.join(' · '), tone: 'cyan' });
    if (v === 'war') {
      if (s.dealer) nums.push({ label: { k: 'm.cardwar.hNDealer' }, value: cardText(s.dealer as CardId), tone: 'bad' });
      if (s.seatCards[seat]) nums.push({ label: { k: 'm.cardwar.hNYou' }, value: cardText(s.seatCards[seat] as CardId), tone: 'cyan' });
    } else {
      if (s.dt[0]) nums.push({ label: { k: 'm.cardwar.hNDragon' }, value: cardText(s.dt[0] as CardId), tone: 'bad' });
      if (s.dt[1]) nums.push({ label: { k: 'm.cardwar.hNTiger' }, value: cardText(s.dt[1] as CardId), tone: 'cyan' });
    }
    nums.push({ label: { k: 'm.cardwar.hNBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    if (open) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.cardwar.hCLock' }, action: 'primary', primary: true });
      if (v === 'war') {
        ctrl.push({ key: this.k('n1'), label: { k: 'm.cardwar.hCMain' }, action: 'n1' });
        ctrl.push({ key: this.k('n3'), label: { k: 'm.cardwar.hCTie' }, action: 'n3' });
      } else {
        ctrl.push({ key: this.k('n1'), label: { k: 'm.cardwar.hCDragon' }, action: 'n1' });
        ctrl.push({ key: this.k('n2'), label: { k: 'm.cardwar.hCTiger' }, action: 'n2' });
        ctrl.push({ key: this.k('n3'), label: { k: 'm.cardwar.hCTie' }, action: 'n3' });
      }
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.cardwar.hCBet' }, action: 'betUp' });
      if (stake > 0) ctrl.push({ key: this.k('clear'), label: { k: 'm.cardwar.hCClear' }, action: 'clear' });
    } else if (deciding) {
      ctrl.push({ key: this.k('n1'), label: { k: 'm.cardwar.hCWar' }, action: 'n1', primary: true });
      ctrl.push({ key: this.k('n2'), label: { k: 'm.cardwar.hCSurr' }, action: 'n2' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.cardwar.hCRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.cardwar.hCLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}
