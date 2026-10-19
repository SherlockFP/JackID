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
 * Table view: a round card table seen from above and behind the seat (about 37 degrees down). The top card lies big in the exact
 * centre inside a ring in the colour in force, the draw pile beside it; each opponent sits in a chair with a fan of backs and a
 * name chip, a pointer and a rail lamp mark whose turn it is. Layout numbers: `layout.ts`.
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
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { KitX } from '@/kit/index';
import { buildModel, COLOUR_HEX, HAND_MAX, HIT_W, RING_IDLE, type SonKartParts } from './model';
import * as L from './layout';
import * as R from './rules';
import { KartHud, type PlateView } from './kartHud';
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

const BET_S = 12, TURN_S = 20, START_S = 1.0, END_S = 3.0;
/** Bot think time per level, seconds (plus up to 0.4 s jitter). Level 1 is slow and clumsy. */
const THINK = [1.1, 0.75, 0.5];
const HOUSE_KEYS = ['hsStack', 'hsSwap', 'hsJump', 'hsMatch', 'hsLast'] as const;
const COLOUR_NAMES: Readonly<Record<string, string>> = { R: 'cR', Y: 'cY', G: 'cG', B: 'cB' };
const COLOURS: readonly string[] = ['R', 'Y', 'G', 'B'];
/** The first-person hand floats this far (m) ahead of the eye. */
const HAND_DIST = 0.75;

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
  // seat coach (_base/coach.ts): taught by doing on the first sits
  coach: [
    { key: 'primary', say: 'ante', done: 'round' },
    { key: 'primary', say: 'playCard', done: 'press' },
    { key: 'double', say: 'lastCard', done: 'press' },
  ],
  strings: STRINGS,
};

export const playHeadless = R.playHeadless;

export default class SonKart extends TableBase<SonKartParts, Ev, Snap, Act> {
  private h: Host = freshHost();
  private pub: Pub = freshPub();
  private myHand: string[] = [];
  private cursor = 0;
  private pickCol = '';
  /** Seat HUD overlay (created in init, shown while seated). */
  private seatHud?: SeatHud;
  /** Table overlay: opponent plates, the big top card, the wild-card colour picker. */
  private kart?: KartHud;
  private autoAnte = false;
  private backs: number[][] = [[], [], [], []];
  private deckIds: number[] = [];
  private topId = -1;
  private topShown = '';
  private topYawAt = 0;
  private pointerYaw = 0;
  private readonly tmpV = new THREE.Vector3();

