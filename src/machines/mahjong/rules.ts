/**
 * Mahjong: Little Wall (`mahjong`) — pure rules (WAVE24_PLAN §1). No three, no DOM, no kit. Shared by the live machine
 * (`index.ts`) and the headless play contract (`playHeadless`: staff auto-play, balance sims), so the simulated RTP IS
 * the live RTP.
 *
 * Tiles: 120 = three suits (COINS, STICKS, MARKS) × 1..9 × 4 copies + three dragons (RED, GREEN, WHITE) × 4 copies.
 * A tile is a number 0..29: suit tiles 0..26 (suit = id / 9, rank = id % 9 + 1), dragons 27..29.
 * Round: pay the stake, the whole wall is shuffled from the seed (always 119 draws), 7 face-up tiles and 6 turns.
 * Each turn the House flips an UPCARD: the player TAKEs it, or DRAWs the next wall tile (the upcard dies); then the
 * player DISCARDs one tile. Any 8-tile hand of 2 melds + a pair is a MAHJONG and wins on the spot. A meld is a
 * triplet or a run of 3 in one suit (no wraparound); dragons only form triplets.
 * Pays: turn 1-3 ×12, 4 ×8, 5 ×5, 6 ×3 (later turns of a charm-extended round ×2), bonuses stack, capped at ×60.
 * After the last turn a hand one tile from winning (Near Hand) pays ×0.4.
 *
 * The wall, the hand and every decision are plain data (`Round`), so a seed replays identically: the only randomness
 * is the shuffle and the final whole-coin rounding draw.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const KINDS = 30;               // distinct tiles
export const COPIES = 4;
export const WALL_SIZE = KINDS * COPIES;   // 120
export const SUIT_KINDS = 27;
export const DRAGON_BASE = 27;
export const HAND = 7;
export const BASE_TURNS = 6;
export const MAX_EXTRA_TURNS = 3;
export const MIN_BET = 5, MAX_BET = 100;
export const BET_STEPS = [5, 10, 25, 50, 100];
export const MAX_MULT = 60;            // hard ceiling on a payout multiple (= def.maxPayoutMult)
export const NEAR_MULT = 0.4;
/** Pay multiple by the turn the hand completes on (index 0 = turn 1). Turns past the table pay the last entry. */
export const TURN_PAY: readonly number[] = [12, 12, 12, 8, 5, 3];
export const LATE_PAY = 2;             // turns 7+ (a charm gave extra turns)
export const BONUS_PURE = 2.5, BONUS_DRAGON = 1.5, BONUS_TRIPLETS = 1.5, BONUS_RUNS = 1.3;
/** RTP of the greedy policy below: 200k-round measurement 0.935 ± 0.006 (win rate 9.2 %, Near Hand 59 %). Informational. */
export const BASE_RTP = 0.935;

export type BonusId = 'pure' | 'dragon' | 'triplets' | 'runs';
export const BONUS_MULT: Record<BonusId, number> = { pure: BONUS_PURE, dragon: BONUS_DRAGON, triplets: BONUS_TRIPLETS, runs: BONUS_RUNS };

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_TURNS = 'm.mahjong.turnsAdd' as ModHook;     // extra turns per round, int (cap +3)
export const HOOK_PEEK = 'm.mahjong.peek' as ModHook;          // ≥ 1: the draw tile is shown before you choose
export const HOOK_NEAR = 'm.mahjong.nearPay' as ModHook;       // float added to the Near Hand multiple (0.4)

// ── tiles ───────────────────────────────────────────────────────────────────────────────────────────
export type Tile = number;
export type SuitId = 0 | 1 | 2 | 3;    // 0 COINS, 1 STICKS, 2 MARKS, 3 DRAGON
export const suitOf = (t: Tile): SuitId => (t >= DRAGON_BASE ? 3 : (Math.floor(t / 9) as SuitId));
/** 1..9 for a suit tile, 1..3 (RED, GREEN, WHITE) for a dragon. */
export const rankOf = (t: Tile): number => (t >= DRAGON_BASE ? t - DRAGON_BASE + 1 : (t % 9) + 1);
export const isDragon = (t: Tile): boolean => t >= DRAGON_BASE;
export const makeTile = (suit: number, rank: number): Tile => (suit === 3 ? DRAGON_BASE + rank - 1 : suit * 9 + rank - 1);

export const emptyCounts = (): number[] => new Array<number>(KINDS).fill(0);
export function countsOf(tiles: readonly Tile[]): number[] {
  const c = emptyCounts();
  for (const t of tiles) c[t]++;
  return c;
}

