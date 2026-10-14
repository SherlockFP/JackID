/** A wing grille opens with its key (STORY, once per run). Fired by `storyRoomOpened` (the rooms lane's `room:opened`). */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'wing_key',
  kind: 'story',
  duration: 9,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'mgmt.door' }, fov: 62, cut: true },
      { t: 6, pos: { player: 'local' }, look: { anchor: 'parlour.curtain' }, fov: 56, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 1.0, dur: 2.8, key: 'story.wing_key.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 4.0, dur: 2.4, key: 'story.wing_key.2' },
      { t: 6.4, dur: 2.4, key: 'story.wing_key.3', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'stinger', id: 'door', vol: 0.7 },
      { t: 0.6, do: 'sfx', name: 'lever', vol: 0.8 },
      { t: 1.4, do: 'sfx', name: 'unlock', vol: 0.9 },
      { t: 3.0, do: 'sfx', name: 'powerUp', vol: 0.5 },
    ] },
    { kind: 'hook', cues: [{ t: 5, hook: 'story.keyTurned' }] },
    { kind: 'light', cues: [{ t: 2.5, target: 'all', flicker: 0.5, dur: 0.6 }] },
  ],
};
export default def;
