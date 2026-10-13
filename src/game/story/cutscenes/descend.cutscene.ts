/** Prestige "Descend" (STORY): the floor opens under you and the House offers a deeper truth. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'descend',
  kind: 'prestige',
  duration: 18,
  fadeOut: 0.2,
  tracks: [
    { kind: 'camera', handheld: 0.2, keys: [
      { t: 0, pos: [0, 1.6, 8], look: [0, -3, 12], fov: 70, cut: true },
      { t: 8, pos: [0, -0.5, 11], look: [0, -4, 12], fov: 66, ease: 'inOutQuad' },
      { t: 10.5, pos: [0, -6, 12.5], look: [0, -12, 12], fov: 84, ease: 'inCubic' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.5, dur: 3.4, key: 'story.descend.1' },
      { t: 4.2, dur: 4.2, key: 'story.descend.2', speaker: 'story.speaker.house', voice: 'house', mood: 'calm' },
      { t: 9.8, dur: 3.2, key: 'story.descend.3' },
      { t: 13.2, dur: 3.0, key: 'story.descend.4', speaker: 'story.speaker.collector', voice: 'collector', mood: 'whisper' },
    ] },
    { kind: 'gate', cues: [{ t: 9.2, id: 'pick', until: 'choice', timeout: 12, options: ['story.choice.look', 'story.choice.away'] }] },
    { kind: 'hook', cues: [{ t: 9.4, hook: 'story.pick' }] },
    { kind: 'audio', cues: [
      { t: 0, do: 'stinger', id: 'descend', vol: 0.9 },
      { t: 0.4, do: 'music', state: 'dread', fade: 1, dread: 0.6 },
      { t: 9.0, do: 'sfx', name: 'elevator', vol: 0.8 },
      { t: 12.6, do: 'sfx', name: 'whisper', vol: 0.5 },
    ] },
    { kind: 'fx', cues: [
      { t: 10.4, do: 'shake', amp: 0.05, dur: 1.2 },
      { t: 14.5, do: 'fade', alpha: 1, dur: 3 },
    ] },
    { kind: 'light', cues: [{ t: 2, target: 'all', level: 0.3, dur: 2 }] },
  ],
};
export default def;
