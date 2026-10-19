/**
 * Steam Count (Kuro Brandt, "Brass Saint"): a dice duel on a shared pressure gauge (WAVE25_TALLY section C).
 *
 * Rules: first to 3 of 5 rounds. The gauge starts at 0 each round and the sides alternate (the player opens the odd
 * rounds). On your turn either ROLL 2d6 and add the sum to the gauge, or VENT. A roll that takes the gauge past 99
 * blows it and the roller loses the round. VENT releases the pressure and banks coins out of the pot, but the
 * venter gives up the round: bank = gauge x VENT_UNIT x S. VENT_UNIT is S/10 per ten gauge points on a "vent unit" of
 * S/50 (the spec's gauge x S/10 would out-pay the whole pot), so a vent at 90 banks 0.18 S. The match winner takes what
 * is left of the pot (2 stakes minus the rake, minus both banks); the banks go to whoever vented.
 *
 * The cheat ("Lead Die", plan kind `k-sc`): from a hidden round (2 or 3) onward, whenever the gauge is above 70,
 * Kuro's roll always totals 5 or less. Clues:
 *   TELL  steam hisses from his cup                       (his first loaded roll)
 *   TABLE the gauge needle shudders whenever he rolls     (his first loaded roll)
 *   MATH  three low sums in a row above 70, about 3% likely if he were honest (his third loaded roll in a row; if
 *         the round ends first, the Tally Sheet gives it when the round closes)
 * Call: C, then LOADED DICE.
 *
 * Host only: the state holds the roll counter. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import { FAIR_KIND, POT, lit, runHeadless, settleNet, other, type Side, type TurnState } from '../gamekit';
import type { Board, CallTarget, CheatPlan, Clue, DuelRules, DuelState, Piece, RevealScript, TextRef } from '../types';

export const ID = 'steamcount';
export const RIVAL = 'kuro';
export const KIND = 'k-sc';
export const CHEAT_RATE = 0.2;
export const CALL_DICE = 'LOADED DICE';

export const BLOW = 99;
export const HOT = 70;
export const LOW_SUM = 5;
export const ROUNDS_MAX = 5;
export const ROUNDS_TO_WIN = 3;
/** Stake fraction one gauge point banks when vented (S/10 per ten points on a vent unit of S/50). */
export const VENT_UNIT = 1 / 500;

/** Blow chance at which the naive player vents. Kuro is bolder (0.8-0.95): he rolls almost to the wall. */
export const PLAYER_LIMIT = 0.34;

export type SCAction = { k: 'roll' } | { k: 'vent' };

export interface SCState extends TurnState {
  roundWins: Record<Side, number>;
  gauge: number;
  rolls: number;
  /** Banked vents, in stakes. */
  bank: Record<Side, number>;
  /** The lead die has shown itself (host only). */
  cheated: boolean;
  /** Consecutive low sums Kuro rolled above 70 (counts across rounds). */
  streak: number;
  mathDone: boolean;
  decoyDone: boolean;
}

export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  if (rng.chance(CHEAT_RATE)) return { kind: KIND, round: rng.int(2, 3), detail: {} };
  return { kind: FAIR_KIND, round: 0, detail: { decoy: rng.chance(0.5) ? rng.int(2, 4) : 0 } };
}

export function init(seed: number, _plan: CheatPlan, stake: number): SCState {
  return {
    seed, stake, round: 1, turn: 'player', pay: 0, done: false, log: [],
    roundWins: { player: 0, rival: 0 }, gauge: 0, rolls: 0, bank: { player: 0, rival: 0 },
    cheated: false, streak: 0, mathDone: false, decoyDone: false,
  };
}

export const legal = (st: DuelState): SCAction[] => {
  const s = st as SCState;
  if (s.done || s.turn !== 'player') return [];
  return s.gauge > 0 ? [{ k: 'roll' }, { k: 'vent' }] : [{ k: 'roll' }];
};

const clone = (s: SCState): SCState => ({ ...s, roundWins: { ...s.roundWins }, bank: { ...s.bank }, log: s.log.slice() });

