/**
 * THE PROLOGUE (wave 72): the first beat of a new solo Debt Run, in the apartment, before Night 1. The spouse speaks twice, then the
 * wall phone rings and the Collector says what the card owes tonight. No timer runs here (the run holds the clock until the lift lands,
 * see run.ts `finishPrologue`). Skippable: a hold of Esc (or Space) skips the scene; the Evening then asks for the lift
 * (src/game/home/evening.ts). About 22 s long, well under the 40 s budget.
 */
import type { CutsceneDef } from '@/core/cutscene/types';

const def: CutsceneDef = {
  id: 'prologue',
  kind: 'story',
  duration: 22,
  fadeIn: 0.6,
  fadeOut: 0.4,
  tracks: [
    // The anchors' plan points sit on the floor (home.spawn y 0), so the eye is raised to a standing eye (1.62 m, the
    // player's EYE_STAND) and the spouse's and the table's looks name their seated height. A camera at floor level sat under
    // the floor and framed black.
    { kind: 'camera', handheld: 0.08, keys: [
      { t: 0, pos: { anchor: 'home.spawn', offset: [0, 1.62, 0] }, look: { anchor: 'home.spouse', offset: [0, 1.15, 0] }, fov: 62, cut: true },
      { t: 5, pos: { anchor: 'home.spawn', offset: [0, 1.62, 0] }, look: { anchor: 'home.table', offset: [0, 0.2, 0] }, fov: 60, ease: 'inOutQuad' },
      { t: 9, pos: { anchor: 'home.spawn', offset: [0, 1.62, 0] }, look: { anchor: 'home.phone' }, fov: 56, ease: 'inOutCubic' },
      { t: 13, pos: { anchor: 'home.spawn', offset: [0, 1.62, 0] }, look: { anchor: 'home.window' }, fov: 58, ease: 'inOutQuad' },
      { t: 18, pos: { anchor: 'home.spawn', offset: [0, 1.62, 0] }, look: { anchor: 'home.phone' }, fov: 58, ease: 'inOutQuad' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 0.8, dur: 3.4, key: 'story.prologue.spouse.1', speaker: 'evening.speaker.spouse', voice: 'spouse', mood: 'calm' },
      { t: 4.8, dur: 3.2, key: 'story.prologue.spouse.2', speaker: 'evening.speaker.spouse', voice: 'spouse', mood: 'sad' },
      { t: 10.4, dur: 4.0, key: 'story.prologue.collector.1', speaker: 'story.speaker.collector', voice: 'collector', mood: 'calm' },
      { t: 15.0, dur: 3.4, key: 'story.prologue.collector.2', speaker: 'story.speaker.collector', voice: 'collector', mood: 'whisper' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'lounge', fade: 1.2, intensity: 0.15 },
      { t: 8.6, do: 'sfx', name: 'phoneBuzz', vol: 0.8 },
      { t: 9.6, do: 'sfx', name: 'phoneBuzz', vol: 0.8 },
      { t: 14.8, do: 'music', state: 'tense', fade: 1.5, dread: 0.15 },
    ] },
  ],
};
export default def;
