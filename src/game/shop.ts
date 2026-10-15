/**
 * The Pawn Window's stock keeper (`run.pawn`, Wave 8 items 2 and 7). Implements `PawnApi` from the charm_vendor lane.
 *
 *  - Stock is drawn ONCE per intermission from the stream `pawn:${night}:${watch}`; buying never reshuffles anything.
 *  - Rerolls (`pawn:${night}:${watch}` → fork `r<n>`) replace only slots that are unlocked and unsold.
 *    Free rerolls are used first; the paid cost is 1 Ticket, +1 per further paid reroll in the same intermission.
 *  - A lock (1 Ticket, max 2) keeps the item on the shelf through rerolls and into the next intermission until it is
 *    bought or unlocked. Prices follow the current SI, so a locked charm costs what it costs now.
 *  - From Night 2 the under-the-counter slot (index 3) holds a Rare/Legendary or a Cursed charm, 50 / 50.
 *  - Shelf bias: slot 0 weighs charms that share the suit / archetype key you hold most x3.
 *  - FIT n: held charms sharing a key with the candidate, +1 when it boosts the payout of your most-played machine.
 *  - Swap on full pegs: `buy(pid, i, replaceId)` sells the replaced charm back at the host's sell value, then buys.
 *  - First shop of a run (Night 1, first Watch): at least one synergy charm (an engine, or a suit charm whose suit is on the floor)
 *    is on a regular shelf, so a new run always has a build to start. The Pawn also restocks on a Night rollover: after Dawn the
 *    host reports the NEXT Night's key, so the shelf is redrawn once per Night instead of repeating the last Watch's stock.
 *  - Price (Wave 20): def.price × SI × `pawnPriceScale`. The scale only lowers prices, so on every Night the dearest Common
 *    costs at most 60 % of the Night's base quota (the cheapest charm then sits near 30 %); Rares / Legendaries may exceed it.
 *  - Foundations / House hooks (read through `PawnHost.mod`): `x.pawn.freeRerolls` (Pawn Bell) adds free rerolls per visit,
 *    `x.pawn.freeFirst` (Golden Ticket) makes the first reroll of each visit free, `x.pawn.slots` (Second Window) adds
 *    regular shelves after the under-counter slot (indices >= SLOTS, up to SLOT_EXTRA_MAX), and `x.charm.sellValue`
 *    (Pawnbroker's Friend) raises the sell share through `sellRefund`.
 *  - `snapshot()` / `restore()` carry the whole state into the save (plain JSON).
 *
 * The run supplies a `PawnHost`; this file never touches run.ts internals. Seeded rng only.
 */
import type { PlayerId } from '@/core/types';
import type { Rng } from '@/core/rng';
import { allCharmDefs, charmDef } from '@/game/charms/engine';
import { LAUNCH_CHARM_IDS, SUIT_SCALED_CHARMS } from '@/game/data/charms';
import { ENGINE_CHARM_IDS } from '@/game/data/charmsEngines';
import { charmPrice, rollRarity, type ShopRarity } from '@/game/economy';
import { nightDef, pawnPriceScale } from '@/game/data/schedule';
import { foldEffects, scopeMatches, stackedValue } from '@/game/types';
import type { CharmDef, ModBreakdown } from '@/game/types';
import type { ModHook } from '@/game/modifiers.types';
import { linPoolAccepts } from '@/game/data/rooms';
import {
  LOCK_TICKETS, MAX_LOCKS, REMOVE_CURSE_TICKETS, SLOTS, UNDER_COUNTER_INDEX,
  type PawnApi, type PawnBuy, type PawnPreview, type PawnSlot as PawnSlotBase, type SwapChoice,
} from '@/machines/charm_vendor/rules';

/** Old Lin the Tile Reader's shelf: CARDS / MAHJONG charms only. Pass as `PawnHost.poolFilter` while the Jade Room vendor is in use. */
export const oldLinPoolFilter = (d: CharmDef): boolean => linPoolAccepts(d);

