/**
 * Tavla (Turkish backgammon) — pure rules, cube economy and bot heuristics. No three, kit or DOM.
 *
 * Coordinates: each side counts its checkers by DISTANCE = pips still to travel before bearing off (1..24).
 * `pos[s][d-1]` = own checkers of side s at distance d. Side 0 (white) starts on 24 and goes home to 1..6; side 1
 * (black) mirrors it. Absolute board point of (side, d): side 0 → d, side 1 → 25 − d. A step moves one checker from
 * distance `f` (BAR = 25 when entering) to `t` (OFF = 0 when bearing off) with one die `d`.
 *
 * Rules implemented: standard opening, hitting (blots go to the bar), entry on the opponent's home board, blocked
 * points (2+ enemy checkers), bearing off only with every checker home, exact or higher throws, the rule that the
 * maximum number of dice must be played, doubles = four moves, doubling cube 1 → 64 with ownership, gammon (×2)
 * when the loser has borne off nothing, backgammon (×3) when the loser is also on the bar or in the winner's home.
 */
import type { Rng } from '@/core/rng';

export type Side = 0 | 1;
export type Board = { pos: [number[], number[]]; bar: [number, number]; off: [number, number] };
export type Step = { s: number; f: number; t: number; d: number; hit: boolean };

export const BAR = 25;
export const OFF = 0;
export const MEN = 15;
export const CUBE_MAX = 64;
const SRC = Array.from({ length: 24 }, (_, i) => i + 1);

/** The standard opening: 2 on 24, 5 on 13, 3 on 8, 5 on 6 (per side, by distance). */
export function startBoard(): Board {
  const mk = (): number[] => { const a = new Array<number>(24).fill(0); a[23] = 2; a[12] = 5; a[7] = 3; a[5] = 5; return a; };
  return { pos: [mk(), mk()], bar: [0, 0], off: [0, 0] };
}

export function cloneBoard(b: Board): Board {
  return { pos: [b.pos[0].slice(), b.pos[1].slice()], bar: [b.bar[0], b.bar[1]], off: [b.off[0], b.off[1]] };
}

/** Enemy checkers on the absolute point that is own distance `t` (the enemy measures it as 25 − t). */
export function enemyAt(b: Board, s: number, t: number): number {
  if (t < 1 || t > 24) return 0;
  return b.pos[1 - s][24 - t] ?? 0;
}

/** Pip count: every checker's distance, bar checkers count 25. */
export function pips(b: Board, s: number): number {
  let n = b.bar[s] * BAR;
  for (let d = 1; d <= 24; d++) n += b.pos[s][d - 1] * d;
  return n;
}

/** Every checker home (distances 1..6) and none on the bar: bearing off is allowed. */
export function allHome(b: Board, s: number): boolean {
  if (b.bar[s] > 0) return false;
  for (let d = 7; d <= 24; d++) if (b.pos[s][d - 1] > 0) return false;
  return true;
}

function furthest(b: Board, s: number): number {
  for (let d = 24; d >= 1; d--) if (b.pos[s][d - 1] > 0) return d;
  return 0;
}

/** One legal step of side `s` from distance `f` with die `d`, or null. */
export function stepFor(b: Board, s: number, f: number, d: number): Step | null {
  if (f === BAR) {
    if (b.bar[s] === 0) return null;
    const t = BAR - d;
    const e = enemyAt(b, s, t);
    if (e >= 2) return null;
    return { s, f, t, d, hit: e === 1 };
  }
  if (f < 1 || f > 24 || b.bar[s] > 0 || b.pos[s][f - 1] === 0) return null;
  const t = f - d;
  if (t >= 1) {
    const e = enemyAt(b, s, t);
    if (e >= 2) return null;
    return { s, f, t, d, hit: e === 1 };
  }
  if (!allHome(b, s)) return null;
  if (t < 0 && furthest(b, s) > f) return null;          // an overshoot needs no checker further back
  return { s, f, t: OFF, d, hit: false };
}

export function applyStep(b: Board, st: Step): Board {
  const n = cloneBoard(b);
  const s = st.s;
  if (st.f === BAR) n.bar[s]--; else n.pos[s][st.f - 1]--;
  if (st.t === OFF) n.off[s]++;
  else {
    n.pos[s][st.t - 1]++;
    if (st.hit) { n.pos[1 - s][24 - st.t]--; n.bar[1 - s]++; }
  }
  return n;
}

/** Remove one occurrence of `d`. */
export function spend(left: readonly number[], d: number): number[] {
  const i = left.indexOf(d);
  return i < 0 ? left.slice() : left.slice(0, i).concat(left.slice(i + 1));
}

/** Dice to play for a roll: doubles are four moves. */
export function expand(d1: number, d2: number): number[] { return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2]; }

/**
 * Every complete sequence of steps that uses the MAXIMUM number of the remaining dice (the tavla rule: play as
 * much of the roll as possible). Empty when nothing is playable.
 */
