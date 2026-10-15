/**
 * Behaviours of the ten engine charms (wave 8, item 3). Data: `data/charmsEngines.ts`. Same two channels as
 * `charms/behaviours.ts`:
 *  - `ENGINE_BEHAVIOURS[id].on` reacts to bus events and writes the charm's data bag;
 *  - `ENGINE_DYNAMIC_EFFECTS[id](live, q?)` returns this instant's ModEffects. `q.ctx.betFrac` is read by Gilded Chip.
 * Payout bonuses are `mult` (M) or `inc` (A) as the plan requires. Integrator: spread both maps into the engine tables
 * and widen `DynamicEffects` to `(live, q?)`.
 *
 * Evolution (wave 7): a second stack of an engine charm sets `data.evo` (charms/engine.ts). `tuneOf(data)` then gives the
 * evolved numbers and caps. Engine effects are never scaled per stack (charms/engine.ts sets `perStack: false`), so the
 * evolved values here are the whole story.
 */
import type { CharmDef, ModEffect, ModQuery } from '@/game/types';
import type { Json, PlayerId } from '@/core/types';
import { circuitView } from '@/game/circuit';
import { suitOf } from '@/game/suits';
import { CHARM_DATA } from '@/game/data/charms';
import { CHARM_ENGINE_DATA, SUIT_FAMILY_TAGS } from '@/game/data/charmsEngines';
import { DYNAMIC_EFFECTS, type LiveCharm } from './behaviours';
import { activeSets } from './sets';

/** What a dynamic effect may read: the charm's bag, the run, and the owner (for charm lookups). No rng, no side effects. */
export interface EngineLive extends LiveCharm { pid?: PlayerId }
export type EngineDynamic = (live: EngineLive, q?: ModQuery) => ModEffect[];
type Behaviour = Partial<Pick<CharmDef, 'on' | 'badge'>>;

/** Numbers behind the engine charms: the base charm and its evolved second stack. Caps are the most a count can reach. */
export interface EngineTune {
  rung: number; rungMax: number;
  pressure: number; pressureMax: number;
  charge: number; chargeMax: number;
  wickHot: number; wickMax: number;
  watchInterest: number; watchMax: number;
  /** Ticket Press: payout bonus per 3 Tickets held, and its cap. */
  ticketPer3: number; ticketCap: number;
  lastGasp: number;
  gildedMax: number; gildedLow: number;
  ceiling: number;
}

export const ENGINE_BASE_TUNE: EngineTune = {
  rung: 0.12, rungMax: 6,
  pressure: 0.10, pressureMax: 8,
  charge: 0.25, chargeMax: 6,
  wickHot: 0.08, wickMax: 6,
  watchInterest: 0.01, watchMax: 3,
  ticketPer3: 0.02, ticketCap: 0.2,
  lastGasp: 1.4,
  gildedMax: 1.25, gildedLow: 0.9,
  ceiling: 2.4,
};

export const ENGINE_EVO_TUNE: EngineTune = {
  rung: 0.16, rungMax: 8,
  pressure: 0.14, pressureMax: 10,
  charge: 0.3, chargeMax: 7,
  wickHot: 0.1, wickMax: 6,
  watchInterest: 0.01, watchMax: 4,
  ticketPer3: 0.03, ticketCap: 0.2,
  lastGasp: 1.6,
  gildedMax: 1.4, gildedLow: 0.8,
  ceiling: 2.9,
};

/** True when a charm's bag marks it evolved (its second stack; set by charms/engine.ts). */
export const isEvo = (data: Readonly<Record<string, Json>> | undefined): boolean => data?.evo === true;
/** The tune of one charm, from its bag. */
export const tuneOf = (data: Readonly<Record<string, Json>> | undefined): EngineTune => (isEvo(data) ? ENGINE_EVO_TUNE : ENGINE_BASE_TUNE);

