/**
 * The Lords' Table (Hollow Door, the Underneath): a 1v1 revolver duel against one of three Lords. Owner: lordstable.
 *
 * Shape: `TableBase`, seat 0 = the player (+Z), seat 1 = the Lord (a bot at −Z, the chosen dealer). The host runs the pure
 * rules in `rules.ts`; every peer `present()`s the public events. Nothing stakes coins: the duel's currency is Tickets (a
 * spin costs one; the budget is the run's Tickets when the duel opens) and its stake is the run itself. Run effects go
 * to `lordsHooks.apply` (host only) once, at the end, as a `LordsEnd`; the integrator turns it into run effects with
 * `effectsOf` and `applyEffects` in `src/game/hollow/rules.ts`.
 *
 * Phases on the host: pick (choose a Lord; leaving here ends the door without a duel) → pause → play (the player's turn;
 * 20 s, then an automatic pull) → lordCall (Mirrors announces a spin and opens a 2.4 s CHEAT window; other Lords pull after
 * 1.4 s) → pause … → done. A duel ends at the first bullet, at a correct CHEAT call, or when the player walks away
 * mid-duel (taken).
 *
 * Controls (seated): 1–3 or ←/→ + Space pick a Lord · Space/E pull at yourself · R spin for one Ticket · C call CHEAT ·
 * Q / Esc leave (only before the duel) · H rules.
 */
import type { PlayerId } from '@/core/types';
import { isBot } from '@/core/types';
import { log } from '@/core/log';
import type { MachineAction, MachineInputEvent } from '@/core/input/types';
import { TableBase } from '@/machines/_base/TableBase';
import { SeatHud, type HudControl, type HudNumber, type Txt } from '@/machines/_base/seatHud';
import type { MachineDef, MachineModel, PresentCtx } from '@/machines/_base/types';
import type { Kit } from '@/kit/types';
import * as manga from '@/core/ui/manga';
import type { LordId } from '@/game/hollow/rules';
import { buildModel, CHAMBER_STEP, LORD_X, type LordsParts } from './model';
import * as R from './rules';
import { STRINGS } from './strings';

const LORDS: readonly LordId[] = R.LORDS;

// ── contract types (aliases, not interfaces: they must be assignable to `Json`) ───────────────────
type Ev =
  | { k: 'pick'; lord: LordId }
  | { k: 'start'; lord: LordId; tickets: number }
  | { k: 'turn'; seat: number; owed: number }
  | { k: 'spin'; seat: number; clicks: number; reflect: boolean; chamber: number }
  | { k: 'pull'; seat: number; fired: boolean; chamber: number }
  | { k: 'call'; correct: boolean; cheat: boolean }
  | { k: 'over'; lord: LordId | null; outcome: 'won' | 'taken' | 'left'; by: 'fire' | 'call' | 'leave'; calledCorrect: boolean; spent: number };

/** How a duel ended, for the run side. `effectsOf(ended, lord, calledCorrect)` turns it into run effects. */
export interface LordsEnd { lord: LordId | null; ended: 'won' | 'taken' | 'left'; calledCorrect: boolean; /** Tickets the duel spent on re-spins: the run deducts them. */ spent?: number }
type Act = { k: 'pick'; lord: LordId } | { k: 'pull' } | { k: 'spin' } | { k: 'call' };
type Snap = null;

/** Run hooks for the integrator (set once at boot). `apply` receives the duel's end on the host, exactly once. */
export const lordsHooks: {
  apply: ((end: LordsEnd) => void) | null;
  /** Tickets the player brings to the duel (default: the run's Ticket balance). */
  tickets: ((pid: PlayerId) => number) | null;
} = { apply: null, tickets: null };

const PAUSE = { start: 2.4, pull: 1.0, fire: 2.0, call: 0.9, end: 3.2 };
const CALL_S = 2.4, THINK_S = 1.4, TURN_S = 20, CALL_AFTER_S = 0.8;
const PLAYER_SEAT = 0;
const GUARD_S = 9;

