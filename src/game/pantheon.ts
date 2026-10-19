/**
 * The pantheon (docs/BLESSINGS.md §2, wave B1): the House's owners give the run's ONE free pick. At every paid Dawn from Night 1 on
 * (`FIRST_OFFER_NIGHT`) the run offers a seeded set of boons from different gods; a boon lasts the whole run. This replaces the
 * Night Cards (`nightCards.ts`), the Starter Draft, the overpay charm picks and the shrine's random buffs. Pure: no DOM, no run
 * import; the offer is a function of an rng, the printed Night and a small context, so a seed always shows the same cards.
 *
 * Effects are data. A boon's `effects` are ordinary run-level {@link ModEffect}s folded through the unified pipeline (core hooks
 * and `x.*` hooks). Its `fx` are the few numbers that have no hook (a reader in `run.ts` / `luck.ts` calls {@link Pantheon.fx}
 * with the key and gets the sum over the boons kept). `once` boons (Rites that fire a single time) stop counting after
 * {@link Pantheon.spend}.
 *
 * Night numbers here are PRINTED Nights of the paid Night whose Dawn is open (Night 1 passes 1), like `NightCards.openOffer`.
 */
import { createRng, hashSeed } from '@/core/rng';
import type { Rng } from '@/core/rng';
import type { ModEffect, ModProvider, ModQuery, ModSource, ModSourceKind } from './modifiers.types';

/** The first offer opens at the Dawn of this printed Night (client answer: Night 1's Dawn). */
export const FIRST_OFFER_NIGHT = 1;
/** The Lord of Mirrors joins the offers from this printed Night. */
export const MIRRORS_NIGHT = 4;
/** Duos and Rites are offered from this printed Night. */
export const RITE_NIGHT = 5;
/** Loki's swap opens at this printed Night. */
export const SWAP_NIGHT = 3;
/** Seconds the offer waits before the leftmost card is taken for the player. */
export const OFFER_TIMEOUT_SEC = 20;
/** Favour per god runs 0..this. At the top the god's Rite can be offered. */
export const FAVOUR_MAX = 3;
/** At most this many duo boons a run. */
export const DUOS_MAX = 2;
/** All boon payout multipliers together stay at or under this (like the stamp build cap). */
export const PAYOUT_CAP = 1.35;
/** Ink Loki's swap costs (docs/BLESSINGS.md §2.1; paid through the Joker, which keeps the cap). */
export const LOKI_SWAP_INK = 1;
/** `x.payout.atDread` applies at this Dread and above (Still Face). */
export const STILL_FACE_DREAD = 60;

export type GodId = 'well' | 'ledgers' | 'ash' | 'mirrors' | 'loki';
/** The four owners that hold Favour and appear in offers (Loki only swaps in). */
export const OWNERS: readonly GodId[] = ['well', 'ledgers', 'ash', 'mirrors'];
const OFFER_GODS: readonly GodId[] = ['well', 'ledgers', 'ash', 'mirrors'];

export type BoonKind = 'boon' | 'rite' | 'duo';

/** A boon, Rite or duo. `god2` is set on duos only. */
export interface BoonDef {
  id: string;
  god: GodId;
  god2?: GodId;
  kind: BoonKind;
  effects: readonly ModEffect[];
  /** Non-hook numbers a reader sums by key (see the doc's Hook column). */
  fx?: Readonly<Record<string, number>>;
  /** A Rite that fires once: {@link Pantheon.spend} retires it. */
  once?: boolean;
  /** Loki's price: Ink paid once when kept (docs/BLESSINGS.md §7 answer 3). The run pays it with `joker.payInk`. */
  ink?: number;
}

const e = (hook: ModEffect['hook'], op: ModEffect['op'], value: number, priority?: number): ModEffect =>
  priority === undefined ? { hook, op, value } : { hook, op, value, priority };

