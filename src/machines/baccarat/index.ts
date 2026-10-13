/**
 * Baccarat "The Mirror Table" (`baccarat`) — Punto Banco on a seven-seat kidney table (MACHINES_tables §6).
 *
 * Shape of the code (the TableBase pattern of blackjack / demoTable):
 *  - HOST ONLY (`hs`): the eight-deck shoe, the coup in progress, every stake, the squeeze timers and the payouts.
 *    Clients send `act()` (lock bets, squeeze, flip, skip); the host validates with the pure rules (`rules.ts`), charges
 *    and pays through the seat helpers, and publishes every card as a PUBLIC event only when it is turned over.
 *    Card values never leave the host before the reveal. `peek` (Mirror charm) is PRIVATE to the seat owner.
 *  - EVERY PEER (`present`): the only place the visible state (`st`) changes. Events are queued, so the host's own
 *    presentation runs in the same order as everyone else's.
 *  - Round: OPEN (solo: until you lock · shared: 15 s or everyone locked) → LOCK 0.6 → DEAL 1.4 (P B P B face down) →
 *    SQUEEZE per side (P first; the largest bettor on the side squeezes; 6 s per side shared, ∞ solo) → REVEAL 0.8 →
 *    THIRD 0.8 each → RESULT 1.5 (settled before it is shown) → PAYOUT 2.5 → SHUFFLE 5.0 after the last coup.
 *  - Squeeze: hold LMB on a squeezed card and drag down; release past 0.8 flips it. Space (primary) reveals all.
 *    Bets: LMB on a spot adds the selected chip, RMB removes one, keys 1 / 2 / 3 quick-bet Player / Banker / Tie.
 *  - Luck (solo only): a coup that loses every backed bet is reinserted and dealt again with p = luck / 100 before
 *    anything is shown. Shared tables never reroll.
 *
 * Not in v1 (recorded in the review notes, not silently dropped): the V mirror detail camera, autoplay (G),
 * the Overheat grin, `m.baccarat.squeezeLuck`, the per-seat rail meters, and the Big Road in its full 6 × 24 form
 * (the roadmap shows a 12-column Bead Plate and a 12-column Big Road in one 96 × 48 screen).
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import type { ChipValue, LampPart } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier } from '@/machines/_base/tiers';
import { baccaratValue, cardText } from '@/machines/_base/cards';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { STRINGS } from './baccarat.strings';
import {
  buildModel, setFaceUV, spotPos, slotPos, shoeMouth, SEATS, CARD_H, type BaccaratParts,
} from './model';
import * as R from './rules';

// ── timings (seconds) ─────────────────────────────────────────────────────────────────────────────
const OPEN_S = 15, LOCK_S = 0.6, DEAL_S = 1.4, SQUEEZE_S = 6, REVEAL_S = 0.8, THIRD_S = 0.8;
const RESULT_S = 1.5, PAYOUT_S = 2.5, SHUFFLE_S = 5.0;
const DRAG_RANGE = 0.3, DRAG_OK = 0.8, SEND_GAP_MS = 125;
const MIRROR_OFF = 0x1d3133, MIRROR_FLASH = 0xffffff;
const SHOE_CARDS = R.DECKS * 52;
const CHIP_VALUES: ChipValue[] = [1000, 500, 100, 25, 10, 5, 1];

type Side = 'P' | 'B';
type Phase = 'open' | 'lock' | 'deal' | 'squeeze' | 'reveal' | 'third' | 'result' | 'payout' | 'shuffle';
type ResultEv = { k: 'result'; p: number; b: number; winner: string; pairs: boolean[]; natural: boolean; seats: number[][] };

// ── events (public unless noted), actions, snapshot ──────────────────────────────────────────────
type Ev =
  /** Stakes per seat × spot (public), and who has locked. Sent on every change and at each OPEN. */
  | { k: 'bets'; seats: number[][]; locked: boolean[] }
  | { k: 'phase'; p: Phase }
  | { k: 'shoe'; remaining: number; last: boolean; shown: string }
  /** Squeezer seat per side (P, B); −1 = nobody backed the side and it turns on its own. */
  | { k: 'deal'; sq: number[] }
  /** The side's turn in SQUEEZE (seat −1 = auto turn). */
  | { k: 'side'; side: Side; seat: number }
  | { k: 'squeeze'; side: Side; idx: number; bend: number; seat: number }
  | { k: 'reveal'; side: Side; idx: number; card: string }
  | { k: 'third'; side: Side; card: string }
  | { k: 'result'; p: number; b: number; winner: string; pairs: boolean[]; natural: boolean; seats: number[][] }
  /** PRIVATE: the next card on top of the shoe (Mirror charm). */
  | { k: 'peek'; card: string };
