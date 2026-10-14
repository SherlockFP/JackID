/**
 * SON KART / LAST CARD — pure rules and bot AI (owner: sonkart). No three, kit or DOM: safe for RTP sims in Node.
 *
 * Deck (115): per colour (Red, Yellow, Green, Blue) one 0 and two each of 1–9, Skip (S), Reverse (V), +2 → 100 colour
 * cards; Wild (W) ×4, Wild +4 (W+4) ×4; JackID specials Debt, Collector, Curse, Jackpot ×2 each. Card ids follow the
 * texgen `SonKartId` grammar (`R7`, `YS`, `GV`, `B+2`, `W`, `W+4`, `DEBT`, `COLLECTOR`, `CURSE`, `JACKPOT`).
 * Every colourless card asks the player for a colour when played.
 *
 * Turn flow: a stacking draw (+2 / +4) is either answered with a stacking card or taken as `pend` cards that
 * skip the victim's turn. A drawn card may be played at once when the house rule `drawToMatch` is on; otherwise
 * the turn passes. The round ends when a hand empties; the host pays the pot (`index.ts`).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay } from '@/game/types';

export type Colour = 'R' | 'Y' | 'G' | 'B';
export const COLOURS: readonly Colour[] = ['R', 'Y', 'G', 'B'];
export const FACES_TWICE: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'V', '+2'];
export const SPECIAL_IDS: readonly string[] = ['W', 'W+4', 'DEBT', 'COLLECTOR', 'CURSE', 'JACKPOT']; // i18n-ok: card ids
/** Opening hand: five cards keeps a round near a minute (it was seven). */
export const HAND0 = 5;
/** House rake on the pot (share kept by the house before the winner is paid). */
export const RAKE = 0.05;
export const MAX_SEATS = 4;

export interface House { stack: boolean; swap70: boolean; jumpIn: boolean; drawToMatch: boolean; lastCard: boolean }
export const HOUSE_DEFAULT: House = { stack: true, swap70: true, jumpIn: false, drawToMatch: true, lastCard: true };
export type HouseKey = keyof House;

export type FxTag = '' | 'skip' | 'rev' | 'd2' | 'w4' | 'debt' | 'coll' | 'curse' | 'jp' | 'swap7' | 'swap0';

/** Presentation facts emitted by the host, in order. Every field is Json-safe. */
export type Fx =
  | { k: 'play'; seat: number; id: string; col: string; fx: FxTag; tgt: number; n: number; j: boolean }
  | { k: 'draw'; seat: number; n: number }
  | { k: 'pass'; seat: number }
  | { k: 'call'; seat: number; on: boolean }
  | { k: 'catch'; seat: number; by: number; n: number }
  | { k: 'coll'; col: string; cnt: number[] }
  | { k: 'swap'; a: number; b: number }
  | { k: 'rot'; dir: number }
  | { k: 'turn'; seat: number }
  | { k: 'win'; seat: number };

export interface Game {
  seats: number;
  play: boolean[];          // seats in this round
  hands: string[][];        // host-only truth
  draw: string[];           // stack: the top card is the LAST element
  disc: string[];           // discard pile; the top card is `top`
  top: string;
  col: string;              // active colour ('' when none, only before the first card)
  dir: 1 | -1;
  turn: number;
  pend: number;             // cards owed to the next stacking victim
  pendK: '' | 'd2' | 'w4';
  jp: boolean;              // the round was won with a Jackpot card: the winner takes double
  debt: number[];           // coins owed per seat, collected from the pot at the end
  call: { seat: number; on: boolean } | null;   // LAST CARD window: open while `on` is false
  drawn: boolean;           // the turn holder drew a playable card (`drawnId`) and may play it or pass
  drawnId: string;
  over: boolean;
  winner: number;
  house: House;
}

export interface PlayOpts {
  col?: string;             // colour for colourless cards
  jump?: boolean;           // jump-in out of turn
  callOn?: boolean;         // the player called LAST CARD with this play (bots)
  debtUnit: number;         // coins one Debt card adds
  wealthiest: number;          // Curse target (−1 none)
}

