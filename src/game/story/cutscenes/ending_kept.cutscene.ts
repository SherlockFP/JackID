/**
 * KEPT / SAKLI (STORY wave A5, STORY_BIBLE §4 Endings): you lose the kitchen wager. Ada, who never lies, keeps the letter of it: you
 * stay, and she goes down in your place and gives the House her name for your card. At Dawn the card on the table has one name, her flat
 * is empty and her phone says "Stay home." Loki likes the trade. About 45 s, skippable. story/index.ts plays it when
 * the kitchen flow ends with `wager: 'lose'`.
 *
 * Hooks (the wiring registers them, a missing hook only logs): `ending.home` ({ ada: 'seat' } at the start, { ada: 'gone' } when she
 * leaves), and the existing `home.doorOpen` (the door swings open on its own; she is already out of the frame).
 * Everything is in the flat (`home.*` anchors); the Clerk in the doorway is a voice here, not an actor.
 */
import type { CutsceneDef, CutTarget } from '@/core/cutscene/types';
import { ENDING_HOOK, endingScene } from '../endings';

const FLAT_EYE: CutTarget = { anchor: 'home.spawn', offset: [0, 1.62, 0] };
const ADA = { speaker: 'evening.speaker.spouse', voice: 'spouse' } as const;
const CLERK = { speaker: 'story.speaker.clerk', voice: 'house' } as const;

const def: CutsceneDef = {
  id: endingScene('kept'),
  kind: 'ending',
  duration: 44.5,
  fadeIn: 0.6,
  fadeOut: 1.2,
  tracks: [
    { kind: 'camera', handheld: 0.05, keys: [
      { t: 0, pos: FLAT_EYE, look: { anchor: 'home.table', offset: [0, 0.2, 0] }, fov: 60, cut: true },
      { t: 4.4, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 52, ease: 'inOutQuad' },
      { t: 13.8, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 46, ease: 'inOutQuad' },
      { t: 17.0, pos: FLAT_EYE, look: { anchor: 'home.door', offset: [0, 1.5, 0] }, fov: 56, ease: 'inOutCubic' },
      { t: 22.4, pos: FLAT_EYE, look: { anchor: 'home.table', offset: [0, 0.2, 0] }, fov: 50, cut: true },
      { t: 26.6, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 54, ease: 'inOutQuad' },
      { t: 30.0, pos: FLAT_EYE, look: { anchor: 'home.phone' }, fov: 50, ease: 'inOutQuad' },
      { t: 33.0, pos: FLAT_EYE, look: { anchor: 'home.window' }, fov: 56, ease: 'inOutQuad' },
      { t: 36.4, pos: FLAT_EYE, look: { anchor: 'home.table', offset: [0, 0.2, 0] }, fov: 46, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.0, key: 'story.end.kept.1', ...CLERK, mood: 'calm' },
      { t: 4.0, dur: 2.4, key: 'story.end.kept.2', ...ADA, mood: 'calm' },
      { t: 6.8, dur: 3.6, key: 'story.end.kept.3', ...ADA, mood: 'sad' },
      { t: 10.8, dur: 3.0, key: 'story.end.kept.4' },
      { t: 14.0, dur: 3.0, key: 'story.end.kept.5', ...CLERK, mood: 'whisper' },
      { t: 17.4, dur: 4.2, key: 'story.end.kept.6', ...ADA, mood: 'sad' },
      { t: 22.6, dur: 3.4, key: 'story.end.kept.7' },
      { t: 26.4, dur: 3.2, key: 'story.end.kept.8' },
      { t: 30.0, dur: 2.6, key: 'story.end.kept.9', ...ADA, mood: 'sad' },
      { t: 33.0, dur: 3.0, key: 'story.end.loki.likes', speaker: 'story.speaker.loki', voice: 'loki', mood: 'whisper' },
      { t: 36.6, dur: 3.2, key: 'story.end.kept.10' },
      { t: 40.4, dur: 3.4, key: 'story.end.kept.title' },
    ] },
    { kind: 'hook', cues: [
      { t: 0.1, hook: ENDING_HOOK.home, args: { ada: 'seat' } },
      { t: 19.0, hook: 'home.doorOpen' },
      { t: 19.4, hook: ENDING_HOOK.home, args: { ada: 'gone' } },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'silent', fade: 0.4 },
      { t: 0.7, do: 'sfx', name: 'stamp', vol: 0.6 },
      { t: 18.8, do: 'sfx', name: 'doorCreak', vol: 0.8, at: { anchor: 'home.door' } },
      { t: 22.4, do: 'music', state: 'lounge', fade: 2, intensity: 0.1 },
      { t: 29.9, do: 'sfx', name: 'phoneBuzz', vol: 0.8 },
      { t: 37.0, do: 'sfx', name: 'drip', vol: 0.5 },
    ] },
    { kind: 'fx', cues: [
      { t: 20.4, do: 'fade', alpha: 1, dur: 1.6, color: '#000000' },
      { t: 22.4, do: 'fade', alpha: 0, dur: 1.2 },
    ] },
    { kind: 'light', cues: [
      { t: 20.4, target: 'all', level: 0.7, color: 0xb8c4d8, dur: 1.8 },   // grey Dawn
    ] },
  ],
};
export default def;
