/** Horror stinger (STORY): after the first note is read, a mannequin is no longer facing the wall. */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'stinger_turn',
  kind: 'stinger',
  duration: 6,
  fadeIn: 0.1,
  fadeOut: 0.4,
  tracks: [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: 'furnace' }, fov: 62, cut: true },
      { t: 3, pos: { player: 'local' }, look: { anchor: 'jack' }, fov: 56, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.6, dur: 4.2, key: 'story.turn.1' },
    ] },
    { kind: 'audio', cues: [
      { t: 0.3, do: 'sfx', name: 'creak', vol: 0.7 },
      { t: 1.5, do: 'sfx', name: 'drip', vol: 0.5 },
      { t: 3.4, do: 'stinger', id: 'jumpscare', vol: 0.8 },
    ] },
    { kind: 'fx', cues: [
      { t: 3.4, do: 'shake', amp: 0.03, dur: 0.4 },
      { t: 3.4, do: 'flash', color: 0x330000, alpha: 0.4, dur: 0.3 },
    ] },
    { kind: 'light', cues: [{ t: 3.4, target: 'all', flicker: 0.8, dur: 0.6 }] },
  ],
};
export default def;
