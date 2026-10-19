/**
 * COLD KITCHEN / SOĞUK MUTFAK (STORY wave A5, STORY_BIBLE §4 Endings): you beat Ada at the kitchen wager, then win the Wager clean. The
 * card burns and you are free; the Champion, beaten: "You did what I couldn't."; at home the kitchen light is on and her chair is still.
 * About 42 s, skippable. NOT TRIGGERED YET: the N8 flow plays it with `vars: { loki: t(record.lokiLine) }` (Loki burns with the card, or
 * stays if his word was spent at match point). Selim pouring you a drink (bond 3, `record.waiting`) is the wiring's tag, not this scene's.
 *
 * Hooks (the wiring registers them, a missing hook only logs): `ending.burn`, `ending.home` ({ ada: 'still' } dresses the flat).
 * Part 1 looks from the player's eye at the stage; the lift ride is black with the House PA over it; part 2 is the flat (`home.*`).
 */
import type { CutsceneDef, CutTarget } from '@/core/cutscene/types';
import { ENDING_HOOK, endingScene } from '../endings';

const FLAT_EYE: CutTarget = { anchor: 'home.spawn', offset: [0, 1.62, 0] };
const TABLE: CutTarget = { anchor: 'stage.compere', offset: [0, -0.9, 0] };   // the Champion's table, just below the Compere's head

const def: CutsceneDef = {
  id: endingScene('cold_kitchen'),
  kind: 'ending',
  duration: 42,
  fadeIn: 0.6,
  fadeOut: 1.2,
  tracks: [
    { kind: 'camera', handheld: 0.06, keys: [
      { t: 0, pos: { player: 'local' }, look: TABLE, fov: 58, cut: true },
      { t: 6.8, pos: { player: 'local' }, look: { anchor: 'stage.compere' }, fov: 38, ease: 'inOutQuad' },
      { t: 10.4, pos: { player: 'local' }, look: TABLE, fov: 54, ease: 'inOutQuad' },
      { t: 26.0, pos: FLAT_EYE, look: { anchor: 'home.table', offset: [0, 0.2, 0] }, fov: 58, cut: true },
      { t: 29.6, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 50, ease: 'inOutQuad' },
      { t: 35.0, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 42, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.0, key: 'story.end.burn.1', speaker: 'story.speaker.clerk', voice: 'house', mood: 'calm' },
      { t: 4.0, dur: 2.6, key: 'story.end.burn.2', speaker: 'story.speaker.clerk', voice: 'house', mood: 'whisper' },
      { t: 6.8, dur: 3.2, key: 'story.end.cold_kitchen.1', speaker: 'story.end.speaker.champion', voice: 'compere', mood: 'calm' },
      { t: 10.4, dur: 3.0, key: 'story.end.cold_kitchen.2' },
      { t: 13.8, dur: 3.2, key: 'story.end.loki', speaker: 'story.speaker.loki', voice: 'loki', mood: 'whisper' },
      { t: 18.8, dur: 3.2, key: 'story.end.cold_kitchen.3', speaker: 'story.speaker.pa', voice: 'house', mood: 'calm' },
      { t: 22.4, dur: 3.4, key: 'story.end.cold_kitchen.4' },
      { t: 27.0, dur: 2.6, key: 'story.end.cold_kitchen.5' },
      { t: 30.0, dur: 3.2, key: 'story.end.cold_kitchen.6' },
      { t: 33.8, dur: 3.2, key: 'story.end.cold_kitchen.7' },
      { t: 37.4, dur: 3.4, key: 'story.end.cold_kitchen.title' },
    ] },
    { kind: 'hook', cues: [
      { t: 1.5, hook: ENDING_HOOK.burn },
      { t: 26.0, hook: ENDING_HOOK.home, args: { ada: 'still' } },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'silent', fade: 0.4 },
      { t: 0.7, do: 'sfx', name: 'stamp', vol: 0.8 },
      { t: 1.6, do: 'sfx', name: 'whoosh', vol: 0.5 },
      { t: 4.0, do: 'sfx', name: 'stamp', vol: 0.9 },
      { t: 18.6, do: 'sfx', name: 'elevator', vol: 0.7 },
      { t: 19.2, do: 'sfx', name: 'motor', vol: 0.4 },
      { t: 24.4, do: 'sfx', name: 'chime', vol: 0.6 },
      { t: 24.6, do: 'music', state: 'ending', fade: 1.5 },
      { t: 26.0, do: 'music', state: 'lounge', fade: 1.5, intensity: 0.1 },
    ] },
    { kind: 'fx', cues: [
      { t: 1.6, do: 'flash', color: 0xff8a2a, alpha: 0.5, dur: 0.6 },
      { t: 1.6, do: 'tint', color: 0xff6a1a, alpha: 0.25, dur: 1.4 },
      { t: 17.2, do: 'fade', alpha: 1, dur: 1.2, color: '#000000' },
      { t: 24.4, do: 'fade', alpha: 1, dur: 1.4, color: '#ffffff' },     // daylight at G
      { t: 26.0, do: 'fade', alpha: 0, dur: 1.4 },
    ] },
    { kind: 'light', cues: [
      { t: 1.5, target: 'all', flicker: 0.5, dur: 1.0 },
      { t: 26.0, target: 'all', level: 0.85, color: 0xc8d8f0, dur: 1.5 },   // a cold white kitchen
    ] },
  ],
};
export default def;
