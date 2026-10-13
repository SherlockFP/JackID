/**
 * Lotto Ball Blower "The Breath" (`lottoblower`) — shared draw device, 4 standing spots at the kiosk (MACHINES_tables §19,
 * plan logicBrief). Tickets keep running for the whole draw cycle, so the device is a `TableBase` that settles every
 * ticket by player id.
 *
 * Host timeline: shared (2+ humans) = one draw every 120 s while any line is bought; the CLOSE countdown runs for the
 * last 10 s, and the draw is rolled ahead of time so a Moon peek (charm) can be sent before close. Solo = the draw runs
 * when the lever is pulled. Lines are charged at LOCK. The host holds the progressive jackpot pool: 8 % of every paid
 * line feeds it and the pool is split equally between the winning lines, then reset to its seed.
 *
 * Presentation (every peer): bell → blower breath (balls tumble) → valve thunk per ball, each ball rises the tube into
 * the rack, a chime per matched ball → Moon sphere blows and the Moon ball joins the rack → jackpot siren and gold flood →
 * tickets stamp their hits and the local player gets the tier show, a pop text or the commiseration.
 */
import * as THREE from 'three';
import type { KitX } from '@/kit';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier, tierTags, toWinTier } from '@/machines/_base/tiers';
import { MOON_C, MOON_R, SPHERE_C, SPHERE_R, buildModel, rackXY, type LottoParts } from './model';
import {
  FEED, JACKPOT_SEED, MAIN_PICK, MAIN_POOL, MAX_BET, MAX_LINES, MIN_BET, MOON_POOL, QUICK_BATCHES, drawBalls, identity,
  mainWeights, moonWeights, playHeadless, quickLine, runDraw, splitJackpot, validLine,
  type Adjust, type Draw, type Line, type TicketIn,
} from './rules';
import { STRINGS } from './lottoblower.strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const SEATS = 4;
const CYCLE_S = 120;                 // shared: one draw per cycle while any line is live
const CLOSE_S = 10;                  // pit-wide CLOSE countdown before the cycle locks
const CLOSE_AT = CYCLE_S - CLOSE_S;
const LOCK_S = 0.6;
const BLOW_S = 3.0;
const BALL_S = 1.6;                  // per ball: rise the tube and settle in the rack (the spec's 3 s per draw, shortened)
const MOON_S = 5.0;
const RESULT_S = 5.0;
const STEPS = 12;
const GOLD = 0xffd040, GREEN = 0x7dff7a;
const GOLD_CSS = '#ffd040', CREAM = '#f3e7c4', DIM = '#6b5a3a';
const SIREN_S = 2.0;

// CRT grid (160 × 120 canvas): 6 × 5 main numbers, then the Moon row 1–8
const MX0 = 14, MY0 = 14, MCW = 22, MCH = 11, MCOLS = 6, MROWS = 5;
const OX0 = 16, OY0 = 76, OCW = 16, OCH = 11;

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Phase = 'idle' | 'open' | 'close' | 'blow' | 'draw' | 'moon' | 'payout';
type Ev =
  | { k: 'buy'; p: PlayerId; lines: number[][]; bet: number }
  | { k: 'drop'; p: PlayerId }
  | { k: 'pool'; jackpot: number }
  | { k: 'peek'; moon: number }
  | { k: 'close'; drawNo: number; t: number }
  | { k: 'draw'; drawNo: number; main: number[]; moon: number; extra: number[]; extraP: PlayerId }
  | { k: 'jackpot'; winners: Array<{ p: PlayerId; amount: number }> }
  | {
      k: 'result'; p: PlayerId; bet: number; charged: number; payout: number; jp: number;
      hits: number[]; moons: number[]; pays: number[]; nearmiss: boolean; refund: boolean; lucky: boolean;
    };
type Act = { k: 'buy'; lines: number[][]; bet: number; pull: boolean };
/** Public line, as every peer sees it (six numbers: five main then the Moon). */
type PubTicket = { p: PlayerId; lines: number[][]; bet: number };
/** What every peer knows. Mutated only in `present`. */
type State = {
  phase: Phase; drawNo: number; last: number[]; moon: number; extra: number[]; pool: number; peek: number;
  tickets: PubTicket[]; result: string;
};
type Snap = State;
/** Host-only authority: live tickets (one per player), the shared cadence clock, the rolled draw and the pool. */
type Tk = { p: PlayerId; lines: Line[]; paid: number; bet: number };

