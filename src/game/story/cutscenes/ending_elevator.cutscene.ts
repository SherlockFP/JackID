/** The elevator ending (STORY): balance cleared, the car rises into daylight. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'ending_elevator',
  kind: 'ending',
  duration: 24,
  fadeIn: 0.8,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { anchor: 'elevator.door', offset: [0, 1.4, 2.5] }, look: { anchor: 'elevator' }, fov: 64, cut: true },
      { t: 6, pos: [-4, 1.4, -27], look: [-4, 8, -30], fov: 66, ease: 'inOutQuad' },
      { t: 14, pos: [-4, 6, -27], look: [-4, 20, -30], fov: 66, ease: 'inOutQuad' },
      { t: 22, pos: [-4, 20, -27], look: [-4, 40, -30], fov: 70, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 1.0, dur: 3.0, key: 'story.ending.1' },
      { t: 4.5, dur: 3.0, key: 'story.ending.2', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 9.0, dur: 4.0, key: 'story.ending.3' },
      { t: 14.5, dur: 4.0, key: 'story.ending.4', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
      { t: 20.0, dur: 3.6, key: 'story.ending.5' },
    ] },
    { kind: 'audio', cues: [
      { t: 0.5, do: 'stinger', id: 'ascend', vol: 0.9 },
      { t: 0.6, do: 'music', state: 'elevator', fade: 1 },
      { t: 0.8, do: 'sfx', name: 'elevator', vol: 0.9 },
      { t: 1.4, do: 'sfx', name: 'motor', vol: 0.5 },
      { t: 20, do: 'music', state: 'ending', fade: 2 },
    ] },
    { kind: 'fx', cues: [
      { t: 21.5, do: 'fade', alpha: 1, dur: 1.5, color: '#ffffff' },
      { t: 22.6, do: 'flash', color: 0xffffff, alpha: 0.9, dur: 1.6 },
    ] },
    { kind: 'light', cues: [{ t: 2, target: 'all', level: 0.2, dur: 1.5 }, { t: 20, target: 'all', level: 1.2, dur: 2 }] },
  ],
};
export default def;
