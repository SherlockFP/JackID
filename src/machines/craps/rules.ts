/**
 * Craps "The Bone Pit" (`craps`) — pure rules (no three, kit or DOM). Shared by the live table (`index.ts`) and the
 * headless play contract, so the simulated RTP IS the live RTP. Contract: MACHINES_tables §7.
 *
 * Every bet is a string spot id mapped to coins in a `Book` (one per seat). `resolveRoll` settles one throw against
 * the whole book and returns the next book, the next point and the gross paid back. Integer coins; halves round down.
 * Dice face weights are integers (base 100 + hook adds). The no-roll flag, both dice and the luck gate are drawn in a
 * fixed order so a seed replays identically whatever the charms.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const BASE_WEIGHT = 100;
export const NO_ROLL_P = 1 / 60;
export const PLACE_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];
export const FIELD = new Set([2, 3, 4, 9, 10, 11, 12]);
const CRAPS = new Set([2, 3, 12]);

/** Spot id → coins staked. */
export type Book = Record<string, number>;

export interface Mods {
  /** Per die: six integer face weights (index 0 = face 1). */
  dice: [readonly number[], readonly number[]];
  /** Seven-out shields granted to each shooter (Hollow Dice). */
  sevenOutShield: number;
  oddsAdd: number;        // int × added to the odds cap
  hardwayAdd: number;     // int added to the hardway pay (9:1 / 7:1)
  fieldTwelveAdd: number; // int added to 12's field pay (3:1)
  furnaceMult: number;    // float on the Furnace table
}

export const defaultMods = (): Mods => ({
  dice: [new Array<number>(6).fill(BASE_WEIGHT), new Array<number>(6).fill(BASE_WEIGHT)],
  sevenOutShield: 0, oddsAdd: 0, hardwayAdd: 0, fieldTwelveAdd: 0, furnaceMult: 1,
});

export interface Roll { d1: number; d2: number; total: number; hard: boolean }
export const rollOf = (d1: number, d2: number): Roll => ({ d1, d2, total: d1 + d2, hard: d1 === d2 });
export const isPointNum = (n: number): boolean => n >= 4 && n <= 10 && n !== 7;

export interface Ctx {
  /** 0 = come-out (puck OFF), otherwise the point number. */
  point: number;
  /** Place/buy/hard bets work on the come-out only when the player turned them on. */
  working: boolean;
  mods: Mods;
  /** The shooter still has a seven-out shield charge. */
  shield: boolean;
  /** Distinct point numbers made by the current shooter (Furnace). */
  made: readonly number[];
}

export interface RollOutcome {
  book: Book;
  gross: number;          // coins paid back (stakes returned on wins and pushes included)
  resolvedStake: number;  // coins whose bets were settled on this roll
  lostStake: number;      // of those, the coins lost (refunded in shared mode)
  point: number;        // next point (0 = come-out)
  sevenOut: boolean;
  madePoint: number;      // point number made on this roll, else 0
  made: number[];         // distinct points made this shooter (after this roll)
  absorbed: boolean;      // a seven-out was absorbed by a shield (bets untouched, re-throw)
  settled: Array<[string, number]>;
}

// ── pays (net profit, integer coins) ──────────────────────────────────────────────────────────
export function oddsNet(n: number, a: number): number {
  if (n === 4 || n === 10) return 2 * a;
  if (n === 5 || n === 9) return Math.floor((3 * a) / 2);
  return Math.floor((6 * a) / 5);
}
export function layNet(n: number, a: number): number {
  if (n === 4 || n === 10) return Math.floor(a / 2);
  if (n === 5 || n === 9) return Math.floor((2 * a) / 3);
  return Math.floor((5 * a) / 6);
}
/** PRESS on a point: the chance to make the point before a 7 (ways / (ways + 6)). Pays true odds, so the bet is fair. */
export function pressChance(n: number): number {
  const ways = n === 4 || n === 10 ? 3 : n === 5 || n === 9 ? 4 : 5;
  return ways / (ways + 6);
}
/** PRESS payout as a ratio `[win, stake]` (true odds: 4 or 10 2:1, 5 or 9 3:2, 6 or 8 6:5). */
export function pressRatio(n: number): readonly [number, number] {
  return n === 4 || n === 10 ? [2, 1] : n === 5 || n === 9 ? [3, 2] : [6, 5];
}
/** Max odds multiple of the line bet for a point (3× / 4× / 5×; lay 6× is uniform in `layLimit`). */
export function oddsCap(n: number, add = 0): number { return (n === 4 || n === 10 ? 3 : n === 5 || n === 9 ? 4 : 5) + add; }
export function placeNet(n: number, a: number): number {
  if (n === 6 || n === 8) return Math.floor((7 * a) / 6);
  if (n === 5 || n === 9) return Math.floor((7 * a) / 5);
  return Math.floor((9 * a) / 5);
}
/** Buy 4/10: 2:1 less 5 % of the bet on a win (commission rounds up, never below 1). */
export function buyNet(a: number): number { return 2 * a - Math.max(1, Math.ceil(a / 20)); }
export function hardNet(n: number, a: number, add = 0): number { return (n === 6 || n === 8 ? 9 + add : 7 + add) * a; }
export function furnaceNet(k: number, a: number, mult = 1): number {
  const pay = k >= 6 ? 999 : k === 5 ? 249 : k === 4 ? 24 : 0;
  return Math.floor(pay * a * mult);
}

