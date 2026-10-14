/**
 * Keno Lounge (`keno`) — shared draw device, 4 desks (MACHINES_tables §12, plan logicBrief). Tickets keep running after
 * the player leaves (multi-draw), so the device is a `TableBase` that settles every ticket by player id.
 *
 * Host timeline: shared lounge = one draw every 25 s while any ticket is live (sales close 3 s before LOCK); solo =
 * a draw on demand (Space), multi-draw tickets repeat after the previous draw has been presented. LOCK charges each
 * live ticket's stake, the pure rules in `rules.ts` roll the 20 numbers, and every payout is credited BEFORE the
 * announce events. Presentation (every peer): LOCK bell → relay clacks, one lamp per number → tickets stamp hits
 * → tier celebration / pop text / near-miss beat.
 *
 * Juice: anticipation (bell, NEXT led counts down) → action (relay clack per number, board lamps light) → impact
 * (hit lamps flash, a ding per local hit stepping up a pentatonic scale) → follow-through (pop text, tier show, jackpot
 * chase on the relay brain, commiseration or near-miss).
 */
import type { KitX } from '@/kit';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierTags, toWinTier } from '@/machines/_base/tiers';
import { buildModel, commitBoard, setLamp, LAMP_DRAWN, LAMP_OFF, type KenoParts } from './model';
import {
  DRAWN, DRAW_COUNTS, MAX_STAKE, MIN_STAKE, identity, playHeadless, quickPick, runDraw, validPicks, weightsFor,
  type Adjust,
} from './rules';
import { STRINGS } from './keno.strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const SEATS = 4;
const SLOTS = 4;               // tickets per player (one per slot)
const CYCLE_S = 25;            // shared lounge: one draw per cycle while any ticket is live
const SALES_CLOSE_S = 22;      // sales close 3 s before LOCK
const LOCK_S = 0.5;
const TALLY_S = 1.0;
const PAYOUT_S = 2.5;
const STEP_SHARED_MS = 450;    // 20 numbers = 9.0 s
const STEP_SOLO_MS = 200;
const GOLD = 0xffd040, GREEN = 0x7dff7a, CREAM = '#f3e7c4', DIM = '#3d6b4f';

// CRT grid (160 × 120 canvas): 10 × 8 numbers under a header
const GX0 = 4, GY0 = 13, CW = 15.6, CH = 11.8;

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Phase = 'idle' | 'open' | 'lock' | 'draw' | 'payout';
type Ev =
  | { k: 'ticket'; p: PlayerId; slot: number; picks: number[]; stake: number; draws: number }
  | { k: 'drop'; p: PlayerId; slot: number }
  | { k: 'close'; drawNo: number; t: number }
  | { k: 'draw'; drawNo: number; numbers: number[]; stepMs: number; extraP: PlayerId; extra: number[] }
  | { k: 'result'; p: PlayerId; slot: number; hits: number; payout: number; spots: number; stake: number; nearmiss: boolean; top: boolean; last: boolean };
type Act = { k: 'submit'; slot: number; picks: number[]; stake: number; draws: number };
type LiveTicket = { p: PlayerId; slot: number; picks: number[]; stake: number; left: number };
/** What every peer knows (public board and live tickets). Mutated only in `present`. */
type State = { phase: Phase; drawNo: number; last: number[]; tickets: LiveTicket[] };
type Snap = State;
/** Host-only authority: live tickets (keyed `pid:slot`) and the shared cycle clock. */
type Tk = { p: PlayerId; slot: number; picks: number[]; stake: number; left: number };
/** Local draft of one ticket slot (presentation only). */
type Draft = { picks: number[]; live: boolean };

const keyOf = (p: PlayerId, slot: number): string => `${p}:${slot}`;
const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.keno.' + k }));
const drawSecs = (stepMs: number): number => LOCK_S + (DRAWN * stepMs) / 1000 + TALLY_S + PAYOUT_S;

