/**
 * Night Cards (director: Nights 2+ need a real decision). At every paid Dawn the run offers two seeded cards; the player keeps
 * one, and it rides the NEXT Night as a risk/reward modifier. Pure: the offer is a function of the run seed and the Night it
 * is for, so a seed always shows the same two cards. The cards are drawn by `nightCards.ui.ts`; the run holds the offer and the
 * kept card (`run.nightCardOffer()`, `run.pickNightCard()`, `run.nightCard()`).
 *
 * Effects: each card is data. Its `effects` are ordinary run-level {@link ModEffect}s, folded through the unified pipeline
 * (`quota.mult`, `payout.mult`, `x.econ.interestAdd`, `x.run.pullsAdd`, `x.pawn.slots`, `shop.discount`, `x.tilt.grace` …).
 * Its `fx` are the few switches the pipeline has no hook for (one Watch fewer, no floor events, Lamp counts, Pawn closed,
 * the bet floor); `run.ts` reads them through {@link NightCards.fx} at the matching point.
 *
 * Rules: one card per Night (a pick is kept for one Night index only). Boss Nights still apply: the boss rule registers on
 * its own and stacks with the card. The 20 s timer auto-picks the first card, so the Dawn never sticks.
 */
import { createRng, hashSeed } from '@/core/rng';
import type { ModEffect, ModProvider, ModQuery, ModSource, ModSourceKind } from './modifiers.types';
import { coldLampCount, hotLampCount, nightDef, quotaFor, ratePercent, TILT_FREE_PULLS } from './data/schedule';

/** Cards offered at each Dawn. */
export const NIGHT_CARD_OFFER_SIZE = 2;
/** Seconds the offer waits before the first card is taken for the player. */
export const NIGHT_CARD_TIMEOUT_SEC = 20;

export type NightCardId =
  | 'rush_night' | 'double_down' | 'quiet_night' | 'lamp_festival' | 'lean_night'
  | 'high_table' | 'bankers_night' | 'charm_fair' | 'payday_night' | 'grace';

/** How the card reads on the card face: a tag, not a balance rule. */
export type NightCardTone = 'risk' | 'boon' | 'mixed';

/** The switches the modifier pipeline cannot express. Neutral values mean "no change". */
export interface NightCardFx {
  /** Watches added to this Night (RUSH NIGHT: -1). The Night never has fewer than one. */
  watchAdd: number;
  /** No Watch floor event rolls this Night (QUIET NIGHT). */
  noFloorEvents: boolean;
  /** HOT lamps per Watch in place of the schedule (LAMP FESTIVAL: 2). Null keeps the schedule. */
  hotLamps: number | null;
  /** No COLD lamp this Night (LAMP FESTIVAL). */
  noColdLamps: boolean;
  /** ×the minimum bet of every machine (HIGH TABLE: 2). */
  minBetMult: number;
  /** The Pawn is shut for the Night (BANKER'S NIGHT). */
  pawnClosed: boolean;
}

export const NEUTRAL_NIGHT_CARD_FX: NightCardFx = {
  watchAdd: 0, noFloorEvents: false, hotLamps: null, noColdLamps: false, minBetMult: 1, pawnClosed: false,
};

export interface NightCardDef {
  id: NightCardId;
  tone: NightCardTone;
  /** Declarative modifier effects while the card is active (run-level, unscoped). */
  effects: readonly ModEffect[];
  /** Switches for `run.ts` (see {@link NightCardFx}); anything omitted is neutral. */
  fx: Partial<NightCardFx>;
}

