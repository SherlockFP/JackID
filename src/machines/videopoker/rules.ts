/**
 * Video Poker "Jacks Up / Deuces Down" (`videopoker`) — pure rules. No three, no DOM. Shared by the live machine
 * (`index.ts`), the headless play contract (`playHeadless`) and the RTP sim, so the simulated RTP IS the live RTP.
 *
 * Cards are integers 0..51: rank = c % 13 (0 = deuce … 12 = ace), suit = c / 13 | 0.
 * Deuces Down: every deuce (rank 0) is wild. Paytables are per credit (MACHINES §4.2); 5 credits pay a natural royal 4 000.
 * Second Look (luck L): a losing final hand redraws its replaced cards once with p = min(0.30, 0.01 · L); keep the better.
 * Double-up (MACHINES §4.4): a dealer card against four face-down cards; higher doubles, equal pushes, lower loses.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';

export type Game = 'jacks' | 'deuces';
export const GAMES: readonly Game[] = ['jacks', 'deuces'];
export const DENOMS: readonly number[] = [1, 5, 25];
export const MAX_CREDITS = 5;
export const ROYAL_5CR = 4000;           // credits paid for a natural royal at 5 credits (800 per credit)
export const DOUBLE_STEPS = 5;           // doubles allowed per hand
export const DOUBLE_CAP = 4000;          // credits: a win may not be doubled past this
export const SECOND_LOOK_CAP = 0.30;
export const SECOND_LOOK_PER_POINT = 0.01;
export const HOLD_IDLE_S = 90;           // HOLD idle → draw with the current mask, then collect
export const WIN_IDLE_S = 15;            // WIN / PICK idle → auto-collect
const HAND = 5;

export type Cat = 'none' | 'jacks' | 'twoPair' | 'trips' | 'straight' | 'flush' | 'fullHouse' | 'quads' | 'sflush'
  | 'royal' | 'naturalRoyal' | 'wildRoyal' | 'kind5' | 'fourDeuces';

/** Milestone variants: `upgraded` = payTableUpgrade (9/6 or full-pay deuces), `bonusQuads` (A/8 quads ×2), `royalMult`. */
export interface Variant { upgraded?: boolean; bonusQuads?: boolean; royalMult?: number }
export interface Eval { cat: Cat; ppc: number; pr: number }
export interface DrawOut extends Eval { final: number[]; rerolled: boolean }
export type DoubleRes = 'win' | 'push' | 'lose';

const JACKS: Partial<Record<Cat, number>> = { royal: 250, sflush: 50, quads: 25, fullHouse: 8, flush: 5, straight: 4, trips: 3, twoPair: 2, jacks: 1 };
const JACKS_UP: Partial<Record<Cat, number>> = { ...JACKS, fullHouse: 9, flush: 6 };
const DEUCES: Partial<Record<Cat, number>> = { naturalRoyal: 250, fourDeuces: 200, wildRoyal: 25, kind5: 16, sflush: 10, quads: 4, fullHouse: 4, flush: 3, straight: 2, trips: 1 };
const DEUCES_FULL: Partial<Record<Cat, number>> = { ...DEUCES, kind5: 15, sflush: 9, quads: 5, fullHouse: 3, flush: 2, straight: 2 };
const ORDER: Record<Cat, number> = {
  none: 0, jacks: 1, twoPair: 2, trips: 3, straight: 4, flush: 5, fullHouse: 6, quads: 7, sflush: 8,
  royal: 9, naturalRoyal: 9, wildRoyal: 9, kind5: 10, fourDeuces: 11,
};

/** Paytable rows for the paytable screen, highest first. */
export function payTable(game: Game, upgraded = false): Array<{ cat: Cat; ppc: number }> {
  const rows: Cat[] = game === 'jacks'
    ? ['royal', 'sflush', 'quads', 'fullHouse', 'flush', 'straight', 'trips', 'twoPair', 'jacks']
    : ['naturalRoyal', 'fourDeuces', 'wildRoyal', 'kind5', 'sflush', 'quads', 'fullHouse', 'flush', 'straight', 'trips'];
  const t = game === 'jacks' ? (upgraded ? JACKS_UP : JACKS) : (upgraded ? DEUCES_FULL : DEUCES);
  return rows.map((cat) => ({ cat, ppc: t[cat] ?? 0 }));
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────────
export const rankOf = (c: number): number => c % 13;
export const suitOf = (c: number): number => (c / 13) | 0;
const RANK_CH = '23456789TJQKA';
const SUIT_CH = 'SHDC';
export const rankChar = (c: number): string => RANK_CH[rankOf(c)];
export const suitChar = (c: number): string => SUIT_CH[suitOf(c)];
export const isRed = (c: number): boolean => suitOf(c) === 1 || suitOf(c) === 2;
export const popCount = (m: number): number => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };

