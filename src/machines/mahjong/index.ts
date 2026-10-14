/**
 * Mahjong: Little Wall (`mahjong`) — solo, tier 2, WAVE24_PLAN §1. Pattern: `hilo/index.ts`.
 *
 *  - logic / present split: every outcome (wall, tiles, win, payout) is rolled on the authority (the local occupant),
 *    packed into an event and `emit`ted; `present()` is the only place state changes or animation happens, on every
 *    peer. Settle-before-present (DECISIONS G): the wallet step runs as `emit`'s `credit`.
 *  - a multi-step round: the stake is charged on DEAL; the round stays OPEN between decisions (busy = false while the
 *    player chooses); a win closes it at the pick, the last discard closes the rest (Near Hand or nothing); standing
 *    up mid-round plays the rest of the hand with the greedy policy.
 *  - the wall is `shuffleWall(rng)` of the round's seed, so a reload rebuilds it (the state keeps only the wall index).
 *  - juice: deal stagger, tile glides, upcard flip, turn beads going dark, near-miss hold, the winning tiles laying
 *    flat and glowing green with a tiered coin pour, bonus words, Near Hand waits glow.
 *  - charms: hooks `m.mahjong.turnsAdd`, `peek`, `nearPay`; `luck` is unused (the wall is the only randomness).
 *  - `playHeadless` (rules.ts) for staff auto-play and the bench "Sim" button, so simulated RTP IS the live RTP.
 *
 * Controls: left / right (A D) move the cursor · 1 / W / up TAKE the upcard · 2 / S / down DRAW from the wall ·
 * Space / Enter DISCARD the cursor tile (deal when idle) · C hint ring · H rules · X / Z change the stake when idle.
 * Mouse: click a rack tile to select it, click it again to discard; click the upcard to take, the wall to draw.
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { createRng, hashSeed } from '@/core/rng';
import { drawText } from '@/core/texgen/font';
import { fmtCoins } from '@/core/i18n';
import { clamp, lerp } from '@/core/math';
import {
  BASE_RTP, BASE_TURNS, BET_STEPS, HOOK_NEAR, HOOK_PEEK, HOOK_TURNS, LATE_PAY, MAX_BET, MAX_EXTRA_TURNS, MAX_MULT,
  MIN_BET, TURN_PAY, WALL_SIZE, autoPlay, bestDiscard, deal, discard, payoutOf, pick, playHeadless,
  resolve, shuffleWall, suggestTake, unseenCounts, waitsOf, winMult,
  type Round, type Tile, type Win,
} from './rules';
import {
  DISCARD_SLOTS, DRAW_POS, DRAW_SCALE, FLAT_SCALE, RACK_SLOTS, RACK_TILT, TOP, UP_POS, UP_SCALE, WAIT_SLOTS,
  buildModel, discardPos, flatY, rackPos, waitPos, wallBox, type MahjongParts,
} from './model';
import type { TileObj } from './tiles';
import STRINGS from './mahjong.strings';

export { playHeadless };

/** A win as sent on the wire. */
type WinPub = { turn: number; mult: number; amount: number; bonuses: string[]; melds: number[]; pair: number };

type Ev =
  | { k: 'deal'; bet: number; hand: number[]; up: number; drawT: number; turns: number; pos: number }
  | { k: 'pick'; take: boolean; got: number; hand: number[]; dead: number; pos: number; win: WinPub | null; bet: number }
  | {
    k: 'disc'; tile: number; hand: number[]; discards: number[]; up: number; drawT: number; pos: number; turn: number;
    done: boolean; waits: number[]; mult: number; amount: number; bet: number;
  }
  | { k: 'end'; hand: number[]; discards: number[]; pos: number; turn: number; win: WinPub | null; waits: number[]; mult: number; amount: number; bet: number };

type Phase = 'idle' | 'pick' | 'disc' | 'done';
/** The public state (what every peer, snapshot and spectator sees). The wall is rebuilt on the authority from the seed. */
type State = {
  phase: Phase;
  hand: number[];
  /** Wall index of the upcard. */
  pos: number;
  turn: number;
  turns: number;
  discards: number[];
  dead: number[];
  up: number;
  drawT: number;
  /** The tile just taken or drawn (shown apart on the rack) while a discard is owed; -1 otherwise. */
  got: number;
  bet: number;
  waits: number[];
  /** The round ended in a Mahjong (and the bonuses it carried). */
  won: boolean;
  win: string[];
};

const blank = (): State => ({
  phase: 'idle', hand: [], pos: 0, turn: 0, turns: BASE_TURNS, discards: [], dead: [], up: -1, drawT: -1, got: -1, bet: 0, waits: [], won: false, win: [],
});

const GOLD = 0xffd040, GREEN = 0x5aff7b, CYAN = 0x63e6de;
/** Z of the flat winning row (where the rack stood). */
const RACK_FLAT_Z = 0.2;
const HINT_KEY = 'jackid.mahjong.hint';

