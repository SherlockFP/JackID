/**
 * Duel cutscene factories (STORY lane, Wave 25). Each `cutscenes/*.cutscene.ts` file default-exports one of these, so the
 * `*.cutscene.ts` glob in main.ts registers it. This file is not itself a registered scene.
 *
 * Manga hooks (lane C registers them with `app.cutscene.registerHook`; a missing hook only logs):
 *   `manga.cutin`  args { rival: RivalId, expr: 'calm'|'smirk'|'shock'|'rage'|'hollow', line: i18n key }
 *   `manga.glyph`  args { kind: 'menace' }
 * Dialogue is plain subtitles with the rival or Notary as speaker. Venue anchors are `duel.<zone>` (the integrator places
 * them at the duel tables; a missing anchor resolves to the origin and warns once).
 */
import type { CutsceneDef, CutsceneTrack, SubtitleCue } from '@/core/cutscene/types';
import { isBossRival, type RivalDef, type RivalId, type RivalExpr } from './rivals';

export const MANGA_HOOK = { cutin: 'manga.cutin', glyph: 'manga.glyph' } as const;

const S = 'story.duel.';
/** Scene ids of the duel cutscenes: phase 1 and phase 2 rivals each have an intro and both outcomes (Vell also has the release scene). */
export const SEAL_SCENE = 'duel_seal';
export const PHASE1_RIVALS: readonly RivalId[] = ['tamsin', 'kuro', 'lucan'];
export const PHASE2_RIVALS: readonly RivalId[] = ['mimosa', 'orrin', 'vell'];
/** Vell's thrown match is called out: the release / void ending path (played once, in place of his 'won' scene). */
export const VELL_CALLED_SCENE = 'duel_vell_called';

/** The scene id for a rival beat: `duel_<id>_intro`, `duel_<id>_won` (rival beaten), `duel_<id>_lost` (a Mark taken) or `duel_<id>_called` (Vell only). */
export function duelSceneId(rival: RivalId, beat: 'intro' | 'won' | 'lost' | 'called'): string {
  return `duel_${rival}_${beat}`;
}

function cutin(rival: RivalDef, expr: RivalExpr, line: string): CutsceneTrack {
  return { kind: 'hook', cues: [{ t: 0.2, hook: MANGA_HOOK.cutin, args: { rival: rival.id, expr, line } }] };
}

function glyph(t: number): CutsceneTrack {
  return { kind: 'hook', cues: [{ t, hook: MANGA_HOOK.glyph, args: { kind: 'menace' } }] };
}

/** The Bench seals the duel: the Notary reads the terms, then the Mark answers. Played on the first duel of the run (N1). */
export function sealScene(): CutsceneDef {
  const subs: SubtitleCue[] = [
    { t: 1.0, dur: 3.6, key: `${S}line.notary.seal`, speaker: `${S}speaker.notary`, voice: 'house', mood: 'calm' },
    { t: 5.2, dur: 3.6, key: `${S}line.mark.intro`, speaker: `${S}speaker.mark`, mood: 'whisper' },
  ];
  return {
    id: SEAL_SCENE,
    kind: 'story',
    duration: 10,
    tracks: [
      { kind: 'camera', keys: [
        { t: 0, pos: { player: 'local' }, look: { anchor: 'duel.bench' }, fov: 60, cut: true },
        { t: 9, pos: { player: 'local' }, look: { anchor: 'duel.bench' }, fov: 54, ease: 'inOutQuad' },
      ] },
      glyph(0.4),
      { kind: 'subtitle', cues: subs },
      { kind: 'audio', cues: [{ t: 0, do: 'music', state: 'tense', fade: 1.0 }, { t: 4.8, do: 'sfx', name: 'stamp', vol: 0.8 }] },
    ],
  };
}