/** Fresh Fisher–Yates 52-card deck from the round stream. The whole order is fixed at DEAL. */
export function newDeck(rng: Rng): number[] {
  return rng.shuffle(Array.from({ length: 52 }, (_, i) => i));
}

// ── evaluation ───────────────────────────────────────────────────────────────────────────────────
/** Standard five-card category. `pr` = pair rank (pairs) or top rank (straights), 0 = deuce … 12 = ace. */
function evalStd(c: readonly number[]): { cat: Cat; pr: number } {
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let mask = 0, flush = true;
  const s0 = suitOf(c[0]);
  for (let i = 0; i < HAND; i++) {
    cnt[c[i] % 13]++;
    mask |= 1 << (c[i] % 13);
    if (suitOf(c[i]) !== s0) flush = false;
  }
  let max = 0, pairs = 0, pairRank = -1, quadRank = -1;
  for (let r = 0; r < 13; r++) {
    const k = cnt[r];
    if (k > max) max = k;
    if (k === 2) { pairs++; if (r > pairRank) pairRank = r; }
    if (k === 4) quadRank = r;
  }
  if (max === 5) return { cat: 'kind5', pr: cnt.indexOf(5) };
  let lo = -1, hi = -1;
  if (max === 1) for (let r = 0; r < 13; r++) if ((mask >> r) & 1) { if (lo < 0) lo = r; hi = r; }
  const straight = max === 1 && hi - lo === 4;
  const isFlush = flush && max === 1;
  if (straight && isFlush) return { cat: lo === 8 ? 'royal' : 'sflush', pr: hi };
  if (max === 4) return { cat: 'quads', pr: quadRank };
  if (max === 3 && pairs === 1) return { cat: 'fullHouse', pr: -1 };
  if (isFlush) return { cat: 'flush', pr: hi };
  if (straight) return { cat: 'straight', pr: hi };
  if (max === 3) return { cat: 'trips', pr: -1 };
  if (pairs === 2) return { cat: 'twoPair', pr: pairRank };
  if (pairs === 1) return { cat: pairRank >= 9 ? 'jacks' : 'none', pr: pairRank };
  return { cat: 'none', pr: hi };
}

/** Best category and per-credit pay of a five-card hand. Deuces Down searches every substitution of its wild deuces. */
export function evaluate(hand: readonly number[], game: Game, v: Variant = {}): Eval {
  if (game === 'jacks') {
    const s = evalStd(hand);
    let ppc = (v.upgraded ? JACKS_UP : JACKS)[s.cat] ?? 0;
    if (s.cat === 'quads' && v.bonusQuads && (s.pr === 12 || s.pr === 6)) ppc *= 2;   // aces and eights
    return { cat: s.cat, ppc, pr: s.pr };
  }
  const t = v.upgraded ? DEUCES_FULL : DEUCES;
  const slots: number[] = [];
  hand.forEach((c, i) => { if (rankOf(c) === 0) slots.push(i); });
  const w = slots.length;
  if (w === 0) {
    const s = evalStd(hand);
    const cat: Cat = s.cat === 'royal' ? 'naturalRoyal' : s.cat;
    return { cat, ppc: t[cat] ?? 0, pr: s.pr };
  }
  if (w >= 4) return { cat: 'fourDeuces', ppc: t.fourDeuces ?? 0, pr: -1 };
  const tmp = hand.slice();
  let best: Eval = { cat: 'none', ppc: 0, pr: -1 };
  const search = (d: number): void => {
    if (d === slots.length) {
      const s = evalStd(tmp);
      const cat: Cat = s.cat === 'royal' ? 'wildRoyal' : s.cat;
      const ppc = t[cat] ?? 0;
      if (ppc > best.ppc) best = { cat, ppc, pr: s.pr };
      return;
    }
    for (let c = 0; c < 52; c++) { tmp[slots[d]] = c; search(d + 1); }
  };
  search(0);
  return best;
}

