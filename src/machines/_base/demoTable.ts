/**
 * High Card Duel (`demotable`) — THE reference `TableBase` machine (base-machines WP). Copy this pattern for every
 * host-resolved table. It is NOT in the shipped catalogue: it lives outside `src/machines/<id>/` and is reachable only
 * through the bench (`/?bench=demotable`, see `registry.registerExtra`).
 *
 * Rules: two seats, one hidden card each (ace high). Everyone antes the same bet, then may DOUBLE their own stake while
 * the 7 s decision timer runs. The highest card takes the whole pot, a tie returns every stake. A bot fills an empty seat.
 *
 * What it demonstrates (the table flow of TECH_SPEC §3.4)
 *  - seated client → `act()` → host `onAction()` → `chargeSeat` → `emit` → every peer `present`;
 *  - phases driven by `hostTick` on the host only; the host-only truth (`hs`: deck, cards, stakes) is never sent;
 *  - hidden information: the public `deal` event carries no values, each player's card arrives as a PRIVATE `hole`
 *    event (`emitPrivate`, `pc.priv`) and `getSnapshot(forPid)` redacts the opponent's card for late joiners;
 *  - the shared countdown (`countdown` / `cancelCountdown`, drawn from `timerLeft`), `nak`, bots (`addBot`, bot AI in
 *    host code on `bot.rng`), leaving mid-round (auto-forfeit in `onRelease`, refund via `paySeat(…, pid)`);
 *  - juice: deal slide with a landing slap, lift-and-flip peek / reveal, winner burst through `celebrate`, loss feedback.
 *
 * Round: idle → (everyone seated is ready, or 6 s after the first) → ante → deal → decide (7 s) → reveal (3.5 s) → idle.
 * Not persisted: a host that reloads mid-round restarts at `idle` (the room closes on host loss, DECISIONS Q1).
 */
