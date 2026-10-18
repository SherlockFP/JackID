/**
 * Per-Watch floor events (wave 43, director: decisions and moments in every Watch). Each Watch from Night 1 rolls one short
 * event with a seeded chance (`WATCH_EVENT_CHANCE`, data/schedule.ts), lasting 45-60 s of Watch clock unless the event fixes
 * its own length. Boss Nights roll none.
 *
 * Pure rules + one ModProvider: most effects are declarative ModEffects folded by the run's mod pipeline (no machine code).
 * Wave 75 adds five events from Night 2 (`src/game/events/**`): SINGLE LIGHT, STAGE AUCTION, CRATE DROP, WHEEL SPIN and
 * LAST CALL DARE. They are `kind`s of this same provider. Their rewards come out as `FloorOutcome`s (`takeOutcomes`), and the
 * run applies them. Announcements go out on the existing bus as `event:start` / `event:end` with id `watch.<id>`, so the event
 * banner and feed line are the nightly-event ones; strings live in `watchEvents.strings.ts` under `event.watch.<id>.*`.
 *
 * Run wiring: see the lane report. Order matters: `begin` before `startWatch` (x.run.pullsAdd is read there), `tick` with the
 * Watch clock dt, `watchLeft` with the Watch clock left (arms LAST CALL DARE), `onPull` after each resolved pull, `allowsPlay`
 * at each machine play, `end` at Settle. No DOM, no three.
 */
import { bus } from '@/core/events';
import type { Rng } from '@/core/rng';
import type { InstanceId, MachineId } from '@/core/types';
import type { ModEffect, ModProvider, ModQuery, ModSource, ModSourceKind } from '@/game/modifiers.types';
import { WATCH_EVENT_CHANCE } from './data/schedule';
import { acceptDare as takeDare, dareEffects, DARE_ARM_S, rollDare, settleDare, type DareState } from './events/lastCallDare';
import { auctionPrice, AUCTION_BID_S, bidAuction as placeBid, closeAuction, rollAuction, tickAuction, type AuctionState, type BidResult } from './events/stageAuction';
import { rollCrate, tryOpenCrate, type CrateState } from './events/crateDrop';
import { pickLitMachine, SINGLE_LIGHT_S, singleLightAllows, singleLightEffects } from './events/singleLight';
import { spinWheel, WHEEL_S, wheelEffects, wheelSpinning, type WheelSegment } from './events/wheelSpin';
import { callCheat as callTable, CROOKED_S, recordPlay as recordTablePlay, rigEffects, rollCrooked, tableIndex, tellsAt, type CallResult, type CrookedOutcome, type CrookedState, type CrookedTell } from './events/crookedTable';
import { NO_FLOOR, type FloorAward, type FloorOutcome, type FloorPt, type WatchFloor } from './events/types';

/** Length of a Watch event, Watch-clock seconds (seeded, inclusive). */
export const WATCH_EVENT_MIN_S = 45;
export const WATCH_EVENT_MAX_S = 60;

/** How an event plays. `effects` (the default): its ModEffects for the whole event. The rest have their own rules. */
export type WatchEventKind = 'effects' | 'single' | 'auction' | 'crate' | 'wheel' | 'dare' | 'crooked';

export interface WatchEventDef {
  /** Bus id is `watch.<id>`; strings are `event.watch.<id>.name|desc|announce|compere`. */
  id: string;
  /** Weight in the seeded pick. */
  weight: number;
  /** First Night it can roll (default 1). */
  minNight?: number;
  /** Pull-counted: the effect lasts this many pulls on HOT machines (the timer still caps it). */
  pullBudget?: number;
  /** How the event plays (default 'effects'). */
  kind?: WatchEventKind;
  /** Fixed length in Watch-clock seconds (default: seeded 45-60). */
  fixedS?: number;
  /** A 'dare' event arms when the Watch clock has this many seconds left; its timer runs only once armed. */
  armAtS?: number;
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
  // Wave 75 floor events (Night 2 on). Each one plays its own way (`kind`); `effects` stays empty for them.
  // Weights are sized for a normal run: 14 Watches are open to floor events from Night 2 (Nights 3, 6 and 8 are boss Nights). At
  // weight 2 of a 31-weight pool each new event rolls in about half of those runs (scripts/tests/floorWiring.test.mjs checks it).
  { id: 'single_light', weight: 2, minNight: 2, kind: 'single', fixedS: SINGLE_LIGHT_S, effects: [] },
  { id: 'stage_auction', weight: 2, minNight: 2, kind: 'auction', fixedS: AUCTION_BID_S, effects: [] },
  { id: 'crate_drop', weight: 2, minNight: 2, kind: 'crate', effects: [] },
  { id: 'wheel_spin', weight: 2, minNight: 2, kind: 'wheel', fixedS: WHEEL_S, effects: [] },
  { id: 'last_call_dare', weight: 2, minNight: 2, kind: 'dare', fixedS: DARE_ARM_S, armAtS: DARE_ARM_S, effects: [] },
  // Story wave S3: the Crooked Table (STORY_BIBLE 5c). Tamsin hosts it from Night 2; see events/crookedTable.ts.
  { id: 'crooked_table', weight: 2, minNight: 2, kind: 'crooked', fixedS: CROOKED_S, effects: [] },
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
  return { def, secs: def.fixedS ?? rng.int(WATCH_EVENT_MIN_S, WATCH_EVENT_MAX_S) };
}