/** Slot that gets the shelf bias, and the slot the `x.shop.discountSlot` charm discounts. */
export const BIAS_SLOT = 0;
export const DISCOUNT_SLOT = 2;
export const BIAS_WEIGHT = 3;
const REGULAR = 3;
/** Regular shelves the house can add (`x.pawn.slots`). They sit after the under-counter slot, so UNDER_COUNTER_INDEX stays put. */
export const SLOT_EXTRA_MAX = 2;
const MAX_SLOTS = SLOTS + SLOT_EXTRA_MAX;
/** Director decision 3 (wave 42): every intermission offers a charm priced at most max(FLOOR_CHARM_MIN, FLOOR_CHARM_SHARE x quota). */
export const FLOOR_CHARM_MIN = 8;
export const FLOOR_CHARM_SHARE = 0.25;
/** Wave 7: chance that a regular shelf offers an owned engine charm as EVOLVE (only when one can take a second stack). */
export const EVOLVE_CHANCE = 0.35;

/** A stock slot as the shelf shows it: `evolve` marks a second copy of an owned engine charm (one stack more, no peg). */
export type PawnSlot = PawnSlotBase & { evolve: boolean };

/** Dearest launch Common's base price: the anchor of the Pawn price scale (`pawnPriceScale`). Computed once. */
let commonTopMemo: number | null = null;
function commonTop(): number {
  if (commonTopMemo === null) {
    commonTopMemo = Math.max(0, ...allCharmDefs().filter((d) => d.rarity === 'common' && LAUNCH_CHARM_IDS.has(d.id)).map((d) => d.price));
  }
  return commonTopMemo;
}

/** The machine the player used most, with the tags `scopeMatches` needs. */
export interface PawnMachine { machineId: string; tags: readonly string[]; category?: string }

/** What the Pawn needs from the run. All reads are live (the run owns the truth). */
export interface PawnHost {
  readonly selfId: PlayerId;
  /** The run rng (its streams are forked by label, so it is never advanced here). */
  rng(): Rng;
  /** 0-based Night index and Watch index (the stock key). */
  night(): number;
  watch(): number;
  /** True while the window is open (phase 'intermission' and not ended). */
  open(): boolean;
  /** Stake index (price multiplier). */
  si(): number;
  /** Optional: the Night's quota the shelf floor is read against (decision 3). Default: the Night's base quota. */
  quota?(): number;
  /** Ids of every charm held. */
  held(): readonly string[];
  /** False when another copy cannot be taken (non-stackable and held, or stacks maxed). */
  canTake(id: string): boolean;
  /** Free pegs (pegs() - pegsUsed). */
  pegsFree(): number;
  wallet(): number;
  tickets(): number;
  /** Spend Tickets; false when short. */
  spendTickets(n: number, reason: string): boolean;
  freeRerolls(): number;
  /** Consume one free reroll; false when none. */
  useFreeReroll(): boolean;
  /** `run.buyCharm`. Atomic: false means nothing was charged. */
  buyCharm(id: string, price: number): boolean;
  /** `run.sellCharm`. */
  sellCharm(id: string): boolean;
  /** Coins `sellCharm(id)` will pay (0 for a cursed charm: it cannot be sold). */
  sellValue(id: string): number;
  /** Remove the cursed charm `id` from the pegs (the Tickets are charged by the Pawn). */
  removeCurse(id: string): boolean;
  /** Optional: `shop.discount` fraction (0..0.9) applied to every positive price. */
  discount?(): number;
  /** Optional: `x.shop.discountSlot` fraction applied to the DISCOUNT_SLOT only. */
  discountSlot?(): number;
  /** Optional: shelf bias on/off (default on). */
  bias?(): boolean;
  /** Optional: is a meta unlock code (F3, W, A:...) earned? Default: never, so cursed charms (F3) stay off the shelf. */
  meta?(code: string): boolean;
  /** Optional: a pit-wide mod fold for the Pawn hooks (`x.pawn.freeRerolls`, `x.pawn.freeFirst`, `x.pawn.slots`). Default: none. */
  mod?(hook: ModHook, base: number): number;
  /** Optional: a pool filter for this shelf. Old Lin (the Jade Room vendor) stocks CARDS / MAHJONG charms only (`data/rooms.ts`). */
  poolFilter?(): ((d: CharmDef) => boolean) | null;
  /** Optional: only v1.0 launch charms are offered (default true). */
  launchOnly?(): boolean;
  /** Optional: the machines on the floor (with suit tags), for the first-shop synergy guarantee. Empty or absent = any suit. */
  floor?(): readonly PawnMachine[];
  /** Optional: the most-played machine, for FIT and the payout preview. */
  mostPlayed?(): PawnMachine | null;
  /** Optional: `run.explain('payout.mult', machineId, 1)` for the payout preview. */
  explain?(machineId: string): ModBreakdown;
}

