/**
 * The Last Count (Vell, "The Counter"): hilo on a tape of 8 cards (WAVE25 phase 2). Vell is THROWING the match.
 *
 * Rules: eight cards (ranks 1-10 from a deck of 40) are laid on the tape and the first is shown. Seven times the next
 * card is guessed, HIGHER or LOWER than the one before (equal ranks make every guess a miss). You guess the odd cards
 * (2, 4, 6, 8), Vell the even ones (3, 5, 7); each hit is a point. The side with more points takes the pot (2 stakes
 * minus the rake); a tie stays with the guest.
 *
 * The throw (plan kind `k-lc`, always): Vell counted the whole tape before he sat. Every answer he gives is a miss on
 * purpose. He never wins and never punishes. Clues:
 *   TELL  a coin slips from his fingers and he does not pick it up   (his first answer)
 *   TABLE the reel under his hand runs a notch backwards: he reads ahead (his first answer)
 *   MATH  three answers, three misses: the Tally Sheet gives the odds of an honest counter missing all three (his third)
 * Call: C, then THROWN MATCH. A correct call ends the duel peacefully (no penalty, ever: a wrong call is never fined)
 * and fires the {@link onVellCalled} hook once, the release / void ending path. Left uncalled, he "loses" on the count
 * and the guest takes the pot, with no ending.
 *
 * Host only: the state holds the tape. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { POT, runHeadless, settleNet, type Side, type TurnState } from '../gamekit';
import type { CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, TextRef } from '../types';

export const ID = 'lastcount';
export const RIVAL = 'vell';
export const KIND = 'k-lc';
export const CALL_THROWN = 'THROWN MATCH';

export const TAPE = 8;
export const DECK = 40;
export const THROWS_FOR_MATH = 3;

export type LCAction = { k: 'higher' } | { k: 'lower' };

export interface LCState extends TurnState {
  pts: Record<Side, number>;
  /** The tape, hidden cards included (host only). `tape[0]` is shown at the start. */
  tape: number[];
  /** Cards shown so far (`round` of them are on the table after the current guess resolves). */
  shown: number;
  /** Vell's answers so far and the chance an honest counter would have missed each one. */
  throws: number;
  missOdds: number;
  cheated: boolean;
  tellDone: boolean;
  tableDone: boolean;
  mathDone: boolean;
}

export const makePlan = (_seed: number): CheatPlan => ({ kind: KIND, round: 2, detail: {} });

export function init(seed: number, _plan: CheatPlan, stake: number): LCState {
  const rng = createRng(hashSeed(seed, 'tape'));
  const deck: number[] = [];
  for (let r = 1; r <= 10; r++) for (let c = 0; c < 4; c++) deck.push(r);
  rng.shuffle(deck);
  const s: LCState = {
    seed, stake, round: 1, turn: 'player', pay: 0, done: false, log: [],
    pts: { player: 0, rival: 0 }, tape: deck.slice(0, TAPE), shown: 1, throws: 0, missOdds: 1,
    cheated: false, tellDone: false, tableDone: false, mathDone: false,
  };
  s.log.push({ k: 'card', i: 0, rank: s.tape[0] });
  return s;
}

/** Whose guess round `r` (1-7) is: the player takes the odd rounds, Vell the even ones. */
export const guesser = (r: number): Side => (r % 2 === 1 ? 'player' : 'rival');

export const legal = (st: DuelState): LCAction[] => {
  const s = st as LCState;
  return s.done || s.turn !== 'player' ? [] : [{ k: 'higher' }, { k: 'lower' }];
};

const clone = (s: LCState): LCState => ({ ...s, pts: { ...s.pts }, tape: s.tape.slice(), log: s.log.slice() });

/** Odds that the next card is higher / lower than `cur`, given the cards already shown. Public information only. */
export function odds(shownCards: readonly number[]): { higher: number; lower: number } {
  const cur = shownCards[shownCards.length - 1];
  const left = new Array<number>(11).fill(4);
  for (const c of shownCards) left[c]--;
  const rest = DECK - shownCards.length;
  let hi = 0, lo = 0;
  for (let r = 1; r <= 10; r++) { if (r > cur) hi += left[r]; else if (r < cur) lo += left[r]; }
  return { higher: hi / rest, lower: lo / rest };
}

