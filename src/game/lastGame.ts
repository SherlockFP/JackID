/**
 * SON OYUN / THE LAST GAME (wave 106, client: "add one last gamble to finish the game; winning it ends the game, but make it hard,
 * so you go into it stacked with luck buffs"). The run's final gate: once Night 8 is paid (the Topside), the House's own machine on
 * the floor lights up. One pull. A win ends the run with the `last_game` ending; a loss burns one name seal (a life) and the
 * machine can be pulled again; a loss on the last seal ends the run lost. The odds are shown before the pull, part by part, so every
 * luck source the player gathered in the run reads as a number here.
 *
 *   base      LAST_GAME.base %
 *   stars     ŞANS stars × LAST_GAME.perStar % (negative stars subtract)
 *   luck      the run-wide `luck` points (charms, tonics, upgrades) × LAST_GAME.perLuck %
 *   bonus     `x.lastGame.pct`: boons and charms made for this pull, in whole percent
 *
 * clamped to [floor, cap]. Pure: the run supplies the inputs (`DebtRun.lastGameOdds`), the UI draws the parts.
 */

export const LAST_GAME = { base: 5, perStar: 3, perLuck: 0.5, cap: 65, floor: 2 } as const;

export interface LastGameInput {
  /** ŞANS stars now (the luck meter, −2 .. max). */
  stars: number;
  /** Run-wide `luck` points (the mod pipeline's `luck` hook as the run reads it). */
  luck: number;
  /** `x.lastGame.pct`: flat whole-percent bonus from boons and charms. */
  bonusPct: number;
}

export type LastGamePartKey = 'base' | 'stars' | 'luck' | 'bonus';
export interface LastGamePart { key: LastGamePartKey; pct: number }

export interface LastGameOdds {
  /** The chance to win this pull, whole percent after the clamp. */
  pct: number;
  /** What it is made of, before the clamp (zero parts left out, base always first). */
  parts: LastGamePart[];
  cap: number;
}

/** The odds of one pull from the run's luck. */
export function lastGameOdds(i: LastGameInput): LastGameOdds {
  const num = (v: number): number => (Number.isFinite(v) ? v : 0);
  const parts: LastGamePart[] = [{ key: 'base', pct: LAST_GAME.base }];
  const add = (key: LastGamePartKey, pct: number): void => { const p = Math.round(pct * 10) / 10; if (p !== 0) parts.push({ key, pct: p }); };
  add('stars', num(i.stars) * LAST_GAME.perStar);
  add('luck', num(i.luck) * LAST_GAME.perLuck);
  add('bonus', num(i.bonusPct));
  const sum = parts.reduce((s, p) => s + p.pct, 0);
  return { pct: Math.round(Math.min(LAST_GAME.cap, Math.max(LAST_GAME.floor, sum))), parts, cap: LAST_GAME.cap };
}

/** One pull's outcome as the run decided it (seeded). The run is not ended yet: the UI shows the reels, then calls `endLastGame()`. */
export interface LastGameResult {
  win: boolean;
  /** The odds the pull was rolled at. */
  pct: number;
  /** Name seals left after the pull (a loss burns one). */
  sealsLeft: number;
  /** True when this result ends the run once shown (a win, or a loss on the last seal). */
  final: boolean;
}

/** What the run offers the UI (DebtRun implements it). */
export interface LastGameApi {
  /** The machine is live: Night 8 is paid (Topside), the run is not over, and no pull is waiting to be shown. */
  lastGameOpen(): boolean;
  lastGameOdds(): LastGameOdds;
  /** Rolls one pull (null when not open). A loss spends a seal at once; the run's end waits for `endLastGame`. */
  playLastGame(): LastGameResult | null;
  /** After the reveal: a final result ends the run (win: `endRun('escaped', 'last_game')`; last seal lost: a loss ending). */
  endLastGame(): void;
}
