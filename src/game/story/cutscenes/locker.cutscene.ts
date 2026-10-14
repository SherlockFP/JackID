/** The first locker of a run is opened in the Wash (STORY, once per run). Fired by `storyLocker` (the rooms lane's `room:locker`). */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'locker',
  kind: 'story',
  duration: 8,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'furnace' }, fov: 58, cut: true },
      { t: 7, pos: { player: 'local' }, look: { anchor: 'furnace' }, fov: 52, ease: 'inCubic' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.9, dur: 2.6, key: 'story.locker.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 3.8, dur: 2.4, key: 'story.locker.2' },
      { t: 6.2, dur: 1.8, key: 'story.locker.3', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0.2, do: 'sfx', name: 'creak', vol: 0.8 },
      { t: 0.9, do: 'sfx', name: 'tapeStop', vol: 0.4 },
      { t: 3.6, do: 'sfx', name: 'drip', vol: 0.5 },
    ] },
    { kind: 'light', cues: [{ t: 4.5, target: 'all', level: 0.6, dur: 0.8, restore: true }] },
  ],
};
export default def;