export default class KenoLounge extends TableBase<KenoParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', drawNo: 0, last: [], tickets: [] };
  private hs: { drawNo: number; clock: number; wait: number; tickets: Map<string, Tk>; cd: boolean } =
    { drawNo: 0, clock: 0, wait: 0, tickets: new Map(), cd: false };
  /** Local only: the four ticket slots of the seated player. */
  private draft: Draft[] = Array.from({ length: SLOTS }, (): Draft => ({ picks: [], live: false }));
  private slot = 0;
  private spotTarget = 4;
  private drawIdx = 0;
  /** Seat HUD overlay (goal, state, key numbers, controls, result callout, tip and rules cards). */
  private seatHud?: SeatHud;
  private hudSig = '';

  protected createModel(kit: KitX): MachineModel<KenoParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'n1': this.quickPick(); break;                                    // 1: Quick Pick to the spot count
      case 'n2': this.cycleSpots(); break;                                   // 2: spot count 1–10
      case 'n3': this.cycleDraws(); break;                                   // 3: draws ×1/5/10/20
      case 'n4': this.nextSlot(); break;                                     // 4: next ticket slot
      case 'clear': this.clearDraft(); break;                                // Backspace
      case 'confirm': this.submit(); break;                                  // Space: play / submit
      default: break;
    }
  }

  /** LMB toggles a number on the CRT grid; RMB removes it. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || this.localSeat < 0) return;
    const desk = this.parts.desks[this.localSeat];
    const hit = this.pick([desk.screen.mesh]);
    if (!hit || !hit.uv) return;
    const px = hit.uv.x * desk.screen.w;
    const py = (1 - hit.uv.y) * desk.screen.h;
    const col = Math.floor((px - GX0) / CW), row = Math.floor((py - GY0) / CH);
    if (col < 0 || col > 9 || row < 0 || row > 7) return;
    this.toggle(row * 10 + col + 1, e.button === 2);
  }

  private get cur(): Draft { return this.draft[this.slot]; }

  private toggle(n: number, remove: boolean): void {
    const d = this.cur;
    if (d.live) { this.toast(tr('m.keno.busy'), 'warn'); return; }
    const i = d.picks.indexOf(n);
    if (i >= 0) d.picks.splice(i, 1);
    else if (remove) return;
    else if (d.picks.length < this.spotTarget) d.picks.push(n);
    else { this.toast(tr('m.keno.limit'), 'warn'); return; }
    this.sfx('click');
    this.paintDesks();
    this.showHud();
  }

  private quickPick(): void {
    if (this.localSeat < 0 || this.cur.live) return;
    this.cur.picks = quickPick(this.cosmetic, this.spotTarget);
    this.sfx('chip', { vol: 0.5 });
    this.paintDesks();
    this.showHud();
  }
  private cycleSpots(): void {
    if (this.localSeat < 0 || this.cur.live) return;
    this.spotTarget = (this.spotTarget % 10) + 1;
    if (this.cur.picks.length > this.spotTarget) this.cur.picks.length = this.spotTarget;
    this.sfx('click'); this.paintDesks(); this.showHud();
  }
  private cycleDraws(): void {
    if (this.localSeat < 0) return;
    this.drawIdx = (this.drawIdx + 1) % DRAW_COUNTS.length;
    this.sfx('click'); this.showHud();
  }
  private nextSlot(): void {
    if (this.localSeat < 0) return;
    this.slot = (this.slot + 1) % SLOTS;
    this.sfx('click'); this.paintDesks(); this.showHud();
  }
  private clearDraft(): void {
    if (this.localSeat < 0 || this.cur.live) return;
    this.cur.picks = [];
    this.sfx('click'); this.paintDesks(); this.showHud();
  }
  private submit(): void {
    if (this.localSeat < 0) return;
    const d = this.cur;
    if (d.live) { this.toast(tr('m.keno.busy'), 'warn'); return; }
    if (!d.picks.length) { this.toast(tr('m.keno.noPicks'), 'warn'); return; }
    this.act({ k: 'submit', slot: this.slot, picks: [...d.picks], stake: this.bet, draws: DRAW_COUNTS[this.drawIdx] });
  }

  // ── host: tickets and the shared cadence ──────────────────────────────────────────────────────
  /** Solo = at most one seated human (draw on demand, multi-draw repeats after the previous draw). */
  private solo(): boolean { return this.humans().length <= 1; }

  protected onAction(pid: PlayerId, _seat: number, a: Act, rid: number): void {
    if (a.k !== 'submit') return;
    const { slot, picks, stake, draws } = a;
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) { this.nak(pid, rid, 'm.keno.badSlot'); return; }
    if (!validPicks(picks)) { this.nak(pid, rid, 'm.keno.badPicks'); return; }
    if (!Number.isInteger(stake) || stake < MIN_STAKE || stake > MAX_STAKE) { this.nak(pid, rid, 'm.keno.badStake'); return; }
    if (!(DRAW_COUNTS as readonly number[]).includes(draws)) { this.nak(pid, rid, 'm.keno.badDraws'); return; }
    const solo = this.solo();
    if (!solo && this.hs.clock >= SALES_CLOSE_S) { this.nak(pid, rid, 'm.keno.busy'); return; }

    const k = keyOf(pid, slot);
    this.hs.tickets.set(k, { p: pid, slot, picks: [...picks], stake, left: draws });
    if (!solo && !this.hs.cd) {
      this.hs.cd = true;
      void this.countdown(Math.max(0.1, SALES_CLOSE_S - this.hs.clock), 'sales');
    }
    void this.emit({ k: 'ticket', p: pid, slot, picks: [...picks], stake, draws });
    if (solo && this.hs.wait <= 0) this.lock();                              // SP: draw now
  }

  /** Host timeline: shared = every CYCLE_S while tickets are live; solo = after the previous draw was presented. */
  hostTick(dt: number): void {
    const hs = this.hs;
    if (hs.tickets.size === 0) { hs.clock = 0; hs.wait = 0; return; }
    if (this.solo()) {
      hs.wait -= dt;
      if (hs.wait <= 0) this.lock();
      return;
    }
    hs.clock += dt;
    if (hs.clock >= CYCLE_S) { hs.clock -= CYCLE_S; this.lock(); }
  }

  /** Host: LOCK → charge every live ticket, draw once, pay every ticket, then announce the whole draw to every peer. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    hs.cd = false;
    const live: Tk[] = [];
    for (const [k, t] of [...hs.tickets]) {
      if (!this.ctx.run.hostBet(t.p, t.stake, this.src)) {
        hs.tickets.delete(k);
        this.nak(t.p, 0, 'm.keno.noFunds');
        void this.emit({ k: 'drop', p: t.p, slot: t.slot });
        continue;
      }
      live.push(t);
    }
    if (!live.length) { hs.wait = 0; return; }

    hs.drawNo += 1;
    const owners = new Set(live.map((t) => t.p));
    const soloDraw = owners.size <= 1;                     // spot weights and luck apply to solo draws only
    const adj: Adjust = (name, base) => this.mod(`m.keno.${name}` as ModHook, base);
    const out = runDraw(this.hostRng, live.map((t) => ({ picks: t.picks, stake: t.stake, owner: t.p === this.selfId })), {
      weights: weightsFor(soloDraw ? adj : identity),
      extraN: Math.max(0, Math.round(this.mod('m.keno.extraNumber' as ModHook, 0))),
      luck: soloDraw ? this.luck() : 0,
      adj,
    });

    const stepMs = soloDraw ? STEP_SOLO_MS : STEP_SHARED_MS;
    void this.emit({ k: 'close', drawNo: hs.drawNo, t: this.ctx.net.hostTime() });
    void this.emit({ k: 'draw', drawNo: hs.drawNo, numbers: out.drawn, stepMs, extraP: this.selfId, extra: out.extra });

    live.forEach((t, i) => {
      const o = out.tickets[i];
      const tags = o.top ? ['jackpot'] : [];
      const jt = juiceTier(o.gross, t.stake, tags);
      if (o.gross > 0) {
        this.ctx.run.hostWin(t.p, o.gross, this.src, {
          bet: t.stake, tier: toWinTier(jt), tags: [...new Set([...tags, ...tierTags(jt)])],
        });
      }
      t.left -= 1;
      const last = t.left <= 0;
      void this.emit({
        k: 'result', p: t.p, slot: t.slot, hits: o.hits, payout: o.gross, spots: o.spots, stake: t.stake,
        nearmiss: o.nearmiss, top: o.top, last,
      });
      if (last) hs.tickets.delete(keyOf(t.p, t.slot));
    });
    // solo multi-draw: the next lock waits for this draw to be presented, plus 1.5 s
    hs.wait = hs.tickets.size ? drawSecs(stepMs) + 1.5 : 0;
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'ticket': this.putTicket(ev.p, ev.slot, ev.picks, ev.stake, ev.draws); return;
      case 'drop': this.dropTicket(ev.p, ev.slot); return;
      case 'close': await this.onClose(ev.drawNo, pc); return;
      case 'draw': await this.onDraw(ev.drawNo, ev.numbers, ev.stepMs, ev.extra, pc); return;
      case 'result': await this.onResult(ev, pc); return;
    }
  }

  private putTicket(p: PlayerId, slot: number, picks: number[], stake: number, draws: number): void {
    this.st.tickets = [...this.st.tickets.filter((x) => !(x.p === p && x.slot === slot)), { p, slot, picks, stake, left: draws }];
    if (p === this.selfId) this.draft[slot].live = true;
    this.sfx('chip', { vol: 0.6 });
    this.paintDesks();
    this.paintRail();
    if (this.isLocalOccupant) this.showHud();
  }

  private dropTicket(p: PlayerId, slot: number): void {
    this.st.tickets = this.st.tickets.filter((x) => !(x.p === p && x.slot === slot));
    if (p === this.selfId) this.draft[slot].live = false;
    this.paintDesks();
    this.paintRail();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Anticipation: the bell, relays arm, the NEXT led shows LOCK. */
  private async onClose(drawNo: number, pc: PresentCtx): Promise<void> {
    this.st.phase = 'lock';
    this.st.drawNo = drawNo;
    this.sfx('bell');
    this.parts.leds.next.set(tr('m.keno.lock'));
    for (const l of this.parts.relayLamps) { l.setColor(LAMP_OFF); l.setOn(false); }
    this.paintBoard();
    this.paintDesks();
    if (this.isLocalOccupant) this.showHud();
    if (!pc.fast) await this.wait(LOCK_S);
  }

  /** Action: one relay clack and one lamp per number, the local player's hits blink as they land. */
  private async onDraw(drawNo: number, numbers: number[], stepMs: number, extra: number[], pc: PresentCtx): Promise<void> {
    this.st.phase = 'draw';
    this.st.last = [...numbers];
    const mine = new Set<number>();
    for (const t of this.st.tickets) if (t.p === this.selfId) t.picks.forEach((n) => mine.add(n));
    let hitsSoFar = 0;
    const step = pc.fast ? 0 : stepMs / 1000;
    for (let i = 0; i < numbers.length; i++) {
      const n = numbers[i];
      const relay = this.parts.relayLamps[i];
      relay.setColor(LAMP_DRAWN);
      relay.setOn(true);
      setLamp(this.parts.board, n, 'drawn');
      commitBoard(this.parts.board);
      this.parts.leds.next.set(String(n));
      this.sfx('tileClack', { vol: 0.8 });
      if (mine.has(n)) {
        hitsSoFar++;
        this.sfx('chime', { pitch: Math.min(12, hitsSoFar * 2), vol: 0.7 });
        relay.blink(6, 0.4);
      }
      if (step) await this.wait(step);
    }
    for (const n of extra) setLamp(this.parts.board, n, 'drawn');
    commitBoard(this.parts.board);
    this.parts.leds.drawNo.set(String(drawNo % 1000).padStart(3, '0'));
    this.paintDesks();
  }

  /** Follow-through: each ticket stamps its hits; the local player gets the tier show, others a pop text. */
  private async onResult(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'payout';
    const seat = this.seats.indexOf(ev.p);
    const tk = this.st.tickets.find((x) => x.p === ev.p && x.slot === ev.slot);
    const picks = tk?.picks ?? [];
    const mine = ev.p === this.selfId;
    const at = seat >= 0 ? this.parts.desks[seat].screen.mesh : this.parts.boardScreen.mesh;

    if (mine) {
      for (const n of picks) if (this.st.last.includes(n)) setLamp(this.parts.board, n, 'hit');
      commitBoard(this.parts.board);
      this.draft[ev.slot].live = !ev.last;
    }
    if (ev.payout > 0) {
      const tags = ev.top ? ['jackpot'] : [];
      const tier = juiceTier(ev.payout, ev.stake, tags);
      const text = ev.top ? tr('m.keno.jackpot') : tr('m.keno.win', { n: fmtCoins(ev.payout) });
      this.ctx.fx.popText(at, text, ev.payout > ev.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
      if (mine) {
        void this.celebrate(tier, {
          amount: ev.payout, at, lamps: this.parts.relayLamps, fast: pc.fast,
          restore: () => { this.paintBoard(); this.paintDesks(); },
        });
      }
    } else if (mine) {
      if (ev.nearmiss) void this.nearMiss({ at });
      else this.commiserate({ at });
    }

    if (ev.last) this.st.tickets = this.st.tickets.filter((x) => !(x.p === ev.p && x.slot === ev.slot));
    else this.st.tickets = this.st.tickets.map((x) => (x.p === ev.p && x.slot === ev.slot ? { ...x, left: x.left - 1 } : x));
    this.st.phase = 'open';
    this.paintDesks();
    this.paintRail();
    if (mine) {
      const net = ev.payout - ev.stake;
      this.seatHud?.result(ev.top ? 'win' : ev.payout === 0 ? 'lose' : net === 0 ? 'even' : net > 0 ? 'win' : 'lose', net, 1.5);
      this.showHud();
    }
    if (!pc.fast) await this.wait(0.3);
  }

  // ── snapshots: public board and live tickets only ─────────────────────────────────────────────
  getSnapshot(): Snap {
    return { phase: this.st.phase, drawNo: this.st.drawNo, last: [...this.st.last], tickets: this.st.tickets.map((t) => ({ ...t, picks: [...t.picks] })) };
  }
  applySnapshot(sn: Snap): void {
    this.st = { phase: sn.phase, drawNo: sn.drawNo, last: [...sn.last], tickets: sn.tickets.map((t) => ({ ...t, picks: [...t.picks] })) };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintDesks();
    this.paintRail();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.hud(null);
      this.seatHud?.show();
      this.hudSig = '';
      this.showHud();
      this.seatHud?.firstTip('keno', this.tipLines());
    }
  }
  onRelease(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintDesks();
    this.paintRail();
    if (local) { this.hud(null); this.seatHud?.hide(); }
  }

  override onLang(): void {
    this.paintAll();
    this.hudSig = '';
    if (this.isLocalOccupant) this.showHud();
  }

  /** The NEXT led counts down the shared sales window while it runs (visual only). */
  frame(_dt: number, _t: number): void {
    if (this.timerState && this.st.phase === 'open') this.parts.leds.next.set(String(Math.ceil(this.timerLeft)).padStart(4, ' '));
    if (this.isLocalOccupant) this.showHud();              // cheap: only redraws the HUD when its content changed
  }

  // ── painting ──────────────────────────────────────────────────────────────────────────────────
  private paintAll(): void {
    for (const t of this.st.tickets) if (t.p === this.selfId) this.draft[t.slot].live = true;
    this.paintBoardScreen();
    this.paintBoard();
    this.paintDesks();
    this.paintRail();
  }

  /** Number backdrop: 1–80 in the top strip of each cell, the lamp sits below. */
  private paintBoardScreen(): void {
    this.parts.boardScreen.draw((g, sc) => {
      g.fillStyle = '#0b0f0c'; g.fillRect(0, 0, sc.w, sc.h);
      for (let n = 1; n <= 80; n++) {
        const col = (n - 1) % 10, row = Math.floor((n - 1) / 10);
        sc.text(String(n), col * 16 + 8, row * 12, { font: 'px5', color: '#c9b98a', align: 'center' });
      }
    });
  }

  private paintBoard(): void {
    const lit = new Set(this.st.last);
    for (let n = 1; n <= 80; n++) setLamp(this.parts.board, n, lit.has(n) ? 'drawn' : 'off');
    commitBoard(this.parts.board);
  }

  private paintDesks(): void {
    for (let i = 0; i < SEATS; i++) {
      const mine = i === this.localSeat;
      const pid = this.seats[i];
      const tk = mine || pid === null ? undefined : this.st.tickets.find((x) => x.p === pid);
      const picks = mine ? this.cur.picks : (tk?.picks ?? []);
      const stake = mine ? this.bet : (tk?.stake ?? 0);
      const draws = mine ? DRAW_COUNTS[this.drawIdx] : (tk?.left ?? 0);
      const live = mine ? this.cur.live : !!tk;
      const head = mine ? tr('m.keno.ticket', { n: this.slot + 1 }) : (live ? tr('m.keno.live') : tr('m.keno.empty'));
      const sel = new Set(picks);
      this.parts.desks[i].screen.draw((g, sc) => {
        g.fillStyle = '#0b1a12'; g.fillRect(0, 0, sc.w, sc.h);
        g.fillStyle = '#143524'; g.fillRect(0, 0, sc.w, 12);
        sc.text(head, 4, 2, { font: 'px5', color: live ? CREAM : DIM });
        for (let n = 1; n <= 80; n++) {
          const col = (n - 1) % 10, row = Math.floor((n - 1) / 10);
          const x = GX0 + col * CW, y = GY0 + row * CH;
          const on = sel.has(n);
          g.fillStyle = on ? '#e8c35a' : '#0f2a1c';
          g.fillRect(x, y, CW - 1.5, CH - 1.5);
          sc.text(String(n), x + CW / 2, y + 2, { font: 'px5', color: on ? '#1a1206' : '#6f9f80', align: 'center' });
        }
        sc.text(`${picks.length}/${this.spotTarget}  ${fmtCoins(stake)} x${draws}`, 4, 110, { font: 'px5', color: CREAM });   // inside the 120 px canvas (the 7 px glyphs were cut at 114)
      });
    }
    this.paintLeds();
  }

  private paintLeds(): void {
    if (this.st.phase !== 'lock' && this.st.phase !== 'draw' && !this.timerState) this.parts.leds.next.set('----');
  }

  private paintRail(): void {
    for (let i = 0; i < SEATS; i++) {
      const pid = this.seats[i];
      const has = pid !== null && this.st.tickets.some((x) => x.p === pid);
      this.parts.railMeters[i].setOn(has);
      this.parts.seatLamps[i].setOn(pid !== null);
    }
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.keno.tip1' },
      { k: 'm.keno.tip2', v: { quick: this.k('n1'), spots: this.k('n2'), clear: this.k('clear') } },
      { k: 'm.keno.tip3', v: { play: this.k('confirm'), help: this.k('help') } },
    ];
  }

  /** Banner, key numbers and valid controls for the local player. Redraws only when something changed. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const seat = this.localSeat, d = this.cur, phase = this.st.phase;
    const mine = this.st.tickets.find((x) => x.p === this.selfId && x.slot === this.slot);
    const live = d.live || mine !== undefined;
    const left = this.timerState && phase === 'open' ? Math.ceil(this.timerLeft) : 0;
    const wallet = this.ctx.run.wallet();
    const sig = [phase, seat, this.bet, this.drawIdx, this.spotTarget, this.slot, d.picks.join(','), live, left, this.st.drawNo, wallet, mine?.left ?? 0].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    sh.goal({ k: 'm.keno.goal' });

    // STATE: what phase the draw is in, and what the player should do
    const secs: Txt | undefined = left > 0 ? { k: 'm.keno.stSecs', v: { n: left } } : undefined;
    if (phase === 'lock') sh.state({ k: 'm.keno.stLock' }, 'warn');
    else if (phase === 'draw') sh.state({ k: 'm.keno.stDraw' }, 'neutral');
    else if (phase === 'payout') sh.state({ k: 'm.keno.stPay' }, 'neutral');
    else if (live) sh.state({ k: 'm.keno.stLive' }, 'cyan', mine ? { k: 'm.keno.stLeft', v: { n: mine.left } } : secs);
    else if (d.picks.length > 0) sh.state({ k: 'm.keno.stReady' }, 'good', secs);
    else sh.state({ k: 'm.keno.stPick' }, 'gold', secs);

    // KEY NUMBERS
    const nums: HudNumber[] = [
      { label: { k: 'm.keno.nPicks' }, value: `${d.picks.length}/${this.spotTarget}`, tone: d.picks.length > 0 ? 'good' : 'gold' },
      { label: { k: 'm.keno.nStake' }, value: fmtCoins(this.bet), tone: 'gold' },
      { label: { k: 'm.keno.nDraws' }, value: `x${DRAW_COUNTS[this.drawIdx]}`, tone: 'cyan' },
      { label: { k: 'm.keno.nSlot' }, value: `${this.slot + 1}/${SLOTS}`, tone: 'neutral' },
      { label: { k: 'm.keno.nBalance' }, value: fmtCoins(wallet), tone: 'neutral' },
    ];
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (!live) {
      if (d.picks.length > 0) ctrl.push({ key: this.k('confirm'), label: { k: 'm.keno.cPlay' }, action: 'confirm', primary: true });
      ctrl.push({ key: this.k('n1'), label: { k: 'm.keno.cQuick' }, action: 'n1' });
      ctrl.push({ key: this.k('n2'), label: { k: 'm.keno.cSpots' }, action: 'n2' });
      if (d.picks.length > 0) ctrl.push({ key: this.k('clear'), label: { k: 'm.keno.cClear' }, action: 'clear' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.keno.cBet' }, action: 'betUp' });
    }
    ctrl.push({ key: this.k('n3'), label: { k: 'm.keno.cDraws' }, action: 'n3' });
    ctrl.push({ key: this.k('n4'), label: { k: 'm.keno.cSlot' }, action: 'n4' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.keno.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.keno.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

// ── contract ──────────────────────────────────────────────────────────────────────────────────
export { playHeadless };

export const def: MachineDef = {
  id: 'keno',
  category: 'lottery',
  slotSize: 'L',
  zone: 'laundry',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: MIN_STAKE, maxBet: MAX_STAKE, betSteps: [1, 2, 5, 10, 20, 50, 100],
  maxPayoutMult: 200000,
  rtp: 0.944,
  actionCost: 1,
  tags: ['table', 'draw', 'social', 'shared'],
  headless: playHeadless,
  modHooks: {
    'm.keno.spotWeight.n': 'int add to one number weight (base 100), n = 1..80; solo draws only',
    'm.keno.payAdd.S.H': 'float add to the paytable cell for S spots and H hits',
    'm.keno.zeroHitPay': 'float: 0 hits pays this on 8+ spots',
    'm.keno.extraNumber': 'int: extra public numbers drawn after the 20, counted for the owner only',
    luck: 'solo only: reroll a non-paying draw once with p = luck/100',
  },
  strings: STRINGS,
};