/** The deck. Ten cards, each with a distinct decision. Order is the data order (the seeded offer shuffles it). */
export const NIGHT_CARDS: readonly NightCardDef[] = [
  { id: 'rush_night', tone: 'mixed', effects: [{ hook: 'quota.mult', op: 'mult', value: 0.75 }], fx: { watchAdd: -1 } },
  { id: 'double_down', tone: 'risk', effects: [{ hook: 'quota.mult', op: 'mult', value: 1.5 }, { hook: 'payout.mult', op: 'mult', value: 1.3 }], fx: {} },
  { id: 'quiet_night', tone: 'boon', effects: [{ hook: 'x.econ.interestAdd', op: 'add', value: 0.05 }], fx: { noFloorEvents: true } },
  { id: 'lamp_festival', tone: 'mixed', effects: [], fx: { hotLamps: 2, noColdLamps: true } },
  { id: 'lean_night', tone: 'risk', effects: [{ hook: 'x.run.pullsAdd', op: 'add', value: -2 }, { hook: 'payout.mult', op: 'mult', value: 1.2 }], fx: {} },
  { id: 'high_table', tone: 'risk', effects: [{ hook: 'payout.mult', op: 'mult', value: 1.25 }], fx: { minBetMult: 2 } },
  { id: 'bankers_night', tone: 'mixed', effects: [{ hook: 'x.econ.interestAdd', op: 'add', value: 0.1 }], fx: { pawnClosed: true } },
  { id: 'charm_fair', tone: 'boon', effects: [{ hook: 'x.pawn.slots', op: 'add', value: 2 }, { hook: 'shop.discount', op: 'add', value: 0.2 }], fx: {} },
  { id: 'payday_night', tone: 'mixed', effects: [{ hook: 'payout.flat', op: 'add', value: 10 }, { hook: 'quota.mult', op: 'mult', value: 1.15 }], fx: {} },
  { id: 'grace', tone: 'boon', effects: [{ hook: 'x.tilt.grace', op: 'add', value: 3 }], fx: {} },
];

const BY_ID: ReadonlyMap<string, NightCardDef> = new Map(NIGHT_CARDS.map((d) => [d.id, d]));

/** The card definition for an id, or undefined. */
export function nightCardDef(id: string): NightCardDef | undefined {
  return BY_ID.get(id);
}

/** The switches of a card (neutral when `id` is null or unknown). */
export function nightCardFx(id: string | null): NightCardFx {
  const d = id === null ? undefined : BY_ID.get(id);
  return d ? { ...NEUTRAL_NIGHT_CARD_FX, ...d.fx } : NEUTRAL_NIGHT_CARD_FX;
}

/**
 * The cards offered at the Dawn that opens `night` (0-based Night index of the Night the card is for). Pure: the same seed
 * and Night always give the same distinct ids, in the same order.
 */
export function nightCardOffer(seed: number, night: number): NightCardId[] {
  const rng = createRng(hashSeed('nightcards', seed, night));
  return rng.shuffle([...NIGHT_CARDS]).slice(0, NIGHT_CARD_OFFER_SIZE).map((d) => d.id);
}

/**
 * One concrete change a card makes to the Night it rides: `key` names its `nightcard.prev.<key>` line, `vars` are the numbers
 * the line reads (before and after, or the amount). The card face joins the lines with a separator.
 */
export interface NightCardPreviewLine {
  key: 'quota' | 'watches' | 'pulls' | 'payout' | 'flat' | 'interest' | 'grace' | 'shelves' | 'discount' | 'hot' | 'cold' | 'noFloor' | 'minBet' | 'pawnShut';
  vars: Record<string, number>;
}

/**
 * The concrete result of `def` for the Night at `index` (0-based, the Night the card is for): every number it changes, before and
 * after. Pure. The quota is the Night's ladder quota (`quotaFor` with no discount, Assessment or House notice), so the card's
 * multiplier reads against the printed quota; the live due can add those three on top.
 */
