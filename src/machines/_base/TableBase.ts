/**
 * TableBase (base-machines WP) — host-resolved shared tables, 2–8 seats, mannequin bots. Contract: TECH_SPEC §3.4
 * + BRIEF ADDENDA 6/7 (party games, hidden information).
 *
 * Flow: seated client → `act(a)` → `tact` message → host `onAction` → host `chargeSeat` / `emit({k:'chip',…})`
 * → all peers `present`. In single player the host IS the local player: `act` is delivered synchronously on the
 * next fixed step. Round phases (betting 15 s → dealing → decisions 20 s/seat → payout 3 s) live in `hostTick`
 * and are announced via events. Leaving mid-round forfeits that seat's stakes; the hand is auto-played/folded
 * by the host. `busy` is not used by tables (release never blocks).
 *
 * Hidden information (cards, tiles, shells): the host keeps the truth in its own fields, publishes REDACTED
 * public events with `emit` (`{k:'deal', seat, n:2}`) and sends each player their secrets with `emitPrivate`.
 * Late joiners get per-recipient `getSnapshot(forPid)`; a table must never leak other seats' hands there.
 *
 * Bots: `addBot(seat, name)` seats a mannequin with id `botId(seat)` (negative). Bots have no wallet — they play
 * with house chips (`chargeSeat/paySeat` succeed for them without touching `run`). Bot AI runs in host code only.
 */
import type { Json, PlayerId } from '@/core/types';
import { botId, isBot } from '@/core/types';
import { createRng, hashSeed, type Rng } from '@/core/rng';
import { log } from '@/core/log';
import { juiceTier, tierTags, toWinTier } from './tiers';
import type { MachineContext, MachineEvent } from './types';
import { MachineBase } from './MachineBase';
import type { ModHook, WinMeta } from '@/game/types';
import { t as tr } from '@/core/i18n';

export interface TableBot { seat: number; name: string; rng: Rng; level: number }
interface QueuedAct { pid: PlayerId; seat: number; a: Json; rid: number }

