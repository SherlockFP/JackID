/**
 * LOKI'S CHANGE OF HANDS (docs/JOKER.md §4): pure rules for what his hand does, where, and what the Clerk and Orrin make of it.
 * No bus, no DOM, no three. `resolveTakeover` returns plain data; the wiring (J3) plays it. The price (Ink), the limits (a Watch, a
 * run), the unasked roll and the hair tie / coffee counters live in joker.ts, which calls this once a takeover is allowed.
 *
 * His hand never keeps a word and never makes a kept pair, and a round it wins earns no ŞANS star (`tag: 'joker'`, the luck meter
 * ignores that tag). He can win you any game. He can't win you a clean one.
 */
import type { Rng } from '@/core/rng';

export type TakeoverWhere = 'machine' | 'duel' | 'crooked' | 'knock' | 'visit';
/** The Clerk's three rooms, where a takeover is a cheat under Rule 2: the N7 Audit, the N8 kitchen, the Burning Wager. */
export type Witness = 'audit' | 'kitchen' | 'wager';

/** Machines his hand never touches (docs/JOKER.md §4): the cashier, the Debt Terminal and the bell. Never a jackpot either. */
export const NO_TAKEOVER_MACHINES: readonly string[] = ['cashier', 'debt_terminal', 'bell'];
/** A takeover pull pays 10 x the stake, and the stake counts as at most this share of the Night's quota (so at most a quarter of it). */
export const TAKEOVER_MULT = 10;
export const TAKEOVER_STAKE_CAP = 0.025;
/** Orrin watched that hand for years: in the Question a takeover is called one time in two. */
export const ORRIN_CALLS = 0.5;

export type TakeoverAct =
  | 'bigWin'        // machine: this pull is a big win
  | 'winRound'      // duel: he wins one throw or round
  | 'seeCard'       // the Question: you see the other card
  | 'rightPick'     // Locker Shuffle and the Last Count: he makes the right pick
  | 'seeTables'     // Crooked Table: every tell channel fills for all three tables
  | 'visitorLeaves' // the Knock: "Let me get the door."
  | 'orrinStops'    // the Visit: Orrin stops in the hall, still until Dawn
  | 'called'        // Orrin saw the hand: the round is lost
  | 'throwRound'    // spite: he throws the round or the pull
  | 'wrongTable'    // spite: he calls the wrong table
  | 'breakWord'     // spite at Ada's table: he breaks your word to her
  | 'openChain';    // spite at the Knock: he takes the chain off

export interface TakeoverCtx {
  where: TakeoverWhere;
  /** False for an unasked takeover (Ink 6+). */
  asked: boolean;
  /** Unasked only: 'help' or 'spite' (joker.ts rolls it from Trust). An asked takeover is always help. */
  kind?: 'help' | 'spite';
  /** Machine: the machine id, the stake of the pull and the Night's quota. */
  machineId?: string;
  stake?: number;
  quota?: number;
  /** Duel: the game id (promise, thequestion, lockershuffle, lastcount ...) and the rival's id (ada, lucan, orrin ...). */
  duel?: string;
  rival?: string;
  /** Promise: winning this throw breaks the hand you promised, so your card cracks. */
  breaksPromise?: boolean;
  /** The Clerk's room, when the takeover happens in one. */
  witness?: Witness | null;
}

export interface TakeoverResult {
  where: TakeoverWhere;
  asked: boolean;
  kind: 'help' | 'spite';
  act: TakeoverAct;
  /** Coins the pull pays (machine only). */
  payout: number;
  /** Points the throw or round scores for you (Promise: 1, never a kept 2). */
  score: number;
  /** Collector Heat change (the Knock -1, a called takeover +1). */
  heat: number;
  /** Your card cracks (Promise, when the win breaks your promised hand). */
  crack: boolean;
  /** Orrin called it: you lose the round. */
  called: boolean;
  /** The Visit: the missed coins go onto tomorrow's quota. */
  quotaCarry: boolean;
  /** The kitchen win makes Ada go still. */
  adaStill: boolean;
  /** False in front of the Clerk: the wager can't be clean. */
  clean: boolean;
  /** i18n keys spoken in the room, in order (the Clerk's ruling, the Champion's answer, Orrin's call). */
  lines: string[];
  /** The luck meter ignores a round tagged 'joker'. */
  tag: 'joker';
}

