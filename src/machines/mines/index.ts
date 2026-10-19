/**
 * Mines Terminal (`mines`) — solo grid game with commit–reveal (MACHINES_machines §12). Copies the coinflip pattern:
 * the logic / present split.
 *
 *  - the authority (the local occupant) commits the round: `commit()` draws the seed, the luck "Defuse" roll and the
 *    layout from the round rng, then `emit`s `start` with the fairness hash only. The layout stays in `secret`;
 *  - each reveal is resolved by the pure `pick()` rule and `emit`ted as `pick`; the round closes with `end`, which
 *    carries the seed and the layout (the reveal), so every peer can check the hash and the mine positions;
 *  - `present()` is the only place the visible state changes and where the animation happens, on every peer;
 *  - the wallet step (`settle`) runs before the presentation (DECISIONS G): cash and bust credit in `emit`'s credit;
 *  - juice: arm drop → tile tremble (anticipation) → flap flip (action) → ping / sparkle / pop text / shake / CRT
 *    (impact) → escalating cash tiers via `juiceTier` (follow-through), the trap snap and CRT burn on a mine.
 *
 * Controls: arrows / WASD move the selector · Space arms the field, or reveals the selected tile · LMB a tile ·
 * Q, C, Enter or the guarded CASH OUT switch cash out · P random tile · [ ] or n6 / n7 mines ± 1 · 1–5 presets ·
 * wheel / Z / X stake · H help · E stand up (cashes out at k ≥ 1; a round with k = 0 is refunded).
 */
import type * as THREE from 'three';
import { MachineBase } from '@/machines/_base/MachineBase';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import { juiceTier } from '@/machines/_base/tiers';
import { countUp } from '@/machines/_base/juice';
import type { MachineAction, MachineInputEvent, MachinePointerEvent } from '@/core/input/types';
import type { KitX } from '@/kit';
import { fmtCoins } from '@/core/i18n';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import { buildModel, cellPos, FLIP_OPEN, type MinesParts } from './model';
import {
  CAP, CAP_RAISED, CELLS, COLS, HOOK_CAP, HOOK_EDGE, HOOK_INSURE, HOOK_SCAN, IDLE_S, PRESETS, RTP,
  autoCash, clampCap, clampInsure, clampMines, commit, multAt, nextSafeChance, pick as pickRule, playHeadless, takeDust, isRevealed,
  type Board, type Commit, type Opts,
} from './rules';
import STR from './mines.strings';

export { playHeadless };

const GOLD = 0xffd040;
const GREEN = 0x33ff66;
const RED = 0xff3020;
const CYAN = 0x39e6ff;
const WHITE = 0xffffff;
const SCREEN_BG = '#001a08';
const PHOSPHOR = '#33ff66';
const DIM = '#3fae55';

type Res = 'safe' | 'mine' | 'defused';
type Ev =
  /** Round committed: the fairness hash, plus the hooks fixed for this round (so every peer prices it the same). */
  | { k: 'start'; stake: number; m: number; fair: string; edge: number; cap: number; ins: number }
  | { k: 'pick'; cell: number; res: Res; mult: number; n: number; corners: number; defused: boolean }
  /** Round closed: cash (credit the payout), bust (refund, if insured) or void (stake back). Reveals seed + layout. */
  | { k: 'end'; result: 'cash' | 'bust' | 'void'; gross: number; bet: number; layout: number; seed: number; ins: number };
type PickEv = Extract<Ev, { k: 'pick' }>;
type EndEv = Extract<Ev, { k: 'end' }>;

type State = {
  m: number;          // mines chosen in the UI (1–24), local preference
  open: boolean;      // a round is in flight (mirrors the round on every peer)
  rm: number;         // mines of the open round
  stake: number;      // stake of the open round
  fair: string;       // fairness hash of the open round
  edge: number;       // round hook: + × per safe corner
  cap: number;        // round hook: multiplier cap
  ins: number;        // round hook: bust refund, percent
  revealed: number;   // bitmask of opened cells
  safe: number;       // bitmask of opened safe cells
  k: number;          // safe reveals so far
  corners: number;    // safe corner reveals so far
  defused: boolean;   // the round's one defuse is spent
  mult: number;       // current multiplier
  last: number;       // latest opened cell (-1 none)
  lastRes: string;    // 'safe' | 'mine' | 'defused' | 'cashed' | 'void' | 'boom' | ''
  dust: number;       // fractional coins carried between payouts
};

/** Owner-only layout of the open round (never sent to other players; saved for the owner's reload). */
type Secret = { seed: number; mask: number; defuse: boolean; scan: number };
type Snap = { s: State; sec: Secret | null };

