/** The Audit (STORY, once per run): Night 7, second Watch. The Clerk taxes the largest holding. Fired by the run:window hook in story/index.ts. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'audit',
  kind: 'story',
  duration: 11,
  fadeIn: 0.6,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 60, cut: true },
      { t: 5, pos: { player: 'local' }, look: { anchor: 'clock' }, fov: 56, ease: 'inOutQuad' },
      { t: 10, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 54, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.0, key: 'story.audit.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 4.4, dur: 3.2, key: 'story.audit.2' },
      { t: 8.2, dur: 2.6, key: 'story.audit.3', speaker: 'story.speaker.clerk', voice: 'house', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'tense', fade: 1.2 },
      { t: 0.5, do: 'sfx', name: 'printer', vol: 0.7 },
      { t: 4.6, do: 'sfx', name: 'typewriter', vol: 0.5 },
      { t: 8.4, do: 'sfx', name: 'stamp', vol: 0.8 },
    ] },
    { kind: 'light', cues: [{ t: 8.3, target: 'all', flicker: 0.3, dur: 0.5 }] },
  ],
};
export default def;
