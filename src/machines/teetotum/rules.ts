/**
 * Put-and-Take Top "Al-Ver Topacı" (`teetotum`) — pure rules and bot choices (no three, kit or DOM; DECISIONS C20).
 * Shared by the live table (`index.ts`) and the headless play contract, so the simulated RTP IS the live RTP.
 * Contract: MACHINES_tables §23.
 *
 * A pot cycle: every seat that covers the ante puts A in; turns run clockwise; each spin lands one of 8 faces
 * (weight 100 each, charm/luck hooks aside). Puts fill the pot, takes empty it, ALL takes the whole pot (rake), a
 * cycle ends on an empty pot, on ALL, or after SPIN_CAP spins (the pot is then split among the seats still in).
 * Seats are 0..5 in clockwise order. Money moves only through the `Charge` callback (the host's wallet / bots).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Face = 'p1' | 'p2' | 'pa' | 'm1' | 'm2' | 'half' | 'all' | 'none';
/** Ordered faces of the top (index = pictogram column on the face strip). */
export const FACES: readonly Face[] = ['p1', 'p2', 'pa', 'm1', 'm2', 'half', 'all', 'none'];
export const SEATS = 6;
export const SPIN_CAP = 20;
export const RAKE = 0.05;
export const RAKE_L25 = 0.04;
export const RAKE_MAX = 0.5;
export const BASE_WEIGHT = 100;
export const ANTES: readonly number[] = [5, 20, 100];
export const ANTE_L10 = 500;
/** Table minimum: bots keep at least this many players at a table (the rest of the seats stay for humans). */
export const MIN_PLAYERS = 3;
/** E[seat stake] / ante over a three-seat cycle (player in seat 0), measured by a 1e6-cycle Node sim. */
export const STAKE_PER_ANTE = 2.4787;

export const isPut = (f: Face): boolean => f === 'p1' || f === 'p2' || f === 'pa';
export const isTake = (f: Face): boolean => f === 'm1' || f === 'm2' || f === 'half' || f === 'all';
/** Double (declared before the spin) multiplies the ±1 / ±2 amounts only. */
export const isDoubleable = (f: Face): boolean => f === 'p1' || f === 'p2' || f === 'm1' || f === 'm2';

/** Antes on offer: L10 adds the 500 table. */
export const anteLadder = (l10: boolean): number[] => (l10 ? [...ANTES, ANTE_L10] : [...ANTES]);

/** Rake rate: 5 %, 4 % from L25, plus the `x.table.rakeDelta` charm hook. Clamped to [0, 50 %]. */
export function rakeRate(l25: boolean, delta: number): number {
  const base = l25 ? RAKE_L25 : RAKE;
  return Math.min(RAKE_MAX, Math.max(0, base + delta));
}

/** Face weights: base 100 plus integer hook adds (never below 0). */
export function faceWeights(extra: Partial<Record<Face, number>> = {}): number[] {
  return FACES.map((f) => Math.max(0, BASE_WEIGHT + Math.round(extra[f] ?? 0)));
}
export function drawFace(rng: Rng, weights: readonly number[]): Face {
  return FACES[rng.weightedIndex(weights)];
}

/** Coins a put face moves into the pot from one payer (before any charge). */
export function putAmount(f: Face, ante: number, doubled: boolean): number {
  const k = doubled ? 2 : 1;
  if (f === 'p1') return ante * k;
  if (f === 'p2') return 2 * ante * k;
  if (f === 'pa') return ante;
  return 0;
}
/** Coins a take face asks for from the pot (the caller caps it at the pot). Half and ALL ignore Double. */
export function takeAmount(f: Face, pot: number, ante: number, doubled: boolean): number {
  const k = doubled ? 2 : 1;
  if (f === 'm1') return ante * k;
  if (f === 'm2') return 2 * ante * k;
  if (f === 'half') return Math.floor(pot / 2);
  if (f === 'all') return pot;
  return 0;
}

