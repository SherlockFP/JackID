/**
 * Cash starvation rules (wave 14). Pure functions: `run.ts` applies them, the Debt Terminal shows them, the tests check them.
 *
 * - A pocket is DEAD when it cannot cover the cheapest bet on the floor (`pocketDead`). The run then rings the rescue call.
 * - The FIRST deposit of each Watch leaves a float in the pocket: `floorFor` coins (the smaller of 30 % of the pocket and
 * 2 × the cheapest bet). The float stops a player who empties the pocket on the first deposit from being stuck with nothing
 * to play. Only ALL, once the player confirms it, goes below the float.
 */

/** Share of the pocket kept as float on the first deposit of a Watch. */
export const FLOAT_FRAC = 0.3;
/** Float ceiling in cheapest bets (the float never exceeds this many bets). */
export const FLOAT_MIN_BETS = 2;
/** Seconds an armed ALL stays armed: the second press within this window confirms it. */
export const ALL_CONFIRM_SEC = 6;

/** The cheapest bet a pocket must cover to keep playing (never below 1 coin). */
export function bestBetFloor(minBet: number): number {
  return Math.max(1, Math.floor(Number.isFinite(minBet) ? minBet : 1));
}

/** True when the pocket cannot cover the cheapest bet on the floor. */
export function pocketDead(pocket: number, minBet: number): boolean {
  return Math.floor(pocket) < bestBetFloor(minBet);
}

/** Coins the first deposit of a Watch must leave in the pocket: min(30 % of the pocket, 2 × the cheapest bet), never negative. */
export function floorFor(pocket: number, minBet: number): number {
  const p = Math.max(0, Math.floor(pocket));
  return Math.max(0, Math.min(Math.floor(FLOAT_FRAC * p), FLOAT_MIN_BETS * bestBetFloor(minBet)));
}

/** Most coins a deposit may take from `pocket` while `floor` stays in it. */
export function depositRoom(pocket: number, floor: number): number {
  return Math.max(0, Math.floor(pocket) - Math.max(0, Math.floor(floor)));
}