/** What the HUD reads each frame. `leftS` is Watch-clock seconds; `pulls` is the Lucky Lamp budget (null when not pull-counted). */
export interface WatchEventView {
  id: string;
  leftS: number;
  pulls: number | null;
  /** The HUD line for the event's state: a key under `event.watch.*` and its vars, or null. */
  info: { key: string; vars?: Record<string, number> } | null;
  /** A LAST CALL DARE that the player can take now (armed, not taken, not spent). */
  canAccept: boolean;
}

/** Per-event state for the wave 75 kinds. Plain data, so it saves as JSON. */
export interface EventAux {
  elapsedS?: number;
  lit?: MachineId | null;
  seg?: WheelSegment | null;
  auction?: AuctionState;
  crate?: CrateState;
  dare?: DareState;
  crooked?: CrookedState;
}

/**
 * Save shape (optional on the run save: an older save has none). `id` is null between Watches: the save then keeps only the
 * memory of the last rolled event (`last`, in Night `lastNight`), so a reload does not let the same event come back at once.
 * `aux` carries the state of the wave 75 kinds (an older save has none, and those events then degrade).
 */
export interface WatchEventSave { id: string | null; leftS: number; pulls: number | null; last?: string | null; lastNight?: number; aux?: EventAux; crookedSeen?: boolean }

export interface WatchEventHost {
  /** The Circuit's Hot test, for the pull budget (Lucky Lamp counts only pulls on HOT machines). */
  isHot(mid: InstanceId): boolean;
  /** Invalidates cached mod folds after the event starts, ends or spends a pull. */
  touch(): void;
  /** The floor facts the wave 75 events read (open machines, the spotlight, the Lobby spot). Absent = no floor: they degrade. */
  floor?(): WatchFloor;
}

/** The live event of the most recently begun run (the HUD reads it through `watchEventView`). One run per page. */
let live: WatchEvents | null = null;

/** The active Watch event for the HUD, or null between Watches and on boss Nights. */
export function watchEventView(): WatchEventView | null { return live?.view() ?? null; }

/** The machine kind that stays lit while SINGLE LIGHT runs, or null (no such event live). The world dims every other light. */
export function singleLightLit(): MachineId | null { return live?.litMachine() ?? null; }

interface Live { def: WatchEventDef; leftS: number; pulls: number | null; aux: EventAux }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class WatchEvents implements ModProvider {
  readonly kind: ModSourceKind = 'event';
  private cur: Live | null = null;
  /** The event rolled at the previous Watch of this Night (null when that Watch had none): never rolled twice in a row. */
  private last: string | null = null;
  private lastNight = 0;
  /** Rewards and notes for the run; drained by `takeOutcomes()`. */
  private outbox: FloorOutcome[] = [];
  /** Crooked Table results for the run (Heat, luck, refund, fine); drained by `takeCrooked()`. */
  private crookedOut: CrookedOutcome[] = [];
  /** Tamsin has explained the Crooked Table once already (she only does it the first time). */
  private crookedSeen = false;

  constructor(private readonly host: WatchEventHost) {}