/** Whether his hand may touch this machine. */
export const machineAllowed = (machineId: string): boolean => !NO_TAKEOVER_MACHINES.includes(machineId);

/** A takeover pull's payout: exactly 10 x the stake, the stake counted as at most 2.5 % of the quota. Whole coins. */
export function takeoverPayout(stake: number, quota: number): number {
  return Math.floor(TAKEOVER_MULT * Math.min(Math.max(0, stake), TAKEOVER_STAKE_CAP * Math.max(0, quota)));
}

/** The help act for a duel game. Promise scores 1; the Question shows the card; Locker Shuffle and the Last Count make the pick. */
const duelHelp = (duel = ''): TakeoverAct => (duel === 'thequestion' ? 'seeCard' : duel === 'lockershuffle' || duel === 'lastcount' ? 'rightPick' : 'winRound');

export function resolveTakeover(rng: Rng, c: TakeoverCtx): TakeoverResult {
  const calledRoll = rng.next();   // one draw whatever the branch, so a replay stays in step
  const witness = c.witness ?? null;
  // At the N8 kitchen wager help and spite look the same: either way he plays to win. The Burning Wager too.
  const playsToWin = witness === 'kitchen' || witness === 'wager';
  const kind = c.asked || playsToWin ? 'help' : (c.kind ?? 'help');
  const r: TakeoverResult = {
    where: c.where, asked: c.asked, kind, act: 'winRound', payout: 0, score: 0, heat: 0, crack: false, called: false,
    quotaCarry: false, adaStill: false, clean: witness === null, lines: [], tag: 'joker',
  };
  const spite = kind === 'spite';
  switch (c.where) {
    case 'machine':
      r.act = spite ? 'throwRound' : 'bigWin';
      if (!spite) r.payout = takeoverPayout(c.stake ?? 0, c.quota ?? 0);
      break;
    case 'duel':
      if (spite) r.act = c.rival === 'ada' ? 'breakWord' : 'throwRound';
      else {
        r.act = duelHelp(c.duel);
        if (r.act === 'winRound') r.score = 1;
        r.crack = c.duel === 'promise' && c.breaksPromise === true;
        if (c.duel === 'thequestion' && calledRoll < ORRIN_CALLS) {
          r.act = 'called'; r.score = 0; r.called = true; r.heat = 1; r.lines.push('joker.takeover.orrin');
        }
      }
      break;
    case 'crooked':
      r.act = spite ? 'wrongTable' : 'seeTables';
      break;
    case 'knock':
      r.act = spite ? 'openChain' : 'visitorLeaves';
      if (!spite) r.heat = -1;
      break;
    case 'visit':
      r.act = 'orrinStops';
      r.quotaCarry = true;
      break;
  }
  if (witness === 'kitchen') r.adaStill = r.act === 'winRound';
  if (witness !== null) {
    r.lines.push('joker.takeover.clerk');
    if (witness === 'wager') r.lines.push('joker.takeover.champion');
  }
  return r;
}

/** What asking costs in Ink: 2 (3 at Trust -1 or lower, or a promise instead), 4 at the Visit, 0 for the N1 tutorial. */
export function askCost(trust: number, where: TakeoverWhere, tutorial = false): { ink: number; promiseOk: boolean } {
  if (tutorial) return { ink: 0, promiseOk: false };
  if (where === 'visit') return { ink: 4, promiseOk: false };
  return trust <= -1 ? { ink: 3, promiseOk: true } : { ink: 2, promiseOk: false };
}