const extraCount = (adj: Adjust): number => Math.max(0, Math.round(adj('extraBall', 0)));
const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Grid hit test on the kiosk CRT: a main number (1–30) or a Moon (1–8). */
function gridHit(px: number, py: number): { moon: boolean; v: number } | null {
  const c = Math.floor((px - MX0) / MCW), r = Math.floor((py - MY0) / MCH);
  if (px >= MX0 && c < MCOLS && py >= MY0 && r < MROWS) return { moon: false, v: r * MCOLS + c + 1 };
  const oc = Math.floor((px - OX0) / OCW);
  if (px >= OX0 && oc < MOON_POOL && py >= OY0 && py < OY0 + OCH) return { moon: true, v: oc + 1 };
  return null;
}

/** Point at fraction `u` (0..1) along a polyline, by arc length. */
function alongPath(pts: THREE.Vector3[], u: number): THREE.Vector3 {
  if (pts.length === 1) return pts[0].clone();
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  let d = Math.max(0, Math.min(1, u)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1]);
    if (d <= seg || i === pts.length - 1) return pts[i - 1].clone().lerp(pts[i], seg > 0 ? Math.min(1, d / seg) : 0);
    d -= seg;
  }
  return pts[pts.length - 1].clone();
}

export default class LottoBlower extends TableBase<LottoParts, Ev, Snap, Act> {
  private st: State = {
    phase: 'idle', drawNo: 0, last: [], moon: 0, extra: [], pool: JACKPOT_SEED, peek: 0, tickets: [], result: '',
  };
  private hs: { drawNo: number; clock: number; peeked: boolean; tickets: Map<PlayerId, Tk>; pending: Draw | null; pool: number } =
    { drawNo: 0, clock: 0, peeked: false, tickets: new Map(), pending: null, pool: JACKPOT_SEED };
  /** Local only: committed lines of the seated player, the draft line and the batch size. */
  private lines: number[][] = [];
  private picks: number[] = [];
  private moonPick = 0;
  private batchIdx = 0;
  /** Local only: which drawn ball is in the air (HUD) and per-line hit stamps of the local ticket. */
  private drawIdx = 0;
  private stamps: number[] = [];
  private sphereHex = 0xbdf7ef;
  /** Last known ball positions (animation start points); `null` = never placed. */
  private ballAt: Array<THREE.Vector3 | null> = Array.from({ length: MAIN_POOL }, (): THREE.Vector3 | null => null);
  private moonAt: Array<THREE.Vector3 | null> = Array.from({ length: MOON_POOL }, (): THREE.Vector3 | null => null);

