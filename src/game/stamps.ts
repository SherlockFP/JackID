/**
 * SYMBOL STAMPS: the Big One build economy (the CloverPit core, GDD wave 7 "deeper play"). Pure rules, no three, no DOM.
 *
 * A StampBook is (1) a mod provider that emits Big One scoped ModEffects on the hooks `buildMods` (machines/bigone/rules.ts)
 * already folds, and (2) the Stamp board the Pawn Window shows on its STAMPS tab.
 *
 *   GILD   x.bigone.symbolValueAdd[SYM]   + GILD_STEP[SYM] to what a symbol pays, up to GILD_MAX (3) levels per symbol.
 *   SHIFT  x.bigone.symbolWeight[SYM]     + SHIFT_WEIGHT to RING / CROWN / SUN, taken half from KEY and half from CANDLE (the two weakest
 *                                          fillers by return per weight), up to SHIFT_MAX (3) per symbol. Offered only for a symbol that
 *                                          is already gilded: the more a symbol pays, the more a Shift is worth (it is the build payoff).
 *   ETCH   x.bigone.patternMult[PAT]      + ETCH_STEP[PAT] to a pattern's multiplier, up to ETCH_MAX (4) levels per pattern.
 *
 * Why the steps are not all "+1" and Shift does not take from MOTH / TOOTH: the Big One's return is carried by MOTH and TOOTH (about 73
 * of 98 RTP points) and by the three short patterns (TREY, PILLAR, SLASH: about 38 points per +1). A literal +1 on MOTH is +36 points
 * of RTP, and moving weight off MOTH / TOOTH costs about 4 points per weight unit. So each step is tuned so that no single stamp moves
 * the return by more than 4 points (MAX_SINGLE_POINTS, pinned in `scripts/tests/stamps.test.mjs`), and the book holds at most STAMP_CAP
 * stamps so the best possible build stays under RTP 1.30 (MAX_BUILD_RTP; the search is `node scripts/sim/run.mjs --stamp-report`:
 * about 1.29 for 8 stamps). Gild and Shift multiply (a gilded symbol that lands more often), so builds pay more than the sum.
 *
 * Board: OFFER_COUNT (3) offers per intermission, drawn from the run rng (`stamps:<night>:<watch>` stream, rerolls fork it), so the
 * same seed gives the same stock. Reroll costs Tickets (1, +1 per further paid reroll in the same intermission); a Ticket lock
 * keeps one offer across rerolls and intermissions. Prices are a share of the Night's BASE quota (Gild 18 / 30 / 45 % for the
 * 1st / 2nd / 3rd level, Shift 15 %, Etch 12 % x pattern size).
 *
 * The run supplies a `StampHost`; this file never touches run.ts. Seeded rng only. `snapshot()` / `restore()` are plain JSON.
 */
import type { Rng } from '@/core/rng';
import type { MachineId } from '@/core/types';
import { getStampLevels as activeLevels, setStampLevelsSource, type StampLevelsView } from '@/core/stampLevels';
import type { ModEffect, ModHook, ModProvider, ModQuery, ModSource } from './modifiers.types';
import { foldEffects } from './modifiers.types';
import { BASE_VALUE, BASE_WEIGHT, PATTERN_IDS, PATTERN_MULT, SYM_NAMES, type PatternId } from '@/machines/bigone/rules';

export type StampKind = 'gild' | 'shift' | 'etch';
export const STAMP_KINDS: readonly StampKind[] = ['gild', 'shift', 'etch'];
export type SymName = (typeof SYM_NAMES)[number];

/** The machine every stamp effect is scoped to. */
export const STAMP_MACHINE = 'bigone' as MachineId;

// ── tuning ──────────────────────────────────────────────────────────────────────────────────────────────
export const GILD_MAX = 3;
export const SHIFT_MAX = 3;
export const ETCH_MAX = 4;
/** Every stamp ever bought counts (levels summed). The best build under this cap is the RTP ceiling the tests pin at 1.30. */
export const STAMP_CAP = 8;
export const OFFER_COUNT = 3;
/** At most this many offers may be locked at once (a lock keeps the offer through rerolls and intermissions). */
export const MAX_STAMP_LOCKS = 1;
export const STAMP_LOCK_TICKETS = 1;