/** A rival's duel opens: the portrait cuts in, the rival speaks, and a boss rival (Lucan, Orrin, Vell) also announces the Terms (boss Night). Orrin's scene ends on the Clerk's ledger line. */
export function introScene(rival: RivalDef): CutsceneDef {
  const tracks: CutsceneTrack[] = [
    { kind: 'camera', keys: [
      { t: 0, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 60, cut: true },
      { t: 8, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 54, ease: 'inOutQuad' },
    ] },
    cutin(rival, rival.expr.intro, rival.lines.intro),
    glyph(0.6),
    { kind: 'subtitle', cues: [
      { t: 1.0, dur: 3.4, key: rival.lines.intro, speaker: rival.name, mood: 'calm' },
    ] },
    { kind: 'audio', cues: [{ t: 0, do: 'music', state: 'tense', fade: 1.0 }] },
  ];
  const boss = isBossRival(rival.id);
  if (boss) {
    // The boss Night: the modifier is announced as Rival's Terms. The vars (name, desc) come from `termsVars` at play time.
    const sub = tracks.find((tr): tr is Extract<CutsceneTrack, { kind: 'subtitle' }> => tr.kind === 'subtitle');
    sub?.cues.push({ t: 4.8, dur: 4.6, key: `${S}terms.intro`, speaker: `${S}terms.title`, mood: 'calm' });
    if (rival.clerk) sub?.cues.push({ t: 9.8, dur: 3.8, key: rival.clerk, speaker: `${S}speaker.clerk`, mood: 'calm' });
  }
  return { id: duelSceneId(rival.id, 'intro'), kind: 'story', duration: rival.clerk ? 14 : boss ? 10 : 8, tracks };
}

/** The duel is over. `won`: the rival is beaten and released to the lift. `lost`: the rival takes one of the Mark's Marks. */
export function outroScene(rival: RivalDef, won: boolean): CutsceneDef {
  const beat = won ? 'won' : 'lost';
  const expr = won ? rival.expr.won : rival.expr.lost;
  const line = won ? rival.lines.loss : rival.lines.catch;
  const narration = won ? `${S}outro.won` : `${S}outro.lost`;
  return {
    id: duelSceneId(rival.id, beat),
    kind: 'story',
    duration: 7,
    tracks: [
      { kind: 'camera', keys: [
        { t: 0, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 58, cut: true },
        { t: 6, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 56, ease: 'inOutQuad' },
      ] },
      cutin(rival, expr, line ?? rival.lines.intro),
      { kind: 'subtitle', cues: [
        { t: 1.0, dur: 3.0, key: line ?? rival.lines.intro, speaker: rival.name, mood: won ? 'sad' : 'cheery' },
        { t: 4.0, dur: 2.8, key: narration },
      ] },
      { kind: 'audio', cues: [{ t: 3.9, do: 'sfx', name: won ? 'unlock' : 'stamp', vol: 0.7 }] },
    ],
  };
}

/** The release scene: Vell's thrown match is called out. The Notary rules the count void, Vell asks to be named a cheat and goes to the lift. */
export function calledScene(rival: RivalDef): CutsceneDef {
  return {
    id: duelSceneId(rival.id, 'called'),
    kind: 'story',
    duration: 14,
    tracks: [
      { kind: 'camera', keys: [
        { t: 0, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 58, cut: true },
        { t: 13, pos: { player: 'local' }, look: { anchor: rival.venue }, fov: 52, ease: 'inOutQuad' },
      ] },
      cutin(rival, 'calm', rival.lines.end ?? rival.lines.intro),
      { kind: 'subtitle', cues: [
        { t: 1.0, dur: 3.6, key: `${S}line.notary.cheat`, speaker: `${S}speaker.notary`, voice: 'house', mood: 'calm' },
        { t: 5.2, dur: 4.0, key: rival.lines.end ?? rival.lines.intro, speaker: rival.name, mood: 'sad' },
        { t: 9.8, dur: 3.6, key: `${S}outro.vell.release` },
      ] },
      { kind: 'audio', cues: [{ t: 0.8, do: 'sfx', name: 'stamp', vol: 0.8 }, { t: 10.0, do: 'sfx', name: 'unlock', vol: 0.7 }, { t: 9.5, do: 'music', state: 'ending', fade: 2.0 }] },
    ],
  };
}

/** Every duel scene id a phase 1 rival needs: the intro and both outcomes. */
export function phase1SceneIds(): string[] {
  return PHASE1_RIVALS.flatMap((id) => [duelSceneId(id, 'intro'), duelSceneId(id, 'won'), duelSceneId(id, 'lost')]);
}

/** Every duel scene id the phase 2 rivals need: intro and both outcomes each, plus Vell's release scene. */
export function phase2SceneIds(): string[] {
  return [...PHASE2_RIVALS.flatMap((id) => [duelSceneId(id, 'intro'), duelSceneId(id, 'won'), duelSceneId(id, 'lost')]), VELL_CALLED_SCENE];
}