type Act =
  | { k: 'lock'; bets: number[] }
  | { k: 'squeeze'; side: Side; idx: number; bend: number }
  | { k: 'flip'; side: Side; idx: number }
  | { k: 'skip' };

/** What every peer sees. Mutated only in `present`. Card values appear only after they are turned over. */
type Snap = {
  phase: Phase; bets: number[][]; locked: boolean[]; sq: number[]; cards: string[][];
  road: number[]; shoeLeft: number; last: boolean; shown: string; win: string;
};

// ── host-only authority state ────────────────────────────────────────────────────────────────────
type HostState = {
  phase: Phase; timer: number; stage: number; side: number; sideTimer: number;
  shoe: R.BacShoe; bets: number[][]; locked: boolean[]; sq: number[];
  coup: R.Coup | null; out: R.Outcome | null; revealed: boolean[][];
};

const zeroBets = (): number[][] => Array.from({ length: SEATS }, () => [0, 0, 0, 0, 0]);
const falses = (): boolean[] => Array.from({ length: SEATS }, () => false);
const sumOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const sideKey = (side: number): Side => (side === 0 ? 'P' : 'B');
const sideIdx = (side: Side): number => (side === 'P' ? 0 : 1);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const freshHost = (shoe: R.BacShoe): HostState => ({
  phase: 'open', timer: 0, stage: 0, side: 0, sideTimer: 0, shoe, bets: zeroBets(), locked: falses(), sq: [-1, -1],
  coup: null, out: null, revealed: [[false, false], [false, false]],
});
const freshSnap = (): Snap => ({
  phase: 'open', bets: zeroBets(), locked: falses(), sq: [-1, -1], cards: [[], []], road: [],
  shoeLeft: SHOE_CARDS, last: false, shown: '', win: '',
});

/** Greedy chip stack for an amount (at most 12 chips). */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let rest = Math.floor(amount);
  for (const v of CHIP_VALUES) while (rest >= v && out.length < 12) { out.push(v); rest -= v; }
  return out;
}

/** Bends a 4-segment card strip: the near edge (towards the player) lifts, the far edge stays on the felt. */
function bendCard(m: THREE.Mesh, bend: number): void {
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const f = (CARD_H / 2 - pos.getY(i)) / CARD_H;   // 0 far edge … 1 near edge
    pos.setZ(i, bend * 0.05 * f * f);
  }
  pos.needsUpdate = true;
}

export const def: MachineDef = {
  id: 'baccarat',
  category: 'card',
  slotSize: 'L',
  zone: 'cards',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: 1, maxBet: 1000, betSteps: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  // host sanity cap per unit of stake: a pair pays 11:1 plus the stake, a tie 8:1 (+ charm adds)
  maxPayoutMult: 20,
  rtp: 0.989,
  actionCost: 1,
  tags: ['cards', 'table', 'baccarat', 'punto'],
  headless: R.playHeadless,
  modHooks: {
    'm.baccarat.naturalBonus': 'Winning Player/Banker bets on a natural pay +x (× stake).', // i18n-ok: debug hook docs
    'm.baccarat.tiePayAdd': 'Tie pays 8:1 plus x.', // i18n-ok: debug hook docs
    'm.baccarat.pairPayAdd': 'Pair bets pay 11:1 plus x.', // i18n-ok: debug hook docs
    'm.baccarat.tieSweetener': 'A Tie returns 110 % of the Player/Banker stake instead of a push (non-zero enables).', // i18n-ok: debug hook docs
    'x.table.rakeDelta': 'Banker commission delta on the 5 % base (Dealer\'s Button −5 pp, L25 −1 pp).', // i18n-ok: debug hook docs
    'x.table.peekCharges': 'Every seated player sees the top card of the shoe privately at each OPEN.', // i18n-ok: debug hook docs
  },
  strings: STRINGS,
};

export { playHeadless } from './rules';

