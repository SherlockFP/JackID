/**
 * THE HOME COMPUTER (wave 77, money with purpose): the state behind the old PC on the apartment desk. Two apps share it:
 * INVESTMENTS (ventures that pay at every paid Dawn, see `ventures.ts`) and MARKET (food for the fridge, two home upgrades and a
 * reroll slip, see `market.ts`). The run creates it for a Home-layer run, pays `dawn()` at each paid Dawn, calls `newNight()` when
 * a Night begins, and saves `snapshot()` under `RunExt.econ`. Buying and selling only happen in the Evening (`port.open()`).
 *
 * Events: `econ:dawn` (the ventures paid) and `econ:frame` (the frame's star at the start of a Night, the luck meter listens). Food
 * goes into the food lane's fridge (src/game/food.ts `addToFridge`) through the port. Sim only: no DOM, no wall clock, seeded rolls.
 */
import { bus } from '@/core/events';
import { BASE_RUN_NIGHTS, quotaFor } from '../data/schedule';
import { MARKET, MARKET_IDS, marketDef, type MarketId, type UpgradeId, FRAME_STARS } from './market';
import {
  VENTURES, VENTURE_IDS, freezeCount, growthOf, meanPay, paybackNights, rollDawn, sellValue, ventureDef,
  type DawnPay, type Holdings, type VentureId,
} from './ventures';

declare module '@/core/events' {
  interface GameEvents {
    /** The ventures paid at a Dawn (wave 77). `total` is already in the pocket. */
    'econ:dawn': DawnPay;
    /** The frame's star at the start of a Night (wave 77): the luck meter moves by `star`. */
    'econ:frame': FrameEvent;
  }
}

export interface FrameEvent { night: number; star: number }

/** What the economy needs from the run. */
export interface EconPort {
  readonly seed: number;
  /** The printed Night (1-based) the run is on. */
  night(): number;
  /** Nights paid so far (the run goal reads it). */
  nightsPaid(): number;
  wallet(): number;
  spend(n: number, why: string): boolean;
  earn(n: number, why: string): void;
  /** The Collector's Heat 0..6 (0 without the phone). */
  heat(): number;
  /** One free Pawn reroll (the MARKET's slip). */
  addFreeReroll(n: number): void;
  /** Room left in the fridge, and one meal into it (the food lane's fridge). */
  fridgeRoom(): number;
  deliver(food: string): boolean;
  /** The computer may trade now (the Evening at home). */
  open(): boolean;
}

export type TradeResult = 'ok' | 'closed' | 'locked' | 'cap' | 'short' | 'none' | 'owned' | 'limit' | 'full';

export interface VentureView {
  id: VentureId; price: number; held: number; cap: number;
  /** Average pay of a new one at a Dawn, and of the ones held now (growth included). */
  mean: number; meanHeld: number;
  /** The best growth among the ones held (1 = new). */
  growth: number;
  payback: number; sell: number; locked: boolean; from: number;
}
export interface MarketView { id: MarketId; price: number; kind: 'food' | 'upgrade' | 'slip'; owned: boolean; left: number; locked: boolean; from: number }

/** The run goal on the computer's home screen: the ladder still owed to the House. */
export interface RunGoal { paid: number; total: number; left: number; nightsPaid: number; nights: number }

export interface EconSave {
  v: 1;
  /** One age (Dawns paid) per unit held. */
  held: Holdings;
  upgrades: UpgradeId[];
  /** The Night whose Evening the per-Evening counts belong to, and the counts. */
  limNight: number;
  bought: Partial<Record<MarketId, number>>;
  /** The last Dawn's pay (the home screen shows it). */
  last: DawnPay | null;
  /** Coins the ventures have paid this run, and coins spent at the computer. */
  earned: number;
  spent: number;
}

export interface HomeEconomy {
  ventures(): VentureView[];
  market(): MarketView[];
  held(id: VentureId): number;
  has(u: UpgradeId): boolean;
  buyVenture(id: string): TradeResult;
  sellVenture(id: string): TradeResult;
  buyItem(id: string): TradeResult;
  /** The average coins the ventures pay at a Dawn (before any freeze). */
  incomeMean(): number;
  /** What every venture held would sell for now. */
  worth(): number;
  /** How many units the Collector would freeze at the next Dawn at today's Heat. */
  freezeNext(): number;
  goal(): RunGoal;
  lastDawn(): DawnPay | null;
  totals(): { earned: number; spent: number };
  /** A paid Dawn: every venture pays (seeded) into the pocket. Returns the report (total 0 when nothing is held). */
  dawn(night: number): DawnPay;
  /** A Night begins: the per-Evening limits reset and the frame gives its star. */
  newNight(night: number): void;
  snapshot(): EconSave;
  restore(s: unknown): void;
}

/** The plain ladder (no notice, no discount) for the Nights not yet paid: what the House is still owed. */
export function runGoal(nightsPaid: number, nights = BASE_RUN_NIGHTS): RunGoal {
  let total = 0, paid = 0;
  for (let i = 0; i < nights; i++) {
    const q = quotaFor(i);
    total += q;
    if (i < nightsPaid) paid += q;
  }
  return { paid, total, left: Math.max(0, total - paid), nightsPaid: Math.min(nightsPaid, nights), nights };
}

const int = (v: unknown, lo = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.floor(v)) : lo);

function freshSave(): EconSave {
  return { v: 1, held: {}, upgrades: [], limNight: 0, bought: {}, last: null, earned: 0, spent: 0 };
}

