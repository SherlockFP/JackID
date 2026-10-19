/**
 * The Question (Orrin Pale, "The Collector"): a two-card bluff duel on a 40-card deck, ranks 1-10, four of each
 * (WAVE25 phase 2).
 *
 * Rules: first to 5 points, or the most points after 7 rounds. Each round both sides are dealt two cards face down,
 * keep the higher one to stand on and slide the other face down onto the discard pile. Then the Question is asked:
 *   you act first      RAISE or HOLD.  A raise is answered by Orrin with SEE or FOLD.
 *   you held           Orrin may HOLD or RAISE.  His raise is answered by you with SEE or FOLD.
 * A fold gives the other side 1 point. Otherwise the stands are shown and the higher wins 1 point, or 2 when a raise
 * was seen. Equal stands push. The winner takes the pot (2 stakes minus the rake), a draw splits it.
 * Orrin's fair play is a plain threshold game with the odd bluff: he raises a weak stand now and then.
 *
 * The cheat ("Marked Deck", plan kind `k-tq`): from a hidden round (2 or 3) on the deck is marked, and every decision
 * Orrin takes reads your stand: he sees and raises exactly when he is ahead. Clues:
 *   TELL  his thumb ghosts along the card edge before he answers    (his first marked decision)
 *   TABLE the backs of the high cards carry a faint nick at the corner (his first marked decision)
 *   MATH  the discard pile does not add up: stock + pile + the 4 cards in hand reads 41 of a deck of 40
 * Call: C, then MARKED DECK. The call is right once he has taken a marked decision.
 *
 * Host only: the state holds the deck and both hands. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { FAIR_KIND, POT, lit, runHeadless, settleNet, type Side, type TurnState } from '../gamekit';
import type { Board, CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, TextRef } from '../types';

export const ID = 'thequestion';
export const RIVAL = 'orrin';
export const KIND = 'k-tq';
export const CHEAT_RATE = 0.2;
export const CALL_DECK = 'MARKED DECK';

export const DECK = 40;
export const POINTS_TO_WIN = 5;
export const ROUNDS_MAX = 7;

/** The naive player's rule of thumb: raise on a stand of 8 or better, see a raise with a 7 or better. */
export const PLAYER_RAISE = 8;
export const PLAYER_SEE = 7;
/** Orrin's fair thresholds: he sees a raise from 8, raises unprompted from 9 and now and then bluffs a weak stand. */
export const RIVAL_SEE = 8;
export const RIVAL_RAISE = 9;
export const RIVAL_BLUFF = 0.3;
export const BLUFF_BELOW = 5;

export type Phase = 'open' | 'reply' | 'counter' | 'answer';
export type TQAction = { k: 'raise' } | { k: 'hold' } | { k: 'see' } | { k: 'fold' };

export interface TQState extends TurnState {
  pts: Record<Side, number>;
  /** Host only. */
  deck: number[];
  dpos: number;
  hand: Record<Side, [number, number]>;
  stand: Record<Side, number>;
  phase: Phase;
  /** Points on the round: 1, or 2 once a raise is on the table. */
  value: number;
  /** Cards on the discard pile as the table shows them. */
  pile: number;
  /** The marked deck's extra card in the pile (public through the pile count only). */
  extra: number;
  cheated: boolean;
  tellDone: boolean;
  tableDone: boolean;
  mathDone: boolean;
  decoyDone: boolean;
}

export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  if (rng.chance(CHEAT_RATE)) return { kind: KIND, round: rng.chance(0.7) ? 2 : 3, detail: {} };
  return { kind: FAIR_KIND, round: 0, detail: { decoy: rng.chance(0.5) ? rng.int(2, 4) : 0 } };
}

const clone = (s: TQState): TQState => ({
  ...s, pts: { ...s.pts }, deck: s.deck.slice(), hand: { player: [...s.hand.player], rival: [...s.hand.rival] }, stand: { ...s.stand }, log: s.log.slice(),
});
const armed = (s: TQState, plan: CheatPlan): boolean => plan.kind === KIND && s.round >= plan.round;

/** Deals a round: two cards each, the better one is the stand. */
function deal(s: TQState, plan: CheatPlan, ev: unknown[]): void {
  const take = (): number => s.deck[s.dpos++];
  s.hand = { player: [take(), take()], rival: [take(), take()] };
  s.stand = { player: Math.max(...s.hand.player), rival: Math.max(...s.hand.rival) };
  if (armed(s, plan)) s.extra = 1;
  s.phase = 'open';
  s.value = 1;
  s.turn = 'player';
  ev.push({ k: 'deal', round: s.round, stock: DECK - s.dpos, pile: s.pile + s.extra });
}