export const def: MachineDef = {
  id: 'lordstable',
  category: 'duel',
  slotSize: 'L',
  zone: 'parlour',
  seats: 2,
  shared: true,
  minBet: 0, maxBet: 0,
  maxPayoutMult: 1.5,
  tier: 99,                       // never placed on the floor: the Hollow Door opens it
  actionCost: 1,
  tags: ['duel', 'table', 'hollow', 'lords'],
  strings: STRINGS,
};

const freshView = () => ({
  picking: true, inDuel: false, lord: null as LordId | null, turn: -1, owed: 0, tickets: 0,
  lordCall: false, announced: false, over: null as null | 'won' | 'taken' | 'left',
});

interface Host {
  phase: 'pick' | 'pause' | 'play' | 'lordCall' | 'done';
  timer: number;
  game: R.Game | null;
  lord: LordId | null;
  pid: PlayerId | null;
  tickets: number;
  spent: number;
  turnLeft: number;
  lordLeft: number;
  announced: boolean;
  after: 'play' | 'lord' | 'done';
}
const freshHost = (): Host => ({
  phase: 'pick', timer: 0, game: null, lord: null, pid: null, tickets: 0, spent: 0,
  turnLeft: 0, lordLeft: 0, announced: false, after: 'play',
});

const RIVAL = (id: LordId): string => `lord_${id}`;
const LINE_PICK: Record<LordId, string> = { ash: 'line_pickAsh', ledgers: 'line_pickLedgers', mirrors: 'line_pickMirrors' };

export default class LordsTable extends TableBase<LordsParts, Ev, Snap, Act> {
  private view = freshView();
  private host: Host = freshHost();
  private seatHud?: SeatHud;
  /** Cursor on the pick card (0..2). */
  private cursor = 0;
  /** Public clues of the Lord's last announced spin, for the reveal. */
  private lastSpin: { clicks: number; reflect: boolean } | null = null;
  /** The black cut in place after a fire; removed by the end card. */
  private blackoutDone: (() => void) | null = null;

  protected createModel(kit: Kit): MachineModel<LordsParts> { return buildModel(kit, this.modelOpts); }

  init(): void {
    this.seatHud = new SeatHud(this.ctx.ui.root);
    this.hud(null);
    this.lordStep(-1);
  }

  dispose(): void {
    this.seatHud?.dispose();
    this.blackoutDone?.();
    super.dispose();
  }

  // ── local input → action to the host ─────────────────────────────────────────────────────────
  onInput(e: MachineInputEvent): void {
    const a = e.action;
    if (!e.down) return;
    if (this.seatHud?.blocking) { this.seatHud.dismiss(); return; }
    if (a === 'help' && !e.repeat) { this.seatHud?.rules(this.rulesLines()); return; }
    if (e.repeat) return;
    const v = this.view;
    if (this.localSeat !== PLAYER_SEAT) return;
    if (v.picking) {
      if (a === 'left') { this.moveCursor(-1); return; }
      if (a === 'right') { this.moveCursor(1); return; }
      if (a === 'n1' || a === 'n2' || a === 'n3') { this.cursor = Number(a.slice(1)) - 1; this.act({ k: 'pick', lord: LORDS[this.cursor] }); return; }
      if (a === 'primary' || a === 'confirm') { this.act({ k: 'pick', lord: LORDS[this.cursor] }); return; }
      return;
    }
    if (!v.inDuel || v.over) return;
    switch (a) {
      case 'primary': case 'confirm':
        if (v.turn === PLAYER_SEAT) this.act({ k: 'pull' });
        break;
      case 'double':
        if (v.turn === PLAYER_SEAT) this.act({ k: 'spin' });
        break;
      case 'alt':
        if (v.lordCall && v.announced) this.act({ k: 'call' });
        break;
    }
  }

  private moveCursor(d: 1 | -1): void {
    this.cursor = (this.cursor + d + LORDS.length) % LORDS.length;
    this.lordStep(this.cursor);
    this.sfx('click', { vol: 0.5 });
    this.showHud();
  }

