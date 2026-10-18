/**
 * ROCK, PAPER, PROMISE (TAŞ, KAĞIT, SÖZ): the pure rules (docs/STORY_BIBLE.md section 5a). No DOM, no clock, no Math.random:
 * every choice an AI makes comes from a seeded rng, so a match replays exactly.
 *
 * Rules: rock, paper, scissors. First to `goal` points (3 by default). Callers take turns. Before each throw the caller
 * names a hand out loud: a promise. The caller then throws, the answerer throws, and the hands are compared.
 *   - A win by a caller who kept the word scores 2. Any other win scores 1. A tie scores nothing.
 *   - A caller who throws something else than the promise breaks it: their card cracks (win, tie or loss).
 *   - Three cracks lose the match, even if the points were ahead. (Home games set `crackLoses: false`: cracks only count.)
 *
 * An answerer has three ideas about a promise P:
 *   believe: throw the hand that beats P. Wins against a kept word, loses to the smart break.
 *   doubt:   throw P itself. Ties a kept word and beats the smart break.
 *   deeper:  throw the third hand (the one P beats). Beats a break to the hand that beats P.
 *
 * Original IP. Host-only state is the match itself; nothing here is secret except the caller's throw before it is made.
 */
import { createRng, hashSeed } from '@/core/rng';

export type Hand = 'rock' | 'paper' | 'scissors';
export const HANDS: readonly Hand[] = ['rock', 'paper', 'scissors'];
export type Side = 'a' | 'b';

export const DEFAULT_GOAL = 3;
export const CRACK_LIMIT = 3;
export const KEPT_WIN = 2;
export const PLAIN_WIN = 1;
/** Headless matches stop here (a long run of ties) and count as undecided. */
export const MAX_ROUNDS = 120;

const BEATS: Record<Hand, Hand> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** True when `a` beats `b`. */
export const beats = (a: Hand, b: Hand): boolean => BEATS[a] === b;
/** The hand that beats `h`. */
export const counterOf = (h: Hand): Hand => HANDS.find((x) => BEATS[x] === h) ?? 'rock';
/** The hand that `h` beats. */
export const loserTo = (h: Hand): Hand => BEATS[h];
export const otherSide = (s: Side): Side => (s === 'a' ? 'b' : 'a');
export const isHand = (v: unknown): v is Hand => v === 'rock' || v === 'paper' || v === 'scissors';

export interface Seat { points: number; cracks: number }

export interface RoundLog {
  round: number;
  caller: Side;
  promise: Hand;
  callerThrow: Hand;
  answerThrow: Hand;
  /** The caller threw what they promised. */
  kept: boolean;
  winner: Side | null;
  /** Points the winner got (0 on a tie). */
  points: number;
  /** The caller's card cracked this round. */
  cracked: boolean;
  /** How the answerer treated the promise. */
  answer: AnswerKind;
}

export type AnswerKind = 'believe' | 'doubt' | 'deeper';
export type MatchEnd = 'points' | 'cracks' | 'stall';

export interface PromiseState {
  goal: number;
  crackLimit: number;
  /** Whether three cracks end the match (false in the kitchen: cracks only count). */
  crackLoses: boolean;
  seats: Record<Side, Seat>;
  /** Who calls the next round. */
  caller: Side;
  /** The round that will be played next (1-based). */
  round: number;
  done: boolean;
  winner: Side | null;
  end: MatchEnd | null;
  log: RoundLog[];
}

export interface PromiseOptions {
  goal?: number;
  /** Who calls round 1. Default 'a'. */
  first?: Side;
  crackLoses?: boolean;
  crackLimit?: number;
}

export function createMatch(o: PromiseOptions = {}): PromiseState {
  return {
    goal: Math.max(1, Math.floor(o.goal ?? DEFAULT_GOAL)),
    crackLimit: Math.max(1, Math.floor(o.crackLimit ?? CRACK_LIMIT)),
    crackLoses: o.crackLoses !== false,
    seats: { a: { points: 0, cracks: 0 }, b: { points: 0, cracks: 0 } },
    caller: o.first ?? 'a',
    round: 1,
    done: false,
    winner: null,
    end: null,
    log: [],
  };
}

/** Which of the three ideas an answer is, for a given promise. */
export function answerKind(promise: Hand, answerThrow: Hand): AnswerKind {
  if (answerThrow === promise) return 'doubt';
  return answerThrow === counterOf(promise) ? 'believe' : 'deeper';
}

/** The hand an answerer throws for each idea. */
export function answerFor(promise: Hand, kind: AnswerKind): Hand {
  return kind === 'doubt' ? promise : kind === 'believe' ? counterOf(promise) : loserTo(promise);
}

export interface RoundInput { promise: Hand; callerThrow: Hand; answerThrow: Hand }

