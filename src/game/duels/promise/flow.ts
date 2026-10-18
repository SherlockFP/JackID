/**
 * ADA'S KITCHEN TABLE, the flow (no DOM, no clock of its own): one Rock, Paper, Promise match between the player (side `a`)
 * and Ada (side `b`), driven by key presses and `update(dt)` on the sim step. Ada calls first. Cracks only count here
 * (`crackLoses: false`): they cost the dishes, not the match. The view is plain data; `kitchen.ts` draws it.
 *
 * Phases: intro -> (promise) -> throw -> reveal -> between -> ... -> end. Escape leaves at any time with nothing earned.
 */
import { hashSeed } from '@/core/rng';
import {
  ADA, HANDS, aiAnswer, aiCall, createMatch, playRound,
  type AiCall, type Hand, type PromiseState, type Profile, type RoundLog,
} from './rules';

export type Stake = 'dishes' | 'truth' | 'kiss';
export const STAKES: readonly Stake[] = ['dishes', 'truth', 'kiss'];
export const stakeFor = (seed: number, night: number): Stake => STAKES[hashSeed(seed, night, 'kitchen.stake') % STAKES.length];

export const INTRO_SEC = 1.2;
export const TELL_SEC = 0.6;
export const REVEAL_SEC = 1.1;
export const BETWEEN_SEC = 1.9;

export type Phase = 'intro' | 'promise' | 'throw' | 'reveal' | 'between' | 'end' | 'closed';

/** An i18n key (under `promise.`) with variables; a var that starts with `promise.` is translated by the view. */
export interface Ref { key: string; vars?: Record<string, string | number> }

export interface FlowView {
  phase: Phase;
  goal: number;
  score: { you: number; ada: number };
  cracks: { you: number; ada: number };
  stake: Stake;
  /** The line that says what to do now. */
  head: Ref | null;
  /** What was said and what happened (newest last). */
  lines: Ref[];
  /** The hands 1/2/3 can be pressed now. */
  pick: boolean;
  /** The match is over and E closes it. */
  finish: boolean;
}

export interface FlowResult {
  /** The player left before the end: nothing is earned. */
  left: boolean;
  winner: 'you' | 'ada' | 'none';
  stake: Stake;
  /** The player made at least one promise and never broke one. */
  kept: boolean;
  points: { you: number; ada: number };
  cracks: { you: number; ada: number };
  rounds: number;
}

export interface FlowIO {
  render(v: FlowView): void;
  /** An inner-monologue line (the tell). `key` is under `promise.`. */
  inner(key: string): void;
  /** The player's hand throws (the first-person pose). */
  playHand(h: Hand): void;
  done(r: FlowResult): void;
}

export interface FlowOpts { seed: number; stake: Stake; goal?: number; profile?: Profile }

export interface Flow {
  /** 1 rock, 2 paper, 3 scissors. */
  press(n: number): void;
  /** E / Enter at the end. */
  confirm(): void;
  leave(): void;
  update(dt: number): void;
  view(): FlowView;
  state(): PromiseState;
  phase(): Phase;
}

const handRef = (h: Hand): string => `promise.hand.${h}`;