export type Act =
  | { k: 'play'; id: string; col: string }
  | { k: 'draw' }
  | { k: 'pass' }
  | { k: 'call' }
  | { k: 'catch' };

export interface Result { err: string; fx: Fx[] }

// ── cards ───────────────────────────────────────────────────────────────────────────────────────
export function buildDeck(): string[] {
  const d: string[] = [];
  for (const c of COLOURS) {
    d.push(c + '0');
    for (const f of FACES_TWICE) d.push(c + f, c + f);
  }
  for (let i = 0; i < 4; i++) d.push('W', 'W+4');
  for (const s of ['DEBT', 'COLLECTOR', 'CURSE']) d.push(s, s); // i18n-ok: card ids
  d.push('JACKPOT'); // i18n-ok: card ids
  return d;
}

export const isColoured = (id: string): boolean => id.length >= 2 && (id[0] === 'R' || id[0] === 'Y' || id[0] === 'G' || id[0] === 'B');
export const colourOf = (id: string): string => (isColoured(id) ? id[0] : '');
export const faceOf = (id: string): string => (isColoured(id) ? id.slice(1) : id);
export const isNumber = (id: string): boolean => isColoured(id) && /^[0-9]$/.test(faceOf(id));
export const isWild = (id: string): boolean => !isColoured(id);

const FACE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'V', '+2'];
const COL_ORDER = ['R', 'Y', 'G', 'B', ''];
/** Stable display order: colours first (R Y G B), then by face; colourless specials last. */
export function sortHand(hand: string[]): void {
  const key = (id: string): number => {
    const c = COL_ORDER.indexOf(colourOf(id));
    const f = isColoured(id) ? FACE_ORDER.indexOf(faceOf(id)) : 20 + SPECIAL_IDS.indexOf(id);
    return (c < 0 ? 4 : c) * 100 + f;
  };
  hand.sort((a, b) => key(a) - key(b));
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ── table geometry ──────────────────────────────────────────────────────────────────────────────
export const activeCount = (g: Game): number => g.play.filter(Boolean).length;

/** The seat `steps` places away from `from` in direction `dir`, skipping seats not in the round. */
export function nextIn(g: Game, from: number, dir: number, steps = 1): number {
  let s = from;
  for (let k = 0; k < steps; k++) {
    for (let guard = 0; guard < g.seats; guard++) {
      s = (s + dir + g.seats) % g.seats;
      if (g.play[s]) break;
    }
  }
  return s;
}
export const seatAfter = (g: Game, from: number, steps = 1): number => nextIn(g, from, g.dir, steps);

// ── draw pile ───────────────────────────────────────────────────────────────────────────────────
/** Pulls one card; recycles the discard pile (minus the top) when the stack runs dry. */
function takeCard(g: Game, rng: Rng): string | null {
  if (g.draw.length === 0) {
    if (g.disc.length <= 1) return null;
    const top = g.disc.pop() as string;
    g.draw = shuffle(g.disc.splice(0), rng);
    g.disc.push(top);
  }
  return g.draw.pop() ?? null;
}
function drawInto(g: Game, rng: Rng, seat: number, n: number): string[] {
  const got: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = takeCard(g, rng);
    if (c === null) break;
    g.hands[seat].push(c);
    got.push(c);
  }
  sortHand(g.hands[seat]);
  return got;
}

