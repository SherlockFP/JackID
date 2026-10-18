/**
 * THE SECOND NAME (STORY lane, wave 73): the Night 8 reveal, once per run. The second watch of Night 8: the House PA reads the
 * answer over the quota board (subtitles `story.reveal.1..4`), and the Clerk's arc reaches its second beat. Fired by story/index.ts.
 */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'reveal_n8',
  kind: 'story',
  duration: 19,
  fadeIn: 0.8,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 58, cut: true },
      { t: 8, pos: { player: 'local' }, look: { anchor: 'clock' }, fov: 54, ease: 'inOutQuad' },
      { t: 15, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 52, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 4.2, key: 'story.reveal.1', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 5.2, dur: 4.4, key: 'story.reveal.2' },
      { t: 10.4, dur: 4.2, key: 'story.reveal.3', speaker: 'story.speaker.clerk', voice: 'house', mood: 'whisper' },
      { t: 15.4, dur: 3.2, key: 'story.reveal.4', speaker: 'story.speaker.mira' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'tense', fade: 1.2 },
      { t: 10.3, do: 'sfx', name: 'stamp', vol: 0.8 },
    ] },
    { kind: 'light', cues: [{ t: 15.2, target: 'all', flicker: 0.4, dur: 0.6 }] },
  ],
};
export default def;