export function nightCardPreview(def: NightCardDef, index: number): NightCardPreviewLine[] {
  const nd = nightDef(index);
  const quota = quotaFor(index);
  const sum = (hook: ModEffect['hook'], op: ModEffect['op']): number => def.effects
    .filter((e) => e.hook === hook && e.op === op).reduce((acc, e) => acc + e.value, 0);
  const product = (hook: ModEffect['hook']): number => def.effects
    .filter((e) => e.hook === hook && e.op === 'mult').reduce((acc, e) => acc * e.value, 1);
  const fx = nightCardFx(def.id);
  const lines: NightCardPreviewLine[] = [];
  const qMult = product('quota.mult');
  if (qMult !== 1) lines.push({ key: 'quota', vars: { from: quota, to: Math.round(quota * qMult) } });
  if (fx.watchAdd !== 0) lines.push({ key: 'watches', vars: { from: nd.watches, to: Math.max(1, nd.watches + fx.watchAdd) } });
  const pullsAdd = sum('x.run.pullsAdd', 'add');
  if (pullsAdd !== 0) lines.push({ key: 'pulls', vars: { from: nd.pulls, to: Math.max(1, Math.round(nd.pulls + pullsAdd)) } });
  const payout = product('payout.mult');
  if (payout !== 1) lines.push({ key: 'payout', vars: { x: payout } });
  const flat = sum('payout.flat', 'add');
  if (flat !== 0) lines.push({ key: 'flat', vars: { n: flat } });
  const interest = sum('x.econ.interestAdd', 'add');
  if (interest !== 0) lines.push({ key: 'interest', vars: { from: ratePercent(nd.interest), to: ratePercent(Math.max(0, nd.interest + interest)) } });
  const grace = sum('x.tilt.grace', 'add');
  if (grace !== 0) lines.push({ key: 'grace', vars: { from: TILT_FREE_PULLS, to: TILT_FREE_PULLS + Math.round(grace) } });
  const shelves = sum('x.pawn.slots', 'add');
  if (shelves !== 0) lines.push({ key: 'shelves', vars: { n: shelves } });
  const discount = sum('shop.discount', 'add');
  if (discount !== 0) lines.push({ key: 'discount', vars: { pct: Math.round(discount * 100) } });
  if (fx.hotLamps !== null && fx.hotLamps !== hotLampCount(nd.no)) lines.push({ key: 'hot', vars: { from: hotLampCount(nd.no), to: fx.hotLamps } });
  const coldNow = coldLampCount(nd.no);
  if (fx.noColdLamps && coldNow > 0) lines.push({ key: 'cold', vars: { from: coldNow, to: 0 } });
  if (fx.noFloorEvents) lines.push({ key: 'noFloor', vars: {} });
  if (fx.minBetMult !== 1) lines.push({ key: 'minBet', vars: { x: fx.minBetMult } });
  if (fx.pawnClosed) lines.push({ key: 'pawnShut', vars: {} });
  return lines;
}

/** A standing offer: the cards for `night`, and the seconds left before the first card is taken. */
export interface NightCardOffer { night: number; ids: NightCardId[]; left: number }
/** The kept card: the Night index it applies to. */
interface KeptCard { night: number; id: NightCardId }

/** Save shape (run ext). Both parts are optional; a save without them has no offer and no card. */
export interface NightCardSave { offer?: NightCardOffer | null; kept?: KeptCard | null; offered?: number }

/** What the offer view hands the UI. */
export interface NightCardOfferView { candidates: NightCardDef[]; left: number; night: number }

const EMPTY_FX = NEUTRAL_NIGHT_CARD_FX;

/**
 * The Night Cards state and its modifier provider. `index` is the run's 0-based Night index; `touch` invalidates the mod cache
 * whenever the kept card or the Night changes.
 */
export class NightCards implements ModProvider {
  readonly kind: ModSourceKind = 'event';
  private offer: NightCardOffer | null = null;
  private kept: KeptCard | null = null;
  /** The last Night index an offer opened for: a reload cannot open the same Dawn twice. */
  private offered = -1;

  constructor(
    private readonly index: () => number,
    private readonly seed: number,
    private readonly touch: () => void,
  ) {}

