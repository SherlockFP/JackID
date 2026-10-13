/**
 * Modal panels of the Debt Run session: the pause menu (Esc) and the Intermission panel (between Watches and Nights).
 * Both are DOM panels (DECISIONS C7) built from the shared widgets, so Input switches to 'ui' while they are open.
 */
import { app } from '@/core/app';
import { fmtCoins, t } from '@/core/i18n';
import type { UIOverlayX } from '@/core/ui/ui';
import { button, focusFirst, frame, h, modalPanel } from '@/core/ui/widgets';
import type { DebtRun } from '@/game/run';

export const PAUSE_PANEL = 'ingame-pause';
export const INTER_PANEL = 'ingame-intermission';

export interface PauseOpts { onResume(): void; onQuit(): void; onGone(): void; onStandUp?(): void }

/** Pause menu. `onGone` runs when the panel closes for any reason (Esc, button, state exit). `onStandUp` only when seated. */
export function buildPause(el: HTMLElement, o: PauseOpts): () => void {
  modalPanel(el, { escClose: true, dim: true });
  const f = frame(el, { title: t('ingame.pause.title'), variant: 'brass' });
  button(f.body, { label: t('ingame.pause.resume'), kind: 'primary', onClick: o.onResume });
  if (o.onStandUp) button(f.body, { label: t('ingame.pause.standUp'), onClick: o.onStandUp });
  button(f.body, { label: t('ingame.pause.quit'), kind: 'danger', hold: true, onClick: o.onQuit });
  h('p', 'px-hint', f.body, t('ingame.pause.hint'));
  focusFirst(el);
  return o.onGone;
}

export interface InterOpts { redraw(): void }

/**
 * Intermission: CONTINUE opens the floor when the Night is paid (`openFloor`), otherwise rings the Bell for the next
 * Watch (`startWatch`). Both refuse without side effects when the phase does not match, so one button serves both.
 * Topside (after the 8th Night paid) offers STAY UP (win) or GO BACK DOWN (Overdrawn).
 */
export function buildIntermission(el: HTMLElement, run: DebtRun, o: InterOpts): void {
  modalPanel(el, { escClose: false, dim: true });
  const q = run.debt();
  const f = frame(el, { title: t('ingame.inter.title', { n: run.night() }), variant: 'cyan' });
  h('div', 'px-text', f.body, t('ingame.inter.debt', { paid: fmtCoins(q.paid), due: fmtCoins(q.due) }));
  if (run.topsideOpen) {
    button(f.body, { label: t('ingame.inter.stayUp'), kind: 'primary', onClick: () => { run.stayUp(); } });
    button(f.body, { label: t('ingame.inter.goBack'), onClick: () => { run.goBackDown(); o.redraw(); } });
  } else {
    button(f.body, {
      label: t('ingame.inter.continue'), kind: 'primary',
      onClick: () => {
        if (run.openFloor()) {
          void (app.ui as UIOverlayX).banner(t('ingame.night', { n: run.night() }));
          o.redraw();
        } else {
          run.startWatch();
        }
      },
    });
  }
  h('p', 'px-hint', f.body, t('ingame.inter.hint'));
  focusFirst(el);
}
