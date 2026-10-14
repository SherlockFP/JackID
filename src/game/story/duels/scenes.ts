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
import type { RivalDef, RivalId, RivalExpr } from './rivals';

export const MANGA_HOOK = { cutin: 'manga.cutin', glyph: 'manga.glyph' } as const;

const S = 'story.duel.';
/** Scene ids of the phase 1 duel cutscenes. Phase 2 rivals have no scenes yet. */
export const SEAL_SCENE = 'duel_seal';
export const PHASE1_RIVALS: readonly RivalId[] = ['tamsin', 'kuro', 'lucan'];

/** The scene id for a rival beat: `duel_<id>_intro`, `duel_<id>_won` (rival beaten) or `duel_<id>_lost` (a Mark taken). */
export function duelSceneId(rival: RivalId, beat: 'intro' | 'won' | 'lost'): string {
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

/** A rival's duel opens: the portrait cuts in, the rival speaks, and Lucan also announces the Terms (boss Night). */
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
  if (rival.id === 'lucan') {
    // The boss Night: the modifier is announced as Rival's Terms. The vars (name, desc) come from `termsVars` at play time.
    const sub = tracks.find((tr): tr is Extract<CutsceneTrack, { kind: 'subtitle' }> => tr.kind === 'subtitle');
    sub?.cues.push({ t: 4.8, dur: 4.6, key: `${S}terms.intro`, speaker: `${S}terms.title`, mood: 'calm' });
  }
  return { id: duelSceneId(rival.id, 'intro'), kind: 'story', duration: rival.id === 'lucan' ? 10 : 8, tracks };
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

/** Every duel scene id a phase 1 rival needs: the intro and both outcomes. */
export function phase1SceneIds(): string[] {
  return PHASE1_RIVALS.flatMap((id) => [duelSceneId(id, 'intro'), duelSceneId(id, 'won'), duelSceneId(id, 'lost')]);
}
