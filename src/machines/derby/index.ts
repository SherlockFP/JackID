/**
 * Night Derby "The Rat Run" (`derby`) — six racehorses on a floodlit track, shared TableBase device, 8 rail spots, unlimited
 * bettors (MACHINES_tables §13). Bets: Win (1st), Place (1st or 2nd), Show (1st to 3rd), Exacta, Quinella.
 *
 * Host timeline (every peer presents): ODDS (tote flips, 1.5 s) → OPEN (solo: until Ready; shared: 20 s, early on all-Ready)
 * → LOCK (stakes charged, the order drawn and paid at once, so leaving mid-race never loses money) → GATES → RACE (14.0 s)
 * → [PHOTO] → RESULT → PAYOUT → RESET → ODDS. Shared cadence ≈ 46 s.
 *
 * Juice: anticipation (odds board flips, gate bell, leader lamp) → action (horses gallop in their lanes, hoof beats, the crowd
 * swells and the pennants flap, overtakes spark) → impact (photo flash, finish shake, a cheer) → follow-through (board result,
 * pop text, tier celebration, loss and near-miss beats).
 *
 * Controls (keymap §11.6): 1–6 pick a horse (a second pick for Exacta / Quinella) · 7 Win · 8 Place · 9 Show (press again for
 * Exacta, then Quinella) · LMB on the console (horse numbers, bet types; a bet type with its picks placed at once) · Enter place
 * the slip, or Ready when the slip is empty · Z/X stake · Backspace clear.
 */
import type { PanelButton } from '@/kit/types';
import type { KitX } from '@/kit/index';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { PlayerId } from '@/core/types';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, GATE_DOWN_Y, GATE_UP_Y, HORSE_Y, RUNNERS, SILKS, horseX, type DerbyParts } from './model';
import {
  BET_MAX, BET_MIN, BET_TYPES, HOOK_ALBINO, HOOK_DEAD_HEAT, HOOK_EXACTA_INS, HOOK_LONGSHOT, HOOK_ODDS, KEYFRAMES, KEY_DT,
  MAX_BETS_PER_SEAT, PICKS_NEEDED, exactaIndex, quinellaIndex, field, hookRunnerWeight, oddsFor, playHeadless, runRace, validBet,
  weighted,
  type Bet, type BetType, type Mods, type Odds,
} from './rules';
const RULE_LINES: Txt[] = ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.derby.' + k }));
import { STRINGS } from './derby.strings';

export { playHeadless };

// ── timing (seconds, ×1 speed) ───────────────────────────────────────────────────────────────────
const ODDS_S = 1.5;         // tote flips
const OPEN_S = 20;          // shared betting window
const LOCK_S = 0.6;         // bell
const GATE_S = 0.8;         // gate drops
const RACE_S = 14.0;        // keyframed race
const PHOTO_S = 1.8;        // photo finish: the camera flashes, the board holds the two noses
const RESULT_S = 2.0;       // tote shows 1-2-3
const PAYOUT_S = 2.5;       // count-up window
const RESET_S = 3.0;        // horses walked back
const SEATS = 8;
const GOLD = 0xffd040, GREEN = 0x7dff7a;
const NUM_ACTIONS = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9'] as const;

// ── contract types (aliases so they are assignable to `Json`) ──────────────────────────────────
type Show = 'idle' | 'odds' | 'open' | 'lock' | 'race' | 'photo' | 'result' | 'payout' | 'reset';
type ToteMode = 'last' | 'flip' | 'odds' | 'result' | 'photo';
type Ev =
  | { k: 'odds'; raceNo: number; win: number[]; place: number[]; show: number[]; exacta: number[]; quinella: number[] }
  | { k: 'phase'; p: 'odds' | 'open' | 'lock' }
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'race'; raceNo: number; frames: number[][]; order: number[]; photo: boolean }
  | { k: 'result'; raceNo: number; order: number[]; rerolled: boolean; seats: Array<{ seat: number; stake: number; gross: number; nearmiss: boolean }> }
  | { k: 'peek'; last: number };
type Act = { k: 'bet'; t: BetType; p: number[]; a: number } | { k: 'clear' } | { k: 'ready' };
/** What every peer knows (public tote and rail state). Mutated only in `present`. */
type State = { phase: Show; raceNo: number; odds: Odds; bets: Bet[][]; ready: boolean[]; history: number[] };
type Snap = State;
type Slip = { t: BetType; p: number[] };

