/**
 * The Devil's Table — SHELLS duel, pure rules (MACHINES_tables §5A, BRIEF Addendum 7). No three, kit or DOM.
 *
 * Shared by the live table (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS the
 * live RTP. Every function mutates a `Game` and returns the public / private events it produced; the host emits them.
 *
 * Model: 4 seats (0 = player chair, 1 = Devil chair, 2/3 = side stools). Each load is a shuffled magazine of LIVE and
 * BLANK shells (`mag[0]` is the chamber). A shot removes the chamber; LIVE costs charges (misfire may turn it into a
 * BLANK); a BLANK at yourself keeps the turn. A round ends when one active seat is left with charges.
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export type Shell = 'L' | 'B';
export type ItemId =
  | 'loupe' | 'tonic' | 'cuffs' | 'mint' | 'hacksaw' | 'burner' | 'inverter' | 'adrenaline' | 'pills' | 'chip' | 'mirror' | 'coin';

export const ITEM_IDS: readonly ItemId[] = [
  'loupe', 'tonic', 'cuffs', 'mint', 'hacksaw', 'burner', 'inverter', 'adrenaline', 'pills', 'chip', 'mirror', 'coin',
];
/** Draw weights out of 120 (§5A.3). */
export const ITEM_WEIGHT: Readonly<Record<ItemId, number>> = {
  loupe: 16, tonic: 14, cuffs: 10, mint: 14, hacksaw: 10, burner: 12, inverter: 10, adrenaline: 8, pills: 12, chip: 6, mirror: 4, coin: 4,
};
/** Items that need a target seat. */
export const ITEM_TARGETED: ReadonlySet<ItemId> = new Set<ItemId>(['cuffs', 'adrenaline']);

export const SEATS = 4;
export const ROUNDS_TO_WIN = 2;
export const ROUND_CHARGES: readonly number[] = [2, 4, 6];
export const ROUND_SHELLS: ReadonlyArray<readonly [number, number]> = [[2, 4], [3, 6], [4, 8]];
export const ROUND_ITEMS: readonly number[] = [0, 2, 4];
export const TRAY_CAP = 8;
export const PAYOUT = 1.9;
export const CHIP_PAYOUT = 3.8;
export const RAKE = 0.05;
export const MAX_RIDES = 3;
const MISFIRE_CAP = 0.30;

/** Charm hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_MISFIRE = 'm.devilstable.misfireAdd' as ModHook;   // float added to L/100 (cap 0.5)

/** Per-seat state. `luck` is the seat's misfire luck (L), `known` the chamber this seat has seen (Loupe). */
export interface SeatS {
  active: boolean;
  human: boolean;
  luck: number;
  charges: number;
  max: number;
  items: ItemId[];
  skip: boolean;
  cuffed: number;
  saw: boolean;
  mirror: boolean;
  chip: boolean;
  known: Shell | null;
  misfired: boolean;
  coined: boolean;
  wins: number;
}

export interface Game {
  seats: SeatS[];
  round: number;            // 1..3
  mag: Shell[];             // mag[0] = chamber (fires next). Order is hidden from everyone but the chamber's owner.
  live: number;             // PUBLIC remaining LIVE count (what the tray showed, minus what has been fired)
  blank: number;            // PUBLIC remaining BLANK count
  turn: number;
  roundDone: boolean;
}

/** Public events (`k` names match §5A.9) plus two private ones (`peek`, `whisper`). */
export type Ev =
  | { k: 'round'; round: number; charges: number[] }
  | { k: 'load'; round: number; n: number; live: number; blank: number; items: Array<[number, ItemId[]]> }
  | { k: 'turn'; seat: number }
  | { k: 'item'; seat: number; item: ItemId; target: number }
  | { k: 'eject'; seat: number; shell: Shell }
  | { k: 'steal'; seat: number; from: number; item: ItemId }
  | { k: 'mirror'; seat: number; to: number }
  | { k: 'misfire'; seat: number }
  | { k: 'shot'; seat: number; target: number; live: boolean; dmg: number; misfire: boolean; keep: boolean }
  | { k: 'charges'; seats: number[] }
  | { k: 'roundEnd'; winner: number; round: number }
  | { k: 'peek'; seat: number; shell: Shell }                 // PRIVATE (Loupe)
  | { k: 'whisper'; seat: number; n: number; shell: Shell | null }; // PRIVATE (Burner Phone): shell #n

