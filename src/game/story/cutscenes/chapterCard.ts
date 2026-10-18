/**
 * THE SECOND NAME (STORY lane, wave 73): the Night title card factory. Each `chapter_n<N>.cutscene.ts` default-exports one card:
 * the title, then one line, over the quota board. Keys: `story.chapter.n<N>.title` / `.line` (chapter.strings.ts).
 * Not a scene itself (no `.cutscene.ts` suffix), so the cutscene glob does not register it.
 */
import type { CutsceneDef } from '@/core/cutscene/types';

export function chapterCard(night: number): CutsceneDef {
  return {
    id: `chapter_n${night}`,
    kind: 'story',
    duration: 7.4,
    fadeIn: 0.6,
    fadeOut: 0.5,
    tracks: [
      { kind: 'camera', keys: [
        { t: 0, pos: { player: 'local' }, look: { anchor: 'quotaBoard' }, fov: 60, cut: true },
        { t: 4, pos: { player: 'local' }, look: { anchor: 'clock' }, fov: 56, ease: 'inOutQuad' },
      ] },
      { kind: 'subtitle', cues: [
        { t: 0.8, dur: 2.6, key: `story.chapter.n${night}.title` },
        { t: 3.6, dur: 3.4, key: `story.chapter.n${night}.line` },
      ] },
      { kind: 'audio', cues: [
        { t: 0, do: 'music', state: 'tense', fade: 1.2 },
        { t: 0.5, do: 'sfx', name: 'stamp', vol: 0.6 },
      ] },
    ],
  };
}
