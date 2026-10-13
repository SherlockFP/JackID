/**
 * Card helpers (base-machines WP). Contract: TECH_SPEC §3.7. Pure, allocation-light, no THREE, no DOM.
 *
 * `CardId` is the texgen atlas id: rank char `A 2-9 T J Q K` + suit char `S H D C` (e.g. `'TH'`, `'AS'`), plus
 * `'JK'` for a joker. Ranks are numeric 2..14 with the ace high (14) everywhere here; blackjack / baccarat / the
 * wheel straight handle ace-low themselves.
 *
 * Contents: deck / shoe building with the seeded RNG, a `Shoe` with cut-card penetration, 5-card poker
 * evaluation (joker = wild, 7-card best hand, comparable numeric `score`), blackjack totals, baccarat values
 * and the standard baccarat third-card tableau.
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const RANK_CHARS = '23456789TJQKA';             // index + 2 = rank
export const JOKER: CardId = 'JK'; // i18n-ok: atlas id

export const isJoker = (c: CardId): boolean => c === JOKER;
/** 2..14 (A = 14). A joker has rank 0. */
export function rankOf(c: CardId): number {
  return c === JOKER ? 0 : RANK_CHARS.indexOf(c[0]) + 2;
}
/** Jokers have no suit: this returns `'S'` for them — test {@link isJoker} first. */
export function suitOf(c: CardId): Suit {
  return c === JOKER ? 'S' : (c[1] as Suit);
}
export const isRed = (c: CardId): boolean => c !== JOKER && (c[1] === 'H' || c[1] === 'D');
export function cardId(rank: number, suit: Suit): CardId {
  return `${RANK_CHARS[rank - 2]}${suit}` as CardId;
}
/** Short human text for logs / debug ("A♠", "T♥", "JK"). Not for players (the atlas draws the cards). */
export function cardText(c: CardId): string {
  return c === JOKER ? 'JK' : `${c[0]}${{ S: '♠', H: '♥', D: '♦', C: '♣' }[c[1] as Suit]}`; // i18n-ok: debug text
}

// ── decks & shoes ───────────────────────────────────────────────────────────────────────────────
/** One ordered 52-card deck (+ `jokers`). */
export function newDeck(jokers = 0): CardId[] {
  const out: CardId[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) out.push(cardId(r, s));
  for (let i = 0; i < jokers; i++) out.push(JOKER);
  return out;
}

/** `decks` × 52 cards (+ `jokers` in total), shuffled with `rng` (Fisher–Yates). */
export function newShoe(decks: number, rng: Rng, jokers = 0): CardId[] {
  const cards: CardId[] = [];
  for (let d = 0; d < decks; d++) cards.push(...newDeck(0));
  for (let i = 0; i < jokers; i++) cards.push(JOKER);
  return rng.shuffle(cards);
}

/** Card shoe with a cut card: `needsShuffle` turns true once `penetration` (0..1) of the cards are dealt. */
export class Shoe {
  private cards: CardId[];
  private pos = 0;
  private cut: number;

  constructor(readonly decks: number, private readonly rng: Rng, private readonly o: { jokers?: number; penetration?: number } = {}) {
    this.cards = newShoe(decks, rng, o.jokers ?? 0);
    this.cut = Math.floor(this.cards.length * (o.penetration ?? 0.75));
  }
  get remaining(): number { return this.cards.length - this.pos; }
  get dealt(): number { return this.pos; }
  get needsShuffle(): boolean { return this.pos >= this.cut; }
  /** Next card; reshuffles transparently if the shoe is empty (safety net — respect `needsShuffle` between rounds). */
  draw(): CardId {
    if (this.pos >= this.cards.length) this.shuffle();
    return this.cards[this.pos++];
  }
  drawN(n: number): CardId[] {
    const out: CardId[] = [];
    for (let i = 0; i < n; i++) out.push(this.draw());
    return out;
  }
  /** Cards not yet dealt, top first (host-side counting charms; never send to clients). */
  peek(n = this.remaining): readonly CardId[] { return this.cards.slice(this.pos, this.pos + n); }
  shuffle(): void {
    this.cards = newShoe(this.decks, this.rng, this.o.jokers ?? 0);
    this.pos = 0;
  }
  /** Host save form (never goes to clients). */
  serialize(): { c: string; p: number } { return { c: this.cards.join(','), p: this.pos }; }
  restore(s: { c: string; p: number }): void { this.cards = s.c.split(',') as CardId[]; this.pos = s.p; }
}