/** The whole wall, shuffled from `rng`. Always exactly 119 draws, whatever happens later. */
export function shuffleWall(rng: Rng): Tile[] {
  const wall: Tile[] = [];
  for (let c = 0; c < COPIES; c++) for (let t = 0; t < KINDS; t++) wall.push(t);
  return rng.shuffle(wall);
}

// ── melds, win analysis ───────────────────────────────────────────────────────────────────────────────
/** A meld: the lowest tile and its kind. A run is t, t+1, t+2 (same suit, rank ≤ 7); a triplet is t ×3. */
export interface Meld { t: Tile; run: boolean }
const canRun = (t: Tile): boolean => t < SUIT_KINDS && t % 9 <= 6;

export interface Win {
  /** Chosen decomposition (the one with the best bonuses). */
  melds: [Meld, Meld];
  pair: Tile;
  bonuses: BonusId[];
  /** Product of the bonus multiples (1 when none). */
  bonusMult: number;
}

const bonusProduct = (b: readonly BonusId[]): number => b.reduce((m, id) => m * BONUS_MULT[id], 1);

/** Every way to split `c` (exactly 6 tiles) into two melds, lowest tile first. */
function twoMelds(c: number[], out: Array<[Meld, Meld]>): void {
  const first = (): number => { for (let t = 0; t < KINDS; t++) if (c[t] > 0) return t; return -1; };
  const t = first();
  if (t < 0) return;
  const tryTail = (m1: Meld): void => {
    const u = first();
    if (u < 0) return;
    if (c[u] >= 3) { c[u] -= 3; if (first() < 0) out.push([m1, { t: u, run: false }]); c[u] += 3; }
    if (canRun(u) && c[u + 1] > 0 && c[u + 2] > 0) {
      c[u]--; c[u + 1]--; c[u + 2]--;
      if (first() < 0) out.push([m1, { t: u, run: true }]);
      c[u]++; c[u + 1]++; c[u + 2]++;
    }
  };
  if (c[t] >= 3) { c[t] -= 3; tryTail({ t, run: false }); c[t] += 3; }
  if (canRun(t) && c[t + 1] > 0 && c[t + 2] > 0) {
    c[t]--; c[t + 1]--; c[t + 2]--;
    tryTail({ t, run: true });
    c[t]++; c[t + 1]++; c[t + 2]++;
  }
}

/** Best winning reading of an 8-tile hand (counts), or null when it is not a Mahjong. */
export function analyze(c: number[]): Win | null {
  let n = 0;
  for (let t = 0; t < KINDS; t++) n += c[t];
  if (n !== HAND + 1) return null;
  let best: Win | null = null;
  const pure = (() => {
    let s = -1;
    for (let t = 0; t < KINDS; t++) {
      if (c[t] === 0) continue;
      const k = suitOf(t);
      if (k === 3) return false;
      if (s >= 0 && s !== k) return false;
      s = k;
    }
    return true;
  })();
  for (let p = 0; p < KINDS; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const found: Array<[Meld, Meld]> = [];
    twoMelds(c, found);
    c[p] += 2;
    for (const ms of found) {
      const bonuses: BonusId[] = [];
      if (pure) bonuses.push('pure');
      if (ms.some((m) => !m.run && isDragon(m.t))) bonuses.push('dragon');
      if (ms.every((m) => !m.run)) bonuses.push('triplets');
      if (ms.every((m) => m.run)) bonuses.push('runs');
      const w: Win = { melds: ms, pair: p, bonuses, bonusMult: bonusProduct(bonuses) };
      if (!best || w.bonusMult > best.bonusMult) best = w;
    }
  }
  return best;
}

export const isMahjong = (hand8: readonly Tile[]): boolean => analyze(countsOf(hand8)) !== null;

/** Tile kinds that would complete a 7-tile hand (the waits). Empty = not one tile from winning. */
export function waitsOf(hand7: readonly Tile[]): Tile[] {
  const c = countsOf(hand7);
  const out: Tile[] = [];
  for (let t = 0; t < KINDS; t++) {
    if (c[t] >= COPIES) continue;
    c[t]++;
    if (analyze(c)) out.push(t);
    c[t]--;
  }
  return out;
}


// ── hand distance (greedy heuristic) ─────────────────────────────────────────────────────────────────
/**
 * Overlap of a hand with the best target (2 melds + a pair): how many of the 8 target tiles the hand already holds
 * (8 − overlap = tiles still missing). Each suit (and the dragons) is solved once per pattern and memoised, so a
 * whole-hand evaluation is four lookups and a few additions.
 */