/** Plays one round. Returns a new state (the old one is untouched) and the round's log entry. */
export function playRound(s: PromiseState, input: RoundInput): { state: PromiseState; entry: RoundLog } {
  if (s.done) throw new Error('promise: the match is over');
  if (!isHand(input.promise) || !isHand(input.callerThrow) || !isHand(input.answerThrow)) throw new Error('promise: bad hand');
  const caller = s.caller;
  const answerer = otherSide(caller);
  const kept = input.callerThrow === input.promise;
  const callerWins = beats(input.callerThrow, input.answerThrow);
  const answerWins = beats(input.answerThrow, input.callerThrow);
  const winner: Side | null = callerWins ? caller : answerWins ? answerer : null;
  const points = winner === null ? 0 : winner === caller && kept ? KEPT_WIN : PLAIN_WIN;
  const entry: RoundLog = {
    round: s.round, caller, promise: input.promise, callerThrow: input.callerThrow, answerThrow: input.answerThrow,
    kept, winner, points, cracked: !kept, answer: answerKind(input.promise, input.answerThrow),
  };
  const seats: Record<Side, Seat> = { a: { ...s.seats.a }, b: { ...s.seats.b } };
  if (winner) seats[winner].points += points;
  if (!kept) seats[caller].cracks += 1;
  const next: PromiseState = { ...s, seats, log: [...s.log, entry], caller: answerer, round: s.round + 1 };
  // three cracks come first: a caller who breaks into the winning point still loses the match
  if (next.crackLoses && seats[caller].cracks >= next.crackLimit) {
    next.done = true; next.winner = answerer; next.end = 'cracks';
  } else if (winner && seats[winner].points >= next.goal) {
    next.done = true; next.winner = winner; next.end = 'points';
  }
  return { state: next, entry };
}

// ── AI opponents ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface Tell {
  /** Chance the tell shows when the caller is about to break the promise. */
  onBreak: number;
  /** Chance it shows anyway when the caller will keep it. */
  onKeep: number;
}

export interface Profile {
  id: string;
  /** Chance a caller keeps the word. */
  keep: number;
  /** The hand promised in the caller's first round, if the profile has a habit. */
  open: Hand | null;
  /** Weights (rock, paper, scissors) for the promised hand in later rounds. */
  favour: readonly [number, number, number];
  /** Weights for believe, doubt, deeper when answering a promise. */
  react: readonly [number, number, number];
  tell: Tell | null;
}

/** Ada at the kitchen table: keeps her word 4 times in 5, opens with paper, laughs before she breaks. */
export const ADA: Profile = {
  id: 'ada', keep: 0.8, open: 'paper', favour: [1, 1.5, 1], react: [0.6, 0.25, 0.15],
  tell: { onBreak: 0.9, onKeep: 0.05 },
};

/** Balance partners for the headless runs. */
export const STEADY: Profile = { id: 'steady', keep: 0.6, open: null, favour: [1, 1, 1], react: [0.4, 0.4, 0.2], tell: null };
export const HONEST: Profile = { id: 'honest', keep: 1, open: null, favour: [1, 1, 1], react: [0.2, 0.7, 0.1], tell: null };
export const LIAR: Profile = { id: 'liar', keep: 0.2, open: null, favour: [1, 1, 1], react: [0.5, 0.3, 0.2], tell: null };

export const PROFILES: Readonly<Record<string, Profile>> = { ada: ADA, steady: STEADY, honest: HONEST, liar: LIAR };

export interface AiCall { promise: Hand; throw: Hand; tell: boolean }

/** What an AI caller promises and throws. The tell is shown to the player before they throw. */
export function aiCall(s: PromiseState, side: Side, p: Profile, seed: number): AiCall {
  const rng = createRng(hashSeed(seed, p.id, 'call', s.round, side));
  const first = !s.log.some((r) => r.caller === side);
  const promise = first && p.open ? p.open : rng.weighted(HANDS, p.favour);
  // a player on their last crack keeps their word
  const atEdge = s.crackLoses && s.seats[side].cracks >= s.crackLimit - 1;
  const keeps = atEdge || rng.chance(p.keep);
  const others = HANDS.filter((h) => h !== promise);
  const thrown = keeps ? promise : rng.pick(others);
  const tell = p.tell ? rng.chance(keeps ? p.tell.onKeep : p.tell.onBreak) : false;
  return { promise, throw: thrown, tell };
}

/** What an AI answerer throws after hearing the promise. */
export function aiAnswer(s: PromiseState, side: Side, p: Profile, promise: Hand, seed: number): Hand {
  const rng = createRng(hashSeed(seed, p.id, 'answer', s.round, side));
  const kind = rng.weighted<AnswerKind>(['believe', 'doubt', 'deeper'], p.react);
  return answerFor(promise, kind);
}

export interface HeadlessResult {
  winner: Side | null;
  end: MatchEnd;
  rounds: number;
  points: Record<Side, number>;
  cracks: Record<Side, number>;
  /** Share of each side's calls that were kept. */
  keptRate: Record<Side, number>;
  state: PromiseState;
}

/** A whole match between two AI profiles, for balance runs and tests. Side `a` calls first unless `o.first` says otherwise. */
export function playHeadless(seed: number, a: Profile, b: Profile, o: PromiseOptions = {}): HeadlessResult {
  const profiles: Record<Side, Profile> = { a, b };
  let s = createMatch(o);
  while (!s.done && s.round <= MAX_ROUNDS) {
    const caller = s.caller;
    const answerer = otherSide(caller);
    const c = aiCall(s, caller, profiles[caller], seed);
    const ans = aiAnswer(s, answerer, profiles[answerer], c.promise, seed);
    s = playRound(s, { promise: c.promise, callerThrow: c.throw, answerThrow: ans }).state;
  }
  const rate = (side: Side): number => {
    const calls = s.log.filter((r) => r.caller === side);
    return calls.length === 0 ? 0 : calls.filter((r) => r.kept).length / calls.length;
  };
  return {
    winner: s.winner, end: s.end ?? 'stall', rounds: s.log.length,
    points: { a: s.seats.a.points, b: s.seats.b.points }, cracks: { a: s.seats.a.cracks, b: s.seats.b.cracks },
    keptRate: { a: rate('a'), b: rate('b') }, state: s,
  };
}