export function init(seed: number, plan: CheatPlan, stake: number): TQState {
  const rng = createRng(hashSeed(seed, 'deck'));
  const deck: number[] = [];
  for (let r = 1; r <= 10; r++) for (let c = 0; c < 4; c++) deck.push(r);
  rng.shuffle(deck);
  const s: TQState = {
    seed, stake, round: 1, turn: 'player', pay: 0, done: false, log: [],
    pts: { player: 0, rival: 0 }, deck, dpos: 0, hand: { player: [0, 0], rival: [0, 0] }, stand: { player: 0, rival: 0 },
    phase: 'open', value: 1, pile: 0, extra: 0, cheated: false, tellDone: false, tableDone: false, mathDone: false, decoyDone: false,
  };
  const ev: unknown[] = [];
  deal(s, plan, ev);
  s.log.push(...ev);
  return s;
}

export const legal = (st: DuelState): TQAction[] => {
  const s = st as TQState;
  if (s.done || s.turn !== 'player') return [];
  return s.phase === 'open' ? [{ k: 'raise' }, { k: 'hold' }] : [{ k: 'see' }, { k: 'fold' }];
};

/** Ends the round: `winner` takes `pts`, the four cards go to the pile, the next round is dealt or the match ends. */
function endRound(s: TQState, plan: CheatPlan, winner: Side | null, pts: number, ev: unknown[]): void {
  if (winner) s.pts[winner] += pts;
  s.pile += 4;
  ev.push({ k: 'roundEnd', round: s.round, winner, pts });
  const lead = s.pts.player - s.pts.rival;
  if (s.pts.player >= POINTS_TO_WIN || s.pts.rival >= POINTS_TO_WIN || s.round >= ROUNDS_MAX) {
    s.done = true;
    s.winner = lead === 0 ? undefined : lead > 0 ? 'player' : 'rival';
    s.pay = s.winner === 'player' ? POT : s.winner === undefined ? POT / 2 : 0;
    ev.push({ k: 'end' });
    return;
  }
  s.round++;
  ev.push({ k: 'round', round: s.round });
  deal(s, plan, ev);
}

function showdown(s: TQState, plan: CheatPlan, ev: unknown[]): void {
  const p = s.stand.player, r = s.stand.rival;
  ev.push({ k: 'show', round: s.round, you: p, him: r, value: s.value });
  endRound(s, plan, p === r ? null : p > r ? 'player' : 'rival', s.value, ev);
}

