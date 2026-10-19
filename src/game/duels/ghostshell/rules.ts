/**
 * Ghost Shell (Lucan Morrow, "Seventh Chamber"): a 1v1 duel on the Devil's Table SHELLS rules, no items
 * (WAVE25_TALLY section B). Round sizes (charges, shell counts), `ROUNDS_TO_WIN` and the rake come from
 * `src/machines/devilstable/rules.ts`.
 *
 * Rules: first to 2 round wins. Lucan, the house, shoots first in every round. Before every load he announces "N live, M blank" aloud and the tray shows the
 * shells one at a time. You fire the chamber at him or at yourself; a LIVE shell costs a charge, a BLANK at yourself
 * keeps your turn. The round ends when a side is out of charges. The winner takes 2 stakes minus the rake.
 *
 * The cheat ("the Ghost", plan kind `k-gs`): in round 2 or 3, on the first load, he loads one shell more than he
 * announced, and the extra shell is LIVE, slotted where it will come up on his own turn. He knows the true counts and
 * where his shell sits, you only know what he said. Clues:
 *   TELL  he loads without breathing, eyes on you        (at the load)
 *   TABLE the tray animation places N+1 shells, a spare bead glints      (at the load)
 *   MATH  the chamber still clicks after the announced count has run out (the shot that overruns the count, or the
 *         moment the count reads 0 with a shell left, or the Bench opening the chamber when the round ends)
 * Call: C, then GHOST. The call can be made from the load on.
 *
 * Host only: the state holds the magazine order. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { ROUNDS_TO_WIN, ROUND_CHARGES, ROUND_SHELLS } from '@/machines/devilstable/rules';
import { FAIR_KIND, POT, lit, runHeadless, settleNet, other, type Side, type TurnState } from '../gamekit';
import type { Board, CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, TextRef } from '../types';

export const ID = 'ghostshell';
export const RIVAL = 'lucan';
export const KIND = 'k-gs';
export const CHEAT_RATE = 0.22;
export const CALL_GHOST = 'GHOST';

export type GSAction = { k: 'fire'; at: 'foe' | 'self' };
type Shell = 'L' | 'B';

export interface GSState extends TurnState {
  roundWins: Record<Side, number>;
  charges: Record<Side, number>;
  /** Magazine, chamber first. Order is hidden from everybody (host only). */
  mag: Shell[];
  /** What Lucan announced, minus what has been fired (the tray counters everybody sees). */
  ann: { live: number; blank: number };
  loads: number;
  cheated: boolean;
  /** The Math clue has been given. */
  mathDone: boolean;
  /** The cheat load happened in the current round. */
  roundCheat: boolean;
  /** Where the extra LIVE shell sits in the magazine (0 = chamber), -1 when none / spent. Lucan loaded it, so he knows. */
  extraAt: number;
}

export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  if (rng.chance(CHEAT_RATE)) return { kind: KIND, round: rng.chance(0.75) ? 2 : 3, detail: {} };
  return { kind: FAIR_KIND, round: 0, detail: { decoy: rng.chance(0.5) ? rng.int(2, 3) : 0 } };
}

const clone = (s: GSState): GSState => ({
  ...s, roundWins: { ...s.roundWins }, charges: { ...s.charges }, mag: s.mag.slice(), ann: { ...s.ann }, log: s.log.slice(),
});

/** Loads a fresh magazine. The cheat adds one LIVE shell to the real magazine and leaves the announcement alone. */
function load(s: GSState, plan: CheatPlan, ev: unknown[], clues: Clue[]): void {
  const rng = createRng(hashSeed(s.seed, 'load', s.loads++));
  const [lo, hi] = ROUND_SHELLS[s.round - 1];
  const n = rng.int(lo, hi);
  let live = Math.floor(n / 2);
  if (n % 2 === 1 && rng.chance(0.5)) live++;
  live = Math.min(n - 1, Math.max(1, live));
  const shells: Shell[] = [];
  for (let i = 0; i < n; i++) shells.push(i < live ? 'L' : 'B');
  const cheat = plan.kind === KIND && s.round === plan.round && !s.cheated;
  rng.shuffle(shells);
  s.extraAt = -1;
  if (cheat) {
    // he slots the extra LIVE shell where it will come up on his own turn (shots alternate), a spot of his choosing
    const spots: number[] = [];
    for (let i = 0; i <= n; i++) if ((i % 2 === 0) === (s.turn === 'rival')) spots.push(i);
    s.extraAt = rng.pick(spots);
    shells.splice(s.extraAt, 0, 'L');
  }
  s.mag = shells;
  s.ann = { live, blank: n - live };
  ev.push({ k: 'load', round: s.round, live, blank: n - live, placed: shells.length });
  if (cheat) {
    s.cheated = true;
    s.roundCheat = true;
    clues.push({ channel: 'tell', round: s.round, key: 'duel.gs.tell.breath' });
    clues.push({ channel: 'table', round: s.round, key: 'duel.gs.table.nine', data: { announced: n, placed: n + 1 } });
  }
}