/** Value added to a symbol per Gild level. Tuned so one level is about +3 RTP points whichever symbol it sits on. */
export const GILD_STEP: Record<SymName, number> = { MOTH: 0.1, TOOTH: 0.1, KEY: 0.5, CANDLE: 0.5, RING: 1.5, CROWN: 2, SUN: 4 };
/** Weight added to the target per Shift level; the two donors each give half of it. */
export const SHIFT_WEIGHT: Record<SymName, number> = { MOTH: 0, TOOTH: 0, KEY: 0, CANDLE: 0, RING: 0.8, CROWN: 0.8, SUN: 0.8 };
/** The two weakest fillers by return per weight unit (KEY, CANDLE: value 1, weight 14). Taking from MOTH / TOOTH, which carry most of the RTP, would make every Shift a net loss. */
export const SHIFT_DONORS: readonly SymName[] = ['KEY', 'CANDLE'];
/** The premium symbols: the ones a Shift makes worth chasing. */
export const SHIFT_TARGETS: readonly SymName[] = ['RING', 'CROWN', 'SUN'];
/** FULL pays from the fill roll, never from `patternMult`; TWIN_RAILS and CORNERSTONE are offered only once the run unlocked them. */
export const ETCH_PATTERNS: readonly PatternId[] = PATTERN_IDS.filter((p) => p !== 'FULL');
export const ETCH_LOCKED_BY_DEFAULT: ReadonlySet<PatternId> = new Set<PatternId>(['TWIN_RAILS', 'CORNERSTONE']);
/** Multiplier added per Etch level. The three short patterns land on almost every spin, so their step is a quarter. */
export const ETCH_STEP: Record<PatternId, number> = {
  TREY: 0.25, QUAD: 1, RAIL: 1, PILLAR: 0.25, SLASH: 0.25, VALLEY: 1, PEAK: 1, CROSS: 1, PENTACLE: 1, HALO: 1,
  CLUSTER: 1, FULL: 0, TWIN_RAILS: 1, CORNERSTONE: 1, EYE: 1,
};
/** Etch price factor: cheap on small patterns, dear on big ones (about cells / 5). */
export const ETCH_SIZE: Record<PatternId, number> = {
  TREY: 0.6, QUAD: 0.8, RAIL: 1, PILLAR: 0.6, SLASH: 0.6, VALLEY: 1, PEAK: 1, CROSS: 1, PENTACLE: 1, HALO: 1.6,
  CLUSTER: 1.4, FULL: 0, TWIN_RAILS: 2, CORNERSTONE: 0.8, EYE: 0.8,
};
/** Price as a share of the Night's base quota. Gild by the level it buys (1st, 2nd, 3rd). */
export const GILD_PCT: readonly number[] = [0.18, 0.30, 0.45];
export const SHIFT_PCT = 0.15;
export const ETCH_PCT = 0.12;
/** Draw weight of each kind on the board. */
const KIND_WEIGHT: Record<StampKind, number> = { gild: 4, shift: 2.5, etch: 3.5 };
/** An offer on a symbol or pattern you already stamped is this many times likelier (builds focus). */
const FOCUS_BIAS = 3;

/** One pattern drawn as cell indices (r * 5 + c) for the Pawn card icon. */
export const PATTERN_SHAPE: Record<PatternId, readonly number[]> = {
  TREY: [5, 6, 7], QUAD: [5, 6, 7, 8], RAIL: [5, 6, 7, 8, 9], PILLAR: [2, 7, 12], SLASH: [10, 6, 2],
  VALLEY: [0, 6, 12, 8, 4], PEAK: [10, 6, 2, 8, 14], CROSS: [7, 2, 12, 6, 8], PENTACLE: [0, 4, 7, 10, 14],
  HALO: [0, 1, 2, 5, 7, 10, 11, 12], CLUSTER: [1, 2, 6, 7, 8, 11, 12], FULL: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  TWIN_RAILS: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], CORNERSTONE: [0, 4, 10, 14], EYE: [2, 6, 8, 12],
};

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────────────
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const roundSig2 = (x: number): number => {
  if (x < 10) return Math.max(1, Math.round(x));
  const m = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / m) * m;
};
const symIndex = (n: string): number => SYM_NAMES.indexOf(n as SymName);