const emptyBets = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyReady = (): boolean[] => new Array<boolean>(SEATS).fill(false);
const emptyOdds = (): Odds => ({ win: [], place: [], show: [], exacta: [], quinella: [] });
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export default class Derby extends TableBase<DerbyParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', raceNo: 0, odds: emptyOdds(), bets: emptyBets(), ready: emptyReady(), history: [] };
  /** HOST-ONLY authority: strengths and odds of the open race, bets not yet charged, ready flags, the round timer. */
  private hs: { phase: 'idle' | 'odds' | 'open' | 'run'; raceNo: number; strengths: number[]; odds: Odds; bets: Bet[][]; ready: boolean[]; timer: number } = {
    phase: 'idle', raceNo: 0, strengths: [], odds: emptyOdds(), bets: emptyBets(), ready: emptyReady(), timer: 0,
  };
  /** Local only: the bet slip being built (picks and type). */
  private slip: Slip = { t: 'win', p: [] };
  /** Tote view state (local): what the board shows and the scramble frame while odds flip. */
  private view: { mode: ToteMode; scramble: number } = { mode: 'last', scramble: 0 };
  private attractIdx = -1;
  /** Seat HUD overlay (goal, state, key numbers, controls, result callout, tip and rules cards). */
  private seatHud?: SeatHud;
  private hudSig = '';

  protected createModel(kit: KitX): MachineModel<DerbyParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.parts.gate.position.y = GATE_UP_Y;
    this.paintAll();
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  /** Number of runners in the printed field (six, seven once The Albino is in). */
  private runners(): number { return this.st.odds.win.length || 6; }

  // ── local input → slip / action to the host ───────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(RULE_LINES); return; }
    const isBet = a === 'betUp' || a === 'betDown' || a === 'betMax';
    if (e.repeat && !isBet) return;
    const digit = NUM_ACTIONS.indexOf(a as (typeof NUM_ACTIONS)[number]);
    if (digit >= 0) {
      if (digit < 6) this.pickHorse(digit);
      else if (digit === 6) this.setType('win');
      else if (digit === 7) this.setType('place');
      else this.setType(this.nextExotic());
      return;
    }
    switch (a) {
      case 'betUp': case 'betDown': case 'betMax':
        if (this.st.phase === 'lock' || this.st.phase === 'race' || this.st.phase === 'photo') break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': this.confirm(); break;                                       // Enter
      case 'clear': if (this.canBet()) this.act({ k: 'clear' }); break;            // Backspace
      default: break;
    }
  }

  /** LMB on the console: a horse number picks it, a bet type places its slip when the picks are complete. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type !== 'down' || this.localSeat < 0) return;
    const hit = this.pick([this.parts.panel.caps]);
    if (!hit) return;
    const btn: PanelButton | null = this.parts.panel.pick(hit);
    if (!btn) return;
    void btn.press(0.12);
    this.sfx('button', { vol: 0.6 });
    if (btn.id.startsWith('horse')) { this.pickHorse(Number(btn.id.slice(5)) - 1); return; }
    if ((BET_TYPES as readonly string[]).includes(btn.id)) {
      this.setType(btn.id as BetType);
      if (this.slip.p.length === PICKS_NEEDED[this.slip.t]) this.placeSlip();
    }
  }

  private canBet(): boolean { return this.localSeat >= 0 && this.st.phase === 'open' && !this.st.ready[this.localSeat]; }
  private myBets(): Bet[] { return this.st.bets[this.localSeat] ?? []; }

  /** Key 9: Show first, then each press steps on to Exacta, Quinella and back to Show. */
  private nextExotic(): BetType {
    const t = this.slip.t;
    return t === 'show' ? 'exacta' : t === 'exacta' ? 'quinella' : 'show';
  }

  private pickHorse(i: number): void {
    if (this.localSeat < 0 || i < 0 || i >= this.runners()) return;
    const need = PICKS_NEEDED[this.slip.t];
    if (need === 1) this.slip.p = [i];
    else if (this.slip.p.length === 1 && this.slip.p[0] !== i) this.slip.p = [this.slip.p[0], i];
    else this.slip.p = [i];
    this.sfx('click');
    this.showHud();
  }

  private setType(t: BetType): void {
    if (this.localSeat < 0) return;
    this.slip.t = t;
    this.slip.p = this.slip.p.slice(0, PICKS_NEEDED[t]);
    this.sfx('click');
    this.showHud();
  }

  /** Space: place the slip if its picks are complete, otherwise Ready (the bets already on the rail stand). */
  private confirm(): void {
    if (this.localSeat < 0 || this.st.phase !== 'open') return;
    if (this.slip.p.length === PICKS_NEEDED[this.slip.t]) { this.placeSlip(); return; }
    if (this.myBets().length && !this.st.ready[this.localSeat]) { this.act({ k: 'ready' }); return; }
    this.toast(tr(PICKS_NEEDED[this.slip.t] === 1 ? 'm.derby.badPick' : 'm.derby.pickTwo'), 'warn');
  }

  private placeSlip(): void {
    if (this.st.phase !== 'open') { this.toast(tr('m.derby.busy'), 'warn'); return; }
    if (!this.canBet()) return;
    this.act({ k: 'bet', t: this.slip.t, p: [...this.slip.p], a: this.bet });
    this.slip.p = [];
    this.sfx('chip');
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'bet') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.derby.busy'); return; }
      const bets = hs.bets[seat];
      const total = bets.reduce((s, b) => s + b.a, 0);
      const bet: Bet = { t: a.t, p: a.p.slice(), a: a.a };
      const bad = validBet(bet, hs.strengths.length, total);
      if (bad) { this.nak(pid, rid, `m.derby.${bad}`); return; }
      if (bets.length >= MAX_BETS_PER_SEAT) { this.nak(pid, rid, 'm.derby.tooMany'); return; }
      hs.bets[seat] = [...bets, bet];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: hs.bets[seat] });
    } else if (a.k === 'clear') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.derby.busy'); return; }
      hs.bets[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    } else if (a.k === 'ready') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.derby.busy'); return; }
      if (!hs.bets[seat].length) { this.nak(pid, rid, 'm.derby.noBets'); return; }
      hs.ready[seat] = true;
      void this.emit({ k: 'ready', seat, on: true });
      const bettors = this.humans().filter((h) => hs.bets[h.seat].length > 0);
      if (bettors.every((h) => hs.ready[h.seat])) this.lock();
    }
  }
  private unready(seat: number): void {
    if (!this.hs.ready[seat]) return;
    this.hs.ready[seat] = false;
    void this.emit({ k: 'ready', seat, on: false });
  }

  /** Host timeline. */
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans().length;
    if (hs.phase === 'idle') {
      if (humans > 0) this.beginOdds();
      return;
    }
    if (humans === 0 && hs.phase !== 'run') {
      this.cancelCountdown();
      this.hs = { phase: 'idle', raceNo: hs.raceNo, strengths: [], odds: emptyOdds(), bets: emptyBets(), ready: emptyReady(), timer: 0 };
      return;
    }
    hs.timer -= dt;
    if (hs.phase === 'odds') {
      if (hs.timer <= 0) this.openBetting();
    } else if (hs.phase === 'open') {
      if (humans >= 2 && hs.timer <= 0) this.lock();           // shared: the window ends; the race runs even with no bets
    } else if (hs.timer <= 0) {
      this.beginOdds();                                        // run finished: next race
    }
  }

  /** Host: draws the field for the next race, prints the odds (fixed until LOCK) and starts the flip. */
  private beginOdds(): void {
    const hs = this.hs;
    hs.raceNo++;
    const solo = this.humans().length === 1;
    let s = field(this.hostRng, this.mod(HOOK_ALBINO, 0) > 0);
    if (solo) s = weighted(s, (lane) => this.mod(hookRunnerWeight(lane), 0));   // runnerWeight: solo draws only
    hs.strengths = s;
    hs.odds = oddsFor(s);
    hs.phase = 'odds';
    hs.timer = ODDS_S;
    hs.bets = emptyBets();
    hs.ready = emptyReady();
    void this.emit({ k: 'odds', raceNo: hs.raceNo, win: hs.odds.win, place: hs.odds.place, show: hs.odds.show, exacta: hs.odds.exacta, quinella: hs.odds.quinella });
    void this.emit({ k: 'phase', p: 'odds' });
  }

  /** Host: betting window opens (solo: no timer; shared: 20 s). */
  private openBetting(): void {
    const hs = this.hs;
    hs.phase = 'open';
    hs.timer = OPEN_S;
    if (this.humans().length >= 2) void this.countdown(OPEN_S, 'bet');
    void this.emit({ k: 'phase', p: 'open' });
  }

  /** Charm modifiers from the table's hooks (`m.derby.*`); base values are neutral. */
  private mods(): Mods {
    return {
      deadHeat: this.mod(HOOK_DEAD_HEAT, 0) > 0,
      longshot: this.mod(HOOK_LONGSHOT, 0),
      exactaInsurance: this.mod(HOOK_EXACTA_INS, 0) > 0,
      oddsBonus: this.mod(HOOK_ODDS, 0),
    };
  }

  /** Host: LOCK → charge, draw, pay, then announce the whole race to every peer. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    const active: Array<{ seat: number; bets: Bet[]; stake: number }> = [];
    for (let s = 0; s < SEATS; s++) {
      const bets = hs.bets[s];
      if (!bets.length) continue;
      const stake = bets.reduce((acc, b) => acc + b.a, 0);
      const pid = this.seats[s];
      if (pid === null || !this.chargeSeat(s, stake)) {
        if (pid !== null) this.nak(pid, 0, 'm.derby.noFunds');
        hs.bets[s] = [];
        this.unready(s);
        void this.emit({ k: 'lay', seat: s, bets: [] });
        continue;
      }
      active.push({ seat: s, bets, stake });
    }

    const solo = this.humans().length === 1;
    const out = runRace(this.hostRng, hs.strengths, active.map((a) => a.bets), hs.odds, this.mods(), this.luck(), solo);
    active.forEach((a, i) => { this.paySeat(a.seat, out.seats[i].gross, { bet: a.stake }); });

    // table charm: the last-place horse is whispered to every bettor before the gates open
    if (this.tableMod('peekCharges', 0) > 0) {
      const last = out.order[out.order.length - 1];
      for (const a of active) {
        const pid = this.seats[a.seat];
        if (pid !== null) void this.emitPrivate(pid, { k: 'peek', last });
      }
    }

    hs.phase = 'run';
    hs.timer = LOCK_S + GATE_S + RACE_S + (out.photo ? PHOTO_S : 0) + RESULT_S + PAYOUT_S + RESET_S;
    hs.bets = emptyBets();
    hs.ready = emptyReady();
    void this.emit({ k: 'phase', p: 'lock' });
    void this.emit({ k: 'race', raceNo: hs.raceNo, frames: out.frames, order: out.order, photo: out.photo });
    void this.emit({
      k: 'result', raceNo: hs.raceNo, order: out.order, rerolled: out.rerolled,
      seats: active.map((a, i) => ({ seat: a.seat, stake: a.stake, gross: out.seats[i].gross, nearmiss: out.seats[i].nearmiss })),
    });
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'odds': {
        this.st.raceNo = ev.raceNo;
        this.st.odds = { win: ev.win, place: ev.place, show: ev.show, exacta: ev.exacta, quinella: ev.quinella };
        this.applyRunners();
        await this.flipTote(pc.fast);
        this.setTote('odds');
        if (this.isLocalOccupant) this.showHud();
        return;
      }
      case 'phase': await this.onPhase(ev.p, pc); return;
      case 'lay':
        this.st.bets[ev.seat] = ev.bets;
        this.paintLamps();
        if (ev.bets.length) this.sfx('chip');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'ready':
        this.st.ready[ev.seat] = ev.on;
        if (ev.on) { this.parts.seatLamps[ev.seat].blink(4, 0.6); this.sfx('click'); }
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'race': await this.raceShow(ev, pc); return;
      case 'result': await this.resultShow(ev, pc); return;
      case 'peek':
        this.toast(tr('m.derby.peekLast', { horse: this.horseName(ev.last) }), 'sys');
        return;
    }
  }

  private async onPhase(p: 'odds' | 'open' | 'lock', pc: PresentCtx): Promise<void> {
    const s = this.st;
    if (p === 'open') {
      s.phase = 'open';
      this.paintLamps();
      if (this.isLocalOccupant) this.showHud();
      return;
    }
    if (p === 'odds') {
      s.phase = 'odds';
      s.bets = emptyBets();
      s.ready = emptyReady();
      this.paintLamps();
      if (this.isLocalOccupant) this.showHud();
      return;
    }
    // LOCK: anticipation — the bell swings, the horses are loaded, then the starting gate drops.
    s.phase = 'lock';
    this.sfx('bell');
    this.parts.laneLamps.forEach((l) => l.setOn(false));
    this.parts.horses.forEach((r, i) => { if (i < this.runners()) r.position.x = horseX(0); });
    if (pc.fast) {
      this.parts.gate.position.y = GATE_DOWN_Y;
      this.parts.gateBell.rotation.z = 0;
    } else {
      const bell = this.parts.gateBell;
      void this.anim(LOCK_S, (k) => { bell.rotation.z = Math.sin(k * Math.PI * 6) * 0.6 * (1 - k); }, 'outQuad');
      this.sfx('ratchet', { vol: 0.6 });
      this.sfx('cheer', { param: 0.1, vol: 0.3 });                              // the stand rises as the gate loads
      await this.wait(LOCK_S * 0.5);
      const gate = this.parts.gate;
      await this.anim(GATE_S, (k) => { gate.position.y = GATE_UP_Y + (GATE_DOWN_Y - GATE_UP_Y) * k; }, 'outQuad');
    }
    this.paintLamps();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Action: the horses gallop their keyframed lanes; the leader lamp follows the front runner; the crowd swells; overtakes spark. */
  private async raceShow(ev: Extract<Ev, { k: 'race' }>, pc: PresentCtx): Promise<void> {
    const P = this.parts;
    this.st.phase = 'race';
    const frames = ev.frames;
    const n = ev.order.length;
    const last = frames[KEYFRAMES - 1];
    const setAt = (i: number, x: number): void => { P.horses[i].position.x = horseX(x); };
    /** Progress of horse `i` at time `t` (s): 0 at the gate, keyframes every 0.5 s, linear between. */
    const progress = (t: number, i: number): number => {
      const pos = t / KEY_DT - 1;
      if (pos <= 0) return frames[0][i] * (t / KEY_DT);
      const k = Math.min(KEYFRAMES - 1, Math.floor(pos));
      const frac = Math.min(1, pos - k);
      const next = Math.min(KEYFRAMES - 1, k + 1);
      return frames[k][i] + (frames[next][i] - frames[k][i]) * frac;
    };

    if (pc.fast) {
      for (let i = 0; i < n; i++) setAt(i, last[i]);
    } else {
      this.sfx('ratchet', { vol: 0.5 });
      this.sfx('cheer', { param: 0.25, vol: 0.45 });                        // the off: the stand roars
      P.bulbs.pattern('chase', 6);
      let lead = -1, beat = 0, swell = 0;
      await this.anim(RACE_S, (k) => {
        const t = k * RACE_S;
        let best = 0, bestX = -1;
        for (let i = 0; i < n; i++) {
          const x = progress(t, i);
          setAt(i, x);
          // gallop: front and hind legs swing in opposite phase, the body bobs, the tail swishes
          const ph = t * 17 + i * 1.7;
          P.gallop[i][0].rotation.z = Math.sin(ph) * 0.7;
          P.gallop[i][1].rotation.z = -Math.sin(ph) * 0.7;
          P.horses[i].position.y = HORSE_Y + Math.abs(Math.sin(ph)) * 0.008;
          P.tails[i].rotation.z = Math.sin(ph * 0.5) * 0.25;
          if (x > bestX) { bestX = x; best = i; }
        }
        if (t >= beat) { beat = t + 0.34; this.sfx('thud', { vol: 0.12, pitch: 8 }); }   // hoof beats under the race
        // the crowd swells with the leader: a rising roar at the turn and again at the line
        if (swell === 0 && bestX > 0.55) { swell = 1; this.sfx('cheer', { param: 0.45, vol: 0.55 }); }
        if (swell === 1 && bestX > 0.88) { swell = 2; this.sfx('cheer', { param: 0.7, vol: 0.75 }); }
        const lift = swell === 0 ? 0.15 : swell === 1 ? 0.45 : 0.9;
        P.pennants.forEach((pv, c) => { pv.rotation.z = Math.sin(t * 9 + c) * 0.25 * lift; pv.position.y = 1.5 + Math.abs(Math.sin(t * 7 + c * 2)) * 0.03 * lift; });
        if (lead >= 0 && best !== lead && t > 1) {
          this.sfx('click', { vol: 0.35 });                                 // a new leader
          this.ctx.fx.sparks(P.horses[best], 6, SILKS[best]);
        }
        if (best !== lead) {
          lead = best;
          P.laneLamps.forEach((l, i) => l.setOn(i === best && i < n));
        }
      });
      // trailing horses reach the line in the follow-through beat
      const from = last.slice(0, n);
      await this.anim(0.6, (k) => { for (let i = 0; i < n; i++) setAt(i, from[i] + (1 - from[i]) * k); }, 'outQuad');
      P.bulbs.pattern('all');
    }

    // impact: the finish shakes the glass, the legs settle
    P.laneLamps.forEach((l) => l.setOn(false));
    P.gallop.forEach((g) => g.forEach((l) => { l.rotation.z = 0; }));
    P.horses.forEach((h) => { h.position.y = HORSE_Y; });
    this.sfx('bell');
    this.ctx.fx.shake(0.01, 0.25, { roll: 0.3 });
    this.ctx.fx.sparks(P.finishLine, 10, GOLD);

    if (ev.photo) {
      this.st.phase = 'photo';
      this.sfx('click', { vol: 0.9 });
      this.ctx.fx.flash(0xffffff, 0.7, 0.12);
      this.view.scramble = 0;
      P.photoLamp.blink(8, 0.9);                                              // the camera flashes at the line
      this.setTote('photo', ev.order);
      if (!pc.fast) {
        await this.wait(PHOTO_S * 0.5);
        this.sfx('click', { vol: 0.7 });
        this.ctx.fx.flash(0xffffff, 0.5, 0.1);                                 // second frame
        this.view.scramble = 1;
        this.paintTote();
        await this.wait(PHOTO_S * 0.5);
      }
    }
    this.st.history = [ev.order[0], ...this.st.history].slice(0, 10);
  }

  /** Follow-through: board 1-2-3, pop text, tier celebration, loss and near-miss beats; the horses walk back to the gate. */
  private async resultShow(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    this.st.phase = 'result';
    const P = this.parts;
    this.setTote('result', ev.order);
    P.laneLamps[ev.order[0]]?.blink(6, 3);
    if (!pc.fast) this.sfx('cheer', { param: 0.35, vol: 0.5 });                  // the stand cheers the winner, whoever backed it
    const winners = [...ev.seats].filter((r) => r.gross > 0).sort((x, y) => y.gross - x.gross);
    const best = winners[0];
    if (best) {
      const tier = juiceTier(best.gross, best.stake);
      void this.celebrate(tier, { amount: best.gross, at: P.finishCam, lamps: [P.seatLamps[best.seat]], fast: pc.fast, restore: () => this.paintLamps() });
    } else {
      this.sfx('lose', { vol: 0.5 });
    }
    const mineRow = ev.seats.find((r) => r.seat === this.localSeat);
    if (mineRow && mineRow.stake > 0) {
      const net = mineRow.gross - mineRow.stake;
      this.seatHud?.result(mineRow.gross <= 0 ? 'lose' : net === 0 ? 'push' : 'win', net, 1.5);
    }
    for (const r of ev.seats) {
      if (r.gross <= 0 && r.stake > 0) {
        if (r.seat === this.localSeat) {
          this.commiserate({ at: P.finishCam });
          if (r.nearmiss) void this.nearMiss({ at: P.finishCam });
        }
        continue;
      }
      if (r.gross > 0) {
        const tile = P.seatLamps[r.seat];
        tile.blink(8, 1.2);
        this.ctx.fx.popText(tile.root, tr('m.derby.win2', { n: fmtCoins(r.gross) }), r.gross > r.stake ? GOLD : GREEN, { dur: 1.2, rise: 0.3 });
        if (r.gross >= 10 * r.stake) this.ctx.fx.popText(tile.root, tr('m.derby.longshot'), GOLD, { dur: 1.4, rise: 0.5 });
      }
    }
    this.ctx.ui.toast(tr('m.derby.sResult', { a: ev.order[0] + 1, b: ev.order[1] + 1, c: ev.order[2] + 1 }), 'sys');
    if (ev.rerolled) {
      this.ctx.fx.glow(P.finishCam, GREEN, 0.4, 0.6);
      this.ctx.ui.toast(tr('m.derby.rerollLuck'), 'sys');
    }
    if (!pc.fast) await this.wait(PAYOUT_S * 0.5);

    // reset: the gate lifts and the horses are walked back to the start
    this.st.phase = 'reset';
    this.st.bets = emptyBets();
    this.st.ready = emptyReady();
    const n = ev.order.length;
    const from = P.horses.map((r) => r.position.x);
    const gate = P.gate;
    if (pc.fast) {
      P.horses.forEach((r, i) => { if (i < n) r.position.x = horseX(0); });
      gate.position.y = GATE_UP_Y;
    } else {
      await this.anim(RESET_S, (k) => {
        P.horses.forEach((r, i) => { if (i < n) r.position.x = from[i] + (horseX(0) - from[i]) * k; });
        P.tails.forEach((tl) => { tl.rotation.z *= 1 - k; });
        P.pennants.forEach((pv) => { pv.rotation.z *= 1 - k; pv.position.y = 1.5; });
        if (k > 0.2) gate.position.y = GATE_DOWN_Y + (GATE_UP_Y - GATE_DOWN_Y) * Math.min(1, (k - 0.2) / 0.5);
      }, 'outQuad');
    }
    this.setTote('last');
    this.paintLamps();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── snapshots: public tote and rail state only ────────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase, raceNo: this.st.raceNo, odds: { ...this.st.odds },
      bets: this.st.bets.map((l) => [...l]), ready: [...this.st.ready], history: [...this.st.history],
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = {
      phase: sn.phase, raceNo: sn.raceNo, odds: { ...sn.odds }, bets: sn.bets.map((l) => [...l]),
      ready: [...sn.ready], history: [...sn.history],
    };
    this.parts.gate.position.y = sn.phase === 'race' || sn.phase === 'photo' || sn.phase === 'result' || sn.phase === 'lock' ? GATE_DOWN_Y : GATE_UP_Y;
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) {
      this.sfx('chime', { vol: 0.5 });
      this.hud(null);
      this.seatHud?.show();
      this.hudSig = '';
      this.showHud();
      this.seatHud?.firstTip('derby', this.tipLines());
    }
  }
  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && this.hs.phase === 'open' && this.hs.bets[seat].length) {
      this.hs.bets[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    }
    if (local) { this.slip.p = []; this.hud(null); this.seatHud?.hide(); }
    this.paintLamps();
  }
  override onLang(): void {
    this.paintTote(); this.paintLamps();
    this.hudSig = '';
    if (this.isLocalOccupant) this.showHud();
  }

  /** Redraws the banner and countdown when something changed (cheap: the signature gates the DOM). */
  frame(_dt: number, _t: number): void {
    if (this.isLocalOccupant) this.showHud();
  }

  /** Idle: lane lamps chase along the rail so the cabinet reads as alive. */
  attract(_dt: number, time: number): void {
    const idx = Math.floor(time * 4) % RUNNERS;
    if (idx === this.attractIdx) return;
    this.attractIdx = idx;
    this.parts.laneLamps.forEach((l, i) => l.setOn(i === idx && i < this.runners()));
  }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private horseName(i: number): string { return tr(`m.derby.horse${i + 1}`); }

  /** The seventh horse, its lane lamp and its console button only exist once The Albino is in the field. */
  private applyRunners(): void {
    const n = this.runners();
    this.parts.horses.forEach((r, i) => { r.visible = i < n; });
    this.parts.laneLamps.forEach((l, i) => { l.root.visible = i < n; });
    this.parts.buttons.horse7?.setEnabled(n >= 7);
  }

  private paintLamps(): void {
    const P = this.parts;
    P.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
    P.railMeters.forEach((m, s) => m.setOn((this.st.bets[s]?.length ?? 0) > 0));
    P.laneLamps.forEach((l) => l.setOn(false));
  }

  private paintAll(): void {
    this.applyRunners();
    this.paintLamps();
    this.setTote('last');
  }

  private setTote(mode: ToteMode, order?: number[]): void {
    this.view.mode = mode;
    if (order) this.toteOrder = order;
    this.paintTote();
  }
  private toteOrder: number[] = [];

  /** Draws the odds board for the current mode. Scrambled digits while the odds flip. */
  private paintTote(): void {
    const mode = this.view.mode;
    const o = this.st.odds;
    const n = this.runners();
    this.parts.tote.draw((g, w) => {
      g.fillStyle = '#080c08';
      g.fillRect(0, 0, w.w, w.h);
      if (mode === 'odds' || mode === 'flip') {
        // header: race number, then the three columns the player bets on
        w.text(`${tr('m.derby.toteOdds')} ${this.st.raceNo || ''}`, 4, 1, { font: 'px5', color: '#ffd040' });
        w.text(tr('m.derby.tWin'), 70, 1, { font: 'px5', color: '#ffd040' });
        w.text(tr('m.derby.tPlace'), 108, 1, { font: 'px5', color: '#ffd040' });
        w.text(tr('m.derby.tShow'), 146, 1, { font: 'px5', color: '#ffd040' });
        let fav = -1;                                                       // shortest win price = the favourite
        for (let i = 0; i < n; i++) if (o.win[i] !== undefined && (fav < 0 || o.win[i] < o.win[fav])) fav = i;
        for (let i = 0; i < n; i++) {
          const y = 9 + i * 7.8;
          g.fillStyle = hex(SILKS[i]);
          g.fillRect(4, y, 7, 6);                                           // silks swatch
          w.text(String(i + 1), 14, y, { font: 'px5', color: '#ffffff' });
          if (mode === 'odds' && i === fav) w.text(tr('m.derby.tFav'), 24, y, { font: 'px5', color: '#7dff7a' });
          const fw = (v: number | undefined, c: number): string => (mode === 'flip' || v === undefined
            ? `${(this.view.scramble * 7 + i * 3 + c) % 10}${(this.view.scramble * 3 + i + c) % 10}.${(this.view.scramble + i * 5 + c) % 10}`
            : v.toFixed(1));
          w.text(fw(o.win[i], 0), 66, y, { font: 'px5', color: '#ffffff' });
          w.text(fw(o.place[i], 3), 104, y, { font: 'px5', color: '#e8e0c8' });
          w.text(fw(o.show[i], 6), 142, y, { font: 'px5', color: '#e8e0c8' });
        }
      } else if (mode === 'result') {
        w.text(tr('m.derby.tResult'), 4, 1, { font: 'px5', color: '#ffd040' });
        this.toteOrder.slice(0, 3).forEach((horse, j) => {
          const x = 14 + j * 60;
          g.fillStyle = hex(SILKS[horse]);
          g.fillRect(x, 16, 44, 36);
          w.text(String(horse + 1), x + 22, 22, { font: 'px5', color: '#080c08', align: 'center' });
          w.text(tr(j === 0 ? 'm.derby.tWin' : j === 1 ? 'm.derby.tPlace' : 'm.derby.tShow'), x + 22, 40, { font: 'px5', color: '#080c08', align: 'center' });
        });
      } else if (mode === 'photo') {
        // photo finish: the two noses on a bright plate, the frame flickers on the second flash
        const flick = this.view.scramble === 1;
        g.fillStyle = flick ? '#080c08' : '#f2f2ea';
        g.fillRect(0, 0, w.w, w.h);
        const ink = flick ? '#f2f2ea' : '#080c08';
        w.text(tr('m.derby.tPhoto'), w.w / 2, 6, { font: 'px5', color: ink, align: 'center' });
        const a = this.toteOrder[0], b = this.toteOrder[1];
        if (a !== undefined && b !== undefined) {
          g.fillStyle = hex(SILKS[a]); g.fillRect(52, 24, 30, 26);
          g.fillStyle = hex(SILKS[b]); g.fillRect(110, 24, 30, 26);
          w.text(String(a + 1), 67, 32, { font: 'px5', color: '#080c08', align: 'center' });
          w.text(String(b + 1), 125, 32, { font: 'px5', color: '#080c08', align: 'center' });
          w.text('?', 96, 32, { font: 'px5', color: ink, align: 'center' });
        }
      } else {
        w.text(tr('m.derby.toteLast'), 4, 1, { font: 'px5', color: '#ffd040' });
        this.st.history.forEach((horse, j) => {
          const x = 6 + (j % 5) * 37, y = 12 + Math.floor(j / 5) * 26;
          g.fillStyle = hex(SILKS[horse]);
          g.fillRect(x, y, 31, 22);
          w.text(String(horse + 1), x + 15, y + 7, { font: 'px5', color: '#080c08', align: 'center' });
        });
      }
    });
  }

  /** Anticipation: the tote digits scramble, then settle on the new odds. */
  private async flipTote(fast: boolean): Promise<void> {
    if (fast) return;
    this.view.mode = 'flip';
    this.sfx('reelTick', { vol: 0.5 });
    await this.anim(ODDS_S * 0.7, (k) => {
      this.view.scramble = Math.floor(k * 12);
      this.paintTote();
    });
  }

  private hudSlipOdds(): number | null {
    const need = PICKS_NEEDED[this.slip.t];
    if (this.slip.p.length !== need) return null;
    const o = this.st.odds;
    if (!o.win.length) return null;
    if (this.slip.t === 'win') return o.win[this.slip.p[0]] ?? null;
    if (this.slip.t === 'place') return o.place[this.slip.p[0]] ?? null;
    if (this.slip.t === 'show') return o.show[this.slip.p[0]] ?? null;
    const n = o.win.length;
    const [a, b] = this.slip.p;
    if (this.slip.t === 'exacta') return o.exacta[exactaIndex(n, a, b)] ?? null;
    return o.quinella[quinellaIndex(n, a, b)] ?? null;
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  private tipLines(): Txt[] {
    return [
      { k: 'm.derby.tip1', v: { pick: `${this.k('n1')}-${this.k('n6')}`, win: this.k('n7'), place: this.k('n8'), show: this.k('n9') } },
      { k: 'm.derby.tip2', v: { go: this.k('confirm') } },
      { k: 'm.derby.tip3', v: { help: this.k('help') } },
    ];
  }

  /** Banner, key numbers and valid controls for the local player. Redraws only when something changed. */
  private showHud(): void {
    const sh = this.seatHud;
    const seat = this.localSeat;
    if (!sh || seat < 0) return;
    const ph = this.st.phase, open = ph === 'open';
    const bets = this.myBets();
    const total = bets.reduce((s, b) => s + b.a, 0);
    const ready = this.st.ready[seat] === true;
    const need = PICKS_NEEDED[this.slip.t];
    const complete = this.slip.p.length === need;
    const odds = this.hudSlipOdds();
    const left = this.timerState && open ? Math.ceil(this.timerLeft) : 0;
    const wallet = this.ctx.run.wallet();
    const last = this.st.history[0];
    const sig = [ph, seat, ready, total, bets.length, this.bet, this.slip.t, this.slip.p.join(','), odds ?? '-', left,
      last ?? -1, wallet, this.st.raceNo].join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    sh.goal({ k: 'm.derby.goal' });

    // STATE: betting window, race, photo, result
    const secs: Txt | undefined = left > 0 ? { k: 'm.derby.stSecs', v: { n: left } } : undefined;
    if (ph === 'idle') sh.state({ k: 'm.derby.stWait' }, 'neutral');
    else if (ph === 'odds') sh.state({ k: 'm.derby.stOdds' }, 'neutral');
    else if (open && ready) sh.state({ k: 'm.derby.stReady' }, 'good', secs);
    else if (open) sh.state({ k: 'm.derby.stBet' }, 'gold', secs);
    else if (ph === 'lock') sh.state({ k: 'm.derby.stLock' }, 'warn');
    else if (ph === 'race') sh.state({ k: 'm.derby.stRace' }, 'cyan');
    else if (ph === 'photo') sh.state({ k: 'm.derby.stPhoto' }, 'cyan');
    else if (ph === 'result') sh.state({ k: 'm.derby.stResult' }, 'neutral', last === undefined ? undefined : { k: 'm.derby.stLast', v: { n: last + 1 } });
    else if (ph === 'payout') sh.state({ k: 'm.derby.stPay' }, 'neutral');
    else sh.state({ k: 'm.derby.stReset' }, 'neutral');

    // KEY NUMBERS: the slip being built (type, picks, odds), your bets, the chip, the last winner, balance
    const slipPicks = this.slip.p.map((p) => p + 1).join('-') || '?';
    const slipText = `${tr(`m.derby.${this.slip.t}`)} ${slipPicks}${odds !== null ? ` x${odds.toFixed(1)}` : ''}`;
    const pick0 = this.slip.p[0];
    const o = this.st.odds;
    const pickOdds = pick0 !== undefined && o.win[pick0] !== undefined
      ? `${o.win[pick0].toFixed(1)} / ${o.place[pick0].toFixed(1)} / ${o.show[pick0].toFixed(1)}` : null;
    const nums: HudNumber[] = [
      { label: { k: 'm.derby.nSlip' }, value: slipText, tone: complete ? 'good' : 'gold' },
      ...(pickOdds !== null && pick0 !== undefined ? [{ label: { k: 'm.derby.nOdds', v: { n: pick0 + 1 } }, value: pickOdds, tone: 'neutral' as const }] : []),
      { label: { k: 'm.derby.nBets' }, value: fmtCoins(total), tone: total > 0 ? 'gold' : 'neutral' },
      { label: { k: 'm.derby.nChip' }, value: fmtCoins(this.bet), tone: 'cyan' },
    ];
    if (last !== undefined) nums.push({ label: { k: 'm.derby.nLast' }, value: `#${last + 1}`, tone: 'neutral' });
    nums.push({ label: { k: 'm.derby.nBalance' }, value: fmtCoins(wallet), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now
    const ctrl: HudControl[] = [];
    if (open && !ready) {
      if (complete) ctrl.push({ key: this.k('confirm'), label: { k: 'm.derby.cPlace' }, action: 'confirm', primary: true });
      else if (bets.length > 0) ctrl.push({ key: this.k('confirm'), label: { k: 'm.derby.cReady' }, action: 'confirm', primary: true });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n6')}`, label: { k: 'm.derby.cHorse' }, action: 'n1' });
      ctrl.push({ key: this.k('n7'), label: { k: 'm.derby.cWin' }, action: 'n7' });
      ctrl.push({ key: this.k('n8'), label: { k: 'm.derby.cPlaceType' }, action: 'n8' });
      const nx = this.nextExotic();
      ctrl.push({ key: this.k('n9'), label: { k: nx === 'show' ? 'm.derby.cShowType' : nx === 'exacta' ? 'm.derby.cExacta' : 'm.derby.cQuinella' }, action: 'n9' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.derby.cChip' }, action: 'betUp' });
      if (bets.length > 0) ctrl.push({ key: this.k('clear'), label: { k: 'm.derby.cClear' }, action: 'clear' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.derby.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.derby.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }
}

export const def: MachineDef = {
  id: 'derby',
  category: 'oddity',
  slotSize: 'XL',
  zone: 'midway',
  seats: SEATS,
  shared: true,
  tier: 2,
  minBet: BET_MIN, maxBet: BET_MAX, betSteps: [1, 5, 10, 25, 50, 100, 200],
  maxPayoutMult: 250,
  rtp: 0.9,
  actionCost: 1,
  idleYield: 0.48,
  tags: ['table', 'race', 'social', 'curio'],
  headless: playHeadless,
  modHooks: {
    'm.derby.runnerWeight.n': 'float added to lane n (1–7) strength, solo races only; the printed odds follow it',
    'm.derby.oddsBonus': 'fraction added to every winning payout (Tin Jockey, overheat)',
    'm.derby.deadHeat': 'bool: a Win pick lost by a photo finish pays at half odds',
    'm.derby.longshotBonus': 'fraction added to payouts at odds ≥ ×10 (Tote Ticket)',
    'm.derby.exactaInsurance': 'bool: an exacta in reverse order refunds the stake',
    'm.derby.albino': 'bool: The Albino (horse 7, strength 0.6–4.0 each race) joins the field',
    'x.table.peekCharges': 'bool: every bettor is privately told which horse finishes last',
    luck: 'reroll a losing solo race once with p = luck/100; shared races refund losing seats with the same p',
  },
  strings: STRINGS,
};
