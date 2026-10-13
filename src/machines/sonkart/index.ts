/**
 * SON KART / LAST CARD (`sonkart`, BRIEF Addendum 6, DECISIONS B) — a party table for 2–4 seats, original UNO-like
 * shedding game. Owner: sonkart. Rules and bot brains live in `rules.ts` (pure); the table, flow and juice here.
 *
 * Shape (the TableBase pattern of devilstable):
 *  - Host authority: `act()` → `onAction` validates through `rules.ts` and `emit`s facts (`fx`), each carrying the
 *    PUBLIC view `v` (counts, top card, colour, owed draws, pot). Hands never go out in a public event: each human
 *    gets their own cards with `emitPrivate({k:'hand'})`, and `getSnapshot(forPid)` carries only that player's hand.
 *  - Antes: the buy-in is charged with `chargeSeat` when a player antes. The round takes everyone who anted. Empty
 *    seats are filled with house mannequins (`addBot`, levels 1–3) when the round starts. Bots never touch a wallet.
 *  - Pot: sum of antes plus Debt coins. The round winner takes the pot (`paySeat`), doubled by a Jackpot card.
 *  - A human who leaves mid-hand is replaced by a bot holding the same cards; the stake is forfeit (TECH §3.4).
 *
 * Controls (seated; the hand is held in first person under the camera):
 *  primary/confirm plays the selected card · left/right move the selection · click a card to select, click it again
 *  to play · secondary draws (or passes after a playable draw) · click the draw pile to draw · double (R) calls
 *  LAST CARD · collect (C) catches an open LAST CARD · alt jumps in · n1–n4 pick the colour for wild cards ·
 *  n5–n9 toggle house rules during the ante window · betUp/betDown set the ante · help opens the rules sheet.
 */
import * as THREE from 'three';
import type { PlayerId, Json } from '@/core/types';
import { isBot } from '@/core/types';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { KitX } from '@/kit/index';
import { buildModel, COLOUR_HEX, HAND_MAX, type SonKartParts } from './model';
import * as R from './rules';
import { STRINGS } from './sonkart.strings';

// ── contract types (aliases, Json-safe) ─────────────────────────────────────────────────────────
/** Public view every peer keeps (also the late-join snapshot). Never contains hands or the draw order. */
type Pub = {
  ph: string; rnd: number; pot: number; ante: number;
  inR: boolean[]; cnt: number[]; deck: number;
  turn: number; dir: number; top: string; col: string;
  pend: number; pk: string; jp: boolean; debt: number[];
  call: number; callOn: boolean; dr: boolean; house: boolean[];
};
type Ev =
  | { k: 'ph'; v: Pub }
  | { k: 'ante'; v: Pub; seat: number; amt: number }
  | { k: 'deal'; v: Pub }
  | { k: 'fx'; v: Pub; f: R.Fx }
  | { k: 'end'; v: Pub; win: number; gross: number }
  | { k: 'hand'; c: string[] };
type Act =
  | { k: 'ante'; amt: number }
  | { k: 'play'; id: string; col: string; jump: boolean }
  | { k: 'draw' }
  | { k: 'call' }
  | { k: 'catch' }
  | { k: 'house'; i: number };
type Snap = { pub: Pub; hand: string[]; host: Json | null };

/** Host-only authority state. Never sent to clients, saved only in the host's own snapshot. */
interface Host {
  ph: 'bet' | 'play' | 'end';
  timer: number;
  antes: boolean[];
  stake: number[];
  pot: number;
  g: R.Game | null;
  rnd: number;
  house: boolean[];
  botWait: number;
  turnLeft: number;
  catchSeat: number;
  catchLeft: number;
}
const freshHost = (): Host => ({
  ph: 'bet', timer: BET_S, antes: [false, false, false, false], stake: [0, 0, 0, 0], pot: 0, g: null, rnd: 0,
  house: [true, true, false, true, true], botWait: 0, turnLeft: 0, catchSeat: -1, catchLeft: 0,
});
const freshPub = (): Pub => ({
  ph: 'bet', rnd: 0, pot: 0, ante: 0, inR: [false, false, false, false], cnt: [0, 0, 0, 0], deck: 0,
  turn: -1, dir: 1, top: '', col: '', pend: 0, pk: '', jp: false, debt: [0, 0, 0, 0], call: -1, callOn: false,
  dr: false, house: [true, true, false, true, true],
});

const BET_S = 15, TURN_S = 20, START_S = 1.5, END_S = 3.4, FILL_LEVEL: Array<1 | 2 | 3> = [1, 2, 2, 3];
/** Bot think time per level, seconds (plus up to 0.4 s jitter). Level 1 is slow and clumsy. */
const THINK = [1.6, 1.0, 0.6];
const HOUSE_KEYS = ['hsStack', 'hsSwap', 'hsJump', 'hsMatch', 'hsLast'] as const;
const COLOUR_NAMES: Readonly<Record<string, string>> = { R: 'cR', Y: 'cY', G: 'cG', B: 'cB' };
const COLOURS: readonly string[] = ['R', 'Y', 'G', 'B'];

