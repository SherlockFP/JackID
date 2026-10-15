/**
 * The Collector's visit (WAVE69 §7): a missed quota at home. The run ends with `endRun('fell', 'shot')` and story/index.ts
 * plays this scene in place of the trapdoor (`quota_fail`). The front door swings through the `home.doorOpen` hook, a goon
 * walks in along the door's axis, fires, and the screen goes white and then black. Not skippable.
 *
 * LAYOUT (assumed until src/world/home builds the flat): the front door sits in the +z wall, its sill 3.6 m out from
 * HOME_ORIGIN on the centre line x = HOME_ORIGIN.x. The hall is 1.4 m beyond the sill and the spawn is 1.2 m inside.
 * CutActors lerps straight to each moveTo with no collision, so every waypoint stays on that one line. VERIFY the door and
 * the hall against buildHome before this ships; the camera uses anchors and needs no check.
 */
import type { CutsceneDef } from '@/core/cutscene/types';
import type { V3 } from '@/core/types';
import { HOME_ORIGIN } from '@/game/home/contract';

const X = HOME_ORIGIN[0];
const Z = HOME_ORIGIN[2];
const HALL: V3 = [X, 0, Z + 5.0];
const SILL: V3 = [X, 0, Z + 3.6];
const STOP: V3 = [X, 0, Z + 2.6];

/** The goon's coat: a warm near-black, dark enough to vanish in a dim flat. */
const GOON_COAT = 0x2a2422;

const def: CutsceneDef = {
  id: 'mafia_visit',
  kind: 'ending',
  duration: 7.0,
  skippable: false,
  fadeIn: 0.3,
  actors: {
    goon: {
      kind: 'mannequin',
      pos: HALL,
      rotY: 180,                          // faces −z, into the flat
      color: GOON_COAT,
      height: 1.9,
      visible: false,                     // stands behind the closed door until the hook opens it
      clip: 'Idle_Loop',
      props: [{ prop: 'pistol', bone: 'hand_r', pos: [0, 0.105, 0.03], rot: [-90, 0, -180] }],
    },
  },
  tracks: [
    { kind: 'camera', handheld: 0.5, keys: [
      { t: 0, pos: { anchor: 'home.spawn', offset: [0, 1.6, 0] }, look: { anchor: 'home.door', offset: [0, 1.5, 0] }, fov: 66, cut: true },
      { t: 2.6, pos: { anchor: 'home.spawn', offset: [0, 1.6, 0] }, look: { actor: 'goon', bone: 'head' }, fov: 60, ease: 'inOutCubic' },
      { t: 3.4, pos: { anchor: 'home.spawn', offset: [0, 1.6, 0] }, look: { actor: 'goon', bone: 'head' }, fov: 56, ease: 'inCubic' },
    ] },
    { kind: 'hook', cues: [
      { t: 0.4, hook: 'home.doorOpen' },   // story/index.ts: app.world.home?.doorTo(1, 0.8), a jump to open when seeking
    ] },
    { kind: 'actor', actor: 'goon', cues: [
      { t: 0.9, visible: true, clip: 'Walk_Formal_Loop', moveTo: { pos: SILL, dur: 0.7, faceMove: true } },
      { t: 1.6, moveTo: { pos: STOP, dur: 0.9, faceMove: true } },
      { t: 2.5, clip: 'Idle_Loop', turnTo: { target: { player: 'local' }, dur: 0.3 } },
      { t: 3.3, clip: 'Pistol_Shoot' },
      { t: 4.8, clip: 'Idle_Loop' },
    ] },
    { kind: 'subtitle', cues: [
      { t: 1.1, dur: 2.2, key: 'story.mafia.1', speaker: 'story.speaker.house', voice: 'house', mood: 'calm' },
    ] },
    { kind: 'audio', cues: [
      { t: 0, do: 'music', state: 'silent', fade: 0.4 },
      { t: 0.4, do: 'sfx', name: 'doorCreak', vol: 0.8, at: { anchor: 'home.door' } },
      { t: 1.0, do: 'sfx', name: 'footstep', vol: 0.55, at: { actor: 'goon' } },
      { t: 1.45, do: 'sfx', name: 'footstep', vol: 0.55, at: { actor: 'goon' } },
      { t: 1.9, do: 'sfx', name: 'footstep', vol: 0.55, at: { actor: 'goon' } },
      { t: 2.35, do: 'sfx', name: 'footstep', vol: 0.55, at: { actor: 'goon' } },
      { t: 3.4, do: 'sfx', name: 'gunShot', vol: 1, at: { actor: 'goon', bone: 'hand_r' } },
      { t: 4.0, do: 'sfx', name: 'thud', vol: 0.8 },
      { t: 4.2, do: 'music', state: 'defeat', fade: 0.6 },
      { t: 5.4, do: 'sfx', name: 'drip', vol: 0.5 },
    ] },
    { kind: 'fx', cues: [
      { t: 3.4, do: 'flash', color: 0xffffff, alpha: 1, dur: 0.35 },   // app.fx.flash already honours reduceFlashing
      { t: 3.4, do: 'shake', amp: 0.14, dur: 0.7, roll: 0.5 },
      { t: 5.0, do: 'fade', alpha: 1, dur: 1.4, color: '#000000' },
    ] },
    { kind: 'light', cues: [
      { t: 0, target: 'all', level: 0.5, dur: 0.5, restore: true },
      { t: 3.4, target: 'all', level: 0.04, dur: 1.6, restore: true },   // dark until the fade takes the screen
    ] },
  ],
};
export default def;