  /**
   * Watch start (before `startWatch`): ends any previous event, rolls this Watch's event and announces it. Returns the event or
   * null. `blocked` is true on boss Nights (and while another floor event holds the Watch). The previous Watch's event is kept
   * out of the pick when it was in the same Night (wave 47). A wave 75 event with no floor to play on (SINGLE LIGHT with no
   * machine open) is not started.
   */
  begin(rng: Rng, nightNo: number, watchIdx: number, blocked = false): WatchEventDef | null {
    this.end();
    const avoid = this.lastNight === nightNo ? this.last : null;
    const roll = rollWatchEvent(rng.fork(`watchEvent.${nightNo}.${watchIdx}`), nightNo, blocked, avoid);
    this.last = roll ? roll.def.id : null;
    this.lastNight = nightNo;
    if (!roll) return null;
    const aux = this.prepare(roll.def, rng.fork(`watchEvent.aux.${nightNo}.${watchIdx}`));
    if (!aux) return null;
    this.cur = { def: roll.def, leftS: roll.secs, pulls: roll.def.pullBudget ?? null, aux };
    live = this;
    this.host.touch();
    bus.emit('event:start', { id: `watch.${roll.def.id}` });
    return roll.def;
  }

  /** Rolls the wave 75 state of one event (the seeded part). Null when the event cannot run on this floor. */
  private prepare(def: WatchEventDef, rng: Rng): EventAux | null {
    const floor = this.floor();
    switch (def.kind ?? 'effects') {
      case 'single': {
        const lit = pickLitMachine(rng, floor);
        return lit ? { elapsedS: 0, lit } : null;
      }
      case 'auction': return { elapsedS: 0, auction: rollAuction(rng) };
      case 'crate': return { elapsedS: 0, crate: rollCrate(rng, floor) };
      case 'wheel': return { elapsedS: 0, seg: spinWheel(rng) };
      case 'dare': return { elapsedS: 0, dare: rollDare(rng) };
      case 'crooked': {
        const crooked = rollCrooked(rng, floor, !this.crookedSeen);
        if (crooked) this.crookedSeen = true;
        return crooked ? { elapsedS: 0, crooked } : null;
      }
      default: return { elapsedS: 0 };
    }
  }

  private floor(): WatchFloor { return this.host.floor?.() ?? NO_FLOOR; }

  /** Watch clock: `dtS` real Watch seconds (cutscenes and the tutorial hold the clock, so the event holds too). */
  tick(dtS: number): void {
    const c = this.cur;
    if (!c) return;
    c.aux.elapsedS = (c.aux.elapsedS ?? 0) + dtS;
    if (c.def.kind === 'dare' && !c.aux.dare?.armed) return;
    c.leftS -= dtS;
    const a = c.aux.auction;
    if (a && a.phase === 'bid') {
      const r = tickAuction(a, dtS);
      if (r.raised !== null) this.outbox.push({ kind: 'raise', price: r.raised });
    }
    if (c.leftS <= 0) this.end();
  }

  /**
   * The run's Watch clock: how many Watch seconds are left. A LAST CALL DARE arms in the last `armAtS` seconds of it. Calling
   * this every frame is fine (it arms once).
   */
  watchLeft(sLeft: number): void {
    const c = this.cur;
    const d = c?.aux.dare;
    if (!c || !d || c.def.kind !== 'dare' || d.armed) return;
    if (sLeft > (c.def.armAtS ?? DARE_ARM_S)) return;
    d.armed = true;
    this.host.touch();
  }

  /** The player takes the LAST CALL DARE (opt-in). True when it was taken. */
  acceptDare(): boolean {
    const c = this.cur;
    const d = c?.aux.dare;
    if (!c || !d || c.def.kind !== 'dare' || !takeDare(d)) return false;
    this.host.touch();
    return true;
  }

  /** The lit machine while SINGLE LIGHT is live (null otherwise). */
  litMachine(): MachineId | null {
    const c = this.cur;
    return c && c.def.kind === 'single' ? (c.aux.lit ?? null) : null;
  }

  /** A STAGE AUCTION bid of `amount` coins with `pocket` in the pocket. The run takes `charge` from the pocket when `ok`. */
  bidAuction(amount: number, pocket: number): BidResult {
    const c = this.cur;
    const a = c?.aux.auction;
    if (!c || !a || c.def.kind !== 'auction') return { ok: false, why: 'closed' };
    const r = placeBid(a, amount, pocket);
    if (r.ok) this.host.touch();
    return r;
  }

  /** The lowest bid a press makes now: one above the House price and above the player's own top bid. Null when no auction runs. */
  auctionNext(): number | null {
    const c = this.cur;
    const a = c?.aux.auction;
    if (!c || !a || c.def.kind !== 'auction' || a.phase !== 'bid') return null;
    return Math.max(auctionPrice(a) + 1, a.top + 1);
  }

