/**
 * Tombola Raffle Drum (`tombola`) — solo-occupant on a shared, persistent drum (MACHINES_tables §20, plan logicBrief).
 * A `TableBase` draw game (DECISIONS C21): one puller at a time, everyone else queues and watches, and the drum state
 * (tickets left, prize shelf) lives in the instance snapshot.
 *
 * Host flow: PAY (charge the price) → the player cranks (local) → PULL (the host draws one ticket; Spare Number may
 * draw two and keep the better) → the ticket HOLDS until it is unfolded (drag up / Space), the hold timer runs out or
 * the puller leaves; then the host settles it (winner paid before the announce, cubby emptied). FEEL drops a blank back
 * once per ticket. A restock (new drum, new shelf, the Widow refills for 6 s) runs when the drum is down to `restockAt`
 * tickets or the shelf is bare. Outcomes are decided on the host; clients only present them.
 *
 * Presentation (every peer): the drum squeaks and turns, the hatch swings, the number comes up on the counter ticket,
 * then the cubby lamp flashes and the tier show plays for the puller (a pop text for the rest). A blank gets the
 * Widow's head-shake; a restock pops the Widow up to clap.
 */
import type { KitX } from '@/kit';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, WIDOW_DOWN_Y, WIDOW_UP_Y, type TombolaParts } from './model';
import {
  CUBBIES, DEFAULT_RESTOCK_AT, DRUM, HOLD_S, MAX_STAKE, MIN_STAKE, PRIZE_MULT, RESTOCK_S,
  isWinner, liveEV, needsRestock, newDrum, newShelf, numberOf, playHeadless, priceOf, pullTicket, settle, slipBack,
  type PrizeId,
} from './rules';
import { STRINGS } from './tombola.strings';

// ── timing (seconds, ×1 speed) and feel ─────────────────────────────────────────────────────────
const SEATS = 1;
const CRANK_AUTO_S = 1.5;       // Space auto-crank
const CRANK_DRAG = 1.6;         // NDC distance of a pointer drag on the crank for one full turn
const UNFOLD_DRAG = 0.22;       // NDC rise of a drag up on the held ticket
const PULL_S = 0.6;
const BLANK_S = 0.8;
const PRIZE_S = 1.5;
const UNROLL_S = 0.5;           // the paper strip unrolls, its number ticking, before the result is written
// Hex for lamps and pop texts (fx), CSS for the canvas screens.
const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.tombola.' + k }));
const GOLD = 0xffd040, GREEN = 0x7dff7a, RED = 0xff6a5a;
const GOLD_CSS = '#ffd040', GREEN_CSS = '#7dff7a', RED_CSS = '#ff6a5a', CREAM = '#f3e7c4', DIM = '#a88a5a';
const LAMP_OFF = 0x2a2018;

// ── contract types ──────────────────────────────────────────────────────────────────────────────
type Ev =
  | { k: 'pay'; p: PlayerId; price: number }
  /** `hold`: seconds the held ticket waits before it unfolds on its own (the countdown ring shows it). */
  | { k: 'pull'; p: PlayerId; ticket: number; alt: number; lucky: boolean; remaining: number; hold: number }
  | { k: 'drop'; p: PlayerId; ticket: number; remaining: number }
  | { k: 'prize'; p: PlayerId; ticket: number; cubby: number; prize: PrizeId; gross: number; price: number; remaining: number }
  | { k: 'blank'; p: PlayerId; ticket: number; price: number; remaining: number }
  | { k: 'refund'; p: PlayerId; price: number }
  | { k: 'restock'; shelf: Array<PrizeId | null>; tickets: number; wait: number };
type Act = { k: 'pay'; stake: number } | { k: 'pull' } | { k: 'unfold' } | { k: 'feel' };
/** What every peer knows. Mutated only in `present`. `owner` = the player who paid and has not settled yet. */
type State = { remaining: number; shelf: Array<PrizeId | null>; owner: PlayerId | null; held: number | null };
type Snap = State;