export function step(st: DuelState, actor: Side, action: TQAction, plan: CheatPlan): { state: TQState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as TQState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  if (s.done || s.turn !== actor) throw new Error('thequestion: not your turn');
  const marked = actor === 'rival' && armed(s, plan);
  switch (s.phase) {
    case 'open':
      if (action.k === 'raise') { ev.push({ k: 'raise', by: actor }); s.value = 2; s.phase = 'reply'; s.turn = 'rival'; }
      else { ev.push({ k: 'hold', by: actor }); s.phase = 'counter'; s.turn = 'rival'; }
      break;
    case 'counter':
      if (action.k === 'raise') { ev.push({ k: 'raise', by: actor }); s.value = 2; s.phase = 'answer'; s.turn = 'player'; }
      else { ev.push({ k: 'hold', by: actor }); showdown(s, plan, ev); }
      break;
    case 'reply':
    case 'answer':
      if (action.k === 'fold') { ev.push({ k: 'fold', by: actor }); endRound(s, plan, actor === 'player' ? 'rival' : 'player', 1, ev); }
      else { ev.push({ k: 'see', by: actor }); showdown(s, plan, ev); }
      break;
  }
  if (marked) {
    s.cheated = true;
    if (!s.tellDone) { s.tellDone = true; clues.push({ channel: 'tell', round: st.round, key: 'duel.tq.tell.thumb' }); }
    if (!s.tableDone) { s.tableDone = true; clues.push({ channel: 'table', round: st.round, key: 'duel.tq.table.nick' }); }
    if (!s.mathDone) {
      s.mathDone = true;
      const stock = DECK - (st as TQState).dpos, pile = (st as TQState).pile + 1;
      clues.push({ channel: 'math', round: st.round, key: 'duel.tq.math.pile', data: { stock, pile, hands: 4, total: stock + pile + 4, expected: DECK } });
    }
  } else if (actor === 'rival' && plan.kind !== KIND && !s.decoyDone && st.round === plan.detail.decoy) {
    s.decoyDone = true;                                // an honest thumb on an honest deck
    clues.push({ channel: 'tell', round: st.round, key: 'duel.tq.tell.thumb' });
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

/** The player's rule of thumb: raise strong, see strong. Own stand only. */
export function pickMove(st: DuelState, _me: Side = 'player'): TQAction {
  const s = st as TQState;
  const mine = s.stand.player;
  if (s.phase === 'open') return { k: mine >= PLAYER_RAISE ? 'raise' : 'hold' };
  return { k: mine >= PLAYER_SEE ? 'see' : 'fold' };
}

/** Orrin. Fair: thresholds and the odd bluff. Marked deck: he reads your stand and is never wrong. */
export function rivalAct(st: DuelState, plan: CheatPlan, seed: number): TQAction {
  const s = st as TQState;
  const mine = s.stand.rival, yours = s.stand.player;
  const knows = armed(s, plan);
  if (s.phase === 'reply') return { k: (knows ? mine >= yours : mine >= RIVAL_SEE) ? 'see' : 'fold' };
  const rng = createRng(seed);
  const raise = knows ? mine > yours : mine >= RIVAL_RAISE || (mine < BLUFF_BELOW && rng.chance(RIVAL_BLUFF));
  return { k: raise ? 'raise' : 'hold' };
}

export function call(st: DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  return { correct: plan.kind === KIND && (st as TQState).cheated && t === CALL_DECK };
}

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as TQState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.tq.reveal.saw', happened: 'duel.tq.reveal.happened', why: 'duel.tq.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.tq.fair.saw', happened: 'duel.tq.fair.happened', why: 'duel.tq.fair.why' };

// ── HUD hooks ─────────────────────────────────────────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');

export const describeAction = (a: TQAction): TextRef => ({ key: `duel.tq.act.${a.k}` });

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: Side; round?: number; stock?: number; pile?: number; you?: number; him?: number; value?: number; winner?: Side | null; pts?: number };
  switch (o.k) {
    case 'deal': return { key: 'duel.tq.ev.deal', data: { round: o.round, stock: o.stock, pile: o.pile } };
    case 'raise': return { key: `duel.tq.ev.raise${who(o.by!)}` };
    case 'hold': return { key: `duel.tq.ev.hold${who(o.by!)}` };
    case 'see': return { key: `duel.tq.ev.see${who(o.by!)}` };
    case 'fold': return { key: `duel.tq.ev.fold${who(o.by!)}` };
    case 'show': return { key: 'duel.tq.ev.show', data: { you: o.you, him: o.him, value: o.value } };
    case 'roundEnd': return { key: o.winner ? `duel.tq.ev.roundEnd${who(o.winner)}` : 'duel.tq.ev.roundPush', data: { round: o.round, pts: o.pts } };
    case 'round': return { key: 'duel.tq.ev.round', data: { round: o.round } };
    default: return { key: 'duel.tq.ev.end' };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as TQState;
  const [a, b] = s.hand.player;
  return [
    { key: 'duel.tq.line.hand', data: { a, b, stand: s.stand.player } },
    { key: 'duel.tq.line.score', data: { you: s.pts.player, him: s.pts.rival, round: s.round, value: s.value } },
  ];
}

/** Your two cards (the one you stand on is marked), his two face down, what the round is worth. His cards are never in the data. */
export function board(st: DuelState): Board {
  const s = st as TQState;
  const mine = s.hand.player;
  const stand = mine[0] >= mine[1] ? 0 : 1;
  return {
    zones: [
      { label: { key: 'duel.tq.zone.you' }, pieces: mine.map((r, i) => ({ top: lit(r), mark: i === stand ? ('now' as const) : undefined })) },
      { label: { key: 'duel.tq.zone.him' }, pieces: [{ top: lit('?'), down: true }, { top: lit('?'), down: true }] },
      { label: { key: 'duel.tq.zone.worth' }, pieces: [{ top: lit(`x${s.value}`), mark: s.value > 1 ? ('next' as const) : undefined, sub: { key: 'duel.tq.pts' } }] },
    ],
    score: { you: s.pts.player, him: s.pts.rival, of: POINTS_TO_WIN },
    notes: [{ key: 'duel.tq.note.deck', data: { round: s.round, rounds: ROUNDS_MAX, stock: DECK - s.dpos, pile: s.pile + s.extra } }],
  };
}

export const callTargets = (): CallTarget[] => [{ target: CALL_DECK, label: { key: 'duel.tq.call' } }];

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const theQuestion: DuelRules<TQAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict,
  turnOf: (s) => (s as TQState).turn,
  describeAction, describeEvent, describe, callTargets, board, goal: 'duel.tq.goal',
  playHeadless: (seed, policy) => runHeadless<TQAction>({
    rules: theQuestion,
    move: (s) => pickMove(s),
    target: () => CALL_DECK,
  }, seed, policy),
};
