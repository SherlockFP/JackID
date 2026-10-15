/**
 * Per-Watch floor events (wave 43, director: decisions and moments in every Watch). Each Watch from Night 1 rolls one short
 * event with a seeded chance (`WATCH_EVENT_CHANCE`, data/schedule.ts), lasting 45-60 s of Watch clock. Boss Nights roll none.
 *
 * Pure rules + one ModProvider: the effects are declarative ModEffects folded by the run's mod pipeline (no machine code).
 * Announcements go out on the existing bus as `event:start` / `event:end` with id `watch.<id>`, so the event banner and feed
 * line are the nightly-event ones; strings live in `watchEvents.strings.ts` under `event.watch.<id>.*`.
 *
 * Run wiring (lane 1): see the report. Order matters: `begin` before `startWatch` (x.run.pullsAdd is read there), `tick` with the
 * Watch clock dt, `onPull` after each resolved pull, `end` at Settle. No DOM, no three.
 */
import { bus } from '@/core/events';
import type { Rng } from '@/core/rng';
import type { InstanceId } from '@/core/types';
import type { ModEffect, ModProvider, ModQuery, ModSource, ModSourceKind } from '@/game/modifiers.types';
import { WATCH_EVENT_CHANCE } from './data/schedule';

/** Length of a Watch event, Watch-clock seconds (seeded, inclusive). */
export const WATCH_EVENT_MIN_S = 45;
export const WATCH_EVENT_MAX_S = 60;

export interface WatchEventDef {
  /** Bus id is `watch.<id>`; strings are `event.watch.<id>.name|desc|announce`. */
  id: string;
  /** Weight in the seeded pick. */
  weight: number;
  /** First Night it can roll (default 1). */
  minNight?: number;
  /** Pull-counted: the effect lasts this many pulls on HOT machines (the timer still caps it). */
  pullBudget?: number;
  effects: ModEffect[];
}

/**
 * The floor's Minute catalogue. Every number is an existing hook the run or a machine already reads. Two requested effects have
 * no hook yet and are substituted (see the report): Big One LUCKY 7 chance (a constant, `LUCKY_P`) -> Big One jackpot claims x3,
 * and Dealer's Break min bet 1 / free insurance (no blackjack hook) -> double on any two cards (`m.blackjack.doubleAny`).
 */
export const WATCH_EVENTS: readonly WatchEventDef[] = [
  { id: 'happy_minute', weight: 3, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.5, scope: { machines: ['coinflip'] } }] },
  { id: 'lucky_lamp', weight: 2, pullBudget: 3, effects: [{ hook: 'x.lamp.hotMult', op: 'set', value: 2 }] },
  { id: 'dealers_break', weight: 2, effects: [{ hook: 'm.blackjack.doubleAny', op: 'set', value: 1, scope: { machines: ['blackjack'] } }] },
  { id: 'cold_snap', weight: 2, minNight: 2, effects: [{ hook: 'x.lamp.coldMult', op: 'set', value: 0.5 }, { hook: 'x.run.pullsAdd', op: 'add', value: 1 }] },
  { id: 'jackpot_whisper', weight: 1, effects: [{ hook: 'jackpot.mult', op: 'mult', value: 3, scope: { machines: ['bigone'] } }] },
  { id: 'high_roller', weight: 2, effects: [{ hook: 'bet.maxMult', op: 'mult', value: 2 }] },
  { id: 'tilt_holiday', weight: 2, effects: [{ hook: 'x.tilt.grace', op: 'add', value: 2 }] },
  { id: 'tilt_switch', weight: 2, effects: [{ hook: 'x.tilt.ignoreMostPlayed', op: 'add', value: 1 }] },
  { id: 'loose_slots', weight: 2, effects: [{ hook: 'payout.mult', op: 'mult', value: 1.25, scope: { machines: ['fruitmachine'] } }] },
  { id: 'cashier_bonus', weight: 2, effects: [{ hook: 'deposit.bonus', op: 'add', value: 0.1 }] },
  { id: 'draft', weight: 1, effects: [{ hook: 'payout.mult', op: 'mult', value: 0.9 }, { hook: 'dread.add', op: 'add', value: 4 }] },
];

/**
 * The seeded roll for one Watch: `chance` first, then the weighted event, then its length. `blocked` (a boss Night, or any other
 * event holding the floor) rolls nothing. `avoid` is the event id of the Watch before, in the same Night: it is never rolled twice
 * in a row (wave 47), so the pick is made from the rest. Pure: the caller passes a rng (the module never reads a global one).
 */
export function rollWatchEvent(rng: Rng, nightNo: number, blocked = false, avoid: string | null = null): { def: WatchEventDef; secs: number } | null {
  if (blocked || nightNo < 1) return null;
  if (!rng.chance(WATCH_EVENT_CHANCE)) return null;
  const pool = WATCH_EVENTS.filter((d) => nightNo >= (d.minNight ?? 1) && d.id !== avoid);
  if (pool.length === 0) return null;
  const def = rng.weighted(pool, pool.map((d) => d.weight));
  return { def, secs: rng.int(WATCH_EVENT_MIN_S, WATCH_EVENT_MAX_S) };
}