const readHint = (): boolean => { try { return localStorage.getItem(HINT_KEY) !== '0'; } catch { return true; } };
const writeHint = (on: boolean): void => { try { localStorage.setItem(HINT_KEY, on ? '1' : '0'); } catch { /* storage is optional */ } };

/** The rack arrangement: the sorted tiles, and the tile just taken / drawn apart at the end while a discard is owed. */
function arrangement(s: Pick<State, 'hand' | 'got'>): number[] {
  if (s.got < 0 || s.hand.length !== 8) return s.hand;
  const rest = [...s.hand];
  rest.splice(rest.indexOf(s.got), 1);
  return [...rest, s.got];
}

const payOf = (turn: number): number => (turn >= 1 && turn <= TURN_PAY.length ? TURN_PAY[turn - 1] : LATE_PAY);

function toWinPub(turn: number, w: Win, amount: number): WinPub {
  return {
    turn, mult: winMult(turn, w), amount, bonuses: w.bonuses.slice(),
    melds: [w.melds[0].t, w.melds[0].run ? 1 : 0, w.melds[1].t, w.melds[1].run ? 1 : 0], pair: w.pair,
  };
}

export const def: MachineDef = {
  id: 'mahjong',
  category: 'card',
  slotSize: 'M',
  zone: 'cards',
  seats: 1,
  shared: false,
  minBet: MIN_BET, maxBet: MAX_BET, betSteps: BET_STEPS,
  maxPayoutMult: MAX_MULT,
  rtp: BASE_RTP,                  // the greedy bot (rules.ts), see scripts/tests/mahjong.test.mjs
  tier: 2,
  actionCost: 1,
  idleYield: 0.3,
  headless: playHeadless,
  tags: ['solo', 'tiles', 'skill'],
  modHooks: {
    'm.mahjong.turnsAdd': `Extra turns per round (base ${BASE_TURNS}, up to +${MAX_EXTRA_TURNS}); turns past the sixth pay x${LATE_PAY}.`,
    'm.mahjong.peek': 'At ≥ 1: the tile a DRAW would give is shown face up before you choose.',   // i18n-ok
    'm.mahjong.nearPay': 'Float added to the Near Hand multiple (0.4).',
  },
  strings: { en: STRINGS.en, tr: STRINGS.tr },
};

export default class Mahjong extends MachineBase<MahjongParts, Ev, State> {
  private state: State = blank();
  /** Authority only: the full round (wall included). Rebuilt from the seed after a reload. */
  private round: Round | null = null;
  private seatHud?: SeatHud;
  private cur = 3;
  private hintOn = true;
  /** Tile object → rack slot (for pointer picking). */
  private readonly slotOf = new Map<THREE.Object3D, number>();
  /** Scale of the target the hint ring is on (0 = ring hidden); `frame` makes it breathe. */
  private hintBase = 0;

  protected createModel(kit: KitX): MachineModel<MahjongParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.parts.rack.forEach((t, i) => this.slotOf.set(t.mesh, i));
    this.hintOn = readHint();
    this.refresh();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      if (this.state.phase === 'pick' || this.state.phase === 'disc') this.resume();
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('mahjong', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    // Normal path: standUp() closed the round first. Safety net for forced / external releases: the House plays it out.
    if (local && this.roundOpen) {
      const r = this.round;
      let gross = this.roundBet;
      if (r) { const res = autoPlay(r, 'greedy', this.playOpts()); gross = payoutOf(this.rng, this.roundBet, res.mult); }
      this.settle({ gross, tags: ['auto'] });
    }
    this.state = blank();
    this.round = null;
    this.refresh();
    if (local) this.seatHud?.hide();
  }

  frame(_dt: number, t: number): void {
    const ring = this.parts.hint;
    if (ring.visible && this.hintBase > 0) ring.scale.setScalar(this.hintBase * (1 + 0.05 * Math.sin(t * 6)));   // the hint ring breathes
  }