// ── poker ───────────────────────────────────────────────────────────────────────────────────────
export type PokerCat = 'high' | 'pair' | 'jacks' | 'twoPair' | 'trips' | 'straight' | 'flush' | 'fullHouse'
  | 'quads' | 'straightFlush' | 'royal' | 'fiveKind';
/** Ascending strength. `'jacks'` (pair of J+) ranks with `'pair'` in {@link PokerHand.score}. */
export const POKER_CATS: readonly PokerCat[] = [
  'high', 'pair', 'jacks', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush', 'royal', 'fiveKind',
];
export interface PokerHand { cat: PokerCat; score: number }

const B = 15;
const B5 = B * B * B * B * B;
/** Category weight in `score`: `jacks` shares the `pair` slot, everything above shifts down by one. */
function catWeight(cat: PokerCat): number {
  const i = POKER_CATS.indexOf(cat);
  return i > 2 ? i - 1 : i === 2 ? 1 : i;
}

interface Eval5 { cat: PokerCat; tb: number[] }
function eval5(ranks: number[], suits: Suit[]): Eval5 {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const flush = suits.every((s) => s === suits[0]);
  const uniq = groups.map((g) => g[0]).sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5;          // wheel
  }
  const tbGroups = groups.map((g) => g[0]);
  if (shape === '5') return { cat: 'fiveKind', tb: tbGroups };
  if (straightHigh && flush) return { cat: straightHigh === 14 ? 'royal' : 'straightFlush', tb: [straightHigh] };
  if (shape === '41') return { cat: 'quads', tb: tbGroups };
  if (shape === '32') return { cat: 'fullHouse', tb: tbGroups };
  if (flush) return { cat: 'flush', tb: uniq };
  if (straightHigh) return { cat: 'straight', tb: [straightHigh] };
  if (shape === '311') return { cat: 'trips', tb: tbGroups };
  if (shape === '221') return { cat: 'twoPair', tb: tbGroups };
  if (shape === '2111') return { cat: 'pair', tb: tbGroups };
  return { cat: 'high', tb: uniq };
}

function scoreOf(e: Eval5, jacks: boolean): PokerHand {
  let cat = e.cat;
  if (cat === 'pair' && jacks && e.tb[0] >= 11) cat = 'jacks';
  let s = catWeight(cat) * B5;
  for (let i = 0; i < 5; i++) s += (e.tb[i] ?? 0) * Math.pow(B, 4 - i);
  return { cat, score: s };
}

const ALL_CARDS: readonly CardId[] = newDeck(0);

/** Best result over all substitutions of the jokers in `cards` (5 cards). */
function evalWild(cards: CardId[], jacks: boolean, from = 0): PokerHand {
  const j = cards.indexOf(JOKER, from);
  if (j < 0) return scoreOf(eval5(cards.map(rankOf), cards.map(suitOf)), jacks);
  let best: PokerHand | null = null;
  const work = cards.slice();
  for (const sub of ALL_CARDS) {
    work[j] = sub;
    const h = evalWild(work, jacks, j + 1);
    if (!best || h.score > best.score) best = h;
  }
  return best!;
}

/**
 * Evaluate exactly 5 cards. `score` is a comparable number (higher wins; kickers included, wheel = 5-high).
 * A joker is wild (may create `'fiveKind'`). Pass `{ jacks: true }` for Jacks-or-Better labelling: a pair of J+
 * returns `cat: 'jacks'` (its `score` is unchanged, so it still compares correctly against other pairs).
 */
