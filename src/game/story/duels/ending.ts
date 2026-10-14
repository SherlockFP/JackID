/**
 * Vell's ending hook (STORY lane, Wave 25 phase 2). Vell, the N8 boss in the Counting Room, is THROWING the match
 * (`src/game/duels/lastcount`). Calling it out ("THROWN MATCH") ends the duel peacefully and starts the release / void
 * ending path: the Bench rules the count void against Vell and he is released to the lift. It never punishes the guest.
 *
 * Two ways in, for the integrator (run.ts):
 *   onVellCalled(fn)      fires once per duel, the moment the call is judged right (live, mid-duel);
 *   isVellRelease(report) true for the `DuelEndReport` of that duel (use it in `duelEnded`, then play
 *                         {@link playVellRelease} in place of Vell's 'won' scene).
 * An uncalled duel is not an ending: Vell loses on the count, the guest takes the pot and the normal Night 8 path goes on.
 */
import type { CutsceneResult } from '@/core/cutscene/types';
import { onVellCalled, type VellCalledInfo } from '@/game/duels/lastcount/rules';
import { playVellCalledScene } from './play';

export { onVellCalled };
export type { VellCalledInfo };

/** Stable id of the ending path the run stores (`run.endingPath`, save flag, achievements). */
export const VELL_RELEASE = 'vell_release';

/** The part of `DuelEndReport` this hook reads. */
export interface VellDuelReport { rivalId: string; calledCorrect: boolean | null }

/** True when a settled duel is Vell's thrown match, correctly called out: the release / void ending path. */
export function isVellRelease(r: VellDuelReport): boolean {
  return r.rivalId === 'vell' && r.calledCorrect === true;
}

/** The release scene: the Notary rules the count void, Vell asks to be named a cheat, the lift opens for him. */
export function playVellRelease(): Promise<CutsceneResult> {
  return playVellCalledScene();
}
