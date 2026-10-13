/**
 * STUB — owned by MENU-UI. The party lobby (roster, ready-up, host settings, invite link, chat) is not built
 * yet: entering it bounces back to the menu with a toast. Keep the factory name `createLobbyState`.
 */
import type { AppStateHandler } from '@/core/states';
import { app } from '@/core/app';
import { t } from '@/core/i18n';

export function createLobbyState(): AppStateHandler<'lobby'> {
  return {
    enter() { void app.go('menu', { toast: t('ui.stub.notReady') }); },
    exit() {},
    fixedUpdate() {},
    frame() {},
  };
}