/** The data: 5 boons + 1 Rite for each owner, 4 for Loki, 6 duos (docs/BLESSINGS.md §2.3). */
export const BOONS: readonly BoonDef[] = [
  // The Well
  { id: 'well_penny', god: 'well', kind: 'boon', effects: [e('x.luck.perStar', 'add', 0.005)], fx: { starNow: 1 } },
  { id: 'well_soft', god: 'well', kind: 'boon', effects: [e('x.luck.failSoft', 'add', 1)] },
  { id: 'well_warm', god: 'well', kind: 'boon', effects: [e('x.lamp.hotMult', 'mult', 1.3)] },
  { id: 'well_lamps', god: 'well', kind: 'boon', effects: [e('x.lamp.hotCount', 'add', 1), e('quota.mult', 'mult', 1.05)] },
  { id: 'well_wish', god: 'well', kind: 'boon', effects: [e('jackpot.mult', 'mult', 1.5)] },
  { id: 'well_answer', god: 'well', kind: 'rite', effects: [e('x.luck.max', 'add', 2)], fx: { starEachDawn: 1 } },
  // Lord of Ledgers
  { id: 'ledg_compound', god: 'ledgers', kind: 'boon', effects: [e('x.econ.interestAdd', 'add', 0.03)] },
  { id: 'ledg_count', god: 'ledgers', kind: 'boon', effects: [e('deposit.bonus', 'add', 0.05)] },
  { id: 'ledg_double', god: 'ledgers', kind: 'boon', effects: [e('payout.mult', 'mult', 1.2), e('quota.mult', 'mult', 1.12)] },
  { id: 'ledg_round', god: 'ledgers', kind: 'boon', effects: [], fx: { writeOffPct: 0.05 } },
  { id: 'ledg_pawn', god: 'ledgers', kind: 'boon', effects: [e('shop.discount', 'add', 0.2), e('x.pawn.slots', 'add', 1)] },
  { id: 'ledg_books', god: 'ledgers', kind: 'rite', effects: [e('x.house.noticeOff', 'add', 1)], once: true },
  // Lord of Ash
  { id: 'ash_minute', god: 'ash', kind: 'boon', effects: [e('x.run.clockAdd', 'add', 20)] },
  { id: 'ash_lastcall', god: 'ash', kind: 'boon', effects: [e('x.run.lastCallAdd', 'add', 10)] },
  { id: 'ash_hand', god: 'ash', kind: 'boon', effects: [e('x.tilt.grace', 'add', 3)] },
  { id: 'ash_cold', god: 'ash', kind: 'boon', effects: [e('dread.add', 'add', -15)] },
  { id: 'ash_short', god: 'ash', kind: 'boon', effects: [e('quota.mult', 'mult', 0.8)], fx: { watchAdd: -1 } },
  { id: 'ash_overtime', god: 'ash', kind: 'rite', effects: [], fx: { overtime: 1 }, once: true },
  // Lord of Mirrors
  { id: 'mir_print', god: 'mirrors', kind: 'boon', effects: [e('x.onTag.bigwin', 'add', 1)] },
  { id: 'mir_back', god: 'mirrors', kind: 'boon', effects: [e('loss.refund', 'add', 0.05)] },
  { id: 'mir_tell', god: 'mirrors', kind: 'boon', effects: [e('x.duel.tellEarly', 'add', 1)] },
  { id: 'mir_face', god: 'mirrors', kind: 'boon', effects: [], fx: { borrowedFace: 1 } },
  { id: 'mir_clear', god: 'mirrors', kind: 'boon', effects: [e('x.crooked.starAdd', 'add', 1)] },
  { id: 'mir_name', god: 'mirrors', kind: 'rite', effects: [], fx: { sealAdd: 1 }, once: true },
  // Loki, the Borrowed God (swap only). His price is Ink (Dread 8 and 10 were 2 and 3 Ink at 4 Dread an Ink).
  { id: 'loki_tip', god: 'loki', kind: 'boon', effects: [e('payout.mult', 'mult', 1.15)], ink: 2 },
  { id: 'loki_raise', god: 'loki', kind: 'boon', effects: [e('bet.maxMult', 'mult', 2), e('loss.refund', 'set', 0, 100)] },
  { id: 'loki_grin', god: 'loki', kind: 'boon', effects: [e('x.run.pullsAdd', 'add', 2)], ink: 3 },
  { id: 'loki_coat', god: 'loki', kind: 'boon', effects: [], fx: { freeSwap: 1 } },
  // Duos (only DUOS_MAX can ever be taken)
  { id: 'duo_wishcoin', god: 'well', god2: 'ledgers', kind: 'duo', effects: [], fx: { depositPerStar: 0.01 } },
  { id: 'duo_stillwater', god: 'well', god2: 'ash', kind: 'duo', effects: [], fx: { sealedNoStars: 1 } },
  { id: 'duo_moon', god: 'well', god2: 'mirrors', kind: 'duo', effects: [], fx: { omenTwice: 1 } },
  { id: 'duo_latefee', god: 'ledgers', god2: 'ash', kind: 'duo', effects: [e('x.deposit.lastCall', 'add', 0.1)] },
  { id: 'duo_twobooks', god: 'ledgers', god2: 'mirrors', kind: 'duo', effects: [e('x.crooked.payMult', 'mult', 1.5)] },
  { id: 'duo_stillface', god: 'ash', god2: 'mirrors', kind: 'duo', effects: [e('x.payout.atDread', 'mult', 1.1)] },
];

