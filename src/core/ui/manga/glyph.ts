/**
 * Menace glyphs: huge tilted sound-effect text over the scene. EN shows the Japanese glyphs when a CJK font is present
 * and falls back to GO GO GO; TR always shows GÜM GÜM GÜM. Calm Mode fades without the shake.
 */
import { lang, t } from '@/core/i18n';
import { el, enqueue, pause, show, skipButton, stage } from './mangaPanel';

export type GlyphKind = 'menace';

let jpOk: boolean | null = null;

/**
 * Whether a CJK font resolves for the glyphs. A noncharacter has no glyph in any font, so when the katakana measures the
 * same as it, the stack has fallen through to tofu and the English fallback is used.
 */
export function jpGlyphOk(): boolean {
  if (jpOk !== null) return jpOk;
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) { jpOk = false; return jpOk; }
    c.font = '900 96px "Yu Gothic UI", "Yu Gothic", "Hiragino Sans", "Noto Sans JP", "Meiryo", "MS PGothic", sans-serif';
    const a = c.measureText('ゴ').width;
    const b = c.measureText('\u{10FFFF}').width;
    jpOk = Math.abs(a - b) > 0.5;
  } catch {
    jpOk = false;
  }
  return jpOk;
}

/** The text a glyph shows in the current language. */
export function glyphText(): string {
  return lang() === 'en' && !jpGlyphOk() ? t('manga.glyph.fallback') : t('manga.glyph.menace');
}

export function glyph(_kind: GlyphKind = 'menace', holdMs = 1100): Promise<void> {
  return enqueue(async (ctl) => {
    const host = stage(ctl, 'mg-glyph-stage');
    const g = el('div', 'mg-glyph', glyphText());
    g.lang = lang();
    host.append(g, skipButton(ctl));
    show(host);
    await pause(ctl, holdMs);
    host.classList.remove('on');
    await pause(ctl, ctl.m.calm ? 160 : 200);
  });
}
