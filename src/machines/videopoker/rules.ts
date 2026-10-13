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

// ── strategy (simple table; the Shill and the HOLD hint use it) ──────────────────────────────────
function groupMask(hand: readonly number[], minK: number, exclude = 0): number {
  const cnt = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  hand.forEach((c, i) => { if (!((exclude >> i) & 1)) cnt[rankOf(c)]++; });
  let m = 0;
  hand.forEach((c, i) => { if (!((exclude >> i) & 1) && cnt[rankOf(c)] >= minK) m |= 1 << i; });
  return m;
}
function suitMask(hand: readonly number[], k: number, exclude = 0): number {
  for (let s = 0; s < 4; s++) {
    let m = 0;
    hand.forEach((c, i) => { if (suitOf(c) === s && !((exclude >> i) & 1)) m |= 1 << i; });
    if (popCount(m) >= k) return m;
  }
  return 0;
}
function straightDraw(hand: readonly number[]): number {
  for (let m = 0; m < 32; m++) {
    if (popCount(m) !== 4) continue;
    let lo = 99, hi = -1, seen = 0, ok = true;
    for (let i = 0; i < HAND && ok; i++) {
      if (!((m >> i) & 1)) continue;
      const r = rankOf(hand[i]);
      if ((seen >> r) & 1) ok = false;
      seen |= 1 << r;
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    if (ok && hi - lo <= 4) return m;
  }
  return 0;
}

/**
 * Simple hold table: made hand straight or better → hold all; trips / two pair / jacks-or-better pair → hold the pair(s);
 * 4-card flush draw → hold it; 4-card straight draw → hold it; low pair; otherwise hold the J–A cards.
 * Deuces Down: wild deuces are always held. Returns the hold mask (bit i = card i).
 * Not the EV-optimal hold (MACHINES §4.6 hintOptimal is approximated by this table).
 */
export function holdHint(hand: readonly number[], game: Game): number {
  const full = evaluate(hand, game);
  const ord = ORDER[full.cat];
  if (ord >= ORDER.straight) return 31;
  let wild = 0;
  if (game === 'deuces') hand.forEach((c, i) => { if (rankOf(c) === 0) wild |= 1 << i; });
  if (wild) {
    if (ord >= ORDER.trips) return 31;
    const fl = suitMask(hand, 4 - popCount(wild), wild);   // wild deuces complete a flush draw
    return wild | (fl || groupMask(hand, 2, wild));
  }
  if (ord >= ORDER.trips || full.cat === 'jacks') return groupMask(hand, 2);
  const fl = suitMask(hand, 4);
  if (fl) return fl;
  const st = straightDraw(hand);
  if (st) return st;
  const low = groupMask(hand, 2);
  if (low) return low;
  let high = 0;
  hand.forEach((c, i) => { if (rankOf(c) >= 9) high |= 1 << i; });
  return high;
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

/** One whole hand with the simple hold table (sims and headless play). Consumes the round stream. */
export function playHand(rng: Rng, game: Game, credits: number, v: Variant = {}, luck = 0): { credits: number; cat: Cat; rerolled: boolean } {
  const deck = newDeck(rng);
  const hand = deck.slice(0, HAND);
  const mask = holdHint(hand, game);
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