  // ── HOST: actions ────────────────────────────────────────────────────────────────────────────
  protected onAction(pid: PlayerId, seat: number, a: Act, rid: number): void {
    const h = this.host;
    if (isBot(pid) || seat !== PLAYER_SEAT) { this.nak(pid, rid, 'm.lordstable.notYourTurn'); return; }
    switch (a.k) {
      case 'pick': {
        if (h.phase !== 'pick') { this.nak(pid, rid, 'm.lordstable.busy'); return; }
        if (!LORDS.includes(a.lord)) { this.nak(pid, rid, 'm.lordstable.badPick'); return; }
        const tickets = Math.max(0, lordsHooks.tickets?.(pid) ?? this.ctx.run.balance('ticket', pid));
        h.lord = a.lord;
        h.pid = pid;
        h.tickets = tickets;
        h.spent = 0;
        h.game = R.newGame(a.lord, this.hostRng, tickets);
        this.flush([]);
        void this.emit({ k: 'pick', lord: a.lord });
        void this.emit({ k: 'start', lord: a.lord, tickets });
        h.phase = 'pause'; h.timer = PAUSE.start; h.after = 'play';
        return;
      }
      case 'pull': {
        const g = h.game;
        if (h.phase !== 'play' || !g || g.turn !== PLAYER_SEAT) { this.nak(pid, rid, 'm.lordstable.notYourTurn'); return; }
        const ev = R.playerPull(g);
        if (!ev) { this.nak(pid, rid, 'm.lordstable.illegal'); return; }
        this.flush(ev);
        this.afterShot();
        return;
      }
      case 'spin': {
        const g = h.game;
        if (h.phase !== 'play' || !g || g.turn !== PLAYER_SEAT) { this.nak(pid, rid, 'm.lordstable.notYourTurn'); return; }
        if (g.tickets < R.SPIN_TICKETS) { this.nak(pid, rid, 'm.lordstable.noTickets'); return; }
        const ev = R.respin(g, this.hostRng);
        if (!ev) { this.nak(pid, rid, 'm.lordstable.illegal'); return; }
        h.spent += R.SPIN_TICKETS;
        this.flush(ev);
        return;
      }
      case 'call': {
        const g = h.game;
        if (h.phase !== 'lordCall' || !g || !h.announced) { this.nak(pid, rid, 'm.lordstable.noCall'); return; }
        const ev = R.call(g);
        if (!ev) { this.nak(pid, rid, 'm.lordstable.noCall'); return; }
        this.flush(ev);
        h.announced = false;
        if (g.over) { this.finish(g.over.outcome === 'won' ? 'won' : 'taken', g.over.by, g.over.calledCorrect); return; }
        h.lordLeft = Math.min(h.lordLeft, CALL_AFTER_S);
        return;
      }
    }
  }

  /** After the player's pull: the duel is over, or the table pauses to show the shot and the turn passes on. */
  private afterShot(): void {
    const h = this.host, g = h.game!;
    if (g.over) { this.finish(g.over.outcome === 'won' ? 'won' : 'taken', g.over.by, false); return; }
    h.phase = 'pause'; h.timer = PAUSE.pull; h.after = g.turn === PLAYER_SEAT ? 'play' : 'lord';
  }

  /** Rules events → public events (the cylinder position is public: the bullets are not). */
  private flush(evs: R.Ev[]): void {
    const g = this.host.game;
    for (const e of evs) {
      const chamber = g ? g.hammer : 0;
      switch (e.k) {
        case 'turn': void this.emit({ k: 'turn', seat: e.seat, owed: e.owed }); break;
        case 'spin': void this.emit({ k: 'spin', seat: e.seat, clicks: e.clicks, reflect: e.reflect, chamber }); break;
        case 'pull': void this.emit({ k: 'pull', seat: e.seat, fired: e.fired, chamber: e.chamber }); break;
        case 'call': void this.emit({ k: 'call', correct: e.correct, cheat: e.cheat }); break;
        case 'over': break;                 // the host ends the duel itself (see `finish`)
      }
    }
  }

