/** The elevator ending (STORY): balance cleared, the car rises into daylight. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'ending_elevator',
  kind: 'ending',
  duration: 20,
  fadeIn: 0.8,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { anchor: 'elevator.door', offset: [0, 1.4, 2.5] }, look: { anchor: 'elevator' }, fov: 64, cut: true },
      { t: 5, pos: [-4, 1.4, -27], look: [-4, 8, -30], fov: 66, ease: 'inOutQuad' },
      { t: 12, pos: [-4, 6, -27], look: [-4, 20, -30], fov: 66, ease: 'inOutQuad' },
      { t: 20, pos: [-4, 20, -27], look: [-4, 40, -30], fov: 70, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 2.6, key: 'story.ending.1' },
      { t: 3.8, dur: 2.6, key: 'story.ending.2', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 7.5, dur: 3.2, key: 'story.ending.3' },
      { t: 12.1, dur: 3.2, key: 'story.ending.4', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
      { t: 16.4, dur: 3.0, key: 'story.ending.5' },
    ] },
    { kind: 'audio', cues: [
      { t: 0.4, do: 'stinger', id: 'ascend', vol: 0.9 },
      { t: 0.5, do: 'music', state: 'elevator', fade: 1 },
      { t: 0.7, do: 'sfx', name: 'elevator', vol: 0.9 },
      { t: 1.2, do: 'sfx', name: 'motor', vol: 0.5 },
      { t: 16.6, do: 'music', state: 'ending', fade: 2 },
    ] },
    { kind: 'fx', cues: [
      { t: 17.6, do: 'fade', alpha: 1, dur: 1.4, color: '#ffffff' },
      { t: 18.8, do: 'flash', color: 0xffffff, alpha: 0.9, dur: 1.2 },
    ] },
    { kind: 'light', cues: [{ t: 1.6, target: 'all', level: 0.2, dur: 1.2 }, { t: 16.5, target: 'all', level: 1.2, dur: 1.6 }] },
  ],
};
export default def;