function startRound(s: GSState, plan: CheatPlan, ev: unknown[], clues: Clue[]): void {
  s.charges = { player: ROUND_CHARGES[s.round - 1], rival: ROUND_CHARGES[s.round - 1] };
  s.turn = 'rival';
  s.roundCheat = false;
  ev.push({ k: 'round', round: s.round, charges: s.charges.player });
  load(s, plan, ev, clues);
  if (plan.kind !== KIND && s.round === plan.detail.decoy) clues.push({ channel: 'tell', round: s.round, key: 'duel.gs.tell.breath' });   // decoy: a quiet Lucan, honest count
}

export function init(seed: number, plan: CheatPlan, stake: number): GSState {
  const s: GSState = {
    seed, stake, round: 1, turn: 'player', pay: 0, done: false, log: [],
    roundWins: { player: 0, rival: 0 }, charges: { player: 0, rival: 0 }, mag: [], ann: { live: 0, blank: 0 }, loads: 0,
    cheated: false, mathDone: false, roundCheat: false, extraAt: -1,
  };
  const ev: unknown[] = [];
  startRound(s, plan, ev, []);
  s.log.push(...ev);
  return s;
}

export const legal = (st: DuelState): GSAction[] => {
  const s = st as GSState;
  return s.done || s.turn !== 'player' ? [] : [{ k: 'fire', at: 'foe' }, { k: 'fire', at: 'self' }];
};

