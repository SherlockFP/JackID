/**
 * The demo's last card (core/demo.ts): "DEMO SONU" after Lucan's duel on Night 3, or after the paid Night 3 Dawn. A small listener on the
 * bus: the run is not told apart in any way until the card ends it. Wishlist has no link yet (placeholder), Menu quits the run to the menu.
 */
import { app } from '@/core/app';
import { bus } from '@/core/events';
import { t } from '@/core/i18n';
import { demoRunEnds } from '@/core/demo';
import { presentationIdle } from './duels/runlink';
import type { DebtRun } from './run';

const debt = (): DebtRun | null => app.run as DebtRun | null;

export function installDemoEnd(): () => void {
  let shown = false;
  const card = async (): Promise<void> => {
    for (;;) {
      const r = await app.ui.modal({
        title: t('demo.title'), body: t('demo.teaser'),
        buttons: [{ id: 'wish', label: t('demo.wishlist'), kind: 'primary' }, { id: 'menu', label: t('demo.menu') }],
      });
      if (r?.id !== 'wish') break;
      app.ui.toast(t('demo.soon'), 'info');   // shortcut: no store link yet; open it here when the page is live
    }
    debt()?.quit();
    void app.go('menu', {});
  };
  // wait for the duel scene or the Night card to clear, one frame at a time (no timer in game code)
  const when = (): void => {
    if (!app.run) { shown = false; return; }
    if (!presentationIdle()) { requestAnimationFrame(when); return; }
    void card();
  };
  const end = (night: number, rivalId?: string): void => {
    if (shown || !app.run || !demoRunEnds(true, night, rivalId)) return;
    shown = true;
    when();
  };
  const offs = [
    bus.on('duel:end', ({ rivalId, night }) => end(night, rivalId)),
    bus.on('shift:phase', ({ phase, index }) => { if (phase === 'intermission' && debt()?.nightPaid) end(index + 1); }),
    bus.on('app:state', ({ to }) => { if (to === 'menu') shown = false; }),
  ];
  return () => { for (const off of offs) off(); };
}