  /**
   * The duel ends. The run effects go to `lordsHooks.apply` once (host only), then the table announces the outcome and
   * waits out the presentation before it goes done. A duel that ends by a fire is 'won' (the Lord) or 'taken' (the player).
   */
  private finish(outcome: 'won' | 'taken', by: 'fire' | 'call' | 'leave', calledCorrect: boolean): void {
    const h = this.host;
    const lord = h.lord;
    const ended = outcome === 'won' ? 'won' : 'taken';
    try { lordsHooks.apply?.({ lord, ended, calledCorrect, spent: h.spent }); } catch (err) { log.error('lordstable', 'run hooks failed', err); }
    void this.emit({ k: 'over', lord, outcome, by, calledCorrect, spent: h.spent });
    h.phase = 'pause'; h.timer = PAUSE.end; h.after = 'done';
  }

  /** Leaving: before the duel the door closes with no effects; mid-duel the Lord takes you. */
  onRelease(pid: PlayerId, seat: number, local: boolean): void {
    if (this.isHost && !isBot(pid) && seat === PLAYER_SEAT) {
      const h = this.host;
      if (h.phase === 'pick') {
        void this.emit({ k: 'over', lord: null, outcome: 'left', by: 'leave', calledCorrect: false, spent: 0 });
        lordsHooks.apply?.({ lord: null, ended: 'left', calledCorrect: false });
        h.phase = 'done';
      } else if (h.phase !== 'done' && h.game && !h.game.over) {
        this.finish('taken', 'leave', false);
      }
    }
    if (local) {
      this.hud(null);
      this.seatHud?.hide();
    }
  }

  onOccupy(_pid: PlayerId, _seat: number, local: boolean): void {
    if (local) {
      this.sfx('chime');
      this.seatHud?.show();
      this.showHud();
      this.seatHud?.firstTip('lordstable', this.tipLines());
    }
  }

  onLang(): void { if (this.isLocalOccupant) this.showHud(); }

  // ── host clock ──────────────────────────────────────────────────────────────────────────────
  hostTick(dt: number): void {
    const h = this.host;
    switch (h.phase) {
      case 'pause':
        if ((h.timer -= dt) <= 0) this.afterPause();
        break;
      case 'play':
        if ((h.turnLeft -= dt) <= 0 && h.game) {          // out of time: he pulls at himself
          const ev = R.playerPull(h.game);
          if (ev) { this.flush(ev); this.afterShot(); }
        }
        break;
      case 'lordCall':
        if ((h.lordLeft -= dt) <= 0) this.lordPull();
        break;
    }
  }

  private afterPause(): void {
    const h = this.host, g = h.game;
    if (h.after === 'done' || !g) { h.phase = 'done'; return; }
    if (g.over) { this.finish(g.over.outcome === 'won' ? 'won' : 'taken', g.over.by, g.over.calledCorrect); return; }
    if (g.turn === PLAYER_SEAT) {
      h.phase = 'play'; h.turnLeft = TURN_S;
      return;
    }
    // the Lord's turn: an announcing Lord opens the CHEAT window; the others just take their time
    const ev = R.lordTurn(g, this.hostRng);
    if (ev.length) {
      this.flush(ev);
      h.announced = true;
      h.lordLeft = CALL_S;
    } else {
      h.announced = false;
      h.lordLeft = THINK_S;
    }
    h.phase = 'lordCall';
  }

  private lordPull(): void {
    const h = this.host, g = h.game!;
    h.announced = false;
    const ev = R.lordPull(g);
    if (!ev) return;
    this.flush(ev);
    if (g.over) { this.finish(g.over.outcome === 'won' ? 'won' : 'taken', g.over.by, false); return; }
    h.phase = 'pause'; h.timer = PAUSE.pull; h.after = g.turn === PLAYER_SEAT ? 'play' : 'lord';
  }

