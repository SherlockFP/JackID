/** Waking in the pit: after the menu burst (STORY). Chains into the first-quota talk. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'intro',
  kind: 'intro',
  duration: 15,
  fadeIn: 1.6,
  chain: 'quota_explain',
  tracks: [
    { kind: 'camera', handheld: 0.25, keys: [
      { t: 0, pos: [0, 0.18, -7.4], look: [0, 2.6, -9], fov: 72, cut: true },
      { t: 4, pos: [0, 0.5, -7.6], look: [0, 1.8, -14], fov: 70, ease: 'inOutQuad' },
      { t: 9, pos: [0, 1.6, -7.8], look: { anchor: 'terminal' }, fov: 62, ease: 'inOutCubic' },
      { t: 15, pos: [0, 1.6, -8.4], look: { anchor: 'clock' }, fov: 66, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.2, key: 'story.intro.1' },
      { t: 4.5, dur: 4.0, key: 'story.intro.2', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 8.8, dur: 3.6, key: 'story.intro.3', speaker: 'story.speaker.house', voice: 'house', mood: 'whisper' },
      { t: 12.4, dur: 2.2, key: 'story.intro.4' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'cutscene', fade: 1 },
      { t: 1.2, do: 'sfx', name: 'heartbeat', vol: 0.6 },
      { t: 6.5, do: 'sfx', name: 'lightFlicker', vol: 0.7 },
      { t: 11.6, do: 'sfx', name: 'paClick', vol: 0.8 },
    ] },
    { kind: 'fx', cues: [
      { t: 7, do: 'shake', amp: 0.02, dur: 0.6 },
      { t: 13.5, do: 'glitch', amount: 0.3, dur: 0.5 },
    ] },
    { kind: 'light', cues: [{ t: 6.5, target: 'all', flicker: 0.6, dur: 0.6 }] },
  ],
};
export default def;
