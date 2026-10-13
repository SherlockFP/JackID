/** Quota failed: the plate gives and the room tips away (STORY). Runs before the results hand-off. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'quota_fail',
  kind: 'quotaFail',
  duration: 12,
  tracks: [
    { kind: 'camera', handheld: 0.4, keys: [
      { t: 0, pos: { anchor: 'trapdoor', offset: [0, 1.8, 2] }, look: { anchor: 'trapdoor' }, fov: 66, cut: true },
      { t: 3, pos: [0, 0.6, 12.8], look: [0, -2, 12], fov: 74, ease: 'inCubic' },
      { t: 7, pos: [0, -3, 12.5], look: [0, -12, 12], fov: 90, ease: 'inCubic' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.6, dur: 3.0, key: 'story.fail.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 4.2, dur: 2.6, key: 'story.fail.2' },
      { t: 7.4, dur: 2.8, key: 'story.fail.3', speaker: 'story.speaker.collector', voice: 'collector', mood: 'cheery' },
      { t: 9.6, dur: 2.2, key: 'story.fail.4' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'stinger', id: 'quotaFail', vol: 0.9 },
      { t: 0.5, do: 'music', state: 'defeat', fade: 0.5 },
      { t: 1.2, do: 'sfx', name: 'trapdoor', vol: 1 },
      { t: 2.3, do: 'sfx', name: 'thud', vol: 0.8 },
      { t: 3.2, do: 'sfx', name: 'creak', vol: 0.6 },
      { t: 9.4, do: 'sfx', name: 'drip', vol: 0.6 },
    ] },
    { kind: 'fx', cues: [
      { t: 2, do: 'shake', amp: 0.08, dur: 0.8, roll: 0.6 },
      { t: 6.5, do: 'glitch', amount: 0.5, dur: 1 },
      { t: 8.5, do: 'fade', alpha: 1, dur: 3 },
    ] },
  ],
};
export default def;