  // ── presentation (every peer, including the host) ─────────────────────────────────────────────
  async present(ev: Ev, pc: PresentCtx): Promise<void> {
    const v = this.view;
    const local = this.localSeat === PLAYER_SEAT;
    switch (ev.k) {
      case 'pick': {
        v.picking = false;
        this.lordStep(LORDS.indexOf(ev.lord));
        this.sfx('creak', { vol: 0.6 });
        if (!pc.fast) await this.guard(manga.cutin(RIVAL(ev.lord), 'calm', `m.lordstable.${LINE_PICK[ev.lord]}`));
        this.paintScreen();
        this.showHud();
        return;
      }
      case 'start':
        v.lord = ev.lord; v.inDuel = true; v.tickets = ev.tickets; v.turn = -1;
        this.sfx('stinger', { vol: 0.6 });
        if (!pc.fast) await this.guard(manga.dialogue(RIVAL(ev.lord), 'm.lordstable.line_start', 'right', 'calm'));
        this.showHud();
        return;
      case 'turn':
        v.turn = ev.seat; v.owed = ev.owed; v.lordCall = ev.seat !== PLAYER_SEAT;
        if (ev.seat === PLAYER_SEAT) v.announced = false;
        if (ev.seat === PLAYER_SEAT && local) this.sfx('chime', { vol: 0.5 });
        this.paintScreen();
        this.showHud();
        return;
      case 'spin': {
        this.lastSpin = { clicks: ev.clicks, reflect: ev.reflect };
        this.sfx('ratchet', { vol: 0.8 });
        this.turnCylinder(ev.chamber, pc);
        if (ev.seat !== PLAYER_SEAT) {
          const cheat = ev.clicks === 0;
          if (!pc.fast) void this.guard(manga.dialogue(RIVAL(v.lord ?? 'mirrors'), 'm.lordstable.line_spinMirror', 'right', cheat ? 'smirk' : 'calm'), 4);
          this.toast(ev.clicks === 0 ? this.t('clueTell') : this.t('clueTellOn', { n: ev.clicks }), 'info');
          v.announced = true; v.lordCall = true;
          this.showHud();
        } else {
          this.toast(this.t('spinWord'), 'info');
        }
        this.paintScreen();
        return;
      }
      case 'pull': {
        if (!pc.fast) await this.heartbeat();
        this.pullHammer(pc);
        if (ev.fired) {                       // a fire cuts to black; the bell and the end card come with `over`
          this.sfx('gunShot', { vol: 1.1 });
          this.endBlackout();
          this.blackoutDone = this.cut();
          if (!pc.fast) await this.wait(1.2);
          return;
        }
        this.sfx('gunClick', { vol: 1.4 });
        this.turnCylinder(ev.chamber, pc);
        this.paintScreen();
        if (ev.seat !== PLAYER_SEAT) {
          const d = this.parts.lords[LORDS.indexOf(v.lord ?? 'ash')];
          if (d && !pc.fast) void d.gesture('point');
        }
        return;
      }
      case 'call': {
        v.announced = false; v.lordCall = false;
        this.sfx(ev.correct ? 'win2' : 'lose', { vol: 0.7 });
        this.toast(ev.correct ? this.t('callRight') : this.t('callWrong'), ev.correct ? 'good' : 'warn');
        if (!pc.fast && local) await this.guard(this.revealCall(ev.correct, ev.cheat), GUARD_S);
        this.showHud();
        return;
      }
      case 'over': {
        v.over = ev.outcome; v.inDuel = false; v.picking = false;
        if (ev.outcome === 'left') {
          this.sfx('click', { vol: 0.6 });
          if (local) this.toast(this.t('leftTitle'), 'info');
          this.showHud();
          return;
        }
        const taken = ev.outcome === 'taken';
        this.seatHud?.result(taken ? 'lose' : 'win', 0, 3.2, this.t(taken ? 'takenTitle' : 'wonTitle'));
        if (ev.by === 'fire') {
          if (!pc.fast) await this.wait(0.6);
          this.sfx('bell', { vol: 1 });
          if (!pc.fast && ev.lord) void this.guard(manga.cutin(RIVAL(ev.lord), taken ? 'hollow' : 'smirk', taken ? 'm.lordstable.line_youFire' : 'm.lordstable.line_lordFires'), 8);
          if (!pc.fast) await this.wait(1.4);
          this.endBlackout();
        } else if (!taken) {
          this.sfx('win3', { vol: 0.9 });
        }
        this.showHud();
        return;
      }
    }
  }