/** Credits paid for an evaluated hand at `credits` (the bet is credits × denomination, the win is credits × pay × denomination). */
export function payCredits(e: Eval, credits: number, v: Variant = {}): number {
  if (e.ppc <= 0) return 0;
  const natRoyal = e.cat === 'royal' || e.cat === 'naturalRoyal';
  const base = natRoyal && credits === MAX_CREDITS ? ROYAL_5CR : e.ppc * credits;
  return natRoyal ? base * (v.royalMult ?? 1) : base;
}

export const secondLookChance = (luck: number): number =>
  Math.min(SECOND_LOOK_CAP, SECOND_LOOK_PER_POINT * Math.max(0, luck));

/**
 * DRAW: `mask` bit i = card i held. Replaced cards take deck[5..] in order. A losing result gets one Second Look
 * (`secondLook` = the caller's gate roll) that redraws the replaced cards from the next deck cards; the better hand is kept.
 */
export function drawHand(deck: readonly number[], hand: readonly number[], mask: number, game: Game, v: Variant = {}, secondLook = false): DrawOut {
  const fill = (from: number): number[] => {
    let k = from;
    return hand.map((c, i) => ((mask >> i) & 1 ? c : deck[k++]));
  };
  const replaced = HAND - popCount(mask & 31);
  const first = fill(HAND);
  const e1 = evaluate(first, game, v);
  if (!secondLook || e1.ppc > 0 || replaced === 0) return { ...e1, final: first, rerolled: false };
  const second = fill(HAND + replaced);
  const e2 = evaluate(second, game, v);
  return e2.ppc > 0 ? { ...e2, final: second, rerolled: true } : { ...e1, final: first, rerolled: true };
}

// ── strategy: exact EV-optimal hold (the Shill and the HOLD hint use it) ─────────────────────────────
// A hold's expected payout is an exact sum over every draw of the 47 undealt cards. Re-enumerating those draws for
// each of the 32 holds is too slow for a live deal, so every 5-card hand is paid once per game and variant into a table,
// and the sums over all hands that contain a card set are built from it (subsets up to size 5, combinatorial number
// system). A hold then costs at most 3^5 reads, by inclusion–exclusion over the discarded cards. The result is exact.

const BINOM: number[][] = [];
for (let n = 0; n <= 52; n++) {
  BINOM.push([]);
  for (let k = 0; k <= 5; k++) BINOM[n][k] = k === 0 ? 1 : n === 0 ? 0 : BINOM[n - 1][k - 1] + BINOM[n - 1][k];
}
/** Offset of the size-j subsets in a table; the size-j rank of a sorted set is `combRank(set)`. */
const OFF: number[] = [0];
for (let j = 1; j <= HAND + 1; j++) OFF.push(OFF[j - 1] + BINOM[52][j - 1]);
const combRank = (a: readonly number[]): number => combRankN(a, a.length);
/** Rank of the first `n` entries of a sorted set (no allocation: the table build calls it millions of times). */
const combRankN = (a: readonly number[], n: number): number => {
  let r = 0;
  for (let i = 0; i < n; i++) r += BINOM[a[i]][i + 1];
  return r;
};
/** The four natural royals (ranks 10…A, one per suit), sorted. */
const NAT_ROYALS: readonly (readonly number[])[] = [0, 1, 2, 3].map((s) => [8, 9, 10, 11, 12].map((r) => s * 13 + r));

const paysFor = (game: Game, v: Variant): Partial<Record<Cat, number>> =>
  game === 'jacks' ? (v.upgraded ? JACKS_UP : JACKS) : (v.upgraded ? DEUCES_FULL : DEUCES);

/**
 * Deuces Down with 1–3 wild deuces: the best pay over every substitution, read off the non-wild cards (what each category
 * needs) instead of searching the 52^w substitutions. Same answer as `evaluate(hand).ppc`; `scripts` sims cross-check it.
 */
