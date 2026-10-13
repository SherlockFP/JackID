/**
 * Shell Automaton "Monsieur Thimble" (`shellgame`) — solo cup game (MACHINES_tables §21, plan.json logicBrief). Copies the
 * mines/coinflip pattern: the logic / present split.
 *
 *  - the authority (the local occupant) rolls the whole shuffle at insert (`shuffle`: palm + swap list) and keeps it in
 *    `sec`. It `emit`s `start`, then one `swap` per swap (each a separate event, so watchers never learn the final cup
 *    early), a `palm` at the glint frame when the pearl is palmed, and waits for a lift;
 *  - a lift is graded by the pure `grade()` and `emit`ted as `pick`; a wrong cup may give one second guess (charm);
 *    the round closes with `end`, which carries the pearl and the result (the reveal). The wallet step (`settle`) runs
 *    before the presentation (DECISIONS G);
 *  - `present()` is the only place the visible state changes; the animation runs on every peer;
 *  - heat = consecutive wins (0–5). A win that reaches the jam count sets OUT OF ORDER until the next Night.
 *
 * Controls: Space insert · 1 / 2 / 3 or LMB a cup · 4 or the red button = Call Cheat · [ ] / wheel stake · H help ·
 * E stands up (during PICK = loss; during the shuffle it waits for the round to end).
 */
import * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { KitX } from '@/kit';
import { fmtCoins, t } from '@/core/i18n';
import { aimArm, buildModel, CUP_LIFT, CUP_Z, FELT_Y, REST_L, REST_R, SHOULDER_L, SHOULDER_R, SLOT_X, type ShellParts } from './model';
import {
  CHEAT, CHEAT_TO, CUPS, HEAT_MAX, HOOK_CHEAT_ADD, HOOK_GLINT, HOOK_HEAT_CAP, HOOK_SECOND, HOOK_SWAP_SLOW, NONE, PICK_S,
  START_CUP, STAKE_MAX, STAKE_MAX_L25, STAKE_MIN, clamp, decayed, effectiveHeat, grade, heatRow, jamAt, nextStreak, playHeadless,
  shuffle, type Verdict,
} from './rules';
import STR from './shellgame.strings';

export { playHeadless };

const GOLD = 0xffd040;
const GREEN = 0x33ff66;
const RED = 0xff3020;
const WHITE = 0xffffff;
const AMBER = 0xffa032;

export type Phase = 'idle' | 'show' | 'shuffle' | 'pick' | 'second' | 'reveal' | 'jam';
type Ev =
  /** Round committed: the stake, the effective heat and the streak it started from, the swap count, the second-guess term. */
  | { k: 'start'; stake: number; heat: number; streak: number; n: number; second: boolean; cheatTo: number }
  /** One swap of two cup slots; `dur` ms of animation; `last` closes the shuffle and opens PICK. */
  | { k: 'swap'; i: number; a: number; b: number; dur: number; last: boolean }
  /** The pearl is palmed: it leaves the felt before swap `i`. `f` = glint frames (cosmetic). */
  | { k: 'palm'; i: number; f: number }
  /** A lift: slot `c` (or CHEAT / NONE). `more` = a second guess follows. */
  | { k: 'pick'; c: number; n: number; more: boolean }
  /** Round closed: the reveal and the payout (credited before the presentation). `pearl` NONE when palmed. */
  | { k: 'end'; win: boolean; kind: Verdict['kind']; gross: number; bet: number; pearl: number; palmed: boolean; streak: number; jam: boolean };
type StartEv = Extract<Ev, { k: 'start' }>;
type SwapEv = Extract<Ev, { k: 'swap' }>;
type PalmEv = Extract<Ev, { k: 'palm' }>;
type PickEv = Extract<Ev, { k: 'pick' }>;
type EndEv = Extract<Ev, { k: 'end' }>;