// ── start ───────────────────────────────────────────────────────────────────────────────────────
/** A fresh round for the seats that anted (`play[s]`). The first turn belongs to a random seat. */
export function startRound(play: boolean[], rng: Rng, house: House): Game {
  const seats = play.length;
  const g: Game = {
    seats, play: play.slice(), hands: Array.from({ length: seats }, () => [] as string[]),
    draw: shuffle(buildDeck(), rng), disc: [], top: '', col: '', dir: 1, turn: 0, pend: 0, pendK: '',
    jp: false, debt: new Array<number>(seats).fill(0), call: null, drawn: false, drawnId: '',
    over: false, winner: -1, house,
  };
  for (let r = 0; r < HAND0; r++) for (let s = 0; s < seats; s++) if (play[s]) drawInto(g, rng, s, 1);
  // the first card must be a plain number so the round opens without an effect
  for (let i = g.draw.length - 1; i >= 0; i--) {
    if (isNumber(g.draw[i])) { g.top = g.draw.splice(i, 1)[0]; break; }
  }
  g.disc.push(g.top);
  g.col = colourOf(g.top);
  const starters = play.map((p, s) => (p ? s : -1)).filter((s) => s >= 0);
  g.turn = starters[rng.int(0, starters.length - 1)];
  return g;
}

// ── legality ────────────────────────────────────────────────────────────────────────────────────
function hasStack(g: Game, seat: number): boolean {
  return g.hands[seat].some((id) => stackOk(g, id));
}
function stackOk(g: Game, id: string): boolean {
  if (!g.house.stack || g.pend <= 0) return false;
  return g.pendK === 'd2' ? faceOf(id) === '+2' : g.pendK === 'w4' ? id === 'W+4' : false;
}

/** May `id` (in `seat`'s hand) be played now, on its own turn? */
export function canPlay(g: Game, seat: number, id: string): boolean {
  if (g.over) return false;
  if (g.pend > 0) return stackOk(g, id);
  if (g.drawn && id !== g.drawnId) return false;
  if (id === 'W+4') return !g.hands[seat].some((c) => isColoured(c) && colourOf(c) === g.col);
  if (isWild(id)) return true;
  if (colourOf(id) === g.col) return true;
  return isColoured(g.top) && faceOf(id) === faceOf(g.top);
}

/** Jump-in (house rule): an exact copy of the top card, out of turn, while no draw is owed. */
export function jumpable(g: Game, seat: number, id: string): boolean {
  return g.house.jumpIn && !g.over && g.pend === 0 && !g.drawn && g.play[seat] && seat !== g.turn
    && isColoured(id) && id === g.top;
}