export type Charge = (seat: number, amount: number) => boolean;
export interface Move { seat: number; delta: number }      // delta > 0: into the pot · < 0: out of the pot
export interface Opts {
  rakeRate: number;
  /** House-paid bonus on every take (fraction, e.g. 0.05). Never comes out of the pot. */
  takeBonus: number;
  /** Golden face of this cycle (L50): its take pays double. */
  golden: Face | null;
}
export interface Cycle {
  ante: number;
  /** Seats still in this cycle, ascending (clockwise). */
  live: number[];
  /** Seats that could not cover a put and sit out until the next cycle. */
  sat: boolean[];
  pot: number;
  spins: number;
  stake: number[];   // per seat: ante + puts this cycle
  won: number[];     // per seat: gross payout this cycle (takes, rake already removed, house bonus included)
  shield: number[];  // per seat: puts still negated this cycle (charm)
  rake: number;
  bonus: number;     // house-paid bonus accrued (not from the pot)
  done: boolean;
  split: boolean;    // ended by the spin cap, a lone seat or a refund (not by ALL / an empty pot)
}
export interface Step { face: Face; doubled: boolean; moves: Move[]; rake: number; done: boolean; split: boolean }

const zeros = (): number[] => new Array<number>(SEATS).fill(0);

/**
 * Open a pot cycle: every seat in `seats` that the charge accepts puts the ante in. With fewer than two seats in,
 * the cycle is refunded at once (`done`, `split`, `won` = `stake`).
 */
export function openCycle(ante: number, seats: readonly number[], charge: Charge, shield: readonly number[] = []): Cycle {
  const c: Cycle = {
    ante, live: [], sat: new Array<boolean>(SEATS).fill(false), pot: 0, spins: 0,
    stake: zeros(), won: zeros(), shield: zeros().map((_, s) => Math.max(0, shield[s] ?? 0)),
    rake: 0, bonus: 0, done: false, split: false,
  };
  for (const s of [...seats].sort((a, b) => a - b)) {
    if (charge(s, ante)) { c.live.push(s); c.stake[s] += ante; c.pot += ante; } else c.sat[s] = true;
  }
  if (c.live.length < 2) {
    c.stake.forEach((st, s) => { c.won[s] = st; });
    c.pot = 0; c.done = true; c.split = true;
  }
  return c;
}

/** Next seat still in the cycle after `after` (clockwise, wrapping). −1 when nobody is left. */
export function nextSeat(c: Cycle, after: number): number {
  if (c.live.length === 0) return -1;
  const hi = c.live.find((s) => s > after);
  return hi !== undefined ? hi : c.live[0];
}

function contributors(c: Cycle): number[] {
  const out: number[] = [];
  for (let s = 0; s < SEATS; s++) if (c.stake[s] > 0) out.push(s);
  return out;
}

/**
 * Land one spin for `seat` (must be live). Puts are charged through `charge`; a failed put seats the player out for the
 * rest of the cycle and the put is skipped. Takes move coins out of the pot; the house bonus is paid on top.
 */
export function spin(c: Cycle, seat: number, face: Face, doubled: boolean, charge: Charge, o: Opts): Step {
  if (c.done) throw new Error('teetotum: spin on a finished cycle');
  const dbl = doubled && isDoubleable(face);
  const moves: Move[] = [];
  const rakeBefore = c.rake;
  c.spins++;

  if (isPut(face)) {
    const payers = face === 'pa' ? [...c.live] : [seat];
    const amt = putAmount(face, c.ante, dbl);
    for (const p of payers) {
      if (!c.live.includes(p)) continue;
      if (c.shield[p] > 0) { c.shield[p]--; continue; }
      if (charge(p, amt)) {
        c.stake[p] += amt; c.pot += amt; moves.push({ seat: p, delta: amt });
      } else {
        c.sat[p] = true; c.live = c.live.filter((x) => x !== p);
      }
    }
  } else if (face === 'all') {
    const rake = Math.floor(c.pot * o.rakeRate);
    const gross = c.pot - rake;
    moves.push({ seat, delta: -c.pot });
    c.rake += rake;
    c.won[seat] += gross;
    c.bonus += Math.floor(gross * o.takeBonus);
    c.won[seat] += Math.floor(gross * o.takeBonus);
    c.pot = 0; c.done = true;
  } else if (isTake(face)) {
    const mult = o.golden === face ? 2 : 1;
    const got = Math.min(takeAmount(face, c.pot, c.ante, dbl) * mult, c.pot);
    if (got > 0) {
      c.pot -= got;
      c.won[seat] += got;
      moves.push({ seat, delta: -got });
      const extra = Math.floor(got * o.takeBonus);
      c.won[seat] += extra; c.bonus += extra;
    }
  }

  if (!c.done && c.pot === 0) c.done = true;
  if (!c.done && (c.spins >= SPIN_CAP || c.live.length <= 1)) settlePot(c, o.rakeRate, moves);
  return { face, doubled: dbl, moves, rake: c.rake - rakeBefore, done: c.done, split: c.split };
}

