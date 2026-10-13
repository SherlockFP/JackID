/**
 * Pişti — pure rules and bot AI (no three, kit or DOM; DECISIONS C20 — RTP sims run this file in Node).
 *
 * Players are indexed 0..n-1 (n = 2..4, the host maps them to seats). Cards are `CardId` strings from the 52-card
 * atlas. Standard Turkish Pişti:
 *  - Deal 4 to each player and 4 face-up to the table; the rest of the 52 is dealt 4 per player per round.
 *  - Play one card. It captures the whole table when its RANK matches the top table card, or when it is a Jack
 *    (a Jack takes anything). A capture that empties a one-card table is PİŞTİ (+10; a Jack on top = +20).
 *    A pişti on the very last card of the game does not count.
 *  - When all hands and the deck are empty, the last capturer takes what is left on the table.
 *  - Scoring: each A and J = 1, 2♣ = 2, 10♦ = 3, every pişti as above, and 3 for the player with the most cards
 *    (a tie gives nobody the bonus).
 */
import type { CardId } from '@/core/texgen/types';
import type { Rng } from '@/core/rng';

export const PLAYER_MIN = 2, PLAYER_MAX = 4;
export const HAND = 4;
export type BotLevel = 1 | 2 | 3;

export interface Game {
  n: number;                  // players in this game (2..4)
  hands: CardId[][];          // per player, order = the order shown to the player (card index = play index)
  piles: CardId[][];          // captured cards per player
  pistis: number[];           // pişti count per player
  pistiPts: number[];         // pişti points per player (10 or 20 each)
  table: CardId[];            // face-up table cards, top = last
  deck: CardId[];             // undealt cards, top = last
  turn: number;               // player to move
  lastCap: number;            // last capturer (−1 = none yet)
}

export interface PlayResult {
  card: CardId;
  captured: boolean;
  pisti: 0 | 10 | 20;         // points of a pişti made by this play (0 = none)
  took: number;               // cards moved into the capturer's pile by this play (0 when no capture)
  jack: boolean;              // the played card was a Jack
  ended: boolean;             // the game finished with this play (table swept to the last capturer)
}

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

/** Ordered 52-card deck. */
export function fullDeck(): CardId[] {
  const out: CardId[] = [];
  for (const s of SUITS) for (const r of RANKS) out.push(`${r}${s}` as CardId);
  return out;
}