import * as THREE from 'three';
import type { CardId } from '@/core/texgen/types';
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import type { Kit, LampPart, ScreenSurface } from '@/kit/types';
import type { MachineInputEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import { fmtCoins, t } from '@/core/i18n';
import { TableBase } from './TableBase';
import { Shoe, cardId, rankOf } from './cards';
import { juiceTier } from './tiers';
import type { ModelOpts } from './MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from './types';

// ── contract types (aliases, not interfaces: they must be assignable to `Json`) ───────────────────
type Phase = 'idle' | 'decide' | 'reveal';
type Reveal = { k: 'reveal'; cards: Array<CardId | null>; win: number; pot: number; why: 'cards' | 'left' };
type Ev =
  | { k: 'ante'; seat: number; bet: number }
  | { k: 'deal'; seats: number[] }                                  // PUBLIC: who got a (face-down) card — no values
  | { k: 'hole'; seat: number; card: CardId }                       // PRIVATE: the recipient's own card
  | { k: 'double'; seat: number; stake: number }
  | { k: 'phase'; p: Phase }
  | Reveal;
type Act = { k: 'ready'; bet: number } | { k: 'hold' } | { k: 'double' };
/** What every peer knows, plus `mine` (the local player's private card). Mutated only in `present`. */
type State = {
  phase: Phase; pot: number; stake: number[]; dealt: boolean[]; shown: Array<CardId | null>; mine: CardId | null; rev: Reveal | null;
};
type Snap = { phase: Phase; pot: number; stake: number[]; dealt: boolean[]; shown: Array<CardId | null>; mine: CardId | null; rev: Reveal | null };

const DECIDE_S = 7, READY_S = 6, REVEAL_S = 3.5;
const SEATS = 2;
const GOLD = 0xffd040;

export type DemoParts = {
  cards: THREE.Mesh[];          // one per seat, lying on the felt in front of the seat
  deck: THREE.Mesh;             // the stack the cards slide out of
  screens: ScreenSurface[];     // scoreboard, one face per side
  lamps: LampPart[];            // seat lights (on = somebody sits there)
};
const TOP = 0.78;
const CARD_W = 0.11, CARD_H = 0.155;
const cardPos = (seat: number): THREE.Vector3 => new THREE.Vector3(0, TOP + 0.004, seat === 0 ? 0.21 : -0.21);
const DECK_POS = new THREE.Vector3(0.34, TOP + 0.012, 0);

export const def: MachineDef = {
  id: 'demotable',
  category: 'table',
  slotSize: 'L',
  zone: 'cards',
  seats: SEATS,
  shared: true,
  minBet: 5, maxBet: 50, betSteps: [5, 10, 25, 50],
  maxPayoutMult: 6,
  tags: ['table', 'demo'],
  strings: {
    en: {
      name: 'High Card Duel',
      desc: 'Reference table: two seats, one hidden card each, highest card takes the pot.',
      ready: 'Ready', hold: 'Hold', double: 'Double down', bot: 'Wick',
      sIdle: 'Place your bet', sWait: 'Waiting for the other seat', sDecide: 'Double down or hold', sShow: 'Showdown',
      sWin: 'You win {n}', sLose: 'You lose', sTie: 'Tie: stakes returned', sSeat: 'Seat {n} wins {pot}', sLeft: 'Opponent left: you win {n}',
      pot: 'POT {n}', potLabel: 'Pot', busy: 'A round is in progress', badBet: 'That bet is not allowed',
    },
    tr: {
      name: 'Yüksek Kart Düellosu',
      desc: 'Örnek masa: iki koltuk, herkese gizli bir kart, en yüksek kart kasayı alır.',
      ready: 'Hazır', hold: 'Bekle', double: 'İkiye katla', bot: 'Kurt',
      sIdle: 'Bahsini koy', sWait: 'Diğer koltuk bekleniyor', sDecide: 'İkiye katla ya da bekle', sShow: 'Kartlar açılıyor',
      sWin: 'Kazandın {n}', sLose: 'Kaybettin', sTie: 'Berabere: bahisler iade', sSeat: '{n}. koltuk kazandı {pot}', sLeft: 'Rakip kalktı: {n} kazandın',
      pot: 'KASA {n}', potLabel: 'Kasa', busy: 'Bir el oynanıyor', badBet: 'Bu bahis geçerli değil',
    },
  },
};

// ── model ────────────────────────────────────────────────────────────────────────────────────────
/** Point a card plane's four UV corners at `id` in the shared card atlas (each card owns its geometry). */
function setFace(card: THREE.Mesh, kit: Kit, id: CardId | 'back'): void {
  const [u0, v0, u1, v1] = kit.tex.cardAtlas().uv(id);
  const uv = card.geometry.getAttribute('uv') as THREE.BufferAttribute;
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
}

export function buildModel(kit: Kit, o: ModelOpts): MachineModel<DemoParts> {
  const { pal } = kit;
  const root = kit.group('demotable');
  const wood = o.variant % 2 ? pal.wood : pal.woodDark;
  // round felt table on a pedestal, brass rim
  kit.cyl(0.52, 0.52, 0.05, { color: pal.felt, map: kit.tex.felt(pal.felt) }, { pos: [0, TOP - 0.025, 0], seg: 16, parent: root });
  kit.torus(0.52, 0.03, pal.brass, { pos: [0, TOP, 0], rot: [90, 0, 0], seg: 16, parent: root });
  kit.cyl(0.1, 0.16, TOP - 0.06, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, (TOP - 0.06) / 2, 0], seg: 8, parent: root });
  kit.cyl(0.4, 0.45, 0.04, { color: wood, map: kit.tex.wood(wood) }, { pos: [0, 0.02, 0], seg: 12, parent: root });
  // stools + the two seat poses (the camera sits above its stool, looking at the felt in front of it)
  const seats: NonNullable<MachineModel<DemoParts>['seats']> = [];
  for (const s of [0, 1]) {
    const dir = s === 0 ? 1 : -1;
    kit.cyl(0.17, 0.17, 0.05, { color: pal.leather }, { pos: [0, 0.47, dir * 0.7], seg: 10, parent: root });
    kit.cyl(0.03, 0.05, 0.45, pal.chrome, { pos: [0, 0.225, dir * 0.7], seg: 8, parent: root });
    seats.push({
      pose: { pos: new THREE.Vector3(0, 1.3, dir * 0.92), look: new THREE.Vector3(0, TOP + 0.04, dir * 0.0), fov: 52, mouse: 'primary' },
      stand: new THREE.Vector3(0, 0, dir * 0.95), avatar: 'sit',
    });
  }
  // scoreboard post with a screen on each side
  kit.cyl(0.015, 0.015, 0.3, pal.brass, { pos: [-0.34, TOP + 0.15, 0], seg: 6, parent: root });
  const screens: ScreenSurface[] = [];
  for (const s of [0, 1]) {
    const sc = kit.screen({ w: 0.26, h: 0.13, px: [96, 48], bezel: pal.black });
    sc.mesh.position.set(-0.34, TOP + 0.3, s === 0 ? 0.02 : -0.02);
    sc.mesh.rotation.y = s === 0 ? 0 : Math.PI;
    screens.push(sc);
    root.add(sc.mesh);
  }
  const lamps: LampPart[] = [];
  for (const s of [0, 1]) {
    const l = kit.lamp({ r: 0.03, color: s === 0 ? pal.gold : pal.neonCyan, shape: 'dome' });
    l.root.position.set(0.38, TOP + 0.02, s === 0 ? 0.3 : -0.3);
    lamps.push(l);
    root.add(l.root);
  }
  // cards (own geometry: the UVs are rewritten per face) and the deck they slide out of
  const mat = kit.mat({ map: kit.tex.cardAtlas().tex, lit: false, side: 'double', snap: false, affine: false });
  const cards = [0, 1].map((s) => {
    const c = kit.plane(CARD_W, CARD_H, mat, { rot: [-90, 0, 0], shade: false, name: `card${s}` });
    c.position.copy(DECK_POS);
    c.visible = false;
    setFace(c, kit, 'back');
    root.add(c);
    return c;
  });
  const deck = kit.box(CARD_W, 0.03, CARD_H, { color: pal.redDark }, { pos: [DECK_POS.x, TOP + 0.015, 0], shade: false, parent: root });
  root.add(kit.blobShadow(1.3, 1.9));
  const light = new THREE.Object3D();
  light.position.set(0, 1.6, 0);
  light.userData = { color: 0xffe2a0, intensity: 0.7, range: 2.6, flicker: 'STEADY' };
  root.add(light);
  const prompt = new THREE.Object3D();
  prompt.position.set(0, 1.3, 0);
  root.add(prompt);

  const parts: DemoParts = { cards, deck, screens, lamps };
  kit.finalize(root, { keep: [...cards, deck, ...screens.map((s) => s.mesh), ...lamps, light, prompt] });
  return {
    root, parts, seats,
    playPose: seats[0].pose,
    colliders: [
      { min: [-0.54, 0, -0.54], max: [0.54, 0.82, 0.54] },
      { min: [-0.18, 0, 0.53], max: [0.18, 0.52, 0.89] }, { min: [-0.18, 0, -0.89], max: [0.18, 0.52, -0.53] },
    ],
    interact: { min: [-0.6, 0.2, -0.9], max: [0.6, 1.0, 0.95] },
    anchors: { speaker: prompt, prompt, light, coinOut: prompt },
    dispose: () => screens.forEach((s) => s.dispose()),
  };
}

