/**
 * Inner monologue (W78): a thought shown in the one subtitle system, in italics, under the speaker "inner" (a small
 * "THOUGHT" plate). `innerLine(text)` is the whole API; the system's own queue, typing and settings (subtitles off,
 * speed, reduced motion) all apply. A new thought replaces the one on screen (same source "inner").
 */
import { registerStrings, t } from '@/core/i18n';
import { subtitles } from '../subtitles';
import strings from './inner.strings';

registerStrings(strings.prefix, { en: strings.en, tr: strings.tr });

export const INNER_SPEAKER = 'inner';
const STYLE_ID = 'px-inner-style';
let lastText = '';
let watching = false;

function styleOnce(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = '.px-subtitle[data-inner="1"] .txt{font-style:italic;opacity:.92}';
  document.head.appendChild(s);
}

/** Keeps `data-inner` on the subtitle bar true only while the inner line is the one on screen. */
function watch(): void {
  if (watching || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const bar = document.querySelector('.px-subtitle');
  if (!bar) return;
  watching = true;
  const sync = (): void => {
    const cur = subtitles.current();
    const inner = !!cur && cur.text === lastText;
    if (inner) bar.setAttribute('data-inner', '1'); else bar.removeAttribute('data-inner');
  };
  new MutationObserver(sync).observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-phase', 'class'] });
  sync();
}

/** Shows `text` as a thought. `dur` is the on-screen time (typing included); without it the reading time is used. */
export function innerLine(text: string, dur?: number): void {
  if (!text) return;
  styleOnce();
  lastText = text;
  subtitles.say({ text, speaker: t('inner.speaker'), source: INNER_SPEAKER, lane: 'story', fit: dur && dur > 0 ? dur : undefined });
  watch();
}