const BY_ID: ReadonlyMap<string, BoonDef> = new Map(BOONS.map((b) => [b.id, b]));
const RITE_OF: Readonly<Record<string, string>> = Object.fromEntries(BOONS.filter((b) => b.kind === 'rite').map((b) => [b.god, b.id]));

export function boonDef(id: string): BoonDef | undefined { return BY_ID.get(id); }

/** How an overpay tier shapes the offer (docs §2.1): cards shown, cards you may keep, and whether one card must be a Rite/duo. */
export type OfferTier = 'base' | 'uncommon' | 'golden' | 'seal';
export const OFFER_SHAPE: Readonly<Record<OfferTier, { size: number; picks: number; slot: boolean }>> = {
  base: { size: 3, picks: 1, slot: false },
  uncommon: { size: 4, picks: 1, slot: false },
  golden: { size: 4, picks: 2, slot: false }, // shortcut: golden shows 4, the doc only says "pick 2"; tune with the sims.
  seal: { size: 4, picks: 1, slot: true },
};

/** What an offer needs to know. All optional: a bare call is a first-Dawn offer. */
export interface OfferCtx {
  tier?: OfferTier;
  /** Boon ids already kept (never offered again; they decide Favour and duo eligibility). */
  kept?: readonly string[];
  /** Extra Favour (candles, Noticed) per god, on top of the boons kept. */
  extraFavour?: Partial<Record<GodId, number>>;
  /** House Director weights per owner (default 1). */
  weights?: Partial<Record<GodId, number>>;
  /** True when a name seal is missing (Your Name Back is offered only then). */
  sealsMissing?: boolean;
}

const isKind = (id: string, k: BoonKind): boolean => BY_ID.get(id)?.kind === k;

/** Favour of `god` from a kept list plus extra: 1 per boon or Rite kept from that god (a duo is no one god's), capped at {@link FAVOUR_MAX}. */
export function favourOf(god: GodId, kept: readonly string[], extra = 0): number {
  if (god === 'loki') return 0;
  let n = extra;
  for (const id of kept) {
    const d = BY_ID.get(id);
    if (d && d.kind !== 'duo' && d.god === god) n++;
  }
  return Math.max(0, Math.min(FAVOUR_MAX, n));
}

/** Boons the player holds from `god` (Rites included). */
const heldCount = (god: GodId, kept: readonly string[]): number => favourOf(god, kept);

/**
 * The cards offered at a paid Dawn (ids, in the order shown; the timer takes the leftmost). Pure: the same rng state, Night and
 * context always give the same ids. Gating: three owners (Well, Ledgers, Ash) at first, the Mirrors join on Night 4, Rites and
 * duos from Night 5. The first cards come from distinct gods; a 4th card (bigger tiers) repeats a god with another boon.
 * A god at Favour 3 puts its Rite in one slot; one duo may take a slot (always on the seal tier when no Rite shows).
 */
