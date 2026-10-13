/** Fixture: menu code that routes all player text through t(). */
import { t } from '@/core/i18n';

export function label(n: number): string {
  // Comments may say Play or Bet freely; only literals are scanned.
  return t('menu.play') + ' ' + t('common.bet', { n });
}