export const maxLevel = (k: StampKind): number => (k === 'gild' ? GILD_MAX : k === 'shift' ? SHIFT_MAX : ETCH_MAX);

/** Coins for the next level of a stamp: a share of the Night's base quota (min 1). `level` = the level owned now. */
export function stampPrice(kind: StampKind, target: string, level: number, baseQuota: number): number {
  const base = Math.max(0, baseQuota);
  const pct = kind === 'gild' ? GILD_PCT[Math.min(GILD_PCT.length - 1, Math.max(0, level))]
    : kind === 'shift' ? SHIFT_PCT
      : ETCH_PCT * (ETCH_SIZE[target as PatternId] ?? 1);
  return roundSig2(Math.max(1, base * pct));
}

/** `{from, to}` of the figure a stamp changes, for the card: Gild = symbol value, Shift = symbol weight, Etch = pattern multiplier. */
export function stampEffect(kind: StampKind, target: string, level: number): { from: number; to: number; step: number } {
  if (kind === 'gild') {
    const s = target as SymName, i = symIndex(s), st = GILD_STEP[s] ?? 0;
    return { from: r4(BASE_VALUE[i] + level * st), to: r4(BASE_VALUE[i] + (level + 1) * st), step: st };
  }
  if (kind === 'shift') {
    const i = symIndex(target);
    return { from: r4(BASE_WEIGHT[i] + level * SHIFT_WEIGHT[target as SymName]), to: r4(BASE_WEIGHT[i] + (level + 1) * SHIFT_WEIGHT[target as SymName]), step: SHIFT_WEIGHT[target as SymName] };
  }
  const p = target as PatternId, st = ETCH_STEP[p] ?? 0;
  return { from: r4(PATTERN_MULT[p] + level * st), to: r4(PATTERN_MULT[p] + (level + 1) * st), step: st };
}

/** Levels per target (gild[SYMBOL] 0..3, shift[SYMBOL] 0..3, etch[PATTERN] 0..4), the total owned and the cap. */
export type StampLevels = StampLevelsView;

const emptyLevels = (): StampLevels => ({
  gild: Object.fromEntries(SYM_NAMES.map((n) => [n, 0])), shift: Object.fromEntries(SYM_NAMES.map((n) => [n, 0])),
  etch: Object.fromEntries(ETCH_PATTERNS.map((p) => [p, 0])), total: 0, cap: STAMP_CAP,
});

/** The ModEffects of a set of levels (Big One scoped, one `add` per hook). Pure: the sim, the tests and the book share it. */
export function stampEffects(lv: Pick<StampLevels, 'gild' | 'shift' | 'etch'>): ModEffect[] {
  const out: ModEffect[] = [];
  const scope = { machines: [STAMP_MACHINE] };
  const push = (hook: string, value: number, label: string): void => {
    const v = r4(value);
    if (v !== 0) out.push({ hook: hook as ModHook, op: 'add', value: v, scope, perStack: false, label });
  };
  const weight: Record<string, number> = {};
  for (const n of SYM_NAMES) {
    push(`x.bigone.symbolValueAdd[${n}]`, (lv.gild[n] ?? 0) * GILD_STEP[n], 'stamp.ledger.gild');
    const sh = lv.shift[n] ?? 0;
    if (sh > 0) {
      weight[n] = (weight[n] ?? 0) + sh * SHIFT_WEIGHT[n];
      for (const d of SHIFT_DONORS) weight[d] = (weight[d] ?? 0) - (sh * SHIFT_WEIGHT[n]) / SHIFT_DONORS.length;
    }
  }
  for (const n of SYM_NAMES) if (weight[n] !== undefined) push(`x.bigone.symbolWeight[${n}]`, weight[n], 'stamp.ledger.shift');
  for (const p of ETCH_PATTERNS) push(`x.bigone.patternMult[${p}]`, (lv.etch[p] ?? 0) * ETCH_STEP[p], 'stamp.ledger.etch');
  return out;
}

/**
 * `mod(hook, base)` for headless play: folds the stamp effects of `lv` with the reference `foldEffects`. Pass it as `h.mod`
 * (the Big One's `playHeadless`) or straight to `buildMods`. Hooks the stamps do not touch return `base`.
 */