const memo = new Map<number, Int8Array>();     // key → best overlap by [melds 0..2][pair 0|1], flat k*2+e

function groupTable(c: ArrayLike<number>, off: number, size: number, runs: boolean): Int8Array {
  let key = 0;
  for (let i = size - 1; i >= 0; i--) key = key * 5 + Math.min(4, c[off + i]);
  key = key * 2 + (runs ? 1 : 0);
  const hit = memo.get(key);
  if (hit) return hit;
  const melds: number[][] = [];
  for (let i = 0; i < size; i++) melds.push([i, i, i]);
  if (runs) for (let i = 0; i + 2 < size; i++) melds.push([i, i + 1, i + 2]);
  const tab = new Int8Array(6).fill(-1);
  const T = new Array<number>(size).fill(0);          // the target tiles chosen so far
  const put = (k: number, e: number): void => {
    let s = 0;
    for (let i = 0; i < size; i++) s += Math.min(c[off + i], T[i]);
    if (s > tab[k * 2 + e]) tab[k * 2 + e] = s;
  };
  const withPair = (k: number): void => {
    put(k, 0);
    for (let p = 0; p < size; p++) {
      T[p] += 2;
      if (T[p] <= COPIES) put(k, 1);
      T[p] -= 2;
    }
  };
  withPair(0);
  for (let a = 0; a < melds.length; a++) {
    for (const i of melds[a]) T[i]++;
    withPair(1);
    for (let b = a; b < melds.length; b++) {
      for (const i of melds[b]) T[i]++;
      if (T.every((v) => v <= COPIES)) withPair(2);
      for (const i of melds[b]) T[i]--;
    }
    for (const i of melds[a]) T[i]--;
  }
  // "at most k melds, at most the pair": lets groups that take no part contribute nothing
  for (let e = 0; e < 2; e++) for (let k = 1; k < 3; k++) if (tab[k * 2 + e] < tab[(k - 1) * 2 + e]) tab[k * 2 + e] = tab[(k - 1) * 2 + e];
  for (let k = 0; k < 3; k++) if (tab[k * 2 + 1] < tab[k * 2]) tab[k * 2 + 1] = tab[k * 2];
  memo.set(key, tab);
  return tab;
}

const tabs: Int8Array[] = [];
/** Best overlap (0..8) of the hand counts with 2 melds + a pair. 8 on an 8-tile hand = a Mahjong. */
export function overlap(c: ArrayLike<number>): number {
  tabs[0] = groupTable(c, 0, 9, true);
  tabs[1] = groupTable(c, 9, 9, true);
  tabs[2] = groupTable(c, 18, 9, true);
  tabs[3] = groupTable(c, DRAGON_BASE, 3, false);
  let best = 0;
  for (let p = 0; p < 4; p++) {                       // the group that holds the pair
    for (let i = 0; i < 4; i++) {
      // both melds in group i
      let s = 0;
      for (let j = 0; j < 4; j++) s += tabs[j][(j === i ? 4 : 0) + (j === p ? 1 : 0)];
      if (s > best) best = s;
      // one meld in i, one in a later group j
      for (let j = i + 1; j < 4; j++) {
        s = 0;
        for (let g = 0; g < 4; g++) s += tabs[g][(g === i || g === j ? 2 : 0) + (g === p ? 1 : 0)];
        if (s > best) best = s;
      }
    }
  }
  return best;
}

/** Distinct kinds held in a count array. */
const kindsIn = (c: number[]): Tile[] => { const out: Tile[] = []; for (let t = 0; t < KINDS; t++) if (c[t] > 0) out.push(t); return out; };

/** Tiles of each kind the player has not seen (hand, discards and dead upcards removed). */
export function unseenCounts(r: Round): number[] {
  const u = new Array<number>(KINDS).fill(COPIES);
  for (const t of r.hand) u[t]--;
  for (const t of r.discards) u[t]--;
  for (const t of r.dead) u[t]--;
  return u;
}

/** Tile kinds still unseen that would raise the overlap of the 7-tile counts `c` (how many kinds help, not how many copies). */
function outs(c: number[], unseen: number[]): number {
  const base = overlap(c);
  let n = 0;
  for (let t = 0; t < KINDS; t++) {
    if (unseen[t] <= 0 || c[t] >= COPIES) continue;
    c[t]++;
    if (overlap(c) > base) n++;
    c[t]--;
  }
  return n;
}