/** Host-only authority: drum order, shelf, the paid ticket, the held ticket and the charges. */
type Hold = { p: PlayerId; ticket: number; price: number; t: number; felt: boolean };
type Paid = { p: PlayerId; price: number };

export default class Tombola extends TableBase<TombolaParts, Ev, Snap, Act> {
  private st: State = { remaining: DRUM, shelf: [], owner: null, held: null };
  private hs: {
    ready: boolean; drum: number[]; shelf: Array<PrizeId | null>; paid: Paid | null; hold: Hold | null;
    block: number; spare: number; peek: number;
  } = { ready: false, drum: [], shelf: [], paid: null, hold: null, block: 0, spare: 0, peek: 0 };

  // local presentation (this peer only)
  private cranked = false;
  /** The held ticket's hold countdown (presentation): seconds left, the full hold, and whether the ticket needs a repaint. */
  private ringLeft = 0;
  private ringTotal = 0;
  private ringDirty = false;
  private crankAuto = 0;
  private crankDrag = 0;
  private dragPrev: { x: number; y: number } | null = null;
  private dragging = false;
  private unfoldFrom: number | null = null;
  private spin = 0;
  private spinAngle = 0;
  /** Seat HUD overlay (goal, state, key numbers, controls, result callout, tip and rules cards). */
  private seatHud?: SeatHud;
  private hudSig = '';