export function pantheonOffer(rng: Rng, night: number, ctx: OfferCtx = {}): string[] {
  const shape = OFFER_SHAPE[ctx.tier ?? 'base'];
  const kept = ctx.kept ?? [];
  const taken = new Set(kept);
  const pool = (g: GodId): BoonDef[] => BOONS.filter((b) => b.kind === 'boon' && b.god === g && !taken.has(b.id));
  const left = OFFER_GODS.filter((g) => (g !== 'mirrors' || night >= MIRRORS_NIGHT) && pool(g).length > 0);
  const order: GodId[] = [];
  while (left.length > 0) order.push(left.splice(rng.weightedIndex(left.map((g) => ctx.weights?.[g] ?? 1)), 1)[0]);
  const cards: string[] = [];
  for (let j = 0; order.length > 0 && cards.length < shape.size && j < 40; j++) {
    const fresh = pool(order[j % order.length]).filter((b) => !cards.includes(b.id));
    if (fresh.length > 0) cards.push(rng.pick(fresh).id);
  }
  if (night < RITE_NIGHT || cards.length === 0) return cards;

  // A Rite from a god at Favour 3 (Your Name Back only while a seal is missing).
  const rites = OWNERS
    .filter((g) => favourOf(g, kept, ctx.extraFavour?.[g]) >= FAVOUR_MAX && !taken.has(RITE_OF[g]) && (RITE_OF[g] !== 'mir_name' || ctx.sealsMissing))
    .map((g) => RITE_OF[g]);
  let riteShown = false;
  if (rites.length > 0) {
    const rite = rng.pick(rites);
    const same = cards.findIndex((id) => BY_ID.get(id)?.god === BY_ID.get(rite)?.god);
    cards[same >= 0 ? same : cards.length - 1] = rite;
    riteShown = true;
  }
  // One duo: both gods held at 2+ boons, not taken, under the run cap.
  if (kept.filter((id) => isKind(id, 'duo')).length < DUOS_MAX && (!riteShown || ctx.tier === 'seal') && (ctx.tier === 'seal' || rng.chance(0.5))) {
    const duos = BOONS.filter((b) => b.kind === 'duo' && !taken.has(b.id) && heldCount(b.god, kept) >= 2 && heldCount(b.god2 as GodId, kept) >= 2);
    let slot = cards.length - 1;
    while (slot > 0 && isKind(cards[slot], 'rite')) slot--;
    if (duos.length > 0 && !isKind(cards[slot], 'rite')) cards[slot] = rng.pick(duos).id;
  }
  return cards;
}

/**
 * Loki's swap: one card of `cards` becomes one of his boons (not kept, not already shown). Null when none is left or the index is
 * out of range. Pure; the Night gate and the once-per-offer rule live in {@link Pantheon.swap}.
 */
export function lokiSwap(rng: Rng, cards: readonly string[], index: number, kept: readonly string[] = []): string[] | null {
  if (!(index >= 0 && index < cards.length)) return null;
  const free = BOONS.filter((b) => b.god === 'loki' && !kept.includes(b.id) && !cards.includes(b.id));
  if (free.length === 0) return null;
  const out = [...cards];
  out[index] = rng.pick(free).id;
  return out;
}

/**
 * The payout multipliers a kept list ends with after the cap: `raw` is the plain product, `payout` / `atDread` what the pipeline may
 * apply so that `payout * atDread` (the worst case at Dread 60+) stays at or under {@link PAYOUT_CAP}. `payout.mult` is cut last.
 */
export function payoutCap(kept: readonly string[]): { rawPayout: number; rawAtDread: number; payout: number; atDread: number } {
  let rawPayout = 1;
  let rawAtDread = 1;
  for (const id of kept) {
    for (const f of BY_ID.get(id)?.effects ?? []) {
      if (f.hook === 'payout.mult') rawPayout *= f.value;
      else if (f.hook === 'x.payout.atDread') rawAtDread *= f.value;
    }
  }
  const payout = Math.min(rawPayout, PAYOUT_CAP);
  const atDread = Math.min(rawAtDread, Math.max(1, PAYOUT_CAP / payout));
  return { rawPayout, rawAtDread, payout, atDread };
}

/** A standing offer. `picks` is how many cards the player may still keep (2 on the golden tier). */
export interface PantheonOffer { night: number; ids: string[]; picks: number; left: number; swapped: boolean }
/** What the offer view hands the UI. */
export interface PantheonOfferView { candidates: BoonDef[]; picks: number; left: number; night: number; canSwap: boolean }
/** Save shape (run ext). Everything optional; a save without it has no offer and no boons. */
export interface PantheonSave {
  offer?: PantheonOffer | null;
  kept?: string[];
  spent?: string[];
  extra?: Partial<Record<GodId, number>>;
  offered?: number;
}

