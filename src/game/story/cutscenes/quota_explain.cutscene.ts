/** The Collector explains the first quota (STORY). Chained after the intro (intro + this scene stay under 35 s). */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'quota_explain',
  kind: 'quota',
  duration: 20,
  fadeIn: 0.6,
  actors: {
    collector: { kind: 'mannequin', pos: [28.4, 0, 19], rotY: 180, color: 0x2a2a30, clip: 'Idle_Talking_Loop' },
  },
  tracks: [
    { kind: 'camera', handheld: 0.1, keys: [
      { t: 0, pos: [0, 1.6, -7.8], look: { anchor: 'collector' }, fov: 58, cut: true },
      { t: 10, pos: [6, 1.6, -5], look: { anchor: 'collector' }, fov: 56, ease: 'inOutQuad' },
      { t: 18, pos: [6, 1.6, -5], look: { anchor: 'quotaBoard' }, fov: 60, ease: 'inOutCubic' },
    ] },
    { kind: 'actor', actor: 'collector', cues: [
      { t: 0, clip: 'Idle_Talking_Loop', loop: true, turnTo: { target: { player: 'local' }, dur: 1 } },
      { t: 17.4, clip: 'Idle_Loop', fade: 0.4, loop: true },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.0, key: 'story.quota.1', speaker: 'story.speaker.collector', voice: 'collector', mood: 'calm' },
      { t: 4.2, dur: 3.0, key: 'story.quota.2', speaker: 'story.speaker.collector', voice: 'collector', mood: 'calm' },
      { t: 7.6, dur: 3.0, key: 'story.quota.3', speaker: 'story.speaker.collector', voice: 'collector', mood: 'cheery' },
      { t: 10.9, dur: 3.1, key: 'story.quota.4', speaker: 'story.speaker.collector', voice: 'collector', mood: 'calm' },
      { t: 14.4, dur: 3.2, key: 'story.quota.5', speaker: 'story.speaker.collector', voice: 'collector', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'lounge', fade: 1.5, intensity: 0.2 },
      { t: 14.4, do: 'music', state: 'tense', fade: 2, dread: 0.3 },
    ] },
    { kind: 'fx', cues: [{ t: 18.2, do: 'chroma', px: 1, dur: 1 }] },
  ],
};
export default def;