export abstract class TableBase<P extends object, E extends MachineEvent, S extends Json, A extends Json>
  extends MachineBase<P, E, S> {
  readonly bots: TableBot[] = [];
  private _rid = 0;
  private _acts: QueuedAct[] = [];
  private _seatBet: number[] = [];
  private _cdStop: (() => void) | null = null;

  constructor(ctx: MachineContext) {
    super(ctx);
    this._seatBet = new Array<number>(ctx.def.seats).fill(0);
  }

  // ── client side ──
  /** Any peer: the local seated player sends an action to the host (SP: delivered synchronously next step). */
  protected act(a: A): void {
    const seat = this.localSeat;
    if (seat < 0) return;
    const rid = ++this._rid;
    if (this.isHost) this._acts.push({ pid: this.selfId, seat, a, rid });
    else this.ctx.net.sendAction(this.id, seat, rid, a);
  }

  // ── host side ──
  /** HOST ONLY: validate + resolve; call `this.emit(...)` with results; reject with `nak()`. */
  protected abstract onAction(pid: PlayerId, seat: number, a: A, rid: number): void;

  /** Session → table: a `tact` arrived from `pid`. */
  _receiveAction(pid: PlayerId, seat: number, rid: number, a: Json): void {
    if (!this.isHost) return;
    if (this.seats[seat] !== pid) { this.nak(pid, rid, 'common.notSeated'); return; }
    this._acts.push({ pid, seat, a, rid });
  }

  /** Client gets `toast(t(reasonKey))`. */
  protected nak(pid: PlayerId, rid: number, reasonKey: string): void {
    if (pid === this.selfId) this.ctx.ui.toast(tr(reasonKey), 'warn');
    else if (!isBot(pid)) this.ctx.net.sendNak(pid, this.id, rid, reasonKey);
  }
  protected seatOf(pid: PlayerId): number { return this.seats.indexOf(pid); }
  protected seated(): Array<{ seat: number; pid: PlayerId }> {
    const out: Array<{ seat: number; pid: PlayerId }> = [];
    this.seats.forEach((pid, seat) => { if (pid !== null) out.push({ seat, pid }); });
    return out;
  }
  /**
   * Host: stake `amount` for the seat's player (`run.hostBet`); bots always succeed.
   * `pid` defaults to the seat's current occupant — inside `onRelease` the seat is already empty, so pass the `pid` you got.
   */
  protected chargeSeat(seat: number, amount: number, pid: PlayerId | null = this.seats[seat]): boolean {
    if (pid === null || pid === undefined) return false;
    const ok = isBot(pid) ? true : this.ctx.run.hostBet(pid, amount, this.src);
    if (ok) this._seatBet[seat] += amount;
    return ok;
  }
  /**
   * Host: pay `gross` to the seat's player (`run.hostWin`); resets the seat's staked total. Returns credited.
   * `pid` as in {@link chargeSeat} (refund a leaver from `onRelease`).
   */
  protected paySeat(seat: number, gross: number, meta?: Partial<WinMeta>, pid: PlayerId | null = this.seats[seat]): number {
    const bet = meta?.bet ?? this._seatBet[seat];
    this._seatBet[seat] = 0;
    if (pid === null || pid === undefined || isBot(pid)) return 0;
    const jt = juiceTier(gross, bet, meta?.tags);
    const tags = [...new Set([...(meta?.tags ?? []), ...tierTags(jt)])];
    const credited = this.ctx.run.hostWin(pid, gross, this.src, { bet, tier: meta?.tier ?? toWinTier(jt), tags, silent: meta?.silent });
    if (pid === this.selfId) this.offerGamble(credited);       // DOUBLE OR NOTHING for the local player's table win
    return credited;
  }
  /** Table-family hook (`x.table.<name>`: limitMult, freeChip, rakeDelta, peekCharges, timerMult, pushToWin, shoeInfo). */
  protected tableMod(name: string, base: number): number { return this.mod(`x.table.${name}` as ModHook, base); }
  /** Total the seat has staked since the last `paySeat` (for sizing payouts). */
  protected staked(seat: number): number { return this._seatBet[seat]; }
  /** Forget a seat's stakes without paying (forfeit when leaving mid-round). */
  protected forfeit(seat: number): void { this._seatBet[seat] = 0; }

  /**
   * Host: starts the shared countdown (every peer sees `timerLeft` / `timerState`, late joiners get it in the snapshot);
   * resolves when it elapses — or immediately when `cancelCountdown()` / a newer `countdown()` supersedes it.
   * Phase logic should drive itself from `hostTick` and use this for the visible ring; the returned promise is optional.
   */
  protected countdown(sec: number, label: string): Promise<void> {
    this._cdStop?.();
    const until = this.ctx.net.hostTime() + sec * 1000;
    void this.emit({ k: '_timer', until, label } as unknown as E);
    return new Promise<void>((resolve) => {
      const cancel = this.ctx.timers.after(sec, () => this.endCountdown());
      this._cdStop = () => { cancel(); this._cdStop = null; resolve(); };
    });
  }
  /** Host: remove the visible countdown now (the round was decided early). No-op when none is running. */
  protected cancelCountdown(): void { this.endCountdown(); }
  private endCountdown(): void {
    const stop = this._cdStop;
    if (!stop) return;
    stop();
    void this.emit({ k: '_timerEnd' } as unknown as E);
  }

  // ── bots ──
  /** Host: seat a mannequin bot (level 1–3) and tell everyone. */
  addBot(seat: number, name: string, level: 1 | 2 | 3 = 2): void {
    if (!this.isHost || this.seats[seat] !== null) return;
    this._seatBotLocal(seat, name, level);
    this.ctx.net.announceBot(this.id, seat, name, level);
  }
  removeBot(seat: number): void {
    if (!this.isHost || this.seats[seat] === null || !isBot(this.seats[seat]!)) return;
    this._unseatBotLocal(seat);
    this.ctx.net.announceBot(this.id, seat, null);
  }
  /** Session → table: a remote `mbot` message (clients only need the name/seat for visuals). */
  _setBot(seat: number, name: string | null, level = 2): void {
    if (name === null) this._unseatBotLocal(seat); else this._seatBotLocal(seat, name, level);
  }
  private _seatBotLocal(seat: number, name: string, level: number): void {
    const dup = this.bots.findIndex((b) => b.seat === seat);
    if (dup >= 0) this.bots.splice(dup, 1);           // replayed `mbot`: never run two AIs on one seat
    this.seats[seat] = botId(seat);
    this.bots.push({ seat, name, level, rng: createRng(hashSeed(this.ctx.runSeed, this.id, 'bot', seat)) });
    this.onOccupy(botId(seat), seat, false);
  }
  private _unseatBotLocal(seat: number): void {
    const pid = this.seats[seat];
    this.seats[seat] = null;
    const i = this.bots.findIndex((b) => b.seat === seat);
    if (i >= 0) this.bots.splice(i, 1);
    if (pid !== null) this.onRelease(pid, seat, false);
  }
  /** Seats that currently hold a human (not a bot). */
  protected humans(): Array<{ seat: number; pid: PlayerId }> { return this.seated().filter((s) => !isBot(s.pid)); }

  /**
   * Leaving mid-round forfeits the seat's stakes (TECH §3.4). The subclass `onRelease` still runs first so it can
   * auto-fold / auto-stand using `staked(seat)`; only then is the stake written off.
   */
  override _release(pid: PlayerId, seat: number, local: boolean): void {
    super._release(pid, seat, local);
    if (this.isHost) this.forfeit(seat);
  }

  /** Drain queued actions once per fixed step, before the subclass `hostTick`. */
  override _step(dt: number): void {
    if (this._acts.length && this.isHost) {
      const q = this._acts; this._acts = [];
      for (const { pid, seat, a, rid } of q) {
        try { this.onAction(pid, seat, a as A, rid); } catch (e) { log.error('table', this.id, e); this.nak(pid, rid, 'common.actionFailed'); }
      }
    }
    super._step(dt);
  }
}
