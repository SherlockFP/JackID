/**
 * The chapter title: "1. BÖLÜM · İLK AD", centred, fades out by itself. The Night title cards (cutscenes/chapterCard.ts) call it
 * through the `story.chapterTitle` hook instead of a subtitle, so it does not read as a button. Runs on the UI frame clock.
 */
import './chapterTitle.css';
import { app } from '@/core/app';
import { t } from '@/core/i18n';
import { addTicker, h } from '@/core/ui/widgets';

/** Seconds the title holds, then fades (the CSS transition is 0.6 s), then is removed. */
export const TITLE_HOLD_S = 2.4;
export const TITLE_FADE_S = 0.6;

export function showChapterTitle(night: number): void {
  const el = h('div', 'chapter-title', app.ui.root, t('story.chapter.head', { n: night, title: t(`story.chapter.n${night}.title`) }));
  let age = 0;
  addTicker((dt) => {
    age += dt;
    el.classList.toggle('in', age >= 0.05 && age < TITLE_HOLD_S);
    if (age < TITLE_HOLD_S + TITLE_FADE_S) return true;
    el.remove();
    return false;
  });
}
