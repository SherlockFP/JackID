/**
 * Stake safety lines (`run.ts` stake confirm and the Night 1 stake cap). The seat HUD / machine toast reads these when
 * `run:stakeConfirm` fires or `lastRefusal()` is 'confirm'. Loaded by the `*.strings.ts` glob.
 */
export default {
  prefix: 'stake.',
  en: {
    'confirm': 'PRESS AGAIN TO CONFIRM: {amount} of your {pocket} coins',
    'cap': 'Night 1 stake limit: {max}',
  },
  tr: {
    'confirm': 'ONAYLAMAK İÇİN TEKRAR BAS: {pocket} jetonun {amount} tanesi',
    'cap': 'Gece 1 bahis sınırı: {max}',
  },
};