type State = {
  open: boolean;      // a round is in flight (mirrors the round on every peer)
  phase: Phase;
  stake: number;      // stake of the open round
  heat: number;       // effective heat of the open round (display)
  streak: number;     // consecutive wins here
  n: number;          // swaps of the open round
  second: boolean;    // the open round has a second guess (charm)
  cheatTo: number;    // winnings multiple of a Call Cheat in the open round
  perm: number[];     // cup identity standing in each slot (left, middle, right)
  pearl: number;      // slot of the pearl, NONE when palmed or hidden
  palmed: boolean;
  picks: number[];    // lifts so far this round (slots, CHEAT, NONE)
  jammed: boolean;    // OUT OF ORDER until the Night changes
  jamNight: number;   // the Night the automaton jammed in
  lastRes: string;    // 'win' | 'cheat' | 'lose' | ''
};

/** Owner-only shuffle of the open round (never sent to other players; saved for the owner's reload). */
type Secret = { swaps: Array<[number, number]>; palmAt: number; pearl: number };
type Snap = { s: State; sec: Secret | null };

function freshState(): State {
  return {
    open: false, phase: 'idle', stake: 0, heat: 0, streak: 0, n: 0, second: false, cheatTo: CHEAT_TO,
    perm: [0, 1, 2], pearl: NONE, palmed: false, picks: [], jammed: false, jamNight: -1, lastRes: '',
  };
}

const CHEAT_TO_FEAT = 'shellgame.cheat4';
const JAM_FEAT = 'shellgame.jam7';
const DECAY_FEAT = 'shellgame.heatDecay';
const CAP50_FEAT = 'shellgame.stakeCap50';

export const def: MachineDef = {
  id: 'shellgame',
  category: 'oddity',
  slotSize: 'M',
  zone: 'parlour',
  seats: 1,
  shared: false,
  minBet: STAKE_MIN, maxBet: STAKE_MAX, betSteps: [5, 10, 20],
  maxPayoutMult: 6,
  rtp: 0.567,                       // the random-guess baseline at heat 0 (the skill ceiling is far higher)
  tier: 3,
  actionCost: 2,
  headless: playHeadless,
  tags: ['solo', 'skill', 'curio', 'commit-reveal'],
  modHooks: {
    'm.shellgame.swapSlow': 'Multiplies the swap time (Brass Knuckles = 0.8). Presentation only.',
    'm.shellgame.glintFrames': 'Frames the palm glint shows (Dowsing Rod adds 2). Cosmetic only.',
    'm.shellgame.cheatPayAdd': 'Adds winnings multiple to Call Cheat (base 3:1).',
    'm.shellgame.heatCap': 'Caps the heat used for the shuffle (base 5).',
    'm.shellgame.secondGuess': 'Charges: after a wrong cup, one more lift per round; a hit pays 0.5:1.',
    luck: 'Core luck: lowers the palm chance by luck percent (c × (1 − L/100)).',
  },
  strings: { en: STR.en, tr: STR.tr },
};