/** What `open` needs from the run beyond the Night. */
export interface OpenOpts { tier?: OfferTier; weights?: OfferCtx['weights']; sealsMissing?: boolean }

/**
 * The pantheon state and its modifier provider. `touch` invalidates the mod cache whenever the kept list changes.
 */
export class Pantheon implements ModProvider {
  readonly kind: ModSourceKind = 'event';
  private offer: PantheonOffer | null = null;
  private kept: string[] = [];
  private spent = new Set<string>();
  /** Extra Favour per god (candle, Noticed), on top of the boons kept. */
  private extra: Partial<Record<GodId, number>> = {};
  /** The last Night an offer opened for: a reload cannot open the same Dawn twice. */
  private offered = 0;

  constructor(private readonly seed: number, private readonly touch: () => void) {}

  /** Dawn hook: opens the offer after paid printed Night `night`. False when gated, already open, or that Dawn was offered before. */
  open(night: number, opts: OpenOpts = {}): boolean {
    if (night < FIRST_OFFER_NIGHT || this.offer || night <= this.offered) return false;
    const rng = createRng(hashSeed('pantheon', this.seed, night));
    const ids = pantheonOffer(rng, night, { ...opts, kept: this.kept, extraFavour: this.extra });
    if (ids.length === 0) return false;
    this.offered = night;
    this.offer = { night, ids, picks: Math.min(OFFER_SHAPE[opts.tier ?? 'base'].picks, ids.length), left: OFFER_TIMEOUT_SEC, swapped: false };
    return true;
  }

  pending(): boolean { return this.offer !== null; }

  offerView(): PantheonOfferView | null {
    const o = this.offer;
    if (!o) return null;
    const candidates = o.ids.map((id) => BY_ID.get(id)).filter((d): d is BoonDef => d !== undefined);
    return { candidates, picks: o.picks, left: o.left, night: o.night, canSwap: this.canSwap() };
  }

  /** Keeps one card of the open offer. False when closed, not on offer, or a third duo. The offer closes after its last pick. */
  pick(id: string): boolean {
    const o = this.offer;
    const d = BY_ID.get(id);
    if (!o || !d || !o.ids.includes(id)) return false;
    if (d.kind === 'duo' && this.duos() >= DUOS_MAX) return false;
    this.kept.push(id);
    o.ids = o.ids.filter((c) => c !== id);
    if (--o.picks <= 0 || o.ids.length === 0) this.offer = null;
    this.touch();
    return true;
  }

  /** Runs the offer timer (real seconds). Returns the ids auto-picked when it runs out, else null. */
  tick(dt: number): string[] | null {
    const o = this.offer;
    if (!o) return null;
    o.left -= dt;
    return o.left > 0 ? null : this.settle();
  }

  /** Closes an open offer by taking the leftmost cards (OPEN THE FLOOR before a pick). Null when no offer is open. */
  settle(): string[] | null {
    if (!this.offer) return null;
    const out: string[] = [];
    while (this.offer) {
      const next = this.offer.ids.find((id) => this.pick(id));
      if (next === undefined) { this.offer = null; break; }
      out.push(next);
    }
    return out;
  }

  /** True when Loki's swap is open: Night 3+, an offer is up, not used on it. */
  canSwap(): boolean {
    const o = this.offer;
    return !!o && o.night >= SWAP_NIGHT && !o.swapped;
  }

  /** Loki's swap on card `index`. Returns the Ink it costs (0 with Stolen Coat), or null when refused. */
  swap(index: number): number | null {
    const o = this.offer;
    if (!o || !this.canSwap()) return null;
    const next = lokiSwap(createRng(hashSeed('pantheon.loki', this.seed, o.night)), o.ids, index, this.kept);
    if (!next) return null;
    o.ids = next;
    o.swapped = true;
    return this.fx('freeSwap') > 0 ? 0 : LOKI_SWAP_INK;
  }

  has(id: string): boolean { return this.kept.includes(id) && !this.spent.has(id); }
  list(): readonly string[] { return this.kept; }
  duos(): number { return this.kept.filter((id) => isKind(id, 'duo')).length; }

