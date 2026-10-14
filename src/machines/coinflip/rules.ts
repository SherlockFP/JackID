/**
 * Coin Flip Booth â€” pure rules (base-machines WP, reference machine). Shared by the live machine (`index.ts`) and
 * the headless play contract (`playHeadless`: staff auto-play, balance sims, bench "Sim" button), so the simulated
 * RTP IS the live RTP.
 *
 * Rules: call heads, tails or the EDGE, stake S. A heads/tails win pays the first ladder step (Ã—1.9). After a win the
 * player may RIDE (re-stake the whole pot on the next flip, up the ladder Ã—1.9 â†’ Ã—3.6 â†’ Ã—7 â†’ Ã—13) or COLLECT at any
 * time. A loss ends the round. EDGE (1 in 60) stands the coin on its rim and pays ×54 of the flip's stake, then the
 * round closes. Luck (GDD Â§3.8.1): L % chance a losing flip is rerolled once (a negative L rerolls a win instead).
 *
 * RTP: cashing out after the first heads/tails win returns `STEP_MULT[0] Ã— WIN_P` = 98 % (`playHeadless` is exactly
 * that). Riding further trades RTP for variance (â‰ˆ 92â€“96 % per cash-out rung); the EDGE call is a long shot (50 %).
 */
import type { Rng } from '@/core/rng';
import type { HeadlessPlay, ModHook } from '@/game/types';

/** A heads or tails face. */
export type Side = 'H' | 'T';
/** What the player calls: a face, or `E` (the coin stands on its edge). */
export type Call = Side | 'E';
/** What the coin shows at rest: a face, or `E` when it stands on its edge. */
export type Face = Side | 'E';

/** Cumulative ladder: the pot after each win, in multiples of the bet. Index = the win number (0 = first win). */
export const STEP_MULT: readonly number[] = [1.9, 3.6, 7, 13, 24.7];
export const RIDE_CAP = 3;             // rides allowed after the first win â†’ the ladder tops out at STEP_MULT[3] = Ã—13
export const MAX_RIDE_CAP = 4;         // hard ceiling with every hook/feature stacked â†’ Ã—24.7 on the ladder
/** Heads/tails win chance per flip. Cashing out after the first win returns 0.98: 1.9 Ã— p = 0.98. */
export const WIN_P = 0.98 / STEP_MULT[0];
/** EDGE call: the chance the coin stands on its rim (1 in 60). */
export const EDGE_P = 1 / 60;
/** EDGE call: pays this Ã— the flip's stake (the bet, or the pot when riding). */
export const EDGE_MULT = 54; // 1/60 x 54 = 0.90 EV, a long shot that no longer drags RTP
const P_MIN = 0.05, P_MAX = 0.9;
const NEAR_MISS_P = 0.15;              // share of losses shown as an edge-teeter

/** Charm / upgrade hooks this machine honours (documented in `def.modHooks`). */
export const HOOK_P = 'm.coinflip.pWin' as ModHook;        // base win chance, e.g. add +0.05
export const HOOK_RIDES = 'm.coinflip.rideCap' as ModHook; // extra rides up the ladder, int

export const clampP = (p: number): number => Math.min(P_MAX, Math.max(P_MIN, p));
export const clampRides = (n: number): number => Math.min(MAX_RIDE_CAP, Math.max(0, Math.round(n)));
/** The biggest payout of one round: the top rung, or an EDGE hit on the stake one rung below it. */
export const maxPayoutMult = (): number => Math.max(STEP_MULT[MAX_RIDE_CAP], EDGE_MULT * STEP_MULT[MAX_RIDE_CAP - 1]);

export interface Roll {
  win: boolean;
  /** The face the coin shows (`E` only for an EDGE call that hit). */
  face: Face;
  /** A luck reroll fired (either direction). */
  rerolled: boolean;
  /** Cosmetic: a losing flip that teeters on its edge first. */
  near: boolean;
  /** Cosmetic: full rotations of the toss. */
  turns: number;
}

/**
 * One flip. Always consumes exactly six draws so the stream position never depends on luck, the call or the result
 * (a given seed replays identically whatever the charms).
 */
export function roll(rng: Rng, p: number, luck: number, call: Call): Roll {
  const d1 = rng.next(), gate = rng.next(), d3 = rng.next(), d4 = rng.next(), d5 = rng.next();
  const turns = rng.int(4, 7);
  if (call === 'E') {
    let hit = d1 < EDGE_P;
    let rerolled = false;
    if (!hit && luck > 0 && gate < luck / 100) { rerolled = true; hit = d3 < EDGE_P; }
    else if (hit && luck < 0 && gate < -luck / 100) { rerolled = true; hit = d3 < EDGE_P; }
    const face: Face = hit ? 'E' : d5 < 0.5 ? 'H' : 'T';
    return { win: hit, face, rerolled, near: !hit && d4 < NEAR_MISS_P, turns };
  }
  let win = d1 < p;
  let rerolled = false;
  if (!win && luck > 0 && gate < luck / 100) { rerolled = true; win = d3 < p; }
  else if (win && luck < 0 && gate < -luck / 100) { rerolled = true; win = d3 < p; }
  const face: Face = win ? call : call === 'H' ? 'T' : 'H';
  return { win, face, rerolled, near: !win && d4 < NEAR_MISS_P, turns };
}

/** Headless single flip, collected immediately (what an Attendant does). Heads/tails only. */
export const playHeadless: HeadlessPlay = (rng, bet, h) => {
  const r = roll(rng, clampP(h.mod(HOOK_P, WIN_P)), h.luck, 'H');
  return { gross: r.win ? bet * STEP_MULT[0] : 0, tags: r.rerolled ? ['lucky'] : [] };
};