function freshState(): State {
  return {
    m: PRESETS[1], open: false, rm: PRESETS[1], stake: 0, fair: '', edge: 0, cap: CAP, ins: 0,
    revealed: 0, safe: 0, k: 0, corners: 0, defused: false, mult: 0, last: -1, lastRes: '', dust: 0,
  };
}

const fmtMult = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
const cellBit = (cell: number): number => 1 << cell;

export const def: MachineDef = {
  id: 'mines',
  category: 'skill',
  slotSize: 'M',
  zone: 'well',
  seats: 1,
  shared: false,
  minBet: 1, maxBet: 200, betSteps: [1, 2, 5, 10, 20, 50, 100, 200],
  maxPayoutMult: CAP_RAISED,
  rtp: RTP,
  tier: 2,
  actionCost: 1,
  idleYield: 0.18,
  headless: playHeadless,
  tags: ['solo', 'grid', 'commit-reveal'],
  modHooks: {
    'm.mines.scanner': 'Marks one safe tile at commit (Dowsing Rod). Cosmetic only; the payout is unchanged.',
    'm.mines.edgeBonus': `Adds × per revealed safe corner (base 0, charm e.g. +0.05). Capped by the multiplier cap.`,
    'm.mines.insurance': 'Bust refunds this percent of the stake (base 0; Sapper\'s Badge = 100).',
    'm.mines.capRaise': `Multiplier cap (base ${CAP}, raised to ${CAP_RAISED}).`,
    luck: 'Core luck: each point gives 1 % (cap 30 %) that the first mine hit in a round is defused.',
  },
  strings: { en: STR.en, tr: STR.tr },
};

export default class Mines extends MachineBase<MinesParts, Ev, Snap> {
  private st: State = freshState();
  private secret: Commit | null = null;
  private cursor = Math.floor(CELLS / 2);     // the centre tile (a fractional start made tile lookups undefined)
  private idle = 0;
  private leaving = false;
  private guardUp = false;
  private scanCell = -1;
  private burnt = false;
  /** Seat HUD overlay (readability standard, see _base/seatHud.ts). Created in init, shown while seated. */
  private seatHud?: SeatHud;

