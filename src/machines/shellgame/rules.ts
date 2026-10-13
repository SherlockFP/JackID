/**
 * Shell Automaton "Monsieur Thimble" — pure rules (MACHINES_tables §21, plan.json logicBrief). No three, no DOM, no kit:
 * shared by the live machine (`index.ts`) and the headless play contract (`playHeadless`), so the simulated RTP IS the
 * live RTP.
 *
 * Round: the pearl starts under the middle cup. The host (the local occupant) rolls the whole shuffle at commit:
 *   1. palm roll: palmed = rng < c', c' = c(heat) × (1 − L/100); a palmed pearl leaves the felt at swap `palmAt`;
 *   2. swap list: `n(heat)` swaps, each a pair of distinct cup slots (0 = left, 1 = middle, 2 = right).
 * The pearl follows its cup through the swaps (`trackPearl`). The player then lifts a cup (1/2/3), or calls the cheat (4)
 * which wins only when the pearl was palmed. A wrong cup may give one second guess (charm), paying 0.5:1 on a hit.
 *
 * Pay table (gross, stake included): cup hit = 2S (1:1), cheat = (1 + cheatTo) S (3:1 base), second-guess hit = S + ½S.
 * Heat h = consecutive wins here, capped at 5 (heatCap hook). A win that reaches `jamWins` jams the automaton until the
 * next Night (the caller keeps that state). A loss resets the streak.
 *
 * Draw order (a given rng replays identically): palm roll (1), palm swap index (1 if palmed), then per swap two draws
 * (first cup, then the offset of the second). `playHeadless` then draws the staff guess (1).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

export const CUPS = 3;
export const START_CUP = 1;              // the pearl is shown under the middle cup
export const CHEAT = 3;                  // pick code: Call Cheat
export const NONE = -1;                  // pick code / pearl code: timeout or walked away; pearl palmed
export const HEAT_MAX = 5;
export const STAKE_MIN = 5;
export const STAKE_MAX = 20;
export const STAKE_MAX_L25 = 50;
export const PICK_S = 8;                 // seconds to lift a cup; timeout = loss
export const AWAY_S = 30;                // seconds away from the machine that reset the heat
export const JAM_WINS = 5;
export const JAM_WINS_L100 = 7;
export const CHEAT_TO = 3;               // winnings multiple of a Call Cheat (3:1)
export const SECOND_TO = 0.5;            // winnings multiple of a second-guess hit (0.5:1)

/** Heat rows (MACHINES_tables §21.2): swap count, swap time (s), palm chance at zero luck. */
export interface HeatRow { swaps: number; swapS: number; palm: number }
export const HEAT_ROWS: readonly HeatRow[] = [
  { swaps: 6, swapS: 0.50, palm: 0.15 },
  { swaps: 8, swapS: 0.42, palm: 0.25 },
  { swaps: 10, swapS: 0.36, palm: 0.35 },
  { swaps: 12, swapS: 0.30, palm: 0.45 },
  { swaps: 14, swapS: 0.26, palm: 0.55 },
  { swaps: 16, swapS: 0.22, palm: 0.65 },
];

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_SWAP_SLOW = 'm.shellgame.swapSlow' as ModHook;       // × swap time (Brass Knuckles 0.8)
export const HOOK_GLINT = 'm.shellgame.glintFrames' as ModHook;        // glint frames (Dowsing Rod +2), cosmetic
export const HOOK_CHEAT_ADD = 'm.shellgame.cheatPayAdd' as ModHook;    // + winnings multiple on Call Cheat
export const HOOK_HEAT_CAP = 'm.shellgame.heatCap' as ModHook;         // cap heat for difficulty (base 5)
export const HOOK_SECOND = 'm.shellgame.secondGuess' as ModHook;       // charges: one second guess per round

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const heatRow = (heat: number): HeatRow => HEAT_ROWS[clamp(Math.floor(heat), 0, HEAT_MAX)];
export const effectiveHeat = (streak: number, cap: number): number => clamp(Math.min(streak, cap), 0, HEAT_MAX);
export const jamAt = (l100: boolean): number => (l100 ? JAM_WINS_L100 : JAM_WINS);

