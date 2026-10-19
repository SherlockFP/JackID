/**
 * THE CROOKED TABLE / HİLELİ MASA (STORY_BIBLE wave S3, beginner version, floor event from Night 2). Three tables are under
 * watch and exactly one is rigged. The rigged table pays a little better (a scoped `payout.mult`, the hook the Spotlight uses;
 * no machine's own odds change) because the House wants guests to stay at it. The player has three ways out:
 *   - CALL the rigged table: the House pays back double what was lost there (capped at 25% of the quota), +1 luck star, Heat -1.
 *   - CALL a fair table: a small fine (5% of the quota) and Heat +1.
 *   - RIDE the rig: just keep playing it. Better payouts, but every third play there is Heat +1.
 * Tells are read in first person and come in three channels: PLATE (from the start), HABIT (after two plays at that table) and
 * TALLY (after five plays, on the Tally Sheet). A fair table shows plain lines, so a tell is never a guess about the rule.
 * Pure rules: seeded `Rng` in, plain JSON state out, no DOM, no clock, no `Math.random`. The Watch event module owns the clock.
 */
import { t } from '@/core/i18n';
import type { Rng } from '@/core/rng';
import type { SubLine } from '@/core/ui/subtitles';
import type { MachineId } from '@/core/types';
import type { ModEffect } from '@/game/modifiers.types';
import { ALWAYS_OPEN } from '@/game/progression';
import { NO_FLOOR, type WatchFloor } from './types';

/** Length of the event, Watch-clock seconds. Long enough to play three tables a few times. */
export const CROOKED_S = 150;
export const CROOKED_TABLES = 3;
/** The rigged table's payout bonus (the same size as Loose Slots). */
export const RIG_MULT = 1.25;
/** Every this many plays at the rigged table: Heat +1. */
export const RIDE_HEAT_EVERY = 3;
/** Plays at one table before its HABIT and TALLY tells show. */
export const HABIT_AFTER = 2;
export const TALLY_AFTER = 5;
/** A right call pays back this many times the loss at that table, capped at this fraction of the quota. */
export const REFUND_MULT = 2;
export const REFUND_CAP_FRAC = 0.25;
/** A wrong call costs this fraction of the quota (at least 1 coin). */
export const FINE_FRAC = 0.05;
export const VARIANTS = 3;

export type Channel = 'plate' | 'habit' | 'tally';
export type TableIx = 0 | 1 | 2;

/** Plain data, so it saves as JSON. */
export interface CrookedState {
  tables: MachineId[];
  rigged: TableIx;
  /** The seeded wording of the rigged table's PLATE and HABIT tells (0..VARIANTS-1). */
  vPlate: number;
  vHabit: number;
  plays: number[];
  wins: number[];
  /** Coins lost at each table (only the net losses of a round count). */
  lost: number[];
  called: boolean;
  /** True on the first time this event ever starts: Tamsin explains it. */
  intro: boolean;
  /** The Late Reflection (Mirrors Favour 2+): every table shows its dealer's HABIT from the start. */
  late?: boolean;
  /** Clear Glass (`x.crooked.starAdd`): stars a right call adds. Two Sets of Books (`x.crooked.payMult`): the rig pays this much more. */
  starAdd?: number;
  payMult?: number;
}

export interface CrookedTell { channel: Channel; key: string; vars?: Record<string, number> }

export interface CallResult {
  right: boolean;
  table: TableIx;
  /** Coins the House pays back (0 on a wrong call). */
  refund: number;
  /** Coins the Clerk takes (0 on a right call). */
  fine: number;
  /** Luck stars (SANS) to add. */
  luck: number;
  /** Heat change: -1 on a right call, +1 on a wrong one. */
  heat: number;
}

/** What the run applies, drained by `WatchEvents.takeCrooked()`. */
export type CrookedOutcome =
  | ({ kind: 'call' } & CallResult)
  | { kind: 'heat'; heat: number }
  | { kind: 'expired'; rigPlays: number };

/**
 * Rolls the three tables and the rigged one. The tables are three different machines open on the floor. Fewer than three open
 * machines (or no floor facts) means the event cannot run: null, and the Watch rolls nothing.
 */
export function rollCrooked(rng: Rng, floor: WatchFloor = NO_FLOOR, intro = false): CrookedState | null {
  // a table is a game to play: vendors, terminals and the story tables (ALWAYS_OPEN) never count
  const pool = Array.from(new Set(floor.machines)).filter((m) => !ALWAYS_OPEN.has(m));
  if (pool.length < CROOKED_TABLES) return null;
  const tables: MachineId[] = [];
  while (tables.length < CROOKED_TABLES) {
    const m = rng.pick(pool);
    pool.splice(pool.indexOf(m), 1);
    tables.push(m);
  }
  return {
    tables,
    rigged: rng.int(0, CROOKED_TABLES - 1) as TableIx,
    vPlate: rng.int(0, VARIANTS - 1),
    vHabit: rng.int(0, VARIANTS - 1),
    plays: [0, 0, 0], wins: [0, 0, 0], lost: [0, 0, 0],
    called: false, intro,
  };
}

export function tableIndex(s: CrookedState, mid: MachineId): TableIx | -1 {
  return s.tables.indexOf(mid) as TableIx | -1;
}