export type Choice = { k: 'item'; id: ItemId; target: number } | { k: 'fire'; target: number };
export interface Skill { items: boolean; bluff: number }

export const DEVIL_SKILL: Skill = { items: true, bluff: 0.67 };   // tuned: player wins 50.0 % vs BASIC_SKILL (200k matches)
export const BASIC_SKILL: Skill = { items: false, bluff: 0 };

export const gross = (stake: number, chip: boolean): number => stake * (chip ? CHIP_PAYOUT : PAYOUT);
/** PvP: the match winner takes N·S minus the rake. */
export const pvpPot = (stake: number, n: number): number => stake * n * (1 - RAKE);

export function newGame(seats: Array<Pick<SeatS, 'active' | 'human' | 'luck'>>): Game {
  return {
    seats: Array.from({ length: SEATS }, (_, i) => freshSeat(seats[i])),
    round: 0, mag: [], live: 0, blank: 0, turn: 0, roundDone: true,
  };
}
function freshSeat(c?: Pick<SeatS, 'active' | 'human' | 'luck'>): SeatS {
  return {
    active: !!c?.active, human: !!c?.human, luck: c?.luck ?? 0, charges: 0, max: 0, items: [], skip: false, cuffed: -1,
    saw: false, mirror: false, chip: false, known: null, misfired: false, coined: false, wins: 0,
  };
}

export const alive = (g: Game, s: number): boolean => s >= 0 && g.seats[s].active && g.seats[s].charges > 0;
export const aliveCount = (g: Game): number => g.seats.filter((_, i) => alive(g, i)).length;
export const activeSeats = (g: Game): number[] => g.seats.flatMap((S, i) => (S.active ? [i] : []));

/** The match winner (first to `ROUNDS_TO_WIN` round wins), or -1 while the match is open. */
export function matchWinner(g: Game): number {
  return g.seats.findIndex((S) => S.active && S.wins >= ROUNDS_TO_WIN);
}

/** Next seat clockwise (index order) that is alive and due a turn. A cuffed seat loses one turn. */
export function advance(g: Game, from: number): number {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (from + i) % SEATS;
      const S = g.seats[s];
      if (!alive(g, s)) continue;
      if (pass === 0 && S.skip) { S.skip = false; continue; }
      return s;
    }
  }
  return -1;
}

/** Escalation tier of the round (rounds beyond 3 keep the 3rd tier). */
const tier = (g: Game): number => Math.min(g.round, ROUND_CHARGES.length) - 1;

/** Start round `round` (1..3): reset charges and per-round flags, pick the first shooter, deal the first load. */
export function startRound(g: Game, rng: Rng, round: number): Ev[] {
  g.round = round;
  g.roundDone = false;
  g.mag = []; g.live = 0; g.blank = 0;
  const charges = ROUND_CHARGES[tier(g)];
  for (const S of g.seats) {
    S.charges = S.active ? charges : 0; S.max = charges; S.items = []; S.skip = false; S.cuffed = -1;
    S.saw = false; S.mirror = false; S.known = null; S.misfired = false; S.coined = false;
  }
  const act = activeSeats(g);
  g.turn = act[(round - 1) % act.length];                              // the first shooter alternates
  return [{ k: 'round', round, charges: g.seats.map((S) => S.charges) }, ...load(g, rng)];
}