export default class Baccarat extends TableBase<BaccaratParts, Ev, Snap, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Snap = freshSnap();
  /** HOST ONLY authority state (created in `init`). */
  private hs: HostState = freshHost(new R.BacShoe(this.hostRng));
  // presentation bookkeeping (all peers)
  private draft: number[] = [0, 0, 0, 0, 0];
  private draftIds: number[][] = [[], [], [], [], []];
  private betIds: number[][][] = Array.from({ length: SEATS }, (): number[][] => [[], [], [], [], []]);
  private cardIds: number[][] = [[-1, -1, -1], [-1, -1, -1]];
  private overlay: { side: number; seat: number } | null = null;
  private drag: { side: number; idx: number; y0: number; bend: number; sent: number } | null = null;

  protected createModel(kit: KitX): MachineModel<BaccaratParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    // the host state starts in OPEN with timer 0: the first host tick opens the first betting window
    this.hs = freshHost(new R.BacShoe(this.hostRng));
    this.paintAll();
  }

  // ── local input ────────────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const seat = this.localSeat;
    const open = this.st.phase === 'open' && seat >= 0 && !this.st.locked[seat];
    switch (e.action) {
      case 'primary': case 'confirm':
        if (this.st.phase === 'squeeze') { this.act({ k: 'skip' }); break; }
        if (open) {
          if (sumOf(this.draft) <= 0) { this.toast(this.t('noBets'), 'warn'); break; }
          this.act({ k: 'lock', bets: [...this.draft] });
        }
        break;
      case 'n1': if (open) this.nudge(R.SP.P, 1); break;
      case 'n2': if (open) this.nudge(R.SP.B, 1); break;
      case 'n3': if (open) this.nudge(R.SP.T, 1); break;
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
    const p = this.model.parts, seat = this.localSeat;
    const squeezing = this.st.phase === 'squeeze' && this.overlay !== null && seat >= 0 && this.st.sq[this.overlay.side] === seat;
    if (e.type === 'down' && e.button === 0 && squeezing && this.overlay) {
      const hit = this.pick(p.squeezeCards);
      const idx = hit ? p.squeezeCards.indexOf(hit.object as THREE.Mesh) : -1;
      if (idx >= 0 && hit && hit.object.visible) this.drag = { side: this.overlay.side, idx, y0: e.ndc.y, bend: 0, sent: 0 };
      return;
    }
    if (e.type === 'move' && this.drag) {
      const d = this.drag;
      d.bend = clamp01((d.y0 - e.ndc.y) / DRAG_RANGE);
      bendCard(p.squeezeCards[d.idx], d.bend);
      if (e.t - d.sent >= SEND_GAP_MS) {
        d.sent = e.t;
        this.act({ k: 'squeeze', side: sideKey(d.side), idx: d.idx, bend: d.bend });
      }
      return;
    }
    if (e.type === 'up' && this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.bend >= DRAG_OK) this.act({ k: 'flip', side: sideKey(d.side), idx: d.idx });
      else { bendCard(p.squeezeCards[d.idx], 0); this.act({ k: 'squeeze', side: sideKey(d.side), idx: d.idx, bend: 0 }); }
      return;
    }
    if (e.type === 'down' && (e.button === 0 || e.button === 2) && seat >= 0 && !this.st.locked[seat] && this.st.phase === 'open') {
      const hit = this.pick(p.spotHits[seat]);
      const spot = hit ? p.spotHits[seat].indexOf(hit.object as THREE.Mesh) : -1;
      if (spot >= 0) this.nudge(spot, e.button === 2 ? -1 : 1);
    }
  }

  // ── HOST: actions ──────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    switch (a.k) {
      case 'lock': {
        if (hs.phase !== 'open' || hs.locked[seat]) { this.nak(pid, rid, 'm.baccarat.busy'); return; }
        const bets = a.bets.map((v) => Math.floor(v));
        const total = sumOf(bets);
        if (total <= 0 || !R.validBets(bets)) { this.nak(pid, rid, 'm.baccarat.badBet'); return; }
        if (!this.chargeSeat(seat, total)) { this.nak(pid, rid, 'common.noFunds'); return; }
        hs.bets[seat] = bets;
        hs.locked[seat] = true;
        void this.emit({ k: 'bets', seats: hs.bets.map((r) => [...r]), locked: [...hs.locked] });
        if (this.isSolo() || this.humans().every((h) => hs.locked[h.seat])) this.startCoup();
        return;
      }
      case 'squeeze': {
        if (hs.phase !== 'squeeze' || a.side !== sideKey(hs.side) || hs.sq[hs.side] !== seat || hs.revealed[hs.side][a.idx]) return;
        void this.emit({ k: 'squeeze', side: a.side, idx: a.idx, bend: clamp01(a.bend), seat });
        return;
      }
      case 'flip': {
        if (hs.phase !== 'squeeze' || a.side !== sideKey(hs.side) || hs.sq[hs.side] !== seat) return;
        this.revealCard(hs.side, a.idx);
        if (hs.revealed[hs.side].every(Boolean)) this.finishSide(hs.side);
        return;
      }
      case 'skip': {
        if (hs.phase !== 'squeeze' || !hs.sq.includes(seat)) return;
        this.skipAll();
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
        hs.timer -= dt;
        if (hs.timer <= 0) {
          if (hs.locked.some(Boolean)) this.startCoup();
          else this.beginOpen();
        }
        break;
      case 'lock': if ((hs.timer -= dt) <= 0) this.dealCoup(); break;
      case 'deal': if ((hs.timer -= dt) <= 0) this.startSide(0); break;
      case 'squeeze':
        if (Number.isFinite(hs.sideTimer) && (hs.sideTimer -= dt) <= 0) this.revealSide(hs.side);
        break;
      case 'reveal': if ((hs.timer -= dt) <= 0) this.thirdsFrom(0); break;
      case 'third': if ((hs.timer -= dt) <= 0) this.thirdsFrom(hs.stage); break;
      case 'result': if ((hs.timer -= dt) <= 0) this.setPhase('payout', PAYOUT_S); break;
      case 'payout': if ((hs.timer -= dt) <= 0) this.afterPayout(); break;
      case 'shuffle': if ((hs.timer -= dt) <= 0) this.beginOpen(); break;
    }
  }

  private isSolo(): boolean { return this.humans().length <= 1; }

  private setPhase(p: Phase, dur: number): void {
    this.hs.phase = p;
    this.hs.timer = dur;
    void this.emit({ k: 'phase', p });
  }

  private beginOpen(): void {
    const hs = this.hs;
    hs.bets = zeroBets(); hs.locked = falses(); hs.sq = [-1, -1]; hs.coup = null; hs.out = null;
    hs.revealed = [[false, false], [false, false]]; hs.side = 0; hs.stage = 0; hs.sideTimer = 0;
    void this.emit({ k: 'bets', seats: zeroBets(), locked: falses() });
    const solo = this.isSolo();
    this.setPhase('open', solo ? 0 : OPEN_S);
    if (!solo) void this.countdown(OPEN_S, 'open');
    // Mirror charm: every seated player sees the top card privately
    if (this.tableMod('peekCharges', 0) > 0) {
      const next = hs.shoe.top();
      if (next) for (const h of this.humans()) void this.emitPrivate(h.pid, { k: 'peek', card: next });
    }
  }

  private startCoup(): void {
    this.cancelCountdown();
    this.setPhase('lock', LOCK_S);
  }

  /** Draws the coup (with the solo luck reroll, before anything is shown) and announces the squeezers. */
  private dealCoup(): void {
    const hs = this.hs;
    const backed: number[] = [];
    for (let s = 0; s < R.SPOT_COUNT; s++) if (hs.bets.some((b) => b[s] > 0)) backed.push(s);
    const pr = R.prepareCoup(hs.shoe, this.hostRng, { luck: this.isSolo() ? this.luck() : 0, backed });
    hs.coup = pr.coup;
    hs.out = pr.out;
    hs.sq = [R.squeezerFor('P', hs.bets), R.squeezerFor('B', hs.bets)];
    void this.emit({ k: 'shoe', remaining: hs.shoe.remaining, last: hs.shoe.atCut, shown: '' });
    void this.emit({ k: 'deal', sq: [...hs.sq] });
    this.setPhase('deal', DEAL_S);
  }

  /** One side's turn in SQUEEZE. A side nobody backed, or whose squeezer left, turns over at once. */
  private startSide(side: number): void {
    const hs = this.hs;
    hs.side = side;
    hs.phase = 'squeeze';
    const seat = hs.sq[side] >= 0 && this.seats[hs.sq[side]] !== null ? hs.sq[side] : -1;
    hs.sq[side] = seat;
    hs.sideTimer = seat >= 0 && !this.isSolo() ? SQUEEZE_S : Infinity;
    void this.emit({ k: 'side', side: sideKey(side), seat });
    if (seat < 0) this.revealSide(side);
  }

  private revealSide(side: number): void {
    for (let i = 0; i < 2; i++) this.revealCard(side, i);
    this.finishSide(side);
  }

  private finishSide(side: number): void {
    if (side === 0) this.startSide(1);
    else this.setPhase('reveal', REVEAL_S);
  }

  private skipAll(): void {
    const hs = this.hs;
    for (let s = hs.side; s < 2; s++) for (let i = 0; i < 2; i++) this.revealCard(s, i);
    hs.side = 2;
    this.setPhase('reveal', REVEAL_S);
  }

  private revealCard(side: number, idx: number): void {
    const hs = this.hs;
    if (!hs.coup || hs.revealed[side][idx]) return;
    hs.revealed[side][idx] = true;
    const cards = side === 0 ? hs.coup.p : hs.coup.b;
    void this.emit({ k: 'reveal', side: sideKey(side), idx, card: cards[idx] });
  }

  /** Stage 0 = Player third, 1 = Banker third, 2 = settle. Each third card is shown face up, one at a time. */
  private thirdsFrom(stage: number): void {
    const c = this.hs.coup!;
    if (stage === 0) {
      if (c.p.length === 3) { this.third(0, c.p[2]); this.holdThird(1); return; }
      stage = 1;
    }
    if (stage === 1) {
      if (c.b.length === 3) { this.third(1, c.b[2]); this.holdThird(2); return; }
    }
    this.settleCoup();
  }
  private third(side: number, card: CardId): void { void this.emit({ k: 'third', side: sideKey(side), card }); }
  private holdThird(stage: number): void { this.hs.stage = stage; this.setPhase('third', THIRD_S); }

  private afterPayout(): void {
    const hs = this.hs;
    if (hs.shoe.atCut) {
      hs.shoe.reshuffle();
      void this.emit({ k: 'shoe', remaining: hs.shoe.remaining, last: false, shown: hs.shoe.shown ?? '' });
      this.setPhase('shuffle', SHUFFLE_S);
    } else {
      this.beginOpen();
    }
  }

  /** Milestone and charm hooks, read on the host once per coup. */
  private payOpts(): R.PayOpts {
    return {
      commission: Math.max(0, R.COMMISSION + this.tableMod('rakeDelta', 0)),
      naturalBonus: this.mod('m.baccarat.naturalBonus', 0),
      tiePayAdd: this.mod('m.baccarat.tiePayAdd', 0),
      pairPayAdd: this.mod('m.baccarat.pairPayAdd', 0),
      tieSweetener: this.mod('m.baccarat.tieSweetener', 0) > 0,
      lucky6: this.feature('lucky6'),
      tie9: this.feature('tie9'),
    };
  }

  /** Settles every staked seat BEFORE the result is shown (MachineBase rule). */
  private settleCoup(): void {
    const hs = this.hs, out = hs.out!, pay = this.payOpts();
    const rows: number[][] = [];
    for (let seat = 0; seat < SEATS; seat++) {
      const bets = hs.bets[seat];
      const total = sumOf(bets);
      if (total <= 0) continue;
      let gross = 0, comm = 0;
      for (let s = 0; s < R.SPOT_COUNT; s++) {
        gross += R.spotReturn(s, bets[s], out, pay);
        comm += R.commissionOf(s, bets[s], out, pay);
      }
      const payout = R.roundCoins(gross, this.hostRng);
      this.paySeat(seat, payout, { bet: total });
      rows.push([seat, payout, Math.round(comm)]);
    }
    void this.emit({
      k: 'result', p: out.pt, b: out.bt, winner: out.winner, pairs: [out.pairP, out.pairB], natural: out.natural, seats: rows,
    });
    this.setPhase('result', RESULT_S);
  }

  /** A seat was vacated. Runs on every peer; the seat is already empty, so the pay helpers take the `pid`. */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    const hs = this.hs;
    if (this.isHost && hs) {
      if (hs.locked[seat] && (hs.phase === 'open' || hs.phase === 'lock')) {
        const total = sumOf(hs.bets[seat]);
        this.paySeat(seat, total, { bet: total, tier: 'push', tags: ['refund'] }, pid);
        hs.bets[seat] = [0, 0, 0, 0, 0];
        hs.locked[seat] = false;
        void this.emit({ k: 'bets', seats: zeroBets(), locked: falses() });
      }
      if (hs.phase === 'squeeze' && hs.sq[hs.side] === seat) this.revealSide(hs.side);
    }
    if (local) { this.drag = null; this.clearDraft(); }
    this.paintAll();
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) { this.sfx('chime'); this.showHud(); }
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
        if (ev.shown) {
          st.shown = ev.shown;
          st.road = [];
          this.paintRoad();
        }
        this.paintShoe();
        return;
      }
      case 'deal': {
        st.sq = [...ev.sq];
        st.cards = [['', ''], ['', '']];
        st.phase = 'deal';
        this.sfx('whoosh', { vol: 0.5 });
        // P1 B1 P2 B2, face down, slid out of the shoe mouth by the paddle
        const order: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (const [side, idx] of order) await this.dealOne(side, idx, fast, null);
        if (!fast && this.cosmetic.chance(1 / 40)) this.mirrorFigure();
        return;
      }
      case 'side': {
        st.phase = 'squeeze';
        if (ev.seat < 0) { this.overlay = null; return; }
        const side = sideIdx(ev.side);
        this.overlay = { side, seat: ev.seat };
        this.sfx('creak', { vol: 0.5 });
        for (let idx = 0; idx < 2; idx++) {
          const id = this.cardIds[side][idx];
          if (id >= 0) { p.cards.remove(id); this.cardIds[side][idx] = -1; }
          const m = p.squeezeCards[idx];
          m.position.copy(slotPos(ev.side, idx));
          m.rotation.set(-Math.PI / 2, 0, 0);
          m.scale.set(1, 1, 1);
          setFaceUV(m, this.ctx.kit, 'back');
          bendCard(m, 0);
          m.visible = true;
        }
        return;
      }
      case 'squeeze': {
        if (!this.overlay || this.overlay.side !== sideIdx(ev.side)) return;
        bendCard(p.squeezeCards[ev.idx], ev.bend);
        if (ev.bend > 0.05) this.sfx('creak', { vol: 0.2 + 0.5 * ev.bend });
        return;
      }
      case 'reveal': {
        const side = sideIdx(ev.side);
        st.cards[side][ev.idx] = ev.card;
        if (this.overlay && this.overlay.side === side) {
          const m = p.squeezeCards[ev.idx];
          let swapped = false;
          await this.anim(fast ? 0.01 : 0.36, (k) => {
            m.scale.x = Math.max(0.05, Math.abs(Math.cos(k * Math.PI)));
            if (k >= 0.5 && !swapped) { swapped = true; setFaceUV(m, this.ctx.kit, ev.card as CardId); }
          });
          m.scale.set(1, 1, 1);
          m.visible = false;
          this.cardIds[side][ev.idx] = p.cards.add(ev.card as CardId, slotPos(ev.side, ev.idx), 0);
          if (st.cards[side].every((c) => c !== '')) this.overlay = null;
        } else {
          const id = this.cardIds[side][ev.idx];
          if (id >= 0) {
            p.cards.setCard(id, ev.card as CardId);
            await p.cards.flip(id, fast ? 0.01 : 0.36);
          }
          this.sfx('cardFlip');
        }
        this.paintTotals();
        return;
      }
      case 'third': {
        const side = sideIdx(ev.side);
        st.cards[side][2] = ev.card;
        const id = p.cards.add(ev.card as CardId, shoeMouth(), 0);
        this.cardIds[side][2] = id;
        this.sfx('cardSlap');
        await p.cards.move(id, slotPos(ev.side, 2), fast ? 0.01 : 0.32, { arc: 0.06 });
        this.paintTotals();
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
    }
  }

  private async presentResult(ev: ResultEv, fast: boolean, pc: PresentCtx): Promise<void> {
    const p = this.model.parts, st = this.st;
    st.phase = 'result';
    st.win = ev.winner;
    st.road.push(ev.winner === 'P' ? 1 : ev.winner === 'B' ? 2 : 3);
    if (st.road.length > 72) st.road.shift();
    this.paintRoad();
    this.paintTotals();
    p.lamps.player.setOn(ev.winner === 'P');
    p.lamps.banker.setOn(ev.winner === 'B');
    if (ev.winner === 'T') { this.sfx('chime'); void this.wait(0.25).then(() => this.sfx('chime')); }
    if (ev.natural && (ev.p === 9 || ev.b === 9)) { this.sfx('stinger', { vol: 0.8 }); this.flashMirror(); }
    const mine = this.localSeat;
    for (const row of ev.seats) {
      const seat = row[0], payout = row[1];
      if (seat !== mine) continue;
      const stake = sumOf(st.bets[seat]);
      if (payout > 0) {
        const tier = juiceTier(payout, stake);
        const lamp: LampPart | undefined = ev.winner === 'P' ? p.lamps.player : ev.winner === 'B' ? p.lamps.banker : undefined;
        void this.celebrate(tier, {
          amount: payout, at: this.model.anchors.coinOut, lamps: lamp ? [lamp] : [], fast: pc.fast,
          restore: () => this.paintLamps(),
        });
        if (tier !== 'small' && tier !== 'push') void p.dealer.play('Interact', { fade: 0.2 }); // i18n-ok: clip id
        void this.pourCoins(payout, { bet: stake, fast });
      } else if (stake > 0) {
        this.commiserate({ at: this.model.anchors.coinOut });
      }
    }
    // the cards go to the discard tray; the bet chips are paid out and cleared at OPEN
    if (!fast) await this.wait(0.3);
    p.cards.clear();
    this.cardIds = [[-1, -1, -1], [-1, -1, -1]];
    this.paintShoe();
  }

  /** Turns one card from the shoe mouth to its slot, face down (or face up when `card` is given). */
  private async dealOne(side: number, idx: number, fast: boolean, card: CardId | null): Promise<void> {
    const p = this.model.parts;
    const id = p.cards.add(card, shoeMouth(), 0);
    this.cardIds[side][idx] = id;
    this.sfx('card');
    if (!fast) void this.anim(0.25, (k) => { p.paddle.rotation.x = -0.5 * Math.sin(k * Math.PI); });
    await p.cards.move(id, slotPos(sideKey(side), idx), fast ? 0.01 : 0.28, { arc: 0.05 });
  }

  /** Lights the mirror for two frames and pops the grin decal (the Overheat is not in v1). */
  private flashMirror(): void {
    const m = this.model.parts.mirror.material as THREE.MeshBasicMaterial;
    m.color.set(MIRROR_FLASH);
    void this.wait(0.07).then(() => m.color.set(MIRROR_OFF));
  }

  /** 1 coup in 40: a figure stands behind the player for half a second (visual only, not synced). */
  private mirrorFigure(): void {
    const f = this.model.parts.mirrorFigure;
    f.visible = true;
    void this.wait(0.5).then(() => { f.visible = false; });
    this.toast(this.t('mirrorFigure'), 'sys');
  }

  /** Clears the felt and the stakes ahead of the next OPEN. */
  private clearTable(): void {
    const p = this.model.parts;
    p.cards.clear();
    p.squeezeCards.forEach((m) => { m.visible = false; });
    this.cardIds = [[-1, -1, -1], [-1, -1, -1]];
    this.overlay = null;
    this.st.cards = [[], []];
    this.st.sq = [-1, -1];
    this.st.win = '';
    p.lamps.player.setOn(false);
    p.lamps.banker.setOn(false);
    this.paintTotals();
  }

  // ── snapshots (late joiners get the public state only) ─────────────────────────────────────────
  getSnapshot(_forPid?: PlayerId): Snap {
    const s = this.st;
    return {
      phase: s.phase, bets: s.bets.map((r) => [...r]), locked: [...s.locked], sq: [...s.sq],
      cards: s.cards.map((r) => [...r]), road: [...s.road], shoeLeft: s.shoeLeft, last: s.last, shown: s.shown, win: s.win,
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, bets: sn.bets.map((r) => [...r]), locked: [...sn.locked], sq: [...sn.sq],
      cards: sn.cards.map((r) => [...r]), road: [...sn.road], shoeLeft: sn.shoeLeft, last: sn.last, shown: sn.shown, win: sn.win,
    };
    this.paintAll();
    this.showHud();
  }

  // ── visuals ────────────────────────────────────────────────────────────────────────────────────
  override onLang(): void { this.paintRoad(); this.paintTotals(); this.showHud(); }

  /** Resting pose of every visual for `this.st` (idempotent). */
  private paintAll(): void {
    this.paintLamps();
    this.paintBets();
    this.paintRoad();
    this.paintTotals();
    this.paintShoe();
    const p = this.model.parts;
    p.cards.clear();
    this.cardIds = [[-1, -1, -1], [-1, -1, -1]];
    for (let side = 0; side < 2; side++) {
      this.st.cards[side].forEach((card, idx) => {
        this.cardIds[side][idx] = p.cards.add(card ? (card as CardId) : null, slotPos(sideKey(side), idx), 0);
      });
    }
  }

  private paintLamps(): void { this.model.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null)); }

  private paintBets(): void {
    const chips = this.model.parts.chips;
    for (let s = 0; s < SEATS; s++) {
      for (let k = 0; k < R.SPOT_COUNT; k++) {
        for (const id of this.betIds[s][k]) chips.remove(id);
        this.betIds[s][k] = [];
        const v = this.st.bets[s][k];
        if (v > 0) this.betIds[s][k] = chips.stack(chipsFor(v), spotPos(s, k));
      }
    }
  }

  private paintDraft(spot: number): void {
    const chips = this.model.parts.chips;
    for (const id of this.draftIds[spot]) chips.remove(id);
    this.draftIds[spot] = [];
    if (this.localSeat >= 0 && this.draft[spot] > 0) this.draftIds[spot] = chips.stack(chipsFor(this.draft[spot]), spotPos(this.localSeat, spot));
  }

  private clearDraft(): void {
    this.draft = [0, 0, 0, 0, 0];
    for (let k = 0; k < R.SPOT_COUNT; k++) this.paintDraft(k);
  }

  private paintShoe(): void {
    const p = this.model.parts;
    const used = Math.max(0, Math.min(1, (SHOE_CARDS - this.st.shoeLeft) / SHOE_CARDS));
    p.discardStack.scale.y = 0.2 + 0.8 * used;
    p.shoeLevel.scale.y = Math.max(0.1, this.st.shoeLeft / SHOE_CARDS);
  }

  /** Bead Plate (left, 12 columns of 6) and Big Road (right, 12 columns) on the 96 × 48 screen. */
  private paintRoad(): void {
    const beads = this.st.road;
    this.model.parts.roadmap.draw((g, w) => {
      g.fillStyle = '#06100a';
      g.fillRect(0, 0, w.w, w.h);
      const colour = (b: number): string => (b === 1 ? '#2c4c9c' : b === 2 ? '#c8102e' : '#3aa655');
      // bead plate: 6 rows, column-major, newest last
      beads.forEach((b, i) => {
        const col = Math.floor(i / 6) % 12, row = i % 6;
        g.fillStyle = colour(b);
        g.fillRect(2 + col * 4, 4 + row * 7, 3, 6);
      });
      // big road: one column per run of the same side, ties ignored (they only mark the run)
      const cols: Array<{ c: number; n: number }> = [];
      for (const b of beads) {
        if (b === 3) continue;
        const last = cols[cols.length - 1];
        if (last && last.c === b) last.n++;
        else cols.push({ c: b, n: 1 });
      }
      cols.slice(-12).forEach((col, x) => {
        for (let r = 0; r < Math.min(6, col.n); r++) {
          g.fillStyle = colour(col.c);
          g.fillRect(50 + x * 4, 4 + r * 7, 3, 6);
        }
      });
    });
  }

  private paintTotals(): void {
    const p = this.model.parts, st = this.st;
    const sum = (side: number): number => {
      const cards = st.cards[side].filter((c) => c !== '') as CardId[];
      return cards.length ? baccaratValue(cards) : 0;
    };
    const show = (screen: typeof p.totals.P, value: number, colour: string, label: string): void => {
      screen.draw((g, w) => {
        g.fillStyle = '#06100a';
        g.fillRect(0, 0, w.w, w.h);
        w.text(value > 0 ? String(value) : '', 16, 4, { font: 'px5', color: colour, align: 'center' });
        w.text(label, 16, 16, { font: 'px5', color: '#ffd040', align: 'center' });
      });
    };
    show(p.totals.P, sum(0), '#7aa2ff', 'P');
    show(p.totals.B, sum(1), '#ff6a5a', 'B');
  }

  // ── HUD and betting helpers ──────────────────────────────────────────────────────────────────────
  private nudge(spot: number, dir: 1 | -1): void {
    if (this.localSeat < 0) { this.toast(this.t('notSeated'), 'warn'); return; }
    const cur = this.draft[spot];
    const lim = R.LIMITS[spot];
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

  private showHud(): void {
    const s = this.st, seat = this.localSeat;
    const open = s.phase === 'open' && seat >= 0 && !s.locked[seat];
    const hints: HudHint[] = [];
    if (open) {
      hints.push(
        { action: 'primary', label: this.t('hLock') },
        { action: 'n1', label: this.t('hPlayer') },
        { action: 'n2', label: this.t('hBanker') },
        { action: 'n3', label: this.t('hTie') },
        { action: 'clear', label: this.t('hClear') },
      );
    }
    if (s.phase === 'squeeze' && this.overlay && seat >= 0 && s.sq[this.overlay.side] === seat) {
      hints.push({ action: 'primary', label: this.t('hSkip') });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    const stake = sumOf(this.draft);
    this.hud({
      bet: open ? this.bet : null,
      hints,
      stats: stake > 0 ? [{ label: this.t('potLabel'), value: fmtCoins(stake) }] : [],
    });
  }
}
