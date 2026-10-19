/**
 * Locker Shuffle (Mimosa Teague, "Lost & Found"): the shell game with three lockers (WAVE25 phase 2).
 *
 * Rules: first to 3 of 5 rounds. Each round Mimosa shows the prize going under one locker (A, B or C), announces how
 * many swaps she will make, and swaps lockers out loud, one by one: every swap is on the Tally Sheet. Then you pick a
 * locker. The prize under it wins the round. Later rounds shuffle more. The winner takes the pot (2 stakes minus the
 * rake).
 *
 * The cheat ("Spare Key", plan kind `k-ls`): from a hidden round (2 or 3) on she keeps a spare key, and the prize is
 * never under any locker you pick (if you tracked it right, it moves). Clues:
 *   TELL  she hums while she shuffles                                  (the first cheat shuffle)
 *   TABLE the locker you picked is warm: a thread of steam, a glint at the lock   (the first pick it fails)
 *   MATH  the shuffle count mismatch: she announced N swaps, the log counts N + 1 (the extra swap is the key trade)
 * Call: C, then SPARE KEY. The call is right once the spare key has been used on a pick.
 *
 * Host only: the state holds the prize position. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { FAIR_KIND, POT, lit, runHeadless, settleNet, type Side, type TurnState } from '../gamekit';
import type { Board, CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, TextRef } from '../types';

export const ID = 'lockershuffle';
export const RIVAL = 'mimosa';
export const KIND = 'k-ls';
export const CHEAT_RATE = 0.2;
export const CALL_KEY = 'SPARE KEY';

export const LOCKERS = 3;
export const ROUNDS_TO_WIN = 3;
export const ROUNDS_MAX = 5;
/** Announced swaps per round. */
export const SWAPS = [5, 6, 7, 8, 9] as const;
/** The naive bot loses track of the prize at each swap with this chance (it follows a fast shuffle by eye). */
export const SLIP = 0.18;
export const LETTER = ['A', 'B', 'C'] as const;

export type LSAction = { k: 'shuffle' } | { k: 'pick'; i: number };

export interface LSState extends TurnState {
  roundWins: Record<Side, number>;
  /** Prize position (host only). */
  pos: number;
  /** Where the prize went under at the start of the shuffle (public: she shows it). */
  start: number;
  announced: number;
  counted: number;
  cheated: boolean;
  tellDone: boolean;
  tableDone: boolean;
  mathDone: boolean;
  decoyDone: boolean;
}

export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  if (rng.chance(CHEAT_RATE)) return { kind: KIND, round: rng.chance(0.75) ? 2 : 3, detail: {} };
  return { kind: FAIR_KIND, round: 0, detail: { decoy: rng.chance(0.5) ? rng.int(2, 4) : 0 } };
}

export function init(seed: number, _plan: CheatPlan, stake: number): LSState {
  return {
    seed, stake, round: 1, turn: 'rival', pay: 0, done: false, log: [],
    roundWins: { player: 0, rival: 0 }, pos: 0, start: 0, announced: 0, counted: 0,
    cheated: false, tellDone: false, tableDone: false, mathDone: false, decoyDone: false,
  };
}

export const legal = (st: DuelState): LSAction[] => {
  const s = st as LSState;
  if (s.done || s.turn !== 'player') return [];
  return Array.from({ length: LOCKERS }, (_, i) => ({ k: 'pick' as const, i }));
};

const clone = (s: LSState): LSState => ({ ...s, roundWins: { ...s.roundWins }, log: s.log.slice() });
const armed = (s: LSState, plan: CheatPlan): boolean => plan.kind === KIND && s.round >= plan.round;

function shuffle(s: LSState, plan: CheatPlan, ev: unknown[], clues: Clue[]): void {
  const rng = createRng(hashSeed(s.seed, 'shuffle', s.round));
  const announced = SWAPS[Math.min(s.round, SWAPS.length) - 1];
  const cheat = armed(s, plan);
  const n = announced + (cheat ? 1 : 0);                // the key trade is one swap too many
  s.start = rng.int(0, LOCKERS - 1);
  s.pos = s.start;
  ev.push({ k: 'hide', round: s.round, at: s.start });
  ev.push({ k: 'announce', round: s.round, n: announced });
  for (let i = 0; i < n; i++) {
    const a = rng.int(0, LOCKERS - 1);
    const b = (a + rng.int(1, LOCKERS - 1)) % LOCKERS;
    if (s.pos === a) s.pos = b; else if (s.pos === b) s.pos = a;
    ev.push({ k: 'swap', a, b });
  }
  s.announced = announced;
  s.counted = n;
  if (cheat && !s.tellDone) {
    s.tellDone = true;
    clues.push({ channel: 'tell', round: s.round, key: 'duel.ls.tell.hum' });
  } else if (!cheat && plan.kind !== KIND && !s.decoyDone && s.round === plan.detail.decoy) {
    s.decoyDone = true;                                // an honest hum
    clues.push({ channel: 'tell', round: s.round, key: 'duel.ls.tell.hum' });
  }
}