/** Chance a 2d6 roll takes a gauge at `g` past 99. */
export function blowChance(g: number): number {
  const need = BLOW - g;                       // a sum above `need` blows
  if (need < 2) return 1;
  if (need >= 12) return 0;
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b > need) n++;
  return n / 36;
}

/** 2d6, or for the lead die one of the ten pairs that sum to 5 or less. */
function dice(s: SCState, loaded: boolean): [number, number] {
  const rng = createRng(hashSeed(s.seed, 'dice', s.rolls));
  if (!loaded) return [rng.int(1, 6), rng.int(1, 6)];
  const pairs: Array<[number, number]> = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b <= LOW_SUM) pairs.push([a, b]);
  return rng.pick(pairs);
}

/** Ends the round: `loser` blew or vented. Starts the next round, or ends the match. */
function endRound(s: SCState, loser: Side, ev: unknown[], clues: Clue[], plan: CheatPlan): void {
  const winner = other(loser);
  s.roundWins[winner]++;
  ev.push({ k: 'roundEnd', round: s.round, winner });
  if (s.cheated && !s.mathDone) {                // the Tally Sheet closes the round: the low sums above 70 are on it
    s.mathDone = true;
    clues.push({ channel: 'math', round: s.round, key: 'duel.sc.math.low', data: { streak: s.streak, odds: 3 } });
  }
  if (s.roundWins[winner] >= ROUNDS_TO_WIN || s.round >= ROUNDS_MAX) {
    s.done = true;
    s.winner = s.roundWins.player === s.roundWins.rival ? undefined : s.roundWins.player > s.roundWins.rival ? 'player' : 'rival';
    const rest = Math.max(0, POT - s.bank.player - s.bank.rival);
    s.pay = s.bank.player + (s.winner === 'player' ? rest : s.winner === undefined ? rest / 2 : 0);
    ev.push({ k: 'end' });
    return;
  }
  s.round++;
  s.gauge = 0;
  s.turn = s.round % 2 === 1 ? 'player' : 'rival';
  ev.push({ k: 'round', round: s.round });
  void plan;
}