/** True for every spot id the table understands (come / odds points are dynamic). */
export function validSpot(spot: string): boolean {
  const [kind, arg = ''] = spot.split(/:(.*)/s);
  const n = Number(arg);
  const place = PLACE_NUMBERS.includes(n);
  switch (kind) {
    case 'come': case 'dcome': return arg === '' || place;   // pending, or travelled to a number
    case 'pass': case 'dpass': case 'odds': case 'dodds':
    case 'field': case 'any7': case 'anycraps': case 'horn': case 'ce': case 'furnace':
      return arg === '';
    case 'p': return [2, 3, 11, 12].includes(n);
    case 'big': return n === 6 || n === 8;
    case 'hard': return [4, 6, 8, 10].includes(n);
    case 'place': return place;
    case 'buy': return n === 4 || n === 10;
    case 'codds': case 'dcodds': return place;
    case 'press': return PLACE_NUMBERS.includes(n);           // PRESS on the point: `press:<point>`
    default: return false;
  }
}

/** Settles one throw against the whole book. Pure: the input book is never mutated. */
export function resolveRoll(book: Book, r: Roll, ctx: Ctx): RollOutcome {
  const { point, mods } = ctx;
  const t = r.total;
  const comeout = point === 0;
  const seven = t === 7;
  const made = [...ctx.made];
  if (!comeout && seven && ctx.shield) {
    return { book: { ...book }, gross: 0, resolvedStake: 0, lostStake: 0, point, sevenOut: false, madePoint: 0, made, absorbed: true, settled: [] };
  }
  const out: Book = {};
  const settled: Array<[string, number]> = [];
  let gross = 0, resolvedStake = 0, lostStake = 0;
  let next = point, sevenOut = false, madePoint = 0;
  if (comeout && isPointNum(t)) next = t;
  if (!comeout && t === point) { madePoint = t; next = 0; if (!made.includes(t)) made.push(t); }
  if (!comeout && seven) { sevenOut = true; next = 0; }
  const keep = (s: string, a: number): void => { out[s] = (out[s] ?? 0) + a; };
  const win = (s: string, a: number, net: number): void => { gross += a + net; resolvedStake += a; settled.push([s, a + net]); };
  const push = (s: string, a: number): void => { gross += a; resolvedStake += a; settled.push([s, a]); };
  const lose = (s: string, a: number): void => { resolvedStake += a; lostStake += a; settled.push([s, 0]); };
  const on = comeout ? ctx.working : true;

  for (const s of Object.keys(book)) {
    const a = book[s];
    if (!(a > 0)) continue;
    const [kind, arg = ''] = s.split(/:(.*)/s);
    const n = Number(arg);
    switch (kind) {
      case 'pass':
        if (comeout) { if (t === 7 || t === 11) win(s, a, a); else if (CRAPS.has(t)) lose(s, a); else keep(s, a); }
        else if (t === point) win(s, a, a); else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'dpass':
        if (comeout) {
          if (t === 7 || t === 11) lose(s, a);
          else if (t === 2 || t === 3) win(s, a, a);
          else if (t === 12) push(s, a);
          else keep(s, a);
        } else if (seven) win(s, a, a); else if (t === point) lose(s, a); else keep(s, a);
        break;
      case 'odds':
        if (!comeout && t === point) win(s, a, oddsNet(point, a));
        else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'dodds':
        if (!comeout && seven) win(s, a, layNet(point, a));
        else if (!comeout && t === point) lose(s, a); else keep(s, a);
        break;
      case 'come':
        if (arg === '') {   // pending: resolves on the very next throw, travels to its number otherwise
          if (t === 7 || t === 11) win(s, a, a);
          else if (CRAPS.has(t)) lose(s, a);
          else out[`come:${t}`] = (out[`come:${t}`] ?? 0) + a;
        } else if (t === n) win(s, a, a); else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'dcome':
        if (arg === '') {
          if (t === 7 || t === 11) lose(s, a);
          else if (t === 2 || t === 3) win(s, a, a);
          else if (t === 12) push(s, a);
          else out[`dcome:${t}`] = (out[`dcome:${t}`] ?? 0) + a;
        } else if (seven) win(s, a, a); else if (t === n) lose(s, a); else keep(s, a);
        break;
      case 'codds':
        if (t === n) win(s, a, oddsNet(n, a)); else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'dcodds':
        if (seven) win(s, a, layNet(n, a)); else if (t === n) lose(s, a); else keep(s, a);
        break;
      case 'press':   // true odds on the point (fair): stays up until the point is made or a 7 comes
        if (t === n) win(s, a, oddsNet(n, a)); else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'place': case 'buy':
        if (!on) { keep(s, a); break; }
        if (t === n) win(s, a, kind === 'buy' ? buyNet(a) : placeNet(n, a));
        else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'hard':
        if (!on) { keep(s, a); break; }
        if (t === n) { if (r.hard) win(s, a, hardNet(n, a, mods.hardwayAdd)); else lose(s, a); }
        else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'big':
        if (t === n) win(s, a, a); else if (seven) lose(s, a); else keep(s, a);
        break;
      case 'field':
        if (!FIELD.has(t)) lose(s, a);
        else if (t === 2) win(s, a, 2 * a);
        else if (t === 12) win(s, a, (3 + mods.fieldTwelveAdd) * a);
        else win(s, a, a);
        break;
      case 'any7':
        if (seven) win(s, a, 4 * a); else lose(s, a);
        break;
      case 'anycraps':
        if (CRAPS.has(t)) win(s, a, 7 * a); else lose(s, a);
        break;
      case 'p':
        if (t === n) win(s, a, (n === 2 || n === 12 ? 30 : 15) * a); else lose(s, a);
        break;
      case 'horn': {   // four equal units on 2, 3, 11, 12
        const u = Math.floor(a / 4);
        const g = t === 2 || t === 12 ? u + 30 * u : t === 3 || t === 11 ? u + 15 * u : 0;
        gross += g; resolvedStake += a; settled.push([s, g]);
        break;
      }
      case 'ce': {     // half craps (7:1), half eleven (15:1)
        const h = Math.floor(a / 2);
        const g = CRAPS.has(t) ? h + 7 * h : t === 11 ? h + 15 * h : 0;
        gross += g; resolvedStake += a; settled.push([s, g]);
        break;
      }
      case 'furnace':
        if (sevenOut) {
          const g = furnaceNet(made.length, a, mods.furnaceMult);
          const back = g > 0 ? a + g : 0;
          gross += back; resolvedStake += a; settled.push([s, back]);
        } else keep(s, a);
        break;
      default: keep(s, a);
    }
  }
  return { book: out, gross, resolvedStake, lostStake, point: next, sevenOut, madePoint, made: sevenOut ? [] : made, absorbed: false, settled };
}