  protected createModel(kit: KitX): MachineModel<LottoParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.sphereHex = (this.parts.sphere.material as THREE.MeshBasicMaterial).color.getHex();
    this.paintAll();
  }

  // ── local input → action to the host ──────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.paintKiosk(); this.showHud();
        break;
      case 'n1': this.quickPick(); break;                                    // 1: Quick Pick one line
      case 'n2': this.addLine(); break;                                      // 2: commit the draft as a line
      case 'n3': this.quickBatch(); break;                                   // 3: Quick Pick a batch of lines
      case 'n4': this.cycleBatch(); break;                                   // 4: batch size ×5 / ×10 / ×20
      case 'clear': this.clearDraft(); break;                                // Backspace
      case 'confirm': this.submit(); break;                                  // Space: buy (MP) / pull the lever (SP)
      default: break;
    }
  }

  /** LMB toggles a number on the CRT; RMB removes it. LMB on the DRAW lever submits the lines. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || this.localSeat < 0) return;
    if (this.pick([this.parts.lever.root])) { void this.parts.lever.pull(); this.submit(); return; }
    const screen = this.parts.kioskScreen;
    const hit = this.pick([screen.mesh]);
    if (!hit || !hit.uv) return;
    const h = gridHit(hit.uv.x * screen.w, (1 - hit.uv.y) * screen.h);
    if (!h) return;
    if (h.moon) this.setMoon(h.v, e.button === 2);
    else this.toggle(h.v, e.button === 2);
  }

  private toggle(n: number, remove: boolean): void {
    const i = this.picks.indexOf(n);
    if (i >= 0) this.picks.splice(i, 1);
    else if (remove) return;
    else if (this.picks.length < MAIN_PICK) this.picks.push(n);
    else { this.toast(tr('m.lottoblower.lineFull'), 'warn'); return; }
    this.sfx('click');
    this.paintKiosk();
    this.showHud();
  }

  private setMoon(n: number, remove: boolean): void {
    this.moonPick = remove || this.moonPick === n ? 0 : n;
    this.sfx('click');
    this.paintKiosk();
    this.showHud();
  }

  private quickPick(): void {
    if (this.localSeat < 0 || this.lines.length >= MAX_LINES) return;
    const q = quickLine(this.cosmetic);
    this.lines.push([...q.picks, q.moon]);
    this.sfx('chip', { vol: 0.5 });
    this.paintKiosk();
    this.showHud();
  }

  private quickBatch(): void {
    if (this.localSeat < 0) return;
    const n = QUICK_BATCHES[this.batchIdx];
    for (let i = 0; i < n && this.lines.length < MAX_LINES; i++) {
      const q = quickLine(this.cosmetic);
      this.lines.push([...q.picks, q.moon]);
    }
    this.sfx('chip', { vol: 0.6 });
    this.paintKiosk();
    this.showHud();
  }

  private cycleBatch(): void {
    if (this.localSeat < 0) return;
    this.batchIdx = (this.batchIdx + 1) % QUICK_BATCHES.length;
    this.sfx('click');
    this.showHud();
  }

  private addLine(): void {
    if (this.localSeat < 0) return;
    if (this.picks.length !== MAIN_PICK) { this.toast(tr('m.lottoblower.noPicks'), 'warn'); return; }
    if (!this.moonPick) { this.toast(tr('m.lottoblower.noMoonPick'), 'warn'); return; }
    if (this.lines.length >= MAX_LINES) { this.toast(tr('m.lottoblower.limit'), 'warn'); return; }
    this.lines.push([...this.picks].sort((a, b) => a - b).concat(this.moonPick));
    this.picks = [];
    this.moonPick = 0;
    this.sfx('chip', { vol: 0.6 });
    this.paintKiosk();
    this.showHud();
  }

  private clearDraft(): void {
    if (this.localSeat < 0) return;
    if (this.picks.length || this.moonPick) { this.picks = []; this.moonPick = 0; }
    else if (this.lines.length) this.lines.pop();
    else return;
    this.sfx('click');
    this.paintKiosk();
    this.showHud();
  }

  /** Buys every committed line (a complete draft is committed first). SP: the pull starts the draw at once. */
  private submit(): void {
    if (this.localSeat < 0) return;
    if (this.picks.length === MAIN_PICK && this.moonPick) this.addLine();
    else if (this.picks.length || this.moonPick) { this.toast(tr('m.lottoblower.noPicks'), 'warn'); return; }
    if (!this.lines.length) { this.toast(tr('m.lottoblower.noLines'), 'warn'); return; }
    this.act({ k: 'buy', lines: this.lines.map((l) => [...l]), bet: this.bet, pull: this.humans().length <= 1 });
  }

  // ── host: tickets and the shared cadence ──────────────────────────────────────────────────────
  /** Solo = at most one seated human (the lever starts the draw). */
  private solo(): boolean { return this.humans().length <= 1; }

  protected onAction(pid: PlayerId, _seat: number, a: Act, rid: number): void {
    if (a.k !== 'buy') return;
    const { lines, bet, pull } = a;
    if (!Number.isInteger(bet) || bet < MIN_BET || bet > MAX_BET) { this.nak(pid, rid, 'm.lottoblower.badBet'); return; }
    if (!Array.isArray(lines) || lines.length < 1) { this.nak(pid, rid, 'm.lottoblower.noLines'); return; }
    if (lines.length > MAX_LINES) { this.nak(pid, rid, 'm.lottoblower.limit'); return; }
    const parsed: Line[] = [];
    for (const row of lines) {
      if (!Array.isArray(row) || row.length !== MAIN_PICK + 1) { this.nak(pid, rid, 'm.lottoblower.badLine'); return; }
      const l: Line = { picks: row.slice(0, MAIN_PICK).map(Number).sort((x, y) => x - y), moon: Number(row[MAIN_PICK]) };
      if (!validLine(l)) { this.nak(pid, rid, 'm.lottoblower.badLine'); return; }
      parsed.push(l);
    }
    const solo = this.solo();
    if (!solo && this.hs.clock >= CLOSE_AT) { this.nak(pid, rid, 'm.lottoblower.busy'); return; }

    this.hs.tickets.set(pid, { p: pid, lines: parsed, paid: parsed.length, bet });
    if (!solo && !this.hs.pending) this.hs.pending = this.predraw();
    void this.emit({ k: 'buy', p: pid, lines: parsed.map((l) => [...l.picks, l.moon]), bet });
    if (solo && pull) this.lock();
  }

  /** Host timeline: shared = every CYCLE_S while lines are live (CLOSE countdown for the last 10 s); solo = on the lever. */
  hostTick(dt: number): void {
    const hs = this.hs;
    if (hs.tickets.size === 0) { hs.clock = 0; hs.peeked = false; hs.pending = null; return; }
    if (this.solo()) return;
    hs.clock += dt;
    if (!hs.peeked && hs.clock >= CLOSE_AT) {
      hs.peeked = true;
      void this.countdown(Math.max(0.1, CYCLE_S - hs.clock), 'close');
      if (this.tableMod('peekCharges', 0) >= 1 && hs.pending) {
        for (const pid of hs.tickets.keys()) void this.emitPrivate(pid, { k: 'peek', moon: hs.pending.moon });
      }
    }
    if (hs.clock >= CYCLE_S) { hs.clock = 0; hs.peeked = false; this.lock(); }
  }

  /** Shared cadence: the ball draw is rolled early (before close) so a Moon peek can be shown. Never used in solo. */
  private predraw(): Draw {
    const adj: Adjust = (name, base) => this.mod(`x.lottoblower.${name}` as ModHook, base);
    return drawBalls(this.hostRng, mainWeights(), moonWeights(), extraCount(adj));
  }

  /** Host: LOCK → charge every live ticket, draw once, feed and pay the pool, pay every ticket, then announce the draw. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    hs.peeked = false;
    const live: Tk[] = [];
    for (const tk of hs.tickets.values()) {
      if (!this.ctx.run.hostBet(tk.p, tk.paid * tk.bet, this.src)) {
        this.nak(tk.p, 0, 'm.lottoblower.noFunds');
        void this.emit({ k: 'drop', p: tk.p });
        continue;
      }
      live.push(tk);
    }
    const pending = hs.pending;
    hs.pending = null;
    hs.tickets.clear();
    if (!live.length) return;

    hs.drawNo += 1;
    const solo = new Set(live.map((t) => t.p)).size <= 1;
    const adj: Adjust = (name, base) => this.mod(`x.lottoblower.${name}` as ModHook, base);
    const tickets: TicketIn[] = live.map((tk) => {
      const mine = tk.p === this.selfId;
      let lines = tk.lines;
      if (mine) {
        const free = Math.max(0, Math.round(adj('freeLine', 0)));
        const extra: Line[] = [];
        for (let i = 0; i < free; i++) extra.push(quickLine(this.hostRng));
        lines = [...lines, ...extra];
      }
      return { lines, paid: tk.paid, bet: tk.bet, owner: mine, luck: mine ? this.luck() : 0 };
    });
    const out = runDraw(this.hostRng, tickets, {
      mainW: mainWeights(),
      moonW: moonWeights(solo ? adj : identity),
      extraN: extraCount(adj),
      solo,
      adj,
      pre: solo ? undefined : pending ?? undefined,
    });
    const draw = out.draw;

    // progressive jackpot: feed first (this draw's stakes count), then split the pool between the winning lines
    for (const tk of live) hs.pool += FEED * tk.paid * tk.bet;
    const jpWeights = out.tickets.map((o, i) => {
      const share = live[i].p === this.selfId ? 1 + Math.max(0, adj('jackpotShare', 0)) : 1;
      return o.jackpotLines * share;
    });
    const won = Math.floor(hs.pool);
    const jp = jpWeights.some((w) => w > 0) ? splitJackpot(won, jpWeights) : jpWeights.map(() => 0);
    if (jp.some((x) => x > 0)) hs.pool = JACKPOT_SEED;

    const winners: Array<{ p: PlayerId; amount: number }> = [];
    live.forEach((tk, i) => {
      const o = out.tickets[i];
      const share = jp[i] ?? 0;
      const payout = o.gross + share;
      if (share > 0) winners.push({ p: tk.p, amount: share });
      if (payout > 0) {
        const tags = share > 0 ? ['jackpot'] : [];
        if (o.refund || out.rerolled) tags.push('lucky');
        const jt = juiceTier(payout, o.charged, tags);
        this.ctx.run.hostWin(tk.p, payout, this.src, {
          bet: o.charged, tier: toWinTier(jt), tags: [...new Set([...tags, ...tierTags(jt)])],
        });
      }
    });

    void this.emit({ k: 'close', drawNo: hs.drawNo, t: this.ctx.net.hostTime() });
    void this.emit({ k: 'draw', drawNo: hs.drawNo, main: draw.main, moon: draw.moon, extra: draw.extra, extraP: this.selfId });
    if (winners.length) void this.emit({ k: 'jackpot', winners });
    void this.emit({ k: 'pool', jackpot: Math.floor(hs.pool) });
    live.forEach((tk, i) => {
      const o = out.tickets[i];
      void this.emit({
        k: 'result', p: tk.p, bet: tk.bet, charged: o.charged, payout: o.gross + (jp[i] ?? 0), jp: jp[i] ?? 0,
        hits: o.lines.map((l) => l.main), moons: o.lines.map((l) => (l.moon ? 1 : 0)), pays: o.lines.map((l) => l.gross),
        nearmiss: o.nearmiss, refund: o.refund, lucky: out.rerolled,
      });
    });
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'buy': this.putTicket(ev.p, ev.lines, ev.bet); return;
      case 'drop': this.dropTicket(ev.p); return;
      case 'pool': this.st.pool = ev.jackpot; this.paintCounter(); return;
      case 'peek': this.st.peek = ev.moon; this.paintKiosk(); return;
      case 'close': await this.onClose(ev.drawNo, pc); return;
      case 'draw': await this.onDraw(ev, pc); return;
      case 'jackpot': await this.onJackpot(ev, pc); return;
      case 'result': await this.onResult(ev, pc); return;
    }
  }

  private putTicket(p: PlayerId, lines: number[][], bet: number): void {
    this.st.tickets = [...this.st.tickets.filter((x) => x.p !== p), { p, lines, bet }];
    this.sfx('chip', { vol: 0.6 });
    if (this.isLocalOccupant) this.showHud();
    this.paintKiosk();
  }

  private dropTicket(p: PlayerId): void {
    this.st.tickets = this.st.tickets.filter((x) => x.p !== p);
    if (p === this.selfId) this.toast(tr('m.lottoblower.noFunds'), 'warn');
    this.paintKiosk();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Anticipation: the bell, the lamps arm, the CLOSE countdown reads on the HUD. */
  private async onClose(drawNo: number, pc: PresentCtx): Promise<void> {
    this.st.phase = 'close';
    this.st.drawNo = drawNo;
    this.st.peek = 0;
    this.st.result = '';
    this.stamps = [];
    this.sfx('bell');
    this.parts.leds.bet.blink(6, 1.2);
    this.paintKiosk();
    this.paintWinners();
    if (this.isLocalOccupant) this.showHud();
    if (!pc.fast) await this.wait(LOCK_S);
  }

  /** Action: the blower breathes, each ball rises the tube into the rack; the Moon follows. */
  private async onDraw(ev: Extract<Ev, { k: 'draw' }>, pc: PresentCtx): Promise<void> {
    this.st.last = [...ev.main];
    this.st.moon = ev.moon;
    this.st.extra = [...ev.extra];
    this.st.phase = 'blow';
    this.sfx('whoosh');
    this.resetBalls();
    await this.stir(pc, BLOW_S);
    this.st.phase = 'draw';
    const mine = new Set<number>();
    for (const t of this.st.tickets) if (t.p === this.selfId) for (const l of t.lines) for (const n of l.slice(0, MAIN_PICK)) mine.add(n);
    let hitsSoFar = 0;
    for (let i = 0; i < ev.main.length; i++) {
      const n = ev.main[i];
      this.drawIdx = i + 1;
      this.sfx('thud', { vol: 0.6 });                                       // valve thunk
      if (mine.has(n)) {
        hitsSoFar++;
        this.sfx('chime', { pitch: Math.min(12, hitsSoFar * 2), vol: 0.7 });
      }
      await this.flyBall(n - 1, i, pc);
      this.paintWinners();
      this.paintKiosk();
    }
    this.st.phase = 'moon';
    this.sfx('whoosh', { vol: 0.8 });
    this.resetMoon();
    await this.stirMoon(pc, MOON_S * 0.5);
    await this.flyMoon(ev.moon - 1, pc);
    this.paintWinners();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Follow-through for the jackpot: siren, gold flood of the sphere, pit-wide pop text. */
  private async onJackpot(ev: Extract<Ev, { k: 'jackpot' }>, pc: PresentCtx): Promise<void> {
    this.sfx('jackpot');
    const mat = this.parts.sphere.material as THREE.MeshBasicMaterial;
    mat.color.setHex(GOLD);
    for (const w of ev.winners) {
      const at = w.p === this.selfId ? this.parts.kioskScreen.mesh : this.parts.sphere;
      this.ctx.fx.popText(at, tr('m.lottoblower.jackpot'), GOLD, { dur: 2, rise: 0.5 });
      if (w.p === this.selfId) void this.celebrate('jackpot', { amount: w.amount, at, lamps: [], fast: pc.fast, restore: () => this.paintAll() });
    }
    this.st.result = tr('m.lottoblower.jackpot');
    this.paintWinners();
    if (!pc.fast) await this.wait(SIREN_S);
    mat.color.setHex(this.sphereHex);
  }

  /** Each ticket stamps its hits; the local player gets the tier show, others a pop text. */
  private async onResult(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'payout';
    const seat = this.seats.indexOf(ev.p);
    const mine = ev.p === this.selfId;
    const at = seat >= 0 ? this.parts.kioskScreen.mesh : this.parts.winners.mesh;
    if (mine) {
      const paid = this.st.tickets.find((x) => x.p === ev.p)?.lines.length ?? 0;
      this.stamps = ev.hits.slice(0, paid);
      this.paintKiosk();
    }
    if (ev.payout > 0) {
      const tags = ev.jp > 0 ? ['jackpot'] : [];
      const tier = juiceTier(ev.payout, ev.charged, tags);
      const text = ev.jp > 0 ? tr('m.lottoblower.jackpot') : tr('m.lottoblower.win', { n: fmtCoins(ev.payout) });
      this.ctx.fx.popText(at, text, ev.payout > ev.charged ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
      if (mine) void this.celebrate(tier, { amount: ev.payout, at, lamps: [], fast: pc.fast, restore: () => this.paintKiosk() });
      if (mine) this.st.result = ev.jp > 0 ? tr('m.lottoblower.jackpot') : tr('m.lottoblower.win', { n: fmtCoins(ev.payout) });
    } else if (mine) {
      if (ev.nearmiss) void this.nearMiss({ at });
      else this.commiserate({ at });
      this.st.result = tr('m.lottoblower.zeroPay');
    }
    if (ev.refund && mine) this.toast(tr('m.lottoblower.refund', { n: fmtCoins(ev.charged) }), 'info');
    this.st.tickets = this.st.tickets.filter((x) => x.p !== ev.p);
    this.st.phase = 'open';
    this.paintWinners();
    this.paintKiosk();
    if (mine) this.showHud();
    if (!pc.fast) await this.wait(mine ? RESULT_S * 0.5 : 0.3);
  }

  // ── animation helpers (presentation only, cosmetic rng) ───────────────────────────────────────
  /** A random rest point inside the sphere (cosmetic stream). */
  private restIn(c: THREE.Vector3, r: number): THREE.Vector3 {
    for (;;) {
      const x = this.cosmetic.next() * 2 - 1, y = this.cosmetic.next() * 2 - 1, z = this.cosmetic.next() * 2 - 1;
      if (x * x + y * y + z * z <= 1) return new THREE.Vector3(c.x + x * r, c.y + y * r, c.z + z * r);
    }
  }

  private setBall(i: number, v: THREE.Vector3): void {
    this.parts.balls.set(i, v.x, v.y, v.z);
    this.ballAt[i] = v.clone();
  }

  private setMoonBall(i: number, v: THREE.Vector3): void {
    this.parts.moonBalls.set(i, v.x, v.y, v.z);
    this.moonAt[i] = v.clone();
  }

  /** Every white ball back inside the sphere. */
  private resetBalls(): void {
    for (let i = 0; i < MAIN_POOL; i++) this.setBall(i, this.restIn(SPHERE_C, SPHERE_R - 0.05));
  }

  private resetMoon(): void {
    for (let i = 0; i < MOON_POOL; i++) this.setMoonBall(i, this.restIn(MOON_C, MOON_R - 0.03));
  }

  /** Blower breath: every ball tumbles to a new rest point over `dur` seconds. */
  private async stir(pc: PresentCtx, dur: number): Promise<void> {
    if (pc.fast) return;
    const step = dur / STEPS;
    for (let s = 0; s < STEPS; s++) {
      for (let i = 0; i < MAIN_POOL; i++) this.setBall(i, this.restIn(SPHERE_C, SPHERE_R - 0.05));
      await this.wait(step);
    }
  }

  private async stirMoon(pc: PresentCtx, dur: number): Promise<void> {
    if (pc.fast) return;
    const step = dur / STEPS;
    for (let s = 0; s < STEPS; s++) {
      for (let i = 0; i < MOON_POOL; i++) this.setMoonBall(i, this.restIn(MOON_C, MOON_R - 0.03));
      await this.wait(step);
    }
  }

  /** A drawn white ball: sphere centre → tube → rack slot `slot`. */
  private async flyBall(i: number, slot: number, pc: PresentCtx): Promise<void> {
    const [sx, sy] = rackXY(slot);
    const end = new THREE.Vector3(sx, sy + 0.02, 0.3);
    const path = [this.ballAt[i] ?? SPHERE_C.clone(), ...this.parts.tubePath, end];
    if (pc.fast) { this.setBall(i, end); return; }
    for (let s = 1; s <= STEPS; s++) {
      this.setBall(i, alongPath(path, s / STEPS));
      await this.wait(BALL_S / STEPS);
    }
  }

  /** The Moon ball: from its sphere, an arc up and into the rack's sixth slot. */
  private async flyMoon(i: number, pc: PresentCtx): Promise<void> {
    const [sx, sy] = rackXY(5);
    const end = new THREE.Vector3(sx, sy + 0.02, 0.3);
    const from = this.moonAt[i] ?? MOON_C.clone();
    const arc = new THREE.Vector3((from.x + end.x) / 2, Math.max(from.y, end.y) + 0.35, (from.z + end.z) / 2);
    if (pc.fast) { this.setMoonBall(i, end); return; }
    for (let s = 1; s <= STEPS; s++) {
      this.setMoonBall(i, alongPath([from, arc, end], s / STEPS));
      await this.wait(MOON_S * 0.3 / STEPS);
    }
  }

  // ── snapshots: public board and live lines only ───────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase, drawNo: this.st.drawNo, last: [...this.st.last], moon: this.st.moon, extra: [...this.st.extra],
      pool: this.st.pool, peek: 0, result: this.st.result,
      tickets: this.st.tickets.map((t) => ({ p: t.p, bet: t.bet, lines: t.lines.map((l) => [...l]) })),
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, drawNo: sn.drawNo, last: [...sn.last], moon: sn.moon, extra: [...sn.extra], pool: sn.pool,
      peek: 0, result: sn.result, tickets: sn.tickets.map((t) => ({ p: t.p, bet: t.bet, lines: t.lines.map((l) => [...l]) })),
    };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintKiosk();
    if (local) { this.sfx('chime', { vol: 0.5 }); this.showHud(); }
  }
  onRelease(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintKiosk();
    if (local) this.showHud();
  }

  override onLang(): void {
    this.paintAll();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── painting ──────────────────────────────────────────────────────────────────────────────────
  private paintAll(): void {
    this.paintCounter();
    this.paintKiosk();
    this.paintWinners();
  }

  private paintCounter(): void {
    this.parts.leds.jackpot.set(String(Math.floor(this.st.pool)).padStart(10, '0'));
    this.parts.leds.credit.setOn(this.st.phase !== 'idle');
  }

  /** Winners board: the last draw in draw order, then the local result or the jackpot line. */
  private paintWinners(): void {
    const last = this.st.last.length ? this.st.last.map(pad2).join(' ') + ` +${pad2(this.st.moon)}` : '--';
    this.parts.winners.draw((g, sc) => {
      g.fillStyle = '#120b06'; g.fillRect(0, 0, sc.w, sc.h);
      sc.text(tr('m.lottoblower.winnersLabel'), 4, 2, { font: 'px5', color: DIM });
      sc.text(tr('m.lottoblower.lastDraw', { nums: last }), 4, 12, { font: 'px5', color: CREAM });
      if (this.st.result) sc.text(this.st.result, 4, 22, { font: 'px5', color: GOLD_CSS });
    });
    this.parts.leds.win.setOn(this.st.result.length > 0);
  }

  /** Kiosk CRT: the 6 × 5 number grid, the Moon row, the draft and the local ticket's stamps. */
  private paintKiosk(): void {
    const live = this.st.tickets.some((t) => t.p === this.selfId);
    const sel = new Set(this.picks);
    const drawn = new Set(this.st.last);
    this.parts.kioskScreen.draw((g, sc) => {
      g.fillStyle = '#0b1420'; g.fillRect(0, 0, sc.w, sc.h);
      g.fillStyle = '#1b2e44'; g.fillRect(0, 0, sc.w, 12);
      sc.text(tr('m.lottoblower.ticket'), 4, 2, { font: 'px5', color: live ? CREAM : DIM });
      sc.text(live ? tr('m.lottoblower.live') : tr('m.lottoblower.empty'), 156, 2, { font: 'px5', color: live ? GOLD_CSS : DIM, align: 'right' });
      for (let n = 1; n <= MAIN_POOL; n++) {
        const col = (n - 1) % MCOLS, row = Math.floor((n - 1) / MCOLS);
        const x = MX0 + col * MCW, y = MY0 + row * MCH;
        const on = sel.has(n), hit = drawn.has(n);
        g.fillStyle = on ? (hit ? '#ff5a4a' : '#e8c35a') : hit ? '#4a2a1c' : '#0f2030';
        g.fillRect(x, y, MCW - 1.5, MCH - 1.5);
        sc.text(String(n), x + MCW / 2, y + 2, { font: 'px5', color: on ? '#1a1206' : '#8fb0c8', align: 'center' });
      }
      for (let m = 1; m <= MOON_POOL; m++) {
        const x = OX0 + (m - 1) * OCW;
        const on = this.moonPick === m, hit = this.st.moon === m;
        g.fillStyle = on ? '#e8c35a' : hit ? '#c0272d' : '#2a0f12';
        g.fillRect(x, OY0, OCW - 1.5, OCH - 1.5);
        sc.text(String(m), x + OCW / 2, OY0 + 2, { font: 'px5', color: on ? '#1a1206' : '#f3c2b8', align: 'center' });
      }
      const stampTxt = this.stamps.length ? this.stamps.map((h) => (h ? String(h) : '-')).join(' ') : '';
      sc.text(tr('m.lottoblower.lines', { n: this.lines.length, m: MAX_LINES }), 4, 96, { font: 'px5', color: CREAM });
      sc.text(`${fmtCoins(this.bet)} x${QUICK_BATCHES[this.batchIdx]}`, 156, 96, { font: 'px5', color: CREAM, align: 'right' });
      sc.text(tr('m.lottoblower.pick', { n: this.picks.length }) + '  ' + tr('m.lottoblower.moon', { n: this.moonPick }), 4, 106, { font: 'px5', color: DIM });
      if (this.st.peek) sc.text(tr('m.lottoblower.peek', { n: this.st.peek }), 156, 106, { font: 'px5', color: GOLD_CSS, align: 'right' });
      else if (stampTxt) sc.text(stampTxt.slice(0, 26), 4, 116, { font: 'px5', color: GOLD_CSS });
    });
  }

  private showHud(): void {
    const seat = this.localSeat;
    const hints: HudHint[] = [];
    if (seat >= 0) {
      hints.push({ action: 'confirm', label: tr('m.lottoblower.hintDraw') });
      hints.push({ action: 'n1', label: tr('m.lottoblower.hintQuick') }, { action: 'n2', label: tr('m.lottoblower.hintAdd') });
      hints.push({ action: 'n3', label: tr('m.lottoblower.hintBatch') }, { action: 'n4', label: tr('m.lottoblower.hintBatchSize') });
      hints.push({ action: 'clear', label: tr('m.lottoblower.hintClear') });
    }
    hints.push({ action: 'betUp', label: tr('common.bet') }, { action: 'exit', label: tr('common.leave') });
    this.hud({
      bet: seat >= 0 ? this.bet : null,
      hints,
      stats: [
        { label: tr('m.lottoblower.lineLabel'), value: `${this.lines.length}` },
        { label: 'x', value: `${QUICK_BATCHES[this.batchIdx]}` },
        { label: tr('m.lottoblower.drawNo', { n: this.st.drawNo }), value: this.statusText() },
      ],
    });
  }

  private statusText(): string {
    if (this.timerLeft > 0 && (this.st.phase === 'idle' || this.st.phase === 'open')) {
      return tr('m.lottoblower.sOpenShared', { n: Math.ceil(this.timerLeft) });
    }
    switch (this.st.phase) {
      case 'idle': return tr('m.lottoblower.sIdle');
      case 'open': return tr('m.lottoblower.sOpen');
      case 'close': return tr('m.lottoblower.sLock');
      case 'blow': return tr('m.lottoblower.sBlow');
      case 'draw': return tr('m.lottoblower.sDraw', { n: this.drawIdx });
      case 'moon': return tr('m.lottoblower.sMoon');
      case 'payout': return tr('m.lottoblower.sPay');
    }
  }
}

