/**
 * Tavla (`tavla`) — Turkish backgammon at a 2–4 seat parlour table with a doubling cube (BRIEF ADDENDUM 6, DECISIONS B).
 *
 * Shape (the TableBase pattern of blackjack / demoTable):
 *  - HOST ONLY (`hs`): the board, the dice, the cube, the stakes, the queue and every timer. Clients send `act()`
 *    (ready + stake, roll, double, take/drop, step); the host validates with the pure rules (`rules.ts`), charges and
 *    pays through the seat helpers, and publishes every move as a PUBLIC event (tavla has no hidden hands: the dice
 *    are public). Events run through `present` on every peer, the host included, in order.
 *  - `st` is the presented state (mutated only in `present`); `hs` is the authority and may run ahead of the queue.
 *  - Match: the king (last winner, or the first seated player) plays the first waiting seat. Two humans or a human
 *    and a mannequin bot. A lone human always has a bot opponent on the far seat; bots leave when a second human sits.
 *  - Stakes: each side stakes `unit` (buy-in, coins) when both are ready. Cube: stakes double on a take (the taker
 *    owns the cube). Settle: winner gets their stake + the loser's stake × multiplier (single 1, mars 2, çifte mars 3).
 *    A drop pays the doubler the stake as it stands. Leaving mid-game forfeits the stake to the other side.
 *
 * Controls: Space / Enter ready or roll · ← → (or wheel keys) stake · R (n1) double · Y (n6) take · N (n7) drop ·
 * mouse: click a pul (or the bar / a point), then the target point · right click cancels · H (help) opens the rules sheet.
 *
 * Juice: anticipation before the roll (the dice cup lifts), dice tumble and land, checker glide with arc and landing
 * thud, hit = red pop text, shake and sparks, doubles = gold sparks, cube slides and spins, take/drop stings, win tiers
 * escalate with the multiplier (mars = big, çifte mars = huge), loss commiseration for the loser.
 */
import * as THREE from 'three';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint, PanelHandle } from '@/core/ui/types';
import type { Rng } from '@/core/rng';
import { fmtCoins } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { juiceTier, tierAtLeast, type JuiceTier } from '@/machines/_base/tiers';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { KitX } from '@/kit/index';
import { STRINGS } from './tavla.strings';
import {
  buildModel, BOT_TINT, DICE_FROM, DICE_REST, SEATS, TOP, barAt, cubeAt, offAt, pointXZ, stackAt, type TavlaParts,
} from './model';
import * as R from './rules';

const GOLD = 0xffd040, RED = 0xff4a3a, CREAM = 0xf2e6c4;
const STAKE_S = 15, ROLL_S = 20, MOVE_S = 25, CUBE_S = 15, OVER_S = 4.5, IDLE_S = 1;

type Ph = 'idle' | 'stake' | 'roll' | 'move' | 'cube' | 'over';
type Pub = {
  ph: Ph; k: number; a: number; b: number; q: number[];
  unit: number; cube: number; owner: number; offer: number; turn: number;
  dice: number[]; left: number[]; rdy: boolean[]; stake: number[];
  board: R.Board; res: { w: number; m: number; gross: number } | null;
};
type Ev =
  | { k: 'match'; a: number; b: number; king: number; unit: number; board: R.Board }
  | { k: 'rdy'; side: number; on: boolean }
  | { k: 'cancel' }
  | { k: 'open'; r: number[]; first: number; unit: number }
  | { k: 'roll'; side: number; dice: number[] }
  | { k: 'step'; side: number; f: number; t: number; d: number; hit: boolean }
  | { k: 'end'; side: number; next: number }
  | { k: 'cube'; side: number; to: number }
  | { k: 'cubeAns'; take: boolean; cube: number; owner: number; side: number }
  | { k: 'over'; w: number; m: number; gross: number; stake: number; why: string }
  | { k: 'idle' };
type Act =
  | { k: 'ready'; unit: number } | { k: 'roll' } | { k: 'double' } | { k: 'take'; take: boolean }
  | { k: 'step'; f: number; t: number };

