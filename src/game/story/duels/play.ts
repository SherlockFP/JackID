/**
 * Playback of the duel scenes (STORY lane, Wave 25). Goes through `playStory` in `game/story`, so the host-only rule online and
 * the scene registry are the same as the rest of the story. Nothing here runs at import time.
 *
 * Wiring: the tallytable machine calls {@link playSealScene} when the terms are read (first duel of the run), and
 * {@link playRivalScene} with 'intro' when a rival's duel opens and 'won' or 'lost' when it settles. Pass the run seed and
 * the Night so the boss Terms match the run (Lucan on Night 3, Orrin on 6, Vell on 8).
 */
import type { CutsceneResult } from '@/core/cutscene/types';
import { playStory } from '@/game/story';
import { duelSceneId, SEAL_SCENE, VELL_CALLED_SCENE } from './scenes';
import { termsVars, rivalTermsFor } from './terms';
import { isBossRival, type RivalId } from './rivals';

export function playSealScene(): Promise<CutsceneResult> {
  return playStory(SEAL_SCENE);
}

/**
 * Plays a rival's scene. For a boss rival's intro (Lucan, Orrin, Vell), pass `seed` and `night` so the Rival's Terms name the run's
 * real modifier; without them the Terms line shows the raw {name}/{desc} placeholders, so the integrator should pass them.
 */
export function playRivalScene(
  rival: RivalId,
  beat: 'intro' | 'won' | 'lost',
  opts: { seed?: number; night?: number } = {},
): Promise<CutsceneResult> {
  let vars: Record<string, string> | undefined;
  if (isBossRival(rival) && beat === 'intro' && opts.seed !== undefined && opts.night !== undefined) {
    const terms = rivalTermsFor(opts.seed, opts.night);
    if (terms) vars = termsVars(terms);
  }
  return playStory(duelSceneId(rival, beat), vars ? { vars } : {});
}

/** Vell's thrown match was called out: the release scene (the Bench rules the count void, Vell goes to the lift). Played once. */
export function playVellCalledScene(): Promise<CutsceneResult> {
  return playStory(VELL_CALLED_SCENE);
}