export function createHomeEconomy(port: EconPort): HomeEconomy {
  let st = freshSave();

  const held = (id: VentureId): number => st.held[id]?.length ?? 0;
  const ages = (id: VentureId): number[] => st.held[id] ?? [];
  const has = (u: UpgradeId): boolean => st.upgrades.includes(u);
  /** The per-Evening counts belong to the Night on now; a new Night clears them. */
  const bought = (id: MarketId): number => (st.limNight === port.night() ? st.bought[id] ?? 0 : 0);
  const pay = (n: number, why: string): boolean => {
    if (!port.spend(n, why)) return false;
    st.spent += n;
    return true;
  };

  const api: HomeEconomy = {
    ventures: () => VENTURE_IDS.map((id) => {
      const d = VENTURES[id];
      const a = ages(id);
      return {
        id, price: d.price, held: a.length, cap: d.cap, mean: Math.round(meanPay(d) * 10) / 10,
        meanHeld: Math.round(a.reduce((s, age) => s + meanPay(d, age), 0) * 10) / 10,
        growth: a.reduce((g, age) => Math.max(g, growthOf(age)), 1),
        payback: paybackNights(d), sell: sellValue(d), locked: port.night() < d.from, from: d.from,
      };
    }),
    market: () => MARKET_IDS.map((id) => {
      const d = MARKET[id];
      const owned = d.kind === 'upgrade' && has(id as UpgradeId);
      const left = d.perEvening > 0 ? Math.max(0, d.perEvening - bought(id)) : owned ? 0 : 1;
      return { id, price: d.price, kind: d.kind, owned, left, locked: port.night() < d.from, from: d.from };
    }),
    held,
    has,
    buyVenture(id) {
      const d = ventureDef(id);
      if (!d) return 'none';
      if (!port.open()) return 'closed';
      if (port.night() < d.from) return 'locked';
      if (held(d.id) >= d.cap) return 'cap';
      if (!pay(d.price, `econ:venture:${d.id}`)) return 'short';
      st.held[d.id] = [...ages(d.id), 0];
      return 'ok';
    },
    sellVenture(id) {
      const d = ventureDef(id);
      if (!d) return 'none';
      if (!port.open()) return 'closed';
      if (held(d.id) <= 0) return 'none';
      // the newest one goes: the grown ones keep their regulars
      const a = [...ages(d.id)].sort((x, y) => y - x);
      a.pop();
      if (a.length > 0) st.held[d.id] = a; else delete st.held[d.id];
      port.earn(sellValue(d), `econ:sell:${d.id}`);
      return 'ok';
    },
    buyItem(id) {
      const d = marketDef(id);
      if (!d) return 'none';
      if (!port.open()) return 'closed';
      if (port.night() < d.from) return 'locked';
      if (d.kind === 'upgrade' && has(d.id as UpgradeId)) return 'owned';
      if (d.perEvening > 0 && bought(d.id) >= d.perEvening) return 'limit';
      const meals = d.food ? Object.values(d.food).reduce((a, n) => a + n, 0) : 0;
      if (meals > port.fridgeRoom()) return 'full';
      if (!pay(d.price, `econ:market:${d.id}`)) return 'short';
      if (st.limNight !== port.night()) { st.limNight = port.night(); st.bought = {}; }
      st.bought[d.id] = (st.bought[d.id] ?? 0) + 1;
      if (d.kind === 'upgrade') st.upgrades.push(d.id as UpgradeId);
      else if (d.kind === 'slip') port.addFreeReroll(1);
      else if (d.food) for (const [food, n] of Object.entries(d.food)) for (let i = 0; i < n; i++) port.deliver(food);
      return 'ok';
    },
    incomeMean: () => Math.round(VENTURE_IDS.reduce((s, id) => s + ages(id).reduce((t, age) => t + meanPay(VENTURES[id], age), 0), 0)),
    worth: () => VENTURE_IDS.reduce((s, id) => s + held(id) * sellValue(VENTURES[id]), 0),
    freezeNext: () => {
      const units = VENTURE_IDS.reduce((s, id) => s + held(id), 0);
      return Math.min(units, freezeCount(port.heat()));
    },
    goal: () => runGoal(port.nightsPaid()),
    lastDawn: () => st.last,
    totals: () => ({ earned: st.earned, spent: st.spent }),
    dawn(night) {
      const { after, ...r } = rollDawn(port.seed, night, st.held, port.heat());
      if (r.lines.length === 0) return r;
      st.held = after;
      if (r.total > 0) port.earn(r.total, 'econ:dawn');
      st.earned += r.total;
      st.last = r;
      bus.emit('econ:dawn', r);
      return r;
    },
    newNight(night) {
      st.limNight = night;
      st.bought = {};
      if (has('frame')) bus.emit('econ:frame', { night, star: FRAME_STARS });
    },
    snapshot: () => JSON.parse(JSON.stringify(st)) as EconSave,
    restore(s) {
      st = freshSave();
      if (!s || typeof s !== 'object') return;
      const o = s as Partial<EconSave>;
      for (const id of VENTURE_IDS) {
        const raw: unknown = o.held?.[id];
        // older shapes: a bare count reads as that many new ones
        const list = Array.isArray(raw) ? raw.map((x) => int(x)) : Array.from({ length: int(raw) }, () => 0);
        if (list.length > 0) st.held[id] = list.slice(0, VENTURES[id].cap);
      }
      if (Array.isArray(o.upgrades)) for (const u of o.upgrades) if ((u === 'deadbolt' || u === 'frame') && !st.upgrades.includes(u)) st.upgrades.push(u);
      st.limNight = int(o.limNight);
      if (o.bought && typeof o.bought === 'object') for (const id of MARKET_IDS) { const n = int(o.bought[id]); if (n > 0) st.bought[id] = n; }
      st.last = o.last && typeof o.last === 'object' && Array.isArray(o.last.lines) ? o.last : null;
      st.earned = int(o.earned);
      st.spent = int(o.spent);
    },
  };
  return api;
}