export function step(st: DuelState, actor: Side, action: SCAction, plan: CheatPlan): { state: SCState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as SCState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  if (s.done || s.turn !== actor) throw new Error('steamcount: not your turn');
  if (action.k === 'vent') {
    if (s.gauge <= 0) throw new Error('steamcount: nothing to vent');
    const bank = s.gauge * VENT_UNIT;
    s.bank[actor] += bank;
    ev.push({ k: 'vent', by: actor, gauge: s.gauge, coins: Math.round(bank * s.stake) });
    endRound(s, actor, ev, clues, plan);
  } else {
    const isCheat = plan.kind === KIND;
    const hot = s.gauge > HOT;
    const loaded = actor === 'rival' && isCheat && s.round >= plan.round && hot;
    const [a, b] = dice(s, loaded);
    s.rolls++;
    const sum = a + b;
    if (actor === 'rival' && hot) s.streak = sum <= LOW_SUM ? s.streak + 1 : 0;
    if (loaded && !s.cheated) {
      s.cheated = true;
      clues.push({ channel: 'tell', round: s.round, key: 'duel.sc.tell.hiss' });
      clues.push({ channel: 'table', round: s.round, key: 'duel.sc.table.needle' });
    } else if (actor === 'rival' && !isCheat && !s.decoyDone && s.round === plan.detail.decoy && s.gauge > HOT - 10) {
      s.decoyDone = true;                              // an honest cup hisses too
      clues.push({ channel: 'tell', round: s.round, key: 'duel.sc.tell.hiss' });
    }
    if (loaded && !s.mathDone && s.streak >= 3) {
      s.mathDone = true;
      clues.push({ channel: 'math', round: s.round, key: 'duel.sc.math.low', data: { streak: s.streak, odds: 3 } });
    }
    s.gauge += sum;
    ev.push({ k: 'roll', by: actor, a, b, sum, gauge: s.gauge });
    if (s.gauge > BLOW) { ev.push({ k: 'blow', by: actor }); endRound(s, actor, ev, clues, plan); }
    else s.turn = other(actor);
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

/** Both sides: roll unless the roll is too likely to blow. Kuro's limit varies a little with the seed. The lead die knows it is safe. */
export function pickMove(s: SCState, me: Side, limit = PLAYER_LIMIT, safeLow = false): SCAction {
  if (s.gauge <= 0) return { k: 'roll' };
  const q = safeLow && s.gauge > HOT && s.gauge + LOW_SUM <= BLOW ? 0 : blowChance(s.gauge);
  return q >= limit ? { k: 'vent' } : { k: 'roll' };
}

export function rivalAct(st: DuelState, plan: CheatPlan, seed: number): SCAction {
  const s = st as SCState;
  const limit = 0.8 + 0.15 * createRng(seed).next();
  return pickMove(s, 'rival', limit, plan.kind === KIND && s.round >= plan.round);
}

export function call(st: DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  return { correct: plan.kind === KIND && (st as SCState).cheated && t === CALL_DICE };
}

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as SCState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.sc.reveal.saw', happened: 'duel.sc.reveal.happened', why: 'duel.sc.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.sc.fair.saw', happened: 'duel.sc.fair.happened', why: 'duel.sc.fair.why' };

// ── HUD hooks ─────────────────────────────────────────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');

export const describeAction = (a: SCAction): TextRef => ({ key: a.k === 'roll' ? 'duel.sc.act.roll' : 'duel.sc.act.vent' });

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: Side; a?: number; b?: number; sum?: number; gauge?: number; coins?: number; winner?: Side; round?: number };
  switch (o.k) {
    case 'roll': return { key: `duel.sc.ev.roll${who(o.by!)}`, data: { a: o.a, b: o.b, sum: o.sum, gauge: o.gauge } };
    case 'vent': return { key: `duel.sc.ev.vent${who(o.by!)}`, data: { gauge: o.gauge, coins: o.coins } };
    case 'blow': return { key: `duel.sc.ev.blow${who(o.by!)}` };
    case 'roundEnd': return { key: `duel.sc.ev.roundEnd${who(o.winner!)}`, data: { round: o.round } };
    case 'round': return { key: 'duel.sc.ev.round', data: { round: o.round } };
    default: return { key: 'duel.sc.ev.end' };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as SCState;
  return [
    { key: 'duel.sc.line.gauge', data: { gauge: s.gauge, left: Math.max(0, BLOW - s.gauge), vent: Math.round(s.gauge * VENT_UNIT * s.stake) } },
    { key: 'duel.sc.line.score', data: { you: s.roundWins.player, him: s.roundWins.rival, round: s.round } },
  ];
}

/** The gauge as a bar, the last roll as two dice (public: both sides watch it), the round score. */
export function board(st: DuelState): Board {
  const s = st as SCState;
  const last = [...s.log].reverse().find((e) => (e as { k?: string }).k === 'roll') as { by: Side; a: number; b: number } | undefined;
  const dice: Piece[] = s.gauge > 0 && last ? [last.a, last.b].map((n) => ({ top: lit(n), mark: last.by === 'player' ? ('mine' as const) : ('his' as const) })) : [];
  return {
    zones: dice.length ? [{ label: { key: 'duel.sc.zone.dice', data: { sum: (last?.a ?? 0) + (last?.b ?? 0) } }, pieces: dice }] : [],
    meter: { label: { key: 'duel.sc.zone.gauge', data: { gauge: s.gauge } }, value: s.gauge, max: BLOW, danger: HOT },
    score: { you: s.roundWins.player, him: s.roundWins.rival, of: ROUNDS_TO_WIN },
    notes: [{ key: 'duel.sc.note.vent', data: { left: Math.max(0, BLOW - s.gauge), vent: Math.round(s.gauge * VENT_UNIT * s.stake) } }],
  };
}

export const callTargets = (): CallTarget[] => [{ target: CALL_DICE, label: { key: 'duel.sc.call' } }];

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const steamCount: DuelRules<SCAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict,
  turnOf: (s) => (s as SCState).turn,
  describeAction, describeEvent, describe, callTargets, board, goal: 'duel.sc.goal',
  playHeadless: (seed, policy) => runHeadless<SCAction>({
    rules: steamCount,
    move: (s) => pickMove(s as SCState, 'player'),
    target: () => CALL_DICE,
  }, seed, policy),
};
