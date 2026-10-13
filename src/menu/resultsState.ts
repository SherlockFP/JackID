/**
 * STUB — owned by HUD. The results screen (stats, placements, obols, Hall of Losers entry) is not built yet:
 * entering it bounces back to the menu with a toast. Keep the factory name `createResultsState`.
 */
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { t } from '@/core/i18n';

export function createResultsState(): AppStateHandler<'results'> {
  return {
    enter() { void app.go('menu', { toast: t('ui.stub.notReady') }); },
    exit() {},
    fixedUpdate() {},
    frame() {},
  };
}