export function createFlow(o: FlowOpts, io: FlowIO): Flow {
  const ada = o.profile ?? ADA;
  let st = createMatch({ goal: o.goal ?? 3, first: 'b', crackLoses: false });
  let phase: Phase = 'intro';
  let t = 0;
  let lines: Ref[] = [{ key: 'promise.rules' }, { key: 'kitchen.stake', vars: { stake: `promise.stake.${o.stake}` } }];
  let call: AiCall | null = null;
  let tellSent = false;
  let myPromise: Hand | null = null;
  let myThrow: Hand | null = null;
  let myCalls = 0;
  let myCracks = 0;
  let tellCount = 0;
  let head: Ref | null = null;

  const view = (): FlowView => ({
    phase, goal: st.goal, stake: o.stake, head, lines: lines.slice(-4),
    score: { you: st.seats.a.points, ada: st.seats.b.points },
    cracks: { you: st.seats.a.cracks, ada: st.seats.b.cracks },
    pick: phase === 'promise' || phase === 'throw',
    finish: phase === 'end',
  });
  const push = (): void => { if (phase !== 'closed') io.render(view()); };

  const startRound = (): void => {
    t = 0; tellSent = false; myPromise = null; myThrow = null; call = null;
    if (st.caller === 'b') {
      call = aiCall(st, 'b', ada, o.seed);
      lines = [{ key: 'promise.ada.promise', vars: { hand: handRef(call.promise) } }];
      head = { key: 'promise.turn.throw.ada', vars: { hand: handRef(call.promise) } };
      phase = 'throw';
    } else {
      lines = [];
      head = { key: 'promise.turn.promise' };
      phase = 'promise';
    }
    push();
  };

  const resolve = (): void => {
    if (!myThrow) return;
    const input = st.caller === 'a'
      ? { promise: myPromise ?? myThrow, callerThrow: myThrow, answerThrow: aiAnswer(st, 'b', ada, myPromise ?? myThrow, o.seed) }
      : { promise: call?.promise ?? myThrow, callerThrow: call?.throw ?? myThrow, answerThrow: myThrow };
    const adaThrow = st.caller === 'a' ? input.answerThrow : input.callerThrow;
    const { state, entry } = playRound(st, input);
    st = state;
    if (entry.caller === 'a') { myCalls += 1; if (entry.cracked) myCracks += 1; }
    lines = describe(entry, myThrow, adaThrow);
    head = null;
    phase = 'between';
    t = 0;
    push();
  };

  const describe = (e: RoundLog, you: Hand, adaH: Hand): Ref[] => {
    const out: Ref[] = [{ key: 'promise.res.hands', vars: { you: handRef(you), ada: handRef(adaH) } }];
    if (e.winner === null) out.push({ key: 'promise.res.tie' });
    else {
      out.push({ key: e.winner === 'a' ? 'promise.res.win' : 'promise.res.lose', vars: { n: e.points } });
      if (e.kept && e.winner === e.caller) out.push({ key: 'promise.res.kept' });
      const n = 1 + (hashSeed(o.seed, e.round, 'kitchen.say') % 2);
      out.push({ key: e.winner === 'a' ? `promise.ada.beaten.${n}` : `promise.ada.beat.${n}` });
    }
    if (e.cracked) out.push({ key: e.caller === 'a' ? 'promise.res.crack.you' : 'promise.res.crack.ada' });
    return out;
  };

  const finish = (left: boolean): FlowResult => {
    const winner = st.winner === 'a' ? 'you' : st.winner === 'b' ? 'ada' : 'none';
    return {
      left, winner, stake: o.stake, kept: myCalls > 0 && myCracks === 0,
      points: { you: st.seats.a.points, ada: st.seats.b.points }, cracks: { you: st.seats.a.cracks, ada: st.seats.b.cracks },
      rounds: st.log.length,
    };
  };

  const close = (left: boolean): void => {
    if (phase === 'closed') return;
    const r = finish(left);
    phase = 'closed';
    io.done(r);
  };

  const toEnd = (): void => {
    phase = 'end';
    head = { key: st.winner === 'a' ? 'promise.end.win' : st.winner === 'b' ? 'promise.end.lose' : 'promise.end.stall' };
    const fin = finish(false);
    lines = [];
    if (st.winner) lines.push({ key: `promise.end.${o.stake}.${st.winner === 'a' ? 'win' : 'lose'}` });
    lines.push({ key: fin.kept ? 'promise.end.kept' : 'promise.end.broke' });
    push();
  };

  return {
    press(n) {
      const hand = HANDS[Math.floor(n) - 1];
      if (!hand) return;
      if (phase === 'promise') {
        myPromise = hand;
        lines = [{ key: 'promise.you.promise', vars: { hand: handRef(hand) } }];
        head = { key: 'promise.turn.throw.you' };
        phase = 'throw';
        push();
      } else if (phase === 'throw') {
        myThrow = hand;
        io.playHand(hand);
        phase = 'reveal';
        t = 0;
        head = null;
        push();
      }
    },
    confirm() { if (phase === 'end') close(false); },
    leave() { if (phase === 'end') close(false); else close(true); },
    update(dt) {
      if (phase === 'closed') return;
      t += dt;
      if (phase === 'intro' && t >= INTRO_SEC) startRound();
      else if (phase === 'throw' && call?.tell && !tellSent && !myThrow && t >= TELL_SEC) {
        tellSent = true;
        tellCount += 1;
        io.inner(`promise.tell.${1 + ((tellCount - 1 + hashSeed(o.seed, 'kitchen.tell')) % 2)}`);
      } else if (phase === 'reveal' && t >= REVEAL_SEC) resolve();
      else if (phase === 'between' && t >= BETWEEN_SEC) {
        if (st.done) toEnd();
        else startRound();
      }
    },
    view,
    state: () => st,
    phase: () => phase,
  };
}