/** Fisher–Yates with the seeded stream (never Math.random). */
export function shuffle(cards: CardId[], rng: Rng): CardId[] {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const rankOf = (c: CardId): string => c[0];
export const isJack = (c: CardId): boolean => c[0] === 'J';

/** Card points in the final count (aces and jacks 1, 2♣ 2, 10♦ 3, others 0). */
export function cardPoints(c: CardId): number {
  if (c === 'AS' || c === 'AH' || c === 'AD' || c === 'AC') return 1;
  if (isJack(c)) return 1;
  if (c === '2C') return 2;
  if (c === 'TD') return 3;
  return 0;
}

/** Start a game: shuffle, 4 table cards up, 4 per player. The deck holds the rest. */
export function newGame(n: number, rng: Rng): Game {
  if (n < PLAYER_MIN || n > PLAYER_MAX) throw new Error(`pisti: ${n} players`);
  const deck = shuffle(fullDeck(), rng);
  const g: Game = {
    n, hands: Array.from({ length: n }, (): CardId[] => []), piles: Array.from({ length: n }, (): CardId[] => []),
    pistis: new Array<number>(n).fill(0), pistiPts: new Array<number>(n).fill(0),
    table: [], deck, turn: 0, lastCap: -1,
  };
  for (let k = 0; k < HAND; k++) g.table.push(g.deck.pop()!);
  dealRound(g);
  return g;
}

/** Deal 4 to each player (as far as the deck goes). */
export function dealRound(g: Game): void {
  for (let k = 0; k < HAND; k++) for (let p = 0; p < g.n; p++) if (g.deck.length) g.hands[p].push(g.deck.pop()!);
}

export const handsEmpty = (g: Game): boolean => g.hands.every((h) => h.length === 0);

/** Would playing `c` onto this table capture it? */
export function wouldCapture(table: readonly CardId[], c: CardId): boolean {
  if (table.length === 0) return false;
  return isJack(c) || rankOf(table[table.length - 1]) === rankOf(c);
}

/**
 * Play hand card `idx` of player `p` (the caller has validated that `p` is to move).
 * Returns what happened (the host publishes it) and advances the turn. A new deal is NOT made here; the caller
 * checks `handsEmpty` and `dealRound` (keeps the presentation order explicit).
 */
export function play(g: Game, p: number, idx: number): PlayResult {
  const c = g.hands[p].splice(idx, 1)[0];
  const lastOfGame = g.deck.length === 0 && handsEmpty(g);
  const captured = wouldCapture(g.table, c);
  let pisti: 0 | 10 | 20 = 0;
  let took = 0;
  if (captured) {
    const single = g.table.length === 1;
    const topJack = isJack(g.table[g.table.length - 1]);
    if (single && !lastOfGame) pisti = topJack ? 20 : 10;   // a Jack on a lone Jack is the 20; any other match is 10
    if (pisti) { g.pistis[p]++; g.pistiPts[p] += pisti; }
    took = g.table.length + 1;
    g.piles[p].push(...g.table, c);
    g.table = [];
    g.lastCap = p;
  } else {
    g.table.push(c);
  }
  const jack = isJack(c);
  let ended = false;
  if (lastOfGame && handsEmpty(g)) {
    // last card of the game: the last capturer takes the leftovers (or the player who played last keeps them)
    const who = g.lastCap >= 0 ? g.lastCap : p;
    if (g.table.length) { g.piles[who].push(...g.table); g.table = []; }
    ended = true;
  }
  g.turn = (p + 1) % g.n;
  return { card: c, captured, pisti, took: captured ? took : 0, jack, ended };
}

export interface Score { points: number[]; cards: number[]; base: number[]; pistiPts: number[]; majority: number }

/** Final scores. `majority` = seat index with the most cards, −1 on a tie. */
export function score(g: Game): Score {
  const cards = g.piles.map((p) => p.length);
  const most = Math.max(...cards);
  const top = cards.filter((c) => c === most).length === 1 ? cards.indexOf(most) : -1;
  const base = g.piles.map((pile) => pile.reduce((s, c) => s + cardPoints(c), 0));
  const pistiPts = [...g.pistiPts];
  const points = base.map((b, i) => b + pistiPts[i] + (i === top ? 3 : 0));
  return { points, cards, base, pistiPts, majority: top };
}

/** Winners of the pot: every seat with the top points (ties split by the caller). */
export function winners(points: readonly number[]): number[] {
  const best = Math.max(...points);
  return points.flatMap((p, i) => (p === best ? [i] : []));
}

// ── bot AI ──────────────────────────────────────────────────────────────────────────────────────
/** Index of the card a bot plays. Level 1 random, level 2 greedy captures, level 3 captures + risk. */
export function botChoose(g: Game, p: number, level: BotLevel, rng: Rng): number {
  const hand = g.hands[p];
  if (hand.length === 1) return 0;
  if (level === 1) return rng.int(0, hand.length - 1);
  let best = 0, bestScore = -Infinity;
  hand.forEach((c, i) => {
    let s = 0;
    if (wouldCapture(g.table, c)) {
      s += 10 + 2 * cardPoints(c) + (isJack(c) ? 0 : 1) + g.table.reduce((a, t) => a + cardPoints(t), 0);
      if (g.table.length === 1) s += 12;                  // pişti
    } else {
      if (level === 3) {
        // leaving `c` on the table exposes it to the next player: penalise ranks still around
        const left = unseenRank(g, p, rankOf(c));
        s -= 3 * left;
        s -= cardPoints(c) * 2;                           // do not feed points to the table
      } else {
        s -= cardPoints(c);
      }
    }
    if (level >= 2) s += rng.int(0, 1) * 0.5;             // tie noise, seeded
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}

/** Cards of `rank` not visible to player `p` (deck + other hands). A rough threat count for level 3. */
function unseenRank(g: Game, p: number, rank: string): number {
  let n = 0;
  for (const c of g.deck) if (rankOf(c) === rank) n++;
  for (let q = 0; q < g.n; q++) if (q !== p) for (const c of g.hands[q]) if (rankOf(c) === rank) n++;
  return n;
}