const num = (v: Json | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const mult = (value: number): ModEffect[] => [{ hook: 'payout.mult', op: 'mult', value }];
const inc = (value: number): ModEffect[] => (value > 0 ? [{ hook: 'payout.mult', op: 'inc', value }] : []);
const isWin = (p: { gross: number; bet: number }): boolean => p.gross > p.bet;
/** Proc label for a payout multiplier, e.g. "×1.3" (two decimals at most). */
const xLabel = (v: number): string => `×${Math.round(v * 100) / 100}`;

/**
 * Stand-in for `suitOf` from `src/game/suits.ts` (that file has not landed). Reads the suit family from a play's
 * machine tags, `wheel` read as `wheels`. Returns null for a play with no suit family (it does not move Suit Ladder).
 * Swap for `suitOf(machineId)` once suits.ts exists.
 */
export function suitOfTags(tags: readonly string[]): string | null {
  for (const t of tags) {
    const family = t === 'wheel' ? 'wheels' : t;
    if ((SUIT_FAMILY_TAGS as readonly string[]).includes(family)) return family;
  }
  return null;
}

const DEF_BY_ID: ReadonlyMap<string, CharmDef> = new Map(
  [...CHARM_DATA, ...CHARM_ENGINE_DATA].map((d) => [d.id, d] as const),
);

interface Ranked { def: CharmDef; data: Record<string, Json> }

/** The copy engines. Neither copies the other or itself, so a copy never recurses. */
const COPY_IDS: ReadonlySet<string> = new Set(['understudy', 'mimic']);

/**
 * Copy targets: owned charms that are neither Legendary nor Cursed (and not a copy engine), most expensive first.
 * Ties keep the order they were acquired in. The Mimic reads the same list from the other end (cheapest first).
 */
function understudyRanked(live: EngineLive): Ranked[] {
  const out: Ranked[] = [];
  for (const s of live.run.charms(live.pid)) {
    if (COPY_IDS.has(s.id)) continue;
    const def = DEF_BY_ID.get(s.id);
    if (!def || def.rarity === 'legendary' || def.rarity === 'cursed') continue;
    const data = s.data && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : {};
    out.push({ def, data: data as Record<string, Json> });
  }
  return out.sort((a, b) => b.def.price - a.def.price);
}

/** Copycat set on: two distinct owned charms carry the copycat tag (the Understudy is one of them). */
function copycatSetOn(live: EngineLive): boolean {
  const held = live.run.charms(live.pid);
  return activeSets(held, (id) => DEF_BY_ID.get(id)?.tags).includes('copycat');
}

/** Turnstile numbers: payout per Turn and the Turn cap (four; six evolved). Its list of machines is kept to six. */
const TURNSTILE_BASE = { per: 0.08, max: 4 };
const TURNSTILE_EVO = { per: 0.12, max: 6 };
const turnstileTune = (d: Readonly<Record<string, Json>>): { per: number; max: number } => (isEvo(d) ? TURNSTILE_EVO : TURNSTILE_BASE);
/** The machines a Turnstile has counted this Watch. */
const seenList = (d: Readonly<Record<string, Json>>): string[] => (Array.isArray(d.seen) ? d.seen : []).filter((s): s is string => typeof s === 'string');
/** Turns held now: the machines counted this Watch, up to the cap. */
const turnsOf = (d: Readonly<Record<string, Json>>): number => Math.min(turnstileTune(d).max, seenList(d).length);

export const ENGINE_BEHAVIOURS: Readonly<Record<string, Behaviour>> = {
  /** A play on a different suit than the last one: +1 Rung (max 6, 8 evolved). Same suit as the last play: −3 Rungs. */
  suit_ladder: {
    badge: (d) => num(d.rungs) || null,
    on: {
      'machine:result': (p, c) => {
        const tu = tuneOf(c.data);
        // The win's payout read the Rungs before this play, so the proc uses the count from before this handler moves them.
        const before = num(c.data.rungs);
        if (isWin(p) && before > 0) c.proc(before, xLabel(1 + tu.rung * before));
        const suit = suitOfTags(p.tags) ?? suitOf(p.machineId)?.toLowerCase() ?? null;
        if (!suit) return;
        const last = c.data.last;
        if (typeof last === 'string') {
          c.data.rungs = last === suit ? Math.max(0, before - 3) : Math.min(tu.rungMax, before + 1);
        }
        c.data.last = suit;
      },
    },
  },
  /** A loss stores Pressure (max 8, 10 evolved); a win spends it (the win's payout is read before this handler runs). */
  pressure_valve: {
    badge: (d) => num(d.pressure) || null,
    on: {
      'machine:result': (p, c) => {
        const tu = tuneOf(c.data);
        const before = num(c.data.pressure);
        if (isWin(p)) {
          if (before > 0) c.proc(before, xLabel(1 + tu.pressure * before));
          c.data.pressure = 0;
        } else {
          c.data.pressure = Math.min(tu.pressureMax, before + 1);
        }
      },
    },
  },
  /** Plays on Cold or tilted machines store charge (max 6, 7 evolved); the next win on a Hot machine spends it. */
  capacitor: {
    badge: (d) => num(d.charge) || null,
    on: {
      'machine:result': (p, c) => {
        const tu = tuneOf(c.data);
        const tilt = circuitView(c.run)?.tilt(p.mid);
        if (!tilt) return;
        if (tilt.hot) {
          if (isWin(p)) {
            const charge = num(c.data.charge);
            if (charge > 0) c.proc(charge, xLabel(1 + tu.charge * charge));
            c.data.charge = 0;
          }
          return;
        }
        if (tilt.cold || tilt.factor < 1) c.data.charge = Math.min(tu.chargeMax, num(c.data.charge) + 1);
      },
    },
  },
  /** A win on a Hot machine adds a wick (max 6, until Dawn). */
  lampwick: {
    badge: (d) => num(d.wicks) || null,
    on: {
      'machine:result': (p, c) => {
        const tu = tuneOf(c.data);
        if (!isWin(p) || num(c.data.wicks) >= tu.wickMax) return;
        const hot = circuitView(c.run)?.lamps().hot.some((e) => e.mid === p.mid) ?? false;
        if (!hot) return;
        c.data.wicks = num(c.data.wicks) + 1;
        const w = num(c.data.wicks);
        c.proc(w, `+${Math.round(tu.wickHot * 100 * w)}%`);
      },
      'run:window': (p, c) => { if (p.window === 'dawn') c.data.wicks = 0; },
    },
  },
  /** A win of ×5 or more prints a Ticket. */
  ticket_press: {
    on: {
      'machine:result': (p, c) => {
        const tu = tuneOf(c.data);
        if (p.bet <= 0 || p.gross < p.bet * 5) return;
        c.run.earn('ticket', 1, 'charm:ticket_press', c.pid);
        const n = c.run.balance('ticket', c.pid);
        const pct = Math.min(tu.ticketCap, tu.ticketPer3 * Math.floor(n / 3));
        c.proc(Math.floor(n / 3), `+${Math.round(pct * 100)}%`);
      },
    },
  },
  /** Each Watch settled with at least 25 % of the quota deposited: +1 Watch (max 3, 4 evolved). Reset at Dawn. */
  snowball_ledger: {
    badge: (d) => num(d.watches) || null,
    on: {
      'shift:phase': (p, c) => {
        if (p.phase !== 'settle' || c.run.shift.quota().ratio < 0.25) return;
        c.data.watches = Math.min(tuneOf(c.data).watchMax, num(c.data.watches) + 1);
      },
      'run:window': (p, c) => { if (p.window === 'dawn') c.data.watches = 0; },
    },
  },
  /** Each machine played for the first time this Watch adds a Turn (the list keeps six machines, the cap is four, six evolved). */
  turnstile: {
    badge: (d) => turnsOf(d) || null,
    on: {
      'machine:result': (p, c) => {
        const seen = seenList(c.data);
        if (seen.includes(p.mid) || seen.length >= TURNSTILE_EVO.max) return;
        c.data.seen = [...seen, p.mid];
      },
      'shift:phase': (p, c) => { if (p.phase === 'bell') c.data.seen = []; },
    },
  },
};

export const ENGINE_DYNAMIC_EFFECTS: Readonly<Record<string, EngineDynamic>> = {
  /** ×(1 + 0.12 per Rung), at most ×1.72 (0.16 per Rung and ×2.28 at eight evolved). */
  suit_ladder: (c) => {
    const r = num(c.data.rungs);
    return r > 0 ? mult(1 + tuneOf(c.data).rung * r) : [];
  },
  /** ×(1 + 0.10 per Pressure), at most ×1.8 (0.14 per Pressure, ×2.4 at ten evolved). */
  pressure_valve: (c) => {
    const p = num(c.data.pressure);
    return p > 0 ? mult(1 + tuneOf(c.data).pressure * p) : [];
  },
  /** ×(1 + 0.25 per charge), at most ×2.5 (0.30 per charge, ×3.1 at seven evolved), on Hot machines only. */
  capacitor: (c) => {
    const charge = num(c.data.charge);
    const hot = circuitView(c.run)?.lamps().hot.map((e) => e.mid) ?? [];
    if (charge <= 0 || hot.length === 0) return [];
    return [{ hook: 'payout.mult', op: 'mult', value: 1 + tuneOf(c.data).charge * charge, scope: { instances: hot } }];
  },
  /** +0.08 to the Hot multiplier per wick, at most +0.48 (six wicks); +0.10 per wick evolved. */
  lampwick: (c) => {
    const w = num(c.data.wicks);
    return w > 0 ? [{ hook: 'x.lamp.hotMult', op: 'add', value: tuneOf(c.data).wickHot * w }] : [];
  },
  /** +2 % per 3 Tickets held, at most +20 % (30 Tickets). +3 % per 3 evolved. Additive. */
  ticket_press: (c) => {
    const tu = tuneOf(c.data);
    return inc(Math.min(tu.ticketCap, tu.ticketPer3 * Math.floor(c.run.balance('ticket', c.pid) / 3)));
  },
  /** ×1.4 during the last Watch's Last Call while the quota is unmet (×1.6 evolved). */
  last_gasp: (c) => {
    const st = c.run.shift.state();
    const q = c.run.shift.quota();
    const lastWatch = !st.segment || st.segment.index >= st.segment.count - 1;
    return st.phase === 'lastCall' && lastWatch && !q.met ? mult(tuneOf(c.data).lastGasp) : [];
  },
  /** ×1.25 at max bet (×1.4 evolved); ×0.9 below half of max bet (×0.8 evolved). Reads `q.ctx.betFrac`. */
  gilded_chip: (c, q) => {
    const f = q?.ctx?.betFrac;
    const tu = tuneOf(c.data);
    if (typeof f !== 'number') return [];
    if (f >= 1 - 1e-9) return mult(tu.gildedMax);
    if (f < 0.5) return mult(tu.gildedLow);
    return [];
  },
  /**
   * +1 % interest per settled Watch (max 3, 4 evolved), on the interest hook the economy reads at Dawn.
   * The Watch count and the rate are the base charm's; the cap is what the evolution raises.
   */
  snowball_ledger: (c) => {
    const n = num(c.data.watches);
    return n > 0 ? [{ hook: 'x.econ.interestAdd', op: 'add', value: tuneOf(c.data).watchInterest * n }] : [];
  },
  /**
   * House Limit: the base ×2.4 is declarative; the evolved charm adds the difference to ×2.9 here (the fold has no
   * per-stack scaling for engine charms, so the correction is a plain multiplier).
   */
  false_ceiling: (c) => {
    if (!isEvo(c.data)) return [];
    return [{ hook: 'x.house.limitMult', op: 'mult', value: ENGINE_EVO_TUNE.ceiling / ENGINE_BASE_TUNE.ceiling }];
  },
  /**
   * Copies the declarative effects and the per-instant effects (with each target's own bag) of the most expensive owned
   * charms that are not Legendary or Cursed: one target, or two when the Understudy is evolved. While the Copycat set
   * is on, one more effect is copied: the first declarative effect of the next target. Triggers (`on`) are never copied.
   */
  understudy: (live, q) => copyFrom(live, q, understudyRanked(live), isEvo(live.data) ? 2 : 1),
  /**
   * Copies the cheapest owned charms (not Legendary, not Cursed, not a copy engine), one or two when evolved. The Copycat set
   * adds one more effect, as for the Understudy.
   */
  mimic: (live, q) => copyFrom(live, q, [...understudyRanked(live)].reverse(), isEvo(live.data) ? 2 : 1),
  /** ×(1 + 0.08 per Turn), at most ×1.32 (0.12 per Turn, ×1.72 at six Turns evolved). */
  turnstile: (c) => {
    const n = turnsOf(c.data);
    return n > 0 ? mult(1 + turnstileTune(c.data).per * n) : [];
  },
};

/**
 * The effects a copy engine copies: the declarative and the per-instant effects (with each target's own bag) of the first
 * `take` targets in `order`. While the Copycat set is on, the first declarative effect of the next target is copied too.
 * Triggers (`on`) are never copied.
 */
function copyFrom(live: EngineLive, q: ModQuery | undefined, order: readonly Ranked[], take: number): ModEffect[] {
  const copied: ModEffect[] = [];
  for (const t of order.slice(0, take)) {
    copied.push(...(t.def.effects ?? []));
    const dyn = ENGINE_DYNAMIC_EFFECTS[t.def.id] ?? DYNAMIC_EFFECTS[t.def.id];
    if (dyn) {
      const target: EngineLive = { data: t.data, run: live.run, pid: live.pid };
      copied.push(...(dyn as EngineDynamic)(target, q));
    }
  }
  if (copycatSetOn(live)) {
    const extra = order.slice(take).flatMap((t) => t.def.effects ?? []);
    if (extra.length) copied.push(extra[0]);
  }
  return copied;
}
