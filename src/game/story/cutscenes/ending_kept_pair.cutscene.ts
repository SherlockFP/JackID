/**
 * KEPT PAIR / SÖZ SÖZE, the true ending (STORY wave A5, STORY_BIBLE §4 Endings): the card burns clean (n26, the first this year),
 * the lift rises with Ada beside you, the lift phone rings and she picks up (Mira, "Thanks for picking up."), and at home she beats
 * you at her game for the first time: "There you are." About 49 s, skippable. NOT TRIGGERED YET: the N8 flow plays it with
 * `vars: { loki: t(record.lokiLine) }` (Loki burns with the card, or stays if his word was spent at match point).
 *
 * Hooks (the wiring registers them, a missing hook only logs): `ending.burn` (the card burns), `ending.home` ({ ada: 'seat' } dresses the flat).
 * LAYOUT (VERIFY in the engine): part 1 looks from the player's eye at the Compere's stage (`stage.compere`); part 2 sits inside the
 * lift car at (-4, 0, -31.1) (level.ts: lift root (-4, 0, -30), car 1.8 m wide, doors toward +z); part 3 is the flat (`home.*`).
 * Ada's face is lit by the light cue only: ActorSpec has no `npc: false` / rim yet (see the A5 wiring plan).
 */
import type { CutsceneDef, CutTarget } from '@/core/cutscene/types';
import type { V3 } from '@/core/types';
import { ENDING_HOOK, endingScene } from '../endings';

const CAR: V3 = [-4, 0, -31.1];
const ADA_AT: V3 = [CAR[0] + 0.4, 0, CAR[2] - 0.15];
const EYE: V3 = [CAR[0] - 0.55, 1.55, CAR[2] + 0.5];
const ADA = { speaker: 'evening.speaker.spouse', voice: 'spouse' } as const;
const FLAT_EYE: CutTarget = { anchor: 'home.spawn', offset: [0, 1.62, 0] };
const TABLE: CutTarget = { anchor: 'stage.compere', offset: [0, -0.9, 0] };   // the Champion's table, just below the Compere's head