  protected createModel(kit: KitX): MachineModel<MinesParts> {
    return buildModel(kit, this.modelOpts);
  }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);                                        // the seat HUD replaces the generic bottom bar
    this.refresh();
    this.attractor.every('rattle', 8, () => this.rattle(), { first: 4 });
  }

  // ── attract: one random tile rattles now and then ────────────────────────────────────────────────
  attract(dt: number, _time: number): void {
    this.attractor.update(dt);
  }

  private rattle(): void {
    if (this.busy || this.roundOpen) return;
    const tile = this.parts.tiles[this.cosmetic.int(0, CELLS - 1)];
    this.ctx.tweens.run(0.3, (k) => { tile.rotation.x = 0.05 * Math.sin(k * Math.PI * 3); }, {
      onDone: () => { tile.rotation.x = 0; },
    });
  }

  // ── occupancy ────────────────────────────────────────────────────────────────────────────────────
  onOccupy(_pid: number, _seat: number, local: boolean): void {
    this.refresh();
    if (local) {
      if (this.st.open && !this.roundOpen) this.resumeRound(this.st.stake);   // restored round: the sitter owns it
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('mines', this.tipLines());
    }
  }

  dispose(): void {
    this.seatHud?.dispose();
    super.dispose();
  }

  onRelease(_pid: number, _seat: number, local: boolean): void {
    if (local) { this.hud(null); this.seatHud?.hide(); }
    // Normal path: standUp() settled first. Safety net for forced / external releases: never strand a stake.
    if (local && this.roundOpen) {
      const s = this.st;
      if (s.k >= 1) {
        const r = takeDust(s.stake, s.mult, s.dust);
        this.settle({ gross: r.gross, tags: ['ladder'] });
        s.dust = r.dust;
      } else {
        this.settle({ gross: s.stake, tags: ['void'] });
      }
    }
    this.secret = null;
    this.st.open = false;
    this.leaving = false;
    this.guardUp = false;
    this.refresh();
  }

  onLang(): void {
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
  }

  /** E: a round with a safe reveal cashes out, a round without one is refunded. Stand-up never forfeits a stake. */
  protected override standUp(): void {
    if (this.roundOpen) {
      this.leaving = true;
      if (!this.busy) void (this.st.k >= 1 ? this.cashOut() : this.endRound('void'));
    }
    super.standUp();
  }

  // ── input (local occupant) ───────────────────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    if (!e.down) return;
    const a = e.action;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }   // any key closes a tip or rules card
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    const moves = a === 'left' || a === 'right' || a === 'up' || a === 'down';
    if (e.repeat && !moves && a !== 'betUp' && a !== 'betDown' && a !== 'n6' && a !== 'n7') return;
    switch (a) {
      case 'left': this.moveCursor(-1, 0); break;
      case 'right': this.moveCursor(1, 0); break;
      case 'up': this.moveCursor(0, -1); break;
      case 'down': this.moveCursor(0, 1); break;
      case 'primary':
        if (this.roundOpen) void this.pickCell(this.cursor);
        else void this.arm();
        break;
      case 'confirm': case 'collect': void this.cashOut(); break;   // Enter / Q / C
      case 'clear': this.pickRandom(); break;                         // P: random unrevealed tile
      case 'n1': case 'n2': case 'n3': case 'n4': case 'n5':
        this.setPreset(Number(a.slice(1)) - 1); break;
      case 'n6': this.nudgeMines(-1); break;                          // [
      case 'n7': this.nudgeMines(1); break;                           // ]
      case 'betUp': this.changeBet(() => this.stepBet(1)); break;
      case 'betDown': this.changeBet(() => this.stepBet(-1)); break;
      case 'betMax': this.changeBet(() => this.maxBet()); break;
    }
  }

  onPointer(e: MachinePointerEvent): void {
    const tiles = this.parts.tiles;
    const hit = this.pick([...tiles, this.parts.cashToggle.root, this.parts.cashGuard]);
    if (!hit) return;
    const cell = this.cellOf(hit.object);
    if (e.type === 'move') { if (cell >= 0) this.cursor = cell; return; }
    if (e.type !== 'down' || e.button !== 0) return;
    if (cell >= 0) {
      this.cursor = cell;
      if (this.roundOpen) void this.pickCell(cell);
      return;
    }
    if (this.isInside(hit.object, this.parts.cashGuard)) { this.lift(); return; }
    if (this.isInside(hit.object, this.parts.cashToggle.root) && this.guardUp) {
      this.lift();                                          // closes the guard again
      void this.cashOut();
    }
  }

  debugForce(arg: string): void {
    this.ctx.ui.toast(`mines: ${arg.trim() || 'n/a'}`, 'sys');
  }

  private changeBet(fn: () => void): void {
    if (this.roundOpen) return;
    fn();
    this.sfx('click');
    this.showHud();
  }

  private setPreset(i: number): void {
    if (this.roundOpen || i < 0 || i >= PRESETS.length) return;
    this.st.m = PRESETS[i];
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  private nudgeMines(d: number): void {
    if (this.roundOpen) return;
    const next = clampMines(this.st.m + d);
    if (next === this.st.m) { this.sfx('buzzer', { vol: 0.3 }); return; }
    this.st.m = next;
    this.sfx('click');
    this.refresh();
    this.showHud();
  }

  private moveCursor(dc: number, dr: number): void {
    const r = Math.floor(this.cursor / COLS), c = this.cursor % COLS;
    const nr = Math.min(COLS - 1, Math.max(0, r + dr)), nc = Math.min(COLS - 1, Math.max(0, c + dc));
    const next = nr * COLS + nc;
    if (next === this.cursor) return;
    this.cursor = next;
    this.sfx('click', { vol: 0.35, pitch: 7 });
    this.placeSelector();
  }

  private pickRandom(): void {
    if (!this.roundOpen) return;
    const open: number[] = [];
    for (let i = 0; i < CELLS; i++) if (!isRevealed(this.board(), i)) open.push(i);
    if (open.length === 0) return;
    this.cursor = open[this.cosmetic.int(0, open.length - 1)];
    this.placeSelector();
    void this.pickCell(this.cursor);
  }

  private lift(): void {
    this.guardUp = !this.guardUp;
    this.sfx('lever', { vol: 0.6 });
    void this.anim(0.2, (k) => {
      this.parts.cashGuard.rotation.x = this.guardUp ? -1.3 * k : -1.3 * (1 - k);
    }, 'outBack');
  }

  private cellOf(obj: THREE.Object3D): number {
    const tiles = this.parts.tiles;
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
      const i = tiles.indexOf(o as THREE.Group);
      if (i >= 0) return i;
    }
    return -1;
  }

  private isInside(obj: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o === root) return true;
    return false;
  }

  // ── authority-side logic: runs only on the local occupant ────────────────────────────────────────
  private board(): Board {
    const s = this.st, sec = this.secret;
    return { m: s.rm, mask: sec?.mask ?? 0, defuse: sec?.defuse ?? false, defused: s.defused, k: s.k, corners: s.corners, revealed: s.revealed };
  }

  private opts(): Opts {
    return { edge: this.st.edge, cap: this.st.cap };
  }

  /** Commit a new round: charge the stake, draw the layout, announce the fairness hash. */
  private async arm(): Promise<void> {
    if (this.busy || this.roundOpen) return;
    const stake = this.bet;
    if (!this.beginRound(stake)) return;                    // charges the wallet, busy = true, re-seeds this.rng
    const m = clampMines(this.st.m);
    const scanner = this.mod(HOOK_SCAN, 0) > 0;
    const c = commit(this.rng, m, this.luck(), scanner);
    this.secret = c;
    this.scanCell = c.scan;                                 // local-only mark
    const edge = Math.max(0, this.mod(HOOK_EDGE, 0));
    const cap = clampCap(this.mod(HOOK_CAP, CAP));
    const ins = clampInsure(this.mod(HOOK_INSURE, 0));
    this.showHud();
    try {
      await this.emit({ k: 'start', stake, m, fair: c.fair, edge, cap, ins });
    } finally {
      this.busy = false;
      this.showHud();
    }
  }

  /** Reveal one tile. Pure rule decides; the outcome goes out as a `pick`, then the round may close. */
  private async pickCell(cell: number): Promise<void> {
    const s = this.st;
    if (!this.roundOpen || this.busy || !s.open || !this.secret) return;
    if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return;   // only real tiles reach the reveal tweens
    if (isRevealed(this.board(), cell)) return;
    this.busy = true;
    this.idle = 0;
    this.showHud();
    const step = pickRule(this.board(), cell, this.opts());
    await this.emit({ k: 'pick', cell, res: step.res, mult: step.mult, n: step.k, corners: step.corners, defused: step.defused });
    if (step.res === 'mine') { await this.endRound('bust'); return; }
    if (this.leaving) { await this.endRound(this.st.k >= 1 ? 'cash' : 'void'); return; }
    if (step.res === 'safe' && autoCash(this.st.k, this.st.corners, this.st.rm, this.opts())) { await this.endRound('cash'); return; }
    this.busy = false;
    this.showHud();
  }

  private async cashOut(): Promise<void> {
    if (!this.roundOpen || this.busy || !this.st.open) return;
    if (this.st.k < 1) { this.toast(this.t('needSafe'), 'bad'); this.sfx('buzzer'); return; }
    await this.endRound('cash');
  }

  /** Close the round: settle first (credit), then present the reveal. Caller has `busy` set or clears it here. */
  private async endRound(result: 'cash' | 'bust' | 'void'): Promise<void> {
    const s = this.st, sec = this.secret;
    if (!sec || !this.roundOpen) { this.busy = false; return; }
    let gross = 0;
    if (result === 'cash') gross = takeDust(s.stake, s.mult, s.dust).gross;
    else if (result === 'void') gross = s.stake;
    else gross = Math.floor((s.stake * s.ins) / 100);       // insurance refund on a bust (0 when uninsured)
    const credit = (): void => { this.settle({ gross, tags: this.tagsFor(result, gross) }); };
    this.busy = true;
    const ev: EndEv = { k: 'end', result, gross, bet: s.stake, layout: sec.mask, seed: sec.seed, ins: result === 'bust' ? gross : 0 };
    const shown = this.emit(ev, credit);
    if (this.roundOpen) credit();                           // the emit was refused: still settle, never strand a stake
    this.secret = null;
    this.leaving = false;
    try { await shown; } finally { this.busy = false; this.showHud(); }
  }

  private tagsFor(result: 'cash' | 'bust' | 'void', gross: number): string[] {
    if (result === 'void') return ['void'];
    if (result === 'bust') return gross > 0 ? ['loss', 'bust', 'insured'] : ['loss', 'bust'];
    return ['ladder', ...(this.st.k >= 5 ? ['streak:' + this.st.k] : [])];
  }

  // ── timers (sim clock, every peer; acts on the local occupant only) ──────────────────────────────
  tick(dt: number): void {
    if (!this.isLocalOccupant || !this.roundOpen || this.busy) return;
    this.idle += dt;
    if (this.idle < IDLE_S) return;
    this.idle = 0;
    void (this.st.k >= 1 ? this.cashOut() : this.endRound('void'));
  }

  // ── presentation: every peer, including the emitter ─────────────────────────────────────────────
  present(ev: Ev, pc: PresentCtx): void | Promise<void> {
    switch (ev.k) {
      case 'start': return this.presentStart(ev, pc);
      case 'pick': return this.presentPick(ev, pc);
      case 'end': return this.presentEnd(ev, pc);
    }
  }

  private async presentStart(ev: Extract<Ev, { k: 'start' }>, pc: PresentCtx): Promise<void> {
    const s = this.st;
    s.open = true; s.rm = ev.m; s.stake = ev.stake; s.fair = ev.fair;
    s.edge = ev.edge; s.cap = ev.cap; s.ins = ev.ins;
    s.revealed = 0; s.safe = 0; s.k = 0; s.corners = 0; s.defused = false; s.mult = 0;
    s.last = -1; s.lastRes = '';
    this.burnt = false;
    this.parts.under.visible = false;
    this.parts.lamp.setOn(true);
    this.parts.leds.bet.setOn(false);
    this.parts.leds.win.setOn(false);
    this.parts.leds.credit.setOn(true);
    this.drawScreen();
    if (this.isLocalOccupant) this.showHud();
    if (pc.fast) { this.refresh(); return; }
    this.sfx('powerUp', { vol: 0.7 });
    this.sfx('thud', { vol: 0.4, pitch: -5 });
    await this.anim(0.4, (k) => {
      const drop = (1 - k) * 0.12;                          // the grid drops into place
      for (const tile of this.parts.tiles) tile.position.y = drop;
    }, 'outBounce');
    for (const tile of this.parts.tiles) tile.position.y = 0;
    this.placeSelector();
    if (pc.local && this.scanCell >= 0) this.ctx.fx.glow(this.parts.tiles[this.scanCell], GREEN, 0.12, 1.2);
    this.drawScreen();
  }

  private async presentPick(ev: PickEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    const tile = this.parts.tiles[ev.cell];
    const fx = this.ctx.fx;
    // 1. data first (snapshots stay consistent), pixels later
    s.last = ev.cell;
    s.revealed |= cellBit(ev.cell);
    s.defused = ev.defused;
    s.corners = ev.corners;
    s.k = ev.n;
    s.mult = ev.mult;
    s.lastRes = ev.res === 'safe' ? 'safe' : ev.res === 'defused' ? 'defused' : 'boom';
    if (ev.res === 'safe') s.safe |= cellBit(ev.cell);
    this.placeSelector();
    if (pc.fast) {
      tile.rotation.x = FLIP_OPEN;
      this.parkSocket(ev.cell, ev.res === 'safe');
      this.drawScreen();
      return;
    }
    // 2. anticipation: the flap trembles and the selector blips
    this.sfx('click', { vol: 0.5 });
    await this.anim(0.08, (k) => { tile.position.y = 0.012 * k; tile.rotation.x = -0.06 * k; }, 'outQuad');
    // 3. action: the flap flips up
    this.sfx('tileClack', { vol: 0.8 });
    await this.anim(0.25, (k) => { tile.rotation.x = FLIP_OPEN * k; tile.position.y = 0.012 * (1 - k); }, 'outBack');
    tile.rotation.x = FLIP_OPEN;
    tile.position.y = 0;
    // 4. impact, by result
    if (ev.res === 'safe') {
      this.parkSocket(ev.cell, true);
      this.sfx('chime', { vol: 0.8, pitch: Math.min(12, ev.n - 1) });   // rising ping, one semitone per safe tile
      this.sfx('coinClink', { vol: 0.6 });                              // the coin drops in its socket: one clink, the chime carries the rest
      if (ev.mult >= 10) this.sfx('heartbeat', { vol: Math.min(1, 0.3 + ev.mult / 200) });
      fx.sparks(tile, 4 + Math.min(12, ev.n * 2), GOLD);
      fx.glow(tile, GOLD, 0.18 + 0.02 * ev.n, 0.4);
      fx.popText(tile, `×${fmtMult(ev.mult)}`, GOLD, { dur: 0.9, rise: 0.3, scale: 1 + Math.min(0.8, ev.n * 0.05), shake: ev.n >= 6 });
      if (pc.local) fx.shake(0.002 + Math.min(0.006, ev.n * 0.0008), 0.08);
      await this.anim(0.22, (k) => { this.parts.coin.rotation.y = k * Math.PI * 2; });
      this.parts.coin.rotation.y = 0;
    } else if (ev.res === 'defused') {
      this.parkSocket(ev.cell, false);
      this.sfx('tileClack', { vol: 1.2, pitch: -6 });
      this.sfx('buzzer', { vol: 0.35 });
      fx.sparks(tile, 10, CYAN);
      fx.popText(tile, this.t('defused'), CYAN, { dur: 1.1, rise: 0.25, scale: 1.1 });
      await this.snapJaws();
      if (pc.local) this.sfx('lightFlicker', { vol: 0.4 });
    } else {
      this.parkSocket(ev.cell, false);
      this.sfx('tileClack', { vol: 1.4, pitch: -9 });                  // the trap snaps
      this.sfx('thud', { vol: 1 });
      this.parts.finger.visible = this.cosmetic.next() < 0.35;
      if (this.parts.finger.visible) this.sfx('porcelainCrack', { vol: 0.6 });
      fx.flash(WHITE, 0.7, 0.1);
      fx.sparks(tile, 14, RED);
      fx.dust(tile, 8);
      if (pc.local) fx.shake(0.01, 0.3);
      await this.snapJaws();
      this.burnt = true;                                              // CRT burn-in ghost until the round ends
    }
    // 5. follow-through: the screen and lamps catch up
    this.refresh();
    if (ev.res !== 'mine') this.parts.leds.win.setOn(true);
    await this.wait(ev.res === 'safe' ? 0.2 : 0.35);
  }

  private async presentEnd(ev: EndEv, pc: PresentCtx): Promise<void> {
    const s = this.st;
    const bet = ev.bet;
    const fx = this.ctx.fx;
    const tier = juiceTier(ev.gross, bet);
    if (ev.result === 'cash') {
      s.dust = takeDust(s.stake, s.mult, s.dust).dust;   // the same remainder every peer computes
    }
    s.lastRes = ev.result === 'cash' ? 'cashed' : ev.result === 'void' ? 'void' : 'boom';
    if (this.isLocalOccupant) {
      if (ev.result === 'cash') this.seatHud?.result('win', ev.gross - bet);
      else if (ev.result === 'void') this.seatHud?.result('push');
      else if (ev.gross > 0) this.seatHud?.result('lose', ev.gross - bet);   // insured bust: part of the stake back
      else this.seatHud?.result('bust', -bet);
    }
    s.open = false;
    // SHOW_ALL: every unrevealed tile flips; every mine gets the trap walked over it (the pooled trap)
    const unopened: number[] = [];
    for (let i = 0; i < CELLS; i++) if (!((s.revealed >> i) & 1)) unopened.push(i);
    s.revealed = (1 << CELLS) - 1;
    this.parts.under.visible = false;
    if (pc.fast) {
      this.refresh();
    } else {
      for (const i of unopened) {
        const tile = this.parts.tiles[i];
        void this.anim(0.14, (k) => { tile.rotation.x = FLIP_OPEN * k; }, 'outBack');
        if ((ev.layout >> i) & 1) {
          this.parkSocket(i, false);
          this.sfx('tileClack', { vol: 0.5, pitch: -4 });
          void this.snapJaws();
        }
        await this.wait(0.03);
      }
    }
    // resolution
    if (ev.result === 'cash') {
      this.sfx('cashRegister', { vol: 0.9 });
      fx.sparks(this.parts.tiles[Math.max(0, s.last)], 20, GREEN);
      this.parts.leds.win.setOn(true);
      this.parts.lamp.setOn(true);
      const green = this.parts.tiles.filter((_, i) => ((s.safe >> i) & 1) === 1).slice(0, 8);
      for (const tile of green) fx.glow(tile, GREEN, 0.14, 0.5);
      if (tier === 'medium' || tier === 'big' || tier === 'huge' || tier === 'mega' || tier === 'jackpot') {
        // a medium-plus cash-out gets the full show (coins, flash, pop, jingle) and keeps the on-screen count-up under it
        void this.celebrate(tier, { amount: ev.gross - bet, bet, fast: pc.fast });
        if (!pc.fast && (tier === 'huge' || tier === 'mega' || tier === 'jackpot')) fx.shake(0.04, 0.5, { roll: 1.6 });
        await countUp(this.ctx, 0, ev.gross, pc.fast ? 0.1 : 1.0 * this.speed, (v) => this.drawScreen(v), { tick: true });
      } else {
        await this.pourCoins(ev.gross, { bet, fast: pc.fast, onCount: (v) => this.drawScreen(v) });
      }
    } else if (ev.result === 'bust') {
      this.sfx('lightFlicker', { vol: 0.7 });
      this.commiserate({ amount: bet, at: this.parts.crt });
      if (ev.ins > 0) this.ctx.fx.popText(this.parts.crt, this.t('insured', { n: fmtCoins(ev.ins) }), CYAN, { dur: 1.2 });
      this.ctx.fx.tint(RED, 0.2, 0.6);
    } else {
      this.sfx('click', { vol: 0.7 });
    }
    this.drawScreen();
    // follow-through: hold the reveal, then the field closes and the terminal is READY again
    await this.wait(pc.fast ? 0.05 : 1.2);
    this.burnt = false;
    if (!this.disposed) this.refresh();
    if (this.isLocalOccupant) this.showHud();
  }

  // ── small presentation helpers ─────────────────────────────────────────────────────────────────
  /** Park the pooled socket under `cell`: coin (safe) or trap (mine / defused). */
  private parkSocket(cell: number, safe: boolean): void {
    const p = cellPos(cell);
    const { under, coin, trap, jawL, jawR, finger } = this.parts;
    under.position.set(p.x, -0.004, p.z);
    under.visible = true;
    coin.visible = safe;
    trap.visible = !safe;
    coin.rotation.set(0, 0, 0);
    jawL.rotation.y = 1.1;
    jawR.rotation.y = -1.1;
    finger.visible = false;
  }

  /** The bear trap snaps shut: 0.06 s, jaws meet. */
  private async snapJaws(): Promise<void> {
    const { jawL, jawR } = this.parts;
    jawL.rotation.y = 1.1;
    jawR.rotation.y = -1.1;
    await this.anim(0.06, (k) => { jawL.rotation.y = 1.1 * (1 - k); jawR.rotation.y = -1.1 * (1 - k); }, 'inQuad');
  }

  private placeSelector(): void {
    const p = cellPos(this.cursor);
    this.parts.selector.position.set(p.x, 0, p.z);
  }

  /** Put every visual in the resting pose of `this.st`. Idempotent. */
  private refresh(): void {
    const s = this.st;
    for (let i = 0; i < CELLS; i++) {
      const tile = this.parts.tiles[i];
      tile.position.y = 0;
      tile.rotation.x = s.open && ((s.revealed >> i) & 1) === 1 ? FLIP_OPEN : 0;
    }
    if (!s.open) this.parts.under.visible = false;
    this.parts.leds.credit.setOn(true);
    this.parts.leds.bet.setOn(!s.open);
    this.parts.leds.win.setOn(s.lastRes === 'cashed');
    this.parts.lamp.setOn(this.occupant !== null || s.open);
    this.parts.cashGuard.rotation.x = this.guardUp ? -1.3 : 0;
    this.placeSelector();
    this.drawScreen();
  }

  /**
   * The CRT (128 x 64 texels, text at scale 2 to 4 so it survives the ~224 p picture): mines on top, the multiplier you hold BIG,
   * and the next rung of the ladder. Stake, fair hash and the cash-out value live in the seat HUD.
   */
  private drawScreen(winShown?: number): void {
    const s = this.st;
    const m = s.open ? s.rm : s.m;
    const o = this.opts();
    this.parts.screen.draw((g, sc) => {
      g.fillStyle = SCREEN_BG;
      g.fillRect(0, 0, sc.w, sc.h);
      /** Text at the largest scale (`top` down to 1) that fits 124 texels. */
      const fitText = (str: string, y: number, color: string, top: number, align: 'left' | 'center' = 'center'): void => {
        let k2 = top;
        while (k2 > 1 && str.length * 6 * k2 - k2 > 124) k2--;
        sc.text(str, align === 'center' ? 64 : 3, y, { font: 'px5', color, align, scale: k2 });
      };
      if (this.burnt) {                                              // burn-in ghost after a mine
        g.fillStyle = '#0a2a10';
        g.fillRect(0, 0, sc.w, sc.h);
        fitText(this.t('burnt'), 26, DIM, 2);
        return;
      }
      fitText(`${this.t('sMines')} ${m}`, 2, PHOSPHOR, 2, 'left');
      g.fillStyle = '#1f5a2a'; g.fillRect(2, 18, 124, 2);
      // the big number: the multiplier you hold now (or the win while it is being paid)
      const big = winShown !== undefined
        ? `+${fmtCoins(this.isLocalOccupant ? this.ctx.run.previewCredit(winShown, this.src, { bet: this.roundBet }) : winShown)}`
        : `x${fmtMult(s.open && s.k > 0 ? s.mult : 1)}`;
      fitText(big, 21, '#ffd040', 4);
      // the next safe reveal, as "n: xM"
      const k = (s.open ? s.k : 0) + 1;
      fitText(`${k}: x${fmtMult(multAt(k, 0, m, o))}`, 51, PHOSPHOR, 2);
    });
  }

  private potential(): number {
    const s = this.st;
    return takeDust(s.stake, s.mult, s.dust).gross;
  }

  /** The key bound to a machine action, as the player sees it. */
  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** The four move keys read as one label, e.g. "WASD". */
  private moveKeys(): string { return `${this.k('up')}${this.k('left')}${this.k('down')}${this.k('right')}`; }

  private tipLines(): Txt[] {
    return [
      { k: 'm.mines.tip1' },
      { k: 'm.mines.tip2', v: { primary: this.k('primary'), move: this.moveKeys(), mines: `${this.k('n6')}/${this.k('n7')}` } },
      { k: 'm.mines.tip3', v: { cash: this.k('collect'), help: this.k('help') } },
    ];
  }

  private rulesLines(): Txt[] {
    return ['rule1', 'rule2', 'rule3', 'rule4', 'rule5', 'rule6'].map((k) => ({ k: 'm.mines.' + k }));
  }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the terminal. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const s = this.st;
    const ctrl: HudControl[] = [];
    const canCash = this.roundOpen && s.k >= 1;
    sh.goal({ k: 'm.mines.goal' });

    // STATE: arm, reveal, or cash out
    // DECISION READOUT: odds that the next tile is safe, and what a safe tile would pay on the ladder
    const pSafe = this.roundOpen ? nextSafeChance(s.k, s.defused ? 1 : 0, s.rm) : 0;
    const nextX = this.roundOpen ? multAt(s.k + 1, s.corners, s.rm, this.opts()) : 0;
    const odds: Txt = { k: 'm.mines.stOdds', v: { pct: Math.round(pSafe * 100), next: fmtMult(nextX) } };
    if (this.busy) sh.state({ k: 'm.mines.stBusy' }, 'neutral');
    else if (!this.roundOpen) sh.state({ k: 'm.mines.stArm' }, 'gold', { k: 'm.mines.stArmSub' });
    else if (!canCash) sh.state({ k: 'm.mines.stFirst' }, 'cyan', odds);
    else sh.state({ k: 'm.mines.stPlay' }, 'good', odds);

    // KEY NUMBERS: stake, mines, ladder, safe reveals, cash-out value, balance
    const nums: HudNumber[] = [];
    nums.push({ label: { k: 'm.mines.nStake' }, value: fmtCoins(this.roundOpen ? s.stake : this.bet), tone: 'gold' });
    nums.push({ label: { k: 'm.mines.nMines' }, value: String(this.roundOpen ? s.rm : s.m), tone: 'bad' });
    nums.push({ label: { k: 'm.mines.nLadder' }, value: `x${fmtMult(canCash ? s.mult : 1)}`, tone: 'cyan' });
    if (this.roundOpen) nums.push({ label: { k: 'm.mines.nSafe' }, value: String(s.k), tone: 'good' });
    if (this.roundOpen) nums.push({ label: { k: 'm.mines.nNextSafe' }, value: `${Math.round(pSafe * 100)}%`, tone: pSafe >= 0.5 ? 'good' : 'warn' });
    if (canCash) nums.push({ label: { k: 'm.mines.nWin' }, value: fmtCoins(this.potential()), tone: 'good' });
    nums.push({ label: { k: 'm.mines.nBalance' }, value: fmtCoins(this.ctx.run.wallet()), tone: 'neutral' });
    sh.numbers(nums);

    // CONTROL BAR: only what is valid right now, with the keys the terminal really reads
    if (!this.busy && !this.roundOpen) {
      ctrl.push({ key: this.k('primary'), label: { k: 'm.mines.cArm' }, action: 'primary', primary: true });
      ctrl.push({ key: this.moveKeys(), label: { k: 'm.mines.cMove' }, action: 'left' });
      ctrl.push({ key: `${this.k('n6')}/${this.k('n7')}`, label: { k: 'm.mines.cMines' }, action: 'n6' });
      ctrl.push({ key: `${this.k('n1')}-${this.k('n5')}`, label: { k: 'm.mines.cPreset' }, action: 'n1' });
      ctrl.push({ key: `${this.k('betDown')}/${this.k('betUp')}`, label: { k: 'm.mines.cBet' }, action: 'betUp' });
    } else if (!this.busy) {
      if (canCash) ctrl.push({ key: this.k('collect'), label: { k: 'm.mines.cCash' }, action: 'collect', primary: true });
      ctrl.push({ key: this.k('primary'), label: { k: 'm.mines.cReveal' }, action: 'primary', primary: !canCash });
      ctrl.push({ key: this.moveKeys(), label: { k: 'm.mines.cMove' }, action: 'left' });
      ctrl.push({ key: this.k('clear'), label: { k: 'm.mines.cRandom' }, action: 'clear' });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.mines.cRules' }, action: 'help' });
    ctrl.push({ key: this.k('exit'), label: { k: 'm.mines.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── late join / save ──────────────────────────────────────────────────────────────────────────────
  /** The layout is the owner's secret while a round is open: only the owner (or a local save) receives it. */
  getSnapshot(forPid?: number): Snap {
    const own = forPid === undefined || forPid === this.occupant;
    const sec = own && this.secret ? { seed: this.secret.seed, mask: this.secret.mask, defuse: this.secret.defuse, scan: this.secret.scan } : null;
    return { s: { ...this.st }, sec };
  }

  applySnapshot(snap: Snap): void {
    this.st = { ...snap.s };
    const sec = snap.sec;
    this.secret = sec && this.st.open ? { seed: sec.seed, mask: sec.mask, defuse: sec.defuse, scan: sec.scan, fair: this.st.fair } : null;
    if (this.st.open && this.secret) this.resumeRound(this.st.stake);
    else if (this.st.open) this.st.open = false;               // no layout to continue from: not a live round
    this.refresh();
  }
}
