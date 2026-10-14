/**
 * Dialogue box: bottom third of the screen, portrait on the left or right, speaker plate, typewriter at 40 cps.
 * E / Space / Enter or a click finishes the line, and a second press dismisses it. Skip ends the box at once.
 */
import { t } from '@/core/i18n';
import type { Expr } from './portrait';
import { hasPortrait, portraitSrc } from './portrait';
import { el, enqueue, sayLine, show, skipButton, speakerName, stage, typewrite } from './mangaPanel';

export type PortraitSide = 'left' | 'right';

/** Shows one line from `speakerId` (a rival id, 'notary', 'clerk' or 'you') and resolves when it is dismissed. */
export function dialogue(speakerId: string, lineKey: string, portraitSide: PortraitSide = 'left', expr: Expr = 'calm'): Promise<void> {
  return enqueue(async (ctl) => {
    const host = stage(ctl, 'mg-dialogue');
    const box = el('div', `mg-box side-${portraitSide}`);
    if (hasPortrait(speakerId)) {
      const img = el('img', 'mg-dportrait');
      img.alt = '';
      img.src = portraitSrc(speakerId, expr);
      box.append(img);
    }
    const text = el('div', 'mg-text');
    const line = el('p', 'mg-line');
    const next = el('span', 'mg-next');
    text.append(el('div', 'mg-plate', speakerName(speakerId)), line, next);
    box.append(text);
    host.append(box, skipButton(ctl));
    sayLine(true);
    show(host);

    const tw = typewrite(ctl, line, t(lineKey), 40);
    let typed = false;
    void tw.done.then(() => { typed = true; next.classList.add('ready'); });

    await new Promise<void>((resolve) => {
      const dismiss = (): void => {
        ctl.wake.delete(dismiss);
        ctl.key = null;
        host.removeEventListener('click', onClick);
        resolve();
      };
      const advance = (): void => { if (typed) dismiss(); else tw.finish(); };
      const onClick = (e: Event): void => { e.stopPropagation(); advance(); };
      ctl.wake.add(dismiss);
      ctl.key = advance;
      host.addEventListener('click', onClick);
    });
  });
}
