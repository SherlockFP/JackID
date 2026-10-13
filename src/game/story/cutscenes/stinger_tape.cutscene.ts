/** Horror stinger (STORY): a tape starts counting by itself when dread peaks. Camera stares at the hotline. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'stinger_tape',
  kind: 'stinger',
  duration: 5,
  fadeIn: 0.1,
  fadeOut: 0.3,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'hotline' }, fov: 58, cut: true },
      { t: 5, pos: { player: 'local' }, look: { anchor: 'hotline' }, fov: 50, ease: 'inCubic' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.4, dur: 2.2, key: 'story.tape.1', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
      { t: 2.8, dur: 2.0, key: 'story.tape.2', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'sfx', name: 'tapeStop', vol: 0.8 },
      { t: 0.3, do: 'sfx', name: 'whisper', vol: 0.6 },
      { t: 1.4, do: 'sfx', name: 'heartbeat', vol: 0.7 },
    ] },
    { kind: 'fx', cues: [
      { t: 0.2, do: 'chroma', px: 3, dur: 1.2 },
      { t: 1.2, do: 'glitch', amount: 0.6, dur: 1.0 },
    ] },
    { kind: 'light', cues: [{ t: 1, target: 'all', level: 0.3, restore: true, dur: 0.2 }] },
  ],
};
export default def;