const def: CutsceneDef = {
  id: endingScene('kept_pair'),
  kind: 'ending',
  duration: 49.5,
  fadeIn: 0.6,
  fadeOut: 1.2,
  actors: {
    ada: { kind: 'mannequin', pos: ADA_AT, rotY: 0, color: 0xc89a2c, height: 1.62, clip: 'Idle_Loop' },
  },
  tracks: [
    { kind: 'camera', handheld: 0.1, keys: [
      { t: 0, pos: { player: 'local' }, look: TABLE, fov: 58, cut: true },
      { t: 7.0, pos: { player: 'local' }, look: { anchor: 'stage.compere' }, fov: 38, ease: 'inOutQuad' },
      { t: 11.4, pos: { player: 'local' }, look: TABLE, fov: 52, ease: 'inOutQuad' },
      { t: 19.2, pos: EYE, look: { actor: 'ada' }, fov: 44, cut: true },
      { t: 30.4, pos: EYE, look: { actor: 'ada' }, fov: 36, ease: 'inOutQuad' },
      { t: 36.6, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 56, cut: true },
      { t: 44.0, pos: FLAT_EYE, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 48, ease: 'inOutQuad' },
    ] },
    { kind: 'actor', actor: 'ada', cues: [
      { t: 22.8, clip: 'Idle_Talking_Loop', fade: 0.3 },
      { t: 26.0, clip: 'Idle_Loop', fade: 0.3 },
      { t: 33.2, clip: 'Idle_Talking_Loop', fade: 0.3 },
      { t: 35.8, clip: 'Idle_Loop', fade: 0.3 },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.0, key: 'story.end.burn.1', speaker: 'story.speaker.clerk', voice: 'house', mood: 'calm' },
      { t: 4.0, dur: 2.6, key: 'story.end.burn.2', speaker: 'story.speaker.clerk', voice: 'house', mood: 'whisper' },
      { t: 7.0, dur: 4.0, key: 'story.end.kept_pair.1', speaker: 'story.end.speaker.champion', voice: 'compere', mood: 'sad' },
      { t: 11.4, dur: 2.6, key: 'story.end.kept_pair.2' },
      { t: 14.4, dur: 3.2, key: 'story.end.loki', speaker: 'story.speaker.loki', voice: 'loki', mood: 'whisper' },
      { t: 20.2, dur: 2.4, key: 'story.end.kept_pair.3' },
      { t: 23.0, dur: 3.2, key: 'story.end.kept_pair.4', ...ADA, mood: 'cheery' },
      { t: 26.8, dur: 3.2, key: 'story.end.kept_pair.5' },
      { t: 30.6, dur: 2.6, key: 'story.end.kept_pair.6', speaker: 'story.speaker.mira', voice: 'mira', mood: 'whisper' },
      { t: 33.6, dur: 2.6, key: 'story.end.kept_pair.7', ...ADA, mood: 'calm' },
      { t: 38.0, dur: 3.4, key: 'story.end.kept_pair.8' },
      { t: 42.0, dur: 2.8, key: 'story.end.kept_pair.9', ...ADA, mood: 'cheery' },
      { t: 45.6, dur: 3.4, key: 'story.end.kept_pair.title' },
    ] },
    { kind: 'hook', cues: [
      { t: 1.5, hook: ENDING_HOOK.burn },
      { t: 36.6, hook: ENDING_HOOK.home, args: { ada: 'seat' } },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'silent', fade: 0.4 },
      { t: 0.7, do: 'sfx', name: 'stamp', vol: 0.8 },
      { t: 1.6, do: 'sfx', name: 'whoosh', vol: 0.5 },
      { t: 4.0, do: 'sfx', name: 'stamp', vol: 0.9 },
      { t: 19.1, do: 'stinger', id: 'ascend', vol: 0.9 },
      { t: 19.2, do: 'music', state: 'elevator', fade: 1 },
      { t: 19.4, do: 'sfx', name: 'elevator', vol: 0.8 },
      { t: 20.0, do: 'sfx', name: 'motor', vol: 0.4 },
      { t: 26.8, do: 'sfx', name: 'phoneRing', vol: 0.9, at: { anchor: 'elevator' } },
      { t: 28.0, do: 'sfx', name: 'phoneRing', vol: 0.9, at: { anchor: 'elevator' } },
      { t: 29.6, do: 'sfx', name: 'phonePickup', vol: 0.8 },
      { t: 33.0, do: 'music', state: 'ending', fade: 2 },
      { t: 36.6, do: 'music', state: 'lounge', fade: 1.5, intensity: 0.15 },
    ] },
    { kind: 'fx', cues: [
      { t: 1.6, do: 'flash', color: 0xff8a2a, alpha: 0.5, dur: 0.6 },
      { t: 1.6, do: 'tint', color: 0xff6a1a, alpha: 0.25, dur: 1.4 },
      { t: 17.8, do: 'fade', alpha: 1, dur: 1.2, color: '#000000' },
      { t: 19.2, do: 'fade', alpha: 0, dur: 0.9 },
      { t: 35.8, do: 'fade', alpha: 1, dur: 0.8, color: '#ffffff' },     // daylight at G
      { t: 36.6, do: 'fade', alpha: 0, dur: 1.0 },
    ] },
    { kind: 'light', cues: [
      { t: 1.5, target: 'all', flicker: 0.5, dur: 1.0 },
      { t: 19.2, target: 'all', level: 0.25, dur: 0.1 },
      { t: 21.0, target: 'all', level: 1.15, color: 0xffe0b0, dur: 12 },   // the lift climbs into the light: her face
      { t: 36.6, target: 'all', level: 1, color: null, dur: 0.8 },
    ] },
  ],
};
export default def;