/** `cap`: the floor shelf (decision 3) sells at this price at most; absent on every other shelf. */
interface SlotState { id: string; locked: boolean; sold: boolean; cap?: number; evo?: boolean }
export interface PawnSnapshot {
  v: 1;
  /** `${night}:${watch}` of the visit the stock was drawn for; '' = never drawn. */
  key: string;
  slots: (SlotState | null)[];
  /** Rerolls done this intermission (free + paid): the stream label of the next one. */
  rolls: number;
  /** Paid rerolls this intermission: the escalation. */
  paid: number;
  /** Pawn Bell rerolls granted this visit and not yet used (optional: older saves have none). */
  visitFree?: number;
  /** The visit's free first reroll (Golden Ticket) is spent. */
  firstUsed?: boolean;
}

// ── pure helpers (exported for the tests) ────────────────────────────────────────────────────────────────

/** Suit / archetype keys of a charm, lower-case (suit table `tag`, plus `tags` such as 'hot' or 'banker'). */
export function defKeys(d: Pick<CharmDef, 'tag' | 'tags'>): string[] {
  const out: string[] = [];
  for (const k of [d.tag, ...(d.tags ?? [])]) {
    if (!k) continue;
    const n = k.toLowerCase();
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** The key shared by most held charms (ties: alphabetical), or null with nothing held. */
export function dominantKey(held: readonly Pick<CharmDef, 'tag' | 'tags'>[]): string | null {
  const count = new Map<string, number>();
  for (const d of held) for (const k of defKeys(d)) count.set(k, (count.get(k) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of count) if (c > n || (c === n && best !== null && k < best)) { best = k; n = c; }
  return best;
}

/** Does the charm raise payouts / luck on this machine? (the "+1" of FIT) */
export function boostsMachine(d: CharmDef, m: PawnMachine): boolean {
  return (d.effects ?? []).some((e) =>
    (e.hook === 'payout.mult' || e.hook === 'payout.flat' || e.hook === 'luck' || e.hook === 'loss.refund')
    && scopeMatches(e.scope, { machineId: m.machineId, tags: m.tags }));
}

/** FIT n: held charms (other than itself) sharing a suit / archetype key, +1 when it boosts the most-played machine. */
export function fitOf(d: CharmDef, held: readonly CharmDef[], m: PawnMachine | null): number {
  const mine = defKeys(d);
  let n = 0;
  for (const h of held) if (h.id !== d.id && defKeys(h).some((k) => mine.includes(k))) n += 1;
  if (m && boostsMachine(d, m)) n += 1;
  return n;
}

/** Payout of `bd` before and after adding charm `d` (only `payout.mult` effects that reach the machine). Null when none. */
export function previewPayout(bd: ModBreakdown, d: CharmDef, m: PawnMachine, sameSuitHeld = 0): { from: number; to: number } | null {
  const scale = SUIT_SCALED_CHARMS.has(d.id) ? 1 + sameSuitHeld : 1;
  const mine = (d.effects ?? []).filter((e) => e.hook === 'payout.mult' && scopeMatches(e.scope, { machineId: m.machineId, tags: m.tags }));
  if (!mine.length) return null;
  const cur = bd.steps.map((s) => ({ op: s.op, value: stackedValue({ hook: bd.hook, op: s.op, value: s.value }, s.stacks) }));
  const add = mine.map((e) => ({ op: e.op, value: e.op === 'mult' ? e.value : e.value * scale, priority: e.priority }));
  return { from: bd.result, to: foldEffects('payout.mult', bd.base, [...cur, ...add]) };
}

/**
 * What a charm sells back for (`x.charm.sellValue`). The base share is 50 % (70 % with a Pawn Ticket) and a sell-value hook
 * can raise it (Pawnbroker's Friend sets 60 %). Never below the base share, never above 90 %. Cursed charms pay 0 (the caller).
 * The run's `sellValue` host callback and every swap refund use this one formula.
 */
export function sellRefund(price: number, frac: number, pawnTicket: boolean): number {
  const share = Math.min(0.9, Math.max(pawnTicket ? 0.7 : 0.5, frac));
  return Math.max(0, Math.floor(price * share));
}

/**
 * Unlock gate: '' = open, 'N<k>' = reached Night k. Any other code (F3, W, A:...) is meta progress the run owns: it is
 * offered only when `meta(code)` says so (no `meta` = never, the old behaviour).
 */
function unlockedAt(d: CharmDef, night: number, meta?: (code: string) => boolean): boolean {
  const u = d.unlock ?? '';
  if (!u) return true;
  const m = /^N(\d+)$/.exec(u);
  return m ? night + 1 >= Number(m[1]) : (meta?.(u) ?? false);
}

const clamp01 = (v: number): number => Math.min(0.9, Math.max(0, v));

// ── the Pawn ─────────────────────────────────────────────────────────────────────────────────────────────

export class Pawn implements PawnApi {
  private key = '';
  private slots: (SlotState | null)[] = new Array<SlotState | null>(SLOTS).fill(null);
  private rolls = 0;
  private paid = 0;
  /** Pawn Bell rerolls left this visit (`x.pawn.freeRerolls`), and whether the Golden Ticket's first reroll is spent. */
  private visitFree = 0;
  private firstUsed = false;
  /** Bumped on every mutation, so a consumer can cache against it. */
  rev = 0;

  constructor(private readonly host: PawnHost, snap?: PawnSnapshot | null) {
    if (snap) this.restore(snap);
  }

  // ── lifecycle ──
  /** Draw this intermission's stock if it has not been drawn yet. The run may call it on entering the intermission. */
  sync(): void {
    if (!this.host.open()) return;
    const key = `${this.host.night()}:${this.host.watch()}`;
    if (key === this.key) { this.grow(); return; }
    this.newVisit(key);
  }

  private newVisit(key: string): void {
    const first = this.key === '' && this.host.night() === 0 && this.host.watch() === 0;
    const old = this.slots;
    this.key = key;
    this.rolls = 0;
    this.paid = 0;
    this.visitFree = this.hookCount('x.pawn.freeRerolls');
    this.firstUsed = false;
    this.slots = new Array<SlotState | null>(this.slotCount()).fill(null);
    // Locked, unsold items stay on their shelf.
    for (let i = 0; i < Math.min(old.length, this.slots.length); i++) {
      const s = old[i];
      if (s && s.locked && !s.sold && charmDef(s.id) && this.host.canTake(s.id)) {
        this.slots[i] = { id: s.id, locked: true, sold: false, ...(s.evo ? { evo: true } : {}) };
      }
    }
    const rng = this.host.rng().fork(`pawn:${this.host.night()}:${this.host.watch()}`);
    this.fill(rng, this.freeSlots());
    if (first) this.guaranteeSynergy(rng.fork('synergy'));
    this.ensureFloor(rng.fork('floor'));
    this.rev += 1;
  }

  /** The Night's quota the floor is read against: the host's, else the Night's base. */
  private quotaNow(): number {
    return this.host.quota?.() ?? nightDef(this.host.night()).base;
  }

  /** Price of the charm on shelf `i` (Infinity for an empty or sold shelf). */
  private priceAt(i: number): number {
    const s = this.slots[i];
    const d = s && !s.sold ? charmDef(s.id) : undefined;
    return d ? this.priceOf(d, i) : Number.POSITIVE_INFINITY;
  }

  /**
   * Director decision 3: every intermission has at least one charm priced at most max(8, 25 % of the Night's quota), so a pocket
   * that just cleared Dawn always has something it can afford. The Pawn's price scale alone does not reach that on the dear
   * Nights (its cheapest Common is ~36 % of the quota from Night 4), so the floor shelf is a marked bargain: the dearest regular
   * shelf that holds no synergy charm gives way to one of the three cheapest eligible charms, which sells at the cap (`SlotState.cap`).
   */
  private ensureFloor(rng: Rng): void {
    const cap = Math.max(FLOOR_CHARM_MIN, FLOOR_CHARM_SHARE * this.quotaNow());
    if (this.slots.some((_s, i) => this.priceAt(i) <= cap)) return;
    const suits = new Set<string>();
    for (const m of this.host.floor?.() ?? []) for (const t of m.tags) suits.add(t.toLowerCase());
    // the shelf to give up: the dearest free regular shelf, a synergy charm only when nothing else is free
    const free = this.slots.map((_s, i) => i).filter((i) => i !== UNDER_COUNTER_INDEX && i !== BIAS_SLOT && !this.slots[i]?.locked);
    const plain = free.filter((i) => {
      const s = this.slots[i];
      const d = s ? charmDef(s.id) : undefined;
      return !d || !this.isSynergy(d, suits);
    });
    const giveUp = (plain.length ? plain : free).sort((a, b) => this.priceAt(b) - this.priceAt(a))[0];
    if (giveUp === undefined) return;
    const exclude = new Set<string>(this.slots.flatMap((s) => (s ? [s.id] : [])));
    // the three cheapest by price on this shelf; the bargain is capped below, so any of them is priced at most `cap`
    const cheap = allCharmDefs()
      .filter((d) => d.rarity !== 'cursed' && this.eligible(d, exclude))
      .map((d) => ({ d, p: this.priceOf(d, giveUp) }))
      .sort((a, b) => a.p - b.p || (a.d.id < b.d.id ? -1 : 1))
      .slice(0, 3);
    if (!cheap.length) return;
    this.slots[giveUp] = { id: rng.pick(cheap).d.id, locked: false, sold: false, cap };
  }

  /** Charm that starts a build: an engine, or a suit-scaled charm of a suit that is on the floor (any suit when the floor is unknown). */
  private isSynergy(d: CharmDef, suits: ReadonlySet<string>): boolean {
    if (d.rarity === 'cursed') return false;
    if (ENGINE_CHARM_IDS.has(d.id)) return true;
    return SUIT_SCALED_CHARMS.has(d.id) && !!d.tag && (suits.size === 0 || suits.has(d.tag.toLowerCase()));
  }

  /** First shop of a run: make sure a regular shelf holds a synergy charm (slot 1 is swapped when none does). */
  private guaranteeSynergy(rng: Rng): void {
    const suits = new Set<string>();
    for (const m of this.host.floor?.() ?? []) for (const t of m.tags) suits.add(t.toLowerCase());
    const shelf = this.slots.flatMap((s, i) => (s && i !== UNDER_COUNTER_INDEX ? [charmDef(s.id)] : []));
    if (shelf.some((d) => d && this.isSynergy(d, suits))) return;
    const exclude = new Set<string>(this.slots.flatMap((s) => (s ? [s.id] : [])));
    const pool = allCharmDefs().filter((d) => this.isSynergy(d, suits) && this.eligible(d, exclude));
    if (!pool.length) return;
    const at = [1, 2, 0].find((i) => i !== UNDER_COUNTER_INDEX && !this.slots[i]?.locked) ?? 1;
    this.slots[at] = { id: rng.pick(pool).id, locked: false, sold: false };
  }

  private freeSlots(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (i === UNDER_COUNTER_INDEX && this.host.night() < 1) continue;
      if (!s) out.push(i);
    }
    return out;
  }

  private eligible(d: CharmDef, exclude: ReadonlySet<string>): boolean {
    const launch = this.host.launchOnly?.() ?? true;
    const filter = this.host.poolFilter?.() ?? null;
    // An owned engine charm is offered only as EVOLVE (evolveCandidates), never as a plain copy.
    if (ENGINE_CHARM_IDS.has(d.id) && this.host.held().includes(d.id)) return false;
    return !exclude.has(d.id) && this.host.canTake(d.id) && (!launch || LAUNCH_CHARM_IDS.has(d.id)) && (!filter || filter(d))
      && unlockedAt(d, this.host.night(), (c) => this.host.meta?.(c) ?? false);
  }

  /** EVOLVE offers: owned engine charms that can take a second stack and are not on a shelf already. */
  private evolveCandidates(exclude: ReadonlySet<string>): CharmDef[] {
    const launch = this.host.launchOnly?.() ?? true;
    const filter = this.host.poolFilter?.() ?? null;
    return this.heldDefs().filter((d) => ENGINE_CHARM_IDS.has(d.id) && !exclude.has(d.id) && this.host.canTake(d.id)
      && (!launch || LAUNCH_CHARM_IDS.has(d.id)) && (!filter || filter(d)));
  }

  private heldDefs(): CharmDef[] {
    const out: CharmDef[] = [];
    for (const id of this.host.held()) { const d = charmDef(id); if (d) out.push(d); }
    return out;
  }

  /** Fill the given empty slots in order from `rng`. Ids already on a shelf (or sold this visit) are never repeated. */
  private fill(rng: Rng, idx: readonly number[], avoid: ReadonlySet<string> = new Set()): void {
    const night = this.host.night();
    const exclude = new Set<string>([...avoid, ...this.slots.flatMap((s) => (s ? [s.id] : []))]);
    const all = allCharmDefs();
    const biasKey = (this.host.bias?.() ?? true) ? dominantKey(this.heldDefs()) : null;
    for (const i of idx) {
      let pick: CharmDef | undefined;
      let evo = false;
      const mine = i === UNDER_COUNTER_INDEX ? [] : this.evolveCandidates(exclude);
      if (mine.length && rng.chance(EVOLVE_CHANCE)) {
        pick = rng.pick(mine);
        evo = true;
      } else if (i === UNDER_COUNTER_INDEX) {
        const cursed = all.filter((d) => d.rarity === 'cursed' && this.eligible(d, exclude));
        const rare = all.filter((d) => (d.rarity === 'rare' || d.rarity === 'legendary') && this.eligible(d, exclude));
        const first = rng.chance(0.5) ? cursed : rare;
        let pool = first.length ? first : (first === cursed ? rare : cursed);
        // Nothing rare or cursed is unlocked yet (early Nights): the best the counter has is an Uncommon.
        if (!pool.length) pool = all.filter((d) => d.rarity === 'uncommon' && this.eligible(d, exclude));
        if (pool.length) pick = rng.pick(pool);
      } else {
        const rarity: ShopRarity = rollRarity(rng, night);
        let pool = all.filter((d) => d.rarity === rarity && this.eligible(d, exclude));
        if (!pool.length) pool = all.filter((d) => d.rarity !== 'cursed' && this.eligible(d, exclude));
        if (pool.length) {
          pick = i === BIAS_SLOT && biasKey
            ? rng.weighted(pool, pool.map((d) => (defKeys(d).includes(biasKey) ? BIAS_WEIGHT : 1)))
            : rng.pick(pool);
        }
      }
      if (pick) { this.slots[i] = { id: pick.id, locked: false, sold: false, ...(evo ? { evo: true } : {}) }; exclude.add(pick.id); }
    }
  }

  // ── hook reads (pit-wide, through the host's fold) ──
  /** Whole count from a Pawn hook (0 without a fold). */
  private hookCount(hook: ModHook): number { return Math.max(0, Math.round(this.host.mod?.(hook, 0) ?? 0)); }
  /** Regular shelves the house has added (`x.pawn.slots`, capped at SLOT_EXTRA_MAX). */
  private extraSlots(): number { return Math.min(SLOT_EXTRA_MAX, this.hookCount('x.pawn.slots')); }
  /** Shelves on this Pawn: the four launch slots plus the house's extras. */
  slotCount(): number { return SLOTS + this.extraSlots(); }
  /** The Golden Ticket: the visit's first reroll is free until it is spent. */
  private firstFree(): boolean { return !this.firstUsed && this.hookCount('x.pawn.freeFirst') > 0; }

  /** A shelf bought mid-visit appears at once. Its charms come from the visit's own stream, so they are the same on reload. */
  private grow(): void {
    const want = this.slotCount();
    const from = this.slots.length;
    if (from >= want) return;
    while (this.slots.length < want) this.slots.push(null);
    const idx: number[] = [];
    for (let i = from; i < want; i++) idx.push(i);
    this.fill(this.host.rng().fork(`pawn:${this.host.night()}:${this.host.watch()}`).fork(`x${from}`), idx);
    this.rev += 1;
  }

  // ── PawnApi: reads ──
  open(): boolean { return this.host.open(); }

  stock(_pid: PlayerId): readonly (PawnSlot | null)[] {
    if (!this.host.open()) return [];
    this.sync();
    const held = this.heldDefs();
    const m = this.host.mostPlayed?.() ?? null;
    return this.slots.map((s, i): PawnSlot | null => {
      if (!s || s.sold || !this.host.canTake(s.id)) return null;
      const d = charmDef(s.id);
      if (!d) return null;
      const price = this.priceOf(d, i);
      return {
        charmId: s.id, price, rarity: d.rarity, cursed: d.rarity === 'cursed', tag: d.tag, underCounter: i === UNDER_COUNTER_INDEX,
        locked: s.locked, fit: fitOf(d, held, m), bias: i === BIAS_SLOT, discounted: price > 0 && price < this.basePrice(d),
        evolve: s.evo === true,
      };
    });
  }

  /** Price before discounts: def.price × SI × the Night's Pawn scale (Wave 20: the shelf stays within the quota's reach). */
  private basePrice(d: CharmDef): number {
    const si = this.host.si();
    return charmPrice(d, si * pawnPriceScale(this.host.night(), si, commonTop()));
  }

  private priceOf(d: CharmDef, i: number): number {
    const base = this.basePrice(d);
    if (base <= 0) return base;
    let f = 1 - clamp01(this.host.discount?.() ?? 0);
    if (i === DISCOUNT_SLOT) f *= 1 - clamp01(this.host.discountSlot?.() ?? 0);
    const price = Math.max(1, Math.round(base * f));
    const cap = this.slots[i]?.cap;
    return cap !== undefined ? Math.min(price, cap) : price;
  }

  /** Free rerolls left this visit: the run's own, the Pawn Bell's, and the Golden Ticket's first reroll. */
  rerollCost(): number { return this.freeRerolls() > 0 ? 0 : 1 + this.paid; }
  freeRerolls(): number {
    this.sync();
    return this.host.freeRerolls() + this.visitFree + (this.firstFree() ? 1 : 0);
  }

  private rerollable(): number[] {
    this.sync();
    const out: number[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      if (i === UNDER_COUNTER_INDEX && this.host.night() < 1) continue;
      const s = this.slots[i];
      if (!s || (!s.locked && !s.sold)) out.push(i);
    }
    return out;
  }

  canReroll(): boolean { return this.host.open() && this.rerollable().length > 0; }

  preview(_pid: PlayerId, i: number): PawnPreview | null {
    const m = this.host.mostPlayed?.() ?? null;
    const s = this.slots[i];
    if (!m || !s || s.sold || !this.host.explain) return null;
    const d = charmDef(s.id);
    if (!d) return null;
    const suit = d.tag ? this.heldDefs().filter((h) => h.tag === d.tag).length : 0;
    const r = previewPayout(this.host.explain(m.machineId), d, m, suit);
    return r ? { machineId: m.machineId, from: r.from, to: r.to } : null;
  }

  cursedOwned(_pid: PlayerId): readonly string[] {
    return this.host.held().filter((id) => charmDef(id)?.rarity === 'cursed');
  }

  // ── PawnApi: actions ──
  reroll(): boolean {
    if (!this.host.open()) return false;
    const idx = this.rerollable();
    if (!idx.length) return false;
    // Free sources, in order: the Golden Ticket's first reroll, the Pawn Bell, then the run's own free rerolls.
    const first = this.firstFree();
    const bell = !first && this.visitFree > 0;
    const runFree = !first && !bell && this.host.freeRerolls() > 0;
    const free = first || bell || runFree;
    if (first) this.firstUsed = true;
    else if (bell) this.visitFree -= 1;
    else if (runFree) { if (!this.host.useFreeReroll()) return false; }
    else if (!this.host.spendTickets(1 + this.paid, 'pawn:reroll')) return false;
    const avoid = new Set<string>();
    for (const i of idx) { const s = this.slots[i]; if (s) avoid.add(s.id); this.slots[i] = null; }
    const rng = this.host.rng().fork(`pawn:${this.host.night()}:${this.host.watch()}`).fork(`r${this.rolls}`);
    this.fill(rng, idx, avoid);
    this.fill(rng, idx.filter((i) => !this.slots[i]));   // a thin pool: allow a repeat rather than an empty shelf
    this.ensureFloor(rng.fork('floor'));                 // a reroll can take the floor shelf away: the floor holds
    this.rolls += 1;
    if (!free) this.paid += 1;
    this.rev += 1;
    return true;
  }

  lock(i: number): boolean {
    if (!this.host.open()) return false;
    this.sync();
    const s = this.slots[i];
    if (!s || s.sold || s.locked) return false;
    if (this.slots.filter((x) => x?.locked && !x.sold).length >= MAX_LOCKS) return false;
    if (!this.host.spendTickets(LOCK_TICKETS, 'pawn:lock')) return false;
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

  needsSwap(_pid: PlayerId, i: number): boolean {
    const s = this.slots[i];
    return !!s && !s.sold && this.host.pegsFree() <= 0 && !this.host.held().includes(s.id);
  }

  swapChoices(_pid: PlayerId, _i: number): readonly SwapChoice[] {
    const out: SwapChoice[] = [];
    for (const id of this.host.held()) {
      const d = charmDef(id);
      if (!d || d.rarity === 'cursed') continue;
      out.push({ id, refund: this.host.sellValue(id) });
    }
    return out;
  }

  buy(pid: PlayerId, i: number, replaceId?: string): PawnBuy {
    if (!this.host.open()) return { ok: false, why: 'closed' };
    this.sync();
    const s = this.slots[i];
    const d = s ? charmDef(s.id) : undefined;
    if (!s || !d || s.sold || !this.host.canTake(s.id)) return { ok: false, why: 'none' };
    const price = this.priceOf(d, i);
    let refund = 0;
    const swap = this.needsSwap(pid, i);
    if (swap) {
      if (replaceId === undefined) return { ok: false, why: 'swap' };
      const pick = this.swapChoices(pid, i).find((c) => c.id === replaceId);
      if (!pick) return { ok: false, why: 'limit' };
      refund = pick.refund;
    }
    if (price > 0 && this.host.wallet() + refund < price) return { ok: false, why: 'funds' };
    if (swap && (replaceId === undefined || !this.host.sellCharm(replaceId))) return { ok: false, why: 'fail' };
    if (!this.host.buyCharm(s.id, price)) {
      if (swap && replaceId !== undefined) this.host.buyCharm(replaceId, 0);   // put the sold charm back; the sale was refused
      return { ok: false, why: 'fail' };
    }
    s.sold = true;
    s.locked = false;
    this.rev += 1;
    return { ok: true, why: '' };
  }

  removeCurse(charmId: string): boolean {
    if (!this.host.open()) return false;
    if (charmDef(charmId)?.rarity !== 'cursed' || !this.host.held().includes(charmId)) return false;
    if (this.host.tickets() < REMOVE_CURSE_TICKETS) return false;
    if (!this.host.spendTickets(REMOVE_CURSE_TICKETS, 'pawn:curse')) return false;
    if (!this.host.removeCurse(charmId)) return false;
    this.rev += 1;
    return true;
  }

  // ── save ──
  snapshot(): PawnSnapshot {
    return {
      v: 1, key: this.key, rolls: this.rolls, paid: this.paid, visitFree: this.visitFree, firstUsed: this.firstUsed,
      slots: this.slots.map((s) => (s ? {
        id: s.id, locked: s.locked, sold: s.sold, ...(s.cap !== undefined ? { cap: s.cap } : {}), ...(s.evo ? { evo: true } : {}),
      } : null)),
    };
  }

  restore(snap: PawnSnapshot): void {
    if (!snap || snap.v !== 1 || !Array.isArray(snap.slots)) return;
    this.key = typeof snap.key === 'string' ? snap.key : '';
    this.rolls = Math.max(0, Math.floor(snap.rolls) || 0);
    this.paid = Math.max(0, Math.floor(snap.paid) || 0);
    this.visitFree = Math.max(0, Math.floor(snap.visitFree ?? 0) || 0);
    this.firstUsed = !!snap.firstUsed;
    const n = Math.min(MAX_SLOTS, snap.slots.length);
    this.slots = new Array<SlotState | null>(n).fill(null);
    for (let i = 0; i < n; i++) {
      const s = snap.slots[i];
      if (s && typeof s.id === 'string' && charmDef(s.id)) {
        const cap = typeof s.cap === 'number' && Number.isFinite(s.cap) ? Math.max(1, Math.floor(s.cap)) : undefined;
        this.slots[i] = { id: s.id, locked: !!s.locked, sold: !!s.sold, ...(cap !== undefined ? { cap } : {}), ...(s.evo ? { evo: true } : {}) };
      }
    }
    this.rev += 1;
  }
}
