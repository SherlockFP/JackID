/** Quota met: the Collector stamps the board (STORY). Plays on every met quota. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'quota_met',
  kind: 'quotaMet',
  duration: 9,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { anchor: 'quotaBoard', offset: [0, 0.2, -2.5] }, look: { anchor: 'quotaBoard' }, fov: 60, cut: true },
      { t: 5, pos: { anchor: 'quotaBoard', offset: [0.8, 0.4, -2.2] }, look: { anchor: 'quotaBoard' }, fov: 54, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 1.0, dur: 2.8, key: 'story.met.1', speaker: 'story.speaker.collector', voice: 'collector', mood: 'cheery' },
      { t: 4.4, dur: 4.0, key: 'story.met.2', speaker: 'story.speaker.house', voice: 'house', mood: 'calm' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'stinger', id: 'quotaMet', vol: 0.9 },
      { t: 0.2, do: 'music', state: 'lounge', fade: 1, intensity: 0.4 },
      { t: 2.5, do: 'sfx', name: 'stamp', vol: 1 },
      { t: 3.4, do: 'sfx', name: 'cashRegister', vol: 0.7 },
    ] },
    { kind: 'fx', cues: [
      { t: 2.5, do: 'flash', color: 0xffe9a8, alpha: 0.5, dur: 0.4 },
      { t: 2.5, do: 'shake', amp: 0.015, dur: 0.3 },
    ] },
    { kind: 'light', cues: [{ t: 2.5, target: 'all', level: 1.4, restore: true, dur: 0.6 }] },
  ],
};
export default def;
