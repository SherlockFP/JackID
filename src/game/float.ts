/**
 * Cash starvation rules (wave 14, float fixed in wave 38). Pure functions: `run.ts` applies them, the Debt Terminal shows them,
 * the tests check them.
 *
 * - A pocket is DEAD when it cannot cover the cheapest bet on the floor (`pocketDead`). The run then rings the rescue call.
 * - THE FLOAT: every deposit of a Watch keeps `watchFloat` coins (2 × the cheapest bet) in the pocket. It is computed ONCE per
 * Watch (`run.ts` caches it) and never shrinks as the pocket shrinks, so the number the terminal shows is the number that holds.
 * Only ALL, once the player confirms it, goes below the float.
 */

/** Float in cheapest bets: a Watch keeps this many bets of play in the pocket. */
export const FLOAT_MIN_BETS = 2;
/** Seconds an armed ALL stays armed: the second press within this window confirms it. */
export const ALL_CONFIRM_SEC = 6;

/** The float of a Watch: 2 × the cheapest bet (never below 2 coins). Independent of the pocket: compute it once per Watch. */
export function watchFloat(minBet: number): number {
  return FLOAT_MIN_BETS * bestBetFloor(minBet);
}

/** Share of the pocket the pre-wave-38 float took (legacy: `economy.depositFloatFor` still reads `floorFor`). Not used by the run. */
export const FLOAT_FRAC = 0.3;

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