export function legal(g: Game, seat: number): string[] {
  const out: string[] = [];
  for (const id of g.hands[seat]) if (canPlay(g, seat, id) && !out.includes(id)) out.push(id);
  return out;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────
const err = (key: string): Result => ({ err: key, fx: [] });

/** Winner after an action: the actor if empty, else the first empty hand. −1 while the round goes on. */
function winnerAfter(g: Game, actor: number): number {
  if (g.hands[actor].length === 0) return actor;
  return g.hands.findIndex((h, s) => g.play[s] && h.length === 0);
}

export function applyPlay(g: Game, rng: Rng, seat: number, id: string, o: PlayOpts): Result {
  if (g.over) return err('sk.eOver');
  const hand = g.hands[seat];
  if (!hand.includes(id)) return err('sk.eBadCard');
  if (o.jump) { if (!jumpable(g, seat, id)) return err('sk.eNoJump'); }
  else {
    if (seat !== g.turn) return err('sk.eNotTurn');
    if (!canPlay(g, seat, id)) return err('sk.eBadCard');
  }
  const wild = isWild(id);
  if (wild && !(o.col && COLOURS.includes(o.col as Colour))) return err('sk.eNeedColour');

  // the card leaves the hand; a catch window closes as soon as someone else acts
  hand.splice(hand.indexOf(id), 1);
  if (g.call && g.call.seat !== seat) g.call = null;
  g.disc.push(id);
  g.top = id;
  g.drawn = false; g.drawnId = '';
  g.col = wild ? (o.col as string) : colourOf(id);
  const fx: Fx[] = [];
  const active = activeCount(g);
  let steps = 1;
  let tag: FxTag = '';
  let tgt = -1;
  const face = faceOf(id);
  const next = nextIn(g, seat, g.dir, 1);

  if (isColoured(id)) {
    if (face === 'S') { steps = 2; tag = 'skip'; }
    else if (face === 'V') { g.dir = (g.dir === 1 ? -1 : 1) as 1 | -1; tag = 'rev'; steps = active === 2 ? 2 : 1; }
    else if (face === '+2') { g.pend += 2; g.pendK = 'd2'; tag = 'd2'; tgt = next; }
    else if (face === '7' && g.house.swap70) {
      let best = -1;
      for (let s = 0; s < g.seats; s++) if (s !== seat && g.play[s] && (best < 0 || g.hands[s].length > g.hands[best].length)) best = s;
      if (best >= 0) { swapHands(g, seat, best); tag = 'swap7'; tgt = best; fx.push({ k: 'swap', a: seat, b: best }); }
    } else if (face === '0' && g.house.swap70) {
      const old = g.hands.map((h) => h.slice());
      for (let s = 0; s < g.seats; s++) if (g.play[s]) g.hands[nextIn(g, s, g.dir, 1)] = old[s];
      tag = 'swap0'; fx.push({ k: 'rot', dir: g.dir });
    }
  } else if (id === 'W+4') {
    g.pend += 4; g.pendK = 'w4'; tag = 'w4'; tgt = next;
  } else if (id === 'DEBT') {
    tag = 'debt'; tgt = next; g.debt[next] += o.debtUnit;
  } else if (id === 'COLLECTOR') {
    tag = 'coll';
    const cnt = new Array<number>(g.seats).fill(0);
    for (let s = 0; s < g.seats; s++) {
      if (!g.play[s]) continue;
      const keep: string[] = [];
      for (const c of g.hands[s]) { if (colourOf(c) === o.col) { g.disc.push(c); cnt[s]++; } else keep.push(c); }
      g.hands[s] = keep;
    }
    fx.push({ k: 'coll', col: o.col as string, cnt });
  } else if (id === 'CURSE') {
    tag = 'curse';
    if (o.wealthiest >= 0 && o.wealthiest !== seat && g.play[o.wealthiest]) {
      swapHands(g, seat, o.wealthiest); tgt = o.wealthiest; fx.push({ k: 'swap', a: seat, b: o.wealthiest });
    }
  } else if (id === 'JACKPOT') {
    tag = 'jp';
  }

  const win = winnerAfter(g, seat);
  const n = g.hands[seat].length;
  if (id === 'JACKPOT' && win === seat) g.jp = true;
  fx.unshift({ k: 'play', seat, id, col: g.col, fx: id === 'JACKPOT' && win !== seat ? '' : tag, tgt, n, j: !!o.jump });
  if (win >= 0) {
    g.over = true; g.winner = win; g.call = null; g.drawn = false;
    fx.push({ k: 'win', seat: win });
    return { err: '', fx };
  }
  if (n === 1) {
    const on = o.callOn === true || (g.call?.seat === seat && g.call.on);
    g.call = { seat, on };
    if (on) fx.push({ k: 'call', seat, on: true });
  } else {
    g.call = null;
  }
  g.turn = seatAfter(g, seat, steps);
  return { err: '', fx };
}

function swapHands(g: Game, a: number, b: number): void {
  const t = g.hands[a]; g.hands[a] = g.hands[b]; g.hands[b] = t;
}

/** Draw for the turn holder: owed stack first, else one card (playable at once with `drawToMatch`). */
export function applyDraw(g: Game, rng: Rng, seat: number): Result {
  if (g.over) return err('sk.eOver');
  if (seat !== g.turn) return err('sk.eNotTurn');
  if (g.drawn) return applyPass(g, seat);
  if (g.call && g.call.seat !== seat) g.call = null;
  if (g.pend > 0) {
    const n = g.pend;
    g.pend = 0; g.pendK = '';
    drawInto(g, rng, seat, n);
    g.turn = seatAfter(g, seat, 1);
    return { err: '', fx: [{ k: 'draw', seat, n }] };
  }
  const got = drawInto(g, rng, seat, 1);
  if (got.length === 0) { g.turn = seatAfter(g, seat, 1); return { err: '', fx: [{ k: 'pass', seat }] }; }
  if (g.house.drawToMatch && canPlay(g, seat, got[0])) {
    g.drawn = true; g.drawnId = got[0];
    return { err: '', fx: [{ k: 'draw', seat, n: 1 }] };
  }
  g.turn = seatAfter(g, seat, 1);
  return { err: '', fx: [{ k: 'draw', seat, n: 1 }] };
}

export function applyPass(g: Game, seat: number): Result {
  if (g.over) return err('sk.eOver');
  if (seat !== g.turn || !g.drawn) return err('sk.eNoDraw');
  g.drawn = false; g.drawnId = '';
  if (g.call && g.call.seat !== seat) g.call = null;
  g.turn = seatAfter(g, seat, 1);
  return { err: '', fx: [{ k: 'pass', seat }] };
}

/** LAST CARD (house rule): allowed with one card, or with two on your own turn (you will be down to one). */
export function applyCall(g: Game, seat: number): Result {
  if (g.over || !g.house.lastCard) return err('sk.eNoCall');
  const n = g.hands[seat].length;
  if (!(n === 1 || (n === 2 && seat === g.turn))) return err('sk.eNoCall');
  g.call = { seat, on: true };
  return { err: '', fx: [{ k: 'call', seat, on: true }] };
}

/** Catch an open LAST CARD: the accused draws two. */
export function applyCatch(g: Game, rng: Rng, seat: number): Result {
  if (g.over || !g.house.lastCard) return err('sk.eNoCatch');
  const c = g.call;
  if (!c || c.on || c.seat === seat || g.hands[c.seat].length !== 1) return err('sk.eNoCatch');
  const got = drawInto(g, rng, c.seat, 2);
  g.call = null;
  return { err: '', fx: [{ k: 'catch', seat: c.seat, by: seat, n: got.length }] };
}

/** After an action: owed stacks the next player cannot answer are taken automatically. Returns the new turn facts. */
export function settleTurn(g: Game, rng: Rng): Fx[] {
  const out: Fx[] = [];
  if (g.over) return out;
  for (let guard = 0; guard < g.seats + 1; guard++) {
    const t = g.turn;
    if (g.pend > 0 && !hasStack(g, t)) {
      const n = g.pend;
      g.pend = 0; g.pendK = '';
      drawInto(g, rng, t, n);
      out.push({ k: 'draw', seat: t, n });
      g.turn = seatAfter(g, t, 1);
      continue;
    }
    break;
  }
  out.push({ k: 'turn', seat: g.turn });
  return out;
}

// ── automatic and bot choices ───────────────────────────────────────────────────────────────────
/** The colour a colourless card should take: the colour the hand holds most of (ties at random for bots). */
export function bestColour(g: Game, seat: number, rng: Rng): string {
  const cnt: Record<string, number> = { R: 0, Y: 0, G: 0, B: 0 };
  for (const c of g.hands[seat]) if (isColoured(c)) cnt[colourOf(c)]++;
  const top = Math.max(...Object.values(cnt));
  const ties = COLOURS.filter((c) => cnt[c] === top);
  return rng.pick(ties);
}

/** Time-out / auto move for a human: owed cards, the drawn card, else the first legal play, else a draw. */
export function autoAct(g: Game, rng: Rng, seat: number, debtUnit: number, wealthiest: number): Result {
  if (g.pend > 0 && !g.drawn) {
    if (hasStack(g, seat)) {
      const id = g.hands[seat].find((c) => stackOk(g, c)) as string;
      return applyPlay(g, rng, seat, id, { debtUnit, wealthiest, col: wildColour(g, seat, id, rng) });
    }
    return applyDraw(g, rng, seat);
  }
  if (g.drawn) return applyPlay(g, rng, seat, g.drawnId, { debtUnit, wealthiest, col: wildColour(g, seat, g.drawnId, rng) });
  const opts = legal(g, seat);
  if (opts.length) {
    const id = opts[0];
    return applyPlay(g, rng, seat, id, { debtUnit, wealthiest, col: wildColour(g, seat, id, rng) });
  }
  return applyDraw(g, rng, seat);
}

function wildColour(g: Game, seat: number, id: string, rng: Rng): string | undefined {
  return isWild(id) ? bestColour(g, seat, rng) : undefined;
}

const CALL_P = [0.5, 0.8, 1];
const CATCH_P = [0.3, 0.7, 0.95];

/** Chance a bot of `level` (1–3) calls LAST CARD when it goes down to one card. */
export const botCallChance = (level: number): number => CALL_P[Math.max(0, Math.min(2, level - 1))];

/**
 * The four house mannequins, each with a habit the player can read and exploit. `id` keys the strings (`pr_<id>` tag,
 * `q_<id>_*` quips); the seat a bot sits in picks the persona (seat 0 Rattle ... seat 3 Madame Wick).
 *  - rash   Rattle: level 1. Throws wilds and specials early, forgets LAST CARD, slow to catch.
 *  - hoard  Mrs Gloom: level 2. Sits on her wilds until she is stuck or nearly out, then drops them.
 *  - grudge Tin Tom: level 2. Aims +2 / +4 / Skip / Debt at the human whenever he can.
 *  - shark  Madame Wick: level 3. Counts the table: attacks whoever is close to going out, never forgets LAST CARD.
 */
export interface Persona { id: 'rash' | 'hoard' | 'grudge' | 'shark'; level: 1 | 2 | 3; wild: number; atk: number; call: number; catchP: number }
export const PERSONAS: readonly Persona[] = [
  { id: 'rash', level: 1, wild: 1.9, atk: 0.4, call: 0.45, catchP: 0.3 },
  { id: 'hoard', level: 2, wild: 0.12, atk: 0.3, call: 0.8, catchP: 0.7 },
  { id: 'grudge', level: 2, wild: 0.9, atk: 1, call: 0.75, catchP: 0.75 },
  { id: 'shark', level: 3, wild: 0.6, atk: 0.7, call: 1, catchP: 0.95 },
];
export const personaOf = (seat: number): Persona => PERSONAS[((seat % 4) + 4) % 4];
const isAttack = (id: string): boolean => faceOf(id) === '+2' || faceOf(id) === 'S' || id === 'W+4' || id === 'DEBT' || id === 'CURSE';

/**
 * Bot brain (host only). Level 1 plays at random and forgets to catch often. Level 2 sheds high points and
 * keeps its dominant colour. Level 3 also attacks the player closest to winning and spends Curse / Debt on the
 * wealthiest or the leader.
 */
export function botDecide(g: Game, seat: number, level: number, rng: Rng, wealthiest: number, persona?: Persona, human = -1): Act {
  const lv = Math.max(1, Math.min(3, level));
  if (g.house.lastCard && g.call && !g.call.on && g.call.seat !== seat && !g.over
    && rng.chance(persona ? persona.catchP : CATCH_P[lv - 1])) return { k: 'catch' };
  if (g.drawn) {
    if (canPlay(g, seat, g.drawnId) && (lv === 1 ? rng.chance(0.6) : true)) {
      return { k: 'play', id: g.drawnId, col: isWild(g.drawnId) ? bestColour(g, seat, rng) : '' };
    }
    return { k: 'pass' };
  }
  const opts = legal(g, seat);
  if (opts.length === 0) return { k: 'draw' };
  let pick = opts[0];
  if (lv === 1 && !persona) pick = rng.pick(opts);
  else {
    const next = nextIn(g, seat, g.dir, 1);
    const nextLow = g.hands[next].length <= 2;
    let bestScore = -Infinity;
    for (const id of opts) {
      let s = 0;
      if (isNumber(id)) s = 10 + Number(faceOf(id)) * (lv === 3 ? 0.6 : 1);
      else if (faceOf(id) === '+2') s = 18 + (lv === 3 && nextLow ? 12 : 0);
      else if (faceOf(id) === 'S') s = 14 + (lv === 3 && nextLow ? 10 : 0);
      else if (faceOf(id) === 'V') s = 13;
      else if (id === 'W') s = lv === 3 ? 3 : 5;
      else if (id === 'W+4') s = lv === 3 ? 4 : 7;
      else if (id === 'DEBT') s = lv === 3 ? (g.hands[next].length > g.hands[seat].length ? 20 : 6) : 12;
      else if (id === 'COLLECTOR') s = 8 + (lv === 3 ? 4 : 2) * g.hands[seat].filter((c) => isColoured(c) && colourOf(c) === bestColour(g, seat, rng)).length;
      else if (id === 'CURSE') s = lv === 3 && wealthiest >= 0 && wealthiest !== seat && g.hands[seat].length > g.hands[wealthiest].length ? 26 : 4;
      else if (id === 'JACKPOT') s = lv === 3 ? 9 : 11;
      if (g.hands[seat].length <= 2 && (isWild(id) || faceOf(id) === '+2' || faceOf(id) === 'S')) s += 6;
      if (persona) {
        // habits: wild appetite, and attack cards aimed at the human (Tin Tom), the leader (Madame Wick) or at random (Rattle)
        if (isWild(id) && g.hands[seat].length > 2) s *= persona.wild;
        if (isAttack(id)) {
          const aimedAtHuman = human >= 0 && next === human;
          if (persona.id === 'grudge') s += aimedAtHuman ? 16 : 3;
          else if (persona.id === 'shark') s += nextLow ? 14 : g.hands[next].length <= 3 ? 7 : 0;
          else if (persona.id === 'rash') s += rng.float(0, 8) * persona.atk;
          else s += persona.atk * 3;
        }
        if (persona.id === 'rash' && lv === 1) s += rng.float(0, 10);   // erratic
      }
      s += rng.float(0, 1.5);
      if (s > bestScore) { bestScore = s; pick = id; }
    }
  }
  return { k: 'play', id: pick, col: isWild(pick) ? bestColour(g, seat, rng) : '' };
}

/**
 * Headless round for staff auto-play and balance sims (`def.headless`): four seats (the player in seat 0 plays the
 * level-2 brain), every seat antes `bet`, the winner takes the pot less the rake (×2 when the Jackpot won it).
 */
export const playHeadless: HeadlessPlay = (rng, bet) => {
  const g = startRound([true, true, true, true], rng, HOUSE_DEFAULT);
  settleTurn(g, rng);
  const lv = [2, ...PERSONAS.slice(1).map((p) => p.level)];   // seat 0 is the player (level-2 brain), seats 1-3 the house personas
  const per = (b: number): Persona | undefined => (b === 0 ? undefined : personaOf(b));
  for (let steps = 0; !g.over && steps < 800; steps++) {
    const win = g.call && !g.call.on ? g.call.seat : -1;
    let acted = false;
    for (let b = 0; win >= 0 && b < 4 && !acted; b++) {
      if (b === win) continue;
      if (botDecide(g, b, lv[b], rng, -1, per(b)).k === 'catch') acted = !applyCatch(g, rng, b).err;
    }
    if (!acted) {
      const s = g.turn;
      const d = botDecide(g, s, lv[s], rng, -1, per(s), 0);
      let res: Result;
      if (d.k === 'play') res = applyPlay(g, rng, s, d.id, { col: d.col || undefined, debtUnit: bet, wealthiest: -1, callOn: rng.chance(per(s)?.call ?? botCallChance(lv[s])) });
      else if (d.k === 'pass') res = applyPass(g, s);
      else if (d.k === 'call') res = applyCall(g, s);
      else res = applyDraw(g, rng, s);
      if (res.err) res = autoAct(g, rng, s, bet, -1);
    }
    settleTurn(g, rng);
  }
  const won = g.over && g.winner === 0;
  return { gross: won ? Math.floor(bet * 4 * (g.jp ? 2 : 1) * (1 - RAKE)) : 0, tags: won ? ['party'] : [] };
};
