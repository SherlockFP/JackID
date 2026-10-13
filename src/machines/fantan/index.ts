/**
 * Fan-Tan "Button Count" (`fantan`) — shared table, 6 seats, host-resolved (MACHINES_tables §22). The round timeline
 * lives in the host's `hostTick` (SCOOP 2.0 s → OPEN 15 s shared / ∞ solo → LOCK 0.6 s → LIFT 1.0 s → COUNT → REVEAL 1.0 s
 * → PAYOUT 2.0 s → SWEEP 1.0 s). N is sent only at LIFT, after bets lock. Maths lives in `rules.ts` (pure).
 */
import * as THREE from 'three';
import type { ChipValue, Kit } from '@/kit/types';
import type { MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { HudHint } from '@/core/ui/types';
import type { PlayerId } from '@/core/types';
import type { ModHook } from '@/game/types';
import { createRng } from '@/core/rng';
import { fmtCoins, t as tr } from '@/core/i18n';
import { TableBase } from '@/machines/_base/TableBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { buildModel, SIDE_HEX, SIDE_XZ, SQ, TC, TOP, BUTTON_CAP, type FantanParts } from './model';
import {
  LIMIT, TABLE_MAX, buildMods, countSteps, drawRound, goldLive, playHeadless, resolve, spotOf,
  type Bet, type Mods, type Round,
} from './rules';
import { STRINGS } from './fantan.strings';

// ── timing (seconds, ×1 speed) ──────────────────────────────────────────────────────────────────
const SCOOP_S = 2.0;
const OPEN_S = 15;          // shared betting window
const LOCK_S = 0.6;         // bell, bets are taken
const LIFT_S = 1.0;         // bowl rises, N is shown
const LEAD_S = 1.0;         // wand settles before the first group
const REVEAL_S = 1.0;       // remainder glows, gong
const PAYOUT_S = 2.0;
const SWEEP_S = 1.0;
const BOWL_Y = TOP + 0.005;
const BOWL_LIFT = 0.25;
const SEATS = 6;
const CHIP_CAP = 290;       // InstancedMesh budget (300 chips)
const CHIP_Z = 0.012;
const BAND = 0.11;          // painted-square edge band (sides); the corners are the Kwok squares
const GOLD = 0xffd040;
const GLOW_HEX = 0xffe27a;
const REL: ReadonlyArray<readonly [number, number]> = SIDE_XZ.map(([x, z]) => [x, z - TC] as const);

// ── contract types ──────────────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'scoop' | 'open' | 'lock';
type Ev =
  | { k: 'lay'; seat: number; bets: Bet[] }
  | { k: 'ready'; seat: number; on: boolean }
  | { k: 'phase'; p: Phase }
  | { k: 'scoop' }
  | { k: 'lift'; n: number; layoutSeed: number }
  | { k: 'count'; stepMs: number[] }
  | { k: 'result'; r: number; gold: number; live: boolean; rerolled: boolean; seats: Array<{ seat: number; stake: number; gross: number }> }
  | { k: 'peek'; even: boolean };
type Act = { k: 'set'; spot: string; a: number } | { k: 'clear' } | { k: 'ready' };
/** What every peer knows (public table state). Mutated only in `present`. */
type State = { phase: Phase; layouts: Bet[][]; ready: boolean[]; history: number[] };
type Snap = State;
/** HOST-ONLY authority: stakes not yet locked, ready flags, the round timer, and the pre-drawn round for `peek`. */
type HostState = { phase: Phase; layouts: Bet[][]; ready: boolean[]; timer: number; pre: Round | null };

const emptyLayouts = (): Bet[][] => Array.from({ length: SEATS }, () => [] as Bet[]);
const emptyFlags = (): boolean[] => new Array<boolean>(SEATS).fill(false);

/** Chip stack for an amount, greedy largest-first. */
function chipsFor(amount: number): ChipValue[] {
  const out: ChipValue[] = [];
  let left = amount;
  for (const v of [500, 100, 25, 10, 5, 1] as const) while (left >= v && out.length < 60) { out.push(v); left -= v; }
  return out;
}

/** Which spot a pointer over the painted square means (x, z relative to the square centre). */
export function squareSpot(x: number, z: number): { spot: string | null; side: number } {
  if (Math.abs(x) > SQ || Math.abs(z) > SQ) return { spot: null, side: 0 };
  const fb = Math.abs(z) > BAND;      // near the front or back edge
  const lr = Math.abs(x) > BAND;      // near the right or left edge
  if (fb && lr) {
    const id = x > 0 ? (z > 0 ? 'kwok:1-2' : 'kwok:2-3') : (z < 0 ? 'kwok:3-4' : 'kwok:1-4');
    return { spot: id, side: 0 };
  }
  if (fb) { const side = z > 0 ? 1 : 3; return { spot: `fan:${side}`, side }; }
  if (lr) { const side = x > 0 ? 2 : 4; return { spot: `fan:${side}`, side }; }
  return { spot: x < 0 ? 'odd' : 'even', side: 0 };
}

/** Where a spot's chips sit on the cloth, relative to the table centre (x, z). */
export function chipOffset(id: string): [number, number] {
  const sp = spotOf(id);
  if (!sp) return [0, 0];
  switch (sp.kind) {
    case 'fan': return [REL[sp.wins[0] - 1][0], REL[sp.wins[0] - 1][1]];
    case 'kwok': {
      const a = REL[sp.wins[0] - 1], b = REL[sp.wins[1] - 1];
      return [a[0] + b[0], a[1] + b[1]];
    }
    case 'nim': {
      const n = REL[sp.wins[0] - 1], m = REL[sp.push[0] - 1];
      return [0.6 * n[0] + 0.4 * m[0], 0.6 * n[1] + 0.4 * m[1]];
    }
    case 'ssh': {
      const omit = REL[Number(id.split(':')[1]) - 1];
      return [-0.5 * omit[0], -0.5 * omit[1]];
    }
    case 'odd': return [-0.06, 0];
    case 'even': return [0.06, 0];
    default: return [0, 0];
  }
}

/** Heap slot for the counted groups: 6 groups per row, rows run toward the back of the table, off the painted square. */
const rowPos = (g: number, j: number): THREE.Vector3 =>
  new THREE.Vector3(-0.55 + (g % 6) * 0.2 + j * 0.025, TOP + 0.004, TC - 0.44 - Math.floor(g / 6) * 0.05);

export default class FanTan extends TableBase<FantanParts, Ev, Snap, Act> {
  private st: State = { phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), history: [] };
  private hs: HostState = { phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), timer: 0, pre: null };
  /** Local only: my layout at the last LOCK, for Repeat (R). */
  private lastMine: Bet[] = [];
  private lastLock: Bet[] = [];
  /** Local only: pointer-down spot, resolved on pointer-up (a drag from one side to another is Nim). */
  private press: { spot: string | null; side: number } | null = null;
  /** Presentation only: the heap for this round (positions and yaw per button), set at LIFT. */
  private heap: THREE.Vector3[] = [];
  private heapYaw: number[] = [];
  private heapN = 0;
  private readonly dummy = new THREE.Object3D();

  protected createModel(kit: Kit): MachineModel<FantanParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.paintSquare();
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
        if (this.st.phase !== 'open' && this.st.phase !== 'idle') break;
        if (a === 'betMax') this.maxBet(); else this.stepBet(a === 'betUp' ? 1 : -1);
        this.sfx('click'); this.showHud();
        break;
      case 'confirm': if (this.st.phase === 'open') this.act({ k: 'ready' }); break;   // Space: Ready (shared) / lock (solo)
      case 'clear': if (this.canBet()) this.act({ k: 'clear' }); break;
      case 'double': this.rebet(); break;                                              // R
      case 'n1': case 'n2': case 'n3': case 'n4':
        if (this.canBet()) this.nudgeSpot(`fan:${Number(a.slice(1))}`, 1);             // quick Fan
        break;
      case 'n5': case 'n6': case 'n7': case 'n8':
        if (this.canBet()) this.nudgeSpot(`ssh:${Number(a.slice(1)) - 4}`, 1);         // Ssh: all but that side
        break;
      case 'up': if (this.canBet()) this.nudgeSpot('odd', 1); break;
      case 'down': if (this.canBet()) this.nudgeSpot('even', 1); break;
      default: break;
    }
  }

  /** LMB on a spot adds one selected chip; a drag from one side to another side is a Nim; RMB takes one back. */
  onPointer(e: MachinePointerEvent): void {
    if (e.type === 'down') {
      const sp = this.spotUnderPointer();
      if (!sp) return;
      if (e.button === 2) { if (this.canBet() && sp.spot) this.nudgeSpot(sp.spot, -1); return; }
      this.press = sp;
      return;
    }
    if (e.type !== 'up') return;
    const press = this.press;
    this.press = null;
    if (!press || e.button === 2 || !this.canBet()) return;
    const end = this.spotUnderPointer();
    if (press.side && end && end.side && end.side !== press.side) {
      this.nudgeSpot(`nim:${press.side}/${end.side}`, 1);
      return;
    }
    if (press.spot) this.nudgeSpot(press.spot, 1);
  }

  private spotUnderPointer(): { spot: string | null; side: number } | null {
    const mesh = this.parts.square.mesh;
    const hit = this.pick([mesh]);
    if (!hit) return null;
    const lp = mesh.worldToLocal(hit.point.clone());
    // the square lies flat with canvas top at the back: world z = TC − local y
    return squareSpot(lp.x, -lp.y);
  }

  private canBet(): boolean { return this.localSeat >= 0 && this.st.phase === 'open' && !this.st.ready[this.localSeat]; }
  private myBets(): Bet[] { return this.st.layouts[this.localSeat] ?? []; }
  private myAmount(s: string): number { return this.myBets().find((b) => b.s === s)?.a ?? 0; }

  /** Adds (`dir` = 1) or removes (`dir` = −1) one selected chip on a spot. */
  private nudgeSpot(s: string, dir: 1 | -1): void {
    if (!spotOf(s)) return;
    const cur = this.myAmount(s);
    let next = dir > 0 ? cur + this.bet : cur - this.bet;
    if (dir > 0 && next > LIMIT.max) { next = LIMIT.max; this.toast(tr('m.fantan.limit', { n: fmtCoins(LIMIT.max) }), 'warn'); }
    if (dir > 0 && next < LIMIT.min) next = LIMIT.min;
    if (dir < 0) next = next < LIMIT.min ? 0 : next;
    const total = this.myBets().reduce((acc, b) => acc + (b.s === s ? 0 : b.a), 0) + next;
    if (total > TABLE_MAX) { this.toast(tr('m.fantan.limit', { n: fmtCoins(TABLE_MAX) }), 'warn'); return; }
    if (next === cur) return;
    this.sfx('chip');
    this.act({ k: 'set', spot: s, a: next });
  }

  /** Repeats the last LOCKed layout where the cloth still allows it. */
  private rebet(): void {
    if (!this.canBet()) return;
    for (const b of this.lastMine) if (this.myAmount(b.s) !== b.a) this.act({ k: 'set', spot: b.s, a: b.a });
  }

  // ── HOST: actions ─────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const hs = this.hs;
    if (a.k === 'set') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.fantan.busy'); return; }
      if (!spotOf(a.spot)) { this.nak(pid, rid, 'm.fantan.badSpot'); return; }
      if (!Number.isInteger(a.a) || a.a < 0 || (a.a > 0 && (a.a < LIMIT.min || a.a > LIMIT.max))) { this.nak(pid, rid, 'm.fantan.limit'); return; }
      const others = hs.layouts[seat].reduce((acc, b) => acc + (b.s === a.spot ? 0 : b.a), 0);
      if (others + a.a > TABLE_MAX) { this.nak(pid, rid, 'm.fantan.limit'); return; }
      const next = hs.layouts[seat].filter((b) => b.s !== a.spot);
      if (a.a > 0) next.push({ s: a.spot, a: a.a });
      hs.layouts[seat] = next;
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: next });
    } else if (a.k === 'clear') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.fantan.busy'); return; }
      hs.layouts[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    } else if (a.k === 'ready') {
      if (hs.phase !== 'open') { this.nak(pid, rid, 'm.fantan.busy'); return; }
      if (!hs.layouts[seat].length) { this.nak(pid, rid, 'm.fantan.noChips'); return; }
      hs.ready[seat] = true;
      void this.emit({ k: 'ready', seat, on: true });
      const bettors = this.humans().filter((h) => hs.layouts[h.seat].length > 0);
      if (bettors.every((h) => hs.ready[h.seat])) this.lock();
    }
  }
  private unready(seat: number): void {
    if (!this.hs.ready[seat]) return;
    this.hs.ready[seat] = false;
    void this.emit({ k: 'ready', seat, on: false });
  }

  /** Host: the round starts. The croupier scoops the heap under the bowl; N stays hidden. */
  private startScoop(): void {
    const hs = this.hs;
    hs.phase = 'scoop';
    hs.timer = SCOOP_S;
    hs.pre = null;
    void this.emit({ k: 'scoop' });
  }

  /** Host: betting window opens (solo: no timer; shared: 15 s). The round is drawn now so `peek` can read its parity. */
  private openBetting(): void {
    const hs = this.hs;
    hs.phase = 'open';
    hs.timer = OPEN_S;
    hs.pre = drawRound(this.hostRng, this.mods());
    if (this.humans().length >= 2) void this.countdown(OPEN_S, 'bet');
    void this.emit({ k: 'phase', p: 'open' });
    if (this.mod('x.table.peekCharges' as ModHook, 0) > 0) {
      const even = hs.pre.n % 2 === 0;
      for (const h of this.humans()) void this.emitPrivate(h.pid, { k: 'peek', even });
    }
  }

  /** Host timeline. */
  hostTick(dt: number): void {
    const hs = this.hs;
    const humans = this.humans().length;
    if (hs.phase === 'idle') {
      if (humans > 0) this.startScoop();
      return;
    }
    if (humans === 0 && hs.phase !== 'lock') {
      this.hs = { phase: 'idle', layouts: emptyLayouts(), ready: emptyFlags(), timer: 0, pre: null };
      return;
    }
    if (hs.phase === 'scoop') {
      if ((hs.timer -= dt) <= 0) this.openBetting();
    } else if (hs.phase === 'open') {
      if (humans >= 2 && (hs.timer -= dt) <= 0) {
        if (hs.layouts.some((l) => l.length > 0)) this.lock();
        else this.startScoop();                      // nobody has chips yet: the round starts again
      }
    } else if ((hs.timer -= dt) <= 0) {
      hs.phase = 'idle';                             // sweep done: the next round scoops when someone is seated
    }
  }

  /** Charms and milestone flags folded for this round (`m.fantan.*` hooks; base 100 per side). */
  private mods(): Mods {
    const solo = this.humans().length < 2;
    return buildMods((hook, base) => this.mod(hook, base), (f) => this.feature(f), solo);
  }

  /** Host: LOCK → charge, pay, then announce LIFT, COUNT and the RESULT on the same host clock as the presentation. */
  private lock(): void {
    const hs = this.hs;
    this.cancelCountdown();
    const active: Array<{ seat: number; bets: Bet[]; stake: number }> = [];
    for (let s = 0; s < SEATS; s++) {
      const bets = hs.layouts[s];
      if (!bets.length) continue;
      const stake = bets.reduce((acc, b) => acc + b.a, 0);
      const pid = this.seats[s];
      if (pid === null || !this.chargeSeat(s, stake)) {
        if (pid !== null) this.nak(pid, 0, 'm.fantan.noFunds');
        hs.layouts[s] = [];
        this.unready(s);
        void this.emit({ k: 'lay', seat: s, bets: [] });
        continue;
      }
      active.push({ seat: s, bets, stake });
    }
    if (!active.length) { this.startScoop(); return; }

    // the luck reroll is for solo tables; a spin with two or more bettors draws once
    const luck = active.length >= 2 ? 0 : this.luck();
    const pre = hs.pre;
    hs.pre = null;
    const out = resolve(this.hostRng, active.map((a) => a.bets), this.mods(), luck, pre);
    active.forEach((a, i) => { this.paySeat(a.seat, out.seats[i].gross, { bet: a.stake }); });

    for (const a of active) {
      hs.layouts[a.seat] = [];
      this.unready(a.seat);
      void this.emit({ k: 'lay', seat: a.seat, bets: [] });
    }
    this.lastLock = active.find((a) => a.seat === this.localSeat)?.bets ?? [];

    const round = out.round;
    const steps = countSteps(round.n, round.r);
    const countSec = LEAD_S + steps.reduce((acc, ms) => acc + ms, 0) / 1000;
    const layoutSeed = this.hostRng.int(1, 0x7fffffff);
    hs.phase = 'lock';
    hs.timer = LOCK_S + LIFT_S + countSec + REVEAL_S + PAYOUT_S + SWEEP_S;
    hs.ready = emptyFlags();
    void this.emit({ k: 'phase', p: 'lock' });
    // N is revealed only at LIFT, after the bets are locked; the rest of the round follows the same host clock
    this.later(LOCK_S, { k: 'lift', n: round.n, layoutSeed });
    this.later(LOCK_S + LIFT_S, { k: 'count', stepMs: steps });
    this.later(LOCK_S + LIFT_S + countSec, {
      k: 'result', r: round.r, gold: round.goldIdx, live: goldLive(round), rerolled: out.rerolled,
      seats: active.map((a, i) => ({ seat: a.seat, stake: a.stake, gross: out.seats[i].gross })),
    });
  }

  private later(sec: number, ev: Ev): void {
    this.ctx.timers.after(sec, () => { void this.emit(ev); });
  }

  // ── presentation (every peer) ─────────────────────────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    switch (ev.k) {
      case 'lay':
        this.st.layouts[ev.seat] = ev.bets;
        this.paintChips();
        this.paintLamps();
        if (ev.bets.length) this.sfx('chip');
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'ready':
        this.st.ready[ev.seat] = ev.on;
        if (ev.on) { this.parts.seatLamps[ev.seat].blink(4, 0.6); this.sfx('click'); }
        if (this.isLocalOccupant) this.showHud();
        return;
      case 'phase': await this.onPhase(ev.p, pc); return;
      case 'scoop': await this.scoopShow(pc); return;
      case 'lift': await this.liftShow(ev, pc); return;
      case 'count': await this.countShow(ev, pc); return;
      case 'result': await this.resultShow(ev, pc); return;
      case 'peek':
        this.toast(tr(ev.even ? 'm.fantan.peekEven' : 'm.fantan.peekOdd'), 'sys');
        return;
    }
  }

  private async onPhase(p: Phase, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.phase = p;
    if (p === 'open') {
      s.ready = emptyFlags();
      this.parts.phaseLamp.setOn(true);
      this.sfx('chime', { vol: 0.4 });
    } else if (p === 'lock') {
      this.lastMine = [...this.lastLock];
      s.ready = emptyFlags();
      this.sfx('bell');                                                        // anticipation: the bell
      this.parts.phaseLamp.blink(6, 0.8);
      if (pc.fast) this.parts.bowl.position.y = BOWL_Y;
    } else if (p === 'idle') {
      this.parts.phaseLamp.setOn(false);
    }
    this.paintLamps();
    if (this.isLocalOccupant) this.showHud();
  }

  /** Action: Old Lacquer scoops. The bowl comes down over the heap, which is out of sight until LIFT. */
  private async scoopShow(pc: PresentCtx): Promise<void> {
    this.st.phase = 'scoop';
    this.parts.buttons.count = 0;
    this.parts.phaseLamp.blink(2, 2.0);
    void this.parts.dealer.pose('reach', 0.3);
    if (!pc.fast) {
      await this.anim(0.5, (k) => { this.parts.bowl.position.y = BOWL_Y + BOWL_LIFT * (1 - k); });
      this.sfx('chipStack');
      await this.wait(SCOOP_S * 0.5);
    }
    this.parts.bowl.position.y = BOWL_Y;
    this.paintLamps();
  }

  /** Anticipation → impact: the bowl rises and the heap is revealed. N becomes public here. */
  private async liftShow(ev: Extract<Ev, { k: 'lift' }>, pc: PresentCtx): Promise<void> {
    this.buildHeap(ev.n, ev.layoutSeed);
    this.sfx('chip', { vol: 0.6 });
    if (pc.fast) {
      this.parts.bowl.position.y = BOWL_Y + BOWL_LIFT;
    } else {
      await this.anim(LIFT_S * 0.5, (k) => { this.parts.bowl.position.y = BOWL_Y + BOWL_LIFT * k; });
    }
    this.parts.wand.rotation.x = 0;
  }

  /** The croupier counts groups of 4 off the top of the heap into the rows. Each group taps the wand. */
  private async countShow(ev: Extract<Ev, { k: 'count' }>, pc: PresentCtx): Promise<void> {
    const { wand, buttons } = this.parts;
    const n = this.heapN;
    if (n <= 0) return;                                                         // joined mid-round: nothing to count
    // a late joiner missed LIFT and has no heap positions: jump straight to the rows
    const live = !pc.fast && this.heap.length === n;
    if (live) await this.wait(LEAD_S * 0.5);
    for (let g = 0; g < ev.stepMs.length; g++) {
      const ms = ev.stepMs[g];
      const remaining = n - 4 * g;
      const dur = ms / 1000;
      const move = Math.min(0.28, dur * 0.6);
      if (!live) {
        for (let j = 0; j < 4; j++) this.placeButton(n - 4 * g - 1 - j, rowPos(g, j));
      } else {
        wand.rotation.x = -0.35;                                              // tap
        this.sfx('wheelTick', { vol: 0.5 });
        await this.anim(move, (k) => {
          for (let j = 0; j < 4; j++) {
            const i = n - 4 * g - 1 - j;
            this.placeButton(i, this.heap[i].clone().lerp(rowPos(g, j), k));
          }
          buttons.instanceMatrix.needsUpdate = true;
        });
        wand.rotation.x = 0;
        if (remaining <= 12) this.sfx('heartbeat', { vol: 0.5 });
        await this.wait(Math.max(0, dur - move));
      }
    }
    buttons.instanceMatrix.needsUpdate = true;
    for (let g = 0; g < ev.stepMs.length; g++) {
      for (let j = 0; j < 4; j++) this.heap[n - 4 * g - 1 - j] = rowPos(g, j);
    }
    wand.rotation.x = 0;
  }

  /** Impact + follow-through: the remainder glows, the side lamp lights, the gong sounds, payouts, then the sweep. */
  private async resultShow(ev: Extract<Ev, { k: 'result' }>, pc: PresentCtx): Promise<void> {
    const { buttons, sideLamps, gong, square, seatLamps } = this.parts;
    const r = ev.r;
    this.st.phase = 'lock';

    // the remainder: the last r buttons of the heap, at the bottom of it
    const glow = new THREE.Color(GLOW_HEX);
    for (let i = 0; i < r; i++) buttons.setColorAt(i, glow);
    if (ev.live && ev.gold >= 0 && ev.gold < r) buttons.setColorAt(ev.gold, new THREE.Color(GOLD));
    if (buttons.instanceColor) buttons.instanceColor.needsUpdate = true;

    sideLamps.forEach((l, i) => { l.setOn(i === r - 1); if (i === r - 1) l.blink(6, 1.0); });
    this.ctx.fx.sparks(square.mesh, 6, SIDE_HEX[r - 1]);
    if (!pc.fast) {
      this.sfx('bell', { vol: 0.9 });                                           // the gong, struck once
      await this.anim(0.6, (k) => { gong.rotation.x = Math.sin(k * Math.PI * 4) * 0.12 * (1 - k); });
      gong.rotation.x = 0;
    } else {
      this.sfx('bell', { vol: 0.9 });
    }

    this.st.history = [r, ...this.st.history].slice(0, 12);
    this.drawHistory();

    // payouts: the best winner gets the celebration, losers get a beat, the whole table reads the result
    const winners = [...ev.seats].filter((s) => s.gross > 0).sort((x, y) => y.gross - x.gross);
    const best = winners[0];
    if (best && best.gross > best.stake) {
      const tier = juiceTier(best.gross, best.stake);
      void this.celebrate(tier, { amount: best.gross, at: square.mesh, lamps: [seatLamps[best.seat]], fast: pc.fast, restore: () => this.paintLamps() });
    } else if (!best) {
      this.sfx('coin');
    }
    for (const s of ev.seats) {
      if (s.gross <= 0) {
        if (s.seat === this.localSeat) this.commiserate({ at: square.mesh });
        continue;
      }
      const lamp = seatLamps[s.seat];
      lamp.blink(8, 1.2);
      const text = s.gross === s.stake ? tr('m.fantan.push', { n: fmtCoins(s.gross) }) : tr('m.fantan.win', { n: fmtCoins(s.gross) });
      this.ctx.fx.popText(lamp.root, text, s.gross > s.stake ? GOLD : 0x7dff7a, { dur: 1.2, rise: 0.3 });
    }
    this.toast(tr('m.fantan.stopped', { n: String(r) }), 'sys');
    if (ev.live) this.toast(tr('m.fantan.gold'), 'sys');
    if (!pc.fast) await this.wait(PAYOUT_S * 0.5);

    // sweep: the buttons leave the table and the colours reset
    if (!pc.fast) await this.wait(SWEEP_S * 0.5);
    this.resetHeap();
    this.paintLamps();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── heap helpers (presentation) ───────────────────────────────────────────────────────────────
  private buildHeap(n: number, seed: number): void {
    const rng = createRng(seed);
    const { buttons } = this.parts;
    this.heap = [];
    this.heapYaw = [];
    this.heapN = n;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const rad = Math.sqrt(rng.next()) * 0.17;
      const layer = Math.floor(i / 16);                                          // 16 buttons per layer
      const p = new THREE.Vector3(Math.cos(a) * rad, TOP + 0.004 + layer * 0.0042 + rng.next() * 0.001, TC + Math.sin(a) * rad);
      this.heap.push(p);
      this.heapYaw.push(rng.next() * Math.PI * 2);
      this.placeButton(i, p);
    }
    buttons.count = n;
    buttons.instanceMatrix.needsUpdate = true;
  }

  private placeButton(i: number, pos: THREE.Vector3): void {
    this.dummy.position.copy(pos);
    this.dummy.rotation.set(0, this.heapYaw[i] ?? 0, 0);
    this.dummy.updateMatrix();
    this.parts.buttons.setMatrixAt(i, this.dummy.matrix);
  }

  /** Back to an empty cloth: no buttons, default colours, bowl down, wand straight. */
  private resetHeap(): void {
    const { buttons, bowl, wand } = this.parts;
    buttons.count = 0;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < BUTTON_CAP; i++) buttons.setColorAt(i, white);
    if (buttons.instanceColor) buttons.instanceColor.needsUpdate = true;
    bowl.position.y = BOWL_Y;
    wand.rotation.x = 0;
    this.heap = [];
    this.heapN = 0;
    this.parts.sideLamps.forEach((l) => l.setOn(false));
    this.drawHistory();
  }

  // ── snapshots: public table state only ────────────────────────────────────────────────────────
  getSnapshot(): Snap {
    return {
      phase: this.st.phase, layouts: this.st.layouts.map((l) => [...l]), ready: [...this.st.ready], history: [...this.st.history],
    };
  }
  applySnapshot(sn: Snap): void {
    this.st = { phase: sn.phase, layouts: sn.layouts.map((l) => [...l]), ready: [...sn.ready], history: [...sn.history] };
    this.paintAll();
  }

  // ── seats ─────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    this.paintLamps();
    if (local) { this.sfx('chime', { vol: 0.5 }); this.showHud(); }
  }
  onRelease(_pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && this.hs.phase === 'open' && this.hs.layouts[seat].length) {
      this.hs.layouts[seat] = [];
      this.unready(seat);
      void this.emit({ k: 'lay', seat, bets: [] });
    }
    if (local) this.lastMine = [];
    this.paintLamps();
  }
  override onLang(): void { this.drawHistory(); this.paintSquare(); this.paintChips(); if (this.isLocalOccupant) this.showHud(); }

  // ── visuals ───────────────────────────────────────────────────────────────────────────────────
  private paintLamps(): void {
    this.parts.seatLamps.forEach((l, s) => l.setOn(this.seats[s] !== null));
    this.parts.phaseLamp.setOn(this.st.phase !== 'idle');
    this.parts.goldLamp.setOn(this.feature('fantan.golden'));
  }

  private paintChips(): void {
    const { chips } = this.parts;
    chips.clear();
    this.st.layouts.forEach((seat, s) => {
      for (const b of seat) {
        const [dx, dz] = chipOffset(b.s);
        const v = new THREE.Vector3(dx, TOP + CHIP_Z, TC + dz + s * 0.006);
        for (const c of chipsFor(b.a)) {
          if (chips.count >= CHIP_CAP) return;
          chips.add(c, v);
        }
      }
    });
  }

  private paintSquare(): void {
    this.parts.square.draw((g, w) => {
      g.fillStyle = '#0c3b24';
      g.fillRect(0, 0, w.w, w.h);
      g.strokeStyle = '#d4af37';
      g.lineWidth = 3;
      g.strokeRect(4, 4, w.w - 8, w.h - 8);
      g.beginPath();
      g.moveTo(w.w * 0.2, w.h * 0.2); g.lineTo(w.w * 0.8, w.h * 0.8);
      g.moveTo(w.w * 0.8, w.h * 0.2); g.lineTo(w.w * 0.2, w.h * 0.8);
      g.stroke();
      // canvas top = back (side 3), bottom = front (side 1), right = side 2, left = side 4
      w.text('3', w.w / 2, 6, { font: 'px5', color: '#f2e8c8', align: 'center' });
      w.text('1', w.w / 2, w.h - 16, { font: 'px5', color: '#f2e8c8', align: 'center' });
      w.text('2', w.w - 14, w.h / 2 - 4, { font: 'px5', color: '#f2e8c8', align: 'center' });
      w.text('4', 10, w.h / 2 - 4, { font: 'px5', color: '#f2e8c8', align: 'center' });
    });
  }

  private drawHistory(): void {
    this.parts.history.draw((g, w) => {
      g.fillStyle = '#080808';
      g.fillRect(0, 0, w.w, w.h);
      this.st.history.forEach((r, i) => {
        const x = 1 + i * 8;
        g.fillStyle = `#${SIDE_HEX[r - 1].toString(16).padStart(6, '0')}`;
        g.fillRect(x, 1, 7, w.h - 2);
        w.text(String(r), x + 3, 3, { font: 'px5', color: '#000000', align: 'center' });
      });
    });
  }

  private paintAll(): void {
    this.paintLamps();
    this.paintChips();
    this.drawHistory();
    this.paintSquare();
  }

  private showHud(): void {
    const seat = this.localSeat;
    const hints: HudHint[] = [];
    const open = this.st.phase === 'open';
    if (open && seat >= 0) {
      hints.push({ action: 'confirm', label: this.st.ready[seat] ? tr('m.fantan.ready') : tr('m.fantan.spin') });
      hints.push({ action: 'clear', label: tr('m.fantan.clear') }, { action: 'double', label: tr('m.fantan.rebet') });
    }
    hints.push({ action: 'betUp', label: tr('common.bet') }, { action: 'exit', label: tr('common.leave') });
    const total = this.myBets().reduce((acc, b) => acc + b.a, 0);
    this.hud({
      bet: open && seat >= 0 ? this.bet : null,
      hints,
      stats: total > 0 ? [{ label: this.t('potLabel'), value: fmtCoins(total) }] : [],
    });
  }
}

export { playHeadless } from './rules';

export const def: MachineDef = {
  id: 'fantan',
  category: 'table',
  slotSize: 'L',
  zone: 'wheels',
  seats: SEATS,
  shared: true,
  tier: 3,
  minBet: LIMIT.min, maxBet: LIMIT.max, betSteps: [5, 10, 25, 50, 100, 250, 500],
  maxPayoutMult: 8,
  rtp: 0.9625,
  actionCost: 1,
  tags: ['table', 'draw'],
  headless: playHeadless,
  modHooks: {
    'm.fantan.sideWeight.<n>': 'int add to the weight of side n (1–4); base 100; solo only',
    'm.fantan.nimPushPays': 'float: a Nim push side pays x:1 instead of returning the stake',
    'm.fantan.goldenButton': 'bool: one gold button is in the heap; if it survives to the remainder, winning bets pay double',
    'x.table.rakeDelta': 'percentage points added to the commission on winnings (base 5 %)',
    'x.table.peekCharges': 'bool: during OPEN, see the parity of the heap (private)',
  },
  strings: STRINGS,
};