export function step(st: DuelState, actor: Side, action: LSAction, plan: CheatPlan): { state: LSState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as LSState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  if (s.done || s.turn !== actor) throw new Error('lockershuffle: not your turn');
  if (action.k === 'shuffle') {
    if (actor !== 'rival') throw new Error('lockershuffle: only Mimosa shuffles');
    shuffle(s, plan, ev, clues);
    s.turn = 'player';
  } else {
    if (actor !== 'player' || action.i < 0 || action.i >= LOCKERS) throw new Error('lockershuffle: bad pick');
    const cheat = armed(s, plan);
    if (cheat && s.pos === action.i) {                   // the spare key: the prize is never under your locker
      const rng = createRng(hashSeed(s.seed, 'key', s.round));
      s.pos = (action.i + rng.int(1, LOCKERS - 1)) % LOCKERS;
    }
    const found = s.pos === action.i;
    ev.push({ k: 'open', round: s.round, pick: action.i, at: s.pos, found });
    if (cheat) {
      s.cheated = true;
      if (!s.tableDone) { s.tableDone = true; clues.push({ channel: 'table', round: s.round, key: 'duel.ls.table.warm', data: { locker: LETTER[action.i] } }); }
      if (!s.mathDone) { s.mathDone = true; clues.push({ channel: 'math', round: s.round, key: 'duel.ls.math.swaps', data: { announced: s.announced, counted: s.counted } }); }
    }
    const winner: Side = found ? 'player' : 'rival';
    s.roundWins[winner]++;
    ev.push({ k: 'roundEnd', round: s.round, winner });
    if (s.roundWins[winner] >= ROUNDS_TO_WIN || s.round >= ROUNDS_MAX) {
      s.done = true;
      s.winner = winner;
      s.pay = winner === 'player' ? POT : 0;
      ev.push({ k: 'end' });
    } else {
      s.round++;
      s.turn = 'rival';
      ev.push({ k: 'round', round: s.round });
    }
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

/** The player: follows the prize through the swaps (a slip loses it), else guesses. Same policy for both bots. */
export function pickMove(st: DuelState, _me: Side = 'player'): LSAction {
  const s = st as LSState;
  const rng = createRng(hashSeed(s.seed, 'bot', s.round));
  const tracked = rng.chance((1 - SLIP) ** s.counted);
  return { k: 'pick', i: tracked ? s.pos : rng.int(0, LOCKERS - 1) };
}

export const rivalAct = (): LSAction => ({ k: 'shuffle' });

export function call(st: DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  return { correct: plan.kind === KIND && (st as LSState).cheated && t === CALL_KEY };
}

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as LSState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.ls.reveal.saw', happened: 'duel.ls.reveal.happened', why: 'duel.ls.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.ls.fair.saw', happened: 'duel.ls.fair.happened', why: 'duel.ls.fair.why' };

// ── HUD hooks ─────────────────────────────────────────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');

export const describeAction = (a: LSAction): TextRef => (a.k === 'pick' ? { key: 'duel.ls.act.pick', data: { locker: LETTER[a.i] } } : { key: 'duel.ls.act.shuffle' });

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; at?: number; n?: number; a?: number; b?: number; pick?: number; found?: boolean; winner?: Side; round?: number };
  switch (o.k) {
    case 'hide': return { key: 'duel.ls.ev.hide', data: { locker: LETTER[o.at!], round: o.round } };
    case 'announce': return { key: 'duel.ls.ev.announce', data: { n: o.n } };
    case 'swap': return { key: 'duel.ls.ev.swap', data: { a: LETTER[o.a!], b: LETTER[o.b!] } };
    case 'open': return { key: o.found ? 'duel.ls.ev.openHit' : 'duel.ls.ev.openMiss', data: { pick: LETTER[o.pick!], at: LETTER[o.at!] } };
    case 'roundEnd': return { key: `duel.ls.ev.roundEnd${who(o.winner!)}`, data: { round: o.round } };
    case 'round': return { key: 'duel.ls.ev.round', data: { round: o.round } };
    default: return { key: 'duel.ls.ev.end' };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as LSState;
  const lines: TextRef[] = [{ key: 'duel.ls.line.score', data: { you: s.roundWins.player, him: s.roundWins.rival, round: s.round } }];
  if (s.turn === 'player' && s.counted > 0) lines.push({ key: 'duel.ls.line.shuffle', data: { start: LETTER[s.start], n: s.announced } });
  return lines;
}

/**
 * Three lockers. Once she has shuffled, the one the prize started under is marked (she showed it) and the announced swap count is on the
 * note. The real position and the real swap count stay hidden.
 */
export function board(st: DuelState): Board {
  const s = st as LSState;
  const shuffled = s.turn === 'player' && s.counted > 0 && !s.done;
  return {
    zones: [{
      label: { key: 'duel.ls.zone.lockers' },
      pieces: LETTER.map((l, i) => ({ top: lit(l), tone: i, sub: shuffled && i === s.start ? { key: 'duel.ls.start' } : undefined, mark: shuffled && i === s.start ? ('now' as const) : undefined })),
    }],
    score: { you: s.roundWins.player, him: s.roundWins.rival, of: ROUNDS_TO_WIN },
    notes: shuffled ? [{ key: 'duel.ls.note.count', data: { start: LETTER[s.start], n: s.announced } }] : [{ key: 'duel.ls.note.round', data: { round: s.round, rounds: ROUNDS_MAX } }],
  };
}

export const callTargets = (): CallTarget[] => [{ target: CALL_KEY, label: { key: 'duel.ls.call' } }];

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const lockerShuffle: DuelRules<LSAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict,
  turnOf: (s) => (s as LSState).turn,
  describeAction, describeEvent, describe, callTargets, board, goal: 'duel.ls.goal',
  playHeadless: (seed, policy) => runHeadless<LSAction>({
    rules: lockerShuffle,
    move: (s) => pickMove(s),
    target: () => CALL_KEY,
  }, seed, policy),
};