/** The rigged table's bonus, while the event is still open. */
export function rigEffects(s: CrookedState): ModEffect[] {
  if (s.called) return [];
  return [{ hook: 'payout.mult', op: 'mult', value: RIG_MULT * (s.payMult ?? 1), scope: { machines: [s.tables[s.rigged]] } }];
}

/**
 * One resolved round at `mid`. `net` is the coins won minus the bet (negative on a loss). Returns the Heat the round adds:
 * +1 on every RIDE_HEAT_EVERY-th play at the rigged table, else 0. A play at any other machine counts for nothing.
 */
export function recordPlay(s: CrookedState, mid: MachineId, won: boolean, net: number): number {
  const i = tableIndex(s, mid);
  if (i < 0 || s.called) return 0;
  s.plays[i] += 1;
  if (won) s.wins[i] += 1;
  if (net < 0) s.lost[i] += Math.floor(-net);
  return i === s.rigged && s.plays[i] % RIDE_HEAT_EVERY === 0 ? 1 : 0;
}

/** What the player has seen at table `i` by now. The strings are `event.watch.crooked_table.tell.*`. */
export function tellsAt(s: CrookedState, i: TableIx): CrookedTell[] {
  const rig = i === s.rigged;
  const out: CrookedTell[] = [
    { channel: 'plate', key: rig ? `tell.plate.rig.${s.vPlate}` : 'tell.plate.fair', vars: { t: i + 1 } },
  ];
  if (s.late || s.plays[i] >= HABIT_AFTER) out.push({ channel: 'habit', key: rig ? `tell.habit.rig.${s.vHabit}` : 'tell.habit.fair', vars: { t: i + 1 } });
  if (s.plays[i] >= TALLY_AFTER) {
    // The rigged table pays x1.25 on every win, so "above the card" is true of it. A table with no win says nothing either way.
    const key = s.wins[i] === 0 ? 'tell.tally.cold' : rig ? 'tell.tally.rig' : 'tell.tally.fair';
    out.push({ channel: 'tally', key, vars: { t: i + 1, n: s.plays[i], w: s.wins[i] } });
  }
  return out;
}

/** The coin sums of a call, without touching the state. Quota is the Night's quota in coins. */
export function callSums(s: CrookedState, i: TableIx, quota: number): { refund: number; fine: number } {
  const q = Math.max(0, Math.floor(quota));
  if (i === s.rigged) return { refund: Math.min(REFUND_MULT * s.lost[i], Math.floor(q * REFUND_CAP_FRAC)), fine: 0 };
  return { refund: 0, fine: Math.max(1, Math.floor(q * FINE_FRAC)) };
}

/** The player calls CHEAT at `mid`. Null when `mid` is not one of the three tables or the event was already called. */
export function callCheat(s: CrookedState, mid: MachineId, quota: number): CallResult | null {
  const i = tableIndex(s, mid);
  if (i === -1 || s.called) return null;
  s.called = true;
  const right = i === s.rigged;
  const { refund, fine } = callSums(s, i, quota);
  return { right, table: i, refund, fine, luck: right ? 1 + (s.starAdd ?? 0) : 0, heat: right ? -1 : 1 };
}

export const TAMSIN_VOICE = 'tamsin';
export const TAMSIN_LINES = 3;

/** Tamsin's three short lines when the event first starts (Night 2). Spoken through the subtitle system, `ambient` lane. */
export function tamsinIntro(): SubLine[] {
  const out: SubLine[] = [];
  for (let n = 1; n <= TAMSIN_LINES; n++) {
    out.push({
      text: t(`event.watch.crooked_table.tamsin.${n}`),
      speaker: t('event.watch.crooked_table.tamsin.speaker'),
      voice: TAMSIN_VOICE, lane: 'ambient', source: 'crooked.tamsin',
    });
  }
  return out;
}

/** A line for the Tally Sheet journal page: a key under `event.watch.crooked_table.` and its vars. */
export interface SheetLine { key: string; vars?: Record<string, number> }

/**
 * What the Tally Sheet should hold given the tells on show: the TALLY-channel lines themselves (the maths belongs on the Sheet)
 * and, once one shows, the lesson of how to read it. The run adds these with `tallyAdd` (story/notes.ts).
 */
export function sheetFromTells(tables: readonly { tells: readonly CrookedTell[] }[]): SheetLine[] {
  const out: SheetLine[] = [];
  let any = false, cold = false;
  for (const tb of tables) {
    for (const tl of tb.tells) {
      if (tl.channel !== 'tally') continue;
      any = true;
      if (tl.key === 'tell.tally.cold') cold = true;
      out.push({ key: tl.key, vars: tl.vars });
    }
  }
  if (any) out.unshift({ key: 'sheet.l.tally' });
  if (cold) out.unshift({ key: 'sheet.l.cold' });
  return out;
}

/** What one outcome teaches (the Tally Sheet lessons). A right call also teaches the plate and the dealer habit. */
export function sheetFromOutcome(o: CrookedOutcome): SheetLine[] {
  if (o.kind === 'heat') return [{ key: 'sheet.l.ride' }];
  if (o.kind === 'expired') return [];
  return o.right ? [{ key: 'sheet.l.plate' }, { key: 'sheet.l.habit' }, { key: 'sheet.l.right' }] : [{ key: 'sheet.l.wrong' }];
}