const freshPub = (): Pub => ({
  ph: 'idle', k: -1, a: -1, b: -1, q: [], unit: 10, cube: 1, owner: -1, offer: -1, turn: -1,
  dice: [], left: [], rdy: [false, false], stake: [0, 0], board: R.startBoard(), res: null,
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const def: MachineDef = {
  id: 'tavla',
  category: 'party',
  slotSize: 'L',
  zone: 'parlour',
  seats: SEATS,
  shared: true,
  minBet: 10, maxBet: 500,
  // host sanity cap: winner's stake plus a mars (×2) or çifte mars (×3) of the loser's equal stake
  maxPayoutMult: 4,
  tier: 1,
  actionCost: 1,
  tags: ['table', 'party', 'dice', 'skill', 'gamble'],
  party: {
    minPlayers: 2, maxPlayers: 4, bots: true, botLevels: 3,
    buyIn: { min: 10, max: 500 },
    spectatorBets: false,
    houseRules: { doubling: true, mars: true, cifteMars: true },
    hidden: false,
    turnTimerS: MOVE_S,
  },
  modHooks: {},
  strings: STRINGS,
};

export default class Tavla extends TableBase<TavlaParts, Ev, Pub, Act> {
  /** What every peer sees (mutated only in `present`). */
  private st: Pub = freshPub();
  /** HOST ONLY authority state. */
  private hs: Pub = freshPub();
  /** HOST ONLY: stake proposals of the human players for the next match. */
  private prop: Array<number | null> = [null, null];
  private timer = 0;
  private botT = 0;
  private idleT = 0;
  /** Local: the picked source (distance for the local side), −1 none. */
  private sel = -1;
  private rules: PanelHandle | null = null;

  protected createModel(kit: KitX): MachineModel<TavlaParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.assignPieces(this.st.board);
    this.layoutPieces();
    this.repaint();
  }

  // ── local input ─────────────────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down || e.repeat) return;
    const st = this.st, me = this.localSide();
    const readyNow = st.ph === 'stake' && me >= 0 && !st.rdy[me];
    switch (e.action) {
      case 'primary': case 'confirm':
        if (readyNow) this.act({ k: 'ready', unit: this.bet });
        else if (st.ph === 'roll' && st.turn === me) this.act({ k: 'roll' });
        break;
      case 'betUp': case 'betDown': case 'betMax':
        if (!readyNow) break;
        if (e.action === 'betUp') this.stepBet(1); else if (e.action === 'betDown') this.stepBet(-1); else this.maxBet();
        this.sfx('click'); this.showHud();
        break;
      case 'n1':
        if (st.ph === 'roll' && st.turn === me && this.canDouble(me)) this.act({ k: 'double' });
        break;
      case 'n6':
        if (st.ph === 'cube' && me >= 0 && st.offer !== me) this.act({ k: 'take', take: true });
        break;
      case 'n7':
        if (st.ph === 'cube' && me >= 0 && st.offer !== me) this.act({ k: 'take', take: false });
        break;
      case 'secondary':
        this.sel = -1; this.markTargets();
        break;
      case 'help':
        this.toggleRules();
        break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down') return;
    if (e.button === 2) { this.sel = -1; this.markTargets(); return; }
    if (e.button === 0) this.clickBoard();
  }

  private clickBoard(): void {
    const st = this.st, me = this.localSide(), P = this.parts;
    if (st.ph !== 'move' || me < 0 || st.turn !== me || !P?.hits) return;
    const targets: THREE.Object3D[] = [...P.hits, ...P.pieces.filter((m) => m.visible)];
    const hit = this.pick(targets as THREE.Mesh[]);
    if (!hit) return;
    const d = this.distFor(hit.object, me);
    if (d === null) return;
    const legal = R.legalSteps(st.board, me, st.left);
    if (this.sel >= 0 && legal.some((s) => s.f === this.sel && s.t === d)) {
      this.act({ k: 'step', f: this.sel, t: d });
      this.sel = -1; this.markTargets();
      return;
    }
    if (legal.some((s) => s.f === d)) {
      this.sel = d === this.sel ? -1 : d;
      this.sfx('click');
    } else {
      this.toast(this.t('badMove'), 'warn');
      this.sfx('buzzer');
    }
    this.markTargets();
  }

  /** Distance of a clicked object for `me`: a point, own bar (25) or own bear-off tray (0); null if none. */
  private distFor(obj: THREE.Object3D, me: number): number | null {
    const ud = obj.userData;
    if (ud.piece) {
      const s = ud.side as number, d = ud.d as number;
      if (d === R.OFF) return s === me ? R.OFF : null;
      if (d === R.BAR) return s === me ? R.BAR : null;
      if (s === me) return d;
      const abs = s === 0 ? d : 25 - d;
      return me === 0 ? abs : 25 - abs;
    }
    if (ud.p !== undefined) { const p = ud.p as number; return me === 0 ? p : 25 - p; }
    if (ud.bar !== undefined) return ud.bar === me ? R.BAR : null;
    if (ud.off !== undefined) return ud.off === me ? R.OFF : null;
    return null;
  }

  /** Pooled gold rings on the legal targets of the picked pul. */
  private markTargets(): void {
    const P = this.parts;
    if (!P?.markers) return;
    const st = this.st, me = this.localSide();
    const targets = this.sel >= 0 && me >= 0 && st.ph === 'move'
      ? R.legalSteps(st.board, me, st.left).filter((s) => s.f === this.sel).map((s) => s.t) : [];
    P.markers.forEach((mk, i) => {
      const t = targets[i];
      if (t === undefined) { mk.visible = false; return; }
      mk.visible = true;
      if (t === R.OFF) mk.position.copy(offAt(me, 0)).setY(TOP + 0.004);
      else {
        const abs = me === 0 ? t : 25 - t;
        const q = pointXZ(abs);
        mk.position.set(q.x, TOP + 0.004, q.z);
      }
    });
  }

  // ── local helpers ───────────────────────────────────────────────────────────────────────────────
  /** Side (0 = seat a, 1 = seat b) of the local player in the presented match, −1 when watching. */
  private localSide(): number {
    const seat = this.localSeat;
    if (seat < 0) return -1;
    if (seat === this.st.a) return 0;
    if (seat === this.st.b) return 1;
    return -1;
  }
  private canDouble(side: number): boolean {
    const st = this.st;
    return side >= 0 && (st.owner === -1 || st.owner === side) && st.cube < R.CUBE_MAX;
  }
  private nameOf(side: number): string {
    if (side < 0) return '';
    const seat = side === 0 ? this.st.a : this.st.b;
    const pid = seat >= 0 ? this.seats[seat] : null;
    if (pid === null || pid === undefined) return this.t('sQueue');
    if (isBot(pid)) return this.bots.find((b) => b.seat === seat)?.name ?? this.t('bot');
    return this.ctx.net.playerName(pid);
  }

  // ── HOST: actions ───────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    const side = seat === hs.a ? 0 : seat === hs.b ? 1 : -1;
    if (side < 0) { this.nak(pid, rid, 'm.tavla.noReady'); return; }
    switch (a.k) {
      case 'ready': return this.onReady(side, a.unit, pid, rid);
      case 'roll':
        if (hs.ph !== 'roll' || hs.turn !== side) { this.nak(pid, rid, 'm.tavla.notYourTurn'); return; }
        this.doRoll(side);
        return;
      case 'double':
        if (hs.ph !== 'roll' || hs.turn !== side) { this.nak(pid, rid, 'm.tavla.notYourTurn'); return; }
        if (!this.hostCanDouble(side)) { this.nak(pid, rid, 'm.tavla.noDouble'); return; }
        this.offerDouble(side);
        return;
      case 'take':
        if (hs.ph !== 'cube' || hs.offer === side || hs.offer < 0) { this.nak(pid, rid, 'm.tavla.noCube'); return; }
        this.answerCube(a.take);
        return;
      case 'step': {
        if (hs.ph !== 'move' || hs.turn !== side) { this.nak(pid, rid, 'm.tavla.notYourMove'); return; }
        const st = R.legalSteps(hs.board, side, hs.left).find((x) => x.f === a.f && x.t === a.t);
        if (!st) { this.nak(pid, rid, 'm.tavla.badMove'); return; }
        this.playStep(st);
        return;
      }
    }
  }

  private hostCanDouble(side: number): boolean {
    const hs = this.hs;
    return (hs.owner === -1 || hs.owner === side) && hs.cube < R.CUBE_MAX;
  }

  private onReady(side: number, unit: number, pid: PlayerId, rid: number): void {
    const hs = this.hs;
    if (hs.ph !== 'stake') { this.nak(pid, rid, 'm.tavla.noReady'); return; }
    if (hs.rdy[side]) return;
    const u = Number.isFinite(unit) ? Math.min(this.def.maxBet, Math.max(this.def.minBet, Math.round(unit))) : this.def.minBet;
    this.prop[side] = u;
    hs.rdy[side] = true;
    void this.emit({ k: 'rdy', side, on: true });
    if (hs.rdy[0] && hs.rdy[1]) this.commitStake();
  }

  /** Both ready: charge each side the agreed unit (atomically; a refused side is sent back to ready). */
  private commitStake(): void {
    const hs = this.hs;
    const props = this.prop.filter((v): v is number => v !== null && v !== undefined);
    const unit = props.length ? Math.min(...props) : this.def.minBet;
    const done: number[] = [];
    for (const side of [0, 1]) {
      const seat = side === 0 ? hs.a : hs.b;
      if (this.chargeSeat(seat, unit)) { done.push(seat); continue; }
      for (const s of done) this.refund(s, unit);
      this.noFunds(seat);
      this.prop[side] = null;
      hs.rdy[side] = false;
      void this.emit({ k: 'rdy', side, on: false });
      return;
    }
    hs.unit = unit;
    hs.stake = [unit, unit];
    this.opening(unit);
  }

  private opening(unit: number): void {
    const hs = this.hs;
    let r0 = 0, r1 = 0;
    do { r0 = this.hostRng.int(1, 6); r1 = this.hostRng.int(1, 6); } while (r0 === r1);
    const first = r0 > r1 ? 0 : 1;
    hs.turn = first;
    hs.dice = [r0, r1];
    hs.left = [r0, r1];
    hs.unit = unit;
    this.setPhase('move', MOVE_S);
    void this.emit({ k: 'open', r: [r0, r1], first, unit });
  }

  /** Roll for `side`. No playable move ends the turn at once. */
  private doRoll(side: number): void {
    const hs = this.hs;
    const d1 = this.hostRng.int(1, 6), d2 = this.hostRng.int(1, 6);
    hs.dice = [d1, d2];
    hs.left = R.expand(d1, d2);
    void this.emit({ k: 'roll', side, dice: [d1, d2] });
    if (R.legalSteps(hs.board, side, hs.left).length === 0) this.endTurn(side);
    else this.setPhase('move', MOVE_S);
  }

  private endTurn(side: number): void {
    const hs = this.hs;
    const next = 1 - side;
    hs.turn = next;
    hs.left = [];
    this.setPhase('roll', ROLL_S);
    void this.emit({ k: 'end', side, next });
  }

  private offerDouble(side: number): void {
    const hs = this.hs;
    hs.offer = side;
    this.setPhase('cube', CUBE_S);
    void this.emit({ k: 'cube', side, to: R.nextCube(hs.cube) });
  }

  /** The responder (the side not holding the offer) takes or drops. */
  private answerCube(take: boolean): void {
    const hs = this.hs;
    const off = hs.offer, resp = 1 - off;
    const rs = resp === 0 ? hs.a : hs.b, os = off === 0 ? hs.a : hs.b;
    if (take) {
      const amt = hs.unit * hs.cube;                          // each side adds a stake equal to the old total
      const paidR = this.chargeSeat(rs, amt);
      const paidO = paidR && this.chargeSeat(os, amt);
      if (paidR && paidO) {
        hs.stake = [hs.stake[0] + amt, hs.stake[1] + amt];
        hs.cube = R.nextCube(hs.cube);
        hs.owner = resp;
        hs.offer = -1;
        this.setPhase('roll', ROLL_S);
        void this.emit({ k: 'cubeAns', take: true, cube: hs.cube, owner: resp, side: off });
        return;
      }
      if (paidR) this.refund(rs, amt); else this.noFunds(rs);
    }
    hs.offer = -1;
    void this.emit({ k: 'cubeAns', take: false, cube: hs.cube, owner: hs.owner, side: off });
    this.finishGame(off, 'drop');
  }

  private playStep(st: R.Step): void {
    const hs = this.hs, side = st.s;
    hs.board = R.applyStep(hs.board, st);
    hs.left = R.spend(hs.left, st.d);
    this.botT = 0.55;
    void this.emit({ k: 'step', side, f: st.f, t: st.t, d: st.d, hit: st.hit });
    if (hs.board.off[side] >= R.MEN) { this.finishGame(side, 'bear'); return; }
    const more = hs.left.length > 0 && R.legalSteps(hs.board, side, hs.left).length > 0;
    if (!more) this.endTurn(side);
    else this.timer = MOVE_S;
  }

  /** Pay the winner (stake + loser's stake × multiplier) before the show; the loser's stake is forfeited. */
  private finishGame(w: number, why: 'bear' | 'drop' | 'left'): void {
    const hs = this.hs;
    const L = 1 - w;
    const sw = w === 0 ? hs.a : hs.b, sl = L === 0 ? hs.a : hs.b;
    const m = why === 'bear' ? R.resultMult(hs.board, w) : 1;
    const stakeW = hs.stake[w], stakeL = hs.stake[L];
    const gross = stakeW + stakeL * m;
    hs.res = { w, m, gross };
    hs.k = sw;
    hs.q = hs.q.filter((s) => s !== sl);
    if (this.seats[sl] !== null && this.seats[sl] !== undefined) hs.q.push(sl);
    this.setPhase('over', OVER_S);
    void this.emit({ k: 'over', w, m, gross, stake: stakeW, why }, () => {
      this.paySeat(sw, gross, { bet: stakeW });
      this.forfeit(sl);
    });
  }

  private refund(seat: number, amt: number): void {
    const pid = this.seats[seat];
    if (pid === null || pid === undefined || isBot(pid)) return;
    this.ctx.run.hostWin(pid, amt, this.src, { bet: amt, tier: 'push', tags: ['refund'] });
  }
  private noFunds(seat: number): void {
    const pid = this.seats[seat];
    if (pid !== null && pid !== undefined && !isBot(pid)) this.nak(pid, 0, 'm.tavla.noFunds');
  }

  /** Host: set the phase and its clock; bots get a think delay in the phase they act in. */
  private setPhase(ph: Ph, secs: number): void {
    const hs = this.hs;
    hs.ph = ph;
    this.timer = secs;
    this.botT = ph === 'roll' ? 0.9 : ph === 'move' ? 0.55 : ph === 'cube' ? 1.2 : 0.5;
  }

  // ── seating: bots, queue and matches ───────────────────────────────────────────────────────────
  private botOf(side: number): { seat: number; name: string; level: number; rng: Rng } | null {
    const seat = side === 0 ? this.hs.a : this.hs.b;
    if (seat < 0) return null;
    const pid = this.seats[seat];
    if (pid === null || pid === undefined || !isBot(pid)) return null;
    return this.bots.find((b) => b.seat === seat) ?? null;
  }

  /** Idle only: one human alone gets a mannequin opponent; bots leave once a second human sits. */
  private manageBots(): void {
    const humans = this.humans().length;
    if (humans === 0 || humans >= 2) {
      for (const b of [...this.bots]) this.removeBot(b.seat);
      return;
    }
    if (this.seated().length < 2) {
      const seat = this.seats.indexOf(null);
      if (seat >= 0) {
        const level = this.hostRng.int(1, 3);
        this.addBot(seat, this.t(`botL${level}`), level as 1 | 2 | 3);
      }
    }
  }

  /** Idle: pick the king and the next waiting seat, then open the stake. */
  private tryMatch(): void {
    const hs = this.hs;
    const seated = this.seated().map((s) => s.seat);
    if (seated.length < 2) return;
    let king = hs.k;
    if (king < 0 || !seated.includes(king)) king = seated[0];
    const q = hs.q.filter((s) => seated.includes(s) && s !== king);
    for (const s of seated) if (s !== king && !q.includes(s)) q.push(s);
    const ch = q.shift() as number;
    hs.q = q;
    this.startMatch(king, ch);
  }

  private startMatch(a: number, b: number): void {
    const hs = this.hs;
    hs.a = a; hs.b = b; hs.k = a;
    hs.unit = this.def.minBet; hs.cube = 1; hs.owner = -1; hs.offer = -1; hs.turn = -1;
    hs.dice = []; hs.left = []; hs.rdy = [false, false]; hs.stake = [0, 0]; hs.res = null;
    hs.board = R.startBoard();
    this.prop = [null, null];
    this.setPhase('stake', STAKE_S);
    void this.emit({ k: 'match', a, b, king: a, unit: hs.unit, board: hs.board });
    [a, b].forEach((seat, side) => {
      const pid = this.seats[seat];
      if (pid !== null && pid !== undefined && isBot(pid)) {
        hs.rdy[side] = true;
        void this.emit({ k: 'rdy', side, on: true });
      }
    });
  }

  private cancelMatch(): void {
    const hs = this.hs;
    if (hs.b >= 0 && this.seats[hs.b] !== null && this.seats[hs.b] !== undefined) hs.q.unshift(hs.b);
    hs.ph = 'idle';
    this.idleT = IDLE_S;
    void this.emit({ k: 'cancel' });
  }

  // ── host timers ─────────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const hs = this.hs;
    switch (hs.ph) {
      case 'idle':
        if ((this.idleT -= dt) <= 0) { this.idleT = IDLE_S; this.manageBots(); this.tryMatch(); }
        break;
      case 'stake':
        if ((this.timer -= dt) <= 0) this.cancelMatch();
        break;
      case 'roll': {
        const side = hs.turn, bot = this.botOf(side);
        if (bot) { if ((this.botT -= dt) <= 0) this.botRoll(side, bot.level); }
        else if ((this.timer -= dt) <= 0) this.doRoll(side);
        break;
      }
      case 'move': {
        const side = hs.turn, bot = this.botOf(side);
        if (bot) { if ((this.botT -= dt) <= 0) this.botStep(side, bot.level, bot.rng); }
        else if ((this.timer -= dt) <= 0) this.autoStep(side);
        break;
      }
      case 'cube': {
        const resp = 1 - hs.offer, bot = this.botOf(resp);
        if (bot) { if ((this.botT -= dt) <= 0) this.answerCube(R.wantsTake(hs.board, resp, bot.level)); }
        else if ((this.timer -= dt) <= 0) this.answerCube(false);
        break;
      }
      case 'over':
        if ((this.timer -= dt) <= 0) { hs.ph = 'idle'; this.idleT = IDLE_S; void this.emit({ k: 'idle' }); }
        break;
    }
  }

  private botRoll(side: number, level: number): void {
    if (R.wantsDouble(this.hs.board, side, level) && this.hostCanDouble(side)) this.offerDouble(side);
    else this.doRoll(side);
  }
  private botStep(side: number, level: number, rng: Rng): void {
    const st = R.pickStep(this.hs.board, side, this.hs.left, level, rng);
    if (st) this.playStep(st); else this.endTurn(side);
  }
  /** Human timed out: the host plays the greedy move for them. */
  private autoStep(side: number): void {
    const st = R.pickStep(this.hs.board, side, this.hs.left, 2, this.hostRng);
    if (st) this.playStep(st); else this.endTurn(side);
  }

  // ── seats: leaving forfeits, bots show and hide ────────────────────────────────────────────────
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs;
      const side = hs.a === seat ? 0 : hs.b === seat ? 1 : -1;
      if (side >= 0 && (hs.ph === 'stake' || hs.ph === 'move' || hs.ph === 'roll' || hs.ph === 'cube')) {
        if (hs.ph === 'stake') this.cancelMatch();
        else this.finishGame(1 - side, 'left');
      }
      hs.q = hs.q.filter((s) => s !== seat);
    }
    if (isBot(pid)) this.showBot(seat, 0, false);
    if (local) { this.hud(null); this.closeRules(); this.sel = -1; }
  }

  onOccupy(pid: PlayerId, seat: number, local: boolean): void {
    if (isBot(pid)) this.showBot(seat, this.bots.find((b) => b.seat === seat)?.level ?? 2, true);
    this.repaint();
    if (local) { this.sfx('chime'); this.showHud(); }
  }

  private showBot(seat: number, level: number, on: boolean): void {
    const actor = this.parts?.bots?.[seat];
    if (!actor) return;
    if (on) {
      actor.setTint(BOT_TINT[level] ?? BOT_TINT[2], 0.6);
      actor.setVisible(true);
      void actor.play('Sitting_Idle_Loop');
    } else actor.setVisible(false);
  }

  // ── snapshots ───────────────────────────────────────────────────────────────────────────────────
  getSnapshot(_forPid?: PlayerId): Pub { return clone(this.hs); }
  applySnapshot(s: Pub): void {
    this.st = clone(s);
    if (this.isHost) this.hs = clone(s);
    this.assignPieces(this.st.board);
    this.layoutPieces();
    this.repaint();
    this.showHud();
  }

  // ── presentation (every peer, including the host) ──────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const st = this.st, P = this.parts, fast = pc.fast;
    const anchor = this.model.anchors.prompt;
    switch (ev.k) {
      case 'match':
        st.ph = 'stake'; st.a = ev.a; st.b = ev.b; st.k = ev.king; st.unit = ev.unit;
        st.cube = 1; st.owner = -1; st.offer = -1; st.turn = -1; st.dice = []; st.left = [];
        st.rdy = [false, false]; st.res = null; st.board = ev.board;
        this.sel = -1;
        this.assignPieces(st.board); this.layoutPieces();
        await this.moveCube(-1, fast);
        this.sfx('chime');
        this.ctx.fx.popText(anchor, this.t('sStake', { n: fmtCoins(ev.unit) }), GOLD, { dur: 1.1, rise: 0.25 });
        this.refresh();
        return;
      case 'rdy':
        st.rdy[ev.side] = ev.on;
        this.sfx(ev.on ? 'click' : 'buzzer');
        this.refresh();
        return;
      case 'cancel':
        st.ph = 'idle';
        this.refresh();
        return;
      case 'open':
        st.unit = ev.unit; st.ph = 'move'; st.turn = ev.first;
        st.dice = ev.r.slice(); st.left = ev.r.slice();
        await this.rollDice(ev.r, fast);
        this.sfx('diceLand');
        this.ctx.fx.popText(anchor, this.t('first', { name: this.nameOf(ev.first) }), GOLD, { dur: 1.2, rise: 0.3 });
        this.refresh();
        return;
      case 'roll':
        st.dice = ev.dice.slice(); st.left = R.expand(ev.dice[0], ev.dice[1]); st.ph = 'move'; st.turn = ev.side;
        if (!fast) await this.wait(0.16);                          // anticipation: the cup lifts
        this.sfx('dice');
        await this.rollDice(ev.dice, fast);
        this.sfx('diceLand');
        if (ev.dice[0] === ev.dice[1]) {
          this.ctx.fx.popText(anchor, this.t('doubles'), GOLD, { dur: 1.1, rise: 0.3, scale: 1.2 });
          this.ctx.fx.sparks(anchor, 12, GOLD);
        }
        this.refresh();
        return;
      case 'step': {
        const s = ev.side;
        const mover = P.pieces.find((m) => m.userData.side === s && m.userData.d === ev.f);
        const victim = ev.hit ? P.pieces.find((m) => m.userData.side === 1 - s && m.userData.d === 25 - ev.t) : undefined;
        const mFrom = mover?.position.clone(), vFrom = victim?.position.clone();
        st.board = R.applyStep({ pos: st.board.pos, bar: st.board.bar, off: st.board.off }, { s, f: ev.f, t: ev.t, d: ev.d, hit: ev.hit });
        st.left = R.spend(st.left, ev.d);
        if (mover) mover.userData.d = ev.t;
        if (victim) victim.userData.d = R.BAR;
        this.layoutPieces();
        const runs: Array<Promise<void>> = [];
        if (mover && mFrom) runs.push(this.glide(mover, mFrom, mover.position.clone(), fast ? 0.01 : 0.3, 0.14));
        if (victim && vFrom) runs.push(this.glide(victim, vFrom, victim.position.clone(), fast ? 0.01 : 0.36, 0.2));
        if (ev.hit) {
          this.sfx('thud');
          this.ctx.fx.popText(anchor, this.t('hit'), RED, { dur: 0.9, rise: 0.3, scale: 1.2 });
          this.ctx.fx.shake(0.012, 0.22);
          this.ctx.fx.sparks(barAt(1 - s, 0), 8, RED);
        } else if (ev.t === R.OFF) this.sfx('coinDrop');
        else this.sfx('tileClack', { vol: 0.8 });
        await Promise.all(runs);
        this.refresh();
        return;
      }
      case 'end':
        st.turn = ev.next; st.left = []; st.ph = 'roll';
        this.refresh();
        return;
      case 'cube':
        st.ph = 'cube'; st.offer = ev.side;
        this.sfx('chime');
        this.ctx.fx.popText(anchor, this.t('cubeLabel', { n: ev.to }), GOLD, { dur: 1.0, rise: 0.25 });
        this.refresh();
        return;
      case 'cubeAns':
        st.offer = -1;
        if (ev.take) {
          st.cube = ev.cube; st.owner = ev.owner;
          this.sfx('win2');
          this.ctx.fx.popText(anchor, this.t('accept'), GOLD, { dur: 1.0, rise: 0.25 });
          await this.moveCube(ev.owner, fast, true);
        } else {
          this.sfx('lose');
          this.ctx.fx.popText(anchor, this.t('pass'), 0xbdbdbd, { dur: 1.0, rise: 0.25 });
        }
        this.refresh();
        return;
      case 'over': {
        st.ph = 'over';
        st.res = { w: ev.w, m: ev.m, gross: ev.gross };
        const mine = this.localSide(), won = ev.w === mine;
        const at = this.model.anchors.coinOut;
        const label = ev.m >= 3 ? this.t('backgammon') : ev.m === 2 ? this.t('gammon') : this.t('single');
        let tier: JuiceTier = juiceTier(ev.gross, ev.stake);
        if (ev.m >= 2 && !tierAtLeast(tier, 'big')) tier = 'big';
        if (ev.m >= 3) tier = 'huge';
        this.ctx.fx.popText(anchor, label, GOLD, { dur: 1.4, rise: 0.35, scale: 1.3 });
        this.ctx.fx.shake(0.01, 0.3);
        if (won && ev.m >= 2 && !fast) this.ctx.fx.flash(GOLD, 0.3, 0.25);
        if (ev.w >= 0 && (ev.w === mine || mine < 0)) void this.celebrate(tier, { amount: ev.gross - ev.stake, at, fast });
        else if (mine >= 0) this.commiserate({ at, amount: ev.stake });
        this.refresh();
        return;
      }
      case 'idle':
        st.ph = 'idle'; st.offer = -1; st.left = [];
        this.refresh();
        return;
    }
  }

  // ── presentation helpers ───────────────────────────────────────────────────────────────────────
  /** Checkers from the board: distance per piece (25 bar, 0 borne off, −1 hidden). */
  private assignPieces(b: R.Board): void {
    const P = this.parts;
    if (!P?.pieces) return;
    for (const s of [0, 1]) {
      const list = P.pieces.slice(s * 15, s * 15 + 15);
      let i = 0;
      const put = (d: number, n: number): void => { for (let k = 0; k < n && i < 15; k++) list[i++].userData.d = d; };
      put(R.BAR, b.bar[s]);
      for (let d = 24; d >= 1; d--) put(d, b.pos[s][d - 1]);
      put(R.OFF, b.off[s]);
      while (i < 15) list[i++].userData.d = -1;
    }
  }

  /** Place every checker from its distance; stacks are numbered in array order. */
  private layoutPieces(): void {
    const P = this.parts;
    if (!P?.pieces) return;
    const count = new Map<string, number>();
    for (const m of P.pieces) {
      const s = m.userData.side as number, d = m.userData.d as number;
      if (d < 0) { m.visible = false; continue; }
      m.visible = true;
      const key = d === R.BAR ? `bar${s}` : d === R.OFF ? `off${s}` : `pt${s === 0 ? d : 25 - d}`;
      const k = count.get(key) ?? 0;
      count.set(key, k + 1);
      if (d === R.BAR) m.position.copy(barAt(s, k));
      else if (d === R.OFF) m.position.copy(offAt(s, k));
      else m.position.copy(stackAt(s === 0 ? d : 25 - d, k));
    }
  }

  private async glide(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, dur: number, arc: number): Promise<void> {
    if (dur <= 0.02) { m.position.copy(to); return; }
    m.position.copy(from);
    await this.anim(dur, (k) => {
      m.position.lerpVectors(from, to, k);
      m.position.y += Math.sin(k * Math.PI) * arc;
    });
    m.position.copy(to);
  }

  private async rollDice(vals: number[], fast: boolean): Promise<void> {
    const P = this.parts;
    const runs = vals.map((v, i) => {
      const from = DICE_FROM.clone().add(new THREE.Vector3(i * 0.05 - 0.025, 0, 0));
      return P.dice.roll(i, from, DICE_REST[i].clone(), v, fast ? 0.01 : 0.6);
    });
    await Promise.all(runs);
  }

  private async moveCube(owner: number, fast: boolean, spin = false): Promise<void> {
    const cube = this.parts?.cube;
    if (!cube) return;
    const from = cube.position.clone(), to = cubeAt(owner);
    if (fast) { cube.position.copy(to); return; }
    await this.anim(0.35, (k) => {
      cube.position.lerpVectors(from, to, k);
      cube.position.y += Math.sin(k * Math.PI) * 0.06;
      if (spin) cube.rotation.y = k * Math.PI;
    });
    cube.position.copy(to);
    if (spin) cube.rotation.y = 0;
  }

  /** Redraw the status screen, the cube label, the turn lamp and the HUD. */
  private refresh(): void {
    this.repaint();
    this.markTargets();
    this.showHud();
  }

  private repaint(): void {
    const P = this.parts;
    if (!P?.score) return;
    const st = this.st;
    const line = this.statusText();
    const cubeLine = `${this.t('cubeHud')} ${st.cube}${st.owner >= 0 ? `  ·  ${this.nameOf(st.owner)}` : ''}`;
    const stakeLine = st.ph === 'idle' ? '' : `${this.t('stakeHud')} ${fmtCoins(st.unit)}`;
    P.score.draw((g, s) => {
      s.clear('#0c0a08');
      s.text(line, 10, 34, { size: 24, color: '#ffd96a' });
      s.text(`${cubeLine}   ${stakeLine}`, 10, 74, { size: 20, color: '#f2e6c4' });
    });
    P.cubeLabel.setText(String(st.cube));
    P.turnLamp.setOn(st.ph === 'roll' || st.ph === 'move' || st.ph === 'cube');
  }

  private statusText(): string {
    const st = this.st, me = this.localSide();
    switch (st.ph) {
      case 'idle': return this.t('sIdle');
      case 'stake': {
        const waiting = [0, 1].filter((s) => !st.rdy[s]);
        return waiting.length ? this.t('sWaitReady', { name: this.nameOf(waiting[0]) }) : this.t('sStake', { n: fmtCoins(st.unit) });
      }
      case 'roll': return this.t('sRoll', { name: this.nameOf(st.turn) });
      case 'move': return st.turn === me ? this.t('sMove') : this.t('sWaitMove', { name: this.nameOf(st.turn) });
      case 'cube':
        return st.offer === me ? this.t('sWaitCube', { name: this.nameOf(1 - st.offer) })
          : this.t('sCubeYou', { n: R.nextCube(st.cube) });
      case 'over': return st.res ? this.t('sOver', { name: this.nameOf(st.res.w) }) : '';
    }
    return '';
  }

  // ── HUD and rules sheet ─────────────────────────────────────────────────────────────────────────
  onLang(): void {
    this.repaint();
    if (this.rules) { this.closeRules(); this.toggleRules(); }
    if (this.isLocalOccupant) this.showHud();
  }

  private showHud(): void {
    if (!this.isLocalOccupant) return;
    const st = this.st, me = this.localSide();
    const hints: HudHint[] = [];
    if (st.ph === 'stake' && me >= 0 && !st.rdy[me]) hints.push({ action: 'primary', label: this.t('hintReady') }, { action: 'betUp', label: this.t('hintStake') });
    if (st.ph === 'roll' && st.turn === me) {
      hints.push({ action: 'primary', label: this.t('hintRoll') });
      if (this.canDouble(me)) hints.push({ action: 'n1', label: this.t('hintDouble') });
    }
    if (st.ph === 'cube' && me >= 0 && st.offer !== me) {
      hints.push({ action: 'n6', label: this.t('hintTake') }, { action: 'n7', label: this.t('hintDrop') });
    }
    hints.push({ action: 'help', label: this.t('hintRules') }, { action: 'exit', label: this.t('common.leave') });
    this.hud({
      bet: st.ph === 'stake' && me >= 0 && !st.rdy[me] ? this.bet : null,
      hints,
      stats: st.ph === 'idle' ? [] : [{ label: this.t('cubeHud'), value: String(st.cube) }, { label: this.t('stakeHud'), value: fmtCoins(st.unit) }],
    });
  }

  /** Bilingual rules sheet (H / help): EN then TR, from the strings module. */
  private toggleRules(): void {
    if (this.rules) { this.closeRules(); return; }
    this.rules = this.ctx.ui.panel('tavla-rules', (el) => {
      el.textContent = '';
      const sheet = (lang: 'en' | 'tr'): void => {
        const map = STRINGS[lang];
        const h = document.createElement('h3');
        h.textContent = map.rulesTitle;
        el.appendChild(h);
        for (let i = 1; i <= 9; i++) {
          const p = document.createElement('p');
          p.textContent = `${i}. ${map[`r${i}`]}`;
          el.appendChild(p);
        }
      };
      sheet('en');
      const sep = document.createElement('hr');
      el.appendChild(sep);
      sheet('tr');
    });
  }
  private closeRules(): void {
    this.rules?.close();
    this.rules = null;
  }
}
