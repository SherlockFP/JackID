/**
 * LUCAN'S TABLE: Rock, Paper, Promise as the Night 3 boss duel (docs/STORY_BIBLE.md section 5a and S4). A `DuelRules` for the
 * Tally Table: the player is side `a` of the pure match in `rules.ts`, Lucan Morrow is side `b`. Host-only state, seeded rng only,
 * no DOM, no clock, no Math.random.
 *
 * Rules: first to 4. Callers alternate and Lucan calls first. A caller names a hand (the promise), then throws; a kept word that wins
 * scores 2, any other win 1, a broken word cracks the caller's card, three cracks lose (rules.ts).
 *
 * Lucan keeps his early promises and breaks at the winning throw: when a plain win would end the match he promises one hand and
 * throws the hand that beats the believer's counter. Only a card on its last crack keeps its word.
 *
 * THE CHEAT (plan kind `k-pm`, the watch mirror). The cracked pocket watch shows him your hand under the table edge. On every throw
 * he ANSWERS (the rounds you call) he counters the hand you showed, so he always answers right. Clues:
 *   TELL   he checks the watch before every throw he answers, and never before one he calls   (first answered throw, Gambler's Eye)
 *   TABLE  the glass catches your glove                                                         (second answered throw, Gambler's Eye)
 *   MATH   Tally Sheet: "He answered three of your throws and won three."                      (third answered throw)
 * Call: C, then MIRROR. Right: the match is void in your favour. The call can be made from the first answered throw on.
 *
 * Counter-cheats (the player's own):
 *   PHOTO   the carried photo keepsake is set in front of the watch: the glass shows her, not your hand. The mirror is blind for the
 *           rest of the match and he answers by his own nerve (an ordinary weighted read).
 *   SWITCH  once he has answered (from his second answered throw on) you may change your hand under the table edge. If he looks at
 *           the watch again he sees it: a FOUL, the point is his and your card cracks. His look is the TELL (the watch glints).
 *           If he does not look, the switch stands; it breaks your word (a crack) but the hand has already been answered wrong.
 *
 * Rewards (read by the machine through `rewards`): each kept-word win is one ŞANS star (at most 2 a duel); each crack of yours is
 * one Heat ("broken words travel"). The win pays the boss reward through the run's duel hooks (a Wing Key and Lucan's Pledge).
 */
import { createRng, hashSeed } from '@/core/rng';
import { POT, channelsOf, runHeadless, settleNet, type Side as Who, type TurnState } from '../gamekit';
import type { CallTarget, CheatPlan, Clue, DuelRules, DuelState, RevealScript, TextRef } from '../types';
import {
  HANDS, aiAnswer, counterOf, createMatch, loserTo, playRound,
  type Hand, type Profile, type PromiseState, type RoundLog,
} from './rules';

export const ID = 'promise';
export const RIVAL = 'lucan';
export const KIND = 'k-pm';
export const CALL_MIRROR = 'MIRROR';
/** First to 4 points (STORY_BIBLE 5a). */
export const GOAL = 4;
/** ŞANS stars a duel can pay, and the answered throw from which a late switch is offered. */
export const STAR_CAP = 2;
export const SWITCH_FROM = 2;
/** Chance he looks at the watch again after answering (the late switch is then a foul). */
export const LOOK_RATE = 0.5;
/** Chance he breaks his word at his winning throw, and at an early one. */
export const BREAK_WINNING = 0.85;
export const BREAK_EARLY = 0.12;
/** Answered throws he must have won, in a row from the start, for the Tally Sheet to say so. */
export const MATH_AT = 3;

/** Lucan with the mirror blinded: he reads you by nerve alone. (His calls are written in `lucanCall`.) */
export const LUCAN: Profile = { id: 'lucan', keep: 1, open: null, favour: [1, 1, 1], react: [0.45, 0.4, 0.15], tell: null };

