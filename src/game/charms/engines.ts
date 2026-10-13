/**
 * Behaviours of the ten engine charms (wave 8, item 3). Data: `data/charmsEngines.ts`. Same two channels as
 * `charms/behaviours.ts`:
 *  - `ENGINE_BEHAVIOURS[id].on` reacts to bus events and writes the charm's data bag;
 *  - `ENGINE_DYNAMIC_EFFECTS[id](live, q?)` returns this instant's ModEffects. `q.ctx.betFrac` is read by Gilded Chip.
 * Payout bonuses are `mult` (M) or `inc` (A) as the plan requires. Integrator: spread both maps into the engine tables
 * and widen `DynamicEffects` to `(live, q?)`.
 */
import type { CharmDef, ModEffect, ModQuery } from '@/game/types';
import type { Json, PlayerId } from '@/core/types';
import { circuitView } from '@/game/circuit';
import { suitOf } from '@/game/suits';
import { CHARM_DATA } from '@/game/data/charms';
import { CHARM_ENGINE_DATA, SUIT_FAMILY_TAGS } from '@/game/data/charmsEngines';
import { DYNAMIC_EFFECTS, type LiveCharm } from './behaviours';

/** What a dynamic effect may read: the charm's bag, the run, and the owner (for charm lookups). No rng, no side effects. */
export interface EngineLive extends LiveCharm { pid?: PlayerId }
export type EngineDynamic = (live: EngineLive, q?: ModQuery) => ModEffect[];
type Behaviour = Partial<Pick<CharmDef, 'on' | 'badge'>>;

