/**
 * Sealed Wall (Tamsin Veil, "The Quiet Hand"): a 1v1 duel on the Little Wall mahjong rules (WAVE25_TALLY section A).
 * The tiles, melds and win test are `src/machines/mahjong/rules.ts` (imported, not copied).
 *
 * Rules: both sides hold 7 hidden tiles from one shared wall of 120. On your turn DRAW from the wall or TAKE the
 * opponent's last discard, then DISCARD one tile. The first complete 8-tile hand (2 melds + a pair) wins the pot
 * (2 stakes minus a 5% rake). Nobody wins in 6 turns each: the nearer hand takes the larger share (75/25 of the pot),
 * equal hands split it.
 *
 * The cheat ("the Fifth", plan kind `k-sw`): on one hidden turn from 3 to 5, instead of discarding from her hand Tamsin
 * drops a 5th copy of a tile from her sleeve onto the river and keeps all 8 tiles (a full-size hand, which counts one
 * tile nearer at the end) and she plays EXTRA_PICKS free picks in a row. Clues (all three by the end of that step, the
 * payout comes on a later step): TELL "Forgive me" the turn before, TABLE the cuff glint and the left hand off the felt,
 * MATH the Tally Sheet adds up to 121 tiles on a 120-tile wall (and shows the tile five times when four were seen).
 * Call: select the tile in the river, then C.
 *
 * Host only: the state holds both hands and the wall. Public information is `publicEvents`, `clues` and `log`.
 */
import { createRng, hashSeed } from '@/core/rng';
import * as M from '@/machines/mahjong/rules';
import { FAIR_KIND, POT, runHeadless, settleNet, type Side, type TurnState } from '../gamekit';
import type { CallTarget, CheatPlan, Clue, DuelRules, RevealScript, TextRef } from '../types';

export const ID = 'sealedwall';
export const RIVAL = 'tamsin';
export const KIND = 'k-sw';
export const TURNS = 6;
/** Chance a duel is a cheat. Tuned so a naive player returns ~0.8 and a detective ~1.45 of the stake. */
export const CHEAT_RATE = 0.19;
export const NEAR_SHARE = 0.75;
/** Free picks the sleeve trick buys (the extra tile in her hand is worth turns). */
export const EXTRA_PICKS = 2;
/** Tiles the Tally Sheet should add up to. */
export const WALL = M.WALL_SIZE;

export type SWAction = { k: 'draw' } | { k: 'take' } | { k: 'discard'; tile: number };

export interface RiverTile { tile: number; by: Side; taken: Side | null; sleeve?: true }

export interface SWState extends TurnState {
  wall: number[];
  pos: number;
  hands: Record<Side, number[]>;
  river: RiverTile[];
  phase: 'pick' | 'disc';
  /** The sleeve tile came out (host only). */
  cheated: boolean;
  sleeve: number;
  /** Free picks Tamsin still has after the sleeve trick (host only). */
  extra: number;
}

// ── tiles ─────────────────────────────────────────────────────────────────────────────────────────────
const SUIT_NAMES = ['COINS', 'STICKS', 'MARKS'] as const;
const DRAGON_NAMES = ['RED', 'GREEN', 'WHITE'] as const;
export const tileName = (t: number): string => (M.isDragon(t) ? `${DRAGON_NAMES[M.rankOf(t) - 1]} DRAGON` : `${SUIT_NAMES[M.suitOf(t) as 0 | 1 | 2]} ${M.rankOf(t)}`);
const asc = (a: number, b: number): number => a - b;

/** True when `hand` (8 tiles, or 9 for a sleeved hand) holds a Mahjong. */
export function wins(hand: readonly number[]): boolean {
  const c = M.countsOf(hand);
  if (hand.length === M.HAND + 1) return M.analyze(c) !== null;
  if (hand.length === M.HAND + 2) {
    for (let t = 0; t < M.KINDS; t++) {
      if (c[t] === 0) continue;
      c[t]--;
      const w = M.analyze(c);
      c[t]++;
      if (w) return true;
    }
  }
  return false;
}