  // ── presentation helpers ────────────────────────────────────────────────────────────────────
  private async heartbeat(): Promise<void> {
    for (const gap of [0.9, 0.6, 0.35]) {
      this.sfx('heartbeat', { vol: 0.5 });
      await this.wait(gap);
    }
  }

  /** The hammer cocks and falls back on a pull. */
  private pullHammer(pc: PresentCtx): void {
    if (pc.fast) return;
    const hm = this.parts.hammer;
    void this.anim(0.12, (k) => { hm.rotation.x = -0.6 * k; }).then(() => this.anim(0.1, (k) => { hm.rotation.x = -0.6 * (1 - k); }));
  }

  private turnCylinder(chamber: number, pc: PresentCtx): void {
    const cy = this.parts.cylinder;
    const to = chamber * CHAMBER_STEP;
    if (pc.fast) { cy.rotation.z = to; return; }
    const from = cy.rotation.z;
    const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    void this.anim(0.35, (k) => { cy.rotation.z = from + d * k; });
  }

  /** Stands the chosen Lord forward and the others back. `idx` −1 resets them all. */
  private lordStep(idx: number): void {
    LORD_X.forEach((_x, i) => {
      const root = this.parts.lords[i].root;
      root.position.z = i === idx ? -0.62 : -0.8;
    });
  }

  private paintScreen(): void {
    const v = this.view;
    this.parts.screen.draw((g, s) => {
      g.fillStyle = '#080404'; g.fillRect(0, 0, s.w, s.h);
      g.fillStyle = '#d9b24a'; g.font = '20px monospace';
      g.fillText(`${this.t('nTickets')} ${v.tickets}`, 10, 34);
      g.fillText(`${this.t('nBullets')} ${v.lord ? bulletsOf(v.lord) : 0}/6`, 10, 70);
      g.fillStyle = v.turn === PLAYER_SEAT ? '#7fffa0' : '#ff9a9a';
      g.fillText(v.over ? this.t('stDone') : v.lordCall ? this.t('stLord') : this.t('stYou'), 10, 104);
    });
  }

  /** A black cut over the table (a fade, never a flash). Returns the lift. */
  private cut(): () => void {
    if (typeof document === 'undefined') return () => {};
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .6s ease;z-index:60;pointer-events:none';
    this.ctx.ui.root.appendChild(el);
    void el.offsetWidth;
    el.style.opacity = '1';
    return () => { el.style.opacity = '0'; void this.wait(0.7).then(() => el.remove()); };
  }

  private endBlackout(): void {
    const off = this.blackoutDone;
    this.blackoutDone = null;
    off?.();
  }

  /** The reveal for a CHEAT call: the public clues, as the reveal shows them. */
  private revealCall(correct: boolean, cheat: boolean): Promise<void> {
    const s = this.lastSpin ?? { clicks: 0, reflect: false };
    const clues: manga.MangaClue[] = [
      { channel: 'tell', round: 1, key: s.clicks === 0 ? 'm.lordstable.clueTell' : 'm.lordstable.clueTellOn', data: { n: s.clicks } },
      { channel: 'table', round: 1, key: s.reflect ? 'm.lordstable.clueTableOn' : 'm.lordstable.clueTable' },
      { channel: 'math', round: 1, key: 'm.lordstable.clueMath', data: { n: s.clicks } },
    ];
    const script = correct
      ? { saw: 'm.lordstable.revealSaw', happened: 'm.lordstable.revealHappened', why: 'm.lordstable.revealWhy' }
      : { saw: 'm.lordstable.revealFairSaw', happened: 'm.lordstable.revealFairHappened', why: 'm.lordstable.revealFairWhy' };
    return manga.reveal(script, clues, cheat ? 'CHEAT' : 'FAIR'); // i18n-ok: the reveal's verdict keyword, drawn by the manga layer
  }

  /** Waits for a presentation but never longer than `sec` (a skipped or stuck cut-in must not stall the table). */
  private async guard(p: Promise<unknown> | undefined, sec = GUARD_S): Promise<void> {
    if (!p) return;
    await Promise.race([p.then((): void => undefined), this.wait(sec)]);
  }