const num = (v: Json | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const mult = (value: number): ModEffect[] => [{ hook: 'payout.mult', op: 'mult', value }];
const inc = (value: number): ModEffect[] => (value > 0 ? [{ hook: 'payout.mult', op: 'inc', value }] : []);
const isWin = (p: { gross: number; bet: number }): boolean => p.gross > p.bet;

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

/** Understudy target: the most expensive owned charm that is neither Legendary nor Cursed (first owned wins ties). */
function understudyTarget(live: EngineLive): { def: CharmDef; data: Record<string, Json> } | null {
  let best: { def: CharmDef; data: Record<string, Json> } | null = null;
  for (const s of live.run.charms(live.pid)) {
    if (s.id === 'understudy') continue;
    const def = DEF_BY_ID.get(s.id);
    if (!def || def.rarity === 'legendary' || def.rarity === 'cursed') continue;
    if (!best || def.price > best.def.price) {
      const data = s.data && typeof s.data === 'object' && !Array.isArray(s.data) ? s.data : {};
      best = { def, data: data as Record<string, Json> };
    }
  }
  return best;
}

export const ENGINE_BEHAVIOURS: Readonly<Record<string, Behaviour>> = {
  /** A play on a different suit than the last one: +1 Rung (max 6). Same suit as the last play: −3 Rungs. */
  suit_ladder: {
    badge: (d) => num(d.rungs) || null,
    on: {
      'machine:result': (p, c) => {
        const suit = suitOfTags(p.tags) ?? suitOf(p.machineId)?.toLowerCase() ?? null;
        if (!suit) return;
        const last = c.data.last;
        if (typeof last === 'string') {
          c.data.rungs = last === suit ? Math.max(0, num(c.data.rungs) - 3) : Math.min(6, num(c.data.rungs) + 1);
        }
        c.data.last = suit;
      },
    },
  },
  /** A loss stores Pressure (max 8); a win spends it (the win's payout is read before this handler runs). */
  pressure_valve: {
    badge: (d) => num(d.pressure) || null,
    on: {
      'machine:result': (p, c) => {
        c.data.pressure = isWin(p) ? 0 : Math.min(8, num(c.data.pressure) + 1);
      },
    },
  },
  /** Plays on Cold or tilted machines store charge (max 6); the next win on a Hot machine spends it. */
  capacitor: {
    badge: (d) => num(d.charge) || null,
    on: {
      'machine:result': (p, c) => {
        const tilt = circuitView(c.run)?.tilt(p.mid);
        if (!tilt) return;
        if (tilt.hot) {
          if (isWin(p)) c.data.charge = 0;
          return;
        }
        if (tilt.cold || tilt.factor < 1) c.data.charge = Math.min(6, num(c.data.charge) + 1);
      },
    },
  },
  /** A win on a Hot machine adds a wick (max 6, until Dawn). */
  lampwick: {
    badge: (d) => num(d.wicks) || null,
    on: {
      'machine:result': (p, c) => {
        if (!isWin(p) || num(c.data.wicks) >= 6) return;
        const hot = circuitView(c.run)?.lamps().hot.some((e) => e.mid === p.mid) ?? false;
        if (!hot) return;
        c.data.wicks = num(c.data.wicks) + 1;
        const w = num(c.data.wicks);
        c.proc(w, `+${8 * w}%`);
      },
      'run:window': (p, c) => { if (p.window === 'dawn') c.data.wicks = 0; },
    },
  },
  /** A win of ×5 or more prints a Ticket. */
  ticket_press: {
    on: {
      'machine:result': (p, c) => {
        if (p.bet <= 0 || p.gross < p.bet * 5) return;
        c.run.earn('ticket', 1, 'charm:ticket_press', c.pid);
        const n = c.run.balance('ticket', c.pid);
        c.proc(Math.floor(n / 3), `+${Math.min(20, 2 * Math.floor(n / 3))}%`);
      },
    },
  },
  /** Each Watch settled with at least 25 % of the quota deposited: +1 Watch (max 3). Reset at Dawn. */
  snowball_ledger: {
    badge: (d) => num(d.watches) || null,
    on: {
      'shift:phase': (p, c) => {
        if (p.phase !== 'settle' || c.run.shift.quota().ratio < 0.25) return;
        c.data.watches = Math.min(3, num(c.data.watches) + 1);
      },
      'run:window': (p, c) => { if (p.window === 'dawn') c.data.watches = 0; },
    },
  },
};

export const ENGINE_DYNAMIC_EFFECTS: Readonly<Record<string, EngineDynamic>> = {
  /** ×(1 + 0.12 per Rung), at most ×1.72. */
  suit_ladder: (c) => {
    const r = num(c.data.rungs);
    return r > 0 ? mult(1 + 0.12 * r) : [];
  },
  /** ×(1 + 0.10 per Pressure), at most ×1.8. */
  pressure_valve: (c) => {
    const p = num(c.data.pressure);
    return p > 0 ? mult(1 + 0.10 * p) : [];
  },
  /** ×(1 + 0.25 per charge), at most ×2.5, on Hot machines only (scoped to the Hot instances this Watch). */
  capacitor: (c) => {
    const charge = num(c.data.charge);
    const hot = circuitView(c.run)?.lamps().hot.map((e) => e.mid) ?? [];
    if (charge <= 0 || hot.length === 0) return [];
    return [{ hook: 'payout.mult', op: 'mult', value: 1 + 0.25 * charge, scope: { instances: hot } }];
  },
  /** +0.08 to the Hot multiplier per wick, at most +0.48 (six wicks). */
  lampwick: (c) => {
    const w = num(c.data.wicks);
    return w > 0 ? [{ hook: 'x.lamp.hotMult', op: 'add', value: 0.08 * w }] : [];
  },
  /** +2 % per 3 Tickets held, at most +20 % (30 Tickets). Additive. */
  ticket_press: (c) => inc(Math.min(0.2, 0.02 * Math.floor(c.run.balance('ticket', c.pid) / 3))),
  /** ×1.4 during the last Watch's Last Call while the quota is unmet. */
  last_gasp: (c) => {
    const st = c.run.shift.state();
    const q = c.run.shift.quota();
    const lastWatch = !st.segment || st.segment.index >= st.segment.count - 1;
    return st.phase === 'lastCall' && lastWatch && !q.met ? mult(1.4) : [];
  },
  /** ×1.25 at max bet (betFrac 1); ×0.9 below half of max bet. Reads `q.ctx.betFrac`, so win() must pass it. */
  gilded_chip: (_c, q) => {
    const f = q?.ctx?.betFrac;
    if (typeof f !== 'number') return [];
    if (f >= 1 - 1e-9) return mult(1.25);
    if (f < 0.5) return mult(0.9);
    return [];
  },
  /** +1 % interest per settled Watch (max 3), on the interest hook the economy reads at Dawn. */
  snowball_ledger: (c) => {
    const n = num(c.data.watches);
    return n > 0 ? [{ hook: 'x.econ.interestAdd', op: 'add', value: 0.01 * n }] : [];
  },
  /**
   * Copies the target's declarative effects and its per-instant effects (with the target's own bag). Target = most
   * expensive owned charm that is not Legendary or Cursed. Triggers (`on`) are never copied.
   */
  understudy: (live, q) => {
    const t = understudyTarget(live);
    if (!t) return [];
    const copied: ModEffect[] = [...(t.def.effects ?? [])];
    const dyn = ENGINE_DYNAMIC_EFFECTS[t.def.id] ?? DYNAMIC_EFFECTS[t.def.id];
    if (dyn) {
      const target: EngineLive = { data: t.data, run: live.run, pid: live.pid };
      copied.push(...(dyn as EngineDynamic)(target, q));
    }
    return copied;
  },
};