/** Tiles of each kind side `me` has not seen (own hand, the river and what the other side took). */
export function unseenFor(s: SWState, me: Side): number[] {
  const u = new Array<number>(M.KINDS).fill(M.COPIES);
  for (const t of s.hands[me]) u[t]--;
  for (const r of s.river) if (r.taken !== me) u[r.tile]--;
  return u.map((n) => Math.max(0, n));
}

/** The opponent's last discard when it is still on the felt (what TAKE would pick up). */
export function upcard(s: SWState, me: Side): RiverTile | null {
  const last = s.river[s.river.length - 1];
  return last && last.by !== me && last.taken === null ? last : null;
}

/** Discard for a hand of 8 (normal) or 9 (sleeved): the most overlap kept, then the most outs, then the higher tile. */
function chooseDiscard(hand: readonly number[], unseen: number[]): number {
  if (hand.length === M.HAND + 1) return M.bestDiscard(hand, unseen);
  const c = M.countsOf(hand);
  let best = -1, bestOv = -1;
  for (let t = 0; t < M.KINDS; t++) {
    if (c[t] === 0) continue;
    c[t]--;
    const ov = M.overlap(c);
    c[t]++;
    if (ov > bestOv || (ov === bestOv && t > best)) { best = t; bestOv = ov; }
  }
  return best;
}

/** True when no held tile is the same kind or within two ranks in the same suit (dragons only match themselves). */
function isolated(hand: readonly number[], t: number): boolean {
  const reach = M.isDragon(t) ? 0 : 2;
  const suit = M.suitOf(t);
  return !hand.some((h) => M.suitOf(h) === suit && Math.abs(M.rankOf(h) - M.rankOf(t)) <= reach);
}

/** Take the upcard? Yes when it wins, or when it raises the overlap of the best hand it can make. */
function wantsTake(s: SWState, me: Side): boolean {
  const up = upcard(s, me);
  if (!up) return false;
  const hand = s.hands[me];
  if (isolated(hand, up.tile)) return false;                                  // a lone tile cannot lift the overlap (cheap exit)
  const with1 = [...hand, up.tile];
  if (wins(with1)) return true;
  const un = unseenFor(s, me);
  const d = chooseDiscard(with1, un);
  const c = M.countsOf(with1);
  c[d]--;
  return M.overlap(c) > M.overlap(M.countsOf(hand));
}