// ── contract ──────────────────────────────────────────────────────────────────────────────────
export { playHeadless };

export const def: MachineDef = {
  id: 'lottoblower',
  category: 'lottery',
  slotSize: 'M',
  zone: 'laundry',
  seats: SEATS,
  shared: true,
  tier: 3,
  minBet: MIN_BET, maxBet: MAX_BET, betSteps: [5, 10, 25, 50, 100],
  maxPayoutMult: 1_000_000,
  rtp: 0.94,
  actionCost: 1,
  tags: ['table', 'draw', 'social', 'shared', 'jackpot'],
  headless: playHeadless,
  modHooks: {
    'x.lottoblower.extraBall': 'int: extra public main balls drawn after the five, counted for the owner only',
    'x.lottoblower.moonWeight.n': 'int add to one Moon weight (base 100), n = 1..8; solo draws only',
    'x.lottoblower.jackpotShare': 'float: extra jackpot share for the owner (owner lines weigh 1 + share)',
    'x.lottoblower.freeLine': 'int: free Quick Pick lines per draw for the owner (no charge)',
    'x.table.peekCharges': 'int ≥ 1: the Moon ball is shown before sales close (shared draws)',
    luck: 'reroll a losing solo draw once (or refund a losing shared ticket) with p = luck/100',
  },
  strings: STRINGS,
};