/** What the HUD reads each frame. `leftS` is Watch-clock seconds; `pulls` is the Lucky Lamp budget (null when not pull-counted). */
export interface WatchEventView { id: string; leftS: number; pulls: number | null }
/**
 * Save shape (optional on the run save: an older save has none). `id` is null between Watches: the save then keeps only the
 * memory of the last rolled event (`last`, in Night `lastNight`), so a reload does not let the same event come back at once.
 */
export interface WatchEventSave { id: string | null; leftS: number; pulls: number | null; last?: string | null; lastNight?: number }

export interface WatchEventHost {
  /** The Circuit's Hot test, for the pull budget (Lucky Lamp counts only pulls on HOT machines). */
  isHot(mid: InstanceId): boolean;
  /** Invalidates cached mod folds after the event starts, ends or spends a pull. */
  touch(): void;
}

/** The live event of the most recently begun run (the HUD reads it through `watchEventView`). One run per page. */
let live: WatchEvents | null = null;

/** The active Watch event for the HUD, or null between Watches and on boss Nights. */
export function watchEventView(): WatchEventView | null { return live?.view() ?? null; }

export class WatchEvents implements ModProvider {
  readonly kind: ModSourceKind = 'event';
  private cur: { def: WatchEventDef; leftS: number; pulls: number | null } | null = null;
  /** The event rolled at the previous Watch of this Night (null when that Watch had none): never rolled twice in a row. */
  private last: string | null = null;
  private lastNight = 0;

  constructor(private readonly host: WatchEventHost) {}

  /**
   * Watch start (before `startWatch`): ends any previous event, rolls this Watch's event and announces it. Returns the event or
   * null. `blocked` is true on boss Nights (and while another floor event holds the Watch). The previous Watch's event is kept
   * out of the pick when it was in the same Night (wave 47).
   */
  begin(rng: Rng, nightNo: number, watchIdx: number, blocked = false): WatchEventDef | null {
    this.end();
    const avoid = this.lastNight === nightNo ? this.last : null;
    const roll = rollWatchEvent(rng.fork(`watchEvent.${nightNo}.${watchIdx}`), nightNo, blocked, avoid);
    this.last = roll ? roll.def.id : null;
    this.lastNight = nightNo;
    if (!roll) return null;
    this.cur = { def: roll.def, leftS: roll.secs, pulls: roll.def.pullBudget ?? null };
    live = this;
    this.host.touch();
    bus.emit('event:start', { id: `watch.${roll.def.id}` });
    return roll.def;
  }

  /** Watch clock: `dtS` real Watch seconds (cutscenes and the tutorial hold the clock, so the event holds too). */
  tick(dtS: number): void {
    const c = this.cur;
    if (!c) return;
    c.leftS -= dtS;
    if (c.leftS <= 0) this.end();
  }

  /** After each resolved pull on `mid`: a Lucky Lamp spends one pull of its budget when `mid` is HOT. */
  onPull(mid: InstanceId): void {
    const c = this.cur;
    if (!c || c.pulls === null || !this.host.isHot(mid)) return;
    c.pulls -= 1;
    if (c.pulls <= 0) this.end();
    else this.host.touch();
  }

  /** Watch settle or any early close: the event ends and its effects go. */
  end(): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (live === this) live = null;
    this.host.touch();
    bus.emit('event:end', { id: `watch.${c.def.id}` });
  }

  /** The active event's effects, owner 0 (the pit). Called by the fold on every query; empty when no event runs. */
  collect(_q: ModQuery, out: ModSource[]): void {
    const c = this.cur;
    if (!c) return;
    out.push({ kind: 'event', id: `watch.${c.def.id}`, owner: 0, effects: c.def.effects, order: out.length });
  }

  view(): WatchEventView | null {
    const c = this.cur;
    return c ? { id: c.def.id, leftS: Math.max(0, c.leftS), pulls: c.pulls } : null;
  }

  /** The save: the live event, or (between Watches) only the memory of the last one. Null when there is nothing to keep. */
  snapshot(): WatchEventSave | null {
    const c = this.cur;
    if (!c && this.last === null) return null;
    return { id: c ? c.def.id : null, leftS: c ? c.leftS : 0, pulls: c ? c.pulls : null, last: this.last, lastNight: this.lastNight };
  }

  /** Reload mid-Watch: the event resumes with its time left. Silent (no banner): the player already heard it. */
  restore(s: WatchEventSave | null | undefined): void {
    if (!s) return;
    this.last = s.last ?? null;
    this.lastNight = s.lastNight ?? 0;
    const def = s.id !== null ? WATCH_EVENTS.find((d) => d.id === s.id) : undefined;
    if (!def) return;
    this.cur = { def, leftS: s.leftS, pulls: s.pulls };
    live = this;
    this.host.touch();
  }
}