  /** Favour of `god`, 0..3. */
  favour(god: GodId): number { return favourOf(god, this.kept, this.extra[god] ?? 0); }

  /** +n Favour from a candle or Noticed. Never past {@link FAVOUR_MAX}; returns the Favour after. */
  addFavour(god: GodId, n = 1): number {
    if (god === 'loki') return 0;
    const room = FAVOUR_MAX - this.favour(god);
    if (room > 0) this.extra[god] = (this.extra[god] ?? 0) + Math.min(room, n);
    return this.favour(god);
  }

  /** The god of the last boon kept (Noticed gives it +1), or null. */
  lastGod(): GodId | null {
    const d = BY_ID.get(this.kept[this.kept.length - 1] ?? '');
    return d ? d.god : null;
  }

  /** Retires a `once` boon after it fired. */
  spend(id: string): void {
    if (this.kept.includes(id) && boonDef(id)?.once) { this.spent.add(id); this.touch(); }
  }

  /** Sum of `fx[key]` over the live boons kept (0 when none). */
  fx(key: string): number {
    let s = 0;
    for (const id of this.kept) if (!this.spent.has(id)) s += BY_ID.get(id)?.fx?.[key] ?? 0;
    return s;
  }

  /** Provider: every live boon's effects, with the payout cap applied through one correcting source. */
  collect(_q: ModQuery, out: ModSource[]): void {
    const live = this.kept.filter((id) => !this.spent.has(id));
    for (const id of live) {
      const d = BY_ID.get(id);
      if (d && d.effects.length > 0) out.push({ kind: 'event', id: `pantheon.${id}`, owner: 0, effects: d.effects });
    }
    const c = payoutCap(live);
    const fix: ModEffect[] = [];
    if (c.payout < c.rawPayout) fix.push(e('payout.mult', 'mult', c.payout / c.rawPayout));
    if (c.atDread < c.rawAtDread) fix.push(e('x.payout.atDread', 'mult', c.atDread / c.rawAtDread));
    if (fix.length > 0) out.push({ kind: 'event', id: 'pantheon.cap', owner: 0, effects: fix });
  }

  snapshot(): PantheonSave | null {
    if (!this.offer && this.kept.length === 0 && this.offered === 0 && Object.keys(this.extra).length === 0) return null;
    return {
      offer: this.offer ? { ...this.offer, ids: [...this.offer.ids] } : null,
      kept: [...this.kept],
      spent: [...this.spent],
      extra: { ...this.extra },
      offered: this.offered,
    };
  }

  /** Restores a save; unknown ids (an old Night Card, a removed boon) are dropped. */
  restore(s: PantheonSave | undefined): void {
    this.offer = null;
    this.kept = [];
    this.spent = new Set();
    this.extra = {};
    this.offered = 0;
    if (!s || typeof s !== 'object') return;
    const known = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);
    if (Array.isArray(s.kept)) {
      for (const id of s.kept) {
        if (!known(id) || this.kept.includes(id)) continue;
        if (isKind(id, 'duo') && this.duos() >= DUOS_MAX) continue;
        this.kept.push(id);
      }
    }
    if (Array.isArray(s.spent)) for (const id of s.spent) if (known(id) && this.kept.includes(id)) this.spent.add(id);
    if (s.extra && typeof s.extra === 'object') {
      for (const g of OWNERS) { const v = s.extra[g]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) this.extra[g] = Math.min(FAVOUR_MAX, Math.floor(v)); }
    }
    const o = s.offer;
    if (o && Array.isArray(o.ids) && Number.isFinite(o.night)) {
      const ids = o.ids.filter(known);
      if (ids.length > 0) {
        this.offer = {
          night: o.night, ids, swapped: !!o.swapped,
          picks: Math.max(1, Math.min(ids.length, Number.isFinite(o.picks) ? Math.floor(o.picks) : 1)),
          left: Number.isFinite(o.left) ? Math.max(0, o.left) : OFFER_TIMEOUT_SEC,
        };
      }
    }
    if (Number.isFinite(s.offered)) this.offered = s.offered as number;
    this.touch();
  }
}