// ── machine ──────────────────────────────────────────────────────────────────────────────────────
/** HOST-ONLY authority state: never sent, never in a snapshot for other players. */
interface HostState {
  phase: Phase;
  ready: boolean[]; playing: boolean[]; done: boolean[];
  stake: number[]; card: Array<CardId | null>;
  shoe: Shoe | null;
  timer: number;             // seconds left in the current phase
  botAt: number;             // seconds until the bot acts (decide phase)
  force: 'win' | 'lose' | 'tie' | null;
}
const freshHost = (shoe: Shoe | null = null, force: HostState['force'] = null): HostState => ({
  phase: 'idle', ready: [false, false], playing: [false, false], done: [false, false],
  stake: [0, 0], card: [null, null], shoe, timer: 0, botAt: 0, force,
});

export default class HighCardDuel extends TableBase<DemoParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', pot: 0, stake: [0, 0], dealt: [false, false], shown: [null, null], mine: null, rev: null };
  private hs: HostState = freshHost();
  private shownSecond = -1;

  protected createModel(kit: Kit): MachineModel<DemoParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.hs.shoe = new Shoe(1, this.hostRng, { penetration: 0.5 });
    this.paintAll();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    const idle = this.st.phase === 'idle', mine = this.localSeat;
    switch (a) {
      case 'primary': case 'confirm':
        if (idle && !this.readyOf(mine)) this.act({ k: 'ready', bet: this.bet });
        else if (this.st.phase === 'decide') this.act({ k: 'hold' });
        break;
      case 'alt': case 'double': if (this.st.phase === 'decide') this.act({ k: 'double' }); break;
      case 'betUp': case 'betDown': case 'betMax':
        if (!idle || this.readyOf(mine)) break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
    }
  }
  /** The seat has an ante on the table (public state). */
  private readyOf(seat: number): boolean { return seat >= 0 && this.st.stake[seat] > 0; }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'ready') {
      if (hs.phase !== 'idle' || hs.ready[seat]) { this.nak(pid, rid, 'm.demotable.busy'); return; }
      if (!this.betLadder().includes(a.bet)) { this.nak(pid, rid, 'm.demotable.badBet'); return; }
      if (!this.chargeSeat(seat, a.bet)) { this.nak(pid, rid, 'common.noFunds'); return; }
      hs.ready[seat] = true; hs.stake[seat] = a.bet;
      void this.emit({ k: 'ante', seat, bet: a.bet });
      const other = 1 - seat;
      if (this.seats[other] === null) this.addBot(other, this.t('bot'));          // nobody across the table: a bot sits down
      if (this.humans().every((h) => hs.ready[h.seat])) this.startRound();
      else if (hs.timer <= 0) { hs.timer = READY_S; void this.countdown(READY_S, 'ready'); }
    } else if (hs.phase === 'decide' && hs.playing[seat] && !hs.done[seat]) {
      if (a.k === 'double') {
        if (!this.chargeSeat(seat, hs.stake[seat])) { this.nak(pid, rid, 'common.noFunds'); return; }
        hs.stake[seat] *= 2;
        void this.emit({ k: 'double', seat, stake: hs.stake[seat] });
      }
      hs.done[seat] = true;
      if (this.everyoneDone()) this.reveal();
    }
  }

  private everyoneDone(): boolean { return this.hs.playing.every((p, s) => !p || this.hs.done[s]); }

  /** Ante the bot, deal, send the private cards, open the decision window. */
  private startRound(): void {
    const hs = this.hs;
    this.cancelCountdown();
    const bet = Math.max(...hs.stake);
    for (let s = 0; s < SEATS; s++) {
      const pid = this.seats[s];
      hs.playing[s] = pid !== null && (hs.ready[s] || isBot(pid));
      hs.done[s] = false;
      if (hs.playing[s] && isBot(pid!)) { this.chargeSeat(s, bet); hs.stake[s] = bet; void this.emit({ k: 'ante', seat: s, bet }); }
    }
    if (hs.shoe!.needsShuffle) hs.shoe!.shuffle();
    hs.card = hs.playing.map((p) => (p ? hs.shoe!.draw() : null));
    this.rig();
    void this.emit({ k: 'deal', seats: hs.playing.flatMap((p, s) => (p ? [s] : [])) });
    hs.playing.forEach((p, s) => {
      const pid = this.seats[s];
      if (p && pid !== null && !isBot(pid)) void this.emitPrivate(pid, { k: 'hole', seat: s, card: hs.card[s]! });
    });
    hs.phase = 'decide';
    hs.timer = DECIDE_S;
    const bot = this.bots.find((b) => hs.playing[b.seat]);
    hs.botAt = bot ? bot.rng.float(1.4, 3) : 0;
    void this.emit({ k: 'phase', p: 'decide' });
    void this.countdown(DECIDE_S, 'decide');
  }

  /** Bench "force outcome": pick the two cards so the next round ends as asked (human vs bot only). */
  private rig(): void {
    const hs = this.hs, f = hs.force;
    if (!f) return;
    hs.force = null;
    const bot = this.bots.find((b) => hs.playing[b.seat]);
    const human = this.humans().find((h) => hs.playing[h.seat]);
    if (!bot || !human) return;
    const [hr, br] = f === 'win' ? [12, 5] : f === 'lose' ? [5, 12] : [9, 9];
    hs.card[human.seat] = cardId(hr, 'S');
    hs.card[bot.seat] = cardId(br, f === 'tie' ? 'H' : 'D');
  }
  debugForce(arg: string): void {
    const a = arg.trim().toLowerCase();
    this.hs.force = a === 'win' || a === 'lose' || a === 'tie' ? a : null;
    this.ctx.ui.toast(`demotable: next round ${this.hs.force ?? 'random'}`, 'sys');
  }

  /** Ready countdown, decision timer, bot AI and the post-reveal pause. Host only (`hostTick`). */
  hostTick(dt: number): void {
    const hs = this.hs;
    if (hs.phase === 'idle') {
      if (hs.timer > 0 && (hs.timer -= dt) <= 0 && hs.ready.some(Boolean)) this.startRound();
    } else if (hs.phase === 'decide') {
      hs.timer -= dt;
      const bot = this.bots.find((b) => hs.playing[b.seat] && !hs.done[b.seat]);
      if (bot && (hs.botAt -= dt) <= 0) {
        hs.done[bot.seat] = true;
        const strong = rankOf(hs.card[bot.seat]!) >= 10 && bot.rng.chance(0.7);
        if (strong && this.chargeSeat(bot.seat, hs.stake[bot.seat])) { hs.stake[bot.seat] *= 2; void this.emit({ k: 'double', seat: bot.seat, stake: hs.stake[bot.seat] }); }
        if (this.everyoneDone()) this.reveal();
      }
      if (hs.phase === 'decide' && hs.timer <= 0) this.reveal();                // time is up: everybody holds
    } else if (hs.phase === 'reveal' && (hs.timer -= dt) <= 0) {
      this.hs = freshHost(hs.shoe, hs.force);
      void this.emit({ k: 'phase', p: 'idle' });
    }
  }

  /** Showdown: compare, pay, tell everyone. `leaver` = a seat that walked away (it forfeits the pot). */
  private reveal(leaver = -1): void {
    const hs = this.hs;
    if (hs.phase !== 'decide') return;
    this.cancelCountdown();
    const [a, b] = hs.card.map((c) => (c ? rankOf(c) : 0));
    const win = leaver >= 0 ? 1 - leaver : a > b ? 0 : b > a ? 1 : -1;
    const pot = hs.stake[0] + hs.stake[1];
    for (let s = 0; s < SEATS; s++) {
      if (!hs.playing[s]) continue;
      const bet = hs.stake[s];
      if (win === -1) this.paySeat(s, bet, { bet, tier: 'push', tags: ['push'] });             // tie: the stake comes back
      else this.paySeat(s, s === win ? pot : 0, { bet });                                      // a loss is paid too (loss.refund)
    }
    hs.phase = 'reveal';
    hs.timer = REVEAL_S;
    void this.emit({ k: 'reveal', cards: hs.card.map((c, s) => (hs.playing[s] && s !== leaver ? c : null)), win, pot, why: leaver >= 0 ? 'left' : 'cards' });
  }

  /** A seat was vacated (runs on every peer; the seat is already empty here, so the pay helpers take the `pid`). */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid)) {
      const hs = this.hs;
      if (hs.phase === 'decide' && hs.playing[seat]) this.reveal(seat);
      else if (hs.phase === 'idle' && hs.ready[seat]) {                                         // refund an unstarted ante
        this.paySeat(seat, hs.stake[seat], { bet: hs.stake[seat], tier: 'push', tags: ['refund'] }, pid);
        hs.ready[seat] = false; hs.stake[seat] = 0;
        void this.emit({ k: 'ante', seat, bet: 0 });
      }
    }
    if (local) this.st.mine = null;
    this.paintAll();
  }
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) { this.sfx('chime'); this.showHud(); }
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const s = this.st, fast = pc.fast, cards = this.parts.cards;
    switch (ev.k) {
      case 'ante':
        s.stake[ev.seat] = ev.bet;
        s.pot = s.stake[0] + s.stake[1];
        if (ev.bet > 0) { this.sfx('chip'); this.ctx.fx.sparks(this.parts.lamps[ev.seat].root, 6, GOLD); }
        this.paintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'deal':
        s.phase = 'decide'; s.dealt = [false, false]; s.shown = [null, null]; s.rev = null;
        for (const seat of ev.seats) {
          s.dealt[seat] = true;
          this.setFace(seat, 'back');
          cards[seat].visible = true;
          this.sfx('card');
          if (fast) cards[seat].position.copy(cardPos(seat));
          else await this.slide(cards[seat], DECK_POS, cardPos(seat), 0.28);
        }
        this.paintAll();
        return;
      case 'hole':                                                       // private: peek at my own card
        s.mine = ev.card;
        if (!fast && s.dealt[ev.seat]) await this.turn(ev.seat, ev.card); else this.paintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'double':
        s.stake[ev.seat] = ev.stake;
        s.pot = s.stake[0] + s.stake[1];
        this.sfx('chipStack');
        this.ctx.fx.popText(this.parts.lamps[ev.seat].root, this.t('double'), GOLD, { dur: 1, rise: 0.25 });
        this.paintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'phase':
        s.phase = ev.p;
        if (ev.p === 'idle') await this.cleanUp(fast);
        this.paintAll();
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'reveal':
        s.phase = 'reveal'; s.shown = [...ev.cards]; s.mine = null; s.rev = ev;
        this.drawScreens();
        for (let seat = 0; seat < SEATS; seat++) {
          const c = ev.cards[seat];
          if (!c) continue;
          if (fast) this.setFace(seat, c); else void this.turn(seat, c);
        }
        if (!fast) await this.wait(0.6);
        this.celebrateResult(ev, pc);
        if (this.isLocalOccupant) this.showHud();
        return;
    }
  }

  private celebrateResult(ev: Reveal, pc: PresentCtx): void {
    const { lamps, cards } = this.parts;
    if (ev.win === -1) { this.sfx('coin'); return; }
    const bet = this.st.stake[ev.win] || ev.pot / 2;
    void this.celebrate(juiceTier(ev.pot, bet), { amount: ev.pot, at: cards[ev.win], lamps: [lamps[ev.win]], fast: pc.fast, restore: () => this.paintLamps() });
    const mine = this.localSeat;
    if (mine >= 0 && mine !== ev.win) this.commiserate({ at: cards[mine] });
  }

  // card animation helpers
  private setFace(seat: number, id: CardId | 'back'): void { setFace(this.parts.cards[seat], this.ctx.kit, id); }
  private async slide(card: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, dur: number): Promise<void> {
    await this.anim(dur, (k) => {
      card.position.lerpVectors(from, to, k);
      card.position.y += Math.sin(k * Math.PI) * 0.07;
    }, 'outQuad');
    card.position.copy(to);
    this.sfx('cardSlap', { vol: 0.7 });
  }
  /** Lift the card, turn it over (the face swaps while it is edge-on), lay it back down showing `face`. */
  private async turn(seat: number, face: CardId): Promise<void> {
    const c = this.parts.cards[seat], y0 = cardPos(seat).y;
    let swapped = false;
    this.sfx('cardFlip');
    await this.anim(0.38, (k) => {
      c.position.y = y0 + Math.sin(k * Math.PI) * 0.09;
      c.rotation.y = k < 0.5 ? Math.PI * k : Math.PI * (k - 1);
      if (k >= 0.5 && !swapped) { swapped = true; this.setFace(seat, face); }
    });
    c.rotation.y = 0; c.position.y = y0;
    this.setFace(seat, face);
  }
  private async cleanUp(fast: boolean): Promise<void> {
    const s = this.st;
    s.pot = 0; s.stake = [0, 0]; s.shown = [null, null]; s.mine = null; s.rev = null; s.dealt = [false, false];
    for (const c of this.parts.cards) {
      if (!c.visible) continue;
      if (!fast) await this.slide(c, c.position.clone(), DECK_POS, 0.2);
      c.visible = false;
    }
  }

  // ── snapshots: the opponent's card is NEVER in someone else's snapshot ────────────────────────
  getSnapshot(forPid?: PlayerId): Snap {
    const s = this.st, hs = this.hs;
    const own = forPid === undefined || forPid === this.selfId;
    const seat = own ? -1 : this.seatOf(forPid);
    const hidden = seat >= 0 && hs.playing[seat] && hs.phase === 'decide' ? hs.card[seat] : null;
    return { phase: s.phase, pot: s.pot, stake: [...s.stake], dealt: [...s.dealt], shown: [...s.shown], mine: own ? s.mine : hidden, rev: s.rev };
  }
  applySnapshot(sn: Snap): void {
    this.st = { phase: sn.phase, pot: sn.pot, stake: [...sn.stake], dealt: [...sn.dealt], shown: [...sn.shown], mine: sn.mine, rev: sn.rev };
    this.paintAll();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  frame(): void {
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    if (left !== this.shownSecond) { this.shownSecond = left; this.drawScreens(); }
  }
  override onLang(): void { this.drawScreens(); if (this.isLocalOccupant) this.showHud(); }

  private paintLamps(): void { this.parts.lamps.forEach((l, s) => l.setOn(this.seats[s] !== null)); }
  /** Resting pose of every visual for `this.st` (idempotent). */
  private paintAll(): void {
    this.paintLamps();
    const s = this.st;
    this.parts.cards.forEach((c, seat) => {
      c.visible = s.dealt[seat];
      if (!s.dealt[seat]) return;
      c.position.copy(cardPos(seat)); c.rotation.set(-Math.PI / 2, 0, 0);
      this.setFace(seat, s.shown[seat] ?? (seat === this.localSeat ? s.mine : null) ?? 'back');
    });
    this.drawScreens();
  }
  private statusText(): string {
    const s = this.st, r = s.rev;
    if (s.phase === 'reveal' && r) {
      const mine = this.localSeat;
      if (r.win === -1) return this.t('sTie');
      if (mine === r.win) return this.t(r.why === 'left' ? 'sLeft' : 'sWin', { n: fmtCoins(r.pot) });
      return mine >= 0 ? this.t('sLose') : this.t('sSeat', { n: r.win + 1, pot: fmtCoins(r.pot) });
    }
    if (s.phase === 'reveal') return this.t('sShow');
    if (s.phase === 'decide') return this.t('sDecide');
    return this.t(s.stake.some((v) => v > 0) ? 'sWait' : 'sIdle');
  }
  private drawScreens(): void {
    const status = this.statusText(), pot = this.st.pot > 0 ? this.t('pot', { n: fmtCoins(this.st.pot) }) : '';
    const left = this.timerState ? Math.ceil(this.timerLeft) : 0;
    const frac = this.timerState ? Math.min(1, Math.max(0, this.timerLeft / DECIDE_S)) : 0;
    for (const sc of this.parts.screens) {
      sc.draw((g, w) => {
        g.fillStyle = '#06100a'; g.fillRect(0, 0, w.w, w.h);
        w.text(status, 48, 5, { font: 'px5', color: '#7dff7a', align: 'center' });
        if (pot) w.text(pot, 48, 20, { font: 'px5', color: '#ffd040', align: 'center' });
        if (left > 0) {
          w.text(String(left), 48, 31, { font: 'px5', color: '#ffffff', align: 'center' });
          g.fillStyle = '#ffd040'; g.fillRect(8, 41, Math.round(80 * frac), 3);
        }
      });
    }
  }

  private showHud(): void {
    const s = this.st, seat = this.localSeat;
    const hints: HudHint[] = [];
    if (s.phase === 'idle') {
      if (!this.readyOf(seat)) hints.push({ action: 'primary', label: this.t('ready') }, { action: 'betUp', label: t('common.bet') });
    } else if (s.phase === 'decide' && this.readyOf(seat)) {
      hints.push({ action: 'primary', label: this.t('hold') }, { action: 'alt', label: this.t('double') });
    }
    hints.push({ action: 'exit', label: t('common.leave') });
    this.hud({
      bet: s.phase === 'idle' && !this.readyOf(seat) ? this.bet : null,
      hints,
      stats: s.pot > 0 ? [{ label: this.t('potLabel'), value: fmtCoins(s.pot) }] : [],
    });
  }
}