  /**
   * Dawn hook: opens the offer for `night` (the Night after the paid one). False when an offer is already open, the Night was
   * offered before, or the card for it is already kept.
   */
  openOffer(night: number): boolean {
    if (this.offer || night <= this.offered || this.kept?.night === night) return false;
    this.offered = night;
    this.offer = { night, ids: nightCardOffer(this.seed, night), left: NIGHT_CARD_TIMEOUT_SEC };
    return true;
  }

  /** True while an offer is open (the Night cannot open). */
  pending(): boolean { return this.offer !== null; }

  /** The offer as the UI reads it, or null when closed. */
  offerView(): NightCardOfferView | null {
    const o = this.offer;
    if (!o) return null;
    const candidates = o.ids.map((id) => nightCardDef(id)).filter((d): d is NightCardDef => d !== undefined);
    return { candidates, left: o.left, night: o.night };
  }

  /** Takes one card of the open offer (the player's pick). False when closed or the id is not on offer. */
  pick(id: string): boolean {
    const o = this.offer;
    if (!o || !o.ids.includes(id as NightCardId) || !nightCardDef(id)) return false;
    this.kept = { night: o.night, id: id as NightCardId };
    this.offer = null;
    this.touch();
    return true;
  }

  /** Runs the offer's timer (real seconds). Returns the card auto-picked when it runs out, else null. */
  tick(dt: number): NightCardId | null {
    const o = this.offer;
    if (!o) return null;
    o.left -= dt;
    if (o.left > 0) return null;
    return this.settle();
  }

  /**
   * Closes an open offer with its first card (the timer's pick, used when OPEN THE FLOOR comes before a pick, so the Night can
   * never be held by an offer nobody answers). Returns the card, or null when no offer is open.
   */
  settle(): NightCardId | null {
    const first = this.offer?.ids[0];
    return first !== undefined && this.pick(first) ? first : null;
  }

  /** The card kept for the Night in progress, or null. */
  current(): NightCardDef | null {
    const k = this.kept;
    if (!k || k.night !== this.index()) return null;
    return nightCardDef(k.id) ?? null;
  }

  /**
   * Called when the Night opens (after the index moves on): the new Night's card, or null. Invalidates the mod cache, since the
   * provider's output changes with the index.
   */
  started(): NightCardDef | null {
    this.touch();
    return this.current();
  }

  /** The switches of the Night in progress (neutral without a card). */
  fx(): NightCardFx {
    const c = this.current();
    return c ? nightCardFx(c.id) : EMPTY_FX;
  }

  /** Provider: the kept card's effects while its Night runs. */
  collect(_q: ModQuery, out: ModSource[]): void {
    const c = this.current();
    if (!c || c.effects.length === 0) return;
    out.push({ kind: 'event', id: `nightcard.${c.id}`, owner: 0, effects: c.effects });
  }

  snapshot(): NightCardSave | null {
    if (!this.offer && !this.kept && this.offered < 0) return null;
    return {
      offer: this.offer ? { ...this.offer, ids: [...this.offer.ids] } : null,
      kept: this.kept ? { ...this.kept } : null,
      offered: this.offered,
    };
  }

  restore(s: NightCardSave | undefined): void {
    this.offer = null;
    this.kept = null;
    this.offered = -1;
    if (!s || typeof s !== 'object') return;
    const o = s.offer;
    if (o && Array.isArray(o.ids)) {
      const ids = o.ids.filter((id): id is NightCardId => typeof id === 'string' && nightCardDef(id) !== undefined);
      if (ids.length > 0 && Number.isFinite(o.night)) {
        this.offer = { night: o.night, ids, left: Number.isFinite(o.left) ? Math.max(0, o.left) : NIGHT_CARD_TIMEOUT_SEC };
      }
    }
    const k = s.kept;
    if (k && typeof k.id === 'string' && nightCardDef(k.id) && Number.isFinite(k.night)) this.kept = { night: k.night, id: k.id };
    if (Number.isFinite(s.offered)) this.offered = s.offered as number;
    this.touch();
  }
}