/** Palm chance c' = c × (1 − L/100). Luck is clamped to 0–100. */
export function palmChance(heat: number, luck: number): number {
  return heatRow(heat).palm * (1 - clamp(luck, 0, 100) / 100);
}

/** One rolled round: the swap list and the palm, decided at commit. */
export interface Shuffle {
  swaps: Array<[number, number]>;   // slot pairs, in order
  palmAt: number;                   // swap index where the pearl is palmed, NONE if not palmed
  pearl: number;                    // final slot of the pearl, NONE if palmed
}

/** Where the pearl ends up after the swaps (a palm at `palmAt` removes it before that swap moves it). */
export function trackPearl(start: number, swaps: ReadonlyArray<readonly [number, number]>, palmAt: number): number {
  let p = start;
  for (let i = 0; i < swaps.length; i++) {
    if (i === palmAt) return NONE;
    const [a, b] = swaps[i];
    if (p === a) p = b;
    else if (p === b) p = a;
  }
  return p;
}

/** Roll one shuffle from `rng` for the given (effective) heat and luck. Pure apart from the rng draws. */
export function shuffle(rng: Rng, heat: number, luck: number): Shuffle {
  const row = heatRow(heat);
  const palmed = rng.next() < palmChance(heat, luck);
  const palmAt = palmed ? rng.int(0, row.swaps - 1) : NONE;
  const swaps: Array<[number, number]> = [];
  for (let i = 0; i < row.swaps; i++) {
    const a = rng.int(0, CUPS - 1);
    const b = (a + rng.int(1, CUPS - 1)) % CUPS;
    swaps.push([a, b]);
  }
  return { swaps, palmAt, pearl: trackPearl(START_CUP, swaps, palmAt) };
}

/** Winnings → gross with the fractional half rounded up (whole coins only). */
export const winGross = (stake: number, mult: number): number => stake + Math.floor(stake * mult + 0.5);

export interface Terms { cheatTo: number; second: boolean }
export interface Verdict { win: boolean; kind: 'cup' | 'second' | 'cheat' | 'none'; gross: number }

/**
 * Grade the picks of one round. `picks` are cup slots (0–2), CHEAT, or NONE (timeout). A second pick only counts after
 * a wrong first cup and only when `t.second` is on; it may not repeat the first cup.
 */
export function grade(stake: number, pearl: number, picks: readonly number[], t: Terms): Verdict {
  const first = picks[0];
  const lose: Verdict = { win: false, kind: 'none', gross: 0 };
  if (first === CHEAT) {
    return pearl === NONE ? { win: true, kind: 'cheat', gross: winGross(stake, t.cheatTo) } : lose;
  }
  if (first < 0 || first >= CUPS) return lose;
  if (pearl === first) return { win: true, kind: 'cup', gross: winGross(stake, 1) };
  const second = picks[1];
  if (t.second && second !== undefined && second >= 0 && second < CUPS && second !== first && pearl === second) {
    return { win: true, kind: 'second', gross: winGross(stake, SECOND_TO) };
  }
  return lose;
}

/** Heat after a settled round: a win adds one and jams the automaton at `jamWins`; a loss resets the streak. */
export function nextStreak(streak: number, win: boolean, jamWins: number): { streak: number; jam: boolean } {
  if (!win) return { streak: 0, jam: false };
  const s = streak + 1;
  return { streak: s, jam: s >= jamWins };
}

/**
 * Heat on the next insert after `awayS` seconds away: under 30 s nothing changes; a longer absence resets it, or with
 * the L10 milestone it decays one per full minute away instead.
 */
export function decayed(streak: number, awayS: number, perMinute: boolean): number {
  if (awayS <= AWAY_S) return streak;
  return perMinute ? Math.max(0, streak - Math.floor(awayS / 60)) : 0;
}

/**
 * One whole round for staff auto-play and sims: a random guess at zero heat (no cheat, no second guess). The gross is
 * exact for the bet (whole coins), so the sim measures the design RTP. Heat 0, so this is the 56.7 % baseline.
 */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const sh = shuffle(rng, 0, h.luck);
  const guess = rng.int(0, CUPS - 1);
  const v = grade(bet, sh.pearl, [guess], { cheatTo: CHEAT_TO, second: false });
  return { gross: v.gross, tags: [v.win ? 'win' : 'loss'] };
};