/** One move of the table bot for `me` (the rival, the naive player and the detective all play this). */
export function pickMove(s: SWState, me: Side): SWAction {
  if (s.phase === 'pick') return wantsTake(s, me) ? { k: 'take' } : { k: 'draw' };
  return { k: 'discard', tile: chooseDiscard(s.hands[me], unseenFor(s, me)) };
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────
function clone(s: SWState): SWState {
  return {
    ...s,
    hands: { player: s.hands.player.slice(), rival: s.hands.rival.slice() },
    river: s.river.map((r) => ({ ...r })),
    log: s.log.slice(),
  };
}

/** The sleeve tile: the kind the table has seen most (so the Tally Sheet shows the most copies), ties by seed. */
function sleeveTile(s: SWState): { tile: number; copies: number } {
  const seen = new Array<number>(M.KINDS).fill(0);
  for (const r of s.river) seen[r.tile]++;
  for (const t of s.hands.player) seen[t]++;
  const rng = createRng(hashSeed(s.seed, 'sleeve'));
  let best = -1, top = -1, tie = -1;
  for (let t = 0; t < M.KINDS; t++) {
    const r = rng.next();
    if (seen[t] > top || (seen[t] === top && r > tie)) { best = t; top = seen[t]; tie = r; }
  }
  return { tile: best, copies: top + 1 };
}

export function makePlan(seed: number): CheatPlan {
  const rng = createRng(hashSeed(seed, 'plan', ID));
  if (rng.chance(CHEAT_RATE)) return { kind: KIND, round: rng.int(3, 5), detail: {} };
  // a fair duel: Tamsin may still apologise (a decoy tell, one channel only)
  return { kind: FAIR_KIND, round: 0, detail: { decoy: rng.chance(0.5) ? rng.int(2, 5) : 0 } };
}

export function init(seed: number, _plan: CheatPlan, stake: number): SWState {
  const wall = M.shuffleWall(createRng(hashSeed(seed, 'wall')));
  return {
    seed, stake, round: 1, turn: 'player', pay: 0, done: false, log: [],
    wall, pos: 2 * M.HAND,
    hands: { player: wall.slice(0, M.HAND).sort(asc), rival: wall.slice(M.HAND, 2 * M.HAND).sort(asc) },
    river: [], phase: 'pick', cheated: false, sleeve: -1, extra: 0,
  };
}

export function legal(st: import('../types').DuelState): SWAction[] {
  const s = st as SWState;
  if (s.done || s.turn !== 'player') return [];
  if (s.phase === 'pick') return upcard(s, 'player') ? [{ k: 'draw' }, { k: 'take' }] : [{ k: 'draw' }];
  return [...new Set(s.hands.player)].sort(asc).map((tile) => ({ k: 'discard' as const, tile }));
}

function finish(s: SWState): void {
  const a = M.overlap(M.countsOf(s.hands.player)), b = M.overlap(M.countsOf(s.hands.rival)) + (s.cheated ? 1 : 0);
  s.done = true;
  if (a > b) { s.winner = 'player'; s.pay = POT * NEAR_SHARE; }
  else if (a < b) { s.winner = 'rival'; s.pay = POT * (1 - NEAR_SHARE); }
  else s.pay = POT / 2;
}

export function step(st: import('../types').DuelState, actor: Side, action: SWAction, plan: CheatPlan): { state: SWState; clues: Clue[]; publicEvents: unknown[] } {
  const s = clone(st as SWState);
  const clues: Clue[] = [];
  const ev: unknown[] = [];
  const hand = s.hands[actor];
  if (s.done || s.turn !== actor) throw new Error('sealedwall: not your turn');
  if (action.k === 'draw' || action.k === 'take') {
    if (s.phase !== 'pick') throw new Error('sealedwall: discard first');
    let got: number;
    if (action.k === 'take') {
      const up = upcard(s, actor);
      if (!up) throw new Error('sealedwall: nothing to take');
      up.taken = actor;
      got = up.tile;
      ev.push({ k: 'take', by: actor, tile: got });
    } else {
      got = s.wall[s.pos++];
      ev.push({ k: 'draw', by: actor });
    }
    hand.push(got);
    hand.sort(asc);
    if (wins(hand)) {
      s.done = true;
      s.winner = actor;
      s.pay = actor === 'player' ? POT : 0;
      ev.push({ k: 'win', by: actor });
    } else s.phase = 'disc';
  } else {
    if (s.phase !== 'disc') throw new Error('sealedwall: pick first');
    const rival = actor === 'rival';
    const isCheat = plan.kind === KIND;
    let sleeved = false;
    if (rival && ((isCheat && s.round === plan.round - 1) || (!isCheat && s.round === plan.detail.decoy))) {
      clues.push({ channel: 'tell', round: s.round, key: 'duel.sw.tell.forgive' });
    }
    if (rival && isCheat && s.round === plan.round && !s.cheated && hand.length === M.HAND + 1) {
      const { tile, copies } = sleeveTile(s);
      s.cheated = true;
      sleeved = true;
      s.sleeve = tile;
      s.river.push({ tile, by: 'rival', taken: null, sleeve: true });           // she keeps all 8 tiles
      ev.push({ k: 'discard', by: 'rival', tile });
      clues.push({ channel: 'table', round: s.round, key: 'duel.sw.table.cuff' });
      const data = { tile, name: tileName(tile), copies, accounted: WALL + 1, expected: WALL };
      clues.push({ channel: 'math', round: s.round, key: copies >= M.COPIES + 1 ? 'duel.sw.math.five' : 'duel.sw.math.tally', data });
    } else {
      const i = hand.indexOf(action.tile);
      if (i < 0) throw new Error('sealedwall: tile not held');
      hand.splice(i, 1);
      s.river.push({ tile: action.tile, by: actor, taken: null });
      ev.push({ k: 'discard', by: actor, tile: action.tile });
    }
    s.phase = 'pick';
    if (sleeved) s.extra = EXTRA_PICKS - 1;                                    // the cuff trick buys free picks: she plays on
    else if (rival && s.extra > 0) s.extra--;
    else if (actor === 'player') s.turn = 'rival';
    else if (s.round >= TURNS) { finish(s); ev.push({ k: 'end' }); }
    else { s.round++; s.turn = 'player'; }
  }
  s.log.push(...ev);
  return { state: s, clues, publicEvents: ev };
}

export const rivalAct = (st: import('../types').DuelState): SWAction => pickMove(st as SWState, 'rival');

/** `target`: a tile kind (number), `{ tile }` or `{ index }` into the river. Correct only once the sleeve tile is out. */
export function call(st: import('../types').DuelState, plan: CheatPlan, target: unknown): { correct: boolean } {
  const s = st as SWState;
  if (plan.kind !== KIND || !s.cheated) return { correct: false };
  const o = target as { tile?: number; index?: number } | number | null;
  const tile = typeof o === 'number' ? o : o && typeof o.tile === 'number' ? o.tile : o && typeof o.index === 'number' ? s.river[o.index]?.tile : -1;
  return { correct: tile === s.sleeve };
}

export const verdict = (st: import('../types').DuelState, plan: CheatPlan): 'CHEAT' | 'FAIR' => (plan.kind === KIND && (st as SWState).cheated ? 'CHEAT' : 'FAIR');

export const reveal: RevealScript = { saw: 'duel.sw.reveal.saw', happened: 'duel.sw.reveal.happened', why: 'duel.sw.reveal.why' };
export const revealFair: RevealScript = { saw: 'duel.sw.fair.saw', happened: 'duel.sw.fair.happened', why: 'duel.sw.fair.why' };

// ── HUD hooks (all text goes through i18n keys) ───────────────────────────────────────────────────────
const who = (b: Side): string => (b === 'player' ? 'You' : 'Rival');
const tileRef = (t: number): TextRef => ({ key: 'duel.sw.tile', data: { name: tileName(t) } });

export function describeAction(a: SWAction): TextRef {
  return a.k === 'discard' ? { key: 'duel.sw.act.discard', data: { name: tileName(a.tile), tile: a.tile } } : { key: `duel.sw.act.${a.k}` };
}

export function describeEvent(e: unknown): TextRef {
  const o = e as { k: string; by?: Side; tile?: number };
  if (o.k === 'end') return { key: 'duel.sw.ev.end' };
  if (o.k === 'win') return { key: `duel.sw.ev.win${who(o.by!)}` };
  return { key: `duel.sw.ev.${o.k}${who(o.by!)}`, data: o.tile === undefined ? undefined : { name: tileName(o.tile), tile: o.tile } };
}

export function describe(st: import('../types').DuelState): TextRef[] {
  const s = st as SWState;
  return [
    { key: 'duel.sw.line.hand', data: { tiles: s.hands.player.map(tileName).join(' · ') } },
    { key: 'duel.sw.line.wall', data: { n: s.wall.length - s.pos, turn: s.round, turns: TURNS } },
  ];
}

export function callTargets(st: import('../types').DuelState): CallTarget[] {
  const s = st as SWState;
  const seen = [...new Set(s.river.filter((r) => r.by === 'rival').map((r) => r.tile))].sort(asc);
  return seen.map((t) => ({ target: { tile: t }, label: tileRef(t) }));
}

// ── headless ──────────────────────────────────────────────────────────────────────────────────────────
export const sealedWall: DuelRules<SWAction> & { verdict: typeof verdict; revealFair: RevealScript } = {
  id: ID, rival: RIVAL, makePlan, init, legal, step, rivalAct, call,
  settle: settleNet, reveal, revealFair, verdict,
  turnOf: (s) => (s as SWState).turn,
  describeAction, describeEvent, describe, callTargets,
  playHeadless: (seed, policy) => runHeadless<SWAction>({
    rules: sealedWall,
    move: (s) => pickMove(s as SWState, 'player'),
    target: (clues) => {
      const m = clues.find((c) => c.channel === 'math');
      return m ? { tile: (m.data as { tile: number }).tile } : undefined;
    },
  }, seed, policy),
};