export function stampHook(lv: Pick<StampLevels, 'gild' | 'shift' | 'etch'>): (hook: ModHook, base: number) => number {
  const by = new Map<string, ModEffect[]>();
  for (const e of stampEffects(lv)) { const a = by.get(e.hook); if (a) a.push(e); else by.set(e.hook, [e]); }
  return (hook, base) => {
    const effs = by.get(hook);
    return effs ? foldEffects(hook, base, effs) : base;
  };
}

/** The strongest ways to spend STAMP_CAP stamps are measured by `scripts/sim/run.mjs --stamp-report`; the tests pin the ceiling. */
export const MAX_BUILD_RTP = 1.3;
/** Single stamp ceiling on the return, in RTP points (absolute). */
export const MAX_SINGLE_POINTS = 4;

// ── host and API ────────────────────────────────────────────────────────────────────────────────────────
/** What the board needs from the run. All reads are live (the run owns the truth). */
export interface StampHost {
  /** The run rng (its streams are forked by label, so it is never advanced here). */
  rng(): Rng;
  /** 0-based Night and Watch indices of the visit (the stock key; the same numbers the Pawn uses). */
  night(): number;
  watch(): number;
  /** True while the window is open (an intermission and the run is not over). */
  open(): boolean;
  /** The Night's BASE quota (before the Assessment and discounts): the price base. */
  baseQuota(): number;
  wallet(): number;
  tickets(): number;
  /** Debit coins. Atomic: false means nothing was charged. */
  spend(coins: number, reason: string): boolean;
  /** Debit Tickets. Atomic. */
  spendTickets(n: number, reason: string): boolean;
  /** `modifiers.touch()`: called whenever a level changes so the fold caches refresh. */
  touch?(): void;
  /** Is this pattern earned (TWIN_RAILS, CORNERSTONE)? Absent = only the always-on patterns are offered. */
  patternUnlocked?(id: PatternId): boolean;
}

/** One offer as the Pawn card shows it. */
export interface StampOffer {
  kind: StampKind;
  /** Symbol name (GILD, SHIFT) or pattern id (ETCH). */
  target: string;
  /** Symbol index 0..6 for GILD / SHIFT, else -1. */
  sym: number;
  /** Cells of the pattern for ETCH (r * 5 + c), else empty. */
  cells: readonly number[];
  /** Level owned now; buying makes it `level + 1` of `max`. */
  level: number;
  max: number;
  price: number;
  locked: boolean;
  /** The figure it changes: value (GILD), weight (SHIFT) or multiplier (ETCH), now and after the buy. */
  from: number;
  to: number;
  step: number;
  /** SHIFT only: weight each donor (MOTH, TOOTH) gives up per level. */
  donor: number;
}

export type StampWhy = '' | 'closed' | 'none' | 'funds' | 'full' | 'fail';
export interface StampBuy { ok: boolean; why: StampWhy }

/** The service the Pawn's STAMPS tab reads (`run.stamps`, duck-typed by `charm_vendor/rules.ts`). */
export interface StampApi {
  open(): boolean;
  /** The board: OFFER_COUNT entries, `null` = bought or empty. */
  offers(): readonly (StampOffer | null)[];
  rerollCost(): number;
  canReroll(): boolean;
  reroll(): boolean;
  lock(i: number): boolean;
  unlock(i: number): boolean;
  /** Buy offer `i`: the coins are charged here (host.spend). */
  buy(i: number): StampBuy;
  /** Stamps owned and the cap. */
  count(): number;
  cap(): number;
  levels(): StampLevels;
  /** Bumped on every mutation, so a consumer can cache against it. */
  readonly rev: number;
}

interface OfferState { kind: StampKind; target: string; locked: boolean; sold: boolean }
export interface StampSnapshot {
  v: 1;
  /** `${night}:${watch}` of the visit the board was drawn for; '' = never drawn. */
  key: string;
  gild: Record<string, number>;
  shift: Record<string, number>;
  etch: Record<string, number>;
  offers: (OfferState | null)[];
  rolls: number;
  paid: number;
}