export function evalPoker5(cards: CardId[], o: { jacks?: boolean } = {}): PokerHand {
  if (cards.length !== 5) throw new Error(`evalPoker5 needs 5 cards, got ${cards.length}`);
  return evalWild(cards, !!o.jacks);
}

/** Best 5-card hand out of 5–7 cards (Hold'em / stud). `best` are the five cards used. */
export function bestPoker(cards: CardId[], o: { jacks?: boolean } = {}): PokerHand & { best: CardId[] } {
  const n = cards.length;
  if (n < 5) throw new Error(`bestPoker needs 5-7 cards, got ${n}`);
  if (n === 5) return { ...evalPoker5(cards, o), best: cards.slice() };
  let top: (PokerHand & { best: CardId[] }) | null = null;
  const pick: number[] = [0, 1, 2, 3, 4];
  const hand: CardId[] = new Array<CardId>(5);
  for (;;) {
    for (let i = 0; i < 5; i++) hand[i] = cards[pick[i]];
    const h = evalWild(hand, !!o.jacks);
    if (!top || h.score > top.score) top = { ...h, best: hand.slice() };
    let i = 4;                                   // next combination in lexicographic order
    while (i >= 0 && pick[i] === n - 5 + i) i--;
    if (i < 0) break;
    pick[i]++;
    for (let k = i + 1; k < 5; k++) pick[k] = pick[k - 1] + 1;
  }
  return top!;
}

/** `> 0` when `a` beats `b`, `< 0` when `b` wins, `0` for a split pot. */
export const comparePoker = (a: PokerHand, b: PokerHand): number => a.score - b.score;

// ── blackjack ───────────────────────────────────────────────────────────────────────────────────
/** Hard value of one card (ace = 1, faces = 10, joker = 0). */
export function bjCardValue(c: CardId): number {
  const r = rankOf(c);
  return r === 14 ? 1 : Math.min(r, 10);
}
export interface BjTotal { total: number; soft: boolean; bust: boolean; blackjack: boolean }
/** Best blackjack total: one ace counts 11 when that does not bust. `blackjack` = natural (two cards, 21). */
export function bjTotal(cards: CardId[]): BjTotal {
  let total = 0, aces = 0;
  for (const c of cards) { total += bjCardValue(c); if (rankOf(c) === 14) aces++; }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) { total += 10; soft = true; }
  return { total, soft, bust: total > 21, blackjack: cards.length === 2 && total === 21 };
}

// ── baccarat ────────────────────────────────────────────────────────────────────────────────────
/** Baccarat point value of one card: A = 1, 2-9 face, T/J/Q/K = 0. */
export function baccaratCardValue(c: CardId): number {
  const r = rankOf(c);
  return r === 14 ? 1 : r >= 10 ? 0 : r;
}
/** Hand value 0..9 (sum mod 10). */
export function baccaratValue(cards: CardId[]): number {
  let v = 0;
  for (const c of cards) v += baccaratCardValue(c);
  return v % 10;
}
/** Punto Banco: does the player draw a third card? (`total` = value of the first two cards; naturals stop everything.) */
export function baccaratPlayerDraws(playerTotal: number, bankerTotal: number): boolean {
  if (playerTotal >= 8 || bankerTotal >= 8) return false;
  return playerTotal <= 5;
}
/**
 * Punto Banco banker tableau. `playerThird` = point value of the player's third card, or `null` when the player
 * stood (then the banker draws on 0-5). Call only when neither side has a natural.
 */
export function baccaratBankerDraws(bankerTotal: number, playerThird: number | null): boolean {
  if (playerThird === null) return bankerTotal <= 5;
  switch (bankerTotal) {
    case 0: case 1: case 2: return true;
    case 3: return playerThird !== 8;
    case 4: return playerThird >= 2 && playerThird <= 7;
    case 5: return playerThird >= 4 && playerThird <= 7;
    case 6: return playerThird === 6 || playerThird === 7;
    default: return false;
  }
}
