/**
 * Shared helpers of the three duel games (Wave 25 TALLY, lane B): money, the turn-state base and the headless
 * runner behind every `DuelRules.playHeadless`. Pure data, seeded rng only, no DOM.
 *
 * MONEY. `settle(...).playerNet` is a NET change of the player's coins (loss = -S, like `DuelSession.forfeit`):
 *   - no call ............ (pay - 1) * S      pay = gross multiple of the stake the match returned (0, 0.475, 0.95, 1.9 ...)
 *   - correct call ....... +3 * S             the wager is voided against the rival, who pays 3 x S
 *   - wrong call ......... (pay - 1) * S - S  fined one stake unit, the cheat (and the match) goes on
 * A return ratio ("EV" in the spec: 0.75 naive, 1.5 detective) is therefore `1 + playerNet / S`.
 */
import { hashSeed } from '@/core/rng';
import type { CheatPlan, Clue, DuelRules, DuelState } from './types';

export type Side = 'player' | 'rival';

export const HEADLESS_STAKE = 100;
export const RAKE = 0.05;
/** The pot a full win returns, in stakes: both stakes minus the rake. */
export const POT = 2 * (1 - RAKE);
export const CALL_PRIZE = 3;
/** Plan kind of a duel the rival plays straight (no cheat). Cheat kinds are `k-sw`, `k-gs`, `k-sc`. */
export const FAIR_KIND = 'k-0';

/** Every game's state: the engine reads `round`, `done`, `winner`, `log` and (optionally) `turn`. */
export interface TurnState extends DuelState {
  seed: number;
  stake: number;
  turn: Side;
  /** Gross multiple of the stake the match returns to the player once `done` (0 = lost it all). */
  pay: number;
}

export const other = (s: Side): Side => (s === 'player' ? 'rival' : 'player');

/** Net coins for the player. `calledCorrect`: true / false / null (no call). */
export function settleNet(s: DuelState, calledCorrect: boolean | null, stake: number): { playerNet: number } {
  if (calledCorrect === true) return { playerNet: Math.round(CALL_PRIZE * stake) };
  const t = s as TurnState;
  const gross = t.done ? t.pay : 0;
  const fine = calledCorrect === false ? stake : 0;
  return { playerNet: Math.round((gross - 1) * stake - fine) };
}

export const JSONclone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Distinct channels among the clues seen so far. */
export const channelsOf = (clues: readonly Clue[]): Set<Clue['channel']> => new Set(clues.map((c) => c.channel));

export interface HeadlessKit<A> {
  rules: DuelRules<A>;
  /** The player's move (same policy for the naive and the detective bot: the detective only adds calls). */
  move(s: DuelState, legal: A[]): A;
  /** The call target once the public clues are convincing, else undefined. Only ever called with >= 2 channels seen. */
  target(clues: readonly Clue[], s: DuelState): unknown | undefined;
}

/**
 * Plays one whole duel the way the engine does (same seeds, same turn protocol). `naive` never calls; `detective`
 * calls once the clues cover two channels.
 */
export function runHeadless<A>(kit: HeadlessKit<A>, seed: number, policy: 'naive' | 'detective'): { playerNet: number; calls: number; correctCalls: number } {
  const { rules } = kit;
  const plan: CheatPlan = rules.makePlan(seed);
  let s = rules.init(hashSeed(seed, 'init'), plan, HEADLESS_STAKE);
  const clues: Clue[] = [];
  let calls = 0, correctCalls = 0, called: boolean | null = null;
  for (let guard = 0; !s.done && guard < 800; guard++) {
    if (policy === 'detective' && called === null && channelsOf(clues).size >= 2) {
      const target = kit.target(clues, s);
      if (target !== undefined) {
        calls++;
        called = rules.call(s, plan, target).correct;
        if (called) { correctCalls++; break; }
      }
    }
    const mine = (s as TurnState).turn === 'player' ? rules.legal(s) : [];
    const out = mine.length
      ? rules.step(s, 'player', kit.move(s, mine), plan)
      : rules.step(s, 'rival', rules.rivalAct(s, plan, hashSeed(seed, 'rival', guard)), plan);
    s = out.state;
    clues.push(...out.clues);
  }
  return { playerNet: rules.settle(s, called, HEADLESS_STAKE).playerNet, calls, correctCalls };
}
