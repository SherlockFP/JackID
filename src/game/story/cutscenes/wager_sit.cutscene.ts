/**
 * THE BURNING WAGER, the sit-down (STORY_BIBLE §4 N8 Act 2, §9): the Compere calls the last table, sets the mic on its stand and sits
 * down at the table on the stage. His pink light dies and the rim under it is green, like the head in your glass. The Clerk reads his
 * name aloud; the voice in your head says nothing. About 14 s, skippable. Played once by story/wager.ts at the Night 8 paid Dawn, before
 * the board opens. Hook `wager.sit` (story/wager.ts) dresses the stage: the table, the chairs, the Compere seated and green.
 * The last key ends at `wager.eye`, the player's place at the table, where the match is played.
 */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'wager_sit',
  kind: 'story',
  duration: 14,
  fadeIn: 0.6,
  tracks: [
    { kind: 'camera', handheld: 0.05, keys: [
      { t: 0, pos: { anchor: 'stage.view', offset: [0, 0.3, 0] }, look: { anchor: 'stage.compere' }, fov: 50, cut: true },
      { t: 4.4, pos: { anchor: 'stage.view', offset: [0, 0.3, 0] }, look: { anchor: 'stage.compere' }, fov: 34, ease: 'inOutQuad' },
      { t: 9.0, pos: { anchor: 'stage.view', offset: [0, 0.3, 0] }, look: { anchor: 'stage.compere' }, fov: 26, ease: 'inOutQuad' },
      { t: 12.4, pos: { anchor: 'wager.eye' }, look: { anchor: 'stage.compere' }, fov: 58, cut: true },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.2, key: 'story.wager.1', speaker: 'story.speaker.compere', voice: 'compere', mood: 'cheery' },
      { t: 4.2, dur: 2.6, key: 'story.compere.sit', speaker: 'story.speaker.compere', voice: 'compere', mood: 'calm' },
      { t: 7.0, dur: 2.4, key: 'story.wager.2' },
      { t: 9.4, dur: 2.2, key: 'story.wager.3', speaker: 'story.speaker.clerk', voice: 'house', mood: 'whisper' },
      { t: 11.0, dur: 1.8, key: 'story.wager.4' },
      { t: 12.6, dur: 1.4, key: 'story.wager.5', speaker: 'story.end.speaker.champion', voice: 'compere', mood: 'calm' },
    ] },
    { kind: 'hook', cues: [{ t: 5.0, hook: 'wager.sit' }] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'silent', fade: 0.8 },
      { t: 0.4, do: 'sfx', name: 'paClick', vol: 0.6 },
      { t: 1.2, do: 'sfx', name: 'crowdMurmur', vol: 0.7 },
      { t: 5.0, do: 'sfx', name: 'seat', vol: 0.7 },
      { t: 7.0, do: 'sfx', name: 'neonBuzz', vol: 0.6 },
      { t: 7.4, do: 'sfx', name: 'powerDown', vol: 0.6 },
      { t: 9.4, do: 'sfx', name: 'stamp', vol: 0.8 },
      { t: 11.0, do: 'sfx', name: 'heartbeat', vol: 0.6 },
    ] },
    { kind: 'light', cues: [
      { t: 4.4, target: { anchor: 'stage.compere' }, level: 1.8, dur: 1.2 },
      { t: 7.2, target: { anchor: 'stage.compere' }, flicker: 0.5, dur: 0.6 },
    ] },
    { kind: 'fx', cues: [{ t: 7.2, do: 'tint', color: 0x5aff7b, alpha: 0.16, dur: 1.2 }] },
  ],
};
export default def;
