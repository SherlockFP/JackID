/**
 * Anime presentation layer for the duel layer (Wave 25 "TALLY"). Public API:
 *   cutin(rivalId, expr, lineKey?)               portrait slide-in panel with a line
 *   glyph('menace')                              GO GO GO / ゴ ゴ ゴ / GÜM GÜM GÜM
 *   dialogue(speakerId, lineKey, 'left'|'right') bottom-third box with typewriter text
 *   reveal(script, clues, 'CHEAT'|'FAIR')        freeze, Tally Sheet, three panels, RULED stamp
 *   portrait(rivalId, expr)                      cached procedural canvas (shared, do not append)
 *
 * Cutscene hooks `manga.cutin`, `manga.glyph` and `manga.reveal` are registered by `installManga(app)`.
 * Every presentation has a Skip button, and E / Space / Enter advance it. Calm Mode and reduceFlashing come from the
 * save settings.
 */
import './manga.css';
import { registerStrings } from '@/core/i18n';
import type { App } from '@/core/app';
import type { CutscenePlayer } from '@/core/cutscene/types';
import strings from './manga.strings';
import { cutin as cutinRun, setMotionSource, type Motion } from './mangaPanel';
import { glyph as glyphRun } from './glyph';
import { reveal as revealRun, type MangaClue, type MangaScript, type Verdict } from './reveal';
import { EXPRESSIONS, type Expr } from './portrait';

registerStrings(strings.prefix, strings);

export { cutinRun as cutin, glyphRun as glyph, revealRun as reveal };
export { dialogue, type PortraitSide } from './dialogue';
export { portrait, portraitSrc, PORTRAIT_IDS, EXPRESSIONS, hasPortrait, type Expr, type HairStyle, type EyeStyle, type MouthStyle, type Accessory } from './portrait';
export { skip as skipPresentation, busy as mangaBusy } from './mangaPanel';
export type { MangaClue, MangaScript, Verdict };

type Args = Record<string, unknown>;
function obj(v: unknown): Args { return v && typeof v === 'object' && !Array.isArray(v) ? (v as Args) : {}; }
function exprOf(v: unknown): Expr {
  return (EXPRESSIONS as readonly string[]).includes(v as string) ? (v as Expr) : 'calm';
}
function clueList(v: unknown): MangaClue[] {
  if (!Array.isArray(v)) return [];
  const out: MangaClue[] = [];
  for (const c of v) {
    const o = obj(c);
    const channel = o.channel;
    if ((channel === 'tell' || channel === 'table' || channel === 'math') && typeof o.key === 'string') {
      out.push({
        channel,
        round: typeof o.round === 'number' ? o.round : 0,
        key: o.key,
        data: obj(o.data),
      });
    }
  }
  return out;
}

/**
 * Registers the three manga hooks on the cutscene player and points Calm Mode / reduceFlashing at the save settings.
 * Hooks skip their animation while the timeline is seeking (late join / skip), like every other hook.
 * Returns the disposer.
 */
export function installManga(app: Pick<App, 'cutscene' | 'save'>): () => void {
  setMotionSource((): Motion => {
    const s = app.save.data.settings;
    return { calm: !!s.calm, noFlash: !!s.reduceFlashing };
  });
  const cs: CutscenePlayer = app.cutscene;
  const offs = [
    cs.registerHook('manga.cutin', (args, ctx) => {
      if (ctx.seeking) return;
      const a = obj(args);
      const rival = typeof a.rival === 'string' ? a.rival : 'you';
      const line = typeof a.line === 'string' ? a.line : undefined;
      const side = a.side === 'left' ? 'left' : 'right';
      void cutinRun(rival, exprOf(a.expr), line, { side });
    }),
    cs.registerHook('manga.glyph', (_args, ctx) => {
      if (ctx.seeking) return;
      void glyphRun('menace');
    }),
    cs.registerHook('manga.reveal', (args, ctx) => {
      if (ctx.seeking) return;
      const a = obj(args);
      const script: MangaScript = {
        saw: typeof a.saw === 'string' ? a.saw : '',
        happened: typeof a.happened === 'string' ? a.happened : '',
        why: typeof a.why === 'string' ? a.why : '',
      };
      const verdict: Verdict = a.verdict === 'FAIR' ? 'FAIR' : 'CHEAT';
      void revealRun(script, clueList(a.clues), verdict);
    }),
  ];
  return () => {
    for (const off of offs) off();
    setMotionSource(() => ({ calm: false, noFlash: false }));
  };
}