export function step(st: DuelState, actor: Side, action: GSAction, plan: CheatPlan): { state: GSState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as GSState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  if (s.done || s.turn !== actor || s.mag.length === 0) throw new Error('ghostshell: cannot fire now');
  const shell = s.mag.shift()!;
  if (s.extraAt >= 0) s.extraAt--;
  const live = shell === 'L';
  const tgt: Side = action.at === 'self' ? actor : other(actor);
  // the tray counters: a shell of a kind whose count already reads 0 is the Math clue
  const kind = live ? 'live' : 'blank';
  if (s.ann[kind] > 0) s.ann[kind]--;
  else if (s.cheated && !s.mathDone) {
    s.mathDone = true;
    clues.push({ channel: 'math', round: s.round, key: 'duel.gs.math.click', data: { announced: 0, kind } });
  }
  if (live) s.charges[tgt] = Math.max(0, s.charges[tgt] - 1);
  ev.push({ k: 'shot', by: actor, at: action.at, live, charges: [s.charges.player, s.charges.rival] });
  const keep = !live && tgt === actor;
  const out = s.charges.player <= 0 ? 'rival' : s.charges.rival <= 0 ? 'player' : null;
  if (out) {
    if (s.cheated && !s.mathDone && s.roundCheat && s.mag.length > s.ann.live + s.ann.blank) {
      s.mathDone = true;
      clues.push({ channel: 'math', round: s.round, key: 'duel.gs.math.tray', data: { announced: s.ann.live + s.ann.blank, chambered: s.mag.length } });
    }
    s.roundWins[out]++;
    ev.push({ k: 'roundEnd', round: s.round, winner: out });
    if (s.roundWins[out] >= ROUNDS_TO_WIN || s.round >= ROUND_CHARGES.length) {
      s.done = true;
      s.winner = out;
      s.pay = out === 'player' ? POT : 0;
      ev.push({ k: 'end' });
    } else {
      s.round++;
      startRound(s, plan, ev, clues);
    }
  } else {
    if (!keep) s.turn = other(actor);
    if (s.mag.length === 0) load(s, plan, ev, clues);
    else if (s.cheated && !s.mathDone && s.ann.live + s.ann.blank === 0) {           // the count is spent and the chamber still clicks
      s.mathDone = true;
      clues.push({ channel: 'math', round: s.round, key: 'duel.gs.math.click', data: { announced: 0, chambered: s.mag.length } });
    }
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

/** Both sides shoot the same way: the foe unless the live odds are below half. The rival reads the REAL magazine counts. */
export function pickMove(s: GSState, me: Side): GSAction {
  let live: number, total: number;
  if (me === 'rival') {
    if (s.extraAt === 0) return { k: 'fire', at: 'foe' };                               // the shell he slipped in is next: live, for sure
    live = s.mag.filter((x) => x === 'L').length; total = s.mag.length;
    if (s.extraAt > 0) { live--; total--; }                                                // read the rest without it
  }
  else { live = s.ann.live; total = s.ann.live + s.ann.blank; }
  const p = total > 0 ? live / total : 0.5;
  return { k: 'fire', at: p >= 0.5 ? 'foe' : 'self' };
}

export const rivalAct = (st: DuelState): GSAction => pickMove(st as GSState, 'rival');

export function call(st: DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  return { correct: plan.kind === KIND && (st as GSState).cheated && t === CALL_GHOST };
}

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as GSState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.gs.reveal.saw', happened: 'duel.gs.reveal.happened', why: 'duel.gs.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.gs.fair.saw', happened: 'duel.gs.fair.happened', why: 'duel.gs.fair.why' };

// ── HUD hooks ─────────────────────────────────────────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');

export const describeAction = (a: GSAction): TextRef => ({ key: a.at === 'foe' ? 'duel.gs.act.foe' : 'duel.gs.act.self' });

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: Side; at?: string; live?: boolean; winner?: Side; round?: number; blank?: number; placed?: number; charges?: number[] };
  switch (o.k) {
    case 'load': return { key: 'duel.gs.ev.load', data: { live: o.live, blank: o.blank } };
    case 'round': return { key: 'duel.gs.ev.round', data: { round: o.round, charges: o.charges } };
    case 'shot': return { key: `duel.gs.ev.shot${who(o.by!)}${o.at === 'self' ? 'Self' : 'Foe'}${o.live ? 'Live' : 'Blank'}`, data: { you: o.charges![0], him: o.charges![1] } };
    case 'roundEnd': return { key: `duel.gs.ev.roundEnd${who(o.winner!)}`, data: { round: o.round } };
    default: return { key: 'duel.gs.ev.end' };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as GSState;
  return [
    { key: 'duel.gs.line.charges', data: { you: s.charges.player, him: s.charges.rival, wins: s.roundWins.player, hisWins: s.roundWins.rival } },
    { key: 'duel.gs.line.tray', data: { live: s.ann.live, blank: s.ann.blank } },
  ];
}

/** What Lucan announced for the tray (live and blank left on his count, not the real magazine) and both sides' charges. */
export function board(st: DuelState): Board {
  const s = st as GSState;
  return {
    zones: [
      { label: { key: 'duel.gs.zone.tray' }, pieces: [{ top: lit(s.ann.live), sub: { key: 'duel.gs.live' }, tone: 0 }, { top: lit(s.ann.blank), sub: { key: 'duel.gs.blank' }, tone: 1 }] },
      { label: { key: 'duel.gs.zone.charges' }, pieces: [{ top: lit(s.charges.player), sub: { key: 'duel.gs.you' }, mark: 'mine' }, { top: lit(s.charges.rival), sub: { key: 'duel.gs.him' }, mark: 'his' }] },
    ],
    score: { you: s.roundWins.player, him: s.roundWins.rival, of: ROUNDS_TO_WIN },
  };
}

export const callTargets = (): CallTarget[] => [{ target: CALL_GHOST, label: { key: 'duel.gs.call' } }];

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const ghostShell: DuelRules<GSAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict,
  turnOf: (s) => (s as GSState).turn,
  describeAction, describeEvent, describe, callTargets, board, goal: 'duel.gs.goal',
  playHeadless: (seed, policy) => runHeadless<GSAction>({
    rules: ghostShell,
    move: (s) => pickMove(s as GSState, 'player'),
    target: () => CALL_GHOST,
  }, seed, policy),
};