  protected createModel(kit: KitX): MachineModel<SonKartParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.kart = new KartHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.relayout();
    this.setHandView([]);
    this.refreshLamps();
    this.paintScreen();
  }

  dispose(): void {
    this.seatHud?.dispose();
    this.kart?.dispose();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes the rules card
    if (e.action === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const kh = this.kart;
    if (kh?.picking) {
      switch (e.action) {
        case 'n1': case 'n2': case 'n3': case 'n4': kh.choose(COLOURS[Number(e.action.slice(1)) - 1]); break;
        case 'primary': case 'confirm': if (!e.repeat) kh.choose(this.mostColour()); break;
        case 'secondary': case 'clear': kh.closePicker(); this.showHud(); break;
        default: break;
      }
      return;
    }
    const s = this.localSeat;
    if (s < 0) return;
    const a = e.action;
    switch (a) {
      case 'left': case 'right': {
        if (this.myHand.length === 0) break;
        this.cursor = (this.cursor + (a === 'right' ? 1 : -1) + this.myHand.length) % this.myHand.length;
        this.sfx('hover');
        this.setHandView(this.myHand);
        break;
      }
      case 'primary': case 'confirm':
        if (e.repeat) break;
        if (this.pub.ph === 'bet') { if (!this.pub.inR[s]) this.act({ k: 'ante', amt: this.bet }); break; }
        // keyboard draw: with nothing playable (or an owed draw) Space draws; with a drawn card out, a non-matching card passes
        if (this.pub.ph === 'play' && this.pub.turn === s && this.spaceDraws(this.myHand[this.cursor])) {
          this.act({ k: 'draw' });
          break;
        }
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
      case 'auto':
        if (e.repeat) break;
        this.autoAnte = !this.autoAnte;
        this.sfx('click');
        this.toast(this.t(this.autoAnte ? 'pAutoOn' : 'pAutoOff'), 'sys');
        if (this.autoAnte) this.maybeAutoAnte();
        this.showHud();
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
    if (!R.isColoured(id) && !this.pickCol) {
      // a wild card: ask for the colour (1-4 or a click); Enter keeps the colour the hand holds most of
      const best = this.mostColour();
      this.kart?.picker({
        title: this.t('hPick'),
        sub: this.t('hPickSub', { play: this.k('primary'), c: this.colourName(best), cancel: this.k('secondary') }),
        best,
        names: { R: this.t('cR'), Y: this.t('cY'), G: this.t('cG'), B: this.t('cB') },
        keys: { R: this.k('n1'), Y: this.k('n2'), G: this.k('n3'), B: this.k('n4') },
      }, (col) => { this.act({ k: 'play', id, col, jump }); this.pickCol = ''; this.sfx('click', { vol: 0.6 }); this.showHud(); });
      this.sfx('hover');
      return;
    }
    const col = R.isColoured(id) ? '' : this.pickCol;
    this.act({ k: 'play', id, col, jump });
    this.pickCol = '';
  }

  /** Client-side mirror of R.canPlay for the local hand (the drawn card is unknown here, so it counts as playable). */
  private looksPlayable(id: string | undefined): boolean {
    const p = this.pub;
    if (!id) return false;
    if (p.pend > 0) return p.house[0] && (p.pk === 'd2' ? R.faceOf(id) === '+2' : p.pk === 'w4' ? id === 'W+4' : false);
    if (id === 'W+4') return !this.myHand.some((c) => R.isColoured(c) && R.colourOf(c) === p.col);
    if (R.isWild(id)) return true;
    if (R.colourOf(id) === p.col) return true;
    return R.isColoured(p.top) && R.faceOf(id) === R.faceOf(p.top);
  }

  /** True when the play key should draw (or pass after a drawn card) instead of playing `cursorId`. */
  private spaceDraws(cursorId: string | undefined): boolean {
    if (this.pub.dr) return !this.looksPlayable(cursorId);
    return !this.myHand.some((c) => this.looksPlayable(c));
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

  /** The seat of the (first) human at the table, the grudge bot's favourite target; -1 with none. */
  private humanSeat(): number { return this.humans()[0]?.seat ?? -1; }

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
        const d = R.botDecide(g, b.seat, b.level, b.rng, -1, R.personaOf(b.seat), this.humanSeat());
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
    const per = R.personaOf(seat);
    const d = R.botDecide(g, seat, bot.level, rng, rich, per, this.humanSeat());
    let res: R.Result;
    switch (d.k) {
      case 'play': res = R.applyPlay(g, rng, seat, d.id, { col: d.col || undefined, debtUnit: du, wealthiest: rich, callOn: rng.chance(per.call) }); break;
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
      this.addBot(s, t(`m.sonkart.bot${s + 1}`), R.personaOf(s).level);
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
  /**
   * Router hook (wiring): may a human take this seat from the bot sitting in it? Between rounds always; mid-round only
   * with the coins for the table stake (the human takes over the bot's cards, and pays the ante the house paid).
   */
  canTakeBotSeat(seat: number, pid: PlayerId): boolean {
    if (!this.isHost) return false;
    const cur = this.seats[seat];
    if (cur === null || !isBot(cur)) return false;
    const h = this.h;
    if (h.ph !== 'play' || !h.g || !h.g.play[seat] || h.g.over) return true;
    return this.ctx.run.wallet(pid) >= (h.stake[seat] || this.def.minBet);
  }

  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) { this.placeBot(seat, true); this.refreshLamps(); return; }
    this.parts.bots[seat]?.setVisible(false);                       // a human took the chair: the mannequin is gone
    if (this.isHost) this.takeOverMidRound(pid, seat);
    if (local) {
      this.cursor = 0; this.sfx('chime');
      this.relayout();                                              // the top card turns to face the new seat
      this.seatHud?.show(); this.showHud(); this.paintScreen();
    }
    this.refreshLamps();
  }

  /** HOST: a human sat where a bot was playing. They inherit its cards and pay the table stake. */
  private takeOverMidRound(pid: PlayerId, seat: number): void {
    const h = this.h, g = h.g;
    if (h.ph !== 'play' || !g || !g.play[seat] || g.over) return;
    const stake = h.stake[seat] || this.def.minBet;
    if (!this.chargeSeat(seat, stake, pid)) { this.nak(pid, 0, 'm.sonkart.eNoFunds'); return; }
    h.stake[seat] = stake;
    this.sendHands(false);
    if (g.turn === seat) this.beginTurn();
  }

  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (local) {
      this.seatHud?.hide(); this.kart?.hide(); this.autoAnte = false; this.drawCue(false);
      this.parts.bots.forEach((b, i) => { const q = this.seats[i]; b.setVisible(q !== null && q !== undefined && isBot(q)); });
    }
    if (isBot(pid)) { this.placeBot(seat, false); this.refreshLamps(); return; }
    if (this.isHost) {
      const h = this.h, g = h.g;
      if (h.ph === 'bet' && h.antes[seat]) {
        const stake = h.stake[seat];
        this.paySeat(seat, stake, { bet: stake, tier: 'push', tags: ['refund'] }, pid);
        h.pot -= stake; h.antes[seat] = false; h.stake[seat] = 0;
        void this.emit({ k: 'ph', v: this.pubNow() });
      }
      if (h.ph === 'play' && g && g.play[seat] && !g.over) {
        this.addBot(seat, t(`m.sonkart.bot${seat + 1}`), R.personaOf(seat).level);
        if (g.turn === seat) this.beginTurn();
      }
      this.sendHands(false);
    }
    if (local) { this.hud(null); this.setHandView([]); this.myHand = []; }
    this.refreshLamps();
  }

  /** A house mannequin sits down in its chair (facing the middle) or leaves it; the seat camera sees them over the rail. */
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
        this.maybeAutoAnte();
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

  /** AUTO ANTE: in every betting window the seated player antes the stake they last chose, while they can afford it. */
  private maybeAutoAnte(): void {
    const s = this.localSeat;
    if (!this.autoAnte || s < 0 || this.pub.ph !== 'bet' || this.pub.inR[s]) return;
    if (this.ctx.run.wallet() < this.bet) { this.autoAnte = false; this.toast(this.t('eNoFunds'), 'warn'); this.showHud(); return; }
    this.ctx.timers.after(0.6, () => { if (this.autoAnte && this.pub.ph === 'bet' && !this.pub.inR[this.localSeat] && this.localSeat >= 0) this.act({ k: 'ante', amt: this.bet }); });
  }

  /**
   * A house mannequin's reaction: a short text bubble with a few typewriter ticks. The mannequins never speak.
   * Gated by a hash of public facts so every peer shows (or skips) the same line.
   */
  private quip(seat: number, kind: 'atk' | 'caught' | 'win', always = false): void {
    const pid = this.seats[seat];
    if (pid === null || !isBot(pid)) return;
    const gate = ((this.pub.rnd * 31 + seat * 17 + this.pub.deck * 7 + this.pub.cnt[seat]) >>> 0) % 100;
    if (!always && gate >= 45) return;
    const per = R.personaOf(seat);
    const text = this.t(`q_${per.id}_${kind}`);
    this.ctx.fx.popText(this.parts.seatLamps[seat].root, text, 0xf2d9a0, { dur: 1.4 });
    for (let i = 0; i < Math.min(5, text.length); i++) this.ctx.timers.after(0.07 * i, () => this.sfx('hover', { vol: 0.28, pitch: 4 + (i % 3) * 2 + seat }));
  }

  private async animDeal(fast: boolean): Promise<void> {
    this.sfx('shuffle');
    this.relayout();
    if (!fast) {
      for (let k = 0; k < R.HAND0; k++) {
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
  }

  private async animFx(f: R.Fx, fast: boolean): Promise<void> {
    const p = this.parts, dur = fast ? 0.01 : 0.3;
    switch (f.k) {
      case 'play': {
        // the card leaves the hand (or the opponent's fan) at the size of the top card and travels to the exact centre of the felt
        const from = f.seat === this.localSeat ? this.handLocal(Math.max(0, this.myHand.indexOf(f.id)), this.myHand.length) : p.handSpots[f.seat].clone();
        const tmp = p.top.add(f.id, from, L.seatYaw(f.seat));
        this.sfx(f.fx === 'w4' ? 'thud' : 'cardFlip');
        await p.top.move(tmp, p.discSpot.clone(), dur, { arc: 0.16, rotY: this.topYaw() });
        if (this.topId >= 0 && this.topId !== tmp) p.top.remove(this.topId);
        this.topId = tmp; this.topShown = f.id; this.topYawAt = this.topYaw();
        this.flashColour(f.col);
        this.tagPop(f);
        if (f.fx === 'skip' || f.fx === 'rev' || f.fx === 'd2' || f.fx === 'w4' || f.fx === 'debt' || f.fx === 'curse' || f.fx === 'jp') this.ctx.fx.shake(f.fx === 'w4' ? 0.035 : 0.018, 0.25);
        if (f.j) this.ctx.fx.popText(p.discardAnchor, this.t('pJump'), 0x40ffb0, 0.9);
        if (f.fx === 'd2' || f.fx === 'w4' || f.fx === 'skip' || f.fx === 'debt' || f.fx === 'curse') this.quip(f.seat, 'atk');
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
        this.quip(f.seat, 'caught', true);
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
      if (bot) this.quip(w, 'win', true);
      else this.ctx.fx.popText(at, fmtCoins(ev.gross), 0xffd040, 1.4);
    }
    if (w === this.localSeat && w >= 0) {
      this.seatHud?.result('win', Math.max(0, ev.gross - this.bet));
      const tier = juiceTier(ev.gross, Math.max(1, this.bet), []);
      void this.celebrate(tier, { amount: ev.gross, at: p.coinOut, fast: pc.fast });
    } else if (wasIn) {
      this.seatHud?.result('lose', -this.bet);
      this.commiserate({ at: p.coinOut });
    } else {
      this.sfx(w >= 0 ? 'lose' : 'click');
    }
    if (this.isLocalOccupant) this.setHandView([]);
    this.refreshLamps();
    this.paintScreen();
  }

  /** The colour ring takes the colour in force; a glow and the light bar answer it. */
  private flashColour(col: string): void {
    const hex = COLOUR_HEX[col] ?? 0xffffff;
    this.parts.ring.color.setHex(hex);
    for (let i = 0; i < 8; i++) this.parts.strip.setBulb(i, hex);
    this.parts.strip.pattern('all');
    this.ctx.fx.glow(this.parts.discardAnchor, hex, 0.6, 0.4);
    this.ctx.fx.flash(hex, 0.12, 0.25);
  }

  private flashLights(): void {
    this.parts.strip.pattern(this.pub.jp ? 'chase' : 'all', this.pub.jp ? 6 : 0);
  }

  // ── table pools ──────────────────────────────────────────────────────────────────────────────
  /** The top card reads upright for the local player (the front of the table when only watching). */
  private topYaw(): number { return this.localSeat >= 0 ? L.seatYaw(this.localSeat) : 0; }

  /** Re-fans the face-down backs of every opponent and the draw pile; updates the discard top. */
  private relayout(): void {
    const p = this.parts, tb = p.table;
    for (const list of this.backs) for (const id of list) tb.remove(id);
    this.backs = [[], [], [], []];
    for (let s = 0; s < this.def.seats; s++) {
      if (!this.pub.inR[s] || s === this.localSeat) continue;
      // each card a hair above the last so the overlapping backs never fight for the same depth
      L.fanSpots(s, Math.min(this.pub.cnt[s] ?? 0, 9)).forEach((f, k) => this.backs[s].push(tb.add(null, new THREE.Vector3(f.x, L.CARD_Y + k * 0.0012, f.z), f.yaw)));
    }
    this.deckIds.forEach((id) => tb.remove(id));
    this.deckIds = [];
    const decks = Math.min(4, Math.ceil(this.pub.deck / 12));
    for (let k = 0; k < decks; k++) this.deckIds.push(tb.add(null, p.deckSpot.clone().add(new THREE.Vector3(0, k * 0.0045, 0)), 0));
    const yaw = this.topYaw();
    if (this.pub.top !== this.topShown || this.topId < 0 || yaw !== this.topYawAt) {
      if (this.topId >= 0) p.top.remove(this.topId);
      this.topId = this.pub.top ? p.top.add(this.pub.top, p.discSpot.clone(), yaw) : -1;
      this.topShown = this.pub.top; this.topYawAt = yaw;
    }
  }

  /** Flies one face-down card from the draw pile to `s`'s spot (or the local hand). */
  private flyFromDeck(s: number, dur: number): Promise<void> {
    const p = this.parts, tb = p.table;
    const to = s === this.localSeat ? this.handLocal(this.myHand.length, this.myHand.length + 1) : p.handSpots[s].clone();
    const tmp = tb.add(null, p.deckSpot.clone(), 0);
    return tb.move(tmp, to, dur, { arc: 0.12 }).then(() => { tb.remove(tmp); });
  }

  /** Seat lamps (turn: gold and blinking, in the round: green), the pads on free chairs, the colour ring and the turn pointer. */
  private refreshLamps(): void {
    const { ph, turn, inR, col } = this.pub, p = this.parts;
    p.seatLamps.forEach((l, s) => {
      const on = ph === 'play' && s === turn;
      l.setColor(on ? 0xffd040 : (inR[s] ? 0x40ff70 : 0x2a2a2a));
      l.setOn(on || inR[s]);
      if (on) l.blink(1.5);
    });
    p.chairLamps.forEach((l, s) => l.setOn(this.seats[s] === null));
    p.ring.color.setHex(col ? COLOUR_HEX[col] : RING_IDLE);
    p.pointer.visible = ph === 'play' && turn >= 0;
  }

  /** The pointer on the felt swings round to the seat that has the turn (render rate). */
  private turnPointer(dt: number): void {
    const p = this.parts.pointer, t = this.pub.turn;
    if (!p.visible || t < 0) return;
    const goal = Math.atan2(-L.SEAT_DIR[t][1], L.SEAT_DIR[t][0]);
    const d = Math.atan2(Math.sin(goal - this.pointerYaw), Math.cos(goal - this.pointerYaw));
    this.pointerYaw += d * Math.min(1, dt * 9);
    p.rotation.y = this.pointerYaw;
  }

  // ── the first-person hand ───────────────────────────────────────────────────────────────────
  /** Hand-root local point for slot `i` of `n` cards (for flights into the hand). */
  private handLocal(i: number, n: number): THREE.Vector3 {
    const hr = this.parts.handRoot;
    const p = this.handSlot(i, Math.max(n, 1));
    return p.applyQuaternion(hr.quaternion).add(hr.position);
  }

  /** Sideways pitch and fan angle between neighbouring cards (the whole hand stays about 0.6 m wide / 50 degrees). */
  private handPitch(n: number): number { return Math.min(0.06, 0.62 / Math.max(1, n - 1)); }
  private handStep(n: number): number { return Math.min(0.1, 0.9 / Math.max(1, n - 1)); }

  /** It is the local player's turn in a running round: playable cards rise, the others are dimmed. */
  private canAct(): boolean { return this.pub.ph === 'play' && this.localSeat >= 0 && this.pub.turn === this.localSeat; }

  private handSlot(i: number, n: number): THREE.Vector3 {
    const x = (i - (n - 1) / 2) * this.handPitch(n);
    // z is down the screen: the chosen card lifts most, a playable card rises, a card that cannot go sinks a little
    const z = (i === this.cursor ? -0.022 : 0) + (this.canAct() ? (this.looksPlayable(this.myHand[i]) ? -0.03 : 0.01) : 0);
    return new THREE.Vector3(x, 0.001 * (i + 1), 0.035 * Math.pow(x / 0.5, 2) + z);
  }

  /** Re-deals the viewmodel hand: cards face the camera, the selected card lifts, an unplayable card is dimmed. */
  private setHandView(c: string[]): void {
    const p = this.parts;
    p.hand.clear();
    const n = c.length, pitch = this.handPitch(n), step = this.handStep(n), act = this.canAct();
    for (let i = 0; i < HAND_MAX; i++) {
      const m = p.hitHand[i];
      if (i >= n) { m.position.set(0, -50, 0); continue; }
      const at = this.handSlot(i, n);
      const yaw = -((i - (n - 1) / 2) * step);
      p.hand.add(c[i], at, yaw);
      // the pick plane (dark when the card cannot be played now) covers only the strip of the card the next one leaves visible
      const vis = i === n - 1 ? HIT_W : Math.min(HIT_W, pitch), sh = (vis - HIT_W) / 2;
      m.scale.x = vis / HIT_W;
      m.position.set(at.x + Math.cos(yaw) * sh, at.y + 0.0015, at.z - Math.sin(yaw) * sh);
      m.rotation.set(-Math.PI / 2, 0, yaw);
      m.material = act && !this.looksPlayable(c[i]) ? p.dimMat : p.hitMat;
    }
  }

  /**
   * Every render frame: the turn pointer swings, the hand is held HAND_DIST ahead of the eye with its centre 0.1 of the screen height
   * above the seat HUD's bottom stack (`--seat-bot-t`, so it never covers the stake readout), and the opponents' chips follow their seats.
   */
  frame(dt: number, _t: number): void {
    this.turnPointer(dt);
    if (this.localSeat < 0) return;
    const cam = this.ctx.camera, ui = this.ctx.ui.root;
    const root = this.model.root, hr = this.parts.handRoot;
    const cp = new THREE.Vector3(), cq = new THREE.Quaternion();
    cam.getWorldPosition(cp);
    cam.getWorldQuaternion(cq);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cq);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cq);
    const botTop = parseFloat(ui.style.getPropertyValue('--seat-bot-t')) / (ui.clientHeight || 1);
    const at = Math.min(0.66, Math.max(0.45, (Number.isFinite(botTop) ? botTop : 0.7) - 0.1));   // hand centre, fraction of the height from the top
    const world = cp.clone().addScaledVector(fwd, HAND_DIST).addScaledVector(up, (1 - 2 * at) * HAND_DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    hr.position.copy(root.worldToLocal(world));
    const rq = new THREE.Quaternion();
    root.getWorldQuaternion(rq);
    const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    hr.quaternion.copy(rq.clone().invert()).multiply(cq).multiply(face);
    this.placeChips(ui);
  }

  /** Hangs each opponent's name chip over their seat: the seat's anchor projected through the seat camera. */
  private placeChips(ui: HTMLElement): void {
    const v = this.tmpV, w = ui.clientWidth, h = ui.clientHeight, at: Array<{ seat: number; x: number; y: number }> = [];
    for (let s = 0; s < this.def.seats; s++) {
      if (s === this.localSeat) continue;
      v.set(...L.chipAnchor(s));
      this.model.root.localToWorld(v).project(this.ctx.camera);
      at.push({ seat: s, x: (v.x * 0.5 + 0.5) * w, y: (0.5 - v.y * 0.5) * h });
    }
    this.kart?.place(at);
  }

  // ── HUD, screen, rules ──────────────────────────────────────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private rulesLines(): Txt[] {
    return [1, 2, 3, 4, 5, 6].map((n) => ({ k: `m.sonkart.rules${n}` }));
  }

  /** Banner, key numbers and the valid controls only. Only while the local player sits here. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.localSeat, pub = this.pub;
    const mine = s >= 0 && pub.inR[s] === true;
    const myTurn = pub.ph === 'play' && s >= 0 && pub.turn === s;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.sonkart.goal' });

    // STATE: phase and whose turn
    if (pub.ph === 'bet') {
      if (mine) sh.state({ k: 'm.sonkart.stAnted' }, 'cyan', { k: 'm.sonkart.stAntedSub' });
      else sh.state({ k: 'm.sonkart.stAnte' }, 'gold', { k: 'm.sonkart.stAnteSub', v: { n: fmtCoins(this.bet) } });
    } else if (pub.ph === 'play') {
      if (myTurn) sh.state({ k: 'm.sonkart.stTurn' }, 'good', pub.pend > 0 ? { k: 'm.sonkart.stOwed', v: { n: pub.pend } } : undefined);
      else sh.state({ k: 'm.sonkart.stOther' }, 'cyan', { k: 'm.sonkart.stOtherOf', v: { name: this.seatName(pub.turn) } });
    } else {
      sh.state({ k: 'm.sonkart.stEnd' }, 'neutral');
    }

    // KEY NUMBERS
    const nums: HudNumber[] = [];
    if (pub.ph === 'bet') nums.push({ label: { k: 'm.sonkart.nAnte' }, value: fmtCoins(this.bet), tone: 'gold' });
    nums.push({ label: { k: 'm.sonkart.nPot' }, value: fmtCoins(pub.pot), tone: 'gold' });
    if (pub.pend > 0) nums.push({ label: { k: 'm.sonkart.nOwed' }, value: String(pub.pend), tone: 'bad' });
    if (this.pickCol) nums.push({ label: { k: 'm.sonkart.nColour' }, value: this.colourName(this.pickCol), tone: 'cyan' });   // the colour keys 1-4 armed for the next wild card
    sh.numbers(nums);                                // the colour in force is the ring on the table, the cards are in hand, the pocket is in the stake readout

    // CONTROL BAR: only the actions valid right now
    if (pub.ph === 'bet' && s >= 0 && !mine) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.sonkart.cAnte' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.sonkart.cBet' }, action: 'betUp' });
    }
    if (pub.ph === 'bet') ctrl.push({ key: `${this.k('n5')}-${this.k('n9')}`, label: { k: 'm.sonkart.cHouse' }, action: 'n5' });
    if (pub.ph === 'bet' || pub.ph === 'end') ctrl.push({ key: this.k('auto'), label: { k: this.autoAnte ? 'm.sonkart.nAuto' : 'm.sonkart.cAuto' }, action: 'auto' });
    if (myTurn) {
      if (!pub.dr && !this.myHand.some((c) => this.looksPlayable(c))) {
        // nothing playable: the play key draws (Space or RMB, both shown)
        ctrl.push({ key: `${this.k('primary')}/${this.k('secondary')}`, label: { k: pub.pend > 0 ? 'm.sonkart.cDrawN' : 'm.sonkart.cDraw' }, action: 'primary', primary: true });
      } else {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.sonkart.cPlay' }, action: 'primary', primary: true });
        ctrl.push({ key: this.k('secondary'), label: { k: pub.dr ? 'm.sonkart.cPass' : pub.pend > 0 ? 'm.sonkart.cDrawN' : 'm.sonkart.cDraw' }, action: 'secondary' });
      }
      if (this.jumpCard() && pub.house[2]) ctrl.push({ key: this.k('alt'), label: { k: 'm.sonkart.cJump' }, action: 'alt' });
      if (this.myHand.some((c) => !R.isColoured(c))) ctrl.push({ key: `${this.k('n1')}-${this.k('n4')}`, label: { k: 'm.sonkart.cColour' }, action: 'n1' });
    }
    if (pub.ph === 'play' && s >= 0 && pub.call >= 0 && pub.call !== s && !pub.callOn) ctrl.push({ key: this.k('collect'), label: { k: 'm.sonkart.cCatch' }, action: 'collect' });
    if (pub.ph === 'play' && s >= 0 && (this.myHand.length <= 2 || pub.call === s)) ctrl.push({ key: this.k('double'), label: { k: 'm.sonkart.cCall' }, action: 'double' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.sonkart.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.sonkart.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
    // the hand re-deals (playable cards rise, the rest are dimmed); the draw pile's tray turns gold when drawing is the move
    this.drawCue(myTurn && (pub.pend > 0 || !this.myHand.some((c) => this.looksPlayable(c))));
    this.setHandView(this.myHand);
    this.refreshKart();
  }

  private drawCue(on: boolean): void { (this.parts.deckTray.material as THREE.MeshLambertMaterial).color.setHex(on ? 0xb08a1c : 0x0d4a2c); }

  /** The DOM overlay: opponent chips and the colour / order strip, rebuilt from the public view. */
  private refreshKart(): void {
    const kh = this.kart;
    if (!kh || !this.isLocalOccupant) return;
    const pub = this.pub, me = this.localSeat;
    kh.show();
    if (kh.picking && !(pub.ph === 'play' && pub.turn === me)) kh.closePicker();
    const plates: PlateView[] = [];
    for (let s = 0; s < this.def.seats; s++) {
      const pid = this.seats[s];
      if (s === me || pid === null) continue;
      const bot = isBot(pid);
      plates.push({
        seat: s, name: this.seatName(s), tag: bot ? this.t(`pr_${R.personaOf(s).id}`) : '', cnt: pub.cnt[s] ?? 0,
        inRound: pub.ph === 'bet' ? true : pub.inR[s] === true, turn: pub.ph === 'play' && pub.turn === s, me: false,
        last: pub.ph === 'play' && pub.call === s && !pub.callOn && (pub.cnt[s] ?? 0) === 1,
        turnLabel: this.t('hTurn'), lastLabel: this.t('hLast'),
      });
    }
    kh.plateList(plates);
    kh.top({
      has: !!pub.top, colour: pub.col, colourName: this.colourName(pub.col),
      owed: pub.pend > 0 ? this.t('hOwed', { n: pub.pend }) : '', dir: pub.top ? this.t(pub.dir >= 0 ? 'hOrderF' : 'hOrderB') : '',
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
      const line = (txt: string, y: number, color: string): void => { s.text(txt, s.w / 2, y, { font: 'px5', color, align: 'center', scale: 2 }); };
      const cl = pub.col ? COLOUR_HEX[pub.col] : 0xffffff;
      line(pub.ph === 'bet' ? this.t('sBots') : this.t('sRound', { n: pub.rnd }), 8, '#' + (pub.ph === 'bet' ? 'e8f5e8' : 'ffd040'));
      line(`${this.t('scrColour')} ${this.colourName(pub.col)}  ${this.t('scrPot')} ${fmtCoins(pub.pot)}`, 34, '#' + cl.toString(16).padStart(6, '0'));
      const tail = pub.pend > 0 ? this.t('scrPend', { n: pub.pend }) : pub.jp ? this.t('scrJackpot') : pub.call >= 0 && pub.callOn ? this.t('scrCalled') : '';
      line(tail, 60, '#ff9040');
      line(pub.ph === 'play' && pub.turn >= 0 ? this.t('sTurnOf', { name: this.seatName(pub.turn) }) : this.t('sWait'), 86, '#b8b8b8');
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
    this.parts.table.clear(); this.parts.top.clear();
    this.relayout();
    this.setHandView(this.myHand);
    this.refreshLamps();
    this.paintScreen();
  }
}