export const def: MachineDef = {
  id: 'sonkart',
  category: 'party',
  slotSize: 'L',
  zone: 'parlour',
  seats: 4,
  shared: true,
  minBet: 20, maxBet: 2000, betSteps: [20, 50, 100, 250, 500, 1000, 2000],
  maxPayoutMult: 8,
  rtp: 0.95,
  tier: 1,
  actionCost: 1,
  headless: R.playHeadless,
  tags: ['party', 'table', 'cards', 'debt', 'jackpot'],
  party: {
    minPlayers: 2, maxPlayers: 4, bots: true, botLevels: 3,
    buyIn: { min: 20, max: 2000 }, spectatorBets: false,
    houseRules: { ...R.HOUSE_DEFAULT }, hidden: true, turnTimerS: TURN_S,
  },
  strings: STRINGS,
};

export const playHeadless = R.playHeadless;

export default class SonKart extends TableBase<SonKartParts, Ev, Snap, Act> {
  private h: Host = freshHost();
  private pub: Pub = freshPub();
  private myHand: string[] = [];
  private cursor = 0;
  private pickCol = '';
  private rulesOpen = false;
  private rulePage = 0;
  private backs: number[][] = [[], [], [], []];
  private deckIds: number[] = [];
  private topId = -1;
  private topShown = '';