  protected createModel(kit: KitX): MachineModel<TombolaParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  private get mine(): boolean { return this.st.owner !== null && this.st.owner === this.selfId; }
  private get restockAt(): number { return Math.max(0, Math.round(this.mod('m.tombola.restockAt' as ModHook, DEFAULT_RESTOCK_AT))); }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': this.primary(); break;   // Space: pay → auto-crank → pull → unfold
      case 'n4': this.feel(); break;           // 4: feel (drop a blank back once)
      default: break;
    }
  }

  /** LMB-drag circles on the crank; LMB on the hatch = pull; drag up on the held ticket = unfold. */
  onPointer(e: MachinePointerEvent): void {
    if (this.localSeat < 0) return;
    if (e.type === 'down' && e.button === 0) {
      if (this.mine && this.st.held !== null) { this.unfoldFrom = e.ndc.y; return; }
      if (this.mine && this.st.held === null && this.cranked && this.pick([this.parts.hatch])) { this.act({ k: 'pull' }); return; }
      if (this.mine && this.st.held === null && !this.cranked && this.pick([this.parts.crank.root])) {
        this.dragging = true; this.dragPrev = { x: e.ndc.x, y: e.ndc.y };
      }
      return;
    }
    if (e.type === 'move') {
      if (this.dragging && this.dragPrev) {
        this.crankDrag += Math.hypot(e.ndc.x - this.dragPrev.x, e.ndc.y - this.dragPrev.y);
        this.dragPrev = { x: e.ndc.x, y: e.ndc.y };
        this.spin += 0.35;
        if (this.crankDrag >= CRANK_DRAG) this.finishCrank();
      } else if (this.unfoldFrom !== null && e.ndc.y - this.unfoldFrom > UNFOLD_DRAG) {
        this.unfoldFrom = null;
        this.act({ k: 'unfold' });
      }
      return;
    }
    if (e.type === 'up') { this.dragging = false; this.dragPrev = null; this.unfoldFrom = null; }
  }

  /** Space: the next step of the ticket you own, or pay for one. */
  private primary(): void {
    if (this.localSeat < 0) return;
    if (this.mine) {
      if (this.st.held !== null) { this.act({ k: 'unfold' }); return; }
      if (!this.cranked) { this.crankAuto = CRANK_AUTO_S; this.sfx('click', { vol: 0.5 }); return; }
      this.act({ k: 'pull' });
      return;
    }
    if (this.st.owner !== null) { this.toast(tr('m.tombola.busy'), 'warn'); return; }
    this.act({ k: 'pay', stake: this.bet });
  }

  /** 4: feel the held ticket; only a blank can be dropped back (once per ticket, host decides). */
  private feel(): void {
    if (this.localSeat < 0) return;
    if (!this.mine || this.st.held === null) { this.toast(tr('m.tombola.noTicket'), 'warn'); return; }
    this.act({ k: 'feel' });
  }

  private finishCrank(): void {
    if (this.cranked) return;
    this.cranked = true;
    this.dragging = false;
    this.crankDrag = 0;
    this.crankAuto = 0;
    this.sfx('ratchet', { vol: 0.6 });
    void this.parts.crank.turn(1, 0.5);
    this.showHud();
  }

  // ── host: the drum ───────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    if (!this.hs.ready || this.hs.block > 0) { this.nak(pid, rid, 'm.tombola.busy'); return; }
    switch (a.k) {
      case 'pay': {
        if (this.hs.hold) { this.nak(pid, rid, 'm.tombola.busy'); return; }
        if (this.hs.paid) { this.nak(pid, rid, this.hs.paid.p === pid ? 'm.tombola.alreadyPaid' : 'm.tombola.busy'); return; }
        if (!Number.isInteger(a.stake) || a.stake < MIN_STAKE || a.stake > MAX_STAKE) { this.nak(pid, rid, 'm.tombola.badStake'); return; }
        const price = priceOf(a.stake, this.mod('m.tombola.priceMult' as ModHook, 1));
        if (!this.chargeSeat(seat, price, pid)) { this.nak(pid, rid, 'm.tombola.noFunds'); return; }
        this.hs.paid = { p: pid, price };
        void this.emit({ k: 'pay', p: pid, price });
        return;
      }
      case 'pull': {
        const paid = this.hs.paid;
        if (!paid || paid.p !== pid) { this.nak(pid, rid, 'm.tombola.payFirst'); return; }
        if (this.hs.hold) { this.nak(pid, rid, 'm.tombola.busy'); return; }
        const spare = this.hs.spare > 0;
        const out = pullTicket(this.hostRng, this.hs.drum, this.hs.shelf, { luck: this.luck(), spare });
        if (!out) { this.nak(pid, rid, 'm.tombola.busy'); return; }
        if (spare && out.alt >= 0) this.hs.spare--;
        this.hs.hold = { p: pid, ticket: out.ticket, price: paid.price, t: HOLD_S, felt: false };
        this.hs.paid = null;
        void this.emit({ k: 'pull', p: pid, ticket: out.ticket, alt: out.alt, lucky: out.lucky, remaining: this.hs.drum.length, hold: HOLD_S });
        return;
      }
      case 'unfold': {
        if (!this.hs.hold || this.hs.hold.p !== pid) { this.nak(pid, rid, 'm.tombola.noTicket'); return; }
        this.settleHold();
        return;
      }
      case 'feel': {
        const h = this.hs.hold;
        if (!h || h.p !== pid) { this.nak(pid, rid, 'm.tombola.noTicket'); return; }
        if (h.felt) { this.nak(pid, rid, 'm.tombola.feelUsed'); return; }
        if (settle(h.ticket, this.hs.shelf, h.price, this.mod('m.tombola.prizeMult' as ModHook, 1)).winner) { this.nak(pid, rid, 'm.tombola.feelNone'); return; }
        if (this.hs.peek <= 0) { this.nak(pid, rid, 'm.tombola.noCharge'); return; }
        this.hs.peek--;
        const old = h.ticket;
        slipBack(this.hostRng, this.hs.drum, old);
        const out = pullTicket(this.hostRng, this.hs.drum, this.hs.shelf, { luck: this.luck(), spare: false });
        if (!out) return;
        h.ticket = out.ticket; h.t = HOLD_S; h.felt = true;
        void this.emit({ k: 'drop', p: pid, ticket: old, remaining: this.hs.drum.length });
        void this.emit({ k: 'pull', p: pid, ticket: out.ticket, alt: -1, lucky: out.lucky, remaining: this.hs.drum.length, hold: HOLD_S });
        return;
      }
    }
  }

  /** Host: settle the held ticket (pay the winner and empty the cubby, or write the blank off). Restocks when due. */
  private settleHold(): void {
    const h = this.hs.hold;
    if (!h) return;
    this.hs.hold = null;
    const s = settle(h.ticket, this.hs.shelf, h.price, this.mod('m.tombola.prizeMult' as ModHook, 1));
    if (s.winner && s.prize) {
      this.hs.shelf[s.cubby] = null;
      this.paySeat(0, s.gross, { bet: h.price, tags: s.prize === 'grand' ? ['grand'] : [] }, h.p);
      void this.emit({ k: 'prize', p: h.p, ticket: h.ticket, cubby: s.cubby, prize: s.prize, gross: s.gross, price: h.price, remaining: this.hs.drum.length });
    } else {
      this.forfeit(0);
      void this.emit({ k: 'blank', p: h.p, ticket: h.ticket, price: h.price, remaining: this.hs.drum.length });
    }
    if (needsRestock(this.hs.drum.length, this.hs.shelf, this.restockAt)) this.restock(RESTOCK_S);
  }

  /** Host: a new drum and a new shelf; the Widow refills for `wait` seconds (the drum is blocked meanwhile). */
  private restock(wait: number): void {
    this.hs.drum = newDrum();
    this.hs.shelf = newShelf(this.hostRng);
    this.hs.spare = Math.max(0, Math.round(this.mod('m.tombola.doublePull' as ModHook, 0)));
    this.hs.peek = Math.max(0, Math.round(this.tableMod('peekCharges', 0)));
    this.hs.block = wait;
    this.hs.ready = true;
    void this.emit({ k: 'restock', shelf: [...this.hs.shelf], tickets: DRUM, wait });
  }

  /** Host timeline: first drum on the first step, the restock block and the auto-unfold timer. */
  hostTick(dt: number): void {
    if (!this.hs.ready) { this.restock(0); return; }
    if (this.hs.block > 0) this.hs.block = Math.max(0, this.hs.block - dt);
    const h = this.hs.hold;
    if (h) {
      h.t -= dt;
      if (h.t <= 0) this.settleHold();
    }
  }

  // ── seats ────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintQueue();
    if (local) {
      this.cranked = false;
      this.sfx('chime', { vol: 0.5 });
      this.hud(null);
      this.seatHud?.show();
      this.hudSig = '';
      this.showHud();
    }
  }

  onRelease(pid: PlayerId, _seat: number, local: boolean): void {
    if (this.isHost) {
      if (this.hs.hold && this.hs.hold.p === pid) this.settleHold();          // disconnect after PULL: unfolds and settles
      if (this.hs.paid && this.hs.paid.p === pid) {                            // paid but never pulled: refund
        const price = this.hs.paid.price;
        this.hs.paid = null;
        this.paySeat(0, price, { bet: price, silent: true }, pid);
        void this.emit({ k: 'refund', p: pid, price });
      }
    }
    if (local) {
      this.cranked = false; this.crankAuto = 0; this.crankDrag = 0; this.dragging = false;
      this.hud(null);
      this.seatHud?.hide();
    }
    this.paintQueue();
  }

  override onLang(): void {
    this.paintAll();
    this.hudSig = '';
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: public drum state only ────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return { remaining: this.st.remaining, shelf: [...this.st.shelf], owner: this.st.owner, held: this.st.held };
  }
  applySnapshot(sn: Snap): void {
    this.st = { remaining: sn.remaining, shelf: [...sn.shelf], owner: sn.owner, held: sn.held };
    this.paintAll();
  }

  // ── presentation (every peer) ────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'pay': await this.onPay(ev.p, ev.price, pc); return;
      case 'pull': await this.onPull(ev, pc); return;
      case 'drop': await this.onDrop(ev, pc); return;
      case 'prize': await this.onPrize(ev, pc); return;
      case 'blank': await this.onBlank(ev, pc); return;
      case 'refund': this.st.owner = null; this.paintAll(); return;
      case 'restock': await this.onRestock(ev, pc); return;
    }
  }

  private async onPay(p: PlayerId, price: number, pc: PresentCtx): Promise<void> {
    this.st.owner = p;
    this.st.held = null;
    if (p === this.selfId) this.cranked = false;
    this.sfx('chip', { vol: 0.7 });
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
    this.ctx.fx.popText(this.parts.drum, tr('m.tombola.pay', { n: fmtCoins(price) }), GOLD, { dur: 0.9, rise: 0.2 });
    if (!pc.fast) await this.wait(0.2);
  }

  private async onPull(ev: Extract<Ev, { k: 'pull' }>, pc: PresentCtx): Promise<void> {
    this.st.held = ev.ticket;
    this.st.remaining = ev.remaining;
    this.sfx('tileClack', { vol: 0.8 });
    this.spin += 6;
    if (!pc.fast) void this.anim(PULL_S, (k) => { this.parts.hatch.rotation.x = -Math.sin(k * Math.PI) * 0.9; });
    this.ringTotal = ev.hold; this.ringLeft = ev.hold; this.ringDirty = true;     // the countdown ring runs until the unfold
    this.paintPulled(ev.ticket, '');
    this.paintPaper();
    if (ev.alt >= 0) this.ctx.fx.popText(this.parts.pulled.mesh, tr('m.tombola.spare'), GOLD, { dur: 1.1, rise: 0.25 });
    if (ev.lucky) this.ctx.fx.popText(this.parts.pulled.mesh, tr('m.tombola.lucky'), GREEN, { dur: 1.1, rise: 0.25 });
    if (this.isLocalOccupant) this.showHud();
    if (!pc.fast) await this.wait(PULL_S);
  }

  private async onDrop(ev: Extract<Ev, { k: 'drop' }>, pc: PresentCtx): Promise<void> {
    this.st.held = null;
    this.st.remaining = ev.remaining;
    this.ringLeft = 0;
    this.sfx('click', { vol: 0.7 });
    this.ctx.fx.popText(this.parts.pulled.mesh, tr('m.tombola.dropped'), RED, { dur: 0.9, rise: 0.2 });
    this.paintAll();
    if (!pc.fast) await this.wait(0.4);
  }

  private async onPrize(ev: Extract<Ev, { k: 'prize' }>, pc: PresentCtx): Promise<void> {
    if (ev.p === this.selfId) this.seatHud?.result('win', ev.gross - ev.price, 1.5);
    this.st.owner = null;
    this.st.held = null;
    this.st.remaining = ev.remaining;
    this.st.shelf[ev.cubby] = null;
    await this.unroll(ev.ticket, pc.fast);
    const text = ev.prize === 'grand' ? tr('m.tombola.grand') : tr('m.tombola.win', { n: fmtCoins(ev.gross) });
    this.paintPulled(ev.ticket, text, GOLD_CSS);
    this.paintPaper(true);
    this.paintShelf();
    this.paintLeds();
    const cub = this.parts.cubbies[ev.cubby];
    cub.lamp.setColor(GOLD);
    cub.lamp.setOn(true);
    cub.lamp.blink(6, 0.8);
    this.sfx('chime', { pitch: ev.prize === 'grand' ? 12 : 6, vol: 0.9 });
    const at = this.parts.pulled.mesh;
    const tier = juiceTier(ev.gross, ev.price, ev.prize === 'grand' ? ['jackpot'] : []);
    this.ctx.fx.popText(at, text, ev.gross > ev.price ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
    if (ev.p === this.selfId) {
      void this.celebrate(tier, {
        amount: ev.gross, bet: ev.price, at, lamps: [cub.lamp], fast: pc.fast,
        restore: () => { this.paintAll(); },
      });
    }
    void this.clapWidow(pc.fast);
    if (!pc.fast) await this.wait(PRIZE_S);
    this.paintAll();
  }

  private async onBlank(ev: Extract<Ev, { k: 'blank' }>, pc: PresentCtx): Promise<void> {
    if (ev.p === this.selfId) this.seatHud?.result('lose', -ev.price, 1.5);
    this.st.owner = null;
    this.st.held = null;
    this.st.remaining = ev.remaining;
    await this.unroll(ev.ticket, pc.fast);
    this.paintPulled(ev.ticket, tr('m.tombola.blank'), RED_CSS);
    this.paintPaper(true);
    this.sfx('click', { vol: 0.6 });
    if (ev.p === this.selfId) this.commiserate({ at: this.parts.pulled.mesh });
    if (!pc.fast) await this.shakeWidow(BLANK_S);
    this.paintAll();
  }

  private async onRestock(ev: Extract<Ev, { k: 'restock' }>, pc: PresentCtx): Promise<void> {
    this.st.shelf = [...ev.shelf];
    this.st.remaining = ev.tickets;
    this.st.held = null;
    this.st.owner = null;
    this.sfx('bell', { vol: 0.8 });
    this.parts.leds.left.set(tr('m.tombola.restock'));
    this.paintShelf();
    this.paintPaper();
    if (!pc.fast) {
      await this.popWidow(true);
      await this.wait(Math.max(0, ev.wait - 0.7));
      await this.popWidow(false);
    }
    this.paintAll();
  }

  // ── widow and animation helpers ──────────────────────────────────────────────────────────────
  private popWidow(up: boolean): Promise<void> {
    const root = this.parts.widow.root;
    const from = up ? WIDOW_DOWN_Y : WIDOW_UP_Y, to = up ? WIDOW_UP_Y : WIDOW_DOWN_Y;
    return this.anim(0.35, (k) => { root.position.y = from + (to - from) * k; });
  }
  private async clapWidow(fast: boolean): Promise<void> {
    if (fast) return;
    await this.popWidow(true);
    const { handL, handR } = this.parts.widow;
    await this.anim(0.6, (k) => {
      const s = Math.abs(Math.sin(k * Math.PI * 6)) * 0.12;
      handL.position.x = -0.2 + s;
      handR.position.x = 0.2 - s;
    });
    handL.position.x = -0.2; handR.position.x = 0.2;
    await this.popWidow(false);
  }
  private async shakeWidow(sec: number): Promise<void> {
    await this.popWidow(true);
    const head = this.parts.widow.head;
    await this.anim(sec * 0.6, (k) => { head.rotation.y = Math.sin(k * Math.PI * 4) * 0.45; });
    head.rotation.y = 0;
    await this.popWidow(false);
  }

  // ── per-step visuals ─────────────────────────────────────────────────────────────────────────
  tick(dt: number): void {
    if (this.crankAuto > 0) {
      this.crankAuto -= dt;
      this.spin += 9 * dt;
      if (this.crankAuto <= 0) { this.crankAuto = 0; this.finishCrank(); }
    }
    this.spin *= Math.max(0, 1 - 2.5 * dt);
    this.spinAngle += this.spin * dt;
    this.parts.drum.rotation.x = this.spinAngle;
    // the held ticket's hold countdown runs down on the sim clock (the host unfolds it at zero)
    if (this.ringLeft > 0) {
      this.ringLeft = Math.max(0, this.ringLeft - dt);
      this.ringDirty = true;
    }
  }

  // ── painting ─────────────────────────────────────────────────────────────────────────────────
  private paintAll(): void {
    this.paintShelf();
    this.paintLeds();
    this.paintQueue();
    this.paintEV();
    this.paintPaper();
    if (this.isLocalOccupant) this.showHud();
  }

  private paintShelf(): void {
    for (let i = 0; i < CUBBIES; i++) this.paintCubby(i);
  }

  private paintCubby(i: number): void {
    const cub = this.parts.cubbies[i];
    const p = this.st.shelf[i] ?? null;
    cub.lamp.setColor(p ? GOLD : LAMP_OFF);
    cub.lamp.setOn(!!p);
    cub.icon.draw((g, sc) => {
      g.fillStyle = p ? '#6b4c1c' : '#3a2a1a';                 // lit cell: lighter than the cubby frame so every slot reads
      g.fillRect(0, 0, sc.w, sc.h);
      sc.text(String(numberOf(i)).padStart(2, '0'), sc.w / 2, 3, { font: 'px5', color: p ? CREAM : DIM, align: 'center' });
      if (p) sc.text(tr('m.tombola.prizeShort', { n: PRIZE_MULT[p] }), sc.w / 2, 16, { font: 'px5', color: GOLD_CSS, align: 'center' });
      else sc.text('--', sc.w / 2, 16, { font: 'px5', color: DIM, align: 'center' });
    });
  }

  private paintLeds(): void {
    this.parts.leds.left.set(String(this.st.remaining).padStart(3, '0'));
  }

  private paintQueue(): void {
    this.parts.queueLamp.setOn(this.st.owner !== null && !this.mine);
  }

  /** Live-EV needle: shown only when the tycoon feature `evGauge` is unlocked (milestone L10). */
  private paintEV(): void {
    const board = this.parts.evNeedle.parent;
    if (board) board.visible = this.feature('tombola.evGauge');
    const ev = Math.min(2, liveEV(this.st.remaining, this.st.shelf));
    this.parts.evNeedle.rotation.z = -Math.min(1.2, ev * 0.6);
  }

  /**
   * Counter ticket face: the number, and the outcome text once revealed. `ring` is the hold countdown as a fraction left
   * (0 = no ring): a gold arc that shrinks clockwise from the top.
   */
  private paintPulled(ticket: number, text: string, color: string = CREAM, ring = 0): void {
    this.parts.pulled.draw((g, sc) => {
      g.fillStyle = '#efe3c0'; g.fillRect(0, 0, sc.w, sc.h);
      g.fillStyle = '#7a1d1d'; g.fillRect(0, 0, sc.w, 9);
      sc.text(tr('m.tombola.ticket', { n: '' }).trim(), 3, 1, { font: 'px5', color: CREAM });
      sc.text(String(ticket).padStart(2, '0'), sc.w / 2, 14, { font: 'px5', color: '#1a1206', align: 'center' });
      if (text) sc.text(text, sc.w / 2, 32, { font: 'px5', color, align: 'center' });
      if (ring > 0) {
        g.beginPath();
        g.arc(sc.w - 10, 22, 6, -Math.PI / 2, -Math.PI / 2 + ring * Math.PI * 2);
        g.strokeStyle = GOLD_CSS; g.lineWidth = 2; g.stroke();
      }
    });
  }

  /** Render: repaint the held ticket with its countdown ring when the clock moved. */
  frame(_dt: number, _t: number): void {
    if (!this.ringDirty) return;
    this.ringDirty = false;
    if (this.st.held !== null) this.paintPulled(this.st.held, '', CREAM, this.ringTotal > 0 ? this.ringLeft / this.ringTotal : 0);
  }

  /**
   * The paper strip unrolls over ~0.5 s while its number ticks through digits, then the result is written. Presentation
   * only: the ticket was settled by the host before this event.
   */
  private async unroll(ticket: number, fast: boolean): Promise<void> {
    this.ringLeft = 0;
    if (fast) return;
    let step = -1;
    await this.anim(UNROLL_S, (k) => {
      this.parts.pulledMesh.scale.y = 0.15 + 0.85 * k;
      const n = Math.floor(k * 10);
      if (n !== step) { step = n; this.sfx('tileClack', { vol: 0.35, pitch: n }); }
      const shown = k < 0.9 ? (ticket * 17 + n * 37) % 100 : ticket;
      this.paintPulled(shown, '');
    }, 'outQuad');
    this.parts.pulledMesh.scale.y = 1;
  }

  /** The counter ticket is visible while one is held (or while its outcome is shown, `keep`). */
  private paintPaper(keep = false): void {
    const shown = this.st.held !== null || keep;
    this.parts.pulledMesh.visible = shown;
    if (!shown) this.parts.hatch.rotation.x = 0;
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Banner, key numbers and valid controls for the local player. Redraws only when something changed. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const held = this.st.held, mine = this.mine, owned = this.st.owner !== null;
    const wallet = this.ctx.run.wallet();
    const price = priceOf(this.bet, this.mod('m.tombola.priceMult' as ModHook, 1));
    const sig = [mine, owned, held, this.cranked, this.st.remaining, this.bet, Math.round(liveEV(this.st.remaining, this.st.shelf) * 100), wallet].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    sh.goal({ k: 'm.tombola.goal' });

    // STATE: pay, crank, pull, unfold, or someone else's ticket
    if (mine && held !== null) sh.state({ k: 'm.tombola.stUnfold' }, 'warn', { k: 'm.tombola.stUnfoldSub', v: { n: held } });
    else if (mine && !this.cranked) sh.state({ k: 'm.tombola.stCrank' }, 'gold');
    else if (mine) sh.state({ k: 'm.tombola.stPull' }, 'good');
    else if (owned) sh.state({ k: 'm.tombola.stOther' }, 'cyan');
    else sh.state({ k: 'm.tombola.stPay' }, 'gold');

    // KEY NUMBERS
    const nums: HudNumber[] = [
      { label: { k: 'm.tombola.nPrice' }, value: fmtCoins(price), tone: 'gold' },
      { label: { k: 'm.tombola.nLeft' }, value: String(this.st.remaining), tone: 'cyan' },
      { label: { k: 'm.tombola.nEV' }, value: `${Math.round(liveEV(this.st.remaining, this.st.shelf) * 100)}%`, tone: 'neutral' },
    ];
    if (held !== null) nums.push({ label: { k: 'm.tombola.nTicket' }, value: String(held), tone: isWinner(held) ? 'good' : 'neutral' });
    nums.push({ label: { k: 'm.tombola.nBalance' }, value: fmtCoins(wallet), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only the one next step, plus feel, the stake and the help keys
    const ctrl: HudControl[] = [];
    if (mine && held !== null) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.tombola.cUnfold' }, action: 'confirm', primary: true });
      if (!isWinner(held)) ctrl.push({ key: this.k('n4'), label: { k: 'm.tombola.cFeel' }, action: 'n4' });
    } else if (mine && !this.cranked) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.tombola.cCrank' }, action: 'confirm', primary: true });
    } else if (mine) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.tombola.cPull' }, action: 'confirm', primary: true });
    } else if (!owned) {
      ctrl.push({ key: this.k('confirm'), label: { k: 'm.tombola.cPay', v: { n: fmtCoins(price) } }, action: 'confirm', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.tombola.cStake' }, action: 'betUp' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.tombola.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.tombola.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

// ── contract ────────────────────────────────────────────────────────────────────────────────────
export { playHeadless };

export const def: MachineDef = {
  id: 'tombola',
  category: 'lottery',
  slotSize: 'L',
  zone: 'wheels',
  seats: SEATS,
  shared: true,
  tier: 3,
  minBet: MIN_STAKE, maxBet: MAX_STAKE,
  maxPayoutMult: 60,
  rtp: 0.9,
  actionCost: 1,
  tags: ['lottery', 'draw', 'solo', 'shared'],
  headless: playHeadless,
  modHooks: {
    'm.tombola.priceMult': 'float: scales the ticket price charged for a bet (prizes scale with it)',
    'm.tombola.doublePull': 'int charges: Spare Number, pull two tickets and keep the better (per restock)',
    'm.tombola.prizeMult': 'float on coin prizes only',
    'm.tombola.restockAt': 'int: restock when this many tickets (or fewer) remain; default 30',
    'x.table.peekCharges': 'int charges: FEEL drops a blank back once per ticket (per restock)',
    luck: 'solo: a blank is slipped back and another pulled with p = luck/100',
  },
  strings: STRINGS,
};