  onLang(): void {
    this.paintFelt();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Leaving mid-round plays the rest of the hand with the greedy policy and pays that (never a free refund). */
  protected override standUp(): void {
    if (this.roundOpen && !this.busy) void this.finishAuto();
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const moves = a === 'left' || a === 'right';
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !moves && !isBet) return;
    switch (a) {
      case 'left': this.moveCursor(-1); break;
      case 'right': this.moveCursor(1); break;
      case 'up': case 'n1': void this.takeOrDraw(true); break;
      case 'down': case 'n2': void this.takeOrDraw(false); break;
      case 'primary': case 'confirm': this.primary(); break;
      case 'alt': this.toggleHint(); break;
      // bet keys and the mouse wheel only ever change the stake (ignored while a round is open)
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || e.button !== 0) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }
    const p = this.parts;
    if (!this.roundOpen) { if (this.state.phase !== 'pick' && this.state.phase !== 'disc') void this.deal(); return; }
    const s = this.state;
    if (s.phase === 'pick') {
      if (this.pick([p.up.mesh])) void this.takeOrDraw(true);
      else if (this.pick([p.draw.mesh, p.wall])) void this.takeOrDraw(false);
      return;
    }
    if (s.phase === 'disc') {
      const hit = this.pick(p.rack.filter((t) => t.root.visible).map((t) => t.mesh));
      const slot = hit ? this.slotOf.get(hit.object) : undefined;
      if (slot === undefined) return;
      if (slot === this.cur) void this.discardCursor();
      else { this.cur = slot; this.sfx('click', { vol: 0.5 }); this.refresh(); }
    }
  }

  private primary(): void {
    const s = this.state;
    if (!this.roundOpen) { if (s.phase !== 'pick' && s.phase !== 'disc') void this.deal(); return; }
    if (s.phase === 'disc') void this.discardCursor();
    else if (!this.busy) { this.toast(this.t('needPick'), 'info'); this.sfx('buzzer', { vol: 0.5 }); }
  }

  private moveCursor(d: number): void {
    const n = arrangement(this.state).length;
    if (n === 0) return;
    this.cur = clamp(this.cur + d, 0, n - 1);
    this.sfx('click', { vol: 0.4 });
    this.refresh();
  }

  private toggleHint(): void {
    this.hintOn = !this.hintOn;
    writeHint(this.hintOn);
    this.toast(this.t(this.hintOn ? 'hintOn' : 'hintOff'), 'info');
    this.refresh();
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  // ── charm-aware parameters (authority side) ───────────────────────────────────────────────────────
  private turnsNow(): number {
    return BASE_TURNS + clamp(Math.floor(this.mod(HOOK_TURNS, 0)), 0, MAX_EXTRA_TURNS);
  }
  private peekLevel(): number { return Math.max(0, Math.floor(this.mod(HOOK_PEEK, 0))); }
  private nearAdd(): number { return this.mod(HOOK_NEAR, 0); }
  private playOpts(): { peek: number; nearAdd: number } { return { peek: this.peekLevel(), nearAdd: this.nearAdd() }; }

  /** Rebuild the full round after a reload (or a late-join restore) from the public state and the round's seed. */
  private resume(): void {
    const s = this.state;
    if (!this.isLocalOccupant || (s.phase !== 'pick' && s.phase !== 'disc')) return;
    const rng = createRng(hashSeed(this.ctx.runSeed, this.id, this.roundNo));
    const wall = shuffleWall(rng);
    if (wall[s.pos] !== s.up && s.phase === 'pick') {          // the seed no longer matches: refund, never strand the stake
      this.resumeRound(s.bet);
      this.settle({ gross: s.bet, tags: ['refund'] });
      this.state = blank(); this.round = null; this.refresh();
      return;
    }
    this.rng = rng;
    this.round = {
      wall, hand: [...s.hand], pos: s.pos, turn: s.turn, turns: s.turns, phase: s.phase,
      discards: [...s.discards], dead: [...s.dead],
    };
    this.resumeRound(s.bet);
  }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private async deal(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    if (!this.beginRound(this.bet)) return;                  // charges the stake, busy = true, re-seeds this.rng
    const r = deal(this.rng, this.turnsNow());               // the shuffle: always 119 draws
    this.round = r;
    const drawT = this.peekLevel() >= 1 ? r.wall[r.pos + 1] : -1;
    this.cur = 3;
    this.showHud();
    try {
      await this.emit({ k: 'deal', bet: this.roundBet, hand: [...r.hand], up: r.wall[r.pos], drawT, turns: r.turns, pos: r.pos });
    } finally {
      if (this.roundOpen && this.state.phase === 'idle') this.settle({ gross: this.roundBet });   // the emit was refused: never strand a stake
      this.busy = false;
      this.showHud();
    }
  }

  private async takeOrDraw(take: boolean): Promise<void> {
    const r = this.round, s = this.state;
    if (this.busy || !this.roundOpen || !r) return;
    if (s.phase !== 'pick') {
      if (s.phase === 'disc') { this.toast(this.t('needDiscard'), 'info'); this.sfx('buzzer', { vol: 0.5 }); }
      return;
    }
    this.busy = true;
    this.showHud();
    const bet = this.roundBet;
    const up = r.wall[r.pos];
    const res = pick(r, take);
    try {
      if (res.win) {
        const turn = r.turn;
        const mult = winMult(turn, res.win);
        const amount = payoutOf(this.rng, bet, mult);
        const win = toWinPub(turn, res.win, amount);
        const credit = (): void => { this.settle({ gross: amount, tags: ['mahjong', `turn:${turn}`, ...res.win!.bonuses] }); this.busy = true; };
        const shown = this.emit({ k: 'pick', take, got: res.got, hand: [...r.hand], dead: take ? -1 : up, pos: r.pos, win, bet }, credit);
        if (this.roundOpen) credit();                       // the emit was refused: still close the round
        await shown;
      } else {
        await this.emit({ k: 'pick', take, got: res.got, hand: [...r.hand], dead: take ? -1 : up, pos: r.pos, win: null, bet });
      }
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  private async discardCursor(): Promise<void> {
    const r = this.round, s = this.state;
    if (this.busy || !this.roundOpen || !r || s.phase !== 'disc') return;
    const arr = arrangement(s);
    const tile = arr[clamp(this.cur, 0, arr.length - 1)];
    this.busy = true;
    this.showHud();
    const bet = this.roundBet;
    try {
      const d = discard(r, tile);
      const hand = [...r.hand], discards = [...r.discards];
      if (!d.done) {
        const drawT = this.peekLevel() >= 1 ? r.wall[r.pos + 1] : -1;
        await this.emit({ k: 'disc', tile, hand, discards, up: r.wall[r.pos], drawT, pos: r.pos, turn: r.turn, done: false, waits: [], mult: 0, amount: 0, bet });
      } else {
        const res = resolve(r, null, this.nearAdd());
        const amount = res.near ? payoutOf(this.rng, bet, res.mult) : 0;
        const tags = res.near ? ['near'] : [];
        const credit = (): void => { this.settle({ gross: amount, tags }); this.busy = true; };
        const shown = this.emit({ k: 'disc', tile, hand, discards, up: -1, drawT: -1, pos: r.pos, turn: r.turn, done: true, waits: d.waits, mult: res.mult, amount, bet }, credit);
        if (this.roundOpen) credit();
        await shown;
      }
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  /** Stand-up mid-round: the greedy policy plays the rest and the result is paid (no animation beyond the result). */
  private async finishAuto(): Promise<void> {
    const r = this.round;
    if (this.busy || !this.roundOpen) return;
    this.busy = true;
    const bet = this.roundBet;
    try {
      if (!r) { this.settle({ gross: bet }); return; }
      const res = autoPlay(r, 'greedy', this.playOpts());
      const amount = payoutOf(this.rng, bet, res.mult);
      const win = res.win ? toWinPub(res.winTurn, res.win, amount) : null;
      const tags = res.win ? ['mahjong', `turn:${res.winTurn}`, ...res.win.bonuses, 'auto'] : res.near ? ['near', 'auto'] : ['auto'];
      const credit = (): void => { this.settle({ gross: amount, tags }); this.busy = true; };
      const shown = this.emit({
        k: 'end', hand: [...r.hand], discards: [...r.discards], pos: r.pos, turn: r.turn, win, waits: res.near ? waitsOf(r.hand) : [],
        mult: res.mult, amount, bet,
      }, credit);
      if (this.roundOpen) credit();
      await shown;
    } finally {
      this.busy = false;
    }
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'deal': return this.presentDeal(ev, pc);
      case 'pick': return this.presentPick(ev, pc);
      case 'disc': return this.presentDisc(ev, pc);
      case 'end': return this.presentEnd(ev, pc);
    }
  }

  private async presentDeal(ev: Extract<Ev, { k: 'deal' }>, pc: PresentCtx): Promise<void> {
    this.state = {
      ...blank(), phase: 'pick', hand: [...ev.hand], pos: ev.pos, turn: 1, turns: ev.turns, up: ev.up, drawT: ev.drawT, bet: ev.bet,
    };
    this.cur = 3;
    if (pc.fast) { this.refresh(); return; }
    const p = this.parts;
    this.refresh();
    for (const t of [...p.rack, p.up, p.draw]) t.root.visible = false;
    this.sfx('shuffle', { vol: 0.6 });
    for (let i = 0; i < ev.hand.length; i++) {
      await this.popIn(p.rack[i], 1, 0.09);
      if (this.disposed) return;
    }
    this.sfx('whoosh', { vol: 0.4 });
    await this.flipUp(false);
    if (!this.disposed) this.refresh();
  }

  private async presentPick(ev: Extract<Ev, { k: 'pick' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const p = this.parts;
    s.hand = [...ev.hand]; s.pos = ev.pos; s.up = -1; s.drawT = -1;
    if (!ev.take && ev.dead >= 0) s.dead.push(ev.dead);
    s.got = ev.win ? -1 : ev.got;
    s.phase = ev.win ? 'done' : 'disc';
    s.waits = [];
    if (ev.win) { s.won = !!pc.fast; s.win = ev.win.bonuses.slice(); }   // `won` lays the tiles flat: the show does it tile by tile
    const arr = arrangement({ hand: ev.hand, got: ev.got });
    const slot = Math.min(arr.length - 1, RACK_SLOTS - 1);
    if (!ev.win) this.cur = clamp(this.cur, 0, arr.length - 1);
    if (pc.fast) {
      if (ev.win) this.finishShow({ win: ev.win, waits: [], amount: ev.win.amount, bet: ev.bet }, pc);
      this.refresh();
      return;
    }
    // the tile slides into the 8th slot: the upcard itself (take), or the draw tile after the upcard dies (draw)
    const target = ev.take ? p.up : p.draw;
    if (!ev.take) {
      this.sfx('click', { vol: 0.5 });
      void this.anim(0.25, (k) => { p.up.root.scale.setScalar(UP_SCALE * (1 - k)); });
      await this.flipDraw(ev.got);
    }
    if (this.disposed) return;
    this.sfx('whoosh', { vol: 0.5 });
    await this.glide(target, rackPos(slot), RACK_TILT, 1, 0.3);
    if (this.disposed) return;
    this.refresh();
    if (ev.win) await this.finishShow({ win: ev.win, waits: [], amount: ev.win.amount, bet: ev.bet }, pc);
  }

  private async presentDisc(ev: Extract<Ev, { k: 'disc' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    const p = this.parts;
    const arr = arrangement(s);
    const before = this.cur;
    s.hand = [...ev.hand]; s.got = -1; s.discards = [...ev.discards]; s.pos = ev.pos; s.up = ev.up; s.drawT = ev.drawT;
    if (!ev.done) { s.turn = ev.turn; s.phase = 'pick'; } else { s.phase = 'done'; s.waits = [...ev.waits]; }
    this.cur = clamp(before, 0, Math.max(0, s.hand.length - 1));
    const n = s.discards.length;
    if (pc.fast) {
      if (ev.done) this.finishShow({ win: null, waits: ev.waits, amount: ev.amount, bet: ev.bet }, pc);
      this.refresh();
      return;
    }
    // the chosen rack tile flies to the discard pile, lying flat; then the rack closes up
    const slot = arr.indexOf(ev.tile) >= 0 && arr[before] === ev.tile ? before : arr.indexOf(ev.tile);
    const t = p.rack[Math.max(0, slot)];
    this.sfx('click', { vol: 0.6 });
    await this.glide(t, discardPos(Math.min(n - 1, DISCARD_SLOTS - 1)), -Math.PI / 2, FLAT_SCALE, 0.28);
    if (this.disposed) return;
    this.refresh();
    this.sfx('reelTick', { vol: 0.4 });                  // the bead of the spent turn went dark with the refresh
    if (ev.done) { await this.finishShow({ win: null, waits: ev.waits, amount: ev.amount, bet: ev.bet }, pc); return; }
    await this.wait(0.12);
    await this.flipUp(true);
    if (!this.disposed) this.refresh();
  }

  private async presentEnd(ev: Extract<Ev, { k: 'end' }>, pc: PresentCtx): Promise<void> {
    const s = this.state;
    s.hand = [...ev.hand]; s.discards = [...ev.discards]; s.pos = ev.pos; s.turn = ev.turn;
    s.phase = 'done'; s.got = -1; s.up = -1; s.drawT = -1; s.waits = [...ev.waits];
    s.won = !!ev.win; s.win = ev.win ? ev.win.bonuses.slice() : [];
    this.refresh();
    await this.finishShow({ win: ev.win, waits: ev.waits, amount: ev.amount, bet: ev.bet }, { ...pc, fast: true });
  }

  /** The ending: a Mahjong lays the tiles flat in green with a pour; a Near Hand glows its waits; else a low groan. */
  private async finishShow(r: { win: WinPub | null; waits: number[]; amount: number; bet: number }, pc: PresentCtx): Promise<void> {
    const p = this.parts, s = this.state;
    const net = r.amount - r.bet;
    const tier = juiceTier(r.amount, r.bet, r.win ? ['mahjong'] : []);
    if (pc.local) this.seatHud?.result(r.win ? (net > 0 ? 'win' : 'push') : r.amount > 0 ? 'push' : 'lose', net);
    if (pc.fast) { this.refresh(); return; }
    const fx = this.ctx.fx;
    if (r.win) {
      // lay every tile flat and glow green, one after the other
      const arr = arrangement({ hand: s.hand, got: -1 });
      const n = arr.length;
      this.sfx('win1');
      for (let i = 0; i < n; i++) {
        const t = p.rack[i];
        t.setGlow(GREEN, 0.9);
        void this.glide(t, new THREE.Vector3(rackPos(i).x, flatY(1), RACK_FLAT_Z), -Math.PI / 2, 1, 0.22);
        this.sfx('reelTick', { vol: 0.4, pitch: i });
        await this.wait(0.07);
      }
      await this.wait(0.2);
      if (this.disposed) return;
      s.won = true;
      fx.popText(p.centre, this.t('mahjong'), GOLD, { dur: 1.5, rise: 0.25, scale: 1.5, shake: r.win.mult >= 20 });
      fx.sparks(p.centre, 24, GREEN);
      fx.glow(p.centre, GREEN, 0.6, 0.6);
      for (const b of r.win.bonuses) {
        fx.popText(p.centre, this.t('b' + b[0].toUpperCase() + b.slice(1)), 0xefd67b, { dur: 1.1, rise: 0.12, scale: 1.0 });
        this.sfx('chime', { vol: 0.6, pitch: 3 });
        await this.wait(0.35);
        if (this.disposed) return;
      }
      this.sfx(tier === 'small' ? 'win2' : 'win3');
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
        await this.celebrate(tier, { amount: r.amount, bet: r.bet, restore: () => this.refresh(), fast: pc.fast });
      } else {
        await this.pourCoins(r.amount, { bet: r.bet, fast: pc.fast });
      }
      if (!this.disposed) this.refresh();
      return;
    }
    if (r.waits.length > 0) {
      // NEAR HAND: the waits glow, a held breath, then the small consolation
      this.refresh();
      this.sfx('chime', { pitch: 4 });
      await this.nearMiss({ dur: 0.7, at: p.waits[0].root });
      if (this.disposed) return;
      fx.popText(p.centre, this.t('nearPay', { n: fmtCoins(r.amount) }), CYAN, { dur: 1.3, rise: 0.2, scale: 1.1 });
      if (r.amount > 0) await this.pourCoins(r.amount, { bet: r.bet, fast: pc.fast });
      return;
    }
    this.commiserate({ amount: r.bet, at: p.centre });
    this.sfx('powerDown', { vol: 0.5 });
    await this.wait(0.3);
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  getSnapshot(): State {
    const s = this.state;
    return { ...s, hand: [...s.hand], discards: [...s.discards], dead: [...s.dead], waits: [...s.waits], win: [...s.win] };
  }
  applySnapshot(s: State): void {
    this.state = { ...blank(), ...s };
    this.cur = clamp(this.cur, 0, Math.max(0, arrangement(this.state).length - 1));
    if (s.phase === 'pick' || s.phase === 'disc') this.resume();       // a hand still in play stays playable
    this.refresh();
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────────
  /** Put every visual in the resting pose of `this.state`. Idempotent. */
  private refresh(): void {
    const s = this.state, p = this.parts;
    const arr = arrangement(s);
    const owed = s.phase === 'disc';
    const won = s.phase === 'done' && s.won;
    p.rack.forEach((t, i) => {
      const on = i < arr.length;
      t.root.visible = on;
      if (!on) return;
      t.setFace(arr[i]);
      t.root.scale.setScalar(1);
      const base = rackPos(i);
      if (won) {                                              // a Mahjong: every tile lies flat and glows green
        t.root.position.set(base.x, flatY(1), RACK_FLAT_Z);
        t.root.rotation.set(-Math.PI / 2, 0, 0);
        t.setGlow(GREEN, 0.9);
        return;
      }
      const lift = owed && i === this.cur;
      t.root.position.set(base.x, base.y + (lift ? 0.03 : 0), base.z + (lift ? 0.03 : 0));
      t.root.rotation.set(RACK_TILT, 0, 0);
      t.setGlow(lift ? GOLD : null, 0.7);
    });
    // the upcard and the draw spot
    const pickPhase = s.phase === 'pick';
    p.up.root.visible = pickPhase;
    p.up.root.position.copy(UP_POS); p.up.root.scale.setScalar(UP_SCALE); p.up.root.rotation.x = -0.32;
    if (pickPhase) p.up.setFace(s.up);
    p.draw.root.visible = pickPhase;
    p.draw.root.position.copy(DRAW_POS); p.draw.root.scale.setScalar(DRAW_SCALE); p.draw.root.rotation.x = -0.32;
    if (pickPhase) p.draw.setFace(s.drawT >= 0 ? s.drawT : -1);
    // discards
    p.discards.forEach((t, i) => {
      const tile = s.discards[i];
      t.root.visible = tile !== undefined && i < DISCARD_SLOTS;
      if (t.root.visible) { t.setFace(tile); t.root.position.copy(discardPos(i)); t.root.rotation.x = -Math.PI / 2; t.root.scale.setScalar(FLAT_SCALE); }
    });
    // waits: the Near Hand's, or the hint's
    const hintWaits = this.hintInfo().waits;
    const waits = s.phase === 'done' ? s.waits : hintWaits;
    const glow = s.phase === 'done' ? GREEN : CYAN;
    p.waits.forEach((t, i) => {
      const tile = waits[i];
      t.root.visible = tile !== undefined && i < WAIT_SLOTS;
      if (!t.root.visible) return;
      t.setFace(tile);
      t.root.position.copy(waitPos(i, Math.min(waits.length, WAIT_SLOTS)));
      t.root.rotation.x = -Math.PI / 2;
      t.root.scale.setScalar(1);
      t.setGlow(glow, 0.9);
    });
    // the wall and the turn beads
    const left = this.wallLeft();
    p.wall.count = Math.max(0, Math.min(p.wall.instanceMatrix.count, Math.ceil(left / 2)));
    const live = s.phase === 'idle' ? s.turns : s.phase === 'done' ? 0 : s.turns - s.turn + 1;
    p.beads.set(s.phase === 'idle' ? BASE_TURNS : s.turns, live);
    this.refreshHint();
    this.paintFelt();
    this.showHud();
  }

  private wallLeft(): number {
    const s = this.state;
    if (s.phase === 'idle') return WALL_SIZE;
    return Math.max(0, WALL_SIZE - s.pos - (s.phase === 'pick' ? 1 : 0));
  }

  /** A pseudo round for the hint (the hint only reads the public state and the two tiles on show). */
  private hintRound(): Round {
    const s = this.state;
    const wall: number[] = [];
    wall[s.pos] = s.up; wall[s.pos + 1] = s.drawT;
    return { wall, hand: [...s.hand], pos: s.pos, turn: s.turn, turns: s.turns, phase: s.phase === 'disc' ? 'disc' : 'pick', discards: s.discards, dead: s.dead };
  }

  /** What the hint ring marks: the rack slot or the up / draw tile, and the waits after the suggested discard. */
  private hintInfo(): { target: TileObj | null; waits: Tile[] } {
    const s = this.state, p = this.parts;
    if (!this.hintOn || !this.isLocalOccupant) return { target: null, waits: [] };
    if (s.phase === 'pick') {
      const r = this.hintRound();
      const take = s.drawT >= 0 ? suggestTake(r, true) : suggestTake(r, false);
      return { target: take ? p.up : p.draw, waits: [] };
    }
    if (s.phase === 'disc') {
      const t = bestDiscard(s.hand, unseenCounts(this.hintRound()));
      const arr = arrangement(s);
      const slot = arr[arr.length - 1] === t ? arr.length - 1 : arr.indexOf(t);
      const rest = [...s.hand];
      rest.splice(rest.indexOf(t), 1);
      return { target: p.rack[Math.max(0, slot)], waits: waitsOf(rest) };
    }
    return { target: null, waits: [] };
  }

  private refreshHint(): void {
    const { target } = this.hintInfo();
    const ring = this.parts.hint;
    ring.visible = !!target;
    this.hintBase = 0;
    if (!target) return;
    this.hintBase = target.root.scale.x;
    const r = target.root;
    // centre of the tile's face, a little in front of it (the tile's own tilt carries the offset)
    const off = new THREE.Vector3(0, 0.06 * r.scale.y, 0.045 * r.scale.z).applyEuler(r.rotation);
    ring.position.copy(r.position).add(off);
    ring.rotation.set(r.rotation.x, 0, 0);
    ring.scale.setScalar(r.scale.x);
  }

  /** Felt captions (TAKE / DRAW / DISCARDS / WAITS), a gold border and a quiet pattern. Repainted on language change. */
  private paintFelt(): void {
    const f = this.parts.felt;
    f.draw((g, sc) => {
      g.fillStyle = '#0f4a37'; g.fillRect(0, 0, sc.w, sc.h);
      g.strokeStyle = '#c59c42'; g.lineWidth = 1; g.strokeRect(3.5, 3.5, sc.w - 7, sc.h - 7);
      const px = (m: number): number => Math.round(sc.w / 2 + m * 250);
      const pz = (m: number): number => Math.round(sc.h / 2 + m * 250);
      // faint slot outlines for the discards (left); a flat tile's centre is half its depth behind its base
      g.strokeStyle = '#1d6a50'; g.lineWidth = 1;
      const slot = (v: { x: number; z: number }): void => g.strokeRect(px(v.x) - 9, pz(v.z - 0.048) - 12, 18, 24);
      for (let i = 0; i < DISCARD_SLOTS; i++) slot(discardPos(i));
      const cap = (key: string, mx: number, mz: number): void => {
        drawText(g, this.t(key), px(mx), pz(mz), { font: 'px5', scale: 2, color: '#efd67b', align: 'center' });
      };
      if (this.state.phase === 'pick') {
        cap('take', UP_POS.x, UP_POS.z + 0.055);
        cap('draw', DRAW_POS.x, DRAW_POS.z + 0.055);
      }
    });
  }

  // ── animation helpers ──────────────────────────────────────────────────────────────────────────────
  /** Slide a tile object to a pose (position, tilt about X, uniform scale), with a small arc. */
  private async glide(t: TileObj, to: THREE.Vector3, rotX: number, scale: number, dur: number): Promise<void> {
    const o = t.root;
    const p0 = o.position.clone(), r0 = o.rotation.x, s0 = o.scale.x;
    o.visible = true;
    await this.anim(dur, (k) => {
      o.position.lerpVectors(p0, to, k);
      o.position.y += Math.sin(k * Math.PI) * 0.05;
      o.rotation.x = lerp(r0, rotX, k);
      o.scale.setScalar(lerp(s0, scale, k));
    }, 'outCubic');
  }

  /** A tile appears: scale up from small with a drop. */
  private async popIn(t: TileObj, scale: number, wait: number): Promise<void> {
    t.root.visible = true;
    const y0 = t.root.position.y;
    this.sfx('reelTick', { vol: 0.4, pitch: Math.round(this.cosmetic.next() * 3) });
    void this.anim(0.18, (k) => { t.root.scale.setScalar(scale * (0.4 + 0.6 * k)); t.root.position.y = y0 + (1 - k) * 0.06; }, 'outBack');
    await this.wait(wait);
  }

  /** The House flips the next upcard from the wall: it rises to the easel and turns face up. */
  private async flipUp(fromWall: boolean): Promise<void> {
    const p = this.parts, s = this.state;
    if (s.up < 0) return;
    const from = wallBox(Math.max(0, p.wall.count - 1));
    p.up.setFace(-1);
    p.up.root.visible = true;
    p.up.root.scale.setScalar(0.6);
    p.up.root.rotation.x = -Math.PI / 2;
    p.up.root.position.set(from.x, from.y + 0.02, from.z);
    p.draw.root.visible = true;
    p.draw.setFace(s.drawT >= 0 ? s.drawT : -1);
    p.draw.root.scale.setScalar(DRAW_SCALE); p.draw.root.rotation.x = -0.32; p.draw.root.position.copy(DRAW_POS);
    this.sfx('whoosh', { vol: 0.4 });
    await this.glide(p.up, UP_POS, -0.32, UP_SCALE, 0.3);
    if (this.disposed) return;
    this.sfx('reelTick', { vol: 0.5 });
    await this.anim(0.14, (k) => { p.up.root.rotation.y = Math.PI * k * 0.5; });
    p.up.setFace(s.up);
    await this.anim(0.14, (k) => { p.up.root.rotation.y = Math.PI * 0.5 * (1 - k); });
    p.up.root.rotation.y = 0;
    void fromWall;
  }

  /** The draw tile turns over (a wall-peek already shows it) before sliding to the rack. */
  private async flipDraw(tile: Tile): Promise<void> {
    const p = this.parts;
    if (p.draw.face === tile) return;
    this.sfx('reelTick', { vol: 0.5 });
    await this.anim(0.12, (k) => { p.draw.root.rotation.y = Math.PI * 0.5 * k; });
    p.draw.setFace(tile);
    await this.anim(0.12, (k) => { p.draw.root.rotation.y = Math.PI * 0.5 * (1 - k); });
    p.draw.root.rotation.y = 0;
  }

  // ── seat HUD (readability standard, see _base/seatHud.ts) ─────────────────────────────────────
  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.mahjong.tip1', v: { deal: this.k('primary'), bet: `${this.k('betDown')}/${this.k('betUp')}` } },
      { k: 'm.mahjong.tip2', v: { take: this.k('n1'), draw: this.k('n2'), disc: this.k('primary') } },
      { k: 'm.mahjong.tip3', v: { left: this.k('left'), right: this.k('right'), hint: this.k('alt'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6', 'rule7'].map((r) => ({ k: 'm.mahjong.' + r }));
  }

  /** Banner, key numbers and valid controls. Only while the local player sits at the machine. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.state, busy = this.busy;
    const open = this.roundOpen;
    const bet = open ? this.roundBet : this.bet;
    sh.goal({ k: 'm.mahjong.goal' });

    // STATE: what phase, what the player must decide
    if (busy) sh.state({ k: 'm.mahjong.stBusy' }, 'neutral');
    else if (s.phase === 'pick') sh.state({ k: 'm.mahjong.stPick' }, 'good', { k: 'm.mahjong.stPickSub', v: { n: s.turn, t: s.turns, m: payOf(s.turn) } });
    else if (s.phase === 'disc') sh.state({ k: 'm.mahjong.stDisc' }, 'gold', { k: 'm.mahjong.stDiscSub', v: { left: this.k('left'), right: this.k('right'), disc: this.k('primary') } });
    else if (s.phase === 'done') sh.state({ k: 'm.mahjong.stDone' }, 'neutral', { k: 'm.mahjong.stDoneSub', v: { deal: this.k('primary') } });
    else sh.state({ k: 'm.mahjong.stBet' }, 'gold', { k: 'm.mahjong.stBetSub', v: { deal: this.k('primary') } });

    // KEY NUMBERS
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.mahjong.nBet' }, value: fmtCoins(bet), tone: 'gold' });
    if (open) {
      nums.push({ label: { k: 'm.mahjong.nTurn' }, value: `${s.turn}/${s.turns}`, tone: 'neutral' });
      nums.push({ label: { k: 'm.mahjong.nPays' }, value: `×${payOf(s.turn)}`, tone: 'good' });
      nums.push({ label: { k: 'm.mahjong.nWall' }, value: String(this.wallLeft()), tone: 'cyan' });
    }
    nums.push({ label: { k: 'm.mahjong.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys bound to it
    const ctrl: HudControl[] = [];
    if (!busy) {
      if (s.phase === 'pick' && open) {
        ctrl.push({ key: this.k('n1'), label: { k: 'm.mahjong.cTake' }, action: 'n1', primary: true });
        ctrl.push({ key: this.k('n2'), label: { k: 'm.mahjong.cDraw' }, action: 'n2', primary: true });
      } else if (s.phase === 'disc' && open) {
        ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: { k: 'm.mahjong.cMove' }, action: 'right' });
        ctrl.push({ key: this.k('primary'), label: { k: 'm.mahjong.cDiscard' }, action: 'primary', primary: true });
      } else if (!open) {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.mahjong.cDeal' }, action: 'primary', primary: true });
        ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.mahjong.cBet' }, action: 'betUp' });
      }
    }
    ctrl.push({ key: this.k('alt'), label: { k: 'm.mahjong.cHint' }, action: 'alt' });
    ctrl.push({ key: this.k('help'), label: { k: 'm.mahjong.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.mahjong.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