export type PRAction =
  | { k: 'promise'; hand: Hand }
  | { k: 'throw'; hand: Hand }
  | { k: 'photo' }
  | { k: 'hold' }
  | { k: 'switch'; hand: Hand }
  | { k: 'lcall' }
  | { k: 'answer' };

type Phase = 'lcall' | 'promise' | 'throw' | 'answer' | 'late';

export interface PRState extends TurnState {
  m: PromiseState;
  phase: Phase;
  /** The promise on the table this round. */
  promise: Hand | null;
  /** The player's staged throw (own call round: before he answers). */
  mine: Hand | null;
  /** Lucan's committed throw (host only). */
  his: Hand | null;
  /** He looks at the watch again after answering (host only until the TELL rings). */
  looks: boolean;
  /** The watch glass shows your hand. */
  mirror: boolean;
  photo: boolean;
  switched: boolean;
  /** He has answered at least one throw with the mirror live. */
  cheated: boolean;
  ans: number;
  ansWins: number;
  mathDone: boolean;
  /** Rounds the player scored with a kept word. */
  kept: number;
  fouls: number;
}

// ── the player's photo keepsake (set by the machine, read by `legal`) ────────────────────────────────────
let photoSource: () => boolean = () => false;
/** Tells the duel whether the player carries the photo keepsake. Returns a disposer. */
export function setPhotoSource(fn: () => boolean): () => void {
  photoSource = fn;
  return () => { if (photoSource === fn) photoSource = () => false; };
}

// ── setup ────────────────────────────────────────────────────────────────────────────────────────────────
export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  // Lucan always has the mirror: the plan only fixes which of his glances is the first. (Numbers only, so nothing in it can leak as text.)
  return { kind: KIND, round: 2, detail: { glance: rng.int(1, 2) } };
}

const clone = (s: PRState): PRState => ({
  ...s,
  m: { ...s.m, seats: { a: { ...s.m.seats.a }, b: { ...s.m.seats.b } }, log: s.m.log.slice() },
  log: s.log.slice(),
});

export function init(seed: number, _plan: CheatPlan, stake: number): PRState {
  return {
    seed, stake, round: 1, turn: 'rival', pay: 0, done: false, log: [],
    m: createMatch({ goal: GOAL, first: 'b', crackLoses: true }),
    phase: 'lcall', promise: null, mine: null, his: null, looks: false, mirror: true, photo: false, switched: false,
    cheated: false, ans: 0, ansWins: 0, mathDone: false, kept: 0, fouls: 0,
  };
}

const photoOk = (s: PRState): boolean => !s.photo && photoSource();

export function legal(st: DuelState): PRAction[] {
  const s = st as PRState;
  if (s.done || s.turn !== 'player') return [];
  const hands = (k: 'promise' | 'throw'): PRAction[] => HANDS.map((hand) => ({ k, hand }));
  switch (s.phase) {
    case 'promise': return photoOk(s) ? [...hands('promise'), { k: 'photo' }] : hands('promise');
    case 'throw': return photoOk(s) ? [...hands('throw'), { k: 'photo' }] : hands('throw');
    case 'late': {
      const keep = s.mine;
      return [{ k: 'hold' }, ...HANDS.filter((h) => h !== keep).map((hand): PRAction => ({ k: 'switch', hand }))];
    }
    default: return [];
  }
}

// ── Lucan's calls ────────────────────────────────────────────────────────────────────────────────────────
export interface LucanCall { promise: Hand; throw: Hand; /** A plain win ends the match: the throw he breaks at. */ winning: boolean }

/** Keeps early promises; at the winning throw he promises a hand and throws the one that beats whoever believed him. */
export function lucanCall(m: PromiseState, seed: number): LucanCall {
  const rng = createRng(hashSeed(seed, 'lcall', m.round));
  const promise = rng.weighted(HANDS, [1, 1, 1]);
  const winning = m.seats.b.points + 1 >= m.goal;
  const atEdge = m.crackLoses && m.seats.b.cracks >= m.crackLimit - 1;
  // he breaks at the winning throw (almost always) and, now and then, once early: a believer is never safe
  const breaks = rng.chance(winning ? BREAK_WINNING : BREAK_EARLY);
  const keeps = !breaks || atEdge;
  return { promise, throw: keeps ? promise : loserTo(promise), winning };
}

