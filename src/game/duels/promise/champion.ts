/**
 * THE BURNING WAGER: the Champion's play (docs/STORY_BIBLE.md §5a "Finale", §9, §10). Rock, Paper, Promise, first to 5, three cracks
 * lose, against the rest of the old champion (the Compere, sat down). He calls first. Pure and seeded: no DOM, no clock, no Math.random.
 *
 * His habits are the ones the voice remembers (docs/JOKER.md §3, whispers `opens`, `quiet`, `left`):
 *   OPENS   his first call is paper, and he keeps it.
 *   QUIET   the man who never stops talking drops his patter before a break: the bare word, and his eyes go left.
 *           Now and then he goes quiet and keeps it anyway, so a reader is never quite sure.
 *   BREAKS  he keeps early words and breaks when it matters. At match point (either side one point from 5) he calls paper and
 *           throws rock, every time: he has never kept a word at match point. Throw his promised hand.
 * His answers play the odds and your file: he believes a caller with a clean card and doubts one who has broken a word. At your
 * match point your hand trembles and he reads it, unless Selim's water steadied it.
 */
import { createRng, hashSeed } from '@/core/rng';
import {
  HANDS, MAX_ROUNDS, answerFor, counterOf, createMatch, loserTo, playRound,
  type AiCall, type AnswerKind, type Hand, type PromiseState,
} from './rules';
import type { Foe, FlowResult } from './flow';

export const WAGER_GOAL = 5;
/** He keeps a word away from match point this often (early in the match, and later). */
export const KEEP_EARLY = 0.85;
export const KEEP_LATE = 0.6;
/** Rounds that count as early. */
export const EARLY_ROUNDS = 4;
/** He goes quiet before a break this often, and before a kept word this often. */
export const QUIET_ON_BREAK = 0.8;
export const QUIET_ON_KEEP = 0.15;
/** His answers (believe, doubt, deeper): to a caller with a clean card, and to one who has broken a word. */
export const READ_CLEAN: readonly [number, number, number] = [0.55, 0.35, 0.1];
export const READ_BROKEN: readonly [number, number, number] = [0.3, 0.6, 0.1];
/** The Gambler's Eye uses everyone gets at the Wager. */
export const BASE_EYES = 1;

export const createWager = (): PromiseState => createMatch({ goal: WAGER_GOAL, first: 'b', crackLoses: true });

/** One point would end it, for either side. */
export const matchPoint = (m: PromiseState): boolean => m.seats.a.points + 1 >= m.goal || m.seats.b.points + 1 >= m.goal;

/** At your match point your hand trembles on your own call, and he reads it (Selim's water steadies it). */
export const trembles = (m: PromiseState, steady: boolean): boolean => !steady && m.caller === 'a' && m.seats.a.points + 1 >= m.goal;

/** His call this round. `tell` is the quiet: the bare word, no patter. */
export function champCall(m: PromiseState, seed: number): AiCall {
  if (!m.log.some((r) => r.caller === 'b')) return { promise: 'paper', throw: 'paper', tell: false };
  if (matchPoint(m)) return { promise: 'paper', throw: 'rock', tell: true };
  const rng = createRng(hashSeed(seed, 'champ.call', m.round));
  const promise = rng.pick(HANDS);
  const atEdge = m.seats.b.cracks >= m.crackLimit - 1;
  const keeps = atEdge || rng.chance(m.round <= EARLY_ROUNDS ? KEEP_EARLY : KEEP_LATE);
  return { promise, throw: keeps ? promise : loserTo(promise), tell: rng.chance(keeps ? QUIET_ON_KEEP : QUIET_ON_BREAK) };
}

/** His answer to your call: the odds and your file, or the hand you hold when it trembles. */
export function champAnswer(m: PromiseState, seed: number, promise: Hand, mine: Hand, steady: boolean): Hand {
  if (trembles(m, steady)) return counterOf(mine);
  const rng = createRng(hashSeed(seed, 'champ.answer', m.round));
  return answerFor(promise, rng.weighted<AnswerKind>(['believe', 'doubt', 'deeper'], m.seats.a.cracks > 0 ? READ_BROKEN : READ_CLEAN));
}

/** What the board hands `run.burningWager`: your win or loss, your cracks (any crack keeps the card cold), and his word spent. */
export const wagerOutcome = (r: Pick<FlowResult, 'winner' | 'cracks'>, word: boolean): { wager: 'win' | 'lose'; cracks: number; word: boolean } =>
  ({ wager: r.winner === 'you' ? 'win' : 'lose', cracks: r.cracks.you, word });

/** The Champion as the flow's foe (side `b`, lines under `promise.champ.*`). */
export const championFoe = (steady: boolean): Foe => ({
  id: 'champ',
  call: (st, seed) => champCall(st, seed),
  answer: (st, promise, mine, seed) => champAnswer(st, seed, promise, mine, steady),
});

// ── what friends bring (§10 wiring plan: tamsin.silence, lucan.howAda, lucan.tell, selim.water, mimosa.eye) ──────────────────
export interface WagerHelps {
  /** Tamsin (bond 2) names his silence: the quiet is said in your head. */
  silence: boolean;
  /** Ada is behind you (the kitchen ended in a kept pair): the silence lasts twice as long, so you hear it too. */
  ada: boolean;
  /** Lucan (bond 2) says how Ada beat him, at the first match point. */
  howAda: boolean;
  /** Lucan (bond 3) says the tell aloud, once, from the front row. */
  tell: boolean;
  /** Selim's water (bond 3): no tremble. */
  water: boolean;
  /** Mimosa's memory (bond 3) is the extra Eye; Lucan betrayed calls your tell to the room instead. */
  mimosa: boolean;
  lucanAgainst: boolean;
  /** Gambler's Eye uses: one, +1 with Mimosa, -1 with Lucan against you. */
  eyes: number;
}

/** `b` is the run's bond book (`run.bonds()`). */
export function wagerHelps(b: { has(id: string): boolean; against(): readonly string[] }, ada: boolean): WagerHelps {
  const mimosa = b.has('mimosa.eye'), lucanAgainst = b.against().includes('lucan');
  return {
    silence: b.has('tamsin.silence'), ada, howAda: b.has('lucan.howAda'), tell: b.has('lucan.tell'), water: b.has('selim.water'),
    mimosa, lucanAgainst, eyes: Math.max(0, BASE_EYES + (mimosa ? 1 : 0) - (lucanAgainst ? 1 : 0)),
  };
}

// ── headless (balance tests) ─────────────────────────────────────────────────────────────────────────────────────────
/** reader: keeps every word, throws his promised hand when he goes quiet and believes him when he talks. believer: keeps every
 *  word and always believes him. random: any promise, any throw. */
export type WagerBot = 'reader' | 'believer' | 'random';

export function playWager(seed: number, bot: WagerBot, steady = false): PromiseState {
  const rng = createRng(hashSeed(seed, 'wager.bot', bot));
  let s = createWager();
  while (!s.done && s.round <= MAX_ROUNDS) {
    if (s.caller === 'b') {
      const c = champCall(s, seed);
      const mine = bot === 'random' ? rng.pick(HANDS) : bot === 'reader' && c.tell ? c.promise : counterOf(c.promise);
      s = playRound(s, { promise: c.promise, callerThrow: c.throw, answerThrow: mine }).state;
    } else {
      const promise = rng.pick(HANDS);
      const mine = bot === 'random' ? rng.pick(HANDS) : promise;
      s = playRound(s, { promise, callerThrow: mine, answerThrow: champAnswer(s, seed, promise, mine, steady) }).state;
    }
  }
  return s;
}