/** Load a fresh magazine (counts public, order hidden) and deal items to every active seat. */
export function load(g: Game, rng: Rng): Ev[] {
  const [lo, hi] = ROUND_SHELLS[tier(g)];
  const n = rng.int(lo, hi);
  let live = Math.floor(n / 2);
  if (n % 2 === 1 && rng.chance(0.5)) live++;
  live = Math.min(n - 1, Math.max(1, live));                          // always ≥ 1 of each
  const shells: Shell[] = [];
  for (let i = 0; i < n; i++) shells.push(i < live ? 'L' : 'B');
  rng.shuffle(shells);
  g.mag = shells; g.live = live; g.blank = n - live;
  const per = ROUND_ITEMS[tier(g)];
  const weights = ITEM_IDS.map((id) => ITEM_WEIGHT[id]);
  const items: Array<[number, ItemId[]]> = [];
  g.seats.forEach((S, s) => {
    if (!S.active || per === 0) return;
    const dealt: ItemId[] = [];
    for (let i = 0; i < per; i++) {
      const id = rng.weighted(ITEM_IDS, weights);
      if (S.items.length < TRAY_CAP) { S.items.push(id); dealt.push(id); }   // overflow beyond the cap is discarded
    }
    items.push([s, dealt]);
  });
  return [{ k: 'load', round: g.round, n, live, blank: n - live, items }];
}

/** Fire the chamber. `target` may be the shooter. Returns the events, or null when the shot is not legal now. */
export function fire(g: Game, rng: Rng, s: number, target: number): Ev[] | null {
  if (g.roundDone || g.turn !== s || !alive(g, s) || !alive(g, target) || g.mag.length === 0) return null;
  const S = g.seats[s];
  const ev: Ev[] = [];
  const shell = g.mag.shift()!;
  let tgt = target;
  let live = shell === 'L';
  if (live && tgt === s && S.mirror) {                                  // Mirror: the self-shot bounces to the next seat
    S.mirror = false;
    const to = nextSeat(g, s);
    ev.push({ k: 'mirror', seat: s, to });
    tgt = to;
  }
  const T = g.seats[tgt];
  let misfire = false;
  if (live && T.luck > 0 && !T.misfired) {                              // luck: a LIVE shot may misfire, once per round
    const p = Math.min(MISFIRE_CAP, T.luck / 100);
    if (rng.next() < p) { misfire = true; live = false; T.misfired = true; ev.push({ k: 'misfire', seat: tgt }); }
  }
  let dmg = 0;
  if (live) {
    dmg = S.saw ? 2 : 1;
    T.charges = Math.max(0, T.charges - dmg);
  }
  spend(g, shell);                                                      // the tray counts the spent shell
  S.saw = false;
  for (const X of g.seats) X.known = null;                               // the chamber is gone
  const self = tgt === s;
  const keep = !live && self;
  ev.push({ k: 'shot', seat: s, target: tgt, live, dmg, misfire, keep });
  ev.push({ k: 'charges', seats: g.seats.map((X) => X.charges) });
  const left = aliveCount(g);
  if (left <= 1) {
    g.roundDone = true;
    const winner = g.seats.findIndex((_, i) => alive(g, i));
    if (winner >= 0) g.seats[winner].wins++;
    ev.push({ k: 'roundEnd', winner, round: g.round });
    return ev;
  }
  if (!keep) g.turn = advance(g, s);
  if (g.mag.length === 0) ev.push(...load(g, rng));
  ev.push({ k: 'turn', seat: g.turn });
  return ev;
}

/**
 * Take one shell off the PUBLIC tray counts. Normally the spent type; after an Inverter flip the public count of that
 * type may already be 0, so the other count goes down instead. The two counts always sum to the magazine length.
 */
function spend(g: Game, shell: Shell): void {
  const first = shell === 'L' ? 'live' : 'blank', other = shell === 'L' ? 'blank' : 'live';
  if (g[first] > 0) g[first]--; else g[other] = Math.max(0, g[other] - 1);
}

/** Next alive seat clockwise after `s` (may be `s` itself when nobody else is left). */
function nextSeat(g: Game, s: number): number {
  for (let i = 1; i <= SEATS; i++) {
    const t = (s + i) % SEATS;
    if (alive(g, t)) return t;
  }
  return s;
}