  /**
   * A press of E at `pos` (the player's floor position, or null when the run has none). Opens the CRATE DROP when in reach and
   * the first time it is pressed. Returns the reward, which is also queued as an outcome.
   */
  openCrate(pos: FloorPt | null, pressed: boolean): FloorAward | null {
    const c = this.cur;
    const s = c?.aux.crate;
    if (!c || !s || c.def.kind !== 'crate') return null;
    const award = tryOpenCrate(s, pos, pressed);
    if (!award) return null;
    this.outbox.push({ kind: 'crate', reward: award });
    this.end();
    return award;
  }

  /**
   * After each resolved round on `mid` (the run calls it from `win()`, after the payout, so a multiplier still applies to that
   * round). `won` is whether the round was a win before the floor's multipliers (a taken LAST CALL DARE settles on it and ends).
   * A Lucky Lamp spends one pull of its budget when `mid` is HOT.
   */
  onPull(mid: InstanceId, won = false, net = 0): void {
    const c = this.cur;
    if (!c) return;
    const cr = c.aux.crooked;
    if (cr && c.def.kind === 'crooked') {
      const heat = recordTablePlay(cr, mid, won, net);
      if (heat) this.crookedOut.push({ kind: 'heat', heat });
      return;
    }
    const d = c.aux.dare;
    if (c.def.kind === 'dare' && d && d.accepted && !d.spent) {
      this.outbox.push({ kind: 'dare', result: settleDare(d, won) });
      this.end();
      return;
    }
    if (c.pulls === null || !this.host.isHot(mid)) return;
    c.pulls -= 1;
    if (c.pulls <= 0) this.end();
    else this.host.touch();
  }

  /**
   * The player calls CHEAT at the table `mid` (key C, facing it). `quota` is the Night's quota in coins. Null when no Crooked
   * Table runs, `mid` is not one of its three tables, or it was already called. The result is also queued for `takeCrooked()`,
   * and the event ends (the tables close).
   */
  callCheat(mid: MachineId, quota: number): CallResult | null {
    const c = this.cur;
    const cr = c?.aux.crooked;
    if (!c || !cr || c.def.kind !== 'crooked') return null;
    const r = callTable(cr, mid, quota);
    if (!r) return null;
    this.crookedOut.push({ kind: 'call', ...r });
    this.end();
    return r;
  }

  /** The three tables and what the player can read at each now (for the plates, the dealers and the Tally Sheet). Null otherwise. */
  crookedView(): { tables: { mid: MachineId; tells: CrookedTell[] }[]; intro: boolean } | null {
    const c = this.cur;
    const cr = c?.aux.crooked;
    if (!c || !cr || c.def.kind !== 'crooked') return null;
    return { tables: cr.tables.map((mid, i) => ({ mid, tells: tellsAt(cr, i as 0 | 1 | 2) })), intro: cr.intro };
  }

  /** Whether `mid` is one of the Crooked Table's three tables right now (the run shows the C prompt only there). */
  isCrookedTable(mid: MachineId): boolean {
    const cr = this.cur?.aux.crooked;
    return !!cr && this.cur?.def.kind === 'crooked' && tableIndex(cr, mid) >= 0;
  }

  /** Crooked Table results since the last call: calls (refund, fine, luck, Heat), ride Heat, and an uncalled close. */
  takeCrooked(): CrookedOutcome[] {
    const out = this.crookedOut;
    this.crookedOut = [];
    return out;
  }

  /** The play gate of SINGLE LIGHT: with the event live, only the lit machine may be played. True everywhere else. */
  allowsPlay(mid: MachineId): boolean {
    const c = this.cur;
    if (!c || c.def.kind !== 'single') return true;
    return singleLightAllows(c.aux.lit, mid);
  }

  /** Watch settle or any early close: the event ends and its effects go. An open STAGE AUCTION settles first. */
  end(): void {
    const c = this.cur;
    if (!c) return;
    const a = c.aux.auction;
    if (a && a.phase === 'bid') {
      const r = closeAuction(a);
      this.outbox.push({ kind: 'auction', won: r.won, spent: a.top, award: r.award, consolation: r.consolation });
    }
    const cr = c.aux.crooked;
    if (cr && c.def.kind === 'crooked' && !cr.called) this.crookedOut.push({ kind: 'expired', rigPlays: cr.plays[cr.rigged] });
    this.cur = null;
    if (live === this) live = null;
    this.host.touch();
    bus.emit('event:end', { id: `watch.${c.def.id}` });
  }