interface Pick8 { tile: Tile; ov: number; outs: number }

/** Best discard of 8 held tiles (counts, restored on return): the most overlap kept, then the most outs, then the highest tile. */
function bestOf8(c: number[], unseen: number[]): Pick8 {
  const kinds = kindsIn(c);
  const ovs: number[] = [];
  let top = -1;
  for (const t of kinds) {
    c[t]--;
    const v = overlap(c);
    c[t]++;
    ovs.push(v);
    if (v > top) top = v;
  }
  let best: Pick8 = { tile: -1, ov: top, outs: -1 };
  kinds.forEach((t, i) => {
    if (ovs[i] !== top) return;
    c[t]--;
    const o = outs(c, unseen);
    c[t]++;
    // exact ties: the higher tile goes first (dragons and nines before ones), so the choice is deterministic
    if (o > best.outs || (o === best.outs && t > best.tile)) best = { tile: t, ov: top, outs: o };
  });
  return best;
}

/** The discard the greedy policy would make from an 8-tile hand (also the hint ring's suggestion). */
export function bestDiscard(hand8: readonly Tile[], unseen: number[]): Tile {
  return bestOf8(countsOf(hand8), unseen).tile;
}

/** Hand value after adding tile `t` and discarding the best tile: overlap first, outs second. */
const valueOf = (e: { ov: number; outs: number }): number => e.ov * 1000 + e.outs;
function valueAfter(c7: number[], t: Tile, unseen: number[], ov0: number, v0: number): number {
  if (c7[t] >= COPIES) return v0;
  c7[t]++;
  let v = v0;
  if (overlap(c7) > ov0) v = Math.max(v0, valueOf(bestOf8(c7, unseen)));   // the tile can lift the hand: price it
  c7[t]--;
  return v;
}

export type Policy = 'greedy' | 'draw' | 'take';

/**
 * Take or draw? `draw` and `take` are the fixed straw-man bots of the RTP bands. `greedy` prices the upcard (hand value
 * after the best discard) against the average value of the tile it would draw, over what is still unseen, and takes
 * the upcard only when it beats that. With a wall-peek the draw tile is known: a draw that lifts the hand further than the
 * upcard wins outright. (One tile lifts a hand by at most one level, so the peek rarely changes the greedy choice: it is
 * information for the human; the bot gains nothing and, tested, never loses.)
 */
export function chooseTake(r: Round, policy: Policy, peeked: boolean): boolean {
  if (policy === 'draw') return false;
  if (policy === 'take') return true;
  const un = unseenCounts(r);
  const up = r.wall[r.pos];
  un[up] = Math.max(0, un[up] - 1);
  const c7 = countsOf(r.hand);
  const ov0 = overlap(c7);
  const v0 = ov0 * 1000 + outs(c7, un);
  const vUp = valueAfter(c7, up, un, ov0, v0);
  // with a wall-peek: a known draw tile that lifts the hand further than the upcard wins the choice outright
  if (peeked && Math.floor(valueAfter(c7, r.wall[r.pos + 1], un, ov0, v0) / 1000) > Math.floor(vUp / 1000)) return false;
  let tot = 0, w = 0;
  for (let t = 0; t < KINDS; t++) {
    if (un[t] <= 0) continue;
    tot += un[t] * valueAfter(c7, t, un, ov0, v0);
    w += un[t];
  }
  return vUp * w > tot;
}

/** The suggested move for the hint ring: whether to take, from the greedy policy. */
export const suggestTake = (r: Round, peeked: boolean): boolean => chooseTake(r, 'greedy', peeked);

// ── the round ─────────────────────────────────────────────────────────────────────────────────────────
export type Phase = 'pick' | 'disc' | 'done';

/** One round, plain JSON. `hand` is kept sorted; it has 7 tiles, or 8 while a discard is owed. */
export interface Round {
  wall: Tile[];
  hand: Tile[];
  /** Wall index of the current upcard. */
  pos: number;
  /** Current turn, 1-based. */
  turn: number;
  turns: number;
  phase: Phase;
  /** Tiles the player discarded, and upcards that died (every tile the player has seen and no longer holds). */
  discards: Tile[];
  dead: Tile[];
}

export const upOf = (r: Round): Tile => (r.phase === 'pick' ? r.wall[r.pos] : -1);
/** The tile a DRAW would give right now (what the wall-peek shows). */
export const drawTile = (r: Round): Tile => r.wall[r.pos + 1];

const byTile = (a: Tile, b: Tile): number => a - b;