export function wildPpc(hand: readonly number[], w: number, t: Partial<Record<Cat, number>>): number {
  const n = HAND - w;
  const cnt = new Array<number>(13).fill(0);
  let suit = -1, sameSuit = true, lo = 13, hi = -1;
  for (const c of hand) {
    if (rankOf(c) === 0) continue;
    const r = rankOf(c), s = suitOf(c);
    cnt[r]++;
    if (suit < 0) suit = s; else if (s !== suit) sameSuit = false;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  const rs: number[] = [];
  let maxC = 0;
  for (let r = 0; r < 13; r++) { if (cnt[r]) rs.push(r); if (cnt[r] > maxC) maxC = cnt[r]; }
  const distinct = rs.length === n;
  // five consecutive ranks L…L+4 (L 0…8, no ace-low) must hold every non-wild rank
  const window = distinct && Math.max(0, hi - 4) <= Math.min(lo, 8);
  const fullHouse = rs.length === 1 ? cnt[rs[0]] <= 3
    : rs.length === 2 && ((cnt[rs[0]] <= 3 && cnt[rs[1]] <= 2) || (cnt[rs[1]] <= 3 && cnt[rs[0]] <= 2));
  let best = 0;
  const take = (cat: Cat, ok: boolean): void => { if (ok && (t[cat] ?? 0) > best) best = t[cat] ?? 0; };
  take('wildRoyal', sameSuit && distinct && lo >= 8);
  take('sflush', sameSuit && window);
  take('kind5', rs.length === 1);
  take('quads', maxC + w >= 4);
  take('fullHouse', fullHouse);
  take('flush', sameSuit);
  take('straight', window);
  take('trips', maxC + w >= 3);
  return best;
}

/**
 * `t[OFF[j] + combRank(Y)]` = Σ over 5-card hands F ⊇ Y of the per-credit pay ppc(F), natural royals excluded (they pay
 * a credits-dependent amount and are counted separately).
 */
interface VTable { val: Float64Array; hit: Uint32Array }
function buildTable(game: Game, v: Variant): VTable {
  const t = new Float64Array(OFF[HAND + 1]);
  // hit[Y] = number of 5-card hands F ⊇ Y that pay (naturals included): the draw odds, built in the same pass
  const hit = new Uint32Array(OFF[HAND + 1]);
  const sub = [0, 0, 0, 0, 0];
  const a = [0, 0, 0, 0, 0];
  for (a[0] = 0; a[0] < 52; a[0]++)
    for (a[1] = a[0] + 1; a[1] < 52; a[1]++)
      for (a[2] = a[1] + 1; a[2] < 52; a[2]++)
        for (a[3] = a[2] + 1; a[3] < 52; a[3]++)
          for (a[4] = a[3] + 1; a[4] < 52; a[4]++) {
            const w = game === 'deuces' ? a.reduce((n, c) => n + (rankOf(c) === 0 ? 1 : 0), 0) : 0;
            let pay: number, nat = false;
            if (w >= 1 && w <= 3) pay = wildPpc(a, w, paysFor(game, v));
            else {
              const e = evaluate(a, game, v);
              nat = e.cat === 'royal' || e.cat === 'naturalRoyal';
              pay = e.ppc;
            }
            t[OFF[HAND] + combRank(a)] = nat ? 0 : pay;
            if (pay > 0) for (let mask = 0; mask < 1 << HAND; mask++) {
              let n = 0;
              for (let i = 0; i < HAND; i++) if ((mask >> i) & 1) sub[n++] = a[i];
              hit[OFF[n] + combRankN(sub, n)]++;
            }
          }
  // A size-m set's sum also belongs to each of its (m−1)-subsets; each hand is counted (5−(m−1)) times there, so divide.
  for (let m = HAND; m >= 1; m--) {
    const g: number[] = new Array(m).fill(0);
    const sub: number[] = new Array(m - 1).fill(0);
    const rec = (start: number, d: number): void => {
      if (d === m) {
        const val = t[OFF[m] + combRank(g)] / (HAND + 1 - m);
        for (let p = 0, q = 0; p < m; p++) {
          q = 0;
          for (let i = 0; i < m; i++) if (i !== p) sub[q++] = g[i];
          t[OFF[m - 1] + combRank(sub)] += val;
        }
        return;
      }
      for (let c = start; c <= 52 - (m - d); c++) { g[d] = c; rec(c + 1, d + 1); }
    };
    rec(0, 0);
  }
  return { val: t, hit };
}

const tableCache = new Map<string, VTable>();
function tableFor(game: Game, v: Variant): VTable {
  const key = `${game}|${v.upgraded ? 1 : 0}|${v.bonusQuads ? 1 : 0}`;
  let t = tableCache.get(key);
  if (!t) {
    if (tableCache.size >= 4) tableCache.clear();
    t = buildTable(game, v);
    tableCache.set(key, t);
  }
  return t;
}

/**
 * Draw odds of a hold: the chance (0..1) that the draw from the 47 undealt cards ends on a paying hand, before any
 * Second Look. Exact: inclusion–exclusion over the discarded cards on the hit table, as `holdEV` does for credits.
 */
export function holdOdds(hand: readonly number[], held: number, game: Game, v: Variant = {}): number {
  const t = tableFor(game, v).hit;
  const H: number[] = [], D: number[] = [];
  for (let i = 0; i < HAND; i++) ((held >> i) & 1 ? H : D).push(hand[i]);
  const k = D.length;
  let total = 0;
  for (let x = 0; x < 1 << k; x++) {
    const Y = H.slice();
    let sign = 1;
    for (let j = 0; j < k; j++) if ((x >> j) & 1) { Y.push(D[j]); sign = -sign; }
    Y.sort((p, q) => p - q);
    total += sign * t[OFF[Y.length] + combRank(Y)];
  }
  return Math.min(1, Math.max(0, total / BINOM[52 - HAND][k]));
}

/** Expected credits of keeping `held` (bit i = card i) and drawing the rest from the 47 cards the hand does not use. */
function holdEV(hand: readonly number[], held: number, game: Game, credits: number, v: Variant): number {
  const t = tableFor(game, v).val;
  const H: number[] = [], D: number[] = [];
  for (let i = 0; i < HAND; i++) ((held >> i) & 1 ? H : D).push(hand[i]);
  const k = D.length;
  const royalPay = payCredits(evaluate(NAT_ROYALS[0], game, v), credits, v);
  let total = 0;
  for (let x = 0; x < 1 << k; x++) {
    const Y = H.slice();
    let sign = 1;
    for (let j = 0; j < k; j++) if ((x >> j) & 1) { Y.push(D[j]); sign = -sign; }
    Y.sort((p, q) => p - q);
    let nat = 0;
    for (const roy of NAT_ROYALS) if (Y.every((c) => roy.includes(c))) nat++;
    total += sign * (credits * t[OFF[Y.length] + combRank(Y)] + nat * royalPay);
  }
  return total / BINOM[52 - HAND][k];
}

/** Best hold per dealt hand (key = game, variant, bet and the cards in deal order). Bounded: cleared when full. */
const HOLD_CACHE_MAX = 4096;
const holdCache = new Map<string, number>();

/**
 * EV-optimal hold mask (bit i = card i kept) for a dealt hand: every hold (32) is scored exactly. `credits` defaults to
 * the max bet, the strategy the HOLD hint shows. Ties keep the larger mask. Second Look is not part of the strategy.
 */
export function holdHint(hand: readonly number[], game: Game, credits = MAX_CREDITS, v: Variant = {}): number {
  const key = `${game}|${credits}|${v.upgraded ? 1 : 0}|${v.bonusQuads ? 1 : 0}|${v.royalMult ?? 1}|${hand.join(',')}`;
  const hit = holdCache.get(key);
  if (hit !== undefined) return hit;
  let best = 31, bestEV = -Infinity;
  for (let m = 31; m >= 0; m--) {
    const ev = holdEV(hand, m, game, credits, v);
    if (ev > bestEV + 1e-9) { bestEV = ev; best = m; }
  }
  if (holdCache.size >= HOLD_CACHE_MAX) holdCache.clear();
  holdCache.set(key, best);
  return best;
}

// ── round helpers ────────────────────────────────────────────────────────────────────────────────
/** Double-up deal from a fresh shuffle: [dealer, face1..face4]. */
export function doubleDeal(rng: Rng): number[] {
  return newDeck(rng).slice(0, 5);
}
/** Rank compare (2 low … A high, suits ignored). */
export function doubleResult(dealer: number, picked: number): DoubleRes {
  const a = rankOf(dealer), b = rankOf(picked);
  return b > a ? 'win' : b === a ? 'push' : 'lose';
}

/** One whole hand with the EV-optimal hold (sims and headless play). Consumes the round stream. */
export function playHand(rng: Rng, game: Game, credits: number, v: Variant = {}, luck = 0): { credits: number; cat: Cat; rerolled: boolean } {
  const deck = newDeck(rng);
  const hand = deck.slice(0, HAND);
  const mask = holdHint(hand, game, credits, v);
  const gate = rng.next() < secondLookChance(luck);
  const out = drawHand(deck, hand, mask, game, v, gate);
  return { credits: payCredits(out, credits, v), cat: out.cat, rerolled: out.rerolled };
}

/** Headless single hand (staff auto-play): Jacks Up, one credit unit per coin, no double-up. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const credits = Math.min(MAX_CREDITS, Math.max(1, Math.floor(bet)));
  const denom = bet / credits;
  const r = playHand(rng, 'jacks', credits, {}, h.luck);
  return { gross: Math.floor(r.credits * denom), tags: r.rerolled ? ['lucky'] : [] };
};