// ── the step ─────────────────────────────────────────────────────────────────────────────────────────────
interface Out { state: PRState; clues: Clue[]; publicEvents: unknown[] }

function settleRound(s: PRState, ev: unknown[], mineFinal: Hand, foul: boolean): void {
  const promise = s.promise ?? mineFinal;
  const his = s.his ?? mineFinal;
  const own = s.m.caller === 'a';
  const mine = foul ? loserTo(his) : mineFinal;       // a foul is a hand that loses to his answer
  const { state, entry } = playRound(s.m, own ? { promise, callerThrow: mine, answerThrow: his } : { promise, callerThrow: his, answerThrow: mine });
  s.m = state;
  let e: RoundLog = entry;
  if (foul && !e.cracked) {                           // the fouled hand happened to be the promise: the foul still cracks
    s.m.seats.a.cracks += 1;
    e = { ...e, cracked: true, kept: false };
    s.m.log[s.m.log.length - 1] = e;
    if (s.m.crackLoses && s.m.seats.a.cracks >= s.m.crackLimit && !s.m.done) { s.m.done = true; s.m.winner = 'b'; s.m.end = 'cracks'; }
  }
  ev.push({ k: 'hands', you: mineFinal, him: his });
  if (e.winner === null) ev.push({ k: 'out', who: 'tie', n: 0 });
  else ev.push({ k: 'out', who: e.winner === 'a' ? 'you' : 'him', n: e.points });
  if (e.kept && e.winner === e.caller) ev.push({ k: 'kept', who: e.caller === 'a' ? 'you' : 'him' });
  if (e.cracked) ev.push({ k: 'crack', who: e.caller === 'a' ? 'you' : 'him' });
  if (e.caller === 'a' && e.kept && e.winner === 'a') s.kept += 1;
  s.mine = null; s.his = null; s.promise = null; s.looks = false;
  s.round = s.m.round;
  if (s.m.done) {
    s.done = true;
    s.winner = s.m.winner === 'a' ? 'player' : 'rival';
    s.pay = s.winner === 'player' ? POT : 0;
    ev.push({ k: 'end', who: s.winner === 'player' ? 'you' : 'him' });
  } else {
    s.phase = s.m.caller === 'a' ? 'promise' : 'lcall';
    s.turn = s.m.caller === 'a' ? 'player' : 'rival';
  }
}

function placePhoto(s: PRState, ev: unknown[]): void {
  s.photo = true;
  s.mirror = false;
  ev.push({ k: 'photo' });
}

function answer(s: PRState, ev: unknown[], clues: Clue[]): void {
  const mine = s.mine ?? 'rock';
  const round = s.m.round;
  if (s.mirror) {
    s.his = counterOf(mine);                           // he sees your hand in the glass: he always answers right
    s.cheated = true;
    s.ans += 1;
    s.ansWins += 1;
    if (s.ans === 1) clues.push({ channel: 'tell', round, key: 'duel.pr.tell.glance', data: { eye: 'watch', line: 'duel.pr.eye.watch' } });
    else if (s.ans === 2) clues.push({ channel: 'table', round, key: 'duel.pr.table.glass', data: { eye: 'glass', line: 'duel.pr.eye.glass', hand: mine } });
    if (!s.mathDone && s.ans >= MATH_AT && s.ansWins === s.ans) {
      s.mathDone = true;
      clues.push({ channel: 'math', round, key: 'duel.pr.math.answered', data: { n: s.ans, won: s.ansWins } });
    }
  } else {
    s.his = aiAnswer(s.m, 'b', LUCAN, s.promise ?? mine, s.seed);
  }
  if (s.mirror && !s.switched && s.ans >= SWITCH_FROM) {
    s.looks = createRng(hashSeed(s.seed, 'look', round)).chance(LOOK_RATE);
    if (s.looks) clues.push({ channel: 'tell', round, key: 'duel.pr.tell.look', data: { eye: 'watch', line: 'duel.pr.eye.look' } });
    s.phase = 'late';
    s.turn = 'player';
    ev.push({ k: 'answered' });
  } else {
    settleRound(s, ev, mine, false);
  }
}