/** Use an item from the tray slot `id` (first copy). Null when it is not legal now. */
export function use(g: Game, rng: Rng, s: number, id: ItemId, target: number): Ev[] | null {
  if (g.roundDone || g.turn !== s || !alive(g, s)) return null;
  const S = g.seats[s];
  const idx = S.items.indexOf(id);
  if (idx < 0) return null;
  if (ITEM_TARGETED.has(id) && (target < 0 || target === s || !alive(g, target))) return null;
  if (id === 'cuffs' && S.cuffed === target) return null;               // not the same seat two turns running
  if (id === 'coin' && S.coined) return null;
  S.items.splice(idx, 1);
  const ev: Ev[] = [{ k: 'item', seat: s, item: id, target: ITEM_TARGETED.has(id) ? target : -1 }];
  switch (id) {
    case 'loupe':
      S.known = g.mag[0];
      ev.push({ k: 'peek', seat: s, shell: g.mag[0] });
      break;
    case 'tonic': {                                                     // rack the gun: the chamber is ejected, shown to all
      const shell = g.mag.shift()!;
      spend(g, shell);
      for (const X of g.seats) X.known = null;
      ev.push({ k: 'eject', seat: s, shell });
      if (g.mag.length === 0) ev.push(...load(g, rng));
      break;
    }
    case 'cuffs':
      g.seats[target].skip = true;
      S.cuffed = target;
      break;
    case 'mint':
      S.charges = Math.min(S.max, S.charges + 1);
      break;
    case 'hacksaw':
      S.saw = true;
      break;
    case 'burner': {                                                    // whisper the type of shell #k, k ≥ 2
      if (g.mag.length < 2) { ev.push({ k: 'whisper', seat: s, n: 0, shell: null }); break; }
      const j = rng.int(1, g.mag.length - 1);
      ev.push({ k: 'whisper', seat: s, n: j + 1, shell: g.mag[j] });
      break;
    }
    case 'inverter': {                                                  // flip the chamber silently (the user knows what they did)
      const knew = S.known !== null;
      g.mag[0] = g.mag[0] === 'L' ? 'B' : 'L';
      S.known = knew ? g.mag[0] : null;
      break;
    }
    case 'adrenaline': {                                                // steal one item from the target and use it now
      const pool = g.seats[target].items.filter((i) => i !== 'adrenaline');
      if (pool.length === 0) break;
      const stolen = rng.pick(pool);
      g.seats[target].items.splice(g.seats[target].items.indexOf(stolen), 1);
      ev.push({ k: 'steal', seat: s, from: target, item: stolen });
      S.items.push(stolen);                                             // in the tray for the instant of use
      const after = use(g, rng, s, stolen, target);                     // refused: it simply stays with the thief
      if (after) ev.push(...after);
      break;
    }
    case 'pills':
      if (rng.chance(0.5)) S.charges = Math.min(S.max, S.charges + 2);
      else S.charges = Math.max(1, S.charges - 1);
      break;
    case 'chip':
      S.chip = true;
      break;
    case 'mirror':
      S.mirror = true;
      break;
    case 'coin':                                                        // discard the rest of the load, reload now
      S.coined = true;
      g.mag = []; g.live = 0; g.blank = 0;
      ev.push(...load(g, rng));
      break;
  }
  ev.push({ k: 'charges', seats: g.seats.map((X) => X.charges) });
  return ev;
}