export default class ShellGame extends MachineBase<ShellParts, Ev, Snap> {
  private st: State = freshState();
  private sec: Secret | null = null;
  private idle = 0;                 // seconds in PICK (the lift timer)
  private away = 0;                 // seconds since the last round closed (heat decay)
  private leaving = false;
  private wagT = 0;
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<ShellParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.attractor.every('wag', 7, () => this.wag(), { first: 3 });
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  // ── attract: the automaton wags a finger now and then ────────────────────────────────────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private wag(): void {
    if (this.busy || this.roundOpen) return;
    const finger = this.parts.thimble.armL.finger;
    this.ctx.tweens.run(0.6, (k) => { finger.rotation.z = 0.5 * Math.sin(k * Math.PI * 3); }, {
      onDone: () => { finger.rotation.z = 0; },
    });
  }

  // ── occupancy ────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      if (this.st.open && !this.roundOpen) this.recoverRound();
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('shellgame', this.tipLines());
    }
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.hud(null); this.seatHud?.hide(); }
    // Normal path: standUp() already settled a pick-phase round. Safety net: never strand a stake.
    if (local && this.roundOpen) {
      const s = this.st;
      if (s.phase === 'pick' || s.phase === 'second') this.settle({ gross: 0, tags: ['loss', 'walked'] });
      else this.settle({ gross: s.stake, tags: ['void'] });
    }
    this.sec = null;
    this.leaving = false;
    if (this.st.open) { this.st.open = false; this.st.phase = 'idle'; }
    this.refresh();
  }

  onLang(): void {
    if (this.isLocalOccupant) this.showHud();
  }

  /** E: during PICK the round is a loss (the stake is already in the cups). During the shuffle it waits. */
  protected override standUp(): void {
    if (this.roundOpen) {
      this.leaving = true;
      if (!this.busy && (this.st.phase === 'pick' || this.st.phase === 'second')) void this.pickCup(NONE);
    }
    super.standUp();
  }

  /** Stakes: 5, 10, 20 (50 with the L25 milestone). */
  protected override betLadder(): number[] {
    return this.feature(CAP50_FEAT) ? [5, 10, 20, STAKE_MAX_L25] : [5, 10, STAKE_MAX];
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (e.repeat && a !== 'betUp' && a !== 'betDown') return;
    switch (a) {
      case 'primary': if (!this.roundOpen) void this.insert(); break;            // Space inserts the coin
      case 'n1': case 'n2': case 'n3': void this.pickCup(Number(a.slice(1)) - 1); break;
      case 'n4': void this.pickCup(CHEAT); break;
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;

    }
  }

  onPointer(e: MachinePointerEvent): void {
    const hit = this.pick([...this.parts.cups, this.parts.cheat.root, this.parts.coinSlot]);
    if (!hit || e.type !== 'down' || e.button !== 0) return;
    const id = this.cupOf(hit.object);
    if (id >= 0) { void this.pickCup(this.st.perm.indexOf(id)); return; }
    if (this.isInside(hit.object, this.parts.cheat.root)) { void this.pickCup(CHEAT); return; }
    if (this.isInside(hit.object, this.parts.coinSlot) && !this.roundOpen) void this.insert();
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private cupOf(obj: THREE.Object3D): number {
    const cups = this.parts.cups;
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      const i = cups.indexOf(o as THREE.Group);
      if (i >= 0) return i;
    }
    return -1;
  }

  private isInside(obj: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o === root) return true;
    return false;
  }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private terms() {
    return { cheatTo: this.st.cheatTo, second: this.st.second };
  }

  /** Insert the coin: charge the stake, roll the shuffle, announce the start, then stream the swaps. */
  private async insert(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    const s = this.st;
    if (s.jammed) { this.toast(this.t('jammed'), 'bad'); this.sfx('buzzer'); return; }
    const stake = this.bet;
    if (!this.beginRound(stake)) return;                   // charges the wallet, busy = true, re-seeds this.rng
    const streak = decayed(s.streak, this.away, this.feature(DECAY_FEAT));
    const cap = clamp(Math.round(this.mod(HOOK_HEAT_CAP, HEAT_MAX)), 0, HEAT_MAX);
    const heat = effectiveHeat(streak, cap);
    const sh = shuffle(this.rng, heat, this.luck());
    this.sec = { swaps: sh.swaps, palmAt: sh.palmAt, pearl: sh.pearl };
    const row = heatRow(heat);
    const slow = Math.max(0.2, this.mod(HOOK_SWAP_SLOW, 1));
    const second = this.mod(HOOK_SECOND, 0) > 0;
    const cheatTo = CHEAT_TO + this.mod(HOOK_CHEAT_ADD, 0) + (this.feature(CHEAT_TO_FEAT) ? 1 : 0);
    this.showHud();
    try {
      await this.emit({ k: 'start', stake, heat, streak, n: sh.swaps.length, second, cheatTo });
      for (let i = 0; i < sh.swaps.length; i++) {
        if (i === sh.palmAt) await this.emit({ k: 'palm', i, f: Math.max(1, Math.round(this.mod(HOOK_GLINT, 2))) });
        const [a, b] = sh.swaps[i];
        await this.emit({ k: 'swap', i, a, b, dur: Math.round(row.swapS * slow * 1000), last: i === sh.swaps.length - 1 });
      }
    } finally {
      this.busy = false;
      this.idle = 0;
      this.showHud();
    }
    if (this.leaving && this.roundOpen) void this.pickCup(NONE);
  }

  /**
   * Lift a cup (slot 0–2), call the cheat (CHEAT) or let the timer run out (NONE). A wrong cup with the second guess
   * charm keeps the round open for one more lift.
   */
  private async pickCup(c: number): Promise<void> {
    const s = this.st;
    if (!this.roundOpen || this.busy || !s.open || !this.sec) return;
    if (s.phase !== 'pick' && s.phase !== 'second') return;
    if (c === CHEAT && s.phase === 'second') { this.toast(this.t('cheatOnly'), 'bad'); this.sfx('buzzer'); return; }
    if (c >= 0 && c < CUPS && s.picks.includes(c)) { this.toast(this.t('sameCup'), 'bad'); this.sfx('buzzer', { vol: 0.5 }); return; }
    this.busy = true;
    this.idle = 0;
    this.showHud();
    const picks = [...s.picks, c];
    const v = grade(s.stake, this.sec.pearl, picks, this.terms());
    const more = !v.win && s.phase === 'pick' && s.second && c >= 0 && c < CUPS;
    await this.emit({ k: 'pick', c, n: picks.length, more });
    if (more) { this.busy = false; this.showHud(); return; }
    await this.endRound(v);
  }

  /** Close the round: settle first (credit), then present the reveal. The authority's `busy` is cleared here. */
  private async endRound(v: Verdict): Promise<void> {
    const s = this.st, sec = this.sec;
    if (!sec || !this.roundOpen) { this.busy = false; return; }
    const jamWins = jamAt(this.feature(JAM_FEAT));
    const nx = nextStreak(s.streak, v.win, jamWins);
    const gross = v.gross;
    const credit = (): void => { this.settle({ gross, tags: this.tagsFor(v, nx.streak) }); };
    this.busy = true;
    const ev: EndEv = {
      k: 'end', win: v.win, kind: v.kind, gross, bet: s.stake, pearl: sec.pearl, palmed: sec.pearl === NONE,
      streak: nx.streak, jam: nx.jam,
    };
    const shown = this.emit(ev, credit);
    if (this.roundOpen) credit();                         // the emit was refused: still settle, never strand a stake
    this.sec = null;
    this.leaving = false;
    this.away = 0;
    try { await shown; } finally { this.busy = false; this.showHud(); }
  }

  private tagsFor(v: Verdict, streak: number): string[] {
    const tags = [v.win ? 'win' : 'loss', v.kind === 'cheat' ? 'cheat' : v.kind === 'second' ? 'second' : 'cup'];
    if (v.win && streak >= 3) tags.push('streak:' + streak);
    return tags;
  }

  /** A round restored from a save: resume the pick if the shuffle was done, else refund the stake (never a silent loss). */
  private recoverRound(): void {
    const s = this.st;
    const resumable = (s.phase === 'pick' || s.phase === 'second') && this.sec !== null;
    if (resumable) { this.resumeRound(s.stake); this.idle = 0; this.showHud(); return; }
    this.resumeRound(s.stake);
    this.settle({ gross: s.stake, tags: ['void'] });
    s.open = false;
    s.phase = 'idle';
    s.picks = [];
    this.sec = null;
    this.refresh();
  }

  // ── timers (sim clock, every peer; the lift timer acts on the local occupant only) ───────────────
  tick(dt: number): void {
    if (!this.roundOpen) this.away += dt;
    const s = this.st;
    if (s.jammed && this.ctx.run.night() !== s.jamNight) {        // a new Night: the automaton recovers
      s.jammed = false;
      s.streak = 0;
      this.refresh();
    }
    if (!this.isLocalOccupant || !this.roundOpen || this.busy) return;
    if (s.phase !== 'pick' && s.phase !== 'second') return;
    this.idle += dt;
    if (this.idle >= PICK_S) { this.idle = 0; void this.pickCup(NONE); return; }
    if (Math.floor(this.idle) !== Math.floor(this.idle - dt)) this.showHud();
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'swap': return this.presentSwap(ev, pc);
      case 'palm': return this.presentPalm(ev, pc);
      case 'pick': return this.presentPick(ev, pc);
      case 'end': return this.presentEnd(ev, pc);
    }
  }

  private async presentStart(ev: StartEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.open = true; s.stake = ev.stake; s.heat = ev.heat; s.streak = ev.streak; s.n = ev.n;
    s.second = ev.second; s.cheatTo = ev.cheatTo;
    s.perm = [0, 1, 2]; s.pearl = START_CUP; s.palmed = false; s.picks = []; s.phase = 'show';
    this.parts.leds.bet.setOn(false);
    this.parts.leds.credit.setOn(true);
    this.parts.leds.win.setOn(false);
    this.parts.lamp.setOn(true);
    this.refresh();
    if (this.isLocalOccupant) this.showHud();
    if (pc.fast) { this.placePearl(START_CUP); this.parts.pearl.visible = false; return; }
    this.sfx('powerUp', { vol: 0.6 });
    // SHOW: the cups lift and the pearl sits under the middle cup (1.0 s)
    await this.anim(0.25, (k) => this.liftAll(CUP_LIFT * k), 'outQuad');
    this.placePearl(START_CUP);
    this.parts.pearl.visible = true;
    this.sfx('chime', { vol: 0.5, pitch: 7 });
    await this.wait(1.0);
    // COVER: the cups come down over the pearl (0.5 s)
    this.parts.pearl.visible = false;
    this.sfx('cardSlap', { vol: 0.6 });
    await this.anim(0.5, (k) => this.liftAll(CUP_LIFT * (1 - k)), 'inQuad');
    s.phase = 'shuffle';
  }

  private async presentSwap(ev: SwapEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    const { a, b } = ev;
    const ca = this.cupAt(a), cb = this.cupAt(b);
    // 1. data first: the cups and the pearl trade slots
    const tmp = s.perm[a]; s.perm[a] = s.perm[b]; s.perm[b] = tmp;
    if (s.pearl === a) s.pearl = b;
    else if (s.pearl === b) s.pearl = a;
    if (ev.last) s.phase = 'pick';
    if (pc.fast) { this.refresh(); return; }
    // 2. pixels: each cup runs a semicircle (radius = half the separation), the hands stay above the cups
    this.sfx('clockTick', { vol: 0.35, pitch: s.heat });
    this.sfx('tileClack', { vol: 0.3, pitch: -8 });
    const xa = SLOT_X[a], xb = SLOT_X[b], mid = (xa + xb) / 2, R = Math.abs(xa - xb) / 2;
    const moving = [
      { cup: ca, x0: xa, x1: xb, dir: 1 },
      { cup: cb, x0: xb, x1: xa, dir: -1 },
    ];
    const leftFirst = xa < xb ? moving[0] : moving[1];
    const rightFirst = xa < xb ? moving[1] : moving[0];
    const hover = new THREE.Vector3(0, 0.14, 0);
    const target = new THREE.Vector3();
    await this.anim(ev.dur / 1000, (k) => {
      const th = Math.PI * k;
      for (const m of moving) {
        m.cup.position.set(mid + (m.x0 - mid) * Math.cos(th), FELT_Y + 0.015 * Math.sin(th), CUP_Z + R * Math.sin(th) * m.dir);
      }
      target.copy(leftFirst.cup.position).add(hover);
      aimArm(this.parts.thimble.armL, SHOULDER_L, target);
      target.copy(rightFirst.cup.position).add(hover);
      aimArm(this.parts.thimble.armR, SHOULDER_R, target);
    }, 'outQuad');
    this.refresh(false);                                  // the hands stay over the cups between swaps
  }

  private async presentPalm(ev: PalmEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.palmed = true;
    s.pearl = NONE;
    const glint = this.parts.thimble.sleeveGlint;
    if (pc.fast) return;
    glint.visible = true;
    this.sfx('sparkle', { vol: 0.6 });
    await this.wait(ev.f / 30);                          // 2 frames at 30 fps by default
    glint.visible = false;
  }

  private async presentPick(ev: PickEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.picks = [...s.picks, ev.c];
    s.phase = ev.more ? 'second' : 'reveal';
    if (pc.fast) { this.refresh(); return; }
    if (ev.c >= 0 && ev.c < CUPS) {
      const cup = this.cupAt(ev.c);
      this.sfx('click', { vol: 0.8 });
      await this.anim(0.18, (k) => { cup.position.y = FELT_Y + CUP_LIFT * k; }, 'outQuad');
      // the picked cup stays up: the pearl is not under it (the rule grades the pick; the reveal shows the rest)
      if (ev.more) this.ctx.fx.popText(cup, this.t('empty'), GOLD, { dur: 0.9, rise: 0.25, scale: 1 });
      else this.sfx('tileClack', { vol: 0.9 });
      await this.wait(0.12);
      return;
    }
    if (ev.c === CHEAT) {
      // Call Cheat: the finger wags at you and the automaton's head tilts
      this.sfx('lever', { vol: 0.6 });
      const finger = this.parts.thimble.armL.finger;
      await this.anim(0.3, (k) => { finger.rotation.z = 0.5 * Math.sin(k * Math.PI * 2); }, 'outQuad');
      finger.rotation.z = 0;
      return;
    }
    // timeout: the automaton tuts
    this.sfx('clockAlarm', { vol: 0.5 });
    this.ctx.fx.popText(this.parts.thimble.head, this.t('tooSlow'), RED, { dur: 1.0, rise: 0.25, scale: 1 });
    await this.wait(0.2);
  }

  private async presentEnd(ev: EndEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    const fx = this.ctx.fx;
    const tier = juiceTier(ev.gross, ev.bet);
    const th = this.parts.thimble;
    s.open = false;
    s.streak = ev.streak;
    s.pearl = ev.pearl;
    s.palmed = ev.palmed;
    s.phase = 'reveal';
    s.lastRes = ev.win ? (ev.kind === 'cheat' ? 'cheat' : 'win') : 'lose';
    if (this.isLocalOccupant) {
      if (ev.gross > ev.bet) this.seatHud?.result('win', ev.gross - ev.bet);
      else if (ev.gross === ev.bet) this.seatHud?.result('push');
      else this.seatHud?.result('lose', ev.gross - ev.bet);
    }
    if (ev.jam) { s.jammed = true; s.jamNight = this.ctx.run.night(); s.phase = 'jam'; }
    if (pc.fast) {
      this.liftAll(CUP_LIFT);
      this.placeReveal(ev.pearl, ev.palmed);
      this.refresh();
      return;
    }
    // 1. reveal: every cup lifts, the pearl shows where it was (or in the palm, when palmed)
    await this.anim(0.25, (k) => this.liftAll(CUP_LIFT * k), 'outBack');
    this.placeReveal(ev.pearl, ev.palmed);
    this.parts.pearl.visible = true;
    if (ev.palmed) {
      // the automaton opens his glove and shows the pearl, laughing
      this.sfx('whisper', { vol: 0.8 });
      this.sfx('lightFlicker', { vol: 0.4 });
      const finger = th.armL.finger;
      await this.anim(0.35, (k) => { finger.rotation.z = 0.6 * Math.sin(k * Math.PI * 3); }, 'outQuad');
      finger.rotation.z = 0;
    } else {
      this.sfx('chime', { vol: 0.8, pitch: 5 });                   // the pearl's ting (2.6 kHz)
      fx.glow(this.parts.pearl, GOLD, 0.2, 0.5);
    }
    // 2. impact by result
    if (ev.win) {
      if (ev.kind === 'cheat') {
        // correct cheat call: alarm, the automaton freezes, sparks from the neck, pays out
        this.sfx('clockAlarm', { vol: 1.0 });
        fx.sparks(th.head, 16, GOLD);
        fx.flash(WHITE, 0.5, 0.1);
        if (pc.local) fx.shake(0.008, 0.25);
        await this.wait(0.6);
      } else {
        this.sfx('win2', { vol: 0.7 });
        fx.sparks(ev.pearl >= 0 ? this.cupAt(ev.pearl) : th.head, 10, GREEN);
      }
      this.parts.leds.win.setOn(true);
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') this.sfx('cashRegister', { vol: 0.8 });
      await this.pourCoins(ev.gross, { bet: ev.bet, fast: pc.fast });
    } else {
      if (!ev.palmed && ev.pearl >= 0) {
        // the horror twist: the jaw opens and the pearl rests on a tongue
        this.sfx('porcelainCrack', { vol: 0.5 });
        await this.anim(0.3, (k) => { th.jaw.rotation.x = 0.45 * k; }, 'outQuad');
        await this.wait(0.3);
        th.jaw.rotation.x = 0;
      }
      this.sfx('lose', { vol: 0.6 });
      this.commiserate({ amount: ev.bet, at: th.head });
    }
    if (ev.jam) {
      this.sfx('powerDown', { vol: 0.9 });
      fx.sparks(th.head, 12, RED);
      this.parts.jamSign.visible = true;
      for (const b of this.parts.heatBulbs) b.setOn(false);
      this.parts.lamp.setOn(false);
    }
    // 3. follow-through: hold the reveal, then the cups come down and the booth is ready again
    await this.wait(pc.fast ? 0.05 : 1.2);
    if (!this.disposed) this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── small presentation helpers ─────────────────────────────────────────────────────────────────
  /** The cup standing in `slot`. */
  private cupAt(slot: number): THREE.Group {
    return this.parts.cups[this.st.perm[slot]];
  }

  private liftAll(h: number): void {
    for (let slot = 0; slot < CUPS; slot++) this.cupAt(slot).position.y = FELT_Y + h;
  }

  private placePearl(slot: number): void {
    if (slot < 0) { this.parts.pearl.visible = false; return; }
    this.parts.pearl.position.set(SLOT_X[slot], FELT_Y + 0.008, CUP_Z);
  }

  /** Pearl at the reveal: under its cup, or in the automaton's left palm when palmed. */
  private placeReveal(pearl: number, palmed: boolean): void {
    if (palmed || pearl < 0) {
      const v = new THREE.Vector3();
      this.parts.thimble.armL.hand.getWorldPosition(v);
      this.root.worldToLocal(v);
      this.parts.pearl.position.copy(v);
      this.parts.pearl.visible = palmed;
      return;
    }
    this.placePearl(pearl);
  }

  /** Put every visual in the resting pose of `this.st`. Idempotent. `arms = false` keeps the hands where they are. */
  private refresh(arms = true): void {
    const s = this.st, th = this.parts.thimble;
    for (let slot = 0; slot < CUPS; slot++) this.cupAt(slot).position.set(SLOT_X[slot], FELT_Y, CUP_Z);
    this.parts.pearl.visible = false;
    if (arms) {
      aimArm(th.armL, SHOULDER_L, REST_L);
      aimArm(th.armR, SHOULDER_R, REST_R);
    }
    th.jaw.rotation.x = 0;
    th.sleeveGlint.visible = false;
    th.armL.finger.rotation.z = 0;
    this.parts.jamSign.visible = s.jammed;
    this.parts.heatBulbs.forEach((b, i) => { b.setOn(!s.jammed && i < s.streak); b.setColor(AMBER); });
    this.parts.leds.credit.setOn(true);
    this.parts.leds.bet.setOn(!s.open && !s.jammed);
    this.parts.leds.win.setOn(s.lastRes === 'win' || s.lastRes === 'cheat');
    this.parts.lamp.setOn(this.occupant !== null || s.open);
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.shellgame.tip1' },
      { k: 'm.shellgame.tip2', v: { insert: this.k('primary'), cups: `${this.k('n1')}/${this.k('n2')}/${this.k('n3')}` } },
      { k: 'm.shellgame.tip3', v: { cheat: this.k('n4'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return [
      { k: 'm.shellgame.rule1' }, { k: 'm.shellgame.rule2' }, { k: 'm.shellgame.rule3', v: { n: this.st.cheatTo } },
      { k: 'm.shellgame.rule4' }, { k: 'm.shellgame.rule5' },
    ];
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the machine. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.st;
    const live = s.phase === 'pick' || s.phase === 'second';
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.shellgame.goal' });

    // STATE: insert, watch, lift, or out of order
    if (s.jammed) sh.state({ k: 'm.shellgame.stJam' }, 'bad', { k: 'm.shellgame.stJamSub' });
    else if (!this.roundOpen) sh.state({ k: 'm.shellgame.stInsert' }, 'gold', { k: 'm.shellgame.stInsertSub' });
    else if (s.phase === 'show') sh.state({ k: 'm.shellgame.stShow' }, 'cyan', { k: 'm.shellgame.stShowSub' });
    else if (s.phase === 'shuffle') sh.state({ k: 'm.shellgame.stShuffle' }, 'neutral', { k: 'm.shellgame.stShuffleSub' });
    else if (s.phase === 'second') sh.state({ k: 'm.shellgame.stSecond' }, 'warn', { k: 'm.shellgame.stSecondSub' });
    else if (s.phase === 'pick') sh.state({ k: 'm.shellgame.stPick' }, 'good', { k: 'm.shellgame.stPickSub' });
    else sh.state({ k: 'm.shellgame.stReveal' }, 'neutral', { k: 'm.shellgame.stRevealSub' });

    // KEY NUMBERS: stake, heat (consecutive wins), cheat payout, lift timer, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.shellgame.nStake' }, value: fmtCoins(this.roundOpen ? s.stake : this.bet), tone: 'gold' });
    nums.push({ label: { k: 'm.shellgame.nHeat' }, value: s.jammed ? 'X' : String(s.streak), tone: s.streak >= 3 ? 'warn' : 'neutral' });
    if (s.phase === 'pick') nums.push({ label: { k: 'm.shellgame.nCheat' }, value: `${s.cheatTo}:1`, tone: 'cyan' });
    if (live) nums.push({ label: { k: 'm.shellgame.nTime' }, value: String(Math.max(0, Math.ceil(PICK_S - this.idle))), tone: 'warn' });
    nums.push({ label: { k: 'm.shellgame.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys the machine really reads
    if (!this.busy && !this.roundOpen && !s.jammed) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.shellgame.cInsert' }, action: 'primary', primary: true });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.shellgame.cBet' }, action: 'betUp' });
    }
    if (!this.busy && live) {
      ctrl.push({ key: `${this.k('n1')}/${this.k('n2')}/${this.k('n3')}`, label: { k: 'm.shellgame.cLift' }, action: 'n1', primary: true });
      if (s.phase === 'pick') ctrl.push({ key: this.k('n4'), label: { k: 'm.shellgame.cCheat' }, action: 'n4' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.shellgame.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.shellgame.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  /** The swap list is the owner's secret while a round is open: only the owner (or a local save) receives it. */
  getSnapshot(forPid?: number): Snap {
    const own = forPid === undefined || forPid === this.occupant;
    const sec = own && this.sec ? { swaps: this.sec.swaps.map((p) => [p[0], p[1]] as [number, number]), palmAt: this.sec.palmAt, pearl: this.sec.pearl } : null;
    return { s: { ...this.st, perm: [...this.st.perm], picks: [...this.st.picks] }, sec };
  }

  applySnapshot(snap: Snap): void {
    this.st = { ...snap.s, perm: [...snap.s.perm], picks: [...snap.s.picks] };
    this.sec = snap.sec && this.st.open ? snap.sec : null;
    this.refresh();
  }
}