export function step(st: DuelState, actor: Who, action: PRAction, _plan: CheatPlan): Out {
  const s = clone(st as PRState);
  const ev: unknown[] = [];
  const clues: Clue[] = [];
  if (s.done) throw new Error('promise: the match is over');
  if (s.turn !== actor) throw new Error('promise: not your turn');
  if (action.k === 'photo') {
    placePhoto(s, ev);
  } else if (s.phase === 'lcall') {
    const c = lucanCall(s.m, s.seed);
    s.promise = c.promise;
    s.his = c.throw;
    s.phase = 'throw';
    s.turn = 'player';
    ev.push({ k: 'say', by: 'him', hand: c.promise, eye: c.winning ? 1 : 0 });
  } else if (s.phase === 'promise' && action.k === 'promise') {
    s.promise = action.hand;
    s.phase = 'throw';
    ev.push({ k: 'say', by: 'you', hand: action.hand, eye: 0 });
  } else if (s.phase === 'throw' && action.k === 'throw') {
    if (s.m.caller === 'b') settleRound(s, ev, action.hand, false);
    else { s.mine = action.hand; s.phase = 'answer'; s.turn = 'rival'; }
  } else if (s.phase === 'answer') {
    answer(s, ev, clues);
  } else if (s.phase === 'late') {
    if (action.k === 'switch') {
      s.switched = true;
      if (s.looks) { s.fouls += 1; ev.push({ k: 'foul' }); settleRound(s, ev, action.hand, true); }
      else { ev.push({ k: 'switchok' }); settleRound(s, ev, action.hand, false); }
    } else settleRound(s, ev, s.mine ?? 'rock', false);
  } else throw new Error('promise: bad action');
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

export const rivalAct = (st: DuelState): PRAction => ((st as PRState).phase === 'lcall' ? { k: 'lcall' } : { k: 'answer' });

// ── the call, the ruling, the rewards ─────────────────────────────────────────────────────────────────────
export function call(st: DuelState, _plan: CheatPlan, target: unknown): { correct: boolean } {
  const t = typeof target === 'string' ? target : (target as { call?: string } | null)?.call;
  return { correct: (st as PRState).cheated && t === CALL_MIRROR };
}

export const verdict = (st: DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as PRState).cheated ? 'CHEAT' : 'FAIR');

export interface PromiseRewards { stars: number; cracks: number; kept: number }

/** What the table pays besides the stake: ŞANS stars for kept-word wins (max 2) and the player's cracks (Heat, one each). */
export function rewards(st: DuelState): PromiseRewards {
  const s = st as PRState;
  return { stars: Math.min(STAR_CAP, s.kept), cracks: s.m.seats.a.cracks, kept: s.kept };
}

export const reveal: RevealScript = { saw: 'duel.pr.reveal.saw', happened: 'duel.pr.reveal.happened', why: 'duel.pr.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.pr.fair.saw', happened: 'duel.pr.fair.happened', why: 'duel.pr.fair.why' };