  /** Rewards and notes since the last call. The run applies them (Tickets, tonics, charms, the Watch clock, the pocket). */
  takeOutcomes(): FloorOutcome[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  /** The active event's effects, owner 0 (the pit). Called by the fold on every query; empty when no event runs. */
  collect(_q: ModQuery, out: ModSource[]): void {
    const c = this.cur;
    if (!c) return;
    out.push({ kind: 'event', id: `watch.${c.def.id}`, owner: 0, effects: this.effectsOf(c), order: out.length });
  }

  /** The effects a live event holds right now. Kinds with a rule (single, wheel, dare) derive them from their state. */
  private effectsOf(c: Live): ModEffect[] {
    const a = c.aux;
    switch (c.def.kind ?? 'effects') {
      case 'single': return a.lit ? singleLightEffects(a.lit) : [];
      case 'wheel': return a.seg ? wheelEffects(a.seg) : [];
      case 'dare': return a.dare ? dareEffects(a.dare) : [];
      case 'crooked': return a.crooked ? rigEffects(a.crooked) : [];
      case 'auction':
      case 'crate': return [];
      default: return c.def.effects;
    }
  }

  /** The HUD line for the event's state, or null when it has none. */
  private infoOf(c: Live): WatchEventView['info'] {
    const a = c.aux;
    switch (c.def.kind ?? 'effects') {
      case 'single': return { key: 'event.watch.single_light.hud' };
      case 'auction': {
        const au = a.auction;
        if (!au || au.phase !== 'bid') return null;
        const next = Math.max(auctionPrice(au) + 1, au.top + 1);
        // n: the House price, b: the player's own top bid, step: what the next legal bid costs on top of it
        return { key: 'event.watch.stage_auction.hud', vars: { n: auctionPrice(au), b: au.top, step: next - au.top } };
      }
      case 'crooked': return a.crooked && !a.crooked.called ? { key: 'event.watch.crooked_table.hud' } : null;
      case 'crate': return a.crate && !a.crate.open ? { key: 'event.watch.crate_drop.hud' } : null;
      case 'wheel': return a.seg ? { key: wheelSpinning(a.elapsedS ?? 0) ? 'event.watch.wheel_spin.spin' : `event.watch.wheel_spin.seg.${a.seg}`, vars: { s: Math.max(0, Math.ceil(c.leftS)) } } : null;
      case 'dare': {
        const d = a.dare;
        if (!d || !d.armed || d.spent) return null;
        return { key: d.accepted ? 'event.watch.last_call_dare.hud.on' : 'event.watch.last_call_dare.hud.ready' };
      }
      default: return null;
    }
  }

  view(): WatchEventView | null {
    const c = this.cur;
    if (!c) return null;
    const d = c.aux.dare;
    return {
      id: c.def.id, leftS: Math.max(0, c.leftS), pulls: c.pulls, info: this.infoOf(c),
      canAccept: c.def.kind === 'dare' && !!d && d.armed && !d.accepted && !d.spent,
    };
  }

  /** The save: the live event, or (between Watches) only the memory of the last one. Null when there is nothing to keep. */
  snapshot(): WatchEventSave | null {
    const c = this.cur;
    if (!c && this.last === null) return null;
    return {
      id: c ? c.def.id : null, leftS: c ? c.leftS : 0, pulls: c ? c.pulls : null, last: this.last, lastNight: this.lastNight, crookedSeen: this.crookedSeen,
      ...(c ? { aux: clone(c.aux) } : {}),
    };
  }

  /** Reload mid-Watch: the event resumes with its time left. Silent (no banner): the player already heard it. */
  restore(s: WatchEventSave | null | undefined): void {
    if (!s) return;
    this.last = s.last ?? null;
    this.lastNight = s.lastNight ?? 0;
    this.crookedSeen = !!s.crookedSeen;
    const def = s.id !== null ? WATCH_EVENTS.find((d) => d.id === s.id) : undefined;
    if (!def) return;
    this.cur = { def, leftS: s.leftS, pulls: s.pulls, aux: s.aux ? clone(s.aux) : { elapsedS: 0 } };
    live = this;
    this.host.touch();
  }
}