export function sequences(b: Board, s: number, dice: readonly number[]): Step[][] {
  const out: Step[][] = [];
  const rec = (cur: Board, left: number[], pre: Step[]): void => {
    let any = false;
    const tried = new Set<number>();
    for (let i = 0; i < left.length; i++) {
      const d = left[i];
      if (tried.has(d)) continue;
      tried.add(d);
      const rest = spend(left, d);
      const srcs = cur.bar[s] > 0 ? [BAR] : SRC;
      for (const f of srcs) {
        const st = stepFor(cur, s, f, d);
        if (!st) continue;
        any = true;
        rec(applyStep(cur, st), rest, [...pre, st]);
      }
    }
    if (!any) out.push(pre);
  };
  rec(b, [...dice], []);
  const max = out.reduce((m, q) => Math.max(m, q.length), 0);
  if (max === 0) return [];
  const seen = new Set<string>();
  const res: Step[][] = [];
  for (const q of out) {
    if (q.length !== max) continue;
    const key = q.map((st) => `${st.f}>${st.t}:${st.d}`).join('|');
    if (!seen.has(key)) { seen.add(key); res.push(q); }
  }
  return res;
}

/** Legal first steps for the remaining dice (what a player may pick next). */
export function legalSteps(b: Board, s: number, left: readonly number[]): Step[] {
  const seen = new Map<string, Step>();
  for (const q of sequences(b, s, left)) {
    const st = q[0];
    const k = `${st.f}:${st.t}`;
    if (!seen.has(k)) seen.set(k, st);
  }
  return [...seen.values()];
}

/** Settlement multiplier for the winner: 1 single, 2 gammon, 3 backgammon. */
export function resultMult(b: Board, winner: number): 1 | 2 | 3 {
  const L = 1 - winner;
  if (b.off[L] > 0) return 1;
  const back = b.bar[L] > 0 || b.pos[L].slice(18).some((n) => n > 0);     // loser distances 19..24 = winner's home
  return back ? 3 : 2;
}

// ── cube economy ────────────────────────────────────────────────────────────────────────────────
/** Next cube value after a take. */
export function nextCube(c: number): number { return Math.min(CUBE_MAX, c * 2); }

// ── bot heuristics (pip count + blots + points) ─────────────────────────────────────────────────
/** Enemy checkers that can hit our single checker at own distance `d` with one die (direct shots). */
export function shotsAt(b: Board, s: number, d: number): number {
  const e = 1 - s;
  let n = 0;
  for (let x = Math.max(1, 26 - d); x <= Math.min(24, 31 - d); x++) n += b.pos[e][x - 1];
  return n;
}

/** Position value for side `s`: race lead, loose checkers in reach, made points, bar and borne-off checkers. */
export function evalBoard(b: Board, s: number): number {
  const e = 1 - s;
  let v = (pips(b, e) - pips(b, s)) * 0.25;
  for (let d = 1; d <= 24; d++) {
    const n = b.pos[s][d - 1];
    if (n === 1 && shotsAt(b, s, d) > 0) v -= 2.5;
    if (n >= 2) v += 0.6;
    const m = b.pos[e][d - 1];
    if (m === 1 && shotsAt(b, e, d) > 0) v += 1.2;
  }
  v -= b.bar[s] * 4;
  v += b.bar[e] * 4;
  v += b.off[s] * 0.6 - b.off[e] * 0.6;
  return v;
}

/** Pick one legal step for a bot. Level 1 is loose, 2 is greedy one-ply, 3 looks at the whole roll. */
export function pickStep(b: Board, s: number, left: readonly number[], level: number, rng: Rng): Step | null {
  const opts = legalSteps(b, s, left);
  if (opts.length === 0) return null;
  if (level <= 1 && rng.chance(0.35)) return rng.pick(opts);
  if (level >= 3) {
    let best: Step[] | null = null;
    let bestV = -Infinity;
    for (const q of sequences(b, s, left)) {
      let cur = b;
      for (const st of q) cur = applyStep(cur, st);
      const v = evalBoard(cur, s);
      if (v > bestV) { bestV = v; best = q; }
    }
    return best ? best[0] : null;
  }
  let best = opts[0];
  let bestV = -Infinity;
  for (const st of opts) {
    const v = evalBoard(applyStep(b, st), s);
    if (v > bestV) { bestV = v; best = st; }
  }
  return best;
}

/** Bot doubles when it leads the race clearly (opponent pips ≥ thr × its own). */
export function wantsDouble(b: Board, s: number, level: number): boolean {
  const mine = pips(b, s), theirs = pips(b, 1 - s);
  if (mine <= 0) return false;
  const thr = level <= 1 ? 1.8 : level === 2 ? 1.5 : 1.35;
  return theirs / mine >= thr;
}

/** Bot takes a double while it is not too far behind (own pips ≤ thr × opponent pips). */
export function wantsTake(b: Board, s: number, level: number): boolean {
  const mine = pips(b, s), theirs = pips(b, 1 - s);
  if (theirs <= 0) return false;
  const thr = level <= 1 ? 1.25 : level === 2 ? 1.5 : 1.7;
  return mine / theirs <= thr;
}