// ── HUD hooks ────────────────────────────────────────────────────────────────────────────────────────────
export const describeAction = (a: PRAction): TextRef => {
  switch (a.k) {
    case 'promise': return { key: `duel.pr.act.promise.${a.hand}` };
    case 'throw': return { key: `duel.pr.act.throw.${a.hand}` };
    case 'switch': return { key: `duel.pr.act.switch.${a.hand}` };
    case 'photo': return { key: 'duel.pr.act.photo' };
    case 'hold': return { key: 'duel.pr.act.hold' };
    default: return { key: 'duel.pr.act.wait' };
  }
};

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: string; who?: string; hand?: Hand; you?: Hand; him?: Hand; n?: number; eye?: number };
  switch (o.k) {
    case 'say': return { key: `duel.pr.ev.say.${o.by}.${o.hand}`, data: o.eye ? { eye: 1 } : undefined };
    case 'photo': return { key: 'duel.pr.ev.photo' };
    case 'answered': return { key: 'duel.pr.ev.answered' };
    case 'hands': return { key: `duel.pr.ev.hands.${o.you}.${o.him}` };
    case 'out': return { key: `duel.pr.ev.out.${o.who}`, data: { n: o.n ?? 0 } };
    case 'kept': return { key: `duel.pr.ev.kept.${o.who}` };
    case 'crack': return { key: `duel.pr.ev.crack.${o.who}` };
    case 'foul': return { key: 'duel.pr.ev.foul' };
    case 'switchok': return { key: 'duel.pr.ev.switchok' };
    case 'end': return { key: `duel.pr.ev.end.${o.who}` };
    default: return { text: o.k };
  }
}

export function describe(st: DuelState): TextRef[] {
  const s = st as PRState;
  const out: TextRef[] = [{ key: 'duel.pr.line.score', data: { you: s.m.seats.a.points, him: s.m.seats.b.points, goal: s.m.goal, yc: s.m.seats.a.cracks, hc: s.m.seats.b.cracks } }];
  if (s.phase === 'throw' && s.promise) out.push({ key: `duel.pr.line.${s.m.caller === 'b' ? 'him' : 'you'}.${s.promise}` });
  else if (s.phase === 'late') out.push({ key: 'duel.pr.line.late' });
  else if (s.photo) out.push({ key: 'duel.pr.line.photo' });
  return out;
}

export const callTargets = (): CallTarget[] => [{ target: CALL_MIRROR, label: { key: 'duel.pr.call' } }];

// ── headless (balance runs, tests) ───────────────────────────────────────────────────────────────────────
/** The headless player: promises a seeded hand and keeps its word 85% of the time, believes his promises 60%, doubts 30%. */
export function pickMove(st: DuelState, legalNow: PRAction[]): PRAction {
  const s = st as PRState;
  const rng = createRng(hashSeed(s.seed, 'pm.move', s.m.round, s.phase));
  const hand = (k: 'promise' | 'throw'): Hand => {
    const items = legalNow.filter((a): a is Extract<PRAction, { hand: Hand }> => a.k === k && 'hand' in a);
    return (rng.pick(items) as { hand: Hand }).hand;
  };
  switch (s.phase) {
    case 'promise': return { k: 'promise', hand: hand('promise') };
    case 'throw': {
      if (s.m.caller === 'a') return { k: 'throw', hand: rng.chance(0.85) && s.promise ? s.promise : hand('throw') };
      const p = s.promise ?? 'rock';
      const r = rng.next();
      return { k: 'throw', hand: r < 0.6 ? counterOf(p) : r < 0.9 ? p : loserTo(p) };
    }
    default: return legalNow[0];
  }
}

export const lucanDuel: DuelRules<PRAction> & { verdict: typeof verdict; revealFair: RevealScript; rewards: typeof rewards } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict, rewards,
  turnOf: (s) => (s as PRState).turn,
  describeAction, describeEvent, describe, callTargets,
  playHeadless: (seed, policy) => runHeadless<PRAction>({
    rules: lucanDuel,
    move: (s, l) => pickMove(s, l),
    target: (clues: readonly Clue[]) => (channelsOf(clues).size >= 2 ? CALL_MIRROR : undefined),
  }, seed, policy),
};