/** One throw: the no-roll flag, both dice and the luck gate (solo only), in fixed draw order. */
export interface Throw { roll: Roll; noRoll: boolean; rerolled: boolean; first: Roll }
export function drawDie(rng: Rng, w: readonly number[]): number { return rng.weightedIndex(w) + 1; }
export function throwDice(rng: Rng, mods: Mods, luck: number, netOf: (r: Roll) => number): Throw {
  const noRoll = rng.next() < NO_ROLL_P;
  const first = rollOf(drawDie(rng, mods.dice[0]), drawDie(rng, mods.dice[1]));
  const second = rollOf(drawDie(rng, mods.dice[0]), drawDie(rng, mods.dice[1]));
  const gate = rng.next();
  const rerolled = !noRoll && luck > 0 && netOf(first) < 0 && gate < luck / 100;
  return { roll: rerolled ? second : first, noRoll, rerolled, first };
}

/** Headless round for staff auto-play and balance sims: one Pass Line hand played to resolution (no odds). */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const mods = defaultMods();
  mods.sevenOutShield = Math.round(h.mod('x.craps.sevenOutShield' as ModHook, 0));
  let book: Book = { pass: bet };
  let point = 0, gross = 0, shield = mods.sevenOutShield > 0, lucky = false, guard = 0;
  let made: number[] = [];
  while (guard++ < 400 && Object.keys(book).length > 0) {
    const ctx: Ctx = { point, working: false, mods, shield, made };
    const th = throwDice(rng, mods, h.luck, (r) => { const o = resolveRoll(book, r, ctx); return o.gross - o.resolvedStake; });
    if (th.noRoll) continue;
    lucky = lucky || th.rerolled;
    const o = resolveRoll(book, th.roll, ctx);
    if (o.absorbed) { shield = false; continue; }
    gross += o.gross;
    book = o.book; point = o.point; made = o.made;
  }
  return { gross, tags: lucky ? ['lucky'] : [] };
};