  // ── HUD ─────────────────────────────────────────────────────────────────────────────────────
  private tipLines(): Txt[] {
    return [
      { k: 'm.lordstable.tip1', v: { pull: this.k('primary') } },
      { k: 'm.lordstable.tip2' },
      { k: 'm.lordstable.tip3', v: { call: this.k('alt') } },
    ];
  }

  private rulesLines(): Txt[] {
    return [
      { k: 'm.lordstable.rule1' }, { k: 'm.lordstable.rule2' }, { k: 'm.lordstable.rule3' },
      { k: 'm.lordstable.rule4' }, { k: 'm.lordstable.rule5' },
    ];
  }

  private k(a: MachineAction): string { return this.ctx.input.keyLabel(`m.${a}`); }

  /** Banner, key numbers and the controls valid right now. Only while the local player sits at the table. */
  private showHud(): void {
    const sh = this.seatHud;
    if (!sh || !this.isLocalOccupant) return;
    const v = this.view;
    const ctrl: HudControl[] = [];
    sh.goal({ k: 'm.lordstable.goal' });
    if (v.picking) {
      sh.state({ k: 'm.lordstable.stPick' }, 'gold', { k: 'm.lordstable.stPickSub' });
    } else if (v.over) {
      sh.state({ k: 'm.lordstable.stDone' }, 'neutral');
    } else if (v.lordCall) {
      sh.state({ k: v.announced ? 'm.lordstable.stSpin' : 'm.lordstable.stLord' }, 'cyan',
        v.announced ? { k: 'm.lordstable.stSpinSub', v: { call: this.k('alt') } } : { k: 'm.lordstable.stLordSub' });
    } else if (v.owed > 0) {
      sh.state({ k: 'm.lordstable.stOwed' }, 'bad', { k: 'm.lordstable.stOwedSub' });
    } else {
      sh.state({ k: 'm.lordstable.stYou' }, 'good', { k: 'm.lordstable.stYouSub', v: { pull: this.k('primary'), spin: this.k('double') } });
    }
    const nums: HudNumber[] = [];
    if (v.inDuel) nums.push({ label: { k: 'm.lordstable.nTickets' }, value: String(v.tickets), tone: v.tickets > 0 ? 'good' : 'bad' });
    if (v.lord) nums.push({ label: { k: 'm.lordstable.nBullets' }, value: { k: 'm.lordstable.nBulletsVal', v: { n: bulletsOf(v.lord) } }, tone: 'warn' });
    sh.numbers(nums);
    if (v.picking) {
      ctrl.push({ key: `${this.k('left')}/${this.k('right')}`, label: { k: 'm.lordstable.cPick' }, action: 'left' });
      ctrl.push({ key: this.k('primary'), label: { k: 'm.lordstable.cPick' }, action: 'primary', primary: true });
    } else if (v.inDuel && !v.over) {
      if (v.turn === PLAYER_SEAT) {
        ctrl.push({ key: this.k('primary'), label: { k: 'm.lordstable.cPull' }, action: 'primary', primary: true });
        if (v.tickets > 0) ctrl.push({ key: this.k('double'), label: { k: 'm.lordstable.cSpin' }, action: 'double' });
      }
      if (v.lordCall && v.announced) ctrl.push({ key: this.k('alt'), label: { k: 'm.lordstable.cCall' }, action: 'alt', primary: true });
    }
    ctrl.push({ key: this.k('help'), label: { k: 'm.lordstable.cRules' }, action: 'help' });
    if (!v.inDuel || v.over) ctrl.push({ key: this.k('exit'), label: { k: 'm.lordstable.cLeave' }, action: 'exit' });
    sh.controls(ctrl);
  }

  // ── late join ───────────────────────────────────────────────────────────────────────────────
  getSnapshot(): Snap { return null; }
  applySnapshot(): void {}
}

/** Bullets per Lord, as the table shows them (`n in 6`). */
function bulletsOf(id: LordId): number { return R.LORD_SPEC[id].bullets; }
