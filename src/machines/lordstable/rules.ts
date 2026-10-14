/**
 * The Lords' Table: Russian roulette with an old revolver, pure rules (Hollow Door, `src/game/hollow/rules.ts`).
 * No three, kit or DOM. Shared by the live table (`index.ts`) and the tests.
 *
 * Gun: six chambers. The bullets sit in fixed slots (hidden). `hammer` is the chamber the next pull lands on.
 * A pull on an empty chamber clicks and moves the hammer one chamber on. A pull on a bullet fires and the duel ends.
 * Both sides pull at THEMSELVES, the player first, and the turn passes on every click.
 *
 *  - Lord of Ash (1 bullet) and Lord of Ledgers (2 bullets) just pull.
 *  - Re-spin (player, costs 1 Ticket): the cylinder turns 1..6 clicks, so the hammer lands on a uniform chamber.
 *  - Lord of Mirrors (1 bullet) announces a spin before every pull. An honest spin turns 1..6 clicks. A FAKE spin turns
 *    nothing: the hammer stays on the chamber just clicked, which is empty, so his pull clicks for sure. Three public
 *    clues show the difference and all come from one signal (see `SpinClue`): 0 clicks, no mask reflection, and the
 *    cylinder stops on the same notch. The player calls CHEAT before his pull. A correct call wins at once; a wrong call
 *    makes the player pull twice in a row on his next turn.
 *
 * Odds without re-spins: Ash is exactly 50/50 (with one bullet the player hits chambers 0, 2, 4 and the Lord 1, 3, 5).
 */
import type { Rng } from '@/core/rng';
import type { LordId } from '@/game/hollow/rules';

export const CHAMBERS = 6;
export const SPIN_TICKETS = 1;
/** Chance that the Lord of Mirrors fakes an announced spin on a given turn. */
export const MIRROR_CHEAT_P = 0.5;
export const PLAYER = 0;
export const LORD = 1;
export type Side = 0 | 1;

export interface LordSpec {
  /** Bullets in the cylinder. */
  bullets: number;
  /** Announces a spin before every pull (the call window is open on each Lord turn). */
  announces: boolean;
  /** The announced spin can be a fake. */
  cheats: boolean;
}
/** The Lords in the order of the table's three chairs (Hollow Door order). */
export const LORDS: readonly LordId[] = ['ash', 'ledgers', 'mirrors'];
export const LORD_SPEC: Readonly<Record<LordId, LordSpec>> = {
  ash: { bullets: 1, announces: false, cheats: false },
  ledgers: { bullets: 2, announces: false, cheats: false },
  mirrors: { bullets: 1, announces: true, cheats: true },
};

/** The public clues of an announced spin. A fake spin shows 0 clicks, no reflection and the same notch. */
export interface SpinClue { clicks: number; reflect: boolean }
export type Outcome = 'won' | 'taken';

export interface Game {
  readonly lord: LordId;
  /** Hidden bullet slots, length 6. */
  readonly loaded: boolean[];
  /** The chamber the next pull lands on, 0..5. */
  hammer: number;
  turn: Side;
  /** Extra consecutive player pulls owed (1 after a wrong call). */
  owed: number;
  tickets: number;
  pulls: number;
  /** Hidden: the spin the Lord announced is a fake. Only meaningful while `pending` is open. */
  cheat: boolean;
  /** The Lord's announced spin, public clues, until he pulls or is called. */
  pending: SpinClue | null;
  over: null | { outcome: Outcome; by: 'fire' | 'call'; calledCorrect: boolean };
}

export type Ev =
  | { k: 'turn'; seat: Side; owed: number }
  | { k: 'spin'; seat: Side; clicks: number; reflect: boolean }
  | { k: 'pull'; seat: Side; fired: boolean; chamber: number }
  | { k: 'call'; correct: boolean; cheat: boolean }
  | { k: 'over'; outcome: Outcome; by: 'fire' | 'call'; calledCorrect: boolean };

const next = (h: number, k: number): number => (h + k) % CHAMBERS;

export function newGame(lord: LordId, rng: Rng, tickets: number): Game {
  const slots = [0, 1, 2, 3, 4, 5];
  rng.shuffle(slots);
  const loaded = Array<boolean>(CHAMBERS).fill(false);
  for (let i = 0; i < LORD_SPEC[lord].bullets; i++) loaded[slots[i]] = true;
  return {
    lord, loaded, hammer: rng.int(0, CHAMBERS - 1), turn: PLAYER, owed: 0, tickets: Math.max(0, tickets),
    pulls: 0, cheat: false, pending: null, over: null,
  };
}

/** The player's re-spin before his pull: costs one Ticket and turns the cylinder 1..6 clicks. Null when not allowed. */
export function respin(g: Game, rng: Rng): Ev[] | null {
  if (g.over || g.turn !== PLAYER || g.tickets < SPIN_TICKETS) return null;
  g.tickets -= SPIN_TICKETS;
  const k = rng.int(1, CHAMBERS);
  g.hammer = next(g.hammer, k);
  return [{ k: 'spin', seat: PLAYER, clicks: k, reflect: true }];
}