  protected createModel(kit: KitX): MachineModel<SonKartParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.relayout();
    this.setHandView([]);
    this.refreshLamps();
    this.paintScreen();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const s = this.localSeat;
    if (s < 0) return;
    const a = e.action;
    switch (a) {
      case 'left': case 'right': {
        if (this.rulesOpen) { this.rulePage = (this.rulePage + (a === 'right' ? 1 : -1) + 6) % 6; this.paintScreen(); break; }
        if (this.myHand.length === 0) break;
        this.cursor = (this.cursor + (a === 'right' ? 1 : -1) + this.myHand.length) % this.myHand.length;
        this.sfx('hover');
        this.setHandView(this.myHand);
        break;
      }
      case 'primary': case 'confirm':
        if (e.repeat) break;
        if (this.pub.ph === 'bet') { if (!this.pub.inR[s]) this.act({ k: 'ante', amt: this.bet }); break; }
        this.playKey(this.myHand[this.cursor], false);
        break;
      case 'secondary':
        if (e.repeat) break;
        if (this.pub.ph === 'play' && this.pub.turn === s) this.act({ k: 'draw' });
        break;
      case 'double':
        if (!e.repeat) this.act({ k: 'call' });
        break;
      case 'collect':
        if (!e.repeat) this.act({ k: 'catch' });
        break;
      case 'alt':
        if (!e.repeat) this.playKey(this.jumpCard(), true);
        break;
      case 'n1': case 'n2': case 'n3': case 'n4':
        this.pickCol = COLOURS[Number(a.slice(1)) - 1];
        this.sfx('click', { vol: 0.5 });
        this.showHud();
        break;
      case 'n5': case 'n6': case 'n7': case 'n8': case 'n9':
        if (this.pub.ph === 'bet' && !e.repeat) this.act({ k: 'house', i: Number(a.slice(1)) - 5 });
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (this.pub.ph !== 'bet' || this.pub.inR[s]) break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'help':
        if (e.repeat) break;
        this.rulesOpen = !this.rulesOpen; this.rulePage = 0;
        this.sfx('click'); this.paintScreen();
        break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0 || this.localSeat < 0) return;
    const hit = this.pick(this.parts.hitHand);
    if (hit) {
      const i = Number(hit.object.userData.i);
      if (i >= 0 && i < this.myHand.length) {
        if (i === this.cursor) this.playKey(this.myHand[i], false);
        else { this.cursor = i; this.sfx('hover'); this.setHandView(this.myHand); }
      }
      return;
    }
    if (this.pick([this.parts.hitDeck]) && this.pub.ph === 'play' && this.pub.turn === this.localSeat) this.act({ k: 'draw' });
  }

  /** Plays `id` for the local player. Wild cards use the colour keys, else the colour the hand holds most of. */
  private playKey(id: string | undefined, jump: boolean): void {
    if (!id) return;
    const s = this.localSeat;
    if (this.pub.ph !== 'play') return;
    if (!jump && this.pub.turn !== s) { this.toast(this.t('eNotTurn'), 'warn'); return; }
    let col = '';
    if (!R.isColoured(id)) col = this.pickCol || this.mostColour();
    this.act({ k: 'play', id, col, jump });
    this.pickCol = '';
  }

  private jumpCard(): string | undefined {
    const top = this.pub.top;
    return R.isColoured(top) && this.myHand.includes(top) ? top : undefined;
  }

  private mostColour(): string {
    const cnt: Record<string, number> = { R: 0, Y: 0, G: 0, B: 0 };
    for (const c of this.myHand) if (R.isColoured(c)) cnt[R.colourOf(c)]++;
    let best = 'R';
    for (const c of COLOURS) if (cnt[c] > cnt[best]) best = c;
    return best;
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    if (!this.isHost) return;
    const h = this.h;
    switch (a.k) {
      case 'ante': {
        if (h.ph !== 'bet') { this.nak(pid, rid, 'm.sonkart.eBadPhase'); return; }
        if (h.antes[seat]) return;
        const amt = Math.round(Math.max(this.def.minBet, Math.min(this.def.maxBet, a.amt)));
        if (!this.chargeSeat(seat, amt)) { this.nak(pid, rid, 'm.sonkart.eNoFunds'); return; }
        h.antes[seat] = true; h.stake[seat] = amt; h.pot += amt;
        void this.emit({ k: 'ante', v: this.pubNow(), seat, amt });
        const hs = this.humans();
        if (hs.length && hs.every((x) => h.antes[x.seat])) h.timer = Math.min(h.timer, START_S);
        return;
      }
      case 'house': {
        if (h.ph !== 'bet') return;
        h.house[a.i] = !h.house[a.i];
        void this.emit({ k: 'ph', v: this.pubNow() });
        return;
      }
      case 'play': case 'draw': case 'call': case 'catch': {
        const g = h.g;
        if (h.ph !== 'play' || !g) { this.nak(pid, rid, 'm.sonkart.eBadPhase'); return; }
        if (!g.play[seat]) { this.nak(pid, rid, 'm.sonkart.sitOut'); return; }
        const du = this.debtUnit(), rich = this.wealthFor(seat);
        let res: R.Result;
        if (a.k === 'play') res = R.applyPlay(g, this.hostRng, seat, a.id, { col: a.col || undefined, jump: a.jump, debtUnit: du, wealthiest: rich });
        else if (a.k === 'draw') res = R.applyDraw(g, this.hostRng, seat);
        else if (a.k === 'call') res = R.applyCall(g, seat);
        else res = R.applyCatch(g, this.hostRng, seat);
        if (res.err) { this.nak(pid, rid, 'm.sonkart.' + res.err.replace(/^sk\./, '')); return; }
        this.afterAction(res.fx);
        return;
      }
    }
  }

  private house(): R.House {
    const b = this.h.house;
    return { stack: b[0], swap70: b[1], jumpIn: b[2], drawToMatch: b[3], lastCard: b[4] };
  }

  /** Coins one Debt card adds: half the largest stake on the table, at least 10. */
  private debtUnit(): number {
    return Math.max(10, Math.round(Math.max(0, ...this.h.stake) / 2));
  }

  /** The human with the most coins among the other players in the hand (Curse target), or −1. */
  private wealthFor(seat: number): number {
    const g = this.h.g;
    if (!g) return -1;
    let best = -1, bw = -1;
    for (let s = 0; s < g.seats; s++) {
      const pid = this.seats[s];
      if (s === seat || !g.play[s] || pid === null || isBot(pid)) continue;
      const w = this.ctx.run.wallet(pid);
      if (w > bw) { bw = w; best = s; }
    }
    return best;
  }

  private afterAction(fx: R.Fx[]): void {
    const g = this.h.g;
    if (!g) return;
    for (const f of fx) void this.emit({ k: 'fx', v: this.pubNow(), f });
    for (const f of R.settleTurn(g, this.hostRng)) void this.emit({ k: 'fx', v: this.pubNow(), f });
    this.sendHands(false);
    if (g.over) { this.finish(g.winner); return; }
    this.beginTurn();
  }

  private beginTurn(): void {
    const g = this.h.g;
    if (!g || g.over) return;
    const pid = this.seats[g.turn];
    this.h.turnLeft = TURN_S;
    if (pid === null) return;
    if (isBot(pid)) this.h.botWait = THINK[this.levelOf(g.turn) - 1] + this.hostRng.float(0, 0.4);
    else this.countdown(TURN_S, 'turn');
  }

  private levelOf(seat: number): 1 | 2 | 3 {
    return (this.bots.find((b) => b.seat === seat)?.level ?? 2) as 1 | 2 | 3;
  }

  private sendHands(clear: boolean): void {
    const g = this.h.g;
    this.seated().forEach(({ seat, pid }) => {
      if (isBot(pid)) return;
      void this.emitPrivate(pid, { k: 'hand', c: clear || !g ? [] : g.hands[seat].slice() });
    });
  }

  // ── host clock ───────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const h = this.h;
    switch (h.ph) {
      case 'bet':
        if (this.humans().length === 0) return;
        if ((h.timer -= dt) <= 0) {
          if (h.antes.some(Boolean)) this.startRound();
          else { h.timer = BET_S; this.countdown(BET_S, 'bet'); }
        }
        break;
      case 'play':
        this.hostPlay(dt);
        break;
      case 'end':
        if ((h.timer -= dt) <= 0) this.openBet();
        break;
    }
  }

  private hostPlay(dt: number): void {
    const h = this.h, g = h.g;
    if (!g || g.over) return;
    // bots catch an open LAST CARD after a short reaction
    const win = g.call && !g.call.on ? g.call.seat : -1;
    if (win !== h.catchSeat) { h.catchSeat = win; h.catchLeft = 0.9 + this.hostRng.float(0, 1.4); }
    if (win >= 0 && (h.catchLeft -= dt) <= 0) {
      h.catchSeat = -2;
      for (const b of this.bots) {
        if (b.seat === win || !g.play[b.seat]) continue;
        const d = R.botDecide(g, b.seat, b.level, b.rng, -1);
        if (d.k === 'catch') { const r = R.applyCatch(g, this.hostRng, b.seat); if (!r.err) this.afterAction(r.fx); return; }
      }
    }
    const t = g.turn;
    const pid = this.seats[t];
    if (pid === null) return;
    if (isBot(pid)) {
      if ((h.botWait -= dt) <= 0) this.botStep(t);
      return;
    }
    if ((h.turnLeft -= dt) <= 0) {
      const res = R.autoAct(g, this.hostRng, t, this.debtUnit(), this.wealthFor(t));
      if (!res.err) this.afterAction(res.fx);
    }
  }

  private botStep(seat: number): void {
    const g = this.h.g;
    const bot = this.bots.find((b) => b.seat === seat);
    if (!g || !bot) return;
    const rng = bot.rng;
    const du = this.debtUnit(), rich = this.wealthFor(seat);
    const d = R.botDecide(g, seat, bot.level, rng, rich);
    let res: R.Result;
    switch (d.k) {
      case 'play': res = R.applyPlay(g, rng, seat, d.id, { col: d.col || undefined, debtUnit: du, wealthiest: rich, callOn: rng.chance(R.botCallChance(bot.level)) }); break;
      case 'pass': res = R.applyPass(g, seat); break;
      case 'call': res = R.applyCall(g, seat); break;
      case 'catch': res = R.applyCatch(g, rng, seat); break;
      default: res = R.applyDraw(g, rng, seat); break;
    }
    if (res.err) res = R.autoAct(g, rng, seat, du, rich);
    if (!res.err) this.afterAction(res.fx);
  }

  // ── round life-cycle (host) ──────────────────────────────────────────────────────────────────
  private openBet(): void {
    const h = this.h;
    h.ph = 'bet'; h.timer = BET_S; h.g = null;
    h.antes = [false, false, false, false]; h.stake = [0, 0, 0, 0]; h.pot = 0;
    this.seated().forEach(({ seat, pid }) => { if (isBot(pid)) this.removeBot(seat); });
    this.sendHands(true);
    void this.emit({ k: 'ph', v: this.pubNow() });
    if (this.humans().length) this.countdown(BET_S, 'bet');
  }

  private startRound(): void {
    const h = this.h;
    const amt = Math.max(...h.stake);
    // empty seats are filled with house mannequins that ante the table stake from the house
    for (let s = 0; s < this.def.seats; s++) {
      if (this.seats[s] !== null) continue;
      const lv = FILL_LEVEL[this.hostRng.int(0, FILL_LEVEL.length - 1)];
      this.addBot(s, t(`m.sonkart.bot${s + 1}`), lv);
      h.antes[s] = true; h.stake[s] = amt; h.pot += amt;
      this.chargeSeat(s, amt);
    }
    const play = h.antes.slice();
    if (play.filter(Boolean).length < 2) {
      // one player alone at the table: refund and wait
      h.antes.forEach((on, s) => {
        if (!on) return;
        const pid = this.seats[s];
        if (pid !== null && !isBot(pid)) this.paySeat(s, h.stake[s], { bet: h.stake[s], tier: 'push', tags: ['refund'] }, pid);
      });
      this.openBet();
      return;
    }
    h.rnd++;
    h.ph = 'play';
    h.g = R.startRound(play, this.hostRng, this.house());
    void this.emit({ k: 'deal', v: this.pubNow() });
    this.sendHands(false);
    for (const f of R.settleTurn(h.g, this.hostRng)) void this.emit({ k: 'fx', v: this.pubNow(), f });
    this.beginTurn();
  }

  private finish(w: number): void {
    const h = this.h, g = h.g;
    if (!g) return;
    let pot = h.pot;
    g.play.forEach((on, s) => {
      if (!on || g.debt[s] <= 0) return;
      if (this.chargeSeat(s, g.debt[s])) pot += g.debt[s];
    });
    const gross = Math.floor(pot * (g.jp ? 2 : 1) * (1 - R.RAKE));
    h.ph = 'end'; h.timer = END_S; h.pot = 0;
    const winStake = h.stake[w] || Math.max(...h.stake);
    void this.emit({ k: 'end', v: this.pubNow(), win: w, gross }, () => {
      for (let s = 0; s < g.seats; s++) this.forfeit(s);
      const pid = this.seats[w];
      if (w >= 0 && pid !== null) this.paySeat(w, gross, { bet: winStake }, pid);
    });
    this.sendHands(true);
  }

  // ── seats ────────────────────────────────────────────────────────────────────────────────────
  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) { this.placeBot(seat, true); return; }
    if (local) { this.cursor = 0; this.sfx('chime'); this.showHud(); this.paintScreen(); }
  }

  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) { this.placeBot(seat, false); return; }
    if (this.isHost) {
      const h = this.h, g = h.g;
      if (h.ph === 'bet' && h.antes[seat]) {
        const stake = h.stake[seat];
        this.paySeat(seat, stake, { bet: stake, tier: 'push', tags: ['refund'] }, pid);
        h.pot -= stake; h.antes[seat] = false; h.stake[seat] = 0;
        void this.emit({ k: 'ph', v: this.pubNow() });
      }
      if (h.ph === 'play' && g && g.play[seat] && !g.over) {
        const lv = FILL_LEVEL[this.hostRng.int(0, FILL_LEVEL.length - 1)];
        this.addBot(seat, t(`m.sonkart.bot${seat + 1}`), lv);
        if (g.turn === seat) this.beginTurn();
      }
      this.sendHands(false);
    }
    if (local) { this.hud(null); this.setHandView([]); this.myHand = []; }
  }

  private placeBot(seat: number, on: boolean): void {
    const m = this.parts.bots[seat];
    if (!m) return;
    m.setVisible(on);
    if (on) m.play('Sitting_Idle_Loop', { loop: true });
  }

  // ── presentation (every peer, including the host) ────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    if (ev.k === 'hand') { this.myHand = ev.c.slice(); this.cursor = Math.min(this.cursor, Math.max(0, this.myHand.length - 1)); this.setHandView(this.myHand); this.showHud(); return; }
    this.pub = ev.v;
    const fast = pc.fast;
    switch (ev.k) {
      case 'ph':
        this.refreshLamps(); this.paintScreen(); this.relayout();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'ante': {
        const p = this.parts;
        this.sfx('coin'); this.ctx.fx.coins(p.discardAnchor, 3);
        this.ctx.fx.popText(p.seatLamps[ev.seat].root, this.t('pAnte', { n: fmtCoins(ev.amt) }), 0xffd040, 0.9);
        this.paintScreen();
        return;
      }
      case 'deal':
        return this.animDeal(fast);
      case 'fx':
        return this.animFx(ev.f, fast);
      case 'end':
        return this.animEnd(ev, pc);
    }
  }

  private async animDeal(fast: boolean): Promise<void> {
    const p = this.parts;
    this.sfx('shuffle');
    this.relayout();
    if (!fast) {
      for (let k = 0; k < 7; k++) {
        const flights: Promise<void>[] = [];
        for (let s = 0; s < this.def.seats; s++) {
          if (!this.pub.inR[s]) continue;
          flights.push(this.flyFromDeck(s, 0.18));
        }
        await Promise.all(flights);
        this.sfx('card');
      }
    }
    this.relayout();
    this.paintScreen();
    if (this.pub.top) { p.table.setCard(this.topId, this.pub.top); }
  }

  private async animFx(f: R.Fx, fast: boolean): Promise<void> {
    const p = this.parts, dur = fast ? 0.01 : 0.26;
    switch (f.k) {
      case 'play': {
        const from = f.seat === this.localSeat ? this.handLocal(Math.max(0, this.myHand.indexOf(f.id)), this.myHand.length) : p.handSpots[f.seat].clone();
        const rot = this.seatYaw(f.seat);
        const tmp = p.table.add(f.id, from, rot);
        this.sfx(f.fx === 'w4' ? 'thud' : 'cardFlip');
        await p.table.move(tmp, p.discSpot.clone(), dur, { arc: 0.1, rotY: 0 });
        if (this.topId >= 0 && this.topId !== tmp) p.table.remove(this.topId);
        this.topId = tmp; this.topShown = f.id;
        this.ctx.fx.squash(p.discardAnchor, 0.18, 0.16);
        this.flashColour(f.col);
        this.tagPop(f);
        if (f.fx === 'skip' || f.fx === 'rev' || f.fx === 'd2' || f.fx === 'w4' || f.fx === 'debt' || f.fx === 'curse' || f.fx === 'jp') this.ctx.fx.shake(f.fx === 'w4' ? 0.035 : 0.018, 0.25);
        if (f.j) this.ctx.fx.popText(p.discardAnchor, this.t('pJump'), 0x40ffb0, 0.9);
        break;
      }
      case 'draw': {
        for (let k = 0; k < Math.min(f.n, 4); k++) void this.flyFromDeck(f.seat, fast ? 0.01 : 0.22);
        this.sfx('card');
        if (f.n > 0) this.ctx.fx.popText(p.seatLamps[f.seat].root, this.t('pDraw', { n: f.n }), 0xffffff, 0.8);
        await this.wait(fast ? 0 : 0.12);
        break;
      }
      case 'pass':
        this.sfx('click');
        this.ctx.fx.popText(p.seatLamps[f.seat].root, this.t('pPass'), 0xb8b8b8, 0.7);
        break;
      case 'call':
        this.sfx('bell'); this.ctx.fx.shake(0.03, 0.3);
        this.ctx.fx.popText(p.seatLamps[f.seat].root, this.t('pCall'), 0xffd040, { dur: 1.3, shake: true });
        break;
      case 'catch':
        this.sfx('buzzer'); this.ctx.fx.hitstop(0.05); this.ctx.fx.shake(0.04, 0.35);
        this.ctx.fx.popText(p.seatLamps[f.seat].root, this.t('pCaught'), 0xff3a3a, { dur: 1.3, shake: true });
        for (let k = 0; k < 2; k++) void this.flyFromDeck(f.seat, fast ? 0.01 : 0.2);
        await this.wait(fast ? 0 : 0.2);
        break;
      case 'coll': {
        this.flashColour(f.col);
        this.sfx('whoosh');
        f.cnt.forEach((n, s) => { if (n > 0) this.ctx.fx.popText(p.seatLamps[s].root, `-${n}`, COLOUR_HEX[f.col] ?? 0xffffff, 0.9); });
        this.ctx.fx.popText(p.discardAnchor, this.t('pColl'), COLOUR_HEX[f.col] ?? 0xffffff, { dur: 1.1, shake: true });
        this.ctx.fx.shake(0.025, 0.3);
        break;
      }
      case 'swap':
        this.sfx('whoosh');
        this.ctx.fx.tint(0x7a2cff, 0.18, 0.4);
        break;
      case 'rot':
        this.sfx('whoosh');
        break;
      case 'turn':
        this.refreshLamps();
        if (f.seat === this.localSeat) { this.sfx('bell'); this.ctx.fx.popText(p.seatLamps[f.seat].root, this.t('sYourTurn'), 0xffd040, 0.9); }
        this.paintScreen();
        if (this.isLocalOccupant) this.showHud();
        break;
      case 'win':
        break;
    }
    this.relayout();
    this.flashLights();
    this.paintScreen();
  }

  private tagPop(f: Extract<R.Fx, { k: 'play' }>): void {
    const p = this.parts;
    const at = f.tgt >= 0 ? p.seatLamps[f.tgt].root : p.discardAnchor;
    switch (f.fx) {
      case 'skip': this.sfx('whoosh'); this.ctx.fx.popText(at, this.t('pSkip'), 0xffffff, 0.9); break;
      case 'rev': this.sfx('whoosh'); this.ctx.fx.popText(p.discardAnchor, this.t('pRev'), 0xffffff, 0.9); break;
      case 'd2': this.sfx('thud'); this.ctx.fx.popText(at, this.t('pD2', { n: 2 }), 0xff9040, 0.9); break;
      case 'w4': this.sfx('thud'); this.ctx.fx.flash(0xff3a3a, 0.16, 0.3); this.ctx.fx.popText(at, this.t('pW4', { n: 4 }), 0xff3a3a, 1.0); break;
      case 'debt': this.sfx('buzzer'); this.ctx.fx.popText(at, this.t("pDebt"), 0xff3a3a, 1.0); break;
      case 'curse': this.sfx('glass'); this.ctx.fx.tint(0x7a2cff, 0.25, 0.5); this.ctx.fx.popText(p.discardAnchor, this.t('pCurse'), 0xb070ff, 1.1); break;
      case 'jp': this.sfx('jackpot'); this.ctx.fx.hitstop(0.06); this.ctx.fx.confetti(p.discardAnchor, 20); this.ctx.fx.popText(p.discardAnchor, this.t('pJp'), 0xffd040, 1.2); break;
      case 'swap7': case 'swap0': this.sfx('whoosh'); this.ctx.fx.popText(p.discardAnchor, this.t(f.fx === 'swap7' ? 'pSwap' : 'pRot'), 0x40ffb0, 1.0); break;
      default: break;
    }
  }

  private async animEnd(ev: Extract<Ev, { k: 'end' }>, pc: PresentCtx): Promise<void> {
    const p = this.parts;
    const w = ev.win;
    const wasIn = ev.v.inR[this.localSeat] === true;
    if (w >= 0) {
      const bot = isBot(this.seats[w] ?? 0);
      const at = p.seatLamps[w].root;
      if (bot || ev.gross <= 0) this.ctx.fx.popText(at, this.t('pWin'), 0xffd040, 1.2);
      else this.ctx.fx.popText(at, fmtCoins(ev.gross), 0xffd040, 1.4);
    }
    if (w === this.localSeat && w >= 0) {
      const tier = juiceTier(ev.gross, Math.max(1, this.bet), []);
      void this.celebrate(tier, { amount: ev.gross, at: p.coinOut, fast: pc.fast });
    } else if (wasIn) {
      this.commiserate({ at: p.coinOut });
    } else {
      this.sfx(w >= 0 ? 'lose' : 'click');
    }
    if (this.isLocalOccupant) this.setHandView([]);
    this.refreshLamps();
    this.paintScreen();
  }

  private flashColour(col: string): void {
    const hex = COLOUR_HEX[col] ?? 0xffffff;
    this.parts.colLamp.setColor(hex);
    this.parts.colLamp.setOn(true);
    for (let i = 0; i < 8; i++) this.parts.strip.setBulb(i, hex);
    this.parts.strip.pattern('all');
    this.ctx.fx.flash(hex, 0.12, 0.25);
  }

  private flashLights(): void {
    this.parts.strip.pattern(this.pub.jp ? 'chase' : 'all', this.pub.jp ? 6 : 0);
  }

  // ── table pools ──────────────────────────────────────────────────────────────────────────────
  /** Yaw so that a card lying in front of seat `s` reads right-side up for the player there. */
  private seatYaw(s: number): number {
    const p = this.parts.handSpots[s];
    return Math.atan2(-p.x, -p.z);
  }

  /** Re-fans the face-down backs of every opponent and the draw pile; updates the discard top. */
  private relayout(): void {
    const p = this.parts, tb = p.table;
    for (const list of this.backs) for (const id of list) tb.remove(id);
    this.backs = [[], [], [], []];
    for (let s = 0; s < this.def.seats; s++) {
      if (!this.pub.inR[s] || s === this.localSeat) continue;
      const n = Math.min(this.pub.cnt[s] ?? 0, 9);
      const base = p.handSpots[s];
      const inward = new THREE.Vector3(-base.x, 0, -base.z).normalize();
      const tan = new THREE.Vector3(-inward.z, 0, inward.x);
      for (let k = 0; k < n; k++) {
        const at = base.clone().addScaledVector(tan, (k - (n - 1) / 2) * 0.034);
        this.backs[s].push(tb.add(null, at, this.seatYaw(s)));
      }
    }
    this.deckIds.forEach((id) => tb.remove(id));
    this.deckIds = [];
    const decks = Math.min(4, Math.ceil(this.pub.deck / 12));
    for (let k = 0; k < decks; k++) this.deckIds.push(tb.add(null, p.deckSpot.clone().add(new THREE.Vector3(0, k * 0.0045, 0)), 0));
    if (this.pub.top !== this.topShown || this.topId < 0) {
      if (this.topId >= 0) tb.remove(this.topId);
      this.topId = this.pub.top ? tb.add(this.pub.top, p.discSpot.clone(), 0) : -1;
      this.topShown = this.pub.top;
    }
  }

  /** Flies one face-down card from the draw pile to `s`'s spot (or the local hand). */
  private flyFromDeck(s: number, dur: number): Promise<void> {
    const p = this.parts, tb = p.table;
    const to = s === this.localSeat ? this.handLocal(this.myHand.length, this.myHand.length + 1) : p.handSpots[s].clone();
    const tmp = tb.add(null, p.deckSpot.clone(), 0);
    return tb.move(tmp, to, dur, { arc: 0.12 }).then(() => { tb.remove(tmp); });
  }

  private refreshLamps(): void {
    const turn = this.pub.turn;
    this.parts.seatLamps.forEach((l, s) => {
      const on = this.pub.ph === 'play' && s === turn;
      l.setColor(on ? 0xffd040 : (this.pub.inR[s] ? 0x40ff70 : 0x2a2a2a));
      l.setOn(on || this.pub.inR[s]);
    });
    this.parts.colLamp.setColor(COLOUR_HEX[this.pub.col] ?? 0xffffff);
  }

  // ── the first-person hand ───────────────────────────────────────────────────────────────────
  /** Hand-root local point for slot `i` of `n` cards (for flights into the hand). */
  private handLocal(i: number, n: number): THREE.Vector3 {
    const hr = this.parts.handRoot;
    const p = this.handSlot(i, Math.max(n, 1));
    return p.applyQuaternion(hr.quaternion).add(hr.position);
  }

  private handSlot(i: number, n: number): THREE.Vector3 {
    const spacing = Math.min(0.068, 0.95 / n);
    const x = (i - (n - 1) / 2) * spacing;
    return new THREE.Vector3(x, 0.001 * (i + 1), 0.03 * Math.pow(x / 0.5, 2) + (i === this.cursor ? -0.022 : 0));
  }

  /** Re-deals the viewmodel hand: cards face the camera, the selected card lifts. */
  private setHandView(c: string[]): void {
    const p = this.parts;
    p.hand.clear();
    if (this.localSeat < 0 && c.length === 0) { p.hitHand.forEach((m) => { m.position.set(0, -50, 0); }); return; }
    const n = c.length;
    for (let i = 0; i < HAND_MAX; i++) {
      const m = p.hitHand[i];
      if (i >= n) { m.position.set(0, -50, 0); continue; }
      const at = this.handSlot(i, n);
      const yaw = -((i - (n - 1) / 2) * 0.12);
      p.hand.add(c[i], at, yaw);
      m.position.copy(at);
      m.rotation.set(-Math.PI / 2, 0, yaw);
    }
  }

  /** Places the hand root in front of the seat camera every render frame. */
  frame(_dt: number, _t: number): void {
    if (this.localSeat < 0) return;
    const cam = this.ctx.camera;
    const root = this.model.root, hr = this.parts.handRoot;
    const cp = new THREE.Vector3(), cq = new THREE.Quaternion();
    cam.getWorldPosition(cp);
    cam.getWorldQuaternion(cq);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cq);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(cq);
    const world = cp.clone().addScaledVector(fwd, 0.5).addScaledVector(down, 0.27);
    hr.position.copy(root.worldToLocal(world));
    const rq = new THREE.Quaternion();
    root.getWorldQuaternion(rq);
    const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    hr.quaternion.copy(rq.clone().invert()).multiply(cq).multiply(face);
  }

  // ── HUD, screen, rules ──────────────────────────────────────────────────────────────────────
  private showHud(): void {
    const s = this.localSeat, pub = this.pub;
    const hints: HudHint[] = [];
    if (pub.ph === 'bet' && s >= 0 && !pub.inR[s]) {
      hints.push({ action: 'primary', label: this.t('hAnte') }, { action: 'betUp', label: t('common.bet') });
    }
    if (pub.ph === 'bet') {
      HOUSE_KEYS.forEach((key, i) => hints.push({ action: `n${i + 5}` as HudHint["action"], label: `${this.t(key)} ${this.t(pub.house[i] ? 'hsOn' : 'hsOff')}` }));
    }
    if (pub.ph === 'play' && s >= 0 && pub.turn === s) {
      hints.push({ action: 'primary', label: this.t('hPlay') });
      hints.push({ action: 'secondary', label: pub.dr ? this.t('hPass') : pub.pend > 0 ? this.t('hDrawN', { n: pub.pend }) : this.t('hDraw') });
      if (this.jumpCard() && pub.house[2]) hints.push({ action: 'alt', label: this.t('hJump') });
    }
    if (pub.ph === 'play' && s >= 0 && pub.call >= 0 && pub.call !== s && !pub.callOn) hints.push({ action: 'collect', label: this.t('hCatch') });
    if (s >= 0 && (this.myHand.length <= 2 || pub.call === s)) hints.push({ action: 'double', label: this.t('hCall') });
    hints.push({ action: 'n1', label: this.t('hColour') }, { action: 'help', label: this.t('hRules') }, { action: 'exit', label: t('common.leave') });
    this.hud({
      bet: pub.ph === 'bet' && s >= 0 && !pub.inR[s] ? this.bet : null,
      hints,
      stats: [{ label: this.t('scrColour'), value: this.colourName(this.pickCol || pub.col) }],
    });
  }

  private colourName(c: string): string { return c ? this.t(COLOUR_NAMES[c] ?? 'cR') : '-'; }

  onLang(): void { this.paintScreen(); if (this.isLocalOccupant) this.showHud(); }

  /** Centre screen of the rear rail: round, colour, owed draws, pot; or the rules sheet on `help`. */
  private paintScreen(): void {
    const scr = this.parts.screen;
    const pub = this.pub;
    scr.draw((g, s) => {
      g.fillStyle = '#060a08';
      g.fillRect(0, 0, s.w, s.h);
      const line = (txt: string, y: number, color: string): void => { s.text(txt, s.w / 2, y, { font: 'px5', color, align: 'center' }); };
      if (this.rulesOpen) {
        line(this.t('rulesTitle'), 24, '#ffd040');
        const body = this.wrap(this.t(`rules${this.rulePage + 1}`), 34).slice(0, 4);
        body.forEach((l, i) => line(l, 50 + i * 20, '#e8f5e8'));
        line(`${this.rulePage + 1}/6`, s.h - 10, '#8a8a8a');
        return;
      }
      const cl = pub.col ? COLOUR_HEX[pub.col] : 0xffffff;
      line(pub.ph === 'bet' ? this.t('sBots') : this.t('sRound', { n: pub.rnd }), 26, '#' + (pub.ph === 'bet' ? 'e8f5e8' : 'ffd040'));
      line(`${this.t('scrColour')} ${this.colourName(pub.col)}  ${this.t('scrPot')} ${fmtCoins(pub.pot)}`, 56, '#' + cl.toString(16).padStart(6, '0'));
      const tail = pub.pend > 0 ? this.t('scrPend', { n: pub.pend }) : pub.jp ? this.t('scrJackpot') : pub.call >= 0 && pub.callOn ? this.t('scrCalled') : '';
      line(tail, 86, '#ff9040');
      line(pub.ph === 'play' && pub.turn >= 0 ? this.t('sTurnOf', { name: this.seatName(pub.turn) }) : this.t('sWait'), 106, '#b8b8b8');
    });
  }

  private seatName(s: number): string {
    const pid = this.seats[s];
    if (pid === null) return '-';
    return isBot(pid) ? this.t(`bot${s + 1}`) : this.ctx.net.playerName(pid);
  }

  private wrap(text: string, width: number): string[] {
    const out: string[] = [];
    let cur = '';
    for (const w of text.split(' ')) {
      if ((cur + ' ' + w).trim().length > width) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    }
    if (cur) out.push(cur);
    return out;
  }

  // ── snapshots: per-recipient, never another seat's hand ─────────────────────────────────────
  private pubNow(): Pub {
    const h = this.h, g = h.g;
    const house = h.house.slice();
    if (!g) {
      return {
        ph: h.ph, rnd: h.rnd, pot: h.pot, ante: Math.max(0, ...h.stake), inR: h.antes.slice(), cnt: [0, 0, 0, 0], deck: 0,
        turn: -1, dir: 1, top: '', col: '', pend: 0, pk: '', jp: false, debt: [0, 0, 0, 0], call: -1, callOn: false,
        dr: false, house,
      };
    }
    return {
      ph: h.ph, rnd: h.rnd, pot: h.pot, ante: Math.max(0, ...h.stake), inR: g.play.slice(),
      cnt: g.hands.map((x) => x.length), deck: g.draw.length, turn: g.over ? -1 : g.turn, dir: g.dir,
      top: g.top, col: g.col, pend: g.pend, pk: g.pendK, jp: g.jp, debt: g.debt.slice(),
      call: g.call ? g.call.seat : -1, callOn: !!g.call?.on, dr: g.drawn, house,
    };
  }

  getSnapshot(forPid?: PlayerId): Snap {
    const seat = forPid === undefined ? -1 : this.seats.indexOf(forPid);
    const g = this.h.g;
    const hand = g && seat >= 0 ? g.hands[seat].slice() : [];
    const snap: Snap = { pub: this.pubNow(), hand, host: forPid === undefined ? (JSON.parse(JSON.stringify(this.h)) as Json) : null };
    return snap;
  }

  applySnapshot(sn: Snap): void {
    this.pub = sn.pub;
    if (sn.host && this.isHost) this.h = sn.host as unknown as Host;
    this.myHand = sn.hand.slice();
    this.topId = -1; this.topShown = '';
    this.backs = [[], [], [], []]; this.deckIds = [];
    this.parts.table.clear();
    this.relayout();
    this.setHandView(this.myHand);
    this.refreshLamps();
    this.paintScreen();
  }
}
