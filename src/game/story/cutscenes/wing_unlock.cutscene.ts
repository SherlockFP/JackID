/** A new wing opens (STORY). Fired on a tycoon milestone that carries a feature. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'wing_unlock',
  kind: 'story',
  duration: 9,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: [-3, 1.6, 17.5], look: { anchor: 'mgmt.door', offset: [0, 1.2, 0] }, fov: 64, cut: true },
      { t: 5, pos: [3, 1.6, 17.5], look: { anchor: 'parlour.curtain', offset: [0, 1.2, 0] }, fov: 58, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 1.0, dur: 2.8, key: 'story.wing.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 4.2, dur: 2.4, key: 'story.wing.2' },
      { t: 6.6, dur: 2.4, key: 'story.wing.3', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'stinger', id: 'door', vol: 0.8 },
      { t: 0.6, do: 'music', state: 'tense', fade: 1.5 },
      { t: 0.8, do: 'sfx', name: 'unlock', vol: 0.9 },
      { t: 3.0, do: 'sfx', name: 'powerUp', vol: 0.6 },
    ] },
    { kind: 'hook', cues: [{ t: 5, hook: 'story.unlock', args: { id: 'wing' } }] },
    { kind: 'light', cues: [{ t: 3, target: 'all', flicker: 0.4, dur: 0.5 }] },
  ],
};
export default def;