export function step(st: DuelState, actor: Side, action: LCAction, _plan: CheatPlan): { state: LCState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as LCState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  if (s.done || s.turn !== actor || guesser(s.round) !== actor) throw new Error('lastcount: not your turn');
  const seen = s.tape.slice(0, s.shown);
  const od = odds(seen);
  const cur = s.tape[s.shown - 1], next = s.tape[s.shown];
  const hit = action.k === 'higher' ? next > cur : next < cur;
  if (actor === 'rival') {
    s.throws++;
    s.cheated = true;
    s.missOdds *= 1 - Math.max(od.higher, od.lower);       // an honest counter answers on the better odds
    if (!s.tellDone) { s.tellDone = true; clues.push({ channel: 'tell', round: s.round, key: 'duel.lc.tell.coin' }); }
    if (!s.tableDone) { s.tableDone = true; clues.push({ channel: 'table', round: s.round, key: 'duel.lc.table.reel' }); }
    if (!s.mathDone && s.throws >= THROWS_FOR_MATH) {
      s.mathDone = true;
      clues.push({ channel: 'math', round: s.round, key: 'duel.lc.math.misses', data: { n: s.throws, odds: Math.max(1, Math.round(s.missOdds * 100)) } });
    }
  }
  s.shown++;
  ev.push({ k: 'guess', by: actor, dir: action.k, cur, hitOdds: Math.round((action.k === 'higher' ? od.higher : od.lower) * 100) });
  ev.push({ k: 'card', i: s.shown - 1, rank: next });
  if (hit) s.pts[actor]++;
  ev.push({ k: 'result', by: actor, hit, you: s.pts.player, him: s.pts.rival });
  if (s.shown >= TAPE) {
    s.done = true;
    s.winner = s.pts.rival > s.pts.player ? 'rival' : 'player';
    s.pay = s.winner === 'player' ? POT : 0;
    ev.push({ k: 'end' });
  } else {
    s.round++;
    s.turn = guesser(s.round);
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

/** The player: the better odds on the cards shown, nothing else. */
export function pickMove(st: DuelState, _me: Side = 'player'): LCAction {
  const s = st as LCState;
  const od = odds(s.tape.slice(0, s.shown));
  return { k: od.higher >= od.lower ? 'higher' : 'lower' };
}

/** Vell counted the tape: he answers the way that misses. */
export function rivalAct(st: DuelState): LCAction {
  const s = st as LCState;
  const cur = s.tape[s.shown - 1], next = s.tape[s.shown];
  return { k: next > cur ? 'lower' : 'higher' };
}

// ── the ending hook ───────────────────────────────────────────────────────────────────────────────────
export interface VellCalledInfo {
  /** The duel's seed (`hashSeed(runSeed, 'duel', 'vell', night)` mixed once more by the engine): one duel, one event. */
  seed: number;
}
type VellListener = (info: VellCalledInfo) => void;
const listeners = new Set<VellListener>();
const fired = new Set<number>();

/**
 * Subscribes to the moment the player correctly calls out Vell's thrown match: the release / void ending path. Fires
 * once per duel (replaying a restored session does not repeat it). Returns the unsubscriber.
 */
export function onVellCalled(fn: VellListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test helper: forget which duels already fired. */
export function resetVellCalled(): void { fired.clear(); }

export function call(st: DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  const s = st as LCState;
  const correct = plan.kind === KIND && s.cheated && t === CALL_THROWN;
  if (correct && !fired.has(s.seed)) {
    fired.add(s.seed);
    for (const fn of [...listeners]) { try { fn({ seed: s.seed }); } catch { /* a listener never stops the duel */ } }
  }
  return { correct };
}

/** Vell is never punished and the guest is never fined for doubting him: a wrong call costs nothing. */
export const settle = (s: DuelState, calledCorrect: boolean | null, stake: number): { playerNet: number } =>
  settleNet(s, calledCorrect === false ? null : calledCorrect, stake);

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as LCState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.lc.reveal.saw', happened: 'duel.lc.reveal.happened', why: 'duel.lc.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.lc.fair.saw', happened: 'duel.lc.fair.happened', why: 'duel.lc.fair.why' };

// ── HUD hooks ─────────────────────────────────────────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');

export const describeAction = (a: LCAction): TextRef => ({ key: `duel.lc.act.${a.k}` });

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: Side; dir?: string; cur?: number; hitOdds?: number; i?: number; rank?: number; hit?: boolean; you?: number; him?: number };
  switch (o.k) {
    case 'card': return { key: 'duel.lc.ev.card', data: { i: (o.i ?? 0) + 1, rank: o.rank } };
    case 'guess': return { key: `duel.lc.ev.guess${who(o.by!)}${o.dir === 'higher' ? 'Hi' : 'Lo'}`, data: { cur: o.cur, odds: o.hitOdds } };
    case 'result': return { key: o.hit ? `duel.lc.ev.hit${who(o.by!)}` : `duel.lc.ev.miss${who(o.by!)}`, data: { you: o.you, him: o.him } };
    default: return { key: 'duel.lc.ev.end' };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as LCState;
  const cur = s.tape[s.shown - 1];
  const od = odds(s.tape.slice(0, s.shown));
  return [
    { key: 'duel.lc.line.tape', data: { cur, shown: s.shown, total: TAPE } },
    { key: 'duel.lc.line.odds', data: { hi: Math.round(od.higher * 100), lo: Math.round(od.lower * 100), you: s.pts.player, him: s.pts.rival } },
  ];
}

export const callTargets = (): CallTarget[] => [{ target: CALL_THROWN, label: { key: 'duel.lc.call' } }];

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const lastCount: DuelRules<LCAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call, settle,
  reveal, revealFair, verdict,
  turnOf: (s) => (s as LCState).turn,
  describeAction, describeEvent, describe, callTargets,
  playHeadless: (seed, policy) => runHeadless<LCAction>({
    rules: lastCount,
    move: (s) => pickMove(s),
    target: () => CALL_THROWN,
  }, seed, policy),
};