/** Host / bot: one decision for seat `s`. Items first (one per call), then the shot. */
export function choose(g: Game, s: number, rng: Rng, skill: Skill): Choice {
  const S = g.seats[s];
  const foes = g.seats
    .map((X, i) => ({ X, i }))
    .filter(({ X, i }) => i !== s && alive(g, i))
    .sort((a, b) => a.X.charges - b.X.charges || Number(b.X.human) - Number(a.X.human));
  const foe = foes.length ? foes[0].i : s;
  const total = g.mag.length;
  const p = total > 0 ? g.live / total : 0.5;
  const known = S.known;
  const pl = known === 'L' ? 1 : known === 'B' ? 0 : p;
  const has = (id: ItemId): boolean => S.items.includes(id);
  const fireAt = (t: number): Choice => ({ k: 'fire', target: t });
  const item = (id: ItemId, t = -1): Choice => ({ k: 'item', id, target: t });

  if (skill.bluff > 0 && total > 1 && rng.chance(skill.bluff)) {
    const legal = S.items.filter((id) => !ITEM_TARGETED.has(id) || foe !== s);
    if (legal.length && rng.chance(0.5)) {
      const id = rng.pick(legal);
      return item(id, ITEM_TARGETED.has(id) ? foe : -1);
    }
    const pool = g.seats.map((_, i) => i).filter((i) => alive(g, i));
    return fireAt(rng.pick(pool));
  }
  if (skill.items) {
    if (known === null && has('loupe')) return item('loupe');
    if (known === null && has('burner') && total >= 2) return item('burner');
    if (has('adrenaline') && foe !== s && g.seats[foe].items.some((id) => id === 'loupe' || id === 'hacksaw')) return item('adrenaline', foe);
    if (has('mint') && S.charges <= S.max - 1) return item('mint');
    if (has('pills') && S.charges >= 2) return item('pills');
    if (has('cuffs') && foe !== s && S.cuffed !== foe && pl >= 0.5 && g.seats[foe].items.some((id) => id === 'hacksaw' || id === 'inverter')) {
      return item('cuffs', foe);
    }
    if (has('tonic') && known === null && p === 0.5) return item('tonic');
  }
  if (known === 'L') {
    if (has('hacksaw') && !S.saw) return item('hacksaw');
    return fireAt(foe);
  }
  if (known === 'B') {
    if (skill.items && has('inverter') && foe !== s && g.seats[foe].charges <= 2) return item('inverter');
    return foe !== s ? fireAt(foe) : fireAt(s);
  }
  if (pl >= 0.67) {
    if (skill.items && has('hacksaw') && !S.saw) return item('hacksaw');
    return fireAt(foe);
  }
  if (pl >= 0.5) return fireAt(foe);
  return fireAt(s);
}

/** Apply one `Choice` for the seat on turn. Returns the events, or null when illegal. */
export function apply(g: Game, rng: Rng, s: number, c: Choice): Ev[] | null {
  if (c.k === 'item') return use(g, rng, s, c.id, c.target);
  return fire(g, rng, s, c.target);
}

/**
 * Reference runner (sims and headless). `seats` describes the table: humans use `skill` as well, so a human
 * policy is any `Skill`. Plays the whole match and returns the winner seat (-1 if the guard trips).
 */
export function runMatch(rng: Rng, seats: Array<{ active: boolean; human: boolean; luck: number; skill: Skill }>): { winner: number; chip: boolean; rounds: number } {
  const g = newGame(seats);
  let rounds = 0;
  for (let round = 1; round <= 12 && matchWinner(g) < 0; round++) {
    rounds++;
    startRound(g, rng, round);
    let guard = 0;
    while (!g.roundDone && guard++ < 2000) {
      const s = g.turn;
      if (s < 0) break;
      const c = choose(g, s, rng, seats[s].skill);
      if (!apply(g, rng, s, c) && !apply(g, rng, s, { k: 'fire', target: s })) break;
    }
    if (!g.roundDone) return { winner: -1, chip: false, rounds };
  }
  return { winner: matchWinner(g), chip: g.seats.some((S) => S.chip), rounds };
}

/** Headless single match: the player is seat 0 on BASIC_SKILL, the Devil is seat 1 on DEVIL_SKILL. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const luck = h.luck;
  const r = runMatch(rng, [
    { active: true, human: true, luck, skill: BASIC_SKILL },
    { active: true, human: false, luck: 0, skill: DEVIL_SKILL },
  ]);
  return { gross: r.winner === 0 ? gross(bet, r.chip) : 0, tags: r.chip ? ['chip'] : [] };
};