export function deal(rng: Rng, turns: number = BASE_TURNS): Round {
  const wall = shuffleWall(rng);
  return {
    wall, hand: wall.slice(0, HAND).sort(byTile), pos: HAND, turn: 1, turns: Math.min(turns, BASE_TURNS + MAX_EXTRA_TURNS),
    phase: 'pick', discards: [], dead: [],
  };
}

export interface PickResult { got: Tile; win: Win | null }

/** TAKE the upcard (`take`) or DRAW the next wall tile (the upcard dies). Leaves 8 tiles in the hand. */
export function pick(r: Round, take: boolean): PickResult {
  if (r.phase !== 'pick') throw new Error('mahjong: not a pick phase');
  const up = r.wall[r.pos];
  let got: Tile;
  if (take) { got = up; r.pos += 1; }
  else { r.dead.push(up); got = r.wall[r.pos + 1]; r.pos += 2; }
  r.hand.push(got);
  r.hand.sort(byTile);
  const win = analyze(countsOf(r.hand));
  r.phase = win ? 'done' : 'disc';
  return { got, win };
}

export interface DiscardResult { done: boolean; waits: Tile[] }

/** DISCARD `tile` from the 8 held. After the last turn the round ends and the waits of the 7 left are reported. */
export function discard(r: Round, tile: Tile): DiscardResult {
  if (r.phase !== 'disc') throw new Error('mahjong: not a discard phase');
  const i = r.hand.indexOf(tile);
  if (i < 0) throw new Error('mahjong: discarding a tile not held');
  r.hand.splice(i, 1);
  r.discards.push(tile);
  if (r.turn >= r.turns) { r.phase = 'done'; return { done: true, waits: waitsOf(r.hand) }; }
  r.turn += 1;
  r.phase = 'pick';
  return { done: false, waits: [] };
}

/** Pay multiple of a win on `turn` with the reading's bonuses, capped. */
export function winMult(turn: number, w: Win): number {
  const base = turn <= TURN_PAY.length ? TURN_PAY[turn - 1] : LATE_PAY;
  return Math.min(MAX_MULT, base * w.bonusMult);
}
export const nearMult = (add: number): number => Math.min(MAX_MULT, Math.max(0, NEAR_MULT + add));

/** Unbiased whole-coin payout of `stake × mult` (the wallet is integer). Always consumes one draw. */
export function payoutOf(rng: Rng, stake: number, mult: number): number {
  const v = stake * mult;
  const base = Math.floor(v);
  return base + (rng.next() < v - base ? 1 : 0);
}

export interface PlayResult {
  /** Turn the hand completed on (0 = not won). */
  winTurn: number;
  win: Win | null;
  near: boolean;
  /** Pay multiple (before whole-coin rounding). */
  mult: number;
}

/** Settle a finished round to its pay multiple. */
export function resolve(r: Round, win: Win | null, nearAdd = 0): PlayResult {
  if (win) return { winTurn: r.turn, win, near: false, mult: winMult(r.turn, win) };
  const near = r.phase === 'done' && waitsOf(r.hand).length > 0;
  return { winTurn: 0, win: null, near, mult: near ? nearMult(nearAdd) : 0 };
}

/** Play out the rest of a round with a policy. Used by the headless play, the bench Sim and the stand-up auto-finish. */
export function autoPlay(r: Round, policy: Policy, o: { peek?: number; nearAdd?: number } = {}): PlayResult {
  const peeked = (o.peek ?? 0) >= 1;
  let win: Win | null = null;
  while (r.phase !== 'done') {
    if (r.phase === 'pick') {
      const res = pick(r, chooseTake(r, policy, peeked));
      if (res.win) { win = res.win; break; }
    }
    if (r.phase === 'disc') discard(r, bestDiscard(r.hand, unseenCounts(r)));
  }
  return resolve(r, win, o.nearAdd ?? 0);
}

/** Headless single round: the same rules as the live game, the greedy policy. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const turns = BASE_TURNS + Math.max(0, Math.min(MAX_EXTRA_TURNS, Math.floor(h.mod(HOOK_TURNS, 0))));
  const r = deal(rng, turns);
  const res = autoPlay(r, 'greedy', { peek: h.mod(HOOK_PEEK, 0), nearAdd: h.mod(HOOK_NEAR, 0) });
  const tags: string[] = [];
  if (res.win) tags.push('mahjong', `turn:${res.winTurn}`, ...res.win.bonuses);
  else if (res.near) tags.push('near');
  return { gross: payoutOf(rng, bet, res.mult), tags };
};