/** Split whatever is left: rake first, the rest equally among the seats still in (the odd coin to the first). */
function settlePot(c: Cycle, rate: number, moves: Move[]): void {
  const pot = c.pot;
  const who = c.live.length ? [...c.live] : contributors(c);
  const rake = who.length ? Math.floor(pot * rate) : pot;
  const rest = pot - rake;
  if (who.length) {
    const share = Math.floor(rest / who.length);
    const left = rest - share * who.length;
    who.forEach((s, i) => {
      const g = share + (i === 0 ? left : 0);
      c.won[s] += g;
      if (g > 0) moves.push({ seat: s, delta: -g });
    });
  }
  c.rake += rake;
  c.pot = 0; c.done = true; c.split = true;
}

/** Bot choice: whether to declare Double before the spin. Level 1 never, 2 rarely, 3 when the pot is fat. */
export function botDouble(rng: Rng, level: 1 | 2 | 3, c: Cycle): boolean {
  if (level === 1 || c.pot < 4 * c.ante) return false;
  return rng.chance(level === 2 ? 0.1 : 0.25);
}

/** Luck against bots: chance that a losing face (a put) is respun once. `luck` is in percent. */
export function luckChance(luck: number): number {
  return Math.min(1, Math.max(0, luck / 100));
}

/** Stochastic rounding to whole coins (unbiased). */
export const roundCoins = (x: number, rng: Rng): number => Math.floor(x + rng.next());

/**
 * Headless round for staff auto-play and the balance sims: a three-seat table (the player in seat 0, two bots), the
 * player's ante = `bet`, the cycle played to the end. Gross = the player's share of the cycle scaled to the stake.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const ante = Math.max(1, Math.round(bet));
  const c = openCycle(ante, [0, 1, 2], () => true);
  // charm face weights apply to the player's own spins (no other human is seated headlessly)
  const playerExtra: Partial<Record<Face, number>> = {};
  for (const f of FACES) playerExtra[f] = h.mod(`m.teetotum.faceWeight.${f}` as ModHook, 0);
  const weightsFor = (seat: number): number[] => (seat === 0 ? faceWeights(playerExtra) : faceWeights());
  const o: Opts = {
    rakeRate: rakeRate(false, h.mod('x.table.rakeDelta', 0)),
    takeBonus: Math.max(0, h.mod('m.teetotum.takeBonus', 0)),
    golden: null,
  };
  const p = luckChance(h.luck);
  let turn = c.live[rng.int(0, c.live.length - 1)];
  while (!c.done) {
    const seat = turn;
    let face = drawFace(rng, weightsFor(seat));
    if (seat === 0 && isPut(face) && rng.chance(p)) face = drawFace(rng, weightsFor(seat));
    const dbl = seat !== 0 && botDouble(rng, 2, c);
    spin(c, seat, face, dbl, () => true, o);
    if (c.done) break;
    turn = nextSeat(c, seat);
  }
  // E[gross] = bet × E[won] / E[stake]: the player's stake per cycle averages STAKE_PER_ANTE × ante
  return { gross: roundCoins((c.won[0] * bet) / (ante * STAKE_PER_ANTE), rng) };
};