/** The player pulls at himself. Null when it is not his turn or the duel is over. */
export function playerPull(g: Game): Ev[] | null {
  if (g.over || g.turn !== PLAYER) return null;
  return pull(g, PLAYER);
}

/**
 * The Lord's turn starts. Announcing Lords roll their spin now: an honest spin turns 1..6 clicks; a fake one turns nothing
 * and leaves the hammer on the empty chamber just clicked. The clues are public until the Lord pulls or is called.
 * Non-announcing Lords return no events and go straight to `lordPull`.
 */
export function lordTurn(g: Game, rng: Rng): Ev[] {
  if (g.over || g.turn !== LORD) return [];
  const spec = LORD_SPEC[g.lord];
  if (!spec.announces) return [];
  const cheat = spec.cheats && rng.chance(MIRROR_CHEAT_P);
  let clue: SpinClue;
  if (cheat) {
    g.hammer = (g.hammer + CHAMBERS - 1) % CHAMBERS;   // back onto the chamber just clicked: empty
    clue = { clicks: 0, reflect: false };
  } else {
    const k = rng.int(1, CHAMBERS);
    g.hammer = next(g.hammer, k);
    clue = { clicks: k, reflect: true };
  }
  g.cheat = cheat;
  g.pending = clue;
  return [{ k: 'spin', seat: LORD, clicks: clue.clicks, reflect: clue.reflect }];
}

/** The Lord pulls at himself (after the call window). Null when it is not the Lord's turn. */
export function lordPull(g: Game): Ev[] | null {
  if (g.over || g.turn !== LORD) return null;
  g.pending = null;
  g.cheat = false;
  return pull(g, LORD);
}

/**
 * The player calls CHEAT on the announced spin. A correct call ends the duel in the player's favour at once. A wrong
 * call owes the player one extra pull (two in a row on his next turn). Null when no announcement is open.
 */
export function call(g: Game): Ev[] | null {
  if (g.over || !g.pending) return null;
  const correct = g.cheat;
  g.pending = null;
  g.cheat = false;
  if (correct) {
    g.over = { outcome: 'won', by: 'call', calledCorrect: true };
    return [{ k: 'call', correct: true, cheat: true }, { k: 'over', outcome: 'won', by: 'call', calledCorrect: true }];
  }
  g.owed = 1;
  return [{ k: 'call', correct: false, cheat: false }];
}

function pull(g: Game, seat: Side): Ev[] {
  const chamber = g.hammer;
  const fired = g.loaded[chamber];
  g.pulls++;
  const ev: Ev[] = [{ k: 'pull', seat, fired, chamber }];
  if (fired) {
    const outcome: Outcome = seat === PLAYER ? 'taken' : 'won';
    g.over = { outcome, by: 'fire', calledCorrect: false };
    ev.push({ k: 'over', outcome, by: 'fire', calledCorrect: false });
    return ev;
  }
  g.hammer = next(g.hammer, 1);
  if (seat === PLAYER && g.owed > 0) {
    g.owed--;                                              // a still-owed pull keeps the turn with the player
  } else {
    g.turn = seat === PLAYER ? LORD : PLAYER;
    ev.push({ k: 'turn', seat: g.turn, owed: g.owed });
  }
  return ev;
}

// ── headless play (tests, QA, balance) ────────────────────────────────────────────────────────

/** A scripted player: when to re-spin, and whether to call a shown spin. */
export interface Policy {
  spin(g: Game): boolean;
  call(spin: SpinClue): boolean;
}
export const NEVER: Policy = { spin: () => false, call: () => false };
/** Calls only when the public clues say the spin is fake (0 clicks, no reflection). Always right. */
export const DETECTIVE: Policy = { spin: () => false, call: (s) => s.clicks === 0 || !s.reflect };
/** Re-spins whenever a Ticket is left. */
export const SPINNER: Policy = { spin: (g) => g.tickets >= SPIN_TICKETS, call: () => false };

export interface SimResult {
  outcome: Outcome;
  by: 'fire' | 'call';
  calledCorrect: boolean;
  /** One entry per call the policy made: true when the call was right (the spin was fake). */
  calls: boolean[];
  pulls: number;
}

/** Plays one whole duel with `policy`. All randomness comes from `rng`. Throws if the rules fail to terminate. */
export function simulate(lord: LordId, rng: Rng, policy: Policy, tickets = 0): SimResult {
  const g = newGame(lord, rng, tickets);
  const calls: boolean[] = [];
  for (let guard = 0; guard < 10_000 && !g.over; guard++) {
    if (g.turn === PLAYER) {
      if (policy.spin(g)) respin(g, rng);
      playerPull(g);
      continue;
    }
    lordTurn(g, rng);
    if (g.pending && policy.call(g.pending)) {
      calls.push(g.cheat);
      call(g);
    }
    if (!g.over) lordPull(g);
  }
  if (!g.over) throw new Error('lordstable: duel did not terminate');
  return { outcome: g.over.outcome, by: g.over.by, calledCorrect: g.over.calledCorrect, calls, pulls: g.pulls };
}
