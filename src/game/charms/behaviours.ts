/**
 * Code-defined charm behaviours, merged onto the pure data in `data/charms.ts` by id. Only charms whose rule cannot be
 * written as a declarative ModEffect live here (phase conditions, floor climbs, streaks, counters, bell triggers).
 *
 * Two channels:
 *  - `BEHAVIOURS[id].on` reacts to bus events and writes the charm's data bag;
 *  - `DYNAMIC_EFFECTS[id]` returns this instant's ModEffects (so `+x%` is an `inc` that `win()` splits into A, and `×n`
 *    is a `mult` that lands in M). Use these instead of `modify` for payout bonuses: `modify` runs after the fold, so
 *    `win()` treats it as part of M and the even-money dampener never sees it.
 * `modify` is kept only for the few effects with no split (e.g. the `long_shot` threshold).
 */
import type { CharmCtx, CharmDef, ModEffect, ModHook, RunApi } from '@/game/types';
import type { Json } from '@/core/types';

type Behaviour = Partial<Pick<CharmDef, 'on' | 'modify'>>;

/** What a dynamic effect may read: the charm's data bag and the run (no rng, no side effects). */
export interface LiveCharm { data: Record<string, Json>; run: RunApi }
/** Payout effects (`payout.mult`) for this instant. Appended to the charm source on every modifier query. */
export type DynamicEffects = (live: LiveCharm) => ModEffect[];

const num = (v: Json | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const isPayout = (h: ModHook): boolean => h === 'payout.mult';
const inc = (value: number): ModEffect[] => (value > 0 ? [{ hook: 'payout.mult', op: 'inc', value }] : []);
const mult = (value: number): ModEffect[] => [{ hook: 'payout.mult', op: 'mult', value }];

export const BEHAVIOURS: Readonly<Record<string, Behaviour>> = {
  /** +10 % per consecutive winning play, max +50 % (additive, dampened); a loss resets. */
  chain_link: {
    on: {
      'machine:result': (p, c) => { c.data.streak = p.gross > p.bet ? Math.min(5, num(c.data.streak) + 1) : 0; },
    },
  },
  /** +40 % during Last Call (additive). */
  night_owl: {},
  /** +2 % per floor climbed, capped at +14 % (floor 1 = start). Additive. */
  altimeter: {},
  /** Each paid Night permanently adds +10 % to all payouts. */
  collectors_tag: {
    on: { 'quota:met': (_p, c) => { c.data.nights = num(c.data.nights) + 1; } },
    modify: (hook, _m, v, c) => (isPayout(hook) ? v * (1 + 0.1 * num(c.data.nights)) : v),
  },
  /** After each Bell, the next win pays ×2 (consumed by that win). */
  cuckoo_feather: {
    on: {
      'shift:phase': (p, c) => { if (p.phase === 'bell') c.data.armed = 1; },
      'machine:result': (p, c) => { if (p.gross > p.bet) c.data.armed = 0; },
    },
  },
  /** Wins of ×10 or more print a Ticket, max 3 per Watch. */
  lucky_receipt: {
    on: {
      'machine:result': (p, c) => {
        if (p.gross < p.bet * 10 || num(c.data.watch) >= 3) return;
        c.data.watch = num(c.data.watch) + 1;
        c.run.earn('ticket', 1, 'charm:lucky_receipt', c.pid);
        c.proc();
      },
    },
  },
  /** Each Bell: +1 Ticket and +4 × SI coins. */
  brass_alarm: {
    on: {
      'shift:phase': (p, c) => {
        if (p.phase !== 'bell') return;
        c.run.earn('ticket', 1, 'charm:brass_alarm', c.pid);
        c.run.earn('coin', 4 * c.run.shift.state().stake, 'charm:brass_alarm', c.pid);
        c.proc();
      },
    },
  },
  /** Each Bell: +4 % of pocket, capped at 40 × SI. */
  porcelain_pig: {
    on: {
      'shift:phase': (p, c) => {
        if (p.phase !== 'bell') return;
        const gain = Math.min(Math.floor(c.run.wallet(c.pid) * 0.04), 40 * c.run.shift.state().stake);
        if (gain > 0) { c.run.earn('coin', gain, 'charm:porcelain_pig', c.pid); c.proc(); }
      },
    },
  },
  /** Wins of base multiplier 20 or more pay ×2. */
  long_shot: {
    modify: (hook, _m, v) => (isPayout(hook) && v >= 20 ? v * 2 : v),
  },
};

/** Per-instant effects for the additive / multiplicative charms (see the header). Keyed by charm id. */
export const DYNAMIC_EFFECTS: Readonly<Record<string, DynamicEffects>> = {
  /** +10 % per streak step (additive). */
  chain_link: (c) => inc(0.1 * Math.min(5, num(c.data.streak))),
  /** +40 % (additive) during Last Call. */
  night_owl: (c) => (c.run.shift.state().phase === 'lastCall' ? inc(0.4) : []),
  /** +2 % per floor above 1, max +14 % (additive). */
  altimeter: (c) => inc(0.02 * Math.min(14, Math.max(0, c.run.shift.state().floor - 1))),
  /** ×2 on the armed win (multiplicative). */
  cuckoo_feather: (c) => (num(c.data.armed) === 1 ? mult(2) : []),
};

export type { CharmCtx };