const clampInt = (x: unknown, lo: number, hi: number): number => {
  const n = Math.floor(Number(x));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

/**
 * The run registers its book once (null on teardown) so visuals can read the levels without holding the run. Machines read them
 * from "@/core/stampLevels" (a machine may not import game code as a value); this is the same data.
 */
export function setActiveStampBook(book: StampBook | null): void {
  setStampLevelsSource(book ? () => book.levels() : null);
}
/** Stamp levels for visuals (symbol strips, the pause ledger). Empty maps when no book is active. Pass a book to read that one. */
export function getStampLevels(book?: StampBook | null): StampLevels {
  return book ? book.levels() : activeLevels();
}

export class StampBook implements ModProvider, StampApi {
  readonly kind = 'upgrade' as const;
  /** Bumped on every mutation (levels, board, locks). */
  rev = 0;
  private key = '';
  private rolls = 0;
  private paid = 0;
  private gild: Record<string, number> = emptyLevels().gild;
  private shift: Record<string, number> = emptyLevels().shift;
  private etch: Record<string, number> = emptyLevels().etch;
  private slots: (OfferState | null)[] = new Array<OfferState | null>(OFFER_COUNT).fill(null);
  private source: ModSource | null = null;
  private sourceRev = -1;

  constructor(private readonly host: StampHost, snap?: StampSnapshot | null) {
    if (snap) this.load(snap);
  }

  // ── levels ──
  private levelOf(kind: StampKind, target: string): number {
    return (kind === 'gild' ? this.gild : kind === 'shift' ? this.shift : this.etch)[target] ?? 0;
  }
  count(): number {
    let n = 0;
    for (const t of [this.gild, this.shift, this.etch]) for (const k in t) n += t[k];
    return n;
  }
  cap(): number { return STAMP_CAP; }
  levels(): StampLevels {
    return { gild: { ...this.gild }, shift: { ...this.shift }, etch: { ...this.etch }, total: this.count(), cap: STAMP_CAP };
  }
  /** Direct grant (tests, cheats, a future reward). Respects the per-target max and the cap; false when refused. */
  grant(kind: StampKind, target: string): boolean {
    if (!this.valid(kind, target)) return false;
    this.bump(kind, target);
    return true;
  }
  /** Take every stamp away (new run). */
  reset(): void {
    this.gild = emptyLevels().gild; this.shift = emptyLevels().shift; this.etch = emptyLevels().etch;
    this.slots = new Array<OfferState | null>(OFFER_COUNT).fill(null);
    this.key = ''; this.rolls = 0; this.paid = 0;
    this.changed();
  }

  private bump(kind: StampKind, target: string): void {
    const t = kind === 'gild' ? this.gild : kind === 'shift' ? this.shift : this.etch;
    t[target] = (t[target] ?? 0) + 1;
    this.changed();
  }
  private changed(): void { this.rev += 1; this.source = null; this.host.touch?.(); }

  /** Is `kind`/`target` buyable right now (not maxed, the book not full, Shift only on a gilded symbol, pattern earned)? */
  private valid(kind: StampKind, target: string): boolean {
    if (this.count() >= STAMP_CAP) return false;
    if (this.levelOf(kind, target) >= maxLevel(kind)) return false;
    if (kind === 'gild') return symIndex(target) >= 0;
    if (kind === 'shift') return SHIFT_TARGETS.includes(target as SymName) && this.levelOf('gild', target) > 0;
    const p = target as PatternId;
    if (!ETCH_PATTERNS.includes(p)) return false;
    return this.host.patternUnlocked ? this.host.patternUnlocked(p) : !ETCH_LOCKED_BY_DEFAULT.has(p);
  }

  // ── mod provider ──
  collect(_q: ModQuery, out: ModSource[]): void {
    if (this.source === null || this.sourceRev !== this.rev) {
      this.sourceRev = this.rev;
      const effects = stampEffects({ gild: this.gild, shift: this.shift, etch: this.etch });
      this.source = { kind: 'upgrade', id: 'stamps', owner: 0, stacks: 1, effects };
    }
    if (this.source.effects.length === 0) return;
    out.push({ ...this.source, order: out.length });
  }

  // ── board ──
  open(): boolean { return this.host.open(); }

  /** Draw this intermission's board if it has not been drawn yet. The run may call it on entering the intermission. */
  sync(): void {
    if (!this.host.open()) return;
    const key = `${this.host.night()}:${this.host.watch()}`;
    if (key === this.key) return;
    const old = this.slots;
    this.key = key;
    this.rolls = 0;
    this.paid = 0;
    this.slots = new Array<OfferState | null>(OFFER_COUNT).fill(null);
    for (let i = 0; i < OFFER_COUNT; i++) {
      const s = old[i];
      if (s && s.locked && !s.sold && this.valid(s.kind, s.target)) this.slots[i] = { kind: s.kind, target: s.target, locked: true, sold: false };
    }
    const rng = this.host.rng().fork(`stamps:${this.host.night()}:${this.host.watch()}`);
    this.fill(rng, this.freeSlots());
    this.rev += 1;
  }

  private freeSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < OFFER_COUNT; i++) if (!this.slots[i]) out.push(i);
    return out;
  }

  /** Every offer that could go on the board now, minus `avoid` and what already sits on a shelf. */
  private pool(avoid: ReadonlySet<string>): Array<{ kind: StampKind; target: string; w: number }> {
    const onBoard = new Set(this.slots.filter((s): s is OfferState => !!s && !s.sold).map((s) => `${s.kind}:${s.target}`));
    const out: Array<{ kind: StampKind; target: string; w: number }> = [];
    const add = (kind: StampKind, target: string): void => {
      const id = `${kind}:${target}`;
      if (avoid.has(id) || onBoard.has(id) || !this.valid(kind, target)) return;
      const owned = this.levelOf(kind, target) > 0 || (kind !== 'etch' && this.levelOf('gild', target) > 0);
      out.push({ kind, target, w: KIND_WEIGHT[kind] * (owned ? FOCUS_BIAS : 1) / this.kindSize(kind) });
    };
    for (const n of SYM_NAMES) add('gild', n);
    for (const n of SHIFT_TARGETS) add('shift', n);
    for (const p of ETCH_PATTERNS) add('etch', p);
    return out;
  }
  /** Kinds have different numbers of targets; dividing keeps the KIND_WEIGHT shares true to what the board shows. */
  private kindSize(kind: StampKind): number { return kind === 'gild' ? SYM_NAMES.length : kind === 'shift' ? SHIFT_TARGETS.length : ETCH_PATTERNS.length; }

  private fill(rng: Rng, idx: readonly number[], avoid: ReadonlySet<string> = new Set()): void {
    for (const i of idx) {
      let pool = this.pool(avoid);
      if (!pool.length) pool = this.pool(new Set());            // a thin pool: allow a repeat rather than an empty shelf
      if (!pool.length) { this.slots[i] = null; continue; }
      const pick = rng.weighted(pool, pool.map((p) => p.w));
      this.slots[i] = { kind: pick.kind, target: pick.target, locked: false, sold: false };
    }
  }

  private view(i: number): StampOffer | null {
    const s = this.slots[i];
    if (!s || s.sold) return null;
    const level = this.levelOf(s.kind, s.target);
    const e = stampEffect(s.kind, s.target, level);
    const sym = s.kind === 'etch' ? -1 : symIndex(s.target);
    return {
      kind: s.kind, target: s.target, sym, cells: s.kind === 'etch' ? PATTERN_SHAPE[s.target as PatternId] : [], level, max: maxLevel(s.kind),
      price: stampPrice(s.kind, s.target, level, this.host.baseQuota()), locked: s.locked,
      from: e.from, to: e.to, step: e.step, donor: s.kind === 'shift' ? SHIFT_WEIGHT[s.target as SymName] / SHIFT_DONORS.length : 0,
    };
  }

  offers(): readonly (StampOffer | null)[] {
    if (!this.host.open()) return [];
    return this.slots.map((_s, i) => this.view(i));
  }

  rerollCost(): number { return 1 + this.paid; }

  private rerollable(): number[] {
    const out: number[] = [];
    for (let i = 0; i < OFFER_COUNT; i++) { const s = this.slots[i]; if (!s || (!s.locked && !s.sold)) out.push(i); }
    return out;
  }
  canReroll(): boolean { return this.host.open() && this.rerollable().length > 0 && this.pool(new Set()).length > 0; }

  reroll(): boolean {
    if (!this.canReroll()) return false;
    const idx = this.rerollable();
    if (!this.host.spendTickets(this.rerollCost(), 'stamps:reroll')) return false;
    this.paid += 1;
    this.rolls += 1;
    const avoid = new Set(idx.map((i) => this.slots[i]).filter((s): s is OfferState => !!s).map((s) => `${s.kind}:${s.target}`));
    for (const i of idx) this.slots[i] = null;
    const rng = this.host.rng().fork(`stamps:${this.host.night()}:${this.host.watch()}`).fork(`r${this.rolls}`);
    this.fill(rng, idx, avoid);
    this.rev += 1;
    return true;
  }

  lock(i: number): boolean {
    const s = this.slots[i];
    if (!this.host.open() || !s || s.sold || s.locked) return false;
    if (this.slots.filter((o) => o?.locked).length >= MAX_STAMP_LOCKS) return false;
    if (!this.host.spendTickets(STAMP_LOCK_TICKETS, 'stamps:lock')) return false;
    s.locked = true;
    this.rev += 1;
    return true;
  }

  unlock(i: number): boolean {
    const s = this.slots[i];
    if (!s || !s.locked) return false;
    s.locked = false;
    this.rev += 1;
    return true;
  }

  buy(i: number): StampBuy {
    if (!this.host.open()) return { ok: false, why: 'closed' };
    const s = this.slots[i];
    if (!s || s.sold) return { ok: false, why: 'none' };
    if (this.count() >= STAMP_CAP) return { ok: false, why: 'full' };
    if (!this.valid(s.kind, s.target)) return { ok: false, why: 'fail' };
    const price = stampPrice(s.kind, s.target, this.levelOf(s.kind, s.target), this.host.baseQuota());
    if (this.host.wallet() < price) return { ok: false, why: 'funds' };
    if (!this.host.spend(price, `stamp:${s.kind}:${s.target}`)) return { ok: false, why: 'funds' };
    this.bump(s.kind, s.target);
    // the offer is spent; a Gild / Etch with levels left comes back as the next level at the next intermission's draw
    s.sold = true;
    s.locked = false;
    this.rev += 1;
    return { ok: true, why: '' };
  }

  // ── save ──
  snapshot(): StampSnapshot {
    return {
      v: 1, key: this.key, rolls: this.rolls, paid: this.paid,
      gild: { ...this.gild }, shift: { ...this.shift }, etch: { ...this.etch },
      offers: this.slots.map((s) => (s ? { kind: s.kind, target: s.target, locked: s.locked, sold: s.sold } : null)),
    };
  }

  restore(snap: StampSnapshot | null | undefined): void {
    if (this.load(snap)) this.changed();
  }

  private load(snap: StampSnapshot | null | undefined): boolean {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.offers)) return false;
    const lv = emptyLevels();
    for (const n of SYM_NAMES) { lv.gild[n] = clampInt(snap.gild?.[n], 0, GILD_MAX); lv.shift[n] = clampInt(snap.shift?.[n], 0, SHIFT_MAX); }
    for (const p of ETCH_PATTERNS) lv.etch[p] = clampInt(snap.etch?.[p], 0, ETCH_MAX);
    this.gild = lv.gild; this.shift = lv.shift; this.etch = lv.etch;
    this.key = typeof snap.key === 'string' ? snap.key : '';
    this.rolls = clampInt(snap.rolls, 0, 1e6);
    this.paid = clampInt(snap.paid, 0, 1e6);
    this.slots = new Array<OfferState | null>(OFFER_COUNT).fill(null);
    for (let i = 0; i < OFFER_COUNT; i++) {
      const s = snap.offers[i];
      if (!s || !STAMP_KINDS.includes(s.kind) || typeof s.target !== 'string') continue;
      const known = s.kind === 'etch' ? ETCH_PATTERNS.includes(s.target as PatternId) : symIndex(s.target) >= 0;
      if (known) this.slots[i] = { kind: s.kind, target: s.target, locked: !!s.locked, sold: !!s.sold };
    }
    this.rev += 1;
    this.source = null;
    return true;
  }
}
